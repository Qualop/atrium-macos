// P33 호출자(launcher): 세션을 띄우는 방법 하나. 하네스(claude, codex, herdr가 아는 다른 종류, 셸) + 모델 + 옵션의 조합이거나, 셸 패널에 칠 명령 한 줄이다.
// 목록은 판 기록(meta 표의 `launchers`)에 { v, items, favorites }로 둔다. favorites는 왼쪽 레일에 놓인 호출자 ID의 순서다.
// 하네스마다 무엇을 받고 어떻게 띄우는지는 아래 HARNESSES 표 한곳에 둔다. session.spawn { launcher }는 resolveLauncher로 띄울 값을 얻는다.
// P25의 DeepSeek(opencodex 게이트웨이)는 "Claude Code + 환경 변수(게이트웨이)" 호출자의 한 예다(exampleDeepseek). 판은 게이트웨이를 켜지 않고 닿는지만 본다.
// P72: 새 판에는 DeepSeek 예시를 만들지 않는다(Claude Code, Codex, 셸 셋). 옛 판(P33 전의 설정·세션이 있던 판)은 그대로 DeepSeek를 옮긴다.
// P72: Codex 모델은 Codex의 모델 목록 캐시(codex-models.mjs)를 읽는다. 읽지 못하면 아래 고정 목록이다.
// 환경 변수 값은 판 기록에 평문으로 남는다. 기본·예시 호출자에는 키를 넣지 않는다(설정 탭에 풀이가 있다).
// P97: Claude Code 호출자에 실행 명령(startCommand, 예: `ocx claude`)을 둔다. 비우면 `claude`. 판은 그 명령 뒤에 판의 인자를 붙여 패널에 치고(herdr agent.start는
//      정해진 실행 파일만 띄운다), herdr가 claude를 알아보면 이름을 붙인다(herdr/adapter.mjs startAgent). 이어 가기·되살리기·워크트리·하위 세션도 같은 실행 명령이다.
//      명령줄 붙여 넣기(parseCommandLine)는 한 줄(여러 줄도)을 하네스·실행 명령·모델·옵션·추가 인자·환경 변수로 나눈다. 판이 모르는 명령이면 명령 한 줄 호출자다.
import crypto from 'node:crypto';
import { splitArgs, withGeminiModel } from './gemini-args.mjs';
import { withCodexModel } from './codex-args.mjs';
import { withAgyModel } from './agy.mjs';
export { splitArgs } from './gemini-args.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { EFFORTS, PERMISSION_MODES } from './settings.mjs';
import { unlistedModel } from './codex-cache.mjs';
import { platformLine } from './launch.mjs'; // P97
import { FLAVOR as DEEPSEEK, DEFAULT_MODEL as DEEPSEEK_MODEL, DEFAULT_HEALTH_URL, COMMAND_MAX, proxyEnv, baseUrlOf, checkCommand } from './deepseek.mjs';

export const META_KEY = 'launchers';
export const VERSION = 2;
export const NAME_MAX = 40;
export const ARGS_MAX = 300;
export const ENV_MAX = 20; // 이름 수
export const ENV_VALUE_MAX = 500;
export const MODEL_RE = /^(?:[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]{0,511})?$/;
const KIND_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const ICON_RE = /^[a-z][a-z0-9-]{0,19}$/;
const CTRL_RE = /[\x00-\x1f\x7f]/;
// 판이 정하는 값이라 호출자가 덮지 못하는 것: 환경 변수(herdr·판이 넣는 이름)와 claude 인자(판의 hook·세션 ID·이어 가기)
const RESERVED_ENV = /^(HERDR_|ATRIUM_|MTASK_|CLAUDECODE$|CLAUDE_CODE_ENTRYPOINT$|GEMINI_CLI_HOME$|ANTIGRAVITY_GEMINI_DIR$|ANTIGRAVITY_CONFIG_REL_DIR$)/i;
export const RESERVED_CLAUDE_ARGS = new Set(['--settings', '--session-id', '--resume', '-r', '--continue', '-c', '--fork-session', '--permission-mode', '--model', '--effort', '--plugin-dir', '--append-system-prompt-file', '--worktree', '-w', '--no-chrome', '-p', '--print']);

// 하네스 정의. fields는 설정 탭이 보일 칸, models는 알려진 모델(직접 입력도 받는다), kind는 판이 기록하는 herdr 종류
export const HARNESSES = {
  claude: { id: 'claude', kind: 'claude', label: 'Claude Code', fields: ['startCommand', 'model', 'effort', 'permissionMode', 'allowHerdr', 'args', 'env', 'checkUrl'], models: ['haiku', 'sonnet', 'opus', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'] },
  codex: { id: 'codex', kind: 'codex', label: 'Codex', fields: ['model', 'args', 'env'], models: [], liveModels: true, warnUnlisted: true },
  gemini: { id: 'gemini', kind: 'gemini', label: 'Gemini CLI', fields: ['model', 'args', 'env'], models: [], liveModels: true },
  agy: { id: 'agy', kind: 'agy', label: 'Antigravity', fields: ['model', 'args', 'env'], models: [], liveModels: true },
  shell: { id: 'shell', kind: 'shell', label: 'Shell', fields: [], models: [] },
  command: { id: 'command', kind: 'shell', label: 'Command', fields: ['command', 'env'], models: [] },
};
// herdr가 아는 그 밖의 종류(pi, grok 등)는 추가 인자만 받는다
export const harnessOf = (id) => (Object.hasOwn(HARNESSES, id) ? HARNESSES[id] : null) || (KIND_RE.test(String(id || '')) ? { id, kind: id, label: id, fields: ['args'], models: [] } : null);
// dyn: 하네스별로 읽어 온 목록 { codex: { models, hidden, labels, source } }(P72). 없으면 고정 목록
export const describeHarnesses = (dyn = {}) => Object.values(HARNESSES).map((h) => (dyn[h.id] ? { ...h, models: [...dyn[h.id].models], hiddenModels: [...(dyn[h.id].hidden || [])], modelLabels: { ...(dyn[h.id].labels || {}) }, modelSource: dyn[h.id].source || null } : { ...h }));
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

function checkUrlOf(v) {
  const u = String(v ?? '').trim();
  if (!u) return '';
  let x; try { x = new URL(u); } catch { x = null; }
  if (!x || !/^https?:$/.test(x.protocol) || u.length > 300) throw err('bad_request', `확인 주소: ${u.slice(0, 60)}`, 'checkUrl', { url: u.slice(0, 60) });
  return u;
}

// ---------- P97: 실행 명령 ----------
export const START_MAX = 120;
const START_WORDS = 8;
// 첫 낱말은 PATH에서 찾는 명령 이름이다(herdr의 이어 가기 명령 resume_argv는 첫 요소가 경로 없는 명령 이름이어야 한다). 뒤 낱말은 따옴표·셸 기호 없이
const START_FIRST_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
// 실행 명령 → 낱말들. 비었으면 [](판은 claude를 쓴다)
export const startWords = (s) => splitArgs(s);
// 판이 claude 세션을 다시 띄울 때 칠 실행 명령의 낱말들([]면 herdr agent.start로 claude)
export const claudeStartOf = (s) => (s && s.kind === 'claude' ? startWords(s.startCommand) : []);
// herdr startAgent에 넘길 값: 실행 명령이 있을 때만 { command }
export const startOpt = (s) => { const w = claudeStartOf(s); return w.length ? { command: w } : {}; };
// 실행 명령을 확인하고 정리한다. 빈칸이나 `claude` 하나면 ''(판의 기본)
export function normalizeStartCommand(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const w = splitArgs(s);
  if (s.length > START_MAX || w.length > START_WORDS || CTRL_RE.test(s) || !w.length || w.some((x) => !x || /[\x00-\x1f\x7f]/.test(x)) || (!START_FIRST_RE.test(w[0]) && !path.isAbsolute(w[0]) && !/^[A-Za-z]:[\\/]/.test(w[0]))) throw Object.assign(new Error(`실행 명령: 첫 낱말은 명령 이름, 따옴표·셸 기호 없이 ${START_MAX}자까지`), { code: 'bad_request', key: 'launcherStart.bad', vars: { max: START_MAX } });
  const bad = w.find((x) => RESERVED_CLAUDE_ARGS.has(x.split('=')[0]));
  if (bad) throw Object.assign(new Error(`보드가 정하는 인자: ${bad}`), { code: 'bad_request', key: 'launcherStart.reserved', vars: { arg: bad } });
  return w.length === 1 && (process.platform === 'win32' ? w[0].toLowerCase() : w[0]) === 'claude' ? '' : joinArgs(w);
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
export function normalizeLauncher(input, { others = [] } = {}) {
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
  if (h.id === 'claude') { const bad = splitArgs(args).find((a) => RESERVED_CLAUDE_ARGS.has(a.split('=')[0])); if (bad) throw err('bad_request', `판이 정하는 인자: ${bad}`, 'argsReserved', { arg: bad }); }
  if (h.id === 'claude' && splitArgs(args).includes('--')) throw err('bad_request', '인자 종료 표시는 쓸 수 없다', 'argsReserved', { arg: '--' });
  if (h.id === 'gemini') withGeminiModel(args, undefined);
  if (h.id === 'agy') withAgyModel(args, undefined);
  let command = '';
  if (has('command')) {
    try { command = checkCommand(input.command); } catch (e) { throw err('bad_request', e.message, e.key === 'deepseekCommandLong' ? 'commandLong' : 'commandLine', { max: COMMAND_MAX, n: String(input.command || '').trim().length }); }
    if (!command) throw err('bad_request', "명령을 입력하세요.", 'commandEmpty');
  }
  const env = has('env') ? normalizeEnv(input.env) : {};
  const checkUrl = has('checkUrl') ? checkUrlOf(input.checkUrl) : '';
  const startCommand = has('startCommand') ? normalizeStartCommand(input.startCommand) : ''; // P97
  return { id: input.id || null, name, harness: h.id, icon, model, effort, permissionMode, allowHerdr: has('allowHerdr') ? !!input.allowHerdr : false, args, env, command, checkUrl, ...(startCommand ? { startCommand } : {}) }; // 빈 실행 명령은 두지 않는다(옛 호출자와 모양이 같다)
}

// 띄울 때 확인할 게이트웨이: 확인 주소를 주면 그 health(2xx, status ok), 아니면 ANTHROPIC_BASE_URL이 닿는지(무슨 HTTP 답이든)
export function gatewayOf(l) {
  if (l.harness !== 'claude') return null;
  if (l.checkUrl) return { url: l.checkUrl, health: true };
  const base = l.env && l.env.ANTHROPIC_BASE_URL;
  return base ? { url: base, health: false } : null;
}

// 보여줄 종류(노드 로고). 아이콘이 하네스 종류와 다르면 세션에 flavor로 남긴다(P25 flavor deepseek와 같은 길)
export const flavorOf = (l) => (l.harness === 'agy' && l.icon === 'gemini' ? null : l.icon && l.icon !== harnessOf(l.harness).kind && l.icon !== l.harness ? l.icon : null);

// 호출자 → session.spawn 값. over는 함께 준 값(모델, 노력 수준, 권한 모드, herdr 자동 승인, 추가 인자, 명령)이고 호출자 값을 덮는다
export function resolveLauncher(l, over = {}) {
  const patch = Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  l = normalizeLauncher({ ...l, ...patch });
  const h = harnessOf(l.harness);
  const pick = (k) => (over[k] !== undefined && over[k] !== null && over[k] !== '' ? over[k] : l[k]);
  const base = { kind: h.kind, flavor: flavorOf(l), launcher: l.name, launcherId: l.id || null };
  if (h.id === 'claude') {
    const model = String(pick('model') || '').trim();
    if (!MODEL_RE.test(model)) throw err('bad_request', `모델: ${model}`, 'model', { model: model.slice(0, 40) });
    return { ...base, model: model || null, effort: pick('effort') || null, permissionMode: pick('permissionMode') || 'manual', allowHerdr: over.allowHerdr != null ? !!over.allowHerdr : !!l.allowHerdr, extraArgs: splitArgs(pick('args')), env: { ...(l.env || {}) }, gateway: gatewayOf(l), command: '', startCommand: l.startCommand || '' }; // P97: 실행 명령(빈 값은 claude)
  }
  if (h.id === 'shell') return { ...base, command: '' };
  // workspace.create.env carries values without expanding them or typing secrets
  // into the TTY. Recall must restore rt.launcherCommand + rt.launcherEnv too.
  if (h.id === 'command') return { ...base, env: { ...l.env }, command: l.command };
  const model = h.fields.includes('model') ? String(pick('model') || '').trim() : '';
  if (!MODEL_RE.test(model)) throw err('bad_request', `모델: ${model}`, 'model', { model: model.slice(0, 40) });
  const withModel = h.id === 'codex' ? withCodexModel : h.id === 'gemini' ? withGeminiModel : h.id === 'agy' ? withAgyModel : null;
  const args = withModel ? withModel(pick('args'), model || undefined) : splitArgs(pick('args'));
  return { ...base, ...(withModel ? { model: model || null, env: { ...l.env } } : {}), args, command: '' };
}

// 명령 미리보기: 사람이 읽는 명령줄. claude는 판이 덧붙이는 값(hook 설정 파일, 세션 ID, herdr 스킬)을 빼고 보인다. 환경 변수는 이름만 따로
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
  return { line: joinArgs([h.kind, ...r.args]), env: envNames, board: false };
}

// ---------- 기본값과 옮기기 ----------
const claudeDefault = (o = {}) => ({ id: 'claude', name: 'Claude Code', harness: 'claude', icon: '', model: o.claudeModel || '', effort: o.claudeEffort || '', permissionMode: o.claudePermissionMode || 'manual', allowHerdr: !!o.claudeAllowHerdr, args: '', env: {}, command: '', checkUrl: '' });
const codexDefault = (o = {}) => ({ id: 'codex', name: 'Codex', harness: 'codex', icon: '', model: '', effort: '', permissionMode: '', allowHerdr: false, args: o.codexArgs || '', env: {}, command: '', checkUrl: '' });
const geminiDefault = () => ({ id: 'gemini', name: 'Gemini', harness: 'agy', icon: '', model: '', effort: '', permissionMode: '', allowHerdr: false, args: '', env: {}, command: '', checkUrl: '' });
const shellDefault = () => ({ id: 'shell', name: 'Shell', harness: 'shell', icon: '', model: '', effort: '', permissionMode: '', allowHerdr: false, args: '', env: {}, command: '', checkUrl: '' });
// P25 DeepSeek: Claude Code + opencodex 게이트웨이 환경 변수. 옛 판에 직접 명령이 있었으면 그 명령 호출자다(아이콘은 DeepSeek)
export function exampleDeepseek(o = {}, gw = {}) {
  const healthUrl = gw.healthUrl || DEFAULT_HEALTH_URL;
  if (o.deepseekCommand) return { id: 'deepseek', name: 'DeepSeek', harness: 'command', icon: DEEPSEEK, model: '', effort: '', permissionMode: '', allowHerdr: false, args: '', env: {}, command: o.deepseekCommand, checkUrl: '' };
  return { id: 'deepseek', name: 'DeepSeek', harness: 'claude', icon: DEEPSEEK, model: o.deepseekModel || DEEPSEEK_MODEL, effort: '', permissionMode: o.claudePermissionMode || 'manual', allowHerdr: !!o.claudeAllowHerdr, args: '', env: proxyEnv(baseUrlOf({ baseUrl: gw.baseUrl || null, healthUrl })), command: '', checkUrl: healthUrl };
}
export const LEGACY_KEYS = ['claudeModel', 'claudeEffort', 'claudePermissionMode', 'claudeAllowHerdr', 'codexArgs', 'deepseekModel', 'deepseekCommand'];

// 처음 켤 때의 호출자 목록. 기존 기본값을 옮기고 Gemini(agy) 단추 하나를 더한다.
// 새 판에는 별도 게이트웨이 호출자를 만들지 않는다. 기존 판의 DeepSeek 설정·즐겨찾기는 유지한다.
export function initialLaunchers({ oldSettings = null, oldBoard = false, gateway = {} } = {}) {
  if (!oldBoard) return { v: VERSION, items: [claudeDefault(), codexDefault(), geminiDefault(), shellDefault()], favorites: ['claude', 'codex', 'gemini', 'shell'] };
  const o = oldSettings || {};
  const items = [claudeDefault(o), codexDefault(o), geminiDefault(), shellDefault(), exampleDeepseek(o, gateway)];
  const favorites = oldBoard ? ['claude', 'codex', 'gemini', 'deepseek', 'shell'] : ['claude', 'codex', 'gemini', 'shell'];
  return { v: VERSION, items, favorites };
}

// 판 기록에 둔 호출자 목록
export class Launchers {
  // codexModels: P72 Codex 모델 목록(codex-models.mjs CodexModels). 없으면 하네스의 고정 목록
  constructor({ store, broadcast = () => {}, gateway = {}, codexModels = null }) {
    this.store = store; this.broadcast = broadcast; this.gateway = gateway; this.codexModels = codexModels;
    this.migrated = this.ensure();
  }
  // 한 번만: 목록이 없으면 만든다. 이미 있으면 아무것도 하지 않는다(여러 번 돌려도 같다). 옛 설정 키는 지우지 않는다(옛 판 코드로 돌아가도 그 값을 쓴다)
  ensure() {
    const existing = this.store.getMeta(META_KEY);
    if (existing) {
      if ((existing.v || 1) >= VERSION) return null;
      const items = [...existing.items], favorites = [...(existing.favorites || [])];
      // Upgrade once. Keep custom Gemini/agy presets and favorite ordering, and
      // do not resurrect the default if the user later deletes it.
      if (!items.some((l) => ['gemini', 'agy'].includes(l.harness) || l.id === 'gemini')) {
        const gemini = geminiDefault(); items.push(gemini);
        const codex = favorites.indexOf('codex');
        favorites.splice(codex < 0 ? favorites.length : codex + 1, 0, gemini.id);
      }
      this.store.setMeta(META_KEY, { ...existing, v: VERSION, items, favorites });
      return { oldBoard: true, favorites };
    }
    const oldSettings = this.store.getMeta('settings');
    let anySession = false;
    try { anySession = !!this.store.db.prepare('SELECT 1 AS x FROM sessions LIMIT 1').get(); } catch {}
    const v = initialLaunchers({ oldSettings, oldBoard: !!oldSettings || anySession, gateway: this.gateway });
    this.store.setMeta(META_KEY, v);
    return { oldBoard: !!oldSettings || anySession, favorites: v.favorites };
  }
  data() { const d = this.store.getMeta(META_KEY) || { v: VERSION, items: [], favorites: [] }; const ids = new Set(d.items.map((x) => x.id)); return { v: d.v, items: d.items, favorites: (d.favorites || []).filter((id) => ids.has(id)) }; }
  save(d) { this.store.setMeta(META_KEY, d); const out = this.list(); this.broadcast('launchers.updated', out); return out; }
  // 하네스별로 읽어 온 모델 목록(P72: codex)
  modelLists() { const out = {}; if (this.codexModels) { try { out.codex = this.codexModels.read(); } catch {} } return out; }
  harnesses() { return describeHarnesses(this.modelLists()); }
  // P97: warns는 경고 모두(모델 목록 밖, 실행 명령이 PATH에 없음). warn은 첫 경고(옛 창)
  previewOf(l, hs) { const warns = [modelWarning(l, hs), startWarning(l)].filter(Boolean); return { ...previewLauncher(l), ...(warns.length ? { warn: warns[0], warns } : {}) }; }
  list() {
    const d = this.data();
    const hs = this.harnesses();
    return { launchers: d.items.map((l) => ({ ...l, favorite: d.favorites.includes(l.id), preview: this.previewOf(l, hs) })), favorites: d.favorites, harnesses: hs };
  }
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
    const l = normalizeLauncher({ ...(p && p.launcher ? p.launcher : p), id: null }, { others: d.items });
    l.id = 'l' + crypto.randomBytes(4).toString('hex');
    d.items.push(l);
    if (p && (p.favorite || (p.launcher && p.launcher.favorite))) d.favorites.push(l.id);
    return { launcher: l, ...this.save(d) };
  }
  update(p) {
    const d = this.data();
    const cur = this.get(p && (p.id || p.launcher && p.launcher.id));
    const patch = (p && p.patch) || (p && p.launcher) || {};
    const l = normalizeLauncher({ ...cur, ...patch, id: cur.id }, { others: d.items });
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
    const l = normalizeLauncher((p && p.launcher) || p, { others: d.items });
    return { launcher: l, preview: this.previewOf(l, this.harnesses()) };
  }
  // P97: 붙여 넣은 명령줄을 호출자 칸으로 나눈다(저장하지 않는다). kinds: herdr가 아는 에이전트 종류. except: 고치는 중인 호출자 ID(이름 겹침에서 뺀다)
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
// kinds: herdr가 아는 에이전트 종류(claude, codex 밖은 추가 인자만 받는다)
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
  const blank = { name: '', harness: 'claude', icon: '', model: '', effort: '', permissionMode: 'manual', allowHerdr: false, args: '', env: {}, command: '', checkUrl: '', startCommand: '' };
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
  if (kind !== 'claude' && wrapper.length) return asCommand('wrapperNotClaude');
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
  if (kind === 'claude') {
    if (wrapper.length) startCommand = joinArgs([...wrapper, agent].map(wordText));
    else if (hasDir(agent)) agentPath = wordText(agent); // 경로로 준 claude는 PATH의 claude로(이어 가기 명령의 첫 낱말은 명령 이름이어야 한다)
    else if (exeBase(agent) !== 'claude') startCommand = wordText(agent);
    if (startCommand.toLowerCase() === 'claude') startCommand = '';
  }
  const harness = kind;
  const label = kind === 'claude' ? 'Claude' : kind === 'codex' ? 'Codex' : kind;
  const name = [startCommand || (kind === 'claude' && !out.model ? 'Claude Code' : label), out.model].filter(Boolean).join(' ');
  const launcher = { ...blank, harness, model: out.model, effort: kind === 'claude' ? out.effort : '', permissionMode: kind === 'claude' ? out.permissionMode || 'manual' : '', args: joinArgs(out.args), env, startCommand };
  // claude 밖은 환경 변수를 받지 않는다(herdr에 넘길 길이 없다): 있으면 명령 한 줄로
  if (!['claude', 'codex', 'gemini', 'agy'].includes(kind) && envNames.length) return asCommand('envUnsupported');
  return { launcher, name, recognized: { ...rec, as: kind === 'claude' || kind === 'codex' ? kind : 'kind', harness, board: kind === 'claude', startCommand, mapped, dropped, ...(agentPath ? { agentPath } : {}) } };
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
