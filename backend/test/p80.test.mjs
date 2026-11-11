// P80 단위 시험: 덩어리 크기는 틀 비율을 지키고 바깥만 정한다(dock-tree.mjs leafShares, shapeShift, dockVirtual, dockFit, canvas-ops.mjs board.setSize·dock.layout).
// 고른 틀은 모든 칸이 정확히 고른 모양, 고르지 않은 틀은 틀 비율 그대로이고 가장 큰 칸이 고른 모양에 가장 가깝다. 넓이 = 단독 세션 넓이 × √n.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SIZE_DIRS, SIZE_LEVELS, ASPECT_KEYS, stepSize, fitsAspect, aspectOf, levelOf, dirOf } from '../src/canvas.mjs';
import { PRESETS_BY_COUNT, presetTree, layout, normalize, leafShares, dockVirtual, dockFit } from '../src/dock-tree.mjs';
import { newRuntime } from '../src/state.mjs';
import { Store } from '../src/store.mjs';
import * as ops from '../src/canvas-ops.mjs';

const R = (x, y, w = 1440, h = 810) => ({ x, y, w, h });
const area = (r) => r.w * r.h;
const ids = (n) => Array.from({ length: n }, (_, i) => `s${i}`);
const ratio = (dir, aspect) => { const [p, q] = aspect.split(':').map(Number); return dir === 'tall' ? q / p : p / q; };
// 바깥을 dockFit으로 낸 뒤 늘어놓은 잎 사각형
function fit(tree, single) {
  const o = dockFit(tree, single);
  return { o, rs: [...layout(tree, { x: 0, y: 0, ...o }).rects.values()] };
}
const off = (r, want) => Math.abs(Math.log(r.w / r.h / want));

test('고른 틀(H, V, 격자): 모든 칸이 정확히 고른 모양이고 넓이는 단독 세션 × √n', () => {
  const uniform = [['row', 2], ['row', 4], ['row', 9], ['col', 2], ['col', 4], ['col', 6], ['grid', 4], ['grid-3x2', 6], ['grid-2x3', 6]];
  for (const [preset, n] of uniform) for (const dir of SIZE_DIRS) for (const aspect of ASPECT_KEYS) for (const level of SIZE_LEVELS) {
    const single = stepSize(dir, aspect, level);
    const tree = presetTree(preset, ids(n));
    const { o, rs } = fit(tree, single);
    const name = `${preset} ${n} ${dir} ${aspect} ${level}`;
    for (const r of rs) assert.ok(off(r, ratio(dir, aspect)) < 0.006, `${name}: 칸 ${r.w}×${r.h}`);
    assert.ok(Math.abs(area(o) / (area(single) * Math.sqrt(n)) - 1) < 0.002, `${name}: 넓이 ${o.w}×${o.h}`);
    const v = dockVirtual(tree, o);
    assert.equal(aspectOf(v, aspect), aspect, `${name}: 불`);
    assert.equal(levelOf(v, aspect), level);
    assert.equal(dirOf(v), dir);
  }
});

test('지시의 예: 16:9 크게 2 × 2는 약 2715×1527(칸 약 1358×764), H 넷은 약 5431×764, 둘은 넓이 1.41배, 아홉은 3배', () => {
  const single = stepSize('wide', '16:9', 'large');
  assert.deepEqual(dockFit(presetTree('grid', ids(4)), single), { w: 2715, h: 1527 });
  assert.deepEqual(dockFit(presetTree('row', ids(4)), single), { w: 5431, h: 764 });
  assert.ok(Math.abs(area(dockFit(presetTree('row', ids(2)), single)) / area(single) - Math.SQRT2) < 0.002);
  assert.ok(Math.abs(area(dockFit(presetTree('even-rows', ids(9)), single)) / area(single) - 3) < 0.002);
});

// 틀마다(고르지 않은 틀과 Ctrl+끌기로 만든 나무): 틀 비율 그대로, 가장 큰 칸이 고른 모양에 가장 가깝다, 넓이 √n
const spiral = normalize({ dir: 'row', kids: ['a', { dir: 'col', kids: ['b', { dir: 'row', kids: ['c', { dir: 'col', kids: ['d', 'e'] }] }] }] });
const dragged13 = normalize({ dir: 'row', kids: ['a', { dir: 'col', kids: ['b', 'c', 'd'] }], ratios: [0.7, 0.3] });
test('고르지 않은 틀: 틀 비율 그대로, 가장 큰 칸이 고른 모양에 가장 가깝고 넓이는 √n', () => {
  const trees = [];
  for (const [n, list] of Object.entries(PRESETS_BY_COUNT)) for (const p of list) trees.push([`${p} ${n}`, presetTree(p, ids(Number(n)))]);
  trees.push(['spiral', spiral], ['1+3 0.7/0.3', dragged13]);
  for (const [name, tree] of trees) for (const dir of SIZE_DIRS) for (const aspect of ASPECT_KEYS) {
    const single = stepSize(dir, aspect, 'normal');
    const want = ratio(dir, aspect);
    const { o, rs } = fit(tree, single);
    const big = Math.max(...rs.map(area));
    const bigOff = Math.max(...rs.filter((r) => area(r) >= big * 0.99).map((r) => off(r, want)));
    for (const r of rs) assert.ok(bigOff <= off(r, want) + 0.01, `${name} ${dir} ${aspect}: 큰 칸 ${bigOff.toFixed(3)} > ${r.w}×${r.h} ${off(r, want).toFixed(3)}`);
    // 잎 몫(틀 비율)은 바깥과 상관없이 같다: 늘어놓은 잎의 너비·높이 몫이 나무의 몫
    const shares = leafShares(tree);
    const lay = layout(tree, { x: 0, y: 0, ...o }).rects;
    for (const s of shares) { const r = lay.get(s.id); assert.ok(Math.abs(r.w / o.w - s.a) < 0.01 && Math.abs(r.h / o.h - s.b) < 0.01, `${name} ${s.id}`); }
    assert.ok(Math.abs(area(o) / (area(single) * Math.sqrt(rs.length)) - 1) < 0.003, `${name}: 넓이`);
  }
  // 1 + 3(반반): 큰 칸과 작은 칸이 같은 만큼 어긋난다(큰 칸 약 1:1, 작은 칸 약 3:1). 1 + 4: 넓이 무게만이면 작은 칸 넷이 이겨 큰 칸이 더 어긋나므로 자른다
  const { rs: r13 } = fit(presetTree('main-left-3', ids(4)), stepSize('wide', '16:9', 'large'));
  assert.ok(Math.abs(off(r13[0], 16 / 9) - off(r13[1], 16 / 9)) < 0.01, JSON.stringify(r13));
});

function fakeBackend() {
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p80-')), 'board.db'));
  const sessions = new Map();
  const b = { store, sessions, events: [], api: { broadcast: () => {} }, log: () => {}, nameOf: (sid) => (sessions.get(sid) || { name: sid }).name };
  b.resolve = (ref) => { const s = sessions.get(ref) || [...sessions.values()].find((x) => x.name === ref); if (!s) throw Object.assign(new Error(`없는 세션: ${ref}`), { code: 'not_found' }); return s; };
  store.insertWorkspace({ key: 'ws', kind: 'folder', root: 'C:/ws', createdAt: 1 });
  const add = (name, rect, extra = {}) => {
    const s = { sessionId: `id-${name}`, name, kind: 'shell', workspaceKey: 'ws', cwd: 'C:/ws', rt: newRuntime({ kind: 'shell', hooked: false }), origin: 'board', createdAt: 1 };
    sessions.set(s.sessionId, s);
    store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    store.setNode({ session_id: s.sessionId, ...rect, z: 0, ...extra });
  };
  const at = (name) => { const n = store.nodes().find((x) => x.session_id === `id-${name}`); return n && R(n.x, n.y, n.w, n.h); };
  const dock = () => ops.dockOf(b, 'id-a');
  for (const [i, n] of ['a', 'b', 'c', 'd'].entries()) add(n, R(i * 2000, 0));
  return { b, add, at, dock, store };
}
const sizes = (env, ns = ['a', 'b', 'c', 'd']) => ns.map((n) => [env.at(n).w, env.at(n).h]);

test('재현(P77에서 고침): 1 + 3은 틀을 고른 뒤 비율을 눌러도, 비율을 누른 뒤 틀을 골라도 반반 틀 그대로', () => {
  // 틀 → 비율
  let env = fakeBackend();
  ops.dockLayout(env.b, { members: ['a', 'b', 'c', 'd'], preset: 'main-left-3' });
  const tree = JSON.stringify(env.dock().tree);
  ops.setSize(env.b, { session: 'a', aspect: '16:9', level: 'large', scope: 'dock' });
  assert.equal(JSON.stringify(env.dock().tree), tree, '틀 비율 그대로');
  const first = sizes(env);
  assert.deepEqual(first[0], [1459, 1421], '큰 칸');
  assert.ok(first.slice(1).every(([w, h]) => w === 1459 && Math.abs(h - 474) <= 1), JSON.stringify(first));
  ops.setSize(env.b, { session: 'a', aspect: '4:3', scope: 'dock' });
  assert.equal(JSON.stringify(env.dock().tree), tree, '4:3도 틀 비율 그대로');
  assert.ok(Math.abs(env.at('a').w - env.at('b').w) <= 1 && env.at('a').h > 2.9 * env.at('b').h, `큰 칸은 작은 칸 셋 높이 ${JSON.stringify(sizes(env))}`);
  env.store.close();
  // 비율 → 틀
  env = fakeBackend();
  ops.dockLayout(env.b, { members: ['a', 'b', 'c', 'd'], preset: 'grid' });
  ops.setSize(env.b, { session: 'a', aspect: '16:9', level: 'large', scope: 'dock' });
  ops.dockLayout(env.b, { members: ['a'], preset: 'main-left-3' });
  assert.equal(JSON.stringify(env.dock().tree), tree);
  assert.deepEqual(sizes(env), first, '같은 크기');
  assert.deepEqual([env.dock().aspect, ops.dockState(env.b, env.dock()).level], ['16:9', 'large']);
  env.store.close();
});

test('재현(P77에서 고침): 큰 칸 + 작은 칸(main2-left)은 비율을 눌러도 같은 크기가 되지 않는다. Ctrl+끌기 비율도 그대로', () => {
  let env = fakeBackend();
  ops.dockLayout(env.b, { members: ['a', 'b'], preset: 'main2-left' });
  ops.setSize(env.b, { session: 'a', aspect: '4:3', scope: 'dock' });
  assert.deepEqual(env.dock().tree.ratios, [0.62, 0.38]);
  assert.ok(Math.abs(env.at('a').w / (env.at('a').w + env.at('b').w) - 0.62) < 0.01, JSON.stringify(sizes(env, ['a', 'b'])));
  env.store.close();
  env = fakeBackend();
  const { dock } = ops.dockLayout(env.b, { members: ['a', 'b', 'c', 'd'], preset: 'main-left-3' });
  ops.dockUpdate(env.b, { dock: dock.dockId, tree: { dir: 'row', kids: ['id-a', { dir: 'col', kids: ['id-b', 'id-c', 'id-d'], ratios: [1, 1, 1] }], ratios: [0.7, 0.3] } });
  assert.equal(env.dock().aspect, '16:9', '나무만 바꾸면 비율 기록은 그대로');
  ops.setSize(env.b, { session: 'a', aspect: '16:9', level: 'normal', scope: 'dock' });
  assert.deepEqual(env.dock().tree.ratios, [0.7, 0.3], 'Ctrl+끌기로 만든 비율 그대로');
  assert.ok(off(env.at('a'), 16 / 9) <= off(env.at('b'), 16 / 9), '큰 칸이 더 가깝다');
  env.store.close();
});

test('새 덩어리는 첫 노드(혼자이고 비율 불)의 크기, 아니면 새 세션 크기. 단독 세션 크기는 그대로', () => {
  const env = fakeBackend();
  ops.setSize(env.b, { session: 'a', size: 'tall43-large' });
  assert.deepEqual([env.at('a').w, env.at('a').h], [1200, 1600], '단독 세션은 표 그대로');
  ops.dockLayout(env.b, { members: ['a', 'b', 'c', 'd'], preset: 'row' });
  const st = ops.dockState(env.b, env.dock());
  assert.deepEqual([st.dir, st.aspect, st.level], ['tall', '4:3', 'large'], '첫 노드의 크기로 짠다');
  for (const r of sizes(env)) assert.ok(off({ w: r[0], h: r[1] }, 3 / 4) < 0.006, JSON.stringify(r));
  ops.dockRemove(env.b, { dock: env.dock().dockId });
  // 첫 노드가 혼자이고 비율이 꺼져 있으면 새 세션 크기(16:9 가로형 보통)
  env.store.setNode({ ...env.store.nodes().find((n) => n.session_id === 'id-c'), w: 1000, h: 1000 });
  env.store.setNodeAspect('id-c', null, null);
  ops.dockLayout(env.b, { members: ['c', 'd'], preset: 'row' });
  assert.deepEqual([ops.dockOuter(env.b, ops.dockOf(env.b, 'id-c')).w, ops.dockOuter(env.b, ops.dockOf(env.b, 'id-c')).h], [2422, 681], '1440×810 × √2, 칸 16:9');
  assert.ok(fitsAspect(env.at('c'), '16:9'));
  env.store.close();
});
