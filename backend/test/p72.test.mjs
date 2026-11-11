// P72: 새 판의 기본 호출자(Claude Code, Codex, 셸 셋)와 Codex 모델 목록(Codex의 모델 목록 캐시 읽기, 목록 밖 이름 경고).
// 시험은 가짜 CODEX_HOME(임시 폴더)만 읽는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Launchers, VERSION, META_KEY, HARNESSES, describeHarnesses, modelWarning } from '../src/launchers.mjs';
import { CodexModels, parseCodexCache, unlistedModel, codexHomeOf, CACHE_FILE } from '../src/codex-cache.mjs';
import { buildCatalog, resolveModel } from '../src/models.mjs';
import { Branch } from '../src/branch.mjs';
import { loadConfig } from '../src/config.mjs';
import { Store } from '../src/store.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p72-'));
const BOARD = { store: { branchRows: () => [] }, bus: { on() {} } }; // Branch가 만들 때 읽는 판의 최소 부분
// Codex 캐시 파일 모양(필요한 칸만)
const CACHE = {
  fetched_at: '2026-01-01T00:00:00Z', client_version: '0.0.0',
  models: [
    { slug: 'gpt-6-sol', display_name: 'GPT-6 Sol (fast)', visibility: 'list', priority: 103 },
    { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list', priority: 102 },
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list', priority: 102 },
    { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'hide', priority: 113 },
    { slug: 'bad name; rm', display_name: 'x', visibility: 'list', priority: 1 },
    { slug: 'gpt-6-luna', visibility: 'list' },
  ],
};
const writeCache = (home, v) => { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(path.join(home, CACHE_FILE), typeof v === 'string' ? v : JSON.stringify(v)); };

test('P72 새 판: 호출자는 Claude Code(manual), Codex, 셸 셋이고 모두 레일에 있다', () => {
  const dir = tmp();
  try {
    const store = new Store(path.join(dir, 'board.db'));
    const ls = new Launchers({ store, gateway: { healthUrl: 'http://127.0.0.1:1/healthz' } });
    assert.deepEqual(ls.migrated, { oldBoard: false, favorites: ['claude', 'codex', 'gemini', 'shell'] });
    const l = ls.list();
    assert.deepEqual(l.launchers.map((x) => [x.id, x.harness, x.favorite]), [['claude', 'claude', true], ['codex', 'codex', true], ['gemini', 'agy', true], ['shell', 'shell', true]]);
    assert.equal(l.launchers[0].preview.line, 'claude --permission-mode manual');
    assert.equal(ls.find('deepseek'), null, 'DeepSeek 예시가 없다');
    assert.ok(l.launchers.every((x) => !Object.keys(x.env).length && !x.checkUrl));
    store.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('P72 옛 판: 판 기록에 있는 호출자 목록(DeepSeek, bypassPermissions)은 그대로', () => {
  const dir = tmp();
  try {
    const store = new Store(path.join(dir, 'board.db'));
    const saved = {
      v: 1,
      items: [
        { id: 'claude', name: 'Claude Code', harness: 'claude', icon: '', model: '', effort: '', permissionMode: 'bypassPermissions', allowHerdr: true, args: '', env: {}, command: '', checkUrl: '' },
        { id: 'codex', name: 'Codex', harness: 'codex', icon: '', model: '', effort: '', permissionMode: '', allowHerdr: false, args: '', env: {}, command: '', checkUrl: '' },
        { id: 'shell', name: 'Shell', harness: 'shell', icon: '', model: '', effort: '', permissionMode: '', allowHerdr: false, args: '', env: {}, command: '', checkUrl: '' },
        { id: 'deepseek', name: 'DeepSeek', harness: 'claude', icon: 'deepseek', model: 'ocx-claude-deepseek--deepseek-flash[1m]', effort: '', permissionMode: 'bypassPermissions', allowHerdr: false, args: '', env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:10100' }, command: '', checkUrl: 'http://127.0.0.1:10100/healthz' },
      ],
      favorites: ['claude', 'codex', 'deepseek', 'shell'],
    };
    store.setMeta(META_KEY, saved);
    const ls = new Launchers({ store });
    assert.ok(ls.migrated, '옛 목록에는 Gemini 단추를 한 번만 더한다');
    const migrated = store.getMeta(META_KEY);
    assert.equal(migrated.v, VERSION);
    assert.deepEqual(migrated.items.filter((l) => l.id !== 'gemini'), saved.items);
    assert.deepEqual(migrated.favorites, ['claude', 'codex', 'gemini', 'deepseek', 'shell']);
    assert.equal(new Launchers({ store }).migrated, null);
    assert.equal(ls.get('deepseek').permissionMode, 'bypassPermissions');
    assert.equal(ls.get('claude').permissionMode, 'bypassPermissions');
    store.close();
    // 옛 설정만 있는 판(P33 전)도 예전처럼 DeepSeek를 옮긴다
    const s2 = new Store(path.join(dir, 'b2.db'));
    s2.setMeta('settings', { tray: true });
    assert.deepEqual(new Launchers({ store: s2 }).migrated.favorites, ['claude', 'codex', 'gemini', 'deepseek', 'shell']);
    s2.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('P72 Codex 캐시 읽기: 보이는 모델은 priority 순서, 숨긴 모델은 따로, 이상한 이름은 뺀다', () => {
  const r = parseCodexCache(JSON.stringify(CACHE));
  assert.equal(r.ok, true);
  assert.deepEqual(r.models, ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'], '같은 priority는 파일 순서, priority 없음은 끝');
  assert.deepEqual(r.hidden, ['gpt-5.5']);
  assert.equal(r.labels['gpt-6-sol'], 'GPT-6 Sol (fast)');
  assert.equal(r.labels['gpt-6.1-sol'], undefined, '대소문자만 다른 이름은 두지 않는다');
  assert.equal(r.labels['gpt-6-luna'], undefined);
  assert.deepEqual(parseCodexCache('{not json'), { ok: false, why: 'bad_json' });
  assert.deepEqual(parseCodexCache('{"models": 3}'), { ok: false, why: 'no_models' });
  assert.deepEqual(parseCodexCache('{"models": []}'), { ok: false, why: 'empty' });
  assert.deepEqual(parseCodexCache(JSON.stringify({ models: [{ slug: 'x', visibility: 'hide' }] })), { ok: false, why: 'empty' }, '보일 모델이 없으면 못 읽은 것');
});

test('P72 Codex 목록: 있음, 없음, 깨진 파일(고정 목록으로), 파일이 바뀌면 다시 읽기', () => {
  const dir = tmp();
  try {
    const home = path.join(dir, 'codex-home');
    let now = 0;
    const cm = new CodexModels({ home, fallback: HARNESSES.codex.models, checkMs: 1000, now: () => now });
    // 없음
    assert.deepEqual(cm.read(), { source: 'default', why: 'missing', models: [], hidden: [], labels: {} });
    // 있음(검사 간격이 지나야 본다)
    writeCache(home, CACHE);
    assert.equal(cm.read().source, 'default', '검사 간격 안에서는 다시 보지 않는다');
    now += 1000;
    assert.equal(cm.read().source, 'codex');
    assert.deepEqual(cm.models(), ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']);
    // 깨진 파일
    writeCache(home, '{"models": [');
    now += 1000;
    assert.deepEqual([cm.read().source, cm.read().why, cm.models()], ['default', 'bad_json', []]);
    // 고친 파일
    writeCache(home, { models: [{ slug: 'gpt-7', visibility: 'list' }] });
    now += 1000;
    assert.deepEqual(cm.models(), ['gpt-7']);
    // CODEX_HOME
    assert.equal(codexHomeOf({ CODEX_HOME: home }), path.resolve(home));
    assert.equal(codexHomeOf({}), path.join(os.homedir(), '.codex'));
    assert.equal(loadConfig({ argv: ['--dev'], env: { CODEX_HOME: home } }).codexHome, path.resolve(home));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('P72 목록에 없는 Codex 모델: 경고만 하고 막지 않는다(Claude Code, 빈 이름, 숨긴 이름은 경고 없음)', () => {
  const dir = tmp();
  try {
    const home = path.join(dir, 'codex-home');
    writeCache(home, CACHE);
    const store = new Store(path.join(dir, 'board.db'));
    const ls = new Launchers({ store, codexModels: new CodexModels({ home, fallback: HARNESSES.codex.models }) });
    const cx = ls.list().harnesses.find((h) => h.id === 'codex');
    assert.deepEqual([cx.models, cx.hiddenModels, cx.modelSource], [['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'], ['gpt-5.5'], 'codex']);
    assert.deepEqual(cx.modelLabels, { 'gpt-6-sol': 'GPT-6 Sol (fast)' });
    const pv = (launcher) => ls.preview({ launcher }).preview;
    assert.deepEqual(pv({ name: 'x', harness: 'codex', model: 'gpt-6.1-sol' }).warn, undefined);
    assert.deepEqual(pv({ name: 'x', harness: 'codex', model: 'gpt-5.5' }).warn, undefined, '숨긴 모델도 Codex가 안다');
    assert.deepEqual(pv({ name: 'x', harness: 'codex', model: '' }).warn, undefined, '빈 이름은 하네스 기본');
    const w = pv({ name: 'x', harness: 'codex', model: 'gpt-6.1-sool' });
    assert.deepEqual(w.warn, { key: 'launcherModels.unlisted', vars: { harness: 'Codex', model: 'gpt-6.1-sool' } });
    assert.equal(w.line, 'codex --model gpt-6.1-sool', '미리보기는 그대로');
    assert.equal(pv({ name: 'x', harness: 'claude', model: 'claude-opus-4-1' }).warn, undefined, 'Claude Code는 경고하지 않는다');
    // 저장도 막지 않는다
    const c = ls.create({ launcher: { name: 'Typo', harness: 'codex', model: 'gpt-6.1-sool' } });
    assert.equal(c.launcher.model, 'gpt-6.1-sool');
    assert.ok(c.launchers.find((l) => l.name === 'Typo').preview.warn);
    // 대소문자도 그대로 본다
    assert.equal(unlistedModel('GPT-6.1-SOL', { models: ['gpt-6.1-sol'] }), true);
    assert.equal(modelWarning({ harness: 'codex', model: 'gpt-6-astra' }, describeHarnesses()), null, '캐시가 없으면 고정 목록으로 본다');
    store.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('P72 atrium models: Codex 줄은 Codex 캐시의 목록이고 그 이름으로 풀린다', async () => {
  const cat = buildCatalog({ launchers: [], harnessModels: { codex: ['gpt-6.1-sol', 'gpt-6-astra'] } });
  const cx = cat.entries.filter((e) => e.harness === 'codex').map((e) => [e.model, e.command]);
  assert.deepEqual(cx, [['gpt-6.1-sol', 'atrium child <이름> --kind codex --model gpt-6.1-sol'], ['gpt-6-astra', 'atrium child <이름> --kind codex --model gpt-6-astra']]);
  assert.equal(resolveModel('gpt-6.1-sol', cat, { kind: 'codex' }).entry.model, 'gpt-6.1-sol');
  assert.equal(resolveModel('GPT 6.1 sol', cat, { kind: 'codex' }).entry.model, 'gpt-6.1-sol', '느슨한 맞춤');
  assert.equal(buildCatalog({ launchers: [] }).entries.filter((e) => e.harness === 'codex').length, 0, '목록을 모르면 모델을 만들어내지 않는다');
  // 판: Branch.catalog가 호출자의 Codex 목록을 쓴다
  const dir = tmp();
  try {
    const home = path.join(dir, 'codex-home');
    writeCache(home, CACHE);
    const store = new Store(path.join(dir, 'board.db'));
    const launchers = new Launchers({ store, codexModels: new CodexModels({ home }) });
    const br = new Branch({ cfg: { ocxHealthUrl: 'http://127.0.0.1:9/healthz', ocxConfigured: false }, features: { launchers }, ...BOARD }, { fetchModels: async () => { throw new Error('새 판은 게이트웨이를 묻지 않는다'); } });
    const c = await br.catalog();
    assert.deepEqual(c.entries.filter((e) => e.source === 'harness' && e.harness === 'codex').map((e) => e.model), ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']);
    assert.deepEqual(c.gateways, [], '새 판은 opencodex를 보지 않는다');
    store.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('P72 opencodex 기본 주소: 직접 줬거나 DeepSeek 호출자가 있는 판만 본다', () => {
  const cfg = (o) => ({ ocxHealthUrl: 'http://127.0.0.1:10100/healthz', ocxBaseUrl: null, ...o });
  const br = (c, items) => new Branch({ cfg: c, features: { launchers: { data: () => ({ items }) } }, ...BOARD });
  assert.equal(br(cfg({ ocxConfigured: false }), []).defaultGateway(), null);
  assert.equal(br(cfg({ ocxConfigured: true }), []).defaultGateway().url, 'http://127.0.0.1:10100');
  assert.equal(br(cfg({ ocxConfigured: false }), [{ id: 'deepseek', harness: 'command', icon: 'deepseek' }]).defaultGateway().url, 'http://127.0.0.1:10100', '옛 판(직접 명령 DeepSeek)');
  assert.equal(br(cfg({}), []).defaultGateway().url, 'http://127.0.0.1:10100', 'ocxConfigured를 모르는 판(시험)은 예전처럼');
  assert.equal(loadConfig({ argv: ['--dev'], env: {} }).ocxConfigured, false);
  assert.equal(loadConfig({ argv: ['--dev'], env: { ATRIUM_OCX_HEALTH: 'http://127.0.0.1:2/healthz' } }).ocxConfigured, true);
});
