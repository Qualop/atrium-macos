// P121 터미널은 고른 워크스페이스에만: 얼굴 고르기(고른 워크스페이스 안·밖, 누른 노드, 아주 가까운 확대, 고른 것 없음)와 제어기 예산
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickAttached, termAllowed, veryClose, zoomStep, ZOOM_STEP, VERY_CLOSE_FRAC, VERY_CLOSE_KEEP, DEFAULT_MAX_CONTROLLERS } from '../src/renderer/lib/faces.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const screen = { width: 1920, height: 1080 };
const A = 'c:/w/a', B = 'c:/w/b', C = 'c:/w/c';
// 1440×810 노드를 격자로(배율 0.25면 화면 360px: 가까이 얼굴 경계)
const grid = (specs) => specs.map(([id, ws], i) => ({ id, ws, x: (i % 4) * 1500, y: Math.floor(i / 4) * 900, w: 1440, h: 810 }));
const nodes = grid([['a1', A], ['a2', A], ['b1', B], ['b2', B], ['c1', C], ['c2', C], ['a3', A], ['b3', B]]);
const vp = { x: 20, y: 20, zoom: 0.3 }; // 모두 화면 안, 모두 가까이(432px)

test('고른 워크스페이스 안의 노드만 터미널을 받는다', () => {
  const got = pickAttached(nodes, vp, screen, { wsLimit: { key: A } });
  assert.deepEqual(new Set(got), new Set(['a1', 'a2', 'a3']));
  // 워크스페이스를 바꾸면 그쪽으로 옮겨 붙는다
  assert.deepEqual(new Set(pickAttached(nodes, vp, screen, { wsLimit: { key: B } })), new Set(['b1', 'b2', 'b3']));
});

test('wsLimit을 주지 않으면 예전처럼 거르지 않는다(상한 8)', () => {
  assert.equal(pickAttached(nodes, vp, screen).length, 8);
  const many = grid(Array.from({ length: 12 }, (_, i) => [`n${i}`, A]));
  assert.equal(pickAttached(many, { x: 0, y: 0, zoom: 0.26 }, { width: 6000, height: 3000 }, { wsLimit: { key: A } }).length, DEFAULT_MAX_CONTROLLERS);
});

test('다른 워크스페이스 노드를 누르면(초점) 그 노드만 터미널이 된다. 고른(Ctrl) 노드도 같다', () => {
  const got = pickAttached(nodes, vp, screen, { wsLimit: { key: A }, focus: 'c2' });
  assert.deepEqual(new Set(got), new Set(['a1', 'a2', 'a3', 'c2']));
  assert.equal(got[0], 'c2'); // 초점이 먼저
  const sel = pickAttached(nodes, vp, screen, { wsLimit: { key: A }, selected: new Set(['b1']) });
  assert.deepEqual(new Set(sel), new Set(['a1', 'a2', 'a3', 'b1']));
});

test('고른 것이 없으면 초점·고른 노드·아주 가까운 노드만', () => {
  assert.deepEqual(pickAttached(nodes, vp, screen, { wsLimit: { key: null } }), []);
  assert.deepEqual(pickAttached(nodes, vp, screen, { wsLimit: { key: null }, focus: 'b2' }), ['b2']);
  assert.equal(termAllowed({ id: 'x', ws: null, viewWs: null }), false); // 워크스페이스 없는 세션도 고른 것이 없으면 거른다
  assert.equal(termAllowed({ id: 'x', ws: A, viewWs: A }), true);
});

test('아주 가까이: 노드가 화면에 보이는 넓이가 캔버스의 35% 이상이면 다른 워크스페이스여도 터미널', () => {
  const node = { x: 0, y: 0, w: 1440, h: 810 };
  const at = (zoom) => ({ x: (1920 - 1440 * zoom) / 2, y: (1080 - 810 * zoom) / 2, zoom }); // 화면 가운데
  // 16:9 노드가 16:9 캔버스 너비의 60%면 넓이 36%
  const z60 = (1920 * 0.6) / 1440;
  assert.equal(veryClose(node, at(z60), screen), true);
  assert.equal(veryClose(node, at(z60 * 0.97), screen), false);
  // 이력: 이미 아주 가까이였으면 30%까지 남는다(너비 55%면 넓이 30.25%)
  const z55 = (1920 * 0.55) / 1440;
  assert.equal(veryClose(node, at(z55), screen, true), true);
  assert.equal(veryClose(node, at(z55), screen, false), false);
  assert.equal(VERY_CLOSE_KEEP < VERY_CLOSE_FRAC, true);
  // 화면 밖으로 반쯤 나가면 보이는 넓이만 센다: 크게 확대해도 아래에 조금 걸친 이웃 노드는 아니다
  const big = { x: 0, y: 0, zoom: 1 };
  assert.equal(veryClose({ x: 0, y: 0, w: 1440, h: 810 }, big, screen), true); // 1440×810 = 56%
  assert.equal(veryClose({ x: 0, y: 900, w: 1440, h: 810 }, big, screen), false); // 아래 180px만 보임
  assert.equal(veryClose({ x: 0, y: 5000, w: 1440, h: 810 }, big, screen), false); // 화면 밖
  assert.equal(veryClose(node, big, null), false); // 화면 크기를 모르면 아니다
  // 세로 노드도 넓이로: 810×1440 노드가 높이 1080을 꽉 채우면(배율 0.75) 607×1080 = 32% → 아님, 배율 1이면 810×1080 = 42% → 아주 가까이
  assert.equal(veryClose({ x: 0, y: 0, w: 810, h: 1440 }, { x: 0, y: 0, zoom: 0.75 }, screen), false);
  assert.equal(veryClose({ x: 0, y: 0, w: 810, h: 1440 }, { x: 0, y: 0, zoom: 1 }, screen), true);
  // pickAttached: 화면 가운데 다른 워크스페이스 노드 하나를 확대
  const one = [{ id: 'b1', ws: B, ...node }];
  assert.deepEqual(pickAttached(one, at(0.85), screen, { wsLimit: { key: A } }), ['b1']);
  assert.deepEqual(pickAttached(one, at(0.5), screen, { wsLimit: { key: A } }), []);
  // 붙어 있던 노드는 30%까지 남는다(prev)
  assert.deepEqual(pickAttached(one, at(0.75), screen, { wsLimit: { key: A }, prev: new Set(['b1']) }), ['b1']);
  assert.deepEqual(pickAttached(one, at(0.75), screen, { wsLimit: { key: A } }), []);
  // 누른 노드(초점)를 85%로 채운 화면에서 아래에 걸친 같은 워크스페이스 이웃은 붙지 않는다
  const pair = [{ id: 'c1', ws: C, x: 0, y: 0, w: 1440, h: 810 }, { id: 'c2', ws: C, x: 0, y: 850, w: 1440, h: 810 }];
  assert.deepEqual(pickAttached(pair, { x: 200, y: 50, zoom: 1.1 }, screen, { wsLimit: { key: A }, focus: 'c1' }), ['c1']);
});

test('가까이 얼굴이 아니거나 화면 밖이면 고른 워크스페이스여도 붙이지 않는다(예전 규칙 그대로)', () => {
  assert.deepEqual(pickAttached(nodes, { x: 20, y: 20, zoom: 0.15 }, screen, { wsLimit: { key: A } }), []); // 216px: 요약 단계(P124 터미널 240px)
  assert.deepEqual(pickAttached(nodes, { x: -50000, y: 0, zoom: 0.3 }, screen, { wsLimit: { key: A }, focus: 'a1' }), []);
});

test('제어기 예산: 고른 워크스페이스 노드가 상한보다 많으면 초점 → 가운데 순으로 상한까지', () => {
  const many = grid(Array.from({ length: 12 }, (_, i) => [`n${i}`, A])).concat(grid([['z', B]]).map((n) => ({ ...n, x: 9000 })));
  const got = pickAttached(many, { x: 0, y: 0, zoom: 0.26 }, { width: 6000, height: 3000 }, { max: 4, wsLimit: { key: A }, focus: 'z' });
  assert.equal(got.length, 4);
  assert.equal(got[0], 'z');
});

test('계단 배율: 1.1배마다 한 계단, 가장 가까운 계단으로(차이 ±5% 안)', () => {
  for (const z of [0.03, 0.1, 0.18, 0.25, 0.5, 0.77, 1, 1.6]) {
    const q = zoomStep(z);
    assert.ok(Math.abs(q / z - 1) <= Math.sqrt(ZOOM_STEP) - 1 + 1e-9, `${z} → ${q}`);
  }
  assert.equal(zoomStep(0.25), zoomStep(0.2501)); // 조금 바뀌면 그대로
  assert.notEqual(zoomStep(0.25), zoomStep(0.25 * ZOOM_STEP));
  assert.equal(zoomStep(0), zoomStep(0.02)); // 하한
});

test('요약 얼굴 안내 글은 두 사전에 있다', () => {
  assert.ok(en.brief && en.brief.hint && /terminal/i.test(en.brief.hint));
  assert.ok(ko.brief && ko.brief.hint && /터미널/.test(ko.brief.hint));
});
