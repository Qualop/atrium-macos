import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneInputCall, phoneInputTarget } from '../src/renderer/lib/phone-input.js';
import { keyQueue, sendPlan } from '../src/renderer/lib/phone.js';
import { phoneMission } from '../src/renderer/lib/phone-mission.js';
const tick = () => new Promise((r) => setImmediate(r));
function fixture() {
  const api = { status: 'open', generation: 1, calls: [], async call(method, p) { this.calls.push({ method, ...p }); return {}; } };
  let attachmentId = 'before';
  const terms = new Map([['s', { _mtInputTarget: () => ({ attachmentId, controllerPid: 7 }) }]]);
  return { api, terms, replace: () => { attachmentId = 'after'; } };
}

test('phone input always carries attachment identity and rejects stale generation, replaced PID identity and detached views', async () => {
  const { api, terms, replace } = fixture();
  const target = phoneInputTarget(api, terms, 's');
  await phoneInputCall(api, terms, 's', 'terminal.input', { data: 'hello' }, target);
  assert.deepEqual(api.calls[0], { method: 'terminal.input', session: 's', controllerPid: 7, attachmentId: 'before', data: 'hello' });
  replace();
  await assert.rejects(phoneInputCall(api, terms, 's', 'terminal.input', { data: 'late' }, target), { code: 'stale_attachment' });
  const after = phoneInputTarget(api, terms, 's'); api.generation++;
  await assert.rejects(phoneInputCall(api, terms, 's', 'terminal.input', { data: 'late' }, after), { code: 'stale_attachment' });
  terms.clear();
  await assert.rejects(phoneInputCall(api, terms, 's', 'terminal.focus'), { code: 'stale_attachment' });
  assert.equal(api.calls.length, 1);
});

test('keys pressed before reconnect cannot drain into the replacement attachment', async () => {
  const { api, terms, replace } = fixture(); let release; const errors = [];
  const q = keyQueue(async (keys, target) => {
    await phoneInputCall(api, terms, 's', 'session.keys', { keys }, target);
    await new Promise((r) => { release = r; });
  }, (e, n) => errors.push([e.code, n]), () => phoneInputTarget(api, terms, 's'));
  q.push('down'); await tick(); q.push('enter'); q.push('1'); replace(); release(); await tick();
  assert.deepEqual(api.calls.map((x) => x.keys), [['down']]);
  assert.deepEqual(errors, [['stale_attachment', 2]]); assert.equal(q.pending(), 0);
  q.push('esc'); await tick(); assert.equal(api.calls[1].attachmentId, 'after'); release(); await tick();
});

test('phone delivery and mission use live provider identity for Codex, Gemini and agy', () => {
  for (const kind of ['codex', 'gemini', 'agy']) {
    assert.deepEqual(sendPlan({ kind }, '한글\nsecond'), { method: 'session.send', text: '한글\nsecond' });
    const graph = { nodes: [{ id: 's', sessionId: 's', kind: 'session', name: 'fixture', state: 'ready', workspaceKey: null }], edges: [] };
    const result = phoneMission(graph, { live: new Map([['s', { kind, state: 'ready' }]]) });
    assert.equal(result.groups[0].rows[0].agentKind, kind);
  }
});
