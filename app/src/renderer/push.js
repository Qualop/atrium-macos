// P88: 웹 화면의 웹 푸시(휴대폰 홈 화면 앱). 웹 화면(isWeb)만 쓴다. 판단과 모양은 lib/push.js(시험 있음).
// - 보이는 상태 알리기: 연결이 열릴 때와 화면이 보이거나 가려질 때 push.visible을 부른다. 백엔드는 보고 있는 기기에 푸시를 보내지 않는다
// - 알림 누르기: 서비스 워커가 열린 창에 atrium-open을 보내거나 ?open=<세션 ID>로 새로 연다. 휴대폰 화면은 setOpenHandler로 그 세션을 연다
// - 켜기·끄기: 권한은 사람이 누른 동작 안에서만 묻는다(iOS). 그래서 VAPID 공개 키는 시트를 열 때 미리 받아 두고, 누르면 곧바로 권한부터 묻는다
import { api } from './api.js';
import { getState } from './store.js';
import { supportOf, keyBytes, openParam, OPEN_PARAM, SID_RE } from './lib/push.js';
import { isIOS, isStandalone } from './lib/pwa.js';
import { getLanguage, onLanguage } from './lib/i18n.js';

let openFn = null;
export function setOpenHandler(fn) { openFn = fn; return () => { if (openFn === fn) openFn = null; }; }
function openSession(id) {
  if (openFn) return openFn(id);
  const st = getState(); if (st.navigateTo && st.sessions.has(id)) st.navigateTo(id, { focusTerminal: true });
  return undefined;
}
export const pushLog = []; // 시험이 읽는다(글 없음)

export function startPushClient() {
  if (typeof document === 'undefined') return;
  const report = () => { const visible = document.visibilityState === 'visible'; pushLog.push({ at: Date.now(), visible }); if (pushLog.length > 50) pushLog.shift(); api.call('push.visible', { visible }).catch(() => {}); };
  api.on('$open', report);
  document.addEventListener('visibilitychange', report);
  onLanguage((l) => { api.call('push.prefs', { lang: l }).catch(() => {}); }); // 화면 말을 바꾸면 알림 글의 말도
  try {
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (e) => { const d = e.data; if (d && d.type === 'atrium-open' && SID_RE.test(String(d.sessionId || ''))) openSession(d.sessionId); });
  } catch {}
}

// 알림을 눌러 새로 연 주소의 세션(한 번만 쓴다)
export const launchOpen = () => (typeof location !== 'undefined' ? openParam(location.search) : null);
export function clearLaunchOpen() {
  try { const u = new URL(location.href); if (!u.searchParams.has(OPEN_PARAM)) return; u.searchParams.delete(OPEN_PARAM); history.replaceState(history.state, '', `${u.pathname}${u.search}${u.hash}`); } catch {}
}

export const pushSupportNow = () => supportOf(typeof window !== 'undefined' ? window : null, { ios: isIOS(), standalone: isStandalone() });
export const permissionNow = () => { try { return Notification.permission; } catch { return 'default'; } };

const fail = (code, cause) => Object.assign(new Error((cause && cause.message) || code), { code });
const withTimeout = (p, ms, code) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(fail(code)), ms))]);
const sameKey = (buf, key) => { try { const a = new Uint8Array(buf); const b = keyBytes(key); return a.length === b.length && a.every((x, i) => x === b[i]); } catch { return false; } };

// 켜기. key = 미리 받은 VAPID 공개 키. 첫 await가 권한 묻기여야 iOS가 사람이 누른 동작으로 본다
export async function enablePush(key) {
  if (!key) throw fail('no_key');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw fail('denied');
  const reg = await withTimeout(navigator.serviceWorker.ready, 8000, 'subscribe');
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options && sub.options.applicationServerKey, key)) { await sub.unsubscribe().catch(() => {}); sub = null; } // 다른 판의 키로 만든 구독
  if (!sub) { try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }); } catch (e) { throw fail('subscribe', e); } }
  return api.call('push.subscribe', { subscription: sub.toJSON(), lang: getLanguage() });
}
export async function disablePush() {
  try { const reg = await withTimeout(navigator.serviceWorker.ready, 3000, 'subscribe'); const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch {}
  return api.call('push.unsubscribe');
}
export const pushStatus = () => api.call('push.status');
export const pushKey = () => api.call('push.key').then((r) => r.publicKey);
export const pushPrefs = (p) => api.call('push.prefs', { ...p, lang: getLanguage() });
export const pushTest = () => api.call('push.test');
