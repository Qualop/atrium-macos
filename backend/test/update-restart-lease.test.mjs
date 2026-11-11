import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Updater } from '../src/updater.mjs';
import { runSwap, createLifecycle, validateJob } from '../src/update-swap.mjs';
import { resourcesOf, readJson, writeJson } from '../src/update.mjs';
import { acquireRestartLeaseSync, claimRestartLeaseSync, releaseRestartLeaseSync, readRestartLeaseSync, restartBlockSync,
  assertRestartAllowedSync, restartPermitEnv, restartLeaseDirOf, RESTART_LEASE_MAX_MS } from '../src/update-lease.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
function fixture(t, { lease = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-restart-lease-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cfg = { profile: 'dev', dataDir: path.join(dir, 'data'), port: 49177, herdrSession: 'synthetic-restart-lease', backendFile: path.join(dir, 'data/backend.json'), logDir: path.join(dir, 'data/logs') };
  const targetBundle = path.join(dir, 'Applications/Atrium.app'), installDir = path.join(cfg.dataDir, 'updates');
  const staging = path.join(installDir, '.prepare-fixture'), preparedBundle = path.join(staging, 'extracted/Atrium.app'), helperDir = path.join(installDir, '.helper-fixture');
  write(path.join(targetBundle, 'original'), 'old'); write(path.join(preparedBundle, 'candidate'), 'new'); fs.mkdirSync(helperDir);
  write(path.join(cfg.dataDir, 'panes-and-data'), 'untouched');
  const job = { format: 1, kind: 'update', targetBundle, installDir, staging, preparedBundle, helperDir, cfg,
    oldBackendPid: 99999991, waitPids: [99999991], from: { tag: 'v0.3.9', version: '0.3.9' }, to: { tag: 'v0.4.0', version: '0.4.0' }, arch: 'arm64', protocol: 22, relaunch: true,
    profileEnv: { ATRIUM_PROFILE: cfg.profile, ATRIUM_DATA_DIR: cfg.dataDir, ATRIUM_PORT: String(cfg.port), ATRIUM_HERDR_SESSION: cfg.herdrSession,
      ATRIUM_UPDATE_TEST: '1', ATRIUM_UPDATE_TEST_ROOT: dir, ATRIUM_APP_USERDATA: path.join(dir, 'electron'), ATRIUM_UPDATE_API: 'http://127.0.0.1:12345/releases/latest' } };
  if (lease) acquireRestartLeaseSync(job);
  return { dir, cfg, job, targetBundle };
}
const reader = (f, env = {}) => restartBlockSync(f.cfg, { env, targetBundle: f.targetBundle });
const leaseFile = f => path.join(restartLeaseDirOf(f.cfg), f.job.restart.generation, 'intent.json');

test('startup/reconnect restarters block without receiving any update event; public reads contain no secrets', t => {
  const f = fixture(t);
  assert.equal(reader(f).code, 'update_restarting');
  assert.throws(() => assertRestartAllowedSync(f.cfg, { env: {} }), { code: 'update_restarting' });
  const view = JSON.stringify(readRestartLeaseSync(f.cfg));
  for (const secret of [f.job.restart.nonce, ...Object.values(f.job.restart.permits)]) assert.equal(view.includes(secret), false);
  if (process.platform !== 'win32') { assert.equal(fs.statSync(leaseFile(f)).mode & 0o777, 0o600); assert.equal(fs.statSync(restartLeaseDirOf(f.cfg)).mode & 0o777, 0o700); }
  assert.equal(reader(f, { ATRIUM_INSTALL_DIR: path.join(f.dir, 'other-updates') }).code, 'update_restarting');
});

test('only exact generation/nonce/role/bundle child permits pass; Electron always blocks', t => {
  const f = fixture(t), candidate = restartPermitEnv(f.job, 'candidate'), rollback = restartPermitEnv(f.job, 'rollback');
  assert.equal(reader(f, candidate), null); assert.equal(reader(f, rollback), null);
  for (const env of [
    { ...candidate, ATRIUM_UPDATE_NONCE: '0'.repeat(64) }, { ...candidate, ATRIUM_UPDATE_GENERATION: 'wrong-generation' },
    { ...candidate, ATRIUM_UPDATE_ROLE: 'rollback' }, { ...candidate, ATRIUM_UPDATE_ROLE: 'window' },
    { ...candidate, ATRIUM_UPDATE_PERMIT: rollback.ATRIUM_UPDATE_PERMIT }, { ATRIUM_UPDATE_NONCE: candidate.ATRIUM_UPDATE_NONCE },
  ]) assert.equal(reader(f, env).code, 'update_restarting');
  assert.equal(restartBlockSync(f.cfg, { env: candidate, targetBundle: path.join(f.dir, 'Other.app') }).code, 'update_restarting');
  assert.equal(restartBlockSync(f.cfg, { env: candidate, targetBundle: f.targetBundle, allowPermit: false }).code, 'update_restarting');
  for (const patch of [{ profile: 'real' }, { port: 49178 }, { herdrSession: 'different' }, { dataDir: path.join(f.dir, 'other') }]) assert.equal(readRestartLeaseSync({ ...f.cfg, ...patch }), null);
});

test('helper ownership survives old backend exit; dead owner and hard expiry bound crash exclusion', t => {
  const f = fixture(t, { lease: false }), now = Date.now();
  acquireRestartLeaseSync(f.job, { now, ownerPid: 12345, ttlMs: RESTART_LEASE_MAX_MS * 2 });
  claimRestartLeaseSync(f.job, { now: now + 1, ownerPid: 23456, isAlive: () => true });
  const live = readRestartLeaseSync(f.cfg, { now: now + 2, isAlive: pid => pid === 23456 });
  assert.equal(live.ownerPid, 23456); assert.equal(live.expiresAt, now + RESTART_LEASE_MAX_MS);
  assert.equal(readRestartLeaseSync(f.cfg, { now: now + 2, isAlive: () => false }), null);
  assert.throws(() => claimRestartLeaseSync(f.job, { now: now + 2, isAlive: () => false }), { code: 'restart_lease_lost' }, 'a restarted helper cannot revive a dead owner after regular restarters were unblocked');
  assert.equal(readRestartLeaseSync(f.cfg, { now: now + RESTART_LEASE_MAX_MS, isAlive: () => true }), null);
  const next = { ...f.job }; acquireRestartLeaseSync(next, { now: now + RESTART_LEASE_MAX_MS, isAlive: () => true });
  assert.notEqual(next.restart.generation, f.job.restart.generation);
  assert.equal(releaseRestartLeaseSync(f.job), false);
});

test('stale generation cannot claim, authorize, or clear a later lease; duplicate updates cannot replace live intent', t => {
  const f = fixture(t), old = structuredClone(f.job), permit = restartPermitEnv(old, 'candidate');
  assert.throws(() => acquireRestartLeaseSync({ ...f.job }), { code: 'update_busy' });
  assert.equal(releaseRestartLeaseSync(old), true); acquireRestartLeaseSync(f.job);
  assert.equal(releaseRestartLeaseSync(old), false); assert.throws(() => claimRestartLeaseSync(old), { code: 'restart_lease_lost' });
  assert.equal(reader(f, permit).code, 'update_restarting');
  assert.equal(readRestartLeaseSync(f.cfg).generation, f.job.restart.generation);
});

test('partial/private-file crashes block briefly, then permit recovery without following symlinks', t => {
  for (const kind of ['empty', 'partial', 'symlink', 'generation-symlink']) {
    const f = fixture(t, { lease: false }), dir = restartLeaseDirOf(f.cfg), generation = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    fs.mkdirSync(dir);
    if (kind === 'partial') { fs.mkdirSync(path.join(dir, generation)); fs.writeFileSync(path.join(dir, generation, 'intent.json'), '{', { mode: 0o600 }); }
    const outside = path.join(f.dir, 'outside'); write(outside, 'keep');
    if (kind === 'symlink') { fs.mkdirSync(path.join(dir, generation)); fs.symlinkSync(outside, path.join(dir, generation, 'intent.json')); }
    if (kind === 'generation-symlink') { fs.mkdirSync(path.join(f.dir, 'outside-dir')); write(path.join(f.dir, 'outside-dir/intent.json'), 'keep'); fs.symlinkSync(path.join(f.dir, 'outside-dir'), path.join(dir, generation), 'dir'); }
    const now = Date.now();
    assert.equal(readRestartLeaseSync(f.cfg, { now }).invalid, true);
    assert.equal(readRestartLeaseSync(f.cfg, { now: now + 11000 }), null);
    acquireRestartLeaseSync(f.job, { now: now + 11000 });
    assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');
    if (kind === 'generation-symlink') assert.equal(fs.readFileSync(path.join(f.dir, 'outside-dir/intent.json'), 'utf8'), 'keep');
  }
});

test('unknown nonce and identity changes reject a worker before copying, swapping, or starting anything', async t => {
  const f = fixture(t), forged = structuredClone(f.job); forged.restart.nonce = '0'.repeat(64);
  const no = () => assert.fail('forged job must not perform lifecycle operations');
  await assert.rejects(runSwap(forged, { copyBundle: no, lifecycle: { start: no } }), { code: 'restart_lease_lost' });
  for (const patch of [{ targetBundle: path.join(f.dir, 'Different.app') }, { to: { version: '9.0.0' } }]) await assert.rejects(runSwap({ ...f.job, ...patch }, { copyBundle: no }), { code: 'restart_lease_lost' });
  assert.throws(() => validateJob({ ...f.job, restart: { ...f.job.restart, permits: { candidate: '0'.repeat(64) } } }), { code: 'bad_job' });
  assert.ok(fs.existsSync(path.join(f.targetBundle, 'original'))); assert.ok(reader(f));
});

function fakeSwap(f, { rollback = false } = {}) {
  const calls = [], lifecycle = {
    start: async (bundle, version, role) => {
      const env = restartPermitEnv(f.job, role);
      assert.equal(reader(f, env), null); assert.ok(reader(f)); calls.push(['start', role]); return { role, version };
    },
    healthy: async child => { assert.ok(reader(f)); calls.push(['health', child.role]); if (rollback && child.role === 'candidate') throw Error('synthetic bad candidate'); return { pid: child.role === 'candidate' ? 99999993 : 99999994 }; },
    stop: async child => { calls.push(['stop', child?.role]); },
    relaunch: async () => { assert.equal(reader(f), null, 'lease must be cleared before native Electron launch'); calls.push(['relaunch']); return { pid: 99999995 }; },
  };
  return { calls, deps: { lifecycle, waitGone: async () => true, verify: async () => ({ ok: true }), copyBundle: (a, b) => fs.cpSync(a, b, { recursive: true }) } };
}
test('successful swap blocks ordinary restarters throughout health and clears same job before relaunch', async t => {
  const f = fixture(t), { calls, deps } = fakeSwap(f), result = await runSwap(f.job, deps);
  assert.equal(result.ok, true); assert.equal(result.relaunchPid, 99999995); assert.equal(readRestartLeaseSync(f.cfg), null);
  assert.deepEqual(calls, [['start', 'candidate'], ['health', 'candidate'], ['relaunch']]);
  assert.equal(fs.readFileSync(path.join(f.cfg.dataDir, 'panes-and-data'), 'utf8'), 'untouched');
});
test('rollback gets its own permit, stops only candidate, retains panes/data, then releases before relaunch', async t => {
  const f = fixture(t), { calls, deps } = fakeSwap(f, { rollback: true }), result = await runSwap(f.job, deps);
  assert.equal(result.ok, false); assert.equal(result.rolledBack, true); assert.equal(result.rollbackError, undefined); assert.equal(readRestartLeaseSync(f.cfg), null);
  assert.deepEqual(calls, [['start', 'candidate'], ['health', 'candidate'], ['stop', 'candidate'], ['start', 'rollback'], ['health', 'rollback'], ['relaunch']]);
  assert.ok(fs.existsSync(path.join(f.targetBundle, 'original'))); assert.equal(fs.readFileSync(path.join(f.cfg.dataDir, 'panes-and-data'), 'utf8'), 'untouched');
});
test('failed rollback stops only helper children and never relaunches an unhealthy backend', async t => {
  const f = fixture(t), { calls, deps } = fakeSwap(f); deps.lifecycle.healthy = async () => { throw Error('synthetic all health failed'); };
  const result = await runSwap(f.job, deps);
  assert.match(result.rollbackError, /all health failed/); assert.deepEqual(calls.filter(c => c[0] === 'stop'), [['stop', 'candidate'], ['stop', 'rollback']]);
  assert.equal(calls.some(c => c[0] === 'relaunch'), false); assert.ok(readRestartLeaseSync(f.cfg));
  assert.equal(readRestartLeaseSync(f.cfg, { isAlive: () => false }), null, 'worker exit releases crash exclusion');
});
test('a newer generation appearing during health survives old helper cleanup and suppresses old relaunch', async t => {
  const f = fixture(t), { calls, deps } = fakeSwap(f); let next;
  deps.lifecycle.healthy = async () => { releaseRestartLeaseSync(f.job); next = { ...f.job }; acquireRestartLeaseSync(next); return { pid: 99999993 }; };
  const result = await runSwap(f.job, deps);
  assert.match(result.leaseError, /another generation/); assert.equal(readRestartLeaseSync(f.cfg).generation, next.restart.generation);
  assert.equal(calls.some(c => c[0] === 'relaunch'), false);
});

test('real lifecycle passes permits only to its own backend children and retains ATRIUM test env for native relaunch', async t => {
  const f = fixture(t), calls = [];
  // Deliberately inject an inherited permit: relaunch must strip it.
  Object.assign(f.job.profileEnv, restartPermitEnv(f.job, 'candidate'));
  const lifecycle = createLifecycle(f.job, { pause: async () => {}, spawnProcess: (exe, args, opts) => {
    calls.push({ exe, args, opts }); const child = new EventEmitter(); child.pid = 99999993; child.exitCode = null;
    child.unref = () => {}; child.kill = signal => { calls.push({ killOwn: signal }); child.exitCode = 0; }; queueMicrotask(() => child.emit('spawn')); return child;
  } });
  const handle = await lifecycle.start(f.targetBundle, '0.4.0', 'candidate'); assert.equal(reader(f, calls[0].opts.env), null);
  await lifecycle.start(f.targetBundle, '0.3.9', 'rollback'); assert.equal(calls[1].opts.env.ATRIUM_UPDATE_ROLE, 'rollback'); assert.notEqual(calls[0].opts.env.ATRIUM_UPDATE_PERMIT, calls[1].opts.env.ATRIUM_UPDATE_PERMIT);
  await assert.rejects(lifecycle.start(f.targetBundle, '0.3.9', 'candidate'), { code: 'bad_job' });
  await assert.rejects(lifecycle.start(f.targetBundle, '0.4.0', 'unknown'), { code: 'bad_job' });
  await lifecycle.stop(handle); assert.deepEqual(calls.at(-1), { killOwn: 'SIGTERM' });
  releaseRestartLeaseSync(f.job); await lifecycle.relaunch(f.targetBundle);
  const launch = calls.at(-1); assert.equal(launch.exe, path.join(f.targetBundle, 'Contents/MacOS/Electron')); assert.deepEqual(launch.args, ['--dev']);
  for (const key of ['ATRIUM_UPDATE_TEST', 'ATRIUM_UPDATE_TEST_ROOT', 'ATRIUM_APP_USERDATA', 'ATRIUM_UPDATE_API', 'ATRIUM_DATA_DIR', 'ATRIUM_PORT', 'ATRIUM_HERDR_SESSION']) assert.equal(launch.opts.env[key], f.job.profileEnv[key]);
  for (const key of Object.keys(restartPermitEnv(f.job, 'candidate'))) assert.equal(launch.opts.env[key], undefined);
});

function updaterFixture(t) {
  const f = fixture(t, { lease: false }), root = resourcesOf(f.targetBundle), meta = new Map(), events = [];
  writeJson(path.join(root, 'backend/package.json'), { version: '0.3.9' }); write(path.join(root, 'runtime/node'), 'synthetic runtime');
  const b = { cfg: f.cfg, store: { getMeta: key => meta.get(key), setMeta: (key, value) => meta.set(key, value), addEvent: (...args) => events.push(args) }, api: { broadcast: (event, data) => events.push([event, data]) }, stop: async reason => { events.push(['stop', reason]); up.stop(); } };
  const up = new Updater(b, { timers: false, env: {}, codeRoot: root, platform: 'darwin', leaveWaitMs: 0, exit: code => events.push(['exit', code]) });
  t.after(() => up.stop());
  return { ...f, root, b, up, events };
}
test('updater persists exclusion before first restart broadcast without window acknowledgement, copies helper and hands off before stop', async t => {
  const f = updaterFixture(t); let saved;
  f.b.api.broadcast = (event, data) => { f.events.push([event, data]); if (event === 'update.restart' || (event === 'update.state' && data.job?.phase === 'restarting')) assert.ok(reader(f), 'restart must already be excluded'); };
  f.up.spawnSwap = async (file, job) => {
    saved = job; assert.ok(reader(f)); assert.equal(readJson(file).restart.nonce, job.restart.nonce); assert.equal(job.relaunch, true);
    assert.deepEqual(job.waitPids, [process.pid]); assert.equal(fs.readFileSync(path.join(job.helperDir, 'update-lease.mjs'), 'utf8'), fs.readFileSync(path.join(SRC, 'update-lease.mjs'), 'utf8'));
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    return { pid: process.pid };
  };
  await f.up.swap({ prepared: { bundle: f.job.preparedBundle, staging: f.job.staging }, to: f.job.to });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.ok(f.events.some(e => e[0] === 'stop' && e[1] === 'update')); assert.equal(f.up.stopped, true); assert.ok(readRestartLeaseSync(f.cfg));
  const publicEvents = JSON.stringify(f.events); for (const secret of [saved.restart.nonce, ...Object.values(saved.restart.permits)]) assert.equal(publicEvents.includes(secret), false);
  const worker = fakeSwap({ ...f, job: saved });
  assert.equal((await runSwap(saved, worker.deps)).ok, true, 'update stop after handoff must not cancel the helper');
});
test('failed helper spawn and unrelated stop during handoff release intent without update shutdown', async t => {
  for (const kind of ['spawn-fails', 'stopped']) {
    const f = updaterFixture(t);
    f.up.spawnSwap = async () => { throw Error('synthetic spawn failed'); };
    if (kind === 'stopped') f.b.api.broadcast = event => { if (event === 'update.restart') f.up.stop(); };
    await assert.rejects(f.up.swap({ prepared: { bundle: f.job.preparedBundle, staging: f.job.staging }, to: f.job.to }), kind === 'stopped' ? { code: 'backend_stopped' } : /spawn failed/);
    assert.equal(readRestartLeaseSync(f.cfg), null); assert.equal(f.events.some(e => e[0] === 'stop'), false);
  }
});
test('unrelated backend stop during preparation prevents apply', async t => {
  const f = updaterFixture(t); let finish;
  f.up.prepare = () => new Promise(resolve => { finish = resolve; }); f.up.swap = () => assert.fail('stopped backend must not swap');
  const pending = f.up.runUpdate(f.job.to); f.up.stop(); finish({ bundle: f.job.preparedBundle, staging: f.job.staging }); await pending;
  assert.equal(f.up.job.phase, 'failed'); assert.match(f.up.job.error, /stopped during update preparation/); assert.equal(readRestartLeaseSync(f.cfg), null);
});
