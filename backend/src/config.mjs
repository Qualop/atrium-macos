// 설정: 터미널 세션 이름, 백엔드 포트, 데이터 폴더. 실제 판(real)과 개발용(dev) 프로필이 서로 겹치지 않게 한다.
// 우선순위: 명령줄(--dev) < 환경 변수(ATRIUM_*) — 환경 변수가 프로필 기본값을 덮는다.
// P18: 환경 변수는 ATRIUM_*가 본 이름이고 옛 이름 MTASK_*도 받는다(둘 다 있으면 ATRIUM_*). 다른 모듈도 envVar로 읽는다.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appDataDir, defaultHerdrPath, canonicalPath } from './platform.mjs';
import { codexHomeOf } from './codex-models.mjs'; // P72

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(HERE, '..');

// P40: (옛) herdr 버전 정책. 지금 터미널은 herdr-core(hc)이고, 이 값은 herdr 판을 hc로 옮길 때(herdr-migrate)와 옛 업데이터에만 쓴다. 프로토콜이 이 목록에 있으면 붙는다. 시험한 버전이 아니면 붙되 경고한다(herdr/discover.mjs herdrCompat).
// 시험 판은 ATRIUM_HERDR_PROTOCOLS·ATRIUM_HERDR_TESTED(쉼표로 여럿)로 바꿔 본다
export const HERDR_VERSION = '0.9.5'; // bundled/tested distribution
export const HERDR_PROTOCOL = 22; // legacy callers
export const HERDR_PROTOCOLS = [HERDR_PROTOCOL];
export const HERDR_TESTED = ['0.9.5'];
const listOf = (v, num) => String(v).split(',').map((x) => x.trim()).filter(Boolean).map((x) => (num ? Number(x) : x)).filter((x) => (num ? Number.isInteger(x) : true));

export const APP_NAME = 'Atrium'; // 보이는 이름(창 제목, 트레이, 알림, 바로가기)
export const APP_ID = 'atrium'; // 식별자(터미널 세션, 데이터 폴더, 창 프로필, Windows 앱 ID)
export const LEGACY_ID = 'multitask'; // P18 전의 이름. 실제 판의 옮기기(rename-migrate.mjs)와 시험 막이가 읽는다

// 이름 name(예: 'PORT')의 환경 변수. ATRIUM_<name>이 있으면(빈 글 포함) 그것, 없으면 옛 MTASK_<name>
export function envVar(name, env = process.env) {
  const v = env[`ATRIUM_${name}`];
  return v !== undefined ? v : env[`MTASK_${name}`];
}
// P129: 판의 터미널 세션 이름(hc 세션). ATRIUM_TERMINAL_SESSION, 옛 이름 ATRIUM_HERDR_SESSION도 받는다.
// P132: 옛 이름은 계속 받는다(옛 판에서 올라오는 길: 0.1.7까지의 창·바꾸기·세션 설정 파일이 옛 이름만 준다)
const OLD_SESSION_VAR = 'HERDR_SESSION';
// 둘 다 있고 다르면 뜨지 않는다: 새 판의 세션 env(둘 다 같은 값)를 물려받은 셸에서 옛 이름만 바꿔 다른 판(시험 판)을 가리킨 경우, 새 이름이 이겨 실제 판을 건드리지 않게
export function terminalSessionVar(env = process.env) {
  const now = envVar('TERMINAL_SESSION', env), old = envVar(OLD_SESSION_VAR, env);
  if (now && old && now !== old) throw new Error(`ATRIUM_TERMINAL_SESSION(${now})과 옛 이름 ATRIUM_${OLD_SESSION_VAR}(${old})이 다릅니다. 하나만 주거나 같은 값으로 주세요.`);
  return now || old || '';
}
// 자식(판의 세션·CLI)에 넘길 터미널 세션 env: 새 이름과 옛 이름을 같은 값으로(옛 버전으로 되돌린 판·옛 이름만 읽는 것이 같은 판을 가리키게)
export const terminalSessionEnv = (v) => ({ ATRIUM_TERMINAL_SESSION: v, [`ATRIUM_${OLD_SESSION_VAR}`]: v });
export const legacyTerminalSessionVar = (env = process.env) => env.ATRIUM_LEGACY_TERMINAL_SESSION || env[`ATRIUM_LEGACY_${OLD_SESSION_VAR}`] || '';

const localAppData = () => appDataDir();
const appData = () => appDataDir({ roaming: true });
const PROFILES = {
  real: {
    terminalSession: APP_ID,
    port: 47800,
    dataDir: path.join(localAppData(), APP_ID),
  },
  dev: {
    terminalSession: `${APP_ID}-dev`,
    port: 47811,
    dataDir: path.join(BACKEND_ROOT, '.dev', 'data'),
  },
};
// 옛 실제 판(P18 전)의 값. dev 프로필이 가리키지 못하게 막고, 옮기기의 기본 출처다
export const LEGACY_REAL = { terminalSession: LEGACY_ID, dataDir: path.join(localAppData(), LEGACY_ID), appUserData: path.join(appData(), `${LEGACY_ID}-app-real`) };
const samePath = (a, b) => process.platform === 'win32' ? canonicalPath(a).toLowerCase() === canonicalPath(b).toLowerCase() : canonicalPath(a) === canonicalPath(b);

export function loadConfig({ argv = process.argv.slice(2), env = process.env } = {}) {
  const E = (name) => envVar(name, env);
  const profile = argv.includes('--dev') || E('PROFILE') === 'dev' ? 'dev' : 'real';
  const base = PROFILES[profile];
  const bundledHerdr = path.resolve(BACKEND_ROOT, '..', '.tools', 'herdr', `${HERDR_VERSION}-${process.arch}`, 'herdr');
  const cfg = {
    profile,
    terminalSession: terminalSessionVar(env) || base.terminalSession,
    port: Number(E('PORT') || base.port),
    dataDir: path.resolve(E('DATA_DIR') || base.dataDir),
    // (옛) herdr: 지금 판의 터미널은 hc다. herdr 판을 hc로 옮길 때(herdr-migrate)만 이 경로로 옛 herdr 서버를 읽는다
    herdrPath: E('HERDR') || (process.platform === 'darwin' && fs.existsSync(bundledHerdr) ? bundledHerdr : defaultHerdrPath(HERDR_VERSION, { env })),
    herdrEnvPath: E('HERDR') || '',
    bundledHerdrPath: process.platform === 'darwin' && fs.existsSync(bundledHerdr) ? bundledHerdr : null,
    herdrProtocols: E('HERDR_PROTOCOLS') ? listOf(E('HERDR_PROTOCOLS'), true) : HERDR_PROTOCOLS,
    herdrTested: E('HERDR_TESTED') ? listOf(E('HERDR_TESTED'), false) : HERDR_TESTED,
    remoteEnabled: E('REMOTE_ENABLED') === '1',
    remoteExplicit: E('REMOTE_ENABLED') !== undefined,
    claudeCommand: 'claude',
    // P115: 옛 게이트웨이 환경 변수(ATRIUM_*_HEALTH·_BASE_URL). 이번 릴리스 동안 읽어 연결로 옮기고 경고한다(launcher-migrate.mjs). 다음 릴리스에서 없앤다
    legacyGateway: { healthUrl: E('OCX_HEALTH') || null, baseUrl: E('OCX_BASE_URL') || null },
    // P72: Codex 모델 목록 캐시(models_cache.json)를 읽을 폴더. CODEX_HOME(Codex와 같은 변수), 없으면 ~/.codex.
    // macOS 판: ATRIUM_CODEX_HOME을 주면 그것이 먼저다(개발·시험 판이 실제 ~/.codex 대신 격리한 Codex 홈을 쓰게. 관리 Codex의 CODEX_HOME과 가져오기 검사가 이 값을 본다)
    codexHome: E('CODEX_HOME') && E('CODEX_HOME') !== 'none' ? path.resolve(E('CODEX_HOME')) : codexHomeOf(env),
    codexHomeExplicit: !!E('CODEX_HOME'),
    codexHistory: E('CODEX_HISTORY') !== '0',
    codexCommand: E('CODEX_COMMAND') || null,
    claudeJson: E('CLAUDE_JSON') || path.join(os.homedir(), '.claude.json'),
    claudeProjects: path.join(os.homedir(), '.claude', 'projects'),
    // P7(J3·J4): 판 밖 대화 목록이 읽는 대화 기록 폴더(;로 여럿), Claude Code의 세션 파일 폴더, 데스크톱 앱 세션 목록 폴더. 시험은 고정 자료를 가리킨다.
    // 판이 띄운 세션의 대화 기록(claudeProjects)은 바꾸지 않는다. Claude Code는 늘 ~/.claude/projects에 쓴다
    convoRoots: (E('CLAUDE_PROJECTS') || path.join(os.homedir(), '.claude', 'projects')).split(';').filter(Boolean).map((p) => path.resolve(p)),
    claudeSessionsDir: path.resolve(E('CLAUDE_SESSIONS') || path.join(os.homedir(), '.claude', 'sessions')),
    desktopSessionsDir: E('CLAUDE_DESKTOP') === 'none' ? null : path.resolve(E('CLAUDE_DESKTOP') || path.join(localAppData(), process.platform === 'darwin' ? 'Claude' : 'Claude-Data')),
    desktopExplicit: !!E('CLAUDE_DESKTOP') && E('CLAUDE_DESKTOP') !== 'none', // P34: 앱 목록 폴더를 환경 변수로 따로 주었는가(개발용 프로필의 가져오기 막기)
    // P133: 판 밖 Codex 대화를 읽을 Codex 홈(sessions/, session_index.jsonl, thread-writer-locks/). ATRIUM_CODEX_HOME(none이면 읽지 않는다),
    // 없으면 CODEX_HOME·~/.codex. 시험 판(ATRIUM_CLAUDE_PROJECTS로 대화 기록을 따로 준 판)은 ATRIUM_CODEX_HOME을 주지 않으면 Codex 대화를 읽지 않는다(실제 기록을 읽지 않게)
    codexConvoHome: E('CODEX_HOME') === 'none' ? null : E('CODEX_HOME') ? path.resolve(E('CODEX_HOME')) : E('CLAUDE_PROJECTS') ? null : codexHomeOf(env),
    convoScanMs: Number(E('CONVO_SCAN_MS') || 15000),
    // P13(BRIEF "판 밖 대화"): missed로 보는 이 앱의 시험 폴더. 판 코드 저장소(이 코드가 있는 저장소와 그 본 저장소)의 backend/.dev·experiments, OS 임시 폴더, 이름 접두어.
    // 시험 판은 고정 자료 폴더 이름(mtask-p13-*)이 접두어에 걸리지 않게 ATRIUM_TEST_PREFIX로 바꾼다(빈 글이면 접두어 규칙을 끈다).
    // 시험 폴더 접두어는 P18 뒤에도 mtask-다(옛 시험 폴더 이름과 같게 둔다)
    codeRoots: (E('CODE_ROOT') ? E('CODE_ROOT').split(';') : codeRootsOf(path.resolve(BACKEND_ROOT, '..'))).filter(Boolean).map((p) => path.resolve(p)),
    testPrefix: E('TEST_PREFIX') ?? 'mtask-',
    tmpDir: os.tmpdir(),
    // 시간 기준(ms)
    hookTimeoutSec: 2,
    deliveryMaxWaitMs: 15 * 60 * 1000, // B1 규칙 2: 최대 15분
    inputQuietMs: 3000, // B1 규칙 4: 사용자가 터미널에 입력한 뒤 이만큼 기다린다
    submitConfirmMs: 30000, // 보낸 뒤 UserPromptSubmit을 기다리는 시간
    submitRetryMs: 6000, // P79: 보낸 뒤 이만큼 확인이 없으면 입력 칸을 보고 Enter나 다시 보내기
    submitRetries: 2, // P79: 그 손쓰기의 최대 횟수(다시 보내기는 그 가운데 한 번뿐)
    quietMs: Number(E('QUIET_MS') || 10 * 60 * 1000), // 3절 조용함, 후보 10분
    killWaitMs: 10000,
    answerStepMs: 250, // 답하기에서 키 묶음 사이(tab → 글 → enter)에 화면이 바뀔 시간
    // P3
    resourcesIntervalMs: Number(E('RESOURCES_MS') || 30000), // D1: 약 30초마다
    sleepTickMs: Number(E('SLEEP_TICK_MS') || 30000), // P21(D4): 저절로 잠재울 세션을 보는 간격(시험은 짧게)
    sleepBgPrecheck: !(profile === 'dev' && E('SLEEP_BG_PRECHECK') === 'off'), // P105 판 시험만(개발용 판): 뒤 일 미리 보기를 끄고 /exit 확인 창 처리를 시험한다
    wsGoneGraceMs: profile === 'dev' && E('WS_GONE_GRACE_MS') ? Number(E('WS_GONE_GRACE_MS')) : undefined, // P120 판 시험만(개발용 판): 폴더가 없어진 빈 영역을 치우기 전 유예(기본 60초)
    recoverGraceMs: 15000, // C3: 터미널 서버가 다시 뜬 뒤 이만큼 기다려도 claude가 없으면 판이 이어 간다
    // P4
    adoptSpawnMatchMs: 120000, // F3: 판 밖에서 나타난 패널과 지시를 이 시간 안에서 맞춘다
    gitPollMs: Number(E('GIT_POLL_MS') || 15000), // F4: hook이 없는 세션의 폴더(터미널 cwd)와 git을 다시 보는 간격
  };
  // 판은 반드시 이름 있는 터미널 세션을 쓴다(기본 세션을 쓰지 않는다).
  // macOS 업데이터(update-lease·update-swap·updater)의 기록과 v0.4 도우미가 옛 이름 herdrSession으로 판을 견준다. 같은 값을 옛 이름으로도 둔다
  cfg.herdrSession = cfg.terminalSession;
  if (!cfg.terminalSession || cfg.terminalSession === 'default') throw new Error("터미널 세션 이름을 지정하세요. 기본 세션은 사용하지 않습니다.");
  if (profile === 'dev' && [PROFILES.real.terminalSession, LEGACY_REAL.terminalSession].includes(cfg.terminalSession)) throw new Error("개발용 프로필이 실제 보드의 터미널 세션을 가리킵니다.");
  if (profile === 'dev' && [PROFILES.real.dataDir, LEGACY_REAL.dataDir].some((d) => samePath(d, cfg.dataDir))) throw new Error("개발용 프로필이 실제 보드의 데이터 폴더를 가리킵니다.");
  cfg.sessionsDir = path.join(cfg.dataDir, 'sessions');
  cfg.dbFile = path.join(cfg.dataDir, 'board.db');
  cfg.backendFile = path.join(cfg.dataDir, 'backend.json');
  cfg.logDir = path.join(cfg.dataDir, 'logs');
  cfg.legacy = legacyOf(cfg, env);
  return cfg;
}

// P18: 옮겨 올 옛 판(실제 판 프로필에서만). 판의 값(터미널 세션, 포트, 데이터 폴더)을 환경 변수로 덮었으면(시험 판) 옛 값도
// ATRIUM_LEGACY_TERMINAL_SESSION과 ATRIUM_LEGACY_DATA_DIR로 함께 줘야 옮긴다. 그래서 시험 판이 진짜 옛 판(multitask)을 끄거나 옮기는 일은 없다.
// → { terminalSession, dataDir } | null
export function legacyOf(cfg, env = process.env) {
  if (cfg.profile !== 'real') return null;
  const E = (name) => envVar(name, env);
  const ls = legacyTerminalSessionVar(env), ld = env.ATRIUM_LEGACY_DATA_DIR;
  if (ls || ld) {
    if (!ls || !ld) return null; // 하나만 주면 옮기지 않는다
    return { terminalSession: ls, dataDir: path.resolve(ld) };
  }
  if (terminalSessionVar(env) || E('DATA_DIR') || E('PORT')) return null; // 덮은 판에는 기본 옛 판을 쓰지 않는다
  return { terminalSession: LEGACY_REAL.terminalSession, dataDir: LEGACY_REAL.dataDir };
}
// P18: 옮겨 올 옛 창 프로필(Electron userData). 창 프로필을 덮었으면(ATRIUM_APP_USERDATA) ATRIUM_LEGACY_APP_USERDATA를 줘야 옮긴다
export function legacyAppUserData(cfg, env = process.env) {
  if (cfg.profile !== 'real') return null;
  if (env.ATRIUM_LEGACY_APP_USERDATA) return path.resolve(env.ATRIUM_LEGACY_APP_USERDATA);
  if (envVar('APP_USERDATA', env) || terminalSessionVar(env) || envVar('DATA_DIR', env)) return null;
  return LEGACY_REAL.appUserData;
}

// 이 코드가 있는 저장소 폴더와, 그것이 Claude Code 워크트리(<본 저장소>/.claude/worktrees/<이름>)면 본 저장소 폴더
export function codeRootsOf(root) {
  const m = /^(.*)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/.exec(root);
  return m ? [root, m[1]] : [root];
}

// atrium CLI와 백엔드가 같은 프로필로 뜨도록 자식 프로세스에 넘길 환경 변수
// 판 값을 넘기면 자식에서는 "덮은 판"이 되므로, 옮길 옛 판(cfg.legacy)도 그대로 넘긴다(없으면 빈 글 → 자식도 옮기지 않는다)
export function profileEnv(cfg) {
  return {
    ATRIUM_PROFILE: cfg.profile, ...terminalSessionEnv(cfg.terminalSession), ATRIUM_PORT: String(cfg.port), ATRIUM_DATA_DIR: cfg.dataDir,
    ATRIUM_LEGACY_TERMINAL_SESSION: cfg.legacy ? cfg.legacy.terminalSession : '', ATRIUM_LEGACY_DATA_DIR: cfg.legacy ? cfg.legacy.dataDir : '',
  };
}
