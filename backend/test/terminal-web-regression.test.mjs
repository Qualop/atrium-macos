import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TerminalRelay } from '../src/relay.mjs';
import { ApiServer } from '../src/api.mjs';
import { WebServer } from '../src/web.mjs';
import { TailscaleWatch } from '../src/tailscale.mjs';
import { remoteCommand } from '../bin/atrium-remote.mjs';

const client = () => ({ events: [], sendEvent(event, data) { this.events.push({ event, data }); } });
function controller() {
  const c = new EventEmitter();
  Object.assign(c, { pid: 7, inputs: [], sizes: [], input(s) { this.inputs.push(s); }, resize(cols, rows) { this.sizes.push([cols, rows]); this.emit('frame', { full: true, width: cols, height: rows, bytes: Buffer.from('full').toString('base64') }); }, close() { this.exited = 0; this.emit('exit', 0); } });
  return c;
}
test('same-PID reattachment rejects old input, resize, focus, detach and drops batched frames', () => {
  const ctl = controller();
  const relay = new TerminalRelay({ adapter: { openController: () => ctl }, onInput() {} });
  const a = client(), b = client(); a.remote = true;
  const session = { sessionId: 's', paneId: 'p' };
  relay.attach(session, 100, 30, a, 'old'); relay.attach(session, 80, 24, b, 'peer');
  ctl.emit('frame', { full: false, bytes: Buffer.from('queued old data').toString('base64') });
  const oldBatch = relay.attached.get('s').batch.get(relay.keyOf(a));
  assert.ok(oldBatch.pending);
  const latest = relay.attach(session, 110, 32, a, 'new');
  assert.equal(latest.controllerPid, 7); assert.equal(oldBatch.pending, null);
  for (const op of [() => relay.input('s', 'bad', a, 7, 'old'), () => relay.resize('s', 20, 10, a, 7, 'old'), () => relay.focus('s', a, 7, 'old'), () => relay.detach('s', a, 7, 'old')]) assert.throws(op, { code: 'stale_attachment' });
  relay.input('s', 'good', a, 7, 'new');
  assert.deepEqual(ctl.inputs, ['good']);
  assert.equal(a.events.filter(x => x.event === 'terminal.frame').at(-1).data.attachmentId, 'new');
  relay.detach('s', a, 7, 'new'); assert.equal(ctl.exited, undefined);
  relay.detach('s', b, 7, 'peer'); assert.equal(ctl.exited, 0);
});

test('a late controller exit with a reused PID retains the old attachment identity', () => {
  const controls = [];
  const relay = new TerminalRelay({ adapter: { openController: () => { const c = controller(); controls.push(c); return c; } }, onInput() {} });
  const a = client(); const session = { sessionId: 's', paneId: 'p' };
  relay.attach(session, 80, 24, a, 'before'); controls[0].exited = 0;
  relay.attach(session, 80, 24, a, 'after'); controls[0].emit('exit', 0);
  assert.equal(a.events.at(-1).data.attachmentId, 'before');
  assert.equal(relay.attached.get('s').ctl, controls[1]);
  assert.throws(() => relay.detach('s', a, 7, 'before'), { code: 'stale_attachment' });
  relay.closeAll();
});

function fixture(t, cfg = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-remote-gate-'));
  const data = new Map(); const store = { getMeta: k => data.get(k), setMeta: (k, v) => data.set(k, v) };
  const watcher = { starts: 0, stops: 0, reads: 0, hosts: () => [], selfLogin: () => null, start() { this.starts++; }, stop() { this.stops++; }, async refresh() { this.reads++; return { installed: false }; } };
  const api = { clients: new Set() };
  const web = new WebServer({ cfg: { port: 47899, dataDir: dir, ...cfg }, store, api, tailscale: watcher });
  t.after(() => { web.stop(); rmSync(dir, { recursive: true, force: true }); });
  const local = { auth: { kind: 'local' } };
  const request = (url, headers = {}) => ({ url, headers: { host: '127.0.0.1:47899', ...headers }, socket: { remoteAddress: '127.0.0.1' }, method: 'POST', resume() {} });
  return { web, api, store, watcher, local, request };
}
test('remote defaults off but desktop auth and diagnostics remain available without Tailscale reads', async t => {
  const { web, local, request, watcher } = fixture(t);
  assert.equal(web.status().enabled, false);
  assert.deepEqual(web.authorize(request('/api?token=desktop', { origin: 'file://' }), 'desktop'), { kind: 'local' });
  const device = web.devices.add({ name: 'saved', via: 'code' });
  assert.equal(web.authorize(request(`/api?device=${device.token}`, { origin: 'http://127.0.0.1:47899' }), 'desktop'), null);
  for (const url of ['/web/pair/code', '/web/pair/request', '/web/pair/poll', '/web/me', '/web/upload']) {
    const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
    assert.equal(web.handleHttp(request(url), res), true);
    assert.equal(res.status, 403); assert.equal(res.body.error.code, 'remote_disabled');
  }
  assert.throws(() => web.handlers()['device.code']({}, local), { code: 'remote_disabled' });
  assert.equal((await web.remoteStatus({ fresh: true })).ready, false); assert.equal(watcher.reads, 0);
});

test('local-only saved opt-in enables pairing; disabling cancels pairing and closes web sockets', t => {
  const { web, api, store, watcher, local, request } = fixture(t);
  const configure = web.handlers()['remote.configure'];
  assert.throws(() => configure({ enabled: true }, { auth: { kind: 'device' } }), { code: 'forbidden' });
  assert.throws(() => configure({ enabled: 'true' }, local), { code: 'bad_request' });
  assert.equal(configure({ enabled: true }, local).enabled, true); assert.equal(store.getMeta('remoteEnabled'), true); assert.equal(watcher.starts, 1);
  const code = web.handlers()['device.code']({}, local).code;
  const device = web.pairing.redeem({ code, name: 'browser', ip: 'test' });
  assert.equal(web.authorize(request(`/api?device=${device.token}`, { origin: 'http://127.0.0.1:47899' }), 'desktop').kind, 'device');
  web.pairing.newCode(); web.pairing.request({ name: 'pending', ip: 'test' });
  const closed = []; api.clients.add({ auth: { kind: 'device' }, ws: { close: (...args) => closed.push(args) } });
  assert.equal(configure({ enabled: false }, local).enabled, false);
  assert.equal(closed[0][0], 4401); assert.equal(web.pairing.code, null); assert.equal(web.pairing.requests.size, 0); assert.equal(watcher.stops, 1);
});

test('an explicit environment setting overrides saved remote opt-in', t => {
  const { web, store, local } = fixture(t, { remoteExplicit: true, remoteEnabled: false });
  store.setMeta('remoteEnabled', true); assert.equal(web.remoteEnabled(), false);
  assert.throws(() => web.handlers()['remote.configure']({ enabled: true }, local), { code: 'remote_locked' });
});

class Socket extends EventEmitter {
  OPEN = 1; readyState = 1; messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit('close'); }
}
const tick = () => new Promise(r => setImmediate(r));
test('API validates payloads before ready, waits for late handlers, and ignores queued requests after close', async t => {
  let ready; const gate = new Promise(r => { ready = r; }); let calls = 0;
  const handlers = {};
  const api = new ApiServer({ token: 'test', handlers, ready: gate, onClose() {} }); t.after(() => api.close());
  const ws = new Socket(); api._connection(ws, { url: '/api' });
  for (const m of [null, [], { method: 'valid', params: [] }, { method: 1 }]) ws.emit('message', JSON.stringify(m));
  assert.equal(ws.messages.length, 4); assert.ok(ws.messages.every(m => m.error.code === 'bad_request'));
  ws.emit('message', JSON.stringify({ id: 'wait', method: 'valid' }));
  ws.emit('message', JSON.stringify({ id: 'proto', method: 'toString' }));
  await tick(); assert.equal(calls, 0);
  handlers.valid = () => { calls++; return 'ready'; }; ready(); await tick();
  assert.equal(calls, 1); assert.equal(ws.messages.find(m => m.id === 'wait').result, 'ready');
  assert.equal(ws.messages.find(m => m.id === 'proto').error.code, 'unknown_method');
  const closed = new Socket(); api._connection(closed, { url: '/api' });
  closed.emit('message', JSON.stringify({ id: 9, method: 'valid' })); closed.close(); await tick(); assert.equal(calls, 1);
});

test('failed readiness returns an API error without invoking startup handlers', async t => {
  let reject; const ready = new Promise((_, no) => { reject = no; });
  const api = new ApiServer({ token: 'test', handlers: { run() { assert.fail('must not run'); } }, ready, onClose() {} }); t.after(() => api.close());
  const ws = new Socket(); api._connection(ws, { url: '/api' }); ws.emit('message', JSON.stringify({ id: 1, method: 'run' }));
  reject(new Error('startup failed')); await tick(); assert.equal(ws.messages[0].error.message, 'startup failed');
});

test('stopping a Tailscale watcher cancels even its initial delayed read', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); let reads = 0;
  const watcher = new TailscaleWatch({ port: 1, bin: 'fake', run: async () => { reads++; return '{}'; } });
  watcher.start(50); watcher.stop(); t.mock.timers.tick(100_000); await tick(); assert.equal(reads, 0);
});

test('remote CLI dry runs do not configure the board or mutate Tailscale; --yes uses injected fake runner', async t => {
  t.mock.method(console, 'log', () => {});
  const calls = [], changes = [];
  const connect = async () => ({ call: async (method, params) => calls.push([method, params]), close() {} });
  const deps = { bin: () => 'fake-tailscale', read: async () => ({ installed: true, status: { running: true, https: true }, serve: { entries: [], funnel: [] } }), change: async (bin, args) => { changes.push([bin, args]); return ''; } };
  await remoteCommand({ port: 47899 }, ['enable'], {}, connect, deps); assert.equal(calls.length, 0); assert.equal(changes.length, 0);
  await remoteCommand({ port: 47899 }, ['enable'], { yes: true }, connect, deps);
  assert.deepEqual(calls, [['remote.configure', { enabled: true }]]); assert.equal(changes.length, 1); assert.equal(changes[0][0], 'fake-tailscale');
});

test('remote disable --yes closes the board gate even when Tailscale is unavailable', async t => {
  t.mock.method(console, 'log', () => {});
  const oldExit = process.exitCode; t.after(() => { process.exitCode = oldExit; });
  const calls = [];
  await remoteCommand({ port: 47899 }, ['disable'], { yes: true }, async () => ({ call: async (method, params) => calls.push([method, params]), close() {} }), {
    bin: () => null, read: async () => ({ installed: false }), change: async () => assert.fail('no Tailscale mutation'),
  });
  assert.deepEqual(calls, [['remote.configure', { enabled: false }]]);
});
