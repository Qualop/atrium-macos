// 미션 맵 배치(I6, P32 → P95에서 다시 그림 → P101 다듬음): 왼쪽 → 오른쪽 열. 순수 함수만 둔다(단위 시험 test/p95-lib.test.mjs, p101-lib.test.mjs 등).
// - 열: 0 = 나(사람, 작은 동그라미), 1 = 팀의 맨 위(리드), 2 = 그 하위 세션, 3 = 그 아래 … 열은 지도 전체에서 같다.
// - 팀(하위가 있는 뿌리)은 워크스페이스마다 위에서 아래로 쌓는다. 다른 워크스페이스의 하위 세션도 부모 옆에 놓는다(선이 지도를 가르지 않는다).
// - 팀이 없는 워크스페이스(혼자인 세션뿐)는 팀 흐름 오른쪽 빈 열에 짧은 기둥으로 채운다(가장 낮은 기둥부터). 오른쪽에 자리가 없으면 아래에 채운다. 세로 한 줄로 늘어서지 않는다.
// - P101: 워크스페이스마다 옅은 판(plate: 머리 글과 그 아래 놓인 상자들을 감싸는 바탕 면)이 있다. 판 사이 틈은 가로·세로 모두 같다(gutter).
//   간격은 4·8 단위로 고르게(카드 64, 알약 28, 상자 사이 8, 판 안 여백 10, 판 사이 16).
// - 세션 하나는 카드(일함·응답 필요·오류·결과, 하위가 있는 세션) 또는 테두리 있는 알약(쉼·잠듦·끝남)이다. 하위가 dotsMin개 이상이고 그중 쉬는 것이 dotsFold개 이상이면,
//   쉬는 하위들은 작은 동그라미 줄(종류 기호와 상태 배지)로 접는다. 동그라미마다 상자가 있어 가리키기·누르기가 된다.
// - 부모는 하위들의 세로 가운데에 온다. 선은 이름표 없는 가는 곡선: 부모 오른쪽 가장자리(하위 쪽으로 살짝 펼친 높이)에서 나가 받는 쪽 왼쪽으로 들어간다.
// - P101: 선은 두 상자가 마주 보는 가장자리 사이로 간다(lib/mission-wire.js). 서로 이은 두 세션(A → B, B → A)은 짧은 두 줄과 화살촉,
//   같은 열의 이웃은 아래·위 가장자리 사이 짧은 줄(이은 이웃 형제 사이는 linkGap만큼 벌린다), 뒤로 가는 선은 받는 쪽 오른쪽으로. 사이에 카드가 있는 같은 열은 오른쪽 짧은 괄호.
//   사람 선은 팀의 맨 위로만 긋고, 그 밖의 사람 선은 quiet(가리킬 때만).
// - 접은 워크스페이스는 머리 글만 남고, 그 세션으로 가는 선은 머리 글(대리 상자)로 모인다.
// - 거르기는 배치를 바꾸지 않는다(자리가 움직이지 않는다). 창이 맞지 않는 세션을 흐리게 한다(mission-model.js filterMatch).
// → { boxes: Map id → { x, y, w, h, node, depth, group, kind: 'you'|'card'|'row'|'dot'|'dots'|'group', loose?, proxy?, parent? },
//     edges: [{ id, from, to, d, tip, route, pair, kinds, primary, rel, tree, cross, back, quiet, active, count, lastAt, text, role }],
//     groups: [{ key, x, y, w, count, needs, collapsed, vg, packed, plate: { x, y, w, h } }], loose: [id], teamNo: Map 뿌리 id → 번호, order: [id](놓은 차례), width, height, columns, tree }
import { EDGE_ORDER, mergeEdges, missionTree, relOf, groupedOrder, bySpawn, nodeTier, restTier } from './mission-model.js';
import { wire, facing, pairOff, blocked, portY } from './mission-wire.js';

// P101: 4·8 단위로 고르게. plate = 판 안 여백, wsGap = 판 여백 둘 + 판 사이 16, slotGap = 기둥 사이(판 사이도 16), linkGap = 이은 이웃 형제 사이(짧은 줄 자리)
export const MISSION = { boxW: 216, boxH: 64, rowH: 28, dot: 18, dotGap: 6, dotsPerRow: 8, dotsMin: 6, dotsFold: 3, colGap: 72, cardGap: 8, rowGap: 8, linkGap: 24, pad: 28, you: 40, youGap: 52, wsHead: 30, wsGap: 36, slotGap: 36, plate: 10, quietSpan: 240 };
export { EDGE_ORDER, mergeEdges }; // P94: 공용 모델(lib/mission-model.js)로 옮겼다
const rank = (k) => { const i = EDGE_ORDER.indexOf(k); return i < 0 ? EDGE_ORDER.length : i; };
const r1 = (v) => Math.round(v * 10) / 10;

// opt: collapsed(접은 워크스페이스 키들), order(워크스페이스 차례, 판의 영역 차례), vgroups(P44 가상 그룹), tiers(Map id → 강조 등급, 없으면 노드의 상태), width(지도 칸 폭, 혼자인 워크스페이스를 채울 열 수)
export function missionLayout(graph, { collapsed = [], order: order0 = [], vgroups = [], tiers = null, width = 1300 } = {}) {
  const L = MISSION;
  const { order, groupOf: vgOf } = groupedOrder(order0, vgroups);
  const all = (graph && graph.nodes) || [];
  const human = all.find((n) => n.kind === 'human') || null;
  const hid = human ? human.id : null;
  const tree = missionTree(graph);
  const { byId } = tree;
  const tierOf = (id) => (tiers && tiers.has(id) ? tiers.get(id) : nodeTier(byId.get(id)));
  const kidsOf = (id) => tree.kids.get(id) || [];
  const wsOf = (id) => (byId.get(id) || {}).workspaceKey || '';
  const touched = new Set();
  for (const p of tree.pairs) { touched.add(p.from); touched.add(p.to); }
  const humanPairs = hid ? mergeEdges((graph && graph.edges) || [], (id) => id === hid || byId.has(id)).filter((p) => p.from === hid && byId.has(p.to)) : [];
  // P101: 나무 밖으로 이은 두 세션(어느 쪽이든). 이웃 형제면 사이를 linkGap만큼 벌려 짧은 줄 자리를 둔다
  const linked = new Set();
  for (const p of tree.pairs) if (!tree.treeEdge.has(p.id)) { linked.add(`${p.from}|${p.to}`); linked.add(`${p.to}|${p.from}`); }

  // 워크스페이스 차례: order, 없는 키는 이름 순, '' 는 끝
  const rankOf = (k) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  const roots = tree.nodes.filter((n) => !tree.parent.has(n.id)).sort(bySpawn);
  const keys = [...new Set(roots.map((n) => n.workspaceKey || ''))].sort((a, b) => rankOf(a) - rankOf(b) || (a === '') - (b === '') || a.localeCompare(b));
  const rootsOf = (k) => roots.filter((n) => (n.workspaceKey || '') === k);
  const isTeamWs = (k) => rootsOf(k).some((r) => kidsOf(r.id).length);
  const flowKeys = keys.filter(isTeamWs), packKeys = keys.filter((k) => !isTeamWs(k));
  const shut = new Set(collapsed || []);
  const hasYou = humanPairs.length > 0 && flowKeys.some((k) => !shut.has(k));
  const colX = (d) => L.pad + (hasYou ? L.you + L.youGap : 0) + (d - 1) * (L.boxW + L.colGap);

  const boxes = new Map(), proxyOf = new Map(), dotGroupOf = new Map(), groups = [], teamNo = new Map(), seq = []; // seq: 놓은 차례(부모 먼저)
  const memberCount = (r) => { let n = 0; const walk = (x) => { n++; for (const c of kidsOf(x)) walk(c.id); }; walk(r.id); return n; };
  const needsIn = (r) => { let n = 0; const walk = (x) => { const t = tierOf(x); if (t === 'turn' || t === 'alert') n++; for (const c of kidsOf(x)) walk(c.id); }; walk(r.id); return n; };
  const kindFor = (n) => (kidsOf(n.id).length || !restTier(tierOf(n.id)) ? 'card' : 'row');
  const hOf = (kind) => (kind === 'card' ? L.boxH : L.rowH);
  const gapOf = (kind) => (kind === 'row' ? L.rowGap : L.cardGap);
  let y = L.pad;

  // 정돈된 나무: 잎은 다음 자리, 부모는 하위들의 세로 가운데(앞 자리보다 위로는 가지 않는다)
  const place = (n, d, key) => {
    const start = y;
    seq.push(n.id);
    const ch = kidsOf(n.id);
    const rest = ch.filter((c) => !kidsOf(c.id).length && restTier(tierOf(c.id)));
    const fold = ch.length >= L.dotsMin && rest.length >= L.dotsFold ? rest : [];
    const normal = ch.filter((c) => !fold.includes(c));
    const kind = kindFor(n), h = hOf(kind);
    let yy;
    if (!normal.length && !fold.length) { yy = y; y += h + gapOf(kind); }
    else {
      let top = null, bottom = null;
      const span = (b) => { if (top === null) top = b.y; bottom = b.y + b.h; };
      let prev = null;
      for (const c of normal) {
        if (prev && linked.has(`${prev}|${c.id}`)) { const pb = boxes.get(prev); y = Math.max(y, pb.y + pb.h + L.linkGap); }
        place(c, d + 1, key); span(boxes.get(c.id)); prev = c.id;
      }
      if (fold.length) {
        const per = L.dotsPerRow, rows = Math.ceil(fold.length / per), gid = `dots:${n.id}`;
        const gh = rows * (L.dot + L.dotGap) - L.dotGap + 8, gx = colX(d + 1), gy = y;
        boxes.set(gid, { x: gx, y: gy, w: Math.min(L.boxW, 8 + Math.min(per, fold.length) * (L.dot + L.dotGap) + 40), h: gh, node: { id: gid, kind: 'dots', ids: fold.map((c) => c.id) }, depth: d + 1, group: key, kind: 'dots', parent: n.id });
        fold.forEach((c, i) => { seq.push(c.id); boxes.set(c.id, { x: gx + 4 + (i % per) * (L.dot + L.dotGap), y: gy + 4 + Math.floor(i / per) * (L.dot + L.dotGap), w: L.dot, h: L.dot, node: c, depth: d + 1, group: key, kind: 'dot', parent: gid }); dotGroupOf.set(c.id, gid); });
        y = gy + gh + L.cardGap;
        span(boxes.get(gid));
      }
      yy = Math.max(start, r1((top + bottom) / 2 - h / 2));
      y = Math.max(y, yy + h + gapOf(kind));
    }
    boxes.set(n.id, { x: colX(d), y: yy, w: L.boxW, h, node: n, depth: d, group: key, kind });
  };

  // 팀 흐름(왼쪽): 워크스페이스 머리 글, 그 아래 팀(리드 → 하위)과 같은 워크스페이스의 혼자인 세션
  let nTeam = 0;
  const hidden = (r, gid) => { const walk = (x) => { proxyOf.set(x, gid); for (const c of kidsOf(x)) walk(c.id); }; walk(r.id); };
  for (const k of flowKeys) {
    const rs = [...rootsOf(k).filter((r) => kidsOf(r.id).length), ...rootsOf(k).filter((r) => !kidsOf(r.id).length)]; // 팀 먼저, 연결 없는 세션은 그 아래
    const g = { key: k, x: colX(1), y, w: L.boxW, count: rs.reduce((a, r) => a + memberCount(r), 0), needs: rs.reduce((a, r) => a + needsIn(r), 0), collapsed: shut.has(k), vg: vgOf.get(k) || null, packed: false };
    groups.push(g);
    if (g.collapsed) {
      const gid = `g:${k}`;
      boxes.set(gid, { x: g.x, y: g.y, w: L.boxW, h: L.wsHead - 4, node: { id: gid, kind: 'group', key: k }, depth: 1, group: k, kind: 'group', proxy: true });
      for (const r of rs) hidden(r, gid);
      y += L.wsHead + L.wsGap;
      continue;
    }
    y += L.wsHead;
    let last = 'card';
    for (const r of rs) { if (kidsOf(r.id).length) teamNo.set(r.id, ++nTeam); place(r, 1, k); last = boxes.get(r.id).kind; }
    y += L.wsGap - gapOf(last);
  }
  const flowBoxes = [...boxes.values()].filter((b) => !b.proxy);
  const flowRight = flowBoxes.length ? Math.max(...flowBoxes.map((b) => b.x + b.w)) : null;
  const flowBottom = y;

  // 혼자인 워크스페이스: 오른쪽 빈 열(없으면 아래)에 기둥으로 채운다
  if (packKeys.length) {
    let x0 = L.pad, y0 = L.pad;
    if (flowRight !== null) { x0 = flowRight + L.slotGap; if (x0 + L.boxW > width - L.pad) { x0 = colX(1); y0 = flowBottom; } } // P101: 판 사이 틈이 기둥 사이와 같다
    const step = L.boxW + L.slotGap;
    const n = Math.max(1, Math.floor((width - L.pad - x0 + L.slotGap) / step));
    const sky = Array(n).fill(y0);
    for (const k of packKeys) {
      const c = sky.indexOf(Math.min(...sky));
      const x = x0 + c * step;
      const rs = rootsOf(k);
      const g = { key: k, x, y: sky[c], w: L.boxW, count: rs.length, needs: rs.filter((r) => ['turn', 'alert'].includes(tierOf(r.id))).length, collapsed: shut.has(k), vg: vgOf.get(k) || null, packed: true };
      groups.push(g);
      let yy = sky[c] + L.wsHead;
      if (g.collapsed) {
        const gid = `g:${k}`;
        boxes.set(gid, { x, y: g.y, w: L.boxW, h: L.wsHead - 4, node: { id: gid, kind: 'group', key: k }, depth: null, group: k, kind: 'group', proxy: true });
        for (const r of rs) proxyOf.set(r.id, gid);
        sky[c] = g.y + L.wsHead + L.wsGap;
        continue;
      }
      let last = 'card';
      for (const r of rs) { const kind = kindFor(r), h = hOf(kind); seq.push(r.id); boxes.set(r.id, { x, y: yy, w: L.boxW, h, node: r, depth: null, group: k, kind, loose: true }); yy += h + gapOf(kind); last = kind; }
      sky[c] = yy - gapOf(last) + L.wsGap;
    }
    y = Math.max(y, ...sky);
  }

  // 나: 사람 선이 가는 팀 맨 위들의 가운데
  const targets = humanPairs.map((p) => boxes.get(p.to)).filter((b) => b && b.depth === 1 && b.kind !== 'group' && !proxyOf.has(b.node.id));
  if (hasYou) {
    const cs = (targets.length ? targets : flowBoxes.filter((b) => b.depth === 1)).map((b) => b.y + b.h / 2);
    const cy = cs.length ? (Math.min(...cs) + Math.max(...cs)) / 2 : L.pad + L.you / 2;
    boxes.set(hid, { x: L.pad, y: r1(cy - L.you / 2), w: L.you, h: L.you, node: human, depth: 0, group: null, kind: 'you' });
  }

  // 선. 끝이 대리 상자(접은 워크스페이스)나 동그라미 줄로 바뀐 나무 선은 같은 쌍끼리 다시 모은다
  const endOf = (id, isTree) => (id === hid ? (boxes.has(hid) ? hid : null) : proxyOf.get(id) || (isTree && dotGroupOf.get(id)) || (boxes.has(id) ? id : null));
  const shown = new Map();
  const quietOf = (p) => p.from === hid && !targets.some((b) => b.node.id === p.to);
  for (const p of [...tree.pairs, ...humanPairs]) {
    const isTree = tree.treeEdge.has(p.id);
    const a = endOf(p.from, false), b = endOf(p.to, isTree);
    if (!a || !b || a === b) continue;
    const rel = p.from === hid ? 'human' : relOf(p, tree);
    const cross = p.from !== hid && wsOf(p.from) !== wsOf(p.to);
    if (a === p.from && b === p.to) { shown.set(p.id, { ...p, rel, tree: isTree, cross, quiet: quietOf(p) }); continue; }
    const k = `${a}>${b}`;
    const q = shown.get(k) || { id: k, from: a, to: b, kinds: [], parts: [], role: null, text: null, count: 0, lastAt: 0, active: false, folded: true, rel, tree: isTree, cross: false, quiet: quietOf(p), members: [] };
    for (const kd of p.kinds) if (!q.kinds.includes(kd)) q.kinds.push(kd);
    q.members.push(p.id);
    q.role = q.role || p.role; if (p.text && (p.lastAt || 0) >= q.lastAt) q.text = p.text;
    q.count += p.count || 0; q.lastAt = Math.max(q.lastAt, p.lastAt || 0); q.active = q.active || p.active; q.cross = q.cross || cross; q.tree = q.tree && isTree;
    q.kinds.sort((x, z) => rank(x) - rank(z)); q.primary = q.kinds[0];
    shown.set(k, q);
  }
  const cy = (b) => b.y + b.h / 2;
  // P101: 선의 길(lib/mission-wire.js). 두 끝이 모두 세션 상자일 때 마주 보는 가장자리를 고르고, 서로 이은 두 세션은 짧은 두 줄로 나란히
  const isSess = (bx) => !!bx && !!bx.node && bx.node.kind === 'session';
  const sessBoxes = [...boxes.values()].filter((bx) => isSess(bx) && bx.kind !== 'dot');
  const edges = [...shown.values()].map((p) => {
    const a = boxes.get(p.from), b = boxes.get(p.to);
    const { parts, ...rest } = p; // eslint-disable-line no-unused-vars
    const mate = shown.get(`${p.to}>${p.from}`);
    const both = isSess(a) && isSess(b);
    const pair = both && !!mate && !(mate.quiet && !mate.tree && !p.tree);
    let route = facing(a, b) || 'side';
    if ((route === 'd' || route === 'u') && blocked(a, b, sessBoxes)) route = 'side';
    // 나무 밖 선이 멀리 가면(세로로 quietSpan 넘게) 지도를 가르므로 가리킬 때만 긋는다. 서로 이은 두 줄은 나무 선이 있으면 늘 긋는다
    const far = !p.tree && p.rel !== 'human' && Math.abs(cy(b) - cy(a)) > L.quietSpan && !(pair && (p.tree || (mate && mate.tree)));
    // 나가는·들어가는 높이: 부모(왼쪽 상자) 오른쪽 가장자리는 받는 쪽으로 살짝 펼친다(사람 선과 대리 상자는 가운데)
    const spread = p.rel !== 'human' && a.kind !== 'you';
    const y1 = route === 'r' && spread && a.kind === 'card' ? portY(a, b) : null;
    const y2 = route === 'l' && spread && b.kind === 'card' ? portY(b, a) : null;
    if (route === 'r' && !pair) { // 앞으로 가는 선(왼쪽 → 오른쪽): P95 그대로 화살촉 없이
      const w = wire(a, b, { y1 });
      return { ...rest, d: w.d, tip: null, route: 'flow', pair: false, back: false, quiet: !!p.quiet || far };
    }
    const w = wire(a, b, { off: pair ? pairOff(a, b, route) : 0, tip: true, route, y1, y2 });
    const kind = pair ? 'pair' : route === 'd' || route === 'u' ? 'near' : route === 'l' ? 'back' : route === 'side' ? 'side' : 'flow';
    return { ...rest, d: w.d, tip: w.tip, route: kind, pair, back: route === 'l' || route === 'u' || route === 'side', quiet: pair ? false : !!p.quiet || far };
  });
  // P101: 워크스페이스 판. 머리 글과 그 아래 놓인 상자(다른 워크스페이스의 하위 세션도 그 팀에 놓였으면 포함)를 plate 여백으로 감싼다
  for (const g of groups) {
    let x1 = g.x + L.boxW, y1 = g.y + (g.collapsed ? L.wsHead - 8 : L.wsHead);
    for (const bx of boxes.values()) if (bx.group === g.key && bx.kind !== 'you') { x1 = Math.max(x1, bx.x + bx.w); y1 = Math.max(y1, bx.y + bx.h); }
    g.plate = { x: r1(g.x - L.plate), y: r1(g.y - L.plate), w: r1(x1 - g.x + 2 * L.plate), h: r1(y1 - g.y + 2 * L.plate) };
    g.w = r1(x1 - g.x);
  }
  const bs = [...boxes.values()];
  const right = bs.length ? Math.max(...bs.map((b) => b.x + b.w), ...groups.map((g) => g.plate.x + g.plate.w)) : L.pad;
  const bottom = bs.length ? Math.max(...bs.map((b) => b.y + b.h), ...groups.map((g) => g.plate.y + g.plate.h)) : L.pad;
  const depths = bs.filter((b) => Number.isFinite(b.depth)).map((b) => b.depth);
  const loose = roots.filter((r) => !kidsOf(r.id).length && !touched.has(r.id) && boxes.has(r.id)).map((r) => r.id);
  return { boxes, edges, groups, loose, teamNo, order: seq, width: r1(right + L.pad), height: r1(bottom + L.pad), columns: depths.length ? Math.max(...depths) + 1 : 0, tree };
}

// 지도 차례(요약 열이 쓴다): 팀 흐름의 놓은 차례(부모 먼저), 그다음 채운 기둥의 차례
export const mapOrder = (lay) => lay.order.filter((id) => lay.boxes.has(id));

// 선 풀이 글(사전 함수 t): "하위 세션 · 역할: reviewer", 다른 워크스페이스, 마지막 지시, 횟수
export function edgeLabel(e, t) {
  const base = e.role || t(`mission.edge.${e.primary}`);
  return e.count > 1 && e.primary !== 'role' ? `${base} ×${e.count}` : base;
}
