// P47 창 쪽 순수 함수: 클라이언트 ID, 연결 주소 값, 다른 기기 세기, 알림 고르기, 비율 그리기, 입력 표시
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIdOf, clientQuery, otherDevices, notifyAllowed, fitScale, inputByLabel } from '../src/renderer/lib/multiclient.js';

test('P47 클라이언트 ID: 저장한 값이 쓸 만하면 그대로, 아니면 새로', () => {
  assert.equal(clientIdOf('c-abcd1234', 'zzz'), 'c-abcd1234');
  assert.equal(clientIdOf(null, '1b4e28ba-2fa1-11d2-883f-0016d3cca427'), 'c-1b4e28ba2fa111d2');
  assert.equal(clientIdOf('<bad id>', 'xyz12345'), 'c-xyz12345');
});

test('P47 연결 주소 값', () => {
  assert.equal(clientQuery({ clientId: 'c-1', name: 'My PC', kind: 'desktop' }), 'client=c-1&name=My+PC&kind=desktop');
  assert.equal(clientQuery({}), '');
});

test('P47 다른 기기: 나, 트레이, CLI는 세지 않는다', () => {
  const peers = { me: 'a', clients: [{ clientId: 'a', kind: 'desktop' }, { clientId: 'b', kind: 'desktop' }, { clientId: 'w', kind: 'web' }, { clientId: 't', kind: 'tray' }] };
  assert.deepEqual(otherDevices(peers).map((c) => c.clientId), ['b', 'w']);
  assert.deepEqual(otherDevices(null), []);
});

test('P47 알림: 백엔드가 고른 클라이언트만', () => {
  assert.deepEqual(notifyAllowed({ me: 'a', notify: 'a' }), { allowed: true, reason: null });
  assert.deepEqual(notifyAllowed({ me: 'a', notify: 'b' }), { allowed: false, reason: 'other-client' });
  // 옛 백엔드(고르지 않음)나 목록이 아직 없으면 예전처럼 띄운다
  assert.equal(notifyAllowed(null).allowed, true);
  assert.equal(notifyAllowed({ me: 'a', notify: null }).allowed, true);
});

test('P47 비율 그리기: 잘리지 않게 작은 비율, 거의 같으면 1', () => {
  assert.equal(fitScale({ termW: 1000, termH: 600, boxW: 500, boxH: 400 }), 0.5);
  assert.equal(fitScale({ termW: 500, termH: 300, boxW: 1000, boxH: 450 }), 1.5);
  assert.equal(fitScale({ termW: 1000, termH: 600, boxW: 1005, boxH: 604 }), 1);
  assert.equal(fitScale({ termW: 0, termH: 600, boxW: 10, boxH: 10 }), 1);
  assert.equal(fitScale({ termW: 10000, termH: 6000, boxW: 100, boxH: 100 }), 0.2);
});

test('P47 다른 기기 입력 표시: 내 것은 보이지 않는다', () => {
  assert.equal(inputByLabel({ clientId: 'b', name: 'Laptop' }, 'a'), 'Laptop');
  assert.equal(inputByLabel({ clientId: 'a', name: 'PC' }, 'a'), null);
  assert.equal(inputByLabel({ clientId: 'b' }, 'a'), 'b');
});
