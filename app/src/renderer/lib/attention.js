// 사람의 주의를 다루는 규칙(P3). 순수 함수만 둔다(단위 시험 있음).
// - A1 OS 알림: 언제 띄우나
// - A3 복귀 요약: 언제 보여주나
import { t } from './i18n.js';

export const NOTIFY_DELAY_MS = 1200; // waiting이 된 뒤 이만큼 기다렸다가 정한다. hook이 herdr보다 먼저 오는 틈과 바로 풀리는 요청을 거른다
export const NOTIFY_MIN_VISIBLE_PX = 200; // 노드가 화면에서 이만큼 넓어야(중간 얼굴 이상, 승인 카드가 보임) "보인다"로 친다
export const DEFAULT_AWAY_MS = 5 * 60 * 1000;

const NEEDS_YOU = new Set(['waiting', 'trust_wait']);

// 같은 대기에 한 번만 띄우기 위한 열쇠. 요청(tool_use_id 또는 시작 시각)이 바뀌면 새 대기다.
export function notifyKey(s) {
  if (!s || !NEEDS_YOU.has(s.state)) return null;
  const a = s.ask;
  return `${s.sessionId}|${s.state}|${(a && (a.toolUseId || a.since)) || 'x'}`;
}

// 노드가 화면에 보이는가: 판 영역과 겹치고, 화면 너비가 NOTIFY_MIN_VISIBLE_PX 이상(멀리 얼굴에서는 승인 카드를 그리지 않는다)
export function nodeVisible(nodeRect, canvasRect) {
  if (!nodeRect || !canvasRect) return false;
  const w = Math.min(nodeRect.right, canvasRect.right) - Math.max(nodeRect.left, canvasRect.left);
  const h = Math.min(nodeRect.bottom, canvasRect.bottom) - Math.max(nodeRect.top, canvasRect.top);
  if (w <= 0 || h <= 0) return false;
  const shownArea = (w * h) / Math.max(1, nodeRect.width * nodeRect.height);
  return nodeRect.width >= NOTIFY_MIN_VISIBLE_PX && shownArea >= 0.5; // 노드의 절반 이상이 보여야 한다
}

// 작업자가 정한 규칙(docs/log/p3-v02.md 보고 6절): 창에 초점이 있고(그리고 창이 가려지지 않았고) 그 노드가 보이면 띄우지 않는다. 나머지는 띄운다.
// 띄우지 않은 대기도 "알렸음"으로 친다. 사람이 이미 보고 있었으므로 나중에 창을 떠나도 다시 띄우지 않는다.
export function shouldNotify({ focused, pageVisible = true, nodeRect, canvasRect }) {
  if (focused && pageVisible && nodeVisible(nodeRect, canvasRect)) return { notify: false, why: 'visible' };
  return { notify: true, why: !focused ? 'window not focused' : !pageVisible ? 'window hidden' : 'node not visible' };
}

// 복귀 요약(A3): 마지막으로 본 시각에서 오래 지났으면 보여준다
export function awayLongEnough(seenAt, now = Date.now(), awayMs = DEFAULT_AWAY_MS) {
  return !!seenAt && now - seenAt >= awayMs;
}

const CHANGE_KEYS = { needs_you: 'change.needs_you', error: 'change.error', interrupted: 'change.interrupted', exited: 'change.exited', turn_done: 'change.turn_done', herdr: 'change.herdr', backend: 'changeSys.backend' }; // P53: backend 줄
// 그때의 언어로 찾는다(CHANGE_LABEL[kind], P16)
export const CHANGE_LABEL = new Proxy({}, { get: (_, k) => (typeof k === 'string' && Object.hasOwn(CHANGE_KEYS, k) ? t(CHANGE_KEYS[k]) : undefined) });

// Compatibility for consumers of the original pure rule; session entry no longer invokes it.
export const DEFAULT_BRIEF_AFTER_MS = 30 * 60 * 1000;
export function briefingDue(s, now = Date.now(), afterMs = DEFAULT_BRIEF_AFTER_MS) {
  if (!s) return false;
  const last = s.touchedAt || s.createdAt || 0;
  return now - last >= afterMs;
}
