import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual, stripVTControlCharacters } from 'node:util';
import { findExecutable } from './platform.mjs';
import { splitArgs } from './gemini-args.mjs';

// Native 1.4.12 research (https://antigravity.google/docs/hooks):
// - hooks.json is a named map of hook definitions, separate from settings.json.
// - --settings '{"hooks":...}' fails with "unknown setting hooks".
// - In isolated `plugin list --json` probes, ANTIGRAVITY_GEMINI_DIR and
//   ANTIGRAVITY_CONFIG_REL_DIR did NOT redirect ~/.gemini/config/plugins.
// - A plugin's named hooks passed `plugin validate`, but neither redirected
//   nor workspace plugins appeared in that CLI listing. Runtime session-scoped
//   loading has NOT been verified. Do not implement writeAgySession from these
//   environment names, or copy/symlink credentials to simulate it.
// The explicitly invoked installer below instead registers one named global
// hook. Its parent-owned bridge must emit {} and exit unless ATRIUM_AGY_BRIDGE
// is set. Importing this module never installs anything or starts the CLI.

const fail = (code, message) => Object.assign(new Error(message), { code });
const badRequest = (message) => fail('bad_request', message);
const validModelId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]{0,511}$/.test(value);
const valueFlags = new Set(['--add-dir', '--agent', '--effort', '--log-file', '--mode', '--model', '--project', '--settings', '--prompt-interactive', '-i']);
const booleanFlags = new Set(['--sandbox', '--dangerously-skip-permissions', '--new-project']);
const managedFlags = new Set(['continue', 'c', 'conversation', 'conversation-path', 'resume', 'r', 'session-id', 'session-file', 'print', 'p', 'prompt', 'headless', 'acp', 'experimental-acp', 'input-format', 'output-format', 'json-schema', 'print-timeout', 'disable-slash-commands', 'remote-agent', 'remote-control']);

export const AGY_HOOK_EVENTS = Object.freeze(['SessionStart', 'PreToolUse', 'PostToolUse', 'PreInvocation', 'Stop']);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const shellQuote = (value) => process.platform === 'win32' ? `"${value.replace(/"/g, '""')}"` : `'${value.replace(/'/g, `'"'"'`)}'`;
const validHandler = (handler) => object(handler) && typeof handler.command === 'string' && handler.command.trim()
  && (!('type' in handler) || handler.type === 'command')
  && (!('timeout' in handler) || (Number.isFinite(handler.timeout) && handler.timeout > 0));
const validEvent = (event, entries) => Array.isArray(entries) && entries.every((entry) => {
  if (event !== 'PreToolUse' && event !== 'PostToolUse') return validHandler(entry);
  return object(entry) && (!('matcher' in entry) || typeof entry.matcher === 'string')
    && Array.isArray(entry.hooks) && entry.hooks.every(validHandler);
});

// Explicit installer only. The caller selects the real global path at final
// installation; tests pass a temporary fixture path. Other named definitions
// are preserved, and an identical installation does not rewrite the file.
export function installAgyHooks({ file, nodePath, script }) {
  for (const value of [file, nodePath, script]) {
    if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value)) throw badRequest('Invalid Antigravity hook path');
  }
  let original = null, mode = 0o600, hooks = {};
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw fail('agy_hooks_invalid', 'Antigravity hooks must be a regular JSON file');
    mode = stat.mode & 0o777;
    original = fs.readFileSync(file, 'utf8');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (original !== null) {
    try { hooks = JSON.parse(original.replace(/^\uFEFF/, '')); } catch { throw fail('agy_hooks_invalid', 'Antigravity hooks JSON is malformed'); }
    if (!object(hooks) || Object.values(hooks).some((hook) => !object(hook)
      || ('enabled' in hook && typeof hook.enabled !== 'boolean')
      || [...AGY_HOOK_EVENTS, 'PostInvocation'].some((event) => event in hook && !validEvent(event, hook[event])))) {
      throw fail('agy_hooks_invalid', 'Antigravity hooks must contain named hook definitions with event arrays');
    }
  }
  const entry = { enabled: hooks['atrium-board']?.enabled ?? true };
  for (const event of AGY_HOOK_EVENTS) {
    const handler = { type: 'command', command: [nodePath, script, event].map(shellQuote).join(' '), timeout: 5 };
    entry[event] = event === 'PreToolUse' || event === 'PostToolUse' ? [{ matcher: '*', hooks: [handler] }] : [handler];
  }
  if (isDeepStrictEqual(hooks['atrium-board'], entry)) return { file, changed: false };
  const next = { ...hooks, 'atrium-board': entry };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(file), `.atrium-hooks-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode });
    fs.chmodSync(temporary, mode);
    // Refuse to overwrite edits made since this call read the original file.
    let current = null;
    try { current = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current !== original) throw fail('agy_hooks_changed', 'Antigravity hooks changed during installation; retry');
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { file, changed: true };
}

// Only launch flags verified in native 1.4.12 --help are accepted. Positional
// subcommands could mutate configuration, log in, or replace the managed TUI.
export function validateAgyNewSessionArgs(value) {
  const args = splitArgs(value);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.includes('\0')) throw badRequest('Invalid argument');
    const equal = arg.indexOf('=');
    const flag = equal < 0 ? arg : arg.slice(0, equal);
    const nativeName = flag.replace(/^-+/, '');
    if (managedFlags.has(nativeName)) throw badRequest(`${flag} is managed by Atrium`);
    if (flag === '-m' || /^-m[^-]/.test(flag)) throw badRequest('Antigravity uses --model, not -m');
    if (valueFlags.has(flag)) {
      const next = equal < 0 ? args[++i] : arg.slice(equal + 1);
      if (!next?.trim() || next.startsWith('-') || next.includes('\0')) throw badRequest(`Missing or invalid value for ${flag}`);
    } else if (booleanFlags.has(flag)) {
      if (equal >= 0 && !/^(?:true|false)$/.test(arg.slice(equal + 1))) throw badRequest(`Invalid value for ${flag}`);
    } else throw badRequest(`Unsupported Antigravity session argument: ${flag}`);
  }
  return args;
}

export function agyModelFromArgs(value) {
  let args;
  try { args = validateAgyNewSessionArgs(value); } catch { return ''; }
  let model = '';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i], flag = arg.split('=', 1)[0];
    if (arg.startsWith('--model=')) model = arg.slice(8);
    else if (arg === '--model') model = args[++i];
    else if (valueFlags.has(flag) && !arg.includes('=')) i++;
  }
  return model;
}

// undefined preserves supplied arguments; null/empty means native default.
// Custom IDs need not be present in the authenticated model catalog.
export function withAgyModel(value, model) {
  const args = validateAgyNewSessionArgs(value);
  if (model === undefined) return args;
  const id = String(model ?? '').trim();
  if (id && !validModelId(id)) throw badRequest('Invalid model ID');
  const kept = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i], flag = arg.split('=', 1)[0];
    if (arg === '--model') { i++; continue; }
    if (arg.startsWith('--model=')) continue;
    kept.push(arg);
    if (valueFlags.has(flag) && !arg.includes('=')) kept.push(args[++i]);
  }
  return id ? [...kept, '--model', id] : kept;
}

// Native 1.4.12 emits headerless ID<TAB>display-name rows. Also accept the
// older labeled table form; unknown formats retain the manual-entry fallback.
export function parseAgyModels(output) {
  const text = stripVTControlCharacters(String(output)).replace(/\r/g, '');
  if (/^\s*No models available[.!]?\s*$/i.test(text)) return [];
  const nativeRows = text.trim().split('\n').filter(Boolean);
  if (nativeRows.length && nativeRows.every((line) => /^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]*\t[^\t]+$/.test(line))) {
    const rows = new Map();
    for (const line of nativeRows) {
      const [id, name] = line.split('\t');
      if (!validModelId(id) || !name.trim()) throw fail('model_list_unrecognized', 'Unrecognized Antigravity model list');
      if (!rows.has(id)) rows.set(id, { id, name: name.trim() });
    }
    return [...rows.values()];
  }
  const lines = text.split('\n');
  const header = lines.findIndex((line) => /^\s*Available models:\s*$/i.test(line));
  if (header < 0) throw fail('model_list_unrecognized', 'Unrecognized Antigravity model list');
  const rows = new Map();
  for (const line of lines.slice(header + 1)) {
    const trimmed = line.trim();
    if (!trimmed || /^(?:ID|Model)\s+(?:Name|Display Name)$/i.test(trimmed) || /^[-= ]+$/.test(trimmed)) continue;
    const row = /^(?:[-*]\s+)?([A-Za-z0-9][A-Za-z0-9._:/@\[\]-]*)(?:\s{2,}(.+)|\s+\((.+)\))?$/.exec(trimmed);
    if (!row || !validModelId(row[1])) throw fail('model_list_unrecognized', 'Unrecognized Antigravity model list');
    const id = row[1];
    if (!rows.has(id)) rows.set(id, { id, name: row[2]?.trim() || row[3]?.trim() || id });
  }
  if (!rows.size) throw fail('model_list_unrecognized', 'Antigravity returned no model rows');
  return [...rows.values()];
}

// stdin is closed, no TTY is allocated, browser opening is discouraged, and
// auth prompts terminate the child. 1.4.12 exposes no native --no-login or
// --no-browser flag: BROWSER is best effort, not a proven native guarantee.
// Invoked on provider selection or explicit refresh; never polled in background.
// Never invoke login, accept workspace trust, or run a prompt from this helper.
export function listAgyModels({ executable = findExecutable('agy'), spawnImpl = spawn, timeoutMs = 8000, cwd = os.homedir(), env = process.env } = {}) {
  if (!executable) return Promise.reject(fail('agy_not_installed', 'Antigravity CLI not found'));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(badRequest('Invalid model list timeout'));
  return new Promise((resolve, reject) => {
    let child, done = false, stdout = '', diagnostics = '', bytes = 0, timer, forceTimer;
    const finish = (error, models) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (error && child && child.exitCode == null && child.signalCode == null) {
        child.kill();
        forceTimer = setTimeout(() => { if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL'); }, 250);
        forceTimer.unref();
      }
      if (error) reject(error); else resolve({ models, source: 'agy' });
    };
    try {
      child = spawnImpl(executable, ['models'], {
        cwd, env: { ...env, NO_COLOR: '1', TERM: 'dumb', BROWSER: process.platform === 'win32' ? 'cmd /d /c exit 1' : '/usr/bin/false' },
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false,
      });
    } catch { finish(fail('model_list_failed', 'Unable to list Antigravity models')); return; }
    timer = setTimeout(() => finish(fail('model_list_timeout', 'Antigravity model listing timed out')), timeoutMs);
    child.on('error', () => finish(fail('model_list_failed', 'Unable to list Antigravity models')));
    child.once('exit', () => clearTimeout(forceTimer));
    const receive = (chunk, isStdout) => {
      if (done) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1024 * 1024) { finish(fail('model_list_failed', 'Antigravity model output exceeded the limit')); return; }
      if (isStdout) stdout += chunk;
      // Keep bounded private diagnostics solely for auth classification. Never
      // return auth URLs, tokens, account details, paths or raw stderr to callers.
      diagnostics = (diagnostics + chunk).slice(-8192);
      if (/(?:authentication required|not (?:logged|signed) in|(?:please|run .* to) (?:log|sign) in|open[^\n]*(?:browser|https?:)|sign.in (?:with|to)|log in with|authorize[^\n]*https?:)/i.test(stripVTControlCharacters(diagnostics))) {
        finish(fail('agy_auth_required', 'Sign in to Antigravity separately before listing models'));
      }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('error', () => finish(fail('model_list_failed', 'Unable to read Antigravity model output')));
    child.stderr.on('error', () => finish(fail('model_list_failed', 'Unable to read Antigravity model output')));
    child.stdout.on('data', (chunk) => receive(chunk, true));
    child.stderr.on('data', (chunk) => receive(chunk, false));
    child.on('close', (code) => {
      clearTimeout(forceTimer);
      if (done) return;
      if (code !== 0) { finish(fail('model_list_failed', 'Unable to list Antigravity models')); return; }
      try { finish(null, parseAgyModels(stdout)); } catch (error) { finish(error); }
    });
  });
}
