// P28 창 단위 시험: 닫기 확인의 키(Delete 한 번 더 → 삭제 고르기, Esc → 취소), 설정 탭과 닫기 안내 사전 열쇠
import test from 'node:test';
import assert from 'node:assert/strict';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';
import { confirmKey } from '../src/renderer/lib/keys.js';

const key = (k, extra = {}) => ({ key: k, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, isComposing: false, target: { tagName: 'BUTTON', closest: () => null }, ...extra });

test('닫기 확인: Delete는 삭제 고르기, Esc는 취소, 다른 키는 그대로', () => {
  assert.equal(confirmKey(key('Delete')), 'arm');
  assert.equal(confirmKey(key('Escape')), 'cancel');
  assert.equal(confirmKey(key('Enter')), null, 'Enter는 초점 간 단추가 받는다');
  assert.equal(confirmKey(key('Backspace')), null);
  assert.equal(confirmKey(key('Delete', { target: { tagName: 'BODY' } })), 'arm');
  assert.equal(confirmKey(null), null);
});

test('닫기 확인: 조합 키, 한글 조합 중, 입력 칸·터미널 안의 키는 보지 않는다', () => {
  for (const m of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'isComposing']) assert.equal(confirmKey(key('Delete', { [m]: true })), null, m);
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(confirmKey(key('Delete', { target: { tagName: tag } })), null, tag);
  assert.equal(confirmKey(key('Delete', { target: { tagName: 'DIV', isContentEditable: true } })), null);
  assert.equal(confirmKey(key('Delete', { target: { tagName: 'TEXTAREA', closest: (s) => (s === '.xterm' ? {} : null) } })), null);
  assert.equal(confirmKey(key('Delete', { target: { tagName: 'DIV', closest: (s) => (s === '.xterm' ? {} : null) } })), null, '터미널 안');
});

test('사전: 설정 탭 여섯과 새 줄 이름, 닫기 키 안내가 두 언어에 있다', () => {
  for (const d of [en, ko]) {
    assert.deepEqual(Object.keys(d.settings.tab).sort(), ['agents', 'branch', 'general', 'recall', 'sleep', 'spawn']);
    for (const k of ['on', 'off', 'languageHint', 'trayName', 'autoOpenName', 'claudeModelHint', 'effortHint', 'permissionModeHint']) assert.equal(typeof d.settings[k], 'string', k);
    assert.equal(typeof d.close.keys, 'string');
    assert.equal(typeof d.close.keysArmed, 'string');
  }
});
