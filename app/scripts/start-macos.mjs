import { requireSupportedNode } from '../../backend/src/runtime.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { electronExecutable } from './platform.mjs';
import fs from 'node:fs';
import { HC_PIN } from '../../backend/src/hc/pin.mjs';
import { bundledHcArchive } from '../../backend/src/terminal-backend.mjs';

if (process.platform !== 'darwin') throw new Error('macOS용 실행 명령입니다.');
requireSupportedNode();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 터미널 엔진(herdr-core)은 보드가 데이터 폴더에 준비한다. 저장소의 고정 tar.gz가 없으면 보드가 처음 뜰 때 공식 주소에서 받는다
if (!fs.existsSync(bundledHcArchive())) console.warn(`herdr-core ${HC_PIN.version} tar.gz가 .tools/hc에 없습니다. 보드가 처음 뜰 때 받습니다(npm run setup:mac으로 미리 받을 수 있습니다).`);
execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
const env = { ...process.env, ATRIUM_NODE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronExecutable(root), ['.', ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' });
child.on('error', (e) => { console.error(e.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
