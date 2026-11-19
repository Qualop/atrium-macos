// P155 창 시험: 명령줄 태그 칩 한 번에 지우기(판과 세션 맵), 세션 맵 줄 머리는 Alt+끌기만 옮기기(Alt 없이 = 시점 이동).
// 판: 따로 띄운 개발용 판(atrium-dev-p155, 47924, backend/.dev)만 쓴다. 창의 원격 디버깅 포트 9404. 한 번에 한 창만(메모리).
//   셸 세션 둘(p155-a, p155-b, 시험 폴더 C:\Workspace\mtask-p155-a·-b)과 폴더 하나(P155 Folder, -b가 들어 있다)를 실제로 만든다.
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p155-tag-alt.mjs <setup|pc|stop>
// 결과는 워크트리의 experiments/p155/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p155');
const CONVOS = path.join(REPO, 'experiments', 'p155', 'convos');
const DIR_A = 'C:\\Workspace\\mtask-p155-a', DIR_B = 'C:\\Workspace\\mtask-p155-b';
const FOLDER = 'P155 Folder';
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k];
process.env.MT_E2E_OUT = path.relative(path.join(REPO, 'experiments'), OUT);
const ENV = {
  ATRIUM_TERMINAL_SESSION: 'atrium-dev-p155', ATRIUM_HERDR_SESSION: 'atrium-dev-p155', ATRIUM_PORT: '47924',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p155-none-',
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const log = logger(`p155-${WHAT}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const AWAKE = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
const shotTo = (pg, name, clip) => pg.screenshot({ path: path.join(OUT, `${name}.png`), ...(clip ? { clip } : {}) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
async function awayWin(app) { return app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; if (!w) return null; const ds = screen.getAllDisplays(); const left = Math.min(...ds.map((d) => d.bounds.x)); const b = w.getBounds(); w.setPosition(left - b.width - 200, 40); return w.getBounds(); }).catch((e) => ({ err: e.message })); }
const wsKey = (dir) => { const k = dir.replace(/\\/g, '/').toLowerCase(); const w = call('workspace.list'); const list = Array.isArray(w) ? w : w.workspaces || []; const hit = list.find((x) => String(x.key).toLowerCase().replace(/\/\.git$/, '') === k || String(x.root || '').replace(/\\/g, '/').toLowerCase() === k); return hit ? hit.key : null; };
const groupsNow = () => { const g = call('group.list'); return (Array.isArray(g) ? g : g.groups || []).map((x) => ({ id: x.id, name: x.name, members: x.members })); };

async function setupBoard() {
  fs.mkdirSync(DIR_A, { recursive: true }); fs.mkdirSync(DIR_B, { recursive: true });
  log(atrium('backend', 'start').trim().slice(0, 300));
  const have = new Set(call('session.list').map((s) => s.name));
  if (!have.has('p155-a')) log(atrium('--json', 'spawn', DIR_A, '--kind', 'shell', '--name', 'p155-a').slice(0, 160));
  if (!have.has('p155-b')) log(atrium('--json', 'spawn', DIR_B, '--kind', 'shell', '--name', 'p155-b').slice(0, 160));
  await sleep(2500);
  const kb = wsKey(DIR_B);
  if (!groupsNow().some((g) => g.name === FOLDER)) log(JSON.stringify(call('group.create', { name: FOLDER, workspaces: [kb] })).slice(0, 300));
  log(JSON.stringify(groupsNow()));
}

// 명령줄 읽기·쓰기
const cmdVal = (pg) => pg.$eval('[data-role="command"]', (el) => el.value);
async function cmdSet(pg, v) {
  await pg.click('[data-role="command"]');
  await pg.keyboard.press('Control+A'); await pg.keyboard.press('Delete');
  if (v) await pg.keyboard.type(v, { delay: 5 });
  await sleep(150);
}
const caretTo = (pg, n) => pg.$eval('[data-role="command"]', (el, p) => { el.focus(); el.setSelectionRange(p, p); }, n);

async function chipChecks(pg, where) {
  // 1) 칩 뒤 빈칸 다음에서 Backspace 한 번 = 칩 통째로
  await cmdSet(pg, '@p155-a @p155-b ');
  await shotTo(pg, `${where}-chips-before`);
  await pg.keyboard.press('Backspace'); await sleep(150);
  const a1 = await cmdVal(pg);
  await shotTo(pg, `${where}-chips-after-backspace`);
  // 2) 되돌리기
  await pg.keyboard.press('Control+Z'); await sleep(150);
  const a2 = await cmdVal(pg);
  check(`[${where}] Backspace 한 번에 칩이 통째로 지워지고 Ctrl+Z로 돌아온다`, a1 === '@p155-a ' && a2 === '@p155-a @p155-b ', { a1, a2 });
  // 3) 글과 섞인 칩: 칩 바로 앞 Delete, 글 끝 Backspace는 한 글자
  await cmdSet(pg, '@p155-a @p155-b hello');
  await caretTo(pg, 8); await pg.keyboard.press('Delete'); await sleep(150);
  const b1 = await cmdVal(pg);
  await pg.keyboard.press('End'); await pg.keyboard.press('Backspace'); await sleep(150);
  const b2 = await cmdVal(pg);
  check(`[${where}] 칩 앞 Delete = 칩 통째로, 글 끝 Backspace = 한 글자`, b1 === '@p155-a hello' && b2 === '@p155-a hell', { b1, b2 });
  // 4) 한글: 칩 뒤에 한글을 넣고 Backspace는 한 글자, 그 뒤 칩 뒤에서 Backspace는 칩
  await cmdSet(pg, '@p155-a ');
  await pg.keyboard.insertText('안녕'); await sleep(150);
  await pg.keyboard.press('Backspace'); await sleep(150);
  const c1 = await cmdVal(pg);
  await pg.keyboard.press('Backspace'); await sleep(150);
  const c2 = await cmdVal(pg);
  await pg.keyboard.press('Backspace'); await sleep(150);
  const c3 = await cmdVal(pg);
  check(`[${where}] 한글 글자는 한 글자씩, 그다음 Backspace에 칩`, c1 === '@p155-a 안' && c2 === '@p155-a ' && c3 === '', { c1, c2, c3 });
  // 5) 여러 줄: 둘째 줄 칩
  await cmdSet(pg, '@p155-a first');
  await pg.keyboard.press('Shift+Enter'); await pg.keyboard.type('ask @p155-b', { delay: 5 }); await sleep(150);
  await pg.keyboard.press('Backspace'); await sleep(150);
  const d1 = await cmdVal(pg);
  check(`[${where}] 둘째 줄 글 사이 칩도 Backspace 한 번에(줄바꿈은 남는다)`, d1 === '@p155-a first\nask ', { d1 });
  await cmdSet(pg, '');
}

async function openMission(pg) {
  if (await pg.$('[data-role="mission"]')) return;
  await pg.click('[data-action="mission-rail"]');
  await pg.waitForSelector('[data-role="mission"] .mt-sm-head', { timeout: 20000 });
  await sleep(1200);
}
async function closeMission(pg) { for (let i = 0; i < 3 && (await pg.$('[data-role="mission"]')); i++) { await pg.keyboard.press('Escape'); await sleep(400); } }

async function pc() {
  const { app, page } = await launch({ log, env: { ...ENV }, args: ['--remote-debugging-port=9404', ...AWAKE] });
  try {
    await awayWin(app);
    await page.setViewportSize({ width: 1584, height: 921 }).catch(() => {});
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sleep(2500);
    // ---- 판의 명령줄 ----
    await chipChecks(page, 'board');
    // ---- 세션 맵의 명령줄 ----
    await openMission(page);
    await chipChecks(page, 'map');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    // ---- 세션 맵 줄 머리 끌기 ----
    const ka = wsKey(DIR_A);
    const g0 = groupsNow();
    const folder = g0.find((g) => g.name === FOLDER);
    check('준비: 폴더에 -b만 있고 -a는 폴더 밖', folder && !folder.members.includes(ka), { ka, g0 });
    await page.evaluate(() => window.__mtTa.fit()); await sleep(600);
    const geo = () => page.evaluate(([key, fid]) => {
      const h = document.querySelector(`.mt-sm-head[data-key="${CSS.escape(key)}"]`).getBoundingClientRect();
      const t = document.querySelector(`.mt-sm-band[data-id="${CSS.escape(fid)}"]`).getBoundingClientRect();
      return { from: { x: h.left + 40, y: h.top + 10 }, to: { x: t.left + Math.min(t.width / 2, 400), y: t.top + Math.min(t.height / 2, 60) } };
    }, [ka, folder.id]);
    const drag = async (from, to, steps = 15) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await sleep(16); } };
    // (가) Alt 없이 줄 머리 끌기 = 시점 이동
    let G = await geo();
    const head0 = await page.evaluate((key) => getComputedStyle(document.querySelector(`.mt-sm-head[data-key="${CSS.escape(key)}"]`)).cursor, ka);
    const v0 = await page.evaluate(() => window.__mtTa.view());
    await drag(G.from, { x: G.from.x + 120, y: G.from.y + 80 });
    const moving0 = await page.evaluate(() => !!document.querySelector('.mt-sm-row.moving, .mt-sm-band.drop'));
    await page.mouse.up(); await sleep(500);
    const v1 = await page.evaluate(() => window.__mtTa.view());
    const g1 = groupsNow();
    check('Alt 없이 줄 머리를 끌면 화면만 움직이고(옮기기 강조 없음) 폴더는 그대로, 커서는 보기 칸과 같은 grab', Math.abs(v1.x - v0.x - 120) < 3 && Math.abs(v1.y - v0.y - 80) < 3 && !moving0 && !g1.find((g) => g.id === folder.id).members.includes(ka) && head0 === 'grab', { v0, v1, moving0, head0 });
    await shotTo(page, 'map-noalt-pan');
    await page.evaluate(() => window.__mtTa.fit()); await sleep(600);
    // (나) Alt를 누른 채 줄 머리에 올리기 = 옮기기 모양
    G = await geo();
    await page.mouse.move(G.from.x, G.from.y); await sleep(100);
    await page.keyboard.down('Alt'); await sleep(50);
    await page.mouse.move(G.from.x + 2, G.from.y + 1); await sleep(200);
    const hov = await page.evaluate((key) => { const vp = document.querySelector('[data-role=ta-viewport]'); const h = document.querySelector(`.mt-sm-head[data-key="${CSS.escape(key)}"]`); const cs = getComputedStyle(h); return { alt: vp.dataset.alt || null, cursor: cs.cursor, outline: cs.outlineStyle }; }, ka);
    check('Alt를 누른 채 줄 머리에 커서를 올리면 옮기기 커서(move)와 머리 강조', hov.alt === '1' && hov.cursor === 'move' && hov.outline === 'dashed', hov);
    await shotTo(page, 'map-alt-hover');
    // (다) Alt+끌기, Esc로 취소
    await drag(G.from, G.to);
    const hot1 = await page.evaluate(() => [...document.querySelectorAll('.mt-sm-band.drop')].map((x) => x.dataset.id));
    await page.keyboard.press('Escape'); await page.mouse.up(); await sleep(500);
    const gEsc = groupsNow();
    const still = await page.$('[data-role="mission"]');
    check('Alt+끌기 중 Esc = 취소(폴더 그대로, 세션 맵은 열린 채)', hot1.includes(folder.id) && !gEsc.find((g) => g.id === folder.id).members.includes(ka) && !!still, { hot1 });
    // (라) Alt+끌기, 중간에 Alt를 떼도 놓을 때까지 옮기기 → 폴더로
    G = await geo();
    await drag(G.from, { x: (G.from.x + G.to.x) / 2, y: (G.from.y + G.to.y) / 2 }, 8);
    await page.keyboard.up('Alt'); await sleep(100);
    for (let i = 1; i <= 8; i++) { await page.mouse.move((G.from.x + G.to.x) / 2 + (G.to.x - G.from.x) / 2 * i / 8, (G.from.y + G.to.y) / 2 + (G.to.y - G.from.y) / 2 * i / 8); await sleep(16); }
    const hot2 = await page.evaluate(() => [...document.querySelectorAll('.mt-sm-band.drop')].map((x) => x.dataset.id));
    await shotTo(page, 'map-alt-drag');
    await page.mouse.up(); await sleep(1500);
    const g2 = groupsNow();
    const altGone = await page.evaluate(() => document.querySelector('[data-role=ta-viewport]').dataset.alt || null);
    check('Alt+끌기로 폴더 띠에 놓으면 그 폴더로(끄는 중 Alt를 떼도 유지), 뗀 뒤 옮기기 표시는 꺼진다', hot2.includes(folder.id) && g2.find((g) => g.id === folder.id).members.includes(ka) && !altGone, { hot2, g2, altGone });
    await shotTo(page, 'map-after-move');
    // (마) Alt만 눌렀다 떼도 창 메뉴로 초점이 가지 않는다: 그다음 친 글자가 명령줄에 들어간다
    await page.keyboard.press('Alt'); await sleep(200);
    await page.keyboard.press('x'); await sleep(300);
    const typed = await cmdVal(page);
    check('Alt를 눌렀다 떼도 초점이 창에 남는다(다음 글자가 명령줄로)', typed.endsWith('x'), { typed });
    await cmdSet(page, '');
    // ---- 사이드바: -a가 폴더 아래에 보인다 ----
    await closeMission(page); await sleep(800);
    if (!(await page.$('[data-role=sidebar] .mt-sb2-row'))) { await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press('Control+Shift+E'); await sleep(800); }
    const sb =await page.evaluate(([fid, key]) => {
      const rows = [...document.querySelectorAll('[data-role=sidebar] .mt-sb2-row')];
      const gi = rows.findIndex((r) => r.dataset.sb === 'group' && r.dataset.group === fid);
      if (gi < 0) return { gi };
      const after = []; for (let i = gi + 1; i < rows.length && rows[i].dataset.sb !== 'group'; i++) if (rows[i].dataset.sb === 'ws') after.push(rows[i].dataset.ws);
      return { gi, after, has: after.includes(key) };
    }, [folder.id, ka]);
    check('사이드바에도 -a가 폴더 아래에 보인다', sb.has, sb);
    await shotTo(page, 'board-sidebar-after');
    // 되돌리기: -a를 폴더 밖으로
    call('group.move', { workspace: ka, group: null });
  } finally { await closeApp(app); }
}

async function stopBoard() {
  for (const s of call('session.list').filter((x) => /^p155-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
  await sleep(2000);
  try { log(atrium('terminal', 'stop', '--yes').slice(0, 200)); } catch (e) { log(`terminal stop ${e.message.slice(0, 120)}`); }
  try { log(atrium('backend', 'stop').slice(0, 200)); } catch (e) { log(`backend stop ${e.message.slice(0, 120)}`); }
}

try {
  if (WHAT === 'setup') await setupBoard();
  else if (WHAT === 'pc') await pc();
  else if (WHAT === 'stop') await stopBoard();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, `p155-${WHAT}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
