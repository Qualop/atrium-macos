import { assertMacosVersions } from './update-version.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BUNDLE_ID, resourcesOf, cleanEnv, samePath } from './update.mjs';
import { supportedNode } from './runtime.mjs';
import { auditNativeBundle } from './update-native.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const plistValue = (bundle, key, exec) => String(exec('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8', timeout: 15000 })).trim();
export function signatureOf(bundle, exec = execFileSync) {
  exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { timeout: 120000, stdio: 'pipe' });
}
// runCodesign captures stderr without trusting arbitrary release metadata.
function signingDetails(bundle, exec) {
  try {
    return String(exec('/bin/sh', ['-c', 'exec /usr/bin/codesign -d --verbose=4 "$1" 2>&1', 'atrium-signature', bundle], { encoding: 'utf8', timeout: 15000 }));
  } catch { throw Error('Cannot read bundle signing identity.'); }
}
export async function verifyBundle(bundle, { version, arch = process.arch, protocol = null, currentBundle = null, exec = execFileSync, audit = auditNativeBundle } = {}) {
  const problems = [], info = { version: null, arch: null, signature: null };
  try {
    if (fs.lstatSync(bundle).isSymbolicLink() || !fs.lstatSync(bundle).isDirectory()) throw Error('Expected an app bundle directory.');
    const root = resourcesOf(bundle);
    // Verify the signature before running anything from the downloaded bundle.
    signatureOf(bundle, exec);
    const details = signingDetails(bundle, exec), team = /(?:^|\n)TeamIdentifier=([^\n]+)/.exec(details)?.[1];
    if (!/Signature=adhoc|Authority=/.test(details)) throw Error('Missing code signature.');
    if (currentBundle) {
      signatureOf(currentBundle, exec);
      const old = signingDetails(currentBundle, exec), oldTeam = /(?:^|\n)TeamIdentifier=([^\n]+)/.exec(old)?.[1];
      if (oldTeam && oldTeam !== 'not set' && team !== oldTeam) throw Error('Release signing team differs from the installed app.');
    }
    if (plistValue(bundle, 'CFBundleIdentifier', exec) !== BUNDLE_ID) throw Error('Unexpected app identifier.');
    const metadata = read(path.join(root, 'runtime/update-manifest.json'));
    const nativeVersion = assertMacosVersions(version, { shortVersion: plistValue(bundle, 'CFBundleShortVersionString', exec), bundleVersion: plistValue(bundle, 'CFBundleVersion', exec), appVersion: read(path.join(root, 'app/package.json')).version, backendVersion: read(path.join(root, 'backend/package.json')).version, manifestVersion: metadata.version, manifestBaseVersion: metadata.baseVersion, manifestBundleVersion: metadata.bundleVersion });
    info.version = version; info.baseVersion = nativeVersion.baseVersion; info.bundleVersion = nativeVersion.bundleVersion; info.arch = metadata.arch;
    if (metadata.format !== 1 || metadata.repository !== 'Qualop/atrium-macos' || metadata.bundleId !== BUNDLE_ID || metadata.version !== version || metadata.arch !== arch || !supportedNode(metadata.node)) throw Error('Incompatible bundle release metadata.');
    for (const f of ['runtime/node', `\u002etools/herdr/${metadata.herdr}-${arch}/herdr`, 'app/packaged-main.mjs', 'app/dist/index.html', 'app/dist/renderer.js', 'backend/src/main.mjs', 'backend/node_modules/ws/package.json', 'LICENSE.atrium', 'licenses/herdr-LICENSE']) {
      const full = path.join(root, f);
      if (!fs.statSync(full).isFile() || !fs.realpathSync(full).startsWith(fs.realpathSync(bundle) + path.sep)) throw Error(`Missing bundled runtime file: ${f}`);
    }
    const native = audit(bundle, { exec, arch });
    if (native.nativeFiles < 3) throw Error('Bundle lacks the native Electron, Node, or herdr runtime.');
    const node = path.join(root, 'runtime/node');
    const probe = readProbe(exec(node, ['--input-type=module', '-e', "import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(':memory:');d.close();console.log(JSON.stringify({node:process.versions.node,arch:process.arch}))"], { encoding: 'utf8', env: cleanEnv(), timeout: 15000 }));
    if (!supportedNode(probe.node) || probe.arch !== arch || probe.node !== metadata.node) throw Error('Bundled Node does not match release metadata.');
    if (protocol != null && !metadata.herdrProtocols?.includes(protocol)) throw Error('New bundle does not support the running herdr protocol.');
    info.signature = team && team !== 'not set' ? `team:${team}` : 'adhoc'; info.node = probe.node; info.herdr = metadata.herdr;
  } catch (e) { problems.push(String(e.message || e).slice(0, 700)); }
  return { ok: problems.length === 0, problems, info };
}
function readProbe(value) { return JSON.parse(String(value).trim().split('\n').at(-1)); }
export const verifyRoot = (root, opts) => verifyBundle(path.resolve(root, '../..'), opts);
if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  const bundle = process.argv[2], version = process.argv[3];
  if (!bundle || !version) { console.error('Usage: node update-verify.mjs <Atrium.app> <version>'); process.exitCode = 2; }
  else { const result = await verifyBundle(bundle, { version }); console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1; }
}
