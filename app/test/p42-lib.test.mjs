// P42 창 단위 시험: 웹 같은 터미널 글 고르기(lib/term-select.js). 마우스 → 칸, 가장자리 자동 스크롤 빠르기,
// 화면이 움직인 줄 수(줄 맞추기), 문서 모으기, 선택 범위와 복사 글, 낱말·줄 고르기, 셸 기록 넣기
import test from 'node:test';
import assert from 'node:assert/strict';
import { cellAt, edgeSpeed, scrollStep, EDGE, findShift, TermDoc, maskOverlay, rowText, orderRange, rangeText, visibleSpan, wordRange, lineRange, stripAnsi, historyAbove, historyPrefill, scrollUpSeq, bigChange, serializeScreen, sgrOf } from '../src/renderer/lib/term-select.js';
import { clearsSelection, copyText, keyAction, sgrWheel } from '../src/renderer/lib/term-input.js';

test('cellAt: 화면 사각형(배율 반영)으로 칸 경계와 줄을 구한다', () => {
  for (const z of [0.5, 0.75, 1, 1.5]) {
    const rect = { left: 100, top: 50, width: 800 * z, height: 340 * z }; // 100칸 × 20줄, 칸 8×17
    const at = (c, r, fx) => cellAt({ clientX: 100 + (c + fx) * 8 * z, clientY: 50 + (r + 0.5) * 17 * z, rect, cols: 100, rows: 20 });
    assert.deepEqual(at(10, 3, 0.3), { col: 10, cell: 10, row: 3 }, `z=${z} 왼쪽 반`);
    assert.deepEqual(at(10, 3, 0.7), { col: 11, cell: 10, row: 3 }, `z=${z} 오른쪽 반`);
    assert.equal(at(0, -2, 0.1).row, -2, '위로 나감');
    assert.equal(at(0, 25, 0.1).row, 25, '아래로 나감');
    assert.deepEqual(at(130, 0, 0.5), { col: 100, cell: 99, row: 0 }, '오른쪽 밖은 끝');
  }
  assert.deepEqual(cellAt({ clientX: 1, clientY: 1, rect: null, cols: 10, rows: 5 }), { col: 0, cell: 0, row: 0 });
});

test('edgeSpeed: 가장자리 한 줄 안에서 시작하고, 넘어갈수록 빨라진다(위는 음수)', () => {
  const g = { top: 100, bottom: 500, rowH: 20 };
  assert.equal(edgeSpeed({ ...g, y: 300 }), 0, '가운데');
  assert.equal(edgeSpeed({ ...g, y: 480 }), 0, '안쪽 한 줄 경계');
  const inZone = edgeSpeed({ ...g, y: 490 });
  assert.ok(inZone > 0 && inZone < EDGE.base, `안쪽 한 줄 안: 천천히 ${inZone}`);
  assert.equal(edgeSpeed({ ...g, y: 500 }), EDGE.base, '가장자리');
  const out1 = edgeSpeed({ ...g, y: 520 }), out3 = edgeSpeed({ ...g, y: 560 });
  assert.ok(out1 > EDGE.base && out3 > out1, `밖으로 갈수록 빠름 ${out1} ${out3}`);
  assert.equal(edgeSpeed({ ...g, y: 5000 }), EDGE.max, '상한');
  assert.ok(edgeSpeed({ ...g, y: 110 }) < 0 && edgeSpeed({ ...g, y: 60 }) < edgeSpeed({ ...g, y: 90 }), '위쪽은 음수, 멀수록 빠름');
  assert.equal(edgeSpeed({ ...g, y: 50, rowH: 0 }), 0);
  // 배율이 작으면 한 줄(rowH)도 작아, 같은 줄 수만큼 넘으면 같은 빠르기
  assert.equal(edgeSpeed({ top: 0, bottom: 200, rowH: 10, y: 220 }), edgeSpeed({ top: 0, bottom: 400, rowH: 20, y: 440 }));
});

test('scrollStep: 줄/초를 시간으로 나눠 정수 줄을 내고 나머지를 모은다', () => {
  let acc = 0, total = 0;
  for (let i = 0; i < 20; i++) { const r = scrollStep(acc, 30, 50); acc = r.acc; total += r.lines; }
  assert.equal(total, 30); // 1초에 30줄
  const up = scrollStep(0, -45, 100);
  assert.equal(up.lines, -4); assert.ok(Math.abs(up.acc + 0.5) < 1e-9);
});

// Claude Code 전체 화면 비슷한 화면: 대화(숫자 줄) 위, 아래 고정 줄(구분선, 입력칸, 상태)
const screen = (from, n, { header = null, rows = 12 } = {}) => {
  const body = [];
  if (header) body.push(header);
  for (let k = from; body.length < rows - 4; k++) body.push(`  ${k}`);
  return [...body.slice(0, rows - 4), '────────', '❯ ', '────────', '  ⏸ manual mode on'];
};

test('findShift: 위로 밀림(새 출력·아래로 스크롤)과 아래로 밀림(위로 스크롤)을 찾고, 고정 줄은 영역에서 뺀다', () => {
  const a = screen(100, 8), b = screen(103, 8);
  assert.deepEqual(findShift(a, b), { d: 3, lo: 0, hi: 7 });
  assert.deepEqual(findShift(b, a), { d: -3, lo: 0, hi: 7 });
  assert.deepEqual(findShift(a, a), { d: 0 });
  // 머리줄이 이미 떠 있으면(위로 스크롤한 Claude Code) 머리줄은 제자리라 영역에서 빠진다
  const h1 = screen(100, 8, { header: '❯ Output the integers' }), h2 = screen(97, 8, { header: '❯ Output the integers' });
  assert.deepEqual(findShift(h1, h2), { d: -3, lo: 1, hi: 7 });
  // 글만 제자리에서 바뀜(스피너, 이어 쓰는 줄)
  const s1 = [...a]; s1[11] = '  ✻ Cogitating… 3s';
  const s2 = [...a]; s2[11] = '  ✻ Cogitating… 4s';
  assert.deepEqual(findShift(s1, s2), { d: 0 });
  // 빈 줄·구분선만 같은 것으로는 움직였다고 보지 않는다
  assert.deepEqual(findShift(['', '───', 'a1', ''], ['───', '', 'b1', '']), { d: 0 });
  // 크기가 다르면 견주지 않는다
  assert.deepEqual(findShift(a, a.slice(1)), { d: 0 });
  // 화면 전체가 움직이는 셸(고정 줄 없음): 새 줄이 맨 아래에 드러난다
  const sh = (k) => Array.from({ length: 6 }, (_, i) => `shell line ${k + i}`);
  assert.deepEqual(findShift(sh(1), sh(3)), { d: 2, lo: 0, hi: 5 });
});

test('TermDoc: 스크롤한 만큼 문서 줄을 이어 붙이고, 고정 줄은 대화 줄 자리에 남기지 않는다', () => {
  const doc = new TermDoc(screen(100, 8));
  assert.equal(rowText(doc.line(0)), '  100');
  // 위로 세 번 스크롤(아래로 밀림). 처음에는 머리줄이 새로 뜬다
  doc.update(screen(97, 8, { header: '❯ Q' }));
  doc.update(screen(94, 8, { header: '❯ Q' }));
  doc.update(screen(91, 8, { header: '❯ Q' }));
  assert.equal(doc.top, -10); assert.equal(doc.lo, 1); // 첫 휠은 머리줄 한 줄까지 4줄
  for (let k = 91; k <= 107; k++) assert.equal(rowText(doc.line(k - 100)), `  ${k}`, `줄 ${k}`);
  // 다시 아래로(위로 밀림): 아래쪽에 드러나는 줄이 문서에 붙고, 앞서 본 줄은 그대로
  doc.update(screen(95, 8, { header: '❯ Q' }));
  doc.update(screen(99, 8, { header: '❯ Q' }));
  doc.update(screen(103, 8, { header: '❯ Q' }));
  for (let k = 92; k <= 109; k++) assert.equal(rowText(doc.line(k - 100)), `  ${k}`, `줄 ${k}`);
  // 크기가 바뀌면 처음부터
  assert.deepEqual(doc.update(screen(1, 8, { rows: 10 })), { d: 0, resized: true });
  assert.equal(doc.top, 0);
});

test('TermDoc: 일하는 중(새 출력이 이어지고 스피너가 바뀜)에도 고른 줄의 글이 그대로 남는다', () => {
  const s = (k, t) => { const x = screen(k, 8); x[11] = `  ✻ Working… ${t}s`; return x; };
  const doc = new TermDoc(s(1, 1));
  const a = { line: 3, col: 2 }, b = { line: 4, col: 3 }; // "  4"의 2칸부터 "  5"의 3칸 앞까지
  assert.equal(rangeText((i) => doc.line(i), a, b, 20), '4\r\n  5');
  for (let k = 2; k <= 6; k++) doc.update(s(k, k));
  assert.equal(doc.top, 5);
  assert.equal(rangeText((i) => doc.line(i), a, b, 20), '4\r\n  5', '화면에서 밀려 나가도 같은 글');
});

test('maskOverlay·TermDoc: 영역 끝 줄에 겹친 안내(Jump to bottom)는 문서에 넣지 않는다', () => {
  const J = 'Jump to bottom (ctrl+End) ↓';
  const row = (n) => [...`  ${n}`.padEnd(30) + J + '   '];
  assert.equal(maskOverlay(row(114), row(117)).join('').trimEnd(), '  117');
  assert.equal(maskOverlay(row(114), row(114)).join('').trimEnd(), `  114${' '.repeat(25)}${J}`, '왼쪽도 같으면 그대로');
  const short = (n) => [...`  ${n}    ok`];
  assert.equal(maskOverlay(short(1), short(2)).join(''), '  2    ok', '짧은 끝 글은 안내로 보지 않는다');
  // 위로 스크롤한 Claude Code 화면: 영역 끝 줄(7)에 안내가 겹친다
  const scr = (k) => { const x = screen(k, 8); x[7] = `${x[7].padEnd(30)}${J}`; return x; };
  const doc = new TermDoc(scr(50));
  doc.update(scr(53)); doc.update(scr(56));
  assert.equal(rowText(doc.line(doc.top + 7)), '  63', '끝 줄은 안내 없이');
  for (let k = 50; k <= 63; k++) assert.equal(rowText(doc.line(k - 50)), `  ${k}`, `줄 ${k}`);
});

test('rangeText·orderRange: 순서와 상관없이, 줄 끝 빈칸을 빼고, 넓은 글자를 칸으로 센다', () => {
  const lines = { 0: [...'alpha bravo     '], 1: [...'charlie         '], 2: ['한', '', '글', '', ' ', 'x', ' '] };
  const at = (i) => lines[i];
  assert.equal(rangeText(at, { line: 0, col: 6 }, { line: 1, col: 4 }, 16), 'bravo\r\nchar');
  assert.equal(rangeText(at, { line: 1, col: 4 }, { line: 0, col: 6 }, 16), 'bravo\r\nchar');
  assert.equal(rangeText(at, { line: 2, col: 1 }, { line: 2, col: 4 }, 7), '한글', '오른쪽 반 칸에서 시작하면 그 글자부터');
  assert.equal(rangeText(at, { line: 0, col: 3 }, { line: 0, col: 3 }, 16), '');
  assert.equal(rangeText(() => null, { line: 5, col: 0 }, { line: 6, col: 2 }, 16), '\r\n', '모르는 줄은 빈 줄');
  assert.deepEqual(orderRange({ line: 2, col: 0 }, { line: 1, col: 9 }), [{ line: 1, col: 9 }, { line: 2, col: 0 }]);
});

test('visibleSpan: 보이는 줄 안의 부분만 xterm select 값으로', () => {
  const o = { first: 10, last: 19, cols: 20, rowBase: 10 }; // 문서 줄 10..19가 화면 0..9
  assert.deepEqual(visibleSpan({ line: 12, col: 3 }, { line: 13, col: 5 }, o), { col: 3, row: 2, length: 22 });
  assert.deepEqual(visibleSpan({ line: 5, col: 3 }, { line: 11, col: 5 }, o), { col: 0, row: 0, length: 25 }, '위로 나간 부분은 잘라 그린다');
  assert.deepEqual(visibleSpan({ line: 18, col: 3 }, { line: 40, col: 5 }, o), { col: 3, row: 8, length: 37 }, '아래로 나간 부분');
  assert.equal(visibleSpan({ line: 1, col: 0 }, { line: 3, col: 5 }, o), null, '모두 화면 밖');
  assert.equal(visibleSpan({ line: 12, col: 3 }, { line: 12, col: 3 }, o), null, '빈 선택');
  // 셸(버퍼 절대 줄): rowBase 0
  assert.deepEqual(visibleSpan({ line: 200, col: 0 }, { line: 201, col: 4 }, { first: 0, last: 999, cols: 20 }), { col: 0, row: 200, length: 24 });
});

test('wordRange·lineRange: 두 번 누르면 낱말, 세 번 누르면 줄', () => {
  const c = [...'ROW3 india juliet(kilo) lima   '];
  assert.deepEqual(wordRange(c, 13), [11, 17]); // juliet
  assert.deepEqual(wordRange(c, 17), [17, 18]); // (
  assert.deepEqual(wordRange(c, 19), [18, 22]); // kilo
  assert.deepEqual(wordRange(c, 29), [28, 31]); // 끝 빈칸
  assert.deepEqual(lineRange(c), [0, 28]);
  assert.deepEqual(wordRange(['한', '', '글', '', ' ', 'a'], 1), [0, 4], '넓은 글자');
  assert.deepEqual(wordRange([], 3), [3, 3]);
});

test('historyAbove·historyPrefill: 셸 기록에서 화면 위의 줄만 scrollback으로 넣는다', () => {
  const hist = Array.from({ length: 300 }, (_, i) => `shell line ${i + 1}`).concat(['PS C:\\x> ']);
  const scr = hist.slice(-12).concat(['', '', '']); // 화면 15줄: 끝 12줄 + 빈 줄
  assert.equal(historyAbove(hist, scr), 289);
  assert.equal(historyAbove(['PS C:\\x>'], ['PS C:\\x>', '', '']), 0, 'cls 뒤: 위에 없음');
  assert.equal(historyAbove(hist, ['다른 글', '', '']), -1, '맞지 않으면 넣지 않는다');
  assert.equal(historyAbove(hist, ['', '']), -1, '빈 화면');
  // 같은 글이 여러 번 있으면 가장 아래(마지막) 자리
  assert.equal(historyAbove(['a', 'b', 'a', 'b', 'c'], ['a', 'b', 'c']), 2);
  const p = historyPrefill(['x1', 'x2'], 5);
  assert.equal((p.match(/\n/g) || []).length, 2 - 1 + 5, '줄바꿈 n + rows - 1번');
  assert.equal(historyPrefill([], 5), '');
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m \x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\'), 'red link');
});

test('bigChange: 움직인 줄로 설명되지 않게 많이 바뀌면 판 안 기록을 다시 맞춘다', () => {
  const a = ['PS> cls; 1..150', '', '', ''], b = ['shell line 147', 'shell line 148', 'shell line 149', 'PS>'];
  assert.equal(bigChange(a, b), true);
  assert.equal(bigChange(['PS> ', '', ''], ['PS> d', '', '']), false, '글 하나 침');
  assert.equal(bigChange(a, a.slice(1)), false);
});

test('serializeScreen·sgrOf: 화면 칸을 색과 함께 다시 쓸 수 있는 글로(넓은 글자 오른쪽 반 칸은 건너뜀)', () => {
  const cell = (ch, o = {}) => ({ getChars: () => ch, getWidth: () => (o.w ?? 1), isBold: () => !!o.bold, isDim: () => false, isItalic: () => false, isUnderline: () => false, isBlink: () => false, isInverse: () => !!o.inv, isInvisible: () => false, isStrikethrough: () => false,
    isFgRGB: () => !!o.rgb, isFgPalette: () => o.fg !== undefined, getFgColor: () => (o.rgb ?? o.fg ?? 0), isBgRGB: () => false, isBgPalette: () => o.bg !== undefined, getBgColor: () => o.bg ?? 0 });
  const rows = [[cell('a', { fg: 1 }), cell('b', { fg: 1 }), cell('c')], [cell('한'), cell('', { w: 0 }), cell('x', { bold: true, bg: 12, rgb: 0x102030 })]];
  const buffer = { getLine: (y) => (rows[y - 5] ? { getCell: (x) => rows[y - 5][x] } : undefined) };
  const s = serializeScreen(buffer, { base: 5, rows: 2, cols: 3, cursorX: 2, cursorY: 1 });
  assert.equal(s, '\x1b[1;1H\x1b[0;31mab\x1b[0mc\x1b[2;1H\x1b[0m한\x1b[0;1;38;2;16;32;48;104mx\x1b[0m\x1b[2;3H');
  assert.equal(sgrOf(cell('z', { fg: 200, inv: true })), '\x1b[0;7;38;5;200m');
});

test('scrollUpSeq: 영역을 올려 밀려난 줄을 scrollback으로(커서는 되돌림)', () => {
  assert.equal(scrollUpSeq(2, 29, 30), '\x1b7\x1b[1;30r\x1b[30;1H\n\n\x1b[r\x1b8');
  assert.equal(scrollUpSeq(1, 33, 40), '\x1b7\x1b[1;34r\x1b[34;1H\n\x1b[r\x1b8', '아래 고정 줄은 남긴다');
  assert.equal(scrollUpSeq(0, 10, 30), '');
  assert.equal(scrollUpSeq(-2, 10, 30), '');
});

test('clearsSelection(P42): 휠·프레임으로는 지우지 않고, 복사·붙여넣기·입력·Esc·밖 누르기·크기 바뀜에서 지운다', () => {
  for (const e of ['copy', 'paste', 'input', 'escape', 'outside', 'resize']) assert.equal(clearsSelection(e), true, e);
  for (const e of ['wheel', 'frame', 'scroll']) assert.equal(clearsSelection(e), false, e);
  assert.equal(clearsSelection('copy', { hasSelection: false }), false);
  assert.equal(copyText('a  \r\nb '), 'a\r\nb');
});

test('keyAction(P42): 고른 글이 있을 때 Esc는 선택만 끝내고 앱에 보내지 않는다', () => {
  const k = (key, o = {}) => ({ type: 'keydown', key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });
  assert.equal(keyAction(k('Escape'), true), 'clear-selection');
  assert.equal(keyAction(k('Escape'), false), 'pass'); // Claude Code 끊기 그대로
  assert.equal(keyAction(k('c', { ctrlKey: true }), true), 'copy');
  assert.equal(keyAction(k('c', { ctrlKey: true }), false), 'pass');
});

test('sgrWheel: 자동 스크롤의 휠 steps번(아래 65, 위 64), 칸은 화면 안으로', () => {
  assert.equal(sgrWheel(2, 10, 5, 80, 24), '\x1b[<65;10;5M\x1b[<65;10;5M');
  assert.equal(sgrWheel(-1, 0, 99, 80, 24), '\x1b[<64;1;24M');
  assert.equal(sgrWheel(0, 1, 1, 80, 24), '');
});
