// P126 창 단위 시험: 노드 위 휠을 마우스 보고로 보낼지(lib/term-input.js wheelAction, setsMouseMode)
import test from 'node:test';
import assert from 'node:assert/strict';
import { wheelAction, setsMouseMode, MOUSE_MODES } from '../src/renderer/lib/term-input.js';
import { deliveryText } from '../src/renderer/lib/labels.js';

test('P126 마우스 모드를 아는 터미널(hc 판): 마우스 추적이 꺼져 있으면 휠을 보내지 않고 삼킨다, 켜져 있으면 보낸다', () => {
  assert.equal(wheelAction({ modesKnown: true, mouseTrackingMode: 'none' }), 'swallow');
  for (const m of ['x10', 'vt200', 'drag', 'any']) assert.equal(wheelAction({ modesKnown: true, mouseTrackingMode: m }), 'report', m);
});

test('P126 마우스 모드를 모르는 터미널(모드를 적지 않는 서버: 다시 그린 화면만 와서 xterm은 늘 none): 예전처럼 보낸다', () => {
  assert.equal(wheelAction({ modesKnown: false, mouseTrackingMode: 'none' }), 'report');
  assert.equal(wheelAction({}), 'report');
});

test('P126 DECSET·DECRST 인자에 마우스 모드가 있는가(hc 전체 프레임은 ?1000l…?1006l 뒤 지금 모드를 다시 켠다)', () => {
  // hc가 주는 전체 프레임 머리의 모드 줄(실제로 받은 것): ?1000l ?1003h ?1006h ?2004h ?9001h 등
  assert.equal(setsMouseMode([1000]), true);
  assert.equal(setsMouseMode([1003]), true);
  assert.equal(setsMouseMode([1006]), true);
  assert.equal(setsMouseMode([1049]), false, '대체 화면');
  assert.equal(setsMouseMode([2004]), false, '괄호 붙여넣기');
  assert.equal(setsMouseMode([25, 1004]), false, '커서·초점');
  assert.equal(setsMouseMode([9001]), false, 'win32-input-mode');
  assert.equal(setsMouseMode([2026, [1002]]), true, '하위 인자 배열');
  assert.equal(setsMouseMode([]), false);
  assert.ok(MOUSE_MODES.includes(9) && MOUSE_MODES.includes(1015));
});

test('P126 전달 칩: 입력란에 다른 글이 있어 제출되지 않음', () => {
  const s = deliveryText({ status: 'unconfirmed', reason: 'input_box_other' });
  assert.ok(!s.includes('input_box_other'), s);
});
