// Standalone helper copied outside the installed bundle. Only processes spawned
// by this helper may be stopped. The old backend/windows must exit themselves;
// herdr, its panes, and the board data directory are never renamed or removed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeResult, readJson, resourcesOf, cleanEnv, samePath, fail } from './update.mjs';
import { verifyBundle } from './update-verify.mjs';
import { validateRestartJob, claimRestartLeaseSync, releaseRestartLeaseSync, assertRestartLeaseSync, restartPermitEnv, withoutRestartPermit } from './update-lease.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function waitGone(pids, ms = 30000) {
  const until = Date.now() + ms;
  while (pids.some(alive) && Date.now() < until) await sleep(100);
  return !pids.some(alive);
}
const within = (file, root) => path.resolve(file).startsWith(path.resolve(root) + path.sep);
export function validateJob(job) {
  if (job?.format !== 1 || !job.targetBundle?.endsWith('.app') || typeof job.preparedBundle !== 'string' || path.basename(job.preparedBundle) !== 'Atrium.app' || !path.isAbsolute(job.targetBundle)) throw fail('bad_job', 'Invalid bundle update job.');
  for (const name of ['installDir', 'staging', 'helperDir']) if (!path.isAbsolute(job[name] || '')) throw fail('bad_job', 'Invalid update directory.');
  if (!within(job.preparedBundle, job.staging) || !within(job.staging, job.installDir) || !within(job.helperDir, job.installDir)) throw fail('bad_job', 'Staged app must be inside the private update directory.');
  if (!path.isAbsolute(job.cfg?.dataDir || '') || !path.isAbsolute(job.cfg?.backendFile || '') || !job.cfg?.herdrSession || within(job.cfg.dataDir, job.targetBundle) || samePath(job.cfg.dataDir, job.targetBundle) || within(job.installDir, job.targetBundle)) throw fail('bad_job', 'Board data must stay outside the bundle.');
  if (!Array.isArray(job.waitPids) || job.waitPids.some(p => !Number.isSafeInteger(p) || p < 2) || !job.waitPids.includes(job.oldBackendPid)) throw fail('bad_job', 'Invalid process wait list.');
  if (!['real', 'dev'].includes(job.cfg.profile) || !Number.isSafeInteger(job.cfg.port) || job.cfg.port < 1 || job.cfg.port > 65535 || !job.to?.version || !job.from?.version) throw fail('bad_job', 'Invalid profile or release.');
  validateRestartJob(job);
}
export function createLifecycle(job, { spawnProcess = spawn, pause = sleep } = {}) {
  const env = withoutRestartPermit({ ...cleanEnv(), ...job.profileEnv });
  return {
    async start(bundle, version, role = version === job.to.version ? 'candidate' : 'rollback') {
      assertRestartLeaseSync(job);
      if (!samePath(bundle, job.targetBundle) || version !== (role === 'candidate' ? job.to.version : job.from.version)) throw fail('bad_job', 'Backend role does not match the update bundle/version.');
      const permit = restartPermitEnv(job, role);
      fs.mkdirSync(path.join(job.cfg.dataDir, 'logs'), { recursive: true });
      const root = resourcesOf(bundle), out = fs.openSync(path.join(job.cfg.dataDir, 'logs/backend.out'), 'a');
      let child;
      try { child = spawnProcess(path.join(root, 'runtime/node'), [path.join(root, 'backend/src/main.mjs')], { cwd: root, env: { ...env, ...permit, PATH: [path.join(root, 'runtime'), env.PATH || '/usr/bin:/bin'].join(path.delimiter) }, detached: true, stdio: ['ignore', out, out] }); }
      finally { fs.closeSync(out); }
      const handle = { child, root, version, error: null };
      child.on('error', e => { handle.error = e; }); child.unref();
      return handle;
    },
    async healthy(handle) {
      const end = Date.now() + (job.healthMs || 60000);
      while (Date.now() < end) {
        if (handle.error || handle.child.exitCode != null || handle.child.signalCode) throw handle.error || Error('Candidate backend exited.');
        const info = readJson(job.cfg.backendFile);
        if (info?.pid === handle.child.pid && info.port === job.cfg.port) {
          const client = await import(pathToFileURL(path.join(handle.root, 'backend/src/client.mjs')).href);
          const health = await client.health(info.port);
          if (health?.ok && health.pid === handle.child.pid) {
            const c = new client.ApiClient(info, { connectTimeoutMs: Math.min(3000, Math.max(1, end - Date.now())) });
            let timer;
            try {
              const st = await Promise.race([(async () => { await c.open(); return c.call('backend.status'); })(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Health request timed out.')), Math.min(3000, Math.max(1, end - Date.now()))); })]);
              if (st.pid === handle.child.pid && st.profile === job.cfg.profile && st.port === job.cfg.port && samePath(st.dataDir, job.cfg.dataDir) && st.version?.version === handle.version && samePath(st.version.root, handle.root) && st.herdr?.connected && (!job.herdrServerPid || st.herdr.serverPid === job.herdrServerPid) && (!st.herdr.session || st.herdr.session === job.cfg.herdrSession)) return { pid: st.pid, port: st.port };
            } catch {} finally { clearTimeout(timer); c.close(); }
          }
        }
        await pause(200);
      }
      throw Error('Candidate backend failed version/profile/herdr health checks.');
    },
    async stop(handle) {
      // child is a process handle returned by our own start(), never a PID read
      // from backend.json or supplied by an API client.
      if (!handle || handle.child.exitCode != null || handle.child.signalCode || handle.error) return;
      handle.child.kill('SIGTERM');
      if (!(await waitGone([handle.child.pid], 10000))) { handle.child.kill('SIGKILL'); if (!(await waitGone([handle.child.pid], 3000))) throw Error('Candidate backend did not exit; retained rollback bundle.'); }
    },
    async relaunch(bundle) {
      const root = resourcesOf(bundle);
      return new Promise((resolve, reject) => {
        const child = spawnProcess(path.join(bundle, 'Contents/MacOS/Electron'), job.cfg.profile === 'dev' ? ['--dev'] : [], { cwd: root, env: { ...env, PATH: [path.join(root, 'runtime'), env.PATH || '/usr/bin:/bin'].join(path.delimiter) }, detached: true, stdio: 'ignore' });
        child.once('error', reject); child.once('spawn', () => { child.unref(); resolve({ pid: child.pid }); });
      });
    },
  };
}
export async function runSwap(job, deps = {}) {
  validateJob(job);
  claimRestartLeaseSync(job);
  const lifecycle = deps.lifecycle || createLifecycle(job);
  const verify = deps.verify || verifyBundle, wait = deps.waitGone || waitGone;
  const copyBundle = deps.copyBundle || ((from, to) => execFileSync('/usr/bin/ditto', [from, to], { timeout: 180000, stdio: 'pipe' }));
  const rename = deps.rename || fs.renameSync;
  const id = crypto.randomUUID(), parent = path.dirname(job.targetBundle);
  const next = path.join(parent, `.Atrium.update-${id}.app`), backup = path.join(parent, `.Atrium.previous-${id}.app`), failed = path.join(parent, `.Atrium.failed-${id}.app`);
  const result = { kind: 'update', ok: false, from: job.from, to: job.to, rolledBack: false, at: null, error: null };
  const start = Date.now(); let moved = false, installed = false, candidate = null, active = job.targetBundle;
  try {
    if (!fs.lstatSync(job.targetBundle).isDirectory() || fs.lstatSync(job.targetBundle).isSymbolicLink() || !samePath(fs.realpathSync(job.targetBundle), job.targetBundle)) throw Error('Installed app must be a real bundle directory.');
    await copyBundle(job.preparedBundle, next);
    const verified = await verify(next, { version: job.to.version, arch: job.arch, protocol: job.protocol, currentBundle: job.targetBundle });
    if (!verified.ok) throw Error(verified.problems.join('; '));
    if (!(await wait(job.waitPids, job.waitMs || 30000))) throw Error('Previous backend or window is still running. No app files were replaced.');
    assertRestartLeaseSync(job);
    rename(job.targetBundle, backup); moved = true;
    rename(next, job.targetBundle); installed = true;
    candidate = await lifecycle.start(job.targetBundle, job.to.version, 'candidate');
    const health = await lifecycle.healthy(candidate);
    result.ok = true; result.backendPid = health.pid; result.backupBundle = backup;
  } catch (e) {
    result.error = String(e.message || e).slice(0, 700);
    if (moved) {
      try {
        await lifecycle.stop(candidate);
        assertRestartLeaseSync(job);
        if (installed) rename(job.targetBundle, failed);
        rename(backup, job.targetBundle); result.rolledBack = true;
        const old = await lifecycle.start(job.targetBundle, job.from.version, 'rollback');
        try { const health = await lifecycle.healthy(old); result.backendPid = health.pid; } catch (error) { await lifecycle.stop(old); throw error; }
      } catch (error) { result.rollbackError = String(error.message || error).slice(0, 700); result.backupBundle = fs.existsSync(backup) ? backup : job.targetBundle; active = null; }
    } else if (await wait([job.oldBackendPid], 0)) {
      try {
        assertRestartLeaseSync(job);
        const old = await lifecycle.start(job.targetBundle, job.from.version, 'rollback');
        try { const health = await lifecycle.healthy(old); result.backendPid = health.pid; }
        catch (error) { await lifecycle.stop(old); throw error; }
      } catch (error) { result.rollbackError = String(error.message || error).slice(0, 700); result.backupBundle = job.targetBundle; active = null; }
    }
  }
  result.at = Date.now(); result.ms = result.at - start;
  // Persist failure/success before reopening a window, including a failed
  // rollback. No automatic release/tag deletion or local backup pruning.
  (deps.writeResult || writeResult)(job.installDir, result);
  // Only the same job may lift exclusion, after candidate/recovery health has
  // settled and BEFORE Electron starts. A failed rollback retains intent until
  // this helper exits (or the hard expiry); no unknown process is stopped.
  if (result.backendPid || (!moved && !result.rollbackError)) {
    if (!releaseRestartLeaseSync(job)) { result.leaseError = 'Restart intent belongs to another generation.'; active = null; (deps.writeResult || writeResult)(job.installDir, result); }
  }
  if (job.relaunch && active && result.backendPid) {
    try { const opened = await lifecycle.relaunch(active); result.relaunchPid = opened?.pid || null; (deps.writeResult || writeResult)(job.installDir, result); } catch (e) { result.relaunchError = String(e.message || e).slice(0, 300); (deps.writeResult || writeResult)(job.installDir, result); }
  }
  // Discard only downloaded copies after recovery is settled. Keep the
  // previous installed bundle and the private helper/job for diagnosis.
  if (!result.rollbackError) {
    try {
      fs.rmSync(next, { recursive: true, force: true });
      fs.rmSync(job.staging, { recursive: true, force: true });
      if (result.rolledBack) fs.rmSync(failed, { recursive: true, force: true });
    } catch (error) { result.cleanupError = String(error.message || error).slice(0, 300); (deps.writeResult || writeResult)(job.installDir, result); }
  }
  return result;
}
if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  const file = process.argv[2];
  try {
    const job = readJson(file); const result = await runSwap(job);
    if (job.logFile) fs.appendFileSync(job.logFile, `${new Date().toISOString()} [swap] ${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
