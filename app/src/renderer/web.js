// P48(원격 R2) 웹 어댑터: 창이 Electron 밖(브라우저)에서 돌면 preload의 window.mt 대신 이것을 쓴다. Electron 창은 preload가 먼저 window.mt를 두므로 그대로다.
// - backend: 같은 출처의 WebSocket(/api?device=…)과 이 브라우저에 저장한 기기 토큰. 토큰이 없거나 끊겼으면(401) 짝 맺기 화면으로 다시 연다
// - log: 콘솔. metrics: 빈 목록. notify: Web Notifications(처음 누를 때 권한을 묻는다). onNavigate: 알림을 누르면 그 세션으로
// - pickFolder: PC 폴더 탐색기(FolderPicker.jsx, 백엔드 fs.roots·fs.list)
// - 업로드: 붙여 넣거나 끌어 놓은 파일을 POST /web/upload로 올리고 PC 경로를 받는다(TerminalView, CommandBar)
import { openFolderPicker } from './FolderPicker.jsx';
import { hasFiles } from './lib/upload.js';
import { webZoomOf } from './lib/scale.js'; // P49

export const isWeb = typeof window !== 'undefined' && !window.mt;
const TOKEN_KEY = 'atrium.deviceToken';
export function deviceToken() { try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; } }
export function saveDeviceToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch {} }
export function clearDeviceToken() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }
const auth = () => ({ authorization: `Bearer ${deviceToken() || ''}` });

// 기기 정보(백엔드가 내주는 창의 시작 값). 401이면 null(짝 맺기 필요)
export async function webMe() {
  if (!deviceToken()) return null;
  const r = await fetch('/web/me', { headers: auth(), cache: 'no-store' });
  if (r.status === 401) { clearDeviceToken(); return null; }
  if (!r.ok) { const body = await r.json().catch(() => null); throw Object.assign(new Error(body?.error?.message || `backend ${r.status}`), { code: body?.error?.code }); }
  return r.json();
}

let paired = false; // 이 페이지가 짝을 맺은 채로 시작했는지. 그 뒤에 끊기면 짝 맺기 화면으로 다시 연다
async function backend() {
  const me = await webMe();
  if (!me) { if (paired) location.reload(); throw Object.assign(new Error('this browser is not paired'), { code: 'not_paired' }); }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // P49: 웹 화면도 클라이언트다(P47). api.js가 client·name·kind=web을 연결 주소에 붙인다
  return { ...me, token: deviceToken(), web: true, clientKind: 'web', deviceName: (me.device && me.device.name) || null, wsUrl: `${proto}://${location.host}/api?device=${encodeURIComponent(deviceToken())}` };
}
export function markPaired() { paired = true; }

// 알림
const navFns = new Set();
export const webNotes = []; // 시험이 읽는다
function askPermission() { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); } catch {} }
async function notify(n) {
  if (!('Notification' in window)) return { shown: false, reason: 'unsupported' };
  if (Notification.permission !== 'granted') return { shown: false, reason: `permission ${Notification.permission}` };
  const note = new Notification(String(n.title || 'Atrium').slice(0, 120), { body: String(n.body || '').slice(0, 240), tag: n.key, icon: 'assets/brand/atrium-icon.svg' });
  const rec = { sessionId: n.sessionId, key: n.key, at: Date.now(), clicked: false, note };
  note.onclick = () => { rec.clicked = true; try { window.focus(); } catch {} note.close(); for (const fn of [...navFns]) fn(n.sessionId); };
  webNotes.push(rec); if (webNotes.length > 50) webNotes.shift();
  return { shown: true };
}

// P49: 화면 배율. 뿌리 요소의 CSS zoom(Chromium 128부터 표준 zoom이라 마우스 좌표와 요소 크기가 함께 맞는다). 범위는 P45와 같은 70~150%
function applyWebZoom(f) { try { const z = webZoomOf(f); document.documentElement.style.zoom = z === 1 ? '' : String(z); } catch {} }

// 업로드: 파일마다 PC 경로
export async function uploadFiles(files) {
  const out = [];
  for (const f of files) {
    const r = await fetch(`/web/upload?name=${encodeURIComponent(f.name || '')}`, { method: 'POST', headers: { ...auth(), 'content-type': f.type || 'application/octet-stream' }, body: f });
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error((j && j.error && j.error.message) || `upload failed (${r.status})`);
    out.push(j.path);
  }
  return out;
}

if (isWeb) {
  window.mt = {
    web: true,
    backend,
    metrics: async () => [],
    log: (line) => { try { console.info('[atrium]', String(line).slice(0, 2000)); } catch {} },
    notify,
    pickFolder: () => openFolderPicker(),
    onNavigate: (fn) => { navFns.add(fn); return () => navFns.delete(fn); },
    setZoom: (f) => applyWebZoom(f), // P49: 화면 배율(P45)을 웹에서도. Electron은 webFrame, 웹은 CSS zoom
  };
  try { applyWebZoom(localStorage.getItem('mt.uiScale')); } catch {}
  window.__mtWeb = { notes: webNotes };
  // 알림 권한은 사용자가 처음 누를 때 묻는다(브라우저는 몸짓 없이 묻는 것을 막는다)
  window.addEventListener('pointerdown', askPermission, { once: true, capture: true });
  // 판 밖에 파일을 놓아도 브라우저가 그 파일로 넘어가지 않게
  window.addEventListener('dragover', (e) => { if (hasFiles(e.dataTransfer)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (hasFiles(e.dataTransfer)) e.preventDefault(); });
}
