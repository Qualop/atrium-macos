// P94: 미션 맵의 역할·관계 모델. PC 창·PC 웹(Mission.jsx, lib/mission-layout.js)과 휴대폰(PhoneMission.jsx, lib/phone-mission.js)이 같이 쓴다. 순수 함수만 둔다(단위 시험 test/p94-lib.test.mjs).
// - 한 쌍(A → B)의 선 여럿은 하나로 모은다(mergeEdges). 나무 부모는 하위 세션의 부모(parentId) > 역할 > 띄움 > 지시. 같으면 더 얕은 쪽(리드), 그다음 먼저 띄운 쪽. 고리는 만들지 않는다.
// - 등급(rank): lead(하위가 있는 맨 위 세션), sub(하위가 있는 하위 세션), worker(부모가 있는 세션), solo(관계 없음).
// - 역할 이름(roleName)은 부모 쪽 선의 역할(사람이 붙인 이름) 또는 하위 세션의 역할. 이름에서 묶음(family)을 고른다: review, test, docs, worker. 리드는 lead.
// - 관계 종류(rel): spawn(부모 → 하위 세션, 띄움), role(역할 연결), prompt(알아챈 지시), human(사람의 명령 바·루프). 다른 워크스페이스로 간 선은 cross를 단다.
// - 팀 요약(team): 리드·sub 아래 모든 세션 수와 일함·응답 필요·잠듦 수. 리드가 일하지 않는데 팀이 일하면 "워커를 기다림"(waiting), 팀의 응답 필요는 리드에 올라온다(climb).
// - 강조(focusOf): 한 세션을 가리키면 그 세션, 조상, 팀(자손), 바로 이어진 세션과 그 사이 선만 또렷하게.
import { tierOf } from './overview.js';

export const EDGE_ORDER = ['role', 'prompt', 'spawn', 'bar', 'loop'];
export const REL_ORDER = ['spawn', 'role', 'prompt', 'human'];
export const FAMILIES = ['lead', 'review', 'test', 'docs', 'worker'];
const SESSION_KINDS = ['role', 'prompt', 'spawn'];
const PARENT_RANK = { parent: 0, role: 1, spawn: 2, prompt: 3 };
const kindRank = (k) => { const i = EDGE_ORDER.indexOf(k); return i < 0 ? EDGE_ORDER.length : i; };
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || '')) || String(a.id).localeCompare(String(b.id));
export const bySpawn = (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.createdAt || 0) - (b.createdAt || 0) || byName(a, b);

// 한 쌍의 선들을 하나로: { id, from, to, kinds, primary, role, text, count, lastAt, active }
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
  for (const p of pairs.values()) { p.kinds.sort((a, b) => kindRank(a) - kindRank(b)); p.primary = p.kinds[0]; }
  return [...pairs.values()];
}

// 역할 이름 → 묶음. 이름이 없으면 worker
export function roleFamily(name) {
  const s = String(name || '').toLowerCase();
  if (!s) return 'worker';
  if (/review|audit|verif|check|critic|inspect|검토|리뷰|검증|감수/.test(s)) return 'review';
  if (/test|\bqa\b|e2e|spec|lint|시험|테스트/.test(s)) return 'test';
  if (/doc|writer|copy|note|readme|translat|문서|번역|글|기록/.test(s)) return 'docs';
  return 'worker';
}

// 강조 등급(P85 tierOf). live: 판의 세션 요약(없으면 그래프 노드의 상태). 명령이 도는 셸은 일함
export function tierFor(node, live) {
  const s = live || { state: node && node.state, unseen: node && node.category === 'done', kind: node && node.agentKind };
  if (s.kind === 'shell' && s.shell && s.shell.atPrompt === false && s.state !== 'exited' && s.state !== 'sleeping' && s.state !== 'error') return 'work';
  return tierOf(s);
}

// 세션끼리의 나무. graph: mission.graph → { nodes, byId, pairs(세션끼리, 모은 것), parent: Map id → 부모 id, via: Map id → 부모 쪽 쌍, kids: Map id → [하위 노드](띄운 순서), treeEdge: Set(쌍 id) }
export function missionTree(graph) {
  const nodes = ((graph && graph.nodes) || []).filter((n) => n && n.kind === 'session');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pairs = mergeEdges((graph && graph.edges) || [], (id) => byId.has(id)).filter((p) => p.kinds.some((k) => SESSION_KINDS.includes(k)));
  // 하위 세션인데 띄움 선이 없으면(옛 판) 부모 → 하위 쌍을 하나 만든다
  for (const n of nodes) if (n.parentId && byId.has(n.parentId) && !pairs.some((p) => p.from === n.parentId && p.to === n.id)) pairs.push({ id: `${n.parentId}>${n.id}`, from: n.parentId, to: n.id, kinds: ['spawn'], primary: 'spawn', parts: [], role: n.role || null, text: null, count: 0, lastAt: 0, active: false, synthetic: true });
  // 실제 부모(parentId) 사슬의 깊이: 같은 등급의 후보 중 더 얕은 쪽(리드)을 고른다
  const realDepth = (id) => { let d = 0; for (let x = byId.get(id), i = 0; x && x.parentId && byId.has(x.parentId) && i < 100; x = byId.get(x.parentId), i++) d++; return d; };
  const parent = new Map(), via = new Map();
  const ancestorOf = (a, b) => { for (let x = b, i = 0; x && i < 1000; x = parent.get(x), i++) if (x === a) return true; return false; };
  const rankOf = (n, p) => (p.from === n.parentId ? PARENT_RANK.parent : Math.min(...p.kinds.map((k) => PARENT_RANK[k] ?? 9)));
  // P101: 하위 세션의 실제 부모(parentId)를 먼저 정한다. 하위 세션이 부모에게 보고하는 선(B → A)이 있어도 나무가 뒤집히지 않는다
  // (전에는 차례가 order로 섞여 하위 세션이 먼저 띄운 쪽으로 셈되어, 리드가 자기 하위 세션의 하위로 그려졌다)
  for (const n of nodes) {
    if (!n.parentId || !byId.has(n.parentId) || ancestorOf(n.id, n.parentId)) continue;
    const p = pairs.find((x) => x.from === n.parentId && x.to === n.id);
    if (p) { parent.set(n.id, n.parentId); via.set(n.id, p); }
  }
  const byTime = (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || byName(a, b);
  for (const n of [...nodes].sort(byTime).reverse()) { // 나머지는 나중에 띄운 쪽부터 부모를 고른다(고리면 먼저 띄운 쪽이 뿌리)
    if (parent.has(n.id)) continue;
    const cands = pairs.filter((p) => p.to === n.id).sort((a, b) => rankOf(n, a) - rankOf(n, b) || realDepth(a.from) - realDepth(b.from) || bySpawn(byId.get(a.from), byId.get(b.from)));
    for (const p of cands) { if (ancestorOf(n.id, p.from)) continue; parent.set(n.id, p.from); via.set(n.id, p); break; }
  }
  const kids = new Map();
  for (const [c, p] of parent) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(byId.get(c)); }
  for (const list of kids.values()) list.sort(bySpawn);
  return { nodes, byId, pairs, parent, via, kids, treeEdge: new Set([...via.values()].map((p) => p.id)) };
}

// 한 쌍의 관계 종류(모양). human은 사람에게서 오는 선(명령 바, 루프)
export function relOf(pair, tree) {
  const k = pair.kinds || [pair.kind];
  if (k.includes('spawn') || (tree && tree.byId.has(pair.to) && tree.byId.get(pair.to).parentId === pair.from)) return 'spawn';
  if (k.includes('role')) return 'role';
  if (k.includes('prompt')) return 'prompt';
  return 'human';
}

const descendants = (tree, id) => { const out = []; const walk = (x, i) => { if (i > 1000) return; for (const c of tree.kids.get(x) || []) { out.push(c.id); walk(c.id, i + 1); } }; walk(id, 0); return out; };
export const ancestors = (tree, id) => { const out = []; for (let x = tree.parent.get(id), i = 0; x && i < 1000; x = tree.parent.get(x), i++) out.push(x); return out; };
// 팀의 맨 위(리드). 관계가 없으면 자기
export const leadOf = (tree, id) => { const a = ancestors(tree, id); return a.length ? a[a.length - 1] : id; };

// 세션마다 역할 모델. opt.live: Map(sessionId → 판의 세션 요약), opt.tiers: Map(id → 등급)(주면 그것을 쓴다)
// → Map id → { rank, family, roleName, depth, lead(팀의 맨 위 id), parentId, team: { size, work, turn, sleep } | null, waiting(일하는 팀원 수, 자기가 일하지 않을 때), climb(팀의 응답 필요 수) }
export function roleModel(graph, { live = null, tiers = null, tree = null } = {}) {
  const T = tree || missionTree(graph);
  const tierOfId = (id) => { if (tiers && tiers.has(id)) return tiers.get(id); const n = T.byId.get(id); return tierFor(n, live && n.sessionId ? live.get(n.sessionId) : null); };
  const touched = new Set();
  for (const p of T.pairs) { touched.add(p.from); touched.add(p.to); }
  const out = new Map();
  for (const n of T.nodes) {
    const hasKids = (T.kids.get(n.id) || []).length > 0, hasParent = T.parent.has(n.id);
    const rank = hasKids ? (hasParent ? 'sub' : 'lead') : hasParent ? 'worker' : touched.has(n.id) ? 'worker' : 'solo';
    const via = T.via.get(n.id);
    const roleName = (via && via.role) || n.role || null;
    const family = rank === 'lead' ? 'lead' : roleFamily(roleName);
    let team = null, waiting = 0, climb = 0;
    if (hasKids) {
      const ds = descendants(T, n.id), ts = ds.map(tierOfId);
      team = { size: ds.length, work: ts.filter((t) => t === 'work').length, turn: ts.filter((t) => t === 'turn' || t === 'alert').length, sleep: ts.filter((t) => t === 'sleep').length };
      const mine = tierOfId(n.id);
      if (mine !== 'work' && team.work) waiting = team.work;
      climb = team.turn;
    }
    out.set(n.id, { rank, family, roleName, depth: ancestors(T, n.id).length, lead: leadOf(T, n.id), parentId: T.parent.get(n.id) || null, team, waiting, climb });
  }
  return out;
}

// 가리킨(고른) 세션의 강조 대상: { nodes: Set(그 세션, 조상, 팀, 바로 이어진 세션), pairs: Set(쌍 id: 둘 다 대상인 나무 선 + 그 세션에 닿는 선), lead }
export function focusOf(tree, id, extraPairs = []) {
  if (!id || !tree.byId.has(id)) return null;
  const line = new Set([id, ...ancestors(tree, id), ...descendants(tree, id)]); // 조상 사슬과 팀
  const nodes = new Set(line);
  const all = [...tree.pairs, ...extraPairs];
  const pairs = new Set();
  for (const p of all) {
    if (p.from === id || p.to === id) { pairs.add(p.id); nodes.add(p.from); nodes.add(p.to); } // 바로 이어진 세션
    else if (tree.parent.get(p.to) === p.from && line.has(p.to)) pairs.add(p.id); // 사슬과 팀 안의 나무 선
  }
  return { nodes, pairs, lead: leadOf(tree, id) };
}

// 무리 차례: 워크스페이스 차례(order)를 가상 그룹(P44)끼리 붙여 다시 늘어놓는다. 그룹은 처음 나온 자리에 모인다.
// vgroups: [{ id, name, members: [키] }] → { order: [키], groupOf: Map 키 → { id, name } }
export function groupedOrder(order = [], vgroups = []) {
  const groupOf = new Map();
  for (const g of vgroups || []) for (const k of g.members || []) if (!groupOf.has(k)) groupOf.set(k, { id: g.id, name: g.name });
  const out = [], seen = new Set();
  const keys = [...(order || [])];
  for (const g of vgroups || []) for (const k of g.members || []) if (!keys.includes(k)) keys.push(k);
  for (const k of keys) {
    if (seen.has(k)) continue;
    const g = groupOf.get(k);
    if (!g) { out.push(k); seen.add(k); continue; }
    for (const m of keys) if (!seen.has(m) && groupOf.get(m) && groupOf.get(m).id === g.id) { out.push(m); seen.add(m); }
  }
  return { order: out, groupOf };
}

// 팀 요약 글(사전 함수 t): "워커 5 · 일함 2 · 응답 필요 1"
export function teamText(m, t) {
  if (!m || !m.team) return '';
  const parts = [t('mmRole.team', { n: m.team.size })];
  if (m.team.work) parts.push(t('mmRole.teamWork', { n: m.team.work }));
  if (m.team.turn) parts.push(t('mmRole.teamTurn', { n: m.team.turn }));
  return parts.join(' · ');
}
// 역할 칩 글: 리드는 "리드", 하위가 있는 하위 세션은 "역할 · 하위 리드"(short면 역할만, 휴대폰), 그 밖은 역할 이름(없으면 "하위 세션"·"연결 없음")
export function roleText(m, t, { short = false } = {}) {
  if (!m) return '';
  if (m.rank === 'lead') return t('mmRole.lead');
  if (m.rank === 'solo') return t('mmRole.solo');
  const name = m.roleName || t('mmRole.worker');
  return m.rank === 'sub' && !short ? `${name} · ${t('mmRole.subLead')}` : name;
}

// ---- P95: 카드와 한 줄, 거르기, 요약 열(PC·휴대폰 같이) ----
// 상태가 없는 노드(시험 자료, 옛 판)는 분류(category)로 등급을 고른다
const CAT_TIER = { working: 'work', needs_you: 'turn', done: 'review', exited: 'done', idle: 'rest' };
export const nodeTier = (n, live = null) => (live || (n && n.state) ? tierFor(n, live) : CAT_TIER[n && n.category] || 'rest');
// 쉼·잠듦·끝남은 한 줄로 물러난다(하위가 있으면 카드)
export const REST_TIERS = ['rest', 'sleep', 'done'];
export const restTier = (t) => REST_TIERS.includes(t);
// 위 거르기 칸(P32의 분류 열쇠 그대로)과 등급: 맞지 않는 세션은 자리는 그대로 두고 흐리게
export const FILTERS = ['all', 'needs_you', 'working', 'idle', 'done', 'exited'];
export function filterMatch(tier, filter) {
  switch (filter) {
    case 'needs_you': return tier === 'turn' || tier === 'alert';
    case 'working': return tier === 'work';
    case 'idle': return tier === 'rest';
    case 'done': return tier === 'review';
    case 'exited': return tier === 'done' || tier === 'sleep';
    default: return true;
  }
}
// 모델과 노력 수준 한 낱말: "claude-opus-5-5" + "high" → "opus 5.5·high"
export function modelText(model, effort) {
  let m = String(model || '').trim().replace(/^claude-/, '').replace(/\[.*\]$/, '');
  m = m.replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1');
  return [m, effort].filter(Boolean).join('·') || null;
}
// 지난 시간 짧게(사전 함수 t): 방금, 4분, 2시간, 3일
export function ageText(ms, t) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const m = Math.floor(ms / 60000);
  if (m < 1) return t('mmMap.ageNow');
  if (m < 60) return t('mmMap.ageM', { n: m });
  const h = Math.floor(m / 60);
  if (h < 48) return t('mmMap.ageH', { n: h });
  return t('mmMap.ageD', { n: Math.floor(h / 24) });
}
// 요약 열: ids(지도 차례)를 등급으로 나눈다 → { turn, work, review, rest, counts: { all, turn, work, review, rest, idle, gone } }
export function missionSummary(ids, tierOfId) {
  const out = { turn: [], work: [], review: [], rest: [] };
  for (const id of ids) {
    const t = tierOfId(id);
    if (t === 'turn' || t === 'alert') out.turn.push(id);
    else if (t === 'work') out.work.push(id);
    else if (t === 'review') out.review.push(id);
    else out.rest.push(id);
  }
  const gone = out.rest.filter((id) => tierOfId(id) !== 'rest').length;
  out.counts = { all: ids.length, turn: out.turn.length, work: out.work.length, review: out.review.length, rest: out.rest.length, idle: out.rest.length - gone, gone };
  return out;
}
