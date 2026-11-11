// P67: 연결 선 위 이름표의 규칙(순수 함수, 단위 시험 app/test/p67-lib.test.mjs). 부르는 곳은 Canvas.jsx(선 목록), Links.jsx LinkEdge, Docks.jsx DockLinks.
// 1. 한 쌍에 이름표 하나: 두 세션 사이(방향 상관없이)에 연결이 여럿이면 가장 최근 것 하나에만 이름표를 달고, 나머지 지시 수를 "+n"으로 붙인다(pairLabels).
// 2. 물러나기: 일이 도는 동안(받는 쪽이 그 지시로 일하는 중, 지시를 보내는 중)과 결과를 아직 보지 않은 동안(REST_MS까지)만 글을 다 보인다.
//    그 밖에는 작은 칩(역할과 상태 점)으로 줄인다. 마우스를 올리거나 선을 고르면 다시 다 보인다(labelAwake, linkLabelLevel).
// 3. 배율: P46 덩어리 안 글과 같은 경계(0.4 아래는 점, 0.4부터 칩, 0.8부터 다 보인 글).
// 4. 비켜 놓기: 서로 다른 선의 이름표가 한 자리에 겹치면 선을 따라 밀어 놓는다(spreadLabels).
import { DOCK_LABEL_ZOOM, ACTIVE_MS } from './dock-links.js';
import { labelFit } from './labels.js';

export const REST_MS = 5 * 60 * 1000; // 결과를 안 봤어도 일이 끝나고 이만큼 지나면 칩으로 줄인다
export const SEND_MS = 90 * 1000; // 지시를 보낸 뒤 받는 쪽이 일을 시작하기 전까지(보내는 중) 다 보이는 틈
const BUSY = new Set(['starting', 'working', 'waiting', 'trust_wait', 'shell_running']);

export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const touchedAt = (l) => l.lastAt || l.createdAt || 0;

// links: [{ linkId, from, to, lastAt, createdAt, lastText, prompts }] → Map pairKey → { key, primary, links(최근 순), prompts(쌍 전체 지시 수), more(이름표에 안 보인 지시 수) }
export function pairLabels(links) {
  const by = new Map();
  for (const l of links || []) {
    if (!l || !l.from || !l.to || l.from === l.to) continue;
    const k = pairKey(l.from, l.to);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(l);
  }
  const out = new Map();
  for (const [key, list] of by) {
    list.sort((a, b) => touchedAt(b) - touchedAt(a) || String(a.linkId).localeCompare(String(b.linkId)));
    const primary = list[0];
    const prompts = list.reduce((n, l) => n + (Number.isFinite(l.prompts) ? l.prompts : l.lastText ? 1 : 0), 0);
    out.set(key, { key, primary, links: list, prompts, more: Math.max(0, prompts - (primary.lastText ? 1 : 0)) });
  }
  return out;
}

// 이름표가 깨어 있는가(글을 다 보이는가). link: 연결, to: 받는 쪽 세션 요약({ state, unseen, delivering, turn: { endedAt } })
// → { awake, why: 'running' | 'sending' | 'unseen' | null }
// 지시 시각은 promptAt(백엔드가 센 마지막 지시). lastAt은 답 읽기(reply)·알림에도 바뀌므로, 없을 때만 마지막 기록이 지시였을 때의 lastAt을 쓴다
export const promptAtOf = (l) => (l.promptAt != null ? l.promptAt : l.lastKind === 'prompt' ? l.lastAt : null) || null;
export function labelAwake(link, to, now = Date.now(), { restMs = REST_MS, sendMs = SEND_MS } = {}) {
  if (!link || !to) return { awake: false, why: null };
  const sent = promptAtOf(link);
  const at = sent || link.createdAt || 0; // 지시가 없으면 띄운(이은) 때
  const ended = (to.turn && to.turn.endedAt) || 0;
  const answered = ended >= at && ended > 0; // 그 지시(없으면 띄움) 뒤에 받는 쪽이 한 턴을 끝냈다
  if (BUSY.has(to.state) && !answered && now - at < ACTIVE_MS) return { awake: true, why: 'running' };
  if (sent && !answered && ((to.delivering || 0) > 0 || now - sent < sendMs)) return { awake: true, why: 'sending' };
  if (to.unseen && answered && now - ended < restMs) return { awake: true, why: 'unseen' };
  return { awake: false, why: null };
}
// 쌍 전체: 하나라도 깨어 있으면 깨어 있다. sessions: Map 세션 ID → 요약
export function pairAwake(pair, sessions, now = Date.now(), opt) {
  for (const l of pair.links) { const r = labelAwake(l, sessions.get(l.to), now, opt); if (r.awake) return r; }
  return { awake: false, why: null };
}

// 보일 모양: 'dot'(점, 아주 멀리거나 틈이 좁을 때) | 'chip'(역할과 상태 점) | 'full'(역할, 마지막 지시, +n, 상태)
// hot: 마우스를 올렸거나 선을 골랐다(늘 다 보인다)
export function linkLabelLevel({ zoom = 1, awake = false, hot = false, compact = false } = {}) {
  if (hot) return 'full';
  if (compact || zoom < DOCK_LABEL_ZOOM.short) return 'dot';
  if (!awake || zoom < DOCK_LABEL_ZOOM.full) return 'chip';
  return 'full';
}
// 덩어리 안 글(P46 단계: mini | short | full)에 같은 규칙: 물러난 글은 short(역할 이름)까지만
export function dockRestLevel(level, { awake = false, hot = false } = {}) {
  if (hot || awake || level !== 'full') return level;
  return 'short';
}

// 서로 다른 선의 이름표 비켜 놓기(판 좌표).
// items: [{ id, x, y(이름표 가운데), ux, uy(선 방향 단위 벡터), w, h(어림 크기), room(한쪽으로 밀 수 있는 거리), prio(클수록 제자리) }]
// → Map id → { dx, dy }. 제자리, 그다음 이미 놓인 이름표 하나하나를 앞뒤로 막 비키는 자리들을 가까운 차례로 보고, room 안에 빈 자리가 없으면 제자리에 둔다
export function spreadLabels(items, { gap = 6 } = {}) {
  const out = new Map();
  const placed = [];
  const hit = (b) => placed.some((p) => b.x - b.w / 2 < p.x + p.w / 2 + gap && p.x - p.w / 2 < b.x + b.w / 2 + gap && b.y - b.h / 2 < p.y + p.h / 2 + gap && p.y - p.h / 2 < b.y + b.h / 2 + gap);
  const order = [...(items || [])].sort((a, b) => (b.prio || 0) - (a.prio || 0) || String(a.id).localeCompare(String(b.id)));
  for (const it of order) {
    const tries = [0];
    for (const p of placed) {
      const t = (p.x - it.x) * it.ux + (p.y - it.y) * it.uy; // 놓인 이름표 가운데의 선 위 자리
      const e = Math.abs(it.ux) * (p.w + it.w) / 2 + Math.abs(it.uy) * (p.h + it.h) / 2 + gap + 1; // 선 방향으로 비켜야 할 거리
      tries.push(t + e, t - e);
    }
    let off = 0;
    for (const o of tries.filter((o) => Math.abs(o) <= Math.max(0, it.room || 0)).sort((a, b) => Math.abs(a) - Math.abs(b))) {
      if (!hit({ x: it.x + it.ux * o, y: it.y + it.uy * o, w: it.w, h: it.h })) { off = o; break; }
    }
    const box = { x: it.x + it.ux * off, y: it.y + it.uy * off, w: it.w, h: it.h };
    placed.push(box);
    out.set(it.id, { dx: Math.round(it.ux * off), dy: Math.round(it.uy * off) });
  }
  return out;
}

// 선 위 글이 놓일 틈(두 노드 사이). ra·rb: 두 끝 노드 사각형, sides: { sourceHandle, targetHandle }, others: 다른 세션 노드 사각형들(판 좌표)
// → { gap, horizontal } 또는 { gap: 0, horizontal, blocked: true }(글 자리가 세션 위)
// P98: 덩어리 밖 리드 → 덩어리 안쪽 칸 워커처럼 선이 다른 세션 뒤로 지나가면 글 자리가 그 세션 위다(blocked). 그런 이름표는 그리지 않는다(linkLabelHidden)
export function edgeGap(ra, rb, sides, others = []) {
  const gx = Math.abs(rb.x + rb.w / 2 - (ra.x + ra.w / 2)) - (ra.w + rb.w) / 2, gy = Math.abs(rb.y + rb.h / 2 - (ra.y + ra.h / 2)) - (ra.h + rb.h) / 2;
  const p = handleAt(ra, sides.sourceHandle), q = handleAt(rb, sides.targetHandle), m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  if (pointInSessions(m.x, m.y, [ra, rb, ...others])) return { gap: 0, horizontal: gx >= gy, blocked: true };
  return gx >= gy ? { gap: gx, horizontal: true } : { gap: gy, horizontal: false };
}
// P98·P108: 이름표 자리가 세션 위면(blocked) 줄인 이름표 ●도 그리지 않는다. 선은 노드 뒤로 지나가 보이지 않는다.
// 고른 선이나 그 연결 대화상자가 열려 있을 때는 그대로 보인다
// P108: 자기 끝 세션도 포함한다. 경계의 덩어리 탭과 바깥 둘레 장식은 안쪽이 아니다.
export const pointInSessions = (x, y, rects = []) => rects.some((r) => r && x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
// P108: 비켜 놓은 뒤의 실제 Bezier 이름표 자리도 검사한다. 고른 선·열린 대화상자는 그대로 보인다.
export const linkLabelHidden = (data, { hot = false, x, y } = {}) => !hot && !!(data && (data.blocked || pointInSessions(x, y, data.labelRects)));
// P98: 덩어리 안 칸에 닿는 선의 끝 점. 손잡이가 덩어리 바깥 둘레가 아니라 칸 사이 경계(덩어리 안쪽)에 있으면 그리지 않는다(outer: 덩어리 바깥 사각형)
export function endInside(r, side, outer) {
  if (!r || !outer) return false;
  const p = handleAt(r, side);
  return p.x > outer.x + 1 && p.x < outer.x + outer.w - 1 && p.y > outer.y + 1 && p.y < outer.y + outer.h - 1;
}
export function innerEnds(ra, rb, sides, outerA = null, outerB = null, rects = []) {
  const o = {};
  const p = handleAt(ra, sides.sourceHandle), q = handleAt(rb, sides.targetHandle);
  if (endInside(ra, sides.sourceHandle, outerA) || pointInSessions(p.x, p.y, [ra, rb, ...rects])) o.hideSource = true;
  if (endInside(rb, sides.targetHandle, outerB) || pointInSessions(q.x, q.y, [ra, rb, ...rects])) o.hideTarget = true;
  return o;
}

// 이름표 자리(getBezierPath의 가운데)를 비켜 놓은 만큼 옮긴다
export const shifted = (lx, ly, data) => (data && data.shift ? [lx + data.shift.dx, ly + data.shift.dy] : [lx, ly]);

// 손잡이 자리(Canvas의 facingSides ID t·r·b·l, 덩어리 잇기의 가운데 c)
const handleAt = (r, side) => (side === 'c' ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : side === 'r' ? { x: r.x + r.w, y: r.y + r.h / 2 } : side === 'l' ? { x: r.x, y: r.y + r.h / 2 } : side === 't' ? { x: r.x + r.w / 2, y: r.y } : { x: r.x + r.w / 2, y: r.y + r.h });
const LABEL_H = 26; // 이름표 어림 높이(판 px)

// Canvas가 만든 선 목록에 이름표 정보를 더한다(제자리에서 고친다).
// edges: [{ id, type: 'link' | 'repo' | 'spawnc', source, target, sourceHandle, targetHandle, data }], rectOf(id) → 사각형, links: Map 연결 ID → 연결, sessions: Map 세션 ID → 요약
// - link: 쌍의 대표 선만 이름표를 단다(data.label = { more, prompts, awake, why, pair }). 나머지는 data.label = null
// - 이름표가 있는 선: 비켜 놓았으면 data.shift = { dx, dy } (판 px)
export function decorateEdges(edges, { rectOf, links, sessions, now = Date.now() }) {
  const pairs = pairLabels(edges.filter((e) => e.type === 'link').map((e) => links.get(e.id)).filter(Boolean));
  const primary = new Map([...pairs.values()].map((p) => [p.primary.linkId, p]));
  const items = [];
  for (const e of edges) {
    let w = 0, prio = 0;
    const fit = labelFit(e.data);
    if (e.type === 'link') {
      const p = primary.get(e.id);
      if (!p) { e.data = { ...e.data, label: null }; continue; }
      const aw = pairAwake(p, sessions, now);
      e.data = { ...e.data, label: { more: p.more, prompts: p.prompts, awake: aw.awake, why: aw.why, pair: p.links.map((l) => l.linkId) } };
      w = fit.compact ? 26 : aw.awake ? Math.min(fit.maxWidth, 320) : 130;
      prio = aw.awake ? 3 : 2;
    } else if (e.type === 'spawnc' || e.type === 'repo') {
      if (fit.compact) continue;
      w = e.type === 'spawnc' ? 220 : 170;
      prio = e.type === 'spawnc' ? 1 : 0;
    } else continue;
    if (linkLabelHidden(e.data)) continue; // 숨은 이름표가 보이는 이름표를 칸 안으로 밀지 않는다
    const ra = rectOf(e.source), rb = rectOf(e.target);
    if (!ra || !rb) continue;
    const p = handleAt(ra, e.sourceHandle), q = handleAt(rb, e.targetHandle);
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const ux = len ? (q.x - p.x) / len : 1, uy = len ? (q.y - p.y) / len : 0;
    items.push({ id: e.id, x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, ux, uy, w, h: LABEL_H, room: Math.max(0, len / 2 - 40), prio });
  }
  const shift = spreadLabels(items);
  for (const e of edges) { const s = shift.get(e.id); if (s && (s.dx || s.dy)) e.data = { ...e.data, shift: s }; }
  return edges;
}
