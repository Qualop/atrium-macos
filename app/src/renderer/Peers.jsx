// P47(원격 R1): 위쪽 알약 줄의 "다른 기기 n". 이 백엔드에 붙은 다른 창·웹 클라이언트가 있을 때만 보인다.
// 올리면 기기마다 이름, 종류, 마지막으로 쓴 때와 알림이 어느 기기에 뜨는지 보인다.
// P58(S4): 누르면 목록이 펼쳐지고, PC 창에서는 짝 맺은 기기마다 "끊기"(지금 연결만 닫음, 다시 붙을 수 있음)와 "짝 풀기"(확인 뒤 짝을 풀고 닫음)가 있다.
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, toast } from './store.js';
import { useT, errText } from './lib/i18n.js';
import { agoText } from './lib/labels.js';
import { otherDevices } from './lib/multiclient.js';
import { isDeviceClient } from './lib/remote.js';
import { isWeb } from './web.js';

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [open]);
  return [open, setOpen, ref];
}

// 짝 풀기 확인(창 가운데)
function UnpairConfirm({ client, onClose }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await api.call('device.revoke', { id: client.deviceId }); toast(t('peers.unpaired', { name: client.name || client.clientId })); onClose(true); }
    catch (e) { toast(t('webDevices.failed', { error: errText(e) }), 'error'); setBusy(false); }
  };
  return (
    <div className="mt-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose(false)}>
      <div className="mt-modal" data-role="unpair-dialog">
        <h3>{t('peers.unpairTitle', { name: client.name || client.clientId })}</h3>
        <div>{t('peers.unpairBody')}</div>
        <div className="mt-card-actions">
          <button className="mt-btn danger" disabled={busy} data-action="unpair-confirm" onClick={go}>{t('peers.unpair')}</button>
          <button className="mt-btn ghost" disabled={busy} data-action="unpair-cancel" onClick={() => onClose(false)}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

export function DevicesPill() {
  const t = useT();
  const peers = useStore((st) => st.peers);
  const [open, setOpen, ref] = useDropdown();
  const [confirm, setConfirm] = useState(null);
  const others = otherDevices(peers);
  if (!others.length) return null;
  const notifyName = peers.notify === peers.me ? null : ((peers.clients.find((c) => c.clientId === peers.notify) || {}).name || peers.notify);
  const kindText = (c) => t(`peers.kind_${c.kind === 'web' ? 'web' : 'desktop'}`) + (c.remote ? ` · ${t('peers.remote')}` : '');
  const activeText = (c) => (c.lastInputAt ? t('peers.active', { time: agoText(c.lastInputAt) }) : t('peers.idle'));
  const notifyLine = peers.notify ? (notifyName ? t('peers.notifyThere', { name: notifyName }) : t('peers.notifyHere')) : null;
  const title = [t('peers.title'), ...others.map((c) => `${t('peers.row', { name: c.name || c.clientId, kind: kindText(c) })} · ${activeText(c)}`), notifyLine].filter(Boolean).join('\n');
  const kick = async (c) => {
    try { const r = await api.call('device.disconnect', { id: c.deviceId }); toast(t('peers.kicked', { name: c.name || c.clientId, n: r.closed })); }
    catch (e) { toast(t('webDevices.failed', { error: errText(e) }), 'error'); }
  };
  return (
    <div className="mt-drop" ref={ref}>
      <button type="button" className={`mt-cp mt-peers${open ? ' on' : ''}`} data-role="peers" data-n={others.length} data-notify={peers.notify || ''} title={open ? undefined : title} onClick={() => setOpen((o) => !o)}>
        <span className="mt-peers-dot" />
        {t('peers.pill', { n: others.length })}
      </button>
      {open && (
        <div className="mt-dropdown mt-peers-list" data-role="peers-list">
          <div className="mt-dropdown-head"><span>{t('peers.title')}</span></div>
          {others.map((c) => (
            <div key={c.clientId} className="mt-peer-row" data-client={c.clientId} data-device={c.deviceId || ''}>
              <div className="mt-peer-text">
                <b>{c.name || c.clientId}</b>
                <span className="dim">{kindText(c)} · {activeText(c)}</span>
              </div>
              {!isWeb && isDeviceClient(c) && (
                <div className="mt-peer-actions">
                  <button type="button" className="mt-btn small" data-action="peer-kick" title={t('peers.kickHint')} onClick={() => kick(c)}>{t('peers.kick')}</button>
                  <button type="button" className="mt-btn small danger" data-action="peer-unpair" title={t('peers.unpairHint')} onClick={() => setConfirm(c)}>{t('peers.unpair')}</button>
                </div>
              )}
            </div>
          ))}
          {notifyLine && <div className="mt-dropdown-empty" data-role="peers-notify">{notifyLine}</div>}
          {confirm && <UnpairConfirm client={confirm} onClose={(done) => { setConfirm(null); if (done) setOpen(false); }} />}
        </div>
      )}
    </div>
  );
}
