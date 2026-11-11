// P77 창 단위 시험(P80에서 기대값을 새 규칙으로 고쳤다): 덩어리를 고르면 크기 막대의 불(방향·비율·단계)은 바깥을 같은 규칙의 단독 세션 하나로 본 것이다.
// 틀 비율은 그대로이고, 칸이 고른 모양에 가까우며 넓이가 단독 세션 × √n일 때 불이 든다. 혼자인 세션은 그대로
import test from 'node:test';
import assert from 'node:assert/strict';
import { blockState, dockState, dockLevelSize, litOf, levelSize } from '../src/renderer/lib/selbar.js';
import { presetTree, layout, dockFit } from '../../backend/src/dock-tree.mjs';
import { stepSize } from '../../backend/src/canvas.mjs';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const R = (x, y, w, h) => ({ x, y, w, h });
const ids = ['a', 'b', 'c', 'd'];
// 나무를 단독 세션 크기(single) 규칙의 바깥에 늘어놓은 구성 노드 사각형
const rectsOf = (tree, single) => [...layout(tree, { x: 0, y: 0, ...dockFit(tree, single) }).rects.values()];
const lit = (s) => s && [s.dir, s.aspect, s.level];

test('덩어리 막대 불: H 넷·V 넷·1 + 3을 새 규칙으로 짜면 그 방향·비율·단계', () => {
  const h4 = presetTree('row', ids);
  assert.deepEqual(lit(dockState(h4, rectsOf(h4, stepSize('wide', '16:9', 'large')), '16:9')), ['wide', '16:9', 'large']);
  // P77 칸 기준(칸마다 1920×1080, 바깥 7680×1080): 비율 불만(넓이가 단계와 다르다)
  assert.deepEqual(lit(dockState(h4, ids.map((_, i) => R(i * 1920, 0, 1920, 1080)), '16:9')), ['wide', '16:9', null]);
  // 바깥(7680×1080)을 단독 세션으로 재면 비율이 맞지 않는다
  assert.deepEqual(blockState(R(0, 0, 7680, 1080), '16:9'), { dir: 'wide', aspect: null, level: null });
  const v4 = presetTree('col', ids);
  assert.deepEqual(lit(dockState(v4, rectsOf(v4, stepSize('tall', '4:3', 'normal')), '4:3')), ['tall', '4:3', 'normal']);
  const m13 = presetTree('main-left-3', ids);
  assert.deepEqual(lit(dockState(m13, rectsOf(m13, stepSize('wide', '16:9', 'small')), '16:9')), ['wide', '16:9', 'small']);
  // 바깥 테두리로 바꾼 뒤(모양이 어긋남, 기록도 지운다): 비율·단계 꺼짐
  const two = presetTree('row', ['a', 'b']);
  assert.deepEqual(lit(dockState(two, [R(0, 0, 1440, 1010), R(1440, 0, 1440, 1010)], null)), ['wide', null, null]);
  // P73 바깥 기준 H 넷(바깥 1920×1080): 칸 480×1080이라 세로형으로 보이고 불은 꺼진다
  assert.deepEqual(lit(dockState(h4, ids.map((_, i) => R(i * 480, 0, 480, 1080)), '16:9')), ['tall', null, null]);
  assert.equal(dockState(h4, [], '16:9'), null);
});

test('덩어리와 혼자인 세션을 함께 고르면 둘 다 같은 값일 때만 불. 덩어리 단계 풀이 크기는 덩어리 바깥', () => {
  const g = presetTree('grid', ids);
  const d = dockState(g, rectsOf(g, stepSize('wide', '16:9', 'normal')), '16:9');
  const n = blockState(R(0, 2000, 1440, 810), '16:9');
  const { single, ...ds } = d;
  assert.deepEqual(litOf([ds, n]), { dir: 'wide', aspect: '16:9', level: 'normal' });
  assert.deepEqual(levelSize('large', { dir: 'wide', aspect: '16:9', rect: single }), { w: 1920, h: 1080 });
  assert.deepEqual(dockLevelSize('large', { dir: 'wide', aspect: '16:9', tree: g, single }), { w: 2715, h: 1527 });
  assert.deepEqual(dockLevelSize('large', { dir: 'wide', aspect: '16:9', tree: presetTree('row', ids), single }), { w: 5431, h: 764 });
});

test('사전: 덩어리 막대 글이 두 사전에 같은 열쇠로 있고, "칸마다"와 칸 기준 옛 말이 없다', () => {
  const keys = ['dirTitle', 'aspectTitle', 'sizeTitle'];
  assert.deepEqual(Object.keys(en.dockSizeBar).sort(), [...keys].sort());
  assert.deepEqual(Object.keys(ko.dockSizeBar).sort(), [...keys].sort());
  assert.equal(en.dockCellBar, undefined);
  assert.equal(ko.dockCellBar, undefined);
  assert.ok(!/칸 하나|칸마다/.test(JSON.stringify(ko.sizeBar) + JSON.stringify(ko.dockSizeBar)) && !/cell/.test(JSON.stringify(en.dockSizeBar) + en.sizeBar.aspectTitle));
  assert.ok(/분할 비율/.test(ko.dockSizeBar.aspectTitle) && /split ratios/.test(en.dockSizeBar.aspectTitle));
  assert.ok(ko.dockSizeBar.sizeTitle.includes('{w}') && en.dockSizeBar.sizeTitle.includes('{h}'));
});
