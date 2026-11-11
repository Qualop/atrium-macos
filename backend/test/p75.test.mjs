// P75 시험: 하위 세션 줄(ARCH K4, H7). 워커와 그 워크트리 상자가 부모 오른쪽 한 열에 띄운 순서대로 서고, 손자는 그 오른쪽 열.
// 영역 겹침 풀기가 줄을 흩지 않고(아래로만), 붙여 묶은 덩어리는 한 블록, 정리는 같은 규칙과 한 번 되돌리기, 키우면 뒤 형제가 밀리고, 순서 번호, 이미 있는 판은 그대로.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { NODE, SIZE_STEPS, overlaps } from '../src/canvas.mjs';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { Backend } from '../src/backend.mjs';
import * as ops from '../src/canvas-ops.mjs';
import { Branch, CHILD_SIZE } from '../src/branch.mjs';
import { pathKey, normPath } from '../src/workspaces.mjs';
import { attachWorktrees } from '../src/worktrees.mjs';
import { areaKey, regionConflicts, settleBoxes } from '../src/worktree-areas.mjs';
import { lineSlot, pushLine, blockTree, boxFrame, LINE_GAP_X, LINE_GAP_Y } from '../src/tree-line.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p75-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });
const KID = SIZE_STEPS[CHILD_SIZE];

// ---------- 순수 함수 ----------
test('P75 줄 밀기: 앞 띠와 겹치는 뒤의 것만 아래로, 순서는 그대로, 당기지 않는다', () => {
  const units = [{ id: 'a', rect: R(0, 0, 100, 500) }, { id: 'b', rect: R(0, 300, 100, 100) }, { id: 'c', rect: R(0, 420, 100, 100) }, { id: 'd', rect: R(0, 5000, 100, 100) }];
  const sh = pushLine(units);
  assert.equal(sh.get('b'), 500 + LINE_GAP_Y - 300);
  assert.equal(sh.get('c'), 500 + LINE_GAP_Y + 100 + LINE_GAP_Y - 420, '밀린 b 아래로');
  assert.equal(sh.has('d'), false, '멀리 있는 것은 그대로(당기지 않는다)');
  assert.equal(sh.has('a'), false);
  assert.equal(pushLine([{ id: 'x', rect: R(0, 0, 100, 100) }, { id: 'y', rect: R(0, 100 + LINE_GAP_Y, 100, 100) }]).size, 0, '이미 줄이면 할 일이 없다');
});

test('P75 블록 나무: 상자 블록의 부모는 상자 밖 부모, 형제는 띄운 순서, 고리는 끊는다', () => {
  const rows = { lead: { createdAt: 1 }, w2: { parentSessionId: 'lead', createdAt: 3 }, w1: { parentSessionId: 'lead', createdAt: 2 }, g1: { parentSessionId: 'w1', createdAt: 4 }, x: { parentSessionId: 'y', createdAt: 5 }, y: { parentSessionId: 'x', createdAt: 6 } };
  const blocks = [{ id: 'lead', ...R(0, 0), members: ['lead'] }, { id: 'w:b2', ...R(1000, 0), members: ['w2'] }, { id: 'w:b1', ...R(1000, 900), members: ['w1', 'g1'] }, { id: 'x', ...R(0, 9000), members: ['x'] }, { id: 'y', ...R(0, 9900), members: ['y'] }];
  const t = blockTree(blocks, (id) => rows[id] || null);
  assert.deepEqual(t.kids.get('lead'), ['w:b1', 'w:b2'], '띄운 순서(자리와 상관없이)');
  assert.equal(t.parent.get('w:b1'), 'lead');
  assert.ok(!(t.parent.has('x') && t.parent.has('y')), '고리는 끊는다');
});

test('P75 상자 겹침 풀기: 아래로만 민다(옆으로 흩지 않는다), 같은 열의 순서를 지킨다', () => {
  const boxes = [1, 2, 3, 4, 5].map((i) => ({ key: `b${i}`, rect: R(1000, (i - 1) * 700, 800, 900) }));
  const sh = settleBoxes(boxes, [R(0, 0)]);
  const after = boxes.map((b) => { const s = sh.get(b.key) || { dx: 0, dy: 0 }; return { ...b.rect, x: b.rect.x + s.dx, y: b.rect.y + s.dy }; });
  for (const s of sh.values()) assert.equal(s.dx, 0, '옆으로 밀지 않는다');
  for (let i = 1; i < after.length; i++) { assert.ok(after[i].y > after[i - 1].y + after[i - 1].h, `순서 ${i}`); assert.equal(after[i].x, 1000); }
});

// ---------- 판 위에서(가짜 백엔드) ----------
function board({ wts = [] } = {}) {
  const b = new Backend({ quietMs: 600000, port: 0, logDir: tmp() });
  b.store = new Store(path.join(tmp(), 'board.db'));
  b.sessions = new Map();
  b.api = { broadcast: () => {} };
  b.log = () => {}; b.touch = () => {};
  b.broadcastWorkspaces = () => {};
  b.bus ??= new EventEmitter();
  const repo = 'C:/repo';
  const ws = { key: pathKey(`${repo}/.git`), root: normPath(repo) };
  b.store.insertWorkspace({ key: ws.key, kind: 'repo', root: ws.root, createdAt: 1 }); b.store.setWorkspaceAnchor(ws.key, 0, 0);
  const W = (n) => `${repo}/.claude/worktrees/${n}`;
  const state = { wts };
  const porcelain = () => [`worktree ${repo}`, 'HEAD 1', 'branch refs/heads/main', '', ...state.wts.flatMap((n) => [`worktree ${W(n)}`, 'HEAD 2', `branch refs/heads/worktree-${n}`, ''])].join('\n');
  b.worktrees = attachWorktrees(b, { tickMs: 0, list: async (root) => (normPath(root) === normPath(repo) ? porcelain() : null), exists: () => true });
  b.branch = new Branch(b);
  let clock = 1000;
  const add = (name, rect, extra = {}) => {
    const s = { sessionId: 'id-' + name, name, kind: 'claude', workspaceKey: ws.key, cwd: repo, rt: newRuntime({ kind: 'claude' }), origin: 'board', createdAt: clock++, ...extra };
    b.sessions.set(s.sessionId, s);
    b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    if (rect) b.store.setNode({ session_id: s.sessionId, ...rect, z: 0 });
    return s;
  };
  // backend.spawn의 하위 세션 자리와 같은 순서: placeChild → 노드 → 줄 밀기 → 영역 겹침 풀기
  const kid = (parent, name, { worktree = null } = {}) => {
    const at = b.branch.placeChild(parent.sessionId, ws.key, { worktree });
    assert.ok(at, `자리 ${name}`);
    const s = add(name, null, { parentSessionId: parent.sessionId });
    b.branch.noteChild(s.sessionId, { role: '워커', depth: 2, by: parent.sessionId, at: s.createdAt, order: b.branch.nextOrder(parent.sessionId), worktree });
    b.store.setNode({ session_id: s.sessionId, x: at.x, y: at.y, w: at.w, h: at.h, z: 0, size: at.size, aspect: at.aspect, area: at.area });
    ops.reflowLines(b, s.sessionId, 'spawn');
    ops.settleRegions(b, 'spawn');
    if (worktree) s.rt.cwd = W(worktree); // claude -w가 워크트리에서 뜬다(hook cwd)
    return s;
  };
  const key = (n) => areaKey(ws.key, pathKey(W(n)));
  return { b, ws, add, kid, state, W, key };
}
const nodeOf = (b, name) => b.store.nodes().find((n) => n.session_id === 'id-' + name);
const conflicts = (b) => [...regionConflicts(ops.regions(b), ops.canvasItems(b))];
const noOverlap = (rects, gap = 0) => { for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (overlaps(rects[i], rects[j], gap - 1)) return [i, j]; return null; };
const snap = (b) => JSON.stringify({ n: b.store.nodes().map((n) => [n.session_id, n.x, n.y, n.w, n.h]), a: b.store.worktreeAreas().map((a) => [a.wt, a.x, a.y]) });

test('P75 판: 한 부모에 워커 다섯이 한 열로 띄운 순서대로, 손자는 그 오른쪽 열. 부모 나무가 길어지면 뒤 형제가 아래로 밀린다', () => {
  const { b, add, kid } = board();
  const lead = add('lead', R(0, 0));
  const ws5 = [1, 2, 3, 4, 5].map((i) => kid(lead, `w${i}`));
  const rs = ws5.map((s) => nodeOf(b, s.name));
  assert.equal(new Set(rs.map((r) => r.x)).size, 1, '한 열');
  assert.equal(rs[0].x, NODE.w + LINE_GAP_X); assert.equal(rs[0].y, 0, '첫 워커는 부모 윗변');
  for (let i = 1; i < 5; i++) assert.equal(rs[i].y, rs[i - 1].y + KID.h + LINE_GAP_Y, `띄운 순서 ${i}`);
  // w2가 손자 둘을 띄운다: w2 오른쪽 열, w3 이후는 w2 나무 아래로
  const g = [kid(ws5[1], 'g1'), kid(ws5[1], 'g2')].map((s) => nodeOf(b, s.name));
  const w2 = nodeOf(b, 'w2');
  assert.deepEqual([g[0].x, g[0].y], [w2.x + w2.w + LINE_GAP_X, w2.y]);
  assert.deepEqual([g[1].x, g[1].y], [g[0].x, g[0].y + KID.h + LINE_GAP_Y]);
  const w3 = nodeOf(b, 'w3');
  assert.equal(w3.y, g[1].y + g[1].h + LINE_GAP_Y, 'w3은 w2 나무(손자 둘) 아래');
  assert.ok(nodeOf(b, 'w4').y > w3.y && nodeOf(b, 'w5').y > nodeOf(b, 'w4').y, '뒤 형제도 순서대로');
  assert.equal(noOverlap(b.store.nodes()), null, '겹치지 않는다');
  // 순서 번호: 같은 부모 안에서 1부터, 손자는 따로
  assert.deepEqual(ws5.map((s) => b.branch.summaryExtra(s).branch.order), [1, 2, 3, 4, 5]);
  assert.deepEqual(['g1', 'g2'].map((n) => b.branch.summaryExtra(b.sessions.get('id-' + n)).branch.order), [1, 2]);
});

for (const mode of ['after', 'each']) {
  test(`P75 판: 워크트리 워커 다섯의 상자가 같은 줄에서 순서를 지키고, 겹침 풀기 뒤에도 흩어지지 않는다(상자가 ${mode === 'after' ? '다 띄운 뒤' : '하나씩'} 생김)`, async () => {
    const { b, ws, add, kid, state, key } = board();
    const lead = add('lead', R(40, 112));
    const names = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const placed = {};
    for (const n of names) {
      kid(lead, n, { worktree: n });
      placed[n] = { ...nodeOf(b, n) };
      if (mode === 'each') { state.wts = names.slice(0, names.indexOf(n) + 1); await b.worktrees.sync('t'); }
    }
    state.wts = names;
    await b.worktrees.sync('t');
    const regs = ops.regions(b);
    const boxes = names.map((n) => regs.get(key(n)));
    for (const n of names) {
      const r = nodeOf(b, n);
      assert.equal(r.area, pathKey(`C:/repo/.claude/worktrees/${n}`), `${n}는 자기 상자`);
      assert.deepEqual([r.x, r.y], [placed[n].x, placed[n].y], `${n}는 놓인 자리 그대로(상자가 노드를 감싼다)`);
    }
    assert.equal(new Set(boxes.map((r) => r.x)).size, 1, '상자 다섯이 한 열');
    assert.equal(boxes[0].x, 40 + NODE.w + LINE_GAP_X, '부모 오른쪽 200');
    for (let i = 1; i < 5; i++) assert.ok(boxes[i].y >= boxes[i - 1].y + boxes[i - 1].h + LINE_GAP_Y, `상자 순서 ${i}`);
    assert.deepEqual(boxes[0], boxFrame(nodeOf(b, 'a1')));
    assert.deepEqual(conflicts(b), []);
    assert.deepEqual(ops.settleRegions(b, 'check'), [], '겹침 풀기가 할 일이 없다');
    // 한 번 더 동기화해도 그대로
    const s0 = snap(b);
    await b.worktrees.sync('t');
    assert.equal(snap(b), s0);
    // 상자가 생긴 뒤 띄운 여섯째도 줄 끝
    const a6 = kid(lead, 'a6', { worktree: 'a6' });
    state.wts = [...names, 'a6'];
    await b.worktrees.sync('t');
    const b6 = ops.regions(b).get(key('a6'));
    assert.equal(b6.x, boxes[0].x); assert.ok(b6.y > boxes[4].y + boxes[4].h, '줄 끝');
    assert.equal(b.branch.summaryExtra(a6).branch.order, 6);
    assert.ok(ws.key);
  });
}

test('P75 판: 워크트리 워커는 자기 워크트리가 생기기 전에는 부모의 폴더(다른 상자)로 옮겨지지 않는다', async () => {
  const { b, add, kid, state, key, W } = board({ wts: ['lead-wt'] });
  const lead = add('lead', R(40, 112), { cwd: W('lead-wt') });
  await b.worktrees.sync('t'); // 리드는 자기 워크트리 상자에
  assert.ok(ops.regions(b).has(key('lead-wt')));
  const w = kid(b.sessions.get(lead.sessionId), 'x1', { worktree: 'x1' });
  w.rt.cwd = null; w.cwd = W('lead-wt'); // 아직 claude -w 전: 부모의 워크트리 폴더
  const before = { ...nodeOf(b, 'x1') };
  await b.worktrees.sync('t');
  assert.deepEqual([nodeOf(b, 'x1').x, nodeOf(b, 'x1').y, nodeOf(b, 'x1').area], [before.x, before.y, ''], '부모 상자로 끌려가지 않는다');
  w.rt.cwd = W('x1'); state.wts = ['lead-wt', 'x1'];
  await b.worktrees.sync('t');
  assert.equal(nodeOf(b, 'x1').area, pathKey(W('x1')));
  assert.deepEqual([nodeOf(b, 'x1').x, nodeOf(b, 'x1').y], [before.x, before.y]);
  assert.deepEqual(conflicts(b), []);
});

test('P75 판: 붙여 묶은 워커 덩어리는 한 블록으로 줄에 서고, 다음 워커는 덩어리 아래', () => {
  const { b, add, kid } = board();
  const lead = add('lead', R(0, 0));
  for (const n of ['d1', 'd2', 'd3']) kid(lead, n);
  ops.dockWorkers(b, { lead: lead.sessionId });
  const d = b.store.docks()[0];
  const outer = ops.dockOuter(b, d);
  const t = ops.lineTree(b, lead.workspaceKey);
  assert.deepEqual(t.kids.get(lead.sessionId), [`d:${d.dockId}`], '덩어리는 한 블록');
  const d4 = nodeOf(b, kid(lead, 'd4').name);
  assert.equal(d4.x, outer.x, '같은 열');
  assert.equal(d4.y, outer.y + outer.h + LINE_GAP_Y, '덩어리 아래');
});

test('P75 정리: 흩어진 워커(상자 포함)를 부모 → 띄운 순서 줄 → 손자 줄로 놓고, 한 번 되돌린다', async () => {
  const { b, ws, add, kid, state, key } = board();
  const lead = add('lead', R(40, 112));
  const a = ['a1', 'a2', 'a3'].map((n) => kid(lead, n, { worktree: n }));
  const p1 = kid(lead, 'p1');
  const g = kid(b.sessions.get('id-p1'), 'g1');
  state.wts = ['a1', 'a2', 'a3'];
  await b.worktrees.sync('t');
  // 사람이 흩어 놓는다(상자는 끌어서, 노드는 그냥)
  ops.worktreeMove(b, { workspace: ws.key, worktree: pathKey('C:/repo/.claude/worktrees/a1'), dx: 9000, dy: 6000 });
  ops.worktreeMove(b, { workspace: ws.key, worktree: pathKey('C:/repo/.claude/worktrees/a3'), dx: 4000, dy: -3000 });
  b.store.setNode({ ...nodeOf(b, 'p1'), x: -5000, y: 9000 });
  ops.settleRegions(b, 't');
  const before = snap(b);
  const r = ops.arrange(b, { workspace: ws.key, apply: true });
  assert.ok(r.applied);
  const regs = ops.regions(b);
  const blocks = [regs.get(key('a1')), regs.get(key('a2')), regs.get(key('a3')), nodeOf(b, 'p1')];
  const L = nodeOf(b, 'lead');
  assert.equal(new Set(blocks.map((x) => x.x)).size, 1, '워커 줄 한 열');
  assert.equal(blocks[0].x, L.x + L.w + LINE_GAP_X);
  assert.equal(blocks[0].y, L.y, '첫 워커는 부모 윗변');
  for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i].y > blocks[i - 1].y + blocks[i - 1].h, `띄운 순서 ${i}`);
  const gn = nodeOf(b, 'g1'), pn = nodeOf(b, 'p1');
  assert.deepEqual([gn.x, gn.y], [pn.x + pn.w + LINE_GAP_X, pn.y], '손자는 그 오른쪽 열');
  assert.deepEqual(conflicts(b), []);
  // 정리 뒤 새 워커는 줄 끝(정리와 띄우기가 같은 규칙)
  const p2 = nodeOf(b, kid(lead, 'p2').name);
  assert.equal(p2.x, blocks[0].x);
  assert.equal(p2.y, Math.max(pn.y + pn.h, gn.y + gn.h) + LINE_GAP_Y);
  b.sessions.delete('id-p2'); b.store.deleteNode && b.store.deleteNode('id-p2');
  ops.arrange(b, { workspace: ws.key, undo: true });
  const back = JSON.parse(snap(b)); const was = JSON.parse(before);
  back.n = back.n.filter((x) => x[0] !== 'id-p2'); was.n = was.n.filter((x) => x[0] !== 'id-p2');
  assert.deepEqual(back, was, '한 번 되돌리면 그대로');
  assert.throws(() => ops.arrange(b, { workspace: ws.key, undo: true }), (e) => e.code === 'not_found', '되돌리기는 한 번');
  assert.ok(a.length && g);
});

test('P75 크기: 줄의 노드를 키우면 뒤 형제(그 나무째)가 아래로 밀리고, 줄이면 당기지 않는다', () => {
  const { b, add, kid } = board();
  const lead = add('lead', R(0, 0));
  ['k1', 'k2', 'k3'].forEach((n) => kid(lead, n));
  const g = kid(b.sessions.get('id-k3'), 'k3g');
  const y3 = nodeOf(b, 'k3').y, yg = nodeOf(b, 'k3g').y;
  ops.setSize(b, { session: 'id-k1', size: 'wide-large' });
  const k1 = nodeOf(b, 'k1'), k2 = nodeOf(b, 'k2');
  assert.equal(k1.h, SIZE_STEPS['wide-large'].h);
  assert.equal(k2.y, k1.y + k1.h + LINE_GAP_Y, 'k2가 밀렸다');
  const dy = nodeOf(b, 'k3').y - y3;
  assert.ok(dy > 0);
  assert.equal(nodeOf(b, 'k3g').y - yg, dy, '손자도 함께');
  assert.equal(noOverlap(b.store.nodes()), null);
  // 작게: 아무것도 당기지 않는다
  const s0 = JSON.stringify(b.store.nodes().filter((n) => n.session_id !== 'id-k1').map((n) => [n.session_id, n.x, n.y]));
  ops.setSize(b, { session: 'id-k1', size: 'wide-small' });
  assert.equal(JSON.stringify(b.store.nodes().filter((n) => n.session_id !== 'id-k1').map((n) => [n.session_id, n.x, n.y])), s0);
  assert.ok(g);
});

test('P75 크기: 워크트리 상자 안의 워커를 키우면 뒤 상자가 같은 열에서 아래로', async () => {
  const { b, add, kid, state, key } = board();
  const lead = add('lead', R(40, 112));
  ['b1', 'b2', 'b3'].forEach((n) => kid(lead, n, { worktree: n }));
  state.wts = ['b1', 'b2', 'b3'];
  await b.worktrees.sync('t');
  const x0 = ops.regions(b).get(key('b2')).x;
  ops.setSize(b, { session: 'id-b1', size: 'wide-large' });
  const regs = ops.regions(b);
  const [r1, r2, r3] = ['b1', 'b2', 'b3'].map((n) => regs.get(key(n)));
  assert.deepEqual([r2.x, r3.x], [x0, x0], '옆으로 가지 않는다');
  assert.ok(r2.y >= r1.y + r1.h + LINE_GAP_Y && r3.y > r2.y + r2.h, '순서대로 아래로');
  assert.deepEqual(conflicts(b), []);
});

test('P75 순서 번호: 닫힌 형제의 번호를 다시 쓰지 않고, P75 전 기록은 띄운 때 차례', () => {
  const { b, add, kid } = board();
  const lead = add('lead', R(0, 0));
  const k = ['o1', 'o2', 'o3'].map((n) => kid(lead, n));
  b.sessions.delete(k[1].sessionId); // 닫힘(기록은 남는다)
  const o4 = kid(lead, 'o4');
  assert.equal(b.branch.summaryExtra(o4).branch.order, 4);
  // 옛 기록(order 없음)
  const old = add('old', R(0, 20000));
  for (const [n, at] of [['q2', 20], ['q1', 10]]) { const s = add(n, R(2000, 20000 + at * 100), { parentSessionId: old.sessionId }); b.branch.noteChild(s.sessionId, { role: '워커', by: old.sessionId, at }); }
  assert.deepEqual(['q1', 'q2'].map((n) => b.branch.summaryExtra(b.sessions.get('id-' + n)).branch.order), [1, 2]);
  const q3 = kid(old, 'q3');
  assert.equal(b.branch.summaryExtra(q3).branch.order, 3);
});

test('P75 이미 있는 판: 정리나 새 워커 전에는 옛 자리(격자로 접힌 열, 흩어진 상자) 그대로', async () => {
  const { b, add, state, W, key } = board({ wts: ['z1', 'z2'] });
  const lead = add('lead', R(40, 112));
  // P75 전 배치: 두 열로 접힌 형제, 옆으로 흩어진 상자
  const old = [R(960, 112, 480, 300), R(960, 452, 480, 300), R(1480, 112, 480, 300), R(1480, 452, 480, 300)];
  old.forEach((r, i) => { const s = add(`o${i}`, r, { parentSessionId: lead.sessionId }); b.branch.noteChild(s.sessionId, { role: '워커', by: lead.sessionId, at: i + 1 }); });
  b.store.putWorktreeArea({ wsKey: lead.workspaceKey, wt: pathKey(W('z1')), path: W('z1'), branch: 'worktree-z1', x: 40, y: 900 });
  b.store.putWorktreeArea({ wsKey: lead.workspaceKey, wt: pathKey(W('z2')), path: W('z2'), branch: 'worktree-z2', x: 2400, y: 112 });
  const z1 = add('z1s', null, { parentSessionId: lead.sessionId, cwd: W('z1') }); b.store.setNode({ session_id: z1.sessionId, x: 80, y: 1012, w: 480, h: 300, z: 0, area: pathKey(W('z1')) });
  b.branch.noteChild(z1.sessionId, { role: '워커', by: lead.sessionId, at: 9, worktree: 'z1' });
  ops.settleRegions(b, 'start');
  const s0 = snap(b);
  await b.worktrees.sync('t');
  ops.settleRegions(b, 'start');
  assert.equal(snap(b), s0, '자리가 그대로');
  assert.ok(state.wts.length && key('z1'));
});
