// 복귀 요약(ARCH 4절 A3, P3): 마지막으로 본 뒤 바뀐 것(새로 생긴 내 차례, 끝난 턴, 오류, 종료)을 한 줄씩 보여준다.
// "마지막으로 본 시각"은 창에 초점이 있고 보이는 동안 30초마다, 그리고 창을 떠날 때 백엔드에 남긴다(board.markSeen).
// 창을 다시 열거나 창으로 돌아왔을 때 그 시각에서 기본 5분 넘게 지났고 바뀐 것이 있으면 연다.
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { getState, useStore } from './store.js';
import { awayLongEnough, DEFAULT_AWAY_MS, CHANGE_LABEL } from './lib/attention.js';
import { ago, agoText } from './lib/labels.js';
import { useT, tMsg } from './lib/i18n.js';
import { perfLog } from './perf.js';
import { useDialog } from './dialog.js';

function awayMs() {
  const q = new URLSearchParams(location.search).get('awaySec');
  let v = q; try { v ??= localStorage.getItem('mt.awaySec'); } catch {}
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n * 1000 : DEFAULT_AWAY_MS;
}
const active = () => document.hasFocus() && document.visibilityState === 'visible';

export function useReturnSummary() {
  const loaded = useStore((st) => st.boardLoaded);
  const [summary, setSummary] = useState(null);
  const seen = useRef(null);

  async function show(since, why) {
    try {
      const r = await api.call('changes.since', { since });
      perfLog('return_summary', { why, since, lines: r.lines.length });
      if (r.lines.length) setSummary({ ...r, why });
    } catch {}
  }
  const mark = (t = Date.now()) => { seen.current = t; api.call('board.markSeen', { at: t }).catch(() => {}); };

  useEffect(() => {
    if (!loaded) return;
    seen.current = getState().boardSeenAt;
    // 창을 열었을 때: 지난번에 본 뒤 오래 지났으면
    if (awayLongEnough(seen.current, Date.now(), awayMs())) show(seen.current, 'open');
    if (active()) mark();
    const tick = setInterval(() => { if (active()) mark(); }, 30000);
    const onBack = () => {
      if (!active()) return;
      if (awayLongEnough(seen.current, Date.now(), awayMs())) show(seen.current, 'return');
      mark();
    };
    const onLeave = () => { if (!active()) mark(); };
    window.addEventListener('focus', onBack);
    window.addEventListener('blur', onLeave);
    document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? onBack() : onLeave()));
    getState().showChanges = (minutes = 60) => show(Date.now() - minutes * 60000, 'manual'); // 위쪽 줄의 "바뀐 것" 단추와 시험
    return () => { clearInterval(tick); window.removeEventListener('focus', onBack); window.removeEventListener('blur', onLeave); };
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return [summary, () => setSummary(null)];
}

export function ReturnSummary({ summary, onClose }) {
  if (!summary) return null;
  return <SummaryCard summary={summary} onClose={onClose} />;
}
// P52: 떠 있는 창이다. 저절로 뜨므로 초점을 가져가지 않고, Esc로 닫는다(터미널·입력 칸에서 친 Esc는 그쪽 몫)
function SummaryCard({ summary, onClose }) {
  const t = useT();
  const box = useDialog(onClose, { modal: false });
  const go = (id) => { const st = getState(); if (id && st.navigateTo && st.sessions.has(id)) st.navigateTo(id); };
  const mins = Math.round((summary.until - summary.since) / 60000);
  const away = ago(summary.since, summary.until);
  return (
    <div ref={box} className="mt-return" data-role="return-summary">
      <div className="mt-card-head">
        <span className="mt-card-title">{summary.why === 'manual' ? t('returnSummary.manual', { n: mins }) : t('returnSummary.away', { away })}</span>
        <button className="mt-card-min" data-action="return-close" title={t('common.close')} onClick={onClose}>×</button>
      </div>
      {summary.lines.map((l, i) => (
        <div key={i} className={`mt-return-line rk-${l.kind}${l.sessionId && !l.closed ? ' link' : ''}`} onClick={() => go(l.sessionId)} data-kind={l.kind}>
          <span className={`mt-return-kind rk-${l.kind}`}>{CHANGE_LABEL[l.kind] || l.kind}</span>
          {l.name && <b>@{l.name}</b>}
          {l.count > 1 && <span className="mt-return-count">×{l.count}</span>}
          <span className="mt-return-text">{l.msg ? tMsg({ msg: l.msg }, l.text) : l.text}</span>
          {l.kind === 'needs_you' && <span className={`mt-return-tag${l.stillOpen ? ' hot' : ''}`}>{l.stillOpen ? t('returnSummary.stillOpen') : t('returnSummary.resolved')}</span>}
          {l.closed && <span className="mt-return-tag">{t('returnSummary.removed')}</span>}
          {l.lastAt && <span className="mt-return-ago">{agoText(l.lastAt)}</span>}
        </div>
      ))}
    </div>
  );
}
