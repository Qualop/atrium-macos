import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { findExecutable } from '../../backend/src/platform.mjs';
import { HERDR_VERSION } from '../../backend/src/config.mjs';

if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('macOS Apple Silicon 또는 Intel이 필요합니다.');
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node.js 24로 실행하세요.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appRoot = path.join(root, 'app');
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
  copy(process.execPath, path.join(resources, 'runtime/node'));
  copy(path.join(root, '.tools/herdr', `${HERDR_VERSION}-${process.arch}`, 'herdr'), path.join(resources, '.tools/herdr', `${HERDR_VERSION}-${process.arch}`, 'herdr'));
  const dirs = [...new Set([path.dirname(process.execPath), ...['claude', 'codex', 'gemini', 'agy'].map((name) => findExecutable(name)).filter(Boolean).map((p) => path.dirname(p)), path.join(process.env.HOME || '', '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'])];
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
  for (const [key, value] of Object.entries({ CFBundleDisplayName: 'Atrium', CFBundleName: 'Atrium', CFBundleIdentifier: 'dev.atrium.desktop.local', CFBundleShortVersionString: '0.1.0', CFBundleVersion: '1' })) {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
  }
  const icons = path.join(staging, 'Atrium.iconset'); fs.mkdirSync(icons);
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
    execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), path.join(appRoot, 'assets/atrium-icon-256.png'), '--out', path.join(icons, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', icons, '-o', path.join(resources, 'electron.icns')]);
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags', output], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', output], { stdio: 'inherit' });
  assertDestinationFree();
  fs.renameSync(output, destination);
  console.log(destination);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
