// macOS 판: 권한 카드의 선택지 옮김(lib/response-needed.js choicesLine)
import test from 'node:test';
import assert from 'node:assert/strict';
import { choicesLine, choiceText, responseNeeded } from '../src/renderer/lib/response-needed.js';

test('Claude Code 권한 선택지를 번호와 함께 이 창의 말로, 모르는 선택지는 그대로', () => {
  const a = { kind: 'permission', summary: 'Read: /tmp/x', choices: [
    { n: 1, label: 'Yes, and keep allowing any reads outside the working directories' }, { n: 2, label: 'No, and block reads outside the working directories from now on' },
    { n: 3, label: 'No, and ask again next time' }, { n: 4, label: 'Yes, but ask again next time' }, { n: 5, label: 'Something new' }] };
  assert.equal(choicesLine(a), "1 Allow, don't ask again · 2 Deny and block from now on · 3 Deny · 4 Allow once · 5 Something new");
  assert.equal(choiceText('Yes'), 'Allow'); assert.equal(choiceText('No, and tell Claude what to do differently'), 'Deny and say what to do instead');
  assert.equal(choicesLine({ choices: null }), '');
  assert.equal(responseNeeded({ state: 'waiting', kind: 'claude', ask: a }).choices.startsWith('1 Allow'), true);
  assert.equal(responseNeeded({ state: 'trust_wait', kind: 'claude', ask: a }).choices, undefined, '신뢰 질문에는 붙이지 않는다');
});
