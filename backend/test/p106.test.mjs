// P106 시험: herdr가 받지 않는 전달(agent_not_found·agent_not_ready·agent_blocked·unreachable)은 물러나며 다시 보내고(0.5초에서 30초까지),
// 같은 까닭이 이어지는 동안 이벤트를 쓰지 않으며, 막힌 전달도 취소할 수 있다. 오래 막히면 알린다. 이름을 잃은 에이전트에는 이름을 다시 붙이거나 패널로 보낸다.
// 시작 중에 보낸 첫 요청: 입력 칸을 못 읽거나 아직 뜨는 중이면 포기하지 않고 다시 보며, 글이 남았으면 Enter 한 번(Codex도), 두 번 들어가지 않게.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeliveryQueue, retryDelay } from '../src/delivery.mjs';
import { codexInputBox, promptOnScreen } from '../src/screen.mjs';
import { Store } from '../src/store.mjs';
import { Backend } from '../src/backend.mjs';

const cfg = { submitConfirmMs: 30000, deliveryMaxWaitMs: 900000, inputQuietMs: 3000, submitRetryMs: 6000, submitRetries: 2 };
const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const fakeStore = () => ({ rows: new Map(), writes: 0, activeDeliveries: () => [], insertDelivery(d) { this.rows.set(d.deliveryId, { ...d }); }, updateDelivery(id, p) { this.writes++; const r = this.rows.get(id) || {}; Object.assign(r, { status: p.status, reason: p.reason ?? null }); if (p.attempt) r.attempts = (r.attempts || 0) + 1; }, getDelivery(id) { return this.rows.get(id) || null; } });
const err = (code) => Object.assign(new Error(code), { code });
const ASK = 'Reply with the single word ok-w1 and do nothing else.';

// herdr 흉내: refuse가 오류 코드를 주면 받지 않는다. events는 대기열이 낸 delivery 이벤트(판 기록에 쓰이는 것)
function rig(t, { refuse = () => null, view = {}, look = null, opts = {} } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const log = { tries: 0, sent: [], enter: 0, inspect: 0, recover: [], events: [], refused: [], stuck: [] };
  const v = { state: 'ready', agentPresent: true, herdrConnected: true, closed: false, lastUserInputAt: 0, ...view };
  const store = fakeStore();
  const q = new DeliveryQueue({
    store, cfg: { ...cfg, ...opts }, view: () => v,
    send: async (sid, text) => { log.tries++; const c = refuse(); if (c) throw err(c); log.sent.push(text); },
    ...(look ? { inspect: async () => { log.inspect++; return look(); }, pressEnter: async () => { log.enter++; } } : {}),
  });
  q.on('delivery', (d) => log.events.push(`${d.status}${d.reason ? `(${d.reason})` : ''}`));
  q.on('recover', (r) => log.recover.push(r.action));
  q.on('refused', (r) => log.refused.push(r.code));
  q.on('stuck', (r) => log.stuck.push(r));
  const step = async (ms) => { t.mock.timers.tick(ms); q.pump(); await tick(); };
  return { q, log, v, store, step };
}

test('P106 물러남 간격: 0.5초에서 두 배씩 늘고 30초에서 멈춘다(설정으로 바꿀 수 있다)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => retryDelay(n)), [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  assert.equal(retryDelay(3, { deliveryBackoffMs: 100, deliveryBackoffMaxMs: 300 }), 300);
});

test('P106 고치기 전에는 1ms마다 돌던 거부(agent_not_found)가 7분에 수십 번 이하로 줄고, 이벤트는 처음 한 번만 쓴다. 시도 수는 센다', async (t) => {
  const { q, log, store, step } = rig(t, { refuse: () => 'agent_not_found' });
  const d = q.enqueue('s', ASK);
  await tick();
  assert.equal(d.status, 'queued'); assert.equal(d.reason, 'no_agent');
  assert.equal(log.tries, 1);
  await step(400);
  assert.equal(log.tries, 1, '0.5초 전에는 다시 보내지 않는다');
  for (let i = 0; i < 7 * 60 * 10; i++) await step(100); // 7분, 100ms마다 pump(백엔드는 상태를 보낼 때마다 pump를 부른다)
  assert.ok(log.tries >= 10 && log.tries <= 30, `7분 시도 ${log.tries}번`);
  t.diagnostic(`7분 시도 ${log.tries}번, delivery 이벤트 ${log.events.length}개, 저장 ${store.writes}번`);
  assert.deepEqual(log.events, ['queued', 'sending', 'queued(no_agent)'], '처음 한 번(보냄 → 거부)만 이벤트를 쓴다');
  assert.equal(d.attempts, log.tries, '시도 수는 센다');
  assert.equal(store.rows.get(d.deliveryId).attempts, log.tries, '저장된 시도 수');
  assert.equal(store.rows.get(d.deliveryId).status, 'queued');
  assert.deepEqual(log.refused, ['agent_not_found'], '백엔드 기록(로그)도 처음 한 번');
});

test('P106 까닭이 바뀌면 이벤트를 다시 쓰고, 에이전트가 준비되면(herdr 이벤트 → poke) 곧바로 보낸다', async (t) => {
  let code = 'agent_not_ready';
  const { q, log, step } = rig(t, { refuse: () => code });
  const d = q.enqueue('s', ASK);
  await tick();
  for (let i = 0; i < 40; i++) await step(1000); // 40초: 물러남이 16~30초에 닿는다
  const before = log.tries;
  code = 'agent_blocked'; // 승인 화면이 떴다
  q.poke('s'); await tick(); await step(0);
  assert.equal(log.tries, before + 1, 'poke면 기다리지 않고 바로 본다');
  assert.deepEqual(log.events.slice(-1), ['queued(waiting)'], '까닭이 바뀌었다');
  code = null; // 준비됐다
  await step(100);
  assert.equal(d.status, 'queued', 'poke가 없으면 물러난 시간을 지킨다');
  q.poke('s'); await tick(); await step(0);
  assert.equal(d.status, 'sent');
  assert.deepEqual(log.sent, [ASK]);
  assert.deepEqual(log.events.slice(-1), ['sent'], '거부 뒤의 조용한 시도는 sending을 쓰지 않고 sent만');
  assert.equal(d.refusals, 0); assert.equal(q.stuckOf('s'), null);
});

test('P106 사람이 같은 세션에 다시 보내면 물러나 있던 앞 전달을 바로 다시 본다(순서는 그대로)', async (t) => {
  let code = 'agent_not_found';
  const { q, log, step } = rig(t, { refuse: () => code });
  const d1 = q.enqueue('s', 'first');
  await tick();
  for (let i = 0; i < 20; i++) await step(1000);
  code = null;
  const tries = log.tries;
  const d2 = q.enqueue('s', 'second');
  await tick(); await step(0);
  assert.equal(log.tries, tries + 1);
  assert.equal(d1.status, 'sent'); assert.equal(d2.status, 'queued', '앞 전달이 확인되기 전에는 다음 것을 보내지 않는다');
  assert.deepEqual(log.sent, ['first']);
});

test('P106 취소: 막혀 물러난 전달은 대기 중에도, 조용히 다시 보내는 중(sending)에도 취소한다. 처음 보내는 순간은 끝난 뒤 판단한다', async (t) => {
  const { q, log, step } = rig(t, { refuse: () => 'agent_not_found' });
  const d = q.enqueue('s', ASK);
  await tick();
  assert.equal(q.cancel(d.deliveryId).status, 'cancelled');
  assert.deepEqual(log.events.slice(-1), ['cancelled(user)']);
  for (let i = 0; i < 5; i++) await step(1000);
  assert.equal(log.tries, 1, '취소한 뒤로는 보내지 않는다');

  // 조용한 다시 보내기가 herdr 응답을 기다리는 중(sending)에 취소: 그 시도가 끝나기를 기다렸다가 취소한다
  let release; let hold = false;
  const q2 = new DeliveryQueue({ store: fakeStore(), cfg, view: () => ({ state: 'ready', agentPresent: true, herdrConnected: true }), send: () => (hold ? new Promise((_, rej) => { release = () => rej(err('agent_not_found')); }) : Promise.reject(err('agent_not_found'))) });
  const d2 = q2.enqueue('s', ASK);
  await tick();
  hold = true; q2.poke('s'); q2.pump(); await tick();
  assert.equal(d2.status, 'sending');
  assert.equal(q2.cancel(d2.deliveryId).status, 'cancelled', '막혀 도는 전달의 시도 중에도 취소한다');
  release(); await tick();
  assert.equal(d2.status, 'cancelled', '늦게 온 거부가 대기열로 되돌리지 않는다');

  // 처음 보내는 짧은 순간(거부 없음): 시도가 끝나 들어갔으면 취소하지 않는다
  let ok;
  const q3 = new DeliveryQueue({ store: fakeStore(), cfg: { ...cfg, cancelWaitMs: 2000 }, view: () => ({ state: 'ready', agentPresent: true, herdrConnected: true }), send: () => new Promise((r) => { ok = r; }) });
  const d3 = q3.enqueue('s', ASK);
  await tick();
  assert.equal(d3.status, 'sending');
  assert.throws(() => q3.cancel(d3.deliveryId), (e) => e.code === 'not_cancellable');
  const c = assert.rejects(q3.cancelWait(d3.deliveryId), (e) => e.code === 'not_cancellable' && /sent/.test(e.message), '이미 들어갔다');
  ok(); await tick();
  await c;
  // 처음 시도가 거부되면 cancelWait가 그것을 기다려 취소한다
  let no;
  const q4 = new DeliveryQueue({ store: fakeStore(), cfg, view: () => ({ state: 'ready', agentPresent: true, herdrConnected: true }), send: () => new Promise((_, rej) => { no = () => rej(err('agent_not_ready')); }) });
  const d4 = q4.enqueue('s', ASK);
  await tick();
  const c4 = q4.cancelWait(d4.deliveryId);
  no(); await tick();
  assert.equal((await c4).status, 'cancelled');
});

test('P106 오래(20초) 받지 않으면 stuckOf가 까닭·시도 수를 주고 stuck을 한 번 알린다. 들어가면 내린다', async (t) => {
  let code = 'agent_not_found';
  const { q, log, step } = rig(t, { refuse: () => code });
  q.enqueue('s', ASK);
  await tick();
  await step(15000);
  assert.equal(q.stuckOf('s'), null);
  for (let i = 0; i < 30; i++) await step(1000);
  const st = q.stuckOf('s');
  assert.equal(st.reason, 'no_agent'); assert.equal(st.code, 'agent_not_found'); assert.ok(st.attempts >= 4);
  assert.equal(log.stuck.length, 1, '한 번만 알린다');
  code = null; q.poke('s'); await tick(); await step(0);
  assert.equal(q.stuckOf('s'), null);
});

test('P106 이름 잃은 에이전트: 판이 띄운 세션은 이름을 다시 붙여 보내고, 못 붙이면 그 패널(같은 종류)로 보낸다. 종류가 다르면 그대로 거부', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p106-'));
  const b = new Backend({ quietMs: 600000, port: 0, logDir: dir, sessionsDir: path.join(dir, 'sessions'), claudeJson: path.join(dir, 'none.json'), claudeCommand: 'claude', hookTimeoutSec: 2 });
  b.store = new Store(path.join(dir, 'board.db'));
  b.sessions = new Map();
  const agents = new Map(); // 이름 → 패널
  const panes = new Map([['w1:p1', 'codex'], ['w2:p1', 'codex'], ['w3:p1', 'claude']]);
  const sent = [], renames = [];
  b.adapter = {
    getAgent: async (n) => (agents.has(n) ? { name: n, paneId: agents.get(n) } : null),
    getPane: async (p) => ({ paneId: p, agent: panes.get(p) || null }),
    renameAgent: async (t, n) => { renames.push([t, n]); agents.set(n, t); return { name: n, paneId: t }; },
    prompt: async (target, text) => { if (!agents.has(target) && !panes.has(target)) throw err('agent_not_found'); sent.push([target, text]); return {}; },
  };
  // 판이 띄운 Codex: 뜬 직후 herdr가 이름을 놓았다
  b.sessions.set('C1', { sessionId: 'C1', name: 'cx', agentName: 'cx', paneId: 'w1:p1', kind: 'codex', origin: 'board', rt: {} });
  await b.sendPrompt('C1', 'hi');
  assert.deepEqual(renames, [['w1:p1', 'cx']]); assert.deepEqual(sent, [['cx', 'hi']]);
  // 판에 올린 세션(이름을 다시 붙이지 않는다) → 패널 ID로
  b.sessions.set('A1', { sessionId: 'A1', name: 'ad', agentName: 'ad', paneId: 'w2:p1', kind: 'codex', origin: 'adopted', rt: {} });
  await b.sendPrompt('A1', 'yo');
  assert.deepEqual(sent.at(-1), ['w2:p1', 'yo']); assert.equal(renames.length, 1);
  // 다른 패널이 그 이름을 쓴다 → 이름은 그대로 두고 패널로
  agents.set('taken', 'w9:p1');
  b.sessions.set('C2', { sessionId: 'C2', name: 'taken', agentName: 'taken', paneId: 'w2:p1', kind: 'codex', origin: 'board', rt: {} });
  b.adapter.prompt = async (target, text) => { if (target === 'taken') throw err('agent_not_found'); sent.push([target, text]); return {}; };
  await b.sendPrompt('C2', 'z');
  assert.deepEqual(sent.at(-1), ['w2:p1', 'z']); assert.equal(renames.length, 1);
  // 패널의 에이전트 종류가 다르다(그 패널에 다른 것이 떴다) → 보내지 않는다
  b.sessions.set('C3', { sessionId: 'C3', name: 'k', agentName: 'k', paneId: 'w3:p1', kind: 'codex', origin: 'adopted', rt: {} });
  b.adapter.prompt = async () => { throw err('agent_not_found'); };
  await assert.rejects(() => b.sendPrompt('C3', 'q'), (e) => e.code === 'agent_not_found');
  // 이름 없는 에이전트(패널 ID로 부름)는 전처럼 그대로
  b.sessions.set('C4', { sessionId: 'C4', name: 'p', agentName: 'w2:p1', paneId: 'w2:p1', kind: 'codex', origin: 'adopted', rt: {} });
  await assert.rejects(() => b.sendPrompt('C4', 'q'), (e) => e.code === 'agent_not_found');
  b.store.close();
});

// ---------- 시작 중에 보낸 첫 요청 ----------
const RULE = '─'.repeat(40);
const claudeScreen = (box) => ['▐▛███▛█   Claude Code', '', RULE, `❯ ${box}`, RULE, '  ⏸ manual mode on'].join('\n');
const codexScreen = (box, above = []) => ['>_ OpenAI Codex', '', ...above, '', `› ${box}`, '', '  model-x default · C:\\repo', '  ? for shortcuts'].join('\n');

test('P106 Codex 입력 칸: 마지막 › 줄과 이어지는 들여 쓴 줄, 안내 글은 빈 칸, 위에 보낸 글이 보이면 seen', () => {
  assert.equal(codexInputBox(codexScreen(ASK)).text, ASK);
  assert.equal(promptOnScreen(codexScreen(ASK), ASK, 'codex').box, 'ours');
  assert.equal(promptOnScreen(codexScreen('Ask Codex to do anything'), ASK, 'codex').box, 'empty');
  assert.equal(promptOnScreen(codexScreen('사람이 쓰는 글'), ASK, 'codex').box, 'other');
  assert.equal(promptOnScreen('Loading…', ASK, 'codex').box, 'unknown');
  const wrapped = ['', `› ${ASK.slice(0, 25)}`, `  ${ASK.slice(25)}`, '', '  model-x default'].join('\n');
  assert.equal(promptOnScreen(wrapped, ASK, 'codex').box, 'ours', '화면 폭에서 꺾인 글');
  assert.deepEqual(promptOnScreen(codexScreen('Ask Codex to do anything', [`› ${ASK}`, '', '• ok-w1']), ASK, 'codex'), { box: 'empty', seen: true });
  assert.equal(promptOnScreen(codexScreen('[Pasted Content 1200 chars]'), 'x'.repeat(1200), 'codex').box, 'ours');
});

test('P106 첫 요청: 확인이 3초 늦고 입력 칸에 글이 남았으면 Enter 한 번(Claude Code), 다시 보내지 않는다', async (t) => {
  const { q, log, step } = rig(t, { look: () => promptOnScreen(claudeScreen(ASK), ASK) });
  const d = q.enqueue('s', ASK);
  await tick();
  await step(3100);
  assert.equal(log.enter, 1);
  q.onUserPromptSubmit('s', ASK);
  assert.equal(d.status, 'confirmed');
  assert.deepEqual(log.sent, [ASK], '글은 한 번만 들어갔다');
});

test('P106 첫 요청: 아직 뜨는 중(starting)이거나 입력 칸을 못 읽으면 포기하지 않고 기다렸다가, 입력 칸에 글이 보이면 Enter 한 번', async (t) => {
  let screen = 'Claude Code 시작 중…';
  const { q, log, v, step } = rig(t, { look: () => promptOnScreen(screen, ASK), view: { state: 'starting' } });
  const d = q.enqueue('s', ASK);
  await tick();
  assert.equal(d.status, 'queued', '뜨는 중에는 보내지 않는다(B1 규칙 3)');
  v.state = 'ready'; await step(0); // herdr idle이 너무 일러 Enter가 버려진다
  assert.equal(d.status, 'sent');
  v.state = 'starting'; // herdr가 다시 알아보는 중
  for (let i = 0; i < 40; i++) await step(1000);
  assert.equal(log.inspect, 0, '뜨는 중에는 화면을 보지 않고 기다린다');
  assert.equal(d.status, 'sent', '확인 못 함으로 끝내지 않는다');
  v.state = 'ready';
  for (let i = 0; i < 12; i++) await step(1000);
  assert.ok(log.inspect >= 2, '입력 칸을 못 읽어도 다시 본다');
  assert.equal(log.enter, 0); assert.equal(d.status, 'sent');
  assert.ok(log.recover.every((a) => a === 'wait'));
  screen = claudeScreen(ASK); // 입력 칸이 그려졌고 글이 남아 있다
  for (let i = 0; i < 4; i++) await step(1000);
  assert.equal(log.enter, 1, 'Enter 한 번');
  assert.deepEqual(log.sent, [ASK], '글은 한 번만');
  q.onUserPromptSubmit('s', ASK);
  assert.equal(d.status, 'confirmed');
});

test('P106 첫 요청(Codex, hook 없음): herdr working이 늦고 입력 칸에 글이 남았으면 Enter. 비었으면 다시 보내지 않고 확인 못 함', async (t) => {
  const { q, log, step } = rig(t, { look: () => ({ ...promptOnScreen(codexScreen(ASK), ASK, 'codex'), noResend: true }) });
  const d = q.enqueue('s', ASK);
  await tick();
  await step(3100);
  assert.equal(log.enter, 1);
  q.onAgentWorking('s');
  assert.equal(d.status, 'confirmed');
  t.mock.timers.reset();

  const r2 = rig(t, { look: () => ({ ...promptOnScreen(codexScreen('Ask Codex to do anything'), ASK, 'codex'), noResend: true }) });
  const d2 = r2.q.enqueue('s', ASK);
  await tick();
  for (let i = 0; i < 80; i++) await r2.step(1000);
  assert.deepEqual(r2.log.sent, [ASK], 'Codex에는 다시 보내지 않는다(두 번 들어가지 않게)');
  assert.equal(r2.log.enter, 0);
  assert.equal(d2.status, 'unconfirmed');
});

test('P106 첫 요청: 처음 볼 때 입력 칸에 다른 것(빈 칸의 추천 글 등)이 보여도 포기하지 않고, 붙여 넣은 글이 늦게 그려지면 Enter 한 번', async (t) => {
  let screen = claudeScreen('Try "fix lint errors"');
  assert.equal(promptOnScreen(screen, ASK).box, 'empty', '빈 칸의 흐린 추천 글은 빈 칸');
  screen = claudeScreen('Reply');
  const { q, log, step } = rig(t, { look: () => promptOnScreen(screen, ASK) });
  const d = q.enqueue('s', ASK);
  await tick();
  await step(3100);
  assert.deepEqual(log.recover, ['wait'], '반쯤 그려진 글(other)에는 손대지 않고 다시 본다');
  screen = claudeScreen(ASK);
  await step(3100);
  assert.equal(log.enter, 1);
  assert.deepEqual(log.sent, [ASK]);
  q.onUserPromptSubmit('s', ASK);
  assert.equal(d.status, 'confirmed');
});

test('P106 첫 요청: 입력 칸이 비었으면 다시 보내기는 6초 뒤에만, 한 번만(hook이 늦게 오는 때 두 번 들어가지 않게)', async (t) => {
  const { q, log, step } = rig(t, { look: () => ({ box: 'empty', seen: false }) });
  const d = q.enqueue('s', ASK);
  await tick();
  await step(3100);
  assert.deepEqual(log.sent, [ASK], '3초에는 기다린다');
  q.onUserPromptSubmit('s', ASK); // hook이 늦게 왔다
  assert.equal(d.status, 'confirmed');
  assert.deepEqual(log.sent, [ASK]);
});
