// P31 창 시험: 줌 아웃 얼굴 본문 끌기, 판 전체 정리(영역 다시 놓기와 되돌리기). P35: 워크트리는 리포 영역 안의 상자라 위성 배치와 화살표 단계는 상자 확인으로 바꿨다.
// 판: herdr 세션 atrium-dev-p31, 포트 47849, 이 워크트리의 backend/.dev(experiments/p31/tools/env.cjs). 셸 노드만 쓴다.
// 사용: node experiments/p31/tools/e2e.cjs p31-drag-arrange.mjs [--fresh]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p31') throw new Error('MT_E2E_OUT=p31를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p31', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P31_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p31' || ENV.ATRIUM_PORT !== '47849') throw new Error('P31 판(atrium-dev-p31, 47849)만');
for (const d of [T.REPO, T.WT_A, T.DIR_B, T.DIR_C]) if (!/^C:\\Workspace\\mtask-p31-/.test(d)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p31-*만: ${d}`);
fs.mkdirSync(OUT, { recursive: true });

const log = logger('p31-drag-arrange');
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
if (process.argv.includes('--fresh')) {
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
  await sleep(800);
  for (const d of [path.join(T.DEV, 'data'), path.join(T.DEV, 'app'), T.PROJECTS, T.SESSIONS]) fs.rmSync(d, { recursive: true, force: true });
  if (fs.existsSync(T.WT_A)) { try { git(T.REPO, 'worktree', 'remove', '--force', T.WT_A); } catch {} fs.rmSync(T.WT_A, { recursive: true, force: true }); }
  for (const d of [T.REPO, T.DIR_B, T.DIR_C]) fs.rmSync(d, { recursive: true, force: true });
}
for (const d of [T.PROJECTS, T.SESSIONS, T.DIR_B, T.DIR_C]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(path.join(T.REPO, '.git'))) {
  fs.mkdirSync(T.REPO, { recursive: true });
  git(T.REPO, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(T.REPO, 'README.md'), 'p31 test repo\n');
  git(T.REPO, 'add', '.');
  git(T.REPO, '-c', 'user.email=p31@test', '-c', 'user.name=p31', 'commit', '-q', '-m', 'init');
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
const areaK = `${repoKey}#wt=${keyOf(T.WT_A)}`;
const ids = {};
const rectOf = (name) => page.evaluate((id) => { const r = window.__mt.getState().nodes.get(id); return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null; }, ids[name]);
const dockOfName = (name) => page.evaluate((id) => { const d = [...window.__mt.getState().docks.values()].find((x) => x.members.includes(id)); return d ? d.members : null; }, ids[name]);
const faceOf = (name) => page.$eval(`.mt-node[data-session="${ids[name]}"]`, (e) => e.getAttribute('data-face')).catch(() => null);
const bodyBox = async (name) => (await page.$(`.react-flow__node[data-id="${ids[name]}"] .mt-node-body`)).boundingBox();
// 실제 배율은 React Flow 뷰포트의 transform에서 읽는다(vpNow는 코드로 옮긴 뒤 늦게 바뀔 수 있다)
const zoomNow = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);
// 판 좌표 점(cx, cy)이 화면 가운데 오게, 배율 zoom
async function view(cx, cy, zoom) {
  await page.evaluate(([x, y, z]) => { const st = window.__mt.getState(); const el = document.querySelector('.mt-canvas'); st.setViewport({ x: el.clientWidth / 2 - x * z, y: el.clientHeight / 2 - y * z, zoom: z }); }, [cx, cy, zoom]);
  await sleep(700);
}
// dy: 노드들을 화면 가운데보다 이만큼(화면 px) 위에 둔다(끄는 끝점이 캔버스 가장자리에 닿아 React Flow가 화면을 밀지 않게)
async function viewNodes(names, zoom, dy = 0) { const rs = await Promise.all(names.map(rectOf)); const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)); await view((x0 + x1) / 2, (y0 + y1) / 2 + dy / zoom, zoom); }
// 화면에서 (sx, sy)부터 dx, dy만큼 끈다
const STEPS = 40;
async function drag(sx, sy, dx, dy, { alt = false } = {}) {
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(sx, sy); await page.mouse.down();
  // React Flow는 첫 움직임을 끌기 시작점으로 써서 그 한 걸음(STEPS분의 1)만큼 덜 움직인다(머리줄 끌기도 같다). 걸음을 잘게 둔다
  for (let i = 1; i <= STEPS; i++) { await page.mouse.move(sx + (dx * i) / STEPS, sy + (dy * i) / STEPS); await sleep(15); }
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  await sleep(1300);
}
const spawned = [];
async function spawnShell(cwd, name) {
  log(atrium('spawn', cwd, '--kind', 'shell', '--name', name).trim().split('\n').slice(-1)[0]);
  spawned.push(name);
  ids[name] = await until(() => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }, name), 30000);
}
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
// 판 자리 모음(되돌리기 비교): 노드, 워크스페이스 자리, 워크트리 영역 자리
const layout = () => page.evaluate(() => { const st = window.__mt.getState(); return JSON.stringify({ n: [...st.nodes].map(([id, r]) => [id, Math.round(r.x), Math.round(r.y), r.w, r.h]).sort(), w: st.workspaces.map((w) => [w.key, w.x, w.y, (w.worktrees || []).map((a) => [a.wt, a.x, a.y])]).sort() }); });
const domRects = (sel) => page.$$eval(sel, (es) => es.map((e) => { const r = e.querySelector('.mt-region-box').getBoundingClientRect(); return { id: e.closest('.react-flow__node').getAttribute('data-id'), x: r.x, y: r.y, w: r.width, h: r.height }; }));
const overlapPairs = (rs) => { const out = []; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i], b = rs[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.id}|${b.id}`); } return out; };

try {
  await open();
  await call(page, 'settings.set', { language: 'ko' });
  await call(page, 'workspace.open', { path: T.REPO });
  await page.waitForSelector('.react-flow__node-region');
  for (const n of ['s1', 's2', 's3']) await spawnShell(T.REPO, n);
  log(atrium('dock', 's3', 's2', '--side', 'right').trim().split('\n').slice(-1)[0]);
  await until(async () => ((await dockOfName('s3')) || []).includes(ids.s2), 10000);

  // ---------- 1. 중간 얼굴에서 본문 끌기 ----------
  await viewNodes(['s1', 's2', 's3'], 0.42, 230);
  const faces = await Promise.all(['s1', 's2', 's3'].map(faceOf));
  step('배율 0.42에서 노드가 중간 얼굴(대화 보기)이다', faces.every((f) => f === 'middle'), faces);
  await shot(page, 'p31-1-middle-before');
  let z = await zoomNow();
  // 1a. 혼자인 노드 s1: 본문 가운데를 아래로 끈다
  const r1 = await rectOf('s1');
  const b1 = await bodyBox('s1');
  const down = Math.round((r1.h + 360) * z);
  await drag(b1.x + b1.width / 2, b1.y + b1.height / 2, 0, down);
  const r1b = await rectOf('s1');
  step('중간 얼굴 본문을 끌면 혼자인 노드가 움직인다', near(r1b.y - r1.y, down / z, down / STEPS / z + 4) && near(r1b.x, r1.x, 2), { from: r1, to: r1b, want: Math.round(down / z) });
  // 1b. 덩어리 안 노드 s2 본문을 끌면 덩어리째(s3도)
  const r2 = await rectOf('s2'), r3 = await rectOf('s3');
  const b2 = await bodyBox('s2');
  await drag(b2.x + b2.width / 2, b2.y + b2.height / 2, -80, -60);
  const r2b = await rectOf('s2'), r3b = await rectOf('s3');
  const dd = [r2b.x - r2.x, r2b.y - r2.y];
  step('덩어리 안 노드 본문을 끌면 덩어리째 움직인다', Math.abs(dd[0]) > 50 && near(r3b.x - r3.x, dd[0]) && near(r3b.y - r3.y, dd[1]) && ((await dockOfName('s3')) || []).includes(ids.s2), { s2: dd, s3: [r3b.x - r3.x, r3b.y - r3.y] });
  await shot(page, 'p31-2-middle-dragged');
  // 1c. 멀리 얼굴: Alt+끌기로 s3를 덩어리에서 빼서 s1 오른쪽 가장자리에 붙인다
  await viewNodes(['s1', 's2', 's3'], 0.25);
  z = await zoomNow();
  step('배율 0.25에서 멀리 얼굴(요약)이다', (await faceOf('s3')) === 'far', await faceOf('s3'));
  await shot(page, 'p31-3-far-before');
  const a1 = await rectOf('s1'), a3 = await rectOf('s3');
  const b3 = await bodyBox('s3');
  const tx = (a1.x + a1.w + 12 - a3.x) * z, ty = (a1.y - a3.y) * z;
  await drag(b3.x + b3.width / 2, b3.y + b3.height / 2, tx, ty, { alt: true });
  const d3 = (await dockOfName('s3')) || [];
  const d2 = await dockOfName('s2');
  step('멀리 얼굴에서 Alt+본문 끌기: 덩어리에서 빠지고 다른 노드(s1) 가장자리에 붙는다', d3.includes(ids.s1) && !d3.includes(ids.s2) && !d2, { s3dock: d3.length, withS1: d3.includes(ids.s1), s2dock: d2 });
  await shot(page, 'p31-4-far-alt-snapped');
  // 1d. 누르기만 하면 들어간다(H4): 화면이 그 노드로 가고 초점이 간다
  const zBefore = await zoomNow();
  const b2c = await bodyBox('s2');
  await page.mouse.click(b2c.x + b2c.width / 2, b2c.y + b2c.height / 2);
  await sleep(1200);
  const focus = await page.evaluate(() => window.__mt.getState().focusId);
  const r2c = await rectOf('s2');
  step('끌지 않고 누르면 그 노드로 들어간다(자리는 그대로)', focus === ids.s2 && (await zoomNow()) > zBefore + 0.1 && near(r2c.x, r2b.x) && near(r2c.y, r2b.y), { focus: focus === ids.s2, zoom: [zBefore, await zoomNow()] });
  // 1e. 본문 안 단추는 눌린다: 작은 노드(중간 얼굴, 배율 0.705라 머리줄 단추가 보인다)의 메뉴를 열고 본문 안 메뉴의 "닫기"를 누른다
  log(atrium('size', 's2', 'small').trim().split('\n').slice(-1)[0]);
  await until(async () => (await rectOf('s2')).w === 480, 10000);
  await viewNodes(['s2'], 0.705);
  step('작은 노드는 배율 0.705에서 중간 얼굴', (await faceOf('s2')) === 'middle', await faceOf('s2'));
  await page.click(`.react-flow__node[data-id="${ids.s2}"] [data-action=node-menu]`);
  await sleep(400);
  const menuIn = await page.$(`.react-flow__node[data-id="${ids.s2}"] .mt-node-body [data-role=node-menu]`);
  await shot(page, 'p31-5-button-in-body');
  const r2d = await rectOf('s2');
  const close = await page.$(`.react-flow__node[data-id="${ids.s2}"] [data-action=menu-close]`);
  const cb = close && await close.boundingBox();
  if (cb) await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await sleep(500);
  const menuAfter = await page.$(`.react-flow__node[data-id="${ids.s2}"] [data-role=node-menu]`);
  step('본문 안의 단추(노드 메뉴의 닫기)가 눌리고 노드는 움직이지 않는다', !!menuIn && !!cb && !menuAfter && JSON.stringify(await rectOf('s2')) === JSON.stringify(r2d), { menuIn: !!menuIn, closed: !menuAfter });
  // 1f. 가까이 얼굴(터미널)에서는 본문 끌기가 노드를 옮기지 않는다
  await viewNodes(['s2'], 1);
  await until(async () => (await faceOf('s2')) === 'close', 10000).catch(() => null);
  step('배율 1에서 가까이 얼굴(터미널)이다', (await faceOf('s2')) === 'close', await faceOf('s2'));
  const r2e = await rectOf('s2');
  const b2e = await bodyBox('s2');
  await drag(b2e.x + b2e.width / 2, b2e.y + b2e.height / 2, 150, 90);
  const r2f = await rectOf('s2');
  step('가까이 얼굴에서 본문을 끌어도 노드는 그대로(글자 고르기)', near(r2f.x, r2e.x, 0.5) && near(r2f.y, r2e.y, 0.5), { from: r2e, to: r2f });
  await shot(page, 'p31-6-close-no-move');

  // ---------- 2. 판 전체 정리 ----------
  git(T.REPO, 'worktree', 'add', '-q', '-b', 'feat-p31', T.WT_A);
  await until(() => page.evaluate((k) => { const w = window.__mt.getState().workspaces.find((x) => x.key === k); return w && (w.worktrees || []).length === 1; }, repoKey), 30000, 500);
  await spawnShell(T.WT_A, 'w1');
  await call(page, 'workspace.open', { path: T.DIR_B });
  await call(page, 'workspace.open', { path: T.DIR_C });
  await spawnShell(T.DIR_B, 'b1');
  await spawnShell(T.DIR_C, 'c1');
  await spawnShell(T.DIR_C, 'c2');
  await sleep(1500);
  // 흩어 놓는다: 영역마다 멀리, 워크트리 영역은 리포에서 멀리
  const mv = async (m, p) => { try { await call(page, m, p); } catch (e) { log('옮기기 실패', m, e.message); } };
  const wsB = keyOf(T.DIR_B), wsC = keyOf(T.DIR_C);
  await mv('workspace.move', { workspace: wsB, dx: 7000, dy: -2600 });
  await mv('workspace.move', { workspace: wsC, dx: -5200, dy: 4200 });
  await mv('worktree.move', { workspace: repoKey, worktree: keyOf(T.WT_A), dx: 1500, dy: 5200 });
  await sleep(1500);
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  await sleep(1200);
  const before = await layout();
  const zB = await zoomNow();
  const regsBefore = await domRects('.react-flow__node-region');
  step('정리 전: 영역 셋(리포(안에 워크트리 상자), 폴더 둘)이 흩어져 있다', regsBefore.length === 3, regsBefore.map((r) => [r.id.slice(0, 40), Math.round(r.x), Math.round(r.y)]));
  await shot(page, 'p31-7-arrange-before');
  await page.click('[data-action=chip-arrange]');
  await sleep(2500);
  const regsAfter = await domRects('.react-flow__node-region');
  const main = regsAfter.find((r) => r.id === `ws:${repoKey}`), sat = (await domRects('.react-flow__node-wtarea')).find((r) => r.id === `wa:${areaK}`);
  const spread = (rs) => { const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)); return (x1 - x0) * (y1 - y0); };
  const zA = await zoomNow();
  const areaWorld = (rs, zz) => spread(rs) / (zz * zz);
  step('정리 뒤: 영역끼리 겹치지 않는다', regsAfter.length === 3 && overlapPairs(regsAfter).length === 0, overlapPairs(regsAfter));
  step('정리 뒤: 워크트리 상자는 리포 영역 안(P35)', main && sat && sat.x >= main.x - 1 && sat.y >= main.y - 1 && sat.x + sat.w <= main.x + main.w + 1 && sat.y + sat.h <= main.y + main.h + 1, { main, sat, zoom: zA });
  step('정리 뒤: 덜 흩어진다(영역 전체를 감싸는 넓이가 절반 아래로)', areaWorld(regsAfter, zA) < areaWorld(regsBefore, zB) / 2, { before: Math.round(areaWorld(regsBefore, zB)), after: Math.round(areaWorld(regsAfter, zA)) });
  await shot(page, 'p31-8-arrange-after');
  const undoBtn = await page.$('[data-action=chip-arrange-undo]');
  step('정리 뒤 칩 줄에 "정리 되돌리기"가 보인다', !!undoBtn);
  await page.click('[data-action=chip-arrange-undo]');
  await sleep(2500);
  const restored = await layout();
  step('되돌리기: 노드, 영역, 워크트리 영역 자리가 정리 전 그대로', restored === before, restored === before ? null : { before: JSON.parse(before), after: JSON.parse(restored) });
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  await sleep(1000);
  await shot(page, 'p31-9-arrange-undone');

  // ---------- 3. 워크트리 화살표: P35에서 뺐다(워크트리는 리포 영역 안의 상자). 화살표가 없는지만 본다 ----------
  step('워크트리 화살표가 없다(P35)', (await page.$$('.react-flow__node-wtarrow, .mt-wtarrow')).length === 0);
} catch (e) {
  log('오류', e.stack);
  step('시험이 끝까지 돌았다', false, e.message);
  if (page) await shot(page, 'p31-fail').catch(() => {});
} finally {
  for (const n of spawned) { try { log(atrium('kill', n, '--yes').trim().split('\n').slice(-1)[0]); } catch (e) { log('kill', n, e.message.slice(0, 200)); } }
  if (app) await closeApp(app);
  const pass = results.filter((r) => r.ok).length;
  log(`결과 ${pass}/${results.length}`);
  fs.writeFileSync(path.join(OUT, 'p31-drag-arrange.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  process.exit(pass === results.length ? 0 : 1);
}
