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

test('macOS 판: Windows 말을 Mac 말로(Windows Hello, PowerShell, 트레이, Alt, Ctrl+클릭, C:\\ 경로)', () => {
  assert.equal(shortcutText('Create a passkey with Windows Hello, Touch ID or a security key', true), 'Create a passkey with Touch ID or a security key');
  assert.equal(shortcutText('Run this in PowerShell on this PC:', true), 'Run this in Terminal on this Mac:');
  assert.equal(shortcutText('이 PC의 PowerShell에서 아래 명령을 실행하세요.', true), '이 Mac의 터미널에서 아래 명령을 실행하세요.');
  assert.equal(shortcutText('Shift+드래그로 여러 카드를 선택하고, Ctrl+클릭으로 선택에 추가합니다.', true), 'Shift+드래그로 여러 카드를 선택하고, ⌘+클릭으로 선택에 추가합니다.');
  assert.equal(shortcutText('Alt + drag: change', true), '⌥+drag: change');
  assert.equal(shortcutText('Alt를 누른 채 드래그해도', true), '⌥(Option)를 누른 채 드래그해도');
  assert.equal(shortcutText('C:\\Workspace\\project', true), '~/Projects/project');
  assert.equal(shortcutText('Stay in the tray when the window closes. Use the tray menu', true), 'Stay in the menu bar when the window closes. Use the menu bar icon');
  assert.equal(shortcutText('Ctrl+click Windows Hello', false), 'Ctrl+click Windows Hello');
  assert.equal(shortcutText('Ctrl+드래그', true), 'Ctrl+드래그', '덩어리 붙이기는 Ctrl 그대로');
});
