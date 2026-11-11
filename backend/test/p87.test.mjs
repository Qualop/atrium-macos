// P87 단위 시험: 같은 죽음 기록(id: 죽은 페이지의 부팅 시각)은 연결이 바뀌어도 연결 기록에 한 번만 남는다(web.boot).
// 휴대폰은 답을 받기 전에 소켓이 끊기면(P82) 다시 붙은 연결로 같은 기록을 또 보낸다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { WebServer } from '../src/web.mjs';
import { RemoteLog, logEntry } from '../src/remote-log.mjs';

const device = () => ({ auth: { kind: 'device', device: { id: 'dev-1', name: 'iPhone' }, meta: { remote: true, browser: 'Safari 18 · iOS' }, tsNode: { id: 'n1', name: 'phone-a' } } });

test('web.boot: 같은 id는 새 연결에서도 한 번만, 다른 id는 새 줄, id가 없으면 예전처럼 연결마다 한 번', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p87-'));
  const store = new Store(path.join(dir, 'board.db'));
  const tailscale = { status: () => null, on: () => {}, off: () => {}, stop: () => {} };
  const web = new WebServer({ cfg: { remoteEnabled: true, port: 1, dataDir: dir, profile: 'dev', herdrSession: 'atrium-dev-test' }, store, api: null, tailscale, settings: () => ({ remoteAccess: true }) });
  try {
    const h = web.handlers()['web.boot'];
    const crash = { view: 'board', up: 14000, steps: [{ s: 'fit', t: 13000, z: 0.139 }] };
    assert.deepEqual(h({ crashed: true, id: 1762500000000, light: true, crash }, device()), { logged: true });
    assert.deepEqual(h({ crashed: true, id: 1762500000000, light: true, crash }, device()), { logged: false, dup: true }, '다시 붙은 연결의 같은 기록');
    assert.deepEqual(h({ crashed: true, id: 1762500000000, light: true, crash }, device()), { logged: false, dup: true });
    assert.deepEqual(h({ crashed: true, id: 1762500099000, crash }, device()), { logged: true }, '다른 죽음');
    assert.deepEqual(h({ crashed: true, crash }, device()), { logged: true }, 'id 없는 옛 창');
    const rows = web.remoteLog.list({ limit: 20 }).filter((e) => e.event === 'boot');
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((e) => e.bootId ?? null), [null, 1762500099000, 1762500000000]);
    web.remoteLog.flush();
    // 백엔드를 다시 띄워도(기록 파일을 다시 읽어도) 같은 id는 다시 남기지 않는다
    const log2 = new RemoteLog({ file: path.join(dir, 'remote-log.jsonl') });
    assert.equal(log2.entries.filter((e) => e.event === 'boot' && e.bootId === 1762500000000).length, 1);
  } finally { web.stop(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('logEntry: bootId는 양의 숫자만', () => {
  assert.equal(logEntry('boot', { bootId: 1762500000000.4 }).bootId, 1762500000000);
  for (const v of [0, -1, 'x', null, NaN, 1e15]) assert.equal(logEntry('boot', { bootId: v }).bootId, undefined);
});
