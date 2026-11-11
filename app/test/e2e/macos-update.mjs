import { macosVersionOf } from '../../../backend/src/update-version.mjs';
// Parent runs this only AFTER packaging release assets. Never launch or change
// the supplied app: copy it to a fresh tmp tree, relabel that copy, and exercise
// the real download/verify/swap/backend/relaunch path against a loopback server.
// Required: ATRIUM_TEST_APP, ATRIUM_TEST_UPDATE_ZIP.
// Optional: ATRIUM_TEST_UPDATE_CHECKSUMS (defaults to sibling SHA256SUMS.txt),
// ATRIUM_TEST_UPDATE_ROLLBACK=1 (also exercise a signed, health-failing bundle).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { ApiClient } from '../../../backend/src/client.mjs';
import { checksumFor, readResult, isolatedUpdateTest, resourcesOf } from '../../../backend/src/update.mjs';
import { assertTestBoard } from './p9-guard.mjs';
if (process.platform !== 'darwin') throw Error('Native updater E2E requires macOS.');
const source = process.env.ATRIUM_TEST_APP && path.resolve(process.env.ATRIUM_TEST_APP);
const zip = process.env.ATRIUM_TEST_UPDATE_ZIP && path.resolve(process.env.ATRIUM_TEST_UPDATE_ZIP);
if (!source?.endsWith('.app') || !zip || !fs.statSync(source).isDirectory() || !fs.statSync(zip).isFile()) throw Error('Set ATRIUM_TEST_APP to the built app and ATRIUM_TEST_UPDATE_ZIP to its release ZIP.');
const manifest = JSON.parse(fs.readFileSync(path.join(resourcesOf(source), 'runtime/update-manifest.json'), 'utf8'));
assert.equal(manifest.repository, 'Qualop/atrium-macos'); assert.equal(manifest.version, '0.4.0', 'This integration fixture expects the v0.4.0 release candidate.');
const assetName = `Atrium-${manifest.version}-macos-${manifest.arch}.zip`;
const sumsFile = process.env.ATRIUM_TEST_UPDATE_CHECKSUMS || process.env.ATRIUM_TEST_UPDATE_SHA256SUMS || path.join(path.dirname(zip), 'SHA256SUMS.txt');
const originalZip = fs.readFileSync(zip), originalSums = fs.readFileSync(sumsFile, 'utf8');
assert.equal(crypto.createHash('sha256').update(originalZip).digest('hex'), checksumFor(originalSums, assetName), 'Release ZIP SHA256 mismatch.');
const oldVersion = '0.3.9';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
async function until(fn, label, ms = 90000) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch (e) { last = e; } await sleep(200); }
  throw Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
}
async function freePort() { const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
function sign(app) { execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags', app], { stdio: 'pipe' }); execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' }); }
function relabel(app, version) {
  const root = resourcesOf(app), nativeVersion = macosVersionOf(version);
  for (const relative of ['app/package.json', 'backend/package.json', 'runtime/update-manifest.json']) { const file = path.join(root, relative), value = json(file); assert.ok(value); value.version = version; if ('baseVersion' in value) value.baseVersion = nativeVersion.baseVersion; if ('bundleVersion' in value) value.bundleVersion = nativeVersion.bundleVersion; write(file, JSON.stringify(value, null, 2)); }
  for (const [key, value] of Object.entries({ CFBundleShortVersionString: nativeVersion.baseVersion, CFBundleVersion: nativeVersion.bundleVersion })) execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, path.join(app, 'Contents/Info.plist')]);
  sign(app);
}
// Cleanup is confined to an app executable inside the new test tree. No
// process-name matching, other profiles, user sessions, or /Applications writes.
function stopFixtureWindow(pid, target, root) {
  if (!Number.isSafeInteger(pid) || pid < 2 || !target.startsWith(root + path.sep)) return;
  try {
    const expected = path.join(target, 'Contents/MacOS/Electron');
    const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim();
    if (command === expected) process.kill(pid, 'SIGTERM');
    else throw Error('Refused to stop a process outside this fixture app.');
  } catch (error) { if (error.status !== 1 && error.code !== 'ESRCH') throw error; }
}
async function scenario(rollback) {
  const root = fs.realpathSync(fs.mkdtempSync('/private/tmp/atrium-update-e2e-')), target = path.join(root, 'Applications/Atrium.app');
  const session = `atrium-dev-update-${crypto.randomBytes(4).toString('hex')}`, port = await freePort();
  const paths = Object.fromEntries(['home', 'data', 'electron', 'project', 'codex', 'claude', 'claude-projects', 'claude-sessions', 'xdg', 'config', 'cache'].map(p => [p, path.join(root, p === 'config' ? 'c' : p)]));
  for (const dir of Object.values(paths)) fs.mkdirSync(dir, { recursive: true });
  execFileSync('/usr/bin/ditto', [source, target]); relabel(target, oldVersion);
  const freshHome = paths.home, herdr = path.join(resourcesOf(target), `.tools/herdr/${manifest.herdr}-${manifest.arch}/herdr`);
  // Also isolate HOME so CLI discovery and optional history readers cannot
  // touch user authentication, transcripts, trust settings, or shell rc files.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ATRIUM_|MTASK_|HERDR_|CLAUDE|CODEX|GEMINI|GOOGLE|ANTHROPIC|OPENAI|XDG_|ELECTRON_|NODE_|DYLD_)/.test(key)));
  const env = { ...inherited, HOME: freshHome, USERPROFILE: freshHome, PATH: [path.join(resourcesOf(target), 'runtime'), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter), SHELL: '/bin/zsh',
    ATRIUM_UPDATE_TEST: '1', ATRIUM_UPDATE_TEST_ROOT: root, ATRIUM_PROFILE: 'dev', ATRIUM_DATA_DIR: paths.data, ATRIUM_APP_USERDATA: paths.electron, ATRIUM_PORT: String(port), ATRIUM_HERDR_SESSION: session, ATRIUM_HERDR: herdr,
    ATRIUM_CLAUDE_JSON: path.join(paths.claude, 'claude.json'), ATRIUM_CLAUDE_PROJECTS: paths['claude-projects'], ATRIUM_CLAUDE_SESSIONS: paths['claude-sessions'], ATRIUM_CLAUDE_DESKTOP: 'none',
    ATRIUM_CODEX_HOME: paths.codex, CODEX_HOME: paths.codex, ATRIUM_CODEX_HISTORY: '0', CLAUDE_CONFIG_DIR: paths.claude,
    XDG_CONFIG_HOME: paths.config, XDG_CACHE_HOME: paths.cache, XDG_DATA_HOME: paths.xdg,
    ATRIUM_REMOTE_ENABLED: '0', ATRIUM_LEGACY_HERDR_SESSION: '', ATRIUM_LEGACY_DATA_DIR: '', ATRIUM_UPDATE_HEALTH_MS: rollback ? '5000' : '60000' };
  write(env.ATRIUM_CLAUDE_JSON, '{}'); assertTestBoard(env, { root });
  assert.ok(isolatedUpdateTest({ profile: 'dev', dataDir: paths.data, port, herdrSession: session }, env, { bundle: target }));
  let zipData = originalZip, sumsData = originalSums;
  if (rollback) {
    const badApp = path.join(root, 'bad/Atrium.app'), badZip = path.join(root, 'bad-release.zip'); execFileSync('/usr/bin/ditto', [source, badApp]);
    // Signature, metadata, runtime and ZIP remain valid; only backend startup
    // fails, so this exercises health rollback after the actual bundle rename.
    write(path.join(resourcesOf(badApp), 'backend/src/main.mjs'), "throw new Error('ATRIUM_SYNTHETIC_UPDATE_HEALTH_FAILURE');\n"); sign(badApp);
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', badApp, badZip]); zipData = fs.readFileSync(badZip); sumsData = `${crypto.createHash('sha256').update(zipData).digest('hex')}  ${assetName}\n`;
  }
  const server = http.createServer((req, res) => {
    if (req.url === '/releases/latest') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ tag_name: 'v0.4.0', prerelease: false, html_url: 'https://github.com/Qualop/atrium-macos/releases/tag/v0.4.0', body: 'Isolated native updater fixture', assets: [ { name: assetName, size: zipData.length, browser_download_url: `${origin}/assets/${assetName}` }, { name: 'SHA256SUMS.txt', browser_download_url: `${origin}/assets/SHA256SUMS.txt` } ] })); }
    else if (req.url === `/assets/${assetName}`) { res.setHeader('content-type', 'application/zip'); res.end(zipData); }
    else if (req.url === '/assets/SHA256SUMS.txt') res.end(sumsData);
    else { res.writeHead(404); res.end(); }
  });
  let origin, child, client, finalResult, before;
  const report = { root, session, port, rollback, source, zip, assertions: [] };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); origin = `http://127.0.0.1:${server.address().port}`; env.ATRIUM_UPDATE_API = `${origin}/releases/latest`;
    const log = fs.openSync(path.join(root, 'electron.log'), 'a');
    child = spawn(path.join(target, 'Contents/MacOS/Electron'), ['--dev'], { env, cwd: resourcesOf(target), stdio: ['ignore', log, log] }); fs.closeSync(log); let launchError; child.on('error', e => { launchError = e; });
    const info = await until(() => { if (launchError) throw launchError; return json(path.join(paths.data, 'backend.json')); }, 'fixture backend metadata');
    client = new ApiClient(info); await client.open(); before = await until(async () => { const s = await client.call('backend.status'); return s.herdr?.connected ? s : null; }, 'fixture herdr');
    assert.equal(before.profile, 'dev'); assert.equal(before.version.version, oldVersion); assert.equal(before.herdr.session, session); assert.ok(before.herdr.serverPid);
    await client.call('settings.set', { updateCheck: false, updateChannel: 'stable', tray: true });
    const shell = await client.call('session.spawn', { kind: 'shell', name: 'synthetic-update-pane', cwd: paths.project });
    const live = await until(async () => { const s = await client.call('session.get', { session: shell.sessionId }); return s.paneId ? s : null; }, 'shell fixture pane');
    const memo = await client.call('memo.create', { text: 'Native update preservation fixture · 한글', x: 10, y: 10 });
    const state = await client.call('update.check'); assert.equal(state.current.version, oldVersion); assert.equal(state.allowed, true); assert.equal(state.latest.tag, 'v0.4.0'); assert.equal(state.latest.installable, true);
    const started = await client.call('update.apply', { confirm: true, tag: 'v0.4.0' }); assert.equal(started.started, true);
    client.close(); client = null;
    finalResult = await until(() => { const r = readResult(path.join(paths.data, 'updates')); return r?.relaunchPid || r?.relaunchError || r?.rollbackError ? r : null; }, 'native swap result and relaunched window', 240000);
    if (rollback) { assert.equal(finalResult.ok, false); assert.equal(finalResult.rolledBack, true); assert.equal(finalResult.rollbackError, undefined); }
    else assert.equal(finalResult.ok, true, JSON.stringify(finalResult));
    assert.ok(finalResult.relaunchPid, 'Helper must restart a native window with the fixture environment.'); assert.equal(finalResult.relaunchError, undefined);
    const afterInfo = await until(() => { const value = json(path.join(paths.data, 'backend.json')); return value?.pid !== info.pid ? value : null; }, 'new fixture backend metadata');
    client = new ApiClient(afterInfo); await client.open(); const expected = rollback ? oldVersion : '0.4.0';
    const after = await until(async () => { const s = await client.call('backend.status'); return s.version?.version === expected && s.herdr?.connected ? s : null; }, 'new backend/herdr health');
    assert.equal(after.dataDir, paths.data); assert.equal(after.profile, 'dev'); assert.equal(after.port, port); assert.equal(after.herdr.session, session); assert.equal(after.herdr.serverPid, before.herdr.serverPid);
    const restored = await client.call('session.get', { session: shell.sessionId }); assert.equal(restored.sessionId, live.sessionId); assert.equal(restored.paneId, live.paneId); assert.equal(restored.herdrWorkspaceId, live.herdrWorkspaceId);
    assert.ok((await client.call('memo.list')).some(m => m.memoId === memo.memoId && m.text.includes('preservation fixture')));
    assert.equal(json(path.join(resourcesOf(target), 'app/package.json')).version, expected); assert.equal(json(path.join(resourcesOf(target), 'backend/package.json')).version, expected); assert.equal(json(path.join(resourcesOf(target), 'runtime/update-manifest.json')).version, expected);
    await until(() => { const content = fs.readFileSync(path.join(paths.data, 'logs/app-main.log'), 'utf8'); return content.includes(`version=${expected}`) && content.includes(`pid=${finalResult.relaunchPid}`); }, 'relaunched app kept the temporary profile');
    report.assertions.push('actual release ZIP and SHA256', 'codesign verification', 'native bundle swap', 'new backend PID and expected version', 'same herdr PID/session', 'same shell session/pane/workspace', 'memo data preserved', 'direct native relaunch preserved temporary profile', rollback ? 'failed-health automatic rollback' : 'v0.4.0 app/backend/manifest');
    report.ok = true; report.result = finalResult;
  } catch (error) { report.ok = false; report.error = error.stack; throw error; }
  finally {
    // Only the fixture's recorded native windows can be stopped. Close windows
    // first so they cannot restart the backend while its fixture is cleaned up.
    stopFixtureWindow(child?.pid, target, root); stopFixtureWindow(finalResult?.relaunchPid, target, root);
    await sleep(500);
    if (client) { await client.call('backend.shutdown').catch(() => {}); client.close(); }
    else { const info = json(path.join(paths.data, 'backend.json')); if (info) { const c = new ApiClient(info); try { await c.open(); await c.call('backend.shutdown'); } catch {} finally { c.close(); } } }
    // The explicitly generated herdr session is the only engine stopped.
    try { execFileSync(herdr, ['--session', session, 'server', 'stop'], { env, stdio: 'pipe', timeout: 15000 }); } catch (e) { report.cleanupError = e.message; }
    await new Promise(resolve => server.close(resolve)); write(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  }
  return report;
}
await scenario(false);
if (process.env.ATRIUM_TEST_UPDATE_ROLLBACK === '1') await scenario(true);
