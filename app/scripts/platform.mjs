import path from 'node:path';
export function electronExecutable(root, platform = process.platform) {
  const dist = path.join(root, 'node_modules', 'electron', 'dist');
  return platform === 'darwin' ? path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron') : path.join(dist, platform === 'win32' ? 'electron.exe' : 'electron');
}
