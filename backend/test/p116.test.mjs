// P116 단위 시험: 에이전트끼리 일 시키기를 판의 atrium 명령으로(atrium prompt | wait | read).
// 판의 전달 규칙(진짜 DeliveryQueue), 잠든 세션 깨우기, 이름 풀기, 오류, --json 모양, 계약, 연결·오간 기록, 승인 규칙, 안내 글. herdr·hc와 claude 없이 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { newRuntime, applyHook, applyTermStatus, deriveState } from '../src/state.mjs';
import { workspaceOf } from '../src/git.mjs';
import { DeliveryQueue } from '../src/delivery.mjs';
import { Branch, ATRIUM_ALLOW, branchAllow, boardSkill, childNotice, headNotice, childShims } from '../src/branch.mjs';
import { uploadsReadRule, tempReadRules } from '../src/uploads.mjs'; // P162
import { similarNames, verbLines, WAIT_DEFAULT_MS } from '../src/agent-verbs.mjs';
import { CONTRACT_VERSION, VERB_NAMES, VERBS, EXIT, shortHelp, contractJson } from '../src/cli-contract.mjs';
import { BOARD_SYSTEM_PROMPT, writeBoardPlugin } from '../src/launch.mjs';
import { HARNESS_PROMPT } from '../src/harness.mjs';
import { roleNotice, unlinkNotice } from '../src/links.mjs';
import { spawnsInCommand, matchSpawns, promptKey } from '../src/spawns.mjs';
import { Backend } from '../src/backend.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p116-'));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('until: 시간 초과'); await tick(10); } }

// ---------- 가짜 판: 진짜 저장소·전달 대기열(B1)·Branch, 가짜 에이전트 ----------
async function board({ backend = 'hc' } = {}) {
  const dir = tmp();
  const store = new Store(path.join(dir, 'board.db'));
  const ws = await workspaceOf(dir);
  store.insertWorkspace({ ...ws, createdAt: 1 });
  const cfg = { profile: 'dev', terminalSession: 'atrium-dev-p116test', port: 0, dataDir: dir, sessionsDir: path.join(dir, 'sessions'), inputQuietMs: 3000, submitConfirmMs: 3000, deliveryMaxWaitMs: 60000, submitRetries: 0 };
  const b = {
    cfg, apiToken: 'board-api-token', store, sessions: new Map(), bus: new EventEmitter(), killing: new Set(),
    sent: [], woke: [], reads: [], screens: new Map(),
    api: { broadcast: () => {} }, log: () => {}, requireTerminal: () => {},
    adapter: { backend, connected: true, readScreen: async (paneId, o) => { b.reads.push([paneId, o]); if (!b.screens.has(paneId)) throw Object.assign(new Error('no pane'), { code: 'pane_not_found' }); return b.screens.get(paneId); } },
    hooked: (s) => s.rt.hooked !== false,
    summary: (s) => { const d = deriveState(s.rt); return { state: d.state, ask: d.ask || null, error: d.error || s.rt.lastError || null }; },
    ensureLink(from, to, patch = {}) {
      let l = store.linkByPair(from, to);
      if (!l) { l = { linkId: 'l' + crypto.randomBytes(4).toString('hex'), from, to, role: patch.role ?? null, spawned: !!patch.spawned, observed: !!patch.observed, createdAt: Date.now() }; store.insertLink(l); }
      return store.getLink(l.linkId);
    },
    linkEvent(l, kind, text = null, data = null) { return store.addLinkEvent(l.linkId, kind, text, data); },
    // 잠든 세션 깨우기(sleep.mjs wakeFor 자리): 잠깐 뒤 claude가 다시 떠 쉰다
    sleeper: { isAsleep: (s) => !!s.rt.sleep, wakeFor: async (s, why) => { b.woke.push([s.name, why]); await tick(40); s.rt.sleep = null; idle(s); return { awake: true }; } },
  };
  b.queue = new DeliveryQueue({
    store, cfg,
    view: (sid) => { const s = b.sessions.get(sid); if (!s) return { closed: true }; return { state: deriveState(s.rt).state, agentPresent: s.rt.term.present, termConnected: true, lastUserInputAt: s.lastUserInputAt || 0, closed: false, kind: s.kind, hooked: b.hooked(s) }; },
    send: async (sid, text) => { b.sent.push({ sid, text }); const s = b.sessions.get(sid); if (s && s.agent) setTimeout(() => s.agent(text), 5); },
  });
  b.queue.start();
  b.branch = new Branch(b, { readyWaitMs: 30, submitWaitMs: 10, verbs: { pollMs: 15, settleMs: 1500, turnGraceMs: 300, answerGraceMs: 300 } });
  b.queue.on('delivery', (d) => { if (['confirmed', 'unconfirmed', 'failed', 'cancelled'].includes(d.status)) b.branch.onDeliveryEnd(d); }); // backend.mjs와 같다
  const add = (name, { kind = 'claude', hooked = kind === 'claude', state = 'ready', workMs = 60, answer = (t) => `답: ${t}`, ...extra } = {}) => {
    const s = { sessionId: crypto.randomUUID(), name, cwd: dir, paneId: `${name}:p1`, agentName: name, permissionMode: 'manual', kind, origin: 'board', parentSessionId: null, workspaceKey: ws.key, rt: newRuntime({ kind, hooked }), createdAt: Date.now(), ...extra };
    if (state === 'ready') idle(s);
    store.insertSession({ ...s, settingsPath: '', hookToken: '', runtime: s.rt });
    b.sessions.set(s.sessionId, s);
    // 가짜 에이전트: 글을 받으면 일하고 답한다(Claude Code는 hook, 다른 종류는 herdr 상태 + 판이 화면에서 고른 답)
    s.agent = (text) => {
      if (hooked) { applyHook(s.rt, { hook_event_name: 'UserPromptSubmit', prompt: text }); b.queue.onUserPromptSubmit(s.sessionId, text); applyTermStatus(s.rt, 'working'); }
      else { applyTermStatus(s.rt, 'working'); b.queue.onAgentWorking(s.sessionId); }
      setTimeout(() => {
        if (hooked) { applyHook(s.rt, { hook_event_name: 'Stop', last_assistant_message: answer(text) }); applyTermStatus(s.rt, 'idle'); }
        else { applyTermStatus(s.rt, 'idle'); setTimeout(() => { s.rt.lastAnswer = answer(text); s.rt.lastAnswerAt = Date.now(); s.rt.answerSource = 'screen'; }, 30); }
      }, workMs);
    };
    return s;
  };
  return { b, dir, ws, add, stop: () => { b.queue.stop(); b.branch.notices.stop(); store.close(); } };
}
function idle(s) { s.rt.term.present = true; s.rt.phase = 'running'; applyTermStatus(s.rt, 'idle'); }
function serve(b) {
  const srv = http.createServer((req, res) => { if (!b.branch.handleHttp(req, res)) { res.writeHead(404); res.end(); } });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => { b.cfg.port = srv.address().port; r(srv); }));
}
function runCli(args, env) {
  return new Promise((resolve) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(MTASK_|ATRIUM_|HERDR_)/.test(k)));
    execFile(process.execPath, [path.join(HERE, '..', 'bin', 'atrium-child.mjs'), ...args], { env: { ...clean, ...env }, timeout: 30000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}
// Claude Code 규칙의 대략적인 맞춤(p8 시험과 같다)
function allowed(rules, tool, cmd) {
  return rules.some((r) => {
    const m = /^(\w+)\((.*)\)$/.exec(r); if (!m || m[1] !== tool) return false;
    const p = m[2];
    if (p.endsWith(':*')) return cmd === p.slice(0, -2) || cmd.startsWith(p.slice(0, -2));
    if (p.endsWith(' *')) return cmd.startsWith(p.slice(0, -1));
    return cmd === p;
  });
}
const events = (b, kind) => b.store.db.prepare('SELECT * FROM link_events').all().filter((e) => !kind || e.kind === kind);

// ---------- 계약과 사용법 ----------
test('P116 계약: 계약 2, 동사 prompt·wait·read(인자·출력 모양), 종료 코드 3(기다리는 시간이 끝남), 사용법에 다른 에이전트에게는 atrium prompt로만', () => {
  assert.equal(CONTRACT_VERSION, 3); // P156
  for (const v of ['prompt', 'wait', 'read']) assert.ok(VERB_NAMES.includes(v), v);
  const by = Object.fromEntries(VERBS.map((v) => [v.name, v]));
  assert.deepEqual(by.prompt.args, ['<이름>', '"<할 일>"', '[--wait | --now]', '[--timeout ms]', '[--json]']); // P143: --now(더하기만 해 계약은 그대로)
  assert.deepEqual(by.prompt.out, ['name', 'agentName', 'kind', 'state', 'woke', 'deliveryId', 'delivery', 'turn', 'next', 'unit']); // P180: unit(더하기만)
  assert.deepEqual(by.wait.out, ['name', 'agentName', 'kind', 'status', 'state', 'ms', 'answer', 'ask', 'error', 'delivery', 'next', 'unit']); // P180
  assert.deepEqual(by.read.out, ['name', 'agentName', 'kind', 'state', 'lines', 'source', 'text', 'answer', 'next']);
  assert.equal(EXIT.timeout, 3);
  assert.ok(contractJson().waitStatus.includes('waiting'));
  const h = shortHelp();
  assert.match(h, /atrium prompt <이름> "<할 일>" \[--wait \| --now\]/); // P143
  assert.match(h, /다른 에이전트에게는 atrium prompt로만 보낸다/);
  assert.equal(WAIT_DEFAULT_MS, 100000, '한 번에 기다리는 기본은 Claude Code Bash 도구의 2분 안쪽');
  assert.deepEqual(verbLines('w1'), { prompt: 'atrium prompt w1 "<할 일>" --wait', wait: 'atrium wait w1', read: 'atrium read w1' });
});

// ---------- 승인 규칙 ----------
test('P116 승인: atrium prompt|wait|read(옛 이름 mtask, PowerShell)는 묻지 않는다. herdr 일 시키기 규칙은 판의 규칙에 없다(P129)', () => {
  for (const c of ['atrium prompt w1 "do it"', 'atrium prompt w1 "do it" --wait --timeout 600000', 'atrium wait w1', 'atrium wait w1 --timeout 600000', 'atrium read w1', 'atrium read w1 --lines 40', 'mtask prompt w1 "x"', 'mtask wait w1', 'mtask read w1']) {
    assert.ok(allowed(ATRIUM_ALLOW, 'Bash', c), `Bash ${c}`);
  }
  for (const c of ['atrium prompt w1 "x"', 'atrium wait w1', 'atrium read w1']) assert.ok(allowed(ATRIUM_ALLOW, 'PowerShell', c), `PowerShell ${c}`);
  for (const c of ['atrium kill w1', 'atrium send @w1 x', 'atrium settings set tray on']) assert.ok(!allowed(ATRIUM_ALLOW, 'Bash', c), `묻는다: ${c}`);
  assert.deepEqual(branchAllow(), ATRIUM_ALLOW);
  assert.ok(!allowed(branchAllow(), 'Bash', 'herdr agent prompt w1 "x"'), 'herdr 명령은 판의 세션에 가지 않는다');
});

test('P116·P129 승인: refreshSettings가 도는 세션 설정 파일에 atrium 규칙을 더하고, 옛 herdr 규칙(일 시키기, 사람이 고른 herdr 전체 허용)은 뺀다', async () => {
  const { b, dir, add, stop } = await board();
  try {
    const s = add('lead');
    s.settingsPath = path.join(dir, 's.json');
    fs.writeFileSync(s.settingsPath, JSON.stringify({ hooks: {}, permissions: { allow: ['Bash(herdr:*)', 'Bash(atrium child *)', 'Bash(herdr agent prompt *)', 'PowerShell(herdr agent read *)', 'Bash(git status)'] }, env: { MTASK_PORT: '1' } }));
    assert.equal(b.branch.refreshSettings(), 1);
    const j = JSON.parse(fs.readFileSync(s.settingsPath, 'utf8'));
    assert.ok(j.permissions.allow.includes('Bash(atrium prompt *)') && j.permissions.allow.includes('PowerShell(atrium read *)'));
    assert.ok(j.permissions.allow.includes('Bash(git status)'), '다른 규칙은 그대로');
    assert.ok(!j.permissions.allow.some((r) => /herdr/.test(r)), j.permissions.allow.join(','));
    assert.equal(j.env.ATRIUM_SESSION_ID, s.sessionId); assert.equal(j.env.MTASK_PORT, undefined);
    assert.equal(b.branch.refreshSettings(), 0, '두 번째는 바꾸지 않는다');
    assert.deepEqual(b.branch.settingsExtra(s.sessionId).allow, [...branchAllow(), uploadsReadRule(b.cfg.dataDir), ...tempReadRules()]); // P162: 업로드 자리 읽기. macOS 판: 임시 폴더 읽기
  } finally { stop(); }
});

// ---------- 이름 풀기와 오류 ----------
test('P116 이름: @ 없이도·판의 이름(label)·주소로 찾고, 없으면 not_found와 비슷한 이름, 닫힌 세션은 closed, 자기 자신은 self, 셸은 not_agent', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead'); const w1 = add('api-tests'); add('reviewer', { label: 'Rev' }); add('sh1', { kind: 'shell' });
    const v = b.branch.verbs;
    assert.equal(v.target(lead, 'api-tests'), w1); assert.equal(v.target(lead, '@api-tests'), w1);
    assert.equal(v.target(lead, 'Rev').name, 'reviewer'); assert.equal(v.target(lead, 'rev').name, 'reviewer');
    const e = (ref) => { try { v.target(lead, ref); } catch (x) { return x; } return null; };
    const nf = e('api-test');
    assert.equal(nf.code, 'not_found'); assert.deepEqual(nf.candidates, ['api-tests']); assert.match(nf.message, /비슷한 이름: @api-tests/);
    assert.equal(e('nothing-like-it').candidates.length, 0);
    assert.equal(e('lead').code, 'self'); assert.equal(e('sh1').code, 'not_agent'); assert.equal(e('').code, 'bad_request');
    const gone = add('old-w');
    b.sessions.delete(gone.sessionId); b.store.updateSession(gone.sessionId, { closedAt: Date.now(), closeReason: 'killed' });
    assert.equal(e('old-w').code, 'closed');
    assert.deepEqual(similarNames('w1', ['w2', 'w10', 'lead', 'zzz']), ['w10', 'w2']);
  } finally { stop(); }
});

// ---------- prompt: 판의 전달 규칙 ----------
test('P116 prompt: 받는 쪽이 일하는 중이면 대기열(working)로 바로 돌려주고, 턴이 끝나면 보드가 넣는다. 연결·지시 기록이 남는다', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead'); const w1 = add('w1', { workMs: 40 });
    applyTermStatus(w1.rt, 'working'); // 다른 턴을 도는 중
    const r = await b.branch.verbs.prompt(lead, { name: 'w1', text: '두 번째 일' });
    assert.equal(r.delivery.status, 'queued'); assert.equal(r.delivery.reason, 'working');
    assert.equal(b.sent.length, 0, '일하는 중에는 넣지 않는다(B1)');
    const l = b.store.linkByPair(lead.sessionId, w1.sessionId);
    assert.ok(l && l.observed);
    const ev = events(b, 'prompt');
    assert.equal(ev.length, 1); assert.equal(ev[0].text, '두 번째 일'); assert.equal(JSON.parse(ev[0].data).via, 'atrium');
    assert.ok(!w1.openPromptFrom, '아직 들어가지 않은 글은 받는 쪽의 지금 지시가 아니다');
    applyTermStatus(w1.rt, 'idle');
    await until(() => (b.store.getDelivery(r.deliveryId) || {}).status === 'confirmed');
    assert.deepEqual(b.sent.map((x) => x.text), ['두 번째 일']);
    assert.ok(w1.openPromptFrom && w1.openPromptFrom.linkId === l.linkId, '들어가면 받는 쪽 상태(일하는 중, 끝남)를 이 지시 기록에 붙인다');
    assert.equal(events(b, 'target_submitted').length, 1);
  } finally { stop(); }
});

test('P116 prompt: 두 세션이 같은 세션에 잇달아 보내면(대기열) 들어간 순서대로 각 연결이 받는 쪽의 지금 지시가 된다', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead'); const other = add('other'); const w1 = add('w1', { workMs: 80 });
    applyTermStatus(w1.rt, 'working');
    await b.branch.verbs.prompt(lead, { name: 'w1', text: '리드의 일' });
    await b.branch.verbs.prompt(other, { name: 'w1', text: '다른 세션의 일' });
    const la = b.store.linkByPair(lead.sessionId, w1.sessionId), lo = b.store.linkByPair(other.sessionId, w1.sessionId);
    applyTermStatus(w1.rt, 'idle');
    await until(() => b.sent.length === 1 && w1.openPromptFrom);
    assert.equal(w1.openPromptFrom.linkId, la.linkId, '먼저 들어간 리드의 글');
    await until(() => b.sent.length === 2 && w1.openPromptFrom.linkId === lo.linkId, 4000);
    const sub = events(b, 'target_submitted').map((e) => e.link_id);
    assert.deepEqual(sub, [la.linkId, lo.linkId]);
  } finally { stop(); }
});

test('P116 wait: 너의 글(atrium child --prompt의 첫 요청 포함)로 시작한 턴이 이미 끝났으면 idle이 아니라 done과 그 답', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead'); const w1 = add('w1', { workMs: 20 });
    const d = b.queue.enqueue(w1.sessionId, '첫 요청');
    b.branch.verbs.noteSent(lead, w1, d.deliveryId); // spawnChild가 하는 것
    await until(() => w1.rt.lastAnswer === '답: 첫 요청' && deriveState(w1.rt).state === 'ready');
    await tick(50);
    const r = await b.branch.verbs.wait(lead, { name: 'w1' });
    assert.equal(r.status, 'done'); assert.equal(r.answer.text, '답: 첫 요청'); assert.ok(r.ms < 200, `${r.ms}ms`);
    // 그 뒤 다른 턴이 시작했으면(사람의 글) 그 턴을 본다
    w1.rt.turn = { startedAt: Date.now() + 6000, endedAt: Date.now() + 6001 };
    const r2 = await b.branch.verbs.wait(lead, { name: 'w1' });
    assert.equal(r2.status, 'idle');
  } finally { stop(); }
});

test('P116 prompt: 사람이 3초 안에 친 터미널(user_typing)·응답 필요(waiting)면 기다리고, 받을 수 있으면 넣어 확인(confirmed)까지 돌려준다', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead'); const w1 = add('w1'); const w2 = add('w2'); const w3 = add('w3');
    w1.lastUserInputAt = Date.now();
    const typing = await b.branch.verbs.prompt(lead, { name: 'w1', text: 'a' });
    assert.equal(typing.delivery.reason, 'user_typing');
    w2.rt.pendingAsk = { kind: 'permission', summary: 'Bash: mkdir x', since: Date.now() }; applyTermStatus(w2.rt, 'blocked');
    const asks = await b.branch.verbs.prompt(lead, { name: 'w2', text: 'b' });
    assert.equal(asks.delivery.reason, 'waiting');
    const ok = await b.branch.verbs.prompt(lead, { name: 'w3', text: 'c' });
    assert.equal(ok.delivery.status, 'confirmed'); assert.equal(ok.turn, null); assert.equal(ok.woke, false);
    assert.deepEqual(ok.next, verbLines('w3'));
    assert.deepEqual(b.sent.map((x) => x.text), ['c']);
  } finally { stop(); }
});

test('P116 prompt --wait: 그 글로 시작한 턴이 끝날 때까지 기다려 마지막 답(Claude Code는 hook)을 돌려주고, 기다린 결과와 받은 답을 연결 기록에 남긴다', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead'); const w1 = add('w1', { workMs: 120 });
    w1.rt.lastAnswer = '예전 답'; w1.rt.lastAnswerAt = Date.now() - 60000;
    const r = await b.branch.verbs.prompt(lead, { name: 'w1', text: '목록을 정리해', wait: true });
    assert.equal(r.turn.status, 'done'); assert.equal(r.turn.state, 'ready');
    assert.equal(r.turn.answer.text, '답: 목록을 정리해'); assert.equal(r.turn.answer.source, 'hook');
    assert.ok(r.turn.ms >= 100, `턴이 끝날 때까지 기다렸다(${r.turn.ms}ms)`);
    assert.equal(r.delivery.status, 'confirmed');
    assert.deepEqual(events(b).map((e) => e.kind), ['prompt', 'target_submitted', 'wait_result', 'reply']);
    assert.equal(events(b, 'reply')[0].text, '답: 목록을 정리해');
  } finally { stop(); }
});

test('P116 prompt --wait: 잠든 세션이면 판이 깨운 뒤 넣고(woke), 그 턴의 답을 돌려준다', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead'); const w1 = add('w1', { state: 'sleeping', workMs: 40 });
    w1.rt.sleep = { at: Date.now(), by: 'session', scope: 'session' };
    assert.equal(deriveState(w1.rt).state, 'sleeping');
    const r = await b.branch.verbs.prompt(lead, { name: 'w1', text: '일어나서 해', wait: true });
    assert.equal(r.woke, true);
    assert.deepEqual(b.woke[0], ['w1', 'atrium:lead']);
    assert.equal(r.turn.status, 'done'); assert.equal(r.turn.answer.text, '답: 일어나서 해');
    assert.deepEqual(b.sent.map((x) => x.text), ['일어나서 해'], '깬 뒤에 한 번 넣는다');
  } finally { stop(); }
});

// ---------- wait ----------
test('P116 wait: 일하는 턴이 끝날 때까지, 쉬면 바로 idle(마지막 답), 사람의 답을 기다리면 바로 waiting, 시간이 끝나면 timeout', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead'); const w1 = add('w1'); const w2 = add('w2'); const w3 = add('w3');
    // 일하는 턴
    applyHook(w1.rt, { hook_event_name: 'UserPromptSubmit', prompt: '사람이 준 일' }); applyTermStatus(w1.rt, 'working');
    setTimeout(() => { applyHook(w1.rt, { hook_event_name: 'Stop', last_assistant_message: '사람 일 끝' }); applyTermStatus(w1.rt, 'idle'); }, 80);
    const r1 = await b.branch.verbs.wait(lead, { name: 'w1' });
    assert.equal(r1.status, 'done'); assert.equal(r1.answer.text, '사람 일 끝');
    // 쉬는 중
    w2.rt.lastAnswer = '어제 답'; w2.rt.lastAnswerAt = 5;
    const r2 = await b.branch.verbs.wait(lead, { name: 'w2' });
    assert.equal(r2.status, 'idle'); assert.equal(r2.answer.text, '어제 답'); assert.ok(r2.ms < 200);
    // 응답 필요
    applyHook(w3.rt, { hook_event_name: 'UserPromptSubmit', prompt: 'x' }); applyHook(w3.rt, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'mkdir q' } }); applyTermStatus(w3.rt, 'blocked');
    const r3 = await b.branch.verbs.wait(lead, { name: 'w3' });
    assert.equal(r3.status, 'waiting'); assert.match(r3.ask.summary, /mkdir q/);
    // 시간 끝
    applyTermStatus(w2.rt, 'working');
    const r4 = await b.branch.verbs.wait(lead, { name: 'w2', timeoutMs: 1000 });
    assert.equal(r4.status, 'timeout'); assert.equal(r4.state, 'working'); assert.equal(r4.answer, null);
  } finally { stop(); }
});

test('P116 wait: prompt(--wait 없이) 뒤 atrium wait는 그 글의 턴(대기열에 있으면 들어가 끝날 때까지)을 기다린다', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead'); const w1 = add('w1', { workMs: 60 });
    applyTermStatus(w1.rt, 'working'); // 앞 턴
    const p = await b.branch.verbs.prompt(lead, { name: 'w1', text: '다음 일' });
    assert.equal(p.delivery.reason, 'working');
    setTimeout(() => { applyHook(w1.rt, { hook_event_name: 'Stop', last_assistant_message: '앞 턴 답' }); applyTermStatus(w1.rt, 'idle'); }, 50);
    const r = await b.branch.verbs.wait(lead, { name: 'w1' });
    assert.equal(r.status, 'done'); assert.equal(r.answer.text, '답: 다음 일', '앞 턴이 아니라 보낸 글의 턴');
    assert.equal(r.delivery.status, 'confirmed');
  } finally { stop(); }
});

test('P116 wait: hook 없는 종류(codex)는 herdr 상태로 턴을 보고, 판이 화면에서 고른 답을 기다려 돌려준다(F5)', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead'); add('cx', { kind: 'codex', hooked: false, workMs: 50 });
    const r = await b.branch.verbs.prompt(lead, { name: 'cx', text: '코덱스 일', wait: true });
    assert.equal(r.kind, 'codex');
    assert.equal(r.turn.status, 'done'); assert.equal(r.turn.answer.text, '답: 코덱스 일'); assert.equal(r.turn.answer.source, 'screen');
  } finally { stop(); }
});

// ---------- read ----------
test('P116 read: 받는 세션 화면의 최근 줄(recent_unwrapped, --lines), 잠든 세션은 마지막 답. 받은 화면을 연결 기록(reply)에 남긴다', async () => {
  const { b, add, stop } = await board({ backend: 'hc' });
  try {
    const lead = add('lead'); add('w1'); const w2 = add('w2');
    b.screens.set('w1:p1', '줄 1\n❯ 해 줘\n● 했다   \n\n');
    const r = await b.branch.verbs.read(lead, { name: 'w1', lines: 40 });
    assert.deepEqual(b.reads[0], ['w1:p1', { source: 'recent_unwrapped', lines: 240 }], '빈 줄을 줄일 만큼 더 읽는다');
    assert.equal(r.source, 'screen'); assert.equal(r.text, '줄 1\n❯ 해 줘\n● 했다'); assert.equal(r.lines, 40);
    // hc의 terminal.read는 입력 칸 위의 빈 화면까지 준다(Codex): 빈 줄을 줄여 그 턴이 lines 안에 들게
    b.screens.set('w1:p1', `• Ran atrium prompt head x\n  └ 보냈다\n${'\n'.repeat(60)}› Ask Codex to do anything\n\n  status`);
    assert.equal((await b.branch.verbs.read(lead, { name: 'w1', lines: 5 })).text, '• Ran atrium prompt head x\n  └ 보냈다\n\n› Ask Codex to do anything\n\n  status'.split('\n').slice(-5).join('\n'));
    assert.equal(events(b, 'reply')[0].text, '했다');
    w2.rt.sleep = { at: Date.now() }; w2.paneId = null; w2.rt.lastAnswer = '자기 전 답'; w2.rt.lastAnswerAt = 1;
    const s = await b.branch.verbs.read(lead, { name: 'w2' });
    assert.equal(s.source, 'answer'); assert.equal(s.why, 'sleeping'); assert.equal(s.text, null); assert.equal(s.answer.text, '자기 전 답'); assert.equal(s.lines, 80);
  } finally { stop(); }
});

// ---------- CLI(세션 토큰으로 /branch/prompt·turn·read) ----------
test('P116 CLI: atrium prompt|wait|read의 --json 모양과 글, 종료 코드(못 찾음 1, 잘못 씀 2, 시간 끝 3)', async () => {
  const { b, add, stop } = await board();
  const srv = await serve(b);
  try {
    const lead = add('lead'); add('w1', { workMs: 60 }); const w2 = add('w2');
    b.screens.set('w1:p1', 'hello\n');
    const env = b.branch.envFor(lead.sessionId);
    const pj = await runCli(['prompt', 'w1', '정리해', '줘', '--wait', '--json'], env);
    assert.equal(pj.code, 0, pj.stderr);
    const p = JSON.parse(pj.stdout);
    for (const k of ['name', 'agentName', 'kind', 'state', 'woke', 'deliveryId', 'delivery', 'turn', 'next']) assert.ok(k in p, k);
    for (const k of ['status', 'state', 'ms', 'answer', 'ask', 'error', 'delivery', 'next']) assert.ok(k in p.turn, `turn.${k}`);
    assert.equal(p.turn.answer.text, '답: 정리해 줘', '따옴표 없이 친 여러 낱말은 한 글로');
    const pt = await runCli(['prompt', 'w1', '한 번 더', '--wait'], env);
    assert.equal(pt.code, 0, pt.stderr);
    assert.match(pt.stdout, /@w1에게 보냈다\(들어감/); assert.match(pt.stdout, /@w1: 턴이 끝났다/); assert.match(pt.stdout, /--- @w1의 마지막 답\(Claude Code가 준 답\) ---\n답: 한 번 더\n---/);
    const f = path.join(b.cfg.dataDir, 'task.md'); fs.writeFileSync(f, '파일에서 "따옴표" 글');
    const pf = await runCli(['prompt', 'w1', '--file', f, '--wait', '--json'], env);
    assert.equal(JSON.parse(pf.stdout).turn.answer.text, '답: 파일에서 "따옴표" 글');
    const rd = await runCli(['read', 'w1', '--lines', '5'], env);
    assert.equal(rd.code, 0, rd.stderr); assert.match(rd.stdout, /^@w1 \(claude, ready\) 화면 최근 5줄:\nhello/);
    applyTermStatus(w2.rt, 'working');
    const to = await runCli(['wait', 'w2', '--timeout', '1000'], env);
    assert.equal(to.code, 3); assert.match(to.stdout, /@w2: 아직 일하는 중이다.*다시 기다리기: atrium wait w2/);
    const nf = await runCli(['prompt', 'w9', 'x'], env);
    assert.equal(nf.code, 1); assert.match(nf.stderr, /not_found.*비슷한 이름: @w1/);
    const nfj = await runCli(['wait', 'w9', '--json'], env);
    assert.equal(nfj.code, 1); assert.equal(JSON.parse(nfj.stdout).error.code, 'not_found');
    assert.equal((await runCli(['prompt', 'w1'], env)).code, 2, '글이 없다');
    assert.equal((await runCli(['wait'], env)).code, 2, '이름이 없다');
    assert.equal((await runCli(['read', 'w1', '--lines', 'x'], env)).code, 2);
    const help = JSON.parse((await runCli(['help', '--json'], {})).stdout);
    assert.equal(help.contract, 3); assert.ok(help.verbs.some((v) => v.name === 'prompt'));
    // 세션 토큰이 틀리면 거부(판에 없는 세션도)
    const bad = await runCli(['prompt', 'w1', 'x'], { ...env, ATRIUM_SESSION_TOKEN: 'nope' });
    assert.equal(bad.code, 1); assert.match(bad.stderr, /bad_token/);
  } finally { srv.close(); stop(); }
});

// ---------- 안내와 스킬: herdr·hc 명령을 직접 쓰라는 글이 없다 ----------
const DIRECT = /herdr (agent|pane|workspace|tab|worktree|--session)|hc (send|read|wait|run|ls)\b|HERDR_ENV|--source recent-unwrapped|herdr 스킬로/;
test('P116 안내 글: 판 시스템 글, 하네스 안내문, atrium 스킬(옛 이름), CLI 사용법, 하위 세션·연결 알림에 herdr·hc 직접 명령이 없고 atrium prompt|wait|read가 있다', () => {
  const texts = {
    board: BOARD_SYSTEM_PROMPT, harness: HARNESS_PROMPT, skill: boardSkill(), delegate: boardSkill('delegate'), short: shortHelp(),
    long: fs.readFileSync(path.join(HERE, '..', 'bin', 'atrium-child.mjs'), 'utf8').match(/const HELP = `([\s\S]*?)`;/)[1],
    child: childNotice({ role: '워커', name: 'w1', depth: 2 }), head: headNotice({ name: 'h1' }), role: roleNotice({ role: '리뷰어', name: 'rv' }), unlink: unlinkNotice({ role: '리뷰어', name: 'rv' }),
    shim: Object.values(childShims({ node: 'C:\\n\\node.exe', script: 'C:\\b\\atrium-child.mjs' })).join('\n'),
  };
  for (const [k, t] of Object.entries(texts)) assert.doesNotMatch(t, DIRECT, k);
  for (const k of ['board', 'harness', 'skill', 'short', 'long']) assert.match(texts[k], /atrium prompt/, k);
  for (const k of ['board', 'harness', 'skill', 'long']) assert.match(texts[k], /atrium wait/, k);
  assert.match(BOARD_SYSTEM_PROMPT, /잠든 세션에 `atrium prompt`하면 보드가 깨운 뒤 넣는다/);
  assert.ok(!/[\r\n"]/.test(HARNESS_PROMPT), '하네스 안내문은 한 줄, 큰따옴표 없이');
});

test('P116·P129·P132 플러그인: 이름 atrium(스킬 atrium:atrium). 남은 옛 이름 폴더(atrium-herdr)는 같은 스킬·명령으로 다시 쓰고 skills/herdr는 지운다', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'atrium-herdr', 'skills', 'herdr'), { recursive: true });
  fs.writeFileSync(path.join(d, 'atrium-herdr', 'skills', 'herdr', 'SKILL.md'), 'old herdr skill');
  fs.mkdirSync(path.join(d, 'atrium-herdr', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(d, 'atrium-herdr', 'bin', 'atrium'), 'old shim');
  const pl = writeBoardPlugin({ dir: d, skills: { atrium: boardSkill(), delegate: boardSkill('delegate') }, bin: { atrium: 'new shim' } });
  assert.ok(pl.pluginDir.endsWith('/atrium'));
  const manifest = (n) => JSON.parse(fs.readFileSync(path.join(d, n, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest('atrium').name, 'atrium'); assert.doesNotMatch(manifest('atrium').description, /herdr/);
  // 옛 이름으로 띄워 아직 도는 세션(--plugin-dir …/atrium-herdr)이 같은 스킬과 새 명령을 쓴다
  assert.equal(manifest('atrium-herdr').name, 'atrium-herdr');
  for (const n of ['atrium', 'atrium-herdr']) {
    assert.ok(!fs.existsSync(path.join(d, n, 'skills', 'herdr')), n);
    assert.equal(fs.readFileSync(path.join(d, n, 'skills', 'atrium', 'SKILL.md'), 'utf8'), boardSkill(), n);
    assert.ok(fs.existsSync(path.join(d, n, 'skills', 'delegate', 'SKILL.md')), n);
    assert.equal(fs.readFileSync(path.join(d, n, 'bin', 'atrium'), 'utf8'), 'new shim', n);
  }
  // 옛 이름 폴더가 없던 판에는 만들지 않는다
  const d2 = tmp();
  writeBoardPlugin({ dir: d2, skills: { atrium: boardSkill() } });
  assert.deepEqual(fs.readdirSync(d2).filter((x) => !x.endsWith('.md')), ['atrium']);
});

// ---------- 연결 기록: hook 없는 세션의 target_done은 판이 화면에서 고른 답이 온 뒤 ----------
test('P116 연결 기록: hook 없는 세션(codex)이 쉬게 되어도 화면 답이 아직이면 기다렸다가 그 답으로 target_done을 남긴다(hc는 화면 읽기가 늦다)', async () => {
  const evs = [];
  const fake = { bus: new EventEmitter(), store: { getLink: () => ({ linkId: 'l1' }) }, hooked: () => false, linkEvent: (l, kind, text, data) => evs.push({ kind, text, data }), linkTargetDone: Backend.prototype.linkTargetDone };
  fake.linkTargetDone = fake.linkTargetDone.bind(fake);
  const s = { rt: newRuntime({ kind: 'codex', hooked: false }), openPromptFrom: null };
  s.rt.lastAnswer = '앞 턴 답'; s.rt.lastAnswerAt = 1;
  s.openPromptFrom = { linkId: 'l1', at: Date.now(), text: 'x', working: true };
  s.rt.turn = { startedAt: Date.now() - 100, endedAt: Date.now() };
  Backend.prototype.onLinkTargetState.call(fake, s, 'working', { state: 'ready' });
  Backend.prototype.onLinkTargetState.call(fake, s, 'working', { state: 'ready' }); // 같은 끝이 두 번 와도(herdr done·idle) 한 번
  assert.equal(evs.length, 0, '화면 답 전에는 남기지 않는다');
  s.rt.lastAnswer = '이번 턴 답'; s.rt.lastAnswerAt = Date.now() + 1;
  fake.bus.emit('screenAnswer', s);
  assert.deepEqual(evs.map((e) => [e.kind, e.text]), [['target_done', '이번 턴 답']]);
  assert.equal(s.openPromptFrom, null); assert.equal(fake.bus.listenerCount('screenAnswer'), 0);
});

// ---------- 판 밖 대화의 띄움 선: atrium child 뒤 atrium prompt가 첫 지시 ----------
test('P116 띄움 선: --prompt 없이 띄운 atrium child 뒤의 atrium prompt <이름> "…"를 그 워커의 첫 지시로 본다', () => {
  assert.deepEqual(spawnsInCommand('atrium prompt w1 "do the thing" --wait').map((x) => [x.kind, x.via, x.name, x.promptKey]), [['prompt', 'atrium', 'w1', promptKey('do the thing')]]);
  assert.deepEqual(spawnsInCommand('atrium prompt w1 --file C:/t.md'), [], '파일 글은 모른다');
  const t0 = 1_000_000;
  const convos = [
    { convId: 'lead', cwd: 'C:/r', startAt: t0 - 1000, spawns: [{ at: t0, kind: 'start', via: 'atrium-child', name: 'w1', worktree: null, cwd: null, promptKey: null }, { at: t0 + 60000, kind: 'prompt', via: 'atrium', name: 'w1', promptKey: promptKey('do the thing') }] },
    { convId: 'kid', cwd: 'C:/other', startAt: t0 + 61000, promptKey: promptKey('do the thing') },
  ];
  assert.equal(matchSpawns(convos).get('kid').parent, 'lead');
});
