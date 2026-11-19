// P151: 손가락(휴대폰 웹)으로 터미널 글 고르기의 순수 함수(단위 시험 app/test/p151-lib.test.mjs). 부르는 곳은 term-touch.js.
// - 길게 누르기: 한 손가락으로 HOLD_MS 동안 HOLD_SLOP_PX 안에 머물면 그 자리의 낱말(빈칸이면 줄)을 고르고 고르기 모드로 들어간다.
//   그 전에 HOLD_SLOP_PX 넘게 움직이면 스크롤(지금까지와 같다), 그 전에 떼면 탭(지금까지와 같다).
// - 넓히기: 손가락을 떼지 않고 끌면 처음 고른 낱말을 늘 품은 채 끝이 따라온다(pinAnchor). 양 끝 손잡이를 끌어도 넓힌다.
// - 복사: 떠 있는 막대에서 한다(손을 뗄 때 바로 복사하지 않는다. 손가락은 범위를 여러 번 고쳐 잡기 때문).
import { orderRange, wordRange, lineRange } from './term-select.js';

export const HOLD_MS = 500; // 판의 길게 누름(P76 LONG_PRESS_MS)과 같은 길이
export const HOLD_SLOP_PX = 8; // 휴대폰 스크롤이 시작되는 거리(Phone.jsx, P76 TOUCH_SLOP_PX)와 같다

// 누르고 있는 손가락의 판단. dt: 누른 뒤 지난 ms, dx·dy: 누른 자리에서 움직인 px, fingers: 닿은 손가락 수
// → 'wait'(아직) | 'hold'(길게 누름: 고르기 시작) | 'cancel'(스크롤·확대 등 다른 손짓)
export function pressVerdict({ dt, dx = 0, dy = 0, fingers = 1 }) {
  if (fingers !== 1) return 'cancel';
  if (Math.hypot(dx, dy) > HOLD_SLOP_PX) return 'cancel';
  return dt >= HOLD_MS ? 'hold' : 'wait';
}

// 길게 누른 칸의 처음 범위: 글자 위면 낱말, 빈칸이면 그 줄(끝 빈칸 뺌), 빈 줄이면 null
// cells: 그 줄의 칸 배열, cell: 누른 칸 → [c0, c1] | null
export function holdRange(cells, cell) {
  const row = cells || [];
  const ch = row[cell] === '' && cell > 0 ? row[cell - 1] : row[cell];
  if (ch !== undefined && ch !== ' ' && ch !== '') return wordRange(row, cell);
  const [s, e] = lineRange(row);
  return e > s ? [s, e] : null;
}

const before = (a, b) => a.line < b.line || (a.line === b.line && a.col < b.col);
// 처음 고른 낱말 word { start, end }를 품은 채 끝을 pos로 옮긴다 → { anchor, focus }
// pos가 낱말보다 앞이면 낱말 끝을, 아니면 낱말 처음을 붙박는다(반대로 끌어도 처음 낱말이 빠지지 않는다)
export function pinAnchor(word, pos) {
  if (before(pos, word.start)) return { anchor: word.end, focus: pos };
  if (before(pos, word.end)) return { anchor: word.start, focus: word.end };
  return { anchor: word.start, focus: pos };
}

// 손잡이를 잡았다: 잡은 쪽(which 'start' | 'end')이 움직이는 끝(focus), 다른 쪽이 붙박이(anchor)
export function grabHandle(a, b, which) {
  const [s, e] = orderRange(a, b);
  return which === 'start' ? { anchor: e, focus: s } : { anchor: s, focus: e };
}

// 모두 고르기: 줄 first..last 가운데 글이 있는 첫 줄 처음부터 마지막 줄 끝까지. 글이 없으면 null
export function allRange(lineAt, first, last, cols) {
  const hasText = (i) => { const c = lineAt(i); return !!c && lineRange(c)[1] > 0; };
  let s = first, e = last;
  while (s <= e && !hasText(s)) s++;
  while (e >= s && !hasText(e)) e--;
  if (s > e) return null;
  return { anchor: { line: s, col: 0 }, focus: { line: e, col: cols } };
}

// 양 끝 손잡이의 화면 자리(px, 창 기준). base: 화면 0번 줄의 문서 줄, rect: 글자 화면(.xterm-screen)의 사각형
// 화면 밖에 있는 끝은 null. 처음 손잡이는 첫 글자의 왼쪽 위, 끝 손잡이는 마지막 글자의 오른쪽 아래
export function handleSpots(a, b, { base, rows, cols, rect }) {
  if (!a || !b) return { start: null, end: null };
  const [s, e] = orderRange(a, b);
  const cw = rect.width / cols, ch = rect.height / rows;
  const spot = (p, down) => {
    const row = p.line - base;
    if (row < 0 || row >= rows) return null;
    return { x: rect.left + p.col * cw, y: rect.top + (row + (down ? 1 : 0)) * ch, row };
  };
  return { start: spot(s, false), end: spot(e, true), lineH: ch };
}

// 떠 있는 막대의 자리: 고른 글 위쪽(처음 손잡이 위), 자리가 없으면 아래쪽(끝 손잡이 아래), 둘 다 화면 밖이면 글 화면 위쪽 가운데.
// 가로는 창 안으로 민다. → { x(가운데), y(위), below }
// gap: 처음 손잡이의 둥근 점(글 위 14px)과 그 잡는 자리를 막대가 덮지 않게 띄운다
export function barSpot(spots, { barW, barH, viewW, viewH, rect, gap = 30, margin = 8 }) {
  const { start, end } = spots;
  let y, below = false, x;
  if (start && start.y - gap - barH >= margin) { y = start.y - gap - barH; x = start.x; }
  else if (end && end.y + gap + barH <= viewH - margin) { y = end.y + gap; below = true; x = end.x; } // 끝 손잡이 점 아래
  else { y = Math.max(margin, rect.top + margin); x = rect.left + rect.width / 2; }
  const half = barW / 2;
  x = Math.max(margin + half, Math.min(viewW - margin - half, x));
  return { x, y: Math.max(margin, Math.min(viewH - margin - barH, y)), below };
}
