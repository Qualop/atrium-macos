// P59 단위 시험: P56(패스키·세션)·P57(Tailscale 기기 묶기)·P58(기록·끊기·원격 받기)을 합친 뒤의 이음새.
// 기기가 부를 수 있는 것(device.revoke·rename은 이 PC만, device.list는 자기 기록만, device.forget은 자기만), 거부가 까닭 코드와 함께 기록됨
// (세션 없음, 패스키 검증, 허가 틀림, Tailscale 기기), 끊긴 시각을 연결이 닫힌 때로 남김, 확인 차례(원격 받기가 먼저).
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
import { TailscaleWatch } from '../src/tailscale.mjs';
import { normalizePatch } from '../src/settings.mjs';
import { raw, pairAndRegister, registerWithGrant, loginWith } from './fake-authenticator.mjs';
import { fakeWhois } from './fake-tailnet.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p59-'));
const NAME = 'pc.example.ts.net';
const ORIGIN = `https://${NAME}`;
const A = '100.64.0.2', B = '100.64.0.3';
const viaServe = (ip = A) => ({ host: NAME, 'tailscale-user-login': 'me@example.com', 'x-forwarded-for': ip, 'x-forwarded-proto': 'https', 'x-forwarded-host': NAME, origin: ORIGIN });
const json = { 'content-type': 'application/json' };

async function boot() {
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
  const st = { remoteAccess: true };
  const web = new WebServer({ cfg: { remoteEnabled: true, port, dataDir: dir, profile: 'dev', herdrSession: 'atrium-dev-test' }, store, api: null, tailscale: tsw, settings: () => st, now });
  const apiToken = 'board-api-token-for-test';
  const settingsSet = (p) => { const was = web.accepting(); Object.assign(st, normalizePatch(p)); const on = web.accepting(); return { settings: { ...st }, ...(on !== was ? { remote: web.accessChanged(on) } : {}) }; };
  const api = new ApiServer({
    token: apiToken,
    handlers: { ...web.handlers(), 'events.subscribe': (p, c) => { c.subscribed = true; return {}; }, 'settings.set': (p, c) => { if (c.auth.kind !== 'local') throw Object.assign(new Error('forbidden'), { code: 'forbidden' }); return settingsSet(p); } },
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
async function pair(b, local, name, headers = viaServe()) {
  const code = (await wsCall(local.ws, 'device.code')).result.code;
  const r = await pairAndRegister(b.port, code, headers, { name });
  assert.equal(r.res.status, 200, JSON.stringify(r.res.body));
  return { device: r.device, cookie: r.cookie, auth: r.auth };
}
const openDev = (b, d, ip = A) => wsOpen(`ws://127.0.0.1:${b.port}/api`, { ...viaServe(ip), cookie: d.cookie });

test('기기가 부를 수 있는 것: device.revoke·rename은 forbidden, device.list는 자기 기록만, device.forget은 자기 짝만 푼다', async () => {
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    await wsCall(local.ws, 'events.subscribe');
    const a = await pair(b, local, 'Laptop A');
    const c = await pair(b, local, 'Laptop A tab 2');
    const da = await openDev(b, a);
    assert.equal(da.ok, true);
    await wsCall(da.ws, 'events.subscribe');
    // 다른 기기를 끊거나 이름을 바꾸지 못한다(자기 것도 이 PC에서만)
    for (const id of [c.device.id, a.device.id]) {
      assert.equal((await wsCall(da.ws, 'device.revoke', { id })).error.code, 'forbidden');
      assert.equal((await wsCall(da.ws, 'device.rename', { id, name: 'x' })).error.code, 'forbidden');
    }
    assert.equal(b.web.devices.all().length, 2, '아무 기기도 풀리지 않았다');
    assert.equal(b.web.devices.all().find((d) => d.id === c.device.id).name, 'Laptop A tab 2');
    // 목록: 자기 기록만(코드·요청·다른 기기 없음)
    const mine = (await wsCall(da.ws, 'device.list')).result;
    assert.deepEqual(mine.devices.map((d) => d.id), [a.device.id]); assert.equal(mine.me.id, a.device.id);
    assert.equal(mine.code, undefined); assert.equal(mine.requests, undefined);
    assert.ok(!('credId' in mine.devices[0].passkey) && !('publicKey' in mine.devices[0].passkey));
    // PC 창이 목록을 바꾸면 기기에 가는 알림도 자기 기록만
    await wsCall(local.ws, 'device.rename', { id: c.device.id, name: 'Renamed by PC' });
    await wait(80);
    const upd = da.events.filter((e) => e.event === 'device.updated').at(-1);
    assert.ok(upd); assert.deepEqual(upd.data.devices.map((d) => d.id), [a.device.id]); assert.equal(upd.data.code, undefined);
    // PC 창(판 API 토큰)은 그대로 다 본다
    assert.equal((await wsCall(local.ws, 'device.list')).result.devices.length, 2);
    // 이 브라우저 짝 풀기: 자기만, 연결은 4401로 닫히고 세션도 끝난다
    const closed = new Promise((r) => da.ws.on('close', (code) => r(code)));
    assert.equal((await wsCall(da.ws, 'device.forget', { id: c.device.id })).result.revoked, true, 'id를 넘겨도 자기만 푼다');
    assert.equal(await closed, 4401);
    assert.deepEqual(b.web.devices.all().map((d) => d.id), [c.device.id]);
    assert.equal(b.web.auth.sessions.countFor(a.device.id), 0);
    // PC 창은 device.forget을 부를 수 없다(기기가 아니다)
    assert.equal((await wsCall(local.ws, 'device.forget', {})).error.code, 'forbidden');
    local.ws.close();
  } finally { await b.close(); }
});

test('거부는 까닭 코드와 함께 연결 기록에: 세션 없음, 패스키 검증, 허가 틀림, Tailscale 기기(HTTP·WebSocket). connect 줄에 Tailscale 기기 이름', async () => {
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const a = await pair(b, local, 'Laptop A');
    const da = await openDev(b, a); assert.equal(da.ok, true); da.ws.close();
    // 세션 없음, 쿠키 없음, 옛 기기 토큰
    await raw(b.port, '/web/me', { headers: { ...viaServe(), cookie: `__Host-atrium_${b.port}=${'x'.repeat(43)}` } });
    await raw(b.port, '/web/me', { headers: viaServe() });
    await raw(b.port, '/web/me', { headers: { ...viaServe(), authorization: 'Bearer old-token' } });
    assert.equal((await wsOpen(`ws://127.0.0.1:${b.port}/api?device=old-token`, viaServe())).ok, false);
    // 패스키 검증 실패(다른 출처의 챌린지가 아닌, 쓰인 챌린지 다시 쓰기)
    const lg = await loginWith(b.port, a.auth, viaServe());
    assert.equal(lg.res.status, 200);
    const again = await raw(b.port, '/web/passkey/login', { method: 'POST', headers: { ...viaServe(), ...json }, body: JSON.stringify({ credential: lg.credential }) });
    assert.equal(again.status, 401); assert.equal(again.body.error.code, 'bad_challenge');
    // 허가 틀림: 없는 허가, A의 허가를 B에서
    await registerWithGrant(b.port, 'no-such-grant', viaServe());
    const code = (await wsCall(local.ws, 'device.code')).result.code;
    const g = await raw(b.port, '/web/pair/code', { method: 'POST', headers: { ...viaServe(A), ...json }, body: JSON.stringify({ code, name: 'grant' }) });
    assert.equal((await registerWithGrant(b.port, g.body.grant, viaServe(B))).res.body.error.code, 'grant_node');
    // Tailscale 기기: A의 세션을 B에서(HTTP·WebSocket), A의 서명을 B에서
    const me = await raw(b.port, '/web/me', { headers: { ...viaServe(B), cookie: lg.cookie } });
    assert.equal(me.status, 401); assert.equal(me.body.error.reason, 'other_node', '웹 화면이 짝 맺기 화면에 까닭을 보인다');
    assert.equal((await openDev(b, { cookie: lg.cookie }, B)).ok, false);
    assert.equal((await loginWith(b.port, a.auth, viaServe(B))).res.status, 401);
    await wait(50);
    const log = (await wsCall(local.ws, 'remote.log', { limit: 200 })).result.entries;
    const reasons = (ev) => log.filter((e) => e.event === ev).map((e) => e.reason);
    for (const r of ['no_session', 'no_credentials', 'device_token', 'passkey:bad_challenge', 'tailscale_node:other_node']) assert.ok(reasons('deny').includes(r), `deny ${r}: ${reasons('deny').join(',')}`);
    for (const r of ['bad_grant', 'grant_node']) assert.ok(reasons('pair.fail').includes(r), `pair.fail ${r}: ${reasons('pair.fail').join(',')}`);
    assert.ok(log.filter((e) => e.event === 'deny' && e.reason === 'tailscale_node:other_node').some((e) => e.addr === B), 'B 주소에서 온 거부');
    // 차례대로: 등록 허가 → 짝 맺음(패스키) → 연결(Tailscale 기기 이름) → 끊김 → 로그인
    const order = log.slice().reverse().map((e) => e.event).filter((e) => ['pair.grant', 'pair.ok', 'connect', 'disconnect', 'login'].includes(e));
    assert.deepEqual(order.slice(0, 5), ['pair.grant', 'pair.ok', 'connect', 'disconnect', 'login']);
    const conn = log.find((e) => e.event === 'connect');
    assert.equal(conn.node, 'laptop-a'); assert.equal(conn.deviceName, 'Laptop A');
    // 기록 파일에 비밀이 없다(세션 ID, 허가, 코드)
    b.web.remoteLog.flush();
    const text = fs.readFileSync(path.join(b.dir, 'remote-log.jsonl'), 'utf8');
    for (const s of [a.cookie.split('=')[1], lg.cookie.split('=')[1], g.body.grant, code, b.apiToken]) assert.ok(!text.includes(s));
    local.ws.close();
  } finally { await b.close(); }
});

test('끊긴 시각은 연결이 닫힌 때(15초 정리를 기다리지 않음), 원격 받기가 꺼져 있으면 세션 확인보다 먼저 막는다', async () => {
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const a = await pair(b, local, 'Laptop A');
    const da = await openDev(b, a); assert.equal(da.ok, true);
    const hash = b.web.deviceConns(a.device.id)[0].auth.session;
    // 연결이 열린 동안 시계를 10분 돌린 뒤 닫는다. 끊긴 시각은 닫은 때여야 한다(예전에는 마지막 15초 정리의 시각)
    b.clock.off = 10 * 60_000;
    const before = b.web.auth.sessions.map.get(hash).seenAt;
    da.ws.close(); await wait(100);
    const s = b.web.auth.sessions.map.get(hash);
    assert.ok(s.seenAt >= Date.now() + b.clock.off - 1000, '끊긴 시각 = 닫힌 때'); assert.ok(s.seenAt > before);
    // 끊긴 채 30분이 지나면 끝난다(닫힌 때부터 센다)
    b.clock.off += 29 * 60_000;
    assert.equal(b.web.auth.sessions.valid(hash), true);
    b.clock.off += 2 * 60_000;
    assert.equal(b.web.auth.sessions.valid(hash), false);
    // 원격 받기 끔: 세션이 없어도 까닭은 remote_blocked(세션 확인보다 먼저)
    await wsCall(local.ws, 'settings.set', { remoteAccess: false });
    assert.equal((await openDev(b, a)).ok, false);
    await wait(50);
    const log = (await wsCall(local.ws, 'remote.log', { limit: 50 })).result.entries;
    assert.equal(log.find((e) => e.event === 'deny').reason, 'remote_blocked');
    local.ws.close();
  } finally { await b.close(); }
});
