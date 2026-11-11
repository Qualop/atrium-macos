// P58(원격 강화 S4) 단위 시험: 연결 기록(남기기, 상한, 비밀 빠짐, 까닭 코드), 새로 붙음 알림(다시 연결은 알리지 않음),
// PC에서 연결 종료(그 기기의 연결만), 원격 받기 끄기(바깥 요청·기기 연결 거부, 붙은 연결 닫힘, 이 PC의 창과 CLI는 됨), device.disconnect·remote.log는 이 PC만.
// 이름과 주소는 예시(pc.example.ts.net, 100.64.0.x, user@example.com)만 쓴다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import { Store } from '../src/store.mjs';
import { ApiServer } from '../src/api.mjs';
import { WebServer } from '../src/web.mjs';
import { Peers, peerHandlers } from '../src/peers.mjs';
import { clientList } from '../src/multiclient.mjs';
import { normalizePatch } from '../src/settings.mjs';
import { TailscaleWatch } from '../src/tailscale.mjs';
import { RemoteLog, ConnectWatch, logEntry, browserOf, reasonCode, LOG_MAX_AGE_MS, RECONNECT_QUIET_MS } from '../src/remote-log.mjs';
import { formatStatus, formatLogEntry } from '../bin/atrium-remote.mjs';
import { pairAndRegister, loginWith } from './fake-authenticator.mjs'; // P59: P56의 패스키 흐름으로
import { fakeWhois } from './fake-tailnet.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p58-'));
const NAME = 'pc.example.ts.net';
const LOGIN = 'user@example.com';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

test('연결 기록: 정한 필드만 남기고, 비밀은 빠지며, 까닭은 코드 그대로(모르는 모양은 unknown)', () => {
  const e = logEntry('deny', { reason: 'login_other_user', deviceId: 'dev-1', deviceName: 'Laptop\n', login: 'User@Example.com', addr: '100.64.0.2', remote: true, browser: browserOf(CHROME), token: 'SECRET-TOKEN', code: '123456', secret: 'xyz', sessionId: 'sid-1', challenge: 'chal' }, 1000);
  assert.deepEqual(e, { at: 1000, event: 'deny', reason: 'login_other_user', deviceId: 'dev-1', deviceName: 'Laptop', login: 'user@example.com', addr: '100.64.0.2', browser: 'Chrome 130 · Windows', remote: true });
  for (const s of ['SECRET-TOKEN', '123456', 'xyz', 'sid-1', 'chal']) assert.ok(!JSON.stringify(e).includes(s), s);
  assert.equal(reasonCode('passkey_expired'), 'passkey_expired', 'P56·P57이 더하는 까닭도 그대로');
  assert.equal(reasonCode('bad reason with spaces'), 'unknown');
  assert.equal(logEntry('nope', {}).event, 'other');
  assert.equal(logEntry('connect', { addr: '127.0.0.1', remote: false }).addr, undefined, 'tailnet 주소는 바깥 요청만');
  assert.equal(logEntry('connect', { addr: 'not an ip', remote: true }).addr, undefined);
  assert.equal(browserOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'), 'Safari 17 · macOS');
  assert.equal(browserOf(''), null);
});

test('연결 기록: 상한(개수·30일), 되풀이 거부는 count로 합침, 파일에 남고 다시 읽음', () => {
  const dir = tmp();
  const file = path.join(dir, 'remote-log.jsonl');
  let t = 1_000_000;
  const appended = [];
  const lg = new RemoteLog({ file, now: () => t, max: 5, onAppend: (e) => appended.push(e) });
  for (let i = 0; i < 8; i++) { t += 1000; lg.add('connect', { deviceId: `d${i}` }); }
  assert.equal(lg.entries.length, 5, '최근 5개만');
  assert.equal(lg.list({ limit: 2 })[0].deviceId, 'd7', '최근 것부터');
  assert.equal(appended.length, 8);
  // 같은 거부가 30초 안에 되풀이되면 합친다
  t += 1000; lg.add('deny', { reason: 'host', remote: true, addr: '100.64.0.9' });
  t += 1000; lg.add('deny', { reason: 'host', remote: true, addr: '100.64.0.9' });
  t += 1000; lg.add('deny', { reason: 'host', remote: true, addr: '100.64.0.9' });
  assert.equal(lg.list({ limit: 1 })[0].count, 3);
  t += 1000; lg.add('deny', { reason: 'origin', remote: true, addr: '100.64.0.9' });
  assert.equal(lg.list({ limit: 1 })[0].reason, 'origin', '까닭이 다르면 새 줄');
  t += 60_000; lg.add('deny', { reason: 'origin', remote: true, addr: '100.64.0.9' });
  assert.equal(lg.list({ limit: 1 })[0].count, undefined, '30초가 지나면 새 줄');
  lg.flush();
  const again = new RemoteLog({ file, now: () => t, max: 5 });
  assert.deepEqual(again.list({ limit: 10 }), lg.list({ limit: 10 }));
  // 30일 지난 것은 지운다
  t += LOG_MAX_AGE_MS + 1;
  const old = new RemoteLog({ file, now: () => t });
  assert.equal(old.entries.length, 0);
  // 깨진 줄은 건너뛴다
  fs.writeFileSync(file, `{"at":${t},"event":"connect"}\nnot json\n{"event":"x"}\n`);
  assert.equal(new RemoteLog({ file, now: () => t }).entries.length, 1);
});

test('새로 붙음 알림: 연결이 없다가 생길 때만, 다시 연결(몇 분 안)과 기기 등록 직후 첫 연결은 알리지 않는다', () => {
  let t = 0;
  const w = new ConnectWatch({ now: () => t });
  assert.equal(w.opened('a'), true, '처음 붙음');
  assert.equal(w.opened('a'), false, '같은 기기의 둘째 탭');
  w.closed('a'); assert.equal(w.count('a'), 1);
  w.closed('a'); assert.equal(w.count('a'), 0);
  t += 10_000; assert.equal(w.opened('a'), false, '잠깐 끊겼다 다시 붙음');
  w.closed('a');
  t += RECONNECT_QUIET_MS + 1; assert.equal(w.opened('a'), true, '몇 분 뒤에 다시 붙으면 알린다');
  assert.equal(w.opened('b'), true, '다른 기기는 따로');
  w.paired('c'); t += 2000; assert.equal(w.opened('c'), false, '기기 등록 성공을 알렸으면 첫 연결은 알리지 않는다');
  assert.equal(w.opened(null), false);
});

// ---------- HTTP·WebSocket ----------
const runner = (port) => async (_bin, args) => {
  if (args[0] === 'status') return JSON.stringify({ Version: '1.0.0-test', BackendState: 'Running', Self: { HostName: 'pc', DNSName: `${NAME}.`, UserID: 42 }, CurrentTailnet: { Name: 'example', MagicDNSSuffix: 'example.ts.net', MagicDNSEnabled: true }, CertDomains: [NAME], User: { 42: { ID: 42, LoginName: LOGIN } } });
  // P59: P57 기기 확인의 whois(가짜 노트북 A·B는 이 시험의 로그인으로)
  if (args[0] === 'whois') { const w = fakeWhois(args[2]); if (!w) throw new Error('no match for IP'); return JSON.stringify(w.UserProfile.LoginName === 'me@example.com' ? { ...w, UserProfile: { ...w.UserProfile, LoginName: LOGIN } } : w); }
  return JSON.stringify({ TCP: { 443: { HTTPS: true } }, Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } } } });
};
async function boot() {
  const dir = tmp();
  const dist = path.join(dir, 'dist'); fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Atrium</title>');
  process.env.ATRIUM_WEB_DIST = dist;
  const store = new Store(path.join(dir, 'board.db'));
  const srv = http.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const tsw = new TailscaleWatch({ port, bin: 'tailscale', run: runner(port) });
  await tsw.refresh();
  const st = { remoteAccess: true };
  const web = new WebServer({ cfg: { remoteEnabled: true, port, dataDir: dir, profile: 'dev', herdrSession: 'atrium-dev-test' }, store, api: null, tailscale: tsw, settings: () => st });
  const apiToken = 'board-api-token-for-test';
  const b = { peers: null };
  const hooks = [];
  web.onDisconnectDevice((x) => hooks.push(x));
  // backend.mjs의 settings.set처럼: 원격 받기를 바꾸면 accessChanged
  const settingsSet = (p) => { const was = web.accepting(); Object.assign(st, normalizePatch(p)); const now = web.accepting(); return { settings: { ...st }, ...(now !== was ? { remote: web.accessChanged(now) } : {}) }; };
  const api = new ApiServer({
    token: apiToken,
    handlers: { ...web.handlers(), ...peerHandlers(b), 'events.subscribe': (p, c) => { c.subscribed = true; return {}; }, 'settings.set': (p, c) => { if (c.auth.kind !== 'local') throw Object.assign(new Error('forbidden'), { code: 'forbidden' }); return settingsSet(p); } },
    authorize: (req) => web.authorize(req, apiToken),
    onOpen: (c) => { web.clientOpened(c); b.peers && b.peers.opened(); }, onClose: (c) => { web.clientClosed(c); b.peers && b.peers.closed(); },
  });
  b.peers = new Peers({ api });
  web.api = api;
  srv.on('request', (req, res) => { if (web.handleHttp(req, res)) return; res.writeHead(404); res.end(); });
  srv.on('upgrade', (req, s, h) => api.handleUpgrade(req, s, h));
  const close = async () => { api.close(); b.peers.stop(); web.stop(); tsw.stop(); await new Promise((r) => srv.close(r)); store.close(); delete process.env.ATRIUM_WEB_DIST; };
  return { dir, port, web, api, apiToken, st, hooks, close };
}
const raw = (port, p, { method = 'GET', headers = {}, body } = {}) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (resp) => { const ch = []; resp.on('data', (d) => ch.push(d)); resp.on('end', () => { const t = Buffer.concat(ch).toString(); let j = null; try { j = JSON.parse(t); } catch {} res({ status: resp.statusCode, body: j, text: t }); }); });
  r.on('error', rej); if (body) r.write(body); r.end();
});
const viaServe = (extra = {}) => ({ host: NAME, 'tailscale-user-login': LOGIN, 'tailscale-user-name': 'Someone', 'x-forwarded-for': '100.64.0.2', 'x-forwarded-proto': 'https', 'x-forwarded-host': NAME, 'user-agent': CHROME, ...extra });
const wsOpen = (url, headers = {}) => new Promise((res) => {
  const ws = new WebSocket(url, { headers });
  const events = [];
  ws.on('message', (m) => { const j = JSON.parse(String(m)); if (j.event) events.push(j); });
  ws.on('open', () => res({ ok: true, ws, events }));
  ws.on('unexpected-response', (_r, resp) => res({ ok: false, status: resp.statusCode }));
  ws.on('error', () => res({ ok: false }));
});
const wsCall = (ws, method, params = {}) => new Promise((res) => { const id = Math.random(); const on = (m0) => { const m = JSON.parse(String(m0)); if (m.id === id) { ws.off('message', on); res(m); } }; ws.on('message', on); ws.send(JSON.stringify({ id, method, params })); });
const closed = (ws) => new Promise((r) => ws.on('close', (code) => r(code)));
const until = async (fn, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } return fn(); };
const ORIGIN = `https://${NAME}`;
// P59: 기기 등록 = 코드 → 등록 허가 → 패스키 등록(가짜 인증기) → 세션 쿠키. 돌려주는 것: { code, device, cookie, auth }
async function pairRemote(b, local, name, headers = { ...viaServe(), origin: ORIGIN }) {
  const code = (await wsCall(local.ws, 'device.code')).result.code;
  const r = await pairAndRegister(b.port, code, headers, { name });
  assert.equal(r.res.status, 200, JSON.stringify(r.res.body));
  return { code, device: r.device, cookie: r.cookie, auth: r.auth };
}
// 패스키로 다시 확인해 새 세션 쿠키를 받는다
async function relogin(b, dev, headers = { ...viaServe(), origin: ORIGIN }) { const r = await loginWith(b.port, dev.auth, headers); assert.equal(r.res.status, 200, JSON.stringify(r.res.body)); dev.cookie = r.cookie; return dev; }
const openDevice = (b, dev, extra = {}) => wsOpen(`ws://127.0.0.1:${b.port}/api`, { ...viaServe(extra), origin: ORIGIN, cookie: dev.cookie });
const LOCAL = (port) => ({ host: `localhost:${port}`, origin: `http://localhost:${port}`, 'user-agent': CHROME }); // 패스키는 IP 주소에서 쓰지 못한다

test('붙으면 알림: PC 창에만 remote.connected, 기기 등록 성공도, 다시 연결은 다시 알리지 않음', async () => {
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}&client=pc-window&kind=desktop`);
    await wsCall(local.ws, 'events.subscribe');
    const p1 = await pairRemote(b, local, 'Laptop');
    const notices = () => local.events.filter((e) => e.event === 'remote.connected').map((e) => e.data);
    await until(() => notices().length === 1);
    assert.equal(notices()[0].kind, 'paired'); assert.equal(notices()[0].device.name, 'Laptop'); assert.equal(notices()[0].remote, true); assert.equal(notices()[0].login, LOGIN);
    // 짝 맺은 바로 뒤 첫 연결은 알리지 않는다
    const d1 = await openDevice(b, p1);
    assert.equal(d1.ok, true);
    await wsCall(d1.ws, 'events.subscribe');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(notices().length, 1);
    // 다시 연결(잠깐 끊김)은 알리지 않는다
    d1.ws.close(); await new Promise((r) => setTimeout(r, 100));
    const d1b = await openDevice(b, p1);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(notices().length, 1);
    // 몇 분이 지난 것으로 치면 알린다
    b.web.watch.lastClosed.clear(); b.web.watch.lastNotice.clear();
    d1b.ws.close(); await new Promise((r) => setTimeout(r, 100)); b.web.watch.lastClosed.clear();
    const d1c = await openDevice(b, p1);
    await until(() => notices().length === 2);
    assert.equal(notices()[1].kind, 'connected');
    // 기기는 이 알림을 받지 않는다
    assert.ok(!d1.events.some((e) => e.event === 'remote.connected'));
    // 알약용 클라이언트 목록에 기기 ID와 바깥 연결이 있다
    const list = (await wsCall(local.ws, 'clients.list')).result.clients;
    const web = list.find((c) => c.kind === 'web');
    assert.equal(web.deviceId, p1.device.id); assert.equal(web.remote, true);
    assert.equal(list.find((c) => c.kind === 'desktop').deviceId, null);
    d1c.ws.close(); local.ws.close();
  } finally { await b.close(); }
});

test('PC에서 연결 종료: 그 기기의 연결만 닫고(4402), 기기는 다시 붙을 수 있다. 기기 등록 해제는 4401과 거부. device.disconnect·remote.log는 이 PC만', async () => {
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    await wsCall(local.ws, 'events.subscribe');
    const a = await pairRemote(b, local, 'Laptop');
    const c = await pairRemote(b, local, 'Tablet');
    const a1 = await openDevice(b, a), a2 = await openDevice(b, a), c1 = await openDevice(b, c);
    assert.ok(a1.ok && a2.ok && c1.ok);
    // 기기는 끊기와 기록을 부르지 못한다
    assert.equal((await wsCall(c1.ws, 'device.disconnect', { id: a.device.id })).error.code, 'forbidden');
    assert.equal((await wsCall(c1.ws, 'remote.log')).error.code, 'forbidden');
    assert.equal((await wsCall(c1.ws, 'settings.set', { remoteAccess: false })).error.code, 'forbidden');
    const a1c = closed(a1.ws), a2c = closed(a2.ws);
    let cClosed = false; c1.ws.on('close', () => { cClosed = true; });
    const r = (await wsCall(local.ws, 'device.disconnect', { id: a.device.id })).result;
    assert.equal(r.closed, 2);
    assert.equal(await a1c, 4402); assert.equal(await a2c, 4402);
    await new Promise((x) => setTimeout(x, 100));
    assert.equal(cClosed, false, '다른 기기는 그대로');
    assert.equal((await wsCall(local.ws, 'ping')).result.at > 0, true, 'PC 창도 그대로');
    assert.deepEqual(b.hooks, [{ id: a.device.id, reason: 'disconnect' }], '끊기 고리(P56 세션 끝내기)');
    assert.equal((await wsCall(local.ws, 'device.disconnect', { id: 'nope' })).error.code, 'not_found');
    // P59: 끊기는 그 기기의 세션도 끝낸다. 같은 쿠키로는 못 붙고, 패스키로 다시 확인하면 다시 붙을 수 있다
    assert.equal(b.web.auth.sessions.countFor(a.device.id), 0, '끊기 뒤 세션이 끝남');
    assert.equal(b.web.auth.sessions.countFor(c.device.id), 1, '다른 기기의 세션은 그대로');
    assert.equal((await openDevice(b, a)).ok, false, '끊은 세션 쿠키로는 못 붙는다');
    assert.equal((await raw(b.port, '/web/me', { headers: { ...viaServe(), cookie: a.cookie } })).body.error.code, 'login_required', '다시 확인 화면으로');
    await relogin(b, a);
    const a3 = await openDevice(b, a);
    assert.equal(a3.ok, true);
    // 기기 등록 해제: 4401, 그 뒤 거부
    const a3c = closed(a3.ws);
    assert.equal((await wsCall(local.ws, 'device.revoke', { id: a.device.id })).result.revoked, true);
    assert.equal(await a3c, 4401);
    assert.equal((await openDevice(b, a)).ok, false);
    assert.deepEqual(b.hooks.at(-1), { id: a.device.id, reason: 'revoke' });
    // 기록: 기기 등록 완료, 연결, PC에서 연결 종료, 끊김(까닭 pc), 기기 등록 해제, 거부(no_session). 비밀이 없다
    await new Promise((x) => setTimeout(x, 50));
    const log = (await wsCall(local.ws, 'remote.log', { limit: 100 })).result.entries;
    const ev = (name, f = () => true) => log.filter((e) => e.event === name && f(e));
    assert.equal(ev('pair.ok').length, 2); assert.equal(ev('pair.ok')[0].via, 'code');
    assert.equal(ev('connect', (e) => e.deviceId === a.device.id).length, 3);
    const conn = ev('connect')[0];
    assert.equal(conn.remote, true); assert.equal(conn.login, LOGIN); assert.equal(conn.addr, '100.64.0.2'); assert.equal(conn.browser, 'Chrome 130 · Windows');
    assert.equal(ev('kick')[0].n, 2);
    assert.equal(ev('disconnect', (e) => e.reason === 'pc').length, 2);
    assert.equal(ev('disconnect', (e) => e.reason === 'revoked').length, 1);
    assert.equal(ev('unpair')[0].deviceName, 'Laptop');
    assert.ok(ev('deny', (e) => e.reason === 'no_session').length >= 1);
    assert.equal(ev('login', (e) => e.deviceId === a.device.id).length, 1, '패스키로 다시 확인');
    assert.equal(conn.node, 'laptop-a', 'connect 줄에 Tailscale 기기 이름');
    b.web.remoteLog.flush();
    const text = fs.readFileSync(path.join(b.dir, 'remote-log.jsonl'), 'utf8');
    const sid = (ck) => ck.split('=')[1];
    for (const s of [sid(a.cookie), sid(c.cookie), a.code, c.code, b.apiToken]) assert.ok(!text.includes(s), '기록 파일에 비밀이 없다');
    c1.ws.close(); local.ws.close();
  } finally { await b.close(); }
});

test('원격 받기 끄기: 바깥 요청과 기기 연결 거부, 붙은 연결 닫힘(4403), 이 PC의 창과 CLI는 됨, 켜면 다시 됨', async () => {
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    await wsCall(local.ws, 'events.subscribe');
    const a = await pairRemote(b, local, 'Laptop');
    // 이 PC 안 브라우저도 기기다
    const code = (await wsCall(local.ws, 'device.code')).result.code;
    const lr = await pairAndRegister(b.port, code, LOCAL(b.port), { name: 'Here' });
    const lo = { device: lr.device, cookie: lr.cookie, auth: lr.auth };
    const localHdr = () => ({ host: `localhost:${b.port}`, origin: `http://localhost:${b.port}`, cookie: lo.cookie });
    const remoteDev = await openDevice(b, a);
    const localDev = await wsOpen(`ws://127.0.0.1:${b.port}/api`, localHdr());
    assert.ok(remoteDev.ok && localDev.ok);
    const rc = closed(remoteDev.ws), lc = closed(localDev.ws);
    await wsCall(local.ws, 'device.code'); // 남은 코드는 버린다
    const r = (await wsCall(local.ws, 'settings.set', { remoteAccess: false })).result;
    assert.equal(r.settings.remoteAccess, false); assert.equal(r.remote.closed, 2);
    assert.equal(await rc, 4403); assert.equal(await lc, 4403);
    assert.equal((await wsCall(local.ws, 'device.list')).result.code, null, '기기 등록 코드를 버린다');
    // 거부: 기기 연결(바깥·이 PC 안), /web/*(바깥·이 PC 안), 바깥 화면 요청
    assert.equal((await openDevice(b, a)).ok, false);
    assert.equal((await wsOpen(`ws://127.0.0.1:${b.port}/api`, localHdr())).ok, false);
    const me = await raw(b.port, '/web/me', { headers: { ...viaServe(), cookie: a.cookie } });
    assert.equal(me.status, 403); assert.equal(me.body.error.code, 'remote_blocked');
    assert.equal((await raw(b.port, '/web/me', { headers: { host: `localhost:${b.port}`, cookie: lo.cookie } })).body.error.code, 'remote_blocked');
    assert.equal((await loginWith(b.port, a.auth, { ...viaServe(), origin: ORIGIN })).res.status, 403, '막은 동안은 패스키 로그인도 거부');
    // P59: 원격 받기를 끄면 모든 기기의 세션이 끝난다
    assert.equal(b.web.auth.sessions.countFor(a.device.id) + b.web.auth.sessions.countFor(lo.device.id), 0, '원격 받기를 끄면 세션이 끝남');
    assert.equal((await raw(b.port, '/web/pair/request', { method: 'POST', headers: { ...viaServe(), origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' })).status, 403);
    const page = await raw(b.port, '/', { headers: viaServe() });
    assert.equal(page.status, 503); assert.match(page.text, /원격 접속이 차단되어 있습니다/);
    // 이 PC: 창(판 API 토큰)과 CLI 연결, 이 PC 안 화면 파일은 된다
    assert.equal((await wsCall(local.ws, 'ping')).result.at > 0, true);
    const cli = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    assert.equal(cli.ok, true); cli.ws.close();
    assert.equal((await raw(b.port, '/', { headers: { host: `127.0.0.1:${b.port}` } })).status, 200);
    // 진단에 보인다
    const d = (await wsCall(local.ws, 'remote.status')).result;
    assert.equal(d.accepting, false); assert.equal(d.ready, false);
    assert.match(formatStatus(d), /\[차단\] 원격 접속이 차단되어 있습니다/);
    // 켜면 다시 된다(P59: 끈 동안 끝난 세션은 패스키로 다시 확인한 뒤)
    assert.equal((await wsCall(local.ws, 'settings.set', { remoteAccess: true })).result.settings.remoteAccess, true);
    assert.equal((await openDevice(b, a)).ok, false, '옛 세션 쿠키는 끝났다');
    await relogin(b, a);
    const again = await openDevice(b, a);
    assert.equal(again.ok, true);
    assert.equal((await raw(b.port, '/web/me', { headers: { ...viaServe(), cookie: a.cookie } })).status, 200);
    assert.equal((await raw(b.port, '/', { headers: viaServe() })).status, 200);
    const d2 = (await wsCall(local.ws, 'remote.status')).result;
    assert.equal(d2.accepting, true); assert.equal(d2.connected, 1);
    assert.match(formatStatus(d2), /원격 접속 허용 \(현재 연결된 기기 1대\)/);
    // 기록: 끔·켬, 끊김(blocked), 거부(remote_blocked)
    await new Promise((x) => setTimeout(x, 50));
    const log = (await wsCall(local.ws, 'remote.log')).result.entries;
    assert.ok(log.some((e) => e.event === 'remote.block')); assert.ok(log.some((e) => e.event === 'remote.allow'));
    assert.equal(log.filter((e) => e.event === 'disconnect' && e.reason === 'blocked').length, 2);
    assert.ok(log.some((e) => e.event === 'deny' && e.reason === 'remote_blocked' && e.remote === true));
    assert.ok(log.some((e) => e.event === 'deny' && e.reason === 'remote_blocked' && e.remote === false));
    assert.deepEqual(b.hooks.filter((h) => h.reason === 'blocked').map((h) => h.id).sort(), [a.device.id, lo.device.id].sort());
    assert.ok(log.every((e) => typeof formatLogEntry(e) === 'string'));
    again.ws.close(); local.ws.close();
  } finally { await b.close(); }
});

test('거부 기록: Host, Origin, 다른 Tailscale 사용자, 틀린 코드, 판 API 토큰을 바깥에서', async () => {
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    await raw(b.port, '/', { headers: viaServe({ host: 'evil.example.ts.net' }) });
    await raw(b.port, '/web/pair/code', { method: 'POST', headers: { ...viaServe(), origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
    await raw(b.port, '/web/pair/code', { method: 'POST', headers: { ...viaServe({ 'tailscale-user-login': 'other@example.com' }), origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' });
    await wsCall(local.ws, 'device.code');
    await raw(b.port, '/web/pair/code', { method: 'POST', headers: { ...viaServe(), origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ code: '000000x' }) });
    await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`, viaServe());
    await wsOpen(`ws://127.0.0.1:${b.port}/api?device=whatever`, { ...viaServe(), origin: 'https://evil.example' });
    const log = (await wsCall(local.ws, 'remote.log')).result.entries;
    const reasons = log.filter((e) => e.event === 'deny').map((e) => e.reason);
    for (const r of ['host', 'origin', 'login_other_user', 'not_local']) assert.ok(reasons.includes(r), r);
    const fail = log.find((e) => e.event === 'pair.fail');
    assert.ok(['bad_code', 'no_code'].includes(fail.reason)); assert.equal(fail.login, LOGIN);
    assert.ok(!JSON.stringify(log).includes(b.apiToken));
    local.ws.close();
  } finally { await b.close(); }
});

test('클라이언트 목록: 기기 ID와 바깥 연결, 설정 remoteAccess는 참·거짓', () => {
  const list = clientList([{ clientId: 'w1', kind: 'web', name: 'L', connectedAt: 1, auth: { kind: 'device', device: { id: 'dev-9' } }, remote: true }, { clientId: 'pc', kind: 'desktop', connectedAt: 2, auth: { kind: 'local' } }]);
  assert.equal(list[0].deviceId, 'dev-9'); assert.equal(list[0].remote, true); assert.equal(list[1].deviceId, null);
  assert.deepEqual(normalizePatch({ remoteAccess: 'off' }), { remoteAccess: false });
});
