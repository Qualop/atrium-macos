// P56(원격 S2·S3) 창 시험: PC 창(Electron)과 브라우저(Playwright Chromium)로 패스키 짝 맺기와 세션을 본다. 브라우저는 tailscale serve 흉내 프록시를 거친다.
//   브라우저 → ts-sim(47895, keepOrigin: Host·Origin은 브라우저 그대로, Tailscale-User-Login·X-Forwarded-*를 넣음) → 백엔드(47875)
//   판은 가짜 tailscale(p49-fake-tailscale.mjs, 예시 이름)을 읽고, ATRIUM_WEB_HOSTS로 흉내 주소(pc.example.ts.net:47895)를 받는다.
// 보안 출처: http://pc.example.ts.net:47895는 보안 출처가 아니므로 Chromium 플래그 --unsafely-treat-insecure-origin-as-secure로 맞춘다(--host-resolver-rules로 127.0.0.1에).
// 인증기: CDP 가상 인증기(WebAuthn.enable, addVirtualAuthenticator: ctap2, internal, hasUserVerification·isUserVerified).
// 흐름: 코드로 짝 맺기 → 패스키 등록 → 터미널 사용 → 새로 고침(세션 그대로) → 쿠키를 지우고 새로 고침 뒤 다시 확인 → 세션 만료 뒤 다시 확인 → PC에서 짝 풀기 → 거부.
//   document.cookie와 localStorage에 비밀이 없음, 옛 토큰 기기는 "다시 짝 맺기 필요", IP 주소와 보안 출처가 아닌 페이지는 이유를 보이고 막음.
// 세션 수명은 개발용 판에서만 읽는 ATRIUM_WEB_SESSION_TEST_SEC(150초)로 줄인다. 따로 띄운 판(atrium-dev-p56, 47875, backend/.dev)만 쓴다. 결과는 experiments/p56/(git 밖).
// 실행: node app/test/e2e/p56-passkey.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p56');
const TEST = 'C:\\Workspace\\mtask-p56-remote';
const CONVOS = path.join(OUT, 'convos');
const NAME = 'pc.example.ts.net';
const PORT = 47875, SIM = 47895; // 흉내 프록시는 다른 작업자의 범위(47811~47877) 밖
const SESSION_SEC = 150;
export const ENV = {
  ATRIUM_HERDR_SESSION: 'atrium-dev-p56', ATRIUM_PORT: String(PORT),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p56',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(PORT),
  ATRIUM_WEB_HOSTS: `${NAME}:${SIM}`, ATRIUM_WEB_SESSION_TEST_SEC: String(SESSION_SEC),
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true }); fs.mkdirSync(TEST, { recursive: true });
const { launch, logger, shot, sleep, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV);
if (ENV.ATRIUM_PORT !== '47875' || ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p56') throw new Error('P56 판만');
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));

const log = logger('p56-passkey');
const BASE = `http://${NAME}:${SIM}`;
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: { ...process.env, ...ENV }, timeout: 120000 });
const lastLine = (s) => s.trim().split(/\r?\n/).slice(-1)[0];
const until = async (fn, ms = 20000, every = 250) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await sleep(every); } };
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`); };
const wshot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); log(`스크린숏 experiments/p56/${name}.png`); };
const textOf = (pg, id) => pg.evaluate((i) => { const tm = window.__mt.terms.get(i); if (!tm) return ''; const b = tm.buffer.active; let s = ''; for (let r = 0; r < b.length; r++) { const l = b.getLine(r); if (l) s += l.translateToString(true) + '\n'; } return s; }, id);
const boardOpen = (pg, ms = 60000) => pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.getState().conn === 'open', null, { timeout: ms });
// 백엔드에 직접(브라우저 밖에서) 쿠키로 묻는다
const direct = (p, headers) => new Promise((res) => { const r = http.request({ host: '127.0.0.1', port: PORT, path: p, headers: { host: `localhost:${PORT}`, ...headers } }, (x) => { x.resume(); res(x.statusCode); }); r.on('error', () => res('err')); r.end(); });

// 옛 토큰 기기(P48~P55)를 판 기록에 미리 둔다(새 데이터 폴더일 때만)
const dbFile = path.join(ENV.ATRIUM_DATA_DIR, 'board.db');
if (!fs.existsSync(dbFile)) {
  fs.mkdirSync(ENV.ATRIUM_DATA_DIR, { recursive: true });
  const { Store } = await import(toUrl(path.join(REPO, 'backend', 'src', 'store.mjs')));
  const st = new Store(dbFile);
  st.setMeta('webDevices', [{ id: 'legacy-1', name: 'old token laptop', via: 'code', userAgent: 'old', createdAt: Date.now() - 86400_000, lastSeenAt: null, hash: '0'.repeat(64) }]);
  st.close();
  log('옛 토큰 기기 하나를 판 기록에 넣음');
}

let app, win, browser, browser2, tsim, killed = [];
try {
  tsim = startTsSim({ listen: SIM, target: PORT, name: NAME, login: 'me@example.com', keepOrigin: true });
  await tsim.ready;
  ({ app, page: win } = await launch({ log, env: ENV }));
  await win.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
  await win.evaluate(() => localStorage.setItem('mt.clientName', 'PC window'));

  browser = await chromium.launch({ headless: true, channel: 'chromium', args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 880 }, locale: 'ko-KR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`[web pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[web console.error] ${m.text().slice(0, 200)}`); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const creds = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;

  // ---- 1. 코드로 짝 맺기 → 패스키 등록 ----
  await page.goto(`${BASE}/`);
  await page.waitForSelector('[data-role=pair]', { timeout: 20000 });
  const ctxInfo = await page.evaluate(() => ({ secure: window.isSecureContext, webauthn: !!window.PublicKeyCredential, unsupported: !!document.querySelector('[data-role=passkey-unsupported]') }));
  check('흉내 주소는 플래그로 보안 출처, WebAuthn이 있다', ctxInfo.secure && ctxInfo.webauthn && !ctxInfo.unsupported, ctxInfo);
  await wshot(page, '01-pair');
  await win.click('[data-action=settings-open]');
  await win.click('[data-tab=devices]');
  await win.waitForSelector('[data-role=device-list]');
  await sleep(600);
  const legacyRow = await win.$('[data-device="legacy-1"] [data-role=needs-repair]');
  check('옛 토큰 기기는 PC 목록에 "다시 짝 맺기 필요"', !!legacyRow, legacyRow ? await legacyRow.textContent() : 'none');
  await shot(win, '02-pc-devices-legacy', log);
  await win.click('[data-action=device-new-code]');
  const code = (await win.textContent('[data-role=pair-code]')).trim();
  await page.fill('[data-field=pair-name]', 'p56 laptop');
  await page.fill('[data-field=pair-code]', code);
  await page.click('[data-action=pair-submit]');
  await page.waitForSelector('[data-role=passkey-register]', { timeout: 15000 });
  const noDeviceYet = (await win.evaluate(() => window.__mt.api.call('device.list'))).devices.filter((d) => d.name === 'p56 laptop').length === 0;
  check('코드가 맞으면 기기가 아니라 패스키 등록 화면(등록 전에는 기기 없음)', noDeviceYet);
  await wshot(page, '03-passkey-register');
  await page.click('[data-action=passkey-create]');
  await boardOpen(page);
  const c1 = await creds();
  check('가상 인증기에 패스키 하나(RP ID는 페이지 호스트 이름)', c1.length === 1 && c1[0].rpId === NAME, c1.map((c) => ({ rpId: c.rpId, signCount: c.signCount, resident: c.isResidentCredential })));
  await wshot(page, '04-board-after-register');
  const devs1 = (await win.evaluate(() => window.__mt.api.call('device.list'))).devices;
  const myDev = devs1.find((d) => d.name === 'p56 laptop');
  check('PC 목록에 패스키 기기, 로그인 세션 1', myDev && !myDev.needsRepair && myDev.sessions === 1 && myDev.passkey && myDev.passkey.rpId === NAME, myDev);

  // 비밀이 스크립트에 보이지 않는다
  const cookieName = `atrium_${PORT}`;
  const jar = await ctx.cookies(BASE);
  const sess = jar.find((c) => c.name === cookieName);
  const seen = await page.evaluate(() => ({ cookie: document.cookie, local: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])), session: Object.keys(sessionStorage) }));
  const leaks = sess ? [seen.cookie, JSON.stringify(seen.local)].filter((s) => s.includes(sess.value)) : ['no cookie'];
  check('세션 쿠키는 HttpOnly·SameSite=Strict·Path=/(http라 Secure 없음)', sess && sess.httpOnly && sess.sameSite === 'Strict' && sess.path === '/' && !sess.secure, sess && { httpOnly: sess.httpOnly, sameSite: sess.sameSite, path: sess.path, secure: sess.secure, expiresInH: Math.round((sess.expires - Date.now() / 1000) / 36) / 100 });
  check('document.cookie와 localStorage·sessionStorage에 비밀이 없다(credential ID만)', leaks.length === 0 && !/atrium_/.test(seen.cookie) && !('atrium.deviceToken' in seen.local) && seen.session.length === 0 && Object.keys(seen.local).includes('atrium.passkey'), { cookie: seen.cookie, localKeys: Object.keys(seen.local), passkeyEntry: Object.keys(JSON.parse(seen.local['atrium.passkey'] || '{}')) });

  // ---- 2. 터미널 사용 ----
  log(lastLine(atrium('spawn', TEST, '--name', 'p56sh', '--kind', 'shell'))); killed.push('p56sh');
  const SH = await until(() => win.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p56sh'); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }), 30000);
  const viewNode = async (pg, id) => { await pg.evaluate((i) => window.__mt.getState().navigateTo(i), id); await sleep(1500); await until(() => pg.evaluate((i) => !!window.__mt.terms.get(i), id), 30000); await sleep(1200); };
  await viewNode(page, SH);
  await page.click(`.mt-term[data-session="${SH}"]`, { position: { x: 60, y: 30 } }); await sleep(150);
  await page.keyboard.type('echo from-passkey-$((50+6))'); await page.keyboard.press('Enter');
  const typed = await until(async () => (await textOf(page, SH)).includes('from-passkey-56') || null, 20000).catch(() => null);
  check('패스키 세션으로 터미널에 치고 결과를 본다', !!typed);
  await wshot(page, '05-terminal');

  // ---- 3. 새로 고침: 세션 그대로. 쿠키를 지우고 새로 고침: 다시 확인 ----
  await page.reload();
  const reloadOk = await boardOpen(page, 30000).then(() => true, () => false);
  const noPrompt = !(await page.$('[data-role=reauth]'));
  check('새로 고침해도 세션이 남아 다시 묻지 않는다', reloadOk && noPrompt);
  await ctx.clearCookies();
  await page.reload();
  await page.waitForSelector('[data-role=reauth]', { timeout: 20000 });
  await wshot(page, '06-reauth-after-cookie-cleared');
  const before = (await creds())[0].signCount;
  await page.click('[data-action=passkey-verify]');
  await boardOpen(page);
  const after = (await creds())[0].signCount;
  check('다시 확인(패스키 서명)하면 보드가 다시 열린다, 서명 카운터가 늘어난다', after > before, { before, after });
  const tLogin = Date.now();
  // 쿠키의 Max-Age가 세션 수명과 같아 만료 뒤에는 브라우저가 쿠키를 버린다. 백엔드 쪽 거부를 보려고 값을 미리 잡아 둔다
  const oldCookie = (await ctx.cookies(BASE)).find((c) => c.name === cookieName);
  check('살아 있는 세션 쿠키는 백엔드가 받는다(밖에서 같은 값으로)', oldCookie && (await direct('/web/me', { cookie: `${cookieName}=${oldCookie.value}` })) === 200);

  // ---- 4. 세션 만료 뒤 다시 확인 ----
  const expired = await page.waitForSelector('[data-role=reauth]', { timeout: (SESSION_SEC + 40) * 1000 }).then(() => Date.now() - tLogin, () => null);
  check(`세션이 끝나면(수명 ${SESSION_SEC}초, 4401) 웹 화면이 다시 확인 화면으로 간다`, expired != null && expired >= (SESSION_SEC - 2) * 1000, { afterMs: expired });
  await wshot(page, '07-reauth-after-expiry');
  check('브라우저는 만료된 쿠키를 버린다', !(await ctx.cookies(BASE)).some((c) => c.name === cookieName));
  check('끝난 세션 쿠키는 백엔드가 거부한다', oldCookie && (await direct('/web/me', { cookie: `${cookieName}=${oldCookie.value}` })) === 401);
  await page.click('[data-action=passkey-verify]');
  await boardOpen(page);
  check('만료 뒤 다시 확인하면 보드가 열린다', true);

  // 다른 Tailscale 사용자는 패스키가 있어도 로그인하지 못한다
  tsim.cfg.login = 'someone-else@example.com';
  const otherUser = await page.evaluate(async () => (await fetch('/web/passkey/login/options', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })).status);
  tsim.cfg.login = 'me@example.com';
  check('다른 Tailscale 사용자의 로그인 요청은 403', otherUser === 403, { status: otherUser });

  // ---- 5. PC에서 짝 풀기 → 거부 ----
  const live = (await ctx.cookies(BASE)).find((c) => c.name === cookieName);
  const tRev = Date.now();
  await win.evaluate((id) => window.__mt.api.call('device.revoke', { id }), myDev.id);
  const toPair = await page.waitForSelector('[data-role=pair-note]', { timeout: 20000 }).then(() => Date.now() - tRev, () => null);
  const reauthShown = !!(await page.$('[data-role=reauth]'));
  check('짝을 풀면(4401) 브라우저가 다시 확인이 아니라 짝 맺기 화면으로 간다', toPair != null && !reauthShown && !!(await page.$('[data-role=pair]')), { ms: toPair, note: toPair != null ? await page.textContent('[data-role=pair-note]') : null });
  await wshot(page, '08-unpaired-pair');
  const refused = await page.evaluate(async () => {
    const me = (await fetch('/web/me', { cache: 'no-store' })).status;
    const ws = await new Promise((res) => { const w = new WebSocket(`ws://${location.host}/api`); w.onopen = () => { w.close(); res('open'); }; w.onclose = (e) => res(`closed ${e.code}`); w.onerror = () => {}; });
    return { me, ws };
  });
  check('짝 푼 기기의 세션은 HTTP·WebSocket 모두 거부', refused.me === 401 && refused.ws !== 'open' && (await direct('/web/me', { cookie: `${cookieName}=${live.value}` })) === 401, refused);
  check('짝 푼 뒤 가상 인증기의 패스키로도 로그인 못 함(모르는 credential)', await page.evaluate(async (id) => (await (await fetch('/web/passkey/login/options', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credentialId: id }) })).json()).status, (await creds())[0].credentialId.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')) === 'unpaired');
  // 옛 토큰 길(?device=, Bearer)도 닫혀 있다
  const oldWays = await page.evaluate(async () => {
    const bearer = (await fetch('/web/me', { headers: { authorization: 'Bearer old-token-0123456789' } })).status;
    const ws = await new Promise((res) => { const w = new WebSocket(`ws://${location.host}/api?device=old-token-0123456789`); w.onopen = () => { w.close(); res('open'); }; w.onclose = (e) => res(`closed ${e.code}`); });
    return { bearer, ws };
  });
  check('옛 기기 토큰(Bearer, ?device=)은 받지 않는다', oldWays.bearer === 401 && oldWays.ws !== 'open', oldWays);
  // 옛 기기 지우기
  await win.evaluate(() => window.__mt.api.call('device.revoke', { id: 'legacy-1' }));
  await sleep(500);
  const gone = !(await win.$('[data-device="legacy-1"]'));
  check('옛 토큰 기기를 PC에서 지운다', gone);
  await shot(win, '09-pc-devices-after', log);

  // ---- 6. 패스키를 쓸 수 없는 페이지 ----
  const ipPage = await ctx.newPage();
  await ipPage.goto(`http://127.0.0.1:${PORT}/`);
  const ipWhy = await ipPage.waitForSelector('[data-role=passkey-unsupported]', { timeout: 20000 }).then((e) => e.getAttribute('data-reason'), () => null);
  check('IP 주소로 연 페이지는 이유(이름으로 열기)를 보이고 막는다', ipWhy === 'ip_host', { ipWhy, link: await ipPage.getAttribute('[data-action=open-localhost]', 'href').catch(() => null) });
  await wshot(ipPage, '10-unsupported-ip');
  browser2 = await chromium.launch({ headless: true, channel: 'chromium', args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`] });
  const p2 = await (await browser2.newContext({ locale: 'ko-KR' })).newPage();
  await p2.goto(`${BASE}/`);
  const insecure = await p2.waitForSelector('[data-role=passkey-unsupported]', { timeout: 20000 }).then((e) => e.getAttribute('data-reason'), () => null);
  check('보안 출처가 아닌 페이지(플래그 없음)는 이유를 보이고 막는다(토큰 길 없음)', insecure === 'insecure' && !(await p2.$('[data-field=pair-code]')), { insecure });
  await wshot(p2, '11-unsupported-insecure');
} catch (e) {
  log(`오류 ${e.stack}`);
  check('시험이 끝까지 돎', false, e.message);
} finally {
  for (const n of killed) { try { atrium('kill', n, '--yes'); log(`세션 끔 ${n}`); } catch (e) { log(`kill ${n} 실패 ${String(e.message).split('\n')[0]}`); } }
  if (browser) await browser.close().catch(() => {});
  if (browser2) await browser2.close().catch(() => {});
  if (app) await closeApp(app);
  if (tsim) await tsim.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'p56-passkey-results.json'), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
