// P58(원격 강화 S4): 원격 기기가 새로 붙거나 짝을 맺으면(백엔드 remote.connected, PC 창에만 온다) 토스트를 띄우고,
// 창이 숨었거나 초점이 없으면 OS 알림도 띄운다. 창의 실제 상태(보임, 내려 둠, 초점)는 main이 보고 정한다(mt:notify의 ifHidden, lib/remote.js noticeWay).
// 다시 연결을 다시 알리지 않는 판단은 백엔드(remote-log.mjs ConnectWatch)가 한다. 창이 없으면 트레이가 OS 알림을 띄운다(main/tray.mjs).
import { api } from './api.js';
import { toast } from './store.js';
import { t } from './lib/i18n.js';
import { noticeOf } from './lib/remote.js';

export const remoteNotices = []; // 시험이 읽는다

export function startRemoteNotice() {
  api.on('remote.connected', (ev) => {
    const n = noticeOf(ev);
    if (!n) return;
    const text = t(n.key, n.vars);
    const rec = { at: Date.now(), kind: ev.kind, device: ev.device && ev.device.id, text, os: null };
    remoteNotices.push(rec); if (remoteNotices.length > 50) remoteNotices.shift();
    toast(n.detail ? `${text} (${n.detail})` : text);
    if (!window.mt || !window.mt.notify) return;
    window.mt.notify({ sessionId: null, key: `remote|${ev.device && ev.device.id}|${ev.at}`, title: text, body: n.detail || t('remoteNotice.body'), ifHidden: true })
      .then((x) => { rec.os = !!(x && x.shown); rec.result = x; }).catch((e) => { rec.os = false; rec.result = { shown: false, reason: e.message }; });
  });
}
