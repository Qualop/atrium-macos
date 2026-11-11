// P105 단위 시험: 잠재우기가 뒤 일(Claude Code 뒤 셸·뒤 하위 에이전트)이 도는 세션을 잠재우지 않고, 실패한 잠재우기를 되풀이하지 않는다.
// herdr와 claude 없이 돈다(가짜 어댑터, 가짜 프로세스, 가짜 대화 기록).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { repoSleepPlan, sleepTarget, sessionActivity, backgroundOf, parseExitBackground, Sleeper, SLEEP_REASONS, SLEEP_RETRY_MS, SLEEP_RETRY_MAX_MS, BG_HOOK_MAX_MS, isActivity } from '../src/sleep.mjs';
import { isToolCommand } from '../src/resources.mjs';
import { newRuntime, deriveState, applyHerdrStatus, applyAgentDetected, applyAgentReleased, applyHook } from '../src/state.mjs';
import { transcriptPathFor } from '../src/launch.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p105-'));
const MIN = 60000;
const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-00000000a105`;
const R = (name, x = {}) => ({ name, kind: 'claude', hooked: true, convKnown: true, state: 'ready', sleeping: false, waking: false, closing: false, delivering: 0, loops: 0, bg: false, blocked: null, childBusy: false, parentBusy: false, viewed: false, draft: false, idleSince: 0, ...x });

// 실험에서 본 명령줄(경로는 일반화)
const BASH = { pid: 501, ppid: 9002, name: 'bash.exe', cmd: '"C:\\Program Files\\Git\\bin\\bash.exe" -c "source /c/home/.claude/shell-snapshots/snapshot-bash-1-abc.sh 2>/dev/null || true && ping -n 900 localhost"' };
const PWSH = { pid: 502, ppid: 9002, name: 'cmd.exe', cmd: 'C:\\WINDOWS\\System32\\cmd.exe /d /s /c ""C:\\WINDOWS\\System32\\chcp.com" 65001 >nul & "C:\\x\\pwsh.exe"  -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$__claudeCodeScript = ..."' };
const MCP = { pid: 503, ppid: 9002, name: 'mcp-tool.exe', cmd: 'C:\\Tools\\mcp-tool.exe mcp' };
const NPX = { pid: 504, ppid: 9002, name: 'cmd.exe', cmd: 'cmd.exe /c npx -y some-mcp-server' };
const NODE = { pid: 505, ppid: 9002, name: 'node.exe', cmd: 'node C:\\x\\server.js --stdio' };

// /exit에 Claude Code가 띄운 확인 창(실험 화면을 일반화)
const BG_SCREEN = [
  '● started', '', '✻ Cooked for 5s · 1 shell still running', '▔▔▔▔▔▔▔▔',
  '   Background work is running', '   The following will stop when you exit:', '',
  '   shell · ping -n 900 localhost', '',
  '   ❯ 1. Exit and stop tasks', '     2. Move to background and exit', '     3. Stay', '',
  '   Enter to confirm · Esc to cancel',
].join('\n');
const PROMPT = ['● started', '', '────────', '❯ ', '────────', '  ⏸ manual mode on · 1 shell'].join('\n');

test('P105 도구 명령: Bash·PowerShell 도구 명령은 뒤 일이고 MCP 서버·다른 자식은 아니다', () => {
  assert.equal(isToolCommand(BASH), true);
  assert.equal(isToolCommand(PWSH), true);
  assert.equal(isToolCommand({ ...PWSH, name: 'pwsh.exe', cmd: '"C:\\x\\pwsh.exe" -NoProfile -Command "$__claudeCodeScript = 1"' }), true);
  for (const p of [MCP, NPX, NODE, { pid: 1, name: 'bash.exe', cmd: '' }, { pid: 2, name: 'bash.exe' }, null]) assert.equal(isToolCommand(p), false, JSON.stringify(p));
});

test('P105 뒤 일 판정: 프로세스가 있으면 뒤 일, hook 목록은 프로세스로 끝났는지 다시 보고 오래된 기록은 믿지 않는다', () => {
  const now = 10 * 60 * MIN;
  const shell = { tasks: [{ id: 'b1', type: 'shell' }], at: now - 5 * MIN };
  const agent = { tasks: [{ id: 'a1', type: 'subagent' }], at: now - 5 * MIN };
  assert.equal(backgroundOf(null, null, now), null);
  assert.equal(backgroundOf({ tasks: [], at: now }, null, now), null);
  assert.deepEqual(backgroundOf(null, { at: now, n: 2 }, now), { n: 2, via: 'process' }, 'hook이 없는 claude도 도구 명령 프로세스로 안다');
  assert.deepEqual(backgroundOf(shell, null, now), { n: 1, via: 'hook' }, '프로세스를 아직 보지 않았으면 hook을 믿는다');
  assert.deepEqual(backgroundOf(shell, { at: now - 6 * MIN, n: 0 }, now), { n: 1, via: 'hook' }, 'hook보다 먼저 본 프로세스는 증거가 아니다');
  assert.equal(backgroundOf(shell, { at: now - MIN, n: 0 }, now), null, 'hook 뒤에 보니 도구 명령이 없다: 뒤 셸은 끝났다(낡은 목록)');
  assert.deepEqual(backgroundOf(agent, { at: now - MIN, n: 0 }, now), { n: 1, via: 'hook' }, '뒤 하위 에이전트는 프로세스가 따로 없어 hook을 믿는다');
  assert.equal(backgroundOf({ ...agent, at: now - BG_HOOK_MAX_MS - 1 }, null, now), null, '오래된 hook 기록은 믿지 않는다');
});

test('P105 확인 창: /exit의 뒤 일 확인 창을 알아보고 보통 화면은 아니다', () => {
  assert.deepEqual(parseExitBackground(BG_SCREEN), { tasks: 1 });
  assert.equal(parseExitBackground(PROMPT), null);
  assert.equal(parseExitBackground(''), null);
});

test('P105 판정: 뒤 일은 리포를 깨워 두는 일이고(손으로도), 실패를 미루는 세션은 대상에서 빠진다(손으로는 다시 해 본다)', () => {
  const now = 100 * MIN, o = { now, afterMs: 30 * MIN };
  const idle = (n, x = {}) => R(n, { idleSince: now - 40 * MIN, ...x });
  assert.ok(SLEEP_REASONS.includes('background') && SLEEP_REASONS.includes('sleep_failed'));
  assert.equal(isActivity('background'), true); assert.equal(isActivity('sleep_failed'), false);
  assert.equal(sessionActivity(R('a', { bg: true })), 'background');
  assert.equal(sessionActivity(R('a', { bg: true }), { mode: 'hand' }), 'background', '손으로 잠재워도 뒤 일은 함께 끝나므로 막는다');
  assert.deepEqual(repoSleepPlan([idle('a1'), idle('a2', { bg: true })], o), { why: 'background', who: 'a2', targets: ['a1', 'a2'], since: now - 40 * MIN });
  // 실패를 미루는 세션
  assert.equal(sleepTarget(R('a', { blocked: 'sleep_failed' })), 'sleep_failed');
  assert.equal(sleepTarget(R('a', { blocked: 'sleep_failed' }), { mode: 'hand' }), null);
  assert.deepEqual(repoSleepPlan([idle('a1'), idle('a2', { blocked: 'sleep_failed' })], o).targets, ['a1'], '다른 세션은 잠든다');
  const only = repoSleepPlan([idle('a1', { blocked: 'sleep_failed' })], o);
  assert.equal(only.why, 'sleep_failed'); assert.equal(only.who, 'a1');
  assert.equal(repoSleepPlan([idle('a1', { blocked: 'sleep_failed' })], { ...o, mode: 'hand' }).why, null);
  // 셸 세션의 명령은 그대로 리포를 깨워 두지 않는다(P24)
  assert.equal(repoSleepPlan([idle('a1'), R('sh', { kind: 'shell', hooked: false, state: 'shell_running', idleSince: 0 })], o).why, null);
});

// ---------- 가짜 판 ----------
// exitScreen: /exit 뒤 화면. 'bg'면 뒤 일 확인 창을 띄우고 claude가 남는다(Esc면 창이 닫힘), 'stuck'이면 화면은 그대로 claude가 남는다, 없으면 끝난다
function fakeBoard({ exitScreen = null, kids = [], panes = [], panesFail = false } = {}) {
  const root = tmp(), cwd = tmp();
  const events = [], calls = [];
  const sessions = new Map();
  const store = { saveRuntime: () => {}, updateSession: () => {}, addEvent: (sid, kind, data) => events.push({ sid, kind, data }) };
  const queue = new EventEmitter(); queue.items = []; queue.pending = (sid) => queue.items.filter((d) => d.sessionId === sid).length; queue.cancelSession = () => {};
  let screen = PROMPT;
  const proc = { kids: [...kids] };
  const b = {
    cfg: { claudeProjects: root, killWaitMs: 600 }, sessions, store, queue, killing: new Set(), log: () => {},
    hooked: (s) => s.rt.hooked !== false, relay: { stats: () => [], detach: () => {} },
    features: { loops: { activeCount: () => 0 }, settings: { get: () => ({ sleepAfterMin: 30, sessionSleepAfterMin: 0 }) } }, // P111: 리포 규칙만 본다(세션 규칙은 p111.test.mjs)
    requireHerdr: () => {},
    resolve: (ref) => sessions.get(ref) || [...sessions.values()].find((s) => s.name === ref),
    broadcastSession: (s, o) => calls.push(['broadcast', s.name, deriveState(s.rt).state, o && o.cause]),
    adapter: {
      connected: true,
      processInfo: async () => ({ shell_pid: 9001, foreground_processes: [{ pid: 9002, name: 'claude.exe' }] }),
      readScreen: async () => screen,
      sendText: async (pane, t) => { calls.push(['sendText', pane, t]); },
      paneKeys: async (pane, k) => {
        calls.push(['paneKeys', pane, k.join('+')]);
        const s = [...sessions.values()].find((x) => x.paneId === pane);
        if (k[0] === 'enter') {
          if (exitScreen === 'bg') { screen = BG_SCREEN; applyHerdrStatus(s.rt, 'blocked'); }
          else if (exitScreen !== 'stuck') setTimeout(() => applyAgentReleased(s.rt), 30);
        } else if (k[0] === 'esc' && screen === BG_SCREEN) { screen = PROMPT; applyHerdrStatus(s.rt, 'idle'); }
      },
      workspacePanes: async () => { if (panesFail) throw Object.assign(new Error('x'), { code: 'herdr_error' }); return panes; },
      closeWorkspace: async (id) => { calls.push(['closeWorkspace', id]); },
      closePane: async (id) => { calls.push(['closePane', id]); },
      refreshSubscription: async () => {},
    },
  };
  const rt = newRuntime({ kind: 'claude', hooked: true });
  applyAgentDetected(rt); applyHerdrStatus(rt, 'idle');
  rt.lastActivityAt = Date.now() - 40 * MIN; rt.lastHookAt = Date.now() - 40 * MIN; rt.launchedAt = Date.now() - 60 * MIN;
  const s = { sessionId: ID(1), name: 'a1', cwd, kind: 'claude', origin: 'board', paneId: 'w1:p1', herdrWorkspaceId: 'w1', agentName: 'a1', settingsPath: 'C:/d/a1.json', rt, touchedAt: Date.now() - 40 * MIN };
  sessions.set(s.sessionId, s);
  const f = transcriptPathFor(root, cwd, s.sessionId); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '{}\n');
  const readTable = async () => ({ procs: new Map([[9001, { pid: 9001, ppid: 1, ws: 50 * 1048576, name: 'powershell.exe' }], [9002, { pid: 9002, ppid: 9001, ws: 300 * 1048576, name: 'claude.exe' }]]) });
  const reads = [];
  const readChildren = async (pids) => { reads.push(pids); return proc.kids.filter((k) => pids.includes(k.ppid)); };
  const sl = new Sleeper(b, { timers: false, readTable, readChildren });
  b.sleeper = sl;
  return { b, s, sl, events, calls, proc, reads };
}
const exits = (calls) => calls.filter((c) => c[0] === 'sendText' && c[2] === '/exit').length;

test('P105 저절로: 뒤 셸 프로세스가 도는 세션의 리포는 잠들지 않고(까닭 background), 끝나면 그때부터 정한 시간 뒤 잠든다', async () => {
  const { s, sl, calls, proc, reads } = fakeBoard({ kids: [BASH, MCP] });
  assert.equal(sl.plan('', 'auto').why, null, '프로세스를 보기 전에는 쉬는 리포다');
  await sl.tick();
  assert.deepEqual(reads, [[9002]], '곧 잠들 리포의 claude 자식을 한 번 읽는다');
  assert.equal(exits(calls), 0, '/exit를 보내지 않는다');
  const st = sl.status().repos[0];
  assert.equal(st.why, 'background'); assert.equal(st.who, 'a1'); assert.deepEqual(st.background, [{ name: 'a1', n: 1, via: 'process' }]);
  // MCP 서버만 남으면 뒤 일이 아니다. 뒤 일이 끝난 때부터 다시 센다
  proc.kids = [MCP];
  await sl.tick();
  assert.equal(reads.length, 2, '뒤 일이 보이는 리포는 tick마다 다시 본다');
  assert.equal(exits(calls), 0);
  assert.equal(sl.plan('', 'auto').why, 'idle_short', '마지막으로 뒤 일을 본 때부터 센다');
  assert.equal(sl.plan('', 'auto', Date.now() + 31 * MIN).why, null);
  await sl.tick();
  assert.equal(reads.length, 2, '쉬는 시간이 차지 않은 리포는 프로세스를 읽지 않는다');
  sl.busyAt.set('', Date.now() - 31 * MIN);
  await sl.tick();
  assert.equal(exits(calls), 1); assert.equal(deriveState(s.rt).state, 'sleeping');
});

test('P105 hook: Stop의 background_tasks가 있으면 잠들지 않고, 그 뒤 프로세스에 도구 명령이 없으면 끝난 것으로 본다(낡은 목록)', async () => {
  const { s, sl, calls, proc } = fakeBoard({ kids: [BASH] });
  applyHook(s.rt, { hook_event_name: 'Stop', background_tasks: [{ id: 'b1', type: 'shell', status: 'running', command: 'ping -n 900 localhost' }] }, Date.now() - 40 * MIN);
  assert.deepEqual(s.rt.bg.tasks, [{ id: 'b1', type: 'shell' }], '명령 글은 남기지 않는다(P92)');
  assert.equal(sl.plan('', 'auto').why, 'background');
  await sl.tick();
  assert.equal(exits(calls), 0);
  proc.kids = [];
  await sl.tick(); // 프로세스로 끝난 것을 본다
  assert.equal(sl.bgOf(s), null);
  // 뒤 하위 에이전트는 hook만 믿는다
  applyHook(s.rt, { hook_event_name: 'Stop', background_tasks: [{ id: 'x', type: 'subagent', status: 'running' }] }, Date.now());
  s.rt.lastHookAt = Date.now() - 40 * MIN;
  await sl.tick();
  assert.equal(sl.plan('', 'auto').why, 'background');
});

test('P105 확인 창: /exit에 뒤 일 확인 창이 뜨면 Esc로 닫고(Enter·1번 없음) 깨어 있는 채로 두며, 다음 활동까지 다시 잠재우지 않는다', async () => {
  const { s, sl, events, calls } = fakeBoard({ exitScreen: 'bg' });
  // 프로세스·hook으로는 모르는 뒤 일(예: 뒤 하위 에이전트, 옛 Claude Code)
  await assert.rejects(sl.sleep(s, { by: 'auto' }), (e) => e.code === 'sleep_background' && e.key === 'sleepRefused' && e.vars.reason.key === 'sleepWhy_background');
  const keys = calls.filter((c) => c[0] === 'paneKeys').map((c) => c[2]);
  assert.deepEqual(keys, ['enter', 'esc'], '/exit의 Enter 뒤에는 Esc만 보낸다');
  assert.equal(s.paneId, 'w1:p1'); assert.equal(s.rt.sleep, null); assert.equal(s.rt.exitRequested, false);
  assert.equal(deriveState(s.rt).state, 'ready', '확인 창이 닫혀 응답 필요로 남지 않는다');
  assert.ok(!calls.some((c) => c[0] === 'closeWorkspace' || c[0] === 'closePane'));
  const ev = events.find((e) => e.kind === 'sleep_exit_screen');
  assert.deepEqual({ ...ev.data, retryMs: undefined }, { background: true, tasks: 1, esc: 1, cleared: true, retryMs: undefined });
  assert.equal(ev.data.retryMs, SLEEP_RETRY_MS);
  // 리포는 뒤 일이 있는 것으로 보이고 tick은 다시 /exit를 보내지 않는다
  assert.equal(sl.plan('', 'auto').why, 'background');
  sl.busyAt.set('', 0);
  await sl.tick(); await sl.tick();
  assert.equal(exits(calls), 1, '되풀이하지 않는다');
  await assert.rejects(sl.sleepRepoHand({ session: 'a1' }), (e) => e.code === 'sleep_background' && /백그라운드 작업/.test(e.message));
  assert.equal(exits(calls), 1, '손으로 잠재워도 뒤 일이 있으면 /exit를 보내지 않고 까닭을 알린다');
  // 새 활동(뒤 일이 끝나 Claude Code가 새 턴을 돌림)이 있으면 풀린다
  s.rt.lastHookAt = Date.now();
  assert.equal(sl.blockOf(s), null);
  assert.equal(sl.plan('', 'auto').why, 'idle_short');
});

test('P105 실패: /exit 뒤에도 claude가 남으면 그 세션을 미루고(두 배씩, 상한), 리포의 다른 세션은 잠든다. 손으로는 다시 해 본다', async () => {
  const { s, sl, b, events, calls } = fakeBoard({ exitScreen: 'stuck' });
  await assert.rejects(sl.sleep(s, { by: 'auto' }), (e) => e.code === 'still_running');
  let e = sl.blocked.get(s.sessionId);
  assert.equal(e.why, 'sleep_failed'); assert.equal(e.n, 1); assert.equal(e.until - e.at, SLEEP_RETRY_MS);
  assert.ok(events.some((x) => x.kind === 'sleep_blocked'));
  assert.equal(sl.plan('', 'auto').why, 'sleep_failed'); assert.equal(sl.plan('', 'auto').who, 'a1');
  await sl.tick(); await sl.tick();
  assert.equal(exits(calls), 1, '저절로는 되풀이하지 않는다');
  assert.equal(sl.status().repos[0].blocked[0].why, 'sleep_failed');
  // 손으로 잠재우면 다시 해 본다. 같은 쉼에서 또 실패하면 간격이 두 배
  await sl.sleepRepoHand({ session: 'a1' });
  assert.equal(exits(calls), 2);
  e = sl.blocked.get(s.sessionId);
  assert.equal(e.n, 2); assert.equal(e.until - e.at, 2 * SLEEP_RETRY_MS);
  for (let i = 0; i < 3; i++) await sl.sleepRepoHand({ session: 'a1' });
  e = sl.blocked.get(s.sessionId);
  assert.equal(e.until - e.at, SLEEP_RETRY_MAX_MS, '상한');
  // 간격이 지나면 저절로 다시 해 본다
  e.until = Date.now() - 1;
  assert.equal(sl.plan('', 'auto').why, null);
  // 같은 리포에 다른 세션이 있으면 그 세션은 잠든다
  const rt2 = newRuntime({ kind: 'claude', hooked: true }); applyAgentDetected(rt2); applyHerdrStatus(rt2, 'idle'); rt2.lastHookAt = Date.now() - 40 * MIN; rt2.launchedAt = Date.now() - 60 * MIN;
  const s2 = { ...s, sessionId: ID(2), name: 'a2', paneId: 'w2:p1', herdrWorkspaceId: 'w2', rt: rt2 };
  fs.writeFileSync(transcriptPathFor(b.cfg.claudeProjects, s.cwd, s2.sessionId), '{}\n');
  b.sessions.set(s2.sessionId, s2);
  e.until = Date.now() + MIN;
  assert.deepEqual(sl.plan('', 'auto').targets, ['a2']);
});

test('P105 패널: 같은 작업 공간에 다른 패널이 있거나 패널 목록을 읽지 못하면 이 패널만 닫는다', async () => {
  {
    const { s, sl, calls } = fakeBoard({ panes: [{ paneId: 'w1:p1' }, { paneId: 'w1:p2' }] });
    await sl.sleep(s, { by: 'auto' });
    assert.ok(calls.some((c) => c[0] === 'closePane' && c[1] === 'w1:p1'));
    assert.ok(!calls.some((c) => c[0] === 'closeWorkspace'));
  }
  {
    const { s, sl, calls } = fakeBoard({ panesFail: true });
    await sl.sleep(s, { by: 'auto' });
    assert.ok(calls.some((c) => c[0] === 'closePane'), '목록을 몰라도 작업 공간을 통째로 닫지 않는다');
    assert.ok(!calls.some((c) => c[0] === 'closeWorkspace'));
  }
  {
    const { s, sl, calls } = fakeBoard({ panes: [{ paneId: 'w1:p1' }] });
    const out = await sl.sleep(s, { by: 'auto' });
    assert.ok(calls.some((c) => c[0] === 'closePane' && c[1] === 'w1:p1'), '마지막 패널도 그 패널만 닫아 조회 뒤 생긴 형제를 보존한다');
    assert.ok(!calls.some((c) => c[0] === 'closeWorkspace'));
    assert.equal(sl.blocked.has(s.sessionId), false); assert.equal(out.slept, true);
  }
});
