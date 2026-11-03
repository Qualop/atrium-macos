// API 서버(ARCH 6절): 127.0.0.1의 WebSocket. 요청 {id, method, params} → 응답 {id, result} 또는 {id, error: {code, message}}.
// 백엔드가 먼저 보내는 것은 {event, data}다(events.subscribe를 부른 클라이언트에게, 터미널 프레임은 붙은 클라이언트에게만).
import { WebSocketServer } from 'ws';

export class ApiServer {
  constructor({ token, handlers, onClose, log }) {
    this.token = token; this.handlers = handlers; this.onClose = onClose; this.log = log || (() => {});
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
    this.clients = new Set();
    this.wss.on('connection', (ws) => this._connection(ws));
  }
  // http 서버의 upgrade 이벤트에서 부른다
  handleUpgrade(req, socket, head) {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/api' || u.searchParams.get('token') !== this.token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
  }
  _connection(ws) {
    const client = {
      ws, subscribed: false,
      sendEvent: (event, data) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ event, data })); },
    };
    this.clients.add(client);
    ws.on('message', async (raw) => {
      const sendError = (id, code, message) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id: id ?? null, error: { code, message } })); };
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return sendError(null, 'bad_json', 'invalid JSON'); }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string' || !msg.method
        || (msg.params != null && (typeof msg.params !== 'object' || Array.isArray(msg.params)))) {
        return sendError(msg && (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : null, 'bad_request', 'expected an API request object');
      }
      const h = Object.hasOwn(this.handlers, msg.method) ? this.handlers[msg.method] : null;
      if (typeof h !== 'function') return sendError(msg.id, 'unknown_method', msg.method);
      try {
        const result = await h(msg.params || {}, client);
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id: msg.id, result: result ?? null }));
      } catch (e) {
        if (!e.code) this.log(`api ${msg.method} failed: ${e.stack}`);
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id: msg.id, error: { code: e.code || 'internal', message: e.message, ...(e.key ? { key: e.key, vars: e.vars || {} } : {}) } })); // P16: 화면 글 열쇠(msg.mjs)
      }
    });
    ws.on('close', () => { this.clients.delete(client); this.onClose(client); });
    ws.on('error', () => {});
  }
  broadcast(event, data) { for (const c of this.clients) if (c.subscribed) c.sendEvent(event, data); }
  close() { for (const c of this.clients) c.ws.close(); this.wss.close(); }
}
