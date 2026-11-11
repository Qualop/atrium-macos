// P62 단위 시험(창): 패스키 없이 짝 맺은 브라우저의 패스키 등록 요청, 연결 기록 줄(패스키 없이 짝 맺음, 패스키로 확인 켬·끔·등록), 두 사전의 새 글
import test from 'node:test';
import assert from 'node:assert/strict';
import { enrollPasskey, PASSKEY_KEY } from '../src/renderer/lib/passkey.js';
import { logRow, LOG_EVENTS } from '../src/renderer/lib/remote.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

test('패스키 등록(끔 → 켬): enroll 선택 사항과 등록을 차례로 부르고, via를 싣고, 등록한 credential ID만 기억한다', async () => {
  const sent = [];
  const realFetch = globalThis.fetch, realLs = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const b64 = (s) => Buffer.from(s).toString('base64url');
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), credentials: init.credentials });
    const body = url.endsWith('/options') ? { options: { challenge: b64('challenge-0123456789abcdef'), user: { id: b64('user'), name: 'x', displayName: 'x' }, rp: { id: 'localhost', name: 'Atrium' }, pubKeyCredParams: [] } } : { device: { id: 'dev-1', name: 'Laptop' } };
    return { ok: true, status: 200, json: async () => body };
  };
  const buf = (s) => new Uint8Array(Buffer.from(s)).buffer;
  const creds = { create: async ({ publicKey }) => { assert.ok(publicKey.challenge instanceof ArrayBuffer); return { id: 'cred-1', rawId: buf('cred-1'), type: 'public-key', response: { clientDataJSON: buf('{}'), attestationObject: buf('att'), getTransports: () => ['hybrid'] } }; } };
  try {
    const r = await enrollPasskey(creds, 'phone');
    assert.equal(r.device.id, 'dev-1');
    assert.deepEqual(sent.map((x) => x.url), ['/web/passkey/enroll/options', '/web/passkey/enroll']);
    assert.deepEqual(sent[0].body, { via: 'phone' });
    assert.equal(sent[1].body.credential.id, 'cred-1'); assert.deepEqual(sent[1].body.credential.response.transports, ['hybrid']);
    assert.ok(sent.every((x) => x.credentials === 'same-origin'), '세션은 쿠키(같은 출처)');
    assert.deepEqual(JSON.parse(store.get(PASSKEY_KEY)), { credentialId: 'cred-1', deviceId: 'dev-1', name: 'Laptop' });
    sent.length = 0;
    await enrollPasskey(creds, 'bogus');
    assert.deepEqual(sent[0].body, {}, '모르는 via는 싣지 않는다');
  } finally { globalThis.fetch = realFetch; globalThis.localStorage = realLs; }
});

test('연결 기록 줄: 패스키 없이 짝 맺음 표시, 패스키로 확인 켬·끔·등록의 글(영어·한국어)', () => {
  assert.equal(logRow({ event: 'pair.ok', passkey: false, via: 'code' }).noPasskey, true);
  assert.equal(logRow({ event: 'pair.ok', via: 'code' }).noPasskey, undefined);
  for (const ev of ['passkey.on', 'passkey.off', 'passkey.add']) {
    assert.ok(LOG_EVENTS.includes(ev));
    const k = logRow({ event: ev }).key.split('.')[1];
    assert.ok(en.remoteLog[k] && ko.remoteLog[k], k);
  }
  for (const d of [en, ko]) {
    assert.ok(d.remoteLog.noPasskey && d.remoteLog.reason_passkey_required);
    for (const k of ['label', 'offHint', 'onHint', 'limitsOff', 'turnedOn', 'turnedOff', 'selfNoPasskey']) assert.ok(d.passkeyMode[k], k);
    assert.ok(d.enroll.title && d.enroll.note);
    for (const k of ['kind_none', 'needsPasskey', 'needsPasskeyHint']) assert.ok(d.devTab[k], k);
    for (const k of ['check_passkey_on_ok', 'check_passkey_off_ok', 'check_passkey_skip']) assert.ok(d.remote[k], k);
  }
  // 스위치 설명은 끔과 켬의 차이(바로 열림, 휴대폰이나 이 기기의 패스키로 다시 확인)를 쓴다
  assert.match(ko.passkeyMode.offHint, /보드를 바로 열 수 있습니다/); assert.match(ko.passkeyMode.onHint, /휴대폰이나 이 기기의 패스키/);
});
