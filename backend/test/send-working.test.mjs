// 2026-11-23 시험: 긴 턴을 하는 세션(working)에 보낸 글이 15분(deliveryMaxWaitMs) 뒤 "failed timeout (working)"으로 조용히 사라졌다
// (DesignSkill 밤샘 실행, 리드가 전체 검사를 하는 동안 지휘 세션이 보낸 두 글). 기한은 사람의 답(waiting)을 기다리는 몫이고(decisions B1 규칙 2),
// 일하는 중인 시간은 넣지 않는다. 턴이 끝나면(ready) 보낸다. atrium send --now는 일하는 중인 Claude Code의 대기 메시지로 바로 넣고,
// 끝내 못 들어간 글은 보낸 세션(--from, 판 세션 안에서는 ATRIUM_SESSION_ID)에 알린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryQueue, blockReason } from '../src/delivery.mjs';
import { Backend } from '../src/backend.mjs';

const MIN = 60 * 1000;
const cfg = { submitConfirmMs: 30000, deliveryMaxWaitMs: 15 * MIN, inputQuietMs: 3000, submitRetryMs: 6000, submitRetries: 2 };
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const fakeStore = () => ({ rows: new Map(), events: [], activeDeliveries: () => [], insertDelivery(d) { this.rows.set(d.deliveryId, { ...d }); }, updateDelivery(id, p) { Object.assign(this.rows.get(id) || {}, p); }, getDelivery(id) { return this.rows.get(id) || null; }, addEvent(sid, kind, data) { this.events.push({ sid, kind, data }); } });
const VIEW = { state: 'working', agentPresent: true, termConnected: true, closed: false, lastUserInputAt: 0, kind: 'claude', hooked: true };

function rig(t, view = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const sent = [];
  const v = { ...VIEW, ...view };
  const q = new DeliveryQueue({ store: fakeStore(), cfg, view: () => v, send: async (sid, text) => { sent.push(text); }, inspect: async () => ({ box: 'empty', seen: false }), pressEnter: async () => {} });
  // pump는 0.5초마다 돈다. 긴 시간은 30초 걸음으로 나눠 센다(일하는 시간을 그 사이사이에 센다)
  const pass = async (ms, step = 30000) => { for (let left = ms; left > 0; left -= step) { t.mock.timers.tick(Math.min(step, left)); q.pump(); await tick(); } };
  return { q, v, sent, pass };
}

test('일하는 중(working)인 세션에 보낸 글은 15분이 지나도 실패하지 않고, 턴이 끝나면 들어간다(밤샘 실행 재현)', async (t) => {
  const { q, v, sent, pass } = rig(t);
  const d = q.enqueue('lead', 'full check 결과를 정리해 줘');
  await tick();
  assert.equal(d.status, 'queued');
  assert.equal(d.reason, 'working');
  await pass(40 * MIN); // 리드가 40분짜리 전체 검사를 돈다
  assert.equal(d.status, 'queued', `고치기 전: failed timeout (working). 지금: ${d.status} ${d.reason}`);
  assert.equal(d.reason, 'working');
  assert.deepEqual(sent, []);
  assert.ok(q.waitedMs(d) < MIN, `일하는 시간은 기다린 시간에 넣지 않는다(${q.waitedMs(d)}ms)`);
  v.state = 'ready';
  await pass(500, 500);
  assert.deepEqual(sent, ['full check 결과를 정리해 줘']);
  assert.equal(d.status, 'sent');
});

test('사람의 답을 기다리는(waiting) 세션은 그대로 15분 뒤 failed timeout (waiting)', async (t) => {
  const { q, sent, pass } = rig(t, { state: 'waiting' });
  const d = q.enqueue('w', 'x');
  await pass(14 * MIN);
  assert.equal(d.status, 'queued');
  await pass(2 * MIN);
  assert.equal(d.status, 'failed');
  assert.equal(d.reason, 'timeout (waiting)');
  assert.deepEqual(sent, []);
});

test('일하는 시간만 빼고 센다: 30분 일하고 그 뒤 질문(waiting)에서 15분을 넘기면 실패한다', async (t) => {
  const { q, v, pass } = rig(t);
  const d = q.enqueue('w', 'x');
  await pass(30 * MIN);
  v.state = 'waiting';
  await pass(10 * MIN);
  assert.equal(d.status, 'queued', '일한 30분은 세지 않았다(질문 10분만)');
  assert.equal(d.reason, 'waiting');
  v.state = 'working'; // 사람이 답해 다시 일한다
  await pass(20 * MIN);
  assert.equal(d.status, 'queued');
  v.state = 'waiting';
  await pass(6 * MIN);
  assert.equal(d.status, 'failed', '질문 10분 + 6분 > 15분');
  assert.equal(d.reason, 'timeout (waiting)');
});

test('B1 판단은 그대로: working은 보내지 않는 이유다(Claude Code 자체 대기열과 섞지 않는다)', () => {
  assert.equal(blockReason(VIEW, Date.now(), cfg), 'working');
});

test('--now: 일하는 중인 Claude Code면 기다리지 않고 대기 메시지로 바로 넣는다(atrium prompt --now와 같은 길)', async (t) => {
  const { q, sent } = rig(t);
  const d = q.enqueue('lead', 'now 글', { typeNow: true, aside: true });
  await tick(8);
  assert.deepEqual(sent, ['now 글']);
  assert.equal(d.status, 'sent');
  assert.equal(d.reason, 'typed');
});

// 판(Backend.send·deliveryFailed)을 가짜로 띄운다
function fakeBoard(t) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const store = fakeStore();
  const mk = (sessionId, name, kind = 'claude') => ({ sessionId, name, kind, rt: {} });
  const lead = mk('S-lead', 'lead-ds'), boss = mk('S-boss', 'boss'), sh = mk('S-sh', 'sh', 'shell');
  const views = { 'S-lead': { ...VIEW }, 'S-boss': { ...VIEW, state: 'ready' } };
  const sent = [];
  const queue = new DeliveryQueue({ store, cfg, view: (sid) => views[sid] || { closed: true }, send: async (sid, text, o) => { sent.push({ sid, text, typeNow: !!(o && o.typeNow) }); }, inspect: async () => ({ box: 'empty', seen: false }), pressEnter: async () => {} });
  const b = {
    sessions: new Map([[lead.sessionId, lead], [boss.sessionId, boss], [sh.sessionId, sh]]),
    queue, store, features: null, killing: new Set(), logs: [],
    touch() {}, log(...a) { this.logs.push(a.join(' ')); }, nameOf(sid) { return (this.sessions.get(sid) || {}).name; },
  };
  for (const k of ['send', 'senderOf', 'noteSender', 'forgetSender', 'deliveryFailed']) b[k] = Backend.prototype[k].bind(b);
  queue.on('delivery', (d) => { if (d.status === 'failed') b.deliveryFailed(d); else if (['confirmed', 'unconfirmed', 'cancelled'].includes(d.status)) b.forgetSender(d.deliveryId); });
  return { b, store, queue, views, sent };
}

test('session.send {now}: 일하는 중인 리드에게 대기 메시지로 바로 넣는다', async (t) => {
  const { b, sent } = fakeBoard(t);
  const r = await b.send({ target: ['@lead-ds'], text: '지휘: 결과 보고해', now: true });
  await tick(8);
  assert.equal(r.deliveries.length, 1);
  assert.deepEqual(sent, [{ sid: 'S-lead', text: '지휘: 결과 보고해', typeNow: true }]);
});

test('session.send {from}: 끝내 못 들어간 글은 판 기록(delivery_failed)에 남고 보낸 세션에 알린다', async (t) => {
  const { b, store, queue, views, sent } = fakeBoard(t);
  views['S-lead'].state = 'waiting'; // 리드가 사람의 답을 기다리다 그대로 둔다
  views['S-boss'].state = 'working'; // 보낸 쪽은 일하는 중(알림은 턴이 끝나면 들어간다)
  const r = await b.send({ target: ['@lead-ds'], text: '지휘: 다음 단계로 가', from: 'boss' });
  assert.equal(r.deliveries[0].reason, 'waiting', '보낸 쪽에 기다리는 이유를 돌려준다(CLI가 안내를 붙인다)');
  for (let i = 0; i < 32; i++) { t.mock.timers.tick(30000); queue.pump(); await tick(); }
  const row = store.getDelivery(r.deliveries[0].deliveryId);
  assert.equal(row.status, 'failed');
  const ev = store.events.find((e) => e.kind === 'delivery_failed');
  assert.ok(ev, '판 기록');
  assert.equal(ev.data.reason, 'timeout (waiting)');
  assert.equal(ev.data.from, 'boss');
  const notice = queue.list('S-boss')[0];
  assert.ok(notice, '보낸 세션의 대기열에 알림');
  assert.match(notice.text, /^\[Atrium 보드\] @lead-ds에게 보낸 글이 들어가지 않았다\(timeout \(waiting\)/);
  assert.match(notice.text, /지휘: 다음 단계로 가/);
  assert.match(notice.text, /atrium prompt lead-ds/);
  assert.equal(notice.reason, 'working', '보낸 쪽이 일하는 중이면 턴이 끝날 때까지 기다린다(기한에 넣지 않는다)');
  views['S-boss'].state = 'ready';
  t.mock.timers.tick(500); queue.pump(); await tick();
  assert.equal(sent.at(-1).sid, 'S-boss');
});

test('알리지 않는 경우: 보낸 세션을 모를 때, 들어갔을 때, 판 알림이 못 들어갔을 때(알림이 돌지 않게), 보낸 쪽이 셸일 때', async (t) => {
  const { b, store, queue, views } = fakeBoard(t);
  views['S-lead'].state = 'waiting';
  views['S-boss'].state = 'waiting';
  await b.send({ target: ['@lead-ds'], text: '모르는 보낸 쪽' });
  await b.send({ target: ['@lead-ds'], text: '셸에서 보냄', from: 'sh' });
  const n = await b.send({ target: ['@boss'], text: '[Atrium 보드] 알림', from: 'lead-ds' });
  for (let i = 0; i < 32; i++) { t.mock.timers.tick(30000); queue.pump(); await tick(); }
  assert.equal(store.events.filter((e) => e.kind === 'delivery_failed').length, 3, '판 기록에는 모두 남는다');
  assert.equal(store.events.filter((e) => e.kind === 'delivery_failed_notice').length, 0);
  assert.equal(store.getDelivery(n.deliveries[0].deliveryId).status, 'failed');
  assert.equal(queue.list('S-boss').length, 0);
  assert.equal(queue.list('S-lead').length, 0);
  assert.equal(b.senderOf('sh'), null);
  assert.equal(b.senderOf('없는이름'), null);
  assert.equal(b.senderOf('S-boss').name, 'boss', '세션 ID로도 찾는다(ATRIUM_SESSION_ID)');
});
