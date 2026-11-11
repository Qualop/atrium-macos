// P49(원격 R3): 웹 화면 위쪽의 "다시 연결 중" 띠와 구석의 왕복 지연(ms).
// 연결 상태는 api.js(lib/reconnect.js)가 $conn으로, 지연은 $rtt로 알린다. PC 창에는 띄우지 않는다(연결 알약이 있다)
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useT } from './lib/i18n.js';
import { showBanner } from './lib/reconnect.js';
import { UpdateBanner } from './Update.jsx'; // P69: PC에서 업데이트 중
import { useUpdate } from './update.js';
import { useConnSteady } from './steady.js'; // P82

export function RemoteBar() {
  const t = useT();
  const { conn, shown, grace } = useConnSteady(); // P82: 짧은 끊김(2초 안에 다시 붙음)에는 띠를 띄우지 않는다
  const [rtt, setRtt] = useState(api.rtt);
  const updating = useUpdate((s) => !!s.restarting); // P69: 업데이트로 끊긴 동안은 다시 연결 띠 대신 업데이트 띠
  useEffect(() => {
    const b = api.on('$rtt', (r) => setRtt(r.rtt));
    return () => { b(); };
  }, []);
  return (
    <>
      {conn.phase === 'blocked' && ( // P58: PC에서 원격 받기를 껐다. 백오프로 계속 다시 붙어 보고, 켜지면 저절로 돌아온다
        <div className="mt-blocked" role="alert" data-role="remote-blocked">
          <div className="mt-blocked-card">
            <h3>{t('remoteAccess.blockedTitle')}</h3>
            <p>{t('remoteAccess.blockedBody')}</p>
            <button type="button" className="mt-btn small" data-action="reconnect-now" onClick={() => api.wake()}>{t('remote.retryNow')}</button>
          </div>
        </div>
      )}
      <UpdateBanner />
      {showBanner(conn) && shown && !updating && (
        <div className="mt-reconnect" role="status" data-role="reconnect-banner" data-close={conn.lastClose ?? ''}>
          <span className="mt-reconnect-dot" />
          <span>{conn.lastClose === 4402 ? t('remoteAccess.kicked') : t('remote.reconnecting')}</span>
          <button type="button" className="mt-btn small ghost" data-action="reconnect-now" onClick={() => api.wake()}>{t('remote.retryNow')}</button>
        </div>
      )}
      {rtt != null && (conn.phase === 'open' || grace) && <div className="mt-rtt" title={t('remote.rttTitle')} data-role="rtt">{t('remote.rtt', { ms: rtt })}</div>}
    </>
  );
}
