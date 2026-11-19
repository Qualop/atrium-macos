// P18 이름 옮기기(multitask → Atrium): 옮길 옛 판 고르기, 기록 속 경로 고치기, 폴더 옮기기(통째로, 항목마다, 복사), 옛 백엔드 끄기, 다시 켜도 두 번 옮기지 않기.
// 터미널 서버와 claude 없이 돈다. 옛 백엔드는 이 시험이 띄운 가짜 서버(자식 프로세스)다. 실제 판 폴더(%LOCALAPPDATA%\multitask, atrium)는 건드리지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, legacyOf, legacyAppUserData, profileEnv, LEGACY_REAL } from '../src/config.mjs';
import { pathFixer, moveDataDir, migrateLegacyData, fixLegacyRecords, shutdownLegacyBackend, LegacyBlocked, MARKER } from '../src/rename-migrate.mjs';
import { Store } from '../src/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p18-'));
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

test('P18 옮길 옛 판: 실제 판 기본값일 때만 진짜 옛 판, 덮은 판은 ATRIUM_LEGACY_*를 둘 다 줘야, dev는 없음', () => {
  const real = loadConfig({ argv: [], env: {} });
  assert.deepEqual(real.legacy, { terminalSession: 'multitask', dataDir: LEGACY_REAL.dataDir });
  assert.equal(loadConfig({ argv: ['--dev'], env: {} }).legacy, null);
  // 시험 판(판 값을 덮음): 옛 값을 주지 않으면 옮기지 않는다(진짜 multitask를 끄지 않게)
  for (const env of [{ ATRIUM_HERDR_SESSION: 'atrium-dev-x' }, { ATRIUM_DATA_DIR: 'C:/t/d' }, { MTASK_PORT: '47900' }]) assert.equal(loadConfig({ argv: [], env }).legacy, null, JSON.stringify(env));
  const t = loadConfig({ argv: [], env: { ATRIUM_HERDR_SESSION: 'atrium-dev-p18-new', ATRIUM_DATA_DIR: 'C:/t/new', ATRIUM_LEGACY_HERDR_SESSION: 'atrium-dev-p18-old', ATRIUM_LEGACY_DATA_DIR: 'C:/t/old' } });
  assert.deepEqual(t.legacy, { terminalSession: 'atrium-dev-p18-old', dataDir: path.resolve('C:/t/old') });
  assert.equal(loadConfig({ argv: [], env: { ATRIUM_LEGACY_HERDR_SESSION: 'x' } }).legacy, null); // 하나만 주면 옮기지 않는다
  // 백엔드 자식에게 넘기는 값: 옮길 판을 그대로 넘기고, 없으면 빈 글(자식도 옮기지 않는다)
  const child = loadConfig({ argv: [], env: profileEnv(t) });
  assert.deepEqual(child.legacy, t.legacy);
  assert.equal(loadConfig({ argv: [], env: profileEnv(loadConfig({ argv: [], env: { ATRIUM_DATA_DIR: 'C:/t/d' } })) }).legacy, null);
  assert.deepEqual(loadConfig({ argv: [], env: profileEnv(real) }).legacy, real.legacy);
  // 창 프로필
  assert.equal(legacyAppUserData(real, {}), LEGACY_REAL.appUserData);
  assert.equal(legacyAppUserData(real, { ATRIUM_APP_USERDATA: 'C:/t/app' }), null);
  assert.equal(legacyAppUserData(real, { ATRIUM_APP_USERDATA: 'C:/t/app', ATRIUM_LEGACY_APP_USERDATA: 'C:/t/oldapp' }), path.resolve('C:/t/oldapp'));
  assert.equal(legacyAppUserData(loadConfig({ argv: ['--dev'], env: {} }), {}), null);
  assert.equal(legacyOf({ profile: 'dev' }, {}), null);
});

test('P18 경로 고치기: 역슬래시, 슬래시, JSON 두 역슬래시 꼴, 대소문자. 옛 플러그인 폴더 이름도. 비슷한 이름은 그대로', () => {
  const fix = pathFixer('C:\\Users\\u\\AppData\\Local\\multitask', 'C:\\Users\\u\\AppData\\Local\\atrium');
  assert.equal(fix('C:\\Users\\u\\AppData\\Local\\multitask\\sessions\\a.json'), 'C:\\Users\\u\\AppData\\Local\\atrium\\sessions\\a.json');
  assert.equal(fix('c:/users/u/appdata/local/multitask/sessions/a.json'), 'C:/Users/u/AppData/Local/atrium/sessions/a.json');
  const argv = JSON.stringify(['claude', '--resume', 'id', '--settings', 'C:/Users/u/AppData/Local/multitask/sessions/id.json', '--plugin-dir', 'C:/Users/u/AppData/Local/multitask/plugin/multitask-herdr', '--append-system-prompt-file', 'C:/Users/u/AppData/Local/multitask/plugin/board-system-prompt.md']);
  const out = JSON.parse(fix(argv));
  assert.equal(out[4], 'C:/Users/u/AppData/Local/atrium/sessions/id.json');
  assert.equal(out[6], 'C:/Users/u/AppData/Local/atrium/plugin/atrium'); // P132: 플러그인 이름 atrium
  assert.equal(out[8], 'C:/Users/u/AppData/Local/atrium/plugin/board-system-prompt.md');
  const json = JSON.stringify({ env: { MTASK_DATA_DIR: 'C:\\Users\\u\\AppData\\Local\\multitask' } });
  assert.equal(JSON.parse(fix(json)).env.MTASK_DATA_DIR, 'C:\\Users\\u\\AppData\\Local\\atrium');
  assert.equal(fix('C:/Users/u/AppData/Local/multitask-dev/x'), 'C:/Users/u/AppData/Local/multitask-dev/x');
  assert.equal(fix('C:/Workspace/multitask/plugin/multitask-herdr'), 'C:/Workspace/multitask/plugin/multitask-herdr'); // 다른 곳의 같은 이름
  assert.equal(fix(null), null);
});

function oldBoard(dir) {
  write(path.join(dir, 'board.db'), 'DB'); write(path.join(dir, 'board.db-wal'), 'WAL');
  write(path.join(dir, 'sessions', 's1.json'), '{}');
  write(path.join(dir, 'logs', 'backend.log'), 'old log'); write(path.join(dir, 'logs', 'backend.out'), 'old out');
  write(path.join(dir, 'plugin', 'multitask-herdr', 'skills', 'herdr', 'SKILL.md'), 'x');
}

test('P18 폴더 옮기기: 새 폴더가 없으면 통째로 이름 바꾼다', () => {
  const d = tmp(), a = path.join(d, 'multitask'), b = path.join(d, 'atrium');
  oldBoard(a);
  const r = moveDataDir(a, b);
  assert.equal(r.method, 'rename');
  assert.ok(!fs.existsSync(a)); assert.equal(fs.readFileSync(path.join(b, 'board.db'), 'utf8'), 'DB');
});

test('P18 폴더 옮기기: 새 폴더가 이미 있으면(창이 logs를 먼저 만든다) 항목마다 옮기고, 같은 이름은 .legacy로', () => {
  const d = tmp(), a = path.join(d, 'multitask'), b = path.join(d, 'atrium');
  oldBoard(a);
  write(path.join(b, 'logs', 'backend.out'), 'new out');
  const r = moveDataDir(a, b);
  assert.equal(r.method, 'merge'); assert.deepEqual(r.copied, []); assert.deepEqual(r.failed, []);
  assert.equal(r.leftover, false); assert.ok(!fs.existsSync(a));
  assert.equal(fs.readFileSync(path.join(b, 'logs', 'backend.out'), 'utf8'), 'new out');
  assert.equal(fs.readFileSync(path.join(b, 'logs', 'backend.legacy.out'), 'utf8'), 'old out');
  assert.equal(fs.readFileSync(path.join(b, 'board.db-wal'), 'utf8'), 'WAL');
  assert.ok(fs.existsSync(path.join(b, 'plugin', 'multitask-herdr', 'skills', 'herdr', 'SKILL.md')));
});

test('P18 폴더 옮기기: 옮기지 못하는 파일(잡혀 있음)은 복사하고 옛 폴더에 남는다', () => {
  const d = tmp(), a = path.join(d, 'multitask'), b = path.join(d, 'atrium');
  oldBoard(a);
  write(path.join(b, 'logs', 'backend.out'), 'new out'); // 새 백엔드 로그(창이 먼저 만든다)
  const busy = (x) => /board\.db$|backend\.log$|multitask$/.test(x); // 옛 폴더 자체, 판 기록, 로그 하나가 잡혀 있다
  const rename = (x, y) => { if (busy(x)) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); fs.renameSync(x, y); };
  const r = moveDataDir(a, b, { rename, retries: 1 });
  assert.equal(r.method, 'merge');
  assert.deepEqual(r.copied.sort(), ['board.db', 'logs/backend.log']);
  assert.equal(r.leftover, true);
  assert.equal(fs.readFileSync(path.join(b, 'board.db'), 'utf8'), 'DB'); // 복사본
  assert.ok(fs.existsSync(path.join(a, 'board.db'))); // 원본은 남는다
  assert.ok(!fs.existsSync(path.join(a, 'sessions'))); // 옮긴 것은 없다
});

test('P18 폴더 옮기기: 판 기록을 옮기지도 복사하지도 못하면 되돌리고 멈춘다(옛 판 그대로)', () => {
  const d = tmp(), a = path.join(d, 'multitask'), b = path.join(d, 'atrium');
  oldBoard(a);
  write(path.join(b, 'board.db-wal'), 'conflict'); // 새 폴더에 이미 있는 판 기록 조각
  assert.throws(() => moveDataDir(a, b, { retries: 1 }), (e) => e instanceof LegacyBlocked && e.code === 'data_move_failed');
  assert.equal(fs.readFileSync(path.join(a, 'board.db'), 'utf8'), 'DB'); // 되돌렸다
  assert.ok(!fs.existsSync(path.join(b, 'board.db')));
  assert.ok(fs.existsSync(path.join(a, 'sessions', 's1.json')));
});

function testCfg(d) {
  return loadConfig({ argv: [], env: { ATRIUM_HERDR_SESSION: 'atrium-dev-p18-new', ATRIUM_PORT: '47834', ATRIUM_DATA_DIR: path.join(d, 'new'), ATRIUM_LEGACY_HERDR_SESSION: 'atrium-dev-p18-old', ATRIUM_LEGACY_DATA_DIR: path.join(d, 'old') } });
}

test('P18 옮기기: 옛 백엔드를 끄지 못하면 옮기지 않고 멈춘다(다음에 다시)', async () => {
  const d = tmp(); const cfg = testCfg(d); oldBoard(cfg.legacy.dataDir);
  await assert.rejects(migrateLegacyData(cfg, { shutdown: async () => ({ stopped: false, pid: 1, error: 'busy' }) }), (e) => e instanceof LegacyBlocked && e.code === 'legacy_backend_running');
  assert.ok(fs.existsSync(path.join(cfg.legacy.dataDir, 'board.db'))); assert.ok(!fs.existsSync(cfg.dbFile));
});

test('P18 옮기기: 옛 판을 옮기고, 옛 폴더에 표시와 새 백엔드를 가리키는 backend.json. 다시 켜면 옮기지 않는다(P129: 옛 herdr 세션은 옮기지 않는다)', async () => {
  const d = tmp(); const cfg = testCfg(d); oldBoard(cfg.legacy.dataDir);
  let shut = 0;
  const r = await migrateLegacyData(cfg, { shutdown: async () => { shut++; return { stopped: true, pid: 123 }; } });
  assert.equal(r.data, 'moved'); assert.equal(r.move.method, 'rename');
  assert.equal(shut, 1);
  assert.equal('herdr' in r, false);
  assert.ok(fs.existsSync(cfg.dbFile));
  const mark = JSON.parse(fs.readFileSync(path.join(cfg.legacy.dataDir, MARKER), 'utf8'));
  assert.equal(mark.movedTo, cfg.dataDir);
  const tomb = JSON.parse(fs.readFileSync(path.join(cfg.legacy.dataDir, 'backend.json'), 'utf8'));
  assert.equal(tomb.pid, process.pid); assert.equal(tomb.port, 47834);
  // 다시 켬: 판 기록이 이미 있다
  const again = await migrateLegacyData(cfg, { shutdown: async () => { shut++; return { running: false }; } });
  assert.equal(again.data, 'already'); assert.equal(shut, 1);
});

test('P18 옮기기: 옛 판이 없으면 아무것도 하지 않는다', async () => {
  const d2 = tmp(); const cfg2 = testCfg(d2);
  const r2 = await migrateLegacyData(cfg2, { shutdown: async () => { throw new Error('부르면 안 된다'); } });
  assert.equal(r2.data, 'none');
  assert.equal(await migrateLegacyData(loadConfig({ argv: ['--dev'], env: {} })), null);
});

test('P18 옮기기: 복사로 옮겼으면 옛 폴더에 남은 원본이 있어도 표시 파일 때문에 다시 옮기지 않는다', async () => {
  const d = tmp(); const cfg = testCfg(d); oldBoard(cfg.legacy.dataDir);
  const rename = (x, y) => { if (/old$|board\.db$/.test(x)) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); fs.renameSync(x, y); };
  const r = await migrateLegacyData(cfg, { shutdown: async () => ({ running: false }), rename });
  assert.equal(r.move.method, 'merge'); assert.ok(r.move.copied.includes('board.db'));
  assert.ok(fs.existsSync(path.join(cfg.legacy.dataDir, 'board.db')));
  fs.rmSync(cfg.dbFile); // 새 판 기록이 없어져도
  const again = await migrateLegacyData(cfg, { shutdown: async () => { throw new Error('부르면 안 된다'); } });
  assert.equal(again.data, 'none');
});

test('P18 기록 고치기: 세션 행의 설정 파일·이어 가기 인자, 세션 설정 파일의 경로(P129: 패널 ID는 그대로)', async () => {
  const d = tmp(); const cfg = testCfg(d); oldBoard(cfg.legacy.dataDir);
  fs.rmSync(path.join(cfg.legacy.dataDir, 'board.db')); fs.rmSync(path.join(cfg.legacy.dataDir, 'board.db-wal'));
  const old = cfg.legacy.dataDir, slash = (p) => p.split(path.sep).join('/');
  const st0 = new Store(path.join(old, 'board.db'));
  const row = (id, extra = {}) => ({ sessionId: id, name: id, cwd: 'C:/w', permissionMode: 'default', createdAt: 1, paneId: `w1:p${id.length}`, settingsPath: slash(path.join(old, 'sessions', `${id}.json`)), hookToken: 't', resumeArgv: ['claude', '--resume', id, '--settings', slash(path.join(old, 'sessions', `${id}.json`)), '--plugin-dir', slash(path.join(old, 'plugin', 'multitask-herdr'))], ...extra });
  st0.insertSession(row('a')); st0.insertSession(row('bb')); st0.insertSession(row('closed'));
  st0.updateSession('closed', { closedAt: 5 });
  st0.close();
  write(path.join(old, 'sessions', 'a.json'), JSON.stringify({ env: { MTASK_DATA_DIR: old } }));
  const mig = await migrateLegacyData(cfg, { shutdown: async () => ({ running: false }) });
  const store = new Store(cfg.dbFile);
  try {
    const fixed = fixLegacyRecords(store, cfg, mig);
    assert.equal(fixed.sessions, 3); assert.equal(fixed.settingsFiles, 1); assert.equal('panes' in fixed, false);
    const a = store.getSession('a');
    assert.equal(a.settingsPath, slash(path.join(cfg.dataDir, 'sessions', 'a.json')));
    assert.equal(a.resumeArgv[4], a.settingsPath); assert.equal(a.resumeArgv[6], slash(path.join(cfg.dataDir, 'plugin', 'atrium')));
    assert.equal(a.paneId, 'w1:p1');
    assert.equal(store.getSession('closed').paneId, 'w1:p6');
    assert.equal(JSON.parse(fs.readFileSync(path.join(cfg.sessionsDir, 'a.json'), 'utf8')).env.MTASK_DATA_DIR, cfg.dataDir);
    assert.equal(store.getMeta('renamedFrom').from, old);
  } finally { store.close(); }
});

test('P18 옛 백엔드 끄기: backend.json의 pid가 살아 있으면 backend.shutdown으로 끄고 꺼질 때까지 기다린다', async () => {
  const d = tmp();
  const script = path.join(d, 'fake-backend.mjs');
  // 가짜 옛 백엔드: /health와 WebSocket backend.shutdown만 한다
  fs.writeFileSync(script, `
import http from 'node:http'; import fs from 'node:fs';
import { WebSocketServer } from ${JSON.stringify(path.join(HERE, '..', 'node_modules', 'ws', 'wrapper.mjs').split(path.sep).join('/').replace(/^([A-Za-z]):/, 'file:///$1:'))};
const srv = http.createServer((q, s) => { s.end(JSON.stringify({ ok: true })); });
const wss = new WebSocketServer({ noServer: true });
srv.on('upgrade', (q, so, h) => wss.handleUpgrade(q, so, h, (ws) => ws.on('message', (m) => { const { id, method } = JSON.parse(m); ws.send(JSON.stringify({ id, result: { ok: true } })); if (method === 'backend.shutdown') setTimeout(() => process.exit(0), 300); })));
srv.listen(0, '127.0.0.1', () => fs.writeFileSync(process.argv[2], JSON.stringify({ pid: process.pid, port: srv.address().port, token: 'tok' })));
`);
  const bj = path.join(d, 'backend.json');
  const p = spawn(process.execPath, [script, bj], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 100 && !fs.existsSync(bj); i++) await new Promise((r) => setTimeout(r, 50));
    const r = await shutdownLegacyBackend(d);
    assert.equal(r.stopped, true); assert.equal(r.pid, p.pid);
    assert.deepEqual(await shutdownLegacyBackend(d), { running: false }); // 이미 꺼졌다
    assert.deepEqual(await shutdownLegacyBackend(path.join(d, 'none')), { running: false });
  } finally { try { p.kill(); } catch {} }
});
