// Pure launch planning. Runtime hooks, pane ownership and trust remain Backend's
// responsibility. env/command are launch data and must not be copied to events.
import { applyAgentAutoApprove } from './auto-approval.mjs';
import { DEFAULTS, EFFORTS, PERMISSION_MODES } from './settings.mjs';
import { resolveLauncher, splitArgs, MODEL_RE, normalizeLauncher, normalizeStartCommand } from './launchers.mjs';
import { modelFromArgs, withCodexModel } from './codex-args.mjs';
import { geminiModelFromArgs, withGeminiModel } from './gemini-args.mjs';
import { agyModelFromArgs, withAgyModel } from './agy.mjs';

const bad = (message) => Object.assign(new Error(message), { code: 'bad_request' });
const shape = (p) => ({ kind: 'claude', flavor: null, launcher: null, launcherId: null,
  command: '', model: null, effort: null, permissionMode: 'manual',
  extraArgs: [], env: {}, gateway: null, connectionId: null, account: null, args: [], startCommand: null, ...p });

// Stable integration API used by Backend.spawn and delegation. All args are argv
// arrays. Empty/null model explicitly clears a non-Claude provider's model flag.
export function spawnPlanOf(b, p = {}) {
  const settings = { ...(b.store?.getMeta?.('settings') || {}), ...(b.features?.settings?.get?.() || {}) };
  return applyAgentAutoApprove(rawSpawnPlanOf(b, p), settings);
}

function rawSpawnPlanOf(b, p = {}) {
  const L = b.features?.launchers;
  const over = { model: p.model, effort: p.effort, permissionMode: p.permissionMode,
    args: p.args, command: p.command, startCommand: p.startCommand };
  if (p.launcherDef || p.launcher) {
    if (!p.launcherDef && !L) throw Object.assign(new Error(`없는 호출자: ${p.launcher}`), { code: 'no_launcher' });
    const result = resolveLauncher(p.launcherDef || L.get(p.launcher), over);
    if (result.kind !== 'shell' && p.startCommand !== undefined) result.startCommand = normalizeStartCommand(p.startCommand, result.kind);
    // P97·P115: 실행 명령이 없는 정의(atrium child의 모델 풀기)는 같은 종류 부모의 것을 물려받는다(null)
    if (p.launcherDef && !Object.hasOwn(p.launcherDef, 'startCommand') && p.startCommand === undefined) result.startCommand = null;
    return finalize(shape({ ...result, ...(p.permissionMode ? { permissionMode: p.permissionMode } : {}) }));
  }
  // Old API callers still use settings defaults. Reading the stored legacy keys
  // also supports Settings implementations which hide them from their UI schema.
  const defaults = { ...DEFAULTS, ...(b.store?.getMeta?.('settings') || {}), ...(b.features?.settings?.get?.() || {}) };
  const kind = p.kind || 'claude';
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(kind)) throw bad('에이전트 종류가 올바르지 않다');
  if (kind === 'claude') {
    const def = normalizeLauncher({ name: 'Claude Code', harness: 'claude', startCommand: p.startCommand,
      model: p.model || defaults.claudeModel || '', effort: p.effort || defaults.claudeEffort || '',
      permissionMode: p.permissionMode || defaults.claudePermissionMode || 'manual', args: p.extraArgs || [] });
    return finalize(shape({ ...resolveLauncher(def), launcher: null, launcherId: null, flavor: p.flavor || null, startCommand: p.startCommand === undefined ? null : def.startCommand || '' }));
  }
  const raw = p.args ?? (kind === 'codex' ? defaults.codexArgs : '');
  const withModel = kind === 'gemini' ? withGeminiModel : kind === 'agy' ? withAgyModel : null;
  // 명시한 빈 모델(null·'')은 인자의 모델 인자도 지운다(Codex: 아래 finalize가 인자의 -m을 모델로 되살리지 않게)
  const clearCodexModel = kind === 'codex' && Object.hasOwn(p, 'model') && !p.model;
  return finalize(shape({ kind, flavor: p.flavor || null, permissionMode: p.permissionMode || 'manual',
    env: { ...(p.env || {}) }, model: p.model || null, args: withModel ? withModel(raw, p.model) : clearCodexModel ? withCodexModel(splitArgs(raw), null) : splitArgs(raw),
    startCommand: p.startCommand === undefined ? null : normalizeStartCommand(p.startCommand, kind) }));
}

function finalize(p) {
  // Gemini CLI·agy: 모델은 인자 안에 있다(판의 전용 연동이 그대로 넘긴다)
  const readModel = p.kind === 'gemini' ? geminiModelFromArgs : p.kind === 'agy' ? agyModelFromArgs : null;
  if (readModel) p.model = readModel(p.args) || null;
  // Codex(하네스 어댑터): 모델은 따로 넘기고 어댑터가 -m을 붙인다. 추가 인자에 든 -m은 모델로 옮기고 인자에서 뺀다(-m이 두 번 붙지 않게)
  if (p.kind === 'codex') {
    const inArgs = modelFromArgs(p.args);
    if (inArgs) { p.model = p.model || inArgs; p.args = withCodexModel(p.args, null); }
  }
  if (p.model && !MODEL_RE.test(p.model)) throw bad('모델 ID가 올바르지 않다');
  if (p.effort && !EFFORTS.includes(p.effort)) throw bad('노력 수준이 올바르지 않다');
  if (!PERMISSION_MODES.includes(p.permissionMode)) throw bad('권한 모드가 올바르지 않다');
  if ([...p.args, ...p.extraArgs].some((v) => typeof v !== 'string' || v.includes('\0'))) throw bad('인자가 올바르지 않다');
  return p;
}
