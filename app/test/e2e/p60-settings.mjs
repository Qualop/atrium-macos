// P60 창 시험: 설정 창 크기와 스크롤, 배율 칸, 연결된 기기 탭의 새 차례와 복사 단추, 휴대폰·이 기기 패스키 고르기(hints).
//   노트북: Playwright Chromium 문맥 → ts-sim(47884, X-Forwarded-For 100.64.0.2 = laptop-a) → 백엔드(47882)
// 판은 가짜 tailscale(p49-fake-tailscale.mjs)을 읽는다. P60_FAKE_SERVE_FILE에 'other'를 쓰면 serve가 판으로 가지 않고 443을 다른 서비스가 쓴다.
// 따로 띄운 개발용 판(atrium-dev-p60, 47882, backend/.dev)만 쓴다. 결과는 experiments/p60/(git 밖).
// 실행: node app/test/e2e/p60-settings.mjs            (바뀐 화면을 본다)
//       P60_PHASE=before node app/test/e2e/p60-settings.mjs   (바꾸기 전 화면의 스크린숏만. 옛 화면 빌드로)
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p60');
const CONVOS = path.join(OUT, 'convos');
const SERVE_FILE = path.join(OUT, 'fake-serve.txt');
const PHASE = process.env.P60_PHASE === 'before' ? 'before' : 'after';
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A, baseOf } = L;
const B0 = L.board({ session: 'atrium-dev-p60', port: 47882, sim: 47884, sim2: 47885 });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p60',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  P60_FAKE_SERVE_FILE: SERVE_FILE,
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim}`,
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
fs.writeFileSync(SERVE_FILE, 'board');
const { launch, logger, shot, sleep, until, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));

const log = logger(`p60-settings-${PHASE}`);
const BASE = baseOf(B0.sim);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`); };
const wshot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); log(`스크린숏 experiments/p60/${name}.png`); };
const SIZES = [[1584, 921], [1366, 768]];
const LOW = [[1366, 600], [1280, 520]];

// 설정 열기·탭 고르기
async function openSettings(pg, tab) {
  if (!(await pg.$('[data-role=settings]'))) await pg.click('[data-action=settings-open]');
  await pg.waitForSelector('[data-role=settings]');
  await pg.click(`button[data-tab=${tab}]`);
  await sleep(250);
}
const closeSettings = (pg) => pg.click('[data-action=settings-close]').catch(() => {});
// 설정 창이 창 안에 다 들어오는가, 탭 내용이 스크롤되는가, 스크롤해도 제목·탭·닫기가 그대로인가
async function measure(pg) {
  return pg.evaluate(async () => {
    const box = document.querySelector('[data-role=settings]');
    const body = box.querySelector('.mt-set-body');
    const close = box.querySelector('[data-action=settings-close]');
    const tabs = box.querySelector('[data-role=settings-tabs]');
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height), w: Math.round(b.width) }; };
    const before = { box: r(box), close: r(close), tabs: r(tabs), scrollH: body.scrollHeight, clientH: body.clientHeight, overflowY: getComputedStyle(body).overflowY };
    body.scrollTop = body.scrollHeight;
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const last = body.querySelector('[data-section]:last-of-type') || body.lastElementChild;
    const after = { scrollTop: Math.round(body.scrollTop), close: r(close), tabs: r(tabs), last: last ? r(last) : null, body: r(body) };
    return { vw: innerWidth, vh: innerHeight, before, after };
  });
}
const fits = (m) => m.before.box.top >= 0 && m.before.box.bottom <= m.vh && m.before.box.left >= 0 && m.before.box.right <= m.vw && m.before.close.bottom <= m.vh;
const scrolls = (m) => m.before.scrollH <= m.before.clientH + 1 || (m.after.scrollTop > 0 && m.after.close.top === m.before.close.top && m.after.tabs.top === m.before.tabs.top && m.after.last && m.after.last.bottom <= m.after.body.bottom + 2);

// 노트북의 브라우저 문맥과 가상 인증기. transport: 'cable'(휴대폰, 하이브리드) 또는 'internal'(Windows Hello 흉내)
async function laptop(browser, label, transport) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ko-KR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`[${label} pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[${label} console.error] ${m.text().slice(0, 200)}`); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport, hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const creds = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
  // 패스키 선택 사항 요청과 응답을 적는다(via와 hints를 본다)
  const seen = [];
  page.on('request', (rq) => { if (/\/web\/passkey\/(register|login)\/options$/.test(rq.url())) seen.push({ url: new URL(rq.url()).pathname, body: (() => { try { return JSON.parse(rq.postData() || '{}'); } catch { return null; } })(), res: null }); });
  page.on('response', async (rs) => { if (/\/web\/passkey\/(register|login)\/options$/.test(rs.url())) { try { const j = await rs.json(); const s = [...seen].reverse().find((x) => x.url === new URL(rs.url()).pathname && !x.res); if (s) s.res = j; } catch {} } });
  return { ctx, page, cdp, creds, seen };
}
async function pair(win, lp, name, via) {
  const code = await L.newCode(win);
  await lp.page.goto(`${BASE}/`);
  await lp.page.waitForSelector('[data-role=pair]', { timeout: 20000 });
  await lp.page.fill('[data-field=pair-name]', name);
  await lp.page.fill('[data-field=pair-code]', code);
  await lp.page.click('[data-action=pair-submit]');
  await lp.page.waitForSelector('[data-role=passkey-register]', { timeout: 15000 });
  if (via) await lp.page.click(`[data-role=passkey-via] [data-via=${via}]`);
  return lp;
}

let app, win, browser, sim;
try {
  sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  ({ app, page: win } = await launch({ log, env: ENV }));
  await win.setViewportSize({ width: 1584, height: 921 });
  await win.evaluate(() => localStorage.setItem('mt.clientName', 'PC window'));
  await win.reload(); await win.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await win.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true));
  await until(async () => { const d = await win.evaluate(() => window.__mt.api.call('remote.status', { fresh: true })); return d && d.url ? d : null; }, 20000);
  for (const d of (await win.evaluate(() => window.__mt.api.call('device.list'))).devices) await win.evaluate((id) => window.__mt.api.call('device.revoke', { id }), d.id);

  browser = await L.launchBrowser([B0.sim]);
  // ---- 1. 노트북 A: 휴대폰으로(하이브리드, CDP 가상 인증기 transport cable) ----
  const A = await laptop(browser, 'A', 'cable');
  if (PHASE === 'before') {
    await pair(win, A, 'Chrome on laptop A', null);
    await wshot(A.page, 'before-web-passkey-register');
    await A.page.click('[data-action=passkey-create]');
    await L.boardOpen(A.page);
  } else {
    await pair(win, A, 'Chrome on laptop A', null);
    const pickHint = await A.page.$('[data-role=passkey-via]');
    check('짝 맺기 화면: 휴대폰·이 기기 고르기가 있고 휴대폰이 먼저, 처음에는 아무것도 고르지 않음', !!pickHint && (await A.page.$$eval('[data-role=passkey-via] [data-via]', (els) => els.map((e) => e.dataset.via))).join() === 'phone,device' && (await A.page.getAttribute('[data-role=passkey-via]', 'data-value')) === '');
    await A.page.click('[data-role=passkey-via] [data-via=phone]');
    await A.page.waitForSelector('[data-role=passkey-phone-hint]');
    const hint = await A.page.textContent('[data-role=passkey-phone-hint]');
    check('휴대폰을 고르면 블루투스와 QR 안내를 보인다', /블루투스/.test(hint) && /QR/.test(hint), hint);
    await sleep(300); // 고른 칸의 테두리 전환(150ms)이 끝난 뒤
    await wshot(A.page, 'after-web-passkey-register-phone');
    await A.page.click('[data-action=passkey-create]');
    await L.boardOpen(A.page);
    const reg = A.seen.find((x) => x.url.endsWith('/register/options'));
    check('등록: 휴대폰 선택이 via=phone으로 가고 hints가 hybrid(붙임 cross-platform)', reg && reg.body.via === 'phone' && reg.res && JSON.stringify(reg.res.options.hints) === '["hybrid"]' && reg.res.options.authenticatorSelection.authenticatorAttachment === 'cross-platform', reg && { via: reg.body.via, hints: reg.res && reg.res.options.hints, sel: reg.res && reg.res.options.authenticatorSelection });
    const credsA = await A.creds();
    const devA = (await win.evaluate(() => window.__mt.api.call('device.list'))).devices.find((d) => d.name === 'Chrome on laptop A');
    check('가상 휴대폰 인증기(cable)로 만든 패스키는 기기 목록에 휴대폰 패스키', credsA.length === 1 && devA && devA.passkey && devA.passkey.kind === 'phone', { creds: credsA.length, passkey: devA && devA.passkey });
    const via = await A.page.evaluate(() => localStorage.getItem('atrium.passkeyVia'));
    check('고른 것은 브라우저에 기억한다(atrium.passkeyVia, 비밀 아님)', via === 'phone', via);
    // 다시 확인: 로그아웃 → 다시 열기 → 기억한 휴대폰이 골라져 있다 → 확인
    await A.page.evaluate(() => fetch('/web/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin' }));
    await sleep(800);
    await A.page.goto(`${BASE}/`).catch(() => {}); // 로그아웃으로 연결이 닫히면 화면이 스스로 다시 읽을 수 있다
    await A.page.waitForSelector('[data-role=reauth] [data-role=passkey-via]', { timeout: 20000 });
    check('다시 확인 화면: 기억한 휴대폰이 골라져 있다', (await A.page.getAttribute('[data-role=reauth] [data-role=passkey-via]', 'data-value')) === 'phone');
    await wshot(A.page, 'after-web-reauth-phone');
    A.seen.length = 0;
    await A.page.click('[data-action=passkey-verify]');
    await L.boardOpen(A.page);
    const lo = A.seen.find((x) => x.url.endsWith('/login/options') && x.body && x.body.via);
    check('다시 확인: via=phone → hints hybrid, allowCredentials에 등록 때 받은 transports', lo && lo.body.via === 'phone' && JSON.stringify(lo.res.options.hints) === '["hybrid"]' && lo.res.options.allowCredentials[0].transports && lo.res.options.allowCredentials[0].transports.length > 0, lo && { via: lo.body.via, hints: lo.res && lo.res.options.hints, allow: lo.res && lo.res.options.allowCredentials });
  }
  // ---- 2. 노트북 B(같은 Tailscale 기기의 다른 브라우저): 이 기기로(internal) ----
  const Bl = await laptop(browser, 'B', 'internal');
  await pair(win, Bl, 'Edge on laptop A', PHASE === 'after' ? 'device' : null);
  await Bl.page.click('[data-action=passkey-create]');
  await L.boardOpen(Bl.page);
  if (PHASE === 'after') {
    const reg = Bl.seen.find((x) => x.url.endsWith('/register/options'));
    check('등록: 이 기기 선택이 via=device로 가고 hints가 client-device·security-key', reg && reg.body.via === 'device' && JSON.stringify(reg.res.options.hints) === '["client-device","security-key"]', reg && { via: reg.body.via, hints: reg.res && reg.res.options.hints });
    const devB = (await win.evaluate(() => window.__mt.api.call('device.list'))).devices.find((d) => d.name === 'Edge on laptop A');
    check('내장 인증기(internal) 패스키는 기기 내장 패스키', devB && devB.passkey.kind === 'device', devB && devB.passkey);
  }
  await Bl.ctx.close(); // B는 연결을 끊는다(지금 붙은 기기는 A 하나)
  // 옛 기기 하나(다시 짝 맺기 필요 묶음을 보이려고): 판 API로는 만들 수 없어 연결 기록과 목록은 그대로 둔다

  // ---- 3. PC 창: 일반 탭(배율 칸) ----
  for (const [w, h] of SIZES) {
    await win.setViewportSize({ width: w, height: h });
    await openSettings(win, 'general');
    await shot(win, `${PHASE}-${w}x${h}-general`, log);
  }
  if (PHASE === 'after') {
    const sc = await win.evaluate(() => {
      const row = document.querySelector('[data-role=uiScale-setting]');
      const inp = row.querySelector('input[data-field=setting-uiScale]');
      const h = (sel) => Math.round(row.querySelector(sel).getBoundingClientRect().height);
      return { appearance: getComputedStyle(inp).appearance || getComputedStyle(inp).webkitAppearance, stepper: h('.mt-stepper'), down: h('[data-action=uiScale-down]'), reset: h('[data-action=uiScale-reset]'), resetText: row.querySelector('[data-action=uiScale-reset]').textContent, radius: getComputedStyle(row.querySelector('.mt-stepper')).borderRadius, btnRadius: getComputedStyle(row.querySelector('[data-action=uiScale-reset]')).borderRadius };
    });
    check('배율 칸: 기본 스핀 단추 없음(appearance textfield), −·+·기본으로가 판 단추 높이(30)와 모서리(9px)', sc.appearance === 'textfield' && sc.stepper === 30 && sc.reset === 30 && sc.radius === sc.btnRadius && /기본으로|Reset/.test(sc.resetText), sc);
    await win.click('[data-action=uiScale-up]'); await sleep(200);
    const up = await win.getAttribute('[data-field=setting-uiScale]', 'data-value');
    await win.click('[data-action=uiScale-reset]'); await sleep(200);
    const back = await win.getAttribute('[data-field=setting-uiScale]', 'data-value');
    check('+는 5% 크게, 기본으로는 100%로', up === '105' && back === '100', { up, back });
  }

  // ---- 4. PC 창: 연결된 기기 탭 ----
  for (const [w, h] of SIZES) {
    await win.setViewportSize({ width: w, height: h });
    await openSettings(win, 'devices');
    await win.waitForSelector('[data-role=device-list] [data-device]');
    await sleep(400);
    await win.evaluate(() => { const b = document.querySelector('.mt-set-body'); b.scrollTop = 0; });
    await shot(win, `${PHASE}-${w}x${h}-devices-top`, log);
    const m = await measure(win);
    await shot(win, `${PHASE}-${w}x${h}-devices-bottom`, log);
    if (PHASE === 'after') {
      check(`${w}×${h}: 설정 창이 창 안에 들어오고 닫기 단추가 보인다`, fits(m), m.before);
      check(`${w}×${h}: 탭 내용만 스크롤되고 제목·탭·닫기는 그대로, 끝 묶음까지 보인다`, m.before.overflowY === 'auto' && scrolls(m), { before: m.before, after: m.after });
    } else log(`before ${w}x${h}: ${JSON.stringify(m)}`);
  }
  for (const [w, h] of LOW) {
    await win.setViewportSize({ width: w, height: h });
    await openSettings(win, 'devices');
    await sleep(300);
    await win.evaluate(() => { document.querySelector('.mt-set-body').scrollTop = 0; });
    await shot(win, `${PHASE}-${w}x${h}-devices-low`, log);
    const m = await measure(win);
    if (PHASE === 'after') check(`낮은 창 ${w}×${h}: 잘리지 않고 스크롤된다`, fits(m) && scrolls(m), { before: m.before, after: m.after });
    else log(`before ${w}x${h}: ${JSON.stringify(m)}`);
    await openSettings(win, 'general');
    await shot(win, `${PHASE}-${w}x${h}-general-low`, log);
    if (PHASE === 'after') { const g = await measure(win); check(`낮은 창 ${w}×${h}: 일반 탭도 잘리지 않는다`, fits(g) && scrolls(g), g.before); }
  }
  await win.setViewportSize({ width: 1584, height: 921 });

  if (PHASE === 'after') {
    await openSettings(win, 'devices');
    await win.waitForSelector('[data-role=device-list] [data-device]');
    const order = await win.$$eval('[data-role=devices-tab] > [data-section]', (els) => els.map((e) => e.dataset.section));
    check('기기 탭 차례: 요약, 짝 맺기, 짝 맺은 기기, 보안 설정, Tailscale 진단, 연결 기록', order.join() === 'summary,pair,devices,security,diagnostics,log', order);
    const heads = await win.$$eval('[data-role=devices-tab] > [data-section]', (els) => els.map((e) => ({ t: (e.querySelector('.mt-dsec-title') || {}).textContent, d: !!e.querySelector('.mt-dsec-desc') })));
    check('묶음마다 제목과 한 줄 설명', heads.every((x) => x.t && x.d), heads);
    const diag = await win.evaluate(() => ({ open: document.querySelector('[data-role=remote-status]').open, lines: document.querySelectorAll('[data-role=remote-status] [data-check]').length }));
    check('Tailscale 진단은 기본으로 접혀 있고 점검 줄은 있다', diag.open === false && diag.lines > 5, diag);
    const sum = await win.evaluate(() => ({ state: document.querySelector('[data-role=remote-state]').textContent, n: document.querySelector('[data-role=remote-connected]').dataset.n, url: document.querySelector('[data-role=remote-url]').textContent }));
    check('요약: 받는 중, 지금 붙은 기기 1대(A), 노트북에서 열 주소', /받는 중|Accepting/.test(sum.state) && sum.n === '1' && sum.url === `https://${NAME}/`, sum);
    const rowA = await win.evaluate(() => { const r = [...document.querySelectorAll('[data-role=device-list] [data-device]')].find((x) => /laptop-a/.test(x.textContent) && x.dataset.connected === '1'); return r && { text: r.textContent, kind: (r.querySelector('[data-role=device-kind]') || { dataset: {} }).dataset.kind, kick: !!r.querySelector('[data-action=device-disconnect]'), revoke: !!r.querySelector('[data-action=device-revoke]') }; });
    check('짝 맺은 기기: Tailscale 기기 이름, 별칭, 휴대폰 패스키, 연결됨, 끊기·짝 풀기', rowA && rowA.kind === 'phone' && /Chrome on laptop A/.test(rowA.text) && /연결됨|Connected/.test(rowA.text) && rowA.kick && rowA.revoke, rowA);
    // 복사 단추: 노트북에서 열 주소
    await app.evaluate(({ clipboard }) => clipboard.writeText('-'));
    await win.click('[data-action=copy-remote-url]');
    await win.waitForSelector('[data-role=remote-url-copied].show', { timeout: 3000 });
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    const copiedText = await win.textContent('[data-role=remote-url-copied]');
    check('주소 복사 단추가 클립보드에 주소를 넣고 "복사했습니다"를 잠깐 보인다', clip === `https://${NAME}/` && /복사했습니다|Copied/.test(copiedText), { clip, copiedText });
    await shot(win, 'after-1584x921-devices-copied', log);
    await sleep(1900);
    check('"복사했습니다"는 잠깐 뒤 사라진다', !(await win.$('[data-role=remote-url-copied].show')));
    // 연결 기록: 최근 몇 줄, 더 보기
    const lg = await win.evaluate(() => { const l = document.querySelector('[data-role=remote-log]'); return { total: Number(l.dataset.total), shown: Number(l.dataset.shown), rows: l.querySelectorAll('.mt-remote-log-row').length }; });
    let more = null;
    if (lg.total > lg.shown) { await win.click('[data-action=remote-log-more]'); await sleep(150); more = await win.evaluate(() => document.querySelectorAll('[data-role=remote-log] .mt-remote-log-row').length); }
    check('연결 기록: 기본으로 최근 6줄, 더 보기로 늘어난다', lg.shown <= 6 && lg.rows === lg.shown && (lg.total <= 6 || more > lg.shown), { ...lg, more });
    // serve가 판으로 가지 않음(443을 다른 서비스가 씀) → 켜기 명령, 관리자 권한 안내, 요약의 경고 줄
    fs.writeFileSync(SERVE_FILE, 'other');
    await win.evaluate(() => window.__mt.api.call('remote.status', { fresh: true }));
    await closeSettings(win); await openSettings(win, 'devices');
    await win.waitForSelector('[data-role=remote-enable]', { timeout: 10000 });
    const en = await win.evaluate(() => ({ cmd: document.querySelector('[data-role=remote-enable]').textContent, admin: (document.querySelector('[data-role=remote-admin-hint]') || {}).textContent || null, warn: (document.querySelector('[data-role=remote-problem]') || { dataset: {} }).dataset.check || null }));
    check('serve가 판으로 가지 않으면 PATH에 기대지 않는 켜기 명령(node …atrium.mjs --dev remote enable --yes --https-port 8443)', /^node "?.+[\\/]backend[\\/]bin[\\/]atrium\.mjs"? --dev remote enable --yes --https-port 8443$/.test(en.cmd), en.cmd.replace(/^node "?.+[\\/]backend/, 'node <repo>/backend'));
    check('같은 이름의 다른 serve 항목이 있으면 관리자 권한 안내', !!en.admin && /관리자|administrator/.test(en.admin), en.admin);
    check('진단 문제는 요약에 경고 한 줄(serve)', en.warn === 'serve', en.warn);
    await win.click('[data-action=copy-remote-enable]');
    await win.waitForSelector('[data-role=remote-enable-copied].show', { timeout: 3000 });
    const clip2 = await app.evaluate(({ clipboard }) => clipboard.readText());
    check('켜기 명령 복사 단추', clip2 === en.cmd);
    await shot(win, 'after-1584x921-devices-enable', log);
    await win.click('[data-action=remote-diag-open]'); await sleep(400);
    check('"진단 보기"가 진단을 펼친다', await win.evaluate(() => document.querySelector('[data-role=remote-status]').open));
    await shot(win, 'after-1584x921-devices-diag-open', log);
    fs.writeFileSync(SERVE_FILE, 'board');
    await win.evaluate(() => window.__mt.api.call('remote.status', { fresh: true }));
    await closeSettings(win);
    // 바뀐 기기 탭을 1366×768로 다시(전후 비교용)
    await win.setViewportSize({ width: 1366, height: 768 });
    await openSettings(win, 'devices');
    await win.waitForSelector('[data-role=device-list] [data-device]');
    await sleep(300);
    await shot(win, 'after-1366x768-devices-top-again', log);
    await closeSettings(win);
    await win.setViewportSize({ width: 1584, height: 921 });
  }

  // ---- 5. 웹 화면의 설정: 자기 기기 정보, 로그아웃, 이 브라우저 짝 풀기만 ----
  for (const [w, h] of [[1366, 768], [1280, 520]]) {
    await A.page.setViewportSize({ width: w, height: h });
    await openSettings(A.page, 'devices');
    await sleep(400);
    await wshot(A.page, `${PHASE}-web-${w}x${h}-devices`);
    if (PHASE === 'after') {
      const v = await A.page.evaluate(() => ({ sections: [...document.querySelectorAll('[data-role=devices-tab] > [data-section]')].map((e) => e.dataset.section), signOut: !!document.querySelector('[data-action=web-sign-out]'), forget: !!document.querySelector('[data-action=device-revoke]'), others: document.querySelectorAll('[data-role=device-list] [data-device]').length, kind: (document.querySelector('[data-role=device-kind]') || { dataset: {} }).dataset.kind }));
      const m = await measure(A.page);
      check(`웹 화면 ${w}×${h}: 기기 탭은 이 브라우저 정보, 로그아웃, 짝 풀기만, 창이 잘리지 않는다`, v.sections.join() === 'self' && v.signOut && v.forget && v.others === 1 && v.kind === 'phone' && fits(m), { ...v, box: m.before.box, vh: m.vh });
      await openSettings(A.page, 'general');
      const g = await measure(A.page);
      await wshot(A.page, `${PHASE}-web-${w}x${h}-general`);
      check(`웹 화면 ${w}×${h}: 일반 탭도 잘리지 않고 스크롤된다`, fits(g) && scrolls(g), g.before);
    }
    await closeSettings(A.page);
  }
} catch (e) {
  log(`오류 ${e.stack}`);
  check('시험이 끝까지 돎', false, e.message);
} finally {
  try { if (win) for (const d of (await win.evaluate(() => window.__mt.api.call('device.list'))).devices) await win.evaluate((id) => window.__mt.api.call('device.revoke', { id }), d.id); } catch {}
  if (browser) await browser.close().catch(() => {});
  if (app) await closeApp(app);
  if (sim) await sim.close().catch(() => {});
  try { fs.writeFileSync(SERVE_FILE, 'board'); } catch {}
  fs.writeFileSync(path.join(OUT, `p60-settings-${PHASE}-results.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
