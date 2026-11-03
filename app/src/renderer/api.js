// 판 API 클라이언트(창 쪽). 백엔드 WebSocket(ws://127.0.0.1:<포트>/api?token=…)에 붙는다(ARCH 6절).
// 요청 {id, method, params} → 응답 {id, result | error}. 백엔드가 먼저 보내는 것은 {event, data}다.
// 끊기면 1초 뒤 다시 붙는다. 그때 main 프로세스가 백엔드가 없으면 다시 띄운다(ARCH 1절 백엔드 수명).
import { perfLog } from './perf.js';
import { pendingRequest } from '../../../backend/src/requests.mjs';

export class Api {
  constructor({ connectTimeoutMs = 10000 } = {}) {
    this.connectTimeoutMs = connectTimeoutMs;
    this.generation = 0;
    this.n = 0;
    this.wait = new Map();
    this.listeners = new Map(); // event → Set(fn)
    this.status = 'connecting';
    this.info = null;
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }
  emit(event, data) { const s = this.listeners.get(event); if (s) for (const fn of [...s]) { try { fn(data); } catch (e) { console.error(e); } } }

  setStatus(s, detail) { this.status = s; perfLog('ws', { status: s }); this.emit('$status', { status: s, detail }); }

  async connect() {
    const generation = ++this.generation;
    clearTimeout(this.retryTimer); clearTimeout(this.connectTimer);
    const old = this.ws; this.ws = null;
    for (const w of this.wait.values()) w.rej(Object.assign(new Error('reconnecting'), { code: 'disconnected' }));
    old?.close();
    if (old) this.emit('$close');
    this.setStatus('connecting');
    let info;
    try { info = await window.mt.backend(); } catch (e) { if (generation !== this.generation) return; this.setStatus('error', String(e && e.message || e)); return this.retry(); }
    if (generation !== this.generation) return;
    this.info = info;
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}/api?token=${info.token}`);
    this.ws = ws;
    this.connectTimer = setTimeout(() => { if (this.ws === ws && ws.readyState !== WebSocket.OPEN) ws.close(); }, this.connectTimeoutMs);
    ws.onopen = async () => {
      if (this.ws !== ws) return;
      clearTimeout(this.connectTimer);
      this.setStatus('open');
      try { const r = await this.call('events.subscribe'); if (this.ws === ws) this.emit('$open', r); }
      catch (e) { if (this.ws === ws) { console.error(e); ws.close(); } }
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.event) return this.emit(m.event, m.data);
      const w = this.wait.get(m.id); if (!w) return; this.wait.delete(m.id);
      if (m.error) w.rej(Object.assign(new Error(m.error.message), { code: m.error.code, key: m.error.key, vars: m.error.vars })); else w.res(m.result); // key·vars: 화면 글 열쇠(P16, lib/i18n.js errText)
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearTimeout(this.connectTimer);
      for (const w of this.wait.values()) w.rej(Object.assign(new Error('disconnected'), { code: 'disconnected' }));
      this.wait.clear();
      if (this.ws === ws) { this.setStatus('closed'); this.emit('$close'); this.retry(); }
    };
  }
  retry() { clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => this.connect(), 1000); }

  close() {
    this.generation++; clearTimeout(this.retryTimer); clearTimeout(this.connectTimer);
    const ws = this.ws; this.ws = null;
    for (const w of this.wait.values()) w.rej(Object.assign(new Error('disconnected'), { code: 'disconnected' }));
    ws?.close(); this.setStatus('closed'); this.emit('$close');
  }

  call(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(Object.assign(new Error('not connected to the backend'), { code: 'disconnected' }));
    const id = ++this.n;
    return pendingRequest(this.wait, id, () => this.ws.send(JSON.stringify({ id, method, params })), { method });
  }
}

export const api = new Api();
