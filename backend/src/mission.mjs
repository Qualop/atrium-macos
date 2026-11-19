// I6 미션 맵(P6b, ARCH 4절 I6): 판 데이터에서 "누가 누구에게 지시하는지" 그래프를 만든다. 순수 함수만 둔다(창도 같이 쓸 수 있다).
// 두 열: 0 = 사람(명령 바)과 다른 세션에게 지시를 내리는 세션, 1 = 세션. P22에서 그룹 열을 뺐다.
// 선: role(판에서 정한 역할), prompt(알아챈 지시), spawn(띄움), bar(명령 바 전달, Thread), loop(루프).

import { relationIndex } from './relations.mjs';

export const HUMAN_ID = 'human';
const sid = (id) => `s:${id}`;
const clip = (s, n) => { if (typeof s !== 'string') return s ?? null; const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

// 미션 맵의 거르기(참고 제품: All, Working, Needs you(오류 포함), Idle, Done). Done은 끝났지만 아직 안 본 것(검토 대기)
export function categoryOf(s) {
  if (s.state === 'waiting' || s.state === 'trust_wait' || s.state === 'error') return 'needs_you';
  if (s.state === 'working' || s.state === 'shell_running') return 'working';
  if (s.state === 'exited') return 'exited';
  if (s.unseen) return 'done';
  return 'idle';
}

// P157: 세션 맵의 솔로 판정에 보는 "하위를 불렀던" 기록의 기간. 이보다 옛날에 닫힌 하위, 옛날에 보낸 지시(assign)는 보지 않는다
export const CALLED_MS = 7 * 24 * 3600 * 1000;

// sessions: 세션 요약들, links: 열린 연결(link.list), thread: Thread 줄들(thread.list의 items, results 포함), loops: 루프들
// relations(P156): 저장한 일 관계 줄들(store.relationRows). 선마다 실제 관계(relation, relationSource, relationUp), 세션마다 계보 부모(lineageParent)와 일 부모(parentId)
// called(P157): { kids: 계보 기록(store.branchRows, 닫힌 세션 포함), assigns: 하위에게 지시를 보낸 세션(store.assignSenders) }.
//   세션마다 closedKids(CALLED_MS 안에 닫힌 계보 자식 수)와 assignAt(CALLED_MS 안의 마지막 assign 지시 시각)을 붙인다(세션 맵이 솔로 칸에 보내지 않는다)
export function missionGraph({ sessions = [], links = [], thread = [], loops = [], relations = [], called = null, now = Date.now() }) {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  // P159: 요약의 parentSessionId는 일 부모라 계보는 lineageParentSessionId(옛 요약·시험 자료는 parentSessionId)
  const lineageOf = (id) => { const s = byId.get(id); if (!s) return null; if (s.lineageParentSessionId !== undefined) return s.lineageParentSessionId || null; return s.parentSessionId || (s.branch && s.branch.parentSessionId) || null; };
  const rel = relationIndex({ rows: relations, lineageOf, links });
  const relOf = (from, to) => { const r = rel.ofEdge(from, to); return { relation: r.relation, relationSource: r.source, relationUp: r.up ? sid(r.up) : null }; };
  const edges = [];
  const add = (e) => { e.id = `${e.kind}:${e.from}>${e.to}${e.linkId ? ':' + e.linkId : ''}${e.loopId ? ':' + e.loopId : ''}`; edges.push(e); };

  // 세션끼리(P4 연결): 역할, 알아챈 지시, 띄움을 따로 긋는다. P156: 선마다 두 세션의 일 관계를 붙인다
  const drawn = new Set();
  for (const l of links) {
    if (!byId.has(l.from) || !byId.has(l.to)) continue;
    const base = { from: sid(l.from), to: sid(l.to), linkId: l.linkId, count: l.count || 0, lastAt: l.lastAt || null, ...relOf(l.from, l.to) };
    const active = l.lastKind === 'prompt' || l.lastKind === 'target_working' || l.lastKind === 'target_submitted';
    if (l.role) add({ ...base, kind: 'role', label: base.relation === 'sub' ? l.role : null, active }); // P159: 동료·독립 쌍에는 역할 이름(워커 등)을 붙이지 않는다
    if (l.observed) add({ ...base, kind: 'prompt', label: clip(l.lastText, 80), active });
    if (l.spawned) add({ ...base, kind: 'spawn', label: "세션 생성", active: false });
    if (l.role || l.observed || l.spawned) drawn.add([l.from, l.to].sort().join('|'));
  }
  // P156: 명시한 관계만 있고 역할·지시·띄움 선이 없는 쌍(사람이 세션 맵에서 이은 동료 등)은 관계 선 하나(하위면 위 → 아래)
  for (const r of relations) {
    if (!r || !byId.has(r.a) || !byId.has(r.b) || drawn.has([r.a, r.b].sort().join('|'))) continue;
    const cur = rel.between(r.a, r.b);
    if (!cur || cur.a !== r.a || cur.b !== r.b) continue; // 같은 쌍의 늦은 줄만
    drawn.add([r.a, r.b].sort().join('|'));
    add({ from: sid(r.a), to: sid(r.b), kind: 'relation', label: null, count: 0, lastAt: r.at || null, active: false, relation: cur.relation, relationSource: cur.source, relationUp: cur.up ? sid(cur.up) : null });
  }

  // 명령 바 전달(Thread): 사람 → 세션. 같은 대상은 한 선으로 모아 횟수와 마지막 글을 붙인다
  const bar = new Map();
  for (const it of thread) {
    if (it.source === 'loop') continue;
    for (const r of it.results || []) {
      const to = sid(r.sessionId);
      if (!byId.has(r.sessionId)) continue;
      const e = bar.get(to) || { from: HUMAN_ID, to, kind: 'bar', count: 0, items: new Set(), lastAt: 0, label: null, active: false };
      if (!e.items.has(it.itemId)) { e.items.add(it.itemId); e.count++; }
      if (it.t >= e.lastAt) { e.lastAt = it.t; e.label = clip(it.text, 80); }
      if (r.phase === 'delivering' || r.phase === 'running') e.active = true;
      bar.set(to, e);
    }
  }
  for (const e of bar.values()) { delete e.items; add(e); }

  // 루프: 사람이 걸어 둔 반복 지시
  for (const l of loops) {
    if (l.target.kind !== 'session' || !byId.has(l.target.id)) continue;
    const to = sid(l.target.id);
    add({ from: HUMAN_ID, to, kind: 'loop', loopId: l.loopId, label: clip(l.prompt, 80), count: l.runs || 0, lastAt: l.lastRunAt || null, active: l.status === 'active', status: l.status });
  }

  // 지시를 내리는 세션은 사람과 같은 열(0)에 둔다
  const directs = new Map();
  for (const e of edges) if ((e.kind === 'role' || e.kind === 'prompt' || e.kind === 'spawn') && e.from.startsWith('s:')) directs.set(e.from, (directs.get(e.from) || 0) + 1);

  // P157: 하위를 불렀던 기록(닫힌 하위·최근 assign 지시)
  const since = now - CALLED_MS;
  const closedKids = new Map(), assignAt = new Map();
  for (const r of (called && called.kids) || []) {
    if (!r || !r.parentSessionId || byId.has(r.sessionId) || !r.closedAt || r.closedAt < since) continue;
    closedKids.set(r.parentSessionId, (closedKids.get(r.parentSessionId) || 0) + 1);
  }
  for (const a of (called && called.assigns) || []) if (a && a.sessionId && a.at >= since && (assignAt.get(a.sessionId) || 0) < a.at) assignAt.set(a.sessionId, a.at);

  const counts = { all: 0, working: 0, needs_you: 0, idle: 0, done: 0, exited: 0 };
  const nodes = [{ id: HUMAN_ID, kind: 'human', name: "사용자 (명령 입력줄)", column: 0 }];
  for (const s of sessions) {
    const cat = categoryOf(s);
    counts.all++; counts[cat]++;
    const id = sid(s.sessionId);
    nodes.push({
      id, kind: 'session', sessionId: s.sessionId, name: s.name, agentKind: s.kind || 'claude', state: s.state, category: cat, workspaceKey: s.workspaceKey || null,
      column: directs.has(id) ? 0 : 1, directs: directs.get(id) || 0, ask: s.ask ? clip(s.ask.summary || (s.ask.questions && s.ask.questions[0] && s.ask.questions[0].question) || s.ask.kind, 120) : null,
      since: s.waitingSince || (s.ask && s.ask.since) || s.lastActivityAt || null, lastPrompt: clip(s.lastPrompt, 120), loops: s.loops || 0,
      // P8(K4): 나무(부모 아래에 들여 보인다). 판에 올린 에이전트도 부모가 있으면 같이 따른다
      // P156: parentId는 일 부모(하위 관계로 둔 세션. 동료·독립으로 바꾼 계보 부모는 아니다), lineageParent는 계보 부모(띄운 세션, 사실)
      parentId: (() => { const p = rel.workParentOf(s.sessionId); return p && byId.has(p) ? sid(p) : null; })(),
      lineageParent: lineageOf(s.sessionId) && byId.has(lineageOf(s.sessionId)) ? sid(lineageOf(s.sessionId)) : null,
      peers: rel.peersOf(s.sessionId).filter((p) => byId.has(p.id)).map((p) => sid(p.id)), depth: (s.branch && s.branch.depth) || 1, role: (s.branch && s.branch.child && s.branch.role) || null,
      order: (s.branch && s.branch.child && s.branch.order) || null, createdAt: s.createdAt || null, // P75: 형제는 띄운 순서로
      // P95: 카드의 옅은 메타 줄(모델·노력 수준, 일한 시간 또는 마지막 활동, 워크트리 브랜치)
      model: s.model || null, effort: s.effort || null,
      turnAt: s.state === 'working' && s.turn && s.turn.startedAt ? s.turn.startedAt : null, activeAt: s.lastActivityAt || null,
      gitBranch: (s.git && s.git.isWorktree && s.git.branch) || null,
      // P152: 오류 글(영토 지도 카드의 오류 줄, 휴대폰 시트). 판의 세션 요약이 없을 때도 보이게
      closedKids: closedKids.get(s.sessionId) || 0, assignAt: assignAt.get(s.sessionId) || null, parentClosed: !!lineageOf(s.sessionId) && !byId.has(lineageOf(s.sessionId)), // P157
      background: s.background && s.background.n ? { n: s.background.n, kinds: s.background.kinds || [], items: (s.background.items || []).slice(0, 8), at: s.background.at || null } : null, // P164: 도는 뒤 일(쉬는 세션 카드의 표시)
      error: s.state === 'error' && s.error ? clip(typeof s.error === 'string' ? s.error : s.error.message || String(s.error), 200) : null,
    });
  }
  return { nodes, edges, counts, at: now };
}
