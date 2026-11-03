// herdr 어댑터. herdr를 부르는 코드는 이 파일 안에만 둔다(ARCH 1절, 5절).
// - 서버: 이름 있는 세션만 띄우고 끈다. 부모 Claude Code 환경 변수를 뺀 깨끗한 환경으로 띄운다(E0 1절, E1 3.2).
// - 소켓 API: Windows 이름 있는 파이프, 줄 단위 JSON, 요청 하나마다 연결 하나(E0 2절).
// - 이벤트: events.subscribe 연결 하나를 열어 두고, 끊기면 다시 붙는다. 닫힌 패널이 들어가면 구독 전체가 거부되므로 살아 있는 패널만 넣는다.
// - 화면: CLI 보조 통로 `terminal session control`을 자식 프로세스로 띄운다(E0 3.3, E4).
// 규칙: 기본 herdr 세션(이름 없음)은 부르지 않는다. 모든 CLI 호출에 --session을 붙인다. 프로세스는 직접 띄운 것만 끈다.
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { HERDR_VERSION, HERDR_PROTOCOL } from '../config.mjs';
import { herdrDirectory, herdrSocket, findExecutable } from '../platform.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUB_OVERLAP_MS = 1500; // 구독을 바꿀 때 옛 구독을 더 열어 두는 시간

export class HerdrError extends Error {
  constructor(code, message, method) {
    super(`${method || 'herdr'}: ${code}: ${message}`);
    this.code = code;
    this.herdrMessage = message;
    this.method = method;
  }
}

// 부모 Claude Code 세션 표시 변수와 백엔드 자신의 변수를 뺀 환경
export function cleanEnv(base = process.env) {
  const npmLaunch = Object.keys(base).some((k) => /^npm_lifecycle_event$/i.test(k));
  // npm --prefix app is a launcher setting, not the login shell's Node prefix.
  return Object.fromEntries(Object.entries(base).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|HERDR_|MTASK_|ATRIUM_)/i.test(k) && !(npmLaunch && /^npm_config_prefix$/i.test(k))));
}

function execText(file, args, opts = {}) {
  return new Promise((res) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 20000, ...opts }, (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

// herdr 세션 폴더와 소켓(Windows 이름 있는 파이프). 기본 세션은 %APPDATA%\herdr, 이름 있는 세션은 그 아래 sessions\<이름>
export function herdrSessionDir(session) {
  return herdrDirectory(session);
}
export const herdrPipe = herdrSocket;

// 요청 하나: 연결, 줄 하나 보내기, 응답 줄 하나 받기, 닫기(E0 2절)
export function herdrCall(pipe, method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = 'mt' + crypto.randomBytes(4).toString('hex');
    let buf = '';
    let done = false;
    const sock = net.connect(pipe);
    sock.setEncoding('utf8');
    const timer = setTimeout(() => { if (!done) { done = true; sock.destroy(); reject(new HerdrError('timeout', `no response in ${timeoutMs}ms`, method)); } }, timeoutMs);
    sock.on('connect', () => sock.write(JSON.stringify({ id, method, params }) + '\n'));
    sock.on('data', (d) => (buf += d));
    sock.on('close', () => {
      if (done) return;
      done = true; clearTimeout(timer);
      const line = buf.split('\n').find((l) => l.trim());
      let msg = null;
      try { msg = line ? JSON.parse(line) : null; } catch { return reject(new HerdrError('bad_response', line.slice(0, 200), method)); }
      if (!msg) return reject(new HerdrError('no_response', 'connection closed without response', method));
      if (msg.error) return reject(new HerdrError(msg.error.code, msg.error.message, method));
      resolve(msg.result);
    });
    sock.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); reject(new HerdrError('unreachable', e.code || e.message, method)); });
  });
}

export function normalizeEvent(m) {
  const name = String(m.event || '').replace(/^(pane|workspace|tab)_/, '$1.');
  const d = m.data || {};
  const base = { paneId: d.pane_id, workspaceId: d.workspace_id, raw: m };
  if (name === 'pane.agent_status_changed') return { type: 'status', status: d.agent_status, ...base };
  if (name === 'pane.agent_detected') return d.released ? { type: 'agent_released', finalStatus: d.final_status, agent: d.agent, ...base } : { type: 'agent_detected', agent: d.agent, ...base };
  // P5: pane_created는 pane_id 대신 패널 정보(pane)를 준다(protocol 22 schema, P5에서 확인)
  if (name === 'pane.created') return { type: 'pane_created', ...base, paneId: d.pane_id || (d.pane && d.pane.pane_id), workspaceId: d.workspace_id || (d.pane && d.pane.workspace_id), cwd: d.pane ? d.pane.cwd || null : null };
  if (name === 'pane.closed') return { type: 'pane_closed', ...base };
  if (name === 'pane.exited') return { type: 'pane_exited', ...base };
  // P4: 패널을 다른 작업 공간이나 탭으로 옮기면 새 패널 ID를 받는다. 이름은 따라간다(herdr 스킬 "Use IDs and caller context")
  if (name === 'pane.moved') return { type: 'pane_moved', paneId: d.pane && d.pane.pane_id, workspaceId: d.pane && d.pane.workspace_id, previousPaneId: d.previous_pane_id, raw: m };
  if (name === 'workspace.closed') return { type: 'workspace_closed', ...base };
  return { type: 'other', name, ...base };
}

export function agentInfo(a) {
  if (!a) return null;
  return {
    name: a.name,
    paneId: a.pane_id,
    workspaceId: a.workspace_id,
    agent: a.agent,
    status: a.agent_status,
    launchPending: !!a.launch_pending,
    agentSessionId: a.agent_session && a.agent_session.value ? a.agent_session.value : null,
    title: a.terminal_title_stripped,
    cwd: a.cwd,
    tabId: a.tab_id,
  };
}

// P4(F5): herdr가 아는 에이전트 종류. `herdr agent`(하위 명령 없이)가 보여주는 도움말의 "kinds:" 줄을 읽는다. 버전 0.9.5에 묶인 형식이다.
export function parseKinds(helpText) {
  const m = String(helpText || '').match(/^\s*kinds:\s*(.+)$/m);
  return m ? m[1].split('|').map((k) => k.trim()).filter((k) => /^[a-z][a-z0-9_-]*$/.test(k)) : [];
}

export class HerdrAdapter extends EventEmitter {
  constructor({ herdrPath, session, logDir }) {
    super();
    if (!session || session === 'default') throw new Error('이름 있는 herdr 세션만 쓴다');
    this.herdrPath = herdrPath;
    this.session = session;
    this.logDir = logDir;
    this.sessionDir = herdrSessionDir(session);
    this.pipe = herdrPipe(this.sessionDir);
    this.connected = false;
    this.pong = null;
    this._sub = null;
    this._subGen = 0;
    this._watching = false;
    this._panesFn = () => [];
  }

  // ---------- 소켓 API ----------
  call(method, params = {}, timeoutMs = 15000) { return herdrCall(this.pipe, method, params, timeoutMs); }

  // ---------- 서버 ----------
  async ping() { return this.call('ping', {}, 3000); }
  async probe() { try { return { running: true, pong: await this.ping() }; } catch (e) { return { running: false, error: e.code }; } }
  checkCompat(pong) {
    const problems = [];
    if (!pong) problems.push('no pong');
    else {
      if (pong.version !== HERDR_VERSION) problems.push(`version ${pong.version} != ${HERDR_VERSION}`);
      if (pong.protocol !== HERDR_PROTOCOL) problems.push(`protocol ${pong.protocol} != ${HERDR_PROTOCOL}`);
      if (!pong.capabilities || typeof pong.capabilities !== 'object') problems.push('capabilities missing');
    }
    return { ok: problems.length === 0, problems, version: pong && pong.version, protocol: pong && pong.protocol, capabilities: pong && pong.capabilities };
  }
  async cliVersion() { const r = await execText(this.herdrPath, ['--version'], { env: cleanEnv() }); return r.stdout.trim(); }
  // P4: 고정한 herdr가 주는 에이전트 스킬 글(`herdr --skill`, ~/.agents/skills/herdr/SKILL.md와 같다)
  async skillText() { const r = await execText(this.herdrPath, ['--skill'], { env: cleanEnv() }); return r.code === 0 && r.stdout.includes('name: herdr') ? r.stdout : null; }
  serverPid() {
    if (process.platform !== 'win32') return this._serverPid || this.pong?.pid || null;
    try { return parseInt(fs.readFileSync(path.join(this.sessionDir, 'herdr.sock'), 'utf8').split(':')[0], 10) || null; } catch { return null; }
  }

  async startServer() {
    const p0 = await this.probe();
    if (p0.running) return { started: false, pong: p0.pong, pid: this.serverPid() };
    fs.mkdirSync(this.logDir, { recursive: true });
    const out = fs.openSync(path.join(this.logDir, `herdr-server-${this.session}.out`), 'a');
    const env = cleanEnv();
    if (path.isAbsolute(this.herdrPath)) env.PATH = `${path.dirname(this.herdrPath)}${path.delimiter}${env.PATH || ''}`;
    const proc = spawn(this.herdrPath, ['--session', this.session, 'server'], { env, detached: true, stdio: ['ignore', out, out], windowsHide: true });
    let spawnError = null;
    proc.on('error', (e) => { spawnError = e; });
    this._serverPid = proc.pid;
    proc.unref();
    fs.closeSync(out);
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      if (spawnError) throw new HerdrError('start_failed', `Cannot start ${this.herdrPath}: ${spawnError.message}. Install herdr ${HERDR_VERSION} or set ATRIUM_HERDR.`, 'server');
      const p = await this.probe();
      if (p.running) return { started: true, pong: p.pong, pid: this.serverPid() || proc.pid, ms: Date.now() - t0 };
      await sleep(100);
    }
    throw new HerdrError('start_failed', 'server did not answer ping in 15s', 'server');
  }
  async stopServer() {
    const r = await execText(this.herdrPath, ['--session', this.session, 'server', 'stop'], { env: cleanEnv() });
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) { if (!(await this.probe()).running) return { stopped: true, out: (r.stdout + r.stderr).trim() }; await sleep(100); }
    return { stopped: false, out: (r.stdout + r.stderr).trim() };
  }

  // P18(이름 옮기기): 멈춘 이 herdr 세션을 지운다(`herdr session delete <이름>`). 세션 이름을 직접 주는 명령이라 --session을 붙이지 않는다
  async deleteSession() {
    if ((await this.probe()).running) return { deleted: false, reason: 'running' };
    const r = await execText(this.herdrPath, ['session', 'delete', this.session], { env: cleanEnv() });
    return { deleted: r.code === 0 && !fs.existsSync(this.sessionDir), out: (r.stdout + r.stderr).trim() };
  }
  exists() { return fs.existsSync(this.sessionDir); }

  // ---------- 이벤트 구독 ----------
  // getPanes(): 판이 쥐고 있는 패널 ID 목록. 상태 이벤트는 패널마다 구독해야 한다.
  startEvents(getPanes) {
    this._panesFn = getPanes;
    this._watching = true;
    this._connectLoop();
  }
  stopEvents() { this._watching = false; this._subGen++; this._pendingSub?.destroy(); this._pendingSub = null; if (this._sub) this._sub.destroy(); this._sub = null; }

  async _connectLoop() {
    while (this._watching) {
      const p = await this.probe();
      if (p.running) {
        try { await this._subscribe(); this.pong = p.pong; if (!this.connected) { this.connected = true; this.emit('connected', p.pong); } return; } catch (e) { this.emit('log', `subscribe failed: ${e.message}`); }
      }
      if (this.connected) { this.connected = false; this.emit('disconnected'); }
      await sleep(1000);
    }
  }

  async refreshSubscription() { if (this._watching && this.connected) { try { await this._subscribe(); } catch (e) { this.emit('log', `resubscribe failed: ${e.message}`); } } }

  async _livePanes() {
    const want = new Set(this._panesFn());
    if (!want.size) return [];
    const snap = await this.snapshot();
    return snap.panes.map((p) => p.paneId).filter((id) => want.has(id));
  }

  // 구독 바꾸기는 한 번에 하나씩 한다. 세션을 잇달아 띄우면 늦게 끝난 옛 패널 목록의 구독이 새 구독을 덮을 수 있다(P2).
  _subscribe() {
    const run = (this._subChain || Promise.resolve()).catch(() => {}).then(() => this._subscribeNow());
    this._subChain = run;
    return run;
  }

  async _subscribeNow() {
    if (!this._watching) throw new HerdrError('closed', 'event watcher stopped', 'events.subscribe');
    const panes = await this._livePanes();
    if (!this._watching) throw new HerdrError('closed', 'event watcher stopped', 'events.subscribe');
    const subscriptions = [
      { type: 'pane.created' }, { type: 'pane.closed' }, { type: 'pane.exited' }, { type: 'pane.agent_detected' }, { type: 'workspace.closed' }, { type: 'pane.moved' },
      ...panes.map((p) => ({ type: 'pane.agent_status_changed', pane_id: p })),
    ];
    const gen = ++this._subGen;
    const sock = net.connect(this.pipe);
    sock.setEncoding('utf8');
    this._pendingSub = sock;
    await new Promise((resolve, reject) => {
      let buf = '';
      let acked = false;
      const timer = setTimeout(() => { reject(new HerdrError('timeout', 'subscription acknowledgement timed out', 'events.subscribe')); sock.destroy(); }, this.subscribeTimeoutMs || 10000);
      const clear = () => { clearTimeout(timer); if (this._pendingSub === sock) this._pendingSub = null; };
      sock.once('error', clear); sock.once('close', clear);
      sock.on('connect', () => sock.write(JSON.stringify({ id: 'mtsub' + gen, method: 'events.subscribe', params: { subscriptions } }) + '\n'));
      sock.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (!acked) { acked = true; clear(); if (m.error) { reject(new HerdrError(m.error.code, m.error.message, 'events.subscribe')); sock.destroy(); } else resolve(); continue; }
          // 구독을 바꾸는 동안 옛 구독과 새 구독이 잠깐 함께 열려 있다. 두 곳으로 온 같은 이벤트는 한 번만 낸다.
          // (P2에서 고침: 전에는 새 구독을 여는 순간부터 옛 구독의 이벤트를 버리고, 받은 즉시 옛 구독을 닫아 파이프에 남은 이벤트까지 버렸다.
          //  세션을 잇달아 띄우면 그 사이의 agent_detected를 잃어 전달이 no_agent로 멈췄다.)
          if (sock.destroyed || !this._watching || this._isDuplicate(line, sock)) continue;
          this.emit('event', normalizeEvent(m));
        }
      });
      sock.on('error', (e) => { if (!acked) reject(new HerdrError('unreachable', e.code || e.message, 'events.subscribe')); });
      sock.on('close', () => {
        if (!acked) return reject(new HerdrError('closed', 'subscription closed before ack', 'events.subscribe'));
        if (sock === this._sub && this._watching) { this._sub = null; this.connected = false; this.emit('disconnected'); this._connectLoop(); }
      });
    });
    if (sock.destroyed || !this._watching || gen !== this._subGen) { sock.destroy(); throw new HerdrError('closed', 'subscription closed or watcher stopped', 'events.subscribe'); }
    const old = this._sub; this._sub = sock;
    if (old) setTimeout(() => old.destroy(), SUB_OVERLAP_MS); // 옛 구독은 새 구독이 받은 뒤 잠깐 더 열어 두어 오는 중이던 이벤트를 받는다
    this.subscribedPanes = panes;
  }

  // 다른 구독 연결로 방금 온 똑같은 이벤트인가(구독을 바꾸는 동안의 중복)
  _isDuplicate(line, sock) {
    const now = Date.now();
    this._recent ||= new Map();
    for (const [k, v] of this._recent) if (now - v.at > SUB_OVERLAP_MS * 2) this._recent.delete(k);
    const seen = this._recent.get(line);
    if (seen && seen.sock !== sock) return true;
    this._recent.set(line, { sock, at: now });
    return false;
  }

  // ---------- 작업 공간, 패널, 에이전트 ----------
  async snapshot() {
    const r = await this.call('session.snapshot', {});
    const s = r.snapshot || {};
    return {
      workspaces: (s.workspaces || []).map((w) => ({ workspaceId: w.workspace_id, label: w.label })),
      panes: (s.panes || []).map((p) => ({ paneId: p.pane_id, workspaceId: p.workspace_id, agent: p.agent, status: p.agent_status })),
    };
  }
  async createWorkspace({ cwd, label, env }) {
    const r = await this.call('workspace.create', { cwd, label, focus: false, ...(env ? { env } : {}) });
    return { workspaceId: r.workspace.workspace_id, paneId: r.root_pane.pane_id };
  }
  async waitShellReady(paneId, timeoutMs = 15000) {
    const prompt = process.platform === 'win32' ? 'PS [^\\n]*>' : '(?m)[^\\n]*[$#%❯]\\s*$';
    try { await this.call('pane.wait_for_output', { pane_id: paneId, source: 'visible', match: { type: 'regex', value: prompt }, timeout_ms: timeoutMs }, timeoutMs + 2000); return true; } catch (e) { return false; }
  }
  async startAgent({ name, paneId, args, kind = 'claude' }) {
    const r = await this.call('agent.start', { name, kind, pane_id: paneId, args, timeout_ms: 60000 }, 70000);
    return { agent: agentInfo(r.agent), argv: r.argv };
  }
  // P4: 패널 하나(foreground_cwd는 셸이나 에이전트가 지금 있는 폴더), 작업 공간의 패널들
  async getPane(paneId) { const r = await this.call('pane.get', { pane_id: paneId }); const p = r.pane || {}; return { paneId: p.pane_id, workspaceId: p.workspace_id, tabId: p.tab_id, cwd: p.foreground_cwd || p.cwd || null, agent: p.agent || null, status: p.agent_status }; }
  // P6a(H5): 패널이 있는 탭의 레이아웃(패널마다 글자 칸 사각형). 같은 탭에 나뉜 패널을 처음부터 붙이는 데 쓴다. 레이아웃은 바꾸지 않는다
  async paneLayout(paneId) { const r = await this.call('pane.layout', { pane_id: paneId }); return r.layout || r; }
  async workspacePanes(workspaceId) { const r = await this.call('pane.list', { workspace_id: workspaceId }); return (r.panes || []).map((p) => ({ paneId: p.pane_id, tabId: p.tab_id, agent: p.agent || null })); }
  // P4(F5): 에이전트 종류 목록과 이 PC에서 찾은 명령(where.exe). 종류 이름과 명령 이름이 같은 것만 찾는다.
  async agentKinds() {
    const r = await execText(this.herdrPath, ['agent'], { env: cleanEnv() });
    const kinds = parseKinds(r.stdout + '\n' + r.stderr);
    const found = kinds.map((k) => findExecutable(k));
    this._kinds = kinds.map((k, i) => ({ kind: k, installed: !!found[i], path: found[i] }));
    return this._kinds;
  }
  async registerResume({ paneId, sessionId, argv }) {
    return this.call('pane.report_agent_session', { pane_id: paneId, source: 'herdr:claude', agent: 'claude', seq: Date.now(), agent_session_id: sessionId, resume_argv: argv });
  }
  // herdr가 판 전용 세션의 session.json에 저장한 이어 가기 명령을 읽는다(읽기만 한다)
  readResumeRecord(sessionId) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(this.sessionDir, 'session.json'), 'utf8')); } catch { return null; }
    let found = null;
    const walk = (o) => {
      if (found || !o || typeof o !== 'object') return;
      if (o.agent_session && o.agent_session.value === sessionId) { found = o; return; }
      for (const v of Object.values(o)) walk(v);
    };
    walk(j);
    if (!found) return { found: false };
    return { found: true, argv: found.agent_resume ? found.agent_resume.argv : null, agentName: found.agent_name };
  }
  async getAgent(target) { try { const r = await this.call('agent.get', { target }); return agentInfo(r.agent); } catch (e) { if (e.code === 'unreachable') throw e; return null; } }
  async listAgents() { const r = await this.call('agent.list', {}); return (r.agents || []).map(agentInfo); }
  async prompt(target, text) { return this.call('agent.prompt', { target, text }, 120000); }
  async sendKeys(target, keys) { return this.call('agent.send_keys', { target, keys }); }
  async sendText(paneId, text) { return this.call('pane.send_text', { pane_id: paneId, text }); }
  async paneKeys(paneId, keys) { return this.call('pane.send_keys', { pane_id: paneId, keys }); }
  async readScreen(paneId, { source = 'visible', format = 'text', lines } = {}) {
    const params = { pane_id: paneId, source, format };
    if (format === 'ansi') params.strip_ansi = false;
    if (lines) params.lines = lines;
    const r = await this.call('pane.read', params);
    return (r.read && r.read.text) || '';
  }
  async closeWorkspace(workspaceId) { return this.call('workspace.close', { workspace_id: workspaceId }); }
  async closePane(paneId) { return this.call('pane.close', { pane_id: paneId }); }
  async processInfo(paneId) { const r = await this.call('pane.process_info', { pane_id: paneId }); return r.process_info; }

  // ---------- 붙은 클라이언트(D3) ----------
  // 소켓 API에는 붙은 클라이언트 목록이 없다(protocol 22 schema). 서버 로그(herdr-server.log)를 읽는다(읽기만 한다).
  // herdr 화면(TUI)은 "client connected … surface_active=…"로, 판의 제어기는 "direct terminal client connected"·"terminal attach client connected"로 남는다.
  // 나갈 때는 TUI가 "client disconnected", 제어기가 "client detached"다. 서버가 다시 뜨면("herdr server started") 목록을 비운다.
  readClients() {
    const file = path.join(this.sessionDir, 'herdr-server.log');
    const st = (this._clientLog ||= { offset: 0, clients: new Map(), rest: '' });
    let size;
    try { size = fs.statSync(file).size; } catch { return { available: false, clients: [] }; }
    if (size < st.offset) { st.offset = 0; st.clients.clear(); st.rest = ''; }
    if (size > st.offset) {
      const fd = fs.openSync(file, 'r');
      try {
        const from = size - st.offset > 4 * 1024 * 1024 ? size - 4 * 1024 * 1024 : st.offset; // 처음 읽을 때 너무 크면 끝 4MB만
        const buf = Buffer.alloc(size - from);
        fs.readSync(fd, buf, 0, buf.length, from);
        const text = st.rest + buf.toString('utf8');
        const lines = text.split('\n');
        st.rest = lines.pop();
        for (const l of lines) parseClientLogLine(l, st.clients);
        st.offset = size;
      } finally { fs.closeSync(fd); }
    }
    return { available: true, clients: [...st.clients.values()] };
  }

  // ---------- 화면 제어기 ----------
  openController(paneId, cols, rows) { return new Controller(this, paneId, cols, rows); }
}

// 서버 로그 한 줄 → 붙은 화면 클라이언트 목록 갱신(D3). 단위 시험이 있다.
export function parseClientLogLine(line, clients) {
  if (/herdr server started/.test(line)) { clients.clear(); return; }
  const at = Date.parse(line.split(/\s/)[0]) || null;
  let m = line.match(/headless: client connected client_id=(\d+)(.*)$/);
  if (m) { clients.set(m[1], { clientId: m[1], at, detail: m[2].trim().slice(0, 160) }); return; }
  m = line.match(/headless: client (?:disconnected|detached) client_id=(\d+)/);
  if (m) clients.delete(m[1]);
}

// `herdr --session <s> terminal session control <pane> --takeover`: stdout으로 프레임, stdin으로 입력과 크기 조정(E0 3.3)
class Controller extends EventEmitter {
  constructor(adapter, paneId, cols, rows) {
    super();
    this.paneId = paneId;
    this.proc = spawn(adapter.herdrPath, ['--session', adapter.session, 'terminal', 'session', 'control', paneId, '--takeover', '--cols', String(cols), '--rows', String(rows)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: cleanEnv() });
    this.pid = this.proc.pid;
    this.exited = null;
    let buf = '';
    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'terminal.frame') this.emit('frame', { seq: m.seq, full: !!m.full, width: m.width, height: m.height, bytes: m.bytes });
        else this.emit('record', m);
      }
    });
    this.proc.stderr.on('data', (d) => this.emit('stderr', String(d)));
    this.proc.on('error', (e) => { this.exited = -1; this.emit('stderr', e.message); this.emit('exit', -1); });
    this.proc.on('exit', (code) => { this.exited = code; this.emit('exit', code); });
    this.proc.stdin.on('error', () => {});
  }
  _send(o) { if (this.exited === null) this.proc.stdin.write(JSON.stringify(o) + '\n'); }
  input(text) { this._send({ type: 'terminal.input', text }); }
  resize(cols, rows) { this._send({ type: 'terminal.resize', cols, rows }); }
  close() {
    if (this.exited !== null) return;
    this._send({ type: 'terminal.release' });
    try { this.proc.stdin.end(); } catch {}
    setTimeout(() => { if (this.exited === null) try { this.proc.kill(); } catch {} }, 800);
  }
}
