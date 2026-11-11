// P76 창 시험: 휴대폰(터치)에서 보드 화면(무한 캔버스)을 쓴다. Playwright 휴대폰 흉내(390×844, isMobile, hasTouch)와 CDP 터치 이벤트
//   휴대폰: 브라우저 문맥 → ts-sim(47898, X-Forwarded-For 100.64.0.2 = laptop-a 자리) → 백엔드(47897). 판은 가짜 tailscale(p49-fake-tailscale.mjs)을 읽는다.
// 따로 띄운 개발용 판(atrium-dev-p76, 47897, backend/.dev)만 쓴다. PC 창은 띄우지 않고 짝 맺기 코드와 설정은 이 판의 CLI로 한다.
// P76_STAGE=before: 고치기 전 코드에서 보드 화면의 터치(노드 위 끌기, 터미널 위 끌기, 누르기, 두 손가락)를 재고 그림을 남긴다(튕김 재현).
// P76_STAGE=after(기본): 기본 화면이 캔버스, 한 손가락 끌기는 판만, 두 손가락 확대·축소(페이지 확대·스크롤 0), 길게 눌러 옮기기(판 기록이 바뀜),
//   탭하면 전체 보기(아래 키 줄과 입력 줄), 한글 조합 입력, 키보드가 올라오면 화면이 올라감, 키 줄, 전체 보기 나오기(바깥 탭, 뒤로, 오므리기),
//   가로 보드 화면의 탭은 확대, 세션 목록 단추, 노트북 크기 마우스 보드의 끌기.
// 결과는 experiments/p76/(git 밖). 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p76-touch.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const STAGE = process.env.P76_STAGE || 'after';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p76');
const CONVOS = path.join(OUT, 'convos');
const PROJ = process.env.P76_PROJ || 'C:\\Workspace\\mtask-p76-proj';
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A, baseOf } = L;
const B0 = L.board({ session: 'atrium-dev-p76', port: 47897, sim: 47898, sim2: 47899 });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p76',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim}`,
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
const { chromium } = await import('playwright');

const log = logger(`p76-touch-${STAGE}`);
const BASE = baseOf(B0.sim);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`); };
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${STAGE}-${name}.png`) }); log(`스크린숏 experiments/p76/${STAGE}-${name}.png`); };
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const screenText = (n) => atrium('screen', n, '--text');
const PHONE = { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };

// 가상 키보드 흉내: visualViewport를 바꿀 수 있는 가짜로 바꾼다(높이가 줄면 키보드가 올라온 것). window.__kb(px)로 키보드 높이를 준다
const FAKE_VV = () => {
  const real = window.visualViewport;
  const ev = new EventTarget();
  let kb = 0;
  const vv = Object.assign(ev, {});
  Object.defineProperties(vv, {
    height: { get: () => window.innerHeight - kb }, width: { get: () => window.innerWidth },
    offsetTop: { get: () => 0 }, offsetLeft: { get: () => 0 }, pageTop: { get: () => window.scrollY }, pageLeft: { get: () => window.scrollX },
    scale: { get: () => (real ? real.scale : 1) },
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  window.__realVV = real;
  window.__kb = (px) => { kb = px; ev.dispatchEvent(new Event('resize')); };
};

async function phone(browser, label, { fakeKb = false } = {}) {
  const ctx = await browser.newContext(PHONE);
  if (fakeKb) await ctx.addInitScript(FAKE_VV);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`[${label} pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[${label} console.error] ${m.text().slice(0, 200)}`); });
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp };
}
const loadedOpen = (pg, ms = 60000) => pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: ms });
const splashGone = (pg) => pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
const newCode = () => call('device.code').code;

// ---- CDP 터치 ----
const T = (cdp) => {
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id ?? i, radiusX: 4, radiusY: 4, force: 1 })) });
  return {
    async drag(a, b, { steps = 12, hold = 0, stepMs = 16 } = {}) {
      await send('touchStart', [a]);
      if (hold) await sleep(hold);
      for (let i = 1; i <= steps; i++) { await send('touchMove', [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }]); await sleep(stepMs); }
      await send('touchEnd', []);
    },
    async tap(p, { ms = 60 } = {}) { await send('touchStart', [p]); await sleep(ms); await send('touchEnd', []); },
    // 두 손가락: c 가운데, 거리 d0 → d1(가로로 벌림)
    async pinch(c, d0, d1, { steps = 12 } = {}) {
      const pts = (d) => [{ x: c.x - d / 2, y: c.y, id: 0 }, { x: c.x + d / 2, y: c.y, id: 1 }];
      await send('touchStart', pts(d0));
      for (let i = 1; i <= steps; i++) { await send('touchMove', pts(d0 + ((d1 - d0) * i) / steps)); await sleep(16); }
      await send('touchEnd', []);
    },
  };
};

// 보드 화면 상태: 뷰포트, 노드 자리(판 기록과 화면), 페이지 확대·스크롤, 초점
const boardState = (pg, id) => pg.evaluate((id) => {
  const st = window.__mt.getState();
  const vp = st.viewNow || null;
  const rfvp = (() => { const el = document.querySelector('.react-flow__viewport'); const m = el && /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(el.style.transform); return m ? { x: +m[1], y: +m[2], zoom: +m[3] } : null; })();
  const n = st.nodes.get(id);
  const el = document.querySelector(`.react-flow__node[data-id="${id}"]`);
  const r = el && el.getBoundingClientRect();
  const vv = window.__realVV || window.visualViewport;
  const a = document.activeElement;
  return { vp: rfvp, store: n && { x: n.x, y: n.y, w: n.w, h: n.h }, screen: r && { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, pageScale: vv ? vv.scale : 1, scrollX: window.scrollX, scrollY: window.scrollY, docScroll: document.scrollingElement ? [document.scrollingElement.scrollLeft, document.scrollingElement.scrollTop] : null, active: a ? `${a.tagName}.${a.className}`.slice(0, 60) : null, termFocus: !!(a && a.closest && a.closest('.xterm')), face: el && el.querySelector('.mt-node') && el.querySelector('.mt-node').dataset.face, full: !!document.querySelector('[data-role=phone-full]'), phoneList: !!document.querySelector('[data-role=phone-list]') };
}, id);
const setVp = (pg, vp) => pg.evaluate((vp) => window.__mt.getState().setViewport(vp), vp);
const nodeBox = (pg, id, sel = '.mt-node-head') => pg.evaluate(({ id, sel }) => { const el = document.querySelector(`.react-flow__node[data-id="${id}"] ${sel}`); if (!el) return null; const r = el.getBoundingClientRect(); const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v)); const x0 = Math.max(r.left, 0), x1 = Math.min(r.right, innerWidth), y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, innerHeight); if (x1 - x0 < 20 || y1 - y0 < 10) return null; return { x: cl(r.left + r.width / 2, x0 + 10, Math.min(x1 - 10, x0 + 160)), y: cl(r.top + r.height / 2, y0 + 5, y1 - 5), w: r.width, h: r.height }; }, { id, sel });
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
const moved = (s0, s1) => s0.store && s1.store && (Math.abs(s1.store.x - s0.store.x) > 1 || Math.abs(s1.store.y - s0.store.y) > 1);
const recOf = (id) => call('board.get').nodes.find((x) => x.session_id === id) || null;
const panDelta = (s0, s1) => ({ dx: Math.round(s1.vp.x - s0.vp.x), dy: Math.round(s1.vp.y - s0.vp.y), dz: +(s1.vp.zoom - s0.vp.zoom).toFixed(3) });

let browser, sim;
try {
  // ---- 0. 판: 백엔드(이 판의 herdr 서버도 띄운다)와 시험 세션 ----
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  for (const s of sessions()) if (/^p76-/.test(s.name)) atrium('kill', s.sessionId, '--yes', '--delete');
  sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const spawn = (...a) => JSON.parse(atrium('--json', 'spawn', PROJ, ...a));
  const shellR = spawn('--kind', 'shell', '--name', 'p76-shell');
  const shell2 = spawn('--kind', 'shell', '--name', 'p76-shell2');
  const agentR = STAGE === 'after' ? spawn('--model', 'haiku', '--name', 'p76-agent') : null;
  check('시험 세션을 띄움', shellR.sessionId && shell2.sessionId && (!agentR || agentR.sessionId));
  await until(() => { const s = byName('p76-shell'); return s && s.state !== 'starting'; }, 60000, 1000);
  if (agentR) await until(() => { const s = byName('p76-agent'); return s && s.state === 'ready'; }, 120000, 1000);
  const ID = shellR.sessionId;

  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const found = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  const exe = process.env.P76_CHROME || found || undefined;
  browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : { channel: 'chromium' }), args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const A = await phone(browser, 'phone', { fakeKb: STAGE === 'after' });
  const pA = A.page, touch = T(A.cdp);

  // ---- 1. 짝 맺기 → 첫 화면 ----
  await pA.goto(`${BASE}/`);
  await pA.waitForSelector('[data-role=pair]', { timeout: 20000 });
  await pA.fill('[data-field=pair-code]', newCode());
  await pA.tap('[data-action=pair-submit]');
  await loadedOpen(pA); await splashGone(pA);
  await sleep(1500);
  const first = await pA.evaluate(() => ({ list: !!document.querySelector('[data-role=phone-list]'), board: !!document.querySelector('.react-flow'), listBtn: !!document.querySelector('[data-action=phone-list-open]') }));
  log(`첫 화면 ${JSON.stringify(first)}`);
  if (STAGE === 'before') {
    // 고치기 전: 목록 머리줄의 보드 단추로 보드 화면에 간다
    await pA.tap('[data-action=phone-board]');
    await pA.waitForSelector('.react-flow', { timeout: 10000 });
  } else {
    check('휴대폰의 기본 화면이 캔버스(보드 화면)이고 세션 목록 단추가 있다', !first.list && first.board && first.listBtn, first);
  }
  await pA.waitForSelector(`.react-flow__node[data-id="${ID}"]`, { timeout: 20000 });
  await shot(pA, '01-board');

  // 노드를 가까이 얼굴(터미널)로: 노드 너비가 화면 360px 넘게
  const n0 = (await boardState(pA, ID)).store;
  const z = Math.max(0.55, 380 / n0.w);
  const vpAt = (dx = 20, dy = 140) => ({ x: dx - n0.x * z, y: dy - n0.y * z, zoom: z });
  await setVp(pA, vpAt()); await sleep(1500);
  await shot(pA, '02-node-close');

  // ---- 2. 노드 머리줄에서 한 손가락 끌기 ----
  let s0 = await boardState(pA, ID);
  const head = await nodeBox(pA, ID);
  log(`노드 자리 ${JSON.stringify(call('board.get').nodes.map((n) => ({ id: n.session_id === ID ? 'shell' : n.session_id === shell2.sessionId ? 'shell2' : 'agent', x: n.x, y: n.y, w: n.w, h: n.h })))}`);
  log(`머리줄 점 ${JSON.stringify(head)} 맨 위 요소 ${await pA.evaluate(({ x, y }) => { const out = []; for (let e = document.elementFromPoint(x, y); e && out.length < 8; e = e.parentElement) out.push(`${e.tagName}.${String(e.className).slice(0, 40)}`); return out.join(' < '); }, head)}`);
  await touch.drag({ x: head.x, y: head.y }, { x: head.x - 80, y: head.y + 160 });
  await sleep(900);
  let s1 = await boardState(pA, ID);
  log(`머리줄 끌기 전 ${JSON.stringify(s0)} 뒤 ${JSON.stringify(s1)}`);
  const headDrag = { nodeMoved: moved(s0, s1), storeDelta: s0.store && s1.store ? { dx: s1.store.x - s0.store.x, dy: s1.store.y - s0.store.y } : null, pan: panDelta(s0, s1), pageScale: s1.pageScale, scroll: [s1.scrollX, s1.scrollY] };
  await shot(pA, '03-head-drag');
  if (STAGE === 'before') check('[전] 노드 머리줄 한 손가락 끌기', true, headDrag);
  else check('노드 머리줄 위 한 손가락 끌기는 판만 옮긴다(노드 자리 그대로, 판이 손가락만큼)', !headDrag.nodeMoved && near(headDrag.pan.dx, -80, 6) && near(headDrag.pan.dy, 160, 6) && s1.pageScale === 1 && !s1.scrollY, headDrag);
  // 판 기록도 그대로
  if (STAGE === 'after') { const rec = recOf(ID); check('판 기록의 노드 자리도 그대로', rec && near(rec.x, s0.store.x, 1) && near(rec.y, s0.store.y, 1), rec && { x: rec.x, y: rec.y, before: s0.store }); }

  // ---- 3. 터미널 위에서 한 손가락 끌기 ----
  await setVp(pA, vpAt()); await sleep(1200);
  s0 = await boardState(pA, ID);
  const tb = await nodeBox(pA, ID, '.mt-term');
  await touch.drag({ x: tb.x, y: tb.y }, { x: tb.x + 60, y: tb.y - 120 });
  await sleep(900);
  s1 = await boardState(pA, ID);
  const termDrag = { nodeMoved: moved(s0, s1), pan: panDelta(s0, s1), pageScale: s1.pageScale, scroll: [s1.scrollX, s1.scrollY], termFocus: s1.termFocus, face: s1.face };
  await shot(pA, '04-term-drag');
  if (STAGE === 'before') check('[전] 터미널 위 한 손가락 끌기', true, termDrag);
  else check('터미널 위 한 손가락 끌기도 판만 옮긴다(터미널이 터치를 먹지 않는다)', !termDrag.nodeMoved && near(termDrag.pan.dx, 60, 6) && near(termDrag.pan.dy, -120, 6) && !termDrag.termFocus, termDrag);

  // ---- 4. 두 손가락 벌리기·오므리기 ----
  await setVp(pA, vpAt()); await sleep(1000);
  s0 = await boardState(pA, ID);
  await touch.pinch({ x: 195, y: 420 }, 80, 240);
  await sleep(900);
  s1 = await boardState(pA, ID);
  const pinchOut = { pan: panDelta(s0, s1), pageScale: s1.pageScale, scroll: [s1.scrollX, s1.scrollY], nodeMoved: moved(s0, s1) };
  await shot(pA, '05-pinch-spread');
  await touch.pinch({ x: 195, y: 420 }, 240, 80);
  await sleep(900);
  const s2 = await boardState(pA, ID);
  const pinchIn = { zoom: s2.vp.zoom, pageScale: s2.pageScale, scroll: [s2.scrollX, s2.scrollY] };
  if (STAGE === 'before') check('[전] 두 손가락 벌리기·오므리기', true, { pinchOut, pinchIn });
  else check('두 손가락으로 판을 확대·축소하고 페이지는 확대·스크롤되지 않는다', s1.vp.zoom > s0.vp.zoom * 1.5 && s2.vp.zoom < s1.vp.zoom * 0.6 && s1.pageScale === 1 && s2.pageScale === 1 && !s1.scrollY && !s2.scrollY && !pinchOut.nodeMoved, { z0: s0.vp.zoom, z1: s1.vp.zoom, z2: s2.vp.zoom, pinchOut, pinchIn });

  // ---- 5. 노드를 짧게 누르기 ----
  await setVp(pA, vpAt()); await sleep(1200);
  s0 = await boardState(pA, ID);
  const body = await nodeBox(pA, ID, '.mt-term');
  await touch.tap({ x: body.x, y: body.y });
  await sleep(1200);
  s1 = await boardState(pA, ID);
  const tapRes = { pan: panDelta(s0, s1), termFocus: s1.termFocus, active: s1.active, full: s1.full, list: s1.phoneList };
  await shot(pA, '06-tap');
  if (STAGE === 'before') {
    check('[전] 노드 짧게 누르기', true, tapRes);
    // 눌러서 확대 뒤 다시 끌기(확대된 화면에서 터미널 위)
    s0 = s1;
    const tb2 = await nodeBox(pA, ID, '.mt-term');
    await touch.drag({ x: tb2.x, y: tb2.y }, { x: tb2.x - 50, y: tb2.y + 100 });
    await sleep(900);
    s1 = await boardState(pA, ID);
    check('[전] 확대된 뒤 터미널 위 끌기', true, { nodeMoved: moved(s0, s1), pan: panDelta(s0, s1), termFocus: s1.termFocus });
    await shot(pA, '07-after-tap-drag');
  }

  if (STAGE === 'after') {
    // ---- 6. 전체 보기 ----
    check('탭하면 전체 보기가 열린다(휴대폰 세션 목록·화면이 아님, 판은 그대로)', tapRes.full && !tapRes.list && tapRes.pan.dx === 0 && tapRes.pan.dy === 0 && tapRes.pan.dz === 0, tapRes);
    await pA.waitForSelector('[data-role=phone-full] .xterm-screen', { timeout: 20000 });
    await sleep(1500);
    const fv = await pA.evaluate(() => {
      const f = document.querySelector('[data-role=phone-full]').getBoundingClientRect();
      const t = document.querySelector('[data-role=phone-full-term]').getBoundingClientRect();
      const k = document.querySelector('[data-role=phone-keys]').getBoundingClientRect();
      const inp = document.querySelector('[data-role=phone-line]').getBoundingClientRect();
      const keys = [...document.querySelectorAll('[data-role=phone-keys] [data-key]')].map((b) => b.dataset.key);
      // 세션 위에 떠 있는 다른 단추가 없는가: 터미널 칸 안의 점마다 맨 위 요소가 전체 보기 안이고 단추가 아니다
      const pts = []; for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) pts.push([t.left + (t.width * i) / 6, t.top + (t.height * j) / 6]);
      const over = pts.map(([x, y]) => document.elementFromPoint(x, y)).filter((e) => !e || !e.closest('[data-role=phone-full-term]') || e.closest('button'));
      return { full: [f.top, f.bottom, f.width], term: [Math.round(t.top), Math.round(t.bottom), Math.round(t.width)], keysTop: Math.round(k.top), keysBottom: Math.round(k.bottom), lineTop: Math.round(inp.top), vh: innerHeight, vw: innerWidth, keys, over: over.length };
    });
    check('전체 보기: 세션이 화면 폭 전체·키 줄 위 높이를 채우고, 아래에 입력 줄과 키 줄, 세션 위에 떠 있는 단추 없음', fv.term[2] >= fv.vw - 2 && fv.term[1] <= fv.lineTop + 1 && fv.term[1] - fv.term[0] > fv.vh * 0.6 && fv.keysBottom <= fv.vh + 1 && fv.over === 0 && ['esc', 'ctrlc', 'up', 'down', 'left', 'right', 'tab', 'shifttab', 'enter', 'slash'].every((k) => fv.keys.includes(k)), fv);
    const owner = await until(() => { const r = call('backend.status').relay; return Array.isArray(r) && r.length ? r : null; }, 8000).catch(() => null);
    log(`relay ${JSON.stringify(owner).slice(0, 200)}`);
    await shot(pA, '08-full');

    // 키보드가 올라오면 화면이 올라간다(가짜 visualViewport)
    await pA.tap('[data-field=phone-line]');
    await pA.evaluate(() => window.__kb(336));
    await sleep(700);
    // 글이 있는 마지막 줄(커서 줄 포함)이 입력 줄 위에 보이는가
    const kbState = () => pA.evaluate(() => {
      const vv = window.visualViewport;
      const k = document.querySelector('[data-role=phone-keys]').getBoundingClientRect();
      const inp = document.querySelector('[data-role=phone-line]').getBoundingClientRect();
      const out = document.querySelector('[data-role=phone-full-out]').getBoundingClientRect();
      const sc = document.querySelector('[data-role=phone-full-term] .xterm-screen').getBoundingClientRect();
      const tm = window.__mt.terms.get(document.querySelector('[data-role=phone-full]').dataset.session);
      const b = tm.buffer.active; let last = b.cursorY;
      for (let i = tm.rows - 1; i >= 0; i--) { const l = b.getLine(b.viewportY + i); if (l && l.translateToString(true).trim()) { last = Math.max(last, i); break; } }
      const rowH = sc.height / tm.rows;
      const keys = [...document.querySelectorAll('[data-role=phone-keys] [data-key]')].map((e) => e.getBoundingClientRect()).map((r) => [Math.round(r.left), Math.round(r.right)]);
      return { vvH: vv.height, keysBottom: Math.round(k.bottom), lineTop: Math.round(inp.top), outBottom: Math.round(out.bottom), lastTop: Math.round(sc.top + last * rowH), lastBottom: Math.round(sc.top + (last + 1) * rowH), last, rows: tm.rows, shift: +document.querySelector('[data-role=phone-full-term]').dataset.shift, keysFit: keys.every(([l, r]) => l >= 0 && r <= innerWidth), active: document.activeElement && document.activeElement.dataset.field };
    });
    const visibleRow = (k) => k.lastTop >= k.outBottom - 1 && k.lastBottom <= k.lineTop + 1;
    const rows0 = await pA.evaluate(() => window.__mt.terms.get(document.querySelector('[data-role=phone-full]').dataset.session).rows);
    const kb = await kbState();
    check('키보드가 올라오면 입력 줄·키 줄(키 열 개가 한 줄에)이 키보드 위에 있고, 글이 있는 마지막 줄(새 셸의 프롬프트)이 보인다(패널 줄 수 그대로)', kb.keysBottom <= kb.vvH + 1 && kb.keysFit && visibleRow(kb) && kb.rows === rows0 && kb.active === 'phone-line', kb);
    await shot(pA, '09-keyboard-up');

    // 한글 조합 입력(IME): 입력 줄에서 조합 → 확정 → 보내기
    const imeType = async (parts, final) => {
      for (const p of parts) await A.cdp.send('Input.imeSetComposition', { text: p, selectionStart: p.length, selectionEnd: p.length });
      await A.cdp.send('Input.insertText', { text: final });
    };
    await pA.evaluate(() => { window.__p76in = []; const c = window.__mt.api.call.bind(window.__mt.api); window.__mt.api.call = (m, p) => { if (m === 'terminal.input') window.__p76in.push(p.data); return c(m, p); }; });
    await A.cdp.send('Input.insertText', { text: 'echo p76-' });
    await imeType(['ㅎ', '하', '한'], '한');
    await imeType(['ㄱ', '그', '글'], '글');
    const during = await pA.evaluate(() => window.__p76in.length);
    await pA.keyboard.press('Enter');
    await until(() => (screenText('p76-shell').match(/p76-한글/g) || []).length >= 2, 15000, 500).catch(() => null);
    const sc = screenText('p76-shell');
    const sentIn = await pA.evaluate(() => window.__p76in.slice());
    check('한글 조합 입력: 조합하는 동안은 보내지 않고, Enter에 확정된 글을 셸에 보내 실행한다', during === 0 && (sc.match(/p76-한글/g) || []).length >= 2, { during, sent: sentIn, lines: sc.split('\n').filter((l) => /p76/.test(l)).slice(-3) });
    await shot(pA, '10-typed');
    // 키 줄: ↑ ⏎(지난 명령 다시), Ctrl+C
    await pA.tap('[data-role=phone-keys] [data-key=up]'); await sleep(300);
    await pA.tap('[data-role=phone-keys] [data-key=enter]');
    await until(() => (screenText('p76-shell').match(/p76-한글/g) || []).length >= 4, 15000, 500).catch(() => null);
    await pA.tap('[data-role=phone-keys] [data-key=ctrlc]'); await sleep(300);
    const keysSent = await pA.evaluate(() => window.__p76in.slice());
    const focusKept = await pA.evaluate(() => document.activeElement && document.activeElement.dataset.field);
    check('키 줄 ↑ ⏎로 지난 명령을 다시 실행하고 Ctrl+C를 보낸다(입력 줄 초점·키보드 유지)', (screenText('p76-shell').match(/p76-한글/g) || []).length >= 4 && keysSent.includes('\x03') && focusKept === 'phone-line', { keysSent, focusKept });
    // 긴 출력 뒤: 화면이 올라가 커서 줄(프롬프트)이 입력 줄 바로 위에 온다
    await A.cdp.send('Input.insertText', { text: '1..70' });
    await pA.keyboard.press('Enter');
    await until(() => /^70\s*$/m.test(screenText('p76-shell')), 15000, 500).catch(() => null);
    await sleep(1200);
    const kb2 = await kbState();
    check('긴 출력 뒤 키보드가 올라오면 화면이 저절로 올라가 아래 줄(프롬프트)이 입력 줄 바로 위에 보인다', kb2.shift > 0 && visibleRow(kb2) && kb2.lineTop - kb2.lastBottom < 40, kb2);
    await shot(pA, '09b-keyboard-long-output');
    // 터미널을 손가락으로 끌면 스크롤(휠)로, 판은 움직이지 않는다
    await pA.evaluate(() => window.__kb(0)); await sleep(500);
    const vpFull = (await boardState(pA, ID)).vp;
    const ft = await pA.evaluate(() => { const r = document.querySelector('[data-role=phone-full-term]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await pA.evaluate(() => { window.__p76in.length = 0; });
    await touch.drag(ft, { x: ft.x, y: ft.y + 160 });
    await sleep(400);
    const wheelIn = await pA.evaluate(() => window.__p76in.slice());
    const vpFull2 = (await boardState(pA, ID)).vp;
    check('전체 보기에서 손가락으로 끌면 판이 아니라 셸 기록이 스크롤된다', vpFull.x === vpFull2.x && vpFull.y === vpFull2.y && !!(await pA.$('[data-role=phone-full]')), { wheelIn: wheelIn.length, vp: [vpFull, vpFull2] });

    // 바깥 탭으로 나오기 → 같은 자리
    const out = await pA.evaluate(() => { const r = document.querySelector('[data-role=phone-full-out]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; });
    await touch.tap(out);
    await sleep(700);
    s1 = await boardState(pA, ID);
    check('전체 보기 바깥(위쪽 띠)을 탭하면 나오고 보드 화면은 같은 자리', !s1.full && near(s1.vp.x, s0.vp.x, 1) && near(s1.vp.y, s0.vp.y, 1) && near(s1.vp.zoom, s0.vp.zoom, 0.002), { out, before: s0.vp, after: s1.vp });
    await shot(pA, '11-back-same-place');
    // 뒤로 가기로 나오기
    const body2 = await nodeBox(pA, ID, '.mt-node-body');
    await touch.tap({ x: body2.x, y: body2.y }); await pA.waitForSelector('[data-role=phone-full]', { timeout: 5000 });
    await pA.goBack().catch(() => {}); await sleep(700);
    const afterBack = await boardState(pA, ID);
    check('뒤로 가기로 전체 보기에서 나온다(보드 화면 그대로, 짝 맺기·다른 화면으로 가지 않음)', !afterBack.full && !!(await pA.$('.react-flow')) && near(afterBack.vp.x, s0.vp.x, 1), afterBack.vp);
    // 오므리기로 나오기
    await touch.tap({ x: body2.x, y: body2.y }); await pA.waitForSelector('[data-role=phone-full]', { timeout: 5000 });
    await sleep(800);
    await touch.pinch({ x: 195, y: 380 }, 240, 70);
    await sleep(700);
    const afterPinch = await boardState(pA, ID);
    check('두 손가락으로 오므리면 전체 보기에서 나온다', !afterPinch.full, { vp: afterPinch.vp });

    // ---- 7. 길게 눌러 끌기 ----
    await setVp(pA, vpAt()); await sleep(1200);
    s0 = await boardState(pA, ID);
    const hb = await nodeBox(pA, ID, '.mt-node-head');
    const lifted = [];
    const holdDrag = (async () => {
      await A.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(hb.x), y: Math.round(hb.y), id: 0 }] });
      await sleep(650);
      lifted.push(await pA.evaluate((id) => { const el = document.querySelector(`.react-flow__node[data-id="${id}"]`); return !!(el && el.classList.contains('touch-lift')); }, ID));
      await shot(pA, '12-long-press');
      for (let i = 1; i <= 12; i++) { await A.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(hb.x - 3 * i), y: Math.round(hb.y - 10 * i), id: 0 }] }); await sleep(20); }
      await A.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    })();
    await holdDrag;
    await sleep(1500);
    s1 = await boardState(pA, ID);
    const rec = recOf(ID);
    const want = { dx: -36 / s0.vp.zoom, dy: -120 / s0.vp.zoom };
    check('길게 누르면(0.5초) 테두리로 알리고, 끌면 노드가 옮겨진다(판 기록의 자리가 바뀜, 판은 그대로)', lifted[0] && rec && near(rec.x - s0.store.x, want.dx, 4) && near(rec.y - s0.store.y, want.dy, 4) && near(s1.vp.x, s0.vp.x, 1) && near(s1.vp.y, s0.vp.y, 1), { lifted, rec: rec && { x: rec.x, y: rec.y }, before: s0.store, want });
    await shot(pA, '13-moved');
    // 짧게 누른 채(0.3초) 끌면 길게 누름이 아니라 판 옮기기(옮긴 노드의 머리줄이 위 크롬 밑에 가지 않게 화면을 맞춘다)
    await setVp(pA, { x: 20 - rec.x * z, y: 160 - rec.y * z, zoom: z }); await sleep(1200);
    s0 = await boardState(pA, ID);
    const hb2 = await nodeBox(pA, ID, '.mt-node-head');
    await touch.drag({ x: hb2.x, y: hb2.y }, { x: hb2.x + 40, y: hb2.y + 100 }, { hold: 300 });
    await sleep(900);
    s1 = await boardState(pA, ID);
    check('0.3초만 누른 뒤 끌면 노드가 아니라 판을 옮긴다', !moved(s0, s1) && near(panDelta(s0, s1).dy, 100, 6), { pan: panDelta(s0, s1) });
    // 노드 원래 자리로 되돌린다(다음 시험이 같은 자리를 쓴다)
    call('board.setNode', { session: ID, x: n0.x, y: n0.y, w: n0.w, h: n0.h }); await sleep(800);

    // 전체 보기에서 에이전트에게 입력(바로 그 자리)
    const AG = agentR.sessionId;
    const ar = recOf(AG);
    await setVp(pA, { x: 20 - ar.x * z, y: 140 - ar.y * z, zoom: z }).catch(() => {});
    await sleep(1500);
    const ab = await nodeBox(pA, AG, '.mt-node-body');
    if (ab) {
      await touch.tap({ x: ab.x, y: ab.y });
      await pA.waitForSelector(`[data-role=phone-full][data-session="${AG}"] .xterm-screen`, { timeout: 20000 });
      await sleep(1500);
      await pA.tap('[data-field=phone-line]');
      await A.cdp.send('Input.insertText', { text: 'Reply with exactly the single word PONGP76 and nothing else.' });
      await pA.keyboard.press('Enter');
      await until(() => { const s = byName('p76-agent'); return s && /PONGP76/.test(s.lastAnswer || ''); }, 120000, 1000).catch(() => null);
      check('전체 보기의 입력 줄로 에이전트에게 쳐서 보낸다(답이 온다)', /PONGP76/.test(byName('p76-agent').lastAnswer || ''), (byName('p76-agent').lastAnswer || '').slice(0, 80));
      await sleep(1500);
      await shot(pA, '14-agent-full');
      await pA.goBack().catch(() => {}); await sleep(600);
    } else check('전체 보기의 입력 줄로 에이전트에게 쳐서 보낸다(답이 온다)', false, 'agent node not visible');

    // ---- 8. 세션 목록 단추와 돌아오기 ----
    await pA.tap('[data-action=phone-list-open]');
    const listed = !!(await pA.waitForSelector('[data-role=phone-list]', { timeout: 10000 }).catch(() => null));
    await shot(pA, '15-list');
    await pA.tap('[data-action=phone-board]');
    const backBoard = !!(await pA.waitForSelector('.react-flow', { timeout: 10000 }).catch(() => null));
    check('작은 단추로 세션 목록에 가고, 목록의 보드 단추로 캔버스에 돌아온다', listed && backBoard, { listed, backBoard });
    // 크롬: 위·아래 알약과 레일이 줄어 판을 덜 가린다
    await sleep(800);
    const chrome = await pA.evaluate(() => {
      const q = (s) => [...document.querySelectorAll(s)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
      const area = (rs) => rs.reduce((a, r) => a + r[2] * r[3], 0);
      const parts = { top: q('[data-role=top-left], [data-role=top-right]'), rails: q('[data-role=rail-left], [data-role=rail-right]'), bottom: q('[data-role=bottom]:not([data-hidden]), [data-role=chips]:not([data-hidden]), [data-role=zoom]'), list: q('[data-action=phone-list-open]') };
      return { parts, coverPct: Math.round((100 * (area(parts.top) + area(parts.rails) + area(parts.bottom))) / (innerWidth * innerHeight)) };
    });
    check('휴대폰 보드 화면의 크롬이 판의 20% 넘게 가리지 않고 세션 목록 단추는 보인다', chrome.coverPct <= 20 && chrome.parts.list.length === 1, chrome);
    await shot(pA, '16-board-chrome');

    // ---- 9. 가로(휴대폰 세션 화면이 없는 폭): 탭하면 그 노드로 확대 ----
    await pA.setViewportSize({ width: 844, height: 390 });
    await sleep(1500);
    await setVp(pA, { x: 40 - n0.x * 0.15, y: 60 - n0.y * 0.15, zoom: 0.15 }); await sleep(1200);
    s0 = await boardState(pA, ID);
    const lb = await nodeBox(pA, ID, '.mt-node-body');
    await touch.tap({ x: lb.x, y: lb.y }); await sleep(1200);
    s1 = await boardState(pA, ID);
    check('가로 보드 화면에서 탭하면 전체 보기 대신 그 노드로 확대한다(터미널 초점 없음)', !s1.full && s1.vp.zoom > s0.vp.zoom + 0.1 && !s1.termFocus, { z0: s0.vp.zoom, z1: s1.vp.zoom, termFocus: s1.termFocus });
    await shot(pA, '17-landscape-tap');
    // 가로에서도 끌기는 판
    s0 = s1;
    const lt = await nodeBox(pA, ID, '.mt-node-body');
    await touch.drag({ x: lt.x, y: lt.y }, { x: lt.x - 100, y: lt.y + 40 });
    await sleep(900);
    s1 = await boardState(pA, ID);
    check('가로 보드 화면에서도 노드 위 한 손가락 끌기는 판만 옮긴다', !moved(s0, s1) && near(panDelta(s0, s1).dx, -100, 6), panDelta(s0, s1));
    await pA.setViewportSize({ width: 390, height: 844 });
    await sleep(800);

    // ---- 10. 노트북 크기 마우스 보드(터치 없음) ----
    const M = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale: 'ko-KR' });
    const pM = await M.newPage();
    pM.on('pageerror', (e) => log(`[laptop pageerror] ${e.message}`));
    await pM.goto(`${BASE}/`);
    await pM.waitForSelector('[data-role=pair]', { timeout: 20000 });
    await pM.fill('[data-field=pair-code]', newCode());
    await pM.click('[data-action=pair-submit]');
    await loadedOpen(pM); await splashGone(pM);
    await pM.waitForSelector(`.react-flow__node[data-id="${ID}"]`, { timeout: 20000 });
    await setVp(pM, { x: 300 - n0.x * 0.4, y: 200 - n0.y * 0.4, zoom: 0.4 }); await sleep(1500);
    let m0 = await boardState(pM, ID);
    const mh = await nodeBox(pM, ID);
    await pM.mouse.move(mh.x, mh.y); await pM.mouse.down();
    for (let i = 1; i <= 10; i++) { await pM.mouse.move(mh.x - 12 * i, mh.y - 6 * i); await sleep(16); }
    await pM.mouse.up(); await sleep(1200);
    let m1 = await boardState(pM, ID);
    const mouseNode = { moved: moved(m0, m1), d: m1.store && { dx: m1.store.x - m0.store.x, dy: m1.store.y - m0.store.y }, pan: panDelta(m0, m1) };
    // 빈 판 끌기는 판 옮기기
    m0 = m1;
    await pM.mouse.move(1000, 650); await pM.mouse.down();
    for (let i = 1; i <= 10; i++) { await pM.mouse.move(1000 - 10 * i, 650 - 5 * i); await sleep(16); }
    await pM.mouse.up(); await sleep(900);
    m1 = await boardState(pM, ID);
    const mousePan = { moved: moved(m0, m1), pan: panDelta(m0, m1) };
    check('노트북 크기 마우스 보드: 머리줄 끌기는 노드를 옮기고, 빈 판 끌기는 판을 옮긴다(지금처럼)', mouseNode.moved && near(mouseNode.d.dx, -120 / 0.4, 40) && near(mouseNode.d.dy, -60 / 0.4, 20) && mouseNode.pan.dx === 0 && !mousePan.moved && near(mousePan.pan.dx, -100, 4), { mouseNode, mousePan });
    await shot(pM, '18-laptop-mouse');
    await M.close();
    call('board.setNode', { session: ID, x: n0.x, y: n0.y, w: n0.w, h: n0.h });
  }
} catch (e) {
  log(`오류 ${e.stack}`);
  check('시험이 끝까지 돎', false, e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (sim) await sim.close().catch(() => {});
  try { for (const s of sessions()) if (/^p76-/.test(s.name) || path.resolve(s.cwd || '').toLowerCase() === path.resolve(PROJ).toLowerCase()) atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log(`정리 오류 ${e.message}`); }
  fs.writeFileSync(path.join(OUT, `p76-touch-${STAGE}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
