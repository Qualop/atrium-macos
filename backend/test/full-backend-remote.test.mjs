import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { pairAndRegister, registerWithGrant, raw } from './fake-authenticator.mjs';
import { isolatedBackend, until, pause } from './fixtures/isolated-backend.mjs';

test('full Backend remote/web/multiclient integration in an isolated profile', { timeout: 30000 }, async t => {
  // Node 24.0.0 resolves t.test before the subtest body completes. These
  // scenarios share one board, so await the body explicitly on every version.
  const step = (name, fn) => new Promise((resolve, reject) => {
    Promise.resolve(t.test(name, async () => {
      try { await fn(); resolve(); } catch (error) { reject(error); throw error; }
    })).catch(reject);
  });
  const f = await isolatedBackend(t, { holdStartup: true });
  const fixtureHttp = async (url, options = {}) => { const u = new URL(url); const r = await raw(f.port, u.pathname + u.search, options); return { status: r.status, json: async () => r.body }; };
  const pc = await f.desktop('desktop-fixture'); let answered = false;
  const status = pc.call('backend.status').then(r => { answered = true; return r; });
  await pause(30); assert.equal(answered, false, 'API waits for full Backend startup');
  f.release(); await f.starting;
  assert.equal((await status).profile, 'dev'); assert.equal(f.b.sessions.size, 0);
  assert.equal(f.b.cfg.legacy, null); assert.equal(f.b.tailscale.timer, null);
  assert.equal(fs.existsSync(f.reads), false, 'default-off startup never invokes even synthetic Tailscale');

  await step('desktop works while all browser authentication and pairing remain disabled', async () => {
    assert.equal((await pc.call('remote.status', { fresh: true })).enabled, false);
    const saved = f.b.web.devices.add({ name: 'old device', via: 'fixture' });
    for (const p of ['/web/me', '/web/pair/code', '/web/pair/request', '/web/pair/poll', '/web/upload']) {
      const r = await fixtureHttp(f.base + p, { method: p === '/web/me' || p.endsWith('/poll') ? 'GET' : 'POST', headers: { authorization: 'Bearer obsolete-token' } });
      assert.equal(r.status, 403, p); assert.equal((await r.json()).error.code, 'remote_blocked');
    }
    await assert.rejects(f.open('device=obsolete-token', { origin: f.base }), /401/);
    await assert.rejects(pc.call('device.code'), { code: 'remote_blocked' });
    assert.equal((await pc.call('session.list')).length, 0); assert.equal(fs.existsSync(f.reads), false);
  });

  const subscribe = await pc.call('events.subscribe');
  await step('new subscribers immediately receive peers and notification ownership', async () => {
    assert.equal(subscribe.clients?.me, 'desktop-fixture', 'events.subscribe must include clients: { ...peers.view(), me: c.clientId }');
    assert.equal(subscribe.clients.notify, 'desktop-fixture');
  });

  await pc.call('remote.configure', { enabled: true });
  await pc.call('settings.set', { remoteAccess: true, remotePasskey: true });
  const remote = await pc.call('remote.status', { fresh: true });
  assert.equal(remote.enabled, true); assert.equal(remote.url, `https://${f.hostname}/`);
  const code = await pc.call('device.code');
  const pair = await pairAndRegister(f.port, code.code, f.remoteHeaders, { name: 'Synthetic remote' });
  assert.equal(pair.res.status, 200, JSON.stringify(pair.res.body));
  const device = pair.device, cookie = pair.cookie;
  const web = await f.open('client=remote-fixture&kind=desktop', { ...f.remoteHeaders, cookie });
  await web.call('events.subscribe');
  const frameEvents = c => c.events.filter(e => e.event === 'terminal.frame');

  await step('synthetic Tailscale pairing binds web identity and compressed transport', async () => {
    assert.match(web.ws.extensions, /permessage-deflate/); assert.equal(pc.ws.extensions, '');
    const me = await (await fixtureHttp(f.base + '/web/me', { headers: { ...f.remoteHeaders, cookie } })).json();
    assert.equal(me.platform, process.platform); assert.equal(me.device.id, device.id);
    assert.ok(!JSON.stringify(me).includes(f.b.apiToken));
    const peers = await web.call('clients.list'); assert.equal(peers.clients.find(c => c.clientId === 'remote-fixture').kind, 'web');
    await assert.rejects(web.call('remote.configure', { enabled: false }), { code: 'forbidden' });
    await assert.rejects(web.call('settings.set', { remoteSameUser: false }), { code: 'forbidden' });
    await assert.rejects(web.call('device.code'), { code: 'forbidden' });
    await assert.rejects(web.call('device.rename', { id: device.id, name: 'denied' }), { code: 'forbidden' });
    await assert.rejects(web.call('device.revoke', { id: device.id }), { code: 'forbidden' });
    assert.deepEqual((await web.call('device.list')).devices.map((d) => d.id), [device.id]);
    await assert.rejects(f.open('', { ...f.remoteHeaders, 'tailscale-user-login': 'other@example.com', cookie }), /401/);
    assert.equal((await fixtureHttp(f.base + '/web/me', { headers: { ...f.remoteHeaders, 'tailscale-user-login': 'other@example.com', cookie } })).status, 403);
  });

  await step('all hook providers and branch endpoints stay local', async () => {
    for (const route of ['/hooks/claude', '/hooks/gemini', '/hooks/agy', '/hooks/future', '/branch', '/branch/spawn']) {
      for (const headers of [f.remoteHeaders, { origin: f.base }, { 'x-forwarded-for': '100.64.0.2' }]) assert.equal((await fixtureHttp(f.base + route, { method: 'POST', headers, body: '{}' })).status, 403, route);
    }
    for (const route of ['/hooks/claude', '/hooks/gemini', '/hooks/agy']) assert.equal((await fixtureHttp(f.base + route, { method: 'POST', body: '{}' })).status, 200);
    await assert.rejects(f.open(`token=${f.b.apiToken}`, f.remoteHeaders), /401/, 'board API token cannot cross proxy');
  });

  await step('approval pairing releases a grant once, then requires a passkey before cookies authorize', async () => {
    const requested = await fixtureHttp(f.base + '/web/pair/request', { method: 'POST', headers: { ...f.remoteHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Approved fixture' }) });
    assert.equal(requested.status, 200); const request = await requested.json();
    await until(() => pc.events.some(e => e.event === 'device.updated' && e.data.requests?.some(r => r.id === request.requestId)));
    const poll = () => fixtureHttp(`${f.base}/web/pair/poll?id=${request.requestId}&secret=${request.secret}`, { headers: f.remoteHeaders }).then(r => r.json());
    assert.equal((await poll()).status, 'pending');
    await assert.rejects(web.call('device.approve', { id: request.requestId }), { code: 'forbidden' });
    await pc.call('device.approve', { id: request.requestId });
    const approved = await poll(); assert.equal(approved.status, 'approved'); assert.ok(approved.grant); assert.ok(!approved.token);
    assert.equal((await poll()).status, 'expired');
    const enrolled = await registerWithGrant(f.port, approved.grant, f.remoteHeaders);
    assert.equal(enrolled.res.status, 200);
    assert.equal((await fixtureHttp(f.base + '/web/me', { headers: { ...f.remoteHeaders, cookie: enrolled.cookie } })).status, 200);
  });

  await step('paired upload and folder browsing use the temporary backend filesystem', async () => {
    const r = await fixtureHttp(f.base + '/web/upload?name=fixture.txt', { method: 'POST', headers: { ...f.remoteHeaders, cookie }, body: 'synthetic upload' });
    assert.equal(r.status, 200); const result = await r.json(); assert.equal(path.dirname(result.path), path.join(f.cfg.dataDir, 'uploads')); assert.equal(fs.readFileSync(result.path, 'utf8'), 'synthetic upload');
    assert.ok((await web.call('fs.list', { path: f.cfg.dataDir })).dirs.some(d => d.name === 'uploads'));
  });

  await step('per-client viewports and notification ownership remain independent', async () => {
    const a = { x: 11, y: 22, zoom: 1 }, b = { x: 333, y: 444, zoom: .7 };
    await pc.call('board.setViewport', a); await web.call('board.setViewport', b);
    assert.deepEqual((await pc.call('board.get')).viewport, a); assert.deepEqual((await web.call('board.get')).viewport, b);
    await web.call('client.active'); assert.equal((await pc.call('clients.list')).notify, 'remote-fixture');
    await pause(2); await pc.call('client.active'); assert.equal((await web.call('clients.list')).notify, 'desktop-fixture');
  });

  await step('full handlers share controllers, honor attachment guards, and hand ownership back', async () => {
    const s = f.seedSession();
    const a = await pc.call('terminal.attach', { session: s.sessionId, cols: 100, rows: 30, attachmentId: 'desktop-1' });
    const b = await web.call('terminal.attach', { session: s.sessionId, cols: 80, rows: 24, attachmentId: 'remote-1' });
    assert.equal(f.controllers.length, 1); assert.equal(a.controllerPid, b.controllerPid);
    await until(() => frameEvents(pc).length && frameEvents(web).length);
    assert.equal(frameEvents(web)[0].data.full, true); assert.equal(frameEvents(web)[0].data.attachmentId, 'remote-1');
    await web.call('terminal.focus', { session: s.sessionId, controllerPid: b.controllerPid, attachmentId: 'remote-1' });
    assert.equal(f.controllers[0].cols, 80); assert.equal((await pc.call('clients.list')).notify, 'remote-fixture');
    await web.call('terminal.input', { session: s.sessionId, controllerPid: b.controllerPid, attachmentId: 'remote-1', data: 'remote text' });
    assert.deepEqual(f.controllers[0].inputs, ['remote text']);
    await pc.call('terminal.attach', { session: s.sessionId, cols: 110, rows: 32, attachmentId: 'desktop-2' });
    for (const method of ['terminal.input', 'terminal.resize', 'terminal.focus', 'terminal.detach']) await assert.rejects(pc.call(method, { session: s.sessionId, controllerPid: a.controllerPid, attachmentId: 'desktop-1', data: 'stale', cols: 20, rows: 8 }), { code: 'stale_attachment' });
    await web.call('terminal.detach', { session: s.sessionId, controllerPid: b.controllerPid, attachmentId: 'remote-1' }); assert.equal(f.controllers[0].cols, 110); assert.equal(f.controllers[0].exited, null);
    await pc.call('terminal.detach', { session: s.sessionId, controllerPid: a.controllerPid, attachmentId: 'desktop-2' }); assert.equal(f.controllers[0].exited, 0);
  });

  await step('disable closes device connections, clears pending pairing, and preserves desktop API', async () => {
    await pc.call('device.code'); const close = once(web.ws, 'close');
    await pc.call('remote.configure', { enabled: false }); assert.equal((await close)[0], 4403);
    assert.equal(f.b.store.getMeta('remoteEnabled'), false); assert.equal(f.b.web.pairing.code, null); assert.equal(f.b.tailscale.timer, null);
    assert.equal((await pc.call('ping')).at > 0, true); assert.equal((await pc.call('remote.status', { fresh: true })).enabled, false);
    assert.ok(fs.readFileSync(f.reads, 'utf8').trim().split('\n').every(s => ['status --json', 'serve status --json', 'whois --json 100.64.0.2'].includes(s)));
  });
  assert.deepEqual(f.unexpected, []);
});
