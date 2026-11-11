// P73 단위 시험: 크기 = 방향 × 종횡비 × 단계(canvas.mjs SIZE_TABLE, resolveSize), 판 API(board.setSize, dock.update, dock.layout),
// 바깥 테두리 끌기(dock-tree.mjs dragOuter), H·V 배치 틀, 새 세션 크기. herdr와 claude 없이 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SIZE_TABLE, SIZE_STEPS, SIZE_DIRS, SIZE_LEVELS, ASPECT_KEYS, stepSize, stepKey, parseStep, resolveSize, aspectOf, levelOf, matchAspect, nearestAspect, NEW_NODE, NEW_NODE_STEP, DOCK_CELL } from '../src/canvas.mjs';
import { dragOuter, layout, presetTree, presetsFor, presetSize, minSize, LINE_PRESETS } from '../src/dock-tree.mjs';
import { CHILD_SIZE } from '../src/branch.mjs';
import { newRuntime } from '../src/state.mjs';
import { Store } from '../src/store.mjs';
import * as ops from '../src/canvas-ops.mjs';

const R = (x, y, w = 1440, h = 810) => ({ x, y, w, h });
const area = (r) => r.w * r.h;

test('크기 표: 방향 × 비율 × 단계. 세로는 가로를 돌린 것이고 단계마다 가로·세로가 함께 바뀐다', () => {
  assert.deepEqual(SIZE_TABLE['16:9'], { large: { w: 1920, h: 1080 }, normal: { w: 1440, h: 810 }, small: { w: 1040, h: 585 } });
  assert.deepEqual(SIZE_TABLE['4:3'], { large: { w: 1600, h: 1200 }, normal: { w: 1200, h: 900 }, small: { w: 880, h: 660 } });
  for (const a of ASPECT_KEYS) {
    const [p, q] = a.split(':').map(Number);
    for (const lv of SIZE_LEVELS) {
      const w = stepSize('wide', a, lv), t = stepSize('tall', a, lv);
      assert.ok(Math.abs(w.w / w.h - p / q) < 0.005, `${a} ${lv} 가로 비율`);
      assert.deepEqual(t, { w: w.h, h: w.w }, `${a} ${lv} 세로 = 가로를 돌린 것`);
      // 작게 세로도 터미널이 읽힌다: 글자 14px(칸 너비 약 8.4px)로 55칸 이상, 둘레 여백 32px
      assert.ok((t.w - 32) / 8.4 >= 55, `${a} ${lv} 세로 너비 ${t.w}`);
      for (const d of SIZE_DIRS) assert.deepEqual(SIZE_STEPS[stepKey(d, a, lv)], stepSize(d, a, lv));
    }
    // 크게 > 보통 > 작게(가로와 세로 둘 다)
    assert.ok(stepSize('tall', a, 'large').w > stepSize('tall', a, 'normal').w && stepSize('tall', a, 'normal').w > stepSize('tall', a, 'small').w);
    assert.ok(stepSize('tall', a, 'large').h > stepSize('tall', a, 'normal').h && stepSize('tall', a, 'normal').h > stepSize('tall', a, 'small').h);
  }
  assert.deepEqual(parseStep('wide43-small'), { dir: 'wide', aspect: '4:3', level: 'small' });
  assert.deepEqual(parseStep('tall-large'), { dir: 'tall', aspect: '16:9', level: 'large' });
  assert.deepEqual(parseStep('normal'), { level: 'normal' }, '옛 열쇠는 단계만');
  assert.equal(parseStep('wide-huge'), null);
  assert.deepEqual([NEW_NODE, NEW_NODE_STEP], [{ w: 1440, h: 810 }, 'wide-normal'], '새 세션은 16:9 가로 보통');
  assert.equal(CHILD_SIZE, 'wide-normal', 'atrium child도 같다');
});

test('불: 비율은 기록이 있고 모양이 맞을 때만, 단계는 비율 불이 있고 넓이가 맞을 때만', () => {
  assert.equal(aspectOf(R(0, 0, 1440, 810), '16:9'), '16:9');
  assert.equal(aspectOf(R(0, 0, 810, 1440), '16:9'), '16:9', '세로 9:16');
  assert.equal(aspectOf(R(0, 0, 1440, 810), null), null, '기록이 없으면(자유 비율) 꺼짐');
  assert.equal(aspectOf(R(0, 0, 1500, 810), '16:9'), null, '모양이 어긋나면 꺼짐');
  assert.equal(levelOf(R(0, 0, 1440, 810), '16:9'), 'normal');
  assert.equal(levelOf(R(0, 0, 1200, 900), '4:3'), 'normal');
  assert.equal(levelOf(R(0, 0, 1300, 731), '16:9'), null, '단계 사이 크기');
  assert.equal(levelOf(R(0, 0, 1440, 810), null), null);
  assert.equal(matchAspect(R(0, 0, 900, 1200)), '4:3');
  assert.equal(nearestAspect(R(0, 0, 720, 460)), '16:9');
  assert.equal(nearestAspect(R(0, 0, 1000, 800)), '4:3');
});

test('비율 바꾸기는 지금 단계(넓이)를 지킨다. 자유 크기에서 비율 단추는 넓이를 지키고, 단계 단추는 가까운 비율의 표 크기', () => {
  // 16:9 보통 → 4:3 보통(넓이가 거의 같다)
  const a = resolveSize(R(0, 0, 1440, 810), '16:9', { aspect: '4:3' });
  assert.deepEqual([a.w, a.h, a.aspect, a.level, a.key], [1200, 900, '4:3', 'normal', 'wide43-normal']);
  assert.ok(Math.abs(area(a) / (1440 * 810) - 1) < 0.08);
  // 세로 4:3 크게 → 16:9: 9:16 크게
  const b = resolveSize(R(0, 0, 1200, 1600), '4:3', { aspect: '16:9' });
  assert.deepEqual([b.w, b.h, b.key], [1080, 1920, 'tall-large']);
  // 방향 바꾸기: 비율과 단계를 지킨다(가로·세로 둘 다 바뀐다)
  const c = resolveSize(R(0, 0, 1040, 585), '16:9', { dir: 'tall' });
  assert.deepEqual([c.w, c.h, c.key], [585, 1040, 'tall-small']);
  // 단계 바꾸기: 세로에서도 너비·높이가 함께
  const d = resolveSize(R(0, 0, 810, 1440), '16:9', { level: 'large' });
  assert.deepEqual([d.w, d.h], [1080, 1920]);
  // 자유 크기(테두리를 끈 뒤): 비율 단추는 넓이를 지킨 채 그 비율
  const free = R(0, 0, 1500, 700);
  const e = resolveSize(free, null, { aspect: '16:9' });
  assert.equal(e.aspect, '16:9'); assert.equal(e.level, null);
  assert.ok(Math.abs(e.w / e.h - 16 / 9) < 0.01 && Math.abs(area(e) / area(free) - 1) < 0.01, JSON.stringify(e));
  // 자유 크기에서 단계 단추: 모양이 가까운 비율의 표 크기
  assert.deepEqual(resolveSize(R(0, 0, 720, 460), null, { level: 'small' }).key, 'wide-small');
  assert.deepEqual(resolveSize(R(0, 0, 1000, 800), null, { level: 'large' }).key, 'wide43-large');
  // 자유 크기에서 방향 단추: 돌린다(비율은 꺼진 채)
  const f = resolveSize(free, null, { dir: 'tall' });
  assert.deepEqual([f.w, f.h, f.aspect], [700, 1500, null]);
  // 기록한 비율이 있어도 모양이 어긋나면 자유 크기로 본다
  assert.equal(resolveSize(free, '16:9', { dir: 'tall' }).aspect, null);
});

test('바깥 테두리 끌기: 덩어리 전체가 커지고 줄며 나무 비율은 그대로, 맞은편 변은 그대로, 최소 크기를 지킨다', () => {
  const t = presetTree('main-left', ['a', 'b', 'c']);
  const o = R(100, 200, 1920, 1080);
  assert.deepEqual(dragOuter(t, o, 'right', 240), R(100, 200, 2160, 1080));
  assert.deepEqual(dragOuter(t, o, 'left', -120), R(-20, 200, 2040, 1080), '왼쪽 변을 끌면 오른쪽 변은 그대로');
  assert.deepEqual(dragOuter(t, o, 'top', 80), R(100, 280, 1920, 1000));
  assert.deepEqual(dragOuter(t, o, 'bottom', -5000), R(100, 200, 1920, minSize(t).h), '최소 크기');
  // 칸은 비율대로 함께 커진다
  const before = layout(t, o).rects, after = layout(t, dragOuter(t, o, 'right', 480)).rects;
  for (const id of ['a', 'b', 'c']) assert.ok(Math.abs(after.get(id).w / before.get(id).w - 2400 / 1920) < 0.01, id);
});

test('배치 틀 H·V: 세션 수와 상관없이 모두 가로 한 줄과 모두 세로 한 줄', () => {
  assert.deepEqual(LINE_PRESETS, ['row', 'col']);
  for (let n = 2; n <= 12; n++) {
    const list = presetsFor(n);
    assert.ok(list.includes('row') && list.includes('col'), `${n}개: ${list}`);
    const ids = Array.from({ length: n }, (_, i) => `s${i}`);
    assert.deepEqual(presetTree('row', ids), { dir: 'row', kids: ids, ratios: ids.map(() => Number((1 / n).toFixed(6))) });
    assert.equal(presetTree('col', ids).dir, 'col');
    assert.deepEqual(presetSize('row', n, DOCK_CELL), { w: DOCK_CELL.w * n, h: DOCK_CELL.h });
  }
});

// ---------- 판 API ----------
function fakeBackend() {
  const store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p73-')), 'board.db'));
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
  const node = (name) => store.nodes().find((x) => x.session_id === `id-${name}`);
  const at = (name) => { const n = node(name); return n && R(n.x, n.y, n.w, n.h); };
  return { b, add, at, node, store };
}

test('API: 혼자인 노드의 방향·비율·단계, 기록한 비율, 테두리 끌기 뒤 비율 꺼짐, 다시 켜기', () => {
  const { b, add, at, node, store } = fakeBackend();
  add('a', R(0, 0), { size: 'wide-normal', aspect: '16:9' });
  ops.setSize(b, { session: 'a', aspect: '4:3' });
  assert.deepEqual(at('a'), R(0, 0, 1200, 900));
  assert.deepEqual([node('a').aspect, node('a').size], ['4:3', 'wide43-normal'], '판 기록에 비율을 남긴다');
  ops.setSize(b, { session: 'a', dir: 'tall' });
  assert.deepEqual(at('a'), R(0, 0, 900, 1200), '3:4 보통');
  ops.setSize(b, { session: 'a', level: 'small' });
  assert.deepEqual(at('a'), R(0, 0, 660, 880));
  ops.setSize(b, { session: 'a', size: 'wide-large' });
  assert.deepEqual([at('a'), node('a').aspect], [R(0, 0, 1920, 1080), '16:9']);
  // 테두리 끌기(창의 board.setNode, 크기가 바뀜)는 store에서 비율을 끈다: 백엔드 board.setNode가 setNodeAspect(null)를 부른다
  store.setNode({ ...node('a'), w: 1700 });
  store.setNodeAspect('id-a', null, null);
  assert.equal(aspectOf(at('a'), node('a').aspect), null, '자유 비율');
  ops.setSize(b, { session: 'a', aspect: '16:9' });
  const r = at('a');
  assert.ok(Math.abs(r.w / r.h - 16 / 9) < 0.01 && Math.abs(area(r) / (1700 * 1080) - 1) < 0.01, '넓이를 지킨 채 다시 16:9');
  assert.equal(node('a').aspect, '16:9');
  assert.throws(() => ops.setSize(b, { session: 'a', aspect: '21:9' }), /aspect/);
  assert.throws(() => ops.setSize(b, { session: 'a' }), /size/);
  store.close();
});

test('API: 덩어리는 틀 비율을 지키고 바깥만(P80에서 바뀜). 넷짜리 16:9 ↔ 4:3, 바깥 끌기 뒤 비율 꺼짐, 틀을 다시 고르면 같은 단독 세션 크기', () => {
  const { b, add, at, store } = fakeBackend();
  add('a', R(0, 0)); add('b', R(2000, 0)); add('c', R(4000, 0)); add('d', R(6000, 0));
  const { dock } = ops.dockLayout(b, { members: ['a', 'b', 'c', 'd'], preset: 'grid' });
  const o = ops.dockOuter(b, dock);
  assert.deepEqual([o.w, o.h], [2036, 1146], '새 덩어리: 새 세션(16:9 보통 1440×810) 넓이 × √4, 2 × 2라 바깥도 16:9');
  assert.equal(store.getDock(dock.dockId).aspect, '16:9', '칸이 16:9면 불');
  const tree = JSON.stringify(ops.dockOf(b, 'id-a').tree);
  ops.setSize(b, { session: 'b', level: 'large', scope: 'dock' });
  assert.deepEqual([ops.dockOuter(b, ops.dockOf(b, 'id-a')).w, ops.dockOuter(b, ops.dockOf(b, 'id-a')).h], [2715, 1527], '16:9 크게: 1920×1080 넓이 × 2');
  ops.setSize(b, { session: 'b', aspect: '4:3', scope: 'dock' });
  const o2 = ops.dockOuter(b, ops.dockOf(b, 'id-a'));
  assert.deepEqual([o2.x, o2.y, o2.w, o2.h], [o.x, o.y, 2263, 1697], '4:3 크게(단계를 지킨다, 왼쪽 위 그대로)');
  assert.ok(Math.abs(at('a').w / at('a').h - 4 / 3) < 0.01, JSON.stringify(at('a')));
  assert.equal(ops.dockOf(b, 'id-a').aspect, '4:3');
  // 덩어리 안 노드의 노드 메뉴(scope 없이 옛 열쇠)도 덩어리
  ops.setSize(b, { session: 'c', size: 'normal' });
  assert.deepEqual([ops.dockOuter(b, ops.dockOf(b, 'id-a')).w, ops.dockOuter(b, ops.dockOf(b, 'id-a')).h], [1697, 1273]);
  assert.equal(JSON.stringify(ops.dockOf(b, 'id-a').tree), tree, '틀 비율은 그대로');
  // 바깥 테두리 끌기 저장 → 비율 꺼짐(나무는 그대로)
  const now = ops.dockOuter(b, ops.dockOf(b, 'id-a'));
  const dragged = dragOuter(ops.dockOf(b, 'id-a').tree, now, 'right', 300);
  ops.dockUpdate(b, { dock: dock.dockId, x: dragged.x, y: dragged.y, w: dragged.w, h: dragged.h });
  assert.equal(ops.dockOf(b, 'id-a').aspect, null, '테두리를 끌면 두 비율 모두 꺼진다');
  assert.equal(JSON.stringify(ops.dockOf(b, 'id-a').tree), tree, '칸 비율은 그대로');
  assert.ok(Math.abs(at('a').w - at('b').w) <= 1 && at('a').w + at('b').w === 1997, '칸이 비율대로 함께 커진다');
  // 다시 16:9를 누르면 덩어리 넓이를 지킨 채 칸이 16:9
  const before = area(ops.dockOuter(b, ops.dockOf(b, 'id-a')));
  ops.setSize(b, { session: 'a', aspect: '16:9', scope: 'dock' });
  const c3 = at('a');
  assert.ok(Math.abs(c3.w / c3.h - 16 / 9) < 0.01 && Math.abs(area(ops.dockOuter(b, ops.dockOf(b, 'id-a'))) / before - 1) < 0.01, JSON.stringify(c3));
  assert.equal(ops.dockOf(b, 'id-a').aspect, '16:9');
  // 같은 덩어리를 H 틀로: 같은 단독 세션 크기(세션 수 그대로라 넓이 그대로), 칸은 16:9
  ops.dockLayout(b, { members: ['a'], preset: 'row' });
  const hs = ['a', 'b', 'c', 'd'].map((n) => at(n));
  assert.ok(hs.every((r) => r.y === o.y && Math.abs(r.w / r.h - 16 / 9) < 0.01 && Math.abs(area(r) / area(c3) - 1) < 0.01), JSON.stringify(hs));
  assert.equal(ops.dockOf(b, 'id-a').aspect, '16:9');
  ops.dockLayout(b, { members: ['a'], preset: 'col' });
  assert.deepEqual(['a', 'b', 'c', 'd'].map((n) => at(n).x), [o.x, o.x, o.x, o.x], 'V: 모두 세로 한 줄');
  // 덩어리 기록은 다시 열어도 남는다
  assert.equal(store.docks()[0].aspect, '16:9');
  store.close();
});

test('API: 정리는 노드의 방향과 고른 비율을 지킨 채 크게·보통·작게', () => {
  const { b, add, at, store } = fakeBackend();
  add('lead', R(3000, 3000, 1200, 900), { aspect: '4:3' }); add('kid', R(0, 0, 810, 1440), { aspect: '16:9' });
  store.insertLink({ linkId: 'l1', from: 'id-lead', to: 'id-kid', role: '리뷰어', createdAt: 1 });
  ops.arrange(b, { workspace: 'ws', apply: true });
  assert.deepEqual([at('lead').w, at('lead').h], [1600, 1200], '뿌리는 4:3 크게');
  assert.deepEqual([at('kid').w, at('kid').h], [585, 1040], '잎은 9:16 작게');
  store.close();
});
