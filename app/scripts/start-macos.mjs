import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { electronExecutable } from './platform.mjs';
import { loadConfig, HERDR_VERSION } from '../../backend/src/config.mjs';

if (process.platform !== 'darwin') throw new Error('macOS용 실행 명령입니다.');
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node.js 24로 실행하세요.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = loadConfig();
try {
  const version = execFileSync(cfg.herdrPath, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
  if (version !== `herdr ${HERDR_VERSION}`) throw new Error(`발견한 버전: ${version}`);
} catch (e) { throw new Error(`herdr ${HERDR_VERSION}이 필요합니다. npm run setup:mac을 실행하거나 ATRIUM_HERDR를 지정하세요. ${e.message}`); }
execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
const env = { ...process.env, ATRIUM_NODE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronExecutable(root), ['.', ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' });
child.on('error', (e) => { console.error(e.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
