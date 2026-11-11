// P76: 휴대폰 보드 화면에서 노드를 탭하면 그 세션이 화면을 채운다(전체 보기). 판 위에 덮어 그리고, 판의 뷰포트는 그대로라 나오면 같은 자리다.
// - 위쪽 띠(← 보드 단추, 이름, 상태, 글자 크기): 세션 바깥. 단추나 띠를 탭하면 보드로 나온다. 뒤로 가기(가장자리 밀기)와 두 손가락 오므리기로도 나온다(P83 단추)
// - 터미널: 화면 폭 전체, 휴대폰 글자 크기(P74와 같은 값). 이 휴대폰이 패널 크기를 가져간다(P47 초점). 손가락으로 끌면 스크롤, 탭하면 입력 줄로 키보드
// - 아래: 얇은 입력 줄과 특수 키 줄(Esc, Ctrl+C, Tab, ⇧Tab, 화살표, /, ⏎). 세션 위에는 떠 있는 단추를 두지 않는다
// - 입력 줄은 브라우저의 보통 입력칸이라 한글 조합(IME)을 브라우저가 끝낸 뒤 Enter에 터미널로 친다(lib/touch-board.js linePlan)
// - 키보드가 올라오면 보이는 높이(visualViewport)에 맞춰 화면을 올린다. 터미널 높이는 그대로 두고 위쪽을 가려 아래 줄이 입력 줄 바로 위에 남는다(패널 크기가 바뀌지 않는다)
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, toast } from './store.js';
import { phoneInputTarget, phoneInputCall } from './lib/phone-input.js';
import { TerminalView, terms } from './TerminalView.jsx';
import { markInteracted } from './touch.js';
import { wakeSession } from './sleep.js';
import { useT, errText } from './lib/i18n.js';
import { STATE_LABEL } from './lib/labels.js';
import { keyBytes, touchWheelDelta, toneOf } from './lib/phone.js';
import { fullLayout, kbShift, lastContentRow, linePlan, lineEnterSends, FULL_KEYS, PINCH_EXIT_RATIO, TOUCH_SLOP_PX, TAP_MAX_MS, dist as gap2 } from './lib/touch-board.js';
import { useFull, closeFull } from './full-view.js';
import { readPhoneScale, writePhoneScale, screenNow } from './Phone.jsx';
import { clampPhoneScale, PHONE_SCALE_MIN, SCALE_MAX } from './lib/scale.js';

const KEY_LABEL = { enter: '⏎', esc: 'Esc', ctrlc: '^C', up: '↑', down: '↓', left: '←', right: '→', tab: 'Tab', shifttab: '⇧Tab', slash: '/' };
const ATTACH_DELAY_MS = 200; // 판의 노드가 터미널을 뗀 뒤 붙인다(한 창이 한 패널을 두 번 붙이지 않게)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function PhoneFull() {
  const f = useFull();
  const s = useStore((st) => (f ? st.sessions.get(f.id) : null));
  const loaded = useStore((st) => st.boardLoaded);
  useEffect(() => { if (f && loaded && !s) closeFull(); }, [f, s, loaded]); // 세션이 사라지면 나온다
  if (!f || !s) return null;
  return <FullView key={f.id} s={s} from={f.from} />;
}

function FullView({ s, from }) {
  const t = useT();
  const id = s.sessionId;
  const rootRef = useRef(null), topRef = useRef(null), wrapRef = useRef(null), lineRef = useRef(null), keysRef = useRef(null), taRef = useRef(null);
  const [vv, setVv] = useState(screenNow); // P83: 홈 화면 앱의 짧은 창 높이를 바로잡은 값
  const [box, setBox] = useState({ w: 0, room: 0, term: 0, open: false });
  const closedTerm = useRef(null);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState('');
  const [scale, setScale] = useState(readPhoneScale);
  const live = s.state !== 'sleeping' && s.state !== 'exited';
  const [shift, setShift] = useState(0); // 키보드가 열렸을 때 터미널을 위로 올린 양(px)

  // 판의 노드가 이 세션 터미널을 뗀 뒤 붙인다
  useEffect(() => { const tm = setTimeout(() => setReady(true), ATTACH_DELAY_MS); return () => clearTimeout(tm); }, []);
  // 여는 움직임: 노드의 화면 자리에서 화면 전체로
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || !from || !el.animate || from.w <= 0) return;
    const W = window.innerWidth, H = window.innerHeight;
    try { el.animate([{ transform: `translate(${from.x}px, ${from.y}px) scale(${from.w / W}, ${from.h / H})`, opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 170, easing: 'cubic-bezier(.2,.7,.2,1)' }); } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 가상 키보드: 보이는 높이·자리
  useEffect(() => {
    const v = window.visualViewport;
    const fit = () => setVv(screenNow());
    if (v) { v.addEventListener('resize', fit); v.addEventListener('scroll', fit); }
    window.addEventListener('resize', fit);
    document.documentElement.classList.add('mt-full-on');
    return () => { if (v) { v.removeEventListener('resize', fit); v.removeEventListener('scroll', fit); } window.removeEventListener('resize', fit); document.documentElement.classList.remove('mt-full-on', 'mt-kb-open'); };
  }, []);
  // 칸 나누기: 키보드가 열리면 터미널 높이는 닫혔을 때 그대로(위쪽이 가려진다)
  useLayoutEffect(() => {
    const h = (r) => (r.current ? r.current.offsetHeight : 0);
    const lay = fullLayout({ vvHeight: vv.height, innerHeight: window.innerHeight, top: h(topRef), line: h(lineRef), keys: h(keysRef), closedTerm: closedTerm.current });
    if (!lay.open) closedTerm.current = lay.room;
    document.documentElement.classList.toggle('mt-kb-open', lay.open);
    const w = wrapRef.current ? wrapRef.current.clientWidth : window.innerWidth;
    setBox((b) => (b.w === w && b.room === lay.room && b.term === lay.term && b.open === lay.open ? b : { w, room: lay.room, term: lay.term, open: lay.open }));
  }, [vv.height, vv.top]);

  // 키보드가 열려 있는 동안: 글이 있는 마지막 줄(커서 줄 포함)이 입력 줄 바로 위에 보이도록 올린다(lib/touch-board.js kbShift)
  useEffect(() => {
    if (!box.open) { setShift(0); return undefined; }
    const measure = () => {
      const tm = terms.get(id);
      const wrap = wrapRef.current;
      const screen = wrap && wrap.querySelector('.xterm-screen');
      const termEl = wrap && wrap.querySelector('[data-role=phone-full-term]');
      if (!tm || !screen || !termEl || !tm.rows) return;
      const b = tm.buffer.active, lines = [];
      for (let i = 0; i < tm.rows; i++) { const l = b.getLine(b.viewportY + i); lines.push(l ? l.translateToString(true) : ''); }
      const rowPx = screen.getBoundingClientRect().height / tm.rows;
      const top = screen.getBoundingClientRect().top - termEl.getBoundingClientRect().top;
      const bottom = top + (lastContentRow(lines, b.cursorY + (b.baseY - b.viewportY)) + 1) * rowPx + 4;
      const v = kbShift({ term: box.term, room: box.room, contentBottom: bottom });
      setShift((o) => (Math.abs(o - v) < 1 ? o : v));
    };
    measure();
    const iv = setInterval(measure, 250);
    return () => clearInterval(iv);
  }, [box.open, box.term, box.room, id]);

  // 이 휴대폰이 패널 크기를 가져간다(P47: 초점을 준 클라이언트). 붙을 때까지 몇 번 해 본다. 다시 붙으면 다시
  useEffect(() => {
    if (!live || !ready) return undefined;
    let n = 0, stop = false, timer = 0;
    const tryFocus = () => { if (stop) return; phoneInputCall(api, terms, id, 'terminal.focus').catch(() => { if (++n < 20 && !stop) timer = setTimeout(tryFocus, 300); }); };
    timer = setTimeout(tryFocus, 250);
    const off = api.on('$open', () => { n = 0; clearTimeout(timer); timer = setTimeout(tryFocus, 600); });
    return () => { stop = true; clearTimeout(timer); off(); };
  }, [id, live, ready]);

  // 터미널과 위쪽 띠의 손가락: 끌면 스크롤(휠), 터미널을 탭하면 입력 줄(키보드), 띠를 탭하면 나오기, 두 손가락 오므리기면 나오기.
  // 터미널 자체(xterm)는 손가락을 받지 않고 키보드를 띄우지 않는다
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const quiet = setInterval(() => { for (const ta of root.querySelectorAll('.xterm-helper-textarea:not([inputmode="none"])')) { ta.setAttribute('inputmode', 'none'); ta.setAttribute('aria-hidden', 'true'); ta.tabIndex = -1; } }, 300);
    let g = null;
    const zone = (el) => (el && el.closest && el.closest('[data-role=phone-full-out]') ? 'out' : el && el.closest && el.closest('[data-role=phone-full-term]') ? 'term' : null);
    const onStart = (e) => {
      const z = zone(e.target);
      if (!z) return; // 입력 줄과 키 줄은 보통대로
      if (e.target.closest('button')) return; // 위 띠의 글자 크기 단추, 잠든 세션의 깨우기 단추
      e.preventDefault(); e.stopPropagation();
      const p = [...e.touches].map((x) => ({ x: x.clientX, y: x.clientY }));
      if (p.length >= 2) { g = { pinch: true, d0: Math.max(1, gap2(p[0], p[1])), done: false }; return; }
      g = { zone: z, x0: p[0].x, y0: p[0].y, last: p[0].y, t0: performance.now(), moved: false };
    };
    const onMove = (e) => {
      if (!g) return;
      e.preventDefault(); e.stopPropagation();
      const p = [...e.touches].map((x) => ({ x: x.clientX, y: x.clientY }));
      if (g.pinch) { if (p.length >= 2 && !g.done && gap2(p[0], p[1]) / g.d0 < PINCH_EXIT_RATIO) { g.done = true; closeFull(); } return; }
      const q = p[0];
      if (!g.moved && Math.hypot(q.x - g.x0, q.y - g.y0) <= TOUCH_SLOP_PX) return;
      g.moved = true;
      const dy = q.y - g.last; g.last = q.y;
      const screen = root.querySelector('[data-role=phone-full-term] .xterm-screen');
      if (screen && dy) screen.dispatchEvent(new WheelEvent('wheel', { deltaY: touchWheelDelta(dy), deltaMode: 0, clientX: q.x, clientY: q.y, bubbles: true, cancelable: true }));
    };
    const onEnd = (e) => {
      if (!g) return;
      e.preventDefault(); e.stopPropagation();
      if (e.touches.length) return;
      const gg = g; g = null;
      if (gg.pinch || gg.moved || performance.now() - gg.t0 >= TAP_MAX_MS) return;
      if (gg.zone === 'out') closeFull();
      else if (taRef.current) taRef.current.focus(); // 터미널을 탭하면 입력 줄에 키보드
    };
    const onCancel = () => { g = null; };
    const cap = { capture: true, passive: false };
    root.addEventListener('touchstart', onStart, cap); root.addEventListener('touchmove', onMove, cap); root.addEventListener('touchend', onEnd, cap); root.addEventListener('touchcancel', onCancel, cap);
    return () => { clearInterval(quiet); root.removeEventListener('touchstart', onStart, cap); root.removeEventListener('touchmove', onMove, cap); root.removeEventListener('touchend', onEnd, cap); root.removeEventListener('touchcancel', onCancel, cap); };
  }, [id]);

  const input = (data, target = phoneInputTarget(api, terms, id)) => phoneInputCall(api, terms, id, 'terminal.input', { data }, target); // P82: 끊긴 동안은 띠가 알린다
  const sendKey = (k) => {
    markInteracted(id);
    if (k === 'enter' && text) return sendLine();
    const term = terms.get(id);
    const data = keyBytes(k, { appCursor: !!(term && term.modes && term.modes.applicationCursorKeysMode) });
    if (data) input(data).catch((e) => { if (e.code !== 'disconnected') toast(errText(e), 'error'); });
  };
  async function sendLine() {
    if (api.status !== 'open') return; // P82: 끊긴 동안은 보내지 않고 글을 둔다(다시 붙으면 다시 누른다. 오래 끊기면 띠가 알린다)
    const target = phoneInputTarget(api, terms, id);
    if (!target) return;
    const plan = linePlan(text);
    const submitted = text;
    setText('');
    if (taRef.current) taRef.current.style.height = '';
    markInteracted(id);
    try {
      for (const step of plan) { if (step.delay) await sleep(step.delay); await input(step.data, target); }
    } catch (e) { setText((draft) => draft || submitted); if (e.code !== 'disconnected') toast(errText(e), 'error'); }
  }
  const bump = (d) => setScale((v) => { const n = clampPhoneScale(Math.round((v + d) * 100) / 100); writePhoneScale(n); return n; });
  const grow = (el) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 96)}px`; };
  const stateText = s.kind === 'shell' && live ? (s.shell && s.shell.atPrompt === false ? STATE_LABEL.shell_running : STATE_LABEL.shell_idle) : STATE_LABEL[s.state] || s.state;

  return (
    <div className={`mt-full${box.open ? ' kb' : ''}`} ref={rootRef} data-role="phone-full" data-session={id} data-kb={box.open ? '1' : undefined} style={{ top: vv.top, height: vv.height }}>
      <div className="mt-full-out" ref={topRef} data-role="phone-full-out" aria-label={t('phoneBoard.fullOut')}>
        {/* P83: 보드로 돌아가는 단추(띠 누르기, 뒤로 쓸기, 오므리기도 그대로) */}
        <button type="button" className="mt-full-exit" data-action="phone-full-exit" aria-label={t('phoneExit.label')} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => closeFull()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg><span>{t('phoneExit.button')}</span>
        </button>
        <span className="mt-ph-dot" data-tone={toneOf(s)} aria-hidden="true" />
        <b className="mt-full-name">{s.name}</b>
        <span className="mt-full-state">{stateText}</span>
        {live && <button type="button" className="mt-full-font" data-action="phone-font-down" aria-label={t('phone.fontDown')} disabled={scale <= PHONE_SCALE_MIN} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => bump(-0.05)}>A−</button>}
        {live && <button type="button" className="mt-full-font" data-action="phone-font-up" aria-label={t('phone.fontUp')} disabled={scale >= SCALE_MAX} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => bump(0.05)}>A+</button>}
      </div>
      <div className="mt-full-wrap" ref={wrapRef}>
        <div className="mt-full-term" data-role="phone-full-term" style={box.term ? { height: box.term, top: box.open ? -shift : 'auto', bottom: box.open ? 'auto' : 0 } : undefined} data-shift={box.open ? shift : 0}>
          {live && ready && box.w > 0 && box.term > 0 && <TerminalView sessionId={id} width={box.w} height={box.term} fontScale={scale} webgl={false} onInput={() => markInteracted(id)} />}
          {s.state === 'sleeping' && <div className="mt-ph-cover" data-role="phone-asleep"><p>{t('phone.asleep')}</p><button type="button" className="mt-ph-primary" data-action="phone-wake" onClick={() => wakeSession(id)}>{s.waking ? t('phone.waking') : t('phone.wake')}</button></div>}
          {s.state === 'exited' && <div className="mt-ph-cover" data-role="phone-exited"><p>{t('phone.exited')}</p></div>}
        </div>
      </div>
      {live && (
        <div className="mt-full-line" ref={lineRef} data-role="phone-line">
          <textarea ref={taRef} rows={1} value={text} data-field="phone-line" enterKeyHint="send" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            placeholder={t('phoneBoard.fullType', { name: s.name })}
            onChange={(e) => { setText(e.target.value); grow(e.target); }}
            onKeyDown={(e) => { if (lineEnterSends({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) { e.preventDefault(); sendLine(); } }} />
        </div>
      )}
      {live && (
        <div className="mt-full-keys" ref={keysRef} data-role="phone-keys">
          {FULL_KEYS.map((k) => (
            <button key={k} type="button" className={`mt-ph-key${k === 'enter' ? ' enter' : ''}`} data-key={k} aria-label={t(k === 'left' || k === 'right' ? `phoneBoard.key_${k}` : `phone.key_${k}`)} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => sendKey(k)}>{KEY_LABEL[k]}</button>
          ))}
        </div>
      )}
    </div>
  );
}
