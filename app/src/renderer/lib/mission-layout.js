// 미션 맵 배치(I6, P32): 왼쪽에서 오른쪽으로 펼치는 나무. 순수 함수만 둔다(단위 시험: test/p32-lib.test.mjs).
// - 0열은 사람(명령 바). 세션은 "지시하는 쪽" 오른쪽에 놓인다(부모 → 자식). 부모는 자식들의 가운데 높이에 온다(정돈된 나무라 상자가 겹치지 않는다).
// - 한 쌍(A → B) 사이의 선 여럿(역할, 지시, 띄움, 명령 바, 루프)은 선 하나로 모은다. 모양은 가장 앞선 종류(역할 > 지시 > 띄움 > 명령 바 > 루프)를 따른다.
// - 나무 부모: 하위 세션의 부모(parentId) > 역할 > 띄움 > 지시 > 사람(명령 바, 루프). 고리가 생기는 부모는 고르지 않는다.
//   지시를 내리지만 받지는 않는 세션은 사람 아래(선 없이) 1열에 둔다. 선이 하나도 없는 세션은 아래 "연결 없음" 칸에 격자로 놓는다.
// - 나무에 들지 못한 선(두 번째 지시자, 같은 열, 뒤로 가는 선)도 긋되 이름표 없이 점만 둔다(올리면 풀이).
// - 이름표는 받는 상자 바로 왼쪽, 선의 끝 높이에 둔다. 받는 쪽마다 끝 높이를 나눠(최대 maxPorts) 이름표끼리 겹치지 않는다.
// - 거르기(filter)를 받으면 그 분류의 세션과 그 조상(흐리게, ghost)만 남긴다.
// - P46: 세션은 워크스페이스(저장소)별 무리로 묶는다. 무리는 위에서 아래로 쌓이는 띠이고, 열(깊이)은 판 전체에서 같다.
//   나무 자식은 같은 무리 안에서만 부모 옆에 모이고, 다른 무리의 워커는 자기 무리에서 뿌리가 된다. 그 선(cross)은 열 사이 틈으로만 무리를 건넌다.
//   선이 없는 세션은 그 무리 아래쪽 격자. 접은 무리(collapsed)는 머리줄만 남고, 그 세션들로 가는 선은 머리줄의 대리 상자(proxy)로 모인다.
// → { boxes: Map id → { x, y, w, h, node, ghost, depth, group, proxy? }, edges: [... cross, fromGroup, toGroup], groups: [{ key, x, y, w, h, count, needs, shown, collapsed, looseAt }], loose: [id], width, height, columns }

export const MISSION = { boxW: 236, boxH: 56, colGap: 156, rowGap: 12, pad: 28, sectionHead: 28, gridGap: 20, portGap: 18, maxPorts: 3, labelW: 116, minGridCols: 3, groupHead: 30, groupPad: 14, groupGap: 22, looseGap: 16 };
export const EDGE_ORDER = ['role', 'prompt', 'spawn', 'bar', 'loop'];
const PARENT_RANK = { parent: 0, role: 1, spawn: 2, prompt: 3, bar: 4, loop: 5 };
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || '')) || String(a.id).localeCompare(String(b.id));

// 한 쌍의 선들을 하나로: { id, from, to, kinds, primary, role, text, count, lastAt, active, status }
export function mergeEdges(edges, has = () => true) {
  const pairs = new Map();
  for (const e of edges || []) {
    if (!e || e.from === e.to || !has(e.from) || !has(e.to)) continue;
    const k = `${e.from}>${e.to}`;
    const p = pairs.get(k) || { id: k, from: e.from, to: e.to, kinds: [], parts: [], role: null, text: null, count: 0, lastAt: 0, active: false };
    if (!p.kinds.includes(e.kind)) p.kinds.push(e.kind);
    p.parts.push(e);
    if (e.kind === 'role' && e.label) p.role = e.label;
    if ((e.kind === 'prompt' || e.kind === 'bar' || e.kind === 'loop') && e.label && (e.lastAt || 0) >= p.lastAt) p.text = e.label;
    if (e.kind !== 'spawn') p.count += e.count || 0;
    p.lastAt = Math.max(p.lastAt, e.lastAt || 0);
    if (e.active) p.active = true;
    pairs.set(k, p);
  }
  for (const p of pairs.values()) {
    p.kinds.sort((a, b) => rank(a) - rank(b));
    p.primary = p.kinds[0];
  }
  return [...pairs.values()];
}
const rank = (k) => { const i = EDGE_ORDER.indexOf(k); return i < 0 ? EDGE_ORDER.length : i; };

// opt: filter(분류 거르기), collapsed(접은 무리의 워크스페이스 키들), order(무리 차례: 워크스페이스 키들, 판의 영역 차례)
export function missionLayout(graph, { filter = 'all', collapsed = [], order = [] } = {}) {
  const L = MISSION;
  const all = graph.nodes || [];
  const human = all.find((n) => n.kind === 'human') || null;
  const sessions = all.filter((n) => n.kind === 'session');
  const byId = new Map(all.map((n) => [n.id, n]));
  const pairs = mergeEdges(graph.edges, (id) => byId.has(id));
  // 하위 세션인데 띄움 선이 없으면(옛 판) 부모 → 자식 쌍을 하나 만든다
  for (const s of sessions) if (s.parentId && byId.has(s.parentId) && !pairs.some((p) => p.from === s.parentId && p.to === s.id)) pairs.push({ id: `${s.parentId}>${s.id}`, from: s.parentId, to: s.id, kinds: ['spawn'], primary: 'spawn', parts: [], role: s.role || null, text: null, count: 0, lastAt: 0, active: false, synthetic: true });

  // 나무 부모 고르기(고리 막기)
  const parent = new Map();
  const ancestorOf = (a, b) => { for (let x = b, i = 0; x && i < 1000; x = parent.get(x), i++) if (x === a) return true; return false; };
  const incoming = new Map();
  for (const p of pairs) push(incoming, p.to, p);
  const pRank = (s, p) => (p.from === s.parentId ? PARENT_RANK.parent : Math.min(...p.kinds.map((k) => PARENT_RANK[k] ?? 9)));
  for (const s of [...sessions].sort(byName)) {
    const cands = (incoming.get(s.id) || []).slice().sort((a, b) => pRank(s, a) - pRank(s, b) || byName(byId.get(a.from), byId.get(b.from)));
    for (const c of cands) if (!ancestorOf(s.id, c.from)) { parent.set(s.id, c.from); break; }
  }
  const touched = new Set();
  for (const p of pairs) { touched.add(p.from); touched.add(p.to); }
  const hid = human ? human.id : '__human';
  // 지시만 내리는 세션(부모 없음)은 사람 아래에
  for (const s of sessions) if (!parent.has(s.id) && touched.has(s.id)) parent.set(s.id, hid);

  // 거르기: 맞는 세션과 그 조상
  const match = (n) => filter === 'all' || n.category === filter;
  const visible = new Set(), ghost = new Set();
  for (const s of sessions) {
    if (!match(s)) continue;
    visible.add(s.id);
    for (let x = parent.get(s.id), i = 0; x && x !== hid && i < 1000; x = parent.get(x), i++) if (!visible.has(x)) { visible.add(x); ghost.add(x); }
  }
  for (const g of ghost) if (match(byId.get(g))) ghost.delete(g);

  // 열(깊이)은 판 전체에서 같다: 사람 0열, 사람 아래 1열, 그 자식 2열 … 무리가 달라도 같은 깊이는 같은 열이다
  const depth = (id) => { let d = 0; for (let x = id, i = 0; x && x !== hid && i < 1000; x = parent.get(x), i++) d++; return d; };
  const wsOf = (id) => { const n = byId.get(id); return n && n.kind === 'session' ? n.workspaceKey || '' : null; };
  const inTree = (s) => visible.has(s.id) && parent.has(s.id);
  // 나무 자식은 같은 무리 안만 잇는다. 다른 무리의 자식은 자기 무리에서 뿌리가 되고, 선이 무리 사이를 건넌다
  const kids = new Map();
  for (const s of sessions) if (inTree(s)) { const p = parent.get(s.id); if (p !== hid && wsOf(p) === wsOf(s.id)) push(kids, p, s); }
  for (const k of kids.values()) k.sort(byName);

  // 무리: 워크스페이스마다(키가 없으면 ''). 차례는 order, 없는 키는 이름 순, '' 는 끝
  const rankOf = (k) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  const keys = [...new Set(sessions.map((s) => s.workspaceKey || ''))].sort((a, b) => rankOf(a) - rankOf(b) || (a === '') - (b === '') || a.localeCompare(b));
  const shut = new Set(collapsed || []);
  const groups = [];
  for (const key of keys) {
    const members = sessions.filter((s) => (s.workspaceKey || '') === key);
    const shown = members.filter((s) => visible.has(s.id));
    if (!shown.length) continue;
    groups.push({ key, count: members.length, needs: members.filter((s) => s.category === 'needs_you').length, shown: shown.length, collapsed: shut.has(key), _shown: shown });
  }
  const treeMembers = sessions.filter(inTree);
  const hasTree = treeMembers.length > 0;
  const firstCol = hasTree ? 1 : 0;
  const maxDepth = hasTree ? Math.max(...treeMembers.map((s) => depth(s.id))) : 0;
  const colX = (d) => L.pad + d * (L.boxW + L.colGap);
  const innerX = colX(firstCol);
  const treeInnerW = hasTree ? (maxDepth - firstCol + 1) * L.boxW + (maxDepth - firstCol) * L.colGap : 0;
  const fitCols = Math.max(L.minGridCols, Math.floor((treeInnerW + L.gridGap) / (L.boxW + L.gridGap)));
  const looseOf = (g) => g._shown.filter((s) => !parent.has(s.id)).sort(byName);
  const gridW = (n) => (n ? n * L.boxW + (n - 1) * L.gridGap : 0);
  const innerW = Math.max(L.boxW, treeInnerW, ...groups.map((g) => gridW(Math.min(looseOf(g).length, fitCols))));

  const boxes = new Map();
  const proxyOf = new Map(); // 접은 무리의 세션 → 그 무리의 대리 상자(머리줄)
  const step = L.boxH + L.rowGap;
  let y = L.pad;
  for (const g of groups) {
    g.x = innerX - L.groupPad; g.w = innerW + 2 * L.groupPad; g.y = y; g.looseAt = null;
    if (g.collapsed) {
      // 접힌 무리는 머리줄만. 그 세션으로 가는 선은 머리줄의 대리 상자(가장 얕은 열)로 모은다
      const ds = g._shown.filter(inTree).map((s) => depth(s.id));
      const c = ds.length ? Math.min(...ds) : firstCol;
      const id = `g:${g.key}`;
      boxes.set(id, { x: colX(c), y: g.y, w: L.boxW, h: L.groupHead, node: { id, kind: 'group', key: g.key }, proxy: true, ghost: false, depth: c, group: g.key });
      for (const s of g._shown) proxyOf.set(s.id, id);
      g.h = L.groupHead;
      y += g.h + L.groupGap;
      continue;
    }
    const top = g.y + L.groupHead + L.groupPad;
    let row = 0;
    // 정돈된 나무: 잎은 다음 줄, 부모는 첫째와 끝 자식의 가운데
    const place = (s) => {
      const ch = kids.get(s.id) || [];
      let yy;
      if (!ch.length) { yy = top + row * step; row++; } else { const ys = ch.map(place); yy = (ys[0] + ys[ys.length - 1]) / 2; }
      const d = depth(s.id);
      boxes.set(s.id, { x: colX(d), y: yy, w: L.boxW, h: L.boxH, node: s, ghost: ghost.has(s.id), depth: d, group: g.key });
      return yy;
    };
    const roots = g._shown.filter((s) => inTree(s) && (parent.get(s.id) === hid || wsOf(parent.get(s.id)) !== g.key)).sort((a, b) => depth(a.id) - depth(b.id) || byName(a, b));
    for (const r of roots) place(r);
    let bottom = row ? top + row * step - L.rowGap : top - L.groupPad;
    const loose = looseOf(g);
    if (loose.length) {
      const cols = Math.min(loose.length, fitCols);
      let gy = top;
      if (row) { g.looseAt = { x: innerX, y: bottom + L.looseGap }; gy = g.looseAt.y + L.sectionHead; }
      loose.forEach((s, i) => boxes.set(s.id, { x: innerX + (i % cols) * (L.boxW + L.gridGap), y: gy + Math.floor(i / cols) * step, w: L.boxW, h: L.boxH, node: s, ghost: false, depth: null, loose: true, group: g.key }));
      bottom = gy + Math.ceil(loose.length / cols) * step - L.rowGap;
    }
    g.h = bottom + L.groupPad - g.y;
    y += g.h + L.groupGap;
  }

  // 선의 끝: 접힌 무리면 대리 상자. 끝이 바뀐 선은 같은 쌍끼리 다시 모은다
  const showHuman = hasTree && human;
  const endOf = (id) => (id === hid ? (showHuman ? hid : null) : proxyOf.get(id) || (boxes.has(id) ? id : null));
  const shownPairs = new Map();
  for (const p of pairs) {
    const a = endOf(p.from), b = endOf(p.to);
    if (!a || !b || a === b) continue;
    if (a === p.from && b === p.to) { shownPairs.set(p.id, { ...p }); continue; }
    const k = `${a}>${b}`;
    const q = shownPairs.get(k) || { id: k, from: a, to: b, kinds: [], parts: [], role: null, text: null, count: 0, lastAt: 0, active: false, folded: true };
    for (const kd of p.kinds) if (!q.kinds.includes(kd)) q.kinds.push(kd);
    q.role = q.role || p.role; if (p.text && (p.lastAt || 0) >= q.lastAt) q.text = p.text;
    q.count += p.count || 0; q.lastAt = Math.max(q.lastAt, p.lastAt || 0); q.active = q.active || p.active;
    q.kinds.sort((x, z) => rank(x) - rank(z)); q.primary = q.kinds[0];
    shownPairs.set(k, q);
  }
  const shown = [...shownPairs.values()];

  // 사람은 0열에 혼자다. 실제로 선이 가는 상자들의 가운데에 둔다(없으면 1열 상자들의 가운데)
  if (showHuman) {
    let ys = shown.filter((p) => p.from === hid).map((p) => boxes.get(p.to)).filter((b) => b && b.depth === 1).map((b) => b.y);
    if (!ys.length) ys = [...boxes.values()].filter((b) => b.depth === 1).map((b) => b.y);
    boxes.set(hid, { x: colX(0), y: ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : L.pad, w: L.boxW, h: L.boxH, node: human, ghost: false, depth: 0, group: null });
  }

  // 선: 나무 선은 이름표, 나머지는 점
  const isTree = (p) => !p.folded && parent.get(p.to) === p.from;
  const groupOf = (id) => (boxes.get(id) || {}).group ?? null;
  const inPorts = new Map(), outPorts = new Map();
  for (const p of shown) {
    const a = boxes.get(p.from), b = boxes.get(p.to);
    if (b.x > a.x) { push(inPorts, p.to, p); push(outPorts, p.from, p); }
  }
  const cy = (id) => { const b = boxes.get(id); return b.y + b.h / 2; };
  const portY = new Map();
  for (const [id, list] of inPorts) {
    // 나무 선이 먼저(가운데), 나머지는 위아래로. 이름표는 앞 maxPorts개만
    list.sort((a, b) => (isTree(b) - isTree(a)) || cy(a.from) - cy(b.from));
    const n = Math.min(list.length, L.maxPorts);
    const gap = Math.min(L.portGap, (boxes.get(id).h - 8) / Math.max(1, n - 1));
    const ord = list.slice(0, n).sort((a, b) => cy(a.from) - cy(b.from));
    ord.forEach((p, i) => portY.set(`in:${p.id}`, cy(id) + (i - (n - 1) / 2) * gap));
    list.slice(n).forEach((p) => portY.set(`in:${p.id}`, cy(id)));
    list.forEach((p, i) => { p._labelled = i < n; });
  }
  for (const [id, list] of outPorts) {
    list.sort((a, b) => cy(a.to) - cy(b.to));
    const span = Math.min(boxes.get(id).h - 16, (list.length - 1) * 8);
    list.forEach((p, i) => portY.set(`out:${p.id}`, cy(id) + (list.length > 1 ? -span / 2 + (span * i) / (list.length - 1) : 0)));
  }
  const edges = shown.map((p) => {
    const a = boxes.get(p.from), b = boxes.get(p.to);
    let d, lx, ly, label = false, back = false;
    if (b.x > a.x) {
      const x1 = a.x + a.w, y1 = portY.get(`out:${p.id}`), x2 = b.x, y2 = portY.get(`in:${p.id}`);
      const dx = Math.max(30, (x2 - x1) * 0.5);
      d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
      lx = x2 - 12; ly = y2;
      label = !!p._labelled && b.x - (a.x + a.w) >= L.labelW;
    } else if (b.x === a.x) {
      // 같은 열: 오른쪽으로 둥글게 돌아 받는 상자 오른쪽으로
      back = true;
      const x1 = a.x + a.w, y1 = cy(p.from) + 8, x2 = b.x + b.w, y2 = cy(p.to) - 8, bulge = 36 + Math.min(60, Math.abs(y2 - y1) / 5);
      d = `M${x1},${y1} C${x1 + bulge},${y1} ${x2 + bulge},${y2} ${x2},${y2}`;
      lx = x1 + bulge * 0.75; ly = (y1 + y2) / 2;
    } else {
      back = true;
      const x1 = a.x, y1 = cy(p.from) + 10, x2 = b.x + b.w, y2 = cy(p.to) + 10, dx = Math.max(40, (x1 - x2) / 2);
      d = `M${x1},${y1} C${x1 - dx},${y1 + 30} ${x2 + dx},${y2 + 30} ${x2},${y2}`;
      lx = (x1 + x2) / 2; ly = (y1 + y2) / 2 + 22;
    }
    const ga = groupOf(p.from), gb = groupOf(p.to);
    const cross = ga != null && gb != null && ga !== gb; // 다른 워크스페이스에게 시킴(사람에게서 오는 선은 빼고)
    const { parts, _labelled, ...rest } = p; // eslint-disable-line no-unused-vars
    return { ...rest, d, lx, ly, label, back, tree: isTree(p), cross, fromGroup: ga, toGroup: gb };
  });
  const out = groups.map(({ _shown, ...g }) => g); // eslint-disable-line no-unused-vars
  const right = Math.max(L.pad + L.boxW, ...out.map((g) => g.x + g.w), ...[...boxes.values()].map((b) => b.x + b.w));
  const bottom = Math.max(L.pad, ...out.map((g) => g.y + g.h), ...[...boxes.values()].map((b) => b.y + b.h));
  const loose = [...boxes.values()].filter((b) => b.loose).map((b) => b.node.id);
  return { boxes, edges, groups: out, loose, width: right + L.pad, height: bottom + L.pad, columns: hasTree ? maxDepth + 1 : 0 };
}
function push(m, k, v) { if (!m.has(k)) m.set(k, []); m.get(k).push(v); }

// 이름표 글(사전 함수 t를 받는다): 역할이면 역할 이름, 아니면 종류 이름. 횟수가 둘 이상이면 ×n
export function edgeLabel(e, t) {
  const base = e.role || t(`mission.edge.${e.primary}`);
  return e.count > 1 && e.primary !== 'role' ? `${base} ×${e.count}` : base;
}
