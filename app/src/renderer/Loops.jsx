// 루프(ARCH 4절 I5, P6c): 같은 지시를 조건에 따라 다시 보낸다. 셸에는 걸 수 없다.
// - 만들기 대화상자: 노드 ⋯ 메뉴나 그룹 머리줄 "루프"에서 연다. 지시, 시작 조건(주기 1분~24시간, 쉴 때, 답·화면에 글), 멈춤 조건(횟수, 시간, 목표 글).
//   "확인"을 누르면 백엔드가 설명 글(대상, 조건, 토큰을 쓴다, 내 차례 건너뛰기)을 주고, 한 번 더 "만들기"를 눌러야 만든다(loop.create confirm).
// - 노드 배지: 그 세션이 대상에 든 켜진·멈춘 루프. 돌고 있음(⟳)·멈춤(⏸), 남은 횟수, 다음 시각. 누르면 목록(멈춤·이어 가기·지우기, 최근 기록).
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useStore, toast } from './store.js';
import { loopBadge, loopsOfSession, triggerText, stopText, LOOP_STATUS, STOP_REASON, dur } from './lib/items.js';
import { useT, errText, tMsg, fmtTime } from './lib/i18n.js';
import { useDialog } from './dialog.js';

function useNow(on) { const [n, set] = useState(Date.now()); useEffect(() => { if (!on) return; set(Date.now()); const t = setInterval(() => set(Date.now()), 1000); return () => clearInterval(t); }, [on]); return n; }

// 만들기 대화상자. target: { session }
export function LoopDialog({ target, onClose }) {
  const t = useT();
  const s = useStore((st) => (target.session ? st.sessions.get(target.session) : null));
  const [prompt, setPrompt] = useState('');
  const [type, setType] = useState('interval');
  const [every, setEvery] = useState('10m');
  const [immediate, setImmediate] = useState(true);
  const [text, setText] = useState('');
  const [source, setSource] = useState('answer');
  const [maxRuns, setMaxRuns] = useState('3');
  const [maxMs, setMaxMs] = useState('');
  const [untilText, setUntilText] = useState('');
  const [ask, setAsk] = useState(null); // 백엔드의 확인 글
  const [busy, setBusy] = useState(false);
  const label = s ? `@${s.name}` : '?';
  const params = (confirm) => ({
    session: target.session,
    prompt,
    trigger: type === 'interval' ? { type, every: every.trim(), immediate } : type === 'idle' ? { type } : { type, text: text.trim(), source },
    stop: { ...(maxRuns.trim() ? { maxRuns: Number(maxRuns) } : {}), ...(maxMs.trim() ? { maxMs: maxMs.trim() } : {}), ...(untilText.trim() ? { untilText: untilText.trim() } : {}) },
    ...(confirm ? { confirm: true } : {}),
  });
  async function check(e) {
    e.preventDefault();
    setBusy(true);
    try { const r = await api.call('loop.create', params(false)); setAsk(r.needsConfirm ? tMsg(r) : null); } catch (err) { toast(t('loops.fail', { error: errText(err) }), 'error'); }
    setBusy(false);
  }
  async function create() {
    setBusy(true);
    try { const l = await api.call('loop.create', params(true)); toast(t('loops.created', { name: l.targetName || label })); onClose(); } catch (err) { toast(t('loops.createFail', { error: errText(err) }), 'error'); setBusy(false); }
  }
  const box = useDialog(onClose); // P52
  const change = (f) => (e) => { setAsk(null); f(e.target.type === 'checkbox' ? e.target.checked : e.target.value); };
  return (
    <div className="mt-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={box} className="mt-modal mt-loop-dialog" onSubmit={check} data-role="loop-dialog">
        <h3>{t('loops.dialogTitle', { label })}</h3>
        <label>{t('loops.prompt')}<textarea rows={3} value={prompt} onChange={change(setPrompt)} data-field="loop-prompt" placeholder={t('loops.promptPh')} autoFocus /></label>
        <fieldset className="mt-loop-set">
          <legend>{t('loops.startLegend')}</legend>
          <label className="mt-loop-opt"><input type="radio" name="trig" checked={type === 'interval'} onChange={() => { setAsk(null); setType('interval'); }} data-field="trig-interval" /> {t('loops.interval')}
            <input className="mt-loop-short" value={every} onChange={change(setEvery)} disabled={type !== 'interval'} data-field="loop-every" title={t('loops.everyTitle')} />
            <span className="dim">{t('loops.every')}</span>
            <label className="mt-loop-inline"><input type="checkbox" checked={immediate} onChange={change(setImmediate)} disabled={type !== 'interval'} data-field="loop-immediate" /> {t('loops.immediate')}</label>
          </label>
          <label className="mt-loop-opt"><input type="radio" name="trig" checked={type === 'idle'} onChange={() => { setAsk(null); setType('idle'); }} data-field="trig-idle" /> {t('loops.idle')}</label>
          <label className="mt-loop-opt"><input type="radio" name="trig" checked={type === 'text'} onChange={() => { setAsk(null); setType('text'); }} data-field="trig-text" />
            <select value={source} onChange={change(setSource)} disabled={type !== 'text'} data-field="loop-source"><option value="answer">{t('loops.optAnswer')}</option><option value="screen">{t('loops.optScreen')}</option><option value="any">{t('loops.optAny')}</option></select>
            {t('loops.textPre')} <input className="mt-loop-mid" value={text} onChange={change(setText)} disabled={type !== 'text'} data-field="loop-text" placeholder={t('loops.textPh')} /> {t('loops.textPost')}
          </label>
        </fieldset>
        <fieldset className="mt-loop-set">
          <legend>{t('loops.stopLegend')}</legend>
          <div className="mt-row">
            <label>{t('loops.maxRuns')}<input value={maxRuns} onChange={change(setMaxRuns)} data-field="loop-max-runs" placeholder={t('loops.maxRunsPh')} /></label>
            <label>{t('loops.maxTime')}<input value={maxMs} onChange={change(setMaxMs)} data-field="loop-max-time" placeholder={t('loops.maxTimePh')} /></label>
            <label>{t('loops.until')}<input value={untilText} onChange={change(setUntilText)} data-field="loop-until" placeholder={t('loops.untilPh')} /></label>
          </div>
        </fieldset>
        <div className="mt-card-sub">{t('loops.note')}</div>
        {ask && <div className="mt-warn" data-role="loop-confirm">{ask}</div>}
        <div className="mt-card-actions">
          {!ask ? <button className="mt-btn primary" disabled={busy || !prompt.trim()} data-action="loop-check">{t('loops.check')}</button>
            : <button type="button" className="mt-btn primary" disabled={busy} onClick={create} data-action="loop-create">{t('loops.create')}</button>}
          <button type="button" className="mt-btn ghost" data-action="loop-cancel" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </div>
  );
}

// 루프 한 줄과 멈춤·이어 가기·지우기
export function LoopRow({ l, now }) {
  const t = useT();
  const call = (m) => api.call(m, { loop: l.loopId }).catch((e) => toast(t('loops.fail', { error: errText(e) }), 'error'));
  const last = (l.history || []).filter((h) => h.kind === 'run' || h.kind === 'skip').slice(-3).reverse();
  return (
    <div className={`mt-loop-row ls-${l.status}`} data-role="loop-row" data-loop={l.loopId} data-status={l.status}>
      <div className="mt-loop-row-head">
        <b>{l.targetName ? `@${l.targetName}` : ''}</b>
        <span className={`mt-loop-st ls-${l.status}`}>{LOOP_STATUS[l.status] || l.status}</span>
        <span className="dim" data-role="loop-line">{loopBadge(l, now)}</span>
        <span className="mt-node-sp" />
        {l.status === 'active' && <button className="mt-btn small" data-action="loop-pause" onClick={() => call('loop.pause')}>{t('loops.pause')}</button>}
        {l.status === 'paused' && <button className="mt-btn small" data-action="loop-resume" onClick={() => call('loop.resume')}>{t('loops.resume')}</button>}
        <button className="mt-btn small ghost" data-action="loop-delete" onClick={() => call('loop.delete')}>{t('loops.delete')}</button>
      </div>
      <div className="mt-loop-row-text">“{l.prompt.replace(/\s+/g, ' ').slice(0, 120)}”</div>
      <div className="dim">{triggerText(l.trigger)} · {t('loops.rowStop', { stop: stopText(l.stop) })} · {t('loops.rowSent', { n: l.runs })}{l.skips ? ` · ${t('loops.rowSkipped', { n: l.skips })}` : ''} · {t('loops.rowElapsed', { d: dur(l.elapsedMs || 0) })}{l.stopReason ? ` · ${STOP_REASON[l.stopReason] || l.stopReason}` : ''}</div>
      {last.length > 0 && <div className="mt-loop-hist dim">{last.map((h, i) => <span key={i}>{fmtTime(h.t)} {h.kind === 'run' ? (h.n ? t('loops.histSentN', { n: h.n }) : t('loops.histSent')) : t('loops.histSkipped', { reason: `${h.reason || ''}${h.name ? ` @${h.name}` : ''}` })}</span>)}</div>}
    </div>
  );
}

// 노드 머리줄 배지(세션). 이 세션이 대상에 든 루프가 있을 때만. 누르면 노드 본문에 목록(SessionLoopList)을 연다(머리줄은 넘치는 것을 자른다)
export function LoopBadge({ s, onClick }) {
  const t = useT();
  const loops = useStore((st) => st.loops);
  const mine = loopsOfSession(loops.values(), s.sessionId);
  const live = mine.filter((l) => l.status === 'active' || l.status === 'paused');
  const now = useNow(live.some((l) => l.status === 'active'));
  if (!mine.length) return null;
  const head = live[0];
  return (
    <button className={`mt-badge loop nodrag${head ? ` ls-${head.status}` : ' ls-done'}`} data-role="loop-badge" data-status={head ? head.status : 'done'} title={t('loops.badgeTitle')} onClick={onClick}>
      {head ? loopBadge(head, now) : t('loops.badgeDone')}{live.length > 1 ? ` +${live.length - 1}` : ''}
    </button>
  );
}
export function SessionLoopList({ s, onClose }) {
  const loops = useStore((st) => st.loops);
  const mine = loopsOfSession(loops.values(), s.sessionId);
  const now = useNow(true);
  if (!mine.length) return null;
  return <LoopList loops={mine} now={now} onClose={onClose} />;
}

export function LoopList({ loops, now, onClose }) {
  const t = useT();
  return (
    <div className="mt-loop-list nodrag nowheel" data-role="loop-list" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mt-card-head"><span className="mt-card-title">{t('loops.title')}</span><button className="mt-card-min" onClick={onClose}>×</button></div>
      {loops.map((l) => <LoopRow key={l.loopId} l={l} now={now} />)}
    </div>
  );
}
