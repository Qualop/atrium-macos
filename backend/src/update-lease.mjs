// Persistent restart exclusion, independent of Electron's event subscription.
// No runtime/config imports: this file also runs in the detached helper.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const RESTART_LEASE_MS = 10 * 60 * 1000;
export const RESTART_LEASE_MAX_MS = 15 * 60 * 1000;
const INCOMPLETE_MS = 10000;
const ROLES = ['candidate', 'rollback'];
const SECRET = /^[a-f0-9]{64}$/;
const GENERATION = /^[a-f0-9-]{36}$/;
const ENV_KEYS = ['ATRIUM_UPDATE_GENERATION', 'ATRIUM_UPDATE_NONCE', 'ATRIUM_UPDATE_ROLE', 'ATRIUM_UPDATE_PERMIT'];
const fail = (code, message) => Object.assign(new Error(message), { code });
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a) === path.resolve(b);
const inside = (file, root) => same(file, root) || path.resolve(file).startsWith(path.resolve(root) + path.sep);
const moduleBundle = () => fileURLToPath(import.meta.url).match(/^(.*\.app)\/Contents\//)?.[1] || null;
export const restartLeaseDirOf = cfg => path.join(path.resolve(cfg.dataDir), 'updates', 'restart-lease');
const identityOf = job => ({ profile: job.cfg.profile, dataDir: path.resolve(job.cfg.dataDir), port: job.cfg.port,
  herdrSession: job.cfg.herdrSession, targetBundle: path.resolve(job.targetBundle), oldBackendPid: job.oldBackendPid,
  fromVersion: job.from.version, toVersion: job.to.version });
const matchesCfg = (r, cfg) => r.profile === cfg.profile && same(r.dataDir, cfg.dataDir) && r.port === cfg.port && r.herdrSession === cfg.herdrSession;
const validRestart = r => r && GENERATION.test(r.generation) && SECRET.test(r.nonce) && ROLES.every(role => SECRET.test(r.permits?.[role])) && r.permits.candidate !== r.permits.rollback;
const matchesJob = (r, job) => validRestart(job.restart) && r.generation === job.restart.generation && r.nonce === job.restart.nonce &&
  ROLES.every(role => r.permits[role] === job.restart.permits[role]) && Object.entries(identityOf(job)).every(([key, value]) => r[key] === value);

// Each generation has its own directory inside an exclusive slot. Cleanup
// removes only that generation (never recursively). A late ownership write
// cannot recreate a record inside a newer generation's directory.
function readSlot(cfg) {
  if (!cfg?.dataDir || !path.isAbsolute(cfg.dataDir)) return null;
  const dir = restartLeaseDirOf(cfg);
  let known = {};
  try {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { dir, invalid: true, at: stat.mtimeMs };
    const names = fs.readdirSync(dir);
    if (names.length !== 1 || !GENERATION.test(names[0])) return { dir, invalid: true, at: stat.mtimeMs };
    const generationDir = path.join(dir, names[0]), file = path.join(generationDir, 'intent.json');
    known = { file, generation: names[0] };
    const generationStat = fs.lstatSync(generationDir);
    if (!generationStat.isDirectory() || generationStat.isSymbolicLink()) return { dir, ...known, invalid: true, at: stat.mtimeMs };
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > 16384 || (process.platform !== 'win32' && (st.mode & 0o077)) || (process.getuid && st.uid !== process.getuid())) return { dir, ...known, invalid: true, at: st.mtimeMs };
      const r = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (r.format !== 1 || !validRestart(r) || names[0] !== r.generation || !['real', 'dev'].includes(r.profile) ||
          !path.isAbsolute(r.dataDir || '') || !same(r.dataDir, cfg.dataDir) || !path.isAbsolute(r.targetBundle || '') || !r.targetBundle.endsWith('.app') ||
          inside(r.dataDir, r.targetBundle) || !Number.isSafeInteger(r.port) || r.port < 1 || r.port > 65535 || !r.herdrSession ||
          !Number.isSafeInteger(r.ownerPid) || r.ownerPid < 2 || !Number.isFinite(r.createdAt) || !Number.isFinite(r.expiresAt) ||
          r.expiresAt <= r.createdAt || r.expiresAt > r.createdAt + RESTART_LEASE_MAX_MS) return { dir, ...known, invalid: true, at: st.mtimeMs };
      return { dir, file, record: r };
    } finally { fs.closeSync(fd); }
  } catch (error) {
    if (error.code === 'ENOENT' && !known.generation) return null;
    let at; try { at = fs.lstatSync(dir).mtimeMs; } catch { return null; }
    return { dir, ...known, invalid: true, at };
  }
}
function activeRecord(cfg, { now = Date.now(), isAlive = alive } = {}) {
  const slot = readSlot(cfg);
  if (!slot) return null;
  if (slot.invalid) return now < slot.at + INCOMPLETE_MS ? { invalid: true, expiresAt: slot.at + INCOMPLETE_MS } : null;
  const r = slot.record;
  return matchesCfg(r, cfg) && now < r.expiresAt && now >= r.createdAt - INCOMPLETE_MS && isAlive(r.ownerPid) ? r : null;
}
const publicRecord = r => r && ({ code: 'update_restarting', generation: r.generation || null, expiresAt: r.expiresAt,
  ownerPid: r.ownerPid || null, targetBundle: r.targetBundle || null, invalid: !!r.invalid });

/** Read-only, sync, secret-free. Null means no live intent for this cfg. */
export function readRestartLeaseSync(cfg, opts = {}) { return publicRecord(activeRecord(cfg, opts)); }
/** Electron must pass allowPermit:false. Backend may use the exact child env. */
export function restartBlockSync(cfg, { env = process.env, targetBundle = moduleBundle(), allowPermit = true, ...opts } = {}) {
  const r = activeRecord(cfg, opts);
  if (!r) return null;
  const role = env.ATRIUM_UPDATE_ROLE;
  if (!r.invalid && allowPermit && ROLES.includes(role) && same(targetBundle, r.targetBundle) &&
      env.ATRIUM_UPDATE_GENERATION === r.generation && env.ATRIUM_UPDATE_NONCE === r.nonce && env.ATRIUM_UPDATE_PERMIT === r.permits[role]) return null;
  return publicRecord(r);
}
export function assertRestartAllowedSync(cfg, opts = {}) {
  const block = restartBlockSync(cfg, opts);
  if (block) throw fail('update_restarting', 'A native update is restarting this board. Wait for the updater to reopen the app.');
}
export function withoutRestartPermit(env = process.env) { return Object.fromEntries(Object.entries(env).filter(([key]) => !ENV_KEYS.includes(key))); }

export function validateRestartJob(job) {
  if (!validRestart(job?.restart)) throw fail('bad_job', 'Invalid private restart authorization.');
}
export function acquireRestartLeaseSync(job, { now = Date.now(), ownerPid = process.pid, ttlMs = RESTART_LEASE_MS, isAlive = alive } = {}) {
  const cfg = job.cfg, dir = restartLeaseDirOf(cfg);
  if (inside(dir, job.targetBundle)) throw fail('bad_job', 'Restart intent must stay outside the app.');
  fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  const previous = readSlot(cfg);
  if (previous) {
    if (activeRecord(cfg, { now, isAlive }) || (previous.record && now < previous.record.expiresAt && isAlive(previous.record.ownerPid))) throw fail('update_busy', 'A native update restart is already in progress.');
    // Only well-formed, known generation files may be reaped. Unknown files
    // remain diagnostic evidence, never recursive deletion targets.
    if (previous.record || previous.generation) removeGeneration(cfg, previous.record?.generation || previous.generation);
    else { try { fs.rmdirSync(dir); } catch {} }
  }
  const restart = { generation: crypto.randomUUID(), nonce: crypto.randomBytes(32).toString('hex'),
    permits: Object.fromEntries(ROLES.map(role => [role, crypto.randomBytes(32).toString('hex')])) };
  const record = { format: 1, ...identityOf(job), ...restart, ownerPid, createdAt: now, expiresAt: now + Math.min(RESTART_LEASE_MAX_MS, Math.max(1000, ttlMs)) };
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') throw fail('update_busy', 'A native update restart is already in progress.'); throw error; }
  let fd;
  try {
    const generationDir = path.join(dir, restart.generation);
    fs.mkdirSync(generationDir, { mode: 0o700 });
    fd = fs.openSync(path.join(generationDir, 'intent.json'), 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd);
  } catch (error) { if (fd !== undefined) fs.closeSync(fd); removeGeneration(cfg, restart.generation); throw error; }
  fs.closeSync(fd);
  job.restart = restart;
  return restart;
}
function removeGeneration(cfg, generation) {
  if (!GENERATION.test(generation)) return false;
  const dir = restartLeaseDirOf(cfg), generationDir = path.join(dir, generation), file = path.join(generationDir, 'intent.json');
  let removed = false;
  try {
    const st = fs.lstatSync(generationDir);
    if (st.isSymbolicLink()) fs.unlinkSync(generationDir);
    else {
      try { fs.unlinkSync(file); removed = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      fs.rmdirSync(generationDir);
    }
    removed = true;
  } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
  if (!removed) return false;
  try { fs.rmdirSync(dir); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
  return true;
}
export function releaseRestartLeaseSync(job) {
  validateRestartJob(job);
  const slot = readSlot(job.cfg);
  if (!slot?.record || !matchesJob(slot.record, job)) return false;
  return removeGeneration(job.cfg, job.restart.generation);
}
/** Handoff happens before the old backend exits; the worker also claims on entry. */
export function claimRestartLeaseSync(job, { ownerPid = process.pid, now = Date.now(), isAlive = alive } = {}) {
  validateRestartJob(job);
  const slot = readSlot(job.cfg);
  if (!slot?.record || !matchesJob(slot.record, job) || now >= slot.record.expiresAt || !Number.isSafeInteger(ownerPid) || ownerPid < 2 || !isAlive(slot.record.ownerPid) || !isAlive(ownerPid)) throw fail('restart_lease_lost', 'The private update restart intent is no longer current.');
  const tmp = path.join(path.dirname(slot.dir), `.restart-${job.restart.generation}-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify({ ...slot.record, ownerPid }), { mode: 0o600 });
    fs.renameSync(tmp, slot.file);
  } finally { fs.rmSync(tmp, { force: true }); }
}
export function assertRestartLeaseSync(job, { now = Date.now(), isAlive = alive } = {}) {
  validateRestartJob(job);
  const slot = readSlot(job.cfg);
  if (!slot?.record || !matchesJob(slot.record, job) || now >= slot.record.expiresAt || !isAlive(slot.record.ownerPid)) throw fail('restart_lease_lost', 'The private update restart intent is no longer current.');
}
export function restartPermitEnv(job, role) {
  validateRestartJob(job);
  if (!ROLES.includes(role)) throw fail('bad_job', 'Invalid update backend role.');
  return { ATRIUM_UPDATE_GENERATION: job.restart.generation, ATRIUM_UPDATE_NONCE: job.restart.nonce,
    ATRIUM_UPDATE_ROLE: role, ATRIUM_UPDATE_PERMIT: job.restart.permits[role] };
}
