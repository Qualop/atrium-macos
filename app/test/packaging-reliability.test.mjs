import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

// Run a copy of the packaging script against a tiny fake repository. Native
// build/signing tools and runtime copying are replaced inside the child only.
function fixture(t, version = '0.2.0') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-package-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  write('app/scripts/licenses.mjs', fs.readFileSync(new URL('../scripts/licenses.mjs', import.meta.url)));
  write('app/licenses/herdr-LICENSE', 'fixture license');
  write('app/scripts/package-macos.mjs', fs.readFileSync(new URL('../scripts/package-macos.mjs', import.meta.url)));
  const digest = crypto.createHash('sha256').update('download fixture').digest('hex');
  write('app/scripts/setup-macos.mjs', fs.readFileSync(new URL('../scripts/setup-macos.mjs', import.meta.url), 'utf8').replace(/'[a-f0-9]{64}'/g, `'${digest}'`));
  write('backend/src/update-version.mjs', fs.readFileSync(new URL('../../backend/src/update-version.mjs', import.meta.url)));
  write('backend/src/update-native.mjs', fs.readFileSync(new URL('../../backend/src/update-native.mjs', import.meta.url)));
  write('backend/src/runtime.mjs', fs.readFileSync(new URL('../../backend/src/runtime.mjs', import.meta.url)));
  write('backend/src/config.mjs', "export const HERDR_VERSION = '0.9.5'; export const HERDR_PROTOCOLS = [22];");
  write('backend/src/platform.mjs', 'export const findExecutable = () => null;');
  write('app/src/main/main.mjs', 'process.stdout.write(JSON.stringify({ path: process.env.PATH }));');
  write('app/package.json', JSON.stringify({ type: 'module', version, main: 'src/main/main.mjs' }));
  for (const file of ['app/dist/index.html', 'app/assets/atrium-icon-256.png', 'app/THIRD_PARTY_NOTICES.txt', 'app/node_modules/react/index.js', 'backend/bin/atrium.mjs', 'backend/scripts/bridge.mjs', 'backend/node_modules/ws/index.js', 'backend/node_modules/ws/LICENSE', 'LICENSE', `.tools/herdr/0.9.5-${process.arch}/herdr`, 'app/node_modules/electron/dist/LICENSE', 'app/node_modules/electron/dist/LICENSES.chromium.html', 'app/node_modules/electron/dist/Electron.app/Contents/Info.plist']) write(file, 'fixture');
  write('backend/package.json', JSON.stringify({name:'fixture-backend',version,dependencies:{}}));
  write('preload.mjs', `
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const copy = fs.cpSync;
const rename = fs.renameSync;
fs.renameSync = (...args) => { if (process.env.FIXTURE_FAIL_INSTALL === '1') throw new Error('fixture install failure'); return rename(...args); };
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from(process.env.FIXTURE_BAD_DIGEST ? 'corrupt fixture' : 'download fixture') });
fs.cpSync = (from, to, options) => {
  if (from === process.execPath) { fs.writeFileSync(to, '#!/bin/sh\\nprintf bundled-node', { mode: 0o755 }); return; }
  return copy(from, to, options);
};
cp.execFileSync = (command, args) => {
  fs.appendFileSync(new URL('./native-calls.jsonl', import.meta.url), JSON.stringify([command,args])+'\\n');
  if (command === 'npm') { fs.appendFileSync(new URL('./npm-calls', import.meta.url), 'npm\\n'); return; }
  if (command === '/usr/bin/ditto') { copy(args[0], args[1], { recursive: true }); return; }
  if (command === '/usr/bin/codesign' && process.env.FIXTURE_FAIL_SIGN === '1') throw new Error('fixture signing failure');
  return Buffer.from('');
};
if (process.env.FIXTURE_NODE_VERSION) Object.defineProperty(process.versions, 'node', { value: process.env.FIXTURE_NODE_VERSION });
syncBuiltinESMExports();
`);
  const env = { PATH: '/usr/bin:/bin', HOME: path.join(root, 'home') };
  const run = (extra = {}) => spawnSync(process.execPath, ['--import', path.join(root, 'preload.mjs'), path.join(root, 'app/scripts/package-macos.mjs')], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 10000 });
  const setup = (extra = {}) => spawnSync(process.execPath, ['--import', path.join(root, 'preload.mjs'), path.join(root, 'app/scripts/setup-macos.mjs')], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 10000 });
  return { root, run, setup, env };
}

test('packaging refuses unsupported Node before creating an output bundle', { skip: process.platform !== 'darwin' }, (t) => {
  const f = fixture(t), result = f.run({ FIXTURE_NODE_VERSION: '22.0.0' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Node.js 22.13/);
  assert.equal(fs.existsSync(path.join(f.root, 'out/Atrium.app')), false);
});

test('setup refuses corrupt downloads before dependency install and cleans failed replacements', { skip: process.platform !== 'darwin' }, (t) => {
  const f = fixture(t), folder = path.join(f.root, `.tools/herdr/0.9.5-${process.arch}`);
  const corrupt = f.setup({ FIXTURE_BAD_DIGEST: '1' });
  assert.notEqual(corrupt.status, 0); assert.match(corrupt.stderr, /체크섬/);
  assert.equal(fs.existsSync(path.join(f.root, 'npm-calls')), false);
  assert.equal(fs.readFileSync(path.join(folder, 'herdr'), 'utf8'), 'fixture');
  const failed = f.setup({ FIXTURE_FAIL_INSTALL: '1' });
  assert.notEqual(failed.status, 0); assert.match(failed.stderr, /fixture install failure/);
  assert.deepEqual(fs.readdirSync(folder), ['herdr']);
  assert.equal(fs.existsSync(path.join(f.root, 'npm-calls')), false);
  const retry = f.setup(); assert.equal(retry.status, 0, retry.stderr);
  assert.equal(fs.readFileSync(path.join(folder, 'herdr'), 'utf8'), 'download fixture');
  assert.equal(fs.statSync(path.join(folder, 'herdr')).mode & 0o777, 0o755);
  assert.equal(fs.readFileSync(path.join(f.root, 'npm-calls'), 'utf8'), 'npm\nnpm\n');
});

test('failed signing leaves no partial output and a clean retry succeeds', { skip: process.platform !== 'darwin' }, (t) => {
  const f = fixture(t), result = f.run({ FIXTURE_FAIL_SIGN: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'out/Atrium.app')), false);
  const retry = f.run();
  assert.equal(retry.status, 0, retry.stderr);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'out')), ['Atrium.app']);
});

test('a relocated installed bundle exposes its bundled Node to shebang CLI shims', { skip: process.platform !== 'darwin' }, (t) => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const moved = path.join(f.root, 'moved app/Atrium.app');
  fs.mkdirSync(path.dirname(moved)); fs.renameSync(path.join(f.root, 'out/Atrium.app'), moved);
  const resources = path.join(moved, 'Contents/Resources');
  const pkg = JSON.parse(fs.readFileSync(path.join(resources, 'app/package.json')));
  const started = spawnSync(process.execPath, [path.join(resources, 'app', pkg.main)], { env: f.env, encoding: 'utf8', timeout: 2000 });
  assert.equal(started.status, 0, started.stderr);
  const runtimePath = JSON.parse(started.stdout).path;
  assert.ok(runtimePath.split(':').includes(fs.realpathSync(path.join(resources, 'runtime'))));
  const shim = spawnSync('/usr/bin/env', ['node'], { env: { PATH: runtimePath }, encoding: 'utf8', timeout: 2000 });
  assert.equal(shim.stdout, 'bundled-node');
});

test('release bundle metadata does not contain the builder home or machine-specific CLI directories', { skip: process.platform !== 'darwin' }, t => {
 const f=fixture(t), result=f.run();assert.equal(result.status,0,result.stderr);
 const dirs=JSON.parse(fs.readFileSync(path.join(f.root,'out/Atrium.app/Contents/Resources/runtime/cli-paths.json'),'utf8'));
 assert.deepEqual(dirs,['/opt/homebrew/bin','/usr/local/bin']);assert.ok(!JSON.stringify(dirs).includes(f.root));
});

test('stable 0.4.0 packages unchanged numeric plist fields and full JSON release identity', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t, '0.4.0'), result = f.run(); assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(path.join(f.root, 'native-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const plistSets = calls.filter(([cmd]) => cmd === '/usr/libexec/PlistBuddy').map(([, args]) => args[1]);
  assert.ok(plistSets.includes('Set :CFBundleShortVersionString 0.4.0')); assert.ok(plistSets.includes('Set :CFBundleVersion 0.4.0'));
  const resources = path.join(f.root, 'out/Atrium.app/Contents/Resources');
  const metadata = JSON.parse(fs.readFileSync(path.join(resources, 'runtime/update-manifest.json')));
  assert.equal(metadata.version, '0.4.0'); assert.equal(metadata.baseVersion, '0.4.0'); assert.equal(metadata.bundleVersion, '0.4.0');
});
test('dev packages numeric marketing/build plist fields and retain full SemVer in every JSON manifest', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t, '0.4.1-dev.12'), result = f.run(); assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(path.join(f.root, 'native-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const plistSets = calls.filter(([cmd]) => cmd === '/usr/libexec/PlistBuddy').map(([, args]) => args[1]);
  assert.ok(plistSets.includes('Set :CFBundleShortVersionString 0.4.1')); assert.ok(plistSets.includes('Set :CFBundleVersion 12'));
  const resources = path.join(f.root, 'out/Atrium.app/Contents/Resources');
  for (const relative of ['app/package.json', 'backend/package.json', 'runtime/update-manifest.json']) assert.equal(JSON.parse(fs.readFileSync(path.join(resources, relative))).version, '0.4.1-dev.12');
  const metadata = JSON.parse(fs.readFileSync(path.join(resources, 'runtime/update-manifest.json'))); assert.equal(metadata.baseVersion, '0.4.1'); assert.equal(metadata.bundleVersion, '12');
});
test('invalid dev release versions fail packaging before any build or native tool invocation', { skip: process.platform !== 'darwin' }, t => {
  for (const version of ['0.4.1-dev.0', '0.4.1-dev.01', '0.4.1-beta.1', '0.4.1-dev.1+private']) {
    const f = fixture(t, version), result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Invalid macOS release version/); assert.equal(fs.existsSync(path.join(f.root, 'native-calls.jsonl')), false); assert.equal(fs.existsSync(path.join(f.root, 'out/Atrium.app')), false);
  }
});
