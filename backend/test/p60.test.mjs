// P60 단위 시험: 고른 인증기에 따른 WebAuthn hints(휴대폰 → hybrid, 이 기기 → client-device·security-key, 고르지 않음 → 없음),
// iCloud 키체인 모양(signCount 늘 0, BE·BS 켜짐, ES256, transports hybrid)의 등록과 로그인, transports로 패스키 종류, serve 켜기 명령 글
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import { Store } from '../src/store.mjs';
import { ApiServer } from '../src/api.mjs';
import { WebServer, Devices, enableCommand } from '../src/web.mjs';
import { creationOptions, requestOptions, passkeyHints, passkeyKind, verifyRegistration, verifyAssertion, parseAuthData } from '../src/passkey.mjs';
import { WebAuth } from '../src/web-auth.mjs';
import { FakeAuthenticator, raw, registerWithGrant, loginWith } from './fake-authenticator.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p60-'));
const clock = (t0 = 1_700_000_000_000) => { const c = { t: t0, now: () => c.t }; return c; };
const ORIGIN = 'http://localhost:47882';
const RP = 'localhost';
const LOCAL_NODE = { origin: 'local' };

test('hints: 휴대폰이면 hybrid(등록은 cross-platform도), 이 기기면 client-device·security-key, 고르지 않았거나 모르는 값이면 주지 않는다', () => {
  assert.deepEqual(passkeyHints('phone'), ['hybrid']);
  assert.deepEqual(passkeyHints('device'), ['client-device', 'security-key']);
  assert.equal(passkeyHints(null), null);
  assert.equal(passkeyHints('usb'), null);
  const base = { rpId: RP, challenge: 'c'.repeat(43), userId: 'dXNlcg', name: 'laptop' };
  const phone = creationOptions({ ...base, via: 'phone' });
  assert.deepEqual(phone.hints, ['hybrid']);
  assert.equal(phone.authenticatorSelection.authenticatorAttachment, 'cross-platform');
  assert.equal(phone.authenticatorSelection.userVerification, 'required');
  const dev = creationOptions({ ...base, via: 'device' });
  assert.deepEqual(dev.hints, ['client-device', 'security-key']);
  assert.ok(!('authenticatorAttachment' in dev.authenticatorSelection), '이 기기는 보안 키도 받으므로 붙임을 묶지 않는다');
  for (const via of [undefined, null, 'x']) {
    const o = creationOptions({ ...base, via });
    assert.ok(!('hints' in o), `via=${via}`); assert.ok(!('authenticatorAttachment' in o.authenticatorSelection));
  }
  assert.deepEqual(requestOptions({ rpId: RP, challenge: 'c', via: 'phone' }).hints, ['hybrid']);
  assert.deepEqual(requestOptions({ rpId: RP, challenge: 'c', via: 'device' }).hints, ['client-device', 'security-key']);
  assert.ok(!('hints' in requestOptions({ rpId: RP, challenge: 'c' })));
  // 기억한 transports를 allowCredentials에 싣는다(ID 글만 주면 옛 모양 그대로)
  assert.deepEqual(requestOptions({ rpId: RP, challenge: 'c', credIds: [{ id: 'AAA', transports: ['hybrid', 'internal'] }] }).allowCredentials, [{ type: 'public-key', id: 'AAA', transports: ['hybrid', 'internal'] }]);
  assert.deepEqual(requestOptions({ rpId: RP, challenge: 'c', credIds: ['AAA'] }).allowCredentials, [{ type: 'public-key', id: 'AAA' }]);
  assert.deepEqual(requestOptions({ rpId: RP, challenge: 'c', credIds: [{ id: 'AAA', transports: [] }] }).allowCredentials, [{ type: 'public-key', id: 'AAA' }]);
});

test('iCloud 키체인 모양: signCount 늘 0·BE·BS·ES256으로 등록하고 여러 번 로그인한다', () => {
  const a = new FakeAuthenticator({ icloud: true });
  const opts = creationOptions({ rpId: RP, challenge: 'reg-challenge-0123456789abcdef', userId: 'dXNlcg', name: 'iphone', via: 'phone' });
  const cred = a.create(opts, { origin: ORIGIN });
  const ad = parseAuthData(a.authData({ rpId: RP, count: 0 }));
  assert.equal(ad.be, true); assert.equal(ad.bs, true); assert.equal(ad.signCount, 0);
  const pk = verifyRegistration(cred, { challenge: opts.challenge, origin: ORIGIN, rpId: RP });
  assert.equal(pk.alg, -7); assert.equal(pk.signCount, 0);
  assert.equal(pk.backupEligible, true); assert.equal(pk.backedUp, true);
  assert.deepEqual(pk.transports, ['hybrid', 'internal']); assert.equal(pk.attachment, 'cross-platform');
  assert.equal(passkeyKind(pk), 'phone');
  let stored = { ...pk, userId: 'dXNlcg' };
  for (let i = 0; i < 3; i++) {
    const ro = requestOptions({ rpId: RP, challenge: `login-challenge-${i}-0123456789abcdef`, credIds: [{ id: a.id, transports: pk.transports }], via: 'phone' });
    const r = verifyAssertion(a.get(ro, { origin: ORIGIN }), stored, { challenge: ro.challenge, origin: ORIGIN, rpId: RP });
    assert.equal(r.signCount, 0, '카운터가 늘 0이어도 받는다'); assert.equal(r.backedUp, true);
    stored = { ...stored, signCount: r.signCount };
  }
  // 한 번이라도 0이 아닌 카운터를 본 뒤 0으로 돌아오면 여전히 거부한다(복제 의심)
  const ro = requestOptions({ rpId: RP, challenge: 'login-challenge-x-0123456789abcdef', credIds: [a.id] });
  assert.throws(() => verifyAssertion(a.get(ro, { origin: ORIGIN }), { ...stored, signCount: 5 }, { challenge: ro.challenge, origin: ORIGIN, rpId: RP }), (e) => e.code === 'sign_count');
});

test('iCloud 모양을 WebAuth로: 기기 기록에 transports·백업, 목록에 패스키 종류, 로그인 선택 사항에 transports와 hints', () => {
  const dir = tmp(); const store = new Store(path.join(dir, 'b.db')); const c = clock();
  try {
    const devices = new Devices({ store, now: c.now });
    const auth = new WebAuth({ store, devices, now: c.now });
    const g = auth.grants.issue({ name: 'laptop', via: 'code', userAgent: 'UA', origin: ORIGIN, extra: LOCAL_NODE });
    const a = new FakeAuthenticator({ icloud: true });
    const { options } = auth.registerOptions({ grant: g.grant, origin: ORIGIN, via: 'phone' });
    assert.deepEqual(options.hints, ['hybrid']);
    const r = auth.register({ grant: g.grant, credential: a.create(options, { origin: ORIGIN }), origin: ORIGIN });
    assert.equal(r.device.passkey.kind, 'phone'); assert.equal(r.device.passkey.backupEligible, true); assert.equal(r.device.passkey.backedUp, true);
    assert.deepEqual(r.device.passkey.transports, ['hybrid', 'internal']);
    assert.ok(!('credId' in r.device.passkey) && !('publicKey' in r.device.passkey));
    for (const via of ['phone', 'device', null]) {
      const lo = auth.loginOptions({ credentialId: a.id, origin: ORIGIN, via });
      assert.equal(lo.status, 'ok');
      assert.deepEqual(lo.options.allowCredentials, [{ type: 'public-key', id: a.id, transports: ['hybrid', 'internal'] }]);
      if (via) assert.deepEqual(lo.options.hints, passkeyHints(via)); else assert.ok(!('hints' in lo.options));
      const s = auth.login({ credential: a.get(lo.options, { origin: ORIGIN }), origin: ORIGIN });
      assert.ok(s.session.id); assert.equal(s.device.passkey.backedUp, true);
    }
    assert.equal(store.getMeta('webDevices')[0].passkey.signCount, 0);
    // 이 기기(Windows Hello 모양) 패스키는 'device'
    const g2 = auth.grants.issue({ name: 'hello', via: 'code', origin: ORIGIN, extra: LOCAL_NODE });
    const b = new FakeAuthenticator();
    const o2 = auth.registerOptions({ grant: g2.grant, origin: ORIGIN, via: 'device' }).options;
    assert.deepEqual(o2.hints, ['client-device', 'security-key']);
    const r2 = auth.register({ grant: g2.grant, credential: b.create(o2, { origin: ORIGIN }), origin: ORIGIN });
    assert.equal(r2.device.passkey.kind, 'device'); assert.equal(r2.device.passkey.backedUp, false);
    // 모르는 via는 hints 없이
    const g3 = auth.grants.issue({ name: 'z', via: 'code', origin: ORIGIN, extra: LOCAL_NODE });
    assert.ok(!('hints' in auth.registerOptions({ grant: g3.grant, origin: ORIGIN, via: '<script>' }).options));
  } finally { store.close(); }
});

test('패스키 종류: transports와 붙임으로', () => {
  assert.equal(passkeyKind({ transports: ['hybrid', 'internal'] }), 'phone');
  assert.equal(passkeyKind({ transports: ['cable'] }), 'phone');
  assert.equal(passkeyKind({ transports: ['internal'] }), 'device');
  assert.equal(passkeyKind({ transports: [], attachment: 'platform' }), 'device');
  assert.equal(passkeyKind({ transports: ['usb', 'nfc'] }), 'key');
  assert.equal(passkeyKind({ transports: [], attachment: 'cross-platform' }), 'phone');
  assert.equal(passkeyKind({ transports: [] }), 'unknown');
  assert.equal(passkeyKind({}), 'unknown');
  assert.equal(passkeyKind(null), null);
});

test('serve 켜기 명령: node와 이 백엔드의 atrium.mjs(공백이면 따옴표), 개발용 판이면 --dev, 443이 아니면 --https-port', () => {
  assert.equal(enableCommand(443, { profile: 'prod' }, 'C:\\a\\backend'), `node ${path.join('C:\\a\\backend', 'bin', 'atrium.mjs')} remote enable --yes`);
  assert.equal(enableCommand(10000, { profile: 'dev' }, 'C:\\a b\\backend'), `node "${path.join('C:\\a b\\backend', 'bin', 'atrium.mjs')}" --dev remote enable --yes --https-port 10000`);
  assert.match(enableCommand(8443, {}), /^node .*atrium\.mjs"? remote enable --yes --https-port 8443$/);
});

// HTTP로: 짝 맺기 코드 → 등록 선택 사항에 via → hints. 로그인 선택 사항도
async function boot() {
  const dir = tmp();
  const dist = path.join(dir, 'dist'); fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Atrium</title>');
  process.env.ATRIUM_WEB_DIST = dist;
  const store = new Store(path.join(dir, 'board.db'));
  const srv = http.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const web = new WebServer({ cfg: { remoteEnabled: true, port, dataDir: dir, profile: 'dev', herdrSession: 'atrium-dev-test' }, store, api: null, settings: () => ({}), log: () => {}, tailscale: null });
  const apiToken = 'board-api-token-for-test';
  const api = new ApiServer({ token: apiToken, handlers: { ...web.handlers(), 'events.subscribe': (p, cl) => { cl.subscribed = true; return {}; } }, authorize: (req) => web.authorize(req, apiToken), onClose: () => {} });
  web.api = api;
  srv.on('request', (req, res) => { if (web.handleHttp(req, res)) return; res.writeHead(404); res.end(); });
  srv.on('upgrade', (req, s, h) => api.handleUpgrade(req, s, h));
  const close = async () => { api.close(); web.stop(); await new Promise((r) => srv.close(r)); store.close(); delete process.env.ATRIUM_WEB_DIST; };
  return { port, web, apiToken, close };
}
const wsCall = (url, method, params = {}) => new Promise((res, rej) => {
  const ws = new WebSocket(url);
  ws.on('error', rej);
  ws.on('open', () => { const id = 1; ws.on('message', (m0) => { const m = JSON.parse(String(m0)); if (m.id === id) { ws.close(); res(m); } }); ws.send(JSON.stringify({ id, method, params })); });
});

test('HTTP: 등록·로그인 선택 사항이 via를 hints로 싣고, 기기 목록이 패스키 종류를 보인다', async () => {
  const b = await boot();
  const origin = `http://localhost:${b.port}`;
  const H = { host: `localhost:${b.port}`, origin };
  const local = `ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`;
  try {
    const pc = (await wsCall(local, 'device.code')).result.code;
    const pr = await raw(b.port, '/web/pair/code', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ code: pc, name: 'laptop' }) });
    assert.equal(pr.status, 200);
    const a = new FakeAuthenticator({ icloud: true });
    const reg = await registerWithGrant(b.port, pr.body.grant, H, { auth: a, via: 'phone' });
    assert.equal(reg.res.status, 200, JSON.stringify(reg.res.body));
    assert.deepEqual(reg.options.hints, ['hybrid']);
    assert.equal(reg.options.authenticatorSelection.authenticatorAttachment, 'cross-platform');
    const lg = await loginWith(b.port, a, H, {}, 'phone');
    assert.equal(lg.res.status, 200);
    assert.deepEqual(lg.options.hints, ['hybrid']);
    assert.deepEqual(lg.options.allowCredentials[0].transports, ['hybrid', 'internal']);
    const lg2 = await loginWith(b.port, a, H);
    assert.equal(lg2.res.status, 200, '카운터 0으로 다시 로그인');
    assert.ok(!('hints' in lg2.options));
    const list = (await wsCall(local, 'device.list')).result;
    assert.equal(list.devices[0].passkey.kind, 'phone');
    assert.equal(list.devices[0].passkey.backedUp, true);
    const st = (await wsCall(local, 'remote.status')).result;
    assert.equal(st.serveOthers, 0);
  } finally { await b.close(); }
});
