// P56(원격 S2·S3) 단위 시험: 패스키 등록과 로그인(가짜 인증기, ES256·RS256), 거부(챌린지 재사용·만료, origin·rpId 틀림, UV 없음, 다른 기기의 서명,
// signCount 되돌림, 옛 토큰, 만료 세션, 끊긴 뒤 30분, 짝 푼 기기), 등록 허가(한 번만, 같은 출처), 세션 쿠키 속성(HttpOnly, SameSite=Strict, https면 Secure)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import { Store } from '../src/store.mjs';
import { ApiServer } from '../src/api.mjs';
import { WebServer, Devices, isLocalProcess, sha256 as sha256hex } from '../src/web.mjs';
import { verifyRegistration, verifyAssertion, creationOptions, requestOptions, Challenges, cborDecode, parseAuthData, PasskeyError, CHALLENGE_TTL_MS } from '../src/passkey.mjs';
import { WebAuth, Grants, WebSessions, rpIdOf, sessionCookie, sessionIdOf, cookieName, GRANT_TTL_MS, GRANT_MAX_TRIES } from '../src/web-auth.mjs';
import { normalizePatch, DEFAULTS } from '../src/settings.mjs';
import { FakeAuthenticator, cbor, raw, cookieOf, pairAndRegister, registerWithGrant, loginWith } from './fake-authenticator.mjs';
import { TailscaleWatch } from '../src/tailscale.mjs';
import { fakeWhois } from './fake-tailnet.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p56-'));
const clock = (t0 = 1_700_000_000_000) => { const c = { t: t0, now: () => c.t }; return c; };
const ORIGIN = 'http://localhost:47875';
const RP = 'localhost';
const LOCAL_NODE = { origin: 'local' }; // P59: 짝 맺기가 허가의 extra로 넘기는 P57 기기 기록(이 PC 안에서 짝 맺음)
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'passed'; };

test('등록과 로그인: ES256과 RS256 가짜 인증기, 서버는 공개 키·signCount·RP ID를 둔다', () => {
  for (const alg of [-7, -257]) {
    const a = new FakeAuthenticator({ alg });
    const opts = creationOptions({ rpId: RP, challenge: 'reg-challenge-0123456789abcdef', userId: 'dXNlcg', name: 'laptop' });
    assert.deepEqual(opts.pubKeyCredParams.map((x) => x.alg), [-7, -257]);
    assert.equal(opts.authenticatorSelection.userVerification, 'required');
    assert.equal(opts.attestation, 'none');
    const pk = verifyRegistration(a.create(opts, { origin: ORIGIN }), { challenge: opts.challenge, origin: ORIGIN, rpId: RP });
    assert.equal(pk.credId, a.id); assert.equal(pk.alg, alg); assert.equal(pk.rpId, RP); assert.equal(pk.signCount, 0);
    assert.ok(pk.publicKey.kty === (alg === -7 ? 'EC' : 'RSA'));
    const ro = requestOptions({ rpId: RP, challenge: 'login-challenge-0123456789abcdef', credIds: [a.id] });
    assert.equal(ro.userVerification, 'required');
    const r = verifyAssertion(a.get(ro, { origin: ORIGIN }), { ...pk, userId: 'dXNlcg' }, { challenge: ro.challenge, origin: ORIGIN, rpId: RP });
    assert.equal(r.signCount, 1);
  }
});

test('패스키 확인이 거부하는 것: origin, rpId, UV·UP 없음, type, 다른 기기의 서명, signCount 되돌림, 모르는 알고리즘, 모양 틀린 CBOR', () => {
  const a = new FakeAuthenticator();
  const ex = { challenge: 'c-0123456789abcdefghij', origin: ORIGIN, rpId: RP };
  const opts = creationOptions({ rpId: RP, challenge: ex.challenge, userId: 'dXNlcg', name: 'x' });
  const reg = (o) => code(() => verifyRegistration(a.create(opts, { origin: ORIGIN, ...o }), ex));
  assert.equal(reg({}), 'passed');
  assert.equal(reg({ origin: 'http://localhost:47800' }), 'bad_origin', '다른 포트(다른 판)');
  assert.equal(reg({ origin: 'https://evil.example' }), 'bad_origin');
  assert.equal(reg({ rpId: 'evil.example' }), 'bad_rp');
  assert.equal(reg({ uv: false }), 'no_user_verification');
  assert.equal(reg({ up: false }), 'no_user_presence');
  assert.equal(reg({ type: 'webauthn.get' }), 'bad_type');
  assert.equal(reg({ challenge: 'other-challenge-0123456789' }), 'bad_challenge');
  // 모르는 알고리즘(EdDSA)
  const ed = new FakeAuthenticator(); ed.coseKey = () => new Map([[1, 1], [3, -8], [-1, 6], [-2, Buffer.alloc(32)]]);
  assert.equal(code(() => verifyRegistration(ed.create(opts, { origin: ORIGIN }), ex)), 'bad_alg');
  // credential ID가 authData와 다르면
  const cr = a.create(opts, { origin: ORIGIN }); cr.id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  assert.equal(code(() => verifyRegistration(cr, ex)), 'bad_credential');
  const pk = { ...verifyRegistration(a.create(opts, { origin: ORIGIN }), ex), userId: 'dXNlcg' };
  // 로그인
  const ro = requestOptions({ rpId: RP, challenge: ex.challenge, credIds: [a.id] });
  const get = (o, p = pk) => code(() => verifyAssertion(a.get(ro, { origin: ORIGIN, ...o }), p, ex));
  assert.equal(get({}), 'passed');
  assert.equal(get({ origin: 'https://evil.example' }), 'bad_origin');
  assert.equal(get({ rpId: 'evil.example' }), 'bad_rp');
  assert.equal(get({ uv: false }), 'no_user_verification');
  assert.equal(get({ type: 'webauthn.create' }), 'bad_type');
  const other = new FakeAuthenticator();
  assert.equal(get({ signWith: other }), 'bad_signature', '다른 기기의 키로 서명');
  assert.equal(code(() => verifyAssertion(other.get(ro, { origin: ORIGIN }), pk, ex)), 'unknown_credential', '다른 기기의 credential');
  assert.equal(get({ count: 5 }, { ...pk, signCount: 5 }), 'sign_count', '같은 카운터');
  assert.equal(get({ count: 3 }, { ...pk, signCount: 5 }), 'sign_count', '되돌아간 카운터');
  assert.equal(get({ count: 0 }, { ...pk, signCount: 5 }), 'sign_count', '0으로 돌아감');
  assert.equal(get({ count: 0 }, { ...pk, signCount: 0 }), 'passed', '늘 0인 인증기(동기화 패스키)는 받는다');
  assert.equal(get({ count: 6 }, { ...pk, signCount: 5 }), 'passed');
  // 서명 바이트를 바꾸면
  const bad = a.get(ro, { origin: ORIGIN }); bad.response.authenticatorData = Buffer.from(bad.response.authenticatorData, 'base64url').fill(1, 33, 37).toString('base64url');
  assert.equal(code(() => verifyAssertion(bad, pk, ex)), 'bad_signature');
  // 다른 사용자 핸들
  const uh = a.get(ro, { origin: ORIGIN }); uh.response.userHandle = 'b3RoZXI';
  assert.equal(code(() => verifyAssertion(uh, pk, ex)), 'unknown_credential');
  // CBOR: 길이를 모르는 항목, 뒤에 남는 바이트, 태그
  assert.throws(() => cborDecode(Buffer.from([0x9f, 0x01, 0xff])), (e) => e.code === 'bad_cbor');
  assert.throws(() => cborDecode(Buffer.from([0xc0, 0x01])), (e) => e.code === 'bad_cbor');
  assert.throws(() => cborDecode(Buffer.from([0x5a, 0xff, 0xff, 0xff, 0xff])), (e) => e.code === 'bad_cbor', '길이만 크고 내용 없음');
  assert.deepEqual(cborDecode(cbor(new Map([[1, -7], ['a', Buffer.from([1])]]))).value, new Map([[1, -7], ['a', Buffer.from([1])]]));
  assert.throws(() => parseAuthData(Buffer.alloc(10)), (e) => e.code === 'bad_auth_data');
  assert.ok(new PasskeyError('x') instanceof Error);
});

test('챌린지: 한 번만, 2분 뒤 만료, 넘치면 오래된 것부터 버린다', () => {
  const c = clock();
  const ch = new Challenges({ now: c.now });
  const x = ch.issue({ kind: 'login' });
  assert.equal(ch.take(x).kind, 'login');
  assert.equal(ch.take(x), null, '두 번째는 없다');
  const y = ch.issue({ kind: 'login' });
  c.t += CHALLENGE_TTL_MS + 1;
  assert.equal(ch.take(y), null, '만료');
  const first = ch.issue({});
  for (let i = 0; i < 70; i++) ch.issue({});
  assert.equal(ch.take(first), null, '상한');
  assert.ok(ch.map.size <= 64);
  assert.equal(ch.take(undefined), null);
});

test('RP ID: 페이지의 호스트 이름, IP 주소는 거부', () => {
  assert.equal(rpIdOf('http://localhost:47875'), 'localhost');
  assert.equal(rpIdOf('https://pc.example.ts.net:10000'), 'pc.example.ts.net');
  assert.throws(() => rpIdOf('http://127.0.0.1:47875'), (e) => e.code === 'ip_host');
  assert.throws(() => rpIdOf('http://[::1]:47875'), (e) => e.code === 'ip_host');
  assert.throws(() => rpIdOf('file://'), (e) => e.code === 'bad_origin');
  assert.throws(() => rpIdOf(''), (e) => e.code === 'bad_origin');
});

test('쿠키 속성: HttpOnly, SameSite=Strict, Path=/, https면 Secure와 __Host-, 판 포트마다 이름', () => {
  const plain = sessionCookie({ port: 47875, id: 'abc', secure: false, maxAgeSec: 43200 });
  assert.match(plain, /^atrium_47875=abc; /); assert.match(plain, /; HttpOnly/); assert.match(plain, /; SameSite=Strict/); assert.match(plain, /; Path=\//); assert.match(plain, /; Max-Age=43200/);
  assert.doesNotMatch(plain, /Secure/);
  const sec = sessionCookie({ port: 47875, id: 'abc', secure: true, maxAgeSec: 1 });
  assert.match(sec, /^__Host-atrium_47875=abc; /); assert.match(sec, /; Secure$/); assert.doesNotMatch(sec, /Domain=/i);
  assert.notEqual(cookieName(47800, false), cookieName(47875, false));
  const id = 'x'.repeat(43);
  assert.equal(sessionIdOf({ headers: { cookie: `a=1; atrium_47875=${id}` } }, 47875), id);
  assert.equal(sessionIdOf({ headers: { cookie: `atrium_47800=${id}` } }, 47875), null, '다른 판의 쿠키');
  assert.equal(sessionIdOf({ headers: { cookie: 'atrium_47875=short' } }, 47875), null);
  assert.equal(sessionIdOf({ headers: {} }, 47875), null);
});

test('등록 허가와 세션: 허가는 한 번만·같은 출처·만료, 세션은 해시만 저장, 12시간·끊긴 뒤 30분·짝 풀기·설정으로 바뀐 수명', () => {
  const dir = tmp(); const store = new Store(path.join(dir, 'b.db')); const c = clock();
  const devices = new Devices({ store, now: c.now });
  let connected = new Set();
  const lim = { maxAgeMs: undefined, idleMs: undefined };
  const auth = new WebAuth({ store, devices, now: c.now, limits: () => lim, connected: (h) => connected.has(h) });
  const g = auth.grants.issue({ name: 'laptop', via: 'code', userAgent: 'UA', origin: ORIGIN, extra: LOCAL_NODE });
  // 다른 출처에서는 등록하지 못한다
  assert.throws(() => auth.registerOptions({ grant: g.grant, origin: 'http://localhost:47800' }), (e) => e.code === 'bad_origin');
  assert.throws(() => auth.registerOptions({ grant: 'nope', origin: ORIGIN }), (e) => e.code === 'bad_grant');
  const a = new FakeAuthenticator();
  const { options } = auth.registerOptions({ grant: g.grant, origin: ORIGIN });
  const r = auth.register({ grant: g.grant, credential: a.create(options, { origin: ORIGIN }), origin: ORIGIN });
  assert.equal(r.device.name, 'laptop'); assert.equal(r.device.needsRepair, false); assert.ok(!('credId' in r.device.passkey) && !('publicKey' in r.device.passkey), '목록에 공개 키·credential ID를 싣지 않는다');
  assert.throws(() => auth.registerOptions({ grant: g.grant, origin: ORIGIN }), (e) => e.code === 'bad_grant', '허가는 한 번만');
  const saved = JSON.stringify(store.getMeta('webSessions'));
  assert.ok(!saved.includes(r.session.id), '세션 ID 원문은 저장하지 않는다');
  assert.ok(saved.includes(sha256hex(r.session.id)));
  assert.equal(auth.sessions.check(r.session.id).deviceId, r.device.id);
  // 같은 패스키를 두 번 등록하지 못한다
  const g2 = auth.grants.issue({ name: 'again', via: 'code', origin: ORIGIN, extra: LOCAL_NODE });
  const o2 = auth.registerOptions({ grant: g2.grant, origin: ORIGIN }).options;
  assert.throws(() => auth.register({ grant: g2.grant, credential: a.create(o2, { origin: ORIGIN }), origin: ORIGIN }), (e) => e.code === 'duplicate_credential');
  // 틀린 등록이 GRANT_MAX_TRIES번이면 허가를 버린다
  const g3 = auth.grants.issue({ name: 'z', via: 'code', origin: ORIGIN, extra: LOCAL_NODE });
  for (let i = 0; i < GRANT_MAX_TRIES; i++) {
    const oo = auth.registerOptions({ grant: g3.grant, origin: ORIGIN }).options;
    assert.throws(() => auth.register({ grant: g3.grant, credential: new FakeAuthenticator().create(oo, { origin: ORIGIN, uv: false }), origin: ORIGIN }), (e) => e.code === 'no_user_verification');
  }
  assert.equal(auth.grants.peek(g3.grant), null);
  // 만료된 허가
  const g4 = auth.grants.issue({ name: 'late', via: 'code', origin: ORIGIN, extra: LOCAL_NODE });
  c.t += GRANT_TTL_MS + 1;
  assert.throws(() => auth.registerOptions({ grant: g4.grant, origin: ORIGIN }), (e) => e.code === 'bad_grant');
  // 로그인: 챌린지 재사용과 만료
  const lo = auth.loginOptions({ credentialId: a.id, origin: ORIGIN });
  assert.equal(lo.status, 'ok'); assert.deepEqual(lo.options.allowCredentials.map((x) => x.id), [a.id]);
  const cred = a.get(lo.options, { origin: ORIGIN });
  const s1 = auth.login({ credential: cred, origin: ORIGIN });
  assert.ok(s1.session.id);
  assert.throws(() => auth.login({ credential: cred, origin: ORIGIN }), (e) => e.code === 'bad_challenge', '같은 서명(챌린지)을 다시 쓰지 못한다');
  const lo2 = auth.loginOptions({ credentialId: a.id, origin: ORIGIN });
  c.t += CHALLENGE_TTL_MS + 1;
  assert.throws(() => auth.login({ credential: a.get(lo2.options, { origin: ORIGIN }), origin: ORIGIN }), (e) => e.code === 'bad_challenge', '만료된 챌린지');
  const lo3 = auth.loginOptions({ credentialId: a.id, origin: ORIGIN });
  assert.throws(() => auth.login({ credential: a.get(lo3.options, { origin: ORIGIN }), origin: 'http://localhost:47800' }), (e) => e.code === 'bad_challenge', '챌린지를 받은 출처와 다르다');
  assert.equal(auth.loginOptions({ credentialId: 'bm90LWEtcmVhbC1jcmVk', origin: ORIGIN }).status, 'unpaired', '모르는 credential');
  assert.equal(auth.loginOptions({ credentialId: a.id, origin: 'https://pc.example.ts.net' }).status, 'unpaired', '다른 주소에서 만든 패스키');
  assert.equal(auth.loginOptions({ origin: ORIGIN }).options.allowCredentials.length, 0, '기억한 ID가 없으면 찾을 수 있는 패스키로');
  // 세션 수명: 연결이 열려 있으면 끊긴 시간을 세지 않는다
  const s = auth.login({ credential: a.get(auth.loginOptions({ credentialId: a.id, origin: ORIGIN }).options, { origin: ORIGIN }), origin: ORIGIN }).session;
  connected = new Set([s.hash]);
  c.t += 2 * 3600_000; assert.ok(auth.sessions.check(s.id), '연결된 채 2시간');
  connected = new Set();
  c.t += 29 * 60_000; assert.ok(auth.sessions.check(s.id), '끊긴 뒤 29분');
  c.t += 2 * 60_000; assert.equal(auth.sessions.check(s.id), null, '끊긴 뒤 31분');
  // 12시간
  const s2 = auth.login({ credential: a.get(auth.loginOptions({ credentialId: a.id, origin: ORIGIN }).options, { origin: ORIGIN }), origin: ORIGIN }).session;
  connected = new Set([s2.hash]);
  c.t += 11 * 3600_000; assert.ok(auth.sessions.check(s2.id));
  c.t += 3600_000 + 1; assert.equal(auth.sessions.check(s2.id), null, '로그인 뒤 12시간');
  assert.equal(s2.maxAgeMs, 12 * 3600_000);
  // 설정으로 바꾼 수명(줄이면 곧바로)
  connected = new Set();
  const s3 = auth.login({ credential: a.get(auth.loginOptions({ credentialId: a.id, origin: ORIGIN }).options, { origin: ORIGIN }), origin: ORIGIN }).session;
  lim.idleMs = 5 * 60_000;
  c.t += 6 * 60_000; assert.equal(auth.sessions.check(s3.id), null, '끊긴 채 5분(설정)');
  lim.idleMs = undefined; lim.maxAgeMs = 3600_000;
  const s4 = auth.login({ credential: a.get(auth.loginOptions({ credentialId: a.id, origin: ORIGIN }).options, { origin: ORIGIN }), origin: ORIGIN }).session;
  connected = new Set([s4.hash]);
  c.t += 3600_000; assert.equal(auth.sessions.check(s4.id), null, '1시간(설정)');
  // 짝을 풀면 그 기기의 세션이 모두 끝난다
  lim.maxAgeMs = undefined; connected = new Set();
  const s5 = auth.login({ credential: a.get(auth.loginOptions({ credentialId: a.id, origin: ORIGIN }).options, { origin: ORIGIN }), origin: ORIGIN }).session;
  assert.ok(auth.sessions.countFor(r.device.id) >= 1);
  devices.revoke(r.device.id); auth.sessions.endDevice(r.device.id);
  assert.equal(auth.sessions.check(s5.id), null);
  assert.equal(auth.loginOptions({ credentialId: a.id, origin: ORIGIN }).status, 'unpaired', '짝 푼 기기는 짝 맺기 화면으로');
  // 백엔드를 다시 켜면 세션은 남고 끊긴 시간은 그때부터
  const g5 = auth.grants.issue({ name: 'b', via: 'code', origin: ORIGIN, extra: LOCAL_NODE }); const b2 = new FakeAuthenticator();
  const r5 = auth.register({ grant: g5.grant, credential: b2.create(auth.registerOptions({ grant: g5.grant, origin: ORIGIN }).options, { origin: ORIGIN }), origin: ORIGIN });
  c.t += 20 * 60_000;
  const again = new WebSessions({ store, now: c.now, connected: () => false });
  c.t += 20 * 60_000; assert.ok(again.check(r5.session.id), '다시 켠 뒤 20분');
  c.t += 11 * 60_000; assert.equal(again.check(r5.session.id), null);
  store.close();
});

test('설정: remoteSessionHours 기본 12(1~168), remoteIdleMinutes 기본 30(5~1440)', () => {
  assert.equal(DEFAULTS.remoteSessionHours, 12); assert.equal(DEFAULTS.remoteIdleMinutes, 30);
  assert.deepEqual(normalizePatch({ remoteSessionHours: '24', remoteIdleMinutes: 10 }), { remoteSessionHours: 24, remoteIdleMinutes: 10 });
  assert.throws(() => normalizePatch({ remoteSessionHours: 0 }));
  assert.throws(() => normalizePatch({ remoteIdleMinutes: 2 }));
});

// ---------- 진짜 HTTP·WebSocket 서버로 ----------
// P59: ts = 가짜 Tailscale(serve 흉내). P57부터 이 PC 밖 Host의 기기 요청은 whois로 기기를 확인하므로, https 앞단은 serve를 흉내 낸다
const fakeTs = (port) => new TailscaleWatch({ port, bin: 'tailscale', run: async (bin, args) => {
  const a = args.join(' ');
  if (a === 'status --json') return JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pc.example.ts.net.', UserID: 1 }, User: { 1: { LoginName: 'me@example.com' } }, CurrentTailnet: { MagicDNSEnabled: true }, CertDomains: ['pc.example.ts.net'] });
  if (a === 'serve status --json') return JSON.stringify({ Web: { 'pc.example.ts.net:443': { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } } } });
  if (args[0] === 'whois') { const w = fakeWhois(args[2]); if (!w) throw new Error('no match'); return JSON.stringify(w); }
  throw new Error('unexpected');
} });
async function boot({ c = clock(), hosts = '', ts = false } = {}) {
  const dir = tmp();
  const dist = path.join(dir, 'dist'); fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Atrium</title>');
  process.env.ATRIUM_WEB_DIST = dist;
  if (hosts) process.env.ATRIUM_WEB_HOSTS = hosts;
  const store = new Store(path.join(dir, 'board.db'));
  const srv = http.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const st = {};
  const logs = [];
  const tailscale = ts ? fakeTs(port) : null;
  if (tailscale) await tailscale.refresh();
  const web = new WebServer({ cfg: { remoteEnabled: true, port, dataDir: dir, profile: 'dev', herdrSession: 'atrium-dev-test' }, store, api: null, now: c.now, settings: () => st, log: (m) => logs.push(m), tailscale });
  delete process.env.ATRIUM_WEB_HOSTS;
  const apiToken = 'board-api-token-for-test';
  const api = new ApiServer({ token: apiToken, handlers: { ...web.handlers(), whoami: (p, cl) => ({ kind: cl.auth.kind, device: cl.auth.device || null }), 'events.subscribe': (p, cl) => { cl.subscribed = true; return {}; } }, authorize: (req) => web.authorize(req, apiToken), onClose: () => {} });
  web.api = api;
  srv.on('request', (req, res) => { if (!isLocalProcess(req, port) && req.url.startsWith('/hooks/')) { res.writeHead(403); return res.end(); } if (web.handleHttp(req, res)) return; res.writeHead(404); res.end(); });
  srv.on('upgrade', (req, s, h) => api.handleUpgrade(req, s, h));
  const close = async () => { api.close(); web.stop(); if (tailscale) tailscale.stop(); await new Promise((r) => srv.close(r)); store.close(); delete process.env.ATRIUM_WEB_DIST; };
  return { c, dir, port, web, api, apiToken, st, store, logs, close };
}
const wsOpen = (url, headers = {}) => new Promise((res) => {
  const ws = new WebSocket(url, { headers });
  ws.on('open', () => res({ ok: true, ws }));
  ws.on('unexpected-response', (_r, resp) => res({ ok: false, status: resp.statusCode }));
  ws.on('error', () => res({ ok: false }));
});
const wsCall = (ws, method, params = {}) => new Promise((res) => { const id = Math.random(); const on = (m0) => { const m = JSON.parse(String(m0)); if (m.id === id) { ws.off('message', on); res(m); } }; ws.on('message', on); ws.send(JSON.stringify({ id, method, params })); });

test('HTTP: 코드로 짝 맺기 → 등록 허가 → 패스키 등록 → 쿠키 세션으로 /web/me·WebSocket, 옛 토큰과 쿠키 없는 요청은 거부, 짝 풀면 4401', async () => {
  const b = await boot();
  const origin = `http://localhost:${b.port}`;
  const H = { host: `localhost:${b.port}`, origin };
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    // 옛 토큰 기기(P48~P55): 기록에 hash만 있다
    const oldToken = 'old-device-token-0123456789abcdefghijkl';
    b.store.setMeta('webDevices', [{ id: 'old-1', name: 'old laptop', via: 'code', createdAt: 1, lastSeenAt: null, hash: sha256hex(oldToken), extraField: 'kept' }]);
    // 짝 맺기 코드는 기기 토큰이 아니라 등록 허가를 준다
    const pc = (await wsCall(local.ws, 'device.code')).result.code;
    const pr = await raw(b.port, '/web/pair/code', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ code: pc, name: 'laptop' }) });
    assert.equal(pr.status, 200);
    assert.ok(pr.body.grant && pr.body.expiresAt); assert.ok(!('token' in pr.body) && !('device' in pr.body));
    assert.equal(b.web.devices.list().length, 1, '등록 전에는 기기가 없다');
    // Origin 없는 등록은 거부
    assert.equal((await raw(b.port, '/web/passkey/register/options', { method: 'POST', headers: { host: H.host, 'content-type': 'application/json' }, body: JSON.stringify({ grant: pr.body.grant }) })).status, 403);
    const reg = await registerWithGrant(b.port, pr.body.grant, H);
    assert.equal(reg.res.status, 200, JSON.stringify(reg.res.body));
    assert.equal(reg.options.rp.id, 'localhost');
    const sc = reg.res.cookies[0];
    assert.match(sc, new RegExp(`^atrium_${b.port}=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200$`), sc);
    assert.ok(!JSON.stringify(reg.res.body).includes(sc.split(';')[0].split('=')[1]), '세션 ID는 몸에 싣지 않는다');
    const cookie = reg.cookie;
    // 허가를 다시 쓰지 못한다
    assert.equal((await registerWithGrant(b.port, pr.body.grant, H)).res.status, 403);
    // /web/me: 쿠키로만
    assert.equal((await raw(b.port, '/web/me', { headers: { host: H.host } })).status, 401);
    assert.equal((await raw(b.port, '/web/me', { headers: { host: H.host, authorization: `Bearer ${oldToken}` } })).status, 401, '옛 토큰(Bearer)');
    const me = await raw(b.port, '/web/me', { headers: { host: H.host, cookie } });
    assert.equal(me.status, 200); assert.equal(me.body.device.id, reg.device.id);
    // 업로드도 쿠키로
    assert.equal((await raw(b.port, '/web/upload?name=a.txt', { method: 'POST', headers: { ...H, authorization: `Bearer ${oldToken}` }, body: 'x' })).status, 401);
    assert.equal((await raw(b.port, '/web/upload?name=a.txt', { method: 'POST', headers: { ...H, cookie }, body: 'x' })).status, 200);
    // WebSocket: 쿠키 + 같은 출처
    assert.equal((await wsOpen(`ws://localhost:${b.port}/api?device=${oldToken}`, { origin })).ok, false, '옛 토큰(?device=)');
    assert.equal((await wsOpen(`ws://localhost:${b.port}/api?device=${oldToken}`, { origin, cookie })).ok, false, '옛 토큰 길은 쿠키가 있어도 닫힌다');
    assert.equal((await wsOpen(`ws://localhost:${b.port}/api`, { origin })).ok, false, '쿠키 없음');
    assert.equal((await wsOpen(`ws://localhost:${b.port}/api`, { cookie })).ok, false, 'Origin 없음');
    assert.equal((await wsOpen(`ws://localhost:${b.port}/api`, { cookie, origin: 'http://evil.example' })).ok, false, '다른 출처');
    const dev = await wsOpen(`ws://localhost:${b.port}/api`, { origin, cookie });
    assert.equal(dev.ok, true);
    assert.equal((await wsCall(dev.ws, 'whoami')).result.device.id, reg.device.id);
    // 옛 기기는 목록에 "다시 짝 맺기 필요"로, 모르는 필드는 그대로
    const list = (await wsCall(local.ws, 'device.list')).result.devices;
    const old = list.find((d) => d.id === 'old-1');
    assert.equal(old.needsRepair, true); assert.ok(!('hash' in old));
    assert.equal(b.store.getMeta('webDevices').find((d) => d.id === 'old-1').extraField, 'kept');
    assert.equal(list.find((d) => d.id === reg.device.id).sessions, 1);
    // 패스키 로그인(새로 고침 뒤 다시 확인처럼): 새 세션
    const li = await loginWith(b.port, reg.auth, H);
    assert.equal(li.res.status, 200); assert.ok(li.cookie && li.cookie !== cookie);
    assert.equal((await raw(b.port, '/web/passkey/login', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ credential: li.credential }) })).status, 401, '같은 서명을 다시 보내면(챌린지 재사용)');
    // 다른 기기의 서명
    const other = new FakeAuthenticator();
    assert.equal((await loginWith(b.port, reg.auth, H, { signWith: other })).res.status, 401);
    // signCount 되돌림
    assert.equal((await loginWith(b.port, reg.auth, H, { count: 0 })).res.status, 401);
    // 로그와 화면에 비밀이 없다
    const secrets = [cookie.split('=')[1], li.cookie.split('=')[1], pr.body.grant, pc];
    for (const s of secrets) assert.ok(!b.logs.join('\n').includes(s), '로그에 비밀이 없다');
    // 끊기: 그 기기의 연결이 4401로 닫히고 세션이 모두 끝난다
    const closed = new Promise((r) => dev.ws.on('close', (cd) => r(cd)));
    assert.equal((await wsCall(local.ws, 'device.revoke', { id: reg.device.id })).result.revoked, true);
    assert.equal(await closed, 4401);
    assert.equal((await raw(b.port, '/web/me', { headers: { host: H.host, cookie } })).status, 401);
    assert.equal((await raw(b.port, '/web/me', { headers: { host: H.host, cookie: li.cookie } })).status, 401, '그 기기의 다른 세션도');
    assert.equal((await wsOpen(`ws://localhost:${b.port}/api`, { origin, cookie: li.cookie })).ok, false);
    const lo = await raw(b.port, '/web/passkey/login/options', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ credentialId: reg.auth.id }) });
    assert.equal(lo.body.status, 'unpaired', '짝 푼 기기는 짝 맺기 화면으로');
    // 옛 기기는 PC에서 지운다
    assert.equal((await wsCall(local.ws, 'device.revoke', { id: 'old-1' })).result.revoked, true);
    // IP 주소로 연 페이지는 패스키를 쓰지 못한다
    const ipH = { host: `127.0.0.1:${b.port}`, origin: `http://127.0.0.1:${b.port}` };
    const pc2 = (await wsCall(local.ws, 'device.code')).result.code;
    const pr2 = await raw(b.port, '/web/pair/code', { method: 'POST', headers: { ...ipH, 'content-type': 'application/json' }, body: JSON.stringify({ code: pc2 }) });
    const ro = await raw(b.port, '/web/passkey/register/options', { method: 'POST', headers: { ...ipH, 'content-type': 'application/json' }, body: JSON.stringify({ grant: pr2.body.grant }) });
    assert.equal(ro.status, 400); assert.equal(ro.body.error.code, 'ip_host');
    local.ws.close();
  } finally { await b.close(); }
});

test('HTTP: 세션 만료(12시간)와 끊긴 뒤 30분이면 연결이 4401로 닫히고 다시 확인하면 된다, 로그아웃', async () => {
  const b = await boot();
  const origin = `http://localhost:${b.port}`;
  const H = { host: `localhost:${b.port}`, origin };
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const pc = (await wsCall(local.ws, 'device.code')).result.code;
    const reg = await pairAndRegister(b.port, pc, H);
    assert.equal(reg.res.status, 200);
    const dev = await wsOpen(`ws://localhost:${b.port}/api`, { origin, cookie: reg.cookie });
    assert.equal(dev.ok, true);
    // 연결된 채 11시간: 살아 있다
    b.c.t += 11 * 3600_000; assert.equal(b.web.sweepSessions(), 0);
    // 12시간: 닫힌다
    const closed = new Promise((r) => dev.ws.on('close', (cd, why) => r([cd, String(why)])));
    b.c.t += 3600_000 + 1;
    assert.equal(b.web.sweepSessions(), 1);
    assert.deepEqual(await closed, [4401, 'session ended']);
    assert.equal((await raw(b.port, '/web/me', { headers: { host: H.host, cookie: reg.cookie } })).status, 401);
    // 다시 확인
    const li = await loginWith(b.port, reg.auth, H);
    assert.equal(li.res.status, 200);
    const dev2 = await wsOpen(`ws://localhost:${b.port}/api`, { origin, cookie: li.cookie });
    assert.equal(dev2.ok, true);
    // 연결을 끊고 31분(노트북 잠자기)
    await new Promise((r) => { dev2.ws.on('close', r); dev2.ws.close(); });
    await new Promise((r) => setTimeout(r, 50));
    b.c.t += 31 * 60_000;
    assert.equal((await raw(b.port, '/web/me', { headers: { host: H.host, cookie: li.cookie } })).status, 401, '끊긴 뒤 31분');
    assert.equal((await wsOpen(`ws://localhost:${b.port}/api`, { origin, cookie: li.cookie })).ok, false);
    // 설정한 수명이 새 쿠키의 Max-Age
    b.st.remoteSessionHours = 2;
    const li2 = await loginWith(b.port, reg.auth, H);
    assert.match(li2.res.cookies[0], /Max-Age=7200/);
    // 로그아웃: 세션을 끝내고 쿠키를 지운다
    const out = await raw(b.port, '/web/logout', { method: 'POST', headers: { ...H, cookie: li2.cookie } });
    assert.equal(out.status, 200); assert.ok(out.cookies.every((x) => /Max-Age=0/.test(x)));
    assert.equal((await raw(b.port, '/web/me', { headers: { host: H.host, cookie: li2.cookie } })).status, 401);
    local.ws.close();
  } finally { await b.close(); }
});

test('HTTP: https 출처(앞단 프록시)면 쿠키에 Secure와 __Host-', async () => {
  const b = await boot({ ts: true });
  // serve가 넘기는 모양(Tailscale 사용자, 요청한 기기 주소 = 가짜 whois의 노트북 A)
  const SERVE = { host: 'pc.example.ts.net', 'tailscale-user-login': 'me@example.com', 'x-forwarded-for': '100.64.0.2', 'x-forwarded-proto': 'https' };
  const H = { ...SERVE, origin: 'https://pc.example.ts.net' };
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const pc = (await wsCall(local.ws, 'device.code')).result.code;
    const reg = await pairAndRegister(b.port, pc, H);
    assert.equal(reg.res.status, 200, JSON.stringify(reg.res.body));
    assert.equal(reg.options.rp.id, 'pc.example.ts.net');
    assert.match(reg.res.cookies[0], new RegExp(`^__Host-atrium_${b.port}=[^;]+; HttpOnly; SameSite=Strict; Path=/; Max-Age=\\d+; Secure$`));
    assert.equal((await raw(b.port, '/web/me', { headers: { ...SERVE, cookie: reg.cookie } })).status, 200);
    // 다른 출처에서 만든 허가로는 등록하지 못한다(짝 맺은 페이지와 등록하는 페이지가 같아야)
    const pc2 = (await wsCall(local.ws, 'device.code')).result.code;
    const pr = await raw(b.port, '/web/pair/code', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ code: pc2 }) });
    const lh = { host: `localhost:${b.port}`, origin: `http://localhost:${b.port}` };
    assert.equal((await registerWithGrant(b.port, pr.body.grant, lh)).res.status, 403);
    local.ws.close();
  } finally { await b.close(); }
});

test('허락 짝 맺기도 등록 허가를 한 번만 준다', async () => {
  const b = await boot();
  const H = { host: `localhost:${b.port}`, origin: `http://localhost:${b.port}` };
  try {
    const local = await wsOpen(`ws://127.0.0.1:${b.port}/api?token=${b.apiToken}`);
    const q = (await raw(b.port, '/web/pair/request', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'tab' }) })).body;
    assert.equal((await wsCall(local.ws, 'device.approve', { id: q.requestId })).result.status, 'approved');
    const got = (await raw(b.port, `/web/pair/poll?id=${q.requestId}&secret=${q.secret}`, { headers: { host: H.host } })).body;
    assert.equal(got.status, 'approved'); assert.ok(got.grant); assert.ok(!('token' in got));
    assert.equal((await raw(b.port, `/web/pair/poll?id=${q.requestId}&secret=${q.secret}`, { headers: { host: H.host } })).body.status, 'expired');
    const reg = await registerWithGrant(b.port, got.grant, H);
    assert.equal(reg.res.status, 200); assert.equal(reg.device.via, 'approve'); assert.equal(reg.device.name, 'tab');
    local.ws.close();
  } finally { await b.close(); }
});

test('Grants 단독: 수 상한, 모르는 값', () => {
  const c = clock(); const g = new Grants({ now: c.now });
  const first = g.issue({ name: 'a', origin: ORIGIN });
  for (let i = 0; i < 20; i++) g.issue({ name: 'n', origin: ORIGIN });
  assert.equal(g.peek(first.grant), null);
  assert.equal(g.peek(123), null); assert.equal(g.peek('x'.repeat(500)), null);
});
