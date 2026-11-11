// P59 창 쪽 순수 함수와 사전: 연결 기록의 새 일(등록 허가, 패스키 로그인, 로그아웃)과 앞말이 있는 까닭(passkey:, tailscale_node:),
// Tailscale 기기 이름, 웹 화면이 짝 맺기 화면에 보일 까닭 글(두 사전에 모두)
import test from 'node:test';
import assert from 'node:assert/strict';
import { logRow, reasonKeys, LOG_EVENTS } from '../src/renderer/lib/remote.js';
import { connInit, connStep, retryDelay, CLOSE_REVOKED, CLOSE_BLOCKED } from '../src/renderer/lib/reconnect.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

test('연결 기록 줄: 새 일과 Tailscale 기기 이름, 앞말이 있는 까닭의 열쇠', () => {
  for (const ev of ['pair.grant', 'login', 'logout']) assert.ok(LOG_EVENTS.includes(ev), ev);
  assert.equal(logRow({ event: 'login' }).key, 'remoteLog.ev_login');
  assert.equal(logRow({ event: 'pair.grant' }).key, 'remoteLog.ev_pair_grant');
  assert.equal(logRow({ event: 'connect', deviceName: 'Chrome · Windows', node: 'laptop-a', login: 'me@example.com', addr: '100.64.0.2' }).who, 'Chrome · Windows · laptop-a · me@example.com · 100.64.0.2');
  assert.equal(logRow({ event: 'connect', deviceName: 'laptop-a', node: 'laptop-a' }).who, 'laptop-a', '같은 이름은 한 번');
  assert.equal(logRow({ event: 'deny', reason: 'tailscale_node:other_node' }).bad, true);
  assert.deepEqual(reasonKeys('tailscale_node:other_node'), { full: 'remoteLog.reason_tailscale_node_other_node', prefix: 'remoteLog.reason_tailscale_node', rest: 'other_node' });
  assert.deepEqual(reasonKeys('no_session'), { full: 'remoteLog.reason_no_session', prefix: null, rest: null });
});

test('사전: 새 기록 글과 짝 맺기 화면의 Tailscale 기기 까닭이 두 언어에 모두 있다', () => {
  const keys = ['ev_pair_grant', 'ev_login', 'ev_logout', 'reason_no_session', 'reason_session', 'reason_bad_grant', 'reason_grant_node', 'reason_passkey', 'reason_tailscale_node', 'reason_other_node', 'reason_local_only', 'reason_not_bound', 'reason_whois_failed'];
  for (const d of [en, ko]) {
    for (const k of keys) assert.equal(typeof d.remoteLog[k], 'string', k);
    for (const r of ['other_node', 'other_user', 'local_only', 'not_bound', 'login_mismatch', 'unknown']) assert.equal(typeof d.pair[`node_${r}`], 'string', r);
    assert.equal(typeof d.pair.grantNode, 'string');
  }
});

test('웹 화면 연결 상태: 세션 끝·짝 풀림(4401)은 곧바로 다시 물어 화면을 고르고, 원격 막음(4403)은 막음 화면, PC에서 끊음(4402)은 곧 다시 붙어 본다', () => {
  const open = connStep(connInit(), { type: 'open' });
  const revoked = connStep(open, { type: 'close', code: CLOSE_REVOKED });
  assert.equal(revoked.phase, 'unpaired'); assert.equal(retryDelay(revoked), null, '곧바로(backend()가 /web/me로 다시 확인·짝 맺기를 고른다)');
  assert.equal(connStep(open, { type: 'close', code: CLOSE_BLOCKED }).phase, 'blocked');
  const kicked = connStep(open, { type: 'close', code: 4402 });
  assert.equal(kicked.phase, 'reconnecting'); assert.ok(retryDelay(kicked, { rand: 0.5 }) <= 1000);
});
