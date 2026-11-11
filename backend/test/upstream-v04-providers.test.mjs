import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { applyAgentAutoApprove, providerPermissionArgs, codexPermissionArgs } from '../src/auto-approval.mjs';
import { spawnPlanOf } from '../src/spawn-plan.mjs';
import { normalizeLauncher, parseCommandLine, splitArgs, joinArgs, startOpt, initialLaunchers } from '../src/launchers.mjs';
import { buildStartArgs, buildResumeArgv, platformLine } from '../src/launch.mjs';
import { DEFAULTS, normalizePatch } from '../src/settings.mjs';
import { childCommands, isToolCommand } from '../src/resources.mjs';
import { otherKindPlan, approvalArgsOf, boardSkill } from '../src/branch.mjs';
import { geminiContext } from '../src/gemini.mjs';
import { DeliveryQueue } from '../src/delivery.mjs';
import { Branch } from '../src/branch.mjs';
import { EventEmitter } from 'node:events';

test('board auto approval is an explicit boolean; remote stays off and limits stay 4/3/16', () => {
  assert.equal(DEFAULTS.agentAutoApprove, false);
  assert.equal(DEFAULTS.remoteAccess, false);
  assert.deepEqual([DEFAULTS.branchMaxChildren, DEFAULTS.branchMaxDepth, DEFAULTS.branchMaxTotal], [4, 3, 16]);
  assert.deepEqual(normalizePatch({ agentAutoApprove: 'true' }), { agentAutoApprove: true });
  assert.throws(() => normalizePatch({ agentAutoApprove: {} }), { code: 'bad_request' });
  const plan = { kind: 'codex', args: ['--sandbox', 'read-only'] };
  for (const settings of [{}, { agentAutoApprove: false }, { agentAutoApprove: 'true' }]) assert.equal(applyAgentAutoApprove(plan, settings), plan);
  const shell = { kind: 'shell', command: 'printf safe', env: { PRIVATE: 'fixture' } };
  assert.equal(applyAgentAutoApprove(shell, { agentAutoApprove: true }), shell);
});

test('full-auto provider args override conflicting launcher modes without changing model or literal argv', () => {
  const cases = [
    ['codex', ['--sandbox=read-only', '-a', 'on-request', '-c', 'approval_policy="never"', '-c=sandbox_mode="read-only"', '-c', 'model_reasoning_effort="high"', '--model', 'provider/model', '--profile', 'two words'], ['-c', 'model_reasoning_effort="high"', '--model', 'provider/model', '--profile', 'two words', '--dangerously-bypass-approvals-and-sandbox']],
    ['gemini', ['--approval-mode', 'plan', '--no-yolo', '-dymfixture', '--include-directories', 'two words'], ['-dmfixture', '--include-directories', 'two words', '--approval-mode', 'yolo']],
    ['agy', ['--mode=plan', '--dangerously-skip-permissions=false', '--model', 'fixture-model', '--project', 'two words'], ['--model', 'fixture-model', '--project', 'two words', '--dangerously-skip-permissions']],
    ['claude', ['--resume', 'exact-id', '--permission-mode', 'plan', '--model', 'haiku'], ['--resume', 'exact-id', '--model', 'haiku', '--permission-mode', 'bypassPermissions']],
  ];
  for (const [kind, args, expected] of cases) {
    const before = [...args];
    const actual = providerPermissionArgs(kind, args, 'manual', { autoApprove: true });
    assert.deepEqual(actual, expected, kind);
    assert.deepEqual(args, before);
    assert.deepEqual(providerPermissionArgs(kind, actual, 'manual', { autoApprove: true }), actual, 'idempotent ' + kind);
  }
  const resumed = providerPermissionArgs('codex', ['resume', '12345678-1234-4234-8234-123456789abc', '--', 'literal -a never'], 'manual', { autoApprove: true });
  assert.deepEqual(resumed, ['resume', '12345678-1234-4234-8234-123456789abc', '--dangerously-bypass-approvals-and-sandbox', '--', 'literal -a never']);
});

test('parent permission conversion respects explicit launcher flags until board opt-in overrides them', () => {
  assert.deepEqual(codexPermissionArgs('acceptEdits'), ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request']);
  assert.deepEqual(codexPermissionArgs('plan'), []);
  assert.equal(approvalArgsOf('codex', 'auto', ['-arequest']).from, 'launcher');
  assert.deepEqual(providerPermissionArgs('codex', ['--search'], 'bypassPermissions', { inherit: true }), ['--search', '--dangerously-bypass-approvals-and-sandbox']);
  assert.deepEqual(providerPermissionArgs('codex', ['-sread-only'], 'bypassPermissions', { inherit: true }), ['-sread-only']);
  const route = { type: 'launcher', kind: 'codex', launcher: { id: 'fixture', name: 'fixture', harness: 'codex', model: 'provider/model', args: '--sandbox read-only --profile "two words"' } };
  const p = otherKindPlan({ route, autoApprove: true });
  assert.equal(p.record.approvalFrom, 'board');
  assert.deepEqual(p.args, ['--profile', 'two words', '--dangerously-bypass-approvals-and-sandbox']);
  const agy = otherKindPlan({ route: { type: 'model', kind: 'agy', model: 'fixture' } });
  assert.deepEqual(agy.argv, ['--model', 'fixture']);
});

test('launch planning forces the same policy for all managed providers and leaves authentication guidance distinct', () => {
  const b = { features: { settings: { get: () => ({ agentAutoApprove: true }) } } };
  for (const kind of ['claude', 'codex', 'gemini', 'agy']) {
    const p = spawnPlanOf(b, { kind, permissionMode: 'plan' });
    assert.equal(p.permissionMode, 'bypassPermissions', kind);
    if (kind !== 'claude') assert.deepEqual(p.args, providerPermissionArgs(kind, [], 'manual', { autoApprove: true }));
    else assert.ok(buildStartArgs({ sessionId: 'fixture', settingsPath: '/tmp/fixture.json', ...p }).includes('bypassPermissions'));
  }
  const l = normalizeLauncher({ name: 'fixture', harness: 'codex', args: '--sandbox read-only --profile "two words"' });
  const p = spawnPlanOf(b, { launcherDef: l });
  assert.deepEqual(p.args, ['--profile', 'two words', '--dangerously-bypass-approvals-and-sandbox']);
  assert.equal(spawnPlanOf({}, {}).startCommand, null, 'omitted wrapper inherits from parent');
  assert.equal(spawnPlanOf({}, { startCommand: '' }).startCommand, '', 'explicit empty wrapper clears inheritance');
  const context = geminiContext({ sessionId: 'fixture' });
  assert.match(context, /automatic tool approval/);
  assert.match(boardSkill(), /agentAutoApprove/);
  assert.doesNotMatch(boardSkill(), /섞으면 사람의 승인을 기다린다/);
  assert.match(context, /Login and workspace trust must still be handled by the user/);
});

test('quoted wrapper and pasted argv round-trip through resume and POSIX execution without shell expansion', () => {
  const parsed = parseCommandLine(String.raw`TOKEN='private $(no-execution)' ocx --account 'two words' claude --verbose --append-system-prompt 'be terse'`);
  const launcher = normalizeLauncher({ ...parsed.launcher, name: 'fixture' });
  assert.deepEqual(startOpt({ kind: 'claude', ...launcher }).command, ['ocx', '--account', 'two words', 'claude']);
  assert.deepEqual(splitArgs(launcher.args), ['--verbose', '--append-system-prompt', 'be terse']);
  const argv = buildResumeArgv({ startCommand: launcher.startCommand, sessionId: 'exact-id', settingsPath: '/tmp/private settings.json', permissionMode: 'bypassPermissions' });
  assert.deepEqual(argv.slice(0, 6), ['ocx', '--account', 'two words', 'claude', '--resume', 'exact-id']);
  const words = ['two words', "single'quote", '$PRIVATE', '$(must-stay-literal)', '', '한글'];
  assert.deepEqual(splitArgs(joinArgs(words)), words);
  assert.equal(platformLine(['C:\\Program Files\\wrapper.exe', '--account', 'two words'], 'win32'), "& 'C:\\Program Files\\wrapper.exe' --account 'two words'");
  if (process.platform !== 'win32') {
    const command = platformLine([process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...words], 'darwin');
    assert.deepEqual(JSON.parse(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })), words);
  }
  assert.deepEqual(splitArgs(parseCommandLine("claude --x 'one''two'", { platform: 'darwin' }).launcher.args), ['--x', 'onetwo']);
  const c = parseCommandLine('TOKEN="private value" codex --profile "work account"');
  assert.equal(c.launcher.harness, 'codex');
  assert.deepEqual(c.launcher.env, { TOKEN: 'private value' });
  assert.deepEqual(splitArgs(c.launcher.args), ['--profile', 'work account']);
  assert.deepEqual(c.recognized.env, ['TOKEN']);
});

test('fresh launcher rail contains one Gemini (agy) favorite; existing DeepSeek migration remains', () => {
  const fresh = initialLaunchers();
  assert.equal(fresh.items.filter((l) => ['gemini', 'agy'].includes(l.harness)).length, 1);
  assert.ok(fresh.favorites.includes(fresh.items.find((l) => l.harness === 'agy').id));
  assert.ok(initialLaunchers({ oldBoard: true }).favorites.includes('deepseek'));
});

test('background tool processes use POSIX inspection on Mac/Linux and distinguish MCP children', async () => {
  const rows = new Map([[11, { pid: 11, ppid: 7, name: 'zsh', cmd: '/bin/zsh -c source /tmp/.claude/shell-snapshots/snapshot-zsh-1.sh' }], [12, { pid: 12, ppid: 8, name: 'node', cmd: 'node mcp.js' }]]);
  for (const platform of ['darwin', 'linux']) {
    const result = await childCommands([7, 7, -1, 'bad'], { platform, readPosix: async () => rows, exec: () => { throw new Error('PowerShell on POSIX'); } });
    assert.deepEqual(result, [rows.get(11)]);
    assert.equal(isToolCommand(result[0]), true);
  }
  assert.equal(await childCommands([7], { platform: 'darwin', readPosix: async () => null }), null);
  assert.equal(isToolCommand(rows.get(12)), false);
});

const tick = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
function queueRig({ send, inspect } = {}) {
  const v = { state: 'ready', herdrConnected: true, agentPresent: true, kind: 'claude', hooked: true };
  const rows = new Map(), sent = [];
  const q = new DeliveryQueue({ cfg: { inputQuietMs: 3000, deliveryMaxWaitMs: 900000, submitConfirmMs: 30000 },
    view: () => v, store: { activeDeliveries: () => [], insertDelivery: (d) => rows.set(d.deliveryId, { ...d }), getDelivery: (id) => rows.get(id), updateDelivery: (id, p) => Object.assign(rows.get(id), p) },
    send: send || (async (...args) => sent.push(args)), inspect: inspect || (async () => ({ box: 'empty' })) });
  return { q, v, sent };
}

test('P90 third send argument is true only for an explicitly requested, inspected working Claude session', async () => {
  const { q, v, sent } = queueRig(); v.state = 'working';
  const d = q.enqueue('s', 'next task', { typeNow: true }); await tick();
  assert.equal(d.status, 'sent'); assert.deepEqual(sent[0], ['s', 'next task', { typeNow: true }]);
  const plain = queueRig(); plain.v.state = 'working'; plain.q.enqueue('s', 'queued'); await tick(); assert.equal(plain.sent.length, 0);
  const idle = queueRig(); idle.q.enqueue('s', 'ready'); await tick(); assert.deepEqual(idle.sent[0][2], { typeNow: false });
});

test('queue waits for a submitted prompt RPC before sending another item, and working survives a late transport error', async () => {
  let release;
  const hold = new Promise((r) => { release = r; }); let n = 0;
  const { q } = queueRig({ send: async () => { n++; await hold; } });
  const first = q.enqueue('s', 'first'); await tick();
  q.onUserPromptSubmit('s', 'first'); const second = q.enqueue('s', 'second'); await tick();
  assert.equal(n, 1); assert.equal(first.status, 'confirmed'); assert.equal(second.status, 'queued');
  release(); await tick(); assert.equal(n, 2);
  let fail;
  const pending = new Promise((_, reject) => { fail = reject; });
  const late = queueRig({ send: () => pending }); const d = late.q.enqueue('s', 'task'); await tick();
  late.q.onAgentWorking('s'); fail(Object.assign(new Error('fixture transport'), { code: 'unreachable' })); await tick();
  assert.equal(d.status, 'confirmed');
});

test('first-prompt repair rechecks user input and queue identity after asynchronous screen inspection', async () => {
  let release;
  const look = new Promise((r) => { release = r; });
  const { q, v, sent } = queueRig({ inspect: () => look });
  let enters = 0; q.pressEnter = async () => { enters++; };
  const d = q.enqueue('s', 'first'); await tick();
  const repair = q._recover(d); v.lastUserInputAt = Date.now(); release({ box: 'ours' }); await repair;
  assert.equal(enters, 0); assert.equal(sent.length, 1);
});

function branchRig() {
  const b = { apiToken: 'fixture-board-token', cfg: {}, sessions: new Map(), bus: new EventEmitter(),
    store: { branchRows: () => [], addEvent() {} }, hooked: (s) => s.kind === 'claude' && s.origin === 'board' };
  return { b, branch: new Branch(b) };
}

test('all managed providers retain session-scoped branch authorization and reject Unicode or adopted callers', () => {
  const { b, branch } = branchRig();
  for (const kind of ['claude', 'codex', 'gemini', 'agy']) {
    const sessionId = kind + '-fixture';
    const s = { sessionId, kind, origin: 'board', hookToken: 'private-fixture', rt: { codexIntegration: kind === 'codex' } };
    b.sessions.set(sessionId, s);
    const headers = { 'x-mt-session': sessionId, authorization: 'Bearer ' + branch.token(sessionId) };
    assert.equal(branch.auth(headers, 'child').s, s);
    assert.equal(branch.auth({ ...headers, authorization: 'Bearer ' + 'é'.repeat(64) }, 'child').status, 401);
    s.origin = 'adopted';
    assert.equal(branch.auth(headers, 'child').status, 403);
  }
});

test('native model/list takes precedence, with optional cached names only when discovery is unavailable', async () => {
  const { b, branch } = branchRig();
  b.features = { launchers: { data: () => ({ items: [], favorites: [] }), modelLists: () => ({ codex: { models: ['cached-model'], labels: { 'cached-model': 'Cached' } } }) } };
  b.agentModels = async ({ kind }) => ({ models: kind === 'codex' ? [{ id: 'native-model', name: 'Native' }] : [] });
  const ids = async () => (await branch.catalog()).entries.filter((e) => e.harness === 'codex').map((e) => e.model);
  assert.deepEqual(await ids(), ['native-model']);
  b.agentModels = async () => { throw new Error('fixture offline'); };
  assert.deepEqual(await ids(), ['cached-model']);
});
