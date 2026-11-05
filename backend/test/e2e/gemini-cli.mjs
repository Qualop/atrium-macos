// Optional native CLI contract test. Uses only a local fake model server and an
// isolated Gemini home. No real login, account requests or approval bypasses.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeGeminiSession } from '../../src/gemini.mjs';
const dir = fs.mkdtempSync('/tmp/atrium-gemini-contract-');
fs.mkdirSync(path.join(dir, '.gemini'));
if (process.env.ATRIUM_GEMINI_TRUST_FILE) fs.symlinkSync(process.env.ATRIUM_GEMINI_TRUST_FILE, path.join(dir, '.gemini/trustedFolders.json'));
const project = process.env.ATRIUM_GEMINI_TEST_PROJECT || dir;
fs.writeFileSync(path.join(dir, '.gemini/settings.json'), JSON.stringify({ telemetry: { enabled: false }, privacy: { usageStatisticsEnabled: false }, security: { auth: { selectedType: 'gemini-api-key' } } }));
const events = [], paths = [];
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  if (req.url === '/hooks/gemini') { events.push(JSON.parse(raw)); res.end('{}'); return; }
  paths.push(req.url);
  if (req.url.includes('countTokens')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ totalTokens: 10 })); return; }
  const message = { candidates: [{ content: { role: 'model', parts: [{ text: 'ATRIUM_GEMINI_CONTRACT_OK' }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } };
  if (req.url.includes('streamGenerateContent')) { res.setHeader('content-type', 'text/event-stream'); res.end(`data: ${JSON.stringify(message)}\n\n`); }
  else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(message)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const settings = writeGeminiSession({ dir, sessionId: crypto.randomUUID(), hookUrl: `${url}/hooks/gemini`, token: 'fixture', userHome: dir });
const fixtureKey = ['local', 'fixture', 'key'].join('-');
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GEMINI_|GOOGLE_|GCLOUD_|CLOUDSDK_|HERDR_|ATRIUM_)/.test(k))), ...settings.env, GEMINI_API_KEY: fixtureKey, GOOGLE_GEMINI_BASE_URL: url };
const child = spawn('gemini', ['--model', 'gemini-2.5-flash', '--prompt', 'Reply with ATRIUM_GEMINI_CONTRACT_OK'], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', (c) => stdout += c); child.stderr.on('data', (c) => stderr += c);
const timeout = setTimeout(() => child.kill('SIGTERM'), 60000);
try {
  const code = await new Promise((r, j) => { child.on('error', j); child.on('exit', r); });
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ code, stdout, stderr, paths, events }, null, 2));
  if (code === 55 && /not running in a trusted directory/.test(stderr)) {
    assert.equal(paths.length, 0);
    console.log(`PASS native Gemini CLI refuses untrusted workspace before any model request (${dir})`);
    console.log('SKIP native turn/hook validation: workspace requires manual trust');
  } else {
  assert.equal(code, 0, stderr);
  assert.match(stdout, /ATRIUM_GEMINI_CONTRACT_OK/);
  for (const event of ['SessionStart', 'BeforeAgent', 'AfterAgent']) assert.ok(events.some((e) => e.hook_event_name === event), `missing ${event}: ${stderr}`);
  assert.match(events.find((e) => e.hook_event_name === 'AfterAgent').prompt_response, /ATRIUM_GEMINI_CONTRACT_OK/);
  assert.ok(events.some((e) => e.transcript_path));
  const nativeId = events.find((e) => e.hook_event_name === 'SessionStart').session_id;
  const resumed = spawn('gemini', ['--resume', nativeId, '--model', 'gemini-2.5-flash', '--prompt', 'Continue the fixture'], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let resumedOut = '', resumedErr = ''; resumed.stdout.on('data', (c) => resumedOut += c); resumed.stderr.on('data', (c) => resumedErr += c);
  const resumeTimer = setTimeout(() => resumed.kill('SIGTERM'), 30000);
  try {
    assert.equal(await new Promise((r, j) => { resumed.on('exit', r); resumed.on('error', j); }), 0, resumedErr);
    assert.match(resumedOut, /ATRIUM_GEMINI_CONTRACT_OK/);
    assert.equal(events.filter((e) => e.hook_event_name === 'SessionStart').at(-1).session_id, nativeId);
  } finally { clearTimeout(resumeTimer); resumed.kill('SIGTERM'); }
  console.log(`PASS native Gemini CLI: session profile, shared storage, hooks, final response, exact-ID resume (${dir})`);
  }
} finally { clearTimeout(timeout); child.kill('SIGTERM'); server.closeAllConnections(); server.close(); }
