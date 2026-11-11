// P31: 판 전체 정리(board.arrange { all })에서 영역들을 다시 놓는 계산. 순수 함수만 둔다(단위 시험 있음).
// - 묶음(group): 맨 위 영역 하나(리포 영역은 P35부터 안의 워크트리 상자를 감싸므로 상자째, 또는 폴더 영역). 소속 없는 메모·칸반은 혼자 한 묶음이다.
//   P31의 "워크트리 위성은 리포 오른쪽 열" 규칙은 P35에서 뺐다(상자는 리포 영역 안에서 그 영역과 함께 움직인다).
// - 묶음끼리: 지금 읽는 순서(위에서 아래, 왼쪽에서 오른쪽)를 지켜 줄 단위로 왼쪽부터 채운다(선반 채우기).
//   안이 빈 영역은 안이 있는 영역 뒤에, 소속 없는 메모·칸반은 맨 뒤에 둔다. 줄 안에서는 위를 맞추고, 묶음 사이와 줄 사이는 REGION_GAP이다.
// - 시작점은 지금 모든 묶음의 왼쪽 위다(판이 멀리 튀지 않게).
// - P44: 가상 그룹(ws-groups.mjs)에 든 영역은 먼저 그룹마다 사람이 정한 순서로 한 덩어리(cluster)로 채우고, 그 덩어리를 영역 하나처럼 놓는다.
// - P91: 줄 너비를 하나로 정하지 않고 후보(가장 넓은 단위, 이어진 단위들의 너비 합 모두)를 다 놓아 본다. 결과 전체의 비율이 화면 비율(aspect, 창이 보내는
//   캔버스 비율, 기본 16:9)에 가까운 것과 빈 자리(줄마다 높이가 달라 생기는 빈 곳 포함)가 적은 것을 함께 점수로 골라(shelfBest) 한 줄·한 열로 길게 늘이지 않는다.
//   덩어리(그룹)는 캔버스에 테두리(canvas.mjs GROUP_PAD, GROUP_HEAD)가 그려지므로 그만큼 넓혀 놓는다. 덩어리 안도 같은 점수로 채운다.
// - P99: 다른 묶음끼리 이어진 연결(역할 선, 띄움 선, 일 시키기, 부모 → 하위 세션)을 묶음 쌍의 무게로 센다(linkWeights). 점수에
//   "연결된 묶음 사이 거리"(무게를 곱한 가장자리 거리 합 / (무게 합 × 판 크기)) 항을 더하고 순서를 바꿔 본다(linkedOrder: 읽는 순서, 무게 큰 쌍부터
//   이은 사슬, 그 뒤 둘 바꾸기·하나 옮기기 탐색). 연결이 없으면 P91 계산 그대로다. 비율 차이는 연결 없이 고른 결과보다 ASPECT_SLACK 넘게 커지지 않는다.
//   폴더 묶음(덩어리) 테두리는 그대로 두고 덩어리째 옮긴다. 덩어리 안은 저절로 만든 묶음이고 사람이 순서를 바꾼 적이 없을 때만(loose) 같은 규칙으로 순서를 고른다.
import { bbox, REGION_GAP, GROUP_PAD, GROUP_HEAD } from './canvas.mjs';

export const DEFAULT_ASPECT = 16 / 9;
const WASTE_WEIGHT = 0.6; // 빈 자리 비율(0~1)의 무게. 비율 차이는 |ln(결과 비율 / 화면 비율)|
const CAND_MAX = 60; // 단위가 이보다 많으면 첫 단위부터 이어진 너비만 후보로(계산량)
// P99: 연결 항의 무게. 연결 항은 0(연결된 쌍이 모두 이웃)~1 남짓(판 반대편). 0.5면 반대편 쌍을 이웃으로 당기는 값이 비율 약 1.3배 차이(ln 0.25)와 같다
export const LINK_WEIGHT = 0.5;
// P99: 연결을 보고 고른 결과의 비율 차이(|ln|)는 연결 없이 고른 결과의 것 + 이 값까지만(e^0.15 ≈ 1.16배)
export const ASPECT_SLACK = 0.15;
const SEARCH_ROWS = 3; // 탐색에서 순서마다 놓아 볼 줄 너비 수(지금 순서의 점수 좋은 것부터)
const SEARCH_PASSES = 5; // 바꾸기·옮기기 탐색을 되풀이하는 최대 횟수(결정적: 시간 제한을 쓰지 않는다)

// 선반 채우기: items([{ w, h }])를 줄 너비 rowW 안에서 왼쪽 위부터 놓는다 → [{ x, y }](x0, y0 기준)
function shelf(items, { gap, rowW, x0 = 0, y0 = 0 }) {
  let x = x0, y = y0, rowH = 0;
  return items.map((g) => {
    if (x > x0 && x - x0 + g.w > rowW + 1) { x = x0; y += rowH + gap; rowH = 0; }
    const at = { x, y };
    x += g.w + gap; rowH = Math.max(rowH, g.h);
    return at;
  });
}
// P99: 두 사각형의 가장자리 사이 거리(맞닿거나 겹치면 0). 같은 줄에서 옆이거나 위아래로 이웃하면 gap만큼이다.
// 중심 거리로 재면 큰 영역 둘은 맞닿아도 멀게 나와 "이웃"을 가리지 못한다
function edgeDist(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}
// 줄 너비 후보: 가장 넓은 단위, 이어진 단위들의 너비 합(가장 넓은 것 이상) → 오름차순
function rowCands(items, gap) {
  const maxW = Math.max(...items.map((g) => g.w));
  const cands = new Set([maxW]);
  const starts = items.length > CAND_MAX ? 1 : items.length;
  for (let i = 0; i < starts; i++) { let run = 0; for (let j = i; j < items.length; j++) { run += items[j].w + (j > i ? gap : 0); if (run >= maxW) cands.add(run); } }
  return [...cands].sort((a, b) => a - b);
}
// 한 줄 너비로 놓은 결과의 점수. fit = 비율 + 빈 자리(P91), link = 연결 항(P99, pairs가 없으면 0), aspectErr = |ln(결과 비율 / 화면 비율)|
function scoreAt(items, rowW, { gap, aspect, area, pairs, norm }) {
  const at = shelf(items, { gap, rowW });
  let w = 0, h = 0;
  for (let i = 0; i < items.length; i++) { w = Math.max(w, at[i].x + items[i].w); h = Math.max(h, at[i].y + items[i].h); }
  const aspectErr = Math.abs(Math.log(w / h / aspect));
  const fit = aspectErr + WASTE_WEIGHT * (1 - area / (w * h));
  let link = 0;
  if (pairs && pairs.length) {
    let s = 0;
    for (const { i, j, w: pw } of pairs) s += pw * edgeDist({ x: at[i].x, y: at[i].y, w: items[i].w, h: items[i].h }, { x: at[j].x, y: at[j].y, w: items[j].w, h: items[j].h });
    link = s / norm;
  }
  return { at, rowW, w, h, aspectErr, fit, link, score: fit + LINK_WEIGHT * link };
}
// 연결 항의 나눗수: 무게 합 × 판 크기(단위 넓이 합의 제곱근). 줄 너비와 순서에 따라 바뀌지 않으므로 넓게 흩어 놓아도 항이 작아지지 않는다
function linkNorm(items, pairs) {
  const area = items.reduce((s, g) => s + g.w * g.h, 0);
  const wsum = (pairs || []).reduce((s, p) => s + p.w, 0);
  return Math.max(1, wsum * Math.sqrt(area));
}
// 줄 너비 후보마다 선반 채우기를 해 보고 점수가 가장 낮은 것 → { at, rowW, w, h, score, fit, link, aspectErr }. 같은 점수면 좁은 줄
// P99: pairs([{ i, j, w }], items의 자리 번호)를 주면 연결 항을 더한다. maxAspect를 주면 비율 차이가 그보다 큰 후보는 다른 후보가 없을 때만 고른다.
export function shelfBest(items, { gap, aspect = DEFAULT_ASPECT, pairs = null, maxAspect = Infinity } = {}) {
  if (!items.length) return { at: [], rowW: 0, w: 0, h: 0, score: 0, fit: 0, link: 0, aspectErr: 0 };
  const area = items.reduce((s, g) => s + g.w * g.h, 0);
  const ctx = { gap, aspect, area, pairs, norm: linkNorm(items, pairs) };
  let best = null, loose = null;
  for (const rowW of rowCands(items, gap)) {
    const r = scoreAt(items, rowW, ctx);
    if (r.aspectErr > maxAspect + 1e-9) { if (!loose || r.score < loose.score - 1e-9) loose = r; continue; }
    if (!best || r.score < best.score - 1e-9) best = r;
  }
  return best || loose;
}

// P99: 판의 연결을 묶음 쌍의 무게로 센다(순수 함수).
// links: [{ from, to, role?, spawned?, observed?, lastAt?, updatedAt?, removedAt? }](store.links), parents: [[부모, 하위 세션]],
// areaOf(sessionId) → 그 세션이 든 맨 위 영역 키(판에 없는 세션·닫힌 세션은 null), now: 지금 시각(ms)
// - 세션 쌍마다(방향 없이) 가장 강한 관계 하나만 센다: 부모 → 하위 세션, 띄움, 사람이 이은 역할 선은 2(오래 가는 관계라 시간이 지나도 줄이지 않는다).
//   오간 지시만 있는 연결은 1, 마지막 활동이 STALE_MS(3일)보다 오래면 0.5(지난 일이라 덜 당긴다).
// - 지운 연결, 닫힌 세션(판에 노드가 없다), 같은 영역 안의 쌍은 뺀다. 영역 쌍의 무게는 그 사이 세션 쌍 무게의 합 → [{ a, b, w }](a < b, 키 순)
export const STALE_MS = 3 * 24 * 3600 * 1000;
export function linkWeights({ links = [], parents = [], areaOf, now = Date.now() } = {}) {
  const pair = new Map(); // 세션 쌍 → 무게
  const put = (x, y, w) => { if (!x || !y || x === y) return; const k = x < y ? `${x}\n${y}` : `${y}\n${x}`; pair.set(k, Math.max(pair.get(k) || 0, w)); };
  for (const l of links) {
    if (!l || l.removedAt) continue;
    if (l.role || l.spawned) { put(l.from, l.to, 2); continue; }
    if (!l.observed) continue;
    const last = l.lastAt ?? l.updatedAt ?? l.createdAt ?? 0;
    put(l.from, l.to, now - last > STALE_MS ? 0.5 : 1);
  }
  for (const [p, c] of parents) put(p, c, 2);
  const byArea = new Map();
  for (const [k, w] of [...pair].sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0))) {
    const [x, y] = k.split('\n');
    const a = areaOf(x), b = areaOf(y);
    if (!a || !b || a === b) continue;
    const ak = a < b ? `${a}\n${b}` : `${b}\n${a}`;
    byArea.set(ak, (byArea.get(ak) || 0) + w);
  }
  return [...byArea.keys()].sort().map((k) => { const [a, b] = k.split('\n'); return { a, b, w: byArea.get(k) }; });
}

// P99: 무게 큰 쌍부터 이어 붙인 사슬 순서. 끝끼리만 잇고(한 단위는 이웃 둘까지) 고리는 만들지 않는다.
// 연결 없는 단위는 지금 순서를 지키고, 사슬은 그 사슬의 가장 앞 단위 자리에서 통째로 나온다 → 자리 번호 목록
function chainOrder(n, pairs, movable) {
  const deg = new Array(n).fill(0), nb = Array.from({ length: n }, () => []), root = [...Array(n).keys()];
  const find = (x) => (root[x] === x ? x : (root[x] = find(root[x])));
  const sorted = pairs.filter((p) => movable[p.i] && movable[p.j]).sort((p, q) => q.w - p.w || Math.min(p.i, p.j) - Math.min(q.i, q.j) || Math.max(p.i, p.j) - Math.max(q.i, q.j));
  for (const { i, j } of sorted) {
    if (deg[i] >= 2 || deg[j] >= 2 || find(i) === find(j)) continue;
    deg[i]++; deg[j]++; nb[i].push(j); nb[j].push(i); root[find(i)] = find(j);
  }
  const out = [], done = new Array(n).fill(false);
  for (let u = 0; u < n; u++) {
    if (done[u]) continue;
    if (!nb[u].length) { out.push(u); done[u] = true; continue; }
    // 사슬의 두 끝 가운데 앞 번호에서 시작해 끝까지 따라간다
    const ends = [], seen = new Set([u]), q = [u];
    while (q.length) { const x = q.pop(); if (nb[x].length < 2) ends.push(x); for (const y of nb[x]) if (!seen.has(y)) { seen.add(y); q.push(y); } }
    let x = Math.min(...ends), prev = -1;
    while (x !== -1) { out.push(x); done[x] = true; const nx = nb[x].find((y) => y !== prev && !done[y]); prev = x; x = nx === undefined ? -1 : nx; }
  }
  return out;
}
// 자리 번호 목록 order로 늘어놓은 뒤의 연결 쌍(새 자리 번호)
function remap(order, pairs) {
  const pos = new Array(order.length);
  order.forEach((k, i) => { pos[k] = i; });
  return pairs.map((p) => ({ i: pos[p.i], j: pos[p.j], w: p.w }));
}

// P99: 연결을 보고 순서와 줄 너비를 고른다. items는 지금 순서(읽는 순서)의 단위, pairs는 items 자리 번호의 연결 무게.
// movable[i]가 거짓인 단위(빈 영역, 소속 없는 메모·칸반)는 자리를 바꾸지 않는다. 그런 단위는 맨 뒤에 모여 있어야 한다(하나 옮기기가 사이를 민다).
// 1) 연결 없이 고른 결과(P91)의 비율 차이 + ASPECT_SLACK을 비율 한도로 둔다 2) 지금 순서와 사슬 순서를 놓아 보고 좋은 쪽에서
// 3) 둘 바꾸기·하나 옮기기를 점수와 연결 항이 함께 줄 때만 받아들인다(연결과 상관없는 까닭으로 순서를 흔들지 않게) 4) 마지막 순서로 줄 너비를 다시 고른다
// → { order: 자리 번호 목록, best: shelfBest 결과(order로 늘어놓은 items의 at), plain: 연결 없이 고른 결과(지금 순서) }
export function linkedOrder(items, pairs, { gap, aspect = DEFAULT_ASPECT, movable = null } = {}) {
  const n = items.length;
  const base = [...Array(n).keys()];
  const plain = shelfBest(items, { gap, aspect });
  if (!pairs || !pairs.length) return { order: base, best: plain, plain };
  const mov = movable || items.map(() => true);
  const maxAspect = plain.aspectErr + ASPECT_SLACK;
  // 탐색용 빠른 점수: scoreAt과 같은 계산을 원래 단위 번호의 배열에 바로 한다(새 객체를 만들지 않는다)
  const W = items.map((g) => g.w), H = items.map((g) => g.h), X = new Float64Array(n), Y = new Float64Array(n);
  const area = items.reduce((s, g) => s + g.w * g.h, 0), norm = linkNorm(items, pairs);
  const fast = (order, rowW) => {
    let x = 0, y = 0, rowH = 0, w = 0, h = 0;
    for (let p = 0; p < n; p++) {
      const k = order[p];
      if (x > 0 && x + W[k] > rowW + 1) { x = 0; y += rowH + gap; rowH = 0; }
      X[k] = x; Y[k] = y; x += W[k] + gap;
      if (H[k] > rowH) rowH = H[k];
      if (X[k] + W[k] > w) w = X[k] + W[k];
      if (Y[k] + H[k] > h) h = Y[k] + H[k];
    }
    const aspectErr = Math.abs(Math.log(w / h / aspect));
    let s = 0;
    for (const { i, j, w: pw } of pairs) {
      const dx = Math.max(0, X[i] - (X[j] + W[j]), X[j] - (X[i] + W[i])), dy = Math.max(0, Y[i] - (Y[j] + H[j]), Y[j] - (Y[i] + H[i]));
      s += pw * Math.hypot(dx, dy);
    }
    const link = s / norm;
    return { rowW, aspectErr, link, score: aspectErr + WASTE_WEIGHT * (1 - area / (w * h)) + LINK_WEIGHT * link };
  };
  // 한 순서의 줄 너비 후보를 다 놓아 본다 → 비율 한도 안에서 가장 좋은 것과 점수 좋은 줄 너비 SEARCH_ROWS개
  const full = (order) => {
    const ok = rowCands(order.map((k) => items[k]), gap).map((rowW) => fast(order, rowW)).filter((r) => r.aspectErr <= maxAspect + 1e-9);
    if (!ok.length) return null;
    const sorted = ok.sort((a, b) => a.score - b.score || a.rowW - b.rowW);
    return { ...sorted[0], rows: sorted.slice(0, SEARCH_ROWS).map((r) => r.rowW) };
  };
  const plainLink = fast(base, plain.rowW).link;
  let cur = base, curBest = full(base);
  const ch = chainOrder(n, pairs, mov);
  if (ch.some((k, i) => k !== i)) { const r = full(ch); if (r && r.score < curBest.score - 1e-9) { cur = ch; curBest = r; } }
  const slots = base.filter((i) => mov[i]);
  const linked = new Set(pairs.flatMap((p) => [p.i, p.j]));
  for (let pass = 0; pass < SEARCH_PASSES; pass++) {
    const rows = curBest.rows;
    let moved = false, curScore = curBest.score, curLink = curBest.link;
    const tryOrder = (order) => {
      for (const rowW of rows) {
        const r = fast(order, rowW);
        if (r.aspectErr <= maxAspect + 1e-9 && r.score < curScore - 1e-9 && r.link < curLink - 1e-9) { cur = order; curScore = r.score; curLink = r.link; moved = true; return; }
      }
    };
    for (let a = 0; a < slots.length; a++) for (let c = a + 1; c < slots.length; c++) {
      // 연결된 단위가 끼는 수만 본다(연결 없는 둘을 바꾸는 것은 연결 항을 거의 바꾸지 못하고 계산만 든다)
      const i = slots[a], j = slots[c];
      if (linked.has(cur[i]) || linked.has(cur[j])) { const sw = [...cur]; [sw[i], sw[j]] = [sw[j], sw[i]]; tryOrder(sw); }
      if (linked.has(cur[i])) { const mf = [...cur]; mf.splice(j, 0, ...mf.splice(i, 1)); tryOrder(mf); }
      if (linked.has(cur[j])) { const mb = [...cur]; mb.splice(i, 0, ...mb.splice(j, 1)); tryOrder(mb); }
    }
    curBest = full(cur) || curBest;
    if (!moved) break;
  }
  // 마지막 순서로 줄 너비를 다시 고른다(at을 만드는 한 번)
  const best = shelfBest(cur.map((k) => items[k]), { gap, aspect, pairs: remap(cur, pairs), maxAspect });
  return { order: cur, best, plain: { ...plain, link: plainLink } };
}

// entries: [{ key, ws, rect: { x, y, w, h }, empty?, group?, order?, loose? }]
//   ws: 워크스페이스 키(소속 없는 것은 null), rect: 지금 영역(또는 메모·칸반) 사각형, empty: 안이 빈 영역
//   group: 가상 그룹 ID(없으면 그룹 없음), order: 그룹 안 순서(사람이 정함), loose: 그룹 안 순서를 연결로 바꿔도 된다(P99, 저절로 만든 묶음이고 사람이 순서를 바꾼 적 없음)
// opts.aspect: 결과 전체가 맞출 화면 비율(너비 / 높이). opts.frame: 덩어리 둘레에 테두리 자리를 둔다(기본 둔다)
// opts.links: [{ a, b, w }](entry 키 쌍의 연결 무게, linkWeights). 없으면 P91 계산 그대로
// → { shifts: Map key → { dx, dy }(옮길 것만), rects: Map key → 새 사각형, groups: [{ ws, keys, rect }], clusters: [{ group, keys, rect }], aspect, rect,
//     link: { pairs: 묶음 사이 쌍 수, plain: 연결 없이 놓았을 때의 연결 항, now: 고른 결과의 연결 항 } }
export function layoutRegions(entries, { gap = REGION_GAP, aspect = DEFAULT_ASPECT, origin = null, groupGap = null, frame = true, links = null } = {}) {
  const list = (entries || []).filter((e) => e && e.rect && Number.isFinite(e.rect.x) && Number.isFinite(e.rect.y));
  const want = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_ASPECT;
  if (!list.length) return { shifts: new Map(), rects: new Map(), groups: [], clusters: [], aspect: want, rect: null, link: { pairs: 0, plain: 0, now: 0 } };
  const padX = frame ? GROUP_PAD : 0, padTop = frame ? GROUP_PAD + GROUP_HEAD : 0, padBot = frame ? GROUP_PAD : 0;
  const wlist = (links || []).filter((l) => l && l.a != null && l.b != null && l.a !== l.b && l.w > 0);
  // 1. 단위: 그룹 없는 영역(또는 메모·칸반) 하나, 또는 가상 그룹 하나(안의 영역을 미리 채운 덩어리, 테두리 자리 포함)
  const units = [];
  const byGroup = new Map();
  for (const e of list) {
    if (e.ws && e.group != null && e.group !== '') { if (!byGroup.has(e.group)) byGroup.set(e.group, []); byGroup.get(e.group).push(e); continue; }
    units.push({ ws: e.ws || null, members: [{ e, dx: 0, dy: 0 }], free: !e.ws, w: e.rect.w, h: e.rect.h, now: e.rect, empty: !!e.ws && !!e.empty, key: String(e.key) });
  }
  for (const [id, es0] of byGroup) {
    let es = es0.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.rect.y - b.rect.y || a.rect.x - b.rect.x || String(a.key).localeCompare(String(b.key)));
    const items = es.map((e) => ({ w: e.rect.w, h: e.rect.h }));
    let at;
    // P99: 저절로 만든 묶음(사람이 순서를 바꾼 적 없음)이면 묶음 안 연결로 순서를 고른다. 사람이 정한 순서는 그대로
    const idx = new Map(es.map((e, i) => [String(e.key), i]));
    const inner = es.every((e) => e.loose) ? wlist.filter((l) => idx.has(String(l.a)) && idx.has(String(l.b))).map((l) => ({ i: idx.get(String(l.a)), j: idx.get(String(l.b)), w: l.w })) : [];
    if (inner.length) {
      const r = linkedOrder(items, inner, { gap, aspect: want });
      es = r.order.map((k) => es[k]); at = r.best.at;
    } else at = shelfBest(items, { gap, aspect: want }).at;
    const box = bbox(es.map((e, i) => ({ x: at[i].x, y: at[i].y, w: e.rect.w, h: e.rect.h })));
    const now = bbox(es.map((e) => e.rect));
    units.push({ ws: es[0].ws, group: id, members: es.map((e, i) => ({ e, dx: at[i].x + padX, dy: at[i].y + padTop })), free: false, w: box.w + 2 * padX, h: box.h + padTop + padBot,
      now: { x: now.x - padX, y: now.y - padTop, w: now.w + 2 * padX, h: now.h + padTop + padBot }, empty: es.every((e) => e.empty), key: `group:${id}` });
  }
  // 2. 순서: 안이 있는 단위(지금 읽는 순서) → 빈 단위 → 소속 없는 메모·칸반
  const rank = (g) => (g.free ? 2 : g.empty ? 1 : 0);
  units.sort((a, b) => rank(a) - rank(b) || a.now.y - b.now.y || a.now.x - b.now.x || a.key.localeCompare(b.key));
  // 3. P99: entry 키의 연결을 단위 쌍의 무게로 모은다(같은 단위 안은 뺀다)
  const unitOf = new Map();
  units.forEach((g, i) => { for (const m of g.members) unitOf.set(String(m.e.key), i); });
  const acc = new Map();
  for (const l of wlist) {
    const i = unitOf.get(String(l.a)), j = unitOf.get(String(l.b));
    if (i == null || j == null || i === j) continue;
    const k = i < j ? `${i},${j}` : `${j},${i}`;
    acc.set(k, (acc.get(k) || 0) + l.w);
  }
  const pairs = [...acc].map(([k, w]) => { const [i, j] = k.split(',').map(Number); return { i, j, w }; }).sort((p, q) => p.i - q.i || p.j - q.j);
  // 4. 줄 단위로 채운다. 줄 너비(와 P99 연결이 있으면 순서)는 결과 비율, 빈 자리, 연결 거리로 고른다.
  //    그룹 테두리가 이미 단위 둘레를 띄우므로 단위 사이는 gap 그대로(frame이 아니면 그룹이 있을 때 두 배)
  const outer = groupGap ?? (byGroup.size && !frame ? gap * 2 : gap);
  const o = origin || bbox(units.map((g) => g.now));
  const lo = linkedOrder(units, pairs, { gap: outer, aspect: want, movable: units.map((g) => rank(g) === 0) });
  const placed = lo.order.map((k) => units[k]);
  const best = lo.best;
  const at = best.at.map((p) => ({ x: p.x + o.x, y: p.y + o.y }));
  const rects = new Map();
  const shifts = new Map();
  const out = [];
  const clusters = [];
  placed.forEach((g, i) => {
    for (const { e, dx, dy } of g.members) {
      const nr = { x: Math.round(at[i].x + dx), y: Math.round(at[i].y + dy), w: e.rect.w, h: e.rect.h };
      rects.set(e.key, nr);
      const sx = nr.x - e.rect.x, sy = nr.y - e.rect.y;
      if (sx || sy) shifts.set(e.key, { dx: Math.round(sx), dy: Math.round(sy) });
      out.push({ ws: e.ws || null, keys: [e.key], rect: { ...nr } });
    }
    if (g.group != null) clusters.push({ group: g.group, keys: g.members.map((m) => m.e.key), rect: { x: Math.round(at[i].x), y: Math.round(at[i].y), w: g.w, h: g.h } });
  });
  return { shifts, rects, groups: out, clusters, aspect: want, rect: { x: o.x, y: o.y, w: best.w, h: best.h }, link: { pairs: pairs.length, plain: lo.plain.link || 0, now: best.link || 0 } };
}
