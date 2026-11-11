// P88 단위 시험: 웹 푸시의 화면 쪽 순수 함수(lib/push.js). 지원 판단(iOS는 홈 화면 앱만), 서비스 워커의 알림 만들기와 누르면 열 주소,
// VAPID 키 바꾸기, 시트의 상태 줄, 연결 기록 줄(push.*). 서비스 워커는 API·로그인 응답을 여전히 캐시하지 않는다(P76 규칙)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pushSupport, keyBytes, notificationOf, clickUrl, openParam, pushLine, failKey, PUSH_KINDS } from '../src/renderer/lib/push.js';
import { logRow } from '../src/renderer/lib/remote.js';
import { swRoute } from '../src/renderer/lib/sw-rules.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const full = { hasSW: true, hasPush: true, hasNotification: true, secure: true, ios: false, standalone: false };
test('지원 판단: iOS는 홈 화면 앱에서만, https가 아니면 안 됨, 서비스 워커·PushManager·Notification이 다 있어야', () => {
  assert.equal(pushSupport(full), 'ok');
  assert.equal(pushSupport({ ...full, ios: true, standalone: false, hasPush: false }), 'install');
  assert.equal(pushSupport({ ...full, ios: true, standalone: true }), 'ok');
  assert.equal(pushSupport({ ...full, secure: false }), 'insecure');
  assert.equal(pushSupport({ ...full, hasPush: false }), 'unsupported');
  assert.equal(pushSupport({ ...full, hasNotification: false }), 'unsupported');
  assert.equal(pushSupport({ ...full, hasSW: false }), 'unsupported');
});

test('VAPID 공개 키(base64url) → 65바이트', () => {
  const raw = Buffer.alloc(65, 7); raw[0] = 4;
  const k = keyBytes(raw.toString('base64url'));
  assert.equal(k.length, 65);
  assert.deepEqual([...k], [...raw]);
});

test('알림 만들기: 제목·본문을 자르고, 세션 ID를 확인하고, 모르는 본문이면 앱 이름만', () => {
  const n = notificationOf({ v: 1, title: '@alpha · 끝남', body: 'repo', tag: 'atrium-s1', sessionId: 's1', kind: 'done' });
  assert.equal(n.title, '@alpha · 끝남');
  assert.deepEqual(n.options, { body: 'repo', tag: 'atrium-s1', icon: 'assets/brand/atrium-icon.svg', data: { sessionId: 's1', kind: 'done' } });
  const bad = notificationOf({ v: 1, title: 'x'.repeat(500), body: 'a\nb', tag: '<script>', sessionId: '../../x' });
  assert.equal(bad.title.length, 120);
  assert.equal(bad.options.body, 'a b');
  assert.equal(bad.options.tag, 'atrium');
  assert.equal(bad.options.data.sessionId, null);
  for (const m of [null, 'text', { title: 'no version' }, 42]) assert.equal(notificationOf(m).title, 'Atrium');
});

test('누르면 열 주소: 세션이 있으면 ?open=<ID>, 없거나 이상하면 앱 첫 화면. 시작 주소에서 다시 읽기', () => {
  const scope = 'https://pc.example.ts.net:8443/';
  assert.equal(clickUrl({ sessionId: 'a1-b2' }, scope), `${scope}?open=a1-b2`);
  assert.equal(clickUrl({ sessionId: 'javascript:alert(1) ' }, scope), scope);
  assert.equal(clickUrl(null, scope), scope);
  assert.equal(openParam('?open=a1-b2'), 'a1-b2');
  assert.equal(openParam('?open=%3Cx%3E'), null);
  assert.equal(openParam(''), null);
  // 서비스 워커는 ?open= 화면 주소를 껍데기로만 다룬다. API·로그인은 여전히 손대지 않는다
  assert.equal(swRoute({ url: `${scope}?open=a1`, origin: 'https://pc.example.ts.net:8443', mode: 'navigate' }), 'shell');
  for (const p of ['api', 'web/me', 'web/passkey/login']) assert.equal(swRoute({ url: `${scope}${p}`, origin: 'https://pc.example.ts.net:8443' }), 'pass');
});

test('시트 상태 줄과 실패 글의 열쇠, 사전에 모두 있다', () => {
  assert.equal(pushLine({ support: 'install' }), 'push.support_install');
  assert.equal(pushLine({ support: 'ok', permission: 'denied', status: null }), 'push.denied');
  assert.equal(pushLine({ support: 'ok', permission: 'granted', status: { on: true } }), 'push.on');
  assert.equal(pushLine({ support: 'ok', permission: 'granted', status: { on: false, gone: true } }), 'push.gone');
  assert.equal(pushLine({ support: 'ok', permission: 'default', status: null }), 'push.off');
  assert.equal(pushLine({ support: 'ok', busy: true }), 'push.busy');
  const keys = ['push.support_install', 'push.support_insecure', 'push.support_unsupported', 'push.denied', 'push.on', 'push.off', 'push.gone', 'push.busy', failKey('denied'), failKey('bad_endpoint'), failKey('subscribe'), failKey('x'), ...PUSH_KINDS.map((k) => `push.kind_${k}`)];
  const get = (d, k) => k.split('.').reduce((o, x) => (o ? o[x] : undefined), d);
  for (const k of keys) { assert.equal(typeof get(en, k), 'string', k); assert.equal(typeof get(ko, k), 'string', k); }
});

test('연결 기록 줄: push.on은 푸시 서비스 이름, push.fail은 나쁜 줄, 사전 열쇠는 push.ev_*', () => {
  const on = logRow({ at: 1, event: 'push.on', deviceName: 'iPhone', host: 'web.push.apple.com' });
  assert.equal(on.key, 'push.ev_on');
  assert.equal(on.host, 'web.push.apple.com');
  assert.equal(on.bad, false);
  const fail = logRow({ at: 1, event: 'push.fail', reason: 'http_500' });
  assert.equal(fail.key, 'push.ev_fail');
  assert.equal(fail.bad, true);
  assert.equal(logRow({ at: 1, event: 'push.off', reason: 'gone_410' }).key, 'push.ev_off');
  for (const k of ['ev_on', 'ev_off', 'ev_fail']) { assert.ok(en.push[k]); assert.ok(ko.push[k]); }
});
