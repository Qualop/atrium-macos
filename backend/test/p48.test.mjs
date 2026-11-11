// P48(원격 R2) 단위 시험: 짝 맺기(코드, 허락, 만료, 횟수 제한), 기기 토큰 확인(해시로 저장), 연결 허락(판 API 토큰은 이 PC의 프로세스만, 기기는 같은 출처만),
// 막힌 경로(hook, branch, 보드 토큰을 기기로), 화면 파일(캐시 머리글, 304, 빌드 없음), 업로드 경로와 정리, 폴더 목록
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import { Store } from '../src/store.mjs';
import { ApiServer } from '../src/api.mjs';
import {
  Devices, Pairing, WebServer, StaticFiles, isLocalProcess, originOk, allowedHosts, listDirs, parseDrives, driveRoots, safeUploadName, uploadPath, cleanupUploads, cacheControl, sha256,
  PAIR_CODE_TTL_MS, PAIR_REQUEST_TTL_MS, PAIR_FAIL_PER_IP, PAIR_FAIL_GLOBAL, PAIR_CODE_MAX_FAILS, UPLOAD_MAX_BYTES,
} from '../src/web.mjs';
import { Grants } from '../src/web-auth.mjs';
import { pairAndRegister, registerWithGrant, raw } from './fake-authenticator.mjs'; // P56: 짝 맺기 뒤 패스키 등록

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p48-'));
const clock = (t0 = 1_000_000) => { const c = { t: t0, now: () => c.t }; return c; };
const fakeReq = (headers, remoteAddress = '127.0.0.1') => ({ headers, socket: { remoteAddress } });

function storeIn(dir) { return new Store(path.join(dir, 'board.db')); }

test('기기: P56부터 패스키(공개 키)를 두고, 목록에는 공개 키를 싣지 않으며, credential ID로 찾고 끊는다', () => {
  const dir = tmp(); const store = storeIn(dir);
  const d = new Devices({ store });
  const device = d.add({ name: '  laptop\n chrome ', via: 'code', userAgent: 'UA', passkey: { credId: 'cred-1', publicKey: { kty: 'EC' }, alg: -7, signCount: 0, rpId: 'localhost' }, extra: { origin: 'local' } }); // P59: P57 기기 기록(이 PC 안)
  assert.equal(device.name, 'laptop chrome');
  assert.equal(d.byCred('cred-1').id, device.id);
  assert.equal(d.byCred('cred-2'), null);
  assert.equal(d.byCred(''), null);
  const l = d.list()[0];
  assert.ok(!('hash' in l) && !('publicKey' in l.passkey) && !('credId' in l.passkey), '목록에 해시·공개 키를 싣지 않는다');
  assert.equal(l.needsRepair, false);
  assert.equal(d.revoke(device.id), true);
  assert.equal(d.byCred('cred-1'), null);
  store.close();
});

test('코드 짝 맺기: 한 번만, 만료, 틀리면 코드를 버리고, 횟수를 제한한다', () => {
  const dir = tmp(); const store = storeIn(dir); const c = clock();
  const p = new Pairing({ devices: new Devices({ store, now: c.now }), grants: new Grants({ now: c.now }), now: c.now });
  assert.throws(() => p.redeem({ code: '000000', ip: 'a' }), (e) => e.code === 'no_code');
  const { code } = p.newCode();
  assert.match(code, /^\d{6}$/);
  const r = p.redeem({ code, name: 'tab', ip: 'a' });
  assert.ok(r.grant && r.expiresAt && !r.token, 'P56: 기기 토큰이 아니라 등록 허가');
  assert.throws(() => p.redeem({ code, ip: 'b' }), (e) => e.code === 'no_code', '같은 코드는 두 번 쓰지 못한다');
  // 만료
  const c2 = p.newCode(); c.t += PAIR_CODE_TTL_MS + 1;
  assert.throws(() => p.redeem({ code: c2.code, ip: 'c' }), (e) => e.status === 403);
  // 틀리면 PAIR_CODE_MAX_FAILS번에 코드를 버린다(맞는 코드도 더는 안 된다)
  c.t += 60 * 60_000;
  const c3 = p.newCode();
  const wrong = c3.code === '123456' ? '654321' : '123456';
  for (let i = 0; i < PAIR_CODE_MAX_FAILS; i++) assert.throws(() => p.redeem({ code: wrong, ip: `ip${i}` }), (e) => e.code === 'bad_code');
  assert.equal(p.currentCode(), null);
  assert.throws(() => p.redeem({ code: c3.code, ip: 'z' }), (e) => e.code === 'no_code');
  // 한 곳에서 PAIR_FAIL_PER_IP번 틀리면 429
  c.t += 60 * 60_000;
  p.newCode();
  for (let i = 0; i < PAIR_FAIL_PER_IP; i++) { try { p.redeem({ code: 'abc', ip: 'evil' }); } catch {} if (!p.currentCode()) p.newCode(); }
  assert.throws(() => p.redeem({ code: p.currentCode().code, ip: 'evil' }), (e) => e.code === 'rate_limited' && e.status === 429 && e.retryAfterMs > 0);
  // 모두 합쳐 PAIR_FAIL_GLOBAL번
  c.t += 60 * 60_000;
  for (let i = 0; i < PAIR_FAIL_GLOBAL; i++) { if (!p.currentCode()) p.newCode(); try { p.redeem({ code: 'x', ip: `g${i}` }); } catch {} }
  if (!p.currentCode()) p.newCode();
  assert.throws(() => p.redeem({ code: p.currentCode().code, ip: 'fresh' }), (e) => e.code === 'rate_limited');
  store.close();
});

test('허락 짝 맺기: 요청, 허락, 토큰은 한 번만, 거절, 만료, 요청 수 제한', () => {
  const dir = tmp(); const store = storeIn(dir); const c = clock();
  const devices = new Devices({ store, now: c.now });
  let changes = 0;
  const grants = new Grants({ now: c.now });
  const p = new Pairing({ devices, grants, now: c.now, onChange: () => changes++ });
  const q = p.request({ name: 'phone', ip: 'x' });
  assert.match(q.check, /^\d{4}$/);
  assert.equal(p.pending().length, 1);
  assert.ok(changes > 0);
  assert.throws(() => p.poll(q.requestId, 'wrong'), (e) => e.code === 'not_found');
  assert.equal(p.poll(q.requestId, q.secret).status, 'pending');
  p.decide(q.requestId, true);
  const got = p.poll(q.requestId, q.secret);
  assert.equal(got.status, 'approved');
  assert.equal(grants.peek(got.grant).name, 'phone');
  assert.equal(p.poll(q.requestId, q.secret).status, 'expired', '토큰은 한 번만 내준다');
  const q2 = p.request({ name: 'b', ip: 'x' });
  p.decide(q2.requestId, false);
  assert.equal(p.poll(q2.requestId, q2.secret).status, 'denied');
  assert.throws(() => p.decide(q2.requestId, true), (e) => e.code === 'not_found');
  const q3 = p.request({ name: 'c', ip: 'x' });
  c.t += PAIR_REQUEST_TTL_MS + 1;
  assert.equal(p.poll(q3.requestId, q3.secret).status, 'expired');
  assert.throws(() => p.decide(q3.requestId, true));
  for (let i = 0; i < 3; i++) p.request({ name: `n${i}`, ip: 'x' });
  assert.throws(() => p.request({ name: 'over', ip: 'x' }), (e) => e.code === 'rate_limited');
  store.close();
});

test('이 PC의 프로세스 판정과 Origin', () => {
  const port = 47866;
  assert.equal(isLocalProcess(fakeReq({ host: `127.0.0.1:${port}` }), port), true);
  assert.equal(isLocalProcess(fakeReq({ host: `127.0.0.1:${port}`, origin: 'http://127.0.0.1:47866' }), port), false, '브라우저(Origin 있음)');
  assert.equal(isLocalProcess(fakeReq({ host: `127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }), port), false);
  assert.equal(isLocalProcess(fakeReq({ host: `127.0.0.1:${port}`, 'x-forwarded-for': '100.64.0.2' }), port), false, '앞단 프록시를 거친 요청');
  assert.equal(isLocalProcess(fakeReq({ host: `127.0.0.1:${port}`, 'tailscale-user-login': 'x' }), port), false);
  assert.equal(isLocalProcess(fakeReq({ host: `evil.example:${port}` }), port), false);
  assert.equal(isLocalProcess(fakeReq({ host: `127.0.0.1:${port}` }, '100.64.0.9'), port), false);
  assert.equal(isLocalProcess(fakeReq({ host: `127.0.0.1:${port}`, origin: 'file://' }), port, { allowFileOrigin: true }), true, 'Electron 창');
  assert.equal(isLocalProcess(fakeReq({ host: `127.0.0.1:${port}`, origin: 'file://' }), port), false);
  const hosts = allowedHosts(port, 'pc.tail.ts.net');
  assert.equal(originOk(fakeReq({ host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` }), hosts), true);
  assert.equal(originOk(fakeReq({ host: 'pc.tail.ts.net', origin: 'https://pc.tail.ts.net' }), hosts), true);
  assert.equal(originOk(fakeReq({ host: `localhost:${port}`, origin: `http://127.0.0.1:${port}` }), hosts), false, 'P59: Origin은 요청 Host와 같아야 한다');
  assert.equal(originOk(fakeReq({ origin: 'http://evil.example' }), hosts), false);
  assert.equal(originOk(fakeReq({}), hosts), false);
});

// 진짜 HTTP·WebSocket 서버로: 화면, /web/*, 연결 허락, 막힌 경로
async function boot() {
  const dir = tmp();
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Atrium</title>' + 'x'.repeat(4000));
  fs.writeFileSync(path.join(dist, 'renderer.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dist, 'fonts', 'a-HASH.woff2'), 'font');
  process.env.ATRIUM_WEB_DIST = dist;
  const store = storeIn(dir);
  const srv = http.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const cfg = { port, remoteEnabled: true, dataDir: dir, profile: 'dev', herdrSession: 'atrium-dev-test' };
  const web = new WebServer({ cfg, store, api: null, recentDirs: () => [dir] });
  const apiToken = 'board-api-token-for-test';
  let hooks = 0, branches = 0;
  const api = new ApiServer({ token: apiToken, handlers: { ...web.handlers(), 'ping': (p, c) => ({ kind: c.auth.kind }), 'events.subscribe': (p, c) => { c.subscribed = true; return {}; } }, authorize: (req) => web.authorize(req, apiToken), onClose: () => {} });
  web.api = api;
  srv.on('request', (req, res) => {
    const u = req.url.split('?')[0];
    if ((u === '/hooks/claude' || u.startsWith('/branch/')) && !isLocalProcess(req, port)) { res.writeHead(403); res.end(); return; }
    if (u === '/hooks/claude') { hooks++; res.writeHead(200); return res.end(); }
    if (u.startsWith('/branch/')) { branches++; res.writeHead(200); return res.end(); }
    if (web.handleHttp(req, res)) return;
    res.writeHead(404); res.end();
  });
  srv.on('upgrade', (req, s, h) => api.handleUpgrade(req, s, h));
  const base = `http://127.0.0.1:${port}`;
  const close = async () => { api.close(); web.stop(); await new Promise((r) => srv.close(r)); store.close(); delete process.env.ATRIUM_WEB_DIST; };
  return { dir, dist, port, base, web, api, apiToken, close, counts: () => ({ hooks, branches }) };
}
const req = (base, p, { method = 'GET', headers = {}, body } = {}) => fetch(base + p, { method, headers, body });
const wsOpen = (url, headers = {}) => new Promise((res) => {
  const ws = new WebSocket(url, { headers });
  ws.on('open', () => res({ ok: true, ws }));
  ws.on('unexpected-response', (_r, resp) => res({ ok: false, status: resp.statusCode }));
  ws.on('error', () => res({ ok: false }));
});
const wsCall = (ws, method, params = {}) => new Promise((res) => { const id = Math.random(); const on = (raw) => { const m = JSON.parse(String(raw)); if (m.id === id) { ws.off('message', on); res(m); } }; ws.on('message', on); ws.send(JSON.stringify({ id, method, params })); });

test('화면 파일: 캐시 머리글, ETag 304, gzip, 경로 넘기 막기, 다른 Host 막기, 빌드 없음', async () => {
  const b = await boot();
  try {
    let r = await req(b.base, '/');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('content-encoding'), 'gzip');
    const etag = r.headers.get('etag');
    assert.ok(etag);
    r = await req(b.base, '/', { headers: { 'if-none-match': etag } });
    assert.equal(r.status, 304);
    r = await req(b.base, '/fonts/a-HASH.woff2');
    assert.match(r.headers.get('cache-control'), /immutable/);
    assert.equal(cacheControl('renderer.js'), 'no-cache');
    assert.equal((await req(b.base, '/..%2Fboard.db')).status, 404);
    assert.equal((await req(b.base, '/.hidden')).status, 404);
    const evil = await new Promise((r) => http.get({ host: '127.0.0.1', port: b.port, path: '/', headers: { host: 'evil.example' } }, (x) => { x.resume(); r(x.statusCode); }));
    assert.equal(evil, 421, 'DNS 다시 묶기');
    fs.rmSync(path.join(b.dist, 'index.html'));
    r = await req(b.base, '/');
    assert.equal(r.status, 503);
    assert.match(await r.text(), /npm run build/);
    assert.equal(new StaticFiles(path.join(b.dir, 'nope')).built(), false);
  } finally { await b.close(); }
});

test('짝 맺기 전에는 API가 거부되고, 코드로 맺은 기기는 붙으며, 끊으면 곧바로 막힌다', async () => {
  const b = await boot();
  const origin = b.base;
  try {
    // 짝 맺기 전
    assert.equal((await req(b.base, '/web/me')).status, 401);
    assert.equal((await wsOpen(`ws://127.0.0.1:${b.port}/api?device=nope`, { origin })).ok, false);
    // 다른 사이트의 짝 맺기 시도
    assert.equal((await req(b.base, '/web/pair/code', { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{"code":"1"}' })).status, 403);
    // 판 API 토큰: 이 PC의 프로세스(Origin 없음)와 Electron(file://)은 되고, 브라우저 출처로는 안 된다
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    assert.equal(local.ok, true);
    assert.equal((await wsCall(local.ws, 'ping')).result.kind, 'local');
    assert.equal((await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`, { origin: 'file://' })).ok, true);
    assert.equal((await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`, { origin })).ok, false, '보드 토큰은 브라우저에서 쓰지 못한다');
    await wsCall(local.ws, 'events.subscribe');
    // PC가 코드를 만들고 브라우저가 넣는다
    const code = (await wsCall(local.ws, 'device.code')).result.code;
    // P56: 코드 → 등록 허가 → 패스키 등록 → 세션 쿠키(localhost: 패스키는 IP 주소에서 쓰지 못한다)
    const H = { host: `localhost:${b.port}`, origin: `http://localhost:${b.port}` };
    const reg = await pairAndRegister(b.port, code, H);
    assert.equal(reg.res.status, 200);
    const { device } = reg; const cookie = reg.cookie;
    const me = (await raw(b.port, '/web/me', { headers: { host: H.host, cookie } })).body;
    assert.equal(me.device.id, device.id);
    assert.equal(me.profile, 'dev');
    assert.ok(!JSON.stringify(me).includes(b.apiToken), '판 API 토큰을 내주지 않는다');
    // 기기로 WebSocket: Origin이 같아야 한다
    assert.equal((await wsOpen(`ws://127.0.0.1:${b.port}/api`, { cookie })).ok, false, 'Origin 없음');
    assert.equal((await wsOpen(`ws://127.0.0.1:${b.port}/api`, { cookie, origin: 'http://evil.example' })).ok, false);
    const dev = await wsOpen(`ws://127.0.0.1:${b.port}/api`, { host: H.host, origin: H.origin, cookie });
    assert.equal(dev.ok, true);
    assert.equal((await wsCall(dev.ws, 'ping')).result.kind, 'device');
    // 기기는 코드를 만들거나 허락하지 못한다
    assert.equal((await wsCall(dev.ws, 'device.code')).error.code, 'forbidden');
    assert.equal((await wsCall(dev.ws, 'device.approve', { id: 'x' })).error.code, 'forbidden');
    const dl = (await wsCall(dev.ws, 'device.list')).result;
    assert.equal(dl.me.id, device.id); assert.ok(!('requests' in dl));
    // 기기 토큰으로 hook·branch는 못 부른다(브라우저 요청, 다른 출처)
    assert.equal((await req(b.base, '/hooks/claude', { method: 'POST', headers: { origin, cookie }, body: '{}' })).status, 403);
    assert.equal((await req(b.base, '/branch/spawn', { method: 'POST', headers: { origin, cookie }, body: '{}' })).status, 403);
    assert.equal((await req(b.base, '/branch/spawn', { method: 'POST', headers: { 'x-forwarded-for': '100.64.0.2' }, body: '{}' })).status, 403);
    assert.equal((await req(b.base, '/hooks/claude', { method: 'POST', body: '{}' })).status, 200, '이 PC의 프로세스(Origin 없음)는 그대로');
    assert.deepEqual(b.counts(), { hooks: 1, branches: 0 });
    // 끊으면 열린 연결이 곧바로 닫히고 토큰이 막힌다
    const closed = new Promise((r) => dev.ws.on('close', (c) => r(c)));
    assert.equal((await wsCall(local.ws, 'device.revoke', { id: device.id })).result.revoked, true);
    assert.equal(await closed, 4401);
    assert.equal((await raw(b.port, '/web/me', { headers: { host: H.host, cookie } })).status, 401);
    assert.equal((await wsOpen(`ws://127.0.0.1:${b.port}/api`, { origin: H.origin, cookie })).ok, false);
    local.ws.close();
  } finally { await b.close(); }
});

test('허락 짝 맺기를 HTTP로: PC 창에 요청이 가고, 허락하면 브라우저가 등록 허가를 받는다', async () => {
  const b = await boot();
  const origin = b.base;
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    await wsCall(local.ws, 'events.subscribe');
    const ev = new Promise((r) => local.ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.event === 'device.updated' && m.data.requests && m.data.requests.length) r(m.data); }));
    const q = await (await req(b.base, '/web/pair/request', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'laptop' }) })).json();
    const seen = await ev;
    assert.equal(seen.requests[0].check, q.check);
    assert.equal((await (await req(b.base, `/web/pair/poll?id=${q.requestId}&secret=${q.secret}`, { headers: { origin } })).json()).status, 'pending');
    await wsCall(local.ws, 'device.approve', { id: q.requestId });
    const got = await (await req(b.base, `/web/pair/poll?id=${q.requestId}&secret=${q.secret}`, { headers: { origin } })).json();
    assert.equal(got.status, 'approved');
    const reg = await registerWithGrant(b.port, got.grant, { host: `127.0.0.1:${b.port}`, origin }); // 허가는 짝 맺기를 청한 출처에서만
    assert.equal(reg.res.status, 400, 'IP 주소의 페이지는 패스키를 쓰지 못한다'); assert.equal(reg.res.body.error.code, 'ip_host');
    local.ws.close();
  } finally { await b.close(); }
});

test('업로드: 기기만, 데이터 폴더 uploads/에 저장하고 PC 경로를 돌려준다, 크기 상한', async () => {
  const b = await boot();
  const origin = b.base;
  try {
    const d = b.web.devices.add({ name: 't', via: 'code', passkey: { credId: 'c', rpId: 'localhost' }, extra: { origin: 'local' } });
    const cookie = `atrium_${b.port}=${b.web.auth.sessions.create(d.id).id}`; // P56: 세션 쿠키
    assert.equal((await req(b.base, '/web/upload?name=a.png', { method: 'POST', headers: { origin }, body: 'x' })).status, 401);
    const r = await req(b.base, '/web/upload?name=' + encodeURIComponent('../../스크린 샷.png'), { method: 'POST', headers: { origin, cookie, 'content-type': 'image/png' }, body: Buffer.from([1, 2, 3]) });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(path.dirname(j.path), path.join(b.dir, 'uploads'));
    assert.match(path.basename(j.path), /^\d{8}-\d{6}-[0-9a-f]{6}-스크린 샷\.png$/);
    assert.deepEqual([...fs.readFileSync(j.path)], [1, 2, 3]);
    const big = await req(b.base, '/web/upload?name=big.bin', { method: 'POST', headers: { origin, cookie, 'content-length': String(UPLOAD_MAX_BYTES + 1) }, body: Buffer.alloc(UPLOAD_MAX_BYTES + 1) }).catch((e) => ({ status: 'err', e }));
    assert.ok(big.status === 413 || big.status === 'err');
    assert.equal(fs.readdirSync(path.join(b.dir, 'uploads')).length, 1, '넘친 파일은 남기지 않는다');
  } finally { await b.close(); }
});

test('업로드 이름과 정리', () => {
  assert.equal(safeUploadName('C:\\x\\..\\a b.png'), 'a b.png');
  assert.equal(safeUploadName('', 'image/png'), 'pasted.png');
  assert.equal(safeUploadName('...', 'image/jpeg'), 'pasted.jpg');
  assert.equal(safeUploadName('a<b>|c?.txt'), 'a_b__c_.txt');
  assert.ok(safeUploadName('x'.repeat(200) + '.png').length <= 80);
  assert.ok(safeUploadName('x'.repeat(200) + '.png').endsWith('.png'));
  const dir = tmp();
  const f = uploadPath(dir, 'p.png', 'image/png', new Date(2026, 10, 5, 9, 8, 7));
  assert.match(path.basename(f), /^20261105-090807-[0-9a-f]{6}-p\.png$/);
  const now = Date.now();
  const mk = (name, ageMs, size) => { const p = path.join(dir, name); fs.writeFileSync(p, Buffer.alloc(size)); const t = new Date(now - ageMs); fs.utimesSync(p, t, t); return p; };
  mk('old', 8 * 24 * 3600_000, 10);
  mk('mid', 2 * 3600_000, 60);
  const keep = mk('new', 1000, 60);
  const r = cleanupUploads(dir, { now, maxTotal: 100, keep });
  assert.equal(r.removed, 2, '오래된 것 하나, 총량이 넘쳐 다음으로 오래된 것 하나');
  assert.deepEqual(fs.readdirSync(dir), ['new']);
});

test('폴더 목록: 폴더만, 정렬, 숨김 뒤로, 위 폴더, 상대 경로와 없는 폴더는 오류', async () => {
  const dir = tmp();
  for (const d of ['b', 'A', '.git', 'c10', 'c9']) fs.mkdirSync(path.join(dir, d));
  fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
  const r = listDirs(dir);
  assert.deepEqual(r.dirs.map((x) => x.name), ['A', 'b', 'c9', 'c10', '.git']);
  assert.equal(r.parent, path.dirname(dir));
  assert.equal(r.dirs[0].path, path.join(dir, 'A'));
  assert.equal(listDirs(dir, { max: 2 }).truncated, true);
  assert.throws(() => listDirs('relative/x'), (e) => e.code === 'bad_path');
  assert.throws(() => listDirs(path.join(dir, 'nope')), (e) => e.code === 'not_found');
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const roots = (await wsCall(local.ws, 'fs.roots')).result;
    assert.ok(roots.drives.length >= 1);
    assert.deepEqual(roots.recent, [b.dir]);
    assert.equal((await wsCall(local.ws, 'fs.list', { path: dir })).result.dirs.length, 5);
    local.ws.close();
  } finally { await b.close(); }
});

test('드라이브 목록은 DriveInfo 출력에서 읽고, 실패하면 홈 드라이브', async () => {
  assert.deepEqual(parseDrives('C:\\\r\nd:\\\r\n\r\nnoise\n'), ['C:\\', 'D:\\']);
  assert.deepEqual(await driveRoots({ platform: 'linux' }), ['/']);
  const list = await driveRoots({ platform: 'win32', run: async () => { throw new Error('x'); }, fresh: true });
  assert.equal(list.length, 1);
});
