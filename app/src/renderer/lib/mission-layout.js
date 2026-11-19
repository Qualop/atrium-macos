// 미션 맵 배치(I6, P32 → P95에서 다시 그림 → P101 다듬음 → P145 "나"를 걷고 촘촘히): 왼쪽 → 오른쪽 열. 순수 함수만 둔다(단위 시험 test/p95-lib.test.mjs, p101-lib.test.mjs, p145-lib.test.mjs 등).
// - 열: 1 = 팀의 맨 위(리드, 그 단위의 왼쪽 끝), 2 = 그 하위 세션, 3 = 그 아래 … 열 자리는 한 단위(폴더 상자, 폴더 밖 판) 안에서 같다.
//   P145: 왼쪽 끝의 "나"(사람 동그라미)와 사람 선은 걷었다. 사람이 보낸 지시(명령 입력줄·반복 작업)는 그 카드의 풍선 도움말에만 남긴다(human: Map id → { count, lastAt, text, kinds }).
// - 팀(하위가 있는 뿌리)은 워크스페이스마다 팀 먼저 위에서 아래로 놓는다. 다른 워크스페이스의 하위 세션도 부모 옆에 놓는다(선이 지도를 가르지 않는다).
//   팀이 있는 워크스페이스의 혼자인 세션은 팀 아래, 팀이 차지한 열들에 나눠 채운다(P145, 예전에는 1열 한 줄).
// - 단위(폴더 상자, 폴더 밖 판)는 지도 칸에 빈 곳 채우기로 놓는다(P145): 팀이 있는 단위를 차례대로 가장 높이 놓이는 자리(같으면 왼쪽)에, 그다음 팀이 없는 단위를 남은 빈 곳에.
//   좁은 지도에서는 예전처럼 위에서 아래로 쌓이고(열이 지도 전체에서 같다), 넓은 지도에서는 팀 단위도 오른쪽에 나란히 선다.
//   팀이 없는 워크스페이스는 짧은 기둥으로 채우고, 혼자인 세션이 많으면(packCap개 넘게) 기둥 여럿(세 개까지) 중 아래 끝이 가장 높은 모양을 고른다.
// - P101: 워크스페이스마다 옅은 판(plate: 머리 글과 그 아래 놓인 상자들을 감싸는 바탕 면)이 있다. 판 사이 틈은 가로·세로 모두 같다(gutter).
//   간격은 4·8 단위로 고르게(카드 64, 알약 28, 상자 사이 8, 판 안 여백 10, 판 사이 16).
// - 세션 하나는 카드(일함·응답 필요·오류·결과, 하위가 있는 세션) 또는 테두리 있는 알약(쉼·잠듦·끝남)이다. 하위가 dotsMin개 이상이고 그중 쉬는 것이 dotsFold개 이상이면,
//   쉬는 하위들은 작은 동그라미 줄(종류 기호와 상태 배지)로 접는다. 동그라미마다 상자가 있어 가리키기·누르기가 된다.
// - 부모는 하위들의 세로 가운데에 온다. 선은 이름표 없는 가는 곡선: 부모 오른쪽 가장자리(하위 쪽으로 살짝 펼친 높이)에서 나가 받는 쪽 왼쪽으로 들어간다.
// - P101: 선은 두 상자가 마주 보는 가장자리 사이로 간다(lib/mission-wire.js). 서로 이은 두 세션(A → B, B → A)은 짧은 두 줄과 화살촉,
//   같은 열의 이웃은 아래·위 가장자리 사이 짧은 줄(이은 이웃 형제 사이는 linkGap만큼 벌린다), 뒤로 가는 선은 받는 쪽 오른쪽으로. 사이에 카드가 있는 같은 열은 오른쪽 짧은 괄호.
// - 접은 워크스페이스는 머리 글만 남고, 그 세션으로 가는 선은 머리 글(대리 상자)로 모인다.
// - 거르기는 배치를 바꾸지 않는다(자리가 움직이지 않는다). 창이 맞지 않는 세션을 흐리게 한다(mission-model.js filterMatch).
// → { boxes: Map id → { x, y, w, h, node, depth, group, kind: 'card'|'row'|'dot'|'dots'|'group', loose?, proxy?, parent? },
//     edges: [{ id, from, to, d, tip, route, pair, kinds, primary, rel, tree, cross, back, quiet, active, count, lastAt, text, role }],
//     groups: [{ key, x, y, w, count, needs, collapsed, vg, packed, plate: { x, y, w, h } }], loose: [id], teamNo: Map 뿌리 id → 번호, human: Map id → 사람 지시, order: [id](놓은 차례), width, height, columns, tree }
import { EDGE_ORDER, mergeEdges, missionTree, relOf, groupedOrder, bySpawn, nodeTier, restTier } from './mission-model.js';
import { wire, facing, pairOff, blocked, portY } from './mission-wire.js';

// P101: 4·8 단위로 고르게. plate = 판 안 여백, wsGap = 판 여백 둘 + 판 사이 16, slotGap = 기둥 사이(판 사이도 16), linkGap = 이은 이웃 형제 사이(짧은 줄 자리)
// P134: 폴더 상자. m = 상자 안 여백(워크스페이스 판 바깥 ~ 상자 테두리), head = 상자 위 가장자리 ~ 첫 판 위 가장자리(폴더 이름 줄)
// P137: 폴더 상자 안 워크스페이스 상자(판)가 두 겹으로 읽히게 안 여백 8 → 12, 머리 30 → 32(폴더 이름 글이 한 단 크다)
export const FOLDER = { m: 12, head: 32 };
// P145: "나" 자리(you, youGap)를 걷고 열 사이 72 → 48(선 곡선은 이 폭이면 충분하다), 지도 둘레 28 → 20. packCap = 판 하나의 한 기둥에 놓는 혼자인 세션 수(넘으면 기둥을 나눈다),
//   looseGap = 팀과 그 아래 혼자인 세션 줄 사이에 더 띄우는 틈(혼자인 세션이 하위 세션 열에 놓여도 팀원으로 읽히지 않게)
// P149: 카드 한 장에 역할·상태·모델·지금(또는 마지막) 일이 다 읽히게 카드 216×64(세 줄) → 248×96(이름 / 역할·상태 / 일 두 줄까지 / 메타), 쉬는 알약 28 → 44(두 줄: 이름·역할·상태, 모델·마지막 일)
export const MISSION = { boxW: 248, boxH: 96, rowH: 44, dot: 18, dotGap: 6, dotsPerRow: 8, dotsMin: 6, dotsFold: 3, colGap: 48, cardGap: 8, rowGap: 8, linkGap: 24, pad: 20, wsHead: 30, wsGap: 36, slotGap: 36, plate: 10, quietSpan: 240, packCap: 6, looseGap: 16 };
// P149: 큰 창 맞춤 배율. 지도(카드·글자·간격)는 1584×921 창 기준 고정 크기라 2576×1408 창에서 화면의 3분의 1만 썼다.
// 덮개 크기(w×h)에서 1600×940을 넘는 만큼 키운다(가로 4800px·세로 2300px마다 1배, 둘 중 작은 쪽). 1에서 1.35 사이, 0.05 단위(창을 조금 끌 때 다시 놓기를 줄인다).
// 2576×1408 → 1.2(본문 12px이 14.4px로 보인다), 1584×921·1366×768 → 1(지금처럼). 그리는 쪽은 지도·머리줄·요약 열에 CSS zoom으로 준다
export function missionScale(w, h) {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  const s = 1 + Math.min((w - 1600) / 4800, (h - 940) / 2300);
  return Math.round(Math.max(1, Math.min(1.35, s)) * 20) / 20;
}
export { EDGE_ORDER, mergeEdges }; // P94: 공용 모델(lib/mission-model.js)로 옮겼다
const rank = (k) => { const i = EDGE_ORDER.indexOf(k); return i < 0 ? EDGE_ORDER.length : i; };
const r1 = (v) => Math.round(v * 10) / 10;

// opt: collapsed(접은 워크스페이스 키들), order(워크스페이스 차례, 판의 영역 차례), vgroups(P44 가상 그룹), tiers(Map id → 강조 등급, 없으면 노드의 상태), width(지도 칸 폭, 혼자인 워크스페이스를 채울 열 수)
export function missionLayout(graph, { collapsed = [], order: order0 = [], vgroups = [], tiers = null, width = 1300 } = {}) {
  const L = MISSION;
  const { order, groupOf: vgOf } = groupedOrder(order0, vgroups);
  const all = (graph && graph.nodes) || [];
  const hid = (all.find((n) => n.kind === 'human') || {}).id || null;
  const tree = missionTree(graph);
  const { byId } = tree;
  const tierOf = (id) => (tiers && tiers.has(id) ? tiers.get(id) : nodeTier(byId.get(id)));
  const kidsOf = (id) => tree.kids.get(id) || [];
  const wsOf = (id) => (byId.get(id) || {}).workspaceKey || '';
  const touched = new Set();
  for (const p of tree.pairs) { touched.add(p.from); touched.add(p.to); }
  // P145: 사람(명령 입력줄·반복 작업)이 보낸 지시는 선 없이 받는 세션의 표시로만 남긴다
  const human = new Map();
  if (hid) for (const p of mergeEdges((graph && graph.edges) || [], (id) => id === hid || byId.has(id))) if (p.from === hid && byId.has(p.to)) human.set(p.to, { count: p.count || 0, lastAt: p.lastAt || 0, text: p.text || null, kinds: p.kinds });
  // P101: 나무 밖으로 이은 두 세션(어느 쪽이든). 이웃 형제면 사이를 linkGap만큼 벌려 짧은 줄 자리를 둔다
  const linked = new Set();
  for (const p of tree.pairs) if (!tree.treeEdge.has(p.id)) { linked.add(`${p.from}|${p.to}`); linked.add(`${p.to}|${p.from}`); }

  // 워크스페이스 차례: order, 없는 키는 이름 순, '' 는 끝
  const rankOf = (k) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  const roots = tree.nodes.filter((n) => !tree.parent.has(n.id)).sort(bySpawn);
  const keys = [...new Set(roots.map((n) => n.workspaceKey || ''))].sort((a, b) => rankOf(a) - rankOf(b) || (a === '') - (b === '') || a.localeCompare(b));
  const rootsOf = (k) => roots.filter((n) => (n.workspaceKey || '') === k);
  const isTeamWs = (k) => rootsOf(k).some((r) => kidsOf(r.id).length);
  const shut = new Set(collapsed || []);
  // P134: 폴더(사이드바의 가상 그룹, P44·P103) 단위. 폴더에 든 워크스페이스들은 한 상자 안에 모이고, 폴더 밖 워크스페이스는 지금처럼 하나씩 놓는다.
  // 팀이 있는 단위는 왼쪽 흐름에 위에서 아래로 쌓고(열은 지도 전체에서 같다), 팀이 없는 단위는 오른쪽 빈 곳(없으면 아래)에 채운다.
  const F = FOLDER;
  const units = [], unitOf = new Map();
  for (const k of keys) {
    const vg = vgOf.get(k) || null, uk = vg ? `f:${vg.id}` : `w:${k}`;
    if (!unitOf.has(uk)) { const u = { key: uk, folder: vg, keys: [] }; unitOf.set(uk, u); units.push(u); }
    unitOf.get(uk).keys.push(k);
  }
  const inset = units.some((u) => u.folder) ? F.m : 0; // 폴더 상자 테두리가 지도 왼쪽 끝에 붙지 않게 열 전체를 그만큼 민다
  const colX = (d) => L.pad + inset + (d - 1) * (L.boxW + L.colGap);
  const isTeamUnit = (u) => u.keys.some(isTeamWs);
  const flowUnits = units.filter(isTeamUnit), packUnits = units.filter((u) => !isTeamUnit(u));

  const boxes = new Map(), proxyOf = new Map(), dotGroupOf = new Map(), groups = [], folders = [], teamNo = new Map(), seq = []; // seq: 놓은 차례(부모 먼저)
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

  // 워크스페이스 판(P101): 머리 글과 그 아래 놓인 상자(다른 워크스페이스의 하위 세션도 그 팀에 놓였으면 포함)를 plate 여백으로 감싼다
  const plateOf = (g) => {
    let x1 = g.x + L.boxW, y1 = g.y + (g.collapsed ? L.wsHead - 8 : L.wsHead);
    for (const bx of boxes.values()) if (bx.group === g.key) { x1 = Math.max(x1, bx.x + bx.w); y1 = Math.max(y1, bx.y + bx.h); }
    return { x: r1(g.x - L.plate), y: r1(g.y - L.plate), w: r1(x1 - g.x + 2 * L.plate), h: r1(y1 - g.y + 2 * L.plate) };
  };
  // 단위의 바깥 사각형: 폴더면 폴더 상자(판들 + 안 여백 m, 위에 머리), 아니면 그 워크스페이스의 판
  const outerOf = (u) => {
    const ps = groups.filter((g) => u.keys.includes(g.key)).map(plateOf);
    if (!ps.length) return null;
    const x0 = Math.min(...ps.map((p) => p.x)), y0 = Math.min(...ps.map((p) => p.y));
    const x1 = Math.max(...ps.map((p) => p.x + p.w)), y1 = Math.max(...ps.map((p) => p.y + p.h));
    const m = u.folder ? F.m : 0, head = u.folder ? F.head : 0;
    return { x: r1(x0 - m), y: r1(y0 - head), w: r1(x1 - x0 + 2 * m), h: r1(y1 - y0 + head + m) };
  };

  // 팀 흐름(왼쪽): 워크스페이스 머리 글, 그 아래 팀(리드 → 하위)과 같은 워크스페이스의 혼자인 세션
  let nTeam = 0;
  const hidden = (r, gid) => { const walk = (x) => { proxyOf.set(x, gid); for (const c of kidsOf(x)) walk(c.id); }; walk(r.id); };
  const flowWs = (k) => {
    const rs = [...rootsOf(k).filter((r) => kidsOf(r.id).length), ...rootsOf(k).filter((r) => !kidsOf(r.id).length)]; // 팀 먼저, 연결 없는 세션은 그 아래
    const g = { key: k, x: colX(1), y, w: L.boxW, count: rs.reduce((a, r) => a + memberCount(r), 0), needs: rs.reduce((a, r) => a + needsIn(r), 0), collapsed: shut.has(k), vg: vgOf.get(k) || null, packed: false };
    groups.push(g);
    if (g.collapsed) {
      const gid = `g:${k}`;
      boxes.set(gid, { x: g.x, y: g.y, w: L.boxW, h: L.wsHead - 4, node: { id: gid, kind: 'group', key: k }, depth: 1, group: k, kind: 'group', proxy: true });
      for (const r of rs) hidden(r, gid);
      y += L.wsHead + L.wsGap;
      return;
    }
    y += L.wsHead;
    let last = 'card';
    const teams = rs.filter((r) => kidsOf(r.id).length), solo = rs.filter((r) => !kidsOf(r.id).length);
    for (const r of teams) { teamNo.set(r.id, ++nTeam); place(r, 1, k); last = boxes.get(r.id).kind; }
    // P145: 혼자인 세션은 팀 아래, 팀이 차지한 열들(열 자리 그대로)에 나눠 채운다. 1열 한 줄로 길게 늘어서지 않는다
    if (solo.length) {
      let deep = 1;
      for (const bx of boxes.values()) if (bx.group === k && Number.isFinite(bx.depth)) deep = Math.max(deep, bx.depth);
      const n = Math.max(1, Math.min(deep, solo.length));
      if (teams.length) y += L.looseGap;
      y = gridRoots(solo, Array.from({ length: n }, (_, c) => colX(c + 1)), y, k) + gapOf('card');
      last = 'card';
    }
    y += L.wsGap - gapOf(last);
  };
  // 혼자인 세션 여럿을 기둥들(xs)에 채운다(가장 낮은 기둥부터, 같으면 왼쪽) → 가장 낮게 놓인 상자의 아래 가장자리
  function gridRoots(rs, xs, y0, k) {
    const sky = xs.map(() => y0), end = xs.map(() => y0);
    for (const r of rs) {
      const c = sky.indexOf(Math.min(...sky)), kind = kindFor(r), h = hOf(kind);
      seq.push(r.id);
      boxes.set(r.id, { x: xs[c], y: sky[c], w: L.boxW, h, node: r, depth: null, group: k, kind, loose: true });
      end[c] = sky[c] + h; sky[c] = end[c] + gapOf(kind);
    }
    return Math.max(...end);
  }
  // 혼자인 워크스페이스 하나를 (x, y0)에 기둥 cols개로 놓는다 → 그 아래 다음 머리 글 자리
  const packWs = (k, x, y0, cols = 1) => {
    const rs = rootsOf(k);
    const g = { key: k, x, y: y0, w: L.boxW, count: rs.length, needs: rs.filter((r) => ['turn', 'alert'].includes(tierOf(r.id))).length, collapsed: shut.has(k), vg: vgOf.get(k) || null, packed: true };
    groups.push(g);
    if (g.collapsed) {
      const gid = `g:${k}`;
      boxes.set(gid, { x, y: g.y, w: L.boxW, h: L.wsHead - 4, node: { id: gid, kind: 'group', key: k }, depth: null, group: k, kind: 'group', proxy: true });
      for (const r of rs) proxyOf.set(r.id, gid);
      return g.y + L.wsHead + L.wsGap;
    }
    if (!rs.length) return y0 + L.wsHead - L.cardGap + L.wsGap;
    return gridRoots(rs, Array.from({ length: Math.max(1, cols) }, (_, c) => x + c * step), y0 + L.wsHead, k) + L.wsGap;
  };
  // P145: 혼자인 세션이 packCap개 넘는 워크스페이스는 기둥 여럿(세 개까지)으로 나눈다. 워크스페이스 여럿이면 하나에 기둥 하나
  const wantOf = (k) => (shut.has(k) ? 1 : Math.max(1, Math.min(3, Math.ceil(rootsOf(k).length / L.packCap))));
  const spanOf = (ks) => (ks.length > 1 ? Math.max(ks.length, ...ks.map(wantOf)) : wantOf(ks[0]));
  // 혼자인 워크스페이스 여럿을 x0부터 n개 기둥에 채운다(가장 높이 놓이는 자리, 같으면 왼쪽) → 가장 낮은 기둥 아래 다음 머리 글 자리
  // P145: 혼자인 세션이 많은 워크스페이스는 이웃한 기둥 여럿(wantOf)을 함께 쓴다
  const step = L.boxW + L.slotGap;
  const packCols = (ks, x0, y0, n) => {
    n = Math.max(1, n);
    if (ks.length === 1) return packWs(ks[0], x0, y0, n);
    const sky = Array(n).fill(y0);
    for (const k of ks) {
      const c = Math.min(n, wantOf(k));
      let s0 = 0, top = Infinity;
      for (let s = 0; s + c <= n; s++) { const t = Math.max(...sky.slice(s, s + c)); if (t < top) { top = t; s0 = s; } }
      const yy = packWs(k, x0 + s0 * step, top, c);
      for (let s = s0; s < s0 + c; s++) sky[s] = yy;
    }
    return Math.max(...sky);
  };
  const teamRight = (ks) => { let r = colX(1) + L.boxW; for (const bx of boxes.values()) if (ks.includes(bx.group)) r = Math.max(r, bx.x + bx.w); return r; };

  for (const u of flowUnits) {
    if (!u.folder) { for (const k of u.keys) flowWs(k); continue; }
    // 폴더 상자: 위 가장자리(판이 놓일 자리 - 판 여백)에서 머리만큼 내려 첫 워크스페이스를 놓는다
    y = y - L.plate + F.head + L.plate;
    const y0 = y;
    const tk = u.keys.filter(isTeamWs), sk = u.keys.filter((k) => !isTeamWs(k));
    for (const k of tk) flowWs(k);
    // 같은 폴더의 혼자인 워크스페이스: 지도 칸에 자리가 있으면 팀 오른쪽(상자 안, 세 기둥까지)에 위부터 채워 상자가 길어지지 않게 하고,
    // 자리가 없으면 팀 아래, 팀이 차지한 폭 안의 기둥으로 채운다(상자가 옆으로 넓어지지 않게)
    if (sk.length) {
      const x0 = teamRight(tk) + L.slotGap;
      const room = Math.floor((width - L.pad - F.m - L.plate - x0 + L.slotGap) / step);
      if (room >= 1) y = Math.max(y, packCols(sk, x0, y0, Math.min(room, spanOf(sk), 3)));
      else y = packCols(sk, colX(1), y, Math.floor((teamRight(tk) - colX(1) + L.slotGap) / step));
    }
    y += F.m;
  }
  // P145: 단위(폴더 상자, 폴더 밖 판)를 지도 칸에 채운다. 바깥 사각형으로 셈하고 서로 판 사이 틈(gutter)만큼 띄운다.
  // 자리 후보: 기둥 자리(ox0 + c × step)와 놓인 단위마다 그 오른쪽 끝 + 틈(폴더 상자는 기둥 폭의 배수가 아니다). 가장 높이 놓이는 자리, 같으면 왼쪽
  const gut = L.slotGap - 2 * L.plate;
  const ox0 = L.pad - L.plate, oy0 = L.pad - L.plate; // P101: 판 사이 틈이 기둥 사이와 같다
  const limit = width - L.pad; // P145: 바깥 사각형 오른쪽 끝 + 둘레(pad)가 칸 폭을 넘지 않게(예전 + plate는 가로 스크롤을 냈다)
  const placed = [];
  // home: 맨 왼쪽 자리(팀 단위는 제 열 자리 그대로, 폴더 밖 판은 폴더 상자 여백만큼 안쪽)
  const spot = (o, folder, home = ox0) => {
    const xs = [...new Set([home, ...placed.map((r) => r.x + r.w + gut)].filter((x) => x <= limit && x >= home).concat(Array.from({ length: Math.max(0, Math.floor((limit - home) / step)) + 1 }, (_, c) => home + c * step)))].sort((p, q) => p - q);
    let best = null;
    for (const x of xs) {
      if (x > home && x + o.w > limit) continue; // 맨 왼쪽 자리가 아니면 지도 칸 안에
      const yy = Math.max(oy0, ...placed.filter((r) => r.x < x + o.w + gut && x < r.x + r.w + gut).map((r) => r.y + r.h + gut));
      if (!best || yy < best.y) best = { x, y: yy };
    }
    return best;
  };
  const moveUnit = (u, o, at) => {
    const dx = at.x - o.x, dy = at.y - o.y;
    for (const g of groups) if (u.keys.includes(g.key)) { g.x = r1(g.x + dx); g.y = r1(g.y + dy); }
    for (const bx of boxes.values()) if (u.keys.includes(bx.group)) { bx.x = r1(bx.x + dx); bx.y = r1(bx.y + dy); }
    placed.push({ x: at.x, y: at.y, w: o.w, h: o.h });
  };
  // 팀이 있는 단위: 차례대로 빈 곳에 놓는다. 좁은 지도에서는 예전처럼 위에서 아래로 쌓이고, 넓은 지도에서는 남는 오른쪽에 나란히 선다
  // (P145. 예전에는 늘 한 기둥으로 쌓아 넓은 창의 오른쪽 아래가 비었다. 팀 안의 열 자리와 부모 → 하위 흐름은 그대로)
  for (const u of flowUnits) { const o = outerOf(u); if (o) moveUnit(u, o, spot(o, u.folder, o.x)); }

  // 팀이 없는 단위(혼자인 워크스페이스, 그런 것만 든 폴더): 팀 단위 다음에 남은 빈 곳에 채운다
  if (packUnits.length) {
    // 단위 하나를 지운다(기둥 수를 바꿔 다시 놓을 때)
    const clear = (u) => {
      for (let i = groups.length - 1; i >= 0; i--) if (u.keys.includes(groups[i].key)) groups.splice(i, 1);
      for (const [id, bx] of [...boxes]) if (u.keys.includes(bx.group)) { boxes.delete(id); const j = seq.indexOf(id); if (j >= 0) seq.splice(j, 1); }
    };
    for (const u of packUnits) {
      // 제자리(0, 0)에 놓아 크기를 잰 뒤 옮긴다. 기둥 수는 하나부터 세 개까지(남은 폭 안에서) 놓아 보고, 아래 끝이 가장 높은 것(같으면 기둥이 적은 것)을 고른다(P145).
      // 오른쪽 좁은 빈 곳에는 길쭉하게, 아래 넓은 곳에는 납작하게 들어간다
      const m = u.folder ? F.m : 0, head = u.folder ? F.head : 0;
      const room = Math.max(1, Math.floor((limit - ox0 - 2 * m - 2 * L.plate + L.slotGap) / step));
      const maxN = Math.max(1, Math.min(spanOf(u.keys), 3, room));
      let pick = null;
      for (let n = 1; n <= maxN; n++) {
        if (n > 1) clear(u);
        packCols(u.keys, m + L.plate, head + L.plate, n);
        const o = outerOf(u);
        if (!o) break;
        const at = spot(o, u.folder, u.folder ? ox0 : ox0 + inset); // 폴더 밖 판은 팀 판과 같은 왼쪽 끝
        if (!pick || at.y + o.h < pick.y + pick.h - 0.5) pick = { n, x: at.x, y: at.y, h: o.h };
      }
      if (!pick) continue;
      if (pick.n !== maxN) { clear(u); packCols(u.keys, m + L.plate, head + L.plate, pick.n); }
      moveUnit(u, outerOf(u), pick);
    }
  }

  // 폴더 상자: 이름, 그 안에 놓인 세션 수(다른 폴더의 하위 세션이 부모 팀 안에 놓였으면 그것도), 응답 필요 수
  for (const u of units) {
    if (!u.folder) continue;
    const o = outerOf(u);
    if (!o) continue;
    const ss = [...boxes.values()].filter((b) => u.keys.includes(b.group) && b.node && b.node.kind === 'session');
    const shutIn = groups.filter((g) => g.collapsed && u.keys.includes(g.key));
    folders.push({ id: u.folder.id, name: u.folder.name, keys: [...u.keys], ...o, count: ss.length + shutIn.reduce((a, g) => a + g.count, 0), needs: ss.filter((b) => ['turn', 'alert'].includes(tierOf(b.node.id))).length + shutIn.reduce((a, g) => a + g.needs, 0), packed: !isTeamUnit(u) });
  }
  const folderOf = new Map();
  for (const f of folders) for (const k of f.keys) folderOf.set(k, f.id);

  // 선. 끝이 대리 상자(접은 워크스페이스)나 동그라미 줄로 바뀐 나무 선은 같은 쌍끼리 다시 모은다
  const endOf = (id, isTree) => proxyOf.get(id) || (isTree && dotGroupOf.get(id)) || (boxes.has(id) ? id : null);
  const shown = new Map();
  for (const p of tree.pairs) {
    const isTree = tree.treeEdge.has(p.id);
    const a = endOf(p.from, false), b = endOf(p.to, isTree);
    if (!a || !b || a === b) continue;
    const rel = relOf(p, tree);
    const cross = wsOf(p.from) !== wsOf(p.to);
    if (a === p.from && b === p.to) { shown.set(p.id, { ...p, rel, tree: isTree, cross, quiet: false }); continue; }
    const k = `${a}>${b}`;
    const q = shown.get(k) || { id: k, from: a, to: b, kinds: [], parts: [], role: null, text: null, count: 0, lastAt: 0, active: false, folded: true, rel, tree: isTree, cross: false, quiet: false, members: [] };
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
    // P134: 두 끝이 서로 다른 폴더 상자에 있으면(한쪽만 폴더여도) 상자를 넘는 선이다. 그리는 쪽(Mission.jsx)이 상자 위로 또렷하게 지나가게 한다
    const outside = (folderOf.get(a.group) || null) !== (folderOf.get(b.group) || null);
    let route = facing(a, b) || 'side';
    if ((route === 'd' || route === 'u') && blocked(a, b, sessBoxes)) route = 'side';
    // 나무 밖 선이 멀리 가면(세로로 quietSpan 넘게) 지도를 가르므로 가리킬 때만 긋는다. 서로 이은 두 줄은 나무 선이 있으면 늘 긋는다
    const far = !p.tree && Math.abs(cy(b) - cy(a)) > L.quietSpan && !(pair && (p.tree || (mate && mate.tree)));
    // 나가는·들어가는 높이: 부모(왼쪽 상자) 오른쪽 가장자리는 받는 쪽으로 살짝 펼친다(대리 상자는 가운데)
    const y1 = route === 'r' && a.kind === 'card' ? portY(a, b) : null;
    const y2 = route === 'l' && b.kind === 'card' ? portY(b, a) : null;
    if (route === 'r' && !pair) { // 앞으로 가는 선(왼쪽 → 오른쪽): P95 그대로 화살촉 없이
      const w = wire(a, b, { y1 });
      return { ...rest, d: w.d, tip: null, route: 'flow', pair: false, back: false, quiet: !!p.quiet || far, outside };
    }
    const w = wire(a, b, { off: pair ? pairOff(a, b, route) : 0, tip: true, route, y1, y2 });
    const kind = pair ? 'pair' : route === 'd' || route === 'u' ? 'near' : route === 'l' ? 'back' : route === 'side' ? 'side' : 'flow';
    return { ...rest, d: w.d, tip: w.tip, route: kind, pair, back: route === 'l' || route === 'u' || route === 'side', quiet: pair ? false : !!p.quiet || far, outside };
  });
  // P101: 워크스페이스 판. 머리 글과 그 아래 놓인 상자(다른 워크스페이스의 하위 세션도 그 팀에 놓였으면 포함)를 plate 여백으로 감싼다
  for (const g of groups) { g.plate = plateOf(g); g.w = r1(g.plate.w - 2 * L.plate); g.folder = folderOf.get(g.key) || null; }
  const bs = [...boxes.values()];
  const right = bs.length ? Math.max(...bs.map((b) => b.x + b.w), ...groups.map((g) => g.plate.x + g.plate.w), ...folders.map((f) => f.x + f.w)) : L.pad;
  const bottom = bs.length ? Math.max(...bs.map((b) => b.y + b.h), ...groups.map((g) => g.plate.y + g.plate.h), ...folders.map((f) => f.y + f.h)) : L.pad;
  const depths = bs.filter((b) => Number.isFinite(b.depth)).map((b) => b.depth);
  const loose = roots.filter((r) => !kidsOf(r.id).length && !touched.has(r.id) && boxes.has(r.id)).map((r) => r.id);
  return { boxes, edges, groups, folders, loose, teamNo, human, order: seq, width: r1(right + L.pad), height: r1(bottom + L.pad), columns: depths.length ? Math.max(...depths) + 1 : 0, tree };
}

// 지도 차례(요약 열이 쓴다): 팀 흐름의 놓은 차례(부모 먼저), 그다음 채운 기둥의 차례
export const mapOrder = (lay) => lay.order.filter((id) => lay.boxes.has(id));

// 선 풀이 글(사전 함수 t): "하위 세션 · 역할: reviewer", 다른 워크스페이스, 마지막 지시, 횟수
export function edgeLabel(e, t) {
  const base = e.role || t(`mission.edge.${e.primary}`);
  return e.count > 1 && e.primary !== 'role' ? `${base} ×${e.count}` : base;
}
