// 화면 중계(ARCH 5절, 7.4): 가까이 보이는 노드마다 herdr 제어기 하나를 붙여 프레임을 창(API 클라이언트)으로 넘기고,
// 입력과 크기 조정을 제어기로 넘긴다. 제어기는 패널마다 하나다. 다른 클라이언트가 붙으면 앞 클라이언트는 놓인다(takeover).
// 붙여넣기 감싸기와 휠 변환은 창 쪽에서 한 뒤 보낸다(9.2).
export class TerminalRelay {
  constructor({ adapter, onInput, log }) {
    this.adapter = adapter; this.onInput = onInput; this.log = log || (() => {});
    this.attached = new Map(); // sessionId → { ctl, client, paneId }
  }
  attach(session, cols, rows, client) {
    const prev = this.attached.get(session.sessionId);
    if (prev) { this._close(session.sessionId, 'takeover'); }
    const ctl = this.adapter.openController(session.paneId, cols, rows);
    const entry = { ctl, client, paneId: session.paneId, frames: 0, bytes: 0, startedAt: Date.now() };
    this.attached.set(session.sessionId, entry);
    ctl.on('frame', (f) => {
      entry.frames++; entry.bytes += f.bytes.length;
      client.sendEvent('terminal.frame', { sessionId: session.sessionId, controllerPid: ctl.pid, ...f });
    });
    ctl.on('stderr', (s) => this.log(`controller ${session.paneId} stderr: ${s.trim().slice(0, 200)}`));
    ctl.on('exit', (code) => {
      if (this.attached.get(session.sessionId) === entry) this.attached.delete(session.sessionId);
      // 같은 세션에 새 제어기가 붙은 뒤에 옛 제어기가 끝날 수 있다. 창은 controllerPid로 어느 제어기의 일인지 가린다.
      client.sendEvent('terminal.detached', { sessionId: session.sessionId, controllerPid: ctl.pid, reason: entry.closeReason || `controller exit ${code}` });
    });
    return { controllerPid: ctl.pid, paneId: session.paneId, cols, rows };
  }
  _entry(sessionId, client, controllerPid) {
    const e = this.attached.get(sessionId);
    if (!e) throw Object.assign(new Error('not attached'), { code: 'not_attached' });
    if (client && e.client !== client) throw Object.assign(new Error('attached by another client'), { code: 'not_owner' });
    if (controllerPid != null && e.ctl.pid !== controllerPid) throw Object.assign(new Error('controller was replaced'), { code: 'stale_controller' });
    return e;
  }
  input(sessionId, data, client, controllerPid) { this._entry(sessionId, client, controllerPid).ctl.input(data); this.onInput(sessionId, data); }
  resize(sessionId, cols, rows, client, controllerPid) { this._entry(sessionId, client, controllerPid).ctl.resize(cols, rows); }
  detach(sessionId, client, controllerPid) { this._entry(sessionId, client, controllerPid); this._close(sessionId, 'detach'); }
  detachClient(client) { for (const [sid, e] of this.attached) if (e.client === client) this._close(sid, 'client closed'); }
  _close(sessionId, reason) {
    const e = this.attached.get(sessionId);
    if (!e) return;
    e.closeReason = reason;
    this.attached.delete(sessionId);
    e.ctl.close();
  }
  closeAll() { for (const sid of [...this.attached.keys()]) this._close(sid, 'backend stopping'); }
  stats() { return [...this.attached.entries()].map(([sid, e]) => ({ sessionId: sid, paneId: e.paneId, controllerPid: e.ctl.pid, frames: e.frames, bytes: e.bytes })); }
}
