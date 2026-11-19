// macOS 판: Claude 계정 자동 전환. 판이 띄운 Claude Code 세션이 사용 한도에 걸리면 우선순위의 다음 계정으로 같은 대화를 이어 띄운다.
// - 신호: Claude Code의 StopFailure hook(error rate_limit·billing_error), 또는 Stop hook의 답이 한도 글("You've hit your limit …")일 때.
//   한도 글에서 풀리는 때(resets 3pm, …|<epoch>)를 읽어 그 계정을 그때까지 한도로 둔다(claude-accounts.mjs markAccountLimited). 못 읽으면 FALLBACK_MS.
// - 넘기기: 1) 대화 기록(<계정>/projects/<폴더>/<대화 ID>.jsonl과 같은 이름의 폴더)을 다음 계정의 projects로 복사한다(원본은 그대로 둔다)
//   2) 세션의 계정(rt.claudeAccount·claudeConfigDir·transcriptPath)을 바꾼다 3) 잠재우기(/exit, 패널 닫기)와 깨우기(같은 대화 ID로 이어 가기)로 다시 띄운다
//   4) 판 알림으로 멈춘 일을 이어 가라고 보낸다. 계정을 먼저 바꾸므로 그사이 전달이 깨우기를 불러도 새 계정으로 뜬다.
// - 다음 계정은 우선순위 차례에서 한도에 걸리지 않고 로그인한 계정이다(로그인 화면으로 넘기지 않는다). 없으면 넘기지 않고 알린다.
// - 잠재우기가 지금 안 되는 까닭(쓰다 만 글, 전달 중, 뒤 일, 일하는 하위 세션)이면 RETRY_MS마다 다시 해 본다. 사람이 쓰다 만 글은 지우지 않는다.
// - 넘긴 계정의 신뢰(그 계정 .claude.json)가 없으면 Claude Code가 신뢰 질문을 띄운다. 판은 대신 답하지 않는다(trust_wait로 보이고 이어 가라는 알림은 기다린다).
// - 판은 로그인·인증 정보를 다루지 않는다. 한도 기록과 차례만 판 기록에 둔다.
import fs from 'node:fs';
import path from 'node:path';
import { convoOf } from './sleep.mjs';
import { transcriptPathFor } from './launch.mjs';
import { DEFAULT_ACCOUNT } from './claude-accounts.mjs';

export const FALLBACK_MS = 5 * 3600 * 1000; // 풀리는 때를 모르는 사용 한도(Claude 구독의 5시간 창)
export const SHORT_FALLBACK_MS = 15 * 60 * 1000; // 한도 글 없이 온 rate_limit(잠깐의 과부하일 수 있다)
export const RETRY_MS = 30 * 1000;
export const MAX_TRIES = 20; // 약 10분
const LIMIT_RE = /(hit your (?:usage |session |weekly )?limit|usage limit|limit reached|reached your (?:usage |session |weekly )?limit|out of (?:extra )?usage|5-hour limit|weekly limit|session limit)/i;
const LIMIT_TYPES = new Set(['rate_limit', 'billing_error']);
const RETRYABLE = new Set(['sleep_draft', 'sleep_delivering', 'sleep_background', 'sleep_child_busy', 'sleep_loop', 'sleep_working', 'sleep_waking', 'sleep_not_ready', 'still_running', 'sleep_sleep_failed']);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// 한도 글인가(답 글이나 오류 글)
export const isLimitText = (text) => LIMIT_RE.test(String(text || ''));
// 훅 하나 → { type, text } | null. StopFailure의 rate_limit·billing_error, 또는 답이 한도 글인 Stop
export function limitSignal(ev, body = {}) {
  const text = [body.error_details, body.error_message, body.message, body.last_assistant_message].filter((x) => typeof x === 'string' && x).join('\n');
  if (ev === 'StopFailure') {
    const type = String(body.error || body.error_type || '');
    if (LIMIT_TYPES.has(type) || isLimitText(text)) return { type: type || 'rate_limit', text };
    return null;
  }
  if (ev === 'Stop' && isLimitText(body.last_assistant_message) && String(body.last_assistant_message).length < 400) return { type: 'rate_limit', text: body.last_assistant_message };
  return null;
}

// 한도 글에서 풀리는 때(ms). 이 PC의 시간대로 읽는다. 모르면 null
//   "Claude AI usage limit reached|1757980800", "resets 3pm", "resets 3:30pm (Asia/Seoul)", "resets Nov 20, 9am", "resets at 10:00"
export function parseResetAt(text, now = Date.now()) {
  const s = String(text || '');
  const epoch = /\|(\d{10})(?:\D|$)/.exec(s);
  if (epoch) return Number(epoch[1]) * 1000;
  const m = /resets?\s+(?:at\s+|on\s+)?(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(s);
  if (!m) return null;
  let h = Number(m[3]); const min = m[4] ? Number(m[4]) : 0; const ap = m[5] && m[5].toLowerCase();
  if (h > 23 || min > 59 || (ap && (h < 1 || h > 12))) return null;
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  const d = new Date(now);
  if (m[1]) {
    const mon = MONTHS.indexOf(m[1].toLowerCase());
    if (mon < 0) return null;
    d.setMonth(mon, Number(m[2]));
  }
  d.setHours(h, min, 0, 0);
  let t = d.getTime();
  if (!m[1]) { while (t <= now) t += 24 * 3600 * 1000; } // 시각만 있으면 다음에 오는 그 시각
  else if (t <= now - 24 * 3600 * 1000) { d.setFullYear(d.getFullYear() + 1); t = d.getTime(); } // 날짜가 지났으면 내년
  return t;
}
export function limitUntil(sig, now = Date.now()) {
  const at = parseResetAt(sig && sig.text, now);
  if (at && at > now) return at;
  return isLimitText(sig && sig.text) || (sig && sig.type === 'billing_error') ? now + FALLBACK_MS : now + SHORT_FALLBACK_MS;
}

// 대화 기록을 다른 계정의 projects로 복사한다(원본은 그대로). → 복사한 기록 경로
export function copyConversation({ transcript, fromProjects, toProjects, cwd, convId }) {
  const rel = fromProjects ? path.relative(fromProjects, transcript) : '';
  const dest = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? path.join(toProjects, rel) : transcriptPathFor(toProjects, cwd, convId);
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  const tmp = `${dest}.atrium-${process.pid}-${Date.now()}.tmp`;
  try { fs.copyFileSync(transcript, tmp); fs.renameSync(tmp, dest); } finally { try { fs.rmSync(tmp, { force: true }); } catch {} }
  // 하위 에이전트·도구 결과 폴더(<대화 ID>/)
  const side = path.join(path.dirname(transcript), convId);
  try { if (fs.statSync(side).isDirectory()) fs.cpSync(side, path.join(path.dirname(dest), convId), { recursive: true, force: true }); } catch {}
  return dest;
}

export const continueNotice = ({ from, to }) => `[atrium 보드] Claude 계정 ${from}의 사용 한도에 걸려 계정 ${to}(으)로 바꿔 같은 대화를 이었습니다. 멈춘 일을 이어서 하세요.`;

export const movedNotice = ({ from, to }) => `[atrium 보드] 사람이 Claude 계정을 ${from}에서 ${to}(으)로 옮기느라 하던 턴을 멈췄습니다. 같은 대화입니다. 멈춘 일을 이어서 하세요.`;

export class AccountFailover {
  constructor(b, { retryMs = RETRY_MS, maxTries = MAX_TRIES } = {}) {
    this.b = b; this.retryMs = retryMs; this.maxTries = maxTries;
    this.running = new Map(); // 세션 ID → 넘기는 중인 Promise
    this.timers = new Map(); // 세션 ID → 다시 해 볼 타이머
  }
  stop() { for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); }
  nameOf(a) { return a ? (a.id === DEFAULT_ACCOUNT ? 'Claude' : a.name) : '?'; }

  // 훅을 받은 뒤(backend onHook). 한도면 그 계정을 한도로 두고 넘긴다. 한도 없이 턴이 끝났으면 그 계정의 한도를 푼다
  onHook(s, ev, body = {}) {
    const b = this.b;
    if (!s || (s.kind || 'claude') !== 'claude' || !b.hooked(s) || typeof b.accountOf !== 'function') return null;
    const sig = limitSignal(ev, body);
    const cur = b.accountOf(s);
    if (!sig) {
      if (ev === 'Stop' && cur && b.accountLimit(cur.id)) b.clearAccountLimit(cur.id); // 그 계정으로 턴이 끝났다: 한도가 풀렸다
      return null;
    }
    const until = limitUntil(sig);
    b.markAccountLimited(cur.id, { until, type: sig.type, text: sig.text });
    b.store.addEvent(s.sessionId, 'account_limit', { account: cur.id, until, type: sig.type });
    b.log(`claude account ${cur.id} limited until ${new Date(until).toISOString()} (${sig.type}) via ${s.name}`);
    if (!b.accountFailoverOn()) return { limited: cur.id, until, switched: false, why: 'off' };
    if (!b.nextAccount([cur.id])) { this.failover(s).catch(() => {}); return { limited: cur.id, until, switched: false, why: 'none' }; }
    s.rt.accountSwitch = { at: Date.now(), from: cur.id }; // atrium wait가 오류로 돌려주지 않고 기다린다(agent-verbs.mjs)
    this.schedule(s, 0, 1);
    return { limited: cur.id, until, switched: 'scheduled' };
  }

  schedule(s, delay, tries) {
    clearTimeout(this.timers.get(s.sessionId));
    const t = setTimeout(() => {
      this.timers.delete(s.sessionId);
      this.failover(s, { tries }).catch((e) => this.b.log(`account failover ${s.name} failed: ${e.code || ''} ${e.message}`));
    }, delay);
    if (t.unref) t.unref();
    this.timers.set(s.sessionId, t);
  }

  // 한도에 걸린 세션을 다음 계정으로 넘긴다(자동). 지금 안 되면 다시 해 볼 차례를 잡는다
  async failover(s, { tries = 1 } = {}) {
    let retry = false;
    try {
      const r = await this._failover(s, { tries });
      retry = !!(r && r.retry);
      return r;
    } finally { if (!retry && s.rt && s.rt.accountSwitch) { delete s.rt.accountSwitch; this.b.broadcastSession(s, { cause: 'account:switch_end' }); } }
  }
  async _failover(s, { tries = 1 } = {}) {
    const b = this.b;
    if (b.sessions.get(s.sessionId) !== s || s.rt.sleep || s.rt.exit) return { switched: false, why: 'gone' };
    const cur = b.accountOf(s);
    if (!b.accountLimit(cur.id)) return { switched: false, why: 'not_limited' }; // 그새 풀렸다
    const to = b.nextAccount([cur.id]);
    if (!to) {
      b.store.addEvent(s.sessionId, 'account_failover_none', { from: cur.id });
      b.api?.broadcast('account.failover', { sessionId: s.sessionId, name: s.name, from: cur.id, to: null, ok: false, why: 'none' });
      b.log(`account failover ${s.name}: no other usable account (from ${cur.id})`);
      return { switched: false, why: 'none' };
    }
    try {
      return await this.switchAccount(s, to, { why: 'limit' });
    } catch (e) {
      if (RETRYABLE.has(e.code) && tries < this.maxTries) {
        b.log(`account failover ${s.name}: ${e.code}, retry ${tries + 1}/${this.maxTries}`);
        this.schedule(s, this.retryMs, tries + 1);
        return { switched: false, why: e.code, retry: true };
      }
      b.api?.broadcast('account.failover', { sessionId: s.sessionId, name: s.name, from: cur.id, to: to.id, ok: false, why: e.code || 'error' });
      throw e;
    }
  }

  // 세션을 계정 to로 옮겨 같은 대화를 이어 띄운다(자동 전환과 사람의 accounts.switch가 같이 쓴다)
  switchAccount(s, to, { why = 'hand', notice = true, resume = false } = {}) {
    if (this.running.has(s.sessionId)) return this.running.get(s.sessionId);
    const job = this._switch(s, to, { why, notice, resume }).finally(() => this.running.delete(s.sessionId));
    this.running.set(s.sessionId, job);
    return job;
  }

  async _switch(s, to, { why, notice, resume = false }) {
    const b = this.b, rt = s.rt;
    if ((s.kind || 'claude') !== 'claude' || !b.hooked(s)) throw Object.assign(new Error(`@${s.name}: 판이 띄운 Claude Code 세션만 계정을 바꿀 수 있습니다.`), { code: 'not_board' });
    const from = b.accountOf(s);
    if (from.id === to.id) return { switched: false, why: 'same', account: to.id };
    if (!b.accountUsable(to)) throw Object.assign(new Error(`계정 ${this.nameOf(to)}에 로그인되어 있지 않습니다.`), { code: 'not_logged_in', key: 'accounts.err.notLoggedIn', vars: { name: this.nameOf(to) } });
    // 1) 대화 기록 복사
    const conv = convoOf(s, b.projectsOfAccount(from));
    let dest = null;
    if (conv.exists) dest = copyConversation({ transcript: conv.transcript, fromProjects: b.projectsOfAccount(from), toProjects: b.projectsOfAccount(to), cwd: s.cwd, convId: conv.convId });
    // 2) 계정 바꾸기(깨우기·다시 열기가 새 계정 폴더로 띄운다)
    const before = { claudeAccount: rt.claudeAccount, claudeConfigDir: rt.claudeConfigDir, transcriptPath: rt.transcriptPath };
    const apply = (a, tx) => {
      rt.claudeAccount = a.id;
      if (a.configDir) rt.claudeConfigDir = a.configDir; else delete rt.claudeConfigDir;
      if (tx) rt.transcriptPath = tx; else delete rt.transcriptPath;
      b.store.updateSession(s.sessionId, { runtime: rt });
    };
    apply(to, dest);
    // 3) 다시 띄우기: 잠재우기(/exit, 패널 닫기) → 깨우기(같은 대화 ID)
    const wasAsleep = !!rt.sleep;
    try {
      if (!wasAsleep) await b.sleeper.sleep(s, { by: 'account', mode: 'hand', scope: 'session' });
    } catch (e) {
      if (!s.rt.sleep) apply({ id: before.claudeAccount || DEFAULT_ACCOUNT, configDir: before.claudeConfigDir }, before.transcriptPath); // 그대로 돌아간다
      throw e;
    }
    const woke = await b.sleeper.wake(s, `account:${why}`);
    const out = { switched: true, name: s.name, from: from.id, to: to.id, why, copied: !!dest, plan: woke && woke.plan, state: woke && woke.state };
    b.store.addEvent(s.sessionId, 'account_switched', out);
    b.log(`claude account ${s.name}: ${from.id} → ${to.id} (${why}, copied=${!!dest}, plan=${out.plan})`);
    b.api?.broadcast('account.failover', { sessionId: s.sessionId, name: s.name, from: from.id, to: to.id, ok: true, why });
    b.broadcastSession(s, { cause: `account:${why}` });
    // 4) 멈춘 일을 이어 가라는 알림(한도로 넘겼을 때). 신뢰 질문이 떠 있으면 전달 대기열이 기다린다
    if (notice && why === 'limit' && b.queue) b.queue.enqueue(s.sessionId, continueNotice({ from: this.nameOf(from), to: this.nameOf(to) }));
    else if (notice && resume && b.queue) b.queue.enqueue(s.sessionId, movedNotice({ from: this.nameOf(from), to: this.nameOf(to) })); // 사람이 일하는 중에 옮겼다(멈추고 옮김)
    return out;
  }
}

export const attachFailover = (b, opts) => new AccountFailover(b, opts);
