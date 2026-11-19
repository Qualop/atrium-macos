// P115 3단계: 모델 연결(연결 목록, 프로토콜 맞춤, 하네스 어댑터의 연결, 시작 전 확인, 모델 목록, 옮기기)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Store } from '../src/store.mjs';
import { Backend } from '../src/backend.mjs';
import { Launchers, LEGACY_META_KEY, META_KEY } from '../src/launchers.mjs';
import { Connections, normalizeConnection, connectionId, fetchConnectionModels, modelsUrlOf, authHeaders } from '../src/connections.mjs';
import { harnessLaunch, claudeConnection, providerIdOf, piExtensionText, protocolsOf } from '../src/harness.mjs';
import { migrateLaunchers, legacyGatewayConnection } from '../src/launcher-migrate.mjs';
import { DEFAULTS } from '../src/settings.mjs';
import { Branch } from '../src/branch.mjs';
import { deriveState } from '../src/state.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p115c-'));
const SID = '3f6c2a10-5b7e-4d21-9c8a-1e2f3a4b5c6d';
const C = (o = {}) => normalizeConnection({ name: 'gw', protocol: 'openai-responses', baseUrl: 'http://127.0.0.1:9/v1', auth: { env: 'GW_KEY' }, ...o });

test('P115 연결: 프로토콜·주소·인증(환경 변수 이름만)·이름 검사. ID는 프로토콜과 주소에서(같으면 같다)', () => {
  const c = C();
  assert.deepEqual(c, { id: connectionId('openai-responses', 'http://127.0.0.1:9/v1'), name: 'gw', protocol: 'openai-responses', baseUrl: 'http://127.0.0.1:9/v1', auth: { env: 'GW_KEY', scheme: 'bearer' }, healthUrl: '', modelsUrl: '' });
  assert.equal(C({ baseUrl: 'http://127.0.0.1:9/v1/' }).id, c.id, '끝 슬래시는 같은 주소');
  assert.equal(normalizeConnection({ protocol: 'anthropic-messages', baseUrl: 'http://h:1' }).auth.scheme, 'x-api-key');
  assert.equal(normalizeConnection({ protocol: 'anthropic-messages', baseUrl: 'http://h:1' }).name, 'h:1', '이름 기본값은 호스트');
  for (const [bad, key] of [[{ protocol: 'grpc' }, 'protocol'], [{ baseUrl: 'file:///x' }, 'url'], [{ baseUrl: '' }, 'urlEmpty'], [{ auth: { env: '1BAD' } }, 'authEnv'], [{ auth: { env: 'K', scheme: 'basic' } }, 'authScheme'], [{ name: 'a"b' }, 'name'], [{ healthUrl: 'nope' }, 'url']]) assert.throws(() => C(bad), (e) => e.key === `connections.err.${key}`, key);
  assert.equal(modelsUrlOf(C()), 'http://127.0.0.1:9/v1/models');
  assert.equal(modelsUrlOf(normalizeConnection({ protocol: 'anthropic-messages', baseUrl: 'http://h:1' })), 'http://h:1/v1/models');
  assert.deepEqual(authHeaders(C(), { GW_KEY: 'v' }), { authorization: 'Bearer v' });
  assert.deepEqual(authHeaders(normalizeConnection({ protocol: 'anthropic-messages', baseUrl: 'http://h:1', auth: { env: 'K' } }), { K: 'v' }), { 'anthropic-version': '2023-06-01', 'x-api-key': 'v' });
  assert.deepEqual(authHeaders(C(), {}), {}, '값이 없으면 머리글도 없다');
});

test('P115 연결 목록: 만들기·고치기(ID 유지)·같은 주소 거부·쓰는 런처가 있으면 지우지 않는다. 런처는 그 하네스의 프로토콜인 연결만 저장한다', () => {
  const dir = tmp();
  const store = new Store(path.join(dir, 'board.db'));
  try {
    const conns = new Connections({ store, inUse: (id) => ls.usersOf(id) });
    const ls = new Launchers({ store, connections: conns });
    const a = conns.create({ name: 'anth', protocol: 'anthropic-messages', baseUrl: 'http://127.0.0.1:1' }).connection;
    const o = conns.create({ name: 'oai', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:2/v1' }).connection;
    assert.throws(() => conns.create({ name: 'again', protocol: 'anthropic-messages', baseUrl: 'http://127.0.0.1:1/' }), (e) => e.key === 'connections.err.exists');
    assert.throws(() => conns.create({ name: 'ANTH', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:3/v1' }), (e) => e.key === 'connections.err.nameTaken');
    // 프로토콜 맞춤: Claude Code는 anthropic, Codex는 openai-responses, opencode·pi는 셋
    assert.deepEqual(protocolsOf('claude'), ['anthropic-messages']); assert.deepEqual(protocolsOf('codex'), ['openai-responses']);
    assert.equal(protocolsOf('pi').length, 3); assert.equal(protocolsOf('grok').length, 0);
    assert.throws(() => ls.create({ name: 'cx', harness: 'codex', connection: a.id }), (e) => e.key === 'launchers.err.connectionProtocol');
    assert.throws(() => ls.create({ name: 'cl', harness: 'claude', connection: o.id }), (e) => e.key === 'launchers.err.connectionProtocol');
    assert.throws(() => ls.create({ name: 'cl', harness: 'claude', connection: 'cnone' }), (e) => e.key === 'launchers.err.connectionMissing');
    const pi = ls.create({ name: 'pi gw', harness: 'pi', connection: o.id, model: 'm1' }).launcher;
    const cl = ls.create({ name: 'cl gw', harness: 'claude', connection: a.id }).launcher;
    assert.equal(pi.connection, o.id); assert.equal(cl.connection, a.id);
    assert.ok(ls.list().harnesses.find((h) => h.id === 'codex').protocols.includes('openai-responses'), '창이 흐리게 할 것');
    assert.throws(() => conns.delete({ id: o.id }), (e) => e.code === 'connection_in_use' && /pi gw/.test(e.message));
    const up = conns.update({ id: o.id, patch: { baseUrl: 'http://127.0.0.1:4/v1' } }).connection;
    assert.equal(up.id, o.id, '주소를 바꿔도 ID는 그대로(런처 참조)');
    assert.deepEqual(conns.list().connections.find((c) => c.id === o.id).usedBy, ['pi gw']);
    ls.delete({ id: pi.id });
    conns.delete({ id: o.id });
    assert.equal(conns.find(o.id), null);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('P115 어댑터의 연결: codex는 세션 단위 -c 제공자(env_key), opencode는 providers(package·baseURL·env·models)와 model, pi는 확장 파일(-e)과 --model, Claude Code는 설정 파일 env와 apiKeyHelper', () => {
  const co = C({ name: 'my gw' });
  const cx = harnessLaunch({ kind: 'codex', sessionId: SID, model: 'm1', connection: co });
  const pid = providerIdOf(co);
  assert.deepEqual(cx.args.slice(0, 12), ['-c', 'check_for_update_on_startup=false', '-c', `model_provider=${pid}`, '-c', `model_providers.${pid}.name=my gw`, '-c', `model_providers.${pid}.base_url=http://127.0.0.1:9/v1`, '-c', `model_providers.${pid}.wire_api=responses`, '-c', `model_providers.${pid}.env_key=GW_KEY`]);
  assert.equal(cx.args[cx.args.indexOf('-m') + 1], 'm1');
  const r = harnessLaunch({ kind: 'codex', sessionId: SID, resume: true, harnessSessionId: 'x', connection: co });
  assert.ok(r.args.includes(`model_provider=${pid}`), '이어 갈 때도 같은 연결(빠지면 Codex가 막힌다)');
  const ca = normalizeConnection({ name: 'a', protocol: 'anthropic-messages', baseUrl: 'http://127.0.0.1:8', auth: { env: 'AK' } });
  const oc = harnessLaunch({ kind: 'opencode', sessionId: SID, model: 'm2', connection: ca, connectionModels: ['m1'], instructions: { file: 'F', text: 'T' } });
  const cfg = JSON.parse(oc.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(cfg.providers[providerIdOf(ca)], { name: 'a', package: '@ai-sdk/anthropic', settings: { baseURL: 'http://127.0.0.1:8/v1' }, env: ['AK'], models: { m1: { name: 'm1' }, m2: { name: 'm2' } } });
  assert.equal(cfg.model, `${providerIdOf(ca)}/m2`); assert.deepEqual(cfg.instructions, ['F']);
  assert.equal(JSON.parse(harnessLaunch({ kind: 'opencode', sessionId: SID, connection: C({ protocol: 'openai-chat' }), connectionModels: ['z'] }).env.OPENCODE_CONFIG_CONTENT).providers[providerIdOf(C({ protocol: 'openai-chat' }))].package, '@ai-sdk/openai-compatible');
  const dir = tmp();
  const pi = harnessLaunch({ kind: 'pi', sessionId: SID, model: 'm3', connection: ca, filesDir: dir });
  const ext = pi.args[pi.args.indexOf('-e') + 1];
  assert.equal(path.resolve(ext), path.resolve(dir, `pi-${ca.id}.mjs`)); assert.equal(pi.args[pi.args.indexOf('--model') + 1], `${providerIdOf(ca)}/m3`);
  assert.match(pi.files[0].text, /"apiKey": "\$AK"/); assert.match(pi.files[0].text, /"api": "anthropic-messages"/); assert.match(pi.files[0].text, /registerProvider\("atrium_/);
  assert.match(piExtensionText(normalizeConnection({ protocol: 'openai-chat', baseUrl: 'http://h/v1' }), ['x']), /"api": "openai-completions"[^]*"apiKey": "atrium-no-key"|"apiKey": "atrium-no-key"[^]*"api": "openai-completions"/);
  // 연결이 있는 pi는 확장 파일 자리가 없으면 띄우지 않는다(다른 제공자로 새지 않게)
  assert.throws(() => harnessLaunch({ kind: 'pi', sessionId: SID, connection: ca }), (e) => e.code === 'pi_extension_missing');
  // 맞지 않는 프로토콜은 띄우지 않는다
  assert.throws(() => harnessLaunch({ kind: 'codex', sessionId: SID, connection: ca }), (e) => e.code === 'connection_protocol');
  const cc = claudeConnection(ca, { node: 'C:\\n\\node.exe' });
  assert.deepEqual(cc.env, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8' });
  assert.equal(cc.settings.apiKeyHelper, `"C:/n/node.exe" -e "process.stdout.write(process.env.AK||'')"`, '키 값이 아니라 env 이름');
  assert.deepEqual(claudeConnection(normalizeConnection({ protocol: 'anthropic-messages', baseUrl: 'http://h:1' })).settings, {}, '인증 없는 연결(구독 그대로)');
  fs.rmSync(dir, { recursive: true, force: true });
});

function server(handler) {
  const srv = http.createServer(handler);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ port: srv.address().port, close: () => new Promise((c) => srv.close(c)) })));
}
test('P115 모델 목록: 프로토콜별(Anthropic식 /v1/models와 anthropic-version·x-api-key, OpenAI식 /models와 Bearer). 키 값은 판 env에서', async () => {
  const seen = [];
  const s = await server((req, res) => { seen.push({ url: req.url, v: req.headers['anthropic-version'] || null, k: req.headers['x-api-key'] || null, a: req.headers.authorization || null }); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.headers['anthropic-version'] ? { data: [{ id: 'a1', display_name: 'A one' }] } : { object: 'list', data: [{ id: 'o1', owned_by: 'x' }] })); });
  try {
    const a = await fetchConnectionModels(normalizeConnection({ protocol: 'anthropic-messages', baseUrl: `http://127.0.0.1:${s.port}`, auth: { env: 'AK' } }), { env: { AK: 'kv' } });
    assert.deepEqual(a, { ok: true, models: [{ id: 'a1', display_name: 'A one', owned_by: null }] });
    const o = await fetchConnectionModels(normalizeConnection({ protocol: 'openai-chat', baseUrl: `http://127.0.0.1:${s.port}/v1`, auth: { env: 'OK' } }), { env: { OK: 'ov' } });
    assert.deepEqual(o.models.map((m) => m.id), ['o1']);
    assert.deepEqual(seen, [{ url: '/v1/models?limit=1000', v: '2023-06-01', k: 'kv', a: null }, { url: '/v1/models', v: null, k: null, a: 'Bearer ov' }]);
    const down = await fetchConnectionModels(normalizeConnection({ protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:9/v1' }), { timeoutMs: 500 });
    assert.equal(down.ok, false);
  } finally { await s.close(); }
});

// ---------- 판: 시작 전 확인, 연결로 띄우기, atrium models ----------
async function board(gwPort) {
  const dir = tmp();
  const b = new Backend({ quietMs: 600000, port: 0, logDir: dir, sessionsDir: path.join(dir, 'sessions'), claudeJson: path.join(dir, 'none.json'), claudeCommand: 'claude', hookTimeoutSec: 2, terminalSession: 'atrium-dev-p115test', profile: 'dev', dataDir: dir });
  b.store = new Store(path.join(dir, 'board.db'));
  b.sessions = new Map(); b.termOk = true; b.hookUrl = 'http://127.0.0.1:1/hook'; b.plugin = {}; b.apiToken = 'board-api-token';
  b.features = { settings: { get: () => ({ ...DEFAULTS }) }, launchers: null, connections: null };
  b.features.connections = new Connections({ store: b.store, inUse: (id) => b.features.launchers.usersOf(id) });
  b.features.launchers = new Launchers({ store: b.store, connections: b.features.connections });
  b.queue = { enqueue: () => ({ deliveryId: 'd1', status: 'queued' }), pending: () => 0 };
  b.api = { broadcast() {} };
  b.broadcastSession = () => {}; b.broadcastWorkspaces = () => {}; b.probeGit = () => {};
  b.ensureLink = (from, to, patch) => ({ linkId: 'l1', from, to, ...patch }); b.linkEvent = () => ({});
  b.summary = (s) => ({ state: deriveState(s.rt).state, ask: null, error: null });
  b.branch = new Branch(b, { readyWaitMs: 30, submitWaitMs: 10 });
  b.harnessFiles = { promptFile: path.join(dir, 'h.md'), binDir: path.join(dir, 'bin') };
  const calls = []; let n = 0;
  b.adapter = {
    connected: true,
    agentKinds: async () => ['claude', 'codex', 'opencode', 'pi'].map((kind) => ({ kind, installed: true })),
    createWorkspace: async () => { n++; return { paneId: `w${n}:p1`, workspaceId: `w${n}` }; },
    refreshSubscription: async () => {}, waitShellReady: async () => true,
    startAgent: async (o) => { calls.push(o); return { agent: null, argv: [...(o.command || [o.kind]), ...o.args] }; },
    sendText: async () => {}, paneKeys: async () => {},
  };
  b.requireTerminal = () => {};
  const C = b.features.connections;
  const oai = C.create({ name: 'fake oai', protocol: 'openai-responses', baseUrl: `http://127.0.0.1:${gwPort}/v1`, auth: { env: 'P115_FAKE_KEY' } }).connection;
  const chat = C.create({ name: 'fake chat', protocol: 'openai-chat', baseUrl: `http://127.0.0.1:${gwPort}/v1` }).connection;
  const anth = C.create({ name: 'fake anth', protocol: 'anthropic-messages', baseUrl: `http://127.0.0.1:${gwPort}`, healthUrl: `http://127.0.0.1:${gwPort}/health` }).connection;
  const L = b.features.launchers;
  L.create({ name: 'cx-fake', harness: 'codex', connection: oai.id, model: 'm1' });
  L.create({ name: 'oc-fake', harness: 'opencode', connection: chat.id, model: 'm1' });
  L.create({ name: 'pi-fake', harness: 'pi', connection: chat.id, model: 'm1' });
  L.create({ name: 'cl-fake', harness: 'claude', connection: anth.id, model: 'm1' });
  const lead = await b.spawn({ cwd: dir, name: 'lead', kind: 'claude', model: 'haiku', permissionMode: 'manual' });
  return { b, dir, calls, conns: { oai, chat, anth }, lead: b.sessions.get(lead.sessionId), startOf: (name) => calls.filter((c) => c.name === name).at(-1) };
}
const fakeGw = () => server((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url.startsWith('/health')) return res.end(JSON.stringify({ status: 'ok' }));
  if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify(req.headers['anthropic-version'] ? { data: [{ id: 'm1' }, { id: 'claude-m2' }] } : { object: 'list', data: [{ id: 'm1' }, { id: 'o-m2' }] }));
  res.end('{}');
});

test('P115 판: 연결을 쓰는 런처는 하네스마다 그 연결로 띄우고(시작 전 확인), 닿지 않으면 패널 전에 gateway_down, 지운 연결이면 띄우지 않는다', async () => {
  const gw = await fakeGw();
  const { b, dir, calls, conns, startOf } = await board(gw.port);
  try {
    await b.spawn({ cwd: dir, name: 'cx1', launcher: 'cx-fake' });
    assert.ok(startOf('cx1').args.includes(`model_provider=${providerIdOf(conns.oai)}`));
    assert.equal(b.sessions.get(b.store.openSessions().find((s) => s.name === 'cx1').sessionId).harnessPlan.connectionId, conns.oai.id);
    await b.spawn({ cwd: dir, name: 'pi1', launcher: 'pi-fake' });
    const pa = startOf('pi1').args; const ext = pa[pa.indexOf('-e') + 1];
    assert.ok(fs.existsSync(ext), '판 데이터 폴더의 확장 파일'); assert.ok(path.resolve(ext).startsWith(path.resolve(dir, 'harness')));
    await b.spawn({ cwd: dir, name: 'oc1', launcher: 'oc-fake' });
    assert.equal(JSON.parse(startOf('oc1').env.OPENCODE_CONFIG_CONTENT).model, `${providerIdOf(conns.chat)}/m1`);
    const cl = await b.spawn({ cwd: dir, name: 'cl1', launcher: 'cl-fake' });
    const st = JSON.parse(fs.readFileSync(b.sessions.get(cl.sessionId).settingsPath, 'utf8'));
    assert.equal(st.env.ANTHROPIC_BASE_URL, `http://127.0.0.1:${gw.port}`); assert.equal(st.apiKeyHelper, undefined, '인증 없는 연결');
    assert.equal(b.store.spawnInfo(cl.sessionId).connection, conns.anth.id);
    // 닿지 않으면 패널을 만들기 전에
    await gw.close();
    const n0 = calls.length;
    await assert.rejects(b.spawn({ cwd: dir, name: 'cx2', launcher: 'cx-fake' }), (e) => e.code === 'gateway_down');
    assert.equal(calls.length, n0);
    // 지운 연결(기록만 남은 참조): 띄우지 않는다
    b.store.setMeta('connections', { v: 1, items: [] });
    await assert.rejects(b.spawn({ cwd: dir, name: 'pi2', launcher: 'pi-fake' }), (e) => e.code === 'connection_missing');
    // 이미 띄운 pi 세션을 그 연결 없이 다시 띄우지 않는다(-e 없이 다른 제공자로 새지 않게)
    const pi1 = [...b.sessions.values()].find((s) => s.name === 'pi1');
    assert.throws(() => b.harnessLaunchOf(pi1, { resume: true }), (e) => e.code === 'connection_missing');
  } finally { b.store.close(); }
});

test('P115 atrium models·child --model: 연결마다 모델 목록, 그 연결을 쓰는 런처의 하네스로 띄운다', async () => {
  const gw = await fakeGw();
  const { b, lead, startOf } = await board(gw.port);
  try {
    const m = await b.branch.listModels(lead);
    assert.deepEqual(m.gateways.map((g) => [g.connection, g.protocol, g.host, g.ok]).sort(), [['fake anth', 'anthropic-messages', 'cl-fake', true], ['fake chat', 'openai-chat', 'oc-fake', true], ['fake oai', 'openai-responses', 'cx-fake', true]]);
    const om2 = m.entries.find((e) => e.source === 'gateway' && e.model === 'o-m2' && e.connection === 'fake chat');
    assert.equal(om2.harness, 'opencode', '그 연결을 쓰는 첫 런처의 하네스');
    assert.equal(m.entries.find((e) => e.source === 'gateway' && e.model === 'm1' && e.connection === 'fake oai').command, 'atrium child <이름> --kind codex --model m1', '같은 모델 ID가 여러 연결에 있으면 --kind로 가른다');
    const r = await b.branch.spawnChild(lead, { name: 'w-cm2', model: 'claude-m2', wait: false });
    assert.equal(r.kind, 'claude'); assert.equal(r.resolved.source, 'gateway');
    const s = b.sessions.get(r.sessionId);
    assert.equal(JSON.parse(fs.readFileSync(s.settingsPath, 'utf8')).env.ANTHROPIC_BASE_URL, `http://127.0.0.1:${gw.port}`);
    const x = await b.branch.spawnChild(lead, { name: 'w-om2', model: 'o-m2', kind: 'opencode', wait: false });
    assert.equal(x.kind, 'opencode');
    assert.equal(JSON.parse(startOf('w-om2').env.OPENCODE_CONFIG_CONTENT).model, `${providerIdOf(b.features.connections.find('fake chat'))}/o-m2`);
  } finally { b.store.close(); await gw.close(); }
});

// ---------- 옮기기(완료 기준 5) ----------
const V1 = (items, favorites = items.map((l) => l.id)) => ({ v: 1, items, favorites });
const L1 = (o) => ({ icon: '', model: '', effort: '', permissionMode: '', allowHerdr: false, args: '', env: {}, command: '', checkUrl: '', ...o });

test('P115 옮기기: DeepSeek 런처가 있는 판 → 연결 + 참조(이름·아이콘 그대로, 확인 주소는 연결의 health). 두 번 돌려도 같고 옛 키가 남는다', () => {
  const dir = tmp();
  const store = new Store(path.join(dir, 'board.db'));
  try {
    const old = V1([L1({ id: 'claude', name: 'Claude Code', harness: 'claude', permissionMode: 'manual' }), L1({ id: 'deepseek', name: 'DeepSeek', harness: 'claude', icon: 'deepseek', model: 'ds-m', permissionMode: 'manual', env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:7', CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1' }, checkUrl: 'http://127.0.0.1:7/healthz' })]);
    store.setMeta(LEGACY_META_KEY, old);
    const conns = new Connections({ store });
    const a = new Launchers({ store, connections: conns });
    const v2 = store.getMeta(META_KEY);
    const ds = v2.items.find((l) => l.id === 'deepseek');
    assert.deepEqual([ds.name, ds.icon, ds.model, ds.env, 'checkUrl' in ds], ['DeepSeek', 'deepseek', 'ds-m', { CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1' }, false]);
    const c = conns.get(ds.connection);
    assert.deepEqual([c.protocol, c.baseUrl, c.healthUrl, c.name], ['anthropic-messages', 'http://127.0.0.1:7', 'http://127.0.0.1:7/healthz', 'DeepSeek']);
    assert.deepEqual(store.getMeta(LEGACY_META_KEY), old, '옛 키는 그대로(옛 코드로 돌아가도 뜬다)');
    assert.equal(a.migrated.v2.moved.length, 1);
    // 두 번 돌려도 같다
    const again = new Launchers({ store, connections: conns });
    assert.equal(again.migrated, null);
    assert.deepEqual(store.getMeta(META_KEY), v2); assert.equal(conns.items().length, 1);
    // 같은 옛 목록을 새 판에서 다시 옮겨도 같은 ID
    assert.equal(migrateLaunchers(old).connections[0].id, c.id);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('P115 옮기기: 옛 게이트웨이 환경 변수만 준 판 → 연결 하나(경고 로그), 뜰 때마다 같은 연결. env의 ANTHROPIC_BASE_URL 런처 → 연결 + 참조, 평문 인증 값은 옮기지 않고 알린다', () => {
  const dir = tmp();
  const store = new Store(path.join(dir, 'board.db'));
  try {
    const logs = [];
    const conns = new Connections({ store });
    const gw = { healthUrl: 'http://127.0.0.1:6/healthz', baseUrl: null };
    new Launchers({ store, connections: conns, gateway: gw, log: (m) => logs.push(m) });
    assert.equal(conns.items().length, 1); assert.equal(conns.items()[0].baseUrl, 'http://127.0.0.1:6'); assert.equal(conns.items()[0].healthUrl, 'http://127.0.0.1:6/healthz');
    assert.ok(logs.some((m) => /deprecated/.test(m)));
    new Launchers({ store, connections: conns, gateway: gw, log: () => {} });
    assert.equal(conns.items().length, 1, '두 번 켜도 하나');
    assert.equal(legacyGatewayConnection({}), null);
    // env에 ANTHROPIC_BASE_URL과 평문 토큰이 든 런처
    const s2 = new Store(path.join(dir, 'b2.db'));
    s2.setMeta(LEGACY_META_KEY, V1([L1({ id: 'g', name: 'My GW', harness: 'claude', permissionMode: 'manual', env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:5', ANTHROPIC_AUTH_TOKEN: 'plain-secret' } })]));
    const c2 = new Connections({ store: s2 });
    const l2 = new Launchers({ store: s2, connections: c2 });
    const g = l2.find('g');
    assert.equal(g.connection, c2.items()[0].id); assert.deepEqual(g.env, { ANTHROPIC_AUTH_TOKEN: 'plain-secret' }, '인증 값은 옮기지 않는다(판이 값을 연결에 저장하지 않는다)');
    assert.deepEqual(l2.list().notices, [{ id: 'g', name: 'My GW', env: ['ANTHROPIC_AUTH_TOKEN'] }]);
    assert.equal(c2.items()[0].auth.env, '');
    s2.close();
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
