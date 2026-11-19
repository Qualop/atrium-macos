// P53 시험: 영어의 "Prompt" 두 뜻 나누기(#9), 변경 내역의 백엔드 줄 이름표(#10)
import test from 'node:test';
import assert from 'node:assert/strict';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';
import { setLanguage, getLanguage } from '../src/renderer/lib/i18n.js';
import { CHANGE_LABEL } from '../src/renderer/lib/attention.js';

test('P53 #9: 영어에서 셸의 명령 대기는 요청 이름표(Prompt)와 다른 말이다', () => {
  for (const r of [en.node.prompt, en.convo.prompt]) assert.equal(r, 'Prompt');
  for (const v of [en.workspaces.shellPrompt, en.chat.prompt, en.chat.promptLast.replace('{cmd}', 'ls')]) {
    assert.ok(!/^Prompt\b/.test(v), v);
    assert.match(v, /^Waiting for command/);
  }
  // 한국어도 두 뜻이 다르다(P39 용어표: 요청 / 명령 입력 대기)
  assert.equal(ko.node.prompt, '요청');
  assert.equal(ko.workspaces.shellPrompt, '명령 입력 대기');
  assert.ok(ko.chat.promptLast.startsWith(ko.chat.prompt));
  assert.ok(en.chat.promptLast.startsWith(en.chat.prompt));
});

test('P53 #10: 백엔드 줄과 터미널 줄은 이름표가 다르다', () => {
  const was = getLanguage();
  try {
    setLanguage('ko');
    assert.equal(CHANGE_LABEL.backend, '앱 연결 서비스');
    assert.equal(CHANGE_LABEL.terminal, '터미널');
    assert.equal(CHANGE_LABEL.needs_you, '응답 필요');
    assert.equal(CHANGE_LABEL.nope, undefined);
    setLanguage('en');
    assert.equal(CHANGE_LABEL.backend, 'Backend');
  } finally { setLanguage(was); }
});
