// P66: 세션 이름 바꾸기 입력칸. 노드 머리(두 번 누르기, ⋯ 메뉴, F2)와 사이드바 줄(메뉴)이 같이 쓴다.
// Enter·칸 밖 누르기 = 바꾸기, Esc = 그만두기, 비우면 원래 이름(에이전트 주소)으로 돌아간다. 틀리거나 겹치면 칸 아래에 이유를 보이고 칸을 닫지 않는다.
// 바꾼 이름은 백엔드가 모든 창(원격 웹 화면 포함)에 세션 요약으로 다시 보낸다.
import { useEffect, useRef, useState } from 'react';
import { useStore, getState, setRenaming, toast } from './store.js';
import { api } from './api.js';
import { useT, t, errText, tMsg } from './lib/i18n.js';
import { checkLabel, sameLabel, addressOf, LABEL_MAX } from './lib/session-name.js';

export async function renameSession(s, value) {
  const pre = checkLabel(value, getState().sessions.values(), s);
  if (!pre.ok) return { error: tMsg({ msg: { key: pre.key, vars: pre.vars } }) };
  if (sameLabel(s, pre.label)) return { done: true, changed: false };
  try {
    const r = await api.call('session.rename', pre.label ? { session: s.sessionId, name: pre.label, by: 'human' } : { session: s.sessionId, clear: true, by: 'human' });
    return { done: true, changed: !!r.changed, name: r.name };
  } catch (e) { return { error: errText(e) }; }
}

export function RenameInput({ s, where, className = '' }) {
  const tt = useT();
  const [val, setVal] = useState(s.name || '');
  const [err, setErr] = useState('');
  const busy = useRef(false);
  const quit = useRef(false); // Esc로 그만둔 뒤의 blur는 바꾸지 않는다
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (el) { el.focus(); el.select(); } }, []);
  const stop = () => { if (getState().renaming && getState().renaming.id === s.sessionId) setRenaming(null); };
  async function commit() {
    if (busy.current) return;
    busy.current = true;
    const r = await renameSession(s, val);
    busy.current = false;
    if (r.error) { setErr(r.error); toast(r.error, 'error'); if (ref.current) ref.current.focus(); return; } // 칸 옆(좁으면 잘림)과 알림 둘 다
    quit.current = true; // 칸이 닫히며 생기는 blur로 다시 보내지 않는다
    if (r.changed) toast(t(r.name === addressOf(s) ? 'rename.cleared' : 'rename.done', { name: r.name, address: addressOf(s) }));
    stop();
  }
  return (
    <span className={`mt-rename-wrap nodrag ${className}`} data-role="rename" data-where={where} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <input ref={ref} className={`mt-rename-input${err ? ' bad' : ''}`} data-role="rename-input" value={val} maxLength={LABEL_MAX + 8} spellCheck={false}
        placeholder={addressOf(s)} aria-label={tt('rename.label')} title={tt('rename.hint', { address: addressOf(s) })}
        onChange={(e) => { setVal(e.target.value); if (err) setErr(''); }}
        onBlur={() => { if (quit.current) return; if (!err) commit(); else stop(); }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.nativeEvent.isComposing || e.keyCode === 229 || e.key === 'Process') return; if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); quit.current = true; stop(); } }} />
      {err && <span className="mt-rename-err" data-role="rename-error" title={err}>{err}</span>}
    </span>
  );
}

// 이 세션의 이름을 지금 바꾸는 곳(node | sidebar)이면 true
export function useRenaming(sessionId, where) {
  return useStore((st) => !!(st.renaming && st.renaming.id === sessionId && st.renaming.where === where));
}
