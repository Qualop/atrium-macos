// P71 단위 시험(백엔드): 워크트리 나가기 질문 알아보기(커밋 수 읽기 포함), 승인 줄의 답, 닫기에서 고른 답, 손으로 하는 버전 되돌리기가 없어진 것
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseWorktreeExit, parseChoices } from '../src/screen.mjs';
import { newRuntime, deriveState, applyHerdrStatus, applyAgentReleased, worktreeExitAsk } from '../src/state.mjs';
import { planAnswer } from '../src/answer.mjs';
import { worktreeOf, waitClaudeExit, answerWorktreeExitOnScreen } from '../src/worktree-exit.mjs';
import { summarizeChanges } from '../src/changes.mjs';
import { Backend } from '../src/backend.mjs';
import * as U from '../src/update.mjs';
import { Updater } from '../src/updater.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p71-'));

// Claude Code 2.1.x의 워크트리 나가기 질문(화면 폭 80에서 꺾인 문장)
const SCREEN = [
  '> /exit',
  '',
  ' Exiting worktree session',
  ' You have 13 commits on worktree-p9. The branch will be deleted if you',
  ' remove the worktree.',
  '',
  ' ❯ 1. Keep worktree',
  '      Stays at C:\\repo\\.claude\\worktrees\\p9',
  '   2. Remove worktree',
  '      Commits only on worktree-p9 will be lost.',
  '',
  ' Enter to confirm · Esc to cancel',
].join('\n');

test('워크트리 나가기 질문: 제목, 선택지 번호, 커밋 수, 브랜치를 읽는다', () => {
  const w = parseWorktreeExit(SCREEN);
  assert.equal(w.commits, 13);
  assert.equal(w.files, 0);
  assert.equal(w.branch, 'worktree-p9');
  assert.deepEqual(w.keep, { n: 1, label: 'Keep worktree' });
  assert.deepEqual(w.remove, { n: 2, label: 'Remove worktree' });
  // 커밋 하나, 커밋하지 않은 파일, 같은 줄의 설명, 테두리
  const one = parseWorktreeExit('│ Exiting worktree session │\n│ You have 2 uncommitted files and 1 commit on worktree-a. All will be lost if you remove. │\n│ ❯ 1. Keep worktree    Stays at C:\\x │\n│   2. Remove worktree    All changes and commits will be lost. │');
  assert.equal(one.commits, 1); assert.equal(one.files, 2); assert.equal(one.branch, 'worktree-a');
  assert.equal(one.keep.label, 'Keep worktree'); assert.equal(one.remove.label, 'Remove worktree');
  // 커밋을 셀 수 없을 때(null)와 커밋하지 않은 파일만 있을 때
  const unk = parseWorktreeExit(' Exiting worktree session\n The branch worktree-b may hold unpushed commits (commit baseline unavailable). The branch will be deleted if you remove.\n ❯ 1. Keep worktree\n   2. Remove worktree');
  assert.equal(unk.commits, null); assert.equal(unk.branch, 'worktree-b');
  const files = parseWorktreeExit(' Exiting worktree session\n You have 3 uncommitted files. These will be lost if you remove the worktree.\n ❯ 1. Keep worktree\n   2. Remove worktree');
  assert.equal(files.commits, null); assert.equal(files.files, 3); // "uncommitted"는 커밋 수가 아니다
  // tmux가 있는 꼴: 남기기·지우기의 번호를 글로 찾는다
  const tmux = parseWorktreeExit(' Exiting worktree session\n You have 4 commits on worktree-c. The branch will be deleted if you remove the worktree.\n ❯ 1. Keep worktree and tmux session\n   2. Keep worktree, end tmux session\n   3. Remove worktree and tmux session');
  assert.equal(tmux.keep.n, 1); assert.equal(tmux.remove.n, 3); assert.equal(tmux.commits, 4);
  // 낮은 패널: Claude Code 2.1.319는 고른 선택지 하나만 보인다(P71 개발용 판에서 읽은 화면, 경로만 바꿈). 보이지 않는 지우기는 2번으로 정한다
  const low = parseWorktreeExit([
    '   Exiting worktree session',
    '   You have 1 commit on worktree-w1. The branch will be deleted if you remove the',
    '   worktree.',
    '',
    '   ❯ 1. Keep worktree    Stays at C:\\repo\\.claude\\worktrees\\w1',
    '',
    '   Enter to confirm · Esc to cancel',
  ].join('\n'));
  assert.deepEqual(low.keep, { n: 1, label: 'Keep worktree' });
  assert.deepEqual(low.remove, { n: 2, label: 'Remove worktree', hidden: true });
  assert.equal(low.commits, 1); assert.equal(low.branch, 'worktree-w1');
  const lowRemove = parseWorktreeExit(' Exiting worktree session\n You have 2 commits on worktree-w1. The branch will be deleted if you remove the worktree.\n ❯ 2. Remove worktree    Commits only on worktree-w1 will be lost.');
  assert.deepEqual(lowRemove.keep, { n: 1, label: 'Keep worktree', hidden: true }); assert.equal(lowRemove.remove.n, 2);
  // 다른 화면은 아니다
  assert.equal(parseWorktreeExit(' Do you want to create x.txt?\n ❯ 1. Yes\n   2. No'), null);
  assert.equal(parseWorktreeExit(' Exiting worktree session\n Keeping worktree…'), null); // 선택지가 아직 없다
  assert.equal(parseWorktreeExit(''), null);
  // 권한 선택지 읽기는 설명 줄을 이어 붙이므로 이 질문에는 쓰지 않는다
  assert.match(parseChoices(SCREEN)[0].label, /Stays at/);
});

test('상태: herdr blocked에 화면에서 읽은 질문이면 waiting(worktree_exit), 풀리면 지운다', () => {
  const rt = newRuntime({ hooked: true });
  rt.phase = 'running'; rt.herdr.present = true; rt.herdr.launchPending = false; rt.herdr.agentSessionId = 'a1'; rt.hooksSinceLaunch = 3;
  applyHerdrStatus(rt, 'blocked', 1000);
  assert.deepEqual(deriveState(rt).ask, { kind: 'unknown_dialog' }); // 읽기 전(지금까지의 모양)
  rt.worktreeExit = { ...parseWorktreeExit(SCREEN), at: 1500 };
  const d = deriveState(rt);
  assert.equal(d.state, 'waiting');
  assert.deepEqual(d.ask, { kind: 'worktree_exit', commits: 13, files: 0, branch: 'worktree-p9', keep: { n: 1, label: 'Keep worktree' }, remove: { n: 2, label: 'Remove worktree' }, since: 1500 });
  applyHerdrStatus(rt, 'idle', 2000);
  assert.equal(rt.worktreeExit, null);
  rt.worktreeExit = { ...parseWorktreeExit(SCREEN), at: 2500 };
  applyAgentReleased(rt, 3000);
  assert.equal(rt.worktreeExit, null);
  // hook이 없는 claude 세션도 같은 질문으로 본다
  const raw = newRuntime({ hooked: false, kind: 'claude' });
  raw.herdr.present = true; applyHerdrStatus(raw, 'blocked', 1000);
  raw.worktreeExit = { ...parseWorktreeExit(SCREEN), at: 1000 };
  assert.equal(deriveState(raw).ask.kind, 'worktree_exit');
});

test('승인 줄의 답: 남기기는 그 번호, 지우기는 confirm이 있어야 그 번호', () => {
  const ask = worktreeExitAsk({ ...parseWorktreeExit(SCREEN), at: 1 });
  assert.deepEqual(planAnswer(ask, { choice: 'keep' }).steps, [{ keys: ['1'] }]);
  assert.throws(() => planAnswer(ask, { choice: 'remove' }), (e) => e.code === 'needs_confirm');
  assert.deepEqual(planAnswer(ask, { choice: 'remove', confirm: true }).steps, [{ keys: ['2'] }]);
  assert.throws(() => planAnswer(ask, { choice: 1 }), (e) => e.code === 'bad_request');
});

test('복귀 요약: 워크트리 질문은 그 열쇠로 보인다', () => {
  const ask = worktreeExitAsk({ ...parseWorktreeExit(SCREEN), at: 1 });
  const out = summarizeChanges([{ id: 1, at: 10, sessionId: 's1', kind: 'state', data: { from: 'working', to: 'waiting', ask } }], { nameOf: () => 'w1', current: new Map([['s1', { state: 'waiting', ask }]]) });
  const line = out.lines ? out.lines[0] : out[0];
  assert.ok(line, JSON.stringify(out));

  assert.equal(line.msg.key, 'chgWorktreeExit');
});

test('워크트리 세션 알아보기: 하위 세션의 --worktree 또는 .claude/worktrees 안의 폴더', () => {
  assert.deepEqual(worktreeOf({ kind: 'claude', rt: {}, cwd: 'C:/r' }, { worktree: 'p9' }), { name: 'p9' });
  assert.deepEqual(worktreeOf({ kind: 'claude', rt: { cwd: 'C:\\r\\.claude\\worktrees\\p9\\backend' }, cwd: 'C:/r' }), { name: 'p9' });
  assert.equal(worktreeOf({ kind: 'claude', rt: {}, cwd: 'C:/r' }), null);
  assert.equal(worktreeOf({ kind: 'shell', rt: { cwd: 'C:/r/.claude/worktrees/p9' } }), null);
  assert.deepEqual(worktreeOf({ rt: {}, cwd: '/home/u/r/.claude/worktrees/x' }), { name: 'x' }); // kind 없음 = claude
});

// 가짜 판: 화면은 screen(), 키는 calls에 남는다. 고른 키를 받으면 claude가 끝난다
function fakeB(screenAfterExit = SCREEN) {
  const calls = [], events = [];
  let shown = '';
  const s = { sessionId: 's1', name: 'w1', kind: 'claude', paneId: 'p1', agentName: 'w1', herdrWorkspaceId: 'ws1', cwd: 'C:/r/.claude/worktrees/w1', rt: newRuntime({ hooked: true }) };
  s.rt.herdr.present = true; s.rt.herdr.status = 'idle'; s.rt.phase = 'running';
  const b = {
    cfg: { killWaitMs: 3000 }, killing: new Set(), sessions: new Map([['s1', s]]),
    currentSession: Backend.prototype.currentSession,
    killSession: Backend.prototype.killSession,
    store: { addEvent: (sid, kind, data) => events.push({ sid, kind, data }) },
    branch: { info: new Map() },
    resolve: () => s,
    requireHerdr: () => {},
    closeSession: (x, why) => calls.push(['closeSession', why]),
    recall: { markArchive: () => calls.push(['archive']) },
    adapter: {
      workspacePanes: async () => [],
      readScreen: async () => shown,
      sendText: async (p, t) => { calls.push(['text', t]); if (t === '/exit') shown = screenAfterExit; },
      paneKeys: async (p, k) => { calls.push(['keys', k.join('+')]); if (/^\d$/.test(k[0]) && shown) setTimeout(() => { shown = ''; applyAgentReleased(s.rt); }, 20); else if (k[0] === 'enter' && !screenAfterExit) setTimeout(() => applyAgentReleased(s.rt), 20); },
      sendKeys: async (n, k) => calls.push(['agentKeys', k.join('+')]),
      closePane: async (pane) => { assert.equal(pane, 'p1'); calls.push(['closePane', pane]); },
      closeWorkspace: async () => assert.fail('worktree exit must preserve sibling panes'),
    },
  };
  return { b, s, calls, events, show: (t) => { shown = t; } };
}

test('닫기: 확인에 워크트리를 알리고, 고르지 않으면 남기기, remove면 지우기 번호를 보낸다', async () => {
  const kill = (b, p) => Backend.prototype.kill.call(b, p);
  {
    const { b } = fakeB();
    const r = await kill(b, { session: 's1' });
    assert.equal(r.needsConfirm, true);
    assert.deepEqual(r.worktree, { name: 'w1' });
    assert.match(r.message, /워크트리\(w1\)는 남깁니다/);
  }
  {
    const { b, calls, events } = fakeB();
    const r = await kill(b, { session: 's1', confirm: true, after: 'archive' });
    assert.equal(r.closed, true);
    assert.deepEqual(calls.filter((c) => c[0] === 'keys').map((c) => c[1]), ['enter', '1']); // /exit의 enter, 남기기
    assert.ok(r.steps.includes('worktree exit: 1. Keep worktree'), r.steps.join(' | '));
    assert.deepEqual(calls.filter((c) => c[0] === 'closePane'), [['closePane', 'p1']]);
    assert.equal(events.find((e) => e.kind === 'worktree_exit_answered').data.choice, 'keep');
  }
  {
    const { b, calls } = fakeB();
    await kill(b, { session: 's1', confirm: true, worktree: 'remove' });
    assert.deepEqual(calls.filter((c) => c[0] === 'keys').map((c) => c[1]), ['enter', '2']);
  }
  {
    const { b } = fakeB();
    await assert.rejects(kill(b, { session: 's1', confirm: true, worktree: 'delete' }), (e) => e.code === 'bad_request');
  }
  {
    // 질문이 이미 떠 있으면 esc로 취소하지 않고 바로 답한다
    const { b, s, calls, show } = fakeB();
    show(SCREEN); s.rt.herdr.status = 'blocked'; s.rt.worktreeExit = { ...parseWorktreeExit(SCREEN), at: 1 };
    await kill(b, { session: 's1', confirm: true });
    assert.deepEqual(calls.filter((c) => c[0] !== 'closePane' && c[0] !== 'closeSession'), [['keys', '1']]);
  }
  {
    // 워크트리가 아닌 세션: 질문이 없으면 키를 더 보내지 않는다
    const { b, calls } = fakeB('');
    await kill(b, { session: 's1', confirm: true });
    assert.deepEqual(calls.filter((c) => c[0] === 'keys').map((c) => c[1]), ['enter']);
  }
});

test('끝나기 기다리기: 질문에는 한 번만 답하고, claude가 아닌 종류는 화면을 읽지 않는다', async () => {
  const { b, s, calls, show } = fakeB();
  show(SCREEN);
  const c = await answerWorktreeExitOnScreen(b, s, 'keep', 'sleep');
  assert.deepEqual(c, { n: 1, label: 'Keep worktree' });
  const { b: b2, s: s2, calls: calls2, show: show2 } = fakeB();
  s2.kind = 'codex'; show2(SCREEN);
  let reads = 0; b2.adapter.readScreen = async () => { reads++; return SCREEN; };
  setTimeout(() => applyAgentReleased(s2.rt), 300);
  await waitClaudeExit(b2, s2, 2000);
  assert.equal(reads, 0); assert.deepEqual(calls2, []);
  assert.deepEqual(calls.filter((x) => x[0] === 'keys').map((x) => x[1]), ['1']);
});

test('버전 되돌리기: 수동 API와 소스 폴더 정리는 없고 실패 시 번들 복원만 지원', () => {
  assert.equal(U.rollbackCurrent, undefined);
  const d = tmp();
  // Bundles are restored automatically after failed health checks. The
  // removed source pointer/pruning route must not reappear as a public API.
  assert.equal(U.pruneVersions, undefined);
  assert.equal(U.switchCurrent, undefined);
  // 판 API
  const store = new Map();
  const b = { cfg: { logDir: d, profile: 'dev', dataDir: d }, store: { getMeta: (k) => store.get(k), setMeta: (k, v) => store.set(k, v), addEvent: () => {} }, api: { broadcast: () => {} } };
  const up = new Updater(b, { env: { ATRIUM_INSTALL_DIR: d }, timers: false });
  assert.equal(up.handlers['update.rollback'], undefined);
  assert.ok(up.handlers['update.apply']);
  const v = up.view();
  assert.equal('previous' in v, false); assert.equal('canRollback' in v, false);
});
