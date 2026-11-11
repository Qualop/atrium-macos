// P68 시험: 같은 리포의 워크트리끼리 붙여 묶기 — 섞인 덩어리는 리포 영역에(dockedAreas), 빈 상자 숨김(visibleAnchors),
// 붙이기 허용과 다른 리포 거부, 떼면 자기 상자로, 정리가 덩어리를 깨지 않음, 다시 켠 뒤에도 그대로, 워커 붙여 묶기(dock.workers)
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
import { attachWorktrees } from '../src/worktrees.mjs';
import { areaKey, regionConflicts, dockedAreas, visibleAnchors, areaAnchorList, workersPreset, nestedRegions } from '../src/worktree-areas.mjs';
import { leaves } from '../src/dock-tree.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p68u-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });
const inside = (r, q) => r.x >= q.x && r.y >= q.y && r.x + r.w <= q.x + q.w && r.y + r.h <= q.y + q.h;

// ---------- 순수 함수 ----------
test('P68 섞인 덩어리: 같은 리포의 다른 영역이 섞이면 구성 노드는 리포 영역, 빠져나간 상자는 숨김 후보. 한 영역뿐인 덩어리는 그대로', () => {
  const kA = areaKey('A', 'w1'), kB = areaKey('A', 'w2');
  const raw = { m: 'A', a: kA, a2: kA, b: kB, z: null };
  const of = (id) => raw[id] ?? null;
  const r = dockedAreas([{ members: ['m', 'a'] }, { members: ['a2', 'b'] }, { members: ['x', 'z'] }], of);
  assert.deepEqual([...r.area].sort(), [['a', 'A'], ['a2', 'A'], ['b', 'A'], ['m', 'A']]);
  assert.deepEqual([...r.pulled].sort(), [kA, kB].sort());
  const same = dockedAreas([{ members: ['a', 'a2'] }], of);
  assert.equal(same.area.size, 0, '한 상자 안의 덩어리는 그 상자에 남는다');
  assert.equal(same.pulled.size, 0);
  // 숨김: 빠져나간 상자 가운데 안이 빈 것만
  const anchors = areaAnchorList([{ key: 'A', x: 0, y: 0, worktrees: [{ wt: 'w1', x: 1000, y: 0 }, { wt: 'w2', x: 2000, y: 0 }] }]);
  const vis = visibleAnchors(anchors, [{ ws: 'A' }, { ws: kB }], new Set([kA, kB]));
  assert.deepEqual(vis.map((a) => a.key), ['A', kB], '안이 남은 상자는 보인다');
  assert.equal(visibleAnchors(anchors, [], new Set()), anchors);
  assert.ok(!nestedRegions(vis, []).has(kA), '숨긴 상자는 영역이 없다');
  assert.deepEqual([2, 3, 4, 5, 6, 9].map(workersPreset), ['row', 'row3', 'grid', 'top3-bottom2', 'grid-3x2', 'even-rows']);
});

// ---------- 판 위에서(가짜 백엔드) ----------
function board({ dataDir = tmp(), wts = ['p1', 'p2', 'p3'] } = {}) {
  const b = new Backend({ quietMs: 600000, port: 0, logDir: tmp() });
  b.store = new Store(path.join(dataDir, 'board.db'));
  b.sessions = new Map();
  b.api = { broadcast: () => {} };
  b.log = () => {}; b.touch = () => {};
  b.broadcastWorkspaces = () => {};
  const repo = 'C:/repo';
  const ws = { key: pathKey(`${repo}/.git`), root: normPath(repo) };
  const mk = (key, kind, root, x, y) => { if (!b.store.getWorkspace(key)) { b.store.insertWorkspace({ key, kind, root, createdAt: 1 }); b.store.setWorkspaceAnchor(key, x, y); } };
  mk(ws.key, 'repo', ws.root, 0, 0);
  mk('c:/other', 'folder', 'C:/other', 9000, 0);
  const W = (n) => `${repo}/.claude/worktrees/${n}`;
  const porcelain = () => [`worktree ${repo}`, 'HEAD 1', 'branch refs/heads/main', '', ...wts.flatMap((n) => [`worktree ${W(n)}`, 'HEAD 2', `branch refs/heads/worktree-${n}`, ''])].join('\n');
  b.worktrees = attachWorktrees(b, { tickMs: 0, list: async (root) => (normPath(root) === normPath(repo) ? porcelain() : null), exists: () => true });
  let t = 1;
  const add = (name, wsKey, cwd, rect, extra = {}) => {
    const s = { sessionId: 'id-' + name, name, kind: 'shell', workspaceKey: wsKey, cwd, rt: newRuntime({ kind: 'shell', hooked: false }), origin: 'board', createdAt: t++, ...extra };
    b.sessions.set(s.sessionId, s);
    if (!b.store.getSession(s.sessionId)) b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    if (rect) b.store.setNode({ session_id: s.sessionId, ...rect, z: 0 });
    return s;
  };
  const key = (n) => areaKey(ws.key, pathKey(W(n)));
  return { b, ws, add, W, key, dataDir };
}
const nodeOf = (b, name) => b.store.nodes().find((n) => n.session_id === 'id-' + name);
const itemOf = (b, name) => ops.canvasItems(b).find((i) => i.kind === 'node' && i.id === 'id-' + name);
const conflicts = (b) => [...regionConflicts(ops.regions(b), ops.canvasItems(b))];
const dockNames = (b, name) => { const d = ops.dockOf(b, 'id-' + name); return d ? leaves(d.tree).map((x) => x.slice(3)).sort() : null; };

// 본 저장소 세션 m, 워크트리 p1·p2·p3마다 세션 하나(a, c, e)
async function setup(opts) {
  const x = board(opts);
  const { b, ws, add, W } = x;
  add('m', ws.key, 'C:/repo', R(40, 112));
  add('a', ws.key, W('p1'), R(40, 2000));
  add('c', ws.key, W('p2'), R(40, 3000));
  add('e', ws.key, W('p3'), R(40, 4000));
  await b.worktrees.sync('t');
  ops.settleRegions(b, 't');
  return x;
}

test('P68 붙이기: 같은 리포의 다른 워크트리끼리, 본 저장소와 워크트리도 붙는다. 다른 리포는 거부', async () => {
  const { b, ws, add, key, W } = await setup();
  for (const [n, p] of [['a', 'p1'], ['c', 'p2'], ['e', 'p3']]) assert.equal(itemOf(b, n).ws, key(p), `${n}는 처음에 자기 상자`);
  // 워크트리 a를 워크트리 c 오른쪽에
  ops.dockAttach(b, { session: 'id-a', to: 'id-c', side: 'right' });
  assert.deepEqual(dockNames(b, 'a'), ['a', 'c']);
  // 본 저장소 m을 그 덩어리 옆에
  ops.dockAttach(b, { session: 'id-m', to: 'id-c', side: 'left' });
  assert.deepEqual(dockNames(b, 'm'), ['a', 'c', 'm']);
  // 다른 리포(폴더) 세션은 거부
  add('o', 'c:/other', 'C:/other', R(9100, 200));
  assert.throws(() => ops.dockAttach(b, { session: 'id-o', to: 'id-a', side: 'right' }), (e) => e.code === 'bad_request');
  assert.throws(() => ops.dockLayout(b, { members: ['id-o', 'id-e'], preset: 'row' }), (e) => e.code === 'bad_request');
  assert.equal(ops.dockOf(b, 'id-o'), null);
  // 워크트리 정보(저장한 area)는 그대로
  assert.equal(nodeOf(b, 'a').area, pathKey(W('p1')));
  assert.equal(nodeOf(b, 'c').area, pathKey(W('p2')));
});

test('P68 자리: 붙인 세션은 상자에서 빠져 리포 영역에, 빈 상자는 숨고, 떼면 자기 상자(숨기 전 자리)로 돌아간다', async () => {
  const { b, ws, key } = await setup();
  const boxA = ops.regions(b).get(key('p1'));
  const a0 = nodeOf(b, 'a');
  ops.dockAttach(b, { session: 'id-a', to: 'id-m', side: 'right' });
  const regs = ops.regions(b);
  assert.equal(itemOf(b, 'a').ws, ws.key, '덩어리는 리포 영역(본 저장소 쪽)');
  assert.equal(itemOf(b, 'm').ws, ws.key);
  assert.ok(!regs.has(key('p1')), '빈 상자 p1은 숨는다');
  assert.ok(regs.has(key('p2')) && regs.has(key('p3')), '다른 상자는 그대로');
  assert.ok(b.store.worktreeAreas().some((a) => a.wt === pathKey(b.worktrees.live(ws.key)[0].path)), '워크트리 행은 그대로');
  for (const n of ['a', 'm']) assert.ok(inside(nodeOf(b, n), regs.get(ws.key)), `${n}는 리포 영역 안`);
  assert.deepEqual(conflicts(b), [], JSON.stringify(conflicts(b)));
  // 숨기 전 상자 자리를 저장했다
  const row = b.store.worktreeAreas().find((a) => areaKey(a.wsKey, a.wt) === key('p1'));
  assert.deepEqual([row.x, row.y], [boxA.x, boxA.y]);
  // 떼면 자기 상자로(혼자 있던 자리)
  ops.dockRemove(b, { session: 'id-a' });
  assert.equal(ops.dockOf(b, 'id-a'), null);
  assert.equal(itemOf(b, 'a').ws, key('p1'));
  const back = ops.regions(b);
  assert.ok(back.has(key('p1')), '상자가 다시 보인다');
  assert.deepEqual([nodeOf(b, 'a').x, nodeOf(b, 'a').y], [a0.x, a0.y], '숨기 전 자리로 돌아간다');
  assert.ok(inside(nodeOf(b, 'a'), back.get(key('p1'))));
  assert.deepEqual(conflicts(b), [], JSON.stringify(conflicts(b)));
  // Ctrl+끌기로 뗀 자리를 주어도 자기 상자로
  ops.dockAttach(b, { session: 'id-a', to: 'id-m', side: 'right' });
  ops.dockRemove(b, { session: 'id-a', x: 5000, y: -3000 });
  assert.deepEqual([nodeOf(b, 'a').x, nodeOf(b, 'a').y], [a0.x, a0.y]);
});

test('P68 덩어리째 돌아가기: 워크트리 둘과 본 저장소 하나에서 본 저장소를 떼면 남은 둘은 각자 상자로, 세션을 닫아도 같다', async () => {
  const { b, key } = await setup();
  const c0 = nodeOf(b, 'c'), e0 = nodeOf(b, 'e');
  ops.dockLayout(b, { members: ['id-c', 'id-e', 'id-m'], preset: 'row3' });
  assert.ok(!ops.regions(b).has(key('p2')) && !ops.regions(b).has(key('p3')));
  ops.dockRemove(b, { session: 'id-m' });
  assert.deepEqual(dockNames(b, 'c'), ['c', 'e'], '워크트리 둘은 붙은 채(섞인 덩어리)');
  assert.ok(!ops.regions(b).has(key('p2')), '아직 숨김');
  // 세션 e를 닫으면 덩어리가 풀리고 c는 자기 상자로
  const e = b.sessions.get('id-e');
  b.sessions.delete('id-e');
  ops.onSessionClosed(b, e);
  assert.equal(ops.dockOf(b, 'id-c'), null);
  assert.equal(itemOf(b, 'c').ws, key('p2'));
  assert.ok(inside(nodeOf(b, 'c'), ops.regions(b).get(key('p2'))));
  assert.deepEqual([nodeOf(b, 'c').x, nodeOf(b, 'c').y], [c0.x, c0.y]);
  assert.ok(e0);
  assert.deepEqual(conflicts(b), [], JSON.stringify(conflicts(b)));
});

test('P68 한 상자 안의 덩어리는 지금처럼 그 상자에 남는다', async () => {
  const { b, ws, add, W, key } = await setup();
  const at = ops.slotFor(b, { wsKey: ws.key, area: pathKey(W('p1')) });
  add('a2', ws.key, W('p1'), { ...at, w: NODE.w, h: NODE.h }); b.store.setNodeArea('id-a2', pathKey(W('p1')));
  ops.settleRegions(b, 't');
  ops.dockAttach(b, { session: 'id-a2', to: 'id-a', side: 'right' });
  assert.equal(itemOf(b, 'a').ws, key('p1'));
  assert.equal(itemOf(b, 'a2').ws, key('p1'));
  assert.ok(ops.regions(b).has(key('p1')));
  assert.deepEqual(conflicts(b), []);
});

test('P68 정리: 영역 정리, 판 전체 정리, 상자 자리 정하기가 섞인 덩어리를 깨지 않는다', async () => {
  const { b, ws, key } = await setup({ wts: ['p1', 'p2', 'p3'] });
  ops.dockLayout(b, { members: ['id-a', 'id-c', 'id-e'], preset: 'row3' });
  const shape = () => { const d = ops.dockOf(b, 'id-a'); const rs = d.members.map((m) => b.store.nodes().find((n) => n.session_id === m)); const o = rs[0]; return rs.map((r) => [r.x - o.x, r.y - o.y, r.w, r.h]); };
  const s0 = shape();
  for (const p of [{ workspace: ws.key, apply: true }, { all: true, apply: true }]) {
    ops.arrange(b, p);
    assert.deepEqual(dockNames(b, 'a'), ['a', 'c', 'e'], JSON.stringify(p));
    assert.deepEqual(shape(), s0, `모양 그대로 ${JSON.stringify(p)}`);
    for (const n of ['a', 'c', 'e']) assert.equal(itemOf(b, n).ws, ws.key);
    for (const k of ['p1', 'p2', 'p3']) assert.ok(!ops.regions(b).has(key(k)));
    assert.deepEqual(conflicts(b), [], JSON.stringify(conflicts(b)));
  }
  // 새 워크트리 상자 자리 정하기와 상자 옮기기(migrateBoxesInside, reslotBoxes)
  ops.reslotBoxes(b, b.store.getWorkspace(ws.key));
  ops.settleRegions(b, 't');
  assert.deepEqual(shape(), s0);
  await b.worktrees.sync('t');
  assert.deepEqual(dockNames(b, 'a'), ['a', 'c', 'e']);
  assert.deepEqual(conflicts(b), []);
});

test('P68 다시 켜기: 같은 판 기록으로 새로 뜬 백엔드에서도 덩어리와 숨긴 상자가 그대로', async () => {
  const x = await setup();
  ops.dockAttach(x.b, { session: 'id-a', to: 'id-m', side: 'right' });
  const before = { items: ops.canvasItems(x.b).map((i) => [i.id, i.ws, i.x, i.y]).sort(), regs: [...ops.regions(x.b).keys()].sort() };
  x.b.store.db.close();
  const y = board({ dataDir: x.dataDir });
  for (const [n, cwd] of [['m', 'C:/repo'], ['a', y.W('p1')], ['c', y.W('p2')], ['e', y.W('p3')]]) y.add(n, y.ws.key, cwd, null);
  await y.b.worktrees.sync('start');
  ops.settleRegions(y.b, 'start');
  assert.deepEqual(dockNames(y.b, 'a'), ['a', 'm']);
  assert.deepEqual({ items: ops.canvasItems(y.b).map((i) => [i.id, i.ws, i.x, i.y]).sort(), regs: [...ops.regions(y.b).keys()].sort() }, before);
  assert.ok(!ops.regions(y.b).has(y.key('p1')));
});

test('P68 워커 붙여 묶기: 리드의 하위 세션을 세션 수에 맞는 틀로 묶는다. 둘보다 적으면 거부', async () => {
  const { b, ws, add, W, key } = board();
  add('lead', ws.key, 'C:/repo', R(40, 112));
  for (const [n, p] of [['w1', 'p1'], ['w2', 'p2'], ['w3', 'p3']]) add(n, ws.key, W(p), R(40, 2000 + 1000 * Number(p.slice(1))), { parentSessionId: 'id-lead' });
  add('solo', ws.key, 'C:/repo', R(2000, 112));
  await b.worktrees.sync('t');
  ops.settleRegions(b, 't');
  const r = ops.dockWorkers(b, { lead: 'id-lead' });
  assert.equal(r.preset, 'row3');
  assert.deepEqual(r.workers, ['w1', 'w2', 'w3']);
  assert.deepEqual(dockNames(b, 'w1'), ['w1', 'w2', 'w3']);
  assert.equal(ops.dockOf(b, 'id-lead'), null, '리드는 넣지 않는다');
  for (const k of ['p1', 'p2', 'p3']) assert.ok(!ops.regions(b).has(key(k)));
  const ws1 = nodeOf(b, 'w1'), ws2 = nodeOf(b, 'w2');
  assert.equal(ws1.y, ws2.y, '가로 셋');
  assert.ok(!overlaps(nodeOf(b, 'lead'), ops.dockOuter(b, ops.dockOf(b, 'id-w1')), -1), '리드와 겹치지 않는다');
  assert.deepEqual(conflicts(b), [], JSON.stringify(conflicts(b)));
  assert.throws(() => ops.dockWorkers(b, { lead: 'id-solo' }), (e) => e.code === 'bad_request' && e.key === 'dockWorkersFew');
});
