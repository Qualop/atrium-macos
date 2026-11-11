// P74: 홈 화면 웹 앱(PWA). 웹 화면(web.js)만 서비스 워커를 등록한다. Electron 창은 쓰지 않는다.
// - 등록은 보안 출처(https, localhost)에서만 된다. 실패해도 화면은 그대로 쓴다(설치만 안 된다)
// - 홈 화면에서 연 앱인지(standalone): iOS는 navigator.standalone, 그 밖은 display-mode 미디어 질의
// - Android Chrome의 설치 제안(beforeinstallprompt)을 잡아 두었다가 휴대폰 화면의 "앱 설치" 단추로 띄운다
export const pwaState = { registered: false, scope: null, error: null, installEvent: null, installed: false };
const subs = new Set();
const changed = () => { for (const fn of [...subs]) fn(pwaState); };
export const onPwa = (fn) => { subs.add(fn); return () => subs.delete(fn); };

export function isStandalone(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return false;
  try { if (win.navigator && win.navigator.standalone === true) return true; } catch {}
  try { return !!(win.matchMedia && (win.matchMedia('(display-mode: standalone)').matches || win.matchMedia('(display-mode: fullscreen)').matches)); } catch { return false; }
}
export const isIOS = (ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);

export async function registerServiceWorker(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav || !('serviceWorker' in nav) || (typeof isSecureContext !== 'undefined' && !isSecureContext)) { pwaState.error = 'unsupported'; changed(); return null; }
  try {
    const reg = await nav.serviceWorker.register('sw.js', { scope: './' });
    pwaState.registered = true; pwaState.scope = reg.scope; pwaState.error = null; changed();
    return reg;
  } catch (e) { pwaState.error = String((e && e.message) || e); changed(); return null; }
}

export function startPwa() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pwaState.installEvent = e; changed(); });
  window.addEventListener('appinstalled', () => { pwaState.installEvent = null; pwaState.installed = true; changed(); });
  const go = () => registerServiceWorker();
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
}
export async function promptInstall() {
  const e = pwaState.installEvent;
  if (!e) return false;
  pwaState.installEvent = null; changed();
  try { await e.prompt(); const c = await e.userChoice; return !!c && c.outcome === 'accepted'; } catch { return false; }
}
