// Antigravity hook contracts use camelCase. They do not contain complete final
// text or shell stdout, so answer extraction remains the herdr terminal fallback.
export function normalizeAgyHook(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const ev = body.atriumEvent;
  if (!['SessionStart', 'PreToolUse', 'PostToolUse', 'PreInvocation', 'Stop'].includes(ev)) return null;
  const out = { hook_event_name: ['PreToolUse', 'PostToolUse', 'SessionStart'].includes(ev) ? ev : 'Notification', cwd: body.workspacePaths?.[0] };
  if (body.toolCall) {
    out.tool_name = body.toolCall.name === 'run_command' ? 'Bash' : body.toolCall.name;
    out.tool_input = body.toolCall.name === 'run_command' ? { command: body.toolCall.args?.CommandLine } : body.toolCall.args;
    out.tool_use_id = `${body.conversationId}:${body.stepIdx}`;
    if (ev === 'PostToolUse' && body.error) { out.hook_event_name = 'PostToolUseFailure'; out.error = body.error; }
    // There is no stdout field in this provider's PostToolUse contract. Never
    // fabricate a reply event from an empty response.
    out.noToolOutput = ev === 'PostToolUse';
  }
  out.notification_type = ev === 'Stop' ? 'agy_stop' : ev === 'PreInvocation' ? 'agy_working' : undefined;
  return out;
}

// Native 1.4 onboarding menus can be reported as idle by herdr 0.9.5. Only
// the actual composer footer permits submission; all menus remain human-owned.
export function agyComposerState(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  const footer = lines.slice(-8).join('\n');
  if (/Navigate\s*[·|]|Select login method|Do you trust|\[(?:Next|Done|Previous)\]/i.test(footer)) return 'waiting';
  if (/\?\s+for shortcuts/i.test(footer)) return 'ready';
  return 'starting';
}
