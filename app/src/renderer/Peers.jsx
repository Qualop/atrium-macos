// P47(원격 R1): 위쪽 알약 줄의 "다른 기기 n". 이 백엔드에 붙은 다른 창·웹 클라이언트가 있을 때만 보인다.
// 올리면 기기마다 이름, 종류, 마지막으로 쓴 때와 알림이 어느 기기에 뜨는지 보인다.
import { useStore } from './store.js';
import { useT } from './lib/i18n.js';
import { agoText } from './lib/labels.js';
import { otherDevices } from './lib/multiclient.js';

export function DevicesPill() {
  const t = useT();
  const peers = useStore((st) => st.peers);
  const others = otherDevices(peers);
  if (!others.length) return null;
  const notifyName = peers.notify === peers.me ? null : ((peers.clients.find((c) => c.clientId === peers.notify) || {}).name || peers.notify);
  const title = [
    t('peers.title'),
    ...others.map((c) => `${t('peers.row', { name: c.name || c.clientId, kind: t(`peers.kind_${c.kind === 'web' ? 'web' : 'desktop'}`) })} · ${c.lastInputAt ? t('peers.active', { time: agoText(c.lastInputAt) }) : t('peers.idle')}`),
    peers.notify ? (notifyName ? t('peers.notifyThere', { name: notifyName }) : t('peers.notifyHere')) : null,
  ].filter(Boolean).join('\n');
  return (
    <span className="mt-cp mt-peers" data-role="peers" data-n={others.length} data-notify={peers.notify || ''} title={title}>
      <span className="mt-peers-dot" />
      {t('peers.pill', { n: others.length })}
    </span>
  );
}
