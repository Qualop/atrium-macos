// P92 단위 시험(가짜 시계): 휴대폰 알림을 "작업 사이클 끝"에 한 번으로 줄이고, 하위 세션(워커) 알림을 기기 설정으로 고른다.
// 리드가 워커 셋에게 넘기고 턴 끝 → 없음, 워커들 끝 → 없음, 리드가 보고를 받아 이어 가다 끝 → 정한 시간 뒤 done 한 번,
// 정한 시간 안에 다시 일함 → 없음, 뒤 일이 남음 → 없음, 하위 세션 need → 기본에서 보냄, "끔"이면 안 보냄, 부모 없는 워크트리 세션 done → 보냄
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pusher, b64u, decryptPayload, pushText } from '../src/web-push.mjs';
import { SETTLE_MS, BG_CAP_MS, bgTasksOf, cycleCheck, treeIndex, subAllows } from '../src/push-cycle.mjs';
import { newRuntime, applyHook, applyAgentReleased } from '../src/state.mjs';

function fakeSub() {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return { sub: { endpoint: `https://web.push.apple.com/3/device/${crypto.randomBytes(6).toString('hex')}`, keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } }, open: (body) => JSON.parse(decryptPayload(body, { uaPrivate: ua.getPrivateKey(), auth }).toString()) };
}

// 가짜 판: 세션 나무와 상태. set()이 판의 broadcastSession처럼 onState(요약, 전 상태)를 부른다
function board({ lang = 'en' } = {}) {
  let t = 1_762_600_000_000;
  const nodes = new Map();
  const sent = [];
  const p = new Pusher({
    store: null, subject: 'https://github.com/x/y', now: () => t, batchMs: 60_000, timers: false,
    wsName: (k) => (k === 'w1' ? 'repo-one' : null), tree: () => [...nodes.values()].map((n) => ({ ...n })),
    transport: async (endpoint, opts) => { sent.push({ endpoint, ...opts }); return { status: 201 }; },
  });
  const f = fakeSub();
  p.subscribe('dev-1', f.sub, lang);
  const add = (id, o = {}) => { nodes.set(id, { sessionId: id, name: id, kind: 'claude', state: 'starting', workspaceKey: 'w1', parentSessionId: null, delivering: 0, loops: 0, bg: null, ...o }); };
  const set = (id, state, o = {}) => {
    const n = nodes.get(id); const from = n.state;
    Object.assign(n, o, { state });
    if (from !== state) p.onState({ sessionId: id, name: n.name, kind: n.kind, state, workspaceKey: n.workspaceKey, exit: o.exit || null, parentSessionId: n.parentSessionId }, from);
  };
  const tick = (ms) => { t += ms; p.tickCycles(); };
  const flush = async () => { const r = await p.flush('dev-1'); return r; };
  const msgs = () => sent.map((s) => f.open(s.body));
  return { p, nodes, add, set, tick, flush, sent, msgs, why: (id) => p.decisions.filter((d) => d.sessionId === id).map((d) => d.why) };
}

// 리드 L이 워커 셋을 띄워 일을 넘기고 턴을 끝낸다
function handOff(b) {
  b.add('L'); b.set('L', 'ready'); b.set('L', 'working');
  for (const w of ['W1', 'W2', 'W3']) { b.add(w, { parentSessionId: 'L' }); b.set(w, 'ready'); b.set(w, 'working'); }
  b.set('L', 'ready');
}

test('리드가 워커 셋에게 넘기고 턴 끝 → 없음, 워커들 끝 → 없음, 리드가 보고를 받아 이어 가다 끝 → 정한 시간 뒤 done 한 번(하위 3개 포함)', async () => {
  const b = board();
  handOff(b);
  b.tick(SETTLE_MS + 1000);
  assert.equal(await b.flush(), null, '워커가 일하는 중');
  assert.ok(b.why('L').includes('cycle-open'));
  // 워커들이 하나씩 끝난다. 마지막 워커의 보고가 판 전달로 리드에게 간다
  b.set('W1', 'ready'); b.tick(20_000);
  b.set('W2', 'ready'); b.tick(SETTLE_MS);
  assert.equal(await b.flush(), null, '남은 워커가 일한다');
  b.nodes.get('L').delivering = 1; // 보고가 대기열에 있다
  b.set('W3', 'ready');
  b.tick(SETTLE_MS);
  assert.equal(await b.flush(), null, '리드에게 갈 전달이 남았다');
  assert.ok(b.why('L').includes('delivery-pending'));
  for (const w of ['W1', 'W2', 'W3']) assert.ok(b.why(w).includes('sub-session'), `${w}의 끝남은 기본 설정(응답 필요만)에서 보내지 않는다`);
  // 리드가 보고를 받아 이어 간다
  b.nodes.get('L').delivering = 0;
  b.set('L', 'working'); b.tick(5000);
  b.set('L', 'ready'); b.tick(SETTLE_MS - 1000);
  assert.equal(await b.flush(), null, '정한 시간이 아직');
  b.tick(1000);
  const r = await b.flush();
  assert.equal(r.sent, true);
  assert.equal(b.sent.length, 1, '사이클 끝에 한 번');
  const m = b.msgs()[0];
  assert.equal(m.title, '@L · done');
  assert.equal(m.body, 'repo-one · incl. 3 sub-sessions');
  assert.equal(m.sessionId, 'L');
  b.tick(SETTLE_MS * 3);
  assert.equal(await b.flush(), null, '더 보내지 않는다');
});

test('정한 시간 안에 다시 일하면 보내지 않고(busy-again), 다시 쉰 뒤 정한 시간이 지나면 한 번', async () => {
  const b = board({ lang: 'ko' });
  b.add('L'); b.set('L', 'ready'); b.set('L', 'working'); b.set('L', 'ready'); // 중간 보고
  b.tick(SETTLE_MS - 5000);
  b.set('L', 'working'); // 다음 일을 이어 간다
  b.tick(10_000);
  assert.equal(await b.flush(), null);
  assert.ok(b.why('L').includes('busy-again'));
  b.set('L', 'ready'); b.tick(SETTLE_MS);
  await b.flush();
  assert.equal(b.sent.length, 1);
  assert.deepEqual([b.msgs()[0].title, b.msgs()[0].body], ['@L · 끝남', 'repo-one']);
});

test('뒤 일(뒤 셸·뒤 하위 에이전트)이 남으면 보내지 않고, 끝나 새 턴이 끝나면 보낸다. 뒤 일만 오래 남으면 끝으로 본다', async () => {
  const b = board();
  b.add('L'); b.set('L', 'ready'); b.set('L', 'working');
  b.set('L', 'ready', { bg: 1 });
  b.tick(SETTLE_MS); b.tick(SETTLE_MS);
  assert.equal(await b.flush(), null);
  assert.deepEqual(b.why('L').filter((w) => w === 'background-task'), ['background-task'], '같은 까닭은 한 번만 남긴다');
  // 뒤 일이 끝나면 Claude Code가 <task-notification>으로 새 턴을 시작한다
  b.set('L', 'working'); b.set('L', 'ready', { bg: 0 });
  b.tick(SETTLE_MS);
  await b.flush();
  assert.equal(b.sent.length, 1);
  // 뒤에 서버를 띄워 둔 채 끝: BG_CAP_MS 뒤에 보낸다
  b.set('L', 'working'); b.set('L', 'ready', { bg: 1 });
  b.tick(SETTLE_MS);
  for (let s = SETTLE_MS; s < BG_CAP_MS; s += SETTLE_MS) b.tick(SETTLE_MS);
  await b.flush();
  assert.equal(b.sent.length, 2);
  assert.ok(b.why('L').includes('background-cap'));
});

test('자손의 뒤 일과 켜진 루프도 사이클을 열어 둔다. 루프가 끝나면 다음 확인에서 보낸다', async () => {
  const b = board();
  b.add('L'); b.set('L', 'ready'); b.set('L', 'working');
  b.add('W', { parentSessionId: 'L' }); b.set('W', 'ready'); b.set('W', 'working'); b.set('W', 'ready', { bg: 2 });
  b.set('L', 'ready');
  b.tick(SETTLE_MS);
  assert.equal(await b.flush(), null);
  assert.ok(b.why('L').includes('background-task'));
  b.nodes.get('W').bg = 0; b.nodes.get('L').loops = 1;
  b.tick(SETTLE_MS);
  assert.equal(await b.flush(), null);
  assert.ok(b.why('L').includes('loop-active'));
  b.nodes.get('L').loops = 0;
  b.tick(SETTLE_MS);
  await b.flush();
  assert.equal(b.sent.length, 1);
  assert.equal(b.msgs()[0].title, '@L · done');
});

test('하위 세션 알림: 기본(응답 필요만)은 need·error를 보내고 done은 안 보낸다. "끔"은 아무것도, "모두"는 하위 세션 done도', async () => {
  const b = board();
  assert.equal(b.p.status('dev-1').sub, 'need', '기본');
  b.add('L'); b.set('L', 'ready'); b.set('L', 'working');
  b.add('W', { parentSessionId: 'L' }); b.set('W', 'ready'); b.set('W', 'working');
  b.set('W', 'waiting');
  let r = await b.flush();
  assert.equal(r.sent, true, '하위 세션의 응답 필요는 보낸다');
  assert.equal(b.msgs()[0].title, '@W · needs you');
  b.set('W', 'working'); b.tick(31_000); b.set('W', 'error');
  r = await b.flush();
  assert.equal(r.sent, true, '하위 세션 오류는 보낸다(워커가 멈췄다)');
  b.p.setPrefs('dev-1', { sub: 'off' });
  assert.equal(b.p.status('dev-1').sub, 'off');
  b.set('W', 'working'); b.tick(31_000); b.set('W', 'waiting');
  assert.equal(await b.flush(), null, '끔');
  assert.ok(b.why('W').includes('sub-off'));
  b.p.setPrefs('dev-1', { sub: 'all' });
  b.set('W', 'working'); b.set('W', 'ready'); b.tick(SETTLE_MS);
  r = await b.flush();
  assert.equal(r.sent, true, '모두: 하위 세션의 사이클 끝도 보낸다');
  assert.equal(b.msgs().at(-1).title, '@W · done');
  b.p.setPrefs('dev-1', { sub: 'bogus' });
  assert.equal(b.p.status('dev-1').sub, 'all', '모르는 값은 받지 않는다');
  // 리드는 하위 세션 설정과 상관없이 맨 위 세션이다
  b.set('L', 'ready'); b.tick(SETTLE_MS);
  await b.flush();
  assert.equal(b.msgs().at(-1).title, '@L · done');
  assert.deepEqual([subAllows('need', 'done'), subAllows('need', 'need'), subAllows('need', 'exit'), subAllows('off', 'need'), subAllows('all', 'done'), subAllows(undefined, 'done')], [false, true, true, false, true, false]);
});

test('부모 없는 워크트리 세션과 부모가 닫힌 하위 세션은 맨 위 세션이라 done을 보낸다', async () => {
  const b = board();
  b.add('WT', { name: 'wt-solo' }); b.set('WT', 'ready'); b.set('WT', 'working'); b.set('WT', 'ready');
  b.tick(SETTLE_MS);
  await b.flush();
  assert.equal(b.msgs().at(-1).title, '@wt-solo · done');
  b.add('orphan', { parentSessionId: 'closed-lead' }); b.set('orphan', 'ready'); b.set('orphan', 'working'); b.set('orphan', 'ready');
  b.tick(SETTLE_MS);
  await b.flush();
  assert.equal(b.msgs().at(-1).title, '@orphan · done');
  assert.equal(b.sent.length, 2);
});

test('새로 뜬 세션(starting → ready)과 셸은 사이클을 열지 않는다. 세션 하나 끄기(muted)', async () => {
  const b = board();
  b.add('N'); b.set('N', 'ready'); b.tick(SETTLE_MS * 2);
  b.add('S', { kind: 'shell' }); b.set('S', 'working'); b.set('S', 'ready'); b.tick(SETTLE_MS * 2);
  assert.equal(await b.flush(), null);
  b.p.setPrefs('dev-1', { mute: { sessionId: 'N', on: true } });
  assert.deepEqual(b.p.status('dev-1').muted, ['N']);
  b.set('N', 'working'); b.set('N', 'ready'); b.tick(SETTLE_MS);
  b.set('N', 'waiting');
  assert.equal(await b.flush(), null);
  assert.deepEqual(b.why('N').filter((w) => w === 'muted').length, 2, 'done과 need 둘 다');
  b.p.setPrefs('dev-1', { mute: { sessionId: 'N', on: false } });
  assert.deepEqual(b.p.status('dev-1').muted, []);
  b.p.setPrefs('dev-1', { mute: { sessionId: '../x y', on: true } });
  assert.deepEqual(b.p.status('dev-1').muted, [], '세션 ID 모양이 아니면 받지 않는다');
});

test('진단 기록과 알림에 질문·요청·답의 글이 없다', async () => {
  const b = board();
  handOff(b);
  b.set('W1', 'waiting');
  for (const w of ['W1', 'W2', 'W3']) b.set(w, 'ready');
  b.set('L', 'working'); b.set('L', 'ready'); b.tick(SETTLE_MS);
  await b.flush();
  for (const d of b.p.decisions) assert.deepEqual(Object.keys(d).sort(), ['at', 'deviceId', 'kind', 'sessionId', 'why']);
  for (const m of b.msgs()) assert.deepEqual(Object.keys(m).sort(), ['at', 'body', 'kind', 'n', 'sessionId', 'tag', 'title', 'v']);
  assert.deepEqual(pushText([{ sessionId: 'a', name: 'a', kind: 'need', ws: 'r', subs: 3 }], 'ko'), { title: '@a · 응답 필요', body: 'r' }, '하위 세션 수는 끝남에만');
});

test('hook: Stop·SubagentStop의 background_tasks → 도는 뒤 일(id, 종류만). 필드가 없으면 전 값, claude가 끝나면 비운다', () => {
  const rt = newRuntime();
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  applyHook(rt, { hook_event_name: 'Stop', last_assistant_message: 'started', background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'SECRET sleep', command: 'sleep 45' }, { id: 'a1', type: 'subagent', status: 'running', description: 'SECRET', agent_type: 'general-purpose' }, { id: 'b0', type: 'shell', status: 'completed' }], session_crons: [] });
  assert.deepEqual(rt.bg.tasks, [{ id: 'b1', type: 'shell' }, { id: 'a1', type: 'subagent' }]);
  assert.ok(!JSON.stringify(rt.bg).includes('SECRET'));
  applyHook(rt, { hook_event_name: 'SubagentStop', background_tasks: [{ id: 'b1', type: 'shell', status: 'running' }] });
  assert.deepEqual(rt.bg.tasks.map((x) => x.id), ['b1']);
  applyHook(rt, { hook_event_name: 'Stop', last_assistant_message: 'y' });
  assert.equal(rt.bg.tasks.length, 1, '옛 Claude Code(필드 없음)는 전 값을 둔다');
  applyHook(rt, { hook_event_name: 'Stop', background_tasks: [] });
  assert.equal(rt.bg.tasks.length, 0);
  applyHook(rt, { hook_event_name: 'Stop', background_tasks: [{ id: 'b2', type: 'shell', status: 'running' }] });
  applyAgentReleased(rt);
  assert.equal(rt.bg, null);
  assert.equal(bgTasksOf({}), null);
  assert.deepEqual(bgTasksOf({ background_tasks: 'x' }), null);
});

test('cycleCheck: 나무 판단(자손의 일·응답 필요·전달·루프·뒤 일, 셸은 보지 않음)', () => {
  const T = (list) => treeIndex(list.map((n) => ({ kind: 'claude', delivering: 0, loops: 0, bg: null, parentSessionId: null, ...n })));
  assert.deepEqual(cycleCheck('L', T([{ sessionId: 'L', state: 'ready' }])), { ok: true, subs: 0 });
  assert.equal(cycleCheck('L', T([{ sessionId: 'L', state: 'working' }])).why, 'busy-again');
  assert.equal(cycleCheck('L', T([{ sessionId: 'L', state: 'waiting' }])).why, 'not-ready');
  assert.equal(cycleCheck('L', T([{ sessionId: 'L', state: 'ready' }, { sessionId: 'W', parentSessionId: 'L', state: 'ready' }, { sessionId: 'G', parentSessionId: 'W', state: 'trust_wait' }])).why, 'cycle-open', '손자까지 본다');
  assert.deepEqual(cycleCheck('L', T([{ sessionId: 'L', state: 'ready' }, { sessionId: 'S', parentSessionId: 'L', state: 'working', kind: 'shell' }])), { ok: true, subs: 0 });
  assert.equal(cycleCheck('L', T([{ sessionId: 'L', state: 'ready' }, { sessionId: 'W', parentSessionId: 'L', state: 'ready', delivering: 1 }])).why, 'delivery-pending');
  assert.equal(cycleCheck('x', T([])).why, 'gone');
  const loop = T([{ sessionId: 'A', parentSessionId: 'B', state: 'ready' }, { sessionId: 'B', parentSessionId: 'A', state: 'ready' }]);
  assert.ok(loop.chain('A').length <= 2, '고리가 있어도 멈춘다');
});
