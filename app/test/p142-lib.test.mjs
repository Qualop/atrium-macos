// P142 단위 시험: 명령 바 입력칸의 @태그 가르기, 받는 세션 목록, 줄바꿈 키(Shift·Alt+Enter), 높이 계산(상한), 문구 사전
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mentionTokens, recipients, mirrorParts, isNewlineKey, insertNewline, maxFieldHeight, fieldHeight, tagState, MAX_LINES } from '../src/renderer/lib/cmd-input.js';
import { setLanguage, t } from '../src/renderer/lib/i18n.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const S = [
  { sessionId: 's1', name: 'lead', kind: 'claude' },
  { sessionId: 's2', name: 'w2', kind: 'codex', address: 'old-w2' },
  { sessionId: 's3', name: 'sh', kind: 'shell' },
];

test('앞머리 @태그는 받는 세션, 있는 이름·없는 이름·@all·셸을 가른다', () => {
  const tk = mentionTokens('@lead @nope @all @sh 일 해 줘', S);
  assert.deepEqual(tk.map((x) => [x.ref, x.lead, x.state]), [['lead', true, 'ok'], ['nope', true, 'unknown'], ['all', true, 'all'], ['sh', true, 'shell']]);
  assert.deepEqual(tk.map((x) => [x.start, x.end]), [[0, 5], [6, 11], [12, 16], [17, 20]]);
});

test('글 중간의 @이름은 받는 세션이 아니다(판에 있는 이름만 inline으로)', () => {
  const tk = mentionTokens('@lead 결과를 @w2 에게도 알려 @nobody, a@lead 메일', S);
  assert.deepEqual(tk.map((x) => [x.ref, x.lead, x.state]), [['lead', true, 'ok'], ['w2', false, 'inline']]);
  assert.deepEqual(mentionTokens('안녕 @lead', S).map((x) => x.state), ['inline']);
  assert.deepEqual(mentionTokens('', S), []);
});

test('옛 주소(P66)와 대소문자', () => {
  assert.equal(tagState('old-w2', S), 'ok');
  assert.equal(tagState('LEAD', S), 'ok');
  assert.equal(tagState('ghost', S), 'unknown');
});

test('받는 세션 목록: 차례대로, 같은 세션은 한 번, @all은 에이전트 수', () => {
  assert.deepEqual(recipients('@lead @w2 @old-w2 @lead hi', S), [{ ref: 'lead', name: 'lead', state: 'ok' }, { ref: 'w2', name: 'w2', state: 'ok' }]);
  assert.deepEqual(recipients('@all @all hi', S), [{ ref: 'all', name: 'all', state: 'all', count: 2 }]);
  assert.deepEqual(recipients('@x hi @lead', S), [{ ref: 'x', name: 'x', state: 'unknown' }]);
  assert.deepEqual(recipients('hi @lead', S), []);
  // 줄바꿈 뒤의 태그도 앞머리면 받는다(백엔드 parseTargets와 같다)
  assert.deepEqual(recipients('@lead\n@w2 hi', S).map((r) => r.name), ['lead', 'w2']);
});

test('겹 조각은 원래 글을 그대로 잇는다', () => {
  const s = '@lead @w2 글 @lead 끝';
  const parts = mirrorParts(s, mentionTokens(s, S));
  assert.equal(parts.map((p) => p.text).join(''), s);
  assert.deepEqual(parts.filter((p) => p.tag).map((p) => p.text), ['@lead', '@w2', '@lead']);
});

test('줄바꿈 키: Shift+Enter, Alt+Enter. Enter·Ctrl+Enter는 아니다', () => {
  assert.equal(isNewlineKey({ key: 'Enter', shiftKey: true }), true);
  assert.equal(isNewlineKey({ key: 'Enter', altKey: true }), true);
  assert.equal(isNewlineKey({ key: 'Enter' }), false);
  assert.equal(isNewlineKey({ key: 'Enter', ctrlKey: true, altKey: true }), false);
  assert.equal(isNewlineKey({ key: 'a', altKey: true }), false);
  assert.deepEqual(insertNewline('ab', 1, 1), { text: 'a\nb', caret: 2 });
  assert.deepEqual(insertNewline('abcd', 1, 3), { text: 'a\nd', caret: 2 });
});

test('높이: 그려진 높이로 늘고, 상한은 18줄(지금 6줄의 3배)과 창 높이 42% 가운데 작은 것', () => {
  assert.equal(MAX_LINES, 18);
  const lh = 21.75;
  assert.equal(maxFieldHeight({ lineHeight: lh, viewportHeight: 2000 }), lh * 18);
  assert.equal(maxFieldHeight({ lineHeight: lh, viewportHeight: 600 }), 252);
  assert.equal(maxFieldHeight({ lineHeight: lh, viewportHeight: 20 }), lh);
  const max = maxFieldHeight({ lineHeight: lh, viewportHeight: 2000 });
  assert.deepEqual(fieldHeight({ contentHeight: 0, lineHeight: 22, maxHeight: max }), { height: 22, scroll: false });
  assert.deepEqual(fieldHeight({ contentHeight: 65.25, lineHeight: 22, maxHeight: max }), { height: 66, scroll: false });
  assert.deepEqual(fieldHeight({ contentHeight: 1000, lineHeight: 22, maxHeight: max }), { height: max, scroll: true });
});

test('문구 사전: 받는 세션 칩 글이 두 말 모두 있다', () => {
  for (const lang of ['en', 'ko']) {
    setLanguage(lang);
    for (const k of ['cmdTo.label', 'cmdTo.ok', 'cmdTo.unknown', 'cmdTo.shell']) assert.notEqual(t(k, { name: 'x' }), k);
    assert.match(t('cmdTo.all', { n: 3 }), /3/);
  }
  setLanguage('en');
});

test('CSS: 글칸이 여백을 쥐고 textarea는 여백 없이, 칩 줄은 바가 자란 만큼 비킨다', () => {
  const css = fs.readFileSync(path.join(here, '../src/renderer/styles.css'), 'utf8');
  assert.match(css, /\.mt-cmd-field \{[^}]*padding: 18px 0/);
  assert.match(css, /\.mt-cmd-field > \.mt-cmd-input \{[^}]*padding: 0/);
  assert.match(css, /\.mt-chips \{ bottom: calc\(104px \+ var\(--mt-cmd-grow, 0px\)\)/);
  const jsx = fs.readFileSync(path.join(here, '../src/renderer/CommandBar.jsx'), 'utf8');
  assert.doesNotMatch(jsx, /rows=\{Math\.min\(6/);
});
