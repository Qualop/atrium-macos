import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { Backend } from '../src/backend.mjs';
import { Store } from '../src/store.mjs';
import { Branch } from '../src/branch.mjs';
import { newRuntime, deriveState, applyHerdrStatus } from '../src/state.mjs';
import { normalizeGeminiHook, writeGeminiSession, GEMINI_EVENTS, geminiAuthIssue } from '../src/gemini.mjs';
import { Outputs } from '../src/outputs.mjs';
import { decideTarget, goalReached } from '../src/loops.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-gemini-'));
  const b = new Backend({ logDir: dir, herdrSession: 'atrium-dev-gemini', adoptSpawnMatchMs: 60000 });
  b.store = new Store(path.join(dir, 'board.db')); b.api = { broadcast() {} }; b.log = () => {};
  b.apiToken = 'fixture-board'; b.probeGit = () => {};
  b.queue = { enqueue: (id, text) => ({ deliveryId: 'test', sessionId: id, text }), onUserPromptSubmit() {}, onAgentWorking() {} };
  b.broadcastSession = (s) => { const next = deriveState(s.rt); b.onLinkTargetState(s, s.lastState, next); s.lastState = next.state; };
  for (const kind of ['claude', 'codex', 'gemini', 'agy']) {
    const s = { sessionId: kind, kind, name: kind, agentName: kind, paneId: `${kind}:p1`, cwd: dir, origin: 'board', hookToken: `token-${kind}`, rt: newRuntime({ kind, hooked: kind === 'claude' }) };
    s.rt.herdr = { status: 'idle', present: true }; s.rt.phase = 'running';
    if (kind === 'gemini') Object.assign(s.rt, { geminiIntegration: true, geminiReady: true });
    b.sessions.set(kind, s);
  }
  t.after(() => { b.store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const hook = (kind, body) => b.processHook({ 'x-mt-session': kind, authorization: `Bearer token-${kind}` }, JSON.stringify(body), ['gemini', 'agy'].includes(kind) ? kind : 'claude');
  return { b, dir, hook };
}

test('Gemini hooks preserve prompts/results but never enter Claude transcript handling', () => {
  const out = normalizeGeminiHook({ hook_event_name: 'AfterAgent', prompt_response: '리뷰 완료', session_id: 'native', transcript_path: '/native.json' });
  assert.equal(out.hook_event_name, 'Stop'); assert.equal(out.last_assistant_message, '리뷰 완료');
  assert.equal(out.session_id, undefined); assert.equal(out.transcript_path, undefined);
  assert.equal(normalizeGeminiHook({ hook_event_name: 'BeforeAgent', prompt: null }), null);
  assert.equal(normalizeGeminiHook({ hook_event_name: 'unknown' }), null);
  assert.equal(normalizeGeminiHook({ hook_event_name: 'AfterTool', tool_name: 'run_shell_command', tool_response: { error: 'denied' } }).hook_event_name, 'PostToolUseFailure');
});

test('Claude → Gemini reviewer records submission, work, result and output history', (t) => {
  const { b, hook } = fixture(t), gemini = b.sessions.get('gemini');
  b.linkCreate({ from: 'claude', to: 'gemini', role: '리뷰어' });
  hook('claude', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'c1', tool_input: { command: 'herdr agent prompt gemini "review addition" --wait' } });
  hook('gemini', { hook_event_name: 'BeforeAgent', prompt: 'review addition', session_id: 'native-g', transcript_path: '/tmp/native-g.json' });
  assert.equal(deriveState(gemini.rt).state, 'working');
  hook('gemini', { hook_event_name: 'AfterAgent', prompt_response: 'BUG: addition returns subtraction' });
  const link = b.store.linkByPair('claude', 'gemini');
  const events = b.store.linkEvents(link.linkId, 50);
  for (const kind of ['role', 'prompt', 'target_submitted', 'target_working', 'target_done']) assert.ok(events.some((e) => e.kind === kind), kind);
  assert.match(events.find((e) => e.kind === 'target_done').text, /subtraction/);
  assert.equal(gemini.rt.claudeSessionId, null); assert.equal(gemini.rt.geminiSessionId, 'native-g');
  const outputs = new Outputs({ store: b.store, hooked: () => false });
  assert.equal(outputs.turnsOf(gemini).source, 'hook');
  assert.equal(outputs.turnsOf(gemini).turns[0].answer, 'BUG: addition returns subtraction');
  assert.equal(goalReached({ stop: { untilText: 'subtraction' }, lastRunAt: 1 }, gemini.rt), true);
});

test('Gemini → Codex delegation and reading a reply reuse the existing link protocol', (t) => {
  const { b, hook } = fixture(t);
  b.linkCreate({ from: 'gemini', to: 'codex', role: 'reviewer' });
  const tool = { tool_name: 'run_shell_command', tool_input: { command: 'herdr agent prompt codex "review patch" --wait' }, tool_use_id: 'g1' };
  hook('gemini', { ...tool, hook_event_name: 'BeforeTool' });
  const codex = b.sessions.get('codex');
  applyHerdrStatus(codex.rt, 'working'); b.broadcastSession(codex);
  codex.rt.lastAnswer = 'review complete'; applyHerdrStatus(codex.rt, 'idle'); b.broadcastSession(codex);
  hook('gemini', { ...tool, hook_event_name: 'AfterTool', tool_response: { llmContent: '{"result":{"type":"agent_prompted","agent":{"agent_status":"idle"}}}' } });
  hook('gemini', { hook_event_name: 'AfterTool', tool_name: 'run_shell_command', tool_input: { command: 'herdr agent read codex' }, tool_response: { llmContent: 'review complete' } });
  const events = b.store.linkEvents(b.store.linkByPair('gemini', 'codex').linkId, 50);
  assert.ok(events.some((e) => e.kind === 'target_done'));
  assert.ok(events.some((e) => e.kind === 'prompt_result' && e.data.ok));
  assert.equal(events.find((e) => e.kind === 'reply').text, 'review complete');
});

test('Untrusted hooks cannot change runtime; blocked Gemini never triggers an idle loop', (t) => {
  const { b } = fixture(t), s = b.sessions.get('gemini');
  b.processHook({ 'x-mt-session': 'gemini', authorization: 'Bearer wrong' }, JSON.stringify({ hook_event_name: 'AfterAgent', prompt_response: 'fake' }), 'gemini');
  assert.equal(s.rt.lastAnswer, null);
  s.rt.geminiReady = false; assert.equal(deriveState(s.rt).state, 'starting');
  s.rt.herdr.status = 'blocked'; assert.equal(deriveState(s.rt).state, 'waiting');
  assert.notEqual(decideTarget({ trigger: { type: 'idle' } }, {}, { kind: 'gemini', state: 'waiting' }, Date.now()).action, 'fire');
});

test('Gemini branch access requires a board session token and managed origin', (t) => {
  const { b } = fixture(t); const branch = new Branch(b);
  const headers = { 'x-mt-session': 'gemini', authorization: `Bearer ${branch.token('gemini')}` };
  assert.equal(branch.auth(headers, 'child').s.kind, 'gemini');
  assert.equal(branch.auth({ ...headers, authorization: 'Bearer wrong' }, 'child').status, 401);
  b.sessions.get('gemini').origin = 'adopted'; assert.equal(branch.auth(headers, 'child').status, 403);
});

test('Per-session config preserves defaults; bridge sends authenticated JSON and adds collaboration context', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-gemini-bridge-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.gemini'));
  const defaults = path.join(dir, '.gemini/settings.json'); fs.writeFileSync(defaults, JSON.stringify({ model: { name: 'custom' }, hooks: { BeforeAgent: [{ matcher: '*', hooks: [] }] } }));
  let received;
  const server = http.createServer(async (req, res) => { let body = ''; for await (const c of req) body += c; received = { headers: req.headers, body: JSON.parse(body) }; res.end('{}'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const cfg = writeGeminiSession({ dir, sessionId: 'fixture', hookUrl: `http://127.0.0.1:${server.address().port}/hooks/gemini`, token: 'secret-fixture', branchEnv: { ATRIUM_SESSION_ID: 'fixture' }, userHome: dir, executable: '/tmp/gemini' });
  const settings = JSON.parse(fs.readFileSync(cfg.settingsPath));
  assert.equal(settings.model.name, 'custom'); assert.equal(settings.hooks.BeforeAgent.length, 2);
  for (const ev of GEMINI_EVENTS) assert.ok(settings.hooks[ev].length);
  assert.equal(settings.security, undefined); assert.equal(settings.tools, undefined);
  assert.equal(cfg.env.ATRIUM_SESSION_ID, 'fixture'); assert.equal(cfg.env.HOME, undefined);
  assert.equal(JSON.parse(fs.readFileSync(defaults)).hooks.BeforeAgent.length, 1);
  assert.ok(fs.lstatSync(path.join(cfg.env.GEMINI_CLI_HOME, '.gemini/oauth_creds.json')).isSymbolicLink());
  if (process.platform !== 'win32') assert.equal(fs.statSync(cfg.settingsPath).mode & 0o777, 0o600); // Windows uses ACLs, not POSIX mode bits
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/gemini-hook.mjs', import.meta.url)), path.join(dir, 'fixture.gemini-bridge.json')], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; child.stdout.on('data', (c) => stdout += c);
  child.stdin.end(JSON.stringify({ hook_event_name: 'BeforeAgent', prompt: '검토해' }));
  assert.equal(await new Promise((r) => child.on('exit', r)), 0);
  assert.match(JSON.parse(stdout).hookSpecificOutput.additionalContext, /herdr agent prompt/);
  assert.equal(received.headers.authorization, 'Bearer secret-fixture'); assert.equal(received.body.prompt, '검토해');
});

test('Google personal-account refusal explains the supported client instead of retrying login', () => {
  assert.match(geminiAuthIssue('This client is no longer supported for Gemini Code Assist for individuals.'), /Antigravity/);
  assert.equal(geminiAuthIssue('Authentication succeeded'), null);
});

test('Claude → Antigravity reviewer records work and terminal result without inventing hook text', async (t) => {
  const { b, hook } = fixture(t);
  b.adapter = { readScreen: async () => 'REVIEW_RESULT: fix the off-by-one' };
  b.linkCreate({ from: 'claude', to: 'agy', role: 'reviewer' });
  hook('claude', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'a1', tool_input: { command: 'herdr agent prompt agy "review patch" --wait' } });
  hook('agy', { atriumEvent: 'PreInvocation', conversationId: 'native-agy' });
  assert.equal(deriveState(b.sessions.get('agy').rt).state, 'working');
  hook('agy', { atriumEvent: 'Stop', fullyIdle: true, conversationId: 'native-agy' });
  await new Promise((r) => setImmediate(r));
  const events = b.store.linkEvents(b.store.linkByPair('claude', 'agy').linkId, 30);
  assert.ok(events.some((e) => e.kind === 'target_working'));
  assert.match(events.find((e) => e.kind === 'target_done').text, /off-by-one/);
  assert.equal(b.sessions.get('agy').rt.claudeSessionId, null);
});

test('Antigravity can delegate to Codex through observed run_command hooks', (t) => {
  const { b, hook } = fixture(t);
  hook('agy', { atriumEvent: 'PreToolUse', conversationId: 'native', stepIdx: 2, toolCall: { name: 'run_command', args: { CommandLine: 'herdr agent prompt codex "review" --wait' } } });
  const link = b.store.linkByPair('agy', 'codex');
  assert.equal(b.store.linkEvents(link.linkId, 20).find((e) => e.kind === 'prompt').text, 'review');
});

test('The last send preflight prevents Enter on Antigravity consent screens', async (t) => {
  const { b } = fixture(t); let sent = 0;
  b.adapter = { readScreen: async () => '[Previous] [Done]\n↑/↓ Navigate · enter Toggle\nGemini', prompt: async () => sent++ };
  await assert.rejects(b.promptManaged('agy', 'do not type this into consent'), { code: 'agent_blocked' });
  assert.equal(sent, 0); assert.equal(deriveState(b.sessions.get('agy').rt).state, 'waiting');
  b.adapter.readScreen = async () => '> \n──────── ? for shortcuts\nGemini';
  await b.promptManaged('agy', 'normal request'); assert.equal(sent, 1);
});
