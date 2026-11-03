// Gemini hook stdout는 JSON만 허용한다. 엔진이 꺼져도 사용자의 작업을 막지 않는다.
import fs from 'node:fs';
let result = {};
try {
  const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  let input = '', bytes = 0;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 4 * 1024 * 1024) throw new Error('hook input too large');
    input += chunk;
  }
  const body = JSON.parse(input);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid hook payload');
  if (body.hook_event_name === 'SessionStart' || body.hook_event_name === 'BeforeAgent') {
    result = { hookSpecificOutput: { hookEventName: body.hook_event_name, additionalContext: cfg.context } };
  }
  const url = new URL(cfg.hookUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('nonlocal hook endpoint');
  await fetch(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}`, 'x-mt-session': cfg.sessionId }, body: JSON.stringify(body), signal: AbortSignal.timeout(2500) });
} catch { /* 알림 실패가 도구 실행·응답을 취소하지 않는다. */ }
process.stdout.write(JSON.stringify(result));
