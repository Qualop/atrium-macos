// P88 창 시험: 웹 푸시. 휴대폰(iPhone 흉내, Chromium) → 흉내 원격(ts-sim) → 백엔드(47897) → 흉내 푸시 서비스(로컬 https, 47899).
// - 진짜 푸시 서비스(Apple, Google)에는 닿지 않는다. 브라우저의 구독은 PushManager.subscribe를 흉내 내어 흉내 푸시 서비스의 주소와 시험이 쥔 키를 준다
//   (Playwright Chromium의 진짜 subscribe는 Google FCM에 등록하므로 부르지 않는다). 백엔드는 개발용 판만 ATRIUM_PUSH_TEST_ORIGINS·ATRIUM_PUSH_TEST_CA로 이 주소를 받는다.
// - 흉내 푸시 서비스가 받은 요청의 머리글(VAPID JWT 서명·aud·exp, k = 화면이 받은 공개 키, TTL, Content-Encoding, Urgency)과 풀어 본 내용(세션 이름과 종류만)을 본다.
// - 서비스 워커의 push는 CDP ServiceWorker.deliverPushMessage로 받은 내용을 그대로 넣어 보고(getNotifications), 누르기는 서비스 워커가 보내는 메시지와 ?open= 주소로 본다.
// 따로 띄운 개발용 판(atrium-dev-p88, 47897, backend/.dev)만 쓴다. PC 창은 띄우지 않는다. 결과는 experiments/p88/(git 밖).
// 실행: bash backend/.dev/clean-env.sh node app/test/e2e/p88-push.mjs
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p88');
const TLS = path.join(OUT, 'tls');
const CONVOS = path.join(OUT, 'convos');
const DIR = 'C:\\Workspace\\mtask-p88-a';
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A } = L;
const B0 = L.board({ session: 'atrium-dev-p88', port: 47897, sim: 47898, sim2: 47898 });
const PUSH_PORT = 47899;
const PUSH_ORIGIN = `https://localhost:${PUSH_PORT}`;
fs.mkdirSync(TLS, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true }); fs.mkdirSync(DIR, { recursive: true });
// 흉내 푸시 서비스의 인증서(localhost, 7일). 백엔드는 이것만 믿는다(ATRIUM_PUSH_TEST_CA)
if (!fs.existsSync(path.join(TLS, 'cert.pem'))) execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', path.join(TLS, 'key.pem'), '-out', path.join(TLS, 'cert.pem'), '-days', '7', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1'], { stdio: 'pipe' });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p88',
  ATRIUM_TEST_PREFIX: 'p88-none-',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim},localhost:${B0.sim}`,
  ATRIUM_PUSH_TEST_ORIGINS: PUSH_ORIGIN, ATRIUM_PUSH_TEST_CA: path.join(TLS, 'cert.pem'),
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
Object.assign(process.env, ENV);
const { logger, sleep, until } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
const WP = await import(toUrl(path.join(REPO, 'backend', 'src', 'web-push.mjs')));
const { chromium } = await import('playwright');

const log = logger('p88-push');
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const atriumOut = (...a) => { try { return { code: 0, out: atrium(...a) }; } catch (e) { return { code: e.status || 1, out: `${e.stdout || ''}${e.stderr || ''}` }; } };
// 흉내 푸시 서비스가 이 프로세스 안에 있으므로 보내기를 부르는 CLI는 기다리지 않고(execFile) 부른다
const atriumAsync = (...a) => new Promise((resolve) => execFile(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 }, (err, so, se) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${so || ''}${se || ''}` })));
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PHONE = { viewport: { width: 393, height: 852 }, screen: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: SAFARI, permissions: ['notifications'] };
const loadedOpen = (pg, ms = 60000) => pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: ms });
const splashGone = (pg) => pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
const shot = (pg, name) => pg.screenshot({ path: path.join(OUT, `${name}.png`) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
const view = (pg) => pg.evaluate(() => (document.querySelector('[data-role=phone]') || { dataset: {} }).dataset.view || null);

// ---- 흉내 푸시 서비스 ----
const sim = { got: [], next: [] };
const pushSrv = https.createServer({ key: fs.readFileSync(path.join(TLS, 'key.pem')), cert: fs.readFileSync(path.join(TLS, 'cert.pem')) }, (req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const status = sim.next.length ? sim.next.shift() : 201;
    sim.got.push({ at: Date.now(), method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks), status });
    res.writeHead(status); res.end();
  });
});
await new Promise((r) => pushSrv.listen({ port: PUSH_PORT, host: '::', ipv6Only: false }, r));

// 흉내 구독: 받는 쪽 키를 시험이 쥔다
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const AUTH = crypto.randomBytes(16);
const SUB = { endpoint: `${PUSH_ORIGIN}/push/p88-phone`, p256dh: ua.getPublicKey().toString('base64url'), auth: AUTH.toString('base64url') };
const open = (body) => JSON.parse(WP.decryptPayload(body, { uaPrivate: ua.getPrivateKey(), auth: AUTH }).toString());
const FAKE_PUSH = (s) => {
  window.__p88 = { opts: null, real: { subscribe: PushManager.prototype.subscribe } };
  let cur = null;
  const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  PushManager.prototype.getSubscription = async function () { return cur; };
  PushManager.prototype.subscribe = async function (opts) {
    const key = new Uint8Array(opts.applicationServerKey);
    window.__p88.opts = { userVisibleOnly: opts.userVisibleOnly, key: b64(key) };
    cur = { endpoint: s.endpoint, options: { applicationServerKey: key.buffer, userVisibleOnly: true }, toJSON: () => ({ endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } }), unsubscribe: async () => { cur = null; return true; } };
    return cur;
  };
};
const STANDALONE = () => { try { Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true }); } catch {} };

// 받은 요청 하나를 확인한다: VAPID(서명, aud, exp, k), TTL, 암호화 머리글
function checkRequest(r, publicKey) {
  const h = r.headers;
  const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(h.authorization || '');
  if (!m) return { ok: false, why: 'authorization', auth: (h.authorization || '').slice(0, 30) };
  const [hd, cl, sg] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(cl, 'base64url'));
  const kRaw = Buffer.from(m[2], 'base64url');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: kRaw.subarray(1, 33).toString('base64url'), y: kRaw.subarray(33).toString('base64url') }, format: 'jwk' });
  const sigOk = crypto.verify('sha256', Buffer.from(`${hd}.${cl}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url'));
  const left = claims.exp - Date.now() / 1000;
  const out = { sigOk, aud: claims.aud, sub: claims.sub, expLeftH: +(left / 3600).toFixed(2), kMatches: m[2] === publicKey, ttl: h.ttl, enc: h['content-encoding'], type: h['content-type'], urgency: h.urgency, len: r.body.length, alg: JSON.parse(Buffer.from(hd, 'base64url')).alg };
  out.ok = sigOk && claims.aud === PUSH_ORIGIN && left > 0 && left <= 24 * 3600 && out.kMatches && Number(h.ttl) > 0 && h['content-encoding'] === 'aes128gcm' && out.alg === 'ES256' && /^https:\/\//.test(claims.sub || '');
  return out;
}
const since = (t) => sim.got.filter((x) => x.at >= t);
const waitGot = (t, n, ms = 20000) => until(() => (since(t).length >= n ? since(t) : null), ms, 300).catch(() => since(t));

// ---- 판 ----
const trustStop = () => {
  const tr = sessions().find((s) => /^p88-/.test(s.name) && s.state === 'trust_wait');
  if (tr) { fs.writeFileSync(path.join(DEV, 'p88-need-trust.txt'), `${tr.name} asks the folder trust question in ${tr.cwd || '?'}\n`); throw new Error('trust question (backend/.dev/p88-need-trust.txt)'); }
};
async function setupBoard() {
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  if (st0.language !== 'ko') call('settings.set', { language: 'ko' }); // 한국어 화면과 알림 글
  const spawnIn = (...a) => JSON.parse(atrium('--json', 'spawn', DIR, ...a));
  if (!byName('p88-a')) spawnIn('--model', 'haiku', '--name', 'p88-a');
  if (!byName('p88-sh')) spawnIn('--kind', 'shell', '--name', 'p88-sh');
  await until(() => { const s = byName('p88-a'); return s && ['ready', 'trust_wait'].includes(s.state) ? s : null; }, 150000, 1500).catch(() => null);
  trustStop();
  log(`세션 ${sessions().filter((s) => /^p88-/.test(s.name)).map((s) => `${s.name}:${s.state}`).join(' ')}`);
}
const state = (n) => (byName(n) || {}).state;
// 한 턴: 보내고 새 답이 나올 때까지(ready) 또는 묻는 데까지(waiting)
async function turn(text, want = 'ready') {
  const a0 = byName('p88-a').lastAnswerAt || 0;
  atrium('send', '@p88-a', text);
  await until(() => { const s = byName('p88-a'); return s && (want === 'ready' ? s.state === 'ready' && (s.lastAnswerAt || 0) > a0 : s.state === want) ? s : null; }, 150000, 600).catch(() => {});
  trustStop();
  return state('p88-a');
}
const SECRET_WORD = 'zebrap88';
const DONE_PROMPT = (i) => `Reply with only the single word ${SECRET_WORD}${i}. Do not use any tools.`;
const ASK = 'Use the Bash tool to run exactly: mkdir p88-ask-dir . Then reply with the single word done.';

let ts; let browser;
const metrics = {};
try {
  await setupBoard();
  ts = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); ts.cfg.ip = LAPTOP_A;
  await ts.ready;
  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const chromeExe = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  browser = await chromium.launch({ headless: true, ...(chromeExe ? { executablePath: chromeExe } : { channel: 'chromium' }) });
  const BASE = `http://localhost:${B0.sim}`;
  const ctx = await browser.newContext(PHONE);
  let pg = await ctx.newPage();
  pg.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  pg.on('console', (x) => { if (x.type() === 'error') log(`[console.error] ${x.text().slice(0, 200)}`); });
  // 짝 맺기(패스키 끔)
  await pg.goto(`${BASE}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await pg.fill('[data-field=pair-code]', call('device.code').code);
  await pg.click('[data-action=pair-submit]');
  await loadedOpen(pg); await splashGone(pg); await sleep(1500);
  const devId = call('device.list').devices[0].id;

  // 1. 홈 화면 앱이 아니면(iOS Safari 탭) 추가하는 방법
  await pg.click('[data-action=phone-push]');
  await pg.waitForSelector('[data-role=phone-push-sheet]');
  const s1 = await pg.evaluate(() => ({ key: document.querySelector('[data-role=push-line]').dataset.key, steps: document.querySelectorAll('[data-role=push-install] li').length, main: !!document.querySelector('[data-role=push-main]'), text: document.querySelector('[data-role=push-line]').textContent }));
  check('iOS 탭(홈 화면 앱 아님): "홈 화면에 추가한 앱에서 알림을 받을 수 있습니다"와 추가 방법 세 단계, 켜기 단추 없음', s1.key === 'push.support_install' && s1.steps === 3 && !s1.main && /홈 화면에 추가한 앱/.test(s1.text), s1);
  await shot(pg, '01-install-hint');

  // 2. 홈 화면 앱 흉내(standalone) + 흉내 구독
  await ctx.addInitScript(STANDALONE);
  await ctx.addInitScript(FAKE_PUSH, SUB);
  await pg.reload(); await loadedOpen(pg); await splashGone(pg); await sleep(1500);
  const sw = await pg.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, active: !!r.active }; }).catch((e) => ({ err: e.message }));
  check('서비스 워커가 활성(홈 화면 앱 흉내)', sw.active === true, sw);
  await pg.click('[data-action=phone-push]');
  await pg.waitForFunction(() => { const i = document.querySelector('[data-role=push-main] input'); return i && !i.disabled; }, null, { timeout: 15000 });
  let line = await pg.getAttribute('[data-role=push-line]', 'data-key');
  check('홈 화면 앱: 알림 꺼짐 상태, 켜기 단추 쓸 수 있음', line === 'push.off', line);
  // 권한 거절
  await pg.evaluate(() => { window.__p88.perm = Object.getOwnPropertyDescriptor(Notification, 'permission'); window.__p88.req = Notification.requestPermission; Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'denied' }); Notification.requestPermission = () => Promise.resolve('denied'); });
  await pg.click('[data-role=push-main] input');
  await pg.waitForSelector('[data-role=push-error]', { timeout: 10000 });
  const den = await pg.evaluate(() => ({ err: document.querySelector('[data-role=push-error]').textContent, line: document.querySelector('[data-role=push-line]').dataset.key, on: document.querySelector('[data-role=push-main] input').checked }));
  check('권한 거절: 알아듣게 알리고(설정에서 허용) 켜지지 않는다', /권한이 거부/.test(den.err) && den.line === 'push.denied' && !den.on, den);
  await shot(pg, '02-denied');
  await pg.evaluate(() => { delete Notification.requestPermission; Object.defineProperty(Notification, 'permission', window.__p88.perm); if (Notification.requestPermission !== window.__p88.req) Notification.requestPermission = window.__p88.req; });
  await pg.click('[data-action=phone-push-close]');
  // 켜기(공개 키는 화면이 받은 것과 머리글의 k를 비교한다)
  await pg.click('[data-action=phone-push]');
  await pg.waitForFunction(() => { const i = document.querySelector('[data-role=push-main] input'); return i && !i.disabled; }, null, { timeout: 15000 });
  await pg.click('[data-role=push-main] input');
  await pg.waitForFunction(() => document.querySelector('[data-role=push-line]').dataset.key === 'push.on', null, { timeout: 15000 }).catch(() => {});
  const on = await pg.evaluate(() => ({ line: document.querySelector('[data-role=push-line]').dataset.key, opts: window.__p88.opts, kinds: [...document.querySelectorAll('[data-role^=push-kind-] input')].map((i) => i.checked), whilePc: document.querySelector('[data-role=push-while-pc] input').checked, perm: Notification.permission }));
  const key = await pg.evaluate(() => window.__mt.api.call('push.key')).then((r) => r.publicKey);
  check('켜기: 권한 허용 → 구독(userVisibleOnly, 판의 VAPID 공개 키) → 켜짐, 종류 셋 켜짐, PC 사용 중에도 받기는 꺼짐(기본)', on.line === 'push.on' && on.opts && on.opts.userVisibleOnly === true && on.opts.key === key && on.kinds.every(Boolean) && on.kinds.length === 3 && on.whilePc === false, { ...on, keyMatch: on.opts && on.opts.key === key });
  await shot(pg, '03-on');
  let dv = call('device.list').devices.find((d) => d.id === devId);
  check('PC 기기 목록: 알림 켜짐, 아직 보낸 적 없음', dv.push && dv.push.on === true && dv.push.lastSentAt === null, dv.push);
  // 3. 시험 알림
  let t0 = Date.now();
  await pg.click('[data-action=push-test]');
  let got = await waitGot(t0, 1);
  let rq = got[0] ? checkRequest(got[0], key) : { ok: false };
  let msg = got[0] ? open(got[0].body) : null;
  check('시험 알림: 흉내 푸시 서비스가 한 번 받음, VAPID(ES256 서명, aud, exp ≤ 24시간, k = 공개 키), TTL, aes128gcm', got.length === 1 && rq.ok && got[0].path === '/push/p88-phone', rq);
  check('시험 알림 내용: "Atrium 시험 알림"(한국어 기기)', msg && msg.kind === 'test' && msg.title === 'Atrium 시험 알림', msg);
  // 서비스 워커에 그대로 넣는다(CDP)
  const cdp = await ctx.newCDPSession(pg);
  const regs = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
  await cdp.send('ServiceWorker.enable');
  await until(() => (regs.length ? regs : null), 10000, 200).catch(() => {});
  const reg = regs.find((r) => r.scopeURL.startsWith(BASE));
  const deliver = async (m) => {
    try { await cdp.send('ServiceWorker.deliverPushMessage', { origin: BASE, registrationId: reg.registrationId, data: JSON.stringify(m) }); } catch (e) { return { err: e.message }; }
    await sleep(1200);
    return pg.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, data: n.data })));
  };
  let shown = reg ? await deliver(msg) : { err: 'no registration' };
  check('서비스 워커 push: 받은 내용으로 알림을 띄운다(getNotifications)', Array.isArray(shown) && shown.some((n) => n.title === 'Atrium 시험 알림' && n.tag === 'atrium-test'), shown);
  metrics.swTest = shown;

  // 4. 보는 중이면 보내지 않는다(이 기기의 연결이 열려 있고 보이는 상태)
  t0 = Date.now();
  let st = await turn(DONE_PROMPT(1));
  await sleep(5000);
  check('보는 중: 일이 끝나도(working → ready) 보내지 않는다', st === 'ready' && since(t0).length === 0, { state: st, got: since(t0).length });
  // 셸은 알리지 않는다
  atrium('input', 'p88-sh', 'ping -n 2 127.0.0.1\\r');
  // 가려짐(홈 화면으로 나감) 흉내: visibilityState = hidden → push.visible false
  await pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(31000); // 같은 세션·같은 종류는 30초에 한 번(보는 중이라 보내지 않은 것도 센다)
  // 5. 일이 끝남 → 한 번
  t0 = Date.now();
  st = await turn(DONE_PROMPT(2));
  got = await waitGot(t0, 1, 15000); await sleep(4000); got = since(t0);
  msg = got[0] ? open(got[0].body) : null;
  rq = got[0] ? checkRequest(got[0], key) : { ok: false };
  const sa = byName('p88-a');
  check('일이 끝남(working → ready): 한 번 보낸다. 머리글 맞음, 보통 긴급도', st === 'ready' && got.length === 1 && rq.ok && rq.urgency === 'normal', { state: st, n: got.length, rq });
  check('끝남 내용: "@p88-a · 끝남", 본문은 프로젝트 이름, 질문·요청·답 글 없음', msg && msg.title === '@p88-a · 끝남' && msg.body === 'mtask-p88-a' && msg.sessionId === sa.sessionId && !JSON.stringify(msg).includes(SECRET_WORD) && !JSON.stringify(msg).includes('Reply'), msg);
  metrics.done = { msg, rq };
  // 6. 응답 필요 → 한 번, 높은 긴급도
  t0 = Date.now();
  st = await turn(ASK, 'waiting');
  got = await waitGot(t0, 1, 15000); await sleep(4000); got = since(t0);
  msg = got[0] ? open(got[0].body) : null;
  rq = got[0] ? checkRequest(got[0], key) : { ok: false };
  check('응답 필요(working → waiting): 한 번 보낸다, 높은 긴급도', st === 'waiting' && got.length === 1 && rq.ok && rq.urgency === 'high', { state: st, n: got.length, rq });
  check('응답 필요 내용: "@p88-a · 응답 필요"만(명령·질문 글 없음)', msg && msg.title === '@p88-a · 응답 필요' && !/mkdir|p88-ask-dir|Bash/.test(JSON.stringify(msg)), msg);
  metrics.need = { msg, rq };
  const allBodies = sim.got.map((g) => g.body.toString('latin1')).join('');
  check('흉내 푸시 서비스가 받은 본문은 모두 암호문(세션 이름·명령이 보이지 않는다)', !/p88-a|mkdir|zebra/.test(allBodies), { n: sim.got.length });
  // 서비스 워커 → 알림, 누르기
  shown = reg ? await deliver(msg) : { err: 'no registration' };
  check('서비스 워커 push: 응답 필요 알림(세션 ID를 data에)', Array.isArray(shown) && shown.some((n) => n.title === '@p88-a · 응답 필요' && n.data && n.data.sessionId === sa.sessionId), shown);
  await pg.evaluate(() => { delete document.visibilityState; delete document.hidden; });
  await pg.click('[data-action=phone-push-close]').catch(() => {});
  // 열린 창: 서비스 워커가 보내는 메시지(atrium-open) → 그 세션 화면
  await pg.evaluate((sid) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'atrium-open', sessionId: sid } })), sa.sessionId);
  await sleep(1500);
  const v1 = await view(pg); const head1 = await pg.evaluate(() => (document.querySelector('.mt-ph-shead') || {}).textContent || '');
  check('알림 누르기(열린 앱): 그 세션 화면으로', v1 === 'session' && /p88-a/.test(head1), { view: v1, head: head1.slice(0, 40) });
  await shot(pg, '04-opened-from-notification');
  // 새로 연 앱: ?open=<세션 ID>
  const pg2 = await ctx.newPage();
  await pg2.goto(`${BASE}/?open=${encodeURIComponent(sa.sessionId)}`); await loadedOpen(pg2); await splashGone(pg2); await sleep(2000);
  const v2 = await view(pg2); const url2 = pg2.url();
  check('알림 누르기(앱이 닫혀 있음): ?open= 주소로 열면 그 세션 화면, 주소에서 open을 지운다', v2 === 'session' && !/open=/.test(url2), { view: v2, url: url2.replace(BASE, '') });
  await pg2.close();

  // 7. PC 쪽: 기기 목록, 연결 기록, CLI 시험 알림
  dv = call('device.list').devices.find((d) => d.id === devId);
  check('PC 기기 목록: 알림 켜짐과 마지막으로 보낸 때', dv.push.on === true && dv.push.lastSentAt > 0, dv.push);
  const rl = call('remote.log', { limit: 80 }).entries;
  const pushRows = rl.filter((e) => /^push\./.test(e.event));
  check('연결 기록: push.on(푸시 서비스 이름) 남김, 알림 내용(세션 이름·제목)은 없음', pushRows.some((e) => e.event === 'push.on' && e.host === 'localhost') && !JSON.stringify(pushRows).includes('p88-a') && !JSON.stringify(pushRows).includes('끝남'), pushRows);
  t0 = Date.now();
  const cli = await atriumAsync('remote', 'push-test');
  got = await waitGot(t0, 1, 10000);
  check('atrium remote push-test: 알림을 켠 기기에 시험 알림', cli.code === 0 && /\[ok\]/.test(cli.out) && got.length === 1 && open(got[0].body).kind === 'test', { out: cli.out.trim(), n: got.length });
  const cliLog = atriumOut('remote', 'log', '--limit', '20');
  check('atrium remote log: 알림 켬 줄', /알림 켬/.test(cliLog.out), cliLog.out.split('\n').filter((l) => /알림/.test(l)).slice(0, 4));
  // 8. 푸시 서비스가 410 → 구독을 지운다
  sim.next.push(410);
  t0 = Date.now();
  const gone = await atriumAsync('remote', 'push-test');
  dv = call('device.list').devices.find((d) => d.id === devId);
  const glog = call('remote.log', { limit: 20 }).entries.find((e) => e.event === 'push.off');
  check('410: 구독을 지우고(PC 목록 꺼짐) 기록에 push.off gone_410, CLI는 다시 켜라고 안내', !dv.push.on && glog && glog.reason === 'gone_410' && /다시 켜세요/.test(gone.out), { push: dv.push, reason: glog && glog.reason, out: gone.out.trim() });
  await pg.click('[data-action=phone-back]').catch(() => {});
  await sleep(800);
  await pg.click('[data-action=phone-push]');
  await pg.waitForSelector('[data-role=push-line]');
  await sleep(1500);
  line = await pg.getAttribute('[data-role=push-line]', 'data-key');
  check('휴대폰 시트: 구독이 만료됨을 알리고 다시 켜게 한다', line === 'push.gone', line);
  await shot(pg, '05-gone');
  // 다시 켠 뒤 짝 풀기 → 구독 기록째 지운다
  await pg.click('[data-role=push-main] input');
  await pg.waitForFunction(() => document.querySelector('[data-role=push-line]').dataset.key === 'push.on', null, { timeout: 15000 }).catch(() => {});
  const reon = call('device.list').devices.find((d) => d.id === devId).push.on;
  call('device.revoke', { id: devId });
  await sleep(800);
  const off = call('remote.log', { limit: 20 }).entries.find((e) => e.event === 'push.off');
  t0 = Date.now();
  const after = await atriumAsync('remote', 'push-test');
  check('짝 풀기: 구독도 지운다(push.off unpair, 시험 알림 보낼 기기 없음)', reon === true && off && off.reason === 'unpair' && after.code !== 0 && since(t0).length === 0, { reon, reason: off && off.reason, out: after.out.trim() });
  metrics.requests = sim.got.map((g) => ({ path: g.path, status: g.status, len: g.body.length, urgency: g.headers.urgency, ttl: g.headers.ttl }));
  await ctx.close();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (ts) await ts.close().catch(() => {});
  await new Promise((r) => pushSrv.close(r));
  fs.writeFileSync(path.join(OUT, 'p88-push.json'), JSON.stringify({ results, metrics }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
