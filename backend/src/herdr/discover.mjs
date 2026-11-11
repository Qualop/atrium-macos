// P40: herdr 찾기, 버전 정책, 도는 서버의 실행 파일, 패널 PATH, 업데이트 감지. 모두 순수 함수이고 파일 시스템·실행·환경 변수는 넘겨받는다(단위 시험).
// 찾는 순서: 1) ATRIUM_HERDR 2) 설정 herdrPath 3) herdr 설치기의 current 링크 4) PATH(where herdr 순서) 5) 알려진 설치 폴더.
// 후보마다 `herdr --version`으로 버전을 읽어 확인하고, 처음 확인된 것을 고른다. 본 후보와 결과는 모두 남긴다(진단).
// 이미 도는 판의 herdr 서버가 있으면 그 서버의 실행 파일을 쓴다(백엔드 쪽, herdrServerExe). 찾기 결과는 새 서버를 띄울 때만 쓴다.
import path from 'node:path';

export const SOURCES = ['env', 'setting', 'bundled', 'installer', 'path', 'known'];
const REASON = {
  env: 'ATRIUM_HERDR',
  bundled: 'bundled herdr',
  setting: 'setting herdrPath',
  installer: 'herdr installer current link',
  path: 'PATH (where herdr)',
  known: 'known install folder',
};

// `herdr --version`의 출력("herdr 0.9.5") → '0.9.5'. 못 읽으면 null
export function parseHerdrVersion(text) {
  const s = String(text || '');
  const m = s.match(/\bherdr\s+v?(\d+\.\d+\.\d+[0-9A-Za-z.+-]*)/i) || s.match(/\bv?(\d+\.\d+\.\d+)\b/);
  return m ? m[1] : null;
}

// 버전 비교(앞의 세 수, 그 뒤는 무시). a > b면 양수
export function compareVersions(a, b) {
  const p = (v) => String(v || '').split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

// 알려진 설치 폴더: herdr 설치기(standalone)의 버전 폴더(새 버전부터)와 Windows 설치기의 bin
// releases: ~\.herdr\packages\standalone\releases 아래 폴더 이름들
export function knownPaths({ home, localAppData, releases = [] }) {
  const out = [];
  if (localAppData) out.push(path.join(localAppData, 'Programs', 'Herdr', 'bin', 'herdr.exe'));
  if (home) {
    const rel = path.join(home, '.herdr', 'packages', 'standalone', 'releases');
    const vers = releases.filter((n) => parseHerdrVersion(n)).sort((a, b) => compareVersions(parseHerdrVersion(b), parseHerdrVersion(a)));
    for (const n of vers) out.push(path.join(rel, n, 'herdr.exe'));
    out.push(path.join(home, '.herdr', 'bin', 'herdr.exe'));
  }
  return out;
}

// 찾는 순서대로 후보 목록 [{ source, path }]. 같은 경로(대소문자 무시)는 처음 것만 둔다
export function herdrCandidates({ envPath = '', settingPath = '', bundledPath = '', platform = process.platform, home = '', localAppData = '', wherePaths = [], releases = [] } = {}) {
  const raw = [];
  if (envPath) raw.push({ source: 'env', path: envPath });
  if (settingPath) raw.push({ source: 'setting', path: settingPath });
  if (bundledPath) raw.push({ source: 'bundled', path: bundledPath });
  if (platform !== 'win32') {
    for (const p of wherePaths) if (p) raw.push({ source: 'path', path: p });
    if (home) for (const dir of ['.local/bin', '.herdr/bin', '.herdr/packages/standalone/current']) raw.push({ source: 'known', path: path.posix.join(home, dir, 'herdr') });
    for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) raw.push({ source: 'known', path: path.posix.join(dir, 'herdr') });
  }
  if (platform === 'win32' && home) raw.push({ source: 'installer', path: path.join(home, '.herdr', 'packages', 'standalone', 'current', 'herdr.exe') });
  for (const p of wherePaths) if (p) raw.push({ source: 'path', path: p });
  for (const p of platform === 'win32' ? knownPaths({ home, localAppData, releases }) : []) raw.push({ source: 'known', path: p });
  const seen = new Set();
  return raw.filter((c) => { const resolved = path.resolve(c.path); const k = platform === 'win32' ? resolved.toLowerCase() : resolved; if (seen.has(k)) return false; seen.add(k); return true; });
}

// 후보를 차례로 확인한다. io: { exists(p) → bool, version(p) → Promise<string|null>(`--version` 출력, 실행 실패면 null) }
// → { path, version, source, reason, tried: [{ source, path, ok, version?, error? }] }. 못 찾으면 path가 null
export async function discoverHerdr(input, io) {
  const cands = herdrCandidates(input);
  const tried = [];
  for (const c of cands) {
    const rec = { source: c.source, path: c.path, ok: false };
    tried.push(rec);
    let ex = false;
    try { ex = !!io.exists(c.path); } catch {}
    if (!ex) { rec.error = 'not_found'; continue; }
    let out = null;
    try { out = await io.version(c.path); } catch {}
    const v = parseHerdrVersion(out);
    if (!v) { rec.error = out == null ? 'not_runnable' : 'no_version'; continue; }
    rec.ok = true; rec.version = v;
    return { path: c.path, version: v, source: c.source, reason: REASON[c.source], tried };
  }
  return { path: null, version: null, source: null, reason: 'not found', tried };
}

// `where herdr`의 출력 → 경로 목록
export const parseWhere = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// 명령 줄을 낱말로(따옴표 안의 공백 유지)
const argvOf = (cmd) => (String(cmd || '').match(/"[^"]*"|\S+/g) || []).map((t) => t.replace(/^"|"$/g, ''));

// 도는 판 서버(`herdr --session <s> server`)의 실행 파일. procs: [{ pid, exe, cmd }](Win32_Process ExecutablePath·CommandLine).
// 서버 PID를 알면 그 프로세스를 먼저 본다. 실행 파일 경로를 못 읽으면 명령 줄 첫 낱말. 없으면 null
export function herdrServerProcess(procs, session, serverPid = null) {
  const isServer = (p) => {
    const a = argvOf(p.cmd).slice(1);
    const si = a.indexOf('--session');
    if (si < 0 || a[si + 1] !== session) return false;
    const rest = a.filter((_, i) => i !== si && i !== si + 1);
    return rest[0] === 'server' && rest.length === 1;
  };
  const list = (procs || []).filter(isServer);
  const pick = (serverPid && list.find((p) => p.pid === serverPid)) || list[0];
  if (!pick) return null;
  return { pid: pick.pid, exe: pick.exe || argvOf(pick.cmd)[0] || null };
}
export function herdrServerExe(procs, session, serverPid = null) {
  return herdrServerProcess(procs, session, serverPid)?.exe || null;
}

// env의 PATH(Windows는 대소문자 무시, 보통 'Path') 맨 앞에 dir을 넣는다. 같은 폴더가 뒤에 있으면 뺀다. 새 객체를 돌려준다
export function withPathFirst(env, dir, platform = process.platform) {
  const out = { ...env };
  if (!dir) return out;
  const key = Object.keys(out).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const norm = (p) => { const value = path.resolve(p).replace(/[\\/]+$/, ''); return platform === 'win32' ? value.toLowerCase() : value; };
  const delimiter = platform === 'win32' ? ';' : ':';
  const rest = String(out[key] || '').split(delimiter).filter((p) => p && norm(p) !== norm(dir));
  for (const k of Object.keys(out)) if (k !== key && k.toUpperCase() === 'PATH') delete out[k];
  out[key] = [dir, ...rest].join(delimiter);
  return out;
}

// 버전 정책: 프로토콜이 지원 목록에 있으면 붙는다. 시험한 버전이 아니면 붙되 경고한다. 프로토콜이 다르면 세션 띄우기만 막는다.
// → { ok, level: 'ok'|'untested'|'incompatible'|'none', version, protocol, capabilities, problems, warning }
export function herdrCompat(pong, { protocols, tested }) {
  if (!pong) return { ok: false, level: 'none', version: null, protocol: null, capabilities: null, problems: ['no pong'], warning: null, protocols, tested };
  const problems = [];
  if (!protocols.includes(pong.protocol)) problems.push(`protocol ${pong.protocol} not in supported [${protocols.join(', ')}]`);
  if (!pong.capabilities || typeof pong.capabilities !== 'object') problems.push('capabilities missing');
  const untested = !problems.length && !tested.includes(pong.version);
  const warning = untested ? `검증하지 않은 herdr 버전 ${pong.version}(프로토콜 ${pong.protocol})` : null;
  return { ok: !problems.length, level: problems.length ? 'incompatible' : untested ? 'untested' : 'ok', version: pong.version, protocol: pong.protocol, capabilities: pong.capabilities, problems, warning, protocols, tested };
}

// 업데이트 감지: 찾기 결과가 도는 서버보다 새 버전이면 알림 내용, 아니면 null
export function updateNotice({ serverVersion, found }) {
  if (!serverVersion || !found || !found.version) return null;
  if (compareVersions(found.version, serverVersion) <= 0) return null;
  return { version: found.version, path: found.path, source: found.source, serverVersion, message: `새 herdr ${found.version}이 설치되었습니다. 보드 전용 서버는 ${serverVersion}로 실행 중입니다. 서버를 재시작하면 세션이 종료되므로 원하는 시점에 트레이 메뉴에서 재시작하세요.` };
}
