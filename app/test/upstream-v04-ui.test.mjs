import test from 'node:test';
import assert from 'node:assert/strict';
import { autoRootPath, shortFolder } from '../src/renderer/lib/folder-display.js';
import { autoApprovalApplies } from '../src/renderer/lib/launchers.js';
import { responseNeeded } from '../src/renderer/lib/response-needed.js';
import { notifyKey, NOTIFY_DELAY_MS } from '../src/renderer/lib/attention.js';
import { keyToData, boardArrowKey, spaceHoldReady } from '../src/renderer/lib/keys.js';
import { enterView, isViewing } from '../src/renderer/lib/nav.js';

const base = { sessionId: 'synthetic', name: 'fixture', kind: 'codex', createdAt: 10 };
test('effective approval is a launch setting for managed harnesses only', () => {
  for (const harness of ['claude', 'codex', 'gemini', 'agy', 'pi']) assert.equal(autoApprovalApplies({ agentAutoApprove: true }, harness), true);
  for (const harness of ['shell', 'command', '']) assert.equal(autoApprovalApplies({ agentAutoApprove: true }, harness), false);
  assert.equal(autoApprovalApplies({ agentAutoApprove: false }, 'claude'), false);
  assert.equal(autoApprovalApplies(null, 'codex'), false);
});
test('response notice retains native questions, trust, login and error context, then clears', () => {
  assert.deepEqual(responseNeeded({ ...base, state: 'waiting', ask: { kind: 'question', questions: [{ question: 'Which branch?' }] } }), {
    kind: 'question', title: 'Question for you', context: 'Question: Which branch?', hint: 'Read and respond in the agent terminal.',
  });
  assert.equal(responseNeeded({ ...base, state: 'trust_wait' }).kind, 'trust');
  assert.match(responseNeeded({ ...base, state: 'trust_wait' }).context, /trust/i);
  const login = responseNeeded({ ...base, state: 'waiting', ask: { kind: 'screen', tail: '\x1b[31mPlease sign in with Google\x1b[0m' } });
  assert.equal(login.kind, 'login'); assert.equal(login.context, 'Please sign in with Google');
  assert.equal(responseNeeded({ ...base, state: 'error', error: { message: 'Model unavailable' } }).context, 'Model unavailable');
  assert.equal(responseNeeded({ ...base, state: 'ready', ask: { kind: 'question' } }), null);
  assert.equal(responseNeeded({ ...base, kind: 'shell', state: 'waiting' }), null);
});
test('notification identities are stable across summary refreshes and change for distinct native requests and errors', () => {
  const wait = { ...base, state: 'waiting', ask: { toolUseId: 'first', since: 4 } };
  assert.equal(notifyKey(wait), notifyKey(structuredClone(wait)));
  assert.notEqual(notifyKey(wait), notifyKey({ ...wait, ask: { toolUseId: 'second', since: 4 } }));
  const fail = { ...base, state: 'error', error: { type: 'provider', message: 'Retry', at: 20 } };
  assert.equal(notifyKey(fail), notifyKey(structuredClone(fail)));
  assert.notEqual(notifyKey(fail), notifyKey({ ...fail, error: { ...fail.error, at: 21 } }));
});
test('folder labels preserve POSIX roots and case, accept only matching members, and retain Windows spelling', () => {
  const group = { root: '/Users/Test/Work', members: ['a'] };
  assert.equal(autoRootPath(group, [{ key: 'a', root: '/Users/Test/Work/App' }]), '/Users/Test/Work');
  assert.equal(autoRootPath(group, [{ key: 'a', root: '/users/test/work/App' }]), null);
  assert.equal(autoRootPath(group, [{ key: 'a', root: '/Users/Test/Workspace/App' }]), null);
  assert.equal(autoRootPath(group, [{ key: 'b', root: '/Users/Test/Work/App' }]), null);
  assert.equal(autoRootPath({ root: 'c:/work', members: ['a'] }, [{ key: 'a', root: 'C:\\Work\\App' }]), 'C:/Work');
  assert.equal(autoRootPath({ root: '/', members: ['a'] }, [{ key: 'a', root: '/Users/App' }]), '/');
  assert.equal(autoRootPath({ root: '/', members: ['a'] }, [{ key: 'b', root: '/Users/App' }]), null);
  assert.equal(autoRootPath({ root: 'c:/', members: ['a'] }, [{ key: 'a', root: 'C:/Work' }]), 'C:/');
  assert.equal(shortFolder('/Users/A\\B/foo'), '…/A\\B/foo');
  assert.equal(shortFolder('/one'), '/one'); assert.equal(shortFolder('/Users/Test/Work'), '…/Test/Work');
});
test('legacy IME 229 never becomes terminal input, workspace navigation or a space hold', () => {
  assert.equal(keyToData({ key: 'Enter', keyCode: 229 }), null);
  assert.equal(boardArrowKey({ key: 'ArrowLeft', keyCode: 229 }), null);
  assert.equal(spaceHoldReady({ key: ' ', keyCode: 229 }), false);
});
test('a node under a toolbar is not treated as already viewed', () => {
  const node = { x: 0, y: 0, w: 720, h: 405 }, screen = { width: 900, height: 600 }, inset = { top: 100, bottom: 80, left: 60, right: 60 };
  const view = enterView({ node, screen, inset });
  assert.equal(isViewing({ node, view, screen, inset, viewport: { x: 90, y: 70, zoom: 1 } }), false);
  assert.equal(isViewing({ node, view, screen, inset, viewport: { x: 450 - view.cx * view.zoom, y: 300 - view.cy * view.zoom, zoom: view.zoom } }), true);
});
test('inset navigation fits a tall or narrow leaf without covering toolbar space', () => {
  const screen = { width: 900, height: 600 }, inset = { top: 90, bottom: 80, left: 68, right: 50 };
  const node = { x: 100, y: 120, w: 240, h: 1800 };
  const view = enterView({ node, dock: { x: 0, y: 0, w: 2600, h: 1900 }, screen, inset });
  const left = screen.width / 2 + (node.x - view.cx) * view.zoom;
  const top = screen.height / 2 + (node.y - view.cy) * view.zoom;
  assert.ok(view.zoom <= 1); assert.ok(left >= inset.left && top >= inset.top);
  assert.ok(top + node.h * view.zoom <= screen.height - inset.bottom + 1e-6);
});

const persisted = new Map(); let navigate;
const notifications = [];
globalThis.requestAnimationFrame = () => {};
globalThis.location = { search: '' };
globalThis.localStorage = { getItem: (k) => persisted.get(k) || null, setItem: (k, v) => persisted.set(k, v) };
globalThis.window = { mt: { log() {}, notify: async (x) => { notifications.push(x); return { shown: true }; }, onNavigate(fn) { navigate = fn; } } };
globalThis.document = { hasFocus: () => false, visibilityState: 'hidden', querySelector: () => null };
globalThis.CSS = { escape: (x) => x };
const { api } = await import('../src/renderer/api.js');
const { getState } = await import('../src/renderer/store.js');
const { startNotifier } = await import('../src/renderer/notify.js');

test('notifier starts once, deduplicates, cancels stale needs-user timers and opens the actual current terminal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = getState(), seen = [];
  state.navigateTo = (...args) => seen.push(args);
  startNotifier(); startNotifier();
  const update = (value) => api.emit('session.updated', { ...base, ...value });
  update({ state: 'waiting', ask: { toolUseId: 'n1', summary: 'Question A' } });
  t.mock.timers.tick(NOTIFY_DELAY_MS); await Promise.resolve();
  assert.equal(notifications.length, 1);
  update({ state: 'waiting', ask: { toolUseId: 'n1', summary: 'Question A' } });
  t.mock.timers.tick(NOTIFY_DELAY_MS); assert.equal(notifications.length, 1);
  update({ state: 'waiting', ask: { toolUseId: 'n2', summary: 'Stale question' } });
  update({ state: 'ready' }); t.mock.timers.tick(NOTIFY_DELAY_MS); assert.equal(notifications.length, 1);
  update({ state: 'trust_wait' }); t.mock.timers.tick(NOTIFY_DELAY_MS); assert.equal(notifications.length, 2);
  navigate({ sessionId: base.sessionId });
  assert.deepEqual(seen, [[base.sessionId, { focusTerminal: true }]]);
  update({ state: 'ready' });
  assert.ok(!Object.hasOwn(JSON.parse(persisted.get('mt.notified')), `${base.sessionId}|trust_wait|x`), 'resolved unknown episodes are cleared from persisted dedup too');
  update({ state: 'trust_wait' }); t.mock.timers.tick(NOTIFY_DELAY_MS);
  assert.equal(notifications.length, 3, 'a fresh unidentified trust episode is not consumed by an earlier one');
  api.emit('session.removed', { sessionId: base.sessionId }); navigate(base.sessionId);
  assert.equal(seen.length, 1, 'removed sessions cannot receive stale notification handoff');
});
