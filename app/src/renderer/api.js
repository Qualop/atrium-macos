// Desktop and paired-browser API transport. Every socket and pending backend lookup
// belongs to one generation; reconnecting invalidates both before opening another.
import { perfLog } from './perf.js';
import { pendingRequest } from '../../../backend/src/requests.mjs';
import { clientIdOf, clientQuery } from './lib/multiclient.js';
import { connInit, connStep, retryDelay, pingTimedOut, rttLabel, prevCloseParam, PING_EVERY_MS, PING_TIMEOUT_MS } from './lib/reconnect.js'; // P49. P82: prevCloseParam

export const CONNECT_TIMEOUT_MS = 10000;
function loadClientId() {
  let saved = null;
  try { saved = localStorage.getItem('mt.clientId'); } catch {}
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
  const id = clientIdOf(saved, random);
  if (id !== saved) try { localStorage.setItem('mt.clientId', id); } catch {}
  return id;
}
function clientName(info) { try { const n = localStorage.getItem('mt.clientName'); if (n) return n; } catch {} return info.deviceName || null; }
const disconnected = () => Object.assign(new Error('disconnected'), { code: 'disconnected' });
export const BIG_MSG = 8000;

export class Api {
  constructor({ connectTimeoutMs = CONNECT_TIMEOUT_MS } = {}) {
    this.connectTimeoutMs = connectTimeoutMs;
    this.generation = 0; this.n = 0;
    this.wait = new Map(); this.listeners = new Map();
    this.status = 'connecting'; this.info = null; this.ws = null; this.stopped = false;
    this.clientId = loadClientId(); this.conn = connInit();
    this.rtts = []; this.rtt = null; this.pingSentAt = null;
    this.openedAt = null; this.lastClose = null; this.closeLog = [];
    this.onStep = null;
    this.onWake = () => this.wake();
    this.onVisible = () => { if (document.visibilityState === 'visible') this.wake(); };
    globalThis.window?.addEventListener?.('online', this.onWake);
    globalThis.document?.addEventListener?.('visibilitychange', this.onVisible);
  }
  // Compatibility with earlier diagnostics using gen/openTimer.
  get gen() { return this.generation; }
  set gen(n) { this.generation = n; }
  step(ev) { this.conn = connStep(this.conn, ev); this.emit('$conn', this.conn); }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }
  emit(event, data) { for (const fn of [...(this.listeners.get(event) || [])]) { try { fn(data); } catch (e) { console.error(e); } } }
  setStatus(status, detail) { this.status = status; perfLog('ws', { status }); this.emit('$status', { status, detail }); }
  clearTimers() {
    clearTimeout(this.openTimer); clearTimeout(this.retryTimer);
    clearTimeout(this.firstPingTimer); clearTimeout(this.pingDeadline); clearInterval(this.pingTimer);
    this.pingSentAt = null;
  }
  drop(ws) {
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close(); } catch {} }
    for (const w of [...this.wait.values()]) w.rej(disconnected());
    this.wait.clear();
  }
  // P82: 직전 닫힘(브라우저가 본 코드, 깨끗이 닫혔나, 붙어 있던 ms). 다음 연결 주소의 pc 값으로 백엔드에 알린다(연결 기록의 connect). closeLog는 시험이 읽는다
  noteClose({ code, wasClean }) {
    const ms = this.openedAt ? Date.now() - this.openedAt : 0;
    this.openedAt = null;
    this.lastClose = { code, wasClean: !!wasClean, ms };
    this.closeLog.push({ ...this.lastClose, at: Date.now() }); if (this.closeLog.length > 20) this.closeLog.shift();
    perfLog('ws_close', this.lastClose);
  }

  async connect() {
    this.stopped = false;
    const generation = ++this.generation;
    this.clearTimers();
    const old = this.ws; this.ws = null; this.drop(old);
    if (old) this.emit('$close');
    this.setStatus('connecting');
    let info;
    try { info = await window.mt.backend(); }
    catch (e) {
      if (generation !== this.generation) return;
      this.step({ type: 'close', code: e?.code || 'backend', unpaired: e?.code === 'not_paired' });
      this.setStatus('error', String(e?.message || e)); this.retry(); return;
    }
    if (generation !== this.generation) return;
    this.info = info; this.clientName = clientName(info);
    const pc = prevCloseParam(this.lastClose);
    const q = [clientQuery({ clientId: this.clientId, name: this.clientName, kind: info.clientKind || 'desktop' }), pc ? `pc=${encodeURIComponent(pc)}` : ''].filter(Boolean).join('&');
    const base = info.wsUrl || `ws://127.0.0.1:${info.port}/api?token=${encodeURIComponent(info.token)}`;
    let ws;
    try { ws = new WebSocket(q ? `${base}${base.includes('?') ? '&' : '?'}${q}` : base); }
    catch (e) { this.step({ type: 'close', code: 'socket' }); this.setStatus('error', e.message); this.retry(); return; }
    this.ws = ws;
    const live = () => generation === this.generation && this.ws === ws && !this.stopped;
    this.openTimer = setTimeout(() => { if (live() && ws.readyState === 0) this.dead(ws, 'open_timeout'); }, this.connectTimeoutMs);
    ws.onopen = async () => {
      if (!live()) return;
      this.openedAt = Date.now(); this.lastClose = null;
      if (this.onStep) this.onStep('open', { in: this.inB || 0 });
      clearTimeout(this.openTimer); this.step({ type: 'open' }); this.setStatus('open');
      this.pingTimer = setInterval(() => this.ping(), PING_EVERY_MS);
      this.firstPingTimer = setTimeout(() => { if (live()) this.ping(); }, 1000);
      try { const result = await this.call('events.subscribe'); if (live()) this.emit('$open', result); }
      catch (e) { if (live()) { console.error(e); this.dead(ws, 'subscribe'); } }
    };
    ws.onmessage = (ev) => {
      if (!live()) return;
      const size = typeof ev.data === 'string' ? ev.data.length : ev.data.byteLength || 0;
      this.inB = (this.inB || 0) + size; // P84: 받은 양(죽기 전 기록)
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m !== 'object' || Array.isArray(m)) return;
      if (size >= BIG_MSG && this.onStep) this.onStep('msg', { k: typeof m.event === 'string' ? m.event : this.wait.get(m.id)?.m || 'reply', b: size });
      if (typeof m.event === 'string') return this.emit(m.event, m.data);
      const w = this.wait.get(m.id); if (!w) return;
      if (m.error) w.rej(Object.assign(new Error(m.error.message), { code: m.error.code, key: m.error.key, vars: m.error.vars }));
      else w.res(m.result);
    };
    ws.onerror = () => {}; // onclose (or the open deadline) owns reconnection.
    ws.onclose = (ev) => { if (live()) this.dead(ws, ev?.code, ev?.wasClean); };
  }
  dead(ws, code = 'timeout', wasClean = false) {
    if (this.ws !== ws || this.stopped) return;
    this.generation++; this.ws = null; this.clearTimers(); this.drop(ws);
    this.noteClose({ code, wasClean });
    this.step({ type: 'close', code }); this.setStatus('closed'); this.emit('$close');
    // Check /web/me once after revocation so the web adapter returns to pairing.
    if (code === 4401 && globalThis.window?.mt?.web) this.retryTimer = setTimeout(() => this.connect(), 0);
    else this.retry();
  }
  wake() {
    if (this.stopped || this.conn.phase === 'unpaired') return;
    if (this.ws?.readyState === 1) { this.ping(); return; }
    clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => this.connect(), 0);
  }
  ping() {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    if (pingTimedOut(this.pingSentAt, Date.now(), PING_TIMEOUT_MS)) { this.dead(ws); return; }
    if (this.pingSentAt != null) return;
    const generation = this.generation;
    this.pingSentAt = Date.now();
    const t0 = performance.now();
    this.call('ping', { t: t0 }).then(() => {
      if (this.ws !== ws || this.generation !== generation) return;
      const ms = performance.now() - t0;
      this.rtts.push(ms); if (this.rtts.length > 10) this.rtts.shift();
      this.rtt = rttLabel(this.rtts); this.emit('$rtt', { rtt: this.rtt, last: Math.round(ms) });
    }).catch(() => {}).finally(() => {
      if (this.ws === ws && this.generation === generation) { this.pingSentAt = null; clearTimeout(this.pingDeadline); }
    });
    clearTimeout(this.pingDeadline);
    this.pingDeadline = setTimeout(() => { if (this.ws === ws && pingTimedOut(this.pingSentAt, Date.now(), PING_TIMEOUT_MS)) this.dead(ws); }, PING_TIMEOUT_MS + 100);
  }
  retry() {
    clearTimeout(this.retryTimer);
    if (this.stopped) return;
    const d = retryDelay(this.conn, { maxMs: globalThis.window?.mt?.web ? undefined : 2000 });
    if (d != null) this.retryTimer = setTimeout(() => this.connect(), d);
  }
  close() {
    this.stopped = true; this.generation++; this.clearTimers();
    const ws = this.ws; this.ws = null; this.drop(ws);
    this.setStatus('closed'); this.emit('$close');
    globalThis.window?.removeEventListener?.('online', this.onWake);
    globalThis.document?.removeEventListener?.('visibilitychange', this.onVisible);
  }
  call(method, params = {}) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(disconnected());
    const id = ++this.n;
    return pendingRequest(this.wait, id, () => { this.wait.get(id).m = method; ws.send(JSON.stringify({ id, method, params })); }, { method });
  }
}
export const api = new Api();
