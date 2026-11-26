// P125: 사람이 스스로 끝낸 세션(사람이 닫음)과 다시 열기.
// - 판이 끄라고 하지 않았는데 claude(또는 다른 하네스)가 끝났다: 입력 칸의 Ctrl+C 두 번·Ctrl+D·/exit(SessionEnd prompt_input_exit),
//   콘솔 Ctrl+C로 끝남(hc의 종료 코드 0·130·0xC000013A). state.mjs exitKind가 exit.kind 'user'로 둔다. 오류·알림·문제 목록에 넣지 않는다.
// - 노드는 캔버스의 같은 자리에 "직접 종료"로 남는다(hc는 그 자리에 셸을 남긴다). 그래서 이름·자리·덩어리·연결·부모·역할 선이 그대로다.
// - 다시 열기(session.reopen): 그 셸 패널에서 같은 세션 ID(같은 대화)로 이어 띄운다. 설정 파일·hook 토큰·env·안내문·연결은 띄울 때의 것을 그대로 쓴다
//   (잠든 세션 깨우기와 같은 실행 값). 패널이 없으면 같은 폴더에 새 패널을 만든다. 닫힌 세션(J2, 캔버스에 없음)은 recall.reopen으로 넘긴다.
import fs from 'node:fs';
import { keyed } from './msg.mjs';
import { deriveState } from './state.mjs';
import { convoOf, wakeArgs } from './sleep.mjs';
import { startOpt } from './launchers.mjs';

const SHELL = 'shell';
function apiError(code, message) { return Object.assign(new Error(message), { code }); }
// 사람이 닫은 것인가(오류로 보이지 않는다)
export const userClosed = (s) => !!(s && s.rt && s.rt.exit && s.rt.exit.kind === 'user');
// 캔버스에 있는 끝난 세션을 같은 자리에서 다시 열 수 있는가. 셸 노드는 끝나면 닫히고(J2), 잠든 세션은 깨운다
export function reopenable(s) {
  if (!s || !s.rt || !s.rt.exit || s.rt.sleep || s.kind === SHELL) return false;
  return true;
}

// 같은 자리에서 다시 띄우기 전에 런타임을 starting으로 되돌린다(깨우기와 같은 값)
export function resetForReopen(rt, now = Date.now()) {
  rt.exit = null; rt.exitRequested = false; rt.sessionEnd = null; rt.pendingAsk = null; rt.lastError = null; rt.worktreeExit = null; rt.trustScreen = null; rt.bg = null;
  rt.phase = 'starting'; rt.launchedAt = now; rt.hooksSinceLaunch = 0;
  rt.term = { ...(rt.term || {}), status: null, launchPending: true, agentSessionId: null, present: false, at: now };
}

// b: 백엔드. ref: 세션 ID나 이름. 판의 끝난 세션이면 같은 자리, 아니면 닫힌 세션(J2) 다시 열기
export async function reopenSession(b, p = {}) {
  const ref = String(p.session || '');
  const s = b.sessions.get(ref) || [...b.sessions.values()].find((x) => x.name === ref || x.label === ref);
  if (!s) {
    if (!b.recall) throw apiError('not_found', `세션을 찾을 수 없습니다: ${ref}`);
    return { ...(await b.recall.reopen(p)), where: 'closed' };
  }
  if (!s.rt.exit) throw keyed(apiError('not_exited', `@${s.name} 세션은 아직 실행 중입니다.`), 'userClose.err.notExited', { name: s.name });
  if (!reopenable(s)) throw keyed(apiError('bad_request', `@${s.name} 세션은 다시 열 수 없습니다.`), 'userClose.err.cannot', { name: s.name });
  if (s._reopening) return s._reopening;
  s._reopening = reopenInPlace(b, s, p).finally(() => { s._reopening = null; });
  return s._reopening;
}

async function reopenInPlace(b, s, p) {
  b.requireTerminal();
  if (!s.cwd || !fs.existsSync(s.cwd)) throw keyed(apiError('no_folder', `폴더를 찾을 수 없습니다: ${s.cwd}`), 'noFolder', { path: s.cwd });
  const claude = (s.kind || 'claude') === 'claude' && b.hooked(s);
  const before = s.rt.exit;
  // 남은 셸 패널(hc는 같은 자리에 셸을 띄웠다). 없으면 같은 폴더에 새 패널
  let pane = s.paneId ? await b.adapter.getPane(s.paneId).catch(() => null) : null;
  if (pane && pane.agent) throw keyed(apiError('busy', `@${s.name} 패널에서 다른 에이전트가 실행 중입니다.`), 'userClose.err.busy', { name: s.name });
  let created = false;
  if (!pane) {
    await b.withNewPane(() => b.adapter.createWorkspace({ cwd: s.cwd, label: s.name }), (r) => {
      s.paneId = r.paneId; s.termWorkspaceId = r.workspaceId;
      b.store.updateSession(s.sessionId, { paneId: r.paneId, termWorkspaceId: r.workspaceId });
    });
    await b.adapter.refreshSubscription();
    created = true;
  }
  resetForReopen(s.rt);
  b.store.updateSession(s.sessionId, { runtime: s.rt });
  b.broadcastSession(s, { cause: 'reopen:user' });
  let plan = 'resume', argv = null;
  try {
    if (claude) {
      const conv = convoOf(s, b.projectsOf ? b.projectsOf(s) : b.cfg.claudeProjects);
      const w = wakeArgs(b.launchOf(s), conv, b.modelNowFor ? b.modelNowFor(s) : s.rt.modelNow); // P227: 이어 갈 때는 지금 모델
      plan = w.plan;
      await b.adapter.waitShellReady(s.paneId, 8000);
      const st = await b.adapter.startAgent({ name: s.agentName, paneId: s.paneId, args: w.args, ...startOpt(s) }); // P97: 실행 명령
      if (st.agent && st.agent.launchPending !== undefined) s.rt.term.launchPending = st.agent.launchPending;
      argv = st.argv || null;
    } else {
      const st = await b.startHarness(s, { resume: true, why: 'reopen', name: s.agentName }); // P115: 하네스는 같은 세션 ID로 이어 간다
      plan = st.resumed ? 'resume' : 'fresh'; argv = st.argv || null;
    }
  } catch (e) {
    // 띄우지 못했다: 끝난 채로 되돌린다(노드는 그대로)
    s.rt.exit = before; s.rt.term.launchPending = false;
    b.store.updateSession(s.sessionId, { runtime: s.rt });
    b.store.addEvent(s.sessionId, 'reopen_failed', { error: e.code || e.message, where: 'board' });
    b.broadcastSession(s, { cause: 'reopen:failed' });
    throw e;
  }
  s.touchedAt = Date.now();
  const out = { sessionId: s.sessionId, name: s.name, kind: s.kind || 'claude', where: 'board', plan, resume: plan === 'resume', paneId: s.paneId, newPane: created, was: before && before.kind };
  b.store.addEvent(s.sessionId, 'reopened_in_place', { ...out, argv });
  b.log(`reopened in place ${s.name} plan=${plan} pane=${s.paneId}${created ? ' (new pane)' : ''} was=${out.was}`);
  b.broadcastSession(s, { cause: 'reopen:user' });
  return { ...out, state: deriveState(s.rt).state };
}
