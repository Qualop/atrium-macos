// P258 단위 시험: "제출 여부 미확인" 잘못된 경보.
// 1) 옛 세션 설정 파일(P173 전)의 빠진 판 hook 채우기(fillBoardHooks·refreshSettings·launchOf)
// 2) 미확인으로 끝난 전달의 늦은 확인(UserPromptSubmit이 늦게 오면 confirmed late)
// 3) 압축 중(PreCompact) 전달은 뒤 일만 도는 세션(P240 bgOnly)으로 보지 않고 대기열에 선다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newRuntime, applyHook, applyTermStatus } from '../src/state.mjs';
import { DeliveryQueue } from '../src/delivery.mjs';
import { backgroundList } from '../src/sleep.mjs';
import { Branch } from '../src/branch.mjs';
import { Backend } from '../src/backend.mjs';
import { HOOK_EVENTS, writeSessionSettings, fillBoardHooks, fillSessionHooks } from '../src/launch.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p258-'));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('until: 시간 초과'); await tick(10); } }
const OLD = ['PreCompact', 'PostCompact'];

// P173 전 꼴의 설정 파일: 판 hook(rig amp로 PreToolUse 시간 제한 600), 사용자가 넣은 hook 둘
function oldFile(dir, { amp = true } = {}) {
  const file = path.join(dir, 's1.json');
  writeSessionSettings({ file, hookUrl: 'http://127.0.0.1:1/hook', token: 'tok', sessionId: 's1', timeoutSec: 2, ...(amp ? { amp: { hooks: { PreToolUse: { timeout: 600 } } } } : {}) });
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const e of OLD) delete j.hooks[e];
  j.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo user-stop' }] });
  j.hooks.SessionStart = [{ hooks: [{ type: 'command', command: 'echo user-start' }] }];
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
  return file;
}

// ---------- 1. 빠진 판 hook 채우기 ----------
test('P258 채우기: 옛 꼴 파일에 PreCompact·PostCompact가 그 파일의 판 hook 값으로 더해지고, 다른 이벤트·amp 시간 제한·사용자 hook은 그대로', () => {
  const file = oldFile(tmp());
  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(fillBoardHooks(j), OLD);
  for (const e of OLD) {
    assert.equal(j.hooks[e].length, 1);
    assert.deepEqual(j.hooks[e][0].hooks[0], { type: 'http', url: 'http://127.0.0.1:1/hook', timeout: 2, headers: { Authorization: 'Bearer tok', 'X-MT-Session': 's1' } });
  }
  for (const e of Object.keys(before.hooks)) assert.deepEqual(j.hooks[e], before.hooks[e], e + ' 그대로');
  assert.deepEqual(j.hooks.SessionStart, before.hooks.SessionStart, '사용자 hook');
  for (const e of HOOK_EVENTS) assert.ok(j.hooks[e], e);
  // 두 번 돌려도 같다
  const once = JSON.stringify(j);
  assert.deepEqual(fillBoardHooks(j), []);
  assert.equal(JSON.stringify(j), once);
});

test('P258 채우기: 판 hook이 하나도 없는 파일, hooks가 없는 파일은 손대지 않는다. 사용자 hook만 있는 이벤트에는 판 hook을 더한다', () => {
  const u = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }], PreCompact: [{ hooks: [{ type: 'http', url: 'http://other/', headers: {} }] }] } };
  const s = JSON.stringify(u);
  assert.deepEqual(fillBoardHooks(u), []); assert.equal(JSON.stringify(u), s);
  const n = { env: { A: '1' } };
  assert.deepEqual(fillBoardHooks(n), []); assert.deepEqual(n, { env: { A: '1' } });
  assert.deepEqual(fillBoardHooks(null), []);
  // 사용자 hook이 PreCompact에 있어도 판 hook은 더한다(사용자 hook은 앞에 그대로)
  const file = oldFile(tmp());
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  j.hooks.PreCompact = [{ hooks: [{ type: 'command', command: 'echo mine' }] }];
  assert.deepEqual(fillBoardHooks(j), OLD);
  assert.equal(j.hooks.PreCompact.length, 2);
  assert.equal(j.hooks.PreCompact[0].hooks[0].command, 'echo mine');
  assert.equal(j.hooks.PreCompact[1].hooks[0].type, 'http');
});

test('P258 채우기: fillSessionHooks는 바뀐 것이 있을 때만 쓴다(두 번째는 그대로), 없는 파일은 []', () => {
  const file = oldFile(tmp());
  assert.deepEqual(fillSessionHooks(file), OLD);
  const t1 = fs.readFileSync(file, 'utf8');
  const m1 = fs.statSync(file).mtimeMs;
  assert.deepEqual(fillSessionHooks(file), []);
  assert.equal(fs.readFileSync(file, 'utf8'), t1);
  assert.equal(fs.statSync(file).mtimeMs, m1);
  assert.deepEqual(fillSessionHooks(path.join(tmp(), 'none.json')), []);
});

function fakeSession(id, file, { hooked = true, kind = 'claude' } = {}) {
  const rt = newRuntime({ kind, hooked });
  return { sessionId: id, name: id, kind, settingsPath: file, rt, resumeArgv: [], extraArgs: [] };
}

test('P258 refreshSettings: 판 세션(hook)의 옛 파일은 채우고, hook 없는 세션은 손대지 않는다. 두 번째는 쓰지 않는다', { skip: 'macOS 판: 원본의 다른 기능(P240 뒤 일만 도는 세션 바로 넣기, 원본 refreshSettings 모양)에 기대는 시험' }, () => {
  const dir = tmp();
  const a = oldFile(fs.mkdtempSync(path.join(dir, 'a-')));
  const b2 = oldFile(fs.mkdtempSync(path.join(dir, 'b-')));
  const before = fs.readFileSync(b2, 'utf8');
  const logs = [];
  const sA = fakeSession('a', a), sB = fakeSession('b', b2, { hooked: false });
  const board = { sessions: new Map([['a', sA], ['b', sB]]), hooked: (x) => x.rt.hooked !== false, usage: null, log: (m) => logs.push(m) };
  const self = { b: board, allowRules: () => [], envFor: () => ({}) };
  Branch.prototype.refreshSettings.call(self);
  const j = JSON.parse(fs.readFileSync(a, 'utf8'));
  for (const e of OLD) assert.ok(j.hooks[e], e);
  assert.equal(j.hooks.PreToolUse[0].hooks[0].timeout, 600);
  assert.equal(fs.readFileSync(b2, 'utf8'), before, 'hook 없는 세션');
  assert.ok(logs.some((m) => /hooks added for a: PreCompact, PostCompact/.test(m)));
  const t1 = fs.readFileSync(a, 'utf8');
  assert.equal(Branch.prototype.refreshSettings.call(self), 0, '두 번째는 바뀐 것 없음');
  assert.equal(fs.readFileSync(a, 'utf8'), t1);
});

test('P258 launchOf(깨우기·다시 시작·되살리기): 띄우기 전에 빠진 판 hook을 채운다. hook 없는 세션·다른 종류·launch false는 손대지 않는다', () => {
  const dir = tmp();
  const ev = [];
  const board = { hooked: (x) => x.rt.hooked !== false, log: () => {}, store: { addEvent: (sid, type, p) => ev.push({ sid, type, p }) }, plugin: {}, rig3: null };
  const f1 = oldFile(fs.mkdtempSync(path.join(dir, '1-')));
  Backend.prototype.launchOf.call(board, fakeSession('x', f1));
  assert.ok(JSON.parse(fs.readFileSync(f1, 'utf8')).hooks.PreCompact);
  assert.deepEqual(ev, [{ sid: 'x', type: 'settings_hooks_added', p: { events: OLD } }]);
  const f2 = oldFile(fs.mkdtempSync(path.join(dir, '2-')));
  Backend.prototype.launchOf.call(board, fakeSession('y', f2), { launch: false });
  Backend.prototype.launchOf.call(board, fakeSession('z', f2, { hooked: false }));
  Backend.prototype.launchOf.call(board, fakeSession('c', f2, { kind: 'codex' }));
  assert.equal(JSON.parse(fs.readFileSync(f2, 'utf8')).hooks.PreCompact, undefined);
});

// ---------- 2. 늦은 확인 ----------
const queues = [];
test.afterEach(() => { while (queues.length) queues.pop().stop(); });
function idleBoard() {
  const rt = newRuntime({ kind: 'claude', hooked: true });
  rt.term.present = true; rt.phase = 'running'; applyTermStatus(rt, 'idle');
  const s = { sessionId: 's1', name: 'main', kind: 'claude', paneId: 'main:p1', rt, lastUserInputAt: 0 };
  const scan = new Map();
  const b = { sessions: new Map([[s.sessionId, s]]), adapter: { connected: true }, branch: null, hooked: (x) => x.rt.hooked !== false,
    sleeper: { going: new Set(), bgView: (x) => (x.rt.sleep ? null : backgroundList(x.rt.bg, scan.get(x.sessionId) || null)) } };
  return { s, rt, view: () => Backend.prototype.deliveryView.call(b, s.sessionId) };
}
function qOf(f, cfg = {}, inspect = async () => ({ box: 'unknown', seen: false })) {
  const sent = [], late = [];
  const store = { rows: new Map(), activeDeliveries: () => [], insertDelivery(d) { this.rows.set(d.deliveryId, { ...d }); }, updateDelivery(id, p) { Object.assign(this.rows.get(id) || {}, p); }, getDelivery(id) { return this.rows.get(id) || null; } };
  const q = new DeliveryQueue({
    store, cfg: { inputQuietMs: 3000, submitConfirmMs: 60, deliveryMaxWaitMs: 60000, submitRetries: 1, submitEnterMs: 10, submitRetryMs: 20, submitLooks: 0, ...cfg },
    view: () => f.view(), send: async (sid, text) => { sent.push(text); }, inspect, pressEnter: async () => {},
  });
  q.on('late_confirm', (r) => late.push(r));
  q.start(); queues.push(q);
  return { q, sent, late, store };
}

test('P258 늦은 확인: 미확인 뒤 맞는 UserPromptSubmit이 오면 confirmed(late)로 바뀌고 저장·이벤트가 따라간다', async () => {
  const f = idleBoard();
  const { q, late, store } = qOf(f);
  const seen = [];
  q.on('delivery', (d) => seen.push(d.status));
  const d = q.enqueue('s1', '판의 알림: 하위가 끝났다');
  await until(() => d.status === 'unconfirmed', 3000);
  assert.match(d.reason, /no UserPromptSubmit hook/);
  assert.equal(q.lateCount('s1'), 1);
  const r = q.onUserPromptSubmit('s1', '판의 알림: 하위가 끝났다');
  assert.equal(r, d);
  assert.equal(d.status, 'confirmed'); assert.equal(d.reason, 'late'); assert.ok(d.confirmedAt);
  assert.equal(store.getDelivery(d.deliveryId).status, 'confirmed');
  assert.equal(store.getDelivery(d.deliveryId).reason, 'late');
  assert.deepEqual(seen.slice(-2), ['unconfirmed', 'confirmed']);
  assert.equal(late.length, 1); assert.equal(late[0].deliveryId, d.deliveryId); assert.ok(late[0].afterMs >= 0);
  assert.equal(q.lateCount('s1'), 0);
  assert.equal(q.onUserPromptSubmit('s1', '판의 알림: 하위가 끝났다'), null, '한 번만 확인');
});

test('P258 늦은 확인: 기한(lateConfirmMs)이 지나면 그대로 미확인', async () => {
  const f = idleBoard();
  const { q, late } = qOf(f, { lateConfirmMs: 30 });
  const d = q.enqueue('s1', '늦은 글');
  await until(() => d.status === 'unconfirmed', 3000);
  await tick(60);
  assert.equal(q.onUserPromptSubmit('s1', '늦은 글'), null);
  assert.equal(d.status, 'unconfirmed'); assert.equal(late.length, 0);
});

test('P258 늦은 확인: 지금 확인을 기다리는 전달과 섞이지 않는다(맞는 글이 우선, 같은 글이면 맨 앞, 늦은 확인은 mismatch로 치지 않음)', async () => {
  const f = idleBoard();
  const { q } = qOf(f, { submitConfirmMs: 60000, submitRetries: 0 });
  // 첫 전달을 미확인으로 끝낸다(손으로)
  const d1 = q.enqueue('s1', '첫 글');
  await until(() => d1.status === 'sent');
  q._set(d1, 'unconfirmed', 'no UserPromptSubmit hook');
  const d2 = q.enqueue('s1', '둘째 글');
  await until(() => d2.status === 'sent');
  // 첫 글의 hook: 늦은 확인. 맨 앞(d2)은 그대로 기다린다
  assert.equal(q.onUserPromptSubmit('s1', '첫 글'), d1);
  assert.equal(d1.status, 'confirmed'); assert.equal(d1.reason, 'late');
  assert.equal(d2.status, 'sent'); assert.ok(!d2.mismatchSeen, '늦은 확인 hook은 다른 글로 치지 않는다');
  // 아무것과도 맞지 않는 hook은 지금처럼 맨 앞의 mismatch
  assert.equal(q.onUserPromptSubmit('s1', '사람이 친 다른 글'), null);
  assert.equal(d2.mismatchSeen, true);
  assert.equal(q.onUserPromptSubmit('s1', '둘째 글'), d2);
  assert.equal(d2.status, 'confirmed'); assert.equal(d2.reason, null);
  // 같은 글이 미확인과 맨 앞에 함께 있으면 맨 앞이 먼저
  const d3 = q.enqueue('s1', '같은 글');
  await until(() => d3.status === 'sent');
  q._set(d3, 'unconfirmed', 'no UserPromptSubmit hook');
  const d4 = q.enqueue('s1', '같은 글');
  await until(() => d4.status === 'sent');
  assert.equal(q.onUserPromptSubmit('s1', '같은 글'), d4);
  assert.equal(d3.status, 'unconfirmed');
  assert.equal(q.onUserPromptSubmit('s1', '같은 글'), d3, '다음 hook은 미확인 쪽');
  assert.equal(d3.reason, 'late');
});

test('P258 늦은 확인: 다른 세션의 hook은 쓰지 않는다', async () => {
  const f = idleBoard();
  const { q } = qOf(f);
  const d = q.enqueue('s1', '글');
  await until(() => d.status === 'unconfirmed', 3000);
  assert.equal(q.onUserPromptSubmit('s2', '글'), null);
  assert.equal(d.status, 'unconfirmed');
});

test('P258 첫 요청 늦은 확인: 부모에게 보낸 "들어가지 않았다"를 바로잡는다(한 번), 모르는 전달은 그대로', () => {
  const sent = [], ev = [];
  const parent = { sessionId: 'p', name: 'lead' }, child = { sessionId: 'c', name: 'w1', parentSessionId: 'p' };
  const b = { sessions: new Map([['p', parent], ['c', child]]), store: { addEvent: (...a) => ev.push(a) }, queue: { enqueue: (sid, text) => { sent.push({ sid, text }); return { deliveryId: 'n1' }; } },
    ensureLink: () => ({ linkId: 'l1' }), linkEvent: () => {} };
  const self = { b, lost: new Map([['c', { deliveryId: 'd1' }]]) };
  assert.equal(Branch.prototype.onLateConfirm.call(self, { deliveryId: 'dX', sessionId: 'c' }), null);
  assert.equal(sent.length, 0);
  Branch.prototype.onLateConfirm.call(self, { deliveryId: 'd1', sessionId: 'c', afterMs: 16000 });
  assert.equal(sent.length, 1); assert.equal(sent[0].sid, 'p'); assert.match(sent[0].text, /@w1에게 보낸 첫 요청은 늦게 들어갔다/);
  assert.equal(self.lost.size, 0);
  assert.ok(ev.some((a) => a[1] === 'first_prompt_late'));
  Branch.prototype.onLateConfirm.call(self, { deliveryId: 'd1', sessionId: 'c' });
  assert.equal(sent.length, 1);
});

// ---------- 3. 압축 중 전달 ----------
const SHELL_BG = [{ id: 'b1', type: 'shell', status: 'running', command: 'ping -n 60 127.0.0.1', description: '긴 ping' }];
function bgBoard() {
  const f = idleBoard();
  applyHook(f.rt, { hook_event_name: 'UserPromptSubmit', prompt: '일' }); applyTermStatus(f.rt, 'working');
  applyHook(f.rt, { hook_event_name: 'Stop', last_assistant_message: '끝', background_tasks: SHELL_BG }); // 턴 끝, 뒤 셸이 돈다(터미널은 working 그대로)
  return f;
}

test('P258 압축 중: PreCompact가 오면 bgOnly가 아니고 대기열(working)에 섰다가 PostCompact 뒤 들어간다', { skip: 'macOS 판: 원본의 다른 기능(P240 뒤 일만 도는 세션 바로 넣기, 원본 refreshSettings 모양)에 기대는 시험' }, async () => {
  const f = bgBoard();
  assert.equal(f.view().bgOnly, true, '압축 전: 뒤 일만 돈다(P240)');
  applyHook(f.rt, { hook_event_name: 'PreCompact', trigger: 'manual' });
  const v = f.view();
  assert.equal(v.state, 'working'); assert.equal(v.bgOnly, false);
  const { q, sent } = qOf(f, { submitConfirmMs: 60000 });
  const d = q.enqueue('s1', '압축 중에 온 알림');
  q.pump(); await tick(40);
  assert.equal(d.status, 'queued'); assert.equal(d.reason, 'working'); assert.deepEqual(sent, []);
  applyHook(f.rt, { hook_event_name: 'PostCompact', trigger: 'manual' });
  q.pump();
  await until(() => sent.length === 1);
  assert.equal(d.status, 'sent');
  q.onUserPromptSubmit('s1', '압축 중에 온 알림');
  assert.equal(d.status, 'confirmed');
});

test('P258 압축 중(비교): PreCompact가 오지 않는 옛 설정 파일 세션은 압축을 몰라 bgOnly로 보고 곧바로 넣는다(고치기 전 동작)', { skip: 'macOS 판: 원본의 다른 기능(P240 뒤 일만 도는 세션 바로 넣기, 원본 refreshSettings 모양)에 기대는 시험' }, async () => {
  const f = bgBoard();
  const { q, sent } = qOf(f, { submitConfirmMs: 60000 });
  const d = q.enqueue('s1', '알림');
  await until(() => sent.length === 1);
  assert.equal(d.bgOnly, true);
});
