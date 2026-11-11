// P76 휴대폰(터치) 보드 화면: 터치 판단, 탭·길게 누름·끌기 가르기, 길게 누름 시간, 두 손가락 확대, 탭할 때 전체 보기·확대,
// 전체 보기의 칸 나누기와 키보드가 올라올 때 올릴 양, 입력 줄 보내기, 기본 화면(보드), 마우스 보드가 그대로인 것
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LONG_PRESS_MS, TOUCH_SLOP_PX, TAP_MAX_MS, PINCH_EXIT_RATIO, oneFinger, releaseKind, pinchViewport, panViewport, mid, dist, dragDelta,
  tapTarget, movableId, tapAction, fullLayout, kbShift, lastContentRow, linePlan, lineEnterSends, ENTER_DELAY_MS, FULL_KEYS, showPhoneList, LIST_PREF,
} from '../src/renderer/lib/touch-board.js';
import { keyBytes } from '../src/renderer/lib/phone.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(ROOT, 'src', 'renderer', f), 'utf8');

test('길게 누름 시간은 0.5초 안팎, 탭과 끌기를 가르는 거리는 손가락 흔들림보다 크다', () => {
  assert.ok(LONG_PRESS_MS >= 400 && LONG_PRESS_MS <= 700, `LONG_PRESS_MS ${LONG_PRESS_MS}`);
  assert.equal(TAP_MAX_MS, LONG_PRESS_MS);
  assert.ok(TOUCH_SLOP_PX >= 6 && TOUCH_SLOP_PX <= 12);
  assert.ok(PINCH_EXIT_RATIO > 0.5 && PINCH_EXIT_RATIO < 0.9);
});

test('한 손가락 가르기: 움직이면 판 옮기기(노드 위에서도), 가만히 0.5초면 길게 누름, 그 전에 떼면 탭', () => {
  assert.equal(oneFinger({ dist: 3, dt: 100 }), 'pending');
  assert.equal(oneFinger({ dist: TOUCH_SLOP_PX + 1, dt: 100 }), 'pan', '노드 위 끌기도 판');
  assert.equal(oneFinger({ dist: TOUCH_SLOP_PX + 1, dt: 300, onNode: true }), 'pan', '0.3초 누른 뒤 끌어도 판');
  assert.equal(oneFinger({ dist: 2, dt: LONG_PRESS_MS }), 'hold');
  assert.equal(oneFinger({ dist: 2, dt: LONG_PRESS_MS + 500, onNode: false }), 'pending', '빈 판은 길게 눌러도 옮길 것이 없다');
  assert.equal(oneFinger({ dist: 50, dt: 900, lifted: true }), 'hold', '잡은 뒤에는 움직여도 노드 옮기기');
  assert.equal(releaseKind({ mode: 'pending', dist: 2, dt: 120 }), 'tap');
  assert.equal(releaseKind({ mode: 'pending', dist: 2, dt: LONG_PRESS_MS + 10 }), 'none');
  assert.equal(releaseKind({ mode: 'pan', dist: 80, dt: 200 }), 'pan');
  assert.equal(releaseKind({ mode: 'hold', dist: 80, dt: 900 }), 'hold');
});

test('두 손가락: 가운데 아래의 판 점을 지키며 확대·축소하고 가운데가 움직이면 판도 옮긴다. 배율 한계', () => {
  const v0 = { x: 100, y: 50, zoom: 0.5 };
  const m0 = { x: 200, y: 400 };
  const v = pinchViewport(v0, m0, 100, m0, 300);
  assert.equal(v.zoom, 1.5);
  const p0 = { x: (m0.x - v0.x) / v0.zoom, y: (m0.y - v0.y) / v0.zoom }, p1 = { x: (m0.x - v.x) / v.zoom, y: (m0.y - v.y) / v.zoom };
  assert.ok(Math.abs(p0.x - p1.x) < 1e-9 && Math.abs(p0.y - p1.y) < 1e-9, '가운데 아래 점이 그대로');
  const moved = pinchViewport(v0, m0, 100, { x: 230, y: 380 }, 100);
  assert.deepEqual(moved, { x: 130, y: 30, zoom: 0.5 }, '거리 그대로면 옮기기만');
  assert.equal(pinchViewport(v0, m0, 100, m0, 10000).zoom, 2);
  assert.equal(pinchViewport(v0, m0, 100, m0, 1).zoom, 0.05);
  assert.deepEqual(panViewport(v0, -80, 160), { x: 20, y: 210, zoom: 0.5 });
  assert.deepEqual(mid({ x: 0, y: 0 }, { x: 10, y: 20 }), { x: 5, y: 10 });
  assert.equal(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.deepEqual(dragDelta(36, -120, 0.5), { dx: 72, dy: -240 });
});

// closest만 흉내 낸 요소
const el = (chain) => ({ closest: (sel) => chain.find((c) => sel.split(',').some((s) => c.match(s.trim()))) || null });
const node = (id, cls) => ({ match: (s) => s === '.react-flow__node', getAttribute: () => id, classList: { contains: (c) => cls.includes(c) } });
const btn = (cls = '') => ({ match: (s) => s === 'button', classList: { contains: (c) => cls.includes(c) } });
test('탭한 자리 가르기: 노드 안 단추·입력칸은 그것을 누르고, 세션·메모·영역·빈 판을 가른다. 잇기 손잡이는 노드', () => {
  const sess = node('s1', 'react-flow__node-session');
  assert.deepEqual(tapTarget(el([sess])), { kind: 'session', id: 's1' });
  assert.deepEqual(tapTarget(el([btn(), sess])), { kind: 'control', id: 's1' });
  assert.deepEqual(tapTarget(el([btn('react-flow__handle'), sess])), { kind: 'session', id: 's1' });
  assert.deepEqual(tapTarget(el([node('memo:m1', 'react-flow__node-memo')])), { kind: 'item', id: 'memo:m1' });
  assert.deepEqual(tapTarget(el([node('ws:k', 'react-flow__node-region')])), { kind: 'region', id: 'ws:k' });
  assert.deepEqual(tapTarget(el([])), { kind: 'pane' });
  assert.deepEqual(tapTarget(null), { kind: 'pane' });
  assert.equal(movableId({ kind: 'session', id: 's1' }), 's1');
  assert.equal(movableId({ kind: 'item', id: 'memo:m1' }), 'memo:m1');
  assert.equal(movableId({ kind: 'region', id: 'ws:k' }), null, '영역은 길게 눌러 옮기지 않는다');
  assert.equal(movableId({ kind: 'pane' }), null);
});

test('탭하면: 휴대폰 세로는 전체 보기, 가로·태블릿·마우스 창은 그 노드로 확대', () => {
  assert.equal(tapAction({ width: 390, height: 844, coarse: true }), 'full');
  assert.equal(tapAction({ width: 430, height: 932, coarse: true }), 'full');
  assert.equal(tapAction({ width: 844, height: 390, coarse: true }), 'zoom');
  assert.equal(tapAction({ width: 820, height: 1180, coarse: true }), 'zoom');
  assert.equal(tapAction({ width: 390, height: 844, coarse: false }), 'zoom');
});

test('기본 화면은 보드 화면, 세션 목록은 목록 단추로 골랐을 때만(휴대폰 세로). 옛 "보드" 값은 기본과 같다', () => {
  assert.equal(showPhoneList({ phone: true, pref: null }), false);
  assert.equal(showPhoneList({ phone: true, pref: 'board' }), false);
  assert.equal(showPhoneList({ phone: true, pref: LIST_PREF }), true);
  assert.equal(showPhoneList({ phone: false, pref: LIST_PREF }), false, '가로로 돌리면 보드');
});

test('전체 보기 칸 나누기: 키보드가 열리면 터미널 높이는 그대로(패널 크기 그대로), 보이는 칸만 줄어든다', () => {
  const closed = fullLayout({ vvHeight: 844, innerHeight: 844, top: 34, line: 46, keys: 48 });
  assert.deepEqual(closed, { open: false, room: 716, term: 716 });
  const open = fullLayout({ vvHeight: 508, innerHeight: 844, top: 34, line: 46, keys: 48, closedTerm: closed.room });
  assert.equal(open.open, true);
  assert.equal(open.room, 380);
  assert.equal(open.term, 716);
  const small = fullLayout({ vvHeight: 800, innerHeight: 844, top: 34, line: 46, keys: 48, closedTerm: 716 });
  assert.equal(small.open, false, '주소 막대만큼 줄어든 것은 키보드가 아니다');
});

test('키보드가 열리면 올릴 양: 글이 아래까지 있으면 아래 줄이 입력 줄 바로 위, 위쪽에만 있으면 그대로', () => {
  assert.equal(kbShift({ term: 716, room: 380, contentBottom: 716 }), 336, 'Claude Code처럼 아래까지');
  assert.equal(kbShift({ term: 716, room: 380, contentBottom: 40 }), 0, '새 셸의 프롬프트');
  assert.equal(kbShift({ term: 716, room: 380, contentBottom: 500 }), 120);
  assert.equal(kbShift({ term: 716, room: 716, contentBottom: 716 }), 0, '키보드 없음');
  assert.equal(kbShift({ term: 716, room: 380, contentBottom: 9999 }), 336, '넘치지 않는다');
  assert.equal(lastContentRow(['a', '', 'b', '', ''], 0), 2);
  assert.equal(lastContentRow(['a', '', '', '', ''], 3), 3, '커서 줄이 더 아래');
  assert.equal(lastContentRow([], 0), 0);
});

test('입력 줄: 확정된 글을 치고 잠깐 뒤 Enter, 여러 줄은 괄호 붙여넣기, 빈 줄은 Enter만. 조합 중 Enter는 보내지 않는다', () => {
  assert.deepEqual(linePlan('echo 한글'), [{ data: 'echo 한글', delay: 0 }, { data: '\r', delay: ENTER_DELAY_MS }]);
  assert.deepEqual(linePlan('a\r\nb'), [{ data: '\x1b[200~a\nb\x1b[201~', delay: 0 }, { data: '\r', delay: ENTER_DELAY_MS }]);
  assert.deepEqual(linePlan(''), [{ data: '\r', delay: 0 }]);
  assert.equal(lineEnterSends({ key: 'Enter' }), true);
  assert.equal(lineEnterSends({ key: 'Enter', isComposing: true }), false, '한글 조합 확정 Enter');
  assert.equal(lineEnterSends({ key: 'Enter', keyCode: 229 }), false, 'IME가 처리 중인 Enter(Safari)');
  assert.equal(lineEnterSends({ key: 'Enter', shiftKey: true }), false, 'Shift+Enter는 줄바꿈');
  assert.equal(lineEnterSends({ key: 'a' }), false);
});

test('키 줄: Esc, Ctrl+C, Tab, ⇧Tab, 화살표 넷, /, Enter가 모두 바이트를 가진다', () => {
  for (const k of ['esc', 'ctrlc', 'tab', 'shifttab', 'up', 'down', 'left', 'right', 'slash', 'enter']) assert.ok(FULL_KEYS.includes(k), k);
  for (const k of FULL_KEYS) assert.ok(keyBytes(k).length > 0, k);
  assert.equal(keyBytes('left'), '\x1b[D');
  assert.equal(keyBytes('right', { appCursor: true }), '\x1bOC');
});

test('마우스 보드는 그대로: 판의 터치 규칙은 터치 이벤트에만 걸리고, React Flow의 마우스 끌기·누르기 설정은 바뀌지 않았다', () => {
  const c = src('Canvas.jsx');
  const block = c.slice(c.indexOf('P76: 터치(손가락)는 판이'), c.indexOf('// H4: 노드 본문을 누르면'));
  assert.ok(block.length > 1000);
  const events = [...block.matchAll(/addEventListener\('([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(events)].sort(), ['gesturestart', 'touchcancel', 'touchend', 'touchmove', 'touchstart'], '마우스·포인터 이벤트는 받지 않는다');
  assert.ok(!/nodesDraggable|panOnDrag|zoomOnPinch/.test(c), 'React Flow 끌기·옮기기 설정을 바꾸지 않았다');
  assert.ok(c.includes('onNodeClick={onNodeClick}') && c.includes("getState().navigateTo(node.id, { focusTerminal: true });"), '마우스 누르기는 그대로 들어간다(눌러서 확대 P73)');
  // P87: 휴대폰은 늘 목록이라 보드 위의 목록 단추와 전체 보기를 붙이지 않는다(태블릿·마우스 보드에는 원래 없었다)
  const m = src('main.jsx');
  assert.ok(!m.includes('<PhoneListButton />') && !m.includes('<PhoneFull />'));
});
