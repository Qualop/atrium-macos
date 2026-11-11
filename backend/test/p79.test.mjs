// P79 시험: 하위 세션의 첫 요청이 사라지지 않게. 보낸 글이 입력 칸에 남았으면 Enter, 비었으면 한 번 다시 보내기,
// 같은 글이 두 번 들어가지 않게, 사람이 치는 중이면 기다리기, 끝내 못 넣으면 부모에게 알리기. 화면 입력 칸 읽기.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryQueue } from '../src/delivery.mjs';
import { claudeInputBox, promptOnScreen } from '../src/screen.mjs';
import { Branch } from '../src/branch.mjs';

const cfg = { submitConfirmMs: 30000, deliveryMaxWaitMs: 900000, inputQuietMs: 3000, submitRetryMs: 6000, submitRetries: 2 };
const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const fakeStore = () => ({ rows: new Map(), activeDeliveries: () => [], insertDelivery(d) { this.rows.set(d.deliveryId, { ...d }); }, updateDelivery(id, p) { Object.assign(this.rows.get(id) || {}, p); }, getDelivery(id) { return this.rows.get(id) || null; } });
const RULE = '─'.repeat(40);
const screen = (box, above = ['▐▛███▛█   Claude Code', '', ' C:\\repo\\.claude\\worktrees\\w1']) => [...above, RULE, `❯ ${box}`, RULE, '  Haiku (medium)', '  ⏸ manual mode on'].join('\n');
const ASK = 'Reply with the single word ok-w1 and do nothing else.';

// 대기열 하나: 보내기·화면·Enter를 기록한다. look()이 화면 판정을 정한다
function rig(t, { look = () => ({ box: 'ours', seen: false }), view = {} } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const log = { sent: [], enter: 0, inspect: 0, recover: [] };
  const v = { state: 'ready', agentPresent: true, herdrConnected: true, closed: false, lastUserInputAt: 0, ...view };
  const q = new DeliveryQueue({
    store: fakeStore(), cfg, view: () => v,
    send: async (sid, text) => { log.sent.push(text); },
    inspect: async () => { log.inspect++; return look(); },
    pressEnter: async () => { log.enter++; },
  });
  q.on('recover', (r) => log.recover.push(r.action));
  const step = async (ms) => { t.mock.timers.tick(ms); q.pump(); await tick(); };
  return { q, log, v, step };
}

// ---------- 화면 ----------
test('P79 화면: 입력 칸(가로줄 둘 사이 ❯ 줄)을 읽고, 보낸 글이 남았는지·비었는지·다른 글인지·이미 위에 보이는지 가린다', () => {
  assert.deepEqual(claudeInputBox(screen(ASK)).text, ASK);
  assert.equal(promptOnScreen(screen(ASK), ASK).box, 'ours');
  assert.equal(promptOnScreen(screen(ASK).replace('❯ ', '❯ '), ASK).box, 'ours', '실제 화면은 ❯ 뒤가 줄바꿈 없는 빈칸(U+00A0)이다');
  assert.equal(promptOnScreen(screen(''), ASK).box, 'empty');
  assert.equal(promptOnScreen(screen('사람이 쓰는 글'), ASK).box, 'other');
  assert.equal(promptOnScreen('Claude Code 시작 중…', ASK).box, 'unknown', '입력 칸이 아직 없다');
  const after = promptOnScreen(screen('', ['> ' + ASK, '', '● ok-w1']), ASK);
  assert.deepEqual(after, { box: 'empty', seen: true }, '이미 들어가 위에 보인다');
  // 긴 글은 입력 칸에서 접혀 보인다
  const long = 'line one of a long task\n' + 'x'.repeat(400);
  assert.equal(promptOnScreen(screen('[Pasted text #1 +3 lines]'), long).box, 'ours');
  // 화면 폭에서 꺾인 글
  const wrapped = [RULE, `❯ ${ASK.slice(0, 30)}`, `  ${ASK.slice(30)}`, RULE].join('\n');
  assert.equal(promptOnScreen(wrapped, ASK).box, 'ours');
});

// ---------- 대기열 ----------
test('P79 Enter: 보낸 글이 입력 칸에 남았으면(제출 안 됨) Enter를 한 번 누르고, hook이 오면 확인. 다시 보내지 않는다', async (t) => {
  const { q, log, step } = rig(t);
  const d = q.enqueue('s', ASK);
  await tick();
  assert.equal(d.status, 'sent');
  await step(2500);
  assert.equal(log.inspect, 0, '3초 전에는 보지 않는다(P106: 입력 칸에 남은 글의 Enter는 submitEnterMs 3초 뒤)');
  await step(1000);
  assert.equal(log.enter, 1);
  assert.deepEqual(log.recover, ['enter']);
  q.onUserPromptSubmit('s', ASK);
  assert.equal(d.status, 'confirmed');
  assert.deepEqual(log.sent, [ASK], '한 번만 보냈다');
});

test('P79 다시 보내기: 입력 칸이 비었고 들어간 흔적도 없으면 한 번만 다시 보낸다(두 번째부터는 다시 보내지 않는다), 끝내 안 되면 unconfirmed', async (t) => {
  const { q, log, step } = rig(t, { look: () => ({ box: 'empty', seen: false }) });
  const d = q.enqueue('s', ASK);
  await tick();
  await step(6500);
  assert.deepEqual(log.sent, [ASK], 'P106: 앞 번에도 비어 있었을 때만 다시 보낸다(그리기가 늦을 수 있다)');
  await step(3100);
  assert.deepEqual(log.sent, [ASK, ASK], '한 번 다시 보냈다');
  await step(6500);
  assert.deepEqual(log.sent, [ASK, ASK], '두 번째 손쓰기에서는 다시 보내지 않는다');
  assert.deepEqual(log.recover, ['wait', 'resend', 'none']);
  await step(29000);
  assert.equal(d.status, 'sent', '마지막 손쓰기에서 30초를 다시 센다');
  await step(2000);
  assert.equal(d.status, 'unconfirmed');
  assert.match(d.reason, /no UserPromptSubmit hook/);
});

test('P79 두 번 들어가지 않기: 입력 칸이 비었어도 위에 보낸 글이 보이거나(이미 들어감) 다른 글의 hook을 봤으면 다시 보내지 않는다', async (t) => {
  for (const [why, look, before] of [
    ['위에 보임', () => ({ box: 'empty', seen: true }), () => {}],
    ['다른 hook', () => ({ box: 'empty', seen: false }), (q) => q.onUserPromptSubmit('s', '다른 글')],
  ]) {
    const { q, log, step } = rig(t, { look });
    const d = q.enqueue('s', ASK);
    await tick();
    before(q);
    await step(6500);
    await step(6500);
    assert.deepEqual(log.sent, [ASK], why);
    q.onUserPromptSubmit('s', ASK);
    assert.equal(d.status, 'confirmed', why);
    t.mock.timers.reset();
  }
});

test('P79 사람 입력: 사람이 3초 안에 친 터미널은 기다리고, 입력 칸에 다른 글(사람의 글)이 있으면 손대지 않는다', async (t) => {
  const { q, log, v, step } = rig(t, { look: () => ({ box: 'other', seen: false }) });
  const d = q.enqueue('s', ASK);
  await tick();
  v.lastUserInputAt = Date.now() + 6000; // 보낸 뒤 6초에 사람이 친다
  await step(6500);
  assert.equal(log.inspect, 0, '사람이 친 지 3초가 안 됐다');
  await step(3000);
  assert.equal(log.inspect, 1);
  assert.equal(log.enter, 0); assert.deepEqual(log.sent, [ASK], '사람의 글을 건드리지 않는다');
  for (let i = 0; i < 70; i++) await step(1000);
  assert.ok(log.inspect > 1, 'P106: 갓 뜬 화면은 붙여 넣은 글을 늦게 그리므로 다시 보기는 한다');
  assert.equal(log.enter, 0); assert.deepEqual(log.sent, [ASK], '다른 글에는 끝내 손대지 않는다');
  assert.equal(d.status, 'unconfirmed');
});

test('P79 일하는 중이면(working) 손대지 않고 확인을 기다린다. inspect가 없으면 전처럼 30초 뒤 unconfirmed', async (t) => {
  const { q, log, step } = rig(t, { view: { state: 'working' } });
  q.enqueue('s', ASK);
  await tick();
  await step(13000);
  assert.equal(log.inspect, 0);
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const sent = [];
  const plain = new DeliveryQueue({ store: fakeStore(), cfg, view: () => ({ state: 'ready', agentPresent: true, herdrConnected: true, closed: false }), send: async (s, x) => sent.push(x) });
  const d = plain.enqueue('s', ASK);
  await tick();
  t.mock.timers.tick(30500); plain.pump();
  assert.equal(d.status, 'unconfirmed');
  assert.deepEqual(sent, [ASK]);
});

// ---------- 부모에게 알리기 ----------
function branchRig() {
  const events = [], enq = [], linkEv = [];
  const rows = new Map();
  const b = {
    sessions: new Map(),
    store: { getDelivery: (id) => rows.get(id) || null, addEvent: (sid, kind, data) => events.push({ sid, kind, data }), getBranch: () => null, branchRows: () => [] },
    queue: { enqueue: (sid, text) => { enq.push({ sid, text }); return { deliveryId: 'n' + enq.length }; } },
    ensureLink: (from, to) => ({ linkId: `${from}>${to}` }),
    linkEvent: (l, kind, text, data) => linkEv.push({ l: l.linkId, kind, data }),
    log: () => {},
  };
  const br = Object.create(Branch.prototype);
  br.b = b; br.info = new Map(); br.firstOf = new Map(); br.lost = new Map();
  b.sessions.set('lead', { sessionId: 'lead', name: 'lead', agentName: 'lead' });
  b.sessions.set('w1', { sessionId: 'w1', name: 'w1', agentName: 'w1', parentSessionId: 'lead' });
  return { b, br, rows, events, enq, linkEv };
}

test('P79 부모에게 알리기: 첫 요청이 unconfirmed·failed로 끝나면 판 이벤트와 부모에게 그 사실·다시 보낼 명령. 한 번만, 확인되면 알리지 않는다', () => {
  const { br, rows, events, enq, linkEv } = branchRig();
  rows.set('d1', { deliveryId: 'd1', text: ASK });
  br.firstOf.set('d1', 'w1');
  br.onDeliveryEnd({ deliveryId: 'd1', status: 'unconfirmed', reason: 'no UserPromptSubmit hook (enter · ours)' });
  assert.equal(events.filter((e) => e.kind === 'first_prompt_lost').length, 1);
  assert.equal(enq.length, 1);
  assert.equal(enq[0].sid, 'lead');
  assert.match(enq[0].text, /@w1에게 보낸 첫 요청이 들어가지 않았다\(unconfirmed/);
  assert.match(enq[0].text, /herdr agent prompt w1 "<할 일>"/);
  assert.equal(linkEv[0].data.why, 'first prompt lost');
  assert.equal(br.lost.get('w1').status, 'unconfirmed', 'atrium children에 보인다');
  br.onDeliveryEnd({ deliveryId: 'd1', status: 'unconfirmed', reason: 'x' });
  assert.equal(enq.length, 1, '같은 전달은 한 번만 알린다');
  // 확인된 첫 요청과 첫 요청이 아닌 전달은 알리지 않는다
  br.firstOf.set('d2', 'w1');
  br.onDeliveryEnd({ deliveryId: 'd2', status: 'confirmed' });
  br.onDeliveryEnd({ deliveryId: 'd3', status: 'failed', reason: 'timeout' });
  assert.equal(enq.length, 1);
  assert.equal(br.lost.has('w1'), false, '다시 들어가면 표시를 내린다');
});
