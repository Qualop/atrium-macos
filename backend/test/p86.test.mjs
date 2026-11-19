// P86 단위 시험: 웹 화면 보드의 단계 기록(boot 줄의 crash.steps)과 보드 단계(boot 줄의 level, level 줄). 정한 필드만 남고(글·화면 내용 없음),
// web.level은 기기 연결 하나에 한 번, 이 PC 연결은 부르지 못한다. 연결 기록 CLI 글. 이름과 주소는 예시(100.64.0.x)만 쓴다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { WebServer } from '../src/web.mjs';
import { logEntry, LOG_EVENTS } from '../src/remote-log.mjs';
import { crashInfo, stepsInfo, stepsLabel, crashLabel, STEP_MAX } from '../src/web-crash.mjs';
import { formatLogEntry } from '../bin/atrium-remote.mjs';

const STEPS = [
  { s: 'open', t: 1200, in: 0 },
  { s: 'msg', t: 1310, k: 'board.get', b: 26401 },
  { s: 'board', t: 1320, n: 36, ss: 6, cv: 30, l: 0, ws: 3 },
  { s: 'term', t: 1500, c: 175, r: 33, cw: 8.40625, ch: 18, z: 1 },
  { s: 'msg', t: 1700, k: 'terminal.history', b: 62080 },
  { s: 'fw0', t: 1720, b: 57197, c: 175, r: 33 },
];

test('stepsInfo: 이름, ms, 숫자, 종류 이름(k)만. 마지막 STEP_MAX개', () => {
  const s = stepsInfo([...STEPS, { s: 'x', t: 5, title: 'secret', k: 'has space', text: 'ls' }, { s: 'Bad', t: 1 }, null, 'x']);
  assert.equal(s.length, 7);
  assert.deepEqual(s[3], { s: 'term', t: 1500, c: 175, r: 33, cw: 8.406, ch: 18, z: 1 });
  assert.deepEqual(s[6], { s: 'x', t: 5 });
  assert.ok(!JSON.stringify(s).includes('secret') && !JSON.stringify(s).includes('ls'));
  const many = stepsInfo(Array.from({ length: 30 }, (_, i) => ({ s: 'msg', t: i, b: i })));
  assert.equal(many.length, STEP_MAX); assert.equal(many[0].b, 30 - STEP_MAX);
  assert.equal(stepsInfo([]), null); assert.equal(stepsInfo({}), null);
  assert.equal(stepsInfo([{ s: 'a', t: -5, n: 1e12 }])[0].t, undefined); // 이상한 값은 버린다
});

test('crashInfo: level(1~4)과 steps를 더한다', () => {
  const c = crashInfo({ view: 'board', terms: 0, dpr: 3, up: 900, level: 2, steps: STEPS });
  assert.equal(c.level, 2);
  assert.equal(c.steps.length, STEPS.length);
  assert.equal(crashInfo({ view: 'board', level: 0 }).level, undefined);
  assert.equal(crashInfo({ view: 'board', level: 9 }).level, undefined);
  assert.equal(crashInfo({ view: 'board', level: '2' }).level, undefined);
  assert.equal(crashLabel(c), 'board · 0 term · dpr 3 · 0.9s · L2');
});

test('logEntry: boot 줄의 level(이 부팅의 단계)과 level 줄', () => {
  assert.ok(LOG_EVENTS.includes('level'));
  const e = logEntry('boot', { deviceId: 'dev-1', crashed: true, level: 3, crash: { view: 'board', steps: STEPS, level: 2 } }, 1000);
  assert.equal(e.level, 3); assert.equal(e.crash.level, 2); assert.equal(e.crash.steps.length, 6);
  const l = logEntry('level', { deviceId: 'dev-1', level: 1, text: 'x' }, 1000);
  assert.deepEqual(Object.keys(l).sort(), ['at', 'deviceId', 'event', 'level']);
  assert.equal(logEntry('level', { level: 7 }, 1).level, undefined);
});

test('web.level: 기기 연결 하나에 한 번, 이 PC 연결은 막는다. web.boot는 level을 남긴다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p86-'));
  const store = new Store(path.join(dir, 'board.db'));
  const tailscale = { status: () => null, on: () => {}, off: () => {}, stop: () => {} };
  const web = new WebServer({ cfg: { port: 1, dataDir: dir, profile: 'dev', terminalSession: 'atrium-dev-test' }, store, api: null, tailscale, settings: () => ({ remoteAccess: true }) });
  try {
    const H = web.handlers();
    const dev = () => ({ auth: { kind: 'device', device: { id: 'dev-1', name: 'iPhone' }, meta: { remote: true, addr: '100.64.0.2', browser: 'Safari 18 · iOS' }, tsNode: { id: 'n1', name: 'phone-a' } } });
    assert.throws(() => H['web.level']({ level: 1 }, { auth: { kind: 'local' } }), (e) => e.code === 'forbidden');
    const c = dev();
    assert.deepEqual(H['web.level']({ level: 'x' }, c), { logged: false });
    assert.deepEqual(H['web.level']({ level: 2, why: 'alive' }, c), { logged: true });
    assert.deepEqual(H['web.level']({ level: 3 }, c), { logged: false }); // 같은 연결은 한 번
    assert.deepEqual(H['web.boot']({ crashed: true, level: 2, crash: { view: 'board', level: 1, steps: STEPS } }, dev()), { logged: true });
    const rows = web.remoteLog.list({ limit: 10 });
    const lv = rows.filter((e) => e.event === 'level'); const bt = rows.filter((e) => e.event === 'boot');
    assert.equal(lv.length, 1); assert.equal(lv[0].level, 2); assert.equal(lv[0].node, 'phone-a');
    assert.equal(bt.length, 1); assert.equal(bt[0].level, 2); assert.equal(bt[0].crash.steps.length, 6);
  } finally { web.stop(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('연결 기록 글: 마지막 단계와 보드 단계(CLI 한 줄)', () => {
  assert.equal(stepsLabel(stepsInfo(STEPS.slice(0, 2))), 'open in 0 1.2s › msg board.get 26K 1.3s');
  assert.equal(stepsLabel(null), '');
  const line = formatLogEntry({ at: Date.UTC(2026, 10, 7, 10, 0, 0), event: 'boot', deviceId: 'dev-12345678', deviceName: 'iPhone', crashed: true, level: 2, crash: { view: 'board', terms: 0, dpr: 3, up: 900, level: 1, steps: stepsInfo(STEPS) } });
  assert.match(line, /닫히기 전=board · 0 term · dpr 3 · 0\.9s · L1/);
  assert.match(line, /보드 단계=2/);
  assert.match(line, /마지막 단계=open in 0 1\.2s › msg board\.get 26K 1\.3s › board .* › term 175x33 cw 8\.406 ch 18 z 1 1\.5s › msg terminal\.history 62K 1\.7s › fw0 57K 175x33 1\.7s/);
  assert.match(formatLogEntry({ at: 1, event: 'level', deviceId: 'dev-12345678', level: 1 }), /보드 단계 기억.*보드 단계=1/);
});
