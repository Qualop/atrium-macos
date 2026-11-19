// P151 창 시험: 휴대폰 웹에서 터미널을 길게 눌러 글 고르기 → 넓히기(같은 손가락, 손잡이, 가장자리 굴리기) → 복사(클립보드) → 끝내기.
// 짧게 누르기·끌어 스크롤·키 패드가 그대로인지, 고르는 동안 터미널로 마우스 보고·키가 가지 않는지도 본다.
// 따로 띄운 개발용 판(atrium-dev-p151, 47920, backend/.dev)만 쓴다. 휴대폰: Playwright 휴대폰 흉내(터치) → ts-sim(47922) → 백엔드(47920).
// 단계(창과 브라우저는 한 번에 하나):
//   setup     백엔드·터미널 서버, 시험 세션(셸, Claude Code haiku)을 띄우고 글이 찰 때까지 기다린다
//   chromium  iPhone(390×844, iOS Safari UA)과 Android(412×915, Chrome UA) 흉내. 진짜 터치(CDP Input.dispatchTouchEvent), 클립보드는 권한을 주고 읽는다
//   webkit    WebKit 한 번(localhost). 터치는 페이지 안의 TouchEvent로, 클립보드는 쓰기 함수를 엿본다
//   stop      시험 세션, 백엔드, 터미널 서버를 끈다
// 결과와 그림은 experiments/p151/(git 밖). 실행: node app/test/e2e/p151-touch.mjs <단계>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p151');
const CONVOS = path.join(OUT, 'convos');
const PROJ = process.env.P151_PROJ || 'C:\\Workspace\\mtask-p151-proj';
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A, baseOf } = L;
const B0 = { session: 'atrium-dev-p151', port: 47920, sim: 47922 };
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
const ENV = {
  ATRIUM_TERMINAL_SESSION: B0.session, ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p151',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim},localhost:${B0.sim}`,
  ATRIUM_REMOTE_QUIET_MS: '4000',
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true }); fs.mkdirSync(PROJ, { recursive: true });
const { logger, sleep, until } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const STAGE = process.argv[2] || 'setup';
const log = logger(`p151-${STAGE}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 180000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`); };
const N = { shell: 'p151-shell', claude: 'p151-claude' };
const shot = (pg, name) => pg.screenshot({ path: path.join(OUT, `${name}.png`) });

async function setup() {
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  for (const s of sessions()) if (/^p151-/.test(s.name)) atrium('kill', s.sessionId, '--yes', '--delete');
  const spawn = (...a) => JSON.parse(atrium('--json', 'spawn', PROJ, ...a));
  const sh = spawn('--kind', 'shell', '--name', N.shell);
  const cc = spawn('--model', 'haiku', '--name', N.claude, '--prompt', 'Without using any tools, reply with exactly 60 lines, line k being: "row k gamma delta epsilon" for k = 1..60. Nothing else.');
  check('시험 세션을 띄움(셸, Claude Code haiku), 신뢰 대화상자 예상 없음', sh.sessionId && cc.sessionId && !(cc.trust && cc.trust.needsTrust), { cc: cc.trust });
  await until(() => { const s = byName(N.shell); return s && s.state !== 'starting'; }, 60000, 1000).catch(() => null);
  await sleep(3000);
  atrium('input', N.shell, '1..120 | % { "line-$_ alpha beta gamma" }\r');
  await until(() => { const s = byName(N.claude); return s && (s.state === 'ready' || s.state === 'idle'); }, 180000, 1000).catch(() => null);
  log(JSON.stringify(sessions().filter((s) => /^p151-/.test(s.name)).map((s) => ({ name: s.name, state: s.state }))));
  check('Claude Code가 답을 끝냈다', /^(ready|idle)$/.test(byName(N.claude).state), byName(N.claude).state);
}

async function stop() {
  for (const s of sessions()) if (/^p151-/.test(s.name)) { try { atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log(`kill ${s.name}: ${e.message}`); } }
  try { log(atrium('terminal', 'stop', '--yes').trim()); } catch (e) { log(`terminal stop: ${e.message}`); }
  try { log(atrium('backend', 'stop').trim()); } catch (e) { log(`backend stop: ${e.message}`); }
}

// ---------- 휴대폰 ----------
const IPHONE = { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
const ANDROID = { viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, locale: 'en-US', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' };

async function pair(pg, base) {
  await pg.goto(`${base}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 20000 });
  await pg.fill('[data-field=pair-code]', call('device.code').code);
  await pg.tap('[data-action=pair-submit]');
  await pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open' && !!document.querySelector('[data-role=phone-list]'), null, { timeout: 60000 });
  await pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
  await sleep(1200);
}
const openSession = async (pg, name) => {
  const id = byName(name).sessionId;
  await pg.evaluate((i) => window.__mtPhone.open(i), id);
  await pg.waitForSelector(`[data-role=phone-session][data-session="${id}"] .xterm-screen`, { timeout: 20000 });
  await sleep(2500);
  return id;
};

// 페이지 안: 시험이 부르는 도우미(api.call 엿보기, 칸 자리, 선택 상태)
const PAGE_HELP = () => {
  if (window.__p151) return;
  const calls = [];
  const api = window.__mt.api;
  const orig = api.call.bind(api);
  api.call = (m, p) => { if (m === 'terminal.input' || m === 'session.keys') calls.push({ m, d: p && (p.data || (p.keys || []).join(',')), t: Math.round(performance.now()) }); return orig(m, p); };
  const term = (id) => window.__mt.terms.get(id);
  const evs = [];
  for (const k of ['click', 'mousedown', 'touchstart', 'touchend']) window.addEventListener(k, (e) => { evs.push(`${k}:${e.target && (e.target.dataset && e.target.dataset.action || e.target.className || e.target.tagName)}`); if (evs.length > 40) evs.shift(); }, true);
  window.__p151 = {
    calls, clip: [], evs,
    // 화면 줄 row에서 글 text가 시작하는 칸의 창 자리(가운데)
    find(id, re) {
      const t = term(id), b = t.buffer.active, rx = new RegExp(re);
      const r = t.element.querySelector('.xterm-screen').getBoundingClientRect();
      const cw = r.width / t.cols, ch = r.height / t.rows;
      for (let row = 0; row < t.rows; row++) {
        const s = b.getLine(b.viewportY + row).translateToString(true);
        const m = rx.exec(s);
        if (m) return { row, col: m.index, x: r.left + (m.index + 1.5) * cw, y: r.top + (row + 0.5) * ch, cw, ch, text: s, top: r.top, bottom: r.bottom };
      }
      return null;
    },
    rect(id) { const t = term(id); const r = t.element.querySelector('.xterm-screen').getBoundingClientRect(); return { left: r.left, top: r.top, bottom: r.bottom, w: r.width, h: r.height, cw: r.width / t.cols, ch: r.height / t.rows, rows: t.rows }; },
    sel(id) { const s = term(id)._mtSel; return { has: s.has(), text: s.text(), anchor: s.anchor, focus: s.focus, dragging: s.dragging, vy: term(id).buffer.active.viewportY }; },
    ui() {
      const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
      return { root: !!document.querySelector('[data-role=term-touch-select]'), start: q('[data-term-handle=start]'), end: q('[data-term-handle=end]'), bar: q('.mt-tsel-bar'), copy: q('[data-action=term-touch-copy]'), all: q('[data-action=term-touch-all]'), close: q('[data-action=term-touch-close]'), hint: (document.querySelector('.mt-term-hint') || {}).textContent || null, sel: !!document.querySelector('.mt-term-touchsel') };
    },
    // 끝 손잡이의 잡는 자리(점 아래 칸)
    grip(which) { const e = document.querySelector(`[data-term-handle=${which}]`); if (!e) return null; const r = e.getBoundingClientRect(); return which === 'end' ? { x: r.left + 1, y: r.bottom + 10 } : { x: r.left + 1, y: r.top - 10 }; },
    active() { const a = document.activeElement; return a ? `${a.tagName}.${a.className}` : null; },
  };
  // 클립보드 쓰기 엿보기(WebKit 시험: 읽을 수 없어 쓴 글을 적는다)
  if (navigator.clipboard && navigator.clipboard.writeText) { const w = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = (s) => { window.__p151.clip.push(s); return w(s).catch(() => {}); }; }
  const ex = document.execCommand.bind(document);
  document.execCommand = (c, ...a) => { if (c === 'copy') { const ta = document.activeElement; window.__p151.clip.push(ta && 'value' in ta ? ta.value : '?'); } return ex(c, ...a); };
};

// 터치 몰이: Chromium은 CDP 진짜 터치, WebKit은 페이지 안 TouchEvent(누른 곳의 요소로 보낸다)
function toucher(pg, cdp) {
  if (cdp) {
    const tp = (p) => [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    return {
      down: (p) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(p) }),
      move: (p) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p) }),
      up: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
      tap: async (p) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(p) }); await sleep(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); },
    };
  }
  const fire = (type, p) => pg.evaluate(({ type, p }) => {
    const st = window.__p151touch ||= {};
    if (type === 'touchstart') st.target = document.elementFromPoint(p.x, p.y);
    const target = st.target || document.body;
    // Windows WebKit에는 Touch 생성자가 없다: 보통 Event에 터치 목록을 붙인다(처리기는 touches·identifier·clientX/Y만 읽는다)
    const t = { identifier: 1, target, clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y, screenX: p.x, screenY: p.y };
    const list = type === 'touchend' ? [] : [t];
    const ev = new Event(type, { bubbles: true, cancelable: true, composed: true });
    for (const [k, v] of Object.entries({ touches: list, targetTouches: list, changedTouches: [t] })) Object.defineProperty(ev, k, { value: v });
    target.dispatchEvent(ev);
    st.last = p;
  }, { type, p });
  // 단추 누르기는 Playwright 탭(페이지 안 사건으로는 click이 생기지 않는다)
  return { tap: (p) => pg.touchscreen.tap(p.x, p.y), down: (p) => fire('touchstart', p), move: (p) => fire('touchmove', p), up: (p) => pg.evaluate(() => window.__p151touch.last).then((last) => fire('touchend', last || p || { x: 0, y: 0 })) };
}
async function longPress(T, p, ms = 700) { await T.down(p); await sleep(ms); }
async function glide(T, a, b, steps = 8, gap = 30) { for (let i = 1; i <= steps; i++) { await T.move({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }); await sleep(gap); } }
const copyNow = (s) => String(s ?? '').replace(/[ \t]+(?=\r?\n|$)/g, '');

// 한 세션 화면에서의 흐름. tag: 그림 이름 머리, clipRead: 클립보드를 읽는 함수(없으면 엿본 글)
async function flow(pg, T, { tag, sid, kind, clipRead, full = true }) {
  const H = (fn, ...a) => pg.evaluate(({ fn, a }) => window.__p151[fn](...a), { fn, a });
  await pg.evaluate(PAGE_HELP);
  const target = kind === 'shell' ? 'line-\\d+ alpha' : 'row \\d+ gamma';
  let at = await H('find', sid, target);
  if (!at) { check(`[${tag}] 고를 글이 화면에 있다`, false, await H('rect', sid)); return; }
  // 화면 가운데쯤 줄을 고른다(넓히기 자리를 남긴다)
  const rect = await H('rect', sid);
  const midRow = Math.floor(rect.rows / 3);
  const re2 = kind === 'shell' ? 'alpha' : 'gamma';
  const pick = await pg.evaluate(({ sid, midRow, re2 }) => { const t = window.__mt.terms.get(sid), b = t.buffer.active; for (let r = midRow; r < t.rows - 4; r++) { const s = b.getLine(b.viewportY + r).translateToString(true); const i = s.indexOf(re2); if (i >= 0) { const sr = t.element.querySelector('.xterm-screen').getBoundingClientRect(); const cw = sr.width / t.cols, ch = sr.height / t.rows; return { row: r, x: sr.left + (i + 1.5) * cw, y: sr.top + (r + 0.5) * ch, ch }; } } return null; }, { sid, midRow, re2 });
  if (pick) at = pick;

  // 1) 짧게 누르기: 고르지 않고 터미널 초점(입력칸 inputmode none)
  pg.evaluate(() => { window.__p151.calls.length = 0; });
  await T.down(at); await sleep(80); await T.up(at); await sleep(400);
  const tapSel = await H('sel', sid);
  check(`[${tag}] 짧게 누르기는 고르지 않는다`, !tapSel.has && !(await H('ui')).root, tapSel);

  // 2) 끌어 스크롤(빠르게): 고르지 않고 스크롤한다(셸: 버퍼 viewportY가 바뀐다)
  if (kind === 'shell') {
    const vy0 = (await H('sel', sid)).vy;
    await T.down({ x: at.x, y: at.y }); await glide(T, at, { x: at.x, y: at.y + 160 }, 8, 16); await T.up(); await sleep(500);
    const s2 = await H('sel', sid);
    check(`[${tag}] 끌어 스크롤은 그대로(고르지 않고 기록으로 올라간다)`, !s2.has && s2.vy < vy0, { vy0, vy: s2.vy });
    await T.down({ x: at.x, y: at.y + 160 }); await glide(T, { x: at.x, y: at.y + 160 }, at, 8, 16); await T.up(); await sleep(500);
    at = (await pg.evaluate(({ sid, re2, row }) => { const t = window.__mt.terms.get(sid), b = t.buffer.active; for (let r = row; r < t.rows - 4; r++) { const s = b.getLine(b.viewportY + r).translateToString(true); const i = s.indexOf(re2); if (i >= 0) { const sr = t.element.querySelector('.xterm-screen').getBoundingClientRect(); const cw = sr.width / t.cols, ch = sr.height / t.rows; return { row: r, x: sr.left + (i + 1.5) * cw, y: sr.top + (r + 0.5) * ch, ch }; } } return null; }, { sid, re2, row: Math.max(0, at.row - 2) })) || at;
  }

  // 3) 길게 누르기 → 낱말
  await pg.evaluate(() => { window.__p151.calls.length = 0; });
  await longPress(T, at, 750);
  const s1 = await H('sel', sid), u1 = await H('ui');
  check(`[${tag}] 길게 누르면 그 낱말을 고른다(손잡이 둘, 끄는 동안 막대 숨김)`, s1.has && s1.text === re2 && u1.root && u1.start && u1.end && !u1.bar && u1.sel, { text: s1.text, ui: u1 });
  await shot(pg, `${tag}-1-hold`);
  // 4) 손가락을 떼지 않고 아래로 3줄 끌기 → 여러 줄
  const to = { x: at.x + 40, y: at.y + at.ch * 3 };
  await glide(T, at, to, 6, 40);
  const s2 = await H('sel', sid);
  const lines2 = s2.text.split('\r\n').length;
  check(`[${tag}] 같은 손가락으로 끌면 넓어진다(4줄, 처음 낱말로 시작)`, lines2 === 4 && s2.text.startsWith(re2), { lines2, text: s2.text.slice(0, 200) });
  await T.up(); await sleep(400);
  const u2 = await H('ui');
  check(`[${tag}] 손을 떼면 떠 있는 막대(복사, 모두 선택, 닫기)가 뜨고 고른 것은 남는다`, u2.bar && u2.copy && u2.all && u2.close && (await H('sel', sid)).has, u2);
  await shot(pg, `${tag}-2-extend`);
  // 5) 끝 손잡이를 끌어 두 줄 더
  const g = await H('grip', 'end');
  await T.down(g); await sleep(60); await glide(T, g, { x: g.x, y: g.y + at.ch * 2 }, 5, 40); await T.up(); await sleep(400);
  const s3 = await H('sel', sid);
  check(`[${tag}] 끝 손잡이를 끌면 끝이 따라온다(6줄)`, s3.text.split('\r\n').length === 6 && s3.text.startsWith(re2), { n: s3.text.split('\r\n').length });
  // 처음 손잡이를 위로 한 줄
  const g0 = await H('grip', 'start');
  await T.down(g0); await sleep(60); await glide(T, g0, { x: rect.left + 2, y: g0.y - at.ch }, 5, 40); await T.up(); await sleep(400);
  const s4 = await H('sel', sid);
  check(`[${tag}] 처음 손잡이를 끌면 처음이 따라온다(7줄, 줄 처음부터)`, s4.text.split('\r\n').length === 7 && !s4.text.startsWith(re2), { n: s4.text.split('\r\n').length, head: s4.text.slice(0, 40) });
  // 고르는 동안 터미널로 간 입력·보고가 없다
  const sent = await pg.evaluate(() => window.__p151.calls.slice());
  check(`[${tag}] 고르는 동안 터미널로 키·마우스 보고를 보내지 않는다`, sent.length === 0, sent.slice(0, 5));
  await shot(pg, `${tag}-3-handles`);
  // 6) 복사
  const want = copyNow(s4.text);
  await pg.evaluate(() => { window.__p151.clip.length = 0; });
  const u4 = await H('ui');
  await T.tap(u4.copy); await sleep(700);
  const got = clipRead ? await clipRead() : (await pg.evaluate(() => window.__p151.clip.slice())).pop();
  const u5 = await H('ui');
  check(`[${tag}] 복사하면 클립보드에 고른 글(줄 끝 빈칸 뺌)이 들어가고 고르기가 끝나며 짧게 알린다`, got === want && !u5.root && !(await H('sel', sid)).has && !!u5.hint, { got: (got || '').slice(0, 120), want: want.slice(0, 120), hint: u5.hint, root: u5.root, at: u4.copy, evs: await pg.evaluate(() => window.__p151.evs.slice(-8)) });
  await shot(pg, `${tag}-4-copied`);
  if (!full) return;
  // 7) 모두 선택 → 닫기
  await longPress(T, at, 750); await T.up(); await sleep(400);
  const ua = await H('ui');
  await T.tap(ua.all); await sleep(400);
  const sa = await H('sel', sid);
  const nAll = sa.text.split('\r\n').length;
  check(`[${tag}] 모두 선택은 기록까지 넓힌다`, sa.has && nAll >= (kind === 'shell' ? 100 : 20), { nAll });
  await shot(pg, `${tag}-5-all`);
  const uc = await H('ui');
  await T.tap(uc.close); await sleep(400);
  check(`[${tag}] 닫기로 고르기를 끝낸다`, !(await H('sel', sid)).has && !(await H('ui')).root);
  // 8) 위 가장자리로 끌어 기록으로 굴러가며 넓히기
  await longPress(T, at, 750);
  const r0 = await H('rect', sid);
  const before = await H('sel', sid);
  await pg.evaluate(() => { window.__p151.calls.length = 0; });
  await glide(T, at, { x: at.x, y: r0.top + 2 }, 6, 40);
  await sleep(2000);
  const wheels = await pg.evaluate(() => window.__p151.calls.filter((c) => /\[<64;/.test(c.d || '')).length);
  const sx = await H('sel', sid);
  await T.up(); await sleep(300);
  const nx = sx.text.split('\r\n').length;
  // 셸: 판 안 기록으로 굴러간다. claude 등: 앱에 휠(SGR 64)을 보내 굴린다(이미 맨 위면 더 넓어지지 않는다)
  check(`[${tag}] 위 가장자리에 대면 기록으로 굴러가며 넓어진다`, kind === 'shell' ? nx > at.row + 2 : wheels > 0 && nx >= at.row + 1, { nx, row: at.row, wheels, before: before.text });
  // 9) 고른 채 터미널을 짧게 누르면 끝난다
  await T.down(at); await sleep(60); await T.up(at); await sleep(500);
  check(`[${tag}] 고른 채 터미널을 탭하면 고르기가 끝난다`, !(await H('sel', sid)).has && !(await H('ui')).root);
  // 10) 키 패드: 열고 키를 누르면 그대로 보낸다(고르기 없음)
  await pg.evaluate(() => { window.__p151.calls.length = 0; });
  const padOpen = await pg.$('[data-action=phone-pad-open]');
  if (padOpen) {
    await padOpen.tap(); await sleep(400);
    const k = await pg.$('[data-pad-key=right]');
    if (k) { await k.tap(); await sleep(600); }
    const keys = await pg.evaluate(() => window.__p151.calls.filter((c) => c.m === 'session.keys'));
    check(`[${tag}] 키 패드는 그대로(키를 보낸다, 고르기 없음)`, keys.length >= 1 && !(await H('sel', sid)).has, keys);
    await pg.tap('[data-action=phone-pad-close]').catch(() => {}); await sleep(300);
  }
}

async function chromiumStage() {
  const { startTsSim } = await import('file:///' + path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs').replace(/\\/g, '/'));
  const { chromium } = await import('playwright');
  const sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const found = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  const BASE = baseOf(B0.sim);
  const browser = await chromium.launch({ headless: true, ...(found ? { executablePath: found } : { channel: 'chromium' }), args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  try {
    for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
    for (const [label, dev] of [['iphone', IPHONE], ['android', ANDROID]]) {
      const ctx = await browser.newContext(dev);
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
      const pg = await ctx.newPage();
      pg.on('pageerror', (e) => log(`[${label} pageerror] ${e.message}`));
      pg.on('console', (m) => { if (m.type() === 'error') log(`[${label} console.error] ${m.text().slice(0, 200)}`); });
      const cdp = await ctx.newCDPSession(pg);
      await pair(pg, BASE);
      const T = toucher(pg, cdp);
      const clipRead = () => pg.evaluate(() => navigator.clipboard.readText());
      const sidS = await openSession(pg, N.shell);
      await flow(pg, T, { tag: `${label}-shell`, sid: sidS, kind: 'shell', clipRead, full: label === 'iphone' });
      await pg.evaluate(() => window.__mtPhone.list()); await sleep(600);
      const sidC = await openSession(pg, N.claude);
      await flow(pg, T, { tag: `${label}-claude`, sid: sidC, kind: 'claude', clipRead, full: label === 'iphone' });
      if (label === 'iphone') {
        // 보안 문맥이 아닐 때(http 원격): 숨은 입력칸 + execCommand로 복사한다
        await pg.evaluate(() => Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true }));
        await pg.evaluate(() => navigator.clipboard.writeText('-'));
        const H = (fn, ...a) => pg.evaluate(({ fn, a }) => window.__p151[fn](...a), { fn, a });
        const at = await H('find', sidC, 'row \\d+ gamma');
        await longPress(T, at, 750); await T.up(); await sleep(400);
        const want = copyNow((await H('sel', sidC)).text);
        const u = await H('ui');
        await T.tap(u.copy); await sleep(600);
        const got = await clipRead();
        check('[iphone] 보안 문맥이 아니어도(execCommand) 복사된다', got === want && want.length > 0, { got, want });
      }
      await ctx.close();
    }
  } finally { await browser.close().catch(() => {}); sim.close && sim.close(); }
}

async function webkitStage() {
  const { startTsSim } = await import('file:///' + path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs').replace(/\\/g, '/'));
  const { webkit } = await import('playwright');
  const sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const BASE = `http://localhost:${B0.sim}`;
  const browser = await webkit.launch({ headless: true });
  try {
    for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
    const ctx = await browser.newContext(IPHONE);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[webkit pageerror] ${e.message}`));
    pg.on('console', (m) => { if (m.type() === 'error') log(`[webkit console.error] ${m.text().slice(0, 200)}`); });
    await pair(pg, BASE);
    const T = toucher(pg, null);
    const css = await pg.evaluate(() => { const w = document.querySelector('.mt-term-wrap'); return null; });
    const sidC = await openSession(pg, N.claude);
    const st = await pg.evaluate(() => { const w = document.querySelector('[data-role=phone-term] .mt-term-wrap'); const s = getComputedStyle(w); return { cls: w.className, us: s.webkitUserSelect || s.userSelect, callout: s.webkitTouchCallout }; });
    check('[webkit] 터미널에 iOS 글 고르기·길게 누르기 메뉴를 끈 CSS', /mt-term-touch/.test(st.cls) && st.us === 'none', st);
    await flow(pg, T, { tag: 'webkit-claude', sid: sidC, kind: 'claude', clipRead: null, full: false });
    // 참고(판정 아님): 키 패드 단추(P104, pointerdown preventDefault)가 WebKit 손가락 탭에서 click을 받는지
    await pg.evaluate(() => { window.__p151.calls.length = 0; });
    const po = await pg.evaluate(() => { const e = document.querySelector('[data-action=phone-pad-open]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    if (po) { await pg.touchscreen.tap(po.x, po.y); await sleep(500); }
    const padShown = await pg.evaluate(() => !!document.querySelector('[data-role=phone-pad]'));
    log(`INFO [webkit] 키 패드 열기 단추 탭 → 패드 ${padShown ? '열림' : '안 열림'}`);
    await ctx.close();
    void css;
  } finally { await browser.close().catch(() => {}); sim.close && sim.close(); }
}

try {
  if (STAGE === 'setup') await setup();
  else if (STAGE === 'chromium') await chromiumStage();
  else if (STAGE === 'webkit') await webkitStage();
  else if (STAGE === 'stop') await stop();
  else throw new Error(`unknown stage ${STAGE}`);
} catch (e) { check(`단계 ${STAGE} 오류 없이`, false, e.stack || e.message); }
const fail = results.filter((r) => !r.ok);
log(`P151 ${STAGE}: ${results.length - fail.length}/${results.length} 통과`);
fs.writeFileSync(path.join(OUT, `result-${STAGE}.json`), JSON.stringify(results, null, 2));
process.exit(fail.length ? 1 : 0);
