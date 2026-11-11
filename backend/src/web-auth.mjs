// P56(원격 S2·S3): 짝 맺기 다음의 패스키 등록, 패스키 로그인, 로그인 세션(HttpOnly 쿠키).
// - 등록 허가(grant): 코드나 PC 허락으로 짝 맺기에 성공하면 기기 대신 몇 분 동안 한 번만 쓰는 허가를 준다. 그 브라우저(같은 출처)에서 패스키 등록을 마쳐야 기기가 생긴다.
// - 로그인: 일회용 챌린지(passkey.mjs Challenges)에 패스키로 서명한다. 맞으면 세션을 만든다.
// - 세션: 무작위 ID(32바이트)를 쿠키로 주고 판 기록(meta webSessions)에는 해시(sha256)만 둔다. 수명은 로그인 뒤 remoteSessionHours(기본 12시간),
//   연결(WebSocket)이 모두 끊긴 채 remoteIdleMinutes(기본 30분)가 지나도 끝난다. 백엔드를 다시 켜면 그때부터 끊긴 것으로 센다.
// - 쿠키: HttpOnly; SameSite=Strict; Path=/, https면 Secure와 __Host- 접두어. 이름에 판 포트를 넣는다(쿠키는 포트를 가리지 않아 같은 PC의 판끼리 덮어쓰지 않게).
// 비밀(허가, 세션 ID, 챌린지)은 로그에 쓰지 않는다.
import crypto from 'node:crypto';
import net from 'node:net';
import { Challenges, challengeOf, creationOptions, requestOptions, verifyRegistration, verifyAssertion, PasskeyError, b64u, viaOf } from './passkey.mjs';

export const GRANT_TTL_MS = 5 * 60_000;
export const GRANT_MAX_TRIES = 5; // 등록이 이만큼 틀리면 허가를 버린다
export const GRANTS_MAX = 16;
export const SESSION_HOURS_DEFAULT = 12;
export const IDLE_MINUTES_DEFAULT = 30;
// P62: 끝이 없는 세션(패스키 끔)의 쿠키 수명. 브라우저가 받는 상한(400일)에 맞추고, /web/me를 부를 때마다 다시 준다(쓰는 동안 늘어남)
export const COOKIE_MAX_MS = 400 * 24 * 3600_000;
const SESSIONS_KEY = 'webSessions';
const SESSIONS_PER_DEVICE = 8; // 한 기기의 세션이 넘치면 오래된 것부터 끝낸다

const hashOf = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const err = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

// ---------- 출처 → RP ID ----------
// 패스키의 RP ID는 페이지의 호스트 이름이다. IP 주소는 RP ID가 될 수 없다(WebAuthn). 이 PC 안에서는 localhost로 연다
export function rpIdOf(origin) {
  let u; try { u = new URL(String(origin || '')); } catch { throw err('bad_origin', 'no origin', 403); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw err('bad_origin', 'origin must be http(s)', 403);
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || net.isIP(host)) throw err('ip_host', 'open the board by name (localhost or the Tailscale name), not by IP address: passkeys need a name', 400);
  // http의 다른 이름은 브라우저가 보안 출처로 보지 않아 패스키를 만들지 못한다(브라우저가 막는다). 여기서는 따로 막지 않는다(시험의 Chromium 플래그)
  return host;
}

// ---------- 쿠키 ----------
export const cookieName = (port, secure) => (secure ? `__Host-atrium_${port}` : `atrium_${port}`);
export function parseCookies(header) {
  const out = new Map();
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(); const v = part.slice(i + 1).trim();
    if (k && !out.has(k)) out.set(k, v);
  }
  return out;
}
export function sessionCookie({ port, id, secure, maxAgeSec }) {
  return `${cookieName(port, secure)}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSec))}${secure ? '; Secure' : ''}`;
}
// 두 이름을 모두 지운다(https와 http로 번갈아 열었을 때)
export const clearCookies = (port) => [`${cookieName(port, true)}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure`, `${cookieName(port, false)}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`];
export function sessionIdOf(req, port) {
  const c = parseCookies(req.headers && req.headers.cookie);
  const v = c.get(cookieName(port, true)) || c.get(cookieName(port, false));
  return v && /^[A-Za-z0-9_-]{20,100}$/.test(v) ? v : null;
}
export const isHttpsOrigin = (origin) => { try { return new URL(origin).protocol === 'https:'; } catch { return false; } };
// P62: 요청에 실린 세션 쿠키가 https 이름(__Host-)인지. Origin이 없는 GET(/web/me)에서 쿠키를 다시 줄 때 같은 이름으로 준다
export const sentSecureCookie = (req, port) => parseCookies(req.headers && req.headers.cookie).has(cookieName(port, true));

// ---------- 등록 허가 ----------
export class Grants {
  constructor({ now = Date.now } = {}) { this.now = now; this.map = new Map(); }
  // origin: 짝 맺기를 청한 페이지의 출처. 등록도 같은 출처여야 한다. extra: 기기 기록에 그대로 넣을 값(다른 단계가 더하는 필드)
  issue({ name, via, userAgent, origin, extra = {} }) {
    this.sweep();
    while (this.map.size >= GRANTS_MAX) this.map.delete(this.map.keys().next().value);
    const grant = b64u(crypto.randomBytes(32));
    const g = { hash: hashOf(grant), name, via, userAgent, origin: String(origin || ''), userId: b64u(crypto.randomBytes(16)), extra, expiresAt: this.now() + GRANT_TTL_MS, tries: 0 };
    this.map.set(g.hash, g);
    return { grant, expiresAt: g.expiresAt };
  }
  peek(grant) {
    if (typeof grant !== 'string' || grant.length > 100) return null;
    const g = this.map.get(hashOf(grant));
    if (!g) return null;
    if (g.expiresAt <= this.now()) { this.map.delete(g.hash); return null; }
    return g;
  }
  drop(g) { this.map.delete(g.hash); }
  sweep() { const t = this.now(); for (const [k, g] of this.map) if (g.expiresAt <= t) this.map.delete(k); }
}

// ---------- 세션 ----------
export class WebSessions {
  // limits(): { maxAgeMs, idleMs }. connected(hash): 그 세션의 WebSocket이 지금 열려 있는가
  constructor({ store, now = Date.now, limits = () => ({}), connected = () => false }) {
    this.store = store; this.now = now; this.limits = limits; this.connected = connected;
    this.map = new Map(); // hash → { hash, deviceId, createdAt, seenAt }
    const t = this.now();
    for (const s of (store && store.getMeta(SESSIONS_KEY)) || []) if (s && typeof s.hash === 'string' && s.deviceId) this.map.set(s.hash, { hash: s.hash, deviceId: s.deviceId, createdAt: Number(s.createdAt) || 0, seenAt: t });
    this.prune();
  }
  // limits(s): 세션마다 수명을 고른다(P62: 패스키 끔이면 끝이 없다 = Infinity). 모르는 값이면 기본(12시간, 30분)
  lim(s = null) {
    let l = {}; try { l = this.limits(s) || {}; } catch {}
    const ok = (v) => v === Infinity || (Number.isFinite(v) && v > 0);
    const maxAgeMs = ok(l.maxAgeMs) ? l.maxAgeMs : SESSION_HOURS_DEFAULT * 3600_000;
    const idleMs = ok(l.idleMs) ? l.idleMs : IDLE_MINUTES_DEFAULT * 60_000;
    return { maxAgeMs, idleMs };
  }
  save() { if (this.store) this.store.setMeta(SESSIONS_KEY, [...this.map.values()].map(({ hash, deviceId, createdAt }) => ({ hash, deviceId, createdAt }))); }
  create(deviceId) {
    const id = b64u(crypto.randomBytes(32));
    const t = this.now();
    const s = { hash: hashOf(id), deviceId, createdAt: t, seenAt: t };
    const mine = [...this.map.values()].filter((x) => x.deviceId === deviceId).sort((a, b) => a.createdAt - b.createdAt);
    while (mine.length >= SESSIONS_PER_DEVICE) this.map.delete(mine.shift().hash);
    this.map.set(s.hash, s); this.save();
    const { maxAgeMs } = this.lim(s);
    return { id, hash: s.hash, expiresAt: Number.isFinite(maxAgeMs) ? t + maxAgeMs : null, maxAgeMs };
  }
  // P62: 남은 수명(쿠키 Max-Age). 끝이 없으면 Infinity
  remainingMs(hash) {
    const s = this.map.get(hash); if (!s) return 0;
    const { maxAgeMs } = this.lim(s);
    return maxAgeMs === Infinity ? Infinity : Math.max(0, s.createdAt + maxAgeMs - this.now());
  }
  // P62: 수명을 지금부터 다시 센다(패스키를 켤 때 모든 세션, 패스키를 등록한 세션)
  restart(hash) { const s = this.map.get(hash); if (!s) return false; s.createdAt = s.seenAt = this.now(); this.save(); return true; }
  restartAll() { const t = this.now(); for (const s of this.map.values()) s.createdAt = s.seenAt = t; if (this.map.size) this.save(); return this.map.size; }
  alive(s) {
    if (!s) return false;
    const t = this.now(); const { maxAgeMs, idleMs } = this.lim(s);
    if (t >= s.createdAt + maxAgeMs || t < s.createdAt - 60_000) return false;
    if (this.connected(s.hash)) { s.seenAt = t; return true; }
    return t - s.seenAt < idleMs;
  }
  // 쿠키 값 → 살아 있는 세션(없으면 null). 끝난 세션은 지운다
  check(id) {
    if (typeof id !== 'string' || !id) return null;
    const s = this.map.get(hashOf(id)); // 비밀의 해시로 찾는다(원문을 비교하지 않는다)
    if (!s) return null;
    if (!this.alive(s)) { this.map.delete(s.hash); this.save(); return null; }
    return s;
  }
  valid(hash) { const s = this.map.get(hash); return this.alive(s); }
  touch(hash) { const s = this.map.get(hash); if (s) s.seenAt = this.now(); }
  end(hash) { const ok = this.map.delete(hash); if (ok) this.save(); return ok; }
  endDevice(deviceId) {
    let n = 0;
    for (const [k, s] of this.map) if (s.deviceId === deviceId) { this.map.delete(k); n++; }
    if (n) this.save();
    return n;
  }
  // P59: 원격 받기를 끄면 모든 기기의 세션을 끝낸다
  endAll() { const n = this.map.size; if (n) { this.map.clear(); this.save(); } return n; }
  countFor(deviceId) { return [...this.map.values()].filter((s) => s.deviceId === deviceId && this.alive(s)).length; }
  // 끝난 세션을 지우고 그 해시를 돌려준다(연결을 닫으려고)
  prune() {
    const gone = [];
    for (const [k, s] of this.map) if (!this.alive(s)) { this.map.delete(k); gone.push(k); }
    if (gone.length) this.save();
    return gone;
  }
}

// ---------- 묶음: 등록과 로그인 ----------
export class WebAuth {
  // devices: web.mjs Devices(add, byCred, get, setPasskey). onLogin(device, how): 로그에 남긴다
  constructor({ store, devices, now = Date.now, limits, connected, log = () => {} }) {
    this.devices = devices; this.now = now; this.log = log;
    this.grants = new Grants({ now });
    this.challenges = new Challenges({ now });
    this.sessions = new WebSessions({ store, now, limits, connected });
  }
  sweep() { this.grants.sweep(); this.challenges.sweep(); return this.sessions.prune(); }
  // allow(g): 허가를 받은 곳에서 왔는가(P57: 같은 Tailscale 기기, 또는 이 PC 안끼리). 아니면 허가를 버린다(막는 쪽)
  grantOf(grant, origin, allow = null) {
    const g = this.grants.peek(grant);
    if (!g) throw err('bad_grant', 'the pairing has expired or was used. Pair again', 403);
    if (g.origin !== origin) throw err('bad_origin', 'register the passkey in the browser that paired', 403);
    if (allow && !allow(g)) { this.grants.drop(g); throw err('grant_node', 'register the passkey on the device that paired. Pair again', 403); }
    return g;
  }
  // via: 사용자가 고른 인증기(P60, 'phone'|'device'|없음). hints만 바꾼다
  registerOptions({ grant, origin, allow = null, via = null }) {
    const g = this.grantOf(grant, origin, allow);
    const rpId = rpIdOf(origin);
    const challenge = this.challenges.issue({ kind: 'reg', grantHash: g.hash, origin, rpId });
    return { options: creationOptions({ rpId, challenge, userId: g.userId, name: g.name, via: viaOf(via) }), expiresAt: g.expiresAt };
  }
  register({ grant, credential, origin, allow = null }) {
    const g = this.grantOf(grant, origin, allow);
    const ch = this.challenges.take(challengeOf(credential));
    try {
      if (!ch || ch.kind !== 'reg' || ch.grantHash !== g.hash || ch.origin !== origin) throw new PasskeyError('bad_challenge', 'the challenge is unknown, used or expired');
      const pk = verifyRegistration(credential, { challenge: ch.challenge, origin, rpId: ch.rpId });
      if (this.devices.byCred(pk.credId)) throw new PasskeyError('duplicate_credential', 'this passkey is already registered');
      this.grants.drop(g);
      const device = this.devices.add({ name: g.name, via: g.via, userAgent: g.userAgent, extra: g.extra, passkey: { ...pk, userId: g.userId, createdAt: this.now(), lastUsedAt: this.now() } });
      const session = this.sessions.create(device.id);
      return { device, session };
    } catch (e) {
      if (++g.tries >= GRANT_MAX_TRIES) this.grants.drop(g);
      throw e;
    }
  }
  // P62(패스키 끔): 짝 맺기의 등록 허가를 같은 응답에서 쓴다. 허가의 확인(같은 출처, 같은 Tailscale 기기)은 등록과 같다. 패스키 없이 기기와 세션이 생긴다
  pairWithoutPasskey({ grant, origin, allow = null }) {
    const g = this.grantOf(grant, origin, allow);
    this.grants.drop(g);
    const device = this.devices.add({ name: g.name, via: g.via, userAgent: g.userAgent, extra: { ...g.extra, pairOnly: true }, passkey: null });
    const session = this.sessions.create(device.id);
    return { device, session };
  }
  // P62(끔 → 켬): 패스키 없이 짝 맺은 기기가 지금 세션으로 패스키를 한 번 등록한다. device·session은 호출자가 확인한 것(쿠키 세션, 묶인 Tailscale 기기)
  enrollOptions({ device, session, origin, via = null }) {
    const rpId = rpIdOf(origin);
    const userId = b64u(crypto.randomBytes(16));
    const challenge = this.challenges.issue({ kind: 'enroll', deviceId: device.id, sessionHash: session.hash, origin, rpId, userId });
    return { options: creationOptions({ rpId, challenge, userId, name: device.name, via: viaOf(via) }) };
  }
  enroll({ device, session, credential, origin }) {
    const ch = this.challenges.take(challengeOf(credential));
    if (!ch || ch.kind !== 'enroll' || ch.deviceId !== device.id || ch.sessionHash !== session.hash || ch.origin !== origin) throw new PasskeyError('bad_challenge', 'the challenge is unknown, used or expired');
    const pk = verifyRegistration(credential, { challenge: ch.challenge, origin, rpId: ch.rpId });
    if (this.devices.byCred(pk.credId)) throw new PasskeyError('duplicate_credential', 'this passkey is already registered');
    if (!this.devices.attachPasskey(device.id, { ...pk, userId: ch.userId, createdAt: this.now(), lastUsedAt: this.now() })) throw err('has_passkey', 'this device already has a passkey', 409);
    this.sessions.restart(session.hash); // 세션은 켬의 수명(지금부터)으로
    return { device: this.devices.get(device.id), session: { hash: session.hash } };
  }
  // credentialId(브라우저가 기억한 것, 비밀 아님)가 있는데 모르는 것이면 짝이 풀린 것이다
  loginOptions({ credentialId, origin, via = null }) {
    const rpId = rpIdOf(origin);
    let ids = [];
    if (credentialId != null && credentialId !== '') {
      const d = typeof credentialId === 'string' && credentialId.length < 2000 ? this.devices.byCred(credentialId) : null;
      if (!d || d.passkey.rpId !== rpId) return { status: 'unpaired' };
      ids = [{ id: credentialId, transports: d.passkey.transports }]; // P60: 등록 때 받은 길(hybrid 등)
    }
    const challenge = this.challenges.issue({ kind: 'login', origin, rpId });
    return { status: 'ok', options: requestOptions({ rpId, challenge, credIds: ids, via: viaOf(via) }) };
  }
  // check(device): 서명을 확인한 기기를 받을지(P57: 지금 요청한 Tailscale 기기에 묶였는가). 던지면 세션을 만들지 않는다
  login({ credential, origin, check = null }) {
    const ch = this.challenges.take(challengeOf(credential));
    if (!ch || ch.kind !== 'login' || ch.origin !== origin) throw new PasskeyError('bad_challenge', 'the challenge is unknown, used or expired');
    const d = credential && typeof credential.id === 'string' ? this.devices.byCred(credential.id) : null;
    if (!d) throw Object.assign(new PasskeyError('unknown_credential', 'this passkey is not paired with the board'), { unpaired: true });
    const r = verifyAssertion(credential, d.passkey, { challenge: ch.challenge, origin, rpId: ch.rpId });
    if (check) check(d);
    this.devices.setPasskey(d.id, { signCount: r.signCount, backedUp: r.backedUp, lastUsedAt: this.now() });
    const session = this.sessions.create(d.id);
    return { device: this.devices.get(d.id), session };
  }
}
