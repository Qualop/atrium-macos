// P135 창 단위 시험: 다시 붙은 직후·첫 프레임 전의 휠, 마우스 보고 거르기(lib/term-input.js wheelAction, filterMouse)
import test from 'node:test';
import assert from 'node:assert/strict';
import { wheelAction, filterMouse, wheelToSgr, REPORT_BUDGET } from '../src/renderer/lib/term-input.js';

test('P135 첫 프레임 전(새로 붙는 중)과 다시 붙어 첫 full 프레임을 기다리는 동안은 휠을 삼킨다', () => {
  assert.equal(wheelAction({ modesKnown: false, mouseTrackingMode: 'none', framed: false }), 'swallow');
  assert.equal(wheelAction({ modesKnown: true, mouseTrackingMode: 'any', framed: false }), 'swallow', '옛 모드가 남아 있어도');
  // 첫 프레임 뒤는 P126 그대로
  assert.equal(wheelAction({ modesKnown: true, mouseTrackingMode: 'any', framed: true }), 'report');
  assert.equal(wheelAction({ modesKnown: true, mouseTrackingMode: 'none', framed: true }), 'swallow');
  assert.equal(wheelAction({ modesKnown: false, mouseTrackingMode: 'none', framed: true }), 'report', '모드를 적지 않는 서버');
});

test('P135 단추 없는 마우스 움직임 보고(1003)는 빼고, 누르기·끌기·휠·글자는 남긴다', () => {
  const hover = '\x1b[<35;10;5M', hoverShift = '\x1b[<39;10;5M', drag = '\x1b[<32;10;5M', down = '\x1b[<0;3;4M', up = '\x1b[<0;3;4m', wheel = '\x1b[<65;101;61M';
  const f = filterMouse(`a${hover}${hoverShift}b${drag}${down}${up}${wheel}한`);
  assert.equal(f.data, `ab${drag}${down}${up}${wheel}한`);
  assert.equal(f.hover, 2);
  assert.equal(f.bytes, drag.length + down.length + up.length + wheel.length);
  // X10 꼴(ESC[M + 세 바이트): 단추 없는 움직임은 32+3+32 = 67('C')
  const x10hover = '\x1b[MC!!', x10down = '\x1b[M !!';
  assert.equal(filterMouse(`${x10hover}${x10down}`).data, x10down);
  // 보고가 없는 글은 그대로
  assert.deepEqual(filterMouse('hello\r'), { data: 'hello\r', bytes: 0, hover: 0, held: 0 });
  assert.equal(filterMouse('\x1b[A\x1b[I').data, '\x1b[A\x1b[I', '화살표·초점 알림은 손대지 않는다');
});

test('P135 프로그램이 그리기 전 보고는 REPORT_BUDGET바이트까지만(콘솔 호스트가 멈춘 동안 4096바이트 넘게 쌓이지 않게)', () => {
  const one = '\x1b[<65;101;61M';
  let unacked = 0, sent = 0, held = 0;
  for (let i = 0; i < 400; i++) { const f = filterMouse(one, { room: REPORT_BUDGET - unacked }); unacked += f.bytes; sent += f.bytes / one.length; held += f.held; }
  assert.equal(sent, Math.floor(REPORT_BUDGET / one.length));
  assert.equal(held, 400 - sent);
  assert.ok(unacked <= REPORT_BUDGET && REPORT_BUDGET < 4096);
  // 프레임이 오면(unacked = 0) 다시 보낸다
  assert.equal(filterMouse(one, { room: REPORT_BUDGET }).data, one);
  // 한 번에 여러 칸(wheelToSgr 최대 5개)은 자리만큼만 남기고 글자는 늘 남긴다
  const five = wheelToSgr({ deltaY: 500, clientX: 50, clientY: 50, rect: { left: 0, top: 0, width: 100, height: 100 }, cols: 80, rows: 24 }).seq;
  assert.equal(five.split('\x1b').length - 1, 5);
  const part = filterMouse(`x${five}y`, { room: one.length * 2 });
  assert.equal(part.held, 3);
  assert.ok(part.data.startsWith('x') && part.data.endsWith('y'));
});
