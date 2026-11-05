// P6c 창 쪽 순수 규칙: 메모·칸반 노드의 워크스페이스 소속(놓은 자리), 루프 배지 글, Thread 결과 글(미션 맵 배치는 P32부터 lib/mission-layout.js). 단위 시험이 있다(test/p6c-lib.test.mjs).
import { t as tr } from './i18n.js';

// 열쇠 → 글(P16). 객체처럼 읽되 그때의 언어로 돌려준다(LOOP_STATUS[l.status])
const labelMap = (ns, keys) => new Proxy({}, {
  get: (_, k) => (typeof k === 'string' && keys.includes(k) ? tr(`${ns}.${k}`) : undefined),
  has: (_, k) => keys.includes(k),
  ownKeys: () => keys,
  getOwnPropertyDescriptor: (_, k) => (keys.includes(k) ? { enumerable: true, configurable: true, value: tr(`${ns}.${k}`) } : undefined),
});

// 놓은 노드의 워크스페이스. regions: Map key → 영역(그 노드를 빼고 계산한 것).
// 가운데가 든 영역. 없으면 margin 안으로 가장 가까운 영역(영역은 안의 노드를 바짝 감싸 빈 안쪽이 거의 없으므로, 영역 바로 옆에 놓아도 그 소속으로 본다). 둘 다 없으면 null
export function wsAt(rect, regions, margin = 0) {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  let best = null;
  for (const [key, r] of regions) {
    const inside = cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
    const gap = Math.max(0, r.x - (rect.x + rect.w), rect.x - (r.x + r.w), r.y - (rect.y + rect.h), rect.y - (r.y + r.h)); // 사각형 사이 거리(겹치면 0)
    if (!inside && gap > margin) continue;
    const score = inside ? -1 / (r.w * r.h) : gap; // 가운데가 든 영역이 먼저(겹치면 작은 영역), 그다음 가까운 영역
    if (!best || score < best.score) best = { key, score };
  }
  return best ? best.key : null;
}

// 시간(밀리초) → "1분 5초", "2시간 3분"
export function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return tr('time.s', { s });
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? tr('time.ms', { m, s: s % 60 }) : tr('items.durM', { m });
  return m % 60 ? tr('time.hm', { h: Math.floor(m / 60), m: m % 60 }) : tr('items.durH', { h: Math.floor(m / 60) });
}

export const LOOP_STATUS = labelMap('loops.status', ['active', 'paused', 'done', 'stopped']);
export const STOP_REASON = labelMap('loops.stopReason', ['max_runs', 'max_time', 'goal_text', 'session_closed']);

export function triggerText(t) {
  if (!t) return '';
  if (t.type === 'interval') return tr(t.immediate === false ? 'loops.trigEvery' : 'loops.trigEveryNow', { d: dur(t.everyMs) });
  if (t.type === 'idle') return tr('loops.trigIdle');
  if (t.type === 'text') return tr('loops.trigText', { where: tr(t.source === 'screen' ? 'loops.srcScreen' : t.source === 'any' ? 'loops.srcAny' : 'loops.srcAnswer'), text: t.text });
  return t.type;
}
export function stopText(s) {
  const out = [];
  if (s && s.maxRuns) out.push(tr('loops.stopRuns', { n: s.maxRuns }));
  if (s && s.maxMs) out.push(tr('loops.stopTime', { d: dur(s.maxMs) }));
  if (s && s.untilText) out.push(tr('loops.stopUntil', { text: s.untilText }));
  return out.length ? out.join(' · ') : tr('loops.stopManual');
}

// 노드 배지 한 줄: 상태, 남은 횟수, 다음 시각. now를 받는다(시험)
export function loopBadge(l, now = Date.now()) {
  const parts = [];
  if (l.status === 'active') parts.push('⟳');
  else if (l.status === 'paused') parts.push('⏸');
  else parts.push('■');
  if (l.stop && l.stop.maxRuns) parts.push(tr('loops.badgeLeft', { n: Math.max(0, l.stop.maxRuns - (l.runs || 0)) }));
  else parts.push(tr('loops.badgeRuns', { n: l.runs || 0 }));
  if (l.status === 'active' && l.trigger && l.trigger.type === 'interval' && l.nextAt) parts.push(tr('loops.badgeNext', { d: dur(Math.max(0, l.nextAt - now)) }));
  else if (l.status === 'active' && l.trigger && l.trigger.type !== 'interval') parts.push(tr(l.trigger.type === 'idle' ? 'loops.badgeIdle' : 'loops.badgeText'));
  else if (l.status === 'paused' && l.trigger && l.trigger.type === 'interval') {
    // 멈춘 루프는 다음 차례까지 남은 시간을 기록(history의 paused)에 둔다
    const p = [...(l.history || [])].reverse().find((h) => h.kind === 'paused');
    if (p && p.nextInMs != null) parts.push(tr('loops.badgeResume', { d: dur(p.nextInMs) }));
  }
  return parts.join(' ');
}

// 이 세션을 대상으로 하는 루프. 끝난 것은 빼지 않는다(배지에서 고른다)
export function loopsOfSession(loops, sessionId) {
  return [...loops].filter((l) => (l.target.kind === 'session' && l.target.id === sessionId) || (l.targets || []).some((t) => t.sessionId === sessionId));
}

// Thread 결과 단계 글(thread.mjs resultPhase)
export const RESULT_PHASE = labelMap('items.resultPhase', ['delivering', 'running', 'done', 'failed', 'abandoned', 'cancelled']);
export const ITEM_PHASE = labelMap('items.itemPhase', ['active', 'done', 'partial', 'failed']);
export const SOURCE_LABEL = labelMap('items.source', ['bar', 'output', 'loop', 'atrium', 'mtask']);

// 미션 맵 배치는 lib/mission-layout.js(P32)

// Compatibility layout API; the UI uses the new tree layout in mission-layout.js.
import { treeOrder } from './branch.js';
export const MISSION = { colW: 260, colGap: 140, rowH: 66, rowGap: 14, pad: 24, head: 34, indent: 18 };
export function missionLayout(graph, { filter = 'all' } = {}) {
  const L = MISSION;
  const keep = (n) => n.kind !== 'session' || filter === 'all' || n.category === filter;
  const nodes = (graph.nodes || []).filter(keep);
  const ids = new Set(nodes.map((n) => n.id));
  const cols = [[], []];
  for (const n of nodes) cols[Math.max(0, Math.min(1, n.column ?? 1))].push(n);
  // 열 안의 순서: 사람 먼저, 그다음 내 차례 > 작업 중 > 쉼 > 검토 > 끝남, 이름
  const rank = { needs_you: 0, working: 1, idle: 2, done: 3, exited: 4 };
  const cmp = (a, b) => (a.kind === 'human' ? -1 : b.kind === 'human' ? 1 : 0) || (rank[a.category] ?? 5) - (rank[b.category] ?? 5) || String(a.name).localeCompare(String(b.name));
  // P8(K4): 세션은 나무 순서(부모 바로 다음에 자식)로 매긴 번호를 열마다 따른다. 다른 열에 있는 부모의 자식들도 부모 순서대로 모인다
  const tree = new Map(treeOrder(nodes.filter((n) => n.kind === 'session'), { cmp, idOf: (n) => n.id, parentOf: (n) => n.parentId || null }).map((t, i) => [t.item.id, i]));
  for (const c of cols) c.sort((a, b) => (a.kind === 'session' && b.kind === 'session' ? tree.get(a.id) - tree.get(b.id) : cmp(a, b)));
  const boxes = new Map();
  cols.forEach((c, ci) => c.forEach((n, ri) => {
    const ind = n.kind === 'session' ? Math.min(3, Math.max(0, (n.depth || 1) - 1)) * L.indent : 0; // 하위 세션은 깊이만큼 들여 쓴다
    boxes.set(n.id, { x: L.pad + ci * (L.colW + L.colGap) + ind, y: L.pad + L.head + ri * (L.rowH + L.rowGap), w: L.colW - ind, h: L.rowH, node: n });
  }));
  const edges = [];
  for (const e of graph.edges || []) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const a = boxes.get(e.from), b = boxes.get(e.to);
    let p;
    if (a.x < b.x) { const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, dx = Math.max(40, (x2 - x1) / 2); p = { d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 }; }
    else if (a.x > b.x) { const x1 = a.x, y1 = a.y + a.h / 2, x2 = b.x + b.w, y2 = b.y + b.h / 2, dx = Math.max(40, (x1 - x2) / 2); p = { d: `M${x1},${y1} C${x1 - dx},${y1} ${x2 + dx},${y2} ${x2},${y2}`, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 }; }
    else { const x1 = a.x + a.w, y1 = a.y + a.h / 2, y2 = b.y + b.h / 2, bulge = 50 + Math.abs(y2 - y1) / 6; p = { d: `M${x1},${y1} C${x1 + bulge},${y1} ${x1 + bulge},${y2} ${x1},${y2}`, lx: x1 + bulge * 0.75, ly: (y1 + y2) / 2 }; }
    edges.push({ ...e, ...p });
  }
  const rows = Math.max(1, ...cols.map((c) => c.length));
  return { boxes, edges, width: L.pad * 2 + 2 * L.colW + L.colGap, height: L.pad * 2 + L.head + rows * (L.rowH + L.rowGap) };
}
