// session.keys의 실제 Backend WebSocket 경로를 시험한다. 프로필·노드·제어기는 임시 고정 자료이며 실제 CLI는 실행하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedBackend } from './fixtures/isolated-backend.mjs';
import { pairAndRegister } from './fake-authenticator.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const identity = ({ controllerPid, attachmentId }) => ({ controllerPid, attachmentId });

async function keyBoard(t, { remote = true, uniquePids = false } = {}) {
  const f = await isolatedBackend(t);
  const calls = [];
  let onSend = async () => {};
  const adapterCall = f.b.adapter.call;
  // 외부 herdr 경계만 흉내 낸다. paneKeys, RPC 처리기, keyChain, relay 검사는 운영 코드를 그대로 쓴다.
  t.mock.method(f.b.adapter, 'call', async function (method, params) {
    if (method !== 'pane.send_keys') return adapterCall.call(this, method, params);
    calls.push(structuredClone(params));
    await onSend(params);
    return {};
  });
  if (uniquePids) {
    const open = f.b.adapter.openController.bind(f.b.adapter);
    t.mock.method(f.b.adapter, 'openController', (...args) => {
      const controller = open(...args);
      controller.pid = 1000 + f.controllers.length;
      return controller;
    });
  }
  const session = f.seedSession();
  const pc = await f.desktop('key-relay-admin');
  let client = pc, device = null;
  if (remote) {
    await pc.call('remote.configure', { enabled: true });
    await pc.call('settings.set', { remoteAccess: true, remotePasskey: true });
    await pc.call('remote.status', { fresh: true });
    const code = await pc.call('device.code');
    const paired = await pairAndRegister(f.port, code.code, f.remoteHeaders, { name: 'Synthetic key phone' });
    assert.equal(paired.res.status, 200, JSON.stringify(paired.res.body));
    device = paired.device;
    client = await f.open('client=key-relay-phone&kind=web', { ...f.remoteHeaders, cookie: paired.cookie });
  }
  const attach = (attachmentId) => client.call('terminal.attach', { session: session.sessionId, cols: 80, rows: 24, attachmentId });
  const send = (keys, attachment = {}) => client.call('session.keys', { session: session.sessionId, keys, ...attachment });
  const events = async () => (await pc.call('session.events', { session: session.sessionId })).filter((e) => e.kind === 'keys');
  return { ...f, session, pc, client, device, calls, attach, send, events, onSend(fn) { onSend = fn; } };
}

test('full RPC: current paired-device attachment sends keys and records only that device', { timeout: 15000 }, async (t) => {
  const f = await keyBoard(t);
  const attached = await f.attach('phone-current');
  assert.deepEqual(await f.send(['down', 2, 'enter'], identity(attached)), { sent: true, keys: ['down', '2', 'enter'] });
  assert.deepEqual(f.calls, [{ pane_id: f.session.paneId, keys: ['down', '2', 'enter'] }]);
  assert.deepEqual((await f.events()).map((e) => e.data), [{ keys: ['down', '2', 'enter'], via: 'device', deviceId: f.device.id, deviceName: 'Synthetic key phone' }]);
  assert.ok(f.session.lastUserInputAt > 0);
  assert.deepEqual(f.unexpected, []);
});

test('full RPC: stale controller and attachment reject before waiting behind an active key request', { timeout: 15000 }, async (t) => {
  const f = await keyBoard(t);
  const attached = await f.attach('phone-before');
  const entered = deferred(), release = deferred();
  f.onSend(async () => { entered.resolve(); await release.promise; });
  const first = f.send(['up'], identity(attached));
  const pending = [];
  try {
    await entered.promise;
    for (const [attachment, code] of [
      [{ ...identity(attached), controllerPid: attached.controllerPid + 1 }, 'stale_controller'],
      [{ ...identity(attached), attachmentId: 'phone-obsolete' }, 'stale_attachment'],
    ]) {
      let outcome = null;
      pending.push(f.send(['enter'], attachment).then((value) => { outcome = { value }; }, (error) => { outcome = { error }; }));
      // 같은 소켓의 ping 응답은 앞 요청의 동기 검사까지 서버가 처리했다는 장벽이다. 잠든 시간으로 순서를 추측하지 않는다.
      await f.client.call('ping');
      assert.equal(outcome?.error?.code, code, 'stale identity rejects while the preceding request remains blocked');
      assert.equal(f.calls.length, 1);
    }
  } finally {
    release.resolve();
    await Promise.allSettled([first, ...pending]);
  }
  assert.deepEqual((await f.events()).map((e) => e.data.keys), [['up']]);
  assert.deepEqual(f.unexpected, []);
});

for (const replacement of ['same-controller', 'new-controller']) {
  test(`full RPC: queued keys cannot cross ${replacement} reattachment`, { timeout: 15000 }, async (t) => {
    const f = await keyBoard(t, { uniquePids: replacement === 'new-controller' });
    const old = await f.attach('phone-old');
    const entered = deferred(), release = deferred();
    f.onSend(async ({ keys }) => { if (keys[0] === 'up') { entered.resolve(); await release.promise; } });
    const first = f.send(['up'], identity(old));
    let queued, current;
    try {
      await entered.promise;
      queued = f.send(['enter'], identity(old)).then((value) => ({ value }), (error) => ({ error }));
      await f.client.call('ping'); // 앞 요청이 멈춘 동안 두 번째 RPC가 줄에 들어갔다.
      assert.equal(f.calls.length, 1);
      if (replacement === 'new-controller') await f.client.call('terminal.detach', { session: f.session.sessionId, ...identity(old) });
      current = await f.attach('phone-new');
      if (replacement === 'same-controller') assert.equal(current.controllerPid, old.controllerPid);
      else assert.notEqual(current.controllerPid, old.controllerPid);
      assert.notEqual(current.attachmentId, old.attachmentId);
    } finally {
      release.resolve();
      await first;
    }
    const result = await queued;
    assert.equal(result.error?.code, replacement === 'same-controller' ? 'stale_attachment' : 'stale_controller');
    assert.deepEqual(f.calls, [{ pane_id: f.session.paneId, keys: ['up'] }], 'queued Enter never reaches the replacement terminal');
    assert.deepEqual((await f.events()).map((e) => e.data.keys), [['up']], 'rejected keys do not become successful input events');
    assert.deepEqual(await f.send(['esc'], identity(current)), { sent: true, keys: ['esc'] }, 'the queue accepts new input after rejecting stale input');
    assert.deepEqual(f.calls.map((c) => c.keys), [['up'], ['esc']]);
    assert.deepEqual(f.unexpected, []);
  });
}

test('full RPC: matching identity cannot send to a session whose relay still owns another pane', { timeout: 15000 }, async (t) => {
  const f = await keyBoard(t);
  const attached = await f.attach('phone-old-pane');
  f.session.paneId = 'replacement-synthetic-pane';
  await assert.rejects(f.send(['enter'], identity(attached)), { code: 'stale_attachment' });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(await f.events(), []);
  assert.deepEqual(f.unexpected, []);
});

test('full RPC: local CLI without controller or attachment fields keeps the direct key path', { timeout: 15000 }, async (t) => {
  const f = await keyBoard(t, { remote: false });
  const cli = await f.open(`token=${f.b.apiToken}&client=key-relay-cli&kind=cli`);
  assert.equal(f.b.web.remoteEnabled(), false);
  assert.equal(f.b.relay.attached.size, 0);
  assert.deepEqual(await cli.call('session.keys', { target: f.session.name, keys: ['tab', 'enter'] }), { sent: true, keys: ['tab', 'enter'] });
  assert.deepEqual(f.calls, [{ pane_id: f.session.paneId, keys: ['tab', 'enter'] }]);
  assert.deepEqual((await f.events()).map((e) => e.data), [{ keys: ['tab', 'enter'], via: 'local' }]);
  assert.equal(f.b.relay.attached.size, 0, 'the CLI did not need to open a controller');
  assert.deepEqual(f.unexpected, []);
});
