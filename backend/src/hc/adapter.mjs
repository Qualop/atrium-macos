// P114: herdr-core(hc) 어댑터. 판(backend.mjs, relay.mjs, recall.mjs)이 터미널을 부르는 바깥 모양이다(옛 판 옮기기 모듈의 옛 어댑터도 같은 모양).
// P129: 판의 터미널 백엔드는 hc 하나다(terminal-backend.mjs). 옛 판은 뜰 때 옛 판 옮기기 모듈이 이 어댑터로 옮긴다.
// - 코어: 판 전용 세션(HC_SESSION = 판의 터미널 세션 이름), 고정 버전을 판 폴더에(pin.mjs), 띄우기·다시 띄우기·끄기는 core.mjs. 떠 있는 코어가 고정 버전과 다르면 붙을 때 올린다(2b)
// - 모델: 패널 = hc 터미널(주소), 작업 공간 = 라벨, 에이전트 = 7501 상태의 앱 이름(model.mjs). 이벤트는 판이 아는 모양(type: status, agent_detected, agent_released, pane_closed …)으로 낸다
// - 세션 시작(2b): 판은 셸 패널을 만들고(createWorkspace) 그 패널에서 에이전트를 띄운다(startAgent). hc에서는 셸 자리를 "에이전트가 첫 argv인 터미널"로
//   바꿔 띄우고 pane_moved로 알린다. env는 판의 env + PATH(pathFirst, 판의 hc 폴더, 레지스트리 PATH) + XDG_CONFIG_HOME 빈 값(terminal.run env)
// - 에이전트 끝(2b): 판은 에이전트가 끝난 패널에서 다시 띄운다(이어 가기·되살리기·깨우기, 옛 터미널은 패널 셸이 남았다). 판이 띄운 에이전트 터미널이
//   스스로 끝나면(exited) 같은 자리(작업 공간·폴더·라벨)에 셸 터미널을 띄우고 pane_moved로 알린다. 화면 스트림은 새 터미널로 옮겨 붙는다
// - 화면: 프레임 모드 attach(stream.mjs). 판 클라이언트의 키 패드·글은 attach DATA로 바로 넣는다(terminal.keys는 사람 입력 뒤 3초를 기다린다)
// - 끊김: 코어 재시작(server.restart, hc update)이나 강제 종료 뒤 holder가 코어를 다시 띄우는 동안 프로그램은 산다. 그래서 짧은 끊김(GRACE_MS)은
//   disconnected로 알리지 않고 다시 구독해 그새 바뀐 것만 이벤트로 낸다(판의 disconnected는 "서버와 세션이 꺼짐"이라 판이 끊긴 턴으로 표시한다).
//   코어가 터미널을 끝내고 꺼졌으면(서버 끔·holder 잃음) 바로 disconnected를 내고, 다시 붙으면 판이 되살린다(J1)
// - 아는 한계: 터미널 안에서 에이전트가 `hc run`으로 띄운 터미널은 코어 env를 받아 판의 hc 설정 폴더(XDG_CONFIG_HOME)가 샌다(판이 띄우는 터미널만 빈 값으로 덮는다).
//   줄 단위 ANSI 기록이 없다(terminal.history는 색 없는 줄). 승인 규칙과 옛 판 옮기기는 2b 밖
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { hcCall, hcSubscribe, hcPipe, HcError, FramedConn, FRAME } from './rpc.mjs';
import { HcModel, LABEL, paneOf, agentInfoOf, findTerminal, workspaceOf, terminalEnv, keysToBytes, hcName, KIND_COMMAND, isLive, CORE_DOWN, isBoardTerm, TRUST_STATUS, isSynthetic } from './model.mjs';
import { isTrustDialog } from '../screen.mjs'; // P117: 신뢰 대화상자(7501 상태 전)
import { HC_PIN, ensureHc, hcBinDir, hcExeIn, hcRoot } from './pin.mjs';
import { startCore, upgradeCore, hcConfigHome, writeBoardConfig, hcStateDir, hcCompat, cliVersion, coreEnv } from './core.mjs';
import { HcController } from './stream.mjs';
import { InputTrace, inputSummary } from '../input-trace.mjs';
import { registryPath } from '../proc-env.mjs';
import { platformLine } from '../launch.mjs';
import { findExecutable } from '../platform.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const GRACE_MS = 8000; // holder가 코어를 다시 띄우는 데 약 4초(P114 1단계)
const BEAT_MS = 45000; // heartbeat는 15초마다. 세 번 못 받으면 끊긴 것으로 본다
const KEY_GAP_MS = 30; // 키 사이 틈(ESC 다음 키가 Alt 조합으로 읽히지 않게)
const CLOSING_MS = 30000; // 판이 닫는 작업 공간: 이 동안 그 자리에 셸을 다시 띄우지 않는다
const RELEASE_HOLD_MS = 300; // 상태 지움 뒤 터미널 끝(코어 쪽 까닭인지)을 기다리는 시간
// P117: 판이 띄운 claude가 7501을 말하기 전에 화면을 보는 동안과 간격. 신뢰 대화상자는 뜨자마자(1~3초) 보이므로 이 안에 못 보면 그만 본다
const TRUST_WATCH_MS = 30000;
const TRUST_POLL_MS = 600;

// 서버 PID 대신 쓸 값: 터미널을 쥔 holder 가운데 가장 오래된 것(터미널이 있는 것). holder는 코어 재시작·업데이트 뒤에도 같고,
// 바뀌면 프로그램이 끝난 것이다(서버 끔·holder 잃음). 판은 이 값이 바뀌었는지로 "백엔드가 꺼진 동안 터미널 서버가 다시 떴는가"를 본다(C3)
export function holderIdentity(status) {
  const hs = (status && status.holders) || [];
  const withTerms = hs.filter((h) => h.terminals > 0).sort((a, b) => a.pid - b.pid);
  const pick = withTerms[0] || hs.find((h) => h.current) || null;
  return pick ? pick.pid : null;
}

// macOS 셸 준비: 화면의 어느 줄이 프롬프트 글자($ # % ❯ › >)로 끝나면 준비로 본다(v0.4 herdr 판과 같은 규칙. 오른쪽 프롬프트·두 줄 프롬프트도 한 줄은 걸린다)
export const posixPromptReady = (text) => /[$#%❯›>][ \t]*$/m.test(String(text || '').replace(/\r/g, ''));

export class HcAdapter extends EventEmitter {
  constructor({ session, dataDir, logDir, hcPath = null, pipe = null, pin = HC_PIN, env = process.env, fetchImpl, bundled = null, graceMs = GRACE_MS, tested = [HC_PIN.version], moveWaitMs = 3000, trustWatchMs = TRUST_WATCH_MS, trustPollMs = TRUST_POLL_MS }) {
    super();
    if (!session || session === 'default') throw new Error('이름이 지정된 터미널 세션만 사용할 수 있습니다.');
    this.backend = 'hc';
    this.session = session; this.dataDir = dataDir; this.logDir = logDir; this.pin = pin; this.env = env; this.fetchImpl = fetchImpl;
    this.envExe = hcPath; // ATRIUM_HC
    this.bundled = bundled; // macOS: 앱 번들에 든 고정 tar.gz(있으면 받지 않는다)
    this.exe = hcPath || (dataDir ? hcExeIn(hcBinDir(dataDir)) : null);
    this.exeDir = this.exe ? path.dirname(this.exe) : null;
    this.configHome = dataDir ? hcConfigHome(dataDir) : null;
    this.pipe = pipe || hcPipe(session, process.platform === 'win32' ? env : {}, { root: dataDir ? hcRoot(dataDir) : null }); // macOS: 판이 정한 소켓(사용자 HC_SOCKET은 쓰지 않는다)
    this.graceMs = graceMs; this.moveWaitMs = moveWaitMs; this.policy = { generations: [pin.generation], tested };
    this.connected = false; this.pong = null; this._corePid = null; this._holderPid = null;
    this.model = new HcModel();
    this._watching = false; this._sub = null;
    this._ctls = new Map(); // paneId → Set(HcController)
    this._held = new Map(); // 판이 바꿔 띄우는 중인 터미널의 이벤트(launch 라벨 → 이벤트들)
    this._replaced = new Set(); // 판이 다른 터미널로 바꾼 자리(그 끝 이벤트는 내지 않는다)
    this._closing = new Set(); // 판이 닫는 패널
    this._closingWs = new Map(); // 판이 닫는 작업 공간 → 시각
    this._respawning = new Map(); // 셸을 다시 띄우는 중인 자리 → Promise<새 주소|null>
    this._envOf = new Map(); // 판이 띄운 터미널의 env(셸을 다시 띄울 때 같은 env)
    this._extraOf = new Map(); // 판이 그 터미널에 더한 env(계정·hook 등). startAgent가 env 없이 불리면 이것을 물려준다(herdr 셸의 env를 물려받던 것과 같게)
    this._movedTo = new Map(); // P117: 판이 바꿔 띄운 자리(옛 주소 → 새 주소). 같은 패널을 부르는 판의 흐름(passGate 등)이 새 자리를 따라간다
    this._trustWatch = new Map(); // P117: 신뢰 대화상자를 보는 터미널 → 타이머
    this.trustWatchMs = trustWatchMs; this.trustPollMs = trustPollMs;
    this.subscribedPanes = [];
    this.trace = new InputTrace({ log: (m) => this.log(m) }); // P136: 패널마다 최근 입력·초점·크기·모드·기록 읽기(값만). 입력 칸에 마우스 보고 글이 보이면 로그에 남긴다
  }
  // 판이 진단에 보이는 hc 실행 파일 경로
  get exePath() { return this.exe; }

  call(method, params = {}, timeoutMs = 15000) { return hcCall(this.pipe, method, params, timeoutMs); }
  log(m) { this.emit('log', m); }

  // ---------- 코어 ----------
  async ping() { return this.call('hello', { generation: this.pin.generation }, 3000); }
  async probe() {
    try {
      const h = await this.ping();
      const st = await this.call('server.status', {}, 3000).catch(() => null);
      if (st) { this._corePid = st.pid; this._holderPid = holderIdentity(st); }
      return { running: true, pong: { type: 'pong', version: h.version, protocol: h.generation, capabilities: { features: h.features || [], core: h.core || null } }, status: st };
    } catch (e) { return { running: false, error: e.code }; }
  }
  checkCompat(pong) { return hcCompat(pong, this.policy); }
  async cliVersion() { return this.exe ? cliVersion({ exe: this.exe, session: this.session, configHome: this.configHome, base: this.env }) : null; }
  // holder 기준(holderIdentity). 코어는 떠 있는데 holder가 없으면(터미널이 없음) -1, 코어를 모르면 null.
  // 코어 PID를 쓰지 않는다: 코어는 server.restart·hc update·holder의 다시 띄우기로 바뀌어도 프로그램이 산다(판이 "다시 떴다"로 잘못 본다, 2b 끝 시험)
  serverPid() { return this._holderPid || (this._corePid ? -1 : null); }
  // 터미널이 생기거나 끝나면 holder가 생기거나 바뀔 수 있다. 잠깐 뒤 다시 읽는다(판은 heartbeat 때 이 값을 저장한다)
  _refreshHolderSoon() {
    clearTimeout(this._holderTimer);
    this._holderTimer = setTimeout(() => this.call('server.status', {}, 3000).then((st) => { this._corePid = st.pid; this._holderPid = holderIdentity(st); }).catch(() => {}), 500);
    if (this._holderTimer.unref) this._holderTimer.unref();
  }

  // 고정한 hc를 판 폴더에 준비한다(없으면 받는다). 코어가 다른 버전으로 돌면 바꾸지 않고 pending을 남긴다(upgrade가 바꾼다)
  async ensureBinary({ coreRunning = false } = {}) {
    const r = await ensureHc({ dataDir: this.dataDir, pin: this.pin, envExe: this.envExe, coreRunning, fetchImpl: this.fetchImpl, bundled: this.bundled, log: (m) => this.log(m) });
    this.exe = r.exe; this.exeDir = r.dir; this.binary = r;
    return r;
  }
  async startServer() {
    const p0 = await this.probe();
    if (p0.running) return { started: false, pong: p0.pong, pid: this.serverPid() };
    const t0 = Date.now();
    try { await this.ensureBinary(); } catch (e) { throw new HcError(e.code || 'not_found', e.message, 'server'); }
    writeBoardConfig(this.configHome);
    let st;
    try { st = await startCore({ exe: this.exe, session: this.session, configHome: this.configHome, base: this.env }); }
    catch (e) { throw new HcError(e.code || 'start_failed', e.message, 'server'); }
    for (let i = 0; i < 100; i++) {
      const p = await this.probe();
      if (p.running) return { started: true, pong: p.pong, pid: this.serverPid() || st.pid, ms: Date.now() - t0 };
      await sleep(100);
    }
    throw new HcError('start_failed', 'core did not answer hello in 10s', 'server');
  }
  // 프로그램도 끈다. 판은 사람이 고른 "터미널 모두 끄기"(트레이·terminal.stop)에서만 부른다
  async stopServer() {
    let out = '';
    try { out = JSON.stringify(await this.call('server.stop', {}, 15000)); } catch (e) { out = e.message; }
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) { if (!(await this.probe()).running) return { stopped: true, out }; await sleep(100); }
    return { stopped: false, out };
  }
  // 코어만 다시 띄운다(프로그램은 산다). fresh면 판이 만든 env로(새 PATH 등)
  async restartServer({ fresh = false } = {}) {
    if (this.configHome) writeBoardConfig(this.configHome);
    const params = fresh ? { environment: coreEnv(this.env, { session: this.session, configHome: this.configHome }) } : {};
    const r = await this.call('server.restart', params, 30000).catch((e) => ({ error: e.message }));
    for (let i = 0; i < 100; i++) { await sleep(100); const p = await this.probe(); if (p.running) return { restarted: !r.error, pid: this._corePid, result: r }; }
    return { restarted: false, result: r };
  }
  // 고정 버전이 바뀌었으면 새 빌드를 받아 hc update로 바꾼다(코어만 다시 뜬다). 놓인 파일은 고정 버전인데 코어만 옛 버전이면 코어를 다시 띄운다
  async upgrade() {
    const p = await this.probe();
    const r = await this.ensureBinary({ coreRunning: p.running });
    if (r.source === 'pending') {
      const from = hcExeIn(r.pending.dir);
      const u = await upgradeCore({ exe: this.exe, from, session: this.session, configHome: this.configHome, base: this.env });
      fs.writeFileSync(path.join(this.exeDir, 'VERSION'), this.pin.version + '\n');
      fs.rmSync(r.pending.staging, { recursive: true, force: true });
      return { upgraded: true, from: r.version, to: this.pin.version, result: u };
    }
    if (p.running && p.pong && p.pong.version !== this.pin.version && r.version === this.pin.version && r.source !== 'env') {
      const x = await this.restartServer();
      return { upgraded: true, from: p.pong.version, to: this.pin.version, restarted: x };
    }
    return { upgraded: false, version: r.version, source: r.source };
  }
  async _maybeUpgrade() {
    if (this._upgradeChecked || !this.dataDir || this.envExe) return;
    this._upgradeChecked = true;
    const p = await this.probe();
    if (!p.running || !p.pong || p.pong.version === this.pin.version) return;
    try { const r = await this.upgrade(); this.log(`hc upgrade on start: ${JSON.stringify(r).slice(0, 300)}`); this.emit('upgraded', r); }
    catch (e) { this.log(`hc upgrade on start failed: ${e.code || ''} ${e.message}`); }
  }
  async deleteSession() {
    if ((await this.probe()).running) return { deleted: false, reason: 'running' };
    const dir = hcStateDir(this.session, this.env);
    fs.rmSync(dir, { recursive: true, force: true });
    return { deleted: !fs.existsSync(dir), out: dir };
  }
  exists() { return fs.existsSync(hcStateDir(this.session, this.env)); }

  // ---------- 이벤트 ----------
  startEvents() { this._watching = true; this._connectLoop(); }
  stopEvents() { this._watching = false; if (this._sub) this._sub.close(); this._sub = null; clearInterval(this._beatTimer); for (const t of this._trustWatch.values()) clearTimeout(t); this._trustWatch.clear(); }
  async refreshSubscription() {} // hc 구독은 터미널을 거르지 않는다(모든 터미널의 이벤트가 온다)

  async _connectLoop() {
    if (this._looping) return;
    this._looping = true;
    let downSince = null;
    try {
      while (this._watching) {
        let closed = null;
        try { ({ closed } = await this._subscribe()); } catch (e) { this.log(`subscribe failed: ${e.code || e.message}`); }
        if (closed) {
          downSince = null;
          if (!this.connected) { this.connected = true; this.emit('connected', this.pong); }
          this._maybeUpgrade().catch(() => {}); // 2b: 떠 있던 코어가 고정 버전과 다르면 올린다(한 번)
          await closed; // 구독이 끊길 때까지
          if (!this._watching) break;
          this.log('event subscription closed');
          // 코어가 터미널을 끝내고 꺼졌다(서버 끔 등): 짧은 끊김이 아니다. 바로 알린다(판이 끊긴 턴을 표시하고 다시 붙으면 되살린다)
          if (this._coreDown && this.connected) { this._coreDown = false; this.connected = false; this.emit('disconnected'); }
        }
        downSince ||= Date.now();
        if (this.connected && Date.now() - downSince > this.graceMs) { this.connected = false; this.emit('disconnected'); }
        await sleep(this.connected ? 300 : 1000);
      }
    } finally { this._looping = false; }
  }
  // 구독 하나를 연다. 처음(끊긴 뒤 포함)은 조용히 싣고, 짧은 끊김 뒤에는 그새 바뀐 것을 이벤트로 낸다 → { closed: 구독이 끝날 때 풀리는 Promise }
  // (Promise를 그대로 돌려주면 async 함수의 await가 그것까지 기다린다)
  async _subscribe() {
    const p = await this.probe();
    if (!p.running) throw new HcError('unreachable', p.error || 'core not running', 'events.subscribe');
    this.pong = p.pong;
    let onClose;
    const closed = new Promise((r) => { onClose = r; });
    this._lastBeat = Date.now();
    const sub = hcSubscribe(this.pipe, {}, { onMessage: (m) => this._message(m), onClose: () => onClose() });
    const snap = await sub.ready;
    const terms = snap.terminals || [];
    if (this.connected) {
      // 짧은 끊김 뒤: 그새 코어가 터미널을 끝냈으면(서버 끔·재부팅·holder 잃음) 서버가 꺼졌다 뜬 것과 같다. 끊김과 붙음으로 알린다
      const nowLive = new Set(terms.filter(isLive).map((t) => t.address));
      const gone = this.model.live().filter((t) => !nowLive.has(t.address)).map((t) => t.address);
      let down = !!this._coreDown;
      if (!down && gone.length) down = (await this._list(true).catch(() => [])).some((t) => gone.includes(t.address) && CORE_DOWN.has(t.reason));
      if (down) { this._coreDown = false; this.connected = false; this.log('core ended terminals while away; reporting a restart'); this.emit('disconnected'); this.model.load(terms); this._gcFinished().catch(() => {}); }
      else this._emitAll(this.model.diff(terms));
    } else { this._coreDown = false; this.model.load(terms); this._gcFinished().catch(() => {}); await this._scanTrust(); }
    this._sub = sub;
    this.subscribedPanes = this.model.live().map((t) => t.address);
    clearInterval(this._beatTimer);
    this._beatTimer = setInterval(() => { if (Date.now() - this._lastBeat > BEAT_MS) { this.log('no heartbeat; resubscribing'); sub.close(); } }, 5000);
    if (this._beatTimer.unref) this._beatTimer.unref();
    return { closed };
  }
  _message(m) {
    this._lastBeat = Date.now();
    if (m.method === 'event') this._emitAll(this.model.apply(m.params));
    else if (m.method === 'missed') { this.log('events missed; applying fresh snapshot'); this._emitAll(this.model.diff((m.params && m.params.terminals) || [])); }
  }
  _emitAll(events) {
    for (const e of events) {
      if (e.type === 'terminal_finished' && CORE_DOWN.has(e.reason)) this._coreDown = true;
      if (e.type === 'pane_created' || e.type === 'terminal_finished') this._refreshHolderSoon();
      // 2b: hc는 터미널을 끝내기 바로 앞에 상태를 지운다(status null). 그 놓임을 잠깐 들고 있다가, 코어 쪽 까닭(서버 끔·holder 잃음)의 끝이 따라오면 버린다.
      // 그러지 않으면 판 밖에서 코어를 껐을 때 판이 claude를 "스스로 끝남"으로 보고 되살리지 않는다(서버가 꺼지면 끊김만 와야 한다)
      if (e.type === 'agent_released' && e.raw && e.raw.type === 'status' && e.paneId) { this._holdRelease(e); continue; }
      // macOS 판: 들고 있던 놓임 뒤에 같은 터미널에 에이전트가 다시 나타나면(Claude Code가 업데이트·신뢰 수락 뒤 스스로 다시 뜸) 그 놓임은 버린다.
      // 버리지 않으면 300ms 뒤 옛 놓임이 새로 알아본 세션을 끝남으로 바꿨다(2026-11-19 StockC lead: detected 39.200 → released 39.355)
      if (e.type === 'agent_detected' && e.paneId && this._releases && this._releases.has(e.paneId)) this._dropRelease(e.paneId);
      if (e.paneId && this._releases && this._releases.has(e.paneId)) {
        if (e.type === 'terminal_finished' && CORE_DOWN.has(e.reason)) this._dropRelease(e.paneId);
        else if (e.type === 'pane_exited' || e.type === 'terminal_finished') this._flushRelease(e.paneId, e.exitCode); // P125: 끝난 프로그램의 종료 코드를 놓임에 붙인다(사람이 끝냄·오류 가르기)
      }
      if (e.type === 'size' && e.paneId) this.trace.note(e.paneId, 'size', { cols: e.cols, rows: e.rows }); // P136: 아무도 보지 않으면 hc가 200x120으로 되돌린다
      if (e.type === 'status' && e.paneId) this.trace.note(e.paneId, 'status', { s: e.status });
      // 화면 스트림에 넘길 것
      const set = e.paneId && this._ctls.get(e.paneId);
      if (set && ['size', 'pane_restarted', 'terminal_finished', 'pane_closed'].includes(e.type)) for (const c of [...set]) c.onTerminalEvent(e);
      // 판이 바꿔 띄우는 중인 터미널: 판이 pane_moved로 알기 전에는 내지 않는다(모르는 패널로 보고 판에 올리지 않게)
      const t = e.paneId && this.model.terms.get(e.paneId);
      const launch = t && t.labels && t.labels[LABEL.launch];
      if (launch && this._held.has(launch)) { this._held.get(launch).push(e); continue; }
      if (e.paneId && this._replaced.has(e.paneId) && ['pane_exited', 'terminal_finished', 'pane_closed', 'agent_released'].includes(e.type)) continue;
      // 2b: 판이 띄운 에이전트가 스스로 끝났다 → 같은 자리에 셸(남는 패널 셸). 판이 닫는 중이면 그대로 패널 끝
      if (e.type === 'pane_exited' && e.agent && e.board && e.reason === 'exited' && !this._isClosing(e.paneId, e.workspaceId)) { this._respawnShell(e); continue; }
      if (['size', 'pane_restarted', 'pane_lost', 'turn', 'terminal_finished'].includes(e.type)) { this.emit('hc', e); continue; } // 판이 모르는 것(hc 이벤트로 따로 넘긴다)
      this.emit('event', e);
    }
  }
  _holdRelease(e) {
    this._releases ||= new Map();
    this._flushRelease(e.paneId);
    const timer = setTimeout(() => this._flushRelease(e.paneId), RELEASE_HOLD_MS);
    if (timer.unref) timer.unref();
    this._releases.set(e.paneId, { e, timer });
  }
  _flushRelease(paneId, exitCode) {
    const r = this._releases && this._releases.get(paneId);
    if (!r) return;
    clearTimeout(r.timer); this._releases.delete(paneId);
    const e = exitCode != null ? { ...r.e, exitCode } : r.e;
    if (this._replaced.has(paneId)) return;
    this.emit('event', e);
  }
  _dropRelease(paneId) { const r = this._releases.get(paneId); clearTimeout(r.timer); this._releases.delete(paneId); }
  _isClosing(paneId, ws) {
    if (this._closing.has(paneId)) return true;
    const at = ws && this._closingWs.get(ws);
    return !!(at && Date.now() - at < CLOSING_MS);
  }

  // ---------- 작업 공간, 패널, 에이전트 ----------
  // P117: 코어의 목록에 흉내 낸 신뢰 상태(model)를 얹는다. 판의 getPane·listAgents·snapshot이 신뢰 대화상자 중인 claude를 에이전트로 본다
  async _list(all = false) {
    const list = (await this.call('terminal.list', all ? { all: true } : {})).terminals || [];
    return list.map((t) => this._overlay(t));
  }
  _overlay(t) { const m = t && !t.status && isLive(t) && this.model.terms.get(t.address); return m && isSynthetic(m.status) ? { ...t, status: m.status } : t; }
  _byAddress(list) { return new Map(list.map((t) => [t.address, t])); }
  async snapshot() {
    const list = await this._list();
    const by = this._byAddress(list);
    const live = list.filter(isLive);
    const panes = live.map((t) => { const p = paneOf(t, by); return { paneId: p.paneId, workspaceId: p.workspaceId, agent: p.agent, status: p.status }; });
    const ws = [...new Set(panes.map((p) => p.workspaceId))].map((w) => { const t = live.find((x) => workspaceOf(x, by) === w); return { workspaceId: w, label: (t && t.labels && t.labels[LABEL.wsLabel]) || null }; });
    return { workspaces: ws, panes };
  }
  // 판이 띄우는 터미널의 env: extra(판의 env, 하네스 env) + PATH(pathFirst, 판의 hc 폴더, 레지스트리 PATH) + XDG_CONFIG_HOME 빈 값. P114 2a·2b 관리자 결정
  async paneEnv(extra = {}, pathFirst = []) {
    const reg = await registryPath().catch(() => null);
    const base = reg || this.env[Object.keys(this.env).find((k) => k.toUpperCase() === 'PATH')] || '';
    return terminalEnv({ exeDir: this.exeDir, basePath: base, extra, pathFirst });
  }
  // 셸 터미널 하나 = 판의 작업 공간 하나. 판이 만든 터미널이라 atrium-board 라벨
  async createWorkspace({ cwd, label, env = {} }) {
    const ws = `hw-${crypto.randomBytes(5).toString('hex')}`;
    const labels = { [LABEL.ws]: ws, [LABEL.board]: '1' };
    if (label) labels[LABEL.wsLabel] = String(label).slice(0, 120);
    const tenv = await this.paneEnv(env);
    const r = await this.call('terminal.run', { cwd, env: tenv, labels, no_parent: true }, 30000);
    this._envOf.set(r.address, tenv);
    if (env && Object.keys(env).length) this._extraOf.set(r.address, { ...env });
    return { workspaceId: ws, paneId: r.address };
  }
  // hc가 바라는 띄우기: 에이전트를 터미널의 첫 argv로(셸에 치면 foreground가 셸로 남고, 강제로 끝나면 상태가 남는다. P114 1단계 3번)
  async runAgent({ name = null, argv, cwd, env = {}, pathFirst = [], labels = {}, workspaceId = null, kind = null }) {
    const lab = { ...labels, [LABEL.board]: '1' };
    if (workspaceId) lab[LABEL.ws] = workspaceId;
    if (name) lab[LABEL.name] = String(name);
    if (kind) lab[LABEL.agent] = String(kind); // P117: 7501을 말하기 전에도 에이전트 자리(신뢰 대화상자에서 끝나면 셸이 남는다)
    const tenv = await this.paneEnv(env, pathFirst);
    const params = { argv, cwd, env: tenv, labels: lab, no_parent: true };
    const n = hcName(name);
    if (n) { params.name = n; await this._gcFinished(n).catch(() => {}); } // 같은 이름의 끝난 기록(되살리기·이어 가기 전의 것)을 지운다
    const r = await this.call('terminal.run', params, 60000);
    this._envOf.set(r.address, tenv);
    if (env && Object.keys(env).length) this._extraOf.set(r.address, { ...env });
    if (kind === 'claude') this._watchTrust(r.address);
    return r;
  }
  // P117: 판이 띄운 claude가 7501을 말하기 전에 화면을 본다. 신뢰 대화상자("Quick safety check … trust this folder")가 보이면 막힘(blocked)을 흉내 낸다.
  // 판은 그 뒤 화면을 읽어 trust_wait로 보이고(checkBlocked), 첫 지시는 기다린다(전달 규칙). 사람이 신뢰하면 claude가 7501 idle을 말해 풀리고,
  // 거절하면 claude가 끝나 에이전트가 떠난 것으로(trust_declined) 보이고 같은 자리에 셸이 남는다(_respawnShell). 신뢰는 사람만 답한다(판은 키를 보내지 않는다)
  _watchTrust(address, t0 = Date.now()) {
    clearTimeout(this._trustWatch.get(address));
    const tick = async () => {
      this._trustWatch.delete(address);
      const m = this.model.terms.get(address);
      if (m && (!isLive(m) || (m.status && !isSynthetic(m.status)))) return; // 끝났거나 7501을 말했다
      if (m && isSynthetic(m.status)) return; // 이미 막힘으로 알렸다(풀림은 7501 또는 끝남이 알린다)
      if (Date.now() - t0 > this.trustWatchMs) return;
      let text = '';
      try { text = String((await this.call('terminal.read', { terminal: address, lines: 0 }, 5000)).text || ''); } catch (e) { if (e.code === 'agent_not_found' || e.code === 'pane_not_found') return; }
      const now = this.model.terms.get(address);
      if (now && isLive(now) && !now.status && isTrustDialog(text)) {
        this.log(`trust dialog in ${address}: reporting blocked (no 7501 status yet)`);
        this._emitAll(this.model.apply({ seq: null, type: 'status', terminal: address, data: { status: { ...TRUST_STATUS }, reported: false } }));
        return;
      }
      const timer = setTimeout(tick, this.trustPollMs);
      if (timer.unref) timer.unref();
      this._trustWatch.set(address, timer);
    };
    const timer = setTimeout(tick, this.trustPollMs);
    if (timer.unref) timer.unref();
    this._trustWatch.set(address, timer);
  }
  follow(paneId) { return this._follow(paneId); } // P117: 라우터·옮기기가 쓴다
  // 판이 바꿔 띄운 자리를 끝까지 따라간 주소(기다리지 않는다). 판의 "같은 패널인가" 확인이 쓴다(startAgent·셸 남기기는 주소를 바꾼다)
  latest(paneId) { let id = paneId; for (let i = 0; i < 16 && id; i++) { const nx = this._movedTo.get(id); if (!nx) break; id = nx; } return id; }
  // P117: 처음 붙을 때(백엔드가 다시 뜸) 판이 띄운 claude가 7501 없이 살아 있으면 신뢰 질문 중일 수 있다. connected를 내기 전에 화면을 한 번 보고
  // 신뢰 질문이면 막힘을 흉내 낸 상태로 싣는다(판이 다시 맞출 때 "에이전트 없음"으로 보고 끝남으로 두지 않게). 아니면 지켜보기만 한다
  async _scanTrust() {
    for (const t of this.model.live()) {
      if (t.status || !t.labels || t.labels[LABEL.agent] !== 'claude') continue;
      let text = '';
      try { text = String((await this.call('terminal.read', { terminal: t.address, lines: 0 }, 5000)).text || ''); } catch {}
      if (isTrustDialog(text)) { this.model.terms.set(t.address, { ...t, status: { ...TRUST_STATUS } }); this.model.everAgent.add(t.address); this.log(`trust dialog in ${t.address} on connect: reporting blocked`); }
      else this._watchTrust(t.address);
    }
  }
  // P117: 판이 부른 패널이 이미 다른 터미널로 바뀌었으면(에이전트가 끝나 셸이 남음 등) 그 자리를 따라간다. 셸을 띄우는 중이면 기다린다
  async _follow(paneId) {
    let id = paneId;
    for (let i = 0; i < 8 && id; i++) {
      const pending = this._respawning.get(id);
      if (pending) { const nw = await pending.catch(() => null); if (!nw) return id; id = nw; continue; }
      const nx = this._movedTo.get(id);
      if (!nx) return id;
      id = nx;
    }
    return id;
  }
  async waitShellReady(paneId, timeoutMs = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const at = await this._follow(paneId); // P117: 그새 셸 자리로 바뀌었으면 새 자리를 본다
      const t = await this.readScreen(at, { source: 'visible' }).catch((e) => (e.code === 'unreachable' ? Promise.reject(e) : ''));
      if (process.platform === 'win32' ? /PS [^\n]*>/.test(t) : posixPromptReady(t)) return true;
      await sleep(200);
    }
    return false;
  }
  // 판의 패널(paneId)을 새 터미널로 바꾼다: 새 터미널의 이벤트는 pane_moved를 낸 뒤에 넘기고, 화면 스트림을 옮겨 붙이고, 옛 자리의 끝 이벤트는 내지 않는다
  async _replacePane(oldId, run, why, extra = {}) { // P125: extra는 pane_moved에 더한다(셸을 남길 때 끝난 에이전트의 종료 코드)
    const launch = crypto.randomBytes(6).toString('hex');
    this._held.set(launch, []);
    let r;
    try { r = await run(launch); } catch (e) { this._held.delete(launch); throw e; }
    const ws = (r.labels && r.labels[LABEL.ws]) || null;
    this._replaced.add(oldId);
    this._movedTo.set(oldId, r.address);
    this._moveControllers(oldId, r.address);
    this.emit('event', { type: 'pane_moved', paneId: r.address, workspaceId: ws, previousPaneId: oldId, ...extra, raw: { hc: why } });
    const held = this._held.get(launch) || [];
    this._held.delete(launch);
    for (const e of held) if (e.type !== 'pane_created') this.emit('event', e);
    return r;
  }
  _moveControllers(oldId, newId) {
    const set = this._ctls.get(oldId);
    if (!set) return;
    this._ctls.delete(oldId);
    const to = this._ctls.get(newId) || new Set();
    for (const c of set) if (c.retarget(newId)) to.add(c);
    if (to.size) this._ctls.set(newId, to);
  }
  // 에이전트 띄우기(판의 세션 시작, 이어 가기, 되살리기): 그 패널을 에이전트가 첫 argv인 터미널로 바꾼다. env·pathFirst는 하네스(harnessLaunch)가 준 값.
  // 옛 자리가 같은 hc 이름을 쥔 에이전트면 먼저 끈다(hc 이름은 살아 있는 터미널 사이에서 겹치지 않는다. 끝난 기록은 막지 않는다)
  async startAgent({ name, paneId: asked, args = [], kind = 'claude', command = null, env = null, pathFirst = null }) {
    const paneId = await this._follow(asked); // P117: 그새 셸 자리로 바뀐 패널(passGate의 /exit 뒤 등)
    let t = null;
    try { t = await this.call('terminal.get', { terminal: paneId }); } catch (e) { if (e.code === 'unreachable') throw e; }
    const by = this.model.terms.size ? this.model.terms : this._byAddress(t ? [t] : []);
    const ws = t ? workspaceOf(t, by) : `hw-${crypto.randomBytes(5).toString('hex')}`;
    const argv = [...(command && command.length ? command : [KIND_COMMAND[kind] || kind]), ...args];
    const n = hcName(name);
    const baseLabels = Object.fromEntries(Object.entries((t && t.labels) || {}).filter(([k]) => k !== LABEL.launch && k !== LABEL.name && k !== LABEL.agent));
    if (t && isLive(t) && n && t.name === n) { this._replaced.add(paneId); await this._kill(paneId); }
    const cwd = (t && t.cwd) || undefined;
    const inherited = env || this._extraOf.get(paneId) || null; // env 없이 부르면 그 자리에 판이 더했던 env(계정 폴더, hook)를 물려준다
    const r = await this._replacePane(paneId, (launch) => this.runAgent({ name, argv, cwd, env: inherited || {}, pathFirst: pathFirst || [], labels: { ...baseLabels, [LABEL.launch]: launch }, workspaceId: ws, kind }), 'startAgent');
    await this._kill(paneId).catch(() => {}); await this._rm(paneId);
    this._envOf.delete(paneId); this._extraOf.delete(paneId);
    const info = { name: name || r.name || r.address, paneId: r.address, workspaceId: ws, agent: kind, status: 'unknown', launchPending: true, agentSessionId: null, title: '', cwd: r.cwd || cwd || null, tabId: null };
    return { agent: info, argv: r.argv || argv, replacedPane: paneId };
  }
  // 판이 띄운 에이전트가 스스로 끝났다: 같은 작업 공간·폴더·라벨로 셸을 띄워 그 자리를 잇는다. 판이 그새 닫으면 새 셸도 닫는다
  _respawnShell(e) {
    const old = e.paneId;
    if (this._respawning.has(old)) return this._respawning.get(old);
    const p = (async () => {
      const t = this.model.terms.get(old) || {};
      const labels = Object.fromEntries(Object.entries(t.labels || {}).filter(([k]) => k !== LABEL.launch && k !== LABEL.name && k !== LABEL.agent));
      labels[LABEL.board] = '1';
      if (e.workspaceId) labels[LABEL.ws] = e.workspaceId;
      try {
        const env = this._envOf.get(old) || (await this.paneEnv());
        const r = await this._replacePane(old, (launch) => this.call('terminal.run', { cwd: t.cwd, env, labels: { ...labels, [LABEL.launch]: launch }, no_parent: true }, 30000), 'agent exited, shell left', e.exitCode != null ? { exitCode: e.exitCode } : {}); // P125: 놓임이 먼저 풀렸어도(300ms) 판이 코드를 받는다
        this._envOf.set(r.address, env); this._envOf.delete(old);
        if (this._extraOf.has(old)) { this._extraOf.set(r.address, this._extraOf.get(old)); this._extraOf.delete(old); }
        await this._rm(old);
        if (this._isClosing(old, e.workspaceId)) { this.log(`closing ${old} while its shell came back; closing ${r.address}`); await this.closePane(r.address).catch(() => {}); }
        return r.address;
      } catch (err) {
        this.log(`shell after agent exit in ${old} failed: ${err.code || ''} ${err.message}`);
        this.emit('event', e); // 셸을 못 띄우면 패널이 닫힌 것과 같게
        return null;
      } finally { this._respawning.delete(old); }
    })();
    this._respawning.set(old, p);
    return p;
  }
  // P97 모양: 셸 프롬프트에 명령을 친다. hc에서는 상태가 셸 안에서 오므로 앱 이름으로 알아본다(판은 startAgent를 쓴다. 남겨 둔 모양)
  async typeAgent({ name, paneId, args, kind, command, timeoutMs = 60000 }) {
    const argv = [...command, ...args];
    await this.sendText(paneId, platformLine(argv));
    await sleep(150);
    await this.paneKeys(paneId, ['enter']);
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const p = await this.getPane(paneId).catch(() => null);
      if (p && p.agent === kind) { if (name) await this.renameAgent(paneId, name); return { agent: await this.getAgent(paneId), argv, typed: true }; }
      await sleep(500);
    }
    throw Object.assign(new HcError('agent_not_detected', `${kind} did not report status in ${paneId} within ${timeoutMs}ms`, 'agent.start'), { argv });
  }
  async getPane(paneId) {
    let t;
    try { t = this._overlay(await this.call('terminal.get', { terminal: paneId })); } catch (e) { if (e.code === 'agent_not_found') e.code = 'pane_not_found'; throw e; }
    if (!isLive(t)) throw new HcError('pane_not_found', `${paneId} is ${t.state}`, 'terminal.get');
    return paneOf(t, this.model.terms.size ? this.model.terms : this._byAddress([t]));
  }
  // 탭 배치는 없다(판이 배치를 쥔다). 덩어리 자동 붙이기(canvas-ops autoDockSplit)는 이 오류를 기록하고 넘어간다
  async paneLayout() { throw new HcError('not_supported', 'hc has no tab layout', 'pane.layout'); }
  async workspacePanes(workspaceId) {
    const list = await this._list();
    const by = this._byAddress(list);
    return list.filter((t) => isLive(t) && workspaceOf(t, by) === workspaceId).map((t) => ({ paneId: t.address, tabId: null, agent: paneOf(t, by).agent }));
  }
  async agentKinds() {
    if (this._kinds) return this._kinds;
    const pathEnv = process.platform === 'win32' ? null : { ...this.env, PATH: (await this.paneEnv().catch(() => ({}))).PATH || this.env.PATH || '' };
    const where = process.platform !== 'win32' ? async (k) => findExecutable(k, { env: pathEnv }) : (k) => new Promise((res) => execFile('where.exe', [k], { encoding: 'utf8', windowsHide: true, timeout: 5000 }, (e, so) => res(e ? null : String(so).split(/\r?\n/)[0].trim() || null)));
    const kinds = Object.keys(KIND_COMMAND);
    const found = await Promise.all(kinds.map(where));
    this._kinds = kinds.map((k, i) => ({ kind: k, installed: !!found[i], path: found[i] }));
    return this._kinds;
  }
  async renameAgent(target, name) {
    const list = await this._list();
    const t = findTerminal(list, target);
    if (!t) throw new HcError('agent_not_found', `no terminal ${target}`, 'agent.rename');
    const r = await this.call('terminal.label', { terminal: t.address, labels: { [LABEL.name]: String(name) } });
    return agentInfoOf({ ...t, labels: r.labels || { ...(t.labels || {}), [LABEL.name]: String(name) } }, this._byAddress(list));
  }
  async getAgent(target) {
    try { const list = await this._list(); const t = findTerminal(list, target); return t ? agentInfoOf(t, this._byAddress(list)) : null; }
    catch (e) { if (e.code === 'unreachable') throw e; return null; }
  }
  async listAgents() { const list = await this._list(); const by = this._byAddress(list); return list.filter(isLive).map((t) => agentInfoOf(t, by)).filter(Boolean); }
  async _target(target) {
    const t = findTerminal(await this._list(), target);
    if (!t) throw new HcError('agent_not_found', `no live terminal ${target}`, 'terminal');
    return t;
  }
  // 판의 전달(B1)이 보낼 때를 정한 뒤 부른다. 판의 규칙을 바꾸지 않는다(2b):
  // - 막힘: 판은 waiting이면 보내지 않는다. 그새 막혔으면 hc가 force 없이 거부하고(agent_blocked) 판은 waiting으로 물러나 풀리면 다시 보낸다
  // - 쓰다 만 글: 판의 hc 설정 draft_wait = 0이라 hc는 조용한 틈(약 3초)만 기다린다. 판의 "3초 안 입력이면 기다린다"와 같다(core.mjs)
  async prompt(target, text) {
    const t = await this._target(target);
    if (!(t.status && t.status.app)) throw new HcError('agent_not_found', `${target} runs no agent (no status report)`, 'terminal.send');
    // P117: 신뢰 대화상자(흉내 낸 막힘). 코어는 모르므로 판이 거부한다(글이 신뢰 질문에 들어가지 않게. 같은 코드 agent_blocked)
    if (isSynthetic(t.status)) throw new HcError('agent_blocked', `${t.address} is waiting for the folder trust answer`, 'terminal.send');
    this.trace.note(t.address, 'send', { chars: String(text).length }); // P136 진단 기록(길이만)
    return this.call('terminal.send', { terminal: t.address, text: String(text).replace(/\r\n?/g, '\n') }, 120000);
  }
  async sendKeys(target, keys) { const t = await this._target(target); return this.paneKeys(t.address, keys); }
  // 글을 Enter 없이 넣는다. 여러 줄이면 bracketed paste로 감싼다
  // person: 사람 입력(DATA)으로 친다(P130: 판이 사람의 쓰다 만 글을 입력 칸에 되돌릴 때만)
  async sendText(paneId, text, { person = false } = {}) {
    const s = String(text);
    return this._typeRaw(paneId, [/\n/.test(s) ? `\x1b[200~${s}\x1b[201~` : s], { person });
  }
  // 키 이름 → 바이트를 attach로 바로(키 패드, 답하기. 판 입력 AUTOMATIC_INPUT). 모르는 키가 있으면 hc의 terminal.keys(조용해질 때까지 기다림)
  async paneKeys(paneId, keys) {
    const bytes = keysToBytes(keys);
    if (!bytes) return this.call('terminal.keys', { terminal: paneId, keys }, 30000);
    return this._typeRaw(paneId, bytes);
  }
  // 붙어 있는 화면 스트림이 있으면 그것으로, 없으면 지금 크기로 잠깐 붙어서 친다(크기를 바꾸지 않는다).
  // P130: 판이 친 키는 AUTOMATIC_INPUT(kind 6)으로 보낸다. hc는 attach DATA를 사람 입력으로 세어, 그 뒤 terminal.send·keys가
  // 약 3초 조용한 틈을 기다렸다(쓰다 만 글을 Ctrl+S로 비킨 뒤 지시가 3초 늦음). kind 6은 세지 않는다. 사람이 판 터미널로 친 키(relay)는 그대로 DATA.
  // person: 판이 사람의 글을 되돌리는 키(backend.mjs draftIo)는 DATA로 친다
  async _typeRaw(paneId, parts, { person = false } = {}) {
    const ctl = [...(this._ctls.get(paneId) || [])].find((c) => c.exited == null && c.conn && c.ch != null && c.terminal === paneId);
    if (ctl) { for (let i = 0; i < parts.length; i++) { if (i) await sleep(KEY_GAP_MS); if (person) ctl.input(parts[i]); else ctl.inputAuto(parts[i]); } return { typed: parts.length, via: 'stream', automatic: !person && !!ctl.autoInput }; }
    this.trace.note(paneId, person ? 'keys_person' : 'keys', { parts: parts.length, ...inputSummary(parts.join('')) }); // P136 진단 기록(값만)
    const t = await this.call('terminal.get', { terminal: paneId });
    if (!isLive(t)) throw new HcError('pane_not_found', `${paneId} is ${t.state}`, 'terminal.attach');
    const conn = new FramedConn(this.pipe);
    try {
      await conn.open();
      const r = await conn.call('terminal.attach', { terminal: paneId, cols: t.cols || 120, rows: t.rows || 40, resumed: true });
      conn.claim(r.channel, (f) => { if (f.kind === FRAME.DATA) { const b = Buffer.alloc(4); b.writeUInt32LE(f.payload.length, 0); conn.write(r.channel, FRAME.CREDIT, b); } });
      const kind = r.automatic_input && !person ? FRAME.AUTOMATIC_INPUT : FRAME.DATA;
      for (let i = 0; i < parts.length; i++) { if (i) await sleep(KEY_GAP_MS); conn.write(r.channel, kind, Buffer.from(parts[i], 'utf8')); }
      await sleep(50);
      conn.write(r.channel, FRAME.CLOSE);
      return { typed: parts.length, via: 'attach', automatic: kind === FRAME.AUTOMATIC_INPUT };
    } finally { setTimeout(() => conn.close(), 100); }
  }
  // 화면 읽기:
  // - visible + ansi(atrium screen): hc는 줄 단위 ANSI 읽기가 없다. 관찰 모드로 잠깐 붙어 받은 첫 화면(ANSI로 그린 지금 화면)을 준다
  // - 그 밖(visible·recent·recent_unwrapped 글, terminal.history의 ansi): terminal.read {lines}. 색 없는 줄이다(hc가 기록을 ANSI 줄로 주지 않는다)
  // - P136: 기록 읽기(lines > 0)는 hc가 전체 화면 앱(Codex·opencode 등)을 휠 보고로 굴려 읽는다(ReadResult how: stitched). 보고가 수백 개(수 KB) 몰려
  //   한 보고가 ESC와 나머지로 갈리면 `[<65;101;61M`(아무도 보지 않아 200x120인 터미널의 가운데)이 입력 칸에 글로 남고, 다음 전달과 함께 제출된다.
  //   그래서 에이전트가 도는 터미널(7501 상태의 앱이 있다)은 scroll: true가 아니면 지금 화면만 읽는다. 셸은 예전대로 기록을 읽는다
  async readScreen(paneId, { source = 'visible', format = 'text', lines, scroll = false } = {}) {
    if (source === 'visible' && format === 'ansi') return this._paint(paneId);
    // P117(P116 인계): hc의 terminal.read는 화면 아래의 빈 줄까지 줄로 센다. 기록(recent·recent_unwrapped)은 끝의 빈 줄을 빼고 n줄을 센다
    // (Codex 화면 답 고르기가 빈 줄 때문에 답을 놓쳤다). 그래서 화면 높이만큼 더 읽고 끝의 빈 줄을 뗀 뒤 자른다
    const agentTerm = source !== 'visible' && !scroll && this.runsAgent(paneId);
    const want = source === 'visible' || agentTerm ? 0 : Math.min(Math.max(Number(lines) || 200, 1) + 200, 10000);
    const t0 = Date.now();
    const r = await this.call('terminal.read', { terminal: paneId, lines: want });
    const text = (r && r.text) || '';
    if (want) this.trace.note(paneId, 'read', { lines: want, how: r && r.how, complete: r && r.complete, ms: Date.now() - t0 }); // P136: 기록 읽기(굴렸는가)
    this.trace.checkScreen(paneId, text, source); // P136: 입력 칸에 마우스 보고 글이 보이면 최근 기록을 로그에 남긴다
    if (source === 'visible') return text;
    const ls = text.split('\n');
    while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
    return (lines ? ls.slice(-Number(lines)) : ls).join('\n');
  }
  // P136: 이 터미널에서 에이전트(7501 상태의 앱)가 도는가. 판이 띄운 에이전트와 셸 안에서 띄운 에이전트 모두
  runsAgent(paneId) { const t = this.model.terms.get(paneId); return !!(t && t.status && t.status.app); }
  async _paint(paneId, { quietMs = 150, maxMs = 3000 } = {}) {
    const t = await this.call('terminal.get', { terminal: paneId });
    if (!isLive(t)) return '';
    const conn = new FramedConn(this.pipe);
    const parts = [];
    try {
      await conn.open();
      const r = await conn.call('terminal.attach', { terminal: paneId, cols: t.cols || 120, rows: t.rows || 40, observe: true });
      let last = Date.now();
      conn.claim(r.channel, (f) => { if (f.kind === FRAME.DATA) { parts.push(f.payload); last = Date.now(); const b = Buffer.alloc(4); b.writeUInt32LE(f.payload.length, 0); conn.write(r.channel, FRAME.CREDIT, b); } });
      const t0 = Date.now();
      while (Date.now() - t0 < maxMs && (!parts.length || Date.now() - last < quietMs)) await sleep(30);
      conn.write(r.channel, FRAME.CLOSE);
    } finally { setTimeout(() => conn.close(), 50); }
    return Buffer.concat(parts).toString('utf8').replace(/^\x18/, '');
  }
  async closeWorkspace(workspaceId) {
    this._closingWs.set(workspaceId, Date.now());
    for (const [k, at] of this._closingWs) if (Date.now() - at > CLOSING_MS) this._closingWs.delete(k);
    await Promise.all([...this._respawning.values()]).catch(() => {}); // 그새 셸을 다시 띄우는 자리가 있으면 그것까지 닫는다
    const panes = await this.workspacePanes(workspaceId);
    for (const p of panes) await this.closePane(p.paneId);
    return { closed: panes.length };
  }
  // 끝내고 기록도 지운다(패널을 닫으면 없어지게). 셸을 다시 띄우는 중인 자리면 그것도 닫는다
  async closePane(paneId) {
    this._closing.add(paneId);
    try {
      const pending = this._respawning.get(paneId);
      if (pending) { const nw = await pending.catch(() => null); if (nw) await this.closePane(nw); }
      await this._kill(paneId);
      await this._rm(paneId);
      this._envOf.delete(paneId); this._extraOf.delete(paneId);
      return { closed: true };
    } finally { setTimeout(() => this._closing.delete(paneId), CLOSING_MS).unref?.(); }
  }
  // 판이 만든 터미널 가운데 끝난 기록을 지운다(name을 주면 그 이름만). 코어가 꺼져 끝난 기록도 판이 다시 붙은 뒤에는 쓸 데가 없다.
  // 같은 이름 기록이 쌓이지 않게(hc는 끝난 기록이 이름을 막지는 않지만 `hc read <이름>`·목록에 남는다). 판 밖 터미널(hc run)의 기록은 둔다
  async _gcFinished(name = null) {
    const all = await this._list(true);
    for (const t of all) if (!isLive(t) && isBoardTerm(t) && (!name || t.name === name)) await this._rm(t.address);
  }
  async _kill(paneId) { try { await this.call('terminal.kill', { terminal: paneId }, 20000); } catch (e) { if (e.code === 'unreachable' || e.code === 'timeout') throw e; } }
  async _rm(paneId) { try { await this.call('terminal.rm', { terminal: paneId }, 10000); } catch {} }
  // 되살리기가 판의 줄인지 볼 argv(recall.mjs recoverHarness): foreground(셸에 친 경우)와 터미널의 첫 argv(.cmd 감싸개면 foreground가 cmd.exe라 이쪽에 있다)
  async processInfo(paneId) {
    const t = await this.call('terminal.get', { terminal: paneId });
    const f = t.foreground;
    const procs = [];
    if (f) procs.push({ pid: f.pid, name: f.name, argv: f.argv || [] });
    if (t.pid && (!f || f.pid !== t.pid)) procs.push({ pid: t.pid, name: path.basename(String((t.argv || [])[0] || '')), argv: t.argv || [] });
    else if (f && t.argv && t.argv.length) procs[0].argv = [...new Set([...(f.argv || []), ...t.argv])];
    return { shell_pid: t.pid || null, foreground_processes: procs, cwd: (f && f.cwd) || t.cwd };
  }
  // hc에는 붙은 보는 이 목록이 없다(D3). 판 밖 보는 이가 크기를 가져가면 화면 스트림의 size(external)로 안다
  readClients() { return { available: false, clients: [] }; }

  // ---------- 화면 제어기 ----------
  openController(paneId, cols, rows) {
    const c = new HcController({ pipe: this.pipe, terminal: paneId, cols, rows, log: (m) => this.log(m), moveWaitMs: this.moveWaitMs });
    // P136: 판 클라이언트가 이 스트림으로 넣은 입력·초점·크기와 프로그램의 모드 바뀜을 진단 기록에 값만 남긴다(input-trace.mjs)
    const tr = this.trace;
    tr.note(paneId, 'attach', { cols, rows });
    const wrap = (name, kind, val) => { const f = c[name].bind(c); c[name] = (...a) => { tr.note(c.terminal, kind, val(...a)); return f(...a); }; };
    wrap('input', 'input', (s) => inputSummary(s));
    wrap('inputAuto', 'auto', (s) => inputSummary(s));
    wrap('focus', 'focus', (on) => ({ on: !!on }));
    wrap('resize', 'resize', (cc, rr) => ({ cols: cc, rows: rr }));
    c.on('modes', (m) => tr.note(c.terminal, 'modes', { m: m.join(' ') }));
    c.once('exit', (why) => tr.note(c.terminal, 'detach', { why }));
    if (!this._ctls.has(paneId)) this._ctls.set(paneId, new Set());
    this._ctls.get(paneId).add(c);
    c.once('exit', () => { for (const [k, s] of this._ctls) { s.delete(c); if (!s.size) this._ctls.delete(k); } });
    return c;
  }
}
