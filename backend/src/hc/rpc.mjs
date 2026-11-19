// P114: herdr-core(hc) API 클라이언트. 터미널 백엔드 호출은 어댑터 안에만 둔다(ARCH 1절 3번).
// - 통로: Windows 이름 있는 파이프 `\\.\pipe\herdr-core-<USERNAME의 영숫자>-<세션>.sock`(hc platform/windows.rs endpoints)
// - plain: 한 줄 JSON-RPC 2.0. 요청 하나마다 연결 하나(hcCall), 구독은 연결 하나를 열어 둔다(hcSubscribe)
// - 프레임: `hello {framed: true}` 응답(한 줄) 뒤부터 [channel u32 LE][kind u8][len u32 LE][payload]. 채널 0은 JSON-RPC, 나머지는 attach 스트림
// - 첫 프레임 모으기: attach 응답과 그 스트림의 첫 화면이 한 덩어리로 오면, 응답으로 채널 번호를 알기 전에 스트림 프레임이 먼저 처리된다.
//   주인이 아직 없는 채널의 프레임은 모아 두었다가 claim할 때 넘긴다(P114 1단계에서 첫 화면을 버린 실수)
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

// hc 오류 종류(data.kind) → 판이 쓰는 오류 코드. 전달 대기열(delivery.mjs REFUSED)이 이 코드를 본다
export const CODE_OF_KIND = {
  blocked: 'agent_blocked', // 막힌 프로그램에 치면 대화상자에 답하게 된다(force 없이는 거부)
  not_found: 'agent_not_found',
  unavailable: 'agent_not_ready', // lost 뒤 새 셸을 기다리는 중, spawn_pending
  name_taken: 'name_taken', refused: 'refused', spawn_failed: 'spawn_failed', usage: 'bad_request', conflict: 'conflict', config: 'config',
};

export class HcError extends Error {
  constructor(code, message, method, data = null) {
    super(`${method || 'hc'}: ${code}: ${message}`);
    this.code = code;
    this.detail = message; // 판은 터미널 오류의 글을 e.detail로 읽는다
    this.method = method;
    this.kind = (data && data.kind) || null;
    this.hint = (data && data.hint) || null;
  }
}
export function rpcError(method, err) {
  const kind = err && err.data && err.data.kind;
  return new HcError(CODE_OF_KIND[kind] || kind || 'error', (err && err.message) || 'error', method, err && err.data);
}

// hc가 쓰는 파이프 이름. USERNAME의 ASCII 영숫자만 남긴다(hc와 같은 규칙)
// macOS: 판이 코어와 CLI에 HC_SOCKET으로 주는 Unix 소켓(core.mjs hcSocketFor). 그 값이 env에 있으면 그것
export function hcPipe(session, env = process.env, { root = null } = {}) {
  if (process.platform !== 'win32') return env.HC_SOCKET || (root ? hcSocketFor(root, session) : null);
  const user = String(env.USERNAME || '').replace(/[^A-Za-z0-9]/g, '');
  return `\\\\.\\pipe\\herdr-core-${user}-${session}.sock`;
}
// macOS 소켓 자리: <판 데이터 폴더>/hc/run/<세션>.sock. Unix 소켓 경로는 104바이트를 넘지 못한다. 길면 /tmp 아래 사용자 폴더(0700)에 해시 이름으로 둔다
export function hcSocketFor(root, session) {
  const p = path.join(root, 'run', `${session}.sock`);
  if (Buffer.byteLength(p) <= 100) return p;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'u';
  return path.join('/tmp', `atrium-hc-${uid}`, `${crypto.createHash('sha256').update(`${root}\0${session}`).digest('hex').slice(0, 16)}.sock`);
}

let nextId = 1;
// 요청 하나: 연결, 한 줄 보내기, 응답 한 줄 받기, 닫기
export function hcCall(pipe, method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    let buf = '';
    let done = false;
    const sock = net.connect(pipe);
    const finish = (fn) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch {} fn(); };
    const timer = setTimeout(() => finish(() => reject(new HcError('timeout', `no response in ${timeoutMs}ms`, method))), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'));
    sock.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      let m;
      try { m = JSON.parse(buf.slice(0, i)); } catch { return finish(() => reject(new HcError('bad_response', buf.slice(0, 200), method))); }
      finish(() => (m.error ? reject(rpcError(method, m.error)) : resolve(m.result)));
    });
    sock.on('error', (e) => finish(() => reject(new HcError('unreachable', e.code || e.message, method))));
    sock.on('close', () => finish(() => reject(new HcError('no_response', 'connection closed without response', method))));
  });
}

// 이벤트 구독(plain). 응답은 스냅숏(seq, terminals), 그 뒤 줄마다 알림(event, heartbeat, missed)
// → { ready: Promise<스냅숏>, sock, close() }. 연결이 끊기면 onClose()
export function hcSubscribe(pipe, params, { onMessage, onClose = () => {} }) {
  const sock = net.connect(pipe);
  sock.setEncoding('utf8');
  let buf = '';
  let acked = false;
  const ready = new Promise((resolve, reject) => {
    sock.on('connect', () => sock.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'events.subscribe', params: params || {} }) + '\n'));
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (!acked && m.id === 1) { acked = true; if (m.error) { reject(rpcError('events.subscribe', m.error)); sock.destroy(); } else resolve(m.result); continue; }
        onMessage(m);
      }
    });
    sock.on('error', (e) => { if (!acked) reject(new HcError('unreachable', e.code || e.message, 'events.subscribe')); });
    sock.on('close', () => { if (!acked) reject(new HcError('closed', 'subscription closed before ack', 'events.subscribe')); else onClose(); });
  });
  return { ready, sock, close: () => { try { sock.destroy(); } catch {} } };
}

// ---------- 프레임 ----------
export const FRAME = { DATA: 0, CREDIT: 1, CLOSE: 2, RESIZE: 3, FOCUS: 4, FACTS: 5, AUTOMATIC_INPUT: 6 };
export const FRAME_HEADER = 9;
export function encodeFrame(ch, kind, payload = Buffer.alloc(0)) {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const h = Buffer.alloc(FRAME_HEADER);
  h.writeUInt32LE(ch, 0); h.writeUInt8(kind, 4); h.writeUInt32LE(p.length, 5);
  return Buffer.concat([h, p]);
}
export const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
export const sizePayload = (cols, rows) => { const b = Buffer.alloc(4); b.writeUInt16LE(cols, 0); b.writeUInt16LE(rows, 2); return b; };

// 바이트 덩어리 → 프레임들. 조각난 프레임은 다음 덩어리를 기다린다(순수, 단위 시험)
export class FrameDecoder {
  constructor() { this.buf = Buffer.alloc(0); }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out = [];
    while (this.buf.length >= FRAME_HEADER) {
      const len = this.buf.readUInt32LE(5);
      if (this.buf.length < FRAME_HEADER + len) break;
      out.push({ ch: this.buf.readUInt32LE(0), kind: this.buf.readUInt8(4), payload: Buffer.from(this.buf.subarray(FRAME_HEADER, FRAME_HEADER + len)) });
      this.buf = this.buf.subarray(FRAME_HEADER + len);
    }
    return out;
  }
}

// 프레임 연결 하나. 채널 0 요청(call), 채널마다 주인(claim), 주인이 없는 채널의 프레임은 모아 둔다
export class FramedConn extends EventEmitter {
  constructor(pipe) {
    super();
    this.pipe = pipe;
    this.sock = null;
    this.pending = new Map(); // id → { resolve, reject, method, timer }
    this.owners = new Map(); // channel → (frame) => void
    this.unclaimed = new Map(); // channel → frames[]
    this.decoder = new FrameDecoder();
    this.framed = false;
    this.line = Buffer.alloc(0);
    this.closed = false;
    this.id = 1;
  }
  async open(timeoutMs = 5000) {
    this.sock = net.connect(this.pipe);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new HcError('timeout', 'connect timeout', 'hello')), timeoutMs);
      this.sock.once('connect', () => { clearTimeout(t); res(); });
      this.sock.once('error', (e) => { clearTimeout(t); rej(new HcError('unreachable', e.code || e.message, 'hello')); });
    });
    this.sock.on('data', (d) => this._data(d));
    this.sock.on('error', (e) => this.emit('error', e));
    this.sock.on('close', () => this._closed());
    // hello는 한 줄로 보내고 한 줄로 받는다. 그 뒤부터 프레임이다
    this.hello = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(0); reject(new HcError('timeout', 'hello timeout', 'hello')); }, timeoutMs);
      this.pending.set(0, { resolve, reject, method: 'hello', timer });
      this.sock.write(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'hello', params: { framed: true, generation: 1 } }) + '\n');
    });
    return this.hello;
  }
  _data(d) {
    if (!this.framed) {
      this.line = this.line.length ? Buffer.concat([this.line, d]) : d;
      const i = this.line.indexOf(0x0a);
      if (i < 0) return;
      const first = this.line.subarray(0, i).toString('utf8');
      const rest = this.line.subarray(i + 1);
      this.framed = true; this.line = Buffer.alloc(0);
      let m = null; try { m = JSON.parse(first); } catch {}
      if (m) this._rpc(m);
      if (rest.length) this._frames(Buffer.from(rest));
      return;
    }
    this._frames(d);
  }
  _frames(d) {
    for (const f of this.decoder.push(d)) {
      if (f.ch === 0) { if (f.kind === FRAME.DATA) { let m = null; try { m = JSON.parse(f.payload.toString('utf8')); } catch {} if (m) this._rpc(m); } continue; }
      const own = this.owners.get(f.ch);
      if (own) own(f);
      else { const q = this.unclaimed.get(f.ch) || []; q.push(f); this.unclaimed.set(f.ch, q); }
    }
  }
  _rpc(m) {
    if (m.id != null && this.pending.has(m.id)) {
      const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer);
      if (m.error) p.reject(rpcError(p.method, m.error)); else p.resolve(m.result);
    } else this.emit('rpc', m);
  }
  _closed() {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new HcError('unreachable', 'connection closed', p.method)); }
    this.pending.clear();
    this.emit('close');
  }
  call(method, params = {}, timeoutMs = 15000) {
    if (this.closed) return Promise.reject(new HcError('unreachable', 'connection closed', method));
    const id = this.id++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new HcError('timeout', `no response in ${timeoutMs}ms`, method)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.write(0, FRAME.DATA, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8'));
    });
  }
  // 채널의 주인이 된다. 그새 모인 프레임을 먼저 넘긴다
  claim(ch, handler) {
    this.owners.set(ch, handler);
    const q = this.unclaimed.get(ch);
    if (q) { this.unclaimed.delete(ch); for (const f of q) handler(f); }
  }
  release(ch) { this.owners.delete(ch); this.unclaimed.delete(ch); }
  write(ch, kind, payload) { if (!this.closed && this.sock && !this.sock.destroyed) this.sock.write(encodeFrame(ch, kind, payload)); }
  close() { try { this.sock && this.sock.destroy(); } catch {} this._closed(); }
}
