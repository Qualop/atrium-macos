// Integration against actual Backend/Branch/Recall/Sleeper handlers. Every
// external process, native thread, prompt and credential in this file is fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Backend } from '../src/backend.mjs';
import { loadConfig } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { DeliveryQueue } from '../src/delivery.mjs';
import { Branch } from '../src/branch.mjs';
import { attachFeatures } from '../src/features.mjs';
import { Sleeper } from '../src/sleep.mjs';
import { Recall } from '../src/recall.mjs';
import { DesktopImport } from '../src/desktop-import.mjs';
import { CodexHistory } from '../src/codex-import.mjs';
import { newRuntime, applyAgentDetected, applyHerdrStatus, deriveState } from '../src/state.mjs';
import { transcriptPathFor } from '../src/launch.mjs';

const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-00000000c035`;
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function drain(queue) { for (let n = 0; n < 30; n++) { await tick(); if (!queue.sending.size) return; } assert.fail('fake delivery did not settle'); }

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-codex-integration-'));
  const data = path.join(root, 'data'), home = path.join(data, 'codex'), repo = path.join(root, 'repo');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(repo);
  const cfg = loadConfig({ argv: [], env: { ATRIUM_PROFILE: 'dev', ATRIUM_DATA_DIR: data, ATRIUM_CODEX_HOME: home, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_CLAUDE_SESSIONS: path.join(root, 'claude-sessions'), ATRIUM_CLAUDE_PROJECTS: path.join(root, 'claude-projects'), ATRIUM_HERDR_SESSION: 'atrium-dev-codex-integration', ATRIUM_PORT: '47991' } });
  cfg.claudeProjects = path.join(root, 'claude-projects'); cfg.claudeJson = path.join(root, 'claude-config.json');
  const b = new Backend(cfg); b.store = new Store(cfg.dbFile); b.apiToken = 'synthetic-board-token'; b.herdrOk = true;
  b.hookUrl = 'http://127.0.0.1:1/hooks/claude'; b.plugin = { pluginDir: path.join(data, 'plugin') };
  const calls = [], packets = [], native = new Map(), agents = new Map(); let pane = 0, nextNative = 100;
  const thread = (id, extra = {}) => ({ id, cwd: repo, updatedAt: 1, source: 'appServer', model: 'fixture-code', name: 'Synthetic history', preview: 'Synthetic history prompt', status: { type: 'notLoaded' }, ephemeral: false, historyMode: 'paginated', turns: [{ id: 'turn-one', startedAt: 1, items: [{ type: 'userMessage', content: [{ type: 'text', text: 'Synthetic history prompt' }] }, { type: 'agentMessage', text: 'Synthetic answer from history' }] }], ...extra });
  native.set(ID(1), thread(ID(1)));
  const rpc = { async request(method, params) {
    calls.push(['rpc', method, params]);
    if (method === 'thread/list') return { data: [...native.values()], nextCursor: null };
    if (method === 'model/list') return { data: [{ model: 'fixture-code', displayName: 'Fixture Code', isDefault: true }], nextCursor: null };
    const src = native.get(params.threadId); if (!src) throw Object.assign(new Error('synthetic missing thread'), { code: 'not_found' });
    if (method === 'thread/read') return { thread: { ...src, turns: params.includeTurns ? src.turns : [] } };
    if (method === 'thread/turns/list') return { data: src.turns, nextCursor: null };
    if (method === 'thread/fork') { const id = ID(++nextNative), copy = thread(id, { forkedFromId: params.threadId, turns: structuredClone(src.turns) }); native.set(id, copy); return { thread: copy, model: 'fixture-code' }; }
    assert.fail(`unexpected native mutation: ${method}`);
  } };
  const history = new CodexHistory(cfg, { connect: async (fn) => fn(rpc) });
  b.api = { handlers: {}, broadcast: (...p) => packets.push(p) };
  b.adapter = {
    connected: true, herdrPath: '/synthetic/herdr', agentKinds: async () => [{ kind: 'codex' }, { kind: 'claude' }],
    createWorkspace: async (p) => { calls.push(['create', p]); return { paneId: `p${++pane}`, workspaceId: `w${pane}` }; },
    refreshSubscription: async () => {}, waitShellReady: async () => true,
    startAgent: async (p) => { calls.push(['start', p]); const nativeId = p.args[0] === 'resume' ? p.args[1] : ID(++nextNative); if (!native.has(nativeId)) native.set(nativeId, thread(nativeId)); agents.set(p.name, { agentSessionId: nativeId, launchPending: false }); return { agent: { launchPending: true }, argv: [p.kind, ...p.args] }; },
    getAgent: async (name) => agents.get(name), getPane: async () => ({ agent: null }),
    prompt: async (name, text) => { calls.push(['prompt', name, text]); const s = b.resolve(name); b.queue.onAgentWorking(s.sessionId); return {}; },
    closePane: async (id) => calls.push(['close', id]),
    sendText: async (id, text) => calls.push(['text', id, text]), paneKeys: async (id, keys) => calls.push(['keys', id, keys]),
    readScreen: async () => '',
  };
  b.log = () => {}; b.probeGit = () => {}; b.memOf = () => null;
  b.relay = { stats: () => [], detach() {} };
  b.ensureWorkspace = (ws) => { if (!b.store.getWorkspace(ws.key)) b.store.insertWorkspace({ ...ws, createdAt: Date.now() }); };
  b.workspaceList = () => b.store.workspaces().map((w) => ({ ...w, name: path.basename(w.root) }));
  b.closeSession = (s, reason) => { b.store.updateSession(s.sessionId, { closedAt: Date.now(), runtime: s.rt, closeReason: reason }); b.sessions.delete(s.sessionId); };
  b.queue = new DeliveryQueue({ store: b.store, cfg, view: (sid, d) => b.deliveryView(sid, d), send: (sid, text) => b.promptManaged(sid, text) });
  b.features = attachFeatures(b, { timers: false });
  b.branch = new Branch(b, { readyWaitMs: 0, fetchModels: async () => ({ ok: true, models: [] }) });
  b.agentModels = async ({ kind }) => ({ models: kind === 'codex' ? [{ id: 'fixture-code', name: 'Fixture Code' }] : [] });
  b.recall = new Recall(b, { readProcs: async () => [] }); b.recall.changed = async () => {};
  b.sleeper = new Sleeper(b, { timers: false, staggerMs: 0, settleMs: 0 }); b.sleeper.measure = async () => ({ procs: [], memMB: 0 });
  b.desktopImport = new DesktopImport(b, { codex: history, list: () => [], live: () => new Map() });
  Object.assign(b.api.handlers, b.handlers(), b.features.handlers, b.sleeper.handlers, b.desktopImport.handlers);
  const ready = async (s) => { applyAgentDetected(s.rt); applyHerdrStatus(s.rt, 'idle'); await b.refreshAgent(s); b.broadcastSession(s); };
  t.after(async () => { b.stopping = true; b.queue.items.clear(); await drain(b.queue); b.features.stop(); b.sleeper.stop(); b.store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { b, root, repo, cfg, calls, packets, native, agents, ready };
}

const developerArgs = ['-c', 'developer_instructions="Synthetic user developer instructions"', '--sandbox', 'read-only'];
const launch = (f, extra = {}) => f.b.spawn({ kind: 'codex', cwd: f.repo, name: 'parent', model: 'fixture-code', args: developerArgs, ...extra });

test('real handlers: launch → queued context → worker/reviewer delegation → native ID → explicit history', async (t) => {
  const f = fixture(t), { b } = f;
  const out = await launch(f, { prompt: 'Synthetic first task' }), s = b.sessions.get(out.sessionId);
  const argv = f.calls.find(([k]) => k === 'start')[1].args;
  assert.ok(argv.includes(developerArgs[1])); assert.ok(!argv.some((a) => a.includes('Synthetic first task') || a.includes('This session runs on')));
  assert.equal(s.rt.codexSessionId, undefined); assert.equal(b.queue.pending(s.sessionId), 1);
  await f.ready(s); await drain(b.queue);
  const sent = f.calls.filter(([k]) => k === 'prompt');
  assert.equal(sent.length, 1); assert.equal(sent[0][2], s.rt.codexContext + '\n\nSynthetic first task');
  assert.equal(s.rt.codexBriefed, true); assert.equal(s.rt.codexSessionId, f.agents.get('parent').agentSessionId);
  const cred = JSON.parse(fs.readFileSync(s.settingsPath));
  assert.equal(b.branch.auth({ 'x-mt-session': s.sessionId, authorization: `Bearer ${cred.ATRIUM_SESSION_TOKEN}` }, 'child').s, s);
  const models = await b.branch.listModels(s);
  assert.ok(models.entries.some((m) => m.kind === 'codex' && m.model === 'fixture-code'));
  for (const role of ['worker', 'reviewer']) {
    const child = await b.branch.spawnChild(s, { name: role, kind: 'codex', model: 'Fixture Code', role, prompt: `Synthetic ${role} task`, wait: false });
    const c = b.sessions.get(child.sessionId); assert.equal(c.parentSessionId, s.sessionId); assert.equal(c.model, 'fixture-code');
    assert.equal(b.store.branchRows().find((r) => r.sessionId === c.sessionId).branch.role, role);
    await f.ready(c); await drain(b.queue);
    assert.equal(f.calls.filter(([k, name]) => k === 'prompt' && name === role).length, 1);
  }
  b.queue.enqueue(s.sessionId, 'Synthetic follow-up'); await drain(b.queue);
  assert.equal(f.calls.filter(([k, name]) => k === 'prompt' && name === 'parent').at(-1)[2], 'Synthetic follow-up');
  const displayed = await b.api.handlers['session.messages']({ session: s.sessionId });
  assert.deepEqual(displayed.messages.map((m) => m.text), ['Synthetic history prompt', 'Synthetic answer from history']);
  assert.ok(f.calls.filter(([k]) => k === 'rpc').every(([, m]) => ['thread/read', 'thread/turns/list'].includes(m)));
});

test('real import/wake/restart handlers retain copy ID, scoped context and original history', async (t) => {
  const f = fixture(t), { b } = f, original = structuredClone(f.native.get(ID(1)));
  const r = await b.api.handlers['desktop.import']({ selections: [{ provider: 'codex', appSessionId: ID(1) }] });
  assert.equal(r.imported.length, 1, JSON.stringify(r));
  let s = b.sessions.get(r.imported[0].sessionId), copied = s.rt.codexSessionId;
  assert.notEqual(copied, ID(1)); assert.equal(deriveState(s.rt).state, 'sleeping');
  await b.api.handlers['session.wake']({ session: s.sessionId }); await f.ready(s);
  b.queue.enqueue(s.sessionId, 'Synthetic copied task'); await drain(b.queue);
  // Persist through the actual normal runtime-write path before rehydration.
  b.broadcastSession(s);
  const stored = b.store.getSession(s.sessionId), context = s.rt.codexContext;
  b.sessions.delete(s.sessionId); s = { ...stored, rt: structuredClone(stored.runtime), lastState: null }; b.sessions.set(s.sessionId, s);
  await b.recall.restoreNativeAgent(s); await f.ready(s);
  assert.equal(s.rt.codexSessionId, copied); assert.equal(s.rt.codexImportedFrom, ID(1)); assert.equal(s.rt.codexContext, context); assert.equal(s.rt.codexBriefed, true);
  const starts = f.calls.filter(([k]) => k === 'start'); assert.equal(starts.length, 2);
  assert.ok(starts.every(([, p]) => p.args[0] === 'resume' && p.args[1] === copied));
  b.queue.enqueue(s.sessionId, 'Synthetic post-restart task'); await drain(b.queue);
  assert.equal(f.calls.filter(([k]) => k === 'prompt').at(-1)[2], 'Synthetic post-restart task');
  const display = await b.api.handlers['session.messages']({ session: s.sessionId }); assert.equal(display.messages.at(-1).text, 'Synthetic answer from history');
  assert.deepEqual(f.native.get(ID(1)), original);
  assert.ok(!f.calls.some(([k, m]) => k === 'rpc' && /resume|archive|turn\/start/.test(m)));
});

test('supported sleep boundary rejects active Codex without sending Claude exit commands', async (t) => {
  const f = fixture(t), out = await launch(f), s = f.b.sessions.get(out.sessionId); await f.ready(s);
  await assert.rejects(f.b.sleeper.sleep(s, { by: 'hand' }), { code: 'sleep_not_claude' });
  assert.ok(!f.calls.some(([k]) => k === 'text' || k === 'keys' || k === 'close'));
  assert.equal(s.rt.sleep, null);
});

test('successful first board prompt persists codexBriefed before any later state event', async (t) => {
  const f = fixture(t), out = await launch(f), s = f.b.sessions.get(out.sessionId); await f.ready(s); await drain(f.b.queue);
  await f.b.promptManaged(s.sessionId, 'Synthetic prompt');
  assert.equal(f.b.store.getSession(s.sessionId).runtime.codexBriefed, true);
});

test('native UUID observed after idle event is persisted without another broadcast', async (t) => {
  const f = fixture(t), out = await launch(f), s = f.b.sessions.get(out.sessionId);
  await f.b.refreshAgent(s);
  assert.equal(f.b.store.getSession(s.sessionId).runtime.codexSessionId, f.agents.get('parent').agentSessionId);
});

test('explicit output.get for a sleeping Codex copy uses native history', async (t) => {
  const f = fixture(t), r = await f.b.desktopImport.importMany({ selections: [{ provider: 'codex', appSessionId: ID(1) }] });
  const out = await f.b.api.handlers['output.get']({ session: r.imported[0].sessionId });
  assert.equal(out.source, 'transcript'); assert.equal(out.turn.markdown, 'Synthetic answer from history');
  assert.ok(!f.calls.some(([k]) => k === 'start'));
});

function addClosed(f, { kind = 'shell', command, env = { PRIVATE: 'synthetic-private-value' }, id = ID(900), eventCommand = '[command]' } = {}) {
  const rt = newRuntime({ kind, hooked: false }); rt.launcherEnv = env; if (command !== undefined) rt.launcherCommand = command;
  f.b.store.insertSession({ sessionId: id, name: 'command-preset', cwd: f.repo, kind, origin: 'board', permissionMode: 'manual', settingsPath: '', hookToken: '', runtime: rt, createdAt: 1, touchedAt: 1 });
  f.b.store.updateSession(id, { closedAt: 2 });
  f.b.store.addEvent(id, 'spawn', { kind, args: ['--sandbox', 'read-only'], ...(kind === 'shell' ? { command: eventCommand } : {}) });
  return id;
}

test('command-preset reopen replays exact private raw command and env across two reopens', async (t) => {
  const f = fixture(t), command = '  tool --value "synthetic private command"  ', id = addClosed(f, { command });
  for (let i = 0; i < 2; i++) {
    const out = await f.b.recall.reopen({ session: id }); const s = f.b.sessions.get(id);
    assert.equal(out.command, '[command]'); assert.equal(s.rt.launcherCommand, command);
    assert.deepEqual(f.calls.filter(([k]) => k === 'create').at(-1)[1].env, { PRIVATE: 'synthetic-private-value' });
    assert.equal(f.calls.filter(([k]) => k === 'text').at(-1)[2], command);
    assert.deepEqual(f.calls.filter(([k]) => k === 'keys').at(-1)[2], ['enter']);
    assert.ok(!JSON.stringify(f.b.store.events({ sessionId: id })).includes('synthetic private command'));
    f.b.closeSession(s, 'test close');
  }
  assert.equal(f.calls.filter(([k]) => k === 'text').length, 2);
});

for (const step of ['not_ready', 'pane_changed', 'killing', 'after_text']) test(`saved command guarded against ${step}`, async (t) => {
  const f = fixture(t), id = addClosed(f, { command: 'synthetic-tool' });
  f.b.adapter.waitShellReady = async () => {
    const s = f.b.sessions.get(id);
    if (step === 'pane_changed') s.paneId = 'replacement-pane';
    if (step === 'killing') f.b.killing.add(id);
    return step !== 'not_ready';
  };
  if (step === 'after_text') f.b.adapter.sendText = async (pane, text) => { f.calls.push(['text', pane, text]); f.b.killing.add(id); };
  await assert.rejects(f.b.recall.reopen({ session: id }), { code: step === 'not_ready' ? 'shell_not_ready' : 'closed' });
  assert.equal(f.calls.filter(([k]) => k === 'text').length, step === 'after_text' ? 1 : 0);
  assert.ok(!f.calls.some(([k]) => k === 'keys'));
  assert.ok(!f.calls.some(([k, pane]) => k === 'close' && pane === 'replacement-pane'));
});

test('redacted command placeholder cannot be replayed; legacy Codex env is passed separately', async (t) => {
  const f = fixture(t), id = addClosed(f);
  await assert.rejects(f.b.recall.reopen({ session: id }), { code: 'command_unavailable' });
  assert.ok(!f.calls.some(([k]) => k === 'create'));
  const legacy = addClosed(f, { kind: 'codex', id: ID(901) });
  await f.b.recall.reopen({ session: legacy });
  assert.deepEqual(f.calls.find(([k]) => k === 'create')[1].env, { PRIVATE: 'synthetic-private-value' });
  assert.deepEqual(f.calls.find(([k]) => k === 'start')[1].args, ['--sandbox', 'read-only']);
});

test('native output.save uses copied history without starting an agent', async (t) => {
  const f = fixture(t), r = await f.b.desktopImport.importMany({ selections: [{ provider: 'codex', appSessionId: ID(1) }] });
  const saved = await f.b.api.handlers['output.save']({ session: r.imported[0].sessionId });
  assert.ok(saved.saved); assert.match(fs.readFileSync(saved.file, 'utf8'), /Synthetic answer from history/);
  assert.ok(saved.file.startsWith(path.join(f.cfg.dataDir, 'outputs') + path.sep));
  assert.ok(!f.calls.some(([k]) => k === 'start'));
});

test('native output cannot be saved to a replacement session after a late history response', async (t) => {
  const f = fixture(t), r = await f.b.desktopImport.importMany({ selections: [{ provider: 'codex', appSessionId: ID(1) }] });
  const sid = r.imported[0].sessionId, read = f.b.desktopImport.codex.turns.bind(f.b.desktopImport.codex);
  f.b.desktopImport.codex.turns = async (id) => {
    const turns = await read(id), s = f.b.sessions.get(sid);
    f.b.sessions.set(sid, { ...s, rt: structuredClone(s.rt) });
    return turns;
  };
  await assert.rejects(f.b.api.handlers['output.save']({ session: sid }), { code: 'closed' });
  assert.equal(fs.existsSync(path.join(f.cfg.dataDir, 'outputs')), false);
});

test('a reused agent name cannot poison a fresh Codex UUID or send its first prompt to another pane', async t => {
  const f = fixture(t), out = await launch(f), s = f.b.sessions.get(out.sessionId);
  f.b.adapter.getAgent = async () => ({ paneId: 'other-pane', agentSessionId: ID(999) });
  await f.ready(s);
  assert.equal(s.rt.codexSessionId, undefined);
  f.b.adapter.getPane = async paneId => ({ paneId, agent: 'codex' });
  const targets = [];
  f.b.adapter.prompt = async target => { targets.push(target); return {}; };
  await f.b.promptManaged(s.sessionId, 'Synthetic first task');
  assert.deepEqual(targets, [s.paneId]);
  assert.equal(s.rt.codexSessionId, undefined);
});

test('first task is durable while native agent startup is still pending', async t => {
  const f = fixture(t);
  let release, entered;
  const waiting = new Promise(r => { release = r; });
  const started = new Promise(r => { entered = r; });
  const original = f.b.adapter.startAgent;
  f.b.adapter.startAgent = async p => { entered(); await waiting; return original(p); };
  const pending = launch(f, { prompt: 'Synthetic durable first task' });
  try {
    await started;
    const s = f.b.resolve('parent');
    assert.equal(f.b.queue.pending(s.sessionId), 1);
    const deliveries = f.b.store.activeDeliveries();
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].text, 'Synthetic durable first task');
    assert.equal(deliveries[0].status, 'queued');
  } finally { release(); await pending; }
});
