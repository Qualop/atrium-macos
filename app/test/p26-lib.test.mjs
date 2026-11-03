// P26 단위 시험: 고른 노드 막대(크기 단계 찾기, 토글, 자리), 덩어리 안 연결선의 끝 자리(초점 세션의 테두리 가운데), 눌러서 보기(85% 채우기, 이미 보는 중)
import test from 'node:test';
import assert from 'node:assert/strict';
import { sizeStepOf, litStep, autoDir, flipStep, sizeTargets, layoutCount, placeBar, stepPlace } from '../src/renderer/lib/selbar.js';
import { borderAnchor, linkEnds, dockFocus, centerOf, placeLabels } from '../src/renderer/lib/dock-links.js';
import { enterView, isViewing, fullyVisible, dockRect, FILL, ZOOM_MAX } from '../src/renderer/lib/nav.js';

test('크기 단계 찾기: 여섯 중 맞는 것(±1px), 없으면 null', () => {
  assert.equal(sizeStepOf({ w: 1040, h: 585 }), 'wide-normal');
  assert.equal(sizeStepOf({ w: 1041, h: 584 }), 'wide-normal', '1px 어긋남은 같다');
  assert.equal(sizeStepOf({ w: 480, h: 740 }), 'tall-small');
  assert.equal(sizeStepOf({ w: 720, h: 460 }), null, '옛 보통(720×460)은 막대 단계가 아니다');
  assert.equal(sizeStepOf({ w: 1043, h: 585 }), null);
  assert.equal(sizeStepOf(null), null);
  assert.deepEqual(stepPlace('tall-large'), { dir: 'tall', i: 0 });
  assert.equal(stepPlace('large'), null);
});

test('불: 고른 것 모두 같은 단계일 때만. 토글 쪽은 불의 쪽, 없으면 모양', () => {
  assert.equal(litStep([{ w: 720, h: 405 }, { w: 720, h: 405 }]), 'wide-small');
  assert.equal(litStep([{ w: 720, h: 405 }, { w: 1040, h: 585 }]), null);
  assert.equal(litStep([]), null);
  assert.equal(autoDir([{ w: 600, h: 920 }]), 'tall');
  assert.equal(autoDir([{ w: 900, h: 500 }]), 'wide');
  assert.equal(autoDir([{ w: 500, h: 900 }]), 'tall');
  assert.equal(flipStep('wide-normal', 'tall'), 'tall-normal', '토글을 바꾸면 같은 단계');
  assert.equal(flipStep('tall-large', 'wide'), 'wide-large');
  assert.equal(flipStep('wide-normal', 'wide'), null, '같은 쪽이면 그대로');
  assert.equal(flipStep(null, 'tall'), null, '불이 없으면 쪽만 바꾼다');
});

test('크기 대상과 틀 세션 수: 덩어리 안 노드는 덩어리 하나, 구성 노드 모두', () => {
  const docks = [{ dockId: 'd1', members: ['a', 'b', 'c'] }];
  assert.deepEqual(sizeTargets(['a', 'b', 'x'], docks), [{ id: 'a', dockId: 'd1', members: ['a', 'b', 'c'] }, { id: 'x', dockId: null, members: ['x'] }]);
  assert.equal(layoutCount(['b'], docks), 3, '덩어리 안 노드 하나를 고르면 그 덩어리 세션 수');
  assert.equal(layoutCount(['b', 'x', 'y'], docks), 5);
  assert.equal(layoutCount(['x', 'y'], docks), 2);
});

test('막대 자리: 맨 위 줄 창 가운데, 두 묶음 사이로 밀고, 좁으면 단계별로 줄이고, 그래도 모자라면 아래 줄', () => {
  const widths = [700, 560, 480, 360]; // 다 펴짐, 이름 숨김, 짧게, 틀 접음
  // 넓은 창: 다 펴서 가운데
  assert.deepEqual(placeBar({ width: 1600, tlRight: 300, trLeft: 1300, widths }), { row: 'top', level: 0, x: 450, w: 700 });
  // 가운데에 두면 왼쪽 묶음과 겹친다 → 오른쪽으로 민다
  assert.deepEqual(placeBar({ width: 1600, tlRight: 500, trLeft: 1300, widths }), { row: 'top', level: 0, x: 512, w: 700 });
  // 사이가 좁으면 들어가는 가장 낮은 단계
  assert.deepEqual(placeBar({ width: 1584, tlRight: 503, trLeft: 1079, widths }), { row: 'top', level: 2, x: 552, w: 480 });
  assert.equal(placeBar({ width: 1584, tlRight: 503, trLeft: 900, widths }).level, 3);
  // 가장 줄인 막대도 안 들어간다 → 아래 줄(다 펴서)
  assert.deepEqual(placeBar({ width: 1000, tlRight: 400, trLeft: 495, widths }), { row: 'below', level: 0 });
});

test('선 끝: 테두리 가운데는 상대 쪽(위·아래·왼쪽·오른쪽)', () => {
  const r = { x: 0, y: 0, w: 800, h: 400 };
  assert.deepEqual(borderAnchor(r, { x: 2000, y: 250 }), { x: 800, y: 200, side: 'right' });
  assert.deepEqual(borderAnchor(r, { x: -100, y: 180 }), { x: 0, y: 200, side: 'left' });
  assert.deepEqual(borderAnchor(r, { x: 420, y: 900 }), { x: 400, y: 400, side: 'bottom' });
  assert.deepEqual(borderAnchor(r, { x: 380, y: -50 }), { x: 400, y: 0, side: 'top' });
  // 대각선: 가로로 긴 사각형은 가운데에서 그은 선이 위·아래 테두리를 먼저 지나면 위·아래
  assert.equal(borderAnchor(r, { x: 900, y: 700 }).side, 'bottom');
  assert.equal(borderAnchor(r, { x: 1600, y: 700 }).side, 'right');
});

test('선 끝: 초점 쪽만 테두리 가운데, 상대는 가운데 점', () => {
  const a = { x: 0, y: 0, w: 720, h: 460 }, b = { x: 720, y: 0, w: 720, h: 460 }, c = { x: 0, y: 460, w: 1440, h: 460 };
  assert.deepEqual(linkEnds(a, b), { a: centerOf(a), b: centerOf(b), anchored: null });
  assert.deepEqual(linkEnds(a, b, 'from'), { a: { x: 720, y: 230, side: 'right' }, b: centerOf(b), anchored: 'from' });
  assert.deepEqual(linkEnds(a, c, 'to'), { a: centerOf(a), b: { x: 720, y: 460, side: 'top' }, anchored: 'to' });
});

test('초점 세션: 고름 > 눌러 들어감(보일 때) > 화면 가운데 > 없음', () => {
  const rects = { a: { x: 0, y: 0, w: 720, h: 460 }, b: { x: 720, y: 0, w: 720, h: 460 } };
  const view = { x: 800, y: 0, w: 600, h: 400 }; // 가운데 (1100, 200)는 b 안
  assert.equal(dockFocus({ rects, selected: ['x', 'a'], focusId: 'b', view }), 'a');
  assert.equal(dockFocus({ rects, selected: [], focusId: 'a', view: { x: 0, y: 0, w: 1440, h: 460 } }), 'a');
  assert.equal(dockFocus({ rects, focusId: 'a', view }), 'b', '눌러 들어간 노드가 화면 밖이면 가운데');
  assert.equal(dockFocus({ rects, focusId: 'zz', view }), 'b');
  assert.equal(dockFocus({ rects, view: { x: 5000, y: 0, w: 100, h: 100 } }), null);
  assert.equal(dockFocus({ rects }), null);
});

const screen = { width: 1600, height: 900 };
test('navigation keeps tall nodes visible and never magnifies a narrow dock leaf above 1', () => {
  for (const [node, dock, screen] of [
    [{ x: 0, y: 0, w: 480, h: 2000 }, null, { width: 900, height: 600 }],
    [{ x: 0, y: 0, w: 240, h: 1000 }, { x: 0, y: 0, w: 2400, h: 1000 }, { width: 900, height: 600 }],
  ]) {
    const view = enterView({ node, dock, screen });
    assert.ok(view.zoom <= 1);
    assert.ok(fullyVisible(node, { x: screen.width / 2 - view.cx * view.zoom, y: screen.height / 2 - view.cy * view.zoom, zoom: view.zoom }, screen));
  }
});
test('눌러서 보기: 노드나 덩어리가 화면의 85%를 채우고 배율은 1까지', () => {
  assert.equal(FILL, 0.85); assert.equal(ZOOM_MAX, 1);
  const r = { x: 0, y: 0, w: 1040, h: 585 };
  const v = enterView({ node: r, screen });
  assert.ok(Math.abs(v.zoom * r.w - 0.85 * 1600) < 1e-6 || Math.abs(v.zoom * r.h - 0.85 * 900) < 1e-6 || v.zoom === 1);
  assert.ok(Math.abs(v.zoom - Math.min(1360 / 1040, 765 / 585, 1)) < 1e-9);
  const big = { x: 0, y: 0, w: 2880, h: 1840 };
  const g = enterView({ node: { x: 0, y: 0, w: 1440, h: 920 }, dock: big, screen });
  assert.equal(g.mode, 'dock'); assert.ok(Math.abs(g.zoom - 765 / 1840) < 1e-9);
  assert.equal(g.cx, 1440); assert.equal(g.cy, 920);
});

test('이미 보는 중이면 다시 옮기지 않는다', () => {
  const node = { x: 0, y: 0, w: 720, h: 460 };
  const v = enterView({ node, screen }); // 배율 1, 가운데 (360, 230)
  const at = (zoom, cx, cy) => ({ x: screen.width / 2 - cx * zoom, y: screen.height / 2 - cy * zoom, zoom });
  assert.ok(isViewing({ node, view: v, viewport: at(1, 360, 230), screen }), '맞춘 그대로');
  assert.ok(isViewing({ node, view: v, viewport: at(0.8, 300, 200), screen }), '조금 작고 조금 비켜도 다 보이면');
  assert.ok(!isViewing({ node, view: v, viewport: at(0.5, 360, 230), screen }), '너무 멀면(맞출 배율의 3/4 아래) 옮긴다');
  assert.ok(!isViewing({ node, view: v, viewport: at(1, 1200, 230), screen }), '다 보이지 않으면 옮긴다');
  // 덩어리: 덩어리가 다 보이면 다른 구성 노드를 눌러도 그대로, 구성 노드를 크게 보고 있어도 그대로
  const a = { x: 0, y: 0, w: 720, h: 460 }, b = { x: 720, y: 0, w: 720, h: 460 }, c = { x: 1440, y: 0, w: 720, h: 460 };
  const dock = dockRect([a, b, c]);
  const dv = enterView({ node: b, dock, screen });
  assert.equal(dv.mode, 'dock');
  assert.ok(isViewing({ node: c, dock, view: enterView({ node: c, dock, screen }), viewport: at(dv.zoom, dv.cx, dv.cy), screen }));
  assert.ok(isViewing({ node: b, dock, view: dv, viewport: at(1.4, 1080, 230), screen }), '구성 노드를 더 크게 보는 중');
  assert.ok(!isViewing({ node: a, dock, view: enterView({ node: a, dock, screen }), viewport: at(1.4, 1080, 230), screen }), '크게 보는 노드가 아닌 쪽을 누르면 옮긴다');
  // 멀리서 덩어리가 다 보여도 터미널(가까이 얼굴)이 아니면 옮긴다
  assert.ok(!isViewing({ node: b, dock, view: dv, viewport: at(0.45, 1080, 230), screen }));
  assert.ok(fullyVisible(node, at(1, 360, 230), screen));
});

test('선 글 자리: 시키는 쪽 가까이(0.36), 겹치면 선을 따라 옮긴다', () => {
  const one = placeLabels([{ a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, w: 100, h: 20 }]);
  assert.deepEqual(one, [{ x: 360, y: 0, k: 0.36 }]);
  // X자로 엇갈린 두 선: 두 글이 같은 자리에 오면 둘째를 옮긴다
  const two = placeLabels([
    { a: { x: 720, y: 230 }, b: { x: 1080, y: 690 }, w: 140, h: 20 },
    { a: { x: 1080, y: 230 }, b: { x: 360, y: 690 }, w: 140, h: 20 },
  ]);
  assert.equal(two[0].k, 0.36);
  assert.notEqual(two[1].k, 0.36);
  assert.ok(Math.abs(two[0].x - two[1].x) * 2 >= 140 || Math.abs(two[0].y - two[1].y) * 2 >= 20, '겹치지 않는다');
});
