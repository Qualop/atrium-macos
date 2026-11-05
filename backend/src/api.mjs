// API 서버(ARCH 6절): 127.0.0.1의 WebSocket. 요청 {id, method, params} → 응답 {id, result} 또는 {id, error: {code, message}}.
// 백엔드가 먼저 보내는 것은 {event, data}다(events.subscribe를 부른 클라이언트에게, 터미널 프레임은 붙은 클라이언트에게만).
import { WebSocketServer } from 'ws';
import { parseClientHello, bindAuth } from './multiclient.mjs';

// P49(R3): 원격 연결(tailscale serve를 거친 기기)에만 WebSocket 압축(permessage-deflate)을 켠다. 이 PC 안 연결은 압축하지 않는다(CPU만 든다)
export const REMOTE_DEFLATE = { threshold: 512, zlibDeflateOptions: { level: 1 }, serverNoContextTakeover: false, clientNoContextTakeover: false };

export class ApiServer {
  // authorize(req): P48 연결 허락. { kind: 'local' }(판 API 토큰), { kind: 'device', device, remote? }(기기 토큰), null(막음). 없으면 판 API 토큰만 본다
  // ready: P54 백엔드가 다 뜰 때 풀리는 약속. 그 전에 온 요청은 기다렸다가 처리한다(뜨는 중인 백엔드의 빈 필드나 아직 없는 처리기를 부르지 않게)
  constructor({ token, handlers, onClose, onOpen, log, authorize, ready = null }) {
    this.ready = ready;
    this.token = token; this.handlers = handlers; this.onClose = onClose; this.onOpen = onOpen || (() => {}); this.log = log || (() => {}); this.authorize = authorize || null;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
    this.wssRemote = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024, perMessageDeflate: REMOTE_DEFLATE }); // P49
    this.clients = new Set();
    this.wss.on('connection', (ws, req, auth) => this._connection(ws, req, auth));
    this.wssRemote.on('connection', (ws, req, auth) => this._connection(ws, req, auth));
  }
  // http 서버의 upgrade 이벤트에서 부른다
  handleUpgrade(req, socket, head) {
    const u = new URL(req.url, 'http://127.0.0.1');
    const auth = this.authorize ? this.authorize(req) : (u.pathname === '/api' && u.searchParams.get('token') === this.token ? { kind: 'local' } : null);
    if (!auth) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
    }
    const wss = auth.remote ? this.wssRemote : this.wss;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, auth));
  }
  // P47: 연결 주소의 client(오래 가는 ID)·name(기기 이름)·kind(desktop|web|tray|cli)로 클라이언트를 알아본다(multiclient.mjs). 없으면 익명(CLI, 옛 창)
  // P48: auth는 누가 붙었나. 기기면 auth.device = { id, name }
  _connection(ws, req, auth) {
    // P49: 기기 토큰 연결은 늘 web(bindAuth). remote는 tailscale serve 같은 앞단을 거친 연결(프레임 묶기, 압축)
    const hello = bindAuth(parseClientHello(new URL((req && req.url) || '/api', 'http://127.0.0.1').searchParams), auth);
    const client = {
      ws, subscribed: false, ...hello, connectedAt: Date.now(), lastInputAt: null, auth: auth || { kind: 'local' }, remote: !!(auth && auth.remote),
      sendEvent: (event, data) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ event, data })); },
    };
    this.clients.add(client);
    this.onOpen(client);
    ws.on('message', async (raw) => {
      const sendError = (id, code, message) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id: id ?? null, error: { code, message } })); };
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return sendError(null, 'bad_json', 'invalid JSON'); }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string' || !msg.method
        || (msg.params != null && (typeof msg.params !== 'object' || Array.isArray(msg.params)))) {
        return sendError(msg && (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : null, 'bad_request', 'expected an API request object');
      }
      try {
        if (this.ready) await this.ready; // Handlers are registered during startup.
        if (ws.readyState !== ws.OPEN) return;
        const h = Object.hasOwn(this.handlers, msg.method) ? this.handlers[msg.method] : null;
        if (typeof h !== 'function') return sendError(msg.id, 'unknown_method', msg.method);
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
  close() { for (const c of this.clients) c.ws.close(); this.wss.close(); this.wssRemote.close(); }
}
