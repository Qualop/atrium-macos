// P133 창 단위 시험: 판 밖 Codex 대화의 묶임 글(잠금으로 본 열림, Codex 앱)과 두 사전의 Codex 글
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindingText } from '../src/renderer/lib/sidebar.js';
import { setLanguage, translate } from '../src/renderer/lib/i18n.js';
import ko from '../src/renderer/locales/ko.js';
import en from '../src/renderer/locales/en.js';

test('P133: Codex 대화의 묶임 글 — 잠금(Codex에서 사용 중), Codex 앱, 앱에서 열림, 명령줄 pid, 확실하지 않음', () => {
  setLanguage('ko');
  assert.equal(bindingText({ bound: true, harness: 'codex', where: 'codex', open: true, sure: true }), 'Codex에서 사용 중');
  assert.equal(bindingText({ bound: true, harness: 'codex', where: 'desktop', sure: true }), 'Codex 앱');
  assert.equal(bindingText({ bound: true, harness: 'codex', where: 'desktop', open: true, sure: true }), 'Codex 앱 · 열려 있음');
  assert.equal(bindingText({ bound: true, harness: 'codex', where: 'terminal', pid: 7, sure: true }), translate('ko', 'binding.terminal', { pid: 7 }));
  assert.equal(bindingText({ bound: true, harness: 'codex', where: 'unknown', sure: false, label: '다른 곳에서 사용 중일 수 있음 · 최근 활동 감지' }), translate('ko', 'binding.maybe', { why: translate('ko', 'binding.justWritten') }));
  setLanguage('en');
  assert.equal(bindingText({ bound: true, harness: 'codex', where: 'codex', open: true }), 'In use in Codex');
  // Claude Code 데스크톱 줄은 그대로
  assert.equal(bindingText({ bound: true, where: 'desktop' }), translate('en', 'binding.desktop'));
  setLanguage('ko');
});

test('P133: 두 사전에 같은 Codex 글 열쇠가 있다', () => {
  assert.deepEqual(Object.keys(ko.codexConvo).sort(), Object.keys(en.codexConvo).sort());
  for (const k of ['kind', 'kindTitle', 'open', 'app', 'appOpen', 'fork', 'forkTitle', 'forked', 'forkOnlyDesktop']) assert.ok(ko.codexConvo[k] && en.codexConvo[k], k);
  assert.ok(ko.refuse.codex && en.refuse.codex);
});
