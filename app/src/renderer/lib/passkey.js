// P56(원격 S2): 웹 화면의 패스키. 백엔드(web-auth.mjs)가 JSON(바이트는 base64url)으로 준 선택 사항을 navigator.credentials에 맞게 바꾸고,
// 나온 credential을 다시 JSON으로 바꾼다. 순수 함수와 작은 fetch 감싸개만 둔다(단위 시험 test/p56-lib.test.mjs).
// - 브라우저에 두는 것은 credential ID(비밀 아님)뿐이다(localStorage atrium.passkey). 세션은 HttpOnly 쿠키라 화면의 스크립트가 읽지 못한다.
// - 패스키를 쓸 수 없는 곳(보안 출처가 아님, WebAuthn 없음, IP 주소로 연 페이지)은 이유를 돌려준다. 토큰으로 되돌아가는 길은 없다.
export const PASSKEY_KEY = 'atrium.passkey';

export function b64uToBuf(s) {
  const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
export function bufToB64u(buf) {
  const b = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const isIpHost = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || /^\[.*\]$/.test(h);
// 이 페이지에서 패스키를 쓸 수 있나. env는 시험이 넣는다
export function passkeySupport(env = globalThis) {
  const loc = env.location || {};
  const host = String(loc.hostname || '');
  if (isIpHost(host)) return { ok: false, reason: 'ip_host', localUrl: loc.port ? `${loc.protocol}//localhost:${loc.port}/` : null };
  if (!env.isSecureContext) return { ok: false, reason: 'insecure' };
  if (!env.PublicKeyCredential || !env.navigator || !env.navigator.credentials || typeof env.navigator.credentials.create !== 'function') return { ok: false, reason: 'no_webauthn' };
  return { ok: true, reason: null };
}

export function toCreateOptions(o) {
  return {
    ...o,
    challenge: b64uToBuf(o.challenge),
    user: { ...o.user, id: b64uToBuf(o.user.id) },
    excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: b64uToBuf(c.id) })),
  };
}
export function toGetOptions(o) {
  return { ...o, challenge: b64uToBuf(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: b64uToBuf(c.id) })) };
}
// PublicKeyCredential → JSON(등록이면 attestationObject, 로그인이면 authenticatorData·signature·userHandle)
export function credentialToJSON(cred) {
  const r = cred.response;
  const response = { clientDataJSON: bufToB64u(r.clientDataJSON) };
  if (r.attestationObject) {
    response.attestationObject = bufToB64u(r.attestationObject);
    try { response.transports = typeof r.getTransports === 'function' ? r.getTransports() : []; } catch { response.transports = []; }
  } else {
    response.authenticatorData = bufToB64u(r.authenticatorData);
    response.signature = bufToB64u(r.signature);
    response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null;
  }
  return { id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type, response, authenticatorAttachment: cred.authenticatorAttachment || null, clientExtensionResults: {} };
}

// 기억한 credential ID(비밀 아님)
export function savedPasskey(storage = globalThis.localStorage) {
  try { const v = JSON.parse(storage.getItem(PASSKEY_KEY) || 'null'); return v && typeof v.credentialId === 'string' ? v : null; } catch { return null; }
}
export function savePasskey(v, storage = globalThis.localStorage) { try { storage.setItem(PASSKEY_KEY, JSON.stringify({ credentialId: v.credentialId, deviceId: v.deviceId || null, name: v.name || null })); } catch {} }
export function clearPasskey(storage = globalThis.localStorage) { try { storage.removeItem(PASSKEY_KEY); } catch {} }

// P60: 패스키를 무엇으로 확인할지(휴대폰 'phone' = iPhone·Android의 하이브리드(QR과 블루투스), 이 기기 'device' = Windows Hello·보안 키).
// 고른 것을 이 브라우저에 기억한다(비밀 아님). 서버는 이 값으로 hints를 고른다. 고르지 않았으면 null(브라우저가 정한다)
export const PASSKEY_VIA_KEY = 'atrium.passkeyVia';
export const PASSKEY_VIAS = ['phone', 'device'];
export function savedVia(storage = globalThis.localStorage) { try { const v = storage.getItem(PASSKEY_VIA_KEY); return PASSKEY_VIAS.includes(v) ? v : null; } catch { return null; } }
export function saveVia(v, storage = globalThis.localStorage) { try { if (PASSKEY_VIAS.includes(v)) storage.setItem(PASSKEY_VIA_KEY, v); else storage.removeItem(PASSKEY_VIA_KEY); } catch {} }
const viaBody = (via) => (PASSKEY_VIAS.includes(via) ? { via } : {});

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error((j && j.error && j.error.message) || String(r.status)), { code: j && j.error && j.error.code, status: r.status, retryAfterMs: j && j.error && j.error.retryAfterMs });
  return j;
}
// WebAuthn이 낸 오류를 화면 열쇠로
export function webauthnError(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'AbortError') return 'cancelled';
  if (n === 'InvalidStateError') return 'exists';
  if (n === 'NotSupportedError') return 'unsupported';
  if (n === 'SecurityError') return 'security';
  return null;
}

// 짝 맺기의 등록 허가로 패스키를 만든다. via: 고른 인증기(P60). 돌려주는 것: { device }
export async function registerPasskey(grant, creds = navigator.credentials, via = null) {
  const { options } = await post('/web/passkey/register/options', { grant, ...viaBody(via) });
  const cred = await creds.create({ publicKey: toCreateOptions(options) });
  if (!cred) throw Object.assign(new Error('no credential'), { name: 'NotAllowedError' });
  const r = await post('/web/passkey/register', { grant, credential: credentialToJSON(cred) });
  savePasskey({ credentialId: cred.id, deviceId: r.device && r.device.id, name: r.device && r.device.name });
  return r;
}
// 패스키로 다시 확인. credentialId가 없으면 이 브라우저가 찾을 수 있는 패스키로. 돌려주는 것: { status: 'ok', device } | { status: 'unpaired' }
export async function loginPasskey(credentialId, creds = navigator.credentials, via = null) {
  const o = await post('/web/passkey/login/options', { credentialId: credentialId || null, ...viaBody(via) });
  if (o.status === 'unpaired') { clearPasskey(); return { status: 'unpaired' }; }
  const cred = await creds.get({ publicKey: toGetOptions(o.options) });
  if (!cred) throw Object.assign(new Error('no credential'), { name: 'NotAllowedError' });
  try {
    const r = await post('/web/passkey/login', { credential: credentialToJSON(cred) });
    savePasskey({ credentialId: cred.id, deviceId: r.device && r.device.id, name: r.device && r.device.name });
    return { status: 'ok', device: r.device };
  } catch (e) {
    if (e.code === 'unknown_credential') { clearPasskey(); return { status: 'unpaired' }; }
    throw e;
  }
}
// P62: 패스키 없이 짝 맺은 브라우저가 PC에서 "패스키로 확인"을 켠 뒤 지금 세션(쿠키)으로 패스키를 한 번 등록한다. 돌려주는 것: { device }
export async function enrollPasskey(creds = navigator.credentials, via = null) {
  const { options } = await post('/web/passkey/enroll/options', { ...viaBody(via) });
  const cred = await creds.create({ publicKey: toCreateOptions(options) });
  if (!cred) throw Object.assign(new Error('no credential'), { name: 'NotAllowedError' });
  const r = await post('/web/passkey/enroll', { credential: credentialToJSON(cred) });
  savePasskey({ credentialId: cred.id, deviceId: r.device && r.device.id, name: r.device && r.device.name });
  return r;
}
export const webLogout = () => post('/web/logout', {}).catch(() => {});
