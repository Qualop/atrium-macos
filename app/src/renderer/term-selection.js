// P42: 터미널 노드의 웹 같은 글 고르기(DOM 쪽, ARCH 7.2, E12). 계산은 lib/term-select.js(단위 시험 p42-lib).
// xterm 자체 선택은 쓰지 않는다. 선택은 "문서" 줄과 칸 경계로 들고, 보이는 부분만 term.select()로 그린다.
// - live(claude 등): 화면은 herdr 프레임이고 앱이 스스로 스크롤한다(SGR 휠). 프레임마다 앞 화면과 견줘 움직인 줄 수를 찾아
//   본 줄을 문서(TermDoc)에 모은다. 그래서 고른 글이 화면 밖으로 나가도, 스피너가 돌아도 그대로이고 복사된다.
// - buffer(셸): herdr 기록과 밀려난 줄이 xterm scrollback에 있다(TerminalView). 문서 줄 = 버퍼의 절대 줄, 스크롤은 판 안에서 한다.
// 끄는 중 가장자리 가까이·밖으로 가면 거리만큼 빠르게 저절로 스크롤하고, 끄는 중 휠을 굴려도 선택이 따라 늘어난다.
// 끝내기는 웹과 같다(밖 누르기, 글 입력, Esc). 복사·붙여넣기 뒤에도 지운다(clearsSelection).
import { cellAt, edgeSpeed, scrollStep, TermDoc, rangeText, visibleSpan, wordRange, lineRange, emptyRange } from './lib/term-select.js';

export const LINES_PER_WHEEL = 3; // Claude Code가 SGR 휠 한 번에 움직이는 줄 수(E12에서 잰 값 2~3줄)
const TICK_MS = 40;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// xterm 버퍼 줄 → 칸 배열(넓은 글자의 오른쪽 반 칸은 '')
export function lineCells(line, cols, cell) {
  const out = new Array(cols).fill(' ');
  if (!line) return out;
  for (let x = 0; x < cols; x++) {
    const c = line.getCell(x, cell);
    if (!c) continue;
    out[x] = c.getWidth() === 0 ? '' : c.getChars() || ' ';
  }
  return out;
}
export function screenCells(term) {
  const b = term.buffer.active, out = [];
  const cell = b.getNullCell();
  for (let r = 0; r < term.rows; r++) out.push(lineCells(b.getLine(b.viewportY + r), term.cols, cell));
  return out;
}

export class TermSelection {
  // mode: 'live' | 'buffer'. sendWheel(steps, cell): live에서 앱에 SGR 휠 steps번(아래 +, 위 -). onActivate: 누르면 부른다
  constructor({ term, host, mode, sendWheel, onActivate, log }) {
    Object.assign(this, { term, host, mode, sendWheel, onActivate, log: log || (() => {}) });
    this.doc = new TermDoc();
    this.anchor = null; this.focus = null;
    this.dragging = false; this.pt = null; this.speed = 0; this.acc = 0; this.timer = null; this.lastTick = 0;
    this._down = (e) => this.onDown(e);
    this._move = (e) => this.onMove(e);
    this._up = (e) => this.onUp(e);
    this._outside = (e) => { if (this.anchor && !this.host.contains(e.target)) this.clear('outside'); };
    host.addEventListener('mousedown', this._down, true);
    this._offScroll = term.onScroll(() => { if (this.mode === 'buffer') this.afterMove(); });
    this._offResize = term.onResize(() => { if (this.anchor) this.clear('resize'); });
  }
  dispose() {
    this.stopAuto(); this.endDrag();
    this.host.removeEventListener('mousedown', this._down, true);
    window.removeEventListener('mousedown', this._outside, true);
    this._offScroll.dispose(); this._offResize.dispose();
  }

  // 시험과 문제 찾기용 최근 기록(문서가 움직인 줄 수, 자동 스크롤 휠). term._mtSel.trace로 읽는다
  note(o) { (this.trace ||= []).push({ at: Math.round(performance.now()), ...o }); if (this.trace.length > 200) this.trace.shift(); }
  has() { return !emptyRange(this.anchor, this.focus); }
  text() { return this.has() ? rangeText((i) => this.lineAt(i), this.anchor, this.focus, this.term.cols) : ''; }
  clear(why) {
    if (!this.anchor && !this.dragging) return;
    this.anchor = this.focus = null;
    this.endDrag();
    this.term.clearSelection();
    window.removeEventListener('mousedown', this._outside, true);
    if (this.mode === 'buffer' && why === 'escape') this.term.scrollToBottom(); // 셸: 지금 화면으로 돌아온다
    this.log('term_selection_cleared', { why });
  }

  // ---------- 문서 ----------
  // 화면 줄의 스크롤 영역(live: 머리줄·입력칸 뺀 줄, 그 밖: 화면 전체)
  region() { const rows = this.term.rows; return this.mode === 'live' && this.doc.hi >= 0 ? [clamp(this.doc.lo, 0, rows - 1), clamp(this.doc.hi, 0, rows - 1)] : [0, rows - 1]; }
  toLine(row) { return this.mode === 'buffer' ? this.term.buffer.active.viewportY + row : this.doc.top + row; }
  lineAt(i) {
    if (this.mode === 'buffer') { const b = this.term.buffer.active; return lineCells(b.getLine(i), this.term.cols, b.getNullCell()); }
    return this.doc.line(i);
  }
  render() {
    const cols = this.term.cols;
    let span = null;
    if (this.has()) {
      if (this.mode === 'buffer') span = visibleSpan(this.anchor, this.focus, { first: 0, last: this.term.buffer.active.length - 1, cols });
      else { const [lo, hi] = this.region(); span = visibleSpan(this.anchor, this.focus, { first: this.toLine(lo), last: this.toLine(hi), cols, rowBase: this.doc.top }); }
    }
    if (span) this.term.select(span.col, span.row, span.length); else this.term.clearSelection();
  }
  // live: 프레임을 쓴 뒤 부른다. 고르는 중일 때만 화면을 견준다
  onFrame() {
    if (this.mode !== 'live' || (!this.anchor && !this.dragging)) return;
    const s = this.doc.update(screenCells(this.term));
    if (s.resized) { this.clear('resize'); return; }
    if (s.d) this.note({ d: s.d, lo: s.lo, hi: s.hi, top: this.doc.top });
    this.afterMove();
  }
  // 글이 움직였다(프레임, 판 안 스크롤): 끄는 중이면 마우스 밑 칸으로 끝을 다시 잡는다
  afterMove() {
    if (!this.anchor) return;
    if (this.dragging && this.pt) this.focus = this.posAt(this.pt);
    this.render();
  }

  // ---------- 마우스 ----------
  screenRect() { const el = this.host.querySelector('.xterm-screen') || this.host; return el.getBoundingClientRect(); }
  cell(pt) { return cellAt({ clientX: pt.x, clientY: pt.y, rect: this.screenRect(), cols: this.term.cols, rows: this.term.rows }); }
  posAt(pt) {
    const c = this.cell(pt);
    const [lo, hi] = this.region();
    if (c.row < lo) return { line: this.toLine(lo), col: 0 };
    if (c.row > hi) return { line: this.toLine(hi), col: this.term.cols };
    return { line: this.toLine(c.row), col: c.col };
  }
  onDown(e) {
    if (e.button !== 0) return;
    // xterm 자체 선택이 시작되지 않게 여기서 멈춘다. 초점과 노드 활성은 대신 한다
    e.stopPropagation(); e.preventDefault();
    if (this.onActivate) this.onActivate();
    this.term.focus();
    const pt = { x: e.clientX, y: e.clientY };
    const c = this.cell(pt);
    if (e.shiftKey && this.has() && e.detail < 2) {
      this.focus = this.posAt(pt); // Shift+누르기: 선택을 거기까지 늘린다
    } else {
      // live: 새 선택은 지금 화면에서 문서를 시작한다(스크롤 영역은 화면 전체에서 시작해, 글이 움직이면 알아낸다)
      if (this.mode === 'live') this.doc.reset(screenCells(this.term));
      const p = this.posAt(pt);
      if (e.detail >= 2) { // 두 번: 낱말, 세 번: 줄
        const cells = this.lineAt(p.line) || [];
        const [c0, c1] = e.detail === 2 ? wordRange(cells, c.cell) : lineRange(cells);
        this.anchor = { line: p.line, col: c0 }; this.focus = { line: p.line, col: c1 };
      } else {
        this.anchor = p; this.focus = { ...p };
      }
    }
    this.dragging = true; this.pt = pt;
    document.body.classList.add('mt-term-selecting');
    window.addEventListener('mousemove', this._move, true);
    window.addEventListener('mouseup', this._up, true);
    window.addEventListener('mousedown', this._outside, true);
    this.render();
  }
  onMove(e) {
    if (!this.dragging) return;
    this.pt = { x: e.clientX, y: e.clientY };
    this.focus = this.posAt(this.pt);
    this.render();
    this.checkAuto();
  }
  onUp() {
    this.endDrag();
    if (!this.has()) { this.anchor = this.focus = null; this.term.clearSelection(); window.removeEventListener('mousedown', this._outside, true); }
  }
  endDrag() {
    this.dragging = false;
    this.stopAuto();
    document.body.classList.remove('mt-term-selecting');
    window.removeEventListener('mousemove', this._move, true);
    window.removeEventListener('mouseup', this._up, true);
  }

  // ---------- 가장자리 자동 스크롤 ----------
  edge() {
    if (!this.pt) return 0;
    const r = this.screenRect();
    return edgeSpeed({ y: this.pt.y, top: r.top, bottom: r.bottom, rowH: r.height / this.term.rows });
  }
  checkAuto() {
    this.speed = this.edge();
    if (this.speed && !this.timer) { this.acc = 0; this.lastTick = performance.now(); this.timer = setInterval(() => this.tick(), TICK_MS); }
    else if (!this.speed) this.stopAuto();
  }
  stopAuto() { if (this.timer) { clearInterval(this.timer); this.timer = null; } this.speed = 0; this.acc = 0; }
  tick() {
    if (!this.dragging) { this.stopAuto(); return; }
    const now = performance.now(), dt = now - this.lastTick;
    this.lastTick = now;
    this.speed = this.edge();
    if (!this.speed) { this.stopAuto(); return; }
    if (this.mode === 'buffer') {
      const s = scrollStep(this.acc, this.speed, dt);
      this.acc = s.acc;
      if (s.lines) this.term.scrollLines(s.lines); // onScroll → afterMove
    } else {
      const s = scrollStep(this.acc, this.speed / LINES_PER_WHEEL, dt); // 줄/초 → 휠/초
      this.acc = s.acc;
      if (s.lines) {
        // 휠은 스크롤 영역 안의 칸에서 보낸다(가장자리 밖 점을 그대로 쓰면 입력칸·상태 줄 위의 휠이 된다)
        const c = this.cell(this.pt), [lo, hi] = this.region();
        const at = { ...c, row: clamp(c.row, lo, hi) };
        const n = clamp(s.lines, -5, 5);
        this.note({ wheel: n, row: at.row });
        this.sendWheel(n, at); // 다음 프레임에서 onFrame → afterMove
      }
    }
  }
}
