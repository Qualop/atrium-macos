// P48(원격 R2): 백엔드가 창 화면(app/dist)을 같은 포트의 HTTP로 내주고, 브라우저를 짝 맺어 판 API를 쓰게 한다(P56부터 패스키 로그인 세션으로).
// - 화면: GET /(index.html), /renderer.js 등. index.html·renderer.*는 ETag로 다시 확인(no-cache), fonts/는 이름에 해시가 있어 오래 둔다. gzip을 받으면 줄여 보낸다.
// - 짝 맺기: PC 창(판 API 토큰 클라이언트)이 만든 일회용 코드를 넣거나(POST /web/pair/code), 브라우저가 허락을 청하고(POST /web/pair/request) PC 창이 허락하면
//   몇 분 동안 한 번만 쓰는 등록 허가를 받는다(GET /web/pair/poll). P56: 그 브라우저에서 패스키를 등록해야(POST /web/passkey/register) 기기가 생긴다(web-auth.mjs).
// - P56 로그인: 패스키로 서명하면(POST /web/passkey/login) 세션을 HttpOnly 쿠키로 준다. WebSocket /api와 /web/me, /web/upload는 이 쿠키로만 인증한다.
//   옛 기기 토큰(?device=, Authorization: Bearer)은 받지 않는다. 판 API 토큰(backend.json)은 브라우저에 내주지 않는다.
// - 막기: Host는 127.0.0.1·localhost(그 포트)와 ATRIUM_WEB_HOSTS만 받는다(DNS 다시 묶기). 기기 연결은 Origin이 그 주소여야 한다.
//   hook(/hooks/claude)과 하위 세션 명령(/branch/*)은 이 PC의 프로세스만 부른다(isLocalProcess: Host 127.0.0.1, Origin·전달 머리글 없음).
// - 폴더 목록(fs.roots, fs.list)과 업로드(데이터 폴더 uploads/, 크기 상한, 오래된 것 지우기)는 웹 화면의 폴더 탐색기와 붙여넣기가 쓴다.
// - P58(S4): 원격 일을 연결 기록(remote-log.mjs)에 남기고, 기기가 새로 붙거나 짝을 맺으면 PC 창에 remote.connected를 보낸다.
//   PC에서 끊기(device.disconnect, 4402)와 원격 받기 스위치(판 설정 remoteAccess, 끄면 바깥 요청과 기기 연결을 모두 거부하고 붙은 연결을 4403으로 닫는다).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { BACKEND_ROOT, envVar } from './config.mjs';
import { loginAllowed, parseLogins, isRemoteRequest, diagnose, requestAddr, nodeCheck, whoisMatch, needsRepair } from './tailscale.mjs'; // P49(R3), P57(기기 확인)
import { WebAuth, sessionIdOf, sessionCookie, clearCookies, isHttpsOrigin, sentSecureCookie, COOKIE_MAX_MS } from './web-auth.mjs'; // P56(S2·S3)
import { PasskeyError, passkeyKind } from './passkey.mjs';
import { RemoteLog, ConnectWatch, browserOf } from './remote-log.mjs'; // P58(S4): 연결 기록, 새로 붙음 알림
import { Pusher } from './web-push.mjs'; // P88: 웹 푸시
import { ACTIVE_MS } from './multiclient.mjs';
import { UPDATE_REPO } from './update.mjs';

export const PAIR_CODE_TTL_MS = 5 * 60_000;
export const PAIR_REQUEST_TTL_MS = 2 * 60_000;
export const PAIR_FAIL_WINDOW_MS = 10 * 60_000;
export const PAIR_FAIL_PER_IP = 5; // 10분에 한 곳에서 틀릴 수 있는 횟수
export const PAIR_FAIL_GLOBAL = 20; // 10분에 모두 합쳐 틀릴 수 있는 횟수
export const PAIR_CODE_MAX_FAILS = 5; // 지금 코드가 이만큼 틀리면 그 코드를 버린다
export const PAIR_REQUESTS_PENDING_MAX = 3;
export const PAIR_REQUESTS_PER_WINDOW = 10;
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const UPLOAD_MAX_AGE_MS = 7 * 24 * 3600_000;
export const UPLOAD_MAX_TOTAL = 500 * 1024 * 1024;
export const LIST_MAX = 1000;
const DEVICES_KEY = 'webDevices';
const REMOTE_KEY = 'remoteEnabled';
const TOUCH_EVERY_MS = 60_000;

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const clipName = (s, n = 40) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const apiErr = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
// P57: 기기 기록에 둘 Tailscale 기기(바깥에서 짝 맺음) 또는 이 PC 안 표시
const nodeRecord = (n) => (n && n.id ? { origin: 'tailscale', tsNode: { id: String(n.id), name: clipName(n.name, 80) || null, login: n.login ? String(n.login) : null } } : { origin: 'local' });
const NODE_REPAIR = new Set(['not_bound', 'local_only', 'other_node', 'other_user']);
const NODE_MSG = {
  not_bound: 'this device was paired before devices were bound to a Tailscale device; pair it again',
  local_only: 'this device was paired on this PC and can be used only on this PC',
  other_node: 'this device was paired from a different Tailscale device',
  other_user: 'this device was paired by a different Tailscale user',
  login_mismatch: 'the Tailscale user does not match the requesting device',
};
// 기기 확인 실패: 묶인 기기와 다르면 401(브라우저가 토큰을 버리고 짝 맺기 화면으로), whois를 못 읽거나 맞지 않으면 403
const nodeErr = (reason) => Object.assign(apiErr('tailscale_node', NODE_MSG[reason] || 'the requesting Tailscale device could not be verified', NODE_REPAIR.has(reason) ? 401 : 403), { reason }); // reason: 연결 기록과 웹 화면이 보일 까닭(P59, 비밀 아님)
// 짝 맺기 요청을 보낸 곳과 토큰을 받으러 온 곳이 같은가(이 PC 안끼리, 같은 Tailscale 기기끼리)
const sameNode = (a, b) => (a && a.id ? !!(b && b.id) && safeEq(a.id, b.id) : !(b && b.id));

// P60: serve 켜기 명령(글). 실행하지 않는다. 개발용 판이면 --dev를 붙인다
const quoteArg = (a) => (/[\s"]/.test(a) ? `"${a}"` : a);
export function enableCommand(httpsPort, cfg = {}, root = BACKEND_ROOT) {
  const bin = path.join(root, 'bin', 'atrium.mjs');
  return ['node', quoteArg(bin), ...(cfg.profile === 'dev' ? ['--dev'] : []), 'remote', 'enable', '--yes', ...(Number(httpsPort) && Number(httpsPort) !== 443 ? ['--https-port', String(Number(httpsPort))] : [])].join(' ');
}

// ---------- 기기(P56: 패스키의 공개 키를 판 기록에 둔다) ----------
// 옛 기기(P48~P55의 토큰 기기, hash만 있고 passkey가 없다)는 더 쓸 수 없다. 목록에 needsRepair로 보이고 PC에서 지운다
// P57: 패스키가 있어도 Tailscale 기기 기록(origin)이 없으면 다시 짝 맺어야 한다(needsRepair, 막는 쪽)
// P62: 패스키 없이 짝 맺은 기기(pairOnly, 패스키 끔)는 옛 기기가 아니다. 그 밖에 패스키가 없는 기기(P48~P55의 토큰 기기)는 여전히 다시 짝 맺어야 한다
export const devicePub = ({ hash, passkey, ...d }) => ({ ...d, needsRepair: (!passkey && !d.pairOnly) || needsRepair(d), passkey: passkey ? { rpId: passkey.rpId, alg: passkey.alg, createdAt: passkey.createdAt, lastUsedAt: passkey.lastUsedAt || null, backupEligible: !!passkey.backupEligible, backedUp: !!passkey.backedUp, transports: Array.isArray(passkey.transports) ? passkey.transports : [], kind: passkeyKind(passkey) } : null }); // P60: 패스키 종류(휴대폰·이 기기·보안 키)
export class Devices {
  constructor({ store, now = Date.now }) { this.store = store; this.now = now; }
  all() { return this.store.getMeta(DEVICES_KEY) || []; }
  save(list) { this.store.setMeta(DEVICES_KEY, list); }
  // 화면에 보일 목록(해시와 공개 키는 빼고)
  list() { return this.all().map(devicePub); }
  get(id) { const d = this.all().find((x) => x.id === id); return d ? devicePub(d) : null; }
  // extra: 다른 단계가 짝 맺기에서 더하는 필드(그대로 둔다). P57: 등록 허가의 extra = nodeRecord(짝 맺은 Tailscale 기기) → origin, tsNode
  add({ name, via, userAgent, passkey, extra = {} }) {
    const d = { ...extra, id: crypto.randomUUID(), name: clipName(name) || 'Browser', via, userAgent: clipName(userAgent, 160), createdAt: this.now(), lastSeenAt: null, passkey };
    this.save([...this.all(), d]);
    return devicePub(d);
  }
  // credential ID(비밀 아님)로 기기 기록을 찾는다(공개 키가 든 원래 기록)
  byCred(credId) {
    if (!credId || typeof credId !== 'string') return null;
    return this.all().find((x) => x.passkey && typeof x.passkey.credId === 'string' && safeEq(x.passkey.credId, credId)) || null;
  }
  // P62: 패스키 없는 기기에 패스키를 단다(한 번). 이미 있으면 false
  attachPasskey(id, passkey) { const list = this.all(); const d = list.find((x) => x.id === id); if (!d || d.passkey) return false; d.passkey = passkey; delete d.pairOnly; this.save(list); return true; }
  setPasskey(id, patch) { const list = this.all(); const d = list.find((x) => x.id === id); if (!d || !d.passkey) return false; Object.assign(d.passkey, patch); this.save(list); return true; }
  touch(id, force = false) {
    const list = this.all(); const d = list.find((x) => x.id === id);
    if (!d) return;
    const t = this.now();
    if (!force && d.lastSeenAt && t - d.lastSeenAt < TOUCH_EVERY_MS) return;
    d.lastSeenAt = t; this.save(list);
  }
  revoke(id) {
    const list = this.all(); const d = list.find((x) => x.id === id);
    if (!d) return false;
    this.save(list.filter((x) => x.id !== id));
    return true;
  }
  rename(id, name) { const list = this.all(); const d = list.find((x) => x.id === id); if (!d || !clipName(name)) return false; d.name = clipName(name); this.save(list); return true; }
}

// ---------- 짝 맺기(일회용 코드, 허락 요청, 횟수 제한) ----------
export class Pairing {
  // P56: 짝 맺기에 성공하면 기기 대신 등록 허가(grants.issue)를 준다
  constructor({ devices, grants, now = Date.now, onChange = () => {} }) {
    this.devices = devices; this.grants = grants; this.now = now; this.onChange = onChange;
    this.code = null; // { code, expiresAt, fails }
    this.requests = new Map(); // id → { id, secretHash, name, ip, userAgent, origin, createdAt, expiresAt, status, grant? }
    this.fails = []; // [{ at, ip }]
    this.requestTimes = [];
  }
  // PC 창이 만든다. 이전 코드는 버린다
  newCode() {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    this.code = { code, expiresAt: this.now() + PAIR_CODE_TTL_MS, fails: 0 };
    this.onChange();
    return { code, expiresAt: this.code.expiresAt };
  }
  currentCode() { const c = this.code; return c && c.expiresAt > this.now() ? { code: c.code, expiresAt: c.expiresAt } : null; }
  cancelCode() { this.code = null; this.onChange(); }
  // 틀린 시도. 10분 창 안에서 그곳·모두의 횟수를 센다
  limited(ip) {
    const t = this.now();
    this.fails = this.fails.filter((f) => t - f.at < PAIR_FAIL_WINDOW_MS);
    const mine = this.fails.filter((f) => f.ip === ip);
    if (mine.length >= PAIR_FAIL_PER_IP || this.fails.length >= PAIR_FAIL_GLOBAL) {
      const oldest = (mine.length >= PAIR_FAIL_PER_IP ? mine : this.fails)[0];
      return { retryAfterMs: PAIR_FAIL_WINDOW_MS - (t - oldest.at) };
    }
    return null;
  }
  // P57: tsNode = 짝 맺기를 청한 Tailscale 기기(이 PC 안이면 null). 허가의 extra로 넘겨 패스키 등록 때 기기 기록에 넣는다
  redeem({ code, name, ip, userAgent, origin, tsNode = null }) {
    const lim = this.limited(ip);
    if (lim) throw Object.assign(apiErr('rate_limited', 'too many pairing attempts', 429), { retryAfterMs: lim.retryAfterMs });
    const c = this.code;
    const ok = c && c.expiresAt > this.now() && typeof code === 'string' && /^\d{6}$/.test(code.trim()) && safeEq(c.code, code.trim());
    if (!ok) {
      this.fails.push({ at: this.now(), ip });
      if (c) { c.fails++; if (c.fails >= PAIR_CODE_MAX_FAILS || c.expiresAt <= this.now()) { this.code = null; this.onChange(); } }
      throw apiErr(c && c.expiresAt > this.now() ? 'bad_code' : 'no_code', 'the code is wrong or expired', 403);
    }
    this.code = null; // 한 번만
    const r = this.grants.issue({ name: clipName(name) || 'Browser', via: 'code', userAgent: clipName(userAgent, 160), origin, extra: nodeRecord(tsNode) });
    this.onChange();
    return r;
  }
  sweep() {
    const t = this.now();
    let changed = false;
    for (const [id, r] of this.requests) {
      if (r.status === 'pending' && r.expiresAt <= t) { r.status = 'expired'; changed = true; }
      if (t - r.createdAt > PAIR_REQUEST_TTL_MS * 3) { this.requests.delete(id); changed = true; }
    }
    if (this.code && this.code.expiresAt <= t) { this.code = null; changed = true; }
    if (changed) this.onChange();
  }
  request({ name, ip, userAgent, origin, tsNode = null }) {
    this.sweep();
    const t = this.now();
    this.requestTimes = this.requestTimes.filter((x) => t - x < PAIR_FAIL_WINDOW_MS);
    const pending = [...this.requests.values()].filter((r) => r.status === 'pending');
    if (pending.length >= PAIR_REQUESTS_PENDING_MAX || this.requestTimes.length >= PAIR_REQUESTS_PER_WINDOW) throw apiErr('rate_limited', 'too many pairing requests', 429);
    this.requestTimes.push(t);
    const id = crypto.randomUUID();
    const secret = crypto.randomBytes(24).toString('base64url');
    // 짧은 확인 글자: PC 창과 브라우저에 같이 보여 맞는 기기인지 사람이 견준다
    const check = String(crypto.randomInt(0, 10_000)).padStart(4, '0');
    this.requests.set(id, { id, secretHash: sha256(secret), name: clipName(name) || 'Browser', ip, userAgent: clipName(userAgent, 160), origin, createdAt: t, expiresAt: t + PAIR_REQUEST_TTL_MS, status: 'pending', check, tsNode: tsNode && tsNode.id ? tsNode : null });
    this.onChange();
    return { requestId: id, secret, check, expiresAt: t + PAIR_REQUEST_TTL_MS };
  }
  pending() { this.sweep(); return [...this.requests.values()].filter((r) => r.status === 'pending').map(({ id, name, ip, userAgent, createdAt, expiresAt, check, tsNode }) => ({ id, name, ip, userAgent, createdAt, expiresAt, check, tsNode: tsNode ? { name: tsNode.name, login: tsNode.login } : null })); }
  decide(id, allow) {
    this.sweep();
    const r = this.requests.get(id);
    if (!r || r.status !== 'pending') throw apiErr('not_found', 'no such pending request', 404);
    if (allow) { const x = this.grants.issue({ name: r.name, via: 'approve', userAgent: r.userAgent, origin: r.origin, extra: nodeRecord(r.tsNode) }); r.status = 'approved'; r.grant = x; }
    else r.status = 'denied';
    this.onChange();
    return { status: r.status };
  }
  // 브라우저가 묻는다. 허락된 등록 허가는 한 번만 내준다
  // P57: tsNode = 지금 묻는 Tailscale 기기(이 PC 안이면 null). 요청을 보낸 곳과 다르면 없는 요청처럼 다룬다
  poll(id, secret, tsNode = null) {
    this.sweep();
    const r = this.requests.get(String(id || ''));
    if (!r || !safeEq(r.secretHash, sha256(secret || ''))) throw apiErr('not_found', 'no such request', 404);
    if (!sameNode(r.tsNode, tsNode)) throw apiErr('not_found', 'no such request', 404);
    if (r.status === 'approved' && r.grant) { const g = r.grant; r.grant = null; r.status = 'taken'; return { status: 'approved', grant: g.grant, expiresAt: g.expiresAt }; }
    return { status: r.status === 'taken' ? 'expired' : r.status };
  }
}

// ---------- Host·Origin ----------
export function allowedHosts(port, extra = envVar('WEB_HOSTS') || '') {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  for (const h of String(extra).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) hosts.add(h);
  return hosts;
}
export const hostOk = (req, hosts) => hosts.has(String(req.headers.host || '').toLowerCase());
// 기기 연결: Origin이 꼭 있고 받는 주소(요청의 Host, 포트까지)와 같아야 한다.
// 쿠키와 패스키(RP ID)는 포트를 가리지 않으므로, 같은 Tailscale 이름의 다른 포트 서비스(serve의 다른 항목)에서 온 페이지가 판을 부르지 못하게 한다
export function originOk(req, hosts) {
  const o = req.headers.origin;
  if (!o) return false;
  try {
    const u = new URL(o);
    const oh = u.host.toLowerCase();
    return (u.protocol === 'http:' || u.protocol === 'https:') && hosts.has(oh) && oh === String(req.headers.host || '').toLowerCase();
  } catch { return false; }
}
const FORWARD_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip'];
// 이 PC의 프로세스가 직접 부른 요청인지(브라우저도, 앞단 프록시를 거친 것도 아니다). hook·branch·판 API 토큰 연결이 쓴다.
// allowFileOrigin: Electron 창(file:// 페이지)의 WebSocket은 Origin "file://"(또는 "null")을 보낸다
export function isLocalProcess(req, port, { allowFileOrigin = false } = {}) {
  const h = req.headers;
  if (String(h.host || '').toLowerCase() !== `127.0.0.1:${port}` && String(h.host || '').toLowerCase() !== `localhost:${port}`) return false;
  if (FORWARD_HEADERS.some((k) => h[k] != null) || Object.keys(h).some((k) => k.startsWith('tailscale-'))) return false;
  const a = req.socket && req.socket.remoteAddress;
  if (a && !/^(127\.|::1$|::ffff:127\.)/.test(a)) return false;
  if (h.origin != null) return allowFileOrigin && (h.origin === 'file://' || h.origin === 'null');
  if (h['sec-fetch-site'] != null) return false; // 브라우저가 보낸 요청
  return true;
}
export function clientIp(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  const xf = req.headers['x-forwarded-for'];
  if (xf && /^(127\.|::1$|::ffff:127\.)/.test(a)) return String(xf).split(',')[0].trim(); // 이 PC의 앞단 프록시(R3)가 넣은 값만 믿는다
  return a;
}

// ---------- 화면 파일 ----------
export const WEB_DIST = () => path.resolve(envVar('WEB_DIST') || path.join(BACKEND_ROOT, '..', 'app', 'dist'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8' }; // P49: PWA 매니페스트
const ZIP = new Set(['.html', '.js', '.css', '.map', '.json', '.svg', '.txt', '.webmanifest']);
export function cacheControl(rel) {
  if (/^fonts\//.test(rel)) return 'public, max-age=31536000, immutable'; // 이름에 해시가 있다(build.mjs assetNames)
  return 'no-cache'; // ETag로 다시 확인한다. 바뀌지 않았으면 304. P74: sw.js도 늘 다시 확인한다(새 버전이면 껍데기를 바꾼다)
}
// P74: 서비스 워커 스크립트. 브라우저는 등록·갱신 때 "Service-Worker: script" 머리글을 붙인다.
// 그 요청은 이 파일만 내준다(다른 화면 파일을 서비스 워커로 등록하지 못하게). 범위는 / 하나다(Service-Worker-Allowed를 주지 않는다)
export const SW_FILE = 'sw.js';
export const swScriptOk = (rel, headers = {}) => String(headers['service-worker'] || '').toLowerCase() !== 'script' || rel === SW_FILE;
const SECURITY_HEADERS = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cross-origin-opener-policy': 'same-origin' };
const NO_BUILD = `<!doctype html><html><head><meta charset="utf-8"><title>Atrium</title><style>body{background:#070705;color:#e9e6dc;font:15px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh}div{max-width:520px;padding:24px}code{background:#1d1c18;padding:2px 6px;border-radius:4px}</style></head>
<body><div><h2>The board screen is not built</h2><p>The backend serves the window from <code>app/dist</code>, which does not exist yet. On the PC, run <code>cd app &amp;&amp; npm run build</code>, then reload this page.</p>
<h2>화면 빌드가 없습니다</h2><p>백엔드는 <code>app/dist</code>의 화면을 내줍니다. PC에서 <code>cd app &amp;&amp; npm run build</code>를 실행한 뒤 이 페이지를 다시 엽니다.</p></div></body></html>`;

// P58: 원격 받기가 꺼진 동안 바깥에서 온 화면 요청에 주는 쪽(15초마다 다시 읽는다)
const BLOCKED_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="15"><title>Atrium</title><style>body{background:#070705;color:#e9e6dc;font:15px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh}div{max-width:520px;padding:24px}</style></head>
<body><div data-role="remote-blocked"><h2>Remote access is blocked on the PC</h2><p>Someone at the PC turned off remote access to this board. This page tries again every 15 seconds.</p>
<h2>원격 접속이 차단되어 있습니다</h2><p>PC에서 이 보드의 원격 접속을 차단했습니다. 이 페이지는 15초마다 다시 시도합니다.</p></div></body></html>`;

export class StaticFiles {
  constructor(dir) { this.dir = dir; this.zipped = new Map(); }
  built() { return fs.existsSync(path.join(this.dir, 'index.html')); }
  // 처리했으면 true
  serve(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''); } catch { return false; }
    if (rel === '') rel = 'index.html';
    if (!/^[A-Za-z0-9._\-/]+$/.test(rel) || rel.split('/').some((p) => p === '..' || p === '' || p.startsWith('.'))) return false;
    if (!swScriptOk(rel, req.headers)) return false; // P74
    const file = path.resolve(this.dir, rel);
    if (!file.startsWith(path.resolve(this.dir) + path.sep)) return false;
    if (!this.built()) {
      if (rel !== 'index.html') return false;
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS }); res.end(NO_BUILD); return true;
    }
    let st; try { st = fs.statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const head = { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': cacheControl(rel), etag, ...SECURITY_HEADERS };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return true; }
    let body = fs.readFileSync(file);
    if (ZIP.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) && body.length > 1024) {
      const k = `${file}|${etag}`;
      if (!this.zipped.has(k)) { for (const key of this.zipped.keys()) if (key.startsWith(`${file}|`)) this.zipped.delete(key); this.zipped.set(k, zlib.gzipSync(body)); }
      body = this.zipped.get(k); head['content-encoding'] = 'gzip'; head.vary = 'accept-encoding';
    }
    head['content-length'] = body.length;
    res.writeHead(200, head); res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }
}

// ---------- 폴더 목록 ----------
// 드라이브는 GetLogicalDrives(DriveInfo)로 읽는다. 글자마다 existsSync로 보면 끊긴 네트워크 드라이브에서 수십 초 멈춘다. 1분 동안 기억한다
let drivesCache = null;
export function parseDrives(out) { return String(out || '').split(/\r?\n/).map((x) => x.trim()).filter((x) => /^[A-Za-z]:\\$/.test(x)).map((x) => x.toUpperCase()); }
export async function driveRoots({ platform = process.platform, run = runDriveInfo, now = Date.now(), fresh = false } = {}) {
  if (platform !== 'win32') return ['/'];
  if (!fresh && drivesCache && now - drivesCache.at < 60_000) return drivesCache.list;
  let list = [];
  try { list = parseDrives(await run()); } catch {}
  if (!list.length) list = [path.parse(os.homedir()).root.toUpperCase()];
  drivesCache = { at: now, list };
  return list;
}
function runDriveInfo() {
  return new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name }'], { timeout: 8000, windowsHide: true }, (e, out) => (e ? rej(e) : res(out))));
}
export function listDirs(p, { max = LIST_MAX } = {}) {
  if (typeof p !== 'string' || !p.trim()) throw apiErr('bad_path', 'path is required');
  if (!path.isAbsolute(p.trim())) throw apiErr('bad_path', 'path must be absolute');
  const dir = path.resolve(p.trim());
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { throw Object.assign(apiErr(e.code === 'ENOENT' ? 'not_found' : 'unreadable', `cannot read ${dir}: ${e.code || e.message}`), { path: dir }); }
  const dirs = [];
  for (const e of ents) {
    let isDir = e.isDirectory();
    if (!isDir && e.isSymbolicLink()) { try { isDir = fs.statSync(path.join(dir, e.name)).isDirectory(); } catch {} }
    if (!isDir) continue;
    if (/^\$|^System Volume Information$/i.test(e.name)) continue; // Windows 시스템 폴더
    dirs.push({ name: e.name, path: path.join(dir, e.name), hidden: e.name.startsWith('.') });
  }
  dirs.sort((a, b) => (a.hidden - b.hidden) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, dirs: dirs.slice(0, max), truncated: dirs.length > max, total: dirs.length };
}

// ---------- 업로드 ----------
export function safeUploadName(name, contentType = '') {
  let base = path.basename(String(name || '').replace(/\\/g, '/')).normalize('NFC');
  base = base.replace(/[^\p{L}\p{N}._\- ()]/gu, '_').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim();
  if (!base) {
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'text/plain': '.txt', 'application/pdf': '.pdf' }[String(contentType).split(';')[0].trim()] || '.bin';
    base = `pasted${ext}`;
  }
  if (base.length > 80) { const ext = path.extname(base).slice(0, 12); base = base.slice(0, 80 - ext.length) + ext; }
  return base;
}
export function uploadPath(dir, name, contentType, now = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
  return path.join(dir, `${stamp}-${crypto.randomBytes(3).toString('hex')}-${safeUploadName(name, contentType)}`);
}
// 오래된 것과 총량이 넘친 만큼(오래된 것부터) 지운다
export function cleanupUploads(dir, { maxAgeMs = UPLOAD_MAX_AGE_MS, maxTotal = UPLOAD_MAX_TOTAL, now = Date.now(), keep = null } = {}) {
  let files;
  try { files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => { const f = path.join(dir, e.name); const st = fs.statSync(f); return { f, size: st.size, mtime: st.mtimeMs }; }); } catch { return { removed: 0 }; }
  files.sort((a, b) => a.mtime - b.mtime);
  let total = files.reduce((n, x) => n + x.size, 0), removed = 0;
  for (const x of files) {
    if (x.f === keep) continue;
    if (now - x.mtime > maxAgeMs || total > maxTotal) { try { fs.rmSync(x.f, { force: true }); total -= x.size; removed++; } catch {} }
  }
  return { removed, total };
}

// ---------- 묶음: 백엔드에 붙인다 ----------
export class WebServer {
  // api: ApiServer(clients, dropWhere), boot: () => 웹 창의 시작 값(프로필 등)
  // P49: tailscale(TailscaleWatch)가 있으면 이 PC의 Tailscale 이름을 Host 허용 목록에 저절로 넣고 로그인 사용자를 제한한다. settings()는 판 설정(remoteSameUser, remoteAllowedLogins)
  constructor({ cfg, store, api, log = () => {}, recentDirs = () => [], now = Date.now, tailscale = null, settings = () => ({}), wsName = () => null, pushTransport = undefined }) {
    this.cfg = cfg; this.store = store; this.api = api; this.log = log; this.recentDirs = recentDirs; this.now = now; this.tailscale = tailscale; this.settings = settings;
    this.baseHosts = allowedHosts(cfg.port);
    this.devices = new Devices({ store, now });
    // P56: 패스키와 세션. 수명은 판 설정(remoteSessionHours, remoteIdleMinutes). 연결이 열린 세션은 끊긴 시간을 세지 않는다
    this.auth = new WebAuth({ store, devices: this.devices, now, log, connected: (h) => !!this.api && [...this.api.clients].some((c) => c.auth && c.auth.session === h), limits: (s) => this.sessionLimits(s) });
    this.pairing = new Pairing({ devices: this.devices, grants: this.auth.grants, now, onChange: () => this.broadcastLocal() });
    this.files = new StaticFiles(WEB_DIST());
    this.uploadDir = path.join(cfg.dataDir, 'uploads');
    try { cleanupUploads(this.uploadDir); } catch {}
    this.sweepTimer = setInterval(() => { this.pairing.sweep(); this.sweepSessions(); }, 15_000); this.sweepTimer.unref();
    // P58: 연결 기록과 새로 붙음 알림. 끊기 고리(onDisconnectDevice)는 기기의 다른 상태(P56 세션 등)를 함께 끝낸다
    this.remoteLog = new RemoteLog({ file: cfg.dataDir ? path.join(cfg.dataDir, 'remote-log.jsonl') : null, now, log, onAppend: (e) => this.sendLocal('remote.logged', e) });
    this.watch = new ConnectWatch({ now, quietMs: Number(envVar('REMOTE_QUIET_MS')) > 0 ? Number(envVar('REMOTE_QUIET_MS')) : undefined }); // 시험: ATRIUM_REMOTE_QUIET_MS로 줄인다
    this.disconnectHooks = [];
    this.pairMeta = new Map(); // 허락 요청 ID → 요청한 곳(기록용)
    // P59: PC에서 끊기·짝 풀기·원격 막기는 그 기기의 세션도 끝낸다(다시 붙으려면 패스키로 다시 확인)
    // P62: 패스키 끔이면 짝 풀기만 세션을 끝낸다. 끊기와 원격 막기는 연결만 닫고, 기기는 곧(원격 받기를 켜면) 다시 붙는다
    this.onDisconnectDevice(({ id, reason }) => { if (reason === 'revoke' || this.passkeyOn()) this.auth.sessions.endDevice(id); });
    // P88: 웹 푸시. 개발용 판만 흉내 푸시 서비스의 출처(ATRIUM_PUSH_TEST_ORIGINS, 쉼표로 여럿)와 그 인증서(ATRIUM_PUSH_TEST_CA)를 받는다
    const dev = cfg.profile === 'dev';
    let ca = null; if (dev && envVar('PUSH_TEST_CA')) try { ca = fs.readFileSync(envVar('PUSH_TEST_CA')); } catch (e) { log(`push test CA unreadable: ${e.message}`); }
    this.push = new Pusher({
      store, keyFile: cfg.dataDir ? path.join(cfg.dataDir, 'vapid.json') : null, subject: envVar('PUSH_SUBJECT') || `https://github.com/${UPDATE_REPO}`, now, log,
      note: (event, f) => { const d = f.deviceId ? this.devices.get(f.deviceId) : null; this.note(event, null, { ...f, deviceName: d && d.name, node: d && d.tsNode && d.tsNode.name }); },
      watching: (id) => this.deviceConns(id).some((c) => c.pushVisible !== false), // 보이는지 알리지 않은 화면은 연결이 열려 있으면 보는 것으로
      pcActive: () => !!this.api && [...this.api.clients].some((c) => !(c.auth && c.auth.device) && c.kind === 'desktop' && c.lastInputAt && this.now() - c.lastInputAt < ACTIVE_MS),
      enabled: () => this.accepting(), wsName,
      testOrigins: dev ? String(envVar('PUSH_TEST_ORIGINS') || '').split(',').map((x) => x.trim()).filter(Boolean) : [], ca,
      ...(pushTransport ? { transport: pushTransport } : {}),
      ...(dev && Number(envVar('PUSH_SETTLE_MS')) > 0 ? { settleMs: Number(envVar('PUSH_SETTLE_MS')) } : {}), // P92 창 시험만: 사이클 끝을 기다리는 시간을 줄인다
      onChange: () => this.broadcastLocal(),
    });
    this.onDisconnectDevice(({ id, reason }) => { if (reason === 'revoke') this.push.forget(id, 'unpair'); }); // P88: 짝을 풀면 구독도 지운다
  }
  // P62: 판 설정 remotePasskey. 설정을 못 읽거나 값이 없으면 켬으로 본다(막는 쪽). 판 설정(settings.mjs)은 늘 값이 있고 기본은 끔이다
  passkeyOn() { try { const st = this.settings(); return !(st && st.remotePasskey === false); } catch { return true; } }
  // P62: 세션마다 수명. 끔이면 끝이 없다(짝 풀기까지). 켬이어도 패스키가 없는 기기의 세션은 패스키 등록에만 쓰므로(authorize·device()가 막는다) 끝나지 않는다
  sessionLimits(s = null) {
    if (!this.passkeyOn()) return { maxAgeMs: Infinity, idleMs: Infinity };
    if (s) { const d = this.devices.all().find((x) => x.id === s.deviceId); if (d && !d.passkey && d.pairOnly) return { maxAgeMs: Infinity, idleMs: Infinity }; }
    let st = {}; try { st = this.settings() || {}; } catch {}
    // P56 창 시험만: 개발용 판에서 세션 수명을 초로 줄인다(만료 뒤 다시 확인을 보려고). 실제 판은 이 값을 읽지 않는다
    const testSec = this.cfg.profile === 'dev' ? Number(envVar('WEB_SESSION_TEST_SEC')) : NaN;
    return { maxAgeMs: testSec > 0 ? testSec * 1000 : Number(st.remoteSessionHours) * 3600_000, idleMs: Number(st.remoteIdleMinutes) * 60_000 };
  }
  stop() { clearInterval(this.sweepTimer); this.remoteLog.flush(); this.push.stop(); }
  remoteEnabled() {
    if (this.cfg.remoteExplicit === true) return this.cfg.remoteEnabled === true;
    return this.cfg.remoteEnabled === true || this.store.getMeta(REMOTE_KEY) === true;
  }
  requireRemote() { if (!this.accepting()) throw apiErr('remote_blocked', 'Remote access is disabled or blocked on this board', 403); }
  configure({ enabled }) {
    if (typeof enabled !== 'boolean') throw apiErr('bad_request', 'enabled must be a boolean');
    if (this.cfg.remoteExplicit === true && enabled !== this.cfg.remoteEnabled) throw apiErr('remote_locked', 'ATRIUM_REMOTE_ENABLED overrides the saved remote setting', 409);
    this.store.setMeta(REMOTE_KEY, enabled);
    if (this.remoteEnabled()) this.tailscale?.start();
    else {
      this.tailscale?.stop();
      this.accessChanged(false);
      this.pairing.code = null; this.pairing.requests.clear();
      this.pairMeta.clear();
      this.auth.grants.map.clear(); this.auth.challenges.map.clear();
    }
    this.broadcastLocal();
    return this.status();
  }
  // P49: 허용 Host = 127.0.0.1·localhost(그 포트), ATRIUM_WEB_HOSTS, 이 PC의 Tailscale 이름
  get hosts() { const ts = this.remoteEnabled() && this.tailscale ? this.tailscale.hosts() : []; if (!ts.length) return this.baseHosts; return new Set([...this.baseHosts, ...ts]); }
  policy() {
    let st = {}; try { st = this.settings() || {}; } catch {}
    return { sameUser: st.remoteSameUser !== false, allowed: parseLogins(st.remoteAllowedLogins), self: this.tailscale ? this.tailscale.selfLogin() : null, tsHosts: this.tailscale ? this.tailscale.hosts() : [] };
  }
  // ---------- P58(S4): 원격 받기, 연결 기록, 알림, 끊기 ----------
  // 판 설정 remoteAccess(기본 켬). 설정을 못 읽으면 막는다
  accepting() { try { const st = this.settings(); return this.remoteEnabled() && !!st && st.remoteAccess !== false; } catch { return false; } }
  // 기록에 남길 요청 정보(비밀 없음): 바깥 요청인지, Tailscale 로그인, tailnet 주소, 브라우저 종류
  reqMeta(req) {
    const remote = isRemoteRequest(req, this.cfg.port);
    const login = req.headers['tailscale-user-login'];
    return { remote, login: login != null ? String(login) : null, addr: remote ? clientIp(req) : null, browser: browserOf(req.headers['user-agent']) };
  }
  note(event, req, fields = {}) { try { return this.remoteLog.add(event, { ...(req ? this.reqMeta(req) : {}), ...fields }); } catch (e) { this.log(`remote log error: ${e.message}`); return null; } }
  // 연결 거부: 까닭 코드를 남기고 null을 돌려준다(P56·P57이 더하는 까닭도 이 함수로 남긴다)
  refuse(req, reason) { this.note('deny', req, { reason }); return null; }
  sendLocal(event, data) { if (this.api) for (const c of this.api.clients) if (c.subscribed && !(c.auth && c.auth.device)) c.sendEvent(event, data); }
  deviceConns(id = null) { return this.api ? [...this.api.clients].filter((c) => c.auth && c.auth.device && (id == null || c.auth.device.id === id)) : []; }
  closeConns(conns, code, why, reason) { for (const c of conns) { c.closeReason = reason; try { c.ws.close(code, why); } catch {} } return conns.length; }
  // 끊기 고리: fn({ id, reason: 'disconnect'|'revoke'|'blocked' }). P56이 합쳐지면 그 기기의 세션을 끝낸다
  onDisconnectDevice(fn) { this.disconnectHooks.push(fn); return () => { this.disconnectHooks = this.disconnectHooks.filter((x) => x !== fn); }; }
  runDisconnectHooks(id, reason) { for (const fn of this.disconnectHooks) { try { fn({ id, reason }); } catch (e) { this.log(`disconnect hook error: ${e.message}`); } } }
  // PC에서 끊기: 지금 연결만 닫는다(4402). 기기는 다시 붙을 수 있다
  disconnect(id) {
    const d = this.devices.all().find((x) => x.id === id);
    if (!d) throw apiErr('not_found', 'no such device', 404);
    const n = this.closeConns(this.deviceConns(id), 4402, 'disconnected by the PC', 'pc');
    this.note('kick', null, { deviceId: id, deviceName: d.name, n });
    this.runDisconnectHooks(id, 'disconnect');
    return { closed: n };
  }
  // 원격 받기를 바꿨다(backend.mjs의 settings.set이 부른다). 끄면 기기 연결과 바깥 연결을 모두 닫고(4403) 짝 맺기 코드를 버린다
  accessChanged(on) {
    this.note(on ? 'remote.allow' : 'remote.block', null);
    if (on) return { closed: 0 };
    const conns = this.api ? [...this.api.clients].filter((c) => (c.auth && c.auth.device) || c.remote) : [];
    for (const id of new Set(conns.map((c) => c.auth && c.auth.device && c.auth.device.id).filter(Boolean))) this.runDisconnectHooks(id, 'blocked');
    this.push.dropAll('blocked'); // P88: 원격 접속을 막으면 모든 기기의 푸시 구독도 지운다(다시 허용하면 휴대폰에서 다시 켠다)
    if (this.passkeyOn()) this.auth.sessions.endAll(); // P59: 붙어 있지 않은 기기의 세션도 모두 끝낸다(켠 뒤에는 패스키로 다시 확인). P62: 끔이면 세션은 남아 켜면 다시 붙는다
    if (this.pairing.currentCode()) this.pairing.cancelCode();
    this.pairing.requests.clear(); this.pairMeta.clear();
    this.auth.grants.map.clear(); this.auth.challenges.map.clear();
    return { closed: this.closeConns(conns, 4403, 'remote access is blocked on the PC', 'blocked') };
  }
  // P62: 패스키로 확인을 바꿨다(backend.mjs의 settings.set이 부른다).
  // 켬: 모든 세션의 수명을 지금부터 센다(켬의 12시간·30분). 패스키가 없는 기기의 연결은 닫는다(4401, 웹 화면은 "패스키 등록" 화면으로).
  // 끔: 살아 있는 세션은 끔의 수명(짝 풀기까지)으로 늘어난다(sessionLimits가 따른다). 패스키 기록은 지우지 않는다
  passkeyChanged(on) {
    this.note(on ? 'passkey.on' : 'passkey.off', null);
    let closed = 0;
    if (on) {
      this.auth.sessions.restartAll();
      const need = new Set(this.devices.all().filter((d) => !d.passkey).map((d) => d.id));
      closed = this.closeConns(this.deviceConns().filter((c) => need.has(c.auth.device.id)), 4401, 'register a passkey', 'passkey_required');
    }
    this.broadcastLocal();
    return { closed };
  }
  // ApiServer가 연결을 열고 닫을 때(backend.mjs onOpen·onClose). 기기 연결만 남기고, 새로 붙었으면 PC 창에 알린다
  clientOpened(c) {
    const d = c && c.auth && c.auth.device;
    if (!d) return;
    const m = c.auth.meta || {};
    // P59: Tailscale 기기 이름. P82: 원격이면 압축을 협상했는지와 창이 본 직전 닫힘
    this.note('connect', null, { ...m, deviceId: d.id, deviceName: d.name, node: c.auth.tsNode && c.auth.tsNode.name, ...(c.remote ? { ws: { deflate: !!c.deflate }, prev: c.prevClose } : {}) });
    if (this.watch.opened(d.id)) this.sendLocal('remote.connected', { kind: 'connected', device: { id: d.id, name: d.name }, remote: !!m.remote, login: m.login || null, browser: m.browser || null, at: this.now() });
  }
  clientClosed(c) {
    const d = c && c.auth && c.auth.device;
    if (!d) return;
    this.watch.closed(d.id);
    // P59: 세션의 끊긴 시각을 지금으로(15초 정리를 기다리지 않는다). 끊긴 채 remoteIdleMinutes가 지나면 세션이 끝난다
    if (c.auth.session) this.auth.sessions.touch(c.auth.session);
    this.note('disconnect', null, { ...(c.auth.meta || {}), deviceId: d.id, deviceName: d.name, node: c.auth.tsNode && c.auth.tsNode.name, reason: c.closeReason || 'closed', ...(c.wsStats ? { ws: c.wsStats.summary({ ...(c.wsClose || {}), error: c.wsError, deflate: !!c.deflate }) } : {}) }); // P82
  }
  // P56: 짝 맺기는 패스키 등록을 마칠 때 끝난다(기기가 생긴다)
  // P62: passkey = false면 패스키 없이 짝 맺음(연결 기록에 남긴다)
  paired(r, meta, via, passkey = true) {
    this.note('pair.ok', null, { ...meta, deviceId: r.device.id, deviceName: r.device.name, node: r.device.tsNode && r.device.tsNode.name, via, ...(passkey ? {} : { passkey: false }) });
    this.watch.paired(r.device.id);
    this.sendLocal('remote.connected', { kind: 'paired', device: { id: r.device.id, name: r.device.name }, remote: !!meta.remote, login: meta.login || null, browser: meta.browser || null, at: this.now() });
  }
  // 허락 요청을 허락·거절하고 기록에 남긴다. P56: 허락하면 등록 허가가 나가고(pair.grant), 패스키 등록을 마치면 pair.ok
  decide(id, allow) {
    const r = this.pairing.decide(id, allow);
    const meta = this.pairMeta.get(id) || {}; this.pairMeta.delete(id);
    if (allow && r.status === 'approved') { if (this.passkeyOn()) this.note('pair.grant', null, { ...meta, via: 'approve' }); } // P62: 패스키 끔이면 브라우저가 허가를 받아 갈 때 pair.ok(패스키 없이)
    else this.note('pair.fail', null, { ...meta, reason: 'denied' });
    return r;
  }
  // P59: 거부한 오류의 까닭 코드(연결 기록). P57 기기 확인은 tailscale_node:<까닭>, P56 패스키 검증은 passkey:<코드>
  reasonOf(e) {
    if (e && e.logReason) return e.logReason;
    if (e && e.code === 'tailscale_node' && e.reason) return `tailscale_node:${e.reason}`;
    if (e instanceof PasskeyError) return `passkey:${e.code}`;
    return (e && e.code) || 'error';
  }
  // 원격 받기가 꺼진 동안의 HTTP: /web/*는 403 remote_blocked(웹 화면이 "PC에서 원격을 막았습니다"를 보인다), 바깥에서 온 화면 요청은 그 글만 담은 쪽(503).
  // 이 PC 안 브라우저의 화면 파일은 내준다(그 화면이 /web/me의 거부를 보고 알린다)
  blocked(req, res, isWeb) {
    this.note('deny', req, { reason: 'remote_blocked' });
    if (isWeb) { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS }); res.end(JSON.stringify({ error: { code: 'remote_blocked', message: 'remote access is blocked on the PC' } })); }
    else { res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '15', ...SECURITY_HEADERS }); res.end(req.method === 'HEAD' ? undefined : BLOCKED_PAGE); }
    return true;
  }
  // P49: atrium remote status와 설정의 연결된 기기 탭이 보이는 진단
  async remoteStatus({ fresh = false } = {}) {
    const enabled = this.remoteEnabled();
    const ts = enabled && this.tailscale ? (fresh ? await this.tailscale.refresh() : this.tailscale.last) : { installed: false, disabled: true };
    const pol = this.policy();
    const d = diagnose(ts, { port: this.cfg.port, hosts: [...this.hosts], devices: this.devices.all().length, unbound: this.devices.all().filter(needsRepair).length, built: this.files.built(), sameUser: pol.sameUser, allowed: pol.allowed, passkey: this.passkeyOn() }); // P62: 패스키로 확인
    const accepting = this.accepting(); // P58: 원격 받기가 꺼져 있으면 준비되지 않음
    // P60: 판 설정 창이 복사할 켜기 명령(PATH에 기대지 않게 node와 이 백엔드의 atrium.mjs 경로로), 같은 이름의 다른 serve 항목 수(관리자 권한 안내)
    const serveOthers = ((ts && ts.serve && ts.serve.entries) || []).filter((e) => !e.toBoard).length;
    return { ...d, enabled, locked: this.cfg.remoteExplicit === true, ready: d.ready && accepting, accepting, passkey: this.passkeyOn(), connected: new Set(this.deviceConns().map((c) => c.auth.device.id)).size, port: this.cfg.port, sameUser: pol.sameUser, allowed: pol.allowed, enableCmd: d.enable ? enableCommand(d.httpsPort, this.cfg) : null, serveOthers };
  }
  url() { return `http://localhost:${this.cfg.port}/`; } // P56: 패스키는 IP 주소에서 쓰지 못한다(RP ID는 이름)
  status() { return { enabled: this.remoteEnabled(), locked: this.cfg.remoteExplicit === true, accepting: this.accepting(), url: this.url(), built: this.files.built(), devices: this.devices.all().length, hosts: [...this.hosts] }; }
  boot(device) {
    const dev = this.cfg.profile === 'dev';
    return { device, platform: process.platform, port: this.cfg.port, profile: this.cfg.profile, herdrSession: this.cfg.herdrSession, defaultCwd: dev ? path.join(BACKEND_ROOT, '.dev', 'proj') : os.homedir(), defaultModel: dev ? 'haiku' : '' };
  }
  // 판 API 토큰 클라이언트(PC 창, CLI)에만: 기기 목록과 허락 요청
  // P62: needsPasskey = 패스키 켬인데 패스키 없이 짝 맺은 기기(다음 접속 때 "패스키 등록" 화면을 본다)
  devicesView() { const on = this.passkeyOn(); return this.devices.list().map((d) => ({ ...d, sessions: this.auth.sessions.countFor(d.id), needsPasskey: on && !d.passkey && !d.needsRepair, push: this.push.deviceView(d.id) })); } // P88: 알림 켜짐, 마지막으로 보낸 때
  view() { return { enabled: this.remoteEnabled(), locked: this.cfg.remoteExplicit === true, devices: this.devicesView(), requests: this.pairing.pending(), code: this.pairing.currentCode(), passkey: this.passkeyOn() }; }
  broadcastLocal() {
    if (!this.api) return;
    const v = this.view();
    for (const c of this.api.clients) if (c.subscribed && !(c.auth && c.auth.device)) c.sendEvent('device.updated', v);
    // 기기에는 자기 기록만(코드, 요청, 다른 기기는 보이지 않는다. P59)
    for (const c of this.api.clients) if (c.subscribed && c.auth && c.auth.device) c.sendEvent('device.updated', this.deviceView(c, v.devices));
  }
  // P59: 기기 클라이언트가 보는 목록(자기 기록 하나)
  deviceView(c, all = null) {
    const id = c.auth.device.id;
    const mine = (all || this.devicesView()).filter((d) => d.id === id);
    return { devices: mine, me: c.auth.device };
  }

  // P57: 바깥 요청이면 요청한 Tailscale 기기를 whois로 읽는다(주소마다 잠깐 기억). 이 PC 안 요청은 null. 못 읽으면 { ok: false }
  async whoisOf(req) {
    if (!isRemoteRequest(req, this.cfg.port)) return null;
    const addr = requestAddr(req);
    if (!addr) return { ok: false, reason: 'bad_addr' };
    if (!this.tailscale || typeof this.tailscale.whois !== 'function') return { ok: false, reason: 'disabled' };
    try { return await this.tailscale.whois(addr); } catch { return { ok: false, reason: 'whois_failed' }; }
  }
  // P57: 자격(P56 세션, 패스키 서명) 확인 다음의 기기 확인. 바깥 요청은 기록의 tsNode와 지금 요청한 기기가 같아야 한다. 막으면 까닭만 로그에 남긴다
  async checkNode(req, device, what) {
    const r = nodeCheck(req, device, await this.whoisOf(req), this.cfg.port);
    if (!r.ok) this.log(`web ${what} refused: tailscale node ${r.reason} (device ${device.id})`);
    return r;
  }
  // P57: 짝 맺기의 기기 확인. 바깥이면 whois가 맞아야 하고, 그 기기({ id, name, login })를 기록에 둔다. 이 PC 안이면 node: null
  async pairNode(req, what) {
    const w = await this.whoisOf(req);
    if (w === null) return { ok: true, reason: null, node: null };
    const m = whoisMatch(req, w);
    if (!m.ok) this.log(`web ${what} refused: tailscale node ${m.reason}`);
    return m;
  }

  // WebSocket /api 연결 허락. 판 API 토큰(이 PC의 프로세스) 또는 P56 세션 쿠키(브라우저, 같은 출처). null이면 막는다
  // P57: 바깥 기기 연결은 whois를 기다려야 하므로 약속(Promise)을 돌려준다(ApiServer.handleUpgrade가 기다린다)
  authorize(req, apiToken) {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/api') return this.refuse(req, 'path'); // P58: 거부는 까닭 코드와 함께 연결 기록에 남긴다
    const token = u.searchParams.get('token');
    if (token != null) { if (!safeEq(token, apiToken)) return this.refuse(req, 'api_token'); return isLocalProcess(req, this.cfg.port, { allowFileOrigin: true }) ? { kind: 'local' } : this.refuse(req, 'not_local'); }
    // P59: 기기 연결의 확인 차례 = 원격 받기(P58) → Host·Origin → Tailscale 로그인(P49) → 세션(P56) → Tailscale 기기(P57)
    if (!this.accepting()) return this.refuse(req, 'remote_blocked'); // P58: 원격 받기 꺼짐
    if (u.searchParams.has('device')) { this.log('web connect refused: device tokens are no longer accepted (pair again with a passkey)'); return this.refuse(req, 'device_token'); }
    const sid = sessionIdOf(req, this.cfg.port);
    if (sid) {
      const hosts = this.hosts;
      if (!hostOk(req, hosts)) return this.refuse(req, 'host');
      if (!originOk(req, hosts)) return this.refuse(req, 'origin');
      const lg = loginAllowed(req, this.policy()); // P49: 다른 Tailscale 사용자는 세션이 있어도 막는다
      if (!lg.ok) { this.log(`web connect refused: tailscale user ${lg.reason}`); return this.refuse(req, `login_${lg.reason}`); }
      const s = this.auth.sessions.check(sid);
      const d = s && this.devices.get(s.deviceId);
      if (!d) { this.log('web connect refused: no live session'); return this.refuse(req, 'no_session'); }
      if (d.needsRepair) return this.refuse(req, 'tailscale_node:not_bound');
      const remote = isRemoteRequest(req, this.cfg.port);
      const meta = this.reqMeta(req);
      const accept = (node) => {
        if (!this.accepting()) return this.refuse(req, 'remote_blocked'); // whois를 기다리는 사이에 바뀌었으면
        if (!this.devices.get(d.id)) return this.refuse(req, 'no_session');
        if (!this.auth.sessions.valid(s.hash)) return this.refuse(req, 'no_session');
        if (!d.passkey && this.passkeyOn()) return this.refuse(req, 'passkey_required'); // P62: 패스키 켬이면 패스키 없는 기기의 세션은 패스키 등록에만 쓴다
        this.auth.sessions.touch(s.hash);
        this.devices.touch(d.id, true);
        setImmediate(() => this.broadcastLocal()); // 마지막 접속을 PC 창 목록에
        return { kind: 'device', device: { id: d.id, name: d.name }, session: s.hash, remote, login: lg.login, meta, ...(node ? { tsNode: { id: node.id, name: node.name } } : {}) };
      };
      if (!remote) return accept(null);
      // P57: 자격(세션) 확인 다음에 기기 확인
      return this.checkNode(req, d, 'connect').then((r) => (r.ok ? accept(r.node) : this.refuse(req, `tailscale_node:${r.reason}`)), () => this.refuse(req, 'tailscale_node:error'));
    }
    return this.refuse(req, 'no_credentials');
  }
  // P56: 세션이 끝난 연결을 닫는다(4401). 웹 화면은 다시 확인 화면으로 간다
  closeSession(pred, reason) {
    if (!this.api) return 0;
    let n = 0;
    for (const c of [...this.api.clients]) if (c.auth && c.auth.session && pred(c.auth.session, c)) { c.closeReason = 'session'; try { c.ws.close(4401, reason); n++; } catch {} } // P59: 연결 기록의 끊김 까닭
    return n;
  }
  sweepSessions() {
    this.auth.sweep();
    return this.closeSession((h) => !this.auth.sessions.valid(h), 'session ended');
  }
  // 쿠키의 세션과 그 기기. 없으면 401
  sessionOf(req) {
    const sid = sessionIdOf(req, this.cfg.port);
    const s = this.auth.sessions.check(sid);
    const d = s && this.devices.get(s.deviceId);
    // logReason: 연결 기록의 까닭(P59). 쿠키가 없음, 끝난 세션, 옛 기기 토큰(Authorization)
    if (!d) throw Object.assign(apiErr('login_required', 'sign in with the passkey', 401), { logReason: sid ? 'no_session' : req.headers.authorization != null ? 'device_token' : 'no_credentials' });
    // 다시 짝 맺어야 하는 기기는 다시 확인해도 소용없다(다시 확인 ↔ 거부 고리를 만들지 않게 짝 맺기 화면으로)
    if (d.needsRepair) throw nodeErr('not_bound');
    return { device: d, session: s };
  }
  // 기기를 끊으면 그 기기의 연결을 곧바로 닫는다(4401)
  revoke(id) {
    const d = this.devices.all().find((x) => x.id === id);
    const ok = this.devices.revoke(id);
    // P58 기록과 끊기 고리. P56: 고리가 그 기기의 세션을 모두 끝낸다(생성자의 onDisconnectDevice)
    if (ok) { this.note('unpair', null, { deviceId: id, deviceName: d && d.name, node: d && d.tsNode && d.tsNode.name }); this.runDisconnectHooks(id, 'revoke'); }
    if (ok && this.api) this.closeConns(this.deviceConns(id), 4401, 'device revoked', 'revoked');
    if (ok) this.broadcastLocal();
    return ok;
  }

  // HTTP. 처리했으면 true
  handleHttp(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    const isWeb = p.startsWith('/web/');
    const isStatic = !isWeb && (req.method === 'GET' || req.method === 'HEAD') && !p.startsWith('/hooks/') && !p.startsWith('/branch/') && p !== '/health' && p !== '/api';
    if (!isWeb && !isStatic) return false;
    if (!hostOk(req, this.hosts)) { this.note('deny', req, { reason: 'host' }); res.writeHead(421, { 'content-type': 'text/plain' }); res.end('misdirected request'); return true; }
    if (!this.accepting() && (isWeb || isRemoteRequest(req, this.cfg.port))) return this.blocked(req, res, isWeb); // P58: 원격 받기 꺼짐
    if (isStatic) return this.files.serve(req, res);
    const send = (status, obj, extra = {}) => { if (res.headersSent) return; res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...extra }); res.end(JSON.stringify(obj)); };
    // P59: Tailscale 기기 확인의 까닭(other_node 등, 비밀 아님)은 웹 화면이 짝 맺기 화면에 보이도록 싣는다
    const fail = (e) => send(e.status || 400, { error: { code: e.code || 'error', message: e.message, ...(e.retryAfterMs ? { retryAfterMs: e.retryAfterMs } : {}), ...(e.code === 'tailscale_node' && e.reason ? { reason: e.reason } : {}), ...(typeof e.passkey === 'boolean' ? { passkey: e.passkey } : {}) } }, e.retryAfterMs ? { 'retry-after': String(Math.ceil(e.retryAfterMs / 1000)) } : {});
    // 브라우저에서 온 요청은 같은 출처여야 한다(다른 사이트가 짝 맺기를 시도하거나 올리지 못하게)
    if (req.headers.origin != null ? !originOk(req, this.hosts) : req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') { this.note('deny', req, { reason: 'origin' }); fail(apiErr('bad_origin', 'cross-origin request', 403)); return true; }
    // P49: Tailscale로 온 요청은 이 PC의 Tailscale 사용자(또는 허용 목록)만 짝 맺고 쓴다
    const lg = loginAllowed(req, this.policy());
    if (!lg.ok) { this.note('deny', req, { reason: `login_${lg.reason}` }); fail(apiErr('tailscale_user', lg.reason === 'no_login' ? 'this Tailscale device has no user login (tagged device or funnel)' : 'this Tailscale user is not allowed on this board', 403)); return true; }
    const ua = String(req.headers['user-agent'] || '');
    const ip = clientIp(req);
    const origin = () => { if (req.headers.origin == null) throw apiErr('bad_origin', 'the request has no Origin', 403); return String(req.headers.origin); };
    // 세션 쿠키. P62: 수명은 세션의 남은 수명, 끝이 없으면(패스키 끔) 400일
    const cookie = (id, ms, secure) => ({ 'set-cookie': sessionCookie({ port: this.cfg.port, id, secure, maxAgeSec: Math.min(ms, COOKIE_MAX_MS) / 1000 }) });
    const login = (r, how, more = {}, secure = isHttpsOrigin(req.headers.origin)) => { // P56: 세션 쿠키를 주고 PC 창 목록을 새로 한다
      this.log(`web device ${how} ${r.device.id} ${r.device.name}`);
      this.broadcastLocal();
      send(200, { ...more, device: r.device, expiresAt: r.session.expiresAt }, cookie(r.session.id, r.session.maxAgeMs, secure));
    };
    // P56 세션 다음에 P57 기기 확인. 묶인 기기와 다르면(다른 기기, 이 PC 안 기기, 옛 기기) 401로 다시 짝 맺게, whois를 못 읽으면 403
    // P62: 그다음 패스키 켬이면 패스키가 있어야 한다. 없으면 401 passkey_required(웹 화면은 "패스키 등록" 화면으로)
    const deviceSession = async () => {
      const { device: d, session: s } = this.sessionOf(req);
      const r = await this.checkNode(req, d, p); if (!r.ok) throw nodeErr(r.reason);
      this.requireRemote(); this.sessionOf(req);
      if (!d.passkey && this.passkeyOn()) throw Object.assign(apiErr('passkey_required', 'register a passkey for this browser', 401), { logReason: 'passkey_required' });
      return { d, s };
    };
    const device = async () => (await deviceSession()).d;
    // P62: 패스키 등록(끔 → 켬). 패스키 켬, 패스키 없이 짝 맺은 기기, 살아 있는 세션, 그 세션이 묶인 Tailscale 기기에서만
    const enrollee = async () => {
      if (!this.passkeyOn()) throw apiErr('passkey_off', 'passkeys are off on this board', 409);
      const { device: d, session: s } = this.sessionOf(req);
      if (d.passkey) throw apiErr('has_passkey', 'this browser already has a passkey', 409);
      const r = await this.checkNode(req, d, p); if (!r.ok) throw nodeErr(r.reason);
      this.requireRemote(); this.sessionOf(req);
      return { d, s };
    };
    // P57: 짝 맺기·패스키 등록·로그인을 청한 곳. 바깥이면 whois가 맞아야 하고 그 Tailscale 기기를, 이 PC 안이면 null을 돌려준다
    const paired = async () => { const r = await this.pairNode(req, p); this.requireRemote(); if (!r.ok) throw nodeErr(r.reason); return r.node; };
    // P57: 등록 허가는 그 허가를 받은 곳(같은 Tailscale 기기, 또는 이 PC 안끼리)에서만 쓴다
    const grantHere = (node) => (g) => sameNode(g.extra && g.extra.tsNode, node);
    // P57: 패스키 서명을 확인한 기기가 지금 요청한 Tailscale 기기에 묶여 있어야 세션을 만든다
    const boundHere = (w) => (d) => { if (devicePub(d).needsRepair) throw nodeErr('not_bound'); const r = nodeCheck(req, d, w, this.cfg.port); if (!r.ok) { this.log(`web ${p} refused: tailscale node ${r.reason} (device ${d.id})`); throw nodeErr(r.reason); } };
    const meta = this.reqMeta(req); // P58: 연결 기록(비밀 없음)
    // P59: 거부는 모두 까닭 코드와 함께 연결 기록에. 짝 맺기와 패스키 등록은 pair.fail, 나머지(세션, 로그인, 기기 확인)는 deny
    const ev = p.startsWith('/web/pair/') || p.startsWith('/web/passkey/register') ? 'pair.fail' : 'deny';
    const body = (max = 16 * 1024) => new Promise((resolve, reject) => {
      const chunks = []; let n = 0;
      req.on('data', (d) => { n += d.length; if (n <= max) chunks.push(d); });
      req.on('end', () => { if (n > max) return reject(apiErr('too_big', 'request too large', 413)); try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(apiErr('bad_json', 'invalid JSON')); } });
      req.on('error', reject);
    }).then((value) => { this.requireRemote(); return value; });
    (async () => {
      try {
        if (p === '/web/me' && req.method === 'GET') {
          let x; try { x = await deviceSession(); } catch (e) { e.passkey = this.passkeyOn(); throw e; } // P62: 웹 화면이 짝 맺기에 패스키가 필요한지 안다(비밀 아님)
          this.devices.touch(x.d.id);
          // P62: 쿠키를 세션의 남은 수명으로 다시 준다(끔이면 400일, 쓰는 동안 늘어난다. 켬 → 끔 뒤에 늘어난 수명도 브라우저에 닿는다)
          const rem = this.auth.sessions.remainingMs(x.s.hash);
          return send(200, { ...this.boot({ id: x.d.id, name: x.d.name }), passkey: this.passkeyOn() }, rem > 0 ? cookie(sessionIdOf(req, this.cfg.port), rem, sentSecureCookie(req, this.cfg.port)) : {});
        }
        if (p === '/web/pair/code' && req.method === 'POST') {
          const o = origin(); const tsNode = await paired(); const b = await body();
          const r = this.pairing.redeem({ code: String(b.code || ''), name: b.name, ip, userAgent: ua, origin: o, tsNode });
          // P62: 패스키 끔이면 허가를 같은 응답에서 쓰고 곧바로 세션 쿠키를 준다(같은 출처, 같은 Tailscale 기기 확인은 등록과 같다)
          if (!this.passkeyOn()) { const x = this.auth.pairWithoutPasskey({ grant: r.grant, origin: o, allow: grantHere(tsNode) }); this.paired(x, meta, 'code', false); return login(x, 'paired without a passkey', { paired: true }); }
          this.log('web pairing code accepted, waiting for the passkey'); this.note('pair.grant', null, { ...meta, deviceName: clipName(b.name) || 'Browser', node: tsNode && tsNode.name, via: 'code' }); return send(200, r);
        }
        if (p === '/web/pair/request' && req.method === 'POST') { const o = origin(); const tsNode = await paired(); const b = await body(); const r = this.pairing.request({ name: b.name, ip, userAgent: ua, origin: o, tsNode }); this.log(`web pair request ${r.requestId}`); this.pairMeta.set(r.requestId, { ...meta, node: tsNode && tsNode.name }); this.note('pair.request', null, { ...meta, deviceName: clipName(b.name) || 'Browser', node: tsNode && tsNode.name }); return send(200, r); }
        if (p === '/web/pair/poll' && req.method === 'GET') {
          const tsNode = await paired();
          const r = this.pairing.poll(url.searchParams.get('id'), url.searchParams.get('secret'), tsNode);
          // P62: 패스키 끔이면 허락된 허가를 여기서 쓴다. 출처는 요청의 Origin(없으면 허가를 청한 출처)이 허가의 출처와 같아야 한다
          if (r.status === 'approved' && !this.passkeyOn()) {
            const g = this.auth.grants.peek(r.grant); const o = req.headers.origin != null ? String(req.headers.origin) : g ? g.origin : '';
            const x = this.auth.pairWithoutPasskey({ grant: r.grant, origin: o, allow: grantHere(tsNode) });
            this.paired(x, meta, 'approve', false);
            return login(x, 'paired without a passkey', { status: 'approved', paired: true }, isHttpsOrigin(o));
          }
          return send(200, r);
        }
        // P62: 패스키 없이 짝 맺은 기기가 지금 세션으로 패스키를 한 번 등록한다(끔 → 켬)
        if (p === '/web/passkey/enroll/options' && req.method === 'POST') { const o = origin(); const { d, s } = await enrollee(); const b = await body(); return send(200, this.auth.enrollOptions({ device: d, session: s, origin: o, via: b.via })); }
        if (p === '/web/passkey/enroll' && req.method === 'POST') {
          const o = origin(); const { d, s } = await enrollee(); const b = await body(64 * 1024);
          const r = this.auth.enroll({ device: d, session: s, credential: b.credential, origin: o });
          this.note('passkey.add', null, { ...meta, deviceId: d.id, deviceName: d.name, node: d.tsNode && d.tsNode.name });
          this.log(`web device added a passkey ${d.id} ${d.name}`);
          this.broadcastLocal();
          return send(200, { device: r.device }, cookie(sessionIdOf(req, this.cfg.port), this.auth.sessions.remainingMs(s.hash), isHttpsOrigin(o)));
        }
        // P56: 패스키 등록(짝 맺기의 허가로 한 번)과 로그인, 로그아웃. P57: 등록은 허가를 받은 곳에서만, 로그인은 묶인 Tailscale 기기에서만
        if (p === '/web/passkey/register/options' && req.method === 'POST') { const o = origin(); const node = await paired(); const b = await body(); return send(200, this.auth.registerOptions({ grant: b.grant, origin: o, allow: grantHere(node), via: b.via })); }
        if (p === '/web/passkey/register' && req.method === 'POST') { const o = origin(); const node = await paired(); const b = await body(64 * 1024); const r = this.auth.register({ grant: b.grant, credential: b.credential, origin: o, allow: grantHere(node) }); this.paired(r, meta, r.device.via); return login(r, 'paired with a passkey'); }
        if (p === '/web/passkey/login/options' && req.method === 'POST') { const o = origin(); await paired(); const b = await body(); return send(200, this.auth.loginOptions({ credentialId: b.credentialId, origin: o, via: b.via })); }
        if (p === '/web/passkey/login' && req.method === 'POST') {
          const o = origin(); await paired(); const w = await this.whoisOf(req); const b = await body(64 * 1024);
          const r = this.auth.login({ credential: b.credential, origin: o, check: boundHere(w) });
          this.note('login', null, { ...meta, deviceId: r.device.id, deviceName: r.device.name, node: r.device.tsNode && r.device.tsNode.name });
          return login(r, 'signed in with the passkey');
        }
        if (p === '/web/logout' && req.method === 'POST') {
          origin();
          const s = this.auth.sessions.check(sessionIdOf(req, this.cfg.port));
          if (s) { this.auth.sessions.end(s.hash); this.closeSession((h) => h === s.hash, 'signed out'); this.note('logout', null, { ...meta, deviceId: s.deviceId }); }
          return send(200, { ok: true }, { 'set-cookie': clearCookies(this.cfg.port) });
        }
        if (p === '/web/upload' && req.method === 'POST') { await device(); return this.upload(req, url, send, fail); }
        return send(404, { error: { code: 'not_found', message: p } });
      } catch (e) { this.note(ev, null, { ...meta, reason: this.reasonOf(e) }); fail(e); }
    })();
    return true;
  }
  upload(req, url, send, fail) {
    const len = Number(req.headers['content-length'] || 0);
    if (len > UPLOAD_MAX_BYTES) { req.resume(); return fail(apiErr('too_big', `file is larger than ${UPLOAD_MAX_BYTES} bytes`, 413)); }
    fs.mkdirSync(this.uploadDir, { recursive: true });
    const file = uploadPath(this.uploadDir, url.searchParams.get('name'), req.headers['content-type']);
    const out = fs.createWriteStream(file, { flags: 'wx' });
    let n = 0, over = false;
    req.on('data', (d) => { n += d.length; if (n > UPLOAD_MAX_BYTES && !over) { over = true; out.destroy(); req.unpipe(out); try { fs.rmSync(file, { force: true }); } catch {} fail(apiErr('too_big', `file is larger than ${UPLOAD_MAX_BYTES} bytes`, 413)); } });
    req.pipe(out);
    out.on('finish', () => {
      if (over) return;
      try { cleanupUploads(this.uploadDir, { keep: file }); } catch {}
      this.log(`web upload ${path.basename(file)} ${n}B`);
      send(200, { path: file, bytes: n });
    });
    out.on('error', (e) => { if (!over) fail(apiErr('write_failed', e.message, 500)); });
  }

  // P88: 웹 푸시. 기기는 자기 구독만 바꾼다. 시험 알림은 기기(자기에게)와 이 PC(모두나 기기 하나에게)가 보낸다
  pushHandlers() {
    const me = (c) => { const d = c && c.auth && c.auth.kind === 'device' && c.auth.device; if (!d) throw apiErr('forbidden', 'only a paired browser can do this', 403); return d; };
    return {
      'push.key': (p, c) => { me(c); return { publicKey: this.push.publicKey() }; },
      'push.status': (p, c) => this.push.status(me(c).id),
      'push.subscribe': (p, c) => this.push.subscribe(me(c).id, p && p.subscription, p && p.lang),
      'push.unsubscribe': (p, c) => this.push.unsubscribe(me(c).id, 'user'),
      'push.prefs': (p, c) => this.push.setPrefs(me(c).id, p || {}),
      // 이 연결이 화면에 보이는가(보는 중이면 그 기기에 보내지 않는다)
      'push.visible': (p, c) => { me(c); c.pushVisible = !!(p && p.visible); return { ok: true }; },
      'push.test': async (p, c) => {
        if (c && c.auth && c.auth.kind === 'device') return this.push.test(me(c).id);
        if (c && c.auth && c.auth.kind !== 'local') throw apiErr('forbidden', 'only the board on this PC can do this', 403);
        const want = p && p.device ? String(p.device) : null;
        const list = this.devices.list().filter((d) => this.push.deviceView(d.id).on && (!want || d.id === want || d.id.startsWith(want) || d.name === want || (d.tsNode && d.tsNode.name === want)));
        const results = [];
        for (const d of list) { let r; try { r = await this.push.test(d.id); } catch (e) { r = { ok: false, reason: e.code || 'error' }; } results.push({ id: d.id, name: (d.tsNode && d.tsNode.name) || d.name, ...r }); }
        return { results };
      },
      // P92: 알림을 보내거나 보내지 않은 까닭(진단, 글 없음: 세션 ID·종류·기기·까닭)과 열린 작업 사이클. 이 PC만
      'push.decisions': (p, c) => {
        if (!(c && c.auth && c.auth.kind === 'local')) throw apiErr('forbidden', 'only the board on this PC can do this', 403);
        const n = Math.max(1, Math.min(200, Number(p && p.limit) || 50));
        return { decisions: this.push.decisions.slice(-n), cycles: this.push.cycleView(), settleMs: this.push.settleMs };
      },
    };
  }

  // 판 API(WebSocket)에 더하는 것. c.auth.kind가 'local'(PC 창·CLI)이어야 하는 것은 localOnly로 막는다
  handlers() {
    const localOnly = (fn) => (p, c) => { if (c?.auth?.kind !== 'local') throw apiErr('forbidden', 'only the board on this PC can do this', 403); return fn(p, c); };
    return {
      // P59: 기기에는 자기 기록만. 다른 기기를 끊고 이름을 바꾸는 것은 이 PC만(P48부터 기기도 부를 수 있었다)
      'device.list': (p, c) => (c && c.auth && c.auth.kind !== 'local' ? this.deviceView(c) : this.view()),
      'device.revoke': localOnly((p) => ({ revoked: this.revoke(String(p.id || '')) })),
      'device.rename': localOnly((p) => { const ok = this.devices.rename(String(p.id || ''), p.name); if (ok) this.broadcastLocal(); return { renamed: ok }; }),
      // P59: 웹 화면의 "이 브라우저 짝 풀기". 자기 자신만 푼다
      'device.forget': (p, c) => { const me = c && c.auth && c.auth.kind === 'device' && c.auth.device; if (!me) throw apiErr('forbidden', 'only a paired browser can unpair itself', 403); if (!this.devices.get(me.id)) return { revoked: false }; setImmediate(() => this.revoke(me.id)); return { revoked: true }; }, // 답을 보낸 뒤에 푼다(푸는 일이 이 연결을 닫는다)
      'device.code': localOnly(() => { this.requireRemote(); return this.pairing.newCode(); }),
      'device.cancelCode': localOnly(() => { this.pairing.cancelCode(); return { ok: true }; }),
      'device.approve': localOnly((p) => { this.requireRemote(); return this.decide(String(p.id || ''), true); }),
      'device.deny': localOnly((p) => this.decide(String(p.id || ''), false)),
      'device.disconnect': localOnly((p) => this.disconnect(String(p.id || ''))), // P58: 지금 연결만 닫는다
      'remote.log': localOnly((p) => ({ entries: this.remoteLog.list({ limit: p && Number.isInteger(p.limit) ? p.limit : 100 }) })), // P58: 연결 기록(최근 것부터)
      'web.status': () => this.status(),
      'remote.configure': localOnly((p) => this.configure(p)),
      // P84: 웹 화면이 정상 떠남 없이 다시 읽혔다(페이지가 죽음). 기기 연결 하나에 한 번만 남긴다(넘치는 요청이 기록을 밀어내지 않게)
      'web.boot': (p, c) => {
        const d = c && c.auth && c.auth.kind === 'device' && c.auth.device;
        if (!d) throw apiErr('forbidden', 'only a paired browser reports its boot', 403);
        if (c.bootNoted || !p || p.crashed !== true) return { logged: false };
        c.bootNoted = true;
        // P87: 같은 죽음(id: 죽은 페이지의 부팅 시각)은 한 번만. 답을 받기 전에 끊긴 창이 다시 붙어 또 보낸다
        const bootId = Number.isFinite(p.id) && p.id > 0 ? Math.round(p.id) : null;
        if (bootId != null && this.remoteLog.entries.some((e) => e.event === 'boot' && e.bootId === bootId)) return { logged: false, dup: true };
        this.note('boot', null, { ...(c.auth.meta || {}), deviceId: d.id, deviceName: d.name, node: c.auth.tsNode && c.auth.tsNode.name, crashed: true, light: p.light === true, crash: p.crash, level: p.level, bootId });
        return { logged: true };
      },
      // P86: 가벼운 보드 단계가 이 기기에서 살아남았다(1분 넘게 살았거나 정상으로 떠남). 기기 연결 하나에 한 번
      'web.level': (p, c) => {
        const d = c && c.auth && c.auth.kind === 'device' && c.auth.device;
        if (!d) throw apiErr('forbidden', 'only a paired browser reports its board level', 403);
        if (c.levelNoted || !p || !Number.isInteger(p.level)) return { logged: false };
        c.levelNoted = true;
        this.note('level', null, { ...(c.auth.meta || {}), deviceId: d.id, deviceName: d.name, node: c.auth.tsNode && c.auth.tsNode.name, level: p.level });
        return { logged: true };
      },
      'remote.status': (p) => this.remoteStatus({ fresh: !!(p && p.fresh) }), // P49
      ...this.pushHandlers(), // P88
      'fs.roots': async () => {
        const drives = await driveRoots();
        const seen = new Set(); const recent = [];
        for (const d of this.recentDirs()) { if (!d || seen.has(d.toLowerCase())) continue; seen.add(d.toLowerCase()); try { if (fs.statSync(d).isDirectory()) recent.push(d); } catch {} if (recent.length >= 12) break; }
        return { drives, home: os.homedir(), recent, sep: path.sep };
      },
      'fs.list': (p) => listDirs(p.path),
    };
  }
}
