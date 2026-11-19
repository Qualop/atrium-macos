// 단위 시험: herdr와 claude 없이 돌릴 수 있는 규칙들. node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unwrapPasted, promptMatches, parseTargets, toLF } from '../src/text.mjs';
import { predictTrustFrom, buildStartArgs, buildResumeArgv, writeSessionSettings, transcriptPathFor } from '../src/launch.mjs';
import { newRuntime, applyHook, applyTermStatus, applyAgentReleased, applyAgentDetected, applyTermDisconnected, deriveState, flags } from '../src/state.mjs';
import { DeliveryQueue, blockReason } from '../src/delivery.mjs';
import { Store } from '../src/store.mjs';
import { parseChoices, isTrustDialog } from '../src/screen.mjs';
import { readMessages, lastExchange } from '../src/transcript.mjs';
import { loadConfig } from '../src/config.mjs';
import { cleanEnv } from '../src/proc-env.mjs';
import { planAnswer, checkSteps, sameAsk } from '../src/answer.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-unit-'));

test('E3: pasted_content 감싸기를 벗기고 비교한다', () => {
  const sent = 'line1\r\nline2\tx\nline3\nline4';
  const hook = '\n\n<pasted_content id="8afe">\nline1\nline2    x\nline3\nline4\n</pasted_content id="8afe">\n';
  assert.equal(unwrapPasted(hook).trim(), 'line1\nline2    x\nline3\nline4');
  assert.ok(promptMatches(sent, hook));
  assert.ok(promptMatches('  hi there  \n', '  hi there'));
  assert.ok(!promptMatches('hello', 'hello world'));
  assert.equal(toLF('a\r\nb\rc'), 'a\nb\nc');
});

test('@이름 풀기', () => {
  assert.deepEqual(parseTargets('@a @b 안녕 @c'), { targets: ['a', 'b'], text: '안녕 @c' });
  assert.deepEqual(parseTargets('no target'), { targets: [], text: 'no target' });
});

test('E10: 신뢰 예상은 상위 폴더까지 본다', () => {
  const projects = { 'C:/Workspace': { hasTrustDialogAccepted: true }, 'C:/Other/x': { hasTrustDialogAccepted: false } };
  assert.deepEqual(predictTrustFrom('C:\\Workspace\\multitask\\backend\\.dev\\proj', projects), { needsTrust: false, trustedBy: 'C:/Workspace' });
  assert.equal(predictTrustFrom('C:\\Users\\x\\AppData\\Local\\Temp\\fresh', projects).needsTrust, true);
  assert.equal(predictTrustFrom('C:\\Other\\x', projects).needsTrust, true);
  assert.equal(predictTrustFrom('c:\\workspace\\a', projects).needsTrust, false);
});

test('B3: 실행 인자와 이어 가기 명령은 같은 설정을 쓴다', () => {
  const o = { sessionId: 'u1', settingsPath: 'C:/d/sessions/u1.json', permissionMode: 'manual', model: 'haiku', effort: null };
  assert.deepEqual(buildStartArgs(o), ['--session-id', 'u1', '--no-chrome', '--permission-mode', 'manual', '--settings', 'C:/d/sessions/u1.json', '--model', 'haiku']);
  assert.deepEqual(buildResumeArgv(o), ['claude', '--resume', 'u1', '--no-chrome', '--permission-mode', 'manual', '--settings', 'C:/d/sessions/u1.json', '--model', 'haiku']);
});

test('B3 1번: 설정 파일에 토큰과 세션을 값으로 쓴다(env 보간 없음)', () => {
  const d = tmp();
  const p = writeSessionSettings({ file: path.join(d, 's.json'), hookUrl: 'http://127.0.0.1:1/hooks/claude', token: 'tok', sessionId: 'sid' });
  assert.ok(!p.includes('\\'));
  const j = JSON.parse(fs.readFileSync(path.join(d, 's.json'), 'utf8'));
  const h = j.hooks.Stop[0].hooks[0];
  assert.equal(h.headers.Authorization, 'Bearer tok');
  assert.equal(h.headers['X-MT-Session'], 'sid');
  assert.equal(h.timeout, 2);
  assert.equal(h.allowedEnvVars, undefined);
  assert.equal(j.hooks.SessionStart, undefined);
});

test('대화 기록 경로', () => {
  assert.equal(path.basename(path.dirname(transcriptPathFor('P', 'C:\\Workspace\\multitask', 'x'))), 'C--Workspace-multitask');
});

test('3절: 시작 → ready → working → 권한 waiting → 거부(hook 없음)로 풀림', () => {
  const rt = newRuntime({ now: 0 });
  assert.equal(deriveState(rt).state, 'starting');
  applyTermStatus(rt, 'unknown', 1);
  assert.equal(deriveState(rt).state, 'starting');
  rt.term.present = true;
  applyTermStatus(rt, 'idle', 2, { launchPending: false, agentSessionId: 's' });
  assert.equal(deriveState(rt).state, 'ready');
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: 'hi' }, 3);
  applyTermStatus(rt, 'working', 4);
  assert.equal(deriveState(rt).state, 'working');
  applyHook(rt, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_use_id: 't1', tool_input: { file_path: 'C:/a.txt' } }, 5);
  applyHook(rt, { hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { file_path: 'C:/a.txt' } }, 6);
  const w = deriveState(rt);
  assert.equal(w.state, 'waiting');
  assert.equal(w.estimate, 'hook waiting, term working'); // hook이 herdr보다 먼저 온다
  assert.equal(w.ask.summary, 'Write: C:/a.txt');
  assert.equal(w.ask.toolUseId, 't1');
  applyTermStatus(rt, 'blocked', 7);
  assert.equal(deriveState(rt).estimate, undefined);
  applyTermStatus(rt, 'idle', 8); // esc 거부: PostToolUse 없이 풀린다(E9)
  assert.equal(deriveState(rt).state, 'ready');
  assert.equal(rt.lastAskResolved.resolvedBy, 'term:idle');
});

test('3절: blocked + hook 없음 + launch_pending은 trust_wait, 아니면 알 수 없는 대화상자', () => {
  const rt = newRuntime({ trustPredicted: true });
  rt.term.present = true;
  applyTermStatus(rt, 'blocked', 1);
  assert.equal(deriveState(rt).state, 'trust_wait');
  // 신뢰 대화상자에서 esc → hook 없이 해제 → 신뢰하지 않아 끝남
  applyAgentReleased(rt, 2);
  assert.equal(deriveState(rt).state, 'exited');
  assert.equal(rt.exit.kind, 'trust_declined');
  applyTermStatus(rt, 'idle', 3); // 해제 뒤에 오는 idle로 되살아나지 않는다
  assert.equal(deriveState(rt).state, 'exited');

  const rt2 = newRuntime();
  rt2.term.present = true;
  applyTermStatus(rt2, 'idle', 1, { launchPending: false, agentSessionId: 'x' });
  applyHook(rt2, { hook_event_name: 'Stop', last_assistant_message: 'ok' }, 2);
  applyTermStatus(rt2, 'blocked', 3);
  assert.equal(deriveState(rt2).state, 'waiting');
  assert.equal(deriveState(rt2).ask.kind, 'unknown_dialog');
});

test('3절: 질문은 hook에서 선택지를 읽고, Stop은 마지막 답, StopFailure는 error', () => {
  const rt = newRuntime();
  rt.term.present = true;
  applyTermStatus(rt, 'working', 1);
  applyHook(rt, { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'q1', tool_input: { questions: [{ question: 'Which?', options: [{ label: 'Red' }, { label: 'Blue' }] }] } }, 2);
  applyTermStatus(rt, 'blocked', 3);
  assert.deepEqual(deriveState(rt).ask.questions, [{ question: 'Which?', header: undefined, multiSelect: false, options: ['Red', 'Blue'] }]);
  applyHook(rt, { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'q1' }, 4);
  assert.equal(rt.pendingAsk, null);
  applyHook(rt, { hook_event_name: 'StopFailure', error: 'rate_limit' }, 5);
  applyTermStatus(rt, 'idle', 6);
  assert.equal(deriveState(rt).state, 'error');
  assert.equal(deriveState(rt).error.type, 'rate_limit');
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: 'again' }, 7);
  applyHook(rt, { hook_event_name: 'Stop', last_assistant_message: 'done!' }, 8);
  assert.equal(deriveState(rt).state, 'ready');
  assert.equal(rt.lastAnswer, 'done!');
  assert.equal(flags(rt, { seenAt: null }).unseen, true);
  assert.equal(flags(rt, { seenAt: 9 }).unseen, false);
  applyHook(rt, { hook_event_name: 'SubagentStop' }, 10);
  assert.equal(deriveState(rt).state, 'ready');
});

test('C3: herdr가 꺼지면 진행 중 턴을 끊긴 턴으로 남기고, 다시 찾으면 starting', () => {
  const rt = newRuntime();
  rt.term.present = true;
  applyTermStatus(rt, 'idle', 1, { launchPending: false, agentSessionId: 'x' });
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: 'long job' }, 2);
  applyTermStatus(rt, 'working', 3);
  applyHook(rt, { hook_event_name: 'SessionEnd', reason: 'other' }, 4);
  applyTermDisconnected(rt, 5);
  assert.equal(deriveState(rt).state, 'exited');
  assert.equal(rt.exit.kind, 'terminal_stopped');
  assert.equal(rt.interruptedTurn.state, 'working');
  applyAgentDetected(rt, 6);
  assert.equal(deriveState(rt).state, 'starting');
  applyTermStatus(rt, 'unknown', 7);
  assert.equal(deriveState(rt).state, 'starting');
  applyTermStatus(rt, 'idle', 8);
  assert.equal(deriveState(rt).state, 'ready');
});

test('3절: /exit 정상 종료(판이 보냄), 사람이 친 /exit·Ctrl+C 두 번은 직접 종료(P125)', () => {
  const rt = newRuntime();
  rt.term.present = true;
  applyTermStatus(rt, 'idle', 1, { launchPending: false, agentSessionId: 'x' });
  rt.exitRequested = true; // 판이 /exit를 보냈다
  applyHook(rt, { hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }, 2);
  applyAgentReleased(rt, 3);
  assert.equal(rt.exit.kind, 'normal');
  const rt2 = newRuntime();
  rt2.term.present = true;
  applyTermStatus(rt2, 'idle', 1, { launchPending: false, agentSessionId: 'x' });
  applyHook(rt2, { hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }, 2);
  applyAgentReleased(rt2, 3);
  assert.equal(rt2.exit.kind, 'user');
});

test('B1: 보낼 수 있는지와 기다리는 이유', () => {
  const cfg = { inputQuietMs: 3000 };
  const v = { state: 'ready', agentPresent: true, termConnected: true, closed: false };
  assert.equal(blockReason(v, 10000, cfg), null);
  assert.equal(blockReason({ ...v, state: 'waiting' }, 0, cfg), 'waiting');
  assert.equal(blockReason({ ...v, state: 'trust_wait' }, 0, cfg), 'trust_wait');
  assert.equal(blockReason({ ...v, state: 'starting' }, 0, cfg), 'starting');
  assert.equal(blockReason({ ...v, agentPresent: false }, 0, cfg), 'no_agent');
  assert.equal(blockReason({ ...v, lastUserInputAt: 9000 }, 10000, cfg), 'user_typing');
  assert.equal(blockReason({ ...v, lastUserInputAt: 5000 }, 10000, cfg), null);
});

test('B1: 막혀 있으면 기다렸다가 풀리면 보내고, UserPromptSubmit으로 확인한다', async () => {
  const store = new Store(path.join(tmp(), 'b.db'));
  const view = { state: 'waiting', agentPresent: true, termConnected: true, closed: false };
  const sent = [];
  const events = [];
  const q = new DeliveryQueue({ store, cfg: { inputQuietMs: 3000, deliveryMaxWaitMs: 60000, submitConfirmMs: 30000 }, view: () => view, send: async (sid, text) => { sent.push([sid, text]); } });
  q.on('delivery', (d) => events.push(`${d.status}${d.reason ? ':' + d.reason : ''}`));
  const d = q.enqueue('s1', 'hello\r\nworld');
  q.pump();
  assert.equal(sent.length, 0);
  view.state = 'ready';
  q.pump();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, [['s1', 'hello\nworld']]);
  assert.equal(q.onUserPromptSubmit('s1', 'something else'), null);
  assert.ok(q.onUserPromptSubmit('s1', 'hello\nworld'));
  assert.deepEqual(events, ['queued', 'queued:waiting', 'sending', 'sent', 'confirmed']);
  assert.equal(store.getDelivery(d.deliveryId).status, 'confirmed');
  // agent_blocked 오류는 대기열로 돌아간다
  const q2 = new DeliveryQueue({ store, cfg: { inputQuietMs: 0, deliveryMaxWaitMs: 60000, submitConfirmMs: 30000 }, view: () => ({ ...view, state: 'ready' }), send: async () => { throw Object.assign(new Error('blocked'), { code: 'agent_blocked' }); } });
  const d2 = q2.enqueue('s2', 'x');
  q2.pump();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(d2.status, 'queued');
  assert.equal(d2.reason, 'waiting');
  q2.cancel(d2.deliveryId);
  assert.equal(store.getDelivery(d2.deliveryId).status, 'cancelled');
  store.close();
});

test('E9: 권한 요청 선택지를 화면에서 읽는다', () => {
  const screen = ` Do you want to create e9-a.txt?
 ❯ 1. Yes
   2. Yes, and switch to accept edits (auto-approve file edits and common file
      commands) for this session (shift+tab)
   3. No

 Esc to cancel · Tab to amend`;
  const c = parseChoices(screen);
  assert.equal(c.length, 3);
  assert.deepEqual(c[0], { n: 1, label: 'Yes', selected: true });
  assert.equal(c[1].label, 'Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)');
  assert.equal(c[2].label, 'No');
  assert.ok(isTrustDialog('Quick safety check: Is this a project...\n ❯ No, exit\n   Yes, I trust this folder'));
});

test('대화 기록 읽기와 C2 보정', () => {
  const f = path.join(tmp(), 't.jsonl');
  const lines = [
    { type: 'user', message: { content: 'first' }, timestamp: '2026-10-29T00:00:00Z' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'one' }, { type: 'tool_use', name: 'Write', id: 'x', input: { file_path: 'a' } }] }, timestamp: '2026-10-29T00:00:01Z' },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } },
    { type: 'user', message: { content: '\n\n<pasted_content id="abcd">\nA\nB\nC\nD\n</pasted_content id="abcd">\n' }, timestamp: '2026-10-29T00:00:05Z' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'two' }] }, timestamp: '2026-10-29T00:00:06Z' },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'side' }] } },
  ];
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = readMessages(f);
  assert.deepEqual(r.messages.map((m) => m.role), ['user', 'assistant', 'tool_use', 'tool_result', 'user', 'assistant']);
  assert.equal(r.messages[4].text.trim(), 'A\nB\nC\nD');
  assert.equal(readMessages(f, { afterSeq: 2 }).messages.length, 2);
  const x = lastExchange(f);
  assert.equal(x.lastAnswer, 'two');
  assert.equal(x.lastAnswerAt, Date.parse('2026-10-29T00:00:06Z'));
});

test('설정: dev 프로필은 실제 판과 겹치지 않는다', () => {
  const real = loadConfig({ argv: [], env: { LOCALAPPDATA: 'C:\\L' } });
  const dev = loadConfig({ argv: ['--dev'], env: {} });
  assert.equal(real.terminalSession, 'atrium');
  assert.notEqual(dev.terminalSession, real.terminalSession);
  assert.notEqual(dev.port, real.port);
  assert.notEqual(dev.dataDir, real.dataDir);
  assert.throws(() => loadConfig({ argv: ['--dev'], env: { ATRIUM_HERDR_SESSION: 'atrium' } }));
  assert.throws(() => loadConfig({ argv: ['--dev'], env: { MTASK_HERDR_SESSION: 'multitask' } })); // 옛 실제 판도 막는다
});

test('P18 환경 변수: ATRIUM_*가 본 이름, 옛 MTASK_*도 받고 둘 다 있으면 ATRIUM_*', () => {
  assert.equal(loadConfig({ argv: ['--dev'], env: { MTASK_PORT: '47901' } }).port, 47901);
  assert.equal(loadConfig({ argv: ['--dev'], env: { ATRIUM_PORT: '47902' } }).port, 47902);
  assert.equal(loadConfig({ argv: ['--dev'], env: { ATRIUM_PORT: '47902', MTASK_PORT: '47901' } }).port, 47902);
  assert.equal(loadConfig({ argv: [], env: { MTASK_PROFILE: 'dev' } }).profile, 'dev');
  assert.equal(loadConfig({ argv: ['--dev'], env: { ATRIUM_TEST_PREFIX: '', MTASK_TEST_PREFIX: 'x-' } }).testPrefix, '');
});

test('깨끗한 환경: 부모 Claude Code 표시 변수를 뺀다', () => {
  const e = cleanEnv({ PATH: 'p', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_PID: '3', CLAUDE_EFFORT: 'high', HERDR_PANE_ID: 'x', MTASK_PORT: '1', ATRIUM_PORT: '2', ANTHROPIC_X: 'keep' });
  assert.deepEqual(e, { PATH: 'p', ANTHROPIC_X: 'keep' });
});

test('P1: git 저장소 안이면 저장소 루트보다 위의 신뢰는 보지 않는다', () => {
  const projects = { 'C:/Workspace/multitask': { hasTrustDialogAccepted: true } };
  // 따로 git init한 하위 폴더: 대화상자가 떴다
  assert.equal(predictTrustFrom('C:/Workspace/multitask/backend/.dev/proj', projects, 'C:/Workspace/multitask/backend/.dev/proj').needsTrust, true);
  // multitask 저장소 안의 폴더: 루트가 신뢰돼 있어 뜨지 않았다(E10의 experiments/proj)
  assert.equal(predictTrustFrom('C:/Workspace/multitask/experiments/proj', projects, 'C:/Workspace/multitask').needsTrust, false);
});

// A1 답하기(P2): 승인 카드의 답 → 키 순서(E9)
const WRITE_ASK = { kind: 'permission', tool: 'Write', toolUseId: 't1', since: 1, choices: [{ n: 1, label: 'Yes' }, { n: 2, label: 'Yes, and switch to accept edits' }, { n: 3, label: 'No' }] };
const keysOf = (p) => p.steps.map((s) => (s.keys ? s.keys.join('+') : `text:${s.text}`));

test('A1: 권한 승인은 숫자, 거부는 번호와 상관없이 esc, 덧붙이기는 tab·글·enter', () => {
  assert.deepEqual(keysOf(planAnswer(WRITE_ASK, { choice: 1 })), ['1']);
  assert.deepEqual(keysOf(planAnswer(WRITE_ASK, { choice: 2 })), ['2']);
  assert.deepEqual(keysOf(planAnswer(WRITE_ASK, { choice: 3 })), ['esc']); // "No"를 골라도 esc
  assert.deepEqual(keysOf(planAnswer(WRITE_ASK, { choice: 'reject' })), ['esc']);
  assert.deepEqual(keysOf(planAnswer(WRITE_ASK, { choice: 'amend', text: 'also\r\nsay hi' })), ['tab', 'text:also say hi', 'enter']); // 글에 CR을 넣지 않는다
  assert.throws(() => planAnswer(WRITE_ASK, { choice: 4 }), { code: 'bad_request' });
  // 화면에서 선택지를 아직 못 읽었으면 1번만 받는다
  const noChoices = { ...WRITE_ASK, choices: null };
  assert.deepEqual(keysOf(planAnswer(noChoices, { choice: 1 })), ['1']);
  assert.throws(() => planAnswer(noChoices, { choice: 2 }), { code: 'bad_request' });
});

test('A1: 질문은 번호(바로 제출), 자유 입력, 취소. 대화로 이어지는 선택지는 터미널로', () => {
  const q = { kind: 'question', tool: 'AskUserQuestion', toolUseId: 'q1', questions: [{ question: 'Which color?', multiSelect: false, options: ['Red', 'Green', 'Blue'] }] };
  assert.deepEqual(keysOf(planAnswer(q, { choice: 2 })), ['2']);
  assert.equal(planAnswer(q, { choice: 2 }).label, '2. Green');
  assert.deepEqual(keysOf(planAnswer(q, { choice: 4, text: 'Purple 보라색' })), ['4', 'text:Purple 보라색', 'enter']);
  assert.throws(() => planAnswer(q, { choice: 4, text: '  ' }), { code: 'bad_request' });
  assert.throws(() => planAnswer(q, { choice: 5 }), { code: 'answer_in_terminal' }); // Chat about this
  assert.deepEqual(keysOf(planAnswer(q, { choice: 'reject' })), ['esc']);
  const multi = { ...q, questions: [{ question: 'Which fruits?', multiSelect: true, options: ['Apple', 'Banana', 'Cherry'] }] };
  assert.deepEqual(keysOf(planAnswer(multi, { picks: [1, 3] })), ['1+3', 'down+down+down+down', 'enter', 'enter']);
  const two = { ...q, questions: [q.questions[0], { question: 'Which size?', multiSelect: false, options: ['Small', 'Large'] }] };
  assert.deepEqual(keysOf(planAnswer(two, { picks: [2, 1] })), ['2+1', 'enter']);
  assert.throws(() => planAnswer(two, { picks: [2] }), { code: 'bad_request' });
});

test('A1: 계획 승인은 번호, 알 수 없는 대화상자와 신뢰 대화상자는 카드에서 답하지 않는다', () => {
  const plan = { kind: 'plan', tool: 'ExitPlanMode', choices: [{ n: 1, label: 'Yes, and use auto mode' }, { n: 2, label: 'Yes, manually approve edits' }, { n: 3, label: 'Tell Claude what to change' }] };
  assert.deepEqual(keysOf(planAnswer(plan, { choice: 2 })), ['2']);
  assert.throws(() => planAnswer(plan, { choice: 3 }), { code: 'answer_in_terminal' });
  assert.throws(() => planAnswer({ kind: 'unknown_dialog' }, { choice: 1 }), { code: 'answer_in_terminal' });
  assert.throws(() => planAnswer(null, { choice: 1 }), { code: 'no_pending_ask' });
});

test('A1: 보내기 전 확인 — 카드의 요청이 지금 요청인지, 허용한 키만', () => {
  assert.ok(sameAsk(WRITE_ASK, { toolUseId: 't1' }));
  assert.ok(!sameAsk(WRITE_ASK, { toolUseId: 't2' }));
  assert.ok(sameAsk({ ...WRITE_ASK, toolUseId: null }, { since: 1 }));
  assert.ok(!sameAsk({ ...WRITE_ASK, toolUseId: null }, { since: 2 }));
  assert.ok(!sameAsk(null, { toolUseId: 't1' }));
  assert.throws(() => checkSteps([{ keys: ['ctrl+g'] }]), { code: 'bad_request' });
  assert.doesNotThrow(() => checkSteps([{ keys: ['1', 'esc', 'down', 'enter', 'tab'] }, { text: 'x' }]));
});
