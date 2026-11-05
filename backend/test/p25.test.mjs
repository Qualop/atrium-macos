// P25 단위 시험: DeepSeek 바로 띄우기. 설정 값(모델, 직접 명령) 확인, 프록시 health 확인(꺼진 프록시는 닫힌 포트로 흉내 낸다. 실제 프록시는 끄지 않는다),
// session.spawn이 DeepSeek를 Claude Code(flavor deepseek, --model DeepSeek)로 띄우는지와 직접 명령을 셸 패널에 그대로 치는지(가짜 herdr).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { normalizePatch, DEFAULTS } from '../src/settings.mjs';
import { checkCommand, checkProxy, DEFAULT_MODEL, FLAVOR, COMMAND_MAX } from '../src/deepseek.mjs';
import { Store } from '../src/store.mjs';
import { Backend } from '../src/backend.mjs';
import { newRuntime } from '../src/state.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p25-'));

// health 주소를 흉내 내는 작은 서버. reply(req, res)로 답을 고른다
async function server(reply) {
  const srv = http.createServer(reply);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/healthz`, close: () => new Promise((r) => srv.close(r)) };
}
// 닫힌 포트(꺼진 프록시)
async function closedUrl() { const s = await server(() => {}); await s.close(); return s.url; }

test('P25 설정: DeepSeek 모델 기본값과 [ ] - 를 받는다, 직접 명령은 비어 있다', () => {
  assert.equal(DEFAULTS.deepseekModel, 'ocx-claude-deepseek--deepseek-flash[1m]');
  assert.equal(DEFAULT_MODEL, DEFAULTS.deepseekModel);
  assert.equal(DEFAULTS.deepseekCommand, '');
  assert.deepEqual(normalizePatch({ deepseekModel: ' ocx-claude-deepseek--deepseek-pro[1m] ' }), { deepseekModel: 'ocx-claude-deepseek--deepseek-pro[1m]' });
  assert.throws(() => normalizePatch({ deepseekModel: 'x --dangerously-skip-permissions' }), /deepseekModel/);
});

test('P25 설정: 직접 명령은 PowerShell 한 줄(줄바꿈·탭·제어 글자 없음, 길이 제한)', () => {
  const cmd = 'ocx claude --model "ocx-claude-deepseek--deepseek-flash[1m]"';
  assert.deepEqual(normalizePatch({ deepseekCommand: `  ${cmd} ` }), { deepseekCommand: cmd });
  assert.deepEqual(normalizePatch({ deepseekCommand: "echo hi; claude --model haiku | Out-Host & 'x'" }), { deepseekCommand: "echo hi; claude --model haiku | Out-Host & 'x'" });
  assert.throws(() => normalizePatch({ deepseekCommand: 'echo a\nclaude' }), /deepseekCommand.*한 줄/);
  assert.throws(() => normalizePatch({ deepseekCommand: 'echo a\rclaude' }), /deepseekCommand/);
  assert.throws(() => normalizePatch({ deepseekCommand: 'echo\ta' }), /deepseekCommand/);
  assert.throws(() => normalizePatch({ deepseekCommand: 'x'.repeat(COMMAND_MAX + 1) }), /deepseekCommand/);
  assert.equal(checkCommand('  '), '');
  assert.equal(checkCommand(' pi --model x '), 'pi --model x');
  assert.throws(() => checkCommand('a\nb'), (e) => e.code === 'bad_request' && e.key === 'deepseekCommandLine');
  assert.throws(() => checkCommand('x'.repeat(COMMAND_MAX + 1)), (e) => e.key === 'deepseekCommandLong' && e.vars.max === COMMAND_MAX);
});

test('P25 프록시: health가 ok면 통과, 꺼졌거나 HTTP 오류·ok 아닌 상태면 deepseek_proxy_down(ocx status, ocx start 안내)', async () => {
  const ok = await server((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ok', service: 'opencodex' })); });
  const bad = await server((req, res) => { res.statusCode = 503; res.end('down'); });
  const deg = await server((req, res) => { res.end(JSON.stringify({ status: 'starting' })); });
  try {
    assert.deepEqual(await checkProxy({ url: ok.url }), { ok: true, url: ok.url });
    const down = await closedUrl();
    await assert.rejects(() => checkProxy({ url: down, timeoutMs: 1500 }), (e) => e.code === 'deepseek_proxy_down' && e.key === 'deepseekProxyDown' && e.vars.url === down && /ocx status/.test(e.message) && /ocx start/.test(e.message));
    await assert.rejects(() => checkProxy({ url: bad.url }), (e) => e.code === 'deepseek_proxy_down' && e.vars.why === 'HTTP 503');
    await assert.rejects(() => checkProxy({ url: deg.url }), (e) => e.code === 'deepseek_proxy_down' && e.vars.why === 'status starting');
    // 답하지 않는 프록시는 시간 제한
    await assert.rejects(() => checkProxy({ url: ok.url, timeoutMs: 1, fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' })))) }), (e) => e.vars.why === 'timeout');
  } finally { await ok.close(); await bad.close(); await deg.close(); }
});

// spawn만 시험하는 백엔드: herdr는 가짜이고, 부르는 것을 적는다
function spawnBackend({ healthUrl, settings = {} }) {
  const dir = tmp();
  const b = new Backend({ quietMs: 600000, port: 0, logDir: dir, sessionsDir: path.join(dir, 'sessions'), claudeJson: path.join(dir, 'none.json'), claudeCommand: 'claude', hookTimeoutSec: 2, ocxHealthUrl: healthUrl });
  b.store = new Store(path.join(dir, 'board.db'));
  b.sessions = new Map();
  b.herdrOk = true;
  b.hookUrl = 'http://127.0.0.1:1/hook';
  b.plugin = {};
  b.branch = { settingsExtra: () => ({}), noteChild() {}, placeChild: () => null };
  b.features = { settings: { get: () => ({ ...DEFAULTS, ...settings }) } };
  b.queue = { enqueue() {}, pending: () => 0 };
  b.api = { broadcast() {} };
  b.broadcastSession = () => {}; b.broadcastWorkspaces = () => {}; b.probeGit = () => {}; b.registerResume = () => {};
  const calls = [];
  let n = 0;
  b.adapter = {
    connected: true,
    agentKinds: async () => [{ kind: 'claude', installed: true }],
    createWorkspace: async (o) => { calls.push(['createWorkspace', o]); n++; return { paneId: `w${n}:p1`, workspaceId: `w${n}` }; },
    refreshSubscription: async () => {},
    waitShellReady: async () => true,
    startAgent: async (o) => { calls.push(['startAgent', o]); return { agent: null, argv: [o.kind, ...o.args] }; },
    sendText: async (pane, text) => { calls.push(['sendText', pane, text]); },
    paneKeys: async (pane, keys) => { calls.push(['paneKeys', pane, keys]); },
  };
  return { b, calls, cwd: dir };
}

test('P25 spawn: 프록시가 꺼져 있으면 패널을 만들기 전에 알기 쉬운 오류(프록시를 켜지 않는다)', async () => {
  const { b, calls, cwd } = spawnBackend({ healthUrl: await closedUrl() });
  await assert.rejects(() => b.spawn({ cwd, kind: FLAVOR }), (e) => e.code === 'deepseek_proxy_down' && e.key === 'deepseekProxyDown');
  assert.equal(calls.length, 0, '패널도 에이전트도 만들지 않았다');
  assert.equal(b.sessions.size, 0);
  b.store.close();
});

test('P25 spawn: DeepSeek는 판이 띄우는 Claude Code(hook, 이어 가기)이고 모델만 DeepSeek. 저장은 종류 claude에 flavor deepseek', async () => {
  const ok = await server((req, res) => res.end(JSON.stringify({ status: 'ok' })));
  try {
    const { b, calls, cwd } = spawnBackend({ healthUrl: ok.url, settings: { claudeModel: 'opus', claudeEffort: 'high' } });
    const r = await b.spawn({ cwd, kind: FLAVOR });
    assert.equal(r.kind, 'claude'); assert.equal(r.flavor, 'deepseek'); assert.equal(r.name, 'ds1');
    const st = calls.find((c) => c[0] === 'startAgent')[1];
    assert.equal(st.kind, 'claude');
    assert.equal(st.args[st.args.indexOf('--model') + 1], 'ocx-claude-deepseek--deepseek-flash[1m]', '설정의 Claude 모델(opus)이 아니라 DeepSeek 모델');
    assert.ok(!st.args.includes('--effort'), 'Claude Code 노력 수준 기본값은 DeepSeek에 넘기지 않는다');
    assert.ok(st.args.includes('--settings'), '판의 hook 설정 파일');
    assert.ok(r.resumeArgv.includes('ocx-claude-deepseek--deepseek-flash[1m]'), '이어 가기도 같은 모델');
    // 세션 설정 파일의 env가 Claude Code를 프록시 주소(health의 origin)에 붙인다. 토큰은 넣지 않는다. 이어 가기 인자도 같은 설정 파일이다
    const sj = JSON.parse(fs.readFileSync(r.settingsPath, 'utf8'));
    assert.equal(sj.env.ANTHROPIC_BASE_URL, new URL(ok.url).origin);
    assert.equal(sj.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
    assert.ok(!Object.keys(sj.env).some((k) => /TOKEN|API_KEY/.test(k)));
    assert.ok(sj.hooks && sj.hooks.Stop, '판의 hook은 그대로');
    assert.equal(r.resumeArgv[r.resumeArgv.indexOf('--settings') + 1], r.settingsPath);
    const s = b.sessions.get(r.sessionId);
    assert.equal(s.flavor, 'deepseek'); assert.equal(b.hooked(s), true);
    assert.equal(b.store.getSession(r.sessionId).flavor, 'deepseek', '판 기록에 남아 다시 켜도 DeepSeek로 보인다');
    assert.equal(b.store.getSession(r.sessionId).kind, 'claude');
    // 설정의 DeepSeek 모델, 대화상자가 넘긴 모델
    b.features.settings.get = () => ({ ...DEFAULTS, deepseekModel: 'ocx-claude-deepseek--deepseek-pro[1m]' });
    const r2 = await b.spawn({ cwd, kind: FLAVOR });
    assert.ok(r2.resumeArgv.includes('ocx-claude-deepseek--deepseek-pro[1m]'));
    const r3 = await b.spawn({ cwd, flavor: FLAVOR, kind: 'claude', model: 'm-x[1m]', effort: 'low' });
    assert.ok(r3.resumeArgv.includes('m-x[1m]') && r3.resumeArgv.includes('low'));
    // 보통 Claude는 그대로
    const r4 = await b.spawn({ cwd });
    b.features.settings.get = () => ({ ...DEFAULTS, claudeModel: 'opus', claudeEffort: 'high' });
    assert.equal(r4.flavor, null);
    const r5 = await b.spawn({ cwd });
    assert.equal(r5.flavor, null); assert.ok(r5.resumeArgv.includes('opus') && r5.resumeArgv.includes('high'));
    assert.ok(!(JSON.parse(fs.readFileSync(r5.settingsPath, 'utf8')).env || {}).ANTHROPIC_BASE_URL, '보통 Claude 세션은 사용자 설정 그대로');
    b.store.close();
  } finally { await ok.close(); }
});

test('P25 spawn: 직접 명령은 새 셸 패널에 그 글을 그대로 치고(덧붙이는 인자 없음) hook 없는 세션이다. 프록시는 보지 않는다', async () => {
  const cmd = 'echo ds-test; claude --model haiku';
  const { b, calls, cwd } = spawnBackend({ healthUrl: await closedUrl(), settings: { deepseekCommand: cmd } });
  const r = await b.spawn({ cwd, kind: FLAVOR });
  assert.equal(r.kind, 'shell'); assert.equal(r.flavor, 'deepseek'); assert.equal(r.command, '[command]');
  assert.ok(!calls.some((c) => c[0] === 'startAgent'), '판이 에이전트를 띄우지 않는다');
  assert.deepEqual(calls.filter((c) => c[0] === 'sendText').map((c) => c[2]), [cmd]);
  assert.deepEqual(calls.filter((c) => c[0] === 'paneKeys').map((c) => c[2]), [['enter']]);
  const s = b.sessions.get(r.sessionId);
  assert.equal(b.hooked(s), false); assert.equal(s.settingsPath, '');
  assert.equal(b.store.spawnInfo(r.sessionId).command, '[command]');
  // 대화상자가 넘긴 명령이 설정보다 먼저, 첫 지시는 받지 않는다, 줄바꿈은 거부
  const r2 = await b.spawn({ cwd, kind: FLAVOR, command: 'pi --x' });
  assert.equal(r2.command, '[command]');
  assert.equal(calls.filter((c) => c[0] === 'sendText').at(-1)[2], 'pi --x');
  await assert.rejects(() => b.spawn({ cwd, kind: FLAVOR, prompt: 'hi' }), (e) => e.key === 'deepseekCommandNoPrompt');
  await assert.rejects(() => b.spawn({ cwd, kind: FLAVOR, command: 'a\nb' }), (e) => e.key === 'deepseekCommandLine');
  // 셸에서 에이전트가 나타나 종류가 바뀌어도 flavor는 남는다(표시는 DeepSeek)
  s.rt = newRuntime({ kind: 'claude', hooked: false }); s.kind = 'claude';
  assert.equal(s.flavor, 'deepseek');
  assert.equal(b.store.getSession(r.sessionId).flavor, 'deepseek');
  b.store.close();
});
