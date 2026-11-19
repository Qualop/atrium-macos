// macOS 판(2026-11-18): 판이 띄우는 에이전트 묶음. Claude 자동 권한 검토(auto), 판 전용 추가 플러그인(gudals 같은 스킬셋),
// 하위 세션 기본 모델·추론(opus·sol, high), 하위 워커 빨리 잠재우기, 백엔드 메모리 돌려주기, 계정을 바꾸는 동안 atrium wait
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { providerPermissionArgs, applyAgentAutoApprove, CLAUDE_AUTO_MODE } from '../src/auto-approval.mjs';
import { boardExtraPlugins, skillLine, buildStartArgs, buildResumeArgv } from '../src/launch.mjs';
import { MemTrim } from '../src/mem-trim.mjs';
import { Sleeper } from '../src/sleep.mjs';
import { SETTINGS, DEFAULTS, CHILD_DEFAULTS } from '../src/settings.mjs';
import { Store } from '../src/store.mjs';
import { Backend } from '../src/backend.mjs';
import { Launchers, HARNESSES } from '../src/launchers.mjs';
import { Connections } from '../src/connections.mjs';
import { Branch, boardSkill } from '../src/branch.mjs';
import { CodexModels } from '../src/codex-cache.mjs';
import { deriveState } from '../src/state.mjs';
import { HARNESS_PROMPT } from '../src/harness.mjs';

const __filename = new URL(import.meta.url).pathname;
const tmp = (p = 'atrium-macos-agents-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('자동 승인: Claude는 bypassPermissions가 아니라 auto(자동 권한 검토), 다른 종류는 그대로', () => {
  assert.equal(CLAUDE_AUTO_MODE, 'auto');
  assert.deepEqual(providerPermissionArgs('claude', ['--permission-mode', 'bypassPermissions'], 'manual', { autoApprove: true }), ['--permission-mode', 'auto']);
  assert.equal(applyAgentAutoApprove({ kind: 'claude', permissionMode: 'manual', extraArgs: [] }, { agentAutoApprove: true }).permissionMode, 'auto');
  assert.equal(applyAgentAutoApprove({ kind: 'codex', permissionMode: 'manual', args: [] }, { agentAutoApprove: true }).permissionMode, 'bypassPermissions');
  assert.equal(applyAgentAutoApprove({ kind: 'claude', permissionMode: 'plan', extraArgs: [] }, { agentAutoApprove: false }).permissionMode, 'plan', '끄면 그대로');
});

test('판 전용 추가 플러그인: plugins/<이름>의 플러그인 묶음을 --plugin-dir로, 모델이 부르는 스킬만 안내문 한 줄(줄바꿈·큰따옴표 없이)', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(boardExtraPlugins(dir), { dir: null, plugins: [], skills: [] }, '폴더가 없으면 없음');
  const mk = (plugin, skill, front) => { const d = path.join(dir, 'plugins', plugin, 'skills', skill); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'SKILL.md'), `---\n${front}\n---\n\n본문\n`); };
  fs.mkdirSync(path.join(dir, 'plugins', 'gudals', '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins', 'gudals', '.claude-plugin', 'plugin.json'), '{"name":"gudals"}');
  mk('gudals', 'write-ko', 'name: write-ko\ndescription: 한국어 글을 쓸 때 "목적"과 독자에 맞게');
  mk('gudals', 'wall', 'name: wall\ndescription: 페르소나\ndisable-model-invocation: true');
  fs.mkdirSync(path.join(dir, 'plugins', 'not-a-plugin', 'skills'), { recursive: true }); // plugin.json 없음
  const x = boardExtraPlugins(dir);
  assert.deepEqual(x.plugins, ['gudals']);
  assert.equal(x.dir, path.join(dir, 'plugins').split(path.sep).join('/'));
  assert.deepEqual(x.skills.map((s) => s.name), ['write-ko'], '사람이 부르는 스킬(disable-model-invocation)은 빼고');
  const line = skillLine(x.skills);
  assert.match(line, /write-ko\(한국어 글을 쓸 때/); assert.ok(!/["\n]/.test(line));
  assert.equal(skillLine([]), '');
  const launch = { sessionId: 'S', settingsPath: '/s.json', permissionMode: 'auto', pluginDir: '/p/atrium', extraPluginDirs: [x.dir] };
  const a = buildStartArgs(launch);
  assert.deepEqual(a.filter((v, i) => a[i - 1] === '--plugin-dir'), ['/p/atrium', x.dir]);
  assert.ok(buildResumeArgv(launch).includes(x.dir), '이어 가기도 같은 플러그인');
});

test('하위 세션 규칙: 설정 기본값(opus·sol·high, 워커 5분)과 안내문', () => {
  assert.deepEqual([DEFAULTS.childModelClaude, DEFAULTS.childModelCodex, DEFAULTS.childEffort, DEFAULTS.workerSleepAfterMin], ['claude-opus-5-5', 'gpt-6.1-sol', 'high', 5]);
  assert.deepEqual({ ...CHILD_DEFAULTS }, { childModelClaude: 'claude-opus-5-5', childModelCodex: 'gpt-6.1-sol', childEffort: 'high' });
  assert.ok(SETTINGS.childEffort.options.includes('low'));
  assert.match(boardSkill(), /보드 기본\(Claude opus, Codex sol, high\)/);
  assert.match(boardSkill(), /## 토큰/);
  assert.match(HARNESS_PROMPT, /--effort low/); assert.ok(!/["\n]/.test(HARNESS_PROMPT));
});

// p96과 같은 판(가짜 어댑터)에 실제 설정 기본값을 둔다
async function board({ settings = {} } = {}) {
  const dir = tmp();
  const home = tmp('atrium-macos-agents-codex-');
  const row = (slug) => ({ slug, display_name: slug, visibility: 'list', priority: 5 });
  fs.writeFileSync(path.join(home, 'models_cache.json'), JSON.stringify({ fetched_at: 'x', client_version: '0.167.0', models: [row('gpt-6-astra'), row('gpt-6.1-sol')] }));
  fs.writeFileSync(path.join(home, 'config.toml'), 'model = "gpt-6-astra"\n');
  const b = new Backend({ quietMs: 600000, port: 0, logDir: dir, sessionsDir: path.join(dir, 'sessions'), claudeJson: path.join(dir, 'none.json'), claudeCommand: 'claude', hookTimeoutSec: 2, terminalSession: 'atrium-dev-macos-agents', profile: 'dev', dataDir: dir });
  b.store = new Store(path.join(dir, 'board.db'));
  b.sessions = new Map(); b.termOk = true; b.hookUrl = 'http://127.0.0.1:1/hook'; b.plugin = {}; b.apiToken = 'board-api-token';
  b.features = { settings: { get: () => ({ ...DEFAULTS, ...settings }) }, launchers: null, connections: null };
  b.features.connections = new Connections({ store: b.store, inUse: (id) => b.features.launchers.usersOf(id) });
  b.features.launchers = new Launchers({ store: b.store, codexModels: new CodexModels({ home, fallback: HARNESSES.codex.models }), gateway: {}, connections: b.features.connections });
  b.queue = { enqueue: () => ({ deliveryId: 'd1', status: 'queued' }), pending: () => 0 };
  b.api = { broadcast() {} };
  b.broadcastSession = () => {}; b.broadcastWorkspaces = () => {}; b.probeGit = () => {};
  b.ensureLink = (from, to, patch) => ({ linkId: 'l1', from, to, ...patch }); b.linkEvent = () => ({});
  b.summary = (s) => ({ state: deriveState(s.rt).state, ask: null, error: null });
  b.branch = new Branch(b, { readyWaitMs: 30, submitWaitMs: 10 });
  const calls = []; let n = 0;
  b.adapter = {
    connected: true,
    agentKinds: async () => [{ kind: 'claude', installed: true }, { kind: 'codex', installed: true }],
    createWorkspace: async () => { n++; return { paneId: `w${n}:p1`, workspaceId: `w${n}` }; },
    refreshSubscription: async () => {}, waitShellReady: async () => true,
    startAgent: async (o) => { calls.push(o); return { agent: null, argv: [o.kind, ...o.args] }; },
    sendText: async () => {}, paneKeys: async () => {},
  };
  b.requireTerminal = () => {};
  const lead = await b.spawn({ cwd: dir, name: 'lead', kind: 'claude', model: 'claude-fable-5-2', effort: 'xhigh', permissionMode: 'manual' });
  const startOf = (name) => calls.filter((c) => c.name === name).at(-1);
  return { b, dir, home, lead: b.sessions.get(lead.sessionId), startOf };
}
const argAfter = (args, flag) => args[args.indexOf(flag) + 1];

test('하위 세션: 모델을 빼면 Claude는 opus·high(부모가 fable·xhigh여도), --effort로 낮추고, Codex는 sol에 model_reasoning_effort', async (t) => {
  const { b, lead, startOf, dir, home } = await board();
  t.after(() => { b.store.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });
  b.store.setMeta('settings', { branchMaxChildren: 8 });
  await b.branch.spawnChild(lead, { name: 'opus-high', wait: false });
  const a = startOf('opus-high').args;
  assert.equal(argAfter(a, '--model'), 'claude-opus-5-5'); assert.equal(argAfter(a, '--effort'), 'high');
  await b.branch.spawnChild(lead, { name: 'small-job', effort: 'low', wait: false });
  assert.equal(argAfter(startOf('small-job').args, '--effort'), 'low', '에이전트가 낮춘 추론');
  await b.branch.spawnChild(lead, { name: 'named', model: 'haiku', wait: false });
  assert.equal(argAfter(startOf('named').args, '--model'), 'haiku', '에이전트가 고른 모델이 이긴다');
  await b.branch.spawnChild(lead, { name: 'cx', kind: 'codex', wait: false });
  const c = startOf('cx').args;
  assert.equal(argAfter(c, '-m'), 'gpt-6.1-sol');
  assert.ok(c.join(' ').includes('model_reasoning_effort=high'));
  await b.branch.spawnChild(lead, { name: 'cx-low', kind: 'codex', effort: 'low', wait: false });
  assert.ok(startOf('cx-low').args.join(' ').includes('model_reasoning_effort=low'));
});

test('하위 세션: 기본 모델을 판의 목록에서 찾지 못하면 예전처럼 물려받는다, 설정을 비우면 물려받는다', async (t) => {
  const { b, lead, startOf, dir, home } = await board({ settings: { childModelCodex: 'no-such-model' } });
  t.after(() => { b.store.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });
  b.store.setMeta('settings', { branchMaxChildren: 8 });
  await b.branch.spawnChild(lead, { name: 'cx', kind: 'codex', wait: false });
  assert.notEqual(argAfter(startOf('cx').args, '-m'), 'no-such-model');
  const off = await board({ settings: { childModelClaude: '', childEffort: '' } });
  t.after(() => { off.b.store.close(); fs.rmSync(off.dir, { recursive: true, force: true }); fs.rmSync(off.home, { recursive: true, force: true }); });
  off.b.store.setMeta('settings', { branchMaxChildren: 8 });
  await off.b.branch.spawnChild(off.lead, { name: 'inherit', wait: false });
  const a = off.startOf('inherit').args;
  assert.equal(argAfter(a, '--model'), 'claude-fable-5-2'); assert.equal(argAfter(a, '--effort'), 'xhigh');
});

test('워커 잠재우기: 일 부모가 열려 있는 세션은 workerSleepAfterMin(5분), 그 밖은 세션 규칙, 0이면 끔', () => {
  const sessions = new Map([['P', { sessionId: 'P', rt: {} }], ['W', { sessionId: 'W', parentSessionId: 'P', rt: {} }], ['L', { sessionId: 'L', rt: {} }]]);
  let settings = { sessionSleepAfterMin: 30, workerSleepAfterMin: 5 };
  const sl = new Sleeper({ sessions, features: { settings: { get: () => settings } } }, { timers: false });
  assert.equal(sl.isWorker(sessions.get('W')), true); assert.equal(sl.isWorker(sessions.get('L')), false);
  assert.equal(sl.sessionAfterFor(sessions.get('W')), 5 * 60000);
  assert.equal(sl.sessionAfterFor(sessions.get('L')), 30 * 60000);
  settings = { sessionSleepAfterMin: 3, workerSleepAfterMin: 5 };
  assert.equal(sl.sessionAfterFor(sessions.get('W')), 3 * 60000, '세션 규칙이 더 짧으면 그것');
  settings = { sessionSleepAfterMin: 30, workerSleepAfterMin: 0 };
  assert.equal(sl.sessionAfterFor(sessions.get('W')), 30 * 60000, '0이면 워커 규칙을 끈다');
  sessions.delete('P');
  settings = { sessionSleepAfterMin: 30, workerSleepAfterMin: 5 };
  assert.equal(sl.sessionAfterFor(sessions.get('W')), 30 * 60000, '부모가 닫히면 맨 위 세션');
});

test('메모리 돌려주기: 치울 것이 많을 때만, 간격을 두고 GC를 부른다', () => {
  let heap = { rss: 300e6, heapTotal: 200e6, heapUsed: 30e6 }, now = 0, gcs = 0;
  const mt = new MemTrim({ gc: () => { gcs++; heap = { rss: 120e6, heapTotal: 40e6, heapUsed: 30e6 }; }, mem: () => heap, minGapMs: 1000 });
  const realNow = Date.now; Date.now = () => now;
  try {
    const r = mt.maybe('scan');
    assert.equal(gcs, 1); assert.equal(r.rssMB, 286); assert.equal(r.afterMB, 114);
    heap = { rss: 300e6, heapTotal: 200e6, heapUsed: 30e6 };
    assert.equal(mt.maybe('scan'), null, '간격 안'); now = 5000;
    heap = { rss: 120e6, heapTotal: 40e6, heapUsed: 30e6 };
    assert.equal(mt.maybe('scan'), null, '치울 것이 적다');
    heap = { rss: 200e6, heapTotal: 130e6, heapUsed: 120e6 }; now = 70000;
    assert.ok(mt.maybe('scan'), '여유가 적어도 힙 전체가 64MB를 넘으면 정리한다');
    assert.ok(mt.maybe('x', { force: true }));
    assert.deepEqual(mt.stats().count, 3); assert.equal(mt.stats().skipped, 1);
  } finally { Date.now = realNow; }
  assert.equal(new MemTrim({ gc: null }).maybe('x', { force: true }), null, 'GC 함수가 없으면 아무것도 하지 않는다');
});

test('다시 붙을 때: 판이 에이전트로 띄운 터미널은 7501 상태가 없어도(권한 모드 확인·로그인 화면) 에이전트다. 끝난 터미널과 셸은 아니다', async () => {
  const { paneOf, agentInfoOf, LABEL } = await import('../src/hc/model.mjs');
  const t = { address: 't4', state: 'live', labels: { [LABEL.agent]: 'claude', [LABEL.board]: '1', [LABEL.name]: 's1' }, cwd: '/w' };
  assert.equal(paneOf(t, new Map()).agent, 'claude');
  assert.equal(agentInfoOf(t, new Map()).agent, 'claude'); assert.equal(agentInfoOf(t, new Map()).status, 'unknown');
  assert.equal(paneOf({ ...t, state: 'finished' }, new Map()).agent, null, '끝난 터미널');
  assert.equal(agentInfoOf({ address: 't5', state: 'live', labels: { [LABEL.board]: '1' } }, new Map()), null, '셸');
  assert.equal(paneOf({ ...t, status: { app: 'codex' } }, new Map()).agent, 'codex', '7501이 있으면 그것');
});

test('토큰: 판 세션 설정 파일에 자동 압축 기준(CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, 기본 65%)을 넣고 0이면 빼며, 바꾸면 기존 설정 파일도 고친다', async (t) => {
  const { Branch, COMPACT_ENV } = await import('../src/branch.mjs');
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(COMPACT_ENV, 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE');
  assert.equal(DEFAULTS.claudeAutoCompactPct, 65);
  let settings = { ...DEFAULTS };
  const file = path.join(dir, 's.json');
  fs.writeFileSync(file, JSON.stringify({ env: { KEEP: '1', [COMPACT_ENV]: '90' }, permissions: { allow: [] } }));
  const s = { sessionId: 'S', name: 'lead', kind: 'claude', settingsPath: file };
  const b = { cfg: { profile: 'dev', terminalSession: 'atrium-dev-x', port: 1, dataDir: dir }, store: { getMeta: () => ({}), branchRows: () => [] }, features: { settings: { get: () => settings } }, sessions: new Map([['S', s]]), hooked: () => true, log() {} };
  const br = Object.create(Branch.prototype); br.b = b; br.token = () => 'tok'; // 생성자(이벤트 구독 등) 없이 설정 파일 부분만 본다
  assert.equal(br.settingsExtra('S').env[COMPACT_ENV], '65');
  br.refreshSettings();
  let j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(j.env[COMPACT_ENV], '65'); assert.equal(j.env.KEEP, '1');
  settings = { ...DEFAULTS, claudeAutoCompactPct: 0 };
  assert.equal(br.settingsExtra('S').env[COMPACT_ENV], undefined);
  br.refreshSettings();
  j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(j.env[COMPACT_ENV], undefined, '0이면 빼서 Claude Code 기본');
});

test('다른 계정: 설정 폴더에 기본 계정의 CLAUDE.md·skills를 링크하고(있는 것은 그대로), 사용자 MCP 서버를 --mcp-config 파일로 준다', async (t) => {
  const { shareUserSetup, writeUserMcpConfig } = await import('../src/claude-accounts.mjs');
  const home = tmp(); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'ego-browser'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# 전역');
  const acct = path.join(home, '.claude-work'); fs.mkdirSync(acct);
  assert.deepEqual(shareUserSetup(acct, { home }).sort(), ['CLAUDE.md', 'skills']);
  assert.equal(fs.readFileSync(path.join(acct, 'CLAUDE.md'), 'utf8'), '# 전역');
  assert.ok(fs.existsSync(path.join(acct, 'skills', 'ego-browser')));
  assert.deepEqual(shareUserSetup(acct, { home }), [], '두 번째는 아무것도 하지 않는다');
  const own = path.join(home, '.claude-own'); fs.mkdirSync(own); fs.writeFileSync(path.join(own, 'CLAUDE.md'), '내 것');
  assert.deepEqual(shareUserSetup(own, { home }), ['skills']); assert.equal(fs.readFileSync(path.join(own, 'CLAUDE.md'), 'utf8'), '내 것');
  const claudeJson = path.join(home, '.claude.json'), file = path.join(home, 'mcp', 'user-mcp.json');
  assert.equal(writeUserMcpConfig({ claudeJson, file }), null, '서버가 없으면 파일 없음');
  fs.writeFileSync(claudeJson, JSON.stringify({ oauthAccount: { emailAddress: 'x' }, mcpServers: { cua: { type: 'stdio', command: '/Applications/Cua Spaces.app/Contents/MacOS/cua', args: ['mcp'], junk: 1 } } }));
  assert.equal(writeUserMcpConfig({ claudeJson, file }), file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mcpServers: { cua: { type: 'stdio', command: '/Applications/Cua Spaces.app/Contents/MacOS/cua', args: ['mcp'] } } });
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600); // Windows에는 POSIX 권한 비트가 없다
  const a = buildStartArgs({ sessionId: 'S', settingsPath: '/s.json', permissionMode: 'auto', mcpConfig: file });
  assert.equal(a[a.indexOf('--mcp-config') + 1], file);
  assert.match(HARNESS_PROMPT, /cua MCP/);
});

test('토큰: 판 설정이 붙기 전(백엔드가 뜰 때)에도 판 기록과 기본값으로 압축 기준을 넣는다', async () => {
  const { Branch, COMPACT_ENV } = await import('../src/branch.mjs');
  const br = Object.create(Branch.prototype); br.b = { store: { getMeta: () => ({}) } };
  assert.equal(br.compactEnv()[COMPACT_ENV], '65');
  assert.equal(br.compactEnv()['CLAUDE_CODE_AUTO_COMPACT_WINDOW'], '250000', '기본 창 25만');
  br.b = { store: { getMeta: () => ({ claudeAutoCompactPct: 0, claudeCompactWindowK: 0 }) } };
  assert.deepEqual(br.compactEnv(), {});
});

test('메모리: 깨어 있는 하위 워커가 상한(maxAwakeWorkers)을 넘으면 쉬는 워커를 오래 쉰 것부터 잠재운다. 일하는 워커·맨 위 세션은 그대로', async () => {
  const { newRuntime } = await import('../src/state.mjs');
  const mk = (id, parent, o = {}) => { const rt = newRuntime({ kind: 'claude', hooked: true }); rt.phase = 'running'; rt.term = { ...rt.term, present: true, status: o.working ? 'working' : 'idle', launchPending: false }; rt.hooksSinceLaunch = 3; rt.transcriptPath = __filename; return { sessionId: id, name: id, kind: 'claude', paneId: `p-${id}`, parentSessionId: parent, cwd: '/w', workspaceKey: 'k', rt, touchedAt: 0 }; };
  const sessions = new Map();
  for (const s of [mk('lead', null), mk('w1', 'lead'), mk('w2', 'lead'), mk('w3', 'lead', { working: true }), mk('w4', 'lead')]) sessions.set(s.sessionId, s);
  const slept = [];
  const b = { sessions, killing: new Set(), hooked: () => true, log() {}, features: { settings: { get: () => ({ maxAwakeWorkers: 2, sessionSleepAfterMin: 30, workerSleepAfterMin: 3 }) }, loops: { activeCount: () => 0 } }, queue: { pending: () => 0, list: () => [] }, relay: { stats: () => [] }, store: { saveRuntime() {} }, cfg: {} };
  const sl = new Sleeper(b, { timers: false });
  sl.sleep = async (s) => { slept.push(s.name); s.rt.sleep = { at: 1 }; return { name: s.name }; };
  const idle = { w1: 300, w2: 100, w4: 200 };
  const info0 = sl.info.bind(sl);
  sl.info = (s) => ({ ...info0(s), idleSince: idle[s.name] || 0, convKnown: true });
  await sl.capAwakeWorkers();
  assert.deepEqual(slept, ['w2', 'w4'], '깨어 있는 워커 4개(w1 w2 w3 w4) → 2개: 일하는 w3는 남기고 가장 오래 쉰 w2, w4');
  assert.ok(!sessions.get('lead').rt.sleep, '맨 위 세션은 상한에 넣지 않는다');
});

test('atrium models: 맨 위에 보일 기본(--model을 빼면 띄우는 모델·추론)을 판 설정에서 준다', async () => {
  const { Branch } = await import('../src/branch.mjs');
  const ctx = { b: { features: { settings: { get: () => ({ childModelClaude: 'claude-opus-5-5', childModelCodex: 'gpt-6.1-sol', childEffort: 'high' }) } } },
    catalog: async () => ({ entries: [], gateways: [] }), routeOf: async () => null };
  const r = await Branch.prototype.listModels.call(ctx, { name: 'main', model: null, effort: null });
  assert.deepEqual(r.defaults, { claude: 'claude-opus-5-5', codex: 'gpt-6.1-sol', effort: 'high' });
});

test('hc: 터미널이 대화 ID를 모르면(라벨 없음) hook으로 대화 ID를 안 Claude 세션에도 판의 전달이 들어간다. 둘 다 알고 다를 때만 막는다', async () => {
  const { Backend, otherConvo } = await import('../src/backend.mjs');
  const sent = [];
  const s = { sessionId: 'S', name: 'main', agentName: 'main', paneId: 't9', kind: 'claude', origin: 'board', rt: { claudeSessionId: 'conv-1' } };
  const ctx = { sessions: new Map([['S', s]]), stopping: false, killing: new Set(), currentSession: () => true,
    adapter: { getAgent: async () => ({ paneId: 't9', agentSessionId: null }), prompt: async (to, text) => { sent.push([to, text]); return { ok: true }; } } };
  await Backend.prototype.sendPrompt.call(ctx, 'S', '진행해');
  assert.deepEqual(sent, [['main', '진행해']]);
  ctx.adapter.getAgent = async () => ({ paneId: 't9', agentSessionId: 'conv-OTHER' });
  ctx.ensureAgentName = async () => false;
  ctx.adapter.getPane = async () => null;
  await assert.rejects(Backend.prototype.sendPrompt.call(ctx, 'S', 'x'), (e) => e.code === 'agent_not_found');
  assert.equal(otherConvo('a', null), false); assert.equal(otherConvo(null, 'b'), false); assert.equal(otherConvo('a', 'b'), true); assert.equal(otherConvo('a', 'a'), false);
});

test('하위 세션 기준 폴더: 부모가 하위 폴더로 cd해도 띄운 폴더, 사이에 워크트리(.git)가 있으면 그 최상위, 띄운 폴더 밖이면 지금 폴더', async () => {
  const { childBaseCwd } = await import('../src/branch.mjs');
  const P = (x) => path.resolve(x); // 이 OS의 절대 경로(Windows에서는 드라이브와 역슬래시)
  const has = (set) => (p) => set.has(p);
  const ex = has(new Set(['/w/StockA', '/w/StockA/reports/d/design_review', '/w/repo', '/w/repo/.claude/worktrees/x', '/w/repo/.claude/worktrees/x/.git', '/w/repo/.claude/worktrees/x/src', '/tmp/else'].map(P)));
  assert.equal(childBaseCwd(P('/w/StockA'), P('/w/StockA/reports/d/design_review'), ex), P('/w/StockA'));
  assert.equal(childBaseCwd(P('/w/repo'), P('/w/repo/.claude/worktrees/x/src'), ex), P('/w/repo/.claude/worktrees/x'));
  assert.equal(childBaseCwd(P('/w/repo'), P('/tmp/else'), ex), P('/tmp/else'));
  assert.equal(childBaseCwd(P('/w/StockA'), null, ex), P('/w/StockA'));
  assert.equal(childBaseCwd(P('/w/StockA'), P('/w/StockA'), ex), P('/w/StockA'));
});

test('자동 압축: 비율과 함께 창 크기(천 토큰)를 env로 준다. 0이면 빼서 모델의 창', async () => {
  const { Branch, COMPACT_ENV, COMPACT_WINDOW_ENV } = await import('../src/branch.mjs');
  const env = (st) => Branch.prototype.compactEnv.call({ b: { features: { settings: { get: () => st } } } });
  assert.deepEqual(env({ claudeAutoCompactPct: 65, claudeCompactWindowK: 250 }), { [COMPACT_ENV]: '65', [COMPACT_WINDOW_ENV]: '250000' });
  assert.deepEqual(env({ claudeAutoCompactPct: 65, claudeCompactWindowK: 0 }), { [COMPACT_ENV]: '65' });
  assert.deepEqual(env({ claudeAutoCompactPct: 0, claudeCompactWindowK: 0 }), {});
});

test('hc: 들고 있던 놓임 뒤에 같은 터미널에서 에이전트가 다시 나타나면(Claude Code가 업데이트·신뢰 뒤 다시 뜸) 놓임을 버린다. 안 나타나면 그대로 낸다', async () => {
  const { HcAdapter } = await import('../src/hc/adapter.mjs');
  const a = new HcAdapter({ session: 'macos-rel', dataDir: null, pipe: '/nonexistent/hc.sock', env: { PATH: '/usr/bin' } });
  const out = [];
  a.on('event', (e) => out.push(e.type));
  const rel = (pane) => ({ type: 'agent_released', paneId: pane, agent: 'claude', finalStatus: 'blocked', raw: { type: 'status' } });
  a._emitAll([rel('t9')]);
  a._emitAll([{ type: 'agent_detected', paneId: 't9', agent: 'claude', raw: { type: 'status' } }]);
  await new Promise((r) => setTimeout(r, 450));
  assert.deepEqual(out, ['agent_detected'], '다시 나타난 뒤 옛 놓임을 내지 않는다');
  out.length = 0;
  a._emitAll([rel('t8')]);
  await new Promise((r) => setTimeout(r, 450));
  assert.deepEqual(out, ['agent_released'], '다시 나타나지 않으면 300ms 뒤 놓임');
});

test('macOS: 판 세션 env에 루프백 NO_PROXY — 전역 HTTPS_PROXY가 판 hook(127.0.0.1)을 가로채지 않게, 있던 값은 둔다', async () => {
  const { loopbackNoProxy } = await import('../src/branch.mjs');
  assert.deepEqual(loopbackNoProxy({}), { NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1' });
  assert.equal(loopbackNoProxy({ no_proxy: 'corp.local, 127.0.0.1' }).NO_PROXY, 'corp.local,127.0.0.1,localhost,::1');
});
