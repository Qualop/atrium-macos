import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const windowsPath = (p) => /^[A-Za-z]:[\\/]|^(?:\\\\|\/\/)[^\\/]/.test(String(p));
export function resolvePath(p) {
  return windowsPath(p) ? path.win32.resolve(p).replace(/\\/g, '/') : path.resolve(p);
}
export function canonicalPath(p) {
  const resolved = resolvePath(p);
  if (windowsPath(p) && process.platform !== 'win32') return resolved;
  try { return fs.realpathSync.native(resolved).replace(/\\/g, '/'); } catch { return resolved; }
}

export function appDataDir({ platform = process.platform, env = process.env, home = os.homedir(), roaming = false } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') return (roaming ? env.APPDATA : env.LOCALAPPDATA) || p.join(home, 'AppData', roaming ? 'Roaming' : 'Local');
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support');
  return env.XDG_DATA_HOME || p.join(home, '.local', 'share');
}

export function findExecutable(name, { env = process.env, platform = process.platform } = {}) {
  if (typeof name !== 'string' || !name || name.includes('\0')) return null;
  const value = (key) => env[key] ?? (platform === 'win32' ? env[Object.keys(env).find((k) => k.toUpperCase() === key)] : undefined);
  const extensions = (value('PATHEXT') || '.EXE;.CMD;.BAT').toLowerCase().split(';').filter(Boolean);
  const suffixes = platform === 'win32' && !extensions.some((ext) => name.toLowerCase().endsWith(ext)) ? [...extensions, ''] : [''];
  const explicit = /[\\/]/.test(name);
  const dirs = explicit ? [''] : (value('PATH') || '').split(platform === 'win32' ? ';' : ':').filter(Boolean).map((dir) => platform === 'win32' ? dir.replace(/^"(.*)"$/, '$1') : dir);
  if (!explicit && platform !== 'win32' && env.HOME) dirs.push(path.join(env.HOME, '.local/bin')); // official agy installer / Finder PATH

  for (const dir of dirs) for (const ext of suffixes) {
    const file = explicit ? path.resolve(name + ext) : path.resolve(dir, name + ext);
    try { if (fs.statSync(file).isFile()) { fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return file; } } catch {}
  }
  return null;
}

// Windows cannot spawn npm's .cmd wrapper with shell:false. Resolve its
// installed package bin as data and use our Node runtime, without a shell.
export function nodeCliInvocation(executable, args, packageName, { platform = process.platform, nodePath = process.execPath } = {}) {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executable)) return { command: executable, args };
  const root = path.join(path.dirname(executable), 'node_modules', packageName);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const name = path.basename(executable).replace(/\.(?:cmd|bat)$/i, '');
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[name];
  if (manifest.name !== packageName || typeof bin !== 'string') throw new Error('Invalid CLI package');
  const entry = path.resolve(root, bin), relative = path.relative(root, entry);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.statSync(entry).isFile()) throw new Error('Invalid CLI entry');
  return { command: nodePath, args: [entry, ...args] };
}

export function defaultHerdrPath(version, { platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const installed = findExecutable('herdr', { platform, env });
  if (installed) return installed;
  if (platform === 'win32') return path.join(home, '.herdr', 'packages', 'standalone', 'releases', `${version}-x86_64-pc-windows-msvc`, 'herdr.exe');
  for (const file of [path.join(home, '.local', 'bin', 'herdr'), path.join(home, '.herdr', 'bin', 'herdr'), '/opt/homebrew/bin/herdr', '/usr/local/bin/herdr']) {
    try { if (fs.statSync(file).isFile()) { fs.accessSync(file, fs.constants.X_OK); return file; } } catch {}
  }
  return 'herdr';
}

export function herdrDirectory(session, { platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const root = env.XDG_CONFIG_HOME || (platform === 'win32' ? appDataDir({ platform, env, home, roaming: true }) : p.join(home, '.config'));
  return session ? p.join(root, 'herdr', 'sessions', session) : p.join(root, 'herdr');
}
export function herdrSocket(dir, platform = process.platform) {
  const socket = path.join(dir, 'herdr.sock');
  return platform === 'win32' ? '\\\\.\\pipe\\' + socket : socket;
}
