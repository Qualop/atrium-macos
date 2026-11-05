// P35 시험: 워크트리 상자를 리포 영역 안에 — 상자 자리(boxSlot), 감싸기(withBoxes, nestedRegions), 겹침 쌍(regionConflicts),
// 상자 겹침 풀기(settleBoxes), 옛 위성 자리 옮기기(migrateBoxes, migrateBoxesInside), 판 위에서 끌기·정리·되돌리기
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NODE, REGION_PAD, REGION_HEAD, overlaps, regionRect } from '../src/canvas.mjs';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { Backend } from '../src/backend.mjs';
import * as ops from '../src/canvas-ops.mjs';
import { pathKey, normPath } from '../src/workspaces.mjs';
import { attachWorktrees } from '../src/worktrees.mjs';
import { areaKey, isBoxKey, boxSlot, withBoxes, nestedRegions, regionConflicts, settleBoxes, migrateBoxes, areaAnchorList, WT_EMPTY, BOX_GAP } from '../src/worktree-areas.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p35u-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });
const inside = (r, q) => r.x >= q.x && r.y >= q.y && r.x + r.w <= q.x + q.w && r.y + r.h <= q.y + q.h;
const apart = (a, b, gap) => !overlaps(a, b, gap - 1);

// ---------- 순수 함수 ----------
test('P35 감싸기: 리포 영역은 본 저장소 쪽 것과 상자를 함께 감싸고, 상자는 그 안의 것(빈 상자는 저장한 자리)', () => {
  const anchors = areaAnchorList([{ key: 'A', x: 0, y: 0, worktrees: [{ wt: 'w1', x: 1000, y: 112 }, { wt: 'w2', x: 1000, y: 2000 }] }, { key: 'B', x: 0, y: 9000 }]);
  const k1 = areaKey('A', 'w1'), k2 = areaKey('A', 'w2');
  const items = [{ id: 'a', ws: 'A', ...R(40, 112) }, { id: 'b', ws: k2, ...R(1200, 2300) }];
  const all = withBoxes(anchors, items);
  assert.deepEqual(all.filter((i) => i.kind === 'wtbox').map((i) => [i.box, i.ws]), [[k1, 'A'], [k2, 'A']], '상자는 리포 영역의 안의 것');
  assert.equal(withBoxes(anchors, all).length, all.length, '다시 불러도 상자를 두 번 더하지 않는다');
  const regs = nestedRegions(anchors, items);
  assert.deepEqual(regs.get(k1), { x: 1000, y: 112, ...WT_EMPTY }, '빈 상자는 저장한 자리');
  assert.deepEqual(regs.get(k2), regionRect([items[1]]), '안이 있는 상자는 안의 것을 감싼다');
  for (const k of [k1, k2]) assert.ok(inside(regs.get(k), regs.get('A')), `리포 영역이 상자를 감싼다 ${k}`);
  assert.deepEqual(regs.get('A'), regionRect([items[0], regs.get(k1), regs.get(k2)]));
  assert.ok(regs.has('B'));
  // 겹침 쌍: 리포 영역과 그 안의 상자는 겹침이 아니다. 상자와 본 저장소 쪽 노드, 상자끼리는 겹침
  assert.deepEqual([...regionConflicts(regs, items)], []);
  const over = [...items, { id: 'c', ws: 'A', ...R(1100, 150) }];
  assert.deepEqual([...regionConflicts(nestedRegions(anchors, over), over)].sort(), [`${k1}|c`, `${k2}|c`].filter((p) => overlaps(nestedRegions(anchors, over).get(p.split('|')[0]), R(1100, 150), -1)).sort());
  const twin = areaAnchorList([{ key: 'A', x: 0, y: 0, worktrees: [{ wt: 'w1', x: 1000, y: 112 }, { wt: 'w2', x: 1100, y: 200 }] }]);
  assert.ok(regionConflicts(nestedRegions(twin, []), []).has(`${areaKey('A', 'w1')}|${areaKey('A', 'w2')}`), '같은 리포의 상자끼리');
  assert.ok(isBoxKey(k1) && !isBoxKey('A'));
});

test('P35 자리: 새 상자는 본 저장소 쪽 것의 오른쪽이나 아래, 이미 있는 상자와 겹치지 않게. 빈 리포는 그 영역 안쪽 왼쪽 위', () => {
  const content = [R(40, 112)];
  const a1 = boxSlot({ content });
  const rightOrBelow = (a, r) => (a.x === r.x + r.w + BOX_GAP && a.y === r.y) || (a.y === r.y + r.h + BOX_GAP && a.x === r.x);
  assert.ok(rightOrBelow(a1, content[0]), `노드 바로 오른쪽이나 바로 아래 ${JSON.stringify(a1)}`);
  const b1 = { ...a1, ...WT_EMPTY };
  const a2 = boxSlot({ content, boxes: [b1] });
  assert.ok(rightOrBelow(a2, b1) || rightOrBelow(a2, content[0]), `둘째는 첫 상자나 노드 옆 ${JSON.stringify(a2)}`);
  // 키 큰 노드 하나면 오른쪽(리포 영역이 덜 길쭉해진다)
  assert.deepEqual(boxSlot({ content: [R(0, 0, 600, 920)] }), { x: 600 + BOX_GAP, y: 0 });
  const b2 = { ...a2, ...WT_EMPTY };
  for (const c of [b1, b2]) for (const r of content) assert.ok(apart(c, r, BOX_GAP));
  assert.ok(apart(b1, b2, BOX_GAP));
  // 넓은 줄(노드 셋)이면 아래
  const wide = [R(0, 0), R(760, 0), R(1520, 0)];
  assert.deepEqual(boxSlot({ content: wide }), { x: 0, y: NODE.h + BOX_GAP });
  // 비었으면 리포 영역 안쪽 왼쪽 위(리포 영역 자리가 그대로)
  const main = { x: 500, y: 700, w: 800, h: 320 };
  const e = boxSlot({ main });
  assert.deepEqual(e, { x: 500 + REGION_PAD, y: 700 + REGION_HEAD + REGION_PAD });
  assert.deepEqual(regionRect([{ ...e, ...WT_EMPTY }]).x, main.x);
  assert.deepEqual(boxSlot({}), { x: 0, y: 0 });
});

test('P35 겹침 풀기: 상자만 오른쪽이나 아래로 민다(본 저장소 쪽 것은 그대로), 상자끼리는 뒤의 것을. 다시 돌리면 할 일이 없다', () => {
  const fixed = [R(0, 0), R(0, 600)];
  const boxes = [{ key: 'x', rect: R(500, 100, 480, 300) }, { key: 'y', rect: R(800, 200, 480, 300) }];
  const sh = settleBoxes(boxes, fixed);
  const after = boxes.map((b) => { const s = sh.get(b.key) || { dx: 0, dy: 0 }; return { key: b.key, rect: { ...b.rect, x: b.rect.x + s.dx, y: b.rect.y + s.dy } }; });
  for (const b of after) for (const f of fixed) assert.ok(!overlaps(b.rect, f, -1), `${b.key} 노드와 안 겹침 ${JSON.stringify(b.rect)}`);
  assert.ok(!overlaps(after[0].rect, after[1].rect, -1), '상자끼리 안 겹침');
  for (const s of sh.values()) assert.ok(s.dx >= 0 && s.dy >= 0, '오른쪽·아래로만');
  assert.equal(settleBoxes(after, fixed).size, 0);
  assert.equal(settleBoxes([], fixed).size, 0);
});

test('P35 옮기기(순수): 옛 위성 자리의 상자를 리포 영역 안으로. 결과에 다시 돌리면 옮길 것이 없다', () => {
  const content = [R(40, 112)];
  const boxes = [{ key: 'b2', rect: R(960, 900, 480, 200) }, { key: 'b1', rect: R(960, 112, 800, 612) }];
  const sh = migrateBoxes({ content, boxes });
  const moved = boxes.map((b) => { const s = sh.get(b.key) || { dx: 0, dy: 0 }; return { key: b.key, rect: { ...b.rect, x: b.rect.x + s.dx, y: b.rect.y + s.dy } }; });
  const m = Object.fromEntries(moved.map((b) => [b.key, b.rect]));
  assert.deepEqual(boxSlot({ content, size: { w: 800, h: 612 } }), { x: m.b1.x, y: m.b1.y }, '위에 있던 상자가 먼저, 노드 옆 첫 자리');
  assert.ok(apart(m.b1, m.b2, BOX_GAP) && apart(m.b1, content[0], BOX_GAP) && apart(m.b2, content[0], BOX_GAP));
  assert.equal(migrateBoxes({ content, boxes: moved }).size, 0, '여러 번 돌려도 같다');
});

// ---------- 판 위에서(가짜 백엔드) ----------
function board({ dataDir = tmp(), wts = ['p1', 'p2'] } = {}) {
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
  mk('c:/other', 'folder', 'C:/other', 6000, 0);
  const W = (n) => `${repo}/.claude/worktrees/${n}`;
  const state = { wts };
  const porcelain = () => [`worktree ${repo}`, 'HEAD 1', 'branch refs/heads/main', '', ...state.wts.flatMap((n) => [`worktree ${W(n)}`, 'HEAD 2', `branch refs/heads/worktree-${n}`, ''])].join('\n');
  b.worktrees = attachWorktrees(b, { tickMs: 0, list: async (root) => (normPath(root) === normPath(repo) ? porcelain() : null), exists: () => true });
  const add = (name, wsKey, cwd, rect) => {
    const s = { sessionId: 'id-' + name, name, kind: 'shell', workspaceKey: wsKey, cwd, rt: newRuntime({ kind: 'shell', hooked: false }), origin: 'board', createdAt: Date.now() };
    b.sessions.set(s.sessionId, s);
    if (!b.store.getSession(s.sessionId)) b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    if (rect) b.store.setNode({ session_id: s.sessionId, ...rect, z: 0 });
    return s;
  };
  const key = (n) => areaKey(ws.key, pathKey(W(n)));
  return { b, ws, add, state, W, key, dataDir };
}
const nodeOf = (b, name) => b.store.nodes().find((n) => n.session_id === 'id-' + name);
const conflicts = (b) => [...regionConflicts(ops.regions(b), ops.canvasItems(b))];

test('P35 판: 상자 둘은 리포 영역 안, 워크트리 셸은 그 상자 안, 상자를 끌면 안의 노드가 함께, 겹치면 거부, 밖으로 끌면 리포 영역이 커진다', async () => {
  const { b, ws, add, W, key } = board();
  add('main', ws.key, 'C:/repo', R(40, 112));
  add('s1', ws.key, W('p1'), R(40, 700));
  await b.worktrees.sync('t');
  const regs = ops.regions(b);
  const main = regs.get(ws.key);
  for (const n of ['p1', 'p2']) assert.ok(inside(regs.get(key(n)), main), `상자 ${n}는 리포 영역 안`);
  assert.ok(inside(nodeOf(b, 's1'), regs.get(key('p1'))), '워크트리 셸은 그 상자 안');
  assert.deepEqual(conflicts(b), []);
  assert.deepEqual(ops.settleRegions(b, 'check'), [], '더 할 일이 없다');
  // 상자 끌기: 안의 노드가 함께
  const s1 = nodeOf(b, 's1');
  ops.worktreeMove(b, { workspace: ws.key, worktree: pathKey(W('p1')), dx: 0, dy: 900 });
  assert.deepEqual([nodeOf(b, 's1').x, nodeOf(b, 's1').y], [s1.x, s1.y + 900]);
  assert.ok(inside(ops.regions(b).get(key('p1')), ops.regions(b).get(ws.key)), '리포 영역이 맞춰 감싼다');
  // 본 저장소 쪽 노드 위로 끌면 거부
  const r1 = ops.regions(b).get(key('p1')), m0 = nodeOf(b, 'main');
  assert.throws(() => ops.worktreeMove(b, { workspace: ws.key, worktree: pathKey(W('p1')), dx: m0.x - r1.x, dy: m0.y - r1.y }), (e) => e.code === 'overlap');
  // 다른 상자 위로도 거부
  const r2 = ops.regions(b).get(key('p2'));
  assert.throws(() => ops.worktreeMove(b, { workspace: ws.key, worktree: pathKey(W('p1')), dx: r2.x - r1.x + 20, dy: r2.y - r1.y + 20 }), (e) => e.code === 'overlap');
  // 리포 영역 밖(아래 빈 곳)으로 끌면 리포 영역이 커져 감싼다
  const before = ops.regions(b).get(ws.key);
  ops.worktreeMove(b, { workspace: ws.key, worktree: pathKey(W('p2')), dx: 0, dy: before.y + before.h + 400 - r2.y });
  const grown = ops.regions(b).get(ws.key);
  assert.ok(grown.h > before.h && inside(ops.regions(b).get(key('p2')), grown));
  // 커진 리포 영역이 다른 영역과 겹치면 거부(오른쪽 폴더 영역)
  const other = ops.regions(b).get('c:/other');
  const r2b = ops.regions(b).get(key('p2'));
  assert.throws(() => ops.worktreeMove(b, { workspace: ws.key, worktree: pathKey(W('p2')), dx: other.x - r2b.x + 10, dy: other.y - r2b.y }), (e) => e.code === 'overlap');
  // 리포 영역을 끌면 상자째
  const a = b.store.worktreeAreas().map((x) => [x.x, x.y]);
  ops.workspaceMove(b, { workspace: ws.key, dx: -300, dy: 200 });
  assert.deepEqual(b.store.worktreeAreas().map((x) => [x.x, x.y]), a.map(([x, y]) => [x - 300, y + 200]));
  assert.deepEqual([nodeOf(b, 's1').x, nodeOf(b, 's1').y], [s1.x - 300, s1.y + 900 + 200]);
});

test('P35 판: 상자에 노드가 늘어 본 저장소 쪽 노드와 겹치면 상자를 민다(겹침 풀기). 워크트리를 지우면 상자가 없어지고 노드는 본 저장소 쪽으로', async () => {
  const { b, ws, add, state, W, key } = board({ wts: ['p1'] });
  add('main', ws.key, 'C:/repo', R(40, 112));
  await b.worktrees.sync('t');
  const box = ops.regions(b).get(key('p1'));
  // 상자 바로 아래에 본 저장소 쪽 노드를 둔다. 상자에 노드가 들어가 커지면 그 노드와 겹친다
  add('below', ws.key, 'C:/repo', R(box.x, box.y + box.h + 20));
  for (const n of ['w1', 'w2']) {
    const at = ops.slotFor(b, { wsKey: ws.key, area: pathKey(W('p1')) });
    add(n, ws.key, W('p1'), { ...at, w: NODE.w, h: NODE.h }); b.store.setNodeArea('id-' + n, pathKey(W('p1')));
    ops.settleRegions(b, 't');
  }
  assert.deepEqual(conflicts(b), [], JSON.stringify(conflicts(b)));
  for (const n of ['w1', 'w2']) assert.ok(inside(nodeOf(b, n), ops.regions(b).get(key('p1'))), n);
  assert.deepEqual([nodeOf(b, 'main').x, nodeOf(b, 'below').x], [40, box.x], '본 저장소 쪽 노드는 옮기지 않는다');
  // 지우면 상자가 없어지고 노드는 본 저장소 쪽
  state.wts = [];
  await b.worktrees.sync('t');
  assert.ok(!ops.regions(b).has(key('p1')));
  for (const n of ['w1', 'w2']) { assert.equal(nodeOf(b, n).area, ''); assert.ok(inside(nodeOf(b, n), ops.regions(b).get(ws.key))); }
  assert.deepEqual(conflicts(b), []);
});

test('P35 정리: 영역 정리는 상자를 한 블록으로(안의 노드는 상자째), 판 전체 정리 뒤에도 상자는 리포 영역 안. 둘 다 되돌리면 그대로', async () => {
  const { b, ws, add, W, key } = board();
  add('m1', ws.key, 'C:/repo', R(40, 112));
  add('m2', ws.key, 'C:/repo', R(2600, 1800));
  add('s1', ws.key, W('p1'), R(40, 3000));
  await b.worktrees.sync('t');
  ops.worktreeMove(b, { workspace: ws.key, worktree: pathKey(W('p2')), dx: -1500, dy: 2500 });
  ops.settleRegions(b, 't');
  const snap = () => JSON.stringify({ n: b.store.nodes().map((n) => [n.session_id, n.x, n.y, n.w, n.h, n.size || null]), a: b.store.worktreeAreas().map((a) => [a.wt, a.x, a.y]), w: b.store.workspaces().map((w) => [w.key, w.x, w.y]) });
  const before = snap();
  const rel = (n, k) => { const r = ops.regions(b).get(key(k)), q = nodeOf(b, n); return [q.x - r.x, q.y - r.y]; };
  const relS1 = rel('s1', 'p1');
  const r = ops.arrange(b, { workspace: ws.key, apply: true });
  assert.ok(r.plan.some((x) => x.kind === 'wtbox'), '상자도 정리 블록');
  const regs = ops.regions(b);
  for (const k of ['p1', 'p2']) assert.ok(inside(regs.get(key(k)), regs.get(ws.key)), `정리 뒤 상자 ${k}는 리포 영역 안`);
  assert.deepEqual(rel('s1', 'p1'), relS1, '상자 안 노드는 상자째');
  assert.deepEqual(conflicts(b), []);
  ops.arrange(b, { workspace: ws.key, undo: true });
  assert.equal(snap(), before, '영역 정리 되돌리기');
  ops.arrange(b, { all: true, apply: true });
  const regs2 = ops.regions(b);
  for (const k of ['p1', 'p2']) assert.ok(inside(regs2.get(key(k)), regs2.get(ws.key)), `판 전체 정리 뒤 상자 ${k}는 리포 영역 안`);
  assert.deepEqual(conflicts(b), []);
  assert.deepEqual(ops.settleRegions(b, 'check'), []);
  ops.arrange(b, { all: true, undo: true });
  assert.equal(snap(), before, '판 전체 정리 되돌리기');
});

test('P35 옮기기(판): 옛 바깥 자리(위성)의 상자는 처음 켤 때 한 번 리포 영역 안으로. 다시 켜도 그대로', async () => {
  const dataDir = tmp();
  const first = board({ dataDir, wts: ['p1', 'p2'] });
  first.add('main', first.ws.key, 'C:/repo', R(40, 112));
  first.add('s1', first.ws.key, first.W('p1'), null);
  // 옛 판의 자리: 리포 영역 오른쪽 WT_GAP(200) 열, 그 셸은 위성 안
  const oldX = 40 + NODE.w + REGION_PAD + 200;
  first.b.store.putWorktreeArea({ wsKey: first.ws.key, wt: pathKey(first.W('p1')), path: first.W('p1'), branch: 'worktree-p1', x: oldX, y: 0 });
  first.b.store.putWorktreeArea({ wsKey: first.ws.key, wt: pathKey(first.W('p2')), path: first.W('p2'), branch: 'worktree-p2', x: oldX, y: 900 });
  first.b.store.setNode({ session_id: 'id-s1', x: oldX + REGION_PAD, y: REGION_HEAD + REGION_PAD, w: NODE.w, h: NODE.h, z: 0, area: pathKey(first.W('p1')) });
  const s1Rel = () => { const r = ops.regions(first.b).get(first.key('p1')), q = nodeOf(first.b, 's1'); return [q.x - r.x, q.y - r.y]; };
  const rel0 = s1Rel();
  const moved = ops.migrateBoxesInside(first.b);
  assert.ok(moved.length >= 1, '옮겼다');
  const regs = ops.regions(first.b);
  const m = nodeOf(first.b, 'main');
  const r1 = regs.get(first.key('p1')), r2 = regs.get(first.key('p2'));
  assert.ok((r1.x === m.x + m.w + 60 && r1.y === m.y) || (r1.y === m.y + m.h + 60 && r1.x === m.x), `본 저장소 쪽 노드 바로 옆(BOX_GAP) ${JSON.stringify([m, r1])}`);
  assert.ok(apart(r1, r2, 60) && apart(r1, m, 60) && apart(r2, m, 60));
  assert.deepEqual(s1Rel(), rel0, '상자 안 노드는 상자째');
  assert.ok(first.b.store.events({}).some((e) => e.kind === 'worktree_boxes_migrated'));
  const after = JSON.stringify(first.b.store.worktreeAreas().map((a) => [a.x, a.y]));
  assert.deepEqual(ops.migrateBoxesInside(first.b), [], '한 번만');
  // 사람이 옮긴 뒤에 다시 켜도 다시 옮기지 않는다
  ops.worktreeMove(first.b, { workspace: first.ws.key, worktree: pathKey(first.W('p2')), dx: 0, dy: 400 });
  const moved2 = JSON.stringify(first.b.store.worktreeAreas().map((a) => [a.x, a.y]));
  assert.notEqual(moved2, after);
  first.b.store.close();
  const again = board({ dataDir, wts: ['p1', 'p2'] });
  again.add('main', again.ws.key, 'C:/repo', null); again.add('s1', again.ws.key, again.W('p1'), null);
  assert.deepEqual(ops.migrateBoxesInside(again.b), []);
  assert.equal(JSON.stringify(again.b.store.worktreeAreas().map((a) => [a.x, a.y])), moved2);
  // 새 판(옛 행 없음)은 표시만 남기고 아무것도 하지 않는다
  const fresh = board({ wts: [] });
  assert.deepEqual(ops.migrateBoxesInside(fresh.b), []);
  assert.ok(fresh.b.store.getMeta(ops.BOXES_INSIDE));
});

test('P35 판: 빈 상자에 첫 노드를 놓으면 상자가 제자리에서 커지고(형제 상자를 피해 멀리 가지 않는다), 겹친 형제 상자는 겹침 풀기가 민다', async () => {
  const { b, ws, add, W, key } = board();
  add('main', ws.key, 'C:/repo', R(40, 112));
  await b.worktrees.sync('t');
  const a1 = b.store.worktreeAreas().find((a) => a.wt === pathKey(W('p1')));
  const at = ops.slotFor(b, { wsKey: ws.key, area: pathKey(W('p1')) });
  assert.deepEqual([at.x, at.y], [a1.x + REGION_PAD, a1.y + REGION_HEAD + REGION_PAD], '상자 안쪽 왼쪽 위');
  add('w1', ws.key, W('p1'), { ...at, w: NODE.w, h: NODE.h }); b.store.setNodeArea('id-w1', pathKey(W('p1')));
  ops.settleRegions(b, 't');
  assert.deepEqual(conflicts(b), []);
  for (const k of ['p1', 'p2']) assert.ok(inside(ops.regions(b).get(key(k)), ops.regions(b).get(ws.key)));
});
