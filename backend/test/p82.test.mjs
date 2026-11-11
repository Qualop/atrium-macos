// P82 단위 시험: 휴대폰 원격 연결의 끊김. WebKit 판별(UA), 원격 소켓의 압축(WebKit은 없음, 그 밖은 있음, 실제 ws 클라이언트의 extensions),
// 끊김 기록 필드(닫힘 코드·까닭 글·붙어 있던 시간·압축·주고받은 수와 바이트·마지막으로 보낸 것의 종류와 크기, 내용은 없음), 창이 본 직전 닫힘(pc)의 전달.
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
import { TailscaleWatch } from '../src/tailscale.mjs';
import { logEntry } from '../src/remote-log.mjs';
import { isWebKitBrowser, WsStats, wsInfo, parsePrevClose, prevInfo, wsLabel, LAST_SENT } from '../src/remote-ws.mjs';
import { formatLogEntry } from '../bin/atrium-remote.mjs';
import { pairAndRegister } from './fake-authenticator.mjs';
import { fakeWhois } from './fake-tailnet.mjs';

const UA = {
  safariIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  ipadSafari: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  crios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  criosIpadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Safari/604.1',
  fxios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
  edgios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.0.2849.80 Mobile/15E148 Safari/605.1.15',
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:140.0) Gecko/20100101 Firefox/140.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0',
  androidGoogleApp: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.0.0 Mobile Safari/537.36 GSA/15.0',
  electron: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) atrium/0.1.4 Chrome/138.0.0.0 Electron/37.2.0 Safari/537.36',
  electronMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) atrium/0.1.4 Chrome/138.0.0.0 Electron/37.2.0 Safari/537.36',
  node: 'node',
};

test('WebKit 판별: Safari(iOS·macOS), iOS의 모든 브라우저, 데스크톱 모드 iPad는 WebKit. Chrome·Edge·Firefox·안드로이드·Electron·빈 UA는 아님', () => {
  for (const k of ['safariIOS', 'safariMac', 'ipadDesktop', 'ipadSafari', 'crios', 'criosIpadDesktop', 'fxios', 'edgios']) assert.equal(isWebKitBrowser(UA[k]), true, k);
  for (const k of ['chromeWin', 'chromeMac', 'edge', 'firefox', 'firefoxMac', 'androidChrome', 'androidFirefox', 'androidGoogleApp', 'electron', 'electronMac', 'node']) assert.equal(isWebKitBrowser(UA[k]), false, k);
  assert.equal(isWebKitBrowser(''), false); assert.equal(isWebKitBrowser(undefined), false); assert.equal(isWebKitBrowser(null), false);
});

test('소켓 통계와 기록 필드: 수·바이트·마지막으로 보낸 것(종류와 크기만), 모양이 다른 값은 버린다, 직전 닫힘 읽기', () => {
  let t = 1000;
  const s = new WsStats(() => t);
  s.received('{"id":1}', false); s.received(Buffer.from('abc'), true);
  for (let i = 0; i < 7; i++) { t += 10; s.sent(i === 6 ? Buffer.alloc(9) : JSON.stringify({ event: 'terminal.frame', data: 'x'.repeat(i * 100) })); }
  t += 500;
  const sum = s.summary({ code: 1006, reason: '', error: Object.assign(new Error('Invalid WebSocket frame'), { code: 'WS_ERR_UNEXPECTED_RSV_1' }), deflate: true });
  assert.equal(sum.code, 1006); assert.equal(sum.err, 'WS_ERR_UNEXPECTED_RSV_1'); assert.equal(sum.deflate, true);
  assert.equal(sum.in, 2); assert.equal(sum.inB, 11); assert.equal(sum.out, 7);
  assert.equal(sum.ms, 570); assert.equal(sum.sinceOut, 500);
  assert.equal(sum.last.length, LAST_SENT); assert.equal(sum.last[LAST_SENT - 1], 'b9'); assert.match(sum.last[0], /^t\d+$/);
  assert.ok(!JSON.stringify(sum).includes('terminal.frame'), '내용은 남기지 않는다');
  // wsInfo는 정한 필드만, 모양이 다르면 버린다
  assert.deepEqual(wsInfo({ code: 1000, why: 'bye\nnow', ms: 12.4, deflate: 0, last: ['t1', 'secret', 'b2'], secret: 'x', err: 'has space' }), { code: 1000, why: 'bye now', ms: 12, deflate: false, last: ['t1', 'b2'] });
  assert.equal(wsInfo(null), null); assert.equal(wsInfo({ code: -1 }), null);
  // 직전 닫힘(창의 lib/reconnect.js prevCloseParam 꼴)
  assert.deepEqual(parsePrevClose('1006.0.3400'), { code: 1006, clean: false, ms: 3400 });
  assert.deepEqual(parsePrevClose('timeout.0.23000'), { code: 'timeout', clean: false, ms: 23000 });
  assert.deepEqual(parsePrevClose('1000.1.5'), { code: 1000, clean: true, ms: 5 });
  for (const bad of ['', null, '1006', 'abc.0.1', '1006.2.1', '1006.0.-1', '1006.0.1;x', '99999.0.1']) assert.equal(parsePrevClose(bad), null, String(bad));
  assert.equal(prevInfo({ code: 'x' }), null);
  // 기록 한 줄
  const e = logEntry('disconnect', { deviceId: 'dev-1', reason: 'closed', ws: sum, token: 'SECRET' }, 5);
  assert.deepEqual(e.ws, sum); assert.ok(!JSON.stringify(e).includes('SECRET'));
  const c = logEntry('connect', { deviceId: 'dev-1', ws: { deflate: false }, prev: { code: 1006, clean: false, ms: 3400 } }, 6);
  assert.deepEqual(c.ws, { deflate: false }); assert.deepEqual(c.prev, { code: 1006, clean: false, ms: 3400 });
  assert.equal(logEntry('connect', { prev: 'nope' }).prev, undefined);
  assert.equal(wsLabel({ code: 1006, ms: 3400, deflate: true }), '1006 · 3.4s · deflate');
  assert.match(formatLogEntry(e), /소켓=1006 · WS_ERR_UNEXPECTED_RSV_1 · 0\.6s · deflate 보냄 7개/);
  assert.match(formatLogEntry(c), /직전 닫힘=1006 \(깨끗하지 않음\) 3\.4s/);
});

// ---------- 실제 ws 클라이언트로 원격 소켓 ----------
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p82-'));
const NAME = 'pc.example.ts.net';
const LOGIN = 'user@example.com';
const ORIGIN = `https://${NAME}`;
const runner = (port) => async (_bin, args) => {
  if (args[0] === 'status') return JSON.stringify({ Version: '1.0.0-test', BackendState: 'Running', Self: { HostName: 'pc', DNSName: `${NAME}.`, UserID: 42 }, CurrentTailnet: { Name: 'example', MagicDNSSuffix: 'example.ts.net', MagicDNSEnabled: true }, CertDomains: [NAME], User: { 42: { ID: 42, LoginName: LOGIN } } });
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
  const api = new ApiServer({
    token: apiToken,
    handlers: { ...web.handlers(), whoami: (p, c) => ({ remote: c.remote, deflate: c.ws.extensions || '' }), 'events.subscribe': (p, c) => { c.subscribed = true; return {}; }, big: () => ({ text: 'y'.repeat(4000) }) },
    authorize: (req) => web.authorize(req, apiToken),
    onOpen: (c) => web.clientOpened(c), onClose: (c) => web.clientClosed(c),
  });
  web.api = api;
  srv.on('request', (req, res) => { if (web.handleHttp(req, res)) return; res.writeHead(404); res.end(); });
  srv.on('upgrade', (req, s, h) => api.handleUpgrade(req, s, h));
  const close = async () => { api.close(); web.stop(); tsw.stop(); await new Promise((r) => srv.close(r)); store.close(); delete process.env.ATRIUM_WEB_DIST; };
  return { port, web, api, apiToken, close };
}
const viaServe = (ua) => ({ host: NAME, 'tailscale-user-login': LOGIN, 'tailscale-user-name': 'Someone', 'x-forwarded-for': '100.64.0.2', 'x-forwarded-proto': 'https', 'x-forwarded-host': NAME, 'user-agent': ua, origin: ORIGIN });
const wsOpen = (url, headers = {}) => new Promise((res) => {
  const ws = new WebSocket(url, { headers }); // ws 클라이언트는 기본으로 permessage-deflate를 바란다
  ws.on('open', () => res({ ok: true, ws }));
  ws.on('unexpected-response', (_r, resp) => res({ ok: false, status: resp.statusCode }));
  ws.on('error', () => res({ ok: false }));
});
const wsCall = (ws, method, params = {}) => new Promise((res) => { const id = Math.random(); const on = (m0) => { const m = JSON.parse(String(m0)); if (m.id === id) { ws.off('message', on); res(m); } }; ws.on('message', on); ws.send(JSON.stringify({ id, method, params })); });
const until = async (fn, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } return fn(); };

test('원격 소켓: Safari UA는 압축 없음, Chrome UA는 압축(extensions). 이 PC 안 연결은 그대로 압축 없음', async () => {
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const code = (await wsCall(local.ws, 'device.code')).result.code;
    const reg = await pairAndRegister(b.port, code, viaServe(UA.chromeWin), { name: 'Phone' });
    assert.equal(reg.res.status, 200, JSON.stringify(reg.res.body));
    const cases = [['safariIOS', ''], ['crios', ''], ['ipadDesktop', ''], ['chromeWin', 'permessage-deflate'], ['androidChrome', 'permessage-deflate'], ['firefox', 'permessage-deflate']];
    for (const [k, want] of cases) {
      const d = await wsOpen(`ws://127.0.0.1:${b.port}/api`, { ...viaServe(UA[k]), cookie: reg.cookie });
      assert.equal(d.ok, true, k);
      assert.equal(d.ws.extensions.startsWith(want), true, `${k}: 클라이언트가 받은 extensions ${JSON.stringify(d.ws.extensions)}`);
      if (!want) assert.equal(d.ws.extensions, '', k);
      const who = (await wsCall(d.ws, 'whoami')).result;
      assert.equal(who.remote, true, k); assert.equal(who.deflate.startsWith(want), true, k);
      d.ws.close(); await new Promise((r) => d.ws.once('close', r));
    }
    assert.equal(local.ws.extensions, '', '이 PC 안 연결은 압축하지 않는다');
    local.ws.close();
  } finally { await b.close(); }
});

test('끊김 기록: disconnect에 받은 닫힘 코드·까닭 글·붙어 있던 시간·압축·수·바이트·마지막으로 보낸 것, connect에 창이 본 직전 닫힘(pc)', async () => {
  const b = await boot();
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const code = (await wsCall(local.ws, 'device.code')).result.code;
    const reg = await pairAndRegister(b.port, code, viaServe(UA.safariIOS), { name: 'Phone' });
    const entries = () => b.web.remoteLog.list({ limit: 50 });
    // 1. Safari: 붙고, 메시지를 주고받고, 깨끗이 닫는다(4000, 'bye')
    const d1 = await wsOpen(`ws://127.0.0.1:${b.port}/api?client=phone-tab-1&kind=web`, { ...viaServe(UA.safariIOS), cookie: reg.cookie });
    assert.equal(d1.ok, true);
    const c1 = await until(() => entries().find((e) => e.event === 'connect'));
    assert.deepEqual(c1.ws, { deflate: false }); assert.equal(c1.prev, undefined, '처음 붙을 때는 직전 닫힘이 없다');
    await wsCall(d1.ws, 'events.subscribe'); await wsCall(d1.ws, 'big');
    d1.ws.close(4000, 'bye');
    const x1 = await until(() => entries().find((e) => e.event === 'disconnect'));
    assert.equal(x1.reason, 'closed'); assert.equal(x1.ws.code, 4000); assert.equal(x1.ws.why, 'bye'); assert.equal(x1.ws.deflate, false);
    assert.equal(x1.ws.in, 2); assert.ok(x1.ws.inB > 20); assert.equal(x1.ws.out, 2); assert.ok(x1.ws.outB > 4000, '큰 응답의 바이트');
    assert.ok(x1.ws.last.every((s) => /^t\d+$/.test(s)) && x1.ws.last.length === 2, JSON.stringify(x1.ws.last));
    assert.ok(Number.isInteger(x1.ws.ms) && x1.ws.ms >= 0); assert.ok(Number.isInteger(x1.ws.sinceOut));
    assert.ok(!JSON.stringify(x1).includes('yyyy'), '내용은 남지 않는다');
    // 2. 다시 붙으며 직전 닫힘을 알린다(창: 1006, 깨끗하지 않음, 3.4초). 그 연결은 갑자기 끊긴다(terminate → 서버는 1006)
    const d2 = await wsOpen(`ws://127.0.0.1:${b.port}/api?client=phone-tab-1&kind=web&pc=1006.0.3400`, { ...viaServe(UA.safariIOS), cookie: reg.cookie });
    const c2 = await until(() => entries().filter((e) => e.event === 'connect').length === 2 && entries()[0]);
    assert.equal(c2.event, 'connect'); assert.deepEqual(c2.prev, { code: 1006, clean: false, ms: 3400 });
    d2.ws.terminate();
    const x2 = await until(() => entries().filter((e) => e.event === 'disconnect').length === 2 && entries()[0]);
    assert.equal(x2.event, 'disconnect'); assert.equal(x2.ws.code, 1006, '갑자기 끊기면 서버가 받은 코드는 1006'); assert.equal(x2.ws.why, undefined);
    // 3. Chrome: 압축을 협상했다고 남는다. 이상한 pc 값은 버린다
    const d3 = await wsOpen(`ws://127.0.0.1:${b.port}/api?pc=nope`, { ...viaServe(UA.chromeWin), cookie: reg.cookie });
    const c3 = await until(() => entries().filter((e) => e.event === 'connect').length === 3 && entries()[0]);
    assert.deepEqual(c3.ws, { deflate: true }); assert.equal(c3.prev, undefined);
    d3.ws.close(1000);
    const x3 = await until(() => entries().filter((e) => e.event === 'disconnect').length === 3 && entries()[0]);
    assert.equal(x3.ws.code, 1000); assert.equal(x3.ws.deflate, true);
    // PC에서 끊으면 까닭은 pc, 코드는 서버가 보낸 4402 그대로
    const d4 = await wsOpen(`ws://127.0.0.1:${b.port}/api`, { ...viaServe(UA.safariIOS), cookie: reg.cookie });
    await until(() => entries().filter((e) => e.event === 'connect').length === 4);
    const closedCode = new Promise((r) => d4.ws.once('close', (c) => r(c)));
    b.web.disconnect(reg.device.id);
    assert.equal(await closedCode, 4402);
    const x4 = await until(() => entries().filter((e) => e.event === 'disconnect').length === 4 && entries().find((e) => e.event === 'disconnect'));
    assert.equal(x4.reason, 'pc'); assert.equal(x4.ws.code, 4402);
    local.ws.close();
  } finally { await b.close(); }
});
