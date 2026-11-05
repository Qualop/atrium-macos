import fs from 'node:fs';
import path from 'node:path';
import { CODEX_ID, codexError, codexPages, withCodexProtocol } from './codex-protocol.mjs';
import { normalizeModels } from './codex-models.mjs';

// Dev histories must be explicitly isolated. A symlink may not escape the board.
export function codexImportAllowed(cfg) {
  if (cfg.codexHistory === false) return { ok: false, reason: 'disabled' };
  if (cfg.profile !== 'dev') return { ok: true, reason: null };
  if (!cfg.codexHome || !cfg.codexHomeExplicit) return { ok: false, reason: 'dev_default_dir' };
  try {
    const home = fs.realpathSync(cfg.codexHome), data = fs.realpathSync(cfg.dataDir);
    const relative = path.relative(data, home);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { ok: false, reason: 'dev_outside_data' };
    return { ok: true, reason: null };
  } catch { return { ok: false, reason: 'no_codex_home' }; }
}

export function codexInfo(thread) {
  if (!thread || !CODEX_ID.test(thread.id) || typeof thread.cwd !== 'string' || !path.isAbsolute(thread.cwd)) throw codexError('codex_invalid_response');
  return {
    provider: 'codex', sessionId: thread.id, cliSessionId: thread.id, priorCliSessionIds: [],
    title: (thread.name || thread.preview || '').slice(0, 300), cwd: thread.cwd,
    originCwd: null, worktreePath: null, branch: thread.gitInfo?.branch || null,
    lastActivityAt: Number.isFinite(thread.updatedAt) ? thread.updatedAt * 1000 : null,
    model: typeof thread.model === 'string' ? thread.model : null,
    effort: thread.reasoningEffort || null, ephemeral: !!thread.ephemeral,
    // A private app-server cannot establish liveness in every other client.
    running: thread.status?.type === 'active', runningKnown: thread.status?.type === 'active',
    source: typeof thread.source === 'string' ? thread.source : 'unknown',
  };
}

export class CodexHistory {
  constructor(cfg, { connect = withCodexProtocol } = {}) { this.cfg = cfg; this.connect = connect; }
  async use(fn) {
    const guard = codexImportAllowed(this.cfg);
    if (!guard.ok) throw codexError('import_blocked', { reason: guard.reason });
    return this.connect(fn, { ...(this.cfg.codexCommand ? { executable: this.cfg.codexCommand } : {}),
      ...(this.cfg.codexHome ? { env: { ...process.env, CODEX_HOME: this.cfg.codexHome }, cwd: this.cfg.codexHome } : {}) });
  }
  async list() {
    return this.use(async (rpc) => {
      const rows = await codexPages(rpc, 'thread/list', { limit: 100, archived: false, sortKey: 'updated_at', modelProviders: [], useStateDbOnly: true });
      return rows.filter((x) => !x.ephemeral).map(codexInfo);
    });
  }
  async read(id, { includeTurns = false } = {}) {
    if (!CODEX_ID.test(id)) throw codexError('bad_request');
    return this.use(async (rpc) => {
      const r = await rpc.request('thread/read', { threadId: id, includeTurns });
      codexInfo(r.thread);
      if (r.thread.id !== id) throw codexError('codex_invalid_response');
      return r.thread;
    });
  }
  async turns(id) {
    if (!CODEX_ID.test(id)) throw codexError('bad_request');
    return this.use(async (rpc) => {
      const { thread } = await rpc.request('thread/read', { threadId: id, includeTurns: false });
      codexInfo(thread);
      if (thread.id !== id) throw codexError('codex_invalid_response');
      if (thread.historyMode === 'paginated') return codexPages(rpc, 'thread/turns/list', { threadId: id, limit: 50, sortDirection: 'asc', itemsView: 'full' });
      const full = (await rpc.request('thread/read', { threadId: id, includeTurns: true })).thread;
      if (full?.id !== id || !Array.isArray(full.turns)) throw codexError('codex_invalid_response');
      return full.turns;
    });
  }
  // Only this method mutates Codex state, and only by creating a new fork.
  // Fork errors/timeouts are never retried: the server may have persisted it.
  async fork(id, { cwd, fallback = {}, excludeIds = [] } = {}) {
    if (!CODEX_ID.test(id)) throw codexError('bad_request');
    return this.use(async (rpc) => {
      const source = (await rpc.request('thread/read', { threadId: id, includeTurns: false })).thread;
      const info = codexInfo(source);
      if (source.id !== id || source.ephemeral) throw codexError('codex_invalid_source');
      if (info.running) throw codexError('source_running');
      const models = normalizeModels(await codexPages(rpc, 'model/list', { limit: 100, includeHidden: false }));
      // Use the same live catalog as Atrium's Codex picker, never Claude aliases.
      const model = [info.model, fallback.model, models.find((m) => m.isDefault)?.id, models[0]?.id].find((id) => models.some((m) => m.id === id));
      if (!model) throw codexError('codex_model_unavailable');
      let result;
      try { result = await rpc.request('thread/fork', { threadId: id, cwd, model, excludeTurns: true }); }
      catch (e) { throw codexError('codex_fork_uncertain', { causeCode: e.code }); }
      const copy = result.thread;
      if (!copy || !CODEX_ID.test(copy.id) || copy.id.toLowerCase() === id.toLowerCase() || excludeIds.some((x) => String(x).toLowerCase() === copy.id.toLowerCase()) || (copy.forkedFromId && copy.forkedFromId !== id)) throw codexError('codex_invalid_fork');
      return { id: copy.id, source: info, model: result.model || model, effort: result.reasoningEffort || null,
        replaced: info.model && info.model !== model ? ['model'] : [],
        summary: { lastPrompt: source.preview || null, lastActivityAt: info.lastActivityAt } };
    });
  }
}
