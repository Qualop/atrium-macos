// Gemini 전용 hook은 관찰·협업 안내만 한다. 승인과 로그인은 Gemini 터미널에서 처리한다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { findExecutable } from './platform.mjs';

export const GEMINI_EVENTS = ['SessionStart', 'BeforeAgent', 'AfterAgent', 'BeforeTool', 'AfterTool', 'Notification', 'SessionEnd'];
const here = path.dirname(fileURLToPath(import.meta.url));
const quote = (s) => process.platform === 'win32' ? `"${String(s).replace(/"/g, '""')}"` : `'${String(s).replace(/'/g, `'"'"'`)}'`;
const privateJSON = (file, value) => {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function readSettings(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const invalid = () => Object.assign(new Error('Gemini settings must contain an object with valid hook arrays'), { code: 'gemini_settings_invalid' });
  let settings;
  try { settings = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw invalid(); }
  if (!object(settings) || ('hooks' in settings && (!object(settings.hooks) || Object.entries(settings.hooks).some(([key, entries]) => {
    if (key === 'enabled') return typeof entries !== 'boolean';
    if (key === 'disabled') return !Array.isArray(entries) || entries.some((name) => typeof name !== 'string');
    return !Array.isArray(entries) || entries.some((entry) => !object(entry) || !Array.isArray(entry.hooks) || entry.hooks.some((hook) => !object(hook)));
  })))) throw invalid();
  return settings;
}

export function geminiContext({ sessionId, childScript = path.resolve(here, '../bin/atrium-child.mjs'), nodePath = process.execPath }) {
  return [
    'You are a Gemini agent in an Atrium board. Other agents may be Claude Code, Codex or Gemini.',
    'Messages beginning [Atrium 판] describe your assigned colleagues and their roles. Follow those roles when delegating or reviewing.',
    'Use run_shell_command to collaborate. The shell already targets this board through HERDR_SESSION and HERDR_SOCKET_PATH. Never add --session, --machine or --remote to herdr.',
    'Assign work: herdr agent prompt <agent-name> "<specific task>" --wait',
    'Read the result: herdr agent read <agent-name> --source recent-unwrapped --lines 100',
    'Ask a reviewer to inspect a specific change and report concrete defects. Read their answer, fix issues, and request another review when needed. Do not ask a reviewer to recursively delegate the same task back to you.',
    `Create a managed child: ${quote(nodePath)} ${quote(childScript)} child <name> --kind gemini --role reviewer --prompt "<task>"`,
    'Use --kind claude or --kind codex for another provider. Child count/depth limits apply. Do not assume other providers accept your model ID.',
    `List your children: ${quote(nodePath)} ${quote(childScript)} children`,
    'Respect normal tool approvals. Login and workspace trust must be handled by the user. Do not bypass approval prompts.',
    `Your Atrium session ID is ${sessionId}.`,
  ].join('\n');
}

export function writeGeminiSession({ dir, sessionId, hookUrl, token, branchEnv = {}, pluginDir, herdrPath, userHome = process.env.GEMINI_CLI_HOME || os.homedir(), executable = findExecutable('gemini') }) {
  if (!executable) throw Object.assign(new Error('Gemini CLI를 설치한 뒤 다시 시도하세요: npm install -g @google/gemini-cli'), { code: 'not_installed' });
  const profile = path.join(dir, `${sessionId}.gemini-profile`);
  const target = path.join(profile, '.gemini');
  const original = path.join(userHome, '.gemini');
  const file = path.join(target, 'settings.json');
  // Native /settings changes belong to this session. Seed defaults once, then
  // refresh only our bridge; restarting must not reset model/theme choices.
  // Validate before creating any directories or bridge files.
  const base = readSettings(file) ?? readSettings(path.join(original, 'settings.json')) ?? {};
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  fs.mkdirSync(original, { recursive: true, mode: 0o700 });
  for (const name of ['tmp', 'history', 'extensions', 'skills', 'policies']) fs.mkdirSync(path.join(original, name), { recursive: true, mode: 0o700 });
  // Separate only settings. OAuth credentials, extensions and native conversation
  // storage remain owned by Gemini in the existing profile; never copy credentials.
  const shared = new Set(['oauth_creds.json', 'google_accounts.json', 'trustedFolders.json', 'tmp', 'history', 'projects.json', 'installation_id', 'state.json', 'extensions', 'skills', 'policies', 'GEMINI.md']);
  if (fs.existsSync(original)) for (const name of fs.readdirSync(original)) if (name !== 'settings.json') shared.add(name);
  for (const name of shared) {
    const link = path.join(target, name);
    try { fs.lstatSync(link); } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      fs.symlinkSync(path.join(original, name), link, ['tmp', 'history', 'extensions', 'skills', 'policies'].includes(name) ? 'dir' : 'file');
    }
  }
  const bridgeFile = path.join(dir, `${sessionId}.gemini-bridge.json`);
  const branchFile = path.join(dir, `${sessionId}.gemini-branch.json`);
  privateJSON(branchFile, branchEnv);
  const command = [process.execPath, path.resolve(here, '../scripts/gemini-hook.mjs'), bridgeFile].map(quote).join(' ');
  const hooks = { ...base.hooks };
  for (const ev of GEMINI_EVENTS) {
    const kept = (hooks[ev] || []).flatMap((entry) => {
      const userHooks = entry.hooks.filter((hook) => hook.name !== `atrium-${ev}`);
      return userHooks.length || !entry.hooks.length ? [{ ...entry, hooks: userHooks }] : [];
    });
    hooks[ev] = [...kept, { matcher: '*', hooks: [{ type: 'command', name: `atrium-${ev}`, command, timeout: 5000 }] }];
  }
  privateJSON(bridgeFile, { sessionId, hookUrl, token, context: geminiContext({ sessionId }) });
  privateJSON(file, { ...base, hooks });
  const dirs = [pluginDir && path.join(pluginDir, 'bin'), herdrPath && path.dirname(herdrPath), path.dirname(process.execPath), path.dirname(executable)].filter(Boolean);
  const { ATRIUM_SESSION_TOKEN: _token, ...publicEnv } = branchEnv;
  return { settingsPath: file, env: { ...publicEnv, ATRIUM_BRANCH_FILE: branchFile, GEMINI_CLI_HOME: profile, PATH: [...dirs, process.env.PATH || ''].join(path.delimiter) } };
}

export function normalizeGeminiHook(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const mapped = { SessionStart: 'SessionStart', BeforeAgent: 'UserPromptSubmit', AfterAgent: 'Stop', BeforeTool: 'PreToolUse', AfterTool: 'PostToolUse', Notification: 'Notification', SessionEnd: 'SessionEnd' }[body.hook_event_name];
  if (!mapped) return null;
  const out = { hook_event_name: mapped, cwd: body.cwd };
  if (mapped === 'UserPromptSubmit') { if (typeof body.prompt !== 'string') return null; out.prompt = body.prompt; }
  if (mapped === 'Stop') { if (typeof body.prompt_response !== 'string') return null; out.last_assistant_message = body.prompt_response; }
  if (mapped === 'SessionEnd') out.reason = body.reason;
  if (mapped === 'Notification') out.notification_type = body.notification_type;
  if (mapped === 'PreToolUse' || mapped === 'PostToolUse') {
    out.tool_name = body.tool_name === 'run_shell_command' ? 'Bash' : body.tool_name;
    out.tool_input = body.tool_input || {};
    out.tool_use_id = body.tool_use_id || body.tool_call_id || crypto.createHash('sha256').update(JSON.stringify([body.session_id, body.tool_name, body.tool_input])).digest('hex').slice(0, 24);
    const response = body.tool_response;
    if (mapped === 'PostToolUse') {
      out.tool_response = typeof response === 'string' ? response : typeof response?.llmContent === 'string' ? response.llmContent : JSON.stringify(response?.llmContent ?? response ?? '');
      if (response?.error) { out.hook_event_name = 'PostToolUseFailure'; out.error = typeof response.error === 'string' ? response.error : JSON.stringify(response.error); }
    }
  }
  return out;
}

export function geminiAuthIssue(text) {
  return /client is no longer supported for Gemini Code Assist for individuals/i.test(String(text).replace(/\s+/g, ' '))
    ? 'Google 계정은 로그인됐지만 개인용 Gemini CLI 연결이 거절됐습니다. 새 세션에서 Gemini (Antigravity)를 선택하세요. 같은 로그인을 반복해도 해결되지 않습니다.' : null;
}
