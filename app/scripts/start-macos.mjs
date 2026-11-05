import { requireSupportedNode } from '../../backend/src/runtime.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { electronExecutable } from './platform.mjs';
import { loadConfig, HERDR_VERSION } from '../../backend/src/config.mjs';

if (process.platform !== 'darwin') throw new Error('macOS용 실행 명령입니다.');
requireSupportedNode();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = loadConfig();
try {
  const version = execFileSync(cfg.herdrPath, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
  if (version !== `herdr ${HERDR_VERSION}`) console.warn(`herdr 호환성은 보드에서 확인합니다: ${version}`);
} catch { console.warn('herdr를 찾지 못했습니다. 보드는 열리며 설정에서 실행 엔진을 지정할 수 있습니다.'); }
execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
const env = { ...process.env, ATRIUM_NODE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronExecutable(root), ['.', ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' });
child.on('error', (e) => { console.error(e.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
