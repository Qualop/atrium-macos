// P62 단위 시험: 패스키로 확인(판 설정 remotePasskey) 켜기·끄기.
// - 끔(기본): 짝 맺기(코드, 허락)만으로 세션, 오래 지나도 세션 유지, 끊기 뒤 다시 붙음, 원격 받기를 껐다 켜면 다시 붙음, 짝 풀기는 세션 끝, 다른 Tailscale 기기에서 쿠키 거부
// - 끔 → 켬: 패스키 등록 필요 표시, 지금 세션으로 등록(그 세션이 묶인 기기에서만), 등록 뒤 켬의 수명
// - 켬 → 끔: 살아 있는 세션의 수명이 늘어남, 패스키 기기는 패스키로 한 번 들어온 뒤 끔의 수명
// - 설정은 이 PC만 바꾼다. 켬은 P56~P60 시험(remotePasskey가 없는 설정 = 켬으로 본다)이 그대로 본다
// 이름과 주소는 예시(pc.example.ts.net, 100.64.0.x, me@example.com)만 쓴다
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
import { TailscaleWatch, diagnose } from '../src/tailscale.mjs';
import { normalizePatch, DEFAULTS, touchesRemoteRules } from '../src/settings.mjs';
import { formatLogEntry, checkText } from '../bin/atrium-remote.mjs';
import { raw, cookieOf, pairAndRegister, loginWith, FakeAuthenticator } from './fake-authenticator.mjs';
import { fakeWhois } from './fake-tailnet.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p62-'));
const NAME = 'pc.example.ts.net';
const ORIGIN = `https://${NAME}`;
const A = '100.64.0.2', B = '100.64.0.3';
const viaServe = (ip = A) => ({ host: NAME, 'tailscale-user-login': 'me@example.com', 'x-forwarded-for': ip, 'x-forwarded-proto': 'https', 'x-forwarded-host': NAME, origin: ORIGIN });
const json = { 'content-type': 'application/json' };
const DAY = 24 * 3600_000;
const maxAgeOf = (setCookies) => { const m = /Max-Age=(\d+)/.exec((setCookies || [])[0] || ''); return m ? Number(m[1]) : null; };

async function boot({ passkey = false } = {}) {
  const dir = tmp();
  const dist = path.join(dir, 'dist'); fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Atrium</title>');
  process.env.ATRIUM_WEB_DIST = dist;
  const store = new Store(path.join(dir, 'board.db'));
  const srv = http.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const tsw = new TailscaleWatch({ port, bin: 'tailscale', run: async (bin, args) => {
    const a = args.join(' ');
    if (a === 'status --json') return JSON.stringify({ BackendState: 'Running', Self: { DNSName: `${NAME}.`, UserID: 1 }, User: { 1: { LoginName: 'me@example.com' } }, CurrentTailnet: { MagicDNSEnabled: true }, CertDomains: [NAME] });
    if (a === 'serve status --json') return JSON.stringify({ Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } } } });
    if (args[0] === 'whois') { const w = fakeWhois(args[2]); if (!w) throw new Error('no match'); return JSON.stringify(w); }
    throw new Error('unexpected');
  } });
  await tsw.refresh();
  const clock = { off: 0 };
  const now = () => Date.now() + clock.off;
  // 판 설정(settings.mjs)처럼 모든 키가 있다. 기본은 패스키 끔
  const st = { ...DEFAULTS, remoteAccess: true, remotePasskey: passkey };
  const web = new WebServer({ cfg: { remoteEnabled: true, port, dataDir: dir, profile: 'dev', herdrSession: 'atrium-dev-test' }, store, api: null, tailscale: tsw, settings: () => st, now });
  const apiToken = 'board-api-token-for-test';
  // backend.mjs의 settings.set처럼: remote*는 이 PC만, 원격 받기·패스키로 확인이 바뀌면 알린다
  const settingsSet = (p, c) => {
    if (c && c.auth && c.auth.kind !== 'local' && touchesRemoteRules(p)) throw Object.assign(new Error('only the board on this PC can change remote access rules'), { code: 'forbidden' });
    const was = web.accepting(), wasPk = web.passkeyOn();
    Object.assign(st, normalizePatch(p));
    const on = web.accepting(), pk = web.passkeyOn();
    return { settings: { ...st }, ...(on !== was ? { remote: web.accessChanged(on) } : {}), ...(pk !== wasPk ? { passkey: web.passkeyChanged(pk) } : {}) };
  };
  const api = new ApiServer({
    token: apiToken,
    handlers: { ...web.handlers(), 'events.subscribe': (p, c) => { c.subscribed = true; return {}; }, 'settings.set': (p, c) => settingsSet(p, c) },
    authorize: (req) => web.authorize(req, apiToken),
    onOpen: (c) => web.clientOpened(c), onClose: (c) => web.clientClosed(c),
  });
  web.api = api;
  srv.on('request', (req, res) => { if (web.handleHttp(req, res)) return; res.writeHead(404); res.end(); });
  srv.on('upgrade', (req, s, h) => api.handleUpgrade(req, s, h));
  const close = async () => { api.close(); web.stop(); tsw.stop(); await new Promise((r) => srv.close(r)); store.close(); delete process.env.ATRIUM_WEB_DIST; };
  return { dir, port, web, api, apiToken, st, clock, store, close };
}
const wsOpen = (url, headers = {}) => new Promise((res) => {
  const ws = new WebSocket(url, { headers });
  const events = [];
  ws.on('message', (m) => { const j = JSON.parse(String(m)); if (j.event) events.push(j); });
  ws.on('open', () => res({ ok: true, ws, events }));
  ws.on('unexpected-response', (_r, resp) => res({ ok: false, status: resp.statusCode }));
  ws.on('error', () => res({ ok: false }));
});
const wsCall = (ws, method, params = {}) => new Promise((res) => { const id = Math.random(); const on = (m0) => { const m = JSON.parse(String(m0)); if (m.id === id) { ws.off('message', on); res(m); } }; ws.on('message', on); ws.send(JSON.stringify({ id, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (b, p, headers, obj) => raw(b.port, p, { method: 'POST', headers: { ...headers, ...json }, body: JSON.stringify(obj) });
const openDev = (b, cookie, ip = A) => wsOpen(`ws://127.0.0.1:${b.port}/api`, { ...viaServe(ip), cookie });
const me = (b, cookie, ip = A) => raw(b.port, '/web/me', { headers: { ...viaServe(ip), cookie } });
const lastDeny = async (b, local) => { await wait(30); return (await wsCall(local.ws, 'remote.log', { limit: 20 })).result.entries.find((e) => e.event === 'deny'); };
// 패스키 없이 코드로 짝 맺기(끔)
async function pairNoKey(b, local, name = 'Laptop A', ip = A) {
  const code = (await wsCall(local.ws, 'device.code')).result.code;
  const r = await post(b, '/web/pair/code', viaServe(ip), { code, name });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { res: r, device: r.body.device, cookie: cookieOf(r.cookies) };
}

test('끔: 코드로 짝 맺으면 패스키 등록 없이 기기와 세션 쿠키(HttpOnly, SameSite=Strict, https면 Secure·__Host-), 등록 허가는 남지 않는다', async () => {
  const b = await boot();
  try {
    assert.equal(DEFAULTS.remotePasskey, false, '기본은 끔');
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const a = await pairNoKey(b, local);
    assert.equal(a.res.body.paired, true); assert.equal(a.res.body.grant, undefined, '허가를 내주지 않는다');
    assert.equal(a.device.passkey, null); assert.equal(a.device.needsRepair, false); assert.equal(a.device.origin, 'tailscale'); assert.equal(a.device.tsNode.name, 'laptop-a');
    const c = a.res.cookies[0];
    assert.match(c, new RegExp(`^__Host-atrium_${b.port}=`)); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.match(c, /Secure/);
    assert.ok(maxAgeOf(a.res.cookies) >= 399 * 24 * 3600, '쿠키는 400일(끝이 없는 세션)');
    assert.equal(b.web.auth.grants.map.size, 0, '허가는 같은 응답에서 썼다');
    // 그 기기로 연결, /web/me는 쿠키를 다시 준다(쓰는 동안 늘어남)
    const da = await openDev(b, a.cookie); assert.equal(da.ok, true); da.ws.close();
    const m = await me(b, a.cookie); assert.equal(m.status, 200); assert.equal(m.body.passkey, false);
    assert.match(m.cookies[0], new RegExp(`^__Host-atrium_${b.port}=`)); assert.ok(maxAgeOf(m.cookies) >= 399 * 24 * 3600);
    // 목록: 패스키 등록 필요 아님
    const v = (await wsCall(local.ws, 'device.list')).result;
    assert.equal(v.passkey, false); assert.equal(v.devices[0].needsPasskey, false); assert.equal(v.devices[0].sessions, 1);
    // 기록: pair.ok(패스키 없이), 등록 허가 줄은 없다
    await wait(30);
    const log = (await wsCall(local.ws, 'remote.log', { limit: 50 })).result.entries;
    const ok = log.find((e) => e.event === 'pair.ok');
    assert.equal(ok.passkey, false); assert.equal(ok.via, 'code'); assert.equal(ok.node, 'laptop-a');
    assert.ok(!log.some((e) => e.event === 'pair.grant'));
    assert.match(formatLogEntry(ok), /패스키 없이/);
    // 기록 파일에 비밀(세션 ID)이 없다
    b.web.remoteLog.flush();
    assert.ok(!fs.readFileSync(path.join(b.dir, 'remote-log.jsonl'), 'utf8').includes(a.cookie.split('=')[1]));
    local.ws.close();
  } finally { await b.close(); }
});

test('끔: PC 허락으로 짝 맺으면 poll 응답에서 세션 쿠키, 요청을 보낸 Tailscale 기기에서만', async () => {
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const rq = await post(b, '/web/pair/request', viaServe(A), { name: 'Laptop A' });
    assert.equal(rq.status, 200);
    const pollUrl = `/web/pair/poll?id=${encodeURIComponent(rq.body.requestId)}&secret=${encodeURIComponent(rq.body.secret)}`;
    const id = (await wsCall(local.ws, 'device.list')).result.requests[0].id;
    await wsCall(local.ws, 'device.approve', { id });
    // 다른 Tailscale 기기(B)가 같은 비밀로 물으면 없는 요청
    const hb = { ...viaServe(B) }; delete hb.origin;
    const pb = await raw(b.port, pollUrl, { headers: hb });
    assert.equal(pb.status, 404); assert.equal(pb.cookies.length, 0);
    const h = { ...viaServe(A) }; delete h.origin; // 같은 출처 GET은 Origin이 없다
    const pa = await raw(b.port, pollUrl, { headers: { ...h, 'sec-fetch-site': 'same-origin' } });
    assert.equal(pa.status, 200, JSON.stringify(pa.body)); assert.equal(pa.body.status, 'approved'); assert.equal(pa.body.paired, true); assert.equal(pa.body.grant, undefined);
    assert.match(pa.cookies[0], new RegExp(`^__Host-atrium_${b.port}=.*HttpOnly.*SameSite=Strict.*Secure`));
    const cookie = cookieOf(pa.cookies);
    assert.equal((await openDev(b, cookie)).ok, true);
    assert.equal((await openDev(b, cookie, B)).ok, false, '다른 Tailscale 기기에서 쿠키 거부');
    // 한 번만
    assert.equal((await raw(b.port, pollUrl, { headers: h })).body.status, 'expired');
    await wait(30);
    const log = (await wsCall(local.ws, 'remote.log', { limit: 50 })).result.entries;
    const ok = log.find((e) => e.event === 'pair.ok'); assert.equal(ok.via, 'approve'); assert.equal(ok.passkey, false);
    local.ws.close();
  } finally { await b.close(); }
});

test('끔: 오래 지나도 세션 유지, 끊기 뒤 다시 붙음, 원격 받기를 껐다 켜면 다시 붙음, 짝 풀기는 세션 끝, 다른 Tailscale 기기에서 쿠키 거부', async () => {
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const a = await pairNoKey(b, local);
    // 끊긴 채 90일, 짝 맺은 뒤 200일
    b.clock.off = 90 * DAY;
    assert.equal(b.web.sweepSessions(), 0);
    assert.equal((await me(b, a.cookie)).status, 200);
    b.clock.off = 200 * DAY;
    const da = await openDev(b, a.cookie); assert.equal(da.ok, true);
    // 다른 Tailscale 기기(B)에서 쿠키: HTTP·WebSocket 거부, 세션은 그대로
    const mb = await me(b, a.cookie, B);
    assert.equal(mb.status, 401); assert.equal(mb.body.error.code, 'tailscale_node'); assert.equal(mb.body.error.reason, 'other_node');
    assert.equal((await openDev(b, a.cookie, B)).ok, false);
    assert.equal((await lastDeny(b, local)).reason, 'tailscale_node:other_node');
    // 끊기: 지금 연결만 4402로 닫고 세션은 남는다 → 곧 다시 붙는다
    const kicked = new Promise((r) => da.ws.on('close', (code) => r(code)));
    assert.equal((await wsCall(local.ws, 'device.disconnect', { id: a.device.id })).result.closed, 1);
    assert.equal(await kicked, 4402);
    assert.equal(b.web.auth.sessions.countFor(a.device.id), 1, '끊기 뒤 세션이 남는다');
    const d2 = await openDev(b, a.cookie); assert.equal(d2.ok, true, '끊기 뒤 다시 붙음');
    // 원격 받기 끄기: 거부하고 연결을 닫지만 세션은 남는다 → 켜면 다시 붙는다
    const blocked = new Promise((r) => d2.ws.on('close', (code) => r(code)));
    const off = (await wsCall(local.ws, 'settings.set', { remoteAccess: false })).result;
    assert.equal(off.remote.closed, 1); assert.equal(await blocked, 4403);
    assert.equal((await openDev(b, a.cookie)).ok, false);
    assert.equal((await me(b, a.cookie)).body.error.code, 'remote_blocked');
    assert.equal(b.web.auth.sessions.countFor(a.device.id), 1, '원격 막기 뒤 세션이 남는다');
    await wsCall(local.ws, 'settings.set', { remoteAccess: true });
    const d3 = await openDev(b, a.cookie); assert.equal(d3.ok, true, '원격 받기를 켜면 다시 붙음');
    // 짝 풀기: 세션 끝, 연결 4401
    const unpaired = new Promise((r) => d3.ws.on('close', (code) => r(code)));
    assert.equal((await wsCall(local.ws, 'device.revoke', { id: a.device.id })).result.revoked, true);
    assert.equal(await unpaired, 4401);
    assert.equal(b.web.auth.sessions.map.size, 0);
    assert.equal((await me(b, a.cookie)).status, 401);
    assert.equal((await openDev(b, a.cookie)).ok, false);
    local.ws.close();
  } finally { await b.close(); }
});

test('끔 → 켬: 패스키 등록 필요 표시, 연결은 4401, 지금 세션으로 등록(다른 기기의 세션·다른 Tailscale 기기는 거부), 등록 뒤 켬의 수명', async () => {
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    await wsCall(local.ws, 'events.subscribe');
    const a = await pairNoKey(b, local, 'Laptop A', A);
    const c = await pairNoKey(b, local, 'Laptop B', B);
    b.clock.off = 30 * DAY; // 끔인 동안 오래 지났다
    const da = await openDev(b, a.cookie); assert.equal(da.ok, true);
    const closed = new Promise((r) => da.ws.on('close', (code) => r(code)));
    const r = (await wsCall(local.ws, 'settings.set', { remotePasskey: true })).result;
    assert.equal(r.settings.remotePasskey, true); assert.equal(r.passkey.closed, 1);
    assert.equal(await closed, 4401, '패스키 없는 기기의 연결을 닫는다(웹 화면은 다시 열어 패스키 등록 화면으로)');
    // 목록과 PC 창 알림: 패스키 등록 필요
    const v = (await wsCall(local.ws, 'device.list')).result;
    assert.equal(v.passkey, true);
    assert.deepEqual(v.devices.map((d) => d.needsPasskey), [true, true]);
    assert.ok(local.events.some((e) => e.event === 'device.updated' && e.data.devices.every((d) => d.needsPasskey)));
    // 패스키가 없으면 보드를 쓰지 못한다: /web/me 401 passkey_required(passkey: true), WebSocket 거부, 업로드 거부
    const m = await me(b, a.cookie);
    assert.equal(m.status, 401); assert.equal(m.body.error.code, 'passkey_required'); assert.equal(m.body.error.passkey, true);
    assert.equal((await openDev(b, a.cookie)).ok, false);
    assert.equal((await lastDeny(b, local)).reason, 'passkey_required');
    assert.equal((await raw(b.port, '/web/upload?name=x.txt', { method: 'POST', headers: { ...viaServe(), cookie: a.cookie, 'content-type': 'text/plain' }, body: 'x' })).status, 401);
    // 켬이어도 패스키 없는 기기의 세션은 등록을 기다리며 남는다(끊긴 채 며칠)
    b.clock.off += 5 * DAY; b.web.sweepSessions();
    assert.equal(b.web.auth.sessions.countFor(a.device.id), 1);
    // 다른 Tailscale 기기(B)에서 A의 세션으로 등록: 거부
    const auth = new FakeAuthenticator();
    const ob = await post(b, '/web/passkey/enroll/options', { ...viaServe(B), cookie: a.cookie }, {});
    assert.equal(ob.status, 401); assert.equal(ob.body.error.code, 'tailscale_node'); assert.equal(ob.body.error.reason, 'other_node');
    // A의 챌린지에 B 기기의 세션으로 답하기: 거부(챌린지는 세션과 기기에 묶인다)
    const oa = await post(b, '/web/passkey/enroll/options', { ...viaServe(A), cookie: a.cookie }, { via: 'phone' });
    assert.equal(oa.status, 200); assert.deepEqual(oa.body.options.hints, ['hybrid']);
    const cred = new FakeAuthenticator().create(oa.body.options, { origin: ORIGIN });
    const wrong = await post(b, '/web/passkey/enroll', { ...viaServe(B), cookie: c.cookie }, { credential: cred });
    assert.equal(wrong.status, 401); assert.equal(wrong.body.error.code, 'bad_challenge');
    assert.equal(b.web.devices.get(c.device.id).passkey, null, 'B에 패스키가 붙지 않았다');
    // 쿠키 없이 등록: 거부
    assert.equal((await post(b, '/web/passkey/enroll/options', viaServe(A), {})).status, 401);
    // A의 세션으로 A에서 등록
    const oa2 = await post(b, '/web/passkey/enroll/options', { ...viaServe(A), cookie: a.cookie }, {});
    const en = await post(b, '/web/passkey/enroll', { ...viaServe(A), cookie: a.cookie }, { credential: auth.create(oa2.body.options, { origin: ORIGIN }) });
    assert.equal(en.status, 200, JSON.stringify(en.body));
    assert.equal(en.body.device.passkey.kind !== undefined, true); assert.equal(en.body.device.pairOnly, undefined);
    const ma = maxAgeOf(en.cookies); assert.ok(ma > 11 * 3600 && ma <= 12 * 3600, `쿠키는 켬의 수명(12시간): ${ma}`);
    // 두 번은 안 된다
    assert.equal((await post(b, '/web/passkey/enroll/options', { ...viaServe(A), cookie: a.cookie }, {})).body.error.code, 'has_passkey');
    // 이제 보드를 쓴다
    assert.equal((await me(b, a.cookie)).status, 200);
    const d2 = await openDev(b, a.cookie); assert.equal(d2.ok, true); d2.ws.close(); await wait(50);
    // 목록: A는 패스키(등록 필요 아님), B는 여전히 필요
    const v2 = (await wsCall(local.ws, 'device.list')).result;
    assert.equal(v2.devices.find((d) => d.id === a.device.id).needsPasskey, false);
    assert.equal(v2.devices.find((d) => d.id === c.device.id).needsPasskey, true);
    // 켬의 수명: 등록 뒤 12시간이 지나면 끝나고 패스키로 다시 확인
    b.clock.off += 13 * 3600_000; b.web.sweepSessions();
    assert.equal((await me(b, a.cookie)).status, 401);
    const lg = await loginWith(b.port, auth, viaServe(A));
    assert.equal(lg.res.status, 200, JSON.stringify(lg.res.body));
    assert.equal((await me(b, lg.cookie)).status, 200);
    // 기록: passkey.on, passkey.add
    await wait(30);
    const log = (await wsCall(local.ws, 'remote.log', { limit: 100 })).result.entries;
    assert.ok(log.some((e) => e.event === 'passkey.on'));
    const add = log.find((e) => e.event === 'passkey.add'); assert.ok(add); assert.equal(add.deviceId, a.device.id); assert.equal(add.node, 'laptop-a');
    local.ws.close();
  } finally { await b.close(); }
});

test('켬 → 끔: 살아 있는 세션은 끔의 수명으로 늘어나고 쿠키도 다시 받는다. 패스키 기기는 세션이 없으면 패스키로 한 번 들어온 뒤 끔의 수명', async () => {
  const b = await boot({ passkey: true });
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    // 켬: 짝 맺기는 지금처럼 등록 허가 → 패스키 등록
    const code = (await wsCall(local.ws, 'device.code')).result.code;
    const pr = await post(b, '/web/pair/code', viaServe(A), { code, name: 'Laptop A' });
    assert.equal(typeof pr.body.grant, 'string'); assert.equal(pr.cookies.length, 0, '켬이면 짝 맺기만으로는 쿠키가 없다');
    const code2 = (await wsCall(local.ws, 'device.code')).result.code;
    const a = await pairAndRegister(b.port, code2, viaServe(A), { name: 'Laptop A' });
    assert.equal(a.res.status, 200);
    const ma = maxAgeOf(a.res.cookies); assert.ok(ma <= 12 * 3600);
    b.clock.off = 11 * 3600_000;
    const r = (await wsCall(local.ws, 'settings.set', { remotePasskey: false })).result;
    assert.equal(r.settings.remotePasskey, false); assert.equal(r.passkey.closed, 0);
    await wait(30);
    const offLine = (await wsCall(local.ws, 'remote.log', { limit: 50 })).result.entries.find((e) => e.event === 'passkey.off');
    assert.ok(offLine); assert.match(formatLogEntry(offLine), /패스키 인증 사용 안 함/);
    // 12시간·끊긴 30분이 지나도 살아 있다
    b.clock.off = 40 * DAY; b.web.sweepSessions();
    const m = await me(b, a.cookie);
    assert.equal(m.status, 200); assert.ok(maxAgeOf(m.cookies) >= 399 * 24 * 3600, '쿠키를 끔의 수명으로 다시 받는다');
    // 끔이어도 끊기·원격 막기는 세션을 남긴다(패스키 기기도)
    await wsCall(local.ws, 'device.disconnect', { id: a.device.id });
    assert.equal(b.web.auth.sessions.countFor(a.device.id), 1);
    // 로그아웃 → 세션 없음 → 패스키로 한 번 들어온다 → 끔의 수명
    await post(b, '/web/logout', { ...viaServe(A), cookie: a.cookie }, {});
    assert.equal((await me(b, a.cookie)).status, 401);
    const lg = await loginWith(b.port, a.auth, viaServe(A));
    assert.equal(lg.res.status, 200); assert.equal(lg.res.body.expiresAt, null, '끝이 없는 세션');
    assert.ok(maxAgeOf(lg.res.cookies) >= 399 * 24 * 3600);
    b.clock.off += 100 * DAY; b.web.sweepSessions();
    assert.equal((await me(b, lg.cookie)).status, 200);
    // 패스키 기록은 지우지 않는다
    assert.ok(b.web.devices.all()[0].passkey && b.web.devices.all()[0].passkey.credId);
    // 끔이어도 다른 Tailscale 기기의 패스키 로그인은 세션을 만들지 않는다
    assert.equal((await loginWith(b.port, a.auth, viaServe(B))).res.status, 401);
    local.ws.close();
  } finally { await b.close(); }
});

test('켬 → 끔 → 켬: 다시 켜면 세션 수명을 지금부터 센다(12시간), 패스키 기기는 다시 확인 없이 이어서 쓴다', async () => {
  const b = await boot({ passkey: true });
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const a = await pairAndRegister(b.port, (await wsCall(local.ws, 'device.code')).result.code, viaServe(A), { name: 'Laptop A' });
    await wsCall(local.ws, 'settings.set', { remotePasskey: false });
    b.clock.off = 10 * DAY;
    await wsCall(local.ws, 'settings.set', { remotePasskey: true });
    assert.equal((await me(b, a.cookie)).status, 200);
    const da = await openDev(b, a.cookie); assert.equal(da.ok, true, '패스키 기기는 연결을 닫지 않는다'); da.ws.close(); await wait(30);
    b.clock.off += 13 * 3600_000; b.web.sweepSessions();
    assert.equal((await me(b, a.cookie)).status, 401, '켬의 12시간');
    local.ws.close();
  } finally { await b.close(); }
});

test('설정은 이 PC만 바꾼다: 기기가 remotePasskey를 바꾸면 forbidden. remote.status와 진단에 지금 값', async () => {
  const b = await boot();
  try {
    assert.equal(touchesRemoteRules({ remotePasskey: true }), true);
    assert.equal(touchesRemoteRules({ key: 'remotePasskey', value: true }), true);
    assert.equal(touchesRemoteRules({ language: 'ko' }), false);
    assert.deepEqual(normalizePatch({ remotePasskey: 'on' }), { remotePasskey: true });
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const a = await pairNoKey(b, local);
    const da = await openDev(b, a.cookie); assert.equal(da.ok, true);
    assert.equal((await wsCall(da.ws, 'settings.set', { remotePasskey: true })).error.code, 'forbidden');
    assert.equal((await wsCall(da.ws, 'settings.set', { key: 'remotePasskey', value: true })).error.code, 'forbidden');
    assert.equal(b.st.remotePasskey, false);
    // remote.status: passkey 값, 진단 줄
    let s = (await wsCall(local.ws, 'remote.status', {})).result;
    assert.equal(s.passkey, false); assert.ok(s.checks.some((c) => c.id === 'passkey_off' && c.level === 'ok'));
    assert.match(checkText(s.checks.find((c) => c.id === 'passkey_off'), b.port), /꺼짐/);
    await wsCall(local.ws, 'settings.set', { remotePasskey: true });
    s = (await wsCall(local.ws, 'remote.status', {})).result;
    assert.equal(s.passkey, true); assert.ok(s.checks.some((c) => c.id === 'passkey_on'));
    // 백엔드 없이 읽으면 모름
    assert.ok(diagnose(null, { port: 1 }).checks.some((c) => c.id === 'passkey' && c.level === 'skip'));
    local.ws.close();
  } finally { await b.close(); }
});

test('설정을 읽지 못하거나 값이 없으면 켬으로 본다(막는 쪽). 옛 토큰 기기는 끔이어도 다시 짝 맺기 필요', async () => {
  const b = await boot();
  try {
    const keep = b.web.settings;
    b.web.settings = () => { throw new Error('broken'); };
    assert.equal(b.web.passkeyOn(), true);
    b.web.settings = () => ({});
    assert.equal(b.web.passkeyOn(), true);
    b.web.settings = keep;
    assert.equal(b.web.passkeyOn(), false);
    // 옛 토큰 기기(P48~P55: hash만, passkey와 pairOnly 없음)
    b.store.setMeta('webDevices', [{ id: 'old-1', name: 'old', hash: 'x'.repeat(64), createdAt: 1 }]);
    assert.equal(b.web.devices.get('old-1').needsRepair, true);
    const v = b.web.view();
    assert.equal(v.devices[0].needsPasskey, false);
  } finally { await b.close(); }
});
