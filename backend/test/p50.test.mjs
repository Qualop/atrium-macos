// P50 단위 시험(#2): 배치 틀로 짠 덩어리가 다른 노드·메모를 덮지 않는다(U1). 순수 함수 dockSpot과 판 API dockLayout. herdr와 claude 없이 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NODE, GAP, overlaps, dockSpot, regionRect } from '../src/canvas.mjs';
import { newRuntime } from '../src/state.mjs';
import { Store } from '../src/store.mjs';
import * as ops from '../src/canvas-ops.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p50-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });

function fakeBackend() {
  const store = new Store(path.join(tmp(), 'board.db'));
  const sessions = new Map();
  const b = { store, sessions, api: { broadcast: () => {} }, log: () => {}, nameOf: (sid) => (sessions.get(sid) || { name: sid }).name };
  b.resolve = (ref) => { const s = sessions.get(ref) || [...sessions.values()].find((x) => x.name === ref); if (!s) throw new Error(`없는 세션: ${ref}`); return s; };
  store.insertWorkspace({ key: 'ws', kind: 'folder', root: 'C:/ws', createdAt: 1 });
  const add = (name, rect, ws = 'ws') => {
    const s = { sessionId: `id-${name}`, name, kind: 'shell', workspaceKey: ws, cwd: 'C:/ws', rt: newRuntime({ kind: 'shell', hooked: false }), origin: 'board', createdAt: 1 };
    sessions.set(s.sessionId, s);
    store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    store.setNode({ session_id: s.sessionId, ...rect, z: 0 });
  };
  const at = (name) => { const n = store.nodes().find((x) => x.session_id === `id-${name}`); return n && R(n.x, n.y, n.w, n.h); };
  return { b, add, at };
}

test('dockSpot: 원하는 자리가 비면 그대로, 막히면 가장 가까운 빈자리(같으면 위)', () => {
  const rect = R(0, 0, 1440, 460);
  assert.deepEqual(dockSpot({ rect, items: [R(3000, 0)] }), { x: 0, y: 0 }, '비면 그대로');
  // ux1 재현: pa(0,0) 오른쪽에 pb(760,0). pc는 pa 위였고 고른 노드라 빠졌다
  const pb = R(760, 0);
  const at = dockSpot({ rect, items: [pb], prefer: [R(0, 0), R(0, -500)] });
  assert.deepEqual(at, { x: 0, y: -500 }, '고른 노드가 있던 위쪽 자리');
  assert.ok(!overlaps({ ...rect, ...at }, pb, GAP - 1));
  // 창 시험의 자리: pc가 pa 아래였으면 위·아래 거리가 같아도 비워지는 아래 자리
  assert.deepEqual(dockSpot({ rect, items: [pb], prefer: [R(0, 0), R(0, 500)] }), { x: 0, y: 500 }, '비워지는 자리와 겹치는 쪽');
  assert.deepEqual(dockSpot({ rect, items: [pb] }), { x: 0, y: -500 }, '비워지는 자리가 없으면 위');
  // 둘레가 막혀도 겹치지 않는 자리를 찾는다
  const ring = [R(760, 0), R(-760, 0), R(0, -500), R(0, 500), R(760, -500), R(760, 500), R(-760, -500), R(-760, 500)];
  const at2 = dockSpot({ rect, items: ring });
  assert.ok(ring.every((r) => !overlaps({ ...rect, ...at2 }, r, GAP - 1)), JSON.stringify(at2));
});

test('dockSpot: 커진 자기 영역이 다른 영역과 붙는 자리는 피한다', () => {
  const rect = R(0, 0, 1440, 460);
  const other = { x: 0, y: 700, w: 2000, h: 800 }; // 아래 다른 영역
  const pb = R(760, 0);
  const at = dockSpot({ rect, items: [pb], others: [other] });
  const reg = regionRect([{ ...rect, ...at }]);
  assert.ok(!overlaps(reg, other, 119), JSON.stringify(at));
  assert.ok(!overlaps({ ...rect, ...at }, pb, GAP - 1));
});

test('dockLayout: 노드 둘을 가로 2개로 짜도 셋째 노드를 덮지 않는다(#2)', () => {
  const { b, add, at } = fakeBackend();
  // 새 노드 자리 그대로: pa(왼쪽), pb(pa 오른쪽), pc(pa 위)
  add('pa', R(40, -388)); add('pb', R(800, -388)); add('pc', R(40, -888));
  ops.dockLayout(b, { members: ['pa', 'pc'], preset: 'row' });
  const pa = at('pa'), pc = at('pc'), pb = at('pb');
  assert.deepEqual(pb, R(800, -388), '셋째 노드는 그대로');
  assert.equal(pa.y, pc.y); assert.equal(pc.x, pa.x + pa.w);
  for (const r of [pa, pc]) assert.ok(!overlaps(r, pb, GAP - 1), `덩어리가 pb를 덮지 않는다: ${JSON.stringify(r)}`);
  assert.deepEqual(pa, R(40, -888), '고른 노드가 있던 자리(pc 자리)에 짠다');
});

test('dockLayout: 창 시험 자리(pc가 pa 아래)면 비워지는 아래 자리에 짠다', () => {
  const { b, add, at } = fakeBackend();
  add('pa', R(40, 112)); add('pb', R(800, 112)); add('pc', R(40, 612));
  ops.dockLayout(b, { members: ['pa', 'pc'], preset: 'row' });
  assert.deepEqual([at('pa'), at('pc'), at('pb')], [R(40, 612), R(760, 612), R(800, 112)]);
});

test('dockLayout: 고른 노드 자리에 메모가 있으면 메모도 피한다', () => {
  const { b, add, at } = fakeBackend();
  add('pa', R(40, -388)); add('pb', R(800, -388)); add('pc', R(40, -888));
  b.store.insertMemo({ memoId: 'm1', workspaceKey: 'ws', text: '', x: 900, y: -800, w: 280, h: 200, createdAt: 1 });
  ops.dockLayout(b, { members: ['pa', 'pc'], preset: 'row' });
  const pa = at('pa'), pc = at('pc'), pb = at('pb');
  assert.deepEqual(pb, R(800, -388));
  for (const o of [pb, ...b.store.memos()]) for (const r of [pa, pc]) assert.ok(!overlaps(r, o, GAP - 1), `${JSON.stringify(r)} / ${JSON.stringify(o)}`);
});

test('dockLayout: 원하는 자리가 비면 옛날처럼 첫 노드 자리에서 짠다', () => {
  const { b, add, at } = fakeBackend();
  add('a', R(0, 0)); add('b', R(3000, 0)); add('c', R(6000, 0));
  ops.dockLayout(b, { members: ['a', 'b', 'c'], preset: 'row' });
  assert.deepEqual([at('a'), at('b'), at('c')], [R(0, 0), R(720, 0), R(1440, 0)]);
});
