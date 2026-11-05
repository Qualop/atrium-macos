// P51 시험: 셸 노드 여러 줄 붙여넣기(#3, wrapPaste shell), 셸 노드 휠 줄 수와 작은 값 모으기(#7, shellWheelLines)
import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapPaste, wheelSteps, shellWheelLines, wheelToSgr, SHIFT_ENTER, SHELL_WHEEL_LINES, PASTE_START, PASTE_END } from '../src/renderer/lib/term-input.js';

test('P51 #3: 셸 노드 붙여넣기는 줄바꿈을 Shift+Enter(win32-input-mode)로 바꿔 CR을 보내지 않는다', () => {
  const s = wrapPaste('echo a\r\necho b\necho c', { shell: true, platform: 'win32' });
  assert.equal(s, `${PASTE_START}echo a${SHIFT_ENTER}echo b${SHIFT_ENTER}echo c${PASTE_END}`);
  assert.ok(!s.includes('\r') && !s.includes('\n'), 'CR·LF가 없어야 셸이 줄마다 제출하지 않는다');
  // Shift+Enter 키 누름과 뗌: Vk 13(Enter), Sc 28, Uc 13, Cs 16(SHIFT_PRESSED)
  assert.equal(SHIFT_ENTER, '\x1b[13;28;13;1;16;1_\x1b[13;28;13;0;16;1_');
  // 한 줄은 그대로, 빈 글은 보내지 않고, 감싸기 끝 표시는 지운다
  assert.equal(wrapPaste('dir', { shell: true, platform: 'win32' }), `${PASTE_START}dir${PASTE_END}`);
  assert.equal(wrapPaste('', { shell: true, platform: 'win32' }), '');
  assert.equal(wrapPaste('a\x1b[201~\rb', { shell: true, platform: 'win32' }), `${PASTE_START}a${SHIFT_ENTER}b${PASTE_END}`);
});

test('P51 #3: Claude 등 에이전트 노드 붙여넣기는 그대로(CR, 입력칸에 여러 줄로 들어간다)', () => {
  assert.equal(wrapPaste('a\r\nb'), `${PASTE_START}a\rb${PASTE_END}`);
  assert.equal(wrapPaste('a\r\nb', { shell: false }), `${PASTE_START}a\rb${PASTE_END}`);
});

test('P51 #7: 셸 휠은 한 칸(100px)에 3줄, 작은 값 여럿은 합한 거리만큼', () => {
  assert.equal(SHELL_WHEEL_LINES, 3);
  assert.deepEqual(shellWheelLines({ deltaY: -100 }).lines, -3);
  assert.deepEqual(shellWheelLines({ deltaY: 300 }).lines, 9);
  // deltaY 10을 열 번 = 100px 한 번 = 3줄(모으지 않으면 10줄)
  let acc = 0, lines = 0;
  for (let k = 0; k < 10; k++) { const r = shellWheelLines({ deltaY: -10, acc }); acc = r.acc; lines += r.lines; }
  assert.equal(lines, -3);
  // 한 번의 작은 값은 줄을 움직이지 않고 모아 둔다
  const one = shellWheelLines({ deltaY: 10 });
  assert.equal(one.lines, 0);
  assert.ok(Math.abs(one.acc - 0.3) < 1e-9);
});

test('P51 #7: 줄 단위·쪽 단위 휠, 방향이 바뀌면 모은 값이 상쇄된다', () => {
  assert.equal(shellWheelLines({ deltaY: 2, deltaMode: 1 }).lines, 2);
  assert.equal(shellWheelLines({ deltaY: 1, deltaMode: 2, rows: 18 }).lines, 18);
  const a = shellWheelLines({ deltaY: 20 }); // 0.6줄
  const b = shellWheelLines({ deltaY: -20, acc: a.acc });
  assert.equal(b.lines, 0);
  assert.ok(Math.abs(b.acc) < 1e-9);
});

test('P51: wheelSteps를 나눠 쓴 뒤에도 Claude 노드 SGR 휠은 100px에 한 번', () => {
  assert.equal(wheelSteps({ deltaY: 250 }).steps, 2);
  assert.equal(wheelSteps({ deltaY: -3, deltaMode: 1 }).steps, -3);
  const rect = { left: 0, top: 0, width: 1000, height: 600 };
  assert.equal(wheelToSgr({ deltaY: 100, clientX: 0, clientY: 0, rect, cols: 100, rows: 30 }).seq, '\x1b[<65;1;1M');
  assert.equal(wheelToSgr({ deltaY: 1, deltaMode: 2, clientX: 0, clientY: 0, rect, cols: 100, rows: 30 }).seq, '\x1b[<65;1;1M'.repeat(5));
});

test('POSIX shells and remote POSIX backends retain bracketed CR multiline paste', () => {
  for (const platform of ['darwin', 'linux', null]) {
    const result = wrapPaste('echo first\r\necho second\necho third', { shell: true, platform });
    assert.equal(result, `${PASTE_START}echo first\recho second\recho third${PASTE_END}`);
    assert.ok(!result.includes(SHIFT_ENTER));
  }
  assert.equal(wrapPaste('a\nb', { shell: true }), wrapPaste('a\nb', { shell: true, platform: process.platform }));
});

test('Cmd copy/paste and IME composition retain their keyboard semantics', async () => {
  const { keyAction } = await import('../src/renderer/lib/term-input.js');
  assert.equal(keyAction({ type: 'keydown', key: 'c', metaKey: true }, true), 'copy');
  assert.equal(keyAction({ type: 'keydown', key: 'v', metaKey: true }, false), 'paste');
  assert.equal(keyAction({ type: 'keydown', key: 'Escape', isComposing: true }, true), 'pass');
  assert.equal(keyAction({ type: 'keydown', key: 'Escape', keyCode: 229 }, true), 'pass');
});
