// P77 단위 시험(P80에서 기대값을 새 규칙으로 고쳤다): 덩어리의 크기 막대(방향·비율·단계)는 틀 비율을 지키고 바깥만 정한다.
// 바깥은 같은 값의 단독 세션 넓이 × √n이고 칸이 고른 모양에 가장 가깝다(dock-tree.mjs dockFit). canvas-ops.mjs(board.setSize, dock.attach·remove·layout·update).
// herdr와 claude 없이 돈다. 틀마다 모양과 넓이 규칙은 p80.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fitsAspect } from '../src/canvas.mjs';
import { presetTree, dragOuter } from '../src/dock-tree.mjs';
import { newRuntime } from '../src/state.mjs';
import { Store } from '../src/store.mjs';
import * as ops from '../src/canvas-ops.mjs';

const R = (x, y, w = 1440, h = 810) => ({ x, y, w, h });
const area = (r) => r.w * r.h;
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

function fakeBackend(file = null) {
  const dbFile = file || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p77-')), 'board.db');
  const store = new Store(dbFile);
  const sessions = new Map();
  const b = { store, sessions, events: [], api: { broadcast: () => {} }, log: () => {}, nameOf: (sid) => (sessions.get(sid) || { name: sid }).name };
  b.resolve = (ref) => { const s = sessions.get(ref) || [...sessions.values()].find((x) => x.name === ref); if (!s) throw Object.assign(new Error(`없는 세션: ${ref}`), { code: 'not_found' }); return s; };
  if (!file) store.insertWorkspace({ key: 'ws', kind: 'folder', root: 'C:/ws', createdAt: 1 });
  const add = (name, rect, extra = {}) => {
    const s = { sessionId: `id-${name}`, name, kind: 'shell', workspaceKey: 'ws', cwd: 'C:/ws', rt: newRuntime({ kind: 'shell', hooked: false }), origin: 'board', createdAt: 1 };
    sessions.set(s.sessionId, s);
    if (!file) { store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt }); store.setNode({ session_id: s.sessionId, ...rect, z: 0, ...extra }); }
  };
  const node = (name) => store.nodes().find((x) => x.session_id === `id-${name}`);
  const at = (name) => { const n = node(name); return n && R(n.x, n.y, n.w, n.h); };
  const outer = (name) => ops.dockOuter(b, ops.dockOf(b, `id-${name}`));
  const st = (name) => ops.dockState(b, ops.dockOf(b, `id-${name}`));
  return { b, add, at, node, outer, st, store, file: dbFile };
}
const four = (env) => { for (const [i, n] of ['a', 'b', 'c', 'd'].entries()) env.add(n, R(i * 2000, 0)); return ['a', 'b', 'c', 'd']; };
const lit = (s) => [s.dir, s.aspect, s.level];

test('API: H 넷 가로형 16:9 크게, V 넷 세로형 4:3 보통, 2 × 2 가로형 16:9 보통(틀 비율 그대로, 바깥만)', () => {
  const env = fakeBackend();
  const { b, at, outer, st } = env;
  const ids = four(env);
  const { dock } = ops.dockLayout(b, { members: ids, preset: 'row' });
  assert.deepEqual([outer('a').w, outer('a').h], [4073, 573], '새 덩어리: 새 세션(16:9 보통) 넓이 × √4, 칸 16:9');
  assert.deepEqual(lit(st('a')), ['wide', '16:9', 'normal']);
  const o0 = outer('a');
  const r = ops.setSize(b, { session: 'b', dir: 'wide', aspect: '16:9', level: 'large', scope: 'dock' });
  assert.deepEqual([r.w, r.h, r.outer.w, r.outer.h, r.level], [1920, 1080, 5431, 764, 'large'], '단독 1920×1080 → 바깥 5431×764');
  for (const n of ids) assert.ok(near(at(n).w, 1358) && at(n).h === 764, `${n} ${at(n).w}×${at(n).h}`);
  assert.deepEqual([outer('a').x, outer('a').y], [o0.x, o0.y], '왼쪽 위 그대로');
  assert.deepEqual(lit(st('a')), ['wide', '16:9', 'large'], '막대 불: 가로형·16:9·크게');
  // V 넷 세로형 4:3 보통: 칸 3:4
  ops.dockLayout(b, { members: ['a'], preset: 'col' });
  ops.setSize(b, { session: 'a', dir: 'tall', aspect: '4:3', level: 'normal', scope: 'dock' });
  assert.deepEqual([outer('a').w, outer('a').h], [636, 3394]);
  for (const n of ids) assert.ok(at(n).w === 636 && near(at(n).h, 849), `${n} ${at(n).w}×${at(n).h}`);
  assert.deepEqual(lit(st('a')), ['tall', '4:3', 'normal']);
  // 2 × 2 가로형 16:9 보통
  ops.dockLayout(b, { members: ['a'], preset: 'grid' });
  ops.setSize(b, { session: 'a', size: 'wide-normal', scope: 'dock' });
  assert.deepEqual([outer('a').w, outer('a').h], [2036, 1146]);
  for (const n of ids) assert.ok(near(at(n).w, 1018) && near(at(n).h, 573), `${n} ${at(n).w}×${at(n).h}`);
  assert.equal(ops.dockOf(b, 'id-a').dockId, dock.dockId);
  env.store.close();
});

test('API: 고르지 않은 틀로 바꾸면 틀 비율 그대로, 같은 단독 세션 크기로 바깥을 다시 낸다', () => {
  const env = fakeBackend();
  const { b, at, outer, st } = env;
  const ids = four(env);
  ops.dockLayout(b, { members: ids, preset: 'grid' });
  ops.setSize(b, { session: 'a', size: 'wide-normal', scope: 'dock' });
  ops.dockLayout(b, { members: ['a'], preset: 'main-left-3' });
  assert.deepEqual(ops.dockOf(b, 'id-a').tree.ratios, [0.5, 0.5], '1 + 3 틀 비율(반반) 그대로');
  assert.deepEqual([outer('a').w, outer('a').h], [2188, 1066]);
  assert.deepEqual([at('a').w, at('a').h], [1094, 1066], '큰 칸');
  assert.ok(at('b').w === 1094 && near(at('b').h, 355), '작은 칸');
  assert.deepEqual(lit(st('a')), ['wide', '16:9', 'normal'], '불은 그대로');
  env.store.close();
});

test('API: 바깥 테두리로 바꾸면 칸이 함께 커지고 비율·단계 불이 꺼진다. 그 뒤 붙이기·떼기는 P73처럼', () => {
  const env = fakeBackend();
  const { b, at, outer, st, add } = env;
  const ids = four(env);
  const { dock } = ops.dockLayout(b, { members: ids, preset: 'row' });
  ops.setSize(b, { session: 'a', size: 'wide-normal', scope: 'dock' });
  const o = outer('a');
  const tree = JSON.stringify(ops.dockOf(b, 'id-a').tree);
  const g = dragOuter(ops.dockOf(b, 'id-a').tree, o, 'bottom', 200);
  ops.dockUpdate(b, { dock: dock.dockId, ...g });
  assert.deepEqual([at('a').w, at('a').h], [1018, 773], '칸이 함께 커진다');
  assert.deepEqual([st('a').aspect, st('a').level], [null, null], '비율·단계 꺼짐');
  assert.equal(JSON.stringify(ops.dockOf(b, 'id-a').tree), tree, '틀 비율 그대로');
  // 꺼진 덩어리에 붙이기: P73처럼 붙는 노드 너비만큼 바깥이 는다
  add('e', R(0, 6000, 1040, 585));
  ops.dockAttach(b, { session: 'e', to: 'd', side: 'right', at: 'dock' });
  assert.deepEqual([outer('a').w, outer('a').h, at('e').w], [o.w + 1040, 773, 1040]);
  assert.deepEqual([at('a').w, at('a').h], [1018, 773], '다른 칸 그대로');
  env.store.close();
});

test('API: 불이 든 덩어리에 붙이기·떼기는 같은 단독 세션 크기로 바깥을 다시 낸다(넓이 × √n)', () => {
  const env = fakeBackend();
  const { b, at, outer, st, add } = env;
  add('a', R(0, 0)); add('b', R(2000, 0)); add('c', R(4000, 0));
  ops.dockLayout(b, { members: ['a', 'b', 'c'], preset: 'row' });
  ops.setSize(b, { session: 'a', size: 'wide-large', scope: 'dock' });
  const o = outer('a');
  assert.deepEqual([o.w, o.h], [4377, 821], 'H 셋 크게');
  // 오른쪽에 붙이기(붙는 노드는 작게): 새 칸은 줄의 칸 하나만큼, H 넷 크게
  add('d', R(0, 4000, 1040, 585));
  ops.dockAttach(b, { session: 'd', to: 'c', side: 'right', at: 'dock' });
  assert.deepEqual([outer('a').x, outer('a').y, outer('a').w, outer('a').h], [o.x, o.y, 5431, 764]);
  for (const n of ['a', 'b', 'c', 'd']) assert.ok(near(at(n).w, 1358) && at(n).h === 764, `${n} ${at(n).w}`);
  assert.deepEqual(lit(st('a')), ['wide', '16:9', 'large']);
  // 왼쪽에 붙이기: 오른쪽 변이 그대로, H 다섯
  add('e', R(0, 6000));
  ops.dockAttach(b, { session: 'e', to: 'a', side: 'left', at: 'dock' });
  assert.deepEqual([outer('a').x + outer('a').w, outer('a').w, outer('a').h], [o.x + 5431, 6420, 722]);
  // 칸 하나를 반으로(아래): 틀 비율은 붙인 대로(b·e 반반), 넓이 × √5, 불 그대로
  ops.dockAttach(b, { session: 'e', to: 'b', side: 'bottom', at: 'leaf' });
  assert.ok(at('b').w === at('e').w && near(at('b').h, at('e').h) && near(at('a').w, at('b').w), JSON.stringify([at('a'), at('b'), at('e')]));
  assert.ok(Math.abs(area(outer('a')) / (1920 * 1080 * Math.sqrt(5)) - 1) < 0.01);
  assert.deepEqual(lit(st('a')), ['wide', '16:9', 'large']);
  // 떼기: 바깥이 준다(왼쪽 위 그대로)
  const before = outer('a');
  ops.dockRemove(b, { session: 'e' });
  assert.deepEqual([outer('a').x, outer('a').y, outer('a').w, outer('a').h], [before.x, before.y, 5431, 764]);
  ops.dockRemove(b, { session: 'd' });
  assert.deepEqual([outer('a').w, outer('a').h], [4377, 821]);
  assert.equal(st('a').level, 'large');
  env.store.close();
});

test('API: 혼자인 두 노드 붙이기는 대상의 크기와 비율 불을 덩어리로 옮긴다. 혼자인 세션의 크기 막대는 그대로', () => {
  const env = fakeBackend();
  const { b, at, outer, st, add } = env;
  add('a', R(0, 0), { aspect: '16:9' }); add('b', R(3000, 0, 1040, 585));
  ops.setSize(b, { session: 'a', size: 'wide-large' });
  assert.deepEqual([at('a').w, at('a').h], [1920, 1080], '단독 세션: 1920×1080(P73 그대로)');
  ops.setSize(b, { session: 'b', size: 'tall43-small' });
  assert.deepEqual([at('b').w, at('b').h], [660, 880]);
  ops.setSize(b, { session: 'b', size: 'wide-small' });
  ops.dockAttach(b, { session: 'b', to: 'a', side: 'right' });
  assert.deepEqual([outer('a').w, outer('a').h], [3229, 908], '둘 크게: 1920×1080 넓이 × √2, 칸 16:9');
  assert.ok(near(at('a').w, at('b').w) && fitsAspect(at('b'), '16:9'), JSON.stringify(at('b')));
  assert.deepEqual(lit(st('a')), ['wide', '16:9', 'large']);
  env.store.close();
});

test('이미 있는 판: 뜰 때 덩어리 자리와 크기를 바꾸지 않는다. P73·P77 덩어리는 막대를 누를 때 새 규칙', () => {
  const env = fakeBackend();
  const { b, add } = env;
  ['a', 'b', 'c', 'd'].forEach((n, i) => add(n, R(i * 480, 0, 480, 1080)));
  ['e', 'f', 'g', 'h'].forEach((n, i) => add(n, R(i * 1920, 3000, 1920, 1080)));
  // P73 판: 바깥 1920×1080(16:9 크게)인 H 넷. P77 판: 칸마다 1920×1080인 H 넷(바깥 7680×1080). 둘 다 덩어리 비율 16:9
  env.store.insertDock({ dockId: 'd73', workspaceKey: 'ws', tree: presetTree('row', ['id-a', 'id-b', 'id-c', 'id-d']), origin: 'user', createdAt: 1 });
  env.store.insertDock({ dockId: 'd77', workspaceKey: 'ws', tree: presetTree('row', ['id-e', 'id-f', 'id-g', 'id-h']), origin: 'user', createdAt: 1 });
  env.store.setDockAspect('d73', '16:9'); env.store.setDockAspect('d77', '16:9');
  const file = env.file;
  const rects = env.store.nodes().map((n) => [n.session_id, n.x, n.y, n.w, n.h]);
  env.store.close();
  const again = fakeBackend(file);
  ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach((n) => again.add(n));
  ops.migrateDocks(again.b);
  assert.deepEqual(again.store.nodes().map((n) => [n.session_id, n.x, n.y, n.w, n.h]), rects, '자리와 크기 그대로');
  assert.equal(again.store.getDock('d73').aspect, '16:9', '옛 값 그대로');
  assert.deepEqual(lit(again.st('a')), ['tall', null, null], 'P73 H 넷: 칸이 16:9가 아니라 불은 꺼진다');
  assert.deepEqual(lit(again.st('e')), ['wide', '16:9', null], 'P77 H 넷: 칸이 16:9라 비율 불, 넓이가 단계와 달라 단계 불은 꺼진다');
  // 사람이 막대를 누를 때부터 새 규칙
  ops.setSize(again.b, { session: 'a', dir: 'wide', level: 'large', aspect: '16:9' });
  assert.deepEqual([again.outer('a').w, again.outer('a').h], [5431, 764]);
  ops.setSize(again.b, { session: 'e', level: 'large' });
  assert.deepEqual([again.outer('e').w, again.outer('e').h], [5431, 764]);
  again.store.close();
});
