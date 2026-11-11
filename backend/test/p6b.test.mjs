// P6b 단위 시험: 출력 보기, Thread, 메모, 칸반, 루프(조건 판정, 시계 흉내로 이어 가기), 미션 맵, 설정, 저장소 표 더하기.
// herdr와 claude 없이 돈다. 루프는 시계를 흉내 낸다(LoopEngine의 now, tick(now))
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { isLongAnswer, turnsFromMessages, turnsFromScreenEvents, pickTurn, safeName, outputFileName, renderMarkdown, Outputs } from '../src/outputs.mjs';
import { ThreadLog, resultPhase, itemPhase, reportOf, turnAnswers, REPORT_CHARS } from '../src/thread.mjs';
import { Memos, placeRight, MEMO } from '../src/memos.mjs';
import { applyKanbanOp, newColumns, Kanbans, DEFAULT_COLUMNS } from '../src/kanban.mjs';
import { parseDuration, normalizeTrigger, normalizeStop, decideTarget, stopReason, goalReached, describeLoop, LoopEngine, LOOP } from '../src/loops.mjs';
import { missionGraph, categoryOf } from '../src/mission.mjs';
import { Settings, normalizePatch } from '../src/settings.mjs';
import { attachFeatures } from '../src/features.mjs';
import { newRuntime, applyHerdrDisconnected } from '../src/state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p6b-'));
const newStore = () => new Store(path.join(tmp(), 'board.db'));
const apiError = (code, message) => Object.assign(new Error(message), { code });

// ---------- 저장소 ----------
test('저장소: P4·P5 판(board.db)을 열면 P6b 표가 빈 채로 생기고 이전 기록은 그대로다', () => {
  const file = path.join(tmp(), 'board.db');
  const db = new DatabaseSync(file);
  db.exec(fs.readFileSync(path.join(HERE, 'fixtures', 'p4-schema.sql'), 'utf8'));
  db.prepare("INSERT INTO sessions (session_id, name, cwd, permission_mode, settings_path, hook_token, created_at) VALUES ('a', 'a', 'C:/x', 'manual', '', '', 1)").run();
  db.close();
  const st = new Store(file);
  const tables = new Set(st.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  for (const t of ['thread_items', 'thread_results', 'memos', 'kanbans', 'loops']) assert.ok(tables.has(t), t);
  assert.equal(st.getSession('a').name, 'a');
  assert.deepEqual(st.memos(), []);
  assert.deepEqual(st.loops(), []);
  st.close();
  const again = new Store(file); // 두 번 열어도 된다
  assert.equal(again.threadCount(), 0);
  again.close();
});

// ---------- I1 출력 보기 ----------
test('I1: 긴 답 판정(80자 또는 세 문단 넘음)', () => {
  assert.equal(isLongAnswer('짧은 답'), false);
  assert.equal(isLongAnswer('x'.repeat(80)), false);
  assert.equal(isLongAnswer('x'.repeat(81)), true);
  assert.equal(isLongAnswer('a\n\nb\n\nc'), false);
  assert.equal(isLongAnswer('a\n\nb\n\nc\n\nd'), true);
  assert.equal(isLongAnswer(null), false);
  assert.equal(isLongAnswer('   '), false);
});

const MSGS = [
  { seq: 0, at: 1000, role: 'user', text: '첫 지시' },
  { seq: 1, at: 1100, role: 'assistant', text: '먼저 볼게요' },
  { seq: 2, at: 1200, role: 'tool_use', tool: 'Bash' },
  { seq: 3, at: 1300, role: 'tool_result', text: 'ok' },
  { seq: 4, at: 1400, role: 'assistant', text: '끝: 첫 답' },
  { seq: 4, at: 1400, role: 'assistant', text: '둘째 조각' },
  { seq: 5, at: 2000, role: 'user', text: '[Request interrupted by user]' },
  { seq: 6, at: 3000, role: 'user', text: '둘째 지시' },
  { seq: 7, at: 3100, role: 'assistant', text: 'x'.repeat(100) },
  { seq: 8, at: 4000, role: 'user', text: '셋째 지시(답 없음)' },
];
test('I1: 대화 기록을 턴으로 나누고 턴의 마지막 답을 고른다. 거부·중단 표시는 지시가 아니다', () => {
  const turns = turnsFromMessages(MSGS);
  assert.equal(turns.length, 3);
  assert.equal(turns[0].prompt, '첫 지시');
  assert.equal(turns[0].answer, '끝: 첫 답\n\n둘째 조각');
  assert.equal(turns[0].tools, 1);
  assert.equal(turns[1].long, true);
  assert.equal(turns[2].answer, null);
  assert.equal(pickTurn(turns).turn, 2, '턴을 주지 않으면 답이 있는 마지막 턴');
  assert.equal(pickTurn(turns, 1).turn, 1);
  assert.equal(pickTurn(turns, -1).turn, 3);
  assert.equal(pickTurn(turns, 9), null);
  assert.equal(pickTurn(turns, 0), null);
  const scr = turnsFromScreenEvents([{ t: 5, data: { text: '화면 답', prompt: '지시' } }]);
  assert.deepEqual([scr[0].turn, scr[0].answer, scr[0].prompt], [1, '화면 답', '지시']);
});

test('I1: 파일 이름은 쓸 수 없는 글자를 바꾸고, 문서에 지시와 답이 있다', () => {
  assert.equal(safeName('parent/repo'), 'parent_repo');
  assert.equal(safeName('C:/a\\b'), 'C_a_b');
  assert.equal(safeName('con'), 'board');
  assert.equal(safeName(''), 'board');
  assert.match(outputFileName({ session: 's1', turn: 2, at: new Date(2026, 9, 30, 9, 5, 7).getTime() }), /^s1-t2-20261030-090507\.md$/);
  const md = renderMarkdown({ session: 's1', workspace: 'multitask', cwd: 'C:/x', turn: 2, prompt: '줄1\n줄2', answer: '# 답', answerAt: 1, source: 'transcript' });
  assert.match(md, /^# @s1 턴 2/);
  assert.match(md, /> 줄1\n> 줄2/);
  assert.match(md, /## 응답\n\n# 답\n$/);
});

test('I1: output.get은 지난 턴들도 주고, output.save는 판 데이터 폴더의 outputs/<워크스페이스>/에 쓴다', () => {
  const dir = tmp();
  const store = newStore();
  const tx = path.join(dir, 't.jsonl');
  const line = (o) => JSON.stringify(o);
  fs.writeFileSync(tx, [
    line({ type: 'user', timestamp: new Date(1000).toISOString(), message: { content: '지시 하나' } }),
    line({ type: 'assistant', timestamp: new Date(2000).toISOString(), message: { content: [{ type: 'text', text: '답 하나' }] } }),
    line({ type: 'user', timestamp: new Date(3000).toISOString(), message: { content: '지시 둘' } }),
    line({ type: 'assistant', timestamp: new Date(4000).toISOString(), message: { content: [{ type: 'text', text: '긴 답 '.repeat(30) }] } }),
  ].join('\n'));
  const s = { sessionId: 'sid', name: 's1', cwd: dir, kind: 'claude', workspaceKey: 'k', rt: newRuntime() };
  const { readMessages } = awaitImport;
  const o = new Outputs({ cfg: { dataDir: dir }, store, resolve: () => s, hooked: () => true, transcriptOf: () => tx, readMessages, workspaceName: () => 'parent/repo', apiError });
  const g = o.get({ session: 's1' });
  assert.equal(g.turnCount, 2);
  assert.equal(g.turn.turn, 2);
  assert.equal(g.turn.long, true);
  assert.equal(g.turns[0].answerHead, '답 하나');
  assert.equal(o.get({ session: 's1', turn: 1 }).turn.markdown, '답 하나');
  assert.throws(() => o.get({ session: 's1', turn: 5 }), (e) => e.code === 'not_found');
  const r = o.save({ session: 's1', turn: 1 });
  assert.equal(path.dirname(r.file), path.join(dir, 'outputs', 'parent_repo'));
  assert.match(fs.readFileSync(r.file, 'utf8'), /답 하나/);
  // hook이 없는 세션은 화면에서 고른 답(판 이벤트)
  const s2 = { sessionId: 'sid2', name: 'cx', cwd: dir, kind: 'codex', workspaceKey: 'k', rt: newRuntime({ kind: 'codex', hooked: false }) };
  store.addEvent('sid2', 'answer_screen', { text: '화면 답', prompt: null });
  const o2 = new Outputs({ cfg: { dataDir: dir }, store, resolve: () => s2, hooked: () => false, transcriptOf: () => null, readMessages, workspaceName: () => null, apiError });
  assert.equal(o2.get({ session: 'cx' }).source, 'screen');
  assert.equal(path.basename(path.dirname(o2.save({ session: 'cx' }).file)), 'board');
});
const awaitImport = await import('../src/transcript.mjs');

// ---------- I2 Thread ----------
test('I2: 결과 단계와 줄 단계, 완료 보고는 4,000자까지', () => {
  assert.equal(resultPhase({ status: 'queued' }), 'delivering');
  assert.equal(resultPhase({ status: 'confirmed' }), 'running');
  assert.equal(resultPhase({ status: 'confirmed', report: { text: 'x' } }), 'done');
  assert.equal(resultPhase({ status: 'failed', reason: 'timeout (waiting)' }), 'abandoned');
  assert.equal(resultPhase({ status: 'failed', reason: 'session closed' }), 'failed');
  assert.equal(itemPhase([{ status: 'confirmed', report: {} }, { status: 'failed', reason: 'x' }]), 'partial');
  assert.equal(itemPhase([{ status: 'confirmed', report: {} }]), 'done');
  assert.equal(itemPhase([{ status: 'sent' }]), 'active');
  const r = reportOf({ state: 'ready', lastAnswer: 'y'.repeat(5000) });
  assert.equal(r.text.length, REPORT_CHARS); assert.equal(r.clipped, true);
  assert.match(reportOf({ state: 'error', error: { type: 'rate_limit' } }).text, /rate_limit/);
  assert.equal(turnAnswers({ confirmedAt: 1000 }, { startedAt: 1000, endedAt: 2000 }), true);
  assert.equal(turnAnswers({ confirmedAt: 10000 }, { startedAt: 1000, endedAt: 2000 }), false, '보내기 전 턴');
  assert.equal(turnAnswers({ confirmedAt: 1000 }, { startedAt: 1500, endedAt: null }), false, '아직 도는 턴');
});

test('I2: 보낸 글 → 전달 상태 → 제출 확인 → 턴이 끝나면 완료 보고. 버려진 전달도 남고, 최근 N개만 둔다', () => {
  const store = newStore();
  const events = [];
  const rts = new Map();
  const log = new ThreadLog({ store, broadcast: (e, d) => events.push([e, d]), runtimeOf: (sid) => rts.get(sid) || null }, { keep: 3 });
  const it = log.add({ text: '@a @b 해 줘', targets: ['@a', '@b'], deliveries: [{ deliveryId: 'd1', sessionId: 'A', name: 'a', status: 'queued' }, { deliveryId: 'd2', sessionId: 'B', name: 'b', status: 'queued' }] });
  assert.equal(it.phase, 'active');
  assert.equal(events.at(-1)[0], 'thread.item');
  log.onDelivery({ deliveryId: 'd1', status: 'sent', sentAt: 1000 });
  log.onDelivery({ deliveryId: 'd1', status: 'confirmed', confirmedAt: 1100 });
  rts.set('A', { state: 'working', turn: { startedAt: 1100, endedAt: null } });
  log.check('A');
  assert.equal(store.getThreadResult('d1').report, null, '턴이 끝나기 전에는 보고 없음');
  rts.set('A', { state: 'ready', turn: { startedAt: 1100, endedAt: 5000 }, lastAnswer: '다 했다', answerSource: 'hook' });
  log.check('A');
  assert.equal(store.getThreadResult('d1').report.text, '다 했다');
  log.onDelivery({ deliveryId: 'd2', status: 'failed', reason: 'timeout (waiting)' });
  const v = log.list({ limit: 10 }).items[0];
  assert.deepEqual(v.results.map((r) => r.phase), ['done', 'abandoned']);
  assert.equal(v.phase, 'partial');
  // 연결 알림 같은 Thread 밖의 전달은 무시
  log.onDelivery({ deliveryId: 'zz', status: 'confirmed' });
  for (let i = 0; i < 4; i++) log.add({ text: `글 ${i}`, targets: ['@a'], deliveries: [] });
  const page = log.list({ limit: 2 });
  assert.equal(store.threadCount(), 3);
  assert.deepEqual(page.items.map((x) => x.text), ['글 2', '글 3']);
  assert.equal(page.more, true);
  const older = log.list({ before: page.before, limit: 5 });
  assert.deepEqual(older.items.map((x) => x.text), ['글 1']);
  assert.equal(older.more, false);
  // 세션이 닫히면 기다리던 보고를 닫힘으로 끝낸다
  const it2 = log.add({ text: '마지막', targets: ['@c'], deliveries: [{ deliveryId: 'd9', sessionId: 'C', name: 'c', status: 'queued' }] });
  log.onDelivery({ deliveryId: 'd9', status: 'confirmed', confirmedAt: 1 });
  log.onClosed('C');
  assert.equal(store.getThreadResult('d9').report.state, 'closed');
  assert.equal(log.view(store.getThreadItem(it2.itemId)).phase, 'done');
});

// ---------- I3 메모 ----------
test('I3: 메모 만들기·고치기·지우기(글이 있으면 확인)·찾기. 자리를 주지 않으면 겹치지 않게 오른쪽에 둔다', async () => {
  const store = newStore();
  const ev = [];
  const ws = { repo: { key: 'k1' } };
  store.insertWorkspace({ key: 'k1', kind: 'folder', root: 'C:/repo', createdAt: 1 });
  const m = new Memos({ store, broadcast: (e, d) => ev.push([e, d]), resolveWorkspace: async (r) => { if (!ws[r]) throw apiError('not_found', r); return ws[r]; }, occupied: () => [{ x: 0, y: 10, w: 720, h: 460 }, ...store.memos()], apiError });
  const a = await m.create({ text: '# 할 것\n- 리뷰', workspace: 'repo' });
  assert.deepEqual([a.x, a.y, a.w, a.h, a.workspaceKey], [760, 10, MEMO.w, MEMO.h, 'k1']);
  const b = await m.create({ text: '', x: 5, y: 6, w: 50, h: 20 });
  assert.deepEqual([b.x, b.y, b.w, b.h, b.workspaceKey], [5, 6, MEMO.minW, MEMO.minH, null]);
  const c = await m.create({});
  assert.equal(c.x, a.x + a.w + 40);
  const u = await m.update({ memo: a.memoId, text: '바뀜', x: 100, workspace: null });
  assert.deepEqual([u.text, u.x, u.workspaceKey], ['바뀜', 100, null]);
  await assert.rejects(m.update({ memo: 'nope' }), (e) => e.code === 'not_found');
  await assert.rejects(m.create({ text: 'x'.repeat(MEMO.maxText + 1) }), /자까지/);
  assert.equal((await m.list({ q: '바뀜' })).length, 1);
  assert.equal(m.delete({ memo: a.memoId }).needsConfirm, true);
  assert.equal(m.delete({ memo: b.memoId }).deleted, true, '빈 메모는 바로 지운다');
  assert.equal(m.delete({ memo: a.memoId, confirm: true }).deleted, true);
  assert.deepEqual(ev.filter((x) => x[0] === 'memo.removed').map((x) => x[1].memoId), [b.memoId, a.memoId]);
  assert.deepEqual(placeRight([], { w: 1, h: 1 }), { x: 0, y: 0 });
});

// ---------- I4 칸반 ----------
test('I4: 칸반 열과 카드 바꾸기(순수 함수)', () => {
  let cols = newColumns();
  assert.deepEqual(cols.map((c) => c.name), DEFAULT_COLUMNS);
  const r1 = applyKanbanOp(cols, { op: 'addCard', text: '리뷰', sessionId: 'S1' });
  assert.equal(r1.columns[0].cards[0].text, '리뷰');
  assert.equal(cols[0].cards.length, 0, '받은 배열은 바꾸지 않는다');
  cols = r1.columns;
  const card = r1.result.cardId;
  cols = applyKanbanOp(cols, { op: 'addCard', column: '할 일', text: '먼저', index: 0 }).columns;
  assert.deepEqual(cols[0].cards.map((c) => c.text), ['먼저', '리뷰']);
  cols = applyKanbanOp(cols, { op: 'moveCard', card, column: '완료' }).columns;
  assert.equal(cols[2].cards[0].cardId, card);
  cols = applyKanbanOp(cols, { op: 'linkCard', card, sessionId: null }).columns;
  assert.equal(cols[2].cards[0].sessionId, null);
  cols = applyKanbanOp(cols, { op: 'editCard', card, text: '리뷰 끝' }).columns;
  const add = applyKanbanOp(cols, { op: 'addColumn', name: '보류', index: 1 });
  cols = add.columns;
  assert.deepEqual(cols.map((c) => c.name), ['할 일', '보류', '진행 중', '완료']);
  cols = applyKanbanOp(cols, { op: 'renameColumn', column: add.result.columnId, name: '막힘' }).columns;
  cols = applyKanbanOp(cols, { op: 'moveColumn', column: '막힘', index: 99 }).columns;
  assert.equal(cols.at(-1).name, '막힘');
  cols = applyKanbanOp(cols, { op: 'removeColumn', column: '막힘' }).columns;
  cols = applyKanbanOp(cols, { op: 'removeCard', card }).columns;
  assert.equal(cols.reduce((n, c) => n + c.cards.length, 0), 1);
  assert.throws(() => applyKanbanOp(cols, { op: 'addCard', text: '  ' }), (e) => e.code === 'bad_request');
  assert.throws(() => applyKanbanOp(cols, { op: 'moveCard', card: 'x' }), (e) => e.code === 'not_found');
  assert.throws(() => applyKanbanOp(newColumns(['한 열']), { op: 'removeColumn', column: 0 }), /마지막 열/);
  assert.throws(() => applyKanbanOp(cols, { op: 'fly' }), (e) => e.code === 'bad_request');
});

test('I4: 칸반 노드 — 체크리스트(열 하나), 세션 잇기와 이은 카드의 세션 요약, 카드가 든 열·칸반 지우기는 확인', async () => {
  const store = newStore();
  store.insertWorkspace({ key: 'k1', kind: 'folder', root: 'C:/repo', createdAt: 1 });
  const sessions = { s1: { sessionId: 'S1', name: 's1' } };
  const k = new Kanbans({
    store, broadcast: () => {}, resolveWorkspace: async () => ({ key: 'k1' }), occupied: () => [], apiError,
    resolveSession: (r) => { if (!sessions[r]) throw apiError('not_found', r); return sessions[r]; },
    sessionCard: (sid) => ({ open: sid === 'S1', sessionId: sid, name: 's1', state: 'working' }),
  });
  const list = await k.create({ columns: ['체크'] });
  assert.equal(list.title, '체크리스트');
  const b = await k.create({ title: '이번 주', workspace: 'repo' });
  assert.equal(b.workspaceKey, 'k1');
  const u = await k.update({ kanban: b.kanbanId, ops: [{ op: 'addCard', text: '리뷰 맡기기', session: 's1' }, { op: 'addCard', column: '진행 중', text: '테스트' }] });
  assert.equal(u.results.length, 2);
  const linked = u.columns[0].cards[0];
  assert.deepEqual([linked.sessionId, linked.session.state], ['S1', 'working']);
  await assert.rejects(k.update({ kanban: b.kanbanId, op: 'addCard', text: 'x', session: 'nope' }), /nope/);
  const one = await k.update({ kanban: b.kanbanId, op: 'moveCard', card: linked.cardId, column: '완료' });
  assert.equal(one.columns[2].cards[0].cardId, linked.cardId);
  assert.equal((await k.update({ kanban: b.kanbanId, op: 'removeColumn', column: '완료' })).needsConfirm, true);
  assert.equal(store.getKanban(b.kanbanId).columns.length, 3, '확인 전에는 바꾸지 않는다');
  await k.update({ kanban: b.kanbanId, op: 'removeColumn', column: '완료', confirm: true });
  assert.equal(store.getKanban(b.kanbanId).columns.length, 2);
  assert.equal(k.delete({ kanban: b.kanbanId }).needsConfirm, true);
  assert.equal(k.delete({ kanban: list.kanbanId }).deleted, true);
  assert.equal(k.linkedTo('S1').length, 0, '이은 카드를 지웠다');
});

// ---------- I5 루프 ----------
test('I5: 시간 글과 조건 풀기. 주기는 1분~24시간', () => {
  assert.equal(parseDuration('90s'), 90000);
  assert.equal(parseDuration('1m'), 60000);
  assert.equal(parseDuration('1.5h'), 5400000);
  assert.equal(parseDuration(1234), 1234);
  assert.equal(parseDuration('soon'), null);
  assert.deepEqual(normalizeTrigger({ type: 'interval', every: '1m' }), { type: 'interval', everyMs: 60000, immediate: true });
  assert.throws(() => normalizeTrigger({ type: 'interval', every: '59s' }), /1분~24시간/);
  assert.throws(() => normalizeTrigger({ type: 'interval', every: '25h' }), /1분~24시간/);
  assert.deepEqual(normalizeTrigger({ type: 'idle' }), { type: 'idle' });
  assert.deepEqual(normalizeTrigger({ type: 'text', text: 'DONE' }), { type: 'text', text: 'DONE', source: 'answer', immediate: false });
  assert.throws(() => normalizeTrigger({ type: 'text', text: '' }), /검색할 문구/);
  assert.throws(() => normalizeTrigger({ type: 'text', text: 'x', source: 'log' }), /source/);
  assert.throws(() => normalizeTrigger(null), /trigger/);
  assert.deepEqual(normalizeStop({ maxRuns: 3, maxMs: '10m', untilText: 'GOAL' }), { maxRuns: 3, maxMs: 600000, untilText: 'GOAL' });
  assert.deepEqual(normalizeStop({}), {});
  assert.throws(() => normalizeStop({ maxRuns: 0 }), /maxRuns/);
  assert.match(describeLoop({ targetLabel: '@s1', prompt: '테스트 돌려', trigger: normalizeTrigger({ type: 'interval', every: '1m' }), stop: { maxRuns: 2 } }), /1분마다.*2회 전송 후.*토큰/);
});

test('I5: 차례 판정 — 주기, 쉴 때, 글. 내 차례·셸·시작 중은 건너뛰고, 앞 전달이 남았으면 기다린다', () => {
  const iv = { trigger: { type: 'interval', everyMs: 60000 } };
  const t = (o) => ({ sessionId: 'S', kind: 'claude', state: 'ready', turnEndedAt: 100, lastAnswer: null, lastAnswerAt: null, screenHas: null, delivery: null, ...o });
  assert.equal(decideTarget(iv, {}, t(), 0).action, 'none', '때가 안 됨');
  assert.equal(decideTarget(iv, {}, t(), 0, { due: true }).action, 'fire');
  assert.equal(decideTarget(iv, {}, t({ state: 'working' }), 0, { due: true }).action, 'fire', '일하는 중이면 대기열이 기다린다');
  assert.deepEqual(decideTarget(iv, {}, t({ state: 'waiting' }), 0, { due: true }).reason, 'needs_you');
  assert.deepEqual(decideTarget(iv, {}, t({ state: 'trust_wait' }), 0, { due: true }).reason, 'needs_you');
  assert.deepEqual(decideTarget(iv, {}, t({ delivery: { status: 'queued' } }), 0, { due: true }).reason, 'busy');
  assert.deepEqual(decideTarget(iv, {}, t({ kind: 'shell' }), 0, { due: true }).reason, 'shell');
  assert.deepEqual(decideTarget(iv, {}, t({ state: 'starting' }), 0, { due: true }).reason, 'not_ready');

  const idle = { trigger: { type: 'idle' } };
  assert.equal(decideTarget(idle, {}, t(), 10000).action, 'fire', '처음엔 지금 쉬고 있으면 보낸다');
  assert.equal(decideTarget(idle, { firedTurnEnd: 100, lastRunAt: 1 }, t(), 10000).action, 'none', '보낸 뒤 새 턴이 끝나지 않았다');
  assert.equal(decideTarget(idle, { firedTurnEnd: 100, lastRunAt: 1 }, t({ turnEndedAt: 200 }), 10000).action, 'fire', '새 턴이 끝났다');
  assert.equal(decideTarget(idle, { firedTurnEnd: 100, lastRunAt: 9000 }, t({ turnEndedAt: 200 }), 10000).reason, 'gap', '너무 잦으면 기다린다');
  assert.equal(decideTarget(idle, {}, t({ state: 'waiting' }), 10000).action, 'none');
  assert.equal(decideTarget(idle, {}, t({ delivery: { status: 'sent' } }), 10000).action, 'wait');

  const tx = { trigger: { type: 'text', text: 'NEXT', source: 'answer' } };
  const d1 = decideTarget(tx, { answerAtSeen: 50 }, t({ lastAnswer: '... NEXT', lastAnswerAt: 60 }), 10000);
  assert.equal(d1.action, 'fire'); assert.equal(d1.seen.answerAtSeen, 60);
  assert.equal(decideTarget(tx, { answerAtSeen: 60 }, t({ lastAnswer: '... NEXT', lastAnswerAt: 60 }), 10000).action, 'none', '같은 답은 한 번만');
  assert.equal(decideTarget(tx, { answerAtSeen: 50 }, t({ lastAnswer: 'nope', lastAnswerAt: 60 }), 10000).action, 'none');
  assert.equal(decideTarget(tx, { answerAtSeen: 50 }, t({ state: 'waiting', lastAnswer: 'NEXT', lastAnswerAt: 60 }), 10000).reason, 'needs_you');
  const sc = { trigger: { type: 'text', text: 'NEXT', source: 'screen' } };
  assert.equal(decideTarget(sc, { screenSeen: false }, t({ screenHas: true }), 10000).action, 'fire', '화면에 새로 나타남');
  assert.equal(decideTarget(sc, { screenSeen: true }, t({ screenHas: true }), 10000).action, 'none', '이미 있던 글');
  assert.equal(decideTarget(sc, { screenSeen: true }, t({ screenHas: false }), 10000).seen.screenSeen, false);

  assert.equal(stopReason({ stop: { maxRuns: 2 }, runs: 2, elapsedMs: 0 }), 'max_runs');
  assert.equal(stopReason({ stop: { maxMs: 1000 }, runs: 0, elapsedMs: 1000 }), 'max_time');
  assert.equal(stopReason({ stop: {}, runs: 99, elapsedMs: 9e9 }), null);
  assert.equal(goalReached({ stop: { untilText: 'GOAL' }, lastRunAt: 10 }, { lastAnswer: 'GOAL!', lastAnswerAt: 11 }), true);
  assert.equal(goalReached({ stop: { untilText: 'GOAL' }, lastRunAt: 10 }, { lastAnswer: 'GOAL!', lastAnswerAt: 9 }), false, '루프가 보내기 전의 답');
});

// 루프 엔진 시험대: 시계, 세션 상태, 대기열을 흉내 낸다
function loopRig({ store = newStore(), clock = { t: 1_000_000 }, sessions = {} } = {}) {
  const deliveries = new Map();
  const sent = [];
  const threads = [];
  let n = 0;
  const ctx = {
    store, now: () => clock.t, broadcast: () => {}, log: () => {},
    targetsOf: (l) => {
      const toT = (s) => { const per = (l.per || {})[s.sessionId] || {}; return { ...s, delivery: per.deliveryId ? deliveries.get(per.deliveryId) || null : null, screenHas: s.screenHas ?? null }; };
      return l.target.kind === 'session' && sessions[l.target.id] ? [toT(sessions[l.target.id])] : null;
    },
    enqueue: (sessionId, text) => { const d = { deliveryId: `d${++n}`, sessionId, text, status: 'queued', reason: null }; deliveries.set(d.deliveryId, d); sent.push(d); return d; },
    deliveryOf: (id) => deliveries.get(id) || null,
    cancel: (id) => { const d = deliveries.get(id); d.status = 'cancelled'; },
    readScreen: async () => '',
    thread: (x) => threads.push(x),
  };
  const engine = new LoopEngine(ctx);
  engine.start({ timers: false });
  return { engine, ctx, clock, sessions, deliveries, sent, threads, store };
}
const sess = (id, o = {}) => ({ sessionId: id, name: id.toLowerCase(), kind: 'claude', state: 'ready', turnEndedAt: 1, lastAnswer: null, lastAnswerAt: null, ...o });
const finishDelivery = (rig) => { for (const d of rig.deliveries.values()) if (d.status === 'queued') d.status = 'confirmed'; };

test('I5: 주기 루프 — 지금 한 번, 1분마다, 내 차례는 건너뛰고, 횟수에 닿으면 끝난다. 보낸 지시는 Thread에 남는다', () => {
  const rig = loopRig({ sessions: { A: sess('A') } });
  const v = rig.engine.create({ target: { kind: 'session', id: 'A', name: 'a' }, prompt: 'ping', trigger: { type: 'interval', every: '1m' }, stop: { maxRuns: 3 } });
  rig.engine.tick();
  assert.equal(rig.sent.length, 1, '만들자마자 한 번');
  assert.equal(rig.threads[0].loopId, v.loopId);
  finishDelivery(rig);
  rig.clock.t += 30_000; rig.engine.tick();
  assert.equal(rig.sent.length, 1, '30초 뒤에는 아직');
  rig.clock.t += 30_000; rig.sessions.A.state = 'waiting'; rig.engine.tick();
  assert.equal(rig.sent.length, 1, '내 차례라 건너뜀');
  let l = rig.store.getLoop(v.loopId);
  assert.equal(l.skips, 1);
  assert.match(l.history.at(-1).reason, /needs_you/);
  rig.sessions.A.state = 'ready';
  rig.clock.t += 60_000; rig.engine.tick();
  assert.equal(rig.sent.length, 2);
  // 앞 전달이 아직 대기열에 있으면(working 중) 쌓지 않고 건너뛴다
  rig.clock.t += 60_000; rig.engine.tick();
  assert.equal(rig.sent.length, 2);
  assert.match(rig.store.getLoop(v.loopId).history.at(-1).reason, /busy/);
  finishDelivery(rig);
  rig.clock.t += 60_000; rig.engine.tick();
  assert.equal(rig.sent.length, 3);
  l = rig.store.getLoop(v.loopId);
  assert.deepEqual([l.status, l.stopReason, l.runs], ['done', 'max_runs', 3]);
  assert.equal(rig.deliveries.get('d3').status, 'queued', '횟수로 끝나도 마지막 전달은 간다');
  rig.clock.t += 600_000; rig.engine.tick();
  assert.equal(rig.sent.length, 3, '끝난 루프는 보내지 않는다');
});

test('I5: 대기열에서 내 차례를 만나 기다리는 루프 전달은 취소하고 건너뛴 것으로 센다', () => {
  const rig = loopRig({ sessions: { A: sess('A', { state: 'working' }) } });
  const v = rig.engine.create({ target: { kind: 'session', id: 'A', name: 'a' }, prompt: 'go', trigger: { type: 'interval', every: '5m' }, stop: {} });
  rig.engine.tick();
  assert.equal(rig.sent.length, 1);
  rig.deliveries.get('d1').reason = 'waiting';
  rig.clock.t += 1000; rig.engine.tick();
  assert.equal(rig.deliveries.get('d1').status, 'cancelled');
  assert.equal(rig.store.getLoop(v.loopId).skips, 1);
});

test('I5: 쉴 때 루프 — ready가 될 때마다 보내고, 답에 목표 글이 나오면 끝난다', () => {
  const rig = loopRig({ sessions: { A: sess('A', { turnEndedAt: 1000 }) } });
  const v = rig.engine.create({ target: { kind: 'session', id: 'A', name: 'a' }, prompt: 'continue', trigger: { type: 'idle' }, stop: { untilText: 'ALL DONE' } });
  rig.engine.tick();
  assert.equal(rig.sent.length, 1);
  finishDelivery(rig);
  rig.clock.t += 10_000; rig.engine.tick();
  assert.equal(rig.sent.length, 1, '새 턴이 끝나지 않았다');
  Object.assign(rig.sessions.A, { state: 'working', turnEndedAt: null });
  rig.clock.t += 10_000; rig.engine.tick();
  Object.assign(rig.sessions.A, { state: 'ready', turnEndedAt: rig.clock.t, lastAnswer: 'step 2', lastAnswerAt: rig.clock.t });
  rig.clock.t += 1000; rig.engine.tick();
  assert.equal(rig.sent.length, 2, '턴이 끝나 쉬자 다시 보냄');
  finishDelivery(rig);
  Object.assign(rig.sessions.A, { state: 'ready', turnEndedAt: rig.clock.t + 5000, lastAnswer: 'ALL DONE here', lastAnswerAt: rig.clock.t + 5000 });
  rig.clock.t += 6000; rig.engine.tick();
  const l = rig.store.getLoop(v.loopId);
  assert.deepEqual([l.status, l.stopReason, rig.sent.length], ['done', 'goal_text', 2]);
});

test('I5: 글 루프 — 만든 뒤에 새로 나온 답에 글이 있을 때 보낸다. 시간 멈춤 조건', () => {
  const rig = loopRig({ sessions: { A: sess('A', { lastAnswer: 'NEXT 이미 있던 답', lastAnswerAt: 500 }) } });
  const v = rig.engine.create({ target: { kind: 'session', id: 'A', name: 'a' }, prompt: 'more', trigger: { type: 'text', text: 'NEXT' }, stop: { maxMs: '2m' } });
  rig.engine.tick();
  assert.equal(rig.sent.length, 0, '만들기 전의 답은 보지 않는다');
  Object.assign(rig.sessions.A, { lastAnswer: 'ok NEXT please', lastAnswerAt: rig.clock.t + 1 });
  rig.clock.t += 1000; rig.engine.tick();
  assert.equal(rig.sent.length, 1);
  finishDelivery(rig);
  rig.clock.t += 120_000; rig.engine.tick();
  const l = rig.store.getLoop(v.loopId);
  assert.deepEqual([l.status, l.stopReason], ['done', 'max_time']);
});

test('I5: 멈춤과 이어 가기 — 사람이 멈추면 대기열의 루프 전달을 취소하고, 이어 가면 남은 시간부터', () => {
  const rig = loopRig({ sessions: { A: sess('A', { state: 'working' }) } });
  const v = rig.engine.create({ target: { kind: 'session', id: 'A', name: 'a' }, prompt: 'x', trigger: { type: 'interval', every: '10m' }, stop: { maxMs: '1h' } });
  rig.engine.tick();
  rig.clock.t += 4 * 60_000; rig.engine.tick();
  rig.engine.pause(v.loopId);
  assert.equal(rig.deliveries.get('d1').status, 'cancelled');
  const elapsed = rig.store.getLoop(v.loopId).elapsedMs;
  rig.clock.t += 60 * 60_000; rig.engine.tick();
  assert.equal(rig.store.getLoop(v.loopId).elapsedMs, elapsed, '멈춘 동안은 시간을 세지 않는다');
  assert.throws(() => rig.engine.pause(v.loopId), /실행 중이 아닌/);
  const r = rig.engine.resume(v.loopId);
  assert.equal(r.nextInMs, 6 * 60_000, '남은 6분부터');
  assert.throws(() => rig.engine.resume(v.loopId), /멈춘 루프만/);
  assert.equal(rig.engine.delete(v.loopId).deleted, true);
  assert.equal(rig.store.getLoop(v.loopId), null);
});

test('I5: 백엔드를 다시 띄우면 남은 횟수와 시간으로 이어 간다(꺼진 동안은 세지 않는다)', () => {
  const store = newStore();
  const clock = { t: 5_000_000 };
  const sessions = { A: sess('A') };
  const rig = loopRig({ store, clock, sessions });
  const v = rig.engine.create({ target: { kind: 'session', id: 'A', name: 'a' }, prompt: 'p', trigger: { type: 'interval', every: '10m' }, stop: { maxRuns: 3, maxMs: '1h' } });
  rig.engine.tick();
  finishDelivery(rig);
  clock.t += 3 * 60_000; rig.engine.tick();
  rig.engine.stop(); // 백엔드 끄기
  const before = store.getLoop(v.loopId);
  assert.equal(before.runs, 1);
  assert.equal(before.elapsedMs, 3 * 60_000);
  clock.t += 2 * 3600_000; // 두 시간 꺼져 있었다
  const rig2 = loopRig({ store, clock, sessions });
  const after = store.getLoop(v.loopId);
  assert.equal(after.status, 'active');
  assert.equal(after.nextAt - clock.t, 7 * 60_000, '다음 차례까지 남은 7분');
  assert.equal(after.elapsedMs, 3 * 60_000, '꺼진 시간은 세지 않았다');
  clock.t += 7 * 60_000; rig2.engine.tick();
  assert.equal(rig2.sent.length, 1, '남은 시간 뒤 두 번째 차례');
  assert.equal(store.getLoop(v.loopId).runs, 2);
  // 강제 종료(stop을 부르지 못함)도 마지막으로 살아 있던 시각(loopsAliveAt) 기준으로 민다
  rig2.engine.tick(clock.t + 5000);
  clock.t += 3600_000;
  loopRig({ store, clock, sessions });
  assert.ok(store.getLoop(v.loopId).nextAt > clock.t, '꺼져 있던 동안 지난 차례를 몰아 보내지 않는다');
});

// ---------- 루프·Thread를 백엔드에 붙이기(features.mjs) ----------
function fakeBackend() {
  const store = newStore();
  const queue = new EventEmitter();
  queue.items = new Map();
  let n = 0;
  queue.enqueue = (sessionId, text) => { const d = { deliveryId: `q${++n}`, sessionId, text, status: 'queued', reason: null, createdAt: Date.now() }; queue.items.set(d.deliveryId, d); store.insertDelivery(d); return d; };
  queue.cancel = (id) => { const d = queue.items.get(id); d.status = 'cancelled'; queue.items.delete(id); return d; };
  const mk = (id, name, kind = 'claude') => ({ sessionId: id, name, kind, cwd: 'C:/x', workspaceKey: 'k', rt: Object.assign(newRuntime({ kind, hooked: kind === 'claude' }), { phase: 'running', herdr: { status: 'idle', present: true, launchPending: false } }) });
  const sessions = new Map([['A', mk('A', 'a')], ['SH', mk('SH', 'sh1', 'shell')]]);
  const b = {
    store, queue, sessions, bus: new EventEmitter(), cfg: { dataDir: tmp(), claudeProjects: tmp() }, api: { broadcast: () => {} }, adapter: { connected: true }, herdrOk: true,
    log: () => {}, hooked: (s) => s.kind === 'claude', workspaceList: () => [{ key: 'k', name: 'repo' }], resolveWorkspace: async () => ({ key: 'k' }),
    resolve: (r) => { for (const s of sessions.values()) if (s.name === r || s.sessionId === r) return s; throw apiError('not_found', r); },
    summary: (s) => ({ sessionId: s.sessionId, name: s.name, kind: s.kind, state: 'ready', unseen: false, workspaceKey: 'k' }),
    linksOpen: () => [],
  };
  b.features = attachFeatures(b, { timers: false });
  return b;
}

test('I5: loop.create — 셸 거부, 만들 때 확인(confirm), 대상은 세션만(P22: 그룹 대상 없음)', async () => {
  const b = fakeBackend();
  const h = b.features.handlers;
  assert.throws(() => h['loop.create']({ session: 'sh1', prompt: 'x', trigger: { type: 'idle' }, confirm: true }), (e) => e.code === 'not_agent');
  const ask = h['loop.create']({ session: 'a', prompt: 'ping', trigger: { type: 'interval', every: '1m' }, stop: { maxRuns: 2 } });
  assert.equal(ask.needsConfirm, true);
  assert.match(ask.message, /토큰/);
  assert.equal(b.store.loops().length, 0, '확인 전에는 만들지 않는다');
  assert.throws(() => h['loop.create']({ session: 'a', prompt: 'ping', trigger: { type: 'interval', every: '10s' }, confirm: true }), /1분~24시간/);
  const v = h['loop.create']({ session: 'a', prompt: 'ping', trigger: { type: 'interval', every: '1m' }, stop: { maxRuns: 2 }, confirm: true });
  b.features.loops.tick();
  assert.equal(b.queue.items.size, 1);
  const th = h['thread.list']({ limit: 5 }).items;
  assert.deepEqual([th[0].source, th[0].loopId, th[0].results[0].name], ['loop', v.loopId, 'a']);
  assert.throws(() => h['loop.create']({ group: 'g', prompt: 'all', trigger: { type: 'idle' }, confirm: true }), (e) => e.code === 'bad_request', '그룹 대상은 받지 않는다');
  h['loop.create']({ session: 'a', prompt: 'again', trigger: { type: 'idle' }, confirm: true });
  assert.equal(b.features.summaryExtra(b.sessions.get('A')).loops, 2);
  assert.equal(h['loop.list']({ session: 'a' }).length, 2);
  for (const l of h['loop.list']({})) h['loop.delete']({ loop: l.loopId });
  assert.equal(b.store.loops().length, 0);
  b.features.stop();
});

test('I2·I6: Thread 줄에서 미션 맵이 사람 → 세션, 루프 선을 만든다. 열은 둘(P22: 그룹 열 없음)', () => {
  const sessions = [
    { sessionId: 'A', name: 'lead', state: 'working' },
    { sessionId: 'B', name: 'rev', state: 'waiting', ask: { kind: 'permission', summary: 'Bash: ls' } },
    { sessionId: 'C', name: 'c', state: 'ready', unseen: true },
  ];
  const links = [{ linkId: 'l1', from: 'A', to: 'B', role: '리뷰어', observed: true, spawned: false, count: 2, lastText: '리뷰해', lastKind: 'prompt', lastAt: 5 }];
  const thread = [
    { itemId: 't1', t: 1, source: 'bar', text: '@lead 시작', results: [{ sessionId: 'A', phase: 'done' }] },
    { itemId: 't2', t: 2, source: 'bar', text: '@rev @c 상태?', results: [{ sessionId: 'B', phase: 'running' }, { sessionId: 'C', phase: 'done' }] },
    { itemId: 't3', t: 3, source: 'loop', text: '루프', results: [{ sessionId: 'C', phase: 'done' }] },
  ];
  const loops = [{ loopId: 'r1', target: { kind: 'session', id: 'C' }, prompt: '계속', status: 'active', runs: 2, lastRunAt: 3 }];
  const m = missionGraph({ sessions, links, thread, loops });
  const e = (kind, from, to) => m.edges.find((x) => x.kind === kind && x.from === from && x.to === to);
  assert.ok(e('role', 's:A', 's:B'));
  assert.equal(e('prompt', 's:A', 's:B').label, '리뷰해');
  assert.equal(e('bar', 'human', 's:A').count, 1);
  assert.equal(e('bar', 'human', 's:B').active, true);
  assert.equal(e('bar', 'human', 's:C').count, 1, '루프 줄은 bar 선에 세지 않는다');
  assert.equal(e('loop', 'human', 's:C').active, true);
  assert.ok(!m.edges.some((x) => x.kind === 'member'));
  const node = (id) => m.nodes.find((x) => x.id === id);
  assert.equal(node('s:A').column, 0, '지시를 내리는 세션은 사람 열');
  assert.equal(node('s:B').column, 1);
  assert.ok(!m.nodes.some((x) => x.kind === 'group'));
  assert.equal(node('s:B').ask, 'Bash: ls');
  assert.deepEqual([m.counts.all, m.counts.working, m.counts.needs_you, m.counts.done], [3, 1, 1, 1]);
  assert.equal(categoryOf({ state: 'error' }), 'needs_you');
  assert.equal(categoryOf({ state: 'shell_idle' }), 'idle');
});

// ---------- I8 복구 ----------
test('I8: herdr가 꺼질 때 셸에서 돌던 명령은 끊긴 것으로 남는다. 쉬던 셸은 남기지 않는다', () => {
  const run = newRuntime({ kind: 'shell', hooked: false });
  run.phase = 'running'; run.shell = { atPrompt: false, command: 'ping -n 300 127.0.0.1', procs: ['PING.EXE'] };
  applyHerdrDisconnected(run, 50);
  assert.deepEqual(run.interruptedTurn, { state: 'shell_running', at: 50, prompt: 'ping -n 300 127.0.0.1' });
  const procOnly = newRuntime({ kind: 'shell', hooked: false });
  procOnly.shell = { atPrompt: false, command: null, procs: ['node.exe'] };
  applyHerdrDisconnected(procOnly, 1);
  assert.equal(procOnly.interruptedTurn.prompt, 'node.exe');
  const idle = newRuntime({ kind: 'shell', hooked: false });
  idle.shell = { atPrompt: true, command: 'dir', procs: [] };
  applyHerdrDisconnected(idle, 1);
  assert.equal(idle.interruptedTurn, null);
});

// ---------- I7 설정 ----------
test('I7: 설정 — 기본 꺼짐, on/off 글도 받고 모르는 키는 거부, 판 기록에 남는다', () => {
  const store = newStore();
  const ev = [];
  const st = new Settings({ store, broadcast: (e, d) => ev.push([e, d]) });
  // P8에서 가지 펼치기 상한(branchMax*)이 더해져 tray만 본다
  assert.equal(st.get().tray, true); // P14: 기본 켜짐
  assert.equal(st.set({ tray: 'off' }).tray, false);
  assert.equal(st.set({ tray: 'on' }).tray, true);
  assert.equal(new Settings({ store, broadcast: () => {} }).get().tray, true);
  assert.equal(st.set({ key: 'tray', value: false }).tray, false);
  assert.deepEqual(ev.map((x) => x[0]), ['settings.updated', 'settings.updated', 'settings.updated']);
  assert.throws(() => normalizePatch({ theme: 'dark' }), /모르는 설정/);
  assert.throws(() => normalizePatch({ tray: 'maybe' }), /참\/거짓/);
});
