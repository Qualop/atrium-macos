// P165: 음성 입력 중계. 창·휴대폰 브라우저가 마이크 소리(16kHz 16비트 PCM 한 채널)를 판 API 웹소켓의 바이너리 프레임으로 보내면
// 백엔드가 Soniox 실시간 전사(WebSocket)로 넘기고, 돌아온 글 토막을 그 클라이언트에게 voice.text 이벤트로 돌려준다.
// - 키는 환경 변수 SONIOX_API_KEY에서 백엔드만 읽는다(없으면 Windows 사용자 환경 변수). 키 값은 창·로그·응답에 내보내지 않는다.
//   Soniox에는 연결 머리(Authorization: Bearer)로 보낸다(시작 글의 api_key는 옛 방식)
// - 인증은 판 API 웹소켓 그대로다(이 PC의 판 API 토큰, 원격은 짝 맺은 기기의 세션 쿠키). 따로 끝점을 열지 않는다
// - 한 클라이언트에 녹음 하나, 판 전체 동시 상한(maxStreams), 한 번 길이 상한(maxMs). 연결이 끊기면 그 녹음을 닫는다
// - 소리와 전사 글은 판에 저장하지 않는다. 로그에는 시작·끝·까닭·길이만 남긴다
import { WebSocket } from 'ws';
import { execFile } from 'node:child_process';

export const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
export const SONIOX_MODEL = 'stt-rt-v6';
export const VOICE_SAMPLE_RATE = 16000;
export const VOICE_MAX_MS = 10 * 60 * 1000;
export const VOICE_MAX_STREAMS = 3;
export const VOICE_MAX_FRAME = 64 * 1024; // 16kHz 16비트 한 채널 2초 = 64KB. 창은 0.1~0.3초씩 보낸다
const OPEN_TIMEOUT_MS = 8000;
const FINISH_WAIT_MS = 3000; // 멈춘 뒤 Soniox의 finished를 기다리는 시간
const KEEPALIVE_MS = 10000; // 소리가 이만큼 끊기면 keepalive(Soniox는 20초 동안 아무것도 없으면 끊는다)

// Soniox 시작 글. 지연이 짧은 쪽: 소리 형식은 그대로 넘기는 PCM(컨테이너 묶음 기다림 없음), 끝점 감지로 말이 끊기면 곧 확정
export function sonioxConfig({ model = SONIOX_MODEL, sampleRate = VOICE_SAMPLE_RATE } = {}) {
  return {
    model,
    audio_format: 'pcm_s16le',
    sample_rate: sampleRate,
    num_channels: 1,
    language_hints: ['ko', 'en'],
    enable_endpoint_detection: true,
  };
}

// Soniox 답 한 개 → { final, interim, finished, error }. final은 이번에 새로 확정된 글, interim은 아직 확정 안 된 글 전체.
// <end>(끝점)·<fin>(손으로 확정) 같은 표시 토큰은 뺀다
export function sonioxTokens(msg) {
  const out = { final: '', interim: '', finished: !!(msg && msg.finished), error: null };
  if (!msg || typeof msg !== 'object') return out;
  if (msg.error_code != null || msg.error_type) out.error = { code: msg.error_code ?? null, type: String(msg.error_type || 'error') };
  for (const tk of Array.isArray(msg.tokens) ? msg.tokens : []) {
    const s = tk && typeof tk.text === 'string' ? tk.text : '';
    if (!s || /^<[a-z_]+>$/i.test(s)) continue;
    if (tk.is_final) out.final += s; else out.interim += s;
  }
  return out;
}

// 키 읽기. 먼저 이 프로세스의 환경, 없으면 Windows 사용자 환경 변수(판이 뜬 뒤 키를 넣은 경우). 값은 돌려주기만 하고 적지 않는다
export function readRegistryKey(name = 'SONIOX_API_KEY') {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((res) => {
    execFile('reg.exe', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return res(null);
      const m = String(stdout || '').match(new RegExp(`^\\s*${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, 'mi'));
      res(m && m[1].trim() ? m[1].trim() : null);
    });
  });
}
export function makeKeyReader({ env = process.env, registry = readRegistryKey } = {}) {
  return async () => {
    const v = env.SONIOX_API_KEY;
    if (v && String(v).trim()) return String(v).trim();
    try { return (await registry('SONIOX_API_KEY')) || null; } catch { return null; }
  };
}

const err = (code, message) => Object.assign(new Error(message), { code });

export class VoiceRelay {
  // getKey: () => 키 | null. connect(url, opts): 바깥 웹소켓(시험은 가짜 서버로 바꾼다)
  constructor({ getKey = makeKeyReader(), connect = (url, opts) => new WebSocket(url, opts), url = SONIOX_URL, model = SONIOX_MODEL, log = () => {}, maxMs = VOICE_MAX_MS, maxStreams = VOICE_MAX_STREAMS, maxFrame = VOICE_MAX_FRAME, finishWaitMs = FINISH_WAIT_MS, openTimeoutMs = OPEN_TIMEOUT_MS, keepaliveMs = KEEPALIVE_MS } = {}) {
    Object.assign(this, { getKey, connect, url, model, log, maxMs, maxStreams, maxFrame, finishWaitMs, openTimeoutMs, keepaliveMs });
    this.streams = new Map(); // client → stream
    this.n = 0;
  }
  get handlers() {
    return {
      'voice.start': (p, c) => this.start(p, c),
      'voice.stop': (p, c) => this.stop(p, c),
    };
  }
  status() { return { streams: this.streams.size, max: this.maxStreams }; }

  async start(_p, client) {
    if (!client) throw err('bad_request', 'no client');
    const old = this.streams.get(client);
    if (old) this.close(old, 'replaced');
    const key = await this.getKey();
    if (!key) throw err('voice_no_key', 'SONIOX_API_KEY is not set');
    if (this.streams.size >= this.maxStreams) throw err('voice_busy', `too many voice streams (max ${this.maxStreams})`);
    const id = `v${++this.n}`;
    const s = { id, client, ws: null, at: Date.now(), lastAudio: Date.now(), frames: 0, bytes: 0, finishing: false, ended: false, timers: [] };
    this.streams.set(client, s);
    let ws;
    try { ws = this.connect(this.url, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: this.openTimeoutMs }); }
    catch (e) { this.streams.delete(client); throw err('voice_failed', 'could not reach the speech service'); }
    s.ws = ws;
    ws.on('message', (raw) => this.onUpstream(s, raw));
    ws.on('close', () => { if (s.opened && !s.ended) this.end(s, s.finishing ? (s.reason || 'done') : 'dropped'); });
    ws.on('error', (e) => { s.wsError = e && e.code ? String(e.code) : 'error'; });
    try {
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(err('voice_failed', 'speech service timed out')), this.openTimeoutMs);
        ws.once('open', () => { clearTimeout(t); res(); });
        ws.once('close', () => { clearTimeout(t); rej(err('voice_failed', 'speech service closed the connection')); });
      });
    } catch (e) {
      s.ended = true; this.streams.delete(client);
      try { ws.terminate ? ws.terminate() : ws.close(); } catch {}
      this.log(`voice ${id} open failed${s.wsError ? ` (${s.wsError})` : ''}`);
      throw e;
    }
    s.opened = true;
    if (s.ended) throw err('voice_failed', 'voice stream ended');
    ws.send(JSON.stringify(sonioxConfig({ model: this.model })));
    s.timers.push(setTimeout(() => this.finish(s, 'limit'), this.maxMs));
    s.timers.push(setInterval(() => { if (!s.finishing && Date.now() - s.lastAudio >= this.keepaliveMs && ws.readyState === 1) ws.send(JSON.stringify({ type: 'keepalive' })); }, Math.max(1000, Math.floor(this.keepaliveMs / 2))));
    this.log(`voice ${id} start (${client.kind || 'client'}${client.remote ? ', remote' : ''}, ${this.streams.size}/${this.maxStreams})`);
    return { id, sampleRate: VOICE_SAMPLE_RATE, maxMs: this.maxMs };
  }

  // 멈춤: 빈 글 프레임으로 소리 끝을 알리고 finished(남은 확정 글)를 기다린다
  stop(p, client) {
    const s = this.streams.get(client);
    if (!s || (p && p.id && p.id !== s.id)) return { ok: false };
    this.finish(s, 'done');
    return { ok: true };
  }
  finish(s, reason) {
    if (s.ended || s.finishing) return;
    s.finishing = true; s.reason = reason;
    try { if (s.ws && s.ws.readyState === 1) s.ws.send(''); } catch {}
    s.timers.push(setTimeout(() => this.end(s, reason), this.finishWaitMs));
  }

  // 바이너리 프레임(소리). 녹음이 없거나 멈추는 중이면 버린다
  onBinary(client, data) {
    const s = this.streams.get(client);
    if (!s || s.finishing || s.ended || !s.ws || s.ws.readyState !== 1) return false;
    const len = data ? (data.byteLength ?? data.length ?? 0) : 0;
    if (!len || len > this.maxFrame) return false;
    s.frames++; s.bytes += len; s.lastAudio = Date.now();
    s.ws.send(data, { binary: true });
    return true;
  }

  onUpstream(s, raw) {
    if (s.ended) return;
    let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
    const r = sonioxTokens(msg);
    if (r.error) { s.upError = r.error; this.end(s, 'error'); return; }
    if (r.final || r.interim !== (s.lastInterim || '')) {
      s.lastInterim = r.interim;
      s.client.sendEvent('voice.text', { id: s.id, final: r.final, interim: r.interim });
    }
    if (r.finished) this.end(s, s.reason || 'done');
  }

  // 끝: 클라이언트에 알리고(끊긴 클라이언트는 빼고) 바깥 연결을 닫는다
  end(s, reason, { notify = true } = {}) {
    if (s.ended) return;
    s.ended = true;
    for (const t of s.timers) { clearTimeout(t); clearInterval(t); }
    if (this.streams.get(s.client) === s) this.streams.delete(s.client);
    try { if (s.ws && s.ws.readyState <= 1) s.ws.close(); } catch {}
    const error = reason === 'error' ? (s.upError ? s.upError.type : 'error') : null;
    if (notify) s.client.sendEvent('voice.end', { id: s.id, reason: reason === 'replaced' ? 'done' : reason, ...(error ? { error } : {}) });
    const sec = ((Date.now() - s.at) / 1000).toFixed(1);
    this.log(`voice ${s.id} end ${reason}${error ? ` (${s.upError && s.upError.code != null ? s.upError.code + ' ' : ''}${error})` : ''} ${sec}s ${Math.round(s.bytes / 1024)}KB`);
  }
  close(s, reason) { this.end(s, reason, { notify: reason !== 'client_closed' }); }
  // 클라이언트 연결이 끊김
  dropClient(client) { const s = this.streams.get(client); if (s) this.close(s, 'client_closed'); }
  closeAll() { for (const s of [...this.streams.values()]) this.close(s, 'client_closed'); }
}
