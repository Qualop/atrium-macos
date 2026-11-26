// P162: 데스크톱 창의 파일·그림 붙여 넣기 순수 함수
import test from 'node:test';
import assert from 'node:assert/strict';
import { uriListPaths, splitFolders, pastePathsText, imageLabel, fileLabel, chipLabel, imageTokens, mergeTokens, nextImageNo, expandImages, wantsDesktopPaste, dropParts, isImagePath } from '../src/renderer/lib/desktop-paste.js';
import { mentionTokens, mirrorParts, tagDeleteRange } from '../src/renderer/lib/cmd-input.js';
import { insertAt } from '../src/renderer/lib/upload.js';

test('uriListPaths: file 주소를 Windows 경로로(빈칸·한글·UNC·주석)', () => {
  const list = 'file:///C:/Work/a.txt\r\nfile:///C:/Work/b%20c.txt\r\n# comment\r\nhttps://x.example/y\r\nfile:///C:/Work/%ED%95%9C%EA%B8%80.png\r\nfile://server/share/d.txt\r\n';
  const win = { platform: 'win32' };
  assert.deepEqual(uriListPaths(list, win), ['C:\\Work\\a.txt', 'C:\\Work\\b c.txt', 'C:\\Work\\한글.png', '\\\\server\\share\\d.txt']);
  assert.deepEqual(uriListPaths('', win), []);
  assert.deepEqual(uriListPaths('file://localhost/C:/x.txt', win), ['C:\\x.txt']);
});

test('uriListPaths: macOS는 POSIX 경로 그대로(빈칸·한글 NFD→NFC, localhost)', () => {
  const mac = { platform: 'darwin' };
  const nfd = encodeURIComponent('스크린샷'.normalize('NFD'));
  const list = `file:///Users/me/Desktop/${nfd}%201.png\nfile://localhost/tmp/a%20b.txt\n# c\nfile:///Users/me/dir/`;
  assert.deepEqual(uriListPaths(list, mac), ['/Users/me/Desktop/스크린샷 1.png', '/tmp/a b.txt', '/Users/me/dir/']);
  assert.equal(uriListPaths(list, mac)[0], '/Users/me/Desktop/스크린샷 1.png'.normalize('NFC'));
  assert.deepEqual(uriListPaths('file://nas/share/x.txt', mac), ['//nas/share/x.txt']);
});

test('pastePathsText: 여럿은 빈칸으로, 빈칸 든 경로는 따옴표, 끝에 빈칸 하나', () => {
  assert.equal(pastePathsText(['C:\\a.txt', 'C:\\b c.txt']), 'C:\\a.txt "C:\\b c.txt" ');
  assert.equal(pastePathsText([]), '');
  // 커서 자리에 넣을 때 앞 글과 빈칸으로 떨어진다
  assert.deepEqual(insertAt('@w 봐', 4, 4, pastePathsText(['C:\\a.txt'])), { text: '@w 봐 C:\\a.txt ', caret: 14 });
});

test('그림 칩: 아는 번호만 칩, 번호 매기기, 보낼 때 경로', () => {
  const images = { 1: { path: 'C:\\data\\uploads\\x-pasted.png' }, 2: { path: 'C:\\my data\\uploads\\y-pasted.png' } };
  const text = `@w 이것 봐 ${imageLabel(1)} 그리고 ${imageLabel(2)} [Image 9]`;
  const tks = imageTokens(text, images);
  assert.deepEqual(tks.map((x) => x.n), [1, 2]); // [Image 9]는 손으로 친 글
  assert.equal(text.slice(tks[0].start, tks[0].end), '[Image 1]');
  assert.equal(nextImageNo(text, images), 3);
  assert.equal(nextImageNo('@w 글', images), 1);
  assert.equal(expandImages(text, images), '@w 이것 봐 C:\\data\\uploads\\x-pasted.png 그리고 "C:\\my data\\uploads\\y-pasted.png" [Image 9]');
  assert.equal(expandImages('칩 없음', images), '칩 없음');
});

test('그림 칩: 태그와 함께 겹에 그리고 Backspace·Delete로 통째로 지운다', () => {
  const sessions = [{ name: 'w', kind: 'claude' }];
  const images = { 1: { path: 'C:\\u\\a.png' } };
  const text = '@w 봐 [Image 1] 끝';
  const tokens = mergeTokens(mentionTokens(text, sessions), imageTokens(text, images));
  assert.deepEqual(tokens.map((x) => (x.img ? 'img' : x.ref)), ['w', 'img']);
  const parts = mirrorParts(text, tokens);
  assert.equal(parts.find((p) => p.tag && p.tag.img).text, '[Image 1]');
  const s = text.indexOf('['), e = s + '[Image 1]'.length;
  // 칩 바로 뒤 Backspace: 칩과 뒤 빈칸 하나
  assert.deepEqual(tagDeleteRange(text, e, e, 'Backspace', tokens), { start: s, end: e + 1 });
  // 칩 뒤 빈칸 다음 커서에서도
  assert.deepEqual(tagDeleteRange(text, e + 1, e + 1, 'Backspace', tokens), { start: s, end: e + 1 });
  // 칩 바로 앞 Delete
  assert.deepEqual(tagDeleteRange(text, s, s, 'Delete', tokens), { start: s, end: e + 1 });
  // 칩 가운데는 기본 동작
  assert.equal(tagDeleteRange(text, s + 3, s + 3, 'Backspace', tokens), null);
});

test('wantsDesktopPaste: Windows는 데스크톱, 글 없음, 파일 있음일 때만', () => {
  const dt = (types, text = '') => ({ types, getData: (k) => (k === 'text/plain' ? text : '') });
  const w = { desktop: true, platform: 'win32' };
  assert.equal(wantsDesktopPaste(dt(['Files']), w), true);
  assert.equal(wantsDesktopPaste(dt(['Files']), { desktop: false, platform: 'win32' }), false); // 웹 화면(P48)
  assert.equal(wantsDesktopPaste(dt(['text/plain', 'Files'], 'hello'), w), false); // 글이 있으면 글
  assert.equal(wantsDesktopPaste(dt(['text/plain'], 'hello'), w), false);
  assert.equal(wantsDesktopPaste(null, w), false);
});

test('wantsDesktopPaste: macOS는 Finder가 파일 이름 글을 같이 넣어도 파일로 묻는다', () => {
  const dt = (types, text = '') => ({ types, getData: (k) => (k === 'text/plain' ? text : '') });
  const mac = { desktop: true, platform: 'darwin' };
  assert.equal(wantsDesktopPaste(dt(['text/plain', 'Files'], 'a.png'), mac), true);
  assert.equal(wantsDesktopPaste(dt(['text/plain'], 'hello'), mac), false);
  assert.equal(wantsDesktopPaste(dt(['Files']), { desktop: false, platform: 'darwin' }), false);
  assert.equal(wantsDesktopPaste(dt(['text/plain', 'Files'], 'a.png'), { desktop: true, platform: 'win32' }), false);
});

test('파일 칩: [File n]과 [Image n]은 번호를 함께 세고 종류가 맞아야 칩이다', () => {
  const images = { 1: { path: '/u/a.png', kind: 'image' }, 2: { path: '/Users/me/My Docs/r.pdf', kind: 'file' } };
  assert.equal(chipLabel(1, images[1]), imageLabel(1));
  assert.equal(chipLabel(2, images[2]), fileLabel(2));
  const text = `봐 ${imageLabel(1)} ${fileLabel(2)} ${imageLabel(2)} ${fileLabel(1)}`;
  assert.deepEqual(imageTokens(text, images).map((x) => x.ref), ['[Image 1]', '[File 2]']); // 종류가 다른 번호는 글
  assert.equal(nextImageNo(text, images), 3);
  assert.equal(expandImages(text, images), '봐 /u/a.png "/Users/me/My Docs/r.pdf" [Image 2] [File 1]');
});

test('dropParts: 경로 있는 파일(Finder)과 없는 파일(브라우저 그림)을 나눈다', () => {
  const f = (name, p) => ({ name, p });
  const dt = { files: [f('a.png', '/Users/me/a.png'), f('web.png', ''), f('b', '/x/b')] };
  const r = dropParts(dt, (x) => { if (x.name === 'b') throw new Error('x'); return x.p; });
  assert.deepEqual(r.paths, ['/Users/me/a.png']);
  assert.deepEqual(r.blobs.map((x) => x.name), ['web.png', 'b']);
  assert.deepEqual(dropParts(null, () => ''), { paths: [], blobs: [] });
  assert.equal(isImagePath('/a/B.HEIC'), true);
  assert.equal(isImagePath('/a/b.pdf'), false);
});

test('splitFolders: 폴더는 빼고 수를 센다, 알 수 없는 것은 파일로', () => {
  const dirs = new Set(['C:\\w\\sub dir']);
  const isDir = (p) => { if (p === 'C:\\gone.txt') throw new Error('ENOENT'); return dirs.has(p); };
  assert.deepEqual(splitFolders(['C:\\w\\a.txt', 'C:\\w\\sub dir', 'C:\\gone.txt'], isDir), { paths: ['C:\\w\\a.txt', 'C:\\gone.txt'], folders: 1 });
  assert.deepEqual(splitFolders(['C:\\w\\sub dir'], isDir), { paths: [], folders: 1 });
});
