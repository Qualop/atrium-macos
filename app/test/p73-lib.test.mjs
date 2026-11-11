// P73 단위 시험: 고른 노드 막대(혼자인 세션의 막대 항목, 방향·비율·단계 불, H·V 글자 단추, 짧은 단계), 눌러서 확대의 여백(크롬을 뺀 남은 칸의 98%)
import test from 'node:test';
import assert from 'node:assert/strict';
import { blockState, litOf, aspectLabel, presetGlyph, showBar, showLayouts, levelSize, COMPACT_LEVELS, SIZE_DIRS, SIZE_LEVELS, ASPECT_KEYS } from '../src/renderer/lib/selbar.js';
import { enterView, navRoom, NAV_FILL, NAV_GAP, FILL } from '../src/renderer/lib/nav.js';
import { chromeInset } from '../src/renderer/lib/chrome-inset.js';

test('막대 항목: 세션 하나면 방향·단계·비율만, 틀에 들어갈 세션이 둘 이상이면 배치 틀도', () => {
  const docks = [{ dockId: 'd1', members: ['a', 'b'] }];
  assert.equal(showBar([]), false);
  assert.equal(showBar(['x']), true, '혼자인 세션 하나');
  assert.equal(showLayouts(['x'], docks), false, '혼자인 세션 하나면 배치 틀 없음');
  assert.equal(showLayouts(['a'], docks), true, '덩어리 안 노드 하나면 그 덩어리의 틀');
  assert.equal(showLayouts(['x', 'y'], docks), true);
  assert.deepEqual([SIZE_DIRS, SIZE_LEVELS, ASPECT_KEYS], [['wide', 'tall'], ['large', 'normal', 'small'], ['16:9', '4:3']]);
  assert.equal(COMPACT_LEVELS, 5, '방향·단계 글을 짧게 하는 단계를 더했다');
});

test('불: 방향은 모양, 비율은 기록과 모양이 맞을 때, 단계는 비율 불이 있고 넓이가 맞을 때. 여럿이면 모두 같을 때만', () => {
  assert.deepEqual(blockState({ w: 1440, h: 810 }, '16:9'), { dir: 'wide', aspect: '16:9', level: 'normal' });
  assert.deepEqual(blockState({ w: 660, h: 880 }, '4:3'), { dir: 'tall', aspect: '4:3', level: 'small' });
  assert.deepEqual(blockState({ w: 1500, h: 810 }, '16:9'), { dir: 'wide', aspect: null, level: null }, '테두리를 끈 뒤(모양이 어긋남)');
  assert.deepEqual(blockState({ w: 1440, h: 810 }, null), { dir: 'wide', aspect: null, level: null }, '기록 없음');
  const a = blockState({ w: 1440, h: 810 }, '16:9'), b = blockState({ w: 1200, h: 900 }, '4:3');
  assert.deepEqual(litOf([a, a]), { dir: 'wide', aspect: '16:9', level: 'normal' });
  assert.deepEqual(litOf([a, b]), { dir: 'wide', aspect: null, level: 'normal' }, '비율이 다르면 비율 불은 없다');
  assert.deepEqual(litOf([]), { dir: 'wide', aspect: null, level: null });
});

test('비율 단추 글은 세로면 돌린 비율, 단계 풀이 크기는 지금 방향과 비율', () => {
  assert.deepEqual(['16:9', '4:3'].map((x) => aspectLabel(x, 'wide')), ['16:9', '4:3']);
  assert.deepEqual(['16:9', '4:3'].map((x) => aspectLabel(x, 'tall')), ['9:16', '3:4']);
  assert.deepEqual(levelSize('large', { dir: 'tall', aspect: '4:3' }), { w: 1200, h: 1600 });
  assert.deepEqual(levelSize('small', { dir: 'wide', aspect: null, rect: { w: 1000, h: 800 } }), { w: 880, h: 660 }, '비율이 꺼졌으면 모양이 가까운 비율');
});

test('H·V 글자 단추: 칸이 다섯 이상이면 가로 한 줄은 H, 세로 한 줄은 V. 그보다 적으면 그림', () => {
  assert.equal(presetGlyph('row', 4), null);
  assert.equal(presetGlyph('row', 5), 'H');
  assert.equal(presetGlyph('col', 9), 'V');
  assert.equal(presetGlyph('grid-3x2', 6), null);
});

test('눌러서 확대: 위·아래 크롬을 뺀 남은 칸의 99%를 채우고, 가운데는 남은 칸의 가운데', () => {
  assert.deepEqual([NAV_FILL, NAV_GAP], [0.99, 6]);
  const screen = { width: 1584, height: 921 };
  const inset = chromeInset({ left: 0, top: 0, right: 1584, bottom: 921 }, { top: [{ left: 0, right: 400, top: 17, bottom: 55 }], bottom: [{ left: 300, right: 1200, top: 875, bottom: 905 }] }, { gap: NAV_GAP });
  assert.deepEqual([inset.top, inset.bottom], [61, 52]);
  const room = navRoom(screen, inset);
  assert.deepEqual([room.w, room.h], [1584, 921 - 61 - 52]);
  const node = { x: 0, y: 0, w: 1440, h: 810 };
  const v = enterView({ node, screen, inset });
  assert.ok(Math.abs(v.zoom - (room.h * 0.99) / 810) < 1e-9, `배율 ${v.zoom}`);
  const old = enterView({ node, screen });
  assert.ok(v.zoom > old.zoom, `전보다 크다(${old.zoom.toFixed(3)} → ${v.zoom.toFixed(3)})`);
  // 노드의 화면 위·아래가 크롬에 닿지 않는다
  const top = screen.height / 2 + (node.y - v.cy) * v.zoom, bottom = screen.height / 2 + (node.y + node.h - v.cy) * v.zoom;
  assert.ok(top >= inset.top - 0.5 && bottom <= screen.height - inset.bottom + 0.5, `${top.toFixed(1)}..${bottom.toFixed(1)}`);
  assert.ok(Math.abs((top - inset.top) - (screen.height - inset.bottom - bottom)) < 1, '위·아래 여백이 같다');
  // 크롬이 없으면 화면 전체의 98%(전에는 85%)
  const bare = enterView({ node, screen, inset: { top: 0, bottom: 0, left: 0, right: 0 } });
  assert.ok(Math.abs(bare.zoom - Math.min((1584 * 0.99) / 1440, 1)) < 1e-9 || Math.abs(bare.zoom - (921 * 0.99) / 810) < 1e-9);
  assert.ok(bare.zoom > Math.min((1584 * FILL) / 1440, (921 * FILL) / 810));
  // 덩어리도 같은 칸에 맞춘다
  const dock = { x: 0, y: 0, w: 1920, h: 1080 };
  const dv = enterView({ node: { x: 0, y: 0, w: 960, h: 540 }, dock, screen, inset });
  assert.equal(dv.mode, 'dock');
  assert.ok(Math.abs(dv.zoom - Math.min((room.w * 0.99) / 1920, (room.h * 0.99) / 1080)) < 1e-9);
});
