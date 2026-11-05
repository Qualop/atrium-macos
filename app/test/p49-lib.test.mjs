// P49(원격 R3) 창 쪽 순수 함수: 다시 연결 상태 바꾸기·백오프·ping 시간 넘김·지연 표시, 웹 화면 배율, 웹 클라이언트 연결 주소, 알림 고르기
import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs, connInit, connStep, retryDelay, showBanner, pingTimedOut, rttLabel, BACKOFF_MAX_MS, CLOSE_REVOKED } from '../src/renderer/lib/reconnect.js';
import { webZoomOf } from '../src/renderer/lib/scale.js';
import { clientQuery, notifyAllowed } from '../src/renderer/lib/multiclient.js';

test('백오프: 0.5초부터 두 배, 상한, 흔들기 ±20%', () => {
  assert.equal(backoffMs(0, 0.5), 500);
  assert.equal(backoffMs(1, 0.5), 1000);
  assert.equal(backoffMs(3, 0.5), 4000);
  assert.equal(backoffMs(30, 0.5), BACKOFF_MAX_MS);
  assert.equal(backoffMs(0, 0), 400); assert.equal(backoffMs(0, 1), 600);
  assert.equal(backoffMs(10, 0.5, 2000), 2000, 'PC 창 상한');
});

test('다시 연결 상태: 처음은 띠 없음, 열렸다 끊기면 띠, 다시 열리면 처음부터, 4401은 짝 맺기', () => {
  let s = connInit();
  assert.equal(showBanner(s), false);
  s = connStep(s, { type: 'close', code: 1006 });
  assert.equal(s.phase, 'connecting'); assert.equal(showBanner(s), false, '처음 붙기 전에는 띠를 보이지 않는다');
  s = connStep(s, { type: 'open' });
  assert.equal(s.phase, 'open'); assert.equal(s.attempt, 0); assert.equal(retryDelay(s), null);
  s = connStep(s, { type: 'close', code: 1006 }, 1000);
  assert.equal(s.phase, 'reconnecting'); assert.equal(showBanner(s), true); assert.equal(s.attempt, 0); assert.equal(s.since, 1000);
  assert.equal(retryDelay(s, { rand: 0.5 }), 500);
  s = connStep(s, { type: 'close', code: 'backend' }, 2000);
  s = connStep(s, { type: 'close', code: 'backend' }, 3000);
  assert.equal(s.attempt, 2); assert.equal(s.since, 1000, '끊긴 때는 처음 끊긴 때');
  assert.equal(retryDelay(s, { rand: 0.5 }), 2000);
  assert.equal(retryDelay(s, { wake: true }), 0, '깨어남·온라인은 곧바로');
  s = connStep(s, { type: 'open' });
  assert.equal(showBanner(s), false); assert.equal(s.since, null);
  s = connStep(s, { type: 'close', code: CLOSE_REVOKED });
  assert.equal(s.phase, 'unpaired'); assert.equal(showBanner(s), false); assert.equal(retryDelay(s), null);
});

test('ping 시간 넘김과 지연 표시(가운데 값)', () => {
  assert.equal(pingTimedOut(null, 10_000), false);
  assert.equal(pingTimedOut(1000, 5000, 8000), false);
  assert.equal(pingTimedOut(1000, 9001, 8000), true);
  assert.equal(rttLabel([]), null);
  assert.equal(rttLabel([7.4]), 7);
  assert.equal(rttLabel([7, 8, 300, 9, 7]), 8, '튀는 값 하나에 흔들리지 않는다');
});

test('웹 화면 배율과 웹 클라이언트 연결 값', () => {
  assert.equal(webZoomOf('1.2'), 1.2); assert.equal(webZoomOf(null), 1); assert.equal(webZoomOf('3'), 1); assert.equal(webZoomOf('x'), 1);
  assert.equal(clientQuery({ clientId: 'c-abc12345', name: 'Laptop', kind: 'web' }), 'client=c-abc12345&name=Laptop&kind=web');
  // 웹 알림도 같은 고르기를 따른다
  assert.deepEqual(notifyAllowed({ me: 'web-1', notify: 'pc-1' }), { allowed: false, reason: 'other-client' });
  assert.deepEqual(notifyAllowed({ me: 'web-1', notify: 'web-1' }), { allowed: true, reason: null });
});
