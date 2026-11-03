import fs from 'node:fs';
const event = process.argv[2];
let result = event === 'PreToolUse' ? { decision: 'allow' } : {};
if (!process.env.ATRIUM_AGY_BRIDGE) { process.stdout.write(JSON.stringify(result)); process.exit(0); }
try {
  const cfg = JSON.parse(fs.readFileSync(process.env.ATRIUM_AGY_BRIDGE, 'utf8'));
  let input = '', bytes = 0; process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) { bytes += Buffer.byteLength(c); if (bytes > 4 * 1024 * 1024) throw new Error('too large'); input += c; }
  const body = { ...JSON.parse(input), atriumEvent: event };
  if (event === 'SessionStart') result = { injectSteps: [{ ephemeralMessage: cfg.context }] };
  if (event === 'PreToolUse') result = { decision: 'allow' }; // leaves normal permission policy in force
  const url = new URL(cfg.hookUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('nonlocal');
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}`, 'x-mt-session': cfg.sessionId }, body: JSON.stringify(body), signal: AbortSignal.timeout(2500) });
} catch { /* hook bridge is observational and must not break the CLI */ }
process.stdout.write(JSON.stringify(result));
