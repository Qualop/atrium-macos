// P66 시험: 판의 이름(표시 이름) — 이름 규칙과 겹침(대소문자 무시), 비우기, @·CLI가 새 이름과 옛 주소를 둘 다 받음,
// herdr 이름 바뀜(renamed 동기화)이 판의 이름을 덮지 않음, 다시 켠 뒤·다시 연 뒤에도 남음, 새로 짓는 이름이 판의 이름을 피함
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { Backend } from '../src/backend.mjs';
import { checkLabel, findSession, takenNames, shownName, renameSession, keepLabel, LABEL_MAX } from '../src/session-label.mjs';
import { childName } from '../src/branch.mjs';
import { searchBoard } from '../src/search.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p66u-'));
const S = (name, label = null, extra = {}) => ({ sessionId: 'id-' + name, name, label, ...extra });

test('P66 이름 규칙: 한글·영문·숫자·-·_, 32자까지, all 아님. 비우거나 원래 이름이면 null', () => {
  const me = S('s12');
  const list = [me, S('s3'), S('p1-wine', 'Wine')];
  assert.deepEqual(checkLabel('reviewer', list, me), { label: 'reviewer' });
  assert.deepEqual(checkLabel('@Review_2-x', list, me), { label: 'Review_2-x' }, '앞의 @는 뗀다');
  assert.deepEqual(checkLabel('  ', list, me), { label: null }, '비우면 원래 이름');
  assert.deepEqual(checkLabel(null, list, me), { label: null });
  assert.deepEqual(checkLabel('s12', list, me), { label: null }, '원래 이름과 같으면 비운 것');
  const code = (fn) => { try { fn(); return null; } catch (e) { return [e.code, e.key]; } };
  assert.deepEqual(code(() => checkLabel('-x', list, me)), ['bad_request', 'labelBad']);
  assert.deepEqual(checkLabel('리뷰어', list, me), { label: '리뷰어' });
  assert.deepEqual(code(() => checkLabel('a b', list, me)), ['bad_request', 'labelBad']);
  assert.deepEqual(code(() => checkLabel('a'.repeat(LABEL_MAX + 1), list, me)), ['bad_request', 'labelTooLong']);
  assert.equal(code(() => checkLabel('a'.repeat(LABEL_MAX), list, me)), null, '32자는 된다');
  assert.deepEqual(code(() => checkLabel('ALL', list, me)), ['bad_request', 'labelAll']);
});

test('P66 겹침(대소문자 무시): 남의 주소와 남의 판 이름은 안 되고, 자기 판 이름은 다시 줄 수 있다', () => {
  const me = S('s12', 'mine');
  const list = [me, S('s3'), S('p1-wine', 'Wine')];
  const err = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const e1 = err(() => checkLabel('S3', list, me));
  assert.equal(e1.code, 'name_taken'); assert.equal(e1.key, 'labelTaken'); assert.equal(e1.vars.other, 's3');
  assert.equal(err(() => checkLabel('wine', list, me)).vars.other, 'Wine', '남의 판 이름(대소문자 무시)');
  assert.equal(err(() => checkLabel('P1-WINE', list, me)).vars.other, 'Wine', '판 이름을 바꾼 세션의 옛 주소도 쓸 수 없다');
  assert.deepEqual(checkLabel('MINE', list, me), { label: 'MINE' }, '자기 이름의 대소문자만 바꾸기');
  // 새로 짓는 이름도 판 이름을 피한다
  const taken = takenNames(list, ['pending1']);
  assert.ok(taken.has('WINE') && taken.has('s3') && taken.has('Mine') && taken.has('PENDING1') && !taken.has('s4'));
  assert.throws(() => childName({ want: 'wine', parentName: 's12', taken }), (e) => e.code === 'name_taken', '하위 세션 이름도 판 이름과 겹치지 않는다');
  assert.equal(childName({ want: null, parentName: 's12', taken }), 's12-w1');
  assert.equal(keepLabel('Wine', list, me), null, '다시 열 때 겹치면 버린다');
  assert.equal(keepLabel('other', list, me), 'other');
});

test('P66 이름 풀기: 새 이름과 옛 주소 둘 다. 주소(정확히)가 판 이름보다 먼저, 판 이름은 대소문자 무시', () => {
  const a = S('s12', 'reviewer'), b = S('s3'), c = S('p1-wine');
  const list = [a, b, c];
  assert.equal(findSession(list, '@reviewer'), a);
  assert.equal(findSession(list, 'Reviewer'), a);
  assert.equal(findSession(list, '@s12'), a, '옛 주소');
  assert.equal(findSession(list, 'id-s3'), b, '세션 ID');
  assert.equal(findSession(list, 'S3'), b, '주소도 대소문자 무시(하나일 때)');
  assert.equal(findSession(list, 'nope'), null);
  // 바깥(herdr)에서 붙은 이름이 남의 판 이름과 겹쳐도 주소가 이긴다(일하던 에이전트의 명령이 깨지지 않게)
  const x = S('s5', 'p1-wine');
  assert.equal(findSession([x, c], 'p1-wine'), c);
  assert.equal(shownName(a), 'reviewer'); assert.equal(shownName(b), 's3'); assert.equal(shownName(null), null);
});

test('P66 찾기: 판 이름을 바꾼 세션을 옛 주소로도 찾는다', () => {
  const hits = searchBoard({ q: 's12', sessions: [{ sessionId: 'id-s12', name: 'reviewer', address: 's12', workspaceKey: null }] });
  assert.equal(hits.length, 1); assert.equal(hits[0].name, 'reviewer');
});

// ---------- 판 위에서(가짜 백엔드) ----------
function board(dataDir = tmp()) {
  const b = new Backend({ quietMs: 600000, port: 0, logDir: tmp() });
  b.store = new Store(path.join(dataDir, 'board.db'));
  b.sessions = new Map();
  const sent = [];
  b.api = { broadcast: (...a) => sent.push(a) };
  b.log = () => {}; b.touch = () => {};
  const casts = [];
  b.broadcastSession = (s, o) => casts.push([s.name, o && o.cause]);
  const queued = [];
  b.queue = { enqueue: (sid, text) => { queued.push([sid, text]); return { deliveryId: 'd' + queued.length, status: 'queued' }; }, pending: () => 0 };
  b.features = null;
  const add = (name, extra = {}) => {
    const s = { sessionId: 'id-' + name, name, cwd: 'C:/t/a', kind: 'claude', origin: 'board', agentName: name, workspaceKey: null, rt: newRuntime({ kind: 'claude', hooked: true }), createdAt: Date.now(), permissionMode: 'manual', ...extra };
    b.sessions.set(s.sessionId, s);
    b.store.insertSession({ ...s, runtime: s.rt });
    return s;
  };
  return { b, add, casts, queued, dataDir };
}

test('P66 이름 바꾸기(판): 판 기록과 이벤트(누가), 요약은 보이는 이름·주소·판 이름, 하위 세션 요약도 다시 보낸다. 비우면 원래 이름', () => {
  const { b, add, casts } = board();
  const s = add('s12'); add('s3'); add('kid', { parentSessionId: 'id-s12' });
  const r = renameSession(b, { session: '@s12', name: 'reviewer', by: 'human' });
  assert.deepEqual([r.name, r.address, r.label, r.from, r.changed], ['reviewer', 's12', 'reviewer', 's12', true]);
  assert.equal(s.name, 's12', '주소(herdr 이름)는 그대로');
  assert.equal(b.store.getSession('id-s12').label, 'reviewer');
  const ev = b.store.events({ sessionId: 'id-s12', limit: 5 }).find((e) => e.kind === 'renamed');
  assert.deepEqual(ev.data, { from: 's12', to: 'reviewer', label: 'reviewer', address: 's12', by: 'human' });
  assert.deepEqual(casts.map((c) => c[1]), ['rename:human', 'rename:parent'], '자기와 하위 세션');
  const sum = b.summary(s);
  assert.deepEqual([sum.name, sum.address, sum.label], ['reviewer', 's12', 'reviewer']);
  assert.equal(b.nameOf('id-s12'), 'reviewer');
  // 겹침은 이유와 함께
  assert.throws(() => renameSession(b, { session: 's3', name: 'REVIEWER', by: 'cli' }), (e) => e.key === 'labelTaken');
  // 같은 이름 다시: 바뀐 것 없음, 이벤트 없음
  const n = b.store.events({ sessionId: 'id-s12', limit: 50 }).length;
  assert.equal(renameSession(b, { session: 'reviewer', name: 'reviewer' }).changed, false);
  assert.equal(b.store.events({ sessionId: 'id-s12', limit: 50 }).length, n);
  // CLI --clear
  const c = renameSession(b, { session: 'reviewer', clear: true, by: 'cli' });
  assert.deepEqual([c.name, c.label, c.from], ['s12', null, 'reviewer']);
  assert.equal(b.store.getSession('id-s12').label, null);
  assert.equal(b.store.events({ sessionId: 'id-s12', limit: 1 })[0].data.by, 'cli');
  assert.equal(b.summary(s).name, 's12');
});

test('P66 @이름으로 보내기와 판 CLI의 세션 지정: 새 이름과 옛 주소 둘 다', async () => {
  const { b, add, queued } = board();
  add('s12'); add('s3');
  renameSession(b, { session: 's12', name: 'reviewer', by: 'cli' });
  const r1 = await b.send({ text: '@reviewer hello' });
  const r2 = await b.send({ text: '@s12 hi' });
  const r3 = await b.send({ target: ['@Reviewer', '@s3'], text: 'both' });
  assert.deepEqual(queued.map((q) => q[0]), ['id-s12', 'id-s12', 'id-s12', 'id-s3']);
  assert.equal(r1.deliveries[0].name, 'reviewer', '요청 기록에는 보이는 이름');
  assert.equal(r2.deliveries[0].name, 'reviewer');
  assert.equal(r3.deliveries.length, 2);
  assert.equal(b.resolve('reviewer').sessionId, 'id-s12');
  assert.equal(b.resolve('@s12').sessionId, 'id-s12');
  await assert.rejects(() => b.send({ text: '@nobody x' }), (e) => e.key === 'targetNotFound');
});

test('P66 herdr 이름이 바뀌어도(renamed 동기화) 판의 이름은 그대로. 바뀐 주소로도 부른다', async () => {
  const { b, add } = board();
  const s = add('agent-1', { origin: 'adopted', kind: 'codex', paneId: 'p_1' });
  renameSession(b, { session: 'agent-1', name: 'planner', by: 'human' });
  b.adapter = { listAgents: async () => [{ paneId: 'p_1', name: 'codex-main' }] };
  await b.refreshAdoptedName(s);
  assert.equal(s.name, 'codex-main', '주소는 herdr 이름을 따른다');
  assert.equal(s.label, 'planner', '판의 이름은 덮지 않는다');
  assert.equal(b.store.getSession(s.sessionId).label, 'planner');
  assert.equal(b.summary(s).name, 'planner');
  assert.equal(b.resolve('codex-main'), s);
  assert.equal(b.resolve('planner'), s);
  // herdr 이름이 남의 판 이름과 겹치면 따라 바꾸지 않는다(판 안에서 이름은 하나)
  const t = add('agent-2', { origin: 'adopted', kind: 'codex', paneId: 'p_2' });
  b.adapter = { listAgents: async () => [{ paneId: 'p_2', name: 'planner' }] };
  await b.refreshAdoptedName(t);
  assert.equal(t.name, 'agent-2');
});

test('P66 오래 남기: 판 기록을 다시 열어도(백엔드 다시 켬) 판의 이름이 남고, 닫힌 세션 목록과 다시 열기 이름 풀기에도 쓴다', () => {
  const dataDir = tmp();
  const { b, add } = board(dataDir);
  add('s12');
  renameSession(b, { session: 's12', name: 'reviewer', by: 'cli' });
  b.store.close();
  const st = new Store(path.join(dataDir, 'board.db'));
  const row = st.openSessions().find((x) => x.sessionId === 'id-s12');
  assert.equal(row.label, 'reviewer');
  assert.equal(row.name, 's12');
  // 다시 켠 백엔드는 행을 그대로 세션으로 쓴다(startInner: { ...row, rt })
  const s = { ...row, rt: newRuntime({ kind: 'claude', hooked: true }) };
  assert.equal(shownName(s), 'reviewer');
  // 닫힌 세션: 목록에 판의 이름, 이름 풀기는 판 이름과 주소 둘 다
  st.updateSession('id-s12', { closedAt: Date.now() });
  const closed = st.closedSessions();
  assert.equal(closed[0].label, 'reviewer');
  assert.equal(findSession(closed, 'reviewer').sessionId, 'id-s12');
  assert.equal(findSession(closed, 's12').sessionId, 'id-s12');
  st.close();
});

test('P66 새 세션 이름(spawn)은 남의 판 이름을 피한다(대소문자 무시)', async () => {
  const { b, add } = board();
  add('s1');
  renameSession(b, { session: 's1', name: 'worker', by: 'cli' });
  b.requireHerdr = () => {};
  await assert.rejects(() => b.spawn({ cwd: tmp(), name: 'Worker', kind: 'shell' }), (e) => e.key === 'nameTaken');
  await assert.rejects(() => b.spawn({ cwd: tmp(), name: 'S1', kind: 'shell' }), (e) => e.key === 'nameTaken', '남의 주소도 대소문자 무시');
});
