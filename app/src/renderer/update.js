// P69 앱 안 업데이트(창 쪽 상태). 백엔드 update.status·update.state를 따라간다.
// - 새 버전이 처음 보이면 토스트를 한 번 띄운다(버전마다 한 번, 이 창 프로필의 localStorage). 설정 › 일반 › 업데이트 묶음과 트레이 메뉴에는 계속 보인다.
// - update.restart가 오면 바꾸는 중으로 둔다. PC 창은 곧 닫히고(새 버전 창이 다시 뜬다), 웹 화면은 "PC에서 업데이트 중" 띠를 보이다가 다시 붙으면 내린다.
// - 바꾸기 결과(lastResult)는 처음 보는 것만 한 번 알린다.
import { useSyncExternalStore } from 'react';
import { api } from './api.js';
import { toast } from './store.js';
import { t, errText, getLanguage } from './lib/i18n.js';
import { macUpdateText } from './lib/update-macos.js';
import { noticesFor, vTag } from './lib/update-notice.js';

const state = { view: null, restarting: null, busy: false };
const subs = new Set();
function changed() { for (const fn of [...subs]) fn(); }
export function useUpdate(select) { return useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => select(state)); }
export const getUpdate = () => state;

const KEY_TOASTED = 'mt.updateToasted', KEY_RESULT = 'mt.updateResultSeen';
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

function put(view) {
  state.view = view;
  if (view && (!view.job || view.job.phase !== 'restarting')) state.restarting = null;
  changed();
  for (const n of noticesFor(view, { toasted: ls.get(KEY_TOASTED), resultSeen: ls.get(KEY_RESULT) })) {
    if (n.kind === 'available') { ls.set(KEY_TOASTED, n.key); toast(t('update.toastAvailable', { version: n.version })); }
    if (n.kind === 'result') { ls.set(KEY_RESULT, n.key); toast(n.ok ? t('update.toastDone', { version: n.to }) : n.recovery === 'restored' ? t('update.toastRolledBack', { version: n.from, error: n.error }) : `${macUpdateText(getLanguage(), n.recovery === 'attention' ? 'recovery' : 'remaining')} ${n.backupBundle || n.error}`, n.ok ? 'info' : 'error'); }
  }
}

api.on('$open', () => { api.call('update.status').then(put).catch(() => {}); }); // 옛 백엔드면 없다(조용히)
api.on('update.state', put);
api.on('update.restart', (d) => { state.restarting = d || {}; changed(); toast(t('update.toastRestarting', { version: (d && d.to && d.to.tag) || '' })); });

async function call(method, params) {
  state.busy = true; changed();
  try { return await api.call(method, params); } catch (e) { toast(t('update.failed', { error: errText(e) }), 'error'); return null; } finally { state.busy = false; changed(); }
}
export const checkNow = () => call('update.check').then((v) => { if (v) { put(v); if (!v.available && !v.error) toast(t('update.upToDate', { version: vTag(v.current.version) })); } });
export const applyUpdate = ({ tag } = {}) => call('update.apply', { confirm: true, ...(tag ? { tag } : {}) });
