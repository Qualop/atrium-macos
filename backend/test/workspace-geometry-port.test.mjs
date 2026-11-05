// Port regressions: persisted legacy boards, transactional migrations and async races.
// Every database/repository belongs to this test; no running backend or user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../src/store.mjs';
import * as ops from '../src/canvas-ops.mjs';
import { areaKey, regionConflicts, worktreeOfPath } from '../src/worktree-areas.mjs';
import { attachWorktrees } from '../src/worktrees.mjs';
import { normPath, pathKey, elsewhereOf } from '../src/workspaces.mjs';
import { rekeyBoard } from '../src/workspace-merge.mjs';
import { mergeWorkspace, reconcileWorkspaces } from '../src/workspace-merge-ops.mjs';
import { rekeyGroups, groupHandlers, GROUPS_META } from '../src/ws-groups.mjs';

const folder = { key: '/Fixture/Repo', root: '/Fixture/Repo', kind: 'folder', createdAt: 10 };
const repo = { ...folder, key: '/Fixture/Repo/.git', kind: 'repo', createdAt: 20 };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tables = ['workspaces', 'sessions', 'nodes', 'docks', 'memos', 'kanbans', 'convo_nodes', 'worktree_areas', 'archive', 'events', 'meta'];
const dump = (store) => Object.fromEntries(tables.map((table) => [table, store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((r) => ({ ...r }))]));

function fixture(t, initial = folder) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-geometry-port-'));
  const file = path.join(dir, 'board.db');
  const sent = [];
  const b = { store: new Store(file), sessions: new Map(), api: { broadcast: (...args) => sent.push(args) }, log: () => {}, broadcastWorkspaces: () => sent.push(['workspaces']), nameOf: (id) => id };
  t.after(() => { b.worktrees?.stop(); b.store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const open = (w, x = 0, y = 0) => { b.store.insertWorkspace(w); b.store.setWorkspaceAnchor(w.key, x, y); };
  open(initial);
  const add = (id, { key = initial.key, area = '', x = 40, y = 112, closed = false } = {}) => {
    const s = { sessionId: id, name: id, cwd: initial.root, workspaceKey: key, kind: 'shell', createdAt: 1, permissionMode: 'manual', runtime: { state: 'shell_idle', lastAnswer: 'retain history' } };
    b.store.insertSession(s);
    b.store.setNode({ session_id: id, x, y, w: 720, h: 460, z: 0, area });
    if (closed) { b.store.updateSession(id, { closedAt: 100, closeReason: 'killed', dismissedAt: 101 }); b.store.setArchive('session', id, { archivedAt: 101 }); }
    else b.sessions.set(id, s);
    return s;
  };
  const content = () => {
    add('live'); add('closed', { closed: true, x: 1700, y: 1800 });
    b.store.insertMemo({ memoId: 'memo', workspaceKey: initial.key, x: 50, y: 700, w: 300, h: 220, text: 'memo\n한글 Ω', color: 'green', createdAt: 2 });
    b.store.insertKanban({ kanbanId: 'kanban', workspaceKey: initial.key, title: 'Tasks', x: 500, y: 700, w: 800, h: 400, columns: [{ id: 'todo', title: 'To do', cards: [{ id: 'card', title: 'retain', body: '본문\nbody', session: 'closed' }] }], createdAt: 3 });
    b.store.insertDock({ dockId: 'dock', workspaceKey: initial.key, tree: { dir: 'row', kids: ['live', 'closed'], ratios: [1, 1] }, createdAt: 4 });
    for (const shown of [true, false]) b.store.putConvoNode({ convId: shown ? 'shown' : 'hidden', workspaceKey: initial.key, x: 100, y: shown ? 1400 : 1800, w: 200, h: 200, shown, placedAt: 5, movedAt: 6 });
    b.store.setWorkspaceViewport(initial.key, { x: 42, y: -8, zoom: 0.7 });
    b.store.setMeta('currentWorkspace', initial.key);
    b.store.setMeta(GROUPS_META, { groups: [{ id: 'first', name: 'First', members: ['before', initial.key, 'after'] }] });
  };
  const reopen = () => { b.store.close(); b.store = new Store(file); };
  return { b, dir, sent, add, content, open, reopen };
}

test('workspace keys preserve POSIX case, root paths and Windows/UNC folding', () => {
  assert.equal(normPath('/'), '/');
  assert.equal(normPath('c:\\'), 'C:/');
  assert.equal(pathKey('C:\\Repo\\'), 'c:/repo');
  assert.equal(pathKey('\\\\Server\\Share\\Repo'), '//server/share/repo');
  assert.notEqual(pathKey('/Fixture/Repo'), pathKey('/fixture/repo'));
  assert.equal(elsewhereOf({ key: '/', kind: 'folder' }, { cwd: '/tmp/project', isRepo: false }), null);
  assert.equal(elsewhereOf({ key: 'c:/', kind: 'folder' }, { cwd: 'C:/project', isRepo: false }), null);
  assert.equal(worktreeOfPath('/tmp/file', [{ key: '/' }]), '/');
  assert.equal(worktreeOfPath('/Fixture/Repo/file', [{ key: '/fixture/repo' }]), '');
});

test('group rekey inherits source order, but existing target membership wins across groups', () => {
  const groups = { groups: [{ id: 'a', name: 'A', members: ['left', 'from', 'right'] }, { id: 'b', name: 'B', members: ['other'] }] };
  assert.deepEqual(rekeyGroups(groups, 'from', 'to').groups[0].members, ['left', 'to', 'right']);
  const both = structuredClone(groups); both.groups[1].members.push('to');
  assert.deepEqual(rekeyGroups(both, 'from', 'to').groups.map((g) => g.members), [['left', 'right'], ['other', 'to']]);
  both.groups[0].members.push('to'); both.groups[1].members.pop();
  assert.deepEqual(rekeyGroups(both, 'from', 'to').groups[0].members, ['left', 'right', 'to']);
  assert.deepEqual(groups.groups[0].members, ['left', 'from', 'right'], 'input is not mutated');
});

test('folder → repo → folder persists all content, closed history, geometry and group order across reopen', (t) => {
  const { b, content, reopen } = fixture(t); content();
  const before = dump(b.store);
  for (const key of [folder.key, repo.key, '*']) b.store.setMeta(`arrangeUndo:${key}`, { nodes: [] });
  const model = rekeyBoard({ workspaces: b.store.workspaces(), sessions: b.store.openSessions(), meta: { wsGroups: b.store.getMeta(GROUPS_META) } }, folder.key, repo);
  const moved = b.store.rekeyWorkspace(folder.key, repo);
  assert.equal(moved.sessions, 2, 'closed sessions are rekeyed too');
  assert.equal(b.store.closedSession('closed').workspaceKey, repo.key);
  assert.deepEqual(b.store.getMeta(GROUPS_META), model.meta.wsGroups);
  for (const key of [folder.key, repo.key, '*']) assert.equal(b.store.getMeta(`arrangeUndo:${key}`), null);
  reopen();
  assert.equal(b.store.getMemo('memo').workspaceKey, repo.key);
  assert.equal(b.store.getKanban('kanban').workspaceKey, repo.key);
  assert.equal(b.store.rekeyWorkspace(folder.key, repo), null);
  b.store.rekeyWorkspace(repo.key, folder);
  reopen();
  const after = dump(b.store);
  for (const table of ['sessions', 'nodes', 'docks', 'memos', 'kanbans', 'convo_nodes', 'archive', 'events']) assert.deepEqual(after[table], before[table], table);
  assert.deepEqual(b.store.getMeta(GROUPS_META).groups[0].members, ['before', folder.key, 'after']);
  assert.deepEqual(b.store.getWorkspace(folder.key).viewport, { x: 42, y: -8, zoom: 0.7 });
});

for (const existingTarget of [false, true]) test(`rekey rolls back every table, metadata and memory on late failure (existing target: ${existingTarget})`, (t) => {
  const { b, content, open, reopen, sent } = fixture(t); content();
  if (existingTarget) open(repo, 6000, 0);
  b.store.putWorktreeArea({ wsKey: folder.key, wt: '/Fixture/wt', path: '/Fixture/wt', x: 1000, y: 0 });
  for (const key of [folder.key, repo.key, '*']) b.store.setMeta(`arrangeUndo:${key}`, { nodes: [] });
  const before = dump(b.store);
  b.store.db.exec(`CREATE TRIGGER fail_groups BEFORE UPDATE ON meta WHEN NEW.key = 'wsGroups' BEGIN SELECT RAISE(ABORT, 'injected group write'); END`);
  assert.throws(() => mergeWorkspace(b, folder.key, repo, 'fixture'), /injected group write/);
  assert.deepEqual(dump(b.store), before);
  assert.equal(b.sessions.get('live').workspaceKey, folder.key);
  assert.deepEqual(sent, []);
  reopen();
  assert.deepEqual(dump(b.store), before, 'rollback survives close/reopen');
  b.store.db.exec('DROP TRIGGER fail_groups');
  assert.equal(b.store.rekeyWorkspace(folder.key, repo).sessions, 2, 'retry is complete');
});

test('merging duplicate areas retains target geometry and group order without dropping content', (t) => {
  const { b, content, open } = fixture(t); content(); open(repo, 6000, 0);
  b.store.setMeta(GROUPS_META, { groups: [{ id: 'source', name: 'Source', members: [folder.key] }, { id: 'target', name: 'Target', members: ['left', repo.key, 'right'] }] });
  for (const [wsKey, x] of [[folder.key, 1000], [repo.key, 6000]]) b.store.putWorktreeArea({ wsKey, wt: '/Fixture/wt', path: '/Fixture/wt', x, y: 0 });
  b.store.rekeyWorkspace(folder.key, repo);
  assert.deepEqual(b.store.worktreeAreas().map((a) => [a.wsKey, a.x]), [[repo.key, 6000]]);
  assert.deepEqual(b.store.getMeta(GROUPS_META).groups.map((g) => g.members), [[], ['left', repo.key, 'right']]);
  assert.equal(b.store.getMemo('memo').text, 'memo\n한글 Ω');
  assert.equal(b.store.closedSessions().length, 1);
});

function legacyBoxes(t) {
  const f = fixture(t, repo); f.content();
  const wt = '/Fixture/Repo-wt';
  f.b.store.putWorktreeArea({ wsKey: repo.key, wt, path: wt, x: 9000, y: 0, createdAt: 7 });
  f.add('worktree', { area: wt, x: 9040, y: 112 });
  for (const n of f.b.store.convoNodes()) f.b.store.putConvoNode({ ...n, x: n.x + 9000, area: wt });
  f.reopen();
  return { ...f, wt };
}

test('P27 satellite fixture migrates once; memo, kanban and closed history survive restart and arrange/undo', (t) => {
  const { b, wt, reopen } = legacyBoxes(t);
  const before = dump(b.store);
  const oldConvos = b.store.convoNodes();
  const moved = ops.migrateBoxesInside(b);
  assert.equal(moved.length, 1);
  const { dx, dy } = moved[0];
  assert.ok(dx || dy);
  for (const c of b.store.convoNodes()) {
    const old = oldConvos.find((n) => n.convId === c.convId);
    assert.deepEqual([c.x, c.y, c.shown], [old.x + dx, old.y + dy, old.shown]);
  }
  const after = dump(b.store);
  for (const table of ['sessions', 'memos', 'kanbans', 'archive']) assert.deepEqual(after[table], before[table], table);
  assert.deepEqual(b.store.nodeOf('closed'), before.nodes.find((n) => n.session_id === 'closed'));
  assert.deepEqual([...regionConflicts(ops.regions(b), ops.canvasItems(b))], []);
  const geometry = () => ({ nodes: b.store.nodes().map((n) => ({ ...n, size: n.size || null })), areas: b.store.worktreeAreas(), convos: b.store.convoNodes(), memos: b.store.memos().map(({ updatedAt, ...m }) => m), kanbans: b.store.kanbans().map(({ updatedAt, ...k }) => k) });
  const initial = geometry();
  ops.arrange(b, { all: true, apply: true });
  ops.arrange(b, { all: true, undo: true });
  assert.deepEqual(geometry(), initial);
  ops.worktreeMove(b, { workspace: repo.key, worktree: wt, dx: 0, dy: 500, force: true });
  const userMoved = geometry();
  reopen();
  assert.deepEqual(ops.migrateBoxesInside(b), []);
  assert.deepEqual(geometry(), userMoved, 'user layout survives restart');
});

test('box migration rolls back geometry and marker on late failure and can retry after restart', (t) => {
  const { b, reopen, sent } = legacyBoxes(t);
  b.recall = { layoutCanvas: async () => { sent.push(['recall']); } };
  const before = dump(b.store);
  b.store.db.exec(`CREATE TRIGGER fail_boxes BEFORE INSERT ON meta WHEN NEW.key = 'boxesInside' BEGIN SELECT RAISE(ABORT, 'injected migration marker'); END`);
  assert.throws(() => ops.migrateBoxesInside(b), /injected migration marker/);
  assert.deepEqual(dump(b.store), before);
  assert.deepEqual(sent, [], 'nothing published from the aborted migration');
  reopen();
  assert.deepEqual(dump(b.store), before);
  b.store.db.exec('DROP TRIGGER fail_boxes');
  assert.equal(ops.migrateBoxesInside(b).length, 1);
  assert.ok(b.store.getMeta(ops.BOXES_INSIDE));
});

test('reconciliation uses real git init/removal in a temporary repository and retains content/groups', async (t) => {
  const { b, dir, content, reopen } = fixture(t); content();
  const root = fs.realpathSync.native(dir); // Expand Windows 8.3 aliases just as git does.
  const localFolder = { key: pathKey(root), root, kind: 'folder' };
  b.store.rekeyWorkspace(folder.key, localFolder);
  b.sessions.get('live').workspaceKey = localFolder.key;
  execFileSync('git', ['init', '--quiet', root]);
  const done = await reconcileWorkspaces(b, 'fixture', { quiet: true });
  assert.equal(done.length, 1);
  const repoKey = b.store.workspaces()[0].key;
  assert.equal(repoKey, pathKey(path.join(root, '.git')));
  assert.equal(b.store.getMeta(GROUPS_META).groups[0].members[1], repoKey);
  fs.rmSync(path.join(root, '.git'), { recursive: true });
  assert.equal((await reconcileWorkspaces(b, 'fixture', { quiet: true })).length, 1);
  reopen();
  assert.equal(b.store.getMemo('memo').workspaceKey, localFolder.key);
  assert.equal(b.store.closedSession('closed').workspaceKey, localFolder.key);
  assert.equal(b.store.getMeta(GROUPS_META).groups[0].members[1], localFolder.key);
  assert.deepEqual(await reconcileWorkspaces(b, 'fixture', { quiet: true }), []);
});

for (const change of ['close', 'reopen', 'root', 'cancel']) test(`late workspace probe is ignored after ${change}`, async (t) => {
  const { b, open } = fixture(t);
  const gate = deferred(), entered = deferred(); let cancelled = false;
  const pending = reconcileWorkspaces(b, 'fixture', { exists: () => true, gitExists: () => true, cancelled: () => cancelled, resolve: () => { entered.resolve(); return gate.promise; } });
  await entered.promise;
  if (change === 'cancel') cancelled = true;
  else { b.store.deleteWorkspace(folder.key); if (change !== 'close') open({ ...folder, ...(change === 'reopen' ? { createdAt: 999 } : { root: '/NewRoot' }) }); }
  const before = dump(b.store);
  gate.resolve(repo);
  assert.deepEqual(await pending, []);
  assert.deepEqual(dump(b.store), before);
});

test('stopping worktree sync cancels pending reconciliation and prevents worktree queries', async (t) => {
  const { b } = fixture(t);
  const gate = deferred(), entered = deferred(); let queries = 0;
  b.reconcileWorkspaces = (cause, options) => reconcileWorkspaces(b, cause, { ...options, exists: () => true, gitExists: () => true, resolve: () => { entered.resolve(); return gate.promise; } });
  b.worktrees = attachWorktrees(b, { tickMs: 0, list: async () => { queries++; return ''; } });
  const pending = b.worktrees.sync('fixture');
  await entered.promise; b.worktrees.stop(); gate.resolve(repo);
  assert.deepEqual(await pending, { changed: false, moved: 0 });
  assert.ok(b.store.getWorkspace(folder.key));
  assert.equal(queries, 0);
});

for (const action of ['stop', 'close', 'reopen']) test(`late worktree list is ignored after ${action}`, async (t) => {
  const { b, open } = fixture(t, repo);
  const gate = deferred(), entered = deferred();
  b.worktrees = attachWorktrees(b, { tickMs: 0, list: () => { entered.resolve(); return gate.promise; }, exists: () => true });
  const pending = b.worktrees.sync('fixture'); await entered.promise;
  if (action === 'stop') b.worktrees.stop();
  else { b.store.deleteWorkspace(repo.key); if (action === 'reopen') open({ ...repo, createdAt: 999 }); }
  const before = dump(b.store);
  gate.resolve(`worktree ${repo.root}\nHEAD 1\n\nworktree /Fixture/wt\nHEAD 2\n\n`);
  assert.deepEqual(await pending, { changed: false, moved: 0 });
  assert.deepEqual(dump(b.store), before);
  assert.equal(b.worktrees.live(repo.key), null);
});

test('async group moves preserve edits made during workspace resolution', async (t) => {
  const { b, open } = fixture(t); open(repo, 6000);
  b.store.setMeta(GROUPS_META, { groups: [{ id: 'g', name: 'Old', members: [] }] });
  const gate = deferred(); b.resolveWorkspace = () => gate.promise;
  const h = groupHandlers(b);
  const pending = h['group.move']({ workspace: folder.key, group: 'g' });
  h['group.rename']({ group: 'g', name: 'Renamed' });
  gate.resolve(folder); await pending;
  assert.deepEqual(b.store.getMeta(GROUPS_META), { groups: [{ id: 'g', name: 'Renamed', members: [folder.key] }] });
  b.resolveWorkspace = async () => { throw new Error('missing workspace'); };
  await assert.rejects(h['group.create']({ name: 'Incomplete', workspaces: ['missing'] }), /missing workspace/);
  assert.equal(b.store.getMeta(GROUPS_META).groups.length, 1, 'failed creation does not leave a partial group');
});
