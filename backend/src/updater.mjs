// Release checking is read-only. Installation is local, explicit, and operates
// on a complete macOS bundle. herdr and the board directory stay in place.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as U from './update.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CHECK_EVERY_MS = 6 * 3600 * 1000;
export const FIRST_CHECK_MS = 20000;
export const LEAVE_WAIT_MS = 1500;
export const HEALTH_MS = 60000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const relaunchArgsOf = (args, profile) => Array.isArray(args) ? args.filter(a => a === '--dev' && profile === 'dev').slice(0, 1) : [];
export const attachUpdater = (b, opts) => new Updater(b, opts);
export class Updater {
  constructor(b, { fetchJson = U.httpGetJson, prepare = U.prepareRelease, spawnSwap = null, exit = code => process.exit(code), codeRoot = path.resolve(HERE, '../..'), env = process.env, platform = process.platform, arch = process.arch, checkMs, firstCheckMs, leaveWaitMs = LEAVE_WAIT_MS, timers = true } = {}) {
    this.b = b; this.fetchJson = fetchJson; this.prepare = prepare; this.exit = exit; this.leaveWaitMs = leaveWaitMs;
    this.spawnSwap = spawnSwap || ((file, job) => this.defaultSpawnSwap(file, job));
    this.codeRoot = codeRoot; this.env = env; this.platform = platform; this.arch = arch;
    this.dir = U.installDirOf(env, b.cfg); this.apiUrl = U.updateApiOf(env);
    this.running = U.runningVersion(codeRoot);
    this.testMode = U.isolatedUpdateTest(b.cfg, env, this.running);
    if (this.apiUrl !== U.DEFAULT_UPDATE_API && (!this.testMode || !U.checkApiUrl(this.apiUrl).test)) throw U.fail('unsafe_update_api', 'A loopback release API requires an explicitly isolated temporary dev update fixture.');
    this.healthMs = this.testMode ? Math.min(60000, Math.max(1000, Number(U.envValue('UPDATE_HEALTH_MS', env)) || HEALTH_MS)) : HEALTH_MS; this.checkMs = checkMs ?? CHECK_EVERY_MS;
    this.logFile = path.join(b.cfg.logDir, 'update.log');
    this.job = null; this.leaving = []; this.checking = null; this.applying = false;
    this.noteResult();
    this.handlers = {
      'update.status': () => this.view(),
      'update.check': p => p?.channel ? this.checkOnce(this.validChannel(p.channel)) : this.check('manual'),
      'update.apply': (p, c) => this.apply(p || {}, c),
      'update.leaving': (p, c) => this.leave(p || {}, c),
    };
    if (timers) {
      this.firstTimer = setTimeout(() => this.autoCheck('start'), firstCheckMs ?? FIRST_CHECK_MS);
      this.timer = setInterval(() => this.autoCheck('timer'), this.checkMs);
      this.resultTimers = [1000, 3000, 8000, 20000].map(ms => setTimeout(() => { if (this.noteResult()) this.broadcast(); }, ms));
      for (const t of [this.firstTimer, this.timer, ...this.resultTimers]) t.unref?.();
    }
  }
  validChannel(value) { if (!U.CHANNELS.includes(value)) throw U.fail('bad_request', 'Channel must be stable or dev.'); return value; }
  allowed() { return U.installAllowed(this.b.cfg, this.dir, { running: this.running, platform: this.platform, env: this.env }); }
  stop() { this.stopped = true; clearTimeout(this.firstTimer); clearInterval(this.timer); for (const t of this.resultTimers || []) clearTimeout(t); }
  log(...a) { const line = `${new Date().toISOString()} ${a.join(' ')}`; try { fs.mkdirSync(path.dirname(this.logFile), { recursive: true }); fs.appendFileSync(this.logFile, line + '\n'); } catch {} }

  settings() { return (this.b.features && this.b.features.settings.get()) || this.b.store.getMeta('settings') || {}; }
  enabled() { return this.settings().updateCheck !== false; }
  channel() { return U.channelOf(this.settings().updateChannel); }
  meta() { return this.b.store.getMeta('update') || {}; }
  putMeta(patch) { const m = { ...this.meta(), ...patch }; this.b.store.setMeta('update', m); return m; }
  broadcast() { this.b.api.broadcast('update.state', this.view()); }
  // 확인 결과(채널, latest, checkedAt, error)가 지금 채널의 것인가. P69의 결과(채널 없음)는 stable로 본다
  fresh(rec, ch = this.channel()) { return !!rec && rec.repository === U.UPDATE_REPO && (rec.channel || 'stable') === ch; }
  view(rec = null, ch = null) {
    this.noteResult(); // 바꾸기 프로세스는 새 백엔드가 뜬 뒤에 결과를 쓴다. 창이 붙어 물을 때 읽는다
    const m = this.meta();
    const channel = ch || this.channel();
    const r = rec || (this.fresh(m, channel) ? m : {}); // 다른 채널의 결과는 보이지 않는다(아직 확인하지 않은 것으로)
    let asset = null; try { asset = r.latest ? U.selectAsset(r.latest, this.arch).asset : null; } catch {}
    const latest = r.latest ? { tag: r.latest.tag, version: r.latest.version, name: r.latest.name, url: r.latest.url, notes: r.latest.notes, publishedAt: r.latest.publishedAt, prerelease: !!r.latest.prerelease, installable: !!asset, asset: asset?.name || null } : null;
    const available = !!(latest && this.running.version && U.compareVersions(latest.version, this.running.version) > 0);
    const allowed = this.allowed();
    return {
      current: { version: this.running.version, tag: this.running.tag, installed: this.running.installed, prerelease: !!(U.parseVersion(this.running.version) || { pre: [] }).pre.length },
      channel, latest, available, checkedAt: r.checkedAt || null, error: r.error || null, enabled: this.enabled(),
      installDir: this.dir,
      allowed: allowed.ok && (!latest || !!asset), reason: allowed.reason || (latest && !asset ? 'no_bundle_asset' : null), message: allowed.message || null, manualUrl: U.RELEASES_URL, job: this.job, lastResult: m.lastResult || null,
    };
  }
  // 바꾸기 프로세스가 남긴 결과(last-update.json)를 판 기록에 옮긴다. 창은 처음 보는 결과를 한 번 알린다
  noteResult() {
    const r = U.readResult(this.dir);
    if (!r || !r.at) return false;
    const m = this.meta();
    if (m.lastResult && JSON.stringify(m.lastResult) === JSON.stringify(r)) return false;
    this.putMeta({ lastResult: r });
    try { this.b.store.addEvent(null, 'update_result', r); } catch {}
    this.log(`swap result ${JSON.stringify(r)}`);
    return true;
  }

  async autoCheck(reason) {
    if (!this.enabled() || this.job) return;
    await this.check(reason).catch(() => {});
  }
  // 채널 하나를 확인한 결과(판 기록에 둘 꼴). 던지지 않는다
  async fetchRecord(channel) {
    const rec = { repository: U.UPDATE_REPO, channel, checkedAt: null, latest: null, error: null };
    try {
      rec.latest = await U.fetchLatest(this.fetchJson, this.apiUrl, channel);
      if (!rec.latest) rec.error = 'no_release';
    } catch (e) { rec.error = e.code === 'no_release' ? 'no_release' : String(e.message || e).slice(0, 300); }
    rec.checkedAt = Date.now();
    return rec;
  }
  // 지금 채널을 확인해 판 기록에 둔다. 같은 채널의 확인이 돌고 있으면 그것을 기다리고, 다른 채널의 것이 돌고 있으면 끝난 뒤 다시 확인한다
  check(reason = 'manual') {
    const channel = this.channel();
    if (this.checking && this.checkingChannel === channel) return this.checking;
    const before = this.checking || Promise.resolve();
    const run = before.catch(() => {}).then(async () => {
      const ch = this.channel(); // 기다리는 동안 또 바뀌었으면 마지막 채널로
      const rec = await this.fetchRecord(ch);
      if (ch === this.channel()) this.putMeta({ repository: U.UPDATE_REPO, channel: rec.channel, checkedAt: rec.checkedAt, latest: rec.latest, error: rec.error }); // 그사이 채널이 바뀌었으면 결과를 버린다
      const v = this.view();
      this.log(`check ${reason} channel=${ch} current=${v.current.version} latest=${v.latest && v.latest.tag} available=${v.available}${v.error ? ` error=${v.error}` : ''}`);
      this.broadcast();
      return v;
    });
    this.checking = run; this.checkingChannel = channel;
    run.finally(() => { if (this.checking === run) { this.checking = null; this.checkingChannel = null; } }).catch(() => {});
    return run;
  }
  // 그 한 번만 다른 채널로 확인한다(atrium update --check --channel). 판 기록에 두지 않는다
  async checkOnce(channel) {
    const ch = U.channelOf(channel);
    if (ch === this.channel()) return this.check('manual');
    const rec = await this.fetchRecord(ch);
    this.log(`check once channel=${ch} latest=${rec.latest && rec.latest.tag}${rec.error ? ` error=${rec.error}` : ''}`);
    return { ...this.view(rec, ch), once: true };
  }
  // 판 설정의 채널이 바뀌었다(backend.mjs settings.set). 앞 채널의 결과는 view가 이미 감춘다. 지금 상태를 알리고 다시 확인한다
  channelChanged() {
    this.log(`channel → ${this.channel()}`);
    this.broadcast();
    return this.check('channel').catch(() => {});
  }

  local(c) { if (c?.auth?.kind !== 'local' || c.remote || c.auth.remote) throw U.fail('forbidden', 'Only the local board can install updates.'); }
  guard(c) {
    this.local(c);
    const allowed = this.allowed();
    if (!allowed.ok) throw U.fail(allowed.reason, allowed.message);
    if (this.applying || (this.job && this.job.phase !== 'failed')) throw U.fail('update_busy', 'An update is already in progress.');
  }
  setJob(patch) { this.job = { ...(this.job || {}), ...patch, at: Date.now() }; this.broadcast(); }
  async apply(p, c) {
    this.guard(c); this.applying = true;
    try {
      const channel = p.channel ? this.validChannel(p.channel) : this.channel();
      // Refresh the release before committing, so a stale confirmation cannot
      // silently install a different version or channel.
      const rec = await this.fetchRecord(channel), v = this.view(rec, channel);
      if (!p.channel && channel !== this.channel()) throw U.fail('stale_update', 'The channel changed. Check again.');
      if (!v.available || !rec.latest) throw U.fail('no_update', rec.error || 'No newer release is available.');
      if (p.tag && p.tag !== rec.latest.tag) throw U.fail('stale_update', 'The selected release changed. Check again.');
      U.selectAsset(rec.latest, this.arch);
      if (!p.confirm) return { needsConfirm: true, to: rec.latest.tag, channel, message: 'Verify and install the macOS release, then restart the app and backend. herdr sessions and board data stay in place.' };
      if (p.confirm !== true) throw U.fail('bad_request', 'confirm must be true.');
      this.job = null;
      this.setJob({ kind: 'update', phase: 'prepare', step: 'download', to: rec.latest.tag, error: null, startedAt: Date.now() });
      this.runUpdate(rec.latest).catch(() => {});
      return { started: true, to: rec.latest.tag };
    } finally { this.applying = false; }
  }
  async runUpdate(release) {
    try {
      const prepared = await this.prepare({ dir: this.dir, release, apiUrl: this.apiUrl, arch: this.arch, currentBundle: this.running.bundle,
        protocol: this.b.herdrCompat?.ok ? this.b.herdrCompat.protocol : null,
        step: (step, detail) => this.setJob({ step, bytes: null, ...(detail || {}) }), log: line => this.log(line) });
      if (this.stopped) throw U.fail('backend_stopped', 'Backend stopped during update preparation.');
      this.setJob({ verification: prepared.verification });
      await this.swap({ prepared, to: { tag: release.tag, version: release.version } });
    } catch (e) {
      this.log(`update failed: ${e.stack || e.message}`);
      this.setJob({ phase: 'failed', error: String(e.message || e).slice(0, 700) });
    }
  }
  leave(p, c) {
    this.local(c);
    if (this.job?.phase !== 'restarting') throw U.fail('not_restarting', 'No update restart is pending.');
    const pid = Number(p.pid);
    if (!Number.isSafeInteger(pid) || pid < 2 || pid === process.pid) throw U.fail('bad_request', 'Expected the Electron main PID.');
    if (!this.leaving.some(x => x.pid === pid)) this.leaving.push({ pid, args: relaunchArgsOf(p.args, this.b.cfg.profile) });
    return { ok: true };
  }
  async swap({ prepared, to }) {
    // The helper and its Node/dylibs live outside the .app being renamed.
    const helperDir = fs.mkdtempSync(path.join(this.dir, '.helper-'));
    fs.cpSync(path.join(this.codeRoot, 'runtime'), path.join(helperDir, 'runtime'), { recursive: true, verbatimSymlinks: true });
    for (const f of ['update-swap.mjs', 'update.mjs', 'update-verify.mjs', 'update-native.mjs', 'update-version.mjs', 'runtime.mjs']) fs.copyFileSync(path.join(HERE, f), path.join(helperDir, f));
    this.setJob({ phase: 'restarting', step: null }); this.leaving = [];
    this.b.api.broadcast('update.restart', { kind: 'update', from: { tag: this.running.tag, version: this.running.version }, to });
    await sleep(this.leaveWaitMs);
    const cfg = this.b.cfg;
    const profileEnv = { ATRIUM_PROFILE: cfg.profile, ATRIUM_DATA_DIR: cfg.dataDir, ATRIUM_PORT: String(cfg.port), ATRIUM_HERDR_SESSION: cfg.herdrSession };
    const job = { format: 1, kind: 'update', installDir: this.dir, targetBundle: this.running.bundle, preparedBundle: prepared.bundle, staging: prepared.staging,
      from: { tag: this.running.tag, version: this.running.version }, to,
      waitPids: [process.pid, ...this.leaving.map(x => x.pid)], oldBackendPid: process.pid,
      relaunch: this.leaving.length > 0, healthMs: this.healthMs, arch: this.arch,
      protocol: this.b.herdrCompat?.ok ? this.b.herdrCompat.protocol : null, herdrServerPid: this.b.adapter?.serverPid?.() || null,
      cfg: { profile: cfg.profile, dataDir: cfg.dataDir, port: cfg.port, herdrSession: cfg.herdrSession, backendFile: cfg.backendFile || path.join(cfg.dataDir, 'backend.json') },
      profileEnv, helperDir, logFile: this.logFile };
    const file = path.join(helperDir, U.JOB_FILE); U.writeJson(file, job);
    // A failed spawn must not terminate the working backend.
    await this.spawnSwap(file, job);
    try { this.b.store.addEvent?.(null, 'update_swap', { kind: 'update', from: job.from, to }); } catch (e) { this.log(`update event: ${e.message}`); }
    setTimeout(() => Promise.resolve(this.b.stop('update')).then(() => this.exit(0)).catch(e => this.log(`backend stop failed: ${e.message}`)), 50);
    return { swapping: true };
  }
  defaultSpawnSwap(file, job) {
    return new Promise((resolve, reject) => {
      const p = spawn(path.join(job.helperDir, 'runtime/node'), [path.join(job.helperDir, 'update-swap.mjs'), file], { cwd: job.helperDir, env: U.cleanEnv(this.env), detached: true, stdio: 'ignore' });
      p.once('error', reject); p.once('spawn', () => { p.unref(); resolve({ pid: p.pid }); });
    });
  }
}
