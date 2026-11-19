// P114: hc 코어 수명. 판 전용 이름 있는 세션(HC_SESSION = 판의 터미널 세션 이름), 판 전용 설정 폴더(XDG_CONFIG_HOME).
// - 띄우기: `hc server start`(CLI)로 띄운다. 코어는 DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB로 떠서 Electron·백엔드의 job과 프로세스 나무 밖에 선다.
//   백엔드가 `hc serve`를 직접 자식으로 띄우면 작업 관리자 "프로세스 트리 끝내기"에 코어·holder·모든 프로그램이 함께 꺼진다(P114 1단계 1번)
// - 다시 띄우기(업데이트): server.restart, 새 빌드는 `hc update --from`. 둘 다 프로그램을 살려 둔다
// - server.stop은 프로그램도 끈다. 판은 사람이 "터미널 모두 끄기"를 고를 때(트레이의 서버 끄기)만 부른다
// - 설정: <데이터 폴더>\hc\config\herdr-core\config.toml에 notes = false(hc가 부모 에이전트에게 메모를 치지 않게, 관리자 결정)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { cleanEnv } from '../proc-env.mjs';
import { hcRoot } from './pin.mjs';
import { hcSocketFor } from './rpc.mjs';

// notes = false: hc가 부모 에이전트에게 메모를 치지 않는다(관리자 결정).
// draft_wait = 0(P114 2b): 사람이 쓰다 만 글이 있을 때 hc의 terminal.send는 마지막 키 뒤 60초까지 기다린다. 판의 전달 규칙(B1 4번)은
//   "3초 안에 입력했으면 기다린다"이고 판이 그 판단을 이미 했다. 0이면 hc는 조용한 틈(약 3초)만 기다려 판의 규칙과 같다
export const BOARD_HC_CONFIG = { notes: false, draft_wait: 0 };
export const hcConfigHome = (dataDir) => path.join(hcRoot(dataDir), 'config');
export const hcConfigFile = (configHome) => path.join(configHome, 'herdr-core', 'config.toml');
// hc 상태 폴더(%LOCALAPPDATA%\herdr-core\<세션>). XDG_STATE_HOME은 코어에 주지 않는다(프로그램에 샌다)
export function hcStateDir(session, env = process.env) {
  if (process.platform !== 'win32') return path.join(env.HOME || os.homedir(), '.local', 'state', 'herdr-core', session); // macOS: 코어 env에 XDG_STATE_HOME을 주지 않아 기본 자리
  const local = env.LOCALAPPDATA || path.join(env.USERPROFILE || '', 'AppData', 'Local');
  return path.join(local, 'herdr-core', session);
}

export function boardConfigText(cfg = BOARD_HC_CONFIG) {
  const lines = ['# Atrium이 쓰는 herdr-core 설정. 판이 다시 쓴다(손으로 고친 것은 사라진다)'];
  for (const [k, v] of Object.entries(cfg)) lines.push(`${k} = ${typeof v === 'string' ? JSON.stringify(v) : v}`);
  return lines.join('\n') + '\n';
}
export function writeBoardConfig(configHome, cfg = BOARD_HC_CONFIG) {
  const file = hcConfigFile(configHome);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = boardConfigText(cfg);
  let cur = null; try { cur = fs.readFileSync(file, 'utf8'); } catch {}
  if (cur !== text) fs.writeFileSync(file, text);
  return file;
}

// 코어와 CLI의 env: 부모 Claude Code·옛 터미널·판 변수와 사용자의 HC_*·XDG_*를 빼고 판 세션과 설정 폴더를 넣는다
export function coreEnv(base = process.env, { session, configHome }) {
  const env = Object.fromEntries(Object.entries(cleanEnv(base)).filter(([k]) => !/^(HC_|XDG_|ELECTRON_RUN_AS_NODE)/i.test(k)));
  env.HC_SESSION = session;
  if (configHome) env.XDG_CONFIG_HOME = configHome;
  // macOS: 코어가 들을 Unix 소켓을 판이 정한다(데이터 폴더 안, 판마다 따로). CLI도 같은 값으로 그 코어를 찾는다
  if (process.platform !== 'win32' && configHome) {
    const sock = hcSocketFor(path.dirname(configHome), session);
    fs.mkdirSync(path.dirname(sock), { recursive: true, mode: 0o700 });
    env.HC_SOCKET = sock;
  }
  return env;
}

const runJson = (exe, args, env, timeoutMs = 30000) => new Promise((res) => {
  execFile(exe, args, { env, encoding: 'utf8', windowsHide: true, timeout: timeoutMs }, (err, so, se) => {
    const out = String(so || '').trim(); let json = null;
    try { json = out ? JSON.parse(out.split(/\r?\n/).filter(Boolean).pop()) : null; } catch {}
    res({ code: err ? (err.code ?? 1) : 0, out, err: String(se || '').trim(), json });
  });
});

// `hc server start` → 코어 상태(JSON). 이미 돌면 그대로 상태를 준다
export async function startCore({ exe, session, configHome, base = process.env }) {
  const r = await runJson(exe, ['server', 'start', '--json'], coreEnv(base, { session, configHome }));
  if (r.code !== 0 || !r.json || r.json.error) {
    const e = r.json && r.json.error;
    throw Object.assign(new Error(`hc server start failed: ${(e && e.message) || r.err || r.out || r.code}`), { code: (e && e.kind) || 'start_failed' });
  }
  return r.json;
}
// 새 빌드로 바꾼다(코어가 돌면 hc update가 다시 띄우고 터미널은 산다). from: staging의 herdr-core.exe
export async function upgradeCore({ exe, from, session, configHome, base = process.env }) {
  const r = await runJson(exe, ['update', '--from', from, '--json'], coreEnv(base, { session, configHome }), 120000);
  if (r.code !== 0 || !r.json || r.json.error) throw Object.assign(new Error(`hc update failed: ${(r.json && r.json.error && r.json.error.message) || r.err || r.out}`), { code: 'update_failed' });
  return r.json;
}
export async function cliVersion({ exe, session, configHome, base = process.env }) {
  const r = await runJson(exe, ['--version'], coreEnv(base, { session, configHome }), 10000);
  return r.code === 0 ? r.out : null;
}

// 버전 정책: 프로토콜 세대가 맞으면 붙고, 고정 버전이 아니면 경고한다. hc 버전은 hcVersion(version은 비운다)
export function hcCompat(pong, { generations = [1], tested = [] } = {}) {
  const base = { version: null, protocols: generations, tested };
  if (!pong) return { ok: false, level: 'none', hcVersion: null, protocol: null, capabilities: null, problems: ['no hello'], warning: null, backend: 'hc', ...base };
  const problems = [];
  if (!generations.includes(pong.protocol)) problems.push(`hc protocol generation ${pong.protocol} not in supported [${generations.join(', ')}]`);
  const feats = (pong.capabilities && pong.capabilities.features) || [];
  for (const f of ['framed', 'attach', 'events', 'status']) if (!feats.includes(f)) problems.push(`hc feature ${f} missing`);
  const untested = !problems.length && !tested.includes(pong.version);
  return { ok: !problems.length, level: problems.length ? 'incompatible' : untested ? 'untested' : 'ok', hcVersion: pong.version, protocol: pong.protocol, capabilities: pong.capabilities, problems, warning: untested ? `검증하지 않은 hc 버전 ${pong.version}` : null, backend: 'hc', ...base };
}
