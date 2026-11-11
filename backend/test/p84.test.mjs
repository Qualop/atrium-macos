// P84 단위 시험: 웹 화면이 정상 떠남 없이 다시 읽힌 뒤의 boot 기록. 정한 필드만 남고(글·화면 내용 없음), 기기 연결 하나에 한 번만,
// 이 PC 연결(판 API 토큰)은 부르지 못한다. 연결 기록 화면(CLI)의 글. 이름과 주소는 예시(pc.example.ts.net, 100.64.0.x)만 쓴다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { WebServer } from '../src/web.mjs';
import { logEntry, RemoteLog, LOG_EVENTS } from '../src/remote-log.mjs';
import { crashInfo, crashLabel } from '../src/web-crash.mjs';
import { formatLogEntry } from '../bin/atrium-remote.mjs';

test('crashInfo: 정한 숫자와 짧은 코드만, 모양이 다르면 버린다', () => {
  const c = crashInfo({ ago: 1234.4, up: 6000, view: 'board', terms: 3, px: 9.4e6, atlas: 262144, gl: 3, dpr: 3, inB: 350000, boots: 2, hidden: false, light: true, retry: true, text: 'secret', screen: 'ls', title: 'x' });
  assert.deepEqual(c, { ago: 1234, up: 6000, terms: 3, px: 9.4e6, atlas: 262144, gl: 3, inB: 350000, boots: 2, view: 'board', dpr: 3, light: true, retry: true });
  assert.equal(crashInfo({ view: 'secret text', dpr: 99, terms: -1, px: 'big' }), null);
  assert.equal(crashInfo(null), null);
  assert.equal(crashInfo('x'), null);
  assert.equal(crashInfo({ terms: 5000 }).terms, 999);
  assert.equal(crashInfo({ dpr: 2.6666 }).dpr, 2.67);
});

test('logEntry: boot 줄은 crashed, light, crash만 더한다', () => {
  assert.ok(LOG_EVENTS.includes('boot'));
  const e = logEntry('boot', { deviceId: 'dev-1', deviceName: 'iPhone', remote: true, addr: '100.64.0.2', browser: 'Safari 18 · iOS', crashed: true, light: true, crash: { view: 'board', terms: 1, px: 1e7, gl: 1, dpr: 3, up: 5800, text: 'hello' }, text: 'nope', screen: 'nope' }, 1000);
  assert.deepEqual(Object.keys(e).sort(), ['addr', 'at', 'browser', 'crash', 'crashed', 'deviceId', 'deviceName', 'event', 'light', 'remote'].sort());
  assert.equal(e.crashed, true);
  assert.equal(e.light, true);
  assert.deepEqual(e.crash, { up: 5800, terms: 1, px: 1e7, gl: 1, view: 'board', dpr: 3 });
  // crashed·light가 true가 아니면 남지 않는다
  const f = logEntry('boot', { crashed: 'yes', light: 1 }, 1000);
  assert.equal(f.crashed, undefined); assert.equal(f.light, undefined);
  // 다른 줄에는 crash가 없다(보내도 무시되지는 않지만 web.mjs만 boot에 넣는다)
  const g = logEntry('connect', { deviceId: 'dev-1' }, 1000);
  assert.equal(g.crash, undefined);
});

test('RemoteLog: boot 줄은 합치지 않고 파일에서 다시 읽어도 같다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p84-'));
  const file = path.join(dir, 'remote-log.jsonl');
  let t = 1000;
  const log = new RemoteLog({ file, now: () => t });
  log.add('boot', { deviceId: 'dev-1', crashed: true, crash: { view: 'board', terms: 1, dpr: 3 } });
  t += 3000;
  log.add('boot', { deviceId: 'dev-1', crashed: true, light: true, crash: { view: 'board', terms: 1, dpr: 3, boots: 2 } });
  log.flush();
  const again = new RemoteLog({ file, now: () => t });
  const rows = again.list({ limit: 10 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].light, true);
  assert.equal(rows[0].crash.boots, 2);
  assert.equal(rows[1].light, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('web.boot: 기기 연결 하나에 한 번, crashed가 아니면 남기지 않는다, 이 PC 연결은 막는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p84-'));
  const store = new Store(path.join(dir, 'board.db'));
  const tailscale = { status: () => null, on: () => {}, off: () => {}, stop: () => {} };
  const web = new WebServer({ cfg: { remoteEnabled: true, port: 1, dataDir: dir, profile: 'dev', herdrSession: 'atrium-dev-test' }, store, api: null, tailscale, settings: () => ({ remoteAccess: true }) });
  try {
    const h = web.handlers()['web.boot'];
    const dev = { auth: { kind: 'device', device: { id: 'dev-1', name: 'iPhone' }, meta: { remote: true, addr: '100.64.0.2', browser: 'Safari 18 · iOS', login: 'user@example.com' }, tsNode: { id: 'n1', name: 'phone-a' } } };
    assert.throws(() => h({ crashed: true }, { auth: { kind: 'local' } }), (e) => e.code === 'forbidden');
    assert.deepEqual(h({ crashed: false }, dev), { logged: false });
    assert.deepEqual(h({ crashed: true, light: true, crash: { view: 'board', terms: 2, px: 2e6, gl: 2, dpr: 3, up: 6000, text: 'secret' } }, dev), { logged: true });
    assert.deepEqual(h({ crashed: true, crash: { view: 'list' } }, dev), { logged: false }); // 같은 연결은 한 번만
    const rows = web.remoteLog.list({ limit: 10 }).filter((e) => e.event === 'boot');
    assert.equal(rows.length, 1);
    const e = rows[0];
    assert.equal(e.crashed, true); assert.equal(e.light, true); assert.equal(e.deviceId, 'dev-1'); assert.equal(e.node, 'phone-a');
    assert.deepEqual(e.crash, { up: 6000, terms: 2, px: 2e6, gl: 2, view: 'board', dpr: 3 });
    assert.ok(!JSON.stringify(e).includes('secret'));
  } finally { web.stop(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('연결 기록 글: crashLabel과 CLI 한 줄', () => {
  assert.equal(crashLabel({ view: 'board', terms: 3, px: 2e6, atlas: 1e5, gl: 3, dpr: 3, up: 6000 }), 'board · 3 term · 2.1M px · gl 3 · dpr 3 · 6.0s');
  assert.equal(crashLabel({ view: 'list', terms: 0, up: 65000, hidden: true }), 'list · 0 term · 65s · hidden');
  assert.equal(crashLabel(null), '');
  const line = formatLogEntry({ at: Date.UTC(2026, 10, 7, 10, 0, 0), event: 'boot', deviceId: 'dev-12345678', deviceName: 'iPhone', crashed: true, light: true, crash: { view: 'board', terms: 1, px: 1e7, gl: 1, dpr: 3, up: 5800, ago: 1200, inB: 350000, boots: 2, retry: true } });
  assert.match(line, /화면이 닫힌 뒤 다시 열림/);
  assert.match(line, /가벼운 화면으로 열림/);
  assert.match(line, /닫히기 전=board · 1 term · 10\.0M px · gl 1 · dpr 3 · 5\.8s 다시 열기까지 1\.2s 받음 350000B 이어 닫힘 2번 보드로 다시 연 뒤/);
});
