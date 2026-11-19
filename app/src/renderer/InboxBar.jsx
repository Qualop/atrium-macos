// "내 차례"(ARCH 4절 A1, BRIEF 4절): 내 답이 필요한 세션을 모든 프로젝트를 가로질러 오래 기다린 순서로 보여준다.
// 칩을 누르거나 N을 누르면 노드를 옮기지 않고 화면이 그 세션으로 간다. 검토 대기와 문제도 따로 센다.
// P3: 자원(D1), 터미널 서버가 꺼졌을 때 켜기(C3), 그룹 만들기, 바뀐 것(A3)
// P4: 다른 곳의 세션(E1·E3) 칩을 뺐다. 연결 수를 보인다
// P5: 칩은 모든 워크스페이스를 가로지른다. 칩에 워크스페이스 이름을 붙이고, 누르면 그 워크스페이스로 바꾸고 노드로 간다(G4)
// P11: 위쪽 줄(.mt-top)은 없앴다. 그 일은 캔버스 위에 떠 있는 알약 묶음(Chrome.jsx TopLeft·TopRight)으로 옮겼다. 이 파일에는 내 차례 계산과 경고 띠만 남는다
import { useEffect, useState } from 'react';
import { useStore, openDialog, toast } from './store.js';
import { api } from './api.js';
import { inboxOf } from './lib/faces.js';
import { useT, errText } from './lib/i18n.js';
import { migrationDone, migrationWaiting } from './lib/migration.js'; // P129

export function useInbox() {
  const sessions = useStore((st) => st.sessions);
  return inboxOf([...sessions.values()]);
}

// 터미널 서버 띠와 옛 판 옮기기 띠(P11: 캔버스 위 가운데에 떠 있는 띠)
export function Warnings() {
  const t = useT();
  const term = useStore((st) => st.terminal);
  const migration = useStore((st) => st.migration);
  const conn = useStore((st) => st.conn);
  const out = [];
  if (conn === 'open') {
    if (migration) out.push(<MigrationBand key="migrate" m={migration} />);
    out.push(...terminalBands(term, t));
    const blocked = term.missing || term.level === 'missing' || term.level === 'incompatible'; // P40: 켜기 단추로 풀리지 않는다
    if (term.connected === false && !blocked) out.push(<div key="term-down" className="mt-warnbar bad" data-role="terminal-down">{t('warn.terminalDown', { button: t('top.terminalStart') })}</div>);
  }
  return out.length ? <div className="mt-warns">{out}</div> : null;
}

// P117: herdr-core 다시 받기·시작(판의 terminal.start가 서버를 다시 띄운다)
function HcRetry({ t }) {
  const [busy, setBusy] = useState(false);
  const again = async () => {
    setBusy(true);
    try { const r = await api.call('terminal.start'); if (!r || r.connected !== false) toast(t('terminalMove.hcBand.ok')); else toast(t('terminalMove.hcBand.title'), 'error'); } catch (e) { toast(errText(e), 'error'); }
    setBusy(false);
  };
  return <span className="mt-warnbar-actions"><button type="button" className="mt-btn small primary" data-action="hc-retry" disabled={busy} onClick={again}>{busy ? t('terminalMove.hcBand.retrying') : t('terminalMove.hcBand.retry')}</button></span>;
}
// 터미널 서버(hc) 띠: 받기·시작 실패(빨강, 다시 시도)와 호환되지 않는 버전(빨강)
export function terminalBands(h, t) {
  const out = [];
  if (h.missing || h.level === 'missing') {
    out.push(
      <div key="hc-missing" className="mt-warnbar bad mt-term-band" data-role="hc-missing">
        <div className="mt-term-band-head"><b>{t('terminalMove.hcBand.title')}</b> {t('terminalMove.hcBand.why', { error: (h.missing && (h.missing.error || h.missing.reason)) || (h.problems || []).join('; ') })}</div>
        <HcRetry t={t} />
      </div>,
    );
  } else if (h.level === 'incompatible') {
    out.push(
      <div key="hc-incompatible" className="mt-warnbar bad mt-term-band" data-role="hc-incompatible">
        <div className="mt-term-band-head"><b>{t('top.terminalIncompatible')}</b> {(h.problems || []).join('; ')}</div>
        <HcRetry t={t} />
      </div>,
    );
  }
  return out;
}

// P129: 옛 판(herdr)을 herdr-core로 옮기는 진행 띠. 옮기는 동안 몇 개를 옮겼는지와 기다리는 세션을 보이고,
// 끝나면(done) 잠깐 옮긴 수를 보인 뒤 사라진다. 실패(failed)는 까닭과 함께 남고 닫을 수 있다. 자세한 줄은 설정 › 터미널
const DONE_SHOW_MS = 8000;
function MigrationBand({ m }) {
  const t = useT();
  const key = m && `${m.startedAt}:${m.state}`;
  const [hidden, setHidden] = useState(null);
  const [, tick] = useState(0);
  const doneLeft = m && m.state === 'done' ? DONE_SHOW_MS - (Date.now() - (m.endedAt || 0)) : 0;
  useEffect(() => {
    if (!(doneLeft > 0)) return undefined;
    const id = setTimeout(() => tick((n) => n + 1), doneLeft + 50);
    return () => clearTimeout(id);
  }, [key, doneLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m || hidden === key) return null;
  if (m.state === 'done' && !(doneLeft > 0)) return null;
  const details = <button type="button" className="mt-btn small ghost" data-action="migrate-details" onClick={() => openDialog({ kind: 'settings', tab: 'terminal' })}>{t('terminalMigrate.band.details')}</button>;
  if (m.state === 'failed') {
    return (
      <div className="mt-warnbar bad mt-term-band" data-role="terminal-migrate" data-state={m.state}>
        <div className="mt-term-band-head">{t('terminalMigrate.band.failed', { error: m.error ? errText(m.error) : t('common.unknown') })}</div>
        <span className="mt-warnbar-actions">{details}<button type="button" className="mt-btn small ghost" data-action="migrate-hide" onClick={() => setHidden(key)}>{t('common.close')}</button></span>
      </div>
    );
  }
  if (m.state === 'done') {
    return <div className="mt-warnbar mt-term-band" data-role="terminal-migrate" data-state={m.state}><div className="mt-term-band-head">{t('terminalMigrate.band.done', { n: migrationDone(m) })}</div></div>;
  }
  const waiting = migrationWaiting(m, t);
  const head = m.state === 'preparing' ? t('terminalMigrate.band.preparing') : t('terminalMigrate.band.moving', { done: migrationDone(m), total: m.total || 0 });
  return (
    <div className="mt-warnbar mt-term-band" data-role="terminal-migrate" data-state={m.state}>
      <div className="mt-term-band-head">
        {head}
        {waiting.length > 0 && <> · {t('terminalMigrate.band.waiting', { list: waiting.join(', ') })}</>}
        {m.failed > 0 && <> · {t('terminalMigrate.band.failedSome', { n: m.failed })}</>}
      </div>
      <span className="mt-warnbar-actions">{details}</span>
    </div>
  );
}
