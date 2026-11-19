// P155 단위 시험: 명령줄 태그 칩 한 번에 지우기(Backspace·Delete, 글 사이 칩, 여러 줄, 한글 조합 중은 기본 동작),
// 세션 맵 줄 머리 끌기는 Alt가 있을 때만 옮기기(없으면 시점 이동), Esc 취소, 도움말 글(두 사전).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mentionTokens, tagDeleteRange, toggleTag, switchText } from '../src/renderer/lib/cmd-input.js';
import { headDrag } from '../src/renderer/lib/mission-lineage.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(HERE, '..', 'src', 'renderer', f), 'utf8');
const SESS = [{ name: 'alpha', kind: 'claude' }, { name: 'beta', kind: 'codex' }, { name: 'sh1', kind: 'shell' }];

// 지운 뒤의 글
function del(text, caret, key, end = caret) {
  const r = tagDeleteRange(text, caret, end, key, mentionTokens(text, SESS));
  return r ? text.slice(0, r.start) + text.slice(r.end) : null;
}

test('Backspace: 칩 바로 뒤면 칩과 뒤 빈칸 하나를 통째로 지운다', () => {
  assert.equal(del('@alpha', 6, 'Backspace'), '');
  assert.equal(del('@alpha hello', 6, 'Backspace'), 'hello');
  assert.equal(del('@alpha @beta hello', 12, 'Backspace'), '@alpha hello');
  // 카드로 태그를 넣으면 "@alpha " 뒤에 커서가 남는다. 거기서 Backspace 한 번에 태그가 사라진다
  assert.equal(del('@alpha ', 7, 'Backspace'), '');
  assert.equal(del('@alpha @beta ', 13, 'Backspace'), '@alpha ');
  assert.equal(del('@all hi', 5, 'Backspace'), 'hi');
});

test('Delete: 칩 바로 앞이면 칩을 통째로 지운다', () => {
  assert.equal(del('@alpha hello', 0, 'Delete'), 'hello');
  assert.equal(del('@alpha @beta hello', 7, 'Delete'), '@alpha hello');
  assert.equal(del('@alpha @beta', 7, 'Delete'), '@alpha ');
});

test('칩이 아닌 자리·글자는 기본 동작(null)', () => {
  assert.equal(del('@alpha hello', 12, 'Backspace'), null); // 글 끝
  assert.equal(del('@alpha hello', 3, 'Backspace'), null); // 칩 안
  assert.equal(del('@alpha hello', 6, 'Delete'), null); // 칩 뒤의 Delete
  assert.equal(del('@alpha  hello', 8, 'Backspace'), null); // 빈칸 둘 뒤
  assert.equal(del('@alpha hello', 6, 'Enter'), null);
  assert.equal(del('@alpha hello', 0, 'Backspace', 6), null); // 고른 글이 있으면 기본 동작
  assert.equal(del('hello', 5, 'Backspace'), null);
});

test('판에 없는 이름(치는 중인 @al, 오타)은 한 글자씩', () => {
  assert.equal(del('@al', 3, 'Backspace'), null);
  assert.equal(del('@alpah hi', 6, 'Backspace'), null);
  assert.equal(del('@alpha @zz hi', 10, 'Backspace'), null);
  assert.equal(del('@alpha @zz hi', 6, 'Backspace'), '@zz hi');
});

test('글 사이 칩(판에 있는 이름)도 지우고, 메일 주소의 @는 칩이 아니다', () => {
  assert.equal(del('@beta ask @alpha now', 16, 'Backspace'), '@beta ask now');
  assert.equal(del('@beta ask @alpha now', 10, 'Delete'), '@beta ask now');
  assert.equal(del('@beta mail me@alpha', 19, 'Backspace'), null);
  assert.equal(del('@beta mail @nobody', 18, 'Backspace'), null); // 글 중간의 없는 이름은 칩이 아니다
});

test('여러 줄: 줄바꿈은 함께 지우지 않는다', () => {
  assert.equal(del('@alpha\nhello', 6, 'Backspace'), '\nhello');
  assert.equal(del('first\n@alpha hi', 12, 'Backspace'), 'first\nhi');
  assert.equal(del('@beta line1\n@alpha', 18, 'Backspace'), '@beta line1\n');
  assert.equal(del('@alpha\nhello', 7, 'Backspace'), null); // 줄 첫머리(줄바꿈 뒤)는 기본 동작
});

test('명령줄: 한글 조합 중·Ctrl/Alt 조합은 칩 지우기를 하지 않고, 되돌리기에 남게 execCommand로 지운다', () => {
  const s = src('CommandBar.jsx');
  const i = s.indexOf('tagDeleteRange(el.value');
  assert.ok(i > 0);
  assert.match(s, /if \(e\.nativeEvent\.isComposing\) return;/);
  const block = s.slice(s.lastIndexOf("(e.key === 'Backspace'", i), i + 400);
  assert.match(block, /e\.keyCode !== 229/);
  assert.match(block, /!e\.ctrlKey && !e\.altKey && !e\.metaKey/);
  assert.match(block, /execCommand\('delete'\)/);
});

test('판 ↔ 세션 맵 전환 규칙(P153 7차)은 그대로', () => {
  assert.equal(switchText('@alpha '), '');
  assert.equal(switchText('@alpha hi'), '@alpha hi');
  assert.equal(switchText('hi'), 'hi');
  assert.equal(toggleTag('', 'alpha'), '@alpha ');
  // 칩을 지우고 남은 글도 같은 규칙을 따른다
  assert.equal(switchText(del('@alpha @beta ', 13, 'Backspace')), '');
});

test('세션 맵: 줄 머리 끌기는 Alt+마우스 왼쪽일 때만 옮기기, 그 밖은 시점 이동', () => {
  assert.equal(headDrag({ onHead: true, altKey: true }), 'row');
  assert.equal(headDrag({ onHead: true, altKey: false }), 'pan');
  assert.equal(headDrag({ onHead: false, altKey: true }), 'pan');
  assert.equal(headDrag({ onHead: false, altKey: false }), 'pan');
  assert.equal(headDrag({ onHead: true, altKey: true, button: 2 }), 'pan');
  assert.equal(headDrag({ onHead: true, altKey: true, pointerType: 'touch' }), 'pan');
  assert.equal(headDrag({ onHead: true, altKey: true, pointerType: 'pen' }), 'pan');
  assert.equal(headDrag(), 'pan');
});

test('세션 맵: 줄 머리 누르기가 headDrag를 거치고, Esc 취소·Alt 표시·메뉴 초점 막기가 있다', () => {
  const s = src('MissionLineage.jsx');
  assert.match(s, /head && !pts\.size && headDrag\(\{ onHead: true, altKey: e\.altKey, button: e\.button, pointerType: e\.pointerType \}\) === 'row'/);
  assert.match(s, /e\.key === 'Escape' && g && g\.mode === 'row'.*endRow\(false\)/);
  assert.match(s, /el\.dataset\.alt = '1'/);
  assert.match(s, /addEventListener\('keyup', altKey, true\)/);
  assert.match(s, /if \(e\.key !== 'Alt'\) return;/);
  // 끄기가 시작된 뒤 Alt를 떼도 row 모드는 그대로(move의 row 갈래는 altKey를 보지 않는다)
  const mv = s.slice(s.indexOf("if (g.mode === 'row') {"), s.indexOf("const p = [...pts.values()];", s.indexOf("if (g.mode === 'row') {")));
  assert.doesNotMatch(mv, /altKey/);
  const css = src('styles.css');
  assert.match(css, /\.mt-ta-vp\[data-alt="1"\] \.mt-sm-head \{ cursor: move; \}/);
});

test('도움말 글: 두 사전 모두 Alt+끌기', () => {
  assert.match(en.mmTerr.isleTip, /Alt\+drag/);
  assert.match(ko.mmTerr.isleTip, /Alt\+끌기로 다른 폴더로 옮기기/);
  assert.match(en.mmTerr.isleTip, /\{ws\}/);
  assert.match(ko.mmTerr.isleTip, /\{ws\}/);
});
