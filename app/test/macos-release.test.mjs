import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { macosVersionOf } from '../../backend/src/update-version.mjs';
import { parseRelease, pickRelease, selectAsset } from '../../backend/src/update.mjs';
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
function fixture(t, version, mismatch = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-release-version-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.join(root, 'out/Atrium.app'), resources = path.join(bundle, 'Contents/Resources'), native = macosVersionOf(version);
  write(path.join(root, 'app/scripts/release-macos.mjs'), fs.readFileSync(new URL('../scripts/release-macos.mjs', import.meta.url)));
  write(path.join(root, 'backend/src/update-version.mjs'), fs.readFileSync(new URL('../../backend/src/update-version.mjs', import.meta.url)));
  for (const file of ['app/package.json', 'backend/package.json']) write(path.join(root, file), JSON.stringify({ version }));
  for (const file of ['app/package.json', 'backend/package.json']) write(path.join(resources, file), JSON.stringify({ version: mismatch[file] || version }));
  write(path.join(resources, 'runtime/update-manifest.json'), JSON.stringify({ version: mismatch.manifestVersion || version, baseVersion: native.baseVersion, bundleVersion: native.bundleVersion, repository: 'Qualop/atrium-macos', arch: 'arm64' }));
  write(path.join(resources, 'runtime/node'), 'fixture'); write(path.join(bundle, 'Contents/MacOS/Electron'), 'fixture');
  const plist = path.join(bundle, 'Contents/Info.plist'); write(plist, '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict/></plist>');
  for (const [key, value] of Object.entries({ CFBundleShortVersionString: mismatch.shortVersion || native.baseVersion, CFBundleVersion: mismatch.bundleVersion || native.bundleVersion })) execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist]);
  write(path.join(root, 'preload.mjs'), `
import fs from 'node:fs';import path from 'node:path';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const real = cp.execFileSync;
cp.execFileSync = (cmd,args,opts) => {
  fs.appendFileSync(new URL('./calls.jsonl',import.meta.url),JSON.stringify([cmd,args])+'\\n');
  if(cmd==='/usr/libexec/PlistBuddy')return real(cmd,args,opts);
  if(cmd.endsWith('/runtime/node'))return 'arm64\\n';
  if(cmd==='/usr/bin/ditto'){if(args[0]==='-c')fs.writeFileSync(args.at(-1),'synthetic ZIP');else fs.cpSync(args[0],args[1],{recursive:true});return '';}
  if(cmd==='/usr/bin/hdiutil'){fs.writeFileSync(args.at(-1),'synthetic DMG');return '';}
  return '';
};syncBuiltinESMExports();
`);
  const run = () => spawnSync(process.execPath, ['--import', path.join(root, 'preload.mjs'), path.join(root, 'app/scripts/release-macos.mjs')], { env: { PATH: '/usr/bin:/bin', HOME: path.join(root, 'home') }, encoding: 'utf8', timeout: 10000 });
  return { root, bundle, run };
}
for (const version of ['0.4.0', '0.4.1-dev.1', '0.4.1-dev.12']) test(`release script emits architecture assets and exact SHA256 names for ${version}`, { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t, version), result = f.run(); assert.equal(result.status, 0, result.stderr);
  const dir = path.join(f.root, 'release', `v${version}`), stem = `Atrium-${version}-macos-arm64`;
  assert.deepEqual(fs.readdirSync(dir).sort(), [`${stem}.dmg`, `${stem}.zip`, 'SHA256SUMS.txt'].sort());
  const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8');
  for (const suffix of ['zip', 'dmg']) assert.ok(sums.includes(`${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, `${stem}.${suffix}`))).digest('hex')}  ${stem}.${suffix}`));
  const calls = fs.readFileSync(path.join(f.root, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.some(([cmd, args]) => cmd === '/usr/bin/codesign' && args.includes('--strict')));
  const again = f.run(); assert.notEqual(again.status, 0, 'Never overwrite previously built release assets.');
});
test('release script rejects plist/build/full-semver mismatches before creating archives', { skip: process.platform !== 'darwin' }, t => {
  for (const mismatch of [{ shortVersion: '0.4.1-dev.12' }, { bundleVersion: '11' }, { 'app/package.json': '0.4.1-dev.11' }, { manifestVersion: '0.4.1' }]) {
    const f = fixture(t, '0.4.1-dev.12', mismatch), result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /version|versions/); assert.equal(fs.existsSync(path.join(f.root, 'release')), false);
    const calls = fs.readFileSync(path.join(f.root, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); assert.equal(calls.some(([cmd]) => cmd === '/usr/bin/ditto' || cmd === '/usr/bin/hdiutil'), false);
  }
});
test('stable/dev selection uses full JSON SemVer and selects the dev asset for the requested architecture', () => {
  const release = version => ({ tag_name: `v${version}`, prerelease: version.includes('-'), assets: ['arm64', 'x64'].map(arch => ({ name: `Atrium-${version}-macos-${arch}.zip`, browser_download_url: `https://github.com/Qualop/atrium-macos/releases/download/v${version}/Atrium-${version}-macos-${arch}.zip` })).concat({ name: 'SHA256SUMS.txt', browser_download_url: `https://github.com/Qualop/atrium-macos/releases/download/v${version}/SHA256SUMS.txt` }) });
  const list = [release('0.4.0'), release('0.4.1-dev.2'), release('0.4.1-dev.12')];
  assert.equal(pickRelease(list, 'stable').version, '0.4.0'); const dev = pickRelease(list, 'dev'); assert.equal(dev.version, '0.4.1-dev.12');
  for (const arch of ['arm64', 'x64']) assert.equal(selectAsset(dev, arch).asset.name, `Atrium-0.4.1-dev.12-macos-${arch}.zip`);
  assert.equal(pickRelease([...list, release('0.4.1')], 'dev').version, '0.4.1'); assert.equal(parseRelease(release('0.4.1-dev.12')), null);
});
