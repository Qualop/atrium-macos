// P21(ARCH 4절 D4 잠재우기) → P24: 리포(워크스페이스) 단위로 잠재우고 깨운다.
// - 잠재우기: 리포 하나에 sleepAfterMin(분, 0이면 끔) 동안 아무 일이 없으면 그 리포의 잠재울 수 있는 세션(판이 띄운 Claude Code)을 모두 잠재운다.
//   세션 하나는 claude를 /exit로 끝내고 그 herdr 패널(작업 공간)까지 닫는다(셸과 MCP 서버도 끝난다). 세션은 판에 남는 상태 sleeping이다
//   (노드, 자리, 덩어리, 연결, 부모·자식, 메모, 이름 그대로). 세션 하나만 잠드는 규칙은 없다(P24에서 뺌). 셸과 다른 종류는 그대로 둔다.
// - "아무 일"(sessionActivity): 그 리포의 어떤 세션이든 일하는 중·내 차례·신뢰 대기·시작 중, 전달 대기, 돌아가는 루프, 보내지 않은 초안,
//   화면에서 보는 노드(초점, 가까이 얼굴), 다른 리포에서 일하는 하위 세션이 있는 부모(그리고 P21처럼 일하는 부모의 하위 세션).
//   사람이 손댄 때(보기·입력·보내기)는 쉬기 시작한 때(idleSince)로 센다. 마지막 일이 끝난 뒤 정한 시간이 지나야 잠재운다(일이 보인 때를 tick마다 기억한다).
//   P105: 도는 Claude Code 뒤 일(뒤 셸·뒤 하위 에이전트, backgroundOf)도 일이다. /exit에 뒤 일 확인 창이 뜨거나 claude가 끝나지 않으면 Esc로 화면을 돌리고
//   그 세션은 다음 활동까지(또는 SLEEP_RETRY_MS, 실패마다 두 배) 다시 잠재우지 않는다. 셸 세션과 같은 작업 공간의 다른 패널은 끄지 않는다(이 패널만 닫는다).
// - 깨우기: 잠든 리포의 노드 하나를 누르거나 그 리포의 세션 하나에 글을 보내면 그 리포에서 잠든 세션을 모두 깨운다.
//   부른 세션을 먼저 깨우고 나머지는 WAKE_STAGGER_MS 간격으로 차례로 띄운다(claude 여럿이 한꺼번에 뜨는 부담을 나눈다). 글은 그 세션이 준비된 뒤 대기열이 보낸다.
//   같은 대화 ID로 새 작업 공간을 만들어 판의 인자로 이어 간다(J1 recreate_resume과 같은 길, 갈라 열기 없음). 실패하면 까닭을 남기고 잠듦으로 둔다.
// - P111 세션 규칙: 리포가 바빠도(지휘 세션이 일하는 동안) sessionSleepAfterMin(분, 0이면 끔) 동안 쉰 세션은 혼자 잠재운다(sessionSleepPlan).
//   "쉼"은 sessionActivity를 그 세션 하나에 적용한 것이고, 일하는 자손(하위의 하위까지)이 있으면 잠재우지 않는다.
//   일하는 부모는 막지 않는다(늘 일하는 지휘 세션 아래 끝난 워커가 남지 않게. 부모가 herdr로 부르면 PreToolUse hook이 그 세션을 깨운다).
//   tick은 리포 규칙을 먼저 본다. 잠든 세션은 rt.sleep.scope에 까닭(repo | session)을 남긴다. 리포 규칙이 리포를 잠재워도 혼자 잠든 세션은 session 그대로다.
//   깨우기: 혼자 잠든 세션(scope session)은 그 세션만 깨운다. 리포째 잠든 세션을 깨우면 리포째 잠든 세션만 함께 깨운다(혼자 잠든 세션은 그대로).
//   이름표 메뉴의 "이 리포 깨우기"(workspace.wake)는 사람이 리포를 고른 것이라 둘 다 깨운다.
import fs from 'node:fs';
import { applyAgentAutoApprove } from './auto-approval.mjs';
import { buildStartArgs, buildResumeArgs, transcriptPathFor } from './launch.mjs';
import { deriveState } from './state.mjs';
import { waitClaudeExitOr } from './worktree-exit.mjs'; // P71, P105
import { startOpt } from './launchers.mjs'; // P97: 실행 명령
import { readProcessTable, descendants, mb, childCommands, isToolCommand } from './resources.mjs';
import { workspaceNames } from './workspaces.mjs';
import { m, keyed } from './msg.mjs';
import { wakeCodexSession } from './codex-session.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function apiError(code, message) { return Object.assign(new Error(message), { code }); }
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

export const SLEEP_TICK_MS = 30000; // 저절로 잠재울 리포를 보는 간격
export const WAKE_READY_MS = 90000; // 깨운 claude가 준비될 때까지 기다리는 상한
export const WAKE_SETTLE_MS = 2500; // 준비된 뒤 입력 칸이 Enter를 받을 때까지 더 기다리는 시간(그동안 전달은 기다린다)
export const WAKE_STAGGER_MS = 1500; // 리포를 깨울 때 세션 사이 간격
const BUSY = new Set(['working', 'waiting', 'trust_wait', 'starting']); // 하위·부모 세션이 "일하는 중"
// P105: 잠재우기가 실패한 세션(/exit 뒤에도 claude가 남음, 뒤 일 확인 창)은 다음 활동까지, 또는 이 간격(실패할 때마다 두 배, 상한 MAX)이 지나야 다시 해 본다
export const SLEEP_RETRY_MS = 30 * 60000;
export const SLEEP_RETRY_MAX_MS = 4 * 60 * 60000;
// P105: hook(Stop의 background_tasks)이 알려 준 뒤 일을 프로세스로 확인할 수 없을 때(뒤 하위 에이전트) 믿는 상한. 턴을 Esc로 끊어 Stop이 오지 않으면 기록이 낡는다
export const BG_HOOK_MAX_MS = 2 * 60 * 60000;
// 리포를 잠재우지 않는 까닭: 대상 없음(asleep, nothing), 일(sessionActivity), 시간(off, idle_short), herdr_down, 잠재우기 실패 뒤 기다림(sleep_failed, P105)
export const SLEEP_REASONS = ['asleep', 'nothing', 'waking', 'working', 'needs_you', 'draft', 'delivering', 'loop', 'background', 'child_busy', 'parent_busy', 'viewing', 'off', 'idle_short', 'herdr_down', 'sleep_failed'];
const ACTIVITY = new Set(['waking', 'working', 'needs_you', 'draft', 'delivering', 'loop', 'background', 'child_busy', 'parent_busy', 'viewing']);
export const isActivity = (why) => ACTIVITY.has(why);

// P105: 세션에 도는 Claude Code 뒤 일(뒤 셸·뒤 하위 에이전트)이 있는가. 순수 함수. → { n, via: 'process'|'hook' } | null
// hook: rt.bg(마지막 Stop·SubagentStop의 background_tasks, P92), scan: claude 바로 아래 도구 명령을 센 것 { at, n } | null(모름)
// - 도구 명령 프로세스(Bash·PowerShell 도구, MCP 서버 빼고)가 있으면 뒤 일이다(hook이 없는 옛 Claude Code도).
// - hook 목록은 BG_HOOK_MAX_MS까지 믿는다. hook 뒤에 프로세스를 보았는데 도구 명령이 없으면 뒤 셸은 끝났다(목록이 낡음). 뒤 하위 에이전트는 프로세스가 따로 없어 hook만 본다.
//   뒤 일이 끝나면 Claude Code가 새 턴(<task-notification>)을 돌리고 그 Stop이 목록을 줄이므로, 보통은 그 턴이 끝난 때부터 다시 쉰 시간을 센다.
export function backgroundOf(hook, scan, now = Date.now()) {
  if (scan && scan.n > 0) return { n: scan.n, via: 'process' };
  const tasks = hook && Array.isArray(hook.tasks) ? hook.tasks : [];
  if (!tasks.length || now - (hook.at || 0) > BG_HOOK_MAX_MS) return null;
  const left = scan && scan.at >= (hook.at || 0) ? tasks.filter((t) => t.type !== 'shell') : tasks;
  return left.length ? { n: left.length, via: 'hook' } : null;
}

// P105: /exit에 Claude Code가 띄우는 "뒤 일이 돈다" 확인 창(Background work is running … 1. Exit and stop tasks 2. Move to background and exit 3. Stay).
// 그대로 두면 판이 "응답 필요"로 보이고, 사람이 Enter를 누르면 1번(뒤 일을 끄고 나감)이 골라진다. 순수 함수. → { tasks: 목록 줄 수 } | null
export function parseExitBackground(screen) {
  const t = String(screen || '');
  if (!/Background work is running|will stop when you exit/i.test(t)) return null;
  return { tasks: (t.match(/^\s*[a-z-]+ · /gim) || []).length };
}

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
// x: { kind, hooked, convKnown, state, sleeping, waking, closing, blocked }
// blocked(P105): 잠재우기가 실패해 다시 해 보기를 미룬 세션. 사람이 이 리포를 잠재울 때(hand)는 다시 해 본다
export function sleepTarget(x, { mode = 'auto' } = {}) {
  if (x.sleeping) return 'sleeping';
  if (x.kind !== 'claude') return 'not_claude';
  if (!x.hooked) return 'not_board'; // 판에 올린 claude, 다른 종류, 셸은 잠재우지 않는다
  if (!x.convKnown) return 'no_convo';
  if (x.waking) return 'waking';
  if (x.closing) return 'closing';
  if (x.gated) return 'not_ready';
  if (x.state !== 'ready' && x.state !== 'error') return 'not_ready'; // 오류로 끝난 턴도 쉬는 중이다(안 본 답은 검토 대기로 남는다)
  if (x.blocked && mode !== 'hand') return 'sleep_failed';
  return null;
}

// 세션 하나가 그 리포를 깨워 두는 일(없으면 null). 순수 함수.
// x: { kind, state, waking, draft, delivering, loops, bg, childBusy, parentBusy, viewed }
// mode: auto(저절로), bulk(쉬는 리포 모두), hand(사람이 이 리포를 잠재움. 메뉴를 누르면 늘 보고 있으므로 보는 노드는 보지 않는다)
export function sessionActivity(x, { mode = 'auto' } = {}) {
  if (x.waking) return 'waking';
  if (x.state === 'working' || x.state === 'starting') return 'working';
  if (x.gated || x.state === 'waiting' || x.state === 'trust_wait') return 'needs_you';
  if (x.draft && x.kind === 'claude') return 'draft'; // 손으로 잠재울 때도: /exit가 초안 뒤에 붙어 제출된다
  if (x.delivering) return 'delivering';
  if (x.loops) return 'loop';
  if (x.bg) return 'background'; // P105: 뒤 셸·뒤 하위 에이전트. 손으로 잠재울 때도(잠재우면 claude와 함께 끝난다)
  if (x.childBusy) return 'child_busy';
  if (x.parentBusy) return 'parent_busy';
  if (x.viewed && mode !== 'hand') return 'viewing';
  return null;
}

// P111: 세션 하나를 혼자 잠재울지(리포가 바빠도). 순수 함수.
// x: info()의 값(sleepTarget·sessionActivity의 값, idleSince, descBusy: 일하는 자손), busyAt: 그 세션에 마지막으로 일이 보인 때(보던 노드 등)
// → { why, since, target }. why가 null이면 잠재운다. 일하는 부모(parentBusy)는 보지 않는다(머리 주석)
export function sessionSleepPlan(x, { now = Date.now(), afterMs = 0, busyAt = 0 } = {}) {
  const since = Math.max(busyAt || 0, x.idleSince || 0);
  const a = sessionActivity({ ...x, childBusy: x.descBusy ?? x.childBusy, parentBusy: false }, { mode: 'auto' });
  if (a) return { why: a, since, target: null };
  const t = sleepTarget(x, { mode: 'auto' });
  if (t) return { why: t === 'sleeping' ? 'asleep' : t === 'sleep_failed' || t === 'waking' ? t : 'nothing', since, target: t };
  if (!afterMs) return { why: 'off', since, target: null };
  if (now - since < afterMs) return { why: 'idle_short', since, target: null };
  return { why: null, since, target: null };
}
// 잠든 세션이 왜 잠들었는가(P111). 옛 기록(scope 없음)과 손·모두 잠재우기는 리포째다
export const sleepScope = (s) => (s && s.rt && s.rt.sleep && s.rt.sleep.scope) || 'repo';

// 리포 하나를 지금 잠재울지. 순수 함수.
// list: 그 리포 세션들의 { name, ...sleepTarget·sessionActivity의 값, idleSince }, busyAt: 그 리포에 마지막으로 일이 보인 때
// → { why, who, targets, since }. why가 null이면 targets(이름)를 잠재운다. who는 일이 있는 세션 이름
export function repoSleepPlan(list, { mode = 'auto', now = Date.now(), afterMs = 0, busyAt = 0 } = {}) {
  const targets = list.filter((x) => !sleepTarget(x, { mode })).map((x) => x.name);
  const since = Math.max(busyAt || 0, ...list.map((x) => x.idleSince || 0));
  const base = { targets, since, who: null };
  for (const x of list) { const a = sessionActivity(x, { mode }); if (a) return { ...base, why: a, who: x.name }; }
  if (!targets.length) {
    const blocked = list.find((x) => sleepTarget(x, { mode }) === 'sleep_failed'); // P105: 실패한 잠재우기를 미루는 중
    if (blocked) return { ...base, why: 'sleep_failed', who: blocked.name };
    return { ...base, why: list.some((x) => x.sleeping) ? 'asleep' : 'nothing' };
  }
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
  constructor(b, { tickMs = SLEEP_TICK_MS, wakeReadyMs = WAKE_READY_MS, settleMs = WAKE_SETTLE_MS, staggerMs = WAKE_STAGGER_MS, readTable = readProcessTable, readChildren = childCommands, timers = true } = {}) {
    this.b = b; this.tickMs = tickMs; this.wakeReadyMs = wakeReadyMs; this.settleMs = settleMs; this.staggerMs = staggerMs; this.readTable = readTable; this.readChildren = readChildren;
    this.going = new Map(); // 세션 ID → 잠재우는 중인 Promise
    this.wakes = new Map(); // 세션 ID → 깨우는 중인 Promise
    this.focus = new Map(); // 창 연결 → 보는 노드 ID 목록(board.viewing: 초점 노드와 가까이 얼굴로 보이는 노드)
    this.busyAt = new Map(); // 리포 키 → 마지막으로 일이 보인 때(마지막 일이 끝난 뒤부터 쉰 시간을 센다)
    this.sessBusyAt = new Map(); // P111: 세션 ID → 그 세션에 마지막으로 일이 보인 때(세션 규칙)
    this.bgScan = new Map(); // P105: 세션 ID → { at, n } claude 바로 아래 도구 명령(뒤 셸) 수를 센 때와 수
    this.blocked = new Map(); // P105: 세션 ID → { why, at, idle, n, until } 실패한 잠재우기를 미루는 중
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
          for (const id of [...prev, ...ids]) { const s = b.sessions.get(id); if (s) { this.busyAt.set(wsOf(s), Date.now()); this.sessBusyAt.set(id, Date.now()); } } // 보던 리포(와 세션)는 지금까지 일이 있었다
        }
        return { ok: true };
      },
      'sleep.status': () => this.status(),
    };
    if (timers) this.timer = setInterval(() => this.tick().catch((e) => b.log('sleep tick error', e.stack)), tickMs);
  }
  stop() { clearInterval(this.timer); }
  dropClient(c) { for (const id of this.focus.get(c) || []) { const s = this.b.sessions.get(id); if (s) { this.busyAt.set(wsOf(s), Date.now()); this.sessBusyAt.set(id, Date.now()); } } this.focus.delete(c); }

  afterMs() { const st = this.b.features && this.b.features.settings ? this.b.features.settings.get() : {}; return Math.max(0, Number(st.sleepAfterMin ?? 30)) * 60000; }
  sessionAfterMs() { const st = this.b.features && this.b.features.settings ? this.b.features.settings.get() : {}; return Math.max(0, Number(st.sessionSleepAfterMin ?? 30)) * 60000; } // P111
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
    const busy = (x) => b.branch?.holds?.(x.sessionId) || BUSY.has(deriveState(x.rt).state) || this.wakes.has(x.sessionId) || (b.queue && b.queue.pending(x.sessionId) > 0);
    // P111: 일하는 자손(하위의 하위까지). 세션 규칙이 본다(잠들면 워커의 herdr agent prompt <지휘 세션>이 실패한다)
    const desc = [], seen = new Set([s.sessionId]);
    for (const q = [s.sessionId]; q.length; ) { const id = q.shift(); for (const x of b.sessions.values()) if (x.parentSessionId === id && !seen.has(x.sessionId)) { seen.add(x.sessionId); desc.push(x); q.push(x.sessionId); } }
    const blk = this.blockOf(s);
    return {
      name: s.name, kind: s.kind || 'claude', hooked: b.hooked(s), convKnown: s.kind === 'claude' && b.hooked(s) && convoOf(s, b.cfg.claudeProjects).exists,
      state: deriveState(s.rt).state, gated: !!b.branch?.holds?.(s.sessionId), sleeping: !!s.rt.sleep, waking: this.wakes.has(s.sessionId), closing: b.killing.has(s.sessionId) || this.going.has(s.sessionId),
      draft: !!s.draft, delivering: b.queue ? b.queue.pending(s.sessionId) : 0, loops: b.features ? b.features.loops.activeCount(s.sessionId) : 0,
      bg: !s.rt.sleep && !!(this.bgOf(s) || (blk && blk.why === 'background')), blocked: blk && blk.why !== 'background' ? blk.why : null,
      childBusy: kids.some(busy), descBusy: desc.some(busy), parentBusy: !!(parent && busy(parent)), viewed: this.viewed(s.sessionId), idleSince: idleSince(s),
    };
  }

  // ---------- P105: 뒤 일과 실패한 잠재우기 ----------
  bgOf(s, now = Date.now()) {
    if (this.b.cfg && this.b.cfg.sleepBgPrecheck === false) return null;
    return (s.kind || 'claude') === 'claude' && s.paneId ? backgroundOf(s.rt.bg, this.bgScan.get(s.sessionId) || null, now) : null;
  }
  // 세션들의 claude 바로 아래 도구 명령(MCP 서버 빼고)을 센다. herdr pane.process_info로 claude PID를 얻고 PowerShell 한 번으로 그 자식을 읽는다.
  // 읽지 못하면(null) 전 값을 둔다. claude가 없는 패널은 0으로 둔다
  async scanBackground(list) {
    const b = this.b, now = Date.now(), pids = new Map();
    for (const s of list) {
      if ((s.kind || 'claude') !== 'claude' || !s.paneId || s.rt.sleep || !b.adapter) continue;
      const rt = s.rt, paneId = s.paneId;
      const info = await b.adapter.processInfo(paneId).catch(() => null);
      if (!info || b.sessions.get(s.sessionId) !== s || s.rt !== rt || s.paneId !== paneId) continue;
      const c = (info.foreground_processes || []).find((p) => /claude/i.test(p.name || ''));
      pids.set(s.sessionId, { s, rt, paneId, pid: c ? Number(c.pid) : null });
    }
    if (!pids.size) return;
    const want = [...pids.values()].map((x) => x.pid).filter(Boolean);
    const kids = want.length ? await this.readChildren(want).catch(() => null) : [];
    if (!kids) return;
    for (const [sid, { s, rt, paneId, pid }] of pids) {
      if (b.sessions.get(sid) !== s || s.rt !== rt || s.paneId !== paneId) continue;
      this.bgScan.set(sid, { at: now, n: pid ? kids.filter((k) => Number(k.ppid) === pid && isToolCommand(k)).length : 0 });
    }
  }
  // 실패한 잠재우기를 미룬다. 같은 쉼(쉬기 시작한 때가 그대로)에서 또 실패하면 간격을 두 배로 늘린다
  block(s, why, now = Date.now()) {
    const prev = this.blocked.get(s.sessionId), idle = idleSince(s);
    const n = prev && prev.idle === idle ? prev.n + 1 : 1;
    const wait = Math.min(SLEEP_RETRY_MS * 2 ** (n - 1), SLEEP_RETRY_MAX_MS);
    const e = { why, at: now, idle, n, until: now + wait };
    this.blocked.set(s.sessionId, e);
    this.b.store.addEvent(s.sessionId, 'sleep_blocked', { why, n, retryMs: wait });
    this.b.log(`sleep blocked ${s.name} why=${why} n=${n} retry in ${Math.round(wait / 60000)}min`);
    return e;
  }
  // 미루는 중인 기록. 그 뒤로 새 활동(쉬기 시작한 때가 늦어짐)이 있었으면 풀고, 간격이 지났으면 다시 해 본다(n은 남긴다)
  blockOf(s, now = Date.now()) {
    const e = this.blocked.get(s.sessionId);
    if (!e) return null;
    if (idleSince(s) > e.idle) { this.blocked.delete(s.sessionId); return null; }
    return now < e.until ? e : null;
  }
  // 리포 하나의 판정. 일이 보이면 그 때를 기억한다(그 뒤로 쉰 시간을 센다)
  plan(key, mode = 'auto', now = Date.now()) {
    const p = repoSleepPlan(this.members(key).map((s) => this.info(s)), { mode, now, afterMs: this.afterMs(), busyAt: this.busyAt.get(key) || 0 });
    if (isActivity(p.why)) this.busyAt.set(key, now);
    return p;
  }

  // P111: 세션 하나의 세션 규칙 판정. 일이 보이면 그 때를 기억한다
  sessionPlan(s, now = Date.now()) {
    const p = sessionSleepPlan(this.info(s), { now, afterMs: this.sessionAfterMs(), busyAt: this.sessBusyAt.get(s.sessionId) || 0 });
    if (isActivity(p.why)) this.sessBusyAt.set(s.sessionId, now);
    return p;
  }

  // 요약에 덧붙인다(창의 잠든 얼굴, 영역 이름표, 메모리 알약)
  summaryExtra(s) {
    const z = s.rt.sleep;
    return {
      sleep: z ? { at: z.at, by: z.by, scope: z.scope || 'repo', memMB: z.memMB ?? null, error: z.error || null } : null, // P111: scope(repo | session)
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
      const blocked = mem.map((s) => [s, this.blockOf(s, now)]).filter(([, e]) => e).map(([s, e]) => ({ name: s.name, why: e.why, n: e.n, retryInMs: e.until - now })); // P105
      const background = mem.map((s) => [s, this.bgOf(s, now)]).filter(([, g]) => g).map(([s, g]) => ({ name: s.name, ...g }));
      // P111: 세션 규칙의 판정(판이 띄운 Claude Code만). 잠든 세션은 scope(repo | session)
      const each = mem.filter((s) => (s.kind || 'claude') === 'claude' && this.b.hooked(s)).map((s) => { const q = this.sessionPlan(s, now); return { name: s.name, why: q.why, idleMs: now - q.since, ...(s.rt.sleep ? { scope: sleepScope(s) } : {}) }; });
      return { key, name: this.repoName(key), sessions: mem.length, asleep: asleep.length, savedMB: Math.round(asleep.reduce((a, s) => a + (s.rt.sleep.memMB || 0), 0)), targets: p.targets, why: p.why, who: p.who, idleMs: now - p.since, blocked, background, each };
    });
    return { afterMin: this.afterMs() / 60000, sessionAfterMin: this.sessionAfterMs() / 60000, sleeping: list.length, savedMB: Math.round(list.reduce((a, s) => a + (s.rt.sleep.memMB || 0), 0)), sessions: list.map((s) => ({ name: s.name, workspace: wsOf(s), at: s.rt.sleep.at, scope: sleepScope(s), memMB: s.rt.sleep.memMB ?? null })), repos };
  }

  // ---------- 저절로 ----------
  async tick() {
    const b = this.b;
    if (!b.adapter || !b.adapter.connected || this._ticking) return;
    this._ticking = true;
    try {
      // 잠든 세션에 보낼 글이 남았는데 깨우는 중이 아니면 그 리포를 깨운다(백엔드가 다시 떠 대기열이 되살아난 경우)
      for (const s of [...b.sessions.values()]) if (s.rt.sleep && !this.wakes.has(s.sessionId) && b.queue.pending(s.sessionId) > 0 && !s.rt.sleep.error) this.wakeFor(s, 'delivery').catch(() => {});
      // P105: 곧 잠들 리포와 뒤 일이 보이는 리포만 프로세스를 다시 본다(뒤 셸이 끝났는지, 쉬는 claude 아래 도구 명령이 도는지)
      const scan = this.repoKeys().filter((key) => { const w = this.plan(key, 'auto').why; return !w || w === 'background'; });
      if (scan.length) await this.scanBackground(scan.flatMap((key) => this.members(key)));
      const busyRepos = [];
      for (const key of this.repoKeys()) {
        if (this.plan(key, 'auto').why) { busyRepos.push(key); continue; }
        await this.sleepRepo(key, { by: 'auto', mode: 'auto' }).catch((e) => b.log(`auto sleep repo ${key} failed: ${e.code || e.message}`));
      }
      // P111: 리포 규칙에 걸리지 않은 리포에서 오래 쉰 세션을 혼자 잠재운다(리포 규칙이 먼저)
      if (this.sessionAfterMs()) await this.sleepIdleSessions(busyRepos);
    } finally { this._ticking = false; }
  }
  // P111: 세션 규칙. 곧 잠들 세션과 뒤 일이 보이는 세션만 프로세스를 다시 보고, 판정을 다시 본 뒤 하나씩 잠재운다
  async sleepIdleSessions(keys) {
    const b = this.b, cand = [];
    for (const key of keys) {
      if (!this.plan(key, 'auto').why) continue; // 그새 리포가 쉬게 되었으면 다음 tick의 리포 규칙에 맡긴다
      for (const s of this.members(key)) { const w = this.sessionPlan(s).why; if (!w || w === 'background') cand.push(s); }
    }
    if (!cand.length) return [];
    await this.scanBackground(cand);
    const done = [];
    for (const s of cand) {
      if (!b.sessions.has(s.sessionId) || this.sessionPlan(s).why) continue;
      try { done.push(await this.sleep(s, { by: 'auto', mode: 'auto', scope: 'session' })); }
      catch (e) { b.log(`auto sleep session ${s.name} failed: ${e.code || e.message}`); }
    }
    return done;
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
      if (sleepTarget(this.info(s), { mode })) continue;
      try { const r = await this.sleep(s, { by, mode }); done.push({ name: s.name, memMB: r.memMB }); }
      catch (e) { skipped.push({ name: s.name, reason: e.code || e.message }); }
    }
    // P111: 앞서 혼자 잠든 세션은 scope session 그대로 둔다(리포를 깨워도 함께 깨지 않는다. 오래전에 끝난 워커가 한꺼번에 깨어 메모리가 튀지 않게)
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
    await this.scanBackground(this.members(key)); // P105: 뒤 셸이 도는지 지금 본다
    const pl = this.plan(key, 'hand');
    if (pl.why) {
      const repo = this.repoName(key);
      // P105: 뒤 일은 사람이 골라 멈추게 한다(잠재우면 claude와 함께 끝나고, 깨워도 되살아나지 않는다). CLI는 message를 찍으므로 할 일을 함께 적는다
      const more = pl.why === 'background' ? ' (백그라운드 작업이 실행 중입니다. 작업이 끝난 뒤 다시 시도하거나 세션에서 작업을 먼저 중지하세요.)' : '';
      throw keyed(apiError(`sleep_${pl.why}`, `리포 ${repo} 프로젝트를 지금 절전 모드로 전환할 수 없습니다: ${pl.who ? `@${pl.who} ` : ''}${pl.why}${more}`), 'repoSleepRefused', { repo, name: pl.who ? `@${pl.who}` : '', reason: m(`sleepWhy_${pl.why}`) });
    }
    return this.sleepRepo(key, { by: 'hand', mode: 'hand' });
  }
  // 쉬는 리포 모두(트레이, 메모리 알약). 저절로와 같은 조건이되 쉰 시간은 보지 않는다
  async sleepIdle() {
    this.b.requireHerdr();
    const repos = [], skipped = [];
    await this.scanBackground([...this.b.sessions.values()]); // P105
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
    const jobs = this.wakeRepo(key, null, p.why || 'hand', { all: true }); // P111: 혼자 잠든 세션도(사람이 리포를 골랐다)
    if (p.wait === false) { for (const j of jobs) j.job.catch(() => {}); return { workspace: key, name: this.repoName(key), waking: jobs.length }; }
    const rs = await Promise.all(jobs.map((j) => j.job.then((r) => ({ name: j.name, ok: true, ms: r.ms }), (e) => ({ name: j.name, ok: false, error: e.message }))));
    return { workspace: key, name: this.repoName(key), woke: rs.filter((r) => r.ok).length, sessions: rs };
  }
  // 노드를 누를 때(session.wake): 그 세션의 리포를 깨우고 그 세션이 준비될 때까지 기다린다. P111: 혼자 잠든 세션은 그 세션만
  async wakeOne(p) {
    const s = this.b.resolve(p.session);
    if (s.kind === 'codex') {
      const job = this.wakeFor(s, p.why || 'hand');
      if (p.wait === false) { job.catch(() => {}); return { waking: this.wakes.has(s.sessionId), name: s.name }; }
      return job;
    }
    const key = wsOf(s);
    const others = this.wakeSet(key, s);
    if (!others.length) return { awake: true, name: s.name, state: deriveState(s.rt).state };
    this.b.requireHerdr();
    const job = this.wakeFor(s, p.why || 'hand');
    if (p.wait === false) { job.catch(() => {}); return { waking: true, name: s.name, repo: others.length }; }
    const r = await job;
    return { ...r, repo: { workspace: key, waking: others.length } };
  }

  // 리포 key에서 잠든 세션을 모두 깨운다. first(부른 세션)를 먼저, 나머지는 staggerMs 간격으로. → [{ name, job }]
  // P34: 데스크톱 앱에서 가져와 아직 한 번도 깨지 않은 세션(sleep.by import)은 리포를 깨울 때 함께 깨우지 않는다(수십 개가 한꺼번에 뜨지 않게). 그 노드를 누르거나 글을 보낼 때만 깬다
  // P111: 혼자 잠든 세션(scope session)은 리포를 깨울 때 함께 깨우지 않는다(all이면 함께). first가 혼자 잠들었으면 first만 깬다
  wakeSet(key, first, { all = false } = {}) {
    if (first && !all && this.isAsleep(first) && sleepScope(first) === 'session') return [first];
    return this.members(key).filter((s) => this.isAsleep(s) && (s === first || (!(s.rt.sleep && s.rt.sleep.by === 'import') && (all || sleepScope(s) !== 'session'))));
  }
  wakeRepo(key, first, why, { all = false } = {}) {
    const asleep = this.wakeSet(key, first, { all });
    const order = first && asleep.includes(first) ? [first, ...asleep.filter((x) => x !== first)] : asleep;
    const alone = asleep.length === 1 && asleep[0] === first && sleepScope(first) === 'session';
    if (!alone) this.busyAt.set(key, Date.now()); // 혼자 깨우는 세션은 리포의 시계를 다시 세지 않는다(그 세션의 깬 때가 센다)
    return order.map((s, i) => ({ name: s.name, sessionId: s.sessionId, job: this.wake(s, i === 0 ? why : `repo:${why}`, i * this.staggerMs) }));
  }
  // 세션 s의 리포를 깨우고 s의 깨우기(Promise)를 돌려준다. s가 깨어 있으면 리포의 나머지만 깨운다. P111: s가 혼자 잠들었으면 s만(wakeSet)
  wakeFor(s, why) {
    // Imported Codex copies wake individually through their saved native UUID.
    // This does not expand sleep eligibility beyond managed Claude sessions.
    if (s.kind === 'codex') return this.wake(s, why);
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

  // P105: /exit가 claude를 끝내지 못했을 때 화면을 원래대로 돌린다. 확인 창(뒤 일 확인, 그 밖의 "Esc to cancel" 창)이 보이면
  // Esc(그 창의 취소. 뒤 일 확인 창에서는 3. Stay와 같다)를 보내고 창이 사라질 때까지 잠깐 본다. Enter는 보내지 않는다(1번이 뒤 일을 끄고 나간다)
  async restoreAfterExit(s, bgSeen) {
    const b = this.b;
    const read = () => b.adapter.readScreen(s.paneId, { source: 'visible' }).catch(() => '');
    const open = (t) => !!parseExitBackground(t) || /Esc to cancel/i.test(t);
    let scr = await read();
    const background = bgSeen || !!parseExitBackground(scr);
    let esc = 0;
    for (let i = 0; i < 2 && s.rt.herdr.present && open(scr); i++) {
      await b.adapter.paneKeys(s.paneId, ['esc']).catch(() => {}); esc++;
      for (const t = Date.now(); Date.now() - t < 2000; ) { await sleep(200); scr = await read(); if (!open(scr)) break; }
    }
    return { background, esc, cleared: !open(scr) };
  }

  // scope(P111): repo(리포 규칙·손·모두) | session(세션 규칙, 혼자)
  sleep(s, { by, mode = by === 'hand' ? 'hand' : 'bulk', scope = 'repo' }) {
    if (this.going.has(s.sessionId)) return this.going.get(s.sessionId);
    const job = this._sleep(s, by, mode, scope).finally(() => this.going.delete(s.sessionId));
    this.going.set(s.sessionId, job);
    return job;
  }
  async _sleep(s, by, mode, scope = 'repo') {
    const b = this.b, rt = s.rt, t0 = Date.now();
    b.killing.add(s.sessionId); // 판이 닫는 패널: pane_closed·workspace_closed를 "판 밖에서 닫음"으로 보지 않는다
    try {
      const mem = await this.measure(s);
      await this.scanBackground([s]); // P105: /exit 바로 앞에서 뒤 셸이 도는지 다시 본다
      // 재는 동안 이 세션에 일이 들어왔으면 그만둔다(리포의 다른 세션은 sleepRepo가 세션마다 다시 본다)
      const x = { ...this.info(s), closing: false };
      // P111: 혼자 잠재울 때는 세션 규칙의 일(일하는 자손을 보고, 일하는 부모는 보지 않는다)
      const why = sleepTarget(x, { mode }) || sessionActivity(scope === 'session' ? { ...x, childBusy: x.descBusy, parentBusy: false } : x, { mode });
      if (why) throw keyed(apiError(`sleep_${why}`, `@${s.name} 세션을 지금 절전 모드로 전환할 수 없습니다: ${why}`), 'sleepRefused', { name: s.name, reason: m(`sleepWhy_${why}`) });
      const conv = convoOf(s, b.cfg.claudeProjects);
      const prev = { state: deriveState(rt).state, lastPrompt: rt.lastPrompt, lastAnswer: rt.lastAnswer };
      // 지금부터 sleeping으로 보인다(전달은 기다리고 깨우기를 부른다. claude가 끝나는 동안 exited로 깜빡이지 않는다)
      rt.sleep = { at: Date.now(), by, scope, going: true, convId: conv.convId };
      b.broadcastSession(s, { cause: `sleep:${by}` });
      const steps = [];
      if (rt.herdr.present) {
        rt.exitRequested = true;
        await b.adapter.sendText(s.paneId, '/exit'); await sleep(150); await b.adapter.paneKeys(s.paneId, ['enter']);
        const t = Date.now();
        // P71: `claude -w` 세션의 워크트리 나가기 질문에는 남기기로 답한다. P105: 뒤 일 확인 창이 뜨면 그 자리에서 멈춘다
        const w = await waitClaudeExitOr(b, s, b.cfg.killWaitMs, { by: 'sleep', steps, stopOn: parseExitBackground });
        const restored = w.stopped || rt.herdr.present ? await this.restoreAfterExit(s, !!w.stopped) : null;
        if (restored && rt.herdr.present) {
          // 확인 창을 Esc로 닫아(Stay) 원래 화면으로 돌렸다. 같은 세션을 곧바로 다시 잠재우지 않는다
          rt.sleep = null; rt.exitRequested = false; b.broadcastSession(s, { cause: 'sleep:failed' });
          const bg = !!(w.stopped || restored.background);
          const e = this.block(s, bg ? 'background' : 'sleep_failed');
          b.store.addEvent(s.sessionId, 'sleep_exit_screen', { background: bg, tasks: (w.stopped && w.stopped.tasks) || 0, esc: restored.esc, cleared: restored.cleared, retryMs: e.until - e.at });
          if (bg) throw keyed(apiError('sleep_background', `@${s.name} 세션을 지금 절전 모드로 전환할 수 없습니다: background`), 'sleepRefused', { name: s.name, reason: m('sleepWhy_background') });
          throw apiError('still_running', `@${s.name} 세션의 claude 프로세스가 /exit 후에도 종료되지 않았습니다.`);
        }
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
      rt.sleep = { at: rt.sleep.at, by, scope: rt.sleep.scope || scope, convId: conv.convId, memMB: mem.memMB, procs: mem.procs.length, prevState: prev.state, pane };
      b.store.updateSession(s.sessionId, { paneId: null, herdrWorkspaceId: null, resumeVerified: false, runtime: rt });
      await b.adapter.refreshSubscription();
      // 패널의 프로세스(claude, 셸, MCP 서버)가 끝났는지 본다
      let left = mem.procs;
      for (const tw = Date.now(); left.length && Date.now() - tw < 5000; ) { await sleep(250); left = left.filter((x) => pidAlive(x.pid)); }
      const out = { slept: true, name: s.name, by, scope: rt.sleep.scope, memMB: mem.memMB, procs: mem.procs.map((x) => x.name), left: left.map((x) => `${x.name}:${x.pid}`), convId: conv.convId, steps, ms: Date.now() - t0 };
      this.blocked.delete(s.sessionId); // P105
      b.store.addEvent(s.sessionId, 'slept', out);
      b.log(`slept ${s.name} by=${by} scope=${rt.sleep.scope} mem=${mem.memMB}MB procs=${mem.procs.length} left=${left.length} in ${out.ms}ms`);
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
    if (s.kind === 'codex') return wakeCodexSession(b, s, { why });
    const t0 = Date.now();
    const z = { ...s.rt.sleep, error: undefined };
    s.waking = { at: t0, why };
    b.broadcastSession(s, { cause: `wake:${why}` });
    let created = null;
    try {
      b.requireHerdr();
      if (!s.cwd || !fs.existsSync(s.cwd)) throw keyed(apiError('no_folder', `폴더를 찾을 수 없습니다: ${s.cwd}`), 'noFolder', { path: s.cwd });
      const conv = convoOf(s, b.cfg.claudeProjects);
      const { plan, args } = wakeArgs(applyAgentAutoApprove({ kind: 'claude', ...b.launchOf(s) }, b.features?.settings?.get?.() || {}), conv);
      created = await b.withNewPane(() => b.adapter.createWorkspace({ cwd: s.cwd, label: s.name }), (r) => {
        s.paneId = r.paneId; s.herdrWorkspaceId = r.workspaceId;
        const rt = s.rt;
        rt.sleep = null; rt.exit = null; rt.phase = 'starting'; rt.launchedAt = Date.now(); rt.hooksSinceLaunch = 0; rt.sessionEnd = null; rt.pendingAsk = null; rt.lastError = null;
        rt.herdr = { status: null, launchPending: true, agentSessionId: null, present: false, at: Date.now() };
        b.store.updateSession(s.sessionId, { paneId: r.paneId, herdrWorkspaceId: r.workspaceId, runtime: rt });
      });
      await b.adapter.refreshSubscription();
      b.broadcastSession(s, { cause: `wake:${why}` });
      if (await b.adapter.waitShellReady(s.paneId, 8000) !== true) throw apiError('timeout', '패널 셸이 준비되지 않았다');
      if (b.sessions.get(s.sessionId) !== s || s.paneId !== created.paneId || b.killing.has(s.sessionId)) throw apiError('not_on_board', '깨우던 패널이 닫혔다');
      const st = await b.adapter.startAgent({ name: s.agentName, paneId: s.paneId, args, ...startOpt(s) });
      if (st.agent && st.agent.launchPending !== undefined) s.rt.herdr.launchPending = st.agent.launchPending;
      b.registerResume(s);
      // 준비될 때까지(ready, 또는 사람이 필요한 상태). claude가 끝나면(이어 가기 실패) 잠듦으로 되돌린다
      let state = deriveState(s.rt).state;
      for (const tw = Date.now(); Date.now() - tw < this.wakeReadyMs; ) {
        state = deriveState(s.rt).state;
        if (s.rt.exit) throw apiError('resume_failed', `대화를 재개한 직후 claude 프로세스가 종료되었습니다 (${s.rt.exit.kind}${s.rt.exit.reason ? `: ${s.rt.exit.reason}` : ''})`);
        if (['ready', 'working', 'waiting', 'trust_wait', 'error'].includes(state)) break;
        if (!b.sessions.has(s.sessionId)) throw apiError('closed', "작업을 재개하는 동안 세션이 닫혔습니다.");
        await sleep(200);
      }
      if (!['ready', 'working', 'waiting', 'trust_wait', 'error'].includes(state)) throw apiError('timeout', `${Math.round(this.wakeReadyMs / 1000)}초 안에 준비되지 않았습니다.`);
      // 이어 간 직후 herdr가 idle을 알려도 Claude Code 입력 칸이 아직 Enter를 받지 않을 때가 있다(P21 창 시험: 깬 직후 보낸 글이 제출되지 않고 입력 칸에 남음).
      // 깨우는 중(s.waking)인 동안 전달은 starting으로 기다리므로 잠깐 더 둔다
      if (state === 'ready' && this.settleMs) await sleep(this.settleMs);
      if (s.rt.exit) throw apiError('resume_failed', `대화를 재개한 직후 claude 프로세스가 종료되었습니다 (${s.rt.exit.kind})`);
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
      throw keyed(apiError(error.code === 'herdr_down' ? 'herdr_down' : 'wake_failed', `@${s.name} 세션의 작업을 재개하지 못했습니다: ${error.message}`), 'wakeFailed', { name: s.name, error: error.message });
    }
  }
}
