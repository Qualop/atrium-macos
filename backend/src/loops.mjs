// I5 루프(P6b, ARCH 4절 I5): 같은 지시를 조건에 따라 다시 보낸다.
// - 시작 조건(trigger): interval(1분~24시간 주기), idle(에이전트가 ready가 될 때), text(마지막 답이나 화면에 특정 글이 나올 때)
// - 멈춤 조건(stop): maxRuns(보낸 차례 수), maxMs(돈 시간), untilText(마지막 답에 특정 글 = 목표 달성), 그리고 사람(loop.pause, loop.delete)
// - 내 차례(waiting, trust_wait)인 세션은 그 차례를 건너뛴다. 대기열에서 내 차례를 만나 기다리는 루프 전달도 취소하고 건너뛴 것으로 센다.
// - 전달은 전달 대기열(B1 규칙)로 한다. 그룹 대상은 그룹 전달이라 동시 실행 상한을 지킨다. 셸에는 걸 수 없다.
// - 백엔드가 꺼지면 루프도 멈춘다. 다시 뜨면 남은 횟수와 시간으로 이어 간다: 돈 시간(elapsedMs)은 백엔드가 돌고 루프가 켜져 있을 때만 세고,
//   다음 차례(nextAt)는 꺼져 있던 시간만큼 뒤로 민다.
// - 토큰을 쓰므로 만들 때 확인을 받는다(confirm). 루프가 보낸 지시는 Thread에 남는다(source loop).
// 순수 함수(조건 풀기, 차례 판정, 멈춤 판정)와 시계를 받는 LoopEngine이 있다. 시험은 시계를 흉내 낸다(backend/test/p6b.test.mjs).
import crypto from 'node:crypto';
import { m } from './msg.mjs'; // P16: 화면 글 열쇠

export const LOOP = { minEveryMs: 60_000, maxEveryMs: 24 * 3600_000, minGapMs: 5000, screenPollMs: 5000, saveMs: 5000, historyKeep: 50, maxPrompt: 20000, maxText: 200 };
const NEEDS_YOU = new Set(['waiting', 'trust_wait']);
const OPEN_DELIVERY = new Set(['queued', 'sending', 'sent']);
const bad = (m) => Object.assign(new Error(m), { code: 'bad_request' });

// '90s', '1m', '1.5h', '1d', 숫자(ms)
export function parseDuration(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h|d)?$/i);
  if (!m) return null;
  const unit = (m[2] || 'ms').toLowerCase();
  const mul = { ms: 1, s: 1000, sec: 1000, m: 60_000, min: 60_000, h: 3600_000, d: 86400_000 }[unit];
  return Math.round(Number(m[1]) * mul);
}
function textCond(t) { const s = String(t ?? '').trim(); if (!s || s.length > LOOP.maxText) throw bad(`찾을 글은 1~${LOOP.maxText}자`); return s; }

// 시작 조건 풀기. { type: 'interval', every | everyMs, immediate? } | { type: 'idle' } | { type: 'text', text, source?: answer|screen|any, immediate? }
export function normalizeTrigger(t) {
  if (!t || typeof t !== 'object') throw bad('trigger가 필요하다(interval, idle, text)');
  if (t.type === 'interval') {
    const everyMs = parseDuration(t.everyMs ?? t.every);
    if (!everyMs || everyMs < LOOP.minEveryMs || everyMs > LOOP.maxEveryMs) throw bad('주기는 1분~24시간');
    return { type: 'interval', everyMs, immediate: t.immediate !== false };
  }
  if (t.type === 'idle') return { type: 'idle' };
  if (t.type === 'text') {
    const source = t.source || 'answer';
    if (!['answer', 'screen', 'any'].includes(source)) throw bad('text 조건의 source는 answer, screen, any');
    return { type: 'text', text: textCond(t.text), source, immediate: !!t.immediate };
  }
  throw bad(`모르는 시작 조건: ${t.type}`);
}
// 멈춤 조건 풀기. 모두 없어도 된다(사람이 멈출 때까지)
export function normalizeStop(s = {}) {
  const out = {};
  if (s.maxRuns != null) { const n = Math.trunc(Number(s.maxRuns)); if (!(n >= 1 && n <= 10000)) throw bad('maxRuns는 1~10000'); out.maxRuns = n; }
  const ms = parseDuration(s.maxMs ?? s.maxTime);
  if (s.maxMs != null || s.maxTime != null) { if (!ms || ms < 1000 || ms > 30 * 86400_000) throw bad('maxMs는 1초~30일'); out.maxMs = ms; }
  if (s.untilText != null && s.untilText !== '') out.untilText = textCond(s.untilText);
  return out;
}
export function describeLoop({ targetLabel, prompt, trigger, stop }) {
  const every = (ms) => (ms % 3600_000 === 0 ? `${ms / 3600_000}시간` : ms % 60_000 === 0 ? `${ms / 60_000}분` : `${Math.round(ms / 1000)}초`);
  const when = trigger.type === 'interval' ? `${every(trigger.everyMs)}마다${trigger.immediate ? '(지금 한 번 먼저)' : ''}` : trigger.type === 'idle' ? '에이전트가 쉴 때(ready가 될 때)마다' : `${trigger.source === 'screen' ? '화면' : trigger.source === 'any' ? '마지막 답이나 화면' : '마지막 답'}에 "${trigger.text}"가 나올 때마다`;
  const stops = [stop.maxRuns && `${stop.maxRuns}번 보내면`, stop.maxMs && `${every(stop.maxMs)} 지나면`, stop.untilText && `마지막 답에 "${stop.untilText}"가 나오면`].filter(Boolean);
  return `${targetLabel}에 "${String(prompt).replace(/\s+/g, ' ').slice(0, 60)}"를 ${when} 보낸다. 멈춤: ${stops.length ? stops.join(', ') : '사람이 멈출 때까지'}(언제든 멈출 수 있다). 루프가 보낼 때마다 토큰을 쓴다. 내 차례인 세션은 그 차례를 건너뛴다.`;
}

// P16: 같은 확인 문구를 화면 글 열쇠로(창이 사전으로 번역한다, msg.mjs)
export function describeLoopMsg({ target, prompt, trigger, stop }) {
  const every = (ms) => (ms % 3600_000 === 0 ? m('dur.h', { n: ms / 3600_000 }) : ms % 60_000 === 0 ? m('dur.m', { n: ms / 60_000 }) : m('dur.s', { n: Math.round(ms / 1000) }));
  const when = trigger.type === 'interval' ? m(trigger.immediate ? 'loopEveryNow' : 'loopEvery', { every: every(trigger.everyMs) })
    : trigger.type === 'idle' ? m('loopIdle') : m('loopText', { where: m(trigger.source === 'screen' ? 'loopSrcScreen' : trigger.source === 'any' ? 'loopSrcAny' : 'loopSrcAnswer'), text: trigger.text });
  const stops = [stop.maxRuns && m('loopStopRuns', { n: stop.maxRuns }), stop.maxMs && m('loopStopTime', { every: every(stop.maxMs) }), stop.untilText && m('loopStopText', { text: stop.untilText })].filter(Boolean);
  return m('loopConfirm', { target, prompt: String(prompt).replace(/\s+/g, ' ').slice(0, 60), when, stops: stops.length ? stops : m('loopStopManual') });
}

// 멈춤 판정(루프 전체). 멈추면 이유를 돌려준다
export function stopReason(loop, now) {
  const s = loop.stop || {};
  if (s.maxRuns && loop.runs >= s.maxRuns) return 'max_runs';
  if (s.maxMs && loop.elapsedMs >= s.maxMs) return 'max_time';
  return null;
}
// 목표 글: 루프가 보낸 뒤 끝난 턴의 마지막 답에 untilText가 있으면 목표 달성
export function goalReached(loop, t) {
  const u = loop.stop && loop.stop.untilText;
  if (!u || !t || !t.lastAnswer || !loop.lastRunAt) return false;
  if (t.delivery && t.delivery.status !== 'confirmed' && t.delivery.status !== 'unconfirmed') return false;
  return (t.lastAnswerAt || 0) > loop.lastRunAt && t.lastAnswer.includes(u);
}

// 세션 하나에 대해 이번에 보낼지 정한다(순수 함수).
// t: { sessionId, kind, state, turnEndedAt, lastAnswer, lastAnswerAt, screenHas, delivery: { status, reason } | null }
// per: 이 세션의 루프 상태 { lastRunAt, firedTurnEnd, answerAtSeen, screenSeen }
// → { action: 'fire' } | { action: 'skip', reason } | { action: 'wait', reason } | { action: 'none' }. seen에 이번에 본 값(per에 합칠 것)
export function decideTarget(loop, per, t, now, { due = false } = {}) {
  const seen = {};
  if (!t || t.closed) return { action: 'none', reason: 'closed', seen };
  if (t.kind === 'shell') return { action: due ? 'skip' : 'none', reason: 'shell', seen };
  const open = t.delivery && OPEN_DELIVERY.has(t.delivery.status);
  const needsYou = NEEDS_YOU.has(t.state);
  const notReady = t.state === 'starting' || t.state === 'exited';
  const tr = loop.trigger;
  if (tr.type === 'interval') {
    if (!due) return { action: 'none', seen };
    if (open) return { action: 'skip', reason: 'busy', seen }; // 앞 차례의 전달이 아직 대기열에 있다
    if (needsYou) return { action: 'skip', reason: 'needs_you', seen };
    if (notReady) return { action: 'skip', reason: 'not_ready', seen };
    return { action: 'fire', seen };
  }
  if (open) return { action: 'wait', reason: 'busy', seen };
  if (per.lastRunAt && now - per.lastRunAt < LOOP.minGapMs) return { action: 'wait', reason: 'gap', seen };
  if (tr.type === 'idle') {
    if (t.state !== 'ready' && t.state !== 'sleeping') return { action: 'none', seen }; // P21: 잠든 세션도 쉬는 중이다(보내면 깨운다)
    const fresh = per.firedTurnEnd === undefined || (t.turnEndedAt || 0) > (per.firedTurnEnd || 0);
    return fresh ? { action: 'fire', seen } : { action: 'none', seen };
  }
  // text: 새로 끝난 답에 글이 있거나, 화면에 글이 새로 나타났다
  let hit = false;
  if (tr.source !== 'screen' && t.lastAnswerAt && t.lastAnswerAt > (per.answerAtSeen || 0)) {
    seen.answerAtSeen = t.lastAnswerAt;
    if (t.lastAnswer && t.lastAnswer.includes(tr.text)) hit = true;
  }
  if (tr.source !== 'answer' && t.screenHas != null) {
    if (t.screenHas && !per.screenSeen) hit = true;
    seen.screenSeen = !!t.screenHas;
  }
  if (!hit) return { action: 'none', seen };
  if (needsYou) return { action: 'skip', reason: 'needs_you', seen };
  if (notReady) return { action: 'skip', reason: 'not_ready', seen };
  return { action: 'fire', seen };
}

// ctx: {
//   store, now(), broadcast(event, data), log(msg),
//   targetsOf(loop) → [t…] (위 decideTarget의 t, name 포함) | null(대상이 없어짐: 세션이 닫힘),
//   enqueue(sessionId, text) → delivery, deliveryOf(id) → { status, reason } | null, cancel(id),
//   readScreen(sessionId) → Promise<string>, thread({ text, targets, deliveries, loopId }), canRun() → herdr에 붙어 있는가,
// }
export class LoopEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.loops = new Map();
    for (const l of ctx.store.loops()) this.loops.set(l.loopId, l);
  }
  now() { return this.ctx.now ? this.ctx.now() : Date.now(); }

  // 백엔드가 뜰 때: 켜져 있던 루프의 다음 차례를 꺼져 있던 시간만큼 민다(남은 시간으로 이어 가기)
  start({ timers = true } = {}) {
    this.stopped = false;
    const now = this.now();
    const aliveAt = this.ctx.store.getMeta('loopsAliveAt');
    const down = aliveAt ? Math.max(0, now - aliveAt) : 0;
    for (const l of this.loops.values()) {
      if (l.status !== 'active') continue;
      if (l.nextAt && down) l.nextAt += down;
      this.record(l, 'resumed_after_restart', { downMs: down });
      this.ctx.store.saveLoop(l);
    }
    this.lastTick = now;
    this.ctx.store.setMeta('loopsAliveAt', now);
    if (timers) {
      this.timer = setInterval(() => { try { this.tick(); } catch (e) { this.ctx.log && this.ctx.log('loop tick error ' + e.stack); } }, 1000);
      this.screenTimer = setInterval(() => this.pollScreens().catch(() => {}), LOOP.screenPollMs);
    }
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer); clearInterval(this.screenTimer);
    this.tickTime(this.now());
    for (const l of this.loops.values()) this.ctx.store.saveLoop(l);
    this.ctx.store.setMeta('loopsAliveAt', this.now());
  }

  view(l) {
    const targets = this.ctx.targetsOf(l) || [];
    return { ...l, targetName: l.targetName || null, targets: targets.map((t) => ({ sessionId: t.sessionId, name: t.name, state: t.state })), nextInMs: l.status === 'active' && l.nextAt ? Math.max(0, l.nextAt - this.now()) : null, history: (l.history || []).slice(-20) };
  }
  emit(l) { this.ctx.broadcast('loop.updated', this.view(l)); }
  record(l, kind, data = {}) {
    l.history = [...(l.history || []), { t: this.now(), kind, ...data }].slice(-LOOP.historyKeep);
  }
  find(ref) { const l = ref && this.loops.get(String(ref)); if (!l) throw Object.assign(new Error(`없는 루프: ${ref}`), { code: 'not_found' }); return l; }

  // loop.create. 대상 확인(셸 거부)은 부르는 쪽(features.mjs)이 하고 target: { kind: 'session', id, name }를 넘긴다(P22에서 그룹 대상을 뺐다)
  create({ target, prompt, trigger, stop }) {
    const now = this.now();
    this.tickTime(now); // 새 루프가 생기기 전 시간은 기존 루프에만 센다
    const text = String(prompt ?? '').replace(/\r\n?/g, '\n');
    if (!text.trim() || text.length > LOOP.maxPrompt) throw bad(`지시는 1~${LOOP.maxPrompt}자`);
    const l = {
      loopId: 'r' + crypto.randomBytes(5).toString('hex'), target: { kind: target.kind, id: target.id }, targetName: target.name, prompt: text,
      trigger: normalizeTrigger(trigger), stop: normalizeStop(stop || {}), status: 'active', runs: 0, skips: 0, elapsedMs: 0,
      nextAt: null, lastRunAt: null, stopReason: null, per: {}, history: [], createdAt: now,
    };
    if (l.trigger.type === 'interval') l.nextAt = l.trigger.immediate ? now : now + l.trigger.everyMs;
    // 글 조건은 만든 뒤에 새로 나온 답과 화면만 본다(immediate면 지금 것도 본다)
    if (l.trigger.type === 'text' && !l.trigger.immediate) for (const t of this.ctx.targetsOf(l) || []) l.per[t.sessionId] = { answerAtSeen: t.lastAnswerAt || 0, ...(t.screenHas == null ? {} : { screenSeen: !!t.screenHas }) };
    this.record(l, 'created');
    this.ctx.store.insertLoop(l);
    this.ctx.store.saveLoop(l);
    this.loops.set(l.loopId, l);
    this.emit(l);
    setImmediate(() => { try { this.tick(); } catch {} });
    return this.view(l);
  }
  // 사람이 멈춤. 아직 대기열에 있는 루프 전달은 취소한다. 주기 루프는 남은 시간을 기억했다가 이어 간다
  pause(ref) {
    const l = this.find(ref);
    if (l.status !== 'active') throw Object.assign(new Error(`켜져 있지 않은 루프: ${l.status}`), { code: 'not_active' });
    this.tickTime(this.now());
    l.status = 'paused';
    this.cancelOpen(l, 'loop paused');
    this.record(l, 'paused', { by: 'user', nextInMs: l.nextAt ? Math.max(0, l.nextAt - this.now()) : null }); // 이어 갈 때 남은 시간(기록에 남겨 다시 띄워도 안다)
    this.save(l);
    return this.view(l);
  }
  resume(ref) {
    const l = this.find(ref);
    if (l.status !== 'paused') throw Object.assign(new Error(`멈춘 루프만 이어 간다: ${l.status}`), { code: 'not_paused' });
    this.tickTime(this.now()); // 아직 paused인 동안의 시간을 먼저 정산한다
    l.status = 'active';
    const paused = [...(l.history || [])].reverse().find((h) => h.kind === 'paused');
    if (l.trigger.type === 'interval') l.nextAt = this.now() + ((paused && paused.nextInMs) ?? 0);
    this.record(l, 'resumed', { by: 'user' });
    this.save(l);
    setImmediate(() => { try { this.tick(); } catch {} });
    return this.view(l);
  }
  delete(ref) {
    const l = this.find(ref);
    this.cancelOpen(l, 'loop deleted');
    this.loops.delete(l.loopId);
    this.ctx.store.deleteLoop(l.loopId);
    this.ctx.broadcast('loop.removed', { loopId: l.loopId });
    return { deleted: true, loopId: l.loopId };
  }
  list({ sessionId = null } = {}) {
    return [...this.loops.values()].filter((l) => !sessionId || (l.target.kind === 'session' && l.target.id === sessionId) || (this.ctx.targetsOf(l) || []).some((t) => t.sessionId === sessionId)).map((l) => this.view(l));
  }
  // 이 세션을 대상으로 켜져 있는 루프 수(노드 배지)
  activeCount(sessionId) { let n = 0; for (const l of this.loops.values()) if (l.status === 'active' && (this.ctx.targetsOf(l) || []).some((t) => t.sessionId === sessionId)) n++; return n; }

  save(l) { this.ctx.store.saveLoop(l); this.emit(l); }
  // 다 보낸 횟수로 끝나면 마지막 전달은 그대로 간다. 그 밖의 이유로 끝나면 아직 대기열에 있는 루프 전달을 취소한다
  finish(l, status, reason) {
    l.status = status; l.stopReason = reason; l.nextAt = null;
    if (reason !== 'max_runs') this.cancelOpen(l, `loop ${reason}`);
    this.record(l, 'stopped', { reason });
    this.save(l);
    this.ctx.log && this.ctx.log(`loop ${l.loopId} ${status}: ${reason}`);
  }
  cancelOpen(l, why) {
    for (const per of Object.values(l.per || {})) {
      if (!per.deliveryId) continue;
      const d = this.ctx.deliveryOf(per.deliveryId);
      if (d && d.status === 'queued') {
        try {
          this.ctx.cancel(per.deliveryId);
          // 취소된 지시는 턴을 시작하지 않았다. 재개 시 같은 ready 상태도 다시 보낼 수 있다.
          if (l.trigger.type === 'idle') delete per.firedTurnEnd;
        } catch {}
      }
    }
  }
  tickTime(now) {
    const dt = Math.max(0, now - (this.lastTick ?? now));
    this.lastTick = now;
    for (const l of this.loops.values()) if (l.status === 'active') l.elapsedMs += dt;
  }

  // 1초마다(또는 세션이 바뀔 때). 멈춤 조건 → 내 차례에 막힌 전달 정리 → 차례 판정 → 보내기
  tick(now = this.now()) {
    if (this.stopped) return;
    this.tickTime(now);
    const canRun = !this.ctx.canRun || this.ctx.canRun();
    for (const l of [...this.loops.values()]) {
      if (l.status !== 'active') continue;
      const targets = this.ctx.targetsOf(l);
      if (!targets) { this.finish(l, 'stopped', 'session_closed'); continue; }
      let changed = false;
      // 대기열에서 내 차례를 만나 기다리는 루프 전달은 그 차례를 건너뛴다
      for (const t of targets) {
        const per = l.per[t.sessionId];
        if (t.delivery && t.delivery.status === 'queued' && NEEDS_YOU.has(t.delivery.reason)) {
          try { this.ctx.cancel(per.deliveryId); } catch {}
          l.skips++; this.record(l, 'skip', { sessionId: t.sessionId, name: t.name, reason: 'needs_you', deliveryId: per.deliveryId }); changed = true;
          t.delivery = { status: 'cancelled' };
        }
      }
      if (targets.some((t) => goalReached(l, t))) { this.finish(l, 'done', 'goal_text'); continue; }
      const sr = stopReason(l, now);
      if (sr) { this.finish(l, 'done', sr); continue; }
      if (!canRun) { if (changed) this.save(l); continue; } // 연결 없이도 멈춤·취소·시간 저장은 한다
      const due = l.trigger.type === 'interval' && l.nextAt != null && now >= l.nextAt;
      const fire = [];
      const skipped = [];
      for (const t of targets) {
        const per = (l.per[t.sessionId] ||= {});
        const d = decideTarget(l, per, t, now, { due });
        if (Object.keys(d.seen).length) { Object.assign(per, d.seen); changed = true; }
        if (d.action === 'fire') fire.push(t);
        else if (d.action === 'skip') skipped.push({ t, reason: d.reason });
      }
      if (due) {
        l.nextAt = now + l.trigger.everyMs;
        changed = true;
        if (!fire.length) { l.skips++; this.record(l, 'skip', { reason: skipped.length ? skipped.map((x) => `${x.t.name}:${x.reason}`).join(',') : 'no_targets' }); }
        else for (const x of skipped) this.record(l, 'skip', { sessionId: x.t.sessionId, name: x.t.name, reason: x.reason });
      } else for (const x of skipped) { l.skips++; this.record(l, 'skip', { sessionId: x.t.sessionId, name: x.t.name, reason: x.reason }); changed = true; }
      if (fire.length) {
        // 주기 루프는 대상 모두에게 한 차례. 쉴 때·글 조건은 세션마다 한 차례
        const rounds = l.trigger.type === 'interval' ? [fire] : fire.map((t) => [t]);
        for (const round of rounds) {
          if (l.stop.maxRuns && l.runs >= l.stop.maxRuns) break;
          this.run(l, round, now);
        }
        changed = true;
        const after = stopReason(l, now);
        if (after === 'max_runs') { this.finish(l, 'done', after); continue; }
      }
      if (changed) this.save(l);
    }
    if (!this.lastSave || now - this.lastSave >= LOOP.saveMs) {
      this.lastSave = now;
      for (const l of this.loops.values()) if (l.status === 'active') this.ctx.store.saveLoop(l);
      this.ctx.store.setMeta('loopsAliveAt', now);
    }
  }

  run(l, round, now) {
    const deliveries = [];
    for (const t of round) {
      const d = this.ctx.enqueue(t.sessionId, l.prompt);
      const per = (l.per[t.sessionId] ||= {});
      per.deliveryId = d.deliveryId; per.lastRunAt = now; per.firedTurnEnd = t.turnEndedAt || 0;
      deliveries.push({ deliveryId: d.deliveryId, sessionId: t.sessionId, name: t.name, status: d.status });
    }
    l.runs++; l.lastRunAt = now;
    this.record(l, 'run', { n: l.runs, sessions: round.map((t) => t.name), deliveries: deliveries.map((d) => d.deliveryId) });
    this.ctx.thread({ text: l.prompt, targets: round.map((t) => `@${t.name}`), deliveries, loopId: l.loopId });
  }

  // 화면 글 조건: 대상 화면에 글이 있는지 읽어 둔다(decideTarget의 screenHas)
  async pollScreens() {
    if (this.stopped) return;
    for (const l of [...this.loops.values()]) {
      if (l.status !== 'active' || l.trigger.type !== 'text' || l.trigger.source === 'answer') continue;
      for (const t of this.ctx.targetsOf(l) || []) {
        if (t.kind === 'shell') continue;
        const text = await this.ctx.readScreen(t.sessionId).catch(() => null);
        if (text == null) continue;
        if (this.stopped || !this.loops.has(l.loopId) || l.status !== 'active') continue;
        const per = (l.per[t.sessionId] ||= {});
        if (!l.trigger.immediate && per.screenSeen === undefined) per.screenSeen = text.includes(l.trigger.text);
        (this.screen ||= new Map()).set(`${l.loopId}|${t.sessionId}`, text.includes(l.trigger.text));
      }
    }
  }
  screenHas(loopId, sessionId) { const v = this.screen && this.screen.get(`${loopId}|${sessionId}`); return v === undefined ? null : v; }
}
