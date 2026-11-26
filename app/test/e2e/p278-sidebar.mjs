// P278 창 시험: 캔버스에서 왼쪽 사이드바의 폴더(가상 그룹) 머리를 누르면 그 폴더의 영역 묶음으로 간다. 화살표는 접기만, 빈 폴더는 아무것도 하지 않는다.
// 판: 터미널 세션 atrium-dev-p278, 포트 48028, 이 워크트리의 backend/.dev(data, app). 창의 원격 디버깅 포트 9509.
// 장면(새 폴더 C:\\Workspace\\mtask-p278-*, git 아님, 셸만 띄운다): 폴더 Team(alpha·beta), 폴더 Solo(gamma), 빈 폴더 Empty, 폴더 없음 delta.
// 단계: setup | shot <ko|en> | clean. 결과는 experiments/p278/(git 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [STAGE = 'shot', LANG = 'ko'] = process.argv.slice(2);
if (!['setup', 'shot', 'clean'].includes(STAGE)) throw new Error('단계: setup | shot | clean');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p278');
const CONVOS = path.join(DEV, 'p278-projects');
const BOARD = { session: 'atrium-dev-p278', port: 48028, cdp: 9509 };
const ENV = {
  ATRIUM_TERMINAL_SESSION: BOARD.session, ATRIUM_HERDR_SESSION: BOARD.session, ATRIUM_PORT: String(BOARD.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_CLAUDE_SESSIONS: path.join(DEV, 'p278-claude-sessions'),
  ATRIUM_TEST_PREFIX: 'mtask-p278-x', MT_E2E_OUT: 'p278',
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_|MT_HERDR)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)) delete process.env[k];
Object.assign(process.env, ENV);
for (const d of [OUT, CONVOS, ENV.ATRIUM_CLAUDE_SESSIONS]) fs.mkdirSync(d, { recursive: true });
const { logger, sleep, until, APP_ROOT } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const log = logger(`p278-${STAGE}-${LANG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 180000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const sessions = () => call('session.list');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };

const W = 'C:\\Workspace';
const F = { alpha: `${W}\\mtask-p278-alpha`, beta: `${W}\\mtask-p278-beta`, gamma: `${W}\\mtask-p278-gamma`, delta: `${W}\\mtask-p278-delta` };
for (const d of Object.values(F)) if (!/^C:\\Workspace\\mtask-p278-[a-z]+$/.test(d)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p278-*만: ${d}`);
const LIVE = [['alpha-build', 'alpha'], ['alpha-notes', 'alpha'], ['beta-review', 'beta'], ['gamma-run', 'gamma'], ['delta-idle', 'delta']];
const SCENE = path.join(OUT, 'scene.json');

async function setup() {
  log('백엔드', atrium('backend', 'start').trim().slice(0, 200));
  for (const s of sessions()) { try { atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log('옛 세션 끄기 실패', s.name, e.message.slice(0, 120)); } }
  for (const d of Object.values(F)) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'README.md'), `# ${path.basename(d)}\n`); }
  const key = {};
  for (const [k, d] of Object.entries(F)) { const r = call('workspace.open', { path: d, select: false }); key[k] = r.workspace.key; log('워크스페이스', k, r.workspace.key); }
  for (const [name, ws] of LIVE) { const r = call('session.spawn', { cwd: F[ws], kind: 'shell', name }); log('띄움', name, r.sessionId); }
  await until(() => { const s = sessions(); return LIVE.every(([n]) => s.some((x) => x.name === n && /shell_/.test(x.state))); }, 120000, 1500).catch(() => log('셸 준비 기다림 넘김'));
  const gid = {};
  try {
    gid.team = call('group.create', { name: 'Team', workspaces: [key.alpha] }).created; call('group.move', { workspace: key.beta, group: gid.team, index: null });
    gid.solo = call('group.create', { name: 'Solo', workspaces: [key.gamma] }).created;
    gid.empty = call('group.create', { name: 'Empty' }).created;
  } catch (e) { log('그룹 실패', e.message.slice(0, 160)); }
  fs.writeFileSync(SCENE, JSON.stringify({ key, gid }, null, 1));
  check('장면: 워크스페이스 넷, 세션 다섯, 폴더 셋', sessions().length === LIVE.length && Object.keys(gid).length === 3, { sessions: sessions().length, gid });
}

const scene = () => JSON.parse(fs.readFileSync(SCENE, 'utf8'));
const shot = async (page, name) => { const f = path.join(OUT, `${LANG}-${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const groupSel = (id) => `[data-sb="group"][data-group="${id}"]`;
const viewport = (page) => page.evaluate(() => { const v = window.__mt.getState().vpNow; return v ? { x: Math.round(v.x), y: Math.round(v.y), zoom: +v.zoom.toFixed(3) } : null; });
// 영역들이 캔버스 화면(사이드바 오른쪽) 안에 다 보이는지
const visible = (page, keys) => page.evaluate((keys) => {
  const pane = document.querySelector('.react-flow').getBoundingClientRect();
  return keys.map((k) => { const el = document.querySelector(`.mt-region[data-ws="${CSS.escape(k)}"]`); if (!el) return { k, found: false }; const r = el.getBoundingClientRect(); return { k, found: true, inside: r.left >= pane.left - 1 && r.top >= pane.top - 1 && r.right <= pane.right + 1 && r.bottom <= pane.bottom + 1 }; });
}, keys);
const sameVp = (a, b) => a && b && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.zoom - b.zoom) < 0.002;

async function openWindow() {
  const { _electron: electron } = await import('playwright');
  const app = await electron.launch({ args: ['.', '--dev', `--remote-debugging-port=${BOARD.cdp}`], cwd: APP_ROOT, env: process.env, timeout: 60000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[console.error] ${m.text().slice(0, 300)}`); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 860));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await page.evaluate(() => { try { localStorage.removeItem('mt.sidebar'); } catch {} });
  await page.reload();
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await sleep(1500);
  return { app, page };
}

async function shots() {
  atrium('settings', 'set', 'language', LANG);
  const { key, gid } = scene();
  const { app, page } = await openWindow();
  try {
    if (!(await page.$('[data-role="sidebar"]'))) await page.keyboard.press('Control+Shift+E');
    await page.waitForSelector('[data-role="sidebar"]');
    await sleep(1200);
    // 전: 폴더 없음의 delta 영역에 맞춰 둔다(워크스페이스 줄 누르기)
    await page.click(`[data-sb="ws"][data-ws="${key.delta}"]`);
    await sleep(900);
    await page.mouse.move(1000, 500);
    const v0 = await viewport(page);
    const before = await visible(page, [key.alpha, key.beta]);
    log('전', JSON.stringify({ v0, before }));
    check('전: Team 영역이 다 보이지는 않는다', before.some((r) => !r.found || !r.inside), before);
    await shot(page, '01-before');
    // 폴더 Team 이름을 누른다 → alpha·beta 영역이 다 보이게 맞춘다
    await page.click(`${groupSel(gid.team)} [data-role="group-name"]`);
    await sleep(900);
    await page.mouse.move(1000, 500);
    const v1 = await viewport(page);
    const after = await visible(page, [key.alpha, key.beta]);
    const cur = await page.evaluate(() => window.__mt.getState().currentWs);
    log('후', JSON.stringify({ v1, after, cur }));
    check('폴더 이름 누르기: 화면이 움직였다', !sameVp(v0, v1), { v0, v1 });
    check('폴더 이름 누르기: 구성 영역이 모두 화면 안', after.every((r) => r.found && r.inside), after);
    check('폴더 이름 누르기: 지금 워크스페이스가 그 폴더 안', [key.alpha, key.beta].includes(cur), cur);
    const frame = await page.evaluate(() => document.querySelectorAll('.mt-wsgroup, [data-role="group-frame"]').length);
    log('묶음 테두리 수', frame);
    await shot(page, '02-after-team');
    // 화살표는 접기만: 화면은 그대로
    const folded0 = await page.evaluate((id) => document.querySelector(`[data-sb="group"][data-group="${id}"]`).classList.contains('folded'), gid.team);
    await page.click(`${groupSel(gid.team)} [data-action="fold"]`);
    await sleep(700);
    const v2 = await viewport(page);
    const folded1 = await page.evaluate((id) => document.querySelector(`[data-sb="group"][data-group="${id}"]`).classList.contains('folded'), gid.team);
    check('화살표: 접힘만 바뀌고 화면은 그대로', folded0 !== folded1 && sameVp(v1, v2), { folded0, folded1, v1, v2 });
    await shot(page, '03-fold-only');
    await page.click(`${groupSel(gid.team)} [data-action="fold"]`); await sleep(300);
    // 한 영역뿐인 폴더 Solo: 그 영역으로
    await page.click(`${groupSel(gid.solo)} [data-role="group-name"]`);
    await sleep(900);
    const v3 = await viewport(page);
    const solo = await visible(page, [key.gamma]);
    check('폴더 Solo: gamma 영역으로', !sameVp(v2, v3) && solo.every((r) => r.found && r.inside), { v3, solo });
    // 빈 폴더: 아무것도 하지 않는다
    await page.click(`${groupSel(gid.empty)} [data-role="group-name"]`);
    await sleep(700);
    const v4 = await viewport(page);
    check('빈 폴더: 화면 그대로', sameVp(v3, v4), { v3, v4 });
    // 폴더 없음 줄: 어느 폴더에도 없는 delta로
    await page.click('[data-sb="group"][data-row="g:"] [data-role="group-name"]');
    await sleep(900);
    const v5 = await viewport(page);
    const none = await visible(page, [key.delta]);
    check('폴더 없음 줄: delta 영역으로', none.every((r) => r.found && r.inside), { v5, none });
    // Enter도 같다(키보드)
    await page.click(`${groupSel(gid.team)} [data-role="group-name"]`); await sleep(900);
    const v6 = await viewport(page);
    await page.click(`[data-sb="ws"][data-ws="${key.delta}"]`); await sleep(900);
    await page.focus('[data-role="sidebar-list"]');
    await page.evaluate((id) => { const el = document.querySelector(`[data-sb="group"][data-group="${id}"]`); el.click(); }, gid.team); await sleep(900);
    const v7 = await viewport(page);
    check('다시 눌러도 같은 자리', sameVp(v6, v7), { v6, v7 });
  } finally { await app.close().catch(() => {}); }
}

async function clean() {
  try { for (const s of sessions()) { try { atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log('끄기 실패', s.name, e.message.slice(0, 160)); } } } catch (e) { log('목록 실패', e.message.slice(0, 160)); }
  try { log('터미널 멈춤', atrium('terminal', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { log('터미널 멈춤 실패', e.message.slice(0, 200)); }
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log('백엔드 멈춤 실패', e.message.slice(0, 200)); }
  for (const d of Object.values(F)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { log('지우기 실패', d, e.message.slice(0, 120)); } }
}

try {
  if (STAGE === 'setup') await setup();
  else if (STAGE === 'shot') await shots();
  else await clean();
} catch (e) { check('예외', false, String(e && (e.stack || e.message)).slice(0, 800)); }
const pass = results.filter((r) => r.ok).length;
log(`결과 ${pass}/${results.length}`);
fs.writeFileSync(path.join(OUT, `p278-${STAGE}-${LANG}.json`), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
process.exit(pass === results.length ? 0 : 1);
