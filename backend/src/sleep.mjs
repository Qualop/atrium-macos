// P21(ARCH 4절 D4 잠재우기) → P24: 리포(워크스페이스) 단위로 잠재우고 깨운다.
// - 잠재우기: 리포 하나에 sleepAfterMin(분, 0이면 끔) 동안 아무 일이 없으면 그 리포의 잠재울 수 있는 세션(판이 띄운 Claude Code)을 모두 잠재운다.
//   세션 하나는 claude를 /exit로 끝내고 그 herdr 패널(작업 공간)까지 닫는다(셸과 MCP 서버도 끝난다). 세션은 판에 남는 상태 sleeping이다
//   (노드, 자리, 덩어리, 연결, 부모·자식, 메모, 이름 그대로). 세션 하나만 잠드는 규칙은 없다(P24에서 뺌). 셸과 다른 종류는 그대로 둔다.
// - "아무 일"(sessionActivity): 그 리포의 어떤 세션이든 일하는 중·내 차례·신뢰 대기·시작 중, 전달 대기, 돌아가는 루프, 보내지 않은 초안,
//   화면에서 보는 노드(초점, 가까이 얼굴), 다른 리포에서 일하는 하위 세션이 있는 부모(그리고 P21처럼 일하는 부모의 하위 세션).
//   사람이 손댄 때(보기·입력·보내기)는 쉬기 시작한 때(idleSince)로 센다. 마지막 일이 끝난 뒤 정한 시간이 지나야 잠재운다(일이 보인 때를 tick마다 기억한다).
// - 깨우기: 잠든 리포의 노드 하나를 누르거나 그 리포의 세션 하나에 글을 보내면 그 리포에서 잠든 세션을 모두 깨운다.
//   부른 세션을 먼저 깨우고 나머지는 WAKE_STAGGER_MS 간격으로 차례로 띄운다(claude 여럿이 한꺼번에 뜨는 부담을 나눈다). 글은 그 세션이 준비된 뒤 대기열이 보낸다.
//   같은 대화 ID로 새 작업 공간을 만들어 판의 인자로 이어 간다(J1 recreate_resume과 같은 길, 갈라 열기 없음). 실패하면 까닭을 남기고 잠듦으로 둔다.
import fs from 'node:fs';
import { buildStartArgs, buildResumeArgs, transcriptPathFor } from './launch.mjs';
import { deriveState } from './state.mjs';
import { readProcessTable, descendants, mb } from './resources.mjs';
import { workspaceNames } from './workspaces.mjs';
import { m, keyed } from './msg.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function apiError(code, message) { return Object.assign(new Error(message), { code }); }
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

export const SLEEP_TICK_MS = 30000; // 저절로 잠재울 리포를 보는 간격
export const WAKE_READY_MS = 90000; // 깨운 claude가 준비될 때까지 기다리는 상한
export const WAKE_SETTLE_MS = 2500; // 준비된 뒤 입력 칸이 Enter를 받을 때까지 더 기다리는 시간(그동안 전달은 기다린다)
export const WAKE_STAGGER_MS = 1500; // 리포를 깨울 때 세션 사이 간격
const BUSY = new Set(['working', 'waiting', 'trust_wait', 'starting']); // 하위·부모 세션이 "일하는 중"
// 리포를 잠재우지 않는 까닭: 대상 없음(asleep, nothing), 일(sessionActivity), 시간(off, idle_short), herdr_down
export const SLEEP_REASONS = ['asleep', 'nothing', 'waking', 'working', 'needs_you', 'draft', 'delivering', 'loop', 'child_busy', 'parent_busy', 'viewing', 'off', 'idle_short', 'herdr_down'];
const ACTIVITY = new Set(['waking', 'working', 'needs_you', 'draft', 'delivering', 'loop', 'child_busy', 'parent_busy', 'viewing']);
export const isActivity = (why) => ACTIVITY.has(why);

// 판 터미널에서 친 글이 입력 칸에 남아 있는지(보내지 않은 초안). 잠재우기의 /exit와 Enter가 그 글 뒤에 붙어 초안을 제출하지 않게 한다.
// 키 입력 덩어리 data를 차례로 본다: Enter(\r, \n)·Ctrl+C·Ctrl+U는 입력 칸을 비우거나 제출하므로 초안 없음,
// 글자(붙여 넣기 포함)는 초안 있음, 지우기·화살표·초점 알림 같은 이스케이프 열은 그대로. 순수 함수
export function draftAfterInput(prev, data) {
  let draft = !!prev;
  const s = String(data || '').replace(/\x1b\[20[01]~/g, '').replace(/\x1b(\[[0-9;?]*[ -\/]*[@-~]|O.|.)/g, '');
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\r' || ch === '\n' || c === 0x03 || c === 0x15) draft = false;
    else if (c >= 0x20 && c !== 0x7f) draft = true;
  }
  return draft;
}

// 세션 하나가 리포를 잠재울 때의 대상인가(null이면 대상, 아니면 빠지는 까닭). 순수 함수
// x: { kind, hooked, convKnown, state, sleeping, waking, closing }
export function sleepTarget(x) {
  if (x.sleeping) return 'sleeping';
  if (x.kind !== 'claude') return 'not_claude';
  if (!x.hooked) return 'not_board'; // 판에 올린 claude, 다른 종류, 셸은 잠재우지 않는다
  if (!x.convKnown) return 'no_convo';
  if (x.waking) return 'waking';
  if (x.closing) return 'closing';
  if (x.state !== 'ready' && x.state !== 'error') return 'not_ready'; // 오류로 끝난 턴도 쉬는 중이다(안 본 답은 검토 대기로 남는다)
  return null;
}

// 세션 하나가 그 리포를 깨워 두는 일(없으면 null). 순수 함수.
// x: { kind, state, waking, draft, delivering, loops, childBusy, parentBusy, viewed }
// mode: auto(저절로), bulk(쉬는 리포 모두), hand(사람이 이 리포를 잠재움. 메뉴를 누르면 늘 보고 있으므로 보는 노드는 보지 않는다)
export function sessionActivity(x, { mode = 'auto' } = {}) {
  if (x.waking) return 'waking';
  if (x.state === 'working' || x.state === 'starting') return 'working';
  if (x.state === 'waiting' || x.state === 'trust_wait') return 'needs_you';
  if (x.draft && x.kind === 'claude') return 'draft'; // 손으로 잠재울 때도: /exit가 초안 뒤에 붙어 제출된다
  if (x.delivering) return 'delivering';
  if (x.loops) return 'loop';
  if (x.childBusy) return 'child_busy';
  if (x.parentBusy) return 'parent_busy';
  if (x.viewed && mode !== 'hand') return 'viewing';
  return null;
}

// 리포 하나를 지금 잠재울지. 순수 함수.
// list: 그 리포 세션들의 { name, ...sleepTarget·sessionActivity의 값, idleSince }, busyAt: 그 리포에 마지막으로 일이 보인 때
// → { why, who, targets, since }. why가 null이면 targets(이름)를 잠재운다. who는 일이 있는 세션 이름
export function repoSleepPlan(list, { mode = 'auto', now = Date.now(), afterMs = 0, busyAt = 0 } = {}) {
  const targets = list.filter((x) => !sleepTarget(x)).map((x) => x.name);
  const since = Math.max(busyAt || 0, ...list.map((x) => x.idleSince || 0));
  const base = { targets, since, who: null };
  for (const x of list) { const a = sessionActivity(x, { mode }); if (a) return { ...base, why: a, who: x.name }; }
  if (!targets.length) return { ...base, why: list.some((x) => x.sleeping) ? 'asleep' : 'nothing' };
  if (mode === 'auto') {
    if (!afterMs) return { ...base, why: 'off' };
    if (now - since < afterMs) return { ...base, why: 'idle_short' };
  }
  return { ...base, why: null };
}

// 쉬기 시작한 때: 마지막 활동, 턴 끝, 사람이 손댄 때, 깬 때, 띄운 때 가운데 가장 늦은 것.
// 마지막 활동은 hook이 오는 세션이면 마지막 hook이다. herdr 상태 알림은 같은 idle이어도 다시 오고(같은 서버의 다른 패널을 닫거나 구독을 고칠 때)
// 그때마다 lastActivityAt이 늘어나므로 쓰지 않는다(P24 창 시험: 한 세션을 잠재우면 리포의 다른 세션이 다시 1분을 기다렸다). 일하는 중은 busyAt이 따로 센다.
// 셸은 돌리는 명령(개발 서버 등)이 리포를 깨워 두지 않도록 사람이 손댄 때만 센다
export function idleSince(s) {
  if (s.kind === 'shell') return s.touchedAt || 0;
  const rt = s.rt || {};
  const act = rt.lastHookAt != null ? rt.lastHookAt : rt.lastActivityAt;
  return Math.max(act || 0, (rt.turn && rt.turn.endedAt) || 0, s.touchedAt || 0, s.wokeAt || 0, rt.launchedAt || 0);
}

// 이어 갈 대화 ID와 대화 기록. hook이 알려 준 대화 ID(Claude Code 안에서 /clear하면 바뀐다)가 먼저다
export function convoOf(s, claudeProjects) {
  const convId = (s.rt && s.rt.claudeSessionId) || s.sessionId;
  const tx = (s.rt && s.rt.transcriptPath) || (s.cwd ? transcriptPathFor(claudeProjects, s.cwd, convId) : null);
  let exists = false; try { exists = !!tx && fs.statSync(tx).isFile(); } catch {}
  return { convId, transcript: tx, exists };
}

// 깨울 때의 실행 인자. 대화 기록이 있으면 그 대화로 이어 가고, 없으면(잠든 동안 지워짐) 같은 세션 ID로 새로 띄운다
export function wakeArgs(launch, conv) {
  return conv.exists ? { plan: 'resume', args: buildResumeArgs({ ...launch, sessionId: conv.convId }) } : { plan: 'fresh', args: buildStartArgs(launch) };
}

export function attachSleep(b, opts) { return new Sleeper(b, opts); }

const wsOf = (s) => s.workspaceKey || '';

export class Sleeper {
  constructor(b, { tickMs = SLEEP_TICK_MS, wakeReadyMs = WAKE_READY_MS, settleMs = WAKE_SETTLE_MS, staggerMs = WAKE_STAGGER_MS, readTable = readProcessTable, timers = true } = {}) {
    this.b = b; this.tickMs = tickMs; this.wakeReadyMs = wakeReadyMs; this.settleMs = settleMs; this.staggerMs = staggerMs; this.readTable = readTable;
    this.going = new Map(); // 세션 ID → 잠재우는 중인 Promise
    this.wakes = new Map(); // 세션 ID → 깨우는 중인 Promise
    this.focus = new Map(); // 창 연결 → 보는 노드 ID 목록(board.viewing: 초점 노드와 가까이 얼굴로 보이는 노드)
    this.busyAt = new Map(); // 리포 키 → 마지막으로 일이 보인 때(마지막 일이 끝난 뒤부터 쉰 시간을 센다)
    // 백엔드가 잠재우던 중에 꺼졌다: 패널이 남았으면 깨어 있는 것으로 돌리고(resync가 상태를 맞춘다), 없으면 잠든 것으로 둔다
    for (const s of b.sessions.values()) {
      if (!s.rt.sleep || !s.rt.sleep.going) continue;
      if (s.paneId) s.rt.sleep = null; else delete s.rt.sleep.going;
      b.store.saveRuntime(s.sessionId, s.rt);
    }
    this.handlers = {
      'workspace.sleep': (p) => this.sleepRepoHand(p),
      'workspace.wake': (p) => this.wakeRepoHand(p),
      'workspace.sleepIdle': () => this.sleepIdle(),
      'session.wake': (p) => this.wakeOne(p), // 노드를 누를 때: 그 세션의 리포를 깨운다
      'board.viewing': (p, c) => {
        if (c) {
          const prev = this.focus.get(c) || [];
          const ids = [...new Set([p.focus, ...(Array.isArray(p.close) ? p.close : [])].filter(Boolean).map(String))];
          if (ids.length) this.focus.set(c, ids); else this.focus.delete(c);
          for (const id of [...prev, ...ids]) { const s = b.sessions.get(id); if (s) this.busyAt.set(wsOf(s), Date.now()); } // 보던 리포는 지금까지 일이 있었다
        }
        return { ok: true };
      },
      'sleep.status': () => this.status(),
    };
    if (timers) this.timer = setInterval(() => this.tick().catch((e) => b.log('sleep tick error', e.stack)), tickMs);
  }
  stop() { clearInterval(this.timer); }
  dropClient(c) { for (const id of this.focus.get(c) || []) { const s = this.b.sessions.get(id); if (s) this.busyAt.set(wsOf(s), Date.now()); } this.focus.delete(c); }

  afterMs() { const st = this.b.features && this.b.features.settings ? this.b.features.settings.get() : {}; return Math.max(0, Number(st.sleepAfterMin ?? 30)) * 60000; }
  viewed(sid) { return this.b.relay.stats().some((x) => x.sessionId === sid) || [...this.focus.values()].some((ids) => ids.includes(sid)); }
  members(key) { return [...this.b.sessions.values()].filter((s) => wsOf(s) === key); }
  repoKeys() { return [...new Set([...this.b.sessions.values()].map(wsOf))]; }
  repoName(key) {
    try { const rows = this.b.store.workspaces(); const n = workspaceNames(rows).get(key); if (n) return n; } catch {}
    return key ? key.split('/').filter(Boolean).pop() : '-';
  }
  isAsleep(s) { return !!(s.rt.sleep || this.going.has(s.sessionId) || this.wakes.has(s.sessionId)); }
  info(s) {
    const b = this.b;
    const kids = [...b.sessions.values()].filter((x) => x.parentSessionId === s.sessionId);
    const parent = s.parentSessionId ? b.sessions.get(s.parentSessionId) : null;
    const busy = (x) => BUSY.has(deriveState(x.rt).state) || this.wakes.has(x.sessionId) || (b.queue && b.queue.pending(x.sessionId) > 0);
    return {
      name: s.name, kind: s.kind || 'claude', hooked: b.hooked(s), convKnown: s.kind === 'claude' && b.hooked(s) && convoOf(s, b.cfg.claudeProjects).exists,
      state: deriveState(s.rt).state, sleeping: !!s.rt.sleep, waking: this.wakes.has(s.sessionId), closing: b.killing.has(s.sessionId) || this.going.has(s.sessionId),
      draft: !!s.draft, delivering: b.queue ? b.queue.pending(s.sessionId) : 0, loops: b.features ? b.features.loops.activeCount(s.sessionId) : 0,
      childBusy: kids.some(busy), parentBusy: !!(parent && busy(parent)), viewed: this.viewed(s.sessionId), idleSince: idleSince(s),
    };
  }
  // 리포 하나의 판정. 일이 보이면 그 때를 기억한다(그 뒤로 쉰 시간을 센다)
  plan(key, mode = 'auto', now = Date.now()) {
    const p = repoSleepPlan(this.members(key).map((s) => this.info(s)), { mode, now, afterMs: this.afterMs(), busyAt: this.busyAt.get(key) || 0 });
    if (isActivity(p.why)) this.busyAt.set(key, now);
    return p;
  }

  // 요약에 덧붙인다(창의 잠든 얼굴, 영역 이름표, 메모리 알약)
  summaryExtra(s) {
    const z = s.rt.sleep;
    return {
      sleep: z ? { at: z.at, by: z.by, memMB: z.memMB ?? null, error: z.error || null } : null,
      waking: s.waking ? { at: s.waking.at, why: s.waking.why } : null,
      sleepable: !z && s.kind === 'claude' && this.b.hooked(s),
    };
  }
  status() {
    const now = Date.now();
    const all = [...this.b.sessions.values()];
    const list = all.filter((s) => s.rt.sleep);
    const repos = this.repoKeys().map((key) => {
      const mem = this.members(key), p = this.plan(key, 'auto', now);
      const asleep = mem.filter((s) => s.rt.sleep);
      return { key, name: this.repoName(key), sessions: mem.length, asleep: asleep.length, savedMB: Math.round(asleep.reduce((a, s) => a + (s.rt.sleep.memMB || 0), 0)), targets: p.targets, why: p.why, who: p.who, idleMs: now - p.since };
    });
    return { afterMin: this.afterMs() / 60000, sleeping: list.length, savedMB: Math.round(list.reduce((a, s) => a + (s.rt.sleep.memMB || 0), 0)), sessions: list.map((s) => ({ name: s.name, workspace: wsOf(s), at: s.rt.sleep.at, memMB: s.rt.sleep.memMB ?? null })), repos };
  }

  // ---------- 저절로 ----------
  async tick() {
    const b = this.b;
    if (!b.adapter || !b.adapter.connected || this._ticking) return;
    this._ticking = true;
    try {
      // 잠든 세션에 보낼 글이 남았는데 깨우는 중이 아니면 그 리포를 깨운다(백엔드가 다시 떠 대기열이 되살아난 경우)
      for (const s of [...b.sessions.values()]) if (s.rt.sleep && !this.wakes.has(s.sessionId) && b.queue.pending(s.sessionId) > 0 && !s.rt.sleep.error) this.wakeFor(s, 'delivery').catch(() => {});
      for (const key of this.repoKeys()) {
        if (this.plan(key, 'auto').why) continue;
        await this.sleepRepo(key, { by: 'auto', mode: 'auto' }).catch((e) => b.log(`auto sleep repo ${key} failed: ${e.code || e.message}`));
      }
    } finally { this._ticking = false; }
  }

  // 리포 하나의 대상 세션을 차례로 잠재운다. 도중에 일이 들어오면 남은 세션은 그대로 둔다
  async sleepRepo(key, { by, mode }) {
    const done = [], skipped = [];
    const first = this.plan(key, mode);
    if (first.why) return { workspace: key, name: this.repoName(key), slept: 0, savedMB: 0, why: first.why, who: first.who, sessions: [], skipped };
    let stop = null;
    for (const name of first.targets) {
      const s = this.members(key).find((x) => x.name === name);
      if (!s) continue;
      if (stop) { skipped.push({ name, reason: stop }); continue; }
      const p = this.plan(key, mode === 'auto' ? 'bulk' : mode); // 리포는 이미 쉰 시간을 넘었다. 도중에 일이 들어왔는지만 본다
      if (p.why) { stop = p.why; skipped.push({ name, reason: p.why, who: p.who }); continue; }
      if (sleepTarget(this.info(s))) continue;
      try { const r = await this.sleep(s, { by, mode }); done.push({ name: s.name, memMB: r.memMB }); }
      catch (e) { skipped.push({ name: s.name, reason: e.code || e.message }); }
    }
    const out = { workspace: key, name: this.repoName(key), slept: done.length, savedMB: Math.round(done.reduce((a, x) => a + (x.memMB || 0), 0)), sessions: done, skipped };
    if (done.length) { this.b.store.addEvent(null, 'repo_slept', { ...out, by }); this.b.log(`repo slept ${out.name} by=${by} n=${done.length} mem=${out.savedMB}MB`); }
    return out;
  }

  // ---------- 손으로 ----------
  async resolveKey(p) {
    if (p.session) return wsOf(this.b.resolve(p.session));
    if (p.workspace == null || p.workspace === '') throw apiError('bad_request', 'workspace required');
    if (this.b.resolveWorkspace) return (await this.b.resolveWorkspace(p.workspace)).key;
    return String(p.workspace);
  }
  // 영역 이름표 메뉴의 "이 리포 잠재우기". 보는 노드와 쉰 시간은 보지 않고, 그 밖의 일이 있으면 까닭을 돌려준다
  async sleepRepoHand(p) {
    const b = this.b;
    b.requireHerdr();
    const key = await this.resolveKey(p);
    const pl = this.plan(key, 'hand');
    if (pl.why) {
      const repo = this.repoName(key);
      throw keyed(apiError(`sleep_${pl.why}`, `리포 ${repo}는 지금 잠재우지 않는다: ${pl.who ? `@${pl.who} ` : ''}${pl.why}`), 'repoSleepRefused', { repo, name: pl.who ? `@${pl.who}` : '', reason: m(`sleepWhy_${pl.why}`) });
    }
    return this.sleepRepo(key, { by: 'hand', mode: 'hand' });
  }
  // 쉬는 리포 모두(트레이, 메모리 알약). 저절로와 같은 조건이되 쉰 시간은 보지 않는다
  async sleepIdle() {
    this.b.requireHerdr();
    const repos = [], skipped = [];
    for (const key of this.repoKeys()) {
      const pl = this.plan(key, 'bulk');
      if (pl.why) { if (pl.why !== 'asleep' && pl.why !== 'nothing') skipped.push({ workspace: key, name: this.repoName(key), reason: pl.why, who: pl.who }); continue; }
      const r = await this.sleepRepo(key, { by: 'bulk', mode: 'bulk' });
      if (r.slept) repos.push(r);
      for (const x of r.skipped) skipped.push({ workspace: key, name: this.repoName(key), session: x.name, reason: x.reason });
    }
    const slept = repos.reduce((a, r) => a + r.slept, 0);
    return { repos: repos.length, slept, savedMB: Math.round(repos.reduce((a, r) => a + r.savedMB, 0)), workspaces: repos, skipped };
  }
  // 영역 이름표 메뉴의 "이 리포 깨우기": 잠든 세션을 모두 깨우고(wait면 모두 준비될 때까지) 결과를 돌려준다
  async wakeRepoHand(p) {
    const key = await this.resolveKey(p);
    const order = this.members(key).filter((s) => this.isAsleep(s));
    if (!order.length) return { workspace: key, name: this.repoName(key), woke: 0, sessions: [] };
    this.b.requireHerdr();
    const jobs = this.wakeRepo(key, null, p.why || 'hand');
    if (p.wait === false) { for (const j of jobs) j.job.catch(() => {}); return { workspace: key, name: this.repoName(key), waking: jobs.length }; }
    const rs = await Promise.all(jobs.map((j) => j.job.then((r) => ({ name: j.name, ok: true, ms: r.ms }), (e) => ({ name: j.name, ok: false, error: e.message }))));
    return { workspace: key, name: this.repoName(key), woke: rs.filter((r) => r.ok).length, sessions: rs };
  }
  // 노드를 누를 때(session.wake): 그 세션의 리포를 깨우고 그 세션이 준비될 때까지 기다린다
  async wakeOne(p) {
    const s = this.b.resolve(p.session);
    const key = wsOf(s);
    const others = this.members(key).filter((x) => this.isAsleep(x));
    if (!others.length) return { awake: true, name: s.name, state: deriveState(s.rt).state };
    this.b.requireHerdr();
    const job = this.wakeFor(s, p.why || 'hand');
    if (p.wait === false) { job.catch(() => {}); return { waking: true, name: s.name, repo: others.length }; }
    const r = await job;
    return { ...r, repo: { workspace: key, waking: others.length } };
  }

  // 리포 key에서 잠든 세션을 모두 깨운다. first(부른 세션)를 먼저, 나머지는 staggerMs 간격으로. → [{ name, job }]
  wakeRepo(key, first, why) {
    const asleep = this.members(key).filter((s) => this.isAsleep(s));
    const order = first && asleep.includes(first) ? [first, ...asleep.filter((x) => x !== first)] : asleep;
    this.busyAt.set(key, Date.now());
    return order.map((s, i) => ({ name: s.name, sessionId: s.sessionId, job: this.wake(s, i === 0 ? why : `repo:${why}`, i * this.staggerMs) }));
  }
  // 세션 s의 리포를 깨우고 s의 깨우기(Promise)를 돌려준다. s가 깨어 있으면 리포의 나머지만 깨운다
  wakeFor(s, why) {
    const jobs = this.wakeRepo(wsOf(s), s, why);
    let mine = null;
    for (const j of jobs) { if (j.sessionId === s.sessionId) mine = j.job; else j.job.catch(() => {}); }
    return mine || Promise.resolve({ awake: true, name: s.name, state: deriveState(s.rt).state });
  }

  // 패널 프로세스와 메모리(D1과 같은 셈: 셸과 그 아래 모든 프로세스)
  async measure(s) {
    const info = await this.b.adapter.processInfo(s.paneId).catch(() => null);
    const shell = info && info.shell_pid;
    const table = shell ? await this.readTable() : null;
    const tree = table ? descendants(table.procs, shell) : [];
    return { shellPid: shell || null, memMB: tree.length ? mb(tree.reduce((a, x) => a + x.ws, 0)) : null, procs: tree.map((x) => ({ pid: x.pid, name: x.name })) };
  }

  sleep(s, { by, mode = by === 'hand' ? 'hand' : 'bulk' }) {
    if (this.going.has(s.sessionId)) return this.going.get(s.sessionId);
    const job = this._sleep(s, by, mode).finally(() => this.going.delete(s.sessionId));
    this.going.set(s.sessionId, job);
    return job;
  }
  async _sleep(s, by, mode) {
    const b = this.b, rt = s.rt, t0 = Date.now();
    b.killing.add(s.sessionId); // 판이 닫는 패널: pane_closed·workspace_closed를 "판 밖에서 닫음"으로 보지 않는다
    try {
      const mem = await this.measure(s);
      // 재는 동안 이 세션에 일이 들어왔으면 그만둔다(리포의 다른 세션은 sleepRepo가 세션마다 다시 본다)
      const x = { ...this.info(s), closing: false };
      const why = sleepTarget(x) || sessionActivity(x, { mode });
      if (why) throw keyed(apiError(`sleep_${why}`, `@${s.name}은 지금 잠재우지 않는다: ${why}`), 'sleepRefused', { name: s.name, reason: m(`sleepWhy_${why}`) });
      const conv = convoOf(s, b.cfg.claudeProjects);
      const prev = { state: deriveState(rt).state, lastPrompt: rt.lastPrompt, lastAnswer: rt.lastAnswer };
      // 지금부터 sleeping으로 보인다(전달은 기다리고 깨우기를 부른다. claude가 끝나는 동안 exited로 깜빡이지 않는다)
      rt.sleep = { at: Date.now(), by, going: true, convId: conv.convId };
      b.broadcastSession(s, { cause: `sleep:${by}` });
      const steps = [];
      if (rt.herdr.present) {
        rt.exitRequested = true;
        await b.adapter.sendText(s.paneId, '/exit'); await sleep(150); await b.adapter.paneKeys(s.paneId, ['enter']);
        const t = Date.now();
        while (rt.herdr.present && Date.now() - t < b.cfg.killWaitMs) await sleep(200);
        if (rt.herdr.present) { rt.sleep = null; rt.exitRequested = false; b.broadcastSession(s, { cause: 'sleep:failed' }); throw apiError('still_running', `@${s.name}의 claude가 /exit 뒤에도 끝나지 않았다`); }
        steps.push(`/exit ${Date.now() - t}ms`);
      }
      // 마지막 패널이면 herdr가 작업 공간도 닫는다. 조회 뒤 생긴 형제 패널까지 닫지 않게 대상 패널만 닫는다.
      await b.adapter.closePane(s.paneId).then(() => steps.push(`pane ${s.paneId} closed`));
      try { b.relay.detach(s.sessionId); } catch {}
      const pane = s.paneId;
      // 잠든 세션은 패널이 없다. resync·자원 감시·셸 확인은 paneId가 없는 세션을 건너뛴다
      s.paneId = null; s.herdrWorkspaceId = null; s.resumeVerified = false;
      rt.exit = null; rt.exitRequested = false; rt.sessionEnd = null; rt.pendingAsk = null; rt.interruptedTurn = null;
      rt.herdr = { status: null, launchPending: false, agentSessionId: null, present: false, at: Date.now() };
      rt.sleep = { at: rt.sleep.at, by, convId: conv.convId, memMB: mem.memMB, procs: mem.procs.length, prevState: prev.state, pane };
      b.store.updateSession(s.sessionId, { paneId: null, herdrWorkspaceId: null, resumeVerified: false, runtime: rt });
      await b.adapter.refreshSubscription();
      // 패널의 프로세스(claude, 셸, MCP 서버)가 끝났는지 본다
      let left = mem.procs;
      for (const tw = Date.now(); left.length && Date.now() - tw < 5000; ) { await sleep(250); left = left.filter((x) => pidAlive(x.pid)); }
      const out = { slept: true, name: s.name, by, memMB: mem.memMB, procs: mem.procs.map((x) => x.name), left: left.map((x) => `${x.name}:${x.pid}`), convId: conv.convId, steps, ms: Date.now() - t0 };
      b.store.addEvent(s.sessionId, 'slept', out);
      b.log(`slept ${s.name} by=${by} mem=${mem.memMB}MB procs=${mem.procs.length} left=${left.length} in ${out.ms}ms`);
      b.broadcastSession(s, { cause: `sleep:${by}` });
      if (b.resources && b.resources.sample) b.resources.sample().catch(() => {}); // 메모리 알약을 바로 줄인다(다음 30초 표본을 기다리지 않게)
      return out;
    } catch (e) {
      if (rt.sleep && rt.sleep.going && s.paneId) { rt.sleep = null; rt.exitRequested = false; b.broadcastSession(s, { cause: 'sleep:failed' }); }
      b.store.addEvent(s.sessionId, 'sleep_failed', { by, error: e.code || e.message });
      throw e;
    } finally { b.killing.delete(s.sessionId); }
  }

  // 세션 하나를 깨운다. delayMs가 있으면(리포의 나머지) 그동안도 "깨우는 중"으로 보이고 전달은 기다린다
  wake(s, why, delayMs = 0) {
    if (this.wakes.has(s.sessionId)) return this.wakes.get(s.sessionId);
    if (!s.rt.sleep && !this.going.has(s.sessionId)) return Promise.resolve({ awake: true, name: s.name, state: deriveState(s.rt).state });
    if (delayMs) { s.waking = { at: Date.now(), why, queued: true }; this.b.broadcastSession(s, { cause: `wake:${why}` }); }
    const job = (async () => { if (delayMs) await sleep(delayMs); return this._wake(s, why); })().finally(() => { this.wakes.delete(s.sessionId); });
    this.wakes.set(s.sessionId, job);
    return job;
  }
  async _wake(s, why) {
    const b = this.b;
    if (this.going.has(s.sessionId)) await this.going.get(s.sessionId).catch(() => {});
    if (!s.rt.sleep || !b.sessions.has(s.sessionId)) { if (s.waking) { s.waking = null; if (b.sessions.has(s.sessionId)) b.broadcastSession(s, { cause: `wake:${why}` }); } return { awake: true, name: s.name, state: deriveState(s.rt).state }; }
    const t0 = Date.now();
    const z = { ...s.rt.sleep, error: undefined };
    s.waking = { at: t0, why };
    b.broadcastSession(s, { cause: `wake:${why}` });
    let created = null;
    try {
      b.requireHerdr();
      if (!s.cwd || !fs.existsSync(s.cwd)) throw keyed(apiError('no_folder', `폴더가 없다: ${s.cwd}`), 'noFolder', { path: s.cwd });
      const conv = convoOf(s, b.cfg.claudeProjects);
      const { plan, args } = wakeArgs(b.launchOf(s), conv);
      created = await b.withNewPane(() => b.adapter.createWorkspace({ cwd: s.cwd, label: s.name }), (r) => {
        s.paneId = r.paneId; s.herdrWorkspaceId = r.workspaceId;
        const rt = s.rt;
        rt.sleep = null; rt.exit = null; rt.phase = 'starting'; rt.launchedAt = Date.now(); rt.hooksSinceLaunch = 0; rt.sessionEnd = null; rt.pendingAsk = null; rt.lastError = null;
        rt.herdr = { status: null, launchPending: true, agentSessionId: null, present: false, at: Date.now() };
        b.store.updateSession(s.sessionId, { paneId: r.paneId, herdrWorkspaceId: r.workspaceId, runtime: rt });
      });
      await b.adapter.refreshSubscription();
      b.broadcastSession(s, { cause: `wake:${why}` });
      await b.adapter.waitShellReady(s.paneId, 8000);
      const st = await b.adapter.startAgent({ name: s.agentName, paneId: s.paneId, args });
      if (st.agent && st.agent.launchPending !== undefined) s.rt.herdr.launchPending = st.agent.launchPending;
      b.registerResume(s);
      // 준비될 때까지(ready, 또는 사람이 필요한 상태). claude가 끝나면(이어 가기 실패) 잠듦으로 되돌린다
      let state = deriveState(s.rt).state;
      for (const tw = Date.now(); Date.now() - tw < this.wakeReadyMs; ) {
        state = deriveState(s.rt).state;
        if (s.rt.exit) throw apiError('resume_failed', `claude가 이어 가자마자 끝났다(${s.rt.exit.kind}${s.rt.exit.reason ? `: ${s.rt.exit.reason}` : ''})`);
        if (['ready', 'working', 'waiting', 'trust_wait', 'error'].includes(state)) break;
        if (!b.sessions.has(s.sessionId)) throw apiError('closed', '깨우는 동안 세션이 닫혔다');
        await sleep(200);
      }
      if (!['ready', 'working', 'waiting', 'trust_wait', 'error'].includes(state)) throw apiError('timeout', `${Math.round(this.wakeReadyMs / 1000)}초 안에 준비되지 않았다`);
      // 이어 간 직후 herdr가 idle을 알려도 Claude Code 입력 칸이 아직 Enter를 받지 않을 때가 있다(P21 창 시험: 깬 직후 보낸 글이 제출되지 않고 입력 칸에 남음).
      // 깨우는 중(s.waking)인 동안 전달은 starting으로 기다리므로 잠깐 더 둔다
      if (state === 'ready' && this.settleMs) await sleep(this.settleMs);
      if (s.rt.exit) throw apiError('resume_failed', `claude가 이어 가자마자 끝났다(${s.rt.exit.kind})`);
      state = deriveState(s.rt).state;
      s.wokeAt = Date.now(); s.waking = null; s.draft = false;
      const out = { woke: true, name: s.name, why, plan, convId: conv.convId, state, ms: Date.now() - t0, sleptMs: t0 - (z.at || t0), paneId: s.paneId };
      b.store.addEvent(s.sessionId, 'woke', out);
      b.log(`woke ${s.name} why=${why} plan=${plan} in ${out.ms}ms`);
      b.broadcastSession(s, { cause: `wake:${why}` });
      return out;
    } catch (e) {
      s.waking = null;
      const error = { code: e.code || 'error', message: e.message, at: Date.now() };
      let cleanupFailed = false;
      if (created && b.sessions.has(s.sessionId)) {
        // 만든 패널을 닫고 잠듦으로 되돌린다
        b.killing.add(s.sessionId);
        try {
          if (s.rt.herdr.present) { await b.adapter.sendText(s.paneId, '/exit').catch(() => {}); await sleep(150); await b.adapter.paneKeys(s.paneId, ['enter']).catch(() => {}); for (const t = Date.now(); s.rt.herdr.present && Date.now() - t < 5000; ) await sleep(200); }
          await b.adapter.closePane(created.paneId);
        } catch (cleanup) {
          cleanupFailed = true;
          error.cleanup = { code: cleanup.code || 'error', message: cleanup.message };
        } finally { b.killing.delete(s.sessionId); }
      }
      if (b.sessions.has(s.sessionId)) {
        const rt = s.rt;
        if (cleanupFailed) {
          // 닫힘을 확인하지 못한 패널은 계속 추적한다. 잠듦으로 두면 다음 깨우기가 같은 대화를 중복 실행한다.
          rt.sleep = null;
        } else {
          s.paneId = null; s.herdrWorkspaceId = null;
          rt.exit = null; rt.sessionEnd = null; rt.pendingAsk = null; rt.herdr = { status: null, launchPending: false, agentSessionId: null, present: false, at: Date.now() };
          rt.sleep = { ...z, error };
        }
        b.store.updateSession(s.sessionId, { paneId: s.paneId, herdrWorkspaceId: s.herdrWorkspaceId, runtime: rt });
        b.queue.cancelSession(s.sessionId, `wake failed: ${error.code}`); // 깨지 못한 세션에 보낼 글은 취소한다(Thread에 남는다)
        b.adapter.refreshSubscription().catch(() => {});
        b.broadcastSession(s, { cause: 'wake:failed' });
      }
      b.store.addEvent(s.sessionId, 'wake_failed', { why, error, ms: Date.now() - t0 });
      b.log(`wake ${s.name} failed: ${error.code} ${error.message}`);
      throw keyed(apiError(error.code === 'herdr_down' ? 'herdr_down' : 'wake_failed', `@${s.name}을 깨우지 못했다: ${error.message}`), 'wakeFailed', { name: s.name, error: error.message });
    }
  }
}
