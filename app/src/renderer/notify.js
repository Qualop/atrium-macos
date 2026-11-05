// A1 OS 알림(P3): 세션이 내 차례(waiting, trust_wait)가 되면 Windows 알림을 띄우고, 누르면 그 노드로 간다.
// 같은 대기에는 한 번만. 창에 초점이 있고 그 노드가 보이면 띄우지 않는다(lib/attention.js).
// P5: 모든 워크스페이스를 가로지른다. 알림에 워크스페이스 이름을 붙이고, 누르면 그 워크스페이스로 바꾸고 노드로 간다(navigateTo, G4).
// 알린 대기의 열쇠는 창을 다시 열어도 같은 대기에 다시 띄우지 않도록 localStorage에 하루 동안 둔다.
import { getState, subscribe, wsName } from './store.js';
import { notifyKey, shouldNotify, NOTIFY_DELAY_MS } from './lib/attention.js';
import { askLine } from './lib/labels.js';
import { t } from './lib/i18n.js';
import { perfLog } from './perf.js';
import { notifyAllowed } from './lib/multiclient.js';

const KEY = 'mt.notified';
const DAY = 24 * 3600 * 1000;
function load() { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(KEY) || '{}'))); } catch { return new Map(); } }
function save(m) { try { const now = Date.now(); localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...m].filter(([, t]) => now - t < DAY)))); } catch {} }

const done = load();
const pending = new Map();
export const notifyLog = []; // 시험이 읽는다

function decide(id, key) {
  pending.delete(key);
  const s = getState().sessions.get(id);
  if (!s || notifyKey(s) !== key) return; // 그새 풀렸다
  const el = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
  const canvas = document.querySelector('.mt-canvas');
  let r = shouldNotify({ focused: document.hasFocus(), pageVisible: document.visibilityState === 'visible', nodeRect: el && el.getBoundingClientRect(), canvasRect: canvas && canvas.getBoundingClientRect() });
  // P47: 창이 여럿 붙었으면 백엔드가 고른 클라이언트(최근에 쓴 쪽, 없으면 PC 창)만 띄운다
  const peer = notifyAllowed(getState().peers);
  if (r.notify && !peer.allowed) r = { ...r, notify: false, why: peer.reason, notifyClient: getState().peers.notify };
  done.set(key, Date.now()); save(done);
  const rec = { at: Date.now(), sessionId: id, name: s.name, key, ...r };
  notifyLog.push(rec);
  perfLog('notify', rec);
  if (!r.notify) return;
  const folder = s.workspaceKey ? wsName(s.workspaceKey) : String(s.cwd || '').split(/[\\/]/).filter(Boolean).pop() || '';
  window.mt.notify({ sessionId: id, key, title: `@${s.name} ${s.state === 'trust_wait' ? t('state.trust_wait') : t('state.waiting')}`, body: `${askLine(s)}${folder ? ` · ${folder}` : ''}` })
    .then((x) => { rec.result = x; }).catch((e) => { rec.result = { shown: false, reason: e.message }; });
}

function scan() {
  for (const s of getState().sessions.values()) {
    const key = notifyKey(s);
    if (!key || done.has(key) || pending.has(key)) continue;
    pending.set(key, setTimeout(() => decide(s.sessionId, key), NOTIFY_DELAY_MS));
  }
}

export function startNotifier() {
  subscribe(scan);
  window.mt.onNavigate((id) => { const st = getState(); if (st.navigateTo) st.navigateTo(id); });
}
