// 상태 계산기(ARCH 3절). 터미널 상태(hc: 프로그램이 OSC 7501로 알린 것, rt.term)를 패널 상태의 기준으로 쓰고, hook으로 상세와 오류를 더한다.
// 세션마다 runtime 객체 하나를 두고 아래 apply* 함수로 바꾼다. deriveState는 runtime만 보고 상태를 정한다(순수 함수).
// P4: hook이 없는 세션(판이 띄우지 않은 에이전트, Claude Code가 아닌 종류)은 터미널 상태만으로 정한다(ARCH 4절 F3·F5).
//   묻는 내용은 화면(pane.read)에서 읽고, 승인 카드는 "터미널에서 답하기"로 보낸다.
import { unwrapPasted, clip, isBoardNotice } from './text.mjs';
import { bgTasksOf } from './push-cycle.mjs'; // P92

// P41: Claude Code가 고른 모델을 쓰지 못할 때의 글("There's an issue with the selected model (x). It may not exist or you may not have access to it.")과 오류 종류
// 답 글로 볼 때는 그 글로 시작하는 것만(답 안에서 그 글을 인용한 것은 오류가 아니다)
export const MODEL_ERROR_ANSWER_RE = /^\s*There's an issue with the selected model\b/;
export const isModelError = (e) => !!e && (/model_not_found|invalid_model/i.test(String(e.type || '')) || /issue with the selected model|model_not_found|model not found/i.test(String(e.message || '')));

export const STATES = ['starting', 'trust_wait', 'ready', 'working', 'waiting', 'error', 'exited', 'shell_idle', 'shell_running', 'sleeping']; // 셸 상태 둘은 P5(G2), 잠듦은 P21(D4)
const ASK_TOOLS = { AskUserQuestion: 'question', ExitPlanMode: 'plan' };
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']); // 같은 부류로 다룬다(E2 3절)

// P129: 업데이트 전에 저장한 세션 runtime을 지금 이름으로 읽는다(옛 이름 받기): 터미널 상태 칸 herdr → term, 종료 종류 herdr_stopped → terminal_stopped
const OLD_TERM_KEY = 'herdr', OLD_STOPPED = 'herdr_stopped';
export function upgradeRuntime(rt) {
  if (!rt || typeof rt !== 'object') return rt;
  if (rt[OLD_TERM_KEY] && !rt.term) rt.term = rt[OLD_TERM_KEY];
  delete rt[OLD_TERM_KEY];
  if (rt.exit && rt.exit.kind === OLD_STOPPED) rt.exit.kind = 'terminal_stopped';
  return rt;
}
export function newRuntime({ trustPredicted = false, now = Date.now(), kind = 'claude', hooked = true } = {}) {
  return {
    kind, // 에이전트 종류(claude, codex, …)
    hooked, // 판의 --settings hook이 붙은 세션인가(판이 띄운 Claude Code만)
    screenAsk: null, // hook이 없는 세션이 막혔을 때 화면 끝 { tail, at }
    answerSource: null, // 'hook' | 'screen'(hook이 없는 세션은 턴이 끝날 때 화면 끝을 마지막 답으로 둔다)
    phase: 'starting', // starting → running. 터미널 서버가 다시 뜨거나 claude가 이어 갈 때 다시 starting
    launchedAt: now,
    term: { status: null, launchPending: true, agentSessionId: null, present: false, at: null }, // 터미널이 아는 에이전트 상태(P129 전 이름 herdr)
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
    exit: null, // { kind: normal|terminal_stopped|trust_declined|other, reason, at }
    trustPredicted,
    trustScreen: null, // 화면에서 "Quick safety check"를 봤는지
    interruptedTurn: null, // C3: 터미널 서버가 꺼질 때 working/waiting이던 턴
    transcriptPath: null,
    claudeSessionId: null,
    sleep: null, // P21(D4): 잠듦 { at, by, memMB, convId, … }. 있으면 claude와 패널이 없고 상태는 sleeping
    workSince: null, // P173: 터미널이 working이 된 때(이번 일 구간의 시작)
    lastWork: null, // P173: 끝난 일 구간 { since, endedAt, turnless, compact } — turnless면 턴이 아니다(압축 등)
    compact: null, // P173: 대화 압축 { trigger: manual|auto|…, at, endedAt } (PreCompact·PostCompact hook)
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
      if (!isBoardNotice(body.prompt)) { rt.lastPrompt = unwrapPasted(body.prompt); rt.lastPromptAt = now; } // P153 r13: 판 알림은 마지막 지시가 아니다. P159: 관계 줄 + 지시는 지시다(원문을 두고 보일 때 promptTask로 줄을 뗀다)
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
    case 'PreCompact': // P173: 대화 압축이 시작됨(사람의 /compact, 자동, 쉬는 동안의 압축). 턴이 아니다
      rt.compact = { trigger: body.trigger || null, at: now, endedAt: null };
      break;
    case 'PostCompact':
      rt.compact = { ...(rt.compact || { trigger: body.trigger || null, at: now }), endedAt: now };
      break;
    case 'SessionEnd':
      rt.sessionEnd = { reason: body.reason || null, at: now };
      rt.bg = null;
      break;
    default: // SubagentStop 등은 상태를 바꾸지 않는다(E2 2.4)
  }
  // P173: 턴 hook(지시, 턴 끝)이 일 구간이 끝난 직후에 왔다(늦게 온 hook). 그 구간은 턴이었다
  if ((ev === 'UserPromptSubmit' || ev === 'Stop' || ev === 'StopFailure') && rt.lastWork && rt.lastWork.turnless && now - rt.lastWork.endedAt <= LATE_TURN_HOOK_MS) {
    rt.lastWork = { ...rt.lastWork, turnless: false, late: true };
    if (ev !== 'UserPromptSubmit' && !rt.turn.endedAt) rt.turn.endedAt = now;
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

// P173: 턴 없는 일. Claude Code는 사람이 친 /compact와 쉬는 동안의 압축("Compacted while idle")에도 터미널을 working → done으로 바꾼다.
// 그 사이에 지시(UserPromptSubmit)도 턴 끝(Stop·StopFailure)도 오지 않는다(오는 것은 SubagentStop, PreCompact·PostCompact뿐).
// hook이 붙은 Claude Code의 일 구간이 그렇게 끝나면 턴이 아니다: 작업 완료·안 본 답·웹 푸시·연결 알림을 만들지 않는다.
// Stop·UserPromptSubmit hook은 Claude Code가 응답을 기다리는 hook이라 터미널 상태보다 먼저 온다. 지시가 터미널 working보다 조금 먼저 올 수 있어 TURN_HOOK_SLACK_MS만큼 앞을 본다
export const TURN_HOOK_SLACK_MS = 3000;
export const LATE_TURN_HOOK_MS = 2000;
export function turnlessWork(rt) {
  if (rt.hooked === false || (rt.kind && rt.kind !== 'claude') || rt.workSince == null || !rt.hooksSinceLaunch) return false; // hook이 하나도 오지 않은 세션은 판정하지 않는다
  const from = rt.workSince - TURN_HOOK_SLACK_MS;
  const err = rt.lastError && rt.lastError.at;
  return !((rt.turn.startedAt || 0) >= from || (rt.lastAnswerAt || 0) >= from || (err || 0) >= from);
}

export function applyTermStatus(rt, status, now = Date.now(), extra = {}) {
  const prev = rt.term.status;
  rt.term.status = status;
  rt.term.at = now;
  if (extra.launchPending !== undefined) rt.term.launchPending = extra.launchPending;
  if (extra.agentSessionId !== undefined) rt.term.agentSessionId = extra.agentSessionId;
  // 끝난 claude를 되살리는 것은 agent_detected만 한다. 해제 직후에도 idle 이벤트가 한 번 온다(E10 2.4).
  rt.lastActivityAt = now;
  // waiting은 hook이 아니라 터미널 상태가 blocked에서 벗어날 때 끝낸다. 거부·취소에는 hook이 없다(E9).
  if (prev === 'blocked' && status !== 'blocked' && rt.pendingAsk) resolveAsk(rt, `term:${status}`, now);
  if (status !== 'blocked') { rt.trustScreen = null; rt.screenAsk = null; rt.worktreeExit = null; }
  // hook이 없는 세션의 턴은 터미널 상태로 센다(검토 대기 표시에 쓴다)
  if (rt.hooked === false && status === 'working' && prev !== 'working') rt.turn = { startedAt: now, endedAt: null };
  if (rt.phase === 'starting' && (status === 'idle' || status === 'done' || status === 'blocked' || status === 'working')) rt.phase = 'running';
  // P173: 일 구간의 시작과 끝. 턴 없는 구간(압축)은 턴 끝(turn.endedAt)을 바꾸지 않는다
  let turnless = false;
  // 막힘(blocked: 승인 질문)은 구간을 끊지 않는다(같은 턴이 이어진다). 놓임(unknown 등)은 구간을 버린다
  if (status === 'working' && prev !== 'working') { if (prev !== 'blocked' || rt.workSince == null) rt.workSince = now; }
  else if (rt.workSince != null && (status === 'idle' || status === 'done')) {
    turnless = turnlessWork(rt);
    const c = rt.compact && rt.compact.at >= (rt.workSince ?? now) - TURN_HOOK_SLACK_MS ? rt.compact.trigger || 'compact' : null;
    rt.lastWork = { since: rt.workSince, endedAt: now, turnless, ...(c ? { compact: c } : {}) };
    rt.workSince = null;
  } else if (status !== 'working' && status !== 'blocked') rt.workSince = null;
  if (!turnless && (prev === 'working' || (rt.hooked === false && prev === 'blocked')) && (status === 'idle' || status === 'done') && !rt.turn.endedAt && rt.turn.startedAt) rt.turn.endedAt = now;
  return prev;
}

// 터미널이 패널에서 에이전트를 다시 찾음(처음 띄울 때, 서버 재시작 뒤 이어 갈 때)
export function applyAgentDetected(rt, now = Date.now()) {
  rt.term.present = true;
  if (rt.exit) rt.bg = null; // P92: 다시 뜬 claude에는 뒤 일이 없다
  if (rt.exit) { rt.exit = null; rt.phase = 'starting'; rt.launchedAt = now; rt.hooksSinceLaunch = 0; rt.sessionEnd = null; }
}

// P125: 사람이 스스로 끝낸 것으로 보는 SessionEnd 까닭(입력 칸의 Ctrl+C 두 번·Ctrl+D·/exit, /logout)과 종료 코드.
// 종료 코드는 hc가 준다(옛 터미널은 주지 않았다). 0, 130(SIGINT), 0xC000013A(STATUS_CONTROL_C_EXIT: Windows 콘솔 Ctrl+C로 끝남)
export const USER_END_REASONS = new Set(['prompt_input_exit', 'logout']);
export const USER_EXIT_CODES = new Set([0, 130, 0xC000013A, -1073741510]);
export const userExitCode = (code) => code != null && USER_EXIT_CODES.has(Number(code));

// P125: claude(또는 다른 하네스)가 끝난 까닭(exit.kind)
//   normal         판이 끄라고 했다(/exit, 끄기·잠재우기·옮기기)
//   user           판이 끄라고 하지 않았는데 사람이 끝냈다(사람이 닫음). 오류가 아니고, 사이드바·노드에서 다시 연다
//   terminal_stopped  터미널 서버가 꺼졌다(판이 되살린다)
//   trust_declined 신뢰 질문에서 거절해 끝났다
//   other          그 밖(오류 코드, 충돌, 까닭 모름)
export function exitKind({ reason = null, termStopping = false, before = null, hooked = true, hooksSinceLaunch = 0, launchPending = false, requested = false, exitCode = null } = {}) {
  if (termStopping) return 'terminal_stopped';
  if (reason && USER_END_REASONS.has(reason)) return requested ? 'normal' : 'user';
  if (reason === 'other') return !requested && userExitCode(exitCode) ? 'user' : 'other'; // 콘솔 Ctrl+C 신호 등으로 끝나면 까닭이 other다. 종료 코드가 사람의 끝이면 user
  if (before === 'trust_wait' || (hooked !== false && !reason && hooksSinceLaunch === 0 && launchPending)) return 'trust_declined';
  if (requested) return hooked === false ? 'normal' : 'other'; // hook이 없는 세션은 판이 끄라고 했을 때만 정상 종료로 본다(hook이 있는데 SessionEnd 없이 끝나면 지금처럼 other)
  return userExitCode(exitCode) ? 'user' : 'other'; // hook·까닭이 없으면 종료 코드로 가른다(hc). 코드를 모르면 지금처럼 other
}

// claude가 끝나 패널이 셸로 돌아감. exitCode: 끝난 프로그램의 종료 코드(hc만, 모르면 null)
export function applyAgentReleased(rt, now = Date.now(), { termStopping = false, exitCode = null } = {}) {
  const before = deriveState(rt).state;
  rt.term.present = false;
  rt.term.status = 'unknown';
  rt.pendingAsk = null;
  rt.worktreeExit = null;
  rt.bg = null; // P92: claude가 끝나면 뒤 일도 끝난다
  const reason = rt.sessionEnd && rt.sessionEnd.reason;
  const requested = !!(rt.exitRequested || rt.boardExit);
  const kind = exitKind({ reason, termStopping, before, hooked: rt.hooked, hooksSinceLaunch: rt.hooksSinceLaunch, launchPending: rt.term.launchPending, requested, exitCode });
  rt.exitRequested = false;
  rt.exit = { kind, reason: reason || null, at: now, ...(exitCode != null ? { code: exitCode } : {}), ...(requested ? { requested: true } : {}) };
}

// P125: 놓임 뒤에 온 종료 코드(hc가 셸을 남기며 알림). 까닭을 몰라 other로 둔 끝남이 사람의 끝 코드면 user로 고친다. 바뀌면 true
export function applyExitCode(rt, code) {
  if (!rt.exit || code == null || rt.exit.code != null) return false;
  rt.exit.code = code;
  if (rt.exit.kind === 'other' && !rt.exit.requested && userExitCode(code)) rt.exit.kind = 'user';
  return true;
}

// 터미널 서버가 꺼짐(소켓 끊김). 진행 중이던 턴은 끊긴다(E7 2.4).
export function applyTermDisconnected(rt, now = Date.now()) {
  const st = deriveState(rt).state;
  if (st === 'working' || st === 'waiting') rt.interruptedTurn = { state: st, at: now, prompt: clip(rt.lastPrompt, 200) };
  // I8(P6b): 셸에서 돌던 명령도 셸과 함께 끝난다. 다시 띄운 셸은 프롬프트에서 쉬므로 끊긴 명령을 남긴다
  if (st === 'shell_running') rt.interruptedTurn = { state: st, at: now, prompt: clip((rt.shell && (rt.shell.command || (rt.shell.procs || []).join(', '))) || null, 200) };
  if (rt.term.present) applyAgentReleased(rt, now, { termStopping: true });
  rt.term.status = null;
}

// P71: 화면에서 읽은 워크트리 나가기 질문(screen.mjs parseWorktreeExit) → 승인 줄이 보일 ask
export function worktreeExitAsk(w) {
  return { kind: 'worktree_exit', commits: w.commits ?? null, files: w.files || 0, branch: w.branch || null, keep: w.keep, remove: w.remove, since: w.at };
}

// P119: 판이 닫는 세션(닫기, 다시 띄우기)의 /exit 뒤 막힘. rt.boardExit = { by, at, foreign? }은 판이 /exit를 보낼 때 두고 끝나면 지운다.
// 판이 답하는 워크트리 나가기 질문은 사람의 일이 아니라 응답 필요(알림, 목록, 푸시, 트레이)로 보이지 않는다.
// 판이 모르는 화면(foreign: 나가기 질문이 아닌 막힘)이면 지금처럼 응답 필요다.
export const boardClosing = (rt) => !!(rt.boardExit && !rt.boardExit.foreign);
const closingState = (rt) => ({ state: 'ready', closing: rt.boardExit.by || 'close', estimate: 'board closing' });

export function deriveState(rt) {
  const h = rt.term;
  if (rt.sleep) return { state: 'sleeping' }; // P21(D4): 판이 잠재움. 패널이 없다(J1·J2의 닫힘과 다르다)
  if (rt.move) return { state: 'starting', moving: rt.move.to }; // P117: 다른 터미널 백엔드로 옮기는 중(옛 claude를 끄고 새 자리에서 이어 감). 전달은 기다린다
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
    // 2026-11-23: Codex의 폴더 신뢰 화면(판이 화면에서 읽음, backend checkCodexTrust). 터미널은 이 화면의 Codex를 알아보지 못하거나(상태 없음) blocked로 본다.
    //   Codex가 돌기 시작하면(working·idle·done) 화면 표시가 남아 있어도 따르지 않는다
    if (rt.kind === 'codex' && rt.trustScreen && s !== 'working' && s !== 'idle' && s !== 'done') return { state: 'trust_wait', confirmedByScreen: true };
    if (s === 'blocked') {
      if (rt.kind === 'claude' && rt.trustScreen) return { state: 'trust_wait', confirmedByScreen: true };
      if (boardClosing(rt)) return closingState(rt);
      if (rt.kind === 'claude' && rt.worktreeExit) return { state: 'waiting', ask: worktreeExitAsk(rt.worktreeExit) };
      return { state: 'waiting', ask: { kind: 'screen', tail: rt.screenAsk ? rt.screenAsk.tail : null, since: rt.screenAsk ? rt.screenAsk.at : h.at } };
    }
    if (s === 'working') return { state: 'working' };
    if (s === 'idle' || s === 'done') return { state: 'ready' };
    if (s === 'unknown' && rt.phase === 'running' && h.present) return { state: 'ready', estimate: 'term unknown' };
    return { state: 'starting' };
  }
  if (s === 'blocked') {
    if (rt.pendingAsk) return { state: 'waiting', ask: rt.pendingAsk };
    // P119: 판이 스스로 닫는 중(/exit를 보내고 나가기 질문에 답한다)이면 응답 필요로 보이지 않는다. 신뢰 질문은 그대로다
    if (boardClosing(rt) && (rt.worktreeExit || !(rt.trustScreen || (h.launchPending && !h.agentSessionId && rt.hooksSinceLaunch === 0)))) return closingState(rt);
    if (rt.worktreeExit) return { state: 'waiting', ask: worktreeExitAsk(rt.worktreeExit) }; // P71: 워크트리 나가기 질문(화면에서 읽음)
    // 신뢰 대화상자: 화면의 "Quick safety check", 또는 hook 없음 + launch_pending + agent_session 없음(E10)
    if (rt.trustScreen || (h.launchPending && !h.agentSessionId && rt.hooksSinceLaunch === 0)) return { state: 'trust_wait', confirmedByScreen: !!rt.trustScreen };
    return { state: 'waiting', ask: { kind: 'unknown_dialog' }, estimate: 'term blocked, no ask hook' };
  }
  if (rt.pendingAsk && (s === 'working' || s === 'idle' || s === 'done')) return { state: 'waiting', ask: rt.pendingAsk, estimate: `hook waiting, term ${s}` };
  if (s === 'working') return rt.compact && !rt.compact.endedAt && rt.workSince != null && rt.compact.at >= rt.workSince - TURN_HOOK_SLACK_MS ? { state: 'working', estimate: 'compacting' } : { state: 'working' }; // P173: 압축 중
  if (s === 'idle' || s === 'done') return rt.lastError ? { state: 'error', error: rt.lastError } : { state: 'ready' };
  return { state: 'starting' };
}

// P141(#14): 응답 필요(waiting, trust_wait)가 시작된 때. rt.waitingSince = { key, at }로 runtime에 남아
// 백엔드·터미널 서버를 다시 켜도 같은 질문(같은 tool_use_id, 신뢰 질문, 화면 질문)이면 그 시각을 잇는다.
// 다시 켜는 사이의 중간 상태(starting, 터미널 서버가 꺼져 끝남)에서는 지우지 않는다. 다른 상태가 되면 지운다.
export function needKey(d) {
  if (d.state === 'trust_wait') return 'trust';
  if (d.state !== 'waiting') return null;
  const a = d.ask || {};
  if (a.toolUseId) return `ask:${a.toolUseId}`;
  if (a.kind === 'screen' || a.kind === 'unknown_dialog') return 'screen';
  return `ask:${a.kind || ''}:${a.tool || ''}:${a.summary || ''}`;
}
export function trackWaiting(rt, d = deriveState(rt), now = Date.now()) {
  const key = needKey(d);
  if (!key) {
    const between = d.state === 'starting' || (d.state === 'exited' && rt.exit && rt.exit.kind === 'terminal_stopped');
    if (!between) rt.waitingSince = null;
    return null;
  }
  const w = rt.waitingSince;
  if (!w || w.key !== key) rt.waitingSince = { key, at: Math.min(now, (d.ask && d.ask.since) || now) };
  return rt.waitingSince.at;
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

// macOS 판: 사람이 지금 턴을 멈췄다(Esc·중지 단추). Stop hook이 오지 않으니 끝으로 치지 않고 멈춤으로 둔다(atrium wait가 옛 답을 결과로 주지 않게).
// 그 턴이 시작한 뒤의 멈춤만. 바뀌었으면 true
// macOS 판: hook 없이 기록으로 안 API 오류(model-now foldApiError). 그 턴이 아직 끝나지 않았으면 StopFailure처럼 끝낸다
export function markTurnFailed(rt, e) {
  const t = rt && rt.turn;
  if (!t || !t.startedAt || !e || e.at < t.startedAt || (t.endedAt && t.endedAt >= t.startedAt)) return false;
  rt.lastError = { type: e.type || 'api_error', message: e.message || null, at: e.at, via: 'transcript' };
  t.endedAt = e.at;
  return true;
}

export function markTurnInterrupted(rt, at = Date.now()) {
  const t = rt && rt.turn;
  if (!t || !t.startedAt || at < t.startedAt || (t.endedAt && t.endedAt >= t.startedAt) || (t.interruptedAt && t.interruptedAt >= at)) return false;
  t.interruptedAt = at;
  return true;
}
