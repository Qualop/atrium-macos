// P56(원격 S2): 패스키(WebAuthn) 등록과 로그인 확인. node:crypto만 쓴다(의존성 없음).
// - 받는 것: attestation 'none'(증명서는 읽지 않는다. 믿음은 PC에서 맺은 짝과 일회용 등록 허가에서 온다), 알고리즘 ES256(-7, P-256)과 RS256(-257, 2048비트 이상).
// - 확인하는 것: clientDataJSON의 type·challenge·origin(crossOrigin이면 거부), authenticatorData의 rpIdHash, UP·UV 플래그,
//   등록이면 AT 플래그와 credential ID·공개 키, 로그인이면 signCount(어느 쪽이든 0이 아니면 늘어야 한다)와 서명.
// - 막는 쪽이 기본이다. 모르는 값, 모양이 틀린 값, 너무 긴 값은 모두 거부한다(PasskeyError, code는 화면과 시험이 본다).
import crypto from 'node:crypto';

export const ALG_ES256 = -7;
export const ALG_RS256 = -257;
export const ALGS = [ALG_ES256, ALG_RS256];
const FLAG_UP = 0x01, FLAG_UV = 0x04, FLAG_BE = 0x08, FLAG_BS = 0x10, FLAG_AT = 0x40;
const MAX_CRED_ID = 1023; // WebAuthn L3: credential ID는 1023바이트까지
const MAX_CLIENT_DATA = 4096;
const MAX_ATTESTATION = 16 * 1024;

export class PasskeyError extends Error {
  constructor(code, message) { super(message || code); this.code = code; this.status = 401; }
}
const fail = (code, message) => { throw new PasskeyError(code, message); };

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
export function fromB64u(s, max = MAX_ATTESTATION, what = 'value') {
  if (typeof s !== 'string' || !s || s.length > Math.ceil(max * 4 / 3) + 4 || !/^[A-Za-z0-9_-]+={0,2}$/.test(s)) fail('bad_encoding', `${what} is not base64url`);
  return Buffer.from(s.replace(/=+$/, ''), 'base64url');
}
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const safeEqBuf = (a, b) => Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.length === b.length && crypto.timingSafeEqual(a, b);

// ---------- CBOR(RFC 8949) 읽기: WebAuthn이 쓰는 만큼만. 길이를 모르는 항목, 태그, 실수는 거부한다 ----------
export function cborDecode(buf, start = 0, depth = 0) {
  if (depth > 16) fail('bad_cbor', 'CBOR nesting too deep');
  let i = start;
  const need = (n) => { if (i + n > buf.length) fail('bad_cbor', 'CBOR truncated'); };
  need(1);
  const ib = buf[i++]; const major = ib >> 5; const info = ib & 0x1f;
  let len;
  if (info < 24) len = info;
  else if (info === 24) { need(1); len = buf[i]; i += 1; }
  else if (info === 25) { need(2); len = buf.readUInt16BE(i); i += 2; }
  else if (info === 26) { need(4); len = buf.readUInt32BE(i); i += 4; }
  else if (info === 27) { need(8); const big = buf.readBigUInt64BE(i); i += 8; if (big > BigInt(Number.MAX_SAFE_INTEGER)) fail('bad_cbor', 'CBOR integer too large'); len = Number(big); }
  else fail('bad_cbor', 'CBOR indefinite length or reserved value');
  switch (major) {
    case 0: return { value: len, end: i };
    case 1: return { value: -1 - len, end: i };
    case 2: need(len); return { value: buf.subarray(i, i + len), end: i + len };
    case 3: need(len); return { value: buf.subarray(i, i + len).toString('utf8'), end: i + len };
    case 4: {
      if (len > 1024) fail('bad_cbor', 'CBOR array too long');
      const arr = [];
      for (let k = 0; k < len; k++) { const r = cborDecode(buf, i, depth + 1); arr.push(r.value); i = r.end; }
      return { value: arr, end: i };
    }
    case 5: {
      if (len > 1024) fail('bad_cbor', 'CBOR map too long');
      const m = new Map();
      for (let k = 0; k < len; k++) {
        const kr = cborDecode(buf, i, depth + 1); i = kr.end;
        if (typeof kr.value !== 'number' && typeof kr.value !== 'string') fail('bad_cbor', 'CBOR map key type');
        if (m.has(kr.value)) fail('bad_cbor', 'CBOR duplicate map key');
        const vr = cborDecode(buf, i, depth + 1); i = vr.end;
        m.set(kr.value, vr.value);
      }
      return { value: m, end: i };
    }
    case 7: {
      if (info === 20) return { value: false, end: i };
      if (info === 21) return { value: true, end: i };
      if (info === 22) return { value: null, end: i };
      return fail('bad_cbor', 'CBOR simple or float value');
    }
    default: return fail('bad_cbor', 'CBOR tag');
  }
}
function cborOne(buf) { const r = cborDecode(buf, 0); if (r.end !== buf.length) fail('bad_cbor', 'CBOR trailing bytes'); return r.value; }

// ---------- COSE 키 → 공개 키(JWK) ----------
export function coseToJwk(m) {
  if (!(m instanceof Map)) fail('bad_key', 'COSE key is not a map');
  const kty = m.get(1), alg = m.get(3);
  if (alg === ALG_ES256) {
    const crv = m.get(-1), x = m.get(-2), y = m.get(-3);
    if (kty !== 2 || crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) fail('bad_key', 'not a P-256 key');
    return { alg, jwk: { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y) } };
  }
  if (alg === ALG_RS256) {
    const n = m.get(-1), e = m.get(-2);
    if (kty !== 3 || !Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256 || n.length > 1024 || e.length < 1 || e.length > 8) fail('bad_key', 'not an RSA key of 2048 bits or more');
    return { alg, jwk: { kty: 'RSA', n: b64u(n), e: b64u(e) } };
  }
  return fail('bad_alg', 'only ES256 and RS256 are accepted');
}
function keyOf(jwk) { try { return crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch { return fail('bad_key', 'invalid public key'); } }

// ---------- authenticatorData ----------
export function parseAuthData(buf, { attested = false } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 37) fail('bad_auth_data', 'authenticator data too short');
  const out = { rpIdHash: buf.subarray(0, 32), flags: buf[32], signCount: buf.readUInt32BE(33) };
  out.up = !!(out.flags & FLAG_UP); out.uv = !!(out.flags & FLAG_UV); out.be = !!(out.flags & FLAG_BE); out.bs = !!(out.flags & FLAG_BS);
  out.at = !!(out.flags & FLAG_AT);
  if (attested) {
    if (!out.at) fail('bad_auth_data', 'no attested credential data');
    if (buf.length < 37 + 16 + 2) fail('bad_auth_data', 'attested credential data too short');
    const idLen = buf.readUInt16BE(53);
    if (idLen < 16 || idLen > MAX_CRED_ID || buf.length < 55 + idLen + 1) fail('bad_auth_data', 'bad credential ID length');
    out.credId = buf.subarray(55, 55 + idLen);
    const kr = cborDecode(buf, 55 + idLen);
    out.key = coseToJwk(kr.value);
    // 그 뒤는 확장(ED 플래그)뿐이다. 읽지 않는다
  }
  return out;
}

// clientDataJSON: type, challenge, origin을 확인한다
function checkClientData(raw, { type, challenge, origin }) {
  const buf = fromB64u(raw, MAX_CLIENT_DATA, 'clientDataJSON');
  let cd; try { cd = JSON.parse(buf.toString('utf8')); } catch { fail('bad_client_data', 'clientDataJSON is not JSON'); }
  if (!cd || typeof cd !== 'object') fail('bad_client_data', 'clientDataJSON is not an object');
  if (cd.type !== type) fail('bad_type', `expected ${type}`);
  if (typeof cd.challenge !== 'string' || !challenge || !safeEqBuf(Buffer.from(cd.challenge), Buffer.from(challenge))) fail('bad_challenge', 'challenge does not match');
  if (typeof cd.origin !== 'string' || cd.origin !== origin) fail('bad_origin', 'origin does not match');
  if (cd.crossOrigin === true || cd.topOrigin != null) fail('bad_origin', 'cross-origin ceremony');
  return { buf, cd };
}
const rpOk = (authData, rpId) => safeEqBuf(Buffer.from(authData.rpIdHash), sha256(Buffer.from(String(rpId))));

// 등록 확인. credential = PublicKeyCredential를 JSON으로 옮긴 것({ id, rawId, type, response: { clientDataJSON, attestationObject, transports } })
// expected = { challenge(b64url), origin, rpId }. 돌려주는 것은 기기 기록에 둘 패스키
export function verifyRegistration(credential, expected) {
  const c = credential && typeof credential === 'object' ? credential : fail('bad_credential', 'no credential');
  if (c.type !== 'public-key' || !c.response || typeof c.response !== 'object') fail('bad_credential', 'not a public-key credential');
  checkClientData(c.response.clientDataJSON, { type: 'webauthn.create', challenge: expected.challenge, origin: expected.origin });
  const att = cborOne(fromB64u(c.response.attestationObject, MAX_ATTESTATION, 'attestationObject'));
  if (!(att instanceof Map) || typeof att.get('fmt') !== 'string' || !Buffer.isBuffer(att.get('authData'))) fail('bad_attestation', 'bad attestation object');
  const ad = parseAuthData(att.get('authData'), { attested: true });
  if (!rpOk(ad, expected.rpId)) fail('bad_rp', 'rpIdHash does not match');
  if (!ad.up) fail('no_user_presence', 'user presence flag is not set');
  if (!ad.uv) fail('no_user_verification', 'user verification flag is not set');
  const credId = b64u(ad.credId);
  if (c.id !== credId || (c.rawId != null && c.rawId !== credId)) fail('bad_credential', 'credential ID does not match');
  keyOf(ad.key.jwk); // 쓸 수 있는 키인지
  const transports = Array.isArray(c.response.transports) ? c.response.transports.filter((x) => typeof x === 'string' && /^[a-z-]{1,20}$/.test(x)).slice(0, 8) : [];
  // P60: 브라우저가 알려 준 인증기 붙임(platform·cross-platform). 패스키 종류를 보이는 데만 쓴다(믿음의 근거가 아니다)
  const attachment = ATTACHMENTS.includes(c.authenticatorAttachment) ? c.authenticatorAttachment : null;
  return { credId, alg: ad.key.alg, publicKey: ad.key.jwk, signCount: ad.signCount, rpId: expected.rpId, transports, attachment, backupEligible: ad.be, backedUp: ad.bs, fmt: att.get('fmt').slice(0, 32) };
}

// 로그인 확인. passkey = 기기 기록의 패스키, expected = { challenge, origin, rpId }. 돌려주는 것은 새 signCount
export function verifyAssertion(credential, passkey, expected) {
  const c = credential && typeof credential === 'object' ? credential : fail('bad_credential', 'no credential');
  if (c.type !== 'public-key' || !c.response || typeof c.response !== 'object') fail('bad_credential', 'not a public-key credential');
  if (!passkey || c.id !== passkey.credId || (c.rawId != null && c.rawId !== passkey.credId)) fail('unknown_credential', 'credential is not this device');
  if (passkey.rpId !== expected.rpId) fail('bad_rp', 'this passkey belongs to another address');
  const { buf: cdBuf } = checkClientData(c.response.clientDataJSON, { type: 'webauthn.get', challenge: expected.challenge, origin: expected.origin });
  const adBuf = fromB64u(c.response.authenticatorData, 4096, 'authenticatorData');
  const ad = parseAuthData(adBuf);
  if (!rpOk(ad, expected.rpId)) fail('bad_rp', 'rpIdHash does not match');
  if (!ad.up) fail('no_user_presence', 'user presence flag is not set');
  if (!ad.uv) fail('no_user_verification', 'user verification flag is not set');
  if (c.response.userHandle != null && c.response.userHandle !== '' && passkey.userId && c.response.userHandle !== passkey.userId) fail('unknown_credential', 'user handle does not match');
  const sig = fromB64u(c.response.signature, 1024, 'signature');
  const data = Buffer.concat([adBuf, sha256(cdBuf)]);
  const key = keyOf(passkey.publicKey);
  let ok = false;
  try {
    if (passkey.alg === ALG_ES256) ok = crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, sig);
    else if (passkey.alg === ALG_RS256) ok = crypto.verify('sha256', data, { key, padding: crypto.constants.RSA_PKCS1_PADDING }, sig);
  } catch { ok = false; }
  if (!ok) fail('bad_signature', 'signature does not verify');
  const prev = Number(passkey.signCount) || 0;
  if ((ad.signCount !== 0 || prev !== 0) && ad.signCount <= prev) fail('sign_count', 'signature counter went back (cloned authenticator?)');
  return { signCount: ad.signCount, backedUp: ad.bs };
}

// P60: 사용자가 고른 인증기 → WebAuthn hints. 휴대폰(iPhone·Android, 노트북 화면의 QR과 블루투스)이면 하이브리드를,
// 이 기기(Windows Hello·Touch ID·보안 키)면 내장 인증기와 보안 키를 먼저 띄운다. 고르지 않았으면 hints를 주지 않는다(브라우저가 정한다)
export const PASSKEY_VIA = ['phone', 'device'];
const ATTACHMENTS = ['platform', 'cross-platform'];
export function passkeyHints(via) {
  if (via === 'phone') return ['hybrid'];
  if (via === 'device') return ['client-device', 'security-key'];
  return null;
}
export const viaOf = (v) => (PASSKEY_VIA.includes(v) ? v : null);
// 등록 때 받은 transports·붙임 → 패스키 종류(화면에 보일 것). hybrid가 있으면 휴대폰, internal이나 platform이면 이 기기, usb·nfc·ble이면 보안 키
export function passkeyKind(pk) {
  if (!pk) return null;
  const tr = Array.isArray(pk.transports) ? pk.transports : [];
  if (tr.includes('hybrid') || tr.includes('cable')) return 'phone';
  if (tr.includes('internal') || pk.attachment === 'platform') return 'device';
  if (tr.some((x) => x === 'usb' || x === 'nfc' || x === 'ble' || x === 'smart-card')) return 'key';
  return pk.attachment === 'cross-platform' ? 'phone' : 'unknown';
}

// 브라우저에 줄 선택 사항(JSON. 바이트는 base64url, 화면의 lib/passkey.js가 바꾼다). via: 사용자가 고른 인증기(P60)
export function creationOptions({ rpId, challenge, userId, name, via = null }) {
  const hints = passkeyHints(via);
  return {
    rp: { id: rpId, name: 'Atrium' },
    user: { id: userId, name: name || 'Atrium device', displayName: name || 'Atrium device' },
    challenge,
    pubKeyCredParams: [{ type: 'public-key', alg: ALG_ES256 }, { type: 'public-key', alg: ALG_RS256 }],
    timeout: 120_000,
    attestation: 'none',
    // 휴대폰이면 붙임도 cross-platform으로(hints를 읽지 않는 브라우저와 Windows 대화상자도 노트북 내장 인증기를 건너뛴다)
    authenticatorSelection: { userVerification: 'required', residentKey: 'preferred', requireResidentKey: false, ...(via === 'phone' ? { authenticatorAttachment: 'cross-platform' } : {}) },
    ...(hints ? { hints } : {}),
    excludeCredentials: [],
  };
}
// creds: [{ id, transports? }] 또는 ID 글. 등록 때 받은 transports를 실어 브라우저가 그 길(예: hybrid)로 곧바로 가게 한다
export function requestOptions({ rpId, challenge, credIds = [], via = null }) {
  const hints = passkeyHints(via);
  return {
    rpId, challenge, timeout: 120_000, userVerification: 'required',
    allowCredentials: credIds.map((c) => {
      const id = typeof c === 'string' ? c : c.id;
      const tr = typeof c === 'object' && Array.isArray(c.transports) ? c.transports.filter((x) => typeof x === 'string') : [];
      return tr.length ? { type: 'public-key', id, transports: tr } : { type: 'public-key', id };
    }),
    ...(hints ? { hints } : {}),
  };
}

// 일회용 챌린지. 한 번 꺼내면(맞든 틀리든) 지운다. 수가 넘치면 오래된 것부터 버린다
export const CHALLENGE_TTL_MS = 2 * 60_000;
export const CHALLENGES_MAX = 64;
export class Challenges {
  constructor({ now = Date.now, ttlMs = CHALLENGE_TTL_MS, max = CHALLENGES_MAX } = {}) { this.now = now; this.ttlMs = ttlMs; this.max = max; this.map = new Map(); }
  issue(data = {}) {
    this.sweep();
    while (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    const challenge = b64u(crypto.randomBytes(32));
    this.map.set(b64u(sha256(Buffer.from(challenge))), { ...data, expiresAt: this.now() + this.ttlMs });
    return challenge;
  }
  // clientDataJSON의 challenge로 찾는다. 없거나 만료면 null. 꺼낸 것은 지운다
  take(challenge) {
    if (typeof challenge !== 'string' || challenge.length > 200) return null;
    const k = b64u(sha256(Buffer.from(challenge)));
    const v = this.map.get(k);
    if (!v) return null;
    this.map.delete(k);
    return v.expiresAt > this.now() ? { ...v, challenge } : null;
  }
  sweep() { const t = this.now(); for (const [k, v] of this.map) if (v.expiresAt <= t) this.map.delete(k); }
}
// clientDataJSON에서 challenge만 읽는다(어느 챌린지인지 찾으려고. 확인은 verify*가 다시 한다)
export function challengeOf(credential) {
  try {
    const cd = JSON.parse(fromB64u(credential.response.clientDataJSON, MAX_CLIENT_DATA, 'clientDataJSON').toString('utf8'));
    return typeof cd.challenge === 'string' ? cd.challenge : null;
  } catch { return null; }
}
