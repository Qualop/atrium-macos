// P162: 업로드 자리(데스크톱 창의 붙여 넣은 그림, P48 웹 업로드)를 판이 띄운 Claude Code가 묻지 않고 읽는 규칙
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { uploadDirOf, uploadsReadRule } from '../src/uploads.mjs';
import { UPLOAD_MAX_BYTES, cleanupUploads } from '../src/web.mjs';

test('uploadsReadRule: 업로드 자리를 //드라이브/… 꼴의 Read 규칙으로', () => {
  assert.equal(uploadDirOf(path.join('X', 'data')), path.join('X', 'data', 'uploads'));
  if (process.platform === 'win32') {
    assert.equal(uploadsReadRule('C:\\Board Data\\atrium'), 'Read(//c/Board Data/atrium/uploads/**)');
    assert.equal(uploadsReadRule('D:\\x'), 'Read(//d/x/uploads/**)');
  } else {
    assert.equal(uploadsReadRule('/home/u/atrium'), 'Read(//home/u/atrium/uploads/**)');
  }
});

test('web.mjs는 옮긴 업로드 함수를 그대로 내보낸다(P48 시험과 웹 업로드)', () => {
  assert.equal(UPLOAD_MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(typeof cleanupUploads, 'function');
});
