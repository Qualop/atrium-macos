// P23 단위 시험: 덩어리 다듬기. 붙은 노드 테두리 끌기(안쪽은 분할선, 바깥은 그 쪽으로 커지고 줄기), 엇갈리는 점, 반반,
// 고른 노드 막대의 가로·세로 크기와 덩어리 전체 바깥 크기(board.setSize scope dock). herdr와 claude 없이 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NODE, SIZE_STEPS, SIZE_DIRS, SIZE_LEVELS } from '../src/canvas.mjs';
import { LEAF_MIN, layout, leafPath, edgeOf, resizeOuterEdge, dragEdge, junctions, moveJunction, evenDivider, moveDivider, presetTree, normalize, dockVirtual } from '../src/dock-tree.mjs';
import { newRuntime } from '../src/state.mjs';
import { Store } from '../src/store.mjs';
import * as ops from '../src/canvas-ops.mjs';

const BAR_SIZES = Object.fromEntries(SIZE_DIRS.map((dir) => [dir, SIZE_LEVELS.map((level) => `${dir}-${level}`)]));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });
const rects = (t, outer) => Object.fromEntries(layout(t, outer).rects);
// 1 + 2: a | (b / c)
const ML = normalize({ dir: 'row', kids: ['a', { dir: 'col', kids: ['b', 'c'], ratios: [0.5, 0.5] }], ratios: [0.5, 0.5] });
const GRID = presetTree('grid', ['a', 'b', 'c', 'd']); // (a | b) / (c | d)
const O = R(0, 0, 1440, 920);

test('크기 값: 가로는 16:9, 세로는 세로가 더 길고 터미널이 읽히는 너비, 막대의 두 줄', () => {
  assert.deepEqual(BAR_SIZES, { wide: ['wide-large', 'wide-normal', 'wide-small'], tall: ['tall-large', 'tall-normal', 'tall-small'] });
  for (const k of BAR_SIZES.wide) assert.ok(Math.abs(SIZE_STEPS[k].w / SIZE_STEPS[k].h - 16 / 9) < 0.01, `${k}는 16:9`);
  for (const k of BAR_SIZES.tall) {
    const r = SIZE_STEPS[k].w / SIZE_STEPS[k].h;
    assert.ok(r >= 9 / 16 && r <= 3 / 4, `${k}는 3:4와 9:16 사이(${r.toFixed(3)})`);
    assert.ok(SIZE_STEPS[k].w >= 480, `${k}의 너비는 480 이상`);
  }
  assert.deepEqual(SIZE_STEPS['wide-large'], { w: 1920, h: 1080 }, 'P73: 가로 16:9 크게');
  for (const dir of Object.values(BAR_SIZES)) assert.ok(SIZE_STEPS[dir[0]].w > SIZE_STEPS[dir[1]].w && SIZE_STEPS[dir[1]].w > SIZE_STEPS[dir[2]].w, '크게 > 보통 > 작게');
  assert.deepEqual([SIZE_STEPS.large, SIZE_STEPS.normal, SIZE_STEPS.small], [{ w: 1920, h: 1080 }, { w: 1440, h: 810 }, { w: 1040, h: 585 }], 'P73: 옛 단계 열쇠는 16:9 가로 단계로 풀린다');
});

test('테두리 종류: 이웃과 맞닿은 쪽은 그 사이 분할선(가장 가까운 마디), 덩어리 바깥 쪽은 outer', () => {
  assert.deepEqual(leafPath(ML, 'c'), [1, 1]);
  assert.equal(leafPath(ML, 'z'), null);
  assert.deepEqual(edgeOf(ML, 'a', 'right'), { kind: 'divider', path: [], index: 0, dir: 'row' });
  assert.deepEqual(edgeOf(ML, 'b', 'left'), { kind: 'divider', path: [], index: 0, dir: 'row' });
  assert.deepEqual(edgeOf(ML, 'b', 'bottom'), { kind: 'divider', path: [1], index: 0, dir: 'col' });
  assert.deepEqual(edgeOf(ML, 'c', 'top'), { kind: 'divider', path: [1], index: 0, dir: 'col' });
  for (const [id, side] of [['a', 'left'], ['a', 'top'], ['a', 'bottom'], ['b', 'top'], ['b', 'right'], ['c', 'right'], ['c', 'bottom']]) assert.deepEqual(edgeOf(ML, id, side), { kind: 'outer', side }, `${id} ${side}`);
  assert.equal(edgeOf(ML, 'z', 'left'), null);
});

test('안쪽 테두리 끌기는 그 분할선을 옮긴다(분할선 끌기와 같은 결과)', () => {
  const r = dragEdge(ML, O, 'b', 'bottom', 100);
  assert.deepEqual(r.tree, moveDivider(ML, O, [1], 0, 100));
  assert.deepEqual(r.outer, O);
  assert.deepEqual(rects(r.tree, r.outer).b, R(720, 0, 720, 560));
  const l = dragEdge(ML, O, 'b', 'left', -120);
  assert.deepEqual([rects(l.tree, l.outer).a.w, rects(l.tree, l.outer).b.w], [600, 840]);
});

test('바깥 테두리 끌기: 그 쪽으로 덩어리가 커지고 줄며, 다른 칸의 길이는 그대로', () => {
  // c의 오른쪽(오른쪽 열 전체가 넓어진다), a는 그대로
  let r = dragEdge(ML, O, 'c', 'right', 200);
  assert.deepEqual(r.outer, R(0, 0, 1640, 920));
  let rs = rects(r.tree, r.outer);
  assert.deepEqual([rs.a, rs.b, rs.c], [R(0, 0, 720, 920), R(720, 0, 920, 460), R(720, 460, 920, 460)]);
  // a의 왼쪽을 바깥으로: 왼쪽으로 커진다(오른쪽 열은 그대로)
  r = dragEdge(ML, O, 'a', 'left', -100);
  assert.deepEqual(r.outer, R(-100, 0, 1540, 920));
  rs = rects(r.tree, r.outer);
  assert.deepEqual([rs.a, rs.b], [R(-100, 0, 820, 920), R(720, 0, 720, 460)]);
  // c의 아래: c만 길어지고 b는 그대로, a는 덩어리 높이를 따른다
  r = dragEdge(ML, O, 'c', 'bottom', 140);
  rs = rects(r.tree, r.outer);
  assert.deepEqual(r.outer, R(0, 0, 1440, 1060));
  assert.deepEqual([rs.a.h, rs.b, rs.c], [1060, R(720, 0, 720, 460), R(720, 460, 720, 600)]);
  // b의 위: 위로 커지고 c는 그대로
  r = dragEdge(ML, O, 'b', 'top', -60);
  rs = rects(r.tree, r.outer);
  assert.deepEqual([r.outer.y, rs.b, rs.c], [-60, R(720, -60, 720, 520), R(720, 460, 720, 460)]);
  // 줄일 때는 잎 쪽 칸의 최소 크기까지만
  r = dragEdge(ML, O, 'c', 'right', -5000);
  rs = rects(r.tree, r.outer);
  assert.deepEqual([r.outer.w, rs.a.w, rs.c.w], [720 + LEAF_MIN.w, 720, LEAF_MIN.w]);
  r = resizeOuterEdge(ML, O, 'a', 'top', -5000);
  assert.equal(r.outer.h, 2 * LEAF_MIN.h, '세로로 둘이 쌓인 쪽의 최소 높이');
  // 바깥이 아닌 쪽은 바뀌지 않는다
  assert.equal(resizeOuterEdge(ML, O, 'a', 'right', 100).delta, 0);
});

test('2 × 2 바깥 테두리: b의 오른쪽은 위 줄의 b만 넓히고(a 그대로), 아래 줄은 비율대로 따른다', () => {
  const r = dragEdge(GRID, O, 'b', 'right', 160);
  const rs = rects(r.tree, r.outer);
  assert.deepEqual(r.outer, R(0, 0, 1600, 920));
  assert.deepEqual([rs.a.w, rs.b.w, rs.c.w, rs.d.w], [720, 880, 800, 800]);
});

test('엇갈리는 점: 2 × 2 가운데 하나(세로선 둘, 가로선 하나), 1 + 2에는 없다(T자), 옮기면 가로·세로 함께', () => {
  const js = junctions(GRID, O);
  assert.equal(js.length, 1);
  assert.deepEqual([js[0].x, js[0].y], [720, 460]);
  assert.deepEqual(js[0].rows, [{ path: [0], index: 0 }, { path: [1], index: 0 }]);
  assert.deepEqual(js[0].cols, [{ path: [], index: 0 }]);
  assert.deepEqual(junctions(ML, O), [], 'T자는 엇갈리는 점이 아니다');
  const t2 = moveJunction(GRID, O, js[0], 100, -60);
  const rs = rects(t2, O);
  assert.deepEqual([rs.a, rs.b, rs.c, rs.d], [R(0, 0, 820, 400), R(820, 0, 620, 400), R(0, 400, 820, 520), R(820, 400, 620, 520)]);
  const again = junctions(t2, O);
  assert.deepEqual([again.length, again[0].x, again[0].y], [1, 820, 400]);
  // 위 줄 세로선만 옮기면 엇갈리지 않는다(T자 둘)
  assert.deepEqual(junctions(moveDivider(GRID, O, [0], 0, 50), O), []);
  // 최소 크기를 지킨다
  const far = rects(moveJunction(GRID, O, js[0], 5000, 5000), O);
  assert.deepEqual([far.b.w, far.c.h], [LEAF_MIN.w, LEAF_MIN.h]);
});

test('반반: 분할선의 두 쪽을 같게(합은 그대로), 세 칸 마디는 그 두 쪽만', () => {
  const moved = moveDivider(ML, O, [], 0, 300);
  const even = evenDivider(moved, O, [], 0);
  const rs = rects(even, O);
  assert.deepEqual([rs.a.w, rs.b.w], [720, 720]);
  const row3 = normalize({ dir: 'row', kids: ['a', 'b', 'c'], ratios: [0.5, 0.3, 0.2] });
  const r3 = rects(evenDivider(row3, R(0, 0, 3000, 460), [], 1), R(0, 0, 3000, 460));
  assert.deepEqual([r3.a.w, r3.b.w, r3.c.w], [1500, 750, 750]);
  assert.deepEqual(evenDivider(ML, O, [9], 0), ML, '없는 분할선');
});

// ---------- 판 API ----------
function fakeBackend() {
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p23-')), 'board.db'));
  const sessions = new Map();
  const b = { store, sessions, events: [], api: { broadcast: () => {} }, log: () => {}, nameOf: (sid) => (sessions.get(sid) || { name: sid }).name };
  b.resolve = (ref) => { const s = sessions.get(ref) || [...sessions.values()].find((x) => x.name === ref); if (!s) throw Object.assign(new Error(`없는 세션: ${ref}`), { code: 'not_found' }); return s; };
  b.groupMembers = () => [];
  store.insertWorkspace({ key: 'ws', kind: 'folder', root: 'C:/ws', createdAt: 1 });
  const add = (name, rect) => {
    const s = { sessionId: `id-${name}`, name, kind: 'shell', workspaceKey: 'ws', cwd: 'C:/ws', rt: newRuntime({ kind: 'shell', hooked: false }), origin: 'board', groupId: null, createdAt: 1 };
    sessions.set(s.sessionId, s);
    store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    store.setNode({ session_id: s.sessionId, ...rect, z: 0 });
  };
  const at = (name) => { const n = store.nodes().find((x) => x.session_id === `id-${name}`); return n && R(n.x, n.y, n.w, n.h); };
  return { b, add, at };
}

test('API: 막대의 크기는 덩어리 안 노드면 덩어리 전체 바깥에(scope dock), 혼자인 노드는 그 노드에. 테두리 끌기 저장(dock.update)', () => {
  const { b, add, at } = fakeBackend();
  add('a', R(0, 0)); add('b', R(2000, 0)); add('c', R(4000, 0)); add('z', R(8000, 0));
  ops.dockLayout(b, { members: ['a', 'b', 'c'], preset: 'main-left' });
  const d = ops.dockOf(b, 'id-a');
  const o = ops.dockOuter(b, d);
  ops.setSize(b, { session: 'b', size: 'wide-large', scope: 'dock' });
  const wide = ops.dockOuter(b, ops.dockOf(b, 'id-a'));
  const virtualWide = dockVirtual(d.tree, wide);
  assert.deepEqual([wide.x, wide.y], [o.x, o.y]);
  assert.ok(Math.abs(virtualWide.w - 1920) <= 2 && Math.abs(virtualWide.h - 1080) <= 2, 'P80: 덩어리의 단독 세션 크기');
  assert.equal(JSON.stringify(ops.dockOf(b, 'id-a').tree), JSON.stringify(d.tree), '비율은 그대로');
  ops.setSize(b, { session: 'a', size: 'tall-small', scope: 'dock' });
  const tall = ops.dockOuter(b, ops.dockOf(b, 'id-a'));
  const virtualTall = dockVirtual(d.tree, tall);
  assert.deepEqual([tall.x, tall.y], [o.x, o.y]);
  assert.ok(Math.abs(virtualTall.w - 585) <= 2 && Math.abs(virtualTall.h - 1040) <= 2, 'P80: 세로 작게도 틀 비율과 단독 세션 크기를 지킨다');
  ops.setSize(b, { session: 'z', size: 'tall-normal', scope: 'dock' });
  assert.deepEqual([at('z').w, at('z').h], [810, 1440], '혼자인 노드는 scope를 무시하고 그 노드');
  ops.setSize(b, { session: 'z', size: 'wide-small' });
  assert.deepEqual([at('z').w, at('z').h], [1040, 585]);
  assert.throws(() => ops.setSize(b, { session: 'z', size: 'wide-huge' }), /크기/);
  // 창의 바깥 테두리 끌기가 보내는 것: 나무와 바깥(왼쪽으로 커짐)
  const now = ops.dockOuter(b, ops.dockOf(b, 'id-a'));
  const r = dragEdge(ops.dockOf(b, 'id-a').tree, now, 'id-a', 'left', -100);
  ops.dockUpdate(b, { dock: d.dockId, tree: r.tree, x: r.outer.x, y: r.outer.y, w: r.outer.w, h: r.outer.h });
  assert.deepEqual(ops.dockOuter(b, ops.dockOf(b, 'id-a')), R(now.x - 100, now.y, now.w + 100, now.h));
  assert.equal(at('a').w, rects(ops.dockOf(b, 'id-a').tree, r.outer)['id-a'].w);
  b.store.close();
});
