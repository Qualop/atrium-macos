// P88: 휴대폰 알림 시트(세션 목록 머리줄의 종 단추). 알림 켜기·끄기, 종류별(끝남, 응답 필요, 오류), PC 사용 중에도 받기, 시험 알림.
// 홈 화면 앱이 아니면(iOS Safari 탭) 추가하는 방법을 보인다. 알림에는 세션 이름과 상태만 보인다(질문·답의 글은 보내지 않는다)
import { useEffect, useState } from 'react';
import { toast } from './store.js';
import { useT, errText } from './lib/i18n.js';
import { pushLine, failKey, PUSH_KINDS, SUB_MODES, subModeOf, isMuted } from './lib/push.js';
import { pushSupportNow, permissionNow, enablePush, disablePush, pushStatus, pushKey, pushPrefs, pushTest } from './push.js';

export function PushButton({ onClick }) {
  const t = useT();
  return (
    <button type="button" className="mt-ph-icon" data-action="phone-push" title={t('push.title')} aria-label={t('push.title')} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" /></svg>
    </button>
  );
}

function Row({ label, hint, checked, disabled, onChange, role }) {
  return (
    <label className={`mt-ph-switchrow${disabled ? ' off' : ''}`} data-role={role}>
      <span className="mt-ph-switchrow-text"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" className="mt-switch" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

// P92: 하위 세션(워커) 알림. 응답 필요만(기본) / 모두 / 끔
function SubChoice({ value, disabled, onChange }) {
  const t = useT();
  const cur = subModeOf(value);
  return (
    <div className={`mt-ph-subchoice${disabled ? ' off' : ''}`} data-role="push-sub" data-value={cur}>
      <div className="mt-ph-switchrow-text"><b>{t('pushSub.title')}</b><small>{t('pushSub.hint')}</small></div>
      <div className="mt-ph-seg" role="radiogroup" aria-label={t('pushSub.title')}>
        {SUB_MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={cur === m} className={cur === m ? 'on' : ''} data-action={`push-sub-${m}`} disabled={disabled} onClick={() => cur !== m && onChange(m)}>{t(`pushSub.mode_${m}`)}</button>
        ))}
      </div>
    </div>
  );
}

// P92: 세션 화면 머리줄의 "이 세션 알림 끄기". 이 기기가 알림을 켰을 때만 보인다
export function SessionMuteButton({ sessionId }) {
  const t = useT();
  const [status, setStatus] = useState(null);
  useEffect(() => { if (pushSupportNow() !== 'ok') return undefined; let live = true; pushStatus().then((s) => { if (live) setStatus(s); }).catch(() => {}); return () => { live = false; }; }, []);
  if (!status || !status.on) return null;
  const muted = isMuted(status, sessionId);
  const flip = () => { pushPrefs({ mute: { sessionId, on: !muted } }).then((s) => { setStatus(s); toast(t(muted ? 'pushSub.unmuted' : 'pushSub.muted')); }).catch((e) => toast(t('push.failed', { error: errText(e) }))); };
  const label = t(muted ? 'pushSub.unmute' : 'pushSub.mute');
  return (
    <button type="button" className={`mt-ph-icon mt-ph-mute${muted ? ' on' : ''}`} data-action="phone-session-mute" data-muted={muted ? '1' : '0'} title={label} aria-label={label} aria-pressed={muted} onClick={flip}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" />{muted && <path d="M4 4l16 16" />}</svg>
    </button>
  );
}

export function PushSheet({ onClose }) {
  const t = useT();
  const support = pushSupportNow();
  const [key, setKey] = useState(null);
  const [status, setStatus] = useState(null);
  const [perm, setPerm] = useState(permissionNow);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (support !== 'ok') return;
    pushKey().then(setKey).catch((e) => setError(errText(e)));
    pushStatus().then(setStatus).catch((e) => setError(errText(e)));
  }, [support]);
  const on = !!(status && status.on);
  // 켜기는 누른 동작 안에서 곧바로 권한을 묻는다(enablePush의 첫 await)
  const toggle = (next) => {
    setError(null); setBusy(true);
    (next ? enablePush(key) : disablePush())
      .then((s) => { setStatus(s); if (next) toast(t('push.enabled')); })
      .catch((e) => setError(e && e.code && failKey(e.code) !== 'push.failed' ? t(failKey(e.code)) : t('push.failed', { error: errText(e) })))
      .finally(() => { setPerm(permissionNow()); setBusy(false); });
  };
  const prefs = (p) => { pushPrefs(p).then(setStatus).catch((e) => setError(t('push.failed', { error: errText(e) }))); };
  const test = () => {
    setError(null); setBusy(true);
    pushTest().then((r) => { if (r.ok) toast(t('push.testSent')); else setError(t('push.testFailed', { reason: r.reason || '' })); })
      .catch((e) => setError(t('push.failed', { error: errText(e) }))).finally(() => setBusy(false));
  };
  const line = pushLine({ support, permission: perm, status, busy });
  return (
    <div className="mt-ph-sheet-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mt-ph-sheet" data-role="phone-push-sheet" role="dialog" aria-label={t('push.title')}>
        <div className="mt-ph-sheet-head"><h3>{t('push.title')}</h3><button type="button" className="mt-ph-tip-x" data-action="phone-push-close" aria-label={t('common.close')} onClick={onClose}>×</button></div>
        <p className="mt-ph-push-line" data-role="push-line" data-key={line} data-on={on ? '1' : '0'}>{t(line)}</p>
        {support === 'install' && (
          <ol className="mt-ph-push-steps" data-role="push-install">
            <li>{t('push.step1')}</li><li>{t('push.step2')}</li><li>{t('push.step3')}</li>
          </ol>
        )}
        {support === 'ok' && (
          <>
            <Row role="push-main" label={t('push.receive')} checked={on} disabled={busy || (!on && !key)} onChange={toggle} />
            <div className="mt-ph-label">{t('push.kinds')}</div>
            {PUSH_KINDS.map((k) => (
              <Row key={k} role={`push-kind-${k}`} label={t(`push.kind_${k}`)} checked={!status || status.kinds[k]} disabled={!on || busy} onChange={(v) => prefs({ kinds: { [k]: v } })} />
            ))}
            <SubChoice value={status && status.sub} disabled={!on || busy} onChange={(v) => prefs({ sub: v })} />
            <Row role="push-while-pc" label={t('push.whilePc')} hint={t('push.whilePcHint')} checked={!!(status && status.whilePc)} disabled={!on || busy} onChange={(v) => prefs({ whilePc: v })} />
            <button type="button" className="mt-ph-new wide mt-ph-push-test" data-action="push-test" disabled={!on || busy} onClick={test}>{t('push.test')}</button>
          </>
        )}
        {error && <p className="mt-ph-push-err" role="alert" data-role="push-error">{error}</p>}
        <p className="mt-ph-push-note">{t('push.privacy')}</p>
      </div>
    </div>
  );
}
