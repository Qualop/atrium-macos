// P114 실시험용 가짜 에이전트: 모델을 부르지 않고 OSC 7501로 상태를 알린다(app=p114-fake).
// 줄을 받으면 working → 'got <줄>' → done. 'block'을 받으면 blocked(kind=permission). 막힌 동안 '1'이나 'y'를 받으면 done. 'quit'이면 상태를 지우고 끝난다
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const report = (fields) => process.stdout.write(`\x1b]7501;${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(':')}\x1b\\`);
let blocked = false;
report({ state: 'idle', app: 'p114-fake' });
process.stdout.write('fake agent ready\r\n> ');
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.search(/\r|\n/)) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    // 판의 키 패드는 숫자만 친다(keys.mjs)
    if (blocked) { if (line === 'y' || line === '1') { blocked = false; report({ state: 'done', app: 'p114-fake' }); process.stdout.write('approved\r\n> '); } continue; }
    if (line === 'quit') { report({ state: 'clear' }); process.exit(0); }
    report({ state: 'working', app: 'p114-fake' });
    if (line === 'block') { blocked = true; report({ state: 'blocked', app: 'p114-fake', kind: 'permission', msg: b64('approve fake: rm nothing') }); process.stdout.write('Do you want to proceed? (y)\r\n'); continue; }
    setTimeout(() => { process.stdout.write(`got ${line}\r\n> `); report({ state: 'done', app: 'p114-fake' }); }, 150);
  }
});
