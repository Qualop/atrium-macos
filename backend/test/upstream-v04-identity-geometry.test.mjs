import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { checkLabel, findSession, renameSession, takenNames } from '../src/session-label.mjs';
import { commonDir, isInside, nestClusters, rootable } from '../src/ws-nest.mjs';
import { GROUPS_META, rekeyGroups, syncWsGroups, wsLabels } from '../src/ws-groups.mjs';
import { pathKey } from '../src/workspaces.mjs';
import { attachWorktrees } from '../src/worktrees.mjs';
import { answerWorktreeExitOnScreen } from '../src/worktree-exit.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-v04-D-'));
  const store = new Store(path.join(dir, 'board.db'));
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, store };
}

test('nested paths preserve POSIX leading root, case, drive and UNC identity', () => {
  assert.equal(commonDir(['/Work/Repo/a', '/Work/Repo/b']), '/Work/Repo');
  assert.equal(commonDir(['/Work/a', '/Other/b']), '/');
  assert.equal(commonDir(['/Work/a', 'Work/b']), null);
  assert.equal(commonDir(['/Work/a', '/work/b']), '/');
  assert.equal(isInside('/Work/Repo', '/'), true);
  assert.equal(isInside('Work/Repo', '/Work'), false);
  assert.equal(rootable('/'), false);
  assert.equal(rootable('/Users', '/Users/fixture'), false);
  assert.equal(rootable('/Work'), true);
  assert.equal(commonDir(['c:/Work/a', 'd:/Work/b']), null);
  assert.equal(commonDir(['//server/share/a', '//server/other/b']), null);
  assert.equal(rootable('//server/share'), false);
  const groups = nestClusters([{ key: 'a', root: '/Work/Repo' }, { key: 'b', root: '/Work/Repo/Tools' }]);
  assert.deepEqual([groups[0].root, groups[0].rootPath, groups[0].base], ['/Work/Repo', '/Work/Repo', '/Work']);
  assert.deepEqual([...wsLabels({ groups: [{ auto: true, root: groups[0].root, members: ['a', 'b'] }] }, [{ key: 'a', root: '/Work/Repo' }, { key: 'b', root: '/Work/Repo/Tools' }])], [['a', 'Repo'], ['b', 'Repo/Tools']]);
});

test('automatic grouping probes absolute project paths in a fresh profile', (t) => {
  const { dir, store } = fixture(t);
  const root = path.join(fs.realpathSync.native(dir), 'Parent');
  fs.mkdirSync(path.join(root, 'One'), { recursive: true }); fs.mkdirSync(path.join(root, 'Two'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'synthetic project marker');
  for (const name of ['One', 'Two']) store.insertWorkspace({ key: name, root: path.join(root, name), kind: 'folder', createdAt: 1 });
  assert.equal(syncWsGroups({ store }), true);
  const state = store.getMeta(GROUPS_META);
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].root, pathKey(root));
  assert.equal(syncWsGroups({ store }), false);
});

test('display labels support normalized Korean while the agent address stays stable', (t) => {
  const { dir, store } = fixture(t);
  const me = { sessionId: 'synthetic', name: 'agent-1', agentName: 'agent-1', cwd: dir, permissionMode: 'manual', createdAt: 1 };
  store.insertSession({ ...me, label: '원래이름' });
  assert.equal(store.getSession(me.sessionId).label, '원래이름');
  const events = [];
  const b = { store, sessions: new Map([[me.sessionId, me]]), resolve: () => me, log() {}, broadcastSession: (...args) => events.push(args) };
  const want = '검토자-한글_2';
  const result = renameSession(b, { session: me.sessionId, name: want.normalize('NFD'), by: 'human' });
  assert.equal(result.label, want); assert.equal(result.address, 'agent-1');
  assert.equal(me.agentName, 'agent-1');
  assert.equal(findSession([me], '@' + want.normalize('NFD')), me);
  assert.equal(findSession([me], 'agent-1'), me);
  assert.equal(takenNames([me]).has(want.normalize('NFD')), true);
  assert.throws(() => checkLabel(want, [me], { sessionId: 'other' }), { code: 'name_taken' });
  assert.equal(events.length, 1);
  store.updateSession(me.sessionId, { closedAt: 2 });
  assert.equal(store.closedSessions()[0].label, want);
});

test('failed rename rolls back durable label, memory and notifications together', (t) => {
  const { dir, store } = fixture(t);
  const me = { sessionId: 'synthetic', name: 'agent-1', label: '이전', cwd: dir, permissionMode: 'manual', createdAt: 1 };
  store.insertSession(me);
  let published = 0;
  const b = { store, sessions: new Map([[me.sessionId, me]]), resolve: () => me, log() {}, broadcastSession() { published++; } };
  store.db.exec("CREATE TRIGGER fail_rename BEFORE INSERT ON events WHEN NEW.kind = 'renamed' BEGIN SELECT RAISE(ABORT, 'injected rename failure'); END");
  assert.throws(() => renameSession(b, { session: me.sessionId, name: '다음' }), /injected rename failure/);
  assert.equal(store.getSession(me.sessionId).label, '이전'); assert.equal(me.label, '이전');
  assert.equal(published, 0);
});

test('rekey retains automatic group dismissal, exclusion, pins and chosen order', () => {
  const state = { groups: [{ id: 'auto', name: 'Repo', auto: true, root: '/Work/Repo', named: true, ordered: true, members: ['left', 'old', 'right'], pinned: ['old'] }], dismissed: ['/Work/Hidden'], excluded: [{ root: '/Work/Other', ws: 'old' }] };
  const next = rekeyGroups(state, 'old', 'new');
  assert.deepEqual(next.groups[0], { ...state.groups[0], members: ['left', 'new', 'right'], pinned: ['new'] });
  assert.deepEqual(next.dismissed, state.dismissed);
  assert.deepEqual(next.excluded, [{ root: '/Work/Other', ws: 'new' }]);
  assert.equal(state.groups[0].members[1], 'old');
  const target = { ...state, groups: [...state.groups, { id: 'human', name: 'Human', members: ['new'] }] };
  assert.deepEqual(rekeyGroups(target, 'old', 'new').groups.map((g) => g.members), [['left', 'right'], ['new']]);
});

test('worktree lookup expands native filesystem aliases at the backend boundary', (t) => {
  const { dir, store } = fixture(t);
  const root = fs.realpathSync.native(dir), wt = path.join(root, 'Worktree'); fs.mkdirSync(wt);
  const alias = path.join(root, 'alias'); fs.symlinkSync(wt, alias, 'dir');
  store.insertWorkspace({ key: 'repo', kind: 'repo', root, createdAt: 1 });
  store.putWorktreeArea({ wsKey: 'repo', wt: pathKey(wt), path: wt, x: 0, y: 0 });
  const worktrees = attachWorktrees({ store, sessions: new Map() }, { tickMs: 0 }); t.after(() => worktrees.stop());
  assert.equal(worktrees.areaOf('repo', alias), pathKey(wt));
});

test('a late worktree-exit screen cannot type into a replacement pane', async () => {
  const s = { sessionId: 'synthetic', paneId: 'old-pane', rt: { herdr: { agentSessionId: 'old-agent' } } };
  const b = { sessions: new Map([[s.sessionId, s]]), adapter: {
    readScreen: async () => { s.paneId = 'replacement-pane'; return 'Exiting worktree session\n❯ 1. Keep worktree\n  2. Remove worktree'; },
    paneKeys: async () => assert.fail('stale exit prompt must not receive keys'),
  } };
  assert.equal(await answerWorktreeExitOnScreen(b, s, 'keep', 'test'), null);
});
