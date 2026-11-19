// P116: 에이전트끼리 일 시키기(atrium prompt | wait | read, ARCH 4절 F1·K). 판이 띄운 세션이 세션 토큰으로 /branch/prompt, /branch/turn, /branch/read를 부른다.
// 터미널 백엔드와 상관없다. 판은 자기 전달 대기열(B1)과 세션 상태, 어댑터의 readScreen만 쓴다.
// - prompt: 판의 전달 규칙(B1 대기열: claude가 도는 패널, 응답 필요·막힘·시작 중이면 기다림, 사람이 3초 안에 친 터미널은 기다림, 제출 확인)으로 넣는다.
//   잠든 세션(D4·P111)은 대기열에 넣으면 판이 깨운 뒤 넣는다. --wait면 그 글로 시작한 턴이 끝날 때까지 기다려 마지막 답을 돌려준다.
// - wait: 받는 세션의 지금 턴(또는 대기열에 든 글로 시작할 턴)이 끝날 때까지. 판의 상태(working → ready·error)로 보고, 끝나면 마지막 답을 준다
//   (Claude Code는 Stop hook의 답, 다른 종류는 턴이 끝날 때 화면에서 고른 답, F5). 사람의 답을 기다리면(waiting) 바로 돌려준다.
// - read: 받는 세션 화면의 최근 줄(recent_unwrapped). 패널이 없으면(잠듦) 마지막 답.
// - 연결과 오간 기록(F1·F2): 판을 거치므로 보낸 세션 → 받는 세션의 연결, 지시(prompt), 받은 답(reply), 기다린 결과(wait_result)를 판이 바로 남긴다.
//   받는 쪽 상태 변화(target_working·target_done)는 backend.onLinkTargetState가 openPromptFrom으로 붙인다.
// - 이름: 같은 판의 세션 이름(@ 없이도, 판의 이름과 주소). 없으면 not_found와 비슷한 이름(candidates), 닫힌 세션이면 closed.
import { deriveState } from './state.mjs';
import { findSession, shownName } from './session-label.mjs';
import { screenAnswerText, tailText } from './links.mjs';
import { clip } from './text.mjs';

const ACCOUNT_SWITCH_MAX_MS = 15 * 60 * 1000; // 이보다 오래된 전환 표시는 끝난 것으로 본다(백엔드가 전환 도중 꺼진 경우)
export const WAIT_DEFAULT_MS = 100000; // 한 번에 기다리는 기본(Claude Code Bash 도구의 기본 시간 제한 2분 안쪽). 더 길면 --timeout
export const WAIT_MAX_MS = 60 * 60 * 1000;
export const PROMPT_SETTLE_MS = 30000; // --wait 없는 prompt가 글이 들어가기(제출 확인)를 기다리는 시간. 잠든 세션을 깨우는 시간을 담는다
export const READ_LINES = 80;
export const READ_MAX_LINES = 2000;
const TEXT_MAX = 100000; // 보낼 글의 길이(판 대기열과 터미널에 한 번에 넣는 글)
const ANSWER_MAX = 16000; // 돌려주는 마지막 답의 길이
const TURN_GRACE_MS = 10000; // 글이 들어간 뒤 그 턴의 시작(UserPromptSubmit·working)이 보이기까지 기다리는 시간
const ANSWER_GRACE_MS = 5000; // 턴이 끝난 뒤 답(Stop hook, 화면 답)이 오기까지 기다리는 시간
// 오래 걸릴 수 있는 대기 이유(--wait 없는 prompt는 이 이유면 바로 돌려준다): 받는 쪽이 일하는 중, 사람의 답을 기다림, 사람이 치는 중
const LONG_REASONS = new Set(['working', 'waiting', 'trust_wait', 'user_typing', 'draft']);
const FINAL = new Set(['confirmed', 'unconfirmed', 'failed', 'cancelled']);
const normText = (x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim(); // macOS 판: 같은 글인지(띄어쓰기·줄바꿈 차이는 같다)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function apiError(code, message, extra = {}) { return Object.assign(new Error(message), { code }, extra); }
const clamp = (n, lo, hi, dflt) => { const v = Number(n); return Number.isFinite(v) && v > 0 ? Math.min(Math.max(Math.round(v), lo), hi) : dflt; };
// 부른 명령이 답을 받기 전에 끊겼는가(셸 도구의 시간 제한 등). 끊겼으면 기다리기를 그만둔다
function watchGone(res) {
  if (!res || typeof res.once !== 'function') return () => false;
  let gone = false;
  res.once('close', () => { if (!res.writableFinished) gone = true; });
  return () => gone;
}

// 두 글의 편집 거리(비슷한 이름 찾기)
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// 찾지 못한 이름과 비슷한 판의 이름(대소문자 무시: 서로 포함하면 먼저, 다음은 편집 거리가 짧은 것). 최대 max개
export function similarNames(ref, names, max = 3) {
  const q = String(ref || '').toLowerCase();
  if (!q) return [];
  const out = [];
  for (const n of new Set(names.filter(Boolean))) {
    const k = String(n).toLowerCase();
    let score = null;
    if (k.includes(q) || q.includes(k)) score = Math.abs(k.length - q.length) / 100;
    else { const d = lev(q, k); if (d <= Math.max(2, Math.floor(q.length / 3))) score = 1 + d; }
    if (score != null) out.push([score, n]);
  }
  return out.sort((a, b) => a[0] - b[0] || String(a[1]).localeCompare(String(b[1]))).slice(0, max).map((x) => x[1]);
}

// 화면 글: 줄 끝 공백을 떼고, 빈 줄이 이어지면 하나로, 앞뒤 빈 줄을 빼고 끝 n줄
export function compactLines(text, n) {
  const out = [];
  for (const l of String(text ?? '').split(/\r?\n/).map((x) => x.replace(/\s+$/, ''))) {
    if (!l && (!out.length || !out[out.length - 1])) continue;
    out.push(l);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  const tail = out.slice(-n);
  while (tail.length && !tail[0]) tail.shift();
  return tail.join('\n');
}

// 다음에 칠 명령(사람과 모델이 그대로 친다). 이름은 판의 주소(바뀌지 않는다)
export const verbLines = (name) => ({ prompt: `atrium prompt ${name} "<할 일>" --wait`, wait: `atrium wait ${name}`, read: `atrium read ${name}` });

export class AgentVerbs {
  // b: 백엔드(sessions, store, queue, summary, hooked, ensureLink, linkEvent, adapter, sleeper, log). branch: Branch(잠듦 판정)
  constructor(b, branch, { pollMs = 200, settleMs = PROMPT_SETTLE_MS, turnGraceMs = TURN_GRACE_MS, answerGraceMs = ANSWER_GRACE_MS } = {}) {
    this.b = b; this.branch = branch; this.pollMs = pollMs; this.settleMs = settleMs; this.turnGraceMs = turnGraceMs; this.answerGraceMs = answerGraceMs;
    this.stopSeen = new Set(); // macOS 판: 이미 알린 멈춘 턴(`${보낸}>${받는}@${턴 시작}`). 다시 기다리면 사람이 이어 가기를 기다린다
    this.sent = new Map(); // `${보낸 세션}>${받는 세션}` → 마지막으로 보낸 전달 ID(atrium wait가 그 글의 턴을 기다린다)
    this.pendingLinks = new Map(); // 전달 ID → { linkId, to, text }(들어가면 받는 쪽 openPromptFrom으로)
  }
  // 보낸 세션의 마지막 글(atrium prompt, atrium child --prompt의 첫 요청, atrium wake --prompt). atrium wait가 그 글의 턴을 기다린다
  // 너가 그 세션에 마지막으로 보낸 글과 같고 아직 끝나지 않았으면 그 전달(대기 중이거나, 받는 쪽이 그 글로 시작한 턴을 하는 중)
  duplicateOf(caller, t, text) {
    const id = this.sent.get(`${caller.sessionId}>${t.sessionId}`);
    const row = id ? this.b.store.getDelivery(id) : null;
    if (!row || normText(row.text) !== normText(text)) return null;
    if (!FINAL.has(row.status)) return row;
    if (row.status !== 'confirmed') return null;
    const st = deriveState(t.rt).state, turn = t.rt.turn || {};
    const onIt = (st === 'working' || st === 'starting') && (turn.startedAt || 0) >= (row.confirmedAt || 0) - 5000;
    return onIt ? row : null;
  }
  noteSent(caller, t, deliveryId) {
    this.sent.set(`${caller.sessionId}>${t.sessionId}`, deliveryId);
    if (this.sent.size > 2000) this.sent.delete(this.sent.keys().next().value);
  }
  // 전달이 끝났다(Branch.onDeliveryEnd가 부른다). 들어갔으면 받는 쪽의 지금 지시로 두고(target_working·target_done이 이 연결에 붙는다), 못 들어갔으면 그 사실을 남긴다
  onDeliveryEnd(d) {
    const p = this.pendingLinks.get(d.deliveryId);
    if (!p) return;
    this.pendingLinks.delete(d.deliveryId);
    const b = this.b;
    const l = b.store.getLink(p.linkId);
    const t = b.sessions.get(p.to);
    if (!l) return;
    if (d.status !== 'confirmed' || !t) { b.linkEvent(l, 'prompt_result', null, { via: 'atrium', deliveryId: d.deliveryId, ok: false, status: d.status, reason: d.reason || null }, { quiet: true }); return; }
    const working = deriveState(t.rt).state === 'working'; // hook 없는 종류는 터미널 상태 working이 곧 제출 확인이다(그 상태 이벤트는 이미 지나갔다)
    t.openPromptFrom = { linkId: l.linkId, at: Date.now(), text: p.text, submitted: true, working };
    b.linkEvent(l, 'target_submitted', null, { via: 'atrium', deliveryId: d.deliveryId, matches: true }, { quiet: true });
    if (working) b.linkEvent(l, 'target_working', null, { from: 'ready' }, { quiet: true });
  }

  // ---------- 이름 풀기 ----------
  target(caller, ref) {
    const b = this.b;
    const r = String(ref ?? '').trim().replace(/^@/, '');
    if (!r) throw apiError('bad_request', '받을 세션 이름을 주세요. 예: atrium prompt w1 "<할 일>"');
    const open = [...b.sessions.values()];
    const t = findSession(open, r) || open.find((x) => x.agentName === r || x.paneId === r) || null;
    if (!t) {
      const closed = b.store.closedSessions ? findSession(b.store.closedSessions(), r) : null;
      if (closed) throw apiError('closed', `@${shownName(closed) || r}는 닫힌 세션이다(보드에서 끝났거나 꺼졌다). 보낼 수 없다. 지금 연결: atrium me`);
      const names = open.filter((x) => x !== caller && (x.kind || 'claude') !== 'shell').flatMap((x) => [shownName(x), x.name]);
      const near = similarNames(r, names);
      throw apiError('not_found', `보드(${b.cfg.terminalSession})에서 세션을 찾을 수 없다: ${r}.${near.length ? ` 비슷한 이름: ${near.map((n) => '@' + n).join(', ')}.` : ''} 이름은 보드의 세션 이름이다(@ 없이도 된다). 지금 연결: atrium me`, { candidates: near });
    }
    if (t === caller) throw apiError('self', '자기 자신에게는 보낼 수 없다. 다른 세션의 이름을 준다.');
    if ((t.kind || 'claude') === 'shell') throw apiError('not_agent', `@${shownName(t)}는 일반 셸이다. atrium prompt|wait|read는 에이전트 세션에만 된다.`);
    return t;
  }

  asleep(t) { return this.branch.asleep(t); }
  state(t) { return this.b.sessions.has(t.sessionId) ? this.b.summary(t).state : 'closed'; }
  head(t) { return { name: shownName(t), address: t.name, agentName: t.agentName, kind: t.kind || 'claude' }; }
  answerOf(t) {
    const rt = t.rt || {};
    if (!rt.lastAnswer) return null;
    const text = String(rt.lastAnswer);
    return { text: text.length > ANSWER_MAX ? text.slice(0, ANSWER_MAX) : text, clipped: text.length > ANSWER_MAX, source: rt.answerSource || (this.b.hooked(t) ? 'hook' : 'screen'), at: rt.lastAnswerAt || null };
  }
  link(caller, t) { return this.b.ensureLink(caller.sessionId, t.sessionId, { observed: true }); }

  // ---------- atrium prompt <이름> "<글>" [--wait | --now] [--timeout ms] ----------
  // P143: --now면 받는 쪽이 판이 띄운 Claude Code(hook 있음)이고 일하는 중일 때 기다리지 않고 Claude Code의 대기 메시지로 바로 넣는다(P90 typeNow 길).
  //   그 밖(쉬는 중, 다른 종류, 응답 필요, 시작 중, 잠듦)은 B1 그대로다. 턴을 새로 만들지 않아 짝지을 답이 없으므로 --wait와 함께 쓰지 않는다
  async prompt(caller, o = {}, res = null) {
    const b = this.b;
    if (o.now && o.wait) throw apiError('bad_request', '--now와 --wait는 함께 쓸 수 없다. --now는 받는 쪽의 지금 턴에 대기 메시지로 넣어 그 글로 시작하는 턴이 없다(짝지을 답이 없다). 답을 받으려면 --wait만, 일하는 중에도 바로 알리려면 --now만 준다.');
    const t = this.target(caller, o.name);
    const text = o.text == null ? '' : String(o.text);
    if (!text.trim()) throw apiError('bad_request', '보낼 글을 주세요: atrium prompt <이름> "<할 일>"');
    if (text.length > TEXT_MAX) throw apiError('bad_request', `글이 너무 길다(${text.length}자, ${TEXT_MAX}자까지). 파일에 쓰고 그 경로를 보낸다.`);
    // macOS 판: 같은 일을 다시 보내지 않는다. 너의 앞 글이 아직 대기열에 있거나 받는 쪽이 그 글의 턴을 하는 중인데 같은 글이면 넣지 않는다(두 번 하면 토큰이 두 배로 든다)
    const dup = this.duplicateOf(caller, t, text);
    if (dup) {
      b.store.addEvent(caller.sessionId, 'atrium_prompt_duplicate', { target: t.name, sessionId: t.sessionId, deliveryId: dup.deliveryId, chars: text.length });
      const out = { ...this.head(t), deliveryId: dup.deliveryId, woke: false, duplicate: true, next: verbLines(t.name) };
      if (o.wait) { const turn = await this.waitTurn(caller, t, { deliveryId: dup.deliveryId, timeoutMs: o.timeoutMs, res }); return { ...out, state: turn.state, delivery: { status: dup.status, reason: 'duplicate' }, turn }; }
      return { ...out, state: this.state(t), delivery: { status: dup.status, reason: 'duplicate' }, turn: null };
    }
    const woke = this.asleep(t);
    const d = b.queue.enqueue(t.sessionId, text, o.now ? { typeNow: true, aside: true } : {}); // B1 규칙(대기열이 줄바꿈을 LF로 맞춘다). 잠든 세션이면 대기열이 판의 깨우기를 부른다
    const l = this.link(caller, t);
    // P156: 두 세션의 일 관계로 본 꼬리표(assign 위 → 하위 지시, report 하위 → 위 보고, share 동료끼리). 선·Thread가 보고와 공유를 가른다
    const tag = this.branch && this.branch.promptTagOf ? this.branch.promptTagOf(caller.sessionId, t.sessionId) : null;
    b.linkEvent(l, 'prompt', text, { via: 'atrium', deliveryId: d.deliveryId, wait: !!o.wait, ...(o.now ? { now: true } : {}), ...(tag ? { tag } : {}) });
    // 받는 쪽 상태(일하는 중, 끝남)는 이 글이 실제로 들어갈 때 이 지시의 기록에 붙인다(onDeliveryEnd). 대기열에 여럿이 쌓여도 들어간 순서대로 붙는다
    this.pendingLinks.set(d.deliveryId, { linkId: l.linkId, to: t.sessionId, text });
    this.noteSent(caller, t, d.deliveryId);
    b.store.addEvent(caller.sessionId, 'atrium_prompt', { target: t.name, sessionId: t.sessionId, deliveryId: d.deliveryId, chars: text.length, wait: !!o.wait, ...(o.now ? { now: true } : {}), woke });
    if (woke && b.sleeper && b.sleeper.wakeFor) b.sleeper.wakeFor(t, `atrium:${caller.name}`).catch(() => {}); // 대기열도 깨우지만 여기서 먼저 부른다(같은 깨우기로 묶인다)
    b.log(`atrium prompt ${caller.name} → ${t.name} (${d.deliveryId}${o.wait ? ', wait' : ''}${o.now ? ', now' : ''}${woke ? ', woke' : ''})`);
    const out = { ...this.head(t), deliveryId: d.deliveryId, woke, tag, next: verbLines(t.name) };
    if (o.wait) {
      const turn = await this.waitTurn(caller, t, { deliveryId: d.deliveryId, timeoutMs: o.timeoutMs, res });
      const row = b.store.getDelivery(d.deliveryId) || {};
      return { ...out, state: turn.state, delivery: { status: row.status || d.status, reason: row.reason ?? null }, turn };
    }
    const row = await this.settle(d.deliveryId, res);
    // P143: how — typed(일하는 중이라 Claude Code 대기 메시지로 넣음) | queue(판 대기열: 바로 들어갔거나 차례를 기다림). --now일 때만
    const how = o.now ? (d.typed && row.status !== 'queued' ? 'typed' : 'queue') : undefined;
    return { ...out, state: this.state(t), delivery: { status: row.status, reason: row.reason ?? null, ...(how ? { how } : {}) }, turn: null };
  }
  // 글이 들어가기(confirmed)나 끝내 못 들어가기를 잠깐 기다린다. 받는 쪽이 일하는 중이거나 사람의 답을 기다리면 바로 돌려준다(대기열이 나중에 넣는다)
  async settle(deliveryId, res) {
    const b = this.b; const t0 = Date.now();
    const gone = watchGone(res);
    let row = b.store.getDelivery(deliveryId) || { status: 'queued', reason: null };
    while (Date.now() - t0 < this.settleMs && !gone()) {
      row = b.store.getDelivery(deliveryId) || row;
      if (FINAL.has(row.status)) break;
      if (row.status === 'queued' && LONG_REASONS.has(row.reason) && Date.now() - t0 > 600) break;
      await sleep(this.pollMs);
    }
    return row;
  }

  // ---------- atrium wait <이름> [--timeout ms] ----------
  async wait(caller, o = {}, res = null) {
    const t = this.target(caller, o.name);
    const deliveryId = this.sent.get(`${caller.sessionId}>${t.sessionId}`) || null;
    const row = deliveryId ? this.b.store.getDelivery(deliveryId) : null;
    // 너의 마지막 글이 아직 대기열에 있거나, 들어간 뒤 그 턴이 마지막 턴이면(끝났어도) 그 글의 턴이다. 그 뒤에 다른 턴이 시작했으면 지금 턴을 본다
    const last = t.rt.turn || {};
    const mine = row && (!FINAL.has(row.status) || (row.status === 'confirmed' && !(last.startedAt && last.startedAt > (row.confirmedAt || 0) + 5000))) ? deliveryId : null;
    const turn = await this.waitTurn(caller, t, { deliveryId: mine, timeoutMs: o.timeoutMs, res });
    return { ...this.head(t), ...turn };
  }
  // 받는 세션의 턴이 끝날 때까지. → { status, state, ms, answer, ask, error, delivery, next }
  // status: done(턴이 끝났다) | idle(기다릴 턴이 없었다) | waiting(사람의 답을 기다린다) | timeout | failed·unconfirmed(글이 들어가지 않았다) | closed | exited | sleeping | error(턴이 오류로 끝났다) | interrupted(macOS 판: 사람이 그 턴을 멈췄다, 답 없음)
  async waitTurn(caller, t, { deliveryId = null, timeoutMs = null, res = null } = {}) {
    const b = this.b; const t0 = Date.now();
    const limit = clamp(timeoutMs, 1000, WAIT_MAX_MS, WAIT_DEFAULT_MS);
    const gone = watchGone(res);
    // want: 기다리는 턴의 시작 하한. 너의 글이 들어갔으면 그 때, 아니면 처음 본 일하는 턴의 시작. 없으면 기다릴 턴이 없다(idle)
    let want = null, readySince = null, status = null;
    const sum = () => (b.sessions.has(t.sessionId) ? b.summary(t) : null);
    const turnOf = () => t.rt.turn || {};
    let s = sum();
    // macOS 판: 지금 턴이 사람이 멈춘 턴이면 그 턴을 기다린다(처음이면 멈춤을 알리고, 알렸으면 사람이 이어 가기를 기다린다)
    { const tu = turnOf(); if (tu.startedAt && tu.interruptedAt >= tu.startedAt && !(tu.endedAt >= tu.startedAt)) want = tu.startedAt - 1; }
    for (;;) {
      if (gone()) { status = 'aborted'; break; }
      s = sum();
      if (!s) { status = 'closed'; break; }
      const st = s.state;
      const d = deliveryId ? b.store.getDelivery(deliveryId) : null;
      if (d && (d.status === 'failed' || d.status === 'cancelled')) { status = 'failed'; break; }
      if (st === 'exited') { status = 'exited'; break; }
      // macOS 판: 사용 한도로 계정을 바꾸는 중(account-failover.mjs)이면 오류·잠듦으로 돌려주지 않고 새 계정에서 이어 간 턴이 끝날 때까지 기다린다
      const sw = t.rt.accountSwitch;
      if (sw && Date.now() - sw.at < ACCOUNT_SWITCH_MAX_MS) { readySince = null; if (Date.now() - t0 >= limit) { status = 'timeout'; break; } await sleep(this.pollMs); continue; }
      const pend = b.queue.list(t.sessionId).filter((x) => !FINAL.has(x.status));
      if (st === 'waiting' || st === 'trust_wait' || pend.some((x) => x.status === 'queued' && (x.reason === 'waiting' || x.reason === 'trust_wait'))) { status = 'waiting'; break; }
      if (Date.now() - t0 >= limit) { const tu = turnOf(); status = tu.startedAt && tu.interruptedAt >= tu.startedAt && !(tu.endedAt >= tu.startedAt) ? 'interrupted' : 'timeout'; break; } // macOS 판: 멈춘 채로 시간이 끝나면 멈춤
      if (d && d.status === 'confirmed' && !want) want = (d.confirmedAt || d.updatedAt || Date.now()) - 3000;
      if (st === 'working' || st === 'starting') { want ||= (turnOf().startedAt || Date.now()) - 1; readySince = null; await sleep(this.pollMs); continue; }
      if (pend.length) { readySince = null; await sleep(this.pollMs); continue; } // 대기열에 든 글(잠든 세션이면 판이 깨운 뒤 넣는다)
      if (st === 'sleeping') { status = 'sleeping'; break; }
      // 여기서부터 ready·error(또는 셸로 돌아감): 기다린 턴이 끝났는지
      readySince ||= Date.now();
      if (d && d.status === 'unconfirmed') { status = 'unconfirmed'; break; }
      if (!want) { status = 'idle'; break; }
      const turn = turnOf();
      const started = !!turn.startedAt && turn.startedAt >= want;
      // 들어간 글의 턴 시작(UserPromptSubmit·working)이 아직 보이지 않는다
      if (!started && Date.now() - readySince < this.turnGraceMs) { await sleep(this.pollMs); continue; }
      // macOS 판: 사람이 이 턴을 멈췄다(Esc·중지). Stop hook이 오지 않는다. 옛 답을 결과로 주지 않고 멈춤으로 돌려준다
      if (started && turn.interruptedAt >= turn.startedAt && !(turn.endedAt >= turn.startedAt)) {
        const key = `${caller.sessionId}>${t.sessionId}@${turn.startedAt}`;
        if (!this.stopSeen.has(key)) { this.stopSeen.add(key); if (this.stopSeen.size > 2000) this.stopSeen.delete(this.stopSeen.values().next().value); status = 'interrupted'; break; }
        if (Date.now() - t0 >= limit) { status = 'interrupted'; break; }
        await sleep(this.pollMs); continue; // 이미 알렸다: 사람이 이어 가 새 턴이 시작하면(working) 그 턴이 끝날 때 답을 준다
      }
      // 일이 멈췄는데 턴 끝(Stop hook)이 아직이다. hook을 잃었으면 30초 뒤 있는 것으로 돌려준다
      if (started && !(turn.endedAt >= turn.startedAt) && Date.now() - readySince < 30000) { await sleep(this.pollMs); continue; }
      // 답이 턴 끝보다 늦게 온다(화면 답은 턴이 끝난 뒤 판이 화면에서 읽는다)
      if (started && turn.endedAt && (t.rt.lastAnswerAt || 0) < turn.endedAt && Date.now() - readySince < this.answerGraceMs) { await sleep(this.pollMs); continue; }
      status = st === 'error' ? 'error' : 'done';
      break;
    }
    const ms = Date.now() - t0;
    const row = deliveryId ? b.store.getDelivery(deliveryId) : null;
    const st = s ? s.state : 'closed';
    const answer = ['done', 'idle', 'error', 'sleeping', 'unconfirmed'].includes(status) ? this.answerOf(t) : null;
    const out = { status, state: st, ms, answer, ask: status === 'waiting' && s && s.ask ? { kind: s.ask.kind || null, summary: clip(s.ask.summary || s.ask.question || s.ask.kind || '', 300) } : null,
      error: status === 'error' && s && s.error ? { type: s.error.type || null, message: clip(s.error.message, 300) } : null,
      delivery: row ? { deliveryId, status: row.status, reason: row.reason ?? null } : null, next: verbLines(t.name) };
    if (status !== 'aborted' && b.sessions.has(caller.sessionId)) {
      const l = this.link(caller, t);
      b.linkEvent(l, 'wait_result', null, { via: 'atrium', status, state: st, ms, deliveryId }, { quiet: true });
      if (answer && (status === 'done' || status === 'error')) b.linkEvent(l, 'reply', answer.text, { via: 'atrium', source: answer.source, verb: 'wait' });
      b.store.addEvent(caller.sessionId, 'atrium_wait', { target: t.name, sessionId: t.sessionId, status, ms, deliveryId });
    }
    return out;
  }

  // ---------- atrium read <이름> [--lines n] ----------
  async read(caller, o = {}) {
    const b = this.b;
    const t = this.target(caller, o.name);
    const lines = clamp(o.lines, 1, READ_MAX_LINES, READ_LINES);
    const st = this.state(t);
    let text = null, why = null;
    if (!t.paneId || st === 'sleeping') why = 'sleeping';
    else {
      // 화면의 빈 줄(입력 칸 위의 빈 화면 등)은 줄 수에 넣지 않는다: 더 넉넉히 읽고 빈 줄을 줄인 뒤 끝 lines줄
      try { text = compactLines(await b.adapter.readScreen(t.paneId, { source: 'recent_unwrapped', lines: Math.min(lines + 200, READ_MAX_LINES) }), lines); }
      catch (e) { why = e.code || 'read_failed'; }
    }
    const answer = this.answerOf(t);
    const out = { ...this.head(t), state: st, lines, source: text != null ? 'screen' : 'answer', text, why, answer, next: verbLines(t.name) };
    const l = this.link(caller, t);
    b.linkEvent(l, 'reply', text != null ? screenAnswerText(text, 40) : answer ? answer.text : null, { via: 'atrium', verb: 'read', source: out.source, ...(text != null ? { screenTail: tailText(text, 60) } : {}) });
    b.store.addEvent(caller.sessionId, 'atrium_read', { target: t.name, sessionId: t.sessionId, lines, source: out.source, why });
    return out;
  }
}
