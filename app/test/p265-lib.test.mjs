// P265 사이드바: 접힌 그룹·워크스페이스 아래에 실행 중(작업 중)인 세션도 줄로 남는다
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, ATTN_CAP, isPinnable } from '../src/renderer/lib/sidebar-tree.js';

const WS = (key, name = key) => ({ key, name, kind: 'folder', root: `C:/${name}` });
let seq = 0;
const S = (name, ws, state = 'idle', extra = {}) => ({ sessionId: `id-${name}`, name, kind: 'claude', state, workspaceKey: ws, lastActivityAt: 1000 + seq++, ...extra });
const ids = (rows) => rows.map((r) => r.id);
const sess = (rows) => rows.filter((r) => r.type === 'session');

test('P265: 접힌 워크스페이스 아래에는 작업 중·응답 필요만, 쉬는·잠든·끝난 세션은 없다', () => {
  const sessions = [S('idle1', 'a'), S('work1', 'a', 'working'), S('need1', 'a', 'waiting'), S('sleep1', 'a', 'sleeping'), S('done1', 'a', 'exited', { exitReason: 'user' }), S('sh1', 'a', 'shell_running', { kind: 'shell' })];
  const { rows } = buildRows({ workspaces: [WS('a')], sessions, collapsed: { a: true } });
  assert.equal(rows[0].id, 'w:a');
  assert.deepEqual(ids(sess(rows)).slice(0, 1), ['s:id-need1'], '응답 필요가 먼저');
  assert.deepEqual(ids(sess(rows)).sort(), ['s:id-need1', 's:id-sh1', 's:id-work1']);
  assert.ok(sess(rows).every((r) => r.pinned));
  assert.equal(rows.find((r) => r.id === 's:id-work1').attn, false);
  assert.equal(rows.find((r) => r.id === 's:id-work1').wsName, undefined, '워크스페이스 하나면 이름을 붙이지 않는다');
  assert.ok(isPinnable({ state: 'starting' }));
  assert.ok(!isPinnable({ state: 'idle' }) && !isPinnable({ state: 'sleeping' }) && !isPinnable({ state: 'shell_idle' }));
});

test('P265: 펼친 상태는 그대로(모든 세션, pinned 없음)', () => {
  const sessions = [S('i', 'a'), S('w', 'a', 'working'), S('z', 'a', 'sleeping')];
  const { rows } = buildRows({ workspaces: [WS('a')], sessions });
  assert.equal(sess(rows).length, 3);
  assert.ok(sess(rows).every((r) => !r.pinned && !r.wsName));
});

test('P265: 실행 중이 없으면 접힌 머리 아래에 아무 줄도 없다', () => {
  const workspaces = [WS('a'), WS('b')];
  const groups = [{ id: 'g1', name: 'G', members: ['a', 'b'] }];
  const sessions = [S('i1', 'a'), S('i2', 'b', 'sleeping')];
  assert.deepEqual(ids(buildRows({ workspaces, groups, sessions, collapsed: { 'g:g1': true } }).rows), ['g:g1']);
  assert.deepEqual(ids(buildRows({ workspaces, groups: [], sessions, collapsed: { a: true, b: true } }).rows), ['w:a', 'w:b']);
});

test('P265: 접힌 그룹에 워크스페이스가 여럿이면 세션 줄에 워크스페이스 이름, 안의 접힌 워크스페이스가 있어도 한 번만', () => {
  const workspaces = [WS('a', 'alpha'), WS('b', 'beta'), WS('c', 'gamma')];
  const groups = [{ id: 'g1', name: 'G', members: ['a', 'b'] }, { id: 'g2', name: 'H', members: ['c'] }];
  const sessions = [S('wa', 'a', 'working'), S('nb', 'b', 'waiting'), S('ib', 'b'), S('wc', 'c', 'working')];
  const { rows } = buildRows({ workspaces, groups, sessions, collapsed: { 'g:g1': true, a: true, 'g:g2': true } });
  assert.deepEqual(ids(rows), ['g:g1', 's:id-nb', 's:id-wa', 'g:g2', 's:id-wc']);
  assert.equal(rows.find((r) => r.id === 's:id-wa').wsName, 'alpha');
  assert.equal(rows.find((r) => r.id === 's:id-nb').wsName, 'beta');
  assert.equal(rows.find((r) => r.id === 's:id-wc').wsName, undefined, '워크스페이스 하나인 그룹은 이름 없이');
  assert.equal(rows.find((r) => r.id === 's:id-wa').depth, 1);
});

test('P265: 많으면 n개 더(실행 중이 섞이면 running), 거르기는 접힘을 무시한다', () => {
  const many = Array.from({ length: ATTN_CAP + 2 }, (_, i) => S(`w${i}`, 'b', 'working'));
  const r = buildRows({ workspaces: [WS('b')], sessions: many, collapsed: { b: true } }).rows;
  assert.equal(sess(r).length, ATTN_CAP);
  const more = r.find((x) => x.type === 'more');
  assert.equal(more.n, 2);
  assert.equal(more.running, true);
  const st = buildRows({ workspaces: [WS('b')], sessions: [S('x', 'b', 'working'), S('y', 'b')], collapsed: { b: true }, states: new Set(['idle']) }).rows;
  assert.deepEqual(ids(st), ['w:b', 's:id-y'], '상태 거르기 중에는 접힘을 무시하고 맞는 것만(고정 줄 없음)');
  assert.ok(sess(st).every((x) => !x.pinned));
});
