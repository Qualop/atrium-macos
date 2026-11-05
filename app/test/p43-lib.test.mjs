// P43: 아래 바 자동 숨김 판단(lib/bottom.js)과 판의 방향키 판단(lib/keys.js boardArrowKey)
import test from 'node:test';
import assert from 'node:assert/strict';
import { inBand, holdReason, bottomWanted, bottomNext, BAND_PX, BAND_SIDE_PX, SHOW_DELAY_MS, HIDE_DELAY_MS } from '../src/renderer/lib/bottom.js';
import { boardArrowKey } from '../src/renderer/lib/keys.js';

// ---------- 띠 ----------
const BAR = { left: 400, right: 1200, bottom: 900 };
test('P43 띠: 판 아래 끝에서 BAND_PX 안, 명령 바 가로 폭 양옆 BAND_SIDE_PX까지', () => {
  assert.equal(inBand({ x: 800, y: 899 }, BAR), true);
  assert.equal(inBand({ x: 800, y: 900 - BAND_PX }, BAR), true);
  assert.equal(inBand({ x: 800, y: 900 - BAND_PX - 1 }, BAR), false, '띠 위');
  assert.equal(inBand({ x: 800, y: 901 }, BAR), false, '판 밖(아래)');
  assert.equal(inBand({ x: 400 - BAND_SIDE_PX, y: 895 }, BAR), true);
  assert.equal(inBand({ x: 400 - BAND_SIDE_PX - 1, y: 895 }, BAR), false, '왼쪽 레일 쪽');
  assert.equal(inBand({ x: 1200 + BAND_SIDE_PX + 1, y: 895 }, BAR), false, '줌 알약 쪽');
  assert.equal(inBand(null, BAR), false);
  assert.equal(inBand({ x: NaN, y: 895 }, BAR), false);
});

// ---------- 붙잡는 까닭 ----------
test('P43 숨김: 초점, 쓰다 만 글, 위 펼침, 칩 쓰는 중, 시험 고정은 숨지 않게 붙잡는다', () => {
  assert.equal(holdReason({}), null);
  assert.equal(holdReason({ focused: true }), 'focus');
  assert.equal(holdReason({ draft: true }), 'draft');
  assert.equal(holdReason({ popup: true }), 'popup');
  assert.equal(holdReason({ menu: true }), 'menu');
  assert.equal(holdReason({ pinned: true, focused: true }), 'pinned');
  for (const k of ['focused', 'draft', 'popup', 'menu', 'pinned']) assert.equal(bottomWanted({ zone: 'out', [k]: true }), true, k);
});

test('P43 숨김: 마우스가 띠나 보이는 바 위에 있으면 보이고, 밖이면 숨는다', () => {
  assert.equal(bottomWanted({ zone: 'out' }), false);
  assert.equal(bottomWanted({ zone: 'band' }), true);
  assert.equal(bottomWanted({ zone: 'bar' }), true);
  assert.equal(bottomWanted(), false, '처음(마우스 자리 모름)은 숨는다');
});

test('P43 숨김: 나타나고 숨는 때', () => {
  // 띠로 나타날 때는 잠깐 머문 뒤
  assert.deepEqual(bottomNext({ shown: false, zone: 'band' }), { shown: true, delay: SHOW_DELAY_MS });
  // 키보드(아래 키, Ctrl+K)로 초점이 들어오면 바로
  assert.deepEqual(bottomNext({ shown: false, zone: 'out', focused: true }), { shown: true, delay: 0 });
  // 벗어나면 잠시 뒤 숨는다
  assert.deepEqual(bottomNext({ shown: true, zone: 'out' }), { shown: false, delay: HIDE_DELAY_MS });
  // 쓰다 만 글이 있으면 마우스가 나가도 숨지 않는다
  assert.deepEqual(bottomNext({ shown: true, zone: 'out', draft: true }), { shown: true, delay: 0 });
  // Thread나 대상 후보가 열려 있으면 숨지 않는다
  assert.deepEqual(bottomNext({ shown: true, zone: 'out', popup: true }), { shown: true, delay: 0 });
  // 같은 상태면 할 일이 없다
  assert.deepEqual(bottomNext({ shown: false, zone: 'out' }), { shown: false, delay: 0 });
  assert.deepEqual(bottomNext({ shown: true, zone: 'bar' }), { shown: true, delay: 0 });
  assert.ok(SHOW_DELAY_MS < HIDE_DELAY_MS);
});

// ---------- 방향키 ----------
// 화면 요소 흉내: tagName, closest(sel)는 classes·roles에 든 것과 맞으면 자신을 준다
function el(tag, { cls = [], inside = [], editable = false } = {}) {
  const all = [...cls, ...inside];
  return {
    tagName: tag, isContentEditable: editable, nodeType: 1,
    closest(sel) { return sel.split(',').map((s) => s.trim()).some((s) => all.some((c) => c === s)) ? this : null; },
  };
}
const key = (k, target, more = {}) => ({ key: k, target, ...more });
const BODY = { tagName: 'BODY', nodeType: 1, closest: () => null };
const PANE = el('DIV', { cls: ['.react-flow__pane'], inside: ['.mt-stage'] });
const NODE = el('DIV', { cls: ['.react-flow__node'], inside: ['.mt-stage'] });
const XTERM = el('TEXTAREA', { inside: ['.xterm', '.mt-stage'] });
const CMD = el('TEXTAREA', { inside: ['.mt-bottom', '.mt-stage'] });
const MEMO = el('DIV', { editable: true, inside: ['.mt-stage'] });
const RAIL = el('BUTTON', { inside: ['.mt-stage'] });
const SIDEBAR = el('BUTTON', { inside: ['.mt-sb'] });
const MENU = el('BUTTON', { inside: ['.mt-menu', '.mt-stage'] });
const DROP = el('BUTTON', { inside: ['.mt-dropdown', '.mt-stage'] });
const MODAL = el('BUTTON', { inside: ['.mt-modal'] });

test('P43 방향키: 판에 초점이 있으면 아래=명령 바, 위=찾기, 왼쪽=도구 바꾸기, 오른쪽=받기만', () => {
  for (const t of [BODY, PANE, NODE, RAIL, null]) {
    assert.equal(boardArrowKey(key('ArrowDown', t)), 'command');
    assert.equal(boardArrowKey(key('ArrowUp', t)), 'search');
    assert.equal(boardArrowKey(key('ArrowLeft', t)), 'tool');
    assert.equal(boardArrowKey(key('ArrowRight', t)), 'none');
  }
  assert.equal(boardArrowKey(key('a', BODY)), null, '방향키가 아니다');
  assert.equal(boardArrowKey(null), null);
});

test('P43 방향키: 터미널, 입력칸, 메모 편집, 메뉴, 펼침 목록, 대화상자, 사이드바에 초점이 있으면 그쪽 몫이다', () => {
  for (const [name, t] of [['터미널', XTERM], ['명령 바', CMD], ['메모 편집', MEMO], ['노드 메뉴', MENU], ['알약 목록', DROP], ['대화상자', MODAL], ['사이드바', SIDEBAR], ['입력칸', el('INPUT', { inside: ['.mt-stage'] })]]) {
    for (const k of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) assert.equal(boardArrowKey(key(k, t)), null, `${name} ${k}`);
  }
});

test('P43 방향키: 대화상자·미션 맵·출력 보기가 열린 때, 터미널을 기다리는 동안, 조합 키·한글 조합·되풀이는 받지 않는다', () => {
  assert.equal(boardArrowKey(key('ArrowDown', BODY), { dialog: { kind: 'settings' } }), null);
  assert.equal(boardArrowKey(key('ArrowDown', BODY), { missionOpen: true }), null);
  assert.equal(boardArrowKey(key('ArrowDown', BODY), { outputOpen: true }), null);
  assert.equal(boardArrowKey(key('ArrowUp', BODY), { pending: true }), null, '노드에 들어가 터미널이 붙기 전에 친 위 키는 셸 기록으로');
  for (const m of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'isComposing', 'repeat']) assert.equal(boardArrowKey(key('ArrowLeft', BODY, { [m]: true })), null, m);
});
