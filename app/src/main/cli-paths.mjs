import fs from 'node:fs';
import path from 'node:path';
// Discover on the recipient's Mac, never serialize the builder's home or PATH.
export function macCliDirectories(home, env = process.env) {
  const dirs = [path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.volta/bin'), path.join(home, '.asdf/shims'), path.join(home, '.local/share/mise/shims')];
  const nvm = path.join(env.NVM_DIR || path.join(home, '.nvm'), 'versions/node');
  try {
    const versions = fs.readdirSync(nvm).filter((name) => /^v\d+\.\d+\.\d+$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) dirs.push(path.join(nvm, version, 'bin'));
  } catch { /* nvm is optional */ }
  dirs.push('/Applications/Codex.app/Contents/Resources', '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS');
  return [...new Set(dirs)].filter((dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } });
}
