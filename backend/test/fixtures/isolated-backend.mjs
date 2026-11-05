// Full Backend composition with only external process/discovery boundaries faked.
// Profiles, SQLite, HTTP, WebSocket, pairing, peers, and relay remain production code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { Backend } from '../../src/backend.mjs';
import { loadConfig } from '../../src/config.mjs';
import { HerdrAdapter } from '../../src/herdr/adapter.mjs';
import { ResourceMonitor } from '../../src/resources.mjs';
import { newRuntime } from '../../src/state.mjs';

export const tick = () => new Promise(r => setImmediate(r));
export const pause = ms => new Promise(r => setTimeout(r, ms));
export async function until(check, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await pause(10); } assert.fail('fixture condition timed out'); }
const pong = { version: '0.9.5', protocol: 22, capabilities: {} };
class Controller extends EventEmitter {
  constructor(cols, rows) { super(); this.pid = 707; this.cols = cols; this.rows = rows; this.inputs = []; this.exited = null; setImmediate(() => this.frame(true)); }
  frame(full, text = 'isolated terminal') { this.emit('frame', { full, width: this.cols, height: this.rows, bytes: Buffer.from(`\x1b[2J\x1b[H${text}`).toString('base64') }); }
  input(text) { this.inputs.push(text); this.frame(false, text); }
  resize(cols, rows) { this.cols = cols; this.rows = rows; this.frame(true); }
  close() { this.exited = 0; this.emit('exit', 0); }
}

export async function isolatedBackend(t, { dist, holdStartup = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-full-remote-'));
  const reserve = net.createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r));
  const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const hostname = 'fixture.example.ts.net';
  const tailscale = path.join(dir, 'synthetic-tailscale.mjs'), reads = path.join(dir, 'tailscale-reads');
  fs.writeFileSync(tailscale, `import fs from 'node:fs'; const command=process.argv.slice(2).join(' '); fs.appendFileSync(${JSON.stringify(reads)},command+'\\n');
if(command==='status --json') console.log(JSON.stringify({Version:'fixture',BackendState:'Running',Self:{DNSName:'${hostname}.',UserID:1},User:{1:{LoginName:'owner@example.com'}},CurrentTailnet:{MagicDNSEnabled:true},CertDomains:['${hostname}']}));
else if(command==='serve status --json') console.log(JSON.stringify({TCP:{443:{HTTPS:true}},Web:{'${hostname}:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:${port}'}}}}}));
else { console.error('mutation forbidden in fixture');process.exit(20); }
`);
  const envChanges = { ATRIUM_TAILSCALE: tailscale, ...(dist ? { ATRIUM_WEB_DIST: dist } : {}) };
  const previous = new Map(Object.keys(envChanges).map(k => [k, process.env[k]])); Object.assign(process.env, envChanges);
  const cfg = loadConfig({ argv: ['--dev'], env: {
    ATRIUM_PORT: String(port), ATRIUM_DATA_DIR: path.join(dir, 'data'), ATRIUM_HERDR_SESSION: `atrium-dev-fixture-${path.basename(dir)}`,
    ATRIUM_HERDR: path.join(dir, 'never-execute-herdr'), ATRIUM_CLAUDE_JSON: path.join(dir, 'claude.json'), ATRIUM_CLAUDE_PROJECTS: path.join(dir, 'projects'), ATRIUM_CLAUDE_SESSIONS: path.join(dir, 'live'), ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_CODEX_HOME: path.join(dir, 'codex'), ATRIUM_CODEX_HISTORY: '0', ATRIUM_CONVO_SCAN_MS: '3600000', ATRIUM_HERDR_UPDATE_MS: '3600000', ATRIUM_GIT_POLL_MS: '3600000', ATRIUM_RESOURCE_INTERVAL_MS: '3600000',
  } });
  cfg.claudeProjects = path.join(dir, 'projects');
  for (const folder of [cfg.dataDir, cfg.claudeProjects, cfg.claudeSessionsDir, cfg.codexHome]) fs.mkdirSync(folder, { recursive: true });
  const controllers = [], unexpected = [];
  t.mock.method(HerdrAdapter.prototype, 'call', async function(method) {
    if (method === 'ping') return pong;
    if (method === 'pane.read') return { read: { text: 'isolated terminal\nfixture $ ' } };
    if (method === 'pane.process_info') return { process_info: {} };
    if (method === 'agent.list') return { agents: [] };
    if (method === 'agent.kinds') return { kinds: [] };
    unexpected.push(method); throw new Error(`unexpected fake herdr request: ${method}`);
  });
  t.mock.method(HerdrAdapter.prototype, 'skillText', async () => '---\nname: herdr\ndescription: isolated test\n---\n');
  t.mock.method(HerdrAdapter.prototype, 'cliVersion', async () => 'herdr 0.9.5 fixture');
  t.mock.method(HerdrAdapter.prototype, 'serverPid', () => null);
  t.mock.method(HerdrAdapter.prototype, 'readClients', () => ({ available: true, clients: [] }));
  t.mock.method(HerdrAdapter.prototype, 'startEvents', function() { this.connected = true; });
  t.mock.method(HerdrAdapter.prototype, 'startServer', async () => assert.fail('real server startup forbidden'));
  t.mock.method(HerdrAdapter.prototype, 'stopServer', async () => assert.fail('real server shutdown forbidden'));
  t.mock.method(HerdrAdapter.prototype, 'openController', (_pane, cols, rows) => { const c = new Controller(cols, rows); controllers.push(c); return c; });
  const startResources = ResourceMonitor.prototype.start;
  t.mock.method(ResourceMonitor.prototype, 'start', function(fn) { this.readTable = async () => ({ procs: new Map(), herdr: [], at: Date.now() }); return startResources.call(this, fn); });
  const b = new Backend(cfg); let release;
  const gate = new Promise(r => { release = r; });
  b.resolveHerdr = async () => { if (holdStartup) await gate; b.herdrFind = { chosen: { path: cfg.herdrPath }, tried: [] }; b.lastFound = { path: cfg.herdrPath, version: '0.9.5' }; return b.herdrFind; };
  b.checkHerdrUpdate = async () => null;
  const starting = b.start().then(() => { b.recall.readProcs = async () => []; return b; });
  const sockets = new Set(); let stopping = false;
  const close = async () => {
    if (stopping) return; stopping = true; release();
    for (const ws of sockets) ws.terminate();
    await starting; await b.stop('isolated test');
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  t.after(close);
  await until(() => !!b.adapter);
  if (!holdStartup) await starting;
  const base = `http://127.0.0.1:${port}`;
  const remoteHeaders = { host: hostname, origin: `https://${hostname}`, 'tailscale-user-login': 'owner@example.com', 'x-forwarded-proto': 'https' };
  const open = async (query, headers = {}) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api?${query}`, { headers }); sockets.add(ws);
    const events = [], pending = new Map(); let n = 0;
    ws.on('message', raw => { const m = JSON.parse(String(raw)); if (m.event) events.push(m); else { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Object.assign(new Error(m.error.message), m.error)) : p.resolve(m.result); } });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return { ws, events, call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++n; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 6000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); }); } };
  };
  const desktop = name => open(`token=${b.apiToken}&client=${name}&kind=desktop`, { origin: 'file://' });
  const seedSession = () => {
    const rt = newRuntime({ kind: 'shell', hooked: false }); Object.assign(rt, { phase: 'running', shell: { atPrompt: true }, herdr: { present: true, launchPending: false, status: 'idle' } });
    const s = { sessionId: 'fixture-session', name: 'fixture-shell', kind: 'shell', origin: 'board', workspaceKey: null, cwd: dir, paneId: 'fixture-pane', permissionMode: 'manual', createdAt: Date.now(), rt };
    b.store.insertSession({ ...s, runtime: rt }); b.sessions.set(s.sessionId, s); b.store.setNode({ session_id: s.sessionId, x: 20, y: 20, w: 800, h: 440, z: 0 }); return s;
  };
  return { b, cfg, dir, port, base, hostname, remoteHeaders, reads, controllers, unexpected, open, desktop, seedSession, starting, release, close };
}
