// 전달 대기열(ARCH 4절 B1). 세션마다 먼저 넣은 것부터 하나씩 보낸다. 한 세션이 응답을 기다리는 동안 다른 세션은 막지 않는다(E3 2.4).
// 상태: queued(이유) → sending → sent → confirmed | unconfirmed. 그 밖에 failed(이유), cancelled.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { toLF, promptMatches } from './text.mjs';

const FINAL = new Set(['confirmed', 'unconfirmed', 'failed', 'cancelled']);
// P106: 터미널이 agent.prompt를 받지 않은 까닭(오류 코드) → 기다리는 이유. 같은 전달을 곧바로 다시 보내지 않고 물러난다
const REFUSED = { agent_not_found: 'no_agent', agent_not_ready: 'no_agent', agent_blocked: 'waiting', unreachable: 'terminal_down' };
// P258: 미확인(unconfirmed)으로 끝난 전달을 늦은 확인을 위해 기억해 두는 시간(cfg.lateConfirmMs). 압축 중 넣은 글은 Claude Code가 쥐고 있다가
//   압축이 끝난 뒤 제출한다(1~2분). 그 안에 그 세션의 UserPromptSubmit이 그 글과 맞으면 confirmed(이유 late)로 바꾼다. 메모리에만 둔다(판이 다시 뜨면 잊는다)
export const LATE_CONFIRM_MS = 10 * 60000;
// P106: n번째 거부 뒤 다시 보내기까지 기다릴 시간(0.5초에서 두 배씩, 30초까지)
export function retryDelay(n, cfg = {}) {
  const base = cfg.deliveryBackoffMs ?? 500, max = cfg.deliveryBackoffMaxMs ?? 30000;
  return Math.min(max, base * 2 ** Math.max(0, n - 1));
}

// 세션 상태로 지금 보낼 수 있는지 판단한다. 보낼 수 없으면 기다리는 이유를 돌려준다.
export function blockReason(view, now, cfg) {
  if (!view || view.closed) return 'closed';
  if (!view.termConnected) return 'terminal_down';
  if (view.state === 'sleeping') return 'sleeping'; // P21(D4): 판이 깨운 뒤(ready) 보낸다. 이 이유로 기다리면 백엔드가 깨운다
  if (view.state === 'starting') return 'starting'; // 규칙 3(패널이 claude를 찾기 전도 시작 중으로 본다)
  if (view.state === 'trust_wait') return 'trust_wait'; // 규칙 3. Codex 신뢰 화면은 터미널이 에이전트를 알아보기 전이다(agentPresent 없음)
  if (!view.agentPresent) return 'no_agent'; // 규칙 1: claude가 돌고 있는 패널에만
  switch (view.state) {
    case 'waiting': return 'waiting'; // 규칙 2
    case 'starting': return 'starting'; // 규칙 3
    case 'trust_wait': return 'trust_wait'; // 규칙 3
    case 'working': return 'working'; // 턴 중에는 보내지 않는다(Claude Code 자체 대기열과 섞지 않기 위해)
    case 'exited': return 'no_agent';
    default:
  }
  if (view.lastUserInputAt && now - view.lastUserInputAt < cfg.inputQuietMs) return 'user_typing'; // 규칙 4
  return null;
}

// P90: 휴대폰 입력 줄은 "일하는 중이면 바로 넣기"(typeNow)로 보낸다. PC 터미널에서 Enter를 친 것처럼 Claude Code가 자기 대기 메시지로 받아 둔다.
// 판이 띄운 Claude Code(hook 있음)가 working일 때만이다. waiting·trust_wait(권한·질문·신뢰 화면), starting, ready, 셸, 다른 종류, hook 없는 세션은 B1 그대로.
// 입력 칸에 쓰던 글이 있거나 입력 칸을 못 읽으면 넣지 않는다(_typeNow). 막힌 패널은 터미널의 prompt가 글을 넣기 전에 거부한다(agent_blocked)
export function canTypeNow(view) {
  return !!view && !view.closed && !!view.termConnected && !!view.agentPresent && view.state === 'working' && (view.kind || 'claude') === 'claude' && !!view.hooked;
}
// 바로 넣을 글: 줄바꿈은 LF(B1 5), 끝 줄바꿈은 뗀다(입력 칸에 빈 줄이 남지 않게). Enter는 agent.prompt가 마지막에 한 번 누른다
export const typedText = (text) => toLF(text).replace(/\n+$/, '');

export class DeliveryQueue extends EventEmitter {
  // view(sessionId, delivery) → { state, agentPresent, termConnected, lastUserInputAt, closed }
  // send(sessionId, text) → Promise. 터미널 오류는 code를 가진 Error로 던진다.
  // P79: inspect(sessionId, text) → { box: 'ours'|'empty'|'other'|'unknown', seen }(화면의 입력 칸), pressEnter(sessionId) → Promise.
  //   보낸 뒤 cfg.submitRetryMs 동안 제출 확인이 없으면 화면을 본다: 입력 칸에 보낸 글이 그대로면 Enter, 비었고 들어간 흔적도 없으면 한 번 다시 보낸다.
  //   다른 글이 있거나(사람이 쓰는 중) 알 수 없으면 손대지 않는다. 사람이 3초 안에 친 터미널은 기다린다(B1 규칙 4). 둘 다 없으면 전처럼 기다리기만 한다
  //   P106: hook이 없는 종류(Codex 등)도 inspect가 그 종류의 입력 칸을 읽는다(noResend면 다시 보내지 않고 Enter만). 화면을 못 읽거나(unknown) 아직 뜨는 중이면
  //   손쓰기로 세지 않고 다시 본다(submitLooks번까지). 입력 칸에 보낸 글이 남았으면 submitEnterMs 뒤에 Enter, 다시 보내기는 submitRetryMs 뒤에만
  // P128: drafts = { aside(sid, d) → { state: 'clear'|'moved'|'keep', held?, why? }, back(sid, held, d) → { result, why? } }(draft-aside.mjs draftMover).
  //   보내기 직전에 입력 칸에 쓰다 만 글이 있으면 비키고(moved), 지시가 끝나면(확인·확인 못 함·실패·취소) 되돌린다. 비우지 못하면(keep, P139) 'draft'로 기다리며 draftLookMs마다 다시 본다
  constructor({ store, cfg, view, send, inspect = null, pressEnter = null, drafts = null }) {
    super();
    this.store = store; this.cfg = cfg; this.view = view; this.send = send; this.inspect = inspect; this.pressEnter = pressEnter; this.drafts = drafts;
    this.items = new Map();
    this.sending = new Set(); // 제출 hook이 먼저 와도 같은 터미널의 RPC는 하나씩 끝낸다.
    this.late = new Map(); // P258: sessionId → 미확인으로 끝난 전달들(늦은 확인을 기다린다, lateUntil까지)
    for (const d of store.activeDeliveries()) {
      // 백엔드가 보내는 중에 꺼졌다면 들어갔는지 모른다 → sent로 보고 확인을 기다린다(C2에서 대화 기록으로 맞춘다)
      if (d.status === 'sending' || (d.status === 'sent' && !d.sentAt)) {
        d.status = 'sent';
        // 복구 시각부터 읽으면 꺼진 동안 제출된 지시를 놓친다. 마지막 전송 시도부터 맞춘다.
        d.sentAt ||= d.updatedAt || d.createdAt || Date.now();
        this.store.updateDelivery(d.deliveryId, { status: d.status, sentAt: d.sentAt });
      }
      this.items.set(d.deliveryId, d);
    }
  }
  start() { this.timer = setInterval(() => this.pump(), 500); }
  stop() { clearInterval(this.timer); }

  // opts.typeNow(P90): 세션이 일하는 중이면 기다리지 않고 바로 넣는다(canTypeNow). 저장하지 않으므로 백엔드가 다시 뜨면 B1 그대로 보낸다
  enqueue(sessionId, text, opts = {}) {
    const d = { deliveryId: 'd' + crypto.randomBytes(5).toString('hex'), sessionId, text: opts.typeNow ? typedText(text) : toLF(text), status: 'queued', reason: null, createdAt: Date.now(), attempts: 0 };
    if (opts.typeNow) d.typeNow = true;
    if (opts.fromSession) d.fromSession = opts.fromSession; // P281: 보낸 세션
    if (opts.typeNow && opts.aside) d.typeAside = true; // P143(atrium prompt --now): 입력 칸에 쓰다 만 글이 있으면 비키고(P128·P139) 바로 넣는다. 휴대폰 입력 줄(P90)은 그대로 기다린다
    this.store.insertDelivery(d);
    this.items.set(d.deliveryId, d);
    this._emit(d);
    this.poke(sessionId); // P106: 사람이 다시 보내면 물러나 있던 앞 전달도 바로 다시 본다
    setImmediate(() => this.pump());
    return d;
  }
  // P106: 막혀 물러난 전달(앞 시도를 터미널이 받지 않음)은 시도 중(sending)이어도 취소한다. 처음 보내는 짧은 순간(sending, 거부 없음)은 취소하지 않는다
  cancel(id) {
    const d = this.items.get(id) || this.store.getDelivery(id);
    if (!d) throw Object.assign(new Error('no such delivery'), { code: 'not_found' });
    if (d.status !== 'queued' && !(d.status === 'sending' && d.refusals)) throw Object.assign(new Error(`cannot cancel: ${d.status}`), { code: 'not_cancellable' });
    this._set(d, 'cancelled', 'user');
    return d;
  }
  // P106: 사람의 취소(atrium cancel, 판 UI). 보내는 중이면 그 시도가 끝나기를 잠깐(cancelWaitMs) 기다린다. 터미널이 받지 않았으면 대기열로 돌아와 취소된다
  async cancelWait(id) {
    const d = this.items.get(id);
    if (d && d.status === 'sending' && d.inflight) await Promise.race([d.inflight, new Promise((r) => { const t = setTimeout(r, this.cfg.cancelWaitMs ?? 3000); if (t.unref) t.unref(); })]);
    return this.cancel(id);
  }
  // P158: 판 칩의 "수정". 대기 중(queued)인 전달을 붙잡아 고치는 동안 보내지 않는다(그 세션의 뒤 전달도 차례를 지켜 기다린다).
  //   붙잡기는 메모리에만 둔다(백엔드가 다시 뜨면 놓인 채로 B1 그대로 보낸다). 창이 닫혀 놓지 못해도 editHoldMs(10분) 뒤 저절로 놓는다.
  //   보내는 중이면 cancelWait처럼 그 시도를 잠깐 기다린다. 이미 들어갔으면 already_sent를 던진다
  async holdWait(id) {
    const d = this.items.get(id);
    if (d && d.status === 'sending' && d.inflight) await Promise.race([d.inflight, new Promise((r) => { const t = setTimeout(r, this.cfg.cancelWaitMs ?? 3000); if (t.unref) t.unref(); })]);
    return this.hold(id);
  }
  hold(id) {
    const d = this._editable(id);
    d.editing = true; d.editingAt = Date.now();
    if (d.reason !== 'editing') { d.reasonBeforeEdit = d.reason; this._set(d, 'queued', 'editing'); }
    return { deliveryId: d.deliveryId, sessionId: d.sessionId, status: d.status, reason: d.reason, text: d.text };
  }
  // 고친 글로 바꾸고 놓는다. 차례(createdAt)는 그대로다. 붙잡지 않은 대기 중 전달도 바꿀 수 있다
  update(id, text) {
    const d = this._editable(id);
    const t = d.typeNow ? typedText(String(text ?? '')) : toLF(String(text ?? ''));
    if (!t.trim()) throw Object.assign(new Error('empty text'), { code: 'empty' });
    d.text = t;
    if (this.store.updateDeliveryText) this.store.updateDeliveryText(d.deliveryId, t);
    d.mismatchSeen = false; d.checkedAt = 0;
    this._release(d);
    return { deliveryId: d.deliveryId, sessionId: d.sessionId, status: d.status, reason: d.reason, text: d.text };
  }
  // 고치지 않고 놓는다(Esc). 이미 끝났거나 놓였으면 조용히 지금 상태를 돌려준다
  release(id) {
    const d = this.items.get(id) || this.store.getDelivery(id);
    if (!d) throw Object.assign(new Error('no such delivery'), { code: 'not_found' });
    if (d.editing) this._release(d);
    return { deliveryId: d.deliveryId, sessionId: d.sessionId, status: d.status, reason: d.reason };
  }
  _editable(id) {
    const d = this.items.get(id) || this.store.getDelivery(id);
    if (!d) throw Object.assign(new Error('no such delivery'), { code: 'not_found' });
    if (d.status === 'queued' && this.items.has(d.deliveryId)) return d;
    if (['sending', 'sent', 'confirmed', 'unconfirmed'].includes(d.status)) throw Object.assign(new Error(`already sent: ${d.status}`), { code: 'already_sent' });
    throw Object.assign(new Error(`cannot edit: ${d.status}`), { code: 'not_editable' });
  }
  _release(d) {
    if (!d.editing) return;
    d.pausedMs = (d.pausedMs || 0) + (Date.now() - d.editingAt); // 고치는 동안은 기다린 시간(deliveryMaxWaitMs)에 넣지 않는다
    d.editing = false; d.editingAt = 0; d.retryAt = 0;
    const back = d.reasonBeforeEdit ?? null; d.reasonBeforeEdit = undefined;
    if (d.status === 'queued' && d.reason === 'editing') this._set(d, 'queued', back);
    setImmediate(() => this.pump());
  }
  // P106: 에이전트 상태가 바뀌었다(터미널 이벤트) → 물러나 있던 전달을 바로 다시 본다
  poke(sessionId) {
    const d = this._head(sessionId);
    if (d && d.status === 'queued' && d.retryAt) { d.retryAt = 0; setImmediate(() => this.pump()); }
  }
  // P106: 오래(deliveryStuckMs) 터미널이 받지 않는 맨 앞 전달. 세션 노드와 atrium children이 그 까닭을 보인다
  stuckOf(sessionId, now = Date.now()) {
    const d = this._head(sessionId);
    if (!d || !d.refusedSince || (d.status !== 'queued' && d.status !== 'sending')) return null;
    if (now - d.refusedSince < this._stuckMs()) return null;
    return { deliveryId: d.deliveryId, reason: d.reason, code: d.refusedCode || null, attempts: d.attempts || 0, since: d.refusedSince, retryAt: d.retryAt || null };
  }
  cancelSession(sessionId, reason) { for (const d of this.items.values()) if (d.sessionId === sessionId && d.status === 'queued') this._set(d, 'cancelled', reason); }
  pending(sessionId) { let n = 0; for (const d of this.items.values()) if (d.sessionId === sessionId) n++; return n; }
  list(sessionId) { return [...this.items.values()].filter((d) => !sessionId || d.sessionId === sessionId); }

  // B1 규칙 6: hook UserPromptSubmit이 오면 맞춰 보고 "제출 확인"
  // P258: 맨 앞 전달(보내는 중·보냄)과 맞지 않으면 미확인으로 끝난 전달(늦은 확인, LATE_CONFIRM_MS 안)과 맞춰 본다. 맞는 글이 우선이고,
  //   같은 글이면 맨 앞 전달이 먼저다. 한 hook은 전달 하나만 확인한다. 늦게 확인한 hook은 맨 앞 전달의 "다른 글이 들어감"(mismatchSeen)으로 치지 않는다
  onUserPromptSubmit(sessionId, prompt) {
    const d = this._head(sessionId);
    const open = !!d && (d.status === 'sending' || d.status === 'sent');
    if (open && promptMatches(d.text, prompt)) { this._set(d, 'confirmed', d.typed ? 'typed' : null, { confirmedAt: Date.now() }); setImmediate(() => this.pump()); return d; }
    const late = this._lateMatch(sessionId, prompt);
    if (late) {
      const now = Date.now();
      const from = late.unconfirmedAt || now;
      this._set(late, 'confirmed', 'late', { confirmedAt: now });
      this.emit('late_confirm', { deliveryId: late.deliveryId, sessionId, afterMs: now - from, why: late.unconfirmedWhy || null });
      return late;
    }
    if (open) d.mismatchSeen = true;
    return null;
  }
  // P258: 미확인으로 끝난 전달 가운데 이 글과 맞는 가장 먼저 보낸 것(꺼내서 돌려준다). 기한이 지난 것은 버린다
  _lateMatch(sessionId, prompt, now = Date.now()) {
    const list = this.late.get(sessionId);
    if (!list) return null;
    const live = list.filter((x) => x.lateUntil > now && x.status === 'unconfirmed');
    const hit = live.find((x) => promptMatches(x.text, prompt)) || null;
    const rest = hit ? live.filter((x) => x !== hit) : live;
    if (rest.length) this.late.set(sessionId, rest); else this.late.delete(sessionId);
    return hit;
  }
  // P258: 늦은 확인을 기다리는 전달 수(시험·진단)
  lateCount(sessionId) { const now = Date.now(); return (this.late.get(sessionId) || []).filter((x) => x.lateUntil > now).length; }
  // hook이 없는 세션(판에 올린 에이전트, Claude Code가 아닌 종류)은 보낸 뒤 터미널 상태가 working이 되면 제출 확인으로 친다(P4)
  onAgentWorking(sessionId) {
    const d = this._head(sessionId);
    if (d && d.status === 'sending') { d.workingSeen = true; return null; } // agent.prompt 응답보다 working이 먼저 왔다
    if (!d || d.status !== 'sent') return null;
    this._set(d, 'confirmed', 'term working', { confirmedAt: Date.now() });
    setImmediate(() => this.pump());
    return d;
  }
  // 백엔드가 꺼진 동안 제출된 지시(대화 기록)로 확인한다(C2)
  reconcile(sessionId, submittedPrompts) {
    const d = this._head(sessionId);
    if (!d || d.status !== 'sent') return;
    if (submittedPrompts.some((p) => promptMatches(d.text, p))) this._set(d, 'confirmed', 'transcript', { confirmedAt: Date.now() });
  }

  _head(sessionId) {
    let head = null;
    for (const d of this.items.values()) if (d.sessionId === sessionId && (!head || d.createdAt < head.createdAt)) head = d;
    return head;
  }

  pump() {
    const now = Date.now();
    const sessions = new Set([...this.items.values()].map((d) => d.sessionId));
    for (const sid of sessions) {
      if (this.sending.has(sid)) continue;
      const d = this._head(sid);
      if (!d || d.status === 'sending') continue;
      if (d.status === 'sent') {
        if (!d.sentAt) d.sentAt = now; // 다른 길로 sentAt 없는 sent가 생겨도 여기서부터 기한을 센다
        if (d.recovering) continue;
        const last = d.triedAt || d.sentAt;
        // P79: 제출 확인이 늦으면 화면을 보고 Enter나 다시 보내기(최대 submitRetries번). P106: 첫 번 보기는 submitEnterMs 뒤(입력 칸에 남은 글에 Enter)
        if (this.inspect && (d.recoveries || 0) < this._retries() && now - last > (d.recoveries ? this._retryMs() : this._enterMs())) {
          const v = this.view(sid, d) || {};
          if (v.closed) { this._set(d, 'failed', 'session closed'); continue; }
          if (v.lastUserInputAt && now - v.lastUserInputAt < this.cfg.inputQuietMs) continue; // 사람이 치는 중이면 기다린다(규칙 4)
          if (v.state === 'working' || v.state === 'waiting') continue; // 이미 돌기 시작했거나 질문 중: 확인(hook)을 더 기다린다
          // P106: 아직 뜨는 중(starting·trust_wait)이면 입력 칸이 생길 때까지 기다린다. 그동안 확인 못 함으로 끝내지 않는다(최대 deliveryMaxWaitMs)
          if (['starting', 'trust_wait', 'sleeping'].includes(v.state) && now - d.sentAt < this.cfg.deliveryMaxWaitMs) continue;
          this._recover(d);
          continue;
        }
        if (now - last > this.cfg.submitConfirmMs) this._set(d, 'unconfirmed', d.recoveries ? `no UserPromptSubmit hook (${d.recoverNote || 'tried'})` : 'no UserPromptSubmit hook');
        continue;
      }
      this._noteStuck(d, now);
      this._countWorking(d, now);
      // P158: 고치는 중이면 보내지 않는다(이 세션의 뒤 전달도 기다린다). 오래 놓지 않으면 저절로 놓는다
      if (d.editing) { if (now - d.editingAt > (this.cfg.editHoldMs ?? 600000)) this._release(d); continue; }
      if (this.waitedMs(d, now) > this.cfg.deliveryMaxWaitMs) { this._set(d, 'failed', `timeout (${d.reason || 'queued'})`); continue; }
      const reason = blockReason(this.view(sid, d), now, this.cfg);
      if (reason === 'closed') { this._set(d, 'failed', 'session closed'); continue; }
      if (reason === 'working' && d.typeNow && this.inspect) { const v = this.view(sid, d); if (canTypeNow(v)) { this._typeNow(d, v, now); continue; } }
      if (reason) { if (d.reason !== reason) this._set(d, 'queued', reason); continue; }
      if (d.retryAt && now < d.retryAt) { this._noteStuck(d, now); continue; } // P106: 터미널이 앞 시도를 받지 않았다. 물러난 시간이 지날 때까지(또는 poke) 기다린다
      if (d.draftLookAt && now < d.draftLookAt) continue; // P128: 쓰다 만 글을 비키지 못했다. 잠시 뒤 다시 본다(사람이 보내거나 지우면 그때 보낸다)
      this._deliver(d);
    }
  }

  // P90: 일하는 중에 바로 넣기. 입력 칸을 읽어 비었을 때만(사람이 쓰던 글을 덮지 않는다) 넣는다. 화면 읽기는 typeCheckMs마다 한 번
  async _typeNow(d, v, now) {
    if (d.checking || now - (d.checkedAt || 0) < (this.cfg.typeCheckMs ?? 1500)) return;
    if (v.lastUserInputAt && now - v.lastUserInputAt < this.cfg.inputQuietMs) { if (d.reason !== 'user_typing') this._set(d, 'queued', 'user_typing'); return; } // 규칙 4
    d.checking = true; d.checkedAt = now;
    try {
      const look = await this.inspect(d.sessionId, d.text).catch(() => null);
      if (d.status !== 'queued' || d.editing || !this.items.has(d.deliveryId) || this._head(d.sessionId) !== d) return; // P158: 그새 붙잡혔다
      const box = look ? look.box : 'unknown';
      const v2 = this.view(d.sessionId, d) || {};
      // P143: --now의 전달은 쓰다 만 글(other)을 비키고 넣는다. 비키지 못하면(keep) _aside가 'draft'로 대기열에 돌려 둔다
      const aside = box === 'other' && d.typeAside && !!this.drafts;
      if ((box !== 'empty' && !aside) || !canTypeNow(v2) || (v2.lastUserInputAt && Date.now() - v2.lastUserInputAt < this.cfg.inputQuietMs)) {
        const why = box === 'other' || box === 'ours' ? 'draft' : 'working'; // 입력 칸에 글이 있다 / 못 읽었거나 상태가 바뀌었다
        if (d.reason !== why) this._set(d, 'queued', why);
        return;
      }
      await this._deliver(d, true, aside);
    } finally { d.checking = false; }
  }

  async _deliver(d, typed = false, aside = !typed) {
    if (this.sending.has(d.sessionId) || this.items.get(d.deliveryId) !== d || this._head(d.sessionId) !== d || d.status !== 'queued') return;
    this.sending.add(d.sessionId);
    d.workingSeen = false; // 앞 시도(실패) 중의 working 신호를 이 시도의 확인으로 쓰지 않는다(이슈 #1-3)
    d.typed = typed; // P90: Claude Code 대기 메시지로 넣었다(전달 기록의 이유 'typed')
    // P106: 앞 시도를 터미널이 받지 않았으면(물러남 중) 다시 보내기는 조용히 한다. 시도 수만 세고 이벤트는 쓰지 않는다(처음 한 번과 까닭이 바뀔 때만)
    const quiet = !!d.refusals || d.reason === 'draft'; // P128: 쓰다 만 글 때문에 기다리며 다시 보는 시도도 조용히 한다
    if (quiet) { d.status = 'sending'; d.attempts = (d.attempts || 0) + 1; d.updatedAt = Date.now(); this.store.updateDelivery(d.deliveryId, { status: 'sending', reason: d.reason, attempt: true }); }
    else this._set(d, 'sending', typed ? 'typed' : null, { attempt: true });
    let done;
    d.inflight = new Promise((r) => { done = r; });
    try {
      if (this.drafts && aside && !(await this._aside(d))) return; // P128: 쓰다 만 글을 비키지 못했거나 그새 사람이 쳤다(대기열로 돌아갔다)
      await this.send(d.sessionId, d.text, { typeNow: typed });
      if (d.status === 'sending') { this._clearRefusal(d); this._set(d, 'sent', typed ? 'typed' : null, { sentAt: Date.now() }); }
      else if (d.status === 'cancelled') this.emit('late', { deliveryId: d.deliveryId, sessionId: d.sessionId }); // P106: 취소한 뒤에 이 시도가 들어갔다(cancelWaitMs보다 오래 걸린 시도)
      if (d.workingSeen && d.status === 'sent') this._set(d, 'confirmed', 'term working', { confirmedAt: Date.now() });
    } catch (e) {
      // 그사이 hook 등으로 confirmed가 되었거나 상태가 바뀌었으면 늦은 오류로 되돌리지 않는다(이슈 #1-2)
      if (d.status !== 'sending' || !this.items.has(d.deliveryId)) return;
      if (d.workingSeen && !['agent_blocked', 'agent_not_found', 'agent_not_ready'].includes(e.code)) { this._clearRefusal(d); this._set(d, 'confirmed', 'term working', { confirmedAt: Date.now() }); return; }
      const why = REFUSED[e.code]; // 막힌 패널은 터미널이 거부한다(agent_blocked, E0 3.2)
      if (why && d.held) await this._putBack(d); // P128: 받지 않았으면 비켜 둔 글부터 되돌린다(물러나 있는 동안 사람이 볼 수 있게)
      if (why) this._refused(d, why, e.code, quiet);
      else this._set(d, 'failed', `${e.code || 'error'}: ${e.detail || e.herdrMessage || e.message}`);
    } finally { d.inflight = null; done(); this.sending.delete(d.sessionId); if (FINAL.has(d.status)) setImmediate(() => this.pump()); }
  }
  // P106: 터미널이 받지 않았다. 대기열로 되돌리고 retryDelay만큼 물러난다. 같은 까닭이 이어지면 이벤트 없이 저장만 한다
  _refused(d, why, code, quiet) {
    const now = Date.now();
    d.refusals = (d.refusals || 0) + 1;
    if (!d.refusedSince) d.refusedSince = now;
    const changed = !quiet || d.reason !== why || d.refusedCode !== code;
    d.refusedCode = code;
    const wait = retryDelay(d.refusals, this.cfg);
    d.retryAt = now + wait;
    if (!changed) { d.status = 'queued'; d.updatedAt = now; this.store.updateDelivery(d.deliveryId, { status: 'queued', reason: why }); return; }
    this._set(d, 'queued', why);
    this.emit('refused', { deliveryId: d.deliveryId, sessionId: d.sessionId, code, reason: why, n: d.refusals, waitMs: wait });
  }
  _clearRefusal(d) { d.refusals = 0; d.retryAt = 0; d.refusedSince = null; d.refusedCode = null; d.stuckNoted = false; }
  // P106: 오래 받지 않으면 한 번 알린다(백엔드가 판 이벤트 delivery_stuck을 남기고 세션 노드를 다시 그린다)
  _noteStuck(d, now) {
    if (d.stuckNoted || !d.refusedSince || now - d.refusedSince < this._stuckMs()) return;
    d.stuckNoted = true;
    this.emit('stuck', { deliveryId: d.deliveryId, sessionId: d.sessionId, reason: d.reason, code: d.refusedCode, attempts: d.attempts || 0, since: d.refusedSince });
  }

  // 2026-11-23: 받는 쪽이 일하는 중(working)인 동안은 기다린 시간(deliveryMaxWaitMs)에 넣지 않는다. 15분 기한은 사람의 답(waiting)을 기다리는 몫이다
  //   (decisions B1 규칙 2). 긴 턴(전체 검사 등)을 하는 리드에게 보낸 글이 턴이 끝나기 전에 사라졌다(DesignSkill 밤샘 실행). 턴이 끝나면(ready) 보낸다.
  //   센 시간은 메모리에만 둔다(백엔드가 다시 뜨면 만든 때부터 다시 센다). 고치는 시간(pausedMs, P158)과 겹치지 않게 'editing' 이유일 때는 세지 않는다
  _countWorking(d, now) {
    if (d.status === 'queued' && d.reason === 'working' && d.lookedAt && now > d.lookedAt) d.workingMs = (d.workingMs || 0) + (now - d.lookedAt);
    d.lookedAt = now;
  }
  waitedMs(d, now = Date.now()) { return now - d.createdAt - (d.pausedMs || 0) - (d.workingMs || 0); }

  _retries() { return this.cfg.submitRetries ?? 2; }
  _retryMs() { return this.cfg.submitRetryMs ?? 6000; }
  _enterMs() { return Math.min(this.cfg.submitEnterMs ?? 3000, this._retryMs()); }
  _looks() { return this.cfg.submitLooks ?? 8; }
  _stuckMs() { return this.cfg.deliveryStuckMs ?? 20000; }
  // P79: 보낸 글이 제출되지 않았을 때 한 번 손쓰기. 같은 글이 두 번 들어가지 않게 다시 보내기는 한 번뿐이고,
  //   입력 칸이 비었어도 화면에 보낸 글이 보이거나(이미 들어감) 다른 hook·working을 봤으면 다시 보내지 않는다
  async _recover(d) {
    d.recovering = true;
    let action = 'none', box = null, peek = null, noise = null;
    try {
      const look = await this.inspect(d.sessionId, d.text).catch(() => null);
      if (d.status !== 'sent' || this.items.get(d.deliveryId) !== d || this._head(d.sessionId) !== d) return;
      const v = this.view(d.sessionId, d) || {};
      if (v.closed || !v.termConnected || !v.agentPresent || ['working', 'waiting', 'starting', 'trust_wait', 'sleeping'].includes(v.state) || (v.lastUserInputAt && Date.now() - v.lastUserInputAt < this.cfg.inputQuietMs)) return; // 그사이 확인됐다
      box = look ? look.box : 'unknown';
      peek = look && look.peek != null ? look.peek : null;
      // P106: 입력 칸을 아직 못 읽거나(뜨는 중, 다른 화면) 보낸 글이 아닌 것이 보인다(갓 뜬 화면은 붙여 넣은 글을 늦게 그린다). 손쓰기로 세지 않고 다시 본다(submitLooks번까지).
      //   다른 글에는 끝내 손대지 않는다(사람이 쓰는 글일 수 있다)
      // P126: 다른 글이 같은 모양으로 세 번 이어 보이면 늦게 그려지는 화면이 아니다. 더 기다리지 않는다(보낸 쪽이 오래 기다리지 않게)
      d.sameOther = box === 'other' && peek != null && peek === d.lastPeek ? (d.sameOther || 0) + 1 : 0;
      d.lastPeek = box === 'other' ? peek : null;
      const settled = box === 'other' && d.sameOther >= 2;
      if ((box === 'unknown' || box === 'other') && look && (d.looks || 0) < this._looks() && !settled) { d.looks = (d.looks || 0) + 1; d.lastBox = box; action = 'wait'; return; }
      const canResend = !!look && !look.noResend && !look.seen && !d.resent && !d.mismatchSeen && !d.workingSeen;
      // Enter만 이르게(submitEnterMs). 비었으면 다시 보내기는 submitRetryMs가 지난 뒤, 그리고 앞 번에도 비어 있었을 때만(hook이나 그리기가 늦을 수 있다)
      if (box === 'empty' && canResend && (Date.now() - d.sentAt < this._retryMs() || d.lastBox !== 'empty') && (d.looks || 0) < this._looks()) { d.looks = (d.looks || 0) + 1; d.lastBox = box; action = 'wait'; return; }
      d.lastBox = box;
      d.recoveries = (d.recoveries || 0) + 1;
      if (look && look.noise) noise = look.noise;
      // P126: 입력 칸 앞에 마우스 보고 글(noise)이 붙어 있어도 나머지가 보낸 글이면 Enter를 누른다. 그 글은 판의 휠이 남긴 것이라 보낸 글과 함께 제출된다
      //   (사람의 글이 아니고, 지우려면 하네스마다 다른 커서 키가 필요해 사람의 글까지 지울 수 있다. 지시가 제출되지 않는 것보다 낫다)
      if (box === 'ours' && this.pressEnter) { await this.pressEnter(d.sessionId); action = 'enter'; }
      else if (box === 'empty' && canResend) { d.resent = true; await this.send(d.sessionId, d.text, { typeNow: false }); action = 'resend'; }
      else if (box === 'other') {
        // P126: 입력 칸에 보낸 글이 아닌 글이 끝까지 남았다(사람이 쓰던 글, 하네스가 보낸 글 앞에 붙인 글 등). 판은 지우지 않는다(사람의 글일 수 있다).
        //   조용히 확인 기한을 기다리지 않고 곧바로 "제출 안 됨"으로 끝내 보낸 쪽(atrium prompt, 판 칩)에 까닭을 보인다
        d.recoveries = this._retries(); action = 'give_up';
        d.recoverNote = `${action} · ${box}`;
        this._set(d, 'unconfirmed', 'input_box_other');
        this.emit('not_submitted', { deliveryId: d.deliveryId, sessionId: d.sessionId, box, ...(peek ? { peek } : {}) });
        return;
      } else d.recoveries = this._retries(); // 알 수 없음, 이미 들어갔을 수 있음, 다시 보내지 않는 종류: 더 손대지 않는다
      d.recoverNote = `${action}${box ? ' · ' + box : ''}${noise ? ' · noise' : ''}`;
    } catch (e) {
      action = 'error'; d.recoverNote = `error · ${e.code || e.message}`;
    } finally {
      d.triedAt = Date.now();
      d.recovering = false;
      this.emit('recover', { deliveryId: d.deliveryId, sessionId: d.sessionId, action, box, n: d.recoveries || 0, ...(peek && box !== 'ours' ? { peek } : {}), ...(noise ? { noise } : {}) }); // P106: peek(보낸 글이 아닐 때 입력 칸의 앞 60자, 판 기록에만)
    }
  }

  _set(d, status, reason, extra = {}) {
    if (status === 'confirmed' && d.held) reason = 'draft_moved'; // P128: 쓰다 만 글을 잠시 비키고 보냈다(되돌린 뒤 draft_restored 등으로 바꾼다)
    d.status = status; d.reason = reason ?? null;
    if (extra.sentAt) d.sentAt = extra.sentAt;
    if (extra.confirmedAt) d.confirmedAt = extra.confirmedAt;
    if (extra.attempt) d.attempts = (d.attempts || 0) + 1;
    d.updatedAt = Date.now();
    this.store.updateDelivery(d.deliveryId, { status, reason, ...extra });
    if (FINAL.has(status)) this.items.delete(d.deliveryId);
    if (status === 'unconfirmed') { // P258: 늦게 제출될 수 있다(압축 중 쥐고 있던 글 등). 잠시 기억해 둔다
      const now = Date.now();
      d.unconfirmedAt = now; d.unconfirmedWhy = reason ?? null; d.lateUntil = now + (this.cfg.lateConfirmMs ?? LATE_CONFIRM_MS);
      this.late.set(d.sessionId, [...(this.late.get(d.sessionId) || []).filter((x) => x.lateUntil > now && x !== d), d]);
    }
    this._emit(d);
    if (FINAL.has(status) && d.held) this._putBack(d).catch(() => {}); // P128: 지시가 끝났다. 비켜 둔 글을 입력 칸에 되돌린다
  }

  // P128: 보내기 직전에 입력 칸의 쓰다 만 글을 비킨다. → true(보낸다) | false(보내지 않고 대기열로 돌아갔다)
  async _aside(d) {
    const started = Date.now();
    let a;
    try { a = await this.drafts.aside(d.sessionId, d); } catch (e) { a = { state: 'clear', why: `error ${e.code || e.message}` }; }
    if (!a || a.state === 'clear') {
      d.draftLookAt = 0;
      // P135: 비키지 않고 보낸 까닭도 남긴다(입력 칸을 못 읽어 그대로 보냈는지 나중에 볼 수 있게). 손대지 않는 종류와 빈 칸으로 읽은 흔한 경우는 남기지 않는다
      //   (전달 기록에 draft 이벤트가 없으면 입력 칸을 빈 칸으로 읽고 보낸 것이다)
      if (a && a.why && a.why !== 'kind' && a.why !== 'empty') this.emit('draft', { deliveryId: d.deliveryId, sessionId: d.sessionId, phase: 'clear', why: a.why, ...(a.error ? { error: a.error } : {}) });
      return true;
    }
    if (a.state === 'moved') {
      d.held = a.held; d.draftLookAt = 0;
      this.emit('draft', { deliveryId: d.deliveryId, sessionId: d.sessionId, phase: 'aside', how: a.held.how, kind: a.held.kind, chars: a.held.text.length, rows: a.held.rows || null, from: a.held.from || null, ...(a.held.key ? { key: a.held.key } : {}), ...(a.held.exact === false ? { exact: false } : {}) });
      // 비키는 동안 사람이 쳤으면 보내지 않는다(그 글과 지시가 섞인다). 비켜 둔 글을 되돌리고 사람이 멈추기를 기다린다(규칙 4)
      const v = this.view(d.sessionId, d) || {};
      if (v.lastUserInputAt && v.lastUserInputAt >= started) { await this._putBack(d); this._backToQueue(d, 'user_typing'); return false; }
      if (d.status !== 'sending') { await this._putBack(d); return false; } // 그새 취소됐다
      return true;
    }
    // keep(P139): 입력 칸을 비우지 못했다(비우기가 먹히지 않았거나 그새 칸이 바뀌었다). 지시가 사람의 글과 함께 제출되지 않게 기다리고 다시 본다
    d.draftLookAt = Date.now() + (this.cfg.draftLookMs ?? 2000);
    if (d.draftWhy !== a.why) { d.draftWhy = a.why; this.emit('draft', { deliveryId: d.deliveryId, sessionId: d.sessionId, phase: 'keep', why: a.why, chars: a.text ? a.text.length : null, ...(a.error ? { error: a.error } : {}) }); }
    this._backToQueue(d, 'draft');
    return false;
  }
  _backToQueue(d, reason) {
    if (d.status !== 'sending') return;
    if (d.reason === reason) { d.status = 'queued'; d.updatedAt = Date.now(); this.store.updateDelivery(d.deliveryId, { status: 'queued', reason }); return; }
    this._set(d, 'queued', reason);
  }
  // P128: 비켜 둔 글을 입력 칸에 되돌린다(Enter 없음). 되돌리지 못하면 그 글을 판 기록(draft 이벤트 text)에 남긴다
  async _putBack(d) {
    const held = d.held;
    if (!held) return null;
    d.held = null;
    let r;
    try { r = await this.drafts.back(d.sessionId, held, d); } catch (e) { r = { result: held.how === 'stash' ? 'stashed' : 'held', why: `error ${e.code || e.message}` }; }
    r = r || { result: 'held' };
    this.emit('draft', { deliveryId: d.deliveryId, sessionId: d.sessionId, phase: 'back', result: r.result, by: r.by || null, why: r.why || null, how: held.how, kind: held.kind, status: d.status, chars: held.text.length, ...(r.partial ? { partial: true } : {}), ...(r.result === 'restored' && !r.partial ? {} : { text: held.text }) }); // P139: 화면에 보이던 대로 되돌린 글도 판 기록에 남긴다
    if (d.status === 'confirmed' && d.reason === 'draft_moved') {
      d.reason = r.result === 'restored' ? (r.partial ? 'draft_partial' : 'draft_restored') : r.result === 'stashed' ? 'draft_stashed' : 'draft_held';
      d.updatedAt = Date.now();
      this.store.updateDelivery(d.deliveryId, { status: d.status, reason: d.reason });
      this._emit(d);
    }
    return r;
  }
  _emit(d) { this.emit('delivery', { deliveryId: d.deliveryId, sessionId: d.sessionId, status: d.status, reason: d.reason, createdAt: d.createdAt, sentAt: d.sentAt || null, confirmedAt: d.confirmedAt || null, attempts: d.attempts || 0, chars: d.text.length }); }
}
