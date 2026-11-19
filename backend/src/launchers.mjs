// P33 호출자(launcher): 세션을 띄우는 방법 하나. 하네스(claude, codex, 터미널이 아는 다른 종류, 셸) + 모델 + 옵션의 조합이거나, 셸 패널에 칠 명령 한 줄이다.
// 목록은 판 기록(meta 표의 `launchers`)에 { v, items, favorites }로 둔다. favorites는 왼쪽 레일에 놓인 호출자 ID의 순서다.
// 하네스마다 무엇을 받고 어떻게 띄우는지는 아래 HARNESSES 표 한곳에 둔다. session.spawn { launcher }는 resolveLauncher로 띄울 값을 얻는다.
// P115: 모델 연결(엔드포인트·프로토콜·인증)은 런처와 따로 둔 목록(connections.mjs)이고 런처가 ID로 참조한다(connection). 하네스마다 쓸 수 있는 프로토콜이 다르고
//       맞지 않는 연결은 저장하지 않는다. 판은 연결을 켜지 않고 시작 전에 닿는지만 본다. 목록은 새 키(launchers.v2)에 두고 옛 키는 남긴다(launcher-migrate.mjs).
// P72: 새 판은 Claude Code, Codex, 셸 셋으로 시작했다. P122: 새 판은 Claude Code, Codex 둘이다(셸 런처는 사람이 "+"로 만든다).
// P72: Codex 모델은 Codex의 모델 목록 캐시(codex-models.mjs)를 읽는다. 읽지 못하면 아래 고정 목록이다.
// 환경 변수 값은 판 기록에 평문으로 남는다. 기본·예시 호출자에는 키를 넣지 않는다(설정 탭에 풀이가 있다).
// P97: 호출자에 실행 명령(startCommand, 예: 래퍼 명령 `mywrap claude`)을 둔다. 비우면 그 하네스의 명령. P115: 모든 에이전트 하네스. 판은 그 명령 뒤에 판의 인자를 붙여
//      터미널에 띄운다(hc 어댑터 startAgent). 이어 가기·되살리기·워크트리·하위 세션도 같은 실행 명령이다.
//      명령줄 붙여 넣기(parseCommandLine)는 한 줄(여러 줄도)을 하네스·실행 명령·모델·옵션·추가 인자·환경 변수로 나눈다. 판이 모르는 명령이면 명령 한 줄 호출자다.
import crypto from 'node:crypto';
import { splitArgs, withGeminiModel } from './gemini-args.mjs';
import { withCodexModel } from './codex-args.mjs';
import { withAgyModel } from './agy.mjs';
export { splitArgs } from './gemini-args.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { EFFORTS, PERMISSION_MODES } from './settings.mjs';
import { unlistedModel } from './codex-models.mjs';
import { psLine, psEnvPrefix, platformLine } from './launch.mjs'; // P97. P115: psEnvPrefix는 launch.mjs
import { adapterOf, reservedArg } from './harness.mjs'; // P115: 하네스 어댑터 표
import { protocolsOf } from './harness.mjs'; // P115: 하네스가 쓰는 연결 프로토콜
import { checkOf } from './connections.mjs'; // P115
import { V2_KEY, migrateLaunchers, legacyInitialLaunchers, legacyGatewayConnection } from './launcher-migrate.mjs'; // P115: 옮기기(옛 이름은 그 파일에만)
export { LEGACY_KEYS } from './launcher-migrate.mjs';

export const META_KEY = V2_KEY; // P115: 연결 참조가 든 목록. 옛 키(launchers)는 옛 코드가 쓴다
export const LEGACY_META_KEY = 'launchers';
export const VERSION = 2;
export const COMMAND_MAX = 400;
export const NAME_MAX = 40;
export const ARGS_MAX = 300;
export const ENV_MAX = 20; // 이름 수
export const ENV_VALUE_MAX = 500;
export const MODEL_RE = /^(?:[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]{0,511})?$/;
const KIND_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const ICON_RE = /^[a-z][a-z0-9-]{0,19}$/;
const CTRL_RE = /[\x00-\x1f\x7f]/;
// 판이 정하는 값이라 호출자가 덮지 못하는 것: 환경 변수(판·터미널·계정 폴더가 넣는 이름)와 claude 인자(판의 hook·세션 ID·이어 가기)
const RESERVED_ENV = /^(HERDR_|HC_|ATRIUM_|MTASK_|CLAUDECODE$|CLAUDE_CODE_ENTRYPOINT$|CLAUDE_CONFIG_DIR$|CLAUDE_SECURESTORAGE_CONFIG_DIR$|GEMINI_CLI_HOME$|ANTIGRAVITY_GEMINI_DIR$|ANTIGRAVITY_CONFIG_REL_DIR$)/i;
export const RESERVED_CLAUDE_ARGS = new Set(['--settings', '--session-id', '--resume', '-r', '--continue', '-c', '--fork-session', '--permission-mode', '--model', '--effort', '--plugin-dir', '--append-system-prompt-file', '--worktree', '-w', '--no-chrome', '-p', '--print']);

// 하네스 정의. fields는 설정 탭이 보일 칸, models는 알려진 모델(직접 입력도 받는다), kind는 판이 기록하는 에이전트 종류
export const HARNESSES = {
  claude: { id: 'claude', kind: 'claude', label: 'Claude Code', fields: ['startCommand', 'connection', 'account', 'model', 'effort', 'permissionMode', 'args', 'env'], models: ['haiku', 'sonnet', 'opus', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'] },
  codex: { id: 'codex', kind: 'codex', label: 'Codex', fields: ['startCommand', 'connection', 'model', 'args'], models: [], liveModels: true, warnUnlisted: true }, // macOS 판: 정적 Codex 모델 없음(실제 model/list·캐시만, BRIEF 모델 목록)
  // Gemini CLI·Antigravity(agy): 판의 hook 설정과 native 기록을 쓰는 전용 연동(gemini.mjs, agy-*.mjs). 모델은 실제 목록(liveModels)에서 고른다
  gemini: { id: 'gemini', kind: 'gemini', label: 'Gemini CLI', fields: ['startCommand', 'model', 'args', 'env'], models: [], liveModels: true },
  agy: { id: 'agy', kind: 'agy', label: 'Antigravity', fields: ['startCommand', 'model', 'args', 'env'], models: [], liveModels: true }, // P72: models는 Codex 캐시를 읽지 못할 때의 목록. 목록에 없는 이름은 경고만 한다
  // P115: opencode·pi는 하네스 어댑터(harness.mjs)가 env·안내문·이어 가기를 맞춘다. 모델은 opencode가 "<제공자>/<모델>", pi가 --model 값
  opencode: { id: 'opencode', kind: 'opencode', label: 'opencode', fields: ['startCommand', 'connection', 'model', 'args'], models: [] },
  pi: { id: 'pi', kind: 'pi', label: 'pi', fields: ['startCommand', 'connection', 'model', 'args'], models: [] },
  shell: { id: 'shell', kind: 'shell', label: 'Shell', fields: [], models: [] },
  command: { id: 'command', kind: 'shell', label: 'Command', fields: ['command', 'env'], models: [] },
};
// 터미널이 아는 그 밖의 종류(pi, grok 등)는 추가 인자만 받는다
export const harnessOf = (id) => (Object.hasOwn(HARNESSES, id) ? HARNESSES[id] : null) || (KIND_RE.test(String(id || '')) ? { id, kind: id, label: id, fields: ['startCommand', 'args'], models: [] } : null); // P115: 실행 명령은 모든 에이전트 하네스
// dyn: 하네스별로 읽어 온 목록 { codex: { models, hidden, labels, source } }(P72). 없으면 고정 목록
// P115: protocols는 그 하네스가 쓸 수 있는 연결 프로토콜(설정 탭이 맞지 않는 연결을 흐리게 보인다)
export const describeHarnesses = (dyn = {}) => Object.values(HARNESSES).map((h) => ({ ...(dyn[h.id] ? { ...h, models: [...dyn[h.id].models], hiddenModels: [...(dyn[h.id].hidden || [])], modelLabels: { ...(dyn[h.id].labels || {}) }, modelSource: dyn[h.id].source || null } : { ...h }), protocols: protocolsOf(h.kind) }));
// P72: 하네스가 경고하는 목록 밖 모델 이름인가(Codex). 막지는 않는다
export function modelWarning(l, harnesses) {
  const h = (harnesses || []).find((x) => x.id === l.harness);
  if (!h || !h.warnUnlisted || !h.fields.includes('model') || !h.models?.length) return null;
  return unlistedModel(l.model, { models: h.models, hidden: h.hiddenModels || [] }) ? { key: 'launcherModels.unlisted', vars: { harness: h.label, model: l.model } } : null;
}

const err = (code, message, key, vars = {}) => Object.assign(new Error(message), { code, key: `launchers.err.${key}`, vars });

// Quoting is data only: argv arrays retain their boundaries; strings never expand.
export const quoteArg = (s) => /^[A-Za-z0-9_./:@=-]+$/.test(String(s)) ? String(s) : "'" + String(s).replace(/'/g, "'\\''") + "'";
export const joinArgs = (args) => args.map(quoteArg).join(' ');

// 환경 변수: { 이름: 값 } 또는 "이름=값" 줄 글. 이름 검사, 판이 쓰는 이름 거부, 값은 한 줄
export function normalizeEnv(v) {
  let pairs = [];
  if (v == null || v === '') pairs = [];
  else if (typeof v === 'string') pairs = v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('='); if (i < 1) throw err('bad_request', `환경 변수는 이름=값: ${l.slice(0, 40)}`, 'envLine', { line: l.slice(0, 40) }); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });
  else if (typeof v === 'object' && !Array.isArray(v)) pairs = Object.entries(v);
  else throw err('bad_request', '환경 변수 형식', 'envLine', { line: String(v).slice(0, 40) });
  if (pairs.length > ENV_MAX) throw err('bad_request', `환경 변수는 ${ENV_MAX}개까지`, 'envMany', { max: ENV_MAX });
  const out = {};
  for (const [k, raw] of pairs) {
    const val = String(raw ?? '');
    if (!ENV_NAME_RE.test(k)) throw err('bad_request', `환경 변수 이름: ${k}`, 'envName', { name: String(k).slice(0, 40) });
    if (RESERVED_ENV.test(k)) throw err('bad_request', `보드가 정하는 환경 변수: ${k}`, 'envReserved', { name: k });
    if (val.length > ENV_VALUE_MAX || CTRL_RE.test(val)) throw err('bad_request', `환경 변수 값(${k}): 한 줄, ${ENV_VALUE_MAX}자까지`, 'envValue', { name: k, max: ENV_VALUE_MAX });
    Object.defineProperty(out, k, { value: val, enumerable: true, configurable: true, writable: true });
  }
  return out;
}

// 직접 명령 글 검사: 한 줄(줄바꿈과 제어 문자 없음), 길이 제한. 앞뒤 빈칸은 뗀다. 빈 글이면 ''
export function checkCommand(text) {
  const c = String(text ?? '').trim();
  if (c.length > COMMAND_MAX) throw err('bad_request', `실행 명령이 너무 깁니다 (${c.length}자, ${COMMAND_MAX}자까지)`, 'commandLong', { n: c.length, max: COMMAND_MAX });
  if (CTRL_RE.test(c)) throw err('bad_request', "실행 명령은 줄바꿈, 탭, 제어 문자 없이 한 줄로 입력하세요.", 'commandLine');
  return c;
}
// P115: 런처의 연결 참조 검사. connections를 주면 있는 연결이어야 하고, 그 하네스가 쓰는 프로토콜이어야 한다
function connectionOf(v, h, connections) {
  const id = String(v ?? '').trim();
  if (!id) return '';
  const ps = protocolsOf(h.kind);
  if (!ps.length) throw err('bad_request', `${h.label}는 연결을 쓰지 않습니다.`, 'connectionHarness', { harness: h.label });
  if (!connections) return id;
  const c = connections.find((x) => x.id === id);
  if (!c) throw err('bad_request', `연결을 찾을 수 없습니다: ${id}`, 'connectionMissing', { id: id.slice(0, 40) });
  if (!ps.includes(c.protocol)) throw err('bad_request', `${h.label}는 ${c.protocol} 연결을 쓸 수 없습니다(${ps.join(', ')}만).`, 'connectionProtocol', { harness: h.label, protocol: c.protocol, supported: ps.join(', ') });
  return id;
}

// ---------- P97: 실행 명령 ----------
export const START_MAX = 120;
const START_WORDS = 8;
// 첫 낱말은 PATH에서 찾는 명령 이름이다(이어 가기 명령 resume_argv의 첫 요소는 경로 없는 명령 이름이다). 뒤 낱말은 따옴표·셸 기호 없이
const START_FIRST_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
// 실행 명령 → 낱말들. 비었으면 [](판은 claude를 쓴다)
export const startWords = (s) => splitArgs(s); // 따옴표로 묶은 경로(공백 포함)를 한 낱말로
// 판이 claude 세션을 다시 띄울 때 칠 실행 명령의 낱말들([]면 claude)
export const claudeStartOf = (s) => (s && s.kind === 'claude' ? startWords(s.startCommand) : []);
// P115: 그 하네스의 기본 명령 이름(실행 명령이 이것 하나면 비운다)
const defaultCommandOf = (harness) => { const h = harnessOf(harness); if (!h || h.id === 'claude') return 'claude'; const a = adapterOf(h.kind); return a ? a.command : h.kind; };
// 어댑터 startAgent에 넘길 값: 실행 명령이 있을 때만 { command }
// macOS 판: Claude 계정 폴더(rt.claudeConfigDir)로 띄운 세션은 다시 띄울 때도 그 CLAUDE_CONFIG_DIR을 준다
export const startOpt = (s) => {
  const w = claudeStartOf(s);
  const dir = s && s.kind === 'claude' && s.rt && s.rt.claudeConfigDir;
  return { ...(w.length ? { command: w } : {}), ...(dir ? { env: { CLAUDE_CONFIG_DIR: dir } } : {}) };
};
// 실행 명령을 확인하고 정리한다. 빈칸이나 `claude` 하나면 ''(판의 기본)
// P115: 하네스마다 기본 명령(claude, codex …)과 판이 정하는 인자가 다르다. 따옴표로 묶은 절대 경로(공백 포함)를 받는다(macOS)
export function normalizeStartCommand(v, harness = 'claude') {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const w = splitArgs(s);
  if (s.length > START_MAX || w.length > START_WORDS || CTRL_RE.test(s) || !w.length || w.some((x) => !x || /[\x00-\x1f\x7f]/.test(x)) || (!START_FIRST_RE.test(w[0]) && !path.isAbsolute(w[0]) && !/^[A-Za-z]:[\\/]/.test(w[0]))) throw Object.assign(new Error(`실행 명령: 첫 낱말은 명령 이름, 따옴표·셸 기호 없이 ${START_MAX}자까지`), { code: 'bad_request', key: 'launcherStart.bad', vars: { max: START_MAX } });
  const h = harnessOf(harness);
  const bad = !h || h.id === 'claude' ? w.find((x) => RESERVED_CLAUDE_ARGS.has(x.split('=')[0])) : reservedArg(h.kind, w.slice(1));
  if (bad) throw Object.assign(new Error(`보드가 정하는 인자: ${bad}`), { code: 'bad_request', key: 'launcherStart.reserved', vars: { arg: bad } });
  return w.length === 1 && (process.platform === 'win32' ? w[0].toLowerCase() : w[0]) === defaultCommandOf(harness) ? '' : joinArgs(w);
}
// 명령 이름이 PATH에 있는가(Windows는 PATHEXT와 .ps1도). 30초 담아 둔다. 없어도 저장은 막지 않는다(PowerShell 별칭·함수일 수 있다)
const pathSeen = new Map();
export function onPath(cmd, { env = process.env, now = Date.now(), platform = process.platform } = {}) {
  const key = JSON.stringify([platform, cmd, process.cwd(), env]);
  if (!cmd) return true;
  const c = pathSeen.get(key);
  if (c && now - c.at < 30000) return c.ok;
  const pathVar = env[Object.keys(env).find((k) => k.toUpperCase() === 'PATH')] || '';
  const extVar = env[Object.keys(env).find((k) => k.toUpperCase() === 'PATHEXT')] || '.COM;.EXE;.BAT;.CMD';
  const exts = platform === 'win32' ? ['', ...extVar.toLowerCase().split(';').filter(Boolean), '.ps1'] : [''];
  let ok = false;
  const direct = /[\\/]/.test(cmd);
  for (const d of direct ? [''] : pathVar.split(platform === 'win32' ? ';' : path.delimiter).filter(Boolean)) {
    for (const e of exts) { try { if (fs.statSync(path.join(d, cmd + e)).isFile()) { ok = true; break; } } catch {} }
    if (ok) break;
  }
  pathSeen.set(key, { ok, at: now });
  return ok;
}
// 미리보기에 붙일 실행 명령 경고(첫 낱말이 PATH에 없음)
export function startWarning(l, find = onPath) {
  const w = startWords(l.startCommand);
  return w.length && !find(w[0]) ? { key: 'launcherStart.notFound', vars: { cmd: w[0] } } : null;
}

// 호출자 하나를 확인하고 정리한다. others는 이름 겹침을 볼 다른 호출자들. 하네스가 받지 않는 칸은 비운다
// connections: 연결 목록(주면 참조를 확인한다)
export function normalizeLauncher(input, { others = [], connections = null } = {}) {
  if (!input || typeof input !== 'object') throw err('bad_request', "런처를 지정하세요.", 'empty');
  const name = String(input.name ?? '').trim();
  if (!name || name.length > NAME_MAX || CTRL_RE.test(name)) throw err('bad_request', `이름은 1~${NAME_MAX}자 한 줄`, 'name', { max: NAME_MAX });
  if (others.some((o) => o.id !== input.id && o.name.toLowerCase() === name.toLowerCase())) throw err('name_taken', `이미 사용 중인 런처 이름입니다: ${name}`, 'nameTaken', { name });
  const h = harnessOf(String(input.harness || 'claude'));
  if (!h) throw err('bad_request', `하네스: ${input.harness}`, 'harness', { harness: String(input.harness).slice(0, 32) });
  const has = (f) => h.fields.includes(f);
  const icon = String(input.icon ?? '').trim();
  if (icon && !ICON_RE.test(icon)) throw err('bad_request', `아이콘: ${icon}`, 'icon', { icon: icon.slice(0, 20) });
  const model = has('model') ? String(input.model ?? '').trim() : '';
  if (!MODEL_RE.test(model)) throw err('bad_request', '모델 ID가 올바르지 않다', 'model', { model: model.slice(0, 40) });
  const effort = has('effort') ? String(input.effort ?? '') : '';
  if (!EFFORTS.includes(effort)) throw err('bad_request', `추론 수준: ${effort}`, 'effort', { effort });
  const permissionMode = has('permissionMode') ? String(input.permissionMode || 'manual') : '';
  if (has('permissionMode') && !PERMISSION_MODES.includes(permissionMode)) throw err('bad_request', `권한 모드: ${permissionMode}`, 'permissionMode', { mode: permissionMode });
  const args = has('args') ? (Array.isArray(input.args) ? joinArgs(input.args) : String(input.args ?? '').trim()) : '';
  if (args.length > ARGS_MAX || CTRL_RE.test(args)) throw err('bad_request', `추가 인자: 한 줄, ${ARGS_MAX}자까지`, 'args', { max: ARGS_MAX });
  splitArgs(args); // Reject unfinished quotes before saving a preset.
  if (h.id === 'claude') { const bad = splitArgs(args).find((a) => RESERVED_CLAUDE_ARGS.has(a.split('=')[0])); if (bad) throw err('bad_request', `보드가 정하는 인자: ${bad}`, 'argsReserved', { arg: bad }); }
  else { const bad = reservedArg(h.kind, splitArgs(args)); if (bad) throw err('bad_request', `보드가 정하는 인자: ${bad}`, 'argsReserved', { arg: bad }); } // P115: 하네스 어댑터가 정하는 인자
  if (h.id === 'claude' && splitArgs(args).includes('--')) throw err('bad_request', '인자 종료 표시는 쓸 수 없다', 'argsReserved', { arg: '--' });
  if (h.id === 'gemini') withGeminiModel(args, undefined);
  if (h.id === 'agy') withAgyModel(args, undefined);
  let command = '';
  if (has('command')) {
    command = checkCommand(input.command);
    if (!command) throw err('bad_request', "명령을 입력하세요.", 'commandEmpty');
  }
  const env = has('env') ? normalizeEnv(input.env) : {};
  const startCommand = has('startCommand') ? normalizeStartCommand(input.startCommand, h.id) : ''; // P97. P115: 모든 에이전트 하네스
  const connection = has('connection') ? connectionOf(input.connection, h, connections) : ''; // P115
  // macOS 판: Claude 계정(claude-accounts.mjs의 ID, 기본 계정은 'default'). 비거나 'auto'면 자동(우선순위에서 한도에 걸리지 않은 계정)
  const account = has('account') && input.account && input.account !== 'auto' ? String(input.account) : '';
  if (account && !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(account)) throw err('bad_request', `계정: ${account}`, 'account', { account: account.slice(0, 32) });
  return { id: input.id || null, name, harness: h.id, icon, model, effort, permissionMode, args, env, command, ...(connection ? { connection } : {}), ...(account ? { account } : {}), ...(startCommand ? { startCommand } : {}) }; // 빈 실행 명령·연결은 두지 않는다
}

// 직접 명령에 환경 변수를 붙인다(PowerShell: $env:이름='값'; 작은따옴표는 두 번). P115: launch.mjs로 옮겼다
export { psEnvPrefix };

// 띄울 때 확인할 곳: 런처가 참조하는 연결(health 주소면 2xx·status ok, 아니면 base URL이 닿는지). connections가 없으면 연결 ID만 안다(url 없음).
// 연결 없이 env에 ANTHROPIC_BASE_URL을 직접 둔 claude 런처는 그 주소가 닿는지만 본다(옮기기 뒤에 손으로 넣은 값)
export function gatewayOf(l, connections = null) {
  if (l.connection) {
    const c = connections ? connections.find((x) => x.id === l.connection) : null;
    return c ? { ...checkOf(c), connection: c.id, name: c.name, baseUrl: c.baseUrl } : { url: null, connection: l.connection, missing: !!connections };
  }
  const base = l.harness === 'claude' && l.env && l.env.ANTHROPIC_BASE_URL;
  return base ? { url: base, health: false } : null;
}

// 보여줄 종류(노드 로고). 아이콘이 하네스 종류와 다르면 세션에 flavor로 남긴다(P25)
export const flavorOf = (l) => (l.harness === 'agy' && l.icon === 'gemini' ? null : l.icon && l.icon !== harnessOf(l.harness).kind && l.icon !== l.harness ? l.icon : null);

// 호출자 → session.spawn 값. over는 함께 준 값(모델, 노력 수준, 권한 모드, 추가 인자, 명령)이고 호출자 값을 덮는다
export function resolveLauncher(l, over = {}) {
  const patch = Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  l = normalizeLauncher({ ...l, ...patch });
  const h = harnessOf(l.harness);
  const pick = (k) => (over[k] !== undefined && over[k] !== null && over[k] !== '' ? over[k] : l[k]);
  const base = { kind: h.kind, flavor: flavorOf(l), launcher: l.name, launcherId: l.id || null };
  if (h.id === 'claude') {
    const model = String(pick('model') || '').trim();
    if (!MODEL_RE.test(model)) throw err('bad_request', `모델: ${model}`, 'model', { model: model.slice(0, 40) });
    return { ...base, model: model || null, effort: pick('effort') || null, permissionMode: pick('permissionMode') || 'manual', extraArgs: splitArgs(pick('args')), env: { ...(l.env || {}) }, gateway: gatewayOf(l), connectionId: l.connection || null, account: l.account || null, command: '', startCommand: l.startCommand || '' }; // P97: 실행 명령(빈 값은 claude). P115: 연결 참조. macOS 판: Claude 계정
  }
  if (h.id === 'shell') return { ...base, command: '' };
  // workspace.create.env carries values without expanding them or typing secrets
  // into the TTY. Recall must restore rt.launcherCommand + rt.launcherEnv too.
  if (h.id === 'command') return { ...base, env: { ...l.env }, command: l.command };
  const model = h.fields.includes('model') ? String(pick('model') || '').trim() : '';
  if (!MODEL_RE.test(model)) throw err('bad_request', `모델: ${model}`, 'model', { model: model.slice(0, 40) });
  // Gemini CLI·agy는 판의 전용 연동으로 띄운다: 모델을 그 CLI의 인자 모양으로 넣는다(gemini-args.mjs, agy.mjs)
  if (h.id === 'gemini' || h.id === 'agy') {
    const withModel = h.id === 'gemini' ? withGeminiModel : withAgyModel;
    return { ...base, model: model || null, env: { ...(l.env || {}) }, args: withModel(pick('args'), model || undefined), command: '', startCommand: l.startCommand || '', connectionId: null, gateway: null };
  }
  // P115: 모델과 추가 인자를 따로 준다. 하네스 어댑터(harness.mjs)가 그 하네스의 모양(-m, --model, 설정의 model)으로 바꾼다
  return { ...base, model: model || null, args: splitArgs(pick('args')), command: '', startCommand: l.startCommand || '', connectionId: l.connection || null, gateway: gatewayOf(l) };
}

// 명령 미리보기: 사람이 읽는 명령줄. claude는 판이 덧붙이는 값(hook 설정 파일, 세션 ID, 플러그인)을 빼고 보인다. 환경 변수는 이름만 따로
export function previewLauncher(l) {
  const h = harnessOf(l.harness);
  const envNames = Object.keys(l.env || {});
  if (h.id === 'claude') {
    const s = startWords(l.startCommand); // P97: 실행 명령(비면 claude)
    const a = [...(s.length ? s : ['claude']), '--permission-mode', l.permissionMode || 'manual'];
    if (l.model) a.push('--model', l.model);
    if (l.effort) a.push('--effort', l.effort);
    return { line: joinArgs([...a, ...splitArgs(l.args)]), env: envNames, board: true };
  }
  if (h.id === 'shell') return { line: '', env: [], board: false, shell: true };
  if (h.id === 'command') return { line: l.command, env: envNames, board: false, typed: true };
  const r = resolveLauncher(l);
  const s = startWords(l.startCommand); // P115: 실행 명령. 모델은 그 하네스의 모양(판이 덧붙이는 env·안내문·세션 ID는 빼고 보인다)
  if (h.id === 'gemini' || h.id === 'agy') return { line: joinArgs([...(s.length ? s : [h.kind]), ...r.args]), env: envNames, board: true };
  const a = adapterOf(h.kind);
  return { line: joinArgs([...(s.length ? s : [a ? a.command : h.kind]), ...(r.model && a ? a.modelArgs(r.model) : []), ...r.args]), env: [], board: !!a };
}

// ---------- 기본값과 옮기기 ----------
const plain = (id, name, harness, x = {}) => ({ id, name, harness, icon: '', model: '', effort: '', permissionMode: '', args: '', env: {}, command: '', ...x });

// 처음 켤 때의 호출자 목록(옛 키 모양 v1). 옛 판(P33 전의 설정·세션이 있던 판)은 옛 새 세션 기본값을 옮긴다(launcher-migrate.mjs).
// P72·P122: 새 판은 Claude Code(권한 방식 manual), Codex 둘뿐이고 모두 즐겨찾기다. 같은 입력이면 같은 결과다(ID가 고정).
// 셸 런처는 사람이 설정 › 런처의 "+"로 만들고, 옛 판의 목록(셸 포함)은 바꾸지 않는다
export function initialLaunchers({ oldSettings = null, oldBoard = false, gateway = {} } = {}) {
  // macOS 판: 새 판은 Claude Code·Codex·Gemini(Antigravity) 셋과 셸. Gemini 단추는 agy를 띄우고 Gemini 로고를 쓴다
  if (!oldBoard) return { v: 1, items: [plain('claude', 'Claude Code', 'claude', { permissionMode: 'manual' }), plain('codex', 'Codex', 'codex'), plain('gemini', 'Gemini', 'agy'), plain('shell', 'Shell', 'shell')], favorites: ['claude', 'codex', 'gemini', 'shell'] };
  const legacy = legacyInitialLaunchers(oldSettings || {}, gateway);
  if (!legacy.items.some((l) => l.harness === 'agy' || l.harness === 'gemini')) {
    legacy.items.push(plain('gemini', 'Gemini', 'agy'));
    const i = legacy.favorites.indexOf('codex');
    legacy.favorites.splice(i < 0 ? legacy.favorites.length : i + 1, 0, 'gemini');
  }
  return legacy;
}
// P115: 런처 env에 평문으로 든 인증 값(이름에 KEY·TOKEN·SECRET·PASSWORD). 판은 옮기지 않고 설정 탭에서 연결의 환경 변수 이름으로 바꾸라고 알린다
const AUTH_ENV_RE = /(KEY|TOKEN|SECRET|PASSWORD)/i;
export const authNotices = (items) => items.map((l) => ({ id: l.id, name: l.name, env: Object.entries(l.env || {}).filter(([k, v]) => AUTH_ENV_RE.test(k) && String(v || '').trim()).map(([k]) => k) })).filter((x) => x.env.length);

// 판 기록에 둔 호출자 목록
export class Launchers {
  // codexModels: P72 Codex 모델 목록(codex-models.mjs CodexModels). 없으면 하네스의 고정 목록
  // connections: P115 연결 목록(connections.mjs Connections). legacyGateway: 옛 환경 변수의 게이트웨이 주소({ healthUrl, baseUrl }, 옮기기만 읽는다)
  constructor({ store, broadcast = () => {}, gateway = {}, codexModels = null, connections = null, log = () => {} }) {
    this.store = store; this.broadcast = broadcast; this.gateway = gateway || {}; this.codexModels = codexModels; this.connections = connections; this.log = log;
    this.migrated = this.ensure();
  }
  // 한 번만: 새 키(v2) 목록이 없으면 옛 키(없으면 처음 목록)를 옮겨 만든다. 이미 있으면 목록은 그대로(여러 번 돌려도 같다).
  // 옛 키와 옛 설정 키는 지우지 않는다(옛 판 코드로 돌아가도 그 값을 쓴다). 옛 환경 변수의 게이트웨이는 뜰 때마다 연결로 있게 하고 경고한다(같은 ID라 겹치지 않는다)
  ensure() {
    const out = this.store.getMeta(META_KEY) ? null : this.migrateV2();
    // 옛 환경 변수의 게이트웨이(런처에서 옮긴 연결이 먼저라 같은 주소면 그 이름이 남는다)
    const lg = legacyGatewayConnection(this.gateway);
    if (lg && this.connections) { const c = this.connections.ensure(lg); this.log(`ATRIUM_OCX_HEALTH/ATRIUM_OCX_BASE_URL are deprecated: kept as connection ${c.name} (${c.baseUrl}). Remove them and manage the connection in Settings.`); }
    return out;
  }
  migrateV2() {
    let v1 = this.store.getMeta(LEGACY_META_KEY);
    let created = null;
    if (!v1) {
      const oldSettings = this.store.getMeta('settings');
      let anySession = false;
      try { anySession = !!this.store.db.prepare('SELECT 1 AS x FROM sessions LIMIT 1').get(); } catch {}
      v1 = initialLaunchers({ oldSettings, oldBoard: !!oldSettings || anySession, gateway: this.gateway });
      this.store.setMeta(LEGACY_META_KEY, v1); // 옛 코드도 같은 목록으로 뜨게(P33 전 판)
      created = { oldBoard: !!oldSettings || anySession, favorites: v1.favorites };
    }
    // macOS 판(v0.4 ensure): Gemini 전의 옛 목록(v1)이면 새 목록(v2)에 Gemini(agy) 단추를 한 번만 더한다. 사람이 만든 Gemini/agy 런처·즐겨찾기 순서는 그대로,
    // 지운 기본값은 되살리지 않는다(v2가 생긴 뒤에는 다시 돌지 않는다). 옛 키는 고치지 않는다(옛 코드로 돌아가도 그대로 뜬다)
    if (!created && (v1.v || 1) < VERSION) {
      const items = [...(v1.items || [])], favorites = [...(v1.favorites || [])];
      if (!items.some((l) => ['gemini', 'agy'].includes(l.harness) || l.id === 'gemini')) {
        items.push(plain('gemini', 'Gemini', 'agy'));
        const i = favorites.indexOf('codex');
        favorites.splice(i < 0 ? favorites.length : i + 1, 0, 'gemini');
      }
      v1 = { ...v1, items, favorites };
    }
    const m = migrateLaunchers(v1, { legacyGateway: this.gateway });
    if (this.connections) for (const c of m.connections) this.connections.ensure(c);
    this.store.setMeta(META_KEY, m.list);
    if (m.report.moved.length || m.report.droppedCheckUrl.length) this.store.addEvent(null, 'launchers_migrated', m.report);
    return { ...(created || { oldBoard: true, favorites: m.list.favorites }), v2: m.report };
  }
  connectionItems() { return this.connections ? this.connections.items() : null; }
  data() { const d = this.store.getMeta(META_KEY) || { v: VERSION, items: [], favorites: [] }; const ids = new Set(d.items.map((x) => x.id)); return { v: d.v, items: d.items, favorites: (d.favorites || []).filter((id) => ids.has(id)) }; }
  save(d) { this.store.setMeta(META_KEY, d); const out = this.list(); this.broadcast('launchers.updated', out); return out; }
  // 하네스별로 읽어 온 모델 목록(P72: codex)
  modelLists() { const out = {}; if (this.codexModels) { try { out.codex = this.codexModels.read(); } catch {} } return out; }
  harnesses() { return describeHarnesses(this.modelLists()); }
  // P97: warns는 경고 모두(모델 목록 밖, 실행 명령이 PATH에 없음). warn은 첫 경고(옛 창)
  previewOf(l, hs) { const warns = [modelWarning(l, hs), startWarning(l)].filter(Boolean); return { ...previewLauncher(l), ...(warns.length ? { warn: warns[0], warns } : {}) }; }
  // P115: notices는 env에 평문 인증 값이 든 런처(설정 탭이 알린다). connections는 설정 탭이 런처 틀의 연결 고르기에 쓴다
  list() {
    const d = this.data();
    const hs = this.harnesses();
    const cs = this.connectionItems();
    return { launchers: d.items.map((l) => ({ ...l, favorite: d.favorites.includes(l.id), preview: this.previewOf(l, hs) })), favorites: d.favorites, harnesses: hs, notices: authNotices(d.items), ...(cs ? { connections: cs } : {}) };
  }
  // P115: 그 연결을 참조하는 런처 이름들(연결 지우기를 막는다)
  usersOf(connectionId) { return this.data().items.filter((l) => l.connection === connectionId).map((l) => l.name); }
  // 이름이나 ID(대소문자 무시)
  find(ref) {
    const r = String(ref ?? '').trim().toLowerCase();
    if (!r) return null;
    const items = this.data().items;
    return items.find((l) => l.id.toLowerCase() === r) || items.find((l) => l.name.toLowerCase() === r) || null;
  }
  get(ref) { const l = this.find(ref); if (!l) throw err('no_launcher', `런처를 찾을 수 없습니다: ${ref}`, 'notFound', { ref: String(ref).slice(0, 40) }); return l; }
  create(p) {
    const d = this.data();
    const l = normalizeLauncher({ ...(p && p.launcher ? p.launcher : p), id: null }, { others: d.items, connections: this.connectionItems() });
    l.id = 'l' + crypto.randomBytes(4).toString('hex');
    d.items.push(l);
    if (p && (p.favorite || (p.launcher && p.launcher.favorite))) d.favorites.push(l.id);
    return { launcher: l, ...this.save(d) };
  }
  update(p) {
    const d = this.data();
    const cur = this.get(p && (p.id || p.launcher && p.launcher.id));
    const patch = (p && p.patch) || (p && p.launcher) || {};
    const l = normalizeLauncher({ ...cur, ...patch, id: cur.id }, { others: d.items, connections: this.connectionItems() });
    d.items = d.items.map((x) => (x.id === cur.id ? l : x));
    return { launcher: l, ...this.save(d) };
  }
  delete(p) {
    const d = this.data();
    const cur = this.get(p && p.id);
    d.items = d.items.filter((x) => x.id !== cur.id);
    d.favorites = d.favorites.filter((x) => x !== cur.id);
    return this.save(d);
  }
  // 즐겨찾기 켜기·끄기. index를 주면 그 자리에(없으면 끝)
  favorite(p) {
    const d = this.data();
    const cur = this.get(p && p.id);
    const fav = d.favorites.filter((x) => x !== cur.id);
    if (p.favorite !== false) { const i = Number.isInteger(p.index) ? Math.max(0, Math.min(p.index, fav.length)) : fav.length; fav.splice(i, 0, cur.id); }
    d.favorites = fav;
    return this.save(d);
  }
  // 즐겨찾기 순서: ids는 즐겨찾기 ID 전부를 새 순서로
  order(p) {
    const d = this.data();
    const ids = Array.isArray(p && p.ids) ? p.ids.map(String) : null;
    if (!ids || ids.length !== d.favorites.length || new Set(ids).size !== ids.length || ids.some((x) => !d.favorites.includes(x))) throw err('bad_request', "즐겨찾기 순서에는 현재 즐겨찾기에 추가된 ID가 모두 포함되어야 합니다.", 'order');
    d.favorites = ids;
    return this.save(d);
  }
  // 아직 저장하지 않은 호출자의 미리보기와 확인(설정 탭이 고르는 대로 부른다)
  preview(p) {
    const d = this.data();
    const l = normalizeLauncher((p && p.launcher) || p, { others: d.items, connections: this.connectionItems() });
    return { launcher: l, preview: this.previewOf(l, this.harnesses()) };
  }
  // P97: 붙여 넣은 명령줄을 호출자 칸으로 나눈다(저장하지 않는다). kinds: 터미널이 아는 에이전트 종류. except: 고치는 중인 호출자 ID(이름 겹침에서 뺀다)
  parse(p) {
    const d = this.data();
    const r = parseCommandLine(p && p.text, { kinds: (p && p.kinds) || [] });
    r.launcher.name = uniqueName(r.name, d.items.filter((x) => x.id !== (p && p.except)));
    let preview = null;
    try { const l = normalizeLauncher({ ...r.launcher, id: null }, { others: [] }); preview = this.previewOf(l, this.harnesses()); }
    catch (e) { preview = { error: { code: e.code, key: e.key, vars: e.vars, message: e.message } }; }
    return { launcher: r.launcher, recognized: r.recognized, preview };
  }
}

// ---------- P97: 명령줄 붙여 넣기 ----------
// 셸 글 → 문장들(낱말 배열). 작은따옴표·큰따옴표는 묶음이고 벗긴다(큰따옴표 안의 PowerShell ` 이스케이프는 다음 글자). 줄 끝의 이어 쓰기(\ ` ^)는 이어 붙인다.
// 줄바꿈, ;, &&, ||는 문장을 나눈다. 따옴표 안의 빈칸이 든 낱말은 spaced에 표시한다
export function shellStatements(text, { platform = process.platform } = {}) {
  const powershell = platform === 'win32' || /(?:^|[;\r\n])\s*\$env:/i.test(String(text || ''));
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t]*[\\`^][ \t]*\n/g, ' ');
  const out = []; let cur = []; let word = null; let spaced = false; let q = null;
  const push = () => { if (word !== null) { cur.push(spaced ? { text: word, spaced: true } : word); word = null; spaced = false; } };
  const end = () => { push(); if (cur.length) out.push(cur); cur = []; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === q) {
        if (powershell && q === "'" && src[i + 1] === "'") { word += "'"; i++; }
        else q = null;
      }
      else if (q === '"' && (c === '`' || (c === '\\' && /["\\$`]/.test(src[i + 1] || ''))) && i + 1 < src.length) word += src[++i];
      else { if (/\s/.test(c)) spaced = true; word += c; }
      continue;
    }
    if (c === '\\' && /[\s\\'"$`;|&]/.test(src[i + 1] || '')) { word = (word ?? '') + src[++i]; continue; }
    if (c === "'" || c === '"') { q = c; if (word === null) word = ''; continue; }
    if (c === '\n' || c === ';') { end(); continue; }
    if ((c === '&' || c === '|') && src[i + 1] === c) { end(); i++; continue; }
    if (/\s/.test(c)) { push(); continue; }
    word = (word ?? '') + c;
  }
  if (q) throw Object.assign(new Error('Unclosed quote in command line'), { code: 'bad_request' });
  end();
  return out;
}
const wordText = (w) => (typeof w === 'string' ? w : w.text);
const isSpaced = (w) => typeof w !== 'string' && !!w.spaced;
// 실행 파일 이름(경로·확장자를 뺀 소문자)
const exeBase = (w) => wordText(w).replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|ps1|bat)$/i, '').toLowerCase();
const isClaudeWord = (w) => /^(claude|claude-code)$/.test(exeBase(w));
const hasDir = (w) => /[\\/]/.test(wordText(w));
// 값을 받는 판의 인자(빼면서 값도 함께 뺀다). --resume·-r·--worktree·-w는 값이 없어도 된다
const RESERVED_WITH_VALUE = new Set(['--settings', '--session-id', '--plugin-dir', '--append-system-prompt-file']);
const RESERVED_OPT_VALUE = new Set(['--resume', '-r', '--worktree', '-w']);
const PERMISSION_FROM_FLAG = { '--dangerously-skip-permissions': 'bypassPermissions' };

// 붙여 넣은 글 → { launcher(칸 값), name(제안 이름), recognized: { as: claude|codex|kind|command|empty, harness, board, startCommand, mapped: [{ arg, field }], dropped: [글], env: [이름], skipped: [문장], why? } }
// kinds: 터미널이 아는 에이전트 종류(claude, codex 밖은 추가 인자만 받는다)
export function parseCommandLine(text, { kinds = [], platform = process.platform } = {}) {
  const stmts = shellStatements(text, { platform });
  const env = {}; const envNames = []; const skipped = []; let cmd = null;
  const setEnv = (k, v) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return false; Object.defineProperty(env, k, { value: v, enumerable: true, configurable: true, writable: true }); if (!envNames.includes(k)) envNames.push(k); return true; };
  for (const st of stmts) {
    let w = st;
    const first = wordText(w[0]);
    // PowerShell: $env:이름='값' 또는 $env:이름 = '값'
    const m = /^\$env:([A-Za-z_][A-Za-z0-9_]*)(=(.*))?$/i.exec(first);
    if (m) {
      const v = m[2] !== undefined ? m[3] : wordText(w[1] || '') === '=' ? w.slice(2).map(wordText).join(' ') : null;
      if (v !== null && setEnv(m[1], v)) continue;
    }
    // export·set 이름=값(bash, cmd)
    if (/^(export|set)$/i.test(first) && w.length > 1 && w.slice(1).every((x) => wordText(x).indexOf('=') > 0)) { for (const x of w.slice(1)) { const t = wordText(x); setEnv(t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)); } continue; }
    if (first === 'env') w = w.slice(1);
    // 이름=값 앞머리(bash)
    while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(wordText(w[0]))) { const t = wordText(w[0]); setEnv(t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)); w = w.slice(1); }
    if (!w.length) continue;
    if (cmd) skipped.push(cmd.map(wordText).join(' '));
    cmd = w;
  }
  const rec = { as: 'empty', harness: null, board: false, startCommand: '', mapped: [], dropped: [], env: envNames, skipped };
  const blank = { name: '', harness: 'claude', icon: '', model: '', effort: '', permissionMode: 'manual', args: '', env: {}, command: '', startCommand: '' };
  if (!cmd) return { launcher: { ...blank, env }, name: '', recognized: rec };
  const known = new Set(['gemini', 'agy', ...kinds].filter((k) => k !== 'claude' && k !== 'codex'));
  const at = cmd.findIndex((w) => isClaudeWord(w) || exeBase(w) === 'codex' || known.has(exeBase(w)));
  const asCommand = (why) => {
    const line = platformLine(cmd.map(wordText), platform);
    return { launcher: { ...blank, harness: 'command', permissionMode: '', command: line, env }, name: exeBase(cmd[0]) || 'command', recognized: { ...rec, as: 'command', harness: 'command', why } };
  };
  if (at < 0) return asCommand('unknown');
  const wrapper = cmd.slice(0, at);
  const agent = cmd[at];
  const rest = cmd.slice(at + 1);
  const kind = isClaudeWord(agent) ? 'claude' : exeBase(agent);
  // P115: 래퍼 명령(실행 명령)은 모든 에이전트 하네스가 받는다
  // macOS 판: 따옴표로 묶은 래퍼 인자·경로(공백 포함)도 실행 명령으로 받는다(joinArgs가 따옴표를 보존하고 startWords가 다시 나눈다)
  const out = { model: '', effort: '', permissionMode: '', args: [] };
  const dropped = []; const mapped = [];
  for (let k = 0; k < rest.length; k++) {
    const a = wordText(rest[k]);
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    const value = () => (inline !== undefined ? inline : k + 1 < rest.length ? wordText(rest[++k]) : '');
    if (kind === 'claude') {
      if (flag === '--model') { out.model = value(); mapped.push({ arg: '--model', field: 'model' }); continue; }
      if (flag === '--effort') { out.effort = value(); mapped.push({ arg: '--effort', field: 'effort' }); continue; }
      if (flag === '--permission-mode') { out.permissionMode = value(); mapped.push({ arg: '--permission-mode', field: 'permissionMode' }); continue; }
      if (PERMISSION_FROM_FLAG[flag]) { out.permissionMode = PERMISSION_FROM_FLAG[flag]; mapped.push({ arg: flag, field: 'permissionMode' }); continue; }
      if (RESERVED_CLAUDE_ARGS.has(flag)) {
        let v = '';
        if (inline === undefined && (RESERVED_WITH_VALUE.has(flag) || (RESERVED_OPT_VALUE.has(flag) && k + 1 < rest.length && !wordText(rest[k + 1]).startsWith('-')))) v = ` ${wordText(rest[++k])}`;
        dropped.push(a + v); continue;
      }
    } else if (kind === 'codex') {
      if (flag === '-m' || flag === '--model') { out.model = value(); mapped.push({ arg: flag, field: 'model' }); continue; }
      if (/^-m./.test(a)) { out.model = a.slice(2); mapped.push({ arg: '-m', field: 'model' }); continue; }
    }
    out.args.push(a);
  }
  if (out.args.length) mapped.push({ arg: out.args.join(' '), field: 'args' });
  let startCommand = ''; let agentPath = null;
  const exe = kind === 'claude' ? 'claude' : kind;
  if (wrapper.length) startCommand = joinArgs([...wrapper, agent].map(wordText));
  else if (hasDir(agent)) agentPath = wordText(agent); // 경로로 준 명령은 PATH의 그 명령으로(이어 가기 명령의 첫 낱말은 명령 이름이어야 한다)
  else if (exeBase(agent) !== exe) startCommand = wordText(agent);
  if (startCommand.toLowerCase() === exe) startCommand = '';
  // 판이 정하는 인자(하네스 어댑터)는 뺀다
  if (kind !== 'claude') { const words = out.args; const kept = []; for (let i = 0; i < words.length; i++) { if (reservedArg(kind, [words[i], words[i + 1] || ''])) { dropped.push(words[i]); continue; } kept.push(words[i]); } out.args = kept; }
  const harness = kind;
  const label = kind === 'claude' ? 'Claude' : kind === 'codex' ? 'Codex' : kind;
  const name = [startCommand || (kind === 'claude' && !out.model ? 'Claude Code' : label), out.model].filter(Boolean).join(' ');
  const launcher = { ...blank, harness, model: out.model, effort: kind === 'claude' ? out.effort : '', permissionMode: kind === 'claude' ? out.permissionMode || 'manual' : '', args: joinArgs(out.args), env: ['claude', 'gemini', 'agy'].includes(kind) ? env : {}, startCommand };
  // P115: env의 ANTHROPIC_BASE_URL은 연결로 옮길 값이라 알린다(설정 탭에서 연결을 만들어 고른다)
  const baseUrl = kind === 'claude' && env.ANTHROPIC_BASE_URL ? env.ANTHROPIC_BASE_URL : null;
  // claude 밖은 환경 변수를 받지 않는다(터미널에 넘길 길이 없다): 있으면 명령 한 줄로
  if (!['claude', 'gemini', 'agy'].includes(kind) && envNames.length) return asCommand('envNotClaude');
  return { launcher, name, recognized: { ...rec, as: kind === 'claude' || kind === 'codex' ? kind : 'kind', harness, board: kind === 'claude', startCommand, mapped, dropped, ...(agentPath ? { agentPath } : {}), ...(baseUrl ? { baseUrl } : {}) } };
}
// 겹치지 않는 이름(대소문자 무시). 40자까지 자르고 겹치면 " 2", " 3"…
export function uniqueName(want, items = []) {
  const base = (String(want || '').trim() || 'Launcher').slice(0, NAME_MAX);
  const taken = new Set(items.map((x) => String(x.name).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) { const n = `${base.slice(0, NAME_MAX - 1 - String(i).length)} ${i}`; if (!taken.has(n.toLowerCase())) return n; }
  return base;
}

// 게이트웨이가 닿는가. health면 2xx이고 status가 ok여야 하고, 아니면 무슨 HTTP 답이든 닿은 것으로 본다. 안 닿으면 gateway_down
export async function checkGateway({ url, health = false, name = '', timeoutMs = 2000, fetchImpl = globalThis.fetch }) {
  let why;
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!health) return { ok: true, url };
    if (r.ok) {
      const body = await r.json().catch(() => null);
      if (!body || body.status == null || body.status === 'ok') return { ok: true, url };
      why = `status ${body.status}`;
    } else why = `HTTP ${r.status}`;
  } catch (e) { why = e && e.name === 'TimeoutError' ? 'timeout' : (e && (e.cause && e.cause.code)) || (e && e.message) || 'unreachable'; }
  throw err('gateway_down', `${name ? `${name}: ` : ''}게이트웨이에 연결할 수 없습니다 (${url}: ${why}). 게이트웨이를 실행한 뒤 다시 시도하세요.`, 'gatewayDown', { url, why, name });
}
