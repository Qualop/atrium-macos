// P6a 단위 시험: 단일 캔버스(영역, 빈자리, P5 판 옮기기), 붙여 묶기(덩어리), 골라 묶기와 풀기, 크기 단계와 정리(되돌리기), 검색, @all.
// herdr와 claude 없이 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NODE, GAP, SIZE_STEPS, REGION_GAP, REGION_HEAD, REGION_PAD, EMPTY_REGION, overlaps, bbox, regionRect, regionsOf, slotInRegion, newRegionSlot, packRegions, splitSide, arrangeTree } from '../src/canvas.mjs';
import { edgeSnap, layout as layoutTree, fromLine, moveDivider, insert as treeInsert } from '../src/dock-tree.mjs'; // P17: 덩어리는 분할 나무
import { searchBoard, matchScore, snippet } from '../src/search.mjs';
import { migrateSingleCanvas } from '../src/migrate-canvas.mjs';
import { newRuntime } from '../src/state.mjs';
import { Store } from '../src/store.mjs';
import { Backend } from '../src/backend.mjs';
import * as ops from '../src/canvas-ops.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p6a-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });

test('H1: 영역은 안의 것을 감싸고(이름표 자리 위), 비면 저장한 자리에 빈 영역', () => {
  const r = regionRect([R(0, 0), R(760, 0)]);
  assert.deepEqual(r, { x: -REGION_PAD, y: -REGION_PAD - REGION_HEAD, w: 1480 + 2 * REGION_PAD, h: 460 + 2 * REGION_PAD + REGION_HEAD });
  assert.deepEqual(regionRect([], { x: 5, y: 6 }), { x: 5, y: 6, ...EMPTY_REGION });
  assert.equal(regionRect([]), null);
  const m = regionsOf([{ key: 'a' }, { key: 'b', x: 9000, y: 0 }, { key: 'c' }], [{ ws: 'a', ...R(0, 0) }, { ws: 'x', ...R(1, 1) }]);
  assert.deepEqual([...m.keys()], ['a', 'b'], '자리도 안의 것도 없는 워크스페이스는 영역이 없다');
});

test('H1: 새 노드는 자기 영역 안이나 바로 옆, 어느 노드와도 겹치지 않고, 커진 영역이 다른 영역과 겹치지 않는다', () => {
  // ws a: 노드 둘, ws b: 오른쪽에 영역
  const items = [{ ws: 'a', id: 'a1', ...R(0, 0) }, { ws: 'a', id: 'a2', ...R(760, 0) }, { ws: 'b', id: 'b1', ...R(1480 + REGION_GAP + 2 * REGION_PAD + 10, 0) }];
  const regs = regionsOf([{ key: 'a' }, { key: 'b' }], items);
  assert.equal(overlaps(regs.get('a'), regs.get('b')), false);
  for (let i = 0; i < 6; i++) {
    const at = slotInRegion({ wsKey: 'a', size: NODE, items, regions: regionsOf([{ key: 'a' }, { key: 'b' }], items) });
    const c = { ws: 'a', id: `n${i}`, ...at, w: NODE.w, h: NODE.h };
    assert.ok(!items.some((x) => overlaps(c, x, GAP - 1)), `겹치지 않는다 ${JSON.stringify(at)}`);
    items.push(c);
    const rs = regionsOf([{ key: 'a' }, { key: 'b' }], items);
    assert.ok(!overlaps(rs.get('a'), rs.get('b')), '영역끼리 겹치지 않는다');
    const own = bbox(items.filter((x) => x.ws === 'a'));
    assert.ok(own.w <= 5 * (NODE.w + GAP) && own.h <= 6 * (NODE.h + GAP), '영역 근처에 둔다');
  }
  // 빈 워크스페이스: 영역 자리 안 왼쪽 위
  const at = slotInRegion({ wsKey: 'c', items, regions: new Map([['c', { x: 9000, y: 9000, ...EMPTY_REGION }]]) });
  assert.deepEqual(at, { x: 9000 + REGION_PAD, y: 9000 + REGION_HEAD + REGION_PAD });
  // 부모 옆(near)부터
  const near = slotInRegion({ wsKey: 'z', items: [{ ws: 'z', id: 'p', ...R(0, 0) }], regions: new Map(), near: R(0, 0) });
  assert.deepEqual(near, { x: NODE.w + GAP, y: 0 });
});

test('H1: 사람이 영역을 다른 영역 바로 옆에 두었어도 새 노드는 자기 영역 가까이, 영역이 겹치지 않게(먼 곳으로 늘이지 않는다)', () => {
  // two 영역의 왼쪽 위 = r1 영역의 오른쪽 끝(틈 0)
  const items = [{ ws: 'r1', id: 'r', ...R(1720, 856) }, { ws: 'two', id: 'f', ...R(1720 + 720 + 2 * REGION_PAD, 406) }];
  const regs = regionsOf([{ key: 'r1' }, { key: 'two' }], items);
  assert.ok(!overlaps(regs.get('r1'), regs.get('two'), -1));
  const at = slotInRegion({ wsKey: 'two', items, regions: regs });
  const c = { ws: 'two', ...at, w: NODE.w, h: NODE.h };
  const after = regionsOf([{ key: 'r1' }, { key: 'two' }], [...items, c]);
  assert.ok(!overlaps(after.get('r1'), after.get('two'), -1), '영역이 겹치지 않는다');
  assert.ok(Math.abs(at.x - items[1].x) <= NODE.w + GAP && Math.abs(at.y - items[1].y) <= 2 * (NODE.h + GAP), `자기 노드 가까이 ${JSON.stringify(at)}`);
});

test('H1: 새 영역 자리와 P5 판 옮기기(묶음째로, 겹치지 않게, 첫 묶음은 그대로)', () => {
  const regs = [{ x: 0, y: 0, w: 2000, h: 1000 }];
  const at = newRegionSlot(regs, EMPTY_REGION);
  assert.ok(!overlaps({ ...at, ...EMPTY_REGION }, regs[0], REGION_GAP - 1));
  assert.deepEqual(newRegionSlot([], EMPTY_REGION), { x: 0, y: 0 });
  const blocks = [{ key: 'a', rect: { x: -40, y: -112, w: 1600, h: 700 } }, { key: 'b', rect: { x: -40, y: -112, w: 800, h: 600 } }, { key: 'c', rect: { x: 100, y: 100, w: 900, h: 900 } }, { key: 'e', rect: null }];
  const sh = packRegions(blocks);
  assert.deepEqual(sh.get('a'), { dx: 0, dy: 0 });
  assert.equal(sh.has('e'), false);
  const placed = blocks.filter((b) => b.rect).map((b) => ({ ...b.rect, x: b.rect.x + sh.get(b.key).dx, y: b.rect.y + sh.get(b.key).dy }));
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(!overlaps(placed[i], placed[j], REGION_GAP - 1), `${i}·${j} 겹치지 않음`);
});

test('H5: 덩어리 배치 — 틈 없이, 붙일 자리(P17: 덩어리 바깥 어느 가장자리에나), 분할선, herdr 나눈 방향', () => {
  // 한 줄 나무를 늘어놓으면 틈이 없다(옛 layoutDock과 같은 모양)
  const lay = layoutTree(fromLine('row', ['a', 'b'], [700, 500]), R(10, 20, 1200, 400));
  assert.deepEqual([lay.rects.get('a'), lay.rects.get('b')], [R(10, 20, 700, 400), R(710, 20, 500, 400)]);
  // 붙일 자리: 오른쪽 가장자리 가까이(혼자인 노드도 한 덩어리로 본다)
  const nodes = [{ id: 'a', ...R(0, 0) }, { id: 'b', ...R(3000, 0) }];
  const s = edgeSnap({ id: 'n', ...R(NODE.w + 30, 50, 480, 300) }, nodes, 80);
  assert.deepEqual([s.targetId, s.side, s.at], ['a', 'right', 'dock']);
  assert.deepEqual(s.preview, { x: NODE.w, y: 0, w: 480, h: NODE.h }, '높이는 붙는 쪽에 맞춘다');
  assert.equal(edgeSnap({ id: 'n', ...R(NODE.w + 300, 50) }, nodes, 80), null, '멀면 붙지 않는다');
  assert.equal(edgeSnap({ id: 'n', ...R(NODE.w + 10, 2000) }, nodes, 80), null, '옆으로 겹치지 않으면 붙지 않는다');
  // P17: 가로줄 덩어리 아래에도 붙는다(덩어리 전체 아래 새 칸)
  const row = [{ id: 'a', dockId: 'd', ...R(0, 0, 2160, NODE.h) }];
  const under = edgeSnap({ id: 'n', ...R(720, NODE.h + 20) }, row, 80);
  assert.deepEqual([under.side, under.at, under.preview], ['bottom', 'dock', { x: 0, y: NODE.h, w: 2160, h: NODE.h }]);
  // 분할선: 그 마디의 두 쪽만, 합은 그대로, 최소 크기
  const t = fromLine('row', ['a', 'b'], [700, 500]);
  const moved = layoutTree(moveDivider(t, R(0, 0, 1200, 400), [], 0, 100), R(0, 0, 1200, 400));
  assert.deepEqual([moved.rects.get('a').w, moved.rects.get('b').w], [800, 400]);
  const far = layoutTree(moveDivider(t, R(0, 0, 1200, 400), [], 0, 900), R(0, 0, 1200, 400));
  assert.deepEqual([far.rects.get('a').w, far.rects.get('b').w], [960, 240]);
  assert.deepEqual(treeInsert('a', { target: 'a', side: 'top', id: 'n', at: 'dock' }).kids, ['n', 'a']);
  // herdr 탭 레이아웃(글자 칸)
  assert.equal(splitSide({ x: 0, y: 0, width: 80, height: 40 }, { x: 81, y: 0, width: 79, height: 40 }), 'right');
  assert.equal(splitSide({ x: 0, y: 0, width: 160, height: 20 }, { x: 0, y: 21, width: 160, height: 19 }), 'bottom');
  assert.equal(splitSide({ x: 0, y: 0, width: 160, height: 40 }, null), null);
});

test('H7: 정리 — 시키는 쪽은 왼쪽에 크게, 받는 쪽은 오른쪽에 작게, 덩어리는 크기 그대로, 연결 없는 것은 아래에', () => {
  const blocks = [
    { id: 'lead', x: 500, y: 500, w: 720, h: 460, members: ['lead'], resizable: true },
    { id: 'r1', x: 0, y: 0, w: 720, h: 460, members: ['r1'], resizable: true },
    { id: 'r2', x: 0, y: 900, w: 720, h: 460, members: ['r2'], resizable: true },
    { id: 'd:x', x: 3000, y: 0, w: 1440, h: 460, members: ['h1', 'h2'], resizable: false },
    { id: 'solo', x: 9000, y: 9000, w: 720, h: 460, members: ['solo'], resizable: true },
  ];
  const plan = arrangeTree(blocks, [['lead', 'r1'], ['lead', 'r2'], ['r2', 'h1'], ['r1', 'r1']], { origin: { x: 0, y: 0 } });
  const p = (id) => plan.get(id);
  assert.equal(p('lead').size, 'large');
  assert.deepEqual([p('lead').w, p('lead').h], [SIZE_STEPS.large.w, SIZE_STEPS.large.h]);
  assert.equal(p('r1').size, 'small', '잎은 작게');
  assert.equal(p('r2').size, 'normal', '가운데는 보통');
  assert.equal(p('d:x').size, null, '덩어리는 크기 그대로');
  assert.deepEqual([p('d:x').w, p('d:x').h], [1440, 460]);
  assert.ok(p('lead').x < p('r1').x && p('r1').x === p('r2').x && p('r2').x < p('d:x').x, '깊이마다 오른쪽 열');
  assert.ok(p('solo').y > Math.max(p('lead').y + p('lead').h, p('r2').y + p('r2').h), '연결 없는 블록은 아래');
  const rects = [...plan.values()];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.ok(!overlaps(rects[i], rects[j], -1), '겹치지 않는다');
});

test('H2: 검색 — 이름, 질문, 요청, 답, 메모, 워크스페이스. 세션마다 가장 잘 맞은 것 하나', () => {
  assert.equal(matchScore('reviewer', 'review'), 1.2);
  assert.equal(matchScore('a reviewer', 'review'), 1.1);
  assert.equal(matchScore('x', 'y'), 0);
  assert.equal(snippet('가'.repeat(100) + '찾을 글' + '나'.repeat(100), '찾을', 5), '…가가가가가찾을 글나나나…');
  const sessions = [
    { sessionId: '1', name: 'lead', workspaceKey: 'w1', lastPrompt: '테스트를 돌려 줘', lastAnswer: 'ok', state: 'ready' },
    { sessionId: '2', name: 'rev', workspaceKey: 'w1', ask: { kind: 'question', questions: [{ question: '어느 브랜치에 합칠까?' }] }, state: 'waiting' },
    { sessionId: '3', name: 'test-bot', workspaceKey: 'w2', lastAnswer: '테스트 3개 통과', state: 'ready' },
  ];
  const ws = [{ key: 'w1', name: 'multitask', root: 'C:/x/multitask' }, { key: 'w2', name: 'plain', root: 'C:/plain' }];
  let r = searchBoard({ q: '테스트', sessions, workspaces: ws });
  assert.deepEqual(r.map((x) => [x.name, x.field]), [['lead', 'prompt'], ['test-bot', 'answer']]);
  r = searchBoard({ q: '브랜치', sessions, workspaces: ws });
  assert.deepEqual(r.map((x) => [x.name, x.field, x.label]), [['rev', 'ask', '질문']]);
  r = searchBoard({ q: 'test', sessions, workspaces: ws });
  assert.equal(r[0].name, 'test-bot');
  assert.equal(r[0].field, 'name');
  r = searchBoard({ q: 'multi', sessions, workspaces: ws });
  assert.deepEqual(r.map((x) => x.kind), ['workspace', 'session', 'session'], '워크스페이스 이름: 워크스페이스(영역) 먼저, 그 안 세션도');
  r = searchBoard({ q: '배포', sessions, workspaces: ws, texts: [{ sessionId: '3', field: 'history', text: '내일 배포 전에 다시 보기' }] });
  assert.deepEqual(r.map((x) => [x.name, x.label]), [['test-bot', '이전 요청']]);
  assert.deepEqual(searchBoard({ q: '  ', sessions }), []);
});

// ---------- 저장소와 판 API(가짜 백엔드) ----------
function fakeBackend() {
  const b = new Backend({ quietMs: 600000, port: 0, logDir: tmp() });
  b.store = new Store(path.join(tmp(), 'board.db'));
  b.sessions = new Map();
  const sent = []; const events = [];
  b.queue = { enqueue: (sid, text) => { sent.push({ sid, text }); return { deliveryId: 'd' + sent.length, status: 'queued' }; }, pending: () => 0, list: () => [], cancelSession: () => {}, pump: () => {} };
  b.api = { broadcast: (event, data) => events.push({ event, data }) };
  b.touch = () => {};
  b.log = () => {};
  b.sent = sent; b.events = events;
  const add = (name, ws, rect, extra = {}) => {
    const s = { sessionId: 'id-' + name, name, kind: extra.kind || 'claude', workspaceKey: ws, cwd: extra.cwd || `C:/${ws}`, rt: newRuntime({ kind: extra.kind || 'claude', hooked: true }), origin: 'board', createdAt: Date.now(), paneId: extra.paneId || null, herdrWorkspaceId: extra.hw || null, ...extra };
    b.sessions.set(s.sessionId, s);
    b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    if (rect) b.store.setNode({ session_id: s.sessionId, ...rect, z: 0 });
    return s;
  };
  b.store.insertWorkspace({ key: 'ws-a', kind: 'repo', root: 'C:/r/a', createdAt: 1 });
  b.store.insertWorkspace({ key: 'ws-b', kind: 'folder', root: 'C:/b', createdAt: 2 });
  return { b, add };
}
const rectOf = (b, name) => { const n = b.store.nodes().find((x) => x.session_id === 'id-' + name); return n && { x: n.x, y: n.y, w: n.w, h: n.h }; };

test('P5 판 옮기기: 워크스페이스마다 겹치던 판을 겹치지 않게, 안의 상대 자리는 그대로, 두 번 돌려도 같다', () => {
  const { b, add } = fakeBackend();
  add('a1', 'ws-a', R(0, 0)); add('a2', 'ws-a', R(760, 100));
  add('b1', 'ws-b', R(0, 0)); add('b2', 'ws-b', R(20, 600)); // P5에서는 a1과 같은 자리
  b.store.insertWorkspace({ key: 'ws-e', kind: 'folder', root: 'C:/e', createdAt: 3 }); // 빈 워크스페이스
  const before = { a1: rectOf(b, 'a1'), a2: rectOf(b, 'a2'), b1: rectOf(b, 'b1'), b2: rectOf(b, 'b2') };
  const r = migrateSingleCanvas(b.store);
  assert.equal(r.workspaces, 3);
  const after = { a1: rectOf(b, 'a1'), a2: rectOf(b, 'a2'), b1: rectOf(b, 'b1'), b2: rectOf(b, 'b2') };
  assert.deepEqual(after.a1, before.a1, '첫 워크스페이스는 제자리');
  assert.equal(after.a2.x - after.a1.x, before.a2.x - before.a1.x);
  assert.equal(after.b2.x - after.b1.x, before.b2.x - before.b1.x, '안의 상대 자리는 그대로');
  assert.equal(after.b2.y - after.b1.y, before.b2.y - before.b1.y);
  const regs = ops.regions(b);
  assert.deepEqual([...regs.keys()].sort(), ['ws-a', 'ws-b', 'ws-e']);
  const list = [...regs.values()];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!overlaps(list[i], list[j]), '영역끼리 겹치지 않는다');
  assert.equal(b.store.getMeta('canvas'), 'single');
  assert.equal(migrateSingleCanvas(b.store), null, '다시 돌리면 아무것도 하지 않는다');
  assert.deepEqual(rectOf(b, 'b1'), after.b1);
  b.store.close();
});

test('H1: 새 세션 자리(slotFor)와 새 워크스페이스 영역 자리, 영역 옮기기(겹치면 거부)', () => {
  const { b, add } = fakeBackend();
  add('a1', 'ws-a', R(0, 0));
  add('b1', 'ws-b', R(3000, 0));
  for (let i = 0; i < 4; i++) { const at = ops.slotFor(b, { wsKey: 'ws-a' }); add(`a${i + 2}`, 'ws-a', { ...at, w: NODE.w, h: NODE.h }); }
  let regs = ops.regions(b);
  assert.ok(!overlaps(regs.get('ws-a'), regs.get('ws-b')));
  // 새 워크스페이스: 다른 영역과 겹치지 않는 자리, 첫 노드는 그 안
  b.store.insertWorkspace({ key: 'ws-c', kind: 'folder', root: 'C:/c', createdAt: 3 });
  ops.anchorWorkspace(b, 'ws-c');
  const w = b.store.getWorkspace('ws-c');
  assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y));
  const at = ops.slotFor(b, { wsKey: 'ws-c' });
  assert.deepEqual(at, { x: w.x + REGION_PAD, y: w.y + REGION_HEAD + REGION_PAD });
  add('c1', 'ws-c', { ...at, w: NODE.w, h: NODE.h });
  regs = ops.regions(b);
  for (const k of ['ws-a', 'ws-b']) assert.ok(!overlaps(regs.get('ws-c'), regs.get(k)));
  // 영역 옮기기: 안의 것이 함께 움직인다. 다른 영역과 겹치면 거부
  const c0 = rectOf(b, 'c1');
  ops.workspaceMove(b, { workspace: 'ws-c', dx: 0, dy: 5000 });
  assert.deepEqual(rectOf(b, 'c1'), { ...c0, y: c0.y + 5000 });
  const ra = ops.regions(b).get('ws-a'), rb = ops.regions(b).get('ws-b');
  assert.throws(() => ops.workspaceMove(b, { workspace: 'ws-b', dx: ra.x - rb.x, dy: ra.y - rb.y }), (e) => e.code === 'overlap');
  b.store.close();
});

test('H5: 덩어리 — 붙이기(덩어리 옆 새 칸), 다른 워크스페이스 거부, 분할선, 떼기, 닫히면 빠지고 하나 남으면 풀림, 저장', () => {
  const { b, add } = fakeBackend();
  add('a', 'ws-a', R(0, 0)); add('n', 'ws-a', R(2000, 2000, 480, 300)); add('m', 'ws-a', R(4000, 0)); add('x', 'ws-b', R(9000, 0));
  let r = ops.dockAttach(b, { session: 'n', to: 'a', side: 'right' });
  assert.deepEqual(r.dock.members, ['id-a', 'id-n']);
  assert.equal(r.dock.dir, 'row');
  assert.deepEqual(rectOf(b, 'n'), { x: NODE.w, y: 0, w: 480, h: NODE.h }, '틈 없이, 높이는 덩어리를 따른다');
  assert.ok(b.events.some((e) => e.event === 'board.changed'));
  r = ops.dockAttach(b, { session: 'm', to: 'a', side: 'left', at: 'dock' }); // P17: 덩어리 전체 왼쪽 새 칸(제 너비를 지킨다)
  assert.deepEqual(r.dock.members, ['id-m', 'id-a', 'id-n']);
  assert.deepEqual(rectOf(b, 'm'), { x: -NODE.w, y: 0, w: NODE.w, h: NODE.h }, '앞에 붙으면 덩어리가 그만큼 앞에서 시작');
  assert.throws(() => ops.dockAttach(b, { session: 'x', to: 'n', side: 'right' }), (e) => e.code === 'bad_request');
  // 분할선
  ops.dockUpdate(b, { dock: r.dock.dockId, sizes: [600, 840, 480] });
  assert.deepEqual([rectOf(b, 'm').x, rectOf(b, 'a').x, rectOf(b, 'n').x], [-NODE.w, -NODE.w + 600, -NODE.w + 1440]);
  // 덩어리째로 옮기기
  ops.dockUpdate(b, { dock: r.dock.dockId, x: 100, y: 200 });
  assert.deepEqual([rectOf(b, 'm').x, rectOf(b, 'm').y, rectOf(b, 'n').x], [100, 200, 1540]);
  // 떼기: 남은 것은 틈 없이
  ops.dockRemove(b, { session: 'a' });
  const d = ops.dockOf(b, 'id-m');
  assert.deepEqual(d.members, ['id-m', 'id-n']);
  assert.equal(rectOf(b, 'n').x, 100 + 600);
  assert.ok(!overlaps(rectOf(b, 'a'), rectOf(b, 'm'), GAP - 1) && !overlaps(rectOf(b, 'a'), rectOf(b, 'n'), GAP - 1), '뗀 노드는 덩어리와 겹치지 않는 곳');
  // 저장소에 남는다(다시 띄워도)
  const file = b.store.db.location ? b.store.db.location() : null;
  void file;
  assert.equal(b.store.docks().length, 1);
  // 세션이 닫히면 빠지고 하나 남으면 풀린다
  b.sessions.delete('id-n');
  ops.onSessionClosed(b, { sessionId: 'id-n' });
  assert.equal(b.store.docks().length, 0);
  b.store.close();
});

test('H5: herdr에서 같은 탭에 나뉜 패널은 나눈 방향대로 처음부터 붙인다(다른 탭이면 그대로)', async () => {
  const { b, add } = fakeBackend();
  const p = add('lead', 'ws-a', R(0, 0), { paneId: 'w1:p1', hw: 'w1' });
  const c = add('sh-w1p2', 'ws-a', R(760, 0), { paneId: 'w1:p2', hw: 'w1', kind: 'shell', origin: 'adopted' });
  const o = add('other', 'ws-a', R(0, 900), { paneId: 'w1:p3', hw: 'w1' });
  b.adapter = { paneLayout: async (pane) => (pane === 'w1:p2' ? { tab_id: 'w1:t1', panes: [{ pane_id: 'w1:p1', rect: { x: 0, y: 0, width: 80, height: 40 } }, { pane_id: 'w1:p2', rect: { x: 0, y: 41, width: 80, height: 39 } }] } : { tab_id: 'w1:t2', panes: [{ pane_id: 'w1:p3', rect: { x: 0, y: 0, width: 160, height: 40 } }] }) };
  const d = await ops.autoDockSplit(b, c, p);
  assert.deepEqual([d.dir, d.members, d.origin], ['col', ['id-lead', 'id-sh-w1p2'], 'herdr']);
  assert.deepEqual(rectOf(b, 'sh-w1p2'), { x: 0, y: NODE.h, w: NODE.w, h: NODE.h });
  assert.equal(await ops.autoDockSplit(b, o, p), null, '다른 탭');
  b.store.close();
});

test('H7: 크기 단계와 정리(연결을 따라), 한 번 되돌리기', () => {
  const { b, add } = fakeBackend();
  add('lead', 'ws-a', R(2000, 2000)); add('rev', 'ws-a', R(0, 0)); add('help', 'ws-a', R(0, 900));
  add('y', 'ws-b', R(20000, 0));
  ops.setSize(b, { session: 'rev', size: 'small' });
  assert.deepEqual(rectOf(b, 'rev'), { x: 0, y: 0, ...SIZE_STEPS.small });
  assert.equal(b.store.nodes().find((n) => n.session_id === 'id-rev').size, 'wide-small');
  assert.throws(() => ops.setSize(b, { session: 'rev', size: 'huge' }));
  for (const [f, t, role] of [['lead', 'rev', '리뷰어'], ['lead', 'help', null]]) b.store.insertLink({ linkId: `l-${t}`, from: 'id-' + f, to: 'id-' + t, role, spawned: !role, createdAt: 1 });
  const before = b.store.nodes().map((n) => ({ ...n }));
  const preview = ops.arrange(b, { workspace: 'ws-a' });
  assert.equal(preview.applied, false);
  assert.deepEqual(b.store.nodes(), before, '미리 보기는 바꾸지 않는다');
  const r = ops.arrange(b, { workspace: 'ws-a', apply: true });
  assert.equal(r.applied, true);
  const lead = rectOf(b, 'lead'), rev = rectOf(b, 'rev'), help = rectOf(b, 'help');
  assert.deepEqual([lead.w, rev.w, help.w], [SIZE_STEPS.large.w, SIZE_STEPS.small.w, SIZE_STEPS.small.w]);
  assert.ok(lead.x < rev.x && rev.x === help.x);
  assert.deepEqual(rectOf(b, 'y'), R(20000, 0), '다른 워크스페이스는 그대로');
  const regs = ops.regions(b);
  assert.ok(!overlaps(regs.get('ws-a'), regs.get('ws-b')));
  ops.arrange(b, { workspace: 'ws-a', undo: true });
  assert.deepEqual(b.store.nodes().map((n) => [n.session_id, n.x, n.y, n.w, n.h]), before.map((n) => [n.session_id, n.x, n.y, n.w, n.h]), '되돌리기');
  const sizeOf = (name) => b.store.nodes().find((n) => n.session_id === 'id-' + name).size || null;
  assert.deepEqual([sizeOf('lead'), sizeOf('rev')], [null, 'wide-small'], '크기 단계도 정리 전으로');
  assert.throws(() => ops.arrange(b, { workspace: 'ws-a', undo: true }), (e) => e.code === 'not_found', '되돌리기는 한 번');
  b.store.close();
});

test('H2: 검색 API — 요약(이름·요청·답·질문)과 판 기록(보낸 글, hook, 연결로 받은 지시). 닫힌 세션은 뺀다', () => {
  const { b, add } = fakeBackend();
  const a = add('alpha', 'ws-a', R(0, 0));
  add('beta', 'ws-b', R(5000, 0));
  a.rt.lastPrompt = 'README를 고쳐 줘'; a.rt.lastAnswer = '고쳤다';
  b.store.insertDelivery({ deliveryId: 'd0', sessionId: 'id-beta', text: '100% 확인 필요_x', status: 'confirmed', createdAt: 1 });
  b.store.insertDelivery({ deliveryId: 'd1', sessionId: 'id-beta', text: '배포 스크립트 점검', status: 'confirmed', createdAt: 1 });
  b.store.addEvent('id-alpha', 'hook', { ev: 'UserPromptSubmit', prompt: '지난번 리팩터링 요청' });
  b.store.insertLink({ linkId: 'l1', from: 'id-alpha', to: 'id-beta', role: null, observed: true, createdAt: 1 });
  b.store.addLinkEvent('l1', 'prompt', '로그 정리해');
  b.store.insertDelivery({ deliveryId: 'd2', sessionId: 'id-gone', text: 'README 닫힌 세션', status: 'confirmed', createdAt: 1 });
  const q = (x) => ops.searchQuery(b, { q: x }).results.map((r) => [r.name, r.field]);
  assert.deepEqual(q('README'), [['alpha', 'prompt']]);
  assert.deepEqual(q('100%'), [['beta', 'history']], 'LIKE 특수 글자는 글자 그대로');
  assert.deepEqual(q('_x'), [['beta', 'history']]);
  assert.deepEqual(q('배포'), [['beta', 'history']]);
  assert.deepEqual(q('리팩터링'), [['alpha', 'history']]);
  assert.deepEqual(q('로그'), [['beta', 'linked']]);
  assert.deepEqual(q('alp'), [['alpha', 'name']]);
  b.store.close();
});

test('저장소: P5까지의 board.db에 열(workspaces.x·y, nodes.size)과 표(docks)를 더하고, setNode는 크기 단계를 지킨다', async () => {
  const file = path.join(tmp(), 'board.db');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'fixtures', 'p4-schema.sql'), 'utf8'));
  db.close();
  const st = new Store(file);
  st.insertWorkspace({ key: 'k', kind: 'folder', root: 'C:/k', createdAt: 1 });
  st.setWorkspaceAnchor('k', 10, 20);
  assert.deepEqual([st.getWorkspace('k').x, st.getWorkspace('k').y], [10, 20]);
  st.setNode({ session_id: 's', x: 0, y: 0, w: 1, h: 1, size: 'small' });
  st.setNode({ session_id: 's', x: 5, y: 0, w: 1, h: 1 });
  assert.equal(st.db.prepare("SELECT size FROM nodes WHERE session_id = 's'").get().size, 'small');
  st.insertDock({ dockId: 'd1', workspaceKey: 'k', dir: 'row', members: ['a', 'b'], origin: 'user', createdAt: 1 });
  st.updateDock('d1', { dir: 'col', members: ['b', 'a'] });
  assert.deepEqual(st.getDock('d1').members, ['b', 'a']);
  st.close();
  const again = new Store(file);
  assert.deepEqual(again.docks().map((d) => [d.dockId, d.dir]), [['d1', 'col']], '다시 열어도 남는다');
  again.close();
});
