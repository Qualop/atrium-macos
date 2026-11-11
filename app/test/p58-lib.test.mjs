// P58(원격 강화 S4) 창 쪽 순수 함수: 붙음 알림 글과 방식, 알약의 끊기 대상, 연결 기록 줄, 웹 화면의 원격 막음 상태
import test from 'node:test';
import assert from 'node:assert/strict';
import { noticeOf, noticeWay, isDeviceClient, logRow, isBlockedClose } from '../src/renderer/lib/remote.js';
import { connInit, connStep, retryDelay, showBanner, CLOSE_BLOCKED } from '../src/renderer/lib/reconnect.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';
import { translate } from '../src/renderer/lib/i18n.js';

test('붙음 알림: 짝 맺음·원격·이 PC 글, 로그인과 브라우저는 덧붙임, OS 알림은 창이 숨었거나 초점이 없을 때만', () => {
  assert.deepEqual(noticeOf({ kind: 'connected', device: { id: 'd', name: '노트북' }, remote: true, login: 'user@example.com', browser: 'Chrome 130 · Windows' }), { key: 'remoteNotice.connectedRemote', vars: { name: '노트북' }, detail: 'user@example.com · Chrome 130 · Windows' });
  assert.equal(noticeOf({ kind: 'paired', device: { name: 'x' }, remote: true }).key, 'remoteNotice.paired');
  assert.equal(noticeOf({ kind: 'connected', device: { name: 'x' }, remote: false }).key, 'remoteNotice.connected');
  assert.equal(noticeOf({}), null);
  assert.equal(translate('ko', 'remoteNotice.connectedRemote', { name: '노트북' }), '노트북 기기가 원격으로 연결되었습니다.');
  assert.deepEqual(noticeWay({ visible: true, focused: true }), { toast: true, os: false });
  assert.equal(noticeWay({ visible: false, focused: false }).os, true);
  assert.equal(noticeWay({ visible: true, focused: false }).os, true);
});

test('알약: 짝 맺은 기기로 붙은 웹 클라이언트만 끊기·짝 풀기를 보인다', () => {
  assert.equal(isDeviceClient({ kind: 'web', deviceId: 'd1' }), true);
  assert.equal(isDeviceClient({ kind: 'web', deviceId: null }), false);
  assert.equal(isDeviceClient({ kind: 'desktop', deviceId: 'd1' }), false);
});

test('연결 기록 줄: 일 열쇠, 까닭, 누구(기기·로그인·주소), 합친 수, 거부는 눈에 띄게', () => {
  const r = logRow({ at: 1, event: 'deny', reason: 'login_other_user', deviceName: 'Laptop', login: 'user@example.com', addr: '100.64.0.2', remote: true, count: 3 });
  assert.deepEqual(r, { key: 'remoteLog.ev_deny', reason: 'login_other_user', who: 'Laptop · user@example.com · 100.64.0.2', browser: null, remote: true, count: 3, bad: true });
  assert.equal(logRow({ event: 'remote.block' }).key, 'remoteLog.ev_remote_block');
  assert.equal(logRow({ event: 'weird' }).key, 'remoteLog.ev_other');
  assert.equal(logRow({ event: 'connect', remote: false }).remote, false);
  // 모든 일과 백엔드가 쓰는 까닭에 글이 있다(영어·한국어)
  for (const ev of ['pair.request', 'pair.ok', 'pair.fail', 'connect', 'disconnect', 'deny', 'unpair', 'kick', 'remote.block', 'remote.allow', 'other']) {
    const k = logRow({ event: ev }).key.split('.')[1];
    assert.ok(en.remoteLog[k] && ko.remoteLog[k], k);
  }
  for (const r2 of ['host', 'origin', 'login_other_user', 'login_no_login', 'login_self_unknown', 'device_token', 'no_credentials', 'api_token', 'not_local', 'remote_blocked', 'bad_code', 'no_code', 'rate_limited', 'denied', 'closed', 'pc', 'revoked', 'blocked', 'path']) {
    assert.ok(en.remoteLog[`reason_${r2}`] && ko.remoteLog[`reason_${r2}`], r2);
  }
});

test('웹 화면: 4403이나 remote_blocked면 막음 상태(띠 대신 막음 화면), 백오프로 계속 다시 붙고, 열리면 돌아온다. 4402는 보통 끊김', () => {
  let s = connStep(connInit(), { type: 'open' });
  s = connStep(s, { type: 'close', code: CLOSE_BLOCKED });
  assert.equal(s.phase, 'blocked'); assert.equal(showBanner(s), false);
  assert.ok(retryDelay(s, { rand: 0.5 }) > 0, '다시 붙어 본다');
  const s2 = connStep(s, { type: 'close', code: 'remote_blocked' });
  assert.equal(s2.phase, 'blocked'); assert.equal(s2.attempt, s.attempt + 1);
  assert.equal(connStep(s2, { type: 'open' }).phase, 'open');
  const k = connStep(connStep(connInit(), { type: 'open' }), { type: 'close', code: 4402 });
  assert.equal(k.phase, 'reconnecting'); assert.equal(showBanner(k), true);
  assert.ok(isBlockedClose(4403) && isBlockedClose('remote_blocked') && !isBlockedClose(4402));
});
