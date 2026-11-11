import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeliveryQueue } from '../src/delivery.mjs';
import { readMessages, lastExchange, userPromptsSince } from '../src/transcript.mjs';
import { Backend } from '../src/backend.mjs';
import { pathKey, normPath } from '../src/workspaces.mjs';
import { Kanbans } from '../src/kanban.mjs';

const turn = () => new Promise((r) => setImmediate(r));
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-resilience-'));
const line = (text) => JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { content: text } });

function queue(send) {
  const rows = new Map();
  const store = { activeDeliveries: () => [], insertDelivery: (d) => rows.set(d.deliveryId, { ...d }), updateDelivery: (id, patch) => Object.assign(rows.get(id), patch) };
  const q = new DeliveryQueue({ store, cfg: { submitConfirmMs: 30000, deliveryMaxWaitMs: 60000 }, view: () => ({ state: 'ready', agentPresent: true, herdrConnected: true }), send });
  return { q, rows };
}

test('제출 hook이 먼저 확정한 전달은 늦은 RPC 오류로 되돌리지 않는다', async () => {
  const send = defer(); const { q, rows } = queue(() => send.promise);
  const d = q.enqueue('s', 'hello'); await turn();
  q.onUserPromptSubmit('s', 'hello');
  send.reject(Object.assign(new Error('connection lost after submit'), { code: 'unreachable' })); await turn();
  assert.equal(rows.get(d.deliveryId).status, 'confirmed');
  assert.equal(q.pending('s'), 0);
});

test('실패한 시도의 working 이벤트로 다음 시도를 잘못 확정하지 않는다', async () => {
  const first = defer(), second = defer(); let n = 0;
  const { q } = queue(() => (++n === 1 ? first : second).promise);
  const d = q.enqueue('s', 'hello'); await turn();
  q.onAgentWorking('s'); first.reject(Object.assign(new Error('blocked'), { code: 'agent_blocked' })); await turn();
  q.poke('s'); await turn(); second.resolve(); await turn();
  assert.equal(d.status, 'sent');
});

test('아직 쓰는 JSONL 마지막 줄은 다음 조회에서 놓치지 않는다', () => {
  const dir = tmp(), file = path.join(dir, 'partial.jsonl');
  try {
    const next = line('둘째');
    fs.writeFileSync(file, line('첫째') + '\n' + next.slice(0, 20));
    const first = readMessages(file);
    assert.equal(readMessages(file, { afterSeq: first.lastSeq }).lastSeq, first.lastSeq);
    fs.appendFileSync(file, next.slice(20) + '\n');
    assert.deepEqual(readMessages(file, { afterSeq: first.lastSeq }).messages.map((m) => m.text), ['둘째']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('JSONL의 잘못된 행과 null content는 정상 대화를 가리지 않는다', () => {
  const dir = tmp(), file = path.join(dir, 'mixed.jsonl');
  try {
    fs.writeFileSync(file, [null, 4, { type: 'assistant', message: { content: [null, { type: 'text', text: 'ok' }] } }].map(JSON.stringify).join('\n') + '\n' + line('valid'));
    assert.doesNotThrow(() => readMessages(file));
    assert.ok(readMessages(file).messages.some((m) => m.text === 'valid'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('도구 호출이 500개를 넘어도 복구에 필요한 사용자 지시를 유지한다', () => {
  const dir = tmp(), file = path.join(dir, 'long.jsonl');
  try {
    const tool = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', id: 't', input: {} }] } });
    fs.writeFileSync(file, [line('original prompt'), ...Array(600).fill(tool), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } })].join('\n'));
    assert.equal(lastExchange(file).lastPrompt, 'original prompt');
    assert.deepEqual(userPromptsSince(file, Date.now() - 10000), ['original prompt']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('동시에 요청된 같은 세션 이름은 하나만 생성 단계에 들어간다', { timeout: 5000 }, async () => {
  const dir = tmp(), gate = defer(), entered = defer();
  const b = new Backend({ logDir: dir }); b.herdrOk = true;
  b.ensureWorkspace = () => {};
  b.adapter = { connected: true, createWorkspace: async () => { entered.resolve(); await gate.promise; throw new Error('fixture stop'); } };
  b.withNewPane = (create) => create();
  try {
    const first = b.spawn({ name: 'same', kind: 'shell', cwd: dir }).catch((e) => e);
    await entered.promise;
    const second = b.spawn({ name: 'same', kind: 'shell', cwd: dir }).catch((e) => e);
    gate.resolve();
    assert.equal((await second).code, 'name_taken'); await first;
    assert.match((await b.spawn({ name: 'same', kind: 'shell', cwd: dir }).catch((e) => e)).message, /fixture stop/);
  } finally { gate.resolve(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('UNC 경로를 정규화해도 저장소 키가 바뀌지 않는다', () => {
  const p = String.raw`\\Server\Share\Repo`;
  assert.equal(pathKey(p), pathKey(normPath(p)));
  assert.equal(normPath(p), '//Server/Share/Repo');
});

test('동시에 추가한 칸반 카드를 덮어쓰지 않는다', async () => {
  let board = { kanbanId: 'k', title: 'fixture', columns: [{ columnId: 'todo', name: 'Todo', cards: [] }] };
  const k = new Kanbans({ store: { getKanban: () => structuredClone(board), updateKanban: (_, p) => { board = { ...board, ...p }; } }, broadcast() {}, apiError: (_, m) => new Error(m) });
  await Promise.all(['first', 'second'].map((text) => k.update({ kanban: 'k', op: { op: 'addCard', text } })));
  assert.deepEqual(board.columns[0].cards.map((c) => c.text), ['first', 'second']);
});
