// Atrium 백엔드: 모듈을 묶고 판 API를 구현한다. herdr는 어댑터로만 부른다.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { HerdrAdapter, findHerdr, readServerExe } from './herdr/adapter.mjs';
import { updateNotice } from './herdr/discover.mjs'; // P40: herdr 찾기와 업데이트 감지
import { Store } from './store.mjs';
import { ApiServer } from './api.mjs';
import { TailscaleWatch, tailscaleHosts } from './tailscale.mjs'; // P49(R3): Tailscale 상태 읽기
import { envVar } from './config.mjs';
import { WebServer, isLocalProcess } from './web.mjs'; // P48(R2): 웹 화면, 짝 맺기, 기기 토큰, 폴더 목록, 업로드
import { DeliveryQueue } from './delivery.mjs';
import { TerminalRelay } from './relay.mjs';
import { Peers, peerHandlers } from './peers.mjs'; // P47: 붙은 클라이언트와 알림 받을 클라이언트
import { viewportKey, viewportFor } from './multiclient.mjs'; // P47: 클라이언트별 화면 위치
import { gitProbe, workspaceOf } from './git.mjs';
import { readMessages, lastExchange, userPromptsSince, readCodexMessages } from './transcript.mjs';
import { tailLines, isTrustDialog, parseChoices, parsePromptLine, shellPromptState, parseWorktreeExit, promptOnScreen, claudeInputBox, codexInputBox } from './screen.mjs';
import { parseTargets, toLF, clip } from './text.mjs';
import { planAnswer, checkSteps, sameAsk } from './answer.mjs';
import { checkKeys, keyChain, keysBy } from './keys.mjs'; // P104: 휴대폰 키 줄
import { writeSessionSettings, buildStartArgs, buildResumeArgv, buildResumeArgs, predictTrust, transcriptPathFor, slash, recoveryPlan, writeBoardPlugin } from './launch.mjs';
import { newRuntime, applyHook, applyHerdrStatus, applyAgentDetected, applyAgentReleased, applyHerdrDisconnected, deriveState, flags, worktreeExitAsk } from './state.mjs';
import { worktreeOf, waitClaudeExit } from './worktree-exit.mjs'; // P71: 워크트리 나가기 질문
import { summarizeChanges, CHANGE_KINDS } from './changes.mjs';
import { ResourceMonitor, childProcesses } from './resources.mjs';
import { listAgyModels, withAgyModel, agyModelFromArgs } from './agy.mjs';
import { writeAgySession } from './agy-session.mjs';
import { readAgyAnswer } from './agy-transcript.mjs';
import { normalizeAgyHook, agyComposerState } from './agy-hooks.mjs';
import { writeGeminiSession, normalizeGeminiHook, geminiAuthIssue } from './gemini.mjs';
import { listGeminiModels } from './gemini-models.mjs';
import { withGeminiModel, geminiModelFromArgs, validateGeminiNewSessionArgs } from './gemini-args.mjs';
import { prepareCodexSession, wakeCodexSession, recordCodexSessionId } from './codex-session.mjs';
import { listCodexModels } from './codex-models.mjs';
import { withCodexModel, modelFromArgs } from './codex-args.mjs';
import { SHELL_TOOLS, LINK_VERBS, parseHerdrCommands, parseHerdrOutput, readTextOf, tailText, screenAnswerText, roleNotice, unlinkNotice, paneChangedNotice, ROLE_RE } from './links.mjs';
import { workspaceNames, workspaceCounts, elsewhereOf, pathKey } from './workspaces.mjs';
import { migrateWorkspaces } from './migrate.mjs';
import { adoptTwin, reconcileWorkspaces } from './workspace-merge-ops.mjs'; // P37: 폴더 워크스페이스가 저장소가 되면 합치기
import { migrateSingleCanvas } from './migrate-canvas.mjs';
import { NEW_NODE, NEW_NODE_STEP, DEFAULT_ASPECT } from './canvas.mjs'; // P73: 새 세션 크기
import { canvasHandlers, slotFor, anchorWorkspace, onSessionClosed, autoDockSplit, noteNodeMove, settleRegions, migrateDocks, migrateBoxesInside, reflowLines } from './canvas-ops.mjs';
import { attachFeatures } from './features.mjs'; // P6b: 출력 보기, Thread, 메모, 칸반, 루프, 미션 맵, 설정(ARCH 4절 I)
import { PERMISSION_MODES as MODES, touchesRemoteRules } from './settings.mjs';
import { attachRecall } from './recall.mjs'; // P7: 되살리기, 닫힌 세션 다시 열기, 판 밖 대화(ARCH 4절 J)
import { attachBranch } from './branch.mjs'; // P8: 가지 펼치기(하위 세션 명령, 상한, 나무 자리, ARCH 4절 K)
import { FLAVOR as DEEPSEEK, DEFAULT_MODEL as DEEPSEEK_MODEL, checkCommand, checkProxy, proxyEnv as deepseekEnv, baseUrlOf } from './deepseek.mjs'; // P25: DeepSeek 바로 띄우기
import { resolveLauncher, exampleDeepseek, checkGateway, splitArgs, startWords, startOpt } from './launchers.mjs'; // P33: 호출자
import { attachWorktrees } from './worktrees.mjs'; // P27: 워크트리 영역
import { attachDesktopImport } from './desktop-import.mjs'; // P34: 데스크톱 앱 세션 가져오기
import { attachUpdater } from './updater.mjs'; // P69: 앱 안 업데이트
import { assertRestartAllowedSync } from './update-lease.mjs';
import { attachSleep, draftAfterInput } from './sleep.mjs'; // P21: 쉬는 Claude 세션 잠재우기와 깨우기(ARCH 5절 잠재우기, 기능 번호 D4 제안)
import { migrateLegacyData, fixLegacyRecords, writeTombstone, checkLegacyDevHerdr, MARKER, PANE_PREFIX } from './rename-migrate.mjs'; // P18: 이름 옮기기(multitask → Atrium)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const PERMISSION_MODES = new Set(MODES);
const NODE = { ...NEW_NODE, size: NEW_NODE_STEP, aspect: DEFAULT_ASPECT }; // P73: 새 세션은 16:9 가로 보통(canvas.mjs NEW_NODE)
const TOUCH_WRITE_MS = 10000; // 터미널 입력마다 손댄 시각을 쓰지 않는다
const KIND_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const OPEN_PROMPT_MS = 30 * 60 * 1000; // F1: 보낸 지시에 받는 쪽 상태 변화를 이만큼 이어 붙인다
const SHELL = 'shell'; // G2(P5): 에이전트 없는 일반 셸(PowerShell) 패널의 종류
const SHELL_POLL_MS = 2000; // G2: 셸이 프롬프트에서 쉬는지 명령을 돌리는지 보는 간격(화면 읽기 하나에 1ms 안쪽)
const SHELL_PROCS_MS = 30000; // G2: 명령을 돌리는 셸의 자식 프로세스 이름을 다시 읽는 간격(PowerShell 한 번, 약 0.5초). 새 명령이 시작되면 바로 읽는다. 오래 도는 명령(npm run dev 등)에 PowerShell을 자주 띄우지 않게 30초로 둔다
// F3: hook이 없는 세션을 끌 때 보내는 키. Claude Code는 /exit, 나머지는 ctrl+c 두 번(codex는 두 번째에 끝난다)
const EXIT_TEXT = { claude: '/exit' };

function apiError(code, message) { return Object.assign(new Error(message), { code }); }
import { m, confirmResult, keyed } from './msg.mjs'; // P16: 화면 글 열쇠
import { closePlan, checkAfter } from './ws-close.mjs'; // P44: 워크스페이스 지우기 판단
import { groupHandlers, readGroups, dropWorkspaces, GROUPS_META, syncWsGroups, wsLabels } from './ws-groups.mjs'; // P44: 가상 그룹. P91: 폴더 위계 묶음(저절로)
import { shownName, findSession, takenNames, nameOwner, renameSession } from './session-label.mjs'; // P66: 판의 이름(표시 이름)과 에이전트 주소
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
// HTTP 서버 닫기(2026-11-07): http.close는 열린 연결이 모두 끝나야 끝나므로, 쉬는 연결은 바로, 나머지는 forceMs 뒤 끊는다
export async function closeHttp(server, forceMs = 1000) {
  const closed = new Promise((r) => server.close(() => r()));
  try { server.closeIdleConnections(); } catch {}
  const force = setTimeout(() => { try { server.closeAllConnections(); } catch {} }, forceMs);
  await closed;
  clearTimeout(force);
}

import { spawnPlanOf } from './spawn-plan.mjs';
export { spawnPlanOf } from './spawn-plan.mjs';
import { applyAgentAutoApprove, providerPermissionArgs } from './auto-approval.mjs';

export class Backend {
  constructor(cfg) {
    this.cfg = cfg;
    this.sessions = new Map(); // sessionId → { ...행, rt, lastState }
    this.spawningNames = new Set();
    this.herdrOk = false;
    this.herdrCompat = null;
    this.herdrStopping = false;
    this.killing = new Set();
    this.logFile = path.join(cfg.logDir, 'backend.log');
    this.bus = new EventEmitter(); // P6b 기능(features.mjs)에 알린다: session, closed, screenAnswer
    // P54: 판 API는 포트를 연 뒤 바로 요청을 받지만, 처리는 start()가 끝날 때까지 기다린다(뜨는 중의 relay 없음, herdr 실행 파일 고르기 전 herdr.stop)
    this.ready = new Promise((r) => { this._markReady = r; });
  }

  log(...a) {
    const line = `${new Date().toISOString()} ${a.join(' ')}`;
    try { fs.appendFileSync(this.logFile, line + '\n'); } catch {}
    if (process.stdout.isTTY) console.log(line);
  }

  // ---------- 시작과 끝 ----------
  // P54: 실패해도 기다리던 요청은 풀어 준다(백엔드는 곧 끝난다)
  async start() {
    try { return await this.startInner(); } finally { this._markReady(); }
  }
  async startInner() {
    const cfg = this.cfg;
    assertRestartAllowedSync(cfg);
    for (const d of [cfg.dataDir, cfg.sessionsDir, cfg.logDir]) fs.mkdirSync(d, { recursive: true });
    try {
      const prev = JSON.parse(fs.readFileSync(cfg.backendFile, 'utf8'));
      if (prev.pid !== process.pid && pidAlive(prev.pid)) throw apiError('already_running', `백엔드가 이미 실행 중입니다 (PID ${prev.pid}, 포트 ${prev.port})`);
    } catch (e) { if (e.code === 'already_running') throw e; }
    // P40: 옛 판 옮기기는 옛 herdr를 끌 때 실행 파일이 필요하다. 설정(판 기록)은 아직 못 읽으므로 설정 없이 찾는다
    if (cfg.legacy && !cfg.herdrPath) cfg.herdrPath = (await findHerdr({ envPath: cfg.herdrEnvPath }).catch(() => ({}))).path || null;
    // P18: 옛 이름(multitask) 판을 옮긴다(실제 판 프로필에서 한 번). 옮기지 못하면 LegacyBlocked를 던져 뜨지 않는다(새 판을 빈 채로 만들지 않게)
    this.migration = await migrateLegacyData(cfg, { log: (m) => this.log(m) });
    await checkLegacyDevHerdr(cfg); // 개발용 기본 판: 옛 개발용 herdr(multitask-dev)가 돌면 뜨지 않는다

    this.store = new Store(cfg.dbFile);
    if (this.migration) {
      this.migration.fixed = fixLegacyRecords(this.store, cfg, this.migration);
      const { from, to, data, move, legacyBackend, herdr, problems, fixed } = this.migration;
      if (data === 'moved' || herdr.pending || problems.length) this.store.addEvent(null, 'rename_migrated', { from, to, data, move, legacyBackend, herdr, problems, fixed });
      this.log(`rename migration ${JSON.stringify({ data, herdr, problems, fixed })}`);
    }
    const hb = this.store.getMeta('heartbeat');
    this.previousRun = hb ? { lastHeartbeatAt: hb, downMs: Date.now() - hb, cleanShutdown: !!this.store.getMeta('cleanShutdown') } : null;
    this.store.setMeta('cleanShutdown', false);
    this.apiToken = this.store.getMeta('apiToken') || crypto.randomBytes(24).toString('hex');
    this.store.setMeta('apiToken', this.apiToken);
    this.startedAt = Date.now();
    this.hookUrl = `http://127.0.0.1:${cfg.port}/hooks/claude`;

    // P48(R2): 웹 화면, 짝 맺기, 기기 토큰. 판 API 토큰 연결은 이 PC의 프로세스만, 기기 연결은 같은 출처의 브라우저만 받는다(web.mjs)
    // P49(R3): Tailscale 상태 읽기(바꾸지 않는다). 이름을 Host 허용 목록에 넣고 로그인 사용자를 제한한다
    this.tailscale = new TailscaleWatch({ port: cfg.port, log: (m) => this.log(m), onChange: (ts) => this.log(`tailscale: ${ts.status && ts.status.running ? 'running' : 'not running'}, hosts ${tailscaleHosts(ts).length}`) });
    this.web = new WebServer({ cfg, store: this.store, api: null, log: (m) => this.log(m), recentDirs: () => this.recentDirs(), tailscale: this.tailscale, settings: () => (this.features ? this.features.settings.get() : {}), wsName: (k) => workspaceNames(this.store.workspaces()).get(k) || null }); // P88: wsName = 푸시 알림의 프로젝트 이름
    this.api = new ApiServer({ token: this.apiToken, ready: this.ready, handlers: { ...this.handlers(), ...this.web.handlers() }, authorize: (req) => this.web.authorize(req, this.apiToken), onOpen: (c) => { this.web.clientOpened(c); if (this.peers) this.peers.opened(); }, onClose: (c) => { this.web.clientClosed(c); if (this.relay) this.relay.detachClient(c); if (this.sleeper) this.sleeper.dropClient(c); if (this.peers) this.peers.closed(); }, log: (m) => this.log(m) });
    this.web.api = this.api;
    if (this.web.push) this.web.push.tree = () => this.pushTree();
    if (this.web.remoteEnabled()) this.tailscale.start();
    this.peers = new Peers({ api: this.api, log: (m) => this.log(m) });
    this.http = http.createServer((req, res) => this.onHttp(req, res));
    this.http.on('upgrade', (req, sock, head) => this.api.handleUpgrade(req, sock, head));
    // 포트는 고정이다. 이미 띄운 세션의 hook 주소가 설정 파일 안에 있기 때문이다(ARCH 1절).
    await new Promise((res, rej) => { this.http.once('error', rej); this.http.listen(cfg.port, '127.0.0.1', res); });
    fs.writeFileSync(cfg.backendFile, JSON.stringify({ pid: process.pid, port: cfg.port, token: this.apiToken, startedAt: this.startedAt, profile: cfg.profile, herdrSession: cfg.herdrSession }, null, 2));
    // P18: 옮긴 옛 폴더의 backend.json도 이 백엔드를 가리킨다(열린 옛 창이 옛 백엔드를 다시 띄우지 않고 이 판에 붙는다)
    if (cfg.legacy && fs.existsSync(path.join(cfg.legacy.dataDir, MARKER))) writeTombstone(cfg.legacy.dataDir, { pid: process.pid, port: cfg.port, token: this.apiToken, herdrSession: cfg.herdrSession, movedTo: cfg.dataDir });

    this.adapter = new HerdrAdapter({ herdrPath: cfg.herdrPath, session: cfg.herdrSession, logDir: cfg.logDir, protocols: cfg.herdrProtocols, tested: cfg.herdrTested });
    this.adapter.on('log', (m) => this.log('[herdr]', m));
    // P40: 쓸 herdr 실행 파일을 고른다(도는 판 서버의 실행 파일 → 찾기 결과). 못 찾아도 백엔드는 뜬다
    await this.resolveHerdr('start');
    // P21: 판 터미널에서 친 글로 보내지 않은 초안이 있는지 기억한다(초안이 있으면 잠재우지 않는다)
    this.relay = new TerminalRelay({ adapter: this.adapter, remoteBatchMs: envVar('REMOTE_BATCH_MS') != null ? Number(envVar('REMOTE_BATCH_MS')) : undefined, onInput: (sid, data, c) => { const s = this.sessions.get(sid); if (s) { s.lastUserInputAt = Date.now(); s.draft = draftAfterInput(s.draft, data); this.touch(s); } if (c) this.peers.touch(c); }, log: (m) => this.log(m) });
    this.keyChain = keyChain(); // P104: session.keys를 세션마다 차례로

    for (const row of this.store.openSessions()) {
      const rt = row.runtime || newRuntime({ kind: row.kind, hooked: row.origin === 'board' && row.kind === 'claude' });
      // P1~P3에서 만든 세션의 runtime에는 종류가 없다(모두 판이 띄운 Claude Code)
      rt.kind ??= row.kind; rt.hooked ??= row.origin === 'board' && row.kind === 'claude';
      this.sessions.set(row.sessionId, { ...row, rt, lastState: null });
    }
    // P22: 그룹과 묶음 실행을 뺐다. 옛 판의 그룹·묶음 항목·그룹 대상 루프를 지우고 무엇을 지웠는지 판 이벤트로 남긴다. 노드는 그 자리에 둔다
    const dropped = this.store.dropGroups();
    if (dropped) { this.store.addEvent(null, 'groups_removed', dropped); this.log(`groups removed ${JSON.stringify(dropped)}`); }
    // P5: P4까지의 판(board.db)을 리포지토리 워크스페이스로 옮긴다. 세션은 시작 폴더로 정하고 노드 자리는 그대로 둔다
    const mig = await migrateWorkspaces(this.store, { resolve: workspaceOf });
    for (const [sid, key] of mig.sessionKeys) { const s = this.sessions.get(sid); if (s) s.workspaceKey = key; }
    if (mig.sessions) { this.store.addEvent(null, 'workspaces_migrated', mig.report); this.log(`workspaces migrated ${JSON.stringify(mig.report)}`); }
    // P6a: 워크스페이스마다 따로이던 판을 캔버스 하나로(영역이 겹치지 않게 통째로 옮김, H1)
    const canv = migrateSingleCanvas(this.store);
    if (canv) { this.store.addEvent(null, 'canvas_migrated', canv); this.log(`single canvas migrated ${JSON.stringify(canv)}`); }
    // P17: 옛 한 줄 덩어리 행을 한 마디짜리 분할 나무로 바꾼다(모양 그대로, H5)
    migrateDocks(this);
    // P37: 같은 폴더를 가리키는 폴더 키와 저장소 키가 함께 있으면(폴더가 판에 열린 뒤 저장소가 됨) 하나로 합친다. 여러 번 돌려도 같다
    await reconcileWorkspaces(this, 'start', { quiet: true }).catch((e) => this.log('workspace merge error', e.stack));
    // P35: 옛 판의 워크트리 위성 영역(리포 영역 바깥)을 리포 영역 안으로 한 번 다시 놓는다(겹침 풀기보다 먼저)
    migrateBoxesInside(this);
    // P9: 이미 겹친 영역은 뜰 때 편다(영역째 오른쪽·아래로 밀어 상대 자리를 지킨다, H1)
    syncWsGroups(this, 'start'); // P91: 폴더가 안팎인 워크스페이스를 한 묶음으로(영역 겹침 풀기가 묶음을 한 덩어리로 본다)
    settleRegions(this, 'start');
    // P8: 하위 세션 명령. 플러그인에 일 맡기기 스킬과 atrium 명령을 더하고, 이미 띄운 세션의 설정 파일에 env와 승인 규칙을 더한다
    this.branch = attachBranch(this);
    Object.assign(this.api.handlers, this.branch.handlers);
    this.branch.refreshSettings();
    // P4: herdr 스킬을 쥐여 줄 플러그인 폴더(판이 띄우는 Claude Code에 --plugin-dir로 넘긴다)
    this.plugin = writeBoardPlugin({ dir: path.join(cfg.dataDir, 'plugin'), skillText: await this.herdrSkillText(), ...this.branch.pluginExtra() });
    for (const s of this.sessions.values()) if (s.kind === 'claude' && this.hooked(s)) this.refreshClaudeResume(s, { register: false });
    // P18: 데이터 폴더를 옮겼으면 --settings·--plugin-dir 경로가 바뀌었다. 이어 가기 인자를 다시 만든다(되살릴 때 herdr에 다시 등록한다)
    if (this.migration && this.migration.data === 'moved') {
      let n = 0;
      for (const s of this.sessions.values()) if (this.hooked(s) && s.resumeArgv) { s.resumeArgv = buildResumeArgv({ claudeCommand: cfg.claudeCommand, ...this.launchOf(s) }); s.resumeVerified = false; this.store.updateSession(s.sessionId, { resumeArgv: s.resumeArgv, resumeVerified: false }); n++; }
      this.migration.fixed.resumeArgv = n;
    }
    this.spawnIntents = []; // F3: 세션이 herdr로 새 에이전트를 띄우려 한 명령(hook)
    this.adopting = new Set();

    this.queue = new DeliveryQueue({
      store: this.store, cfg, view: (sid, d) => this.deliveryView(sid, d), send: (sid, text, options) => this.promptManaged(sid, text, options),
      // P79: 제출 확인이 늦을 때 화면의 입력 칸을 본다(Claude Code. P106: Codex도 보되 Enter만 하고 다시 보내지 않는다. 다른 종류와 셸은 손대지 않는다)
      inspect: async (sid, text) => {
        const s = this.sessions.get(sid); const k = s && (s.kind || 'claude');
        if (!s || !s.paneId || (k !== 'claude' && k !== 'codex')) return null;
        const rt = s.rt, paneId = s.paneId, inputAt = s.lastUserInputAt;
        const scr = await this.adapter.readScreen(paneId, { source: 'visible' });
        if (!this.currentSession(s, rt, paneId) || this.killing.has(sid) || s.lastUserInputAt !== inputAt) return null;
        const r = promptOnScreen(scr, text, k);
        (this.deliveryInspections ||= new Map()).set(sid, { s, rt, paneId, inputAt });
        return k === 'codex' ? { ...r, noResend: true } : r;
      },
      pressEnter: async (sid) => {
        const seen = this.deliveryInspections?.get(sid);
        this.deliveryInspections?.delete(sid);
        if (!seen || !this.currentSession(seen.s, seen.rt, seen.paneId) || this.killing.has(sid) || seen.s.lastUserInputAt !== seen.inputAt) throw apiError('agent_not_ready', '입력 대상을 다시 확인해야 합니다');
        if (['waiting', 'trust_wait', 'error', 'exited'].includes(deriveState(seen.rt).state)) throw apiError('agent_blocked', '현재 질문에 대한 응답이 필요합니다');
        await this.adapter.paneKeys(seen.paneId, ['enter']);
      },
    });
    this.queue.on('recover', (r) => { this.store.addEvent(r.sessionId, 'delivery_recover', r); this.log(`delivery recover ${this.nameOf(r.sessionId)} ${r.action} (${r.box}) #${r.n}`); });
    // P106: herdr가 받지 않은 전달(처음 한 번과 까닭이 바뀔 때만 온다), 오래 막힌 전달(한 번), 취소한 뒤에 들어간 시도
    this.queue.on('refused', (r) => this.log(`delivery refused ${this.nameOf(r.sessionId)} ${r.deliveryId} ${r.code} → ${r.reason}, retry in ${r.waitMs}ms (#${r.n})`));
    this.queue.on('stuck', (r) => { this.store.addEvent(r.sessionId, 'delivery_stuck', r); this.log(`delivery stuck ${this.nameOf(r.sessionId)} ${r.deliveryId} ${r.code} (${r.attempts} tries)`); const s = this.sessions.get(r.sessionId); if (s) this.broadcastSession(s, { cause: 'delivery stuck' }); });
    this.queue.on('late', (r) => { this.store.addEvent(r.sessionId, 'delivery_late', r); this.log(`delivery late ${this.nameOf(r.sessionId)} ${r.deliveryId}: went in after cancel`); });
    this.queue.on('delivery', (d) => {
      this.store.addEvent(d.sessionId, 'delivery', d);
      this.api.broadcast('delivery', { ...d, name: this.nameOf(d.sessionId) });
      const s = this.sessions.get(d.sessionId);
      if (s && d.status === 'unconfirmed') s.draft = true; // P21: 보낸 글이 제출되지 않고 입력 칸에 남았을 수 있다(잠재우지 않는다)
      if (this.branch && ['confirmed', 'unconfirmed', 'failed', 'cancelled'].includes(d.status)) this.branch.onDeliveryEnd(d); // P79: 하위 세션의 첫 요청이 들어가지 않았으면 부모에게
      if (s && d.status === 'confirmed' && s.rt.interruptedTurn) s.rt.interruptedTurn = null; // 새 지시가 들어갔으면 끊긴 턴 표시를 내린다
      // P6a(H3): hook이 없는 세션의 마지막 요청은 판이 보내 제출을 확인한 글로 둔다(멀리 얼굴, 검색)
      if (s && d.status === 'confirmed' && !this.hooked(s)) { const row = this.store.getDelivery(d.deliveryId); if (row) { s.rt.lastPrompt = row.text; s.rt.lastPromptAt = Date.now(); } }
      // P21(D4): 잠든 세션에 보낼 글이 생겼다. 깨운 뒤(ready) 대기열이 보낸다
      if (s && d.status === 'queued' && d.reason === 'sleeping' && this.sleeper) (s.kind === 'codex' ? wakeCodexSession(this, s, { why: 'delivery' }) : this.sleeper.wakeFor(s, 'delivery')).catch(() => {}); // P24: 그 리포의 잠든 세션을 모두 깨운다
      if (s) this.broadcastSession(s);
    });
    // P27: 리포마다 살아 있는 워크트리의 영역. 대화 노드(recall)보다 먼저 한 번 읽어 처음부터 워크트리 영역에 놓는다
    this.worktrees = attachWorktrees(this, { tickMs: cfg.worktreePollMs ?? 10000 });
    Object.assign(this.api.handlers, this.worktrees.handlers);
    await this.worktrees.sync('start').catch((e) => this.log('worktree sync error', e.stack));
    this.features = attachFeatures(this);
    Object.assign(this.api.handlers, this.features.handlers);
    this.recall = attachRecall(this);
    Object.assign(this.api.handlers, this.recall.handlers);
    this.sleeper = attachSleep(this, { tickMs: cfg.sleepTickMs });
    Object.assign(this.api.handlers, this.sleeper.handlers);
    this.desktopImport = attachDesktopImport(this);
    Object.assign(this.api.handlers, this.desktopImport.handlers);
    this.updater = attachUpdater(this); // P69: 새 릴리즈 확인과 업데이트(백엔드만 바꾸고 herdr는 그대로)
    Object.assign(this.api.handlers, this.updater.handlers);

    // herdr 서버가 백엔드가 꺼진 동안 다시 떴는가(재부팅 포함). 저장한 서버 PID와 비교한다(C3, P3)
    const prevHerdrPid = this.store.getMeta('herdrServerPid');
    await this.ensureHerdr();
    const nowHerdrPid = this.adapter.serverPid();
    this.herdrRestartedWhileDown = !!(prevHerdrPid && nowHerdrPid && prevHerdrPid !== nowHerdrPid);
    // P18: 판을 옮겼으면 새 herdr에는 판 세션이 없다. herdr가 다시 뜬 것으로 보고 J1 되살리기로 이어 간다
    if (this.migration && (this.migration.data === 'moved' || this.migration.herdr.pending)) this.herdrRestartedWhileDown = true;
    if (nowHerdrPid) this.store.setMeta('herdrServerPid', nowHerdrPid);
    if (this.herdrRestartedWhileDown) this.log(`herdr server changed while backend was down: ${prevHerdrPid} → ${nowHerdrPid}`);
    this.adapter.on('event', (e) => this.onHerdrEvent(e).catch((err) => this.log('herdr event error', err.stack)));
    this.adapter.on('connected', () => this.onHerdrConnected().catch((err) => this.log('resync error', err.stack)));
    this.adapter.on('disconnected', () => this.onHerdrDisconnected());
    if (this.herdrCompat && this.herdrCompat.ok) this.adapter.startEvents(() => [...this.sessions.values()].map((s) => s.paneId).filter(Boolean));
    // P40: herdr 경로 설정을 바꾸면 다시 찾는다(백엔드를 다시 켜지 않고 서버를 띄워 붙는다)
    const setSettings = this.api.handlers['settings.set'];
    this.api.handlers['settings.set'] = async (p, c) => {
      // P49: 원격 접속 규칙(remote*)은 이 PC의 창·CLI만 바꾼다
      const autoApprovalChange = p && (Object.hasOwn(p, 'agentAutoApprove') || p.key === 'agentAutoApprove');
      if (c && c.auth && c.auth.kind !== 'local' && (touchesRemoteRules(p) || autoApprovalChange)) throw Object.assign(new Error('only the board on this PC can change access and approval settings'), { code: 'forbidden' });
      const wasAccepting = this.web.accepting();
      const wasPasskey = this.web.passkeyOn();
      const wasChannel = this.updater ? this.updater.channel() : null;
      const r = await setSettings(p, c);
      if (this.updater && this.updater.channel() !== wasChannel) this.updater.channelChanged(); // P70: 업데이트 채널을 바꾸면 곧바로 다시 확인한다(기다리지 않는다)
      const nowAccepting = this.web.accepting();
      if (nowAccepting !== wasAccepting) r.remote = this.web.accessChanged(nowAccepting); // P58: 원격 받기 끄기·켜기(끄면 붙은 원격 연결을 닫는다)
      const nowPasskey = this.web.passkeyOn();
      if (nowPasskey !== wasPasskey) r.passkey = this.web.passkeyChanged(nowPasskey); // P62: 패스키로 확인 켜기·끄기
      if (p && ('herdrPath' in p || p.key === 'herdrPath')) r.herdr = await this.rediscoverHerdr('settings').catch((e) => { this.log('herdr rediscover error', e.stack); return null; });
      return r;
    };
    // P40: 새 herdr가 설치됐는지 본다(뜰 때, 주기적으로, 진단 때). 알리기만 하고 다시 띄우지 않는다
    this.checkHerdrUpdate('start').catch(() => {});
    this.updateTimer = setInterval(() => this.checkHerdrUpdate('timer').catch(() => {}), cfg.herdrUpdateMs);

    this.queue.start();
    this.heartbeat = setInterval(() => this.store.setMeta('heartbeat', Date.now()), 2000);
    this.store.setMeta('heartbeat', Date.now());
    this.quietTimer = setInterval(() => { for (const s of this.sessions.values()) this.broadcastSession(s, { onlyIfFlagsChanged: true }); }, 10000);

    // F4: 세션 폴더의 git(워크트리). hook이 없는 세션은 herdr가 아는 폴더를 주기적으로 본다
    for (const s of this.sessions.values()) this.probeGit(s, s.rt.cwd || s.cwd);
    this.gitTimer = setInterval(() => this.pollCwd().catch(() => {}), cfg.gitPollMs);
    // G2: 일반 셸이 쉬는지, 무슨 명령을 돌리는지
    this.shellTimer = setInterval(() => this.pollShells().catch((e) => this.log('shell poll error', e.stack)), SHELL_POLL_MS);
    // D1: 자원 감시, D3: 붙은 herdr 화면
    this.resources = new ResourceMonitor({
      session: cfg.herdrSession, intervalMs: cfg.resourcesIntervalMs,
      sessions: () => [...this.sessions.values()].map((s) => ({ sessionId: s.sessionId, name: s.name, paneId: s.paneId, present: s.rt.herdr.present, state: deriveState(s.rt).state })),
      processInfo: (paneId) => this.adapter.processInfo(paneId),
      controllers: () => this.relay.stats(),
      herdrServerPid: () => this.adapter.serverPid(),
    });
    this.resources.start((snap) => { this.api.broadcast('resources', snap); this.checkClients(); });
    this.clientTimer = setInterval(() => this.checkClients(), 3000);
    this.store.addEvent(null, 'backend_started', { pid: process.pid, previousRun: this.previousRun });
    this.log(`backend up pid=${process.pid} port=${cfg.port} profile=${cfg.profile} herdr=${cfg.herdrSession} previousRun=${JSON.stringify(this.previousRun)}`);
  }

  async stop(reason = 'stop') {
    this.stopping = true;
    this.log('backend stopping:', reason);
    clearInterval(this.heartbeat); clearInterval(this.updateTimer); clearInterval(this.quietTimer); clearInterval(this.clientTimer); clearInterval(this.gitTimer); clearInterval(this.shellTimer);
    this.resources.stop();
    this.queue.stop();
    if (this.features) this.features.stop();
    if (this.recall) this.recall.stop();
    if (this.worktrees) this.worktrees.stop();
    if (this.sleeper) this.sleeper.stop();
    if (this.updater) this.updater.stop();
    this.relay.closeAll();
    this.peers.stop();
    this.adapter.stopEvents();
    for (const s of this.sessions.values()) this.store.saveRuntime(s.sessionId, s.rt);
    this.store.setMeta('heartbeat', Date.now());
    this.store.setMeta('cleanShutdown', true);
    this.store.addEvent(null, 'backend_stopped', { reason });
    this.api.close();
    if (this.web) this.web.stop();
    if (this.tailscale) this.tailscale.stop();
    // 2026-11-07: 열린 연결이 남아 있으면 http.close가 끝나지 않는다(하위 세션을 띄우며 기다리던 atrium child 요청이 업데이트를 1분 넘게 붙잡았다).
    // 기다리는 /branch 요청에 먼저 답하고, 쉬는 연결은 바로, 나머지는 1초 뒤 끊는다
    const aborted = this.branch && this.branch.abortInflight ? this.branch.abortInflight() : 0;
    if (aborted) this.log(`answered ${aborted} waiting /branch request(s) before stopping`);
    await closeHttp(this.http);
    try { const b = JSON.parse(fs.readFileSync(this.cfg.backendFile, 'utf8')); if (b.pid === process.pid) fs.rmSync(this.cfg.backendFile); } catch {}
    this.store.close();
  }

  // herdr 서버가 없으면 띄우고(깨끗한 환경) 버전을 확인한다(ARCH 1절).
  // P40: 프로토콜이 맞으면 붙고 시험하지 않은 버전이면 경고한다. herdr를 못 찾았거나 띄우지 못하면 던지지 않고 그 상태로 둔다(보드는 연다)
  async ensureHerdr() {
    const p = await this.adapter.probe();
    let pong = p.pong;
    this.herdrMissing = null;
    if (!p.running) {
      if (!this.adapter.herdrPath) {
        this.herdrMissing = { reason: 'not_found', at: Date.now() };
        this.herdrCompat = { ok: false, level: 'missing', problems: ['herdr not found'], version: null, protocol: null, capabilities: null, warning: null };
        this.herdrOk = false;
        this.log(`herdr not found: ${JSON.stringify((this.herdrFind && this.herdrFind.tried) || [])}`);
        this.store.addEvent(null, 'herdr_missing', { tried: (this.herdrFind && this.herdrFind.tried) || [] });
        return this.herdrCompat;
      }
      let r;
      try { r = await this.adapter.startServer(); }
      catch (e) {
        this.herdrMissing = { reason: e.code || 'start_failed', error: e.herdrMessage || e.message, path: this.adapter.herdrPath, at: Date.now() };
        this.herdrCompat = { ok: false, level: 'missing', problems: [`herdr server did not start: ${e.code}: ${e.herdrMessage || e.message}`], version: null, protocol: null, capabilities: null, warning: null };
        this.herdrOk = false;
        this.log(`herdr server start failed (${this.adapter.herdrPath}): ${e.message}`);
        this.store.addEvent(null, 'herdr_missing', { reason: e.code, error: e.herdrMessage || e.message });
        return this.herdrCompat;
      }
      pong = r.pong;
      this.log(`herdr server started pid=${r.pid} in ${r.ms}ms exe=${this.adapter.herdrPath}`);
      this.store.addEvent(null, 'herdr_started', { pid: r.pid, by: 'backend' });
    }
    this.setHerdrCompat(this.adapter.checkCompat(pong));
    return this.herdrCompat;
  }
  // P40: 호환 결과를 두고, 시험하지 않은 버전·다른 프로토콜이면 판 이벤트와 로그로 한 번씩 알린다
  setHerdrCompat(c) {
    this.herdrCompat = c;
    this.herdrOk = !!c.ok;
    const key = `${c.level}:${c.version}:${c.protocol}`;
    if (key === this._compatNoted) return;
    this._compatNoted = key;
    if (c.level === 'untested') { this.log(`herdr untested: ${c.warning}`); this.store.addEvent(null, 'herdr_untested', { version: c.version, protocol: c.protocol, tested: c.tested }); }
    if (c.level === 'incompatible') { this.log('herdr incompatible:', c.problems.join('; ')); this.store.addEvent(null, 'herdr_incompatible', { version: c.version, protocol: c.protocol, problems: c.problems }); }
  }

  // P40: 설정의 herdr 경로(따옴표는 뗀다)
  herdrSettingPath() {
    const v = ((this.features && this.features.settings.get()) || this.store.getMeta('settings') || {}).herdrPath;
    return String(v || '').trim().replace(/^"(.*)"$/, '$1');
  }
  // P40: 쓸 herdr 실행 파일을 고른다. 판 서버가 돌면 그 서버의 실행 파일(CLI·제어기·--skill이 서버와 같은 버전이 되게), 아니면 찾기 결과.
  // 서버 실행 파일을 못 읽으면 찾기 결과를 쓰고 진단에 남긴다
  async resolveHerdr(why) {
    const found = await findHerdr({ envPath: this.cfg.herdrEnvPath, bundledPath: this.cfg.bundledHerdrPath, settingPath: this.herdrSettingPath() }).catch((e) => ({ path: null, tried: [], reason: `find failed: ${e.message}` }));
    const p = await this.adapter.probe();
    let serverExe = null, note = null;
    if (p.running) {
      serverExe = await readServerExe(this.cfg.herdrSession, this.adapter.serverPid()).catch(() => null);
      if (!serverExe) note = 'running server executable unreadable; using discovered path';
    }
    const chosen = serverExe ? { path: serverExe, source: 'server', reason: 'running board herdr server' } : found.path ? { path: found.path, source: found.source, reason: found.reason } : null;
    this.adapter.herdrPath = chosen ? chosen.path : null;
    this.cfg.herdrPath = this.adapter.herdrPath;
    this.herdrFind = { why, at: Date.now(), chosen, serverRunning: p.running, serverExe, note, found: { path: found.path, version: found.version, source: found.source, reason: found.reason }, tried: found.tried };
    this.lastFound = found;
    this.log(`herdr resolve (${why}): ${chosen ? `${chosen.source} ${chosen.path}` : 'none'}${note ? ` (${note})` : ''}`);
    return this.herdrFind;
  }
  // P40: 다시 찾기(창의 단추, 설정 저장). 이미 붙어 있으면 진단만 고친다. 못 붙어 있으면 찾아서 서버를 띄우고 붙는다(백엔드를 다시 켜지 않는다)
  async rediscoverHerdr(why = 'rediscover') {
    if (this._rediscovering) return this._rediscovering;
    this._rediscovering = (async () => {
      await this.resolveHerdr(why);
      if (!this.adapter.connected) {
        await this.ensureHerdr();
        if (this.herdrOk) {
          if (!this.adapter._watching) this.adapter.startEvents(() => [...this.sessions.values()].map((s) => s.paneId).filter(Boolean));
          for (let i = 0; i < 50 && !this.adapter.connected; i++) await sleep(100); // 이벤트 구독이 붙을 때까지 잠깐(답에 connected를 담는다)
          // 처음에 herdr 없이 떴으면 플러그인의 herdr 스킬은 기본 글이다. 이 herdr의 글로 다시 쓴다
          this.plugin = writeBoardPlugin({ dir: path.join(this.cfg.dataDir, 'plugin'), skillText: await this.herdrSkillText(), ...this.branch.pluginExtra() });
        }
      }
      await this.checkHerdrUpdate(why).catch(() => {});
      this.api.broadcast('herdr', this.herdrView());
      return this.herdrStatus();
    })().finally(() => { this._rediscovering = null; });
    return this._rediscovering;
  }
  // P40: 판 서버가 도는 동안 찾기 결과가 더 새 버전을 가리키면 알린다(한 버전에 한 번). 저절로 다시 띄우지 않는다
  async checkHerdrUpdate(why) {
    if (!this.adapter.connected && !(this.herdrCompat && this.herdrCompat.version)) return null;
    this._updateCheckedAt = Date.now();
    const found = why === 'start' && this.lastFound ? this.lastFound : await findHerdr({ envPath: this.cfg.herdrEnvPath, bundledPath: this.cfg.bundledHerdrPath, settingPath: this.herdrSettingPath() }).catch(() => null);
    if (found) this.lastFound = found;
    const n = updateNotice({ serverVersion: this.herdrCompat && this.herdrCompat.version, found });
    const prev = this.herdrUpdate;
    this.herdrUpdate = n;
    if (n && (!prev || prev.version !== n.version)) {
      this.log(`herdr update available (${why}): ${n.message}`);
      this.store.addEvent(null, 'herdr_update_available', { version: n.version, serverVersion: n.serverVersion, source: n.source });
      this.api.broadcast('herdr', this.herdrView());
    } else if (!n && prev) this.api.broadcast('herdr', this.herdrView());
    return n;
  }
  // P40: 창이 띠와 표시에 쓰는 herdr 상태
  herdrView() {
    const c = this.herdrCompat || {};
    return {
      connected: !!(this.adapter && this.adapter.connected), session: this.cfg.herdrSession, path: this.adapter ? this.adapter.herdrPath : null,
      missing: this.herdrMissing || null, level: c.level || null, version: c.version || null, protocol: c.protocol ?? null, warning: c.warning || null, problems: c.problems || [],
      protocols: this.cfg.herdrProtocols, tested: this.cfg.herdrTested,
      find: this.herdrFind ? { chosen: this.herdrFind.chosen, note: this.herdrFind.note, tried: this.herdrFind.tried } : null,
      update: this.herdrUpdate || null,
    };
  }

  async herdrSkillText() {
    const t = await this.adapter.skillText().catch(() => null);
    if (t) return t;
    try { return fs.readFileSync(path.join(process.env.USERPROFILE || '', '.agents', 'skills', 'herdr', 'SKILL.md'), 'utf8'); } catch { return '---\nname: herdr\ndescription: Control Herdr. Run `herdr --help`.\n---\n'; }
  }

  // ---------- 세션 표시 ----------
  // 판의 hook이 붙은 세션(판이 띄운 Claude Code). 나머지는 herdr 상태와 화면으로만 본다(P4)
  hooked(s) { return s.rt.hooked !== false; }
  nameOf(sid) { return shownName(this.sessions.get(sid)); } // P66: 보이는 이름(판의 이름이 있으면 그것)
  sessionByPane(paneId) { for (const s of this.sessions.values()) if (s.paneId === paneId) return s; return null; }
  resolve(ref) {
    if (!ref) throw apiError('bad_request', 'session required');
    const s = findSession(this.sessions.values(), ref); // P66: 세션 ID, 주소(herdr 이름), 판의 이름
    if (s) return s;
    throw keyed(apiError('not_found', `보드에서 세션을 찾을 수 없습니다: ${ref}`), 'sessionNotFound', { ref });
  }
  currentSession(s, rt = s.rt, paneId = s.paneId) {
    return !this.stopping && this.sessions.get(s.sessionId) === s && s.rt === rt && s.paneId === paneId;
  }
  async checkAgyComposer(s) {
    const rt = s.rt, paneId = s.paneId;
    const text = await this.adapter.readScreen(paneId, { source: 'visible' });
    if (!this.currentSession(s, rt, paneId)) return 'starting';
    s.rt.agyComposer = agyComposerState(text);
    if (s.rt.agyComposer === 'waiting') s.rt.screenAsk = { tail: tailText(text, 14), at: Date.now() };
    this.broadcastSession(s, { cause: 'agy:composer' });
    return s.rt.agyComposer;
  }
  async promptManaged(sid, text, { typeNow = false } = {}) {
    const s = this.sessions.get(sid);
    if (!s || this.stopping) throw apiError('agent_not_found', '세션이 닫혔습니다');
    const rt = s.rt, paneId = s.paneId;
    if (s.kind === 'agy' && await this.checkAgyComposer(s) !== 'ready') throw apiError('agent_blocked', 'Antigravity 초기 설정·질문은 터미널에서 완료하세요');
    if (!this.currentSession(s, rt, paneId) || s.rt.exit || this.killing.has(sid)) throw apiError('agent_not_found', '세션이 바뀌었거나 종료 중입니다');
    const state = deriveState(s.rt).state;
    if (state === 'working' && typeNow && s.kind === 'claude' && this.hooked(s)) {
      const screen = await this.adapter.readScreen(paneId, { source: 'visible' });
      if (!this.currentSession(s, rt, paneId) || claudeInputBox(screen).text?.trim() || !claudeInputBox(screen).found || (s.lastUserInputAt && Date.now() - s.lastUserInputAt < this.cfg.inputQuietMs)) throw apiError('agent_blocked', '입력 중이거나 확인할 질문이 있어 잠시 기다립니다');
    } else if (['working', 'waiting', 'trust_wait', 'starting'].includes(state)) throw apiError('agent_blocked', '세션이 아직 입력을 받을 수 없습니다');
    const scoped = s.kind === 'codex' && s.rt.codexContext && !s.rt.codexBriefed ? `${s.rt.codexContext}\n\n${text}` : text;
    const result = await this.sendPrompt(sid, scoped);
    if (this.currentSession(s, rt, paneId) && s.kind === 'codex') {
      s.rt.codexBriefed = true;
      this.store.saveRuntime(s.sessionId, s.rt);
    }
    return result;
  }
  deliveryView(sid, d) {
    const s = this.sessions.get(sid);
    if (!s) return { closed: true };
    const sleeping = this.sleeper && this.sleeper.going.has(sid); // P21: 잠재우는 중에는 보내지 않는다(끝나면 깨운다)
    const st = deriveState(s.rt).state;
    // 깨우는 중에는 준비된 뒤 잠깐 더 기다린다(sleep.mjs WAKE_SETTLE_MS: 입력 칸이 Enter를 받기 전에 보내면 제출되지 않는다)
    const gated = this.branch && this.branch.holds(sid); // P36: 신뢰 관문을 지나 claude -w로 뜰 때까지 보내지 않는다
    return { state: sleeping ? 'sleeping' : gated ? 'starting' : s.waking && st !== 'sleeping' ? 'starting' : st, agentPresent: s.rt.herdr.present, herdrConnected: this.adapter.connected, lastUserInputAt: s.lastUserInputAt, closed: false, kind: s.kind || 'claude', hooked: this.hooked(s) }; // P90: kind·hooked는 바로 넣기(canTypeNow)가 본다
  }

  summary(s) {
    const rt = s.rt;
    const d = deriveState(rt);
    const f = flags(rt, { seenAt: s.seenAt, delivering: this.queue ? this.queue.pending(s.sessionId) : 0, quietMs: this.cfg.quietMs });
    const ask = d.ask ? { ...d.ask, input: undefined, waitedMs: d.ask.since ? Date.now() - d.ask.since : null } : null;
    return {
      sessionId: s.sessionId, name: shownName(s), cwd: s.cwd, paneId: s.paneId, herdrWorkspaceId: s.herdrWorkspaceId,
      address: s.name, label: s.label || null, // P66: name은 보이는 이름, address는 에이전트가 쓰는 주소(herdr 이름), label은 사람이 정한 이름(없으면 null)
      state: d.state, estimate: d.estimate || null, herdrStatus: rt.herdr.status, ask, error: d.error || rt.lastError || null,
      permissionMode: rt.permissionMode || s.permissionMode, model: s.model, effort: s.effort || null, // P95: 미션 맵 카드의 메타 줄
      lastPrompt: clip(rt.lastPrompt, 300), lastAnswer: clip(rt.lastAnswer, 300), lastAnswerAt: rt.lastAnswerAt, turn: rt.turn,
      exit: rt.exit, interruptedTurn: rt.interruptedTurn, recovered: s.recovered || null, ...f,
      deliveryStuck: this.queue && this.queue.stuckOf ? this.queue.stuckOf(s.sessionId) : null, // P106: herdr가 오래 받지 않는 맨 앞 전달 { deliveryId, reason, code, attempts, since }
      trust: { predictedDialog: rt.trustPredicted, seenOnScreen: !!rt.trustScreen },
      resume: this.hooked(s) ? { registered: !!s.resumeArgv, verified: !!s.resumeVerified } : null, // hook이 없는 세션은 herdr의 이어 가기에 맡긴다
      hooks: { count: s.hookCount || 0, lastAt: rt.lastHookAt, lastAuthOk: s.lastHookAuthOk ?? null },
      createdAt: s.createdAt, seenAt: s.seenAt, touchedAt: s.touchedAt || null, lastActivityAt: rt.lastActivityAt,
      memMB: this.memOf(s.sessionId),
      // P4
      kind: s.kind || 'claude', origin: s.origin || 'board', parentSessionId: s.parentSessionId || null, hooked: this.hooked(s), agentName: s.agentName,
      flavor: s.flavor || null, // P25: 띄운 방법(deepseek). 창은 종류 대신 이것으로 로고와 이름을 보인다
      background: rt.bg ? { tasks: rt.bg.tasks.length, types: [...new Set(rt.bg.tasks.map((x) => x.type))], at: rt.bg.at } : null, // P92: 도는 Claude Code 뒤 일(마지막 Stop hook 기준)

      answerSource: rt.answerSource || (rt.lastAnswer ? 'hook' : null), cwdNow: rt.cwd || s.cwd,
      git: s.git ? { isRepo: s.git.isRepo, root: s.git.root, commonDir: s.git.commonDir, mainRoot: s.git.mainRoot, isWorktree: s.git.isWorktree, branch: s.git.branch, cwd: s.git.cwd, changedFiles: s.git.changedFiles } : null,
      // P5: 리포지토리 워크스페이스(시작 폴더로 정함), 지금 그 밖에서 일하는가, 셸이 돌리는 명령
      workspaceKey: s.workspaceKey || null, elsewhere: elsewhereOf(this.store.getWorkspace(s.workspaceKey), s.git),
      shell: s.kind === SHELL ? { atPrompt: rt.shell ? rt.shell.atPrompt : true, command: rt.shell ? rt.shell.command : null, procs: (rt.shell && rt.shell.procs) || [], since: rt.shell ? rt.shell.since : null } : null,
      fromShell: !!rt.shellBase,
      ...(this.features ? this.features.summaryExtra(s) : {}), // P6b: output(긴 답인지), loops(켜진 루프 수)
      ...(this.branch ? this.branch.summaryExtra(s) : {}), // P8: branch(깊이, 부모 이름, 하위 세션이면 역할)
      ...(this.sleeper ? this.sleeper.summaryExtra(s) : {}), // P21: sleep(잠든 때, 아낀 메모리, 깨우기 실패), waking
      ...(this.desktopImport ? this.desktopImport.summaryExtra(s) : {}), // P34: imported(데스크톱 앱에서 가져온 세션의 앱 제목)
    };
  }

  // P92: 웹 푸시가 보는 세션 나무(가볍게: 요약을 다 만들지 않는다). bg = 도는 뒤 일 수(Stop hook의 background_tasks, 모르면 null)
  pushTree() {
    return [...this.sessions.values()].map((s) => ({
      sessionId: s.sessionId, parentSessionId: s.parentSessionId || null, name: shownName(s), kind: s.kind || 'claude', state: deriveState(s.rt).state, workspaceKey: s.workspaceKey || null,
      delivering: this.queue ? this.queue.pending(s.sessionId) : 0, loops: this.features && this.features.loops ? this.features.loops.activeCount(s.sessionId) : 0,
      bg: s.rt.bg ? s.rt.bg.tasks.length : null,
    }));
  }

  // ---------- 리포지토리 워크스페이스(P5, ARCH 4절 G) ----------
  // 판의 워크스페이스는 리포지토리 하나다(workspaceKey). herdr의 작업 공간(herdrWorkspaceId)과 다르다.
  workspaceList() {
    const rows = this.store.workspaces();
    const names = workspaceNames(rows);
    const sums = [...this.sessions.values()].map((s) => this.summary(s));
    const labels = wsLabels(readGroups(this), rows); // P91: 저절로 만든 묶음 안에서는 뿌리에서의 상대 경로(영역 이름표, 사이드바)
    return rows.map((w) => ({ key: w.key, name: names.get(w.key), ...(labels.has(w.key) ? { label: labels.get(w.key) } : {}), kind: w.kind, root: w.root, createdAt: w.createdAt, counts: workspaceCounts(sums, w.key), x: w.x, y: w.y, auto: !!w.auto, worktrees: this.worktrees ? this.worktrees.view(w.key) : [] })); // P27: 워크트리 영역
  }
  // P48: 폴더 탐색기의 최근 폴더(워크스페이스 뿌리, 최근 세션 폴더)
  recentDirs() { const ss = [...this.sessions.values()].sort((a, b) => (b.touchedAt || b.createdAt || 0) - (a.touchedAt || a.createdAt || 0)); return [...this.store.workspaces().map((w) => w.root), ...ss.map((x) => x.cwd)].filter(Boolean); }
  currentWorkspace() { const k = this.store.getMeta('currentWorkspace'); return k && this.store.getWorkspace(k) ? k : (this.store.workspaces()[0] || {}).key || null; }
  broadcastWorkspaces() { syncWsGroups(this, 'list'); this.api.broadcast('workspace.updated', { workspaces: this.workspaceList(), current: this.currentWorkspace(), groups: readGroups(this).groups }); } // P44: groups(가상 그룹)
  // 처음 보는 워크스페이스면 줄을 만든다(세션이 하나라도 생기면 워크스페이스가 저절로 생긴다, G1)
  ensureWorkspace(ws, why) {
    if (this.store.getWorkspace(ws.key)) return false;
    if (adoptTwin(this, ws, why)) return false; // P37: 같은 폴더의 다른 키 워크스페이스(폴더가 저장소가 됨)를 이 키로 옮겼다
    this.store.insertWorkspace({ ...ws, createdAt: Date.now() });
    syncWsGroups(this, 'created'); // P91: 묶음을 먼저 맞춰 새 영역을 그 묶음 곁에 놓는다
    anchorWorkspace(this, ws.key); // P6a: 새 영역은 다른 영역과 겹치지 않는 곳(H1)
    if (!this.store.getMeta('currentWorkspace')) this.store.setMeta('currentWorkspace', ws.key);
    this.store.addEvent(null, 'workspace_created', { key: ws.key, kind: ws.kind, root: ws.root, why });
    this.broadcastWorkspaces();
    this.bus.emit('workspace', ws.key); // P7: 그 리포의 판 밖 대화를 찾는다(J3)
    return true;
  }
  // P37: 열린 워크스페이스를 다시 보아 폴더 ↔ 저장소로 바뀐 것을 옮긴다(worktrees.mjs sync가 부른다)
  reconcileWorkspaces(cause, options = {}) { return reconcileWorkspaces(this, cause, options); }
  // 키, 이름(대소문자 무시), 또는 그 안의 폴더 경로로 워크스페이스를 찾는다
  async resolveWorkspace(ref, { required = true } = {}) {
    if (!ref) { if (required) throw apiError('bad_request', 'workspace required'); return null; }
    const r = String(ref);
    if (this.store.getWorkspace(r)) return this.store.getWorkspace(r);
    const list = this.workspaceList();
    const byName = list.find((w) => w.name.toLowerCase() === r.toLowerCase()) || list.find((w) => w.key === pathKey(r));
    if (byName) return this.store.getWorkspace(byName.key);
    if (fs.existsSync(r)) { const ws = await workspaceOf(path.resolve(r)); const w = this.store.getWorkspace(ws.key); if (w) return w; }
    if (required) throw keyed(apiError('not_found', `보드에서 프로젝트를 찾을 수 없습니다: ${ref}`), 'wsNotFound', { ref });
    return null;
  }
  // "+ 리포 열기": 폴더를 골라 빈 워크스페이스를 만든다(이미 있으면 그대로)
  async workspaceOpen(p) {
    const dir = path.resolve(String(p.path || ''));
    if (!p.path || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw keyed(apiError('bad_request', `폴더를 찾을 수 없습니다: ${p.path}`), 'noFolder', { path: p.path });
    const ws = await workspaceOf(dir);
    const created = this.ensureWorkspace(ws, 'open');
    this.bus.emit('workspace_opened', ws.key); // P10: 사람이 연 워크스페이스는 저절로 연 것이 아니다(닫은 기억도 지운다)
    if (p.select !== false) { this.store.setMeta('currentWorkspace', ws.key); this.broadcastWorkspaces(); }
    return { created, workspace: this.workspaceList().find((w) => w.key === ws.key) };
  }
  // 워크스페이스를 판에서 지운다(빼기). P44: 여럿(workspaces)을 한 번에, 안에 세션이 있으면 after('archive' 모두 보관 | 'delete' 모두 삭제)를 골라야 한다.
  // confirm이 없으면 지울 것과 세션 수, 돌고 있는 CLI 수(plan)를 돌려준다. 디스크의 폴더와 대화 기록 파일은 건드리지 않는다(삭제도 판의 닫힌 세션 행만 지운다).
  // 세션을 끄지 못한 워크스페이스는 남긴다. 사람이 지운 워크스페이스는 다시 저절로 열지 않는다(P10)
  async workspaceClose(p) {
    const refs = Array.isArray(p.workspaces) && p.workspaces.length ? p.workspaces : [p.workspace];
    const ws = [];
    for (const ref of refs) { const w = await this.resolveWorkspace(ref); if (!ws.some((x) => x.key === w.key)) ws.push(w); }
    const list = this.workspaceList();
    const named = ws.map((w) => ({ key: w.key, root: w.root, name: (list.find((x) => x.key === w.key) || {}).name || w.key }));
    const sums = [...this.sessions.values()].map((s) => this.summary(s));
    const plan = closePlan(named, sums);
    if (!p.confirm) {
      if (named.length === 1 && plan.empty) return confirmResult(`빈 프로젝트 ${named[0].name}(${named[0].root})를 닫습니다. 폴더와 Git 저장소는 그대로 유지합니다.`, m('wsClose', { name: named[0].name, root: named[0].root }), { plan });
      return confirmResult(`프로젝트 ${named.length}개를 보드에서 제거합니다 (세션 ${plan.sessions}개, 실행 중인 CLI ${plan.running}개). 폴더와 대화 기록 파일은 그대로 유지합니다.`, m(plan.empty ? 'wsCloseMany' : 'wsCloseSessions', { n: named.length, sessions: plan.sessions, running: plan.running }), { plan });
    }
    const chk = checkAfter(plan, p.after);
    if (!chk.ok && chk.reason === 'choose') throw keyed(apiError('not_empty', `세션이 ${plan.sessions}개 있습니다. after에 archive(모두 보관) 또는 delete(모두 삭제)를 지정하세요.`), 'wsChooseAfter', { n: plan.sessions });
    if (!chk.ok) throw apiError('bad_request', `after에는 archive 또는 delete를 지정하세요: ${p.after}`);
    const keys = new Set(named.map((w) => w.key));
    const targets = [...this.sessions.values()].filter((s) => keys.has(s.workspaceKey));
    const done = { archived: 0, deleted: 0, failed: [] };
    await Promise.all(targets.map(async (s) => {
      try {
        await this.kill({ session: s.sessionId, confirm: true, ...(chk.after === 'archive' ? { after: 'archive' } : {}) });
        if (chk.after === 'archive') done.archived++;
        else { this.dropClosedRow(s.sessionId, 'workspace_removed'); done.deleted++; }
      } catch (e) { done.failed.push({ sessionId: s.sessionId, name: s.name, error: e.code || String(e.message || e) }); }
    }));
    const closed = [], kept = [];
    for (const w of named) {
      if ([...this.sessions.values()].some((s) => s.workspaceKey === w.key)) { kept.push(w.key); continue; }
      this.removeWorkspace(w.key);
      closed.push(w.key);
    }
    if (closed.length) { this.store.setMeta(GROUPS_META, dropWorkspaces(readGroups(this), closed)); this.broadcastWorkspaces(); }
    return { closed: closed.length === named.length, removed: closed, kept, key: named[0].key, after: chk.after, sessions: done };
  }
  // 워크스페이스 행 하나를 판에서 뺀다(안에 세션이 없을 때)
  removeWorkspace(key) {
    // P6c: 그 영역의 메모·칸반은 지우지 않고 소속만 푼다(자리는 그대로)
    for (const m of this.store.memos().filter((x) => x.workspaceKey === key)) { this.store.updateMemo(m.memoId, { workspaceKey: null }); this.api.broadcast('memo.updated', this.store.getMemo(m.memoId)); }
    for (const k of this.store.kanbans().filter((x) => x.workspaceKey === key)) { this.store.updateKanban(k.kanbanId, { workspaceKey: null }); if (this.features) this.features.kanbans.emit(this.store.getKanban(k.kanbanId)); }
    this.store.deleteWorkspace(key);
    if (this.store.getMeta('currentWorkspace') === key) this.store.setMeta('currentWorkspace', (this.store.workspaces()[0] || {}).key || null);
    this.store.addEvent(null, 'workspace_closed', { key });
    this.bus.emit('workspace_closed', key); // P10: 사람이 닫은 워크스페이스는 다시 저절로 열지 않는다
    this.broadcastWorkspaces();
  }
  // P44: 닫힌 세션 행만 판에서 지운다. 대화 기록 파일은 그대로다(노드 X의 "삭제"와 달리 휴지통으로 보내지 않는다)
  dropClosedRow(sessionId, why) {
    const row = this.store.closedSession(sessionId);
    if (!row) return false;
    this.store.tx(() => { this.store.deleteClosedSession(sessionId); this.store.addEvent(sessionId, 'session_deleted', { name: row.name, kind: row.kind, trashed: 0, why }); });
    if (this.recall) this.recall.changed({ force: true }).catch(() => {});
    return true;
  }
  // 창이 지금 보는 워크스페이스(앱을 다시 열면 여기로 들어간다. @all의 범위)
  async workspaceSelect(p) {
    const w = await this.resolveWorkspace(p.workspace);
    this.store.setMeta('currentWorkspace', w.key);
    return { current: w.key };
  }
  memOf(sid) { const r = this.resources && this.resources.last && this.resources.last.sessions.find((x) => x.sessionId === sid); return r ? r.memMB : null; }

  // E2: 사람이 이 세션에 마지막으로 손댄 시각(보기, 입력, 보내기, 답하기). 터미널 입력은 10초에 한 번만 쓴다.
  touch(s, now = Date.now()) {
    const prev = s.touchedAt || 0;
    s.touchedAt = now;
    if (now - prev > TOUCH_WRITE_MS) this.store.updateSession(s.sessionId, { touchedAt: now });
  }

  broadcastSession(s, { cause, onlyIfFlagsChanged = false } = {}) {
    if (!this.currentSession(s)) return;
    const sum = this.summary(s);
    const key = `${sum.state}|${sum.unseen}|${sum.quiet}|${sum.delivering}`;
    if (onlyIfFlagsChanged && key === s.lastKey) return;
    s.lastKey = key;
    if (sum.state !== s.lastState) {
      const from = s.lastState;
      s.lastState = sum.state;
      if (from !== null || cause) {
        this.store.addEvent(s.sessionId, 'state', { from, to: sum.state, herdr: sum.herdrStatus, cause: cause || null, ask: sum.ask, exit: sum.exit, error: sum.state === 'error' ? sum.error : undefined });
        this.api.broadcast('session.state', { sessionId: s.sessionId, name: shownName(s), from, to: sum.state, cause: cause || null, summary: sum });
        this.onLinkTargetState(s, from, sum);
        if (this.web) try { this.web.push.onState(sum, from); } catch (e) { this.log('push error', e.stack); } // P88: 휴대폰 웹 푸시(끝남, 응답 필요, 오류)
      }
    }
    this.api.broadcast('session.updated', sum);
    this.bus.emit('session', s, sum);
    this.store.saveRuntime(s.sessionId, s.rt);
    if (this.queue) setImmediate(() => this.queue.pump());
  }

  // ---------- hook 수신기 ----------
  onHttp(req, res) {
    const route = req.url.split('?')[0];
    if ((route.startsWith('/hooks/') || (route === '/branch' || route.startsWith('/branch/'))) && !isLocalProcess(req, this.cfg.port)) { res.writeHead(403); res.end(); return; }
    if (req.method === 'POST' && ['/hooks/claude', '/hooks/gemini', '/hooks/agy'].includes(route)) return this.onHook(req, res);
    if (this.branch && this.branch.handleHttp(req, res)) return; // P8: POST /branch/*(하위 세션 명령, 세션 토큰)
    if (this.web && this.web.handleHttp(req, res)) return; // P48: 웹 화면(/, 정적 파일)과 /web/*(짝 맺기, 기기 정보, 업로드)
    if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, pid: process.pid })); }
    res.writeHead(404); res.end();
  }
  onHook(req, res) {
    const chunks = []; let size = 0; let tooBig = false;
    req.on('data', (d) => { size += d.length; if (size > 8 * 1024 * 1024) tooBig = true; else chunks.push(d); });
    req.on('end', () => {
      res.writeHead(200); res.end(); // 먼저 200을 돌려준다. Claude Code는 hook 응답을 기다린다(E2 2.3).
      if (tooBig) return this.log('hook body too large', size);
      setImmediate(() => {
        try { this.processHook(req.headers, Buffer.concat(chunks).toString('utf8'), req.url.split('?')[0].split('/').at(-1)); } catch (e) { this.log('hook error', e.stack); }
      });
    });
  }
  processHook(headers, raw, provider = 'claude') {
    let body; try { body = JSON.parse(raw); } catch { return this.log('hook bad json'); }
    const sid = headers['x-mt-session'] || body.session_id;
    const s = this.sessions.get(sid) || [...this.sessions.values()].find((x) => x.rt.claudeSessionId === body.session_id);
    const nativeBody = body;
    if (provider === 'gemini' || provider === 'agy') {
      if (!s || s.kind !== provider || !s.hookToken) return;
      const normalized = provider === 'agy' ? normalizeAgyHook(body) : normalizeGeminiHook(body);
      if (!normalized) return;
      body = normalized;
    }
    const ev = body.hook_event_name;
    if (!s) { this.store.addEvent(null, 'hook_unknown_session', { ev, sid }); return; }
    const authOk = headers.authorization === `Bearer ${s.hookToken}`;
    s.lastHookAuthOk = authOk;
    if (!authOk) { this.store.addEvent(s.sessionId, 'hook_rejected', { ev }); this.log(`hook rejected ${s.name} ${ev}`); return; }
    if (provider === 'gemini' || provider === 'agy') {
      const nativeId = provider === 'agy' ? nativeBody.conversationId : nativeBody.session_id;
      const previousId = s.rt[`${provider}SessionId`];
      if (nativeId && previousId && nativeId !== previousId) {
        if (ev !== 'SessionStart') { this.store.addEvent(s.sessionId, 'hook_stale_conversation', { provider, ev }); return; }
        s.rt[`${provider}AnswerStep`] = null;
        s.rt[`${provider}TurnActive`] = false;
        s.rt[`${provider}StoppedAt`] = null;
        s.rt.lastAnswer = null; s.rt.lastAnswerAt = null;
      }
    }
    s.hookCount = (s.hookCount || 0) + 1;
    applyHook(s.rt, body);
    if (s.kind === 'claude' && this.hooked(s) && body.session_id) this.refreshClaudeResume(s);
    if (provider === 'gemini') {
      s.rt.geminiReady = true;
      if (typeof nativeBody.session_id === 'string') s.rt.geminiSessionId = nativeBody.session_id;
      if (typeof nativeBody.transcript_path === 'string' && nativeBody.transcript_path) s.rt.geminiTranscriptPath = nativeBody.transcript_path;
      if (ev === 'UserPromptSubmit') s.rt.geminiTurnActive = true;
      if (ev === 'Stop' || ev === 'SessionEnd') s.rt.geminiTurnActive = false;
      if (ev === 'Stop') this.store.addEvent(s.sessionId, 'answer_gemini', { text: body.last_assistant_message, prompt: s.rt.lastPrompt });
    }
    if (provider === 'agy') {
      if (typeof nativeBody.conversationId === 'string') s.rt.agySessionId = nativeBody.conversationId;
      if (typeof nativeBody.transcriptPath === 'string') s.rt.agyTranscriptPath = nativeBody.transcriptPath;
      if (body.notification_type === 'agy_working') {
        s.rt.agyInvocationSeq = (s.rt.agyInvocationSeq || 0) + 1;
        if (!s.rt.agyTurnActive) s.rt.turn = { startedAt: Date.now(), endedAt: null };
        s.rt.agyTurnActive = true; s.rt.agyStoppedAt = null; s.rt.lastError = null; this.queue.onAgentWorking(s.sessionId);
      }
      if (body.notification_type === 'agy_stop' && nativeBody.fullyIdle === true) {
        const rt = s.rt, paneId = s.paneId, invocation = rt.agyInvocationSeq;
        const stop = rt.agyStopSeq = (rt.agyStopSeq || 0) + 1;
        setImmediate(() => this.completeAgyTurn(s, { rt, paneId, invocation, stop, error: nativeBody.error }).catch((e) => {
          if (!this.stopping) this.log('agy completion failed', e.message);
        }));
      }
    }
    if (ev === 'Stop') s.rt.answerSource = 'hook';
    // F4: Claude Code는 워크트리로 들어가면 hook의 cwd가 바뀐다
    if (body.cwd && body.cwd !== s.rt.cwd) { s.rt.cwd = body.cwd; this.probeGit(s, body.cwd); }
    // F1·F3: 셸 명령 글에서 herdr 호출(일 시키기, 답 읽기, 새 에이전트 띄우기)을 찾는다
    if ((ev === 'PreToolUse' || ev === 'PostToolUse' || ev === 'PostToolUseFailure') && SHELL_TOOLS.has(body.tool_name)) { try { this.onShellHook(s, ev, body); } catch (e) { this.log('shell hook error', e.stack); } }
    if (ev === 'UserPromptSubmit') { s.draft = false; this.onLinkTargetPrompt(s, body.prompt); }
    const info = { ev, tool: body.tool_name || null, authOk, bytes: raw.length, sessionIdMatches: body.session_id === s.sessionId, permissionMode: body.permission_mode || null };
    if (ev === 'Stop') info.lastAnswer = clip(body.last_assistant_message, 300);
    if (ev === 'UserPromptSubmit') info.prompt = clip(s.rt.lastPrompt, 200);
    if (ev === 'SessionEnd') info.reason = body.reason;
    if (ev === 'StopFailure') info.error = s.rt.lastError;
    if (ev === 'PermissionRequest' || (ev === 'PreToolUse' && s.rt.pendingAsk && s.rt.pendingAsk.toolUseId === body.tool_use_id)) info.ask = { ...s.rt.pendingAsk, input: undefined };
    this.store.addEvent(s.sessionId, 'hook', info);
    this.api.broadcast('session.hook', { sessionId: s.sessionId, name: s.name, ...info });
    if (ev === 'UserPromptSubmit') this.queue.onUserPromptSubmit(s.sessionId, body.prompt);
    if (ev === 'PermissionRequest' && s.rt.pendingAsk && (s.rt.pendingAsk.kind === 'permission' || s.rt.pendingAsk.kind === 'plan')) this.readChoicesLater(s);
    if (ev === 'Stop') this.probeGit(s, s.rt.cwd || s.cwd); // A2: 바뀐 파일 수. F4: 지금 폴더(워크트리일 수 있다)로 본다
    this.broadcastSession(s, { cause: `hook:${ev}` });
  }

  async completeAgyTurn(s, { rt, paneId, invocation, stop, error }) {
    const current = () => this.currentSession(s, rt, paneId) && rt.agyInvocationSeq === invocation && rt.agyStopSeq === stop;
    if (!current()) return;
    await this.readScreenAnswer(s, { completed: true });
    if (!current()) return;
    rt.agyTurnActive = false; rt.turn.endedAt = Date.now(); rt.agyStoppedAt = Date.now();
    if (error) rt.lastError = { type: 'agy_error', message: clip(error, 1000), at: Date.now() };
    this.broadcastSession(s, { cause: 'agy:stop' });
  }

  // 권한 요청의 선택지는 도구마다 달라 화면에서 읽는다(E9 2.1). 화면이 그려질 시간을 조금 준다.
  async readChoicesLater(s) {
    const ask = s.rt.pendingAsk;
    for (const wait of [400, 800, 1600]) {
      await sleep(wait);
      if (s.rt.pendingAsk !== ask) return;
      try {
        const text = await this.adapter.readScreen(s.paneId, { source: 'detection' });
        if (!this.currentSession(s) || s.rt.pendingAsk !== ask) return;
        const choices = parseChoices(text);
        if (choices.length) { ask.choices = choices; ask.question = parsePromptLine(text); this.broadcastSession(s, { cause: 'screen:choices' }); return; }
      } catch {}
    }
  }

  // ---------- herdr 이벤트 ----------
  async onHerdrEvent(e) {
    if (e.type === 'pane_moved') { const m = e.previousPaneId && this.sessionByPane(e.previousPaneId); if (m && e.paneId) this.setPane(m, e.paneId, e.workspaceId, 'pane moved'); return; }
    // herdr 작업 공간이 판 밖에서 닫혔다. 작업 공간을 닫아도 패널마다 pane_closed가 오지 않는다(P5에서 확인)
    if (e.type === 'workspace_closed') {
      for (const x of [...this.sessions.values()]) if (x.herdrWorkspaceId === e.workspaceId && !this.killing.has(x.sessionId)) this.closeSession(x, 'workspace closed outside board');
      return;
    }
    const s = e.paneId ? this.sessionByPane(e.paneId) : null;
    // F3·G2: 판 전용 herdr 세션에 판이 모르는 패널(새 셸, 에이전트가 나눈 패널)이나 에이전트가 나타났다. 판에 올린다.
    if (!s) { if (e.type === 'agent_detected' || e.type === 'pane_created') this.adoptPane(e.paneId, { cwd: e.cwd }).catch((err) => this.log('adopt error', err.stack)); return; }
    const now = Date.now();
    // 패널의 셸이 끝났다(셸에서 exit). 패널이 없어진다. pane_closed는 오지 않는다(P5에서 확인)
    if (e.type === 'pane_exited') { if (!this.killing.has(s.sessionId)) this.closeSession(s, 'pane exited'); return; }
    // G2: 일반 셸 노드. 그 패널에 에이전트가 나타나면 같은 노드의 종류만 바꾼다(새 노드를 만들지 않는다)
    if (s.kind === SHELL) {
      if (e.type === 'agent_detected' || (e.type === 'status' && e.status !== 'unknown')) await this.promoteShell(s, e.type);
      else if (e.type === 'pane_closed' && !this.killing.has(s.sessionId)) this.closeSession(s, 'pane closed outside board');
      return;
    }
    if (e.type === 'status' || e.type === 'agent_detected' || e.type === 'agent_released') this.queue.poke(s.sessionId); // P106: 에이전트가 바뀌었다. 물러나 있던 전달을 다시 본다
    if (e.type === 'status') {
      // 띄운 뒤 agent_detected를 놓쳤어도, 끝난 적 없는 세션에 상태가 오면 claude가 패널에 있다는 뜻이다(P2에서 더한 안전망).
      // 끝난 세션(exit)은 되살리지 않는다. 해제 직후에도 idle이 한 번 온다(E10 2.4).
      if (!s.rt.herdr.present && !s.rt.exit && e.status !== 'unknown') { applyAgentDetected(s.rt, now); this.store.addEvent(s.sessionId, 'herdr_agent', { detected: true, by: 'status' }); }
      const prev = applyHerdrStatus(s.rt, e.status, now);
      if (e.status !== 'unknown') s.resumingAfterHerdr = null; // 이어 가기가 됐다
      this.store.addEvent(s.sessionId, 'herdr_status', { from: prev, to: e.status });
      if (e.status === 'blocked' && !s.rt.pendingAsk) await this.checkBlocked(s);
      if (!this.currentSession(s)) return;
      if ((e.status === 'idle' || e.status === 'done') && !s.rt.herdr.agentSessionId) this.refreshAgent(s);
      if (!this.hooked(s)) {
        // hook이 없는 세션: 제출 확인은 herdr working으로, 마지막 답은 턴이 끝난 화면 끝으로 대신한다(F5)
        if (e.status === 'working') this.queue.onAgentWorking(s.sessionId);
        if ((prev === 'working' || prev === 'blocked') && (e.status === 'idle' || e.status === 'done') && !(s.kind === 'gemini' && s.rt.answerSource === 'hook' && s.rt.lastAnswerAt >= s.rt.turn.startedAt)) await this.readScreenAnswer(s);
        if (!s.adoptNamed) this.refreshAdoptedName(s);
      }
      this.broadcastSession(s, { cause: `herdr:${e.status}` });
    } else if (e.type === 'agent_detected') {
      applyAgentDetected(s.rt, now);
      this.store.addEvent(s.sessionId, 'herdr_agent', { detected: true });
      this.broadcastSession(s, { cause: 'herdr:agent_detected' });
      // P97: 실행 명령으로 뜬 claude는 herdr가 새로 알아볼 때(다시 켠 뒤 이어 가기 등) 이름을 잃는다. 알아본 뒤 이름을 다시 맞춘다.
      // P106: 판이 띄운 Codex도 뜬 직후 herdr가 에이전트를 놓았다가(agent_released) 이름 없이 다시 알아본다(experiments/p106). 판이 띄운 세션이면 모두 맞춘다
      if ((s.startCommand && this.hooked(s)) || s.origin === 'board') for (const ms of [1500, 6000]) { const tm = setTimeout(() => { if (this.sessions.has(s.sessionId)) this.ensureAgentName(s); }, ms); if (tm.unref) tm.unref(); }
    } else if (e.type === 'agent_released') {
      applyAgentReleased(s.rt, now, { herdrStopping: this.herdrStopping });
      this.store.addEvent(s.sessionId, 'herdr_agent', { released: true, finalStatus: e.finalStatus, exit: s.rt.exit });
      // G2: 판이 띄우지 않은 에이전트(판에 올린 것, 셸에서 띄운 것)가 끝나면 패널은 셸로 남는다. 같은 노드를 셸로 되돌린다.
      // 판이 띄운 에이전트가 끝난 것은 지금처럼 exited로 둔다(이어 가기 규칙 그대로)
      if ((s.origin === 'adopted' || s.rt.shellBase) && !this.hooked(s) && !this.herdrStopping && !this.killing.has(s.sessionId)) return this.demoteToShell(s, 'agent released');
      this.broadcastSession(s, { cause: 'herdr:agent_released' });
      // P7(J1): 대화 기록이 없는 세션의 `claude --resume`은 잠깐 idle을 보인 뒤 끝나기도 한다(resumingAfterHerdr가 먼저 풀림). 되살리기 시작 30초 안의 해제도 이어 가기 실패로 본다
      const justRecovered = s.recoverStartedAt && Date.now() - s.recoverStartedAt < 30000;
      if ((s.resumingAfterHerdr || justRecovered) && !this.herdrStopping && this.hooked(s)) { s.resumingAfterHerdr = null; s.recoverStartedAt = null; this.relaunchIfEmpty(s); }
    } else if (e.type === 'pane_closed') {
      if (!this.killing.has(s.sessionId)) this.closeSession(s, 'pane closed outside board');
    }
  }

  // ---------- 일반 셸(G2, P5) ----------
  // 셸 패널에 에이전트가 나타났다(셸에서 claude를 침, herdr agent start --pane). 같은 노드의 종류를 바꾼다
  async promoteShell(s, why) {
    if (s.kind !== SHELL || s._promoting) return;
    s._promoting = true;
    try {
      await sleep(400); // herdr가 agent.start의 이름을 붙일 시간
      const a = (await this.adapter.listAgents()).find((x) => x.paneId === s.paneId);
      if (!a || !this.sessions.has(s.sessionId) || s.kind !== SHELL) return;
      const now = Date.now();
      const kind = a.agent || 'unknown';
      const rt = newRuntime({ kind, hooked: false });
      rt.shellBase = true; rt.cwd = s.rt.cwd;
      applyAgentDetected(rt, now);
      applyHerdrStatus(rt, a.status || 'unknown', now, { launchPending: a.launchPending, agentSessionId: a.agentSessionId });
      if (a.status && a.status !== 'unknown') rt.phase = 'running';
      const from = s.kind;
      s.rt = rt; s.kind = kind; s.agentName = a.name || s.paneId; s.adoptNamed = s.origin !== 'adopted' || !!a.name;
      if (s.origin === 'adopted' && a.name && NAME_RE.test(a.name) && a.name !== s.name && !nameOwner(this.sessions.values(), a.name, s)) {
        this.store.addEvent(s.sessionId, 'renamed', { from: s.name, to: a.name }); s.name = a.name; this.store.renameSession(s.sessionId, a.name);
      }
      this.store.updateSession(s.sessionId, { kind, agentName: s.agentName, runtime: rt });
      // 띄운 명령(hook의 herdr agent start)이 있으면 그 세션이 부모다(F3)
      const it = this.spawnIntents.filter((x) => now - x.at < this.cfg.adoptSpawnMatchMs).reverse().find((x) => x.verb === 'agent.start' && ((a.name && x.name === a.name) || x.pane === s.paneId));
      if (it && !s.parentSessionId && this.sessions.has(it.from) && it.from !== s.sessionId) this.setParent(s, this.sessions.get(it.from), it);
      this.linkUnresolved(s, a.name);
      this.store.addEvent(s.sessionId, 'shell_agent', { from, to: kind, herdrName: a.name || null, why });
      this.log(`shell ${s.name} now runs ${kind}`);
      this.broadcastSession(s, { cause: `shell:${kind}` });
    } finally { s._promoting = false; }
  }
  // 셸에서 띄운 에이전트가 끝났다: 같은 노드를 셸로 되돌린다
  demoteToShell(s, why) {
    const from = s.kind;
    const rt = newRuntime({ kind: SHELL, hooked: false });
    rt.cwd = s.rt.cwd; rt.phase = 'running'; rt.shellBase = false;
    s.rt = rt; s.kind = SHELL; s.agentName = s.paneId; s.openPromptFrom = null;
    this.queue.cancelSession(s.sessionId, 'agent exited, shell left');
    this.store.updateSession(s.sessionId, { kind: SHELL, agentName: s.agentName, runtime: rt });
    this.store.addEvent(s.sessionId, 'shell_agent', { from, to: SHELL, why });
    this.broadcastSession(s, { cause: 'shell' });
  }
  // 셸이 프롬프트에서 쉬는지, 무슨 명령을 돌리는지(화면 끝줄과 마지막 프롬프트 줄). 돌리는 셸은 자식 프로세스 이름도 읽는다
  async pollShells() {
    if (!this.adapter.connected || this._shellPolling) return;
    this._shellPolling = true;
    try {
      const busy = [];
      for (const s of [...this.sessions.values()]) {
        if (s.kind === 'agy' && s.paneId && !s.rt.exit && !s.rt.agyTurnActive) { await this.checkAgyComposer(s).catch(() => {}); continue; }
        if (s.kind !== SHELL || !s.paneId || s.rt.exit) continue;
        // 작은 노드나 나눈 패널처럼 좁으면 긴 프롬프트가 줄바꿈되어 프롬프트로 보이지 않는다. 줄바꿈을 푼 최근 줄로 읽는다(P6a, P6b가 따로 봄)
        const text = await this.adapter.readScreen(s.paneId, { source: 'recent_unwrapped', lines: 40 }).catch(() => null);
        if (text == null || !this.sessions.has(s.sessionId) || s.kind !== SHELL) continue;
        const st = shellPromptState(text);
        const prev = s.rt.shell;
        const same = prev && prev.atPrompt === st.atPrompt && prev.command === st.command;
        s.rt.shell = { atPrompt: st.atPrompt, command: st.command, procs: !st.atPrompt && same ? prev.procs || [] : [], procsAt: !st.atPrompt && same ? prev.procsAt || null : null, since: same ? prev.since : Date.now() };
        if (!st.atPrompt) busy.push(s);
        if (!same) {
          s.rt.lastActivityAt = Date.now();
          if (!st.atPrompt && s.rt.interruptedTurn) s.rt.interruptedTurn = null; // 새 명령을 돌리면 끊긴 명령 표시를 내린다(I8)
          this.store.addEvent(s.sessionId, 'shell', { atPrompt: st.atPrompt, command: clip(st.command, 200) });
          this.broadcastSession(s, { cause: 'shell' });
        }
      }
      const fresh = busy.some((s) => !s.rt.shell.procsAt);
      if (busy.length && (fresh || Date.now() - (this._shellProcsAt || 0) > SHELL_PROCS_MS)) { this._shellProcsAt = Date.now(); await this.readShellProcs(busy); }
    } finally { this._shellPolling = false; }
  }
  async readShellProcs(list) {
    const pids = new Map();
    for (const s of list) { const info = await this.adapter.processInfo(s.paneId).catch(() => null); if (info && info.shell_pid) pids.set(s.sessionId, info.shell_pid); }
    const kids = await childProcesses([...pids.values()]);
    for (const s of list) {
      if (!s.rt.shell || s.rt.shell.atPrompt) continue;
      const names = kids.filter((k) => k.ppid === pids.get(s.sessionId) && !/^conhost\.exe$/i.test(k.name)).map((k) => k.name);
      const changed = JSON.stringify(names) !== JSON.stringify(s.rt.shell.procs || []);
      s.rt.shell.procs = names; s.rt.shell.procsAt = Date.now();
      if (changed) this.broadcastSession(s, { cause: 'shell:procs' });
    }
  }
  // herdr 재시작 뒤 이어 가기가 실패한 세션: 한 턴도 돌지 않은 세션은 대화 기록이 없어 `claude --resume`이 "No conversation found"로 끝난다(P1).
  // 잃을 대화가 없으므로 같은 패널에서 같은 세션 ID와 설정 파일로 새로 띄운다. 대화 기록이 있는데 끝났으면 손대지 않고 exited로 둔다.
  async relaunchIfEmpty(s) {
    const tx = s.rt.transcriptPath || transcriptPathFor(this.cfg.claudeProjects, s.cwd, this.launchOf(s).sessionId);
    if (fs.existsSync(tx)) { this.store.addEvent(s.sessionId, 'resume_failed', { transcript: true }); return; }
    await sleep(500);
    if (!this.sessions.has(s.sessionId) || s.rt.herdr.present) return;
    await this.adapter.waitShellReady(s.paneId, 5000);
    const args = buildStartArgs(this.launchOf(s));
    try {
      await this.adapter.startAgent({ name: s.agentName, paneId: s.paneId, args, ...startOpt(s) });
      s.rt.exit = null; s.rt.phase = 'starting'; s.rt.launchedAt = Date.now(); s.rt.hooksSinceLaunch = 0; s.rt.sessionEnd = null;
      s.rt.herdr.launchPending = true; s.rt.herdr.agentSessionId = null;
      this.store.addEvent(s.sessionId, 'relaunched_fresh', { reason: 'resume found no conversation', args });
      this.broadcastSession(s, { cause: 'relaunch' });
      this.registerResume(s);
    } catch (e) { this.store.addEvent(s.sessionId, 'relaunch_failed', { error: e.code || e.message }); }
  }

  // 판이 다시 띄울 때의 실행 값. P4 전에 띄운 세션(이어 가기 명령에 --plugin-dir가 없음)은 그대로 둔다
  launchOf(s) {
    const withPlugin = (s.resumeArgv || []).includes('--plugin-dir');
    const plan = applyAgentAutoApprove({ kind: s.kind || 'claude', sessionId: s.rt.claudeSessionId || s.sessionId, settingsPath: s.settingsPath, permissionMode: s.permissionMode, model: s.model, effort: s.effort, extraArgs: s.extraArgs || s.rt.extraArgs || [], startCommand: s.startCommand || s.rt.startCommand || '', ...(withPlugin ? this.plugin : {}) }, this.features?.settings?.get?.() || this.store?.getMeta?.('settings') || {});
    return plan;
  }

  async refreshAgent(s) {
    const rt = s.rt, paneId = s.paneId;
    const a = await this.adapter.getAgent(s.agentName).catch(() => null);
    if (!a || !this.currentSession(s, rt, paneId) || (a.paneId && a.paneId !== paneId)) return null;
    s.rt.herdr.launchPending = a.launchPending;
    s.rt.herdr.agentSessionId = a.agentSessionId;
    if (s.kind === 'codex' && recordCodexSessionId(s, a.agentSessionId)) this.store.saveRuntime(s.sessionId, s.rt);
    return a;
  }
  // herdr blocked인데 묻는 hook이 없다 → 신뢰 대화상자인지 화면으로 한 번 더 본다(E10)
  // hook이 없는 세션은 화면 끝을 묻는 내용으로 둔다(F5: 승인 카드는 "터미널에서 답하기")
  async checkBlocked(s) {
    const rt = s.rt, paneId = s.paneId;
    await this.refreshAgent(s);
    if (!this.currentSession(s, rt, paneId)) return;
    try {
      const text = await this.adapter.readScreen(paneId, { source: 'visible' });
      if (!this.currentSession(s, rt, paneId) || s.rt.herdr.status !== 'blocked') return;
      if (s.kind === 'claude' && isTrustDialog(text)) { s.rt.trustScreen = { at: Date.now() }; this.store.addEvent(s.sessionId, 'trust_dialog', { tail: tailLines(text, 6) }); }
      else if ((s.kind || 'claude') === 'claude') this.noteWorktreeExit(s, text);
      if (!this.hooked(s)) s.rt.screenAsk = { tail: s.kind === 'gemini' ? geminiAuthIssue(text) || tailText(text, 14) : tailText(text, 14), at: Date.now() };
    } catch {}
  }
  // P71: `claude -w` 세션이 끝날 때 묻는 워크트리 나가기 질문을 화면에서 읽어 둔다(승인 줄 "워크트리를 남길까요?")
  noteWorktreeExit(s, text) {
    const w = parseWorktreeExit(text);
    if (!w) return false;
    const was = s.rt.worktreeExit;
    s.rt.worktreeExit = { ...w, at: (was && was.at) || Date.now() };
    if (!was) this.store.addEvent(s.sessionId, 'worktree_exit_dialog', { commits: w.commits, files: w.files, choices: w.choices.map((c) => `${c.n}. ${c.label}`) });
    return true;
  }
  async readScreenAnswer(s, { completed = false } = {}) {
    const rt = s.rt, paneId = s.paneId, turn = rt.turn, invocation = rt.agyInvocationSeq;
    if (!this.currentSession(s, rt, paneId)) return;
    if (s.kind === 'agy' && s.rt.agySessionId) {
      if (!completed && s.rt.agyTurnActive) return;
      const answer = readAgyAnswer(s.rt.agyTranscriptPath);
      if (answer) {
        s.rt.lastAnswer = answer.text; s.rt.lastAnswerAt = answer.step !== s.rt.agyAnswerStep ? Date.now() : s.rt.lastAnswerAt || answer.at || Date.now(); s.rt.answerSource = 'transcript';
        if (answer.step !== s.rt.agyAnswerStep) {
          this.store.addEvent(s.sessionId, 'answer_agy', { text: answer.text, prompt: answer.prompt }); s.rt.agyAnswerStep = answer.step;
        }
        return;
      }
    }
    if (s.kind === 'gemini' && s.rt.geminiTurnActive) return;
    try {
      const text = await this.adapter.readScreen(paneId, { source: 'recent_unwrapped', lines: 60 });
      if (!this.currentSession(s, rt, paneId) || rt.turn !== turn || rt.agyInvocationSeq !== invocation) return;
      s.rt.lastAnswer = screenAnswerText(text, 20); s.rt.lastAnswerAt = Date.now(); s.rt.answerSource = 'screen';
      this.bus.emit('screenAnswer', s);
    } catch {}
  }

  onHerdrDisconnected() {
    this.log('herdr disconnected');
    this.store.addEvent(null, 'herdr_disconnected', { expected: this.herdrStopping });
    this.herdrWasDown = true; // P7(J1): 다시 붙으면 herdr가 잃은 패널을 판이 되살린다
    for (const s of this.sessions.values()) this.markHerdrStopped(s);
    this.api.broadcast('herdr', { connected: false, expected: this.herdrStopping });
  }
  // herdr가 꺼짐: 진행 중이던 턴은 "재시작으로 끊긴 턴"으로 남긴다(C3)
  markHerdrStopped(s, cause = 'herdr:disconnected') {
    const before = s.rt.interruptedTurn;
    applyHerdrDisconnected(s.rt);
    if (s.rt.interruptedTurn && s.rt.interruptedTurn !== before) this.store.addEvent(s.sessionId, 'turn_interrupted', s.rt.interruptedTurn);
    this.broadcastSession(s, { cause });
  }
  async onHerdrConnected() {
    this.log('herdr connected');
    this.setHerdrCompat(this.adapter.checkCompat(this.adapter.pong));
    this.herdrMissing = null;
    const pid = this.adapter.serverPid();
    if (pid) this.store.setMeta('herdrServerPid', pid);
    this.store.addEvent(null, 'herdr_connected', { compat: this.herdrCompat, pid });
    this.api.broadcast('herdr', { ...this.herdrView(), compat: this.herdrCompat });
    // P40: 판 밖에서 다른 herdr로 서버가 다시 떴을 수 있다. 서버의 실행 파일을 다시 읽는다(기다리지 않는다)
    if (this.herdrWasDown) this.resolveHerdr('reconnected').then(() => this.checkHerdrUpdate('reconnected')).then(() => this.api.broadcast('herdr', this.herdrView())).catch(() => {});
    // 백엔드가 꺼진 동안 herdr가 다시 떴다(재부팅 포함): 그 전에 돌던 세션은 herdr가 꺼져서 끝난 것으로 본다
    const afterRestart = !!(this.herdrWasDown || this.herdrRestartedWhileDown);
    this.herdrWasDown = false;
    if (this.herdrRestartedWhileDown) {
      this.herdrRestartedWhileDown = false;
      this.store.addEvent(null, 'herdr_restarted_while_down', { pid });
      for (const s of this.sessions.values()) if (!s.rt.exit) this.markHerdrStopped(s, 'herdr:restarted while backend down');
    }
    await this.resync('herdr connected', { afterRestart });
    if (this.migration && this.migration.herdr.pending && !this.migration.herdr.done) this.finishHerdrMigration().catch((e) => this.log('rename herdr error', e.stack));
  }

  // P18(이름 옮기기 2): 새 herdr에서 되살리기가 끝나면 옛 herdr 세션(멈춘 것)을 지운다. 되살리지 못한 세션이 있으면 지우지 않고 알린다
  async finishHerdrMigration() {
    const m = this.migration.herdr;
    m.done = 'running';
    await this.recoveryDone;
    const open = [...this.sessions.values()];
    const stuck = open.filter((s) => String(s.paneId || '').startsWith(PANE_PREFIX)).map((s) => s.name);
    const resumed = open.filter((s) => s.recovered).map((s) => ({ name: s.name, plan: s.recovered.plan }));
    const closed = this.store.events({ limit: 500 }).filter((e) => e.kind === 'closed' && e.t >= this.migration.at && e.data && /pane gone|not resumed/.test(e.data.reason || '')).map((e) => this.store.getSession(e.sessionId)?.name || e.sessionId);
    let deleted = null;
    if (!stuck.length) {
      const legacy = new HerdrAdapter({ herdrPath: this.cfg.herdrPath, session: m.legacy, logDir: this.cfg.logDir });
      deleted = await legacy.deleteSession().catch((e) => ({ deleted: false, out: e.message }));
      if (!deleted.deleted) this.migration.problems.push(`옛 herdr 세션 ${m.legacy}을 삭제하지 못했습니다: ${deleted.reason || deleted.out || ''}`);
    } else this.migration.problems.push(`복구하지 못한 세션이 있어 이전 herdr 세션 ${m.legacy}을 유지했습니다: ${stuck.join(', ')}`);
    m.done = true;
    m.result = { resumed, stuck, closed, deleted };
    this.store.addEvent(null, 'rename_herdr_migrated', m.result);
    this.log(`rename herdr migrated ${JSON.stringify(m.result)}`);
    this.api.broadcast('backend.migration', this.migrationView());
  }
  migrationView() {
    const m = this.migration;
    return m ? { from: m.from, to: m.to, data: m.data, herdr: m.herdr, problems: m.problems, fixed: m.fixed } : null;
  }

  // C2·C3: herdr의 현재 상태로 판을 다시 맞추고, 놓친 hook은 대화 기록에서 메운다
  async resync(why, { afterRestart = false } = {}) {
    const [snap, agents] = await Promise.all([this.adapter.snapshot(), this.adapter.listAgents()]);
    const panes = new Set(snap.panes.map((p) => p.paneId));
    const report = [];
    const recovering = [];
    const restoring = [], hookless = []; // P7(J1): herdr가 잃은 셸·판에 올린 claude, 돌아오지 않은 hook 없는 에이전트
    for (const s of [...this.sessions.values()]) {
      if (!s.paneId) continue;
      // 판이 되살리는 것은 판이 띄운 Claude Code 세션뿐이다. 판에 올린 에이전트는 herdr의 이어 가기에 맡긴다(P4)
      const stoppedByHerdr = !!(s.rt.exit && s.rt.exit.kind === 'herdr_stopped') && this.hooked(s);
      if (stoppedByHerdr && why === 'herdr connected') recovering.push(s);
      if (!panes.has(s.paneId)) {
        // herdr가 작업 공간을 저장하기 전에 죽으면 패널째로 잃는다(P3에서 확인). 판이 띄운 세션이면 되살린다.
        if (stoppedByHerdr) { report.push({ name: s.name, result: 'pane gone, recreating' }); continue; }
        if (afterRestart && this.recall.restorable(s)) { report.push({ name: s.name, result: 'pane gone, restoring' }); restoring.push(s); continue; }
        report.push({ name: s.name, result: 'pane gone' }); this.closeSession(s, 'pane gone'); continue;
      }
      const a = agents.find((x) => x.paneId === s.paneId);
      const now = Date.now();
      // G2: 셸 노드. 백엔드가 꺼진 동안 그 패널에 에이전트가 떴으면 종류를 바꾼다
      if (s.kind === SHELL) { if (a) this.promoteShell(s, 'resync'); report.push({ name: s.name, shell: true, agent: a ? a.agent : null }); this.broadcastSession(s, { cause: `resync:${why}` }); continue; }
      // 셸에서 띄운 에이전트나 판에 올린 에이전트가 백엔드가 꺼진 동안 끝났으면 셸로 되돌린다
      if (!a && !this.hooked(s) && (s.origin === 'adopted' || s.rt.shellBase) && s.rt.herdr.present && !stoppedByHerdr) { this.demoteToShell(s, 'resync: no agent'); report.push({ name: s.name, demoted: true }); continue; }
      if (a) {
        // herdr가 다시 뜬 직후 agent.list는 이어 가기 전의 상태(idle)를 준다. 새 상태 이벤트가 올 때까지 starting으로 둔다(E7: 약 5초 unknown).
        const resuming = stoppedByHerdr;
        if (resuming) s.resumingAfterHerdr = Date.now();
        applyAgentDetected(s.rt, now);
        s.rt.herdr.present = true;
        applyHerdrStatus(s.rt, resuming ? 'unknown' : a.status, now, { launchPending: a.launchPending, agentSessionId: a.agentSessionId });
        if (a.status === 'blocked' && !s.rt.pendingAsk) await this.checkBlocked(s);
      } else if (s.rt.herdr.present || !s.rt.exit) {
        applyAgentReleased(s.rt, now);
      }
      if (!this.hooked(s) && !a && afterRestart && s.rt.exit && s.rt.exit.kind === 'herdr_stopped') hookless.push(s);
      if (!this.hooked(s)) { report.push({ name: s.name, agent: a ? a.status : 'none', hooked: false }); this.broadcastSession(s, { cause: `resync:${why}` }); continue; }
      const tx = lastExchange(s.rt.transcriptPath || transcriptPathFor(this.cfg.claudeProjects, s.cwd, this.launchOf(s).sessionId));
      let recovered = null;
      if (tx.exists && tx.lastAnswerAt && tx.lastAnswerAt > (s.rt.lastAnswerAt || 0) + 1000 && (!s.rt.lastPromptAt || tx.lastAnswerAt > s.rt.lastPromptAt)) {
        s.rt.lastAnswer = tx.lastAnswer; s.rt.lastAnswerAt = tx.lastAnswerAt;
        if (s.rt.turn.startedAt && !s.rt.turn.endedAt) s.rt.turn.endedAt = tx.lastAnswerAt;
        recovered = { lastAnswer: clip(tx.lastAnswer, 120) };
      }
      if (tx.exists && tx.lastPromptAt && tx.lastPromptAt > (s.rt.lastPromptAt || 0) + 1000) {
        s.rt.lastPrompt = tx.lastPrompt; s.rt.lastPromptAt = tx.lastPromptAt;
        if (!recovered) recovered = {};
        recovered.lastPrompt = clip(tx.lastPrompt, 120);
      }
      const sent = this.queue.list(s.sessionId).find((d) => d.status === 'sent');
      if (sent && tx.exists) this.queue.reconcile(s.sessionId, userPromptsSince(s.rt.transcriptPath || transcriptPathFor(this.cfg.claudeProjects, s.cwd, this.launchOf(s).sessionId), sent.sentAt || sent.createdAt));
      if (recovered) this.store.addEvent(s.sessionId, 'recovered_from_transcript', recovered);
      report.push({ name: s.name, agent: a ? a.status : 'none', recovered });
      this.broadcastSession(s, { cause: `resync:${why}` });
    }
    // F3·G2: 백엔드가 꺼진 동안 생긴 패널(세션이 띄운 에이전트, 셸)도 판에 올린다. 판이 되살리는 중인 세션의 옛 패널은 빼고
    for (const p of snap.panes) {
      if (!p.paneId || this.sessionByPane(p.paneId)) continue;
      const a = agents.find((x) => x.paneId === p.paneId);
      report.push({ adopt: p.paneId, agent: a ? a.agent : SHELL, name: a ? a.name : null });
      this.adoptPane(p.paneId).catch((e) => this.log('adopt error', e.stack));
    }
    this.store.addEvent(null, 'resync', { why, report });
    const jobs = [];
    if (recovering.length) jobs.push(this.recoverAfterHerdr(recovering, panes).catch((e) => this.log('recover error', e.stack)));
    if (restoring.length) jobs.push(this.recall.restoreGone(restoring).catch((e) => this.log('restore error', e.stack)));
    if (hookless.length) jobs.push(this.recall.recoverHookless(hookless).catch((e) => this.log('recover hookless error', e.stack)));
    this.recoveryDone = Promise.all(jobs); // P18: herdr 옮기기가 되살리기를 다 기다린 뒤 옛 세션을 지운다
    return report;
  }

  // C3 대책(P3): herdr가 다시 뜬 뒤 판 세션이 판의 인자(--settings)로 돌아왔는지 확인하고, 아니면 판이 이어 간다.
  // 이어 가기 명령을 잃는 경우: herdr는 session.json을 띄엄띄엄 저장한다. 등록 직후, 저장 전에 서버가 죽으면 작업 공간째로 잃었다(docs/log/p3-v02.md 보고 3.1).
  async recoverAfterHerdr(list, panes) {
    const t0 = Date.now();
    const releasedAt = new Map();
    const pending = new Set(list.map((s) => s.sessionId));
    for (const s of list) s.recoverStartedAt = t0;
    while (pending.size && Date.now() - t0 < this.cfg.recoverGraceMs + 20000) {
      for (const sid of [...pending]) {
        const s = this.sessions.get(sid);
        if (!s || !this.adapter.connected) { pending.delete(sid); continue; }
        if (s.rt.exit && s.rt.exit.kind !== 'herdr_stopped' && !releasedAt.has(sid)) releasedAt.set(sid, Date.now()); // 이어 가기를 시도했다가 끝남(P1 규칙이 다룬다)
        const tx = s.rt.transcriptPath || transcriptPathFor(this.cfg.claudeProjects, s.cwd, this.launchOf(s).sessionId);
        let argv = null;
        if (s.rt.herdr.present) {
          const info = await this.adapter.processInfo(s.paneId).catch(() => null);
          const c = info && (info.foreground_processes || []).find((p) => /claude/i.test(p.name || ''));
          argv = c ? c.argv : null;
        }
        const plan = recoveryPlan({ paneExists: panes.has(s.paneId), agentPresent: s.rt.herdr.present, argv, settingsPath: s.settingsPath, transcriptExists: fs.existsSync(tx), waitedMs: Date.now() - t0, graceMs: this.cfg.recoverGraceMs, releasedSinceRestart: releasedAt.has(sid) });
        if (plan === 'wait') continue;
        pending.delete(sid);
        if (plan === 'ok' || plan === 'leave') { if (plan === 'ok') { this.store.addEvent(sid, 'recover_check', { result: 'resumed with board args' }); await this.ensureAgentName(s); } continue; }
        await this.recoverSession(s, plan).catch((e) => this.store.addEvent(sid, 'recover_failed', { plan, error: e.code || e.message }));
      }
      if (pending.size) await sleep(1000);
    }
    // 다시 붙은 직후의 agent.list를 믿지 않아 starting으로 둔 세션: 새 상태 이벤트가 없으면 지금 상태로 맞춘다(백엔드가 꺼진 동안 이미 이어 간 경우)
    for (const s of list) {
      if (!this.sessions.has(s.sessionId) || !s.resumingAfterHerdr) continue;
      const a = await this.adapter.getAgent(s.agentName).catch(() => null);
      if (a && a.status && a.status !== 'unknown') { s.resumingAfterHerdr = null; applyHerdrStatus(s.rt, a.status, Date.now(), { launchPending: a.launchPending, agentSessionId: a.agentSessionId }); this.broadcastSession(s, { cause: 'resync:agent.get after resume' }); }
    }
  }

  // 판의 전달(agent.prompt). P97: 실행 명령으로 뜬 claude가 이름을 잃어 herdr가 찾지 못하면 이름을 다시 붙이고 한 번 더 보낸다
  // P106: blockReason은 에이전트가 있다고 보는데 herdr가 그 이름을 모르는(agent_not_found) 까닭은 이름을 잃은 에이전트다. 판이 띄운 Codex도
  // 뜬 직후 herdr가 에이전트를 놓았다가 이름 없이 다시 알아본다. 판이 띄운 세션이면 이름을 다시 붙이고, 못 붙이면(다른 패널이 그 이름을 씀, 판에 올린 세션)
  // 그 패널에 같은 종류의 에이전트가 있을 때 패널 ID로 보낸다
  async sendPrompt(sid, text) {
    const s = this.sessions.get(sid);
    if (!s || this.stopping) throw apiError('agent_not_found', '세션이 닫혔습니다');
    const rt = s.rt, paneId = s.paneId;
    const current = () => this.currentSession(s, rt, paneId) && !this.killing.has(sid) && !rt.exit;
    if (!current()) throw apiError('agent_not_found', '세션이 바뀌었거나 종료 중입니다');
    try {
      const expected = rt[`${s.kind}SessionId`];
      if (this.adapter.getAgent) {
        const named = await this.adapter.getAgent(s.agentName).catch(() => null);
        if (!current()) throw apiError('agent_not_found', '세션이 바뀌었습니다');
        if (named && ((named.paneId && named.paneId !== paneId) || (expected && named.agentSessionId !== expected))) throw apiError('agent_not_found', '에이전트 이름과 대화가 일치하지 않습니다');
      }
      return await this.adapter.prompt(s.agentName, text);
    }
    catch (e) {
      if (!current() || e.code !== 'agent_not_found' || !paneId || s.agentName === paneId) throw e;
      if ((s.startCommand || s.origin === 'board') && await this.ensureAgentName(s)) {
        if (!current()) throw e;
        return this.adapter.prompt(s.agentName, text);
      }
      const p = await this.adapter.getPane(paneId).catch(() => null);
      if (!current() || !p || !p.agent || p.agent !== (s.kind || 'claude')) throw e;
      const expected = rt[`${s.kind}SessionId`];
      if (expected) {
        const a = await this.adapter.getAgent(paneId).catch(() => null);
        if (!current() || a?.agentSessionId !== expected) throw e;
      }
      return this.adapter.prompt(paneId, text);
    }
  }
  // P97: herdr가 다시 뜨며 이어 가기 명령(ocx claude --resume …)으로 되살린 패널은 이름이 없다. herdr는 agent.start로 띄운 에이전트만
  // 이름을 되살린다(P97 실험 3). 판의 주소(agentName)로 찾지 못하고 그 패널에 claude가 있으면 이름을 다시 붙인다(herdr 명령과 판의 전달이 이 이름을 쓴다)
  async ensureAgentName(s) {
    if (!s.agentName || s.agentName === s.paneId) return false;
    const rt = s.rt, paneId = s.paneId;
    const current = () => this.currentSession(s, rt, paneId) && !this.killing.has(s.sessionId);
    if (!current()) return false;
    try {
      const a = await this.adapter.getAgent(s.agentName);
      if (!current()) return false;
      if (a && a.paneId === s.paneId) return false;
      if (a) { this.store.addEvent(s.sessionId, 'agent_name_taken', { name: s.agentName, pane: a.paneId }); return false; } // 다른 패널이 그 이름을 쓴다: 손대지 않는다
      const p = await this.adapter.getPane(paneId);
      if (!current() || !p || p.agent !== (s.kind || 'claude')) return false;
      const expected = rt[`${s.kind}SessionId`];
      if (expected) {
        const native = await this.adapter.getAgent(paneId).catch(() => null);
        if (!current() || native?.agentSessionId !== expected) return false;
      }
      await this.adapter.renameAgent(paneId, s.agentName);
      if (!current()) return false;
      this.store.addEvent(s.sessionId, 'agent_renamed', { name: s.agentName, why: 'name lost on herdr restart' });
      return true;
    } catch (e) { this.store.addEvent(s.sessionId, 'agent_rename_failed', { error: e.code || e.message }); }
    return false;
  }

  async recoverSession(s, plan) {
    const resume = plan === 'recreate_resume' || plan === 'start_resume' || plan === 'restart_with_settings';
    const steps = [];
    s.resumingAfterHerdr = null; // 여기서 끝나는 claude는 relaunchIfEmpty가 다루지 않는다
    if (plan === 'recreate_resume' || plan === 'recreate_fresh') {
      const ws = await this.withNewPane(() => this.adapter.createWorkspace({ cwd: s.cwd, label: s.name }), (r) => this.setPane(s, r.paneId, r.workspaceId, 'workspace recreated'));
      steps.push(`workspace ${ws.workspaceId} recreated`);
    }
    if (plan === 'restart_with_settings') {
      // herdr 기본 이어 가기(`claude --resume <ID>`)로 떠서 hook이 없다. 방금 이어 간 claude라 진행 중인 턴은 없다.
      await this.adapter.sendText(s.paneId, '/exit'); await sleep(150); await this.adapter.paneKeys(s.paneId, ['enter']);
      await waitClaudeExit(this, s, this.cfg.killWaitMs, { by: 'restart', steps }); // P71: 워크트리 나가기 질문은 남기기
      steps.push('/exit (no board settings)');
    }
    await this.adapter.waitShellReady(s.paneId, 8000);
    const launch = this.launchOf(s);
    const args = resume ? buildResumeArgs(launch) : buildStartArgs(launch);
    await this.adapter.startAgent({ name: s.agentName, paneId: s.paneId, args, ...startOpt(s) });
    s.rt.exit = null; s.rt.phase = 'starting'; s.rt.launchedAt = Date.now(); s.rt.hooksSinceLaunch = 0; s.rt.sessionEnd = null;
    s.rt.herdr.launchPending = true; s.resumingAfterHerdr = null;
    s.resumeVerified = false; this.store.updateSession(s.sessionId, { resumeVerified: false });
    s.recovered = { plan, at: Date.now() };
    steps.push(`${resume ? 'resumed' : 'started fresh'} by board`);
    this.store.addEvent(s.sessionId, 'recovered_by_board', { plan, steps, args });
    this.log(`recovered ${s.name}: ${plan}`);
    this.broadcastSession(s, { cause: `recover:${plan}` });
    this.registerResume(s);
  }

  // 패널 ID가 바뀌었다(이어 가기로 작업 공간을 다시 만듦, herdr pane move). 판에서 정한 역할이 있으면 시킨 쪽에 알린다(F2)
  async setPane(s, paneId, herdrWorkspaceId, why) {
    const old = s.paneId;
    if (old === paneId) return;
    s.paneId = paneId; if (herdrWorkspaceId) s.herdrWorkspaceId = herdrWorkspaceId;
    if (s.agentName === old) s.agentName = paneId; // 이름 없는 에이전트는 패널 ID로 부른다
    this.store.updateSession(s.sessionId, { paneId, herdrWorkspaceId: s.herdrWorkspaceId, agentName: s.agentName });
    this.store.addEvent(s.sessionId, 'pane_changed', { from: old, to: paneId, why });
    await this.adapter.refreshSubscription();
    if (!this.currentSession(s) || s.paneId !== paneId) return;
    for (const l of this.store.links()) {
      if (l.to !== s.sessionId || !l.role || !this.sessions.has(l.from)) continue;
      const text = paneChangedNotice({ role: l.role, agentName: s.agentName, paneId });
      const d = this.queue.enqueue(l.from, text);
      this.linkEvent(l, 'notice', text, { deliveryId: d.deliveryId, why }, { quiet: true });
    }
    this.broadcastSession(s, { cause: `pane:${why}` });
  }

  closeSession(s, reason) {
    if (this.sessions.get(s.sessionId) !== s) return;
    this.queue.cancelSession(s.sessionId, 'session closed');
    try { this.relay.detach(s.sessionId); } catch {}
    if (s.settingsPath) try { fs.rmSync(s.settingsPath, { force: true }); } catch {} // 판이 세션을 닫을 때 설정 파일을 지운다(B3)
    // 이 세션이 낀 연결은 판에서 뺀다(기록은 남는다)
    for (const l of this.store.links()) if (l.from === s.sessionId || l.to === s.sessionId) { this.store.updateLink(l.linkId, { removedAt: Date.now() }); this.api.broadcast('link.removed', { linkId: l.linkId, reason: 'session closed' }); }
    const closedAt = Date.now();
    this.store.updateSession(s.sessionId, { closedAt, runtime: s.rt, closeReason: reason }); // P7: 닫힌 세션은 사이드바에 남아 다시 연다(J2)
    this.store.addEvent(s.sessionId, 'closed', { reason });
    this.sessions.delete(s.sessionId);
    this.api.broadcast('session.removed', { sessionId: s.sessionId, name: s.name, reason });
    this.bus.emit('closed', s, reason); // P81: 까닭(부모에게 보낼 닫힘 알림)
    onSessionClosed(this, s); // P6a: 덩어리에서 뺀다
    Promise.resolve(this.adapter.refreshSubscription()).catch((e) => { if (!this.stopping) this.log('subscription refresh after close:', e.message); });
  }

  // ---------- 명령 ----------
  // P40: herdr가 없으면 herdr_missing, 프로토콜이 다르면 herdr_incompatible(까닭과 할 일을 함께). 보드의 다른 기능은 막지 않는다
  requireHerdr() {
    if (this.herdrMissing || (this.herdrCompat && this.herdrCompat.level === 'missing')) {
      const tried = ((this.herdrFind && this.herdrFind.tried) || []).length;
      throw keyed(apiError('herdr_missing', `herdr를 찾지 못해 세션을 시작할 수 없습니다 (후보 ${tried}곳 확인). herdr를 설치하거나(https://herdr.dev) 설정의 herdr 경로 또는 ATRIUM_HERDR로 실행 파일을 지정하세요.`), 'herdrMissing', { n: tried });
    }
    if (!this.herdrOk) {
      const c = this.herdrCompat || {};
      throw keyed(apiError('herdr_incompatible', `herdr 호환 안 됨: ${(c.problems || []).join('; ') || 'unknown'}. 지원하는 프로토콜(${(this.cfg.herdrProtocols || [22]).join(', ')})의 herdr를 설치하거나 설정의 herdr 경로로 맞는 herdr를 준다`), 'herdrIncompatible', { version: c.version || '?', protocol: c.protocol ?? '?', supported: (this.cfg.herdrProtocols || [22]).join(', ') });
    }
    if (!this.adapter.connected) throw keyed(apiError('herdr_down', "herdr 서버에 연결되어 있지 않습니다."), 'herdrDown');
  }
  // B3: 새 세션 시작. P5: 시작 폴더의 리포지토리 워크스페이스에 생긴다(G1). 종류 shell은 에이전트 없는 일반 셸(G2)
  async spawn(p) {
    this.requireHerdr();
    const cwd = path.resolve(String(p.cwd || ''));
    if (!p.cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw keyed(apiError('bad_request', `폴더를 찾을 수 없습니다: ${p.cwd}`), 'noFolder', { path: p.cwd });
    const pending = this.spawningNames || (this.spawningNames = new Set()); // 만드는 중인 세션 이름
    const taken = takenNames(this.sessions.values(), pending); // P66: 판의 이름(label)도 피한다. 대소문자 무시
    // P33: 띄울 값은 호출자(launchers.mjs)가 정한다. 함께 준 값(모델 등)이 호출자 값을 덮는다. 호출자 없이 부르면 준 값만 쓴다(atrium child, CLI --kind)
    const plan = spawnPlanOf(this, p);
    const { flavor, command, kind } = plan;
    const shell = kind === SHELL;
    let name = p.name;
    const prefix = flavor === DEEPSEEK ? 'ds' : shell ? 'sh' : 's';
    if (!name) { let i = 1; while (taken.has(`${prefix}${i}`)) i++; name = `${prefix}${i}`; }
    if (!NAME_RE.test(name) || name === 'all') throw apiError('bad_request', `이름은 영문, 숫자, -, _ 만(all 제외): ${name}`);
    if (taken.has(String(name).toLowerCase())) throw keyed(apiError('name_taken', `이미 있는 이름: ${name}`), 'nameTaken', { name });
    this.spawningNames.add(name);
    try { return await this.spawnReserved(p, { name, cwd, flavor, command, kind, shell, plan }); }
    finally { this.spawningNames.delete(name); }
  }

  async spawnReserved(p, { name, cwd, flavor, command, kind, shell, plan = spawnPlanOf(this, { ...p, kind, flavor }) }) {
    const claude = kind === 'claude';
    const permissionMode = plan.permissionMode || p.permissionMode || 'manual';
    if (!PERMISSION_MODES.has(permissionMode)) throw apiError('bad_request', `권한 모드: ${permissionMode}`);
    const model = plan.model || null, effort = claude ? plan.effort || null : null;
    const allowHerdr = claude && !!plan.allowHerdr, extraArgs = claude ? plan.extraArgs || [] : [];
    const parentS = p.parentSessionId ? this.sessions.get(p.parentSessionId) : null;
    const startCommand = !claude ? '' : plan.startCommand != null ? plan.startCommand : p.branch && parentS?.kind === 'claude' ? parentS.startCommand || parentS.rt?.startCommand || '' : '';
    // F5: herdr가 아는 에이전트 종류. Claude Code만 판의 hook과 이어 가기 등록을 붙인다
    if (!KIND_RE.test(kind)) throw apiError('bad_request', `에이전트 종류: ${kind}`);
    if (!shell) {
      const kinds = await this.adapter.agentKinds().catch(() => []);
      if (kinds.length && !kinds.some((k) => k.kind === kind)) throw apiError('bad_request', `herdr가 모르는 종류: ${kind}`);
    }
    if (command && p.prompt) throw keyed(apiError('not_agent', 'DeepSeek 직접 명령으로 띄우면 첫 지시를 보내지 않는다(판이 에이전트가 준비된 때를 모른다). 뜬 뒤 보낸다'), 'deepseekCommandNoPrompt');
    if (shell && p.prompt) throw keyed(apiError('not_agent', '셸에는 첫 지시를 보내지 않는다(명령 바는 에이전트에게만). 터미널에 직접 친다'), 'shellNoPrompt');
    // P25: 기본 실행은 프록시가 돌아야 답한다. 판이 켜지 않고 알린다
    if (claude && plan.gateway && !command) {
      if (flavor === DEEPSEEK && plan.gateway.health) await checkProxy({ url: plan.gateway.url });
      else await checkGateway({ ...plan.gateway, name: plan.launcher || '' });
    }
    // G1: 시작 폴더의 워크스페이스
    const ws = await workspaceOf(cwd);

    const sessionId = crypto.randomUUID();
    let hookToken = '', settingsPath = '', paneEnv, codexIntegration, trust = { needsTrust: null, reason: `${kind}: 예상하지 않음` }, args = [], resumeArgv = null;
    if (claude) {
      hookToken = crypto.randomBytes(24).toString('hex');
      const extra = this.branch.settingsExtra(sessionId);
      if (plan.env) extra.env = { ...plan.env, ...(extra.env || {}) }; // managed session values win
      settingsPath = writeSessionSettings({ file: path.join(this.cfg.sessionsDir, `${sessionId}.json`), hookUrl: this.hookUrl, token: hookToken, sessionId, timeoutSec: this.cfg.hookTimeoutSec, allowHerdr, ...extra });
      trust = predictTrust(cwd, this.cfg.claudeJson);
      const launch = { sessionId, settingsPath, permissionMode, model, effort, extraArgs, startCommand, worktree: p.worktree || null, ...this.plugin };
      args = buildStartArgs(launch);
      resumeArgv = buildResumeArgv({ claudeCommand: this.cfg.claudeCommand, ...launch });
    } else if (!shell) {
      args = plan.args || [];
    }
    if (!claude && plan.env && Object.keys(plan.env).length) paneEnv = { ...plan.env };

    if (kind === 'codex') {
      codexIntegration = this.codexSettings(sessionId, { args, model, env: plan.env || {} });
      args = codexIntegration.args; hookToken = codexIntegration.hookToken; settingsPath = codexIntegration.settingsPath; paneEnv = codexIntegration.env;
    }
    if (kind === 'gemini') {
      hookToken = crypto.randomBytes(24).toString('hex');
      const integration = this.geminiSettings(sessionId, hookToken);
      settingsPath = integration.settingsPath; paneEnv = { ...(plan.env || {}), ...integration.env };
      validateGeminiNewSessionArgs(args);
      args.push('--session-id', sessionId);
    }
    if (kind === 'agy') {
      hookToken = crypto.randomBytes(24).toString('hex');
      const integration = this.agySettings(sessionId, hookToken);
      settingsPath = integration.settingsPath; paneEnv = { ...(plan.env || {}), ...integration.env };
    }
    this.ensureWorkspace(ws, `spawn ${name}`);
    const rt = newRuntime({ trustPredicted: !!trust.needsTrust, kind, hooked: claude });
    if (shell) rt.phase = 'running';
    if (plan.env && Object.keys(plan.env).length) rt.launcherEnv = { ...plan.env };
    if (command) rt.launcherCommand = command;
    if (startCommand) rt.startCommand = startCommand;
    if (extraArgs.length) rt.extraArgs = [...extraArgs];
    if (codexIntegration) Object.assign(rt, codexIntegration.runtime, { codexContext: codexIntegration.context });
    if (kind === 'gemini') { rt.geminiIntegration = true; rt.geminiReady = false; }
    if (kind === 'agy') rt.agyComposer = 'starting';
    let s;
    const hw = await this.withNewPane(() => this.adapter.createWorkspace({ cwd, label: name, env: paneEnv }), (r) => {
      s = { sessionId, name, cwd, paneId: r.paneId, herdrWorkspaceId: r.workspaceId, agentName: shell ? r.paneId : name, model, effort, permissionMode, settingsPath, hookToken, resumeArgv, resumeVerified: false, createdAt: Date.now(), closedAt: null, seenAt: null, touchedAt: Date.now(), rt, lastState: null, kind, origin: 'board', parentSessionId: p.parentSessionId || null, workspaceKey: ws.key, flavor, extraArgs, startCommand };
      this.store.insertSession({ ...s, runtime: rt });
      this.sessions.set(sessionId, s);
      if (p.branch) this.branch.noteChild(sessionId, p.branch); // P8: atrium child로 만든 하위 세션
    });
    // 빈자리는 그 워크스페이스 영역 안이나 바로 옆(P6a H1). 사람이 보는 화면은 옮기지 않는다. P8(K4): 하위 세션은 부모 오른쪽 열에 형제끼리 쌓는다
    const place = p.branch && !p.branch.head ? this.branch.placeChild(p.parentSessionId, ws.key) : null;
    const area = this.worktrees ? this.worktrees.areaOf(ws.key, cwd) : ''; // P27: 워크트리 폴더에서 띄우면 그 워크트리 영역
    const slot = place || slotFor(this, { wsKey: ws.key, size: NODE, area });
    this.store.setNode({ session_id: sessionId, x: slot.x, y: slot.y, w: place ? place.w : NODE.w, h: place ? place.h : NODE.h, z: 0, size: place ? place.size : NODE.size, aspect: DEFAULT_ASPECT, area: place ? place.area ?? area : area });
    if (p.branch && !p.branch.head && place) reflowLines(this, { workspaceKey: ws.key, cause: 'spawn child' });
    settleRegions(this, 'spawn');
    this.store.addEvent(sessionId, 'spawn', { name, kind, cwd: slash(cwd), workspace: ws.key, trust, args, allowHerdr, ...(plan.launcher ? { launcher: plan.launcher } : {}), ...(extraArgs.length ? { extraArgs } : {}), ...(plan.env ? { envKeys: Object.keys(plan.env) } : {}), ...(flavor ? { flavor, command: command ? '[command]' : null } : {}), ...(p.branch ? { parent: p.parentSessionId, worktree: p.worktree || null, place: place ? 'tree' : 'slot' } : {}) });
    // Persist the first task before subscription/shell/agent startup can await.
    // A restart can recover this queued task; starting state prevents delivery.
    if (p.prompt) this.queue.enqueue(sessionId, p.prompt);
    await this.adapter.refreshSubscription();
    this.api.broadcast('session.created', { sessionId, name, workspaceKey: ws.key });
    this.broadcastSession(s, { cause: 'spawn' });
    this.probeGit(s, cwd);
    const out = { sessionId, name, kind, flavor, paneId: hw.paneId, herdrWorkspaceId: hw.workspaceId, workspaceKey: ws.key, workspaceRoot: ws.root, settingsPath, trust, resumeArgv };
    if (command) {
      // P25 직접 명령: 셸 프롬프트가 뜨면 그 글을 그대로 치고 Enter. 에이전트가 나타나면 promoteShell이 같은 노드의 종류를 바꾼다(hook 없음)
      const ready = await this.adapter.waitShellReady(hw.paneId);
      await this.adapter.sendText(hw.paneId, command); await sleep(150); await this.adapter.paneKeys(hw.paneId, ['enter']);
      this.store.addEvent(sessionId, 'command_typed', { command: '[command]', shellReady: ready });
      this.log(`spawned ${name} (${flavor} command) ${sessionId} pane=${hw.paneId} ws=${ws.key} shellReady=${ready}`);
      return { ...out, argv: null, command: '[command]' };
    }
    if (shell) { this.log(`spawned shell ${name} ${sessionId} pane=${hw.paneId} ws=${ws.key}`); return { ...out, argv: null }; }

    const shellReady = await this.adapter.waitShellReady(hw.paneId);
    let st = { agent: null, argv: [kind, ...args] };
    try { st = await this.adapter.startAgent({ name, paneId: hw.paneId, args, kind, ...(startCommand ? { command: startWords(startCommand) } : {}) }); }
    catch (e) {
      if (e.code === 'agent_not_detected') {
        this.queue.cancelSession(sessionId, 'start command failed');
        this.store.addEvent(sessionId, 'start_command_failed', { startCommand: '[command]' });
        throw keyed(apiError('start_command_failed', '실행 명령으로 에이전트를 시작하지 못했습니다. 터미널에서 오류를 확인하세요.'), 'launcherStart.failed', { cmd: startCommand, kind });
      }
      if (e.code !== 'agent_not_ready') throw e;
      this.store.addEvent(sessionId, 'agent_not_ready', { kind });
    }
    rt.herdr.launchPending = st.agent ? st.agent.launchPending : true;
    // B3 4번: 이어 가기 명령 등록. agent.start 직후에는 herdr가 resume_not_accepted("reporter to hold the pane")로 거부하고,
    // herdr가 패널에서 claude를 찾은 뒤(약 1.5초)에는 받는다. 받은 등록은 agent_session을 남기므로 신뢰 대화상자가 끝나 ready가 된 뒤에 한다.
    if (claude) this.registerResume(s);
    this.log(`spawned ${name} ${kind} ${sessionId} pane=${hw.paneId} ws=${ws.key} shellReady=${shellReady} trust=${JSON.stringify(trust)}`);
    return { ...out, argv: st.argv };
  }
  codexSettings(sessionId, options = {}) {
    const settings = this.features?.settings?.get?.() || this.store?.getMeta?.('settings') || {};
    return prepareCodexSession(this, { sessionId, ...options, args: providerPermissionArgs('codex', options.args || [], options.permissionMode || 'manual', { autoApprove: settings.agentAutoApprove === true }) });
  }
  agySettings(sessionId, token) {
    return writeAgySession({ dir: this.cfg.sessionsDir, sessionId, token, hookUrl: this.hookUrl.replace('/hooks/claude', '/hooks/agy'), branchEnv: this.branch.envFor(sessionId), pluginDir: this.plugin?.pluginDir, herdrPath: this.cfg.herdrPath });
  }
  geminiSettings(sessionId, token) {
    return writeGeminiSession({ dir: this.cfg.sessionsDir, sessionId, token, hookUrl: this.hookUrl.replace('/hooks/claude', '/hooks/gemini'), branchEnv: this.branch.envFor(sessionId), pluginDir: this.plugin?.pluginDir, herdrPath: this.cfg.herdrPath });
  }
  // 판이 패널을 만드는 동안(작업 공간 만들기 → 세션 등록) 그 패널의 pane_created를 판에 올리지 않게 막는다(G2)
  async withNewPane(create, register) {
    this.creatingPanes = (this.creatingPanes || 0) + 1;
    try { const r = await create(); await register(r); return r; } finally { this.creatingPanes--; }
  }

  refreshClaudeResume(s, { register = true } = {}) {
    if (!s.resumeArgv || !s.rt.claudeSessionId) return;
    const i = s.resumeArgv.indexOf('--resume');
    if (i >= 0 && s.resumeArgv[i + 1] === s.rt.claudeSessionId) return;
    s.resumeArgv = buildResumeArgv({ claudeCommand: this.cfg.claudeCommand, ...this.launchOf(s) });
    s.resumeVerified = false;
    this.store.updateSession(s.sessionId, { resumeArgv: s.resumeArgv, resumeVerified: false });
    if (register) this.registerResume(s).catch((e) => { if (!this.stopping) this.log('resume refresh failed', e.message); });
  }

  async registerResume(s) {
    const rt = s.rt, paneId = s.paneId, nativeId = this.launchOf(s).sessionId, argv = s.resumeArgv;
    const current = () => this.currentSession(s, rt, paneId) && s.resumeArgv === argv && this.launchOf(s).sessionId === nativeId;
    const t0 = Date.now(); let tries = 0; let lastErr = null;
    while (Date.now() - t0 < 180000 && current() && !s.rt.exit) {
      // starting·trust_wait 중에는 보내지 않는다. 거부된 요청도 agent_session을 남겨 E10의 신뢰 대화상자 신호(agent_session 없음)를 지운다.
      if (['ready', 'working', 'waiting', 'error'].includes(deriveState(s.rt).state)) {
        tries++;
        try {
          await this.adapter.registerResume({ paneId, sessionId: nativeId, argv });
          if (!current()) return false;
          this.store.addEvent(s.sessionId, 'resume_registered', { argv: s.resumeArgv, tries, ms: Date.now() - t0 });
          return this.verifyResume(s);
        } catch (e) { lastErr = e.code; if (e.code !== 'resume_not_accepted' && e.code !== 'unreachable') break; }
      }
      await sleep(1000);
    }
    if (!current()) return false;
    this.store.addEvent(s.sessionId, 'resume_register_failed', { tries, lastErr });
    return false;
  }

  // herdr가 session.json에 agent_resume을 저장했는지 읽어 본다. 사용자 설정의 herdr hook이 늦게 보고해 덮이면 다시 등록한다.
  async verifyResume(s) {
    const rt = s.rt, paneId = s.paneId, nativeId = this.launchOf(s).sessionId, argv = s.resumeArgv;
    const current = () => this.currentSession(s, rt, paneId) && s.resumeArgv === argv && this.launchOf(s).sessionId === nativeId;
    const t0 = Date.now(); let reRegistered = 0;
    while (Date.now() - t0 < 120000 && current()) {
      await sleep(2000);
      if (!current()) return false;
      const rec = this.adapter.readResumeRecord(nativeId);
      if (rec && rec.found) {
        const ok = Array.isArray(rec.argv) && rec.argv.includes('--settings') && rec.argv.includes(argv[argv.indexOf('--settings') + 1]) && rec.argv[rec.argv.indexOf('--resume') + 1] === nativeId;
        if (ok) { s.resumeVerified = true; this.store.updateSession(s.sessionId, { resumeVerified: true }); this.store.addEvent(s.sessionId, 'resume_verified', { argv: rec.argv, ms: Date.now() - t0 }); this.broadcastSession(s); return true; }
        if (reRegistered < 2 && s.rt.herdr.agentSessionId) { reRegistered++; await this.adapter.registerResume({ paneId, sessionId: nativeId, argv }).catch(() => {}); if (!current()) return false; this.store.addEvent(s.sessionId, 'resume_reregistered', { saw: rec.argv }); }
      }
    }
    if (!current()) return false;
    this.store.addEvent(s.sessionId, 'resume_unverified', {});
    return false;
  }

  // B1·B2: 이름 하나 이상(@a @b) 또는 @all. P5: 셸에는 보내지 않는다(not_agent).
  // P6a(H8): @all은 캔버스 전체의 에이전트 세션. workspace를 주면 그 워크스페이스의 에이전트 세션만
  // P90: whileWorking: 'type'(휴대폰 입력 줄)이면 Claude Code가 일하는 중일 때 기다리지 않고 바로 넣는다(delivery.mjs canTypeNow)
  async send(p) {
    let targets = Array.isArray(p.target) ? p.target : null;
    let text = p.text;
    if (!targets) {
      if (p.target) targets = String(p.target).split(/[\s,]+/).filter(Boolean);
      else { const parsed = parseTargets(p.text || ''); targets = parsed.targets; text = parsed.text; }
    }
    if (!targets.length) throw apiError('bad_request', "메시지를 받을 세션을 @이름으로 지정하세요.");
    if (!text || !String(text).trim()) throw apiError('bad_request', "보낼 내용을 입력하세요.");
    // 대상 풀기: @all, @세션 이름(B2)
    const picked = new Map(); // sessionId → 세션
    const agent = (s) => s.kind !== SHELL;
    for (const raw of targets) {
      const t = raw.replace(/^@/, '');
      if (t === 'all') {
        const ws = p.workspace ? await this.resolveWorkspace(p.workspace) : null;
        const list = [...this.sessions.values()].filter((s) => (!ws || s.workspaceKey === ws.key) && agent(s));
        if (!list.length) throw apiError('not_found', ws ? `프로젝트 ${ws.root}에 에이전트 세션이 없습니다.` : "보드에 에이전트 세션이 없습니다.");
        for (const s of list) if (!picked.has(s.sessionId)) picked.set(s.sessionId, s);
        continue;
      }
      const one = findSession(this.sessions.values(), t); // P66: 새 이름과 옛 주소를 둘 다 받는다
      if (one && !agent(one)) throw keyed(apiError('not_agent', `@${shownName(one)} 세션은 일반 셸입니다. 명령 입력줄은 에이전트에게만 메시지를 보냅니다. 셸 명령은 터미널에 직접 입력하세요.`), 'shellNoBar', { name: shownName(one) });
      if (!one) throw keyed(apiError('not_found', `보드에서 세션을 찾을 수 없습니다: ${raw}`), 'targetNotFound', { ref: raw });
      picked.set(one.sessionId, one);
    }
    const deliveries = [...picked.values()].map((s) => {
      const d = this.queue.enqueue(s.sessionId, toLF(text), { typeNow: p.whileWorking === 'type' });
      this.touch(s);
      return { deliveryId: d.deliveryId, sessionId: s.sessionId, name: shownName(s), status: d.status };
    });
    // I2(P6b): 명령 바에서 보낸 글은 Thread에 남긴다. source: bar(기본), output(출력 보기에서 답장)
    const item = this.features ? this.features.thread.add({ source: p.source || 'bar', text: toLF(text), targets: targets.map((t) => '@' + String(t).replace(/^@/, '')), deliveries }) : null;
    return { deliveries, threadItemId: item ? item.itemId : null };
  }

  // D2: 판이 띄운 세션만 끈다. /exit로 정상 종료하고 작업 공간을 닫는다.
  async kill(p) {
    const s = this.resolve(p.session);
    if (!p.confirm) return this.killSession(s, p);
    this.killRequests ||= new Map();
    const pending = this.killRequests.get(s.sessionId);
    if (pending) {
      if (pending.after !== p.after) throw apiError('busy', '다른 종료 작업이 진행 중입니다');
      return pending.promise;
    }
    const promise = this.killSession(s, p).finally(() => this.killRequests.delete(s.sessionId));
    this.killRequests.set(s.sessionId, { after: p.after, promise });
    return promise;
  }
  async killSession(s, p) {
    const rt = s.rt, paneId = s.paneId;
    const shared = await this.adapter.workspacePanes(s.herdrWorkspaceId).then((ps) => ps.filter((x) => x.paneId !== s.paneId)).catch(() => []);
    if (!this.currentSession(s, rt, paneId)) throw apiError('session_changed', '세션이 바뀌었습니다. 다시 확인하세요');
    const kindName = s.kind || 'claude';
    const closeText = shared.length ? `패널 ${s.paneId}만 닫습니다 (같은 herdr 작업 공간의 다른 터미널 창 ${shared.length}개는 유지합니다).` : "터미널 창을 닫습니다.";
    // G2: 셸은 패널만 닫는다. 돌고 있는 명령도 함께 끝난다
    const closeMsg = shared.length ? m('killClosePane', { pane: s.paneId, n: shared.length }) : m('killCloseAll');
    if (!p.confirm && kindName === SHELL) { const sh = s.rt.shell; const cmd = sh && !sh.atPrompt ? clip(sh.command || (sh.procs || []).join(', ') || '?', 60) : null; return confirmResult(`셸 ${s.name}: ${closeText}${cmd ? ` 실행 중인 명령(${cmd})도 종료합니다.` : ''}`, m('killShell', { name: s.name, close: closeMsg, running: cmd ? m('killShellRunning', { cmd }) : '' })); }
    // P71: `claude -w` 세션이면 확인에 워크트리를 알린다. 창의 닫기 확인이 "워크트리 남기기(기본)"와 "워크트리와 브랜치 지우기"를 보인다
    const wt = worktreeOf(s, this.branch && this.branch.info.get(s.sessionId));
    if (!p.confirm) return confirmResult(`${s.name} 세션에서 실행 중인 ${kindName} 에이전트를 종료합니다. ${closeText} 보관하면 보관함에서 다시 열 수 있습니다.${kindName === 'claude' ? " 삭제하면 대화 기록을 휴지통으로 보내고 보드에서 제거합니다." : " 삭제하면 보드에서 제거합니다."}${wt ? ` 워크트리(${wt.name})는 남깁니다. 지우려면 worktree: remove를 지정하세요.` : ''}`, m('kill', { name: s.name, kind: kindName, close: closeMsg, del: m(kindName === 'claude' ? 'killDeleteClaude' : 'killDeleteOther') }), wt ? { worktree: wt } : {});
    if (p.after && !['archive', 'delete'].includes(p.after)) throw apiError('bad_request', `after에는 archive 또는 delete를 지정하세요: ${p.after}`);
    if (p.worktree != null && !['keep', 'remove'].includes(p.worktree)) throw apiError('bad_request', `worktree에는 keep 또는 remove를 지정하세요: ${p.worktree}`);
    const wtChoice = p.worktree === 'remove' ? 'remove' : 'keep'; // 사람이 지우기를 고르지 않았으면 남긴다
    // P21(D4): 잠든 세션은 패널이 없다. herdr 없이 판에서 닫고 보관·삭제한다
    if (s.rt.sleep && !s.paneId && !(this.sleeper && (this.sleeper.wakes.has(s.sessionId) || this.sleeper.going.has(s.sessionId)))) {
      s.rt.sleep = null; s.rt.exit = { kind: 'normal', reason: 'closed while sleeping', at: Date.now() };
      this.closeSession(s, 'killed');
      let after = null;
      if (p.after === 'archive') { this.recall.markArchive({ session: s.sessionId }, true, 'close'); after = { archived: true }; }
      else if (p.after === 'delete') after = await this.recall.forgetClosed(s.sessionId);
      return { closed: true, name: s.name, exit: null, steps: ['sleeping: no pane'], ...(after ? { after } : {}) };
    }
    this.requireHerdr();
    this.killing.add(s.sessionId);
    const steps = [];
    try {
      const st = () => deriveState(s.rt).state;
      if (s.rt.herdr.present && kindName !== SHELL) {
        const exiting = !!s.rt.worktreeExit; // P71: 워크트리 나가기 질문이 이미 떠 있다. esc로 취소하지 않고 그 질문에 답한다
        if (!exiting && (st() === 'waiting' || st() === 'trust_wait' || st() === 'working')) {
          await this.adapter.sendKeys(s.agentName, ['esc']).catch((e) => steps.push(`esc failed ${e.code}`));
          steps.push(`esc (${st()})`);
          for (let i = 0; i < 25 && s.rt.herdr.present && ['waiting', 'trust_wait', 'working'].includes(st()); i++) await sleep(200);
        }
        if (s.rt.herdr.present) {
          s.rt.exitRequested = true;
          // Claude Code는 /exit. 다른 종류는 하네스마다 끝내는 말이 달라 ctrl+c를 두 번 보낸다(codex는 두 번째에 끝난다)
          if (exiting) steps.push('worktree exit dialog open');
          else if (EXIT_TEXT[kindName]) {
            await this.adapter.sendText(s.paneId, EXIT_TEXT[kindName]);
            await sleep(150);
            await this.adapter.paneKeys(s.paneId, ['enter']);
            steps.push(EXIT_TEXT[kindName]);
          } else {
            for (let i = 0; i < 2 && s.rt.herdr.present; i++) { await this.adapter.paneKeys(s.paneId, ['ctrl+c']).catch(() => {}); steps.push('ctrl+c'); await sleep(600); }
          }
          const waited = await waitClaudeExit(this, s, this.cfg.killWaitMs, { worktree: wtChoice, by: 'close', steps }); // claude가 아닌 종류는 기다리기만 한다
          steps.push(s.rt.herdr.present ? `${kindName} still running` : `${kindName} exited in ${waited}ms`);
        }
      }
      const exit = s.rt.exit;
      // Close only this pane. A sibling can appear after enumeration, or the
      // enumeration itself can fail; neither permits closing its workspace.
      if (!this.currentSession(s, rt, paneId)) throw apiError('session_changed', '세션이 바뀌어 종료를 중단했습니다');
      await this.adapter.closePane(paneId);
      steps.push(`pane ${paneId} closed`);
      this.closeSession(s, 'killed');
      // P15: 닫는 것은 보관이나 삭제다(노드의 X). 아무것도 하지 않으면 닫힌 세션으로 남고 판 밖 대화처럼 다시 보인다
      let after = null;
      if (p.after === 'archive') { this.recall.markArchive({ session: s.sessionId }, true, 'close'); after = { archived: true }; }
      else if (p.after === 'delete') after = await this.recall.forgetClosed(s.sessionId);
      return { closed: true, name: s.name, exit, steps, ...(after ? { after } : {}) };
    } finally { this.killing.delete(s.sessionId); }
  }

  // A1 답하기(P2): 승인 카드의 답을 agent.send_keys(글은 pane.send_text)로 넣는다.
  // 보내기 직전 확인: herdr가 blocked인지, 카드의 요청(tool_use_id)이 아직 기다리는 요청인지(PostToolUse가 오면 pendingAsk가 풀린다).
  // 아니면 보내지 않는다. stale·no_pending_ask면 창은 카드를 닫고, not_blocked면 카드를 둔다.
  async answer(p) {
    const s = this.resolve(p.session);
    this.requireHerdr();
    if (s.rt.worktreeExit && !s.rt.pendingAsk) return this.answerWorktreeExit(s, p); // P71: 화면에서 읽은 질문이라 hook이 없어도 답한다
    // 승인 카드의 키 순서는 판이 띄운 Claude Code만 안다(E9). 다른 종류와 판에 올린 에이전트는 터미널에서 답한다(F5)
    if (!this.hooked(s)) throw apiError('answer_in_terminal', `${s.name}(${s.kind})의 응답 키 입력 순서를 보드에서 확인할 수 없습니다. 터미널에서 직접 응답하세요.`);
    const card = { toolUseId: p.toolUseId || null, since: p.since || null };
    const ask = s.rt.pendingAsk;
    if (!ask) return { sent: false, reason: 'no_pending_ask' };
    if (!sameAsk(ask, card)) return { sent: false, reason: 'stale' };
    const plan = planAnswer(ask, p);
    checkSteps(plan.steps);
    if (s.answering) throw keyed(apiError('busy', "이 세션에 이미 응답을 전송하고 있습니다."), 'answerBusy');
    s.answering = true;
    try {
      const a = await this.adapter.getAgent(s.agentName);
      if (!a || a.status !== 'blocked') return { sent: false, reason: 'not_blocked', herdrStatus: a ? a.status : null };
      if (s.rt.pendingAsk !== ask) return { sent: false, reason: 'stale' };
      for (let i = 0; i < plan.steps.length; i++) {
        const st = plan.steps[i];
        if (i) await sleep(this.cfg.answerStepMs);
        if (st.keys) await this.adapter.sendKeys(s.agentName, st.keys);
        else await this.adapter.sendText(s.paneId, st.text);
      }
      // 판에서 답한 기록은 판이 보낸 키로 남긴다(A1 거부 기록)
      this.touch(s);
      const rec = { by: 'board', kind: ask.kind, tool: ask.tool, toolUseId: ask.toolUseId, choice: p.choice ?? null, picks: p.picks ?? null, label: plan.label, steps: plan.steps.map((x) => (x.keys ? x.keys.join('+') : `text(${x.text.length})`)) };
      this.store.addEvent(s.sessionId, 'answer', rec);
      this.api.broadcast('session.answer', { sessionId: s.sessionId, name: s.name, ...rec });
      return { sent: true, label: plan.label, steps: rec.steps };
    } finally { s.answering = false; }
  }

  // P104: 휴대폰 키 줄의 키를 그 세션 패널에 그대로 보낸다(pane.send_keys). 허용 목록의 키만, 세션마다 차례로 보내고 이벤트 'keys'로 남긴다.
  // 판이 답을 고르지 않으므로 상태(waiting 등)를 보지 않는다. 셸의 방향키처럼 언제나 보낸다
  async sendKeysTo(p, c) {
    const s = this.resolve(p.session ?? p.target);
    const rt = s.rt, paneId = s.paneId;
    const keys = checkKeys(p.keys);
    this.requireHerdr();
    if (!s.paneId) throw keyed(apiError('sleeping', `@${s.name} 세션은 절전 중이라 터미널이 닫혀 있습니다. 먼저 작업을 재개하세요.`), 'sleepingNoPane', { name: s.name });
    const validateAttachment = () => {
      if (p.controllerPid == null && p.attachmentId == null) return;
      if (!this.relay?._entry) throw apiError('not_attached', '터미널 연결을 확인해야 합니다');
      const entry = this.relay._entry(s.sessionId, c, p.controllerPid, p.attachmentId);
      if (entry.paneId !== paneId) throw apiError('stale_attachment', '터미널이 바뀌었습니다');
    };
    validateAttachment();
    await this.keyChain(s.sessionId, () => {
      if (!this.currentSession(s, rt, paneId) || this.killing.has(s.sessionId) || rt.exit) throw apiError('closed', '세션이 바뀌었거나 종료 중입니다');
      validateAttachment();
      return this.adapter.paneKeys(paneId, keys);
    });
    if (!this.currentSession(s, rt, paneId)) return { sent: true, keys };
    s.lastUserInputAt = Date.now();
    this.touch(s);
    if (c) this.peers.touch(c);
    this.store.addEvent(s.sessionId, 'keys', { keys, ...keysBy(c) });
    return { sent: true, keys };
  }

  // P71: 승인 줄의 워크트리 나가기 답. 보내기 직전에 화면을 다시 읽어 질문이 아직 있는지 보고 그 번호를 보낸다
  async answerWorktreeExit(s, p) {
    const rt = s.rt, paneId = s.paneId;
    const cur = s.rt.worktreeExit;
    if (p.since && p.since !== cur.at) return { sent: false, reason: 'stale' };
    planAnswer(worktreeExitAsk(cur), p); // 답 모양과 지우기 확인을 먼저 본다
    if (s.answering) throw keyed(apiError('busy', "이 세션에 이미 응답을 전송하고 있습니다."), 'answerBusy');
    s.answering = true;
    try {
      const w = parseWorktreeExit(await this.adapter.readScreen(paneId, { source: 'visible' }).catch(() => ''));
      if (!this.currentSession(s, rt, paneId) || this.killing.has(s.sessionId)) return { sent: false, reason: 'stale' };
      if (!w) { s.rt.worktreeExit = null; this.broadcastSession(s, { cause: 'worktree_exit:gone' }); return { sent: false, reason: 'stale' }; }
      const plan = planAnswer(worktreeExitAsk({ ...w, at: cur.at }), p);
      checkSteps(plan.steps);
      s.rt.exitRequested = true; // 어느 답이든 claude는 끝난다(hook이 없는 세션도 정상 종료로 본다)
      await this.adapter.paneKeys(paneId, plan.steps[0].keys);
      this.touch(s);
      const rec = { by: 'board', kind: 'worktree_exit', choice: p.choice, commits: w.commits, files: w.files, label: plan.label, steps: plan.steps.map((x) => x.keys.join('+')) };
      this.store.addEvent(s.sessionId, 'answer', rec);
      this.api.broadcast('session.answer', { sessionId: s.sessionId, name: s.name, ...rec });
      return { sent: true, label: plan.label, steps: rec.steps };
    } finally { s.answering = false; }
  }

  // herdr 서버 끄기·켜기·다시 띄우기(C3, D2). 끄면 claude도 함께 끝나고, 다시 띄우면 이어 가기로 다시 뜬다.
  async herdrControl(op, confirm) {
    const warn = "보드 전용 herdr 서버를 종료하면 모든 Claude Code 세션이 종료되고 진행 중인 작업이 중단됩니다. 서버를 다시 시작하면 기존 대화에서 세션을 재개합니다.";
    if ((op === 'stop' || op === 'restart') && !confirm) return confirmResult(warn, m('herdrStop'));
    const out = { op };
    if (op === 'stop' || op === 'restart') {
      // P54: 끌 실행 파일을 모르면(찾기 실패) 다시 찾는다. 그래도 없으면 부르지 않고 까닭을 알린다(전에는 10초 기다린 뒤 'herdr not found'를 담아 돌려주었다)
      if (!this.adapter.herdrPath) await this.resolveHerdr(op);
      if (!this.adapter.herdrPath) throw apiError('herdr_missing', "herdr 실행 파일을 찾지 못해 보드 전용 herdr 서버를 종료할 수 없습니다. 설정의 herdr 경로 또는 ATRIUM_HERDR로 실행 파일을 지정하세요.");
      this.herdrStopping = true;
      out.stop = await this.adapter.stopServer();
      await sleep(500);
      this.herdrStopping = false;
    }
    if (op === 'start' || op === 'restart') {
      // P40: 새 서버는 찾기 결과로 띄운다(업데이트한 herdr로 다시 띄우기). 못 찾으면 까닭과 함께 막는다
      await this.resolveHerdr(op);
      if (!this.adapter.herdrPath) { this.herdrMissing = { reason: 'not_found', at: Date.now() }; this.herdrCompat = { ok: false, level: 'missing', problems: ['herdr not found'] }; this.herdrOk = false; this.api.broadcast('herdr', this.herdrView()); this.requireHerdr(); }
      let r;
      try { r = await this.adapter.startServer(); }
      catch (e) { await this.ensureHerdr(); this.api.broadcast('herdr', this.herdrView()); throw keyed(apiError(e.code || 'start_failed', `herdr 서버를 시작하지 못했습니다: ${e.message}`), 'herdrStartFailed', { error: e.herdrMessage || e.message }); }
      this.herdrMissing = null;
      this.store.addEvent(null, 'herdr_started', { pid: r.pid, by: op });
      out.start = { started: r.started, pid: r.pid, ms: r.ms, version: r.pong && r.pong.version, protocol: r.pong && r.pong.protocol, exe: this.adapter.herdrPath };
      this.setHerdrCompat(this.adapter.checkCompat(r.pong));
      if (this.herdrOk && !this.adapter._watching) this.adapter.startEvents(() => [...this.sessions.values()].map((s) => s.paneId).filter(Boolean));
      this.checkHerdrUpdate(op).catch(() => {});
    }
    return out;
  }

  // P40: 진단에 고른 경로, 까닭, 본 후보와 결과, 시험하지 않은 버전 경고, 업데이트 알림을 더한다. 진단 때 업데이트도 본다(1분에 한 번까지)
  async herdrStatus() {
    const p = await this.adapter.probe();
    if (p.running && Date.now() - (this._updateCheckedAt || 0) > 60000) await this.checkHerdrUpdate('status').catch(() => {});
    const compat = p.running ? this.adapter.checkCompat(p.pong) : null;
    const v = this.herdrView();
    return {
      session: this.cfg.herdrSession, running: p.running, connected: this.adapter.connected, serverPid: p.running ? this.adapter.serverPid() : null, compat, cliVersion: await this.adapter.cliVersion(), subscribedPanes: this.adapter.subscribedPanes || [],
      path: v.path, missing: v.missing, level: compat ? compat.level : v.level, version: compat ? compat.version : v.version, protocol: compat ? compat.protocol : v.protocol, warning: compat ? compat.warning : v.warning, protocols: v.protocols, tested: v.tested, update: v.update,
      find: this.herdrFind || null,
    };
  }

  inbox() {
    const all = [...this.sessions.values()].map((s) => this.summary(s));
    const mine = all.filter((x) => x.state === 'waiting' || x.state === 'trust_wait').sort((a, b) => ((a.ask && a.ask.since) || a.createdAt) - ((b.ask && b.ask.since) || b.createdAt));
    const review = all.filter((x) => x.unseen).sort((a, b) => (a.turn.endedAt || 0) - (b.turn.endedAt || 0));
    const errors = all.filter((x) => x.state === 'error' || (x.state === 'exited' && x.exit && x.exit.kind !== 'normal'));
    return { needsYou: mine, review, problems: errors };
  }

  // ---------- 브리핑, 복귀 요약(E2·A3, P3). 한 줄 메모는 P22에서 뺐다 ----------
  // 들어갈 때 브리핑(E2): 마지막 지시, 마지막 답, 지금 상태, 기다리는 질문. 모델을 부르지 않고 대화 기록에서 뽑기만 한다.
  briefing(p) {
    const s = this.resolve(p.session);
    const sum = this.summary(s);
    const tx = lastExchange(s.rt.transcriptPath || transcriptPathFor(this.cfg.claudeProjects, s.cwd, this.launchOf(s).sessionId));
    const prompt = tx.exists && tx.lastPrompt ? tx.lastPrompt : s.rt.lastPrompt;
    const answer = tx.exists && tx.lastAnswer && (tx.lastAnswerAt || 0) >= (s.rt.lastAnswerAt || 0) - 1000 ? tx.lastAnswer : s.rt.lastAnswer;
    return {
      sessionId: s.sessionId, name: s.name, state: sum.state, estimate: sum.estimate, ask: sum.ask, exit: sum.exit, error: sum.error, interruptedTurn: sum.interruptedTurn,
      lastPrompt: clip(prompt, 600), lastPromptAt: (tx.exists && tx.lastPromptAt) || s.rt.lastPromptAt, lastAnswer: clip(answer, 1200), lastAnswerAt: (tx.exists && tx.lastAnswerAt) || s.rt.lastAnswerAt,
      touchedAt: s.touchedAt || null, lastActivityAt: s.rt.lastActivityAt, turn: sum.turn, git: s.git || null,
    };
  }
  // A3: since 뒤의 판 이벤트를 한 줄씩. 판 전체의 "마지막으로 본 시각"은 창이 board.markSeen으로 남긴다.
  changesSince(p) {
    const since = Number(p.since || this.store.getMeta('boardSeenAt') || 0);
    const events = this.store.eventsAfter(since, CHANGE_KINDS);
    const nameOf = (sid) => { const s = this.sessions.get(sid); if (s) return s.name; const r = this.store.getSession(sid); return r ? r.name : null; };
    const current = new Map([...this.sessions.values()].map((s) => [s.sessionId, this.summary(s)]));
    return { since, until: Date.now(), events: events.length, lines: summarizeChanges(events, { nameOf, current }) };
  }

  // D3: 판 전용 herdr 세션에 다른 클라이언트(herdr 화면)가 붙었는가. 서버 로그와 프로세스 목록 두 가지로 본다.
  checkClients() {
    const log = this.adapter.readClients();
    const procs = (this.resources && this.resources.last && this.resources.last.tuiProcesses) || [];
    const v = { session: this.cfg.herdrSession, logAvailable: log.available, viaLog: log.clients, viaProcess: procs, attached: log.clients.length > 0 || procs.length > 0 };
    const key = JSON.stringify([v.viaLog.map((c) => c.clientId), v.viaProcess.map((p) => p.pid)]);
    if (key !== this._clientsKey) {
      this._clientsKey = key;
      this.clients = v;
      this.store.addEvent(null, 'herdr_clients', { attached: v.attached, viaLog: v.viaLog.map((c) => c.clientId), viaProcess: v.viaProcess.map((p) => p.pid) });
      this.api.broadcast('herdr.clients', v);
      if (v.attached) this.log(`foreign herdr client attached: log=${key}`);
    }
    return v;
  }

  // ---------- 세션끼리 연결(P4, ARCH 4절 F) ----------
  // herdr 이름이나 패널 ID로 판의 세션을 찾는다(에이전트가 herdr 명령에 쓴 대상)
  resolveAgentTarget(target) {
    if (!target) return null;
    const t = String(target).replace(/^@/, '');
    for (const s of this.sessions.values()) if (s.agentName === t || s.paneId === t || s.name === t) return s;
    return null;
  }
  // 판에 보일 연결: 지우지 않았고 두 세션이 모두 판에 있는 것
  linksOpen() { return this.store.links().filter((l) => this.sessions.has(l.from) && this.sessions.has(l.to)).map((l) => this.linkView(l)); }
  linkView(l) {
    const a = this.sessions.get(l.from), b = this.sessions.get(l.to);
    return { ...l, fromName: shownName(a), toName: shownName(b), toAgentName: b ? b.agentName : null, toPaneId: b ? b.paneId : null, ...this.linkPromptView(l) };
  }
  // P67: prompts(지시 수, 이름표의 +n), promptAt(마지막 지시 시각, 이름표가 물러나는 기준)
  linkPromptView(l) {
    const p = this.store.linkPromptStats ? this.store.linkPromptStats(l.linkId) : { n: 0, at: null };
    return { prompts: p.n, promptAt: p.at };
  }
  // 순서 있는 쌍마다 연결 하나. 지운 연결에 새 일이 오가면 다시 연다
  ensureLink(from, to, patch = {}) {
    let l = this.store.linkByPair(from, to);
    if (!l) {
      l = { linkId: 'l' + crypto.randomBytes(5).toString('hex'), from, to, role: patch.role ?? null, spawned: !!patch.spawned, observed: !!patch.observed, createdAt: Date.now() };
      this.store.insertLink(l);
    } else {
      const f = {};
      if (l.removedAt) f.removedAt = null;
      if (patch.spawned && !l.spawned) f.spawned = true;
      if (patch.observed && !l.observed) f.observed = true;
      if (patch.role !== undefined && patch.role !== l.role) f.role = patch.role;
      if (Object.keys(f).length) this.store.updateLink(l.linkId, f);
    }
    l = this.store.getLink(l.linkId);
    this.api.broadcast('link.updated', this.linkView(l));
    return l;
  }
  // 오간 기록 한 줄. 선 위의 "마지막 지시"는 지시(prompt)와 판의 알림(role)만 바꾼다
  linkEvent(l, kind, text = null, data = null, { quiet = false } = {}) {
    const e = this.store.addLinkEvent(l.linkId, kind, text == null ? null : clip(String(text), 4000), data);
    const f = { lastKind: kind, lastAt: e.t, count: (l.count || 0) + 1 };
    if (kind === 'prompt') f.lastText = clip(String(text || ''), 300);
    if (!quiet || kind === 'prompt') this.store.updateLink(l.linkId, f); else this.store.updateLink(l.linkId, { count: f.count });
    const nl = this.store.getLink(l.linkId);
    this.api.broadcast('link.event', { ...e, from: l.from, to: l.to });
    this.api.broadcast('link.updated', this.linkView(nl));
    return e;
  }

  // F1·F3: 판이 띄운 Claude Code의 셸 도구 hook. 명령 글에서 herdr 호출을 읽는다(docs/log/p4-links.md 보고 4절)
  onShellHook(s, ev, body) {
    const cmd = body.tool_input && (body.tool_input.command || body.tool_input.script);
    if (!cmd || !/herdr/i.test(cmd)) return;
    const calls = parseHerdrCommands(cmd, { boardSession: this.cfg.herdrSession });
    const foreign = calls.filter((c) => c.foreign);
    if (foreign.length) this.store.addEvent(s.sessionId, 'herdr_foreign_call', { calls: foreign.map((c) => clip(c.raw, 200)) }); // 다른 herdr 세션·기계를 부른 호출은 판이 보지 않는다
    const mine = calls.filter((c) => !c.foreign && LINK_VERBS.has(c.verb));
    if (!mine.length) return;
    const id = body.tool_use_id || null;
    const now = Date.now();
    s.herdrCalls ||= new Map();
    if (ev === 'PreToolUse') {
      s.herdrCalls.set(id, { calls: mine, at: now });
      if (s.herdrCalls.size > 50) s.herdrCalls.delete(s.herdrCalls.keys().next().value);
      for (const c of mine) {
        this.store.addEvent(s.sessionId, 'herdr_call', { verb: c.verb, target: c.target || c.name || c.pane || null, text: clip(c.text, 200), toolUseId: id });
        // P21(D4): 다른 에이전트가 herdr로 잠든 세션을 부른다. 이 호출은 대상이 없어 실패하므로 깨워 두고, 다시 부르면 된다(판 안내에 적었다)
        { const z = c.target && this.resolveAgentTarget(c.target); if (z && z !== s && z.rt.sleep && this.sleeper) this.sleeper.wakeFor(z, `herdr:${s.name}`).catch(() => {}); } // P24: 그 리포 전체(P111: 혼자 잠든 세션은 그 세션만)
        if (c.verb === 'agent.prompt') {
          const t = this.resolveAgentTarget(c.target);
          if (t && t !== s) { const l = this.ensureLink(s.sessionId, t.sessionId, { observed: true }); this.linkEvent(l, 'prompt', c.text, { toolUseId: id, wait: c.wait, via: 'hook' }); t.openPromptFrom = { linkId: l.linkId, at: now, text: c.text }; }
          else if (!t) { (this.unresolved ||= []).push({ from: s.sessionId, target: c.target, text: c.text, at: now, toolUseId: id }); }
        } else if (c.verb === 'agent.send_keys') {
          const t = this.resolveAgentTarget(c.target);
          if (t && t !== s) this.linkEvent(this.ensureLink(s.sessionId, t.sessionId, { observed: true }), 'keys', (c.keys || []).join(' '), { toolUseId: id });
        } else if (c.verb === 'agent.start' || c.verb === 'pane.split' || c.verb === 'pane.run' || c.verb === 'worktree.create' || c.verb === 'workspace.create') {
          const pane = c.pane === 'current' || c.pane === '$HERDR_PANE_ID' || c.pane === '"$HERDR_PANE_ID"' ? null : c.pane;
          this.spawnIntents.push({ from: s.sessionId, verb: c.verb, name: c.name || null, pane: c.verb === 'agent.start' ? pane : null, kind: c.kind || null, at: now, toolUseId: id, raw: clip(c.raw, 200) });
          this.spawnIntents = this.spawnIntents.filter((x) => now - x.at < this.cfg.adoptSpawnMatchMs);
        }
      }
      return;
    }
    // PostToolUse: 명령의 결과(stdout의 JSON)로 지시가 들어갔는지, 받은 답, 새 패널 ID를 읽는다
    const out = parseHerdrOutput(body.tool_response);
    const failed = ev === 'PostToolUseFailure';
    let reads = 0;
    for (const c of mine) {
      if (c.verb === 'agent.prompt' || c.verb === 'agent.wait') {
        const t = this.resolveAgentTarget(c.target);
        if (!t || t === s) continue;
        const r = out.results.find((x) => x && (x.type === 'agent_prompted' || x.type === 'agent_wait' || x.agent));
        const status = r && r.agent ? r.agent.agent_status : null;
        this.linkEvent(this.ensureLink(s.sessionId, t.sessionId, { observed: true }), c.verb === 'agent.prompt' ? 'prompt_result' : 'wait_result', failed ? clip(body.error || out.text, 400) : null, { toolUseId: id, ok: !failed, status, type: r ? r.type : null }, { quiet: true });
      } else if (c.verb === 'agent.read') {
        if (body.noToolOutput) continue; // provider does not supply shell output
        const t = this.resolveAgentTarget(c.target);
        if (!t || t === s) continue;
        const text = reads++ === 0 ? readTextOf(out) : null; // 한 명령에 read가 여럿이면 첫 것만 글로 남긴다
        this.linkEvent(this.ensureLink(s.sessionId, t.sessionId, { observed: true }), 'reply', text == null ? null : screenAnswerText(text, 40), { toolUseId: id, ok: !failed, screenTail: text == null ? null : tailText(text, 60) });
      } else {
        // 새 패널과 에이전트 ID를 띄운 명령에 붙인다(F3 맞추기)
        const it = this.spawnIntents.find((x) => x.toolUseId === id && x.verb === c.verb);
        for (const r of out.results) {
          const pane = r && (r.pane ? r.pane.pane_id : r.root_pane ? r.root_pane.pane_id : r.agent ? r.agent.pane_id : null);
          if (pane && it && !it.resultPanes) it.resultPanes = [];
          if (pane && it) it.resultPanes.push(pane);
          if (r && r.agent && r.agent.name && it) it.name ||= r.agent.name;
        }
        const adopted = it && it.resultPanes && it.resultPanes.map((p) => this.sessionByPane(p)).find((x) => x && x.origin === 'adopted' && !x.parentSessionId);
        if (adopted) this.setParent(adopted, s, it);
      }
    }
    if (id) s.herdrCalls.delete(id);
  }

  // F3·G2: 판 전용 herdr 세션에 나타난, 판이 모르는 패널을 판에 올린다. 에이전트가 있으면 그 종류로, 없으면 일반 셸(shell)로.
  // 부모는 띄운 명령(hook의 agent start, pane split), 없으면 같은 작업 공간의 판 세션이다. 워크스페이스는 패널 폴더(herdr cwd)로 정한다.
  async adoptPane(paneId, { cwd: hintCwd = null } = {}) {
    if (!paneId || this.adopting.has(paneId) || this.sessionByPane(paneId)) return null;
    this.adopting.add(paneId);
    try {
      await sleep(400); // herdr가 agent.start의 이름을 붙일 시간
      for (let i = 0; i < 25 && this.creatingPanes > 0 && !this.sessionByPane(paneId); i++) await sleep(200); // 판이 만드는 패널이면 그 세션이 등록될 때까지
      if (this.sessionByPane(paneId)) return null; // 판이 띄우는 중이던 세션
      const pane = await this.adapter.getPane(paneId).catch(() => null);
      if (!pane || !pane.paneId || this.sessionByPane(paneId)) return null; // 그새 닫힌 패널
      const a = (await this.adapter.listAgents()).find((x) => x.paneId === paneId) || null;
      if (this.sessionByPane(paneId)) return null;
      const hw = (a && a.workspaceId) || pane.workspaceId;
      const now = Date.now();
      const intents = this.spawnIntents.filter((x) => now - x.at < this.cfg.adoptSpawnMatchMs).reverse();
      const it = intents.find((x) => (a && a.name && x.name === a.name) || x.pane === paneId || (x.resultPanes || []).includes(paneId))
        || intents.find((x) => { const f = this.sessions.get(x.from); return f && f.herdrWorkspaceId === hw; });
      const sameWs = [...this.sessions.values()].find((x) => x.herdrWorkspaceId === hw && x.paneId !== paneId);
      const parent = (it && this.sessions.get(it.from)) || sameWs || null;
      const taken = takenNames(this.sessions.values(), [...(this.spawningNames || [])]); // 만드는 중인 이름도 피한다(이슈 #1-7). P66: 판의 이름도
      const base = a ? (a.name && NAME_RE.test(a.name) ? a.name : `${a.agent || 'agent'}-${paneId.replace(/[^A-Za-z0-9]/g, '')}`) : `sh-${paneId.replace(/[^A-Za-z0-9]/g, '')}`;
      let name = base;
      for (let i = 2; taken.has(name); i++) name = `${base.slice(0, 28)}-${i}`;
      const kind = a ? a.agent || 'unknown' : SHELL;
      const rt = newRuntime({ kind, hooked: false });
      if (a) {
        applyAgentDetected(rt, now);
        applyHerdrStatus(rt, a.status || 'unknown', now, { launchPending: a.launchPending, agentSessionId: a.agentSessionId });
        if (a.status && a.status !== 'unknown') rt.phase = 'running';
      } else rt.phase = 'running';
      const cwd = pane.cwd || (a && a.cwd) || hintCwd || (parent && parent.cwd) || '';
      // G1: 판에 올린 에이전트와 셸은 패널 폴더로 워크스페이스를 정한다. 폴더를 모르면 부모의 워크스페이스
      const ws = cwd ? await workspaceOf(cwd) : null;
      const wsKey = ws ? ws.key : parent ? parent.workspaceKey : this.currentWorkspace();
      if (this.sessionByPane(paneId)) return null;
      if (ws) this.ensureWorkspace(ws, `adopt ${name}`);
      const s = { sessionId: crypto.randomUUID(), name, cwd, paneId, herdrWorkspaceId: hw, agentName: (a && a.name) || paneId, model: null, effort: null, permissionMode: 'manual', settingsPath: '', hookToken: '', resumeArgv: null, resumeVerified: false, createdAt: now, closedAt: null, seenAt: null, touchedAt: null, rt, lastState: null, kind, origin: 'adopted', parentSessionId: null, adoptNamed: !!(a && a.name), workspaceKey: wsKey };
      this.store.insertSession({ ...s, runtime: rt });
      this.sessions.set(s.sessionId, s);
      // 새 노드는 그 워크스페이스 판의 빈자리. 부모가 같은 판에 있으면 부모 옆(F3). 사람이 보는 화면은 옮기지 않는다(G3)
      const anchor = parent && parent.workspaceKey === wsKey && this.store.nodes().find((n) => n.session_id === parent.sessionId);
      const area = this.worktrees ? this.worktrees.areaOf(wsKey, cwd) : ''; // P27
      const slot = slotFor(this, { wsKey, size: NODE, near: anchor && (anchor.area || '') === area ? anchor : null, area });
      this.store.setNode({ session_id: s.sessionId, x: slot.x, y: slot.y, w: NODE.w, h: NODE.h, z: 0, size: NODE.size, aspect: NODE.aspect, area });
      // P6a(H5): herdr에서 부모와 같은 탭에 나뉜 패널이면 나눈 방향대로 붙인다
      if (parent) await autoDockSplit(this, s, parent);
      settleRegions(this, 'adopt');
      this.store.addEvent(s.sessionId, 'adopted', { paneId, agent: kind, herdrName: (a && a.name) || null, cwd, workspace: wsKey, parent: parent ? parent.name : null, by: it ? `hook:${it.verb}` : sameWs ? 'same workspace' : 'none', intent: it ? it.raw : null });
      this.log(`adopted ${name} (${kind}) pane=${paneId} ws=${wsKey} parent=${parent ? parent.name : '-'}`);
      await this.adapter.refreshSubscription();
      this.api.broadcast('session.created', { sessionId: s.sessionId, name, adopted: true, workspaceKey: wsKey });
      if (parent) this.setParent(s, parent, it);
      this.broadcastSession(s, { cause: 'adopted' });
      this.probeGit(s, s.cwd);
      if (a) this.linkUnresolved(s, a.name);
      return s;
    } finally { this.adopting.delete(paneId); }
  }
  // 받는 쪽이 판에 오르기 전에(또는 셸 노드에 에이전트가 뜨기 전에) 보낸 지시(띄우자마자 시킴)를 이제 잇는다
  linkUnresolved(s, herdrName) {
    const now = Date.now();
    const hit = (x) => (herdrName && x.target === herdrName) || x.target === s.paneId;
    for (const u of (this.unresolved || []).filter(hit)) {
      const f = this.sessions.get(u.from);
      if (f && f !== s) this.linkEvent(this.ensureLink(f.sessionId, s.sessionId, { observed: true }), 'prompt', u.text, { toolUseId: u.toolUseId, via: 'hook', late: true });
    }
    this.unresolved = (this.unresolved || []).filter((x) => !hit(x) && now - x.at < this.cfg.adoptSpawnMatchMs);
  }
  setParent(s, parent, intent) {
    if (s.parentSessionId && s.parentSessionId !== parent.sessionId) return;
    s.parentSessionId = parent.sessionId;
    this.store.updateSession(s.sessionId, { parentSessionId: parent.sessionId });
    const l = this.ensureLink(parent.sessionId, s.sessionId, { spawned: true });
    if (!this.store.linkEvents(l.linkId, 5).some((e) => e.kind === 'spawn')) this.linkEvent(l, 'spawn', intent ? intent.raw : `같은 작업 공간(${s.herdrWorkspaceId})에 나타남`, { by: intent ? `hook:${intent.verb}` : 'same workspace', paneId: s.paneId, kind: s.kind }, { quiet: true });
  }
  // herdr agent start가 이름을 늦게 붙였으면 따라 바꾼다(자동으로 지은 이름일 때만)
  async refreshAdoptedName(s) {
    if (s.origin !== 'adopted' || s._naming) return;
    s._naming = true;
    try {
      const a = (await this.adapter.listAgents()).find((x) => x.paneId === s.paneId);
      if (!a || !a.name || !NAME_RE.test(a.name) || nameOwner(this.sessions.values(), a.name, s)) return;
      s.adoptNamed = true; s.agentName = a.name;
      if (s.name !== a.name) { this.store.addEvent(s.sessionId, 'renamed', { from: s.name, to: a.name }); s.name = a.name; this.store.renameSession(s.sessionId, a.name); }
      this.store.updateSession(s.sessionId, { agentName: a.name });
      this.broadcastSession(s, { cause: 'herdr:name' });
    } finally { s._naming = false; }
  }

  // F1: 받는 쪽의 상태 변화를 그 쪽으로 온 마지막 지시의 기록에 붙인다(B 작업 중, B 끝남, B 내 차례)
  onLinkTargetState(s, from, sum) {
    const op = s.openPromptFrom;
    if (!op || Date.now() - op.at > OPEN_PROMPT_MS) return;
    const l = this.store.getLink(op.linkId);
    if (!l || l.removedAt) return;
    const to = sum.state;
    if (to === 'working' && !op.working) { op.working = true; this.linkEvent(l, 'target_working', null, { from }, { quiet: true }); }
    else if (to === 'waiting' || to === 'trust_wait') this.linkEvent(l, 'target_waiting', sum.ask ? clip(sum.ask.summary || sum.ask.kind, 200) : null, null, { quiet: true });
    else if ((to === 'ready' || to === 'error') && op.working) {
      s.openPromptFrom = null;
      this.linkEvent(l, 'target_done', s.rt.lastAnswer ? clip(s.rt.lastAnswer, 2000) : null, { state: to, answerSource: s.rt.answerSource || null }, { quiet: true });
    } else if (to === 'exited') { s.openPromptFrom = null; this.linkEvent(l, 'target_exited', null, { exit: sum.exit }, { quiet: true }); }
  }
  // 받는 쪽이 판의 hook이 붙은 Claude Code면 지시가 제출된 것을 hook으로 확인한다
  onLinkTargetPrompt(s, prompt) {
    const op = s.openPromptFrom;
    if (!op || op.submitted || Date.now() - op.at > OPEN_PROMPT_MS) return;
    const l = this.store.getLink(op.linkId);
    if (!l) return;
    op.submitted = true;
    this.linkEvent(l, 'target_submitted', null, { matches: String(prompt || '').includes(String(op.text || '').slice(0, 40)) }, { quiet: true });
  }

  // F2: 판에서 A → B 연결을 잇고 역할을 정한다. A에게 B의 herdr 이름, 패널, 역할을 B1 규칙으로 알린다
  linkCreate(p) {
    const a = this.resolve(p.from), b = this.resolve(p.to);
    if (a === b) throw apiError('bad_request', "세션을 자기 자신과 연결할 수 없습니다.");
    const role = String(p.role || '').trim();
    if (!ROLE_RE.test(role)) throw apiError('bad_request', "역할은 1~40자로 입력하세요. 줄바꿈, 따옴표, $, \\는 사용할 수 없습니다.");
    const l = this.ensureLink(a.sessionId, b.sessionId, { role });
    const text = roleNotice({ role, agentName: b.agentName, paneId: b.paneId, kind: b.kind || 'claude' });
    const d = this.queue.enqueue(a.sessionId, text);
    this.store.updateLink(l.linkId, { notifyDelivery: d.deliveryId });
    this.linkEvent(l, 'role', role, { deliveryId: d.deliveryId, notice: text });
    this.store.addEvent(a.sessionId, 'link_created', { to: b.name, role });
    return { link: this.linkView(this.store.getLink(l.linkId)), deliveryId: d.deliveryId, notice: text };
  }
  // 연결 끊기. 역할이 있었으면 A에게 끊겼다고 알린다. 선은 판에서 빠지고 기록은 남는다
  linkDelete(p) {
    const l = this.store.getLink(p.link);
    if (!l) throw apiError('not_found', `연결을 찾을 수 없습니다: ${p.link}`);
    const a = this.sessions.get(l.from), b = this.sessions.get(l.to);
    // P81: 부모 → 하위 세션의 선이면 확인에서 "선만 끊기"와 "부모에서도 떼기"를 고른다. 떼기는 선 끊기를 겸한다(알림은 떼기의 것만)
    const parentLink = !!(a && b && b.parentSessionId === a.sessionId);
    const pl = parentLink ? { parentLink: { parent: a.name, child: b.name }, parentMsg: m('linkCutParent', { from: a.name, to: b.name }), parentMessage: `@${a.name} → @${b.name}는 부모와 하위 세션의 선입니다. 선만 끊으면 @${b.name}는 여전히 @${a.name}의 하위 세션입니다. 부모에서도 떼면 부모 없는 세션이 됩니다.` } : {};
    if (!p.confirm) return l.role && a ? confirmResult(`@${a.name} → @${b ? b.name : '?'} 연결("${l.role}")을 끊는다. @${a.name}에 연결 해제를 알립니다. 주고받은 기록은 유지합니다.`, m('linkCut', { from: a.name, to: b ? b.name : '?', role: l.role }), pl) : confirmResult("보드에서 이 연결선을 제거합니다. 주고받은 기록은 유지합니다.", m('linkRemove'), pl);
    if (p.detach) {
      if (!parentLink) throw apiError('bad_request', "부모와 하위 세션의 선이 아닙니다. 선만 끊을 수 있습니다.");
      return { removed: true, deliveryId: null, ...this.branch.detach(b, { by: 'user' }) };
    }
    let deliveryId = null;
    if (l.role && a && b) { const d = this.queue.enqueue(a.sessionId, unlinkNotice({ role: l.role, agentName: b.agentName })); deliveryId = d.deliveryId; }
    this.linkEvent(l, 'unlink', l.role || null, { deliveryId }, { quiet: true });
    this.store.updateLink(l.linkId, { role: null, removedAt: Date.now() });
    this.api.broadcast('link.removed', { linkId: l.linkId, reason: 'user' });
    return { removed: true, deliveryId };
  }
  // P81: 판에서 부모에서 떼기(노드 메뉴). 확인 글은 무엇이 바뀌는지(머리줄, 사이드바, 끄기와 잠재우기 묶음)
  detachSession(p) {
    const s = this.resolve(p.session);
    if (!s.parentSessionId) throw keyed(apiError('no_parent', `@${s.name}에게는 부모가 없습니다.`), 'detachNoParent', { name: s.name });
    const parent = this.sessions.get(s.parentSessionId);
    const pname = parent ? parent.name : (this.branch.rowOf(s.parentSessionId) || {}).name || '?';
    if (!p.confirm) return confirmResult(`@${s.name}을 @${pname}에서 뗍니다. 머리줄과 사이드바에서 @${pname}의 하위 세션 표시가 빠지고, @${pname}가 끄거나 함께 깨어 있게 하는 묶음도 풀립니다. 되돌릴 수 없습니다.`, m('detach', { name: s.name, parent: pname }));
    return this.branch.detach(s, { by: 'user' });
  }

  // ---------- F4: 세션 폴더의 git(워크트리) ----------
  probeGit(s, cwd) {
    if (!cwd) return;
    const seq = (s._gitSeq = (s._gitSeq || 0) + 1);
    gitProbe(cwd).then((g) => {
      if (seq !== s._gitSeq || !this.currentSession(s)) return;
      const key = (x) => (x ? [x.isRepo, x.root, x.branch, x.isWorktree, x.commonDir].join('|') : '');
      const changed = key(g) !== key(s.git);
      const filesChanged = !s.git || s.git.changedFiles !== g.changedFiles;
      s.git = g;
      if (changed) this.store.addEvent(s.sessionId, 'git', { cwd: g.cwd, root: g.root || null, branch: g.branch || null, isWorktree: !!g.isWorktree, commonDir: g.commonDir || null });
      if (changed || filesChanged) this.broadcastSession(s, { cause: changed ? 'git' : undefined });
      if (changed && this.worktrees) this.worktrees.kick('git'); // P27: 워크트리로 들어갔거나 새 워크트리가 생겼을 수 있다
    }).catch(() => {});
  }
  // hook이 없는 세션은 herdr가 아는 패널 폴더(foreground_cwd)를, 모든 세션은 브랜치가 바뀌었는지를 주기적으로 본다
  async pollCwd() {
    if (!this.adapter.connected) return;
    for (const s of [...this.sessions.values()]) {
      if (!s.paneId || s.rt.exit) continue;
      let cwd = s.rt.cwd || s.cwd;
      if (!this.hooked(s)) {
        const p = await this.adapter.getPane(s.paneId).catch(() => null);
        if (p && p.cwd && p.cwd !== s.rt.cwd) { s.rt.cwd = p.cwd; cwd = p.cwd; }
      }
      this.probeGit(s, cwd);
    }
  }

  async get(p) {
    const s = this.resolve(p.session);
    const out = { ...this.summary(s), ask: s.rt.pendingAsk ? { ...s.rt.pendingAsk } : null, lastPrompt: s.rt.lastPrompt, lastAnswer: s.rt.lastAnswer, lastAskResolved: s.rt.lastAskResolved, settingsPath: s.settingsPath, resumeArgv: s.resumeArgv, transcriptPath: s.rt.transcriptPath || transcriptPathFor(this.cfg.claudeProjects, s.cwd, this.launchOf(s).sessionId), git: s.git || null };
    if (p.screen !== false && s.rt.herdr.present !== undefined) { try { out.screenTail = tailLines(await this.adapter.readScreen(s.paneId, { source: 'visible' }), p.lines || 12); } catch { out.screenTail = null; } }
    if (!out.git) out.git = s.git = await gitProbe(s.rt.cwd || s.cwd);
    out.deliveries = this.store.deliveries({ sessionId: s.sessionId, limit: 10 }).map((d) => ({ ...d, text: clip(d.text, 80) }));
    out.lastActivityAt = s.rt.lastActivityAt;
    return out;
  }

  agentModels(p = {}) {
        if (p.kind === 'agy') {
          this.agyModelRequest ||= listAgyModels().finally(() => { this.agyModelRequest = null; });
          return this.agyModelRequest;
        }
        if (p.kind === 'gemini') return listGeminiModels();
        if (p.kind !== 'codex') return { models: [], source: null };
        this.modelRequest ||= listCodexModels().finally(() => { this.modelRequest = null; });
        return this.modelRequest;
        }

  handlers() {
    return {
      'backend.status': async () => ({ pid: process.pid, port: this.cfg.port, profile: this.cfg.profile, dataDir: this.cfg.dataDir, startedAt: this.startedAt, previousRun: this.previousRun, herdr: await this.herdrStatus(), sessions: this.sessions.size, relay: this.relay.stats(), clients: this.clients || null, plugin: this.plugin, migration: this.migrationView(), web: this.web ? this.web.status() : null, version: this.updater ? this.updater.running : null }),
      'backend.shutdown': async () => { setTimeout(() => this.stop('api').then(() => process.exit(0)), 50); return { stopping: true }; },
      'herdr.status': () => this.herdrStatus(),
      'herdr.stop': (p) => this.herdrControl('stop', p.confirm),
      'herdr.start': () => this.herdrControl('start', true),
      'herdr.restart': (p) => this.herdrControl('restart', p.confirm),
      'herdr.rediscover': () => this.rediscoverHerdr('rediscover'), // P40: 다시 찾기
      'session.spawn': (p) => this.spawn(p),
      'session.list': () => [...this.sessions.values()].map((s) => this.summary(s)),
      'session.get': (p) => this.get(p),
      'session.send': (p) => this.send(p),
      'session.rename': (p) => renameSession(this, p), // P66: 판의 이름 바꾸기(name, clear, by: human|cli)
      'delivery.cancel': (p) => this.queue.cancelWait(p.deliveryId), // P106: 막혀 다시 보내는 중(sending)인 전달도 취소한다
      // P106: active면 아직 끝나지 않은 전달 모두(창이 다시 열려도 막힌 전달을 보이고 취소할 수 있게)
      'delivery.list': (p) => p.active ? this.queue.list(p.session ? this.resolve(p.session).sessionId : undefined).map((d) => ({ ...(this.store.getDelivery(d.deliveryId) || {}), status: d.status, reason: d.reason, attempts: d.attempts || 0, name: this.nameOf(d.sessionId) })) : this.store.deliveries({ sessionId: p.session ? this.resolve(p.session).sessionId : undefined, limit: p.limit || 20 }).map((d) => ({ ...d, name: this.nameOf(d.sessionId) })),
      'session.kill': (p) => this.kill(p),
      'session.answer': (p) => this.answer(p),
      'session.keys': (p, c) => this.sendKeysTo(p, c), // P104: 휴대폰 키 줄(원격 기기도 부른다)
      'session.markSeen': (p) => { const s = this.resolve(p.session); s.seenAt = Date.now(); this.store.updateSession(s.sessionId, { seenAt: s.seenAt }); this.touch(s); this.broadcastSession(s); return { seenAt: s.seenAt }; },
      'inbox.list': () => this.inbox(),
      'session.messages': (p) => { const s = this.resolve(p.session); if (s.kind === 'codex' && s.rt.codexSessionId && this.desktopImport?.codex) return readCodexMessages(this.desktopImport.codex, s.rt.codexSessionId, { afterSeq: p.afterSeq ?? -1, limit: p.limit || 200 }); return readMessages(s.rt.transcriptPath || transcriptPathFor(this.cfg.claudeProjects, s.cwd, this.launchOf(s).sessionId), { afterSeq: p.afterSeq ?? -1, limit: p.limit || 200 }); },
      'session.events': (p) => this.store.events({ sessionId: p.session ? this.resolve(p.session).sessionId : undefined, since: p.since || 0, limit: p.limit || 200 }),
      'terminal.snapshot': async (p) => { const s = this.resolve(p.session); return { sessionId: s.sessionId, format: p.format || 'ansi', text: await this.adapter.readScreen(s.paneId, { source: 'visible', format: p.format || 'ansi' }) }; },
      // P42: 셸 노드의 지난 출력(herdr 기록, 화면 너비로 감긴 줄, ANSI). 창이 xterm scrollback에 넣어 판 안에서 올려 보고 고른다
      'terminal.history': async (p) => { const s = this.resolve(p.session); if (!s.paneId) return { sessionId: s.sessionId, text: '' }; return { sessionId: s.sessionId, text: await this.adapter.readScreen(s.paneId, { source: 'recent', format: 'ansi', lines: Math.min(Math.max(Number(p.lines) || 3000, 1), 10000) }) }; },
      'terminal.attach': (p, c) => { this.requireHerdr(); const s = this.resolve(p.session); if (!s.paneId) throw keyed(apiError('sleeping', `@${s.name}은 잠들어 패널이 없다. 먼저 깨운다`), 'sleepingNoPane', { name: s.name }); return this.relay.attach(s, p.cols || 120, p.rows || 40, c, p.attachmentId); },
      'terminal.input': (p, c) => { this.relay.input(this.resolve(p.session).sessionId, String(p.data ?? ''), c, p.controllerPid, p.attachmentId); return { ok: true }; },
      'terminal.resize': (p, c) => { this.relay.resize(this.resolve(p.session).sessionId, p.cols, p.rows, c, p.controllerPid, p.attachmentId); return { ok: true }; },
      'terminal.focus': (p, c) => { this.relay.focus(this.resolve(p.session).sessionId, c, p.controllerPid, p.attachmentId); this.peers?.touch(c); return { ok: true }; },
      'terminal.detach': (p, c) => { this.relay.detach(this.resolve(p.session).sessionId, c, p.controllerPid, p.attachmentId); return { ok: true }; },
      'events.subscribe': (p, c) => { c.subscribed = true; return { subscribed: true, sessions: [...this.sessions.values()].map((s) => this.summary(s)), ...(this.peers ? { clients: { ...this.peers.view(), me: c.clientId } } : {}) }; },
      // P5: workspace를 주면 그 판의 노드와 그룹만(연결은 한쪽이라도 그 판에 있는 것). 창은 다른 워크스페이스로 가는 연결과 칩 때문에 모두 받는다
      // P6a: 캔버스 하나. viewport는 캔버스 하나의 것(meta). workspace를 주면 그 워크스페이스의 노드·덩어리만(연결은 한쪽이라도 그 안에 있는 것)
      // P47: viewport는 클라이언트마다(meta viewport:<client>). 처음 붙는 클라이언트와 익명 연결은 보드 값(meta viewport, 옛 판 값)
      'board.get': async (p, c) => {
        const w = p.workspace ? await this.resolveWorkspace(p.workspace) : null;
        const inWs = (k) => !w || (k || null) === w.key;
        const nodes = this.store.nodes().filter((n) => inWs(n.workspace_key));
        const ids = new Set(nodes.map((n) => n.session_id));
        return { nodes, docks: this.store.docks().filter((d) => inWs(d.workspaceKey)), viewport: viewportFor(c && c.clientId ? this.store.getMeta(viewportKey(c.clientId)) : null, this.store.getMeta('viewport')), seenAt: this.store.getMeta('boardSeenAt'), links: this.linksOpen().filter((l) => !w || ids.has(l.from) || ids.has(l.to)), workspaces: this.workspaceList(), current: this.currentWorkspace(), groups: readGroups(this).groups, canvas: this.store.getMeta('canvas'),
          // P6c: 메모·칸반 노드(P6b I3·I4)도 같은 판에 그린다
          ...(this.features ? { memos: this.store.memos().filter((m) => inWs(m.workspaceKey)), kanbans: this.store.kanbans().filter((k) => inWs(k.workspaceKey)).map((k) => this.features.kanbans.view(k)) } : {}),
          // P13: 판 밖 대화 노드와 띄움 선(recall.layoutCanvas가 만든 것)
          ...(this.recall ? { convoNodes: this.recall.canvas.nodes.filter((n) => inWs(n.workspaceKey)), convoEdges: this.recall.canvas.edges } : {}) };
      },
      // cause: 창이 왜 옮겼는지(drag, resize, divider…). 자리가 바뀌면 판 이벤트 node_moved로 남긴다(P5 5절 2번 조사)
      'board.setNode': (p, c) => {
        const s = this.resolve(p.session);
        const before = this.store.nodes().find((n) => n.session_id === s.sessionId);
        const n = { session_id: s.sessionId, x: p.x, y: p.y, w: p.w, h: p.h, z: p.z };
        this.store.setNode(n);
        // P73: 사람이 테두리를 끌어 크기를 바꾸면 고른 비율과 크기 단계를 끈다(자유 비율)
        if (before && (Math.round(before.w) !== Math.round(n.w) || Math.round(before.h) !== Math.round(n.h)) && (before.aspect || before.size)) this.store.setNodeAspect(s.sessionId, null, null);
        noteNodeMove(this, s, before, n, p.cause);
        // P47: 다른 창도 옮긴 자리를 바로 그린다(예전에는 다음 board.changed까지 옛 자리). 보낸 창은 by로 알아보고 무시한다
        this.api.broadcast('board.node', { sessionId: s.sessionId, x: p.x, y: p.y, w: p.w, h: p.h, z: p.z, by: (c && c.clientId) || null });
        // P75: 테두리를 끌어 키웠으면 줄의 뒤 형제를 아래로 민다(작아지면 당기지 않는다)
        if (before && (n.w > before.w + 0.5 || n.h > before.h + 0.5) && (reflowLines(this, s.sessionId, 'resize').length + settleRegions(this, 'resize').length)) this.api.broadcast('board.changed', { why: 'line pushed' });
        return { ok: true };
      },
      // P6a: workspace 없이 부르면 캔버스 하나의 뷰포트. P5처럼 workspace를 주면 그 워크스페이스 줄에 남긴다
      // P47: 클라이언트가 알려 온 연결이면 그 클라이언트의 값에 남긴다. 보드 값은 다음에 처음 붙는 클라이언트가 시작할 자리로 함께 고친다
      'board.setViewport': async (p, c) => {
        if (!p.workspace) { const vp = { x: p.x, y: p.y, zoom: p.zoom }; if (c && c.clientId) { this.store.setMeta(viewportKey(c.clientId), vp); this.peers.touch(c); } this.store.setMeta('viewport', vp); return { ok: true, workspace: null, client: (c && c.clientId) || null }; }
        const w = await this.resolveWorkspace(p.workspace, { required: false });
        if (w) this.store.setWorkspaceViewport(w.key, { x: p.x, y: p.y, zoom: p.zoom });
        return { ok: true, workspace: w ? w.key : null };
      },
      // 리포지토리 워크스페이스(P5, G1·G3)
      'workspace.list': () => (syncWsGroups(this, 'list') && this.broadcastWorkspaces(), { workspaces: this.workspaceList(), current: this.currentWorkspace(), groups: readGroups(this).groups }),
      'workspace.open': (p) => this.workspaceOpen(p),
      'workspace.close': (p) => this.workspaceClose(p),
      'workspace.select': (p) => this.workspaceSelect(p),
      // A3: 판을 마지막으로 본 시각. 창이 초점을 가진 동안 남긴다
      'board.markSeen': (p) => { const t = Number(p.at) || Date.now(); this.store.setMeta('boardSeenAt', t); return { seenAt: t }; },
      'changes.since': (p) => this.changesSince(p),
      'trust.predict': (p) => predictTrust(path.resolve(p.cwd), this.cfg.claudeJson),
      // 브리핑(E2)
      'session.briefing': (p) => this.briefing(p),
      'session.touch': (p) => { const s = this.resolve(p.session); this.touch(s); this.broadcastSession(s); return { touchedAt: s.touchedAt }; },
      'session.clearInterrupted': (p) => { const s = this.resolve(p.session); s.rt.interruptedTurn = null; s.recovered = null; this.broadcastSession(s); return { ok: true }; },
      // 세션끼리 연결(P4, F1~F3)과 에이전트 종류(F5)
      'link.list': () => this.linksOpen(),
      'link.create': (p) => this.linkCreate(p),
      'link.delete': (p) => this.linkDelete(p),
      'session.detach': (p) => this.detachSession(p), // P81
      'link.log': (p) => { const l = this.store.getLink(p.link); if (!l) throw apiError('not_found', `연결을 찾을 수 없습니다: ${p.link}`); return { link: this.linkView(l), events: this.store.linkEvents(l.linkId, p.limit || 200) }; },
      'agent.kinds': () => this.adapter.agentKinds(),
      'agent.models': (p) => this.agentModels(p),
      // 자원과 붙은 클라이언트(D1·D3)
      'resources.get': async (p) => (p.fresh ? this.resources.sample() : this.resources.last),
      'herdr.clients': () => this.checkClients(),
      // P6a: 단일 캔버스(검색, 붙여 묶기, 풀기, 정리, 크기 단계, 영역 옮기기)
      ...canvasHandlers(this),
      ...groupHandlers(this), // P44: 워크스페이스 가상 그룹
      ...peerHandlers(this), // P47: client.hello, client.active, clients.list
    };
  }
}
