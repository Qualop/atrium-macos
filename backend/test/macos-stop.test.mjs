// macOS 판: 중지 단추(session-stop.mjs)와 부모가 일하는 워커에 일을 다시 시키지 않게 하는 장치(agent-verbs duplicateOf)
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRuntime } from '../src/state.mjs';
import { stopTargets, stopTree, stopKeys, waitIdle } from '../src/session-stop.mjs';
import { AgentVerbs } from '../src/agent-verbs.mjs';

const sess = (id, { kind = 'claude', state = 'ready', parent = null } = {}) => {
  const rt = newRuntime({ kind }); rt.phase = 'running'; rt.term.present = true;
  if (kind === 'shell') rt.shell = { atPrompt: state !== 'shell_running' };
  else rt.term.status = state === 'working' ? 'working' : 'idle';
  return { sessionId: id, name: id, kind, paneId: `t-${id}`, rt, parent };
};
const board = (list) => {
  const sessions = new Map(list.map((s) => [s.sessionId, s]));
  const b = { sessions, keys: [], events: [], cancelled: [], log: () => {},
    workParentOf: (id) => sessions.get(id)?.parent || null,
    adapter: { paneKeys: async (pane, keys) => { b.keys.push([pane, ...keys]); } },
    store: { addEvent: (sid, kind, data) => b.events.push([sid, kind, data]) },
    queue: { items: new Map(), cancel: (id) => { b.cancelled.push(id); b.queue.items.get(id).status = 'cancelled'; } } };
  return b;
};

test('멈출 세션: 누른 세션부터 위에서 아래로, 일하는 것만. 떼어 낸(일 부모 없는) 세션과 쉬는 세션은 빼고, 뜨는 중도 뺀다', () => {
  const lead = sess('lead', { state: 'working' });
  const w1 = sess('w1', { state: 'working', parent: 'lead' });
  const w1a = sess('w1a', { state: 'working', parent: 'w1' });
  const w2 = sess('w2', { state: 'ready', parent: 'lead' });
  const free = sess('free', { state: 'working' }); // 독립으로 둔 세션
  const fresh = sess('fresh', { parent: 'lead' }); fresh.rt.phase = 'starting'; // 신뢰 질문일 수 있다
  const all = [w1a, free, w2, w1, lead, fresh];
  const b = board(all);
  const names = stopTargets(lead, all, { workParentOf: b.workParentOf, stateOf: (x) => (x.rt.phase === 'starting' ? 'starting' : x.rt.term.status === 'working' ? 'working' : 'ready') }).map((x) => x.name);
  assert.deepEqual(names, ['lead', 'w1', 'w1a']);
  assert.deepEqual(stopTargets(lead, all, { workParentOf: b.workParentOf, stateOf: () => 'working', tree: false }).map((x) => x.name), ['lead']);
});

test('중지: 에이전트에는 Esc, 셸에는 Ctrl+C. 쉬는 세션에는 키를 보내지 않고, 멈춘 하위의 대기 글은 거두되 누른 세션의 글은 둔다', async () => {
  const lead = sess('lead', { state: 'working' });
  const w1 = sess('w1', { state: 'working', parent: 'lead' });
  const sh = sess('sh', { kind: 'shell', state: 'shell_running', parent: 'lead' });
  const idle = sess('idle', { state: 'ready', parent: 'lead' });
  const b = board([lead, w1, sh, idle]);
  b.queue.items.set('d1', { deliveryId: 'd1', sessionId: 'w1', status: 'queued' });
  b.queue.items.set('d2', { deliveryId: 'd2', sessionId: 'lead', status: 'queued' });
  b.queue.items.set('d3', { deliveryId: 'd3', sessionId: 'idle', status: 'queued' });
  const r = await stopTree(b, lead);
  assert.deepEqual(r.stopped, ['lead', 'w1', 'sh']);
  assert.deepEqual(b.keys, [['t-lead', 'esc'], ['t-w1', 'esc'], ['t-sh', 'ctrl+c']]);
  assert.deepEqual(b.cancelled.sort(), ['d1', 'd3']);
  assert.equal(r.dropped, 2);
  assert.ok(b.events.some(([sid, k, d]) => sid === 'w1' && k === 'stopped' && d.by === 'parent'));
  assert.deepEqual(stopKeys({ kind: 'codex' }), ['esc']);
});

test('중지: 터미널이 없으면 키를 보내지 않고 알린다. 다 쉬면 waitIdle이 끝난다', async () => {
  const lead = sess('lead', { state: 'working' }); lead.rt.term.present = false;
  const b = board([lead]);
  const r = await stopTree(b, lead);
  assert.deepEqual(r.stopped, []); assert.deepEqual(r.failed, [{ name: 'lead', why: 'no_terminal' }]);
  const w = sess('w', { state: 'working' });
  setTimeout(() => { w.rt.term.status = 'idle'; }, 30);
  assert.equal(await waitIdle([w], { timeoutMs: 2000, stepMs: 10 }), true);
  w.rt.term.status = 'working';
  assert.equal(await waitIdle([w], { timeoutMs: 50, stepMs: 10 }), false);
});

test('같은 일 다시 보내기: 대기 중이거나 받는 쪽이 그 글의 턴을 하는 중이면 같은 글은 중복, 끝났거나 다른 글이면 아니다', () => {
  const rows = new Map();
  const ctx = { b: { store: { getDelivery: (id) => rows.get(id) || null } }, sent: new Map() };
  const dup = (caller, t, text) => AgentVerbs.prototype.duplicateOf.call(ctx, caller, t, text);
  const lead = sess('lead'), w1 = sess('w1', { state: 'working' });
  assert.equal(dup(lead, w1, 'do it'), null, '보낸 적 없음');
  ctx.sent.set('lead>w1', 'd1');
  rows.set('d1', { deliveryId: 'd1', text: 'fix the parser\nand test', status: 'queued' });
  assert.equal(dup(lead, w1, '  fix the parser and   test ')?.deliveryId, 'd1', '대기 중, 띄어쓰기만 다름');
  assert.equal(dup(lead, w1, 'fix the lexer'), null, '다른 글');
  rows.set('d1', { deliveryId: 'd1', text: 'fix the parser and test', status: 'confirmed', confirmedAt: 1000 });
  w1.rt.turn = { startedAt: 1200 };
  assert.equal(dup(lead, w1, 'fix the parser and test')?.deliveryId, 'd1', '그 글의 턴을 하는 중');
  w1.rt.term.status = 'idle';
  assert.equal(dup(lead, w1, 'fix the parser and test'), null, '끝났으면 다시 시켜도 된다');
  rows.set('d1', { deliveryId: 'd1', text: 'fix the parser and test', status: 'failed' });
  assert.equal(dup(lead, w1, 'fix the parser and test'), null, '못 들어간 글은 다시 보낸다');
});

test('임시 폴더 읽기 규칙: /tmp와 TMPDIR의 /var·/private/var 두 모양, Windows는 없음', async () => {
  const { tempReadRules } = await import('../src/uploads.mjs');
  assert.deepEqual(tempReadRules({ tmpdir: '/var/folders/ab/cd/T/', platform: 'darwin' }), ['Read(//tmp/**)', 'Read(//private/tmp/**)', 'Read(//var/folders/ab/cd/T/**)', 'Read(//private/var/folders/ab/cd/T/**)']);
  assert.deepEqual(tempReadRules({ tmpdir: '/tmp', platform: 'linux' }), ['Read(//tmp/**)', 'Read(//private/tmp/**)']);
  assert.deepEqual(tempReadRules({ platform: 'win32' }), []);
});

test('사람이 멈춘 턴: 대화 기록의 "[Request interrupted by user" 줄(하위 에이전트 줄은 빼고)과 그 턴에만 붙는 멈춤 표시', async () => {
  const { foldInterrupt } = await import('../src/model-now.mjs');
  const { markTurnInterrupted } = await import('../src/state.mjs');
  const line = (o) => JSON.stringify(o);
  const at = Date.parse('2026-11-18T08:00:05Z');
  assert.equal(foldInterrupt([
    line({ type: 'user', timestamp: '2026-11-18T08:00:05Z', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
    line({ type: 'user', isSidechain: true, timestamp: '2026-11-18T08:00:09Z', message: { content: '[Request interrupted by user]' } }),
    line({ type: 'assistant', timestamp: '2026-11-18T08:00:09Z', message: { content: [{ type: 'text', text: 'quoting [Request interrupted by user' }] } }),
  ]), at);
  assert.equal(foldInterrupt(['{"type":"user","message":{"content":"hi"}}'], 7), 7);
  const rt = { turn: { startedAt: at - 1000, endedAt: null } };
  assert.equal(markTurnInterrupted(rt, at), true); assert.equal(rt.turn.interruptedAt, at);
  assert.equal(markTurnInterrupted(rt, at), false, '같은 멈춤');
  assert.equal(markTurnInterrupted({ turn: { startedAt: at + 1, endedAt: null } }, at), false, '그 턴보다 앞선 멈춤');
  assert.equal(markTurnInterrupted({ turn: { startedAt: at - 9, endedAt: at - 1 } }, at), false, '이미 끝난 턴');
});

test('atrium wait: 사람이 멈춘 턴은 옛 답 없이 interrupted로 한 번 알리고, 다시 기다리면 사람이 이어 간 새 턴의 답을 준다', async () => {
  const caller = { sessionId: 'P', name: 'lead' };
  const t = { sessionId: 'W', name: 'w1', kind: 'claude', rt: { turn: { startedAt: 1000, endedAt: null }, lastAnswer: 'OLD answer', lastAnswerAt: 500 } };
  let state = 'working';
  setTimeout(() => { t.rt.turn.interruptedAt = 2000; state = 'ready'; }, 20); // 부모가 기다리는 중에 사람이 Esc
  const b = { sessions: new Map([['W', t]]), summary: () => ({ state }), store: { getDelivery: () => null, addEvent: () => {} }, queue: { list: () => [] }, hooked: () => true, linkEvent: () => {}, ensureLink: () => ({}) };
  const v = new AgentVerbs(b, null, { pollMs: 5, turnGraceMs: 10, answerGraceMs: 10 });
  const first = await v.waitTurn(caller, t, { timeoutMs: 1000 });
  assert.equal(first.status, 'interrupted'); assert.equal(first.answer, null, '옛 답을 결과로 주지 않는다');
  // 다시 기다리는 동안 사람이 continue → 새 턴이 돌고 끝난다
  setTimeout(() => { t.rt.turn = { startedAt: Date.now(), endedAt: null }; state = 'working'; }, 30);
  setTimeout(() => { t.rt.turn.endedAt = Date.now(); t.rt.lastAnswer = 'NEW result'; t.rt.lastAnswerAt = Date.now(); state = 'ready'; }, 80);
  const second = await v.waitTurn(caller, t, { timeoutMs: 3000 });
  assert.equal(second.status, 'done'); assert.equal(second.answer.text, 'NEW result');
  // 이어 가지 않고 시간이 끝나면 timeout이 아니라 interrupted
  t.rt.turn = { startedAt: 5000, endedAt: null, interruptedAt: 6000 }; state = 'ready';
  assert.equal((await v.waitTurn(caller, t, { timeoutMs: 1000 })).status, 'interrupted');
  assert.equal((await v.waitTurn(caller, t, { timeoutMs: 1000 })).status, 'interrupted');
});

test('macOS: API 오류로 끊긴 턴 — 기록의 isApiErrorMessage 줄로 끝내고(hook이 닿지 않을 때), 사이드체인과 옛 줄은 무시', async () => {
  const { foldApiError } = await import('../src/model-now.mjs');
  const { markTurnFailed } = await import('../src/state.mjs');
  const line = (o) => JSON.stringify(o);
  const err = line({ type: 'assistant', timestamp: '2026-11-19T02:43:05.039Z', isApiErrorMessage: true, error: 'server_error', message: { content: [{ type: 'text', text: 'API Error: Your computer went to sleep mid-response.' }] } });
  const side = line({ type: 'assistant', isSidechain: true, timestamp: '2026-11-19T02:44:00.000Z', isApiErrorMessage: true, message: { content: [] } });
  const e = foldApiError([err, side, '{bad']);
  assert.equal(e.type, 'server_error');
  assert.equal(e.at, Date.parse('2026-11-19T02:43:05.039Z'));
  assert.match(e.message, /went to sleep/);
  assert.equal(foldApiError([err], { at: e.at + 1 }).at, e.at + 1); // 더 새 것은 그대로
  const rt = { turn: { startedAt: e.at - 1000, endedAt: null }, lastError: null };
  assert.equal(markTurnFailed(rt, e), true);
  assert.equal(rt.turn.endedAt, e.at);
  assert.equal(rt.lastError.via, 'transcript');
  assert.equal(markTurnFailed(rt, e), false); // 이미 끝난 턴
  const old = { turn: { startedAt: e.at + 5000, endedAt: null } };
  assert.equal(markTurnFailed(old, e), false); // 앞 턴의 오류
});
