// P44: 워크스페이스를 판에서 지우기(빼기)의 판단. 순수 함수만 둔다(단위 시험 backend/test/p44.test.mjs).
// 디스크의 폴더와 대화 기록 파일은 건드리지 않는다. 안에 세션이 있으면 한 번 더 묻고 "모두 보관"(꺼서 보관함) 또는 "모두 삭제"(꺼서 판에서 지움)를 고른다.
export const AFTER = ['archive', 'delete'];

// 돌고 있는 CLI: 에이전트(셸 아님)가 깨어 있거나(잠듦·끝남 아님), 셸에서 명령이 돌고 있다
export function isRunning(s) {
  if (!s) return false;
  if (s.kind === 'shell') return s.state === 'shell_running';
  return !['sleeping', 'exited', 'closed'].includes(s.state);
}

// workspaces: [{ key, name, root }], sessions: 세션 요약([{ sessionId, name, kind, state, workspaceKey }])
// → { items: [{ key, name, root, sessions, running, asleep, names }], sessions, running, empty, needsChoice }
export function closePlan(workspaces, sessions) {
  const items = (workspaces || []).map((w) => {
    const ss = (sessions || []).filter((s) => s.workspaceKey === w.key);
    return {
      key: w.key, name: w.name, root: w.root,
      sessions: ss.length,
      running: ss.filter(isRunning).length,
      asleep: ss.filter((s) => s.state === 'sleeping').length,
      names: ss.map((s) => s.name),
    };
  });
  const n = items.reduce((a, x) => a + x.sessions, 0);
  const running = items.reduce((a, x) => a + x.running, 0);
  return { items, sessions: n, running, empty: n === 0, needsChoice: n > 0 };
}

// 확인 단계의 결과를 판정한다: 세션이 있는데 after가 없거나 모르는 값이면 고르라고 한다
export function checkAfter(plan, after) {
  if (!plan.needsChoice) return { ok: true, after: null };
  if (!after) return { ok: false, reason: 'choose' };
  if (!AFTER.includes(after)) return { ok: false, reason: 'bad_after' };
  return { ok: true, after };
}
