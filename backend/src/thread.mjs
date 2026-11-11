// I2 명령 바 대화 기록(Thread, P6b, ARCH 4절 I2): 명령 바에서 보낸 글과 결과를 시간순으로 남긴다.
// - 한 줄(item)은 보낸 글 하나다. 대상 세션마다 결과(result)가 하나씩 붙는다: 전달 상태(B1), 완료 보고.
// - 완료 보고는 받는 쪽의 마지막 답을 최대 4,000자까지 쓴다(참고 제품과 같다). 제출된 뒤 그 세션의 턴이 끝나면(ready, error) 붙인다.
// - 기다리다 버려진 전달(15분, `failed` + `timeout (…)`)도 남는다(abandoned). 최근 500개만 둔다.
// - 루프(I5)가 보낸 지시도 여기에 남는다(source `loop`, loopId).
// 순수 함수(결과·줄의 단계, 보고 글)와 백엔드에 붙는 ThreadLog가 있다.

export const THREAD_KEEP = 500;
export const REPORT_CHARS = 4000;
export const SOURCES = new Set(['bar', 'output', 'loop', 'atrium', 'mtask']); // mtask는 옛 CLI 이름(P18 전 기록)

// 결과 하나의 단계: delivering(대기열·보내는 중·보냄) → running(제출됨, 턴 도는 중) → done(보고 있음) | failed | abandoned | cancelled
export function resultPhase(r) {
  if (r.report) return 'done';
  if (r.status === 'failed') return /^timeout/.test(r.reason || '') ? 'abandoned' : 'failed';
  if (r.status === 'cancelled') return 'cancelled';
  if (r.status === 'confirmed' || r.status === 'unconfirmed') return 'running';
  return 'delivering';
}
// 줄 전체: 아직 도는 결과가 있으면 active, 모두 보고가 있으면 done, 보고 없이 끝난 것이 섞이면 partial, 하나도 보고가 없으면 failed
export function itemPhase(results) {
  const ph = results.map(resultPhase);
  if (!ph.length) return 'failed';
  if (ph.some((p) => p === 'delivering' || p === 'running')) return 'active';
  if (ph.every((p) => p === 'done')) return 'done';
  return ph.some((p) => p === 'done') ? 'partial' : 'failed';
}
// 완료 보고 글: 마지막 답 최대 4,000자. 오류로 끝났으면 오류 종류
export function reportOf({ state, lastAnswer, error, answerSource }, limit = REPORT_CHARS) {
  let text = state === 'error' ? `오류: ${(error && (error.type || error.message)) || 'unknown'}${lastAnswer ? `\n\n${lastAnswer}` : ''}` : lastAnswer || '';
  const clipped = text.length > limit;
  if (clipped) text = text.slice(0, limit);
  return { text, clipped, state, source: answerSource || null };
}
// 이 턴이 그 전달로 시작된 턴인가: 턴 시작이 보낸 시각(확인 시각) 뒤이고 끝났다
export function turnAnswers(result, turn) {
  if (!turn || !turn.startedAt || !turn.endedAt || turn.endedAt < turn.startedAt) return false;
  const from = result.sentAt || result.confirmedAt;
  return !!from && turn.startedAt >= from - 2000 && turn.endedAt >= from;
}

// ctx: { store, broadcast(event, data), runtimeOf(sessionId) → { state, turn, lastAnswer, error, answerSource } | null }
export class ThreadLog {
  constructor(ctx, { keep = THREAD_KEEP } = {}) {
    this.ctx = ctx; this.keep = keep;
    this.open = new Set(); // 완료 보고를 기다리는 결과가 있는 세션
    this.answeredAt = new Map(); // 같은 끝난 턴을 두 결과에 쓰지 않는다(재시작 때도 복원)
    for (const it of ctx.store.threadItems({ limit: keep })) for (const r of ctx.store.threadResults(it.itemId)) {
      if (!r.report && r.status !== 'failed' && r.status !== 'cancelled') this.open.add(r.sessionId);
      if (r.report && (r.report.state === 'ready' || r.report.state === 'error')) this.answeredAt.set(r.sessionId, Math.max(this.answeredAt.get(r.sessionId) || 0, r.report.at));
    }
  }

  view(it) {
    const results = this.ctx.store.threadResults(it.itemId).map((r) => ({ ...r, phase: resultPhase(r) }));
    return { ...it, results, phase: itemPhase(results) };
  }
  emit(itemId) { const it = this.ctx.store.getThreadItem(itemId); if (it) this.ctx.broadcast('thread.item', this.view(it)); }

  // 보낸 글 하나를 남긴다. deliveries: [{ deliveryId, sessionId, name, status }]
  add({ source = 'bar', text, targets = [], deliveries = [], loopId = null, t = Date.now() }) {
    const itemId = 't' + t.toString(36) + Math.random().toString(36).slice(2, 7);
    const st = this.ctx.store;
    st.insertThreadItem({ itemId, t, source: SOURCES.has(source) ? source : 'bar', text: String(text), targets, loopId });
    for (const d of deliveries) st.insertThreadResult({ deliveryId: d.deliveryId, itemId, sessionId: d.sessionId, name: d.name, status: d.status || 'queued' });
    if (st.threadCount() > this.keep) st.pruneThread(this.keep);
    this.emit(itemId);
    return this.view(st.getThreadItem(itemId));
  }

  // 전달 대기열의 상태 바뀜(B1). Thread에 없는 전달(연결 알림, 첫 지시 등)은 무시한다
  onDelivery(d) {
    const st = this.ctx.store;
    const r = st.getThreadResult(d.deliveryId);
    if (!r) return;
    st.updateThreadResult(d.deliveryId, { status: d.status, reason: d.reason, sentAt: d.sentAt, confirmedAt: d.confirmedAt });
    if (d.status === 'confirmed' || d.status === 'unconfirmed' || d.status === 'sent') this.open.add(r.sessionId);
    st.touchThreadItem(r.itemId);
    this.emit(r.itemId);
    if (d.status === 'confirmed' || d.status === 'unconfirmed') this.check(r.sessionId);
  }

  // 세션이 바뀔 때마다 부른다. 제출된 결과에 끝난 턴의 답을 보고로 붙인다
  check(sessionId) {
    if (!this.open.has(sessionId)) return;
    const st = this.ctx.store;
    const open = st.openThreadResults(sessionId);
    if (!open.length) { this.open.delete(sessionId); return; }
    const rt = this.ctx.runtimeOf(sessionId);
    if (!rt) return;
    for (const r of open) {
      if (r.status === 'sent') continue; // 아직 제출 확인 전
      if (rt.state === 'exited') { st.setThreadReport(r.deliveryId, { text: '', at: Date.now(), state: 'exited', source: null }); st.touchThreadItem(r.itemId); this.emit(r.itemId); continue; }
      if ((rt.state !== 'ready' && rt.state !== 'error') || !turnAnswers(r, rt.turn)) continue;
      if (rt.turn.endedAt <= (this.answeredAt.get(sessionId) || 0)) continue;
      st.setThreadReport(r.deliveryId, { ...reportOf(rt), at: rt.turn.endedAt });
      this.answeredAt.set(sessionId, rt.turn.endedAt);
      st.touchThreadItem(r.itemId);
      this.emit(r.itemId);
      break; // 한 턴은 한 전달에만 붙인다(세션마다 하나씩 보내므로 먼저 보낸 것)
    }
  }
  // 세션이 판에서 빠졌다: 기다리던 보고를 "닫힘"으로 끝낸다
  onClosed(sessionId) {
    const st = this.ctx.store;
    for (const r of st.openThreadResults(sessionId)) { st.setThreadReport(r.deliveryId, { text: '', at: Date.now(), state: 'closed', source: null }); this.emit(r.itemId); }
    this.open.delete(sessionId);
  }

  // thread.list { before?, limit } → 시간순 items, 더 앞의 것이 있으면 more
  list({ before = null, limit = 50 } = {}) {
    const n = Math.max(1, Math.min(500, Math.trunc(Number(limit)) || 50));
    const items = this.ctx.store.threadItems({ before: before == null ? null : Number(before), limit: n + 1 });
    const more = items.length > n;
    const page = more ? items.slice(1) : items;
    return { items: page.map((it) => this.view(it)), more, before: page.length ? page[0].seq : null };
  }
}
