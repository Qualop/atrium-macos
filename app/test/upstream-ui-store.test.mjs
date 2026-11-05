import test from 'node:test';
import assert from 'node:assert/strict';
import { favoriteLaunchers, ICONS, harnessFields } from '../src/renderer/lib/launchers.js';
import { pickAttached } from '../src/renderer/lib/faces.js';

globalThis.location = { search: '' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = { mt: { log() {} } };
globalThis.requestAnimationFrame = () => {};
const { api } = await import('../src/renderer/api.js');
const { getState, loadBoard, loadLaunchers, putLaunchers, beginLayoutEdit, setNodesLocal, setDockLocal } = await import('../src/renderer/store.js');
const defer = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const empty = () => ({ nodes: [], links: [], docks: [], memos: [], kanbans: [], workspaces: [], groups: [] });
const launcherData = (id) => ({ launchers: [{ id, name: id, harness: 'codex' }], favorites: [id] });

test('board group events win over a refresh that began before regrouping', async (t) => {
  const d = defer(), st = getState();
  st.groups = [{ id: 'old', members: [] }];
  t.mock.method(api, 'call', () => d.promise);
  const loading = loadBoard();
  const groups = [{ id: 'new', members: ['repo'] }];
  api.emit('workspace.updated', { workspaces: [{ key: 'repo', name: 'Repo' }], groups });
  d.resolve({ ...empty(), groups: [{ id: 'stale', members: [] }] });
  await loading;
  assert.deepEqual(st.groups, groups);
  assert.equal(st.workspaces[0].key, 'repo');
});

test('unmodified group snapshot loads and removed groups can become empty', async (t) => {
  t.mock.method(api, 'call', async () => ({ ...empty(), groups: [{ id: 'g', members: [] }] }));
  await loadBoard(); assert.equal(getState().groups[0].id, 'g');
  t.mock.method(api, 'call', async () => empty());
  await loadBoard(); assert.deepEqual(getState().groups, []);
});

test('launcher events, newest request and connection generation defeat stale snapshots', async (t) => {
  const a = defer(), b = defer(), c = defer();
  const queue = [a, b, c];
  t.mock.method(api, 'call', () => queue.shift().promise);
  putLaunchers(launcherData('initial'));
  const old = loadLaunchers(), latest = loadLaunchers();
  b.resolve(launcherData('latest')); await latest;
  a.resolve(launcherData('old')); await old;
  assert.equal(getState().launchers.favorites[0], 'latest');
  const afterEvent = loadLaunchers();
  api.emit('launchers.updated', launcherData('event'));
  c.resolve(launcherData('snapshot')); await afterEvent;
  assert.equal(getState().launchers.favorites[0], 'event');
  const d = defer(); t.mock.method(api, 'call', () => d.promise);
  const reconnect = loadLaunchers(); api.generation++;
  d.resolve(launcherData('old-connection')); await reconnect;
  assert.equal(getState().launchers.favorites[0], 'event');
});

test('in-progress divider changes survive snapshot refresh along with the dock tree', async (t) => {
  const st = getState(), original = { x: 0, y: 0, w: 720, h: 405 };
  st.nodes = new Map([['a', original]]); st.docks = new Map([['dock', { dockId: 'dock', members: ['a'], tree: 'original' }]]);
  const end = beginLayoutEdit(['a'], 'dock');
  setNodesLocal([['a', { w: 900 }]]); setDockLocal('dock', { tree: 'edited' });
  t.mock.method(api, 'call', async () => ({ ...empty(), nodes: [{ session_id: 'a', ...original }], docks: [{ dockId: 'dock', members: ['a'], tree: 'original' }] }));
  try { await loadBoard(); assert.equal(st.nodes.get('a').w, 900); assert.equal(st.docks.get('dock').tree, 'edited'); }
  finally { end(); }
});

test('focusId compatibility and selected nodes both retain controller priority', () => {
  const nodes = [{ id: 'focus', x: 0, y: 0, w: 400, h: 400 }, { id: 'picked', x: 400, y: 0, w: 400, h: 400 }, { id: 'center', x: 800, y: 0, w: 400, h: 400 }];
  assert.deepEqual(pickAttached(nodes, { x: 0, y: 0, zoom: 1 }, { width: 2000, height: 800 }, { max: 2, focusId: 'focus', selected: new Set(['picked']) }), ['focus', 'picked']);
});

test('launcher UI preserves backend favorite order and one Gemini default icon', () => {
  const favorites = ['claude', 'codex', 'agy', 'shell'];
  const data = { favorites, launchers: [...favorites, 'gemini'].map((id) => ({ id, harness: id })) };
  assert.deepEqual(favoriteLaunchers(data).map((x) => x.harness), favorites);
  assert.equal(ICONS.filter((id) => ['gemini', 'agy'].includes(id)).length, 1);
  for (const kind of ['codex', 'gemini', 'agy']) assert.ok(harnessFields([], kind).includes('model'));
});
