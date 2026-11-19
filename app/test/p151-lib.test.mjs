// P151: 휴대폰 웹의 길게 눌러 터미널 글 고르기(lib/touch-select.js)와 복사 글
import test from 'node:test';
import assert from 'node:assert/strict';
import { pressVerdict, holdRange, pinAnchor, grabHandle, allRange, handleSpots, barSpot, HOLD_MS, HOLD_SLOP_PX } from '../src/renderer/lib/touch-select.js';
import { rangeText } from '../src/renderer/lib/term-select.js';
import { copyText } from '../src/renderer/lib/term-input.js';
import { setLanguage, t } from '../src/renderer/lib/i18n.js';

const cells = (s, n = s.length) => { const a = [...s]; while (a.length < n) a.push(' '); return a; };

test('P151 길게 누르기 판단: 시간·움직임 문턱·손가락 수', () => {
  assert.equal(HOLD_MS >= 450 && HOLD_MS <= 550, true);
  assert.equal(pressVerdict({ dt: 100 }), 'wait');
  assert.equal(pressVerdict({ dt: HOLD_MS - 1, dx: 3, dy: 3 }), 'wait');
  assert.equal(pressVerdict({ dt: HOLD_MS }), 'hold');
  assert.equal(pressVerdict({ dt: HOLD_MS + 50, dx: HOLD_SLOP_PX, dy: 0 }), 'hold'); // 문턱 안의 떨림
  assert.equal(pressVerdict({ dt: 200, dx: 0, dy: HOLD_SLOP_PX + 1 }), 'cancel'); // 스크롤
  assert.equal(pressVerdict({ dt: 600, dx: 7, dy: 7 }), 'cancel'); // 대각선 거리 9.9
  assert.equal(pressVerdict({ dt: 600, fingers: 2 }), 'cancel'); // 두 손가락
});

test('P151 처음 고르기: 글자 위면 낱말, 빈칸이면 그 줄, 빈 줄이면 없음', () => {
  const row = cells('$ git status --short   ', 30);
  assert.deepEqual(holdRange(row, 3), [2, 5]); // git
  assert.deepEqual(holdRange(row, 14), [13, 20]); // --short
  assert.deepEqual(holdRange(row, 25), [0, 20]); // 빈칸: 줄(끝 빈칸 뺌)
  assert.equal(holdRange(cells('', 10), 3), null);
  assert.equal(holdRange(null, 0), null);
  // 넓은 글자의 오른쪽 반 칸('')
  const wide = ['한', '', '글', '', ' ', 'a', 'b', ' '];
  assert.deepEqual(holdRange(wide, 1), [0, 4]);
});

test('P151 넓히기: 처음 낱말을 품은 채 앞·뒤로', () => {
  const word = { start: { line: 5, col: 2 }, end: { line: 5, col: 5 } };
  assert.deepEqual(pinAnchor(word, { line: 7, col: 10 }), { anchor: word.start, focus: { line: 7, col: 10 } });
  assert.deepEqual(pinAnchor(word, { line: 3, col: 1 }), { anchor: word.end, focus: { line: 3, col: 1 } });
  assert.deepEqual(pinAnchor(word, { line: 5, col: 3 }), { anchor: word.start, focus: word.end }); // 낱말 안이면 낱말 그대로
  // 손잡이: 잡은 쪽이 움직이는 끝
  const a = { line: 9, col: 4 }, b = { line: 2, col: 1 };
  assert.deepEqual(grabHandle(a, b, 'start'), { anchor: a, focus: b });
  assert.deepEqual(grabHandle(a, b, 'end'), { anchor: b, focus: a });
});

test('P151 모두 선택: 위아래 빈 줄을 빼고 글이 있는 줄 처음부터 끝까지', () => {
  const lines = ['', '   ', 'one', '', 'two  ', '', ''].map((s) => cells(s, 8));
  const r = allRange((i) => lines[i], 0, lines.length - 1, 8);
  assert.deepEqual(r, { anchor: { line: 2, col: 0 }, focus: { line: 4, col: 8 } });
  assert.equal(rangeText((i) => lines[i], r.anchor, r.focus, 8), 'one\r\n\r\ntwo');
  assert.equal(allRange((i) => lines[i], 5, 6, 8), null);
});

test('P151 복사 글: 줄바꿈은 \\r\\n, 줄 끝 빈칸은 뺀다', () => {
  const lines = [cells('alpha beta   ', 16), cells('  gamma  ', 16)];
  const raw = rangeText((i) => lines[i], { line: 0, col: 6 }, { line: 1, col: 16 }, 16);
  assert.equal(raw, 'beta\r\n  gamma');
  assert.equal(copyText('a  \r\nb \t\nc  '), 'a\r\nb\nc');
});

test('P151 손잡이·막대 자리', () => {
  const rect = { left: 10, top: 100, width: 400, height: 200 }; // 40칸 × 20줄 → 칸 10×10
  const s = handleSpots({ line: 52, col: 3 }, { line: 50, col: 5 }, { base: 50, rows: 20, cols: 40, rect });
  assert.deepEqual(s.start, { x: 60, y: 100, row: 0 }); // 처음: (50,5) 왼쪽 위
  assert.deepEqual(s.end, { x: 40, y: 130, row: 2 }); // 끝: (52,3) 아래
  assert.equal(s.lineH, 10);
  const off = handleSpots({ line: 10, col: 0 }, { line: 80, col: 1 }, { base: 50, rows: 20, cols: 40, rect });
  assert.equal(off.start, null); assert.equal(off.end, null); // 둘 다 화면 밖
  const view = { barW: 200, barH: 40, viewW: 390, viewH: 800, rect };
  const up = barSpot({ start: { x: 60, y: 300 }, end: null }, view);
  assert.equal(up.below, false); assert.equal(up.y, 230); assert.equal(up.x, 108); // 왼쪽 끝 안으로 민다
  const down = barSpot({ start: { x: 200, y: 20 }, end: { x: 380, y: 60 } }, view);
  assert.equal(down.below, true); assert.equal(down.x, 282);
  const mid = barSpot({ start: null, end: null }, view);
  assert.equal(mid.y, 108); assert.equal(mid.x, 210);
});

test('P151 막대 글: 영어·한국어', () => {
  for (const lang of ['en', 'ko']) {
    setLanguage(lang);
    for (const k of ['bar', 'copy', 'selectAll', 'close', 'copyFail']) assert.notEqual(t(`termSelect.${k}`), `termSelect.${k}`, `${lang} ${k}`);
  }
  setLanguage('ko'); assert.equal(t('termSelect.copy'), '복사');
  setLanguage('en');
});
