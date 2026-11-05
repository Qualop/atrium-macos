// P37 시험: 폴더 워크스페이스가 저장소가 되면 합치기 — 판단(twinWorkspace, planWorkspaceMerges), 키 옮기기(rekeyBoard, mergedWorkspaceRow, store.rekeyWorkspace),
// 이미 갈라진 키 합치기(reconcileWorkspaces), 띄울 때 옮기기(ensureWorkspace), 저장소가 폴더가 됨. 합치기는 여러 번 돌려도 같다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NODE, overlaps } from '../src/canvas.mjs';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { Backend } from '../src/backend.mjs';
import * as ops from '../src/canvas-ops.mjs';
import { pathKey, normPath } from '../src/workspaces.mjs';
import { attachWorktrees, } from '../src/worktrees.mjs';
import { areaKey, regionConflicts } from '../src/worktree-areas.mjs';
import { twinWorkspace, planWorkspaceMerges, mergedWorkspaceRow, rekeyBoard, rekeyList } from '../src/workspace-merge.mjs';
import { reconcileWorkspaces, mergeWorkspace } from '../src/workspace-merge-ops.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p37u-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });
const inside = (r, q) => r.x >= q.x && r.y >= q.y && r.x + r.w <= q.x + q.w && r.y + r.h <= q.y + q.h;

const FOLDER = { key: 'c:/t/a', kind: 'folder', root: 'C:/t/a', x: 2000, y: 0, createdAt: 10 };
const REPO = { key: 'c:/t/a/.git', kind: 'repo', root: 'C:/t/a', x: 0, y: 0, createdAt: 20 };
const repoWs = { key: REPO.key, kind: 'repo', root: REPO.root };
const folderWs = { key: FOLDER.key, kind: 'folder', root: FOLDER.root };

// ---------- 순수 함수 ----------
test('P37 판단(띄울 때): 새 저장소 ws의 본 저장소 폴더가 폴더 ws로 열려 있으면 그 줄. 저장소가 폴더가 됐으면 .git이 없을 때만', () => {
  assert.equal(twinWorkspace([FOLDER], repoWs).key, FOLDER.key, '폴더가 저장소가 됨');
  assert.equal(twinWorkspace([{ ...FOLDER, key: 'c:/t/a/sub', root: 'C:/t/a/sub' }], repoWs), null, '저장소 안 폴더는 git으로 다시 본 뒤(주기적)');
  assert.equal(twinWorkspace([REPO], repoWs), null);
  assert.equal(twinWorkspace([REPO], folderWs, { gitExists: () => true }), null, '.git이 있으면(git 조사가 잠깐 실패) 고르지 않는다');
  assert.equal(twinWorkspace([REPO], folderWs, { gitExists: () => false }).key, REPO.key, '저장소가 폴더가 됨');
  assert.equal(twinWorkspace([{ ...FOLDER, key: 'c:/other', root: 'C:/other' }], repoWs), null);
});

test('P37 판단(다시 보기): 폴더 → 저장소, 저장소 안 폴더, 저장소 → 폴더, 이미 갈라짐. 고친 뒤 다시 돌리면 옮길 것이 없다', () => {
  const probes = new Map([[FOLDER.key, { ws: repoWs, rootExists: true, gitExists: true }]]);
  assert.deepEqual(planWorkspaceMerges([FOLDER], probes), [{ from: FOLDER.key, to: repoWs, why: 'repo' }], '폴더가 저장소가 됨(대상 줄 없음)');
  assert.deepEqual(planWorkspaceMerges([FOLDER, REPO], probes).map((m) => [m.from, m.to.key]), [[FOLDER.key, REPO.key]], '이미 갈라짐(대상 줄 있음)');
  const sub = { key: 'c:/t/a/sub', kind: 'folder', root: 'C:/t/a/sub', x: 0, y: 0, createdAt: 5 };
  assert.deepEqual(planWorkspaceMerges([sub], new Map([[sub.key, { ws: repoWs, rootExists: true, gitExists: false }]])).map((m) => m.to.key), [REPO.key], '저장소 안 폴더');
  assert.deepEqual(planWorkspaceMerges([FOLDER, REPO], new Map()).map((m) => [m.from, m.to.key, m.why]), [[FOLDER.key, REPO.key, 'split']], '못 보았어도 같은 폴더의 두 키는 합친다');
  assert.deepEqual(planWorkspaceMerges([FOLDER], new Map([[FOLDER.key, { ws: folderWs, rootExists: true, gitExists: false }]])), [], '여전히 폴더');
  // 저장소 → 폴더
  const gone = new Map([[REPO.key, { ws: folderWs, rootExists: true, gitExists: false }]]);
  assert.deepEqual(planWorkspaceMerges([REPO], gone), [{ from: REPO.key, to: folderWs, why: 'folder' }]);
  assert.deepEqual(planWorkspaceMerges([REPO], new Map([[REPO.key, { ws: folderWs, rootExists: true, gitExists: true }]])), [], '.git이 있으면 그대로');
  assert.deepEqual(planWorkspaceMerges([REPO], new Map([[REPO.key, { ws: folderWs, rootExists: false, gitExists: false }]])), [], '폴더가 없으면 그대로');
  // 엇갈린 결과(A → B, B → A)는 앞의 것만
  const both = new Map([[FOLDER.key, { ws: repoWs, rootExists: true, gitExists: false }], [REPO.key, { ws: folderWs, rootExists: true, gitExists: false }]]);
  assert.equal(planWorkspaceMerges([FOLDER, REPO], both).length, 1);
  // 고친 뒤
  const st = rekeyBoard({ workspaces: [FOLDER, REPO], sessions: [], meta: {} }, FOLDER.key, repoWs);
  assert.deepEqual(planWorkspaceMerges(st.workspaces, new Map()), []);
});

test('P37 키 옮기기(모형): 키를 쥔 것 전부가 새 키로, 자리는 그대로, 합친 줄은 대상 자리·먼저 생긴 순서. 여러 번 돌려도 같다', () => {
  const st = {
    workspaces: [FOLDER, REPO, { key: 'c:/o', kind: 'folder', root: 'C:/o', x: 9000, y: 0, createdAt: 30 }],
    sessions: [{ sessionId: 's1', workspaceKey: FOLDER.key }, { sessionId: 's2', workspaceKey: REPO.key }, { sessionId: 's3', workspaceKey: 'c:/o' }],
    memos: [{ memoId: 'm1', workspaceKey: FOLDER.key, x: 5, y: 6 }], kanbans: [{ kanbanId: 'k1', workspaceKey: FOLDER.key }], docks: [{ dockId: 'd1', workspaceKey: FOLDER.key }],
    convoNodes: [{ convId: 'c1', workspaceKey: FOLDER.key, x: 1, y: 2, area: '' }],
    worktreeAreas: [{ wsKey: REPO.key, wt: 'c:/t/a-wt1', x: 0, y: 0 }],
    meta: { currentWorkspace: FOLDER.key, autoOpenDeclined: [FOLDER.key, 'c:/x'] },
  };
  const a = rekeyBoard(st, FOLDER.key, repoWs);
  assert.deepEqual(a.workspaces.map((w) => w.key), [REPO.key, 'c:/o'], '옛 줄은 없어지고 순서는 먼저 생긴 쪽(폴더) 자리');
  assert.deepEqual([a.workspaces[0].x, a.workspaces[0].y, a.workspaces[0].createdAt, a.workspaces[0].kind], [0, 0, 10, 'repo']);
  assert.deepEqual(a.sessions.map((s) => s.workspaceKey), [REPO.key, REPO.key, 'c:/o']);
  for (const t of ['memos', 'kanbans', 'docks', 'convoNodes']) assert.equal(a[t][0].workspaceKey, REPO.key, t);
  assert.deepEqual([a.memos[0].x, a.memos[0].y, a.convoNodes[0].x], [5, 6, 1], '자리는 그대로');
  assert.equal(a.worktreeAreas.length, 1);
  assert.deepEqual(a.meta, { currentWorkspace: REPO.key, autoOpenDeclined: ['c:/x'] });
  assert.deepEqual(rekeyBoard(a, FOLDER.key, repoWs), a, '여러 번 돌려도 같다');
  // 대상 줄이 없으면 옛 줄의 자리를 가진 새 줄
  const b = rekeyBoard({ ...st, workspaces: [FOLDER] }, FOLDER.key, repoWs);
  assert.deepEqual([b.workspaces[0].key, b.workspaces[0].x, b.workspaces[0].kind], [REPO.key, 2000, 'repo']);
  // 저장소 → 폴더: 워크트리 상자는 없어진다
  const c = rekeyBoard(a, REPO.key, folderWs);
  assert.deepEqual([c.worktreeAreas.length, c.sessions[0].workspaceKey, c.workspaces[0].kind], [0, FOLDER.key, 'folder']);
});

test('P37 합친 줄: 자리·뷰포트는 대상 것이 먼저, 순서는 먼저 생긴 쪽, auto는 둘 다일 때만', () => {
  const r = mergedWorkspaceRow({ ...FOLDER, viewport: { zoom: 1 }, auto: false }, { ...REPO, x: null, y: null, auto: true }, repoWs);
  assert.deepEqual([r.x, r.y, r.viewport, r.createdAt, r.auto], [2000, 0, { zoom: 1 }, 10, false]);
  assert.deepEqual(rekeyList(['a', 'b', 'a'], 'a', 'b'), ['b']);
});

test('P37 저장소 옮기기(board.db): 표마다 새 키로, 한 트랜잭션, 다시 부르면 null', () => {
  const store = new Store(path.join(tmp(), 'board.db'));
  store.insertWorkspace({ ...FOLDER }); store.setWorkspaceAnchor(FOLDER.key, 2000, 0);
  store.insertWorkspace({ ...REPO }); store.setWorkspaceAnchor(REPO.key, 0, 0);
  for (const [id, key] of [['s1', FOLDER.key], ['s2', REPO.key]]) store.insertSession({ sessionId: id, name: id, cwd: 'C:/t/a', permissionMode: 'manual', createdAt: 1, workspaceKey: key, kind: 'shell' });
  store.insertMemo({ memoId: 'm1', workspaceKey: FOLDER.key, x: 1, y: 2, w: 100, h: 100, text: 'memo', createdAt: 1 });
  store.putConvoNode({ convId: 'c1', workspaceKey: FOLDER.key, x: 3, y: 4, w: 100, h: 100, area: '' });
  store.putWorktreeArea({ wsKey: REPO.key, wt: 'c:/t/a-wt1', path: 'C:/t/a-wt1', x: 0, y: 0 });
  store.setMeta('currentWorkspace', FOLDER.key);
  const r = store.rekeyWorkspace(FOLDER.key, repoWs);
  assert.equal(r.merged, true);
  assert.equal(r.sessions, 1);
  assert.deepEqual(store.workspaces().map((w) => [w.key, w.kind, w.x, w.createdAt]), [[REPO.key, 'repo', 0, 10]]);
  assert.deepEqual(store.openSessions().map((s) => s.workspaceKey), [REPO.key, REPO.key]);
  assert.equal(store.getMemo('m1').workspaceKey, REPO.key);
  assert.deepEqual([store.convoNodes()[0].workspaceKey, store.convoNodes()[0].x], [REPO.key, 3]);
  assert.equal(store.worktreeAreas().length, 1);
  assert.equal(store.getMeta('currentWorkspace'), REPO.key);
  assert.equal(store.rekeyWorkspace(FOLDER.key, repoWs), null, '여러 번 돌려도 같다');
  // 저장소 → 폴더
  store.rekeyWorkspace(REPO.key, folderWs);
  assert.deepEqual([store.workspaces().map((w) => w.key), store.worktreeAreas().length], [[FOLDER.key], 0]);
  store.close();
});

// ---------- 판 위에서(가짜 백엔드) ----------
const ROOT = 'C:/t/a', WT1 = 'C:/t/a-wt1';
function board({ dataDir = tmp(), split = true, wts = [WT1] } = {}) {
  const b = new Backend({ quietMs: 600000, port: 0, logDir: tmp() });
  b.store = new Store(path.join(dataDir, 'board.db'));
  b.sessions = new Map();
  b.api = { broadcast: () => {} };
  b.log = () => {}; b.touch = () => {};
  b.broadcastWorkspaces = () => {};
  b.broadcastSession = () => {};
  const mk = (w, x, y) => { if (!b.store.getWorkspace(w.key)) { b.store.insertWorkspace({ ...w, createdAt: w.createdAt }); b.store.setWorkspaceAnchor(w.key, x, y); } };
  mk(FOLDER, 2000, 0);
  if (split) mk(REPO, 0, 0);
  mk({ key: 'c:/other', kind: 'folder', root: 'C:/other', createdAt: 30 }, 9000, 0);
  const state = { wts, repo: true };
  const porcelain = () => [`worktree ${ROOT}`, 'HEAD 1', 'branch refs/heads/master', '', ...state.wts.flatMap((p) => [`worktree ${p}`, 'HEAD 2', 'branch refs/heads/wt1', ''])].join('\n');
  b.worktrees = attachWorktrees(b, { tickMs: 0, list: async (root) => (state.repo && normPath(root) === ROOT ? porcelain() : null), exists: () => true });
  // git 조사 흉내: ROOT 아래(또는 워크트리)면 저장소, 아니면 폴더
  const resolve = async (dir) => {
    const k = pathKey(dir);
    if (state.repo && (k === pathKey(ROOT) || k.startsWith(pathKey(ROOT) + '/') || state.wts.some((p) => k === pathKey(p)))) return { ...repoWs };
    return { key: k, kind: 'folder', root: normPath(dir) };
  };
  const opts = { resolve, exists: () => true, gitExists: (root) => state.repo && pathKey(root) === pathKey(ROOT) };
  b.reconcileWorkspaces = (cause) => reconcileWorkspaces(b, cause, opts);
  const add = (name, wsKey, cwd, rect, area) => {
    const s = { sessionId: 'id-' + name, name, kind: 'shell', workspaceKey: wsKey, cwd, rt: newRuntime({ kind: 'shell', hooked: false }), origin: 'board', createdAt: Date.now() };
    b.sessions.set(s.sessionId, s);
    if (!b.store.getSession(s.sessionId)) b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    if (rect) b.store.setNode({ session_id: s.sessionId, ...rect, z: 0, area: area ?? null });
    return s;
  };
  return { b, add, state, opts, dataDir };
}
const nodeOf = (b, name) => b.store.nodes().find((n) => n.session_id === 'id-' + name);
const conflicts = (b) => [...regionConflicts(ops.regions(b), ops.canvasItems(b))];
const boxKey = areaKey(REPO.key, pathKey(WT1));

test('P37 이미 갈라진 판: 폴더 영역(세션 넷, 메모, 대화 노드)과 저장소 영역(워크트리 상자만)이 하나로. 노드 자리는 그대로, 상자는 리포 영역 안. 다시 돌려도 같다', async () => {
  const { b, add, opts } = board();
  for (let i = 0; i < 4; i++) add('w' + i, FOLDER.key, ROOT, R(2040 + i * 760, 112));
  add('wt1', REPO.key, WT1, R(40, 112), pathKey(WT1));
  b.store.insertMemo({ memoId: 'm1', workspaceKey: FOLDER.key, x: 2040, y: 700, w: 300, h: 200, text: 'memo', createdAt: 1 });
  b.store.putConvoNode({ convId: 'c1', workspaceKey: FOLDER.key, x: 2400, y: 700, w: 300, h: 200, area: '' });
  b.store.putWorktreeArea({ wsKey: REPO.key, wt: pathKey(WT1), path: WT1, branch: 'wt1', x: 0, y: 0 });
  const before = ['w0', 'w1', 'w2', 'w3'].map((n) => { const q = nodeOf(b, n); return [q.x, q.y]; });
  const done = await reconcileWorkspaces(b, 'start', { ...opts, quiet: true });
  assert.deepEqual(done.map((d) => [d.from, d.to, d.why]), [[FOLDER.key, REPO.key, 'start:repo']]);
  assert.deepEqual(b.store.workspaces().map((w) => w.key), [REPO.key, 'c:/other'], '영역 하나(다른 영역은 그대로)');
  assert.equal(b.store.getWorkspace(REPO.key).createdAt, FOLDER.createdAt, '순서는 먼저 연 폴더 자리');
  assert.deepEqual(['w0', 'w1', 'w2', 'w3'].map((n) => { const q = nodeOf(b, n); return [q.x, q.y]; }), before, '앞의 세션 자리는 그대로');
  assert.ok([...b.sessions.values()].every((s) => s.workspaceKey === REPO.key), '판이 쥔 세션도 새 키');
  const regs = ops.regions(b);
  const main = regs.get(REPO.key);
  for (const n of ['w0', 'w3', 'wt1']) assert.ok(inside(nodeOf(b, n), main), `리포 영역 안 ${n}`);
  assert.ok(inside(regs.get(boxKey), main), '워크트리 상자는 리포 영역 안');
  assert.ok(inside(nodeOf(b, 'wt1'), regs.get(boxKey)), '워크트리 셸은 상자 안');
  assert.ok(inside(b.store.getMemo('m1'), main) && inside(b.store.convoNodes()[0], main), '메모와 대화 노드도 리포 영역 안');
  // 본 저장소 쪽이 비어 있던 리포 영역: 상자는 들어온 것의 오른쪽이나 아래로(멀리 왼쪽에 남지 않는다)
  const content = ops.canvasItems(b).filter((i) => i.ws === REPO.key && i.kind !== 'wtbox');
  const r = regs.get(boxKey);
  assert.ok(content.every((c) => !overlaps(c, r, 59)), '상자는 본 저장소 쪽 것과 BOX_GAP 넘게 떨어진다');
  assert.ok(r.x >= Math.min(...content.map((c) => c.x)), `상자가 들어온 것의 왼쪽 멀리 남지 않는다 ${JSON.stringify(r)}`);
  assert.deepEqual(conflicts(b), []);
  assert.ok(b.store.events({}).some((e) => e.kind === 'workspace_merged'));
  // 여러 번 돌려도 같다
  const snap = () => JSON.stringify([b.store.workspaces(), b.store.nodes(), b.store.worktreeAreas(), b.store.memos(), b.store.convoNodes()]);
  const s0 = snap();
  assert.deepEqual(await reconcileWorkspaces(b, 'again', opts), []);
  await b.worktrees.sync('again');
  assert.equal(snap(), s0, '다시 돌려도 바뀌지 않는다');
  b.store.close();
});

test('P37 이미 갈라진 판(다시 켜기): 같은 board.db를 다시 열어도 하나로 남는다', async () => {
  const dataDir = tmp();
  const one = board({ dataDir });
  one.add('w0', FOLDER.key, ROOT, R(2040, 112));
  await reconcileWorkspaces(one.b, 'start', { ...one.opts, quiet: true });
  one.b.store.close();
  const two = board({ dataDir, split: false });
  // board()가 FOLDER 줄을 다시 만들지 않게: 이미 저장소 줄이 있으면 mk가 폴더 줄을 넣는다. 그 줄도 다음 다시 보기에 합쳐진다
  await reconcileWorkspaces(two.b, 'start', { ...two.opts, quiet: true });
  assert.deepEqual(two.b.store.workspaces().map((w) => w.key), [REPO.key, 'c:/other']);
  assert.equal(two.b.store.getSession('id-w0').workspaceKey, REPO.key);
  two.b.store.close();
});

test('P37 띄울 때: 폴더 ws가 저장소가 된 뒤 같은 폴더·형제 워크트리에서 띄우면 새 영역을 만들지 않고 그 영역을 저장소 키로 옮긴다', async () => {
  const { b, add } = board({ split: false });
  add('w0', FOLDER.key, ROOT, R(2040, 112));
  const at0 = b.store.getWorkspace(FOLDER.key);
  assert.equal(b.ensureWorkspace({ ...repoWs }, 'spawn wt1'), false, '새 줄을 만들지 않는다');
  assert.deepEqual(b.store.workspaces().map((w) => w.key), [REPO.key, 'c:/other']);
  const w = b.store.getWorkspace(REPO.key);
  assert.deepEqual([w.kind, w.x, w.y, w.createdAt], ['repo', at0.x, at0.y, at0.createdAt], '자리와 순서는 폴더 줄 그대로');
  assert.equal(b.sessions.get('id-w0').workspaceKey, REPO.key);
  // 형제 폴더 워크트리 세션: 상자 안
  add('wt1', REPO.key, WT1, null);
  const slot = ops.slotFor(b, { wsKey: REPO.key, area: pathKey(WT1) });
  b.store.setNode({ session_id: 'id-wt1', x: slot.x, y: slot.y, w: NODE.w, h: NODE.h, z: 0, area: '' });
  await b.worktrees.sync('t');
  const regs = ops.regions(b);
  assert.ok(regs.has(boxKey), '워크트리 상자');
  assert.ok(inside(regs.get(boxKey), regs.get(REPO.key)), '상자는 리포 영역 안');
  assert.ok(inside(nodeOf(b, 'wt1'), regs.get(boxKey)), '워크트리 세션은 상자 안');
  assert.ok(inside(nodeOf(b, 'w0'), regs.get(REPO.key)));
  assert.deepEqual(conflicts(b), []);
  b.store.close();
});

test('P37 주기적 다시 보기: 새 세션 없이 git init만 해도 폴더 ws가 저장소 ws가 된다(worktrees sync)', async () => {
  const { b, add, state } = board({ split: false, wts: [] });
  state.repo = false;
  add('w0', FOLDER.key, ROOT, R(2040, 112));
  await b.worktrees.sync('t');
  assert.equal(b.store.getWorkspace(FOLDER.key).kind, 'folder', '아직 폴더');
  state.repo = true;
  await b.worktrees.sync('t');
  assert.deepEqual(b.store.workspaces().map((w) => [w.key, w.kind]), [[REPO.key, 'repo'], ['c:/other', 'folder']]);
  b.store.close();
});

test('P37 저장소가 폴더가 됨(.git 지움): 저장소 ws를 폴더 키로 옮기고, 상자는 없어지고 상자 안 노드는 본 영역에. 그 뒤 띄워도 갈라지지 않는다', async () => {
  const { b, add, state, opts } = board({ split: false });
  add('w0', FOLDER.key, ROOT, R(2040, 112));
  b.ensureWorkspace({ ...repoWs }, 'x');
  add('wt1', REPO.key, WT1, R(2040, 800), pathKey(WT1));
  await b.worktrees.sync('t');
  assert.ok(ops.regions(b).has(boxKey));
  state.repo = false; state.wts = [];
  const done = await reconcileWorkspaces(b, 't', opts);
  assert.deepEqual(done.map((d) => [d.from, d.to]), [[REPO.key, FOLDER.key]]);
  assert.deepEqual(b.store.workspaces().map((w) => [w.key, w.kind]), [[FOLDER.key, 'folder'], ['c:/other', 'folder']]);
  assert.equal(b.store.worktreeAreas().length, 0);
  const regs = ops.regions(b);
  assert.ok(inside(nodeOf(b, 'wt1'), regs.get(FOLDER.key)));
  assert.equal(b.ensureWorkspace({ ...folderWs }, 'spawn'), false, '이미 있다');
  // 띄울 때 저장소 줄이 남아 있고 .git이 없으면 그 줄을 폴더 키로
  mergeWorkspace(b, FOLDER.key, { ...repoWs }, 'test', { quiet: true });
  assert.equal(b.ensureWorkspace({ ...folderWs }, 'spawn'), false);
  assert.deepEqual(b.store.workspaces().map((w) => w.key), [FOLDER.key, 'c:/other']);
  b.store.close();
});
