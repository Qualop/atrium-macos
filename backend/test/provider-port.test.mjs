import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { spawnPlanOf } from '../src/spawn-plan.mjs';
import { Launchers, initialLaunchers, normalizeLauncher, resolveLauncher, previewLauncher, splitArgs, HARNESSES } from '../src/launchers.mjs';
import { buildCatalog, resolveModel } from '../src/models.mjs';
import { Branch, boardSkill } from '../src/branch.mjs';
import { DEFAULTS } from '../src/settings.mjs';
import { newRuntime, deriveState } from '../src/state.mjs';
import { Sleeper, sleepTarget, sessionActivity } from '../src/sleep.mjs';

const memoryStore = (initial = {}) => {
  const meta = new Map(Object.entries(initial));
  return { getMeta: (k) => structuredClone(meta.get(k)), setMeta: (k, v) => meta.set(k, structuredClone(v)),
    branchRows: () => [], setBranch() {}, spawnInfo: () => ({}), addEvent() {}, updateSession() {}, saveRuntime() {} };
};
const launcher = (o = {}) => normalizeLauncher({ name: 'Worker', harness: 'claude', ...o });

test('spawn plan retains legacy no-launcher defaults and complete schema', () => {
  const b = { store: memoryStore({ settings: { claudeModel: 'vendor/model', claudeEffort: 'high', claudePermissionMode: 'acceptEdits', claudeAllowHerdr: true, codexArgs: '-m provider/model -c \'note="two words"\'', deepseekCommand: 'echo legacy' } }) };
  const p = spawnPlanOf(b, {});
  assert.deepEqual([p.model, p.effort, p.permissionMode, p.allowHerdr], ['vendor/model', 'high', 'acceptEdits', true]);
  assert.deepEqual(Object.keys(p).sort(), ['kind', 'flavor', 'launcher', 'launcherId', 'command', 'model', 'effort', 'permissionMode', 'allowHerdr', 'extraArgs', 'env', 'gateway', 'args'].sort());
  const c = spawnPlanOf(b, { kind: 'codex' });
  assert.equal(c.model, 'provider/model');
  assert.ok(c.args.includes('note="two words"'));
  assert.deepEqual(spawnPlanOf(b, { kind: 'codex', model: null }).args, ['-c', 'note="two words"']);
  assert.equal(spawnPlanOf(b, { kind: 'deepseek' }).command, 'echo legacy');
  const ds = spawnPlanOf(b, { kind: 'deepseek', command: '' });
  assert.equal(ds.kind, 'claude'); assert.equal(ds.flavor, 'deepseek'); assert.equal(ds.effort, null);
  assert.ok(ds.env.ANTHROPIC_BASE_URL);
  assert.equal(spawnPlanOf({ store: {} }, {}).permissionMode, 'manual');
});

test('quoted preset arguments retain literal content and provider model flags', () => {
  assert.deepEqual(splitArgs('--flag "a b" \'$(echo literal)\' ""'), ['--flag', 'a b', '$(echo literal)', '']);
  const c = spawnPlanOf({}, { launcherDef: launcher({ harness: 'codex', model: 'vendor/model', args: '-m old -c \'note="two words"\'' }), args: ['-c', 'note="a b"', '--model', 'old'] });
  assert.equal(c.model, 'vendor/model');
  assert.deepEqual(c.args, ['-c', 'note="a b"', '--model', 'vendor/model']);
  const g = resolveLauncher(launcher({ harness: 'gemini', model: 'vendor/model@1', args: '--sandbox' }));
  assert.deepEqual(g.args, ['--sandbox', '--model', 'vendor/model@1']);
  const a = resolveLauncher(launcher({ harness: 'agy', model: 'google/model' }));
  assert.deepEqual(a.args, ['--model', 'google/model']);
  assert.throws(() => resolveLauncher(launcher(), { args: ['--settings', '/tmp/evil'] }), /판이 정하는 인자/);
  assert.throws(() => launcher({ args: '--flag "unfinished' }), /Unclosed quote/);
  assert.throws(() => launcher({ harness: 'gemini', env: { GEMINI_CLI_HOME: '/tmp/other' } }), /판이 정하는 환경/);
});

test('command env stays separate from raw command and reaches the process literally', () => {
  const secret = "a'b $HOME $(echo expanded) `echo expanded`";
  const command = 'printf "%s" "$TOKEN"; printf "%s" "$TOKEN"';
  const plan = spawnPlanOf({}, { launcherDef: launcher({ harness: 'command', command, env: { TOKEN: secret } }) });
  assert.equal(plan.command, command); assert.deepEqual(plan.env, { TOKEN: secret });
  assert.equal(execFileSync('/bin/sh', ['-c', plan.command], { encoding: 'utf8', env: plan.env }), secret + secret);
  const overridden = resolveLauncher(launcher({ harness: 'command', command, env: { TOKEN: secret } }), { command: 'echo override' });
  assert.equal(overridden.command, 'echo override'); assert.deepEqual(overridden.env, { TOKEN: secret });
  const preview = previewLauncher(launcher({ harness: 'command', command: 'echo hello', env: { TOKEN: secret } }));
  assert.deepEqual(preview.env, ['TOKEN']); assert.equal(preview.line, 'echo hello');
  assert.ok(!JSON.stringify(preview).includes(secret));
});

test('Gemini migration creates one agy preset and preserves user favorite changes', () => {
  const initial = initialLaunchers({ oldBoard: true });
  assert.equal(initial.items.filter((l) => ['gemini', 'agy'].includes(l.harness)).length, 1);
  const gemini = initial.items.find((l) => l.id === 'gemini');
  assert.deepEqual(gemini, launcher({ id: 'gemini', name: 'Gemini', harness: 'agy', icon: '' }));
  assert.deepEqual(initial.favorites, ['claude', 'codex', 'gemini', 'deepseek', 'shell']);
  assert.deepEqual(initialLaunchers().favorites, ['claude', 'codex', 'gemini', 'shell']);
  for (const icon of ['', 'gemini']) {
    const plan = resolveLauncher({ ...gemini, icon });
    assert.equal(plan.kind, 'agy'); assert.equal(plan.flavor, null, 'old and new defaults retain the actual provider label');
  }
  assert.equal(resolveLauncher(launcher({ icon: 'deepseek' })).flavor, 'deepseek');
  const old = { ...initial, v: 1, items: initial.items.filter((l) => l.id !== 'gemini'), favorites: ['shell', 'codex'] };
  const store = memoryStore({ launchers: old });
  const ls = new Launchers({ store });
  assert.deepEqual(ls.data().favorites, ['shell', 'codex', 'gemini']);
  ls.delete({ id: 'gemini' });
  new Launchers({ store });
  assert.equal(ls.find('gemini'), null);
  assert.deepEqual(ls.data().favorites, ['shell', 'codex']);
});

const providers = {
  codex: { models: [{ id: 'gpt-next', name: 'GPT Next' }, { id: 'openai/next-code', name: 'Next Code' }] },
  gemini: { models: [{ id: 'gemini-next', name: 'Gemini Next' }] },
  agy: { models: [{ id: 'google/ultra', name: 'Gemini Ultra' }] },
};
test('catalog resolves all live model names and slashed IDs without static Codex fallback', () => {
  const cat = buildCatalog({ providers });
  assert.deepEqual(cat.entries.filter((e) => e.kind === 'codex').map((e) => e.model), ['gpt-next', 'openai/next-code']);
  for (const [query, kind, model] of [['GPT next', 'codex', 'gpt-next'], ['next code', 'codex', 'openai/next-code'], ['Gemini Next', 'gemini', 'gemini-next'], ['Gemini Ultra', 'agy', 'google/ultra']]) {
    const r = resolveModel(query, cat); assert.equal(r.ok, true); assert.equal(r.entry.kind, kind); assert.equal(r.entry.model, model);
  }
  assert.equal(resolveModel('not-a-model', cat).ok, false);
  assert.equal(buildCatalog().entries.some((e) => e.kind === 'codex'), false);
  assert.deepEqual(HARNESSES.codex.models, []);
  const ambiguous = buildCatalog({ providers: { gemini: { models: [{ id: 'shared' }] }, agy: { models: [{ id: 'shared' }] } } });
  assert.equal(resolveModel('shared', ambiguous).code, 'model_ambiguous');
  assert.equal(resolveModel('shared', ambiguous, { kind: 'agy' }).entry.kind, 'agy');
});

function board(t, { trusted = false, shellReady = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-provider-port-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const claudeJson = path.join(dir, 'claude.json');
  fs.writeFileSync(claudeJson, JSON.stringify({ projects: { [dir]: { hasTrustDialogAccepted: trusted } } }));
  const b = { cfg: { claudeJson, killWaitMs: 1 }, store: memoryStore(), sessions: new Map(), bus: new EventEmitter(), killing: new Set(),
    calls: [], modelCalls: [], hooked: (s) => s.kind === 'claude', log() {}, broadcastSession() {}, registerResume() {},
    agentModels: async ({ kind }) => { b.modelCalls.push(kind); return providers[kind]; },
    launchOf: (s) => ({ sessionId: s.sessionId, settingsPath: '/private/settings.json', permissionMode: 'manual' }),
    adapter: { sendText: async () => b.calls.push('exit'), paneKeys: async () => { b.calls.push('enter'); child.rt.herdr.present = false; },
      waitShellReady: async () => shellReady, startAgent: async (p) => b.calls.push(p) },
  };
  const branch = new Branch(b, { gateTrustWaitMs: 0 });
  const child = { sessionId: 'worker', name: 'worker', agentName: 'worker', paneId: 'w1:p1', cwd: dir, kind: 'claude', rt: newRuntime({ kind: 'claude' }) };
  child.rt.herdr = { present: true, status: 'idle' }; child.rt.phase = 'running';
  b.sessions.set(child.sessionId, child); branch.noteChild(child.sessionId, { gate: 'trust', worktree: 'feature' });
  return { b, branch, child, dir };
}

test('delegation discovers Codex/Gemini/agy through the backend and inherits parent kind', async (t) => {
  const { b, branch, child } = board(t);
  const cat = await branch.catalog();
  assert.deepEqual(b.modelCalls.sort(), ['agy', 'codex', 'gemini']);
  assert.equal(resolveModel('Next Code', cat).entry.model, 'openai/next-code');
  for (const kind of ['codex', 'gemini', 'agy']) assert.equal((await branch.routeOf({ ...child, kind }, {})).kind, kind);
  const route = await branch.routeOf(child, { model: 'Gemini Ultra' });
  assert.equal(route.kind, 'agy'); assert.equal(route.model, 'google/ultra'); assert.equal(route.args, undefined);
});

test('trust gate leaves prompts held and sends no keys when trust is false or unreadable', async (t) => {
  const { b, branch, child } = board(t);
  await assert.rejects(branch.passGate(child), { code: 'needs_trust' });
  fs.rmSync(b.cfg.claudeJson);
  await assert.rejects(branch.passGate(child), { code: 'needs_trust' });
  assert.deepEqual(b.calls, []); assert.equal(branch.holds(child.sessionId), true);
});

test('trust gate requires shell readiness and keeps a failed gate closed', async (t) => {
  const { b, branch, child } = board(t, { trusted: true, shellReady: false });
  await assert.rejects(branch.passGate(child), { code: 'timeout' });
  assert.deepEqual(b.calls, ['exit', 'enter']); assert.equal(branch.holds(child.sessionId), true);
});

test('trust gate never launches into a replaced pane', async (t) => {
  const { b, branch, child } = board(t, { trusted: true });
  b.adapter.waitShellReady = async () => { child.paneId = 'replacement'; return true; };
  await assert.rejects(branch.passGate(child), { code: 'not_on_board' });
  assert.deepEqual(b.calls, ['exit', 'enter']); assert.equal(branch.holds(child.sessionId), true);
});

test('trusted worktree restarts in the same pane and releases the gate only after launch', async (t) => {
  const { b, branch, child } = board(t, { trusted: true });
  await branch.passGate(child);
  assert.equal(b.calls.at(-1).paneId, 'w1:p1');
  assert.ok(b.calls.at(-1).args.includes('--worktree'));
  assert.ok(b.calls.at(-1).args.includes('feature'));
  assert.equal(branch.holds(child.sessionId), false);
});

test('gateway credentials inherit from private settings without event env', async (t) => {
  const { branch, child, dir } = board(t);
  child.settingsPath = path.join(dir, 'session.json');
  fs.writeFileSync(child.settingsPath, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://localhost:9', API_KEY: 'private-value', ATRIUM_SESSION_TOKEN: 'parent-only' } }), { mode: 0o600 });
  const route = await branch.routeOf(child, {});
  assert.equal(route.type, 'inherit-gateway');
  assert.equal(route.launcherDef.env.API_KEY, 'private-value');
  assert.equal(route.launcherDef.env.ATRIUM_SESSION_TOKEN, undefined);
  assert.ok(!JSON.stringify(route.resolved).includes('private-value'));
});

test('worker skill documents current limits, effort, wait and readable names', () => {
  assert.deepEqual([DEFAULTS.branchMaxChildren, DEFAULTS.branchMaxDepth, DEFAULTS.branchMaxTotal], [4, 3, 16]);
  const skill = boardSkill();
  assert.match(skill, /--effort/); assert.match(skill, /child-wait/); assert.match(skill, /api-tests/);
  assert.doesNotMatch(skill, /상한은 없다|상한 없음/);
});

test('a blocked trust gate cannot sleep while herdr happens to report ready', () => {
  const x = { state: 'ready', gated: true, kind: 'claude', hooked: true, convKnown: true };
  assert.equal(sleepTarget(x), 'not_ready');
  assert.equal(sessionActivity(x), 'needs_you');
});

test('Codex branch authorization requires managed integration, origin and both tokens', (t) => {
  const { b, branch, child } = board(t);
  b.apiToken = 'synthetic-board-key'; child.kind = 'codex'; child.origin = 'board'; child.hookToken = 'synthetic-hook'; child.rt.codexIntegration = true;
  const headers = { 'x-mt-session': child.sessionId, authorization: `Bearer ${branch.token(child.sessionId)}` };
  assert.equal(branch.auth(headers, 'models').s, child);
  for (const field of ['origin', 'hookToken']) {
    const old = child[field]; child[field] = null;
    assert.equal(branch.auth(headers, 'child').status, 403); child[field] = old;
  }
  child.rt.codexIntegration = false; assert.equal(branch.auth(headers, 'child').status, 403);
  child.rt.codexIntegration = true;
  assert.equal(branch.auth({ ...headers, authorization: 'Bearer wrong' }, 'child').status, 401);
});

function sleepingCodex(t) {
  const { b, branch, child } = board(t);
  const nativeId = '00000002-0000-4000-8000-000000000034';
  b.sessions.delete(child.sessionId); branch.info.delete(child.sessionId);
  child.sessionId = '00000003-0000-4000-8000-000000000034';
  b.sessions.set(child.sessionId, child);
  b.apiToken = 'synthetic-board-key';
  Object.assign(child, { kind: 'codex', origin: 'board', hookToken: 'synthetic-hook', paneId: null, workspaceKey: 'fixture-repo', model: 'provider/model' });
  child.rt = newRuntime({ kind: 'codex', hooked: false });
  Object.assign(child.rt, { sleep: { by: 'import', at: 1 }, codexSessionId: nativeId, codexManaged: true, codexIntegration: true });
  branch.noteChild(child.sessionId, {});
  b.branch = branch;
  b.resolve = () => child;
  b.summary = (s) => deriveState(s.rt);
  b.requireHerdr = () => {};
  b.desktopImport = { codex: { read: async (id) => { assert.equal(id, nativeId); return { id, status: { type: 'notLoaded' } }; } } };
  b.withNewPane = async (create, register) => { const r = await create(); await register(r); return r; };
  b.adapter.connected = true;
  b.adapter.createWorkspace = async () => ({ paneId: 'codex-copy-pane', workspaceId: 'codex-copy-workspace' });
  b.adapter.refreshSubscription = async () => {};
  b.adapter.startAgent = async (p) => { b.calls.push(p); return { agent: { launchPending: true } }; };
  b.queue = { pending: (id) => id === child.sessionId && child.rt.sleep ? 1 : 0, cancelSession() {} };
  b.relay = { stats: () => [] };
  b.features = { settings: { get: () => ({ sleepAfterMin: 0 }) }, loops: { activeCount: () => 0 } };
  const sleeper = b.sleeper = new Sleeper(b, { timers: false });
  const sibling = { ...child, sessionId: 'sibling', name: 'untouched-copy', rt: structuredClone(child.rt) };
  b.sessions.set(sibling.sessionId, sibling);
  return { b, branch, child, sibling, sleeper, nativeId };
}

for (const entry of ['wakeOne', 'wakeFor', 'tick', 'branch']) test(`sleep ${entry} resumes only the selected Codex copy with its native UUID`, async (t) => {
  const { b, branch, child, sibling, sleeper, nativeId } = sleepingCodex(t);
  if (entry === 'wakeOne') await sleeper.wakeOne({ session: child.sessionId });
  else if (entry === 'wakeFor') await Promise.all([sleeper.wakeFor(child, 'fixture'), sleeper.wakeFor(child, 'fixture')]);
  else if (entry === 'branch') await branch.wakeAgent({ name: 'caller' }, { name: child.name });
  else { await sleeper.tick(); await Promise.all([...sleeper.wakes.values()]); }
  const calls = b.calls.filter((c) => c && typeof c === 'object');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'codex');
  assert.deepEqual(calls[0].args, ['resume', nativeId, '--model', 'provider/model']);
  assert.equal(child.rt.sleep, null); assert.equal(sibling.rt.sleep.by, 'import');
  assert.equal(sleepTarget({ kind: 'codex', state: 'ready', hooked: false }), 'not_claude');
});
