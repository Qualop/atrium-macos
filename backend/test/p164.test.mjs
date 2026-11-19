// P164: 쉬는 세션의 뒤 일(뒤 셸·뒤 하위 에이전트)을 세션 맵에 보이기 위한 목록(backgroundList), 요약·그래프 필드, 다시 보기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundList, backgroundOf, BG_HOOK_MAX_MS, Sleeper } from '../src/sleep.mjs';
import { missionGraph } from '../src/mission.mjs';
import { newRuntime, applyHook } from '../src/state.mjs';

const MIN = 60000;
const now = 10 * 3600 * 1000;
const hook = (tasks, at = now - 5 * MIN) => ({ tasks, at });
const sh = (label = 'sleep 60') => ({ id: 'b1', type: 'shell', label });
const ag = (label = 'look around') => ({ id: 'a1', type: 'subagent', label });

test('뒤 일 목록: hook만, 프로세스만, 둘 다, 낡은 hook은 프로세스 확인으로 꺼짐', () => {
  assert.equal(backgroundList(null, null, now), null);
  assert.equal(backgroundList(hook([]), { at: now, n: 0 }, now), null);
  // hook만(프로세스를 아직 보지 않음)
  assert.deepEqual(backgroundList(hook([sh(), ag()]), null, now), { n: 2, kinds: ['shell', 'agent'], items: [{ kind: 'shell', label: 'sleep 60' }, { kind: 'agent', label: 'look around' }], at: now - 5 * MIN, via: 'hook' });
  // 프로세스만(hook이 없는 claude)
  assert.deepEqual(backgroundList(null, { at: now, n: 2 }, now), { n: 2, kinds: ['shell'], items: [{ kind: 'shell', label: null }, { kind: 'shell', label: null }], at: now, via: 'process' });
  // 둘 다: hook 뒤에 본 프로세스 수가 셸 수다. 설명은 hook 차례로 붙인다
  const both = backgroundList(hook([sh('a'), { id: 'b2', type: 'shell', label: 'b' }, ag()]), { at: now - MIN, n: 1 }, now);
  assert.equal(both.n, 2);
  assert.deepEqual(both.items, [{ kind: 'shell', label: 'a' }, { kind: 'agent', label: 'look around' }]);
  assert.equal(both.via, 'both');
  // 낡은 hook: hook 뒤에 보니 도구 명령이 없다 → 셸 항목은 끝났다
  assert.equal(backgroundList(hook([sh()]), { at: now - MIN, n: 0 }, now), null, '뒤 셸이 끝나면 표시가 꺼진다');
  // 하위 에이전트는 프로세스가 따로 없어 hook을 믿는다
  assert.deepEqual(backgroundList(hook([sh(), ag()]), { at: now - MIN, n: 0 }, now).kinds, ['agent']);
  // hook보다 먼저 본 프로세스는 셸을 줄이지 않는다
  assert.equal(backgroundList(hook([sh()]), { at: now - 6 * MIN, n: 0 }, now).n, 1);
  // 오래된 hook은 믿지 않는다
  assert.equal(backgroundList(hook([ag()], now - BG_HOOK_MAX_MS - 1), null, now), null);
  // 알 수 없는 종류는 other
  assert.deepEqual(backgroundList(hook([{ id: 'x', type: 'monitor', label: null }]), null, now).kinds, ['other']);
});

test('있다·없다는 절전 판정(backgroundOf)과 같다', () => {
  const cases = [[null, null], [hook([sh()]), null], [hook([sh()]), { at: now - MIN, n: 0 }], [hook([ag()]), { at: now - MIN, n: 0 }], [null, { at: now, n: 1 }], [hook([sh()]), { at: now - 6 * MIN, n: 0 }], [hook([ag()], now - BG_HOOK_MAX_MS - 1), null], [hook([]), { at: now, n: 3 }]];
  for (const [h, s] of cases) assert.equal(!!backgroundList(h, s, now), !!backgroundOf(h, s, now), JSON.stringify([h, s]));
});

test('hook 설명 한 줄: 설명이 없으면 명령, 하위 에이전트는 agent_type, 길면 자른다', () => {
  const rt = newRuntime();
  applyHook(rt, { hook_event_name: 'Stop', background_tasks: [{ id: 'b1', type: 'shell', status: 'running', command: 'sleep  60\n&& echo done' }, { id: 'a1', type: 'subagent', status: 'running', agent_type: 'general-purpose' }, { id: 'b2', type: 'shell', status: 'running', description: 'x'.repeat(300) }, { id: 'b3', type: 'shell', status: 'running' }] });
  assert.deepEqual(rt.bg.tasks.map((x) => x.label && x.label.length > 50 ? x.label.length : x.label), ['sleep 60 && echo done', 'general-purpose', 100, null]);
});

test('그래프 노드에 같은 뒤 일 필드를 싣는다(없으면 null)', () => {
  const bg = { n: 2, kinds: ['shell', 'agent'], items: [{ kind: 'shell', label: 'a' }, { kind: 'agent', label: 'b' }], at: now, via: 'both' };
  const g = missionGraph({ sessions: [{ sessionId: 's1', name: 'a', state: 'ready', background: bg }, { sessionId: 's2', name: 'b', state: 'ready', background: null }], now });
  const a = g.nodes.find((n) => n.sessionId === 's1'), b = g.nodes.find((n) => n.sessionId === 's2');
  assert.deepEqual(a.background, { n: 2, kinds: ['shell', 'agent'], items: bg.items, at: now });
  assert.equal(b.background, null);
});

// 판 흉내: 세션 하나와 broadcastSession 기록
function fakeBoard(s) {
  const sent = [];
  return { sent, b: { sessions: new Map([[s.sessionId, s]]), broadcastSession: (x, o) => sent.push([x.sessionId, o && o.cause]), log() {}, store: { saveRuntime() {} }, hooked: () => true, adapter: { connected: true, processInfo: async () => ({ foreground_processes: [{ name: 'claude.exe', pid: 42 }] }) } } };
}

test('다시 보기: 표시가 켜진 세션은 프로세스를 다시 보고, 뒤 셸이 끝나면 요약을 다시 보내 표시를 끈다', async () => {
  const rt = newRuntime({ now: Date.now() - 10 * MIN });
  rt.phase = 'running'; rt.term.status = 'idle'; rt.term.present = true;
  rt.bg = { tasks: [sh()], at: Date.now() - MIN };
  const s = { sessionId: 's1', name: 'a', kind: 'claude', paneId: 'p1', rt };
  const { b, sent } = fakeBoard(s);
  let kids = [{ pid: 7, ppid: 42, name: 'bash.exe', cmd: 'bash -c source /x/shell-snapshots/snapshot-bash-1.sh && sleep 60' }];
  const sl = new Sleeper(b, { timers: false, readChildren: async () => kids });
  assert.equal(sl.bgView(s).n, 1);
  await sl.refreshBackground();
  assert.equal(sl.bgView(s).via, 'both');
  assert.equal(sent.length, 1, '처음 보이는 표시를 알린다');
  await sl.refreshBackground();
  assert.equal(sent.length, 1, '바뀌지 않으면 다시 보내지 않는다');
  kids = [];
  await sl.refreshBackground();
  assert.equal(sl.bgView(s), null, '뒤 셸이 끝났다');
  assert.deepEqual(sent.at(-1), ['s1', 'background']);
  // 잠든 세션·패널 없는 세션·다른 종류는 보이지 않는다
  assert.equal(sl.bgView({ ...s, rt: { ...rt, sleep: { at: 1 } } }), null);
  assert.equal(sl.bgView({ ...s, kind: 'codex' }), null);
  assert.equal(sl.bgView({ ...s, paneId: null }), null);
});
