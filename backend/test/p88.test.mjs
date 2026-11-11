// P88 단위 시험: 웹 푸시. RFC 8291 시험 벡터(aes128gcm), VAPID 서명(RFC 8292), endpoint 허용 목록(SSRF), 알릴 때 판단, 알림 글에 질문·요청·답이 없음,
// 404·410이면 구독 지움, 짝 풀기·원격 막기면 구독 지움
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { WebServer } from '../src/web.mjs';
import { logEntry, RemoteLog } from '../src/remote-log.mjs';
import { pushTestLine } from '../bin/atrium-remote.mjs';
import {
  b64u, unb64u, encryptPayload, decryptPayload, makeVapidKeys, loadVapidKeys, vapidJwt, vapidAuth, endpointCheck, privateAddr,
  pushKindOf, pushText, pushPayload, Pusher, COOLDOWN_MS, JWT_TTL_SEC,
} from '../src/web-push.mjs';
import { SETTLE_MS } from '../src/push-cycle.mjs';
// P92: 끝남은 작업 사이클이 끝날 때(일함 → 쉼 → SETTLE_MS) 보낸다
const endTurn = (p, o, tick) => { p.onState(sum({ ...o, state: 'working' }), 'ready'); p.onState(sum(o), 'working'); tick(SETTLE_MS); p.tickCycles(); };

// ---------- RFC 8291 부록 A ----------
const V = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ',
};

test('aes128gcm: RFC 8291 부록 A의 머리(86바이트)와 암호문이 그대로 나오고, 받는 쪽 키로 풀린다', () => {
  const out = encryptPayload(unb64u(V.plaintext), { p256dh: V.uaPublic, auth: V.auth }, { salt: unb64u(V.salt), asPrivate: V.asPrivate });
  assert.equal(out.length, 86 + unb64u(V.ciphertext).length);
  assert.equal(b64u(out.subarray(0, 86)), V.header.replace(/\s+/g, ''));
  assert.equal(b64u(out.subarray(86)), V.ciphertext.replace(/\s+/g, ''));
  assert.equal(decryptPayload(out, { uaPrivate: V.uaPrivate, auth: V.auth }).toString(), 'When I grow up, I want to be a watermelon');
});

test('aes128gcm: 새 키로 만든 구독도 같은 키로 풀리고, 다른 auth로는 풀리지 않는다. 키 크기가 틀리면 거절', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const msg = JSON.stringify({ title: '@a · 끝남' });
  const out = encryptPayload(Buffer.from(msg), { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) });
  assert.equal(out.readUInt32BE(16), 4096);
  assert.equal(out[20], 65);
  assert.equal(decryptPayload(out, { uaPrivate: ua.getPrivateKey(), auth }).toString(), msg);
  assert.throws(() => decryptPayload(out, { uaPrivate: ua.getPrivateKey(), auth: crypto.randomBytes(16) }));
  assert.throws(() => encryptPayload(Buffer.from('x'), { p256dh: b64u(ua.getPublicKey()), auth: b64u(crypto.randomBytes(8)) }), /auth/);
  assert.throws(() => encryptPayload(Buffer.from('x'), { p256dh: b64u(crypto.randomBytes(33)), auth: b64u(auth) }), /p256dh/);
});

test('VAPID: JWT 모양(ES256, aud·exp·sub), 만료는 12시간(24시간 이하), 공개 키로 서명이 맞는다. Authorization 머리글', () => {
  const k = makeVapidKeys();
  assert.equal(k.publicKey.length, 65);
  const now = 1_762_500_000_000;
  const jwt = vapidJwt({ aud: 'https://web.push.apple.com', sub: 'https://github.com/x/y', jwk: k.jwk, now });
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(unb64u(h)), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(unb64u(c));
  assert.deepEqual(claims, { aud: 'https://web.push.apple.com', exp: Math.floor(now / 1000) + JWT_TTL_SEC, sub: 'https://github.com/x/y' });
  assert.ok(claims.exp - now / 1000 <= 24 * 3600);
  assert.equal(unb64u(s).length, 64, 'r||s 64바이트(DER 아님)');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: k.jwk.x, y: k.jwk.y }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, unb64u(s)));
  const longer = JSON.parse(unb64u(vapidJwt({ aud: 'a', sub: 'b', jwk: k.jwk, now, ttlSec: 99 * 3600 }).split('.')[1]));
  assert.equal(longer.exp, Math.floor(now / 1000) + 24 * 3600, '24시간으로 자른다');
  assert.equal(vapidAuth(jwt, k.publicKey), `vapid t=${jwt}, k=${b64u(k.publicKey)}`);
});

test('VAPID 키 파일: 처음에 만들고 다음에는 같은 키를 읽는다(공개 키만 내보낸다)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p88-'));
  try {
    const f = path.join(dir, 'vapid.json');
    const a = loadVapidKeys(f); const b = loadVapidKeys(f);
    assert.equal(b64u(a.publicKey), b64u(b.publicKey));
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.deepEqual(Object.keys(j.jwk).sort(), ['crv', 'd', 'kty', 'x', 'y']);
    const p = new Pusher({ store: null, keyFile: f, subject: 's' });
    assert.equal(p.publicKey(), b64u(a.publicKey));
    assert.ok(!p.publicKey().includes(j.jwk.d));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('endpoint 허용 목록: 알려진 푸시 서비스의 https만. http·IP·내부 주소·다른 호스트·포트·사용자 정보는 거부', () => {
  for (const u of ['https://web.push.apple.com/QGx_abc', 'https://fcm.googleapis.com/fcm/send/abc:def', 'https://updates.push.services.mozilla.com/wpush/v2/gAAA', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://web.push.apple.com:443/x']) assert.equal(endpointCheck(u).ok, true, u);
  const no = {
    'http://web.push.apple.com/x': 'not_https', 'https://127.0.0.1/x': 'ip', 'https://[::1]/x': 'ip', 'https://10.0.0.5/x': 'ip', 'https://100.100.100.100/x': 'ip',
    'https://localhost/x': 'host', 'https://evil.example/x': 'host', 'https://web.push.apple.com.evil.example/x': 'host', 'https://evilpush.apple.com/x': 'host', 'https://googleapis.com/x': 'host',
    'https://web.push.apple.com:8443/x': 'port', 'https://user:pw@web.push.apple.com/x': 'userinfo', 'file:///etc/passwd': 'not_https', 'ftp://fcm.googleapis.com/': 'not_https',
  };
  for (const [u, why] of Object.entries(no)) assert.deepEqual(endpointCheck(u), { ok: false, reason: why }, u);
  assert.equal(endpointCheck(`https://web.push.apple.com/${'a'.repeat(2100)}`).reason, 'bad_endpoint');
  assert.equal(endpointCheck(null).reason, 'bad_endpoint');
  assert.equal(endpointCheck('not a url').reason, 'bad_endpoint');
  // 개발용 판의 흉내 푸시 서비스: 출처가 정확히 같을 때만
  assert.deepEqual(endpointCheck('https://localhost:47898/push/1', { testOrigins: ['https://localhost:47898'] }), { ok: true, host: 'localhost', test: true });
  assert.equal(endpointCheck('https://localhost:47899/push/1', { testOrigins: ['https://localhost:47898'] }).ok, false);
  assert.equal(endpointCheck('http://localhost:47898/push/1', { testOrigins: ['http://localhost:47898'] }).reason, 'not_https');
});

test('보낼 때 풀린 주소: 사설·루프백·링크 로컬·Tailscale(100.64/10)·IPv4 매핑은 막는다', () => {
  for (const a of ['10.1.2.3', '172.20.0.1', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '100.127.255.254', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:192.168.1.1', '::ffff:127.0.0.1', 'garbage']) assert.equal(privateAddr(a), true, a);
  for (const a of ['17.253.144.10', '142.250.1.1', '2a00:1450:4001::200e', '::ffff:17.1.1.1']) assert.equal(privateAddr(a), false, a);
});

// ---------- 알릴 때 판단 ----------
const sum = (o = {}) => ({ sessionId: 's1', name: 'alpha', kind: 'claude', state: 'ready', workspaceKey: 'w1', exit: null, ...o });
test('상태 바뀜 → 종류: 끝남, 응답 필요, 오류, 예기치 않은 끝남. 셸과 처음 보는 상태는 뺀다', () => {
  assert.equal(pushKindOf(sum(), 'working'), 'done');
  assert.equal(pushKindOf(sum(), 'starting'), null, '처음 뜸은 끝남이 아니다');
  assert.equal(pushKindOf(sum(), 'waiting'), null);
  assert.equal(pushKindOf(sum({ state: 'waiting' }), 'working'), 'need');
  assert.equal(pushKindOf(sum({ state: 'trust_wait' }), 'starting'), 'need');
  assert.equal(pushKindOf(sum({ state: 'error' }), 'working'), 'error');
  assert.equal(pushKindOf(sum({ state: 'exited', exit: { kind: 'other' } }), 'working'), 'exit');
  assert.equal(pushKindOf(sum({ state: 'exited', exit: { kind: 'normal' } }), 'ready'), null, '사람이 끔');
  assert.equal(pushKindOf(sum({ state: 'exited', exit: { kind: 'herdr_stopped' } }), 'ready'), null, '판이 끔');
  assert.equal(pushKindOf(sum({ kind: 'shell', state: 'ready' }), 'working'), null);
  assert.equal(pushKindOf(sum(), null), null);
  assert.equal(pushKindOf(sum(), undefined), null);
  assert.equal(pushKindOf(sum({ state: 'working' }), 'ready'), null);
  assert.equal(pushKindOf(sum({ state: 'sleeping' }), 'ready'), null);
});

test('알림 글: 세션 이름과 종류(하나면 프로젝트 이름), 묶으면 세션 수와 이름 넷까지', () => {
  assert.deepEqual(pushText([{ sessionId: 'a', name: 'alpha', kind: 'done', ws: 'repo' }], 'ko'), { title: '@alpha · 끝남', body: 'repo' });
  assert.deepEqual(pushText([{ sessionId: 'a', name: 'alpha', kind: 'need', ws: null }], 'en'), { title: '@alpha · needs you', body: 'Atrium' });
  const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((n, i) => ({ sessionId: n, name: n, kind: i === 2 ? 'need' : 'done', ws: 'w' }));
  assert.deepEqual(pushText(many, 'ko'), { title: '세션 6개', body: '@a 끝남 · @b 끝남 · @c 응답 필요 · @d 끝남 · 외 2개' });
  const p = pushPayload(many, 'ko', 5);
  assert.equal(p.sessionId, 'c', '누르면 응답 필요 세션으로');
  assert.equal(p.tag, 'atrium-batch');
  assert.equal(pushPayload([many[0]], 'en', 5).tag, 'atrium-a');
  assert.equal(pushText([{ sessionId: 'a', name: 'x\u0007y', kind: 'error' }], 'ko').title, '@x y · 오류');
});

// 흉내 구독(받는 쪽 키를 시험이 쥔다)과 받은 요청을 모으는 흉내 전송
function fakeSub(endpoint = 'https://web.push.apple.com/QGx_test') {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return { sub: { endpoint, keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } }, open: (body) => JSON.parse(decryptPayload(body, { uaPrivate: ua.getPrivateKey(), auth }).toString()) };
}
function rig(o = {}) {
  let t = 1_762_500_000_000;
  const sent = []; const notes = [];
  const state = { watching: false, pc: false, enabled: true, status: 201 };
  const p = new Pusher({
    store: null, subject: 'https://github.com/x/y', now: () => t, batchMs: 60_000, timers: false,
    note: (ev, f) => notes.push({ ev, ...f }), watching: () => state.watching, pcActive: () => state.pc, enabled: () => state.enabled, wsName: (k) => (k === 'w1' ? 'repo-one' : null),
    transport: async (endpoint, opts) => { sent.push({ endpoint, ...opts }); return { status: state.status }; },
    ...o,
  });
  return { p, sent, notes, state, tick: (ms) => { t += ms; }, now: () => t };
}

test('보내기: 머리글(VAPID, TTL, 암호화), 풀면 세션 이름·종류·프로젝트만. 질문·요청·답 글은 들어가지 않는다', async () => {
  const { p, sent, notes } = rig();
  const f = fakeSub();
  p.subscribe('dev-1', f.sub, 'ko-KR');
  assert.deepEqual(notes.at(-1), { ev: 'push.on', deviceId: 'dev-1', host: 'web.push.apple.com' });
  const secret = { lastPrompt: 'SECRET-PROMPT rm -rf', lastAnswer: 'SECRET-ANSWER', ask: { kind: 'permission', tool: 'Bash', detail: 'Bash: SECRET-CMD', question: 'SECRET-QUESTION?' }, error: { message: 'SECRET-ERROR' } };
  assert.equal(p.onState(sum({ state: 'waiting', ...secret }), 'working'), 'need');
  const r = await p.flush('dev-1');
  assert.equal(r.sent, true);
  assert.equal(sent.length, 1);
  const h = sent[0].headers;
  assert.match(h.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
  assert.equal(JSON.parse(unb64u(h.Authorization.split('t=')[1].split('.')[1])).aud, 'https://web.push.apple.com');
  assert.equal(h['Content-Encoding'], 'aes128gcm');
  assert.equal(h['Content-Type'], 'application/octet-stream');
  assert.ok(Number(h.TTL) > 0);
  assert.equal(h.Urgency, 'high');
  const raw = sent[0].body.toString('latin1');
  assert.ok(!/SECRET|alpha/.test(raw), '본문은 암호문이다');
  const msg = f.open(sent[0].body);
  assert.deepEqual(Object.keys(msg).sort(), ['at', 'body', 'kind', 'n', 'sessionId', 'tag', 'title', 'v']);
  assert.equal(msg.title, '@alpha · 응답 필요');
  assert.equal(msg.body, 'repo-one');
  assert.equal(msg.sessionId, 's1');
  assert.ok(!JSON.stringify(msg).includes('SECRET'), '질문·요청·답·오류 글이 없다');
  assert.ok(!JSON.stringify(notes).includes('SECRET'), '연결 기록에도 없다');
  assert.ok(!JSON.stringify(notes).includes('alpha'), '연결 기록에 알림 내용(세션 이름)도 남기지 않는다');
  assert.ok(p.status('dev-1').lastSentAt);
});

test('묶기와 30초에 한 번: 같은 세션·같은 종류는 한 번, 여러 세션은 한 알림, 끝남만이면 보통 긴급도', async () => {
  const { p, sent, tick } = rig();
  const f = fakeSub();
  p.subscribe('dev-1', f.sub, 'en');
  // P92: 끝남은 사이클 시계가 넣는다. 세 세션이 함께 쉬면 한 알림
  for (const [id, name] of [['s1', 'a'], ['s2', 'b'], ['s3', 'c']]) { p.onState(sum({ sessionId: id, name, state: 'working' }), 'ready'); p.onState(sum({ sessionId: id, name }), 'working'); }
  tick(SETTLE_MS); p.tickCycles();
  await p.flush('dev-1');
  assert.equal(sent.length, 1);
  const m = f.open(sent[0].body);
  assert.equal(m.title, '3 sessions');
  assert.equal(m.body, '@a done · @b done · @c done');
  assert.equal(sent[0].headers.Urgency, 'normal');
  p.onState(sum({ sessionId: 's1', name: 'a', state: 'waiting' }), 'working');
  p.onState(sum({ sessionId: 's1', name: 'a', state: 'waiting' }), 'working');
  assert.ok(p.decisions.some((d) => d.sessionId === 's1' && d.why === 'cooldown'));
  await p.flush('dev-1');
  assert.equal(sent.length, 2);
  tick(COOLDOWN_MS - 1000);
  p.onState(sum({ sessionId: 's1', name: 'a', state: 'waiting' }), 'working');
  assert.equal(await p.flush('dev-1'), null, '30초 안이라 묶음이 비었다');
  tick(2000);
  p.onState(sum({ sessionId: 's1', name: 'a', state: 'error' }), 'working'); // 다른 종류는 따로 센다
  p.onState(sum({ sessionId: 's1', name: 'a', state: 'waiting' }), 'working');
  await p.flush('dev-1');
  assert.equal(sent.length, 3);
  assert.equal(f.open(sent[2].body).title, '@a · needs you', '같은 세션은 마지막 것');
});

test('보는 중이면, PC 사용 중이면(기본), 종류를 껐으면, 원격 접속을 막았으면 보내지 않는다. PC 사용 중에도 받기를 켜면 보낸다', async () => {
  const { p, sent, state, tick } = rig();
  p.subscribe('dev-1', fakeSub().sub, 'ko');
  const go = async (o = {}, from = 'working') => { // P92: 끝남(working → ready)은 사이클 끝까지 기다린다
    tick(COOLDOWN_MS + 1);
    if ((o.state || 'ready') === 'ready' && from === 'working') endTurn(p, o, tick); else p.onState(sum(o), from);
    return p.flush('dev-1');
  };
  state.watching = true;
  assert.equal((await go()).why, 'watching');
  state.watching = false; state.pc = true;
  assert.equal((await go()).why, 'pc_active');
  assert.equal(p.status('dev-1').whilePc, false, '기본은 PC 사용 중에는 보내지 않음');
  p.setPrefs('dev-1', { whilePc: true });
  assert.equal((await go()).sent, true);
  state.pc = false;
  p.setPrefs('dev-1', { kinds: { done: false } });
  assert.equal(await go(), null, '끝남을 껐다');
  assert.ok(p.decisions.some((d) => d.why === 'kind_off'));
  assert.deepEqual(p.status('dev-1').kinds, { done: false, need: true, error: true });
  assert.equal((await go({ state: 'error' })).sent, true, '오류는 켜져 있다');
  p.setPrefs('dev-1', { kinds: { error: false } });
  assert.equal(await go({ state: 'exited', exit: { kind: 'other' } }), null, '예기치 않은 끝남은 오류 설정을 따른다');
  assert.equal(await go({ kind: 'shell', state: 'ready' }), null, '셸');
  state.enabled = false;
  assert.equal((await go({ state: 'waiting' })).why, 'blocked');
  assert.equal(sent.length, 2);
});

test('푸시 서비스가 404·410이면 구독을 지우고, 500이면 실패만 남긴다(구독은 둔다). 시험 알림', async () => {
  for (const code of [404, 410]) {
    const { p, state, notes } = rig();
    p.subscribe('dev-1', fakeSub().sub, 'ko');
    state.status = code;
    p.onState(sum({ state: 'waiting' }), 'working');
    const r = await p.flush('dev-1');
    assert.equal(r.reason, `gone_${code}`);
    assert.deepEqual({ on: p.status('dev-1').on, gone: p.status('dev-1').gone }, { on: false, gone: true });
    assert.ok(notes.some((n) => n.ev === 'push.off' && n.reason === `gone_${code}`));
    await assert.rejects(p.test('dev-1'), /off/);
  }
  const { p, state, notes, sent } = rig();
  const f = fakeSub();
  p.subscribe('dev-1', f.sub, 'ko');
  state.status = 500;
  const r = await p.test('dev-1');
  assert.deepEqual(r, { ok: false, reason: 'http_500', status: 500 });
  assert.equal(p.status('dev-1').on, true);
  assert.equal(p.status('dev-1').lastFail.reason, 'http_500');
  assert.ok(notes.some((n) => n.ev === 'push.fail' && n.reason === 'http_500'));
  state.status = 201;
  assert.equal((await p.test('dev-1')).ok, true);
  assert.equal(f.open(sent.at(-1).body).title, 'Atrium 시험 알림');
  assert.equal(p.status('dev-1').lastFail, null);
});

test('구독 받기: 허용하지 않은 endpoint와 틀린 키는 거부한다', () => {
  const { p, notes } = rig();
  assert.throws(() => p.subscribe('dev-1', fakeSub('https://169.254.169.254/latest').sub, 'ko'), (e) => e.code === 'bad_endpoint');
  assert.throws(() => p.subscribe('dev-1', fakeSub('https://internal.example/x').sub, 'ko'), (e) => e.code === 'bad_endpoint');
  assert.ok(notes.some((n) => n.ev === 'push.fail' && n.reason === 'endpoint_host'));
  assert.throws(() => p.subscribe('dev-1', { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: b64u(Buffer.alloc(65, 4)), auth: b64u(crypto.randomBytes(16)) } }, 'ko'), (e) => e.code === 'bad_keys');
  assert.equal(p.status('dev-1').on, false);
});

test('연결 기록: push.on은 푸시 서비스 이름만, push.fail은 되풀이를 합친다', () => {
  const e = logEntry('push.on', { deviceId: 'd1', host: 'web.push.apple.com', title: '@alpha · 끝남', endpoint: 'https://web.push.apple.com/secret-token' });
  assert.deepEqual(e, { at: e.at, event: 'push.on', deviceId: 'd1', host: 'web.push.apple.com' });
  assert.equal(logEntry('push.on', { host: 'https://x/y' }).host, undefined);
  const log = new RemoteLog();
  log.add('push.fail', { deviceId: 'd1', reason: 'http_500' }); log.add('push.fail', { deviceId: 'd1', reason: 'http_500' });
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].count, 2);
  assert.equal(pushTestLine({ id: 'abcdef123456', name: 'iPhone', ok: true }), '[ok]   iPhone (abcdef12): 시험 알림을 보냈습니다');
  assert.match(pushTestLine({ id: 'abcdef123456', name: 'iPhone', ok: false, reason: 'gone_410' }), /다시 켜세요/);
});

// ---------- WebServer: 짝 풀기·원격 막기, 기기만 부르는 처리기, PC 목록 ----------
function server(t = { transport: null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p88-'));
  const store = new Store(path.join(dir, 'board.db'));
  const tailscale = { status: () => null, hosts: () => [], selfLogin: () => null, on: () => {}, off: () => {}, stop: () => {} };
  const st = { remoteAccess: true };
  const sent = [];
  const web = new WebServer({ cfg: { remoteEnabled: true, port: 1, dataDir: dir, profile: 'dev', herdrSession: 'atrium-dev-test' }, store, api: null, tailscale, settings: () => st, pushTransport: async (endpoint, o) => { sent.push({ endpoint, ...o }); return { status: 201 }; } });
  return { web, store, st, sent, dir, done: () => { web.stop(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const conn = (d) => ({ auth: { kind: 'device', device: { id: d.id, name: d.name } } });

test('WebServer: 기기만 구독하고, PC 목록에 알림 켜짐과 마지막으로 보낸 때. VAPID 키 파일은 데이터 폴더에', async () => {
  const s = server();
  try {
    const d = s.web.devices.add({ name: 'iPhone', via: 'code', userAgent: 'x', passkey: null, extra: { pairOnly: true, origin: 'local' } });
    const h = s.web.handlers();
    await assert.rejects(async () => h['push.subscribe']({ subscription: fakeSub().sub }, { auth: { kind: 'local' } }), /paired browser/);
    const { publicKey } = h['push.key']({}, conn(d));
    assert.equal(unb64u(publicKey).length, 65);
    assert.ok(fs.existsSync(path.join(s.dir, 'vapid.json')));
    const f = fakeSub();
    assert.equal(h['push.subscribe']({ subscription: f.sub, lang: 'ko' }, conn(d)).on, true);
    assert.deepEqual(s.web.devicesView().find((x) => x.id === d.id).push, { on: true, lastSentAt: null, lastFail: null });
    const r = await h['push.test']({}, { auth: { kind: 'local' } });
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].ok, true);
    assert.equal(f.open(s.sent[0].body).kind, 'test');
    assert.ok(s.web.devicesView().find((x) => x.id === d.id).push.lastSentAt);
    assert.equal((await h['push.test']({ device: 'nope' }, { auth: { kind: 'local' } })).results.length, 0);
    // 보는 중: 기기 연결이 열려 있고 보이는 상태
    const c = conn(d); s.web.api = { clients: new Set([c]) };
    assert.equal(s.web.push.watching(d.id), true, '보이는지 알리지 않았으면 보는 것으로');
    h['push.visible']({ visible: false }, c);
    assert.equal(s.web.push.watching(d.id), false);
    h['push.visible']({ visible: true }, c);
    assert.equal(s.web.push.watching(d.id), true);
    // PC 사용 중: 이 PC의 창(desktop)에 최근 입력
    const pc = { auth: { kind: 'local' }, kind: 'desktop', lastInputAt: Date.now() };
    s.web.api.clients.add(pc);
    assert.equal(s.web.push.pcActive(), true);
    pc.lastInputAt = Date.now() - 10 * 60_000;
    assert.equal(s.web.push.pcActive(), false);
    s.web.api = null;
    assert.equal(h['push.unsubscribe']({}, conn(d)).on, false);
    assert.ok(s.web.remoteLog.list({ limit: 10 }).some((e) => e.event === 'push.off' && e.reason === 'user'));
  } finally { s.done(); }
});

test('WebServer: 짝을 풀면 구독 기록째, 원격 접속을 막으면 구독을 지운다', () => {
  const s = server();
  try {
    const a = s.web.devices.add({ name: 'A', via: 'code', userAgent: 'x', passkey: null, extra: { pairOnly: true, origin: 'local' } });
    const b = s.web.devices.add({ name: 'B', via: 'code', userAgent: 'x', passkey: null, extra: { pairOnly: true, origin: 'local' } });
    const h = s.web.handlers();
    h['push.subscribe']({ subscription: fakeSub().sub }, conn(a));
    h['push.subscribe']({ subscription: fakeSub().sub }, conn(b));
    h['push.prefs']({ whilePc: true }, conn(b));
    assert.equal(s.web.revoke(a.id), true);
    assert.equal(s.web.push.rec(a.id), null, '짝 풀기: 기록째');
    assert.ok(s.web.remoteLog.list({ limit: 20 }).some((e) => e.event === 'push.off' && e.reason === 'unpair' && e.deviceId === a.id));
    s.st.remoteAccess = false; s.web.accessChanged(false);
    assert.equal(s.web.push.status(b.id).on, false, '원격 막기: 구독을 지운다');
    assert.equal(s.web.push.status(b.id).whilePc, true, '설정은 남는다');
    assert.ok(s.web.remoteLog.list({ limit: 20 }).some((e) => e.event === 'push.off' && e.reason === 'blocked'));
  } finally { s.done(); }
});
