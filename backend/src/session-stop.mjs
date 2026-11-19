// macOS 판: 하던 턴 멈추기(session.stop). 세션 노드의 중지 단추와 계정 옮기기(accounts.switch stop)가 쓴다.
// 에이전트는 Esc 한 번으로 턴만 끊는다(대화는 남는다). 셸은 Ctrl+C. 쉬는 세션에는 키를 보내지 않는다(쉬는 Claude Code에 Esc 두 번은 되감기 메뉴를 연다).
// 일 부모 아래의 하위 세션(atrium child)도 함께 멈춘다. 부모부터 위에서 아래로: 하위를 먼저 끊으면 부모의 atrium wait가 끊긴 결과를 받고 턴을 이어 간다.
// "독립으로 두기"(P159)로 뗀 세션은 일 부모가 없어 멈추지 않는다.
import { deriveState, markTurnInterrupted } from './state.mjs';
import { descendantsOf } from './branch.mjs';

// 뜨는 중(starting)은 넣지 않는다: 신뢰 질문에 Esc는 "거절"이다
const BUSY = new Set(['working', 'shell_running']);
export const STOP_WAIT_MS = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 멈출 세션(위에서 아래로). sessions: Session[], workParentOf(id) → 부모 ID | null, stateOf(s) → 상태
export function stopTargets(root, sessions, { workParentOf, stateOf, tree = true }) {
  const rows = sessions.map((x) => ({ sessionId: x.sessionId, parentSessionId: workParentOf(x.sessionId) || null }));
  const byId = new Map(sessions.map((x) => [x.sessionId, x]));
  const below = tree ? descendantsOf(root.sessionId, rows).sort((a, b) => a.rel - b.rel).map((r) => byId.get(r.sessionId)).filter(Boolean) : [];
  return [root, ...below].filter((x) => BUSY.has(stateOf(x)));
}

export const stopKeys = (s) => ((s.kind || 'claude') === 'shell' ? ['ctrl+c'] : ['esc']);

export async function stopTree(b, s, { tree = true } = {}) {
  const stateOf = (x) => deriveState(x.rt).state;
  const targets = stopTargets(s, [...b.sessions.values()], { workParentOf: (id) => b.workParentOf(id), stateOf, tree });
  const stopped = [], failed = [];
  // 멈춘 하위 세션에 대기 중인 글(부모가 보낸 다음 일)은 거둔다. 남기면 멈추자마자 그 글로 다시 일한다. 누른 세션의 대기열(사람의 글일 수 있다)은 둔다
  let dropped = 0;
  if (tree && b.queue && b.queue.items) {
    const below = new Set(stopTargets(s, [...b.sessions.values()], { workParentOf: (id) => b.workParentOf(id), stateOf: () => 'working', tree }).filter((x) => x !== s).map((x) => x.sessionId));
    for (const d of [...b.queue.items.values()]) if (below.has(d.sessionId) && d.status === 'queued') { try { b.queue.cancel(d.deliveryId); dropped++; } catch {} }
  }
  for (const x of targets) {
    if (!x.paneId || !x.rt.term?.present) { failed.push({ name: x.name, why: 'no_terminal' }); continue; }
    try {
      await b.adapter.paneKeys(x.paneId, stopKeys(x));
      markTurnInterrupted(x.rt); // 부모의 atrium wait가 옛 답을 결과로 받지 않게
      stopped.push(x.name);
      b.store.addEvent(x.sessionId, 'stopped', { by: x === s ? 'hand' : 'parent', root: s.name });
    } catch (e) { failed.push({ name: x.name, why: e.code || 'error' }); }
  }
  if (stopped.length || dropped) b.log(`stop ${s.name}: ${stopped.join(', ')}${dropped ? ` (queued dropped ${dropped})` : ''}`);
  return { stopped, failed, dropped, sessions: targets };
}

// 멈춘 세션들이 쉬는 상태가 될 때까지 기다린다(계정 옮기기 앞). 다 쉬면 true
export async function waitIdle(list, { timeoutMs = STOP_WAIT_MS, stepMs = 300 } = {}) {
  for (const t = Date.now(); Date.now() - t < timeoutMs; await sleep(stepMs)) {
    if (!list.some((x) => BUSY.has(deriveState(x.rt).state))) return true;
  }
  return false;
}
