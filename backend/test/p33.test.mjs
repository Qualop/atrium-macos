// P33 단위 시험: 호출자(launchers.mjs). 하네스별 풀기와 명령 미리보기, 옛 설정 옮기기와 새 판 기본값(두 번 돌려도 같음),
// 검사(이름 겹침, 잘못된 모델 글자, 줄바꿈 든 명령, 환경 변수 이름, 판이 정하는 인자), 즐겨찾기·순서, session.spawn { launcher }(가짜 herdr)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Launchers, initialLaunchers, normalizeLauncher, resolveLauncher, previewLauncher, checkGateway, harnessOf, LEGACY_KEYS, META_KEY } from '../src/launchers.mjs';
import { Store } from '../src/store.mjs';
import { Backend } from '../src/backend.mjs';
import { DEFAULTS } from '../src/settings.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p33-'));
const L = (o) => normalizeLauncher({ name: 'x', ...o });

test('P33 풀기: claude는 모델·노력 수준·권한 모드·herdr 자동 승인·추가 인자·환경 변수, 함께 준 값이 덮는다', () => {
  const l = L({ harness: 'claude', model: 'haiku', effort: 'low', permissionMode: 'acceptEdits', allowHerdr: true, args: '--verbose', env: 'FOO=bar\nANTHROPIC_BASE_URL=http://127.0.0.1:9' });
  const r = resolveLauncher(l);
  assert.equal(r.kind, 'claude'); assert.equal(r.model, 'haiku'); assert.equal(r.effort, 'low'); assert.equal(r.permissionMode, 'acceptEdits'); assert.equal(r.allowHerdr, true);
  assert.deepEqual(r.extraArgs, ['--verbose']);
  assert.deepEqual(r.env, { FOO: 'bar', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' });
  assert.deepEqual(r.gateway, { url: 'http://127.0.0.1:9', health: false }, 'ANTHROPIC_BASE_URL이 있으면 닿는지 본다');
  assert.equal(r.flavor, null);
  const o = resolveLauncher(l, { model: 'opus', effort: 'high', permissionMode: 'plan', allowHerdr: false });
  assert.deepEqual([o.model, o.effort, o.permissionMode, o.allowHerdr], ['opus', 'high', 'plan', false]);
  assert.equal(resolveLauncher(l, { model: '' }).model, 'haiku', '빈 값은 덮지 않는다');
  assert.throws(() => resolveLauncher(l, { model: 'a b' }), (e) => e.key === 'launchers.err.model');
});

test('P33 풀기: codex는 -m 모델과 추가 인자, 다른 종류는 추가 인자만, 셸, 직접 명령(플랫폼에 맞는 환경 변수)', () => {
  const cx = resolveLauncher(L({ harness: 'codex', model: 'gpt-6-astra', args: '-c model_reasoning_effort=low' }));
  assert.equal(cx.kind, 'codex'); assert.deepEqual(cx.args, ['-c', 'model_reasoning_effort=low', '--model', 'gpt-6-astra']);
  assert.deepEqual(resolveLauncher(L({ harness: 'codex', model: 'gpt-6-astra' }), { model: 'o9' }).args, ['--model', 'o9']);
  const pi = L({ harness: 'pi', model: 'ignored', args: '--x 1' });
  assert.equal(pi.model, '', '다른 종류는 모델 칸이 없다');
  assert.deepEqual(resolveLauncher(pi), { kind: 'pi', flavor: null, launcher: 'x', launcherId: null, args: ['--x', '1'], command: '' });
  assert.deepEqual(resolveLauncher(L({ harness: 'shell' })), { kind: 'shell', flavor: null, launcher: 'x', launcherId: null, command: '' });
  const cmd = resolveLauncher(L({ harness: 'command', command: 'echo hi', env: { A: "it's" }, icon: 'grok' }));
  assert.equal(cmd.kind, 'shell'); assert.equal(cmd.command, 'echo hi'); assert.equal(cmd.flavor, 'grok');
  assert.deepEqual(cmd.env, { A: "it's" });
  assert.equal(harnessOf('BAD'), null);
});

test('P33 미리보기: 하네스별 명령줄. claude는 판이 덧붙이는 값을 빼고, 환경 변수는 이름만', () => {
  assert.deepEqual(previewLauncher(L({ harness: 'claude', model: 'haiku', effort: 'low', args: '--verbose', env: { K: 'secret' } })), { line: 'claude --permission-mode manual --model haiku --effort low --verbose', env: ['K'], board: true });
  assert.equal(previewLauncher(L({ harness: 'codex', model: 'gpt-6-astra' })).line, 'codex --model gpt-6-astra');
  assert.equal(previewLauncher(L({ harness: 'pi', args: '--y' })).line, 'pi --y');
  assert.equal(previewLauncher(L({ harness: 'shell' })).shell, true);
  assert.deepEqual(previewLauncher(L({ harness: 'command', command: 'claude --model haiku; exit' })), { line: 'claude --model haiku; exit', env: [], board: false, typed: true });
});

test('P33 검사: 이름(빈 값, 겹침은 대소문자 무시), 모델 글자, 줄바꿈 든 명령, 빈 명령, 환경 변수, 판이 정하는 인자, 아이콘, 확인 주소', () => {
  const others = [{ id: 'a', name: 'Claude Code' }];
  assert.throws(() => normalizeLauncher({ name: ' ', harness: 'claude' }), (e) => e.key === 'launchers.err.name');
  assert.throws(() => normalizeLauncher({ name: 'claude code', harness: 'claude' }, { others }), (e) => e.code === 'name_taken' && e.key === 'launchers.err.nameTaken');
  assert.equal(normalizeLauncher({ id: 'a', name: 'Claude Code', harness: 'claude' }, { others }).name, 'Claude Code', '자기 자신과는 겹치지 않는다');
  assert.throws(() => L({ name: 'a\nb' }), (e) => e.key === 'launchers.err.name');
  assert.throws(() => L({ harness: 'claude', model: 'opus --dangerously-skip-permissions' }), (e) => e.key === 'launchers.err.model');
  assert.throws(() => L({ harness: 'claude', model: 'opus;rm' }), (e) => e.key === 'launchers.err.model');
  assert.equal(L({ harness: 'claude', model: 'claude-opus-5-5[1m]' }).model, 'claude-opus-5-5[1m]');
  assert.throws(() => L({ harness: 'command', command: 'echo a\nclaude' }), (e) => e.key === 'launchers.err.commandLine');
  assert.throws(() => L({ harness: 'command', command: '   ' }), (e) => e.key === 'launchers.err.commandEmpty');
  assert.throws(() => L({ harness: 'claude', effort: 'huge' }), (e) => e.key === 'launchers.err.effort');
  assert.throws(() => L({ harness: 'claude', permissionMode: 'yolo' }), (e) => e.key === 'launchers.err.permissionMode');
  assert.throws(() => L({ harness: 'claude', env: '1BAD=x' }), (e) => e.key === 'launchers.err.envName');
  assert.throws(() => L({ harness: 'claude', env: 'novalue' }), (e) => e.key === 'launchers.err.envLine');
  assert.throws(() => L({ harness: 'claude', env: { HERDR_SESSION: 'x' } }), (e) => e.key === 'launchers.err.envReserved');
  assert.throws(() => L({ harness: 'claude', env: { A: 'a\nb' } }), (e) => e.key === 'launchers.err.envValue');
  assert.throws(() => L({ harness: 'claude', args: '--settings x.json' }), (e) => e.key === 'launchers.err.argsReserved');
  assert.throws(() => L({ harness: 'claude', args: '--model=opus' }), (e) => e.key === 'launchers.err.argsReserved');
  assert.throws(() => L({ harness: 'claude', checkUrl: 'file:///x' }), (e) => e.key === 'launchers.err.checkUrl');
  assert.throws(() => L({ harness: 'claude', icon: 'Bad Icon' }), (e) => e.key === 'launchers.err.icon');
  assert.throws(() => L({ harness: 'Bad Kind' }), (e) => e.key === 'launchers.err.harness');
  // 하네스가 받지 않는 칸은 비운다(codex는 환경 변수를 받고 셸은 받지 않는다)
  assert.deepEqual(L({ harness: 'codex', env: { A: '1' }, effort: 'high', command: 'x' }).env, { A: '1' });
  const sh = L({ harness: 'shell', model: 'm', args: 'a', command: 'c' });
  assert.deepEqual([sh.model, sh.args, sh.command, sh.permissionMode], ['', '', '', '']);
});

test('P33 옮기기: 옛 설정 → 호출자, 레일 네 단추 순서로 즐겨찾기(옛 판)', () => {
  const old = { claudeModel: 'opus', claudeEffort: 'high', claudePermissionMode: 'acceptEdits', claudeAllowHerdr: true, codexArgs: '-m gpt-6-astra', deepseekModel: 'ds-x[1m]', deepseekCommand: '' };
  const v = initialLaunchers({ oldSettings: old, oldBoard: true });
  assert.deepEqual(v.favorites, ['claude', 'codex', 'gemini', 'deepseek', 'shell']);
  const by = Object.fromEntries(v.items.map((l) => [l.id, l]));
  assert.deepEqual([by.claude.model, by.claude.effort, by.claude.permissionMode, by.claude.allowHerdr], ['opus', 'high', 'acceptEdits', true]);
  assert.equal(by.codex.args, '-m gpt-6-astra');
  assert.equal(by.deepseek.harness, 'claude'); assert.equal(by.deepseek.model, 'ds-x[1m]'); assert.equal(by.deepseek.icon, 'deepseek');
  assert.equal(by.deepseek.permissionMode, 'acceptEdits', '옛 DeepSeek도 Claude 권한 모드를 썼다');
  assert.equal(by.deepseek.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:10100');
  assert.equal(by.deepseek.checkUrl, 'http://127.0.0.1:10100/healthz');
  assert.ok(!Object.keys(by.deepseek.env).some((k) => /KEY|TOKEN|SECRET/.test(k)), '키를 넣지 않는다');
  // 옛 직접 명령이 있으면 DeepSeek는 명령 호출자
  const c = initialLaunchers({ oldSettings: { deepseekCommand: 'ocx claude' }, oldBoard: true }).items.find((l) => l.id === 'deepseek');
  assert.deepEqual([c.harness, c.command, c.icon], ['command', 'ocx claude', 'deepseek']);
  // 모든 기본 호출자는 검사를 지난다
  for (const l of v.items) assert.deepEqual(normalizeLauncher(l, { others: v.items }), l, l.id);
  assert.deepEqual(LEGACY_KEYS.sort(), Object.keys(old).sort());
});

test('P33 옮기기: 새 판은 Claude Code, Codex, 셸이 즐겨찾기이고 DeepSeek는 즐겨찾기 밖 예시', () => {
  const v = initialLaunchers({});
  assert.deepEqual(v.favorites, ['claude', 'codex', 'gemini', 'shell']);
  assert.ok(v.items.some((l) => l.id === 'deepseek'));
  assert.deepEqual(initialLaunchers({}), v, '같은 입력이면 같은 결과');
});

test('P33 옮기기: 판 기록에서 한 번만. 옛 설정이 있으면 옛 판, 두 번 켜도 같고 옛 키는 남는다', () => {
  const dir = tmp();
  try {
    const store = new Store(path.join(dir, 'board.db'));
    store.setMeta('settings', { tray: true, claudeModel: 'sonnet' });
    const a = new Launchers({ store });
    assert.deepEqual(a.migrated, { oldBoard: true, favorites: ['claude', 'codex', 'gemini', 'deepseek', 'shell'] });
    const first = store.getMeta(META_KEY);
    assert.equal(first.items.find((l) => l.id === 'claude').model, 'sonnet');
    const b = new Launchers({ store });
    assert.equal(b.migrated, null);
    assert.deepEqual(store.getMeta(META_KEY), first);
    assert.equal(store.getMeta('settings').claudeModel, 'sonnet', '옛 키는 지우지 않는다');
    // 사용자가 바꾼 뒤에 다시 켜도 덮지 않는다
    b.favorite({ id: 'shell', favorite: false });
    new Launchers({ store });
    assert.deepEqual(store.getMeta(META_KEY).favorites, ['claude', 'codex', 'gemini', 'deepseek']);
    store.close();
    // 설정은 없지만 세션 기록이 있는 판도 옛 판
    const s2 = new Store(path.join(dir, 'b2.db'));
    s2.insertSession({ sessionId: 'x', name: 'x', cwd: dir, permissionMode: 'manual', createdAt: 1 });
    assert.equal(new Launchers({ store: s2 }).migrated.oldBoard, true);
    s2.close();
    const s3 = new Store(path.join(dir, 'b3.db'));
    assert.deepEqual(new Launchers({ store: s3 }).migrated, { oldBoard: false, favorites: ['claude', 'codex', 'gemini', 'shell'] });
    s3.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('P33 API: 만들기, 고치기, 지우기, 즐겨찾기(자리), 순서. 알림은 launchers.updated', () => {
  const dir = tmp();
  const events = [];
  try {
    const store = new Store(path.join(dir, 'board.db'));
    const ls = new Launchers({ store, broadcast: (ev, d) => events.push([ev, d]) });
    const c = ls.create({ launcher: { name: 'Haiku', harness: 'claude', model: 'haiku' }, favorite: true });
    assert.match(c.launcher.id, /^l[0-9a-f]{8}$/);
    assert.deepEqual(c.favorites, ['claude', 'codex', 'gemini', 'shell', c.launcher.id]);
    assert.equal(c.launchers.find((l) => l.id === c.launcher.id).preview.line, 'claude --permission-mode manual --model haiku');
    assert.equal(events.at(-1)[0], 'launchers.updated');
    assert.throws(() => ls.create({ launcher: { name: 'haiku', harness: 'claude' } }), (e) => e.code === 'name_taken');
    assert.equal(ls.find('HAIKU').id, c.launcher.id, '이름은 대소문자 무시');
    ls.update({ id: c.launcher.id, patch: { model: 'sonnet' } });
    assert.equal(ls.get('Haiku').model, 'sonnet');
    assert.throws(() => ls.update({ id: c.launcher.id, patch: { name: 'Codex' } }), (e) => e.code === 'name_taken');
    ls.favorite({ id: 'deepseek', index: 0 });
    assert.deepEqual(ls.data().favorites, ['deepseek', 'claude', 'codex', 'gemini', 'shell', c.launcher.id]);
    ls.favorite({ id: 'codex', favorite: false });
    assert.deepEqual(ls.data().favorites, ['deepseek', 'claude', 'gemini', 'shell', c.launcher.id]);
    ls.order({ ids: [c.launcher.id, 'shell', 'claude', 'gemini', 'deepseek'] });
    assert.deepEqual(ls.list().favorites, [c.launcher.id, 'shell', 'claude', 'gemini', 'deepseek']);
    assert.throws(() => ls.order({ ids: ['shell'] }), (e) => e.key === 'launchers.err.order');
    ls.delete({ id: c.launcher.id });
    assert.deepEqual(ls.data().favorites, ['shell', 'claude', 'gemini', 'deepseek']);
    assert.throws(() => ls.get(c.launcher.id), (e) => e.code === 'no_launcher');
    assert.deepEqual(ls.preview({ launcher: { name: 'p', harness: 'codex', model: 'm' } }).preview.line, 'codex --model m');
    store.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

async function server(reply) {
  const srv = http.createServer(reply);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) };
}
async function closedUrl() { const s = await server(() => {}); await s.close(); return s.url; }

test('P33 게이트웨이: 닿기만 보면 404도 통과, health면 ok여야, 꺼졌으면 gateway_down', async () => {
  const s = await server((req, res) => { res.statusCode = 404; res.end('nope'); });
  try {
    assert.deepEqual(await checkGateway({ url: s.url }), { ok: true, url: s.url });
    await assert.rejects(() => checkGateway({ url: s.url, health: true }), (e) => e.code === 'gateway_down' && e.vars.why === 'HTTP 404');
    const down = await closedUrl();
    await assert.rejects(() => checkGateway({ url: down, name: 'GW' }), (e) => e.code === 'gateway_down' && e.key === 'launchers.err.gatewayDown' && e.vars.name === 'GW');
  } finally { await s.close(); }
});

// spawn만 시험하는 백엔드(p25.test.mjs와 같은 가짜 herdr)
function spawnBackend() {
  const dir = tmp();
  const b = new Backend({ quietMs: 600000, port: 0, logDir: dir, sessionsDir: path.join(dir, 'sessions'), claudeJson: path.join(dir, 'none.json'), claudeCommand: 'claude', hookTimeoutSec: 2 });
  b.store = new Store(path.join(dir, 'board.db'));
  b.sessions = new Map(); b.herdrOk = true; b.hookUrl = 'http://127.0.0.1:1/hook'; b.plugin = {};
  b.branch = { settingsExtra: () => ({}), envFor: () => ({}), noteChild() {}, placeChild: () => null };
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
    startAgent: async (o) => { calls.push(['startAgent', o]); return { agent: null, argv: [o.kind, ...o.args] }; },
    sendText: async (pane, text) => { calls.push(['sendText', pane, text]); },
    paneKeys: async (pane, keys) => { calls.push(['paneKeys', pane, keys]); },
  };
  return { b, calls, cwd: dir };
}

test('P33 spawn { launcher }: claude 호출자(모델 haiku, 추가 인자, 환경 변수)로 띄우고 이어 가기 인자에도 남는다', async () => {
  const { b, calls, cwd } = spawnBackend();
  const { launcher } = b.features.launchers.create({ launcher: { name: 'Haiku', harness: 'claude', model: 'haiku', effort: 'low', args: '--verbose', env: { MY_FLAG: '1', API_KEY: 'fixture-secret' } } });
  const r = await b.spawn({ cwd, launcher: 'haiku' });
  assert.equal(r.kind, 'claude'); assert.equal(r.flavor, null);
  const st = calls.find((c) => c[0] === 'startAgent')[1];
  assert.equal(st.args[st.args.indexOf('--model') + 1], 'haiku');
  assert.equal(st.args.at(-1), '--verbose');
  assert.ok(r.resumeArgv.includes('--verbose') && r.resumeArgv.includes('haiku'));
  assert.equal(JSON.parse(fs.readFileSync(r.settingsPath, 'utf8')).env.MY_FLAG, '1');
  const s = b.sessions.get(r.sessionId);
  assert.deepEqual(b.launchOf(s).extraArgs, ['--verbose'], '깨우기·다시 띄우기도 같은 인자');
  assert.deepEqual(b.store.getSession(r.sessionId).extraArgs, ['--verbose']);
  const ev = b.store.spawnInfo(r.sessionId);
  assert.equal(ev.launcher, 'Haiku'); assert.ok(!JSON.stringify(ev).includes('fixture-secret'), '환경 변수 비밀 값은 이벤트에 남기지 않는다');
  // 함께 준 모델이 호출자 값을 덮는다
  const r2 = await b.spawn({ cwd, launcher: launcher.id, model: 'sonnet' });
  assert.ok(r2.resumeArgv.includes('sonnet') && !r2.resumeArgv.includes('haiku'));
  await assert.rejects(() => b.spawn({ cwd, launcher: 'nope' }), (e) => e.code === 'no_launcher');
  b.store.close();
});

test('P33 spawn { launcher }: 직접 명령은 셸 패널에 그 줄을 치고, 셸 호출자는 셸, 다른 아이콘은 flavor로 남는다', async () => {
  const { b, calls, cwd } = spawnBackend();
  b.features.launchers.create({ launcher: { name: 'Echo', harness: 'command', command: 'echo p33; exit', env: { X: '1' }, icon: 'grok' } });
  const r = await b.spawn({ cwd, launcher: 'Echo' });
  assert.equal(r.kind, 'shell'); assert.equal(r.flavor, 'grok'); assert.equal(r.command, '[command]');
  assert.deepEqual(calls.filter((c) => c[0] === 'sendText').map((c) => c[2]), ['echo p33; exit']);
  assert.deepEqual(calls.find((c) => c[0] === 'createWorkspace')[1].env, { X: '1' });
  assert.ok(!calls.some((c) => c[0] === 'startAgent'));
  await assert.rejects(() => b.spawn({ cwd, launcher: 'Echo', prompt: 'hi' }), (e) => e.code === 'not_agent');
  const sh = await b.spawn({ cwd, launcher: 'shell' });
  assert.equal(sh.kind, 'shell'); assert.equal(sh.command, undefined); assert.match(sh.name, /^sh\d/);
  b.store.close();
});

test('P33 spawn { launcher }: 게이트웨이(ANTHROPIC_BASE_URL)가 닿지 않으면 패널을 만들기 전에 알린다', async () => {
  const { b, calls, cwd } = spawnBackend();
  b.features.launchers.create({ launcher: { name: 'GW', harness: 'claude', env: { ANTHROPIC_BASE_URL: await closedUrl() } } });
  await assert.rejects(() => b.spawn({ cwd, launcher: 'GW' }), (e) => e.code === 'gateway_down' && e.vars.name === 'GW');
  assert.equal(calls.length, 0);
  b.store.close();
});

test('P33 spawn { launcher }: codex 호출자는 -m 모델과 인자를 herdr에 넘긴다(깔려 있지 않아도 인자 풀기는 같다)', async () => {
  const { b, calls, cwd } = spawnBackend();
  b.features.launchers.update({ id: 'codex', patch: { model: 'gpt-6-astra', args: '--full-auto' } });
  const r = await b.spawn({ cwd, launcher: 'Codex' });
  assert.equal(r.kind, 'codex');
  assert.deepEqual(calls.find((c) => c[0] === 'startAgent')[1].args, ['--full-auto', '--model', 'gpt-6-astra']);
  b.store.close();
});

test('P33 command launcher environment secrets stay in process env and private restore data', async () => {
  const { b, calls, cwd } = spawnBackend();
  const fixture = ['command', 'env', 'fixture', 'secret'].join('-');
  try {
    b.features.launchers.create({ launcher: { name: 'Private command', harness: 'command', icon: 'deepseek', command: 'echo ready', env: { API_TOKEN: fixture } } });
    const result = await b.spawn({ cwd, launcher: 'Private command' });
    assert.deepEqual(calls.find((c) => c[0] === 'createWorkspace')[1].env, { API_TOKEN: fixture });
    assert.deepEqual(calls.filter((c) => c[0] === 'sendText').map((c) => c[2]), ['echo ready']);
    const rt = b.sessions.get(result.sessionId).rt;
    assert.equal(rt.launcherCommand, 'echo ready');
    assert.deepEqual(rt.launcherEnv, { API_TOKEN: fixture });
    assert.ok(!JSON.stringify(b.store.events({ sessionId: result.sessionId })).includes(fixture));
  } finally { b.store.close(); }
});
