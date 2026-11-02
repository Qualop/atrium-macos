import test from 'node:test';
import assert from 'node:assert/strict';
import { translate, setLanguage } from '../src/renderer/lib/i18n.js';
import { shortcutText } from '../src/renderer/lib/shortcuts.js';
import { bindingText } from '../src/renderer/lib/sidebar.js';

test('Mac 단축키 표시는 실제 Command 지원 명령만 바꾼다', () => {
  assert.equal(shortcutText('Ctrl+K Ctrl+F Ctrl+Enter Ctrl+Shift+E', true), '⌘K ⌘F ⌘Enter ⌘⇧E');
  assert.equal(shortcutText('Ctrl+C Ctrl+G Ctrl+드래그', true), 'Ctrl+C Ctrl+G Ctrl+드래그');
  assert.equal(shortcutText('Ctrl+K', false), 'Ctrl+K');
  assert.ok(translate('ko', 'backend.plain', { text: 'Ctrl+K is part of my code' }).includes('Ctrl+K is part of my code'));
});

test('백엔드의 기존 대화 연결 상태도 새 한국어로 표시한다', () => {
  setLanguage('ko');
  try {
    assert.equal(bindingText({ bound: true, where: 'unknown', label: '묶여 있을 수 있음 · 출처 모름' }), translate('ko', 'binding.maybe', { why: translate('ko', 'binding.srcUnknown') }));
    assert.equal(bindingText({ bound: true, where: 'unknown', label: '묶여 있을 수 있음 · 방금 기록됨' }), translate('ko', 'binding.maybe', { why: translate('ko', 'binding.justWritten') }));
  } finally { setLanguage('en'); }
});
