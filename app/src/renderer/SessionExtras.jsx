// 세션 노드 안의 P3 덧붙임: 재시작으로 끊긴 턴과 대화 기록 꼬리(C3). 다시 들어가기 브리핑(E2)은 P45에서, 한 줄 메모는 P22에서 뺐다
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { toast } from './store.js';
import { STATE_LABEL, agoText } from './lib/labels.js';
import { useT, t, errText } from './lib/i18n.js';
import { markInteracted } from './touch.js';

// C3: herdr 재시작으로 끊긴 턴. 그때의 상태와 지시, 지금의 대화 기록 꼬리를 보여준다.
// P6c: 셸은 "끊긴 명령"이다(P6b I8: 그때 돌던 명령이 prompt에 있다). 셸에는 대화 기록이 없어 꼬리를 읽지 않는다
export function InterruptedBanner({ s }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [tail, setTail] = useState(null);
  const it = s.interruptedTurn;
  const shell = s.kind === 'shell';
  useEffect(() => {
    let alive = true;
    if (open && !shell) api.call('session.messages', { session: s.sessionId, limit: 10 }).then((r) => alive && setTail(r.messages.slice(-8))).catch(() => alive && setTail([]));
    return () => { alive = false; };
  }, [open, shell, s.sessionId, s.state, s.lastAnswerAt]);
  return (
    <div className="mt-interrupted nodrag nowheel" data-role="interrupted" data-shell={shell ? '1' : '0'}>
      <div className="mt-card-head">
        <span className="mt-card-title">{shell ? t('extras.interruptedCmdTitle') : t('extras.interruptedTurnTitle')}</span>
        <span className="mt-card-waited">{t('extras.interruptedWhen', { ago: agoText(it.at), state: STATE_LABEL[it.state] || it.state })}</span>
        <button className="mt-card-min" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▴'}</button>
      </div>
      {open && <>
        {it.prompt && <div className="mt-card-text">{shell ? t('extras.command') : t('extras.prompt')}: {it.prompt}</div>}
        {s.recovered && <div className="mt-card-sub">{t('extras.recovered', { plan: RECOVER_LABEL[s.recovered.plan] || s.recovered.plan })}</div>}
        {shell && <div className="mt-card-sub">{t('extras.shellRestarted')}</div>}
        {!shell && <><div className="mt-card-sub">{t('extras.tailNote')}</div>
        <div className="mt-tail mono">
          {tail === null ? t('common.loading') : !tail.length ? t('extras.noTranscript') : tail.map((m, i) => (
            <div key={i} className={`mt-tail-${m.role}`}>{m.role === 'tool_use' ? `⚙ ${m.tool}` : m.role === 'tool_result' ? `↳ ${m.isError ? t('extras.toolError') : ''}${String(m.text || '').replace(/\s+/g, ' ').slice(0, 160)}` : `${m.role === 'user' ? '▶' : '●'} ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 200)}`}</div>
          ))}
        </div></>}
        <div className="mt-card-actions"><button className="mt-btn small" onClick={() => { markInteracted(s.sessionId); api.call('session.clearInterrupted', { session: s.sessionId }).catch((e) => toast(errText(e), 'error')); }} data-action="interrupted-ack">{t('extras.ack')}</button></div>
      </>}
    </div>
  );
}
const RECOVER_KEYS = ['recreate_resume', 'recreate_fresh', 'restart_with_settings', 'start_resume', 'start_fresh'];
// 그때의 언어로 찾는다(RECOVER_LABEL[plan])
export const RECOVER_LABEL = new Proxy({}, { get: (_, k) => (typeof k === 'string' && RECOVER_KEYS.includes(k) ? t(`extras.recover.${k}`) : undefined) });
