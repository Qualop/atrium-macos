// P83 창 시험: 휴대폰(iPhone 흉내) 화면 다듬기. 흉내 원격(p59-lib.mjs, ts-sim-proxy.mjs)으로
//   휴대폰: 브라우저 문맥 → ts-sim(47898, X-Forwarded-For 100.64.0.2 = laptop-a 자리) → 백엔드(47897). 판은 가짜 tailscale(p49-fake-tailscale.mjs)을 읽는다.
// 따로 띄운 개발용 판(atrium-dev-p83, 47897, backend/.dev)만 쓴다. PC 창은 띄우지 않고 짝 맺기 코드와 설정은 이 판의 CLI로 한다.
// iOS 홈 화면 앱의 짧은 창 높이 흉내: 화면(뷰포트)은 393×852, navigator.standalone = true, innerHeight·visualViewport.height는 793(상태 표시줄 59만큼 짧다).
//   안전 영역은 CDP Emulation.setSafeAreaInsetsOverride(위 59, 아래 34)로 준다(없는 Chromium이면 0으로 두고 적는다). 키보드는 visualViewport를 줄여 흉내 낸다(P76).
// 단계(전과 뒤가 같다): 1 보드 화면과 명령 바 열기·보내기(손가락), 2 키보드가 열린 명령 바, 3 전체 보기 위 띠, 4 아래 끝, 5 가장 작은 글자의 칸 수,
//   6 전체 보기에서 키보드, 7 나가기 단추로 보드로.
// P83_STAGE=before: 고치기 전(재기만), after(기본): 고친 뒤(판정). 결과는 experiments/p83/(git 밖).
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p83-phone.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const STAGE = process.env.P83_STAGE || 'after';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p83');
const CONVOS = path.join(OUT, 'convos');
const PROJ = process.env.P83_PROJ || 'C:\\Workspace\\mtask-p83-proj';
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A, baseOf } = L;
const B0 = L.board({ session: 'atrium-dev-p83', port: 47897, sim: 47898, sim2: 47896 });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p83',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim},localhost:${B0.sim}`,
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

const log = logger(`p83-phone-${STAGE}`);
const BASE = baseOf(B0.sim);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1400)}` : ''}`); };
const judge = (name, ok, detail) => (STAGE === 'before' ? check(`[전] ${name}`, true, detail) : check(name, ok, detail));
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${STAGE}-${name}.png`) }); log(`스크린숏 experiments/p83/${STAGE}-${name}.png`); };
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const W = 393, H = 852, TOP = 59, BOTTOM = 34, SHORT = H - TOP;
const PHONE = { viewport: { width: W, height: H }, screen: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: SAFARI };
const loadedOpen = (pg, ms = 60000) => pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: ms });
const splashGone = (pg) => pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});

// iOS 홈 화면 앱 흉내: standalone, 짧은 창 높이(innerHeight·visualViewport), 키보드(window.__kb(px))
const FAKE_IOS_APP = ({ short }) => {
  try { Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true }); } catch {}
  const real = window.visualViewport;
  const ev = new EventTarget();
  let kb = 0;
  const vv = Object.assign(ev, {});
  Object.defineProperties(vv, {
    height: { get: () => short - kb }, width: { get: () => window.innerWidth },
    offsetTop: { get: () => 0 }, offsetLeft: { get: () => 0 }, pageTop: { get: () => 0 }, pageLeft: { get: () => 0 },
    scale: { get: () => (real ? real.scale : 1) },
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => short });
  window.__kb = (px) => { kb = px; ev.dispatchEvent(new Event('resize')); };
};

const newCode = () => call('device.code').code;
async function pair(pg, base) {
  await pg.goto(`${base}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await pg.fill('[data-field=pair-code]', newCode());
  await pg.tap('[data-action=pair-submit]');
  await loadedOpen(pg); await splashGone(pg);
}

// 화면의 지금 모습(창 좌표)
const rectOf = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; })()`;
const barState = (pg) => pg.evaluate(`({
  bar: ${rectOf('[data-role=bottom] .mt-cmd')}, hidden: document.querySelector('[data-role=bottom]')?.dataset.hidden === '1',
  kb: document.querySelector('[data-role=bottom]')?.dataset.kb || null,
  handle: ${rectOf('[data-action=bottom-open]')}, hint: ${rectOf('[data-role=bottom-hint]')},
  focus: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.role || document.activeElement.tagName : null,
  vvH: window.visualViewport.height, innerH: window.innerHeight, stage: ${rectOf('.mt-stage')},
  tall: document.documentElement.classList.contains('mt-tall'), rootH: Math.round(document.getElementById('root').getBoundingClientRect().height),
})`);
const fullInfo = (pg) => pg.evaluate(`(() => {
  const full = document.querySelector('[data-role=phone-full]');
  const id = full && full.dataset.session;
  const tm = id && window.__mt.terms.get(id);
  const out = document.querySelector('[data-role=phone-full-out]');
  const cs = out ? getComputedStyle(out) : null;
  const at = (x, y) => { const el = document.elementFromPoint(x, y); return el ? { tag: el.tagName, cls: String(el.className || '').slice(0, 40), role: el.dataset ? el.dataset.role || null : null, bg: getComputedStyle(el).backgroundColor, inFull: !!(el.closest && el.closest('[data-role=phone-full]')) } : null; };
  return {
    open: !!full, id, full: ${rectOf('[data-role=phone-full]')}, strip: ${rectOf('[data-role=phone-full-out]')}, padTop: cs ? cs.paddingTop : null,
    name: ${rectOf('.mt-full-name')}, exit: ${rectOf('[data-action=phone-full-exit]')}, hint: !!document.querySelector('.mt-full-hint'),
    fontDown: ${rectOf('[data-action=phone-font-down]')}, fontDownDisabled: !!document.querySelector('[data-action=phone-font-down][disabled]'),
    keys: ${rectOf('[data-role=phone-keys]')}, line: ${rectOf('[data-role=phone-line]')}, term: ${rectOf('[data-role=phone-full-term]')},
    cols: tm ? tm.cols : null, rows: tm ? tm.rows : null, fontSize: tm ? tm.options.fontSize : null,
    scale: (() => { try { return localStorage.getItem('mt.phoneTermScale'); } catch { return null; } })(),
    bottomAt: at(${W / 2}, ${H - 4}), belowKeysAt: at(${W / 2}, ${H - 20}),
    htmlBg: getComputedStyle(document.documentElement).backgroundColor, bodyBg: getComputedStyle(document.body).backgroundColor,
    innerH: window.innerHeight, vvH: window.visualViewport.height, tall: document.documentElement.classList.contains('mt-tall'),
    active: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.field || document.activeElement.dataset.role || null : null,
  };
})()`);

let browser, wk, sim;
try {
  // ---- 0. 판: 백엔드(이 판의 herdr 서버도 띄운다)와 시험 세션 ----
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  for (const s of sessions()) if (/^p83-/.test(s.name)) atrium('kill', s.sessionId, '--yes', '--delete');
  sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const spawn = (...a) => JSON.parse(atrium('--json', 'spawn', PROJ, ...a));
  const shellR = spawn('--kind', 'shell', '--name', 'p83-shell');
  const agentR = spawn('--model', 'haiku', '--name', 'p83-agent');
  check('시험 세션을 띄움', shellR.sessionId && agentR.sessionId);
  await until(() => { const s = byName('p83-shell'); return s && s.state !== 'starting'; }, 60000, 1000);
  const agentReady = await until(() => { const s = byName('p83-agent'); return s && (s.state === 'ready' || s.state === 'trust_wait') ? s : null; }, 120000, 1000).catch(() => null);
  if (agentReady && agentReady.state === 'trust_wait') {
    fs.writeFileSync(path.join(DEV, 'p83-need-trust.txt'), `p83-agent in ${PROJ} asks the folder trust question\n`);
    throw new Error('trust question (backend/.dev/p83-need-trust.txt)');
  }
  if (!agentReady) log(`에이전트 화면 ${atrium('screen', 'p83-agent', '--text').slice(0, 600)}`);
  const ID = shellR.sessionId, AG = agentR.sessionId;

  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const found = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  browser = await chromium.launch({ headless: true, ...(found ? { executablePath: found } : { channel: 'chromium' }), args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(FAKE_IOS_APP, { short: SHORT });
  const pA = await ctx.newPage();
  pA.on('pageerror', (e) => log(`[phone pageerror] ${e.message}`));
  pA.on('console', (m) => { if (m.type() === 'error') log(`[phone console.error] ${m.text().slice(0, 200)}`); });
  const cdp = await ctx.newCDPSession(pA);
  let safe = 'none';
  try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: TOP, bottom: BOTTOM, left: 0, right: 0 } }); safe = `top ${TOP}, bottom ${BOTTOM}`; } catch (e) { safe = `없음(${e.message.split('\n')[0].slice(0, 80)})`; }
  log(`안전 영역 흉내: ${safe}`);
  await pair(pA, BASE);
  await pA.evaluate(() => { try { localStorage.removeItem('mt.phoneTermScale'); } catch {} });
  await sleep(1000);
  const env0 = await pA.evaluate(() => ({ standalone: navigator.standalone, innerH: innerHeight, vvH: visualViewport.height, screenH: screen.height, safeTop: getComputedStyle(document.documentElement).getPropertyValue('--x') }));
  log(`흉내 ${JSON.stringify(env0)}`);

  // ---- 1. 보드 화면: 명령 바를 손가락으로 열고 보내기 ----
  await pA.waitForSelector(`.react-flow__node[data-id="${ID}"]`, { timeout: 20000 });
  const b0 = await barState(pA);
  await shot(pA, '01-board');
  // 손가락으로 아래 가운데(손잡이가 있으면 손잡이, 없으면 아래 띠)를 탭한다
  const tapAt = b0.handle ? { x: (b0.handle.left + b0.handle.right) / 2, y: (b0.handle.top + b0.handle.bottom) / 2 } : { x: W / 2, y: H - 14 };
  await pA.touchscreen.tap(tapAt.x, tapAt.y);
  await sleep(600);
  const b1 = await barState(pA);
  await shot(pA, '02-board-bar-tapped');
  log(`명령 바 탭 전 ${JSON.stringify(b0)} 뒤 ${JSON.stringify(b1)}`);
  judge('명령 바: 손가락으로 아래 손잡이를 탭하면 바가 열리고 입력칸에 초점(화면 폭에 맞춘 바)', !!b0.handle && b0.hidden && !b1.hidden && b1.focus === 'command' && b1.bar && b1.bar.w >= W - 40 && b1.bar.bottom <= H, { before: { hidden: b0.hidden, handle: b0.handle, bar: b0.bar }, after: { hidden: b1.hidden, focus: b1.focus, bar: b1.bar } });
  // 키보드가 올라오면 바가 키보드 위
  await pA.evaluate(() => window.__kb(336)); await sleep(600);
  const b2 = await barState(pA);
  await shot(pA, '03-board-bar-keyboard');
  log(`명령 바 키보드 ${JSON.stringify(b2)}`);
  judge('명령 바: 키보드가 올라오면 바 전체가 보이는 높이 안(키보드 위)', !b2.hidden && b2.bar && b2.bar.bottom <= b2.vvH && b2.bar.top >= 0, { bar: b2.bar, vvH: b2.vvH, kb: b2.kb });
  // 보내기(에이전트에게)
  let sent = null;
  if (!b2.hidden && agentReady) {
    await pA.fill('[data-role=command]', '@p83-agent reply with the single word PONG');
    await pA.tap('[data-action=send]');
    sent = await until(() => pA.evaluate(() => [...window.__mt.getState().deliveries.values()].map((d) => ({ name: d.name, status: d.status })).find((d) => d.name === 'p83-agent') || null), 15000, 300).catch(() => null);
    await sleep(500);
  }
  const b3 = await barState(pA);
  await shot(pA, '04-board-bar-sent');
  judge('명령 바: 손가락으로 보내기(전달이 생기고 입력칸이 빈다)', !!sent && (await pA.inputValue('[data-role=command]').catch(() => 'x')) === '', { sent, bar: b3.bar, hidden: b3.hidden });
  // 바 밖(판)을 탭하면 닫힌다
  await pA.evaluate(() => window.__kb(0));
  // 빈 판 자리(노드가 없는 곳)를 찾아 탭한다
  const pane = await pA.evaluate(() => { for (let y = 200; y < 700; y += 40) for (let x = 60; x < 360; x += 40) { const el = document.elementFromPoint(x, y); if (el && el.closest && el.closest('.react-flow__pane, .react-flow__renderer') && !el.closest('.react-flow__node')) return { x, y }; } return null; });
  log(`빈 판 자리 ${JSON.stringify(pane)}`);
  await pA.touchscreen.tap(pane ? pane.x : 20, pane ? pane.y : 400); await sleep(1200);
  if (await pA.$('[data-role=phone-full]')) { await pA.evaluate(() => history.back()); await sleep(800); }
  const b4 = await barState(pA);
  judge('명령 바: 판을 탭하면 초점이 풀리고 바가 숨는다(손잡이가 다시 보인다)', b4.hidden && !!b4.handle && b4.focus !== 'command', { hidden: b4.hidden, handle: !!b4.handle, focus: b4.focus });
  await shot(pA, '05-board-bar-closed');

  // ---- 3. 전체 보기 위 띠 ----
  const n = call('board.get').nodes.find((x) => x.session_id === ID);
  const z = Math.max(0.55, 380 / n.w);
  await pA.evaluate((vp) => window.__mt.getState().setViewport(vp), { x: 10 - n.x * z, y: 160 - n.y * z, zoom: z });
  await sleep(1500);
  const tp = await pA.evaluate((id) => { const el = document.querySelector(`.react-flow__node[data-id="${id}"] .mt-term`); const r = el.getBoundingClientRect(); return { x: Math.min(r.left + r.width / 2, innerWidth - 20), y: Math.min(r.top + r.height / 2, 600) }; }, ID);
  await pA.touchscreen.tap(tp.x, tp.y);
  await pA.waitForSelector(`[data-role=phone-full][data-session="${ID}"] .xterm-screen`, { timeout: 20000 });
  await sleep(2000);
  // 셸에 긴 줄을 낸다(칸 수를 눈으로 본다). 입력 줄로 치고 키보드는 내린다
  await pA.fill('[data-field=phone-line]', 'echo ' + Array.from({ length: 13 }, (_, i) => `${String(i * 10).padStart(3, '0')}-------`).join(''));
  await pA.tap('[data-role=phone-keys] [data-key=enter]');
  await pA.evaluate(() => document.activeElement && document.activeElement.blur());
  await sleep(1200);
  const f0 = await fullInfo(pA);
  log(`전체 보기 ${JSON.stringify(f0)}`);
  await shot(pA, '06-full');
  await pA.screenshot({ path: path.join(OUT, `${STAGE}-07-full-top.png`), clip: { x: 0, y: 0, width: W, height: 140 } });
  judge('위 띠: 나가기 단추가 왼쪽에 있고, 글은 안전 영역보다 10px 넘게 아래, "탭하면 보드로" 글은 없다', !!f0.exit && f0.exit.left < 30 && f0.exit.h >= 30 && f0.name && f0.name.top >= TOP + 10 && !f0.hint, { exit: f0.exit, name: f0.name, strip: f0.strip, padTop: f0.padTop, hint: f0.hint });

  // ---- 4. 아래 끝 ----
  await pA.screenshot({ path: path.join(OUT, `${STAGE}-08-full-bottom.png`), clip: { x: 0, y: H - 200, width: W, height: 200 } });
  judge('아래 끝: 전체 보기가 화면 끝(852)까지 차고, 맨 아래는 전체 보기 안, 키 줄은 홈 표시줄 바로 위', f0.full && f0.full.bottom === H && f0.bottomAt && f0.bottomAt.inFull && f0.keys && H - f0.keys.bottom <= BOTTOM + 6 && f0.tall, { full: f0.full, keys: f0.keys, bottomAt: f0.bottomAt, belowKeysAt: f0.belowKeysAt, innerH: f0.innerH, vvH: f0.vvH, tall: f0.tall, htmlBg: f0.htmlBg });

  // ---- 5. 가장 작은 글자 ----
  const cols0 = f0.cols;
  for (let i = 0; i < 14; i++) { const ok = await pA.tap('[data-action=phone-font-down]', { timeout: 1500 }).then(() => true, () => false); if (!ok) break; await sleep(150); }
  await sleep(1500);
  const f1 = await fullInfo(pA);
  log(`가장 작은 글자 ${JSON.stringify({ cols: f1.cols, rows: f1.rows, fontSize: f1.fontSize, scale: f1.scale, disabled: f1.fontDownDisabled })}`);
  const probe = await pA.evaluate(() => {
    const id = document.querySelector('[data-role=phone-full]').dataset.session; const tm = window.__mt.terms.get(id); const c = tm._core;
    const rows = document.querySelector('[data-role=phone-full] .xterm-rows'); const cs = rows ? getComputedStyle(rows) : null;
    const wrap = document.querySelector('[data-role=phone-full] .xterm'); const par = wrap && wrap.parentElement;
    return { char: c._charSizeService && { w: c._charSizeService.width, h: c._charSizeService.height }, cell: c._renderService && c._renderService.dimensions && c._renderService.dimensions.css.cell,
      font: cs && { size: cs.fontSize, family: cs.fontFamily.slice(0, 60), ls: cs.letterSpacing },
      span: (() => { const sp = document.createElement('span'); sp.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${tm.options.fontSize}px ${tm.options.fontFamily}`; sp.textContent = 'W'.repeat(100); document.body.appendChild(sp); const w = sp.getBoundingClientRect().width / 100; sp.remove(); return w; })(), jb: document.fonts.check('5.6px "JetBrains Mono Variable"'), parentW: par && par.getBoundingClientRect().width, dpr: devicePixelRatio, scrollback: tm.options.scrollback };
  });
  log(`글자 재기 ${JSON.stringify(probe)}`);
  await shot(pA, '09-full-smallest');
  await pA.screenshot({ path: path.join(OUT, `${STAGE}-10-full-smallest-zoom.png`), clip: { x: 0, y: 100, width: W / 2, height: 150 } });
  // Windows Chromium은 작은 글자의 글자 폭을 정수 px로 재고(5.6px → 4px 칸), iOS Safari(CoreText)는 소수 그대로(JetBrains Mono 0.6em = 3.36px) 잰다.
  // 그래서 흉내의 칸 수와 함께, 같은 터미널 폭(스크롤 막대 14px 뺀)을 0.6em 칸으로 나눈 iPhone 칸 수를 본다
  const freeW = probe.parentW - (probe.scrollback ? 14 : 0);
  const iphoneCols = Math.floor(freeW / (0.6 * f1.fontSize));
  log(`칸 수: 흉내 ${f1.cols}(칸 ${probe.cell && probe.cell.width}px), iPhone 예상 ${iphoneCols}(칸 ${(0.6 * f1.fontSize).toFixed(2)}px, 폭 ${freeW}px), 글 폭 재기 ${probe.span}`);
  judge('가장 작은 글자(5.6px): A−는 끝에서 막히고, 흉내 칸 수는 정수 칸 폭대로, iPhone(0.6em 칸)에서는 110칸 넘게', f1.fontDownDisabled && f1.scale === '0.4' && f1.fontSize === 5.6 && f1.cols === Math.floor(freeW / probe.cell.width) && iphoneCols >= 110, { cols0, cols: f1.cols, iphoneCols, cell: probe.cell, rows: f1.rows, fontSize: f1.fontSize, scale: f1.scale, disabled: f1.fontDownDisabled });
  // 저장값이 맞지 않으면 안전하게: 0.1을 넣고 다시 열면 0.4
  // ---- 6. 전체 보기에서 키보드 ----
  await pA.focus('[data-field=phone-line]');
  await pA.evaluate(() => window.__kb(336)); await sleep(900);
  const f2 = await fullInfo(pA);
  await shot(pA, '11-full-keyboard');
  log(`전체 보기 키보드 ${JSON.stringify({ full: f2.full, keys: f2.keys, vvH: f2.vvH, rows: f2.rows, active: f2.active })}`);
  check(`${STAGE === 'before' ? '[전] ' : ''}키보드가 올라오면 키 줄이 키보드 위, 터미널 줄 수 그대로(P76)`, f2.keys && f2.keys.bottom <= f2.vvH + 1 && f2.rows === f1.rows && f2.active === 'phone-line', { keys: f2.keys, vvH: f2.vvH, rows: [f1.rows, f2.rows], active: f2.active });
  await pA.evaluate(() => window.__kb(0)); await pA.evaluate(() => document.activeElement && document.activeElement.blur()); await sleep(800);
  const f3 = await fullInfo(pA);
  judge('키보드가 내려가면 다시 아래 끝까지', f3.full && f3.full.bottom === H, { full: f3.full, rows: f3.rows });

  // ---- 7. 나가기 단추로 보드로 ----
  let exitOk = false, how = 'none';
  if (await pA.$('[data-action=phone-full-exit]')) { await pA.tap('[data-action=phone-full-exit]'); how = 'button'; } else { await pA.touchscreen.tap(W / 2, TOP + 20); how = 'strip-tap'; }
  exitOk = await pA.waitForFunction(() => !document.querySelector('[data-role=phone-full]'), null, { timeout: 5000 }).then(() => true, () => false);
  await sleep(600);
  await shot(pA, '12-back-on-board');
  const after = await pA.evaluate(() => ({ hist: history.state, board: !!document.querySelector('.react-flow'), fullOn: document.documentElement.classList.contains('mt-full-on') }));
  judge('나가기 단추를 탭하면 보드로 돌아온다(기록 칸도 되돌린다)', how === 'button' && exitOk && after.board && !after.fullOn && !(after.hist && after.hist.mtFull), { how, exitOk, after });
  // 띠 누르기·오므리기는 그대로(띠 누르기만 다시 확인)
  await pA.touchscreen.tap(tp.x, tp.y);
  await pA.waitForSelector('[data-role=phone-full]', { timeout: 10000 });
  await sleep(1200);
  const nb = await fullInfo(pA);
  await pA.touchscreen.tap(nb.name ? nb.name.right + 30 : W / 2, nb.name ? (nb.name.top + nb.name.bottom) / 2 : TOP + 20);
  const stripOk = await pA.waitForFunction(() => !document.querySelector('[data-role=phone-full]'), null, { timeout: 5000 }).then(() => true, () => false);
  check(`${STAGE === 'before' ? '[전] ' : ''}위 띠(단추 밖)를 탭해도 보드로 나온다(P76 그대로)`, stripOk, { stripOk });
  // 저장값 맞추기: 이상한 값(0.1)을 넣고 다시 열면 가장 작은 값
  await pA.evaluate(() => { try { localStorage.setItem('mt.phoneTermScale', '0.1'); } catch {} });
  await pA.touchscreen.tap(tp.x, tp.y);
  await pA.waitForSelector(`[data-role=phone-full] .xterm-screen`, { timeout: 10000 });
  await sleep(1500);
  const f4 = await fullInfo(pA);
  judge('저장값 0.1은 가장 작은 글자(40%, 5.6px)로 맞춘다', f4.fontSize === 5.6, { fontSize: f4.fontSize, cols: f4.cols });
  await pA.evaluate(() => { try { localStorage.removeItem('mt.phoneTermScale'); } catch {} });

  // ---- 8. 에이전트 전체 보기(가장 작은 글자에서 Claude Code 화면) ----
  if (agentReady) {
    await pA.evaluate(() => history.back()); await sleep(800);
    await pA.evaluate(() => { try { localStorage.setItem('mt.phoneTermScale', '0.4'); } catch {} });
    const na = call('board.get').nodes.find((x) => x.session_id === AG);
    const za = Math.max(0.55, 380 / na.w);
    await pA.evaluate((vp) => window.__mt.getState().setViewport(vp), { x: 10 - na.x * za, y: 160 - na.y * za, zoom: za });
    await sleep(1500);
    const ta = await pA.evaluate((id) => { const el = document.querySelector(`.react-flow__node[data-id="${id}"] .mt-term`); const r = el.getBoundingClientRect(); return { x: Math.min(r.left + r.width / 2, innerWidth - 20), y: Math.min(r.top + r.height / 2, 600) }; }, AG);
    await pA.touchscreen.tap(ta.x, ta.y);
    await pA.waitForSelector(`[data-role=phone-full][data-session="${AG}"] .xterm-screen`, { timeout: 20000 });
    await sleep(3500);
    const fa = await fullInfo(pA);
    await shot(pA, '13-agent-smallest');
    log(`에이전트 가장 작은 글자 ${JSON.stringify({ cols: fa.cols, rows: fa.rows, fontSize: fa.fontSize })}`);
    const panel = call('session.list').find((s) => s.sessionId === AG);
    const agW = await pA.evaluate(() => { const x = document.querySelector('[data-role=phone-full] .xterm'); return x && x.parentElement ? x.parentElement.getBoundingClientRect().width : 0; });
    const agIphone = Math.floor(agW / (0.6 * fa.fontSize));
    judge('에이전트 전체 보기(가장 작은 글자): 흉내 패널 칸 수가 늘고(9.8px 64칸보다), iPhone(0.6em 칸)에서는 110칸 넘게', fa.fontSize === 5.6 && fa.cols > 64 && agIphone >= 110, { cols: fa.cols, iphoneCols: agIphone, width: agW, rows: fa.rows, panel: panel && panel.size });
    await pA.evaluate(() => { try { localStorage.removeItem('mt.phoneTermScale'); } catch {} });
  }

  // ---- WebKit(iPhone 흉내): 열리면 전체 보기 한 장 ----
  try {
    wk = await webkit.launch({ headless: true, timeout: 30000 });
    const wctx = await wk.newContext({ ...devices['iPhone 15'], locale: 'ko-KR' });
    const wp = await wctx.newPage();
    await pair(wp, `http://localhost:${B0.sim}`);
    await wp.screenshot({ path: path.join(OUT, `${STAGE}-14-webkit-board.png`) });
    log('WebKit 보드 화면을 찍음');
    await wctx.close();
  } catch (e) { log(`WebKit을 열지 못함: ${e.message.split('\n')[0].slice(0, 160)} — Chromium(Safari UA) 결과로 갈음한다`); }
} catch (e) {
  log(`오류 ${e.stack}`);
  check('시험이 끝까지 돎', false, e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (wk) await wk.close().catch(() => {});
  if (sim) await sim.close().catch(() => {});
  try { for (const s of sessions()) if (/^p83-/.test(s.name) || path.resolve(s.cwd || '').toLowerCase() === path.resolve(PROJ).toLowerCase()) atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log(`정리 오류 ${e.message}`); }
  fs.writeFileSync(path.join(OUT, `p83-phone-${STAGE}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
