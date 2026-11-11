// P88: 웹 푸시의 순수 함수(단위 시험 app/test/p88-lib.test.mjs). 서비스 워커(sw.js)와 휴대폰 알림 시트(PhonePush.jsx)가 쓴다.
// - 지원 판단: 서비스 워커, PushManager, Notification, 보안 출처가 있어야 한다. iOS는 홈 화면에 추가한 앱(standalone, iOS 16.4+)에서만 된다
// - 알림 만들기: 백엔드가 보낸 본문(세션 이름과 종류만)을 다시 자르고, 모르는 모양이면 앱 이름만 보인다(iOS는 푸시마다 알림을 보여야 한다)
// - 누르면: 그 세션 주소(?open=<세션 ID>)로 연다

export const SID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
export const OPEN_PARAM = 'open';
export const PUSH_ICON = 'assets/brand/atrium-icon.svg';
export const PUSH_KINDS = ['done', 'need', 'error']; // 백엔드 web-push.mjs와 같다(예기치 않은 끝남은 error를 따른다)
export const SUB_MODES = ['need', 'all', 'off']; // P92: 하위 세션(워커) 알림. 백엔드 push-cycle.mjs와 같다(기본 need)
export const subModeOf = (v) => (SUB_MODES.includes(v) ? v : 'need');
// P92: 이 세션의 알림을 이 기기에서 껐는가(status.muted)
export const isMuted = (status, sessionId) => !!(status && Array.isArray(status.muted) && status.muted.includes(sessionId));

// 'ok' | 'install'(iOS인데 홈 화면 앱이 아님) | 'insecure'(https가 아님) | 'unsupported'
export function pushSupport({ hasSW, hasPush, hasNotification, secure, ios, standalone }) {
  if (ios && !standalone) return 'install'; // iOS Safari 탭에는 PushManager가 없다. 홈 화면 앱에서만 된다
  if (!secure) return 'insecure';
  if (!hasSW || !hasPush || !hasNotification) return 'unsupported';
  return 'ok';
}
export function supportOf(win = typeof window !== 'undefined' ? window : null, { ios = false, standalone = false } = {}) {
  if (!win) return 'unsupported';
  const nav = win.navigator || {};
  return pushSupport({ hasSW: 'serviceWorker' in nav, hasPush: 'PushManager' in win, hasNotification: 'Notification' in win, secure: win.isSecureContext !== false, ios, standalone });
}

// VAPID 공개 키(base64url) → applicationServerKey
export function keyBytes(b64u) {
  const s = String(b64u || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = typeof atob === 'function' ? atob(pad) : Buffer.from(pad, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// 푸시 본문(JSON) → showNotification 인자
export function notificationOf(msg) {
  const ok = msg && typeof msg === 'object' && msg.v === 1;
  const sid = ok && SID_RE.test(String(msg.sessionId || '')) ? String(msg.sessionId) : null;
  const tag = ok && /^[A-Za-z0-9_.:-]{1,100}$/.test(String(msg.tag || '')) ? String(msg.tag) : 'atrium';
  return {
    title: (ok && clip(msg.title, 120)) || 'Atrium',
    options: { body: ok ? clip(msg.body, 240) : '', tag, icon: PUSH_ICON, data: { sessionId: sid, kind: ok ? clip(msg.kind, 20) : null } },
  };
}
// 알림을 눌렀을 때 열 주소. scope = 서비스 워커 범위(끝이 /)
export function clickUrl(data, scope) {
  const sid = data && SID_RE.test(String(data.sessionId || '')) ? String(data.sessionId) : null;
  return sid ? `${scope}?${OPEN_PARAM}=${encodeURIComponent(sid)}` : scope;
}
// 시작 주소의 ?open= → 세션 ID
export function openParam(search) {
  try { const v = new URLSearchParams(String(search || '')).get(OPEN_PARAM); return v && SID_RE.test(v) ? v : null; } catch { return null; }
}
// 시트에 보일 상태 한 줄의 사전 열쇠
export function pushLine({ support, permission, status, busy }) {
  if (support !== 'ok') return `push.support_${support}`;
  if (busy) return 'push.busy';
  if (permission === 'denied') return 'push.denied';
  if (status && status.on) return 'push.on';
  if (status && status.gone) return 'push.gone';
  return 'push.off';
}
export const failKey = (code) => ({ denied: 'push.denied', bad_endpoint: 'push.failEndpoint', subscribe: 'push.failSubscribe', not_subscribed: 'push.off' }[code] || 'push.failed');
