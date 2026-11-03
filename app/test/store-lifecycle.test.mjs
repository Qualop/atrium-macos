import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { search: '' };
globalThis.localStorage = { getItem: () => null };
globalThis.window = { mt: { log() {} } };
globalThis.requestAnimationFrame = () => {};
const { api } = await import('../src/renderer/api.js');
const { loadBoard, getState, setNodeLocal, setSelected } = await import('../src/renderer/store.js');
const defer = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const board = (x) => ({ nodes: [{ session_id: 'a', x, y: 0, w: 500, h: 400 }], links: [], docks: [], memos: [], kanbans: [], workspaces: [] });

test('board refresh ignores an older response arriving after the latest snapshot', async (t) => {
  const a = defer(), b = defer(); let n = 0;
  t.mock.method(api, 'call', () => ++n === 1 ? a.promise : b.promise);
  const old = loadBoard(), latest = loadBoard();
  b.resolve(board(200)); await latest;
  a.resolve(board(100)); await old;
  assert.equal(getState().nodes.get('a').x, 200);
});

test('board refresh preserves moves and removals made while its snapshot was in flight', async (t) => {
  const st = getState();
  st.nodes = new Map([['a', { x: 0 }], ['b', { x: 0 }]]);
  st.sessions = new Map([['a', { sessionId: 'a' }], ['b', { sessionId: 'b' }]]);
  const d = defer(); t.mock.method(api, 'call', () => d.promise);
  const pending = loadBoard();
  setNodeLocal('a', { x: 300 });
  api.emit('session.removed', { sessionId: 'b' });
  const snapshot = board(0); snapshot.nodes.push({ session_id: 'b', x: 0 });
  d.resolve(snapshot); await pending;
  assert.equal(st.nodes.get('a').x, 300);
  assert.equal(st.nodes.has('b'), false);
});

test('removing a selected session clears its focus and queued terminal input', () => {
  const st = getState();
  st.sessions = new Map([['a', { sessionId: 'a' }]]);
  setSelected(['a']); st.focusId = 'a'; st.pendingInput = { id: 'a', buf: 'hello', at: Date.now() };
  api.emit('session.removed', { sessionId: 'a' });
  assert.deepEqual(st.selected, []);
  assert.equal(st.focusId, null);
  assert.equal(st.pendingInput, null);
});

test('reconnect still loads settings when resource metrics are unavailable', async (t) => {
  const calls = [];
  t.mock.method(api, 'call', async (method) => {
    calls.push(method);
    if (method === 'resources.get') throw new Error('metrics unavailable');
    if (method === 'board.get') return board(0);
    if (method === 'delivery.list' || method === 'loop.list') return [];
    if (method === 'thread.list') return { items: [], more: false };
    if (method === 'settings.get') return { settings: { language: 'en', tray: true } };
    return {};
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await [...api.listeners.get('$open')][0]({ sessions: [] });
  assert.ok(calls.includes('settings.get'));
});

test('settings updates received during reconnect beat its old settings snapshot', async (t) => {
  const d = defer(); let requested = false;
  t.mock.method(api, 'call', async (method) => {
    if (method === 'board.get') return board(0);
    if (method === 'delivery.list' || method === 'loop.list') return [];
    if (method === 'thread.list') return { items: [], more: false };
    if (method === 'settings.get') { requested = true; return d.promise; }
    return {};
  });
  const loading = [...api.listeners.get('$open')][0]({ sessions: [] });
  for (let i = 0; i < 30 && !requested; i++) await Promise.resolve();
  assert.ok(requested);
  api.emit('settings.updated', { language: 'en', claudeModel: 'latest' });
  d.resolve({ settings: { language: 'en', claudeModel: 'old' } });
  await loading;
  assert.equal(getState().settings.claudeModel, 'latest');
});
