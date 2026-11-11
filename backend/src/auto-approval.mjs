// 보드 관리 세션에만 적용하는 실행 옵션. 사용자 CLI 설정 파일은 바꾸지 않는다.
// 로컬 --help 확인: Codex, Gemini CLI, agy 1.4.12. Claude의 bypassPermissions는 설치된 SDK 타입과 기존 --permission-mode 실행 경로를 따른다.
import { splitArgs } from './gemini-args.mjs';

export const CODEX_PERMISSION_ARGS = Object.freeze({
  manual: [], plan: [],
  acceptEdits: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'],
  auto: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'],
  dontAsk: ['--dangerously-bypass-approvals-and-sandbox'],
  bypassPermissions: ['--dangerously-bypass-approvals-and-sandbox'],
});
export const codexPermissionArgs = (mode = 'manual') => [...(CODEX_PERMISSION_ARGS[mode] || [])];

const codexValue = new Set(['-a', '--ask-for-approval', '-s', '--sandbox']);
const codexBool = new Set(['--full-auto', '--approve-for-me', '--yolo', '--dangerously-bypass-approvals-and-sandbox']);
const permissionConfig = (s) => /^\s*["']?(?:approval_policy|sandbox_mode)["']?\s*=/.test(s);
function configOption(args, i) {
  const a = args[i];
  if (a === '-c' || a === '--config') return permissionConfig(args[i + 1] || '') ? 2 : 0;
  if (a.startsWith('--config=')) return permissionConfig(a.slice(9)) ? 1 : 0;
  if (a.startsWith('-c') && a.length > 2) return permissionConfig(a.slice(2).replace(/^=/, '')) ? 1 : 0;
  return 0;
}
export function hasCodexPermissionArgs(value = []) {
  const args = splitArgs(value);
  for (let i = 0; i < args.length && args[i] !== '--'; i++) {
    const flag = args[i].split('=')[0];
    if (codexValue.has(flag) || codexBool.has(flag) || /^-[as].+/.test(args[i]) || configOption(args, i)) return true;
  }
  return false;
}

function removePermissions(kind, args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i], flag = a.split('=')[0];
    if (a === '--') { out.push(...args.slice(i)); break; }
    if (kind === 'codex') {
      const n = configOption(args, i);
      if (n) { i += n - 1; continue; }
      if (codexValue.has(flag)) { if (!a.includes('=') && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++; continue; }
      if (codexBool.has(flag) || /^-[as].+/.test(a)) continue;
    } else if (kind === 'gemini') {
      if (['--approval-mode', '--approvalMode'].includes(flag)) { if (!a.includes('=') && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++; continue; }
      if (['--yolo', '--no-yolo', '-y'].includes(flag)) { if (!a.includes('=') && /^(true|false)$/.test(args[i + 1] || '')) i++; continue; }
      // yargs boolean groups may precede -m and its attached model value.
      const group = /^-([dsy]+)(m.*)?$/.exec(a);
      if (group && group[1].includes('y')) { const kept = group[1].replace(/y/g, '') + (group[2] || ''); if (kept) out.push('-' + kept); continue; }
    } else if (kind === 'agy') {
      if (flag === '--mode') { if (!a.includes('=') && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++; continue; }
      if (flag === '--dangerously-skip-permissions') { if (!a.includes('=') && /^(true|false)$/.test(args[i + 1] || '')) i++; continue; }
    } else if (kind === 'claude') {
      if (flag === '--permission-mode') { if (!a.includes('=') && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++; continue; }
      if (flag === '--dangerously-skip-permissions') continue;
    }
    out.push(a);
  }
  return out;
}
const FULL_AUTO = {
  claude: ['--permission-mode', 'bypassPermissions'],
  codex: ['--dangerously-bypass-approvals-and-sandbox'],
  gemini: ['--approval-mode', 'yolo'],
  agy: ['--dangerously-skip-permissions'],
};

// argv in/out, including resume argv. inherit maps parent permissions only when
// Codex has no explicit launcher permission flags. Board opt-in overrides both.
export function providerPermissionArgs(kind, value = [], permissionMode = 'manual', { autoApprove = false, inherit = false } = {}) {
  const args = splitArgs(value);
  if (autoApprove === true && Object.hasOwn(FULL_AUTO, kind)) {
    const kept = removePermissions(kind, args), end = kept.indexOf('--');
    if (end < 0) return [...kept, ...FULL_AUTO[kind]];
    return [...kept.slice(0, end), ...FULL_AUTO[kind], ...kept.slice(end)];
  }
  return kind === 'codex' && inherit && !hasCodexPermissionArgs(args) ? [...args, ...codexPermissionArgs(permissionMode)] : args;
}

// Pure plan conversion. Call only after deciding this is a managed launch.
// Claude uses the plan field; the other providers consume plan.args.
export function applyAgentAutoApprove(plan, settings = {}) {
  if (settings.agentAutoApprove !== true || !Object.hasOwn(FULL_AUTO, plan.kind)) return plan;
  return { ...plan, permissionMode: 'bypassPermissions',
    ...(plan.kind === 'claude' ? { extraArgs: removePermissions('claude', splitArgs(plan.extraArgs)) }
      : { args: providerPermissionArgs(plan.kind, plan.args, plan.permissionMode, { autoApprove: true }) }) };
}
