// P74 휴대폰 화면과 홈 화면 웹 앱: 좁은 화면 판단, 목록 순서, 키 바이트, 보내기, 서비스 워커가 캐시하지 않는 주소, 매니페스트 값
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPhoneLayout, PHONE_MAX_WIDTH, phoneList, toneOf, lastLineOf, KEY_ROW, keyBytes, touchWheelDelta, viewportBox, sendPlan, nextNeed } from '../src/renderer/lib/phone.js';
import { swRoute, cacheableResponse, shellList, cacheName, staleCaches, CACHE_PREFIX } from '../src/renderer/lib/sw-rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PWA = path.join(ROOT, 'src', 'renderer', 'assets', 'pwa');

test('좁은 화면 판단: 폭 430px 이하·세로·터치일 때만 휴대폰 화면, 보드 화면을 고르면 끈다', () => {
  assert.equal(PHONE_MAX_WIDTH, 430);
  assert.equal(isPhoneLayout({ width: 390, height: 844, coarse: true }), true, 'iPhone 세로');
  assert.equal(isPhoneLayout({ width: 430, height: 932, coarse: true }), true, '큰 iPhone 세로(경계)');
  assert.equal(isPhoneLayout({ width: 844, height: 390, coarse: true }), false, '가로로 돌림');
  assert.equal(isPhoneLayout({ width: 431, height: 900, coarse: true }), false, '넓으면 보드');
  assert.equal(isPhoneLayout({ width: 820, height: 1180, coarse: true }), false, '태블릿');
  assert.equal(isPhoneLayout({ width: 390, height: 844, coarse: false }), false, '마우스 창을 좁힌 것은 보드');
  assert.equal(isPhoneLayout({ width: 390, height: 844, coarse: true, pref: 'board' }), false, '보드 화면을 골랐다');
  assert.equal(isPhoneLayout({ width: 0, height: 0, coarse: true }), false);
  assert.equal(isPhoneLayout(), false);
});

const S = (id, f = {}) => ({ sessionId: id, name: id, state: 'ready', workspaceKey: 'C:/w/a/.git', createdAt: 1, lastActivityAt: 1, ...f });
test('목록 순서: 응답 필요(오래 기다린 순) → 작업 중(P90: 시작 순) → 나머지(프로젝트별, 보드 순서, 살아 있는 것 먼저)', () => {
  const ws = [{ key: 'C:/w/b/.git', name: 'b' }, { key: 'C:/w/a/.git', name: 'a' }];
  const list = phoneList([
    S('r1', { lastActivityAt: 50 }),
    S('w1', { state: 'working', lastActivityAt: 10 }),
    S('q2', { state: 'waiting', ask: { kind: 'permission', since: 300 } }),
    S('x1', { state: 'exited', lastActivityAt: 900 }),
    S('q1', { state: 'waiting', ask: { kind: 'question', since: 100 } }),
    S('t1', { state: 'trust_wait', createdAt: 200, lastActivityAt: 200 }),
    S('w2', { state: 'starting', lastActivityAt: 40 }),
    S('b1', { workspaceKey: 'C:/w/b/.git', lastActivityAt: 5 }),
    S('sh', { kind: 'shell', shell: { atPrompt: false, command: 'npm test' }, lastActivityAt: 30 }),
    S('n1', { workspaceKey: null, lastActivityAt: 70 }),
    S('r2', { lastActivityAt: 60, state: 'sleeping' }),
    S('r3', { lastActivityAt: 80 }),
  ], ws);
  assert.deepEqual(list.needs.map((s) => s.sessionId), ['q1', 't1', 'q2']);
  assert.deepEqual(list.working.map((s) => s.sessionId), ['sh', 'w1', 'w2'], '명령이 도는 셸도 작업 중(P90: 시작 시각이 같으면 이름 순)');
  assert.deepEqual(list.groups.map((g) => g.key), ['C:/w/b/.git', 'C:/w/a/.git', null], '보드의 프로젝트 순서, 프로젝트 없음은 끝');
  assert.deepEqual(list.groups[1].sessions.map((s) => s.sessionId), ['r1', 'r3', 'r2', 'x1'], '살아 있는 것 다음 끝났거나 잠든 것(P90: 시작 시각이 같으면 이름 순)');
  assert.equal(list.groups[1].name, 'a');
  assert.equal(list.groups[1].total, 10, '접힌 이름표의 수는 위로 올라간 세션도 센다');
  assert.deepEqual(phoneList([], ws), { needs: [], working: [], groups: [] });
});

test('상태 점과 마지막 한 줄', () => {
  assert.equal(toneOf(S('a', { state: 'trust_wait' })), 'waiting');
  assert.equal(toneOf(S('a', { unseen: true })), 'review');
  assert.equal(toneOf(S('a', { kind: 'shell', shell: { atPrompt: false } })), 'shell_running');
  assert.equal(toneOf(S('a', { kind: 'shell', shell: { atPrompt: true } })), 'ready');
  assert.equal(toneOf(S('a', { waking: true, state: 'sleeping' })), 'starting');
  assert.equal(toneOf(S('a', { state: 'weird' })), 'starting');
  assert.deepEqual(lastLineOf(S('a', { state: 'waiting', ask: { kind: 'permission', tool: 'Bash', summary: 'Bash: npm test\nmore' } })), { kind: 'ask', text: 'npm test', key: 'permission', tool: 'Bash' }, '앞의 도구 이름은 뺀다');
  assert.equal(lastLineOf(S('a', { state: 'waiting', ask: { kind: 'question', questions: [{ question: 'Which?' }, { question: 'And?' }] } })).text, 'Which? / And?');
  assert.equal(lastLineOf(S('a', { state: 'trust_wait' })).key, 'trust');
  assert.deepEqual(lastLineOf(S('a', { state: 'working', lastPrompt: '\n  fix the bug\nplease', lastAnswer: 'old' })), { kind: 'prompt', text: 'fix the bug' });
  assert.deepEqual(lastLineOf(S('a', { lastAnswer: 'Done.\nDetails' })), { kind: 'answer', text: 'Done.' });
  assert.deepEqual(lastLineOf(S('a', { kind: 'shell', shell: { command: 'git status' } })), { kind: 'shell', text: 'git status' });
  assert.equal(lastLineOf(S('a', { state: 'error', error: 'boom' })).kind, 'error');
  assert.deepEqual(lastLineOf(S('a')), { kind: 'none', text: '' });
});

test('자주 쓰는 키 줄의 바이트(응용 커서 모드면 화살표가 ESC O)', () => {
  assert.deepEqual(KEY_ROW, ['enter', 'esc', 'ctrlc', 'up', 'down', 'tab', 'shifttab', 'slash']);
  assert.deepEqual(KEY_ROW.map((k) => keyBytes(k)), ['\r', '\x1b', '\x03', '\x1b[A', '\x1b[B', '\t', '\x1b[Z', '/']);
  assert.equal(keyBytes('up', { appCursor: true }), '\x1bOA');
  assert.equal(keyBytes('down', { appCursor: true }), '\x1bOB');
  assert.equal(keyBytes('nope'), '');
});

test('손가락 끌기 → 휠, 가상 키보드를 뺀 높이, 보내기 길, 다음 응답 필요', () => {
  assert.equal(touchWheelDelta(-20), 60, '손가락을 올리면 아래(뒤)로');
  assert.equal(touchWheelDelta(10), -30);
  assert.equal(touchWheelDelta(0), 0);
  assert.deepEqual(viewportBox({ height: 400.4, offsetTop: 12.6 }, 844), { height: 400, top: 13 });
  assert.deepEqual(viewportBox(null, 844), { height: 844, top: 0 });
  assert.deepEqual(sendPlan(S('a'), 'line 1\r\nline 2'), { method: 'session.send', text: 'line 1\nline 2', whileWorking: 'type' }, '에이전트는 전달 대기열, 여러 줄 그대로(P90: Claude Code는 일하는 중이면 바로 넣기)');
  assert.deepEqual(sendPlan(S('a', { kind: 'shell' }), 'ls -la\n\n'), { method: 'terminal.input', data: 'ls -la\r' }, '셸은 터미널 입력 + Enter');
  assert.equal(sendPlan(S('a'), '   \n '), null);
  assert.equal(nextNeed(['a', 'b', 'c'], 'b'), 'c');
  assert.equal(nextNeed(['a', 'b', 'c'], 'c'), 'a');
  assert.equal(nextNeed(['a', 'b'], 'x'), 'a', '지금 세션이 목록에 없으면 처음');
  assert.equal(nextNeed(['a'], 'a'), null, '지금 세션밖에 없다');
  assert.equal(nextNeed([], 'a'), null);
});

test('서비스 워커: API·WebSocket·짝 맺기·로그인·업로드·hook·sw.js·다른 출처·GET 아님은 손대지 않는다', () => {
  const O = 'https://pc.example.ts.net';
  const r = (p, more = {}) => swRoute({ url: `${O}${p}`, origin: O, ...more });
  for (const p of ['/api', '/api?x=1', '/web/me', '/web/pair/code', '/web/pair/poll?id=1&secret=s', '/web/pair/request', '/web/passkey/login', '/web/passkey/register/options', '/web/passkey/enroll', '/web/logout', '/web/upload?name=a.png', '/hooks/claude', '/branch/spawn', '/health', '/sw.js', '/renderer.js.map', '/board.db', '/nope']) {
    assert.equal(r(p), 'pass', p);
  }
  assert.equal(r('/web/me', { mode: 'navigate' }), 'pass', '화면 이동이어도 /web/은 손대지 않는다');
  assert.equal(r('/renderer.js', { method: 'POST' }), 'pass');
  assert.equal(swRoute({ url: 'https://evil.example/renderer.js', origin: O }), 'pass', '다른 출처');
  assert.equal(swRoute({ url: 'not a url', origin: O }), 'pass');
  // 껍데기
  assert.equal(r('/'), 'shell');
  assert.equal(r('/', { mode: 'navigate' }), 'shell');
  assert.equal(r('/?x=1', { mode: 'navigate' }), 'shell');
  assert.equal(r('/index.html'), 'shell');
  assert.equal(r('/renderer.js'), 'shell');
  assert.equal(r('/renderer.css'), 'shell');
  assert.equal(r('/fonts/geist-latin-wght-normal-ABC123.woff2'), 'font');
  assert.equal(r('/assets/pwa/manifest.webmanifest'), 'asset');
  assert.equal(r('/assets/kinds/claude.svg'), 'asset');
  assert.equal(r('/assets/../web/me'), 'pass', 'URL이 /web/me로 풀린다');
});

test('서비스 워커: 캐시에 넣는 응답은 같은 출처의 200, 쿠키 없음, no-store 아님. 옛 캐시는 이 앱의 것만 지운다', () => {
  assert.equal(cacheableResponse({ status: 200, type: 'basic', headers: { 'cache-control': 'no-cache' } }), true);
  assert.equal(cacheableResponse({ status: 200, headers: new Map([['set-cookie', 'a=b']]) }), false);
  assert.equal(cacheableResponse({ status: 200, headers: { 'cache-control': 'no-store' } }), false);
  assert.equal(cacheableResponse({ status: 503, headers: {} }), false, '원격 막음 쪽은 캐시하지 않는다');
  assert.equal(cacheableResponse({ status: 304, headers: {} }), false);
  assert.equal(cacheableResponse({ status: 200, type: 'opaque', headers: {} }), false);
  assert.deepEqual(shellList(['index.html', 'renderer.js', 'renderer.js.map', 'renderer.css', 'fonts/a-1.woff2', 'assets/pwa/icon-192.png', 'assets/pwa/manifest.webmanifest', 'sw.js', 'other.txt']), ['./', './renderer.js', './renderer.css', './assets/pwa/icon-192.png', './assets/pwa/manifest.webmanifest'], '글꼴은 미리 받지 않는다(쓸 때 캐시)');
  assert.equal(cacheName('v1'), `${CACHE_PREFIX}v1`);
  assert.deepEqual(staleCaches([cacheName('v0'), cacheName('v1'), 'someone-else'], 'v1'), [cacheName('v0')]);
});

test('매니페스트: 이름, 짧은 이름, standalone, 시작 주소·범위(보드 뿌리), 색, 아이콘 여러 크기(파일이 있고 크기가 맞다)', () => {
  const m = JSON.parse(fs.readFileSync(path.join(PWA, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'Atrium');
  assert.equal(m.short_name, 'Atrium');
  assert.equal(m.display, 'standalone');
  // 매니페스트는 /assets/pwa/에 있으니 ../../ = 보드 뿌리(/)
  assert.equal(new URL(m.start_url, 'https://pc.example.ts.net/assets/pwa/manifest.webmanifest').pathname, '/');
  assert.equal(new URL(m.scope, 'https://pc.example.ts.net/assets/pwa/manifest.webmanifest').pathname, '/');
  assert.equal(new URL(m.id, 'https://pc.example.ts.net/assets/pwa/manifest.webmanifest').pathname, '/');
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.notEqual(m.orientation, 'portrait', '가로로 돌리면 보드 화면을 쓴다(방향을 묶지 않는다)');
  const sizes = new Set(m.icons.filter((i) => i.purpose === 'any').map((i) => i.sizes));
  for (const s of ['192x192', '512x512', '180x180']) assert.ok(sizes.has(s), `아이콘 ${s}`);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'), 'maskable 512');
  for (const i of m.icons) {
    const buf = fs.readFileSync(path.join(PWA, i.src));
    assert.equal(buf.toString('ascii', 1, 4), 'PNG', i.src);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    assert.equal(`${w}x${h}`, i.sizes, i.src);
  }
});

test('index.html: 휴대폰 viewport(노치), iOS 홈 화면 meta, apple-touch-icon 180, 매니페스트', () => {
  const h = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  assert.match(h, /<meta name="viewport" content="[^"]*width=device-width[^"]*viewport-fit=cover/);
  assert.match(h, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(h, /apple-mobile-web-app-title" content="Atrium"/);
  assert.match(h, /<link rel="apple-touch-icon" sizes="180x180" href="assets\/pwa\/apple-touch-icon.png">/);
  assert.match(h, /<link rel="manifest" href="assets\/pwa\/manifest.webmanifest">/);
  const apple = fs.readFileSync(path.join(PWA, 'apple-touch-icon.png'));
  assert.equal(apple[25], 2, 'apple-touch-icon은 투명 없는 RGB');
});
