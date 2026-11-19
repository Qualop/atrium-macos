// P122: 원본 새 판의 기본 런처는 Claude Code·Codex 둘이다. macOS 판(BRIEF 실행 프리셋): 새 판은 Claude Code·Codex·Gemini(agy)·셸 넷이고,
// Gemini 전의 옛 목록에는 Gemini 단추를 한 번만 더한다. 옛 판의 다른 런처와 순서는 그대로다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Launchers, META_KEY, LEGACY_META_KEY, initialLaunchers, resolveLauncher } from '../src/launchers.mjs';
import { Store } from '../src/store.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p122-'));
const plain = (id, name, harness, x = {}) => ({ id, name, harness, icon: '', model: '', effort: '', permissionMode: '', allowHerdr: false, args: '', env: {}, command: '', ...x });

test('P122(macOS 판) 새 판: 런처와 레일 즐겨찾기는 Claude Code·Codex·Gemini(agy)·셸', () => {
  const v = initialLaunchers({});
  assert.deepEqual(v.items.map((l) => [l.id, l.harness]), [['claude', 'claude'], ['codex', 'codex'], ['gemini', 'agy'], ['shell', 'shell']]);
  assert.deepEqual(v.favorites, ['claude', 'codex', 'gemini', 'shell']);
  const dir = tmp();
  try {
    const store = new Store(path.join(dir, 'board.db'));
    const ls = new Launchers({ store });
    assert.equal(ls.migrated.oldBoard, false);
    const l = ls.list();
    assert.deepEqual(l.launchers.map((x) => x.id), ['claude', 'codex', 'gemini', 'shell']);
    assert.deepEqual(l.favorites, ['claude', 'codex', 'gemini', 'shell']);
    assert.ok(l.harnesses.some((h) => h.id === 'shell'), '셸 하네스는 런처 틀에서 고를 수 있다');
    store.close();
    // 다시 켜도 같다
    const s2 = new Store(path.join(dir, 'board.db'));
    assert.equal(new Launchers({ store: s2 }).migrated, null);
    assert.deepEqual(s2.getMeta(META_KEY).favorites, ['claude', 'codex', 'gemini', 'shell']);
    s2.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('P122 옛 판: 이미 있는 런처 목록(셸 포함)은 바꾸지 않는다', () => {
  const dir = tmp();
  try {
    // v2 목록이 있는 판(P115 뒤)
    const store = new Store(path.join(dir, 'a.db'));
    const saved = { v: 2, items: [plain('claude', 'Claude Code', 'claude', { permissionMode: 'manual' }), plain('codex', 'Codex', 'codex'), plain('shell', 'Shell', 'shell')], favorites: ['claude', 'codex', 'shell'] };
    store.setMeta(META_KEY, saved);
    const a = new Launchers({ store });
    assert.equal(a.migrated, null);
    assert.deepEqual(store.getMeta(META_KEY), saved);
    assert.deepEqual(a.list().favorites, ['claude', 'codex', 'shell']);
    store.close();
    // 옛 키(v1)만 있는 판(P72~P114): 옮겨도 셸이 남고, Gemini 전 목록이라 Gemini 단추를 Codex 뒤에 한 번 더한다(옛 키는 그대로)
    const s2 = new Store(path.join(dir, 'b.db'));
    const v1 = { v: 1, items: [plain('claude', 'Claude Code', 'claude', { permissionMode: 'manual' }), plain('codex', 'Codex', 'codex'), plain('shell', 'Shell', 'shell')], favorites: ['claude', 'codex', 'shell'] };
    s2.setMeta(LEGACY_META_KEY, v1);
    const b = new Launchers({ store: s2 });
    assert.deepEqual(b.list().favorites, ['claude', 'codex', 'gemini', 'shell']);
    assert.deepEqual(s2.getMeta(LEGACY_META_KEY), v1);
    assert.equal(b.get('shell').harness, 'shell');
    s2.close();
    // 세션 기록이 있는 판(P33 전)도 예전처럼 셸이 있다
    const s3 = new Store(path.join(dir, 'c.db'));
    s3.insertSession({ sessionId: 'x', name: 'x', cwd: dir, permissionMode: 'manual', createdAt: 1 });
    const c = new Launchers({ store: s3 });
    assert.equal(c.migrated.oldBoard, true);
    assert.ok(c.list().favorites.includes('shell'));
    s3.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('P122 새 판: 사람이 "+"로 셸 런처를 더 만들어 레일에 둘 수 있다', () => {
  const dir = tmp();
  try {
    const store = new Store(path.join(dir, 'board.db'));
    const ls = new Launchers({ store });
    const c = ls.create({ launcher: { name: 'Shell 2', harness: 'shell' }, favorite: true }); // macOS 판 새 판에는 셸 런처가 이미 있다
    assert.equal(c.launcher.harness, 'shell');
    assert.deepEqual(ls.data().favorites, ['claude', 'codex', 'gemini', 'shell', c.launcher.id]);
    assert.equal(ls.list().launchers.find((x) => x.id === c.launcher.id).preview.shell, true);
    assert.equal(resolveLauncher(ls.get('Shell 2')).kind, 'shell');
    store.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('P122·P129 hc가 준비되지 않으면 세션 시작 오류는 herdr 설치 안내가 아니라 hc를 받거나 띄우지 못했다는 글(terminalMissing)', async () => {
  const { Backend } = await import('../src/backend.mjs');
  const b = Object.create(Backend.prototype);
  Object.assign(b, { cfg: {}, adapter: { backend: 'hc', connected: false }, termMissing: { reason: 'download_failed', error: 'download failed: ECONNREFUSED https://example.invalid/hc.zip', at: 1 }, termCompat: { level: 'missing' } });
  assert.throws(() => b.requireTerminal(), (e) => e.code === 'terminal_missing' && e.key === 'terminalMissing' && /ECONNREFUSED/.test(e.vars.error) && !/herdr\.dev/.test(e.message));
  // 까닭을 모르면 not ready
  b.termMissing = null;
  assert.throws(() => b.requireTerminal(), (e) => e.code === 'terminal_missing' && e.vars.error === 'not ready');
  // 창 사전 둘에 그 열쇠와 {error}가 있다
  for (const lang of ['en', 'ko']) {
    const src = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'app', 'src', 'renderer', 'locales', `${lang}.js`), 'utf8');
    assert.match(src, /terminalMissing: '[^']*\{error\}/, lang);
  }
});
