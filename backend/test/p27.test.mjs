// P27 시험: 워크트리 영역 — 목록 읽기, 워크트리 판정, 이름표 글, 판 위 동기화(노드·대화 노드를 그 영역에, 함께 옮기기, 지우면 사라짐, 다시 켜도 같은 자리)
// P35: 워크트리 영역은 리포 영역 안의 상자다. 화살표와 위성 자리(areaSlot) 시험은 뺐고, 상자 자리·감싸기·겹침 풀기·옮기기는 p35.test.mjs에 있다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { NODE } from '../src/canvas.mjs';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { Backend } from '../src/backend.mjs';
import * as ops from '../src/canvas-ops.mjs';
import { Recall } from '../src/recall.mjs';
import { DEFAULTS } from '../src/settings.mjs';
import { pathKey, normPath } from '../src/workspaces.mjs';
import { attachWorktrees } from '../src/worktrees.mjs';
import { parseWorktreeList, liveWorktrees, worktreeOfPath, areaKey, parseArea, wsOfArea, worktreeLabel, areaAnchorList, areaResolverOf, regionConflicts, WT_EMPTY } from '../src/worktree-areas.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p27u-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });
const conflicts = (b) => [...regionConflicts(ops.regions(b), ops.canvasItems(b))]; // P35: 리포 영역과 그 안의 상자는 겹침이 아니다
const inside = (r, q) => r.x >= q.x && r.y >= q.y && r.x + r.w <= q.x + q.w && r.y + r.h <= q.y + q.h;

const PORCELAIN = (main, wts) => [`worktree ${main}`, 'HEAD 1111111111111111111111111111111111111111', 'branch refs/heads/main', '', ...wts.flatMap((w) => [`worktree ${w.path}`, `HEAD ${w.head || '2222222222222222222222222222222222222222'}`, w.branch ? `branch refs/heads/${w.branch}` : 'detached', ...(w.prunable ? ['prunable gitdir file points to non-existent location'] : []), ''])].join('\n');

// ---------- 순수 함수 ----------
test('P27 목록: git worktree list --porcelain을 읽고, 본 저장소·맨 저장소·지워진(prunable)·폴더 없는 것은 영역을 두지 않는다', () => {
  const out = PORCELAIN('C:/repo', [{ path: 'C:/repo/.claude/worktrees/p1', branch: 'worktree-p1' }, { path: 'C:/elsewhere/feat', branch: 'feat/x' }, { path: 'C:/gone/old', branch: 'old', prunable: true }, { path: 'C:/det', head: 'abcdef0123456789' }]);
  const list = parseWorktreeList(out);
  assert.deepEqual(list.map((w) => [w.path, w.branch, w.main]), [['C:/repo', 'main', true], ['C:/repo/.claude/worktrees/p1', 'worktree-p1', false], ['C:/elsewhere/feat', 'feat/x', false], ['C:/gone/old', 'old', false], ['C:/det', null, false]]);
  assert.equal(list[3].prunable, true); assert.equal(list[4].detached, true);
  assert.equal(list[1].key, 'c:/repo/.claude/worktrees/p1');
  const live = liveWorktrees(list, (p) => p !== 'C:/elsewhere/feat');
  assert.deepEqual(live.map((w) => w.path), ['C:/repo/.claude/worktrees/p1', 'C:/det'], '본 저장소, prunable, 폴더 없는 것은 뺀다');
  // 역슬래시 경로와 CRLF
  const win = parseWorktreeList('worktree C:\\r\r\nHEAD a\r\nbranch refs/heads/main\r\n\r\nworktree C:\\r\\wt\\x\r\nHEAD b\r\nbranch refs/heads/x\r\n');
  assert.deepEqual(win.map((w) => w.key), ['c:/r', 'c:/r/wt/x']);
  assert.deepEqual(parseWorktreeList(''), []);
});

test('P27 판정: 폴더가 든 워크트리(가장 긴 경로가 이긴다, 본 저장소 안의 .claude/worktrees도 워크트리 쪽). 밖이면 본 저장소', () => {
  const wts = [{ key: 'c:/repo/.claude/worktrees/p1' }, { key: 'c:/repo/.claude/worktrees/p10' }, { key: 'c:/elsewhere/feat' }];
  assert.equal(worktreeOfPath('C:\\Repo\\.claude\\worktrees\\p1\\backend', wts, 'c:/repo'), 'c:/repo/.claude/worktrees/p1');
  assert.equal(worktreeOfPath('C:/repo/.claude/worktrees/p10', wts, 'c:/repo'), 'c:/repo/.claude/worktrees/p10', 'p1이 p10의 앞부분이어도 섞이지 않는다');
  assert.equal(worktreeOfPath('C:/repo/backend', wts, 'c:/repo'), '');
  assert.equal(worktreeOfPath('C:/elsewhere/feat/src', wts, 'c:/repo'), 'c:/elsewhere/feat');
  assert.equal(worktreeOfPath('C:/repo/.claude/worktrees/p2', wts, 'c:/repo'), '', '목록에 없는 폴더(지운 워크트리)');
  assert.equal(worktreeOfPath(null, wts), '');
  assert.equal(worktreeOfPath('C:/repo/x', [], 'c:/repo'), '');
});

test('P27 영역 키: 워크트리 영역은 <워크스페이스 키>#wt=<경로 키>, 풀면 둘로', () => {
  const k = areaKey('c:/repo/.git', 'c:/repo/.claude/worktrees/p1');
  assert.equal(k, 'c:/repo/.git#wt=c:/repo/.claude/worktrees/p1');
  assert.deepEqual(parseArea(k), { ws: 'c:/repo/.git', wt: 'c:/repo/.claude/worktrees/p1' });
  assert.deepEqual(parseArea('c:/repo/.git'), { ws: 'c:/repo/.git', wt: '' });
  assert.equal(areaKey('c:/repo/.git', ''), 'c:/repo/.git');
  assert.equal(wsOfArea(k), 'c:/repo/.git');
  // 창이 쓰는 목록과 풀이
  const ws = [{ key: 'A', x: 0, y: 0, worktrees: [{ wt: 'w1', x: 900, y: 0, branch: 'b1', path: 'C:/w1' }] }, { key: 'B', x: 0, y: 900 }];
  const list = areaAnchorList(ws);
  assert.deepEqual(list.map((a) => a.key), ['A', areaKey('A', 'w1'), 'B']);
  assert.deepEqual(list[1].empty, WT_EMPTY);
  const res = areaResolverOf(ws);
  assert.equal(res('A', 'w1'), areaKey('A', 'w1'));
  assert.equal(res('A', 'gone'), 'A', '지워진 워크트리 영역이면 본 저장소 영역');
  assert.equal(res('A', ''), 'A'); assert.equal(res(null, 'w1'), null);
});

test('P27 이름표 글: ⎇ 브랜치, 폴더 이름이 브랜치와 다르면 함께', () => {
  // 이름표 글
  assert.deepEqual(worktreeLabel({ path: 'C:/r/.claude/worktrees/p27', branch: 'worktree-p27' }), { branch: 'worktree-p27', folder: '' });
  assert.deepEqual(worktreeLabel({ path: 'C:/r/wt/hotfix', branch: 'fix/login' }), { branch: 'fix/login', folder: 'hotfix' });
  assert.deepEqual(worktreeLabel({ path: 'C:/r/wt/feat', branch: null }), { branch: 'feat', folder: '' });
});

// ---------- 판 위에서(가짜 백엔드) ----------
function board({ dataDir = tmp(), repo = 'C:/repo', wts = [] } = {}) {
  const b = new Backend({ quietMs: 600000, port: 0, logDir: tmp() });
  b.store = new Store(path.join(dataDir, 'board.db'));
  b.sessions = new Map();
  const events = [];
  b.api = { broadcast: (event, data) => events.push({ event, data }) };
  b.log = () => {}; b.touch = () => {};
  b.events = events;
  b.broadcastWorkspaces = () => events.push({ event: 'workspace.updated' });
  const ws = { key: pathKey(`${repo}/.git`), kind: 'repo', root: normPath(repo) };
  if (!b.store.getWorkspace(ws.key)) { b.store.insertWorkspace({ ...ws, createdAt: 1 }); b.store.setWorkspaceAnchor(ws.key, 0, 0); }
  if (!b.store.getWorkspace('c:/other')) { b.store.insertWorkspace({ key: 'c:/other', kind: 'folder', root: 'C:/other', createdAt: 2 }); b.store.setWorkspaceAnchor('c:/other', 0, 3000); }
  const state = { wts };
  b.worktrees = attachWorktrees(b, { tickMs: 0, list: async (root) => (normPath(root) === normPath(repo) ? PORCELAIN(repo, state.wts) : null), exists: () => true });
  const add = (name, cwd, rect, wsKey = ws.key) => {
    const s = { sessionId: 'id-' + name, name, kind: 'shell', workspaceKey: wsKey, cwd, rt: newRuntime({ kind: 'shell', hooked: false }), origin: 'board', createdAt: Date.now() };
    b.sessions.set(s.sessionId, s);
    if (!b.store.getSession(s.sessionId)) b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    if (rect) b.store.setNode({ session_id: s.sessionId, ...rect, z: 0 });
    return s;
  };
  return { b, ws, add, state, dataDir };
}
const nodeOf = (b, name) => b.store.nodes().find((n) => n.session_id === 'id-' + name);

test('P27 판(P35 상자): 워크트리 둘이 생기면 리포 영역 안에 상자 둘, 그 폴더의 셸 노드는 그 영역에. 리포 영역을 옮기면 함께, 워크트리 영역만 옮기면 그 자리를 지킨다', async () => {
  const W1 = 'C:/repo/.claude/worktrees/p1', W2 = 'C:/repo/.claude/worktrees/p2';
  const { b, ws, add, state } = board();
  add('main', 'C:/repo', R(40, 112));
  add('s1', W1, R(800, 112)); // 아직 워크트리 영역이 없을 때 본 영역에 놓인 셸(워크트리 폴더)
  await b.worktrees.sync('t');
  assert.equal(b.store.worktreeAreas().length, 0, '워크트리가 없으면 영역도 없다');
  state.wts = [{ path: W1, branch: 'worktree-p1' }, { path: W2, branch: 'worktree-p2' }];
  const r1 = await b.worktrees.sync('t');
  assert.equal(r1.changed, true);
  const areas = b.store.worktreeAreas();
  assert.deepEqual(areas.map((a) => [a.path, a.branch]), [[W1, 'worktree-p1'], [W2, 'worktree-p2']]);
  const regs = ops.regions(b);
  const k1 = areaKey(ws.key, pathKey(W1)), k2 = areaKey(ws.key, pathKey(W2));
  assert.ok(regs.has(ws.key) && regs.has(k1) && regs.has(k2));
  assert.deepEqual(conflicts(b), [], '겹치지 않는다');
  const main = regs.get(ws.key);
  assert.ok(inside(regs.get(k1), main) && inside(regs.get(k2), main), `상자는 리포 영역 안 ${JSON.stringify([main, regs.get(k1), regs.get(k2)])}`);
  const m0 = nodeOf(b, 'main');
  assert.ok(regs.get(k1).x >= m0.x + m0.w || regs.get(k1).y >= m0.y + m0.h, '본 저장소 쪽 노드의 오른쪽이나 아래');
  // 셸 노드는 그 워크트리 영역으로 옮겨졌다(본 영역에 있던 것)
  const n1 = nodeOf(b, 's1');
  assert.equal(n1.area, pathKey(W1));
  assert.ok(inside(n1, regs.get(k1)), '워크트리 영역 안');
  assert.ok(b.store.events({}).some((e) => e.kind === 'node_moved' && e.data.cause === 'worktree area'));
  assert.equal(nodeOf(b, 'main').area || '', '', '본 저장소 셸은 그대로');
  assert.ok(b.events.some((e) => e.event === 'board.changed'));
  // 다음 동기화는 아무것도 바꾸지 않는다
  assert.deepEqual(await b.worktrees.sync('t'), { changed: false, moved: 0 });
  // 그 워크트리에서 새로 띄우는 세션 자리(slotFor area)도 그 영역 안
  const at = ops.slotFor(b, { wsKey: ws.key, size: NODE, area: pathKey(W2) });
  add('s2', W2, { ...at, w: NODE.w, h: NODE.h }); b.store.setNodeArea('id-s2', pathKey(W2));
  assert.ok(inside(nodeOf(b, 's2'), ops.regions(b).get(k2)));
  // 창에 주는 목록
  const wl = b.workspaceList().find((w) => w.key === ws.key);
  assert.deepEqual(wl.worktrees.map((a) => [a.wt, a.area, a.branch]), [[pathKey(W1), k1, 'worktree-p1'], [pathKey(W2), k2, 'worktree-p2']]);

  // 리포 영역을 옮기면 워크트리 영역과 안의 셸이 함께
  const before = { main: nodeOf(b, 'main'), s1: nodeOf(b, 's1'), s2: nodeOf(b, 's2'), a: b.store.worktreeAreas() };
  ops.workspaceMove(b, { workspace: ws.key, dx: 500, dy: -200 });
  for (const n of ['main', 's1', 's2']) assert.deepEqual([nodeOf(b, n).x, nodeOf(b, n).y], [before[n].x + 500, before[n].y - 200], n);
  assert.deepEqual(b.store.worktreeAreas().map((a) => [a.x, a.y]), before.a.map((a) => [a.x + 500, a.y - 200]));
  assert.ok(b.store.events({}).some((e) => e.kind === 'workspace_moved' && e.data.areas === 2));
  // 워크트리 영역 하나만 옮기면 그것만, 자리를 저장한다
  const r2 = ops.regions(b).get(k2);
  ops.worktreeMove(b, { workspace: ws.key, worktree: pathKey(W2), dx: 900, dy: 0 });
  assert.equal(nodeOf(b, 's2').x, before.s2.x + 500 + 900);
  assert.equal(nodeOf(b, 's1').x, before.s1.x + 500, '다른 워크트리 영역은 그대로');
  assert.equal(ops.regions(b).get(k2).x, r2.x + 900);
  assert.ok(b.store.worktreeAreas().find((a) => a.wt === pathKey(W2)).movedAt);
  assert.ok(inside(ops.regions(b).get(k2), ops.regions(b).get(ws.key)), 'P35: 리포 영역이 옮긴 상자를 감싼다');
  // 브랜치 이름으로도, 본 저장소 쪽 노드와 겹치면 거부
  const m1 = nodeOf(b, 'main');
  assert.throws(() => ops.worktreeMove(b, { workspace: ws.key, worktree: 'worktree-p1', dx: m1.x - ops.regions(b).get(k1).x + 40, dy: m1.y - ops.regions(b).get(k1).y + 40 }), (e) => e.code === 'overlap');
  assert.throws(() => ops.worktreeMove(b, { workspace: ws.key, worktree: 'nope', dx: 1, dy: 1 }), (e) => e.code === 'not_found');
  // 정리는 본 저장소 영역 안의 것만
  const plan = ops.arrange(b, { workspace: ws.key });
  assert.deepEqual(plan.plan.map((x) => x.names).flat(), ['main']);
});

test('P27 판: 워크트리를 지우면 그 상자가 사라지고, 남은 노드는 본 영역으로 온다. 다시 켜도(새 Store) 자리가 같다', async () => {
  const W1 = 'C:/repo/.claude/worktrees/p1', W2 = 'C:/repo/.claude/worktrees/p2';
  const dataDir = tmp();
  const first = board({ dataDir, wts: [{ path: W1, branch: 'worktree-p1' }, { path: W2, branch: 'worktree-p2' }] });
  first.add('main', 'C:/repo', R(40, 112));
  first.add('s1', W1, null);
  const at = ops.slotFor(first.b, { wsKey: first.ws.key, area: pathKey(W1) }); // 아직 영역이 없으면 본 영역
  first.b.store.setNode({ session_id: 'id-s1', ...at, w: NODE.w, h: NODE.h, z: 0 });
  await first.b.worktrees.sync('t');
  ops.worktreeMove(first.b, { workspace: first.ws.key, worktree: pathKey(W2), dx: 0, dy: 600 });
  const saved = first.b.store.worktreeAreas().map((a) => [a.wt, a.x, a.y]);
  const savedS1 = nodeOf(first.b, 's1');
  first.b.store.close();
  // 다시 켠다(같은 board.db)
  const again = board({ dataDir, wts: [{ path: W1, branch: 'worktree-p1' }, { path: W2, branch: 'worktree-p2' }] });
  again.add('main', 'C:/repo', null); again.add('s1', W1, null);
  assert.deepEqual(await again.b.worktrees.sync('start'), { changed: false, moved: 0 }, '다시 켜도 아무것도 옮기지 않는다');
  assert.deepEqual(again.b.store.worktreeAreas().map((a) => [a.wt, a.x, a.y]), saved);
  assert.deepEqual(nodeOf(again.b, 's1'), savedS1);
  // 워크트리 p1을 지운다
  again.state.wts = [{ path: W2, branch: 'worktree-p2' }];
  await again.b.worktrees.sync('t');
  assert.deepEqual(again.b.store.worktreeAreas().map((a) => a.path), [W2]);
  const regs = ops.regions(again.b);
  assert.ok(!regs.has(areaKey(again.ws.key, pathKey(W1))), '그 영역은 없다');
  const s1 = nodeOf(again.b, 's1');
  assert.equal(s1.area, '', '본 저장소 영역으로');
  assert.ok(inside(s1, regs.get(again.ws.key)));
  assert.deepEqual(conflicts(again.b), []);
  assert.ok(again.b.store.events({}).some((e) => e.kind === 'worktree_area_removed' && e.data.worktree === W1));
  // 목록 읽기가 실패하면(git 오류) 영역을 지우지 않는다
  const keep = again.b.store.worktreeAreas().length;
  again.b.worktrees.stop();
  const broken = attachWorktrees(again.b, { tickMs: 0, list: async () => null });
  await broken.sync('t');
  assert.equal(again.b.store.worktreeAreas().length, keep);
});

test('P27 판: 덩어리 안 노드는 옮기지 않고, 지금 폴더(hook cwd)가 워크트리로 바뀌면 그 영역으로, 다시 본 저장소로 오면 본 영역으로', async () => {
  const W1 = 'C:/repo/.claude/worktrees/p1';
  const { b, ws, add } = board({ wts: [{ path: W1, branch: 'worktree-p1' }] });
  const lead = add('lead', 'C:/repo', R(40, 112));
  await b.worktrees.sync('t');
  lead.rt.cwd = W1; // claude -w: 시작 폴더는 본 저장소, hook cwd가 워크트리
  await b.worktrees.sync('t');
  assert.equal(nodeOf(b, 'lead').area, pathKey(W1));
  assert.ok(inside(nodeOf(b, 'lead'), ops.regions(b).get(areaKey(ws.key, pathKey(W1)))));
  lead.rt.cwd = 'C:/repo/backend';
  await b.worktrees.sync('t');
  assert.equal(nodeOf(b, 'lead').area, '');
  // 덩어리
  const x = add('x', 'C:/repo', R(40 + NODE.w, 112));
  ops.dockCreate(b, { members: ['lead', 'x'], dir: 'row' });
  x.rt.cwd = W1;
  const before = nodeOf(b, 'x');
  await b.worktrees.sync('t');
  assert.deepEqual(nodeOf(b, 'x'), before, '덩어리 안 노드는 그대로');
});

test('P27 판: 판 밖 대화 노드도 그 워크트리 영역에 놓이고(워크트리 배경 블록은 두지 않는다), 워크트리가 지워지면 본 영역 쪽으로 다시 놓인다', async () => {
  const root = tmp(), base = tmp();
  const repo = path.join(base, 'repo'), wt = path.join(repo, '.claude', 'worktrees', 'feat');
  for (const d of [repo, wt]) fs.mkdirSync(d, { recursive: true });
  const NOW = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-00000000a027`;
  const convo = (cwd, id, at) => {
    const dir = path.join(root, path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(f, [JSON.stringify({ type: 'user', uuid: 'u' + id, cwd, entrypoint: 'cli', timestamp: iso(at), message: { role: 'user', content: '지시' } }), JSON.stringify({ type: 'assistant', uuid: 'a' + id, cwd, entrypoint: 'cli', timestamp: iso(at + 2000), message: { role: 'assistant', content: [{ type: 'text', text: '답' }] } })].join('\n') + '\n');
    const t = new Date(at + 6000); fs.utimesSync(f, t, t);
  };
  convo(repo, ID(1), NOW - 3600000);
  convo(wt, ID(2), NOW - 3500000);
  convo(wt, ID(3), NOW - 3400000);
  const repoWs = { key: pathKey(path.join(repo, '.git')), kind: 'repo', root: normPath(repo) };
  const dataDir = tmp();
  const store = new Store(path.join(dataDir, 'board.db'));
  store.insertWorkspace({ ...repoWs, createdAt: 1 }); store.setWorkspaceAnchor(repoWs.key, 0, 0);
  const events = [];
  const b = {
    cfg: { convoRoots: [root], claudeSessionsDir: tmp(), desktopSessionsDir: null, convoScanMs: 60000, claudeProjects: root, sessionsDir: path.join(dataDir, 'sessions'), dataDir, hookTimeoutSec: 2, claudeJson: path.join(dataDir, 'none.json'), claudeCommand: 'claude', codeRoots: [], tmpDir: null, testPrefix: '' },
    store, bus: new EventEmitter(), sessions: new Map(), events, killing: new Set(),
    api: { broadcast: (ev, data) => events.push([ev, data]) }, log: () => {}, hooked: () => true,
    resolveWorkspace: async (r) => store.getWorkspace(r), ensureWorkspace: () => false, broadcastWorkspaces: () => {},
  };
  const state = { wts: [{ path: normPath(wt), branch: 'feat' }] };
  b.worktrees = attachWorktrees(b, { tickMs: 0, list: async () => PORCELAIN(normPath(repo), state.wts), exists: () => true });
  await b.worktrees.sync('start');
  const r = new Recall(b, { resolveCwd: async () => repoWs, readProcs: async () => [], settings: () => ({ ...DEFAULTS, archiveDays: 14, autoOpenRepos: false }) });
  b.recall = r;
  await r.scan({ wait: true }); await r.changed();
  const ak = areaKey(repoWs.key, pathKey(wt));
  const byId = (id) => r.canvas.nodes.find((n) => n.convId === id);
  assert.equal(byId(ID(1)).area, '');
  for (const id of [ID(2), ID(3)]) { assert.equal(byId(id).area, pathKey(wt)); assert.equal(byId(id).block, '', '워크트리 영역 안에서는 블록 배경을 따로 두지 않는다'); }
  let regs = ops.regions(b);
  assert.ok(regs.has(ak));
  for (const id of [ID(2), ID(3)]) assert.ok(inside(byId(id), regs.get(ak)), '대화 노드가 워크트리 영역 안');
  assert.ok(inside(regs.get(ak), regs.get(repoWs.key)), 'P35: 상자는 리포 영역 안');
  assert.deepEqual(conflicts(b), []);
  // 워크트리 영역만 옮기면 대화 노드도 함께
  const c2 = { ...byId(ID(2)) };
  ops.worktreeMove(b, { workspace: repoWs.key, worktree: 'feat', dx: 300, dy: 100 });
  await r.layoutCanvas();
  assert.deepEqual([byId(ID(2)).x, byId(ID(2)).y], [c2.x + 300, c2.y + 100]);
  // 워크트리를 지우면(폴더는 남은 채로 목록에서 빠짐) 대화 노드는 본 영역에 다시 놓인다(P13 블록 배경으로)
  state.wts = [];
  await b.worktrees.sync('t'); await r.layoutCanvas();
  regs = ops.regions(b);
  assert.ok(!regs.has(ak));
  for (const id of [ID(2), ID(3)]) { assert.equal(byId(id).area, ''); assert.equal(byId(id).block, 'feat'); }
  assert.deepEqual(conflicts(b), []);
});

test('P27 git: 실제 git 저장소에서 워크트리를 만들고 지우면 목록이 따라간다(git이 있을 때)', async (t) => {
  let ok = true;
  try { execFileSync('git', ['--version'], { windowsHide: true }); } catch { ok = false; }
  if (!ok) return t.skip('git 없음');
  const base = fs.realpathSync.native(tmp());
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { windowsHide: true, encoding: 'utf8' });
  g('init', '-q'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
  const w1 = path.join(base, 'wt-a');
  g('worktree', 'add', '-q', '-b', 'feat-a', w1);
  const { b, ws } = board({ repo: normPath(repo) });
  b.worktrees.stop();
  b.worktrees = attachWorktrees(b, { tickMs: 0 }); // 진짜 git
  await b.worktrees.sync('t');
  assert.deepEqual(b.store.worktreeAreas().map((a) => [a.path.toLowerCase(), a.branch]), [[normPath(w1).toLowerCase(), 'feat-a']]);
  assert.equal(b.worktrees.areaOf(ws.key, path.join(w1, 'src')), pathKey(w1));
  g('worktree', 'remove', w1);
  await b.worktrees.sync('t');
  assert.deepEqual(b.store.worktreeAreas(), []);
});
