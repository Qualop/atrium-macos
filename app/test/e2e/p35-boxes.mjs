// P35 창 시험: 워크트리를 리포 영역 안의 노란 상자로(화살표 없음). 놓기, 끌기, 정리와 되돌리기, 워크트리 지우기, 옛 바깥 자리 옮기기.
// 판: herdr 세션 atrium-dev-p35, 포트 47853, 이 워크트리의 backend/.dev(experiments/p35/tools/env.cjs). 셸 노드만 쓴다.
// 사용: node experiments/p35/tools/e2e.cjs p35-boxes.mjs [--fresh]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p35') throw new Error('MT_E2E_OUT=p35를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p35', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P35_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p35' || ENV.ATRIUM_PORT !== '47853') throw new Error('P35 판(atrium-dev-p35, 47853)만');
for (const d of [T.REPO, T.WT_A, T.WT_B, T.DIR_B]) if (!/^C:\\Workspace\\mtask-p35-/.test(d)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p35-*만: ${d}`);
fs.mkdirSync(OUT, { recursive: true });

const log = logger('p35-boxes');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', windowsHide: true });
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const shot = async (page, name) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const call = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const keyOf = (p) => p.replace(/\\/g, '/').toLowerCase();

// ---------- 준비 ----------
const removeWorktrees = () => { for (const w of [T.WT_A, T.WT_B]) if (fs.existsSync(w)) { try { git(T.REPO, 'worktree', 'remove', '--force', w); } catch {} fs.rmSync(w, { recursive: true, force: true }); } };
if (process.argv.includes('--fresh')) {
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
  await sleep(800);
  for (const d of [path.join(T.DEV, 'data'), path.join(T.DEV, 'app'), T.PROJECTS, T.SESSIONS]) fs.rmSync(d, { recursive: true, force: true });
  if (fs.existsSync(T.REPO)) removeWorktrees();
  for (const d of [T.REPO, T.DIR_B]) fs.rmSync(d, { recursive: true, force: true });
}
for (const d of [T.PROJECTS, T.SESSIONS, T.DIR_B]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(path.join(T.REPO, '.git'))) {
  fs.mkdirSync(T.REPO, { recursive: true });
  git(T.REPO, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(T.REPO, 'README.md'), 'p35 test repo\n');
  fs.writeFileSync(path.join(T.REPO, '.gitignore'), '.claude/\n');
  git(T.REPO, 'add', '.');
  git(T.REPO, '-c', 'user.email=p35@test', '-c', 'user.name=p35', 'commit', '-q', '-m', 'init');
}

let app = null, page = null;
async function open() {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true)); // P43: 아래 바를 늘 보이게(이 시험은 바를 바로 누른다)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(500);
}
const repoKey = keyOf(path.join(T.REPO, '.git'));
const areaK = (wt) => `${repoKey}#wt=${keyOf(wt)}`;
const ids = {};
const rectOf = (name) => page.evaluate((id) => { const r = window.__mt.getState().nodes.get(id); return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null; }, ids[name]);
// DOM에서 보이는 사각형(화면 px): 영역은 테두리 상자(.mt-region-box), 노드는 노드 상자
const domBox = (flowId) => page.evaluate((fid) => { const e = document.querySelector(`.react-flow__node[data-id="${CSS.escape(fid)}"]`); if (!e) return null; const b = e.querySelector('.mt-region-box') || e; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, flowId);
const domNode = (name) => domBox(ids[name]);
const within = (r, q, pad = 1.5) => !!(r && q) && r.x >= q.x - pad && r.y >= q.y - pad && r.x + r.w <= q.x + q.w + pad && r.y + r.h <= q.y + q.h + pad;
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const counts = () => page.evaluate(() => ({ region: document.querySelectorAll('.react-flow__node-region').length, wtarea: document.querySelectorAll('.react-flow__node-wtarea').length, arrow: document.querySelectorAll('.react-flow__node-wtarrow, .mt-wtarrow').length }));
const zoomNow = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);
const fitRepo = async () => { await page.evaluate((k) => window.__mt.getState().fitWorkspace(k), repoKey); await sleep(900); };
const fitAll = async () => { await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(900); };
async function view(cx, cy, zoom) {
  await page.evaluate(([x, y, z]) => { const st = window.__mt.getState(); const el = document.querySelector('.mt-canvas'); st.setViewport({ x: el.clientWidth / 2 - x * z, y: el.clientHeight / 2 - y * z, zoom: z }); }, [cx, cy, zoom]);
  await sleep(800);
}
async function dragBy(sel, dx, dy) {
  const h = await page.$(sel);
  const b = await h.boundingBox();
  const sx = b.x + Math.min(30, b.width / 2), sy = b.y + b.height / 2;
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let i = 1; i <= 30; i++) { await page.mouse.move(sx + (dx * i) / 30, sy + (dy * i) / 30); await sleep(15); }
  await page.mouse.up();
  await sleep(1500);
}
const spawned = [];
async function spawnShell(cwd, name) {
  log(atrium('spawn', cwd, '--kind', 'shell', '--name', name).trim().split('\n').slice(-1)[0]);
  spawned.push(name);
  ids[name] = await until(() => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }, name), 30000);
}
const areasNow = () => page.evaluate((k) => { const w = window.__mt.getState().workspaces.find((x) => x.key === k); return w ? (w.worktrees || []).map((a) => ({ wt: a.wt, branch: a.branch, x: a.x, y: a.y })) : null; }, repoKey);
const layout = () => page.evaluate(() => { const st = window.__mt.getState(); return JSON.stringify({ n: [...st.nodes].map(([id, r]) => [id, Math.round(r.x), Math.round(r.y), r.w, r.h]).sort(), w: st.workspaces.map((w) => [w.key, w.x, w.y, (w.worktrees || []).map((a) => [a.wt, a.x, a.y]).sort()]).sort() }); });
// 리포 영역 안의 상자 검사(화면 기준): 상자 둘레가 리포 영역 안, 상자끼리·상자와 본 저장소 쪽 노드가 겹치지 않는다
async function boxCheck(mainNames, boxKeys) {
  const reg = await domBox(`ws:${repoKey}`);
  const boxes = await Promise.all(boxKeys.map((k) => domBox(`wa:${k}`)));
  const mains = await Promise.all(mainNames.map(domNode));
  const inside = boxes.every((b) => within(b, reg));
  let clash = false;
  for (let i = 0; i < boxes.length; i++) { for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j])) clash = true; for (const m of mains) if (m && hit(boxes[i], m)) clash = true; }
  return { ok: !!reg && boxes.every(Boolean) && inside && !clash, inside, clash, reg, boxes };
}
const yellow = () => page.evaluate(() => { const n = document.querySelector('.mt-wtarea-name'), b = document.querySelector('.mt-wtarea .mt-region-box'), m = document.querySelector('.mt-wtarea-meta'); if (!n || !b) return null; const cs = (e, p) => getComputedStyle(e)[p]; return { name: cs(n, 'color'), meta: m ? cs(m, 'color') : null, border: cs(b, 'borderTopColor'), bg: cs(b, 'backgroundColor'), fs: n.getBoundingClientRect().height }; });
const isYellow = (c) => /rgba?\(226,\s*178,\s*76/.test(String(c || ''));

try {
  await open();
  await call(page, 'settings.set', { language: 'ko' });
  await call(page, 'workspace.open', { path: T.REPO });
  await call(page, 'workspace.open', { path: T.DIR_B });
  await page.waitForSelector('.react-flow__node-region');
  await spawnShell(T.REPO, 'm1');
  await spawnShell(T.REPO, 'm2');
  await spawnShell(T.DIR_B, 'b1');
  await sleep(1000);
  // 다른 폴더 영역은 리포 오른쪽 멀리 둔다(리포 영역이 커질 자리)
  const [rr, rb] = await page.evaluate(([a, b]) => [window.__mt.getState().regionOf(a), window.__mt.getState().regionOf(b)], [repoKey, keyOf(T.DIR_B)]);
  try { await call(page, 'workspace.move', { workspace: keyOf(T.DIR_B), dx: Math.round(rr.x + rr.w + 3000 - rb.x), dy: Math.round(rr.y - rb.y) }); } catch (e) { log('폴더 옮기기', e.message); }

  // ---------- 1. 워크트리 둘 → 리포 영역 안의 노란 상자 둘, 화살표 없음 ----------
  fs.mkdirSync(path.dirname(T.WT_A), { recursive: true });
  git(T.REPO, 'worktree', 'add', '-q', '-b', 'feat-a', T.WT_A);
  git(T.REPO, 'worktree', 'add', '-q', '-b', 'fix-b', T.WT_B);
  await until(async () => ((await areasNow()) || []).length === 2 && (await counts()).wtarea === 2, 30000, 500);
  await fitRepo();
  const c1 = await counts();
  const bc1 = await boxCheck(['m1', 'm2'], [areaK(T.WT_A), areaK(T.WT_B)]);
  step('워크트리 둘: 리포 영역 안에 상자 둘, 화살표 없음', c1.wtarea === 2 && c1.arrow === 0 && bc1.ok, { counts: c1, ...bc1 });
  const y1 = await yellow();
  step('상자 테두리·바탕·이름표 글자가 노란 계열', y1 && isYellow(y1.name) && isYellow(y1.meta) && isYellow(y1.border) && isYellow(y1.bg), y1);
  await view(...await page.evaluate((k) => { const r = window.__mt.getState().regionOf(k); return [r.x + r.w / 2, r.y + r.h / 2]; }, repoKey), 1);
  await shot(page, 'p35-1-boxes-zoom1');
  const reg0 = await page.evaluate((k) => window.__mt.getState().regionOf(k), repoKey);
  await view(reg0.x + reg0.w / 2, reg0.y + reg0.h / 2, 0.18);
  const yFar = await yellow();
  const cFar = await counts();
  const repoHead = await page.$eval(`.react-flow__node[data-id="ws:${repoKey}"] .mt-region-name`, (e) => e.getBoundingClientRect().height);
  step('줌 아웃(0.18): 상자 이름표가 리포 이름표처럼 읽히는 크기(화면 10px 넘게), 화살표 없음', yFar && yFar.fs >= 10 && cFar.arrow === 0, { boxLabelPx: yFar && Math.round(yFar.fs), repoLabelPx: Math.round(repoHead) });
  await shot(page, 'p35-2-boxes-far');

  // ---------- 2. 워크트리 폴더의 셸은 그 상자 안 ----------
  await spawnShell(T.WT_A, 'wa');
  await spawnShell(T.WT_B, 'wb');
  await sleep(3500); // 새 세션으로 화면이 가는 것이 끝난 뒤에 리포 전체를 본다
  await fitRepo();
  const inA = within(await domNode('wa'), await domBox(`wa:${areaK(T.WT_A)}`)), inB = within(await domNode('wb'), await domBox(`wa:${areaK(T.WT_B)}`));
  const bc2 = await boxCheck(['m1', 'm2'], [areaK(T.WT_A), areaK(T.WT_B)]);
  step('워크트리 폴더에서 띄운 셸은 그 상자 안, 상자는 리포 영역 안', inA && inB && bc2.ok, { inA, inB, ...bc2 });
  await shot(page, 'p35-3-shells-in-boxes');

  // ---------- 3. 상자 이름표를 끌면 안의 노드가 함께, 리포 영역이 감싸도록 맞는다 ----------
  const z3 = await zoomNow();
  const regA = await domBox(`ws:${repoKey}`);
  const boxA = await domBox(`wa:${areaK(T.WT_A)}`);
  const wa0 = await rectOf('wa');
  const a0 = (await areasNow()).find((a) => a.branch === 'feat-a');
  // 리포 영역 아래 빈 곳으로(리포 영역 아래 끝보다 조금 더)
  const ddy = Math.round(regA.y + regA.h - boxA.y + 80 * z3);
  await dragBy(`.react-flow__node[data-id="wa:${areaK(T.WT_A)}"] .mt-wadrag`, 0, ddy);
  const wa1 = await rectOf('wa');
  const a1 = (await areasNow()).find((a) => a.branch === 'feat-a');
  const dWorld = wa1.y - wa0.y;
  await fitRepo();
  const bc3 = await boxCheck(['m1', 'm2'], [areaK(T.WT_A), areaK(T.WT_B)]);
  step('상자를 끌면 안의 셸이 같은 만큼 움직이고 자리를 저장한다', dWorld > 50 && Math.abs((a1.y - a0.y) - dWorld) <= 2 && Math.abs(wa1.x - wa0.x) <= 2, { node: dWorld, area: a1.y - a0.y });
  step('끈 뒤 리포 영역이 상자를 감싸도록 커진다', bc3.ok && bc3.reg.h > 0, bc3);
  await shot(page, 'p35-4-box-dragged');
  // 다른 상자 위로 끌면 되돌린다
  const before4 = await layout();
  const bA = await domBox(`wa:${areaK(T.WT_A)}`), bB = await domBox(`wa:${areaK(T.WT_B)}`);
  await dragBy(`.react-flow__node[data-id="wa:${areaK(T.WT_A)}"] .mt-wadrag`, Math.round(bB.x - bA.x + 20), Math.round(bB.y - bA.y + 20));
  await sleep(800);
  step('상자를 다른 상자 위로 끌면 되돌린다', (await layout()) === before4);

  // ---------- 4. 리포 영역 이름표를 끌면 상자째 ----------
  const before5 = { m1: await rectOf('m1'), wa: await rectOf('wa'), wb: await rectOf('wb'), areas: await areasNow() };
  const z5 = await zoomNow();
  await dragBy(`.react-flow__node[data-id="ws:${repoKey}"] .mt-rdrag`, Math.round(-200 * z5), Math.round(150 * z5));
  const after5 = { m1: await rectOf('m1'), wa: await rectOf('wa'), wb: await rectOf('wb'), areas: await areasNow() };
  const dx5 = after5.m1.x - before5.m1.x, dy5 = after5.m1.y - before5.m1.y;
  const sameD = (a, b) => Math.abs(a.x - b.x - dx5) <= 2 && Math.abs(a.y - b.y - dy5) <= 2;
  step('리포 영역을 끌면 상자와 안의 셸이 함께 움직인다', Math.abs(dx5) > 50 && sameD(after5.wa, before5.wa) && sameD(after5.wb, before5.wb) && after5.areas.every((a) => sameD(a, before5.areas.find((x) => x.wt === a.wt))), { dx5, dy5 });
  await fitRepo();
  await shot(page, 'p35-5-repo-dragged');

  // ---------- 5. 정리(영역 이름표)와 판 전체 정리, 되돌리기 ----------
  const L0 = await layout();
  await page.hover(`.react-flow__node[data-id="ws:${repoKey}"] .mt-rdrag`);
  await sleep(300);
  await page.click(`.react-flow__node[data-id="ws:${repoKey}"] [data-action=arrange]`);
  await sleep(2000);
  await fitRepo();
  const bc6 = await boxCheck(['m1', 'm2'], [areaK(T.WT_A), areaK(T.WT_B)]);
  const waIn6 = within(await domNode('wa'), await domBox(`wa:${areaK(T.WT_A)}`));
  step('영역 정리 뒤에도 상자는 리포 영역 안, 셸은 상자 안', bc6.ok && waIn6, bc6);
  await shot(page, 'p35-6-region-arranged');
  await page.hover(`.react-flow__node[data-id="ws:${repoKey}"] .mt-rdrag`);
  await sleep(300);
  await page.click(`.react-flow__node[data-id="ws:${repoKey}"] [data-action=arrange-undo]`);
  await sleep(2000);
  step('영역 정리 되돌리기: 노드와 상자 자리가 정리 전 그대로', (await layout()) === L0);
  await page.click('[data-action=chip-arrange]');
  await sleep(2500);
  const bc7 = await boxCheck(['m1', 'm2'], [areaK(T.WT_A), areaK(T.WT_B)]);
  const tops = await Promise.all([`ws:${repoKey}`, `ws:${keyOf(T.DIR_B)}`].map(domBox));
  step('판 전체 정리 뒤에도 상자는 리포 영역 안, 맨 위 영역끼리 겹치지 않는다', bc7.ok && tops.every(Boolean) && !hit(tops[0], tops[1]), bc7);
  await shot(page, 'p35-7-board-arranged');
  await page.click('[data-action=chip-arrange-undo]');
  await sleep(2500);
  step('판 전체 정리 되돌리기: 정리 전 그대로', (await layout()) === L0);

  // ---------- 6. 워크트리 하나를 지우면 상자가 없어지고 노드는 본 저장소 쪽으로 ----------
  // feat-a 워크트리를 git에서 지운다. 그 셸(wa)이 폴더를 쥐고 있어 폴더째 지우지 못하므로 .git 파일을 지우고 prune한다(git worktree list에서 빠진다)
  fs.rmSync(path.join(T.WT_A, '.git'), { force: true });
  git(T.REPO, 'worktree', 'prune');
  await until(async () => (await counts()).wtarea === 1, 30000, 500);
  await sleep(2500);
  await fitRepo();
  const waArea = await page.evaluate((id) => (window.__mt.getState().nodes.get(id) || {}).area, ids.wa);
  const waInMain = within(await domNode('wa'), await domBox(`ws:${repoKey}`));
  const bc8 = await boxCheck(['m1', 'm2', 'wa'], [areaK(T.WT_B)]);
  step('워크트리 하나를 지우면 그 상자가 없어지고 그 셸은 본 저장소 쪽으로(남은 상자와 겹치지 않는다)', (await counts()).wtarea === 1 && !(await domBox(`wa:${areaK(T.WT_A)}`)) && (waArea || '') === '' && waInMain && bc8.ok, { waArea, waInMain, ...bc8 });
  await shot(page, 'p35-8-one-removed');

  // ---------- 7. 옛 바깥 자리(P27~P34 위성)로 켜면 안으로 옮겨진다 ----------
  const old = await page.evaluate(([k, wt]) => {
    const st = window.__mt.getState();
    const mainIds = [...st.sessions.values()].filter((s) => s.workspaceKey === k && !(st.nodes.get(s.sessionId) || {}).area).map((s) => st.nodes.get(s.sessionId)).filter(Boolean);
    const x1 = Math.max(...mainIds.map((r) => r.x + r.w)), y0 = Math.min(...mainIds.map((r) => r.y));
    const a = st.workspaces.find((w) => w.key === k).worktrees.find((q) => q.wt === wt);
    return { target: { x: x1 + 40 + 200, y: y0 - 112 }, now: { x: a.x, y: a.y } };
  }, [repoKey, keyOf(T.WT_B)]);
  const wb7 = await rectOf('wb');
  await closeApp(app); app = null;
  log(atrium('backend', 'stop').trim());
  await sleep(1500);
  {
    const db = new DatabaseSync(path.join(ENV.ATRIUM_DATA_DIR, 'board.db'));
    // 상자 안이 비어 있지 않으므로 상자 자리(x, y)와 안의 노드를 같은 만큼 옮겨 옛 위성 자리(리포 오른쪽 WT_GAP 200)를 흉내 낸다
    const box = db.prepare('SELECT x, y FROM worktree_areas WHERE workspace_key = ? AND wt_key = ?').get(repoKey, keyOf(T.WT_B));
    const n = db.prepare('SELECT x, y FROM nodes WHERE area = ?').get(keyOf(T.WT_B));
    const dx = Math.round(old.target.x - (n.x - 40)), dy = Math.round(old.target.y - (n.y - 112)) ;
    db.prepare('UPDATE worktree_areas SET x = x + ?, y = y + ? WHERE workspace_key = ? AND wt_key = ?').run(dx + 1500, dy, repoKey, keyOf(T.WT_B));
    db.prepare('UPDATE nodes SET x = x + ?, y = y + ? WHERE area = ?').run(dx + 1500, dy, keyOf(T.WT_B));
    db.prepare("DELETE FROM meta WHERE key = 'boxesInside'").run();
    log('옛 자리로 바꿈', JSON.stringify({ box, dx: dx + 1500, dy }));
    db.close();
  }
  await open();
  await until(async () => (await counts()).wtarea === 1, 40000, 500);
  await sleep(1500);
  await fitRepo();
  const wb8 = await rectOf('wb');
  const bc9 = await boxCheck(['m1', 'm2', 'wa'], [areaK(T.WT_B)]);
  const wbIn = within(await domNode('wb'), await domBox(`wa:${areaK(T.WT_B)}`));
  step('옛 바깥 자리(리포 영역 오른쪽 멀리)로 켜면 상자가 리포 영역 안으로 옮겨진다(안의 셸도 함께)', bc9.ok && wbIn && Math.abs(wb8.x - wb7.x) < 1500, { ...bc9, wbIn, wb7, wb8 });
  await shot(page, 'p35-9-migrated');
  const L9 = await layout();
  await closeApp(app); app = null;
  log(atrium('backend', 'stop').trim());
  await sleep(1500);
  await open();
  await until(async () => (await counts()).wtarea === 1, 40000, 500);
  await sleep(1500);
  step('다시 켜도 같은 자리(옮기기는 한 번만)', (await layout()) === L9);
} catch (e) {
  log('오류', e.stack);
  step('시험이 끝까지 돌았다', false, e.message);
  if (page) await shot(page, 'p35-fail').catch(() => {});
} finally {
  for (const n of spawned) { try { log(atrium('kill', n, '--yes').trim().split('\n').slice(-1)[0]); } catch (e) { log('kill', n, e.message.slice(0, 200)); } }
  if (app) await closeApp(app);
  const pass = results.filter((r) => r.ok).length;
  log(`결과 ${pass}/${results.length}`);
  fs.writeFileSync(path.join(OUT, 'p35-boxes.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  process.exit(pass === results.length ? 0 : 1);
}
