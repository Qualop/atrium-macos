// P114: hc 프레임 모드 attach 스트림 하나 = 판의 화면 제어기(relay.mjs가 쓴다).
// - 이벤트: frame { seq, full, width, height, bytes(base64) }, record { type: 'terminal.closed', reason }, stderr(글), exit(까닭), size { cols, rows, external }
// - 메서드: input(글), inputAuto(글), resize(cols, rows), focus(on), close(). pid는 프로세스가 없어 'hc:<n>'(창은 controllerPid로 스트림을 가린다)
// - 첫 화면: attach 응답 뒤 처음 오는 DATA가 첫 화면(CAN, 소프트 리셋, ESC[H ESC[2J로 시작)이라 full로 낸다. 같은 크기 resize는 다시 붙어 새 첫 화면을 낸다
//   (같은 크기 resize로 full 프레임을 받는 뜻. relay.mjs의 shareNeedsFull이 부른다)
// - 흐름 제어: 받은 바이트를 넘긴 뒤 곧바로 CREDIT로 알린다(시작 256KiB). 4MiB 넘게 밀리면 hc가 새 첫 화면을 보낸다
// - 끊김: 연결이 끊기거나(코어 재시작·강제 종료) 스트림이 lost로 닫히면 물러나며 다시 붙는다. 터미널이 끝났으면(exited, killed …) exit
// - 크기: 이 스트림이 활성이면 터미널 크기 = 우리가 보낸 크기. 판 밖의 활성 보는 이(hc attach)가 크기를 가져가면 size 이벤트(external)로 알린다
import { EventEmitter } from 'node:events';
import { FramedConn, FRAME, u32, sizePayload } from './rpc.mjs';
import { modeChanges } from '../input-trace.mjs';

const DECPRIV = Buffer.from('\x1b[?');

const FINAL = new Set(['exited', 'killed', 'server_stop', 'host_shutdown', 'holder_lost', 'stopped_by_restart', 'removed', 'not_found']);
// 묶기: hc는 프로그램이 쓸 때마다(타자 메아리는 글자 하나씩) DATA를 보낸다.
// 이 간격 안에 온 바이트는 한 프레임으로 낸다(창의 프레임 처리와 WebSocket 메시지 수를 줄인다). 첫 화면과 쉬다가 온 첫 덩어리는 바로 낸다
export const COALESCE_MS = 8;
const COALESCE_MAX = 256 * 1024;
const RETRY_MS = [200, 400, 800, 1600, 3000, 5000];
const MAX_RETRY_MS = 60000; // 이만큼 붙지 못하면 끝(창은 detached를 보이고 다시 붙기를 고를 수 있다)
let nextId = 1;

export class HcController extends EventEmitter {
  constructor({ pipe, terminal, cols, rows, log = () => {}, connect = (p) => new FramedConn(p), coalesceMs = COALESCE_MS, moveWaitMs = 3000 }) {
    super();
    this.moveWaitMs = moveWaitMs; this._moveTimer = null;
    this.coalesceMs = coalesceMs; this.pend = []; this.pendBytes = 0; this.pendTimer = null; this.lastEmit = 0;
    this.pipe = pipe; this.terminal = terminal; this.log = log; this.connect = connect;
    this.pid = `hc:${nextId++}`;
    this.paneId = terminal;
    this.want = { cols, rows }; // 우리가 바라는 크기
    this.size = { cols, rows }; // 터미널의 지금 크기(프레임 width·height)
    this.exited = null;
    this.seq = 0;
    this.conn = null; this.ch = null;
    this.firstPending = false;
    this.queue = []; // 붙기 전에 온 입력([글, 판이 친 것인지])
    this.autoInput = false; // attach 응답의 automatic_input: 이 길이 AUTOMATIC_INPUT(kind 6)을 받는다(P130)
    this.retryStart = null; this.retryN = 0;
    this.stats = { attaches: 0, bytes: 0, credits: 0 };
    this._attach(false);
  }

  async _attach(resumed) {
    if (this.exited != null) return;
    const gen = (this._gen = (this._gen || 0) + 1);
    const conn = this.connect(this.pipe);
    try {
      await conn.open();
      if (this.exited != null || gen !== this._gen) { conn.close(); return; }
      this.conn = conn;
      conn.on('close', () => { if (this.conn === conn) { this.conn = null; this.ch = null; this._retry('connection closed'); } });
      this.firstPending = true;
      const r = await conn.call('terminal.attach', { terminal: this.terminal, cols: this.want.cols, rows: this.want.rows, resumed: !!resumed }, 15000);
      if (this.exited != null || gen !== this._gen) { conn.close(); return; }
      this.ch = r.channel;
      this.autoInput = !!r.automatic_input;
      this.stats.attaches++;
      const t = r.terminal || {};
      if (t.cols && t.rows) this.size = { cols: t.cols, rows: t.rows };
      this.retryStart = null; this.retryN = 0;
      conn.claim(this.ch, (f) => this._frame(conn, f));
      for (const [s, auto] of this.queue.splice(0)) this._write(s, auto);
      this.emit('attached', { channel: this.ch, cols: this.size.cols, rows: this.size.rows });
    } catch (e) {
      try { conn.close(); } catch {}
      if (this.conn === conn) { this.conn = null; this.ch = null; }
      if (e.code === 'agent_not_found' || e.kind === 'not_found') return this._end('not_found');
      this._retry(`attach failed: ${e.code}: ${e.detail || e.message}`);
    }
  }
  _retry(why) {
    if (this.exited != null) return;
    const now = Date.now();
    this.retryStart ||= now;
    if (now - this.retryStart > MAX_RETRY_MS) return this._end(`gave up: ${why}`);
    const ms = RETRY_MS[Math.min(this.retryN++, RETRY_MS.length - 1)];
    this.emit('stderr', `hc stream ${this.terminal}: ${why}; reattach in ${ms}ms`);
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => this._attach(true), ms);
    if (this._retryTimer.unref) this._retryTimer.unref();
  }
  _frame(conn, f) {
    if (conn !== this.conn) return;
    if (f.kind === FRAME.DATA) {
      this.stats.bytes += f.payload.length;
      if (f.payload.indexOf(DECPRIV) >= 0) this._modes(f.payload); // P136: 마우스·초점·대체 화면 모드가 바뀌면 'modes'로 알린다(진단 기록)
      conn.write(this.ch, FRAME.CREDIT, u32(f.payload.length)); this.stats.credits += f.payload.length;
      if (this.firstPending) { this.firstPending = false; this._flush(); this._emitFrame([f.payload], true); return; }
      this.pend.push(f.payload); this.pendBytes += f.payload.length;
      const idle = Date.now() - this.lastEmit >= this.coalesceMs;
      if (this.coalesceMs <= 0 || this.pendBytes >= COALESCE_MAX || (idle && !this.pendTimer)) return this._flush();
      if (!this.pendTimer) { this.pendTimer = setTimeout(() => this._flush(), this.coalesceMs); if (this.pendTimer.unref) this.pendTimer.unref(); }
    } else if (f.kind === FRAME.CLOSE) {
      this._flush();
      let why = null; try { why = f.payload.length ? JSON.parse(f.payload.toString('utf8')) : null; } catch {}
      const reason = (why && why.reason) || 'closed';
      conn.release(this.ch); this.ch = null;
      if (FINAL.has(reason)) {
        this.emit('record', { type: 'terminal.closed', reason, exitCode: why && why.exit_code }); conn.close(); this.conn = null;
        // P114 2b: 판이 그 자리에 새 터미널을 띄울 수 있다(판이 띄운 에이전트가 끝나 셸이 남음, 에이전트로 바꿔 띄움). 잠깐 기다렸다가 옮겨 붙지 않으면 끝
        if (this.moveWaitMs > 0 && (reason === 'exited' || reason === 'killed')) { clearTimeout(this._moveTimer); this._moveTimer = setTimeout(() => this._end(reason), this.moveWaitMs); if (this._moveTimer.unref) this._moveTimer.unref(); return; }
        return this._end(reason);
      }
      // lost(터미널을 남기는 keep)·그 밖: 새 셸이 뜨면 다시 붙는다
      this.conn = null; conn.close(); this._retry(`stream closed: ${reason}`);
    } else if (f.kind === FRAME.RESIZE && f.payload.length >= 4) {
      this.size = { cols: f.payload.readUInt16LE(0), rows: f.payload.readUInt16LE(2) };
    }
  }
  _modes(payload) {
    const ch = modeChanges(payload);
    if (!ch) return;
    const before = { ...(this.modes || {}) };
    this.modes ||= {};
    for (const m of ch) this.modes[m.slice(0, -1)] = m.endsWith('h');
    // 첫 화면은 모드를 모두 끈 뒤 다시 켠다. 끝 상태가 앞과 다른 것만 낸다(처음에는 켜진 것만)
    const changed = Object.keys(this.modes).filter((n) => this.modes[n] !== (before[n] ?? false)).map((n) => `${n}${this.modes[n] ? 'h' : 'l'}`);
    if (changed.length) this.emit('modes', changed);
  }
  _emitFrame(parts, full) {
    this.lastEmit = Date.now();
    this.emit('frame', { seq: ++this.seq, full, width: this.size.cols, height: this.size.rows, bytes: (parts.length === 1 ? parts[0] : Buffer.concat(parts)).toString('base64') });
  }
  _flush() {
    clearTimeout(this.pendTimer); this.pendTimer = null;
    if (!this.pend.length) return;
    const parts = this.pend; this.pend = []; this.pendBytes = 0;
    this._emitFrame(parts, false);
  }
  // auto: 판이 친 키(AUTOMATIC_INPUT). hc는 DATA만 사람 입력으로 세어 terminal.send·keys가 그 뒤 약 3초 조용한 틈을 기다린다(P130).
  // 이 길이 kind 6을 받지 않으면(automatic_input 없음) DATA로 보낸다
  _write(s, auto = false) {
    if (this.conn && this.ch != null) this.conn.write(this.ch, auto && this.autoInput ? FRAME.AUTOMATIC_INPUT : FRAME.DATA, Buffer.from(s, 'utf8'));
    else if (this.queue.length < 256) this.queue.push([s, auto]);
  }
  // 판 클라이언트가 친 글(붙여넣기 감싸기·휠 변환은 창이 이미 했다). 사람 입력이다
  input(text) { if (this.exited == null) this._write(String(text)); }
  // 판이 친 키(전달의 쓰다 만 글 비키기·되돌리기, 키 패드, 답하기, 끄기의 키). 사람 입력으로 세지 않는다(P130)
  inputAuto(text) { if (this.exited == null) this._write(String(text), true); }
  // 크기 바꾸기. 같은 크기면 다시 붙어 새 첫 화면(full)을 낸다(새로 붙은 클라이언트가 앞 화면 없이 깨지지 않게)
  resize(cols, rows) {
    if (this.exited != null || !cols || !rows) return;
    const same = cols === this.want.cols && rows === this.want.rows && cols === this.size.cols && rows === this.size.rows;
    this.want = { cols, rows };
    if (same && this.conn && this.ch != null) return this.repaint();
    if (this.conn && this.ch != null) { this.conn.write(this.ch, FRAME.RESIZE, sizePayload(cols, rows)); this.size = { cols, rows }; this._repaintSoon(); }
  }
  // P117: 크기를 바꿨는데 프로그램이 아무것도 쓰지 않으면(쉬는 셸) 새 크기를 실은 프레임이 오지 않아 창의 터미널이 옛 크기로 남는다
  // (판 밖 보는 이·CLI 클라이언트가 크기를 가져갔다 떠난 뒤 그랬다, P117 p113 창 시험). 잠깐 뒤에도 프레임이 없으면 새 첫 화면을 받는다
  _repaintSoon(ms = 150) {
    clearTimeout(this._repaintTimer);
    const at = this.lastEmit;
    this._repaintTimer = setTimeout(() => { if (this.exited == null && this.lastEmit === at && !this.pend.length) this.repaint(); }, ms);
    if (this._repaintTimer.unref) this._repaintTimer.unref();
  }
  // P114 2b: 같은 판 세션의 새 터미널로 옮겨 붙는다(같은 controllerPid라 창은 이어서 받고, 새 첫 화면이 full로 온다)
  retarget(terminal) {
    if (this.exited != null) return false;
    clearTimeout(this._moveTimer); this._moveTimer = null;
    this._flush();
    const old = this.conn; this.conn = null; this.ch = null; if (old) old.close();
    this.terminal = terminal; this.paneId = terminal; this.retryStart = null; this.retryN = 0;
    this._attach(false);
    this.emit('moved', terminal);
    return true;
  }
  repaint() { if (this.exited != null) return; this._flush(); const old = this.conn; this.conn = null; this.ch = null; if (old) old.close(); this._attach(true); }
  focus(on) { if (this.conn && this.ch != null) this.conn.write(this.ch, FRAME.FOCUS, Buffer.from([on ? 1 : 0])); }
  // 어댑터가 넘기는 터미널 이벤트(size, restarted, finished)
  onTerminalEvent(e) {
    if (this.exited != null) return;
    if (e.type === 'size') {
      const external = e.cols !== this.want.cols || e.rows !== this.want.rows;
      this.size = { cols: e.cols, rows: e.rows };
      this.emit('size', { cols: e.cols, rows: e.rows, external });
    } else if (e.type === 'pane_restarted') { this.retryStart = null; this.retryN = 0; if (!this.conn) this._attach(true); }
    else if (e.type === 'terminal_finished' || e.type === 'pane_closed') { if (!this.conn && !this._moveTimer) this._end(e.reason || 'finished'); }
  }
  _end(reason) {
    if (this.exited != null) return;
    this._flush(); // 모아 둔 바이트를 먼저
    this.exited = reason;
    clearTimeout(this._retryTimer); clearTimeout(this._moveTimer); clearTimeout(this._repaintTimer); this._moveTimer = null;
    if (this.conn) { try { if (this.ch != null) this.conn.write(this.ch, FRAME.CLOSE); } catch {} this.conn.close(); }
    this.conn = null; this.ch = null;
    setImmediate(() => this.emit('exit', reason));
  }
  close() { this._end('closed'); }
}
