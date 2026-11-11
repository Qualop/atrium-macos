// P56(원격 S2·S3) 창 단위 시험: 패스키 선택 사항·credential의 base64url 바꾸기, 패스키를 쓸 수 있는지(보안 출처, WebAuthn, IP 주소),
// 브라우저에 두는 것은 credential ID뿐(비밀 없음), 웹 어댑터는 토큰·Bearer·?device=를 쓰지 않는다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { b64uToBuf, bufToB64u, toCreateOptions, toGetOptions, credentialToJSON, passkeySupport, savedPasskey, savePasskey, clearPasskey, webauthnError, PASSKEY_KEY } from '../src/renderer/lib/passkey.js';

const bytes = (b) => [...new Uint8Array(b)];

test('base64url 바꾸기: 패딩 없이, 되돌리면 같다', () => {
  const src = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
  const s = bufToB64u(src.buffer);
  assert.doesNotMatch(s, /[+/=]/);
  assert.deepEqual(bytes(b64uToBuf(s)), [...src]);
  assert.deepEqual(bytes(b64uToBuf(bufToB64u(new Uint8Array([1, 2, 3, 4, 5]).subarray(1, 4)))), [2, 3, 4], 'Uint8Array의 일부');
  assert.equal(bufToB64u(new ArrayBuffer(0)), '');
});

test('선택 사항: 챌린지·사용자 ID·credential ID를 바이트로, 나머지는 그대로', () => {
  const c = toCreateOptions({ rp: { id: 'localhost', name: 'Atrium' }, user: { id: 'AQID', name: 'n', displayName: 'n' }, challenge: 'BAUG', pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { userVerification: 'required' }, attestation: 'none', excludeCredentials: [{ type: 'public-key', id: 'BwgJ' }] });
  assert.deepEqual(bytes(c.challenge), [4, 5, 6]); assert.deepEqual(bytes(c.user.id), [1, 2, 3]); assert.deepEqual(bytes(c.excludeCredentials[0].id), [7, 8, 9]);
  assert.equal(c.attestation, 'none'); assert.equal(c.authenticatorSelection.userVerification, 'required'); assert.equal(c.rp.id, 'localhost');
  const g = toGetOptions({ rpId: 'localhost', challenge: 'BAUG', userVerification: 'required', allowCredentials: [] });
  assert.deepEqual(bytes(g.challenge), [4, 5, 6]); assert.deepEqual(g.allowCredentials, []);
});

test('credential → JSON: 등록(attestationObject, transports)과 로그인(authenticatorData, signature, userHandle)', () => {
  const ab = (...x) => new Uint8Array(x).buffer;
  const reg = credentialToJSON({ id: 'AQI', rawId: ab(1, 2), type: 'public-key', authenticatorAttachment: 'platform', response: { clientDataJSON: ab(3), attestationObject: ab(4), getTransports: () => ['internal'] } });
  assert.deepEqual(reg, { id: 'AQI', rawId: 'AQI', type: 'public-key', response: { clientDataJSON: 'Aw', attestationObject: 'BA', transports: ['internal'] }, authenticatorAttachment: 'platform', clientExtensionResults: {} });
  const get = credentialToJSON({ id: 'AQI', rawId: ab(1, 2), type: 'public-key', response: { clientDataJSON: ab(3), authenticatorData: ab(5), signature: ab(6), userHandle: null } });
  assert.deepEqual(get.response, { clientDataJSON: 'Aw', authenticatorData: 'BQ', signature: 'Bg', userHandle: null });
});

test('패스키를 쓸 수 있나: 보안 출처, WebAuthn, IP 주소로 연 페이지는 이유와 localhost 주소', () => {
  const nav = { credentials: { create() {}, get() {} } };
  const env = (o) => ({ isSecureContext: true, PublicKeyCredential: function () {}, navigator: nav, location: { hostname: 'pc.example.ts.net', protocol: 'https:', port: '' }, ...o });
  assert.deepEqual(passkeySupport(env({})), { ok: true, reason: null });
  assert.equal(passkeySupport(env({ isSecureContext: false, location: { hostname: 'pc.example.ts.net', protocol: 'http:', port: '8080' } })).reason, 'insecure');
  assert.equal(passkeySupport(env({ PublicKeyCredential: undefined })).reason, 'no_webauthn');
  assert.equal(passkeySupport(env({ navigator: {} })).reason, 'no_webauthn');
  const ip = passkeySupport(env({ location: { hostname: '127.0.0.1', protocol: 'http:', port: '47875' } }));
  assert.equal(ip.reason, 'ip_host'); assert.equal(ip.localUrl, 'http://localhost:47875/');
  assert.equal(passkeySupport(env({ location: { hostname: '[::1]', protocol: 'http:', port: '47875' } })).reason, 'ip_host');
  assert.equal(passkeySupport(env({ location: { hostname: 'localhost', protocol: 'http:', port: '47875' } })).ok, true);
});

test('브라우저에 두는 것은 credential ID뿐', () => {
  const m = new Map();
  const st = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  assert.equal(savedPasskey(st), null);
  savePasskey({ credentialId: 'cred', deviceId: 'd1', name: 'laptop', secret: 'nope', token: 'nope' }, st);
  assert.deepEqual(JSON.parse(m.get(PASSKEY_KEY)), { credentialId: 'cred', deviceId: 'd1', name: 'laptop' });
  assert.equal(savedPasskey(st).credentialId, 'cred');
  m.set(PASSKEY_KEY, '{bad'); assert.equal(savedPasskey(st), null);
  clearPasskey(st); assert.equal(m.size, 0);
  assert.equal(savedPasskey({ getItem: () => { throw new Error('blocked'); } }), null);
});

test('WebAuthn 오류 이름 → 화면 열쇠', () => {
  assert.equal(webauthnError({ name: 'NotAllowedError' }), 'cancelled');
  assert.equal(webauthnError({ name: 'InvalidStateError' }), 'exists');
  assert.equal(webauthnError({ name: 'SecurityError' }), 'security');
  assert.equal(webauthnError(new Error('x')), null);
});

test('웹 어댑터는 비밀을 두지 않는다: 토큰 저장, Bearer, ?device=가 없다', () => {
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  for (const f of ['../src/renderer/web.js', '../src/renderer/Pair.jsx', '../src/renderer/lib/passkey.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /Bearer/, f);
    assert.doesNotMatch(src, /\?device=/, f);
    assert.doesNotMatch(src, /setItem\([^)]*[Tt]oken/, f);
    assert.doesNotMatch(src, /sessionStorage/, f);
    assert.doesNotMatch(src, /document\.cookie/, f);
  }
  assert.match(read('../src/renderer/web.js'), /wsUrl: `\$\{proto\}:\/\/\$\{location\.host\}\/api`/);
});
