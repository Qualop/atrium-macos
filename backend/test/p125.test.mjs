// P125: 사람이 스스로 끝낸 세션(사람이 닫음, exit.kind 'user')과 같은 자리에서 다시 열기(session.reopen)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newRuntime, deriveState, applyAgentReleased, applyHook, exitKind, userExitCode, applyExitCode } from '../src/state.mjs';
import { reopenSession, reopenable, userClosed, resetForReopen } from '../src/user-close.mjs';
import { pushKindOf } from '../src/web-push.mjs';
import { Backend } from '../src/backend.mjs';
import { HcAdapter } from '../src/hc/adapter.mjs';
import { startFakeHc } from './fake-hc.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(20); } throw new Error('timed out'); };

// 판이 띄워 한 턴 돈 claude(ready)
function running({ hooked = true } = {}) {
  const rt = newRuntime({ hooked, kind: hooked ? 'claude' : 'codex' });
  rt.phase = 'running'; rt.term.present = true; rt.term.status = 'idle'; rt.term.launchPending = false; rt.hooksSinceLaunch = 3;
  return rt;
}
const ended = (rt, reason) => applyHook(rt, { hook_event_name: 'SessionEnd', reason, session_id: 'x' });

test('P125 exitKind: 사람이 끝냄(user)과 오류(other)를 가른다', () => {
  // 입력 칸의 Ctrl+C 두 번·Ctrl+D·/exit는 SessionEnd prompt_input_exit(재현: hc 판 haiku, 2026-11-12)
  assert.equal(exitKind({ reason: 'prompt_input_exit' }), 'user');
  assert.equal(exitKind({ reason: 'logout' }), 'user');
  // 판이 끄라고 했으면(/exit, 끄기·잠재우기·옮기기) 지금처럼 정상 종료
  assert.equal(exitKind({ reason: 'prompt_input_exit', requested: true }), 'normal');
  // 까닭이 other: 콘솔 Ctrl+C로 끝난 종료 코드(hc)면 user, 오류 코드·모르는 코드면 other
  assert.equal(exitKind({ reason: 'other', exitCode: 0xC000013A }), 'user');
  assert.equal(exitKind({ reason: 'other', exitCode: 130 }), 'user');
  assert.equal(exitKind({ reason: 'other', exitCode: 1 }), 'other');
  assert.equal(exitKind({ reason: 'other' }), 'other'); // herdr는 코드를 주지 않는다
  // hook이 오지 않고 끝남: 코드가 사람의 끝이면 user, 충돌(코드 1, 0xC0000005)이면 other
  assert.equal(exitKind({ exitCode: 0 }), 'user');
  assert.equal(exitKind({ exitCode: 3221225477 }), 'other');
  assert.equal(exitKind({}), 'other');
  // 터미널 서버 꺼짐과 신뢰 거부는 그대로
  assert.equal(exitKind({ reason: 'prompt_input_exit', termStopping: true }), 'terminal_stopped');
  assert.equal(exitKind({ before: 'trust_wait', exitCode: 0 }), 'trust_declined');
  assert.equal(exitKind({ hooksSinceLaunch: 0, launchPending: true }), 'trust_declined');
  // hook 없는 하네스: 판이 끄라고 했으면 normal, 아니면 코드로
  assert.equal(exitKind({ hooked: false, requested: true }), 'normal');
  assert.equal(exitKind({ hooked: false, exitCode: 0 }), 'user');
  assert.equal(exitKind({ hooked: false, exitCode: 2 }), 'other');
  assert.equal(userExitCode(null), false); assert.equal(userExitCode(-1073741510), true);
});

test('P125 applyAgentReleased: Ctrl+C 두 번은 직접 종료(오류·문제·푸시 아님), 판의 /exit는 정상 종료, 충돌은 other', () => {
  const rt = running();
  ended(rt, 'prompt_input_exit');
  applyAgentReleased(rt, 1000, { exitCode: 0 });
  assert.deepEqual(rt.exit, { kind: 'user', reason: 'prompt_input_exit', at: 1000, code: 0 });
  assert.equal(deriveState(rt).state, 'exited');
  const sum = { sessionId: 's', kind: 'claude', state: 'exited', exit: rt.exit };
  assert.equal(pushKindOf(sum, 'ready'), null); // 푸시는 other만
  // 판이 /exit를 보냄(exitRequested) → normal
  const rt2 = running(); rt2.exitRequested = true; ended(rt2, 'prompt_input_exit');
  applyAgentReleased(rt2, 1);
  assert.equal(rt2.exit.kind, 'normal');
  // 판이 닫는 중(P119 boardExit) → normal
  const rt3 = running(); rt3.boardExit = { by: 'close', at: 1 }; ended(rt3, 'prompt_input_exit');
  applyAgentReleased(rt3, 1);
  assert.equal(rt3.exit.kind, 'normal');
  // hook 없이 오류 코드로 끝남 → other(문제 목록·푸시)
  const rt4 = running();
  applyAgentReleased(rt4, 1, { exitCode: 1 });
  assert.equal(rt4.exit.kind, 'other'); assert.equal(rt4.exit.code, 1);
  assert.equal(pushKindOf({ sessionId: 's', kind: 'claude', state: 'exited', exit: rt4.exit }, 'ready'), 'exit');
});

test('P125 inbox: 직접 종료는 문제 목록에 넣지 않는다', () => {
  const mk = (id, kind) => { const rt = running(); rt.exit = { kind, reason: null, at: 1 }; return { sessionId: id, name: id, kind: 'claude', rt }; };
  const b = { sessions: new Map([['a', mk('a', 'user')], ['b', mk('b', 'other')], ['c', mk('c', 'normal')]]), summary: (s) => ({ sessionId: s.sessionId, state: deriveState(s.rt).state, exit: s.rt.exit, turn: s.rt.turn, unseen: false }) };
  const r = Backend.prototype.inbox.call(b);
  assert.deepEqual(r.problems.map((x) => x.sessionId), ['b']);
});

test('P125 hc 어댑터: 판이 띄운 에이전트가 끝나면 놓임 이벤트에 종료 코드가 붙는다(0xC000013A: 콘솔 Ctrl+C)', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p125-unit', dataDir: null, pipe: fake.pipe, env: { PATH: 'C:\\Windows' }, moveWaitMs: 2000 });
  const ev = [];
  a.on('event', (e) => ev.push(e));
  try {
    a.startEvents();
    await until(() => a.connected);
    const ws = await a.createWorkspace({ cwd: 'C:/w', label: 'demo' });
    const r = await a.startAgent({ name: 'c1', paneId: ws.paneId, args: ['--session-id', 'x'], kind: 'claude', command: ['claude'], env: {} });
    await until(() => ev.find((e) => e.type === 'agent_detected' && e.paneId === r.agent.paneId));
    ev.length = 0;
    fake.finish(r.agent.paneId, 'exited', 0xC000013A);
    const rel = await until(() => ev.find((e) => e.type === 'agent_released'));
    assert.equal(rel.exitCode, 0xC000013A);
    const moved = await until(() => ev.find((e) => e.type === 'pane_moved')); // 같은 자리에 셸이 남는다(2b)
    assert.equal(moved.exitCode, 0xC000013A); // 놓임이 먼저 풀려도(300ms 보류) 판이 셸을 남길 때 코드를 받는다
  } finally { a.stopEvents(); await fake.close(); }
});

// 가짜 판: 끝난 claude 노드(같은 자리에 셸이 남음)
function fakeBoard({ paneAlive = true, transcript = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p125-'));
  const tx = path.join(dir, 'conv.jsonl');
  if (transcript) fs.writeFileSync(tx, '{}\n');
  const calls = [], events = [];
  const rt = running(); ended(rt, 'prompt_input_exit'); applyAgentReleased(rt, 5, { exitCode: 0 });
  rt.transcriptPath = tx; rt.claudeSessionId = 'sid-1';
  const s = { sessionId: 'sid-1', name: 'c1', kind: 'claude', cwd: dir, paneId: 't3', termWorkspaceId: 'w1', agentName: 'c1', settingsPath: path.join(dir, 's.json'), permissionMode: 'manual', model: 'haiku', effort: null, extraArgs: [], startCommand: '', resumeArgv: [], parentSessionId: 'lead', rt };
  const node = { x: 100, y: 200, w: 720, h: 460 };
  const links = [{ linkId: 'l1', from: 'lead', to: 'sid-1' }];
  const b = {
    cfg: { claudeProjects: dir }, plugin: {}, sessions: new Map([['sid-1', s]]),
    store: { updateSession: (id, f) => calls.push(['updateSession', id, Object.keys(f)]), addEvent: (id, type, d) => events.push([type, d]), nodeOf: () => node, links: () => links },
    requireTerminal: () => {}, hooked: (x) => x.rt.hooked !== false, log: () => {},
    launchOf: Backend.prototype.launchOf,
    broadcastSession: (x, o) => calls.push(['broadcast', deriveState(x.rt).state, o && o.cause]),
    withNewPane: async (create, reg) => { const r = await create(); reg(r); return r; },
    recall: { reopen: async (p) => { calls.push(['recall.reopen', p.session]); return { sessionId: p.session, name: 'old', resume: true }; } },
    adapter: {
      getPane: async (id) => (paneAlive && id === 't3' ? { paneId: 't3', agent: null } : null),
      waitShellReady: async () => calls.push(['waitShellReady']),
      createWorkspace: async ({ cwd, label }) => { calls.push(['createWorkspace', label]); return { paneId: 't9', workspaceId: 'w9' }; },
      refreshSubscription: async () => {},
      startAgent: async (o) => { calls.push(['startAgent', o.paneId, o.name, o.args]); return { agent: { launchPending: true }, argv: ['claude', ...o.args] }; },
    },
  };
  return { b, s, calls, events, node, links, dir };
}

test('P125 다시 열기: 같은 패널(남은 셸)에서 같은 세션 ID로 이어 간다. 이름·자리·부모·연결은 그대로', async () => {
  const { b, s, calls, events, node, links } = fakeBoard();
  assert.equal(userClosed(s), true); assert.equal(reopenable(s), true);
  const r = await reopenSession(b, { session: 'c1' }); // 이름으로도
  assert.equal(r.where, 'board'); assert.equal(r.plan, 'resume'); assert.equal(r.resume, true); assert.equal(r.paneId, 't3'); assert.equal(r.newPane, false); assert.equal(r.was, 'user');
  const st = calls.find((c) => c[0] === 'startAgent');
  assert.equal(st[1], 't3'); assert.equal(st[2], 'c1');
  assert.deepEqual(st[3].slice(0, 2), ['--resume', 'sid-1']);
  assert.ok(st[3].includes('--settings') && st[3].includes('haiku'));
  assert.equal(s.rt.exit, null); assert.equal(deriveState(s.rt).state, 'starting');
  assert.equal(s.sessionId, 'sid-1'); assert.equal(s.name, 'c1'); assert.equal(s.parentSessionId, 'lead');
  assert.deepEqual(node, { x: 100, y: 200, w: 720, h: 460 }); assert.equal(links.length, 1);
  assert.ok(events.some(([type]) => type === 'reopened_in_place'));
  assert.ok(!calls.some((c) => c[0] === 'createWorkspace'));
});

test('P125 다시 열기: 패널이 없으면 같은 폴더에 새 패널, 대화 기록이 없으면 같은 세션 ID로 새로', async () => {
  const { b, s, calls } = fakeBoard({ paneAlive: false, transcript: false });
  const r = await reopenSession(b, { session: 'sid-1' });
  assert.equal(r.newPane, true); assert.equal(r.paneId, 't9'); assert.equal(s.paneId, 't9'); assert.equal(s.termWorkspaceId, 'w9');
  assert.equal(r.plan, 'fresh');
  const st = calls.find((c) => c[0] === 'startAgent');
  assert.deepEqual(st[3].slice(0, 2), ['--session-id', 'sid-1']);
});

test('P125 다시 열기: 띄우지 못하면 끝난 채로 되돌린다, 아직 도는 세션·셸·없는 세션', async () => {
  const { b, s } = fakeBoard();
  b.adapter.startAgent = async () => { throw Object.assign(new Error('boom'), { code: 'x' }); };
  await assert.rejects(reopenSession(b, { session: 'sid-1' }), /boom/);
  assert.equal(s.rt.exit.kind, 'user');
  // 도는 세션
  const f2 = fakeBoard(); resetForReopen(f2.s.rt); f2.s.rt.term.present = true; f2.s.rt.term.status = 'idle'; f2.s.rt.phase = 'running';
  await assert.rejects(reopenSession(f2.b, { session: 'sid-1' }), (e) => e.code === 'not_exited');
  // 셸 노드는 같은 자리 다시 열기가 아니다
  const f3 = fakeBoard(); f3.s.kind = 'shell';
  assert.equal(reopenable(f3.s), false);
  // 판에 없는 세션(J2 닫힘) → recall.reopen
  const f4 = fakeBoard();
  const r = await reopenSession(f4.b, { session: 'gone-1' });
  assert.equal(r.where, 'closed');
  assert.ok(f4.calls.some((c) => c[0] === 'recall.reopen' && c[1] === 'gone-1'));
});

test('P125 applyExitCode: 놓임 뒤에 온 종료 코드로 까닭 모를 끝남(other)을 고친다. 판이 끈 것·이미 코드가 있는 것은 그대로', () => {
  const rt = running(); applyAgentReleased(rt, 1); // hook·코드 없이 끝남
  assert.equal(rt.exit.kind, 'other');
  assert.equal(applyExitCode(rt, 0xC000013A), true);
  assert.equal(rt.exit.kind, 'user'); assert.equal(rt.exit.code, 0xC000013A);
  assert.equal(applyExitCode(rt, 1), false); // 한 번만
  const rt2 = running(); applyAgentReleased(rt2, 1);
  applyExitCode(rt2, 1);
  assert.equal(rt2.exit.kind, 'other'); // 오류 코드
  const rt3 = running(); rt3.exitRequested = true; applyAgentReleased(rt3, 1); // 판이 끄라고 했는데 SessionEnd 없이 끝남
  applyExitCode(rt3, 0);
  assert.equal(rt3.exit.kind, 'other');
  const rt4 = running(); ended(rt4, 'prompt_input_exit'); applyAgentReleased(rt4, 1);
  applyExitCode(rt4, 1);
  assert.equal(rt4.exit.kind, 'user'); // SessionEnd 까닭이 먼저다
  assert.equal(applyExitCode(newRuntime(), 0), false); // 끝나지 않은 세션
});
