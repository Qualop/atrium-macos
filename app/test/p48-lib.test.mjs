// P48(원격 R2) 창 단위 시험: 올린 파일의 PC 경로를 입력 글로(따옴표, 여럿), 커서 자리에 끼우기, 파일 있는지, 웹 어댑터는 Electron(window.mt 있음)에서 끼어들지 않는다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { quotePath, pathsText, insertAt, filesOf, hasFiles } from '../src/renderer/lib/upload.js';

test('경로 글: 빈칸이 있으면 따옴표, 여럿은 빈칸으로 잇고 끝에 빈칸', () => {
  assert.equal(quotePath('C:\\data\\uploads\\a.png'), 'C:\\data\\uploads\\a.png');
  assert.equal(quotePath('C:\\My Data\\a b.png'), '"C:\\My Data\\a b.png"');
  assert.equal(pathsText(['C:\\a.png', 'C:\\x y\\b.png']), 'C:\\a.png "C:\\x y\\b.png" ');
  assert.equal(pathsText([]), '');
});

test('커서 자리에 끼우기: 앞 글과 붙지 않게 빈칸 하나, 고른 글은 바꾼다', () => {
  assert.deepEqual(insertAt('', 0, 0, 'P '), { text: 'P ', caret: 2 });
  assert.deepEqual(insertAt('@a look', 7, 7, 'P '), { text: '@a look P ', caret: 10 });
  assert.deepEqual(insertAt('@a look ', 8, 8, 'P '), { text: '@a look P ', caret: 10 });
  assert.deepEqual(insertAt('@a XX end', 3, 5, 'P '), { text: '@a P  end', caret: 5 });
});

test('끌어 놓기·붙여넣기의 파일', () => {
  assert.equal(hasFiles({ types: ['text/plain'] }), false);
  assert.equal(hasFiles({ types: ['Files'] }), true);
  assert.equal(hasFiles(null), false);
  assert.deepEqual(filesOf({ files: [1, 2] }), [1, 2]);
  assert.deepEqual(filesOf(null), []);
});

test('웹 어댑터는 window.mt가 없을 때만 둔다(Electron 창은 preload 그대로)', () => {
  const src = fs.readFileSync(new URL('../src/renderer/web.js', import.meta.url), 'utf8');
  assert.match(src, /export const isWeb = typeof window !== 'undefined' && !window\.mt;/);
  assert.match(src, /if \(isWeb\) \{\s*window\.mt = \{/);
  for (const k of ['backend', 'metrics', 'log', 'notify', 'pickFolder', 'onNavigate']) assert.match(src, new RegExp(`\\b${k}\\b`), k);
  const main = fs.readFileSync(new URL('../src/renderer/main.jsx', import.meta.url), 'utf8');
  assert.ok(main.indexOf("import { isWeb } from './web.js'") < main.indexOf("import { api } from './api.js'"), '웹 어댑터를 먼저 부른다');
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
  assert.match(html, /connect-src 'self' ws:\/\/127\.0\.0\.1:\*/);
});
