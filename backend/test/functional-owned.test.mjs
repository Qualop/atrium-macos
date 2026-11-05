// 기능 감사 회귀 시험. 새 임시 DB와 가짜 시계·어댑터만 쓰며 사용자 세션에는 붙지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { LoopEngine } from '../src/loops.mjs';
import { ThreadLog, turnAnswers } from '../src/thread.mjs';
import { Memos } from '../src/memos.mjs';
import { Kanbans } from '../src/kanban.mjs';
import { Settings, normalizePatch } from '../src/settings.mjs';
import { Outputs, turnsFromMessages } from '../src/outputs.mjs';
import { readMessages } from '../src/transcript.mjs';
import { elsewhereOf } from '../src/workspaces.mjs';
import { attachWorktrees } from '../src/worktrees.mjs';
import { Backend } from '../src/backend.mjs';
import { searchQuery } from '../src/canvas-ops.mjs';

const apiError = (code, message) => Object.assign(new Error(message), { code });
function db(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-owned-audit-'));
  const store = new Store(path.join(dir, 'board.db'));
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { store, dir };
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function loops(t) {
  let engine;
  t.after(() => engine?.stop());
  const { store } = db(t);
  const clock = { t: 100000, online: true };
  const s = { sessionId: 'a', name: 'a', kind: 'claude', state: 'ready', turnEndedAt: 1 };
  const deliveries = new Map();
  const ctx = {
    store, now: () => clock.t, canRun: () => clock.online, broadcast() {},
    targetsOf: (l) => [{ ...s, screenHas: engine.screenHas(l.loopId, s.sessionId), delivery: deliveries.get(l.per.a?.deliveryId) }],
    enqueue: () => { const d = { deliveryId: `d${deliveries.size}`, status: 'queued' }; deliveries.set(d.deliveryId, d); return d; },
    deliveryOf: (id) => deliveries.get(id), cancel: (id) => { deliveries.get(id).status = 'cancelled'; },
    readScreen: async () => 'NEXT', thread() {},
  };
  engine = new LoopEngine(ctx); engine.start({ timers: false });
  const create = (extra = {}) => engine.create({ target: { kind: 'session', id: 'a', name: 'a' }, prompt: 'continue', trigger: { type: 'interval', every: '1m', immediate: false }, ...extra });
  return { engine, clock, deliveries, s, ctx, store, create };
}

test('루프 생성 전 시간은 새 루프 제한 시간에서 빼지 않는다', (t) => {
  const r = loops(t); r.clock.t += 900;
  const l = r.create({ stop: { maxMs: 1000 } });
  r.clock.t += 100; r.engine.tick();
  assert.equal(r.engine.find(l.loopId).elapsedMs, 100);
  assert.equal(r.engine.find(l.loopId).status, 'active');
});

test('루프 재개 직전의 일시정지 시간은 제한 시간에 더하지 않는다', (t) => {
  const r = loops(t), l = r.create({ stop: { maxMs: 1000 } });
  r.engine.pause(l.loopId); r.clock.t += 900;
  r.engine.resume(l.loopId); r.clock.t += 100; r.engine.tick();
  assert.equal(r.engine.find(l.loopId).elapsedMs, 100);
  assert.equal(r.engine.find(l.loopId).status, 'active');
});

test('연결이 끊겨도 루프 시간 제한이 대기 전달을 취소하고 저장된다', (t) => {
  const r = loops(t), l = r.create({ trigger: { type: 'idle' }, stop: { maxMs: 1000 } });
  r.engine.tick(); r.clock.online = false; r.clock.t += 1000; r.engine.tick();
  assert.equal(r.store.getLoop(l.loopId).stopReason, 'max_time');
  assert.equal([...r.deliveries.values()][0].status, 'cancelled');
});

test('idle 루프의 취소된 첫 지시는 재개 후 쉬는 대상에 다시 보낼 수 있다', (t) => {
  const r = loops(t), l = r.create({ trigger: { type: 'idle' } });
  r.engine.tick(); r.engine.pause(l.loopId); r.clock.t += 10000;
  r.engine.resume(l.loopId); r.engine.tick();
  assert.equal(r.deliveries.size, 2);
});

test('immediate가 아닌 화면 조건은 첫 화면을 기준으로 삼고 새 출현에만 반응한다', async (t) => {
  const r = loops(t);
  r.create({ trigger: { type: 'text', source: 'screen', text: 'NEXT' } });
  await r.engine.pollScreens(); r.engine.tick();
  assert.equal(r.deliveries.size, 0);
  r.ctx.readScreen = async () => ''; await r.engine.pollScreens(); r.engine.tick();
  r.ctx.readScreen = async () => 'NEXT'; await r.engine.pollScreens(); r.engine.tick();
  assert.equal(r.deliveries.size, 1);
});

test('루프 엔진을 멈추면 이미 예약된 첫 tick도 지시를 보내지 않는다', async (t) => {
  const r = loops(t); r.create({ trigger: { type: 'idle' } }); r.engine.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r.deliveries.size, 0);
});

test('루프 지시가 대기 중이면 앞선 작업의 목표 글로 루프를 끝내지 않는다', (t) => {
  const r = loops(t); r.s.state = 'working';
  const l = r.create({ trigger: { type: 'interval', every: '1m' }, stop: { untilText: 'DONE' } });
  r.engine.tick(); r.clock.t += 1000;
  Object.assign(r.s, { state: 'ready', lastAnswer: 'DONE previous job', lastAnswerAt: r.clock.t });
  r.engine.tick();
  assert.equal(r.store.getLoop(l.loopId).status, 'active');
  assert.equal([...r.deliveries.values()][0].status, 'queued');
});

test('Thread는 전달 전에 이미 끝난 턴을 새 전달의 결과로 쓰지 않는다', () => {
  assert.equal(turnAnswers({ sentAt: 3000, confirmedAt: 3100 }, { startedAt: 1200, endedAt: 2000 }), false);
});

function threadRig(t) {
  const { store } = db(t);
  let rt = { state: 'working' };
  const ctx = { store, broadcast() {}, runtimeOf: () => rt };
  let log = new ThreadLog(ctx);
  const add = (id, at) => { log.add({ text: id, deliveries: [{ deliveryId: id, sessionId: 'a', status: 'queued' }] }); log.onDelivery({ deliveryId: id, status: 'confirmed', sentAt: at, confirmedAt: at }); };
  return { store, add, get log() { return log; }, restart() { log = new ThreadLog(ctx); }, finish() { rt = { state: 'ready', turn: { startedAt: 2000, endedAt: 5000 }, lastAnswer: 'first result' }; } };
}
for (const restart of [false, true]) test(`한 턴은 Thread 결과 하나에만 붙는다(restart=${restart})`, (t) => {
  const r = threadRig(t); r.add('d1', 1000); r.add('d2', 1500); r.finish();
  r.log.check('a'); if (restart) r.restart(); r.log.check('a');
  assert.equal(r.store.getThreadResult('d1').report.text, 'first result');
  assert.equal(r.store.getThreadResult('d2').report, null);
});

test('Thread 페이지 크기 소수 입력으로 SQLite 오류가 나지 않는다', (t) => {
  const r = threadRig(t); r.add('d1', 1000);
  assert.equal(r.log.list({ limit: 1.5 }).items.length, 1);
});

test('메모 수정의 workspace 조회 중 삭제되면 not_found이며 null 갱신을 방송하지 않는다', async (t) => {
  const { store } = db(t), gate = deferred(), events = [];
  store.insertWorkspace({ key: 'ws', kind: 'folder', root: '/fake/repo', createdAt: 1 });
  const m = new Memos({ store, broadcast: (...e) => events.push(e), occupied: () => [], resolveWorkspace: () => gate.promise, apiError });
  const note = await m.create({ text: 'old' });
  const pending = m.update({ memo: note.memoId, workspace: 'ws', text: 'new' });
  m.delete({ memo: note.memoId, confirm: true }); gate.resolve({ key: 'ws' });
  await assert.rejects(pending, { code: 'not_found' });
  assert.equal(events.some(([name, data]) => name === 'memo.updated' && !data), false);
});

test('동시 칸반 카드 추가는 둘 다 남고 잘못된 묶음은 원자적으로 거부된다', async (t) => {
  const { store } = db(t), gate = deferred();
  store.insertWorkspace({ key: 'ws', kind: 'folder', root: '/fake/repo', createdAt: 1 });
  const k = new Kanbans({ store, broadcast() {}, occupied: () => [], resolveWorkspace: () => gate.promise, sessionCard() {}, apiError });
  const board = await k.create({ columns: ['todo'] });
  const slow = k.update({ kanban: board.kanbanId, workspace: 'ws', op: 'addCard', text: 'slow' });
  await k.update({ kanban: board.kanbanId, op: 'addCard', text: 'fast' });
  gate.resolve({ key: 'ws' }); await slow;
  assert.deepEqual(store.getKanban(board.kanbanId).columns[0].cards.map((c) => c.text), ['fast', 'slow']);
  await assert.rejects(k.update({ kanban: board.kanbanId, ops: [{ op: 'addCard', text: 'rolled back' }, { op: 'editCard', card: 'missing', text: 'x' }] }), { code: 'not_found' });
  assert.equal(store.getKanban(board.kanbanId).columns[0].cards.length, 2);
});

for (const kind of ['memo', 'kanban']) for (const action of ['create', 'update']) test(`${kind}.${action} 중 워크스페이스가 닫히면 지워진 소속을 쓰지 않는다`, async (t) => {
  const { store, dir } = db(t), b = new Backend({ logDir: dir });
  b.store = store; b.api = { broadcast() {} }; b.sessions = new Map();
  store.insertWorkspace({ key: 'ws', kind: 'folder', root: '/fake/repo', createdAt: 1 });
  const closingLookup = deferred();
  const ctx = { store, broadcast() {}, occupied: () => [], resolveWorkspace: () => closingLookup.promise, apiError, sessionCard() {} };
  const item = kind === 'memo' ? new Memos(ctx) : new Kanbans(ctx);
  const existing = action === 'update' ? await item.create({}) : null;
  const pending = item[action]({ workspace: 'ws', ...(existing ? { [kind]: existing[`${kind}Id`] } : {}) });
  const rejection = assert.rejects(pending, { code: 'not_found' });
  await b.workspaceClose({ workspace: 'ws', confirm: true });
  closingLookup.resolve({ key: 'ws' });
  await rejection;
  assert.equal([...store.memos(), ...store.kanbans()].some((x) => x.workspaceKey === 'ws'), false);
});

for (const value of ['__proto__', 'constructor', 'toString']) test(`설정 boolean은 프로토타입 이름 ${value}를 값으로 받지 않는다`, (t) => {
  const { store } = db(t), st = new Settings({ store, broadcast() {} });
  assert.throws(() => st.set({ tray: value }), { code: 'bad_request' });
  assert.equal(st.get().tray, true);
});
test('설정의 상속된 키와 빈 숫자를 거부한다', () => {
  assert.throws(() => normalizePatch({ constructor: 1 }), { code: 'bad_request' });
  assert.throws(() => normalizePatch({ sleepAfterMin: ' ' }), { code: 'bad_request' });
});

test('비-Claude hook 대화 기록이 있어도 전용 출력 이력을 가리지 않는다', (t) => {
  const { store, dir } = db(t);
  const s = { sessionId: 'a', name: 'a', kind: 'agy', rt: { agyTranscriptPath: '/fake/agy.json' } };
  store.addEvent('a', 'answer_agy', { text: 'result', prompt: 'task' }, 1000);
  const o = new Outputs({ store, cfg: { dataDir: dir }, resolve: () => s, hooked: () => true, transcriptOf: () => '/fake/agy.json', readMessages: () => ({ exists: true, messages: [] }), workspaceName: () => null, apiError });
  assert.equal(o.get({ session: 'a' }).turn?.answer, 'result');
});

test('출력 이력의 이전 화면 답과 새 hook 답을 함께 선택하고 저장한다', (t) => {
  const { store, dir } = db(t);
  const s = { sessionId: 'a', name: 'a', kind: 'agy', rt: {} };
  store.addEvent('a', 'answer_screen', { text: 'old screen', prompt: 'first' }, 1000);
  store.addEvent('a', 'answer_agy', { text: 'new transcript', prompt: 'second' }, 2000);
  const o = new Outputs({ store, cfg: { dataDir: dir }, resolve: () => s, hooked: () => false, workspaceName: () => null, apiError });
  assert.equal(o.get({ session: 'a' }).turnCount, 2);
  assert.equal(o.get({ session: 'a', turn: 1 }).source, 'screen');
  assert.equal(o.get({ session: 'a', turn: -1 }).turn.answer, 'new transcript');
  const saved = o.save({ session: 'a', turn: 1 });
  assert.match(fs.readFileSync(saved.file, 'utf8'), /old screen/);
  assert.match(fs.readFileSync(saved.file, 'utf8'), /화면에서 고른 답/);
});

test('한 사용자 메시지의 여러 text 블록은 출력 턴 하나로 합친다', (t) => {
  const { dir } = db(t), file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, [
    { type: 'user', message: { content: [{ type: 'text', text: 'first part' }, { type: 'text', text: 'second part' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } },
  ].map(JSON.stringify).join('\n'));
  const turns = turnsFromMessages(readMessages(file).messages);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].prompt, 'first part\n\nsecond part');
  assert.equal(turns[0].answer, 'answer');
});

test('루트 폴더 워크스페이스의 자식 폴더는 다른 워크스페이스가 아니다', () => {
  for (const [root, cwd] of [['/', '/tmp/project'], ['C:/', 'C:/project']]) {
    assert.equal(elsewhereOf({ key: root.toLowerCase(), kind: 'folder', root }, { isRepo: false, cwd }), null);
  }
});

function worktrees(t, list) {
  const { store, dir } = db(t), b = new Backend({ logDir: dir });
  b.store = store; b.sessions = new Map(); b.log = () => {}; b.api = { broadcast() {} }; b.broadcastWorkspaces = () => {};
  const ws = { key: '/repo/.git', root: '/repo', kind: 'repo', createdAt: 1 };
  store.insertWorkspace(ws); store.setWorkspaceAnchor(ws.key, 0, 0);
  b.worktrees = attachWorktrees(b, { tickMs: 0, list, exists: () => true });
  t.after(() => b.worktrees.stop());
  return { store, ws, trees: b.worktrees };
}
const porcelain = 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /worker\nHEAD abc\nbranch refs/heads/worker\n';
test('워크스페이스를 닫는 동안 돌아온 git 조회가 영역을 되살리지 않는다', async (t) => {
  const gate = deferred(), entered = deferred();
  const r = worktrees(t, () => { entered.resolve(); return gate.promise; });
  const pending = r.trees.sync(); await entered.promise;
  r.store.deleteWorkspace(r.ws.key); gate.resolve(porcelain); await pending;
  assert.deepEqual(r.store.worktreeAreas(), []);
  assert.equal(r.trees.live(r.ws.key), null);
});
test('워크트리 감시를 멈추면 진행 중 조회도 판을 쓰지 않는다', async (t) => {
  const gate = deferred(), entered = deferred();
  const r = worktrees(t, () => { entered.resolve(); return gate.promise; });
  const pending = r.trees.sync(); await entered.promise;
  r.trees.stop(); gate.resolve(porcelain); await pending;
  assert.deepEqual(r.store.worktreeAreas(), []);
});
test('닫은 워크스페이스의 워크트리 캐시를 버린다', async (t) => {
  const r = worktrees(t, async () => porcelain); await r.trees.sync();
  r.store.deleteWorkspace(r.ws.key); await r.trees.sync();
  assert.equal(r.trees.live(r.ws.key), null);
});

function searchRig(t) {
  const { store } = db(t);
  const s = { sessionId: 'a', name: 'agent', lastAnswer: 'latest unrelated answer' };
  const b = { store, sessions: new Map([['a', s]]), summary: (s) => s, workspaceList: () => [] };
  return { store, query: (q) => searchQuery(b, { q }).results };
}
for (const kind of ['answer_gemini', 'answer_agy']) test(`${kind}의 지난 답도 최신 답이 바뀐 뒤 검색된다`, (t) => {
  const r = searchRig(t);
  r.store.addEvent('a', kind, { text: 'older unique-result-42', prompt: 'task' }, 1000);
  r.store.addEvent('a', kind, { text: 'latest unrelated answer', prompt: 'next' }, 2000);
  const hits = r.query('unique-result-42');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sessionId, 'a');
  assert.match(hits[0].snippet, /unique-result-42/);
});

for (const kind of ['answer_screen', 'hook']) test(`${kind}의 따옴표와 역슬래시는 JSON 이스케이프와 상관없이 검색된다`, (t) => {
  const r = searchRig(t), text = 'quoted"token and path\\token';
  r.store.addEvent('a', kind, kind === 'hook' ? { ev: 'Stop', lastAnswer: text } : { text }, 1000);
  for (const q of ['quoted"token', 'path\\token']) assert.equal(r.query(q).length, 1, q);
});
