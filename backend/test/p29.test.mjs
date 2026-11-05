// P29 시험: 공개 이슈 #1 버그 1~13번(전달 대기열, 대화 기록, 동시 요청, 경로, 자원 감시, CLI 연결). 각 시험은 맞는 동작을 단언한다.
// 실제 판, 세션, 대화 기록을 쓰지 않는다(가짜 전송기, 임시 폴더, 로컬 소켓만).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { DeliveryQueue } from '../src/delivery.mjs';
import { readMessages, lastExchange, userPromptsSince } from '../src/transcript.mjs';
import { Kanbans } from '../src/kanban.mjs';
import { normPath } from '../src/workspaces.mjs';
import { ResourceMonitor } from '../src/resources.mjs';
import { ApiClient } from '../src/client.mjs';
import { Backend } from '../src/backend.mjs';

const CLIENT_URL = new URL('../src/client.mjs', import.meta.url).href;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-issue1-'));
const ready = () => ({ state: 'ready', agentPresent: true, herdrConnected: true });
const fakeStore = (rows = []) => ({ log: [], activeDeliveries: () => rows, insertDelivery() {}, updateDelivery(id, patch) { this.log.push(patch.status); } });
const cfg = { submitConfirmMs: 30000, deliveryMaxWaitMs: 900000, inputQuietMs: 0 };
const tick = () => new Promise((r) => setImmediate(r));

test('1 복구한 sending 전달은 확인 기한 뒤 unconfirmed가 된다', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const row = { deliveryId: 'd', sessionId: 's', text: 'x', status: 'sending', createdAt: 90000, sentAt: null };
  const q = new DeliveryQueue({ store: fakeStore([row]), cfg, view: ready, send: async () => {} });
  t.mock.timers.tick(3600000);
  q.pump();
  assert.equal(row.status, 'unconfirmed');
});

test('2 hook으로 confirmed된 뒤 늦은 전송 오류가 queued로 되돌리지 않는다', async () => {
  let rej;
  const store = fakeStore();
  const q = new DeliveryQueue({ store, cfg, view: ready, send: () => new Promise((_, r) => { rej = r; }) });
  const d = q.enqueue('s', 'hello');
  await tick(); // pump → sending
  q.onUserPromptSubmit('s', 'hello'); // confirmed
  rej(Object.assign(new Error('gone'), { code: 'unreachable' }));
  await tick();
  assert.equal(d.status, 'confirmed', `상태 기록: ${store.log.join(' → ')}`);
});

test('3 첫 시도의 working 신호를 다음 시도의 확인으로 쓰지 않는다', async () => {
  let n = 0;
  const q = new DeliveryQueue({ store: fakeStore(), cfg, view: ready, send: async () => { if (++n === 1) { q.onAgentWorking('s'); throw Object.assign(new Error('blocked'), { code: 'agent_blocked' }); } } });
  const d = q.enqueue('s', 'hello');
  await tick(); await tick(); // 첫 시도 실패 → queued
  q.pump(); await tick(); await tick(); // 두 번째 시도 성공, 새 working 없음
  assert.equal(d.status, 'sent');
});

test('4 쓰는 중인 마지막 줄을 건너뛰지 않는다', () => {
  const dir = tmp(), file = path.join(dir, 'a.jsonl');
  const row = (text) => JSON.stringify({ type: 'user', message: { content: text } });
  try {
    const next = row('second');
    fs.writeFileSync(file, row('first') + '\n' + next.slice(0, 20));
    const first = readMessages(file);
    fs.appendFileSync(file, next.slice(20) + '\n');
    assert.deepEqual(readMessages(file, { afterSeq: first.lastSeq }).messages.map((m) => m.text), ['second']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('5 null 줄이나 content 안의 null이 있어도 나머지를 읽는다', () => {
  const dir = tmp(), file = path.join(dir, 'a.jsonl');
  try {
    fs.writeFileSync(file, ['null', JSON.stringify({ type: 'user', message: { content: [null, { type: 'text', text: 'ok' }] } }), JSON.stringify({ type: 'user', message: { content: 'fine' } })].join('\n') + '\n');
    assert.deepEqual(readMessages(file).messages.map((m) => m.text), ['ok', 'fine']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('6 지시 뒤 도구 메시지가 500개를 넘어도 마지막 지시를 찾는다', () => {
  const dir = tmp(), file = path.join(dir, 'a.jsonl');
  const ts = new Date(Date.now()).toISOString();
  try {
    const lines = [JSON.stringify({ type: 'user', timestamp: ts, message: { content: 'do the big task' } })];
    for (let i = 0; i < 300; i++) {
      lines.push(JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: {} }] } }));
      lines.push(JSON.stringify({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'ok' }] } }));
    }
    lines.push(JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'text', text: 'done' }] } }));
    fs.writeFileSync(file, lines.join('\n') + '\n');
    assert.equal(lastExchange(file).lastPrompt, 'do the big task');
    assert.deepEqual(userPromptsSince(file, Date.now() - 60000), ['do the big task']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('7 같은 이름의 spawn 두 개를 동시에 하면 하나만 만드는 단계로 간다', async () => {
  const dir = tmp();
  let reached = 0;
  const fake = {
    herdrOk: true, adapter: { connected: true, agentKinds: async () => [] }, sessions: new Map(), spawningNames: new Set(), features: null, cfg: {},
    spawnReserved: Backend.prototype.spawnReserved,
    requireHerdr: Backend.prototype.requireHerdr,
    ensureWorkspace() { reached++; throw Object.assign(new Error('stop here'), { code: 'reached' }); },
  };
  const go = (p) => Backend.prototype.spawn.call(fake, p).catch((e) => e.code);
  try {
    const named = await Promise.all([go({ cwd: dir, kind: 'shell', name: 'twin' }), go({ cwd: dir, kind: 'shell', name: 'twin' })]);
    assert.equal(reached, 1, `둘 다 이름 검사를 지남: ${named.join(', ')}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('8 같은 칸반에 카드 둘을 동시에 더하면 둘 다 남는다', async () => {
  let board = { kanbanId: 'k', title: 't', columns: [{ columnId: 'todo', name: 'Todo', cards: [] }] };
  const k = new Kanbans({
    store: { getKanban: () => structuredClone(board), updateKanban: (_, patch) => { board = { ...board, ...patch }; } },
    broadcast() {}, apiError: (_, msg) => new Error(msg),
  });
  await Promise.all(['first', 'second'].map((text) => k.update({ kanban: 'k', op: { op: 'addCard', text } })));
  assert.deepEqual(board.columns[0].cards.map((c) => c.text).sort(), ['first', 'second']);
});

test('9 UNC 경로의 앞 이중 구분자를 지킨다', () => {
  assert.equal(normPath('\\\\Server\\Share\\Repo'), '//Server/Share/Repo');
});

test('10 자원 감시기를 start 직후 stop하면 첫 sample도 돌지 않는다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let samples = 0;
  const m = new ResourceMonitor({ sessions: () => [], processInfo: async () => null, controllers: () => [], herdrServerPid: () => null, session: 'x', readTable: async () => { samples++; return null; } });
  m.start(() => {}); m.stop();
  t.mock.timers.tick(5000);
  assert.equal(samples, 0);
});

test('11 에이전트 없는 셸 세션의 메모리를 센다', async () => {
  const procs = new Map([[10, { pid: 10, ppid: 1, ws: 1048576, name: 'pwsh.exe' }]]);
  const m = new ResourceMonitor({
    sessions: () => [{ sessionId: 's', name: 'sh1', paneId: 'p1', present: false, state: 'shell_idle' }],
    processInfo: async () => ({ shell_pid: 10, foreground_processes: [] }), controllers: () => [], herdrServerPid: () => null, session: 'x',
    readTable: async () => ({ procs, herdr: [] }),
  });
  const snap = await m.sample();
  assert.equal(snap.sessions[0].memMB, 1);
});

test('12 없는 nodePath로 startBackend하면 프로세스가 죽지 않고 실패를 돌려준다', () => {
  const dir = tmp();
  const script = `
    import { startBackend } from '${CLIENT_URL}';
    const d = ${JSON.stringify(dir.replace(/\\/g, '/'))};
    const cfg = { profile: 'dev', herdrSession: 'atrium-dev-issue1', port: 47899, dataDir: d, backendFile: d + '/backend.json', logDir: d + '/logs' };
    try { await startBackend(cfg, { nodePath: d + '/no-such-node.exe' }); console.log('RESOLVED'); } catch (e) { console.log('CAUGHT ' + e.message.slice(0, 60)); }
    process.exit(0);`;
  try {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 70000 });
    assert.match(r.stdout, /CAUGHT/, `exit=${r.status} stderr=${(r.stderr || '').split('\n').find((l) => /Error|ENOENT/.test(l)) || ''}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('13 handshake를 주지 않는 서버에 CLI 연결이 제한 시간 안에 실패한다', async () => {
  const srv = net.createServer(() => {}); // 받기만 하고 답하지 않는다
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const c = new ApiClient({ port: srv.address().port, token: 'x' });
  try {
    const r = await Promise.race([c.open({ handshakeTimeoutMs: 1000 }).then(() => 'open', () => 'rejected'), new Promise((res) => setTimeout(() => res('still pending after 5s'), 5000))]);
    assert.equal(r, 'rejected');
  } finally { try { c.ws.terminate(); } catch {} srv.close(); }
});
