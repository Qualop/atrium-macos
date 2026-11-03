import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

async function runHook(script, args, input, env) {
  const child = spawn(process.execPath, [new URL(`../scripts/${script}-hook.mjs`, import.meta.url).pathname, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => stdout += chunk); child.stderr.on('data', (chunk) => stderr += chunk);
  child.stdin.on('error', () => {}); child.stdin.end(input);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 0, stderr); assert.equal(stderr, '');
  return JSON.parse(stdout);
}

for (const provider of ['gemini', 'agy']) test(`${provider} bridge refuses redirected posts and non-object payloads without blocking the CLI`, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-hook-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, body: JSON.parse(body) });
    if (req.url === '/hook') { res.writeHead(307, { location: '/unexpected' }); res.end(); }
    else res.end('{}');
  });
  await new Promise((resolve, reject) => { server.on('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const bridge = path.join(dir, 'bridge.json');
  fs.writeFileSync(bridge, JSON.stringify({ sessionId: 'fixture', token: 'fixture-token', context: 'fixture context', hookUrl: `http://127.0.0.1:${server.address().port}/hook` }));
  const env = { PATH: process.env.PATH, ATRIUM_AGY_BRIDGE: bridge };
  const args = provider === 'gemini' ? [bridge] : ['SessionStart'];
  const out = await runHook(provider, args, JSON.stringify({ hook_event_name: 'SessionStart' }), env);
  assert.deepEqual(requests.map((row) => row.path), ['/hook']);
  assert.ok(provider === 'gemini' ? out.hookSpecificOutput : out.injectSteps);
  for (const input of ['null', '[]', '"text"', '{broken']) {
    await runHook(provider, args, input, env);
    assert.equal(requests.length, 1);
  }
});
