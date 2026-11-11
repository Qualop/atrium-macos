// P97 단위 시험: 런처의 실행 명령(예: ocx claude)과 명령줄 붙여 넣기.
// 붙여 넣기 해석(한 줄·여러 줄, PowerShell·bash 환경 변수, 판이 정하는 인자 빼기, 따옴표 값, 모르는 명령), 실행 명령 검사(글자, 판의 인자, PATH 경고),
// 띄우기·이어 가기 인자(패널에 칠 줄, resume_argv), herdr에 친 줄로 띄우기(가짜 소켓), 하위 세션의 물려받기
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Launchers, normalizeLauncher, normalizeStartCommand, parseCommandLine, splitArgs, shellStatements, previewLauncher, resolveLauncher, startWarning, onPath, uniqueName, claudeStartOf, startOpt, HARNESSES } from '../src/launchers.mjs';
import { buildResumeArgv, buildStartArgs, psLine, psQuote, platformLine } from '../src/launch.mjs';
import { HerdrAdapter } from '../src/herdr/adapter.mjs';
import { Store } from '../src/store.mjs';
import { Backend } from '../src/backend.mjs';
import { DEFAULTS } from '../src/settings.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p97-'));
const parse = (t, kinds = ['claude', 'codex', 'pi', 'gemini']) => parseCommandLine(t, { kinds });
const valid = (r) => normalizeLauncher({ ...r.launcher, name: r.name || 'x' });

test('P97 붙여 넣기: ocx claude 한 줄 → Claude Code 판 세션(실행 명령, 모델, 승인 방식, 추가 인자)', () => {
  const r = parse('ocx claude --model haiku --permission-mode auto --foo');
  assert.equal(r.recognized.as, 'claude'); assert.equal(r.recognized.board, true);
  assert.deepEqual([r.launcher.harness, r.launcher.startCommand, r.launcher.model, r.launcher.permissionMode, r.launcher.args], ['claude', 'ocx claude', 'haiku', 'auto', '--foo']);
  assert.deepEqual(r.recognized.mapped.map((m) => m.field), ['model', 'permissionMode', 'args']);
  assert.equal(r.name, 'ocx claude haiku');
  const l = valid(r);
  assert.equal(previewLauncher(l).line, 'ocx claude --permission-mode auto --model haiku --foo');
  // 실행 명령이 없는 claude는 기본(빈 칸)
  const p = parse('claude --model=opus --effort high');
  assert.deepEqual([p.launcher.startCommand, p.launcher.model, p.launcher.effort, p.launcher.permissionMode, p.name], ['', 'opus', 'high', 'manual', 'Claude opus']);
});

test('P97 붙여 넣기: codex 한 줄 → Codex(-m 모델, 나머지는 추가 인자), herdr가 아는 다른 종류는 추가 인자만', () => {
  const r = parse('codex --search --model deepseek/deepseek-flash');
  assert.deepEqual([r.recognized.as, r.launcher.harness, r.launcher.model, r.launcher.args, r.recognized.board], ['codex', 'codex', 'deepseek/deepseek-flash', '--search', false]);
  assert.equal(previewLauncher(valid(r)).line, 'codex --search --model deepseek/deepseek-flash');
  assert.equal(parse('codex --model=gpt-6-astra').launcher.model, 'gpt-6-astra');
  assert.equal(parse('codex -mgpt-6-sol').launcher.model, 'gpt-6-sol');
  const pi = parse('pi --thinking high');
  assert.deepEqual([pi.recognized.as, pi.launcher.harness, pi.launcher.args], ['kind', 'pi', '--thinking high']);
  assert.equal(parse('pi --x', []).recognized.as, 'command', 'herdr가 모르는 종류면 명령 한 줄');
});

test('P97 붙여 넣기: 여러 줄(PowerShell 이어 쓰기, $env:), bash(\\ 이어 쓰기, 이름=값 앞머리, export)', () => {
  const ps = parse("$env:ANTHROPIC_BASE_URL='http://127.0.0.1:10100'\r\n$env:MY_FLAG = \"on\"\r\nclaude --model sonnet --effort high `\r\n  --permission-mode acceptEdits --verbose");
  assert.deepEqual(ps.launcher.env, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:10100', MY_FLAG: 'on' });
  assert.deepEqual([ps.launcher.model, ps.launcher.effort, ps.launcher.permissionMode, ps.launcher.args], ['sonnet', 'high', 'acceptEdits', '--verbose']);
  assert.deepEqual(ps.recognized.env, ['ANTHROPIC_BASE_URL', 'MY_FLAG']);
  valid(ps);
  const sh = parse('ANTHROPIC_BASE_URL=http://gw:1 FOO=1 ocx claude \\\n  --model=haiku \\\n  --verbose');
  assert.deepEqual(sh.launcher.env, { ANTHROPIC_BASE_URL: 'http://gw:1', FOO: '1' });
  assert.deepEqual([sh.launcher.startCommand, sh.launcher.model, sh.launcher.args], ['ocx claude', 'haiku', '--verbose']);
  const ex = parse('export FOO=bar && cd C:/x; ocx claude');
  assert.deepEqual(ex.launcher.env, { FOO: 'bar' });
  assert.equal(ex.launcher.startCommand, 'ocx claude');
  assert.deepEqual(ex.recognized.skipped, ['cd C:/x'], '앞의 다른 명령은 빼고 알린다');
  // 문장 나누기와 따옴표
  assert.deepEqual(shellStatements("a 'b c' \"d`\"e\"; f && g || h\ni"), [['a', { text: 'b c', spaced: true }, 'd"e'], ['f'], ['g'], ['h'], ['i']]);
});

test('P97 붙여 넣기: 판이 정하는 인자는 값과 함께 빼고, 따옴표로 묶은 빈칸 값은 앞 플래그와 함께 뺀다. --dangerously-skip-permissions는 bypassPermissions', () => {
  const r = parse('claude --session-id abc --resume xyz -c --settings s.json --plugin-dir p -w wt --model haiku --dangerously-skip-permissions --append-system-prompt "be terse" --verbose -p');
  assert.deepEqual(r.recognized.dropped, ['--session-id abc', '--resume xyz', '-c', '--settings s.json', '--plugin-dir p', '-w wt', '-p']);
  assert.deepEqual([r.launcher.model, r.launcher.permissionMode, r.launcher.args], ['haiku', 'bypassPermissions', "--append-system-prompt 'be terse' --verbose"]);
  valid(r);
  // 경로로 준 claude는 PATH의 claude로
  const p = parse('C:\\Users\\me\\.local\\bin\\claude.exe --model haiku');
  assert.deepEqual([p.launcher.startCommand, p.recognized.agentPath, p.recognized.board], ['', 'C:\\Users\\me\\.local\\bin\\claude.exe', true]);
  // npx 같은 감싸개
  assert.equal(parse('npx @anthropic-ai/claude-code --model haiku').launcher.startCommand, 'npx @anthropic-ai/claude-code');
});

test('P97 붙여 넣기: 모르는 명령, claude 밖의 감싸개, claude 밖의 환경 변수는 명령 한 줄 호출자(판 연동 없음). 빈 글은 빈 틀', () => {
  const a = parse('aider --model "gpt x" --yes');
  assert.deepEqual([a.recognized.as, a.recognized.why, a.launcher.harness, a.launcher.command, a.recognized.board], ['command', 'unknown', 'command', "aider --model 'gpt x' --yes", false]);
  valid(a);
  assert.equal(parse('ocx codex -m x').recognized.why, 'wrapperNotClaude');
  const e = parse("$env:OPENAI_BASE_URL='http://x'; codex -m y");
  assert.equal(e.launcher.harness, 'codex');
  assert.deepEqual(e.launcher.env, { OPENAI_BASE_URL: 'http://x' });
  assert.deepEqual(previewLauncher(valid(e)).env, ['OPENAI_BASE_URL']);
  assert.equal(previewLauncher(valid(e)).line, 'codex --model y');
  const z = parse('   \n  ');
  assert.equal(z.recognized.as, 'empty');
});

test('P97 실행 명령 검사: 빈 칸·claude는 기본, 첫 낱말은 명령 이름, 셸 기호·따옴표·판의 인자는 막는다', () => {
  assert.equal(normalizeStartCommand(''), ''); assert.equal(normalizeStartCommand(' claude '), ''); assert.equal(normalizeStartCommand('CLAUDE'), process.platform === 'win32' ? '' : 'CLAUDE');
  assert.equal(normalizeStartCommand('  ocx   claude '), 'ocx claude');
  assert.equal(normalizeStartCommand('npx @anthropic-ai/claude-code'), 'npx @anthropic-ai/claude-code');
  assert.equal(normalizeStartCommand('ocx --account \"two words\" claude'), "ocx --account 'two words' claude");
  for (const bad of ['ocx; rm x', 'a b c d e f g h i', 'x'.repeat(121)]) assert.throws(() => normalizeStartCommand(bad), (e) => e.key === 'launcherStart.bad', bad);
  assert.throws(() => normalizeStartCommand('ocx\tclaude\n'), { code: 'bad_request' });
  assert.throws(() => normalizeStartCommand('ocx claude --model x'), (e) => e.key === 'launcherStart.reserved' && e.vars.arg === '--model');
  assert.throws(() => normalizeStartCommand('ocx claude --settings=x'), (e) => e.key === 'launcherStart.reserved');
  // 호출자 검사: claude만 실행 명령을 받는다. 빈 칸이면 저장 모양이 옛 호출자와 같다
  const l = normalizeLauncher({ name: 'o', harness: 'claude', startCommand: 'ocx claude' });
  assert.equal(l.startCommand, 'ocx claude');
  assert.equal('startCommand' in normalizeLauncher({ name: 'c', harness: 'claude', startCommand: 'claude' }), false);
  assert.equal('startCommand' in normalizeLauncher({ name: 'x', harness: 'codex', startCommand: 'ocx codex' }), false);
  assert.ok(HARNESSES.claude.fields.includes('startCommand'));
  assert.deepEqual(resolveLauncher(l).startCommand, 'ocx claude');
  assert.equal(resolveLauncher(normalizeLauncher({ name: 'c', harness: 'claude' })).startCommand, '');
});

test('P97 PATH 경고: 실행 명령의 첫 낱말이 PATH(PATHEXT, .ps1)에 없으면 경고만 한다', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'fakeocx.cmd'), '@echo off');
  fs.writeFileSync(path.join(dir, 'psonly.ps1'), '');
  const env = { Path: dir, PATHEXT: '.COM;.EXE;.CMD' };
  assert.equal(onPath('fakeocx', { env, platform: 'win32', now: 1 }), true);
  assert.equal(onPath('psonly', { env, platform: 'win32', now: 1 }), true);
  assert.equal(onPath('nothere-p97', { env, platform: 'win32', now: 1 }), false);
  const find = (w) => w === 'fakeocx';
  assert.equal(startWarning({ startCommand: 'fakeocx claude' }, find), null);
  assert.deepEqual(startWarning({ startCommand: 'nothere-p97 claude' }, find), { key: 'launcherStart.notFound', vars: { cmd: 'nothere-p97' } });
  assert.equal(startWarning({ startCommand: '' }, find), null);
});

test('P97 띄우기·이어 가기 인자: 실행 명령 + 판의 인자, 이어 가기 명령의 첫 낱말은 실행 명령. PowerShell 따옴표', () => {
  const o = { sessionId: 'S1', settingsPath: 'C:/d/sessions/S1.json', permissionMode: 'manual', model: 'ocx-claude-deepseek--deepseek-flash[1m]', effort: null, extraArgs: ['--verbose'], pluginDir: 'C:/d/plugin/atrium-herdr' };
  assert.deepEqual(buildResumeArgv({ claudeCommand: 'claude', startCommand: 'ocx claude', ...o }).slice(0, 4), ['ocx', 'claude', '--resume', 'S1']);
  assert.deepEqual(buildResumeArgv({ claudeCommand: 'claude', startCommand: '', ...o }).slice(0, 3), ['claude', '--resume', 'S1']);
  assert.deepEqual(buildResumeArgv({ claudeCommand: 'claude', ...o }).slice(0, 2), ['claude', '--resume'], '옛 세션(실행 명령 없음)은 그대로');
  const line = psLine(['ocx', 'claude', ...buildStartArgs(o)]);
  assert.equal(line, "ocx claude --session-id S1 --no-chrome --permission-mode manual --settings C:/d/sessions/S1.json --model 'ocx-claude-deepseek--deepseek-flash[1m]' --plugin-dir C:/d/plugin/atrium-herdr --verbose");
  assert.equal(psQuote("C:/Users/A B/it's.json"), "'C:/Users/A B/it''s.json'");
  assert.equal(psQuote('@scope/pkg'), "'@scope/pkg'", '@로 시작하는 낱말은 PowerShell이 펼치지 않게 묶는다');
  assert.deepEqual(claudeStartOf({ kind: 'claude', startCommand: 'ocx claude' }), ['ocx', 'claude']);
  assert.deepEqual(claudeStartOf({ kind: 'codex', startCommand: 'ocx claude' }), []);
  assert.deepEqual(startOpt({ kind: 'claude', startCommand: '' }), {});
  assert.deepEqual(startOpt({ kind: 'claude', startCommand: 'ocx claude' }), { command: ['ocx', 'claude'] });
});

test('P97 herdr: 실행 명령이 있으면 셸에 줄을 치고, 에이전트를 알아보면 이름을 붙인다. 끝내 안 보이면 agent_not_detected', async () => {
  const a = new HerdrAdapter({ herdrPath: null, session: 'atrium-dev-p97test', logDir: tmp() });
  const calls = []; let polls = 0;
  a.call = async (m, p) => {
    calls.push([m, p]);
    if (m === 'pane.get') { polls++; return { pane: { pane_id: p.pane_id, agent: polls >= 3 ? 'claude' : null } }; }
    if (m === 'agent.rename') return { agent: { name: p.name, pane_id: p.target, agent: 'claude', agent_status: 'unknown' } };
    if (m === 'agent.start') throw new Error('agent.start는 부르지 않는다');
    return {};
  };
  const r = await a.startAgent({ name: 's1', paneId: 'w1:p1', args: ['--session-id', 'S1', '--model', 'x[1m]'], command: ['ocx', 'claude'], timeoutMs: 2000 });
  assert.equal(calls[0][0], 'pane.send_text'); assert.deepEqual(splitArgs(calls[0][1].text), ['ocx', 'claude', '--session-id', 'S1', '--model', 'x[1m]']);
  assert.deepEqual(calls[1], ['pane.send_keys', { pane_id: 'w1:p1', keys: ['enter'] }]);
  assert.deepEqual(calls.find((c) => c[0] === 'agent.rename')[1], { target: 'w1:p1', name: 's1' });
  assert.deepEqual(r.argv, ['ocx', 'claude', '--session-id', 'S1', '--model', 'x[1m]']); assert.equal(r.agent.name, 's1'); assert.equal(r.typed, true);
  // 실행 명령이 없으면 지금처럼 agent.start
  const b = new HerdrAdapter({ herdrPath: null, session: 'atrium-dev-p97test', logDir: tmp() });
  const bc = [];
  b.call = async (m, p) => { bc.push(m); return { agent: { name: p.name }, argv: ['claude', ...p.args] }; };
  await b.startAgent({ name: 's2', paneId: 'w2:p1', args: ['--x'] });
  assert.deepEqual(bc, ['agent.start']);
  // 끝내 안 보이면
  const c = new HerdrAdapter({ herdrPath: null, session: 'atrium-dev-p97test', logDir: tmp() });
  c.call = async (m, p) => (m === 'pane.get' ? { pane: { pane_id: p.pane_id, agent: null } } : {});
  await assert.rejects(() => c.typeAgent({ name: 's3', paneId: 'w3:p1', args: [], kind: 'claude', command: ['nope'], timeoutMs: 120, pollMs: 20 }), (e) => e.code === 'agent_not_detected' && e.argv[0] === 'nope');
});

function spawnBackend() {
  const dir = tmp();
  const b = new Backend({ quietMs: 600000, port: 0, logDir: dir, sessionsDir: path.join(dir, 'sessions'), claudeJson: path.join(dir, 'none.json'), claudeCommand: 'claude', hookTimeoutSec: 2 });
  b.store = new Store(path.join(dir, 'board.db'));
  b.sessions = new Map(); b.herdrOk = true; b.hookUrl = 'http://127.0.0.1:1/hook'; b.plugin = {};
  b.branch = { settingsExtra: () => ({}), noteChild() {}, placeChild: () => null };
  b.features = { settings: { get: () => ({ ...DEFAULTS }) }, launchers: null };
  b.features.launchers = new Launchers({ store: b.store });
  b.queue = { enqueue() {}, pending: () => 0 };
  b.api = { broadcast() {} };
  b.broadcastSession = () => {}; b.broadcastWorkspaces = () => {}; b.probeGit = () => {}; b.registerResume = () => {};
  const calls = []; let n = 0;
  b.adapter = {
    connected: true,
    agentKinds: async () => [{ kind: 'claude', installed: true }, { kind: 'codex', installed: false }],
    createWorkspace: async (o) => { calls.push(['createWorkspace', o]); n++; return { paneId: `w${n}:p1`, workspaceId: `w${n}` }; },
    refreshSubscription: async () => {}, waitShellReady: async () => true,
    startAgent: async (o) => { calls.push(['startAgent', o]); if (o.command && o.command[0] === 'broken') throw Object.assign(new Error('x'), { code: 'agent_not_detected', argv: [...o.command, ...o.args] }); return { agent: null, argv: [...(o.command || [o.kind]), ...o.args] }; },
    sendText: async (pane, text) => { calls.push(['sendText', pane, text]); },
    paneKeys: async (pane, keys) => { calls.push(['paneKeys', pane, keys]); },
  };
  return { b, calls, cwd: dir };
}

test('P97 spawn { launcher }: 실행 명령 호출자는 판 세션(설정 파일·hook)으로 그 명령을 치고, 이어 가기·되살리기·세션 행에도 남는다', async () => {
  const { b, calls, cwd } = spawnBackend();
  b.features.launchers.create({ launcher: { name: 'ocx claude', harness: 'claude', startCommand: 'ocx claude', model: 'haiku' }, favorite: true });
  const r = await b.spawn({ cwd, launcher: 'ocx claude', name: 'oc1' });
  assert.equal(r.kind, 'claude'); assert.equal(r.name, 'oc1');
  const st = calls.find((c) => c[0] === 'startAgent')[1];
  assert.deepEqual(st.command, ['ocx', 'claude']);
  assert.deepEqual(st.args.slice(0, 2), ['--session-id', r.sessionId]);
  assert.ok(st.args.includes('--settings') && st.args.includes('haiku'), '판의 인자(설정 파일, 모델)');
  assert.deepEqual(r.resumeArgv.slice(0, 4), ['ocx', 'claude', '--resume', r.sessionId]);
  assert.ok(fs.existsSync(r.settingsPath), 'hook 설정 파일');
  const s = b.sessions.get(r.sessionId);
  assert.equal(s.startCommand, 'ocx claude');
  assert.equal(b.store.getSession(r.sessionId).runtime.startCommand, 'ocx claude', '세션 행(start_command)');
  assert.equal(b.launchOf(s).startCommand, 'ocx claude');
  assert.deepEqual(buildResumeArgv({ claudeCommand: 'claude', ...b.launchOf(s) }).slice(0, 2), ['ocx', 'claude'], '데이터 폴더를 옮긴 뒤 다시 만든 이어 가기 명령도');
  assert.equal(b.store.spawnInfo(r.sessionId).startCommand, undefined, '원문 실행 명령은 공개 이벤트에 넣지 않는다');
  // 기본 Claude Code 호출자는 그대로 herdr agent.start(command 없음)
  calls.length = 0;
  const c = await b.spawn({ cwd, launcher: 'claude' });
  assert.equal(calls.find((x) => x[0] === 'startAgent')[1].command, undefined);
  assert.equal(c.resumeArgv[0], 'claude');
  assert.equal(b.store.getSession(c.sessionId).runtime.startCommand || '', '');
  // 실행 명령으로 claude가 뜨지 않으면 까닭을 돌려준다
  b.features.launchers.create({ launcher: { name: 'Broken', harness: 'claude', startCommand: 'broken claude' } });
  await assert.rejects(() => b.spawn({ cwd, launcher: 'Broken' }), (e) => e.code === 'start_command_failed' && e.key === 'launcherStart.failed' && e.vars.cmd === 'broken claude');
  b.store.close();
});

test('P97 하위 세션: 정하지 않으면 부모 claude의 실행 명령을 물려받고, --launcher로 고른 호출자는 그 호출자의 것', async () => {
  const { b, calls, cwd } = spawnBackend();
  b.features.launchers.create({ launcher: { name: 'ocx', harness: 'claude', startCommand: 'ocx claude' } });
  const parent = await b.spawn({ cwd, launcher: 'ocx', name: 'lead' });
  // atrium child의 물려받기(plain): kind와 부모 ID, branch만 준다
  calls.length = 0;
  const kid = await b.spawn({ cwd, name: 'kid', kind: 'claude', model: 'haiku', parentSessionId: parent.sessionId, branch: { role: '워커' } });
  assert.deepEqual(calls.find((x) => x[0] === 'startAgent')[1].command, ['ocx', 'claude']);
  assert.deepEqual(kid.resumeArgv.slice(0, 2), ['ocx', 'claude']);
  // 게이트웨이 물려받기처럼 실행 명령 없는 정의(launcherDef)도 부모의 것
  calls.length = 0;
  await b.spawn({ cwd, name: 'kid2', launcherDef: { id: null, name: 'gateway', harness: 'claude', env: { X: '1' } }, parentSessionId: parent.sessionId, branch: { role: '워커' } });
  assert.deepEqual(calls.find((x) => x[0] === 'startAgent')[1].command, ['ocx', 'claude']);
  // --launcher claude(기본)로 고르면 claude
  calls.length = 0;
  await b.spawn({ cwd, name: 'kid3', launcher: 'claude', parentSessionId: parent.sessionId, branch: { role: '워커' } });
  assert.equal(calls.find((x) => x[0] === 'startAgent')[1].command, undefined);
  // 부모가 기본 claude면 하위 세션도 claude
  const plain = await b.spawn({ cwd, launcher: 'claude', name: 'lead2' });
  calls.length = 0;
  await b.spawn({ cwd, name: 'kid4', kind: 'claude', parentSessionId: plain.sessionId, branch: { role: '워커' } });
  assert.equal(calls.find((x) => x[0] === 'startAgent')[1].command, undefined);
  b.store.close();
});

test('P97 API launcher.parse: 겹치지 않는 이름을 제안하고 미리보기를 붙인다(저장하지 않는다)', () => {
  const dir = tmp();
  const store = new Store(path.join(dir, 'board.db'));
  const L = new Launchers({ store });
  L.create({ launcher: { name: 'ocx claude haiku', harness: 'claude', startCommand: 'ocx claude', model: 'haiku' } });
  const r = L.parse({ text: 'ocx claude --model haiku', kinds: ['claude', 'codex'] });
  assert.equal(r.launcher.name, 'ocx claude haiku 2');
  assert.equal(r.recognized.board, true);
  assert.match(r.preview.line, /^ocx claude --permission-mode manual --model haiku$/);
  assert.equal(L.list().launchers.length, 5, '저장하지 않는다');
  // 고치는 중인 호출자는 이름 겹침에서 뺀다
  const id = L.list().launchers.find((l) => l.name === 'ocx claude haiku').id;
  assert.equal(L.parse({ text: 'ocx claude --model haiku', except: id }).launcher.name, 'ocx claude haiku');
  // 검사를 지나지 못하면 미리보기 자리에 오류(열쇠)
  const bad = L.parse({ text: 'claude --effort huge' });
  assert.equal(bad.preview.error.key, 'launchers.err.effort');
  assert.equal(uniqueName('', []), 'Launcher');
  store.close();
});

test('P97 herdr 다시 켜기: 이어 가기 명령으로 되살린 패널에 이름이 없으면 판의 주소로 다시 붙인다(다른 패널이 쓰면 손대지 않는다)', async () => {
  const { b } = spawnBackend();
  const calls = [];
  const agents = new Map(); // 이름 → 패널
  b.adapter.getAgent = async (n) => (agents.has(n) ? { name: n, paneId: agents.get(n) } : null);
  b.adapter.getPane = async (p) => ({ paneId: p, agent: 'claude' });
  b.adapter.renameAgent = async (t, n) => { calls.push([t, n]); agents.set(n, t); return { name: n, paneId: t }; };
  const s = { sessionId: 'S1', name: 'p97-ocx', agentName: 'p97-ocx', paneId: 'w2:p1', kind: 'claude', startCommand: 'ocx claude', rt: {} };
  b.sessions.set(s.sessionId, s);
  assert.equal(await b.ensureAgentName(s), true);
  assert.deepEqual(calls, [['w2:p1', 'p97-ocx']]);
  assert.equal(await b.ensureAgentName(s), false);
  assert.equal(calls.length, 1, '이름이 그 패널에 있으면 그대로');
  // 전달(agent.prompt)이 이름을 못 찾으면 이름을 다시 붙이고 한 번 더 보낸다(실행 명령 세션만)
  b.sessions.set('S1', s);
  agents.delete('p97-ocx');
  const sent = [];
  b.adapter.prompt = async (target, text) => { if (!agents.has(target)) throw Object.assign(new Error('nf'), { code: 'agent_not_found' }); sent.push([target, text]); return {}; };
  await b.sendPrompt('S1', 'hi');
  assert.deepEqual(sent, [['p97-ocx', 'hi']]); assert.equal(calls.length, 2);
  b.sessions.set('S9', { ...s, sessionId: 'S9', agentName: 'plain', paneId: 'w8:p1', startCommand: '' });
  await assert.rejects(() => b.sendPrompt('S9', 'x'), (e) => e.code === 'agent_not_found', '실행 명령이 없는 세션은 지금처럼');
  agents.set('p97-x', 'w9:p1');
  await b.ensureAgentName({ ...s, sessionId: 'S2', agentName: 'p97-x', paneId: 'w3:p1' });
  assert.equal(calls.length, 2, '다른 패널이 그 이름을 쓰면 손대지 않는다');
  await b.ensureAgentName({ ...s, agentName: 'w4:p1', paneId: 'w4:p1' });
  assert.equal(calls.length, 2, '이름 없는 에이전트(패널 ID로 부름)는 그대로');
  b.store.close();
});
