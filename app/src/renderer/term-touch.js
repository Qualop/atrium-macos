// P151: 휴대폰 웹(손가락)의 터미널 글 고르기(DOM 쪽). 판단과 셈은 lib/touch-select.js(단위 시험 p151-lib).
// 고른 범위·문서·가장자리 자동 스크롤·그리기는 P42 TermSelection을 그대로 쓴다(선택은 글에 붙어 스크롤·새 프레임에 함께 움직인다).
// - 창(window)의 캡처 단계에서 손가락을 먼저 본다. 길게 누르기가 잡히기 전에는 아무것도 막지 않아,
//   짧게 누르기(초점)·끌어 스크롤(Phone.jsx, PhoneFull.jsx)·키 패드는 지금까지와 같다.
// - 길게 누르기가 잡히면(또는 손잡이를 잡으면) 그 손가락이 뗄 때까지의 터치를 여기서 멈춘다(스크롤·탭·xterm으로 가지 않는다).
//   그동안 터미널로 키·마우스 보고를 보내지 않는다(가장자리 자동 스크롤의 휠만 P42처럼 보낸다).
// - 끝내기: 막대의 복사(복사하고 끝낸다)·닫기, 터미널 다른 곳 탭(P42 밖 누르기·새 누르기), 글 입력, Esc.
// - 판(태블릿 보드, P76)은 길게 누르기가 노드 옮기기라 이 길을 켜지 않는다(TerminalView touchSelect를 주지 않는다).
import { pressVerdict, holdRange, pinAnchor, grabHandle, allRange, handleSpots, barSpot, HOLD_MS } from './lib/touch-select.js';
import { screenCells } from './term-selection.js';

export const BAR_W = 236, BAR_H = 40; // 떠 있는 막대의 대략 크기(자리 셈용, phone.css .mt-tsel-bar)

// 클립보드에 쓴다. 보안 문맥이 아니거나(http 원격) 거절되면 숨은 입력칸 + execCommand('copy'). → 'api' | 'exec', 실패면 throw
export async function writeClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return 'api'; } catch {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', ''); ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
  document.body.appendChild(ta);
  ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  if (!ok) throw new Error('execCommand copy failed');
  return 'exec';
}

export class TouchSelect {
  // sel: TermSelection, wrap: 터미널을 감싼 요소(이 안에서 누른 손가락만 본다), owner: 손잡이 표시(data-owner)
  // onUi(ui | null): 손잡이·막대를 그릴 값이 바뀌었다
  constructor({ sel, wrap, owner, onUi, log }) {
    Object.assign(this, { sel, wrap, owner, onUi, log: log || (() => {}) });
    this.press = null; this.drag = null; this.active = false; this.raf = 0; this.lastUi = '';
    this._start = (e) => this.onStart(e);
    this._move = (e) => this.onMove(e);
    this._end = (e) => this.onEnd(e);
    this._cancel = (e) => this.onEnd(e, true);
    this._menu = (e) => e.preventDefault(); // 안드로이드의 길게 누르기 메뉴
    const cap = { capture: true, passive: false };
    window.addEventListener('touchstart', this._start, cap);
    window.addEventListener('touchmove', this._move, cap);
    window.addEventListener('touchend', this._end, cap);
    window.addEventListener('touchcancel', this._cancel, cap);
    wrap.addEventListener('contextmenu', this._menu);
    sel.onRender = () => this.schedule();
  }
  dispose() {
    this.cancelPress();
    cancelAnimationFrame(this.raf);
    const cap = { capture: true };
    window.removeEventListener('touchstart', this._start, cap);
    window.removeEventListener('touchmove', this._move, cap);
    window.removeEventListener('touchend', this._end, cap);
    window.removeEventListener('touchcancel', this._cancel, cap);
    this.wrap.removeEventListener('contextmenu', this._menu);
    this.sel.onRender = null;
  }

  // ---------- 손가락 ----------
  onStart(e) {
    const tch = e.touches[0];
    const h = e.target && e.target.closest && e.target.closest('[data-term-handle]');
    if (h && h.dataset.owner === this.owner && this.active && this.sel.has() && e.touches.length === 1) {
      e.preventDefault(); e.stopPropagation();
      const which = h.dataset.termHandle;
      const g = grabHandle(this.sel.anchor, this.sel.focus, which);
      this.sel.anchor = g.anchor; this.sel.focus = g.focus;
      // 손잡이 점은 글 위·아래에 있다. 잡은 자리와 그 끝 글자 칸(줄 가운데)의 차이를 지켜, 끝이 손가락 끝이 아니라 손잡이를 따라오게 한다
      const sp = this.spots && this.spots[which];
      const lh = (this.spots && this.spots.lineH) || 0;
      const off = sp ? { dx: sp.x - tch.clientX, dy: (which === 'end' ? sp.y - lh / 2 : sp.y + lh / 2) - tch.clientY } : { dx: 0, dy: 0 };
      this.beginDrag({ x: tch.clientX + off.dx, y: tch.clientY + off.dy }, null, 'handle', tch.identifier, off);
      return;
    }
    if (this.drag) { e.preventDefault(); e.stopPropagation(); return; } // 고르는 중 다른 손가락
    if (!this.wrap.contains(e.target) || e.touches.length !== 1) { this.cancelPress(); return; }
    this.cancelPress();
    const p = { x0: tch.clientX, y0: tch.clientY, t0: performance.now(), id: tch.identifier };
    p.timer = setTimeout(() => this.fire(), HOLD_MS);
    this.press = p;
  }
  onMove(e) {
    if (this.drag) {
      e.preventDefault(); e.stopPropagation();
      const tch = [...e.touches].find((x) => x.identifier === this.drag.id) || e.touches[0];
      const off = this.drag.off;
      if (tch) this.dragTo({ x: tch.clientX + off.dx, y: tch.clientY + off.dy });
      return;
    }
    const p = this.press;
    if (!p) return;
    const tch = e.touches[0];
    const v = pressVerdict({ dt: performance.now() - p.t0, dx: tch.clientX - p.x0, dy: tch.clientY - p.y0, fingers: e.touches.length });
    if (v === 'cancel') this.cancelPress();
  }
  onEnd(e, cancelled = false) {
    if (this.drag) {
      e.preventDefault(); e.stopPropagation(); // 뗄 때의 탭·흉내 마우스 사건을 막는다
      if (!e.touches.length || cancelled) this.endDrag();
      return;
    }
    // 짧게 눌렀다 뗐다(탭)는 그대로 흘려보낸다. 고른 글이 있으면 터미널 탭으로 고르기를 끝낸다(전체 보기는 흉내 마우스 사건이 없어 여기서)
    const p = this.press;
    this.cancelPress();
    if (p && !cancelled && this.active && !e.touches.length) this.close('touch-tap');
  }
  cancelPress() { if (this.press) { clearTimeout(this.press.timer); this.press = null; } }

  // 길게 누르기가 잡혔다: 누른 칸의 낱말(빈칸이면 줄)을 고르고 같은 손가락으로 넓히기를 시작한다
  fire() {
    const p = this.press;
    this.press = null;
    if (!p) return;
    const sel = this.sel, pt = { x: p.x0, y: p.y0 };
    if (sel.mode === 'live') sel.doc.reset(screenCells(sel.term));
    const pos = sel.posAt(pt), c = sel.cell(pt);
    const r = holdRange(sel.lineAt(pos.line), c.cell);
    if (!r) { this.log('term_touch_hold_empty', {}); return; } // 빈 줄: 고르지 않는다
    const word = { start: { line: pos.line, col: r[0] }, end: { line: pos.line, col: r[1] } };
    sel.anchor = word.start; sel.focus = word.end;
    window.addEventListener('mousedown', sel._outside, true); // P42: 터미널 밖을 누르면 끝낸다
    this.active = true;
    try { if (navigator.vibrate) navigator.vibrate(12); } catch {}
    this.log('term_touch_select', { cols: r[1] - r[0] });
    this.beginDrag(pt, word, 'hold', p.id);
  }
  beginDrag(pt, word, how, id, off = { dx: 0, dy: 0 }) {
    const sel = this.sel;
    this.drag = { word, how, id, off };
    sel.dragging = true; sel.pt = pt;
    // 가장자리 자동 스크롤로 글이 움직여도(afterMove) 처음 낱말을 품게 한다
    sel.repin = word ? () => { const g = pinAnchor(word, sel.focus); sel.anchor = g.anchor; sel.focus = g.focus; } : null;
    sel.render();
  }
  dragTo(pt) {
    const sel = this.sel;
    sel.pt = pt;
    sel.focus = sel.posAt(pt);
    if (sel.repin) sel.repin();
    sel.render();
    sel.checkAuto(); // P42: 위·아래 가장자리 가까이·밖이면 기록으로 굴러간다
  }
  endDrag() {
    const sel = this.sel;
    this.drag = null;
    sel.repin = null;
    sel.endDrag();
    if (!sel.has()) sel.clear('touch-empty');
    this.schedule();
  }

  // ---------- 막대 ----------
  selectAll() {
    const sel = this.sel, cols = sel.term.cols;
    let r;
    if (sel.mode === 'buffer') r = allRange((i) => sel.lineAt(i), 0, sel.term.buffer.active.length - 1, cols);
    else { const keys = [...sel.doc.lines.keys()]; r = keys.length ? allRange((i) => sel.lineAt(i), Math.min(...keys), Math.max(...keys), cols) : null; }
    if (!r) return;
    sel.anchor = r.anchor; sel.focus = r.focus;
    this.active = true;
    sel.render();
    this.log('term_touch_select_all', {});
  }
  close(why = 'touch-close') { this.sel.clear(why); this.schedule(); }

  // ---------- 손잡이·막대 그리기 ----------
  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }
  paint() {
    const sel = this.sel;
    if (!sel.anchor || !sel.has()) this.active = false;
    let ui = null;
    if (this.active) {
      const term = sel.term, rect = sel.screenRect();
      const base = sel.mode === 'buffer' ? term.buffer.active.viewportY : sel.doc.top;
      const spots = this.spots = handleSpots(sel.anchor, sel.focus, { base, rows: term.rows, cols: term.cols, rect });
      const bar = barSpot(spots, { barW: BAR_W, barH: BAR_H, viewW: window.innerWidth, viewH: window.innerHeight, rect });
      const r = (s) => (s ? { x: Math.round(s.x), y: Math.round(s.y) } : null);
      ui = { start: r(spots.start), end: r(spots.end), lineH: Math.round(spots.lineH), dragging: !!this.drag, bar: { x: Math.round(bar.x), y: Math.round(bar.y) } };
    }
    const key = JSON.stringify(ui);
    if (key === this.lastUi) return;
    this.lastUi = key;
    this.onUi(ui);
  }
}
