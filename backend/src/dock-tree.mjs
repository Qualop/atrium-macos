// 붙여 묶기의 분할 나무(ARCH 4절 H5, P17). 순수 함수만 둔다. 창(renderer)도 이 파일을 그대로 묶어 쓴다(node 모듈을 부르지 않는다).
//
// - 덩어리 하나는 tmux 창 분할처럼 분할 나무다. 잎은 세션 ID(글자열), 마디는 { dir: 'row' | 'col', kids: [...], ratios: [...] }.
//   row는 왼쪽|오른쪽, col은 위/아래로 나눈다. ratios는 자식마다의 몫(합 1).
// - 나무는 덩어리의 바깥 직사각형 안을 틈 없이 채운다(layout). 잎마다 최소 크기(LEAF_MIN)를 지키고, 모자라면 바깥이 커진다.
// - 정리(normalize): 빈 마디와 자식 하나만 남은 마디를 없애고, 같은 방향으로 겹친 마디를 하나로 편다(비율은 곱한다).
// - 바깥 직사각형은 저장하지 않는다. 구성 노드 사각형(nodes 표)의 bbox가 바깥이다(layout이 틈 없이 채우므로).

export const LEAF_MIN = { w: 240, h: 160 }; // 분할선과 바깥 크기로 줄일 수 있는 잎의 가장 작은 크기
export const isLeaf = (t) => typeof t === 'string';
export const sideDir = (side) => (side === 'left' || side === 'right' ? 'row' : 'col');
const axis = (dir) => (dir === 'row' ? 'w' : 'h');
const round6 = (x) => Math.round(x * 1e6) / 1e6;

// 나무의 잎(세션 ID)을 왼쪽 위부터 차례로
export function leaves(t) {
  if (t == null) return [];
  if (isLeaf(t)) return [t];
  return (t.kids || []).flatMap(leaves);
}

// 정리. 잘못된 비율은 고르게, 겹친 잎은 처음 것만 둔다. 다 비면 null
export function normalize(t, seen = new Set()) {
  if (t == null) return null;
  if (isLeaf(t)) { if (!t || seen.has(t)) return null; seen.add(t); return t; }
  if (typeof t !== 'object' || !Array.isArray(t.kids)) return null;
  const dir = t.dir === 'col' ? 'col' : 'row';
  const raw = t.kids.map((k, i) => ({ k: normalize(k, seen), r: Number(Array.isArray(t.ratios) ? t.ratios[i] : NaN) })).filter((x) => x.k != null);
  if (!raw.length) return null;
  const good = raw.filter((x) => Number.isFinite(x.r) && x.r > 0);
  const fill = good.length ? good.reduce((a, x) => a + x.r, 0) / good.length : 1;
  const items = raw.map((x) => ({ k: x.k, r: Number.isFinite(x.r) && x.r > 0 ? x.r : fill }));
  const sum = items.reduce((a, x) => a + x.r, 0);
  const flat = [];
  for (const x of items) {
    const r = x.r / sum;
    if (!isLeaf(x.k) && x.k.dir === dir) x.k.kids.forEach((kk, j) => flat.push({ k: kk, r: r * x.k.ratios[j] }));
    else flat.push({ k: x.k, r });
  }
  if (flat.length === 1) return flat[0].k;
  return { dir, kids: flat.map((x) => x.k), ratios: flat.map((x) => round6(x.r)) };
}

// 옛 한 줄 덩어리(표 docks의 dir, members) → 한 마디짜리 나무. sizes(가로줄은 너비, 세로줄은 높이)가 있으면 그 비율
export function fromLine(dir, members, sizes = null) {
  const ok = Array.isArray(sizes) && sizes.length === members.length && sizes.every((s) => Number(s) > 0);
  return normalize({ dir: dir === 'col' ? 'col' : 'row', kids: [...members], ratios: members.map((_, i) => (ok ? Number(sizes[i]) : 1)) });
}

// 나무가 차지할 수 있는 가장 작은 크기
export function minSize(t, min = LEAF_MIN) {
  if (t == null) return { w: 0, h: 0 };
  if (isLeaf(t)) return { w: min.w, h: min.h };
  const ks = t.kids.map((k) => minSize(k, min));
  if (t.dir === 'row') return { w: ks.reduce((a, k) => a + k.w, 0), h: Math.max(...ks.map((k) => k.h)) };
  return { w: Math.max(...ks.map((k) => k.w)), h: ks.reduce((a, k) => a + k.h, 0) };
}

// 길이 L을 비율대로 나누되 자식마다 최소(mins)를 지킨다. 최소에 걸린 자식은 최소로 두고 나머지를 비율대로 다시 나눈다
function share(L, ratios, mins) {
  const n = ratios.length;
  const fixed = new Array(n).fill(false);
  for (;;) {
    const rest = L - mins.reduce((a, m, i) => a + (fixed[i] ? m : 0), 0);
    const rs = ratios.reduce((a, r, i) => a + (fixed[i] ? 0 : r), 0);
    const sizes = ratios.map((r, i) => (fixed[i] ? mins[i] : rs > 0 ? (rest * r) / rs : 0));
    let bad = false;
    sizes.forEach((s, i) => { if (!fixed[i] && s < mins[i] - 1e-9) { fixed[i] = true; bad = true; } });
    if (!bad) return sizes;
    if (fixed.every(Boolean)) return mins.slice();
  }
}

// 나무를 바깥 직사각형 안에 틈 없이 늘어놓는다(정수 판 좌표).
// → { rects: Map id → { x, y, w, h }, dividers: [{ path, index, dir, at, x, y, w, h, sizes, mins, pairs }], outer }
//   divider는 마디(path: 뿌리에서의 자식 번호들)의 자식 index와 index+1 사이 분할선. at은 선의 자리(가로 분할은 x, 세로 분할은 y),
//   sizes는 그 마디 자식들의 길이, pairs는 그 선을 사이에 두고 맞닿은 잎 쌍 [a(왼쪽·위), b(오른쪽·아래)]
export function layout(t, rect, min = LEAF_MIN) {
  const need = minSize(t, min);
  const outer = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.max(Math.round(rect.w), need.w), h: Math.max(Math.round(rect.h), need.h) };
  const rects = new Map();
  const dividers = [];
  if (t == null) return { rects, dividers, outer };
  const walk = (n, r, path) => {
    if (isLeaf(n)) { rects.set(n, r); return; }
    const k = axis(n.dir);
    const start = n.dir === 'row' ? r.x : r.y;
    const L = r[k];
    const mins = n.kids.map((c) => minSize(c, min)[k]);
    const want = share(L, n.ratios, mins);
    const ends = [];
    let acc = 0;
    for (let i = 0; i < n.kids.length; i++) { acc += want[i]; ends.push(i === n.kids.length - 1 ? start + L : start + Math.round(acc)); }
    const sizes = ends.map((e, i) => e - (i ? ends[i - 1] : start));
    let at = start;
    n.kids.forEach((c, i) => {
      const end = ends[i];
      walk(c, n.dir === 'row' ? { x: at, y: r.y, w: end - at, h: r.h } : { x: r.x, y: at, w: r.w, h: end - at }, [...path, i]);
      if (i < n.kids.length - 1) dividers.push({ path, index: i, dir: n.dir, at: end, ...(n.dir === 'row' ? { x: end, y: r.y, w: 0, h: r.h } : { x: r.x, y: end, w: r.w, h: 0 }), sizes, mins });
      at = end;
    });
  };
  walk(t, outer, []);
  for (const d of dividers) d.pairs = touching(rects, d);
  return { rects, dividers, outer };
}

// 분할선을 사이에 두고 맞닿은 잎 쌍(덩어리 안 이웃: 그 사이의 연결은 선 대신 분할선 위 표시로 보인다)
function touching(rects, d) {
  const span = d.dir === 'row' ? [d.y, d.y + d.h] : [d.x, d.x + d.w];
  const lo = (r) => (d.dir === 'row' ? [r.y, r.y + r.h] : [r.x, r.x + r.w]);
  const over = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 0;
  const A = [], B = [];
  for (const [id, r] of rects) {
    if (!over(lo(r), span)) continue;
    const far = d.dir === 'row' ? r.x + r.w : r.y + r.h, near = d.dir === 'row' ? r.x : r.y;
    if (far === d.at) A.push([id, r]); else if (near === d.at) B.push([id, r]);
  }
  const out = [];
  for (const [a, ra] of A) for (const [b, rb] of B) if (over(lo(ra), lo(rb))) out.push([a, b]);
  return out;
}

// 덩어리 안 이웃 쌍 모두(분할선마다의 pairs를 모은다)
export function adjacentPairs(t, rect, min = LEAF_MIN) {
  return layout(t, rect, min).dividers.flatMap((d) => d.pairs);
}

const replaceLeaf = (t, id, f) => (isLeaf(t) ? (t === id ? f(t) : t) : { ...t, kids: t.kids.map((k) => replaceLeaf(k, id, f)) });

// 잎 하나를 뺀다(정리까지). 다 비면 null
export function remove(t, id) {
  if (t == null) return null;
  const drop = (n) => (isLeaf(n) ? (n === id ? null : n) : { ...n, kids: n.kids.map(drop) });
  return normalize(drop(t));
}

// 잎을 뺀 뒤의 나무와 바깥. 뿌리 마디의 바로 아래 잎이면 바깥이 그만큼 줄고(남은 것의 크기는 그대로, 왼쪽 위 자리는 그대로: 옛 한 줄 덩어리와 같다),
// 더 안쪽 잎이면 바깥은 그대로 두고 같은 마디의 이웃이 그 자리를 나눠 채운다(tmux 분할과 같다)
export function removeWithOuter(t, outer, id, min = LEAF_MIN) {
  const tree = remove(t, id);
  if (!tree || isLeaf(t) || !t.kids.includes(id)) return { tree, outer: { ...outer } };
  const r = layout(t, outer, min).rects.get(id);
  const out = { ...outer };
  if (r) { if (t.dir === 'row') out.w = Math.max(1, outer.w - r.w); else out.h = Math.max(1, outer.h - r.h); }
  return { tree, outer: out };
}

// 잎을 넣는다. at = 'leaf': target 잎을 side 쪽으로 반씩 나눠 그 반을 차지한다.
// at = 'dock'(또는 target이 나무에 없을 때): 덩어리 전체의 side 쪽에 새 칸으로 붙는다. 새 칸의 몫은 frac(바깥이 그만큼 커진다고 보고 부른 쪽이 정한다).
// id가 이미 나무에 있으면 먼저 뺀다(같은 덩어리 안에서 옮기기)
export function insert(t, { target = null, side, id, at = 'leaf', frac = 0.5 }) {
  const dir = sideDir(side);
  const before = side === 'left' || side === 'top';
  const base = remove(t, id);
  const f = Math.min(0.95, Math.max(0.05, Number(frac) || 0.5));
  const pair = (node, share) => ({ dir, kids: before ? [id, node] : [node, id], ratios: before ? [share, 1 - share] : [1 - share, share] });
  if (base == null) return id;
  if (at === 'dock' || target == null || !leaves(base).includes(target)) return normalize(pair(base, f));
  return normalize(replaceLeaf(base, target, (leaf) => pair(leaf, 0.5)));
}

// 잎을 덩어리에 넣은 뒤의 나무와 바깥. at = 'dock'이면 바깥이 새 칸(size: 끌어 온 노드 크기)만큼 side 쪽으로 커진다.
// at = 'leaf'이면 바깥은 그대로(잎이 반으로 나뉜다. 최소 크기를 넘기면 layout이 바깥을 키운다)
export function insertWithOuter(t, outer, { target = null, side, id, at = 'leaf', size = null }) {
  const base = remove(t, id);
  const atDock = at === 'dock' || target == null || !leaves(base).includes(target);
  if (!atDock) return { tree: insert(t, { target, side, id, at: 'leaf' }), outer: { ...outer } };
  const dir = sideDir(side);
  const k = axis(dir);
  const add = Math.max(dir === 'row' ? LEAF_MIN.w : LEAF_MIN.h, Math.round((size && size[k]) || outer[k]));
  const out = { ...outer, [k]: outer[k] + add };
  if (side === 'left') out.x = outer.x - add;
  if (side === 'top') out.y = outer.y - add;
  return { tree: insert(t, { target, side, id, at: 'dock', frac: add / out[k] }), outer: out };
}

const nodeAt = (t, path) => path.reduce((n, i) => (n && !isLeaf(n) ? n.kids[i] : null), t);
function withRatios(t, path, ratios) {
  if (!path.length) return { ...t, ratios: ratios.map(round6) };
  const [i, ...rest] = path;
  return { ...t, kids: t.kids.map((k, j) => (j === i ? withRatios(k, rest, ratios) : k)) };
}

// 분할선 하나를 delta(판 좌표)만큼 옮긴 나무. 그 마디의 두 쪽 크기만 함께 바뀌고(합은 그대로) 다른 마디의 비율은 그대로. 양쪽 다 최소 크기를 지킨다
export function moveDivider(t, outer, path, index, delta, min = LEAF_MIN) {
  const n = nodeAt(t, path);
  if (!n || isLeaf(n) || index < 0 || index >= n.kids.length - 1) return t;
  const dv = layout(t, outer, min).dividers.find((d) => d.index === index && d.path.length === path.length && d.path.every((x, i) => x === path[i]));
  if (!dv) return t;
  const sizes = dv.sizes.slice();
  const a = sizes[index], b = sizes[index + 1];
  const lo = dv.mins[index], hi = a + b - dv.mins[index + 1];
  const na = hi < lo ? a : Math.max(lo, Math.min(hi, a + Number(delta || 0)));
  sizes[index] = na; sizes[index + 1] = a + b - na;
  const total = sizes.reduce((x, y) => x + y, 0);
  return withRatios(t, path, sizes.map((s) => s / total));
}

// 뿌리 마디의 자식 크기(옛 dock.update sizes: 가로줄은 너비, 세로줄은 높이)로 비율과 바깥을 정한다
export function rootSizes(t, outer, sizes) {
  if (!t || isLeaf(t) || !Array.isArray(sizes) || sizes.length !== t.kids.length) return { tree: t, outer: { ...outer } };
  const total = sizes.reduce((a, s) => a + Number(s), 0);
  return { tree: withRatios(t, [], sizes.map((s) => Number(s) / total)), outer: { ...outer, [axis(t.dir)]: Math.round(total) } };
}

// ---------- 배치 틀(프리셋) ----------
// 틀의 칸은 숫자(0부터 채우는 순서). grid는 칸 하나를 노드 크기로 볼 때 바깥이 몇 칸 × 몇 칸인가. line은 고른 노드를 모두 한 줄에.
// P26: 세션 수마다 보이는 틀이 다르다(PRESETS_BY_COUNT, presetsFor). even은 몇 개든 고르게 나눈다(7개 이상).
// 옛 틀(row3, col3)은 막대에 보이지 않지만 API(dock.layout)와 CLI(atrium dock layout)에서 그대로 받는다
const row = (kids, ratios) => ({ dir: 'row', kids, ratios: ratios || kids.map(() => 1) });
const col = (kids, ratios) => ({ dir: 'col', kids, ratios: ratios || kids.map(() => 1) });
export const PRESETS = {
  'main-left': { grid: [2, 2], tree: { dir: 'row', kids: [0, { dir: 'col', kids: [1, 2], ratios: [0.5, 0.5] }], ratios: [0.6, 0.4] } }, // 1 + 2: 왼쪽 크게, 오른쪽 위아래 둘
  'main-right': { grid: [2, 2], tree: { dir: 'row', kids: [{ dir: 'col', kids: [0, 1], ratios: [0.5, 0.5] }, 2], ratios: [0.4, 0.6] } }, // 2 + 1
  grid: { grid: [2, 2], tree: { dir: 'col', kids: [{ dir: 'row', kids: [0, 1], ratios: [0.5, 0.5] }, { dir: 'row', kids: [2, 3], ratios: [0.5, 0.5] }], ratios: [0.5, 0.5] } }, // 2 × 2
  row3: { grid: [3, 1], tree: { dir: 'row', kids: [0, 1, 2], ratios: [1, 1, 1] } }, // 가로 셋
  col3: { grid: [1, 3], tree: { dir: 'col', kids: [0, 1, 2], ratios: [1, 1, 1] } }, // 세로 셋
  row: { line: 'row' }, // 가로 한 줄
  col: { line: 'col' }, // 세로 한 줄
  // P26: 둘
  'main2-left': { grid: [2, 1], tree: row([0, 1], [0.62, 0.38]) }, // 왼쪽 크게, 오른쪽 작게
  'main2-top': { grid: [1, 2], tree: col([0, 1], [0.62, 0.38]) }, // 위 크게, 아래 작게
  // P26: 셋
  'main-top': { grid: [2, 2], tree: col([0, row([1, 2])], [0.6, 0.4]) }, // 위 하나, 아래 둘
  // P26: 넷
  'main-left-3': { grid: [2, 3], tree: row([0, col([1, 2, 3])], [0.5, 0.5]) }, // 1 + 3: 왼쪽 크게, 오른쪽 셋
  'main-right-3': { grid: [2, 3], tree: row([col([0, 1, 2]), 3], [0.5, 0.5]) }, // 3 + 1
  'main-top-3': { grid: [3, 2], tree: col([0, row([1, 2, 3])], [0.6, 0.4]) }, // 위 하나, 아래 셋
  // P26: 다섯
  'top3-bottom2': { grid: [3, 2], tree: col([row([0, 1, 2]), row([3, 4])]) }, // 위 셋, 아래 둘
  'main-left-4': { grid: [3, 2], tree: row([0, col([row([1, 2]), row([3, 4])])], [0.4, 0.6]) }, // 1 + 4: 왼쪽 크게, 오른쪽 2 × 2
  'big2-small3': { grid: [3, 2], tree: col([row([0, 1]), row([2, 3, 4])], [0.6, 0.4]) }, // 위 크게 둘, 아래 작게 셋
  'main-top-4': { grid: [4, 2], tree: col([0, row([1, 2, 3, 4])], [0.6, 0.4]) }, // 위 하나, 아래 넷
  'cols-2-3': { grid: [2, 3], tree: row([col([0, 1]), col([2, 3, 4])]) }, // 왼쪽 둘, 오른쪽 셋
  // P26: 여섯
  'grid-3x2': { grid: [3, 2], tree: col([row([0, 1, 2]), row([3, 4, 5])]) }, // 위 셋, 아래 셋
  'grid-2x3': { grid: [2, 3], tree: col([row([0, 1]), row([2, 3]), row([4, 5])]) }, // 둘씩 세 줄
  'main-big5': { grid: [3, 3], tree: col([row([0, col([1, 2])], [2, 1]), row([3, 4, 5])], [2, 1]) }, // 왼쪽 위 크게 하나, 둘레에 작게 다섯
  'big2-small4': { grid: [4, 2], tree: col([row([0, 1]), row([2, 3, 4, 5])], [0.6, 0.4]) }, // 위 크게 둘, 아래 작게 넷
  // P26: 몇 개든 고르게(7개 이상에 보인다)
  'even-rows': { even: 'rows' }, // 가로 줄마다 고르게(줄 수는 √n 안팎)
  'even-cols': { even: 'cols' }, // 세로 줄마다 고르게
  'two-rows': { even: 'two' }, // 두 줄
};
// P26: 세션 수마다 막대에 보이는 틀(차례대로). 7개 이상은 고르게 나눈 틀만
export const PRESETS_BY_COUNT = {
  2: ['row', 'col', 'main2-left', 'main2-top'],
  3: ['main-left', 'main-right', 'main-top', 'row', 'col'],
  4: ['grid', 'main-left-3', 'main-right-3', 'main-top-3', 'row', 'col'],
  5: ['top3-bottom2', 'main-left-4', 'big2-small3', 'main-top-4', 'cols-2-3', 'row', 'col'],
  6: ['grid-3x2', 'grid-2x3', 'main-big5', 'big2-small4', 'row', 'col'],
};
export const EVEN_PRESETS = ['even-rows', 'even-cols', 'two-rows'];
export const LINE_PRESETS = ['row', 'col']; // P73: 세션 수와 상관없이 모두 가로 한 줄(H), 모두 세로 한 줄(V)
export function presetsFor(n) {
  if (!(n >= 2)) return [];
  return PRESETS_BY_COUNT[n] || [...EVEN_PRESETS, ...LINE_PRESETS];
}
const cells = (n) => (typeof n === 'number' ? 1 : n.kids.reduce((a, k) => a + cells(k), 0));
// n을 줄 r개에 고르게(앞 줄이 하나 더 많다)
const spread = (n, r) => Array.from({ length: r }, (_, i) => Math.floor(n / r) + (i < n % r ? 1 : 0));
// 고르게 나눈 틀의 줄 수와 줄마다 칸 수
function evenShape(kind, n) {
  if (kind === 'two') return { lines: n < 2 ? [n] : spread(n, 2), dir: 'col' };
  const c = Math.ceil(Math.sqrt(n));
  return { lines: spread(n, Math.ceil(n / c)), dir: kind === 'cols' ? 'row' : 'col' };
}
function evenTree(kind, ids) {
  const { lines, dir } = evenShape(kind, ids.length);
  let at = 0;
  const kids = lines.map((k) => { const part = ids.slice(at, at + k); at += k; return { dir: dir === 'col' ? 'row' : 'col', kids: part, ratios: part.map(() => 1) }; });
  return normalize({ dir, kids, ratios: kids.map(() => 1) });
}

// 고른 노드(ids, 채울 순서)를 틀로 짠 나무. 칸보다 적으면 빈 칸은 없앤다. 많으면 남는 노드는 마지막 칸을 그 칸의 마디와 다른 방향으로 다시 나눠 넣는다
export function presetTree(name, ids) {
  const p = PRESETS[name];
  if (!p) throw new Error(`분할 레이아웃을 찾을 수 없습니다: ${name}`);
  if (p.line) return normalize({ dir: p.line, kids: [...ids], ratios: ids.map(() => 1) });
  if (p.even) return evenTree(p.even, [...ids]);
  const k = cells(p.tree);
  const last = (parentDir) => {
    const rest = ids.slice(k - 1);
    if (rest.length <= 1) return rest[0] ?? null;
    return { dir: parentDir === 'row' ? 'col' : 'row', kids: rest, ratios: rest.map(() => 1) };
  };
  const fill = (n, parentDir) => (typeof n === 'number' ? (n < k - 1 ? ids[n] ?? null : last(parentDir)) : { dir: n.dir, kids: n.kids.map((c) => fill(c, n.dir)), ratios: n.ratios });
  return normalize(fill(p.tree, p.tree.dir));
}

// 틀의 칸 수(줄·고르게 틀은 null: 몇 개든)
export const presetCells = (name) => { const p = PRESETS[name]; return !p || p.line || p.even ? null : cells(p.tree); };

// 틀의 바깥 크기. cell은 칸 하나의 크기(보통 노드 크기)
export function presetSize(name, n, cell) {
  const p = PRESETS[name];
  if (!p) return { w: cell.w, h: cell.h };
  if (p.line === 'row') return { w: cell.w * n, h: cell.h };
  if (p.line === 'col') return { w: cell.w, h: cell.h * n };
  if (p.even) {
    const { lines, dir } = evenShape(p.even, n);
    const most = Math.max(...lines);
    return dir === 'col' ? { w: cell.w * most, h: cell.h * lines.length } : { w: cell.w * lines.length, h: cell.h * most };
  }
  return { w: cell.w * p.grid[0], h: cell.h * p.grid[1] };
}

// ---------- 붙을 자리 ----------
// 덩어리 전체 옆 새 칸의 미리 보기(끌어 온 노드 크기 drag만큼, 덩어리의 다른 쪽 길이를 따른다)
export function dockPreview(R, side, drag) {
  if (side === 'right') return { x: R.x + R.w, y: R.y, w: drag.w, h: R.h };
  if (side === 'left') return { x: R.x - drag.w, y: R.y, w: drag.w, h: R.h };
  if (side === 'bottom') return { x: R.x, y: R.y + R.h, w: R.w, h: drag.h };
  return { x: R.x, y: R.y - drag.h, w: R.w, h: drag.h };
}
// 잎을 반으로 나눌 때 놓일 반
export function halfPreview(r, side) {
  const hw = Math.round(r.w / 2), hh = Math.round(r.h / 2);
  if (side === 'right') return { x: r.x + r.w - hw, y: r.y, w: hw, h: r.h };
  if (side === 'left') return { x: r.x, y: r.y, w: hw, h: r.h };
  if (side === 'bottom') return { x: r.x, y: r.y + r.h - hh, w: r.w, h: hh };
  return { x: r.x, y: r.y, w: r.w, h: hh };
}
const argmin = (o) => Object.entries(o).sort((a, b) => a[1] - b[1])[0][0];
const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// Ctrl+끌기의 놓일 자리. p: 끄는 점(판 좌표), blocks: [{ dockId | null, rect: 덩어리 바깥(혼자인 노드는 그 노드), leaves: [{ id, x, y, w, h }] }]
// (끄는 노드 자신은 leaves에서 뺀다). band: 덩어리 바깥 가장자리로 볼 거리(판 좌표), drag: 끄는 노드 크기
// - 바깥 가장자리에서 band 안(안팎)이면 덩어리 전체 옆 새 칸(at 'dock'). target은 그 가장자리에 닿은 잎 중 점에 가까운 것
// - 그보다 안쪽이면 점이 든 잎의 가장 가까운 가장자리 쪽으로 반을 나눈다(at 'leaf')
// → { at, side, target, dockId, preview } | null
export function dropZone(p, blocks, { band = 40, drag = { w: 720, h: 460 } } = {}) {
  let best = null;
  for (const b of blocks) {
    const R = b.rect;
    if (!R || !b.leaves || !b.leaves.length) continue;
    if (p.x < R.x - band || p.x > R.x + R.w + band || p.y < R.y - band || p.y > R.y + R.h + band) continue;
    const inside = inRect(p, R);
    const bandIn = Math.min(band, 0.2 * Math.min(R.w, R.h));
    const d = { left: Math.abs(p.x - R.x), right: Math.abs(R.x + R.w - p.x), top: Math.abs(p.y - R.y), bottom: Math.abs(R.y + R.h - p.y) };
    const side = argmin(d);
    let cand = null;
    if (inside ? d[side] <= bandIn : d[side] <= band) {
      const along = side === 'left' || side === 'right' ? 'y' : 'x';
      const edge = b.leaves.filter((l) => (side === 'left' ? l.x === R.x : side === 'right' ? l.x + l.w === R.x + R.w : side === 'top' ? l.y === R.y : l.y + l.h === R.y + R.h));
      const near = (edge.length ? edge : b.leaves).slice().sort((x, y) => Math.abs(x[along] + x[along === 'y' ? 'h' : 'w'] / 2 - p[along]) - Math.abs(y[along] + y[along === 'y' ? 'h' : 'w'] / 2 - p[along]))[0];
      cand = { at: 'dock', side, target: near.id, dockId: b.dockId || null, preview: dockPreview(R, side, drag), score: inside ? 0 : 1 + d[side] / Math.max(1, band) };
    } else if (inside) {
      const leaf = b.leaves.find((l) => inRect(p, l));
      if (!leaf) continue;
      const fx = (p.x - leaf.x) / leaf.w, fy = (p.y - leaf.y) / leaf.h;
      const s = argmin({ left: fx, right: 1 - fx, top: fy, bottom: 1 - fy });
      cand = { at: 'leaf', side: s, target: leaf.id, dockId: b.dockId || null, preview: halfPreview(leaf, s), score: 0 };
    }
    if (cand && (!best || cand.score < best.score)) best = cand;
  }
  if (!best) return null;
  const { score, ...out } = best;
  return out;
}

// 그냥 끌기(Ctrl 없이)로 혼자인 노드를 덩어리(혼자인 노드도 한 덩어리로 본다) 바깥 가장자리 가까이 놓을 때의 붙을 자리.
// blocks: [{ id: 붙일 대상(그 가장자리의 잎), dockId, x, y, w, h(덩어리 바깥) }], threshold: 가장자리끼리 이만큼 가까우면 → { targetId, side, at: 'dock', preview } | null
export function edgeSnap(drag, blocks, threshold = 80) {
  let best = null;
  const span = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
  for (const m of blocks) {
    if (m.id === drag.id) continue;
    for (const side of ['left', 'right', 'top', 'bottom']) {
      let dist, ov;
      if (side === 'right' || side === 'left') {
        dist = side === 'right' ? Math.abs(drag.x - (m.x + m.w)) : Math.abs(drag.x + drag.w - m.x);
        ov = span(drag.y, drag.y + drag.h, m.y, m.y + m.h) / Math.min(drag.h, m.h);
      } else {
        dist = side === 'bottom' ? Math.abs(drag.y - (m.y + m.h)) : Math.abs(drag.y + drag.h - m.y);
        ov = span(drag.x, drag.x + drag.w, m.x, m.x + m.w) / Math.min(drag.w, m.w);
      }
      if (dist > threshold || ov < 0.3) continue;
      const target = m.edgeLeaf ? m.edgeLeaf(side) : m.id;
      if (!best || dist < best.dist) best = { targetId: target, side, at: 'dock', dockId: m.dockId || null, preview: dockPreview(m, side, drag), dist };
    }
  }
  return best;
}

// ---------- P23: 붙은 노드 테두리 끌기, 엇갈리는 점, 반반 ----------
// 잎의 자리(뿌리에서의 자식 번호들). 없으면 null
export function leafPath(t, id, at = []) {
  if (t == null) return null;
  if (isLeaf(t)) return t === id ? at : null;
  for (let i = 0; i < t.kids.length; i++) { const p = leafPath(t.kids[i], id, [...at, i]); if (p) return p; }
  return null;
}
const pathEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const outward = (side) => (side === 'right' || side === 'bottom' ? 1 : -1);

// 잎 id의 side 쪽 테두리가 무엇인가. 이웃과 맞닿았으면 그 사이 분할선(그 쪽 방향 마디 중 잎에 가장 가까운 것),
// 덩어리 바깥 테두리면 outer → { kind: 'divider', path, index, dir } | { kind: 'outer', side } | null(나무에 없음)
export function edgeOf(t, id, side) {
  const p = leafPath(t, id);
  if (!p) return null;
  const dir = sideDir(side);
  let found = null;
  let n = t;
  for (let d = 0; d < p.length; d++) {
    const i = p[d];
    if (n.dir === dir) {
      if (outward(side) > 0 && i < n.kids.length - 1) found = { kind: 'divider', path: p.slice(0, d), index: i, dir };
      if (outward(side) < 0 && i > 0) found = { kind: 'divider', path: p.slice(0, d), index: i - 1, dir };
    }
    n = n.kids[i];
  }
  return found || { kind: 'outer', side };
}

// P73: 덩어리 바깥 테두리 끌기. side 쪽 테두리를 판 좌표 move(왼쪽·오른쪽은 dx, 위·아래는 dy)만큼 옮긴 바깥.
// 나무(비율)는 그대로라 칸이 비율대로 함께 커지고 작아진다. 맞은편 테두리는 그대로, 잎마다 최소 크기를 지킨다
export function dragOuter(t, outer, side, move, min = LEAF_MIN) {
  const need = minSize(t, min);
  const m = Math.round(Number(move) || 0);
  const o = { x: Math.round(outer.x), y: Math.round(outer.y), w: Math.round(outer.w), h: Math.round(outer.h) };
  if (side === 'right') return { ...o, w: Math.max(need.w, o.w + m) };
  if (side === 'bottom') return { ...o, h: Math.max(need.h, o.h + m) };
  if (side === 'left') { const w = Math.max(need.w, o.w - m); return { ...o, x: o.x + o.w - w, w }; }
  if (side === 'top') { const h = Math.max(need.h, o.h - m); return { ...o, y: o.y + o.h - h, h }; }
  return o;
}

// 덩어리 바깥 테두리에 닿은 잎 id의 side 쪽을 바깥으로 delta(판 좌표, +면 커짐)만큼 민다.
// 그 쪽 방향의 조상 마디마다 잎이 든 자식만 delta만큼 길어지고 다른 자식은 길이가 그대로다(그 자식들 사이 비율도 그대로).
// 다른 방향 마디의 비율은 그대로다. 잎 쪽 자식이 최소 크기보다 작아지지 않게 delta를 줄인다 → { tree, outer, delta }
export function resizeOuterEdge(t, outer, id, side, delta, min = LEAF_MIN) {
  const p = leafPath(t, id);
  const lay = layout(t, outer, min);
  const same = { tree: t, outer: { ...lay.outer }, delta: 0 };
  if (!p || edgeOf(t, id, side).kind !== 'outer') return same;
  const dir = sideDir(side), k = axis(dir);
  const len = (n) => {
    const rs = leaves(n).map((l) => lay.rects.get(l));
    const a = Math.min(...rs.map((r) => (k === 'w' ? r.x : r.y))), b = Math.max(...rs.map((r) => (k === 'w' ? r.x + r.w : r.y + r.h)));
    return b - a;
  };
  const hits = []; // 그 쪽 방향 조상 마디: { path, sizes, i(잎이 든 자식), min }
  let n = t;
  for (let d = 0; d < p.length; d++) {
    if (n.dir === dir) hits.push({ path: p.slice(0, d), sizes: n.kids.map(len), i: p[d], min: minSize(n.kids[p[d]], min)[k] });
    n = n.kids[p[d]];
  }
  let dl = Math.round(Number(delta) || 0);
  dl = Math.max(dl, minSize(t, min)[k] - lay.outer[k]);
  for (const h of hits) dl = Math.max(dl, h.min - h.sizes[h.i]);
  if (!dl) return same;
  let tree = t;
  for (const h of hits) {
    const sizes = h.sizes.slice();
    sizes[h.i] += dl;
    const total = sizes.reduce((a, s) => a + s, 0);
    tree = withRatios(tree, h.path, sizes.map((s) => s / total));
  }
  const out = { ...lay.outer, [k]: lay.outer[k] + dl };
  if (side === 'left') out.x = lay.outer.x - dl;
  if (side === 'top') out.y = lay.outer.y - dl;
  return { tree, outer: out, delta: dl };
}

// 잎 id의 side 쪽 테두리를 판 좌표로 move(왼쪽·오른쪽 테두리는 dx, 위·아래 테두리는 dy)만큼 끈다. 이웃과 맞닿은 테두리면 그 분할선이 움직이고,
// 바깥 테두리면 그 쪽으로 덩어리가 커지거나 줄어든다 → { tree, outer, edge }
export function dragEdge(t, outer, id, side, move, min = LEAF_MIN) {
  const e = edgeOf(t, id, side);
  if (!e) return { tree: t, outer: { ...outer }, edge: null };
  if (e.kind === 'divider') return { tree: moveDivider(t, outer, e.path, e.index, move, min), outer: layout(t, outer, min).outer, edge: e };
  const r = resizeOuterEdge(t, outer, id, side, outward(side) * (Number(move) || 0), min);
  return { tree: r.tree, outer: r.outer, edge: e };
}

// 분할선이 엇갈리는 점(2 × 2 가운데처럼 위·아래·왼쪽·오른쪽 네 쪽으로 선이 뻗는 점).
// → [{ x, y, rows: [세로 분할선(dir row)의 { path, index }], cols: [가로 분할선(dir col)] }]
export function junctions(t, rect, min = LEAF_MIN) {
  const { dividers } = layout(t, rect, min);
  const V = dividers.filter((d) => d.dir === 'row'), H = dividers.filter((d) => d.dir === 'col');
  const pts = new Map();
  for (const h of H) for (const v of V) {
    const x = v.at, y = h.at;
    if (x < h.x || x > h.x + h.w || y < v.y || y > v.y + v.h) continue;
    pts.set(`${x},${y}`, { x, y });
  }
  const out = [];
  for (const p of pts.values()) {
    const vs = V.filter((v) => v.at === p.x && p.y >= v.y && p.y <= v.y + v.h);
    const hs = H.filter((h) => h.at === p.y && p.x >= h.x && p.x <= h.x + h.w);
    const up = vs.some((v) => v.y < p.y), down = vs.some((v) => v.y + v.h > p.y);
    const left = hs.some((h) => h.x < p.x), right = hs.some((h) => h.x + h.w > p.x);
    if (!(up && down && left && right)) continue;
    out.push({ x: p.x, y: p.y, rows: vs.map((v) => ({ path: v.path, index: v.index })), cols: hs.map((h) => ({ path: h.path, index: h.index })) });
  }
  return out;
}

// 엇갈리는 점을 (dx, dy)만큼 옮긴다: 그 점에 닿은 세로 분할선은 dx, 가로 분할선은 dy만큼(각자 최소 크기를 지킨다)
export function moveJunction(t, outer, j, dx, dy, min = LEAF_MIN) {
  let tree = t;
  for (const v of j.rows || []) tree = moveDivider(tree, outer, v.path, v.index, dx, min);
  for (const h of j.cols || []) tree = moveDivider(tree, outer, h.path, h.index, dy, min);
  return tree;
}

// 분할선 하나의 두 쪽을 반반으로(두 쪽 길이의 합은 그대로)
export function evenDivider(t, outer, path, index, min = LEAF_MIN) {
  const dv = layout(t, outer, min).dividers.find((d) => d.index === index && pathEq(d.path, path));
  if (!dv) return t;
  return moveDivider(t, outer, path, index, (dv.sizes[index + 1] - dv.sizes[index]) / 2, min);
}

// ---------- P80: 덩어리 크기(틀 비율은 그대로, 바깥만) ----------
// 크기 막대(방향·비율·단계)는 나무 비율을 바꾸지 않고 바깥 W×H만 정한다. 잎은 바깥의 a × b 몫(a: 가로 마디 비율의 곱, b: 세로 마디 비율의 곱)이라
// 잎 모양 = W/H × a/b다. 바깥 모양은 log(W/H) = log(고른 모양) − L로 고른다. L은 잎 넓이(a·b) 무게의 log(a/b) 평균이다
// (넓이 무게로 잎 모양과 고른 모양의 로그 차 제곱 합이 가장 작다). 단, 가장 큰 칸이 다른 칸보다 고른 모양에서 멀지 않게 L을 자른다
// (작은 칸이 여럿이면 넓이 합이 큰 칸을 이겨 큰 칸이 더 어긋난다: 1 + 4). 고른 틀(H, V, 격자)은 모든 칸이 정확히 고른 모양이다.
// 넓이 = 같은 값의 단독 세션 넓이 × √n(n = 잎 수). 덩어리를 "단독 세션 하나"(dockVirtual)로 보면 크기 막대가 단독 세션과 같은 규칙으로 돈다.
export function leafShares(t, a = 1, b = 1, out = []) {
  if (t == null) return out;
  if (isLeaf(t)) { out.push({ id: t, a, b }); return out; }
  const sum = t.ratios.reduce((s, r) => s + r, 0) || 1;
  t.kids.forEach((k, i) => leafShares(k, t.dir === 'row' ? (a * t.ratios[i]) / sum : a, t.dir === 'col' ? (b * t.ratios[i]) / sum : b, out));
  return out;
}
export function shapeShift(t) {
  const ls = leafShares(t).map((l) => ({ w: l.a * l.b, k: Math.log(l.a / l.b) }));
  const wsum = ls.reduce((s, l) => s + l.w, 0);
  if (!(wsum > 0)) return 0;
  let L = ls.reduce((s, l) => s + l.w * l.k, 0) / wsum;
  const top = Math.max(...ls.map((l) => l.w));
  const big = ls.filter((l) => l.w >= top * (1 - 1e-6)), rest = ls.filter((l) => l.w < top * (1 - 1e-6));
  let lo = -Infinity, hi = Infinity;
  for (const g of big) for (const l of rest) { const mid = (g.k + l.k) / 2; if (l.k > g.k + 1e-9) hi = Math.min(hi, mid); else if (l.k < g.k - 1e-9) lo = Math.max(lo, mid); }
  if (lo <= hi) L = Math.min(hi, Math.max(lo, L));
  return L;
}
const leafCount = (t) => Math.max(1, leaves(t).length);
// 덩어리 바깥(outer) → 같은 규칙의 단독 세션 크기 { w, h }(모양 = W/H × e^L, 넓이 = 바깥 넓이 / √n)
export function dockVirtual(t, outer) {
  if (!outer || !(outer.w > 0) || !(outer.h > 0)) return null;
  const m = (outer.w / outer.h) * Math.exp(shapeShift(t));
  const area = (outer.w * outer.h) / Math.sqrt(leafCount(t));
  return { w: Math.sqrt(area * m), h: Math.sqrt(area / m) };
}
// 단독 세션 크기(single) → 덩어리 바깥 { w, h }(dockVirtual의 반대)
export function dockFit(t, single) {
  if (!single || !(single.w > 0) || !(single.h > 0)) return null;
  const s = (single.w / single.h) * Math.exp(-shapeShift(t));
  const area = single.w * single.h * Math.sqrt(leafCount(t));
  return { w: Math.round(Math.sqrt(area * s)), h: Math.round(Math.sqrt(area / s)) };
}
