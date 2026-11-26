// P173 단위 시험: Claude Code가 대화를 압축하는 일(사람의 /compact, 쉬는 동안의 압축 "Compacted while idle")은 턴이 아니다.
// 개발용 판에서 본 hook 순서(Claude Code 2.1.325): 터미널 working → PreCompact(trigger) → SubagentStop(요약) → PostCompact → 터미널 done.
// UserPromptSubmit·Stop은 오지 않는다. 실제 판 기록의 쉬는 동안 압축도 같다(SubagentStop + working → done, 지시·Stop 없음).
// → 작업 완료(unseen)·턴 끝·마지막 답이 바뀌지 않고, 웹 푸시 끝남이 가지 않는다. 보통 턴 끝, 뒤 일 알림 턴, 승인 질문을 거친 턴은 그대로.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { newRuntime, applyHook, applyTermStatus, deriveState, flags, turnlessWork } from '../src/state.mjs';
import { HOOK_EVENTS } from '../src/launch.mjs';
import { Pusher, b64u } from '../src/web-push.mjs';
import { SETTLE_MS } from '../src/push-cycle.mjs';

const T0 = 1_794_000_000_000;
// 판이 띄운 Claude Code 하나: 지시 → 답 → 쉼. 마지막 턴 끝(Stop) = T0 + 2900
function session() {
  const rt = newRuntime({ now: T0 });
  applyTermStatus(rt, 'idle', T0);
  applyTermStatus(rt, 'working', T0 + 1000);
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: 'do it' }, T0 + 1010);
  applyHook(rt, { hook_event_name: 'Stop', last_assistant_message: 'done it' }, T0 + 2900);
  applyTermStatus(rt, 'done', T0 + 3000);
  return rt;
}
const HOUR = 3600_000;
// 개발용 판에서 본 /compact 순서
function compact(rt, at, { trigger = 'manual', pre = true } = {}) {
  applyTermStatus(rt, 'working', at);
  if (pre) applyHook(rt, { hook_event_name: 'PreCompact', trigger }, at + 100);
  applyHook(rt, { hook_event_name: 'SubagentStop', agent_type: '', last_assistant_message: '<analysis>summary</analysis>' }, at + 7000);
  if (pre) applyHook(rt, { hook_event_name: 'PostCompact', trigger, compact_summary: 'summary' }, at + 7200);
  applyTermStatus(rt, 'done', at + 7400);
}

test('판은 PreCompact·PostCompact hook을 받는다', () => {
  assert.ok(HOOK_EVENTS.includes('PreCompact'));
  assert.ok(HOOK_EVENTS.includes('PostCompact'));
});

test('사람이 친 /compact: 턴 없는 일, 턴 끝·마지막 답·작업 완료가 그대로', () => {
  const rt = session();
  const seenAt = T0 + 5000; // 사람이 답을 봤다
  assert.equal(flags(rt, { seenAt, now: T0 + 6000 }).unseen, false);
  const at = T0 + 60_000;
  applyTermStatus(rt, 'working', at);
  applyHook(rt, { hook_event_name: 'PreCompact', trigger: 'manual' }, at + 100);
  assert.deepEqual(deriveState(rt), { state: 'working', estimate: 'compacting' }, '압축 중은 보여도 된다');
  applyHook(rt, { hook_event_name: 'SubagentStop', last_assistant_message: '<analysis>x</analysis>' }, at + 7000);
  applyHook(rt, { hook_event_name: 'PostCompact', trigger: 'manual' }, at + 7200);
  applyTermStatus(rt, 'done', at + 7400);
  assert.equal(rt.lastWork.turnless, true);
  assert.equal(rt.lastWork.compact, 'manual');
  assert.equal(rt.turn.endedAt, T0 + 2900, '턴 끝은 그대로');
  assert.equal(rt.lastAnswer, 'done it', '마지막 답은 그대로');
  assert.equal(rt.lastPrompt, 'do it', '마지막 지시는 그대로');
  assert.equal(flags(rt, { seenAt, now: at + 8000 }).unseen, false, '작업 완료가 생기지 않는다');
  assert.equal(deriveState(rt).state, 'ready');
});

test('쉬는 동안의 압축(실제 판 기록 모양: PreCompact 없이 SubagentStop뿐)도 턴이 아니다', () => {
  const rt = session();
  compact(rt, T0 + HOUR, { pre: false });
  assert.equal(rt.lastWork.turnless, true);
  assert.equal(rt.lastWork.compact, undefined);
  assert.equal(rt.turn.endedAt, T0 + 2900);
});

test('안 본 턴이 있어도 압축이 턴 끝을 늦추지 않는다(작업 완료는 원래 턴 그대로)', () => {
  const rt = session();
  compact(rt, T0 + HOUR, { trigger: 'auto' });
  assert.equal(flags(rt, { seenAt: null, now: T0 + HOUR + 8000 }).unseen, true, '원래 안 본 턴');
  assert.equal(rt.turn.endedAt, T0 + 2900);
});

test('보통 턴, 뒤 일이 끝나 시작된 턴(Stop만), 승인 질문을 거친 턴은 턴이다', () => {
  const rt = session();
  assert.equal(rt.lastWork.turnless, false, '지시 + Stop');
  // 뒤 일 알림 턴: 지시 hook 없이 working, 끝에 Stop
  applyTermStatus(rt, 'working', T0 + 100_000);
  applyHook(rt, { hook_event_name: 'Stop', last_assistant_message: 'bg done' }, T0 + 104_000);
  applyTermStatus(rt, 'done', T0 + 104_100);
  assert.equal(rt.lastWork.turnless, false);
  assert.equal(rt.lastAnswer, 'bg done');
  // 승인 질문(blocked)을 거친 턴: 질문 뒤 이어 일한 구간도 같은 턴
  applyTermStatus(rt, 'working', T0 + 200_000);
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: 'next' }, T0 + 200_010);
  applyTermStatus(rt, 'blocked', T0 + 201_000);
  applyTermStatus(rt, 'working', T0 + 260_000);
  applyHook(rt, { hook_event_name: 'Stop', last_assistant_message: 'ok' }, T0 + 270_000);
  applyTermStatus(rt, 'done', T0 + 270_100);
  assert.equal(rt.lastWork.turnless, false);
  assert.equal(rt.lastWork.since, T0 + 200_000, '막힘이 구간을 끊지 않는다');
  assert.equal(rt.turn.endedAt, T0 + 270_000);
});

test('지시 hook이 터미널 working보다 조금 먼저 와도 턴이다', () => {
  const rt = session();
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: 'p' }, T0 + 50_000);
  applyTermStatus(rt, 'working', T0 + 50_400);
  applyTermStatus(rt, 'done', T0 + 52_000); // Esc로 끊어 Stop이 없다
  assert.equal(rt.lastWork.turnless, false);
  assert.equal(rt.turn.endedAt, T0 + 52_000);
});

test('Stop이 터미널 done 뒤에 늦게 와도 턴으로 다시 센다', () => {
  const rt = session();
  applyTermStatus(rt, 'working', T0 + 100_000);
  applyTermStatus(rt, 'done', T0 + 104_000);
  assert.equal(rt.lastWork.turnless, true);
  applyHook(rt, { hook_event_name: 'Stop', last_assistant_message: 'late' }, T0 + 104_300);
  assert.equal(rt.lastWork.turnless, false);
  assert.equal(rt.lastWork.late, true);
});

test('hook이 없는 세션(다른 종류)과 hook이 하나도 오지 않은 세션은 판정하지 않는다', () => {
  const rt = newRuntime({ now: T0, kind: 'codex', hooked: false });
  applyTermStatus(rt, 'idle', T0);
  applyTermStatus(rt, 'working', T0 + 1000);
  applyTermStatus(rt, 'done', T0 + 5000);
  assert.equal(rt.lastWork.turnless, false);
  const c = newRuntime({ now: T0 });
  applyTermStatus(c, 'working', T0 + 1000);
  assert.equal(turnlessWork(c), false);
});

// ---------- 웹 푸시 ----------
function board() {
  let t = T0;
  const nodes = new Map();
  const sent = [];
  const p = new Pusher({ store: null, subject: 'https://github.com/x/y', now: () => t, batchMs: 60_000, timers: false, tree: () => [...nodes.values()].map((n) => ({ ...n })), transport: async (endpoint, opts) => { sent.push({ endpoint, ...opts }); return { status: 201 }; } });
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  p.subscribe('dev-1', { endpoint: 'https://web.push.apple.com/3/device/abc', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(crypto.randomBytes(16)) } }, 'en');
  p.setPrefs?.('dev-1', { sub: 'all' });
  const add = (id, o = {}) => nodes.set(id, { sessionId: id, name: id, kind: 'claude', state: 'ready', workspaceKey: 'w1', parentSessionId: null, delivering: 0, loops: 0, bg: null, ...o });
  // turnless: 턴 없이 끝난 일(backend broadcastSession이 rt.lastWork로 정한다)
  const set = (id, state, { turnless = false } = {}) => {
    const n = nodes.get(id); const from = n.state; n.state = state;
    if (from !== state) return p.onState({ sessionId: id, name: id, kind: 'claude', state, workspaceKey: 'w1', parentSessionId: n.parentSessionId }, from, { turnless });
    return null;
  };
  const tick = (ms) => { t += ms; p.tickCycles(); };
  return { p, add, set, tick, sent, flush: () => p.flush('dev-1'), why: (id) => p.decisions.filter((d) => d.sessionId === id).map((d) => d.why) };
}

test('웹 푸시: 압축만 한 일은 끝남을 보내지 않는다', async () => {
  const b = board();
  b.add('A');
  b.set('A', 'working');
  assert.equal(b.set('A', 'ready', { turnless: true }), null);
  b.tick(SETTLE_MS + 1000);
  assert.equal(await b.flush(), null);
  assert.equal(b.sent.length, 0);
  assert.ok(b.why('A').includes('turnless'));
});

test('웹 푸시: 보통 턴 끝은 그대로 보낸다', async () => {
  const b = board();
  b.add('A');
  b.set('A', 'working');
  b.set('A', 'ready');
  b.tick(SETTLE_MS + 1000);
  const r = await b.flush();
  assert.equal(r.sent, true);
  assert.equal(b.sent.length, 1);
});

test('웹 푸시: 진짜 턴이 끝나고 정한 시간 안에 압축이 돌아도 그 턴의 끝남은 간다(한 번)', async () => {
  const b = board();
  b.add('A');
  b.set('A', 'working');
  b.set('A', 'ready');
  b.tick(10_000);
  b.set('A', 'working'); // 압축 시작
  b.tick(7000);
  b.set('A', 'ready', { turnless: true });
  b.tick(SETTLE_MS + 1000);
  const r = await b.flush();
  assert.equal(r.sent, true);
  assert.equal(b.sent.length, 1);
});

test('웹 푸시: 하위 세션의 압축이 부모 사이클을 열지 않는다. 부모 사이클이 이미 열렸으면 그대로', async () => {
  const b = board();
  b.add('L'); b.add('W', { parentSessionId: 'L' });
  b.set('W', 'working');
  b.set('W', 'ready', { turnless: true });
  b.tick(SETTLE_MS + 1000);
  assert.equal(await b.flush(), null, '압축만 했다');
  assert.ok(b.why('L').includes('turnless'));
  // 부모가 일하는 중에 하위가 압축하면 부모 사이클은 부모의 끝으로 닫힌다
  b.set('L', 'working');
  b.set('W', 'working');
  b.set('W', 'ready', { turnless: true });
  b.set('L', 'ready');
  b.tick(SETTLE_MS + 1000);
  const r = await b.flush();
  assert.equal(r && r.sent, true);
});

test('웹 푸시: 늦게 온 Stop(lateTurn)은 그 일을 턴으로 다시 센다', async () => {
  const b = board();
  b.add('A');
  b.set('A', 'working');
  b.set('A', 'ready', { turnless: true });
  b.p.lateTurn({ sessionId: 'A', name: 'A', kind: 'claude', state: 'ready', workspaceKey: 'w1', parentSessionId: null });
  b.tick(SETTLE_MS + 1000);
  const r = await b.flush();
  assert.equal(r && r.sent, true);
});
