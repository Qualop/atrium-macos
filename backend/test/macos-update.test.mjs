import { macosVersionOf } from '../src/update-version.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import * as U from '../src/update.mjs';
import { Updater } from '../src/updater.mjs';
import { acquireRestartLeaseSync } from '../src/update-lease.mjs';
import { verifyBundle } from '../src/update-verify.mjs';
import { runSwap, validateJob, createLifecycle } from '../src/update-swap.mjs';
import { auditNativeBundle, bundleNativeBinary } from '../src/update-native.mjs';
const local = { auth: { kind: 'local' } };
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
function temp(t) { const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-update-fixture-'))); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const release = (tag = 'v0.5.0', extra = {}) => ({ tag_name: tag, prerelease: tag.includes('-'), html_url: `${U.RELEASES_URL}/tag/${tag}`, assets: [ { name: `Atrium-${tag.slice(1)}-macos-arm64.zip`, browser_download_url: `https://github.com/${U.UPDATE_REPO}/releases/download/${tag}/Atrium-${tag.slice(1)}-macos-arm64.zip` }, { name: 'SHA256SUMS.txt', browser_download_url: `https://github.com/${U.UPDATE_REPO}/releases/download/${tag}/SHA256SUMS.txt` } ], ...extra });
function crc(buf) { let c = 0xffffffff; for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  const locals = [], central = []; let offset = 0;
  for (const [name, spec] of Object.entries(files)) {
    const data = Buffer.from(typeof spec === 'object' ? spec.data : spec), n = Buffer.from(name), mode = typeof spec === 'object' ? spec.mode : 0o100644;
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x800, 6); l.writeUInt32LE(crc(data), 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt32LE(crc(data), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE((mode << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
    locals.push(l, n, data); central.push(c, n); offset += l.length + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const tinyZip = () => zip({ 'Atrium.app/Contents/Info.plist': '<plist/>', 'Atrium.app/Contents/Resources/native': 'fixture' });
function bundle(dir, version = '0.4.0', arch = 'arm64') {
  const root = U.resourcesOf(dir);
  write(path.join(dir, 'Contents/Info.plist'), '<plist/>');
  for (const p of ['app/package.json', 'backend/package.json']) write(path.join(root, p), JSON.stringify({ version }));
  write(path.join(root, 'runtime/update-manifest.json'), JSON.stringify({ format: 1, repository: U.UPDATE_REPO, bundleId: U.BUNDLE_ID, version, arch, node: '24.1.0', herdr: '0.9.5', herdrProtocols: [22] }));
  for (const p of ['runtime/node', '.tools/herdr/0.9.5-arm64/herdr', 'app/packaged-main.mjs', 'app/dist/index.html', 'app/dist/renderer.js', 'backend/src/main.mjs', 'backend/node_modules/ws/package.json', 'LICENSE.atrium', 'licenses/herdr-LICENSE']) write(path.join(root, p), 'fixture');
  return root;
}
function board(t, settings = {}) {
  const d = temp(t), app = path.join(d, 'Applications/Atrium.app'), root = bundle(app), meta = new Map(), events = [];
  const cfg = { profile: 'real', dataDir: path.join(d, 'profile'), logDir: path.join(d, 'profile/logs'), port: 49123, herdrSession: 'synthetic-update-fixture', backendFile: path.join(d, 'profile/backend.json') };
  const s = { updateCheck: false, updateChannel: 'stable', ...settings };
  const b = { cfg, herdrCompat: { ok: true, protocol: 22 }, store: { getMeta: k => meta.get(k), setMeta: (k, v) => meta.set(k, v), addEvent: (...e) => events.push(e) }, features: { settings: { get: () => s } }, api: { broadcast: (...e) => events.push(e) }, stop: async () => { events.push(['stop']); } };
  const up = new Updater(b, { codeRoot: root, platform: 'darwin', arch: 'arm64', env: {}, timers: false, fetchJson: async () => release() }); t.after(() => up.stop());
  return { d, app, root, b, s, up, meta, events };
}
function swapFixture(t) {
  const f = board(t), dir = path.join(f.b.cfg.dataDir, 'updates'), staging = path.join(dir, '.prepare-fixture'), preparedBundle = path.join(staging, 'extracted/Atrium.app'), helperDir = path.join(dir, '.helper-fixture'); bundle(preparedBundle, '0.5.0'); fs.mkdirSync(helperDir);
  write(path.join(f.app, 'original-marker'), 'original'); write(path.join(preparedBundle, 'new-marker'), 'new'); write(path.join(f.b.cfg.dataDir, 'board-state'), 'keep');
  const job = { format: 1, targetBundle: f.app, preparedBundle, staging, helperDir, installDir: dir, from: { tag: 'v0.4.0', version: '0.4.0' }, to: { tag: 'v0.5.0', version: '0.5.0' }, waitPids: [99999991, 99999992], oldBackendPid: 99999991, cfg: f.b.cfg, profileEnv: {}, arch: 'arm64', protocol: 22, relaunch: true };
  acquireRestartLeaseSync(job);
  const calls = [], lifecycle = { start: async (app, version) => { calls.push(['start', app, version]); return { version }; }, healthy: async h => { calls.push(['health', h.version]); return { pid: h.version === '0.5.0' ? 99999993 : 99999994 }; }, stop: async h => calls.push(['stop', h?.version]), relaunch: async p => calls.push(['relaunch', p]) };
  const deps = { lifecycle, verify: async () => ({ ok: true }), waitGone: async () => true, copyBundle: (a, b) => fs.cpSync(a, b, { recursive: true, verbatimSymlinks: true }) };
  return { ...f, job, calls, deps };
}
test('semantic versions and channels reject drafts, tag-only prereleases, and downgrades', () => {
  assert.ok(U.compareVersions('0.5.0', '0.5.0-dev.99') > 0); assert.ok(U.compareVersions('0.5.0-dev.10', '0.5.0-dev.2') > 0);
  assert.equal(U.parseVersion('01.0.0'), null); assert.equal(U.parseVersion('0.5.0-dev.01'), null);
  const all = [release('v0.5.0'), release('v0.6.0-dev.2', { prerelease: false }), release('v9.0.0', { draft: true })];
  assert.equal(U.pickRelease(all).version, '0.5.0'); assert.equal(U.pickRelease(all, 'dev').version, '0.6.0-dev.2');
  for (const v of ['22.13.0', '24.0.0', '26.0.0']) assert.ok(U.nodeSatisfies(v));
  for (const v of ['22.12.0', '23.0.0', '25.0.0', '27.0.0']) assert.equal(U.nodeSatisfies(v), false);
});
test('release asset selection uses the exact architecture ZIP and requires unique checksums', () => {
  const r = U.parseRelease(release()); assert.match(U.selectAsset(r, 'arm64').asset.name, /arm64.zip$/);
  assert.throws(() => U.selectAsset(r, 'x64'), { code: 'no_bundle_asset' }); assert.throws(() => U.selectAsset(r, 'ia32'), { code: 'unsupported_arch' });
  assert.throws(() => U.selectAsset({ ...r, assets: [...r.assets, r.assets[0]] }), { code: 'no_bundle_asset' });
  const sum = 'a'.repeat(64); assert.equal(U.checksumFor(`${sum}  fixture.zip\n`, 'fixture.zip'), sum);
  assert.throws(() => U.checksumFor(`${sum}  fixture.zip\n${sum}  fixture.zip`, 'fixture.zip'), { code: 'bad_checksum' });
});
test('GitHub URLs are repository-scoped; CDN is accepted only on a validated redirect', () => {
  const r = U.parseRelease(release()); assert.ok(U.checkDownloadUrl(r.assets[0].url).ok);
  for (const u of ['https://github.com/Gudals0320/atrium/releases/download/v1/x.zip', 'https://evil.test/x.zip', 'http://github.com/Qualop/atrium-macos/releases/download/v1/x.zip', 'https://user:password@github.com/Qualop/atrium-macos/releases/download/v1/x.zip', 'https://release-assets.githubusercontent.com/x']) assert.equal(U.checkDownloadUrl(u).ok, false);
  assert.ok(U.checkDownloadUrl('https://release-assets.githubusercontent.com/signed-fixture', undefined, { redirect: true }).ok);
  assert.equal(U.checkApiUrl('https://api.github.com/repos/Qualop/other/releases/latest').ok, false);
});
test('ZIP preflight rejects traversal, external links, link chains, case collisions and corrupt headers', () => {
  assert.equal(U.inspectZip(tinyZip()).entries, 2);
  assert.ok(U.inspectZip(zip({ 'Atrium.app/Contents/a': 'data', 'Atrium.app/Contents/b': { data: 'a', mode: 0o120777 } })));
  for (const files of [ { '../escape': 'bad' }, { 'Atrium.app/Contents/../../escape': 'bad' }, { 'Atrium.app/Contents/a': 'x', 'Atrium.app/Contents/A': 'y' }, { 'Atrium.app/Contents/a': { data: '/tmp/outside', mode: 0o120777 } }, { 'Atrium.app/Contents/a': { data: '../../outside', mode: 0o120777 } }, { 'Atrium.app/Contents/a': { data: 'b', mode: 0o120777 }, 'Atrium.app/Contents/b': { data: 'a', mode: 0o120777 } } ]) assert.throws(() => U.inspectZip(zip(files)), { code: 'bad_archive' });
  const broken = tinyZip(); broken.writeUInt32LE(0, 0); assert.throws(() => U.inspectZip(broken), { code: 'bad_archive' });
  assert.throws(() => U.inspectZip(tinyZip(), { maxBytes: 1 }), { code: 'bad_archive' });
});
test('actual ditto extracts a synthetic ZIP and preserves an internal bundle symlink', { skip: process.platform !== 'darwin' }, t => {
  const dir = temp(t), archive = path.join(dir, 'fixture.zip'); fs.writeFileSync(archive, zip({ 'Atrium.app/Contents/a': 'data', 'Atrium.app/Contents/b': { data: 'a', mode: 0o120777 } }));
  const app = U.extractZip(archive, path.join(dir, 'extracted')); assert.equal(fs.readFileSync(path.join(app, 'Contents/b'), 'utf8'), 'data'); assert.ok(fs.lstatSync(path.join(app, 'Contents/b')).isSymbolicLink());
});
test('prepare verifies SHA256 before extraction/signature and cleans corrupt staging', async t => {
  const dir = temp(t), r = U.parseRelease(release()), data = tinyZip(), sum = crypto.createHash('sha256').update(data).digest('hex'); let extracts = 0, verifies = 0;
  const fetchBuf = async url => url.endsWith('SHA256SUMS.txt') ? Buffer.from(`${sum}  ${r.assets[0].name}\n`) : data;
  const opts = { dir, release: r, arch: 'arm64', fetchBuf, extract: async (file, target) => { extracts++; return path.join(target, 'Atrium.app'); }, verify: async () => { verifies++; return { ok: true, info: { signature: 'adhoc' } }; } };
  const prepared = await U.prepareRelease(opts); assert.equal(extracts, 1); assert.equal(verifies, 1); assert.equal(prepared.digest, sum);
  await assert.rejects(U.prepareRelease({ ...opts, fetchBuf: async url => url.endsWith('SHA256SUMS.txt') ? Buffer.from(`${'0'.repeat(64)}  ${r.assets[0].name}\n`) : data }), { code: 'bad_checksum' });
  assert.equal(extracts, 1); assert.equal(verifies, 1); assert.deepEqual(fs.readdirSync(dir), [path.basename(prepared.staging)]);
});
test('failed signature verification cannot alter an installed app', async t => {
  const f = board(t), r = U.parseRelease(release()), data = tinyZip(), sum = crypto.createHash('sha256').update(data).digest('hex');
  await assert.rejects(U.prepareRelease({ dir: f.up.dir, release: r, arch: 'arm64', fetchBuf: async u => u.endsWith('SHA256SUMS.txt') ? Buffer.from(`${sum}  ${r.assets[0].name}`) : data, extract: async (_, dest) => path.join(dest, 'Atrium.app'), verify: async () => ({ ok: false, problems: ['invalid signature'] }) }), { code: 'bundle_verification_failed' });
  assert.equal(U.versionOfRoot(f.root), '0.4.0'); assert.deepEqual(fs.readdirSync(f.up.dir), []);
});
function verifierExec(version = '0.5.0', signature = 'Signature=adhoc\nTeamIdentifier=not set\n') {
  const calls = []; return { calls, exec: (cmd, args) => { calls.push([cmd, args]); if (cmd === '/bin/sh') return signature; if (cmd.includes('PlistBuddy')) return args[1].includes('CFBundleIdentifier') ? U.BUNDLE_ID : args[1].includes('CFBundleShortVersionString') ? macosVersionOf(version).baseVersion : macosVersionOf(version).bundleVersion; if (cmd.replace(/\\/g, '/').endsWith('/runtime/node')) return JSON.stringify({ node: '24.1.0', arch: 'arm64' }); return ''; } };
}
test('bundle verifier checks signature before executing Node and requires matching metadata, sqlite and protocols', async t => {
  const dir = temp(t), app = path.join(dir, 'Atrium.app'); bundle(app, '0.5.0'); const f = verifierExec();
  assert.equal((await verifyBundle(app, { version: '0.5.0', arch: 'arm64', protocol: 22, exec: f.exec, audit: () => ({ nativeFiles: 3 }) })).ok, true);
  assert.ok(f.calls.findIndex(([c]) => c.endsWith('/codesign')) < f.calls.findIndex(([c]) => c.replace(/\\/g, '/').endsWith('/runtime/node')));
  assert.ok(f.calls.find(([c, a]) => c.endsWith('/runtime/node') && a.join(' ').includes("node:sqlite")));
  const bad = await verifyBundle(app, { version: '0.5.0', arch: 'arm64', protocol: 999, exec: f.exec, audit: () => ({ nativeFiles: 3 }) }); assert.equal(bad.ok, false); assert.match(bad.problems[0], /protocol/);
  const missing = await verifyBundle(app, { version: '0.5.0', arch: 'x64', exec: f.exec, audit: () => ({ nativeFiles: 3 }) }); assert.equal(missing.ok, false);
});
test('signature failure and signing-team change reject the release without running downloaded Node', async t => {
  const dir = temp(t), app = path.join(dir, 'Atrium.app'), old = path.join(dir, 'Old.app'); bundle(app, '0.5.0'); bundle(old);
  let nodeRuns = 0; const f = verifierExec();
  const result = await verifyBundle(app, { version: '0.5.0', arch: 'arm64', exec: (cmd, args) => { if (cmd.replace(/\\/g, '/').endsWith('/runtime/node')) nodeRuns++; if (cmd.endsWith('/codesign')) throw Error('bad signature'); return f.exec(cmd, args); }, audit: () => ({ nativeFiles: 3 }) });
  assert.equal(result.ok, false); assert.equal(nodeRuns, 0);
  const changed = await verifyBundle(app, { version: '0.5.0', arch: 'arm64', currentBundle: old, exec: (cmd, args) => cmd === '/bin/sh' ? `Authority=Developer ID\nTeamIdentifier=${args.at(-1) === old ? 'ORIGINAL' : 'OTHER'}\n` : f.exec(cmd, args), audit: () => ({ nativeFiles: 3 }) });
  assert.equal(changed.ok, false); assert.match(changed.problems[0], /signing team/);
});
test('source and dev boards are check-only and web/device clients cannot install or claim a window PID', async t => {
  const f = board(t); assert.equal(f.up.view().allowed, true);
  await assert.rejects(f.up.apply({ confirm: true }, { auth: { kind: 'device' } }), { code: 'forbidden' }); await assert.rejects(f.up.apply({ confirm: true }), { code: 'forbidden' });
  assert.throws(() => f.up.leave({ pid: 99999992 }, { auth: { kind: 'device' } }), { code: 'forbidden' });
  f.b.cfg.profile = 'dev'; await assert.rejects(f.up.apply({ confirm: true }, local), { code: 'dev_profile' });
  f.b.cfg.profile = 'real'; f.up.running.bundle = null; assert.equal(f.up.view().reason, 'source_install'); assert.equal((await f.up.check()).available, true);
});
test('channel races discard the previous channel and stable never offers a downgrade from dev', async t => {
  const f = board(t); let releaseGate; const gate = new Promise(r => { releaseGate = r; });
  f.up.fetchJson = async url => { if (url.includes('/latest')) { await gate; return release('v0.5.0'); } return [release('v0.6.0-dev.2')]; };
  const first = f.up.check(); await Promise.resolve(); f.s.updateChannel = 'dev'; const next = f.up.channelChanged(); releaseGate(); await first; await next;
  assert.equal(f.up.view().latest.tag, 'v0.6.0-dev.2'); assert.equal(f.meta.get('update').channel, 'dev');
  f.up.running.version = '0.6.0-dev.2'; f.s.updateChannel = 'stable'; await f.up.check(); assert.equal(f.up.view().available, false);
});
test('apply refreshes selection, rejects stale confirmation and concurrent starts, and leaves channel unchanged', async t => {
  const f = board(t); await assert.rejects(f.up.apply({ confirm: true, tag: 'v0.4.9' }, local), { code: 'stale_update' });
  const confirmation = await f.up.apply({}, local); assert.equal(confirmation.needsConfirm, true); assert.equal(f.up.job, null);
  let finish; f.up.fetchJson = () => new Promise(r => { finish = r; }); const pending = f.up.apply({}, local);
  await assert.rejects(f.up.apply({}, local), { code: 'update_busy' }); finish(release()); await pending;
  assert.equal(f.s.updateChannel, 'stable');
});
test('successful bundle swap keeps data and a recoverable previous bundle', async t => {
  const f = swapFixture(t), result = await runSwap(f.job, f.deps); assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(path.join(f.app, 'new-marker'), 'utf8'), 'new'); assert.equal(fs.readFileSync(path.join(result.backupBundle, 'original-marker'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(f.b.cfg.dataDir, 'board-state'), 'utf8'), 'keep'); assert.equal(f.calls.filter(c => c[0] === 'stop').length, 0); assert.equal(U.readResult(f.job.installDir).ok, true);
});
test('failed candidate health stops only the injected candidate and restores the original app/backend', async t => {
  const f = swapFixture(t); f.deps.lifecycle.healthy = async h => { if (h.version === '0.5.0') throw Error('synthetic failed health'); return { pid: 99999994 }; };
  const result = await runSwap(f.job, f.deps); assert.equal(result.ok, false); assert.equal(result.rolledBack, true); assert.equal(fs.readFileSync(path.join(f.app, 'original-marker'), 'utf8'), 'original');
  assert.deepEqual(f.calls.filter(c => c[0] === 'stop'), [['stop', '0.5.0']]); assert.ok(f.calls.some(c => c[0] === 'start' && c[2] === '0.4.0'));
  assert.equal(fs.readFileSync(path.join(f.b.cfg.dataDir, 'board-state'), 'utf8'), 'keep');
});
test('an old process that remains running prevents all rename/start/stop operations', async t => {
  const f = swapFixture(t); f.deps.waitGone = async () => false; f.deps.rename = () => assert.fail('must not rename');
  const result = await runSwap(f.job, f.deps); assert.equal(result.ok, false); assert.equal(result.rolledBack, false); assert.match(result.error, /still running/); assert.equal(f.calls.some(c => ['start', 'stop'].includes(c[0])), false);
});
test('failure between renames restores the original bundle; rollback failure retains explicit recovery path', async t => {
  const f = swapFixture(t); let n = 0; f.deps.rename = (a, b) => { if (++n === 2) throw Error('synthetic rename failure'); fs.renameSync(a, b); };
  const result = await runSwap(f.job, f.deps); assert.equal(result.rolledBack, true); assert.equal(fs.readFileSync(path.join(f.app, 'original-marker'), 'utf8'), 'original');
  const g = swapFixture(t); g.deps.lifecycle.healthy = async () => { throw Error('synthetic health failure'); }; const failed = await runSwap(g.job, g.deps);
  assert.match(failed.rollbackError, /health failure/); assert.equal(g.calls.filter(c => c[0] === 'relaunch').length, 0); assert.equal(fs.existsSync(g.app), true);
});
test('jobs cannot move a bundle with board data inside, or escape private staging', t => {
  const f = swapFixture(t); assert.doesNotThrow(() => validateJob(f.job)); assert.throws(() => validateJob({ ...f.job, preparedBundle: '/tmp/untrusted/Atrium.app' }), { code: 'bad_job' }); assert.throws(() => validateJob({ ...f.job, cfg: { ...f.job.cfg, dataDir: path.join(f.app, 'board') } }), { code: 'bad_job' });
});
test('native audit rejects external libraries and RPATHs; packaging relocates and licenses dependencies', t => {
  const dir = temp(t), app = path.join(dir, 'Atrium.app'), binary = path.join(app, 'Contents/Resources/runtime/node'), library = path.join(dir, 'Cellar fixture/libfixture.dylib');
  const macho = Buffer.from([0xcf, 0xfa, 0xed, 0xfe]); write(binary, macho); write(library, macho);
  const auditExec = (cmd, args) => cmd.endsWith('/otool') ? args[0] === '-L' ? `${args.at(-1)}:\n\t${library} (compatibility version 1.0.0)\n` : '' : '';
  assert.throws(() => auditNativeBundle(app, { exec: auditExec, arch: 'arm64' }), /external/);
  const calls = [], licenses = []; const copied = bundleNativeBinary(binary, path.join(app, 'Contents/Resources/runtime/lib'), { onLibrary: p => licenses.push(p), exec: (cmd, args) => { calls.push([cmd, args]); if (cmd.endsWith('/otool') && args[0] === '-L') return `${args.at(-1)}:\n\t${args.at(-1) === binary ? library : '/usr/lib/libSystem.B.dylib'} (compatibility version 1.0.0)\n`; return ''; } });
  assert.equal(copied.size, 1); assert.deepEqual(licenses, [library]); assert.ok(calls.some(([c, a]) => c.endsWith('/install_name_tool') && a.includes('@loader_path/lib/libfixture.dylib')));
});
test('synthetic HTTP release assets handle safe redirects, limits and cross-origin rejection', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/asset' }); res.end(); }
    else if (req.url === '/evil') { res.writeHead(302, { location: 'http://example.invalid/asset' }); res.end(); }
    else if (req.url === '/asset') { res.end('synthetic-asset'); }
    else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(release())); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`, apiUrl = `${origin}/releases/latest`;
  assert.equal((await U.download(`${origin}/redirect`, { apiUrl })).toString(), 'synthetic-asset'); assert.equal((await U.httpGetJson(apiUrl)).tag_name, 'v0.5.0');
  await assert.rejects(U.download(`${origin}/evil`, { apiUrl }), { code: 'bad_download_url' }); await assert.rejects(U.download(`${origin}/asset`, { apiUrl, maxBytes: 1 }), { code: 'download_too_large' });
});

test('lifecycle starts bundled Node with the exact profile and verifies the spawned PID/root/version', async t => {
  const { EventEmitter } = await import('node:events');
  const f = swapFixture(t), calls = [], pid = 99999995;
  f.job.profileEnv = { ATRIUM_PROFILE: f.b.cfg.profile, ATRIUM_DATA_DIR: f.b.cfg.dataDir, ATRIUM_PORT: String(f.b.cfg.port), ATRIUM_HERDR_SESSION: f.b.cfg.herdrSession };
  f.job.healthMs = 40; f.job.herdrServerPid = 99999996;
  const root = U.resourcesOf(f.app), status = { pid, port: f.b.cfg.port, profile: 'real', dataDir: f.b.cfg.dataDir, version: { version: '0.4.0', root }, herdr: { connected: true, session: f.b.cfg.herdrSession, serverPid: 99999996 } };
  write(path.join(root, 'backend/src/client.mjs'), `export const health=async()=>({ok:true,pid:${pid}});export class ApiClient{async open(){}async call(){return ${JSON.stringify(status)}}close(){}}`);
  U.writeJson(f.b.cfg.backendFile, { pid, port: f.b.cfg.port, token: 'synthetic-only' });
  const lifecycle = createLifecycle(f.job, { pause: async () => {}, spawnProcess: (cmd, args, opts) => { calls.push([cmd, args, opts]); const child = new EventEmitter(); child.pid = pid; child.exitCode = null; child.unref = () => {}; child.kill = signal => { calls.push(['kill-own-child', signal]); child.exitCode = 0; }; return child; } });
  const handle = await lifecycle.start(f.app, '0.4.0'); assert.deepEqual(await lifecycle.healthy(handle), { pid, port: f.b.cfg.port });
  assert.equal(calls[0][0], path.join(root, 'runtime/node')); assert.equal(calls[0][2].env.ATRIUM_DATA_DIR, f.b.cfg.dataDir); assert.equal(calls[0][2].env.ATRIUM_HERDR_SESSION, 'synthetic-update-fixture');
  handle.version = '0.5.0'; await assert.rejects(lifecycle.healthy(handle), /version\/profile\/herdr/);
  await lifecycle.stop(handle); assert.deepEqual(calls.at(-1), ['kill-own-child', 'SIGTERM']);
});
test('pre-swap verification failure restarts the previous backend only after its PID has exited', async t => {
  const f = swapFixture(t); f.deps.verify = async () => ({ ok: false, problems: ['fixture verify failed'] });
  const result = await runSwap(f.job, f.deps); assert.equal(result.ok, false); assert.equal(result.rolledBack, false);
  assert.ok(f.calls.some(c => c[0] === 'start' && c[2] === '0.4.0')); assert.equal(fs.readFileSync(path.join(f.app, 'original-marker'), 'utf8'), 'original');
});
test('native inspection handles helper parentheses, dylib install IDs and inherited framework paths', async t => {
  const { nativeInfo } = await import('../src/update-native.mjs');
  const dir = temp(t), app = path.join(dir, 'Atrium.app'), helper = path.join(app, 'Contents/Frameworks/Helper (GPU).app/Contents/MacOS/Helper (GPU)'), dylib = path.join(app, 'Contents/Frameworks/fixture.dylib');
  const macho = Buffer.from([0xcf, 0xfa, 0xed, 0xfe]); write(helper, macho); write(dylib, macho);
  const exec = (cmd, args) => {
    if (!cmd.endsWith('/otool')) return '';
    assert.ok(args.includes('-m'), 'Disable archive(member) parsing for helper names.');
    const file = args.at(-1);
    if (args[0] === '-hv') return file === helper ? 'EXECUTE' : 'DYLIB';
    if (args[0] === '-L') return `${file}:\n\t@rpath/fixture.dylib (compatibility version 1.0.0)\n`;
    return file === helper ? 'cmd LC_RPATH\ncmdsize 40\npath @executable_path/../../.. (offset 12)' : 'cmd LC_ID_DYLIB\ncmdsize 40\nname @rpath/fixture.dylib (offset 24)';
  };
  assert.deepEqual(nativeInfo(dylib, exec).deps, []); assert.equal(auditNativeBundle(app, { exec, arch: 'arm64' }).nativeFiles, 2);
});
test('packager-generated ditto ZIPs pass the same preflight used by the updater', { skip: process.platform !== 'darwin' }, async t => {
  const { execFileSync } = await import('node:child_process'); const dir = temp(t), app = path.join(dir, 'Atrium.app'), archive = path.join(dir, 'release.zip');
  write(path.join(app, 'Contents/fixture'), 'data'); fs.symlinkSync('fixture', path.join(app, 'Contents/link'));
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive]);
  assert.ok(U.inspectZip(fs.readFileSync(archive)).entries >= 3);
  const extracted = U.extractZip(archive, path.join(dir, 'extracted')); assert.equal(fs.readFileSync(path.join(extracted, 'Contents/link'), 'utf8'), 'data');
});

test('loopback API and dev installation require all explicit temporary update-test boundaries', t => {
  const f = board(t);
  assert.throws(() => new Updater(f.b, { timers: false, codeRoot: f.root, env: { ATRIUM_UPDATE_API: 'http://127.0.0.1:12345/releases/latest' } }), { code: 'unsafe_update_api' });
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-update-e2e-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'Applications/Atrium.app'); bundle(app);
  const cfg = { profile: 'dev', port: 49999, dataDir: path.join(root, 'data'), herdrSession: 'atrium-dev-update-synthetic' };
  const env = { ATRIUM_UPDATE_TEST: '1', ATRIUM_UPDATE_TEST_ROOT: root, ATRIUM_PROFILE: 'dev', ATRIUM_DATA_DIR: cfg.dataDir, ATRIUM_APP_USERDATA: path.join(root, 'electron'), HOME: path.join(root, 'home') };
  const running = { bundle: app };
  assert.equal(U.isolatedUpdateTest(cfg, env, running), true);
  assert.equal(U.installAllowed(cfg, path.join(cfg.dataDir, 'updates'), { running, platform: 'darwin', env }).ok, true);
  for (const [key, value] of [['ATRIUM_UPDATE_TEST', '0'], ['ATRIUM_PROFILE', 'real'], ['ATRIUM_APP_USERDATA', '/Applications'], ['HOME', '/Users/user']]) assert.equal(U.isolatedUpdateTest(cfg, { ...env, [key]: value }, running), false);
  assert.equal(U.isolatedUpdateTest({ ...cfg, profile: 'real' }, env, running), false);
  assert.equal(U.isolatedUpdateTest({ ...cfg, port: 47800 }, env, running), false);
  assert.equal(U.isolatedUpdateTest(cfg, env, { bundle: '/Applications/Atrium.app' }), false);
});
test('native relaunch directly spawns the installed app and preserves scoped profile/API environment', async t => {
  const { EventEmitter } = await import('node:events'), f = swapFixture(t), calls = [];
  f.job.cfg.profile = 'dev'; f.job.profileEnv = { ATRIUM_PROFILE: 'dev', ATRIUM_DATA_DIR: f.b.cfg.dataDir, ATRIUM_APP_USERDATA: path.join(f.d, 'electron'), ATRIUM_UPDATE_API: 'http://127.0.0.1:12345/releases/latest' };
  const lifecycle = createLifecycle(f.job, { spawnProcess: (exe, args, opts) => { calls.push({ exe, args, opts }); const child = new EventEmitter(); child.pid = 99999998; child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child; } });
  const opened = await lifecycle.relaunch(f.app); assert.equal(opened.pid, 99999998); assert.equal(calls[0].exe, path.join(f.app, 'Contents/MacOS/Electron')); assert.deepEqual(calls[0].args, ['--dev']);
  for (const [key, value] of Object.entries(f.job.profileEnv)) assert.equal(calls[0].opts.env[key], value);
  assert.ok(calls[0].opts.env.PATH.startsWith(path.join(U.resourcesOf(f.app), 'runtime')));
});

test('macOS version mapping keeps stable 0.4.0 and separates dev marketing/build identity', () => {
  assert.deepEqual(macosVersionOf('0.4.0'), { version: '0.4.0', baseVersion: '0.4.0', bundleVersion: '0.4.0', channel: 'stable' });
  assert.deepEqual(macosVersionOf('0.4.1-dev.12'), { version: '0.4.1-dev.12', baseVersion: '0.4.1', bundleVersion: '12', channel: 'dev' });
  for (const value of ['0.4.1-dev.0', '0.4.1-dev.01', '0.4.1-beta.1', '0.4.1-dev.1+private', '../0.4.1', 'v0.4.1']) assert.throws(() => macosVersionOf(value), { code: 'invalid_release_version' });
});
test('bundle verification reads real stable/dev plist fields and retains full SemVer identity', { skip: process.platform !== 'darwin' }, async t => {
  const { execFileSync } = await import('node:child_process');
  for (const version of ['0.4.0', '0.4.1-dev.1', '0.4.1-dev.12']) {
    const dir = temp(t), app = path.join(dir, 'Atrium.app'), root = bundle(app, version), native = macosVersionOf(version), f = verifierExec(version);
    const metadataFile = path.join(root, 'runtime/update-manifest.json'); const metadata = U.readJson(metadataFile); U.writeJson(metadataFile, { ...metadata, baseVersion: native.baseVersion, bundleVersion: native.bundleVersion });
    const plist = path.join(app, 'Contents/Info.plist'); write(plist, '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict/></plist>');
    for (const [key, value] of Object.entries({ CFBundleIdentifier: U.BUNDLE_ID, CFBundleShortVersionString: native.baseVersion, CFBundleVersion: native.bundleVersion })) execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist]);
    const exec = (cmd, args, opts) => cmd.includes('PlistBuddy') ? execFileSync(cmd, args, opts) : f.exec(cmd, args);
    const options = { version, arch: 'arm64', protocol: 22, exec, audit: () => ({ nativeFiles: 3 }) };
    const result = await verifyBundle(app, options); assert.equal(result.ok, true, result.problems.join('; ')); assert.equal(result.info.version, version); assert.equal(result.info.baseVersion, native.baseVersion); assert.equal(result.info.bundleVersion, native.bundleVersion);
    execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleVersion 999', plist]); f.calls.length = 0;
    const bad = await verifyBundle(app, options); assert.equal(bad.ok, false); assert.match(bad.problems[0], /plist version mismatch/); assert.equal(f.calls.some(([cmd]) => cmd.replace(/\\/g, '/').endsWith('/runtime/node')), false);
  }
});
test('dev verification rejects base-only or stale full-semver JSON despite a matching marketing version', async t => {
  for (const relative of ['app/package.json', 'backend/package.json', 'runtime/update-manifest.json']) {
    const dir = temp(t), app = path.join(dir, 'Atrium.app'), root = bundle(app, '0.4.1-dev.12'), f = verifierExec('0.4.1-dev.12');
    const file = path.join(root, relative), data = U.readJson(file); U.writeJson(file, { ...data, version: relative.startsWith('runtime/') ? '0.4.1-dev.11' : '0.4.1' });
    const result = await verifyBundle(app, { version: '0.4.1-dev.12', arch: 'arm64', exec: f.exec, audit: () => ({ nativeFiles: 3 }) }); assert.equal(result.ok, false); assert.match(result.problems[0], /release versions disagree/); assert.equal(f.calls.some(([cmd]) => cmd.replace(/\\/g, '/').endsWith('/runtime/node')), false);
  }
});
