// 화면 중계(ARCH 5절, 7.4): 가까이 보이는 노드마다 터미널 제어기(hc attach 스트림) 하나를 붙여 프레임을 창(API 클라이언트)으로 넘기고,
// 입력과 크기 조정을 제어기로 넘긴다. 붙여넣기 감싸기와 휠 변환은 창 쪽에서 한 뒤 보낸다(9.2).
// P47(원격 R1): 제어기는 패널마다 하나이고(그때 터미널이 패널 하나에 클라이언트 하나만 받았다), 붙은 클라이언트 모두에게 나눠 보낸다.
// 새로 붙은 클라이언트는 full 프레임부터 받는다(같은 크기 resize로 full을 부른다). 패널 크기는 마지막으로 입력했거나 초점을 준 클라이언트가 정하고,
// 다른 클라이언트는 같은 열×행을 비율로 그린다. 상태 바꾸기는 multiclient.mjs의 순수 함수다.
import { FrameBatcher, REMOTE_BATCH_MS } from './frame-batch.mjs'; // P49: 원격 클라이언트에게는 프레임을 묶어 보낸다
import { randomUUID } from 'node:crypto';
import { shareEmpty, shareJoin, shareLeave, shareActive, shareWant, shareSize, shareFrame, shareNeedsFull, shareOwnerView, shareExternal } from './multiclient.mjs';
// P114(hc): hc 어댑터의 제어기(hc/stream.mjs)는 프레임 모드 attach 스트림이다. 첫 화면을 full로 내고(같은 크기 resize = 다시 붙어 새 첫 화면),
// CREDIT·끊김 뒤 다시 붙기는 제어기 안에서 한다. 더해진 것: 판 밖 보는 이가 크기를 가져가면 'size'(external)를 받아 모든 클라이언트를
// 주인이 아닌 쪽으로 알리고(shareExternal), 초점을 주면 스트림에도 FOCUS를 보낸다. 그 기능이 없는 제어기(옛 판을 옮기는 동안의 옛 터미널)는 그대로다

const INPUT_NOTE_MS = 1000; // 같은 클라이언트의 "방금 입력" 알림은 이 간격에 한 번

export class TerminalRelay {
  constructor({ adapter, onInput, log, now = () => Date.now(), remoteBatchMs = REMOTE_BATCH_MS }) {
    this.adapter = adapter; this.onInput = onInput; this.log = log || (() => {}); this.now = now; this.remoteBatchMs = remoteBatchMs;
    this.attached = new Map(); // sessionId → { ctl, paneId, share, clients: Map(key → client), size, frames, bytes }
    this.keys = new WeakMap(); // client → 연결 키
    this.nextKey = 1;
  }
  keyOf(client) { let k = this.keys.get(client); if (!k) { k = `c${this.nextKey++}`; this.keys.set(client, k); } return k; }
  attach(session, cols, rows, client, attachmentId = randomUUID()) {
    if (typeof attachmentId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(attachmentId)) throw Object.assign(new Error('invalid attachment ID'), { code: 'bad_request' });
    const key = this.keyOf(client);
    let e = this.attached.get(session.sessionId);
    if (e && (e.ctl.exited != null || e.paneId !== session.paneId)) { this._close(session.sessionId, 'replaced'); e = null; }
    const now = this.now();
    if (!e) {
      const ctl = this.adapter.openController(session.paneId, cols, rows);
      e = { ctl, paneId: session.paneId, share: shareEmpty(), clients: new Map(), attachments: new Map(), size: { cols, rows }, frames: 0, bytes: 0, startedAt: now, inputNote: new Map(), batch: new Map() };
      this.attached.set(session.sessionId, e);
      this._wire(session.sessionId, e);
      e.share = shareJoin(e.share, { key, clientId: client.clientId || null, name: client.name || null, cols, rows, now });
      e.clients.set(key, client);
      e.attachments.set(key, attachmentId);
    } else {
      e.batch.get(key)?.drop(); e.batch.delete(key);
      e.attachments.set(key, attachmentId);
      e.share = shareJoin(e.share, { key, clientId: client.clientId || null, name: client.name || null, cols, rows, now });
      e.clients.set(key, client);
      this._apply(session.sessionId, e, { forceFull: true });
    }
    this._announce(session.sessionId, e, true);
    const o = shareOwnerView(e.share);
    return { controllerPid: e.ctl.pid, attachmentId, paneId: e.paneId, cols: e.size.cols, rows: e.size.rows, shared: e.clients.size, owner: o ? o.clientId : null, ownerIsMe: e.share.owner === key };
  }
  _wire(sessionId, e) {
    const { ctl } = e;
    ctl.on('frame', (f) => {
      if (this.attached.get(sessionId) !== e) return;
      e.frames++; e.bytes += f.bytes.length;
      if (f.width && f.height) e.size = { cols: f.width, rows: f.height };
      const r = shareFrame(e.share, !!f.full);
      e.share = r.st;
      const data = { ...f, sessionId, controllerPid: ctl.pid };
      for (const k of r.to) { const c = e.clients.get(k); if (c) this._send(e, k, c, data); }
    });
    ctl.on('stderr', (s) => this.log(`controller ${e.paneId} stderr: ${s.trim().slice(0, 200)}`));
    // P114(hc): 터미널 크기가 바뀌었다. 판 밖 보는 이가 가져갔으면(external) 모두 비율로 그린다. 판 스트림의 크기로 돌아오면 풀린다
    ctl.on('size', (z) => {
      if (this.attached.get(sessionId) !== e) return;
      e.size = { cols: z.cols, rows: z.rows };
      e.share = shareExternal(e.share, z.external ? z : null);
      this._announce(sessionId, e);
    });
    ctl.on('record', (m) => { if (m.type === 'terminal.closed' && /taken over/.test(m.reason || '')) e.closeReason ||= 'takeover'; });
    ctl.on('exit', (code) => {
      if (this.attached.get(sessionId) === e) this.attached.delete(sessionId);
      // 같은 세션에 새 제어기가 붙은 뒤에 옛 제어기가 끝날 수 있다. 창은 controllerPid로 어느 제어기의 일인지 가린다.
      for (const b of e.batch.values()) b.flush(); // P49: 묶어 둔 프레임을 먼저
      for (const [k, c] of e.clients) c.sendEvent('terminal.detached', { sessionId, controllerPid: ctl.pid, attachmentId: e.attachments.get(k), reason: e.closeReason || `controller exit ${code}` });
    });
  }
  // P49: 원격 클라이언트(client.remote)는 패널마다 묶어서(frame-batch.mjs), 이 PC 안의 창은 바로
  _send(e, key, c, data) {
    data = { ...data, attachmentId: e.attachments.get(key) };
    if (!c.remote || !(this.remoteBatchMs > 0)) { c.sendEvent('terminal.frame', data); return; }
    let b = e.batch.get(key);
    if (!b) { b = new FrameBatcher({ send: (fr) => c.sendEvent('terminal.frame', fr), intervalMs: this.remoteBatchMs, now: this.now }); e.batch.set(key, b); }
    b.push(data);
  }
  // 크기 정하는 클라이언트의 크기로 제어기를 맞춘다. full을 기다리는 클라이언트가 있으면 같은 크기로라도 resize해 full 프레임을 부른다
  _apply(sessionId, e, { forceFull = false } = {}) {
    const want = shareSize(e.share);
    if (!want) return;
    const changed = want.cols !== e.size.cols || want.rows !== e.size.rows;
    if (changed || (forceFull && shareNeedsFull(e.share))) { e.ctl.resize(want.cols, want.rows); e.size = { ...want }; }
  }
  _announce(sessionId, e, force = false) {
    const o = shareOwnerView(e.share);
    const ext = !!e.share.external; // P114(hc): 판 밖 보는 이가 크기를 가졌으면 판 클라이언트는 모두 주인이 아니다(그 보는 이까지 함께 보는 것으로 센다)
    const data = { sessionId, controllerPid: e.ctl.pid, owner: o ? o.clientId : null, ownerName: o ? o.name : null, cols: e.size.cols, rows: e.size.rows, shared: e.clients.size + (ext ? 1 : 0) };
    if (!force && data.owner === e.lastOwner && data.shared === e.lastShared && data.cols === e.lastCols && data.rows === e.lastRows) return;
    e.lastOwner = data.owner; e.lastShared = data.shared; e.lastCols = data.cols; e.lastRows = data.rows;
    for (const [k, c] of e.clients) c.sendEvent('terminal.owner', { ...data, attachmentId: e.attachments.get(k), ownerIsMe: !ext && e.share.owner === k });
  }
  _entry(sessionId, client, controllerPid, attachmentId) {
    const e = this.attached.get(sessionId);
    if (!e) throw Object.assign(new Error('not attached'), { code: 'not_attached' });
    if (client && !e.clients.has(this.keyOf(client))) throw Object.assign(new Error('not attached by this client'), { code: 'not_attached' });
    if (controllerPid != null && e.ctl.pid !== controllerPid) throw Object.assign(new Error('controller was replaced'), { code: 'stale_controller' });
    if (attachmentId != null && (!client || e.attachments.get(this.keyOf(client)) !== attachmentId)) throw Object.assign(new Error('attachment was replaced'), { code: 'stale_attachment' });
    return e;
  }
  input(sessionId, data, client, controllerPid, attachmentId) {
    const e = this._entry(sessionId, client, controllerPid, attachmentId);
    if (client) this._active(sessionId, e, client, { input: true });
    e.ctl.input(data); this.onInput(sessionId, data, client);
  }
  // 초점을 주면 그 클라이언트가 크기를 가져간다(입력과 같다)
  focus(sessionId, client, controllerPid, attachmentId) { const e = this._entry(sessionId, client, controllerPid, attachmentId); this._active(sessionId, e, client, { input: false }); if (e.ctl.focus) e.ctl.focus(true); } // P114(hc): 스트림도 활성으로(크기를 되찾는다)
  _active(sessionId, e, client, { input }) {
    const key = this.keyOf(client), now = this.now();
    const before = e.share.owner;
    e.share = shareActive(e.share, key, now);
    if (before !== e.share.owner) this._apply(sessionId, e);
    this._announce(sessionId, e);
    if (input && e.clients.size > 1 && now - (e.inputNote.get(key) || 0) >= INPUT_NOTE_MS) {
      e.inputNote.set(key, now);
      const data = { sessionId, clientId: client.clientId || null, name: client.name || null, at: now };
      for (const [k, c] of e.clients) if (k !== key) c.sendEvent('terminal.input_by', { ...data, controllerPid: e.ctl.pid, attachmentId: e.attachments.get(k) });
    }
  }
  resize(sessionId, cols, rows, client, controllerPid, attachmentId) {
    const e = this._entry(sessionId, client, controllerPid, attachmentId);
    if (!client) { e.ctl.resize(cols, rows); e.size = { cols, rows }; return; }
    e.share = shareWant(e.share, this.keyOf(client), cols, rows);
    this._apply(sessionId, e);
    this._announce(sessionId, e);
  }
  detach(sessionId, client, controllerPid, attachmentId) {
    if (!client) { this._entry(sessionId, client, controllerPid, attachmentId); this._close(sessionId, 'detach'); return; }
    const e = this._entry(sessionId, client, controllerPid, attachmentId);
    this._leave(sessionId, e, client);
  }
  _leave(sessionId, e, client) {
    const key = this.keyOf(client);
    e.clients.delete(key);
    e.attachments.delete(key); e.inputNote.delete(key);
    const b = e.batch.get(key); if (b) { b.drop(); e.batch.delete(key); }
    e.share = shareLeave(e.share, key);
    if (!e.clients.size) { this._close(sessionId, 'detach'); return; }
    this._apply(sessionId, e);
    this._announce(sessionId, e);
  }
  detachClient(client) {
    const key = this.keyOf(client);
    for (const [sid, e] of [...this.attached]) if (e.clients.has(key)) this._leave(sid, e, client);
  }
  _close(sessionId, reason) {
    const e = this.attached.get(sessionId);
    if (!e) return;
    e.closeReason = reason;
    for (const b of e.batch.values()) b.drop();
    this.attached.delete(sessionId);
    e.ctl.close();
  }
  closeAll() { for (const sid of [...this.attached.keys()]) this._close(sid, 'backend stopping'); }
  stats() {
    return [...this.attached.entries()].map(([sid, e]) => {
      const o = shareOwnerView(e.share);
      return { sessionId: sid, paneId: e.paneId, controllerPid: e.ctl.pid, frames: e.frames, bytes: e.bytes, clients: e.clients.size, owner: o ? o.clientId : null, cols: e.size.cols, rows: e.size.rows, batched: [...e.batch.values()].reduce((a, b) => ({ in: a.in + b.stats.in, out: a.out + b.stats.out }), { in: 0, out: 0 }) };
    });
  }
}
