// P97: 레일 빠른 생성의 이름 칸. 레일의 런처 단추를 누르면 바로 띄우지 않고 그 단추 오른쪽에 작은 칸을 띄운다.
// Enter·만들기 = 그 이름으로 만든다(빈칸이면 판이 지금처럼 이름을 짓는다). Esc·바깥 누르기 = 취소.
// 칸은 열리자마자 초점을 받고, 치는 동안 판의 세션 이름 규칙(겹침, 허용 글자, 길이, all)을 칸 아래에 알린다(lib/session-name.js checkLabel. 확정은 백엔드).
// 레일 칸은 넘치면 넘기는 상자라 칸은 문서 바닥(포털)에 띄우고 단추의 화면 자리에 맞춘다.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store.js';
import { useT } from './lib/i18n.js';
import { checkLabel } from './lib/session-name.js';
import { quickSpawn } from './SpawnDialog.jsx';
import { popoverAt } from './lib/launchers.js';

export function QuickName({ launcher, anchor, onClose }) {
  const t = useT();
  const sessions = useStore((st) => st.sessions);
  const wsName = useStore((st) => { const w = st.workspaces.find((x) => x.key === st.currentWs); return w ? w.name : ''; });
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const box = useRef(null);
  const chk = checkLabel(value, [...sessions.values()], null);
  const pos = popoverAt(anchor.getBoundingClientRect(), { vw: window.innerWidth, vh: window.innerHeight });
  useEffect(() => { input.current && input.current.focus(); }, []);
  // 바깥 누르기는 취소. 연 단추를 다시 누르는 것은 단추가 닫는다(여기서 닫으면 바로 다시 열린다)
  useEffect(() => {
    const down = (e) => { if (box.current && !box.current.contains(e.target) && !anchor.contains(e.target)) onClose(); };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [anchor, onClose]);
  const go = async () => {
    if (!chk.ok || busy) return;
    setBusy(true);
    const r = await quickSpawn(launcher.id, chk.label || undefined);
    setBusy(false);
    if (r !== false) onClose(); // 실패(이름 겹침 등)면 칸을 남겨 고치게 한다. 오류는 알림으로 보인다
  };
  const onKey = (e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || e.key === 'Process') return; // 한글 조합 중의 Enter는 글자를 맺는다
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); anchor.focus(); }
  };
  const err = chk.ok ? null : t(`backend.${chk.key}`, chk.vars);
  return createPortal(
    <div ref={box} className="mt-qname" role="dialog" aria-labelledby="mt-qname-title" data-role="quick-name" data-launcher={launcher.id} style={{ left: pos.left, top: pos.top, '--qname-arrow': `${pos.arrow}px` }}>
      <div className="mt-qname-title" id="mt-qname-title"><b>{launcher.name}</b>{wsName ? <span className="dim"> · {t('quickName.where', { ws: wsName })}</span> : null}</div>
      <div className="mt-qname-row">
        <input ref={input} className={`mt-set-text mono${err ? ' bad' : ''}`} data-field="quick-name" value={value} maxLength={40} spellCheck={false} autoComplete="off"
          placeholder={t('quickName.ph')} aria-label={t('quickName.label')} aria-invalid={!!err} aria-describedby="mt-qname-note"
          onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} />
        <button type="button" className="mt-btn small primary" data-action="quick-name-go" disabled={!!err || busy} onClick={go}>{busy ? t('quickName.starting') : t('quickName.go')}</button>
      </div>
      <div id="mt-qname-note" className={`mt-qname-note${err ? ' bad' : ''}`} role={err ? 'alert' : undefined} data-role="quick-name-note">{err || t('quickName.hint')}</div>
    </div>,
    document.body,
  );
}
