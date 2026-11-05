// P31 시험: 판 전체 정리의 영역 배치(region-layout.mjs layoutRegions), 판 전체 정리와 되돌리기(board.arrange { all })
// P35: 워크트리 위성 열과 화살표 크기 시험은 뺐다. 상자는 리포 영역 안에서 함께 움직인다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NODE, overlaps, bbox, REGION_GAP } from '../src/canvas.mjs';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { Backend } from '../src/backend.mjs';
import * as ops from '../src/canvas-ops.mjs';
import { pathKey, normPath } from '../src/workspaces.mjs';
import { attachWorktrees } from '../src/worktrees.mjs';
import { areaKey, isBoxKey } from '../src/worktree-areas.mjs';
import { layoutRegions } from '../src/region-layout.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p31u-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });
const pairs = (rects, gap = -1) => { const l = [...rects]; const out = []; for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (overlaps(l[i][1], l[j][1], gap)) out.push(`${l[i][0]}|${l[j][0]}`); return out; };

// ---------- 순수 함수 ----------
test('P31 영역 배치: 흩어진 묶음을 겹치지 않게 줄 맞춰, 사이는 REGION_GAP, 읽는 순서를 지킨다', () => {
  const entries = [
    { key: 'a', ws: 'a', wt: '', rect: R(0, 0, 1000, 600) },
    { key: 'b', ws: 'b', wt: '', rect: R(9000, 200, 800, 500) },
    { key: 'c', ws: 'c', wt: '', rect: R(-3000, 7000, 1200, 900) },
    { key: 'd', ws: 'd', wt: '', rect: R(500, 400, 700, 400) }, // a와 겹친다
  ];
  const { rects, shifts, groups } = layoutRegions(entries);
  assert.deepEqual(pairs(rects, REGION_GAP - 1), [], '어느 둘도 REGION_GAP 안으로 붙지 않는다');
  assert.equal(groups.map((g) => g.ws).join(','), 'a,b,d,c', '지금 위에서 아래, 왼쪽에서 오른쪽 순서');
  const all = bbox([...rects.values()]);
  const before = bbox(entries.map((e) => e.rect));
  assert.deepEqual([all.x, all.y], [before.x, before.y], '시작점은 지금 모든 영역의 왼쪽 위');
  assert.ok(all.w * all.h < before.w * before.h / 4, `덜 흩어진다 ${JSON.stringify(all)}`);
  assert.ok(all.w / all.h < 4 && all.h / all.w < 4, '한 줄이나 한 열로 길게 늘어놓지 않는다');
  // 같은 줄은 위가 맞고 사이가 REGION_GAP
  const first = groups[0].rect, second = groups[1].rect;
  assert.equal(second.y, first.y);
  assert.equal(second.x - (first.x + first.w), REGION_GAP);
  // 크기는 그대로, 옮김 값은 새 자리 - 지금 자리
  for (const e of entries) { const r = rects.get(e.key); assert.deepEqual([r.w, r.h], [e.rect.w, e.rect.h]); const s = shifts.get(e.key) || { dx: 0, dy: 0 }; assert.deepEqual([e.rect.x + s.dx, e.rect.y + s.dy], [r.x, r.y]); }
  // 다시 돌려도 같은 자리(이미 가지런하면 옮길 것이 없다)
  const again = layoutRegions(entries.map((e) => ({ ...e, rect: rects.get(e.key) })));
  assert.equal(again.shifts.size, 0, JSON.stringify([...again.shifts]));
  assert.deepEqual(layoutRegions([]).shifts.size, 0);
});

test('P31 영역 배치: 빈 영역은 안이 있는 영역 뒤, 소속 없는 메모는 맨 뒤(P35: 위성 열 없음, 영역 하나가 한 묶음)', () => {
  const entries = [
    { key: 'r', ws: 'r', rect: R(0, 0, 1600, 1200) },
    { key: 'e', ws: 'e', rect: R(-500, -500, 800, 320), empty: true },
    { key: 'f', ws: 'f', rect: R(4000, 0, 900, 700) },
    { key: 'memo:m', ws: null, rect: R(-2000, -2000, 360, 240) },
  ];
  const { rects, groups } = layoutRegions(entries);
  assert.deepEqual(pairs(rects), [], '겹치지 않는다');
  assert.deepEqual(groups.map((g) => g.ws), ['r', 'f', 'e', null], '안이 있는 묶음 → 빈 영역 → 소속 없는 메모');
  assert.deepEqual(groups.map((g) => g.keys), [['r'], ['f'], ['e'], ['memo:m']]);
});

// ---------- 판 위에서(가짜 백엔드) ----------
function board() {
  const b = new Backend({ quietMs: 600000, port: 0, logDir: tmp() });
  b.store = new Store(path.join(tmp(), 'board.db'));
  b.sessions = new Map();
  b.api = { broadcast: () => {} };
  b.log = () => {}; b.touch = () => {};
  b.broadcastWorkspaces = () => {};
  const mk = (key, kind, root, x, y) => { b.store.insertWorkspace({ key, kind, root, createdAt: 1 }); b.store.setWorkspaceAnchor(key, x, y); };
  const repo = 'C:/repo', W1 = 'C:/repo/.claude/worktrees/p1';
  const ws = { key: pathKey(`${repo}/.git`), root: normPath(repo) };
  mk(ws.key, 'repo', ws.root, 0, 0);
  mk('c:/b', 'folder', 'C:/b', 12000, -4000);
  mk('c:/c', 'folder', 'C:/c', -6000, 9000);
  const state = { wts: [{ path: W1, branch: 'worktree-p1' }] };
  const porcelain = () => [`worktree ${repo}`, 'HEAD 1', 'branch refs/heads/main', '', `worktree ${W1}`, 'HEAD 2', 'branch refs/heads/worktree-p1', ''].join('\n');
  b.worktrees = attachWorktrees(b, { tickMs: 0, list: async (root) => (normPath(root) === normPath(repo) ? porcelain() : null), exists: () => true });
  const add = (name, wsKey, cwd, rect) => {
    const s = { sessionId: 'id-' + name, name, kind: 'shell', workspaceKey: wsKey, cwd, rt: newRuntime({ kind: 'shell', hooked: false }), origin: 'board', createdAt: Date.now() };
    b.sessions.set(s.sessionId, s);
    b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    b.store.setNode({ session_id: s.sessionId, ...rect, z: 0 });
  };
  return { b, ws, add, W1, state };
}
const snap = (b) => JSON.stringify({ n: b.store.nodes().map((n) => [n.session_id, n.x, n.y, n.w, n.h]), w: b.store.workspaces().map((w) => [w.key, w.x, w.y]), a: b.store.worktreeAreas().map((a) => [a.wt, a.x, a.y]), m: b.store.memos().map((m) => [m.memoId, m.x, m.y]) });

test('P31 판 전체 정리(P35 상자): 흩어진 영역 셋이 겹치지 않게 가지런히, 워크트리 상자는 리포 영역 안의 한 블록, 되돌리면 정리 전 그대로', async () => {
  const { b, ws, add, W1 } = board();
  add('a1', ws.key, 'C:/repo', R(40, 112));
  add('a2', ws.key, 'C:/repo', R(3000, 2000));
  add('w1', ws.key, W1, R(40, 112));
  await b.worktrees.sync('t'); // w1은 워크트리 영역으로
  // 사람이 상자를 멀리 끌어 둔다(리포 영역이 그만큼 커진다)
  ops.worktreeMove(b, { workspace: ws.key, worktree: pathKey(W1), dx: -9000, dy: 3000 });
  add('b1', 'c:/b', 'C:/b', R(12040, -3888));
  add('c1', 'c:/c', 'C:/c', R(-5960, 9112));
  b.store.insertMemo && b.store.insertMemo({ memoId: 'm1', workspaceKey: null, x: 20000, y: 20000, w: 360, h: 240, text: 'x', createdAt: 1 });
  ops.settleRegions(b, 't');
  const before = snap(b);
  const regsBefore = ops.regions(b);
  const preview = ops.arrange(b, { all: true });
  assert.equal(preview.applied, false);
  assert.equal(snap(b), before, '미리 보기는 아무것도 바꾸지 않는다');
  const r = ops.arrange(b, { all: true, apply: true });
  assert.equal(r.applied, true);
  const regs = ops.regions(b);
  assert.equal(regs.size, regsBefore.size);
  const top = (m) => new Map([...m].filter(([k]) => !isBoxKey(k)));
  assert.deepEqual(pairs(top(regs), REGION_GAP / 2 - 1), [], '맨 위 영역끼리 겹치지 않고 띄운다');
  const k1 = areaKey(ws.key, pathKey(W1));
  const main = regs.get(ws.key), sat = regs.get(k1);
  assert.ok(sat.x >= main.x && sat.y >= main.y && sat.x + sat.w <= main.x + main.w && sat.y + sat.h <= main.y + main.h, `상자는 리포 영역 안 ${JSON.stringify([main, sat])}`);
  for (const n of b.store.nodes().filter((x) => x.session_id !== 'id-w1' && x.workspace_key === ws.key)) assert.ok(!overlaps(n, sat, -1), '상자는 본 저장소 쪽 노드와 겹치지 않는다');
  assert.ok(sat.w * sat.h < main.w * main.h, '리포 영역이 다시 줄었다');
  const nb = bbox([...regsBefore.values()]), na = bbox([...regs.values()]);
  assert.ok(na.w * na.h < nb.w * nb.h / 4, '덜 흩어진다');
  // 안의 것은 영역 안에 남는다(워크트리 셸은 상자 안)
  const w1 = b.store.nodes().find((n) => n.session_id === 'id-w1');
  assert.ok(w1.x >= sat.x && w1.x + w1.w <= sat.x + sat.w);
  // 영역 겹침 풀기가 더 할 일이 없다
  assert.deepEqual(ops.settleRegions(b, 'check'), []);
  // 되돌리기: 판 전체가 정리 전으로
  ops.arrange(b, { all: true, undo: true });
  assert.equal(snap(b), before);
  assert.throws(() => ops.arrange(b, { all: true, undo: true }), (e) => e.code === 'not_found', '되돌리기는 한 번');
});

test('P31 판 전체 정리 뒤 워크스페이스 하나 정리를 하면 판 전체 되돌리기는 지운다(맞지 않는 자리로 돌아가지 않게), 그 반대도', () => {
  const { b, ws, add } = board();
  add('a1', ws.key, 'C:/repo', R(40, 112));
  add('b1', 'c:/b', 'C:/b', R(12040, -3888));
  ops.arrange(b, { workspace: ws.key, apply: true });
  ops.arrange(b, { all: true, apply: true });
  assert.throws(() => ops.arrange(b, { workspace: ws.key, undo: true }), (e) => e.code === 'not_found');
  ops.arrange(b, { workspace: ws.key, apply: true });
  assert.throws(() => ops.arrange(b, { all: true, undo: true }), (e) => e.code === 'not_found');
  ops.arrange(b, { workspace: ws.key, undo: true });
});
