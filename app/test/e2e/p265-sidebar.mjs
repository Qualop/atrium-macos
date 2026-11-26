// P265 창 시험: 왼쪽 사이드바에서 접힌 그룹·워크스페이스 아래에 실행 중(작업 중·응답 필요)인 세션만 줄로 보인다.
// 판: 터미널 세션 atrium-dev-p265, 포트 48015, 이 워크트리의 backend/.dev(data, app). 창의 원격 디버깅 포트 9496.
// 장면(새 폴더 C:\\Workspace\\mtask-p265-*, git 아님, 셸만 띄운다): 워크스페이스 셋(그룹 Team에 alpha·beta, 그룹 없음 gamma).
//   작업 중·응답 필요·잠듦·쉼은 창 안에서만 흉내 낸다(session.updated).
// 단계: setup | shot <ko|en> | clean. 결과는 experiments/p265/(git 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [STAGE = 'shot', LANG = 'ko'] = process.argv.slice(2);
if (!['setup', 'shot', 'clean'].includes(STAGE)) throw new Error('단계: setup | shot | clean');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p265');
const CONVOS = path.join(DEV, 'p265-projects');
const BOARD = { session: 'atrium-dev-p265', port: 48015, cdp: 9496 };
const ENV = {
  ATRIUM_TERMINAL_SESSION: BOARD.session, ATRIUM_HERDR_SESSION: BOARD.session, ATRIUM_PORT: String(BOARD.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_CLAUDE_SESSIONS: path.join(DEV, 'p265-claude-sessions'),
  ATRIUM_TEST_PREFIX: 'mtask-p265-x', MT_E2E_OUT: 'p265',
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_|MT_HERDR)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)) delete process.env[k];
Object.assign(process.env, ENV);
for (const d of [OUT, CONVOS, ENV.ATRIUM_CLAUDE_SESSIONS]) fs.mkdirSync(d, { recursive: true });
const { logger, sleep, until, APP_ROOT } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const log = logger(`p265-${STAGE}-${LANG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 180000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const sessions = () => call('session.list');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };

const W = 'C:\\Workspace';
const F = { alpha: `${W}\\mtask-p265-alpha`, beta: `${W}\\mtask-p265-beta`, gamma: `${W}\\mtask-p265-gamma` };
for (const d of Object.values(F)) if (!/^C:\\Workspace\\mtask-p265-[a-z]+$/.test(d)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p265-*만: ${d}`);
const LIVE = [['alpha-build', 'alpha'], ['alpha-notes', 'alpha'], ['beta-review', 'beta'], ['beta-idle', 'beta'], ['beta-tests', 'beta'], ['gamma-run', 'gamma'], ['gamma-sleep', 'gamma'], ['gamma-idle', 'gamma']];
const SCENE = path.join(OUT, 'scene.json');

async function setup() {
  log('백엔드', atrium('backend', 'start').trim().slice(0, 200));
  for (const s of sessions()) { try { atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log('옛 세션 끄기 실패', s.name, e.message.slice(0, 120)); } }
  for (const d of Object.values(F)) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'README.md'), `# ${path.basename(d)}\n`); }
  const key = {};
  for (const [k, d] of Object.entries(F)) { const r = call('workspace.open', { path: d, select: false }); key[k] = r.workspace.key; log('워크스페이스', k, r.workspace.key); }
  for (const [name, ws] of LIVE) { const r = call('session.spawn', { cwd: F[ws], kind: 'shell', name }); log('띄움', name, r.sessionId); }
  await until(() => { const s = sessions(); return LIVE.every(([n]) => s.some((x) => x.name === n && /shell_/.test(x.state))); }, 120000, 1500).catch(() => log('셸 준비 기다림 넘김'));
  let gid = null;
  try { const g = call('group.create', { name: 'Team', workspaces: [key.alpha] }); gid = g.created; call('group.move', { workspace: key.beta, group: gid, index: null }); } catch (e) { log('그룹 실패', e.message.slice(0, 160)); }
  fs.writeFileSync(SCENE, JSON.stringify({ key, gid }, null, 1));
  check('장면: 워크스페이스 셋, 세션 여덟', sessions().length === LIVE.length, { sessions: sessions().length });
}

const FAKE = {
  'alpha-build': { state: 'working' }, 'alpha-notes': { state: 'ready' },
  'beta-review': { state: 'waiting', ask: { kind: 'permission', tool: 'Bash', summary: 'npm run deploy' } }, 'beta-idle': { state: 'ready' }, 'beta-tests': { state: 'working' },
  'gamma-run': { state: 'working' }, 'gamma-sleep': { state: 'sleeping' }, 'gamma-idle': { state: 'ready' },
};
async function fake(page) {
  await page.evaluate((FK) => {
    const st = window.__mt.getState();
    const now = Date.now();
    let i = 0;
    for (const s of st.sessions.values()) {
      const f = FK[s.name];
      if (!f) continue;
      window.__mt.api.emit('session.updated', { ...s, kind: 'claude', state: f.state, ask: f.ask ? { ...f.ask, since: now - 90000 } : null, error: null, unseen: false, lastActivityAt: now - (++i * 47000) });
    }
  }, FAKE);
  await sleep(400);
}
const sideRect = (page) => page.evaluate(() => { const r = document.querySelector('[data-role="sidebar"]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(Math.min(r.height, 520)) }; });
const shotSide = async (page, name) => { const clip = await sideRect(page); const f = path.join(OUT, `${LANG}-${name}.png`); await page.screenshot({ path: f, clip }); log('스크린숏', path.relative(REPO, f)); };
const rowsOf = (page) => page.evaluate(() => [...document.querySelectorAll('[data-role="sidebar-rows"] [data-row]')].map((r) => ({ id: r.dataset.row, sb: r.dataset.sb || r.dataset.action || null, name: r.dataset.name || null, pinned: r.dataset.pinned === '1', pinws: r.dataset.pinws || null, text: r.innerText.replace(/\s+/g, ' ').trim().slice(0, 80) })));
const scene = () => JSON.parse(fs.readFileSync(SCENE, 'utf8'));
const groupFold = () => `[data-sb="group"][data-group="${scene().gid}"] [data-action="fold"]`;
const wsFold = (k) => `[data-sb="ws"][data-ws="${scene().key[k]}"] [data-action="fold"]`;
const click = async (page, sel) => { const el = await page.waitForSelector(sel, { timeout: 10000 }); await el.click(); await sleep(300); };

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
  const { app, page } = await openWindow();
  try {
    if (!(await page.$('[data-role="sidebar"]'))) await page.keyboard.press('Control+Shift+E');
    await page.waitForSelector('[data-role="sidebar"]');
    await sleep(1500);
    await fake(page);
    await page.mouse.move(1000, 500);
    const open = await rowsOf(page);
    log('펼침', JSON.stringify(open.map((r) => `${r.sb}:${r.text}`)));
    check('펼친 상태: 모든 세션, 고정 줄 없음', open.filter((r) => r.sb === 'session').length === 8 && !open.some((r) => r.pinned), open.length);
    await shotSide(page, '01-open');
    // 접힌 워크스페이스(gamma): 작업 중만, 잠듦·쉼 없음
    await click(page, wsFold('gamma'));
    await page.mouse.move(1000, 500); await sleep(200);
    const g1 = await rowsOf(page);
    const gPinned = g1.filter((r) => r.pinned).map((r) => r.name);
    check('접힌 워크스페이스 아래 작업 중만', gPinned.join() === 'gamma-run' && !g1.some((r) => r.name === 'gamma-sleep' || r.name === 'gamma-idle'), gPinned);
    await shotSide(page, '02-ws-folded');
    // 접힌 그룹(Team): 응답 필요·작업 중, 워크스페이스 이름, 안의 접힌 워크스페이스(beta)도 한 번만
    await click(page, wsFold('beta'));
    await click(page, groupFold());
    await page.mouse.move(1000, 500); await sleep(200);
    const g2 = await rowsOf(page);
    log('접힘', JSON.stringify(g2.map((r) => `${r.sb}:${r.text}${r.pinws ? ' [' + r.pinws + ']' : ''}`)));
    const tp = g2.filter((r) => r.pinned);
    const names = tp.map((r) => r.name);
    check('접힌 그룹 아래 응답 필요·작업 중만, 한 번씩', names.length === 4 && ['beta-review', 'alpha-build', 'beta-tests', 'gamma-run'].every((n) => names.filter((x) => x === n).length === 1) && names[0] === 'beta-review', names);
    check('접힌 그룹 세션에 워크스페이스 이름', tp.filter((r) => r.name !== 'gamma-run').every((r) => r.pinws), tp.map((r) => r.pinws));
    check('쉬는 세션은 없다', !g2.some((r) => ['alpha-notes', 'beta-idle', 'gamma-idle', 'gamma-sleep'].includes(r.name)));
    await shotSide(page, '03-group-folded');
    // 누르기: 판의 그 세션으로 이동(초점)
    await click(page, '[data-sb="session"][data-name="alpha-build"]');
    await sleep(600);
    const foc = await page.evaluate(() => { const st = window.__mt.getState(); const s = [...st.sessions.values()].find((x) => x.name === 'alpha-build'); return st.focusId === s.sessionId; });
    check('고정 줄을 누르면 그 세션으로 간다', foc);
    // 거르기(작업 중 칩): 접힘을 무시하고 맞는 것만. 누른 셸은 진짜 상태(shell_idle)가 다시 오므로 흉내를 다시 넣는다
    await fake(page);
    await click(page, '[data-action="state-chip"][data-bucket="working"]').catch((e) => log('칩 없음', e.message.slice(0, 120)));
    await page.mouse.move(1000, 500); await sleep(200);
    await sleep(300);
    const f1 = await rowsOf(page);
    // 셸은 진짜 상태가 끼어들 수 있으므로 기대값은 같은 때 창의 상태에서 센다
    const want = await page.evaluate(() => [...window.__mt.getState().sessions.values()].filter((s) => ['working', 'shell_running', 'starting'].includes(s.state)).map((s) => s.name).sort());
    const got = f1.filter((r) => r.sb === 'session').map((r) => r.name).sort();
    check('작업 중 거르기: 작업 중인 세션만, 고정 줄 아님', got.length >= 1 && got.join() === want.join() && !f1.some((r) => r.pinned), { got, want });
    await shotSide(page, '04-filter-working');
    await click(page, '[data-action="clear-filters"]').catch(() => {});
    // 되돌린다
    for (const s of [groupFold(), wsFold('beta'), wsFold('gamma')]) await click(page, s).catch(() => {});
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
fs.writeFileSync(path.join(OUT, `p265-${STAGE}-${LANG}.json`), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
process.exit(pass === results.length ? 0 : 1);
