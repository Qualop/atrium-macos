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
  const suffixes = platform === 'win32' ? ['', ...(env.PATHEXT || '.EXE;.CMD;.BAT').toLowerCase().split(';')] : [''];
  const dirs = (env.PATH || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  for (const dir of dirs) for (const ext of suffixes) {
    const file = path.join(dir, name + ext);
    try { if (fs.statSync(file).isFile()) { fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return file; } } catch {}
  }
  return null;
}

export function defaultHerdrPath(version, { platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const installed = findExecutable('herdr', { platform, env });
  if (installed) return installed;
  if (platform === 'win32') return path.join(home, '.herdr', 'packages', 'standalone', 'releases', `${version}-x86_64-pc-windows-msvc`, 'herdr.exe');
  for (const file of [path.join(home, '.local', 'bin', 'herdr'), path.join(home, '.herdr', 'bin', 'herdr'), '/opt/homebrew/bin/herdr', '/usr/local/bin/herdr']) {
    try { fs.accessSync(file, fs.constants.X_OK); return file; } catch {}
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
