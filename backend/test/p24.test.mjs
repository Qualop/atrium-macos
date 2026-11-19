// P24 단위 시험: 리포(워크스페이스) 단위 잠재우기와 깨우기(ARCH 4절 D4). herdr와 claude 없이 돈다(가짜 어댑터, 가짜 대화 기록).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { repoSleepPlan, idleSince, Sleeper } from '../src/sleep.mjs';
import { newRuntime, deriveState, applyTermStatus, applyAgentDetected, applyAgentReleased } from '../src/state.mjs';
import { transcriptPathFor } from '../src/launch.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p24-'));
const MIN = 60000;
const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-00000000a024`;
const R = (name, x = {}) => ({ name, kind: 'claude', hooked: true, convKnown: true, state: 'ready', sleeping: false, waking: false, closing: false, delivering: 0, loops: 0, childBusy: false, parentBusy: false, viewed: false, draft: false, idleSince: 0, ...x });

test('P24 판정: 리포의 어떤 세션이든 일이 있으면 리포 전체를 잠재우지 않는다', () => {
  const now = 100 * MIN, o = { now, afterMs: 30 * MIN };
  const idle = (n) => R(n, { idleSince: now - 40 * MIN });
  assert.deepEqual(repoSleepPlan([idle('a1'), idle('a2')], o), { why: null, who: null, targets: ['a1', 'a2'], since: now - 40 * MIN });
  for (const [x, why] of [[{ state: 'working' }, 'working'], [{ state: 'waiting' }, 'needs_you'], [{ state: 'trust_wait' }, 'needs_you'], [{ state: 'starting' }, 'working'],
    [{ viewed: true }, 'viewing'], [{ draft: true }, 'draft'], [{ delivering: 1 }, 'delivering'], [{ loops: 1 }, 'loop'], [{ childBusy: true }, 'child_busy']]) {
    const p = repoSleepPlan([idle('a1'), R('a2', { idleSince: now - 40 * MIN, ...x })], o);
    assert.equal(p.why, why, JSON.stringify(x)); assert.equal(p.who, 'a2');
  }
  // 한 세션이라도 최근에 손댔으면(쉬기 시작한 때가 늦으면) 리포가 아직 쉬지 않았다
  assert.equal(repoSleepPlan([idle('a1'), R('a2', { idleSince: now - 5 * MIN })], o).why, 'idle_short');
  // 마지막 일(보던 노드 등)이 끝난 때부터 센다
  assert.equal(repoSleepPlan([idle('a1'), idle('a2')], { ...o, busyAt: now - 10 * MIN }).why, 'idle_short');
  assert.equal(repoSleepPlan([idle('a1'), idle('a2')], { ...o, busyAt: now - 31 * MIN }).why, null);
  // 셸과 다른 종류는 대상이 아니고, 쉬는 셸은 리포를 깨워 두지 않는다. 잠든 세션과 대화 기록 없는 세션은 대상에서 빠진다
  const mixed = [idle('a1'), R('sh', { kind: 'shell', state: 'shell_running', idleSince: 0 }), R('cx', { kind: 'codex', hooked: false }), R('z', { sleeping: true, state: 'sleeping' }), R('new', { convKnown: false })];
  assert.deepEqual(repoSleepPlan(mixed, o).targets, ['a1']);
  assert.equal(repoSleepPlan(mixed, o).why, null, '셸의 명령이 돌아도 리포는 잠든다');
  assert.equal(repoSleepPlan([R('cx', { kind: 'codex', hooked: false, state: 'working' }), idle('a1')], o).why, 'working', '다른 종류가 일하는 것도 리포의 일');
  assert.equal(repoSleepPlan([R('z', { sleeping: true, state: 'sleeping' })], o).why, 'asleep');
  // 셸의 쉬기 시작한 때는 사람이 손댄 때뿐. hook이 오는 세션은 herdr 상태 알림(lastActivityAt)이 아니라 마지막 hook으로 센다
  assert.equal(idleSince({ kind: 'shell', touchedAt: 7, rt: { lastActivityAt: 99 } }), 7);
  assert.equal(idleSince({ kind: 'claude', rt: { lastActivityAt: 99, lastHookAt: 20 } }), 20);
  assert.equal(idleSince({ kind: 'codex', rt: { lastActivityAt: 99, lastHookAt: null } }), 99);
});

// ---------- 가짜 판: 리포 A(a1, a2)와 리포 B(b1, b2) ----------
function board() {
  const root = tmp();
  const dirs = { A: tmp(), B: tmp() };
  const events = [], calls = [];
  const sessions = new Map();
  const store = { saveRuntime: () => {}, updateSession: () => {}, addEvent: (sid, kind, data) => events.push({ sid, kind, data }), workspaces: () => [{ key: 'ka', root: 'C:/x/repo-a' }, { key: 'kb', root: 'C:/x/repo-b' }] };
  const queue = new EventEmitter(); queue.items = []; queue.pending = (sid) => queue.items.filter((d) => d.sessionId === sid).length; queue.cancelSession = () => {};
  let wsN = 10;
  const b = {
    cfg: { claudeProjects: root, killWaitMs: 2000 }, sessions, store, queue, killing: new Set(), log: () => {},
    hooked: (s) => s.kind === 'claude', relay: { stats: () => [], detach: () => {} },
    features: { loops: { activeCount: () => 0 }, settings: { get: () => ({ sleepAfterMin: 30, sessionSleepAfterMin: 0 }) } }, // P111: 리포 규칙만 본다(세션 규칙은 p111.test.mjs)
    requireTerminal: () => {},
    resolve: (ref) => sessions.get(ref) || [...sessions.values()].find((s) => s.name === ref),
    resolveWorkspace: async (ref) => ({ key: ref === 'repo-a' ? 'ka' : ref === 'repo-b' ? 'kb' : ref }),
    broadcastSession: (s, o) => calls.push(['broadcast', s.name, deriveState(s.rt).state, !!s.waking, o && o.cause]),
    withNewPane: async (create, register) => { const r = await create(); await register(r); return r; },
    launchOf: (s) => ({ sessionId: s.sessionId, settingsPath: 'C:/d/x.json', permissionMode: 'manual', model: 'haiku', effort: null, pluginDir: 'C:/p', systemPromptFile: 'C:/p.md' }),
    adapter: {
      connected: true,
      processInfo: async () => null,
      sendText: async () => {},
      // 한 패널을 닫으면 herdr가 다른 에이전트에게도 같은 idle을 다시 알린다(창 시험에서 본 것): lastActivityAt이 늘어난다
      paneKeys: async (pane) => { const s = [...sessions.values()].find((x) => x.paneId === pane); if (s) setTimeout(() => { applyAgentReleased(s.rt); for (const o of sessions.values()) if (o !== s && o.paneId && o.kind === 'claude' && o.rt.term.status) applyTermStatus(o.rt, o.rt.term.status); }, 10); },
      workspacePanes: async () => [], closeWorkspace: async () => {}, closePane: async () => {}, refreshSubscription: async () => {},
      createWorkspace: async () => { wsN++; return { paneId: `w${wsN}:p1`, workspaceId: `w${wsN}` }; },
      waitShellReady: async () => true,
      startAgent: async ({ name, paneId }) => { calls.push(['startAgent', name, Date.now()]); const s = [...sessions.values()].find((x) => x.paneId === paneId); setTimeout(() => { applyAgentDetected(s.rt); applyTermStatus(s.rt, 'idle'); }, 20); return { agent: { launchPending: true } }; },
    },
  };
  let n = 0;
  const add = (name, key, kind = 'claude') => {
    const rt = newRuntime({ kind, hooked: kind === 'claude' });
    if (kind === 'claude') { applyAgentDetected(rt); applyTermStatus(rt, 'idle'); } else applyTermStatus(rt, 'idle');
    rt.lastActivityAt = Date.now() - 40 * MIN; rt.launchedAt = Date.now() - 60 * MIN;
    if (kind === 'claude') rt.lastHookAt = Date.now() - 40 * MIN;
    const cwd = key === 'ka' ? dirs.A : dirs.B;
    const s = { sessionId: ID(++n), name, cwd, kind, origin: 'board', paneId: `w${n}:p1`, termWorkspaceId: `w${n}`, agentName: name, rt, touchedAt: Date.now() - 40 * MIN, workspaceKey: key };
    sessions.set(s.sessionId, s);
    if (kind === 'claude') { const f = transcriptPathFor(root, cwd, s.sessionId); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '{}\n'); }
    return s;
  };
  const a1 = add('a1', 'ka'), a2 = add('a2', 'ka'), b1 = add('b1', 'kb'), b2 = add('b2', 'kb');
  const sh = add('sh', 'ka', 'shell');
  const sl = new Sleeper(b, { timers: false, wakeReadyMs: 3000, settleMs: 10, staggerMs: 60 });
  b.sleeper = sl;
  return { b, sl, a1, a2, b1, b2, sh, events, calls };
}
const st = (s) => deriveState(s.rt).state;

test('P24 저절로: 쉰 리포만 한 번에 통째로 잠들고(다른 패널을 닫을 때 오는 herdr 알림에 다시 세지 않는다) 일이 있는 리포는 하나도 잠들지 않는다', async () => {
  const { sl, a1, a2, b1, b2, sh, events } = board();
  b2.rt.term.status = 'working';
  await sl.tick();
  assert.deepEqual([st(a1), st(a2), st(b1), st(b2)], ['sleeping', 'sleeping', 'ready', 'working']);
  assert.notEqual(st(sh), 'sleeping', '셸은 그대로');
  assert.ok(sh.paneId, '셸 패널은 닫지 않는다');
  const ev = events.find((e) => e.kind === 'repo_slept');
  assert.equal(ev.data.name, 'repo-a'); assert.equal(ev.data.slept, 2); assert.equal(ev.data.by, 'auto');
  const status = sl.status();
  assert.deepEqual(status.repos.map((r) => [r.name, r.why, r.who, r.asleep]), [['repo-a', 'asleep', null, 2], ['repo-b', 'working', 'b2', 0]]);
});

test('P24 저절로: 보는 노드·초안이 있는 리포, 보기를 막 그만둔 리포는 잠들지 않는다', async () => {
  const { sl, b, a1, b1, b2 } = board();
  b.relay.stats = () => [{ sessionId: a1.sessionId }]; // 가까이 얼굴로 a1을 본다
  b2.draft = true;
  await sl.tick();
  assert.deepEqual([st(a1), st(b1)], ['ready', 'ready']);
  assert.equal(sl.plan('ka').why, 'viewing'); assert.equal(sl.plan('kb').why, 'draft');
  // 보기를 그만두면 그때부터 다시 센다(세션들은 40분 전부터 쉬었지만)
  b.relay.stats = () => [];
  await sl.tick();
  assert.equal(st(a1), 'ready');
  assert.equal(sl.plan('ka').why, 'idle_short');
});

test('P24 깨우기: 잠든 리포의 세션 하나를 깨우면(누르기·전달) 그 리포의 잠든 세션을 모두 깨우고, 부른 세션이 먼저다', async () => {
  const { sl, a1, a2, b1, calls } = board();
  await sl.tick();
  await sl.sleepRepo('kb', { by: 'hand', mode: 'hand' });
  assert.deepEqual([st(a1), st(a2), st(b1)], ['sleeping', 'sleeping', 'sleeping']);
  const r = await sl.wakeOne({ session: 'a2', why: 'click' });
  assert.equal(r.woke, true); assert.equal(r.name, 'a2'); assert.equal(r.repo.waking, 2);
  assert.ok(a1.waking, '나머지는 차례를 기다리는 동안에도 깨우는 중으로 보인다');
  await sl.wakes.get(a1.sessionId);
  assert.deepEqual([st(a1), st(a2), st(b1)], ['ready', 'ready', 'sleeping'], '다른 리포는 그대로 잔다');
  const order = calls.filter((c) => c[0] === 'startAgent').map((c) => c[1]);
  assert.deepEqual(order, ['a2', 'a1']);
  // 글 보내기: 대기열이 sleeping으로 기다리면 백엔드가 wakeFor를 부른다
  await sl.wakeFor(b1, 'delivery');
  assert.equal(st(b1), 'ready');
});

test('P24 손으로: 이 리포 잠재우기는 보는 노드도 잠재우되 일하는 세션이 있으면 까닭과 세션 이름을 돌려준다. 쉬는 리포 모두, 이 리포 깨우기', async () => {
  const { sl, b, a1, a2, b1, b2 } = board();
  b.relay.stats = () => [{ sessionId: a1.sessionId }];
  b2.rt.term.status = 'working';
  await assert.rejects(sl.sleepRepoHand({ workspace: 'repo-b' }), (e) => e.code === 'sleep_working' && e.key === 'repoSleepRefused' && e.vars.repo === 'repo-b' && e.vars.name === '@b2');
  const bulk = await sl.sleepIdle();
  assert.equal(bulk.slept, 0, '보는 노드가 있는 리포와 일하는 리포는 쉬는 리포 모두에서 빠진다');
  assert.deepEqual(bulk.skipped.map((x) => [x.name, x.reason]).sort(), [['repo-a', 'viewing'], ['repo-b', 'working']]);
  const hand = await sl.sleepRepoHand({ workspace: 'repo-a' });
  assert.equal(hand.slept, 2); assert.deepEqual([st(a1), st(a2)], ['sleeping', 'sleeping']);
  b2.rt.term.status = 'idle';
  const bulk2 = await sl.sleepIdle();
  assert.equal(bulk2.repos, 1); assert.equal(bulk2.slept, 2); assert.deepEqual([st(b1), st(b2)], ['sleeping', 'sleeping']);
  const w = await sl.wakeRepoHand({ workspace: 'repo-a' });
  assert.equal(w.woke, 2); assert.deepEqual([st(a1), st(a2), st(b1)], ['ready', 'ready', 'sleeping']);
  const none = await sl.wakeRepoHand({ workspace: 'repo-a' });
  assert.equal(none.woke, 0);
});
