// P41 단위 시험: 말로 한 모델 이름 풀기(정확, 별칭, 느슨한 맞춤, 여럿, 없음), 호출자로 띄울 때의 인자와 env,
// 게이트웨이 모델(그 호출자의 env)과 게이트웨이 확인 실패, 부모의 게이트웨이 물려받기, atrium models, 승인 규칙, 스킬 글, 모델 오류 알아채기
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { Backend } from '../src/backend.mjs';
import { Launchers, initialLaunchers } from '../src/launchers.mjs';
import { DEFAULTS } from '../src/settings.mjs';
import { Branch, BRANCH_ALLOW, boardSkill } from '../src/branch.mjs';
import { buildCatalog, resolveModel, parseGatewayModel, parseOcx, variantsOf, gatewaysOf } from '../src/models.mjs';
import { newRuntime, applyHook, deriveState, isModelError } from '../src/state.mjs';
import { BOARD_SYSTEM_PROMPT } from '../src/launch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p41-'));

// 게이트웨이가 Claude Code에 알려 주는 모양(anthropic-version 머리글의 /v1/models)
const GW_MODELS = [
  { id: 'claude-fable-5-p088', display_name: 'deepseek-flash (deepseek)' },
  { id: 'claude-fable-5-p088[1m]', display_name: 'deepseek-flash (deepseek) · 1M' },
  { id: 'claude-fable-5-p08e', display_name: 'gpt-6.1-sol (native)' },
  { id: 'claude-fable-5-p08e[1m]', display_name: 'gpt-6.1-sol (native) · 1M' },
  { id: 'claude-fable-5-p08e--fast', display_name: 'gpt-6.1-sol (native) · Fast' },
  { id: 'claude-fable-5-p04x', display_name: 'gpt-6-astra (native)' },
  { id: 'claude-fable-5-p09n', display_name: 'deepseek-v4.1-flash (b.ai)' },
  { id: 'claude-fable-5-p03n', display_name: 'glm-5.3-flash (b.ai)' },
  { id: 'claude-opus-5-5', display_name: 'claude-opus-5-5 (anthropic)' },
];
const BASE = 'http://127.0.0.1:10100';
function catalogOf({ ok = true, launchers } = {}) {
  const ls = launchers || initialLaunchers({ gateway: { healthUrl: `${BASE}/healthz` } }).items;
  return buildCatalog({ providers: { codex: { models: [{ id: 'gpt-6-astra', name: 'GPT Astra' }] } }, launchers: ls, gateways: gatewaysOf(ls).map((g) => ({ ...g, ok, models: ok ? GW_MODELS : [], why: ok ? null : 'ECONNREFUSED' })) });
}

test('P41 모양 읽기: 게이트웨이 표시 이름, opencodex 모양 이름, 변형 말', () => {
  assert.deepEqual(parseGatewayModel(GW_MODELS[1]), { id: 'claude-fable-5-p088[1m]', label: 'deepseek-flash (deepseek) · 1M', base: 'deepseek-flash', provider: 'deepseek', variants: ['1m'] });
  assert.deepEqual(parseGatewayModel({ id: 'deepseek/deepseek-flash' }), { id: 'deepseek/deepseek-flash', label: 'deepseek/deepseek-flash', base: 'deepseek-flash', provider: 'deepseek', variants: [] });
  assert.deepEqual(parseOcx('ocx-claude-native--gpt-6.1-sol--fast[1m]'), { provider: 'native', base: 'gpt-6.1-sol', variants: ['1m', 'fast'] });
  assert.equal(parseOcx('claude-opus-5-5'), null);
  assert.deepEqual(variantsOf('gpt 6.1 sol fast 1m'), ['1m', 'fast']);
  assert.deepEqual(variantsOf('deepseek flash'), []);
});

test('P41 이름 풀기: 정확한 ID와 호출자 이름', () => {
  const cat = catalogOf();
  const r = (q, o) => resolveModel(q, cat, o);
  assert.deepEqual([r('haiku').how, r('haiku').entry.source, r('haiku').entry.model], ['exact', 'harness', 'haiku']);
  assert.equal(r('Opus').entry.model, 'opus', '대소문자는 가리지 않는다');
  assert.equal(r('claude-opus-5-5').entry.source, 'harness', 'Anthropic 모델은 게이트웨이를 거치지 않는다');
  assert.deepEqual([r('DeepSeek').how, r('DeepSeek').entry.source, r('DeepSeek').entry.launcher], ['exact', 'launcher', 'DeepSeek']);
  assert.equal(r('codex').entry.launcher, 'Codex');
  // 실제 판에서 실패한 이름: 호출자 DeepSeek의 모델과 같으면 그 호출자(게이트웨이 env)로
  assert.equal(r('ocx-claude-deepseek--deepseek-flash[1m]').entry.launcher, 'DeepSeek');
  assert.deepEqual([r('claude-fable-5-p08e').entry.source, r('claude-fable-5-p08e').entry.gateway], ['gateway', BASE]);
});

test('P41 이름 풀기: 별칭(fable, 게이트웨이 모델 이름, opencodex 모양)', () => {
  const cat = catalogOf();
  const r = (q) => resolveModel(q, cat);
  assert.deepEqual([r('fable').how, r('fable').entry.model], ['alias', 'claude-fable-5-1']);
  assert.deepEqual([r('gpt-6.1-sol').how, r('gpt-6.1-sol').entry.model], ['alias', 'claude-fable-5-p08e'], '변형 없는 줄');
  assert.equal(r('ocx-claude-native--gpt-6.1-sol[1m]').entry.model, 'claude-fable-5-p08e[1m]');
  assert.equal(r('deepseek-flash').entry.launcher, 'DeepSeek', '같은 모델이면 호출자가 먼저');
});

test('P41 이름 풀기: 느슨한 맞춤(대소문자, 띄어쓰기·하이픈, 낱말)', () => {
  const cat = catalogOf();
  const r = (q) => resolveModel(q, cat);
  for (const q of ['deepseek flash', 'DeepSeek Flash', 'deepseek_flash', 'Deepseek-Flash']) {
    const x = r(q);
    assert.equal(x.ok, true, q); assert.equal(x.entry.launcher, 'DeepSeek', q);
  }
  assert.equal(r('deepseek flash').how, 'loose');
  assert.equal(r('gpt 6.1 sol').entry.model, 'claude-fable-5-p08e');
  assert.equal(r('gpt 6.1 sol fast').entry.model, 'claude-fable-5-p08e--fast', '말한 변형');
  assert.equal(r('GPT-6.1-Sol 1M').entry.model, 'claude-fable-5-p08e[1m]');
  assert.equal(r('opus 5.5').entry.model, 'claude-opus-5-5');
  assert.equal(r('glm').entry.model, 'claude-fable-5-p03n');
});

test('P41 이름 풀기: 여럿이면 띄우지 않고 후보와 명령, 없으면 가까운 후보', () => {
  const cat = catalogOf();
  const amb = resolveModel('flash', cat);
  assert.equal(amb.ok, false); assert.equal(amb.code, 'model_ambiguous');
  const targets = amb.candidates.map((e) => e.base);
  assert.ok(targets.includes('deepseek-flash') && targets.includes('glm-5.3-flash') && targets.includes('deepseek-v4.1-flash'), targets.join());
  assert.ok(amb.candidates.every((e) => /^atrium child <이름> --(model|launcher|kind) /.test(e.command)));
  const none = resolveModel('gpt-99', cat);
  assert.equal(none.ok, false); assert.equal(none.code, 'model_unknown');
  assert.ok(none.candidates.length > 0 && none.candidates.every((e) => /gpt/.test(e.base || e.model)), none.candidates.map((e) => e.base).join());
  assert.equal(resolveModel('zzzz-qqqq', cat).candidates.length, 0);
  // 종류를 주면 그 하네스만
  assert.equal(resolveModel('gpt-6-astra', cat, { kind: 'codex' }).entry.harness, 'codex');
  assert.equal(resolveModel('gpt-6.1-sol', cat, { kind: 'codex' }).ok, false);
  // 게이트웨이가 닿지 않으면 그 모델은 목록에 없다(DeepSeek 호출자는 남는다)
  const down = catalogOf({ ok: false });
  assert.equal(resolveModel('gpt-6.1-sol', down).ok, false);
  assert.equal(resolveModel('deepseek flash', down).entry.launcher, 'DeepSeek');
  assert.deepEqual(down.gateways, [{ url: BASE, host: 'DeepSeek', ok: false, why: 'ECONNREFUSED', count: 0 }]);
});

// ---------- 판에서: Backend.spawn(가짜 herdr)과 Branch ----------
function server(handler) {
  const srv = http.createServer(handler);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((c) => srv.close(c)) })));
}
const gatewayServer = () => server((req, res) => {
  if (req.url.startsWith('/healthz')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ status: 'ok' })); }
  if (req.url.startsWith('/v1/models')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: req.headers['anthropic-version'] ? GW_MODELS : [] })); }
  res.statusCode = 404; res.end();
});
async function board({ gatewayUrl }) {
  const dir = tmp();
  const b = new Backend({ quietMs: 600000, port: 0, logDir: dir, sessionsDir: path.join(dir, 'sessions'), claudeJson: path.join(dir, 'none.json'), claudeCommand: 'claude', hookTimeoutSec: 2, ocxHealthUrl: `${gatewayUrl}/healthz`, herdrSession: 'atrium-dev-p41test', profile: 'dev', dataDir: dir });
  b.store = new Store(path.join(dir, 'board.db'));
  b.sessions = new Map(); b.herdrOk = true; b.hookUrl = 'http://127.0.0.1:1/hook'; b.plugin = {}; b.apiToken = 'board-api-token';
  b.agentModels = async ({ kind }) => ({ models: kind === 'codex' ? [{ id: 'gpt-6-astra', name: 'GPT Astra' }] : [] });
  b.store.setMeta('settings', { branchMaxChildren: 16 });
  b.features = { settings: { get: () => ({ ...DEFAULTS }) }, launchers: null };
  b.features.launchers = new Launchers({ store: b.store, gateway: { healthUrl: `${gatewayUrl}/healthz` } });
  b.queue = { enqueue: () => ({ deliveryId: 'd1', status: 'queued' }), pending: () => 0 };
  b.api = { broadcast() {} };
  b.broadcastSession = () => {}; b.broadcastWorkspaces = () => {}; b.probeGit = () => {}; b.registerResume = () => {};
  b.ensureLink = (from, to, patch) => ({ linkId: 'l1', from, to, ...patch }); b.linkEvent = () => ({});
  b.summary = (s) => ({ state: deriveState(s.rt).state, ask: null, error: deriveState(s.rt).error || s.rt.lastError || null });
  b.branch = new Branch(b, { readyWaitMs: 30, submitWaitMs: 10 });
  const calls = []; let n = 0;
  b.adapter = {
    connected: true,
    agentKinds: async () => [{ kind: 'claude', installed: true }, { kind: 'codex', installed: true }],
    createWorkspace: async (o) => { calls.push(['createWorkspace', o]); n++; return { paneId: `w${n}:p1`, workspaceId: `w${n}` }; },
    refreshSubscription: async () => {}, waitShellReady: async () => true,
    startAgent: async (o) => { calls.push(['startAgent', o]); return { agent: null, argv: [o.kind, ...o.args] }; },
    sendText: async () => {}, paneKeys: async () => {},
  };
  b.requireHerdr = () => {};
  // 판이 띄운 부모 세션(haiku, 노력 low, acceptEdits)
  const lead = await b.spawn({ cwd: dir, name: 'lead', kind: 'claude', model: 'haiku', effort: 'low', permissionMode: 'acceptEdits' });
  const startOf = (name) => calls.filter((c) => c[0] === 'startAgent' && c[1].name === name).at(-1)[1].args;
  const arg = (args, k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const settingsOf = (r) => JSON.parse(fs.readFileSync(b.sessions.get(r.sessionId).settingsPath, 'utf8'));
  return { b, dir, lead: b.sessions.get(lead.sessionId), calls, startOf, arg, settingsOf };
}

test('P41 atrium child --launcher: 호출자의 하네스·모델·옵션·게이트웨이 env를 그대로 쓴다(레일과 같다)', async () => {
  const gw = await gatewayServer();
  try {
    const { b, lead, startOf, arg, settingsOf } = await board({ gatewayUrl: gw.url });
    const r = await b.branch.spawnChild(lead, { name: 'ds1', launcher: 'DeepSeek', wait: false });
    const a = startOf('ds1');
    assert.equal(arg(a, '--model'), 'ocx-claude-deepseek--deepseek-flash[1m]');
    assert.equal(arg(a, '--permission-mode'), 'manual', '권한 모드는 호출자의 것');
    assert.equal(arg(a, '--effort'), null, '호출자에 노력 수준이 없으면 넣지 않는다');
    const env = settingsOf(r).env;
    assert.equal(env.ANTHROPIC_BASE_URL, gw.url); assert.equal(env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
    assert.equal(env.ATRIUM_SESSION_ID, r.sessionId, '판의 env도 함께');
    assert.equal(r.launcher, 'DeepSeek'); assert.equal(r.gateway, gw.url);
    assert.equal(b.sessions.get(r.sessionId).flavor, 'deepseek');
    assert.equal(b.store.spawnInfo(r.sessionId).launcher, 'DeepSeek');
    assert.equal(b.sessions.get(r.sessionId).parentSessionId, lead.sessionId);
    // --effort는 덮는다. 없는 호출자, 셸 호출자, --model과 함께는 거부
    await b.branch.spawnChild(lead, { name: 'ds2', launcher: 'deepseek', effort: 'high', wait: false });
    assert.equal(arg(startOf('ds2'), '--effort'), 'high');
    await assert.rejects(b.branch.spawnChild(lead, { name: 'x1', launcher: 'nope', wait: false }), (e) => e.code === 'no_launcher' && /atrium models/.test(e.message));
    await assert.rejects(b.branch.spawnChild(lead, { name: 'x1', launcher: 'shell', wait: false }), /에이전트를 띄우는 호출자/);
    await assert.rejects(b.branch.spawnChild(lead, { name: 'x1', launcher: 'DeepSeek', model: 'opus', wait: false }), /함께 주지 않는다/);
    // codex 호출자: 하네스 codex, -m 모델
    b.features.launchers.update({ id: 'codex', patch: { model: 'gpt-6-astra' } });
    const cx = await b.branch.spawnChild(lead, { name: 'cx1', launcher: 'Codex', wait: false });
    assert.equal(cx.kind, 'codex'); assert.deepEqual(startOf('cx1'), ['--model', 'gpt-6-astra']);
    b.store.close();
  } finally { await gw.close(); }
});

test('P41 atrium child --model <말>: 풀어서 띄우고 무엇으로 풀었는지 돌려준다. 게이트웨이 모델은 그 호출자의 env로', async () => {
  const gw = await gatewayServer();
  try {
    const { b, lead, calls, startOf, arg, settingsOf } = await board({ gatewayUrl: gw.url });
    // "deepseek flash" → 호출자 DeepSeek(게이트웨이 env)
    const ds = await b.branch.spawnChild(lead, { name: 'ds1', model: 'deepseek flash', wait: false });
    assert.equal(ds.resolved.how, 'loose'); assert.equal(ds.resolved.source, 'launcher'); assert.equal(ds.resolved.launcher, 'DeepSeek');
    assert.match(ds.resolved.to, /호출자 DeepSeek/);
    assert.equal(settingsOf(ds).env.ANTHROPIC_BASE_URL, gw.url);
    // "haiku" → 하네스 모델(게이트웨이 env 없음), 부모의 노력 수준·권한 모드
    const hk = await b.branch.spawnChild(lead, { name: 'hk1', model: 'haiku', wait: false });
    assert.equal(hk.resolved.how, 'exact');
    assert.equal(arg(startOf('hk1'), '--model'), 'haiku'); assert.equal(arg(startOf('hk1'), '--effort'), 'low'); assert.equal(arg(startOf('hk1'), '--permission-mode'), 'acceptEdits');
    assert.equal(settingsOf(hk).env.ANTHROPIC_BASE_URL, undefined);
    // "gpt-6.1-sol" → 게이트웨이 모델: 그 게이트웨이 호출자의 env, 로고는 DeepSeek가 아니다, 권한 모드는 부모의 것
    const gp = await b.branch.spawnChild(lead, { name: 'gpt', model: 'gpt-6.1-sol', wait: false });
    assert.equal(gp.resolved.source, 'gateway'); assert.equal(gp.model, 'claude-fable-5-p08e');
    const ga = startOf('gpt');
    assert.equal(arg(ga, '--model'), 'claude-fable-5-p08e'); assert.equal(arg(ga, '--permission-mode'), 'acceptEdits'); assert.equal(arg(ga, '--effort'), 'low');
    assert.deepEqual([settingsOf(gp).env.ANTHROPIC_BASE_URL, settingsOf(gp).env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY], [gw.url, '1']);
    assert.equal(b.sessions.get(gp.sessionId).flavor, null);
    // 게이트웨이의 DeepSeek 모델은 DeepSeek 로고로 보인다
    const dg = await b.branch.spawnChild(lead, { name: 'dsg', model: 'claude-fable-5-p088', wait: false });
    assert.equal(dg.resolved.source, 'gateway'); assert.equal(b.sessions.get(dg.sessionId).flavor, 'deepseek');
    assert.ok(b.store.events({ sessionId: lead.sessionId }).some((e) => e.kind === 'branch_child' && e.data.child === 'gpt' && e.data.resolved.source === 'gateway'));
    // 여럿·없음: 띄우지 않고 후보와 atrium models
    const n0 = calls.length;
    await assert.rejects(b.branch.spawnChild(lead, { name: 'f1', model: 'flash', wait: false }), (e) => e.code === 'model_ambiguous' && /--model claude-fable-5-p03n/.test(e.message) && e.candidates.length >= 3);
    await assert.rejects(b.branch.spawnChild(lead, { name: 'g9', model: 'gpt-99', wait: false }), (e) => e.code === 'model_unknown' && /가까운 것/.test(e.message) && /atrium models/.test(e.message));
    assert.equal(calls.length, n0, '패널을 만들지 않았다');
    b.store.close();
  } finally { await gw.close(); }
});

test('P41 게이트웨이가 닿지 않으면: 게이트웨이 모델은 목록에 없다고 까닭과 함께, 게이트웨이 호출자는 패널 전에 gateway_down', async () => {
  const gw = await gatewayServer();
  const down = gw.url; await gw.close(); // 닫힌 주소
  const { b, lead, calls } = await board({ gatewayUrl: down });
  const n0 = calls.length;
  await assert.rejects(b.branch.spawnChild(lead, { name: 'gpt', model: 'gpt-6.1-sol', wait: false }), (e) => e.code === 'model_unknown' && /게이트웨이가 닿지 않아/.test(e.message) && e.message.includes(down));
  await assert.rejects(b.branch.spawnChild(lead, { name: 'ds1', model: 'deepseek flash', wait: false }), (e) => ['deepseek_proxy_down', 'gateway_down'].includes(e.code) && e.message.includes(down));
  await assert.rejects(b.branch.spawnChild(lead, { name: 'ds2', launcher: 'DeepSeek', wait: false }), (e) => ['deepseek_proxy_down', 'gateway_down'].includes(e.code));
  assert.equal(calls.length, n0, '패널을 만들지 않았다');
  const m = await b.branch.listModels(lead);
  assert.deepEqual(m.gateways.map((g) => [g.ok, g.host]), [[false, 'DeepSeek']]);
  b.store.close();
});

test('P41 물려받기: 게이트웨이 세션의 하위 세션은 --model 없이도 그 게이트웨이 env와 모델로 뜬다', async () => {
  const gw = await gatewayServer();
  try {
    const { b, lead, startOf, arg, settingsOf } = await board({ gatewayUrl: gw.url });
    const ds = await b.branch.spawnChild(lead, { name: 'ds1', model: 'deepseek flash', wait: false });
    const dsS = b.sessions.get(ds.sessionId);
    const kid = await b.branch.spawnChild(dsS, { name: 'ds1-w1', wait: false });
    assert.equal(kid.inheritedGateway, gw.url);
    assert.equal(arg(startOf('ds1-w1'), '--model'), 'ocx-claude-deepseek--deepseek-flash[1m]');
    assert.equal(settingsOf(kid).env.ANTHROPIC_BASE_URL, gw.url);
    // 게이트웨이 아닌 부모는 지금처럼(env 없음)
    const plain = await b.branch.spawnChild(lead, { name: 'p1', wait: false });
    assert.equal(plain.inheritedGateway, null); assert.equal(settingsOf(plain).env.ANTHROPIC_BASE_URL, undefined);
    b.store.close();
  } finally { await gw.close(); }
});

test('P41 atrium models: 호출자, 하네스 모델·별칭, 게이트웨이 모델과 각 줄의 정확한 명령(CLI)', async () => {
  const gw = await gatewayServer();
  const srv = { s: null };
  try {
    const { b, lead } = await board({ gatewayUrl: gw.url });
    const m = await b.branch.listModels(lead);
    const find = (f) => m.entries.find(f);
    assert.equal(find((e) => e.launcher === 'DeepSeek').command, 'atrium child <이름> --launcher DeepSeek');
    assert.equal(find((e) => e.launcher === 'Claude Code').command, 'atrium child <이름> --launcher claude', '빈칸 든 이름은 ID');
    assert.equal(find((e) => e.launcher === 'DeepSeek').gateway, gw.url);
    assert.equal(find((e) => e.source === 'harness' && e.model === 'claude-fable-5-1').aliases[0], 'fable');
    assert.equal(find((e) => e.source === 'harness' && e.harness === 'codex').command, 'atrium child <이름> --kind codex --model gpt-6-astra');
    assert.equal(find((e) => e.model === 'claude-fable-5-p088[1m]').command, "atrium child <이름> --model 'claude-fable-5-p088[1m]'", '[ ]는 따옴표로');
    assert.ok(!m.entries.some((e) => e.source === 'gateway' && /anthropic/.test(e.label)), 'Anthropic 모델은 하네스 줄로만');
    assert.ok(!m.entries.some((e) => e.launcher === 'Shell'), '셸은 하위 세션이 아니다');
    // CLI 출력
    srv.s = http.createServer((req, res) => { if (!b.branch.handleHttp(req, res)) { res.writeHead(404); res.end(); } });
    await new Promise((r) => srv.s.listen(0, '127.0.0.1', r));
    b.cfg.port = srv.s.address().port;
    b.hooked = (s) => s.kind === 'claude' && s.origin === 'board';
    const env = b.branch.envFor(lead.sessionId);
    const out = await runChild(['models'], env);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /호출자 DeepSeek .*게이트웨이 경유/); assert.match(out.stdout, /atrium child <이름> --model haiku/);
    assert.match(out.stdout, /게이트웨이 http:\/\/127\.0\.0\.1:\d+\(호출자 DeepSeek의 env로 띄운다\)의 모델 \d+개/);
    const bad = await runChild(['child', 'x9', '--model', 'gpt-99', '--no-wait'], env);
    assert.notEqual(bad.code, 0); assert.match(bad.stderr, /model_unknown/); assert.match(bad.stderr, /atrium models/);
    const words = await runChild(['child', 'x9', '--model', 'deepseek', 'flash'], env);
    assert.equal(words.code, 2); assert.match(words.stderr, /따옴표로 묶는다/);
    const missing = await runChild(['child', 'x9', '--launcher', '--no-wait'], env);
    assert.equal(missing.code, 2); assert.match(missing.stderr, /값이 필요하다/);
    const typo = await runChild(['child', 'x9', '--launchre', 'DeepSeek'], env);
    assert.equal(typo.code, 2); assert.match(typo.stderr, /모르는 옵션/);
    const ok = await runChild(['child', 'ds9', '--model', 'deepseek flash', '--no-wait'], env);
    assert.equal(ok.code, 0, ok.stderr); assert.match(ok.stdout, /모델 "deepseek flash" → 호출자 DeepSeek/);
    const named = await runChild(['child', 'effort-worker', '--launcher=Claude Code', '--effort=high', '--no-wait', '--json'], env);
    assert.equal(named.code, 0, named.stderr); assert.equal(JSON.parse(named.stdout).effort, 'high');
    b.store.close();
  } finally { if (srv.s) srv.s.close(); await gw.close(); }
});
function runChild(args, env) {
  return new Promise((resolve) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('MTASK_') && !k.startsWith('ATRIUM_')));
    execFile(process.execPath, [path.join(HERE, '..', 'bin', 'atrium-child.mjs'), ...args], { env: { ...clean, ...env }, timeout: 20000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

function allowed(rules, tool, cmd) {
  return rules.some((r) => {
    const m = /^(\w+)\((.*)\)$/.exec(r); if (!m || m[1] !== tool) return false;
    const p = m[2];
    if (p.endsWith(':*')) return cmd === p.slice(0, -2) || cmd.startsWith(p.slice(0, -2) + ' ');
    if (p.endsWith(' *')) return cmd.startsWith(p.slice(0, -1));
    return cmd === p;
  });
}
test('P41 승인 규칙: atrium models는 묻지 않는다(옛 이름 mtask도)', () => {
  for (const c of ['atrium models', 'atrium models --json', 'mtask models']) assert.ok(allowed(BRANCH_ALLOW, 'Bash', c), c);
  assert.ok(allowed(BRANCH_ALLOW, 'PowerShell', 'atrium models'));
  assert.ok(allowed(BRANCH_ALLOW, 'Bash', 'atrium child ds1 --model "deepseek flash"'));
  assert.ok(!allowed(BRANCH_ALLOW, 'Bash', 'atrium launchers'), '판 CLI의 다른 명령은 그대로 묻는다');
});

test('P41 스킬 글과 짧은 안내: 말로 한 모델은 atrium models로 골라 띄우고, ID를 묻지 않고, 내부 하위 에이전트로 우회하지 않는다', () => {
  const s = boardSkill();
  assert.match(s, /`atrium models`로 목록을 보고 가장 맞는 줄의 명령으로 띄운다/);
  assert.match(s, /정확한 ID를 사용자에게 묻지 않고, 판이 후보 여럿을 돌려줄 때만 묻는다/);
  assert.match(s, /내부 하위 에이전트로 우회하지 않는다/);
  assert.match(s, /모델 오류로 답하지 못하면/);
  assert.ok(Buffer.byteLength(s) < 7000, `스킬 글 ${Buffer.byteLength(s)}바이트`);
  assert.match(BOARD_SYSTEM_PROMPT, /`atrium models`에서 골라 띄운다/);
});

// P55: 같은 밀리초에 끝난 두 모델 오류도 둘 다 알린다(시각이 아니라 오류마다). 시계를 멈춰 같은 밀리초를 늘 만든다
test('P41 모델 오류: 같은 밀리초에 연달아 난 두 오류도 각각 판 이벤트로 남고, 같은 오류는 한 번', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const added = [];
  const b = { store: { branchRows: () => [], addEvent: (sid, kind, data) => added.push([sid, kind, data]) }, bus: { on() {} }, log() {} };
  const br = new Branch(b);
  const rt = newRuntime({ kind: 'claude', hooked: true });
  rt.herdr.status = 'idle'; rt.herdr.present = true; rt.phase = 'running';
  const s = { sessionId: 'k1', name: 'w1', model: 'haiku', rt };
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: '1+1' });
  applyHook(rt, { hook_event_name: 'StopFailure', error: 'model_not_found', message: 'first' });
  br.noteModelError(s); br.noteModelError(s);
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: '2+2' });
  applyHook(rt, { hook_event_name: 'StopFailure', error: 'model_not_found', message: 'second' });
  assert.equal(rt.lastError.at, 1_000_000);
  br.noteModelError(s); br.noteModelError(s);
  assert.deepEqual(added.filter((e) => e[1] === 'model_error').map((e) => e[2].message), ['first', 'second']);
});

test('P41 모델 오류: StopFailure model_not_found나 Claude Code의 오류 글로 끝난 턴은 error, 인용한 답은 아니다. 판 이벤트와 atrium children', async () => {
  const rt = newRuntime({ kind: 'claude', hooked: true });
  rt.herdr.status = 'idle'; rt.herdr.present = true; rt.phase = 'running';
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: '1+1' });
  applyHook(rt, { hook_event_name: 'Stop', last_assistant_message: "There's an issue with the selected model (deepseek-flash). It may not exist or you may not have access to it. Run /model to pick a different model." });
  assert.equal(deriveState(rt).state, 'error'); assert.equal(deriveState(rt).error.type, 'model_not_found');
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: 'why' });
  applyHook(rt, { hook_event_name: 'Stop', last_assistant_message: "@ds1 failed with: There's an issue with the selected model (x)." });
  assert.equal(deriveState(rt).state, 'ready', '오류 글을 인용한 답은 오류가 아니다');
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: 'again' });
  applyHook(rt, { hook_event_name: 'StopFailure', error: 'model_not_found', message: 'model: nope' });
  assert.equal(deriveState(rt).state, 'error');
  assert.ok(isModelError({ type: 'model_not_found' })); assert.ok(!isModelError({ type: 'rate_limit', message: 'slow down' }));

  const gw = await gatewayServer();
  try {
    const { b, lead } = await board({ gatewayUrl: gw.url });
    const k = await b.branch.spawnChild(lead, { name: 'w1', model: 'haiku', wait: false });
    const ks = b.sessions.get(k.sessionId);
    ks.rt.herdr.status = 'idle'; ks.rt.herdr.present = true; ks.rt.phase = 'running';
    applyHook(ks.rt, { hook_event_name: 'UserPromptSubmit', prompt: '1+1' });
    applyHook(ks.rt, { hook_event_name: 'StopFailure', error: 'model_not_found', message: "There's an issue with the selected model (haiku)." });
    b.bus.emit('session', ks, b.summary(ks)); b.bus.emit('session', ks, b.summary(ks));
    assert.equal(b.store.events({ sessionId: k.sessionId }).filter((e) => e.kind === 'model_error').length, 1, '같은 오류는 한 번');
    const pe = b.store.events({ sessionId: lead.sessionId }).filter((e) => e.kind === 'branch_child_error');
    assert.equal(pe.length, 1); assert.equal(pe[0].data.child, 'w1'); assert.equal(pe[0].data.type, 'model_not_found');
    const v = b.branch.listChildren(lead).children.find((c) => c.name === 'w1');
    assert.equal(v.state, 'error'); assert.equal(v.error.type, 'model_not_found'); assert.equal(v.model, 'haiku');
    // 실제 Claude Code의 StopFailure는 글 없이 온다: 판이 모델 이름으로 까닭을 채운다
    applyHook(ks.rt, { hook_event_name: 'UserPromptSubmit', prompt: '2+2' });
    applyHook(ks.rt, { hook_event_name: 'StopFailure', error: 'model_not_found' });
    b.bus.emit('session', ks, b.summary(ks));
    assert.match(b.branch.listChildren(lead).children.find((c) => c.name === 'w1').error.message, /쓰지 못한 모델: haiku/);
    assert.match(b.store.events({ sessionId: lead.sessionId }).filter((e) => e.kind === 'branch_child_error').at(-1).data.message, /쓰지 못한 모델: haiku/);
    b.store.close();
  } finally { await gw.close(); }
});
