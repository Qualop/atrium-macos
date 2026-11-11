// macOS launches installed bundles directly. Source users retain the explicit
// source launcher, which may build local sources before opening Electron.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const marker = `${path.sep}Contents${path.sep}Resources${path.sep}app`;
const installed = root.endsWith(marker);
const bundle = installed ? root.slice(0, -marker.length) : null;
const args = process.argv.slice(2).filter(a => a !== '--dry-run');
if (bundle?.endsWith('.app')) {
  if (process.argv.includes('--dry-run')) console.log(JSON.stringify({ route: 'bundle', bundle, build: false }));
  else { const p = spawnSync('/usr/bin/open', ['-n', bundle, ...(args.length ? ['--args', ...args] : [])], { stdio: 'inherit' }); process.exitCode = p.status ?? 1; }
} else {
  const real = path.join(dir, 'real.mjs');
  if (!fs.existsSync(real)) { console.error('Launch Atrium.app from Applications. Source checkout launch requires app/scripts/real.mjs.'); process.exitCode = 1; }
  else { const p = spawnSync(process.execPath, [real, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' }); process.exitCode = p.status ?? 1; }
}
