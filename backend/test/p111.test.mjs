// P111 단위 시험: 세션 규칙(리포가 바빠도 오래 쉰 세션을 혼자 잠재운다, ARCH 4절 D4). 리포 규칙(P24)이 먼저, 잠든 까닭(scope repo | session),
// 깨우기 범위(혼자 잠든 세션은 혼자, 리포째 잠든 세션은 리포째), 설정 sessionSleepAfterMin, 에이전트에게 주는 글. herdr와 claude 없이 돈다(가짜 어댑터).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { sessionSleepPlan, sleepScope, Sleeper, SLEEP_REASONS } from '../src/sleep.mjs';
import { newRuntime, deriveState, applyHerdrStatus, applyAgentDetected, applyAgentReleased } from '../src/state.mjs';
import { transcriptPathFor, BOARD_SYSTEM_PROMPT } from '../src/launch.mjs';
import { SETTINGS, DEFAULTS, normalizePatch } from '../src/settings.mjs';
import { boardSkill } from '../src/branch.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p111-'));
const MIN = 60000;
const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-00000000a111`;
const X = (x = {}) => ({ name: 'w', kind: 'claude', hooked: true, convKnown: true, state: 'ready', sleeping: false, waking: false, closing: false, delivering: 0, loops: 0, childBusy: false, descBusy: false, parentBusy: false, viewed: false, draft: false, bg: false, blocked: null, idleSince: 0, ...x });

test('P111 판정: 세션 하나가 정한 시간 동안 쉬면 혼자 잠재운다. 예외 하나하나, 일하는 자손, 시간, 0이면 끔', () => {
  const now = 100 * MIN, o = { now, afterMs: 30 * MIN };
  const idle = (x = {}) => X({ idleSince: now - 40 * MIN, ...x });
  assert.deepEqual(sessionSleepPlan(idle(), o), { why: null, since: now - 40 * MIN, target: null });
  for (const [x, why] of [
    [{ state: 'working' }, 'working'], [{ state: 'starting' }, 'working'], [{ state: 'waiting' }, 'needs_you'], [{ state: 'trust_wait' }, 'needs_you'],
    [{ waking: true }, 'waking'], [{ delivering: 1 }, 'delivering'], [{ loops: 1 }, 'loop'], [{ draft: true }, 'draft'], [{ bg: true }, 'background'],
    [{ viewed: true }, 'viewing'], [{ descBusy: true }, 'child_busy'], [{ blocked: 'sleep_failed' }, 'sleep_failed'],
    [{ sleeping: true, state: 'sleeping' }, 'asleep'], [{ convKnown: false }, 'nothing'], [{ kind: 'shell', hooked: false }, 'nothing'], [{ kind: 'codex', hooked: false }, 'nothing'], [{ hooked: false }, 'nothing'],
    [{ state: 'exited' }, 'nothing'],
  ]) assert.equal(sessionSleepPlan(idle(x), o).why, why, JSON.stringify(x));
  for (const w of ['child_busy', 'viewing', 'background', 'sleep_failed', 'asleep', 'nothing', 'off', 'idle_short']) assert.ok(SLEEP_REASONS.includes(w), w);
  // 일하는 부모는 막지 않는다(늘 일하는 지휘 세션 아래 끝난 워커가 남지 않게)
  assert.equal(sessionSleepPlan(idle({ parentBusy: true }), o).why, null);
  // 일하는 자손: 직접 하위가 아니어도(descBusy). descBusy를 모르는 옛 값이면 childBusy
  assert.equal(sessionSleepPlan(idle({ childBusy: false, descBusy: true }), o).why, 'child_busy');
  assert.equal(sessionSleepPlan(X({ idleSince: now - 40 * MIN, descBusy: undefined, childBusy: true }), o).why, 'child_busy');
  // 시간: 사람이 손댄 때(idleSince)와 그 세션에 마지막으로 일이 보인 때(busyAt, 보던 노드 등)부터 센다
  assert.equal(sessionSleepPlan(idle({ idleSince: now - 29 * MIN }), o).why, 'idle_short');
  assert.equal(sessionSleepPlan(idle(), { ...o, busyAt: now - 10 * MIN }).why, 'idle_short');
  assert.equal(sessionSleepPlan(idle(), { ...o, busyAt: now - 31 * MIN }).why, null);
  assert.equal(sessionSleepPlan(idle(), { ...o, afterMs: 0 }).why, 'off');
  assert.equal(sessionSleepPlan(idle({ state: 'error' }), o).why, null, '오류로 끝난 턴도 쉬는 중');
});

test('P111 설정: sessionSleepAfterMin 기본 30, 0~1440 정수, 리포 칸 글은 프로젝트 전체', () => {
  assert.equal(DEFAULTS.sessionSleepAfterMin, 30);
  assert.equal(SETTINGS.sessionSleepAfterMin.min, 0); assert.equal(SETTINGS.sessionSleepAfterMin.max, 1440);
  assert.deepEqual(normalizePatch({ sessionSleepAfterMin: 0 }), { sessionSleepAfterMin: 0 });
  assert.deepEqual(normalizePatch({ sessionSleepAfterMin: '1440' }), { sessionSleepAfterMin: 1440 });
  for (const v of [-1, 1441, 1.5, 'x']) assert.throws(() => normalizePatch({ sessionSleepAfterMin: v }), /0~1440/);
  assert.match(SETTINGS.sleepAfterMin.label, /프로젝트 전체/);
  assert.equal(DEFAULTS.sleepAfterMin, 30, '리포 규칙 기본값은 그대로');
});

test('P111 에이전트 글: 판 시스템 글, atrium 스킬, CLI 도움말이 세션 혼자 잠들기와 깨우기 범위를 말한다', () => {
  assert.match(BOARD_SYSTEM_PROMPT, /오래 쉰 세션은 혼자 잠재운다/);
  assert.match(BOARD_SYSTEM_PROMPT, /`atrium wake <이름>`으로 그 세션을\(리포째 잠들었으면 그 리포를\) 깨운/);
  assert.doesNotMatch(BOARD_SYSTEM_PROMPT, /`atrium wake <이름>`으로 그 리포를 깨운 뒤/);
  assert.match(boardSkill(), /오래 쉰 워커는 혼자 잠든다/);
  assert.match(boardSkill('delegate'), /리포째 잠들었으면 그 리포를/);
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin');
  assert.match(fs.readFileSync(path.join(bin, 'atrium-child.mjs'), 'utf8'), /혼자 잠든 세션은 그 세션만, 리포째 잠들었으면/);
  assert.match(fs.readFileSync(path.join(bin, 'atrium.mjs'), 'utf8'), /이름이면 그 세션\(프로젝트 전체가 절전되었으면 그 프로젝트\)/);
});

// ---------- 가짜 판: 리포 A(헤드 lead, 하위 c1·c2·c3, c1 아래 g1)와 리포 B(b1) ----------
function board({ repoMin = 30, sessMin = 30 } = {}) {
  const root = tmp();
  const dirs = { ka: tmp(), kb: tmp() };
  const events = [], calls = [];
  const sessions = new Map();
  const settings = { sleepAfterMin: repoMin, sessionSleepAfterMin: sessMin };
  const store = { saveRuntime: () => {}, updateSession: () => {}, addEvent: (sid, kind, data) => events.push({ sid, kind, data }), workspaces: () => [{ key: 'ka', root: 'C:/x/repo-a' }, { key: 'kb', root: 'C:/x/repo-b' }] };
  const queue = new EventEmitter(); queue.items = []; queue.pending = (sid) => queue.items.filter((d) => d.sessionId === sid).length; queue.cancelSession = () => {};
  let wsN = 10;
  const b = {
    cfg: { claudeProjects: root, killWaitMs: 2000 }, sessions, store, queue, killing: new Set(), log: () => {},
    hooked: (s) => s.kind === 'claude', relay: { stats: () => [], detach: () => {} },
    features: { loops: { activeCount: () => 0 }, settings: { get: () => settings } },
    requireHerdr: () => {},
    resolve: (ref) => sessions.get(ref) || [...sessions.values()].find((s) => s.name === ref),
    resolveWorkspace: async (ref) => ({ key: ref === 'repo-a' ? 'ka' : ref === 'repo-b' ? 'kb' : ref }),
    broadcastSession: (s, o) => calls.push(['broadcast', s.name, deriveState(s.rt).state, !!s.waking, o && o.cause]),
    withNewPane: async (create, register) => { const r = await create(); await register(r); return r; },
    launchOf: (s) => ({ sessionId: s.sessionId, settingsPath: 'C:/d/x.json', permissionMode: 'manual', model: 'haiku', effort: null, pluginDir: 'C:/p', systemPromptFile: 'C:/p.md' }),
    registerResume: () => {},
    adapter: {
      connected: true,
      processInfo: async () => null,
      sendText: async () => {},
      paneKeys: async (pane) => { const s = [...sessions.values()].find((x) => x.paneId === pane); if (s) setTimeout(() => { applyAgentReleased(s.rt); for (const o of sessions.values()) if (o !== s && o.paneId && o.kind === 'claude' && o.rt.herdr.status) applyHerdrStatus(o.rt, o.rt.herdr.status); }, 10); },
      workspacePanes: async () => [], closeWorkspace: async () => {}, closePane: async () => {}, refreshSubscription: async () => {},
      createWorkspace: async () => { wsN++; return { paneId: `w${wsN}:p1`, workspaceId: `w${wsN}` }; },
      waitShellReady: async () => true,
      startAgent: async ({ name, paneId }) => { calls.push(['startAgent', name]); const s = [...sessions.values()].find((x) => x.paneId === paneId); setTimeout(() => { applyAgentDetected(s.rt); applyHerdrStatus(s.rt, 'idle'); }, 20); return { agent: { launchPending: true } }; },
    },
  };
  let n = 0;
  const add = (name, key, parent = null) => {
    const rt = newRuntime({ kind: 'claude', hooked: true });
    applyAgentDetected(rt); applyHerdrStatus(rt, 'idle');
    rt.lastActivityAt = Date.now() - 40 * MIN; rt.launchedAt = Date.now() - 60 * MIN; rt.lastHookAt = Date.now() - 40 * MIN;
    const cwd = dirs[key];
    const s = { sessionId: ID(++n), name, cwd, kind: 'claude', origin: 'board', paneId: `w${n}:p1`, herdrWorkspaceId: `w${n}`, agentName: name, rt, touchedAt: Date.now() - 40 * MIN, workspaceKey: key, parentSessionId: parent ? parent.sessionId : null };
    sessions.set(s.sessionId, s);
    const f = transcriptPathFor(root, cwd, s.sessionId); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '{}\n');
    return s;
  };
  const lead = add('lead', 'ka');
  const c1 = add('c1', 'ka', lead), c2 = add('c2', 'ka', lead), c3 = add('c3', 'ka', lead);
  const b1 = add('b1', 'kb');
  const sl = new Sleeper(b, { timers: false, wakeReadyMs: 3000, settleMs: 10, staggerMs: 30 });
  b.sleeper = sl;
  return { b, sl, lead, c1, c2, c3, b1, add, events, calls, settings };
}
const st = (s) => deriveState(s.rt).state;
const work = (s) => { s.rt.herdr.status = 'working'; };
const rest = (s) => { s.rt.herdr.status = 'idle'; s.rt.lastHookAt = Date.now(); s.touchedAt = Date.now(); };

test('P111 저절로: 헤드가 일하는 동안 쉬는 하위 세션은 혼자 잠들고(scope session) 헤드는 남는다. 쉰 리포는 리포 규칙이 먼저', async () => {
  const { sl, lead, c1, c2, c3, b1, events } = board();
  work(lead);
  await sl.tick();
  assert.deepEqual([st(lead), st(c1), st(c2), st(c3)], ['working', 'sleeping', 'sleeping', 'sleeping']);
  assert.deepEqual([c1, c2, c3].map(sleepScope), ['session', 'session', 'session']);
  assert.equal(st(b1), 'sleeping', '쉰 리포 B는 리포 규칙으로');
  assert.equal(sleepScope(b1), 'repo');
  assert.ok(!events.some((e) => e.kind === 'repo_slept' && e.data.workspace === 'ka'), '리포 A는 리포째 잠들지 않았다');
  assert.deepEqual(events.filter((e) => e.kind === 'slept' && e.data.scope === 'session').map((e) => e.data.name).sort(), ['c1', 'c2', 'c3']);
  const status = sl.status();
  assert.equal(status.sessionAfterMin, 30);
  const ra = status.repos.find((r) => r.key === 'ka');
  assert.equal(ra.why, 'working'); assert.equal(ra.who, 'lead');
  assert.deepEqual(ra.each.map((x) => [x.name, x.why, x.scope || null]), [['lead', 'working', null], ['c1', 'asleep', 'session'], ['c2', 'asleep', 'session'], ['c3', 'asleep', 'session']]);
  assert.deepEqual(status.sessions.filter((x) => x.workspace === 'ka').map((x) => x.scope), ['session', 'session', 'session']);
  assert.equal(sl.summaryExtra(c1).sleep.scope, 'session');
});

test('P111 저절로: 일하는 자손(하위의 하위까지)이 있는 세션, 보는 노드, 최근 손댄 세션은 혼자 잠들지 않는다. 보기를 그만둔 때부터 센다', async () => {
  const { sl, b, lead, c1, c2, c3, add } = board();
  const g1 = add('g1', 'ka', c1);
  work(g1); // 손주가 일한다: c1(부모)과 lead(조부모)는 잠들지 않는다
  b.relay.stats = () => [{ sessionId: c2.sessionId }]; // c2를 본다
  c3.touchedAt = Date.now() - 5 * MIN; // c3는 5분 전에 손댔다
  await sl.tick();
  assert.deepEqual([st(lead), st(c1), st(c2), st(c3), st(g1)], ['ready', 'ready', 'ready', 'ready', 'working']);
  assert.equal(sl.sessionPlan(lead).why, 'child_busy'); assert.equal(sl.sessionPlan(c1).why, 'child_busy');
  assert.equal(sl.sessionPlan(c2).why, 'viewing'); assert.equal(sl.sessionPlan(c3).why, 'idle_short');
  // 손주가 끝나고 보기를 그만두면 그때부터 다시 센다(그 세션들은 40분 전부터 쉬었지만)
  rest(g1); b.relay.stats = () => [];
  await sl.tick();
  assert.deepEqual([st(lead), st(c1), st(c2)], ['ready', 'ready', 'ready']);
  assert.equal(sl.sessionPlan(c2).why, 'idle_short');
  assert.equal(sl.sessionPlan(lead).why, 'idle_short');
});

test('P111 저절로: sessionSleepAfterMin 0이면 세션 규칙을 끈다(리포 규칙은 따로). 하위 세션이 일하면 쉬는 헤드는 잠들지 않는다', async () => {
  const off = board({ sessMin: 0 });
  work(off.lead);
  await off.sl.tick();
  assert.deepEqual([st(off.c1), st(off.c2), st(off.b1)], ['ready', 'ready', 'sleeping']);
  const on = board();
  work(on.c2);
  await on.sl.tick();
  assert.deepEqual([st(on.lead), st(on.c1), st(on.c2), st(on.c3)], ['ready', 'sleeping', 'working', 'sleeping'], '헤드는 일하는 하위가 있어 남고, 쉬는 형제는 잠든다');
  assert.equal(on.sl.sessionPlan(on.lead).why, 'child_busy');
});

test('P111 깨우기: 혼자 잠든 세션은 혼자 깬다(누르기·전달·atrium wake). 리포 규칙이 리포를 잠재워도 혼자 잠든 세션은 session 그대로이고, 리포를 깨워도 잔다', async () => {
  const { sl, lead, c1, c2, c3, calls } = board();
  work(lead);
  await sl.tick();
  // 누르기: c2만 깬다
  const r = await sl.wakeOne({ session: 'c2', why: 'click' });
  assert.equal(r.woke, true); assert.equal(r.repo.waking, 1);
  assert.deepEqual([st(c1), st(c2), st(c3)], ['sleeping', 'ready', 'sleeping']);
  assert.ok(!c1.waking && !c3.waking, '다른 잠든 세션은 깨우는 중도 아니다');
  // 글 보내기(대기열 → wakeFor): c3만
  await sl.wakeFor(c3, 'delivery');
  assert.deepEqual([st(c1), st(c3)], ['sleeping', 'ready']);
  assert.deepEqual(calls.filter((c) => c[0] === 'startAgent').map((c) => c[1]), ['c2', 'c3']);
  // 모두 쉬면 리포 규칙: lead, c2, c3가 리포째 잠든다. 앞서 혼자 잠든 c1은 session 그대로
  for (const s of [lead, c2, c3]) { rest(s); s.rt.lastHookAt = Date.now() - 40 * MIN; s.touchedAt = Date.now() - 40 * MIN; s.wokeAt = Date.now() - 40 * MIN; s.rt.launchedAt = Date.now() - 40 * MIN; }
  sl.busyAt.set('ka', Date.now() - 40 * MIN);
  await sl.tick();
  assert.deepEqual([lead, c1, c2, c3].map(st), ['sleeping', 'sleeping', 'sleeping', 'sleeping']);
  assert.deepEqual([lead, c1, c2, c3].map(sleepScope), ['repo', 'session', 'repo', 'repo']);
  // lead를 누르면 리포 규칙이 잠재운 lead·c2·c3만 깬다(lead 먼저). c1은 잔다(깨우는 중도 아니다)
  const r2 = await sl.wakeOne({ session: 'lead', why: 'click' });
  assert.equal(r2.repo.waking, 3);
  assert.ok(!c1.waking);
  await Promise.all([...sl.wakes.values()]);
  assert.deepEqual([lead, c1, c2, c3].map(st), ['ready', 'sleeping', 'ready', 'ready']);
  assert.equal(sleepScope(c1), 'session');
  assert.equal(calls.filter((c) => c[0] === 'startAgent').map((c) => c[1])[2], 'lead');
  // c1을 누르면 c1만
  const r3 = await sl.wakeOne({ session: 'c1', why: 'click' });
  assert.equal(r3.repo.waking, 1); assert.equal(st(c1), 'ready');
});

test('P111 깨우기 범위: 리포째 잠든 세션을 깨워도 혼자 잠든 세션은 그대로, 이름표 메뉴(workspace.wake)는 둘 다', async () => {
  const { sl, lead, c1, c2, c3 } = board();
  work(lead);
  await sl.tick(); // c1~c3 혼자
  rest(lead); lead.rt.lastHookAt = Date.now() - 40 * MIN; lead.touchedAt = Date.now() - 40 * MIN;
  await sl.sleep(lead, { by: 'hand', mode: 'hand' }); // 리포째(손) 하나만: 옛 기록처럼 scope repo
  assert.equal(sleepScope(lead), 'repo');
  const r = await sl.wakeOne({ session: 'lead', why: 'click' });
  assert.equal(r.repo.waking, 1, '리포째 잠든 것은 lead뿐');
  assert.deepEqual([lead, c1, c2, c3].map(st), ['ready', 'sleeping', 'sleeping', 'sleeping']);
  const h = await sl.wakeRepoHand({ workspace: 'repo-a' });
  assert.equal(h.woke, 3);
  assert.deepEqual([c1, c2, c3].map(st), ['ready', 'ready', 'ready']);
  // scope가 없는 옛 기록은 리포째로 본다
  assert.equal(sleepScope({ rt: { sleep: { at: 1 } } }), 'repo');
  assert.equal(sleepScope({ rt: { sleep: null } }), 'repo');
});
