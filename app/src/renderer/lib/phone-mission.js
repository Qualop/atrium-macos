// P87: 휴대폰 미션 맵(PhoneMission.jsx)의 배치. 순수 함수만 둔다(단위 시험 app/test/p87-lib.test.mjs).
// - 자료는 mission.graph(이름, 역할, 상태, 부모·하위, 연결)만 쓴다. 대화(session.messages)와 터미널은 받지 않는다.
// - 세로 휴대폰에 맞게 워크스페이스 무리(접기)마다 위 → 아래 나무로 쌓는다. 하위 세션은 부모 아래 들여 놓고, 줄마다 나무 선(guides)과 역할 이름표.
// - 나무 부모: 하위 세션의 부모(parentId) > 역할 > 띄움 > 지시. 고리가 생기는 부모는 고르지 않는다. 다른 무리의 부모는 그 무리에서 뿌리가 되고 "← @부모"를 단다(cross).
// - 나무에 들지 못한 세션 사이 연결(두 번째 지시자 등)은 보내는 줄에 "→ @받는 쪽 · 역할"로 단다.
// - 강조 등급은 P85(lib/overview.js tierOf): 일함(work)은 눈에 띄게, 내 차례(turn)·오류(alert)는 따로, 쉼·잠듦·끝남은 물러나게.
//   판의 세션 요약(live, 이미 받은 것)이 있으면 그 상태를 쓴다(mission.graph를 다시 받기 전에도 상태가 맞다).
// - 순서는 띄운 순서(order, createdAt, 이름)로 고정한다. 상태가 바뀌어도 줄이 자리를 옮기지 않는다(돌아오면 자리가 그대로).
// - P94: 나무와 역할·관계 분류는 PC와 같은 공용 모델(lib/mission-model.js)이다. 줄마다 rank·family·roleName·team·waiting·climb·rel을 단다. 무리는 가상 그룹(P44)끼리 붙이고 이름(vg)을 단다.
import { missionTree, roleModel, relOf, tierFor, groupedOrder, bySpawn } from './mission-model.js';

export const PM_INDENT_MAX = 4; // 이보다 깊으면 들여쓰기를 멈추고 깊이 숫자를 단다(390px 폭에 카드가 남게)
export const PM_FOLD_KEY = 'mt.phoneMissionFolded';

// 줄 하나의 강조 등급. live: 판의 세션 요약(없으면 그래프 노드의 상태)
export const phoneTier = tierFor;
// 무리 머리줄과 위쪽 요약에 세는 것
const pick = (m) => (m ? { rank: m.rank, family: m.family, roleName: m.roleName, team: m.team, waiting: m.waiting, climb: m.climb } : { rank: 'solo', family: 'worker', roleName: null, team: null, waiting: 0, climb: 0 });
const tally = (rows) => ({ count: rows.length, work: rows.filter((r) => r.tier === 'work').length, turn: rows.filter((r) => r.tier === 'turn' || r.tier === 'alert').length });

// graph: mission.graph 결과. live: Map(sessionId → 판의 세션 요약), order: 무리 차례(워크스페이스 키들), folded: 접은 무리 키들(키가 없는 무리는 '-')
// → { groups: [{ key, folded, count, work, turn, rows }], counts: { all, work, turn } }
//   row: { id, sessionId, name, agentKind, state, tier, depth, indent, last, guides, fromId, role, from, links, ask, active, loops }
export function phoneMission(graph, { live = null, order: order0 = [], folded = [], vgroups = [] } = {}) {
  const tree = missionTree(graph);
  const { nodes, byId, pairs, parent, via, treeEdge } = tree;
  const { order, groupOf: vgOf } = groupedOrder(order0, vgroups);
  const groupOf = (n) => n.workspaceKey || null;
  const kids = new Map();
  for (const [c, p] of parent) if (groupOf(byId.get(c)) === groupOf(byId.get(p))) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(byId.get(c)); }
  for (const list of kids.values()) list.sort(bySpawn);
  const tiers = new Map(nodes.map((n) => [n.id, phoneTier(n, live && n.sessionId ? live.get(n.sessionId) : null)]));
  const roles = roleModel(graph, { tree, tiers });

  const rowOf = (n, depth, last, guides) => {
    const l = live && n.sessionId ? live.get(n.sessionId) : null;
    const p = via.get(n.id);
    const pn = p ? byId.get(p.from) : null;
    const cross = !!pn && groupOf(pn) !== groupOf(n);
    return {
      id: n.id, sessionId: n.sessionId, name: (l && l.name) || n.name, agentKind: n.agentKind || (l && l.kind) || 'unknown', state: (l && l.state) || n.state, tier: tiers.get(n.id),
      depth, indent: Math.min(depth, PM_INDENT_MAX), last, guides: guides.slice(0, PM_INDENT_MAX),
      fromId: cross ? pn.id : null, // P89: 그래프(lib/phone-graph.js)의 다른 무리 부모 선
      role: (p && p.role) || n.role || null, active: !!(p && p.active),
      from: cross ? { name: pn.name, key: groupOf(pn) } : null, // 다른 무리의 부모
      links: pairs.filter((x) => x.from === n.id && !treeEdge.has(x.id)).sort((a, b) => bySpawn(byId.get(a.to), byId.get(b.to))).map((x) => ({ to: byId.get(x.to).name, toId: x.to, role: x.role || null, kind: x.primary, rel: relOf(x, tree), active: !!x.active })),
      ask: n.ask || null, loops: n.loops || 0,
      // P95: 카드의 메타 줄(모델·노력 수준, 일한 시간 또는 마지막 활동, 워크트리 브랜치)과 지금 하는 일
      model: n.model || (l && l.model) || null, effort: n.effort || (l && l.effort) || null, turnAt: n.turnAt || (l && l.state === 'working' && l.turn && l.turn.startedAt) || null,
      activeAt: n.activeAt || (l && l.lastActivityAt) || null, gitBranch: n.gitBranch || null, lastPrompt: n.lastPrompt || (l && l.lastPrompt) || null, workspaceKey: n.workspaceKey || null,
      ...pick(roles.get(n.id)), rel: p ? relOf(p, tree) : null, // P94
    };
  };
  // 무리마다 뿌리(무리 안에 나무 부모가 없는 세션)부터 깊이 우선
  const groups = new Map();
  for (const n of nodes) { const k = groupOf(n); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
  const rank = new Map((order || []).map((k, i) => [k, i]));
  const shut = new Set((folded || []).map((k) => k || '-'));
  const out = [...groups.entries()].sort(([a], [b]) => (a == null) - (b == null) || (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9) || String(a).localeCompare(String(b))).map(([key, list]) => {
    const roots = list.filter((n) => { const p = parent.get(n.id); return !p || groupOf(byId.get(p)) !== key; }).sort(bySpawn);
    const rows = [];
    const seen = new Set();
    const walk = (n, depth, last, guides) => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      rows.push(rowOf(n, depth, last, guides));
      const ch = kids.get(n.id) || [];
      ch.forEach((c, i) => walk(c, depth + 1, i === ch.length - 1, depth > 0 ? [...guides, !last] : guides));
    };
    roots.forEach((r) => walk(r, 0, true, []));
    for (const n of list.sort(bySpawn)) if (!seen.has(n.id)) walk(n, 0, true, []); // 고리 안에만 있는 세션(나무 밖)도 빠뜨리지 않는다
    const off = shut.has(key || '-');
    return { key, folded: off, vg: vgOf.get(key) || null, ...tally(rows), rows: off ? [] : rows, all: rows };
  });
  const every = out.flatMap((g) => g.all);
  for (const g of out) delete g.all;
  const c = tally(every);
  return { groups: out, counts: { all: c.count, work: c.work, turn: c.turn } };
}
