// P69 단위 시험(창): 업데이트 알림을 한 번만 띄우기(새 버전, 바꾸기 결과), 두 사전의 업데이트 글, 실행기(launch.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { noticesFor, RESULT_FRESH_MS } from '../src/renderer/lib/update-notice.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const view = (o = {}) => ({ current: { version: '0.1.0' }, latest: { tag: 'v0.2.0', version: '0.2.0' }, available: true, job: null, lastResult: null, ...o });

test('새 버전 알림은 버전마다 한 번, 업데이트 중에는 띄우지 않는다', () => {
  assert.deepEqual(noticesFor(view()).map((n) => [n.kind, n.version]), [['available', 'v0.2.0']]);
  assert.deepEqual(noticesFor(view(), { toasted: 'v0.2.0' }), []);
  assert.equal(noticesFor(view(), { toasted: 'v0.1.5' }).length, 1);
  assert.deepEqual(noticesFor(view({ available: false })), []);
  assert.deepEqual(noticesFor(view({ job: { phase: 'prepare' } })), []);
  assert.equal(noticesFor(view({ job: { phase: 'failed' } })).length, 1);
  assert.deepEqual(noticesFor(null), []);
});

test('바꾸기 결과는 최근 것만 한 번 알린다(성공, 되돌림)', () => {
  const now = 1_000_000_000_000;
  const ok = { at: now - 5000, ok: true, to: { tag: 'v0.2.0' }, from: { tag: 'v0.1.0' } };
  const bad = { at: now - 5000, ok: false, rolledBack: true, to: { tag: 'v0.2.0' }, from: { tag: 'v0.1.0' }, error: 'boom' };
  const a = noticesFor(view({ available: false, lastResult: ok }), { now });
  assert.deepEqual(a, [{ kind: 'result', key: String(ok.at), ok: true, to: 'v0.2.0', from: 'v0.1.0', error: '' }]);
  assert.deepEqual(noticesFor(view({ available: false, lastResult: ok }), { now, resultSeen: String(ok.at) }), []);
  assert.deepEqual(noticesFor(view({ available: false, lastResult: { ...ok, at: now - RESULT_FRESH_MS - 1 } }), { now }), []);
  const b = noticesFor(view({ available: false, lastResult: bad }), { now });
  assert.equal(b[0].ok, false); assert.equal(b[0].error, 'boom'); assert.equal(b[0].from, 'v0.1.0');
});

test('두 사전에 업데이트 글이 같은 열쇠로 있다', () => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !('one' in v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  assert.ok(en.update && ko.update);
  assert.deepEqual(keys(ko.update).sort(), keys(en.update).sort());
  for (const k of ['group', 'checkNow', 'applyTo', 'confirmBody', 'phaseRestarting', 'webBanner', 'trayItem', 'step.download', 'step.build']) assert.ok(keys(en.update).includes(k), k);
  assert.match(en.update.applyTo, /\{version\}/); assert.match(ko.update.applyTo, /\{version\}/);
});

test('macOS bundle launcher never builds or reads a version pointer and preserves case and spaces', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-launch-Mac-'));
  try {
    const scripts = path.join(dir, '한글 Moved App/Atrium.app/Contents/Resources/app/scripts');
    fs.mkdirSync(scripts, { recursive: true });
    fs.copyFileSync(path.join(HERE, '..', 'scripts/launch.mjs'), path.join(scripts, 'launch.mjs'));
    const r = spawnSync(process.execPath, [path.join(scripts, 'launch.mjs'), '--dry-run'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assert.equal(result.build, false); assert.equal(result.route, 'bundle');
    assert.equal(fs.realpathSync(result.bundle), fs.realpathSync(path.join(scripts, '../../../..')));
    assert.equal(fs.existsSync(path.join(dir, 'current.json')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
