// 세션 되찾기(ARCH 4절 J1·J2·J4, P7): herdr가 다시 뜬 뒤 판 세션 되살리기, 닫힌 세션 다시 열기, 판 밖 대화를 판으로 이어 가기.
// backend.mjs에는 이 파일을 부르는 몇 줄만 둔다(attachRecall, resync의 두 곳, closeSession의 닫힌 까닭). 대화 기록 색인과 묶임 판정은 convos.mjs다.
// 판은 대화 ID를 새로 만들지 않는다. 판 밖 대화와 닫힌 claude는 늘 그 대화 ID로 이어 간다(`claude --resume <ID>`). 갈라 열기(--fork-session)는 쓰지 않는다.
// P10: 보관(판정은 archive.mjs). 보관된 것은 recall.list에서 빠지고 보관함(archive.list)에만 보인다. 손으로 보관한 대화는 파일이 바뀌어도 다시 읽지 않는다.
//   리포 스스로 찾기(discover): 기간 안의 터미널(cli) 대화가 있는 리포를 빈 워크스페이스로 연다. 사람이 닫은 워크스페이스는 기억해 다시 열지 않는다(meta autoOpenDeclined).
// P13: 판 밖 대화를 캔버스에 읽기 전용 대화 노드로 올린다(리포 영역마다 최근 순 격자, 워크트리 블록, 상한 CONVO_CAP). 대화끼리의 띄움 관계(spawns.mjs)는 선과 "띄운 곳" 글로,
//   하위 에이전트는 수로 보인다. 폴더가 없어졌거나 이 앱의 시험 폴더인 대화는 missed로 따로 모아(missed.mjs) 캔버스와 사이드바 기본 목록에서 빼고, 한꺼번에 휴지통으로 지운다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { workspaceOf } from './git.mjs';
import { writeSessionSettings, buildStartArgs, buildResumeArgs, buildResumeArgv, predictTrust, transcriptPathFor, slash } from './launch.mjs';
import { FLAVOR as DEEPSEEK, proxyEnv as deepseekEnv, baseUrlOf } from './deepseek.mjs'; // P25
import { newRuntime } from './state.mjs';
import { withGeminiModel } from './gemini-args.mjs';
import { withAgyModel } from './agy.mjs';
import { modelFromArgs, withCodexModel } from './codex-args.mjs';
import { canvasItems, slotFor, settleRegions, regions as areaRegions } from './canvas-ops.mjs';
import { areaKey, parseArea } from './worktree-areas.mjs'; // P27: 워크트리 영역
import { NODE, SIZE_STEPS, overlaps, regionRect, regionsOf, slotInRegion } from './canvas.mjs';
import { pathKey, normPath, workspaceNames } from './workspaces.mjs';
import { clip } from './text.mjs';
import { archiveState, isOld, discoverable, itemKey, DISCOVER_DAYS, OLD_DAYS } from './archive.mjs';
import { CONVO_PARSER, listTranscriptFiles, readTranscriptSummary, readLiveSessions, readDesktopSessions, claudeProcesses, parseClaudeCmdlines, bindingOf, inWorkspace, convoView, readSpawns, mergeSpawns, countSubagents, listSubagents } from './convos.mjs';
import { matchSpawns } from './spawns.mjs';
import { classifyConvo, testDirKind, trashPlan, trashPaths, removeEmptyProjectDirs, REFUSE_LABEL } from './missed.mjs';
import { CONVO_CAP, placeCards } from './convo-canvas.mjs';
import { m, keyed } from './msg.mjs'; // P16: 화면 글 열쇠

const SHELL = 'shell';
const NATIVE_KINDS = new Set(['gemini', 'agy']);
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BINDING_MS = 5000; // 세션 파일과 데스크톱 앱 목록을 다시 읽는 간격(파일 몇 개, 1ms 안팎)
const PROCS_MS = 30000; // claude 프로세스 명령줄(PowerShell 한 번)
const LIST_LIMIT = 300; // 워크스페이스 하나에 돌려줄 닫힌 세션·판 밖 대화 수(마지막 활동 순)
const WS_TTL_MS = 10 * 60 * 1000; // 대화 cwd → 워크스페이스 키 풀이를 이만큼 기억한다(git 한 번 약 30ms)
const SPAWN_DAYS = 30; // P13: 띄움 줄은 마지막 활동이 이 안인 대화만 읽는다(그보다 오래된 부모는 캔버스에 오를 자식이 없다)
const MISSED_TITLE_MAX = 300; // P13: missed 목록에서 제목을 그때그때 읽는 수(판 기록에 남기지 않는다)
const fmtBytes = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)}GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round((n || 0) / 1024))}KB`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function apiError(code, message, extra = {}) { return Object.assign(new Error(message), { code }, extra); }

function managedNative(row) {
  const rt = row?.rt || row?.runtime;
  if (!rt || (row.origin || 'board') !== 'board') return false;
  return row.kind === 'gemini' ? !!rt.geminiIntegration : row.kind === 'agy' && rt.hooked === false && typeof row.hookToken === 'string' && !!row.hookToken;
}

// Gemini·agy는 인증된 hook의 ID·기록 경로만 쓴다. 다른 대화나 'latest'를 찾아 이어 가지 않는다.
function nativeRecovery(row) {
  const rt = row?.rt || row?.runtime;
  if (!rt || !NATIVE_KINDS.has(row.kind) || (row.origin || 'board') !== 'board' || (row.kind === 'agy' && !managedNative(row))) return null;
  const kind = row.kind, id = rt[`${kind}SessionId`], file = rt[`${kind}TranscriptPath`];
  if (typeof id === 'string' && UUID_RE.test(id) && typeof file === 'string' && path.isAbsolute(file)) {
    try { if (fs.statSync(file).isFile()) return { resume: true, id, file }; } catch {}
  }
  // 한 번이라도 턴이 있었으면 기록이 없어졌다고 같은 판 ID의 새 대화로 바꾸지 않는다.
  if (rt.lastPromptAt != null || rt.lastAnswerAt != null || rt.lastPrompt || rt.lastAnswer || rt.turn?.startedAt != null || rt.turn?.endedAt != null || rt.interruptedTurn || rt[`${kind}TurnActive`] || rt[`${kind}Resumed`]) return null;
  return UUID_RE.test(row.sessionId) ? { resume: false, id: kind === 'gemini' ? row.sessionId : null, file: null } : null;
}

function nativeRuntime(row, recovery) {
  const prev = row.rt || row.runtime || {};
  const kind = row.kind, rt = newRuntime({ kind, hooked: false });
  // 지난 턴의 증거를 남겨 다음 복구에서도 새 대화로 잘못 바뀌지 않게 한다.
  for (const key of ['cwd', 'lastPrompt', 'lastPromptAt', 'lastAnswer', 'lastAnswerAt', 'lastActivityAt', 'turn', 'interruptedTurn', 'answerSource']) {
    if (prev[key] !== undefined) rt[key] = prev[key];
  }
  if (kind === 'gemini') Object.assign(rt, { geminiIntegration: true, geminiReady: false });
  if (kind === 'agy') rt.agyComposer = 'starting';
  Object.assign(rt, { [`${kind}TurnActive`]: false, [`${kind}SessionId`]: recovery.resume ? recovery.id : null,
    [`${kind}TranscriptPath`]: recovery.file, [`${kind}Resumed`]: recovery.resume });
  return rt;
}

function nativeArgs(kind, args, recovery, model) {
  const kept = [];
  // 저장된 시작 인자에 남은 선택자를 지우고, 정확히 하나의 대화 ID와 현재 모델만 준다.
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (['--resume', '-r', '--session-id', ...(kind === 'agy' ? ['--conversation', '--conversation-path'] : [])].includes(a)) {
      if (args[i + 1] != null && !String(args[i + 1]).startsWith('-')) i++;
      continue;
    }
    if (/^--(?:resume|session-id)=/.test(a) || /^-r.+/.test(a)) continue;
    if (kind === 'agy' && (/^--(?:conversation|conversation-path)=/.test(a) || a === '--continue' || a === '-c' || a.startsWith('--continue='))) continue;
    kept.push(a);
  }
  if (kind === 'agy') return [...(recovery.resume ? ['--conversation', recovery.id] : []), ...withAgyModel(kept, model)];
  return [recovery.resume ? '--resume' : '--session-id', recovery.id, ...withGeminiModel(kept, model)];
}

// 닫힌 까닭을 사람이 읽는 말로(사이드바)
export const CLOSE_REASON = {
  killed: '판에서 끔', 'pane gone': '패널이 없어짐', 'pane exited': '셸에서 나감', 'pane closed outside board': '판 밖에서 패널을 닫음',
  'workspace closed outside board': '판 밖에서 작업 공간을 닫음', 'not resumed after herdr restart': 'herdr를 다시 띄운 뒤 이어 가지 못함',
};
// 세션(열린 것이나 닫힌 행)의 Claude Code 대화 ID. /clear 뒤에는 hook이 알려 준 최신 대화 ID를 쓴다.
export function convOf(row) {
  if ((row.kind || 'claude') !== 'claude') return null;
  const rt = row.rt || row.runtime || {};
  if ((row.origin || 'board') === 'board') return String(rt.claudeSessionId || row.sessionId).toLowerCase();
  const id = rt.claudeSessionId || (rt.herdr && rt.herdr.agentSessionId);
  return id ? String(id).toLowerCase() : null;
}

export function attachRecall(b, opts = {}) { const r = new Recall(b, opts); if (opts.timers !== false) r.start(); return r; }

// 설정이 없는 판(단위 시험의 가짜 백엔드)은 저절로 보관과 리포 스스로 찾기를 끈 것으로 본다. 실제 백엔드는 늘 features.settings가 있다
const NO_SETTINGS = { archiveDays: 0, autoOpenRepos: false };
// 리포 스스로 찾기가 열지 않는 폴더: 홈 폴더, 드라이브 루트, 임시 폴더 아래(그 아래 모든 대화가 한 워크스페이스로 묶인다)
export function skipDiscoverDir(dir, { home = os.homedir(), tmp = os.tmpdir(), extra = [] } = {}) {
  const k = pathKey(dir);
  if (!k || /^[a-z]:\/?$/.test(k) || k === '/') return true;
  if (k === pathKey(home)) return true;
  return [tmp, ...extra].filter(Boolean).some((d) => k === pathKey(d) || k.startsWith(pathKey(d) + '/'));
}

export class Recall {
  constructor(b, { resolveCwd = workspaceOf, readProcs = claudeProcesses, settings = null, skipDir = null, trash = trashPaths } = {}) {
    this.trash = trash; // P13: 휴지통으로 보내기(단위 시험은 가짜를 넣는다)
    this.b = b; this.cfg = b.cfg; this.store = b.store;
    this.resolveCwd = resolveCwd; this.readProcs = readProcs;
    this.skipDir = skipDir || ((d) => skipDiscoverDir(d, { extra: [b.cfg.dataDir].filter(Boolean) }) || !!this.testDir(d)); // P13: 시험 폴더도 열지 않는다(missed)
    this.settings = settings || (() => (b.features && b.features.settings ? b.features.settings.get() : NO_SETTINGS));
    this.wsCache = new Map(); // pathKey(cwd) → { ws, at }
    this.desktopCache = new Map();
    this.live = new Map(); this.procs = new Map(); this.desktop = new Map();
    this.views = new Map(); // workspaceKey → { closed, convos, digest }
    this.lastScan = null;
    this.timers = [];
    this.nativeRecoveries = new Set();
    this.opening = new Set();
    this.handlers = {
      'recall.list': (p) => this.list(p),
      'recall.closed': (p) => this.closedList(p),
      'recall.reopen': (p) => this.reopen(p),
      'recall.dismiss': (p) => this.dismiss(p),
      'convo.list': (p) => this.convoList(p),
      'convo.open': (p) => this.openConvo(p),
      'convo.binding': (p) => this.bindingCheck(p),
      'convo.scan': () => this.scan({ wait: true }).then(() => this.lastScan),
      'archive.list': (p) => this.archiveList(p),
      'archive.add': (p) => this.archiveAdd(p),
      'archive.restore': (p) => this.archiveRestore(p),
      'archive.old': (p) => this.archiveOld(p),
      'convo.discover': () => this.discover().then((opened) => ({ opened: opened.map((w) => ({ key: w.key, root: w.root })) })),
      // P13
      'convo.nodes': () => this.canvasView(),
      'convo.move': (p) => this.moveConvo(p),
      'convo.subagents': (p) => this.subagents(p),
      'convo.classify': () => this.classifyCounts(),
      'missed.list': (p) => this.missedList(p),
      'missed.delete': (p) => this.missedDelete(p),
    };
    this.canvas = { nodes: [], edges: [], digest: '' }; // P13: 캔버스의 대화 노드와 띄움 선(changeOnce가 만든다)
    this.titleCache = new Map(); // P13: missed 목록의 제목(경로|수정 시각 → 제목). 판 기록에는 남기지 않는다
    if (this.store.getMeta('convoParser') !== CONVO_PARSER) { this.store.clearConvos(); this.store.setMeta('convoParser', CONVO_PARSER); }
    b.bus.on('closed', () => this.changed());
    b.bus.on('workspace', () => { if (this.scanning) this._rescan = true; else this.scan().catch(() => {}); });
    // P10: 사람이 닫은 워크스페이스는 기억해 다시 저절로 열지 않는다. 사람이 다시 열면 잊는다
    b.bus.on('workspace_closed', (key) => this.decline(key, true));
    b.bus.on('workspace_opened', (key) => { this.decline(key, false); this.store.setWorkspaceAuto(key, false); });
  }
  decline(key, on) {
    const set = new Set(this.store.getMeta('autoOpenDeclined') || []);
    if (on) set.add(key); else set.delete(key);
    this.store.setMeta('autoOpenDeclined', [...set]);
  }
  archiveDays() { const d = Number(this.settings().archiveDays); return Number.isFinite(d) && d > 0 ? d : 0; }
  // P13: 이 앱의 시험 폴더인가(missed.mjs testDirKind). 설정 값이 없는 가짜 백엔드(단위 시험)는 시험 폴더 규칙을 끈다
  testDir(cwd) { const c = this.cfg; return testDirKind(cwd, { codeRoots: c.codeRoots || [], tmp: c.tmpDir || null, prefix: c.testPrefix ?? null }); }
  // 대화 하나(색인 줄)가 지금 보관인가. 지금 다른 곳에서 열려 있는 대화는 저절로 보관하지 않는다
  convoArchive(c, marks = this.store.archiveMarks(), bind = null) {
    const mark = marks.get(itemKey('convo', c.convId)) || null;
    const st = archiveState({ lastAt: c.lastAt || c.mtime, mark, days: this.archiveDays() });
    if (st.why === 'auto' && bind && bind.open) return { archived: false, why: null, since: null };
    return st;
  }
  start() {
    this.refreshBindings();
    this.timers.push(setTimeout(() => this.scan().catch((e) => this.b.log('convo scan error', e.stack)), 300));
    this.timers.push(setInterval(() => this.scan().catch((e) => this.b.log('convo scan error', e.stack)), this.cfg.convoScanMs));
    this.timers.push(setInterval(() => { this.refreshBindings(); this.changed(); }, BINDING_MS));
    this.timers.push(setInterval(() => this.refreshProcs().then(() => this.changed()).catch(() => {}), PROCS_MS));
  }
  stop() { for (const t of this.timers) { clearTimeout(t); clearInterval(t); } this.timers = []; }

  // ---------- 묶임 출처 ----------
  refreshBindings() {
    this.live = readLiveSessions(this.cfg.claudeSessionsDir);
    this.desktop = readDesktopSessions(this.cfg.desktopSessionsDir, this.desktopCache);
  }
  async refreshProcs() { const rows = await this.readProcs(); if (rows) this.procs = parseClaudeCmdlines(rows); return this.procs; }
  // strict: 판 밖 대화(약한 신호까지 본다). 판이 아는 대화는 강한 신호(세션 파일, 명령줄, 데스크톱 앱)만 본다. 판이 띄운 claude가 막 끝난 대화가 "방금 기록됨"으로 막히지 않게
  bindingFor(convId, row, { strict = true } = {}) {
    const bind = bindingOf({ convId, entrypoints: row ? row.entrypoints : [], mtime: row ? row.mtime : 0, live: this.live, procs: this.procs, desktop: this.desktop });
    if (!strict && bind.bound && !bind.sure) return { bound: false };
    return bind;
  }

  // ---------- 대화 기록 색인(J3) ----------
  async resolveWs(cwd) {
    if (!cwd) return null;
    const k = pathKey(cwd);
    const c = this.wsCache.get(k);
    if (c && Date.now() - c.at < WS_TTL_MS) return c.ws;
    const ws = fs.existsSync(cwd) ? await this.resolveCwd(cwd).catch(() => null) : { key: k, kind: 'folder', root: normPath(cwd), gone: true };
    this.wsCache.set(k, { ws, at: Date.now() });
    return ws;
  }
  // P27: 워크트리가 새로 생기면 그 폴더의 대화가 "폴더 없음"으로 기억돼 있을 수 있다(대화 기록이 폴더보다 먼저 읽혔다). 없던 폴더의 풀이만 잊는다
  // 그 대화는 글 없이 색인돼 있으므로(missed였다) 바로 다시 훑어 글을 채운다(훑기 끝에 대화 노드도 다시 놓는다)
  onWorktreesChanged() {
    for (const [k, v] of this.wsCache) if (v.ws && v.ws.gone) this.wsCache.delete(k);
    if (this.scanning) this._rescan = true; else this.scan().catch(() => {});
  }
  // 여러 폴더를 한 번에(git 8개씩 함께). 백엔드를 다시 띄운 뒤 첫 훑기에서 폴더 수십 개를 하나씩 풀면 몇 초 걸린다
  async resolveMany(cwds) {
    const todo = [...new Set(cwds.filter(Boolean))].filter((c) => { const x = this.wsCache.get(pathKey(c)); return !x || Date.now() - x.at >= WS_TTL_MS; });
    for (let i = 0; i < todo.length; i += 8) await Promise.all(todo.slice(i, i + 8).map((c) => this.resolveWs(c)));
  }
  matchWorkspace(cwd, resolved, open = this.store.workspaces()) { return open.find((w) => inWorkspace(w, cwd, resolved)) || null; }

  // 대화 기록 폴더를 훑는다. 바뀐 파일만 머리와 꼬리를 읽는다. 글(제목, 지시, 답)은 열린 워크스페이스의 대화만 저장한다(다른 대화의 글을 판 기록에 옮기지 않는다)
  scan({ wait = false } = {}) {
    if (this.scanning) return wait ? this.scanning : Promise.resolve(this.lastScan);
    this.scanning = this._scan().finally(() => { this.scanning = null; if (this._rescan) { this._rescan = false; this.scan().catch(() => {}); } });
    return this.scanning;
  }
  async _scan() {
    const t0 = Date.now();
    const files = await listTranscriptFiles(this.cfg.convoRoots);
    const known = new Map(this.store.convoIndex().map((c) => [c.path, c]));
    const open = this.store.workspaces();
    const marks = this.store.archiveMarks();
    let read = 0, failed = 0, skipped = 0;
    const want = [];
    for (let i = 0; i < files.length; i += 32) {
      const part = files.slice(i, i + 32);
      const stats = await Promise.all(part.map((f) => fs.promises.stat(f.path).catch(() => null)));
      part.forEach((f, j) => { if (stats[j]) want.push({ ...f, size: stats[j].size, mtime: Math.round(stats[j].mtimeMs) }); });
    }
    await this.resolveMany([...known.values()].map((k) => k.cwd));
    const todo = [], touched = [];
    for (const f of want) {
      const k = known.get(f.path);
      if (k && k.size === f.size && k.mtime === f.mtime) {
        if (k.hasText || !k.cwd) continue;
        // 글 없이 둔 대화가 이제 열린 워크스페이스에 들면 다시 읽어 글을 채운다. 보관된 대화는 채우지 않는다(보관함을 열 때 그 리포 것만, P10)
        if (this.convoArchive(k, marks).archived) { skipped++; continue; }
        const ws = await this.resolveWs(k.cwd);
        if (this.matchWorkspace(k.cwd, ws, open)) todo.push(f);
        continue;
      }
      // 손으로 보관한 대화는 파일이 바뀌어도 머리·꼬리를 다시 읽지 않고 크기와 시각만 고친다(P10)
      if (k && k.cwd) { const m = marks.get(itemKey('convo', k.convId)); if (m && m.archivedAt) { touched.push(f); skipped++; continue; } }
      todo.push(f);
    }
    const rows = [];
    for (let i = 0; i < todo.length; i += 8) {
      const part = todo.slice(i, i + 8);
      const sums = await Promise.all(part.map((f) => readTranscriptSummary(f.path, { size: f.size }).catch(() => null)));
      const subs = await Promise.all(part.map((f) => countSubagents(f.path))); // P13
      await this.resolveMany(sums.map((x) => x && x.cwd));
      for (let j = 0; j < part.length; j++) {
        const f = part[j], sum = sums[j];
        if (!sum) { failed++; continue; }
        read++;
        const ws = await this.resolveWs(sum.cwd);
        const text = !!(sum.cwd && this.matchWorkspace(sum.cwd, ws, open));
        const k = known.get(f.path);
        // P13: 띄움 줄은 이어 읽는다(파일이 줄었으면 처음부터 다시). 글이 아니라 시각·이름·해시만 둔다
        const keep = k && f.size >= k.size ? { spawns: k.spawns, spawnOff: k.spawnOff } : { spawns: [], spawnOff: 0 };
        rows.push({ path: f.path, convId: f.convId, size: f.size, mtime: f.mtime, cwd: sum.cwd, branch: sum.branch, entrypoints: sum.entrypoints, prompts: sum.prompts, answers: sum.answers, firstAt: sum.firstAt, lastAt: sum.lastAt,
          hasText: text, title: text ? sum.title : null, titleSource: text ? sum.titleSource : null, firstPrompt: text ? sum.firstPrompt : null, lastPrompt: text ? sum.lastPrompt : null, lastAnswer: text ? sum.lastAnswer : null, scannedAt: Date.now(),
          startAt: sum.startAt, promptKey: sum.promptKey, subagents: subs[j], ...keep });
      }
    }
    const gone = [...known.keys()].filter((p) => !want.some((f) => f.path === p));
    if (rows.length || gone.length || touched.length) this.store.tx(() => { for (const r of rows) this.store.putConvo(r); for (const f of touched) this.store.touchConvo(f.path, f.size, f.mtime); this.store.dropConvos(gone); });
    const opened = await this.discover().catch((e) => { this.b.log('discover error', e.stack); return []; });
    this.lastScan = { at: Date.now(), ms: Date.now() - t0, files: want.length, read, failed, skipped, dropped: gone.length, roots: this.cfg.convoRoots.length, opened: opened.map((w) => w.key) };
    if (opened.length) this._rescan = true; // 새로 연 리포의 대화 글을 바로 채운다
    await this.changed({ force: true });
    // P13: 띄움 줄(늘어난 부분만). 목록을 먼저 보인 뒤 읽고, 읽은 것이 있으면 관계를 다시 그린다
    const sp = await this.scanSpawns(want).catch((e) => { this.b.log('spawn scan error', e.stack); return null; });
    if (sp) { this.lastScan.spawns = sp; if (sp.read) await this.changed(); }
    return this.lastScan;
  }
  // P13: 바뀐 대화 기록의 띄움 줄을 읽은 바이트 위치부터 끝까지 읽는다. 마지막 활동이 SPAWN_DAYS 안인 것만(처음 훑기를 가볍게)
  async scanSpawns(files) {
    const t0 = Date.now();
    const idx = new Map(this.store.convoIndex().map((c) => [c.path, c]));
    const since = Date.now() - SPAWN_DAYS * 86400000;
    const todo = files.filter((f) => { const c = idx.get(f.path); return c && f.mtime >= since && (c.spawnOff || 0) !== f.size; });
    let read = 0, bytes = 0, found = 0;
    for (let i = 0; i < todo.length; i += 4) {
      const part = todo.slice(i, i + 4);
      const got = await Promise.all(part.map((f) => { const c = idx.get(f.path); const from = (c.spawnOff || 0) <= f.size ? c.spawnOff || 0 : 0; return readSpawns(f.path, { from, size: f.size }).then((r) => ({ f, c, from, r })).catch(() => null); }));
      this.store.tx(() => {
        for (const g of got) {
          if (!g) continue;
          read++; bytes += g.r.off - g.from; found += g.r.spawns.length;
          this.store.setConvoSpawns(g.f.path, g.from ? mergeSpawns(g.c.spawns, g.r.spawns) : mergeSpawns([], g.r.spawns), g.r.off);
        }
      });
    }
    return { files: todo.length, read, bytes, found, ms: Date.now() - t0 };
  }
  // 보관된 대화의 글을 채운다(보관함에서 그 리포를 볼 때). 열린 워크스페이스의 것만
  async fillText(rows) {
    const open = this.store.workspaces();
    let n = 0;
    for (let i = 0; i < rows.length; i += 8) {
      const part = rows.slice(i, i + 8);
      const sums = await Promise.all(part.map((c) => readTranscriptSummary(c.path).catch(() => null)));
      for (let j = 0; j < part.length; j++) {
        const c = part[j], sum = sums[j];
        if (!sum || !sum.cwd) continue;
        const ws = await this.resolveWs(sum.cwd);
        if (!this.matchWorkspace(sum.cwd, ws, open)) continue;
        this.store.putConvo({ ...c, cwd: sum.cwd, branch: sum.branch, entrypoints: sum.entrypoints, prompts: sum.prompts, answers: sum.answers, firstAt: sum.firstAt, lastAt: Math.max(sum.lastAt || 0, c.lastAt || 0) || null, hasText: true, title: sum.title, titleSource: sum.titleSource, firstPrompt: sum.firstPrompt, lastPrompt: sum.lastPrompt, lastAnswer: sum.lastAnswer, scannedAt: Date.now() });
        n++;
      }
    }
    return n;
  }

  // ---------- 리포 스스로 찾기(P10) ----------
  // 기간 안에 활동한 터미널(cli) 출처 대화의 리포 중 열려 있지 않은 것을 빈 워크스페이스로 연다(노드는 띄우지 않는다).
  // 데스크톱 앱 출처만 있는 리포, 사람이 닫은 워크스페이스, 없어진 폴더, 홈·드라이브 루트·임시 폴더는 열지 않는다
  async discover() {
    const set = this.settings();
    if (!set.autoOpenRepos || !this.b.ensureWorkspace) return [];
    const declined = new Set(this.store.getMeta('autoOpenDeclined') || []);
    const marks = this.store.archiveMarks();
    const days = this.archiveDays() || DISCOVER_DAYS;
    const now = Date.now();
    const open = [...this.store.workspaces()];
    const rows = this.store.convoIndex().filter((c) => c.cwd && discoverable({ entrypoints: c.entrypoints, prompts: c.prompts, lastAt: c.lastAt || c.mtime, mark: marks.get(itemKey('convo', c.convId)), now, days }));
    rows.sort((a, b) => pathKey(a.cwd).length - pathKey(b.cwd).length); // 위 폴더부터(폴더 워크스페이스가 아래 폴더의 대화를 담는다)
    await this.resolveMany(rows.map((c) => c.cwd));
    const opened = [];
    for (const c of rows) {
      if (this.skipDir(c.cwd)) continue;
      const ws = await this.resolveWs(c.cwd);
      if (!ws || ws.gone || !ws.key || this.skipDir(ws.root)) continue;
      if (declined.has(ws.key) || this.matchWorkspace(c.cwd, ws, open)) continue;
      if (!fs.existsSync(ws.root)) continue;
      this.b.ensureWorkspace({ ...ws, auto: true }, 'auto discover');
      this.store.setWorkspaceAuto(ws.key, true);
      const w = this.store.getWorkspace(ws.key);
      if (!w) continue;
      open.push(w); opened.push(w);
      this.store.addEvent(null, 'workspace_auto_opened', { key: ws.key, kind: ws.kind, root: ws.root });
      this.b.log(`auto opened workspace ${ws.root}`);
    }
    if (opened.length && this.b.broadcastWorkspaces) this.b.broadcastWorkspaces();
    return opened;
  }

  // ---------- 목록(J2·J3) ----------
  closedView(row, names) {
    const rt = row.runtime || {};
    const conv = convOf(row);
    const idx = conv ? this.store.getConvoById(conv) : null;
    const bind = conv ? this.bindingFor(conv, idx, { strict: false }) : { bound: false };
    const native = NATIVE_KINDS.has(row.kind);
    // closedSessions의 요약에는 토큰이 없다. agy 관리 여부는 완전한 저장 행으로 확인한다.
    const recovery = native ? nativeRecovery(row.kind === 'agy' ? this.store.getSession(row.sessionId) || row : row) : null;
    return {
      sessionId: row.sessionId, name: row.name, kind: row.kind, flavor: row.flavor || null, origin: row.origin, cwd: row.cwd, workspaceKey: row.workspaceKey, closedAt: row.closedAt, createdAt: row.createdAt,
      reason: row.reason, reasonLabel: CLOSE_REASON[row.reason] || row.reason || null,
      lastPrompt: clip(rt.lastPrompt, 300), lastAnswer: clip(rt.lastAnswer, 300), lastActivityAt: Math.max(rt.lastActivityAt || 0, row.closedAt || 0) || null,
      convId: conv, hasTranscript: native ? !!recovery?.resume : !!idx, binding: bind, canReopen: native ? !!recovery : !bind.bound, nameFree: !names.has(row.name),
    };
  }
  closedArchive(row, marks, view) {
    const mark = marks.get(itemKey('session', row.sessionId)) || null;
    return archiveState({ lastAt: view.lastActivityAt || row.closedAt, mark, days: this.archiveDays() });
  }
  convoRowView(c, ws, w) {
    const worktree = !!(ws && ws.kind === 'repo' && !pathKey(c.cwd).startsWith(pathKey(ws.root)));
    const view = convoView({ ...c, worktree, branch: ws && ws.kind === 'repo' ? c.branch : null }, { binding: this.bindingFor(c.convId, c), root: w.root });
    if (worktree && !view.folder) view.folder = normPath(c.cwd).split('/').pop();
    return view;
  }
  // 워크스페이스마다 기본 목록(보관되지 않은 닫힌 세션과 판 밖 대화)과 보관된 수. archived: true면 보관된 것만 모은다(보관함). only: 워크스페이스 하나만
  async compute({ archived = false, only = null } = {}) {
    this.refreshBindings(); // 세션 파일과 데스크톱 목록(바뀐 파일만)은 몇 ms라 계산마다 다시 읽는다
    const open = this.store.workspaces();
    const boardConvs = this.store.boardConversations();
    const marks = this.store.archiveMarks();
    const names = new Set([...this.b.sessions.values()].map((s) => s.name));
    const out = new Map(open.filter((w) => !only || w.key === only).map((w) => [w.key, { closed: [], convos: [], archived: 0 }]));
    for (const row of this.store.closedSessions()) {
      const v = out.get(row.workspaceKey);
      if (!v) continue;
      const view = this.closedView(row, names);
      const st = this.closedArchive(row, marks, view);
      if (st.archived) v.archived++;
      if (st.archived !== archived || v.closed.length >= LIST_LIMIT) continue;
      v.closed.push(archived ? { ...view, archive: st } : view);
    }
    const rows = this.store.convoIndex().filter((c) => c.cwd && c.prompts > 0 && !boardConvs.has(c.convId));
    rows.sort((a, b) => (b.lastAt || b.mtime) - (a.lastAt || a.mtime));
    const onCanvas = new Set(this.canvas.nodes.map((n) => n.convId));
    for (const c of rows) {
      const bind = this.bindingFor(c.convId, c);
      const cl = this.classOf(c, { bind, boardConvs, marks });
      if (cl.cls === 'missed' || cl.cls === 'live') continue; // P13: missed(와 시험 폴더에서 도는 대화)는 사이드바 기본 목록에 없다(missed 함). 데스크톱 줄은 P7처럼 묶임 표시로 둔다
      const st = this.convoArchive(c, marks, bind);
      if (st.archived !== archived) {
        // 기본 목록을 셀 때 보관된 것은 워크스페이스를 새로 풀지 않고(git을 부르지 않고) 이미 푼 것만 센다
        if (st.archived) { const x = this.wsCache.get(pathKey(c.cwd)); const w = x ? this.matchWorkspace(c.cwd, x.ws, open) : null; if (w && out.has(w.key)) out.get(w.key).archived++; }
        continue;
      }
      const ws = await this.resolveWs(c.cwd);
      const w = this.matchWorkspace(c.cwd, ws, open);
      if (!w || !out.has(w.key)) continue;
      const v = out.get(w.key);
      if (archived) v.archived++;
      if (v.convos.length >= LIST_LIMIT) continue;
      const view = this.convoRowView(c, ws, w);
      if (onCanvas.has(c.convId)) view.onCanvas = true; // P13: 캔버스에 대화 노드가 있다(누르면 그 노드로 간다)
      v.convos.push(archived ? { ...view, archive: st, hasText: c.hasText } : view);
    }
    return out;
  }
  // 바뀐 워크스페이스가 있으면 창에 알린다(recall.updated). 창은 사이드바를 연 동안 다시 읽는다.
  // 계산은 한 번에 하나만 돌고, 도는 중에 온 부름은 다음 계산 하나로 모은다. 돌려주는 약속은 그 부름 뒤의 계산이 끝날 때 풀린다(P10: 보관 바로 뒤의 recall.list가 옛 목록을 받지 않게)
  changed({ force = false } = {}) {
    if (this._queued) { this._queued.force = this._queued.force || force; return this._queued.p; }
    const q = { force };
    const prev = this._running || Promise.resolve();
    q.p = prev.catch(() => {}).then(async () => {
      this._queued = null; this._running = q.p;
      try { await this.changeOnce(q.force); } finally { if (this._running === q.p) this._running = null; }
    });
    this._queued = q;
    return q.p;
  }
  async changeOnce(force) {
    await this.layoutCanvas().catch((e) => this.b.log('convo canvas error', e.stack)); // P13: 캔버스의 대화 노드(사이드바의 onCanvas 표시가 이것을 본다)
    const views = await this.compute();
    const missed = this.missedRows().length; // P13: 사이드바 missed 함의 수
    const missedChanged = missed !== this.missedCount; this.missedCount = missed;
    const keys = [];
    for (const [k, v] of views) { const digest = JSON.stringify(v); const prev = this.views.get(k); if (!prev || prev.digest !== digest) keys.push(k); this.views.set(k, { ...v, digest }); }
    for (const k of [...this.views.keys()]) if (!views.has(k)) { this.views.delete(k); keys.push(k); }
    if (keys.length || force || missedChanged) this.b.api.broadcast('recall.updated', { workspaces: keys, scannedAt: this.lastScan ? this.lastScan.at : null, missed });
  }
  async list(p = {}) {
    if (this._queued || this._running) await (this._queued ? this._queued.p : this._running).catch(() => {}); // 도는 계산이 있으면 그 결과를 준다
    if (!this.views.size && this.store.workspaces().length) await this.changed();
    const want = p.workspace ? await this.b.resolveWorkspace(p.workspace) : null;
    const names = workspaceNames(this.store.workspaces());
    const workspaces = [...this.views.entries()].filter(([k]) => !want || k === want.key).map(([key, v]) => ({ key, name: names.get(key) || key, closed: v.closed, convos: v.convos, archived: v.archived || 0 }));
    return { scannedAt: this.lastScan ? this.lastScan.at : null, scan: this.lastScan, workspaces, missed: this.missedCount || 0 };
  }
  async closedList(p = {}) { const r = await this.list(p); return r.workspaces.flatMap((w) => w.closed); }
  async convoList(p = {}) { if (p.refresh) await this.scan({ wait: true }); const r = await this.list(p); return r.workspaces.flatMap((w) => w.convos.map((c) => ({ ...c, workspaceKey: w.key }))); }
  async bindingCheck(p) {
    const id = String(p.convo || '').toLowerCase();
    this.refreshBindings(); await this.refreshProcs();
    const row = this.store.getConvoById(id);
    const known = this.store.boardConversations().get(id) || null;
    return { convId: id, indexed: !!row, board: known, binding: this.bindingFor(id, row && { ...row, mtime: this.mtimeNow(row) }, { strict: !known }) };
  }
  mtimeNow(row) { try { return Math.round(fs.statSync(row.path).mtimeMs); } catch { return row.mtime; } }

  // ---------- P13: 분류 ----------
  // 폴더가 남아 있는가(30초 기억). 워크스페이스 풀이가 이미 없어졌다고 했으면 그것을 쓴다
  cwdExists(cwd) {
    if (!cwd) return false;
    const k = pathKey(cwd);
    const w = this.wsCache.get(k);
    if (w && w.ws && w.ws.gone) return false;
    this.existsCache ||= new Map();
    const e = this.existsCache.get(k);
    if (e && Date.now() - e.at < 30000) return e.v;
    const v = fs.existsSync(cwd);
    this.existsCache.set(k, { v, at: Date.now() });
    return v;
  }
  classOf(c, { bind = this.bindingFor(c.convId, c), boardConvs = this.store.boardConversations(), marks = this.store.archiveMarks() } = {}) {
    const archived = this.convoArchive(c, marks, bind).archived;
    return classifyConvo({ row: c, binding: bind, boardKnown: boardConvs.has(c.convId), archived, exists: this.cwdExists(c.cwd), testDir: c.cwd ? this.testDir(c.cwd) : null });
  }
  // 분류별 수(atrium classify, 보고). 글은 내지 않는다
  classifyCounts() {
    this.refreshBindings();
    const boardConvs = this.store.boardConversations(), marks = this.store.archiveMarks();
    const out = { files: 0, byClass: {}, running: 0, missedWhy: {}, onCanvas: this.canvas.nodes.length };
    for (const c of this.store.convoIndex()) {
      out.files++;
      const bind = this.bindingFor(c.convId, c);
      const cl = this.classOf(c, { bind, boardConvs, marks });
      out.byClass[cl.cls] = (out.byClass[cl.cls] || 0) + 1;
      if (bind.open && (cl.cls === 'board' || cl.cls === 'live')) out.running++;
      if (cl.cls === 'missed') out.missedWhy[cl.why] = (out.missedWhy[cl.why] || 0) + 1;
    }
    return out;
  }

  // ---------- P13: 캔버스의 대화 노드 ----------
  // 대화의 워크트리 블록 이름(w: 대화가 든 워크스페이스). 폴더가 .claude/worktrees/<이름> 아래면 그 이름(Claude Code 워크트리).
  // 리포 워크스페이스에서 본 저장소 폴더 밖(다른 곳의 git 워크트리)이면 그 폴더 이름. 본 저장소면 ''
  blockOf(c, w) {
    if (!w || !c.cwd) return '';
    const rel = pathKey(c.cwd).startsWith(pathKey(w.root) + '/') ? normPath(c.cwd).slice(normPath(w.root).length) : null;
    const m = /^\/\.claude\/worktrees\/([^/]+)/.exec(rel || '') || (rel == null ? /\/\.claude\/worktrees\/([^/]+)/.exec(normPath(c.cwd)) : null);
    if (m) return m[1];
    if (w.kind === 'repo' && rel == null && pathKey(c.cwd) !== pathKey(w.root)) return normPath(c.cwd).split('/').pop();
    return '';
  }
  // 캔버스에 올릴 대화(분류 board, 열린 워크스페이스, 영역마다 최근 CONVO_CAP개)의 자리를 정하고, 노드와 띄움 선을 만든다. 바뀌면 convo.nodes를 보낸다
  // 한 번에 하나만 돈다(도는 중에 또 부르면 그 뒤에 한 번 더)
  layoutCanvas() { this._layout = (this._layout || Promise.resolve()).catch(() => {}).then(() => this._layoutCanvas()); return this._layout; }
  async _layoutCanvas() {
    const b = this.b;
    const open = this.store.workspaces();
    const boardConvs = this.store.boardConversations(), marks = this.store.archiveMarks();
    const rows = this.store.convoIndex();
    const byId = new Map();
    for (const r of rows) { const p = byId.get(r.convId); if (!p || (r.lastAt || 0) > (p.lastAt || 0)) byId.set(r.convId, r); }
    const per = new Map();
    const binds = new Map();
    for (const c of byId.values()) {
      if (!c.cwd || !c.prompts) continue;
      const bind = this.bindingFor(c.convId, c);
      binds.set(c.convId, bind);
      if (this.classOf(c, { bind, boardConvs, marks }).cls !== 'board') continue;
      const ws = await this.resolveWs(c.cwd);
      const w = ws && this.matchWorkspace(c.cwd, ws, open);
      if (!w) continue;
      if (!per.has(w.key)) per.set(w.key, []);
      per.get(w.key).push({ c, ws, w });
    }
    const want = new Map();
    for (const list of per.values()) { list.sort((a, b2) => (b2.c.lastAt || b2.c.mtime) - (a.c.lastAt || a.c.mtime)); for (const x of list.slice(0, CONVO_CAP)) want.set(x.c.convId, x); }
    // 자리: 이미 있는 줄은 그대로(숨겼던 것은 그 자리가 비었으면 그대로 다시 보인다), 새것만 영역 안 격자에
    const rowsN = new Map(this.store.convoNodes().map((n) => [n.convId, n]));
    const hide = [...rowsN.values()].filter((n) => n.shown && !want.has(n.convId)).map((n) => n.convId);
    if (hide.length) this.store.setConvoNodesShown(hide, false);
    // P27: 대화의 폴더가 살아 있는 워크트리 안이면 그 워크트리 영역(x.area: 워크트리 경로 키, 본 저장소는 ''). 저장한 영역과 다르면 그 영역에 새로 놓는다
    for (const x of want.values()) x.area = b.worktrees ? b.worktrees.areaOf(x.w.key, x.c.cwd) : '';
    const moving = new Set([...want].filter(([id, x]) => { const n = rowsN.get(id); return n && n.workspaceKey === x.w.key && (n.area || '') !== x.area; }).map(([id]) => `convo:${id}`));
    let items = canvasItems(b).filter((i) => !moving.has(i.id));
    const fresh = new Map(); // 영역 키 → [cards]
    const reshow = [];
    for (const [id, x] of want) {
      const n = rowsN.get(id);
      const same = n && n.workspaceKey === x.w.key && (n.area || '') === x.area;
      const ak = areaKey(x.w.key, x.area);
      if (n && n.shown && same) continue;
      if (n && !n.shown && same && !items.some((i) => overlaps(n, i, 8))) { reshow.push(id); items.push({ id: `convo:${id}`, kind: 'convo', ws: ak, wsKey: x.w.key, x: n.x, y: n.y, w: n.w, h: n.h }); continue; }
      if (!fresh.has(ak)) fresh.set(ak, []);
      fresh.get(ak).push(id);
    }
    if (reshow.length) this.store.setConvoNodesShown(reshow, true);
    let placed = 0;
    for (const [ak, ids] of fresh) {
      const { ws: wsKey, wt } = parseArea(ak);
      const wrow = wt ? (this.store.worktreeAreas ? this.store.worktreeAreas().find((a) => a.wsKey === wsKey && a.wt === wt) : null) : this.store.getWorkspace(wsKey);
      const mine = new Map(items.filter((i) => i.kind === 'convo' && i.ws === ak).map((i) => [i.id.slice(6), { x: i.x, y: i.y, w: i.w, h: i.h }]));
      // 워크트리 영역 안에서는 워크트리 블록(배경)을 따로 두지 않는다(영역이 곧 그 워크트리다)
      const cards = [...want.values()].filter((x) => x.w.key === wsKey && x.area === wt).map((x) => ({ id: x.c.convId, block: wt ? '' : this.blockOf(x.c, x.w), at: x.c.lastAt || x.c.mtime }));
      const at = placeCards({ wsKey: ak, cards: cards.filter((c) => mine.has(c.id) || ids.includes(c.id)), placed: mine, items: items.filter((i) => i.kind !== 'convo' || i.ws !== ak), anchor: wrow && wrow.x != null ? { x: wrow.x, y: wrow.y } : null });
      this.store.tx(() => { for (const [id, r] of at) this.store.putConvoNode({ convId: id, workspaceKey: wsKey, x: Math.round(r.x), y: Math.round(r.y), w: r.w, h: r.h, shown: true, area: wt }); });
      for (const [id, r] of at) items.push({ id: `convo:${id}`, kind: 'convo', ws: ak, wsKey, ...r });
      placed += at.size;
    }
    if (placed || reshow.length) { settleRegions(b, 'convo nodes'); this.store.addEvent(null, 'convo_nodes_placed', { placed, reshown: reshow.length, hidden: hide.length }); }
    // 노드와 띄움 선
    const shown = this.store.shownConvoNodes();
    const shownIds = new Set(shown.map((n) => n.convId));
    const openSess = new Map([...boardConvs].filter(([, v]) => v.open).map(([id, v]) => [id, v.sessionId]));
    const nodeIdOf = (conv) => openSess.get(conv) || (shownIds.has(conv) ? `convo:${conv}` : null);
    const rel = matchSpawns([...byId.values()].filter((r) => r.startAt).map((r) => ({ convId: r.convId, cwd: r.cwd, startAt: r.startAt, promptKey: r.promptKey, spawns: r.spawns })));
    this.relations = rel;
    const kids = new Map();
    for (const [child, r] of rel) kids.set(r.parent, (kids.get(r.parent) || 0) + 1);
    const edges = [];
    for (const [child, r] of rel) { const from = nodeIdOf(r.parent), to = nodeIdOf(child); if (from && to && from !== to) edges.push({ id: `spawn:${r.parent}:${child}`, from, to, via: r.via, name: r.name, by: r.by, at: r.at }); }
    const names = workspaceNames(open);
    const nodes = shown.map((n) => {
      const c = byId.get(n.convId);
      if (!c) return null;
      const x = want.get(n.convId);
      const bind = binds.get(n.convId) || this.bindingFor(n.convId, c);
      const r = rel.get(n.convId);
      const parentNode = r ? nodeIdOf(r.parent) : null;
      return {
        convId: n.convId, workspaceKey: n.workspaceKey, wsName: names.get(n.workspaceKey) || null, x: n.x, y: n.y, w: n.w, h: n.h,
        block: x && !x.area ? this.blockOf(c, x.w) : '', area: n.area || '', cwd: c.cwd ? normPath(c.cwd) : null, branch: c.branch || null, // P27: area(놓인 워크트리 영역)
        title: c.title || null, firstPrompt: c.firstPrompt || null, lastPrompt: c.lastPrompt || null, lastAnswer: c.lastAnswer || null, lastAt: c.lastAt || c.mtime || null, prompts: c.prompts || 0,
        subagents: c.subagents || 0, binding: bind, canOpen: !bind.bound, children: kids.get(n.convId) || 0,
        spawnedBy: r ? { via: r.via, name: r.name, at: r.at, onCanvas: !!parentNode, label: parentNode ? null : this.parentLabel(r.parent, byId.get(r.parent), boardConvs, marks), labelMsg: parentNode ? null : this.parentLabelMsg(r.parent, byId.get(r.parent), boardConvs, marks) } : null,
      };
    }).filter(Boolean);
    const digest = JSON.stringify([nodes, edges]);
    if (digest !== this.canvas.digest) { this.canvas = { nodes, edges, digest }; b.api.broadcast('convo.nodes', { nodes, edges }); }
    return this.canvas;
  }
  // 부모가 캔버스에 없을 때 노드에 적는 "띄운 곳" 글. 글이 저장된 대화(열린 워크스페이스)면 제목, 아니면 분류와 폴더 이름
  parentLabel(conv, row, boardConvs, marks) {
    const known = boardConvs.get(conv);
    if (known) return known.open ? '판 세션' : '닫힌 판 세션';
    if (!row) return '다른 대화';
    const cl = this.classOf(row, { boardConvs, marks });
    const folder = row.cwd ? normPath(row.cwd).split('/').pop() : null;
    if (cl.cls === 'desktop') return '데스크톱 앱 대화';
    if (cl.cls === 'missed') return `missed 대화${folder ? ` · ${folder}` : ''}`;
    if (cl.cls === 'archived') return `보관된 대화${row.title ? ` · ${clip(row.title, 40)}` : ''}`;
    return row.title ? clip(row.title, 60) : `대화 · ${folder || conv.slice(0, 8)}`;
  }
  // P16: 같은 글을 화면 글 열쇠로(창이 번역한다). 대화 제목은 사용자 내용이라 그대로 넣는다
  parentLabelMsg(conv, row, boardConvs, marks) {
    const known = boardConvs.get(conv);
    if (known) return m(known.open ? 'parentBoard' : 'parentBoardClosed');
    if (!row) return m('parentOther');
    const cl = this.classOf(row, { boardConvs, marks });
    const folder = row.cwd ? normPath(row.cwd).split('/').pop() : null;
    if (cl.cls === 'desktop') return m('parentDesktop');
    if (cl.cls === 'missed') return m(folder ? 'parentMissedIn' : 'parentMissed', { folder });
    if (cl.cls === 'archived') return m(row.title ? 'parentArchivedTitle' : 'parentArchived', { title: row.title ? clip(row.title, 40) : '' });
    return row.title ? m('plain', { text: clip(row.title, 60) }) : m('parentConvo', { name: folder || conv.slice(0, 8) });
  }
  canvasView() { return { nodes: this.canvas.nodes, edges: this.canvas.edges }; }
  moveConvo(p) {
    const id = String(p.convo || '').toLowerCase();
    const n = this.store.convoNodes().find((x) => x.convId === id);
    if (!n) throw apiError('not_found', `캔버스에 없는 대화: ${p.convo}`);
    const x = Math.round(Number(p.x)), y = Math.round(Number(p.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw apiError('bad_request', 'x, y');
    this.store.putConvoNode({ ...n, x, y, movedAt: Date.now() });
    const v = this.canvas.nodes.find((m) => m.convId === id);
    if (v) { v.x = x; v.y = y; this.canvas.digest = JSON.stringify([this.canvas.nodes, this.canvas.edges]); }
    return { ok: true };
  }
  async subagents(p) {
    const row = this.store.getConvoById(String(p.convo || '').toLowerCase());
    if (!row) throw apiError('not_found', `대화 기록을 찾지 못했다: ${p.convo}`);
    return { convId: row.convId, subagents: await listSubagents(row.path) };
  }

  // ---------- P13: missed(지울 대화) ----------
  // 폴더(대화의 cwd)마다 수, 크기(대화 기록과 옆 폴더), 마지막 활동. 제목은 그때그때 읽고 판 기록에 남기지 않는다
  missedRows() {
    this.refreshBindings();
    const boardConvs = this.store.boardConversations(), marks = this.store.archiveMarks();
    return this.store.convoIndex().filter((c) => { const cl = this.classOf(c, { boardConvs, marks }); if (cl.cls !== 'missed') return false; c.why = cl.why; return true; });
  }
  dirSize(dir) {
    let n = 0;
    const walk = (d, depth) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) { if (depth < 6) walk(p, depth + 1); } else { try { n += fs.statSync(p).size; } catch {} } } };
    walk(dir, 0);
    return n;
  }
  async titleOf(c) {
    const k = `${c.path}|${c.mtime}`;
    if (this.titleCache.has(k)) return this.titleCache.get(k);
    const s = await readTranscriptSummary(c.path, { size: c.size }).catch(() => null);
    const t = s ? s.title || null : null;
    if (this.titleCache.size > 2000) this.titleCache.clear();
    this.titleCache.set(k, t);
    return t;
  }
  async missedList(p = {}) {
    const rows = this.missedRows().sort((a, b) => (b.lastAt || b.mtime) - (a.lastAt || a.mtime));
    const groups = new Map();
    let bytes = 0, titled = 0;
    for (const c of rows) {
      const folder = c.cwd ? normPath(c.cwd) : '(폴더 모름)';
      const size = c.size + this.dirSize(c.path.slice(0, -6));
      bytes += size;
      const title = p.titles === false || titled >= MISSED_TITLE_MAX ? null : (titled++, await this.titleOf(c));
      if (!groups.has(folder)) groups.set(folder, { folder, why: c.why, count: 0, bytes: 0, lastAt: 0, items: [] });
      const g = groups.get(folder);
      g.count++; g.bytes += size; g.lastAt = Math.max(g.lastAt, c.lastAt || c.mtime || 0);
      g.items.push({ convId: c.convId, size, lastAt: c.lastAt || c.mtime || null, why: c.why, title, prompts: c.prompts, subagents: c.subagents || 0 });
    }
    const list = [...groups.values()].sort((a, b) => b.lastAt - a.lastAt);
    return { count: rows.length, bytes, folders: list };
  }
  // 지우기: convos(대화 ID 목록) | folder(그 폴더의 모든 missed) | all. confirm이 없으면 수, 크기, 폴더 목록과 확인 문구만.
  // 지우기 직전에 묶임을 다시 판정하고(세션 파일, 명령줄, 데스크톱 목록, 방금 기록됨), 휴지통으로 보낸 뒤 색인과 대화 노드에서 뺀다
  async missedDelete(p = {}) {
    const rows = this.missedRows();
    let targets;
    if (p.all) targets = rows;
    else if (p.folder) { const k = pathKey(p.folder); targets = rows.filter((c) => (c.cwd ? pathKey(c.cwd) : '(폴더 모름)') === k || (!c.cwd && p.folder === '(폴더 모름)')); }
    else if (Array.isArray(p.convos) || p.convo) {
      const ids = new Set([].concat(p.convos || [], p.convo || []).map((x) => String(x).toLowerCase()));
      targets = rows.filter((c) => ids.has(c.convId));
      for (const id of ids) if (!targets.some((c) => c.convId === id)) { const row = this.store.getConvoById(id); if (row) targets.push({ ...row, notMissed: true }); else targets.push({ convId: id, path: '', notFound: true }); }
    } else throw apiError('bad_request', 'all, folder, convos 중 하나가 필요하다');
    const folders = new Map();
    let bytes = 0;
    for (const c of targets.filter((x) => !x.notMissed && !x.notFound)) { const f = c.cwd ? normPath(c.cwd) : '(폴더 모름)'; const size = c.size + this.dirSize(c.path.slice(0, -6)); bytes += size; const g = folders.get(f) || { folder: f, count: 0, bytes: 0 }; g.count++; g.bytes += size; folders.set(f, g); }
    const n = targets.filter((x) => !x.notMissed && !x.notFound).length;
    if (!p.confirm) return { needsConfirm: true, count: n, bytes, folders: [...folders.values()], message: n ? `missed 대화 ${n}개(${fmtBytes(bytes)}, 폴더 ${folders.size}개)를 Windows 휴지통으로 보낸다. 대화 기록 파일과 옆의 하위 에이전트 폴더만 보낸다.` : '지울 missed 대화가 없다', msg: n ? m('missedTrash', { n, size: fmtBytes(bytes), folders: folders.size }) : m('missedNone') };
    // 지우기 직전 판정: 묶임은 출처 추측 없이(SDK 대화도 끝났으면 지운다) 세션 파일, 명령줄, 데스크톱 목록, 방금 기록됨으로
    this.refreshBindings(); await this.refreshProcs();
    const boardConvs = this.store.boardConversations(), marks = this.store.archiveMarks();
    const items = targets.map((c) => {
      if (c.notFound) return { convId: c.convId, path: '', cls: 'not_found' };
      const now = { ...c, mtime: this.mtimeNow(c) };
      const bind = bindingOf({ convId: c.convId, entrypoints: ['cli'], mtime: now.mtime, live: this.live, procs: this.procs, desktop: this.desktop });
      const cl = this.classOf(now, { bind, boardConvs, marks });
      return { convId: c.convId, path: c.path, cwd: c.cwd, cls: cl.cls, binding: bind, boardKnown: boardConvs.has(c.convId), desktop: (c.entrypoints || []).some((e) => /desktop/i.test(e)) || bind.where === 'desktop' };
    });
    const plan = trashPlan(items.filter((i) => i.cls !== 'not_found'), { roots: this.cfg.convoRoots, dirExists: (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } } });
    plan.refused.push(...items.filter((i) => i.cls === 'not_found').map((i) => ({ convId: i.convId, reason: 'not_found' })));
    const paths = plan.ok.flatMap((x) => [x.file, ...(x.dir ? [x.dir] : [])]);
    const res = await this.trash(paths, { tmpDir: path.join(this.cfg.dataDir, 'tmp') });
    const trashedSet = new Set(res.trashed.map(pathKey));
    const done = plan.ok.filter((x) => trashedSet.has(pathKey(x.file)));
    const emptied = removeEmptyProjectDirs(done.map((x) => x.file), this.cfg.convoRoots);
    this.store.tx(() => { this.store.dropConvos(done.map((x) => x.file)); this.store.deleteConvoNodes(done.map((x) => x.convId)); });
    this.store.addEvent(null, 'missed_trashed', { trashed: done.length, refused: plan.refused.length, failed: res.failed.length, emptied: emptied.length, by: p.all ? 'all' : p.folder ? 'folder' : 'items' });
    this.b.log(`missed trashed ${done.length} (refused ${plan.refused.length}, failed ${res.failed.length})`);
    this.changed({ force: true }).catch(() => {});
    return { trashed: done.length, convos: done.map((x) => x.convId), bytes, refused: plan.refused.map((r) => ({ ...r, label: REFUSE_LABEL[r.reason] || r.reason })), failed: res.failed, emptiedDirs: emptied.length };
  }

  // P15: 노드의 X에서 "삭제". 막 끈 세션의 대화 기록(<대화 ID>.jsonl과 옆 폴더)을 휴지통으로 보내고 닫힌 세션 행을 지운다.
  // 판이 방금 끈 자기 세션이라 "방금 기록됨"은 묶임으로 보지 않는다. 세션 파일·명령줄에 아직 살아 있으면 몇 초 기다리고,
  // 그래도 묶여 있거나 휴지통으로 못 보내면 지우지 않고 보관한다(대화 기록이 남으면 판 밖 대화로 다시 뜨므로).
  async forgetClosed(sessionId, { waitMs = 8000 } = {}) {
    const row = this.store.closedSession(sessionId);
    if (!row) throw apiError('not_found', `닫힌 세션이 아니다: ${sessionId}`);
    const conv = convOf(row);
    let file = null;
    if (conv) {
      const idx = this.store.getConvoById(conv);
      const roots = [...new Set([this.cfg.claudeProjects, ...(this.cfg.convoRoots || [])].filter(Boolean))];
      const cands = [idx && idx.path, ...roots.map((r) => transcriptPathFor(r, row.cwd, conv))].filter(Boolean);
      file = cands.find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || null;
    }
    const keep = (reason) => {
      this.markArchive({ session: sessionId }, true, 'close');
      this.store.addEvent(sessionId, 'delete_refused', { reason, file: file ? slash(file) : null });
      return { deleted: false, archived: true, reason, label: REFUSE_LABEL[reason] || reason };
    };
    let trashed = 0;
    if (file) {
      let bind = { bound: true };
      for (const t0 = Date.now(); ; ) {
        this.refreshBindings(); await this.refreshProcs();
        bind = bindingOf({ convId: conv, entrypoints: ['cli'], live: this.live, procs: this.procs, desktop: this.desktop, recentMs: 0 });
        if (!bind.bound || Date.now() - t0 > waitMs) break;
        await sleep(500);
      }
      const roots = [...new Set([this.cfg.claudeProjects, ...(this.cfg.convoRoots || [])].filter(Boolean))];
      // 판이 끈 자기 세션은 missed와 같은 거부 규칙(뿌리 밖, UUID 아님, 도는·묶인·데스크톱)으로 지운다
      const plan = trashPlan([{ convId: conv, path: file, cls: 'missed', binding: bind, boardKnown: false, desktop: bind.where === 'desktop' }], { roots, dirExists: (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } } });
      if (!plan.ok.length) return keep((plan.refused[0] && plan.refused[0].reason) || 'bound');
      const x = plan.ok[0];
      const res = await this.trash([x.file, ...(x.dir ? [x.dir] : [])], { tmpDir: path.join(this.cfg.dataDir, 'tmp') });
      if (!res.trashed.map(pathKey).includes(pathKey(x.file))) return keep('trash_failed');
      removeEmptyProjectDirs([x.file], roots);
      this.store.tx(() => { this.store.dropConvos([x.file]); this.store.deleteConvoNodes([conv]); });
      trashed = 1 + (x.dir ? 1 : 0);
    }
    this.store.tx(() => { this.store.deleteClosedSession(sessionId); this.store.addEvent(sessionId, 'session_deleted', { name: row.name, kind: row.kind, convo: conv, trashed }); });
    this.b.log(`session deleted ${row.name} ${sessionId} trashed=${trashed}`);
    this.changed({ force: true }).catch(() => {});
    return { deleted: true, convo: conv, trashed };
  }

  // ---------- 판으로 열기(J2·J4) ----------
  freeName(want, prefix = 's') {
    const taken = new Set([...this.b.sessions.values()].map((s) => s.name).concat([...(this.b.spawningNames || [])], [...(this.b.branch?.pendingNames || [])]));
    if (want && NAME_RE.test(want) && want !== 'all' && !taken.has(want)) return want;
    if (want && NAME_RE.test(want) && want !== 'all') { for (let i = 2; i < 100; i++) { const n = `${want.slice(0, 28)}-${i}`; if (!taken.has(n)) return n; } }
    let i = 1; while (taken.has(`${prefix}${i}`)) i++;
    return `${prefix}${i}`;
  }
  // 마지막 자리가 비어 있으면(다른 노드·메모·칸반과 겹치지 않으면) 그 자리, 아니면 그 워크스페이스 영역의 빈자리(H1).
  // 붙여 묶기 덩어리에 있던 노드는 옛 짝과 가장자리가 맞닿으므로 맞닿는 것은 겹침으로 보지 않는다. 덩어리·연결은 되살리지 않는다(J2)
  // P27: area(워크트리 경로 키)면 그 워크트리 영역 안(영역이 없으면 본 저장소 영역)
  placeFor(id, wsKey, prev, near = null, area = '') {
    const size = prev ? { w: prev.w, h: prev.h } : NODE;
    const fits = (rect) => {
      const all = canvasItems(this.b).filter((i) => i.id !== id && i.id !== `convo:${id}`);
      const regs = areaRegions(this.b, all);
      const ak = area && regs.has(areaKey(wsKey, area)) ? areaKey(wsKey, area) : wsKey;
      // P9: 그 자리로 커진 영역이 다른 영역과 겹치면 마지막 자리를 쓰지 않는다(닫힌 동안 다른 영역이 그 자리로 왔다)
      const reg = regionRect([...all.filter((i) => i.ws === ak), rect]);
      const others = [...regs].filter(([k]) => k !== ak).map(([, r]) => r);
      return !all.some((i) => overlaps(rect, i)) && !others.some((r) => overlaps(reg, r, -1));
    };
    if (prev) { const rect = { x: prev.x, y: prev.y, w: prev.w, h: prev.h }; if (fits(rect)) return { ...rect, kept: true }; }
    // P13: 대화 노드에서 연 세션은 그 카드 자리(보통 크기, 안 되면 작게), 그것도 안 되면 그 카드 바로 옆 빈자리
    if (!prev && near) {
      for (const [step, s] of [[null, NODE], ['small', SIZE_STEPS.small]]) { const rect = { x: near.x, y: near.y, w: s.w, h: s.h }; if (fits(rect)) return { ...rect, kept: true, size: step }; }
      const slot = slotFor(this.b, { wsKey, size, near, area });
      return { x: slot.x, y: slot.y, w: size.w, h: size.h, kept: false };
    }
    const slot = slotFor(this.b, { wsKey, size, area });
    return { x: slot.x, y: slot.y, w: size.w, h: size.h, kept: false };
  }
  // 판 세션 하나를 새 herdr 작업 공간에 띄운다. 행이 있으면(닫힌 세션) 그 행을 다시 쓰고, 없으면(판 밖 대화) 만든다
  async bring(spec) {
    const b = this.b;
    if (b.sessions.has(spec.id) || this.opening.has(spec.id)) throw apiError('already_open', '이미 판에 있거나 여는 중인 세션이다');
    const name = this.freeName(spec.name, spec.kind === SHELL ? 'sh' : 's');
    const archive = this.store.archiveMarks().get(itemKey('session', spec.id));
    const node = this.store.nodeOf(spec.id);
    let created = null;
    b.spawningNames ||= new Set();
    this.opening.add(spec.id); b.spawningNames.add(name);
    try { return await this.bringReserved(spec, name, (s) => { created = s; }); }
    catch (e) {
      if (created && b.sessions.get(spec.id) === created && !b.killing.has(spec.id)) await this.bringFailed(created, spec, archive, node, e);
      throw e;
    }
    finally { this.opening.delete(spec.id); b.spawningNames.delete(name); }
  }
  async bringFailed(s, spec, archive, node, error) {
    const b = this.b;
    const failure = { error: error.code || error.message };
    b.killing.add(s.sessionId);
    try {
      await b.adapter.closePane(s.paneId);
      b.closeSession(s, 'reopen failed');
      // 다시 열기 전의 맥락·보관 표시를 돌려 재시도할 수 있게 한다.
      if (spec.reuseRow) {
        const fields = {};
        for (const key of ['name', 'cwd', 'paneId', 'herdrWorkspaceId', 'agentName', 'model', 'effort', 'permissionMode', 'settingsPath', 'hookToken', 'resumeArgv', 'resumeVerified', 'closedAt', 'seenAt', 'touchedAt', 'runtime', 'kind', 'origin', 'parentSessionId', 'workspaceKey', 'flavor', 'closeReason', 'dismissedAt', 'reopenedAs']) {
          if (spec.reuseRow[key] !== undefined) fields[key] = spec.reuseRow[key];
        }
        this.store.updateSession(s.sessionId, fields);
        if (archive) this.store.setArchive('session', s.sessionId, archive);
        if (node) this.store.setNode(node);
      }
    } catch (cleanup) {
      failure.cleanup = { code: cleanup.code || 'error', message: cleanup.message };
      // 닫힌 줄로 바꾸면 실행 중일 수 있는 대화를 한 번 더 열게 된다. 패널과 실패 상태를 판에 남긴다.
      if (b.sessions.get(s.sessionId) === s) {
        s.rt.exit = { kind: 'launch_failed', reason: error.message, at: Date.now() };
        this.store.saveRuntime(s.sessionId, s.rt);
        b.broadcastSession(s, { cause: 'reopen:failed' });
      }
    } finally { b.killing.delete(s.sessionId); }
    this.store.addEvent(s.sessionId, 'reopen_failed', failure);
    this.changed().catch(() => {});
  }
  async bringReserved(spec, name, registered) {
    const b = this.b, cfg = this.cfg;
    b.requireHerdr();
    const cwd = path.resolve(String(spec.cwd || ''));
    if (!spec.cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw keyed(apiError('bad_request', `폴더가 없다: ${spec.cwd}`), 'noFolder', { path: spec.cwd });
    const id = spec.id;
    if (b.sessions.has(id)) throw apiError('already_open', '이미 판에 있는 세션이다');
    const kind = spec.kind || 'claude';
    const shell = kind === SHELL, claude = kind === 'claude', native = NATIVE_KINDS.has(kind);
    const ws = await workspaceOf(cwd);
    const permissionMode = spec.permissionMode || 'manual';
    let hookToken = '', settingsPath = '', paneEnv, recovery, resumeArgv = null, args = [], trust = { needsTrust: null, reason: `${kind}: 예상하지 않음` };
    if (native) {
      recovery = nativeRecovery(spec.reuseRow);
      if (!recovery) throw apiError('not_resumable', `${kind}의 정확한 대화 ID와 기록을 찾지 못해 이어 갈 수 없다`);
      spec.resume = recovery.resume;
      args = nativeArgs(kind, spec.args || [], recovery, spec.model);
      hookToken = crypto.randomBytes(24).toString('hex');
      ({ settingsPath, env: paneEnv } = b[`${kind}Settings`](id, hookToken));
    }
    if (claude) {
      hookToken = crypto.randomBytes(24).toString('hex');
      const extra = b.branch ? b.branch.settingsExtra(id) : {}; // P8: 다시 연 세션도 하위 세션 명령을 쓴다
      if (spec.flavor === DEEPSEEK) extra.env = { ...(extra.env || {}), ...deepseekEnv(baseUrlOf({ baseUrl: cfg.ocxBaseUrl, healthUrl: cfg.ocxHealthUrl })) }; // P25: DeepSeek는 프록시 주소에 붙인다
      settingsPath = writeSessionSettings({ file: path.join(cfg.sessionsDir, `${id}.json`), hookUrl: b.hookUrl, token: hookToken, sessionId: id, timeoutSec: cfg.hookTimeoutSec, allowHerdr: !!spec.allowHerdr, ...extra });
      trust = predictTrust(cwd, cfg.claudeJson);
      const launch = { sessionId: id, settingsPath, permissionMode, model: spec.model || null, effort: spec.effort || null, ...b.plugin };
      args = spec.resume ? buildResumeArgs({ ...launch, sessionId: spec.convId || id }) : buildStartArgs(launch);
      resumeArgv = buildResumeArgv({ claudeCommand: cfg.claudeCommand, ...launch, sessionId: spec.resume ? spec.convId || id : id });
    } else if (!shell && !native) args = (spec.args || []).map(String);
    if (kind === 'codex' && spec.model !== undefined) args = withCodexModel(args, spec.model || '');
    b.ensureWorkspace(ws, `reopen ${name}`);
    const prev = this.store.nodeOf(spec.nodeFrom || id);
    const area = b.worktrees ? b.worktrees.areaOf(ws.key, cwd) : ''; // P27: 워크트리 폴더의 세션은 그 워크트리 영역
    const at = this.placeFor(id, ws.key, prev && (prev.area || '') === area ? prev : null, spec.near || null, area);
    const rt = native ? nativeRuntime(spec.reuseRow, recovery) : newRuntime({ trustPredicted: !!trust.needsTrust, kind, hooked: claude });
    if (claude && spec.resume) {
      const prev = spec.reuseRow?.runtime || {};
      for (const key of ['lastPrompt', 'lastPromptAt', 'lastAnswer', 'lastAnswerAt', 'lastActivityAt', 'turn', 'interruptedTurn']) if (prev[key] !== undefined) rt[key] = prev[key];
      rt.claudeSessionId = spec.convId || id;
      rt.transcriptPath = this.store.getConvoById(rt.claudeSessionId)?.path || prev.transcriptPath || transcriptPathFor(cfg.claudeProjects, cwd, rt.claudeSessionId);
    }
    if (shell) rt.phase = 'running';
    let s;
    const hw = await b.withNewPane(() => b.adapter.createWorkspace({ cwd, label: name, ...(paneEnv ? { env: paneEnv } : {}) }), (r) => {
      const now = Date.now();
      s = { sessionId: id, name, cwd, paneId: r.paneId, herdrWorkspaceId: r.workspaceId, agentName: shell ? r.paneId : name, model: kind === 'codex' ? modelFromArgs(args) || null : claude || native ? spec.model || null : null, effort: claude ? spec.effort || null : null, permissionMode, settingsPath, hookToken, resumeArgv, resumeVerified: false, createdAt: spec.createdAt || now, closedAt: null, seenAt: null, touchedAt: now, rt, lastState: null, kind, origin: 'board', parentSessionId: null, workspaceKey: ws.key, flavor: spec.flavor || null }; // P25: flavor(deepseek)는 다시 열어도 남는다
      if (spec.reuseRow) {
        this.store.reopenRow(id, { name, cwd, paneId: r.paneId, herdrWorkspaceId: r.workspaceId, agentName: s.agentName, settingsPath, hookToken, resumeArgv, resumeVerified: false, runtime: rt, kind, origin: 'board', workspaceKey: ws.key, permissionMode, model: s.model, effort: s.effort, touchedAt: now, parentSessionId: null });
        if (spec.reuseRow.name !== name) this.store.addEvent(id, 'renamed', { from: spec.reuseRow.name, to: name, why: 'name taken on reopen' });
      } else this.store.insertSession({ ...s, runtime: rt });
      b.sessions.set(id, s);
      registered(s);
    });
    this.store.setNode({ session_id: id, x: at.x, y: at.y, w: at.w, h: at.h, z: native && prev ? prev.z : 0, size: at.size || (native && prev ? prev.size : null), area });
    if (spec.near) { this.store.setConvoNodesShown([id], false); this.layoutCanvas().catch(() => {}); } // P13: 대화 노드는 세션 노드가 됐다
    settleRegions(b, 'reopen');
    this.store.addEvent(id, 'reopened', { from: spec.from, kind, cwd: slash(cwd), workspace: ws.key, resume: !!spec.resume, args, place: at.kept ? 'last' : 'slot', name });
    await b.adapter.refreshSubscription();
    b.api.broadcast('session.created', { sessionId: id, name, workspaceKey: ws.key, reopened: true });
    b.broadcastSession(s, { cause: `reopen:${spec.from}` });
    b.probeGit(s, cwd);
    this.changed().catch(() => {});
    const out = { sessionId: id, name, kind, paneId: hw.paneId, workspaceKey: ws.key, resume: !!spec.resume, trust, place: at.kept ? 'last' : 'slot' };
    if (shell) return out;
    await b.adapter.waitShellReady(hw.paneId);
    try { const st = await b.adapter.startAgent({ name, paneId: hw.paneId, args, kind }); out.argv = st.argv; rt.herdr.launchPending = st.agent ? st.agent.launchPending : true; }
    catch (e) { if (e.code !== 'agent_not_ready') throw e; this.store.addEvent(id, 'agent_not_ready', { kind }); }
    if (claude) b.registerResume(s);
    b.log(`reopened ${name} ${kind} ${id} from=${spec.from} resume=${!!spec.resume} pane=${hw.paneId}`);
    return out;
  }
  transcriptExists(convId, cwd) {
    const idx = this.store.getConvoById(convId);
    if (idx && fs.existsSync(idx.path)) return true;
    return !!cwd && fs.existsSync(transcriptPathFor(this.cfg.claudeProjects, cwd, convId));
  }
  // 닫힌 세션 다시 열기(J2). Claude·Gemini·agy는 정확한 대화 ID와 새 hook 설정, 셸은 같은 폴더, 다른 종류는 저장된 인자.
  async reopen(p) {
    const ref = String(p.session || '');
    let row = this.store.closedSession(ref);
    if (!row) { const byName = this.store.closedSessions().find((x) => x.name === ref.replace(/^@/, '')); row = byName ? this.store.closedSession(byName.sessionId) : null; }
    if (!row) throw apiError('not_found', `닫힌 세션이 아니다: ${ref}`);
    if (row.reopenedAs) throw apiError('moved', `이 세션은 이미 다른 세션(${row.reopenedAs})으로 다시 열었다`);
    const kind = row.kind || 'claude';
    const info = this.store.spawnInfo(row.sessionId) || {};
    const base = { cwd: row.cwd, name: row.name, kind, permissionMode: p.permissionMode || row.permissionMode, model: p.model !== undefined ? p.model : row.model, effort: p.effort !== undefined ? p.effort : row.effort, allowHerdr: !!info.allowHerdr, createdAt: row.createdAt, flavor: row.flavor || null };
    if (kind === 'claude') {
      const conv = convOf(row);
      if (conv) {
        this.refreshBindings(); await this.refreshProcs();
        const bind = this.bindingFor(conv, this.store.getConvoById(conv), { strict: false });
        if (bind.bound) throw keyed(apiError('bound', `대화가 다른 곳에 묶여 있다: ${bind.label}. 그곳에서 끝낸 뒤 연다`, { binding: bind }), 'boundOpen', { where: bind.where || '' });
      }
      if (!conv || (row.origin || 'board') === 'board' || conv === row.sessionId.toLowerCase()) {
        // 판이 띄운 claude(또는 대화 ID를 모르는 판에 올린 claude): 같은 행, 같은 세션 ID
        return this.bring({ ...base, id: row.sessionId, convId: conv, reuseRow: row, from: 'closed', resume: !!conv && this.transcriptExists(conv, row.cwd) });
      }
      // 판에 올린 claude: 판의 hook을 붙여 그 대화 ID로 이어 가는 판 세션이 된다. 세션 ID가 대화 ID와 달라 새 행을 쓰고, 옛 행은 옮겨 갔다고 남긴다
      const existing = this.store.getSession(conv);
      if (existing && !existing.closedAt) throw apiError('already_open', '그 대화는 이미 판 세션이다');
      const cwd = (row.runtime && row.runtime.cwd) || row.cwd;
      const out = await this.bring({ ...base, cwd, permissionMode: p.permissionMode || 'manual', model: p.model || null, effort: p.effort || null, id: conv, reuseRow: existing || null, nodeFrom: row.sessionId, from: 'adopted', resume: this.transcriptExists(conv, cwd) });
      this.store.updateSession(row.sessionId, { reopenedAs: conv });
      this.store.addEvent(row.sessionId, 'reopened_as', { sessionId: conv, name: out.name });
      this.changed().catch(() => {});
      return out;
    }
    const args = kind === SHELL ? [] : Array.isArray(info.args) ? info.args : [];
    if (kind === 'codex' && p.model === undefined && row.model == null) base.model = undefined; // 옛 행에는 모델 열 없이 실행 인자만 남아 있다.
    return this.bring({ ...base, id: row.sessionId, reuseRow: row, from: 'closed', args });
  }
  // P7의 "빼기"는 보관으로 합쳤다(P10). 판 기록과 대화 기록 파일은 그대로
  dismiss(p) { return { dismissed: true, ...this.archiveAdd({ session: p.session }) }; }

  // ---------- 보관(P10) ----------
  // 닫힌 세션(ID나 이름)이나 판 밖 대화(대화 ID) 하나 → { kind, id }. 판에 열려 있는 세션은 보관하지 않는다(먼저 끈다)
  archiveTarget(p) {
    if (p.session) {
      const ref = String(p.session).replace(/^@/, '');
      let row = this.store.closedSession(ref);
      if (!row) { const byName = this.store.closedSessions().find((x) => x.name === ref); row = byName ? this.store.closedSession(byName.sessionId) : null; }
      const open = this.b.sessions.get(ref) || [...this.b.sessions.values()].find((s) => s.name === ref);
      if (!row && open) throw keyed(apiError('open_session', `@${open.name}은 판에 열려 있다. 먼저 끈 뒤 보관한다`), 'openSession', { name: open.name });
      if (!row) throw apiError('not_found', `닫힌 세션이 아니다: ${p.session}`);
      return { kind: 'session', id: row.sessionId };
    }
    const id = String(p.convo || '').toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(id)) throw apiError('bad_request', 'convo(대화 ID) 또는 session이 필요하다');
    const known = this.store.boardConversations().get(id);
    if (known && known.open) throw keyed(apiError('open_session', '그 대화는 판에 열려 있는 세션이다. 먼저 끈 뒤 보관한다'), 'openConvo');
    if (known && !known.movedTo) return { kind: 'session', id: known.sessionId }; // 판이 아는 대화는 그 닫힌 세션으로 보관한다
    if (!this.store.getConvoById(id)) throw apiError('not_found', `대화 기록을 찾지 못했다: ${id}`);
    return { kind: 'convo', id };
  }
  markArchive(p, on, by = 'hand') {
    const items = Array.isArray(p.items) ? p.items : [p];
    const targets = items.map((it) => this.archiveTarget(it)); // 하나라도 안 되면 아무것도 바꾸지 않는다
    const now = Date.now();
    this.store.tx(() => {
      for (const t of targets) {
        this.store.setArchive(t.kind, t.id, on ? { archivedAt: now, restoredAt: null } : { archivedAt: null, restoredAt: now });
        this.store.addEvent(t.kind === 'session' ? t.id : null, on ? 'archived' : 'unarchived', { kind: t.kind, id: t.id, by });
      }
    });
    this.changed().catch(() => {});
    return targets;
  }
  archiveAdd(p) { const t = this.markArchive(p, true, p.by || 'hand'); return { archived: t.length, items: t, ...(t.length === 1 && t[0].kind === 'session' ? { sessionId: t[0].id } : {}) }; }
  // 꺼내기: 기본 목록에 다시 나오고, 그때부터 기간을 다시 센다
  archiveRestore(p) { const t = this.markArchive(p, false); return { restored: t.length, items: t }; }
  // 리포 묶음의 "오래된 것 보관": 기본 목록에서 마지막 활동이 days(기본 1일)보다 오래된 닫힌 세션과 판 밖 대화(지금 다른 곳에서 열린 대화는 뺀다).
  // confirm이 없으면 수와 확인 문구만 돌려준다
  async archiveOld(p = {}) {
    const w = await this.b.resolveWorkspace(p.workspace);
    const days = p.days != null ? Number(p.days) : OLD_DAYS;
    if (!Number.isFinite(days) || days < 0) throw apiError('bad_request', 'days는 0 이상');
    const marks = this.store.archiveMarks();
    const v = (await this.compute({ only: w.key })).get(w.key) || { closed: [], convos: [] };
    const items = [
      ...v.closed.filter((c) => isOld({ lastAt: c.lastActivityAt || c.closedAt, mark: marks.get(itemKey('session', c.sessionId)), olderThanDays: days })).map((c) => ({ session: c.sessionId })),
      ...v.convos.filter((c) => !(c.binding && c.binding.open) && isOld({ lastAt: c.lastAt, mark: marks.get(itemKey('convo', c.convId)), olderThanDays: days })).map((c) => ({ convo: c.convId })),
    ];
    if (!p.confirm) return { needsConfirm: true, count: items.length, days, message: items.length ? `마지막 활동이 ${days}일보다 오래된 ${items.length}개(닫힌 세션과 판 밖 대화)를 보관한다. 지우지 않고, 보관함에서 꺼낼 수 있다.` : `${days}일보다 오래된 것이 없다`, msg: items.length ? m('archiveOld', { days, n: items.length }) : m('archiveOldNone', { days }) };
    if (!items.length) return { archived: 0, items: [] };
    return this.archiveAdd({ items, by: 'old' });
  }
  // 보관함: 워크스페이스마다 보관된 닫힌 세션과 판 밖 대화. 글이 없는 대화(보관된 채로 처음 연 리포)는 이때 그 리포 것만 읽어 채운다
  async archiveList(p = {}) {
    const want = p.workspace ? await this.b.resolveWorkspace(p.workspace) : null;
    const only = want ? want.key : null;
    let views = await this.compute({ archived: true, only });
    const bare = [...views.values()].flatMap((v) => v.convos.filter((c) => !c.hasText)).slice(0, LIST_LIMIT);
    if (bare.length && (await this.fillText(bare.map((c) => this.store.getConvoById(c.convId)).filter(Boolean)))) views = await this.compute({ archived: true, only });
    const names = workspaceNames(this.store.workspaces());
    const strip = ({ hasText: _h, ...rest }) => rest;
    return { days: this.archiveDays(), workspaces: [...views.entries()].map(([key, v]) => ({ key, name: names.get(key) || key, closed: v.closed, convos: v.convos.map(strip), archived: v.archived })) };
  }
  // 판 밖 대화를 판으로 연다(J4). 묶여 있지 않은 대화만 같은 대화 ID로 이어 간다. 이미 판 세션이면 그 노드로 갈 뿐 새로 띄우지 않는다
  async openConvo(p) {
    const id = String(p.convo || '').toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(id)) throw apiError('bad_request', `대화 ID: ${p.convo}`);
    const known = this.store.boardConversations().get(id);
    if (known && known.open) { const s = this.b.sessions.get(known.sessionId); return { existing: true, sessionId: known.sessionId, name: s ? s.name : null }; }
    if (known && known.movedTo) { const s = this.b.sessions.get(known.movedTo); if (s) return { existing: true, sessionId: s.sessionId, name: s.name }; }
    if (known) return { ...(await this.reopen({ ...p, session: known.sessionId })), reopenedClosed: true };
    let row = this.store.getConvoById(id);
    if (!row) { await this.scan({ wait: true }); row = this.store.getConvoById(id); }
    if (!row || !row.cwd) throw apiError('not_found', `대화 기록을 찾지 못했다: ${id}`);
    this.refreshBindings(); await this.refreshProcs();
    const bind = this.bindingFor(id, { ...row, mtime: this.mtimeNow(row) });
    if (bind.bound) throw keyed(apiError('bound', `대화가 다른 곳에 묶여 있다: ${bind.label}`, { binding: bind }), 'bound', { where: bind.where || '' });
    const ws = await this.resolveWs(row.cwd);
    if (!this.matchWorkspace(row.cwd, ws)) throw apiError('bad_request', '열린 워크스페이스의 대화가 아니다');
    const card = this.store.convoNodes().find((n) => n.convId === id && n.shown); // P13: 캔버스의 대화 노드에서 열면 그 자리에서 세션 노드가 된다
    const out = await this.bring({ id, cwd: row.cwd, kind: 'claude', name: p.name || null, permissionMode: p.permissionMode || 'manual', model: p.model || null, effort: p.effort || null, from: 'convo', resume: true, near: card ? { x: card.x, y: card.y, w: card.w, h: card.h } : null });
    this.store.addEvent(id, 'convo_opened', { convId: id, title: clip(row.title, 120), lastAt: row.lastAt });
    return out;
  }

  // ---------- 다시 켜도 판이 그대로(J1) ----------
  // herdr를 다시 띄운 뒤 패널이 없어진 세션 중 판이 되살릴 수 있는 것: 셸(같은 폴더에 새 셸), 대화 ID를 아는 판에 올린 claude(그 대화로 이어 가기)
  restorable(s) {
    if (!s.cwd || !fs.existsSync(s.cwd)) return false;
    if (s.kind === SHELL) return true;
    if (NATIVE_KINDS.has(s.kind)) return managedNative(s) && !!nativeRecovery(s);
    if (s.kind === 'claude' && !this.b.hooked(s)) { const conv = convOf(s); return !!conv && this.transcriptExists(conv, s.rt.cwd || s.cwd); }
    return false;
  }
  async restoreGone(list) {
    for (const s of list) {
      if (!this.b.sessions.has(s.sessionId)) continue;
      try { await this.restoreInNewPane(s); }
      catch (e) {
        this.store.addEvent(s.sessionId, 'recover_failed', { plan: 'new_pane', error: e.code || e.message, cleanup: e.cleanup });
        if (!e.recoveryPaneRetained && this.b.sessions.get(s.sessionId) === s) this.b.closeSession(s, 'pane gone');
      }
    }
  }
  async restoreInNewPane(s) {
    if (NATIVE_KINDS.has(s.kind)) return this.restoreNativeAgent(s);
    const b = this.b;
    const r = await b.withNewPane(() => b.adapter.createWorkspace({ cwd: s.rt.cwd && fs.existsSync(s.rt.cwd) ? s.rt.cwd : s.cwd, label: s.name }), (x) => b.setPane(s, x.paneId, x.workspaceId, 'restored after herdr restart'));
    if (s.kind === SHELL) {
      const rt = newRuntime({ kind: SHELL, hooked: false });
      rt.phase = 'running'; rt.cwd = s.rt.cwd; rt.interruptedTurn = s.rt.interruptedTurn || null;
      s.rt = rt; s.agentName = r.paneId;
      this.store.updateSession(s.sessionId, { agentName: s.agentName, runtime: rt });
      s.recovered = { plan: 'shell_new_pane', at: Date.now() };
      this.store.addEvent(s.sessionId, 'recovered_by_board', { plan: 'shell_new_pane', paneId: r.paneId });
      b.broadcastSession(s, { cause: 'recover:shell_new_pane' });
      return;
    }
    await this.resumeHookless(s, 'resume_new_pane');
  }
  // Gemini·agy는 workspace.create의 env로 hook을 받는다. 남은 셸도 새 패널로 바꾸되 자기 패널만 닫는다.
  async restoreNativeAgent(s, { replacePane = false } = {}) {
    const b = this.b, id = s.sessionId, kind = s.kind;
    if (this.nativeRecoveries.has(id) || b.killing.has(id) || !b.sessions.has(id) || !managedNative(s)) return;
    this.nativeRecoveries.add(id);
    let created = null;
    try {
      const oldPane = s.paneId;
      if (replacePane) {
        // 유예 시간 뒤에도 에이전트가 돌아왔거나 셸에서 다른 일을 하면 건드리지 않는다.
        if ((await b.adapter.getPane(oldPane)).agent || !await b.adapter.waitShellReady(oldPane, 8000)) return;
        if (!b.sessions.has(id) || s.rt.exit?.kind !== 'herdr_stopped' || (await b.adapter.getPane(oldPane)).agent) return;
      }
      const recovery = nativeRecovery(s);
      if (!recovery) {
        if (!replacePane) throw apiError('not_resumable', `${kind}의 정확한 대화 ID와 기록을 찾지 못해 이어 갈 수 없다`);
        b.killing.add(id);
        await b.adapter.closePane(oldPane);
        b.closeSession(s, 'not resumed after herdr restart');
        return;
      }
      const info = this.store.spawnInfo(id) || {};
      const args = nativeArgs(kind, Array.isArray(info.args) ? info.args : [], recovery, s.model);
      const hookToken = crypto.randomBytes(24).toString('hex');
      const { settingsPath, env } = b[`${kind}Settings`](id, hookToken);
      const rt = nativeRuntime(s, recovery);
      if (replacePane) {
        b.killing.add(id);
        await b.adapter.closePane(oldPane);
      }
      // 시작 폴더로 native 기록을 고른다. hook의 현재 cwd로 다른 프로젝트를 고르지 않는다.
      await b.withNewPane(() => b.adapter.createWorkspace({ cwd: s.cwd, label: s.name, env }), async (r) => {
        created = r;
        Object.assign(s, { rt, hookToken, settingsPath, resumeArgv: null, resumeVerified: false });
        this.store.updateSession(id, { runtime: rt, hookToken, settingsPath, resumeArgv: null, resumeVerified: false });
        await b.setPane(s, r.paneId, r.workspaceId, `${kind} restored after herdr restart`);
      });
      await b.adapter.waitShellReady(s.paneId, 8000);
      try {
        const st = await b.adapter.startAgent({ name: s.agentName || s.name, paneId: s.paneId, args, kind });
        if (st.agent?.name) s.agentName = st.agent.name;
        rt.herdr.launchPending = st.agent ? st.agent.launchPending : true;
      } catch (e) {
        if (e.code !== 'agent_not_ready') throw e;
        this.store.addEvent(id, 'agent_not_ready', { kind });
      }
      this.store.updateSession(id, { agentName: s.agentName, runtime: rt });
      const plan = `${kind}_${recovery.resume ? 'resume' : 'start'}_new_pane`;
      s.recovered = { plan, at: Date.now() };
      this.store.addEvent(id, 'recovered_by_board', { plan, convId: recovery.resume ? recovery.id : null, args, paneId: s.paneId });
      b.broadcastSession(s, { cause: `recover:${plan}` });
      b.log(`recovered ${s.name}: ${plan}`);
    } catch (e) {
      if (created && b.sessions.get(id) === s) {
        b.killing.add(id);
        try {
          await b.adapter.closePane(created.paneId);
          b.closeSession(s, 'not resumed after herdr restart');
        } catch (cleanup) {
          e.cleanup = { code: cleanup.code || 'error', message: cleanup.message };
          e.recoveryPaneRetained = true;
          s.rt.exit = { kind: 'launch_failed', reason: e.message, at: Date.now() };
          this.store.saveRuntime(id, s.rt);
          b.broadcastSession(s, { cause: 'recover:failed' });
        }
      }
      throw e;
    } finally { this.nativeRecoveries.delete(id); b.killing.delete(id); }
  }
  // 판에 올린 claude를 그 대화 ID로 이어 간다(판의 hook 없이, 그 하네스의 사용자 설정 그대로. herdr의 기본 이어 가기와 같은 명령)
  async resumeHookless(s, plan) {
    const b = this.b;
    const conv = convOf(s);
    await b.adapter.waitShellReady(s.paneId, 8000);
    const name = NAME_RE.test(s.agentName || '') && !String(s.agentName).includes(':') ? s.agentName : undefined;
    const st = await b.adapter.startAgent({ name, paneId: s.paneId, args: ['--resume', conv], kind: 'claude' });
    if (st.agent && st.agent.name && st.agent.name !== s.agentName) { s.agentName = st.agent.name; this.store.updateSession(s.sessionId, { agentName: s.agentName }); }
    s.rt.exit = null; s.rt.phase = 'starting'; s.rt.launchedAt = Date.now();
    s.recovered = { plan, at: Date.now() };
    this.store.addEvent(s.sessionId, 'recovered_by_board', { plan, convId: conv, argv: st.argv });
    b.log(`recovered ${s.name}: ${plan} (${conv})`);
    b.broadcastSession(s, { cause: `recover:${plan}` });
  }
  // herdr를 다시 띄운 뒤 패널은 남았는데 hook이 없는 에이전트가 돌아오지 않은 세션. herdr가 이어 갈 시간(recoverGraceMs)을 준 뒤 판이 맞춘다
  async recoverHookless(list) {
    const b = this.b;
    const down = (s) => b.sessions.has(s.sessionId) && s.rt.exit && s.rt.exit.kind === 'herdr_stopped';
    const t0 = Date.now();
    while (list.some(down) && Date.now() - t0 < this.cfg.recoverGraceMs) await sleep(1000);
    for (const s of list) {
      if (!down(s) || !b.adapter.connected) continue;
      try {
        if (NATIVE_KINDS.has(s.kind)) await this.restoreNativeAgent(s, { replacePane: true });
        else if (s.kind === 'claude' && convOf(s) && this.transcriptExists(convOf(s), s.rt.cwd || s.cwd)) await this.resumeHookless(s, 'resume_same_pane');
        else if (s.origin === 'adopted' || s.rt.shellBase) b.demoteToShell(s, 'not resumed after herdr restart');
        else await this.closeUnresumed(s);
      } catch (e) { this.store.addEvent(s.sessionId, 'recover_failed', { plan: 'hookless', error: e.code || e.message }); }
    }
  }
  // 판이 띄운 다른 종류(codex 등)를 herdr가 이어 가지 않았다. 판은 그 하네스의 이어 가기를 모르므로 닫힘으로 남기고(다시 열면 같은 폴더에 같은 인자로 새로 띄운다),
  // 남은 패널(셸)은 닫는다. 그대로 두면 판 밖 셸로 다시 올라온다
  async closeUnresumed(s) {
    const b = this.b;
    b.killing.add(s.sessionId);
    try {
      await b.adapter.closePane(s.paneId);
      b.closeSession(s, 'not resumed after herdr restart');
    } finally { b.killing.delete(s.sessionId); }
  }
}
