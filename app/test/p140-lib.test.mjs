// P140(#13): 터미널에 초점이 있어도 Ctrl+K는 명령 바, Ctrl+F는 찾기 바로 간다(lib/keys.js boardShortcut).
// 창의 키 잡기 단계가 이 판단으로 xterm보다 먼저 받는다. xterm 키 처리(keyAction)는 Ctrl+K를 그대로 둔다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boardShortcut, keyToData } from '../src/renderer/lib/keys.js';
import { keyAction } from '../src/renderer/lib/term-input.js';

const xterm = { tagName: 'TEXTAREA', className: 'xterm-helper-textarea', closest: (s) => (s === '.xterm' ? {} : null) };
const kd = (key, o = {}) => ({ type: 'keydown', key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, target: xterm, ...o });

test('P140 Ctrl+K: 터미널 초점에서도 명령 바', () => {
  assert.equal(boardShortcut(kd('k', { ctrlKey: true })), 'command');
  assert.equal(boardShortcut(kd('K', { ctrlKey: true, shiftKey: true })), 'command', 'Shift를 함께 눌러도(예전과 같다)');
  assert.equal(boardShortcut(kd('k', { metaKey: true })), 'command', 'macOS Cmd+K');
  assert.equal(boardShortcut(kd('k', { ctrlKey: true, target: { tagName: 'BODY' } })), 'command', '판');
});

test('P140 Ctrl+F: 찾기 바, Shift와 함께면 잡기 단계에서 받지 않는다', () => {
  assert.equal(boardShortcut(kd('f', { ctrlKey: true })), 'search');
  assert.equal(boardShortcut(kd('F', { ctrlKey: true, shiftKey: true })), null);
});

test('P140 판의 단축키가 아닌 키', () => {
  assert.equal(boardShortcut(kd('k')), null, 'k만');
  assert.equal(boardShortcut(kd('k', { ctrlKey: true, altKey: true })), null, 'Ctrl+Alt+K(AltGr 포함)');
  assert.equal(boardShortcut(kd('k', { ctrlKey: true, type: 'keyup' })), null, '뗌');
  assert.equal(boardShortcut(kd('c', { ctrlKey: true })), null, 'Ctrl+C는 터미널 몫');
  assert.equal(boardShortcut(kd('l', { ctrlKey: true })), null, 'Ctrl+L은 터미널 몫');
  assert.equal(boardShortcut(null), null);
});

test('P140 터미널이 붙기 전에 모으는 키에도 ^K는 들어가지 않는다', () => {
  assert.equal(keyToData(kd('k', { ctrlKey: true })), null);
  assert.equal(keyAction(kd('k', { ctrlKey: true }), false), 'pass', 'xterm 쪽 판단은 그대로(잡기 단계가 먼저 받는다)');
});
