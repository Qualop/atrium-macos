// P40: herdr 찾기(순서, 후보 확인), 도는 서버의 실행 파일, 버전 정책, 패널 PATH, 업데이트 감지, herdr 없음에서 세션 띄우기 막기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { herdrCandidates, discoverHerdr, parseHerdrVersion, compareVersions, herdrServerExe, withPathFirst, herdrCompat, updateNotice, parseWhere } from '../src/herdr/discover.mjs';
import { loadConfig, HERDR_PROTOCOLS, HERDR_TESTED } from '../src/config.mjs';
import { normalizePatch, DEFAULTS } from '../src/settings.mjs';
import { Backend } from '../src/backend.mjs';
import { HerdrAdapter } from '../src/herdr/adapter.mjs';

// 시험용 가짜 이름(실제 사용자 경로를 쓰지 않는다)
const HOME = 'D:\\fakehome\\tester';
const LAD = 'D:\\fakehome\\tester\\AppData\\Local';
const CUR = path.join(HOME, '.herdr', 'packages', 'standalone', 'current', 'herdr.exe');
const WIN = path.join(LAD, 'Programs', 'Herdr', 'bin', 'herdr.exe');
const ENVP = 'D:\\tools\\herdr-env\\herdr.exe';
const SETP = 'D:\\tools\\herdr-set\\herdr.exe';
const PATHP = 'D:\\bin\\herdr.exe';

// 가짜 io: files의 경로만 있고, versions[경로]가 --version 출력(null이면 실행 안 됨)
function io(files, versions = {}) {
  const set = new Set(files.map((f) => path.resolve(f).toLowerCase()));
  const calls = [];
  return {
    calls,
    exists: (p) => set.has(path.resolve(p).toLowerCase()),
    version: async (p) => { calls.push(p); return p in versions ? versions[p] : 'herdr 0.9.5\n'; },
  };
}
const base = { platform: 'win32', home: HOME, localAppData: LAD };

test('P40 찾기: 순서는 ATRIUM_HERDR, 설정, 설치기 current, PATH, 알려진 폴더(같은 경로는 한 번)', () => {
  const c = herdrCandidates({ ...base, envPath: ENVP, settingPath: SETP, wherePaths: [PATHP, CUR], releases: ['0.9.4-x86_64-pc-windows-msvc', '0.9.10-x86_64-pc-windows-msvc', 'junk'] });
  assert.deepEqual(c.map((x) => x.source), ['env', 'setting', 'installer', 'path', 'known', 'known', 'known', 'known']);
  assert.equal(c[0].path, ENVP); assert.equal(c[1].path, SETP); assert.equal(c[2].path, CUR); assert.equal(c[3].path, PATHP);
  assert.equal(c[4].path, WIN);
  assert.match(c[5].path, /0\.9\.10-/); // 버전 폴더는 새 것부터
  assert.match(c[6].path, /0\.9\.4-/);
  assert.ok(!c.some((x) => /junk/.test(x.path)));
  assert.equal(c.filter((x) => x.path === CUR).length, 1); // PATH에 있는 current는 한 번만
  // 비운 단계는 빠진다
  assert.deepEqual(herdrCandidates({ platform: 'win32' }).map((x) => x.source), []);
});

test('P40 찾기: 각 단계가 있을 때 그것을 고른다', async () => {
  const all = [ENVP, SETP, CUR, PATHP, WIN];
  for (const [files, want] of [[all, 'env'], [all.slice(1), 'setting'], [all.slice(2), 'installer'], [all.slice(3), 'path'], [all.slice(4), 'known']]) {
    const r = await discoverHerdr({ ...base, envPath: ENVP, settingPath: SETP, wherePaths: [PATHP] }, io(files));
    assert.equal(r.source, want);
    assert.equal(r.version, '0.9.5');
    assert.ok(r.tried.at(-1).ok);
    assert.ok(r.tried.slice(0, -1).every((t) => !t.ok && t.error === 'not_found'));
  }
});

test('P40 찾기: 없거나 실행 안 되는 후보는 건너뛰고 까닭을 남긴다. 다 없으면 path null', async () => {
  const x = io([ENVP, SETP, CUR], { [ENVP]: null, [SETP]: 'garbage output' });
  const r = await discoverHerdr({ ...base, envPath: ENVP, settingPath: SETP }, x);
  assert.equal(r.source, 'installer');
  assert.deepEqual(r.tried.slice(0, 2).map((t) => t.error), ['not_runnable', 'no_version']);
  const none = await discoverHerdr({ ...base, envPath: 'Z:\\nope\\herdr.exe', wherePaths: [] }, io([]));
  assert.equal(none.path, null);
  assert.ok(none.tried.length >= 3 && none.tried.every((t) => t.error === 'not_found'));
  // exists가 던져도 멈추지 않는다
  const bad = await discoverHerdr({ envPath: ENVP }, { exists: () => { throw new Error('x'); }, version: async () => 'herdr 1.0.0' });
  assert.equal(bad.path, null);
});

test('P40 찾기: 버전 읽기와 비교, where 출력', () => {
  assert.equal(parseHerdrVersion('herdr 0.9.5\r\n'), '0.9.5');
  assert.equal(parseHerdrVersion('herdr v1.2.3-beta.1'), '1.2.3-beta.1');
  assert.equal(parseHerdrVersion('0.9.6-x86_64-pc-windows-msvc'), '0.9.6');
  assert.equal(parseHerdrVersion(''), null);
  assert.equal(parseHerdrVersion(null), null);
  assert.ok(compareVersions('0.9.10', '0.9.5') > 0);
  assert.ok(compareVersions('0.9.5', '0.10.0') < 0);
  assert.equal(compareVersions('0.9.5', '0.9.5'), 0);
  assert.deepEqual(parseWhere(`${PATHP}\r\n${WIN}\r\n\r\n`), [PATHP, WIN]);
});

test('P40 도는 서버: 그 세션의 server 프로세스 실행 파일을 고른다', () => {
  const procs = [
    { pid: 10, exe: 'C:\\h\\0.9.5\\herdr.exe', cmd: 'C:\\h\\0.9.5\\herdr.exe --session other server' },
    { pid: 11, exe: 'C:\\h\\0.9.4\\herdr.exe', cmd: '"C:\\h\\0.9.4\\herdr.exe" --session atrium-dev-x server' },
    { pid: 12, exe: 'C:\\h\\0.9.6\\herdr.exe', cmd: 'herdr.exe --session atrium-dev-x server stop' },
    { pid: 13, exe: 'C:\\h\\0.9.6\\herdr.exe', cmd: 'herdr.exe --session atrium-dev-x terminal session control w1 --takeover' },
    { pid: 14, exe: 'C:\\h\\0.9.7\\herdr.exe', cmd: 'herdr.exe --session atrium-dev-x server' },
  ];
  assert.equal(herdrServerExe(procs, 'atrium-dev-x'), 'C:\\h\\0.9.4\\herdr.exe');
  assert.equal(herdrServerExe(procs, 'atrium-dev-x', 14), 'C:\\h\\0.9.7\\herdr.exe'); // 서버 PID가 있으면 그것
  assert.equal(herdrServerExe(procs, 'nobody'), null);
  assert.equal(herdrServerExe([{ pid: 1, exe: null, cmd: '"C:\\a b\\herdr.exe" --session s server' }], 's'), 'C:\\a b\\herdr.exe'); // 실행 파일을 못 읽으면 명령 줄 첫 낱말
  assert.equal(herdrServerExe(null, 's'), null);
});

test('P40 버전 정책: 같은 버전, 프로토콜 같고 버전 다름, 프로토콜 다름, 응답 없음', () => {
  const pol = { protocols: [22], tested: ['0.9.5'] };
  const caps = { a: true };
  const same = herdrCompat({ version: '0.9.5', protocol: 22, capabilities: caps }, pol);
  assert.equal(same.ok, true); assert.equal(same.level, 'ok'); assert.equal(same.warning, null);
  const untested = herdrCompat({ version: '0.9.6', protocol: 22, capabilities: caps }, pol);
  assert.equal(untested.ok, true); assert.equal(untested.level, 'untested');
  assert.match(untested.warning, /검증하지 않은 herdr 버전 0\.9\.6\(프로토콜 22\)/);
  const other = herdrCompat({ version: '0.9.5', protocol: 23, capabilities: caps }, pol);
  assert.equal(other.ok, false); assert.equal(other.level, 'incompatible'); assert.match(other.problems[0], /protocol 23/);
  const nocaps = herdrCompat({ version: '0.9.5', protocol: 22 }, pol);
  assert.equal(nocaps.ok, false);
  const none = herdrCompat(null, pol);
  assert.equal(none.ok, false); assert.equal(none.level, 'none');
  // 어댑터도 같은 정책을 쓴다
  const a = new HerdrAdapter({ herdrPath: null, session: 'unit-p40', logDir: '.', protocols: [21, 22], tested: ['0.9.4'] });
  assert.equal(a.checkCompat({ version: '0.9.5', protocol: 21, capabilities: caps }).level, 'untested');
});

test('P40 설정: 지원 프로토콜·시험한 버전 목록과 시험용 덮기, herdr 경로 설정', () => {
  assert.deepEqual(HERDR_PROTOCOLS, [22]);
  assert.deepEqual(HERDR_TESTED, ['0.9.5']);
  const c = loadConfig({ argv: ['--dev'], env: { ATRIUM_HERDR_SESSION: 'atrium-dev-unit', ATRIUM_HERDR_PROTOCOLS: '21, 22,x', ATRIUM_HERDR_TESTED: '0.9.4,0.9.5' } });
  assert.deepEqual(c.herdrProtocols, [21, 22]);
  assert.deepEqual(c.herdrTested, ['0.9.4', '0.9.5']);
  assert.equal(c.herdrEnvPath, ''); // no explicit override; bundled fallback is allowed
  const d = loadConfig({ argv: ['--dev'], env: { ATRIUM_HERDR_SESSION: 'atrium-dev-unit', ATRIUM_HERDR: ENVP } });
  assert.equal(d.herdrEnvPath, ENVP);
  assert.equal(DEFAULTS.herdrPath, '');
  assert.deepEqual(normalizePatch({ herdrPath: `  ${SETP} ` }), { herdrPath: SETP });
});

test('P40 패널 PATH: 서버 env의 PATH 맨 앞에 herdr 폴더(대소문자 무시, 같은 폴더는 뒤에서 뺀다)', () => {
  const env = { Path: 'C:\\Windows\\System32;D:\\HERDR\\bin\\;C:\\x', Other: '1' };
  const out = withPathFirst(env, 'D:\\herdr\\bin', 'win32');
  assert.equal(out.Path, 'D:\\herdr\\bin;C:\\Windows\\System32;C:\\x');
  assert.equal(out.Other, '1');
  assert.equal(env.Path, 'C:\\Windows\\System32;D:\\HERDR\\bin\\;C:\\x'); // 원본은 그대로
  assert.equal(withPathFirst({}, 'D:\\h').PATH, 'D:\\h');
  assert.deepEqual(withPathFirst({ PATH: 'a' }, ''), { PATH: 'a' });
  const two = withPathFirst({ PATH: 'C:\\a', Path: 'C:\\b' }, 'D:\\h'); // 키가 둘이면 하나로
  assert.equal(Object.keys(two).filter((k) => k.toUpperCase() === 'PATH').length, 1);
});

test('P40 업데이트 감지: 찾기 결과가 서버보다 새 버전일 때만 알린다', () => {
  assert.equal(updateNotice({ serverVersion: '0.9.5', found: { version: '0.9.5', path: CUR } }), null);
  assert.equal(updateNotice({ serverVersion: '0.9.5', found: { version: '0.9.4', path: CUR } }), null);
  assert.equal(updateNotice({ serverVersion: null, found: { version: '0.9.6' } }), null);
  assert.equal(updateNotice({ serverVersion: '0.9.5', found: { path: null } }), null);
  const n = updateNotice({ serverVersion: '0.9.5', found: { version: '0.9.6', path: CUR, source: 'installer' } });
  assert.equal(n.version, '0.9.6'); assert.equal(n.serverVersion, '0.9.5');
  assert.match(n.message, /새 herdr 0\.9\.6.*0\.9\.5/);
});

// 백엔드 메서드만 떼어 본다(서버를 띄우지 않는다)
function fakeBackend(over = {}) {
  const b = Object.create(Backend.prototype);
  const events = [];
  Object.assign(b, {
    cfg: { herdrSession: 'atrium-dev-unit', herdrProtocols: [22], herdrTested: ['0.9.5'], herdrEnvPath: '' },
    store: { addEvent: (...a) => events.push(a), getMeta: () => ({}) },
    log: () => {}, api: { broadcast: () => {} },
    adapter: { herdrPath: null, connected: false, probe: async () => ({ running: false }), serverPid: () => null, startServer: async () => { throw new Error('should not start'); } },
    herdrFind: { tried: [{ source: 'env', path: ENVP, ok: false, error: 'not_found' }, { source: 'path', path: PATHP, ok: false, error: 'not_found' }] },
    events, ...over,
  });
  return b;
}

test('P40 herdr 없음: 서버를 띄우지 않고 바로 missing, 세션 띄우기는 까닭과 함께 막는다', async () => {
  const b = fakeBackend();
  const t0 = Date.now();
  const c = await b.ensureHerdr();
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(c.level, 'missing'); assert.equal(b.herdrOk, false);
  assert.ok(b.events.some((e) => e[1] === 'herdr_missing'));
  assert.throws(() => b.requireHerdr(), (e) => e.code === 'herdr_missing' && e.key === 'herdrMissing' && e.vars.n === 2 && /herdr\.dev/.test(e.message));
  await assert.rejects(b.spawn({ cwd: '.' }), (e) => e.code === 'herdr_missing'); // 세션 띄우기(레일, 새 세션 창, 런처, CLI가 모두 session.spawn)
  const v = b.herdrView();
  assert.equal(v.level, 'missing'); assert.ok(v.missing); assert.equal(v.find.tried.length, 2);
});

test('P40 herdr 없음: 실행 파일이 실행되지 않아 서버가 안 뜨면 던지지 않고 missing', async () => {
  const b = fakeBackend();
  b.adapter.herdrPath = 'Z:\\gone\\herdr.exe';
  b.adapter.startServer = async () => { throw Object.assign(new Error('server: spawn_failed: ENOENT'), { code: 'spawn_failed', herdrMessage: 'ENOENT' }); };
  const c = await b.ensureHerdr();
  assert.equal(c.level, 'missing');
  assert.equal(b.herdrMissing.reason, 'spawn_failed');
  assert.throws(() => b.requireHerdr(), (e) => e.code === 'herdr_missing');
});

test('P40 버전 정책(백엔드): 프로토콜이 다르면 세션 띄우기만 막고, 시험하지 않은 버전은 붙되 이벤트로 알린다', async () => {
  const caps = { x: 1 };
  const inc = fakeBackend();
  inc.adapter = { ...inc.adapter, connected: true, probe: async () => ({ running: true, pong: { version: '0.9.5', protocol: 23, capabilities: caps } }), checkCompat: (p) => herdrCompat(p, { protocols: [22], tested: ['0.9.5'] }) };
  await inc.ensureHerdr();
  assert.equal(inc.herdrOk, false);
  assert.throws(() => inc.requireHerdr(), (e) => e.code === 'herdr_incompatible' && e.key === 'herdrIncompatible' && e.vars.protocol === 23 && e.vars.supported === '22');
  assert.ok(inc.events.some((e) => e[1] === 'herdr_incompatible'));
  const un = fakeBackend();
  un.adapter = { ...un.adapter, connected: true, probe: async () => ({ running: true, pong: { version: '0.9.6', protocol: 22, capabilities: caps } }), checkCompat: (p) => herdrCompat(p, { protocols: [22], tested: ['0.9.5'] }) };
  await un.ensureHerdr();
  assert.equal(un.herdrOk, true);
  assert.doesNotThrow(() => un.requireHerdr());
  assert.equal(un.herdrView().level, 'untested');
  assert.equal(un.events.filter((e) => e[1] === 'herdr_untested').length, 1);
  un.setHerdrCompat(un.herdrCompat); // 같은 결과는 한 번만 알린다
  assert.equal(un.events.filter((e) => e[1] === 'herdr_untested').length, 1);
});

test('P40 herdr 없음(어댑터): 없는 실행 파일로 서버를 띄우면 15초를 기다리지 않고 spawn_failed', async () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p40-unit-'));
  try {
    const a = new HerdrAdapter({ herdrPath: path.join(logDir, 'no-such', 'herdr.exe'), session: 'mtask-p40-unit-nope', logDir });
    const t0 = Date.now();
    await assert.rejects(a.startServer(), (e) => ['spawn_failed', 'start_failed'].includes(e.code));
    assert.ok(Date.now() - t0 < 5000);
    const none = new HerdrAdapter({ herdrPath: null, session: 'mtask-p40-unit-nope', logDir });
    await assert.rejects(none.startServer(), (e) => e.code === 'not_found');
    assert.equal(await none.cliVersion(), null);
    assert.equal(await none.skillText(), null); // 글 읽기는 실패하면 기본값으로 넘어간다
    assert.deepEqual(await none.agentKinds(), []);
  } finally { fs.rmSync(logDir, { recursive: true, force: true }); }
});

test('P40 workspace environment preserves provider settings and fails closed if the engine rejects them', async () => {
  const exe = process.platform === 'win32' ? 'D:\\tools\\herdr.exe' : '/tools/herdr';
  const a = new HerdrAdapter({ herdrPath: exe, session: 'atrium-dev-p40-unit-ws', logDir: '.' });
  a.paneEnv = async () => ({ PATH: process.platform === 'win32' ? 'D:\\tools;C:\\Windows' : '/tools:/usr/bin' });
  const sent=[];a.call=async(_method,p)=>{sent.push(p);return {workspace:{workspace_id:'w'},root_pane:{pane_id:'p'}};};
  await a.createWorkspace({cwd:'.',label:'x',env:{ATRIUM_SESSION_ID:'managed'}});
  assert.equal(sent[0].env.ATRIUM_SESSION_ID,'managed');
  a.call=async()=>{throw Object.assign(new Error('unsupported env'),{code:'invalid_params'});};
  await assert.rejects(a.createWorkspace({cwd:'.',env:{ATRIUM_SESSION_ID:'managed'}}),{code:'invalid_params'});
});
