// P84 창 시험: iPhone Safari 페이지가 판을 열자마자 죽는 문제. 흉내 원격(p59-lib.mjs, ts-sim-proxy.mjs)으로
//   휴대폰: 브라우저 문맥(iPhone 393×852, 화면 배율 3, 손가락, Safari UA를 준 Chromium) → ts-sim(47893) → 백엔드(47897).
// 따로 띄운 개발용 판(atrium-dev-p84, 47897, backend/.dev)만 쓴다. PC 창은 띄우지 않고 짝 맺기 코드와 설정은 이 판의 CLI로 한다.
// 단계: 1 세션 12개(셸 10, 에이전트 2) 판을 휴대폰 보드 화면으로 열고, PC가 남긴 화면 자리·전체 맞춤·노드 하나·가장 크게(배율 2)에서
//   붙은 터미널 수, 캔버스 장치 픽셀 합, 글자 아틀라스 픽셀 합, WebGL 수, JS 힙·DOM 수를 잰다.
//   2 가만히 둔 10초 동안 되풀이 고리(창 크기 바뀜, terminal.resize·attach 요청, xterm 다시 그리기)를 보드·전체 보기·키보드에서 잰다.
//   3 페이지를 정상 떠남 없이 죽인다(CDP Page.crash). 다음 부팅이 연결 기록에 boot(crashed) 줄을 남기고, 1분 안에 두 번이면 가벼운 화면으로 열리는지.
//   "보드로 다시 열기" 뒤 또 죽으면 다시 가벼운 화면, 정상으로 다시 읽으면 보드 그대로.
// P84_STAGE=before: 고치기 전(재기만), after(기본): 고친 뒤(판정). 결과는 experiments/p84/(git 밖).
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p84-crash.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const STAGE = process.env.P84_STAGE || 'after';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p84');
const CONVOS = path.join(OUT, 'convos');
const PROJ = process.env.P84_PROJ || 'C:\\Workspace\\mtask-p84-proj';
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A, baseOf } = L;
const B0 = L.board({ session: 'atrium-dev-p84', port: 47897, sim: 47893, sim2: 47894 });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p84',
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
const { chromium } = await import('playwright');

const log = logger(`p84-crash-${STAGE}`);
const BASE = baseOf(B0.sim);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const judge = (name, ok, detail) => (STAGE === 'before' ? check(`[전] ${name}`, true, detail) : check(name, ok, detail));
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${STAGE}-${name}.png`) }); log(`스크린숏 experiments/p84/${STAGE}-${name}.png`); };
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const W = 393, H = 852;
const PHONE = { viewport: { width: W, height: H }, screen: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: SAFARI };
const loadedOpen = (pg, ms = 60000) => pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: ms });
const splashGone = (pg) => pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
const metrics = { stage: STAGE, scenes: {}, loops: {}, crash: {} };
// iOS 홈 화면 앱 흉내(P83과 같다): standalone, 짧은 창 높이(innerHeight·visualViewport), 키보드(window.__kb(px))
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

// 페이지 안의 메모리 값. 캔버스(DOM)와 글자 아틀라스(WebGL 렌더러가 쥔 캔버스)의 장치 픽셀, WebGL 수, 터미널마다 렌더러와 크기
const PROBE = `(() => {
  const mt = window.__mt; const out = { dpr: devicePixelRatio, terms: mt.terms.size, webgl: mt.budget.used, budget: mt.budget.budget, max: mt.maxControllers, canvasPx: 0, canvases: 0, atlasPx: 0, atlasPages: 0, list: [] };
  for (const c of document.querySelectorAll('canvas')) { out.canvases++; out.canvasPx += c.width * c.height; }
  const seen = new Set();
  for (const [id, tm] of mt.terms) {
    let r = tm._core && tm._core._renderService && tm._core._renderService._renderer; r = r && (r.value || r);
    const a = r && r._charAtlas; const pages = (a && a.pages) || [];
    for (const p of pages) { const c = p.canvas; if (c && !seen.has(c)) { seen.add(c); out.atlasPages++; out.atlasPx += c.width * c.height; } }
    const host = tm.element && tm.element.closest('[data-sharp]');
    const info = (mt.perf.perf && mt.perf.perf.terminals.get(id)) || {};
    out.list.push({ id: id.slice(0, 8), renderer: info.renderer || (r && r.constructor && r.constructor.name) || null, cols: tm.cols, rows: tm.rows, sharp: host ? host.dataset.sharp : null, canv: [...(tm.element ? tm.element.querySelectorAll('canvas') : [])].map((c) => c.width + 'x' + c.height).join(',') });
  }
  const vp = mt.getState().vpNow; out.zoom = vp ? +vp.zoom.toFixed(3) : null;
  out.heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  out.dom = document.getElementsByTagName('*').length;
  out.view = document.querySelector('[data-role=phone]') ? 'list' : document.querySelector('[data-role=phone-full]') ? 'full' : 'board';
  out.light = !!document.querySelector('[data-role=light-banner]');
  // 대략의 그림 메모리(MB): 캔버스는 그리기 버퍼 + 화면 버퍼(×2), 아틀라스는 캔버스 + GPU 텍스처(×2), 4바이트
  out.estMB = Math.round(((out.canvasPx * 2 + out.atlasPx * 2) * 4) / 1048576);
  return out;
})()`;
async function measure(pg, cdp, name) {
  await sleep(4000); // 붙고 선명하게 그리기가 끝나도록
  const p = await pg.evaluate(PROBE);
  const m = await cdp.send('Performance.getMetrics').then((r) => Object.fromEntries(r.metrics.map((x) => [x.name, x.value]))).catch(() => ({}));
  p.jsHeapMB = m.JSHeapUsedSize ? Math.round(m.JSHeapUsedSize / 1048576) : null; p.nodes = m.Nodes ?? null;
  metrics.scenes[name] = p;
  log(`[잼 ${name}] 터미널 ${p.terms}, WebGL ${p.webgl}/${p.budget}(상한 ${p.max}), 캔버스 ${p.canvases}개 ${(p.canvasPx / 1e6).toFixed(2)}M px, 아틀라스 ${p.atlasPages}장 ${(p.atlasPx / 1e6).toFixed(2)}M px, 추정 ${p.estMB}MB, 힙 ${p.jsHeapMB}MB, DOM ${p.dom}, 배율 ${p.zoom} ${JSON.stringify(p.list).slice(0, 900)}`);
  return p;
}
// 되풀이 고리 재기: 창·보이는 높이 resize, terminal.resize·attach·focus 요청, xterm 다시 그리기(onRender)
const LOOP_START = `(() => {
  const w = window.__p84loop = { resize: 0, vv: 0, calls: {}, render: 0, renders: {} };
  window.addEventListener('resize', () => w.resize++); if (window.visualViewport) window.visualViewport.addEventListener('resize', () => w.vv++);
  const api = window.__mt.api;
  if (!api.__p84) { const c = api.call.bind(api); api.call = (m, p) => { const x = window.__p84loop; if (x && /^terminal\\./.test(m)) x.calls[m] = (x.calls[m] || 0) + 1; return c(m, p); }; api.__p84 = 1; }
  for (const [id, tm] of window.__mt.terms) tm.onRender(() => { w.render++; w.renders[id.slice(0, 8)] = (w.renders[id.slice(0, 8)] || 0) + 1; });
  return true;
})()`;
async function loop(pg, name, ms = 10000) {
  await pg.evaluate(LOOP_START);
  await sleep(ms);
  const r = await pg.evaluate(() => { const w = window.__p84loop; window.__p84loop = null; return w; });
  metrics.loops[name] = r;
  log(`[고리 ${name}] ${ms / 1000}초: resize ${r.resize}, visualViewport ${r.vv}, 요청 ${JSON.stringify(r.calls)}, 다시 그리기 ${r.render} ${JSON.stringify(r.renders)}`);
  return r;
}

const newCode = () => call('device.code').code;
async function pair(pg, base) {
  await pg.goto(`${base}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await pg.fill('[data-field=pair-code]', newCode());
  await pg.tap('[data-action=pair-submit]');
  await loadedOpen(pg); await splashGone(pg);
}
const bootLog = () => call('remote.log', { limit: 60 }).entries;

let browser, sim;
try {
  // ---- 0. 판: 백엔드(이 판의 herdr 서버도 띄운다)와 시험 세션 ----
  if (process.env.P84_RESTART === '1') try { log(atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log(`백엔드 멈추기 ${e.message.slice(0, 100)}`); } // 고친 백엔드를 읽게
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const spawn = (...a) => JSON.parse(atrium('--json', 'spawn', PROJ, ...a));
  const want = [...Array.from({ length: 10 }, (_, i) => `p84-sh${String(i + 1).padStart(2, '0')}`), 'p84-ag1', 'p84-ag2'];
  const have = new Set(sessions().filter((s) => /^p84-/.test(s.name) && s.state !== 'exited').map((s) => s.name));
  for (const n of want) if (!have.has(n)) { if (/sh/.test(n)) spawn('--kind', 'shell', '--name', n); else spawn('--model', 'haiku', '--name', n); }
  await until(() => want.every((n) => { const s = byName(n); return s && s.state !== 'starting'; }), 180000, 2000).catch(() => null);
  const trust = sessions().find((s) => /^p84-ag/.test(s.name) && s.state === 'trust_wait');
  if (trust) { fs.writeFileSync(path.join(DEV, 'p84-need-trust.txt'), `${trust.name} in ${PROJ} asks the folder trust question\n`); throw new Error('trust question (backend/.dev/p84-need-trust.txt)'); }
  // 셸 화면을 글로 채운다(터미널이 빈 화면이 아니게)
  for (const n of want.filter((x) => /sh/.test(x))) try { atrium('input', n, "1..120 | % { 'line ' + $_ + ' ' + ('abcdefghij' * 7) }\\r"); } catch (e) { log(`입력 실패 ${n} ${e.message.slice(0, 100)}`); }
  log(`세션 ${sessions().filter((s) => /^p84-/.test(s.name)).map((s) => `${s.name}:${s.state}`).join(' ')}`);
  // PC가 남긴 화면 자리(처음 붙는 휴대폰이 그대로 연다): 배율 1, 왼쪽 위
  call('board.setViewport', { x: 40, y: 80, zoom: 1 });

  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const found = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  browser = await chromium.launch({ headless: true, ...(found ? { executablePath: found } : { channel: 'chromium' }), args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`, '--enable-precise-memory-info', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext(PHONE);
  const open = async (label) => {
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[${label} pageerror] ${e.message}`));
    pg.on('console', (m) => { if (m.type() === 'error') log(`[${label} console.error] ${m.text().slice(0, 200)}`); });
    const cdp = await ctx.newCDPSession(pg);
    await cdp.send('Performance.enable').catch(() => {});
    return { pg, cdp };
  };
  let { pg, cdp } = await open('phone');
  await pair(pg, BASE);
  await pg.evaluate(() => { try { localStorage.removeItem('mt.phoneTermScale'); localStorage.removeItem('mt.phoneLayout'); } catch {} });
  await sleep(1500);

  // ---- 1. 보드 화면의 메모리 ----
  const s1 = await measure(pg, cdp, 'pc-viewport');
  await shot(pg, '01-board-pc-viewport');
  await pg.evaluate(() => window.__mt.getState().fitAll && window.__mt.getState().fitAll());
  const s2 = await measure(pg, cdp, 'fit-all');
  await shot(pg, '02-board-fit');
  const target = byName('p84-sh01').sessionId;
  await pg.evaluate((id) => window.__mt.getState().navigateTo(id, { viewOnly: true }), target);
  const s3 = await measure(pg, cdp, 'one-node');
  await shot(pg, '03-board-one-node');
  // 두 손가락으로 가장 크게(배율 2): 노드 왼쪽 위를 화면 왼쪽 위에
  const nr = await pg.evaluate((id) => { const r = window.__mt.getState().nodes.get(id); return r; }, target);
  await pg.evaluate((r) => window.__mt.getState().setViewport({ x: -r.x * 2 + 10, y: -r.y * 2 + 60, zoom: 2 }), nr);
  const s4 = await measure(pg, cdp, 'zoom-2');
  await shot(pg, '04-board-zoom2');
  await pg.evaluate((r) => window.__mt.getState().setViewport({ x: -r.x * 1 + 10, y: -r.y * 1 + 60, zoom: 1 }), nr);
  const s5 = await measure(pg, cdp, 'zoom-1');
  judge('보드 화면: 휴대폰 웹은 WebGL을 쓰지 않는다(모든 자리에서 WebGL 0)', [s1, s2, s3, s4, s5].every((s) => s.webgl === 0), [s1, s2, s3, s4, s5].map((s) => s.webgl));
  judge('보드 화면: 붙는 터미널이 휴대폰 상한(3) 안', [s1, s2, s3, s4, s5].every((s) => s.terms <= 3), [s1, s2, s3, s4, s5].map((s) => s.terms));
  judge('보드 화면: 터미널 캔버스·아틀라스 장치 픽셀이 1M px 아래(배율 2에서도)', [s1, s2, s3, s4, s5].every((s) => s.canvasPx + s.atlasPx < 1e6), [s1, s2, s3, s4, s5].map((s) => Math.round((s.canvasPx + s.atlasPx) / 1e3) + 'K'));

  // ---- 2. 되풀이 고리: 보드, 전체 보기, 키보드 ----
  await pg.evaluate(() => window.__mt.getState().fitAll && window.__mt.getState().fitAll());
  await sleep(1500);
  const l1 = await loop(pg, 'board-idle');
  await pg.evaluate((id) => window.__mt.getState().navigateTo(id, { viewOnly: true }), target);
  await sleep(1500);
  const box = await pg.evaluate((id) => { const el = document.querySelector(`.react-flow__node[data-id="${id}"]`); const r = el && el.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; }, target);
  if (box) await pg.touchscreen.tap(box.x, Math.min(H - 120, Math.max(120, box.y)));
  const fullOk = await pg.waitForSelector('[data-role=phone-full]', { timeout: 8000 }).then(() => true, () => false);
  await sleep(2500);
  const sf = await measure(pg, cdp, 'full-view');
  await shot(pg, '05-full');
  const l2 = fullOk ? await loop(pg, 'full-idle') : null;
  // 키보드 흉내: visualViewport가 없거나 바꿀 수 없으면 창 높이를 바꾼다(크기 바꿈 → 프레임 요청이 한 번으로 그치는지)
  let l3 = null;
  if (fullOk) {
    await pg.evaluate(LOOP_START);
    await pg.setViewportSize({ width: W, height: H - 336 }); await sleep(3000);
    await pg.setViewportSize({ width: W, height: H }); await sleep(5000);
    l3 = await pg.evaluate(() => { const w = window.__p84loop; window.__p84loop = null; return w; });
    metrics.loops['full-keyboard'] = l3;
    log(`[고리 full-keyboard] 키보드 열고 닫기 뒤 8초: resize ${l3.resize}, vv ${l3.vv}, 요청 ${JSON.stringify(l3.calls)}, 다시 그리기 ${l3.render}`);
  }
  const quiet = (l) => !l || ((l.calls['terminal.resize'] || 0) <= 2 && (l.calls['terminal.attach'] || 0) === 0 && l.resize <= 2);
  check('되풀이 고리: 가만히 둔 보드·전체 보기에서 크기 바꿈·다시 붙기 요청이 이어지지 않는다', quiet(l1) && quiet(l2), { board: l1 && l1.calls, full: l2 && l2.calls, resize: [l1 && l1.resize, l2 && l2.resize] });
  check('되풀이 고리: 키보드를 열고 닫은 뒤 terminal.resize가 4번 이하로 그친다', !l3 || ((l3.calls['terminal.resize'] || 0) <= 4 && (l3.calls['terminal.attach'] || 0) === 0), l3 && l3.calls);
  await pg.evaluate(() => history.back()).catch(() => {});
  await sleep(1000);

  // ---- 2b. iOS 홈 화면 앱 흉내(P83 높이 보정 useScreenFix가 켜진다): 보드·전체 보기를 가만히 두고, 키보드(visualViewport만)를 열고 닫는다 ----
  {
    const sctx = await browser.newContext(PHONE);
    await sctx.addInitScript(FAKE_IOS_APP, { short: H - 59 });
    const sp = await sctx.newPage();
    sp.on('pageerror', (e) => log(`[app pageerror] ${e.message}`));
    await pair(sp, BASE);
    await sleep(2500);
    const tall = await sp.evaluate(() => document.documentElement.classList.contains('mt-tall'));
    const a1 = await loop(sp, 'app-board-idle');
    await sp.evaluate((id) => window.__mt.getState().navigateTo(id, { viewOnly: true }), target); await sleep(1500);
    const b2 = await sp.evaluate((id) => { const el = document.querySelector(`.react-flow__node[data-id="${id}"]`); const r = el && el.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; }, target);
    if (b2) await sp.touchscreen.tap(b2.x, Math.min(H - 160, Math.max(120, b2.y)));
    const ok2 = await sp.waitForSelector('[data-role=phone-full]', { timeout: 8000 }).then(() => true, () => false);
    await sleep(2500);
    const a2 = ok2 ? await loop(sp, 'app-full-idle') : null;
    let a3 = null;
    if (ok2) {
      await sp.evaluate(LOOP_START);
      await sp.evaluate(() => window.__kb(336)); await sleep(3000);
      await sp.evaluate(() => window.__kb(0)); await sleep(5000);
      a3 = await sp.evaluate(() => { const w = window.__p84loop; window.__p84loop = null; return w; });
      metrics.loops['app-full-keyboard'] = a3;
      log(`[고리 app-full-keyboard] 키보드(visualViewport) 열고 닫기 뒤 8초: resize ${a3.resize}, vv ${a3.vv}, 요청 ${JSON.stringify(a3.calls)}, 다시 그리기 ${a3.render}`);
    }
    check('되풀이 고리(홈 화면 앱 흉내, 높이 보정 켜짐): 가만히 둔 보드·전체 보기, 키보드를 열고 닫은 뒤 요청이 이어지지 않는다', tall && quiet(a1) && quiet(a2) && (!a3 || ((a3.calls['terminal.resize'] || 0) <= 2 && (a3.calls['terminal.attach'] || 0) === 0)), { tall, board: a1 && a1.calls, full: a2 && a2.calls, kb: a3 && a3.calls, resize: [a1 && a1.resize, a2 && a2.resize, a3 && a3.resize] });
    await sctx.close();
  }

  // ---- 3. 죽음 기록과 가벼운 화면 ----
  const t0 = Date.now();
  const crash = async (label) => {
    const before = await pg.evaluate(() => { try { return localStorage.getItem('mt.crumbs'); } catch { return null; } }).catch(() => null);
    log(`[${label}] 죽이기 전 기록 ${String(before).slice(0, 300)}`);
    cdp.send('Page.crash').catch(() => {});
    await new Promise((r) => { pg.once('crash', r); setTimeout(r, 5000); });
    await pg.close().catch(() => {});
    ({ pg, cdp } = await open(label));
    await pg.goto(`${BASE}/`);
    await loadedOpen(pg); await splashGone(pg);
    await sleep(2500);
  };
  await sleep(2000); // 살아 있다는 기록이 한 번은 적히게
  await crash('after-crash-1');
  const c1 = await pg.evaluate(PROBE);
  await shot(pg, '06-after-crash-1');
  judge('죽음 1번: 다음 부팅은 보드 화면 그대로(한 번은 가벼운 화면이 아니다)', c1.view === 'board' && !c1.light, { view: c1.view, light: c1.light });
  await sleep(2000);
  await crash('after-crash-2');
  const c2 = await pg.evaluate(PROBE);
  await shot(pg, '07-after-crash-2-light');
  const banner = await pg.evaluate(() => { const b = document.querySelector('[data-role=light-banner]'); return b ? { text: b.innerText, btn: !!b.querySelector('[data-action=light-board]') } : null; });
  judge('죽음 2번(1분 안): 가벼운 화면(목록, WebGL 없음, 터미널 없음)과 안내·"보드로 다시 열기"', c2.light && c2.view === 'list' && c2.webgl === 0 && c2.terms === 0 && banner && banner.btn, { view: c2.view, light: c2.light, webgl: c2.webgl, terms: c2.terms, banner });
  await sleep(1500);
  const logs = bootLog().filter((e) => e.at >= t0 - 1000);
  const boots = logs.filter((e) => e.event === 'boot');
  log(`연결 기록 ${JSON.stringify(logs.map((e) => ({ ev: e.event, crashed: e.crashed, light: e.light, crash: e.crash, ws: e.ws && e.ws.code })))}`);
  const allowed = new Set(['at', 'event', 'deviceId', 'deviceName', 'node', 'login', 'addr', 'browser', 'remote', 'crashed', 'light', 'crash', 'n']);
  const crashKeys = new Set(['ago', 'up', 'view', 'terms', 'px', 'atlas', 'gl', 'dpr', 'inB', 'boots', 'hidden', 'light', 'retry']);
  judge('연결 기록: 죽은 뒤 부팅마다 boot 줄(crashed, 직전 화면·터미널 수·픽셀·WebGL·DPR·받은 바이트), 두 번째는 light', boots.length >= 2 && boots.every((b) => b.crashed === true && b.crash && Number.isFinite(b.crash.dpr) && b.crash.view) && boots.some((b) => b.light === true), boots);
  judge('연결 기록: boot 줄에 정한 필드만(글·화면 내용 없음)', boots.length > 0 && boots.every((b) => Object.keys(b).every((k) => allowed.has(k)) && Object.keys(b.crash || {}).every((k) => crashKeys.has(k))), boots.map((b) => [Object.keys(b), Object.keys(b.crash || {})]));
  const cli = (() => { try { return atrium('remote', 'log', '--limit', '12'); } catch (e) { return e.message; } })();
  log(`atrium remote log\n${cli}`);
  judge('atrium remote log에 죽음 줄이 보인다', /닫힌 뒤 다시 열림/.test(cli) && /닫히기 전=/.test(cli), cli.split('\n').slice(0, 6).join(' | '));

  // 보드로 다시 열기 → 또 죽으면 다시 가벼운 화면
  if (c2.light) {
    await pg.tap('[data-action=light-board]');
    await loadedOpen(pg).catch(() => {}); await splashGone(pg);
    await sleep(2500);
    const r1 = await pg.evaluate(PROBE);
    await shot(pg, '08-retry-board');
    judge('"보드로 다시 열기": 보드 화면(가벼운 화면 아님)', r1.view === 'board' && !r1.light, { view: r1.view, light: r1.light });
    await crash('after-crash-3');
    const c3 = await pg.evaluate(PROBE);
    await shot(pg, '09-after-retry-crash-light');
    judge('다시 연 보드가 또 죽으면 다음 부팅은 다시 가벼운 화면', c3.light && c3.view === 'list', { view: c3.view, light: c3.light });
    // 보드로 다시 열고 정상으로 다시 읽기(pagehide) → 보드 그대로, 죽음 줄 없음
    if (c3.light) { await pg.tap('[data-action=light-board]'); await loadedOpen(pg).catch(() => {}); await splashGone(pg); await sleep(2500); }
    const t1 = Date.now();
    await pg.reload(); await loadedOpen(pg); await splashGone(pg); await sleep(2500);
    const n1 = await pg.evaluate(PROBE);
    const after = bootLog().filter((e) => e.at >= t1 && e.event === 'boot');
    judge('정상으로 다시 읽으면(pagehide) 보드 그대로, 죽음 줄 없음', n1.view === 'board' && !n1.light && after.length === 0, { view: n1.view, light: n1.light, boots: after });
  }
  metrics.crash = { c1: { view: c1.view, light: c1.light }, c2: { view: c2.view, light: c2.light }, boots };
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (sim) await sim.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, `p84-crash-${STAGE}.json`), JSON.stringify({ results, metrics }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
