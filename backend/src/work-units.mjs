// P180: 일 단위(work unit)와 시도(try). 하네스 0단계(docs research harness-arch.md 9·12절). 표는 store-units.mjs.
// - 일을 만드는 것: atrium child --prompt(하위로 띄울 때), 일 관계의 하위에게 가는 atrium prompt(--now가 아닐 때), 잠든 하위를 깨우며 맡긴 일(child 이름이 잠든 하위일 때).
//   동료·독립·관계없는 세션이 보낸 글, --now, 사람이 명령줄로 보낸 글은 일을 만들지 않는다.
// - 이어지는 지시: 위 세션이 자기에게서 열린 시도를 가진 하위에게 다시 보내면 새 일이 아니라 그 시도에 붙는 보통 글이다(하위의 질문에 답하는 글이 줄 서서 교착하지 않게).
// - 한 세션에 열린 시도는 하나다. 다른 위 세션의 일은 앞 시도가 done으로 닫히거나, 세션이 끝나거나, 그 시도의 턴이 done 없이 끝나 쉬게 될 때까지 판이 붙잡아 둔다.
// - 첫 요청 머리: 판 알림 줄 묶음(관계, 일, 약속) + 빈 줄 + 할 일. text.mjs promptTask가 묶음을 떼고 할 일만 카드의 지시로 보인다.
// - atrium done ok|failed "<글>": 부르는 세션의 열린 시도를 닫는다. 값과 글은 시도마다 정확히 한 번, 먼저 가져가는 길로 위 세션에 간다
//   (그 하위를 atrium wait·prompt --wait로 기다리던 기다림이 받거나, 전달 대기열로 한 번). 어느 길로 갔는지 시도(claimed_by)에 적는다.
//   대기열 것이 아직 들어가지 않았을 때 위 세션이 atrium wait를 치면 기다림이 가져가고 대기열 것은 취소한다. 들어간 뒤의 wait는 "이미 전함"을 붙여 돌려준다.
// - 머리 없이 도는 세션(옛 세션)의 동작은 그대로다. 멈춤 알림(보고 없이 쉼, L4)은 P181 unit-stops.mjs가 이 표의 stop_reason·notified_at으로 한다.
import crypto from 'node:crypto';
import { shownName } from './session-label.mjs';
import { clip, startsAsBoardNotice } from './text.mjs';
import { UnitStops } from './unit-stops.mjs'; // P181: 보고 없이 멈춤 알림

function apiError(code, message, extra = {}) { return Object.assign(new Error(message), { code }, extra); }
const newId = (p, n = 3) => p + crypto.randomBytes(n).toString('hex');
export const DONE_RESULTS = ['ok', 'failed'];
const DONE_TEXT_MAX = 100000;

// 첫 요청 머리(세 줄). 맨 위 관계 줄은 text.mjs RELATION_LINE과 같은 꼴이라 카드에는 아래 할 일만 지시로 보인다
export function unitHeader({ parent, unitId }) {
  return [
    `[Atrium 보드] 관계: 너는 @${parent}의 하위 워커다. 아래 일은 @${parent}가 맡긴 일 ${unitId}이다(지금 일 보기: \`atrium item\`).`,
    `[Atrium 보드] 끝나면 \`atrium done ok "<보고>"\`(못 했으면 \`atrium done failed "<까닭>"\`)로 닫고 쉰다. 일이 보고하라는 것은 done 글에 넣고 다른 길로 따로 보내지 않는다.`,
    '[Atrium 보드] 사람이 직접 다르게 시키면 그것을 따른다.',
  ].join('\n');
}
// 위 세션이 받는 done 글(판 알림 꼴이라 위 세션 카드의 마지막 지시가 되지 않는다)
export function doneNotice({ child, unitId, result, text, spec }) {
  return `[Atrium 보드] @${child}가 일 ${unitId}("${clip(String(spec || '').replace(/\s+/g, ' '), 60)}")을 닫았다: ${result}\n${text}`;
}
// 에이전트가 보내는 글은 판 알림 꼴로 시작할 수 없다(판 알림을 흉내 내 다른 세션의 머리·알림처럼 보이지 않게)
export function checkAgentText(text, what = '보낼 글') {
  if (startsAsBoardNotice(text)) throw apiError('board_prefix', `${what}은 보드 알림 머리("[Atrium 보드]" 등)로 시작할 수 없다. 그 머리는 보드만 붙인다. 머리를 빼고 다시 보낸다.`);
}

export class WorkUnits {
  // b: 백엔드(sessions, store, queue, linkEvent, ensureLink, log). branch: Branch(일 관계)
  constructor(b, branch, { noticeBatchMs } = {}) {
    this.b = b; this.branch = branch;
    this.waiters = new Map(); // `${위}>${하위}` → Set<{ got }>(그 하위를 기다리는 atrium wait·prompt --wait)
    this.prev = new Map(); // 세션 ID → 마지막으로 본 상태(턴 끝 판정)
    this.queued = new Set(b.store.queuedUnitSessions ? b.store.queuedUnitSessions() : []); // 판이 붙잡아 둔 일이 있는 세션
    this.onDispatch = null; // (unit, delivery, header) → 붙잡아 둔 일을 나중에 넣을 때(연결 기록)
    this.stops = new UnitStops(b, this, noticeBatchMs != null ? { batchMs: noticeBatchMs } : {}); // P181
  }
  store() { return this.b.store; }
  nameOf(id) { const s = this.b.sessions.get(id); if (s) return shownName(s) || s.name; const r = this.branch && this.branch.rowOf ? this.branch.rowOf(id) : null; return r ? r.name : '?'; }
  // 그 세션이 caller의 일 하위인가(일 관계 P156 workParentOf)
  isWorkSub(callerId, targetId) { return !!this.branch && this.branch.relIndex().workParentOf(targetId) === callerId; }

  // atrium prompt·wake --prompt가 무엇이 되는가. → { kind: 'plain' } | { kind: 'followup', tryRow, unit } | { kind: 'unit', hold }
  plan(caller, t, { now = false } = {}) {
    const st = this.store();
    const open = st.openTryOf(t.sessionId);
    const ou = open ? st.getUnit(open.unitId) : null;
    if (ou && ou.from === caller.sessionId) return { kind: 'followup', tryRow: open, unit: ou };
    if (now || !this.isWorkSub(caller.sessionId, t.sessionId)) return { kind: 'plain' };
    return { kind: 'unit', hold: !!open || st.queuedUnitsOf(t.sessionId).length > 0 };
  }
  // 일을 만든다. hold면 판이 붙잡아 두고(앞 시도가 끝나면 넣는다), 아니면 바로 머리를 붙여 대기열에 넣는다 → { unit, d, header } | { unit, held: true, ahead }
  create(caller, t, spec, origin) {
    const st = this.store();
    const hold = !!st.openTryOf(t.sessionId) || st.queuedUnitsOf(t.sessionId).length > 0;
    const unit = { id: newId('u'), from: caller.sessionId, to: t.sessionId, origin, spec: String(spec), status: 'open', createdAt: Date.now() };
    st.insertUnit(unit);
    st.addEvent(t.sessionId, 'unit_open', { unitId: unit.id, from: caller.name, origin, held: hold, chars: unit.spec.length });
    this.b.log(`unit ${unit.id} ${caller.name} → ${t.name} (${origin}${hold ? ', held' : ''})`);
    if (hold) { this.queued.add(t.sessionId); return { unit, held: true, ahead: st.queuedUnitsOf(t.sessionId).length - 1 + (st.openTryOf(t.sessionId) ? 1 : 0) }; }
    return { unit, ...this.dispatch(unit) };
  }
  // 일의 새 시도: 머리를 붙여 대기열에 넣고 시도를 적는다
  dispatch(unit, { later = false } = {}) {
    const b = this.b; const st = this.store();
    const header = unitHeader({ parent: this.nameOf(unit.from), unitId: unit.id });
    const d = b.queue.enqueue(unit.to, `${header}\n\n${unit.spec}`, { fromSession: unit.from });
    const tr = { id: newId('t', 4), unitId: unit.id, sessionId: unit.to, header: true, deliveryId: d.deliveryId, startedAt: Date.now() };
    st.insertTry(tr);
    st.addEvent(unit.to, 'unit_try', { unitId: unit.id, tryId: tr.id, deliveryId: d.deliveryId, later });
    if (!st.queuedUnitsOf(unit.to).length) this.queued.delete(unit.to);
    if (later && this.onDispatch) try { this.onDispatch(unit, d, header); } catch (e) { b.log('unit dispatch hook error', e.stack); }
    return { d, tryRow: st.getTry(tr.id), header };
  }
  // 붙잡아 둔 일을 넣을 차례인가(열린 시도가 없을 때 먼저 온 것 하나)
  pump(sessionId) {
    const st = this.store();
    if (!this.b.sessions.has(sessionId) || st.openTryOf(sessionId)) return null;
    const q = st.queuedUnitsOf(sessionId);
    if (!q.length) { this.queued.delete(sessionId); return null; }
    return this.dispatch(q[0], { later: true });
  }
  // 이어지는 지시를 그 시도에 적는다
  noteFollowup(tryRow, caller, deliveryId, { now = false } = {}) {
    this.store().addEvent(tryRow.sessionId, 'unit_followup', { unitId: tryRow.unitId, tryId: tryRow.id, from: caller.name, deliveryId, ...(now ? { now: true } : {}) });
  }

  // ---------- atrium wait가 done 값을 받는 길 ----------
  addWaiter(fromId, toId) {
    const k = `${fromId}>${toId}`;
    const w = { got: null };
    if (!this.waiters.has(k)) this.waiters.set(k, new Set());
    this.waiters.get(k).add(w);
    return w;
  }
  removeWaiter(fromId, toId, w) {
    const k = `${fromId}>${toId}`; const set = this.waiters.get(k);
    if (set) { set.delete(w); if (!set.size) this.waiters.delete(k); }
  }
  view(tr, { alreadyDelivered = false } = {}) {
    const u = this.store().getUnit(tr.unitId) || {};
    return { id: tr.unitId, tryId: tr.id, status: u.status || null, result: tr.result, text: tr.doneText, at: tr.endedAt, claimedBy: tr.claimedBy, alreadyDelivered };
  }
  // 위 세션이 atrium wait를 칠 때(기다리는 중 done이 오지 않았으면): 그 하위에게서 마지막으로 done이 닫은 시도.
  // 대기열 것이 아직 들어가지 않았으면 취소하고 기다림이 가져간다. 이미 들어갔거나 기다림이 가져갔으면 "이미 전함"
  //   after: 위 세션이 그 하위에게 마지막으로 보낸 글의 시각. 그 뒤에 닫힌 일만 본다(새 글의 턴을 기다리는데 옛 값을 붙이지 않게)
  claimForWait(caller, t, { after = 0 } = {}) {
    const b = this.b; const st = this.store();
    const tr = st.lastDoneTry(caller.sessionId, t.sessionId);
    if (!tr || (after && (tr.endedAt || 0) < after)) return null;
    if (tr.claimedBy === 'queue' && tr.noticeDeliveryId) {
      const row = st.getDelivery(tr.noticeDeliveryId);
      if (row && row.status === 'queued') {
        try {
          b.queue.cancel(tr.noticeDeliveryId);
          st.updateTry(tr.id, { claimedBy: 'wait' });
          st.addEvent(caller.sessionId, 'unit_claim', { unitId: tr.unitId, tryId: tr.id, by: 'wait', cancelled: tr.noticeDeliveryId });
          return this.view(st.getTry(tr.id));
        } catch { /* 그새 보내기 시작했다 → 이미 전함 */ }
      }
    }
    return this.view(tr, { alreadyDelivered: true });
  }

  // 기다림이 가져갔지만 그 명령이 답을 받기 전에 끊겼다: 대기열로 보낸다(값을 잃지 않게)
  requeue(tryId) {
    const b = this.b; const st = this.store();
    const tr = st.getTry(tryId); const unit = tr ? st.getUnit(tr.unitId) : null;
    if (!tr || !unit || tr.claimedBy !== 'wait' || !b.sessions.has(unit.from)) return null;
    const d = b.queue.enqueue(unit.from, doneNotice({ child: this.nameOf(unit.to), unitId: unit.id, result: tr.result, text: tr.doneText, spec: unit.spec }));
    st.updateTry(tr.id, { claimedBy: 'queue', noticeDeliveryId: d.deliveryId });
    st.addEvent(unit.from, 'unit_claim', { unitId: unit.id, tryId: tr.id, by: 'queue', why: 'wait aborted' });
    return d;
  }

  // ---------- atrium done ok|failed "<글>" ----------
  done(caller, o = {}) {
    const b = this.b; const st = this.store();
    const result = String(o.result || '');
    if (!DONE_RESULTS.includes(result)) throw apiError('bad_request', `결과는 ok 또는 failed다: ${result || '(없음)'}. 사용: atrium done ok|failed "<보고>"`);
    const text = o.text == null ? '' : String(o.text);
    if (!text.trim()) throw apiError('bad_request', '보고 글을 준다: atrium done ok|failed "<보고>"');
    if (text.length > DONE_TEXT_MAX) throw apiError('bad_request', `글이 너무 길다(${text.length}자, ${DONE_TEXT_MAX}자까지). 파일에 쓰고 그 경로를 적는다.`);
    const tr = st.openTryOf(caller.sessionId);
    if (!tr) throw apiError('no_unit', '열린 일이 없다. atrium done은 보드가 맡긴 일(첫 요청 앞에 "[Atrium 보드] … 맡긴 일 u…" 머리가 붙은 일)을 닫는다. 지금 일 보기: atrium item. 머리 없이 받은 일은 지시에 적힌 방법으로 보고한다.');
    const unit = st.getUnit(tr.unitId);
    const now = Date.now();
    st.updateTry(tr.id, { result, doneText: text, endedAt: now });
    st.updateUnit(unit.id, { status: result === 'ok' ? 'done' : 'failed', closedAt: now });
    const parent = b.sessions.get(unit.from) || null;
    const val = { result, text };
    let claimedBy, noticeDeliveryId = null;
    const ws = this.waiters.get(`${unit.from}>${unit.to}`);
    if (!parent) claimedBy = 'record';
    else if (ws && ws.size) { claimedBy = 'wait'; for (const w of ws) w.got = { ...val, tryId: tr.id }; }
    else {
      const d = b.queue.enqueue(parent.sessionId, doneNotice({ child: this.nameOf(caller.sessionId), unitId: unit.id, result, text, spec: unit.spec }));
      claimedBy = 'queue'; noticeDeliveryId = d.deliveryId;
    }
    st.updateTry(tr.id, { claimedBy, noticeDeliveryId });
    // 연결 기록: 위 → 하위 선에 보고(답)로
    const l = parent ? (st.linkByPair(unit.from, unit.to) || null) : null;
    if (l && !l.removedAt) b.linkEvent(l, 'reply', text, { via: 'atrium', verb: 'done', result, unitId: unit.id, claimedBy, ...(noticeDeliveryId ? { deliveryId: noticeDeliveryId } : {}) });
    st.addEvent(caller.sessionId, 'unit_done', { unitId: unit.id, tryId: tr.id, result, chars: text.length, claimedBy, noticeDeliveryId });
    b.log(`unit ${unit.id} done ${result} by ${caller.name} → ${parent ? parent.name : '(closed)'} via ${claimedBy}`);
    const next = this.pump(caller.sessionId);
    return { unit: unit.id, result, parent: this.nameOf(unit.from), parentOpen: !!parent, claimedBy, next: next ? { unit: next.tryRow.unitId } : null, queued: st.queuedUnitsOf(caller.sessionId).length };
  }

  // ---------- atrium item | items ----------
  item(caller) {
    const st = this.store();
    const tr = st.openTryOf(caller.sessionId);
    const queued = st.queuedUnitsOf(caller.sessionId).length;
    if (!tr) return { item: null, queued };
    const u = st.getUnit(tr.unitId);
    return { item: { id: u.id, from: this.nameOf(u.from), origin: u.origin, spec: u.spec, createdAt: u.createdAt, startedAt: tr.startedAt, tries: st.triesOfUnit(u.id).length, stopReason: tr.stopReason }, queued };
  }
  items(caller, o = {}) {
    const st = this.store();
    const limit = Math.min(Math.max(Number(o.limit) || 30, 1), 200);
    const rows = st.unitsFrom(caller.sessionId, limit).map((u) => {
      const tr = st.lastTryOfUnit(u.id);
      return { id: u.id, to: this.nameOf(u.to), status: u.status, origin: u.origin, spec: clip(u.spec.replace(/\s+/g, ' '), 120), createdAt: u.createdAt, closedAt: u.closedAt,
        queued: !tr && u.status === 'open', result: tr ? tr.result : null, text: tr && tr.doneText ? clip(tr.doneText, 1500) : null, stopReason: tr ? tr.stopReason : null, claimedBy: tr ? tr.claimedBy : null };
    });
    return { items: rows, open: rows.filter((r) => r.status === 'open').length };
  }

  // ---------- 상태 변화(L4 자리) ----------
  // 그 시도의 턴이 done 없이 끝나 쉬면 stop_reason을 적는다. 자기 아래에 열린 일이 있으면 하위를 기다리는 것이라 적지 않는다.
  // 붙잡아 둔 다른 일이 있으면 이 시도를 끝내고(일은 열린 채) 다음 일을 넣는다.
  // P181: 멈춤(보고 없이 쉼, 오류, 사람이 필요함)을 상위에게 한 번 알린다(unit-stops.mjs)
  onSession(s, sum) {
    const sid = s.sessionId; const st = this.store();
    const prev = this.prev.get(sid);
    this.prev.set(sid, sum.state);
    const tr = prev !== sum.state ? st.openTryOf(sid) : null;
    const why = this.stops.onState(s, sum, prev, tr);
    if (why) {
      st.updateTry(tr.id, { stopReason: why });
      st.addEvent(sid, 'unit_stop', { unitId: tr.unitId, tryId: tr.id, why });
      if (why !== 'needs_human' && this.queued.has(sid)) { st.updateTry(tr.id, { endedAt: Date.now() }); this.pump(sid); }
    }
    if (this.queued.has(sid) && (sum.state === 'ready' || sum.state === 'sleeping')) this.pump(sid); // 백엔드가 다시 뜬 뒤 등
  }
  // 세션이 끝났다: 열린 시도는 closed로 끝나고 그 일과 붙잡아 둔 일은 취소된다.
  // P181: 상위에게 멈춤(closed)을 알린다(위 세션의 child-kill이면 알리지 않는다) → 알림을 건 상위 ID | null
  onClosed(s, { reason = null, byParent = false } = {}) {
    const st = this.store(); const now = Date.now();
    const tr = st.openTryOf(s.sessionId);
    const unit = tr ? st.getUnit(tr.unitId) : null;
    if (tr) { st.updateTry(tr.id, { endedAt: now, stopReason: 'closed' }); st.updateUnit(tr.unitId, { status: 'cancelled', closedAt: now }); }
    for (const u of st.queuedUnitsOf(s.sessionId)) st.updateUnit(u.id, { status: 'cancelled', closedAt: now });
    this.queued.delete(s.sessionId);
    this.prev.delete(s.sessionId);
    return this.stops.onClosed(s, tr, unit, reason, { byParent });
  }
}
