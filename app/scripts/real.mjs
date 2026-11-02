// 실제 판 띄우기(P9). 바탕화면 바로가기 → real.cmd → 이 스크립트.
// - 창 화면 소스(src/renderer, 창이 같이 묶는 backend/src)가 dist보다 새로우면 빌드한다.
// - Electron을 --dev 없이(실제 판 프로필) 떼어 띄우고 바로 끝난다. 그래서 콘솔 창이 남지 않는다.
// - 프로필 값은 main이 정한다(backend/src/config.mjs). ATRIUM_*(옛 이름 MTASK_*) 환경 변수가 있으면 그 값이 실제 판의 기본값을 덮는다(시험 판).
// --dry-run: 띄우지 않고 무엇을 할지(빌드 여부, 실행 파일, 인자, 프로필 값)를 JSON으로 찍는다
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, envVar, APP_NAME } from '../../backend/src/config.mjs';
import { electronExecutable } from './platform.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = [path.join(ROOT, 'src', 'renderer'), path.resolve(ROOT, '..', 'backend', 'src'), path.join(ROOT, 'scripts', 'build.mjs')];
const DIST = path.join(ROOT, 'dist', 'renderer.js');
const ELECTRON = electronExecutable(ROOT);

function newest(p) {
  let st;
  try { st = fs.statSync(p); } catch { return 0; }
  if (!st.isDirectory()) return st.mtimeMs;
  let t = 0;
  for (const e of fs.readdirSync(p)) t = Math.max(t, newest(path.join(p, e)));
  return t;
}
export function needsBuild() {
  let built = 0;
  try { built = fs.statSync(DIST).mtimeMs; } catch { return true; }
  return !fs.existsSync(path.join(ROOT, 'dist', 'index.html')) || Math.max(...SOURCES.map(newest)) > built;
}
// 부모 Claude Code 표시 변수와 ELECTRON_RUN_AS_NODE(있으면 Electron이 node로 돈다)를 뺀다. 백엔드와 herdr도 각자 한 번 더 뺀다
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));

const dry = process.argv.includes('--dry-run');
const args = ['.', ...process.argv.slice(2).filter((a) => a !== '--dry-run' && a !== '--dev')];
const build = needsBuild();
if (dry) {
  const cfg = loadConfig({ argv: args });
  console.log(JSON.stringify({ build, exe: ELECTRON, args, cwd: ROOT, profile: cfg.profile, herdrSession: cfg.herdrSession, port: cfg.port, dataDir: cfg.dataDir, appUserData: envVar('APP_USERDATA') || null }, null, 2));
  process.exit(0);
}
if (!fs.existsSync(ELECTRON)) { console.error(`Electron이 없다: ${ELECTRON}\napp 폴더에서 npm install을 먼저 한다`); process.exit(1); }
if (build) execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, stdio: 'inherit' });
const child = spawn(ELECTRON, args, { cwd: ROOT, env: cleanEnv(), detached: true, stdio: 'ignore', windowsHide: false });
child.unref();
console.log(`${APP_NAME} 창을 띄웠다(pid ${child.pid}${build ? ', 빌드함' : ''})`);
