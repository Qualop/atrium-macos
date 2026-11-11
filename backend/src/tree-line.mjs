// P75: 하위 세션 줄(ARCH K4, H7). 순수 함수만 둔다. 창(renderer)도 그대로 묶어 쓸 수 있다(node 모듈을 부르지 않는다).
// - 한 방향: 판의 나무는 왼쪽에서 오른쪽으로 자란다. 부모의 하위 세션은 부모 오른쪽 한 열에 위에서 아래로 띄운 순서대로 선다. 손자는 그 하위 세션 오른쪽 열.
//   열이 길어져도 격자로 접지 않는다(화면에 맞추는 것은 사람이 확대·축소로 한다).
// - 블록: 줄에 서는 단위. 노드 하나, 붙여 묶은 덩어리, 워크트리 상자(상자째) 가운데 하나다. 블록 사각형은 바깥 테두리(상자면 이름표와 여백까지)다.
// - 형제 블록은 저마다 자기 아래 나무(자손 블록)까지 감싼 띠(subtree)를 차지한다. 다음 형제는 앞 형제들 띠의 맨 아래 다음에 선다(정리 arrangeTree와 같은 모양).
import { overlaps, bbox, REGION_PAD, REGION_HEAD } from './canvas.mjs';

export const LINE_GAP_X = 200; // 부모와 하위 세션 열 사이. 선 위의 역할·상태 글이 접히지 않는 너비(창 labelFit 172 이상, P8)
export const LINE_GAP_Y = 80; // 줄 안 형제(의 띠) 사이

// 워크트리 상자 사각형: 안의 노드 하나를 감싼 영역(canvas.mjs regionRect와 같은 여백)
export const boxFrame = (r) => ({ x: r.x - REGION_PAD, y: r.y - REGION_PAD - REGION_HEAD, w: r.w + 2 * REGION_PAD, h: r.h + 2 * REGION_PAD + REGION_HEAD });
// P78: 상자 틀이 노드 둘레에 더하는 테두리(정리 arrangeTree의 pad)
export const BOX_PAD = { l: REGION_PAD, t: REGION_PAD + REGION_HEAD, r: REGION_PAD, b: REGION_PAD };
// 상자 사각형(왼쪽 위)에 든 노드 자리
export const frameInner = (f) => ({ x: f.x + REGION_PAD, y: f.y + REGION_PAD + REGION_HEAD });

// 새 하위 세션 블록의 자리(왼쪽 위). parent: 부모 블록 사각형(줄의 x와 시작 높이), bands: 이미 줄에 선 형제들의 띠(자기 나무까지 감싼 사각형),
// size: 새 블록 크기, obstacles: 피할 사각형(노드, 메모·칸반, 상자 …). 줄 끝(마지막 띠 아래)에 서고, 그 자리에 다른 것이 있으면 그 아래로 줄을 잇는다
export function lineSlot({ parent, bands = [], size, obstacles = [], gapX = LINE_GAP_X, gapY = LINE_GAP_Y, gap = gapY }) {
  if (!parent || !size) return null;
  const x = Math.round(parent.x + parent.w + gapX);
  const bs = bands.filter(Boolean);
  let y = bs.length ? Math.max(...bs.map((r) => r.y + r.h)) + gapY : parent.y;
  const os = obstacles.filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.w));
  for (let i = 0; i < 10000; i++) {
    const c = { x, y, w: size.w, h: size.h };
    const hit = os.filter((r) => overlaps(c, r, gap - 1));
    if (!hit.length) return { x, y: Math.round(y) };
    y = Math.max(...hit.map((r) => r.y + r.h)) + gap;
  }
  return { x, y: Math.round(y) };
}

// 줄 밀기: units([{ id, rect }], 띄운 순서)를 차례로 보며, 앞의 것과 겹치면(gap 안) 그 아래로만 민다. 당기지 않는다(자리가 갑자기 움직이지 않게).
// → Map id → dy(민 것만). 줄의 순서는 바뀌지 않는다(뒤의 것만 아래로 간다)
export function pushLine(units, { gap = LINE_GAP_Y } = {}) {
  const out = new Map();
  const placed = [];
  for (const u of units || []) {
    if (!u || !u.rect) continue;
    const r = { ...u.rect };
    let dy = 0;
    for (let i = 0; i < 10000; i++) {
      const hit = placed.filter((p) => overlaps(r, p, gap - 1));
      if (!hit.length) break;
      const need = Math.max(...hit.map((p) => p.y + p.h + gap)) - r.y;
      if (need <= 0) break;
      r.y += need; dy += need;
    }
    placed.push(r);
    if (dy) out.set(u.id, Math.round(dy));
  }
  return out;
}

// 블록 나무. blocks: [{ id, x, y, w, h, members: [sessionId] }], rowOf(sid) → { parentSessionId, createdAt } | null
// → { byId, blockOf: Map sid → 블록 ID, parent: Map 블록 → 부모 블록, kids: Map 블록 → [자식 블록](띄운 순서), rank: Map 블록 → 띄운 때 }
// 블록의 머리: 부모가 그 블록 밖에 있는 구성 세션. 머리가 여럿이면 먼저 띄운 것의 부모를 따른다. 고리는 끊는다
export function blockTree(blocks, rowOf) {
  const byId = new Map(blocks.map((x) => [x.id, x]));
  const blockOf = new Map();
  for (const x of blocks) for (const m of x.members || []) blockOf.set(m, x.id);
  const parent = new Map(), rank = new Map();
  for (const x of blocks) {
    const heads = (x.members || []).map((m) => ({ m, r: rowOf(m) || {} })).filter(({ r }) => !r.parentSessionId || blockOf.get(r.parentSessionId) !== x.id);
    heads.sort((a, c) => (a.r.createdAt || 0) - (c.r.createdAt || 0) || String(a.m).localeCompare(String(c.m)));
    const at = (x.members || []).map((m) => (rowOf(m) || {}).createdAt || 0);
    rank.set(x.id, heads.length ? heads[0].r.createdAt || 0 : at.length ? Math.min(...at) : 0);
    const h = heads.find(({ r }) => r.parentSessionId && blockOf.has(r.parentSessionId));
    if (h) parent.set(x.id, blockOf.get(h.r.parentSessionId));
  }
  // 고리 끊기
  for (const id of [...parent.keys()]) {
    const seen = new Set([id]);
    for (let p = parent.get(id); p; p = parent.get(p)) { if (seen.has(p)) { parent.delete(id); break; } seen.add(p); }
  }
  const kids = new Map();
  for (const [c, p] of parent) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(c); }
  for (const list of kids.values()) list.sort((a, c) => rank.get(a) - rank.get(c) || String(a).localeCompare(String(c)));
  return { byId, blockOf, parent, kids, rank };
}
// 블록과 그 아래 모든 블록의 ID
export function subtreeIds(tree, id) {
  const out = [];
  const seen = new Set();
  const walk = (x) => { if (seen.has(x)) return; seen.add(x); out.push(x); for (const k of tree.kids.get(x) || []) walk(k); };
  walk(id);
  return out;
}
// 블록이 차지하는 띠(자기 나무까지 감싼 사각형)
export const bandOf = (tree, id) => bbox(subtreeIds(tree, id).map((k) => tree.byId.get(k)));
// 줄에 선 형제: 부모 블록 오른쪽에 있는 자식 블록(사람이 부모 왼쪽으로 옮긴 것은 줄 밖으로 본다)
export function lineKids(tree, pid) {
  const p = tree.byId.get(pid);
  if (!p) return [];
  return (tree.kids.get(pid) || []).filter((k) => { const r = tree.byId.get(k); return r && r.x >= p.x + p.w - 1; });
}
