// P68 창 시험: 같은 리포의 워크트리끼리 붙여 묶기. 리드 하나(claude haiku)가 atrium child로 워커 셋(claude haiku)을 워크트리 셋에 띄운다.
// Ctrl+끌기로 둘 붙이기, 셋을 골라 배치 틀, 리드 메뉴의 "워커를 창 그룹으로 묶기", 칸마다 브랜치, 떼기, 백엔드를 다시 켠 뒤 그대로.
// 판: herdr 세션 atrium-dev-p68, 포트 47895, 이 워크트리의 backend/.dev(experiments/p68/tools/env.cjs).
// 시험 저장소는 새로 만든 git 저장소라 신뢰를 받지 않았다. 세션은 신뢰 질문에서 멈춘 채로 두고 답하지 않는다(CLAUDE.md). 판 배치만 본다.
// 워커는 리드의 세션 설정 파일의 env(ATRIUM_SESSION_ID, ATRIUM_SESSION_TOKEN)로 atrium child를 불러 만든다(리드가 칠 명령과 같은 길, POST /branch/child).
// --worktree는 신뢰 관문(P36)으로 가므로 git worktree add로 만든 워크트리 폴더를 --cwd로 준다(claude -w가 만드는 것과 같은 .claude/worktrees/<이름>).
// 사용: node experiments/p68/tools/e2e.cjs p68-dock-worktrees.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p68') throw new Error('MT_E2E_OUT=p68를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p68', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P68_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p68' || ENV.ATRIUM_PORT !== '47895') throw new Error('P68 판(atrium-dev-p68, 47895)만');
for (const d of [T.REPO, ...T.WTS]) if (!/^C:\\Workspace\\mtask-p68-/.test(d)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p68-*만: ${d}`);
fs.mkdirSync(OUT, { recursive: true });

const log = logger('p68-dock-worktrees');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const shot = async (name) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const keyOf = (p) => p.replace(/\\/g, '/').toLowerCase();
const repoKey = keyOf(path.join(T.REPO, '.git'));
const boxKey = (i) => `${repoKey}#wt=${keyOf(T.WTS[i])}`;
const WORKERS = ['w1', 'w2', 'w3'];

let app = null, page = null;
async function open() {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(800);
}
const sid = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? s.sessionId : null; }, name);
const rectOf = (name) => page.evaluate((n) => { const st = window.__mt.getState(); const s = [...st.sessions.values()].find((x) => x.name === n); const r = s && st.nodes.get(s.sessionId); return r ? { x: r.x, y: r.y, w: r.w, h: r.h, area: r.area } : null; }, name);
const dockOfName = (name) => page.evaluate((n) => { const st = window.__mt.getState(); const s = [...st.sessions.values()].find((x) => x.name === n); if (!s) return null; const d = [...st.docks.values()].find((x) => x.members.includes(s.sessionId)); return d ? { dockId: d.dockId, names: d.members.map((m) => st.sessions.get(m)?.name).sort() } : null; }, name);
const boxesShown = () => page.evaluate(() => [...document.querySelectorAll('.react-flow__node-wtarea')].map((e) => e.getAttribute('data-id').replace(/^wa:/, '')).sort());
const branchChips = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.mt-node')].map((e) => { const c = e.querySelector('[data-role=dock-branch]'); return [e.dataset.name, c ? { branch: c.dataset.branch, wt: c.classList.contains('wt'), color: getComputedStyle(c).color } : null]; })));
const domBox = (fid) => page.evaluate((id) => { const e = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`); if (!e) return null; const b = e.querySelector('.mt-region-box') || e; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, fid);
const within = (r, q, pad = 1.5) => !!(r && q) && r.x >= q.x - pad && r.y >= q.y - pad && r.x + r.w <= q.x + q.w + pad && r.y + r.h <= q.y + q.h + pad;
const bboxOf = (rs) => { const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)); return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 }; };
async function frame(rect, margin = 200) {
  await page.evaluate(([r, m]) => window.__mt.getState().navigateToRect({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }, 0), [rect, margin]);
  await sleep(700);
}
const fitRepo = async () => { await page.evaluate((k) => window.__mt.getState().fitWorkspace(k), repoKey); await sleep(900); };
const toScreen = (p) => page.evaluate((pt) => {
  const r = document.querySelector('.mt-canvas').getBoundingClientRect();
  const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
  return { x: r.left + m.e + pt.x * m.a, y: r.top + m.f + pt.y * m.a };
}, p);
async function ctrlDrag(name, to) {
  const head = await page.locator(`.mt-node[data-name="${name}"] .mt-node-head`).boundingBox();
  const x0 = head.x + Math.min(120, head.width / 3), y0 = head.y + head.height / 2;
  const end = await toScreen(to);
  await page.mouse.move(x0, y0);
  await page.keyboard.down('Control');
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) { await page.mouse.move(x0 + ((end.x - x0) * i) / 16, y0 + ((end.y - y0) * i) / 16); await sleep(16); }
  await sleep(300);
  const ghost = await page.evaluate(() => { const g = document.querySelector('[data-role=dock-ghost]'); return g ? { kind: g.dataset.kind, side: g.dataset.side } : null; });
  await shot('p68-2-ctrl-drag-preview');
  await page.mouse.up();
  await page.keyboard.up('Control');
  await sleep(1500);
  return ghost;
}
async function ctrlClick(name) {
  const head = await page.locator(`.mt-node[data-name="${name}"] .mt-node-head`).boundingBox();
  await page.keyboard.down('Control');
  await page.mouse.click(head.x + Math.min(120, head.width / 3), head.y + head.height / 2);
  await page.keyboard.up('Control');
  await sleep(300);
}
// 워커 크기를 보통으로(Ctrl+끌기로 반을 나눈 뒤 떼면 반 크기로 남아 아이콘 얼굴이 될 수 있다)
const normalSize = async () => { for (const n of WORKERS) if (!(await dockOfName(n))) await call('board.setSize', { session: await sid(n), size: 'normal' }); await sleep(1200); };
const clearSel = () => page.evaluate(() => { const st = window.__mt.getState(); if (st.clearSelection) st.clearSelection(); });
// 덩어리 모양: 구성 노드가 틈 없이 bbox를 채우고 서로 겹치지 않는다
const tiles = (rs) => {
  const a = rs.reduce((x, r) => x + r.w * r.h, 0), b = bboxOf(rs);
  return Math.abs(a - b.w * b.h) < 4 && !rs.some((p, i) => rs.some((q, j) => j > i && p.x < q.x + q.w - 1 && q.x < p.x + p.w - 1 && p.y < q.y + q.h - 1 && q.y < p.y + p.h - 1));
};
const regionOf = (k) => domBox(`ws:${k}`);
const allInRepo = async (names) => { const reg = await regionOf(repoKey); for (const n of names) { const id = await sid(n); if (!within(await domBox(id), reg)) return false; } return true; };

// ---------- 준비: 리드와 워커 셋 ----------
for (const d of [T.PROJECTS, T.SESSIONS]) fs.mkdirSync(d, { recursive: true });
for (const w of T.WTS) if (!fs.existsSync(w)) throw new Error(`워크트리가 없다: ${w}`);
await open();
try {
  if (!(await sid('lead'))) log(atrium('spawn', T.REPO, '--name', 'lead', '--model', 'haiku').trim().split('\n').slice(-3).join(' | '));
  await until(async () => !!(await sid('lead')), 60000);
  const leadId = await sid('lead');
  const settings = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'sessions', `${leadId}.json`), 'utf8'));
  const leadEnv = { ...env, ...Object.fromEntries(Object.entries(settings.env || {}).filter(([k]) => k.startsWith('ATRIUM_'))) };
  if (leadEnv.ATRIUM_SESSION_ID !== leadId || !leadEnv.ATRIUM_SESSION_TOKEN) throw new Error('리드 설정 파일에 세션 env가 없다');
  for (const [i, n] of WORKERS.entries()) {
    if (await sid(n)) continue;
    const out = execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), 'child', n, '--cwd', T.WTS[i].replace(/\\/g, '/'), '--model', 'haiku', '--no-wait', '--json'], { encoding: 'utf8', env: leadEnv, timeout: 120000 });
    log(`atrium child ${n}`, out.trim().slice(0, 300));
  }
  await until(async () => (await Promise.all(WORKERS.map(sid))).every(Boolean), 90000);
  for (const dk of await call('dock.list')) await call('dock.remove', { dock: dk.dockId }); // 다시 돌릴 때: 지난 덩어리를 푼다
  await call('worktree.sync');
  await until(async () => (await Promise.all(WORKERS.map(rectOf))).every((r) => r && r.area), 60000);
  await normalSize();
  await sleep(1500);
  await fitRepo();
  const shown0 = await boxesShown();
  step('준비: 워커 셋이 각자 워크트리 상자에', shown0.length === 3 && (await Promise.all(WORKERS.map(async (n, i) => within(await domBox(await sid(n)), await domBox(`wa:${boxKey(i)}`))))).every(Boolean), { shown0 });
  const parents = await page.evaluate(() => [...window.__mt.getState().sessions.values()].map((s) => [s.name, s.branch && s.branch.parentName, s.git && s.git.branch, s.state]));
  log('세션', parents);
  await shot('p68-1-before');

  // ---------- 1. Ctrl+끌기로 둘 붙이기 ----------
  let r1 = await rectOf('w1'), r2 = await rectOf('w2');
  await frame(bboxOf([r1, r2]), 160);
  const ghost = await ctrlDrag('w2', { x: r1.x + r1.w * 0.88, y: r1.y + r1.h / 2 });
  let d = await dockOfName('w2');
  step('Ctrl+끌기: 다른 워크트리 w2를 w1에 붙인다', d && d.names.join() === 'w1,w2', { ghost, dock: d });
  await fitRepo();
  let shown = await boxesShown();
  step('붙인 둘의 상자는 숨고 w3 상자는 그대로', shown.length === 1 && shown[0] === boxKey(2), { shown });
  step('덩어리는 리포 영역 안', await allInRepo(['w1', 'w2']));
  r1 = await rectOf('w1'); r2 = await rectOf('w2');
  await frame(bboxOf([r1, r2]), 120);
  let chips = await branchChips();
  const edgesNow = await page.evaluate(() => document.querySelectorAll('.react-flow__edge-repo').length);
  step('덩어리 안 워크트리 세션에 같은 저장소 선을 긋지 않는다', edgesNow === 0, { edgesNow });
  step('칸마다 브랜치(노란색)', chips.w1 && chips.w1.branch === 'worktree-w1' && chips.w1.wt && chips.w2 && chips.w2.branch === 'worktree-w2' && chips.w2.wt && !chips.w3 && !chips.lead, chips);
  step('저장한 워크트리 정보는 그대로', (await rectOf('w1')).area === keyOf(T.WTS[0]) && (await rectOf('w2')).area === keyOf(T.WTS[1]));
  await shot('p68-3-docked-two');

  // ---------- 2. 떼기(노드 메뉴) ----------
  await page.click('.mt-node[data-name="w2"] [data-action=node-menu]');
  await sleep(300);
  await page.click('.mt-node[data-name="w2"] [data-action=undock]');
  await sleep(1500);
  await fitRepo();
  shown = await boxesShown();
  step('떼면 w2는 자기 상자로, w1도 혼자 남아 자기 상자로', !(await dockOfName('w1')) && shown.length === 3
    && within(await domBox(await sid('w1')), await domBox(`wa:${boxKey(0)}`)) && within(await domBox(await sid('w2')), await domBox(`wa:${boxKey(1)}`)), { shown });
  await shot('p68-4-undocked');

  // ---------- 3. 셋을 골라 배치 틀 ----------
  await normalSize();
  await fitRepo();
  await clearSel();
  for (const n of WORKERS) await ctrlClick(n);
  const sel = await page.evaluate(() => window.__mt.getState().selected.length);
  if (await page.isVisible('[data-role=selection] [data-action=layout-more]') && !(await page.isVisible('[data-role=selection] [data-role=presets] [data-preset]'))) { await page.click('[data-role=selection] [data-action=layout-more]'); await sleep(300); }
  await shot('p68-5-select-three');
  await page.click('[data-role=selection] [data-preset="main-left"]');
  await sleep(1800);
  await clearSel();
  d = await dockOfName('w1');
  await fitRepo();
  shown = await boxesShown();
  const rs3 = await Promise.all(WORKERS.map(rectOf));
  step('배치 틀(1 + 2): 셋이 한 덩어리, 상자 셋 모두 숨김, 리포 영역 안', sel === 3 && d && d.names.join() === 'w1,w2,w3' && shown.length === 0 && tiles(rs3) && (await allInRepo(WORKERS)), { sel, d, shown });
  await frame(bboxOf(rs3), 120);
  chips = await branchChips();
  step('칸마다 다른 브랜치', WORKERS.every((n) => chips[n] && chips[n].branch === `worktree-${n}` && chips[n].wt), chips);
  await shot('p68-6-preset-three');

  // 덩어리 통째로 풀기(창 그룹 지우기) → 셋 모두 자기 상자로
  await call('dock.remove', { dock: d.dockId });
  await sleep(1500);
  await fitRepo();
  shown = await boxesShown();
  step('덩어리를 풀면 셋 모두 자기 상자로', shown.length === 3 && (await Promise.all(WORKERS.map(async (n, i) => within(await domBox(await sid(n)), await domBox(`wa:${boxKey(i)}`))))).every(Boolean), { shown });

  // ---------- 4. 리드 메뉴의 "워커를 창 그룹으로 묶기" ----------
  const lr = await rectOf('lead');
  await frame(lr, 120);
  await page.click('.mt-node[data-name="lead"] [data-action=node-menu]');
  await sleep(300);
  await shot('p68-7-lead-menu');
  await page.click('.mt-node[data-name="lead"] [data-action=dock-workers]');
  await sleep(1800);
  d = await dockOfName('w1');
  await fitRepo();
  shown = await boxesShown();
  const rsW = await Promise.all(WORKERS.map(rectOf));
  step('워커 붙여 묶기: 셋이 가로 셋으로, 리드는 빠짐, 상자 숨김', d && d.names.join() === 'w1,w2,w3' && !(await dockOfName('lead')) && shown.length === 0 && tiles(rsW) && rsW.every((r) => r.y === rsW[0].y) && (await allInRepo([...WORKERS, 'lead'])), { d, shown });
  await shot('p68-8-workers-docked');
  await frame(bboxOf(rsW), 120);
  await shot('p68-9-workers-branches');
  const before = { rects: rsW, dockId: d.dockId, shown };

  // ---------- 5. 백엔드를 다시 켠 뒤 그대로 ----------
  log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 200));
  await sleep(1500);
  log('백엔드 시작', atrium('backend', 'start').trim().split('\n').slice(0, 3).join(' '));
  await until(() => page.evaluate(() => window.__mt.getState().boardLoaded && window.__mt.getState().sessions.size >= 4), 90000);
  await page.evaluate(() => window.__mt.api.emit('board.changed', { why: 'p68 restart check' }));
  await sleep(2500);
  await call('worktree.sync');
  await sleep(1000);
  d = await dockOfName('w1');
  await fitRepo();
  shown = await boxesShown();
  const after = await Promise.all(WORKERS.map(rectOf));
  step('다시 켠 뒤: 같은 덩어리, 같은 자리, 상자는 여전히 숨김', d && d.dockId === before.dockId && d.names.join() === 'w1,w2,w3' && shown.length === 0 && JSON.stringify(after.map(({ x, y, w, h }) => [x, y, w, h])) === JSON.stringify(before.rects.map(({ x, y, w, h }) => [x, y, w, h])), { d, shown });
  await frame(bboxOf(after), 120);
  chips = await branchChips();
  step('다시 켠 뒤: 칸마다 브랜치', WORKERS.every((n) => chips[n] && chips[n].branch === `worktree-${n}`), chips);
  await shot('p68-10-after-restart');
  await fitRepo();
  await shot('p68-11-after-restart-repo');
} catch (e) {
  step('예외', false, e.stack);
  try { await shot('p68-error'); } catch {}
} finally {
  fs.writeFileSync(path.join(OUT, 'p68-results.json'), JSON.stringify(results, null, 2));
  log('결과', `${results.filter((r) => r.ok).length}/${results.length}`);
  await closeApp(app);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
