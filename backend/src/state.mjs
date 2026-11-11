// 상태 계산기(ARCH 3절). herdr 상태를 패널 상태의 기준으로 쓰고, hook으로 상세와 오류를 더한다.
// 세션마다 runtime 객체 하나를 두고 아래 apply* 함수로 바꾼다. deriveState는 runtime만 보고 상태를 정한다(순수 함수).
// P4: hook이 없는 세션(판이 띄우지 않은 에이전트, Claude Code가 아닌 종류)은 herdr 상태만으로 정한다(ARCH 4절 F3·F5).
//   묻는 내용은 화면(pane.read)에서 읽고, 승인 카드는 "터미널에서 답하기"로 보낸다.
import { unwrapPasted, clip } from './text.mjs';
import { bgTasksOf } from './push-cycle.mjs'; // P92

// P41: Claude Code가 고른 모델을 쓰지 못할 때의 글("There's an issue with the selected model (x). It may not exist or you may not have access to it.")과 오류 종류
// 답 글로 볼 때는 그 글로 시작하는 것만(답 안에서 그 글을 인용한 것은 오류가 아니다)
export const MODEL_ERROR_ANSWER_RE = /^\s*There's an issue with the selected model\b/;
export const isModelError = (e) => !!e && (/model_not_found|invalid_model/i.test(String(e.type || '')) || /issue with the selected model|model_not_found|model not found/i.test(String(e.message || '')));

export const STATES = ['starting', 'trust_wait', 'ready', 'working', 'waiting', 'error', 'exited', 'shell_idle', 'shell_running', 'sleeping']; // 셸 상태 둘은 P5(G2), 잠듦은 P21(D4)
const ASK_TOOLS = { AskUserQuestion: 'question', ExitPlanMode: 'plan' };
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']); // 같은 부류로 다룬다(E2 3절)

export function newRuntime({ trustPredicted = false, now = Date.now(), kind = 'claude', hooked = true } = {}) {
  return {
    kind, // herdr 에이전트 종류(claude, codex, …)
    hooked, // 판의 --settings hook이 붙은 세션인가(판이 띄운 Claude Code만)
    screenAsk: null, // hook이 없는 세션이 막혔을 때 화면 끝 { tail, at }
    answerSource: null, // 'hook' | 'screen'(hook이 없는 세션은 턴이 끝날 때 화면 끝을 마지막 답으로 둔다)
    phase: 'starting', // starting → running. herdr가 다시 뜨거나 claude가 이어 갈 때 다시 starting
    launchedAt: now,
    herdr: { status: null, launchPending: true, agentSessionId: null, present: false, at: null },
    hooksSinceLaunch: 0,
    lastHookAt: null,
    lastActivityAt: now,
    pendingAsk: null,
    lastAskResolved: null,
    lastPre: null, // 마지막 PreToolUse { tool, toolUseId, input }
    lastPrompt: null,
    lastPromptAt: null,
    turn: { startedAt: null, endedAt: null },
    lastAnswer: null,
    lastAnswerAt: null,
    lastError: null,
    permissionMode: null,
    sessionEnd: null, // SessionEnd hook { reason, at }
    exit: null, // { kind: normal|herdr_stopped|trust_declined|other, reason, at }
    trustPredicted,
    trustScreen: null, // 화면에서 "Quick safety check"를 봤는지
    interruptedTurn: null, // C3: herdr가 꺼질 때 working/waiting이던 턴
    transcriptPath: null,
    claudeSessionId: null,
    sleep: null, // P21(D4): 잠듦 { at, by, memMB, convId, … }. 있으면 claude와 패널이 없고 상태는 sleeping
  };
}

// 권한 요청 상세 요약: 도구 이름과 명령 또는 파일
export function summarizeTool(tool, input = {}) {
  if (!input || typeof input !== 'object') return tool;
  if (SHELL_TOOLS.has(tool)) return `${tool}: ${clip(input.command || '', 300)}`;
  if (input.file_path) return `${tool}: ${input.file_path}`;
  if (input.url) return `${tool}: ${input.url}`;
  if (input.pattern) return `${tool}: ${input.pattern}`;
  return `${tool}: ${clip(JSON.stringify(input), 200)}`;
}

export function applyHook(rt, body, now = Date.now()) {
  const ev = body.hook_event_name;
  rt.hooksSinceLaunch++;
  rt.lastHookAt = now;
  rt.lastActivityAt = now;
  if (body.transcript_path) rt.transcriptPath = body.transcript_path;
  if (body.session_id) rt.claudeSessionId = body.session_id;
  if (body.permission_mode) rt.permissionMode = body.permission_mode;
  const tool = body.tool_name;
  switch (ev) {
    case 'UserPromptSubmit':
      rt.lastPrompt = unwrapPasted(body.prompt);
      rt.lastPromptAt = now;
      rt.turn = { startedAt: now, endedAt: null };
      rt.lastError = null;
      break;
    case 'PreToolUse':
      rt.lastPre = { tool, toolUseId: body.tool_use_id, input: body.tool_input };
      if (ASK_TOOLS[tool]) rt.pendingAsk = askFrom(ASK_TOOLS[tool], tool, body.tool_input, body.tool_use_id, now);
      break;
    case 'PermissionRequest': {
      const toolUseId = rt.lastPre && rt.lastPre.tool === tool ? rt.lastPre.toolUseId : null;
      const kind = ASK_TOOLS[tool] || 'permission';
      const prev = rt.pendingAsk && rt.pendingAsk.toolUseId === toolUseId ? rt.pendingAsk : null;
      rt.pendingAsk = { ...askFrom(kind, tool, body.tool_input, toolUseId, prev ? prev.since : now), suggestions: body.permission_suggestions || null, choices: prev ? prev.choices : null };
      break;
    }
    case 'Notification':
      if (rt.pendingAsk && body.notification_type === 'permission_prompt') rt.pendingAsk.notifiedAt = now;
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionDenied':
      if (rt.pendingAsk && (!rt.pendingAsk.toolUseId || rt.pendingAsk.toolUseId === body.tool_use_id)) resolveAsk(rt, ev, now);
      break;
    case 'Stop':
      // P41: 모델 오류는 Stop으로 와도(답 글이 Claude Code의 오류 글) 오류로 본다
      if (MODEL_ERROR_ANSWER_RE.test(String(body.last_assistant_message || ''))) rt.lastError = { type: 'model_not_found', message: clip(body.last_assistant_message, 400), at: now };
      rt.lastAnswer = body.last_assistant_message ?? rt.lastAnswer;
      rt.lastAnswerAt = now;
      rt.turn.endedAt = now;
      if (rt.pendingAsk) resolveAsk(rt, 'Stop', now);
      break;
    case 'StopFailure':
      rt.lastError = { type: body.error || body.error_type || 'unknown', message: body.message || body.error_message || body.error_details || null, at: now };
      rt.turn.endedAt = now;
      break;
    case 'SessionEnd':
      rt.sessionEnd = { reason: body.reason || null, at: now };
      rt.bg = null;
      break;
    default: // SubagentStop 등은 상태를 바꾸지 않는다(E2 2.4)
  }
  // P92: Stop·SubagentStop의 background_tasks = 지금 도는 뒤 일(뒤 셸, 뒤 하위 에이전트). 없으면(옛 Claude Code) 전 값을 둔다
  if (ev === 'Stop' || ev === 'SubagentStop') { const tasks = bgTasksOf(body); if (tasks) rt.bg = { tasks, at: now }; }
}

function askFrom(kind, tool, input, toolUseId, since) {
  const a = { kind, tool, toolUseId: toolUseId || null, since, notifiedAt: null };
  if (kind === 'question') a.questions = ((input && input.questions) || []).map((q) => ({ question: q.question, header: q.header, multiSelect: !!q.multiSelect, options: (q.options || []).map((o) => o.label) }));
  else if (kind === 'plan') a.plan = clip(input && input.plan, 2000);
  else a.summary = summarizeTool(tool, input);
  a.input = input;
  return a;
}
function resolveAsk(rt, how, now) { rt.lastAskResolved = { ...rt.pendingAsk, input: undefined, resolvedBy: how, resolvedAt: now }; rt.pendingAsk = null; }

export function applyHerdrStatus(rt, status, now = Date.now(), extra = {}) {
  const prev = rt.herdr.status;
  rt.herdr.status = status;
  rt.herdr.at = now;
  if (extra.launchPending !== undefined) rt.herdr.launchPending = extra.launchPending;
  if (extra.agentSessionId !== undefined) rt.herdr.agentSessionId = extra.agentSessionId;
  // 끝난 claude를 되살리는 것은 agent_detected만 한다. 해제 직후에도 idle 이벤트가 한 번 온다(E10 2.4).
  rt.lastActivityAt = now;
  // waiting은 hook이 아니라 herdr가 blocked에서 벗어날 때 끝낸다. 거부·취소에는 hook이 없다(E9).
  if (prev === 'blocked' && status !== 'blocked' && rt.pendingAsk) resolveAsk(rt, `herdr:${status}`, now);
  if (status !== 'blocked') { rt.trustScreen = null; rt.screenAsk = null; rt.worktreeExit = null; }
  // hook이 없는 세션의 턴은 herdr 상태로 센다(검토 대기 표시에 쓴다)
  if (rt.hooked === false && status === 'working' && prev !== 'working') rt.turn = { startedAt: now, endedAt: null };
  if (rt.phase === 'starting' && (status === 'idle' || status === 'done' || status === 'blocked' || status === 'working')) rt.phase = 'running';
  if ((prev === 'working' || (rt.hooked === false && prev === 'blocked')) && (status === 'idle' || status === 'done') && !rt.turn.endedAt && rt.turn.startedAt) rt.turn.endedAt = now;
  return prev;
}

// herdr가 패널에서 claude를 다시 찾음(처음 띄울 때, herdr 재시작 뒤 이어 갈 때)
export function applyAgentDetected(rt, now = Date.now()) {
  rt.herdr.present = true;
  if (rt.exit) rt.bg = null; // P92: 다시 뜬 claude에는 뒤 일이 없다
  if (rt.exit) { rt.exit = null; rt.phase = 'starting'; rt.launchedAt = now; rt.hooksSinceLaunch = 0; rt.sessionEnd = null; }
}

// claude가 끝나 패널이 셸로 돌아감
export function applyAgentReleased(rt, now = Date.now(), { herdrStopping = false } = {}) {
  const before = deriveState(rt).state;
  rt.herdr.present = false;
  rt.herdr.status = 'unknown';
  rt.pendingAsk = null;
  rt.worktreeExit = null;
  rt.bg = null; // P92: claude가 끝나면 뒤 일도 끝난다
  const reason = rt.sessionEnd && rt.sessionEnd.reason;
  let kind;
  if (reason === 'prompt_input_exit') kind = 'normal';
  else if (herdrStopping || reason === 'other') kind = herdrStopping ? 'herdr_stopped' : 'other';
  else if (before === 'trust_wait' || (rt.hooked !== false && !reason && rt.hooksSinceLaunch === 0 && rt.herdr.launchPending)) kind = 'trust_declined';
  else kind = rt.hooked === false && rt.exitRequested ? 'normal' : 'other'; // hook이 없는 세션은 판이 끄라고 했을 때만 정상 종료로 본다
  rt.exitRequested = false;
  rt.exit = { kind, reason: reason || null, at: now };
}

// herdr 서버가 꺼짐(소켓 끊김). 진행 중이던 턴은 끊긴다(E7 2.4).
export function applyHerdrDisconnected(rt, now = Date.now()) {
  const st = deriveState(rt).state;
  if (st === 'working' || st === 'waiting') rt.interruptedTurn = { state: st, at: now, prompt: clip(rt.lastPrompt, 200) };
  // I8(P6b): 셸에서 돌던 명령도 셸과 함께 끝난다. herdr가 다시 띄운 셸은 프롬프트에서 쉬므로 끊긴 명령을 남긴다
  if (st === 'shell_running') rt.interruptedTurn = { state: st, at: now, prompt: clip((rt.shell && (rt.shell.command || (rt.shell.procs || []).join(', '))) || null, 200) };
  if (rt.herdr.present) applyAgentReleased(rt, now, { herdrStopping: true });
  rt.herdr.status = null;
}

// P71: 화면에서 읽은 워크트리 나가기 질문(screen.mjs parseWorktreeExit) → 승인 줄이 보일 ask
export function worktreeExitAsk(w) {
  return { kind: 'worktree_exit', commits: w.commits ?? null, files: w.files || 0, branch: w.branch || null, keep: w.keep, remove: w.remove, since: w.at };
}

export function deriveState(rt) {
  const h = rt.herdr;
  if (rt.sleep) return { state: 'sleeping' }; // P21(D4): 판이 잠재움. 패널이 없다(J1·J2의 닫힘과 다르다)
  if (rt.exit) return { state: 'exited' };
  // G2(P5): 에이전트 없는 일반 셸. 프롬프트에서 쉬는가(shell_idle), 명령을 돌리는가(shell_running). hook도 승인 카드도 없다
  if (rt.kind === 'shell') return { state: rt.shell && rt.shell.atPrompt === false ? 'shell_running' : 'shell_idle' };
  const s = h.status;
  if (rt.kind === 'agy' && !rt.agyTurnActive && rt.agyComposer && rt.agyComposer !== 'ready') return { state: rt.agyComposer, ...(rt.agyComposer === 'waiting' ? { ask: { kind: 'screen', tail: rt.screenAsk?.tail || null } } : {}) };
  if (rt.kind === 'agy' && rt.agyStoppedAt && !rt.agyTurnActive && rt.agyComposer === 'ready' && s !== 'blocked') return rt.lastError ? { state: 'error', error: rt.lastError } : { state: 'ready' };
  if (rt.kind === 'agy' && rt.agyTurnActive && s !== 'blocked') return { state: 'working' };
  if (rt.kind === 'gemini' && rt.geminiIntegration && s !== 'blocked') {
    if (!rt.geminiReady) return { state: 'starting' };
    if (rt.geminiTurnActive) return { state: 'working' };
  }
  if (rt.hooked === false) {
    if (s === 'blocked') {
      if (rt.kind === 'claude' && rt.trustScreen) return { state: 'trust_wait', confirmedByScreen: true };
      if (rt.kind === 'claude' && rt.worktreeExit) return { state: 'waiting', ask: worktreeExitAsk(rt.worktreeExit) };
      return { state: 'waiting', ask: { kind: 'screen', tail: rt.screenAsk ? rt.screenAsk.tail : null, since: rt.screenAsk ? rt.screenAsk.at : h.at } };
    }
    if (s === 'working') return { state: 'working' };
    if (s === 'idle' || s === 'done') return { state: 'ready' };
    if (s === 'unknown' && rt.phase === 'running' && h.present) return { state: 'ready', estimate: 'herdr unknown' };
    return { state: 'starting' };
  }
  if (s === 'blocked') {
    if (rt.pendingAsk) return { state: 'waiting', ask: rt.pendingAsk };
    if (rt.worktreeExit) return { state: 'waiting', ask: worktreeExitAsk(rt.worktreeExit) }; // P71: 워크트리 나가기 질문(화면에서 읽음)
    // 신뢰 대화상자: 화면의 "Quick safety check", 또는 hook 없음 + launch_pending + agent_session 없음(E10)
    if (rt.trustScreen || (h.launchPending && !h.agentSessionId && rt.hooksSinceLaunch === 0)) return { state: 'trust_wait', confirmedByScreen: !!rt.trustScreen };
    return { state: 'waiting', ask: { kind: 'unknown_dialog' }, estimate: 'herdr blocked, no ask hook' };
  }
  if (rt.pendingAsk && (s === 'working' || s === 'idle' || s === 'done')) return { state: 'waiting', ask: rt.pendingAsk, estimate: `hook waiting, herdr ${s}` };
  if (s === 'working') return { state: 'working' };
  if (s === 'idle' || s === 'done') return rt.lastError ? { state: 'error', error: rt.lastError } : { state: 'ready' };
  return { state: 'starting' };
}

// 상태에 덧붙이는 표시(3절): 검토 대기, 조용함, 전달 중
export function flags(rt, { seenAt = null, delivering = 0, quietMs, now = Date.now() } = {}) {
  const st = deriveState(rt).state;
  return {
    unseen: !!(rt.turn.endedAt && (!seenAt || seenAt < rt.turn.endedAt) && (st === 'ready' || st === 'error' || st === 'sleeping')), // P21: 잠들어도 안 본 답은 검토 대기로 남긴다
    quiet: st === 'working' && quietMs ? now - rt.lastActivityAt > quietMs : false,
    delivering,
  };
}
