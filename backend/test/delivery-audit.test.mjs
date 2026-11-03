import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryQueue } from '../src/delivery.mjs';

const turn = () => new Promise((r) => setImmediate(r));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(send) {
  const rows = new Map();
  const store = { activeDeliveries: () => [], insertDelivery: (d) => rows.set(d.deliveryId, { ...d }), updateDelivery: (id, p) => Object.assign(rows.get(id), p) };
  const q = new DeliveryQueue({ store, cfg: { submitConfirmMs: 30000, deliveryMaxWaitMs: 60000 }, view: () => ({ state: 'ready', agentPresent: true, herdrConnected: true }), send });
  return { q, rows };
}

test('submit confirmation does not allow two concurrent sends to the same terminal', async () => {
  const first = deferred(); let calls = 0;
  const { q } = fixture(async () => { if (++calls === 1) await first.promise; });
  q.enqueue('a', 'one'); q.enqueue('a', 'two'); q.enqueue('b', 'independent');
  await turn();
  assert.equal(calls, 2);
  q.onUserPromptSubmit('a', 'one'); await turn();
  assert.equal(calls, 2, 'the second message must wait for the first prompt RPC to settle');
  first.resolve(); await turn(); await turn();
  assert.equal(calls, 3);
});

test('a working confirmation before a lost RPC response must not resend the prompt', async () => {
  const send = deferred(); let calls = 0;
  const { q } = fixture(() => { calls++; return send.promise; });
  const d = q.enqueue('a', 'perform the task'); await turn();
  q.onAgentWorking('a');
  send.reject(Object.assign(new Error('socket lost after submit'), { code: 'unreachable' })); await turn();
  assert.equal(d.status, 'confirmed');
  q.pump(); await turn();
  assert.equal(calls, 1);
});

test('restart reconciliation includes a prompt submitted while the backend was down', () => {
  const attemptAt = Date.now() - 20000, submittedAt = attemptAt + 1000;
  const row = { deliveryId: 'd-restored', sessionId: 'a', text: 'keep this task', status: 'sending', createdAt: attemptAt - 5000, updatedAt: attemptAt, attempts: 1 };
  const store = { activeDeliveries: () => [{ ...row }], updateDelivery: (_, patch) => Object.assign(row, patch) };
  const q = new DeliveryQueue({ store, cfg: { submitConfirmMs: 30000 }, view: () => null, send: () => assert.fail('must not resend on restart') });
  const restored = q.list('a')[0];
  const transcript = [{ at: submittedAt, text: 'keep this task' }];
  q.reconcile('a', transcript.filter((p) => p.at >= restored.sentAt).map((p) => p.text));
  assert.equal(row.status, 'confirmed');
  assert.equal(q.pending('a'), 0);
});
