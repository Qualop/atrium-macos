// P109 창 시험: 고른 노드가 없을 때 판에서 Space를 살짝 길게 누르면 전체 보기(fitAll)로 바뀌고, 그 밖에는 Space가 그 자리의 몫인지 본다.
// 판: herdr 세션 atrium-dev-p109, 포트 47898, 이 워크트리의 backend/.dev(data, app). 창의 원격 디버깅 포트 9378. 창 안쪽 1920×1032.
// 장면: C:\Workspace\mtask-p109-a(셸 a1, a2), C:\Workspace\mtask-p109-b(셸 b1). 셸만 띄운다(신뢰 질문 없음).
// P109_STAGE: run(기본) | clean(세션 끄기, 판 멈추기, 시험 폴더 지우기)
// 결과는 experiments/p109/(git 밖).
// 실행(워크트리 루트): sh backend/.dev/clean-env.sh node app/test/e2e/p109-space.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const STAGE = process.env.P109_STAGE || 'run';
if (!['run', 'clean'].includes(STAGE)) throw new Error('P109_STAGE=run|clean');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p109');
const CONVOS = path.join(OUT, 'convos');
const F = { a: 'C:\\Workspace\\mtask-p109-a', b: 'C:\\Workspace\\mtask-p109-b' };
const BOARD = { session: 'atrium-dev-p109', port: 47898, cdp: 9378 };
const ENV = {
  ATRIUM_HERDR_SESSION: BOARD.session, ATRIUM_PORT: String(BOARD.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p109',
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)) delete process.env[k];
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, until, APP_ROOT, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p109' || ENV.ATRIUM_PORT !== '47898') throw new Error('P109 판(atrium-dev-p109, 47898)만');

const log = logger(`p109-${STAGE}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 180000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 800)}` : ''}`); };
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { log(`지우기 실패 ${p}: ${e.message.slice(0, 120)}`); } };
const killAll = () => { for (const s of sessions()) { try { atrium('kill', s.sessionId, '--yes', '--delete'); log('끔', s.name); } catch (e) { log('끄기 실패', s.name, e.message.slice(0, 160)); } } };

if (STAGE === 'clean') {
  try { killAll(); } catch (e) { log('목록 실패', e.message.slice(0, 160)); }
  try { log('herdr 멈춤', atrium('herdr', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { log('herdr 멈춤 실패', e.message.slice(0, 200)); }
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log('백엔드 멈춤 실패', e.message.slice(0, 200)); }
  for (const p of Object.values(F)) rmrf(p);
  process.exit(0);
}

// ---------- 판 ----------
log(atrium('backend', 'start').trim().slice(0, 300));
try { atrium('settings', 'set', 'tray', 'off'); } catch (e) { log('트레이 끄기 실패', e.message.slice(0, 120)); }
try { atrium('settings', 'set', 'language', 'ko'); } catch {}
for (const f of Object.values(F)) fs.mkdirSync(f, { recursive: true });
for (const f of Object.values(F)) { atrium('ws', 'open', f); await sleep(200); }
for (const [n, f] of [['a1', F.a], ['a2', F.a], ['b1', F.b]]) if (!byName(n)) { atrium('--json', 'spawn', f, '--name', n, '--kind', 'shell'); log('셸', n); await sleep(400); }

// ---------- 창 ----------
let app = null, page = null;
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); log(`스크린숏 experiments/p109/${name}.png`); };
const { _electron: electron } = await import('playwright');
app = await electron.launch({ args: ['.', '--dev', `--remote-debugging-port=${BOARD.cdp}`], cwd: APP_ROOT, env: process.env, timeout: 60000 });
try {
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[console.error] ${m.text().slice(0, 300)}`); });
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1920, 1032));
  await page.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
  await until(() => page.evaluate(() => document.querySelectorAll('.react-flow__node').length >= 3), 60000, 500);
  await sleep(2500);

  const vp = () => page.evaluate(() => { const v = window.__mt.getState().vpNow; return v && { x: +v.x.toFixed(1), y: +v.y.toFixed(1), zoom: +v.zoom.toFixed(4) }; });
  const near = (a, b, px = 2) => a && b && Math.abs(a.x - b.x) <= px && Math.abs(a.y - b.y) <= px && Math.abs(a.zoom - b.zoom) <= 0.002;
  const AWAY = { x: -900, y: -500, zoom: 1.3 }; // 셸 노드 하나쯤 크게 보는 자리(전체 보기와 다르다)
  const away = async () => { await page.evaluate((v) => window.__mt.getState().setViewport(v), AWAY); await sleep(400); };
  // 빈 판(.react-flow__pane)이 맨 위에 있는 점 하나
  const paneSpot = () => page.evaluate(() => {
    for (let y = 120; y < innerHeight - 160; y += 23) for (let x = 120; x < innerWidth - 160; x += 29) {
      const el = document.elementFromPoint(x, y);
      if (el && el.classList.contains('react-flow__pane')) return { x, y };
    }
    return null;
  });
  const clickBackground = async () => {
    let p = await paneSpot();
    for (let i = 0; !p && i < 3; i++) { await page.evaluate(() => window.__mt.getState().zoomBy(0.5)); await sleep(300); p = await paneSpot(); } // 노드가 화면을 채우면 물러난다(고름은 그대로)
    if (!p) throw new Error('빈 판 자리를 못 찾음');
    await page.mouse.click(p.x, p.y); await sleep(250); return p;
  };
  // Space를 ms 동안 누른다. 33ms마다 되풀이 keydown(Playwright: 이미 누른 키의 down은 repeat=true)
  const holdSpace = async (ms) => {
    await page.keyboard.down(' ');
    const t0 = Date.now();
    await sleep(Math.min(ms, 250));
    while (Date.now() - t0 < ms) { await page.keyboard.down(' '); await sleep(33); }
    await page.keyboard.up(' ');
  };
  const state = () => page.evaluate(() => { const st = window.__mt.getState(); return { selected: st.selected.length, rfSel: document.querySelectorAll('.react-flow__node.selected').length, mission: st.missionOpen, search: st.searchOpen, active: document.activeElement && (document.activeElement.className || document.activeElement.tagName).toString().slice(0, 60) }; });

  // 기준: 전체 보기 단추와 같은 동작(fitAll)의 보기
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  await sleep(500);
  const REF = await vp();
  log('전체 보기 기준', REF);
  check('기준과 다른 자리', !near(REF, AWAY), { REF, AWAY });

  async function longHoldCase(tag) {
    await away();
    await clickBackground();
    const before = await vp();
    await shot(`${tag}-before`);
    await holdSpace(500);
    await sleep(600);
    const after = await vp();
    await shot(`${tag}-after`);
    check(`${tag}: 배경을 눌러 고름을 푼 뒤 Space 500ms = fitAll 보기`, near(after, REF) && !near(before, REF), { before, after, REF });
    await sleep(1000);
    check(`${tag}: 떼고 1초 뒤에도 그 보기에 머문다`, near(await vp(), REF), await vp());
  }

  // 1. 길게(500ms)
  await longHoldCase('1-long');

  // 2. 빠르게(120ms)
  await away(); await clickBackground();
  { const before = await vp(); await holdSpace(120); await sleep(700); const after = await vp(); check('2: Space 120ms 뗌 = 그대로', near(after, before), { before, after }); }

  // 3. 노드를 고른 채 길게. 전체 보기에서 세션 노드 머리줄을 눌러(고르기만 한다, 화면은 그 노드로) 또는 Ctrl+눌러 고른다
  for (const how of ['head', 'ctrl']) {
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(400);
    await clickBackground();
    const head = await page.evaluate(() => {
      for (const h of document.querySelectorAll('.react-flow__node-session .mt-node-head')) {
        const r = h.getBoundingClientRect(); const x = r.x + Math.min(40, r.width / 3), y = r.y + r.height / 2;
        const el = document.elementFromPoint(x, y);
        if (r.width > 10 && el && el.closest('.mt-node-head') === h && !el.closest('button')) return { x, y };
      }
      return null;
    });
    if (how === 'ctrl') await page.keyboard.down('Control');
    await page.mouse.click(head.x, head.y);
    if (how === 'ctrl') await page.keyboard.up('Control');
    await sleep(600);
    const st = await state();
    const before = await vp();
    await holdSpace(500); await sleep(700);
    const after = await vp();
    check(`3-${how}: 노드를 고른 채 길게 = 그대로`, (st.selected > 0 || st.rfSel > 0) && near(after, before), { head, st, before, after });
    await clickBackground();
    const st2 = await state();
    check(`3-${how}: 배경을 누르면 고름이 풀린다`, st2.selected === 0 && st2.rfSel === 0, st2);
  }

  // 4. 터미널에 초점이 있을 때 길게 = 그대로, 터미널에 공백이 들어간다
  {
    const a1 = byName('a1');
    await page.evaluate((id) => window.__mt.getState().navigateTo(id, { focusTerminal: true }), a1.sessionId);
    await until(() => page.evaluate(() => !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.xterm'))), 15000, 300).catch(() => {});
    await sleep(800);
    const before = await vp();
    const st = await state();
    await page.keyboard.type('echo p109x', { delay: 20 });
    await holdSpace(500);
    await page.keyboard.type('p109y', { delay: 20 });
    await sleep(900);
    const after = await vp();
    const screen = atrium('screen', 'a1', '--text');
    const m = screen.match(/p109x( +)p109y/);
    check('4: 터미널에 초점, Space 길게 = 보기 그대로', near(after, before), { st, before, after });
    check('4: 터미널에 공백이 들어감', !!m && m[1].length >= 1, m ? `공백 ${m[1].length}개` : screen.split('\n').filter((l) => /p109/.test(l)).join(' / ').slice(0, 200));
    await page.keyboard.press('Control+C'); await sleep(300);
  }

  // 5. Space를 누른 채 끌기: 지금 동작(배경 끌기 = 화면 옮기기) 그대로, 전체 보기는 하지 않는다
  {
    await away(); const p = await clickBackground();
    const b0 = await vp();
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 120, p.y + 60, { steps: 8 }); await page.mouse.up(); await sleep(400);
    const b1 = await vp();
    log('Space 없이 끌기', { b0, b1 });
    await away(); const q = await clickBackground();
    const before = await vp();
    await page.keyboard.down(' '); await sleep(100);
    await page.mouse.move(q.x, q.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(q.x + 15 * i, q.y + 7.5 * i); await page.keyboard.down(' '); await sleep(40); }
    await page.mouse.up(); await sleep(300); await page.keyboard.up(' '); await sleep(600);
    const after = await vp();
    const dx = after.x - before.x, dy = after.y - before.y;
    check('5: Space 누른 채 끌기 = 화면이 끈 만큼 옮겨지고 전체 보기는 안 함', !near(after, REF) && Math.abs(dx - 120) <= 3 && Math.abs(dy - 60) <= 3 && after.zoom === before.zoom, { before, after, dx, dy, noSpace: { dx: b1.x - b0.x, dy: b1.y - b0.y } });
    // 기준 시간을 넘긴 뒤 끌기 = 전체 보기 뒤 그 보기에서 옮겨진다
    await away(); const r = await clickBackground();
    await page.keyboard.down(' '); for (let i = 0; i < 16; i++) { await sleep(33); await page.keyboard.down(' '); } await sleep(400);
    const fitted = await vp();
    await page.mouse.move(r.x, r.y); await page.mouse.down(); await page.mouse.move(r.x + 100, r.y + 40, { steps: 8 }); await page.mouse.up(); await sleep(300); await page.keyboard.up(' '); await sleep(300);
    const moved = await vp();
    check('5: 기준을 넘긴 뒤 끌기 = 전체 보기에서 옮겨진다', near(fitted, REF) && Math.abs(moved.x - fitted.x - 100) <= 3 && Math.abs(moved.y - fitted.y - 40) <= 3, { fitted, moved });
    // Space 누른 채 휠 = React Flow가 화면을 옮긴다(배율 그대로), 전체 보기는 안 함
    await away(); const w = await clickBackground();
    const wb = await vp();
    await page.keyboard.down(' '); await sleep(100); await page.mouse.move(w.x, w.y); await page.mouse.wheel(0, 200); await sleep(700); await page.keyboard.up(' '); await sleep(500);
    const wa = await vp();
    check('5: Space 누른 채 휠 = 전체 보기 안 함(React Flow 휠로 옮기기 그대로)', !near(wa, REF) && wa.zoom === wb.zoom, { wb, wa });
  }

  // 6. 미션 맵·검색이 열렸을 때
  {
    await away(); await clickBackground();
    await page.keyboard.press('m'); await sleep(900);
    const st = await state();
    const before = await vp();
    await holdSpace(500); await sleep(700);
    const after = await vp();
    const st2 = await state();
    check('6: 미션 맵이 열렸을 때 길게 = 그대로', st.mission && st2.mission && near(after, before), { st, st2, before, after });
    await page.keyboard.press('Escape'); await sleep(600);
    if ((await state()).mission) { await page.evaluate(() => window.__mt.getState().missionOpen && document.querySelector('[data-action="mission-close"]')?.click()); await sleep(600); }
    await clickBackground();
    await page.keyboard.press('Control+f'); await sleep(500);
    const s3 = await state();
    const b2 = await vp();
    await holdSpace(500); await sleep(700);
    const a2 = await vp();
    check('6: 검색이 열렸을 때(초점이 찾기 칸) 길게 = 그대로', s3.search && near(a2, b2), { s3, b2, a2 });
    // 찾기 바를 열어 둔 채 배경을 눌러 초점을 판으로 옮겨도 = 그대로(searchOpen)
    const p = await paneSpot(); await page.mouse.click(p.x, p.y); await sleep(300);
    const s4 = await state();
    const b3 = await vp(); await holdSpace(500); await sleep(700); const a3 = await vp();
    check('6: 찾기 바가 열린 채 판에 초점 = 그대로', !s4.search || near(a3, b3), { s4, b3, a3 });
    await page.keyboard.press('Escape'); await sleep(400);
    if ((await state()).search) { await page.evaluate(() => window.__mt.setSearchOpen ? window.__mt.setSearchOpen(false) : null); }
  }

  // 7. 안내(툴팁)
  {
    const tips = await page.evaluate(() => ({
      rail: (document.querySelector('[data-action="fit-all"]') || {}).getAttribute?.('aria-label') || (document.querySelector('[data-action="fit-all"]') || {}).title || null,
      zoom: (document.querySelector('[data-action="zoom-fit"]') || {}).title || null,
      chip: (document.querySelector('[data-action="chip-fit"]') || {}).title || null,
    }));
    check('7: 전체 보기 안내에 Space 길게', [tips.rail, tips.zoom].every((x) => x && /Space/.test(x)), tips);
  }

  // 8. 움직임 줄이기(reduce)
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sleep(300);
  await longHoldCase('8-reduce');

  fs.writeFileSync(path.join(OUT, 'p109-results.json'), JSON.stringify(results, null, 2));
  const fails = results.filter((r) => !r.ok);
  log(`결과 ${results.length - fails.length}/${results.length}`);
} finally {
  await closeApp(app).catch(() => {});
}
