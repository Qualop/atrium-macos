// P49(원격 R3) 단위 시험: R1·R2를 합친 뒤의 인증과 클라이언트(기기 연결은 web), Tailscale 상태 읽기(가짜 JSON), Host 자동 허용,
// tailscale serve를 거친 요청은 hook·branch를 못 부름, 로그인 사용자 제한, atrium remote 진단(가짜 상태들)과 enable·disable 계획,
// 프레임 묶기, 원격 연결만 압축
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import { Store } from '../src/store.mjs';
import { ApiServer } from '../src/api.mjs';
import { WebServer, isLocalProcess } from '../src/web.mjs';
import { bindAuth, parseClientHello } from '../src/multiclient.mjs';
import { Peers, peerHandlers } from '../src/peers.mjs';
import { TerminalRelay } from '../src/relay.mjs';
import { FrameBatcher, mergeFrames } from '../src/frame-batch.mjs';
import { normalizePatch } from '../src/settings.mjs';
import {
  parseStatus, parseServe, readTailscale, tailscaleHosts, loginAllowed, isRemoteRequest, diagnose, TailscaleWatch,
  serveCommand, serveOffCommand, portConflict, freeHttpsPort, remoteUrl, proxiesTo, tailscaleBin, runTailscale,
} from '../src/tailscale.mjs';
import { planChange, formatStatus, guideText, localStatus } from '../bin/atrium-remote.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p49-'));
const PORT = 47868;
const NAME = 'pc.example.ts.net';

// 가짜 `tailscale status --json`(이름은 예시)
function fakeStatus({ state = 'Running', magic = true, https = true, login = 'me@example.com' } = {}) {
  return {
    Version: '1.0.0-test', BackendState: state,
    Self: { HostName: 'pc', DNSName: `${NAME}.`, UserID: 42, TailscaleIPs: ['100.64.0.1'] },
    MagicDNSSuffix: 'example.ts.net',
    CurrentTailnet: { Name: 'me@example.com', MagicDNSSuffix: 'example.ts.net', MagicDNSEnabled: magic },
    CertDomains: https ? [NAME] : null,
    User: { 42: { ID: 42, LoginName: login, DisplayName: 'Me' } },
    Health: [],
  };
}
function fakeServe({ board = true, other443 = false, funnel = false, port = PORT } = {}) {
  const web = {};
  if (other443) web[`${NAME}:443`] = { Handlers: { '/': { Proxy: 'http://127.0.0.1:7000' } } };
  if (board) web[`${NAME}:${other443 ? 8443 : 443}`] = { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } };
  return { TCP: { 443: { HTTPS: true } }, Web: web, ...(funnel ? { AllowFunnel: { [`${NAME}:${other443 ? 8443 : 443}`]: true } } : {}) };
}
const runner = (status, serve, calls = []) => async (bin, args) => {
  calls.push(args.join(' '));
  if (args[0] === 'status') { if (status instanceof Error) throw status; return JSON.stringify(status); }
  if (args[0] === 'serve') return JSON.stringify(serve);
  throw new Error('unexpected');
};
const tsOf = async (o = {}) => readTailscale({ port: PORT, bin: 'tailscale', run: runner(fakeStatus(o), fakeServe(o)) });

test('Tailscale 상태 읽기: 이름·tailnet·로그인·MagicDNS·HTTPS, serve 항목과 판으로 가는 것', async () => {
  const st = parseStatus(fakeStatus());
  assert.equal(st.running, true); assert.equal(st.loggedIn, true);
  assert.equal(st.dnsName, NAME, '끝 점을 뗀다');
  assert.equal(st.login, 'me@example.com'); assert.equal(st.magicDNS, true); assert.equal(st.https, true);
  assert.equal(parseStatus(fakeStatus({ state: 'NeedsLogin' })).loggedIn, false);
  assert.equal(parseStatus(fakeStatus({ https: false })).https, false);
  assert.equal(parseStatus(null).running, false);
  const sv = parseServe(fakeServe({ other443: true }), PORT);
  assert.equal(sv.entries.length, 2);
  assert.equal(sv.board.port, 8443);
  assert.equal(sv.entries.find((e) => e.port === 443).toBoard, false);
  assert.ok(proxiesTo(`http://localhost:${PORT}/`, PORT)); assert.ok(!proxiesTo(`https://127.0.0.1:${PORT}`, PORT)); assert.ok(!proxiesTo('http://127.0.0.1:1', PORT));
  // 한 번 읽기: 읽기 명령 둘만 부른다
  const calls = [];
  const ts = await readTailscale({ port: PORT, bin: 'tailscale', run: runner(fakeStatus(), fakeServe(), calls) });
  assert.deepEqual(calls, ['status --json', 'serve status --json']);
  assert.equal(ts.serve.board.port, 443);
  // 없거나 꺼져 있어도 던지지 않는다
  const none = await readTailscale({ port: PORT, bin: 'tailscale', run: runner(Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' }), {}) });
  assert.equal(none.installed, false);
  const down = await readTailscale({ port: PORT, bin: 'tailscale', run: runner(Object.assign(new Error('failed to connect to local tailscaled'), { code: 1 }), {}) });
  assert.equal(down.installed, true); assert.equal(down.status.running, false); assert.equal(down.serve, null);
  const off = await readTailscale({ port: PORT, bin: null });
  assert.equal(off.installed, false); assert.equal(off.disabled, true);
  assert.equal(tailscaleBin({ env: 'none' }), null);
  assert.equal(tailscaleBin({ env: '', platform: 'linux' }), 'tailscale');
  // 바꾸기 명령은 읽기 함수로 부르지 못한다
  await assert.rejects(runTailscale('tailscale', serveCommand(PORT)), /read-only/);
  await assert.rejects(runTailscale('tailscale', ['up']), /read-only/);
});

test('Host 자동 허용: Tailscale 이름(포트 없이, https 포트와 함께)', async () => {
  const ts = await tsOf();
  assert.deepEqual(tailscaleHosts(ts), [NAME, `${NAME}:443`]);
  const ts2 = await tsOf({ other443: true });
  assert.deepEqual(tailscaleHosts(ts2).sort(), [NAME, `${NAME}:443`, `${NAME}:8443`].sort());
  assert.deepEqual(tailscaleHosts({ status: { running: false } }), []);
  // TailscaleWatch가 읽으면 WebServer의 허용 목록에 저절로 들어간다
  const dir = tmp(); const store = new Store(path.join(dir, 'b.db'));
  let changed = 0;
  const w = new TailscaleWatch({ port: PORT, bin: 'tailscale', run: runner(fakeStatus(), fakeServe()), onChange: () => changed++ });
  const web = new WebServer({ cfg: { port: PORT, remoteEnabled: true, dataDir: dir, profile: 'dev' }, store, api: null, tailscale: w });
  assert.ok(!web.hosts.has(NAME));
  await w.refresh();
  assert.ok(web.hosts.has(NAME)); assert.ok(web.hosts.has(`127.0.0.1:${PORT}`));
  assert.equal(changed, 1);
  await w.refresh(); assert.equal(changed, 1, '같으면 다시 알리지 않는다');
  assert.equal(w.selfLogin(), 'me@example.com');
  web.stop(); w.stop(); store.close();
});

test('바깥 요청 판정과 로그인 사용자 제한', () => {
  const r = (headers) => ({ headers, socket: { remoteAddress: '127.0.0.1' } });
  assert.equal(isRemoteRequest(r({ host: `127.0.0.1:${PORT}` }), PORT), false);
  assert.equal(isRemoteRequest(r({ host: NAME }), PORT), true);
  assert.equal(isRemoteRequest(r({ host: `127.0.0.1:${PORT}`, 'tailscale-user-login': 'x' }), PORT), true);
  assert.equal(isRemoteRequest(r({ host: `127.0.0.1:${PORT}`, 'x-forwarded-for': '100.64.0.2' }), PORT), true);
  const pol = { sameUser: true, allowed: [], self: 'me@example.com', tsHosts: [NAME, `${NAME}:443`] };
  assert.equal(loginAllowed(r({ host: NAME, 'tailscale-user-login': 'ME@example.com' }), pol).ok, true, '대소문자 무시');
  assert.deepEqual(loginAllowed(r({ host: NAME, 'tailscale-user-login': 'other@example.com' }), pol), { ok: false, reason: 'other_user', login: 'other@example.com' });
  assert.equal(loginAllowed(r({ host: NAME, 'tailscale-user-login': 'other@example.com' }), { ...pol, allowed: ['other@example.com'] }).ok, true, '허용 목록');
  assert.equal(loginAllowed(r({ host: NAME, 'tailscale-user-login': 'other@example.com' }), { ...pol, sameUser: false }).ok, true, '끄면 받는다');
  assert.equal(loginAllowed(r({ host: NAME }), pol).reason, 'no_login', '태그 기기·funnel(머리글 없음)은 막는다');
  assert.equal(loginAllowed(r({ host: NAME }), { ...pol, sameUser: false }).ok, true);
  assert.equal(loginAllowed(r({ host: `127.0.0.1:${PORT}` }), pol).ok, true, '이 PC 안은 상관없다');
  assert.equal(loginAllowed(r({ host: NAME, 'tailscale-user-login': 'me@example.com' }), { ...pol, self: null }).reason, 'self_unknown', '이 PC의 로그인을 모르면 막는다');
  // 설정 값
  assert.deepEqual(normalizePatch({ remoteSameUser: 'off', remoteAllowedLogins: 'a@example.com, b@example.com' }), { remoteSameUser: false, remoteAllowedLogins: 'a@example.com, b@example.com' });
  assert.throws(() => normalizePatch({ remoteAllowedLogins: '<script>' }));
});

// ---------- HTTP·WebSocket으로: tailscale serve 흉내(Host, Tailscale 머리글, X-Forwarded-*) ----------
async function boot({ login = 'me@example.com', settings = {} } = {}) {
  const dir = tmp();
  const dist = path.join(dir, 'dist'); fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Atrium</title>');
  process.env.ATRIUM_WEB_DIST = dist;
  const store = new Store(path.join(dir, 'board.db'));
  const srv = http.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const tsw = new TailscaleWatch({ port, bin: 'tailscale', run: runner(fakeStatus({ login }), fakeServe({ port })) });
  await tsw.refresh();
  const cfg = { port, remoteEnabled: true, dataDir: dir, profile: 'dev', herdrSession: 'atrium-dev-test' };
  const st = { ...settings };
  const web = new WebServer({ cfg, store, api: null, tailscale: tsw, settings: () => st });
  const apiToken = 'board-api-token-for-test';
  const b = { peers: null };
  let hooks = 0, branches = 0;
  const api = new ApiServer({ token: apiToken, handlers: { ...web.handlers(), ...peerHandlers(b), 'whoami': (p, c) => ({ kind: c.auth.kind, remote: c.remote, clientId: c.clientId, clientKind: c.kind, name: c.name, deflate: c.ws.extensions || '' }), 'events.subscribe': (p, c) => { c.subscribed = true; return {}; } }, authorize: (req) => web.authorize(req, apiToken), onClose: () => {} });
  b.peers = new Peers({ api });
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
  const close = async () => { api.close(); b.peers.stop(); web.stop(); tsw.stop(); await new Promise((r) => srv.close(r)); store.close(); delete process.env.ATRIUM_WEB_DIST; };
  return { port, web, api, apiToken, st, close, counts: () => ({ hooks, branches }) };
}
// Host를 바꿀 수 있는 요청(fetch는 Host를 못 바꾼다)
const raw = (port, p, { method = 'GET', headers = {}, body } = {}) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (resp) => { const ch = []; resp.on('data', (d) => ch.push(d)); resp.on('end', () => { const t = Buffer.concat(ch).toString(); let j = null; try { j = JSON.parse(t); } catch {} res({ status: resp.statusCode, body: j, text: t }); }); });
  r.on('error', rej); if (body) r.write(body); r.end();
});
// tailscale serve가 넘기는 요청의 모양: Host는 원래 이름, 사용자 머리글, 전달 머리글(https://tailscale.com/kb/1312/serve)
const viaServe = (login = 'me@example.com', extra = {}) => ({ host: NAME, 'tailscale-user-login': login, 'tailscale-user-name': 'Someone', 'x-forwarded-for': '100.64.0.2', 'x-forwarded-proto': 'https', 'x-forwarded-host': NAME, ...extra });
const wsOpen = (url, headers = {}, opts = {}) => new Promise((res) => {
  const ws = new WebSocket(url, { headers, ...opts });
  ws.on('open', () => res({ ok: true, ws }));
  ws.on('unexpected-response', (_r, resp) => res({ ok: false, status: resp.statusCode }));
  ws.on('error', () => res({ ok: false }));
});
const wsCall = (ws, method, params = {}) => new Promise((res) => { const id = Math.random(); const on = (m0) => { const m = JSON.parse(String(m0)); if (m.id === id) { ws.off('message', on); res(m); } }; ws.on('message', on); ws.send(JSON.stringify({ id, method, params })); });

test('tailscale serve를 거친 요청: 같은 사용자만 짝 맺고 연결, 다른 Host는 421, hook·branch는 403', async () => {
  const b = await boot();
  const origin = `https://${NAME}`;
  try {
    // 화면 파일: Tailscale 이름은 허용, 모르는 이름은 421
    assert.equal((await raw(b.port, '/', { headers: viaServe() })).status, 200);
    assert.equal((await raw(b.port, '/', { headers: { ...viaServe(), host: 'evil.example.ts.net' } })).status, 421);
    // hook·branch: Tailscale 머리글·전달 머리글·바깥 Host가 있으면 막는다(세션 토큰이 있어도)
    for (const p of ['/hooks/claude', '/branch/spawn', '/branch/status']) {
      assert.equal((await raw(b.port, p, { method: 'POST', headers: viaServe(), body: '{}' })).status, 403, p);
      assert.equal((await raw(b.port, p, { method: 'POST', headers: { host: `127.0.0.1:${b.port}`, 'tailscale-user-login': 'me@example.com' }, body: '{}' })).status, 403, `${p} Tailscale 머리글만`);
      assert.equal((await raw(b.port, p, { method: 'POST', headers: { host: NAME }, body: '{}' })).status, 403, `${p} Host만`);
      assert.equal((await raw(b.port, p, { method: 'POST', headers: { host: `127.0.0.1:${b.port}`, 'x-forwarded-for': '100.64.0.2' }, body: '{}' })).status, 403, `${p} 전달 머리글만`);
    }
    assert.deepEqual(b.counts(), { hooks: 0, branches: 0 });
    // 판 API 토큰은 바깥에서 못 쓴다
    assert.equal((await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`, viaServe())).ok, false);
    // 짝 맺기: 같은 사용자
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const code = (await wsCall(local.ws, 'device.code')).result.code;
    // 다른 사용자는 코드가 맞아도 막힌다(코드를 쓰지도 않는다)
    const other = await raw(b.port, '/web/pair/code', { method: 'POST', headers: { ...viaServe('other@example.com'), origin, 'content-type': 'application/json' }, body: JSON.stringify({ code, name: 'x' }) });
    assert.equal(other.status, 403); assert.equal(other.body.error.code, 'tailscale_user');
    assert.equal((await raw(b.port, '/web/pair/request', { method: 'POST', headers: { ...viaServe('other@example.com'), origin, 'content-type': 'application/json' }, body: '{}' })).status, 403);
    // 머리글 없는 Tailscale 요청(태그 기기, funnel)도 막는다
    assert.equal((await raw(b.port, '/web/pair/code', { method: 'POST', headers: { host: NAME, origin, 'content-type': 'application/json' }, body: JSON.stringify({ code }) })).status, 403);
    const ok = await raw(b.port, '/web/pair/code', { method: 'POST', headers: { ...viaServe(), origin, 'content-type': 'application/json' }, body: JSON.stringify({ code, name: 'laptop' }) });
    assert.equal(ok.status, 200);
    const token = ok.body.token;
    // 연결: 같은 사용자 + 같은 출처(https://이름)만. 원격 연결로 표시되고 압축이 켜진다. 웹 클라이언트로 알아본다
    const dev = await wsOpen(`ws://127.0.0.1:${b.port}/api?device=${token}&client=laptop-tab-1&kind=desktop`, { ...viaServe(), origin });
    assert.equal(dev.ok, true);
    const who = (await wsCall(dev.ws, 'whoami')).result;
    assert.equal(who.kind, 'device'); assert.equal(who.remote, true);
    assert.equal(who.clientKind, 'web', '기기 연결은 kind=desktop을 보내도 web');
    assert.equal(who.clientId, 'laptop-tab-1'); assert.equal(who.name, 'laptop', '이름이 없으면 기기 이름');
    assert.match(who.deflate, /permessage-deflate/, '원격 연결만 압축');
    const lw = (await wsCall(local.ws, 'whoami')).result;
    assert.equal(lw.remote, false); assert.equal(lw.deflate, '', '이 PC 안 연결은 압축하지 않는다');
    // 다른 사용자는 기기 토큰이 있어도 연결하지 못한다
    assert.equal((await wsOpen(`ws://127.0.0.1:${b.port}/api?device=${token}`, { ...viaServe('other@example.com'), origin })).ok, false);
    // 허용 목록에 더하면 된다
    b.st.remoteAllowedLogins = 'other@example.com';
    assert.equal((await wsOpen(`ws://127.0.0.1:${b.port}/api?device=${token}`, { ...viaServe('other@example.com'), origin })).ok, true);
    // 진단(remote.status)은 이 판의 값으로
    const d = (await wsCall(local.ws, 'remote.status')).result;
    assert.equal(d.ready, true); assert.equal(d.url, `https://${NAME}/`); assert.deepEqual(d.allowed, ['other@example.com']);
    assert.ok(d.checks.find((c) => c.id === 'hosts').level === 'ok');
    assert.equal(d.checks.find((c) => c.id === 'devices').vars.n, 1);
    dev.ws.close(); local.ws.close();
  } finally { await b.close(); }
});

test('R1·R2 합친 뒤: 기기 클라이언트는 web, ID가 없으면 기기마다 하나, client.hello로도 desktop이 되지 않는다', async () => {
  assert.deepEqual(bindAuth(parseClientHello(new URLSearchParams('client=abcd&kind=desktop&name=n')), { kind: 'local' }), { clientId: 'abcd', name: 'n', kind: 'desktop' });
  assert.deepEqual(bindAuth(parseClientHello(new URLSearchParams('kind=desktop')), { kind: 'device', device: { id: 'dev1', name: 'Laptop' } }), { clientId: 'web-dev1', name: 'Laptop', kind: 'web' });
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}&client=pc-window&kind=desktop&name=PC`);
    const code = (await wsCall(local.ws, 'device.code')).result.code;
    const origin = `http://127.0.0.1:${b.port}`;
    const pr = await raw(b.port, '/web/pair/code', { method: 'POST', headers: { host: `127.0.0.1:${b.port}`, origin, 'content-type': 'application/json' }, body: JSON.stringify({ code, name: 'tab' }) });
    const dev = await wsOpen(`ws://127.0.0.1:${b.port}/api?device=${pr.body.token}`, { origin });
    const h = (await wsCall(dev.ws, 'client.hello', { client: 'tab-xyz1', kind: 'desktop' })).result;
    assert.equal(h.kind, 'web'); assert.equal(h.clientId, 'tab-xyz1');
    const list = (await wsCall(local.ws, 'clients.list')).result;
    assert.deepEqual(list.clients.map((c) => [c.clientId, c.kind]).sort(), [['pc-window', 'desktop'], ['tab-xyz1', 'web']]);
    assert.equal(list.me, 'pc-window');
    // 이 PC 안 브라우저는 원격이 아니다(압축·묶기 없음)
    assert.equal((await wsCall(dev.ws, 'whoami')).result.remote, false);
    // ping은 보낸 t를 돌려준다(왕복 지연)
    assert.equal((await wsCall(dev.ws, 'ping', { t: 123 })).result.t, 123);
    dev.ws.close(); local.ws.close();
  } finally { await b.close(); }
});

test('atrium remote 진단: 가짜 상태들', async () => {
  const ctx = (o = {}) => ({ port: PORT, hosts: [`127.0.0.1:${PORT}`, NAME], devices: 1, built: true, sameUser: true, allowed: [], ...o });
  const lv = (d, id) => d.checks.find((c) => c.id === id).level;
  // 다 됨
  let d = diagnose(await tsOf(), ctx());
  assert.equal(d.ready, true); assert.equal(d.url, `https://${NAME}/`); assert.equal(d.enable, null);
  // 없음
  d = diagnose({ installed: false }, ctx());
  assert.equal(lv(d, 'installed'), 'fail'); assert.equal(d.ready, false); assert.equal(d.url, null);
  // 꺼짐
  d = diagnose({ installed: true, status: { running: false, backendState: 'Stopped' } }, ctx());
  assert.equal(lv(d, 'running'), 'fail'); assert.equal(d.checks[1].vars.state, 'Stopped');
  // MagicDNS·HTTPS 꺼짐
  d = diagnose(await tsOf({ magic: false, https: false }), ctx());
  assert.equal(lv(d, 'magicdns'), 'fail'); assert.equal(lv(d, 'https'), 'fail');
  // serve가 판으로 가지 않음 → enable 명령
  d = diagnose(await tsOf({ board: false }), ctx());
  assert.equal(lv(d, 'serve'), 'fail'); assert.equal(d.enable, 'atrium remote enable --yes');
  // 443을 다른 서비스가 씀 → 주의, 다른 포트 제안
  d = diagnose(await tsOf({ board: false, other443: true }), ctx());
  assert.equal(lv(d, 'serve'), 'warn'); assert.match(d.enable, /--https-port 8443/);
  // funnel이 판에 켜져 있으면 안 됨
  d = diagnose(await tsOf({ funnel: true }), ctx());
  assert.equal(lv(d, 'funnel'), 'fail'); assert.equal(d.ready, false);
  // Host 목록에 없음, 기기 없음, 사용자 제한 끔
  d = diagnose(await tsOf(), ctx({ hosts: [], devices: 0, sameUser: false }));
  assert.equal(lv(d, 'hosts'), 'fail'); assert.equal(lv(d, 'devices'), 'warn'); assert.equal(lv(d, 'users'), 'warn');
  // 다른 포트로 serve 중이면 주소에 포트
  assert.equal(remoteUrl(await tsOf({ other443: true })), `https://${NAME}:8443/`);
  // 글
  const text = formatStatus({ ...diagnose(await tsOf({ board: false }), ctx()), port: PORT });
  assert.match(text, /\[안 됨\] tailscale serve가 판으로 가지 않습니다/);
  assert.match(text, /노트북에서 열 주소: https:\/\/pc\.example\.ts\.net\//);
  assert.match(guideText(PORT), /funnel/);
  assert.match(guideText(PORT), new RegExp(`serve --bg --https=443 http://127.0.0.1:${PORT}`));
  // 백엔드 없이 이 자리에서
  const ls = await localStatus({ port: PORT }, { run: runner(fakeStatus(), fakeServe()) });
  assert.equal(ls.offline, true); assert.equal(ls.checks.find((c) => c.id === 'devices').level, 'skip');
});

test('atrium remote enable·disable 계획: --yes 없이는 실행하지 않고, 다른 서비스의 포트를 덮어쓰지 않는다', async () => {
  assert.deepEqual(serveCommand(PORT), ['serve', '--bg', '--https=443', `http://127.0.0.1:${PORT}`]);
  assert.deepEqual(serveOffCommand(PORT, 8443), ['serve', '--https=8443', `http://127.0.0.1:${PORT}`, 'off']);
  assert.ok(!serveCommand(PORT).some((a) => /funnel/.test(a)));
  let p = planChange('enable', await tsOf({ board: false }), { port: PORT });
  assert.equal(p.run, false); assert.deepEqual(p.args, serveCommand(PORT));
  p = planChange('enable', await tsOf({ board: false }), { port: PORT, yes: true });
  assert.equal(p.run, true);
  p = planChange('enable', await tsOf({ board: false, other443: true }), { port: PORT, yes: true });
  assert.equal(p.run, false); assert.equal(p.stop, 'port_in_use'); assert.equal(p.free, 8443);
  p = planChange('enable', await tsOf({ board: false, other443: true }), { port: PORT, yes: true, httpsPort: 8443 });
  assert.equal(p.run, true); assert.deepEqual(p.args, serveCommand(PORT, 8443));
  assert.equal(planChange('enable', await tsOf(), { port: PORT, yes: true }).stop, 'already');
  assert.equal(planChange('enable', await tsOf({ board: false, https: false }), { port: PORT, yes: true }).stop, 'no_https');
  assert.equal(planChange('enable', { installed: false }, { port: PORT, yes: true }).stop, 'not_installed');
  p = planChange('disable', await tsOf({ other443: true }), { port: PORT, yes: true });
  assert.equal(p.run, true); assert.deepEqual(p.args, serveOffCommand(PORT, 8443), '판이 쓰는 포트를 끈다');
  assert.equal(planChange('disable', await tsOf({ board: false }), { port: PORT, yes: true }).stop, 'not_serving');
  assert.equal(portConflict(await tsOf({ other443: true }), PORT, 443).httpsPort, 443);
  assert.equal(freeHttpsPort(await tsOf()), 443);
});

test('프레임 묶기: 첫 프레임은 바로, 간격 안의 프레임은 합쳐서, full은 앞의 것을 덮고, 크기가 바뀌면 먼저 보낸다', () => {
  const B = (s) => Buffer.from(s).toString('base64');
  const T = (b) => Buffer.from(b, 'base64').toString();
  assert.equal(T(mergeFrames({ seq: 1, bytes: B('ab'), width: 80, height: 24 }, { seq: 2, bytes: B('cd'), width: 80, height: 24 }).bytes), 'abcd');
  assert.equal(mergeFrames({ seq: 1, bytes: B('a'), width: 80, height: 24 }, { seq: 2, bytes: B('b'), width: 100, height: 24 }), null);
  let t = 0; const timers = [];
  const sent = [];
  const fb = new FrameBatcher({ send: (f) => sent.push(f), intervalMs: 33, now: () => t, setTimer: (fn, ms) => { const x = { fn, at: t + ms }; timers.push(x); return x; }, clearTimer: (x) => { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); } });
  const run = () => { while (timers.length && timers[0].at <= t) timers.shift().fn(); };
  fb.push({ seq: 1, bytes: B('h'), width: 80, height: 24 });
  assert.equal(sent.length, 1, '쉬다가 온 첫 프레임은 바로');
  t = 5; fb.push({ seq: 2, bytes: B('e'), width: 80, height: 24 });
  t = 10; fb.push({ seq: 3, bytes: B('l'), width: 80, height: 24 });
  t = 20; fb.push({ seq: 4, bytes: B('l'), width: 80, height: 24 });
  assert.equal(sent.length, 1);
  t = 33; run();
  assert.equal(sent.length, 2); assert.equal(T(sent[1].bytes), 'ell'); assert.equal(sent[1].seq, 4); assert.equal(sent[1].merged, 3);
  // full이 오면 앞의 변경은 버린다
  t = 40; fb.push({ seq: 5, bytes: B('x'), width: 80, height: 24 });
  t = 45; fb.push({ seq: 6, bytes: B('FULL'), width: 80, height: 24, full: true });
  t = 66; run();
  assert.equal(T(sent[2].bytes), 'FULL'); assert.equal(sent[2].full, true);
  // 크기가 바뀌면 모은 것을 먼저
  t = 70; fb.push({ seq: 7, bytes: B('y'), width: 80, height: 24 });
  t = 71; fb.push({ seq: 8, bytes: B('z'), width: 120, height: 30 });
  assert.equal(T(sent[3].bytes), 'y');
  t = 120; run();
  assert.equal(T(sent[4].bytes), 'z'); assert.equal(sent[4].width, 120);
  // 100개를 1초 동안 고르게 → 초당 30번 안팎
  const s2 = []; let t2 = 0; const tm2 = [];
  const fb2 = new FrameBatcher({ send: (f) => s2.push(f), intervalMs: 33, now: () => t2, setTimer: (fn, ms) => { const x = { fn, at: t2 + ms }; tm2.push(x); return x; }, clearTimer: () => {} });
  for (let i = 0; i < 100; i++) { t2 = i * 10; while (tm2.length && tm2[0].at <= t2) tm2.shift().fn(); fb2.push({ seq: i, bytes: B('.'), width: 80, height: 24 }); }
  t2 = 2000; while (tm2.length) tm2.shift().fn();
  assert.ok(s2.length <= 32 && s2.length >= 25, `보낸 수 ${s2.length}`);
  assert.equal(s2.reduce((n, f) => n + T(f.bytes).length, 0), 100, '바이트를 잃지 않는다');
  // 간격 0이면 묶지 않는다
  const s3 = []; const fb3 = new FrameBatcher({ send: (f) => s3.push(f), intervalMs: 0 });
  fb3.push({ bytes: B('a') }); fb3.push({ bytes: B('b') }); assert.equal(s3.length, 2);
});

test('화면 중계: 원격 클라이언트만 묶고, 이 PC의 창은 바로 받는다', async () => {
  const { EventEmitter } = await import('node:events');
  const ctl = Object.assign(new EventEmitter(), { pid: 1, exited: null, resize() {}, input() {}, close() {} });
  const relay = new TerminalRelay({ adapter: { openController: () => ctl }, onInput: () => {}, remoteBatchMs: 30 });
  const mk = (remote) => { const got = []; return { got, clientId: remote ? 'web-1' : 'pc-1', remote, sendEvent: (e, d) => { if (e === 'terminal.frame') got.push(d); } }; };
  const pc = mk(false), web = mk(true);
  relay.attach({ sessionId: 's', paneId: 'p' }, 80, 24, pc);
  relay.attach({ sessionId: 's', paneId: 'p' }, 80, 24, web);
  const B = (s) => Buffer.from(s).toString('base64');
  ctl.emit('frame', { seq: 1, full: true, width: 80, height: 24, bytes: B('F') });
  for (let i = 2; i < 12; i++) ctl.emit('frame', { seq: i, width: 80, height: 24, bytes: B('d') });
  assert.equal(pc.got.length, 11);
  assert.equal(web.got.length, 1, '첫 full만 바로');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(web.got.length, 2);
  assert.equal(Buffer.from(web.got[1].bytes, 'base64').toString(), 'dddddddddd');
  assert.deepEqual(relay.stats()[0].batched, { in: 11, out: 2 });
  relay.detachClient(web); relay.detachClient(pc);
});
