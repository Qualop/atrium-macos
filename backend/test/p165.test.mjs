// P165: 음성 입력 중계(voice.mjs)와 판 API 웹소켓의 바이너리 프레임(api.mjs). 바깥 Soniox 대신 이 PC의 가짜 서버로 시험한다
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { VoiceRelay, sonioxTokens, sonioxConfig, makeKeyReader, SONIOX_MODEL } from '../src/voice.mjs';
import { ApiServer } from '../src/api.mjs';

const KEY = 'test-key-0123456789abcdef';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(10); } throw new Error(`timeout: ${fn}`); }

// 가짜 Soniox: 연결 머리·시작 글·소리 프레임을 적고, 빈 글이면 남은 확정 글과 finished를 보낸다
async function fakeSoniox({ onStart } = {}) {
  const seen = { conns: [], auth: [], configs: [], audio: 0, frames: 0, ends: 0, closed: 0 };
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws, req) => {
    seen.conns.push(ws); seen.auth.push(req.headers.authorization);
    ws.on('message', (d, bin) => {
      if (bin) { seen.frames++; seen.audio += d.length; return; }
      const s = String(d);
      if (s === '') { seen.ends++; ws.send(JSON.stringify({ tokens: [{ text: ' 끝', is_final: true }, { text: '<fin>', is_final: true }], final_audio_proc_ms: 1, total_audio_proc_ms: 1 })); ws.send(JSON.stringify({ tokens: [], finished: true })); setTimeout(() => ws.close(), 5); return; }
      const m = JSON.parse(s);
      if (m.type) return;
      seen.configs.push(m);
      if (onStart) onStart(ws);
    });
    ws.on('close', () => { seen.closed++; });
  });
  await new Promise((r) => wss.on('listening', r));
  return { url: `ws://127.0.0.1:${wss.address().port}`, seen, close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(r); }) };
}
function fakeClient(extra = {}) { const events = []; return { kind: 'desktop', events, sendEvent: (e, d) => events.push({ e, d }), ...extra }; }

test('sonioxTokens: 확정·미확정 글을 나누고 <end>·<fin> 표시를 뺀다, 오류와 finished', () => {
  assert.deepEqual(sonioxTokens({ tokens: [{ text: '안녕', is_final: true }, { text: '하세요', is_final: false }, { text: '<end>', is_final: true }] }), { final: '안녕', interim: '하세요', finished: false, error: null });
  assert.equal(sonioxTokens({ tokens: [], finished: true }).finished, true);
  assert.deepEqual(sonioxTokens({ tokens: [], error_code: 401, error_type: 'unauthenticated', error_message: 'x' }).error, { code: 401, type: 'unauthenticated' });
  assert.deepEqual(sonioxTokens(null), { final: '', interim: '', finished: false, error: null });
});

test('sonioxConfig: 실시간 모델, 16kHz PCM 한 채널, 한국어·영어 힌트, 끝점 감지. 키는 시작 글에 넣지 않는다', () => {
  const c = sonioxConfig();
  assert.equal(c.model, SONIOX_MODEL);
  assert.equal(SONIOX_MODEL, 'stt-rt-v6');
  assert.deepEqual([c.audio_format, c.sample_rate, c.num_channels], ['pcm_s16le', 16000, 1]);
  assert.deepEqual(c.language_hints, ['ko', 'en']);
  assert.equal(c.enable_endpoint_detection, true);
  assert.equal('api_key' in c, false);
});

test('makeKeyReader: 환경 변수 먼저, 없으면 사용자 환경 변수(레지스트리), 둘 다 없으면 null', async () => {
  assert.equal(await makeKeyReader({ env: { SONIOX_API_KEY: ' a ' }, registry: async () => 'b' })(), 'a');
  assert.equal(await makeKeyReader({ env: {}, registry: async () => 'b' })(), 'b');
  assert.equal(await makeKeyReader({ env: {}, registry: async () => null })(), null);
  assert.equal(await makeKeyReader({ env: {}, registry: async () => { throw new Error('x'); } })(), null);
});

test('키가 없으면 voice_no_key로 거절하고 바깥에 붙지 않는다', async () => {
  let tried = 0;
  const v = new VoiceRelay({ getKey: async () => null, connect: () => { tried++; throw new Error('no'); } });
  await assert.rejects(v.start({}, fakeClient()), (e) => e.code === 'voice_no_key' && /SONIOX_API_KEY/.test(e.message));
  assert.equal(tried, 0);
});

test('녹음 한 번: 키는 연결 머리로만, 소리 프레임을 넘기고 글 토막을 이벤트로, 멈추면 남은 확정 글과 끝', async () => {
  const srv = await fakeSoniox({ onStart: (ws) => { ws.send(JSON.stringify({ tokens: [{ text: '안녕', is_final: false }] })); ws.send(JSON.stringify({ tokens: [{ text: '안녕', is_final: true }, { text: ' 하세', is_final: false }] })); } });
  const logs = [];
  const v = new VoiceRelay({ getKey: async () => KEY, url: srv.url, log: (m) => logs.push(m) });
  const c = fakeClient();
  const r = await v.start({}, c);
  assert.equal(r.sampleRate, 16000);
  assert.ok(r.id);
  assert.equal(JSON.stringify(r).includes(KEY), false);
  await until(() => srv.seen.configs.length);
  assert.equal(srv.seen.auth[0], `Bearer ${KEY}`);
  assert.equal(JSON.stringify(srv.seen.configs[0]).includes(KEY), false);
  assert.equal(v.onBinary(c, Buffer.alloc(3200)), true);
  assert.equal(v.onBinary(c, Buffer.alloc(0)), false);
  assert.equal(v.onBinary(c, Buffer.alloc(v.maxFrame + 1)), false, '너무 큰 프레임은 버린다');
  assert.equal(v.onBinary(fakeClient(), Buffer.alloc(10)), false, '녹음이 없는 클라이언트의 소리는 버린다');
  await until(() => srv.seen.frames === 1);
  await until(() => c.events.filter((x) => x.e === 'voice.text').length >= 2);
  const texts = c.events.filter((x) => x.e === 'voice.text').map((x) => x.d);
  assert.deepEqual(texts[0], { id: r.id, final: '', interim: '안녕' });
  assert.deepEqual(texts[1], { id: r.id, final: '안녕', interim: ' 하세' });
  assert.deepEqual(v.stop({ id: r.id }, c), { ok: true });
  assert.equal(v.onBinary(c, Buffer.alloc(10)), false, '멈추는 중에는 소리를 받지 않는다');
  await until(() => c.events.some((x) => x.e === 'voice.end'));
  assert.equal(srv.seen.ends, 1);
  const last = c.events.filter((x) => x.e === 'voice.text').pop().d;
  assert.deepEqual(last, { id: r.id, final: ' 끝', interim: '' });
  assert.deepEqual(c.events.find((x) => x.e === 'voice.end').d, { id: r.id, reason: 'done' });
  assert.equal(v.streams.size, 0);
  assert.equal(logs.join('\n').includes(KEY), false, '로그에 키가 없다');
  assert.equal(logs.join('\n').includes('안녕'), false, '로그에 전사 글이 없다');
  await srv.close();
});

test('동시 상한: 판 전체 maxStreams, 한 클라이언트는 하나(다시 시작하면 옛 것을 닫는다)', async () => {
  const srv = await fakeSoniox();
  const v = new VoiceRelay({ getKey: async () => KEY, url: srv.url, maxStreams: 2 });
  const a = fakeClient(), b = fakeClient(), c = fakeClient();
  const ra = await v.start({}, a);
  await v.start({}, b);
  await assert.rejects(v.start({}, c), (e) => e.code === 'voice_busy');
  const ra2 = await v.start({}, a);
  assert.notEqual(ra2.id, ra.id);
  assert.equal(v.streams.size, 2);
  assert.ok(a.events.some((x) => x.e === 'voice.end' && x.d.id === ra.id));
  v.closeAll();
  await until(() => srv.seen.closed === 3);
  await srv.close();
});

test('길이 상한: maxMs가 지나면 멈추고 limit으로 끝', async () => {
  const srv = await fakeSoniox();
  const v = new VoiceRelay({ getKey: async () => KEY, url: srv.url, maxMs: 80 });
  const c = fakeClient();
  await v.start({}, c);
  await until(() => c.events.some((x) => x.e === 'voice.end'));
  assert.equal(c.events.find((x) => x.e === 'voice.end').d.reason, 'limit');
  assert.equal(srv.seen.ends, 1);
  await srv.close();
});

test('끊김 정리: 클라이언트가 끊기면 바깥 연결을 닫고, 바깥이 끊기면 dropped, 바깥 오류는 error 종류만', async () => {
  const srv = await fakeSoniox();
  const logs = [];
  const v = new VoiceRelay({ getKey: async () => KEY, url: srv.url, log: (m) => logs.push(m) });
  const a = fakeClient();
  await v.start({}, a);
  v.dropClient(a);
  assert.equal(v.streams.size, 0);
  await until(() => srv.seen.closed === 1);
  assert.equal(a.events.length, 0, '끊긴 클라이언트에는 보내지 않는다');

  const b = fakeClient();
  await v.start({}, b);
  await until(() => srv.seen.conns.length === 2);
  srv.seen.conns[1].terminate();
  await until(() => b.events.some((x) => x.e === 'voice.end'));
  assert.equal(b.events.find((x) => x.e === 'voice.end').d.reason, 'dropped');

  const c = fakeClient();
  const n0 = srv.seen.configs.length;
  await v.start({}, c);
  await until(() => srv.seen.conns.length === 3 && srv.seen.configs.length === n0 + 1);
  srv.seen.conns[2].send(JSON.stringify({ tokens: [], error_code: 401, error_type: 'unauthenticated', error_message: `bad key ${KEY}` }));
  await until(() => c.events.some((x) => x.e === 'voice.end'));
  assert.deepEqual(c.events.find((x) => x.e === 'voice.end').d, { id: c.events.find((x) => x.e === 'voice.end').d.id, reason: 'error', error: 'unauthenticated' });
  assert.equal(JSON.stringify(c.events).includes(KEY), false, '바깥 오류 글(키가 섞일 수 있다)은 창에 넘기지 않는다');
  assert.equal(logs.join('\n').includes(KEY), false);
  assert.equal(v.streams.size, 0);
  await srv.close();
});

test('바깥에 못 붙으면 voice_failed, 녹음 자리를 남기지 않는다', async () => {
  const v = new VoiceRelay({ getKey: async () => KEY, url: 'ws://127.0.0.1:1', openTimeoutMs: 1500 });
  await assert.rejects(v.start({}, fakeClient()), (e) => e.code === 'voice_failed');
  assert.equal(v.streams.size, 0);
});

test('판 API 웹소켓: 인증된 연결만, 바이너리 프레임은 그 연결의 녹음으로, 응답에 키가 없다', async () => {
  const srv = await fakeSoniox();
  const voice = new VoiceRelay({ getKey: async () => KEY, url: srv.url });
  // 원격 기기처럼 붙은 연결(세션 쿠키 대신 시험 값)도 같은 길이다. 인증은 ApiServer.authorize 그대로
  const api = new ApiServer({ token: 'tok', handlers: { ...voice.handlers }, authorize: (req) => { const u = new URL(req.url, 'http://x'); const k = u.searchParams.get('k'); return k === 'tok' ? { kind: 'local' } : k === 'dev' ? { kind: 'device', device: { id: 'd1', name: 'phone' }, remote: true } : null; }, onBinary: (c, d) => voice.onBinary(c, d), onClose: (c) => voice.dropClient(c) });
  const server = http.createServer();
  server.on('upgrade', (req, sock, head) => api.handleUpgrade(req, sock, head));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  // 인증 없는 연결은 막힌다
  const bad = new WebSocket(`ws://127.0.0.1:${port}/api`);
  const badErr = await new Promise((r) => { bad.on('unexpected-response', (_q, res) => r(res.statusCode)); bad.on('error', () => r('error')); });
  assert.equal(badErr, 401);
  for (const k of ['tok', 'dev']) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api?k=${k}`);
    await new Promise((r) => ws.on('open', r));
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    ws.send(Buffer.alloc(100)); // 녹음 전 소리는 버린다
    ws.send(JSON.stringify({ id: 1, method: 'voice.start', params: {} }));
    const res = await until(() => msgs.find((m) => m.id === 1));
    assert.ok(res.result && res.result.id);
    const before = srv.seen.frames;
    ws.send(Buffer.alloc(3200));
    await until(() => srv.seen.frames === before + 1);
    ws.send(JSON.stringify({ id: 2, method: 'voice.stop', params: { id: res.result.id } }));
    await until(() => msgs.find((m) => m.event === 'voice.end'));
    assert.equal(JSON.stringify(msgs).includes(KEY), false);
    assert.ok(msgs.some((m) => m.event === 'voice.text' && m.data.final === ' 끝'));
    ws.close();
  }
  // 녹음 중 연결이 끊기면 정리된다
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api?k=dev`);
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ id: 1, method: 'voice.start', params: {} }));
  await until(() => voice.streams.size === 1);
  ws.terminate();
  await until(() => voice.streams.size === 0);
  api.close();
  await new Promise((r) => server.close(r));
  await srv.close();
});
