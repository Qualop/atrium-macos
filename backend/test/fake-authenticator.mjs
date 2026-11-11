// P56 시험 도구: 가짜 인증기. 시험 안에서 만든 ES256(P-256)·RS256(2048비트) 키로 WebAuthn 등록(attestation none)과 로그인 서명을 만든다.
// 브라우저의 navigator.credentials.create·get이 내는 것과 같은 JSON 모양(base64url)을 돌려준다. override로 틀린 값(origin, rpId, 플래그, 카운터)을 넣는다.
// pairAndRegister: 짝 맺기 코드 → 등록 허가 → 패스키 등록까지 HTTP로 하고 세션 쿠키를 돌려준다(p48·p49·p56 시험이 쓴다).
import crypto from 'node:crypto';
import http from 'node:http';

const b64u = (b) => Buffer.from(b).toString('base64url');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

// 시험용 CBOR 쓰기(정수, 바이트, 글, 배열, 맵)
export function cbor(v) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
  };
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  if (v === true) return Buffer.from([0xf5]);
  if (v === false) return Buffer.from([0xf4]);
  if (v === null) return Buffer.from([0xf6]);
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

// P60: icloud: true면 iCloud 키체인 패스키(iPhone으로 하이브리드 등록)의 모양을 흉내 낸다. signCount는 늘 0, 백업 플래그(BE·BS) 켜짐, ES256,
// transports ['hybrid', 'internal'], 붙임 cross-platform. transports·attachment로 따로 줄 수도 있다
export class FakeAuthenticator {
  constructor({ alg = -7, icloud = false, transports = null, attachment = null } = {}) {
    this.icloud = !!icloud;
    if (this.icloud) alg = -7;
    this.transports = transports || (this.icloud ? ['hybrid', 'internal'] : ['internal']);
    this.attachment = attachment || (this.icloud ? 'cross-platform' : 'platform');
    this.alg = alg;
    this.keys = alg === -7 ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }) : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.credId = crypto.randomBytes(32);
    this.signCount = 0;
    this.userHandle = null;
  }
  get id() { return b64u(this.credId); }
  coseKey() {
    const j = this.keys.publicKey.export({ format: 'jwk' });
    if (this.alg === -7) return new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(j.x, 'base64url')], [-3, Buffer.from(j.y, 'base64url')]]);
    return new Map([[1, 3], [3, -257], [-1, Buffer.from(j.n, 'base64url')], [-2, Buffer.from(j.e, 'base64url')]]);
  }
  authData({ rpId, up = true, uv = true, count, attested = false, be = this.icloud, bs = this.icloud }) {
    const flags = (up ? 0x01 : 0) | (uv ? 0x04 : 0) | (be ? 0x08 : 0) | (bs ? 0x10 : 0) | (attested ? 0x40 : 0);
    const c = Buffer.alloc(4); c.writeUInt32BE(count >>> 0, 0);
    const parts = [sha256(Buffer.from(rpId)), Buffer.from([flags]), c];
    if (attested) { const l = Buffer.alloc(2); l.writeUInt16BE(this.credId.length, 0); parts.push(Buffer.alloc(16), l, this.credId, cbor(this.coseKey())); }
    return Buffer.concat(parts);
  }
  // options: 서버가 준 creationOptions. o: { origin, rpId?, type?, up?, uv?, challenge?, fmt? }
  create(options, o = {}) {
    const rpId = o.rpId || options.rp.id;
    if (!this.userHandle) this.userHandle = options.user.id; // 같은 credential을 다시 등록해 보는 시험이 첫 사용자 핸들을 덮지 않게
    const cd = Buffer.from(JSON.stringify({ type: o.type || 'webauthn.create', challenge: o.challenge || options.challenge, origin: o.origin, crossOrigin: false }));
    const ad = this.authData({ rpId, up: o.up, uv: o.uv, count: this.signCount, attested: true });
    const att = cbor(new Map([['fmt', o.fmt || 'none'], ['attStmt', new Map()], ['authData', ad]]));
    return { id: this.id, rawId: this.id, type: 'public-key', response: { clientDataJSON: b64u(cd), attestationObject: b64u(att), transports: this.transports }, authenticatorAttachment: this.attachment, clientExtensionResults: {} };
  }
  // options: 서버가 준 requestOptions. o: { origin, rpId?, count?, up?, uv?, signWith?(다른 인증기), challenge? }
  get(options, o = {}) {
    const rpId = o.rpId || options.rpId;
    if (o.count == null && !this.icloud) this.signCount += 1; // iCloud 키체인은 카운터를 늘리지 않는다(늘 0)
    const cd = Buffer.from(JSON.stringify({ type: o.type || 'webauthn.get', challenge: o.challenge || options.challenge, origin: o.origin, crossOrigin: false }));
    const ad = this.authData({ rpId, up: o.up, uv: o.uv, count: o.count ?? this.signCount });
    const signer = o.signWith || this;
    const sig = crypto.sign('sha256', Buffer.concat([ad, sha256(cd)]), signer.keys.privateKey);
    return { id: this.id, rawId: this.id, type: 'public-key', response: { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(sig), userHandle: this.userHandle }, authenticatorAttachment: this.attachment, clientExtensionResults: {} };
  }
}

// Host를 바꿀 수 있는 요청(fetch는 Host를 못 바꾼다). set-cookie를 함께 돌려준다
export const raw = (port, p, { method = 'GET', headers = {}, body } = {}) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (resp) => { const ch = []; resp.on('data', (d) => ch.push(d)); resp.on('end', () => { const t = Buffer.concat(ch).toString(); let j = null; try { j = JSON.parse(t); } catch {} res({ status: resp.statusCode, body: j, text: t, cookies: resp.headers['set-cookie'] || [] }); }); });
  r.on('error', rej); if (body) r.write(body); r.end();
});
export const cookieOf = (setCookies) => (setCookies || []).map((c) => c.split(';')[0]).filter((c) => !/=$/.test(c)).join('; ');
const post = (port, p, headers, obj) => raw(port, p, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(obj) });

// 등록 허가 → 패스키 등록. headers: { host, origin, ... }(serve 흉내면 Tailscale 머리글도). 돌려주는 것: { cookie, device, auth, res }
export async function registerWithGrant(port, grant, headers, { auth = new FakeAuthenticator(), create = {}, via } = {}) {
  const opt = await post(port, '/web/passkey/register/options', headers, { grant, ...(via ? { via } : {}) });
  if (opt.status !== 200) return { res: opt, auth };
  const credential = auth.create(opt.body.options, { origin: headers.origin, ...create });
  const res = await post(port, '/web/passkey/register', headers, { grant, credential });
  return { res, auth, cookie: cookieOf(res.cookies), device: res.body && res.body.device, options: opt.body.options };
}
export async function pairAndRegister(port, code, headers, o = {}) {
  const pr = await post(port, '/web/pair/code', headers, { code, name: o.name || 'test browser' });
  if (pr.status !== 200) return { res: pr };
  return registerWithGrant(port, pr.body.grant, headers, o);
}
// 패스키 로그인. 돌려주는 것: { res, cookie }
export async function loginWith(port, auth, headers, get = {}, via) {
  const opt = await post(port, '/web/passkey/login/options', headers, { credentialId: auth.id, ...(via ? { via } : {}) });
  if (opt.status !== 200 || opt.body.status !== 'ok') return { res: opt };
  const credential = auth.get(opt.body.options, { origin: headers.origin, ...get });
  const res = await post(port, '/web/passkey/login', headers, { credential });
  return { res, cookie: cookieOf(res.cookies), credential, options: opt.body.options };
}
