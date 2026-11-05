// "내 차례"(ARCH 4절 A1, BRIEF 4절): 내 답이 필요한 세션을 모든 프로젝트를 가로질러 오래 기다린 순서로 보여준다.
// 칩을 누르거나 N을 누르면 노드를 옮기지 않고 화면이 그 세션으로 간다. 검토 대기와 문제도 따로 센다.
// P3: 자원(D1), herdr가 꺼졌을 때 켜기(C3), 다른 화면이 붙었다는 경고(D3), 그룹 만들기, 바뀐 것(A3)
// P4: 다른 곳의 세션(E1·E3) 칩을 뺐다. 연결 수를 보인다
// P5: 칩은 모든 워크스페이스를 가로지른다. 칩에 워크스페이스 이름을 붙이고, 누르면 그 워크스페이스로 바꾸고 노드로 간다(G4)
// P11: 위쪽 줄(.mt-top)은 없앴다. 그 일은 캔버스 위에 떠 있는 알약 묶음(Chrome.jsx TopLeft·TopRight)으로 옮겼다. 이 파일에는 내 차례 계산과 경고 띠만 남는다
import { useState } from 'react';
import { useStore, openDialog, toast } from './store.js';
import { api } from './api.js';
import { inboxOf } from './lib/faces.js';
import { useT, errText } from './lib/i18n.js';

export function useInbox() {
  const sessions = useStore((st) => st.sessions);
  return inboxOf([...sessions.values()]);
}

// D3 경고와 herdr가 꺼졌다는 알림(P11: 캔버스 위 가운데에 떠 있는 띠)
export function Warnings() {
  const t = useT();
  const clients = useStore((st) => st.clients);
  const herdr = useStore((st) => st.herdr);
  const conn = useStore((st) => st.conn);
  const [hidden, setHidden] = useState(() => new Set()); // P40: 닫은 노란 띠(이 창이 열려 있는 동안)
  const hide = (k) => setHidden((s) => new Set([...s, k]));
  const out = [];
  if (clients && clients.attached) {
    const parts = [...clients.viaLog.map((c) => t('warn.client', { id: c.clientId })), ...clients.viaProcess.map((p) => `pid ${p.pid}`)];
    out.push(<div key="d3" className="mt-warnbar" data-role="d3-warning">{t('warn.clients', { session: clients.session, list: parts.join(', ') })}</div>);
  }
  const blocked = herdr.missing || herdr.level === 'missing' || herdr.level === 'incompatible'; // P40: 켜기 단추로 풀리지 않는다
  if (conn === 'open') out.push(...herdrBands(herdr, t, hidden, hide));
  if (conn === 'open' && herdr.connected === false && !blocked) out.push(<div key="herdr" className="mt-warnbar bad" data-role="herdr-down">{t('warn.herdrDown', { button: t('top.herdrStart') })}</div>);
  return out.length ? <div className="mt-warns">{out}</div> : null;
}

// P40: herdr 띠. 못 찾음과 다른 프로토콜(빨강, 세션 띄우기가 막힘), 검증하지 않은 버전과 새 버전 설치됨(노랑, 닫을 수 있음)
const HERDR_SITE = 'https://herdr.dev';
function HerdrActions({ t }) {
  const [busy, setBusy] = useState(false);
  const again = async () => {
    setBusy(true);
    try {
      const r = await api.call('herdr.rediscover');
      if (r && r.connected) toast(t('warn.herdrFound', { path: r.path || '' }));
      else toast(t('warn.herdrStillMissing'), 'error');
    } catch (e) { toast(errText(e), 'error'); }
    setBusy(false);
  };
  return (
    <span className="mt-warnbar-actions">
      <a className="mt-btn small ghost" href={HERDR_SITE} target="_blank" rel="noreferrer" data-action="herdr-install">{t('warn.herdrInstall')}</a>
      <button type="button" className="mt-btn small ghost" data-action="herdr-settings" onClick={() => openDialog({ kind: 'settings' })}>{t('warn.herdrSetPath')}</button>
      <button type="button" className="mt-btn small primary" data-action="herdr-rediscover" disabled={busy} onClick={again}>{busy ? t('warn.herdrSearching') : t('warn.herdrRediscover')}</button>
    </span>
  );
}
const SOURCE_KEY = { env: 'ATRIUM_HERDR', setting: 'setting', installer: 'installer', path: 'PATH', known: 'known' };
export function herdrBands(h, t, hidden = new Set(), hide = () => {}) {
  const out = [];
  if (h.missing || h.level === 'missing') {
    const tried = (h.find && h.find.tried) || [];
    const failed = h.missing && h.missing.reason && h.missing.reason !== 'not_found';
    out.push(
      <div key="herdr-missing" className="mt-warnbar bad mt-herdr-band" data-role="herdr-missing">
        <div className="mt-herdr-head"><b>{t('warn.herdrMissing')}</b> {failed ? t('warn.herdrStartFailed', { path: h.missing.path || '', error: h.missing.error || h.missing.reason }) : t('warn.herdrMissingWhy')}</div>
        {tried.length > 0 && (
          <details className="mt-herdr-tried" data-role="herdr-tried">
            <summary>{t('warn.herdrTried', { n: tried.length })}</summary>
            <ul>{tried.map((x, i) => <li key={i}><span className="dim">{t(`warn.herdrSource.${SOURCE_KEY[x.source] ? x.source : 'known'}`)}</span> <span className="mono">{x.path}</span> <span className="dim">{t(`warn.herdrErr.${x.ok ? 'ok' : x.error || 'not_found'}`, { version: x.version || '' })}</span></li>)}</ul>
          </details>
        )}
        <HerdrActions t={t} />
      </div>,
    );
    return out;
  }
  if (h.level === 'incompatible') {
    out.push(
      <div key="herdr-incompatible" className="mt-warnbar bad mt-herdr-band" data-role="herdr-incompatible">
        <div className="mt-herdr-head"><b>{t('warn.herdrIncompatible', { version: h.version || '?', protocol: h.protocol ?? '?' })}</b> {t('warn.herdrIncompatibleWhy', { supported: (h.protocols || []).join(', ') })}</div>
        <HerdrActions t={t} />
      </div>,
    );
  }
  const untestedKey = `untested:${h.version}`;
  if (h.level === 'untested' && !hidden.has(untestedKey)) {
    out.push(
      <div key="herdr-untested" className="mt-warnbar mt-herdr-band" data-role="herdr-untested">
        <div className="mt-herdr-head">{t('warn.herdrUntested', { version: h.version || '?', protocol: h.protocol ?? '?', tested: (h.tested || []).join(', ') })}</div>
        <span className="mt-warnbar-actions"><button type="button" className="mt-btn small ghost" data-action="herdr-untested-hide" onClick={() => hide(untestedKey)}>{t('common.close')}</button></span>
      </div>,
    );
  }
  const updateKey = h.update ? `update:${h.update.version}` : null;
  if (h.update && !hidden.has(updateKey)) {
    out.push(
      <div key="herdr-update" className="mt-warnbar mt-herdr-band" data-role="herdr-update">
        <div className="mt-herdr-head">{t('warn.herdrUpdate', { version: h.update.version, server: h.update.serverVersion })}</div>
        <span className="mt-warnbar-actions"><button type="button" className="mt-btn small ghost" data-action="herdr-update-hide" onClick={() => hide(updateKey)}>{t('common.close')}</button></span>
      </div>,
    );
  }
  return out;
}
