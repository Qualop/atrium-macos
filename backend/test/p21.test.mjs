// P21 단위 시험: 쉬는 Claude 세션 잠재우기와 깨우기(ARCH 5절 잠재우기, 기능 번호 D4 제안). herdr와 claude 없이 돈다(가짜 어댑터, 가짜 대화 기록).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { repoSleepPlan, sleepTarget, sessionActivity, idleSince, convoOf, wakeArgs, Sleeper, draftAfterInput } from '../src/sleep.mjs';
import { newRuntime, deriveState, flags, applyHerdrStatus, applyAgentDetected, applyAgentReleased, applyHerdrDisconnected } from '../src/state.mjs';
import { blockReason, DeliveryQueue } from '../src/delivery.mjs';
import { decideTarget } from '../src/loops.mjs';
import { transcriptPathFor } from '../src/launch.mjs';
import { Backend } from '../src/backend.mjs';
import { normalizePatch, DEFAULTS } from '../src/settings.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p21-'));
const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-00000000a021`;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = { kind: 'claude', hooked: true, convKnown: true, state: 'ready', sleeping: false, waking: false, closing: false, delivering: 0, loops: 0, childBusy: false, parentBusy: false, viewed: false, idleSince: 0 };
const MIN = 60000;

// P24: 판정은 리포 단위다(repoSleepPlan). 세션 하나의 대상 여부(sleepTarget)와 리포를 깨워 두는 일(sessionActivity)로 나뉜다
const plan1 = (x, o) => repoSleepPlan([{ name: 'a1', ...x }], o);
test('D4 판정: 저절로 잠재우는 것은 판이 띄운 claude가 있는 리포가 sleepAfterMin 동안 쉴 때뿐이다', () => {
  const now = 100 * MIN;
  assert.equal(plan1({ ...READY, idleSince: now - 31 * MIN }, { now, afterMs: 30 * MIN }).why, null);
  assert.deepEqual(plan1({ ...READY, idleSince: now - 31 * MIN }, { now, afterMs: 30 * MIN }).targets, ['a1']);
  assert.equal(plan1({ ...READY, idleSince: now - 29 * MIN }, { now, afterMs: 30 * MIN }).why, 'idle_short');
  assert.equal(plan1({ ...READY, idleSince: 0 }, { now, afterMs: 0 }).why, 'off', '0분이면 저절로 잠재우지 않는다');
  // 잠재우지 않는 종류: 대상이 없으면 리포를 잠재우지 않는다
  assert.equal(sleepTarget({ ...READY, kind: 'shell' }), 'not_claude');
  assert.equal(sleepTarget({ ...READY, kind: 'codex' }), 'not_claude');
  assert.equal(sleepTarget({ ...READY, hooked: false }), 'not_board', '판에 올린 claude');
  assert.equal(sleepTarget({ ...READY, convKnown: false }), 'no_convo', '대화 기록이 없으면 이어 갈 수 없다');
  assert.equal(sleepTarget({ ...READY, sleeping: true }), 'sleeping');
  assert.equal(sleepTarget({ ...READY, state: 'error' }), null, '오류로 끝난 턴도 쉬는 중');
  assert.equal(plan1({ ...READY, kind: 'shell' }, { now, afterMs: MIN }).why, 'nothing');
  assert.equal(plan1({ ...READY, sleeping: true }, { now, afterMs: MIN }).why, 'asleep');
});

test('D4 판정: 일하는 중, 내 차례, 전달 대기, 보는 노드, 루프 대상, 부모·자식이 일하는 세션이 있는 리포는 잠재우지 않는다', () => {
  const o = { now: 100 * MIN, afterMs: MIN };
  const cases = [
    [{ state: 'working' }, 'working'], [{ state: 'starting' }, 'working'],
    [{ state: 'waiting' }, 'needs_you'], [{ state: 'trust_wait' }, 'needs_you'],
    [{ delivering: 1 }, 'delivering'], [{ viewed: true }, 'viewing'], [{ loops: 1 }, 'loop'],
    [{ childBusy: true }, 'child_busy'], [{ parentBusy: true }, 'parent_busy'],
    [{ waking: true }, 'waking'],
  ];
  for (const [patch, why] of cases) assert.equal(plan1({ ...READY, ...patch }, o).why, why, JSON.stringify(patch));
  assert.equal(plan1({ ...READY, state: 'exited' }, o).why, 'nothing', '끝난 claude는 대상이 아니고 일도 아니다');
  // 쉬는 리포 모두(bulk): 쉰 시간은 보지 않고 나머지는 같다
  assert.equal(plan1({ ...READY, idleSince: o.now }, { mode: 'bulk', now: o.now, afterMs: 0 }).why, null);
  assert.equal(plan1({ ...READY, viewed: true }, { mode: 'bulk' }).why, 'viewing');
  // 손으로 이 리포: 보고 있어도 잠재운다. 일하는 중·내 차례·전달 대기는 그래도 막는다
  assert.equal(plan1({ ...READY, viewed: true }, { mode: 'hand' }).why, null);
  assert.equal(plan1({ ...READY, state: 'working' }, { mode: 'hand' }).why, 'working');
  assert.equal(plan1({ ...READY, state: 'waiting' }, { mode: 'hand' }).why, 'needs_you');
  assert.equal(plan1({ ...READY, delivering: 2 }, { mode: 'hand' }).why, 'delivering');
});

test('D4 쉬기 시작한 때: 마지막 활동, 턴 끝, 손댄 때, 깬 때 가운데 늦은 것', () => {
  const rt = newRuntime({ now: 10 });
  rt.lastActivityAt = 100; rt.turn = { startedAt: 50, endedAt: 120 };
  assert.equal(idleSince({ rt }), 120);
  assert.equal(idleSince({ rt, touchedAt: 300 }), 300);
  assert.equal(idleSince({ rt, touchedAt: 300, wokeAt: 400 }), 400);
});

test('D4 상태: 잠듦은 sleeping이고 내 차례·오류가 아니다. 안 본 답은 검토 대기로 남는다. 전달은 sleeping으로 기다린다', () => {
  const rt = newRuntime();
  applyAgentDetected(rt); applyHerdrStatus(rt, 'idle');
  rt.turn = { startedAt: 1, endedAt: 2 };
  rt.sleep = { at: 3, by: 'auto', memMB: 480 };
  rt.herdr = { status: null, launchPending: false, agentSessionId: null, present: false, at: 3 };
  assert.equal(deriveState(rt).state, 'sleeping');
  rt.exit = { kind: 'normal' };
  assert.equal(deriveState(rt).state, 'sleeping', '잠듦이 끝남(exited)보다 먼저다');
  rt.exit = null;
  assert.equal(flags(rt, { seenAt: 1 }).unseen, true);
  assert.equal(flags(rt, { seenAt: 5 }).unseen, false);
  // herdr가 꺼져도 잠듦 그대로(끊긴 턴을 남기지 않는다)
  applyHerdrDisconnected(rt);
  assert.equal(deriveState(rt).state, 'sleeping');
  assert.equal(rt.interruptedTurn, null);
  const view = { state: 'sleeping', agentPresent: false, herdrConnected: true, closed: false };
  assert.equal(blockReason(view, Date.now(), { inputQuietMs: 3000 }), 'sleeping');
  assert.equal(blockReason({ ...view, herdrConnected: false }, Date.now(), { inputQuietMs: 3000 }), 'herdr_down', 'herdr가 없으면 깨울 수 없다');
});

test('D4 루프: 잠든 세션도 쉴 때 루프의 대상이고, 주기 루프는 보내서 깨운다', () => {
  const idle = { trigger: { type: 'idle' }, stop: {} };
  assert.equal(decideTarget(idle, {}, { sessionId: 'a', kind: 'claude', state: 'sleeping', turnEndedAt: 5 }, Date.now()).action, 'fire');
  const every = { trigger: { type: 'interval', everyMs: 60000 }, stop: {} };
  assert.equal(decideTarget(every, {}, { sessionId: 'a', kind: 'claude', state: 'sleeping' }, Date.now(), { due: true }).action, 'fire');
});

test('D4 깨우기 인자: 같은 대화 ID로 판의 인자(--settings, --plugin-dir)로 이어 가고 갈라 열지 않는다. 대화 기록이 없으면 같은 세션 ID로 새로', () => {
  const launch = { sessionId: ID(1), settingsPath: 'C:/d/sessions/x.json', permissionMode: 'manual', model: 'haiku', effort: null, pluginDir: 'C:/d/plugin/atrium-herdr', systemPromptFile: 'C:/d/plugin/p.md' };
  const r = wakeArgs(launch, { convId: ID(1), exists: true });
  assert.equal(r.plan, 'resume');
  assert.deepEqual(r.args.slice(0, 2), ['--resume', ID(1)]);
  for (const a of ['--settings', 'C:/d/sessions/x.json', '--plugin-dir', '--model', 'haiku', '--no-chrome']) assert.ok(r.args.includes(a), a);
  assert.ok(!r.args.includes('--fork-session') && !r.args.includes('--session-id'));
  const c = wakeArgs(launch, { convId: ID(9), exists: true });
  assert.deepEqual(c.args.slice(0, 2), ['--resume', ID(9)], '/clear로 바뀐 대화 ID(hook)를 이어 간다');
  const f = wakeArgs(launch, { convId: ID(1), exists: false });
  assert.equal(f.plan, 'fresh');
  assert.deepEqual(f.args.slice(0, 2), ['--session-id', ID(1)]);
});

test('D4 대화 ID: hook의 대화 ID와 대화 기록, 없으면 세션 ID와 대화 기록 경로', () => {
  const root = tmp(), cwd = tmp();
  const s = { sessionId: ID(2), cwd, rt: newRuntime() };
  assert.deepEqual(convoOf(s, root), { convId: ID(2), transcript: transcriptPathFor(root, cwd, ID(2)), exists: false });
  const f = transcriptPathFor(root, cwd, ID(2));
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '{}\n');
  assert.equal(convoOf(s, root).exists, true);
  s.rt.claudeSessionId = ID(3); s.rt.transcriptPath = path.join(root, 'nope.jsonl');
  assert.deepEqual(convoOf(s, root), { convId: ID(3), transcript: path.join(root, 'nope.jsonl'), exists: false });
});

test('D4 설정: sleepAfterMin 기본 30분, 0~1440 정수', () => {
  assert.equal(DEFAULTS.sleepAfterMin, 30);
  assert.deepEqual(normalizePatch({ sleepAfterMin: '0' }), { sleepAfterMin: 0 });
  assert.throws(() => normalizePatch({ sleepAfterMin: 2000 }));
  assert.throws(() => normalizePatch({ sleepAfterMin: 1.5 }));
});

// ---------- 가짜 판으로 잠재우기·깨우기 ----------
function fakeBoard({ withTranscript = true, wakeFails = null } = {}) {
  const root = tmp(), cwd = tmp();
  const events = [], log = [], calls = [];
  const sessions = new Map();
  const store = { saveRuntime: () => {}, updateSession: (id, f) => calls.push(['updateSession', id, Object.keys(f).sort().join(',')]), addEvent: (sid, kind, data) => events.push({ sid, kind, data }) };
  const queue = new EventEmitter(); queue.items = []; queue.pending = (sid) => queue.items.filter((d) => d.sessionId === sid).length; queue.cancelSession = (sid, reason) => { queue.items = queue.items.filter((d) => { if (d.sessionId !== sid) return true; d.status = 'cancelled'; d.reason = reason; return false; }); };
  const alive = new Set([9001, 9002, 9003]);
  const b = {
    cfg: { claudeProjects: root, killWaitMs: 2000 }, sessions, store, queue, killing: new Set(), log: (...a) => log.push(a.join(' ')),
    hooked: (s) => s.rt.hooked !== false, relay: { stats: () => [], detach: () => calls.push(['detach']) },
    features: { loops: { activeCount: () => 0 }, settings: { get: () => ({ sleepAfterMin: 30 }) } },
    requireHerdr: () => { if (!b.adapter.connected) throw Object.assign(new Error('herdr down'), { code: 'herdr_down' }); },
    resolve: (ref) => sessions.get(ref) || [...sessions.values()].find((s) => s.name === ref),
    broadcastSession: (s, o) => calls.push(['broadcast', s.name, deriveState(s.rt).state, o && o.cause]),
    withNewPane: async (create, register) => { const r = await create(); await register(r); return r; },
    launchOf: (s) => ({ sessionId: s.sessionId, settingsPath: s.settingsPath, permissionMode: 'manual', model: 'haiku', effort: null, pluginDir: 'C:/p', systemPromptFile: 'C:/p.md' }),
    registerResume: () => calls.push(['registerResume']),
    adapter: {
      connected: true,
      processInfo: async () => ({ shell_pid: 9001, foreground_processes: [{ pid: 9002, name: 'claude.exe' }] }),
      sendText: async (pane, t) => { calls.push(['sendText', pane, t]); },
      paneKeys: async (pane, k) => { calls.push(['paneKeys', pane, k.join('+')]); const s = [...sessions.values()].find((x) => x.paneId === pane); if (s) setTimeout(() => { applyAgentReleased(s.rt); alive.clear(); }, 30); },
      workspacePanes: async () => assert.fail('single-pane lifecycle must not depend on a workspace snapshot'),
      closeWorkspace: async () => assert.fail('single-pane lifecycle must preserve sibling panes'),
      closePane: async (id) => { calls.push(['closePane', id]); },
      refreshSubscription: async () => {},
      createWorkspace: async ({ cwd: c, label }) => { calls.push(['createWorkspace', c, label]); return { paneId: 'w9:p1', workspaceId: 'w9' }; },
      waitShellReady: async () => true,
      startAgent: async ({ name, paneId, args }) => {
        calls.push(['startAgent', name, paneId, args.join(' ')]);
        const s = [...sessions.values()].find((x) => x.paneId === paneId);
        setTimeout(() => { if (wakeFails === 'exit') { applyAgentDetected(s.rt); applyAgentReleased(s.rt); } else { applyAgentDetected(s.rt); applyHerdrStatus(s.rt, 'idle'); } }, 30);
        return { agent: { launchPending: true }, argv: ['claude', ...args] };
      },
    },
  };
  const rt = newRuntime({ kind: 'claude', hooked: true });
  applyAgentDetected(rt); applyHerdrStatus(rt, 'idle');
  rt.lastPrompt = '안녕'; rt.lastAnswer = '안녕하세요'; rt.lastActivityAt = Date.now() - 40 * MIN; rt.launchedAt = Date.now() - 60 * MIN;
  const s = { sessionId: ID(5), name: 'a1', cwd, kind: 'claude', origin: 'board', paneId: 'w1:p1', herdrWorkspaceId: 'w1', agentName: 'a1', settingsPath: 'C:/d/sessions/a1.json', rt, touchedAt: Date.now() - 40 * MIN };
  sessions.set(s.sessionId, s);
  if (withTranscript) { const f = transcriptPathFor(root, cwd, s.sessionId); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '{}\n'); }
  const readTable = async () => ({ procs: new Map([[9001, { pid: 9001, ppid: 1, ws: 87 * 1048576, name: 'powershell.exe' }], [9002, { pid: 9002, ppid: 9001, ws: 310 * 1048576, name: 'claude.exe' }], [9003, { pid: 9003, ppid: 9002, ws: 85 * 1048576, name: 'aside.exe' }]]) });
  const sl = new Sleeper(b, { timers: false, readTable, wakeReadyMs: 3000, settleMs: 50 });
  b.sleeper = sl;
  return { b, s, sl, events, calls, queue };
}

test('D4 잠재우기: /exit 뒤 작업 공간을 닫고 패널 없이 sleeping으로 남는다. 잰 메모리와 프로세스를 남긴다', async () => {
  const { s, sl, events, calls } = fakeBoard();
  assert.equal(sl.plan('', 'auto').why, null, '40분 쉰 리포의 판 claude는 저절로 잠든다');
  const out = await sl.sleep(s, { by: 'auto' });
  assert.equal(out.slept, true);
  assert.equal(out.memMB, 482);
  assert.deepEqual(out.procs.sort(), ['aside.exe', 'claude.exe', 'powershell.exe']);
  assert.ok(calls.some((c) => c[0] === 'sendText' && c[2] === '/exit'));
  assert.ok(calls.some((c) => c[0] === 'closePane' && c[1] === 'w1:p1'));
  assert.equal(s.paneId, null); assert.equal(s.herdrWorkspaceId, null);
  assert.equal(deriveState(s.rt).state, 'sleeping');
  assert.equal(s.rt.exit, null, '닫힘(exited)이 아니다');
  assert.equal(s.rt.lastAnswer, '안녕하세요', '요약 얼굴에 보일 마지막 답은 그대로');
  assert.equal(s.rt.sleep.memMB, 482); assert.equal(s.rt.sleep.convId, ID(5));
  assert.ok(events.some((e) => e.kind === 'slept'));
  assert.ok(!calls.some((c) => c[0] === 'broadcast' && c[2] === 'exited'), 'claude가 끝나는 동안 exited로 보이지 않는다');
  const st = sl.status();
  assert.deepEqual({ ...st, repos: undefined }, { afterMin: 30, sleeping: 1, savedMB: 482, sessions: [{ name: 'a1', workspace: '', at: s.rt.sleep.at, memMB: 482 }], repos: undefined });
  assert.equal(st.repos[0].why, 'asleep'); assert.equal(st.repos[0].asleep, 1); assert.equal(st.repos[0].savedMB, 482);
  assert.equal(sl.summaryExtra(s).sleep.memMB, 482);
});

test('audit: sleep closes only its target when workspace enumeration is unavailable', async () => {
  const { b, s, sl, calls } = fakeBoard();
  sl.measure = async () => ({ memMB: 0, procs: [] });
  b.adapter.workspacePanes = async () => { throw Object.assign(new Error('fixture unavailable'), { code: 'unreachable' }); };
  assert.equal((await sl.sleep(s, { by: 'hand' })).slept, true);
  assert.deepEqual(calls.filter(([op]) => op === 'closePane'), [['closePane', 'w1:p1']]);
  assert.equal(s.paneId, null);
});

test('audit: sleep closePane failure retains its pane and reports failure', async () => {
  const { b, s, sl, events } = fakeBoard();
  sl.measure = async () => ({ memMB: 0, procs: [] });
  b.adapter.closePane = async () => { throw Object.assign(new Error('fixture unavailable'), { code: 'unreachable' }); };
  await assert.rejects(sl.sleep(s, { by: 'hand' }), { code: 'unreachable' });
  assert.equal(s.paneId, 'w1:p1');
  assert.equal(s.herdrWorkspaceId, 'w1');
  assert.equal(s.rt.sleep, null);
  assert.equal(s.rt.exitRequested, false);
  assert.equal(events.some((e) => e.kind === 'slept'), false);
});

test('audit: failed wake cleanup keeps its new pane tracked when close fails', async () => {
  const { b, s, sl, events } = fakeBoard({ wakeFails: 'exit' });
  sl.measure = async () => ({ memMB: 0, procs: [] });
  await sl.sleep(s, { by: 'hand' });
  b.adapter.closePane = async () => { throw Object.assign(new Error('cleanup unreachable'), { code: 'unreachable' }); };
  await assert.rejects(sl.wake(s, 'hand'), { code: 'wake_failed' });
  assert.equal(s.paneId, 'w9:p1');
  assert.equal(s.herdrWorkspaceId, 'w9');
  assert.equal(s.rt.sleep, null, 'must not create another pane on the next wake');
  assert.ok(events.some((e) => e.kind === 'wake_failed' && e.data.error.cleanup));
});

test('audit: failed wake cleanup preserves sibling panes added during startup', async () => {
  const { b, s, sl, calls } = fakeBoard({ wakeFails: 'exit' });
  sl.measure = async () => ({ memMB: 0, procs: [] });
  await sl.sleep(s, { by: 'hand' });
  const panes = new Set(['w9:p1', 'w9:sibling']);
  b.adapter.closePane = async (pane) => { calls.push(['closePane', pane]); panes.delete(pane); };
  await assert.rejects(sl.wake(s, 'hand'), { code: 'wake_failed' });
  assert.ok(calls.some(([op, pane]) => op === 'closePane' && pane === 'w9:p1'));
  assert.deepEqual([...panes], ['w9:sibling']);
  assert.equal(s.paneId, null);
});

test('D4 깨우기: 같은 대화 ID로 새 작업 공간에서 판의 인자로 이어 가고 준비되면 끝난다', async () => {
  const { s, sl, events, calls } = fakeBoard();
  await sl.sleep(s, { by: 'hand' });
  const r = await sl.wake(s, 'hand');
  assert.equal(r.woke, true); assert.equal(r.plan, 'resume'); assert.equal(r.state, 'ready');
  assert.equal(s.paneId, 'w9:p1');
  const st = calls.find((c) => c[0] === 'startAgent');
  assert.equal(st[1], 'a1', '같은 herdr 이름');
  assert.match(st[3], new RegExp(`^--resume ${ID(5)} `));
  assert.match(st[3], /--settings C:\/d\/sessions\/a1\.json/);
  assert.ok(calls.some((c) => c[0] === 'registerResume'));
  assert.equal(s.rt.sleep, null); assert.equal(s.waking, null);
  assert.ok(s.wokeAt > 0);
  assert.ok(events.some((e) => e.kind === 'woke'));
  assert.ok(calls.some((c) => c[0] === 'broadcast' && c[2] === 'sleeping' && c[3] === 'wake:hand'), '깨우는 동안 깨우는 중으로 보인다');
  assert.equal(sl.plan('', 'auto').why, 'idle_short', '막 깬 리포는 다시 쉰 시간을 센다');
});

test('D4 깨우기 실패: 이어 가자마자 끝나면 패널을 닫고 까닭과 함께 잠듦으로 두며 보낼 글은 취소한다', async () => {
  const { s, sl, events, calls, queue } = fakeBoard({ wakeFails: 'exit' });
  await sl.sleep(s, { by: 'hand' });
  queue.items.push({ sessionId: s.sessionId, status: 'queued', reason: 'sleeping' });
  await assert.rejects(sl.wake(s, 'delivery'), (e) => e.code === 'wake_failed');
  assert.equal(deriveState(s.rt).state, 'sleeping');
  assert.equal(s.rt.sleep.error.code, 'resume_failed');
  assert.equal(s.paneId, null);
  assert.ok(calls.filter((c) => c[0] === 'closePane').some((c) => c[1] === 'w9:p1'), '깨우며 만든 패널만 닫는다');
  assert.equal(queue.items.length, 0);
  assert.ok(events.some((e) => e.kind === 'wake_failed'));
});

test('D4 잠재우기 막힘: 재는 동안 일이 들어오면 그만두고, 손으로 잠재울 때 까닭을 돌려준다', async () => {
  const { s, sl, b } = fakeBoard();
  s.rt.herdr.status = 'working';
  await assert.rejects(sl.sleepRepoHand({ session: 'a1' }), (e) => e.code === 'sleep_working' && e.key === 'repoSleepRefused' && e.vars.name === '@a1');
  s.rt.herdr.status = 'idle';
  b.queue.items.push({ sessionId: s.sessionId, status: 'queued' });
  await assert.rejects(sl.sleep(s, { by: 'hand' }), (e) => e.code === 'sleep_delivering');
  assert.equal(deriveState(s.rt).state, 'ready', '그대로 깨어 있다');
  assert.equal(s.paneId, 'w1:p1');
});

test('D4 판정: 부모가 일하는 하위 세션, 일하는 하위 세션이 있는 부모, 보는 노드의 리포는 쉬어도 잠재우지 않는다', () => {
  const { s, sl, b } = fakeBoard();
  const kidRt = newRuntime(); applyAgentDetected(kidRt); applyHerdrStatus(kidRt, 'working');
  const kid = { sessionId: ID(6), name: 'k1', kind: 'claude', parentSessionId: s.sessionId, paneId: 'w2:p1', rt: kidRt, workspaceKey: 'other' }; // 하위 세션은 다른 리포에서 일한다
  { const f = transcriptPathFor(b.cfg.claudeProjects, s.cwd, ID(6)); fs.writeFileSync(f, '{}\n'); kid.cwd = s.cwd; }
  b.sessions.set(kid.sessionId, kid);
  assert.equal(sl.plan('', 'auto').why, 'child_busy', '다른 리포에서 일하는 하위 세션이 있는 부모');
  kidRt.herdr.status = 'idle'; kidRt.lastActivityAt = 0; kidRt.launchedAt = 0;
  s.rt.herdr.status = 'working';
  assert.equal(sl.plan('other', 'bulk').why, 'parent_busy');
  s.rt.herdr.status = 'idle';
  b.relay.stats = () => [{ sessionId: s.sessionId }];
  assert.equal(sl.plan('', 'auto').why, 'viewing', '가까이 얼굴로 터미널이 붙은 노드');
  b.relay.stats = () => [];
  const client = {};
  sl.handlers['board.viewing']({ focus: s.sessionId }, client);
  assert.equal(sl.plan('', 'auto').why, 'viewing', '초점이 있는 노드');
  sl.dropClient(client);
  assert.equal(sl.plan('', 'auto').why, 'idle_short', '보던 리포는 보기를 그만둔 뒤부터 쉰 시간을 센다');
  sl.busyAt.set('', Date.now() - 31 * MIN);
  assert.equal(sl.plan('', 'auto').why, null);
});

test('D4 대기열: 잠든 세션에 넣은 글은 sleeping으로 기다리고 그 이벤트가 깨우기를 부른다', async () => {
  const events = [];
  const store = { activeDeliveries: () => [], insertDelivery: () => {}, updateDelivery: () => {} };
  const q = new DeliveryQueue({ store, cfg: { inputQuietMs: 3000, deliveryMaxWaitMs: 60000, submitConfirmMs: 30000 }, view: () => ({ state: 'sleeping', agentPresent: false, herdrConnected: true, closed: false }), send: async () => { throw new Error('보내면 안 된다'); } });
  q.on('delivery', (d) => events.push(`${d.status}:${d.reason}`));
  q.enqueue('a', '깨어나');
  await sleepMs(10);
  assert.deepEqual(events, ['queued:null', 'queued:sleeping']);
});

test('D4 복구: herdr를 다시 띄워도 잠든 세션(패널 없음)은 되살리지 않고 "패널이 사라짐"으로 닫지도 않는다', async () => {
  const rt = newRuntime(); rt.sleep = { at: 1, by: 'auto', memMB: 400 };
  const sleeping = { sessionId: ID(7), name: 'z1', kind: 'claude', paneId: null, rt, cwd: tmp() };
  const gone = { sessionId: ID(8), name: 'g1', kind: 'shell', paneId: 'w3:p1', rt: newRuntime({ kind: 'shell', hooked: false }), cwd: tmp() };
  const closed = [];
  const fake = {
    sessions: new Map([[sleeping.sessionId, sleeping], [gone.sessionId, gone]]),
    adapter: { snapshot: async () => ({ panes: [] }), listAgents: async () => [] },
    hooked: (s) => s.kind === 'claude', recall: { restorable: () => false },
    closeSession: (s, why) => closed.push([s.name, why]), store: { addEvent: () => {} }, queue: { list: () => [] },
    sessionByPane: () => null, adoptPane: async () => {}, log: () => {}, broadcastSession: () => {},
  };
  // 백엔드가 꺼진 동안 herdr가 다시 떴을 때도(afterRestart) 같다
  const report = await Backend.prototype.resync.call(fake, 'herdr connected', { afterRestart: true });
  assert.deepEqual(closed, [['g1', 'pane gone']]);
  assert.ok(!report.some((r) => r.name === 'z1'));
  assert.equal(deriveState(sleeping.rt).state, 'sleeping');
});

test('D4 복구: 잠재우던 중에 백엔드가 꺼졌으면 패널이 남은 세션은 깨어 있는 것으로, 없으면 잠든 것으로 둔다', () => {
  const a = newRuntime(); a.sleep = { at: 1, going: true };
  const z = newRuntime(); z.sleep = { at: 1, going: true };
  const b = { sessions: new Map([['a', { sessionId: 'a', paneId: 'w1:p1', rt: a }], ['z', { sessionId: 'z', paneId: null, rt: z }]]), store: { saveRuntime: () => {} } };
  new Sleeper(b, { timers: false });
  assert.equal(a.sleep, null);
  assert.deepEqual(z.sleep, { at: 1 });
});

test('D4 끄기: 잠든 세션은 herdr 없이 닫는다(보관·삭제는 그 뒤 P15 그대로)', async () => {
  const rt = newRuntime(); rt.sleep = { at: 1, by: 'hand' };
  const s = { sessionId: ID(9), name: 'z2', kind: 'claude', paneId: null, herdrWorkspaceId: null, rt };
  const closed = [], archived = [];
  const fake = {
    sessions: new Map([[s.sessionId, s]]), currentSession: Backend.prototype.currentSession, killSession: Backend.prototype.killSession,
    resolve: () => s, adapter: { workspacePanes: async () => { throw new Error('no ws'); } },
    sleeper: { wakes: new Map(), going: new Map() },
    requireHerdr: () => { throw new Error('herdr를 부르면 안 된다'); },
    closeSession: (x, why) => closed.push([x.name, why]),
    recall: { markArchive: (p) => archived.push(p.session) },
  };
  const ask = await Backend.prototype.kill.call(fake, { session: 'z2' });
  assert.equal(ask.needsConfirm, true);
  const out = await Backend.prototype.kill.call(fake, { session: 'z2', confirm: true, after: 'archive' });
  assert.equal(out.closed, true);
  assert.deepEqual(closed, [['z2', 'killed']]);
  assert.deepEqual(archived, [ID(9)]);
  assert.equal(rt.sleep, null);
});

test('D4 전달: 잠재우는 중에는 sleeping, 깨우는 중에는 준비된 뒤에도 잠깐 starting으로 기다린다(입력 칸이 Enter를 받기 전)', () => {
  const rt = newRuntime(); applyAgentDetected(rt); applyHerdrStatus(rt, 'idle');
  const s = { sessionId: 'a', rt };
  const fake = { sessions: new Map([['a', s]]), sleeper: { going: new Map() }, adapter: { connected: true } };
  const view = () => Backend.prototype.deliveryView.call(fake, 'a', null).state;
  assert.equal(view(), 'ready');
  s.waking = { at: 1, why: 'delivery' };
  assert.equal(view(), 'starting');
  s.waking = null; fake.sleeper.going.set('a', Promise.resolve());
  assert.equal(view(), 'sleeping');
});

test('P21 초안: 판 터미널에서 친 글이 남아 있으면 손으로든 저절로든 그 리포를 잠재우지 않는다', () => {
  const now = Date.now(), MIN = 60000;
  const x = { name: 'a', kind: 'claude', hooked: true, convKnown: true, state: 'ready', idleSince: now - 60 * MIN, draft: true };
  assert.equal(repoSleepPlan([x], { now, afterMs: 30 * MIN }).why, 'draft');
  assert.equal(repoSleepPlan([x], { mode: 'hand', now }).why, 'draft');
  assert.equal(repoSleepPlan([{ ...x, draft: false }], { now, afterMs: 30 * MIN }).why, null);
  assert.equal(sessionActivity({ kind: 'shell', state: 'shell_idle', draft: true }), null, '셸에 친 글은 claude의 /exit와 상관없다');
  // 키 입력: 글자는 초안, Enter·Ctrl+C·Ctrl+U는 비움, 지우기·화살표·초점 알림·붙여 넣기 표시는 그대로
  assert.equal(draftAfterInput(false, 'hel'), true);
  assert.equal(draftAfterInput(true, '\r'), false);
  assert.equal(draftAfterInput(false, 'ok\r'), false, '친 뒤 바로 Enter면 제출');
  assert.equal(draftAfterInput(true, '\x03'), false);
  assert.equal(draftAfterInput(true, '\x15'), false);
  assert.equal(draftAfterInput(true, '\x7f'), true);
  assert.equal(draftAfterInput(false, '\x1b[A'), false);
  assert.equal(draftAfterInput(false, '\x1b[I\x1b[O'), false);
  assert.equal(draftAfterInput(false, '\x1b[200~붙인 글\x1b[201~'), true);
  assert.equal(draftAfterInput(false, '\x1b'), false, 'Esc만으로는 초안이 생기지 않는다');
});
