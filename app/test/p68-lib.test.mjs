// P68 시험: 워크트리끼리 붙인 창 그룹의 칸 머리 브랜치(lib/dock-branch.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { dockBranchOf } from '../src/renderer/lib/dock-branch.js';

const WS = 'c:/repo/.git';
const st = (docks, nodes) => ({
  workspaces: [{ key: WS, worktrees: [{ wt: 'c:/repo/.claude/worktrees/p1', branch: 'worktree-p1', path: 'C:/repo/.claude/worktrees/p1' }, { wt: 'c:/repo/.claude/worktrees/p2', branch: null, path: 'C:/repo/.claude/worktrees/p2' }] }],
  sessions: new Map([
    ['m', { sessionId: 'm', workspaceKey: WS, git: { isRepo: true, branch: 'main' } }],
    ['a', { sessionId: 'a', workspaceKey: WS, git: { isRepo: true, branch: 'feature/dark-mode' } }],
    ['b', { sessionId: 'b', workspaceKey: WS, git: null }],
    ['a2', { sessionId: 'a2', workspaceKey: WS, git: { isRepo: true, branch: 'worktree-p1' } }],
  ]),
  nodes: new Map(nodes.map(([id, area]) => [id, { x: 0, y: 0, w: 10, h: 10, area }])),
  docks: new Map(docks.map((m, i) => [`d${i}`, { dockId: `d${i}`, members: m }])),
});

test('P68 칸 브랜치: 같은 리포의 다른 영역이 섞인 덩어리에서만, 워크트리 칸은 wt', () => {
  const s = st([['m', 'a', 'b']], [['m', ''], ['a', 'c:/repo/.claude/worktrees/p1'], ['b', 'c:/repo/.claude/worktrees/p2']]);
  assert.equal(dockBranchOf(s, 'm'), 'main\tmain');
  assert.equal(dockBranchOf(s, 'a'), 'wt\tfeature/dark-mode', '세션의 git 브랜치가 먼저');
  assert.equal(dockBranchOf(s, 'b'), 'wt\tp2', 'git이 없으면 상자의 브랜치(없으면 폴더 이름)');
});

test('P68 칸 브랜치: 혼자인 노드, 한 상자 안의 덩어리, 본 저장소끼리의 덩어리는 보이지 않는다', () => {
  const s = st([['a', 'a2'], ['m', 'x']], [['m', ''], ['x', ''], ['a', 'c:/repo/.claude/worktrees/p1'], ['a2', 'c:/repo/.claude/worktrees/p1'], ['b', '']]);
  s.sessions.set('x', { sessionId: 'x', workspaceKey: WS });
  for (const id of ['a', 'a2', 'm', 'x', 'b']) assert.equal(dockBranchOf(s, id), '', id);
  // 지워진 워크트리(행이 없다)의 area는 본 저장소로 본다
  const gone = st([['m', 'a']], [['m', ''], ['a', 'c:/repo/.claude/worktrees/gone']]);
  assert.equal(dockBranchOf(gone, 'a'), '');
});
