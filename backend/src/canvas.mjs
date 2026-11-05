// 단일 캔버스와 관계 표현(ARCH 4절 H, P6a). 순수 함수만 둔다. 창(renderer)도 이 파일을 그대로 묶어 쓴다(node 모듈을 부르지 않는다).
//
// - 워크스페이스 영역(H1): 한 워크스페이스의 노드, 메모·칸반을 감싸는 사각형. 위에 이름표 자리(REGION_HEAD)를 둔다. 안이 비면 저장한 자리(anchor)에 빈 영역.
// - 빈자리(H1): 새 노드는 그 워크스페이스 영역 안이나 바로 옆에 놓고, 다른 노드와 겹치지 않고, 영역끼리 겹치지 않게 한다. 새 워크스페이스는 다른 영역과 겹치지 않는 곳에.
// - 붙여 묶기(H5): 덩어리는 분할 나무다(P17, dock-tree.mjs). 구성 노드의 자리와 크기는 nodes 표에 두고, 덩어리는 나무(방향과 비율)를 가진다.
// - 정리(H7): 연결을 따라 시키는 쪽을 왼쪽에 크게, 받는 쪽을 오른쪽에 작게 두는 나무 배치. 덩어리는 한 덩어리로 옮긴다.

export const NODE = { w: 720, h: 460 };
export const GAP = 40; // 노드 사이 틈
// H7 크기 단계. large·normal·small은 노드 메뉴와 정리(arrange)가 쓴다.
// P23: 고른 노드 막대의 가로(16:9)·세로(약 2:3) 크기. wide-large는 배율 1에서 1600×920 안팎의 창 화면을 대략 채운다.
// 세로는 터미널이 읽히는 너비(글자 14px로 55칸 이상)를 지킨다
export const SIZE_STEPS = {
  large: { w: 1040, h: 660 }, normal: { w: 720, h: 460 }, small: { w: 480, h: 300 },
  'wide-large': { w: 1440, h: 810 }, 'wide-normal': { w: 1040, h: 585 }, 'wide-small': { w: 720, h: 405 },
  'tall-large': { w: 720, h: 1120 }, 'tall-normal': { w: 600, h: 920 }, 'tall-small': { w: 480, h: 740 },
};
export const BAR_SIZES = { wide: ['wide-large', 'wide-normal', 'wide-small'], tall: ['tall-large', 'tall-normal', 'tall-small'] };
export const REGION_PAD = 40; // 영역 테두리와 안의 것 사이
export const REGION_HEAD = 72; // 영역 이름표 자리(안의 것 위)
export const REGION_GAP = 240; // 영역 사이 최소 거리(멀리서 커지는 이름표가 들어갈 자리)
export const EMPTY_REGION = { w: 800, h: 320 }; // 세션이 없는 워크스페이스의 영역
export const AUTO_EMPTY_REGION = { w: 520, h: 200 }; // P10: 리포 스스로 찾기가 연 빈 워크스페이스(auto)의 영역. 캔버스를 덜 차지하게 작게
export const DOCK_MIN = 240; // 분할선으로 줄일 수 있는 가장 작은 폭(높이)

export const overlaps = (a, b, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

export function bbox(rects) {
  const rs = rects.filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.y));
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + (r.w || 0))), y1 = Math.max(...rs.map((r) => r.y + (r.h || 0)));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// 워크스페이스 영역(H1): 안의 것(노드, 메모·칸반)을 감싼다. 비었으면 anchor 자리의 빈 영역
export function regionRect(contentRects, anchor = null) {
  const b = bbox(contentRects);
  if (b) return { x: b.x - REGION_PAD, y: b.y - REGION_PAD - REGION_HEAD, w: b.w + 2 * REGION_PAD, h: b.h + 2 * REGION_PAD + REGION_HEAD };
  if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) { const e = anchor.empty || (anchor.auto ? AUTO_EMPTY_REGION : EMPTY_REGION); return { x: anchor.x, y: anchor.y, w: e.w, h: e.h }; } // P27: 워크트리 영역은 empty로 크기를 준다
  return null;
}

// workspaces: [{ key, x, y }](x·y는 저장한 자리), items: [{ ws, x, y, w, h }](노드와 그룹) → Map key → 영역
export function regionsOf(workspaces, items) {
  const by = new Map();
  for (const it of items) { if (!it.ws) continue; if (!by.has(it.ws)) by.set(it.ws, []); by.get(it.ws).push(it); }
  const out = new Map();
  for (const w of workspaces) { const r = regionRect(by.get(w.key) || [], w); if (r) out.set(w.key, r); }
  return out;
}

// 새 영역(새 워크스페이스, 옮기기)을 둘 자리: 다른 영역과 REGION_GAP 넘게 떨어진 곳. 화면 비율(가로가 넓다)을 생각해 전체가 덜 길쭉해지는 쪽을 고른다
export function newRegionSlot(regions, size = EMPTY_REGION, { aspect = 1.6 } = {}) {
  const rs = [...(regions instanceof Map ? regions.values() : regions)].filter(Boolean);
  if (!rs.length) return { x: 0, y: 0 };
  const all = bbox(rs);
  const free = (x, y) => !rs.some((r) => overlaps({ x, y, w: size.w, h: size.h }, r, REGION_GAP - 1));
  const cands = [];
  for (const r of rs) {
    cands.push({ x: r.x + r.w + REGION_GAP, y: r.y }, { x: r.x, y: r.y + r.h + REGION_GAP });
    cands.push({ x: all.x, y: r.y + r.h + REGION_GAP });
  }
  cands.push({ x: all.x, y: all.y + all.h + REGION_GAP }, { x: all.x + all.w + REGION_GAP, y: all.y });
  const score = (c) => Math.max(c.x + size.w - all.x, (c.y + size.h - all.y) * aspect) * 10 + (c.y - all.y) + (c.x - all.x) / 100;
  cands.sort((a, b) => score(a) - score(b));
  for (const c of cands) if (free(c.x, c.y)) return { x: Math.round(c.x), y: Math.round(c.y) };
  return { x: Math.round(all.x), y: Math.round(all.y + all.h + REGION_GAP) };
}

// 새 노드를 둘 빈자리(H1). wsKey 워크스페이스의 영역 안이나 바로 옆. 어느 노드·그룹과도 겹치지 않고, 그 영역이 커져도 다른 영역과 겹치지 않게
// items: [{ ws, x, y, w, h, id? }] 모든 노드와 그룹, regions: regionsOf 결과, near: 이 사각형(부모 노드) 가까이부터 찾는다
// 영역 사이 틈은 REGION_GAP/2를 먼저 지키고, 그런 자리가 없으면(사람이 영역을 다른 영역 바로 옆에 둔 경우) 겹치지만 않는 자리로 찾는다.
// 그래도 없으면 자기 영역 오른쪽 열(영역 높이 안에서 위부터). 그때 생기는 영역 겹침은 부른 쪽이 separateRegions로 푼다(P9).
// 이미 자기 영역과 겹친 영역은 후보를 거르는 데 쓰지 않는다. 쓰면 모든 후보가 거부되어 새 노드가 한 줄로 아래로 쌓인다(P9에서 찾은 영역 겹침의 원인)
// P35: 워크트리 상자(리포 영역 안)에 놓을 때는 그 상자 자신(items의 box가 wsKey인 'wtbox')을 피하지 않고, 그 상자를 감싼 리포 영역도 막는 것으로 보지 않는다
export function slotInRegion({ wsKey, size = NODE, items: all = [], regions = new Map(), near = null, skip = null }) {
  const items = all.filter((i) => !(i && i.box === wsKey));
  const own = items.filter((i) => i.ws === wsKey && i !== skip);
  const ownReg = regionRect(own) || regions.get(wsKey) || null;
  const others = [...regions].filter(([k]) => k !== wsKey).map(([, r]) => r).filter((r) => !ownReg || !overlaps(ownReg, r, -1));
  let regionGap = REGION_GAP / 2 - 1;
  const fits = (c) => {
    if (items.some((i) => i !== skip && overlaps(c, i, GAP - 1))) return false;
    const reg = regionRect([...own, c]);
    return !others.some((r) => overlaps(reg, r, regionGap));
  };
  const own0 = bbox(own);
  if (!own0) {
    const r = regions.get(wsKey);
    const c = r ? { x: r.x + REGION_PAD, y: r.y + REGION_HEAD + REGION_PAD, w: size.w, h: size.h } : { x: 0, y: 0, w: size.w, h: size.h };
    if (fits(c)) return { x: c.x, y: c.y };
  }
  // P35: 안이 빈 영역(빈 워크트리 상자)은 그 영역 안쪽 왼쪽 위를 기준으로 찾는다(판 원점 둘레로 가지 않게)
  const r0 = regions.get(wsKey);
  const base = near || own0 || (r0 ? { x: r0.x + REGION_PAD, y: r0.y + REGION_HEAD + REGION_PAD, w: size.w, h: size.h } : { x: 0, y: 0, w: size.w, h: size.h });
  const sx = size.w + GAP, sy = size.h + GAP;
  // 기준 오른쪽에서 시작해 고리 모양으로 넓혀 간다. near(부모)가 있으면 가까운 자리를 먼저, 없으면 영역이 덜 길쭉해지는 자리를 먼저(화면 비율 1.6).
  // 왼쪽·위로 넓히는 자리는 조금 미룬다(영역의 왼쪽 위가 덜 흔들리게)
  const ox = near ? near.x + near.w + GAP : base.x, oy = base.y;
  const cands = [];
  for (let r = 0; r < 9; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    cands.push({ x: ox + dx * sx, y: oy + dy * sy, w: size.w, h: size.h, r });
  }
  const o0 = own0 || base;
  const shape = (c) => { const b = bbox([...own, c]); return Math.round(Math.max(b.w, b.h * 1.6) / 50) + (c.x < o0.x ? 6 : 0) + (c.y < o0.y ? 6 : 0); };
  cands.sort((a, b) => (near ? a.r - b.r || shape(a) - shape(b) : shape(a) - shape(b) || a.r - b.r) || a.y - b.y || a.x - b.x);
  for (const c of cands) if (fits(c)) return { x: Math.round(c.x), y: Math.round(c.y) };
  regionGap = -1; // 둘째 판: 겹치지만 않게
  for (const c of cands) if (fits(c)) return { x: Math.round(c.x), y: Math.round(c.y) };
  // 셋째 판: 자기 영역 오른쪽으로 열을 더한다. 열마다 영역 높이(적어도 한 칸) 안에서 위부터 노드와 겹치지 않는 자리
  const o = own0 || base;
  const free = (c) => !items.some((i) => i !== skip && overlaps(c, i, GAP - 1));
  const rows = Math.max(1, Math.floor((o.h + GAP) / sy));
  for (let x = o.x + o.w + GAP; ; x += sx) {
    for (let r = 0; r < rows; r++) { const c = { x, y: o.y + r * sy, w: size.w, h: size.h }; if (free(c)) return { x: Math.round(c.x), y: Math.round(c.y) }; }
  }
}

// 영역끼리의 겹침 풀기(P9). regions: Map key → 영역 사각형 → Map key → { dx, dy }(옮길 것만).
// 겹친(맞닿음은 괜찮다) 두 영역 중 오른쪽(아래)에 있는 쪽을 오른쪽(아래)으로 덜 옮기는 방향으로 밀어 gap만큼 띄운다.
// 영역은 통째로 옮기므로 안의 상대 자리가 그대로이고, 오른쪽·아래로만 밀므로 영역끼리의 좌우·위아래 관계도 지킨다. 겹침이 없으면 빈 Map
export function separateRegions(regions, { gap = REGION_GAP / 2, maxRounds = 500 } = {}) {
  const list = [...regions].filter(([, r]) => r).map(([key, r], i) => ({ key, i, r: { ...r }, dx: 0, dy: 0 }));
  const later = (a, b, ax) => (ax === 'x' ? b.r.x - a.r.x || b.r.y - a.r.y : b.r.y - a.r.y || b.r.x - a.r.x) || b.i - a.i; // > 0이면 b가 그 축에서 뒤
  for (let round = 0; round < maxRounds; round++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const p = list[i], q = list[j];
      if (!overlaps(p.r, q.r, -1)) continue;
      const [xa, xb] = later(p, q, 'x') > 0 ? [p, q] : [q, p];
      const [ya, yb] = later(p, q, 'y') > 0 ? [p, q] : [q, p];
      const needX = xa.r.x + xa.r.w + gap - xb.r.x, needY = ya.r.y + ya.r.h + gap - yb.r.y;
      if (needX <= needY) { xb.r.x += needX; xb.dx += needX; } else { yb.r.y += needY; yb.dy += needY; }
      moved = true;
    }
    if (!moved) break;
  }
  return new Map(list.filter((x) => x.dx || x.dy).map((x) => [x.key, { dx: Math.round(x.dx), dy: Math.round(x.dy) }]));
}

// 어느 워크스페이스에도 속하지 않는 노드(P6c: 소속 없는 메모·칸반)를 둘 빈자리. rects(노드, 그룹, 영역) 어느 것과도 겹치지 않는다.
// near(원하는 왼쪽 위)가 비었으면 거기, 아니면 그 둘레를 고리 모양으로 넓혀 가장 가까운 곳. near가 없으면 판 전체의 오른쪽 위
export function freeSlot({ size, rects = [], near = null, gap = GAP }) {
  const rs = rects.filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.w));
  const free = (c) => !rs.some((r) => overlaps(c, r, gap - 1));
  const all = bbox(rs);
  const o = near ? { x: Math.round(near.x), y: Math.round(near.y) } : all ? { x: all.x + all.w + REGION_GAP / 2, y: all.y } : { x: 0, y: 0 };
  const sx = Math.round((size.w + gap) / 2), sy = Math.round((size.h + gap) / 2); // 반 칸씩 넓혀 원하는 자리에서 덜 멀어지게
  for (let r = 0; r < 24; r++) {
    const ring = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push({ x: o.x + dx * sx, y: o.y + dy * sy, w: size.w, h: size.h });
    ring.sort((a, b) => Math.hypot(a.x - o.x, a.y - o.y) - Math.hypot(b.x - o.x, b.y - o.y) || a.y - b.y || a.x - b.x);
    for (const c of ring) if (free(c)) return { x: c.x, y: c.y };
  }
  return all ? { x: Math.round(all.x + all.w + REGION_GAP), y: Math.round(all.y) } : o;
}

// P50(#2, U1): 배치 틀로 새로 짠 덩어리의 바깥(rect: 원하는 자리와 크기)을 둘 자리 → { x, y }.
// items: 피할 것(고른 노드는 뺀 노드, 메모·칸반, 대화 노드, 상자), own: 덩어리와 같은 영역에 남는 것, others: 다른 영역 사각형,
// prefer: 고른 노드들이 있던 사각형(비워지는 자리). 다른 것과 GAP 넘게 떨어지고, 그만큼 커진 자기 영역이 다른 영역과 붙지 않는 곳 가운데
// 원하는 자리에서 가장 가까운 곳. 거리가 같으면 비워지는 자리와 더 많이 겹치는 곳, 그다음 위, 왼쪽.
// 후보는 원하는 자리, 비워지는 자리의 왼쪽 위, 각 장애물의 네 변 바로 바깥 줄의 교차점이다.
// 영역 틈을 지킬 자리가 없으면 겹치지만 않는 자리, 그것도 없으면 모든 것의 오른쪽
export function dockSpot({ rect, items = [], own = [], others = [], prefer = [] }) {
  const rs = items.filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.w));
  const ps = prefer.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const { w, h } = rect;
  const xs = new Set([rect.x, ...ps.map((p) => p.x)]), ys = new Set([rect.y, ...ps.map((p) => p.y)]);
  for (const r of rs) { xs.add(r.x + r.w + GAP); xs.add(r.x - w - GAP); xs.add(r.x); ys.add(r.y + r.h + GAP); ys.add(r.y - h - GAP); ys.add(r.y); }
  const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + (b.w || 0)) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + (b.h || 0)) - Math.max(a.y, b.y));
  const cands = [];
  for (const x of xs) for (const y of ys) { const c = { x, y, w, h }; cands.push({ ...c, d: Math.hypot(x - rect.x, y - rect.y), keep: ps.reduce((s, p) => s + area(c, p), 0) }); }
  cands.sort((a, b) => a.d - b.d || b.keep - a.keep || a.y - b.y || a.x - b.x);
  const clear = (c) => !rs.some((r) => overlaps(c, r, GAP - 1));
  for (const gap of [REGION_GAP / 2 - 1, -1]) {
    for (const c of cands) {
      if (!clear(c)) continue;
      const reg = regionRect([...own, c]);
      if (others.some((r) => r && overlaps(reg, r, gap))) continue;
      return { x: Math.round(c.x), y: Math.round(c.y) };
    }
  }
  const all = bbox([...rs, rect]);
  return { x: Math.round(all.x + all.w + GAP), y: Math.round(rect.y) };
}

// P5 판 옮기기(H1): 워크스페이스마다 따로이던 판의 묶음(blocks: [{ key, rect }])을 겹치지 않게 늘어놓을 옮김 값. 첫 묶음은 그대로, 상대 자리는 지킨다
export function packRegions(blocks) {
  const placed = [];
  const out = new Map();
  for (const b of blocks) {
    if (!b.rect) continue;
    const at = placed.length ? newRegionSlot(placed, b.rect) : { x: b.rect.x, y: b.rect.y };
    out.set(b.key, { dx: Math.round(at.x - b.rect.x), dy: Math.round(at.y - b.rect.y) });
    placed.push({ x: at.x, y: at.y, w: b.rect.w, h: b.rect.h });
  }
  return out;
}

// ---------- 붙여 묶기(H5) ----------
// P17부터 덩어리는 분할 나무다. 나무 계산(늘어놓기, 넣기·빼기, 비율, 틀, 붙을 자리)은 dock-tree.mjs에 있다.
export { sideDir } from './dock-tree.mjs';

// herdr 탭 레이아웃(pane.layout의 패널 사각형, 글자 칸 단위)에서 child가 parent의 어느 쪽에 나뉘었는가 → 'right' | 'bottom' | 'left' | 'top'
export function splitSide(parentRect, childRect) {
  if (!parentRect || !childRect) return null;
  if (childRect.x >= parentRect.x + parentRect.width) return 'right';
  if (childRect.y >= parentRect.y + parentRect.height) return 'bottom';
  if (childRect.x + childRect.width <= parentRect.x) return 'left';
  if (childRect.y + childRect.height <= parentRect.y) return 'top';
  return null;
}

// ---------- 정리(H7) ----------
// blocks: [{ id, x, y, w, h, members: [sessionId], resizable }](노드 하나, 덩어리, 그룹), edges: [[fromSessionId, toSessionId]]
// → Map id → { x, y, w, h, size? }. 시키는 쪽(뿌리)을 왼쪽에 크게, 받는 쪽을 오른쪽에 작게. 연결이 없는 블록은 맨 아래에 나란히
export function arrangeTree(blocks, edges, { origin = { x: 0, y: 0 }, gapX = 160, gapY = GAP * 2 } = {}) {
  const bySession = new Map();
  for (const b of blocks) for (const m of b.members) bySession.set(m, b.id);
  const kids = new Map(blocks.map((b) => [b.id, []]));
  const indeg = new Map(blocks.map((b) => [b.id, 0]));
  const seenPair = new Set();
  for (const [f, t] of edges) {
    const a = bySession.get(f), b = bySession.get(t);
    if (!a || !b || a === b || seenPair.has(`${a}>${b}`)) continue;
    seenPair.add(`${a}>${b}`);
    kids.get(a).push(b); indeg.set(b, indeg.get(b) + 1);
  }
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const order = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x); // 지금 위쪽에 있던 것부터
  const visited = new Set();
  const trees = [];
  const walk = (id, depth, parent) => {
    visited.add(id);
    const node = { id, depth, children: [] };
    for (const k of kids.get(id)) if (!visited.has(k)) node.children.push(walk(k, depth + 1, id));
    return node;
  };
  for (const b of order) if (!visited.has(b.id) && indeg.get(b.id) === 0 && kids.get(b.id).length) trees.push(walk(b.id, 0, null));
  for (const b of order) if (!visited.has(b.id) && kids.get(b.id).length) trees.push(walk(b.id, 0, null)); // 고리만 있는 경우
  const lone = order.filter((b) => !visited.has(b.id) && !indeg.get(b.id));
  for (const b of order) if (!visited.has(b.id) && !lone.includes(b)) trees.push(walk(b.id, 0, null));

  // 크기: 뿌리는 크게, 가운데는 보통, 잎은 작게. 덩어리와 그룹은 그대로
  const size = new Map();
  const sizeOf = (t) => {
    const b = byId.get(t.id);
    let step = null;
    if (b.resizable) step = t.depth === 0 ? 'large' : t.children.length ? 'normal' : 'small';
    const s = step ? SIZE_STEPS[step] : { w: b.w, h: b.h };
    size.set(t.id, { ...s, step });
    t.children.forEach(sizeOf);
  };
  trees.forEach(sizeOf);
  // 열 너비: 깊이마다 가장 넓은 블록
  const colW = [];
  const measure = (t) => { colW[t.depth] = Math.max(colW[t.depth] || 0, size.get(t.id).w); t.children.forEach(measure); };
  trees.forEach(measure);
  const colX = []; let x = origin.x;
  for (let d = 0; d < colW.length; d++) { colX[d] = x; x += colW[d] + gapX; }

  const out = new Map();
  const place = (t, top) => {
    const s = size.get(t.id);
    let y = top, span = 0;
    for (const c of t.children) { const h = place(c, y); y += h + gapY; span += h + gapY; }
    if (span) span -= gapY;
    const h = Math.max(s.h, span);
    const myY = span > s.h ? top + (span - s.h) / 2 : top;
    out.set(t.id, { x: colX[t.depth], y: Math.round(myY), w: s.w, h: s.h, size: s.step });
    return h;
  };
  let top = origin.y;
  for (const t of trees) top += place(t, top) + gapY * 2;
  // 연결 없는 블록: 크기 그대로 한 줄에(너무 길면 줄을 바꾼다)
  let lx = origin.x, rowH = 0;
  const maxW = Math.max(colX.length ? x - gapX - origin.x : 0, 2400);
  for (const b of lone) {
    if (lx > origin.x && lx + b.w - origin.x > maxW) { lx = origin.x; top += rowH + gapY; rowH = 0; }
    out.set(b.id, { x: lx, y: top, w: b.w, h: b.h, size: null });
    lx += b.w + GAP; rowH = Math.max(rowH, b.h);
  }
  return out;
}
