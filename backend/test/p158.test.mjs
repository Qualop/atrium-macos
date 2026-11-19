// P158 시험: 판 칩의 "수정". 대기 중(queued)인 전달만 붙잡고(hold) 고칠 수 있다(update). 붙잡은 동안 그 세션에는 보내지 않고(뒤 전달도 차례를 지킨다),
// 놓으면(update·release) 차례대로 다시 보낸다. 이미 보낸 뒤에는 already_sent로 거절한다. 오래 놓지 않으면 저절로 놓는다
import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryQueue } from '../src/delivery.mjs';

const cfg = { submitConfirmMs: 30000, deliveryMaxWaitMs: 900000, inputQuietMs: 3000, submitRetryMs: 6000, submitRetries: 2 };
const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const fakeStore = () => ({
  rows: new Map(), texts: [], activeDeliveries: () => [],
  insertDelivery(d) { this.rows.set(d.deliveryId, { ...d }); },
  updateDelivery(id, p) { const r = this.rows.get(id) || {}; Object.assign(r, { status: p.status, reason: p.reason ?? null }); },
  updateDeliveryText(id, text) { this.texts.push([id, text]); const r = this.rows.get(id); if (r) r.text = text; },
  getDelivery(id) { return this.rows.get(id) || null; },
});

function rig(t, view = {}, opts = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const v = { state: 'working', agentPresent: true, termConnected: true, closed: false, lastUserInputAt: 0, ...view };
  const sent = [], events = [];
  const store = fakeStore();
  const q = new DeliveryQueue({ store, cfg: { ...cfg, ...opts }, view: () => v, send: async (sid, text) => { sent.push(text); } });
  q.on('delivery', (d) => events.push(`${d.status}${d.reason ? `(${d.reason})` : ''}`));
  const step = async (ms = 500) => { t.mock.timers.tick(ms); q.pump(); await tick(); };
  return { q, v, sent, events, store, step };
}

test('P158 붙잡기: 대기 중 전달을 붙잡으면 세션이 한가해져도 보내지 않고, 고치면 차례 그대로 새 글이 간다', async (t) => {
  const { q, v, sent, events, store, step } = rig(t);
  const a = q.enqueue('s', 'first draft');
  const b = q.enqueue('s', 'second');
  await step();
  assert.equal(a.status, 'queued'); assert.equal(a.reason, 'working');
  const h = await q.holdWait(a.deliveryId);
  assert.equal(h.text, 'first draft', '붙잡으면 전체 글을 돌려준다');
  assert.equal(a.reason, 'editing');
  v.state = 'ready'; // 고치는 동안 세션이 한가해졌다
  for (let i = 0; i < 6; i++) await step(1000);
  assert.deepEqual(sent, [], '붙잡은 동안 보내지 않는다(뒤 전달도 앞지르지 않는다)');
  assert.equal(b.status, 'queued');
  const u = q.update(a.deliveryId, 'first fixed\r\nline 2');
  assert.equal(u.text, 'first fixed\nline 2', '줄바꿈은 LF');
  assert.deepEqual(store.texts, [[a.deliveryId, 'first fixed\nline 2']], '고친 글을 저장한다');
  await step(); await step();
  assert.equal(sent[0], 'first fixed\nline 2', '고친 글이 같은 차례로 간다');
  assert.ok(events.includes('queued(editing)'));
});

test('P158 놓기: 고치지 않고 놓으면(release) 원래 글이 차례대로 간다. 붙잡지 않은 대기 중 전달도 고칠 수 있다', async (t) => {
  const { q, v, sent, step } = rig(t);
  const a = q.enqueue('s', 'keep me');
  await step();
  q.hold(a.deliveryId);
  v.state = 'ready';
  await step(1000);
  assert.deepEqual(sent, []);
  const r = q.release(a.deliveryId);
  assert.equal(r.reason, 'working', '붙잡기 전 까닭으로 돌아간다');
  await step(); await step();
  assert.deepEqual(sent, ['keep me']);
  // 붙잡지 않은 대기 중 전달
  v.state = 'working';
  const b = q.enqueue('t', 'old'); // 다른 세션(앞 전달은 확인을 기다리는 중)
  await step();
  q.update(b.deliveryId, 'new');
  v.state = 'ready';
  await step(); await step();
  assert.equal(sent[1], 'new');
});

test('P158 거절: 이미 보낸 전달은 already_sent, 끝난 전달은 not_editable, 빈 글은 empty', async (t) => {
  const { q, v, step } = rig(t);
  v.state = 'ready';
  const a = q.enqueue('s', 'go');
  await step();
  assert.equal(a.status, 'sent');
  assert.throws(() => q.hold(a.deliveryId), (e) => e.code === 'already_sent');
  assert.throws(() => q.update(a.deliveryId, 'x'), (e) => e.code === 'already_sent');
  v.state = 'working';
  const b = q.enqueue('t', 'wait');
  await step();
  assert.throws(() => q.update(b.deliveryId, '  \n '), (e) => e.code === 'empty');
  q.cancel(b.deliveryId);
  assert.throws(() => q.hold(b.deliveryId), (e) => e.code === 'not_editable');
  assert.throws(() => q.hold('nope'), (e) => e.code === 'not_found');
});

test('P158 붙잡은 채 잊으면 editHoldMs 뒤 저절로 놓고, 고치는 시간은 기다림 기한(deliveryMaxWaitMs)에 넣지 않는다', async (t) => {
  const { q, v, sent, step } = rig(t, {}, { editHoldMs: 60000, deliveryMaxWaitMs: 50000 });
  const a = q.enqueue('s', 'later');
  await step();
  q.hold(a.deliveryId);
  v.state = 'ready';
  await step(40000);
  assert.deepEqual(sent, []);
  assert.equal(a.status, 'queued', '기한(50초)이 지나지 않은 것으로 센다');
  await step(25000); // 붙잡은 지 65초 > 60초: 놓는다
  await step(); await step();
  assert.deepEqual(sent, ['later']);
  assert.notEqual(a.status, 'failed');
});

test('P158 일하는 중 바로 넣기(typeNow)도 붙잡으면 넣지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const v = { state: 'working', agentPresent: true, termConnected: true, closed: false, lastUserInputAt: 0, kind: 'claude', hooked: true };
  const sent = [];
  const q = new DeliveryQueue({ store: fakeStore(), cfg, view: () => v, send: async (sid, text) => { sent.push(text); }, inspect: async () => ({ box: 'empty' }), pressEnter: async () => {} });
  const a = q.enqueue('s', 'now\n', { typeNow: true });
  q.hold(a.deliveryId);
  for (let i = 0; i < 4; i++) { t.mock.timers.tick(2000); q.pump(); await tick(); }
  assert.deepEqual(sent, []);
  q.update(a.deliveryId, 'fixed\n');
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(2000); q.pump(); await tick(); }
  assert.deepEqual(sent, ['fixed'], 'typeNow 글 모양(끝 줄바꿈 뗌)');
});
