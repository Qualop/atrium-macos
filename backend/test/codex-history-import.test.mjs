import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { CodexProtocol, codexPages } from '../src/codex-protocol.mjs';
import { CodexHistory, codexImportAllowed } from '../src/codex-import.mjs';
import { DesktopImport } from '../src/desktop-import.mjs';
import { Store } from '../src/store.mjs';
import { transcriptPathFor } from '../src/launch.mjs';
import { workspaceFromProbe } from '../src/workspaces.mjs';
import { codexRecovery, codexResumeArgs, prepareCodexSession, recordCodexSessionId, wakeCodexSession } from '../src/codex-session.mjs';
import { Recall } from '../src/recall.mjs';
import { readCodexMessages } from '../src/transcript.mjs';

const id = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-00000000c034`;
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-codex-import-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function nativeThread(root, n = 1, extra = {}) { return { id: id(n), cwd: root, name: 'Synthetic history', preview: 'Synthetic prompt', updatedAt: 100, source: 'appServer', model: 'fixture-model', status: { type: 'notLoaded' }, turns: [], ...extra }; }
function fakeHistory(root, { failFork = false, copyId = id(2), model = 'fixture-model', source = {}, turns = [] } = {}) {
  const calls = [];
  const rpc = { async request(method, params) {
    calls.push({ method, params });
    if (method === 'thread/list') return { data: [nativeThread(root, 1, source)], nextCursor: null };
    if (method === 'thread/read') return { thread: nativeThread(root, params.threadId === id(1) ? 1 : 2, { ...source, turns: params.includeTurns ? turns : [] }) };
    if (method === 'thread/turns/list') return { data: turns, nextCursor: null };
    if (method === 'model/list') return { data: [{ model, displayName: 'Synthetic catalog', isDefault: true }], nextCursor: null };
    if (method === 'thread/fork') {
      if (failFork) throw Object.assign(new Error('synthetic private diagnostic'), { code: 'codex_protocol_timeout' });
      return { thread: { ...nativeThread(root, 2), id: copyId, forkedFromId: id(1) }, model, reasoningEffort: 'high' };
    }
    throw new Error(`Unexpected method ${method}`);
  } };
  return { history: new CodexHistory({ profile: 'real' }, { connect: async (fn) => fn(rpc) }), calls, rpc };
}
function fixture(t, options = {}) {
  const root = temp(t), repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  const store = new Store(path.join(root, 'board.db')); t.after(() => store.close());
  const cfg = { profile: 'real', desktopSessionsDir: path.join(root, 'desktop'), claudeProjects: path.join(root, 'projects'), claudeSessionsDir: path.join(root, 'live'), sessionsDir: path.join(root, 'settings'), dataDir: root, claudeCommand: 'claude' };
  const notifications = [], history = fakeHistory(repo, options), infos = [];
  const b = { cfg, store, sessions: new Map(), hookUrl: 'http://127.0.0.1:1/hooks/claude', killing: new Set(),
    ensureWorkspace(ws) { store.insertWorkspace({ ...ws, createdAt: Date.now() }); }, broadcastSession() {}, api: { broadcast: (...args) => notifications.push(args) },
    features: { launchers: { data: () => ({ items: [], favorites: [] }) } },
  };
  let serial = 10;
  const imp = new DesktopImport(b, { codex: history.history, list: () => infos, live: () => new Map(), resolveWs: async () => workspaceFromProbe(null, repo), newId: () => id(++serial) }); b.desktopImport = imp;
  const claude = () => {
    infos.push({ provider: 'claude', sessionId: 'local_fixture', cliSessionId: id(1), priorCliSessionIds: [], cwd: repo, title: 'Synthetic Claude' });
    const file = transcriptPathFor(cfg.claudeProjects, repo, id(1)); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ type: 'user', sessionId: id(1), uuid: 'u1', message: { content: 'synthetic prompt' } }) + '\n' + JSON.stringify({ type: 'assistant', sessionId: id(1), uuid: 'a1', message: { content: [{ type: 'text', text: 'synthetic answer' }] } }) + '\n'); return file;
  };
  return { root, repo, store, cfg, b, imp, notifications, claude, ...history };
}
const pick = (provider, appSessionId) => ({ selections: [{ provider, appSessionId }] });

test('list exposes providers with zero selection; empty import makes no protocol calls', async (t) => {
  const f = fixture(t); f.claude();
  const r = await f.imp.list();
  assert.deepEqual(r.sources.map((s) => [s.provider, s.allowed]), [['claude', true], ['codex', true]]);
  const items = r.repos.flatMap((r) => r.items);
  assert.equal(items.length, 2); assert.ok(items.every((i) => !i.pick && i.selectionId.startsWith(i.provider + ':')));
  assert.equal(items.find((i) => i.provider === 'codex').runningKnown, false);
  assert.deepEqual(f.calls.map((c) => c.method), ['thread/list']);
  const count = f.calls.length;
  assert.equal((await f.imp.importMany({})).total, 0); assert.equal(f.calls.length, count);
  await assert.rejects(f.imp.importMany({ all: true }), { code: 'selection_required' });
});

test('Codex copies only selected history using catalog models, stores distinct board/native IDs, and never starts a turn', async (t) => {
  const f = fixture(t, { model: 'fixture-catalog-new' }); const source = f.claude(); const before = fs.readFileSync(source);
  const r = await f.imp.importMany({ selections: [{ provider: 'codex', appSessionId: id(1) }, { provider: 'codex', appSessionId: id(1) }] });
  assert.equal(r.imported.length, 1, JSON.stringify(r)); assert.equal(r.total, 1);
  const row = r.imported[0], s = f.b.sessions.get(row.sessionId);
  assert.notEqual(row.sessionId, row.convId); assert.equal(row.convId, id(2)); assert.equal(s.kind, 'codex');
  assert.equal(s.rt.codexSessionId, id(2)); assert.equal(s.rt.sleep.convId, id(2)); assert.equal(s.rt.codexIntegration, true); assert.ok(s.hookToken);
  assert.equal(row.model, 'fixture-catalog-new'); assert.deepEqual(row.replaced, ['model']);
  assert.equal(s.rt.lastPrompt, 'Synthetic prompt'); assert.equal(s.paneId, null);
  assert.deepEqual(fs.readFileSync(source), before);
  assert.equal(f.store.latestDesktopImports('codex').get(id(1)).newConv, id(2));
  assert.equal(f.store.latestDesktopImports().size, 0);
  assert.deepEqual(f.calls.map((c) => c.method), ['thread/list', 'thread/read', 'model/list', 'thread/fork']);
  const request = f.calls.at(-1).params;
  assert.deepEqual(request, { threadId: id(1), cwd: f.repo, model: 'fixture-catalog-new', excludeTurns: true });
  assert.equal((await f.imp.importMany(pick('codex', id(1)))).skipped[0].reason, 'already');
});

test('ledger namespaces preserve old Claude rows and independent generations', (t) => {
  const { store } = fixture(t);
  const row = { appSessionId: id(1), sourceConv: id(1), newConv: id(2), sessionId: id(3), pointLines: 0 };
  store.addDesktopImport(row); store.addDesktopImport({ ...row, provider: 'codex' }); store.addDesktopImport({ ...row, provider: 'codex' });
  assert.equal(store.latestDesktopImports('claude').get(id(1)).gen, 1);
  assert.equal(store.latestDesktopImports('codex').get(id(1)).gen, 2);
  assert.equal(store.latestDesktopImports(null).size, 2);
});

for (const point of ['setNode', 'addDesktopImport', 'addEvent']) test(`Claude ${point} failure rolls back row/node/ledger/files and never touches original`, async (t) => {
  const f = fixture(t), source = f.claude(), original = fs.readFileSync(source);
  f.store[point] = () => { throw new Error('synthetic failure'); };
  const r = await f.imp.importMany(pick('claude', 'local_fixture'));
  assert.equal(r.imported.length, 0); assert.equal(r.skipped.length, 1);
  assert.equal(f.store.openSessions().length, 0); assert.equal(f.store.nodes().length, 0); assert.equal(f.store.desktopImports().length, 0);
  assert.equal(f.b.sessions.size, 0); assert.deepEqual(fs.readFileSync(source), original);
  assert.equal(fs.existsSync(transcriptPathFor(f.cfg.claudeProjects, f.repo, id(11))), false);
  assert.equal(fs.existsSync(path.join(f.cfg.sessionsDir, id(11) + '.json')), false);
  assert.equal(f.notifications.some(([event]) => event === 'session.created'), false);
});

test('new UUID equal to original or pre-existing settings cannot overwrite sources', async (t) => {
  const f = fixture(t), source = f.claude(), original = fs.readFileSync(source);
  f.imp.newId = () => id(1);
  assert.equal((await f.imp.importMany(pick('claude', 'local_fixture'))).skipped[0].reason, 'id_collision');
  f.imp.newId = () => id(11);
  fs.mkdirSync(f.cfg.sessionsDir); const settings = path.join(f.cfg.sessionsDir, id(11) + '.json'); fs.writeFileSync(settings, 'KEEP');
  assert.equal((await f.imp.importMany(pick('claude', 'local_fixture'))).skipped[0].reason, 'EEXIST');
  assert.deepEqual(fs.readFileSync(source), original); assert.equal(fs.readFileSync(settings, 'utf8'), 'KEEP');
});

test('notification failure cannot undo a committed copy', async (t) => {
  const f = fixture(t); f.claude(); f.b.api.broadcast = () => { throw new Error('offline'); };
  const r = await f.imp.importMany(pick('claude', 'local_fixture'));
  assert.equal(r.imported.length, 1); assert.equal(f.store.openSessions().length, 1);
  assert.ok(fs.existsSync(transcriptPathFor(f.cfg.claudeProjects, f.repo, r.imported[0].convId)));
});

test('Codex registration failure reports preserved fork ID without archiving or deleting any native thread', async (t) => {
  const f = fixture(t); f.store.setNode = () => { throw new Error('private error'); };
  const r = await f.imp.importMany(pick('codex', id(1)));
  assert.equal(r.skipped[0].orphanForkId, id(2)); assert.equal(r.skipped[0].message, 'import_failed');
  assert.equal(f.store.openSessions().length, 0); assert.equal(f.store.desktopImports().length, 0); assert.equal(f.b.sessions.size, 0);
  assert.ok(f.calls.every((c) => !/archive|resume|turn\/start/.test(c.method)));
});

test('lost fork response is reported as uncertain without retry or diagnostics', async (t) => {
  const f = fixture(t, { failFork: true });
  const r = await f.imp.importMany(pick('codex', id(1)));
  assert.equal(r.skipped[0].reason, 'codex_fork_uncertain'); assert.equal(f.calls.filter((c) => c.method === 'thread/fork').length, 1);
  assert.ok(!JSON.stringify(r).includes('private')); assert.equal(f.store.openSessions().length, 0);
});

test('an active source is refused before fork; returned source ID is never registered as a copy', async (t) => {
  const active = fixture(t, { source: { status: { type: 'active' } } });
  assert.equal((await active.imp.importMany(pick('codex', id(1)))).skipped[0].reason, 'source_running');
  assert.ok(!active.calls.some((c) => c.method === 'thread/fork'));
  const invalid = fixture(t, { copyId: id(1) });
  assert.equal((await invalid.imp.importMany(pick('codex', id(1)))).skipped[0].reason, 'codex_invalid_fork');
  assert.equal(invalid.store.openSessions().length, 0);
});

test('development history isolation rejects implicit homes and symlink escapes without connecting', async (t) => {
  const root = temp(t), outside = temp(t); const link = path.join(root, 'link'); fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(codexImportAllowed({ profile: 'dev', dataDir: root }).ok, false);
  assert.equal(codexImportAllowed({ profile: 'dev', dataDir: root, codexHome: link, codexHomeExplicit: true }).ok, false);
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  assert.equal(codexImportAllowed({ profile: 'dev', dataDir: root, codexHome: home, codexHomeExplicit: true }).ok, true);
  const client = new CodexHistory({ profile: 'dev' }, { connect: () => assert.fail('must not connect') });
  await assert.rejects(client.list(), { code: 'import_blocked' });
});

test('pagination is bounded and preserves cursors and filters', async () => {
  const calls = []; const rpc = { request: async (method, p) => { calls.push(p); return { data: [calls.length], nextCursor: calls.length === 1 ? 'next' : null }; } };
  assert.deepEqual(await codexPages(rpc, 'thread/list', { archived: false }), [1, 2]); assert.deepEqual(calls[1], { archived: false, cursor: 'next' });
  await assert.rejects(codexPages({ request: async () => ({ data: [], nextCursor: 'same' }) }, 'thread/list', {}), { code: 'codex_invalid_cursor' });
});

test('native resume targets only saved UUID and bootstrap never clobbers developer instructions', () => {
  assert.deepEqual(codexResumeArgs({ threadId: id(2), model: 'fixture-model' }), ['resume', id(2), '--model', 'fixture-model']);
  assert.throws(() => codexResumeArgs({ threadId: id(2), args: ['--last'] }), { code: 'codex_resume_target_mismatch' });
  assert.throws(() => codexResumeArgs({ threadId: id(2), args: ['resume', id(1)] }), { code: 'codex_resume_target_mismatch' });
  assert.equal(codexRecovery({ kind: 'codex', runtime: { codexManaged: true, codexSessionId: id(1), codexImportedFrom: id(1) } }), null);
  const b = { cfg: {}, branch: { envFor: () => ({ ATRIUM_SESSION_TOKEN: 'synthetic-token', ATRIUM_SESSION_ID: id(2) }) } };
  const p = prepareCodexSession(b, { sessionId: id(2), model: 'fixture-model', env: { PRIVATE: 'synthetic-secret' }, args: ['-c', 'developer_instructions="keep"'], prompt: 'Synthetic task' });
  assert.ok(p.args.includes('developer_instructions="keep"')); assert.equal(p.args.filter((x) => x.startsWith('developer_instructions')).length, 1);
  assert.ok(!p.args.some((a) => a.includes('Synthetic task'))); assert.ok(p.runtime.codexContext.includes('atrium models')); assert.equal(p.runtime.codexBriefed, false);
  assert.ok(!p.context.includes('synthetic-token')); assert.equal(p.env.PRIVATE, 'synthetic-secret'); assert.equal(p.runtime.codexIntegration, true);
  assert.equal(p.runtime.launcherEnv.ATRIUM_SESSION_TOKEN, undefined);
  const quiet = prepareCodexSession(b, { sessionId: id(2), threadId: id(3) }); assert.deepEqual(quiet.args, ['resume', id(3)]);
});

test('scoped Codex credentials stay in a private file, and native IDs require observation', (t) => {
  const root = temp(t), b = { cfg: { sessionsDir: path.join(root, 'sessions') }, branch: { envFor: () => ({ ATRIUM_SESSION_ID: id(1), ATRIUM_SESSION_TOKEN: 'synthetic-token', ATRIUM_PORT: '1' }) } };
  const p = prepareCodexSession(b, { sessionId: id(1), args: ['-c', 'developer_instructions="original"'] });
  assert.equal(p.env.ATRIUM_SESSION_TOKEN, undefined); assert.equal(p.env.ATRIUM_BRANCH_FILE, p.settingsPath);
  if (process.platform !== 'win32') assert.equal(fs.statSync(p.settingsPath).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(p.settingsPath)).ATRIUM_SESSION_TOKEN, 'synthetic-token');
  assert.ok(!JSON.stringify(p.args).includes('synthetic-token')); assert.ok(!p.runtime.codexContext.includes('synthetic-token'));
  const row = { kind: 'codex', origin: 'board', rt: p.runtime };
  assert.equal(codexRecovery(row), null); assert.equal(recordCodexSessionId(row, 'latest'), false);
  assert.equal(recordCodexSessionId(row, id(2)), true); assert.equal(codexRecovery(row).id, id(2));
  assert.equal(recordCodexSessionId(row, id(3)), false);
  row.rt.codexImportedFrom = id(1); assert.equal(recordCodexSessionId(row, id(1)), false);
});

test('managed Codex reopen uses exact copy ID, private runtime env/args and preserves context sent state', async (t) => {
  const f = fixture(t), imported = (await f.imp.importMany(pick('codex', id(1)))).imported[0], sid = imported.sessionId;
  const s = f.b.sessions.get(sid); Object.assign(s.rt, { launcherEnv: { PRIVATE: 'runtime-value' }, extraArgs: ['--sandbox', 'read-only'], codexBriefed: true });
  f.store.updateSession(sid, { closedAt: 200, runtime: s.rt }); f.b.sessions.delete(sid);
  const calls = [];
  Object.assign(f.b, { bus: new EventEmitter(), log() {}, requireHerdr() {}, probeGit() {}, hooked: () => false,
    withNewPane: async (make, register) => { const r = await make(); await register(r); return r; },
    adapter: { createWorkspace: async (o) => { calls.push(['create', o]); return { paneId: 'reopened-pane', workspaceId: 'reopened-ws' }; }, refreshSubscription: async () => {}, waitShellReady: async () => true,
      startAgent: async (o) => { calls.push(['start', o]); return { agent: { launchPending: true } }; } } });
  const recall = new Recall(f.b, { readProcs: async () => [] }); recall.changed = async () => {};
  const r = await recall.reopen({ session: sid });
  assert.equal(r.sessionId, sid); assert.equal(r.resume, true);
  assert.equal(calls.find(([k]) => k === 'create')[1].env.PRIVATE, 'runtime-value');
  assert.deepEqual(calls.find(([k]) => k === 'start')[1].args, ['resume', id(2), '--sandbox', 'read-only', '--model', 'fixture-model']);
  assert.equal(f.b.sessions.get(sid).rt.codexBriefed, true);
  assert.deepEqual(f.b.sessions.get(sid).rt.launcherEnv, { PRIVATE: 'runtime-value' });
});

for (const paginated of [false, true]) test(`history adapter reads ${paginated ? 'paginated' : 'legacy'} messages without tools/secrets or resuming`, async (t) => {
  const root = temp(t), f = fakeHistory(root, { source: { historyMode: paginated ? 'paginated' : 'legacy' }, turns: [{ id: 't1', startedAt: 10, items: [{ type: 'userMessage', content: [{ type: 'text', text: 'hello' }] }, { type: 'reasoning', text: 'private' }, { type: 'agentMessage', text: 'world' }] }] });
  const r = await readCodexMessages(f.history, id(1));
  assert.deepEqual(r.messages.map((m) => m.text), ['hello', 'world']); assert.equal(r.lastSeq, 2);
  assert.deepEqual((await readCodexMessages(f.history, id(1), { afterSeq: 0 })).messages.map((m) => m.text), ['world']);
  assert.ok(f.calls.every((c) => ['thread/read', 'thread/turns/list'].includes(c.method)));
});

for (const cleanupFails of [false, true]) test(`Codex wake failure retains native identity and pane tracking when cleanup fails=${cleanupFails}`, async (t) => {
  const f = fixture(t), result = await f.imp.importMany(pick('codex', id(1))), s = f.b.sessions.get(result.imported[0].sessionId);
  s.rt.launcherEnv = { PRIVATE: 'synthetic-value' }; const calls = [];
  f.b.requireHerdr = () => {};
  f.b.withNewPane = async (make, register) => { const r = await make(); await register(r); return r; };
  f.b.adapter = { createWorkspace: async (o) => { calls.push(o); return { paneId: 'fixture-pane', workspaceId: 'fixture-workspace' }; }, refreshSubscription: async () => {}, waitShellReady: async () => true,
    startAgent: async (o) => { assert.equal(o.kind, 'codex'); assert.deepEqual(o.args, ['resume', id(2), '--model', 'fixture-model']); throw new Error('launch failed'); },
    closePane: async (p) => { assert.equal(p, 'fixture-pane'); if (cleanupFails) throw new Error('cannot close'); } };
  await assert.rejects(wakeCodexSession(f.b, s));
  assert.equal(s.rt.codexSessionId, id(2)); assert.equal(calls[0].env.PRIVATE, 'synthetic-value');
  assert.equal(s.paneId, cleanupFails ? 'fixture-pane' : null); assert.equal(!!s.rt.sleep, !cleanupFails);
  assert.equal(f.b.killing.size, 0); assert.equal(s.waking, null);
});

test('concurrent Codex wakes create one pane and closing during verification prevents a launch', async (t) => {
  const f = fixture(t), result = await f.imp.importMany(pick('codex', id(1))), s = f.b.sessions.get(result.imported[0].sessionId);
  const calls = []; f.b.requireHerdr = () => {};
  f.b.withNewPane = async (make, register) => { const r = await make(); await register(r); return r; };
  f.b.adapter = { createWorkspace: async () => { calls.push('create'); return { paneId: 'p', workspaceId: 'w' }; }, refreshSubscription: async () => {}, waitShellReady: async () => true,
    startAgent: async (o) => { calls.push(o.args); return { agent: { launchPending: true } }; }, closePane: async () => {} };
  const results = await Promise.all([wakeCodexSession(f.b, s), wakeCodexSession(f.b, s)]);
  assert.ok(results.every((r) => r.woke)); assert.equal(calls.filter((x) => x === 'create').length, 1);
  assert.deepEqual(calls[1], ['resume', id(2), '--model', 'fixture-model']); assert.equal(s.rt.sleep, null);
  s.rt.sleep = { convId: id(2), at: 1 };
  f.imp.codex.read = async () => { f.b.sessions.delete(s.sessionId); return nativeThread(f.repo, 2); };
  await assert.rejects(wakeCodexSession(f.b, s), { code: 'closed' });
  assert.equal(calls.filter((x) => x === 'create').length, 1);
});

function fakeProcess(handler) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null; child.signalCode = null;
  child.stdin = new Writable({ write(chunk, encoding, cb) { handler(JSON.parse(chunk.toString()), child); cb(); } });
  child.kill = () => { child.signalCode = 'SIGTERM'; child.emit('exit'); return true; };
  return child;
}
test('stdio handshake and request IDs survive chunks, redact server errors and forbid mutation methods', async () => {
  const calls = [];
  const child = fakeProcess((m, c) => { calls.push(m); if (m.id) queueMicrotask(() => { const json = JSON.stringify(m.method === 'initialize' ? { id: m.id, result: {} } : { id: m.id, error: { code: -32601, message: 'private detail' } }) + '\n'; c.stdout.write(json.slice(0, 8)); c.stdout.write(json.slice(8)); }); });
  const rpc = new CodexProtocol({ executable: '/fixture/codex', spawnImpl: (command, args, opts) => { assert.equal(opts.shell, false); assert.deepEqual(args, ['app-server', '--listen', 'stdio://']); return child; }, timeoutMs: 100 });
  try {
    await rpc.initialize();
    await assert.rejects(rpc.request('thread/list'), (e) => e.code === 'codex_protocol_unsupported' && !e.message.includes('private'));
    await assert.rejects(rpc.request('thread/resume'), { code: 'codex_method_not_allowed' });
    assert.deepEqual(calls.map((m) => m.method), ['initialize', 'initialized', 'thread/list']);
  } finally { rpc.close(); }
  assert.equal(child.signalCode, 'SIGTERM');
});
test('hung app-server is terminated and pending requests are rejected', async () => {
  const child = fakeProcess(() => {}), rpc = new CodexProtocol({ executable: '/fixture/codex', spawnImpl: () => child, timeoutMs: 10 });
  await assert.rejects(rpc.initialize(), { code: 'codex_protocol_timeout' }); assert.equal(child.signalCode, 'SIGTERM'); assert.equal(rpc.pending.size, 0);
});
