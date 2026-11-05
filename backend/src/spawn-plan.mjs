// Pure launch planning. Runtime hooks, pane ownership and trust remain Backend's
// responsibility. env/command are launch data and must not be copied to events.
import { DEFAULTS, EFFORTS, PERMISSION_MODES } from './settings.mjs';
import { resolveLauncher, exampleDeepseek, splitArgs, MODEL_RE, normalizeLauncher } from './launchers.mjs';
import { modelFromArgs, withCodexModel } from './codex-args.mjs';
import { geminiModelFromArgs, withGeminiModel } from './gemini-args.mjs';
import { agyModelFromArgs, withAgyModel } from './agy.mjs';
import { FLAVOR as DEEPSEEK, checkCommand } from './deepseek.mjs';

const bad = (message) => Object.assign(new Error(message), { code: 'bad_request' });
const shape = (p) => ({ kind: 'claude', flavor: null, launcher: null, launcherId: null,
  command: '', model: null, effort: null, permissionMode: 'manual', allowHerdr: false,
  extraArgs: [], env: {}, gateway: null, args: [], ...p });

// Stable integration API used by Backend.spawn and delegation. All args are argv
// arrays. Empty/null model explicitly clears a non-Claude provider's model flag.
export function spawnPlanOf(b, p = {}) {
  const L = b.features?.launchers;
  const over = { model: p.model, effort: p.effort, permissionMode: p.permissionMode,
    allowHerdr: p.allowHerdr, args: p.args, command: p.command };
  if (p.launcherDef || p.launcher) {
    if (!p.launcherDef && !L) throw Object.assign(new Error(`없는 호출자: ${p.launcher}`), { code: 'no_launcher' });
    return finalize(shape(resolveLauncher(p.launcherDef || L.get(p.launcher), over)));
  }
  // Old API callers still use settings defaults. Reading the stored legacy keys
  // also supports Settings implementations which hide them from their UI schema.
  const defaults = { ...DEFAULTS, ...(b.store?.getMeta?.('settings') || {}), ...(b.features?.settings?.get?.() || {}) };
  if (p.kind === DEEPSEEK || p.flavor === DEEPSEEK) {
    const command = checkCommand(p.command ?? defaults.deepseekCommand);
    if (command) return shape({ kind: 'shell', flavor: DEEPSEEK, command });
    const def = exampleDeepseek({ ...defaults, deepseekCommand: '' }, { healthUrl: b.cfg?.ocxHealthUrl, baseUrl: b.cfg?.ocxBaseUrl });
    const result = resolveLauncher(def, { ...over, effort: p.effort || '', command: undefined });
    return finalize(shape({ ...result, launcher: null, launcherId: null }));
  }
  const kind = p.kind || 'claude';
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(kind)) throw bad('에이전트 종류가 올바르지 않다');
  if (kind === 'claude') {
    const def = normalizeLauncher({ name: 'Claude Code', harness: 'claude',
      model: p.model || defaults.claudeModel || '', effort: p.effort || defaults.claudeEffort || '',
      permissionMode: p.permissionMode || defaults.claudePermissionMode || 'manual',
      allowHerdr: p.allowHerdr ?? defaults.claudeAllowHerdr, args: p.extraArgs || [] });
    return finalize(shape({ ...resolveLauncher(def), launcher: null, launcherId: null, flavor: p.flavor || null }));
  }
  const raw = p.args ?? (kind === 'codex' ? defaults.codexArgs : '');
  const withModel = kind === 'codex' ? withCodexModel : kind === 'gemini' ? withGeminiModel : kind === 'agy' ? withAgyModel : null;
  return finalize(shape({ kind, flavor: p.flavor || null, permissionMode: p.permissionMode || 'manual',
    args: withModel ? withModel(raw, p.model) : splitArgs(raw) }));
}

function finalize(p) {
  const readModel = p.kind === 'codex' ? modelFromArgs : p.kind === 'gemini' ? geminiModelFromArgs : p.kind === 'agy' ? agyModelFromArgs : null;
  if (readModel) p.model = readModel(p.args) || null;
  if (p.model && !MODEL_RE.test(p.model)) throw bad('모델 ID가 올바르지 않다');
  if (p.effort && !EFFORTS.includes(p.effort)) throw bad('노력 수준이 올바르지 않다');
  if (!PERMISSION_MODES.includes(p.permissionMode)) throw bad('권한 모드가 올바르지 않다');
  if ([...p.args, ...p.extraArgs].some((v) => typeof v !== 'string' || v.includes('\0'))) throw bad('인자가 올바르지 않다');
  return p;
}
