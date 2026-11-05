// P44 bulk close must retain the macOS port's pane-only lifecycle safeguards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Backend } from '../src/backend.mjs';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { GROUPS_META } from '../src/ws-groups.mjs';

function board(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-bulk-close-port-'));
  const b = new Backend({ logDir: dir, quietMs: 600000, killWaitMs: 0 });
  b.store = new Store(path.join(dir, 'board.db'));
  t.after(() => { b.store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  b.api = { broadcast() {} }; b.log = () => {}; b.requireHerdr = () => {};
  b.queue = { cancelSession() {}, pending: () => 0 };
  b.recall = {
    changed: async () => {},
    markArchive: ({ session }) => b.store.setArchive('session', session, { archivedAt: 101 }),
    forgetClosed: () => { throw new Error('bulk delete must not delete transcript files'); },
  };
  const calls = [];
  b.adapter = {
    workspacePanes: async () => { throw new Error('enumeration unavailable'); },
    closePane: async (id) => { calls.push(['pane', id]); },
    closeWorkspace: async (id) => { calls.push(['workspace', id]); },
    refreshSubscription: async () => {},
  };
  for (const [id, key, paneId] of [['a', 'first', 'w1:p1'], ['b', 'second', 'w1:p2'], ['sibling', 'keep', 'w1:p3']]) {
    const root = path.join(dir, key); fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'transcript.jsonl'), 'retain conversation');
    b.store.insertWorkspace({ key, root, kind: 'folder', createdAt: 1 });
    const s = { sessionId: id, name: id, kind: 'shell', workspaceKey: key, cwd: root, paneId, herdrWorkspaceId: 'w1', createdAt: 1, rt: newRuntime({ kind: 'shell', hooked: false }) };
    b.sessions.set(id, s);
    b.store.insertSession({ ...s, runtime: s.rt, permissionMode: 'manual' });
    b.store.setNode({ session_id: id, x: 0, y: 0, w: 720, h: 460, z: 0 });
  }
  b.store.insertMemo({ memoId: 'm', workspaceKey: 'first', x: 42, y: 60, w: 100, h: 100, text: 'keep memo', createdAt: 1 });
  b.store.insertKanban({ kanbanId: 'k', workspaceKey: 'second', x: 120, y: 60, w: 300, h: 100, title: 'keep cards', columns: [{ id: 'todo', cards: [{ id: 'task', title: 'keep' }] }], createdAt: 1 });
  b.store.setMeta(GROUPS_META, { groups: [{ id: 'g', name: 'Group', members: ['first', 'second', 'keep'] }] });
  return { b, calls, dir };
}

for (const after of ['archive', 'delete']) test(`bulk ${after} closes only selected panes when enumeration fails and retains sibling/content/files`, async (t) => {
  const { b, calls, dir } = board(t);
  const result = await b.workspaceClose({ workspaces: ['first', 'second'], confirm: true, after });
  assert.equal(result.closed, true);
  assert.deepEqual(calls.sort(), [['pane', 'w1:p1'], ['pane', 'w1:p2']]);
  assert.deepEqual([...b.sessions.keys()], ['sibling']);
  assert.deepEqual(b.store.workspaces().map((w) => w.key), ['keep']);
  assert.deepEqual(b.store.getMeta(GROUPS_META).groups[0].members, ['keep']);
  assert.deepEqual([b.store.getMemo('m').workspaceKey, b.store.getMemo('m').text, b.store.getMemo('m').x], [null, 'keep memo', 42]);
  assert.equal(b.store.getKanban('k').workspaceKey, null);
  assert.equal(b.store.getKanban('k').columns[0].cards[0].title, 'keep');
  for (const id of ['a', 'b']) {
    if (after === 'archive') { assert.ok(b.store.closedSession(id)); assert.equal(b.store.archiveMarks().get(`session:${id}`).archivedAt, 101); }
    else assert.equal(b.store.closedSession(id), null);
  }
  for (const key of ['first', 'second', 'keep']) assert.equal(fs.readFileSync(path.join(dir, key, 'transcript.jsonl'), 'utf8'), 'retain conversation');
});

test('bulk close retains a workspace and membership when a selected pane cannot close', async (t) => {
  const { b, calls } = board(t);
  b.adapter.closePane = async (id) => { calls.push(['pane', id]); if (id === 'w1:p2') throw Object.assign(new Error('busy'), { code: 'busy' }); };
  const result = await b.workspaceClose({ workspaces: ['first', 'second'], confirm: true, after: 'archive' });
  assert.equal(result.closed, false);
  assert.deepEqual(result.removed, ['first']);
  assert.deepEqual(result.kept, ['second']);
  assert.equal(result.sessions.failed[0].sessionId, 'b');
  assert.ok(b.sessions.has('b') && b.sessions.has('sibling'));
  assert.deepEqual(b.store.getMeta(GROUPS_META).groups[0].members, ['second', 'keep']);
  assert.equal(b.store.getKanban('k').workspaceKey, 'second');
  assert.ok(calls.every(([kind]) => kind === 'pane'));
});
