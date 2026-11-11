// P89 → P95 → P101: 휴대폰 미션 맵(PhoneMission.jsx)의 배치. PC(lib/mission-layout.js)와 같은 시각 언어를 화면 폭에 맞춘다. 순수 함수만 둔다(단위 시험 app/test/p95-lib.test.mjs, p89-lib.test.mjs, p101-lib.test.mjs).
// - 입력은 lib/phone-mission.js의 결과(무리, 깊이 우선 줄, 강조 등급, 역할). 자료는 그대로 mission.graph만이다.
// - 화면 폭을 칸(lane)으로 나눈다: 세로 휴대폰 2칸, 가로 4칸쯤(lanesFor). 칸 폭은 화면에 맞춰 배율 1에서 읽힌다.
// - 팀이 있는 워크스페이스는 두 칸 덩어리: 왼쪽 칸에 리드, 오른쪽 칸에 그 하위 세션(손자는 조금 들여)을 놓고 리드 오른쪽에서 가는 곡선이 나간다(PC와 같은 왼쪽 → 오른쪽).
//   다른 워크스페이스의 하위 세션도 부모 팀 안에 놓는다. 하위가 많고 쉬는 것이 많으면 쉬는 하위는 동그라미 줄로 접는다.
// - 팀이 없는 워크스페이스(혼자인 세션뿐)는 한 칸 덩어리로, 가장 낮은 칸부터 채운다. 그래서 워크스페이스가 많고 세션이 한두 개씩인 판도 세로 한 줄로 늘어서지 않는다.
// - P101: 덩어리마다 옅은 판(plate, 칸 폭 그대로)이 있고 머리 글과 세션은 판 안 여백(IN)만큼 들어간다. 판 사이 틈은 가로 GAP, 세로 BLOCK_GAP.
// - 세션은 카드(일함·응답 필요·오류·결과, 하위가 있는 세션) 또는 테두리 있는 알약(쉼·잠듦·끝남).
// - P101: 선은 PC와 같은 길(lib/mission-wire.js): 마주 보는 가장자리 사이, 서로 이은 두 세션은 짧은 두 줄과 화살촉(같은 칸의 손자는 겹친 두 꺾임),
//   같은 칸의 이웃은 아래·위 가장자리 사이 짧은 줄(이은 이웃 형제 사이는 LINK_GAP만큼 벌린다). 멀리 가는 나무 밖 선은 긋지 않는다(휴대폰은 가리키기가 없다).
// - 보기(이동·배율): fitView(처음과 "맞추기": 폭에 맞추고 위에 붙인다), clampView, focusView(요약 칩의 등급으로 맞추기).
import { wire, facing, blocked, portY, tipPath, WIRE } from './mission-wire.js';

export const PG = { PAD: 2, GAP: 8, LANE_MIN: 168, CARD_H: 58, ROW_H: 30, VGAP: 8, HEAD: 28, IN: 6, BLOCK_GAP: 10, INDENT: 12, DOT: 16, DOT_GAP: 6, DOTS_MIN: 6, DOTS_FOLD: 3, R: 6, TEAM_IN: 16, LINK_SPAN: 200, LINK_GAP: 18, BULGE: 8 }; // TEAM_IN: 팀 덩어리의 하위 칸을 들여 리드 → 하위 곡선이 펼쳐질 자리
export const VIEW = { PAD: 10, ZMIN: 0.25, ZMAX: 2.5, FIT_MAX: 1.25, MARGIN: 72, FOCUS_MAX: 1.2 };

// 그래프 폭(px) → 칸 수: 세로 휴대폰 2, 가로 4, 넓으면 6까지
export const lanesFor = (width) => { const n = Math.floor(((width || 0) - 2 * PG.PAD + PG.GAP) / (PG.LANE_MIN + PG.GAP)); return Math.max(2, Math.min(6, n > 2 && n % 2 ? n - 1 : n)); }; // 짝수(넓은 덩어리가 두 칸씩)
const n2 = (v) => Math.round(v * 10) / 10;
const REST = ['rest', 'sleep', 'done'];
const mid = (b) => b.y + b.h / 2;

// 깊이 우선 줄(depth) → 무리 안 나무 자식. 줄 순서가 곧 자리 순서다(띄운 순서, 상태가 바뀌어도 자리 그대로)
function treeOf(rows) {
  const kids = new Map(), roots = [], stack = [];
  for (const r of rows) {
    while (stack.length && stack[stack.length - 1].depth >= r.depth) stack.pop();
    const p = stack.length ? stack[stack.length - 1] : null;
    if (p && r.depth > 0) { if (!kids.has(p.id)) kids.set(p.id, []); kids.get(p.id).push(r); } else roots.push(r);
    stack.push(r);
  }
  return { kids, roots };
}

// 같은 칸의 부모 → 손자 꺾임(부모 왼쪽 아래에서 내려와 손자 왼쪽으로). off: 서로 이은 두 꺾임의 비킴(바깥 꺾임이 아래에서 돌아 겹치지 않는다),
// back: 손자 → 부모(끝이 부모 아래 가장자리, 위를 가리키는 화살촉)
function elbowOf(a, b, { off = 0, tip = false, back = false } = {}) {
  const R = PG.R, x = a.x + 8 + off, y2 = mid(b) - off, y1 = a.y + a.h, T = tip ? WIRE.tip : 0;
  if (!back) return { d: `M${n2(x)} ${n2(y1)}V${n2(y2 - R)}Q${n2(x)} ${n2(y2)} ${n2(x + R)} ${n2(y2)}H${n2(b.x - T)}`, tip: tip ? tipPath(b.x, y2, 'r') : null };
  return { d: `M${n2(b.x)} ${n2(y2)}H${n2(x + R)}Q${n2(x)} ${n2(y2)} ${n2(x)} ${n2(y2 - R)}V${n2(y1 + T)}`, tip: tip ? tipPath(x, y1, 'u') : null };
}

// pm: phoneMission 결과, width: 그래프 폭(화면 폭에서 보기 여백을 뺀 것)
// → { nodes: [{ id, row, group, x, y, w, h, kind: 'card'|'row'|'dot', cross }], edges: [{ id, from, to, kind: 'tree'|'link', rel, d, tip, route, pair, tier, active }],
//     groups: [{ key, x, y, w, plate: { x, y, w, h }, folded, count, work, turn, vg, wide }], dots: [{ id, x, y, n }], lanes, laneW, width, height }
export function phoneGraph(pm, { width = 373 } = {}) {
  const { PAD, GAP, CARD_H, ROW_H, VGAP, HEAD, IN, BLOCK_GAP, INDENT, DOT, DOT_GAP, DOTS_MIN, DOTS_FOLD } = PG;
  const lanes = lanesFor(width);
  const laneW = Math.floor((width - 2 * PAD - (lanes - 1) * GAP) / lanes);
  const laneX = (i) => PAD + i * (laneW + GAP);
  const groupsIn = (pm && pm.groups) || [];
  // 모든 줄과 무리 안 나무. 다른 무리 부모(fromId)가 보이면 그 팀 아래로 옮긴다
  const rowOf = new Map(), kids = new Map(), rootsOf = new Map(), groupOfRow = new Map();
  for (const g of groupsIn) for (const r of g.rows || []) { rowOf.set(r.id, r); groupOfRow.set(r.id, g.key); }
  for (const g of groupsIn) {
    const t = treeOf(g.rows || []);
    for (const [k, v] of t.kids) kids.set(k, [...v]);
    rootsOf.set(g.key, t.roots);
  }
  for (const g of groupsIn) {
    const keep = [];
    for (const r of rootsOf.get(g.key) || []) {
      if (r.fromId && rowOf.has(r.fromId)) { if (!kids.has(r.fromId)) kids.set(r.fromId, []); kids.get(r.fromId).push(r); } else keep.push(r);
    }
    rootsOf.set(g.key, keep);
  }
  // P101: 나무 밖으로 이은 두 세션(어느 쪽이든). 이웃 형제 사이는 LINK_GAP만큼 벌린다
  const linked = new Set();
  for (const r of rowOf.values()) for (const l of r.links || []) { linked.add(`${r.id}|${l.toId}`); linked.add(`${l.toId}|${r.id}`); }
  const linksTo = (from, to) => ((rowOf.get(from) || {}).links || []).find((l) => l.toId === to) || null;
  const kidsOf = (id) => kids.get(id) || [];
  const isRest = (r) => REST.includes(r.tier) && !kidsOf(r.id).length;
  const kindFor = (r) => (isRest(r) ? 'row' : 'card');
  const hOf = (k) => (k === 'card' ? CARD_H : ROW_H);
  const nodes = [], edges = [], groups = [], dots = [], at = new Map(), drawn = new Set();
  const put = (row, group, x, y, w, kind) => { const nd = { id: row.id, row, group, x: n2(x), y: n2(y), w: n2(w), h: kind === 'dot' ? DOT : hOf(kind), kind, cross: groupOfRow.get(row.id) !== group }; nodes.push(nd); at.set(row.id, nd); return nd; }; // cross: 다른 무리의 하위 세션을 부모 팀 안에 놓았다
  const sky = Array(lanes).fill(PAD);
  const push = (a, b, kind, rel, w, { pair = false, route = 'flow', tier = b.row ? b.row.tier : 'rest', active = false } = {}) => {
    edges.push({ id: `${kind === 'tree' ? 't' : 'l'}:${a.id}>${b.id}`, from: a.id, to: b.id, kind, rel, d: w.d, tip: w.tip || null, route, pair, tier, active });
    drawn.add(`${a.id}>${b.id}`);
  };
  // 부모 → 하위 나무 선. 하위가 부모에게 되돌아오는 선이 있으면 짧은 두 줄로 같이 긋는다
  const treeLine = (pn, kn) => {
    const back = linksTo(kn.id, pn.id);
    const rel = kn.row.rel || 'spawn', active = !!kn.row.active || kn.row.tier === 'work';
    if (pn.x + pn.w <= kn.x) {
      const y = portY(pn, kn, { edge: 10 });
      push(pn, kn, 'tree', rel, wire(pn, kn, { y1: y, off: back ? -WIRE.off : 0, tip: !!back }), { pair: !!back, route: back ? 'pair' : 'flow', active });
      if (back) push(kn, pn, 'link', back.rel || 'role', wire(kn, pn, { y2: y, off: WIRE.off, tip: true, route: 'l' }), { pair: true, route: 'pair', tier: pn.row.tier, active: !!back.active });
      return;
    }
    push(pn, kn, 'tree', rel, elbowOf(pn, kn, back ? { off: -WIRE.off, tip: true } : {}), { pair: !!back, route: back ? 'pair' : 'flow', active });
    if (back) push(kn, pn, 'link', back.rel || 'role', elbowOf(pn, kn, { off: WIRE.off, tip: true, back: true }), { pair: true, route: 'pair', tier: pn.row.tier, active: !!back.active });
  };

  for (const g of groupsIn) {
    const roots = rootsOf.get(g.key) || [];
    if (!g.folded && !roots.length) continue; // 세션이 모두 다른 팀 안에 놓였다
    const team = !g.folded && roots.some((r) => kidsOf(r.id).length);
    const span = team ? Math.min(2, lanes) : 1;
    // 자리: 가장 낮은 칸(넓은 덩어리는 짝수 칸에서 시작하는 두 칸)
    let c = 0, best = Infinity;
    for (let i = 0; i + span <= lanes; i += span === 2 ? 2 : 1) { const top = Math.max(...sky.slice(i, i + span)); if (top < best - 0.5) { best = top; c = i; } }
    const top = best, x = laneX(c), pw = span * laneW + (span - 1) * GAP;
    const grp = { key: g.key, x: n2(x + IN), y: n2(top + 4), w: n2(pw - 2 * IN), plate: null, folded: !!g.folded, count: g.count, work: g.work, turn: g.turn, vg: g.vg || null, wide: team };
    groups.push(grp);
    let y = top + HEAD;
    if (g.folded || !roots.length) { grp.plate = { x: n2(x), y: n2(top), w: n2(pw), h: HEAD }; for (let i = c; i < c + span; i++) sky[i] = top + HEAD + BLOCK_GAP; continue; }
    if (team) {
      const lx = x + IN, lw = laneW - IN; // 리드 칸(오른쪽 끝은 칸 끝)
      const x2 = laneX(c + 1) + PG.TEAM_IN, kw = laneW - PG.TEAM_IN - IN; // 하위 칸
      for (const r of roots) {
        const ch = kidsOf(r.id);
        if (!ch.length) { const nd = put(r, g.key, lx, y, lw, kindFor(r)); y += nd.h + VGAP; continue; }
        // 하위 세션들(오른쪽 칸): 깊이 우선, 손자는 들여. 쉬는 하위가 많으면 동그라미 줄. 이은 이웃 형제 사이는 벌린다
        const start = y;
        let cy = y;
        const placeKids = (p, depth) => {
          const list = kidsOf(p.id);
          const rest = list.filter(isRest);
          const fold = list.length >= DOTS_MIN && rest.length >= DOTS_FOLD ? rest : [];
          let prev = null;
          for (const k of list.filter((z) => !fold.includes(z))) {
            if (prev && linked.has(`${prev.id}|${k.id}`)) cy = Math.max(cy, prev.y + prev.h + PG.LINK_GAP);
            const ind = Math.min(depth, 3) * INDENT;
            const nd = put(k, g.key, x2 + ind, cy, kw - ind, kindFor(k));
            cy += nd.h + VGAP;
            prev = nd;
            placeKids(k, depth + 1);
          }
          if (fold.length) {
            const ind = Math.min(depth, 3) * INDENT, per = Math.max(1, Math.floor((kw - ind - 8) / (DOT + DOT_GAP)) - 2);
            const id = `dots:${p.id}`, rows = Math.ceil(fold.length / per);
            dots.push({ id, parent: p.id, x: n2(x2 + ind), y: n2(cy), w: n2(kw - ind), h: rows * (DOT + DOT_GAP) - DOT_GAP + 4, n: fold.length, per });
            fold.forEach((k, i) => put(k, g.key, x2 + ind + 2 + (i % per) * (DOT + DOT_GAP), cy + 2 + Math.floor(i / per) * (DOT + DOT_GAP), DOT, 'dot'));
            cy += rows * (DOT + DOT_GAP) - DOT_GAP + 4 + VGAP;
          }
        };
        placeKids(r, 0);
        const lh = hOf(kindFor(r));
        const ly = Math.max(start, (start + cy - VGAP) / 2 - lh / 2);
        const lead = put(r, g.key, lx, ly, lw, kindFor(r));
        // 선: 리드 → 하위(곡선), 하위 → 손자(같은 칸, 둥근 꺾임), 동그라미 줄은 한 선
        const link = (p) => {
          const pn = at.get(p.id);
          for (const k of kidsOf(p.id)) {
            const kn = at.get(k.id);
            if (!kn || kn.kind === 'dot') continue;
            treeLine(pn, kn);
            link(k);
          }
          const dg = dots.find((d) => d.parent === p.id);
          if (dg) { const box = { id: dg.id, x: dg.x, y: dg.y, w: dg.w, h: dg.h, row: { tier: 'rest', rel: 'spawn' } }; push(pn, box, 'tree', 'spawn', pn.x + pn.w <= box.x ? wire(pn, box, { y1: portY(pn, box, { edge: 10 }) }) : elbowOf(pn, box), { tier: 'rest' }); }
        };
        link(r);
        y = Math.max(cy, lead.y + lead.h + VGAP);
      }
    } else {
      for (const r of roots) { const nd = put(r, g.key, x + IN, y, laneW - 2 * IN, kindFor(r)); y += nd.h + VGAP; }
    }
    const bottom = y - VGAP + IN;
    grp.plate = { x: n2(x), y: n2(top), w: n2(pw), h: n2(bottom - top) };
    for (let i = c; i < c + span; i++) sky[i] = bottom + BLOCK_GAP;
  }
  // 나무 밖 연결(두 번째 지시자, 역할 선): 마주 보는 가장자리 사이. 서로 이었으면 짧은 두 줄, 같은 칸 이웃은 아래·위 가장자리, 사이에 카드가 있으면 오른쪽 작은 괄호.
  // 멀리 가는 나무 밖 선(세로 LINK_SPAN 넘게)은 지도를 세로로 가르므로 긋지 않는다(휴대폰은 가리키기가 없다. PC는 가리킬 때만)
  const solid = nodes.filter((n) => n.kind !== 'dot');
  for (const nd of nodes) for (const l of nd.row.links || []) {
    const b = at.get(l.toId);
    if (!b || drawn.has(`${nd.id}>${l.toId}`)) continue;
    let route = facing(nd, b) || 'side';
    if ((route === 'd' || route === 'u') && blocked(nd, b, solid)) route = 'side';
    if (route !== 'd' && route !== 'u' && Math.abs(mid(b) - mid(nd)) > PG.LINK_SPAN) continue;
    const back = linksTo(l.toId, nd.id);
    const mutual = !!back && !drawn.has(`${l.toId}>${nd.id}`);
    const fwd = route === 'r' || route === 'd' || (route === 'side' && mid(b) >= mid(nd));
    const off = mutual ? (fwd ? -WIRE.off : WIRE.off) : 0;
    const kind = mutual ? 'pair' : route === 'd' || route === 'u' ? 'near' : route === 'l' ? 'back' : route === 'side' ? 'side' : 'flow';
    push(nd, b, 'link', l.rel || 'role', wire(nd, b, { route, off, tip: kind !== 'flow', bulge: PG.BULGE, maxX: width + VIEW.PAD - 4 }), { pair: mutual, route: kind, active: !!l.active }); // 괄호는 화면 여백(VIEW.PAD) 안까지
    if (mutual) {
      const rr = { r: 'l', l: 'r', d: 'u', u: 'd' }[route] || 'side';
      push(b, nd, 'link', back.rel || 'role', wire(b, nd, { route: rr, off: -off, tip: true, bulge: PG.BULGE, maxX: width + VIEW.PAD - 4 }), { pair: true, route: 'pair', tier: nd.row.tier, active: !!back.active });
    }
  }
  for (const g of groups) if (!g.folded) { const ns = nodes.filter((n) => n.group === g.key); g.count = ns.length; g.work = ns.filter((n) => n.row.tier === 'work').length; g.turn = ns.filter((n) => n.row.tier === 'turn' || n.row.tier === 'alert').length; } // 머리 글의 수는 그 아래 놓인 세션(PC와 같다)
  const height = n2(Math.max(PAD, ...sky) - BLOCK_GAP + PAD);
  return { nodes, edges, groups, dots, lanes, laneW, width: n2(width), height: Math.max(height, PAD * 2) };
}

// ---- 보기(이동·배율). v: { x, y, zoom }(화면 px = 월드 × zoom + x), size: 그래프 { width, height }, vp: 화면 { w, h } ----
// 처음과 "맞추기": 폭에 맞추고(그래프 폭은 화면에 맞춰 놓았으므로 보통 배율 1) 위에 붙인다. 아래는 옮겨 본다
export function fitView(size, vp) {
  const { PAD, FIT_MAX } = VIEW;
  const w = Math.max(1, size.width);
  const zoom = Math.max(0.01, Math.min((vp.w - 2 * PAD) / w, FIT_MAX)); // 아주 넓으면 ZMIN 아래로도(범위는 zoomRange가 넓힌다)
  const x = (vp.w - w * zoom) / 2;
  return { x: n2(x), y: PAD, zoom: Math.round(zoom * 1000) / 1000 };
}
// 배율 범위: [min(ZMIN, 맞춘 배율), ZMAX]
export const zoomRange = (size, vp) => ({ minZoom: Math.min(VIEW.ZMIN, fitView(size, vp).zoom), maxZoom: VIEW.ZMAX });
// 그래프가 화면 밖으로 사라지지 않게: 그래프의 MARGIN px 이상이 늘 화면 안에 남는다(그래프가 그보다 작으면 그래프 전체)
export function clampView(v, size, vp) {
  const { minZoom, maxZoom } = zoomRange(size, vp);
  const zoom = Math.min(maxZoom, Math.max(minZoom, Number.isFinite(v.zoom) ? v.zoom : 1));
  const keep = (len, screen) => Math.min(VIEW.MARGIN, len, screen);
  const cw = size.width * zoom, ch = size.height * zoom;
  const kx = keep(cw, vp.w), ky = keep(ch, vp.h);
  const x = Math.min(vp.w - kx, Math.max(kx - cw, Number.isFinite(v.x) ? v.x : 0));
  const y = Math.min(vp.h - ky, Math.max(ky - ch, Number.isFinite(v.y) ? v.y : 0));
  return { x, y, zoom };
}
// 고른 카드들(요약 칩의 등급)이 한 화면에 들게. 카드가 없으면 null
export function focusView(nodes, vp) {
  if (!nodes || !nodes.length) return null;
  const P = 24;
  const x0 = Math.min(...nodes.map((n) => n.x)) - P, y0 = Math.min(...nodes.map((n) => n.y)) - P;
  const x1 = Math.max(...nodes.map((n) => n.x + n.w)) + P, y1 = Math.max(...nodes.map((n) => n.y + n.h)) + P;
  const zoom = Math.max(VIEW.ZMIN, Math.min(VIEW.FOCUS_MAX, (vp.w - 2 * VIEW.PAD) / (x1 - x0), (vp.h - 2 * VIEW.PAD) / (y1 - y0)));
  return { x: n2(vp.w / 2 - ((x0 + x1) / 2) * zoom), y: n2(vp.h / 2 - ((y0 + y1) / 2) * zoom), zoom: Math.round(zoom * 1000) / 1000 };
}
// 요약 칩의 등급에 드는 카드인가(응답 필요 칩은 오류도 센다, phone-mission.js tally와 같다)
export const inFocus = (focus, tier) => !focus || (focus === 'work' ? tier === 'work' : tier === 'turn' || tier === 'alert');
// 화면 크기 키(돌아오면 같은 키일 때만 마지막 보기를 다시 쓴다)
export const vpKey = (vp) => `${Math.round(vp.w)}x${Math.round(vp.h)}`;
// 카드의 브랜치 표시: 워크트리에서 도는 세션이면 그 브랜치(없으면 워크트리 이름). live: 판의 세션 요약(이미 받은 것)
export const branchOf = (live) => (live && live.git && live.git.isWorktree && live.git.branch) || (live && live.branch && live.branch.worktree) || null;
