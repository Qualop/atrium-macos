// P88: 웹 푸시(휴대폰 홈 화면 앱). 세션의 일이 끝나거나(working → ready) 사람의 답이 필요하거나(waiting, trust_wait) 오류가 나거나
// 예기치 않게 끝나면(error, exited의 other) 짝 맺은 기기의 브라우저 푸시 서비스로 알림을 보낸다.
// - 암호화(RFC 8291 aes128gcm)와 서명(RFC 8292 VAPID, ES256)은 node:crypto로 직접 한다. web-push 패키지는 의존성 넷(http_ece, asn1.js, jws,
//   https-proxy-agent)을 데려오고 우리가 쓰는 것은 함수 셋이라 직접 쓰고 RFC 8291 부록 A의 시험 벡터로 시험한다(p88.test.mjs).
// - VAPID 키 한 쌍: 처음 쓸 때 만들어 판 데이터 폴더의 vapid.json에 둔다(저장소 밖. 데이터 폴더는 사용자 프로필 아래라 사용자만 읽는다, 파일은 0600).
// - 구독: 기기(P56 짝 맺은 기기)마다 하나. 판 기록(meta webPush)에 endpoint, 받는 쪽 키(p256dh, auth), 말(ko|en), 종류별 켜기, PC 사용 중에도 받기를 둔다.
//   짝을 풀면 기록째 지우고, 원격 접속을 막거나 푸시 서비스가 404·410을 주면 구독만 지운다(설정은 남는다).
// - SSRF: endpoint는 알려진 푸시 서비스의 https 주소만 받는다(PUSH_HOSTS). 보낼 때 이름이 사설·루프백·Tailscale 주소로 풀리면 보내지 않는다.
//   리디렉션은 따르지 않는다(node:https는 따르지 않는다). 개발용 판만 시험용 흉내 푸시 서비스의 출처(ATRIUM_PUSH_TEST_ORIGINS)를 더 받는다.
// - 알림 글은 세션 이름, 종류, 프로젝트 이름만 넣는다. 질문·요청·답의 글은 넣지 않는다(사용자 요청). 연결 기록에도 알림 내용은 남기지 않는다.
// - 같은 세션의 같은 종류는 COOLDOWN_MS 안에 한 번만, 기기마다 BATCH_MS 안에 생긴 것은 한 알림으로 묶는다.
//   그 기기가 판 화면을 보고 있으면(연결 열림, 보이는 상태) 보내지 않는다. PC에서 최근에 입력했으면 기기 설정(whilePc, 기본 끔)에 따른다.
// - P92: 끝남은 턴마다 보내지 않고 작업 사이클이 끝났을 때(push-cycle.mjs) 한 번 보낸다. 하위 세션(워커) 알림은 기기 설정 sub
//   (need = 응답 필요만(기본), all = 모두, off = 끔)을 따른다. 기기마다 세션 하나의 알림을 끌 수 있다(muted). 보내지 않은 까닭은 decisions에 남는다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { SETTLE_MS, BG_CAP_MS, treeIndex, cycleCheck, subModeOf, subAllows, DEFAULT_SUB } from './push-cycle.mjs'; // P92

export const COOLDOWN_MS = 30_000;
export const BATCH_MS = 1500;
export const TTL_SEC = 4 * 3600; // 휴대폰이 꺼져 있으면 푸시 서비스가 이만큼 들고 있다. 그보다 오래된 "끝남"은 쓸모가 적다
export const JWT_TTL_SEC = 12 * 3600; // RFC 8292: 24시간을 넘기지 않는다
export const SEND_TIMEOUT_MS = 10_000;
export const BATCH_SHOW = 4; // 묶은 알림에 이름을 보이는 세션 수
export const PUSH_KINDS = ['done', 'need', 'error'];
export const DEFAULT_PREFS = Object.freeze({ kinds: Object.freeze({ done: true, need: true, error: true }), whilePc: false, sub: DEFAULT_SUB, muted: Object.freeze([]) });
const MUTED_MAX = 200;
export const MAX_BODY = 4096; // 푸시 서비스가 받는 본문 상한(RFC 8291: 4096바이트를 넘으면 안 된다)
const KEY = 'webPush';
const DECISIONS_MAX = 200;

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
export const unb64u = (s) => Buffer.from(String(s || '').replace(/\s+/g, ''), 'base64url');
const err = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

// ---------- 허용하는 푸시 서비스 ----------
// 근거: Apple(Safari·iOS 16.4+)은 web.push.apple.com을 쓰고 "*.push.apple.com을 허용하라"고 안내한다.
// Chrome·Android·Opera·Samsung은 FCM(fcm.googleapis.com), Firefox는 Mozilla autopush(updates.push.services.mozilla.com),
// Edge는 WNS(wns2-*.notify.windows.com)를 쓴다. 그 밖의 브라우저 푸시 서비스는 받지 않는다(필요하면 근거와 함께 더한다).
export const PUSH_HOSTS = [
  { host: 'push.apple.com', sub: true },
  { host: 'fcm.googleapis.com' },
  { host: 'updates.push.services.mozilla.com' },
  { host: 'notify.windows.com', sub: true },
];
// endpoint 하나를 받을지. testOrigins: 개발용 판의 흉내 푸시 서비스 출처(정확히 같아야 한다)
export function endpointCheck(endpoint, { testOrigins = [] } = {}) {
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > 2048) return { ok: false, reason: 'bad_endpoint' };
  let u; try { u = new URL(endpoint); } catch { return { ok: false, reason: 'bad_endpoint' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (u.username || u.password) return { ok: false, reason: 'userinfo' };
  if (testOrigins.includes(u.origin)) return { ok: true, host: u.hostname, test: true };
  if (u.port && u.port !== '443') return { ok: false, reason: 'port' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (net.isIP(host.replace(/^\[|\]$/g, ''))) return { ok: false, reason: 'ip' };
  const known = PUSH_HOSTS.some((h) => host === h.host || (h.sub && host.endsWith(`.${h.host}`)));
  return known ? { ok: true, host } : { ok: false, reason: 'host' };
}
// 보낼 때 이름이 풀린 주소. 사설·루프백·링크 로컬·CGNAT(Tailscale 100.64/10)·멀티캐스트면 보내지 않는다
const BLOCK = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3]]) BLOCK.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) BLOCK.addSubnet(a, p, 'ipv6');
export function privateAddr(addr) {
  let a = String(addr || '').replace(/^\[|\]$/g, '');
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a); if (m) a = m[1];
  const fam = net.isIP(a);
  if (!fam) return true;
  return BLOCK.check(a, fam === 6 ? 'ipv6' : 'ipv4');
}
export const guardLookup = (allowPrivate = false) => (hostname, opts, cb) => {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  dns.lookup(hostname, { ...opts, all: true }, (e, addrs) => {
    if (e) return cb(e);
    const list = (addrs || []).filter((x) => allowPrivate || !privateAddr(x.address));
    if (!list.length) return cb(Object.assign(new Error(`${hostname} resolves to a private address`), { code: 'EPRIVATE' }));
    if (opts.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
};

// ---------- VAPID(RFC 8292) ----------
const rawPublic = (jwk) => Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]);
export function makeVapidKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const j = privateKey.export({ format: 'jwk' });
  return { jwk: { kty: j.kty, crv: j.crv, x: j.x, y: j.y, d: j.d }, publicKey: rawPublic(j) };
}
const goodJwk = (j) => j && j.kty === 'EC' && j.crv === 'P-256' && typeof j.x === 'string' && typeof j.y === 'string' && typeof j.d === 'string';
// 파일이 없으면 만든다. 다른 프로세스가 먼저 만들었으면 그것을 읽는다
export function loadVapidKeys(file, now = Date.now) {
  const read = () => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return goodJwk(j && j.jwk) ? { jwk: j.jwk, publicKey: rawPublic(j.jwk), createdAt: j.createdAt || null } : null; } catch { return null; } };
  const had = read(); if (had) return had;
  const k = makeVapidKeys();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, JSON.stringify({ jwk: k.jwk, createdAt: now() }), { mode: 0o600, flag: 'wx' }); }
  catch (e) { if (e.code === 'EEXIST') { const r = read(); if (r) return r; } throw e; }
  return { ...k, createdAt: now() };
}
export function vapidJwt({ aud, sub, jwk, now = Date.now(), ttlSec = JWT_TTL_SEC }) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + Math.min(ttlSec, 24 * 3600), sub }));
  const data = `${head}.${claims}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: crypto.createPrivateKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64u(sig)}`;
}
export const vapidAuth = (jwt, publicKey) => `vapid t=${jwt}, k=${b64u(publicKey)}`;

// ---------- 암호화(RFC 8291, aes128gcm 레코드 하나) ----------
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const INFO_KEY = Buffer.from('WebPush: info\0', 'latin1');
const INFO_CEK = Buffer.from('Content-Encoding: aes128gcm\0\x01', 'latin1');
const INFO_NONCE = Buffer.from('Content-Encoding: nonce\0\x01', 'latin1');
function derive(ecdhSecret, authSecret, uaPublic, asPublic, salt) {
  const prkKey = hmac(authSecret, ecdhSecret);
  const ikm = hmac(prkKey, Buffer.concat([INFO_KEY, uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  return { cek: hmac(prk, INFO_CEK).subarray(0, 16), nonce: hmac(prk, INFO_NONCE).subarray(0, 12) };
}
export function subKeys(keys) {
  const ua = Buffer.isBuffer(keys && keys.p256dh) ? keys.p256dh : unb64u(keys && keys.p256dh);
  const auth = Buffer.isBuffer(keys && keys.auth) ? keys.auth : unb64u(keys && keys.auth);
  if (ua.length !== 65 || ua[0] !== 4) throw err('bad_keys', 'p256dh must be an uncompressed P-256 point');
  if (auth.length !== 16) throw err('bad_keys', 'auth must be 16 bytes');
  return { ua, auth };
}
// asPrivate·salt는 시험 벡터만 준다(평소에는 보낼 때마다 새로)
export function encryptPayload(plaintext, keys, { salt = crypto.randomBytes(16), asPrivate = null, rs = 4096 } = {}) {
  const { ua, auth } = subKeys(keys);
  const ecdh = crypto.createECDH('prime256v1');
  if (asPrivate) ecdh.setPrivateKey(Buffer.isBuffer(asPrivate) ? asPrivate : unb64u(asPrivate)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const { cek, nonce } = derive(ecdh.computeSecret(ua), auth, ua, asPublic, salt);
  const pt = Buffer.concat([Buffer.from(plaintext), Buffer.from([2])]); // 마지막 레코드의 구분 바이트, 덧붙임 없음
  if (pt.length + 16 > rs) throw err('too_big', 'payload does not fit one record');
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(rs, 16); head[20] = asPublic.length;
  return Buffer.concat([head, asPublic, ct]);
}
// 받는 쪽(브라우저)이 하는 일. 시험과 흉내 푸시 서비스가 쓴다
export function decryptPayload(body, { uaPrivate, auth }) {
  const b = Buffer.from(body);
  const salt = b.subarray(0, 16); const idlen = b[20];
  const asPublic = b.subarray(21, 21 + idlen); const ct = b.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(Buffer.isBuffer(uaPrivate) ? uaPrivate : unb64u(uaPrivate));
  const ua = ecdh.getPublicKey();
  const { cek, nonce } = derive(ecdh.computeSecret(asPublic), Buffer.isBuffer(auth) ? auth : unb64u(auth), ua, asPublic, salt);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let i = pt.length - 1; while (i >= 0 && pt[i] === 0) i--;
  if (i < 0 || pt[i] !== 2) throw new Error('bad padding');
  return pt.subarray(0, i);
}

// ---------- 무엇을 알리나 ----------
// 세션 요약(backend summary)과 직전 상태 → 'done' | 'need' | 'error' | 'exit' | null. 셸은 뺀다. 처음 보는 상태(from null)도 뺀다(백엔드를 다시 켬)
export function pushKindOf(sum, from) {
  if (!sum || sum.kind === 'shell' || from == null || from === sum.state) return null;
  const to = sum.state;
  if (to === 'ready' && from === 'working') return 'done';
  if (to === 'waiting' || to === 'trust_wait') return 'need';
  if (to === 'error') return 'error';
  if (to === 'exited' && sum.exit && sum.exit.kind === 'other') return 'exit'; // 사람이 끄거나 판이 끈 것(normal, herdr_stopped)은 알리지 않는다
  return null;
}
export const prefKind = (k) => (k === 'exit' ? 'error' : k);
const WORDS = {
  ko: { done: '끝남', need: '응답 필요', error: '오류', exit: '세션 꺼짐', many: '세션 {n}개', more: '외 {n}개', subs: '하위 {n}개 포함', testTitle: 'Atrium 시험 알림', testBody: '이 기기에서 알림을 받을 수 있습니다.' },
  en: { done: 'done', need: 'needs you', error: 'error', exit: 'session ended', many: '{n} sessions', more: '+{n} more', subs: 'incl. {n} sub-sessions', testTitle: 'Atrium test notification', testBody: 'This device can receive notifications.' },
};
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));
const clipName = (s, n = 40) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
export const langOf = (l) => (String(l || '').toLowerCase().startsWith('ko') ? 'ko' : 'en');
// items: [{ sessionId, name, kind, ws, subs? }]. 이름과 종류, 프로젝트 이름, 함께 일한 하위 세션 수(P92)만 쓴다
export function pushText(items, lang = 'en') {
  const w = WORDS[langOf(lang)];
  if (items.length === 1) {
    const it = items[0]; const subs = it.kind === 'done' && it.subs > 0 ? fill(w.subs, { n: it.subs }) : null;
    return { title: `@${clipName(it.name)} · ${w[it.kind] || it.kind}`, body: [clipName(it.ws, 60), subs].filter(Boolean).join(' · ') || 'Atrium' };
  }
  const shown = items.slice(0, BATCH_SHOW).map((it) => `@${clipName(it.name)} ${w[it.kind] || it.kind}`);
  const rest = items.length - shown.length;
  return { title: fill(w.many, { n: items.length }), body: shown.join(' · ') + (rest > 0 ? ` · ${fill(w.more, { n: rest })}` : '') };
}
// 알림 하나의 본문(암호화 전). 누르면 열 세션: 하나면 그것, 묶었으면 응답 필요가 먼저
export function pushPayload(items, lang, now = Date.now()) {
  const { title, body } = pushText(items, lang);
  const first = items.find((x) => x.kind === 'need') || items[0];
  return { v: 1, title, body, tag: items.length === 1 ? `atrium-${first.sessionId}` : 'atrium-batch', sessionId: first.sessionId, kind: items.length === 1 ? first.kind : 'batch', n: items.length, at: now };
}
export const testPayload = (lang, now = Date.now()) => { const w = WORDS[langOf(lang)]; return { v: 1, title: w.testTitle, body: w.testBody, tag: 'atrium-test', sessionId: null, kind: 'test', n: 0, at: now }; };

// ---------- 보내기(HTTPS) ----------
export function httpsPost(endpoint, { headers, body, timeoutMs = SEND_TIMEOUT_MS, ca = null, allowPrivate = false }) {
  return new Promise((resolve) => {
    let u; try { u = new URL(endpoint); } catch { resolve({ status: 0, error: 'bad_endpoint' }); return; }
    const req = https.request({ method: 'POST', hostname: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || 443, path: `${u.pathname}${u.search}`, headers: { ...headers, 'content-length': String(body.length) }, timeout: timeoutMs, lookup: guardLookup(allowPrivate), agent: false, ...(ca ? { ca } : {}) });
    req.on('response', (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, retryAfter: res.headers['retry-after'] || null })); res.on('error', () => resolve({ status: res.statusCode })); });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'timeout' })));
    req.on('error', (e) => resolve({ status: 0, error: /^[A-Za-z0-9_]{1,24}$/.test(String(e.code || '')) ? String(e.code).toLowerCase() : 'network' }));
    req.end(body);
  });
}

// ---------- 구독과 보내기 ----------
const okId = (s) => typeof s === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(s);
const prefsOf = (r) => ({ kinds: { ...DEFAULT_PREFS.kinds, ...((r && r.kinds) || {}) }, whilePc: !!(r && r.whilePc), sub: subModeOf(r && r.sub), muted: Array.isArray(r && r.muted) ? r.muted.filter(okId) : [] });
export class Pusher {
  // note(event, fields): 연결 기록(push.on, push.off, push.fail). watching(deviceId): 그 기기가 판 화면을 보고 있는가. pcActive(): PC에서 최근에 입력했는가
  // enabled(): 원격 접속 허용. wsName(key): 프로젝트 이름. transport(endpoint, opts): 시험이 바꾼다. onChange(): PC 창의 기기 목록을 다시 보낸다
  // P92: tree(): 판의 세션 [{ sessionId, parentSessionId, name, kind, state, workspaceKey, delivering, loops, bg }](사이클 판단). 없으면 받은 세션 하나만 본다
  //   settleMs: 쉬고 그대로여야 하는 시간, bgCapMs: 뒤 일만 남았을 때 기다리는 끝. timers: false면 사이클 시계를 돌리지 않는다(시험은 tickCycles를 부른다)
  constructor({ store, keyFile, subject, now = Date.now, log = () => {}, note = () => {}, watching = () => false, pcActive = () => false, enabled = () => true, wsName = () => null, transport = httpsPost, testOrigins = [], ca = null, batchMs = BATCH_MS, cooldownMs = COOLDOWN_MS, onChange = () => {}, tree = null, settleMs = SETTLE_MS, bgCapMs = BG_CAP_MS, timers = true }) {
    Object.assign(this, { store, keyFile, subject, now, log, note, watching, pcActive, enabled, wsName, transport, testOrigins, ca, batchMs, cooldownMs, onChange, tree, settleMs, bgCapMs, timers });
    this.cycles = new Map(); // P92: 세션 ID → { dirty, subs: Set, dueAt, quietSince, lastWhy }
    this.cycleTimer = null;
    this.seen = new Map(); // tree가 없을 때 받은 요약(세션 ID → 마디)
    this.mem = []; // store가 없을 때(시험)
    this.cool = new Map(); // `${sessionId}|${kind}` → 마지막으로 알릴 거리로 본 때
    this.pending = new Map(); // deviceId → { items: Map(sessionId → item), timer }
    this.jwts = new Map(); // aud → { token, exp }
    this.decisions = []; // 시험과 진단: { at, sessionId, kind, deviceId, why } (글 없음)
    this._keys = null;
  }
  records() { return (this.store ? this.store.getMeta(KEY) : this.mem) || []; }
  save(list) { if (this.store) this.store.setMeta(KEY, list); else this.mem = list; }
  rec(deviceId) { return this.records().find((r) => r.deviceId === deviceId) || null; }
  patch(deviceId, fn) {
    const list = this.records(); let r = list.find((x) => x.deviceId === deviceId);
    if (!r) { r = { deviceId, endpoint: null, ...prefsOf(null), createdAt: this.now() }; list.push(r); }
    fn(r); this.save(list); return r;
  }
  keys() { if (!this._keys) this._keys = this.keyFile ? loadVapidKeys(this.keyFile, this.now) : { ...makeVapidKeys(), createdAt: this.now() }; return this._keys; }
  publicKey() { return b64u(this.keys().publicKey); }
  decide(d) { this.decisions.push({ at: this.now(), ...d }); if (this.decisions.length > DECISIONS_MAX) this.decisions.shift(); }

  // 기기가 보는 상태(자기 것). PC 창은 deviceView
  status(deviceId) {
    const r = this.rec(deviceId);
    let host = null; if (r && r.endpoint) try { host = new URL(r.endpoint).hostname; } catch {}
    return { on: !!(r && r.endpoint), gone: !!(r && r.gone), ...prefsOf(r), lang: (r && r.lang) || null, lastSentAt: (r && r.lastSentAt) || null, lastFail: (r && r.lastFail) || null, host };
  }
  deviceView(deviceId) { const r = this.rec(deviceId); return { on: !!(r && r.endpoint), lastSentAt: (r && r.lastSentAt) || null, lastFail: (r && r.lastFail) || null }; }
  subscribe(deviceId, sub, lang) {
    if (!okId(deviceId)) throw err('forbidden', 'no device', 403);
    const endpoint = sub && sub.endpoint;
    const c = endpointCheck(endpoint, { testOrigins: this.testOrigins });
    if (!c.ok) { this.note('push.fail', { deviceId, reason: `endpoint_${c.reason}` }); throw err('bad_endpoint', `this push service is not allowed (${c.reason})`); }
    const { ua, auth } = subKeys(sub.keys);
    try { const e = crypto.createECDH('prime256v1'); e.generateKeys(); e.computeSecret(ua); } catch { throw err('bad_keys', 'p256dh is not a valid P-256 point'); }
    this.patch(deviceId, (r) => { Object.assign(r, { endpoint, p256dh: b64u(ua), auth: b64u(auth), lang: langOf(lang), subscribedAt: this.now(), gone: false, lastFail: null }); });
    this.note('push.on', { deviceId, host: c.host });
    this.onChange();
    return this.status(deviceId);
  }
  // why: user(기기가 끔) | blocked(원격 접속 막음) | gone_404·gone_410(푸시 서비스가 버림)
  unsubscribe(deviceId, why = 'user') {
    const r = this.rec(deviceId);
    if (!r || !r.endpoint) return this.status(deviceId);
    this.patch(deviceId, (x) => { x.endpoint = null; x.p256dh = null; x.auth = null; x.gone = why.startsWith('gone'); });
    this.dropPending(deviceId);
    this.note('push.off', { deviceId, reason: why });
    this.onChange();
    return this.status(deviceId);
  }
  // 짝 풀기: 기록째 지운다
  forget(deviceId, why = 'unpair') {
    const list = this.records(); const r = list.find((x) => x.deviceId === deviceId);
    if (!r) return false;
    this.save(list.filter((x) => x !== r)); this.dropPending(deviceId);
    if (r.endpoint) this.note('push.off', { deviceId, reason: why });
    return true;
  }
  dropAll(why = 'blocked') { let n = 0; for (const r of this.records()) if (r.endpoint) { this.unsubscribe(r.deviceId, why); n++; } return n; }
  setPrefs(deviceId, p = {}) {
    const subOk = typeof p.sub === 'string' && subModeOf(p.sub) === p.sub;
    const muteOk = !!(p.mute && typeof p.mute === 'object' && okId(p.mute.sessionId) && typeof p.mute.on === 'boolean');
    if (!this.rec(deviceId) && !p.kinds && typeof p.whilePc !== 'boolean' && !subOk && !muteOk) return this.status(deviceId); // 말만 바꾸면 기록을 만들지 않는다
    this.patch(deviceId, (r) => {
      if (p.kinds && typeof p.kinds === 'object') { r.kinds = prefsOf(r).kinds; for (const k of PUSH_KINDS) if (typeof p.kinds[k] === 'boolean') r.kinds[k] = p.kinds[k]; }
      if (typeof p.whilePc === 'boolean') r.whilePc = p.whilePc;
      if (subOk) r.sub = p.sub; // P92: 하위 세션(워커) 알림
      if (muteOk) { const m = prefsOf(r).muted.filter((x) => x !== p.mute.sessionId); if (p.mute.on) m.push(p.mute.sessionId); r.muted = m.slice(-MUTED_MAX); } // P92: 세션 하나 끄기
      if (typeof p.lang === 'string') r.lang = langOf(p.lang); // 알림 글의 말
    });
    this.onChange();
    return this.status(deviceId);
  }
  dropPending(deviceId) { const q = this.pending.get(deviceId); if (q) { clearTimeout(q.timer); this.pending.delete(deviceId); } }

  // 세션 상태가 바뀌었다(backend broadcastSession). 응답 필요·오류·끝남은 곧바로 구독한 기기마다 묶음에 넣고,
  // 일이 끝남(done)은 작업 사이클이 끝날 때 넣는다(P92, tickCycles). 돌려주는 값은 이 바뀜의 종류(시험과 진단)
  onState(sum, from) {
    const kind = pushKindOf(sum, from);
    let tree = null;
    if (from != null && sum && sum.kind !== 'shell') { tree = this.treeNow(sum); this.trackCycle(sum, tree); }
    if (!kind || kind === 'done') return kind;
    this.dispatch({ sessionId: sum.sessionId, name: sum.name, kind, workspaceKey: sum.workspaceKey }, (tree || this.treeNow(sum)).isSub(sum.sessionId));
    return kind;
  }
  // 판의 세션 나무. 막 바뀐 세션은 받은 요약(sum)의 상태로 맞춘다
  treeNow(sum = null) {
    let nodes = [];
    try { nodes = this.tree ? this.tree() || [] : [...this.seen.values()]; } catch (e) { this.log(`push tree error: ${e.message}`); }
    if (sum) {
      const i = nodes.findIndex((n) => n.sessionId === sum.sessionId);
      const base = i >= 0 ? nodes[i] : { parentSessionId: sum.parentSessionId || null, delivering: sum.delivering || 0, loops: sum.loops || 0, bg: null };
      const mine = { ...base, sessionId: sum.sessionId, name: sum.name, kind: sum.kind, state: sum.state, workspaceKey: sum.workspaceKey };
      nodes = i >= 0 ? nodes.map((n, j) => (j === i ? mine : n)) : [...nodes, mine];
      if (!this.tree) { this.seen.delete(sum.sessionId); this.seen.set(sum.sessionId, mine); if (this.seen.size > 500) this.seen.delete(this.seen.keys().next().value); } // tree가 없으면(시험) 받은 요약을 모아 둔다
    }
    return treeIndex(nodes);
  }
  // 알릴 거리 하나(sessionId, name, kind, workspaceKey, subs?)를 기기마다 묶음에 넣는다. isSub: 하위 세션(부모가 판에 열려 있음)
  dispatch(it, isSub) {
    const { kind } = it;
    const subs = this.records().filter((r) => r.endpoint);
    if (!subs.length) return;
    const t = this.now(); const ck = `${it.sessionId}|${kind}`;
    const last = this.cool.get(ck);
    if (last != null && t - last < this.cooldownMs) { this.decide({ sessionId: it.sessionId, kind, deviceId: null, why: 'cooldown' }); return; }
    this.cool.set(ck, t);
    if (this.cool.size > 500) for (const [k, v] of this.cool) if (t - v > this.cooldownMs) this.cool.delete(k);
    let ws = null; try { ws = it.workspaceKey ? this.wsName(it.workspaceKey) : null; } catch {}
    const item = { sessionId: it.sessionId, name: it.name, kind, ws, at: t, ...(it.subs ? { subs: it.subs } : {}) };
    for (const r of subs) {
      const pr = prefsOf(r);
      if (!pr.kinds[prefKind(kind)]) { this.decide({ sessionId: item.sessionId, kind, deviceId: r.deviceId, why: 'kind_off' }); continue; }
      if (pr.muted.includes(item.sessionId)) { this.decide({ sessionId: item.sessionId, kind, deviceId: r.deviceId, why: 'muted' }); continue; }
      if (isSub && !subAllows(pr.sub, kind)) { this.decide({ sessionId: item.sessionId, kind, deviceId: r.deviceId, why: pr.sub === 'off' ? 'sub-off' : 'sub-session' }); continue; }
      let q = this.pending.get(r.deviceId);
      if (!q) { q = { items: new Map(), timer: null }; this.pending.set(r.deviceId, q); q.timer = setTimeout(() => { this.flush(r.deviceId).catch((e) => this.log(`push flush error: ${e.message}`)); }, this.batchMs); q.timer.unref?.(); }
      q.items.delete(item.sessionId); q.items.set(item.sessionId, item); // 같은 세션은 마지막 것
    }
  }

  // ---------- P92: 작업 사이클 ----------
  // 세션 X의 상태가 바뀌면 X와 그 조상마다: X가 일하기 시작하면 사이클을 연다(dirty), 쉬면 열린 사이클의 시계를 다시 건다(settleMs 뒤 판단)
  trackCycle(sum, tree) {
    const t = this.now(); const x = sum.sessionId; const busy = sum.state === 'working'; // 새로 뜨는 세션(starting → ready)은 일한 것이 아니다
    for (const a of tree.chain(x)) {
      let c = this.cycles.get(a);
      if (!c) { if (!busy) continue; c = { dirty: false, subs: new Set(), dueAt: null, quietSince: null, lastWhy: null }; this.cycles.set(a, c); }
      if (busy) {
        if (a === x && c.dueAt != null) this.decide({ sessionId: a, kind: 'done', deviceId: null, why: 'busy-again' }); // 정한 시간 안에 다시 일함
        c.dirty = true; c.dueAt = null; c.lastWhy = null;
        if (a !== x) c.subs.add(x);
      } else if (c.dirty) { c.dueAt = t + this.settleMs; c.quietSince = t; c.lastWhy = null; }
    }
    if (this.cycles.size > 500) for (const [k, c] of this.cycles) if (!c.dirty) this.cycles.delete(k);
    this.armCycleTimer();
  }
  armCycleTimer() {
    if (!this.timers || this.cycleTimer || ![...this.cycles.values()].some((c) => c.dueAt != null)) return;
    this.cycleTimer = setInterval(() => { try { this.tickCycles(); } catch (e) { this.log(`push cycle error: ${e.message}`); } }, 1000);
    this.cycleTimer.unref?.();
  }
  // 시계가 다 된 사이클을 판단한다. 끝났으면 done을 넣고, 전달·루프·뒤 일이 남았으면 settleMs 뒤에 다시 본다.
  // 뒤 일만 남은 채 bgCapMs 동안 나무가 그대로면 끝난 것으로 본다(뒤에 서버를 띄워 둔 경우)
  tickCycles(t = this.now()) {
    const due = [...this.cycles].filter(([, c]) => c.dueAt != null && c.dueAt <= t);
    if (due.length) {
      const tree = this.treeNow();
      for (const [id, c] of due) {
        c.dueAt = null;
        if (!tree.byId.has(id)) { this.cycles.delete(id); continue; }
        const r = cycleCheck(id, tree);
        const capped = !r.ok && r.why === 'background-task' && c.quietSince != null && t - c.quietSince >= this.bgCapMs;
        if (r.ok || capped) {
          const n = tree.byId.get(id);
          const worked = c.subs.size; c.dirty = false; c.subs = new Set(); c.lastWhy = null;
          if (capped) this.decide({ sessionId: id, kind: 'done', deviceId: null, why: 'background-cap' });
          this.dispatch({ sessionId: id, name: n.name, kind: 'done', workspaceKey: n.workspaceKey, subs: worked }, tree.isSub(id));
          continue;
        }
        if (r.why !== c.lastWhy) { this.decide({ sessionId: id, kind: 'done', deviceId: null, why: r.why }); c.lastWhy = r.why; }
        if (r.retry) c.dueAt = t + this.settleMs;
      }
    }
    if (this.cycleTimer && ![...this.cycles.values()].some((c) => c.dueAt != null)) { clearInterval(this.cycleTimer); this.cycleTimer = null; }
  }
  cycleView() { return [...this.cycles].map(([sessionId, c]) => ({ sessionId, dirty: c.dirty, subs: c.subs.size, dueAt: c.dueAt, lastWhy: c.lastWhy })); }
  // 묶음을 보낸다. 보는 중, PC 사용 중, 원격 막음은 이때 다시 본다
  async flush(deviceId) {
    const q = this.pending.get(deviceId); this.pending.delete(deviceId);
    if (!q || !q.items.size) return null;
    clearTimeout(q.timer);
    const items = [...q.items.values()];
    const r = this.rec(deviceId);
    const skip = (why) => { for (const it of items) this.decide({ sessionId: it.sessionId, kind: it.kind, deviceId, why }); return { sent: false, why }; };
    if (!r || !r.endpoint) return skip('no_sub');
    if (!this.enabled()) return skip('blocked');
    let watching = false; try { watching = !!this.watching(deviceId); } catch {}
    if (watching) return skip('watching');
    let pc = false; try { pc = !!this.pcActive(); } catch {}
    if (pc && !prefsOf(r).whilePc) return skip('pc_active');
    const res = await this.deliver(r, pushPayload(items, r.lang, this.now()), items.some((x) => x.kind !== 'done'));
    for (const it of items) this.decide({ sessionId: it.sessionId, kind: it.kind, deviceId, why: res.ok ? 'sent' : `fail_${res.reason}` });
    return { sent: res.ok, n: items.length, ...res };
  }
  // 시험 알림(기기 설정과 보는 중을 따지지 않는다)
  async test(deviceId) {
    const r = this.rec(deviceId);
    if (!r || !r.endpoint) throw err('not_subscribed', 'notifications are off on this device', 409);
    return this.deliver(r, testPayload(r.lang, this.now()), true);
  }
  jwtFor(aud) {
    const t = this.now(); const c = this.jwts.get(aud);
    if (c && c.exp - t > 3600_000) return c.token;
    const token = vapidJwt({ aud, sub: this.subject, jwk: this.keys().jwk, now: t });
    this.jwts.set(aud, { token, exp: t + JWT_TTL_SEC * 1000 });
    return token;
  }
  async deliver(r, payload, urgent) {
    if (!this.enabled()) return { ok: false, reason: 'blocked' };
    const check = endpointCheck(r.endpoint, { testOrigins: this.testOrigins });
    if (!check.ok) { this.unsubscribe(r.deviceId, `endpoint_${check.reason}`); return { ok: false, reason: `endpoint_${check.reason}` }; }
    const { endpoint, p256dh, auth, subscribedAt } = r;
    let body;
    try { body = encryptPayload(Buffer.from(JSON.stringify(payload)), { p256dh: r.p256dh, auth: r.auth }); } catch (e) { return this.failed(r, e.code || 'encrypt'); }
    if (body.length > MAX_BODY) return this.failed(r, 'too_big');
    const headers = { TTL: String(TTL_SEC), Urgency: urgent ? 'high' : 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidAuth(this.jwtFor(new URL(endpoint).origin), this.keys().publicKey) };
    let res; try { res = await this.transport(endpoint, { headers, body, ca: check.test ? this.ca : null, allowPrivate: !!check.test }); } catch (e) { res = { status: 0, error: 'network' }; }
    const cur = this.rec(r.deviceId);
    if (!cur || cur.endpoint !== endpoint || cur.p256dh !== p256dh || cur.auth !== auth || cur.subscribedAt !== subscribedAt) return { ok: false, reason: 'changed' }; // 그새 끄거나 바꿨다
    if (res.status >= 200 && res.status < 300) { this.patch(r.deviceId, (x) => { x.lastSentAt = this.now(); x.lastFail = null; }); this.onChange(); return { ok: true, status: res.status }; }
    if (res.status === 404 || res.status === 410) { this.unsubscribe(r.deviceId, `gone_${res.status}`); return { ok: false, reason: `gone_${res.status}`, status: res.status }; }
    return this.failed(r, res.status ? `http_${res.status}` : res.error || 'network', res.status);
  }
  failed(r, reason, status = 0) {
    this.patch(r.deviceId, (x) => { x.lastFail = { at: this.now(), reason }; });
    this.note('push.fail', { deviceId: r.deviceId, reason });
    this.onChange();
    return { ok: false, reason, ...(status ? { status } : {}) };
  }
  stop() { for (const q of this.pending.values()) clearTimeout(q.timer); this.pending.clear(); if (this.cycleTimer) clearInterval(this.cycleTimer); this.cycleTimer = null; }
}
