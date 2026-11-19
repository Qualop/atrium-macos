// P119: 판이 닫는 워크트리 세션의 헛 응답 필요, 작업 완료는 맨 위 세션만
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorktreeExit } from '../src/screen.mjs';
import { newRuntime, deriveState, applyAgentReleased, boardClosing } from '../src/state.mjs';
import { waitClaudeExit, beginBoardExit, endBoardExit } from '../src/worktree-exit.mjs';
import { pushKindOf } from '../src/web-push.mjs';
import { categoryOf } from '../src/mission.mjs';
import { workspaceCounts } from '../src/workspaces.mjs';
import { Backend } from '../src/backend.mjs';

const SCREEN = [
  '> /exit', '', ' Exiting worktree session',
  ' You have 2 commits on worktree-w1. The branch will be deleted if you', ' remove the worktree.', '',
  ' ❯ 1. Keep worktree', '      Stays at C:\\repo\\.claude\\worktrees\\w1', '   2. Remove worktree', '      Commits only on worktree-w1 will be lost.', '',
  ' Enter to confirm · Esc to cancel',
].join('\n');
const OTHER = ['> /exit', '', ' Something else is asking', ' ❯ 1. Yes', '   2. No', '', ' Enter to confirm'].join('\n');

// 가짜 판: /exit를 받으면 herdr가 blocked가 되고 화면에 dialog가 뜬다(checkBlocked처럼 나가기 질문을 읽어 둔다).
// 번호를 받으면 claude가 끝난다. 상태가 바뀔 때마다(broadcastSession) 요약 상태를 남긴다
function fakeB(dialog = SCREEN, { answerEnds = true } = {}) {
  const calls = [], states = [];
  let shown = '';
  const s = { sessionId: 's1', name: 'w1', kind: 'claude', paneId: 'p1', agentName: 'w1', termWorkspaceId: 'ws1', cwd: 'C:/r/.claude/worktrees/w1', rt: newRuntime({ hooked: true }) };
  s.rt.term.present = true; s.rt.term.status = 'idle'; s.rt.phase = 'running'; s.rt.term.launchPending = false; s.rt.hooksSinceLaunch = 3;
  const b = {
    cfg: { killWaitMs: 3000 }, killing: new Set(), sessions: new Map([['s1', s]]),
    store: { addEvent: () => {} },
    branch: { info: new Map() },
    resolve: () => s,
    requireTerminal: () => {},
    closeSession: (x, why) => calls.push(['closeSession', why]),
    recall: { markArchive: () => {} },
    broadcastSession: (x) => states.push(deriveState(x.rt).state),
    noteWorktreeExit: Backend.prototype.noteWorktreeExit,
    killSession: Backend.prototype.killSession, // macOS 판: kill은 같은 세션의 겹친 종료를 하나로 묶고 실제 끄기는 killSession이 한다
    currentSession: Backend.prototype.currentSession, samePane: Backend.prototype.samePane, // macOS 판: 끄는 동안 같은 세션·패널인지 다시 본다
    adapter: {
      workspacePanes: async () => [],
      readScreen: async () => shown,
      sendText: async (p, t) => {
        calls.push(['text', t]);
        if (t === '/exit') setTimeout(() => { shown = dialog; s.rt.term.status = 'blocked'; b.noteWorktreeExit(s, shown); b.broadcastSession(s); }, 30);
      },
      paneKeys: async (p, k) => { calls.push(['keys', k.join('+')]); if (/^\d$/.test(k[0]) && answerEnds) setTimeout(() => { shown = ''; applyAgentReleased(s.rt); b.broadcastSession(s); }, 20); },
      sendKeys: async () => {},
      closeWorkspace: async () => calls.push(['closeWorkspace']),
      closePane: async () => calls.push(['closePane']), // macOS 판: 형제 패널을 지키려고 이 세션의 패널만 닫는다(ARCH D2)
    },
  };
  return { b, s, calls, states, show: (t) => { shown = t; } };
}
// 흐름 동안 상태를 자주 본다(브로드캐스트 사이도)
function sampler(s) {
  const seen = new Set();
  const iv = setInterval(() => seen.add(deriveState(s.rt).state), 5);
  return { seen, stop: () => clearInterval(iv) };
}

test('P119 닫기: 판이 답하는 워크트리 나가기 질문은 응답 필요가 아니다(알림·목록·푸시·트레이가 보는 상태)', async () => {
  const { b, s, calls, states } = fakeB();
  const sm = sampler(s);
  const r = await Backend.prototype.kill.call(b, { session: 's1', confirm: true });
  sm.stop();
  assert.equal(r.closed, true);
  assert.deepEqual(calls.filter((c) => c[0] === 'keys').map((c) => c[1]), ['enter', '1']); // 남기기로 답했다
  assert.ok(!states.includes('waiting') && !states.includes('trust_wait'), states.join(','));
  assert.ok(!sm.seen.has('waiting'), [...sm.seen].join(','));
  assert.equal(s.rt.boardExit, undefined); // 끝나면 거둔다
});

test('P119 닫기 중 상태: ready + closing, 푸시·미션 맵·응답 필요 수에 들지 않는다', () => {
  const rt = newRuntime({ hooked: true }); rt.phase = 'running'; rt.term.present = true; rt.term.launchPending = false; rt.hooksSinceLaunch = 2;
  rt.term.status = 'blocked'; rt.worktreeExit = { ...parseWorktreeExit(SCREEN), at: 1 };
  assert.equal(deriveState(rt).state, 'waiting'); // 사람이 판 밖 터미널에서 /exit하면 지금처럼 응답 필요
  rt.boardExit = { by: 'close', at: 2 };
  const d = deriveState(rt);
  assert.equal(d.state, 'ready'); assert.equal(d.closing, 'close'); assert.equal(d.ask, undefined);
  assert.equal(boardClosing(rt), true);
  const sum = { sessionId: 's', kind: 'claude', state: d.state };
  assert.equal(pushKindOf(sum, 'ready'), null);
  assert.equal(categoryOf(sum), 'idle');
  assert.equal(workspaceCounts([{ ...sum, workspaceKey: 'k' }], 'k').needsYou, 0);
  // 판이 모르는 질문이면 사람에게 남긴다
  rt.boardExit.foreign = true;
  assert.equal(deriveState(rt).state, 'waiting');
  // 신뢰 질문은 대신 답하지 않으므로 그대로 보인다
  const t = newRuntime({ hooked: true }); t.term.status = 'blocked'; t.trustScreen = { at: 1 }; t.boardExit = { by: 'close', at: 1 };
  assert.equal(deriveState(t).state, 'trust_wait');
  // 묻는 hook(권한·질문)은 판이 답하지 않으므로 그대로
  const q = newRuntime({ hooked: true }); q.term.status = 'blocked'; q.pendingAsk = { kind: 'permission', since: 1 }; q.boardExit = { by: 'close', at: 1 };
  assert.equal(deriveState(q).state, 'waiting');
  // hook 없는 세션도 같은 규칙
  const h = newRuntime({ hooked: false }); h.term.status = 'blocked'; h.boardExit = { by: 'close', at: 1 };
  assert.equal(deriveState(h).state, 'ready');
});

test('P119 닫기: 판이 모르는 질문이 떠 있으면(나가기 질문이 아님) 사람에게 응답 필요로 남긴다', async () => {
  const { b, s, states } = fakeB(OTHER, { answerEnds: false });
  b.cfg.killWaitMs = 1500;
  const r = await Backend.prototype.kill.call(b, { session: 's1', confirm: true });
  assert.ok(r.steps.includes('unknown dialog: left to the human'), r.steps.join(' | '));
  assert.ok(states.includes('waiting'), states.join(','));
});

test('P119 다시 띄우기·잠재우기의 기다림: 이미 둔 boardExit은 그대로, 직접 둔 것만 거둔다', async () => {
  const { b, s } = fakeB();
  // 바깥(닫기)이 둔 표시를 waitClaudeExit가 지우지 않는다
  s.rt.boardExit = { by: 'close', at: 1 };
  setTimeout(() => applyAgentReleased(s.rt), 50);
  await waitClaudeExit(b, s, 1000);
  assert.deepEqual(s.rt.boardExit, { by: 'close', at: 1 });
  endBoardExit(b, s);
  assert.equal(s.rt.boardExit, undefined);
  // 직접 두면 끝에 거둔다
  const { b: b2, s: s2 } = fakeB();
  setTimeout(() => applyAgentReleased(s2.rt), 50);
  await waitClaudeExit(b2, s2, 1000, { by: 'restart' });
  assert.equal(s2.rt.boardExit, undefined);
  // 이미 떠 있는 질문은 표시를 둘 때 바로 다시 보낸다
  const { b: b3, s: s3, states } = fakeB();
  s3.rt.term.status = 'blocked'; s3.rt.worktreeExit = { ...parseWorktreeExit(SCREEN), at: 1 };
  assert.equal(beginBoardExit(b3, s3, 'close'), true);
  assert.deepEqual(states, ['ready']);
  assert.equal(beginBoardExit(b3, s3, 'close'), false);
  endBoardExit(b3, s3); // 닫히지 않고 남았으면 사람에게 보인다
  assert.deepEqual(states, ['ready', 'waiting']);
});

test('P119 작업 완료는 맨 위 세션만: 살아 있는 부모(잠든 부모 포함)가 있으면 빠지고, 부모가 닫히면 들어간다', () => {
  const ds = (sessions, s, unseen = true) => Backend.prototype.doneScope.call({ sessions, workParentOf: Backend.prototype.workParentOf }, s, { unseen });
  const parent = { sessionId: 'p', rt: { sleep: { at: 1 } } };
  const child = { sessionId: 'c', parentSessionId: 'p' };
  const sessions = new Map([['p', parent], ['c', child]]);
  assert.deepEqual(ds(sessions, child), { unseen: false, unseenSub: true });
  assert.deepEqual(ds(sessions, parent), { unseen: true, unseenSub: false });
  assert.deepEqual(ds(sessions, child, false), { unseen: false, unseenSub: false });
  sessions.delete('p'); // 부모가 닫힘
  assert.deepEqual(ds(sessions, child), { unseen: true, unseenSub: false });
  // 부모 없는 세션, 스스로를 부모로 가리키는 이상한 기록
  assert.deepEqual(ds(new Map(), { sessionId: 'x' }), { unseen: true, unseenSub: false });
  assert.deepEqual(ds(new Map([['y', {}]]), { sessionId: 'y', parentSessionId: 'y' }), { unseen: true, unseenSub: false });
  // 하위 세션의 응답 필요·오류는 그대로(작업 완료만 뺀다): 미션 맵 분류는 상태가 먼저다
  assert.equal(categoryOf({ state: 'waiting', unseen: false }), 'needs_you');
  assert.equal(categoryOf({ state: 'error', unseen: false }), 'needs_you');
  assert.equal(categoryOf({ state: 'ready', unseen: false, unseenSub: true }), 'idle');
});

test('P119 부모가 닫히면 하위 세션 요약을 다시 보낸다', () => {
  const sent = [];
  const child = { sessionId: 'c', parentSessionId: 'p', rt: {} };
  const other = { sessionId: 'o', rt: {} };
  const parent = { sessionId: 'p', name: 'p', rt: { boardExit: { by: 'close' } } };
  const b = {
    sessions: new Map([['p', parent], ['c', child], ['o', other]]),
    queue: { cancelSession: () => {} }, relay: { detach: () => {} }, cfg: { sessionsDir: 'nowhere' },
    store: { docks: () => [], links: () => [], updateSession: (id, v) => { assert.equal(v.runtime.boardExit, undefined); }, addEvent: () => {} },
    api: { broadcast: () => {} }, bus: { emit: () => {} }, adapter: { refreshSubscription: () => {} },
    broadcastSession: (x, o) => sent.push([x.sessionId, o && o.onlyIfFlagsChanged]), workParentOf: Backend.prototype.workParentOf,
  };
  Backend.prototype.closeSession.call(b, parent, 'killed');
  assert.deepEqual(sent, [['c', true]]);
});
