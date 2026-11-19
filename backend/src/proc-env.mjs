// 터미널 서버와 그 프로그램에 줄 환경(hc 어댑터·코어가 쓴다). P129: 옛 herdr 어댑터에서 옮겼다.
import { execFile } from 'node:child_process';

// 부모 Claude Code 세션 표시 변수와 판 자신의 변수를 뺀 환경. 옛 터미널 백엔드(herdr)의 패널 변수(HERDR_*)도 뺀다:
// 판을 그 안에서 띄운 옛 PC에서 새 터미널의 프로그램이 옛 세션을 가리키지 않게(옛 이름 받기)
export function cleanEnv(base = process.env) {
  const npmLaunch = Object.keys(base).some((k) => /^npm_lifecycle_event$/i.test(k));
  // macOS: npm --prefix app은 띄운 쪽 설정이지 로그인 셸의 Node 접두어가 아니다. 판이 띄우는 셸에 넘기지 않는다.
  // hc 코어(HC_*)와 판이 세션마다 주는 Claude 계정 폴더(CLAUDE_CONFIG_DIR)도 백엔드의 것을 물려주지 않는다
  return Object.fromEntries(Object.entries(base).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|CLAUDE_CONFIG_DIR$|HERDR_|HC_|MTASK_|ATRIUM_)/i.test(k) && !(npmLaunch && /^npm_config_prefix$/i.test(k))));
}

function execText(file, args, opts = {}) {
  return new Promise((res) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 20000, ...opts }, (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

// P40: 레지스트리의 Machine+User PATH(펼친 값). 새 터미널에 줄 PATH의 출처다(백엔드가 뜬 뒤 설치한 프로그램도 찾게). 1분 동안 기억한다. 못 읽으면 null
let regPathCache = null;
export async function registryPath() {
  if (process.platform !== 'win32') return null; // macOS: 레지스트리가 없다. 어댑터가 백엔드 env의 PATH(앱이 로그인 셸에서 받은 값)를 쓴다
  if (regPathCache && Date.now() - regPathCache.at < 60000) return regPathCache.value;
  const ps = "$m = [Environment]::GetEnvironmentVariable('Path','Machine'); $u = [Environment]::GetEnvironmentVariable('Path','User'); [Environment]::ExpandEnvironmentVariables((@($m, $u) | Where-Object { $_ }) -join ';')";
  const r = await execText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 10000 });
  const value = r.code === 0 ? r.stdout.trim() : '';
  regPathCache = { at: Date.now(), value: value || null };
  return regPathCache.value;
}
