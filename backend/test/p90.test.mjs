// P90 시험: 휴대폰 입력 줄의 "일하는 중이면 바로 넣기". Claude Code가 working이면 판 대기열에서 기다리지 않고 바로 agent.prompt로 넣어
// Claude Code가 대기 메시지로 받게 한다. waiting·trust_wait·ready·셸·다른 종류·hook 없는 세션은 B1 그대로. 입력 칸에 쓰던 글이 있으면 넣지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryQueue, canTypeNow, typedText, blockReason } from '../src/delivery.mjs';
import { claudeInputBox, promptOnScreen } from '../src/screen.mjs';

const cfg = { submitConfirmMs: 30000, deliveryMaxWaitMs: 900000, inputQuietMs: 3000, submitRetryMs: 6000, submitRetries: 2 };
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const fakeStore = () => ({ rows: new Map(), activeDeliveries: () => [], insertDelivery(d) { this.rows.set(d.deliveryId, { ...d }); }, updateDelivery(id, p) { Object.assign(this.rows.get(id) || {}, p); }, getDelivery(id) { return this.rows.get(id) || null; } });
const RULE = '─'.repeat(40);
const WORKING = { state: 'working', agentPresent: true, herdrConnected: true, closed: false, lastUserInputAt: 0, kind: 'claude', hooked: true };

function rig(t, { look = () => ({ box: 'empty', seen: false }), view = {}, send = null } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const log = { sent: [], enter: 0, inspect: 0, events: [] };
  const v = { ...WORKING, ...view };
  const q = new DeliveryQueue({
    store: fakeStore(), cfg, view: () => v,
    send: send || (async (sid, text) => { log.sent.push(text); }),
    inspect: async () => { log.inspect++; return look(); },
    pressEnter: async () => { log.enter++; },
  });
  q.on('delivery', (d) => log.events.push(`${d.status}${d.reason ? ':' + d.reason : ''}`));
  const step = async (ms) => { t.mock.timers.tick(ms); q.pump(); await tick(); };
  return { q, log, v, step };
}

test('P90 판단: 판이 띄운 Claude Code(hook 있음)가 working일 때만 바로 넣는다', () => {
  assert.equal(canTypeNow(WORKING), true);
  for (const state of ['waiting', 'trust_wait', 'ready', 'starting', 'error', 'exited', 'sleeping']) assert.equal(canTypeNow({ ...WORKING, state }), false, state);
  assert.equal(canTypeNow({ ...WORKING, kind: 'shell' }), false, '셸');
  assert.equal(canTypeNow({ ...WORKING, kind: 'codex' }), false, '다른 종류');
  assert.equal(canTypeNow({ ...WORKING, hooked: false }), false, 'hook 없는(판에 올린) Claude Code: 제출 확인을 할 수 없다');
  assert.equal(canTypeNow({ ...WORKING, herdrConnected: false }), false);
  assert.equal(canTypeNow({ ...WORKING, agentPresent: false }), false);
  assert.equal(canTypeNow({ ...WORKING, closed: true }), false);
  assert.equal(canTypeNow(null), false);
  assert.equal(blockReason(WORKING, Date.now(), cfg), 'working', 'B1 판단은 그대로(PC 명령 바)');
});

test('P90 넣는 글: 줄바꿈은 LF, 끝 줄바꿈은 떼고, Enter는 agent.prompt가 마지막에 한 번', () => {
  assert.equal(typedText('line 1\r\nline 2\rline 3\n\n'), 'line 1\nline 2\nline 3');
  assert.equal(typedText('one line'), 'one line');
  assert.equal(typedText('  keep inner\n\n  blank\n'), '  keep inner\n\n  blank');
});

test('P90 입력 칸: 대기 메시지가 있을 때의 안내 글은 빈 칸이다', () => {
  const s = ['❯ P90 queued note', '  ctrl+enter to send now', '✻ Considering… (13s)', RULE, '❯ Press up to edit queued messages', RULE, '  Haiku'].join('\n');
  assert.equal(claudeInputBox(s).text, '');
  assert.deepEqual(promptOnScreen(s, 'P90 queued note'), { box: 'empty', seen: true });
});

test('P90 working: 입력 칸이 비었으면 바로 한 번 넣고(여러 줄 그대로, CR 없음) hook이 오면 확인. 전달 기록의 이유는 typed', async (t) => {
  const { q, log } = rig(t);
  const d = q.enqueue('s', 'first line\r\nsecond line\n', { typeNow: true });
  await tick();
  assert.deepEqual(log.sent, ['first line\nsecond line'], '한 번, LF, 끝 줄바꿈 없음');
  assert.equal(log.inspect, 1, '넣기 전에 입력 칸을 한 번 본다');
  assert.equal(d.status, 'sent');
  assert.equal(d.reason, 'typed');
  q.onUserPromptSubmit('s', 'first line\nsecond line');
  assert.equal(d.status, 'confirmed');
  assert.equal(d.reason, 'typed');
  assert.deepEqual(log.events, ['queued', 'sending:typed', 'sent:typed', 'confirmed:typed']);
  assert.equal(log.enter, 0, 'Enter를 따로 누르지 않는다');
});

test('P90 working: 사람이 쓰던 글이 입력 칸에 있으면 덮지 않고 기다리다가, 비면 넣는다', async (t) => {
  let box = 'other';
  const { q, log, step } = rig(t, { look: () => ({ box, seen: false }) });
  const d = q.enqueue('s', 'from phone', { typeNow: true });
  await tick();
  assert.deepEqual(log.sent, []);
  assert.equal(d.status, 'queued');
  assert.equal(d.reason, 'draft');
  await step(500);
  assert.equal(log.inspect, 1, '화면은 1.5초에 한 번만 읽는다');
  box = 'empty';
  await step(1500);
  assert.deepEqual(log.sent, ['from phone']);
  assert.equal(d.reason, 'typed');
});

test('P90 working: 입력 칸을 못 읽으면(대화상자 등) 넣지 않고, 사람이 3초 안에 쳤으면 화면도 보지 않고 기다린다', async (t) => {
  const a = rig(t, { look: () => ({ box: 'unknown', seen: false }) });
  const d = a.q.enqueue('s', 'x', { typeNow: true });
  await tick();
  assert.deepEqual(a.log.sent, []);
  assert.equal(d.reason, 'working');
  t.mock.timers.reset();
  const b = rig(t, { view: { lastUserInputAt: 1_000_000 - 1000 } });
  const e = b.q.enqueue('s', 'y', { typeNow: true });
  await tick();
  assert.deepEqual(b.log.sent, []);
  assert.equal(b.log.inspect, 0);
  assert.equal(e.reason, 'user_typing');
});

test('P90 권한·질문·신뢰 화면에서는 바로 넣지 않고 대기열에 둔다. 풀려서 ready가 되면 B1로 보낸다', async (t) => {
  const { q, log, v, step } = rig(t, { view: { state: 'waiting' } });
  const d = q.enqueue('s', 'later', { typeNow: true });
  await tick();
  assert.deepEqual(log.sent, []);
  assert.equal(log.inspect, 0, '대화상자 화면은 읽지도 않는다');
  assert.equal(d.reason, 'waiting');
  v.state = 'trust_wait';
  await step(2000);
  assert.equal(d.reason, 'trust_wait');
  assert.deepEqual(log.sent, []);
  v.state = 'ready';
  await step(2000);
  assert.deepEqual(log.sent, ['later']);
  assert.equal(d.reason, null, 'ready에서는 보통 전달(typed 아님)');
});

test('P90 넣는 사이 권한 화면이 뜨면 herdr가 거부(agent_blocked)하고 대기열에 남는다', async (t) => {
  const { q } = rig(t, { send: async () => { throw Object.assign(new Error('blocked'), { code: 'agent_blocked' }); } });
  const d = q.enqueue('s', 'z', { typeNow: true });
  await tick();
  assert.equal(d.status, 'queued');
  assert.equal(d.reason, 'waiting');
});

test('P90 PC 명령 바(typeNow 없음), 셸·다른 종류·hook 없는 세션은 working이면 지금처럼 기다린다', async (t) => {
  for (const view of [{}, { kind: 'shell' }, { kind: 'codex' }, { hooked: false }]) {
    const typeNow = Object.keys(view).length > 0;
    const { q, log } = rig(t, { view });
    const d = q.enqueue('s', 'wait', typeNow ? { typeNow } : {});
    await tick();
    assert.deepEqual(log.sent, [], JSON.stringify(view));
    assert.equal(log.inspect, 0);
    assert.equal(d.reason, 'working');
    t.mock.timers.reset();
  }
});

test('P90 앞에 기다리는 보통 전달이 있으면 순서를 지킨다(휴대폰 글이 앞지르지 않는다)', async (t) => {
  const { q, log } = rig(t);
  const a = q.enqueue('s', 'from pc bar');
  const b = q.enqueue('s', 'from phone', { typeNow: true });
  await tick();
  assert.deepEqual(log.sent, []);
  assert.equal(a.reason, 'working');
  assert.equal(b.status, 'queued');
});
