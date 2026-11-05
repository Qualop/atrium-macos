// P38 창 단위 시험: 터미널 끌어 고르기와 선택(lib/term-input.js). 판 배율 아래의 마우스 → 칸 계산(unscalePoint),
// 선택을 지우는 때(clearsSelection, P42에서 휠·프레임은 지우지 않게 바뀜), 복사할 글(copyText), 터미널 안 누르기의 화면 옮기기(termClickNavigates)
import test from 'node:test';
import assert from 'node:assert/strict';
import { unscalePoint, clearsSelection, copyText, termClickNavigates, TERM_CLICK_WAIT, keyAction } from '../src/renderer/lib/term-input.js';

// xterm 6.0.0 browser/input/Mouse.ts getCoords와 같은 계산(확대·축소 전 칸 크기, isSelection이면 칸 절반 앞당김). 1부터
function xtermCell({ clientX, clientY }, rect, { cellW, cellH, cols, rows, pad = 0, selection = true }) {
  const x = clientX - rect.left - pad, y = clientY - rect.top - pad;
  const col = Math.ceil((x + (selection ? cellW / 2 : 0)) / cellW);
  const row = Math.ceil(y / cellH);
  return [Math.min(Math.max(col, 1), cols + (selection ? 1 : 0)), Math.min(Math.max(row, 1), rows)];
}

const G = { cellW: 8, cellH: 17, cols: 100, rows: 30 };
// 판 배율 z에서 화면에 그려진 터미널 사각형(왼쪽 위 300, 200)
const rectAt = (z) => ({ left: 300, top: 200, width: G.cols * G.cellW * z, height: G.rows * G.cellH * z });
// 칸(c, r: 0부터) 안의 화면 점. fx는 칸 안 가로 비율
const screenPt = (z, c, r, fx) => ({ clientX: 300 + (c + fx) * G.cellW * z, clientY: 200 + (r + 0.5) * G.cellH * z });

test('unscalePoint: 어느 배율에서든 마우스 밑 칸을 고른다', () => {
  for (const z of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]) {
    const rect = rectAt(z);
    for (const [c, r] of [[0, 0], [5, 3], [42, 17], [99, 29]]) {
      // 칸 왼쪽 절반은 그 칸 앞 경계, 오른쪽 절반은 다음 경계(xterm 선택 규칙)
      const left = unscalePoint({ ...screenPt(z, c, r, 0.3), rect, width: G.cols * G.cellW, height: G.rows * G.cellH });
      assert.deepEqual(xtermCell(left, rect, G), [c + 1, r + 1], `z=${z} c=${c} r=${r} 왼쪽`);
      const right = unscalePoint({ ...screenPt(z, c, r, 0.7), rect, width: G.cols * G.cellW, height: G.rows * G.cellH });
      assert.deepEqual(xtermCell(right, rect, G), [c + 2, r + 1], `z=${z} c=${c} r=${r} 오른쪽`);
    }
  }
});

test('unscalePoint 없이는 배율이 1이 아닐 때 칸이 어긋난다(고친 까닭)', () => {
  const z = 0.5, rect = rectAt(z);
  const raw = screenPt(z, 40, 10, 0.3);
  assert.notDeepEqual(xtermCell(raw, rect, G), [41, 11]);
  assert.deepEqual(xtermCell(raw, rect, G), [21, 6]); // 배율 0.5: 화면 거리의 절반 칸만 간다(선택이 뒤처진다)
  const z2 = 1.5, rect2 = rectAt(z2);
  assert.deepEqual(xtermCell(screenPt(z2, 40, 10, 0.3), rect2, G), [61, 16]); // 배율 1.5: 앞선다
});

test('unscalePoint: 배율 1이거나 크기를 모르면 그대로', () => {
  const rect = rectAt(1);
  assert.deepEqual(unscalePoint({ clientX: 333, clientY: 222, rect, width: rect.width, height: rect.height }), { clientX: 333, clientY: 222 });
  assert.deepEqual(unscalePoint({ clientX: 333, clientY: 222, rect: null }), { clientX: 333, clientY: 222 });
  assert.deepEqual(unscalePoint({ clientX: 333, clientY: 222, rect, width: 0, height: 0 }), { clientX: 333, clientY: 222 });
  // 요소 왼쪽 위 점은 배율과 상관없이 그 자리
  const r2 = rectAt(0.5);
  assert.deepEqual(unscalePoint({ clientX: 300, clientY: 200, rect: r2, width: 800, height: 510 }), { clientX: 300, clientY: 200 });
  // 요소 밖(끌어 나감)도 같은 비율로 되돌린다
  const out = unscalePoint({ clientX: 300 + 500, clientY: 200 - 50, rect: r2, width: 800, height: 510 });
  assert.deepEqual(out, { clientX: 1300, clientY: 100 });
});

test('clearsSelection: 복사·붙여넣기는 지우고, 휠과 프레임으로는 지우지 않는다(P42에서 바뀜: 선택이 글에 붙어 함께 움직인다)', () => {
  for (const e of ['copy', 'paste']) {
    assert.equal(clearsSelection(e), true, e);
    assert.equal(clearsSelection(e, { hasSelection: false }), false, `${e} 선택 없음`);
  }
  assert.equal(clearsSelection('wheel'), false);
  assert.equal(clearsSelection('frame', { before: 'abc', after: 'xyz' }), false);
  assert.equal(clearsSelection('focus'), false);
});

test('copyText: 줄마다 끝 빈칸을 뺀다(줄바꿈은 그대로)', () => {
  assert.equal(copyText('bravo charlie delta      \r\nROW2 echo fox'), 'bravo charlie delta\r\nROW2 echo fox');
  assert.equal(copyText('a  \nb\t\n  c  '), 'a\nb\n  c');
  assert.equal(copyText('alpha bravo'), 'alpha bravo');
  assert.equal(copyText(''), '');
  assert.equal(copyText(undefined), '');
});

test('termClickNavigates: 한 번 누르기만, 선택이 있으면 가지 않는다', () => {
  assert.equal(termClickNavigates({ detail: 1, hasSelection: false }), true);
  assert.equal(termClickNavigates({ detail: 1, hasSelection: true }), false);
  assert.equal(termClickNavigates({ detail: 2 }), false);
  assert.equal(termClickNavigates({ detail: 3 }), false);
  assert.equal(termClickNavigates({ detail: 0 }), true); // 키보드로 낸 click
  assert.ok(TERM_CLICK_WAIT >= 300 && TERM_CLICK_WAIT <= 500);
});

test('지금의 키 규칙은 그대로(복사·붙여넣기·Ctrl+G)', () => {
  const k = (key, o = {}) => ({ type: 'keydown', key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });
  assert.equal(keyAction(k('c', { ctrlKey: true }), false), 'pass'); // 선택 없으면 ^C
  assert.equal(keyAction(k('c', { ctrlKey: true }), true), 'copy');
  assert.equal(keyAction(k('C', { ctrlKey: true, shiftKey: true }), false), 'copy');
  assert.equal(keyAction(k('v', { ctrlKey: true }), true), 'paste');
  assert.equal(keyAction(k('Insert', { shiftKey: true }), false), 'paste');
  assert.equal(keyAction(k('g', { ctrlKey: true }), false), 'block-ctrl-g');
});
