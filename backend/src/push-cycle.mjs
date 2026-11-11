// P92: 웹 푸시의 "작업 사이클 끝" 판단(순수 함수). Pusher(web-push.mjs)가 쓴다. 시험 p92.test.mjs.
// - 끝남(done)은 세션의 턴이 끝날 때마다 보내지 않고, 그 세션과 자손(하위 세션의 나무 전체)이 모두 쉬고 SETTLE_MS 동안 그대로일 때 한 번 보낸다.
// - 조건(모두): 그 세션이 ready다. 자손에 working·starting·waiting·trust_wait가 없다(셸은 보지 않는다).
//   그 세션과 자손에게 갈 판 전달(B1)과 켜진 루프(I5)가 없다. 뒤에서 도는 Claude Code 일(뒤 셸, 뒤 하위 에이전트)이 없다.
// - 뒤 일의 신호(실험, P92 작업 기록): Claude Code의 Stop·SubagentStop hook 본문에 background_tasks가 온다
//   ([{ id, type: 'shell'|'subagent', status: 'running', ... }]). 뒤 일이 끝나면 Claude Code가 <task-notification> 글로 새 턴을 시작하고
//   그 턴의 Stop에 줄어든 목록이 온다. hook이 없는 세션(다른 종류)과 그 필드가 없는 옛 Claude Code는 모른다(null, 막지 않는다).
// - 뒤 일만 남은 채 BG_CAP_MS 동안 아무것도 바뀌지 않으면(뒤에서 서버를 띄워 둔 경우 등) 끝난 것으로 보고 보낸다.

export const SETTLE_MS = 60_000;
export const BG_CAP_MS = 10 * 60_000;
export const SUB_MODES = ['need', 'all', 'off']; // 하위 세션(워커) 알림: 응답 필요만(기본) | 모두 | 끔
export const DEFAULT_SUB = 'need';
export const BUSY = new Set(['working', 'starting']);
const OPEN = new Set(['working', 'starting', 'waiting', 'trust_wait']);
const BG_MAX = 20;

// hook 본문 → 도는 뒤 일 [{ id, type }] | null(필드 없음). 설명·명령 글은 남기지 않는다
export function bgTasksOf(body) {
  const list = body && body.background_tasks;
  if (!Array.isArray(list)) return null;
  return list.filter((x) => x && typeof x === 'object' && (x.status == null || x.status === 'running' || x.status === 'pending'))
    .slice(0, BG_MAX).map((x) => ({ id: String(x.id || '').slice(0, 40), type: String(x.type || '').slice(0, 20) }));
}

// nodes: [{ sessionId, parentSessionId, state, kind, delivering, loops, bg }] → 나무 찾기
export function treeIndex(nodes) {
  const byId = new Map(); for (const n of nodes || []) if (n && n.sessionId) byId.set(n.sessionId, n);
  const kids = new Map();
  for (const n of byId.values()) {
    const p = n.parentSessionId;
    if (p && byId.has(p) && p !== n.sessionId) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(n.sessionId); }
  }
  // 부모가 판에 열려 있으면 하위 세션이다. 부모가 닫혔거나 없으면(부모 없는 워크트리 세션 포함) 맨 위 세션이다
  const parentOf = (id) => { const n = byId.get(id); return n && n.parentSessionId && byId.has(n.parentSessionId) && n.parentSessionId !== id ? n.parentSessionId : null; };
  const chain = (id) => { const out = []; const seen = new Set(); let cur = id; while (cur && !seen.has(cur) && byId.has(cur)) { out.push(cur); seen.add(cur); cur = parentOf(cur); } return out; };
  const descendants = (id) => { const out = []; const seen = new Set([id]); const stack = [...(kids.get(id) || [])]; while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); out.push(byId.get(x)); stack.push(...(kids.get(x) || [])); } return out; };
  return { byId, parentOf, chain, descendants, isSub: (id) => !!parentOf(id) };
}

// 사이클이 끝났는가. → { ok: true, subs } | { ok: false, why, retry }
// retry: 상태가 바뀌지 않아도 풀릴 수 있는 까닭(전달·루프·뒤 일)이라 SETTLE_MS마다 다시 본다. 나머지는 상태가 바뀔 때 다시 본다
export function cycleCheck(id, tree) {
  const n = tree.byId.get(id);
  if (!n) return { ok: false, why: 'gone', retry: false };
  if (n.state !== 'ready') return { ok: false, why: BUSY.has(n.state) ? 'busy-again' : 'not-ready', retry: false };
  const desc = tree.descendants(id).filter((d) => d.kind !== 'shell');
  if (desc.some((d) => OPEN.has(d.state))) return { ok: false, why: 'cycle-open', retry: false };
  const all = [n, ...desc];
  if (all.some((x) => Number(x.delivering) > 0)) return { ok: false, why: 'delivery-pending', retry: true };
  if (all.some((x) => Number(x.loops) > 0)) return { ok: false, why: 'loop-active', retry: true };
  if (all.some((x) => Array.isArray(x.bg) ? x.bg.length > 0 : Number(x.bg) > 0)) return { ok: false, why: 'background-task', retry: true };
  return { ok: true, subs: desc.length };
}

export const subModeOf = (v) => (SUB_MODES.includes(v) ? v : DEFAULT_SUB);
// 하위 세션의 알림을 이 기기에 보낼지. kind: done | need | error | exit
// 응답 필요만(기본): need와 error·exit(워커가 멈춰 사람이 봐야 한다)는 보내고 done은 보내지 않는다. 끔: 아무것도
export function subAllows(mode, kind) {
  const m = subModeOf(mode);
  if (m === 'off') return false;
  if (m === 'all') return true;
  return kind !== 'done';
}
