// P181: 보고 없이 멈춘 하위를 상위에게 한 번 알리기(하네스 0단계 L4, docs research harness-arch.md 3·9·12절).
// - 대상: 첫 요청 머리를 받은 열린 시도(unit_tries.header, 그 첫 요청이 들어감 confirmed). 머리 없이 도는 세션은 알리지 않는다(상위에 새 턴이 생기지 않게).
// - 받는 쪽: 그 일을 맡긴 세션(work_units.from, 일 관계의 상위).
// - 까닭(unit_tries.stop_reason과 같다): idle_no_done(done 없이 턴을 끝내고 쉼), turn_error(오류로 턴이 끝남),
//   needs_human(승인·신뢰 질문 등 사람의 답을 기다림: waiting·trust_wait), closed(세션이 닫힘). 멈출 때마다 한 번.
// - 하위를 기다리며 쉬는 중간 워커(자기가 맡긴 열린 일이 있다)는 idle_no_done을 알리지 않는다. 대신 나무 전체(push-cycle cycleCheck)가
//   쉬는데 열린 시도가 남았으면 그 나무의 맨 위 일의 상위에게 한 번 알린다(tree_quiet). 나무에 다시 움직임이 생기면 다음 쉼에 다시 알린다.
// - 같은 상위로 가는 알림은 묶는다(link-notice NoticeBatcher). 보내기 전에 done이 왔거나 다시 일하기 시작했으면 그 줄은 보내지 않는다.
// - 그 하위를 atrium wait·prompt --wait로 기다리는 상위에게는 보내지 않는다(기다림이 멈춤을 돌려준다).
// - P281: 받는 쪽이 할 일이 없는 idle_no_done은 알리지 않는다(판 알림 하나가 상위의 턴 하나다). 시도의 stop_reason은 그대로 적고
//   하위 세션 이벤트 unit_stop_quiet { unitId, tryId, why, because }를 남긴다.
//   · asked_parent: 그 턴에 하위가 마지막으로 낸 판 명령(/branch/* 요청, 상태 줄의 usage-report는 빼고)이 그 일을 맡긴 세션(work_units.from)에게
//     보낸 atrium prompt(대기열·스티어링)다. 턴의 시작은 판이 본 쉼(ready·error·sleeping 등) → working 바뀜의 시각(사람의 답을 기다렸다 돌아온 것은
//     새 턴이 아니다). 백엔드가 다시 떠 시작 시각이나 명령을 모르면 알린다.
//   · repeat: 같은 시도에 idle_no_done 알림을 이미 보냈고, 그 뒤로 상위가 하위에게 보낸 새 글(deliveries.from_session = 상위)이 없다.
//     사람이나 다른 세션이 깨워 다시 멈춘 것이다. 상위가 글을 보냈으면 다시 알린다(상위는 done을 기다린다).
// - Claude hook에 기대지 않는다: 멈춤은 터미널 상태(broadcastSession → bus 'session'), 끝은 atrium done이라 Claude Code·Codex·opencode·pi가 같다.
import { NoticeBatcher, NOTICE_BATCH_MS, closeWhy } from './link-notice.mjs';
import { treeIndex, cycleCheck } from './push-cycle.mjs';
import { clip } from './text.mjs';

export const STOP_REASONS = ['idle_no_done', 'turn_error', 'needs_human', 'closed', 'tree_quiet'];
const WHY = {
  idle_no_done: '보고(atrium done) 없이 턴을 끝내고 쉰다',
  turn_error: '오류로 턴이 끝났다',
  needs_human: '사람의 답(승인·신뢰 질문 등)을 기다린다',
  closed: '세션이 닫혔다',
  tree_quiet: '아래 하위까지 모두 쉬는데 일이 열려 있다',
};
const STOPPED = new Set(['ready', 'error', 'sleeping']); // 쉼(보내기 전에 다시 일하기 시작했는지 볼 때)
const HUMAN = new Set(['waiting', 'trust_wait']);

// 알림 한 줄: @하위의 일 u…("할 일 앞부분"): 까닭
export function stopLine({ child, unitId, spec, why, detail = null }) {
  return `@${child}의 일 ${unitId}("${clip(String(spec || '').replace(/\s+/g, ' '), 50)}"): ${WHY[why] || why}${detail ? `(${detail})` : ''}.`;
}
// 상위가 받는 글(판 알림 꼴이라 상위 카드의 마지막 지시가 되지 않는다)
export function stopNoticeText(lines) {
  const ls = lines.map((l) => (typeof l === 'string' ? l : l.line));
  const head = ls.length === 1 ? [`[Atrium 보드] 맡긴 일이 멈췄다: ${ls[0]}`] : ['[Atrium 보드] 맡긴 일이 멈췄다.', ...ls.map((l) => `- ${l}`)];
  return [...head, '할 수 있는 것: 화면 보기 `atrium read <이름>`, 다시 시키기 `atrium prompt <이름> "<할 일>"`, 사람이 답해야 하면 사람에게 알린다. 이 일을 기다리며 폴링하지 않는다.'].join('\n');
}

export class UnitStops {
  // units: WorkUnits
  constructor(b, units, { batchMs = NOTICE_BATCH_MS } = {}) {
    this.b = b; this.units = units;
    this.quiet = new Set(); // 나무 전체가 쉼을 알린 맨 위 시도 ID(나무에 움직임이 생기면 지운다)
    this.timer = null;
    // P281: 턴 시작 시각(세션 → ms), 마지막 판 명령(세션 → { at, op, to }), 시도별 idle_no_done 알림을 보낸 때(시도 → ms). 메모리에만 둔다
    this.turnAt = new Map(); this.lastCmd = new Map(); this.idleSent = new Map();
    this.batch = new NoticeBatcher({
      batchMs,
      canSend: (sid) => b.sessions.has(sid) && !(b.killing && b.killing.has(sid)),
      keep: (sid, l) => this.still(l),
      format: stopNoticeText,
      send: (sid, text, lines) => {
        const st = b.store; const d = b.queue.enqueue(sid, text); const now = Date.now();
        for (const l of lines) { st.updateTry(l.tryId, { notifiedAt: now }); if (l.why === 'idle_no_done') this.idleSent.set(l.tryId, now); }
        st.addEvent(sid, 'unit_stop_notice', { items: lines.map((l) => ({ unitId: l.unitId, tryId: l.tryId, why: l.why })), deliveryId: d.deliveryId });
        b.log(`unit stop notice → ${units.nameOf(sid)}: ${lines.map((l) => `${l.unitId} ${l.why}`).join(', ')}`);
        return d;
      },
      onDrop: (sid, lines) => { if (b.sessions.has(sid)) b.store.addEvent(sid, 'unit_stop_notice_dropped', { items: lines.map((l) => ({ unitId: l.unitId, why: l.why })) }); },
    });
  }
  store() { return this.b.store; }
  // P281: 하위가 판 명령을 냈다(Branch.dispatch). 상태 줄이 알아서 부르는 usage-report는 에이전트의 명령이 아니다
  noteCommand(sid, op) { if (op !== 'usage-report') this.lastCmd.set(sid, { at: Date.now(), op, to: null }); }
  // P281: atrium prompt가 글을 받는 세션의 대기열에 넣었다(agent-verbs prompt)
  notePrompt(sid, to) { this.lastCmd.set(sid, { at: Date.now(), op: 'prompt', to }); }
  // P281: 이 idle_no_done을 알리지 않을 까닭 → 'asked_parent' | 'repeat' | null
  quietWhy(sid, tr, unit) {
    if (!unit) return null;
    const c = this.lastCmd.get(sid); const t0 = this.turnAt.get(sid);
    if (c && c.op === 'prompt' && c.to === unit.from && t0 != null && c.at >= t0) return 'asked_parent';
    const sent = this.idleSent.get(tr.id) ?? (tr.stopReason === 'idle_no_done' && tr.notifiedAt ? tr.notifiedAt : null); // 다시 뜬 뒤는 시도의 열로
    if (sent == null) return null;
    const p = this.store().lastDeliveryFrom(sid, unit.from);
    return p != null && p > sent ? null : 'repeat';
  }
  waited(fromId, toId) { const ws = this.units.waiters.get(`${fromId}>${toId}`); return !!(ws && ws.size); }
  // 상위의 묶음에 한 줄을 더한다
  add(tr, unit, why, detail = null) {
    if (!unit || !this.b.sessions.has(unit.from)) return false;
    if (why !== 'tree_quiet' && this.waited(unit.from, unit.to)) return false;
    const line = stopLine({ child: this.units.nameOf(tr.sessionId), unitId: unit.id, spec: unit.spec, why, detail });
    this.store().addEvent(tr.sessionId, 'unit_stop_seen', { unitId: unit.id, tryId: tr.id, why });
    return this.batch.add(unit.from, { key: `${tr.id}:${why}:${tr.sessionId}`, tryId: tr.id, unitId: unit.id, sessionId: tr.sessionId, why, line });
  }
  // 보낼 때 아직 알릴 것인가: done이 오지 않았고, 다시 일하기 시작하지 않았다
  still(l) {
    const st = this.store(); const tr = st.getTry(l.tryId);
    if (!tr || tr.result != null) return false;
    if (l.why === 'closed') return true;
    const unit = st.getUnit(tr.unitId);
    if (!unit || unit.status !== 'open') return false;
    if (l.why === 'tree_quiet') return this.treeQuiet(tr) === true;
    if (!this.b.sessions.has(tr.sessionId)) return false; // 닫혔으면 closed 줄이 따로 간다
    const state = this.units.prev.get(tr.sessionId);
    return l.why === 'needs_human' ? HUMAN.has(state) : STOPPED.has(state);
  }

  // 그 세션의 상태가 바뀌었다(WorkUnits.onSession이 부른다). tr: 그 세션의 열린 시도(머리), prev → state
  onState(s, sum, prev, tr) {
    const state = sum.state;
    if (prev !== state) this.scheduleTree();
    if (state === 'working' && prev !== 'working' && !HUMAN.has(prev)) this.turnAt.set(s.sessionId, Date.now()); // P281: 턴 시작
    if (!tr || !tr.header || prev == null || prev === state) return null;
    const st = this.store();
    const d = tr.deliveryId ? st.getDelivery(tr.deliveryId) : null;
    if (!d || d.status !== 'confirmed') return null; // 머리를 받기 전(신뢰 질문 등은 atrium child 응답이 말한다)
    let why = null;
    if (prev === 'working' && (state === 'ready' || state === 'error')) {
      const turnless = sum.work && sum.work.turnless && s.rt && s.rt.term && sum.work.endedAt === s.rt.term.at; // P173: 압축만 하고 끝남(턴이 아니다)
      if (turnless) return null;
      if (state === 'error') why = 'turn_error';
      else if (st.openUnitsFromCount(s.sessionId) === 0) why = 'idle_no_done'; // 하위를 기다리며 쉬는 중간 워커는 나무 전체로 본다
    } else if (HUMAN.has(state) && !HUMAN.has(prev)) why = 'needs_human';
    if (!why) return null;
    const unit = st.getUnit(tr.unitId);
    const quiet = why === 'idle_no_done' ? this.quietWhy(s.sessionId, tr, unit) : null; // P281
    if (quiet) {
      st.addEvent(s.sessionId, 'unit_stop_quiet', { unitId: tr.unitId, tryId: tr.id, why, because: quiet });
      this.b.log(`unit stop not noticed: ${this.units.nameOf(s.sessionId)} ${tr.unitId} ${why} (${quiet})`);
    } else this.add(tr, unit, why);
    return why;
  }
  // 세션이 닫혔다(열린 시도가 있었으면). → 알림을 건 상위 ID | null
  onClosed(s, tr, unit, reason, { byParent = false } = {}) {
    this.scheduleTree();
    this.turnAt.delete(s.sessionId); this.lastCmd.delete(s.sessionId); if (tr) this.idleSent.delete(tr.id);
    if (!tr || !tr.header || byParent || !unit) return null;
    return this.add(tr, unit, 'closed', reason ? closeWhy(reason) : null) ? unit.from : null;
  }

  // ---------- 나무 전체가 쉬는가(중간 워커) ----------
  scheduleTree() {
    if (this.timer || typeof this.b.pushTree !== 'function') return;
    this.timer = setImmediate(() => { this.timer = null; try { this.checkTrees(); } catch (e) { this.b.log('unit tree check error', e.stack); } });
  }
  // 맨 위 시도(자기가 맡긴 열린 일이 있고, 그 일을 맡긴 세션은 열린 시도가 없다)의 나무가 쉬는가 → true | false | null(맨 위 시도가 아님)
  treeQuiet(tr, tree = null) {
    const st = this.store(); const b = this.b;
    if (!tr || tr.endedAt || !tr.header || !b.sessions.has(tr.sessionId)) return null;
    if (!st.openUnitsFromCount(tr.sessionId)) return null;
    const d = tr.deliveryId ? st.getDelivery(tr.deliveryId) : null;
    if (!d || d.status !== 'confirmed') return null;
    return cycleCheck(tr.sessionId, tree || treeIndex(b.pushTree())).ok;
  }
  checkTrees() {
    const st = this.store(); const b = this.b;
    const tries = st.openTries().filter((t) => t.header && b.sessions.has(t.sessionId));
    const open = new Set(tries.map((t) => t.sessionId));
    const ids = new Set(tries.map((t) => t.id));
    for (const id of [...this.quiet]) if (!ids.has(id)) this.quiet.delete(id);
    let tree = null;
    for (const tr of tries) {
      const unit = st.getUnit(tr.unitId);
      if (!unit || !b.sessions.has(unit.from) || open.has(unit.from)) continue; // 위 세션도 열린 시도를 가졌으면 그 나무의 맨 위가 아니다
      tree = tree || treeIndex(b.pushTree());
      const q = this.treeQuiet(tr, tree);
      if (q !== true) { this.quiet.delete(tr.id); continue; }
      if (this.quiet.has(tr.id)) continue;
      this.quiet.add(tr.id);
      st.updateTry(tr.id, { stopReason: 'tree_quiet' });
      this.add(tr, unit, 'tree_quiet');
    }
  }
  stop() { this.batch.stop(); if (this.timer) clearImmediate(this.timer); this.timer = null; }
}
