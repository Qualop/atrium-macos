// P74: 원격 웹 화면의 서비스 워커(홈 화면 웹 앱 설치 조건, 껍데기 캐시). build.mjs가 dist/sw.js로 묶는다.
// __SW_VERSION__ = 껍데기 파일 내용의 해시(바뀌면 이 파일의 바이트가 바뀌어 브라우저가 새 서비스 워커를 설치한다),
// __SW_SHELL__ = 설치할 때 미리 받을 껍데기 주소 목록. 무엇을 캐시하는지는 lib/sw-rules.js(시험 있음)가 정한다.
// API·WebSocket·짝 맺기·로그인 응답은 캐시하지 않고 응답하지도 않는다(브라우저가 그대로 백엔드에 묻는다).
/* global __SW_VERSION__, __SW_SHELL__ */
import { swRoute, cacheableResponse, cacheName, staleCaches } from './lib/sw-rules.js';
import { notificationOf, clickUrl } from './lib/push.js'; // P88

const VERSION = __SW_VERSION__;
const SHELL = __SW_SHELL__;
const CACHE = cacheName(VERSION);

self.addEventListener('install', (e) => {
  // 하나라도 못 받으면(원격 막음 등) 설치하지 않는다. 옛 서비스 워커가 그대로 남는다
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload', credentials: 'same-origin' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((names) => Promise.all(staleCaches(names, VERSION).map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});

async function networkFirst(req, key) {
  const c = await caches.open(CACHE);
  try {
    const r = await fetch(req);
    if (cacheableResponse(r)) c.put(key, r.clone()).catch(() => {});
    return r; // 거절 응답(503, 421 …)도 그대로
  } catch (err) {
    const hit = await c.match(key);
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (cacheableResponse(r)) c.put(req, r.clone()).catch(() => {});
  return r;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const route = swRoute({ url: req.url, method: req.method, origin: self.location.origin, mode: req.mode });
  if (route === 'pass') return; // 브라우저가 그대로 네트워크로
  if (route === 'font') { e.respondWith(cacheFirst(req)); return; }
  // 화면 주소(/, /index.html, 쿼리)는 한 열쇠(./)로 둔다
  const key = route === 'shell' && (req.mode === 'navigate' || /\/(index\.html)?$/.test(new URL(req.url).pathname)) ? new Request('./') : req;
  e.respondWith(networkFirst(req, key));
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage({ version: VERSION });
});

// P88: 웹 푸시. 본문은 세션 이름과 종류뿐이다(lib/push.js가 다시 자른다). iOS는 푸시마다 알림을 보여야 하므로 모르는 본문도 앱 이름으로 띄운다
self.addEventListener('push', (e) => {
  let msg = null;
  try { msg = e.data ? e.data.json() : null; } catch { msg = null; }
  const n = notificationOf(msg);
  e.waitUntil(self.registration.showNotification(n.title, n.options));
});
// 누르면 열린 앱 창을 앞으로 가져와 그 세션을 열게 하고(postMessage), 창이 없으면 그 세션 주소로 새로 연다
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((c) => { try { return new URL(c.url).origin === self.location.origin; } catch { return false; } });
    if (w) {
      try { await w.focus(); } catch {}
      if (data.sessionId) w.postMessage({ type: 'atrium-open', sessionId: data.sessionId });
      return;
    }
    await self.clients.openWindow(clickUrl(data, self.registration.scope));
  })());
});
