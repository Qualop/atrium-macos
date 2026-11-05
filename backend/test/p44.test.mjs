// P44 시험: 워크스페이스 가상 그룹(ws-groups.mjs), 판 전체 정리에서 그룹끼리 모으기(region-layout.mjs), 워크스페이스 지우기 판단(ws-close.mjs)과 workspace.close 흐름
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NODE, overlaps } from '../src/canvas.mjs';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { Backend } from '../src/backend.mjs';
import * as ops from '../src/canvas-ops.mjs';
import { layoutRegions } from '../src/region-layout.mjs';
import { normalizeGroups, createGroup, renameGroup, removeGroup, moveWorkspace, moveGroup, dropWorkspaces, groupIndex, groupOf, GROUPS_META, GROUP_NAME_MAX } from '../src/ws-groups.mjs';
import { closePlan, checkAfter, isRunning } from '../src/ws-close.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p44u-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const dist = (a, b) => { const p = center(a), q = center(b); return Math.hypot(p.x - q.x, p.y - q.y); };
// 두 사각형 사이 가장 가까운 거리(겹치면 0)
const gapOf = (a, b) => Math.hypot(Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)));

// ---------- 그룹 저장·옮기기(순수 함수) ----------
test('P44 그룹: 만들기, 이름 바꾸기, 겹친 이름·빈 이름 거부, 지우면 안의 워크스페이스는 그룹 없음', () => {
  let s = normalizeGroups(null);
  assert.deepEqual(s, { groups: [] }, '옛 판(값 없음)은 그룹 없음으로 시작');
  const a = createGroup(s, '  프론트   엔드 ');
  assert.equal(a.created, 'g1');
  assert.equal(a.groups[0].name, '프론트 엔드', '빈칸을 정리한다');
  s = a;
  assert.equal(createGroup(s, '프론트 엔드').error, 'name_taken');
  assert.equal(createGroup(s, 'FRONT').error, undefined);
  assert.equal(createGroup(s, '   ').error, 'bad_name');
  assert.equal(createGroup(s, 'x'.repeat(GROUP_NAME_MAX + 1)).error, 'bad_name');
  s = createGroup(s, '백엔드');
  assert.equal(s.created, 'g2');
  s = moveWorkspace(s, 'ws/a', 'g1');
  s = moveWorkspace(s, 'ws/b', 'g1');
  assert.deepEqual(s.groups[0].members, ['ws/a', 'ws/b']);
  const r = renameGroup(s, 'g2', '서버');
  assert.equal(r.groups[1].name, '서버');
  assert.equal(renameGroup(s, 'g2', '프론트 엔드').error, 'name_taken');
  assert.equal(renameGroup(s, 'nope', 'x').error, 'not_found');
  const d = removeGroup(s, 'g1');
  assert.deepEqual(d.groups.map((g) => g.id), ['g2']);
  assert.deepEqual(d.released, ['ws/a', 'ws/b']);
  assert.equal(groupOf(d, 'ws/a'), null, '지운 그룹의 워크스페이스는 그룹 없음');
  // 받은 상태는 바꾸지 않는다
  assert.deepEqual(s.groups[0].members, ['ws/a', 'ws/b']);
});

test('P44 그룹: 워크스페이스는 그룹 하나에만, 그룹 안 순서는 사람이 정한다, 빼기와 그룹 순서', () => {
  let s = createGroup(createGroup(null, 'A'), 'B');
  s = moveWorkspace(s, 'w1', 'g1');
  s = moveWorkspace(s, 'w2', 'g1');
  s = moveWorkspace(s, 'w3', 'g1');
  s = moveWorkspace(s, 'w3', 'g1', 0);
  assert.deepEqual(s.groups[0].members, ['w3', 'w1', 'w2'], '같은 그룹 안에서 옮기면 순서만 바뀐다');
  s = moveWorkspace(s, 'w1', 'g2');
  assert.deepEqual(s.groups[0].members, ['w3', 'w2']);
  assert.deepEqual(s.groups[1].members, ['w1'], '다른 그룹으로 옮기면 앞 그룹에서 빠진다');
  s = moveWorkspace(s, 'w2', null);
  assert.deepEqual(s.groups[0].members, ['w3'], 'null이면 그룹 없음');
  assert.equal(moveWorkspace(s, 'w2', 'nope').error, 'not_found');
  s = moveGroup(s, 'g2', 0);
  assert.deepEqual(s.groups.map((g) => g.id), ['g2', 'g1']);
  const idx = groupIndex(s);
  assert.deepEqual(idx.get('w3'), { id: 'g1', index: 0 });
  s = dropWorkspaces(s, ['w1']);
  assert.deepEqual(s.groups[0].members, []);
});

test('P44 그룹: 저장된 값을 고친다(겹친 워크스페이스, 판에 없는 키, 깨진 값)', () => {
  const raw = { groups: [{ id: 'g1', name: 'A', members: ['a', 'b', 'a'] }, { id: 'g1', name: 'dup', members: [] }, { id: 'g2', name: 'B', members: ['b', 'c', 'zzz'] }, { id: '', name: 'x' }, null, 'junk'] };
  const s = normalizeGroups(raw, ['a', 'b', 'c']);
  assert.deepEqual(s.groups, [{ id: 'g1', name: 'A', members: ['a', 'b'] }, { id: 'g2', name: 'B', members: ['c'] }]);
  assert.deepEqual(normalizeGroups('nonsense'), { groups: [] });
});

// ---------- 정렬에서 그룹끼리 모으기(순수 함수) ----------
test('P44 영역 배치: 같은 그룹 영역끼리는 다른 그룹 영역보다 가깝고, 그룹 안 순서를 지키며, 겹치지 않는다', () => {
  // 그룹 A(a1~a3)와 B(b1~b3)를 판 위에 엇갈려 흩어 둔다. 그룹 없는 u1, u2도 있다
  const entries = [
    { key: 'a1', ws: 'a1', rect: R(0, 0, 900, 500), group: 'A', order: 2 },
    { key: 'b1', ws: 'b1', rect: R(1200, 0, 800, 600), group: 'B', order: 0 },
    { key: 'a2', ws: 'a2', rect: R(2400, 0, 700, 400), group: 'A', order: 0 },
    { key: 'u1', ws: 'u1', rect: R(3600, 0, 600, 600) },
    { key: 'b2', ws: 'b2', rect: R(0, 3000, 1000, 500), group: 'B', order: 1 },
    { key: 'a3', ws: 'a3', rect: R(1500, 3000, 600, 700), group: 'A', order: 1 },
    { key: 'b3', ws: 'b3', rect: R(3000, 3000, 900, 400), group: 'B', order: 2 },
    { key: 'u2', ws: 'u2', rect: R(5000, 6000, 600, 400) },
  ];
  const { rects, clusters } = layoutRegions(entries);
  const keys = entries.map((e) => e.key);
  // 겹치지 않는다
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) assert.ok(!overlaps(rects.get(keys[i]), rects.get(keys[j]), -1), `${keys[i]}|${keys[j]}`);
  const A = ['a1', 'a2', 'a3'], B = ['b1', 'b2', 'b3'];
  const pairsIn = (g) => g.flatMap((x, i) => g.slice(i + 1).map((y) => [x, y]));
  const avg = (ps) => ps.reduce((s, [x, y]) => s + dist(rects.get(x), rects.get(y)), 0) / ps.length;
  const same = avg([...pairsIn(A), ...pairsIn(B)]);
  const cross = avg(A.flatMap((x) => B.map((y) => [x, y])));
  assert.ok(same < cross, `같은 그룹 평균 거리 ${same.toFixed(0)} < 다른 그룹 ${cross.toFixed(0)}`);
  // 그룹 영역마다 같은 그룹의 가장 가까운 이웃이 다른 그룹 어느 것보다 가깝다
  for (const [g, other] of [[A, B], [B, A]]) for (const x of g) {
    const near = Math.min(...g.filter((y) => y !== x).map((y) => gapOf(rects.get(x), rects.get(y))));
    const far = Math.min(...other.map((y) => gapOf(rects.get(x), rects.get(y))));
    assert.ok(near < far, `${x}: 같은 그룹 ${near} < 다른 그룹 ${far}`);
  }
  // 덩어리 둘, 덩어리 안 순서는 order(a2, a3, a1)
  assert.deepEqual(clusters.map((c) => c.group).sort(), ['A', 'B']);
  assert.deepEqual(clusters.find((c) => c.group === 'A').keys, ['a2', 'a3', 'a1']);
  for (const c of clusters) for (const k of c.keys) { const r = rects.get(k); assert.ok(r.x >= c.rect.x && r.y >= c.rect.y && r.x + r.w <= c.rect.x + c.rect.w && r.y + r.h <= c.rect.y + c.rect.h, `${k}는 덩어리 안`); }
  // 그룹 없는 영역(u1, u2)은 덩어리 밖이다
  for (const k of ['u1', 'u2']) for (const c of clusters) assert.ok(!overlaps(rects.get(k), c.rect, -1));
  // 다시 정리해도 그대로(멱등)
  const again = layoutRegions(entries.map((e) => ({ ...e, rect: rects.get(e.key) })));
  assert.equal(again.shifts.size, 0, '이미 정리된 판은 옮기지 않는다');
});

test('P44 영역 배치: 그룹이 없으면 P31과 같다', () => {
  const entries = [{ key: 'a', ws: 'a', rect: R(0, 0, 1000, 600) }, { key: 'b', ws: 'b', rect: R(9000, 200, 800, 500) }];
  const withNull = layoutRegions(entries.map((e) => ({ ...e, group: null })));
  const plain = layoutRegions(entries);
  assert.deepEqual([...withNull.rects], [...plain.rects]);
  assert.deepEqual(plain.clusters, []);
});

// ---------- 지우기 판단(순수 함수) ----------
test('P44 지우기 판단: 빈 워크스페이스, 세션 있음, 돌고 있는 CLI', () => {
  const ws = [{ key: 'e', name: 'empty', root: 'C:/e' }, { key: 's', name: 'shells', root: 'C:/s' }, { key: 'c', name: 'cli', root: 'C:/c' }];
  const ss = [
    { sessionId: '1', name: 'sh1', kind: 'shell', state: 'shell_idle', workspaceKey: 's' },
    { sessionId: '2', name: 'sh2', kind: 'shell', state: 'shell_running', workspaceKey: 's' },
    { sessionId: '3', name: 'cl1', kind: 'claude', state: 'working', workspaceKey: 'c' },
    { sessionId: '4', name: 'cl2', kind: 'claude', state: 'sleeping', workspaceKey: 'c' },
    { sessionId: '5', name: 'cx', kind: 'codex', state: 'ready', workspaceKey: 'c' },
    { sessionId: '6', name: 'other', kind: 'shell', state: 'shell_running', workspaceKey: 'zzz' },
  ];
  assert.equal(isRunning(ss[0]), false);
  assert.equal(isRunning(ss[1]), true, '셸에서 명령이 돌면 돌고 있다');
  assert.equal(isRunning(ss[2]), true);
  assert.equal(isRunning(ss[3]), false, '잠든 세션은 돌지 않는다');
  assert.equal(isRunning(ss[4]), true, '쉬는 에이전트도 CLI는 떠 있다');
  const only = closePlan([ws[0]], ss);
  assert.deepEqual({ empty: only.empty, needsChoice: only.needsChoice, sessions: only.sessions, running: only.running }, { empty: true, needsChoice: false, sessions: 0, running: 0 });
  assert.deepEqual(checkAfter(only, undefined), { ok: true, after: null }, '빈 것은 고르지 않아도 된다');
  const p = closePlan(ws, ss);
  assert.equal(p.sessions, 5);
  assert.equal(p.running, 3);
  assert.equal(p.needsChoice, true);
  assert.deepEqual(p.items.map((x) => [x.key, x.sessions, x.running, x.asleep]), [['e', 0, 0, 0], ['s', 2, 1, 0], ['c', 3, 2, 1]]);
  assert.deepEqual(checkAfter(p, undefined), { ok: false, reason: 'choose' });
  assert.deepEqual(checkAfter(p, 'burn'), { ok: false, reason: 'bad_after' });
  assert.deepEqual(checkAfter(p, 'archive'), { ok: true, after: 'archive' });
  assert.deepEqual(checkAfter(p, 'delete'), { ok: true, after: 'delete' });
});

// ---------- 판 위에서(가짜 백엔드) ----------
function board() {
  const b = new Backend({ quietMs: 600000, port: 0, logDir: tmp() });
  b.store = new Store(path.join(tmp(), 'board.db'));
  b.sessions = new Map();
  const sent = [];
  b.api = { broadcast: (ev, d) => sent.push([ev, d]) };
  b.log = () => {}; b.touch = () => {};
  const mk = (key, root, x, y) => { b.store.insertWorkspace({ key, kind: 'folder', root, createdAt: 1 }); b.store.setWorkspaceAnchor(key, x, y); };
  const add = (name, wsKey, rect, kind = 'shell') => {
    const s = { sessionId: 'id-' + name, name, kind, workspaceKey: wsKey, cwd: wsKey, rt: newRuntime({ kind, hooked: false }), origin: 'board', createdAt: Date.now() };
    b.sessions.set(s.sessionId, s);
    b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    b.store.setNode({ session_id: s.sessionId, ...rect, z: 0 });
    return s;
  };
  return { b, mk, add, sent };
}

test('P44 판: 그룹 API(만들기·옮기기·이름·지우기)는 판 데이터에 남고, 판 전체 정리가 같은 그룹 영역을 모은다, 되돌리기는 그대로', async () => {
  const { b, mk, add } = board();
  // 영역 여섯: 그룹 A(c:/a1, c:/a2, c:/a3), B(c:/b1, c:/b2), 그룹 없음 c:/u. 엇갈려 흩어 둔다
  const spots = { 'c:/a1': [0, 0], 'c:/b1': [5000, 0], 'c:/a2': [10000, 0], 'c:/b2': [0, 6000], 'c:/a3': [5000, 6000], 'c:/u': [10000, 6000] };
  for (const [k, [x, y]] of Object.entries(spots)) { mk(k, k.toUpperCase(), x, y); add(`s${k.slice(3)}`, k, R(x + 40, y + 112)); }
  const h = b.handlers();
  const g1 = await h['group.create']({ name: 'A', workspaces: ['c:/a1', 'c:/a2'] });
  assert.equal(g1.created, 'g1');
  const g2 = await h['group.create']({ name: 'B' });
  await h['group.move']({ workspace: 'c:/b1', group: g2.created });
  await h['group.move']({ workspace: 'c:/b2', group: g2.created });
  await h['group.move']({ workspace: 'c:/a3', group: 'g1', index: 0 });
  await h['group.rename']({ group: 'g2', name: 'Backend' });
  await assert.rejects(() => h['group.create']({ name: 'a' }), (e) => e.code === 'conflict');
  await assert.rejects(() => h['group.move']({ workspace: 'c:/u', group: 'nope' }), (e) => e.code === 'not_found');
  const saved = b.store.getMeta(GROUPS_META);
  assert.deepEqual(saved.groups.map((g) => [g.id, g.name, g.members]), [['g1', 'A', ['c:/a3', 'c:/a1', 'c:/a2']], ['g2', 'Backend', ['c:/b1', 'c:/b2']]], '판 데이터(meta)에 남는다');
  assert.deepEqual(h['workspace.list']().groups, saved.groups, '워크스페이스 목록에 그룹이 함께 온다');
  // 정리
  const before = JSON.stringify(b.store.nodes().map((n) => [n.session_id, n.x, n.y]));
  const r = ops.arrange(b, { all: true, apply: true });
  assert.deepEqual(r.clusters.map((c) => c.group).sort(), ['g1', 'g2']);
  const regs = ops.regions(b);
  const A = ['c:/a1', 'c:/a2', 'c:/a3'], B = ['c:/b1', 'c:/b2'];
  for (const [g, other] of [[A, B], [B, A]]) for (const x of g) {
    const near = Math.min(...g.filter((y) => y !== x).map((y) => gapOf(regs.get(x), regs.get(y))));
    const far = Math.min(...other.map((y) => gapOf(regs.get(x), regs.get(y))), gapOf(regs.get(x), regs.get('c:/u')));
    assert.ok(near < far, `${x}: 같은 그룹 ${near} < 다른 것 ${far}`);
  }
  assert.deepEqual(ops.settleRegions(b, 'check'), [], '겹침 풀기가 더 할 일이 없다');
  ops.arrange(b, { all: true, undo: true });
  assert.equal(JSON.stringify(b.store.nodes().map((n) => [n.session_id, n.x, n.y])), before, '되돌리면 정리 전 그대로');
  // 그룹 지우기: 워크스페이스는 그룹 없음
  await h['group.remove']({ group: 'g1' });
  assert.deepEqual(b.store.getMeta(GROUPS_META).groups.map((g) => g.id), ['g2']);
});

test('P44 판: workspace.close는 여럿을 한 번에, 세션이 있으면 고르게 하고, 보관·삭제가 고른 대로, 폴더와 대화 기록은 그대로', async () => {
  const { b, mk, add } = board();
  const dirs = ['x', 'y', 'z'].map((n) => { const d = path.join(tmp(), n); fs.mkdirSync(d); return d; });
  const keys = ['c:/x', 'c:/y', 'c:/z'];
  keys.forEach((k, i) => mk(k, dirs[i], i * 4000, 0));
  add('x1', 'c:/x', R(40, 112)); add('x2', 'c:/x', R(600, 112));
  add('y1', 'c:/y', R(4040, 112), 'claude');
  b.sessions.get('id-y1').rt.herdr = { ...(b.sessions.get('id-y1').rt.herdr || {}), present: true, status: 'working' };
  b.sessions.get('id-x2').rt.shell = { atPrompt: false, command: 'npm test', procs: ['node'] };
  // 끄기와 보관은 가짜로: 끄면 판 세션에서 빼고 닫힌 행을 만든다
  const killed = [];
  const archived = [];
  b.recall = { markArchive: (p) => archived.push(p.session), changed: async () => {} };
  b.kill = async (p) => {
    const s = b.sessions.get(p.session);
    killed.push([s.name, p.after || null]);
    b.sessions.delete(s.sessionId);
    b.store.closeSession ? b.store.closeSession(s.sessionId, 'killed') : b.store.updateSession(s.sessionId, { closedAt: Date.now() });
    if (p.after === 'archive') b.recall.markArchive({ session: s.sessionId });
    return { closed: true };
  };
  b.store.setMeta(GROUPS_META, { groups: [{ id: 'g1', name: 'G', members: ['c:/x', 'c:/z'] }] });
  const h = b.handlers();
  // 확인 전: 수와 돌고 있는 CLI
  const ask = await h['workspace.close']({ workspaces: ['c:/x', 'c:/y'] });
  assert.equal(ask.needsConfirm, true);
  assert.equal(ask.plan.sessions, 3);
  assert.equal(ask.plan.running, 2, '명령이 도는 셸과 일하는 claude');
  assert.equal(ask.msg.key, 'wsCloseSessions');
  // 고르지 않으면 거부(not_empty → 고르기)
  await assert.rejects(() => h['workspace.close']({ workspaces: ['c:/x', 'c:/y'], confirm: true }), (e) => e.code === 'not_empty' && e.key === 'wsChooseAfter');
  await assert.rejects(() => h['workspace.close']({ workspaces: ['c:/x', 'c:/y'], confirm: true, after: 'burn' }), (e) => e.code === 'bad_request');
  // 모두 보관
  const r = await h['workspace.close']({ workspaces: ['c:/x', 'c:/y'], confirm: true, after: 'archive' });
  assert.equal(r.closed, true);
  assert.deepEqual(r.removed.sort(), ['c:/x', 'c:/y']);
  assert.deepEqual(killed.map((k) => k[1]), ['archive', 'archive', 'archive']);
  assert.deepEqual(archived.sort(), ['id-x1', 'id-x2', 'id-y1']);
  assert.equal(r.sessions.archived, 3);
  assert.deepEqual(b.store.workspaces().map((w) => w.key), ['c:/z']);
  assert.deepEqual(b.store.getMeta(GROUPS_META).groups[0].members, ['c:/z'], '지운 워크스페이스는 그룹에서도 빠진다');
  for (const d of dirs) assert.ok(fs.existsSync(d), '폴더는 디스크에 그대로');
  assert.ok(b.store.events({ limit: 50 }).some((e) => e.kind === 'workspace_closed'), '사람이 지운 기록(P10: 다시 저절로 열지 않는다)')
  // 모두 삭제: 닫힌 행을 판에서 지운다(대화 기록 파일은 건드리지 않는다)
  add('z1', 'c:/z', R(8040, 112));
  const transcript = path.join(dirs[2], 'fake.jsonl'); fs.writeFileSync(transcript, '{}\n');
  const d = await h['workspace.close']({ workspace: 'c:/z', confirm: true, after: 'delete' });
  assert.equal(d.closed, true);
  assert.equal(d.sessions.deleted, 1);
  assert.equal(b.store.closedSession('id-z1'), null, '닫힌 세션 행이 없다');
  assert.ok(fs.existsSync(transcript), '대화 기록 같은 파일은 그대로');
  assert.equal(b.store.workspaces().length, 0);
});

test('P44 판: 빈 워크스페이스 하나는 예전 문구로 묻고 고르지 않고 지운다, 끄지 못한 세션이 있으면 그 워크스페이스는 남긴다', async () => {
  const { b, mk, add } = board();
  mk('c:/e', 'C:/e', 0, 0);
  mk('c:/f', 'C:/f', 4000, 0);
  add('f1', 'c:/f', R(4040, 112));
  b.recall = { markArchive: () => {}, changed: async () => {} };
  b.kill = async () => { throw Object.assign(new Error('herdr down'), { code: 'herdr_down' }); };
  const h = b.handlers();
  const ask = await h['workspace.close']({ workspace: 'c:/e' });
  assert.equal(ask.msg.key, 'wsClose');
  assert.equal((await h['workspace.close']({ workspace: 'c:/e', confirm: true })).closed, true);
  const r = await h['workspace.close']({ workspace: 'c:/f', confirm: true, after: 'archive' });
  assert.equal(r.closed, false);
  assert.deepEqual(r.kept, ['c:/f']);
  assert.equal(r.sessions.failed.length, 1);
  assert.deepEqual(b.store.workspaces().map((w) => w.key), ['c:/f']);
});
