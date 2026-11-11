// P26 단위 시험: 세션 수마다 다른 배치 틀(dock-tree.mjs PRESETS_BY_COUNT, presetsFor, 고르게 나눈 틀). herdr와 claude 없이 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NODE } from '../src/canvas.mjs';
import { PRESETS, PRESETS_BY_COUNT, EVEN_PRESETS, LINE_PRESETS, presetsFor, presetTree, presetSize, presetCells, layout, leaves } from '../src/dock-tree.mjs';

const ids = (n) => Array.from({ length: n }, (_, i) => `s${i}`);
// 나무를 바깥에 늘어놓았을 때 틈과 겹침이 없는가
function tiles(t, outer) {
  const rs = [...layout(t, outer, { w: 0, h: 0 }).rects.values()];
  const area = rs.reduce((a, r) => a + r.w * r.h, 0);
  const over = rs.some((p, i) => rs.some((q, j) => j > i && p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h));
  return area === outer.w * outer.h && !over;
}
// 모양(잎 이름을 지운 나무)
const shape = (t) => (typeof t === 'string' ? '*' : { dir: t.dir, kids: t.kids.map(shape), ratios: t.ratios });
const key = (t) => JSON.stringify(shape(t));

test('세션 수 2~6마다 틀이 따로 있고, 모두 PRESETS에 있다', () => {
  for (let n = 2; n <= 6; n++) {
    const list = presetsFor(n);
    assert.ok(list.length >= 4, `${n}개: 틀 ${list.length}개`);
    for (const id of list) assert.ok(PRESETS[id], `${n}개: 없는 틀 ${id}`);
    assert.deepEqual(list, PRESETS_BY_COUNT[n]);
  }
  assert.deepEqual(presetsFor(1), []);
  assert.deepEqual(presetsFor(0), []);
  for (const n of [7, 8, 12]) assert.deepEqual(presetsFor(n), [...EVEN_PRESETS, ...LINE_PRESETS], `${n}개도 고르게 나누기와 가로·세로 한 줄을 고른다`);
});

test('수마다의 틀은 모두 그 수의 칸을 틈 없이 채우고, 한 수 안에서 모양이 서로 다르다', () => {
  for (let n = 2; n <= 9; n++) {
    const seen = new Set();
    for (const id of presetsFor(n)) {
      const cells = presetCells(id);
      assert.ok(cells == null || cells === n, `${n}개 틀 ${id}의 칸 수 ${cells}`);
      const t = presetTree(id, ids(n));
      assert.deepEqual(leaves(t), ids(n), `${n}개 틀 ${id}: 고른 차례대로 채운다`);
      assert.ok(tiles(t, { x: 0, y: 0, w: 2400, h: 1600 }), `${n}개 틀 ${id}: 틈·겹침 없음`);
      const k = key(t);
      assert.ok(!seen.has(k), `${n}개 틀 ${id}: 같은 수의 다른 틀과 모양이 같다`);
      seen.add(k);
    }
  }
});

test('수마다 보이는 틀 모음이 서로 다르다(2·3·4·6)', () => {
  const sets = [2, 3, 4, 6].map((n) => presetsFor(n).map((id) => key(presetTree(id, ids(n)))).sort().join('|'));
  assert.equal(new Set(sets).size, 4);
});

test('틀 모양: 2는 가로·세로·크게+작게, 3은 1+2·2+1·위 하나 아래 둘, 4는 2×2·1+3·3+1, 6은 3×2·2×3·1+5', () => {
  const T = (id, n) => shape(presetTree(id, ids(n)));
  assert.deepEqual(T('main2-left', 2), { dir: 'row', kids: ['*', '*'], ratios: [0.62, 0.38] });
  assert.deepEqual(T('main2-top', 2), { dir: 'col', kids: ['*', '*'], ratios: [0.62, 0.38] });
  assert.deepEqual(T('main-top', 3), { dir: 'col', kids: ['*', { dir: 'row', kids: ['*', '*'], ratios: [0.5, 0.5] }], ratios: [0.6, 0.4] });
  assert.equal(T('main-left-3', 4).dir, 'row');
  assert.equal(T('main-left-3', 4).kids[1].kids.length, 3);
  assert.equal(T('main-right-3', 4).kids[0].kids.length, 3);
  assert.deepEqual(T('grid-3x2', 6).kids.map((k) => k.kids.length), [3, 3]);
  assert.deepEqual(T('grid-2x3', 6).kids.map((k) => k.kids.length), [2, 2, 2]);
  const big = presetTree('main-big5', ids(6));
  const r = Object.fromEntries(layout(big, { x: 0, y: 0, w: 2160, h: 1380 }, { w: 0, h: 0 }).rects);
  assert.ok(r.s0.w * r.s0.h > 3 * r.s1.w * r.s1.h, '1 + 5: 첫 칸이 다른 칸보다 훨씬 크다');
});

test('고르게 나눈 틀: 줄마다 칸 수가 하나 이내로 고르다', () => {
  const lines = (t) => t.kids.map((k) => (typeof k === 'string' ? 1 : k.kids.length));
  assert.deepEqual(lines(presetTree('even-rows', ids(7))), [3, 2, 2]);
  assert.deepEqual(lines(presetTree('even-rows', ids(10))), [4, 3, 3]);
  assert.equal(presetTree('even-cols', ids(7)).dir, 'row');
  assert.deepEqual(lines(presetTree('two-rows', ids(9))), [5, 4]);
  assert.deepEqual(presetSize('even-rows', 7, NODE), { w: NODE.w * 3, h: NODE.h * 3 });
  assert.deepEqual(presetSize('even-cols', 7, NODE), { w: NODE.w * 3, h: NODE.h * 3 });
  assert.deepEqual(presetSize('two-rows', 9, NODE), { w: NODE.w * 5, h: NODE.h * 2 });
});

test('새 틀의 바깥 크기와 옛 틀 이름(API·CLI)은 그대로', () => {
  assert.deepEqual(presetSize('main2-left', 2, NODE), { w: NODE.w * 2, h: NODE.h });
  assert.deepEqual(presetSize('grid-3x2', 6, NODE), { w: NODE.w * 3, h: NODE.h * 2 });
  for (const id of ['main-left', 'main-right', 'grid', 'row3', 'col3', 'row', 'col']) assert.ok(PRESETS[id], id);
});
