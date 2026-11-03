import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExecutable } from './platform.mjs';
import { geminiContext } from './gemini.mjs';
import { installAgyHooks } from './agy.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
export function writeAgySession({ dir, sessionId, token, hookUrl, branchEnv, pluginDir, herdrPath, hooksFile = path.join(os.homedir(), '.gemini/config/hooks.json'), executable = findExecutable('agy') }) {
  if (!executable) throw Object.assign(new Error('Antigravity CLI가 설치되지 않았습니다. https://antigravity.google/docs/getting-started'), { code: 'not_installed' });
  installAgyHooks({ file: hooksFile, nodePath: process.execPath, script: path.resolve(here, '../scripts/agy-hook.mjs') });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${sessionId}.agy-bridge.json`);
  const branchFile = path.join(dir, `${sessionId}.agy-branch.json`);
  const context = geminiContext({ sessionId }).replaceAll('run_shell_command', 'run_command').replaceAll('--kind gemini', '--kind agy');
  for (const [p, data] of [[file, { sessionId, token, hookUrl, context }], [branchFile, branchEnv]]) { fs.writeFileSync(p, JSON.stringify(data), { mode: 0o600 }); fs.chmodSync(p, 0o600); }
  const { ATRIUM_SESSION_TOKEN: _token, ...publicEnv } = branchEnv;
  const dirs = [pluginDir && path.join(pluginDir, 'bin'), herdrPath && path.dirname(herdrPath), path.dirname(process.execPath), path.dirname(executable)].filter(Boolean);
  return { settingsPath: file, env: { ...publicEnv, ATRIUM_BRANCH_FILE: branchFile, ATRIUM_AGY_BRIDGE: file, PATH: [...dirs, process.env.PATH || ''].join(path.delimiter) } };
}
