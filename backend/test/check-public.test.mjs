// 공개 저장소 검사(scripts/check-public.mjs)의 규칙. 가짜 개인 값과 가짜 토큰은 실행할 때 만든다(이 파일이 검사에 걸리지 않게).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText, localSecrets, blockedPath, committerOk, authorOk } from '../../scripts/check-public.mjs';

const user = 'zq' + 'kimtest';
const home = ['C:', 'Users', user].join('\\');
const mail = `${user}@example.org`;
const sec = localSecrets({ home, user, emails: [mail], extra: '' });
const found = (text, s = sec) => scanText(text, s);

test('이 컴퓨터의 사용자 이름, 홈 폴더(두 방향 슬래시), 개인 메일을 잡고 값은 가린다', () => {
  for (const text of [`at ${home}\\AppData\\Local`, `at ${home.split('\\').join('/')}/x`, `cd /c/Users/${user}/x`, `owner ${user} 197609`, `mail ${mail}`, `json "${home.split('\\').join('\\\\')}"`]) {
    const f = found(text);
    assert.equal(f.length, 1, text);
    assert.ok(!f[0].text.includes(user), `가리지 않음: ${f[0].text}`);
  }
  assert.equal(found(`line1\nline2 ${mail}`)[0].line, 2);
});

test('자리표시와 남의 이름이 아닌 것은 지나간다', () => {
  for (const text of ['%USERPROFILE%\\.herdr', 'C:\\Users\\u\\AppData', 'C:/Users/x/a', 'C:\\Users\\<user>\\x', 'C:\\Users\\Public\\x', '\\\\.\\pipe\\C:\\Users\\...\\herdr.sock',`${user}x is another word`, 'xx' + user]) {
    assert.deepEqual(found(text), [], text);
  }
});

test('남의 홈 경로도 잡는다(세 글자 이상 이름)', () => {
  const other = ['D:', 'Users', 'someone', 'x'].join('\\');
  assert.equal(found(`p = '${other}'`)[0].kind, '사용자 홈 경로');
  assert.equal(found(`cd /c/Users/${'some'}one/x`)[0].kind, '사용자 홈 경로');
});

test('토큰과 개인 키', () => {
  const cases = [
    'sk-ant-' + 'a1'.repeat(15),
    'sk-' + 'A'.repeat(40),
    'gh' + 'p_' + 'B'.repeat(36),
    'github' + '_pat_' + 'C'.repeat(45),
    'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
    'xo' + 'xb-' + '1234567890-abc',
    '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----',
    'OPENAI_' + 'API_KEY=' + 'x'.repeat(24),
  ];
  for (const c of cases) assert.equal(found(`v = ${c}`).length, 1, c);
  for (const ok of ["const TOKEN = 'abc'", 'apiToken: info.token', 'sha 9c24478f-cdf8-4f41-be63-1bbffb78397f']) assert.deepEqual(found(ok), [], ok);
});

test('흔한 사용자 이름(user 등)은 낱말로 막지 않고, 홈 경로로만 잡는다', () => {
  const s = localSecrets({ home: ['C:', 'Users', 'user'].join('\\'), user: 'user', emails: [], extra: '' });
  assert.deepEqual(scanText('the user clicks', s), []);
  assert.equal(scanText(`at ${['C:', 'Users', 'user', 'x'].join('\\')}`, s).length, 1);
});

test('공개하지 않는 경로', () => {
  for (const p of ['experiments/p1/a.png', 'app/design/brand/a.svg', '.claude/launch.json', 'backend/.dev/data/board.db', '.env', 'app/.env.local', 'backend/node_modules/ws/index.js', 'x/backend.json']) assert.ok(blockedPath(p), p);
  for (const p of ['docs/research/x.md', 'docs/log/p1-backend.md', 'docs/experiments/E1.md', 'app/src/main/main.mjs', '.claude/settings.json', 'README.ko.md', 'backend/test/fixtures/x.json']) assert.equal(blockedPath(p), null, p);
});

test('커미터는 noreply만, 작성자는 개인 메일만 막는다', () => {
  assert.ok(committerOk('255312450+Gudals0320@users.noreply.github.com'));
  assert.ok(committerOk('noreply@github.com'));
  assert.ok(!committerOk(mail));
  assert.ok(!committerOk(''));
  assert.ok(authorOk('78092504+Qualop@users.noreply.github.com', sec));
  assert.ok(authorOk('someone@example.com', sec));
  assert.ok(!authorOk(mail, sec));
});
