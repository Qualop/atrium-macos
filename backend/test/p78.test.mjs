// P78 시험: 워크트리 워커의 띄움 → 정리 → 인계 뒤에도 줄이 그대로(P75 후속).
// 요청 없이 띄운 --worktree 워커도 워크트리가 생기는 대로 상자에 들고(hook을 기다리지 않는다), 정리는 아직 상자가 없는 워커에 상자 틀만큼 자리를 잡고,
// 인계(hook cwd가 워크트리로 바뀜) 뒤에도 자리와 순서가 그대로. 사람이 옮긴 노드와 상자는 다시 옮기지 않고, P78 전에 띄운 워커는 지금처럼 hook을 기다린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { NODE, overlaps, arrangeTree } from '../src/canvas.mjs';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { Backend } from '../src/backend.mjs';
import * as ops from '../src/canvas-ops.mjs';
import { Branch } from '../src/branch.mjs';
import { pathKey, normPath } from '../src/workspaces.mjs';
import { attachWorktrees } from '../src/worktrees.mjs';
import { areaKey, regionConflicts } from '../src/worktree-areas.mjs';
import { boxFrame, BOX_PAD, LINE_GAP_X, LINE_GAP_Y } from '../src/tree-line.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p78-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });

// 가짜 백엔드(p75.test.mjs와 같은 꼴). kid의 hook: true면 claude -w의 hook cwd를 바로 준다(첫 요청을 받은 워커), 아니면 시작 폴더 그대로
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
  const kid = (parent, name, { worktree = null, hook = false, wtHome = 1 } = {}) => {
    const at = b.branch.placeChild(parent.sessionId, ws.key, { worktree });
    const s = add(name, null, { parentSessionId: parent.sessionId });
    b.branch.noteChild(s.sessionId, { role: '워커', depth: 2, by: parent.sessionId, at: s.createdAt, order: b.branch.nextOrder(parent.sessionId), worktree, ...(worktree && wtHome ? { wtHome } : {}) });
    b.store.setNode({ session_id: s.sessionId, x: at.x, y: at.y, w: at.w, h: at.h, z: 0, size: at.size, aspect: at.aspect, area: at.area });
    ops.reflowLines(b, s.sessionId, 'spawn');
    ops.settleRegions(b, 'spawn');
    if (worktree && hook) s.rt.cwd = W(worktree);
    return s;
  };
  const key = (n) => areaKey(ws.key, pathKey(W(n)));
  return { b, ws, add, kid, state, W, key, repo };
}
const nodeOf = (b, name) => b.store.nodes().find((n) => n.session_id === 'id-' + name);
const conflicts = (b) => [...regionConflicts(ops.regions(b), ops.canvasItems(b))];
const noOverlap = (rects, gap = 0) => { for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (overlaps(rects[i], rects[j], gap - 1)) return [i, j]; return null; };
const xy = (r) => [r.x, r.y];
const events = (b, kind) => b.store.db.prepare('select data from events where kind = ?').all(kind).map((r) => JSON.parse(r.data));

test('P78 정리: 아직 상자가 없는 블록(pad)은 테두리까지 줄을 차지하고 블록은 그 안에, 자식 열은 테두리 오른쪽', () => {
  const blocks = [
    { id: 'p', x: 0, y: 0, w: 400, h: 300, members: ['p'], resizable: false },
    { id: 'a', x: 0, y: 0, w: 400, h: 300, members: ['a'], resizable: false, pad: BOX_PAD },
    { id: 'b', x: 0, y: 0, w: 400, h: 300, members: ['b'], resizable: false },
    { id: 'g', x: 0, y: 0, w: 400, h: 300, members: ['g'], resizable: false },
  ];
  const out = arrangeTree(blocks, [['p', 'a'], ['p', 'b'], ['a', 'g']], { origin: { x: 0, y: 0 }, rank: new Map([['a', 1], ['b', 2]]) });
  const a = out.get('a'), b = out.get('b'), g = out.get('g');
  const fa = boxFrame(a);
  assert.deepEqual(xy(fa), [400 + LINE_GAP_X, 0], '상자 틀이 줄의 자리(부모 오른쪽 200, 부모 윗변)');
  assert.equal(b.x, fa.x, 'b는 같은 열(틀 왼쪽)');
  assert.equal(b.y, fa.y + fa.h + LINE_GAP_Y, 'b는 틀 아래');
  assert.equal(g.x, fa.x + fa.w + LINE_GAP_X, '손자는 틀 오른쪽');
});

test('P78 판: 요청 없이 띄운 --worktree 워커도 워크트리가 생기는 대로 자기 상자에 들고, 상자는 그 자리에 선다(빈 상자 없음)', async () => {
  const { b, add, kid, state, key, W } = board();
  const lead = add('lead', R(40, 112));
  const names = ['n1', 'n2', 'n3'];
  const placed = {};
  for (const n of names) { kid(lead, n, { worktree: n }); placed[n] = { ...nodeOf(b, n) }; }
  state.wts = names;
  await b.worktrees.sync('t');
  const regs = ops.regions(b);
  for (const n of names) {
    assert.equal(nodeOf(b, n).area, pathKey(W(n)), `${n}는 hook 전에도 자기 상자`);
    assert.deepEqual(xy(nodeOf(b, n)), xy(placed[n]), `${n}는 제자리`);
    assert.deepEqual(regs.get(key(n)), boxFrame(nodeOf(b, n)), `${n} 상자는 노드 둘레`);
  }
  assert.equal(new Set(names.map((n) => regs.get(key(n)).x)).size, 1, '상자 한 열');
  assert.deepEqual(conflicts(b), []);
  assert.deepEqual(events(b, 'line_pushed'), [], '상자가 생겨도 뒤 형제를 밀 일이 없다(띄울 때 틀만큼 비웠다)');
  // 첫 요청(인계)으로 hook이 같은 워크트리를 알려도 그대로
  const s0 = JSON.stringify(b.store.nodes().map((n) => [n.session_id, n.x, n.y, n.area]));
  for (const n of names) b.sessions.get('id-' + n).rt.cwd = W(n);
  await b.worktrees.sync('t');
  assert.equal(JSON.stringify(b.store.nodes().map((n) => [n.session_id, n.x, n.y, n.area])), s0);
});

for (const mix of ['none', 'some']) {
  test(`P78 정리 → 인계: 정리한 뒤 일을 넘겨 상자가 생겨도 정리한 자리와 띄운 순서 그대로(상자가 ${mix === 'none' ? '하나도 없을 때' : '일부만 있을 때'} 정리)`, async () => {
    const { b, ws, add, kid, state, key, W } = board();
    const lead = add('lead', R(40, 112));
    const names = ['h1', 'h2', 'h3', 'h4'];
    for (const n of names) kid(lead, n, { worktree: n });
    const shell = kid(lead, 'sh'); // 상자 없는 형제(셸)도 줄에
    if (mix === 'some') { state.wts = ['h1', 'h3']; await b.worktrees.sync('t'); }
    // 사람이 흩어 놓은 뒤 정리한다
    b.store.setNode({ ...nodeOf(b, 'h4'), x: -4000, y: 7000 });
    b.store.setNode({ ...nodeOf(b, 'sh'), x: 6000, y: -900 });
    ops.settleRegions(b, 't');
    assert.ok(ops.arrange(b, { workspace: ws.key, apply: true }).applied);
    const regs0 = ops.regions(b);
    const blockOf = (n) => (nodeOf(b, n).area ? ops.regions(b).get(key(n)) : (n === 'sh' ? nodeOf(b, n) : boxFrame(nodeOf(b, n))));
    const arranged = Object.fromEntries([...names, 'sh'].map((n) => [n, { ...blockOf(n) }]));
    const L = nodeOf(b, 'lead');
    assert.equal(arranged.h1.x, L.x + L.w + LINE_GAP_X, '줄은 부모 오른쪽 200(상자 틀 기준)');
    // P91: 다섯부터는 다음 열을 오른쪽에 연다. 띄운 순서는 위 → 아래, 다음 열
    for (const [i, n] of [...names, 'sh'].entries()) if (i) { const p = arranged[[...names, 'sh'][i - 1]]; assert.ok(arranged[n].y >= p.y + p.h + LINE_GAP_Y || arranged[n].x >= p.x + p.w + LINE_GAP_X, `띄운 순서 ${n}`); }
    assert.ok(regs0);
    // 인계: 워크트리가 다 생기고, 리드가 일을 넘겨 hook이 워크트리를 알린다(h2는 요청이 없어 hook이 없다)
    state.wts = names;
    for (const n of ['h1', 'h3', 'h4']) b.sessions.get('id-' + n).rt.cwd = W(n);
    await b.worktrees.sync('t');
    for (const n of names) {
      assert.equal(nodeOf(b, n).area, pathKey(W(n)), `${n}는 자기 상자`);
      assert.deepEqual(ops.regions(b).get(key(n)), arranged[n], `${n} 상자는 정리한 자리(틀) 그대로`);
    }
    assert.deepEqual(xy(nodeOf(b, 'sh')), xy(arranged.sh), '셸도 그대로');
    assert.deepEqual(events(b, 'line_pushed'), [], '밀린 형제가 없다');
    assert.deepEqual(conflicts(b), []);
    assert.equal(noOverlap([...names.map((n) => ops.regions(b).get(key(n))), nodeOf(b, 'sh'), nodeOf(b, 'lead')]), null);
    assert.ok(shell);
  });
}

test('P78 사람이 옮긴 것: 상자가 생기기 전에 옮긴 워커는 그 자리에서 상자를 받고, 사람이 옮긴 상자는 다시 옮기지 않는다', async () => {
  const { b, ws, add, kid, state, key, W } = board();
  const lead = add('lead', R(40, 112));
  kid(lead, 'm1', { worktree: 'm1' });
  kid(lead, 'm2', { worktree: 'm2' });
  b.store.setNode({ ...nodeOf(b, 'm1'), x: 5000, y: 5000 }); // 사람이 끌어 둔 자리
  const moved = { ...nodeOf(b, 'm1') };
  state.wts = ['m1', 'm2'];
  await b.worktrees.sync('t');
  assert.deepEqual(xy(nodeOf(b, 'm1')), xy(moved), '옮긴 자리 그대로');
  assert.deepEqual(ops.regions(b).get(key('m1')), boxFrame(moved), '상자가 그 자리에');
  // 사람이 m2 상자를 옮긴 뒤에는 동기화와 hook이 그 상자를 되돌리지 않는다
  ops.worktreeMove(b, { workspace: ws.key, worktree: pathKey(W('m2')), dx: 3000, dy: 2000 });
  const box2 = { ...ops.regions(b).get(key('m2')) };
  b.sessions.get('id-m2').rt.cwd = W('m2');
  await b.worktrees.sync('t');
  await b.worktrees.sync('t');
  assert.deepEqual(ops.regions(b).get(key('m2')), box2);
});

test('P78 hook이 워크트리를 떠났다고 알리면(본 저장소) 상자에서 나온다. P78 전에 띄운 워커(wtHome 없음)는 지금처럼 hook을 기다린다', async () => {
  const { b, add, kid, state, W, repo } = board();
  const lead = add('lead', R(40, 112));
  const e = kid(lead, 'e1', { worktree: 'e1' });
  const old = kid(lead, 'o1', { worktree: 'o1', wtHome: 0 });
  state.wts = ['e1', 'o1'];
  await b.worktrees.sync('t');
  assert.equal(nodeOf(b, 'e1').area, pathKey(W('e1')));
  assert.equal(nodeOf(b, 'o1').area, '', 'P78 전 기록은 hook 전에는 옮기지 않는다(이미 있는 판 그대로)');
  e.rt.cwd = W('e1'); await b.worktrees.sync('t');
  e.rt.cwd = repo; await b.worktrees.sync('t');
  assert.equal(nodeOf(b, 'e1').area, '', '워크트리를 떠났다(hook)');
  old.rt.cwd = W('o1'); await b.worktrees.sync('t');
  assert.equal(nodeOf(b, 'o1').area, pathKey(W('o1')), 'hook이 알리면 든다(P75와 같다)');
});
