// P17 단위 시험: 붙여 묶기의 분할 나무(dock-tree.mjs)와 판 API(canvas-ops.mjs). 넣기, 빼기, 정리, 비율(분할선), 배치 틀, 옛 한 줄 행 바꾸기,
// 붙을 자리(Ctrl+끌기), 덩어리 안 노드 닫기, 바깥 크기, 다시 열어도 같은 나무. herdr와 claude 없이 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NODE } from '../src/canvas.mjs';
import {
  LEAF_MIN, leaves, normalize, fromLine, minSize, layout, insert, remove, removeWithOuter, insertWithOuter, moveDivider, rootSizes,
  presetTree, presetSize, PRESETS, dropZone, edgeSnap, adjacentPairs,
} from '../src/dock-tree.mjs';
import { newRuntime } from '../src/state.mjs';
import { Store } from '../src/store.mjs';
import * as ops from '../src/canvas-ops.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p17-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });
const rectsOf = (t, outer) => Object.fromEntries([...layout(t, outer).rects].map(([k, v]) => [k, v]));
// 늘어놓은 잎이 바깥을 틈 없이, 겹치지 않고 채우는가
function tiles(t, outer) {
  const lay = layout(t, outer);
  const rs = [...lay.rects.values()];
  const area = rs.reduce((a, r) => a + r.w * r.h, 0);
  const ov = rs.some((a, i) => rs.some((b, j) => j > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
  return area === lay.outer.w * lay.outer.h && !ov && rs.every((r) => r.x >= lay.outer.x && r.y >= lay.outer.y && r.x + r.w <= lay.outer.x + lay.outer.w && r.y + r.h <= lay.outer.y + lay.outer.h);
}

test('나무 정리: 빈 마디와 자식 하나만 남은 마디를 없애고, 같은 방향 마디는 편다(비율은 곱한다), 겹친 잎과 잘못된 비율', () => {
  assert.equal(normalize({ dir: 'row', kids: ['a'], ratios: [1] }), 'a');
  assert.equal(normalize({ dir: 'row', kids: [], ratios: [] }), null);
  assert.deepEqual(normalize({ dir: 'row', kids: ['a', { dir: 'row', kids: ['b', 'c'], ratios: [0.5, 0.5] }], ratios: [0.5, 0.5] }), { dir: 'row', kids: ['a', 'b', 'c'], ratios: [0.5, 0.25, 0.25] });
  assert.deepEqual(normalize({ dir: 'col', kids: ['a', { dir: 'row', kids: ['b'], ratios: [1] }, null], ratios: [1, 3, 9] }), { dir: 'col', kids: ['a', 'b'], ratios: [0.25, 0.75] });
  assert.deepEqual(normalize({ dir: 'row', kids: ['a', 'a', 'b'], ratios: [1, 1, 1] }).kids, ['a', 'b'], '겹친 잎은 처음 것만');
  assert.deepEqual(normalize({ dir: 'row', kids: ['a', 'b'], ratios: [-1, 'x'] }).ratios, [0.5, 0.5]);
  assert.deepEqual(leaves({ dir: 'row', kids: ['a', { dir: 'col', kids: ['b', 'c'], ratios: [1, 1] }], ratios: [1, 1] }), ['a', 'b', 'c']);
});

test('늘어놓기: 바깥을 틈 없이 채우고(정수 좌표), 잎마다 최소 크기를 지키며 모자라면 바깥이 커진다', () => {
  const t = { dir: 'row', kids: ['a', { dir: 'col', kids: ['b', 'c'], ratios: [0.5, 0.5] }], ratios: [0.6, 0.4] };
  const r = rectsOf(t, R(100, 50, 1440, 920));
  assert.deepEqual(r.a, R(100, 50, 864, 920));
  assert.deepEqual(r.b, R(964, 50, 576, 460));
  assert.deepEqual(r.c, R(964, 510, 576, 460));
  assert.ok(tiles(t, R(100, 50, 1440, 920)));
  assert.ok(tiles(t, R(3, 7, 1001, 777)), '나눠떨어지지 않아도 틈이 없다');
  assert.deepEqual(minSize(t), { w: 2 * LEAF_MIN.w, h: 2 * LEAF_MIN.h });
  const small = layout(t, R(0, 0, 100, 100));
  assert.deepEqual([small.outer.w, small.outer.h], [480, 320], '바깥이 최소까지 커진다');
  // 비율이 한쪽으로 쏠려도 작은 쪽은 최소 크기
  const skew = rectsOf({ dir: 'row', kids: ['a', 'b'], ratios: [0.99, 0.01] }, R(0, 0, 1000, 400));
  assert.deepEqual([skew.a.w, skew.b.w], [1000 - LEAF_MIN.w, LEAF_MIN.w]);
  // 분할선: 마디마다 자식 사이에 하나, 맞닿은 잎 쌍
  const lay = layout(t, R(0, 0, 1440, 920));
  assert.deepEqual(lay.dividers.map((d) => [d.path.join('.'), d.index, d.dir, d.at]), [['', 0, 'row', 864], ['1', 0, 'col', 460]]);
  assert.deepEqual(lay.dividers.find((d) => d.dir === 'row').pairs, [['a', 'b'], ['a', 'c']]);
  assert.deepEqual(adjacentPairs(t, R(0, 0, 1440, 920)), [['a', 'b'], ['a', 'c'], ['b', 'c']]);
});

test('넣기: 잎을 반으로 나누기(leaf)와 덩어리 전체 옆 새 칸(dock), 같은 덩어리 안에서 옮기기', () => {
  const row = fromLine('row', ['a', 'b'], [720, 720]);
  // b 아래에 n: b가 위아래로 반씩
  const t1 = insert(row, { target: 'b', side: 'bottom', id: 'n' });
  assert.deepEqual(t1, { dir: 'row', kids: ['a', { dir: 'col', kids: ['b', 'n'], ratios: [0.5, 0.5] }], ratios: [0.5, 0.5] });
  const r1 = rectsOf(t1, R(0, 0, 1440, 460));
  assert.deepEqual([r1.b, r1.n], [R(720, 0, 720, 230), R(720, 230, 720, 230)]);
  // 같은 방향이면 그 마디에 펴서 들어간다(a 오른쪽 = a와 b 사이)
  assert.deepEqual(insert(row, { target: 'a', side: 'right', id: 'n' }), { dir: 'row', kids: ['a', 'n', 'b'], ratios: [0.25, 0.25, 0.5] });
  // 가로 덩어리 전체 아래: 바깥이 끌어 온 노드 높이만큼 커지고 새 칸은 너비 전체
  const d1 = insertWithOuter(row, R(0, 0, 1440, 460), { target: 'a', side: 'bottom', id: 'n', at: 'dock', size: { w: 720, h: 460 } });
  assert.deepEqual(d1.outer, R(0, 0, 1440, 920));
  const rd = rectsOf(d1.tree, d1.outer);
  assert.deepEqual([rd.a, rd.b, rd.n], [R(0, 0, 720, 460), R(720, 0, 720, 460), R(0, 460, 1440, 460)]);
  // 왼쪽 위로 붙으면 덩어리가 그만큼 앞에서 시작
  const d2 = insertWithOuter(row, R(0, 0, 1440, 460), { target: 'a', side: 'left', id: 'n', at: 'dock', size: { w: 480, h: 300 } });
  assert.deepEqual(d2.outer, R(-480, 0, 1920, 460));
  assert.deepEqual(rectsOf(d2.tree, d2.outer).n, R(-480, 0, 480, 460));
  // 이미 나무에 있으면 먼저 뺀다
  assert.deepEqual(leaves(insert(t1, { target: 'a', side: 'top', id: 'n' })), ['n', 'a', 'b']);
  assert.equal(insert('a', { target: 'a', side: 'right', id: 'a' }), 'a');
});

test('빼기와 정리: 자식 하나만 남은 마디는 없앤다. 뿌리 바로 아래 칸이면 바깥이 줄고(왼쪽 위 그대로), 안쪽 칸이면 이웃이 채운다', () => {
  const t = { dir: 'row', kids: ['a', { dir: 'col', kids: ['b', 'c'], ratios: [0.5, 0.5] }], ratios: [0.6, 0.4] };
  assert.deepEqual(remove(t, 'c'), { dir: 'row', kids: ['a', 'b'], ratios: [0.6, 0.4] });
  const inner = removeWithOuter(t, R(0, 0, 1440, 920), 'c');
  assert.deepEqual(inner.outer, R(0, 0, 1440, 920), '안쪽 칸: 바깥 그대로');
  assert.deepEqual(rectsOf(inner.tree, inner.outer).b, R(864, 0, 576, 920), 'b가 c 자리까지 채운다');
  const root = removeWithOuter(t, R(0, 0, 1440, 920), 'a');
  assert.deepEqual(root.outer, R(0, 0, 576, 920), '뿌리 칸: 그만큼 줄고 왼쪽 위 그대로');
  assert.deepEqual(rectsOf(root.tree, root.outer), { b: R(0, 0, 576, 460), c: R(0, 460, 576, 460) });
  assert.equal(remove(remove(t, 'a'), 'b'), 'c');
  assert.equal(remove('a', 'a'), null);
});

test('비율: 분할선은 그 마디의 두 쪽만 바꾸고(합 그대로), 최소 크기를 지킨다. 옛 sizes는 뿌리 마디 길이', () => {
  const t = { dir: 'row', kids: ['a', { dir: 'col', kids: ['b', 'c'], ratios: [0.5, 0.5] }], ratios: [0.6, 0.4] };
  const outer = R(0, 0, 1440, 920);
  const t2 = moveDivider(t, outer, [1], 0, 100); // 오른쪽 위아래 사이 선을 아래로 100
  const r2 = rectsOf(t2, outer);
  assert.deepEqual([r2.b.h, r2.c.h, r2.a.w], [560, 360, 864]);
  const t3 = moveDivider(t2, outer, [], 0, -2000); // 왼쪽 큰 칸을 끝까지 줄여도 최소
  assert.equal(rectsOf(t3, outer).a.w, LEAF_MIN.w);
  assert.deepEqual(rectsOf(t3, outer).b.h, 560, '다른 마디 비율은 그대로');
  assert.equal(moveDivider(t, outer, [0], 0, 50), t, '잎 자리는 마디가 아니다');
  const { tree, outer: o } = rootSizes(fromLine('row', ['m', 'a', 'n']), R(100, 0, 2160, 460), [600, 840, 480]);
  assert.deepEqual([o.w, ...Object.values(rectsOf(tree, o)).map((r) => r.x)], [1920, 100, 700, 1540]);
});

test('배치 틀: 1+2, 2+1, 2×2, 가로·세로 셋, 한 줄. 칸보다 적으면 빈 칸을 없애고, 많으면 마지막 칸을 다시 나눈다', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(presetTree('main-left', ids.slice(0, 3)), { dir: 'row', kids: ['a', { dir: 'col', kids: ['b', 'c'], ratios: [0.5, 0.5] }], ratios: [0.6, 0.4] });
  assert.deepEqual(presetTree('main-right', ids.slice(0, 3)), { dir: 'row', kids: [{ dir: 'col', kids: ['a', 'b'], ratios: [0.5, 0.5] }, 'c'], ratios: [0.4, 0.6] });
  assert.deepEqual(presetTree('grid', ids.slice(0, 4)), { dir: 'col', kids: [{ dir: 'row', kids: ['a', 'b'], ratios: [0.5, 0.5] }, { dir: 'row', kids: ['c', 'd'], ratios: [0.5, 0.5] }], ratios: [0.5, 0.5] });
  assert.deepEqual(presetTree('grid', ids.slice(0, 3)), { dir: 'col', kids: [{ dir: 'row', kids: ['a', 'b'], ratios: [0.5, 0.5] }, 'c'], ratios: [0.5, 0.5] }, '칸이 비면 없앤다');
  assert.deepEqual(presetTree('main-left', ids), { dir: 'row', kids: ['a', { dir: 'col', kids: ['b', { dir: 'row', kids: ['c', 'd', 'e'], ratios: [1 / 3, 1 / 3, 1 / 3].map((x) => Math.round(x * 1e6) / 1e6) }], ratios: [0.5, 0.5] }], ratios: [0.6, 0.4] }, '남는 노드는 마지막 칸을 다른 방향으로');
  assert.deepEqual(leaves(presetTree('row3', ids)), ids);
  assert.equal(presetTree('row3', ids).dir, 'row');
  assert.deepEqual(presetTree('col', ['a', 'b']), { dir: 'col', kids: ['a', 'b'], ratios: [0.5, 0.5] });
  assert.deepEqual(presetSize('main-left', 3, NODE), { w: 1440, h: 920 });
  assert.deepEqual(presetSize('row', 4, NODE), { w: 2880, h: 460 });
  assert.deepEqual(presetSize('col3', 3, NODE), { w: 720, h: 1380 });
  for (const name of Object.keys(PRESETS)) { const t = presetTree(name, ids); assert.ok(tiles(t, R(0, 0, 2000, 1500)), name); assert.deepEqual(leaves(t).sort(), [...ids].sort(), name); }
  assert.throws(() => presetTree('nope', ids), /분할 레이아웃/);
});

test('옛 한 줄 행: 노드 크기 비율의 한 마디 나무로 바꾼다(모양 그대로)', () => {
  assert.deepEqual(fromLine('row', ['a', 'b', 'c'], [600, 840, 480]), { dir: 'row', kids: ['a', 'b', 'c'], ratios: [0.3125, 0.4375, 0.25] });
  assert.deepEqual(fromLine('col', ['a', 'b']), { dir: 'col', kids: ['a', 'b'], ratios: [0.5, 0.5] });
  const r = rectsOf(fromLine('row', ['a', 'b', 'c'], [600, 840, 480]), R(100, 0, 1920, 460));
  assert.deepEqual([r.a, r.b, r.c], [R(100, 0, 600, 460), R(700, 0, 840, 460), R(1540, 0, 480, 460)]);
});

test('붙을 자리(Ctrl+끌기): 잎 안쪽은 가장 가까운 가장자리로 반 나누기, 덩어리 바깥 가장자리 쪽은 덩어리 전체 옆, 멀면 없음', () => {
  const blocks = [{ dockId: 'd1', rect: R(0, 0, 1440, 460), leaves: [{ id: 'a', ...R(0, 0) }, { id: 'b', ...R(720, 0) }] }, { dockId: null, rect: R(3000, 0), leaves: [{ id: 'z', ...R(3000, 0) }] }];
  const z = (x, y) => dropZone({ x, y }, blocks, { band: 40, drag: { w: 720, h: 460 } });
  assert.deepEqual(z(1080, 400), { at: 'leaf', side: 'bottom', target: 'b', dockId: 'd1', preview: R(720, 230, 720, 230) }, 'b 아래쪽: b를 위아래로');
  assert.deepEqual(z(1300, 200).side, 'right');
  assert.equal(z(1300, 200).at, 'leaf');
  assert.deepEqual(z(800, 470), { at: 'dock', side: 'bottom', target: 'b', dockId: 'd1', preview: R(0, 460, 1440, 460) }, '덩어리 아래 가장자리 바깥: 덩어리 전체 아래');
  assert.deepEqual([z(700, 455).at, z(700, 455).side, z(700, 455).target], ['dock', 'bottom', 'a'], '안쪽 가장자리 띠도 덩어리 전체');
  assert.deepEqual([z(1460, 100).at, z(1460, 100).side], ['dock', 'right']);
  assert.equal(z(1600, 100), null, '멀면 없음');
  assert.deepEqual([z(3360, 300).at, z(3360, 300).side, z(3360, 300).target, z(3360, 300).dockId], ['leaf', 'bottom', 'z', null], '혼자인 노드도 반으로');
  // 그냥 끌기: 덩어리 바깥 가장자리 가까이
  const s = edgeSnap({ id: 'n', ...R(100, 470) }, [{ id: 'a', dockId: 'd1', ...R(0, 0, 1440, 460), edgeLeaf: (side) => (side === 'bottom' ? 'b' : 'a') }], 80);
  assert.deepEqual([s.targetId, s.side, s.at, s.dockId], ['b', 'bottom', 'dock', 'd1']);
});

// ---------- 판 API ----------
function fakeBackend(file = path.join(tmp(), 'board.db')) {
  const store = new Store(file);
  const events = [];
  const sessions = new Map();
  const b = { store, sessions, events, api: { broadcast: (event, data) => events.push({ event, data }) }, log: () => {}, nameOf: (sid) => (sessions.get(sid) || { name: sid }).name };
  b.resolve = (ref) => { const s = sessions.get(ref) || [...sessions.values()].find((x) => x.name === ref); if (!s) throw Object.assign(new Error(`없는 세션: ${ref}`), { code: 'not_found' }); return s; };
  store.insertWorkspace({ key: 'ws', kind: 'folder', root: 'C:/ws', createdAt: 1 });
  store.insertWorkspace({ key: 'other', kind: 'folder', root: 'C:/other', createdAt: 1 });
  const add = (name, rect, ws = 'ws') => {
    const s = { sessionId: `id-${name}`, name, kind: 'shell', workspaceKey: ws, cwd: 'C:/ws', rt: newRuntime({ kind: 'shell', hooked: false }), origin: 'board', createdAt: 1 };
    sessions.set(s.sessionId, s);
    store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    store.setNode({ session_id: s.sessionId, ...rect, z: 0 });
    return s;
  };
  const at = (name) => { const n = store.nodes().find((x) => x.session_id === `id-${name}`); return n && R(n.x, n.y, n.w, n.h); };
  const shape = (d) => JSON.stringify(d.tree).replace(/id-/g, '');
  return { b, add, at, shape, file };
}

test('API: 가로 덩어리 아래에 붙이기, 덩어리 안 노드 하나의 아래·오른쪽, 같은 덩어리 안에서 옮기기, 다른 워크스페이스 거부', () => {
  const { b, add, at, shape } = fakeBackend();
  add('a', R(0, 0)); add('b', R(2000, 0)); add('c', R(4000, 0)); add('d', R(6000, 0)); add('x', R(9000, 0), 'other');
  let r = ops.dockAttach(b, { session: 'b', to: 'a', side: 'right' });
  assert.equal(r.at, 'dock', '혼자인 대상에는 옆 새 칸(옛 붙이기)');
  assert.deepEqual([at('a'), at('b')], [R(0, 0), R(720, 0)]);
  // 가로 덩어리 전체 아래
  r = ops.dockAttach(b, { session: 'c', to: 'a', side: 'bottom', at: 'dock' });
  assert.equal(shape(r.dock), '{"dir":"col","kids":[{"dir":"row","kids":["a","b"],"ratios":[0.5,0.5]},"c"],"ratios":[0.5,0.5]}');
  assert.deepEqual(at('c'), R(0, 460, 1440, 460));
  // 덩어리 안 노드 하나(b)의 아래: b가 위아래로 나뉜다
  r = ops.dockAttach(b, { session: 'd', to: 'b', side: 'bottom' });
  assert.equal(r.at, 'leaf');
  assert.deepEqual([at('b'), at('d'), at('a'), at('c')], [R(720, 0, 720, 230), R(720, 230, 720, 230), R(0, 0, 720, 460), R(0, 460, 1440, 460)]);
  // 같은 덩어리 안에서 옮기기: d를 a 오른쪽으로(바깥은 그대로)
  ops.dockAttach(b, { session: 'd', to: 'a', side: 'right' });
  const d = ops.dockOf(b, 'id-a');
  assert.deepEqual(ops.dockOuter(b, d), R(0, 0, 1440, 920));
  assert.deepEqual(d.members, ['id-a', 'id-d', 'id-b', 'id-c']);
  assert.deepEqual([at('a').w, at('d').w, at('b'), at('c')], [360, 360, R(720, 0, 720, 460), R(0, 460, 1440, 460)]);
  assert.throws(() => ops.dockAttach(b, { session: 'x', to: 'a', side: 'right' }), (e) => e.code === 'bad_request');
  assert.throws(() => ops.dockAttach(b, { session: 'a', to: 'b', side: 'right', at: 'middle' }), /at/);
  assert.ok(b.events.some((e) => e.event === 'board.changed'));
  b.store.close();
});

test('API: 3분할을 끌기로(왼쪽 크게 + 오른쪽 위아래)와 틀로, 2×2 틀, 덩어리를 틀로 다시 짜기', () => {
  const { b, add, at, shape } = fakeBackend();
  add('a', R(0, 0)); add('b', R(2000, 0)); add('c', R(4000, 0)); add('d', R(6000, 0));
  // 끌기: b를 a 오른쪽에(새 칸), c를 b 아래에(반 나누기)
  ops.dockAttach(b, { session: 'b', to: 'a', side: 'right' });
  ops.dockAttach(b, { session: 'c', to: 'b', side: 'bottom' });
  assert.equal(shape(ops.dockOf(b, 'id-a')), '{"dir":"row","kids":["a",{"dir":"col","kids":["b","c"],"ratios":[0.5,0.5]}],"ratios":[0.5,0.5]}');
  assert.deepEqual([at('a'), at('b'), at('c')], [R(0, 0), R(720, 0, 720, 230), R(720, 230, 720, 230)]);
  // 같은 덩어리를 2×2 틀로 다시(바깥 그대로, 노드 하나 더하면 새 크기)
  let r = ops.dockLayout(b, { members: ['a'], preset: 'main-left', cellW: NODE.w, cellH: NODE.h });
  assert.equal(shape(r.dock), '{"dir":"row","kids":["a",{"dir":"col","kids":["b","c"],"ratios":[0.5,0.5]}],"ratios":[0.6,0.4]}', '덩어리 하나를 고르면 그 덩어리 전체');
  assert.deepEqual(at('a'), R(0, 0, 864, 460), '같은 덩어리면 바깥 크기를 지킨다');
  r = ops.dockLayout(b, { members: ['d', 'a'], preset: 'grid', cellW: NODE.w, cellH: NODE.h });
  assert.equal(shape(r.dock), '{"dir":"col","kids":[{"dir":"row","kids":["d","a"],"ratios":[0.5,0.5]},{"dir":"row","kids":["b","c"],"ratios":[0.5,0.5]}],"ratios":[0.5,0.5]}');
  assert.deepEqual([at('d'), at('a'), at('b'), at('c')], [R(6000, 0), R(6720, 0), R(6000, 460), R(6720, 460)], '첫 노드 자리에서 칸마다 보통 크기');
  assert.equal(b.store.docks().length, 1);
  assert.throws(() => ops.dockLayout(b, { members: ['a'], preset: 'nope', cellW: NODE.w, cellH: NODE.h }), /분할 레이아웃/);
  b.store.close();
});

test('API: 분할선(나무 통째로), 바깥 크기, 덩어리째 옮기기, 옛 sizes, 크기 단계 — 백엔드를 다시 열어도 나무와 비율이 같다', () => {
  const env = fakeBackend();
  const { b, add, at } = env;
  add('a', R(0, 0)); add('b', R(2000, 0)); add('c', R(4000, 0));
  let { dock } = ops.dockLayout(b, { members: ['a', 'b', 'c'], preset: 'main-left', cellW: NODE.w, cellH: NODE.h });
  const outer = ops.dockOuter(b, dock);
  const t2 = moveDivider(dock.tree, outer, [1], 0, 120);
  ({ dock } = ops.dockUpdate(b, { dock: dock.dockId, tree: t2 }));
  assert.deepEqual([at('b').h, at('c').h], [580, 340]);
  assert.throws(() => ops.dockUpdate(b, { dock: dock.dockId, tree: { dir: 'row', kids: ['id-a', 'id-b'], ratios: [1, 1] } }), (e) => e.code === 'bad_request');
  // 바깥 크기: 비율대로
  ops.dockUpdate(b, { dock: dock.dockId, w: 2880, h: 1840 });
  assert.deepEqual([at('a'), at('b'), at('c')], [R(0, 0, 1728, 1840), R(1728, 0, 1152, 1160), R(1728, 1160, 1152, 680)]);
  ops.dockUpdate(b, { dock: dock.dockId, w: 10, h: 10 });
  assert.deepEqual(ops.dockOuter(b, ops.dockOf(b, 'id-a')), R(0, 0, 480, 320), '잎마다 최소 크기');
  ops.dockUpdate(b, { dock: dock.dockId, x: 500, y: 600, w: 1440, h: 920 });
  assert.deepEqual(ops.dockOuter(b, ops.dockOf(b, 'id-a')), R(500, 600, 1440, 920));
  const before = JSON.stringify(ops.dockOf(b, 'id-a').tree), rects = [at('a'), at('b'), at('c')];
  // 크기 단계: 그 노드가 단계 크기가 되도록 덩어리를 늘인다
  const sized = ops.setSize(b, { session: 'a', size: 'wide-large' });
  assert.deepEqual([sized.w, sized.h], [1920, 1080], 'P80: 크기는 덩어리를 단독 세션으로 보아 적용한다');
  assert.equal(JSON.stringify(ops.dockOf(b, 'id-a').tree), before, '틀 비율은 그대로');
  ops.dockUpdate(b, { dock: dock.dockId, w: 1440, h: 920 });
  b.store.close();
  // 다시 연다(백엔드를 껐다 켜기)
  const again = fakeBackend(env.file);
  for (const n of ['a', 'b', 'c']) again.b.sessions.set(`id-${n}`, { sessionId: `id-${n}`, name: n, workspaceKey: 'ws' });
  assert.equal(JSON.stringify(again.b.store.docks()[0].tree), before);
  assert.deepEqual([again.at('a'), again.at('b'), again.at('c')], rects);
  assert.equal(again.b.store.docks()[0].legacy, false);
  again.b.store.close();
});

test('API: 떼기(나무 정리), 덩어리 안 노드 닫기(안쪽 칸은 이웃이 채우고 뿌리 칸은 덩어리가 준다), 옛 한 줄 행 바꾸기', () => {
  const { b, add, at, shape } = fakeBackend();
  add('a', R(0, 0)); add('b', R(2000, 0)); add('c', R(4000, 0)); add('d', R(6000, 0));
  ops.dockLayout(b, { members: ['a', 'b', 'c', 'd'], preset: 'grid', cellW: NODE.w, cellH: NODE.h });
  // 안쪽 칸(d)을 닫는다: c가 아래 줄 전체
  b.sessions.delete('id-d');
  b.store.updateSession('id-d', { closedAt: Date.now() });
  ops.onSessionClosed(b, { sessionId: 'id-d' });
  assert.equal(shape(ops.dockOf(b, 'id-a')), '{"dir":"col","kids":[{"dir":"row","kids":["a","b"],"ratios":[0.5,0.5]},"c"],"ratios":[0.5,0.5]}');
  assert.deepEqual(at('c'), R(0, 460, 1440, 460));
  // 메뉴 떼기: 뿌리 칸(c)을 떼면 덩어리가 그만큼 준다. 뗀 노드는 덩어리와 겹치지 않는 곳
  ops.dockRemove(b, { session: 'c' });
  assert.deepEqual(ops.dockOuter(b, ops.dockOf(b, 'id-a')), R(0, 0, 1440, 460));
  const c = at('c');
  assert.ok(!(c.x < 1440 && c.y < 460 && c.x + c.w > 0 && c.y + c.h > 0), '뗀 노드는 덩어리 밖');
  // 끌어 떼기(자리를 준다): 하나 남으면 덩어리가 풀린다
  ops.dockRemove(b, { session: 'b', x: 3000, y: 3000 });
  assert.deepEqual(at('b'), R(3000, 3000, 720, 460));
  assert.equal(b.store.docks().length, 0);
  // 옛 한 줄 행(P6a~P16): tree 열이 없는 행을 뜰 때 나무로
  add('m', R(100, 0, 600, 460)); add('n', R(700, 0, 840, 460)); add('o', R(1540, 0, 480, 460));
  b.store.db.prepare("INSERT INTO docks (dock_id, workspace_key, dir, members, origin, created_at, updated_at) VALUES ('old1', 'ws', 'row', ?, 'user', 1, 1)").run(JSON.stringify(['id-m', 'id-n', 'id-o']));
  assert.equal(b.store.getDock('old1').legacy, true);
  const mig = ops.migrateDocks(b);
  assert.equal(mig.length, 1);
  const d = b.store.getDock('old1');
  assert.equal(d.legacy, false);
  assert.equal(shape(d), '{"dir":"row","kids":["m","n","o"],"ratios":[0.3125,0.4375,0.25]}');
  assert.deepEqual(layout(d.tree, ops.dockOuter(b, d)).rects.get('id-n'), at('n'), '모양 그대로');
  assert.equal(ops.migrateDocks(b).length, 0, '한 번만');
  b.store.close();
});
