import { macosVersionOf } from '../../backend/src/update-version.mjs';
import { bundleNativeBinary, nativeFiles, auditNativeBundle } from '../../backend/src/update-native.mjs';
import { copyRuntimeLicenses } from './licenses.mjs';
import { requireSupportedNode } from '../../backend/src/runtime.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { HERDR_VERSION, HERDR_PROTOCOLS } from '../../backend/src/config.mjs';

if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('macOS Apple Silicon 또는 Intel이 필요합니다.');
requireSupportedNode();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appRoot = path.join(root, 'app');
const version = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;
const nativeVersion = macosVersionOf(version);
if (JSON.parse(fs.readFileSync(path.join(root, 'backend/package.json'), 'utf8')).version !== version) throw new Error('App/backend release versions disagree.');
const destination = path.join(root, 'out', 'Atrium.app');
function assertDestinationFree() {
  try { fs.lstatSync(destination); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`이미 있는 패키지를 먼저 다른 위치로 옮기세요: ${destination}`);
}
assertDestinationFree();
execFileSync(process.execPath, [path.join(appRoot, 'scripts/build.mjs')], { stdio: 'inherit' });
fs.mkdirSync(path.dirname(destination), { recursive: true });
const staging = fs.mkdtempSync(path.join(path.dirname(destination), '.atrium-package-'));
const output = path.join(staging, 'Atrium.app');
try {
  execFileSync('/usr/bin/ditto', [path.join(appRoot, 'node_modules/electron/dist/Electron.app'), output]);
  const resources = path.join(output, 'Contents/Resources');
  const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true, dereference: true }); };
  for (const p of ['src', 'dist', 'assets', 'package.json', 'THIRD_PARTY_NOTICES.txt']) copy(path.join(appRoot, p), path.join(resources, 'app', p));
  copy(path.join(appRoot, 'node_modules/react'), path.join(resources, 'app/node_modules/react'));
  for (const p of ['src', 'bin', 'scripts', 'package.json', 'node_modules/ws']) copy(path.join(root, 'backend', p), path.join(resources, 'backend', p));
  copy(path.join(root, 'LICENSE'), path.join(resources, 'LICENSE.atrium'));
  for (const notice of ['LICENSE', 'LICENSES.chromium.html']) copy(path.join(appRoot, 'node_modules/electron/dist', notice), path.join(resources, 'licenses/electron', notice));
  copy(path.join(appRoot, 'licenses/herdr-LICENSE'), path.join(resources, 'licenses/herdr-LICENSE'));
  copyRuntimeLicenses([appRoot, path.join(root, 'backend')], path.join(resources, 'licenses/npm'));
  copy(process.execPath, path.join(resources, 'runtime/node'));
  const nodeLicense = path.resolve(path.dirname(process.execPath), '../LICENSE');
  if (fs.existsSync(nodeLicense)) copy(nodeLicense, path.join(resources, 'runtime/LICENSE.node'));
  copy(path.join(root, '.tools/herdr', `${HERDR_VERSION}-${process.arch}`, 'herdr'), path.join(resources, '.tools/herdr', `${HERDR_VERSION}-${process.arch}`, 'herdr'));
  // Homebrew builds can depend on Cellar dylibs. Relocate those libraries
  // before signing, and fail if their redistribution licenses are missing.
  const copiedLibraries = new Map();
  const collectLicense = (library) => {
    const prefix = path.resolve(path.dirname(library), '..');
    const candidates = [];
    const scan = (dir, depth) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isFile() && /^(licen[cs]e|copying|copyright|notice)([._-]|$)/i.test(e.name)) candidates.push(f);
        else if (e.isDirectory() && depth > 0) scan(f, depth - 1);
      }
    };
    scan(prefix, 0); scan(path.join(prefix, 'share/doc'), 3);
    if (!candidates.length) throw new Error(`Native dependency license missing: ${path.basename(library)}. Use an official self-contained Node distribution or supply the dependency's license.`);
    for (const [i, f] of candidates.entries()) copy(f, path.join(resources, 'licenses/native', path.basename(library), `${i}-${path.basename(f)}`));
  };
  for (const [binary, source] of [[path.join(resources, 'runtime/node'), process.execPath], [path.join(resources, '.tools/herdr', `${HERDR_VERSION}-${process.arch}`, 'herdr'), path.join(root, '.tools/herdr', `${HERDR_VERSION}-${process.arch}`, 'herdr')]]) {
    bundleNativeBinary(binary, path.join(resources, 'runtime/lib'), { source, copied: copiedLibraries, onLibrary: collectLicense });
  }
  fs.writeFileSync(path.join(resources, 'runtime/update-manifest.json'), JSON.stringify({ format: 1, repository: 'Qualop/atrium-macos', bundleId: 'dev.atrium.desktop.local', version, baseVersion: nativeVersion.baseVersion, bundleVersion: nativeVersion.bundleVersion, arch: process.arch, node: process.versions.node, herdr: HERDR_VERSION, herdrProtocols: HERDR_PROTOCOLS }, null, 2));
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin'];
  fs.writeFileSync(path.join(resources, 'runtime/cli-paths.json'), JSON.stringify(dirs, null, 2));
  // Resolve the bundled runtime after installation, including when the app was
  // moved. Finder's minimal PATH must also support CLIs using /usr/bin/env node.
  fs.writeFileSync(path.join(resources, 'app/packaged-main.mjs'), [
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "const runtime = fileURLToPath(new URL('../runtime/', import.meta.url));",
    "process.env.PATH = [path.resolve(runtime), process.env.PATH || ''].join(path.delimiter);",
    "await import('./src/main/main.mjs');",
    '',
  ].join('\n'));
  const appManifest = path.join(resources, 'app/package.json');
  fs.writeFileSync(appManifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(appManifest, 'utf8')), main: 'packaged-main.mjs' }, null, 2));
  const plist = path.join(output, 'Contents/Info.plist');
  for (const [key, value] of Object.entries({ CFBundleDisplayName: 'Atrium', CFBundleName: 'Atrium', CFBundleIdentifier: 'dev.atrium.desktop.local', CFBundleShortVersionString: nativeVersion.baseVersion, CFBundleVersion: nativeVersion.bundleVersion })) {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
  }
  const icons = path.join(staging, 'Atrium.iconset'); fs.mkdirSync(icons);
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
    execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), path.join(appRoot, 'assets/atrium-icon-256.png'), '--out', path.join(icons, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', icons, '-o', path.join(resources, 'electron.icns')]);
  auditNativeBundle(output);
  for (const binary of [...nativeFiles(path.join(resources, 'runtime')), ...nativeFiles(path.join(resources, '.tools/herdr'))]) execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', binary], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags', output], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', output], { stdio: 'inherit' });
  assertDestinationFree();
  fs.renameSync(output, destination);
  console.log(destination);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
