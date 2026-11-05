// P44 사이드바 순수 함수: 그룹 → 워크스페이스 → 세션 줄 펴기, 접힌 묶음의 응답 필요·오류, 거르기, 가상 스크롤 창, 키보드 이동, 끌어 놓기 자리, 폭.
// 세션 200개 이상도 빠르게 편다(성능 시험)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, offsetsOf, windowOf, scrollFor, moveCursor, parentOf, dropTarget, adjustIndex, freshGroupName, clampWidth, SIDE_W, ROW_H, ATTN_CAP, bucketOf, groupLayout } from '../src/renderer/lib/sidebar-tree.js';

const WS = (key, name = key) => ({ key, name, kind: 'folder', root: `C:/${name}` });
let seq = 0;
const S = (name, ws, state = 'shell_idle', extra = {}) => ({ sessionId: `id-${name}`, name, kind: 'shell', state, workspaceKey: ws, lastActivityAt: 1000 + seq++, ...extra });
const types = (rows) => rows.map((r) => r.type);
const ids = (rows) => rows.map((r) => r.id);

test('P44 사이드바: 그룹(사람이 정한 순서) → 그룹 없음 → 워크스페이스 → 세션, 응답 필요·오류는 위에 두 줄 높이', () => {
  const workspaces = [WS('a'), WS('b'), WS('c')];
  const groups = [{ id: 'g1', name: 'G', members: ['c', 'a'] }];
  const sessions = [S('a1', 'a'), S('a2', 'a', 'waiting'), S('b1', 'b', 'error'), S('c1', 'c', 'working')];
  const { rows, counts } = buildRows({ workspaces, groups, sessions });
  assert.deepEqual(ids(rows), ['g:g1', 'w:c', 's:id-c1', 'w:a', 's:id-a2', 's:id-a1', 'g:', 'w:b', 's:id-b1']);
  assert.equal(rows.find((r) => r.id === 's:id-a2').h, ROW_H.attn, '응답 필요 줄은 질문 한 줄을 더 보인다');
  assert.equal(rows.find((r) => r.id === 's:id-a1').h, ROW_H.session);
  assert.deepEqual({ need: counts.need, error: counts.error, working: counts.working, sessions: counts.sessions }, { need: 1, error: 1, working: 1, sessions: 4 });
  assert.equal(rows.find((r) => r.id === 'g:').none, true, '그룹이 있으면 나머지는 "그룹 없음" 아래');
  // 그룹이 없으면 그룹 머리줄 없이 워크스페이스부터
  assert.deepEqual(types(buildRows({ workspaces, groups: [], sessions }).rows).slice(0, 2), ['ws', 'session']);
});

test('P44 사이드바: 접힌 그룹·워크스페이스 아래에도 응답 필요·오류 세션은 남는다(많으면 n개 더)', () => {
  const workspaces = [WS('a'), WS('b')];
  const groups = [{ id: 'g1', name: 'G', members: ['a'] }];
  const sessions = [S('a1', 'a'), S('a2', 'a', 'waiting'), S('b1', 'b'), S('b2', 'b', 'error'), S('b3', 'b', 'trust_wait')];
  const { rows } = buildRows({ workspaces, groups, sessions, collapsed: { 'g:g1': true, b: true } });
  assert.deepEqual(ids(rows), ['g:g1', 's:id-a2', 'g:', 'w:b', 's:id-b3', 's:id-b2']);
  assert.ok(rows.filter((r) => r.type === 'session').every((r) => r.pinned && r.attn));
  const many = Array.from({ length: ATTN_CAP + 3 }, (_, i) => S(`n${i}`, 'b', 'waiting'));
  const r2 = buildRows({ workspaces: [WS('b')], sessions: many, collapsed: { b: true } }).rows;
  assert.equal(r2.filter((r) => r.type === 'session').length, ATTN_CAP);
  const more = r2.find((r) => r.type === 'more');
  assert.equal(more.n, 3);
  assert.equal(more.key, 'pin:b');
});

test('P44 사이드바: 거르기(글, 상태 묶음, 종류)는 접힘을 무시하고 맞는 것만, 맞는 것이 없는 묶음은 뺀다', () => {
  const workspaces = [WS('a'), WS('b')];
  const groups = [{ id: 'g1', name: 'G', members: ['a'] }];
  const sessions = [S('alpha', 'a'), S('beta', 'a', 'waiting'), S('gamma', 'b', 'working', { kind: 'claude', lastPrompt: 'fix the build' }), S('delta', 'b', 'shell_running')];
  const st = buildRows({ workspaces, groups, sessions, collapsed: { 'g:g1': true, a: true }, states: new Set(['need']) });
  assert.equal(st.filtering, true);
  assert.deepEqual(ids(st.rows), ['g:g1', 'w:a', 's:id-beta']);
  const txt = buildRows({ workspaces, groups, sessions, filter: 'build' });
  assert.deepEqual(ids(txt.rows), ['g:', 'w:b', 's:id-gamma'], '마지막 요청으로도 찾는다');
  const kind = buildRows({ workspaces, groups, sessions, kind: 'claude' });
  assert.deepEqual(ids(kind.rows), ['g:', 'w:b', 's:id-gamma']);
  assert.deepEqual(kind.kinds, ['claude', 'shell']);
  const work = buildRows({ workspaces, groups, sessions, states: new Set(['working']) });
  assert.deepEqual(ids(work.rows).filter((x) => x.startsWith('s:')).sort(), ['s:id-delta', 's:id-gamma'], '명령이 도는 셸도 작업 중');
  assert.equal(buildRows({ workspaces, groups, sessions, filter: 'zzz' }).rows.length, 0);
  assert.equal(bucketOf({ state: 'sleeping' }), 'sleeping');
});

test('P44 사이드바: 닫힌 세션과 판 밖 대화는 워크스페이스마다 한 줄로 접혀 있고, 펼치면 SECTION_STEP씩, 글로 거르면 함께 찾는다', () => {
  const closed = Array.from({ length: 8 }, (_, i) => ({ sessionId: `c${i}`, name: `old${i}`, kind: 'shell', closedAt: 100 + i }));
  const convos = [{ convId: '11111111-1111-1111-1111-111111111111', title: 'refactor parser', lastAt: 50 }];
  const data = { workspaces: [{ key: 'a', closed, convos, archived: 2 }] };
  const base = { workspaces: [WS('a')], sessions: [S('a1', 'a')], data };
  const folded = buildRows(base).rows;
  assert.deepEqual(types(folded), ['ws', 'session', 'extra']);
  const x = folded.find((r) => r.type === 'extra');
  assert.deepEqual([x.closedN, x.convosN, x.open], [8, 1, false]);
  const open = buildRows({ ...base, extra: { a: true } }).rows;
  assert.deepEqual(types(open), ['ws', 'session', 'extra', 'sec', 'closed', 'closed', 'closed', 'closed', 'closed', 'more', 'sec', 'convo']);
  assert.equal(open.find((r) => r.type === 'more').n, 3);
  const more = buildRows({ ...base, extra: { a: true }, more: { 'a|closed': 5 } }).rows;
  assert.equal(more.filter((r) => r.type === 'closed').length, 8);
  const find = buildRows({ ...base, filter: 'parser' }).rows;
  assert.deepEqual(types(find), ['ws', 'extra', 'sec', 'convo'], '글로 거르면 닫힘·대화도 펼쳐 찾는다');
  // 상태 칩은 판 세션만
  assert.deepEqual(types(buildRows({ ...base, states: new Set(['idle']) }).rows), ['ws', 'session']);
});

test('P44 사이드바: 가상 스크롤 창과 고른 줄이 보이게 하는 자리', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, type: 'session', h: i % 10 === 0 ? 44 : 28 }));
  const off = offsetsOf(rows);
  assert.equal(off[0], 0);
  assert.equal(off[1], 44);
  const total = off[1000];
  assert.equal(total, 100 * 44 + 900 * 28);
  const w = windowOf(off, 5000, 600, 4);
  assert.ok(off[w.start + 4] <= 5000 && off[w.start + 5] > 5000, '창 시작은 scrollTop이 든 줄(앞에 overscan)');
  assert.ok(off[w.end - 4] >= 5600 - 44);
  assert.ok(w.end - w.start < 40, `그리는 줄이 적다(${w.end - w.start})`);
  assert.deepEqual(windowOf(offsetsOf([]), 0, 600), { start: 0, end: 0, total: 0 });
  assert.equal(scrollFor(off, 0, 5000, 600), 0, '위에 있으면 그 줄 위로');
  assert.equal(scrollFor(off, 500, 0, 600), off[501] - 600, '아래에 있으면 그 줄 아래가 화면 끝');
  assert.equal(scrollFor(off, w.start + 6, 5000, 600), 5000, '이미 보이면 그대로');
});

test('P44 사이드바: 키보드 이동은 고를 수 있는 줄만 밟고, ←는 위 머리줄로', () => {
  const workspaces = [WS('a'), WS('b')];
  const groups = [{ id: 'g1', name: 'G', members: ['a'] }];
  const data = { workspaces: [{ key: 'b', closed: [{ sessionId: 'c0', name: 'old', closedAt: 1 }], convos: [] }] };
  const { rows } = buildRows({ workspaces, groups, sessions: [S('a1', 'a'), S('b1', 'b')], data, extra: { b: true } });
  // g:g1, w:a, s:a1, g:, w:b, s:b1, extra, sec, closed
  assert.equal(moveCursor(rows, null, 1), 'g:g1');
  assert.equal(moveCursor(rows, 's:id-b1', 1), 'x:b');
  assert.equal(moveCursor(rows, 'x:b', 1), 'c:c0', '절 이름(sec)은 건너뛴다');
  assert.equal(moveCursor(rows, 'c:c0', 1), 'c:c0', '끝에서 멈춘다');
  assert.equal(moveCursor(rows, 'g:g1', -1), 'g:g1');
  assert.equal(moveCursor(rows, 'g:g1', 3), 'g:');
  assert.equal(moveCursor(rows, 'w:b', 'home'), 'g:g1');
  assert.equal(moveCursor(rows, 'w:b', 'end'), 'c:c0');
  assert.equal(moveCursor(rows, 'gone', -1), 'c:c0');
  assert.equal(parentOf(rows, 's:id-a1'), 'w:a');
  assert.equal(parentOf(rows, 'w:a'), 'g:g1');
  assert.equal(parentOf(rows, 'g:g1'), null);
});

test('P44 사이드바: 끌어 놓기 자리(그룹 끝, 워크스페이스 앞·뒤, 그룹 없음)와 같은 그룹 안 아래로 옮기기', () => {
  const groups = [{ id: 'g1', name: 'G', members: ['a', 'b', 'c'] }, { id: 'g2', name: 'H', members: [] }];
  assert.deepEqual(dropTarget(groups, { type: 'group', groupId: 'g2' }), { group: 'g2', index: null });
  assert.deepEqual(dropTarget(groups, { type: 'group', groupId: null }), { group: null, index: null });
  assert.deepEqual(dropTarget(groups, { type: 'ws', wsKey: 'b' }), { group: 'g1', index: 1 });
  assert.deepEqual(dropTarget(groups, { type: 'ws', wsKey: 'b' }, { after: true }), { group: 'g1', index: 2 });
  assert.deepEqual(dropTarget(groups, { type: 'ws', wsKey: 'zzz' }), { group: null, index: null }, '그룹 없는 워크스페이스 위면 그룹 없음');
  assert.deepEqual(adjustIndex(groups, 'a', { group: 'g1', index: 2 }), { group: 'g1', index: 1 }, 'a를 b 뒤로: 빼고 나면 자리 1');
  assert.deepEqual(adjustIndex(groups, 'c', { group: 'g1', index: 0 }), { group: 'g1', index: 0 });
  assert.deepEqual(adjustIndex(groups, 'x', { group: 'g1', index: 2 }), { group: 'g1', index: 2 });
  assert.deepEqual(groupLayout([WS('a'), WS('z')], groups).ungrouped.map((w) => w.key), ['z']);
});

test('P44 사이드바: 새 그룹 이름과 폭(최소·최대·기본)', () => {
  assert.equal(freshGroupName([], 'New group'), 'New group');
  assert.equal(freshGroupName([{ name: 'new group' }, { name: 'New group 2' }], 'New group'), 'New group 3');
  assert.equal(clampWidth(100), SIDE_W.min);
  assert.equal(clampWidth(5000), SIDE_W.max);
  assert.equal(clampWidth(400.4), 400);
  assert.equal(clampWidth('x'), SIDE_W.def);
  assert.equal(clampWidth(undefined), SIDE_W.def);
});

test('P44 사이드바 성능: 워크스페이스 30개·세션 1,000개를 펴고 창을 구하는 데 오래 걸리지 않는다', () => {
  const workspaces = Array.from({ length: 30 }, (_, i) => WS(`w${i}`));
  const groups = [{ id: 'g1', name: 'A', members: workspaces.slice(0, 10).map((w) => w.key) }, { id: 'g2', name: 'B', members: workspaces.slice(10, 20).map((w) => w.key) }];
  const states = ['shell_idle', 'working', 'waiting', 'ready', 'error', 'sleeping', 'shell_running'];
  const sessions = Array.from({ length: 1000 }, (_, i) => S(`s${i}`, `w${i % 30}`, states[i % states.length], { lastPrompt: `prompt ${i}` }));
  const t0 = performance.now();
  let rows;
  for (let k = 0; k < 20; k++) rows = buildRows({ workspaces, groups, sessions, collapsed: k % 2 ? {} : { 'g:g1': true } }).rows;
  const per = (performance.now() - t0) / 20;
  assert.ok(rows.length > 1000);
  assert.ok(per < 50, `한 번 펴기 ${per.toFixed(1)}ms`);
  const off = offsetsOf(rows);
  const t1 = performance.now();
  for (let k = 0; k < 1000; k++) windowOf(off, (k * 97) % off[off.length - 1], 800);
  assert.ok((performance.now() - t1) / 1000 < 1, '창 구하기는 1ms 미만');
  const w = windowOf(off, 20000, 800);
  assert.ok(w.end - w.start < 50, '200개 넘어도 그리는 줄은 화면 높이만큼');
  // 200개, 거르기
  const t2 = performance.now();
  const f = buildRows({ workspaces, groups, sessions: sessions.slice(0, 200), filter: 'prompt 1', states: new Set(['need', 'working']) });
  assert.ok(performance.now() - t2 < 50);
  assert.ok(f.rows.some((r) => r.type === 'session'));
});
