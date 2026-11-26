// P283 단위 시험: 판 안 링크(터미널 OSC 8·글 속 주소, 마크다운 링크) 고르기·거르기·열기.
// - 글 속 http(s) 주소 찾기(문장부호·괄호·따옴표·한글에서 끝남), 감싼 줄·넓은 글자 칸 자리
// - 스킴 거르기: http·https만 열고 file:·사용자 정의 스킴·깨진 주소는 알림
// - 누르기 규칙: PC는 Ctrl(Cmd)+누르기, 손가락·펜은 그냥 탭
// - 처리기 연결: 터미널은 linkHandler(allowNonHttpProtocols)와 링크 제공자, 마크다운은 openLink, 창은 http(s)만 openExternal·늘 deny
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUrls, linkTarget, openWith, opensOnClick, cellLinks } from '../src/renderer/lib/links.js';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const urls = (s) => findUrls(s).map((u) => u.url);

test('글 속 주소: 빈칸·문장부호·괄호·따옴표·한글에서 끝난다', () => {
  assert.deepEqual(urls('see https://example.com/a?b=1&c=2#x now'), ['https://example.com/a?b=1&c=2#x']);
  assert.deepEqual(urls('Done: https://example.com/docs.'), ['https://example.com/docs']);
  assert.deepEqual(urls('(https://example.com/x) and [https://example.com/y]'), ['https://example.com/x', 'https://example.com/y']);
  assert.deepEqual(urls('wiki https://en.wikipedia.org/wiki/Foo_(bar), ok'), ['https://en.wikipedia.org/wiki/Foo_(bar)']);
  assert.deepEqual(urls('"https://a.example/q" \'http://b.example\''), ['https://a.example/q', 'http://b.example']);
  assert.deepEqual(urls('https://example.com/p에서 보세요'), ['https://example.com/p']);
  assert.deepEqual(urls('<https://example.com/z>'), ['https://example.com/z']);
  assert.deepEqual(urls('HTTPS://EXAMPLE.COM/U and http://localhost:5173/'), ['HTTPS://EXAMPLE.COM/U', 'http://localhost:5173/']);
  assert.deepEqual(urls('no links: http:// ftp://x.y file:///C:/a www.example.com'), []);
  const [u] = findUrls('ab https://x.io/q.');
  assert.deepEqual([u.start, u.end], [3, 17]);
});

test('스킴 거르기: http·https만 연다', () => {
  assert.equal(linkTarget('https://example.com/a b').href, 'https://example.com/a%20b');
  assert.equal(linkTarget(' http://example.com ').href, 'http://example.com/');
  for (const [raw, scheme] of [['file:///C:/Windows/notepad.exe', 'file:'], ['vscode://file/x', 'vscode:'], ['javascript:alert(1)', 'javascript:'], ['ms-settings:', 'ms-settings:']]) {
    const r = linkTarget(raw);
    assert.equal(r.href, null, raw);
    assert.equal(r.scheme, scheme, raw);
  }
  assert.deepEqual(linkTarget('not a url'), { href: null, scheme: '' });
  assert.deepEqual(linkTarget(''), { href: null, scheme: '' });
});

test('열기: 열 수 있으면 open(새 탭·기본 브라우저), 아니면 알림만', () => {
  const calls = [];
  const io = { open: (h) => calls.push(['open', h]), notify: (s) => calls.push(['notify', s]) };
  assert.equal(openWith('https://example.com/x', io), 'https://example.com/x');
  assert.equal(openWith('file:///etc/passwd', io), null);
  assert.equal(openWith('garbage', io), null);
  assert.deepEqual(calls, [['open', 'https://example.com/x'], ['notify', 'file:'], ['notify', '?']]);
});

test('누르기 규칙: PC는 Ctrl·Cmd+누르기, 손가락·펜은 그냥 탭', () => {
  assert.equal(opensOnClick({ ctrlKey: false }, 'mouse'), false);
  assert.equal(opensOnClick({ ctrlKey: true }, 'mouse'), true);
  assert.equal(opensOnClick({ metaKey: true }, 'mouse'), true);
  assert.equal(opensOnClick({}, 'touch'), true);
  assert.equal(opensOnClick({}, 'pen'), true);
});

test('터미널 칸 → 링크 자리: 감싼 줄을 이어 찾고 넓은 글자 칸을 센다', () => {
  // 10칸 터미널: "가 https:/" (가 = 2칸) + 다음 줄 "/x.io/ab ." (감싼 줄)
  const row1 = [{ ch: '가', x: 1, y: 5 }, { ch: ' ', x: 3, y: 5 }, ...[...'https:/'].map((ch, i) => ({ ch, x: 4 + i, y: 5 }))];
  const row2 = [...'/x.io/ab .'].map((ch, i) => ({ ch, x: 1 + i, y: 6 }));
  const [l, ...rest] = cellLinks([...row1, ...row2]);
  assert.equal(rest.length, 0);
  assert.equal(l.url, 'https://x.io/ab');
  assert.deepEqual(l.range, { start: { x: 4, y: 5 }, end: { x: 8, y: 6 } });
  assert.deepEqual(cellLinks([{ ch: 'a', x: 1, y: 1 }]), []);
});

test('연결: 터미널 linkHandler·링크 제공자, 마크다운 openLink, 창은 http(s)만 바깥으로 늘 deny', () => {
  const tl = read('src/renderer/term-links.js');
  assert.match(tl, /term\.options\.linkHandler = \{/);
  assert.match(tl, /allowNonHttpProtocols: true/);
  assert.match(tl, /registerLinkProvider\(/);
  assert.match(tl, /opensOnClick\(e, pointerType\)/);
  assert.match(read('src/renderer/TerminalView.jsx'), /attachTermLinks\(term, host/);
  const md = read('src/renderer/Markdown.jsx');
  assert.match(md, /openLink\(n\.href\)/);
  assert.doesNotMatch(md, /clipboard\.writeText\(n\.href\)/);
  assert.match(read('src/renderer/open-link.js'), /window\.open\(href, '_blank', 'noopener'\)/);
  const main = read('src/main/main.mjs');
  assert.match(main, /setWindowOpenHandler\(\(\{ url \}\) => \{ if \(\/\^https\?:\/\.test\(url\)\) shell\.openExternal\(url\); return \{ action: 'deny' \}; \}\)/);
});

test('사전: 두 언어에 링크 글', async () => {
  const { default: en } = await import('../src/renderer/locales/en.js');
  const { default: ko } = await import('../src/renderer/locales/ko.js');
  for (const d of [en, ko]) {
    assert.ok(d.urlLink.hint && d.urlLink.notOpened.includes('{scheme}'));
    assert.ok(d.markdown.openLink && !d.markdown.copyLink);
  }
});
