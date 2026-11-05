// P37 창 시험: 판에 연 폴더가 git 저장소가 되어도 영역이 하나로 남는다.
// 판: herdr 세션 atrium-dev-p37, 포트 47855, 이 워크트리의 backend/.dev(experiments/p37/tools/env.cjs). 셸 노드만 쓴다.
// 사용: node experiments/p37/tools/e2e.cjs p37-merge.mjs <단계> [--fresh]
//   repro  — 고치기 전 코드로 돌려 갈라짐을 재현한다(폴더 열기·셸 둘·메모·대화 노드 → git init → 커밋 → 같은 폴더 셸 → 형제 폴더 워크트리 셸). 갈라진 판(board.db)이 남는다
//   fix    — 남은 갈라진 판으로 새 코드의 백엔드를 다시 켠다. 하나로 합쳐지고, 메모·대화 노드가 그 영역 안, 앞의 세션을 다시 띄워도 그 영역
//   flow   — 새 코드로 repro와 같은 순서를 처음부터. 끝에 영역 하나(앞·뒤 세션, 형제 폴더 워크트리 상자, 저장소 안 워크트리 상자, 메모, 대화 노드)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p37') throw new Error('MT_E2E_OUT=p37를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p37', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P37_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p37' || ENV.ATRIUM_PORT !== '47855') throw new Error('P37 판(atrium-dev-p37, 47855)만');
for (const d of [T.DIR_A, T.WT_1, T.WT_X, T.DIR_B]) if (!/^C:\\Workspace\\mtask-p37-/.test(d)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p37-*만: ${d}`);
const PHASE = process.argv[2];
if (!['repro', 'fix', 'flow'].includes(PHASE)) throw new Error('단계: repro | fix | flow');
fs.mkdirSync(OUT, { recursive: true });

const log = logger(`p37-${PHASE}`);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=p37@test', '-c', 'user.name=p37', ...a], { encoding: 'utf8', windowsHide: true });
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail === undefined ? '' : JSON.stringify(detail)); };
const shot = async (name) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const keyOf = (p) => p.replace(/\\/g, '/').toLowerCase();
const folderKey = keyOf(T.DIR_A), repoKey = keyOf(path.join(T.DIR_A, '.git')), otherKey = keyOf(T.DIR_B);
const boxK = (wt) => `${repoKey}#wt=${keyOf(wt)}`;

// ---------- 준비 ----------
const removeWorktrees = () => { for (const w of [T.WT_X, T.WT_1]) if (fs.existsSync(w)) { try { git(T.DIR_A, 'worktree', 'remove', '--force', w); } catch {} fs.rmSync(w, { recursive: true, force: true }); } };
const NOW = Date.now();
const CID = '00000001-0000-4000-8000-00000000a037';
function convo(cwd, id, at, text) {
  const dir = path.join(T.PROJECTS, path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${id}.jsonl`);
  const line = (type, content, t) => JSON.stringify({ type, uuid: `${type[0]}${id}${t}`, sessionId: id, cwd, entrypoint: 'cli', timestamp: new Date(t).toISOString(), message: { role: type, content } });
  fs.writeFileSync(f, [line('user', text, at), line('assistant', [{ type: 'text', text: `${text} — 답` }], at + 2000)].join('\n') + '\n');
  const tt = new Date(at + 6000); fs.utimesSync(f, tt, tt);
}
if (PHASE !== 'fix' && process.argv.includes('--fresh')) {
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
  await sleep(800);
  for (const d of [path.join(T.DEV, 'data'), path.join(T.DEV, 'app'), T.PROJECTS, T.SESSIONS]) fs.rmSync(d, { recursive: true, force: true });
  if (fs.existsSync(path.join(T.DIR_A, '.git'))) removeWorktrees();
  for (const d of [T.DIR_A, T.DIR_B, T.WT_1]) fs.rmSync(d, { recursive: true, force: true });
}
for (const d of [T.PROJECTS, T.SESSIONS, T.DIR_A, T.DIR_B]) fs.mkdirSync(d, { recursive: true });
if (PHASE !== 'fix') convo(T.DIR_A, CID, NOW - 3600000, 'p37 폴더에서 한 일');

let app = null, page = null;
async function open() {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(500);
}
const ids = {};
const spawned = [];
async function spawnShell(cwd, name) {
  log(atrium('spawn', cwd, '--kind', 'shell', '--name', name).trim().split('\n').slice(-1)[0]);
  spawned.push(name);
  ids[name] = await until(() => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }, name), 30000);
}
const sessionWs = () => page.evaluate(() => Object.fromEntries([...window.__mt.getState().sessions.values()].map((s) => [s.name, s.workspaceKey])));
const wsKeys = () => page.evaluate(() => window.__mt.getState().workspaces.map((w) => ({ key: w.key, kind: w.kind })));
const regionCount = () => page.evaluate(() => document.querySelectorAll('.react-flow__node-region').length);
const head = (key) => page.evaluate((k) => { const e = document.querySelector(`.react-flow__node[data-id="ws:${CSS.escape(k)}"] .mt-region-meta`); return e ? e.textContent : null; }, key);
const domBox = (flowId) => page.evaluate((fid) => { const e = document.querySelector(`.react-flow__node[data-id="${CSS.escape(fid)}"]`); if (!e) return null; const b = e.querySelector('.mt-region-box') || e; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, flowId);
const within = (r, q, pad = 1.5) => !!(r && q) && r.x >= q.x - pad && r.y >= q.y - pad && r.x + r.w <= q.x + q.w + pad && r.y + r.h <= q.y + q.h + pad;
const fitWs = async (k) => { await page.evaluate((kk) => window.__mt.getState().fitWorkspace(kk), k); await sleep(1200); };
const memoId = () => page.evaluate(() => { const m = [...window.__mt.getState().memos.values()].find((x) => x.text === 'p37 메모'); return m ? { id: m.memoId, ws: m.workspaceKey } : null; });
const convoNode = () => page.evaluate((id) => { const c = window.__mt.getState().convoNodes.get(id); return c ? { ws: c.workspaceKey, area: c.area } : null; }, CID);
// 영역 하나 안에 다 든가(화면 기준). names: 세션 노드, boxes: 워크트리 상자 키
async function allInside(key, names, boxes = [], { memo = true, conv = true } = {}) {
  const reg = await domBox(`ws:${key}`);
  const out = { reg: !!reg, miss: [] };
  for (const n of names) if (!within(await domBox(ids[n]), reg)) out.miss.push(n);
  for (const b of boxes) if (!within(await domBox(`wa:${b}`), reg)) out.miss.push(b);
  if (memo) { const m = await memoId(); if (!m || !within(await domBox(`memo:${m.id}`) || await domBox(m.id), reg)) out.miss.push('memo'); }
  if (conv && !within(await domBox(`convo:${CID}`), reg)) out.miss.push('convo');
  out.ok = out.reg && !out.miss.length;
  return out;
}
async function beginFolder() {
  await call('settings.set', { language: 'ko' });
  await call('workspace.open', { path: T.DIR_A });
  await call('workspace.open', { path: T.DIR_B });
  await page.waitForSelector('.react-flow__node-region');
  await spawnShell(T.DIR_A, 's1');
  await spawnShell(T.DIR_A, 's2');
  await spawnShell(T.DIR_B, 'b1');
  await call('memo.create', { workspace: folderKey, text: 'p37 메모' });
  await until(() => convoNode(), 60000, 500).catch(() => null);
  // 다른 폴더 영역은 오른쪽 멀리(합친 영역이 커질 자리)
  const [ra, rb] = await page.evaluate(([a, b]) => [window.__mt.getState().regionOf(a), window.__mt.getState().regionOf(b)], [folderKey, otherKey]);
  try { await call('workspace.move', { workspace: otherKey, dx: Math.round(ra.x + ra.w + 4000 - rb.x), dy: Math.round(ra.y - rb.y) }); } catch (e) { log('폴더 옮기기', e.message); }
  await sleep(800);
  await fitWs(folderKey);
  const h = await head(folderKey);
  step('1. git이 아닌 폴더: 폴더 영역 하나에 셸 둘·메모·대화 노드, 머리글 "폴더"', /폴더/.test(h || '') && (await allInside(folderKey, ['s1', 's2'])).ok, { head: h, conv: await convoNode(), memo: await memoId() });
  await shot(`p37-${PHASE}-1-folder`);
}
async function gitInitAndMore() {
  git(T.DIR_A, 'init', '-q', '-b', 'master');
  fs.writeFileSync(path.join(T.DIR_A, '.gitignore'), '.claude/\n');
  const t0 = Date.now();
  if (PHASE === 'flow') {
    const merged = await until(async () => { const w = await wsKeys(); return w.some((x) => x.key === repoKey && x.kind === 'repo') && !w.some((x) => x.key === folderKey) ? Date.now() - t0 : null; }, 30000, 250).catch(() => null);
    await sleep(600);
    await fitWs(repoKey);
    const h = await head(repoKey);
    const sw = await sessionWs();
    step('2. git init(커밋 없음, 새 세션 없음): 몇 초 안에 그 영역이 저장소 영역이 된다(머리글에 "폴더" 없음)', merged != null && merged < 15000 && h != null && !/폴더/.test(h) && sw.s1 === repoKey && sw.s2 === repoKey, { ms: merged, head: h, s1: sw.s1 });
    step('2. 메모·대화 노드도 그 영역 안', (await allInside(repoKey, ['s1', 's2'])).ok, { memo: await memoId(), conv: await convoNode() });
    await shot(`p37-${PHASE}-2-git-init`);
  } else await sleep(1500);
  git(T.DIR_A, 'commit', '-q', '--allow-empty', '-m', 'empty');
  await spawnShell(T.DIR_A, 's3');
  fs.mkdirSync(path.dirname(T.WT_1), { recursive: true });
  git(T.DIR_A, 'worktree', 'add', '-q', '-b', 'wt1', T.WT_1);
  await spawnShell(T.WT_1, 'w1');
  if (PHASE === 'flow') {
    fs.mkdirSync(path.dirname(T.WT_X), { recursive: true });
    git(T.DIR_A, 'worktree', 'add', '-q', '-b', 'feat-x', T.WT_X);
    await spawnShell(T.WT_X, 'x1');
  }
  await until(async () => (await page.evaluate((k) => !!document.querySelector(`.react-flow__node[data-id="wa:${CSS.escape(k)}"]`), boxK(T.WT_1))), 30000, 500).catch(() => null);
  await sleep(2500);
}

try {
  if (PHASE === 'repro') {
    await open();
    await beginFolder();
    await gitInitAndMore();
    const w = await wsKeys(), sw = await sessionWs();
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1200);
    step('재현(고치기 전 코드): 같은 폴더가 폴더 영역과 저장소 영역 둘로 갈라진다', w.some((x) => x.key === folderKey) && w.some((x) => x.key === repoKey) && sw.s1 === folderKey && sw.w1 === repoKey, { workspaces: w, sessions: sw, regions: await regionCount(), folderHead: await head(folderKey), repoHead: await head(repoKey) });
    await shot('p37-repro-2-split');
    await closeApp(app); app = null;
  }

  if (PHASE === 'fix') {
    // 갈라진 판(repro가 남긴 board.db) 그대로 새 코드의 백엔드를 켠다(창이 백엔드를 띄운다)
    try { log('백엔드 멈춤', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
    await sleep(1000);
    await open();
    await until(async () => !(await wsKeys()).some((x) => x.key === folderKey), 20000, 300).catch(() => null);
    await sleep(1500);
    const names = Object.keys(await sessionWs());
    for (const n of names) ids[n] = await page.evaluate((nn) => ([...window.__mt.getState().sessions.values()].find((x) => x.name === nn) || {}).sessionId, n);
    const w = await wsKeys(), sw = await sessionWs();
    const aNames = names.filter((n) => n !== 'b1');
    step('3. 갈라진 판으로 다시 켜면 하나로: 폴더 키가 없어지고 앞·뒤 세션이 저장소 키', !w.some((x) => x.key === folderKey) && aNames.every((n) => sw[n] === repoKey) && sw.b1 === otherKey, { workspaces: w, sessions: sw });
    await fitWs(repoKey);
    const inside = await allInside(repoKey, aNames, [boxK(T.WT_1)]);
    const h = await head(repoKey);
    step('3. 합친 영역 안에 앞의 세션·뒤의 세션·형제 폴더 워크트리 상자·메모·대화 노드, 머리글은 저장소', inside.ok && !/폴더/.test(h || ''), { ...inside, head: h });
    step('3. 워크트리 셸은 상자 안', within(await domBox(ids.w1), await domBox(`wa:${boxK(T.WT_1)}`)));
    step('3. 영역은 둘(합친 저장소, 다른 폴더)', (await regionCount()) === 2, { regions: await regionCount() });
    await shot('p37-fix-3-merged');
    // 앞의 세션을 닫았다 다시 띄운다(이어 가기)
    const before = await page.evaluate((id) => { const r = window.__mt.getState().nodes.get(id); return r && [Math.round(r.x), Math.round(r.y)]; }, ids.s1);
    await call('session.kill', { session: ids.s1, confirm: true });
    await until(async () => !(await sessionWs()).s1, 20000, 300);
    const r = await call('recall.reopen', { session: ids.s1 });
    await until(async () => (await sessionWs()).s1, 20000, 300);
    await sleep(1500);
    const after = await page.evaluate((id) => { const q = window.__mt.getState().nodes.get(id); return q && [Math.round(q.x), Math.round(q.y)]; }, ids.s1);
    await fitWs(repoKey);
    step('4. 앞의 세션을 다시 띄워도(이어 가기) 합친 영역에, 같은 자리', (await sessionWs()).s1 === repoKey && within(await domBox(ids.s1), await domBox(`ws:${repoKey}`)) && JSON.stringify(before) === JSON.stringify(after), { place: r.place, before, after });
    await shot('p37-fix-4-reopened');
    // 한 번 더 켜도 같다
    const snap = () => page.evaluate(() => { const st = window.__mt.getState(); return JSON.stringify({ w: st.workspaces.map((x) => [x.key, x.x, x.y]), n: [...st.nodes].map(([id, q]) => [id, Math.round(q.x), Math.round(q.y)]).sort() }); });
    const s0 = await snap();
    await closeApp(app); app = null;
    try { log('백엔드 멈춤', atrium('backend', 'stop').trim()); } catch {}
    await sleep(1000);
    await open(); await sleep(2500);
    step('5. 다시 켜도 그대로(여러 번 돌려도 같다)', (await snap()) === s0);
  }

  if (PHASE === 'flow') {
    await open();
    await beginFolder();
    await gitInitAndMore();
    const w = await wsKeys(), sw = await sessionWs();
    step('6. 끝에 영역 하나: 폴더 키 없음, 앞·뒤·워크트리 세션 모두 저장소 키', !w.some((x) => x.key === folderKey) && ['s1', 's2', 's3', 'w1', 'x1'].every((n) => sw[n] === repoKey) && (await regionCount()) === 2, { workspaces: w, sessions: sw, regions: await regionCount() });
    await fitWs(repoKey);
    const inside = await allInside(repoKey, ['s1', 's2', 's3', 'w1', 'x1'], [boxK(T.WT_1), boxK(T.WT_X)]);
    step('6. 한 저장소 영역 안에 앞의 세션, 뒤의 세션, 형제 폴더 워크트리 상자, 저장소 안 워크트리 상자, 메모, 대화 노드', inside.ok, inside);
    step('6. 워크트리 셸은 각자 상자 안', within(await domBox(ids.w1), await domBox(`wa:${boxK(T.WT_1)}`)) && within(await domBox(ids.x1), await domBox(`wa:${boxK(T.WT_X)}`)));
    await shot('p37-flow-3-one-region');
  }
} catch (e) {
  step('예외', false, e.stack);
  if (page) await shot(`p37-${PHASE}-error`).catch(() => {});
} finally {
  if (app) await closeApp(app);
  const ok = results.every((r) => r.ok);
  fs.writeFileSync(path.join(OUT, `p37-${PHASE}.json`), JSON.stringify(results, null, 2));
  log(`${ok ? '모두 통과' : '실패 있음'} ${results.filter((r) => r.ok).length}/${results.length}`);
  process.exitCode = ok ? 0 : 1;
}
