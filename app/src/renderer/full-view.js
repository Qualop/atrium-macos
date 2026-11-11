// P76: 휴대폰 보드 화면의 전체 보기(탭한 세션 하나가 화면을 채운다) 상태. Canvas.jsx(탭)가 열고 PhoneFull.jsx가 그린다.
// 뒤로 가기(가장자리 밀기, Android 뒤로 단추)로 나오도록 열 때 기록 한 칸을 더한다.
import { useSyncExternalStore } from 'react';

let cur = null; // { id, from: { x, y, w, h } | null(노드의 화면 자리, 여는 움직임에 쓴다) }
const subs = new Set();
const emit = () => { for (const fn of [...subs]) fn(); };
export const fullNow = () => cur;
export const fullId = () => (cur ? cur.id : null);
export function useFull() { return useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => cur); }
export const onFull = (fn) => { subs.add(fn); return () => subs.delete(fn); };

export function openFull(id, from = null) {
  if (!id) return;
  const had = !!cur;
  cur = { id, from };
  try { if (had && history.state && history.state.mtFull) history.replaceState({ mtFull: id }, ''); else history.pushState({ mtFull: id }, ''); } catch {}
  emit();
}
// 바깥 탭, 오므리기: 더한 기록 칸을 되돌린다(popstate가 닫는다). 기록이 없으면 바로 닫는다
export function closeFull() {
  if (!cur) return;
  try { if (history.state && history.state.mtFull) { history.back(); return; } } catch {}
  cur = null; emit();
}
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    const id = e.state && e.state.mtFull;
    if (id && cur && cur.id === id) return;
    if (!id && cur) { cur = null; emit(); }
  });
}
