// P42: 터미널 노드의 웹 같은 글 고르기(ARCH 7.2, E12). 순수 함수만 둔다(단위 시험 p42-lib).
// 터미널 노드의 화면은 herdr가 다시 그린 프레임이라 xterm의 scrollback이 비어 있고, Claude Code 전체 화면 렌더러는
// 휠(SGR)로 스스로 대화를 스크롤한다. 그래서 선택을 화면 칸이 아니라 "문서" 줄에 붙인다.
// - claude 같은 앱(live): 프레임마다 앞 화면과 새 화면을 견줘 글이 몇 줄 움직였는지(findShift) 찾고, 본 줄을 문서(TermDoc)에 모은다.
// - 셸(buffer): herdr 기록(pane.read recent)을 xterm scrollback에 넣고, 새 출력으로 밀려난 줄도 scrollback으로 보낸다(TerminalView).
//   문서 줄 = xterm 버퍼의 절대 줄이다.
// 선택은 문서 줄과 칸 경계({ line, col })로 들고, 보이는 부분만 xterm select()로 그린다.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 마우스 점 → 칸. rect는 화면에 그려진(판 배율이 반영된) .xterm-screen 사각형이라 배율과 상관없이 맞는다.
//   col: 칸 경계(0..cols). 칸 오른쪽 절반을 누르면 다음 경계(xterm과 같은 규칙)
//   cell: 누른 칸(0..cols-1), row: 줄(화면 밖이면 0보다 작거나 rows 이상)
export function cellAt({ clientX, clientY, rect, cols, rows }) {
  if (!rect || !rect.width || !rect.height || !cols || !rows) return { col: 0, cell: 0, row: 0 };
  const cw = rect.width / cols, ch = rect.height / rows;
  const x = (clientX - rect.left) / cw, y = (clientY - rect.top) / ch;
  return { col: clamp(Math.round(x), 0, cols), cell: clamp(Math.floor(x), 0, cols - 1), row: Math.floor(y) };
}

// 끄는 중 가장자리 자동 스크롤 빠르기(줄/초, 위는 음수). 노드 안쪽 가장자리 한 줄(zone) 안에 들어가면 천천히 시작하고,
// 가장자리를 넘어가면 거리만큼 빨라진다(웹 페이지처럼). y·top·bottom은 화면 px, rowH는 화면에 그려진 한 줄 높이
export const EDGE = { zoneRows: 1, base: 6, perRow: 18, max: 90 };
export function edgeSpeed({ y, top, bottom, rowH, opt = EDGE }) {
  if (!(rowH > 0) || !(bottom > top)) return 0;
  const zone = opt.zoneRows * rowH;
  let dist = 0, sign = 0;
  if (y < top + zone) { dist = (top + zone - y) / rowH; sign = -1; }
  else if (y > bottom - zone) { dist = (y - (bottom - zone)) / rowH; sign = 1; }
  if (!sign || dist <= 0) return 0;
  const v = opt.base * Math.min(dist, 1) + opt.perRow * Math.max(0, dist - 1); // 안쪽 한 줄: 0→base, 밖: 줄마다 perRow
  return sign * Math.min(opt.max, v);
}

// 줄/초 빠르기와 지난 시간으로 이번에 굴릴 줄 수. 남은 소수는 acc에 모은다
export function scrollStep(acc, speed, dtMs) {
  const total = acc + (speed * dtMs) / 1000;
  const lines = Math.trunc(total);
  return { lines, acc: total - lines };
}

// ---------- 화면이 움직인 줄 수 ----------
const keyOf = (s) => String(s ?? '').replace(/\s+$/, '');
// 빈 줄과 테두리·구분선만 있는 줄은 어디와도 같아 보여 맞추기에 쓰지 않는다
const distinct = (s) => /[^\s─━│┃═║╌╍┄┅┈┉╭╮╰╯┌┐└┘├┤┬┴┼—\-_=·.•…]/.test(s);

// 앞 화면(prev)과 새 화면(next)의 줄 글(배열)을 견줘, 글이 위로 d줄 움직였는지 찾는다(next[i] = prev[i + d]).
// d > 0: 위로 밀림(새 출력, 아래로 스크롤), d < 0: 아래로 밀림(위로 스크롤). 머리줄·입력칸처럼 제자리인 줄은 견주지 않는다.
// 돌려준 lo..hi는 이번에 함께 움직인 영역(새로 드러난 줄 포함)이다. 움직임이 없거나 확실하지 않으면 { d: 0 }
export function findShift(prev, next, { minMatch = 2 } = {}) {
  if (!prev || !next || prev.length !== next.length) return { d: 0 };
  const n = next.length;
  const P = prev.map(keyOf), N = next.map(keyOf);
  const changed = [];
  for (let i = 0; i < n; i++) if (N[i] !== P[i] && distinct(N[i])) changed.push(i);
  if (!changed.length) return { d: 0 };
  const where = new Map();
  P.forEach((t, j) => { if (distinct(t)) { const a = where.get(t); if (a) a.push(j); else where.set(t, [j]); } });
  const count = new Map();
  let seen = 0; // 앞 화면 어딘가에 있던 줄(새로 드러난 줄은 세지 않는다)
  for (const i of changed) { const js = where.get(N[i]); if (!js) continue; seen++; for (const j of js) { const d = j - i; if (d) count.set(d, (count.get(d) || 0) + 1); } }
  let best = 0, bc = 0;
  for (const [d, c] of count) if (c > bc || (c === bc && Math.abs(d) < Math.abs(best))) { best = d; bc = c; }
  if (!best || bc < minMatch || bc < seen * 0.5) return { d: 0 };
  let lo = n, hi = -1;
  for (let i = 0; i < n; i++) { const j = i + best; if (j >= 0 && j < n && N[i] === P[j] && distinct(N[i])) { if (i < lo) lo = i; if (i > hi) hi = i; } }
  const fixed = (r) => P[r] === N[r] && distinct(N[r]); // 제자리 줄(머리줄, 입력칸, 상태 줄)
  // 새로 드러난 줄(움직인 줄 수만큼)과, 그 바로 옆에서 글이 바뀐 줄 EXTRA개(겹쳐 그린 안내가 있는 영역 끝 줄)까지 영역으로 본다
  const EXTRA = 2;
  if (best > 0) {
    for (let k = 1; k <= best && hi + 1 < n && !fixed(hi + 1); k++) hi++;
    for (let k = 0; k < EXTRA && hi + 1 < n && N[hi + 1] !== P[hi + 1]; k++) hi++;
  } else {
    for (let k = 1; k <= -best && lo - 1 >= 0 && !fixed(lo - 1); k++) lo--;
    for (let k = 0; k < EXTRA && lo - 1 >= 0 && N[lo - 1] !== P[lo - 1]; k++) lo--;
  }
  return { d: best, lo, hi };
}

// 화면 줄들을 이어 붙인 문서. 줄은 칸 배열(넓은 글자의 오른쪽 반 칸은 '')이다.
// top: 화면 0번 줄의 문서 줄 번호, lo..hi: 스크롤되는 영역(머리줄·입력칸을 뺀 줄). 처음에는 화면 전체다.
export class TermDoc {
  constructor(rows) { this.lines = new Map(); this.top = 0; this.prev = null; this.lo = 0; this.hi = -1; if (rows) this.reset(rows); }
  reset(rows) {
    this.lines.clear(); this.top = 0; this.lo = 0; this.hi = rows.length - 1;
    this.prev = rows.map(rowText);
    this.prevCells = rows.map(rowCells);
    rows.forEach((r, i) => this.lines.set(i, rowCells(r)));
  }
  // 새 화면. 크기가 바뀌었으면 { resized: true }(줄이 다시 감겨 문서를 이어 갈 수 없다)
  update(rows) {
    const texts = rows.map(rowText);
    if (!this.prev || this.prev.length !== texts.length) { this.reset(rows); return { d: 0, resized: true }; }
    const s = findShift(this.prev, texts);
    if (s.d) { this.top += s.d; this.lo = s.lo; this.hi = s.hi; }
    for (let i = this.lo; i <= this.hi; i++) {
      let cells = rowCells(rows[i]);
      // 영역 아래 끝 줄에 겹쳐 그린 안내(Claude Code의 "Jump to bottom (ctrl+End) ↓")는 글이 움직여도 같은 칸에 남는다. 문서에 넣지 않는다
      if (s.d && i >= this.hi - 1 && this.prevCells) cells = maskOverlay(this.prevCells[i], cells);
      this.lines.set(this.top + i, cells);
    }
    this.prev = texts;
    this.prevCells = rows.map(rowCells);
    return s;
  }
  line(i) { return this.lines.get(i) || null; }
}
// 글이 움직였는데 같은 줄의 오른쪽 끝 글(minRun칸 이상, 앞에 gap칸 이상 빈칸)이 앞 화면과 같은 칸에 그대로 있으면 겹쳐 그린 안내로 보고 지운다
export function maskOverlay(prev, next, { minRun = 10, gap = 3 } = {}) {
  if (!prev || !next || prev.length !== next.length) return next;
  let e = next.length - 1;
  while (e >= 0 && (next[e] === ' ' || next[e] === '')) e--;
  if (e < 0) return next;
  let s = e;
  while (s > 0 && next[s - 1] === prev[s - 1]) s--;
  while (s <= e && (next[s] === ' ' || next[s] === '')) s++; // 같은 빈칸은 안내에 넣지 않는다
  if (e - s + 1 < minRun || s < gap) return next;
  for (let k = 1; k <= gap; k++) if (next[s - k] !== ' ') return next;
  let differs = false;
  for (let x = 0; x < s - gap && !differs; x++) differs = next[x] !== prev[x];
  if (!differs) return next;
  const out = next.slice();
  for (let x = s; x <= e; x++) out[x] = ' ';
  return out;
}

// 줄은 문자열(한 글자 = 한 칸)이거나 칸 배열
export const rowCells = (r) => (Array.isArray(r) ? r.slice() : [...String(r ?? '')]);
export const rowText = (r) => (Array.isArray(r) ? r.join('') : String(r ?? '')).replace(/\s+$/, '');

// ---------- 선택 범위 ----------
const before = (a, b) => a.line < b.line || (a.line === b.line && a.col < b.col);
export function orderRange(a, b) { return before(b, a) ? [b, a] : [a, b]; }
export const emptyRange = (a, b) => !a || !b || (a.line === b.line && a.col === b.col);

// 고른 글. 줄마다 끝 빈칸을 빼고 \r\n으로 잇는다(지금의 복사 규칙). lineAt(i) → 칸 배열 또는 null
export function rangeText(lineAt, a, b, cols) {
  if (emptyRange(a, b)) return '';
  const [s, e] = orderRange(a, b);
  const out = [];
  for (let L = s.line; L <= e.line; L++) {
    const cells = lineAt(L) || [];
    let c0 = L === s.line ? s.col : 0;
    const c1 = L === e.line ? e.col : cols;
    if (c0 > 0 && cells[c0] === '') c0--; // 넓은 글자의 오른쪽 반에서 시작하면 그 글자부터
    out.push(cells.slice(c0, c1).join('').replace(/\s+$/, ''));
  }
  return out.join('\r\n');
}

// 보이는 문서 줄 first..last 안의 부분을 xterm select(col, row, length)로 바꾼다(row = 문서 줄 - rowBase). 보이는 부분이 없으면 null
export function visibleSpan(a, b, { first, last, cols, rowBase = 0 }) {
  if (emptyRange(a, b) || last < first) return null;
  let [s, e] = orderRange(a, b);
  if (before(s, { line: first, col: 0 })) s = { line: first, col: 0 };
  if (before({ line: last, col: cols }, e)) e = { line: last, col: cols };
  if (!before(s, e)) return null;
  return { col: s.col, row: s.line - rowBase, length: (e.line - s.line) * cols + e.col - s.col };
}

// 두 번 누르기: 누른 칸의 낱말(xterm 기본 낱말 구분 글자와 같다). 빈칸을 누르면 이어진 빈칸
const SEP = new Set([' ', '(', ')', '[', ']', '{', '}', "'", '"', ',', '`']);
export function wordRange(cells, cell) {
  const at = (i) => { let c = cells[i]; if (c === '' && i > 0) c = cells[i - 1]; return c === undefined || c === '' ? ' ' : c; };
  const n = cells.length;
  if (!n) return [cell, cell];
  const cls = (c) => (c === ' ' ? 0 : SEP.has(c) ? 2 : 1);
  const k = cls(at(cell));
  if (k === 2) return [cell, cell + 1];
  let s = cell, e = cell + 1;
  while (s > 0 && cls(at(s - 1)) === k) s--;
  while (e < n && cls(at(e)) === k) e++;
  return [s, e];
}
// 세 번 누르기: 줄 전체(끝 빈칸 뺌)
export function lineRange(cells) {
  let e = cells.length;
  while (e > 0 && (cells[e - 1] === ' ' || cells[e - 1] === '')) e--;
  return [0, e];
}

// ---------- 셸 기록 ----------
// pane.read recent(ANSI)를 줄로. 색 글은 그대로 두고 맞추기용 글은 따로 만든다
export function stripAnsi(s) {
  return String(s ?? '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '').replace(/\x1b[()][A-Z0-9]/g, '');
}
// herdr 기록 줄(history, 화면 너비로 감긴 줄, 화면 줄 포함, 끝 빈 줄은 빠짐) 가운데 지금 화면(screen) 위에 있는 줄 수.
// 화면의 글이 기록 끝부분과 줄마다 같아야 한다. 맞는 자리가 없으면 -1(넣지 않는다)
export function historyAbove(history, screen) {
  const H = history.map(keyOf), S = screen.map(keyOf);
  let last = S.length - 1;
  while (last >= 0 && !S[last]) last--;
  if (last < 0) return -1;
  for (let m = H.length - (last + 1); m >= 0; m--) {
    let ok = true;
    for (let i = 0; i <= last && ok; i++) ok = H[m + i] === S[i];
    if (ok) return m;
  }
  return -1;
}
// 셸 기록을 xterm에 넣는 글: 기록 줄을 쓰고 줄을 더 내려 모두 scrollback으로 보낸다(그다음 첫 전체 프레임이 화면을 그린다).
// 줄바꿈 L번이면 scrollback에 L - (rows - 1)줄이 들어가므로 history n줄 + rows번 내린다
export function historyPrefill(lines, rows) {
  if (!lines.length) return '';
  return lines.map((l) => `\x1b[0m${l}\x1b[0m`).join('\r\n') + '\r\n'.repeat(rows);
}
// 화면이 움직인 줄 수로 설명되지 않게 많이 바뀌었는가(빠른 출력이 한 프레임에 지나감, cls). 그러면 판 안 기록을 herdr 기록으로 다시 맞춘다
export function bigChange(prev, next, min = 3) {
  if (!prev || !next || prev.length !== next.length) return false;
  let n = 0;
  for (let i = 0; i < next.length; i++) if (keyOf(prev[i]) !== keyOf(next[i])) n++;
  return n >= min;
}

// xterm 화면 칸(색, 굵게 등)을 다시 쓸 수 있는 글로. 판 안 기록을 다시 맞출 때 reset 뒤 지금 화면을 그대로 되살린다.
// buffer: xterm IBuffer(getLine(y).getCell(x, cell)), base: 화면 첫 줄의 버퍼 줄, cell: 재사용할 칸 객체
export function sgrOf(c) {
  const p = ['0'];
  if (c.isBold()) p.push('1');
  if (c.isDim()) p.push('2');
  if (c.isItalic()) p.push('3');
  if (c.isUnderline()) p.push('4');
  if (c.isBlink()) p.push('5');
  if (c.isInverse()) p.push('7');
  if (c.isInvisible()) p.push('8');
  if (c.isStrikethrough()) p.push('9');
  const color = (rgb, pal, v, base, bright, ext) => {
    if (rgb) p.push(`${ext};2;${(v >> 16) & 255};${(v >> 8) & 255};${v & 255}`);
    else if (pal) p.push(v < 8 ? `${base + v}` : v < 16 ? `${bright + v - 8}` : `${ext};5;${v}`);
  };
  color(c.isFgRGB(), c.isFgPalette(), c.getFgColor(), 30, 90, 38);
  color(c.isBgRGB(), c.isBgPalette(), c.getBgColor(), 40, 100, 48);
  return `\x1b[${p.join(';')}m`;
}
export function serializeScreen(buffer, { base, rows, cols, cursorX, cursorY, cell }) {
  let out = '';
  for (let r = 0; r < rows; r++) {
    out += `\x1b[${r + 1};1H`;
    const line = buffer.getLine(base + r);
    let last = '';
    for (let x = 0; x < cols; x++) {
      const c = line && line.getCell(x, cell);
      if (!c) { if (last !== '\x1b[0m') { out += '\x1b[0m'; last = '\x1b[0m'; } out += ' '; continue; }
      if (c.getWidth() === 0) continue;
      const s = sgrOf(c);
      if (s !== last) { out += s; last = s; }
      out += c.getChars() || ' ';
    }
  }
  return `${out}\x1b[0m\x1b[${cursorY + 1};${cursorX + 1}H`;
}

// 새 출력으로 화면이 위로 d줄 밀렸을 때, 프레임을 쓰기 전 xterm에서 영역(1..hi+1 줄)을 d줄 올려 밀려난 줄을 scrollback으로 보내는 글.
// 영역 윗줄이 0이면 xterm은 밀린 줄을 scrollback에 넣는다. 커서는 저장했다 되돌린다
export function scrollUpSeq(d, hi, rows) {
  if (!(d > 0)) return '';
  const bottom = clamp(hi + 1, 1, rows);
  return `\x1b7\x1b[1;${bottom}r\x1b[${bottom};1H${'\n'.repeat(d)}\x1b[r\x1b8`;
}
