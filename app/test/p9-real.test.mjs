// P9 실제 판 실행 쪽 시험: 시험 도구의 시험 판 막기(네 값을 모두 덮지 않으면 띄우지 않음), real.mjs가 고르는 프로필과 빌드 판단
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { electronExecutable } from '../scripts/platform.mjs';
import { assertTestBoard, assertLegacyTestBoard, atriumEnv } from './e2e/p9-guard.mjs';
import { migrateAppProfile, PROFILE_MARKER } from '../src/main/profile.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = path.resolve(APP, '..', 'backend', '.dev');
const OK = { ATRIUM_HERDR_SESSION: 'atrium-dev-p9', ATRIUM_PORT: '47821', ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app') };

test('P9: 시험 판 막기 — 네 값을 모두 시험 판 값으로 덮어야 띄운다', () => {
  assert.equal(assertTestBoard(OK, { root: DEV }), true);
  for (const k of Object.keys(OK)) { const e = { ...OK }; delete e[k]; assert.throws(() => assertTestBoard(e, { root: DEV }), new RegExp(k)); }
  for (const s of ['atrium', 'atrium-dev', 'multitask', 'multitask-dev', 'default', 'other-p9']) assert.throws(() => assertTestBoard({ ...OK, ATRIUM_HERDR_SESSION: s }), /herdr 세션/, s);
  // P18: 옛 이름의 값(MTASK_*)과 옛 시험 판 이름(multitask-dev-*)도 받는다. 둘 다 있으면 ATRIUM_*
  const old = Object.fromEntries(Object.entries(OK).map(([k, v]) => [k.replace(/^ATRIUM_/, 'MTASK_'), v]));
  assert.equal(assertTestBoard({ ...old, MTASK_HERDR_SESSION: 'multitask-dev-p9' }, { root: DEV }), true);
  assert.throws(() => assertTestBoard({ ...old, ATRIUM_HERDR_SESSION: 'atrium' }), /herdr 세션/);
  assert.deepEqual(atriumEnv({ MTASK_PORT: '1', X: '2' }), { ATRIUM_PORT: '1', X: '2' });
  assert.throws(() => assertTestBoard({ ...OK, ATRIUM_PORT: '47800' }), /포트/);
  assert.throws(() => assertTestBoard({ ...OK, ATRIUM_PORT: '47811' }), /포트/);
  for (const id of ['atrium', 'multitask']) {
    assert.throws(() => assertTestBoard({ ...OK, ATRIUM_DATA_DIR: path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), id) }), /실제 판/);
    assert.throws(() => assertTestBoard({ ...OK, ATRIUM_APP_USERDATA: path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), `${id}-app-real`) }), /창 프로필/);
  }
  assert.throws(() => assertTestBoard({ ...OK, ATRIUM_DATA_DIR: 'C:\\elsewhere\\data' }, { root: DEV }), /밖이다/);
});

// real.mjs --dry-run: 띄우지 않고 고른 값만 찍는다
const dry = (env, ...args) => JSON.parse(execFileSync(process.execPath, [path.join(APP, 'scripts', 'real.mjs'), '--dry-run', ...args], { encoding: 'utf8', env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ATRIUM_') && !k.startsWith('MTASK_'))), ...env } }));

test('P9: real.mjs는 --dev 없이 실제 판 프로필로 띄우고, ATRIUM_* 값이 있으면 그 값을 쓴다(--dev를 줘도 뺀다)', () => {
  const real = dry({});
  assert.equal(real.profile, 'real'); assert.equal(real.herdrSession, 'atrium'); assert.equal(real.port, 47800);
  assert.equal(path.basename(real.dataDir), 'atrium');
  assert.deepEqual(real.args, ['.']);
  assert.equal(real.exe, electronExecutable(APP));
  assert.equal(path.resolve(real.cwd), APP);
  const t = dry(OK, '--dev');
  assert.equal(t.profile, 'real'); assert.equal(t.herdrSession, 'atrium-dev-p9'); assert.equal(t.port, 47821);
  assert.equal(path.resolve(t.dataDir), path.resolve(OK.ATRIUM_DATA_DIR)); assert.equal(t.appUserData, OK.ATRIUM_APP_USERDATA);
  assert.deepEqual(t.args, ['.']);
});

test('P18: 옮기기 시험 막기 — 옛 판 값(ATRIUM_LEGACY_*)도 셋 다 시험 판 값이어야 띄운다', () => {
  const L = { ...OK, ATRIUM_HERDR_SESSION: 'atrium-dev-p18-new', ATRIUM_LEGACY_HERDR_SESSION: 'atrium-dev-p18-old', ATRIUM_LEGACY_DATA_DIR: path.join(DEV, 'old'), ATRIUM_LEGACY_APP_USERDATA: path.join(DEV, 'oldapp') };
  assert.equal(assertLegacyTestBoard(L, { root: DEV }), true);
  for (const k of ['ATRIUM_LEGACY_HERDR_SESSION', 'ATRIUM_LEGACY_DATA_DIR', 'ATRIUM_LEGACY_APP_USERDATA']) { const e = { ...L }; delete e[k]; assert.throws(() => assertLegacyTestBoard(e, { root: DEV }), new RegExp(k)); }
  assert.throws(() => assertLegacyTestBoard({ ...L, ATRIUM_LEGACY_HERDR_SESSION: 'multitask' }), /옛 herdr 세션/);
  assert.throws(() => assertLegacyTestBoard({ ...L, ATRIUM_LEGACY_DATA_DIR: path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'multitask') }), /실제 판/);
  assert.throws(() => assertLegacyTestBoard({ ...L, ATRIUM_LEGACY_APP_USERDATA: path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'multitask-app-real') }), /창 프로필/);
  assert.throws(() => assertLegacyTestBoard({ ...L, ATRIUM_LEGACY_HERDR_SESSION: L.ATRIUM_HERDR_SESSION }), /같다/);
  assert.throws(() => assertLegacyTestBoard({ ...L, ATRIUM_LEGACY_DATA_DIR: 'C:\\elsewhere\\old' }, { root: DEV }), /밖이다/);
});

test('P18: 옛 창 프로필 복사 — 새 프로필이 없을 때 한 번, 잠금 파일은 빼고, 옛 프로필은 그대로', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p18-app-'));
  const from = path.join(d, 'old'), to = path.join(d, 'new');
  fs.mkdirSync(path.join(from, 'Local Storage', 'leveldb'), { recursive: true });
  fs.writeFileSync(path.join(from, 'Local Storage', 'leveldb', '000003.log'), 'mt.sidebar');
  fs.writeFileSync(path.join(from, 'Local Storage', 'leveldb', 'LOCK'), '');
  fs.writeFileSync(path.join(from, 'Preferences'), '{}');
  fs.writeFileSync(path.join(from, 'lockfile'), '');
  const r = migrateAppProfile(from, to);
  assert.equal(r.files, 2); assert.deepEqual(r.failed, []);
  assert.equal(fs.readFileSync(path.join(to, 'Local Storage', 'leveldb', '000003.log'), 'utf8'), 'mt.sidebar');
  assert.ok(!fs.existsSync(path.join(to, 'Local Storage', 'leveldb', 'LOCK'))); assert.ok(!fs.existsSync(path.join(to, 'lockfile')));
  assert.ok(fs.existsSync(path.join(to, PROFILE_MARKER))); assert.ok(fs.existsSync(path.join(from, 'Preferences')));
  assert.equal(migrateAppProfile(from, to), null); // 다시 켜면 하지 않는다
  assert.equal(migrateAppProfile(path.join(d, 'none'), path.join(d, 'x')), null);
  assert.equal(migrateAppProfile(null, path.join(d, 'x')), null);
});
