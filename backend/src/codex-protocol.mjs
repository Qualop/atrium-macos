// Local stdio app-server protocol. Checked against codex 0.166.0-alpha.5.1
// generate-json-schema (2026-11-05). No DB/rollout access, shell, or turn/start.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { findExecutable, nodeCliInvocation } from './platform.mjs';

export const codexError = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
export const CODEX_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHODS = new Set(['initialize', 'thread/list', 'thread/read', 'thread/fork', 'thread/turns/list', 'thread/items/list', 'model/list']);

export class CodexProtocol {
  constructor({ executable = findExecutable('codex'), spawnImpl = spawn, timeoutMs = 20000, cwd = os.homedir(), env = process.env, platform = process.platform } = {}) {
    if (!executable) throw codexError('codex_not_installed');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw codexError('bad_request');
    this.timeoutMs = timeoutMs; this.pending = new Map(); this.nextId = 1; this.buffer = ''; this.closed = false;
    const invocation = nodeCliInvocation(executable, ['app-server', '--listen', 'stdio://'], '@openai/codex', { platform });
    try { this.child = spawnImpl(invocation.command, invocation.args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false }); }
    catch { throw codexError('codex_protocol_failed'); }
    const child = this.child;
    child.on('error', () => this.close(codexError('codex_protocol_failed')));
    child.on('close', () => this.close(codexError('codex_protocol_closed')));
    child.stdin.on('error', () => this.close(codexError('codex_protocol_failed')));
    child.stdout.on('error', () => this.close(codexError('codex_protocol_failed')));
    child.stderr.on('error', () => this.close(codexError('codex_protocol_failed')));
    child.stderr.on('data', () => {}); // Never surface CLI diagnostics or credentials.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.receive(chunk));
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'atrium_history', title: 'Atrium', version: '0.3.0' }, capabilities: { experimentalApi: false } });
    this.send({ method: 'initialized', params: {} });
    return this;
  }
  send(message) {
    if (this.closed) throw codexError('codex_protocol_closed');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params = {}) {
    if (!METHODS.has(method)) return Promise.reject(codexError('codex_method_not_allowed'));
    if (this.closed) return Promise.reject(codexError('codex_protocol_closed'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => this.close(codexError('codex_protocol_timeout')), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.send({ id, method, params }); } catch { this.close(codexError('codex_protocol_failed')); }
    });
  }
  receive(chunk) {
    if (this.closed) return;
    this.buffer += chunk;
    if (this.buffer.length > 16 * 1024 * 1024) return this.close(codexError('codex_response_too_large'));
    let end;
    while (!this.closed && (end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { return this.close(codexError('codex_invalid_response')); }
      if (!m || typeof m !== 'object') return this.close(codexError('codex_invalid_response'));
      // An unexpected server request must never trigger a tool/approval action.
      if (m.method && m.id != null) { this.send({ id: m.id, error: { code: -32601, message: 'History client does not handle server requests' } }); continue; }
      const pending = this.pending.get(m.id);
      if (!pending) continue;
      this.pending.delete(m.id); clearTimeout(pending.timer);
      if (m.error) pending.reject(codexError(m.error.code === -32601 ? 'codex_protocol_unsupported' : 'codex_request_failed', { rpcCode: m.error.code }));
      else if (!m.result || typeof m.result !== 'object') pending.reject(codexError('codex_invalid_response'));
      else pending.resolve(m.result);
    }
  }
  close(error = codexError('codex_protocol_closed')) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    const child = this.child;
    child.stdin.end();
    if (child.exitCode == null && child.signalCode == null) {
      child.kill();
      const force = setTimeout(() => { if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL'); }, 1000);
      force.unref(); child.once('exit', () => clearTimeout(force));
    }
  }
}

export async function withCodexProtocol(fn, options) {
  const client = new CodexProtocol(options);
  try { await client.initialize(); return await fn(client); } finally { client.close(); }
}

export async function codexPages(client, method, params, { maxPages = 100, maxRows = 10000 } = {}) {
  const data = [], seen = new Set();
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const r = await client.request(method, { ...params, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(r.data) || data.length + r.data.length > maxRows) throw codexError('codex_invalid_response');
    data.push(...r.data);
    if (r.nextCursor == null) return data;
    if (typeof r.nextCursor !== 'string' || !r.nextCursor || seen.has(r.nextCursor)) throw codexError('codex_invalid_cursor');
    cursor = r.nextCursor; seen.add(cursor);
  }
  throw codexError('codex_history_limit');
}
