// P82 창 시험: 휴대폰 원격 연결의 짧은 끊김. 흉내 원격(p59-lib.mjs, ts-sim-proxy.mjs)으로
//   휴대폰: 브라우저 문맥 → ts-sim(47900, X-Forwarded-For 100.64.0.2 = laptop-a 자리) → 백엔드(47899). 판은 가짜 tailscale(p49-fake-tailscale.mjs)을 읽는다.
// 따로 띄운 개발용 판(atrium-dev-p82, 47899, backend/.dev)만 쓴다. PC 창은 띄우지 않고 짝 맺기 코드와 설정은 이 판의 CLI로 한다.
// 1. 압축: Chromium(iPhone 흉내 = Safari UA, 안드로이드 Chrome UA)과 Playwright WebKit(iPhone 흉내)으로 원격 연결을 열어
//    응답 머리글 Sec-WebSocket-Extensions(Chromium은 CDP, 둘 다 WebSocket.extensions)와 연결 기록의 ws.deflate를 남긴다.
// 2. 끊겨도 화면은 그대로: 휴대폰 전체 보기(셸, 에이전트)에서 서버 쪽 소켓을 갑자기 끊고(짧게, 4초 동안 받지 않게) 0.1초마다
//    전체 보기, 터미널(같은 xterm인지, 글이 남았는지, 붙는 중 표시), 입력 줄의 글과 초점, 다시 연결 띠를 잰다. 끊긴 동안 ⏎ 단추도 눌러 본다.
// P82_STAGE=before: 고치기 전 화면(재기만), after(기본): 고친 뒤(판정). 결과는 experiments/p82/(git 밖).
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p82-drops.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const STAGE = process.env.P82_STAGE || 'after';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p82');
const CONVOS = path.join(OUT, 'convos');
const PROJ = process.env.P82_PROJ || 'C:\\Workspace\\mtask-p82-proj';
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A, baseOf } = L;
const B0 = L.board({ session: 'atrium-dev-p82', port: 47899, sim: 47900, sim2: 47901 });
const LOCAL_SIM = `localhost:${B0.sim}`; // WebKit은 이름 바꾸기 플래그가 없어 localhost로 흉내 프록시에 붙는다(보안 출처)
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p82',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim},${LOCAL_SIM}`,
  ATRIUM_REMOTE_QUIET_MS: '4000',
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true }); fs.mkdirSync(PROJ, { recursive: true });
const { logger, sleep, until } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
const { chromium, webkit, devices } = await import('playwright');

const log = logger(`p82-drops-${STAGE}`);
const BASE = baseOf(B0.sim);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1200)}` : ''}`); };
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${STAGE}-${name}.png`) }); log(`스크린숏 experiments/p82/${STAGE}-${name}.png`); };
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36';
const PHONE = (ua) => ({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: ua });
const loadedOpen = (pg, ms = 60000) => pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: ms });
const splashGone = (pg) => pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
const newCode = () => call('device.code').code;
const logEntries = () => call('remote.log', { limit: 100 }).entries;

async function pair(pg, base, { tap = true } = {}) {
  await pg.goto(`${base}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await pg.fill('[data-field=pair-code]', newCode());
  if (tap) await pg.tap('[data-action=pair-submit]'); else await pg.click('[data-action=pair-submit]');
  await loadedOpen(pg); await splashGone(pg);
}
// 지금 연결의 압축(브라우저 WebSocket.extensions)과 직전 닫힘 기록
const sockOf = (pg) => pg.evaluate(() => ({ extensions: window.__mt.api.ws ? window.__mt.api.ws.extensions : null, url: window.__mt.api.ws ? window.__mt.api.ws.url.replace(/^wss?:\/\/[^/]+/, '') : null, closes: window.__mt.api.closeLog || null, ua: navigator.userAgent.slice(0, 60) }));

// 전체 보기의 지금 모습
const fullState = (pg) => pg.evaluate(() => {
  const full = document.querySelector('[data-role=phone-full]');
  const id = full && full.dataset.session;
  const tm = id && window.__mt.terms.get(id);
  let text = '';
  if (tm) { const b = tm.buffer.active; for (let r = 0; r < b.length; r++) { const l = b.getLine(r); if (l) text += l.translateToString(true) + '\n'; } }
  const ta = document.querySelector('[data-field=phone-line]');
  const st = window.__mt.getState();
  return {
    full: !!full, id, same: !!tm && tm === window.__p82term, marks: (text.match(/P82-MARK-\d+/g) || []).length, after: /P82-AFTER/.test(text), chars: text.replace(/\s/g, '').length,
    attaching: !!document.querySelector('[data-role=phone-full] .mt-term-note'), cover: !!document.querySelector('[data-role=phone-full] .mt-term-cover'),
    line: ta ? ta.value : null, focus: !!ta && document.activeElement === ta,
    banner: !!document.querySelector('[data-role=reconnect-banner]'), phase: window.__mt.api.conn.phase, status: window.__mt.api.status,
    toasts: st.toasts.map((x) => x.text).slice(-3),
  };
});
// 끊긴 뒤 0.1초마다 재서 줄인 기록
async function watch(pg, ms, { during = null } = {}) {
  const t0 = Date.now(); const tl = []; let did = false;
  while (Date.now() - t0 < ms) {
    const s = await fullState(pg);
    tl.push({ t: Date.now() - t0, ...s });
    if (during && !did && Date.now() - t0 >= during.at) { did = true; await during.fn(); }
    await sleep(100);
  }
  const ever = (k) => tl.some((x) => x[k]);
  const never = (k) => tl.every((x) => x[k]);
  const first = (f) => { const x = tl.find(f); return x ? x.t : null; };
  return {
    samples: tl.length, fullAlways: never('full'), termSame: never('same'), textKept: tl.every((x) => x.marks > 0), minChars: Math.min(...tl.map((x) => x.chars)),
    attachingEver: ever('attaching'), coverEver: ever('cover'), lineKept: tl.every((x) => x.line === tl[0].line), lineEnd: tl[tl.length - 1].line, focusAlways: never('focus'),
    bannerAt: first((x) => x.banner), bannerEnd: tl[tl.length - 1].banner, closedAt: first((x) => x.phase !== 'open'), reopenAt: first((x, i) => i > 0 && x.phase === 'open' && tl.slice(0, i).some((y) => y.phase !== 'open')),
    toasts: [...new Set(tl.flatMap((x) => x.toasts))], end: tl[tl.length - 1],
    tl: tl.filter((x, i) => i === 0 || JSON.stringify({ ...x, t: 0 }) !== JSON.stringify({ ...tl[i - 1], t: 0 })).map((x) => ({ t: x.t, full: x.full, same: x.same, marks: x.marks, chars: x.chars, attaching: x.attaching, line: x.line, focus: x.focus, banner: x.banner, phase: x.phase })),
  };
}

let browser, wk, sim;
try {
  // ---- 0. 판: 백엔드(이 판의 herdr 서버도 띄운다)와 시험 세션 ----
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  for (const s of sessions()) if (/^p82-/.test(s.name)) atrium('kill', s.sessionId, '--yes', '--delete');
  sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const spawn = (...a) => JSON.parse(atrium('--json', 'spawn', PROJ, ...a));
  const shellR = spawn('--kind', 'shell', '--name', 'p82-shell');
  const agentR = spawn('--model', 'haiku', '--name', 'p82-agent');
  check('시험 세션을 띄움', shellR.sessionId && agentR.sessionId);
  await until(() => { const s = byName('p82-shell'); return s && s.state !== 'starting'; }, 60000, 1000);
  const agentReady = await until(() => { const s = byName('p82-agent'); return s && s.state === 'ready' ? s : null; }, 120000, 1000).catch(() => null);
  if (!agentReady) log(`에이전트 화면 ${atrium('screen', 'p82-agent', '--text').slice(0, 600)}`);
  const ID = shellR.sessionId, AG = agentR.sessionId;

  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const found = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  browser = await chromium.launch({ headless: true, ...(found ? { executablePath: found } : { channel: 'chromium' }), args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`] });

  // ---- 1. 압축: Chromium(Safari UA, 안드로이드 Chrome UA), WebKit ----
  const hs = []; // CDP가 본 응답 머리글
  const ctxA = await browser.newContext(PHONE(SAFARI));
  const pA = await ctxA.newPage();
  pA.on('pageerror', (e) => log(`[phone pageerror] ${e.message}`));
  pA.on('console', (m) => { if (m.type() === 'error') log(`[phone console.error] ${m.text().slice(0, 200)}`); });
  const cdpA = await ctxA.newCDPSession(pA);
  await cdpA.send('Network.enable');
  cdpA.on('Network.webSocketHandshakeResponseReceived', (e) => { const h = e.response.headers || {}; hs.push({ who: 'chromium-safari-ua', status: e.response.status, ext: h['Sec-WebSocket-Extensions'] ?? h['sec-websocket-extensions'] ?? '' }); });
  await pair(pA, BASE);
  await sleep(800);
  const sockA = await sockOf(pA);
  log(`Chromium + Safari UA 소켓 ${JSON.stringify(sockA)} 머리글 ${JSON.stringify(hs)}`);
  const devAll = () => call('device.list').devices;
  const lastConnect = (pred = () => true) => logEntries().find((e) => e.event === 'connect' && pred(e));
  const cA = lastConnect((e) => /Safari/.test(e.browser || ''));
  if (STAGE === 'after') check('Chromium에 Safari UA: 원격 소켓에 압축이 없다(Sec-WebSocket-Extensions 없음, 연결 기록 ws.deflate=false)', sockA.extensions === '' && hs.length && hs.every((h) => !h.ext) && cA && cA.ws && cA.ws.deflate === false, { extensions: sockA.extensions, headers: hs, log: cA && { browser: cA.browser, ws: cA.ws } });
  else check('[전] Chromium에 Safari UA의 소켓', true, { extensions: sockA.extensions, headers: hs, log: cA && cA.ws });

  const ctxC = await browser.newContext(PHONE(ANDROID));
  const pC = await ctxC.newPage();
  const cdpC = await ctxC.newCDPSession(pC);
  await cdpC.send('Network.enable');
  const hsC = [];
  cdpC.on('Network.webSocketHandshakeResponseReceived', (e) => { const h = e.response.headers || {}; hsC.push({ who: 'chromium-android-ua', status: e.response.status, ext: h['Sec-WebSocket-Extensions'] ?? h['sec-websocket-extensions'] ?? '' }); });
  await pair(pC, BASE);
  await sleep(800);
  const sockC = await sockOf(pC);
  const cC = lastConnect((e) => /Chrome/.test(e.browser || ''));
  check('Chromium에 안드로이드 Chrome UA: 원격 소켓은 지금처럼 압축(permessage-deflate)', /permessage-deflate/.test(sockC.extensions) && hsC.some((h) => /permessage-deflate/.test(h.ext)) && cC && cC.ws && cC.ws.deflate === true, { extensions: sockC.extensions, headers: hsC, log: cC && { browser: cC.browser, ws: cC.ws } });
  await ctxC.close();

  // Playwright WebKit(iPhone 흉내). 이름 바꾸기 플래그가 없어 localhost:<흉내 포트>로 연다
  let wkRes = null;
  try {
    // 이 Playwright가 바라는 판(ms-playwright/webkit-<판>)이 없으면 열지 못한다. 다른 판은 프로토콜이 달라 멈추므로 쓰지 않는다(P82 작업 기록)
    wk = await webkit.launch({ headless: true, timeout: 30000 });
    const wctx = await wk.newContext({ ...devices['iPhone 15'], locale: 'ko-KR' });
    const wp = await wctx.newPage();
    wp.on('pageerror', (e) => log(`[webkit pageerror] ${e.message}`));
    await pair(wp, `http://${LOCAL_SIM}`, { tap: true });
    await sleep(800);
    const s = await sockOf(wp);
    const cW = lastConnect((e) => /Safari/.test(e.browser || '') && e.at > Date.now() - 20000);
    wkRes = { extensions: s.extensions, ua: s.ua, log: cW && { browser: cW.browser, ws: cW.ws } };
    await wp.screenshot({ path: path.join(OUT, `${STAGE}-00-webkit-board.png`) });
    await wctx.close();
  } catch (e) { wkRes = { error: e.message.split('\n')[0] }; }
  log(`WebKit ${JSON.stringify(wkRes)}`);
  if (wkRes && wkRes.error && /Executable doesn't exist/.test(wkRes.error)) log('WebKit을 열지 못해(이 Playwright 판의 WebKit이 설치되지 않음) Chromium + Safari UA 결과로 갈음한다');
  else if (STAGE === 'after') check('Playwright WebKit(iPhone 흉내): 흉내 원격으로 열리고 압축이 없다', wkRes && !wkRes.error && wkRes.extensions === '' && wkRes.log && wkRes.log.ws && wkRes.log.ws.deflate === false, wkRes);
  else check('[전] Playwright WebKit의 소켓', true, wkRes);

  // ---- 2. 전체 보기(셸) ----
  await pA.waitForSelector(`.react-flow__node[data-id="${ID}"]`, { timeout: 20000 });
  const openFullOn = async (id) => {
    const n = call('board.get').nodes.find((x) => x.session_id === id);
    const z = Math.max(0.55, 380 / n.w);
    await pA.evaluate((vp) => window.__mt.getState().setViewport(vp), { x: 20 - n.x * z, y: 140 - n.y * z, zoom: z });
    await sleep(1500);
    const b = await pA.evaluate((id) => { const el = document.querySelector(`.react-flow__node[data-id="${id}"] .mt-term`); const r = el.getBoundingClientRect(); return { x: Math.min(r.left + r.width / 2, innerWidth - 20), y: Math.min(r.top + r.height / 2, innerHeight - 40) }; }, id);
    await pA.touchscreen.tap(b.x, b.y);
    await pA.waitForSelector(`[data-role=phone-full][data-session="${id}"] .xterm-screen`, { timeout: 20000 });
    await sleep(2000);
    await pA.evaluate((id) => { window.__p82term = window.__mt.terms.get(id); }, id);
  };
  await openFullOn(ID);
  // 셸에 표시 글을 몇 줄 낸다(입력 줄로)
  for (let i = 1; i <= 3; i++) { await pA.fill('[data-field=phone-line]', `echo P82-MARK-${i}`); await pA.tap('[data-role=phone-keys] [data-key=enter]'); await sleep(700); }
  await until(async () => (await fullState(pA)).marks >= 3, 15000, 300).catch(() => {});
  log(`셸 화면 ${JSON.stringify(atrium('screen', 'p82-shell', '--text').split(/\r?\n/).filter((l) => /P82/.test(l)).slice(0, 6))}`);
  // 입력 줄에 글을 쓰고 초점을 둔다(키보드가 열린 것과 같다)
  await pA.focus('[data-field=phone-line]');
  await pA.type('[data-field=phone-line]', 'echo P82-AFTER');
  await sleep(500);
  const before0 = await fullState(pA);
  log(`끊기 전 ${JSON.stringify(before0)}`);
  await shot(pA, '01-full-before-drop');

  // 짧은 끊김: 서버 쪽 소켓을 끊고 곧바로 다시 받는다
  const n1 = sim.dropWs(0);
  setTimeout(() => shot(pA, '02-full-short-drop-300ms').catch(() => {}), 300);
  const w1 = await watch(pA, 3500);
  await shot(pA, '03-full-short-drop-after');
  const short = { dropped: n1, ...w1 };
  log(`짧은 끊김 ${JSON.stringify({ ...short, tl: undefined })}`);
  log(`짧은 끊김 기록 ${JSON.stringify(short.tl)}`);
  if (STAGE === 'before') check('[전] 짧은 끊김(서버 쪽 소켓 닫힘, 곧 다시 붙음)의 전체 보기', true, { ...short, tl: undefined });
  else {
    check('짧은 끊김: 전체 보기를 나가지 않고 같은 터미널(비우지 않음, 붙는 중 표시 없음)', short.fullAlways && short.termSame && short.textKept && !short.attachingEver && !short.coverEver && short.reopenAt != null, { ...short, tl: undefined, end: undefined });
    check('짧은 끊김: 입력 줄의 글과 초점이 그대로, 다시 연결 띠가 뜨지 않는다', short.lineKept && short.lineEnd === 'echo P82-AFTER' && short.focusAlways && short.bannerAt == null, { line: short.lineEnd, focus: short.focusAlways, bannerAt: short.bannerAt, closedAt: short.closedAt, reopenAt: short.reopenAt });
  }

  // 긴 끊김: 4초 동안 다시 붙는 것도 받지 않는다. 그동안 ⏎를 누른다
  await pA.focus('[data-field=phone-line]').catch(() => {});
  const n2 = sim.dropWs(4000);
  setTimeout(() => shot(pA, '04-full-long-drop-2500ms').catch(() => {}), 2500);
  const w2 = await watch(pA, 9000, { during: { at: 1000, fn: () => pA.tap('[data-role=phone-keys] [data-key=enter]').catch((e) => log(`⏎ 누르기 실패 ${e.message}`)) } });
  await shot(pA, '05-full-long-drop-after');
  const long = { dropped: n2, ...w2 };
  log(`긴 끊김 ${JSON.stringify({ ...long, tl: undefined })}`);
  log(`긴 끊김 기록 ${JSON.stringify(long.tl)}`);
  if (STAGE === 'before') check('[전] 긴 끊김(4초 동안 받지 않음, 그동안 ⏎)의 전체 보기', true, { ...long, tl: undefined });
  else {
    check('긴 끊김: 전체 보기와 같은 터미널, 입력 줄의 글과 초점을 지킨다(끊긴 동안 ⏎는 보내지 않고 글을 둔다)', long.fullAlways && long.termSame && long.textKept && !long.coverEver && long.lineEnd === 'echo P82-AFTER' && long.focusAlways && long.reopenAt != null, { ...long, tl: undefined, end: undefined });
    check('긴 끊김: 다시 연결 띠는 2초 뒤에 뜨고 다시 붙으면 사라진다, 오류 알림 없음', long.bannerAt != null && long.bannerAt >= 1800 && !long.bannerEnd && !long.toasts.length, { bannerAt: long.bannerAt, closedAt: long.closedAt, reopenAt: long.reopenAt, bannerEnd: long.bannerEnd, toasts: long.toasts });
  }
  // 다시 붙은 뒤 이어 그린다: 입력 줄의 글을 보내면 터미널에 나온다
  await sleep(800);
  await pA.focus('[data-field=phone-line]').catch(() => {});
  const lineNow = await pA.inputValue('[data-field=phone-line]');
  if (!lineNow) await pA.type('[data-field=phone-line]', 'echo P82-AFTER');
  await pA.tap('[data-role=phone-keys] [data-key=enter]');
  const resumed = await until(async () => (await fullState(pA)).after, 10000, 300).then(() => true, () => false);
  const end = await fullState(pA);
  await shot(pA, '06-full-resumed');
  if (STAGE === 'before') check('[전] 다시 붙은 뒤 입력', true, { resumed, line: lineNow, end });
  else check('다시 붙은 뒤 이어 그린다(보낸 줄이 같은 터미널에 나온다)', resumed && end.same && end.marks >= 3, { resumed, same: end.same, marks: end.marks });

  // ---- 3. 전체 보기(에이전트, TUI의 full 프레임) ----
  if (agentReady) {
    await pA.evaluate(() => history.back());
    await pA.waitForFunction(() => !document.querySelector('[data-role=phone-full]'), null, { timeout: 5000 }).catch(() => {});
    await sleep(800);
    await openFullOn(AG);
    const a0 = await pA.evaluate(() => { const tm = window.__p82term; const b = tm.buffer.active; let s = ''; for (let r = 0; r < tm.rows; r++) { const l = b.getLine(b.viewportY + r); if (l) s += l.translateToString(true) + '\n'; } return s; });
    await shot(pA, '07-agent-before-drop');
    sim.dropWs(0);
    const w3 = await watch(pA, 3500);
    const a1 = await pA.evaluate(() => { const tm = window.__mt.terms.get(document.querySelector('[data-role=phone-full]').dataset.session); const b = tm.buffer.active; let s = ''; for (let r = 0; r < tm.rows; r++) { const l = b.getLine(b.viewportY + r); if (l) s += l.translateToString(true) + '\n'; } return s; });
    await shot(pA, '08-agent-after-drop');
    const sameScreen = a0.replace(/\s+/g, ' ').trim() === a1.replace(/\s+/g, ' ').trim();
    log(`에이전트 화면 전 ${JSON.stringify(a0.slice(0, 300))} 뒤 ${JSON.stringify(a1.slice(0, 300))}`);
    const ag = { fullAlways: w3.fullAlways, termSame: w3.termSame, minChars: w3.minChars, attachingEver: w3.attachingEver, bannerAt: w3.bannerAt, sameScreen, reopenAt: w3.reopenAt };
    if (STAGE === 'before') check('[전] 에이전트 전체 보기의 짧은 끊김', true, ag);
    else check('에이전트 전체 보기: 짧은 끊김 뒤에도 같은 터미널, 비지 않고, 다시 붙은 뒤 같은 화면(full 프레임으로 다시 그림)', ag.fullAlways && ag.termSame && ag.minChars > 20 && !ag.attachingEver && ag.bannerAt == null && sameScreen, ag);
  } else check('에이전트가 준비됨(에이전트 전체 보기 시험)', false, 'agent not ready');

  // ---- 4. 연결 기록: 끊김 코드와 직전 닫힘 ----
  await sleep(1000);
  const sockEnd = await sockOf(pA);
  const ents = logEntries().filter((e) => e.at > Date.now() - 120000);
  const disc = ents.filter((e) => e.event === 'disconnect' && e.ws).slice(0, 4).map((e) => ({ reason: e.reason, ws: e.ws }));
  const conn = ents.filter((e) => e.event === 'connect' && e.prev).slice(0, 4).map((e) => ({ prev: e.prev, ws: e.ws }));
  log(`창이 본 닫힘 ${JSON.stringify(sockEnd.closes)}`);
  log(`연결 기록 disconnect ${JSON.stringify(disc)}`);
  log(`연결 기록 connect ${JSON.stringify(conn)}`);
  check('연결 기록: disconnect에 서버가 받은 코드(1006)·붙어 있던 시간·압축·수·바이트, connect에 창이 본 직전 닫힘(1006, 깨끗하지 않음)', disc.some((d) => d.ws.code === 1006 && d.ws.ms >= 0 && d.ws.out > 0 && d.ws.outB > 0 && d.ws.deflate === false && Array.isArray(d.ws.last)) && conn.length && conn.some((c) => c.prev.code === 1006 && c.prev.clean === false), { disc: disc.slice(0, 2), conn: conn.slice(0, 2) });
} catch (e) {
  log(`오류 ${e.stack}`);
  check('시험이 끝까지 돎', false, e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (wk) await wk.close().catch(() => {});
  if (sim) await sim.close().catch(() => {});
  try { for (const s of sessions()) if (/^p82-/.test(s.name) || path.resolve(s.cwd || '').toLowerCase() === path.resolve(PROJ).toLowerCase()) atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log(`정리 오류 ${e.message}`); }
  fs.writeFileSync(path.join(OUT, `p82-drops-${STAGE}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
