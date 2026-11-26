// macOS 판: 키보드 규칙(Cmd가 앱 키, Ctrl은 터미널 프로그램 몫, delete 키 = Backspace)
import test from 'node:test';
import assert from 'node:assert/strict';
import { keyAction } from '../src/renderer/lib/term-input.js';
import { closeKeyTargets, confirmKey, appMod, isDeleteKey } from '../src/renderer/lib/keys.js';

const kd = (key, o = {}) => ({ type: 'keydown', key, ...o });

test('keyAction: Mac은 Cmd+C·Cmd+V로 복사·붙여넣기, Ctrl+C·Ctrl+V는 프로그램에', () => {
  const mac = { mac: true };
  assert.equal(keyAction(kd('v', { metaKey: true }), false, mac), 'paste');
  assert.equal(keyAction(kd('c', { metaKey: true }), true, mac), 'copy');
  assert.equal(keyAction(kd('c', { metaKey: true }), false, mac), 'copy', 'Cmd+C는 고른 글이 없어도 ^C를 보내지 않는다');
  assert.equal(keyAction(kd('c', { ctrlKey: true }), true, mac), 'pass', '고른 글이 있어도 Ctrl+C는 끊기');
  assert.equal(keyAction(kd('v', { ctrlKey: true }), false, mac), 'pass');
  assert.equal(keyAction(kd('g', { ctrlKey: true }), false, mac), 'block-ctrl-g');
  // Windows는 예전 그대로
  assert.equal(keyAction(kd('c', { ctrlKey: true }), true, { mac: false }), 'copy');
  assert.equal(keyAction(kd('c', { ctrlKey: true }), false, { mac: false }), 'pass');
  assert.equal(keyAction(kd('v', { ctrlKey: true }), false, { mac: false }), 'paste');
});

test('appMod·isDeleteKey', () => {
  assert.equal(appMod({ metaKey: true }, true), true);
  assert.equal(appMod({ ctrlKey: true }, true), false);
  assert.equal(appMod({ ctrlKey: true, metaKey: true }, true), false);
  assert.equal(appMod({ ctrlKey: true }, false), true);
  assert.equal(isDeleteKey({ key: 'Backspace' }, true), true);
  assert.equal(isDeleteKey({ key: 'Backspace' }, false), false);
});

test('닫기 키: Mac은 delete(Backspace)로도 닫고 확인 창에서 삭제를 고른다', () => {
  const sessions = new Map([['a', {}]]);
  assert.deepEqual(closeKeyTargets(kd('Backspace'), { selected: ['a'], sessions }, true), { one: 'a' });
  assert.equal(closeKeyTargets(kd('Backspace'), { selected: ['a'], sessions }, false), null);
  assert.equal(confirmKey(kd('Backspace', { target: { tagName: 'BODY' } }), true), 'arm');
  assert.equal(confirmKey(kd('Backspace', { target: { tagName: 'TEXTAREA' } }), true), null);
});

test('터미널 링크(P283): Mac은 Cmd+누르기로 연다, Ctrl+누르기(오른쪽 누르기)는 아니다', async () => {
  const { opensOnClick } = await import('../src/renderer/lib/links.js');
  assert.equal(opensOnClick({ metaKey: true }, 'mouse', true), true);
  assert.equal(opensOnClick({ ctrlKey: true }, 'mouse', true), false);
  assert.equal(opensOnClick({ ctrlKey: true }, 'mouse', false), true);
  assert.equal(opensOnClick({}, 'touch', true), true);
});
