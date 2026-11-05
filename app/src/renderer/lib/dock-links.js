// 덩어리 안 연결(P30 다리·괄호·둘레 길)의 순수 함수(단위 시험 app/test/p30-lib.test.mjs). 부르는 곳은 Docks.jsx DockLinks.
// 덩어리 안 칸들은 대개 서로 맞닿아 있으므로 선을 터미널 위로 긋지 않고 아래 규칙을 위에서부터 쓴다(dockRoutes).
// 1. 맞닿은 두 칸: 다리. 두 칸이 함께 쓰는 경계선의 겹친 구간 가운데에 작은 알약 하나(같은 쌍에 여럿이면 구간을 나눠 놓는다).
// 2. 맞닿지 않았지만 같은 바깥 변에 닿는 두 칸: 괄호. 그 변 바깥에 덩어리 테두리에서 조금 띄운 ] 모양 선.
// 3. 그 밖(2 × 2 대각선 등): 둘레 길. 덩어리 둘레를 따라 가장 짧은 길(모서리를 도는 ㄱ자)로 바깥에 긋는다.
//    괄호와 둘레 길은 지하철 노선처럼 차선(lane)을 나눠 겹치지 않게 한다(짧은 길이 안쪽 차선).
// 4. 둘레에 닿지 않는 칸(3 × 3 가운데처럼)이 낀 연결: 선 대신 그 칸 머리줄의 작은 칩.

export const centerOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const EPS = 1; // 판 px. 칸 경계는 정수 좌표라 1px 안이면 같은 선으로 본다
export const SIDES = ['right', 'bottom', 'left', 'top']; // 같은 길이면 이 차례로 고른다

// 사각형 모음의 바깥(bbox)
export function outerOf(rects) {
  const rs = Object.values(rects);
  if (!rs.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 };
}

// 칸 r이 바깥 O의 어느 변에 닿는가(SIDES 차례)
export function outerSides(r, O) {
  const on = { left: Math.abs(r.x - O.x) <= EPS, right: Math.abs(r.x + r.w - (O.x + O.w)) <= EPS, top: Math.abs(r.y - O.y) <= EPS, bottom: Math.abs(r.y + r.h - (O.y + O.h)) <= EPS };
  return SIDES.filter((s) => on[s]);
}

// 두 칸이 함께 쓰는 경계선. 없으면 null.
// → { axis: 'v'(세로 경계, x 고정) | 'h'(가로 경계, y 고정), at(경계 자리), lo, hi(겹친 구간), arrow: a에서 b로 가는 쪽('right'|'left'|'down'|'up') }
export function sharedEdge(a, b) {
  const over = (p0, p1, q0, q1) => [Math.max(p0, q0), Math.min(p1, q1)];
  const v = (at, arrow) => { const [lo, hi] = over(a.y, a.y + a.h, b.y, b.y + b.h); return hi - lo > EPS ? { axis: 'v', at, lo, hi, arrow } : null; };
  const h = (at, arrow) => { const [lo, hi] = over(a.x, a.x + a.w, b.x, b.x + b.w); return hi - lo > EPS ? { axis: 'h', at, lo, hi, arrow } : null; };
  if (Math.abs(a.x + a.w - b.x) <= EPS) return v(b.x, 'right');
  if (Math.abs(b.x + b.w - a.x) <= EPS) return v(a.x, 'left');
  if (Math.abs(a.y + a.h - b.y) <= EPS) return h(b.y, 'down');
  if (Math.abs(b.y + b.h - a.y) <= EPS) return h(a.y, 'up');
  return null;
}

// ---------- 둘레 좌표 ----------
// 바깥 O를 d만큼 넓힌 사각형의 둘레를 왼쪽 위 모서리부터 시계 방향으로 잰 거리 t. 변 위의 자리 c(위·아래 변은 x, 왼·오른 변은 y)
function ring(O, d) {
  const X0 = O.x - d, Y0 = O.y - d, W = O.w + 2 * d, H = O.h + 2 * d;
  const P = 2 * (W + H);
  const tOf = (side, c) => (side === 'top' ? c - X0 : side === 'right' ? W + (c - Y0) : side === 'bottom' ? W + H + (X0 + W - c) : 2 * W + H + (Y0 + H - c));
  const corners = [{ t: 0, x: X0, y: Y0 }, { t: W, x: X0 + W, y: Y0 }, { t: W + H, x: X0 + W, y: Y0 + H }, { t: 2 * W + H, x: X0, y: Y0 + H }];
  const pointOf = (side, c) => (side === 'top' ? { x: c, y: Y0 } : side === 'right' ? { x: X0 + W, y: c } : side === 'bottom' ? { x: c, y: Y0 + H } : { x: X0, y: c });
  return { P, tOf, corners, pointOf };
}
const mod = (x, P) => ((x % P) + P) % P;

// 칸 r의 side 변 위 자리(그 변에 닿은 칸의 구간을 n개로 나눈 i번째, 가운데부터)
function anchorOn(r, side, i = 0, n = 1) {
  const k = (i + 1) / (n + 1);
  if (side === 'top' || side === 'bottom') return { c: r.x + r.w * k, p: { x: r.x + r.w * k, y: side === 'top' ? r.y : r.y + r.h } };
  return { c: r.y + r.h * k, p: { x: side === 'left' ? r.x : r.x + r.w, y: r.y + r.h * k } };
}

// 바깥 길 하나의 모양(차선 바깥 거리 d). a·b: 두 끝 칸, sa·sb: 나가는 변·들어오는 변, ca·cb: 변 위 자리, cw: 시계 방향인가
// → { points: [칸 테두리 → 바깥 → (모서리들) → 바깥 → 칸 테두리], len, t0, arc }
function routeShape(O, d, sa, ca, pa, sb, cb, pb, cw) {
  const R = ring(O, d);
  const t0 = R.tOf(sa, ca), t1 = R.tOf(sb, cb);
  const arc = cw ? mod(t1 - t0, R.P) : mod(t0 - t1, R.P);
  const pts = [pa, R.pointOf(sa, ca)];
  const passed = R.corners.map((k) => ({ ...k, s: cw ? mod(k.t - t0, R.P) : mod(t0 - k.t, R.P) })).filter((k) => k.s > 1e-9 && k.s < arc - 1e-9).sort((p, q) => p.s - q.s);
  for (const k of passed) pts.push({ x: k.x, y: k.y });
  pts.push(R.pointOf(sb, cb), pb);
  return { points: pts, len: arc + 2 * d, t0, arc, cw };
}

// 덩어리 안 연결의 그릴 모양.
// rects: { id: { x, y, w, h } }(같은 좌표계), links: [{ linkId, from, to }], opt: { gap(테두리에서 첫 차선까지), step(차선 사이) }
// → { bridges: [{ linkId, from, to, x, y, axis, arrow }],
//     (P46) bridges[].span: 그 다리가 쓸 수 있는 경계 길이(같은 쌍 여럿이면 나눈 몫)
//     routes: [{ linkId, from, to, kind: 'bracket' | 'around', sides: [sa, sb], lane, points, d }],
//     chips: [{ linkId, from, to, cell(칩이 붙는 칸), dir: 'in'(그 칸이 받는 쪽) | 'out' }] }
export function dockRoutes(rects, links, { gap = 14, step = 10 } = {}) {
  const O = outerOf(rects);
  const has = (id) => Object.prototype.hasOwnProperty.call(rects, id);
  const inside = (links || []).filter((l) => l && l.from !== l.to && has(l.from) && has(l.to));
  const bridges = [], chips = [], outside = [];
  // 1. 다리: 같은 쌍(방향 상관없이)마다 겹친 구간을 나눠 놓는다
  const pairs = new Map();
  for (const l of inside) {
    const e = sharedEdge(rects[l.from], rects[l.to]);
    if (!e) { outside.push(l); continue; }
    const key = [l.from, l.to].sort().join('|');
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push({ l, e });
  }
  for (const list of pairs.values()) {
    list.forEach(({ l, e }, i) => {
      const along = e.lo + ((e.hi - e.lo) * (i + 1)) / (list.length + 1);
      bridges.push({ linkId: l.linkId, from: l.from, to: l.to, axis: e.axis, arrow: e.arrow, x: e.axis === 'v' ? e.at : along, y: e.axis === 'v' ? along : e.at, span: (e.hi - e.lo) / list.length });
    });
  }
  // 2·3. 괄호와 둘레 길: 변 고르기(같은 변이 있으면 괄호), 방향(짧은 쪽)
  const plans = [];
  for (const l of outside) {
    const A = rects[l.from], B = rects[l.to];
    const sA = outerSides(A, O), sB = outerSides(B, O);
    if (!sA.length || !sB.length) { chips.push({ linkId: l.linkId, from: l.from, to: l.to, cell: !sB.length ? l.to : l.from, dir: !sB.length ? 'in' : 'out' }); continue; }
    const common = sA.filter((s) => sB.includes(s));
    const combos = common.length ? common.map((s) => [s, s]) : sA.flatMap((a) => sB.map((b) => [a, b]));
    let best = null;
    for (const [sa, sb] of combos) {
      const a = anchorOn(A, sa), b = anchorOn(B, sb);
      for (const cw of [true, false]) {
        const r = routeShape(O, gap, sa, a.c, a.p, sb, b.c, b.p, cw);
        if (!best || r.len < best.len - 1e-6) best = { ...r, sa, sb };
      }
    }
    plans.push({ l, kind: common.length ? 'bracket' : 'around', sa: best.sa, sb: best.sb, cw: best.cw, arc: best.arc, len: best.len });
  }
  // 한 칸의 한 변에서 나가고 들어오는 길이 여럿이면 그 변 구간을 나눠 쓴다(상대 쪽 둘레 자리 차례로)
  const ends = new Map();
  const R0 = ring(O, gap);
  const addEnd = (cell, side, plan, which) => { const k = `${cell}|${side}`; if (!ends.has(k)) ends.set(k, []); ends.get(k).push({ plan, which }); };
  for (const p of plans) { addEnd(p.l.from, p.sa, p, 'a'); addEnd(p.l.to, p.sb, p, 'b'); }
  for (const [k, list] of ends) {
    const [cell, side] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)];
    const other = (e) => { const p = e.plan; const os = e.which === 'a' ? p.sb : p.sa, oc = e.which === 'a' ? rects[p.l.to] : rects[p.l.from]; return R0.tOf(os, anchorOn(oc, os).c); };
    const sorted = [...list].sort((x, y) => (side === 'top' || side === 'right' ? other(x) - other(y) : other(y) - other(x)));
    sorted.forEach((e, i) => { const a = anchorOn(rects[cell], side, i, list.length); e.plan[e.which === 'a' ? 'ca' : 'cb'] = a; });
  }
  // 차선: 짧은 길부터 안쪽 차선에. 둘레 위 구간이 겹치면 다른 차선
  const span = (p) => { const R = ring(O, gap); const t0 = R.tOf(p.sa, p.ca.c); return p.cw ? [t0, t0 + p.arc] : [t0 - p.arc, t0]; };
  const P0 = R0.P;
  const overlap = (u, v) => { for (const s of [-P0, 0, P0]) if (Math.min(u[1], v[1] + s) - Math.max(u[0], v[0] + s) > -2) return true; return false; };
  const lanes = [];
  const routes = [];
  for (const p of [...plans].sort((x, y) => x.len - y.len)) {
    const sp = span(p);
    let lane = lanes.findIndex((list) => !list.some((q) => overlap(sp, q)));
    if (lane < 0) { lane = lanes.length; lanes.push([]); }
    lanes[lane].push(sp);
    const d = gap + lane * step;
    const r = routeShape(O, d, p.sa, p.ca.c, p.ca.p, p.sb, p.cb.c, p.cb.p, p.cw);
    routes.push({ linkId: p.l.linkId, from: p.l.from, to: p.l.to, kind: p.kind, sides: [p.sa, p.sb], lane, d, points: r.points });
  }
  const order = new Map(inside.map((l, i) => [l.linkId, i]));
  routes.sort((x, y) => order.get(x.linkId) - order.get(y.linkId));
  return { bridges, routes, chips };
}

// 꺾은선 → 모서리를 둥글게 깎은 SVG 길(r: 모서리 반지름, 이웃 선분 길이의 절반을 넘지 않는다)
export function roundedPath(points, r = 8) {
  if (!points || !points.length) return '';
  const f = (n) => Math.round(n * 100) / 100;
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1], q = points[i], n = points[i + 1];
    const l1 = Math.hypot(q.x - p.x, q.y - p.y), l2 = Math.hypot(n.x - q.x, n.y - q.y);
    const k = Math.min(r, l1 / 2, l2 / 2);
    if (!(k > 0)) { d += ` L${f(q.x)} ${f(q.y)}`; continue; }
    const a = { x: q.x + ((p.x - q.x) * k) / l1, y: q.y + ((p.y - q.y) * k) / l1 }, b = { x: q.x + ((n.x - q.x) * k) / l2, y: q.y + ((n.y - q.y) * k) / l2 };
    d += ` L${f(a.x)} ${f(a.y)} Q${f(q.x)} ${f(q.y)} ${f(b.x)} ${f(b.y)}`;
  }
  const z = points[points.length - 1];
  return `${d} L${f(z.x)} ${f(z.y)}`;
}

// 꺾은선 끝(받는 칸 테두리)의 화살촉 세 점(size: 길이)
export function arrowHead(points, size = 8) {
  const q = points[points.length - 1], p = points[points.length - 2] || q;
  const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const ux = (q.x - p.x) / l, uy = (q.y - p.y) / l;
  const b = { x: q.x - ux * size, y: q.y - uy * size };
  return [q, { x: b.x - uy * size * 0.6, y: b.y + ux * size * 0.6 }, { x: b.x + uy * size * 0.6, y: b.y - ux * size * 0.6 }];
}

// 일이 오가는 중인가(Links.jsx 일반 선이 빛나는 조건과 같다): 받는 쪽이 일하는 중이고 30분 안에 지시가 갔다
export const ACTIVE_MS = 30 * 60 * 1000;
export function linkActive(link, to, now = Date.now()) {
  return !!(link && to && to.state === 'working' && link.lastAt && now - link.lastAt < ACTIVE_MS && ['prompt', 'target_submitted', 'target_working'].includes(link.lastKind));
}

// ---------- P46: 배율별 모양 ----------
// 아주 멀리서(작을 때)는 화살표만(mini), 그보다 가까우면 역할 이름(short), 가까우면 누가 누구에게 · 역할 · 받는 쪽 상태(full).
// 글은 선을 따라 놓는다: 세로 경계·세로 바깥 선분 위에서는 글을 세워(90° 돌려) 경계 폭만큼만 차지하고 터미널 글을 덮지 않는다.
export const DOCK_LABEL_ZOOM = { short: 0.4, full: 0.8 }; // 이 배율부터 그 모양
export const DOCK_LABEL_MIN = { short: 44, full: 130 }; // 그 모양에 필요한 최소 자리(화면 px). 모자라면 한 단계 내린다
export const DOCK_LABEL_MAX = 340; // 글 길이 상한(화면 px). 분할선을 잡을 자리를 남긴다
export const dockLabelLevel = (zoom) => (zoom >= DOCK_LABEL_ZOOM.full ? 'full' : zoom >= DOCK_LABEL_ZOOM.short ? 'short' : 'mini');
// zoom: 배율, room: 선을 따라 쓸 수 있는 길이(판 px) → { level, max(글 최대 길이, 판 px) }
export function fitDockLabel(zoom, room) {
  const order = ['mini', 'short', 'full'];
  const want = dockLabelLevel(zoom);
  const z = Math.max(zoom, 0.02);
  const screen = Math.min(DOCK_LABEL_MAX, Math.max(0, room * z * 0.7)); // 자리의 70%까지(양쪽에 분할선 잡을 곳)
  let i = order.indexOf(want);
  while (i > 0 && screen < DOCK_LABEL_MIN[order[i]]) i--;
  return { level: order[i], max: screen / z };
}
// 바깥 길(괄호·둘레 길) 위 글 자리: 가장 긴 바깥 선분의 가운데. → { x, y, len(선분 길이), vertical }
export function labelSpot(points) {
  let best = null;
  for (let i = 1; i < points.length - 2; i++) {
    const a = points[i], b = points[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!best || len > best.len) best = { len, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vertical: Math.abs(b.x - a.x) < Math.abs(b.y - a.y) };
  }
  return best || { ...(points[0] || { x: 0, y: 0 }), len: 0, vertical: false };
}
// 글의 낱말들. names: 칸 id → 세션 이름, words: { spawned, directed }(사전의 말, Links.jsx 선 글과 같다)
// → { role(사용자가 붙인 역할, 없으면 띄움·작업 요청), dir('@a → @b'), spawnTag(역할도 있고 띄우기도 했는가) }
export function dockLabelParts(link, names, words) {
  const role = link.role || (link.spawned && !link.observed ? words.spawned : words.directed);
  return { role, dir: `@${names[link.from] || '?'} → @${names[link.to] || '?'}`, spawnTag: !!(link.role && link.spawned) };
}

// 연결 하나가 칸 id에 닿는가(강조할 때)
export const touches = (l, id) => !!id && (l.from === id || l.to === id);

const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const insidePt = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// 덩어리의 초점 세션 하나. rects: { id: 사각형 }(같은 좌표계), selected: 고른 세션들(순서대로), focusId: 마지막에 눌러 들어간 세션,
// view: 화면에 보이는 판 사각형(같은 좌표계)이나 null, center: 화면 가운데가 든 칸도 초점으로 보는가(P26 기본 true. P30 강조는 false)
// 차례: 고른 구성 노드(처음 것) > 눌러 들어간 구성 노드(화면에 보일 때) > 화면 가운데가 든 구성 노드 > 없음
export function dockFocus({ rects, selected = [], focusId = null, view = null, center = true }) {
  const has = (id) => id != null && Object.prototype.hasOwnProperty.call(rects, id);
  const sel = (selected || []).find(has);
  if (sel) return sel;
  if (has(focusId) && (!view || meets(rects[focusId], view))) return focusId;
  if (view && center) {
    const c = centerOf(view);
    for (const [id, r] of Object.entries(rects)) if (insidePt(c, r)) return id;
  }
  return null;
}

// Legacy geometry API retained for existing callers; DockLinks uses dockRoutes.
// 사각형 r의 테두리 가운데 중 점 p 쪽(가운데에서 p로 가는 선이 지나는 쪽)
// → { x, y, side: 'left' | 'right' | 'top' | 'bottom' }
export function borderAnchor(r, p) {
  const c = centerOf(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  // 가운데에서 p로 가는 선이 세로 테두리(좌우)를 먼저 지나는가: |dx| / (w/2) ≥ |dy| / (h/2)
  if (Math.abs(dx) * r.h >= Math.abs(dy) * r.w) return dx >= 0 ? { x: r.x + r.w, y: c.y, side: 'right' } : { x: r.x, y: c.y, side: 'left' };
  return dy >= 0 ? { x: c.x, y: r.y + r.h, side: 'bottom' } : { x: c.x, y: r.y, side: 'top' };
}

// 연결 하나의 두 끝. from·to: 사각형, focus: 'from' | 'to' | null(초점 세션이 어느 쪽인가)
// → { a(from 쪽 끝), b(to 쪽 끝), anchored: 'from' | 'to' | null }
export function linkEnds(from, to, focus = null) {
  const a = centerOf(from), b = centerOf(to);
  if (focus === 'from') return { a: borderAnchor(from, b), b, anchored: 'from' };
  if (focus === 'to') return { a, b: borderAnchor(to, a), anchored: 'to' };
  return { a, b, anchored: null };
}

// 선 글 자리. items: [{ a, b, w, h }](선의 두 끝, 글 상자 크기). 글은 시키는 쪽(a) 가까이(선의 0.36) 두고,
// 앞서 놓은 글과 겹치면 선을 따라 다른 자리(KS 차례)로 옮긴다. 다 겹치면 처음 자리 → [{ x, y, k }](글 가운데)
export const LABEL_KS = [0.36, 0.22, 0.5, 0.64, 0.12, 0.78];
export function placeLabels(items) {
  const placed = [];
  return items.map(({ a, b, w, h }) => {
    const at = (k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, k });
    const hits = (p) => placed.some((q) => Math.abs(p.x - q.x) * 2 < w + q.w && Math.abs(p.y - q.y) * 2 < h + q.h);
    const p = LABEL_KS.map(at).find((c) => !hits(c)) || at(LABEL_KS[0]);
    placed.push({ ...p, w, h });
    return p;
  });
}
