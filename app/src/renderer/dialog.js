// P52(#5): 대화상자와 떠 있는 창의 공용 키보드 동작. 판단은 lib/dialog.js.
// 사용: const box = useDialog(onClose)               → <div className="mt-modal" ref={box}> (대화상자: 초점 넣기, Tab 가두기, Esc, 초점 돌려주기)
//       const box = useDialog(onClose, { modal: false }) → 떠 있는 창(초점은 그대로, Esc만)
import { useEffect, useRef } from 'react';
import { escTarget, topOf, trapIndex, firstFieldIndex, FOCUSABLE } from './lib/dialog.js';

const stack = []; // { id, modal, el, close }
let seq = 0;
let installed = false;

const visible = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
const focusables = (el) => [...el.querySelectorAll(FOCUSABLE)].filter(visible);
const isField = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

function onKey(e) {
  if (e.isComposing || e.keyCode === 229 || e.key === 'Process' || e.defaultPrevented) return;
  const top = topOf(stack);
  if (!top || !top.el) return;
  const t = e.target;
  if (e.key === 'Escape') {
    const id = escTarget(stack, { key: e.key, isComposing: e.isComposing, defaultPrevented: e.defaultPrevented, inside: !!(t && top.el.contains(t)), inTerminal: !!(t && t.closest && t.closest('.xterm')), inField: isField(t) });
    if (id == null) return;
    e.preventDefault();
    top.close();
    return;
  }
  if (e.key === 'Tab' && top.modal) {
    const list = focusables(top.el);
    if (!list.length) { e.preventDefault(); top.el.focus(); return; }
    const i = list.indexOf(document.activeElement);
    // 안에서 가운데로 가는 Tab은 브라우저에 맡기고, 끝과 밖에서만 돌린다
    if (i >= 0 && !(e.shiftKey ? i === 0 : i === list.length - 1)) return;
    e.preventDefault();
    list[trapIndex(list.length, i, e.shiftKey)].focus();
  }
}

export function useDialog(onClose, { modal = true } = {}) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 연 자리는 처음 그릴 때 기억한다(효과가 돌 때는 autoFocus가 이미 초점을 안으로 옮겼다)
  const opener = useRef(undefined);
  if (opener.current === undefined) opener.current = typeof document !== 'undefined' ? document.activeElement : null;
  useEffect(() => {
    if (!installed) { window.addEventListener('keydown', onKey); installed = true; } // 거품 단계: 안쪽 칸이 먼저 Esc를 쓰면(preventDefault) 닫지 않는다
    const el = ref.current;
    const prev = opener.current;
    const entry = { id: ++seq, modal, get el() { return ref.current; }, close: () => closeRef.current && closeRef.current() };
    stack.push(entry);
    if (modal && el && !el.contains(document.activeElement)) {
      const list = focusables(el);
      const i = firstFieldIndex(list.map((x) => ({ tag: x.tagName, type: (x.type || '').toLowerCase(), disabled: x.disabled, autofocus: x.hasAttribute('autofocus') || x.dataset.autofocus != null })));
      if (i >= 0) list[i].focus();
      else { if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1'); el.focus(); }
    }
    return () => {
      const k = stack.indexOf(entry);
      if (k >= 0) stack.splice(k, 1);
      // 닫으면 연 자리로 초점을 돌려준다. 닫은 뒤 다른 곳(새 터미널 등)이 이미 초점을 가져갔으면 그대로 둔다
      const now = document.activeElement;
      if (modal && prev && prev !== document.body && prev.isConnected && (!now || now === document.body || (el && el.contains(now)))) {
        try { prev.focus(); } catch {}
      }
    };
  }, [modal]);
  return ref;
}
