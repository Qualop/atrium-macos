// P96 단위 시험: 슬래시 든 모델 이름(하위 세션, 판 spawn), Codex 카탈로그 읽기(config.toml의 model_catalog_json),
// 다른 종류 하위 세션의 인자(레일의 그 종류 호출자 바탕, 부모 권한 → Codex 승인 인자 표, 호출자 인자 우선, -m 겹침 빼기, 기록)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Store } from '../src/store.mjs';
import { Backend } from '../src/backend.mjs';
import { Launchers, HARNESSES, MODEL_RE } from '../src/launchers.mjs';
import { DEFAULTS } from '../src/settings.mjs';
import { Branch, APPROVAL_ARGS, approvalArgsOf, hasApprovalArgs, defaultLauncherOf, withoutModelArgs, otherKindPlan, boardSkill } from '../src/branch.mjs';
import { isModelName, MODEL_MAX } from '../src/model-name.mjs';
import { CodexModels, catalogPathOf, mergeCodexLists } from '../src/codex-cache.mjs';
import { modelFromArgs } from '../src/codex-args.mjs';
import { deriveState } from '../src/state.mjs';

const tmp = (p = 'mtask-p96-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const row = (slug, o = {}) => ({ slug, display_name: o.dn || slug, visibility: o.vis || 'list', priority: o.prio ?? 5 });
// opencodex 모양 카탈로그와 Codex 캐시(이 PC와 같은 모양, 이름은 시험용)
const CATALOG = { models: [row('gpt-6-astra', { prio: 102 }), row('deepseek/deepseek-flash', { prio: 0 }), row('b.ai/glm-5.3-flash'), row('b.ai/deepseek-v4.1-flash'), row('codex-auto-review', { vis: 'hide', prio: 43 })] };
const CACHE = { fetched_at: 'x', client_version: '0.167.0', models: [row('gpt-6-astra', { prio: 102 }), row('gpt-6.1-sol', { prio: 102 })] };
function codexHome({ catalog = CATALOG, cache = CACHE, config = null } = {}) {
  const home = tmp('mtask-p96-codex-');
  const cat = path.join(home, 'opencodex-catalog.json');
  if (catalog) fs.writeFileSync(cat, JSON.stringify(catalog));
  if (cache) fs.writeFileSync(path.join(home, 'models_cache.json'), JSON.stringify(cache));
  const cfg = config != null ? config : `approval_policy = "on-request"\nmodel = "deepseek/deepseek-flash"\nmodel_catalog_json = "${cat.replace(/\\/g, '\\\\')}"\n\n[marketplaces.x]\nmodel_catalog_json = "nope.json"\n`;
  fs.writeFileSync(path.join(home, 'config.toml'), cfg);
  return { home, cat };
}

test('P96 모델 이름 검사 한 곳: 슬래시를 받고, -로 시작·빈 값·80자 넘음·셸 글자는 거부', () => {
  for (const ok of ['deepseek/deepseek-flash', 'b.ai/glm-5.3-flash', 'deepseek/deepseek-v4-flash', 'claude-fable-5-p088[1m]', 'ocx-claude-deepseek--deepseek-flash[1m]', 'gpt-6.1-sol', 'a:b', 'x'.repeat(MODEL_MAX)]) assert.ok(isModelName(ok), ok);
  for (const bad of ['', '-m', '/x', 'a b', 'a;b', 'a"b', "a'b", 'a$b', 'a`b', 'a|b', 'x'.repeat(MODEL_MAX + 1), null, 42]) assert.ok(!isModelName(bad), String(bad));
  assert.ok(MODEL_RE.test('deepseek/deepseek-flash') && MODEL_RE.test(''), '호출자 칸 검사는 같은 글자(빈 값은 하네스 기본)');
});

test('P96 승인 인자 표: 부모 권한 모드 → Codex 인자, 호출자 인자가 이긴다, 다른 종류는 옮기지 않는다', () => {
  assert.deepEqual(approvalArgsOf('codex', 'manual'), { args: [], from: 'harness' });
  assert.deepEqual(approvalArgsOf('codex', 'plan'), { args: [], from: 'harness' });
  for (const m of ['acceptEdits', 'auto']) assert.deepEqual(approvalArgsOf('codex', m), { args: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'], from: 'parent' });
  for (const m of ['dontAsk', 'bypassPermissions']) assert.deepEqual(approvalArgsOf('codex', m), { args: ['--dangerously-bypass-approvals-and-sandbox'], from: 'parent' });
  assert.deepEqual(Object.keys(APPROVAL_ARGS.codex).sort(), ['acceptEdits', 'auto', 'bypassPermissions', 'dontAsk', 'manual', 'plan']);
  for (const a of [['-s', 'read-only'], ['--sandbox=read-only'], ['-a', 'never'], ['--ask-for-approval', 'never'], ['--approve-for-me'], ['--dangerously-bypass-approvals-and-sandbox'], ['-c', 'approval_policy="never"'], ['--config', 'sandbox_mode="read-only"'], ['--config=approval_policy=never'], ['-capproval_policy=never']]) {
    assert.ok(hasApprovalArgs('codex', a), a.join(' '));
    assert.deepEqual(approvalArgsOf('codex', 'bypassPermissions', a), { args: [], from: 'launcher' }, a.join(' '));
  }
  assert.ok(!hasApprovalArgs('codex', ['-c', 'model_reasoning_effort=low', '--search']));
  assert.deepEqual(approvalArgsOf('pi', 'bypassPermissions'), { args: [], from: null });
});

test('P96 그 종류의 기본 호출자: 레일(즐겨찾기) 순서의 첫 것 → 호출자 목록의 첫 것 → 없음', () => {
  const L = (id, harness, o = {}) => ({ id, name: o.name || id, harness, model: o.model || '', args: o.args || '' });
  const items = [L('claude', 'claude'), L('codex', 'codex'), L('cx-fast', 'codex', { args: '--search' }), L('pi1', 'pi'), L('shell', 'shell')];
  assert.equal(defaultLauncherOf('codex', { items, favorites: ['claude', 'cx-fast', 'codex'] }).id, 'cx-fast');
  assert.equal(defaultLauncherOf('codex', { items, favorites: ['claude'] }).id, 'codex', '레일에 없으면 목록의 첫 것');
  assert.equal(defaultLauncherOf('pi', { items, favorites: [] }).id, 'pi1');
  assert.equal(defaultLauncherOf('codex', { items: [L('claude', 'claude')], favorites: ['claude'] }), null);
  assert.equal(defaultLauncherOf('shell', { items, favorites: ['shell'] }), null, '셸은 하위 세션이 아니다');
  assert.deepEqual(withoutModelArgs(['-m', 'x', '--search', '--model=y', '--model', 'z', '-c', 'a=b']), ['--search', '-c', 'a=b']);
  // 계획: 레일 호출자 바탕, --model은 모델만 덮는다(호출자 인자의 -m은 뺀다), 승인 인자는 뒤에
  const p = otherKindPlan({ route: { type: 'model', kind: 'codex', model: 'deepseek/deepseek-flash' }, permissionMode: 'bypassPermissions', lists: { items: [L('codex', 'codex', { model: 'gpt-6-astra', args: '-m old --search' })], favorites: ['codex'] } });
  assert.deepEqual(p.argv, ['-m', 'deepseek/deepseek-flash', '--search', '--dangerously-bypass-approvals-and-sandbox']);
  assert.deepEqual(p.record, { base: 'rail', launcher: 'codex', model: 'deepseek/deepseek-flash', modelFrom: 'model', approvalArgs: ['--dangerously-bypass-approvals-and-sandbox'], approvalFrom: 'parent', parentPermissionMode: 'bypassPermissions' });
  const bare = otherKindPlan({ route: { type: 'plain', kind: 'codex' }, permissionMode: 'manual', lists: {} });
  assert.deepEqual([bare.argv, bare.record.base, bare.record.approvalFrom], [[], 'bare', 'harness']);
});

test('P96 Codex 카탈로그: config.toml의 model_catalog_json(맨 위 키만)을 읽어 캐시와 합친다. 없으면 지금처럼', () => {
  const home = 'C:/h/.codex';
  assert.equal(catalogPathOf('model_catalog_json = "C:\\\\Users\\\\u\\\\.codex\\\\cat.json"\n', home), 'C:/Users/u/.codex/cat.json');
  assert.equal(catalogPathOf("model_catalog_json = 'cat.json' # 주석\n", home), 'C:/h/.codex/cat.json');
  assert.equal(catalogPathOf('model_catalog_json = "~/x.json"', home, 'C:/me'), 'C:/me/x.json');
  assert.equal(catalogPathOf('[profiles.a]\nmodel_catalog_json = "x.json"', home), null, '표 안의 같은 이름은 보지 않는다');
  assert.equal(catalogPathOf('model = "x"', home), null);
  const m = mergeCodexLists({ models: ['a', 'b'], hidden: ['h'], labels: { a: 'A' } }, { models: ['b', 'c', 'h'], hidden: ['d'], labels: { a: 'old', c: 'C' } });
  assert.deepEqual(m, { ok: true, models: ['a', 'b', 'c', 'h'], hidden: ['d'], labels: { a: 'A', c: 'C' } });

  const { home: h1 } = codexHome();
  const r = new CodexModels({ home: h1, fallback: HARNESSES.codex.models }).read();
  assert.equal(r.source, 'codex'); assert.equal(r.catalog, true);
  assert.deepEqual(r.models, ['deepseek/deepseek-flash', 'b.ai/glm-5.3-flash', 'b.ai/deepseek-v4.1-flash', 'gpt-6-astra', 'gpt-6.1-sol'], '카탈로그 먼저(priority 순), 캐시에만 있는 것은 뒤');
  assert.deepEqual(r.hidden, ['codex-auto-review']);
  // 카탈로그 설정이 없으면 캐시만(P72 그대로)
  const { home: h2 } = codexHome({ config: 'model = "x"\n' });
  assert.deepEqual(new CodexModels({ home: h2 }).read().models, ['gpt-6-astra', 'gpt-6.1-sol']);
  // 카탈로그 파일이 없으면 캐시만, 둘 다 없으면 고정 목록
  const { home: h3, cat } = codexHome(); fs.rmSync(cat);
  assert.deepEqual(new CodexModels({ home: h3 }).read().models, ['gpt-6-astra', 'gpt-6.1-sol']);
  const { home: h4 } = codexHome({ cache: null, catalog: null });
  assert.deepEqual(new CodexModels({ home: h4, fallback: ['gpt-6-astra'] }).read(), { source: 'default', why: 'missing', models: ['gpt-6-astra'], hidden: [], labels: {} });
  // 설정이 바뀌면(카탈로그 경로를 넣음) 다시 읽는다
  let now = 0;
  const cm = new CodexModels({ home: h2, checkMs: 1000, now: () => now });
  assert.equal(cm.read().catalog, undefined);
  const cat2 = path.join(h2, 'c2.json'); fs.writeFileSync(cat2, JSON.stringify({ models: [row('zai/glm-5')] }));
  fs.writeFileSync(path.join(h2, 'config.toml'), `model_catalog_json = 'c2.json'\n`);
  now = 2000;
  assert.deepEqual(cm.read().models, ['zai/glm-5', 'gpt-6-astra', 'gpt-6.1-sol']);
});

// ---------- 판 위에서: atrium child --kind codex ----------
function server(handler) {
  const srv = http.createServer(handler);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((c) => srv.close(c)) })));
}
// 슬래시 든 ID를 알려 주는 게이트웨이(Claude Code 하위 세션의 슬래시 모델)
const gatewayServer = () => server((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url.startsWith('/healthz')) return res.end(JSON.stringify({ status: 'ok' }));
  if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'zai/glm-5', owned_by: 'zai' }] }));
  res.statusCode = 404; res.end();
});
async function board({ permissionMode = 'manual', gatewayUrl = null } = {}) {
  const dir = tmp();
  const { home } = codexHome();
  const b = new Backend({ quietMs: 600000, port: 0, logDir: dir, sessionsDir: path.join(dir, 'sessions'), claudeJson: path.join(dir, 'none.json'), claudeCommand: 'claude', hookTimeoutSec: 2, herdrSession: 'atrium-dev-p96test', profile: 'dev', dataDir: dir, ...(gatewayUrl ? { ocxHealthUrl: `${gatewayUrl}/healthz` } : {}) });
  b.store = new Store(path.join(dir, 'board.db'));
  b.sessions = new Map(); b.herdrOk = true; b.hookUrl = 'http://127.0.0.1:1/hook'; b.plugin = {}; b.apiToken = 'board-api-token';
  b.features = { settings: { get: () => ({ ...DEFAULTS }) }, launchers: null };
  if (gatewayUrl) b.store.setMeta('settings', {}); // DeepSeek 예시 호출자가 있는 옛 판(게이트웨이 목록을 본다)
  b.features.launchers = new Launchers({ store: b.store, codexModels: new CodexModels({ home, fallback: HARNESSES.codex.models }), gateway: gatewayUrl ? { healthUrl: `${gatewayUrl}/healthz` } : {} });
  // 모델 조회는 이 시험의 임시 카탈로그만 사용한다. 호스트 CLI·인증 프로필은 호출하지 않는다.
  const syntheticModels = new CodexModels({ home });
  b.agentModels = async ({ kind }) => ({ models: kind === 'codex' ? syntheticModels.models().map((id) => ({ id, name: id })) : [] });
  b.queue = { enqueue: () => ({ deliveryId: 'd1', status: 'queued' }), pending: () => 0 };
  b.api = { broadcast() {} };
  b.broadcastSession = () => {}; b.broadcastWorkspaces = () => {}; b.probeGit = () => {}; b.registerResume = () => {};
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
  b.requireHerdr = () => {};
  const lead = await b.spawn({ cwd: dir, name: 'lead', kind: 'claude', model: 'haiku', permissionMode });
  const startOf = (name) => calls.filter((c) => c.name === name).at(-1);
  return { b, dir, lead: b.sessions.get(lead.sessionId), startOf, L: b.features.launchers };
}

test('P96 atrium child --kind codex --model "<슬래시 이름>": 레일의 Codex 호출자 바탕, manual이면 승인 인자를 덧붙이지 않는다, 기록', async () => {
  const { b, lead, startOf, L } = await board({ permissionMode: 'manual' });
  b.store.setMeta('settings', { branchMaxChildren: 8 });
  L.update({ id: 'codex', patch: { model: 'gpt-6-astra', args: '-c model_reasoning_effort=low' } });
  const r = await b.branch.spawnChild(lead, { name: 'cx1', kind: 'codex', model: 'deepseek/deepseek-flash', prompt: '한 줄로 답해', wait: false });
  const st = startOf('cx1');
  assert.equal(st.kind, 'codex');
  assert.deepEqual(st.args, ['-c', 'model_reasoning_effort=low', '--model', 'deepseek/deepseek-flash'], '레일 Codex 호출자의 추가 인자, --model이 모델만 덮는다');
  assert.equal(r.model, 'deepseek/deepseek-flash'); assert.equal(r.launcher, 'Codex');
  assert.equal(r.resolved.source, 'harness'); assert.equal(r.resolved.how, 'exact');
  assert.deepEqual(r.harness, { base: 'rail', launcher: 'Codex', model: 'deepseek/deepseek-flash', modelFrom: 'model', approvalArgs: [], approvalFrom: 'harness', parentPermissionMode: 'manual', argv: r.harness.argv });
  assert.equal(modelFromArgs(r.harness.argv), modelFromArgs(st.args));
  assert.deepEqual(withoutModelArgs(r.harness.argv), withoutModelArgs(st.args));
  const ev = b.store.events({ sessionId: lead.sessionId }).find((e) => e.kind === 'branch_child' && e.data.child === 'cx1');
  assert.equal(ev.data.model, 'deepseek/deepseek-flash'); assert.equal(ev.data.launcher, 'Codex'); assert.deepEqual(ev.data.harness.argv, r.harness.argv);
  assert.equal(b.store.spawnInfo(r.sessionId).launcher, 'Codex', '판의 spawn 기록에도 호출자');
  // 말로 한 이름도 Codex 줄로 풀린다(--kind codex). 목록에 없는 v4 이름은 낱말이 모두 든 줄로 느슨하게 풀리고(P41), 맞는 줄이 없으면 띄우지 않는다
  const ds = await b.branch.spawnChild(lead, { name: 'cx2', kind: 'codex', model: 'deepseek flash', wait: false });
  assert.equal(ds.model, 'deepseek/deepseek-flash'); assert.equal(ds.resolved.how, 'loose');
  const glm = await b.branch.spawnChild(lead, { name: 'cx3', model: 'b.ai/glm-5.3-flash', wait: false });
  assert.equal(glm.kind, 'codex', '--kind 없이도 Codex 목록의 이름이면 Codex'); assert.equal(modelFromArgs(startOf('cx3').args), 'b.ai/glm-5.3-flash');
  const v4 = await b.branch.spawnChild(lead, { name: 'cx4', kind: 'codex', model: 'deepseek/deepseek-v4-flash', wait: false });
  assert.deepEqual([v4.model, v4.resolved.how], ['b.ai/deepseek-v4.1-flash', 'loose']);
  await assert.rejects(b.branch.spawnChild(lead, { name: 'cx6', kind: 'codex', model: 'qwen/qwen-9', wait: false }), (e) => e.code === 'model_unknown');
  // --kind codex만: 레일 호출자의 모델
  const plain = await b.branch.spawnChild(lead, { name: 'cx5', kind: 'codex', wait: false });
  assert.deepEqual(startOf('cx5').args, ['-c', 'model_reasoning_effort=low', '--model', 'gpt-6-astra']); assert.equal(plain.harness.modelFrom, 'launcher');
  b.store.close();
});

test('P96 부모 권한 옮기기: bypassPermissions·acceptEdits, 호출자 인자가 이긴다, 호출자가 없으면 맨 codex', async () => {
  const { b, lead, startOf, L } = await board({ permissionMode: 'bypassPermissions' });
  b.store.setMeta('settings', { branchMaxChildren: 8 });
  const r = await b.branch.spawnChild(lead, { name: 'cx1', kind: 'codex', model: 'deepseek/deepseek-flash', wait: false });
  assert.deepEqual(startOf('cx1').args, ['--dangerously-bypass-approvals-and-sandbox', '--model', 'deepseek/deepseek-flash']);
  assert.equal(r.harness.approvalFrom, 'parent'); assert.equal(r.permissionMode, 'bypassPermissions', '판 기록의 권한 모드는 부모의 것');
  // 호출자 인자에 샌드박스가 있으면 그것만
  L.update({ id: 'codex', patch: { args: '--sandbox read-only' } });
  const ro = await b.branch.spawnChild(lead, { name: 'cx2', kind: 'codex', wait: false });
  assert.deepEqual(startOf('cx2').args, ['--sandbox', 'read-only']); assert.equal(ro.harness.approvalFrom, 'launcher');
  // --launcher로 고른 Codex 호출자도 같은 규칙
  L.update({ id: 'codex', patch: { args: '' } });
  await b.branch.spawnChild(lead, { name: 'cx3', launcher: 'Codex', wait: false });
  assert.deepEqual(startOf('cx3').args, ['--dangerously-bypass-approvals-and-sandbox']);
  // 레일 순서: 즐겨찾기의 첫 Codex 호출자
  const made = L.create({ launcher: { name: 'Codex fast', harness: 'codex', model: 'b.ai/glm-5.3-flash', args: '--search' }, favorite: true });
  L.order({ ids: [made.launcher.id, ...L.data().favorites.filter((x) => x !== made.launcher.id)] });
  const fav = await b.branch.spawnChild(lead, { name: 'cx4', kind: 'codex', wait: false });
  assert.equal(fav.launcher, 'Codex fast'); assert.deepEqual(startOf('cx4').args, ['--search', '--dangerously-bypass-approvals-and-sandbox', '--model', 'b.ai/glm-5.3-flash']);
  // Codex 호출자가 하나도 없으면 맨 codex에 같은 인자
  L.delete({ id: made.launcher.id }); L.delete({ id: 'codex' });
  const bare = await b.branch.spawnChild(lead, { name: 'cx5', kind: 'codex', model: 'deepseek/deepseek-flash', wait: false });
  assert.deepEqual(startOf('cx5').args, ['--dangerously-bypass-approvals-and-sandbox', '--model', 'deepseek/deepseek-flash']);
  assert.equal(bare.launcher, null); assert.equal(bare.harness.base, 'bare');
  b.store.close();
});

test('P96 acceptEdits 부모 → workspace-write + on-request. Claude 하위 세션은 그대로(권한 모드를 물려받음)', async () => {
  const { b, lead, startOf } = await board({ permissionMode: 'acceptEdits' });
  await b.branch.spawnChild(lead, { name: 'cx1', kind: 'codex', wait: false });
  assert.deepEqual(startOf('cx1').args, ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request']);
  const c = await b.branch.spawnChild(lead, { name: 'c1', wait: false });
  assert.equal(c.harness, null); const a = startOf('c1').args;
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'acceptEdits');
  b.store.close();
});

test('P96 슬래시 모델: Claude 하위 세션(게이트웨이 모델 ID)과 판 spawn(호출자 + 모델)', async () => {
  const gw = await gatewayServer();
  try {
    const { b, lead, startOf, dir } = await board({ gatewayUrl: gw.url });
    const r = await b.branch.spawnChild(lead, { name: 'g1', model: 'zai/glm-5', wait: false });
    assert.equal(r.kind, 'claude'); assert.equal(r.resolved.source, 'gateway');
    const a = startOf('g1').args; assert.equal(a[a.indexOf('--model') + 1], 'zai/glm-5');
    // 판의 새 세션(session.spawn): Codex 호출자 + 슬래시 모델
    const s = await b.spawn({ cwd: dir, name: 'cx9', launcher: 'codex', model: 'b.ai/glm-5.3-flash' });
    assert.equal(s.kind, 'codex'); assert.deepEqual(startOf('cx9').args, ['--model', 'b.ai/glm-5.3-flash']);
    b.store.close();
  } finally { await gw.close(); }
});

test('P96 스킬 글: 다른 종류 워커 문단', () => {
  const s = boardSkill();
  assert.match(s, /--kind codex --model "<모델>" --prompt/);
  assert.match(s, /hook이 없어 `herdr agent wait`/);
});

test('P96 hook 없는 세션의 화면 답: Codex 0.167의 빈 입력칸(안내문 든 › 줄)과 상태 줄을 답으로 고르지 않는다', async () => {
  const { screenAnswerText } = await import('../src/links.mjs');
  const codex = ['  >_ OpenAI Codex (v0.167.0)', '  permissions: YOLO mode', '', '› Reply with exactly one line: P96 CODEX OK', '', '', '• P96 CODEX OK', '', '  Worked for 3s • 11:03 PM', '', '', '', '› Ask Codex to do anything', '', '  deepseek/deepseek-flash max · C:/x', '  ← for agents · ? for shortcuts                                                              ⚠ 1 warning · f2 to view'].join('\n');
  assert.equal(screenAnswerText(codex, 20), 'P96 CODEX OK\n  Worked for 3s • 11:03 PM');
  // 답 머리표가 마지막 프롬프트 뒤에 있으면 그대로(Claude 화면, 짧은 답)
  const claude = ['❯ 첫 질문', '● 첫 답', '❯ 둘째 질문', '● 짧은 답'].join('\n');
  assert.equal(screenAnswerText(claude, 20), '짧은 답');
});
