// P30: 덩어리 안 연결(다리·괄호·둘레 길·칩)을 고르는 순수 함수(app/src/renderer/lib/dock-links.js dockRoutes)
import test from 'node:test';
import assert from 'node:assert/strict';
import { dockRoutes, sharedEdge, outerSides, roundedPath, arrowHead, linkActive, dockFocus } from '../src/renderer/lib/dock-links.js';
import { presetTree, presetsFor, layout } from '../../backend/src/dock-tree.mjs';
import { flipStep, nearestStep, litStep } from '../src/renderer/lib/selbar.js';

test('막대 토글: 불이 없으면(붙여 막 만든 덩어리) 누른 쪽에서 가장 가까운 단계, 불이 있으면 같은 단계', () => {
  const pair = { x: 0, y: 0, w: 1440, h: 460 }; // 720 × 460 둘을 옆으로 붙인 덩어리: 여섯 단계 어디에도 맞지 않는다
  assert.equal(litStep([pair]), null);
  assert.equal(flipStep(null, 'wide', pair), 'wide-normal');
  assert.equal(flipStep(null, 'tall', pair), 'tall-normal');
  assert.equal(nearestStep({ w: 2880, h: 920 }, 'wide'), 'wide-large', '큰 덩어리는 크게');
  assert.equal(nearestStep({ w: 480, h: 300 }, 'tall'), 'tall-small', '작은 것은 작게');
  const stack = { x: 0, y: 0, w: 720, h: 920 }; // 위아래로 붙인 덩어리
  assert.equal(nearestStep(stack, 'tall'), 'tall-normal');
  assert.equal(nearestStep(stack, 'wide'), 'wide-normal');
  assert.equal(flipStep(null, 'tall', null), null, '대상이 여럿이면(사각형 없음) 쪽만 바꾼다');
  assert.equal(flipStep('wide-small', 'tall', pair), 'tall-small', '불이 있으면 같은 단계');
  assert.equal(flipStep('wide-small', 'wide', pair), null);
});

const L = (from, to, linkId = `${from}>${to}`) => ({ linkId, from, to });
const rectsOf = (preset, ids, outer = { x: 0, y: 0, w: 1440, h: 920 }) => Object.fromEntries(layout(presetTree(preset, ids), outer).rects);
const kindOf = (res, linkId) => (res.bridges.some((b) => b.linkId === linkId) ? 'bridge' : res.chips.some((c) => c.linkId === linkId) ? 'chip' : (res.routes.find((r) => r.linkId === linkId) || {}).kind);
// 바깥 길의 점이 칸 안(테두리 제외)으로 들어가지 않는다: 처음과 끝 점만 칸 테두리, 나머지는 바깥 O 밖
const outsideOk = (r, O) => r.points.slice(1, -1).every((p) => p.x < O.x || p.x > O.x + O.w || p.y < O.y || p.y > O.y + O.h);
const O = (rects) => { const rs = Object.values(rects); const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y)); return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }; };

test('맞닿음: 함께 쓰는 경계와 방향, 모서리만 닿으면 없음', () => {
  const a = { x: 0, y: 0, w: 720, h: 460 }, b = { x: 720, y: 0, w: 720, h: 460 }, c = { x: 0, y: 460, w: 720, h: 460 }, d = { x: 720, y: 460, w: 720, h: 460 };
  assert.deepEqual(sharedEdge(a, b), { axis: 'v', at: 720, lo: 0, hi: 460, arrow: 'right' });
  assert.deepEqual(sharedEdge(b, a), { axis: 'v', at: 720, lo: 0, hi: 460, arrow: 'left' });
  assert.deepEqual(sharedEdge(a, c), { axis: 'h', at: 460, lo: 0, hi: 720, arrow: 'down' });
  assert.equal(sharedEdge(c, a).arrow, 'up');
  assert.equal(sharedEdge(a, d), null, '대각선(모서리 한 점)은 맞닿지 않는다');
  assert.deepEqual(outerSides(a, { x: 0, y: 0, w: 1440, h: 920 }), ['left', 'top']);
  assert.deepEqual(outerSides(d, { x: 0, y: 0, w: 1440, h: 920 }), ['right', 'bottom']);
});

test('2개 덩어리: 가로·세로 모두 가운데 경계의 다리 하나', () => {
  const row = rectsOf('row', ['a', 'b']);
  const r1 = dockRoutes(row, [L('a', 'b')]);
  assert.equal(r1.bridges.length, 1);
  assert.deepEqual(r1.routes, []);
  assert.deepEqual({ x: r1.bridges[0].x, y: r1.bridges[0].y, axis: r1.bridges[0].axis, arrow: r1.bridges[0].arrow }, { x: 720, y: 460, axis: 'v', arrow: 'right' });
  const col = rectsOf('col', ['a', 'b']);
  const r2 = dockRoutes(col, [L('b', 'a')]);
  assert.deepEqual({ x: r2.bridges[0].x, y: r2.bridges[0].y, axis: r2.bridges[0].axis, arrow: r2.bridges[0].arrow }, { x: 720, y: 460, axis: 'h', arrow: 'up' });
  // 서로 시키면 같은 경계에 둘을 나눠 놓는다(방향 반대)
  const r3 = dockRoutes(row, [L('a', 'b'), L('b', 'a')]);
  assert.equal(r3.bridges.length, 2);
  assert.ok(r3.bridges.every((b) => b.x === 720));
  assert.notEqual(r3.bridges[0].y, r3.bridges[1].y);
  assert.deepEqual(r3.bridges.map((b) => b.arrow).sort(), ['left', 'right']);
});

test('1x3(왼쪽 lead, 오른쪽 ui·tests·review): lead → 셋은 세로 경계의 다리, ui → review는 오른쪽 괄호', () => {
  const rects = rectsOf('main-left-3', ['lead', 'ui', 'tests', 'review']);
  const res = dockRoutes(rects, [L('lead', 'ui'), L('lead', 'tests'), L('lead', 'review'), L('ui', 'review')]);
  assert.equal(res.bridges.length, 3);
  const X = rects.ui.x;
  for (const b of res.bridges) { assert.equal(b.x, X, '세로 경계 위'); assert.equal(b.arrow, 'right'); }
  // 다리마다 받는 칸의 세로 가운데
  for (const id of ['ui', 'tests', 'review']) { const b = res.bridges.find((x) => x.to === id); assert.equal(b.y, rects[id].y + rects[id].h / 2); }
  assert.equal(res.routes.length, 1);
  const br = res.routes[0];
  assert.equal(br.kind, 'bracket');
  assert.deepEqual(br.sides, ['right', 'right']);
  assert.equal(br.lane, 0);
  const R = rects.ui.x + rects.ui.w;
  assert.deepEqual(br.points[0], { x: R, y: rects.ui.y + rects.ui.h / 2 });
  assert.deepEqual(br.points[br.points.length - 1], { x: R, y: rects.review.y + rects.review.h / 2 });
  assert.ok(br.points.slice(1, -1).every((p) => p.x === R + br.d), '] 모양: 바깥으로 띄운 세로선');
  assert.equal(br.points.length, 4);
});

test('2x2: 이웃은 다리, 대각선은 둘레 길(모서리 하나 도는 ㄱ자), 겹치는 둘레 길은 다른 차선', () => {
  const rects = rectsOf('grid', ['a', 'b', 'c', 'd']); // a b / c d
  const res = dockRoutes(rects, [L('a', 'd'), L('b', 'c'), L('a', 'b')]);
  assert.equal(kindOf(res, 'a>b'), 'bridge');
  assert.equal(kindOf(res, 'a>d'), 'around');
  assert.equal(kindOf(res, 'b>c'), 'around');
  const ad = res.routes.find((r) => r.linkId === 'a>d'), bc = res.routes.find((r) => r.linkId === 'b>c');
  for (const r of [ad, bc]) {
    assert.equal(r.points.length, 5, '칸 → 바깥 → 모서리 하나 → 바깥 → 칸');
    assert.ok(outsideOk(r, O(rects)));
  }
  // a(왼쪽 위) → d(오른쪽 아래): 위·오른쪽이나 왼쪽·아래로 돈다
  assert.ok(['top,right', 'left,bottom'].includes(ad.sides.join(',')), ad.sides.join(','));
  // 두 길이 같은 모서리를 돌면 차선이 다르다
  const corner = (r) => r.points[2];
  const sameCorner = Math.sign(corner(ad).x - 720) === Math.sign(corner(bc).x - 720) && Math.sign(corner(ad).y - 460) === Math.sign(corner(bc).y - 460);
  if (sameCorner) assert.notEqual(ad.lane, bc.lane);
});

test('같은 변을 지나는 괄호들은 차선을 나누고 짧은 것이 안쪽', () => {
  // 세로 넷(col): a / b / c / d. a → c, a → d, b → d는 모두 맞닿지 않고 오른쪽·왼쪽 변을 함께 쓴다
  const rects = rectsOf('col', ['a', 'b', 'c', 'd'], { x: 0, y: 0, w: 720, h: 1840 });
  const res = dockRoutes(rects, [L('a', 'c'), L('a', 'd'), L('b', 'd')]);
  assert.equal(res.routes.length, 3);
  assert.ok(res.routes.every((r) => r.kind === 'bracket'));
  const byLane = (id) => res.routes.find((r) => r.linkId === id);
  // a → d가 가장 길다. 같은 변에서 다른 둘과 겹치면 더 바깥 차선
  const sameSide = (x, y) => x.sides[0] === y.sides[0];
  for (const short of ['a>c', 'b>d']) if (sameSide(byLane(short), byLane('a>d'))) assert.ok(byLane('a>d').lane > byLane(short).lane);
  // 같은 변·같은 차선의 둘은 구간이 겹치지 않는다
  for (const x of res.routes) for (const y of res.routes) {
    if (x === y || x.sides[0] !== y.sides[0] || x.lane !== y.lane) continue;
    const span = (r) => [Math.min(...r.points.map((p) => p.y)), Math.max(...r.points.map((p) => p.y))];
    const [a0, a1] = span(x), [b0, b1] = span(y);
    assert.ok(a1 <= b0 + 2 || b1 <= a0 + 2, `${x.linkId}·${y.linkId} 겹침`);
  }
});

test('둘레에 닿지 않는 칸(3 x 3 가운데)은 칩', () => {
  const rects = {};
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) rects[`c${i}${j}`] = { x: j * 400, y: i * 300, w: 400, h: 300 };
  const res = dockRoutes(rects, [L('c00', 'c11'), L('c11', 'c22'), L('c00', 'c01'), L('c00', 'c22')]);
  assert.deepEqual(res.chips.map((c) => [c.linkId, c.cell, c.dir]), [['c00>c11', 'c11', 'in'], ['c11>c22', 'c11', 'out']]);
  assert.equal(kindOf(res, 'c00>c11'), 'chip', '가운데와 왼쪽 위는 모서리만 닿는다');
  assert.equal(kindOf(res, 'c00>c01'), 'bridge');
  assert.equal(kindOf(res, 'c00>c22'), 'around');
  // 가운데 칸과 맞닿은 칸 사이는 다리(가운데라도 맞닿으면 다리가 먼저)
  assert.equal(kindOf(dockRoutes(rects, [L('c01', 'c11')]), 'c01>c11'), 'bridge');
});

test('세션 수별 배치 틀: 모든 연결이 한 가지로 정해지고, 바깥 길은 칸 안을 지나지 않는다', () => {
  for (const n of [2, 3, 4, 5, 6, 7]) {
    const ids = Array.from({ length: n }, (_, i) => `s${i}`);
    for (const preset of presetsFor(n)) {
      const rects = rectsOf(preset, ids, { x: 100, y: 50, w: 400 * Math.ceil(Math.sqrt(n)) * 2, h: 300 * Math.ceil(Math.sqrt(n)) });
      const links = [];
      for (const a of ids) for (const b of ids) if (a < b) links.push(L(a, b));
      const res = dockRoutes(rects, links);
      assert.equal(res.bridges.length + res.routes.length + res.chips.length, links.length, `${n} ${preset}`);
      for (const b of res.bridges) assert.ok(sharedEdge(rects[b.from], rects[b.to]), `${preset} ${b.linkId} 다리는 맞닿은 칸`);
      for (const r of res.routes) assert.ok(outsideOk(r, O(rects)), `${preset} ${r.linkId} 바깥으로`);
      // 첫 줄 틀(row)은 이웃끼리 다리, 나머지는 위나 아래 괄호
      if (preset === 'row') for (const r of res.routes) { assert.equal(r.kind, 'bracket'); assert.ok(['top', 'bottom'].includes(r.sides[0])); }
    }
  }
});

test('둥근 길, 화살촉, 오가는 중', () => {
  assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]), 'M0 0 L10 0');
  assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }], 4), 'M0 0 L16 0 Q20 0 20 4 L20 20');
  const h = arrowHead([{ x: 0, y: 0 }, { x: 10, y: 0 }], 4);
  assert.deepEqual(h[0], { x: 10, y: 0 });
  assert.ok(h[1].x === 6 && h[2].x === 6 && h[1].y === -h[2].y);
  const now = 1e12;
  assert.ok(linkActive({ lastAt: now - 1000, lastKind: 'prompt' }, { state: 'working' }, now));
  assert.ok(!linkActive({ lastAt: now - 1000, lastKind: 'prompt' }, { state: 'ready' }, now));
  assert.ok(!linkActive({ lastAt: now - 31 * 60 * 1000, lastKind: 'prompt' }, { state: 'working' }, now));
  // 강조할 초점: 화면 가운데는 보지 않을 수 있다(center: false)
  const rects = { a: { x: 0, y: 0, w: 10, h: 10 } };
  assert.equal(dockFocus({ rects, view: { x: 0, y: 0, w: 10, h: 10 } }), 'a');
  assert.equal(dockFocus({ rects, view: { x: 0, y: 0, w: 10, h: 10 }, center: false }), null);
});
