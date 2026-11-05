// Parent integration: use codexResumeArgs for native resume, never --resume or
// --last. Route sleepy Codex sessions to wakeCodexSession before Claude's wake.
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { CODEX_ID, codexError } from './codex-protocol.mjs';
import { CodexHistory } from './codex-import.mjs';
import { withCodexModel } from './codex-args.mjs';

export function codexRecovery(row) {
  const rt = row?.rt || row?.runtime || {};
  if (row?.kind !== 'codex' || (row.origin || 'board') !== 'board' || !(rt.codexManaged || rt.codexIntegration) || !CODEX_ID.test(rt.codexSessionId || '')) return null;
  if (rt.codexImportedFrom && String(rt.codexImportedFrom).toLowerCase() === rt.codexSessionId.toLowerCase()) return null;
  return { resume: true, id: rt.codexSessionId, file: null };
}

// Call only with the native UUID observed on THIS managed herdr agent. Never
// infer identity from cwd, timestamps, session lists, or a "latest" selector.
export function recordCodexSessionId(row, nativeId) {
  const rt = row?.rt || row?.runtime;
  if (row?.kind !== 'codex' || (row.origin || 'board') !== 'board' || !rt?.codexIntegration || !CODEX_ID.test(nativeId || '')) return false;
  if (rt.codexImportedFrom?.toLowerCase() === nativeId.toLowerCase() || (rt.codexSessionId && rt.codexSessionId.toLowerCase() !== nativeId.toLowerCase())) return false;
  rt.codexSessionId = nativeId; rt.codexManaged = true;
  return true;
}

export function codexResumeArgs({ threadId, model, args = [] }) {
  if (!CODEX_ID.test(threadId || '')) throw codexError('not_resumable');
  const base = withCodexModel(args, model);
  if (base[0] === 'resume') {
    if (base[1] !== threadId) throw codexError('codex_resume_target_mismatch');
    base.splice(0, 2);
  }
  // No implicit selection or alternate app-server attachment on recovery.
  if (base.some((a) => /^(?:--(?:last|all|resume|remote|remote-auth-token-env|session-id)(?:=|$)|(?:resume|fork|exec|queue|archive|delete)$)/.test(a))) throw codexError('codex_resume_target_mismatch');
  return ['resume', threadId, ...base];
}

// Scoped process env + optional USER context for a newly requested task. Codex
// has no documented append-developer-instructions CLI flag. Do not set
// developer_instructions/base_instructions or replace AGENTS.md/config.toml.
export function codexCollaboration(b, sessionId, { env = {}, prompt } = {}) {
  const scoped = b.branch?.envFor(sessionId) || {};
  const out = { ...env, ...scoped };
  const branchFile = b.cfg.sessionsDir ? path.join(b.cfg.sessionsDir, `${sessionId}.codex-branch.json`) : null;
  if (branchFile) { delete out.ATRIUM_SESSION_TOKEN; out.ATRIUM_BRANCH_FILE = branchFile; }
  if (b.cfg.codexHome) out.CODEX_HOME = b.cfg.codexHome;
  if (b.plugin?.pluginDir) out.PATH = [path.join(b.plugin.pluginDir, 'bin'), env.PATH ?? process.env.PATH ?? ''].join(path.delimiter);
  const context = [
    'This session runs on an Atrium board. Follow the existing user and developer instructions.',
    'When asked to delegate board work, use `atrium models` to inspect the current model catalog, then `atrium child <name> --kind codex --model <catalog-id>` (or the requested provider).',
    'Use the scoped ATRIUM_* environment to address this board; do not print tokens or change global settings.',
    'herdr already targets this board. Do not pass --session, --machine, or --remote. Wake sleeping board peers with `atrium wake <name>` before contacting them.',
    ...(branchFile ? [`The scoped branch credential file is ${JSON.stringify(branchFile)}. If shell environment filtering removes ATRIUM_BRANCH_FILE, set it to this path for the atrium command. Do not display the file.`] : []),
  ].join('\n');
  return { env: out, context, branchFile, ...(typeof prompt === 'string' && prompt ? { prompt: `${context}\n\n${prompt}` } : {}) };
}

// Parent spawn contract. Prefix runtime.codexContext to the first board prompt
// through the existing prompt queue. Never submit context or p.prompt via argv.
// runtime and hookToken are PRIVATE. Never broadcast/log their values.
export function prepareCodexSession(b, { sessionId, id = sessionId, args = [], model, env = {}, hookToken = crypto.randomBytes(24).toString('hex'), threadId = null } = {}) {
  if (!CODEX_ID.test(id || '')) throw codexError('bad_request');
  const scoped = codexCollaboration(b, id, { env: env || {} });
  const base = threadId ? codexResumeArgs({ threadId, args, model }) : withCodexModel(args, model);
  // Reuse atrium-child's private-file credential bridge. No token in argv and
  // no overrides to the user's Codex shell filtering or developer instructions.
  if (scoped.branchFile) {
    fs.mkdirSync(path.dirname(scoped.branchFile), { recursive: true, mode: 0o700 });
    const tmp = `${scoped.branchFile}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(b.branch?.envFor(id) || {}), { flag: 'wx', mode: 0o600 });
      fs.renameSync(tmp, scoped.branchFile);
    } finally { fs.rmSync(tmp, { force: true }); }
  }
  return { args: base, env: scoped.env, hookToken, settingsPath: scoped.branchFile || '',
    context: scoped.context,
    runtime: { codexIntegration: true, codexManaged: !!threadId, codexContext: scoped.context, codexBriefed: false, ...(threadId ? { codexSessionId: threadId } : {}), launcherEnv: { ...env }, extraArgs: withCodexModel(args, undefined) } };
}

export async function verifyCodexResume(b, row) {
  const recovery = codexRecovery(row);
  if (!recovery) throw codexError('not_resumable');
  const history = b.desktopImport?.codex || new CodexHistory(b.cfg);
  const thread = await history.read(recovery.id);
  if (thread.id !== recovery.id || thread.ephemeral) throw codexError('not_resumable');
  if (thread.status?.type === 'active') throw codexError('codex_thread_active');
  return recovery;
}

const waking = new WeakMap();
export function wakeCodexSession(b, s, { why = 'user' } = {}) {
  if (waking.has(s)) return waking.get(s);
  const job = wake(b, s, why).finally(() => waking.delete(s));
  waking.set(s, job);
  return job;
}
async function wake(b, s, why) {
  if (!s.rt.sleep || !b.sessions.has(s.sessionId)) return { awake: true, name: s.name };
  if (s.kind !== 'codex') throw codexError('bad_request');
  const prev = structuredClone(s.rt), sleep = prev.sleep;
  let created = null;
  s.waking = { at: Date.now(), why };
  try {
    b.requireHerdr();
    if (!s.cwd || !fs.statSync(s.cwd).isDirectory()) throw codexError('no_folder');
    const recovery = await verifyCodexResume(b, s);
    if (b.sessions.get(s.sessionId) !== s || !s.rt.sleep) throw codexError('closed');
    const { args, env, settingsPath } = prepareCodexSession(b, { sessionId: s.sessionId, threadId: recovery.id, model: s.model, args: s.rt.extraArgs || [], hookToken: s.hookToken, env: s.rt.launcherEnv ?? b.store.spawnInfo(s.sessionId)?.env ?? {} });
    s.settingsPath = settingsPath;
    await b.withNewPane(() => b.adapter.createWorkspace({ cwd: s.cwd, label: s.name, env }), (r) => {
      created = r;
      if (b.sessions.get(s.sessionId) !== s) throw codexError('closed');
      s.paneId = r.paneId; s.herdrWorkspaceId = r.workspaceId;
      Object.assign(s.rt, { sleep: null, exit: null, phase: 'starting', launchedAt: Date.now(), sessionEnd: null, pendingAsk: null, lastError: null,
        herdr: { status: null, launchPending: true, agentSessionId: null, present: false, at: Date.now() } });
      b.store.updateSession(s.sessionId, { paneId: r.paneId, herdrWorkspaceId: r.workspaceId, settingsPath, runtime: s.rt });
    });
    await b.adapter.refreshSubscription();
    if (await b.adapter.waitShellReady(s.paneId, 8000) === false) throw codexError('shell_not_ready');
    if (b.sessions.get(s.sessionId) !== s || s.paneId !== created.paneId || b.killing.has(s.sessionId)) throw codexError('closed');
    const started = await b.adapter.startAgent({ name: s.agentName || s.name, paneId: s.paneId, args, kind: 'codex' });
    s.rt.herdr.launchPending = started.agent?.launchPending ?? true;
    b.store.saveRuntime(s.sessionId, s.rt);
    b.store.addEvent(s.sessionId, 'woke', { why, provider: 'codex', convId: recovery.id, paneId: s.paneId });
    return { woke: true, name: s.name, convId: recovery.id, paneId: s.paneId, state: 'starting' };
  } catch (e) {
    let retained = false;
    if (created) {
      b.killing.add(s.sessionId);
      try { await b.adapter.closePane(created.paneId); }
      catch { retained = true; e.recoveryPaneRetained = true; }
      finally { b.killing.delete(s.sessionId); }
    }
    if (b.sessions.get(s.sessionId) === s) {
      if (retained) { s.rt.sleep = null; s.rt.lastError = { code: 'codex_wake_cleanup_failed', at: Date.now() }; }
      else { s.paneId = null; s.herdrWorkspaceId = null; s.rt = { ...prev, sleep: { ...sleep, error: { code: e.code || 'codex_wake_failed', at: Date.now() } } }; }
      b.store.updateSession(s.sessionId, { paneId: s.paneId, herdrWorkspaceId: s.herdrWorkspaceId, runtime: s.rt });
    }
    b.queue?.cancelSession(s.sessionId, 'Codex wake failed');
    throw e;
  } finally { s.waking = null; if (b.sessions.get(s.sessionId) === s) b.broadcastSession(s, { cause: `wake:${why}` }); }
}
