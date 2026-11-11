// Gemini·agy 되찾기: 가짜 어댑터와 임시 DB·JSON만 쓴다. 사용자 설정·세션·대화 기록은 읽지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from '../src/store.mjs';
import { Recall } from '../src/recall.mjs';
import { newRuntime } from '../src/state.mjs';
import { pathKey } from '../src/workspaces.mjs';

const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

for (const kind of ['gemini', 'agy']) {
  for (const closeFails of [false, true]) {
    test(`audit: ${kind} failed recovery cleans up its new pane or retains tracking when close fails=${closeFails}`, async (t) => {
      const f = fixture(t, kind), s = f.session({ closed: false });
      f.b.adapter.startAgent = async () => { throw Object.assign(new Error('fixture launch failure'), { code: 'launch_failed' }); };
      f.b.adapter.closePane = async (pane) => {
        f.calls.push(['closePane', pane]);
        if (closeFails) throw Object.assign(new Error('fixture cleanup failure'), { code: 'unreachable' });
      };
      await f.r.restoreGone([s]);
      assert.deepEqual(call(f, 'closePane'), ['new1:p1']);
      assert.equal(f.b.sessions.has(s.sessionId), closeFails);
      if (closeFails) {
        assert.equal(s.paneId, 'new1:p1');
        assert.equal(s.rt.exit?.kind, 'launch_failed');
      }
      assert.equal(f.store.getSession(s.sessionId).runtime[`${kind}SessionId`], s.rt[`${kind}SessionId`]);
    });
  }
}

function fixture(t, kind = 'gemini') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-gemini-recovery-')));
  const cwd = path.join(root, 'project'); fs.mkdirSync(cwd);
  const store = new Store(path.join(root, 'board.db'));
  const ws = { key: pathKey(cwd), kind: 'folder', root: cwd };
  store.insertWorkspace({ ...ws, createdAt: 1 });
  const calls = []; let pane = 0;
  const b = {
    cfg: { dataDir: root, sessionsDir: root, recoverGraceMs: 0 },
    store, sessions: new Map(), bus: new EventEmitter(), killing: new Set(),
    api: { broadcast() {} }, log() {}, requireHerdr() {}, probeGit() {},
    hooked: (s) => s.rt.hooked !== false,
    registerResume: () => assert.fail(`${kind} must not register Claude resume arguments`),
    broadcastSession: (s) => store.saveRuntime(s.sessionId, s.rt),
    ensureWorkspace: (w) => { if (!store.getWorkspace(w.key)) store.insertWorkspace({ ...w, createdAt: 1 }); },
    withNewPane: async (create, register) => { const r = await create(); await register(r); return r; },
    setPane: async (s, paneId, herdrWorkspaceId) => {
      Object.assign(s, { paneId, herdrWorkspaceId }); store.updateSession(s.sessionId, { paneId, herdrWorkspaceId });
    },
    closeSession: (s, reason) => {
      calls.push(['closeSession', s.sessionId, reason]);
      store.updateSession(s.sessionId, { closedAt: Date.now(), closeReason: reason, runtime: s.rt });
      b.sessions.delete(s.sessionId);
    },
    demoteToShell: (s) => { calls.push(['demote', s.sessionId]); s.kind = 'shell'; },
    [`${kind}Settings`]: (sessionId, hookToken) => {
      const settingsPath = path.join(root, `${sessionId}.${kind}.json`);
      fs.writeFileSync(settingsPath, JSON.stringify({ sessionId, hookToken }));
      const providerEnv = kind === 'gemini' ? { GEMINI_CLI_HOME: path.join(root, `${sessionId}.gemini-profile`) } : { ATRIUM_AGY_BRIDGE: settingsPath };
      const integration = { settingsPath, env: { ...providerEnv, ATRIUM_BRANCH_FILE: path.join(root, `${sessionId}.${kind}-branch.json`), ATRIUM_SESSION_ID: sessionId, PATH: `mock-${kind}-path` } };
      calls.push([`${kind}Settings`, { sessionId, hookToken, ...integration }]);
      return integration;
    },
    adapter: {
      connected: true,
      createWorkspace: async (p) => { calls.push(['createWorkspace', p]); pane++; return { workspaceId: `new${pane}`, paneId: `new${pane}:p1` }; },
      refreshSubscription: async () => {},
      waitShellReady: async () => true,
      startAgent: async (p) => { calls.push(['startAgent', p]); return { agent: { name: p.name, launchPending: true }, argv: [kind, ...p.args] }; },
      getPane: async (paneId) => ({ paneId, agent: null }),
      workspacePanes: async () => assert.fail(`${kind} recovery must not depend on a workspace snapshot`),
      closePane: async (p) => calls.push(['closePane', p]),
      closeWorkspace: async () => assert.fail(`${kind} recovery must preserve sibling/user panes`),
    },
  };
  const r = new Recall(b, { readProcs: async () => assert.fail(`${kind} must not inspect Claude bindings`) });
  r.changed = async () => {};
  r.transcriptExists = () => assert.fail(`${kind} must not use Claude transcript lookup`);
  t.after(() => { r.stop(); store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  function session({ id = ID(1), closed = true, nativeId = ID(101), transcript = true, turned = true, origin = 'board', integration = true, args = [], runtime = {} } = {}) {
    const rt = newRuntime({ kind, hooked: false });
    if (kind === 'gemini') Object.assign(rt, { geminiIntegration: integration, geminiReady: true });
    Object.assign(rt, { [`${kind}SessionId`]: nativeId, [`${kind}TranscriptPath`]: null });
    if (transcript) {
      rt[`${kind}TranscriptPath`] = path.join(root, `native-${nativeId}.json`);
      fs.writeFileSync(rt[`${kind}TranscriptPath`], JSON.stringify({ sessionId: nativeId, messages: turned ? [{ type: 'user', content: 'keep my conversation' }] : [] }));
    }
    if (turned) Object.assign(rt, { lastPrompt: 'keep my conversation', lastPromptAt: 100, lastAnswer: 'remembered answer', lastAnswerAt: 200, turn: { startedAt: 100, endedAt: 200 } });
    if (!closed) rt.exit = { kind: 'herdr_stopped' };
    Object.assign(rt, runtime);
    const s = { sessionId: id, name: `${kind}${id.slice(0, 8)}`, cwd, workspaceKey: ws.key, kind, origin, rt, paneId: 'old:p1', herdrWorkspaceId: 'old', model: `${kind}-test-model`, settingsPath: path.join(root, 'deleted-settings.json'), hookToken: 'old-token', permissionMode: 'manual', createdAt: 1 };
    s.agentName = s.name;
    store.insertSession({ ...s, runtime: rt });
    store.setNode({ session_id: id, x: 100, y: 200, w: 720, h: 460, z: 3, size: 'large', area: '' });
    store.addEvent(id, 'spawn', { kind, args });
    if (closed) { store.updateSession(id, { closedAt: 300, closeReason: 'killed' }); store.setArchive('session', id, { archivedAt: 300 }); }
    else b.sessions.set(id, s);
    return s;
  }
  return { b, r, store, calls, session, root, cwd };
}

const call = (f, name) => f.calls.filter(([n]) => n === name).map(([, p]) => p);

for (const kind of ['gemini', 'agy']) for (const action of ['reopen', 'restoreGone', 'recoverHookless']) {
  test(`board auto approval on ${kind} ${action} preserves exact native conversation and model`, async (t) => {
    const f = fixture(t, kind);
    f.store.setMeta('settings', { agentAutoApprove: true });
    const s = f.session({ closed: action === 'reopen', args: kind === 'gemini' ? ['--approval-mode', 'default'] : ['--mode', 'ask'] });
    await f.r[action](action === 'reopen' ? { session: s.sessionId } : [s]);
    const launch = call(f, 'startAgent')[0]; assert.ok(launch);
    assert.ok(launch.args.includes(ID(101))); assert.ok(launch.args.includes(`${kind}-test-model`));
    if (kind === 'gemini') { assert.ok(launch.args.includes('yolo')); assert.ok(!launch.args.includes('default')); }
    else { assert.ok(launch.args.includes('--dangerously-skip-permissions')); assert.ok(!launch.args.includes('--mode')); }
    assert.equal(f.store.getSession(s.sessionId).permissionMode, 'bypassPermissions');
  });
}

function assertIntegration(f, s, oldToken = 'old-token') {
  const settings = call(f, `${s.kind}Settings`).at(-1);
  assert.equal(settings.sessionId, s.sessionId);
  assert.notEqual(s.hookToken, oldToken); assert.match(s.hookToken, /^[a-f0-9]{48}$/);
  assert.equal(s.hookToken, settings.hookToken); assert.equal(s.settingsPath, settings.settingsPath);
  assert.deepEqual(call(f, 'createWorkspace').at(-1).env, settings.env);
  assert.equal(s.rt.hooked, false); assert.equal(s.rt.exit, null);
  if (s.kind === 'gemini') {
    assert.equal(s.rt.geminiIntegration, true);
    assert.equal(s.rt.geminiReady, false); assert.equal(s.rt.geminiTurnActive, false);
  } else { assert.equal(s.rt.geminiIntegration, undefined); assert.equal(s.rt.agyTurnActive, false); }
  assert.equal(s.resumeArgv, null); assert.equal(s.resumeVerified, false);
  const args = call(f, 'startAgent').at(-1).args;
  for (const flag of ['latest', '--skip-trust', '--settings', '--fork-session']) assert.equal(args.includes(flag), false);
  const saved = f.store.getSession(s.sessionId);
  assert.equal(saved.hookToken, s.hookToken); assert.equal(saved.settingsPath, s.settingsPath);
  assert.equal(saved.runtime.kind, s.kind); assert.equal(saved.runtime.hooked, false);
  if (s.kind === 'gemini') assert.equal(saved.runtime.geminiIntegration, true);
}

test('archived Gemini reopens the exact native conversation with fresh hooks and the same board identity, model and node', async (t) => {
  const f = fixture(t);
  const old = f.session({ args: ['--model', 'outdated', '--resume', 'latest', '--session-id', ID(99), '--sandbox'] });
  const node = f.store.nodeOf(old.sessionId);
  const out = await f.r.reopen({ session: old.sessionId });
  const s = f.b.sessions.get(old.sessionId);
  assert.equal(out.sessionId, old.sessionId); assert.equal(out.name, old.name); assert.equal(out.resume, true);
  assert.equal(s.model, old.model); assert.equal(f.store.getSession(s.sessionId).model, old.model);
  assert.deepEqual(f.store.nodeOf(s.sessionId), node);
  assert.equal(f.store.getSession(s.sessionId).closedAt, null);
  assert.equal(f.store.archiveMarks().get(`session:${s.sessionId}`).archivedAt, null);
  assert.deepEqual(call(f, 'startAgent')[0], { name: s.name, paneId: out.paneId, kind: 'gemini', args: ['--resume', ID(101), '--sandbox', '--model', old.model] });
  assert.equal(s.rt.geminiSessionId, ID(101)); assert.equal(s.rt.geminiTranscriptPath, old.rt.geminiTranscriptPath);
  assert.equal(s.rt.lastPromptAt, 100);
  assertIntegration(f, s);
});

test('a never-used Gemini session starts only with the board UUID and honors the requested model', async (t) => {
  const f = fixture(t);
  const old = f.session({ turned: false, transcript: false, nativeId: null, args: ['-r=latest', '--session-id=stale', '-mold', '--sandbox'] });
  const out = await f.r.reopen({ session: old.sessionId, model: 'gemini-override' });
  const s = f.b.sessions.get(old.sessionId);
  assert.equal(out.resume, false); assert.equal(s.model, 'gemini-override');
  assert.deepEqual(call(f, 'startAgent')[0].args, ['--session-id', old.sessionId, '--sandbox', '--model', 'gemini-override']);
  assertIntegration(f, s);
});

test('missing transcript or exact native ID never silently replaces a used conversation', async (t) => {
  for (const changes of [{ transcript: false }, { nativeId: null, transcript: false }, { nativeId: 'latest' }]) {
    const f = fixture(t); const old = f.session(changes);
    const row = f.store.closedSession(old.sessionId), node = f.store.nodeOf(old.sessionId);
    await assert.rejects(f.r.reopen({ session: old.sessionId }), (e) => e.code === 'not_resumable');
    assert.deepEqual(f.store.closedSession(old.sessionId), row); assert.deepEqual(f.store.nodeOf(old.sessionId), node);
    assert.equal(f.store.archiveMarks().get(`session:${old.sessionId}`).archivedAt, 300);
    assert.deepEqual(f.calls, []);
  }
});

test('restorable uses only Gemini hook metadata, rejects directories, and excludes adopted sessions', (t) => {
  const f = fixture(t);
  const used = f.session({ closed: false });
  assert.equal(f.r.restorable(used), true);
  const fresh = f.session({ id: ID(2), closed: false, turned: false, transcript: false, nativeId: null });
  assert.equal(f.r.restorable(fresh), true);
  const missing = f.session({ id: ID(3), closed: false, transcript: false });
  assert.equal(f.r.restorable(missing), false);
  used.rt.geminiTranscriptPath = f.root; assert.equal(f.r.restorable(used), false);
  fresh.origin = 'adopted'; assert.equal(f.r.restorable(fresh), false);
  fresh.origin = 'board'; fresh.rt.geminiIntegration = false; assert.equal(f.r.restorable(fresh), false);
  fresh.rt.geminiIntegration = true; fresh.cwd = path.join(f.root, 'missing'); assert.equal(f.r.restorable(fresh), false);
});

test('restoreGone resumes Gemini in a new workspace with hook env while retaining its stored row and node', async (t) => {
  const f = fixture(t); const s = f.session({ closed: false, runtime: { interruptedTurn: { state: 'working', prompt: 'unfinished' } } });
  const node = f.store.nodeOf(s.sessionId);
  await f.r.restoreGone([s]);
  assert.equal(s.paneId, 'new1:p1'); assert.equal(s.kind, 'gemini'); assert.equal(s.rt.phase, 'starting');
  assert.deepEqual(call(f, 'startAgent')[0].args, ['--resume', ID(101), '--model', s.model]);
  assert.equal(call(f, 'startAgent')[0].kind, 'gemini');
  assert.deepEqual(s.rt.interruptedTurn, { state: 'working', prompt: 'unfinished' });
  assert.deepEqual(f.store.nodeOf(s.sessionId), node);
  assert.equal(f.store.getSession(s.sessionId).paneId, s.paneId);
  assert.equal(f.store.getSession(s.sessionId).runtime.geminiSessionId, ID(101));
  assertIntegration(f, s);
});

test('recoverHookless replaces only the stopped Gemini pane to restore its environment, preserving sibling panes', async (t) => {
  const f = fixture(t); const s = f.session({ closed: false });
  await f.r.recoverHookless([s]);
  assert.equal(s.paneId, 'new1:p1'); assert.equal(f.b.sessions.get(s.sessionId), s);
  assert.deepEqual(call(f, 'closePane'), ['old:p1']);
  assert.deepEqual(call(f, 'startAgent')[0].args, ['--resume', ID(101), '--model', s.model]);
  assertIntegration(f, s);
});

test('recovery of a never-used Gemini session uses its board UUID', async (t) => {
  for (const method of ['restoreGone', 'recoverHookless']) {
    const f = fixture(t); const s = f.session({ closed: false, turned: false, transcript: false, nativeId: null });
    await f.r[method]([s]);
    assert.deepEqual(call(f, 'startAgent')[0].args, ['--session-id', s.sessionId, '--model', s.model]);
    assertIntegration(f, s);
  }
});

test('unresumable Gemini remains a closed record without creating a fresh conversation or closing sibling panes', async (t) => {
  const f = fixture(t); const s = f.session({ closed: false, transcript: false });
  await f.r.recoverHookless([s]);
  assert.equal(call(f, 'startAgent').length, 0); assert.equal(call(f, 'geminiSettings').length, 0);
  assert.ok(f.store.closedSession(s.sessionId)); assert.equal(f.store.closedSession(s.sessionId).runtime.lastPromptAt, 100);
  assert.deepEqual(call(f, 'closePane'), ['old:p1']);
});

test('recovery does not interfere with agents that returned, disconnected adapters, or adopted Gemini', async (t) => {
  const f = fixture(t); const s = f.session({ closed: false });
  s.rt.exit = null; await f.r.recoverHookless([s]); assert.deepEqual(f.calls, []);
  s.rt.exit = { kind: 'herdr_stopped' }; f.b.adapter.connected = false;
  await f.r.recoverHookless([s]); assert.deepEqual(f.calls, []);
  f.b.adapter.connected = true; f.b.adapter.getPane = async () => ({ paneId: s.paneId, agent: 'gemini' });
  await f.r.recoverHookless([s]); assert.deepEqual(f.calls, []);
  s.origin = 'adopted'; s.rt.geminiIntegration = false;
  await f.r.recoverHookless([s]); assert.equal(call(f, 'startAgent').length, 0);
  assert.equal(call(f, 'createWorkspace').length, 0); assert.equal(call(f, 'closePane').length, 0);
});

test('a second reopen retains native metadata and never falls back to fresh after the transcript disappears', async (t) => {
  const f = fixture(t); const old = f.session();
  await f.r.reopen({ session: old.sessionId });
  const s = f.b.sessions.get(old.sessionId);
  f.b.closeSession(s, 'killed');
  fs.rmSync(old.rt.geminiTranscriptPath);
  const starts = call(f, 'startAgent').length;
  await assert.rejects(f.r.reopen({ session: old.sessionId }), (e) => e.code === 'not_resumable');
  assert.equal(call(f, 'startAgent').length, starts);
});

test('any saved turn evidence prevents a fresh launch, even when prompt timestamps are missing', async (t) => {
  for (const runtime of [{ lastPrompt: 'sent' }, { lastAnswerAt: 0 }, { turn: { startedAt: 0 } }, { turn: { endedAt: 0 } }, { interruptedTurn: { state: 'working' } }, { geminiTurnActive: true }]) {
    const f = fixture(t); const s = f.session({ turned: false, transcript: false, runtime });
    const view = f.r.closedView(f.store.closedSession(s.sessionId), new Set());
    assert.equal(view.canReopen, false); assert.equal(view.hasTranscript, false);
    await assert.rejects(f.r.reopen({ session: s.sessionId }), { code: 'not_resumable' });
    assert.deepEqual(f.calls, []);
  }
});

test('native transcript presence permits exact resume without board turn timestamps, and persists that evidence', async (t) => {
  const f = fixture(t); const old = f.session({ turned: false });
  const view = f.r.closedView(f.store.closedSession(old.sessionId), new Set());
  assert.equal(view.canReopen, true); assert.equal(view.hasTranscript, true);
  const out = await f.r.reopen({ session: old.sessionId });
  assert.equal(out.resume, true);
  f.b.closeSession(f.b.sessions.get(old.sessionId), 'killed');
  fs.rmSync(old.rt.geminiTranscriptPath);
  await assert.rejects(f.r.reopen({ session: old.sessionId }), { code: 'not_resumable' });
  assert.equal(call(f, 'startAgent').length, 1);
});

test('recovery starts in the original project and resets readiness even after an interrupted active turn', async (t) => {
  const f = fixture(t);
  const movedCwd = path.join(f.root, 'unrelated-project'); fs.mkdirSync(movedCwd);
  const s = f.session({ closed: false, runtime: { cwd: movedCwd, geminiTurnActive: true } });
  await f.r.restoreGone([s]);
  assert.equal(call(f, 'createWorkspace')[0].cwd, f.cwd);
  assertIntegration(f, s);
});

test('invalid model or saved session-file arguments fail before creating settings or reopening the row', async (t) => {
  for (const p of [{ model: '--resume' }, { model: 'bad model' }, {}]) {
    const f = fixture(t); const s = f.session({ args: p.model ? [] : ['--session-file', 'unrelated.json'] });
    await assert.rejects(f.r.reopen({ session: s.sessionId, ...p }), { code: 'bad_request' });
    assert.ok(f.store.closedSession(s.sessionId)); assert.deepEqual(f.calls, []);
  }
});

test('settings failure leaves archived rows and stopped Gemini panes intact', async (t) => {
  const f = fixture(t); const archived = f.session(); const stopped = f.session({ id: ID(2), closed: false });
  f.b.geminiSettings = () => { throw Object.assign(new Error('settings unavailable'), { code: 'settings_unavailable' }); };
  await assert.rejects(f.r.reopen({ session: archived.sessionId }), { code: 'settings_unavailable' });
  await f.r.recoverHookless([stopped]);
  assert.ok(f.store.closedSession(archived.sessionId)); assert.equal(f.b.sessions.get(stopped.sessionId), stopped);
  assert.equal(stopped.paneId, 'old:p1'); assert.equal(stopped.hookToken, 'old-token');
  assert.deepEqual(f.calls, []);
  assert.equal(f.store.events({ sessionId: stopped.sessionId }).at(-1).kind, 'recover_failed');
});

test('agents still at a trust or login dialog remain starting and can receive authenticated hooks', async (t) => {
  for (const method of ['reopen', 'restoreGone', 'recoverHookless']) {
    const f = fixture(t); const s = f.session({ closed: method === 'reopen' });
    f.b.adapter.startAgent = async (p) => { f.calls.push(['startAgent', p]); throw Object.assign(new Error('dialog'), { code: 'agent_not_ready' }); };
    await f.r[method](method === 'reopen' ? { session: s.sessionId } : [s]);
    const live = f.b.sessions.get(s.sessionId);
    assert.ok(live); assert.equal(live.rt.phase, 'starting'); assertIntegration(f, live);
  }
});

test('a busy or uninspectable surviving pane is preserved without launching another Gemini', async (t) => {
  for (const scenario of ['busy', 'inspection_failure', 'returned_while_waiting']) {
    const f = fixture(t); const s = f.session({ closed: false });
    if (scenario === 'busy') f.b.adapter.waitShellReady = async () => false;
    if (scenario === 'inspection_failure') f.b.adapter.getPane = async () => { throw new Error('disconnected'); };
    if (scenario === 'returned_while_waiting') f.b.adapter.waitShellReady = async () => { s.rt.exit = null; return true; };
    await f.r.recoverHookless([s]);
    assert.deepEqual(f.calls, []); assert.equal(f.b.sessions.get(s.sessionId), s);
  }
});

test('concurrent recovery attempts launch at most one Gemini process', async (t) => {
  const f = fixture(t); const s = f.session({ closed: false });
  await Promise.all([f.r.recoverHookless([s]), f.r.recoverHookless([s])]);
  assert.equal(call(f, 'startAgent').length, 1); assert.equal(call(f, 'createWorkspace').length, 1);
  assert.deepEqual(call(f, 'closePane'), ['old:p1']);
  assert.equal(f.b.killing.size, 0);
});

test('archived managed agy resumes the exact native conversation with fresh env, preserving its board row, model and node', async (t) => {
  const f = fixture(t, 'agy');
  const old = f.session({ args: ['--conversation', 'latest', '--conversation=stale', '--continue', '-c', '--resume', 'latest', '--session-id=stale', '--model', 'old-model', '--sandbox'] });
  const node = f.store.nodeOf(old.sessionId);
  const view = f.r.closedView(f.store.closedSessions()[0], new Set());
  assert.equal(view.hasTranscript, true); assert.equal(view.canReopen, true);
  const out = await f.r.reopen({ session: old.sessionId });
  const s = f.b.sessions.get(old.sessionId);
  assert.equal(out.resume, true); assert.equal(out.sessionId, old.sessionId); assert.equal(out.name, old.name);
  assert.equal(s.model, old.model); assert.deepEqual(f.store.nodeOf(s.sessionId), node);
  assert.equal(f.store.getSession(s.sessionId).closedAt, null);
  assert.equal(f.store.archiveMarks().get(`session:${s.sessionId}`).archivedAt, null);
  assert.deepEqual(call(f, 'startAgent')[0], { name: s.name, paneId: out.paneId, kind: 'agy', args: ['--conversation', ID(101), '--sandbox', '--model', s.model] });
  assert.equal(s.rt.agySessionId, ID(101)); assert.equal(s.rt.agyTranscriptPath, old.rt.agyTranscriptPath);
  assert.equal(f.store.getSession(s.sessionId).runtime.agySessionId, ID(101));
  assertIntegration(f, s);
});

test('unused managed agy starts without any conversation selector on reopen and both restart paths', async (t) => {
  for (const method of ['reopen', 'restoreGone', 'recoverHookless']) {
    const f = fixture(t, 'agy');
    const old = f.session({ closed: method === 'reopen', turned: false, transcript: false, nativeId: null, args: ['--conversation=latest', '--continue', '--session-id', ID(9), '--sandbox'] });
    const out = await f.r[method](method === 'reopen' ? { session: old.sessionId, model: 'agy-override' } : [old]);
    const s = f.b.sessions.get(old.sessionId);
    if (method === 'reopen') { assert.equal(out.resume, false); assert.equal(s.model, 'agy-override'); }
    assert.deepEqual(call(f, 'startAgent')[0].args, ['--sandbox', '--model', s.model]);
    assert.equal(s.rt.agySessionId, null); assert.equal(s.rt.agyTranscriptPath, null);
    assertIntegration(f, s);
  }
});

test('agy restoreGone and recoverHookless preserve exact native identity and isolate replacement to the owned pane', async (t) => {
  for (const method of ['restoreGone', 'recoverHookless']) {
    const f = fixture(t, 'agy');
    const s = f.session({ closed: false, runtime: { interruptedTurn: { state: 'working', prompt: 'unfinished' }, cwd: f.root, agyTurnActive: true } });
    const node = f.store.nodeOf(s.sessionId);
    assert.equal(f.r.restorable(s), true);
    await f.r[method]([s]);
    assert.equal(s.paneId, 'new1:p1'); assert.equal(s.kind, 'agy'); assert.equal(s.rt.phase, 'starting');
    assert.deepEqual(call(f, 'startAgent')[0].args, ['--conversation', ID(101), '--model', s.model]);
    assert.equal(call(f, 'startAgent')[0].kind, 'agy'); assert.equal(call(f, 'createWorkspace')[0].cwd, f.cwd);
    assert.deepEqual(call(f, 'closePane'), method === 'restoreGone' ? [] : ['old:p1']);
    assert.deepEqual(s.rt.interruptedTurn, { state: 'working', prompt: 'unfinished' });
    assert.deepEqual(f.store.nodeOf(s.sessionId), node);
    assertIntegration(f, s);
  }
});

test('used agy refuses missing or invalid native metadata and never substitutes Gemini or herdr history', async (t) => {
  for (const changes of [{ transcript: false }, { nativeId: null }, { nativeId: 'latest' }, { runtime: { agyTranscriptPath: '/missing/native.json' } }]) {
    const f = fixture(t, 'agy'); const s = f.session(changes);
    const row = f.store.closedSession(s.sessionId);
    row.runtime.geminiSessionId = ID(999); row.runtime.geminiTranscriptPath = s.rt.agyTranscriptPath;
    row.runtime.herdr.agentSessionId = ID(998);
    f.store.saveRuntime(s.sessionId, row.runtime);
    await assert.rejects(f.r.reopen({ session: s.sessionId }), { code: 'not_resumable' });
    assert.equal(f.r.closedView(f.store.closedSessions()[0], new Set()).canReopen, false);
    assert.equal(f.store.archiveMarks().get(`session:${s.sessionId}`).archivedAt, 300);
    assert.deepEqual(f.calls, []);
  }
});

test('only managed board agy is automatically restored or reopened', async (t) => {
  for (const changes of [{ origin: 'adopted' }, { hookToken: '' }, { runtime: { hooked: true } }]) {
    const f = fixture(t, 'agy'); const s = f.session({ closed: false, ...changes });
    if (changes.hookToken !== undefined) { s.hookToken = changes.hookToken; f.store.updateSession(s.sessionId, { hookToken: s.hookToken }); }
    assert.equal(f.r.restorable(s), false);
    await f.r.restoreGone([s]); await f.r.recoverHookless([s]);
    assert.deepEqual(f.calls, []); assert.equal(f.b.sessions.get(s.sessionId), s);
    f.b.closeSession(s, 'killed'); const before = f.calls.length;
    await assert.rejects(f.r.reopen({ session: s.sessionId }), { code: 'not_resumable' });
    assert.equal(f.calls.length, before);
  }
});

test('any previous agy work prevents a fresh start and unresumable sessions retain their stored history', async (t) => {
  for (const runtime of [{ lastPrompt: 'sent' }, { lastAnswerAt: 0 }, { turn: { startedAt: 0 } }, { interruptedTurn: { state: 'working' } }, { agyTurnActive: true }]) {
    const f = fixture(t, 'agy'); const s = f.session({ closed: false, turned: false, transcript: false, runtime });
    assert.equal(f.r.restorable(s), false);
    await f.r.recoverHookless([s]);
    assert.equal(call(f, 'startAgent').length, 0); assert.equal(call(f, 'agySettings').length, 0);
    assert.ok(f.store.closedSession(s.sessionId)); assert.deepEqual(call(f, 'closePane'), ['old:p1']);
  }
});

test('agy resume evidence survives another close even without board turn timestamps', async (t) => {
  const f = fixture(t, 'agy'); const old = f.session({ turned: false });
  assert.equal((await f.r.reopen({ session: old.sessionId })).resume, true);
  f.b.closeSession(f.b.sessions.get(old.sessionId), 'killed');
  fs.rmSync(old.rt.agyTranscriptPath);
  await assert.rejects(f.r.reopen({ session: old.sessionId }), { code: 'not_resumable' });
  assert.equal(call(f, 'startAgent').length, 1);
});

test('agy validates remaining arguments and model before creating settings or changing the row', async (t) => {
  for (const options of [{ args: ['--print', 'do work'] }, { args: ['login'] }, { args: ['--session-file', 'other.json'] }, { model: '--conversation' }]) {
    const f = fixture(t, 'agy'); const s = f.session(options);
    await assert.rejects(f.r.reopen({ session: s.sessionId, ...(options.model ? { model: options.model } : {}) }), { code: 'bad_request' });
    assert.ok(f.store.closedSession(s.sessionId)); assert.deepEqual(f.calls, []);
  }
});

test('agy settings failure preserves the archived row and any surviving pane', async (t) => {
  const f = fixture(t, 'agy'); const archived = f.session(); const stopped = f.session({ id: ID(2), closed: false });
  f.b.agySettings = () => { throw Object.assign(new Error('settings unavailable'), { code: 'settings_unavailable' }); };
  await assert.rejects(f.r.reopen({ session: archived.sessionId }), { code: 'settings_unavailable' });
  await f.r.recoverHookless([stopped]);
  assert.ok(f.store.closedSession(archived.sessionId)); assert.equal(f.b.sessions.get(stopped.sessionId), stopped);
  assert.equal(stopped.paneId, 'old:p1'); assert.equal(stopped.hookToken, 'old-token'); assert.deepEqual(f.calls, []);
});

test('agy pending login stays starting without accepting dialogs or adding trust bypass flags', async (t) => {
  for (const method of ['reopen', 'restoreGone', 'recoverHookless']) {
    const f = fixture(t, 'agy'); const old = f.session({ closed: method === 'reopen' });
    f.b.adapter.startAgent = async (p) => { f.calls.push(['startAgent', p]); throw Object.assign(new Error('login dialog'), { code: 'agent_not_ready' }); };
    await f.r[method](method === 'reopen' ? { session: old.sessionId } : [old]);
    const s = f.b.sessions.get(old.sessionId);
    assert.equal(s.rt.phase, 'starting'); assertIntegration(f, s);
    assert.equal(call(f, 'startAgent')[0].args.includes('--dangerously-skip-permissions'), false);
  }
});

test('agy recovery leaves busy, returned and uninspectable agents alone and deduplicates concurrent attempts', async (t) => {
  for (const scenario of ['busy', 'returned', 'inspection_failed', 'concurrent']) {
    const f = fixture(t, 'agy'); const s = f.session({ closed: false });
    if (scenario === 'busy') f.b.adapter.waitShellReady = async () => false;
    if (scenario === 'returned') f.b.adapter.getPane = async () => ({ paneId: s.paneId, agent: 'agy' });
    if (scenario === 'inspection_failed') f.b.adapter.getPane = async () => { throw new Error('unreachable'); };
    await Promise.all([f.r.recoverHookless([s]), f.r.recoverHookless([s])]);
    if (scenario === 'concurrent') { assert.equal(call(f, 'startAgent').length, 1); assert.deepEqual(call(f, 'closePane'), ['old:p1']); }
    else assert.deepEqual(f.calls, []);
  }
});
