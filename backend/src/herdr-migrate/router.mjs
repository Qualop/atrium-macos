// P117·P129: 옮기는 동안의 판 터미널 어댑터. 옛 herdr 판이 뜰 때(index.mjs) hc 어댑터(주)와 herdr 어댑터를 함께 쥐고, 패널 ID 모양으로 갈라 보낸다.
// 옛 판 옮기기 모듈(herdr-migrate)의 일부다. 옮기기가 끝나면 판은 다음에 뜰 때부터 hc 어댑터 하나만 쓴다(이 라우터를 거치지 않는다).
// - 주(primary)는 늘 hc다: 새 세션·새 패널(createWorkspace), 서버 PID, 버전 확인이 간다
// - 패널 ID: herdr는 `<작업 공간>:<패널>`(콜론), hc는 터미널 주소(`t1b`). 작업 공간: hc는 `hw-…`. 이름(에이전트 주소)은 판이 준 resolveTarget으로 패널을 찾고, 못 찾으면 주부터 차례로 묻는다
// - 이벤트: 어댑터마다의 event·log·hc·upgraded를 그대로 넘긴다. disconnected(어느 백엔드인지)는 백엔드마다 내고(판이 그 백엔드의 세션만 끊긴 턴으로 둔다),
//   connected는 붙은 어댑터가 모두 붙었을 때 낸다(판이 다시 맞춘다)
import { EventEmitter } from 'node:events';

export const paneBackend = (paneId) => (paneId && String(paneId).includes(':') ? 'herdr' : 'hc');
export const wsBackend = (ws) => (String(ws || '').startsWith('hw-') ? 'hc' : 'herdr');
const FORWARD = ['event', 'hc', 'upgraded'];

export class TerminalRouter extends EventEmitter {
  constructor({ primary, others = [] }) {
    super();
    this.adapters = new Map(); // 백엔드 이름 → 어댑터
    this._wires = new Map();
    this._up = new Set(); // 붙어 있는 백엔드
    this._allUp = false;
    this._quiet = new Set(); // 옮기기가 나중에 붙인 백엔드: 처음 붙을 때 connected(판 다시 맞추기)를 내지 않는다
    this._getPanes = null;
    this.resolveTarget = null; // 판이 준다: 에이전트 이름·주소 → 패널 ID(없으면 null)
    this.add(primary);
    this.primaryName = primary.backend || 'hc';
    for (const a of others) this.add(a);
  }
  get primary() { return this.adapters.get(this.primaryName); }
  get backend() { return this.primaryName; }
  backends() { return [...this.adapters.keys()]; }
  get(name) { return this.adapters.get(name) || null; }
  mixed() { return this.adapters.size > 1; }
  backendOfPane(paneId) { return paneBackend(paneId); }
  // ---------- 어댑터 붙이기·떼기 ----------
  // quiet: 판이 이미 도는 동안(옮기기) 붙인다. 이벤트 구독을 바로 열고, 처음 붙을 때 판 전체를 다시 맞추지 않는다
  add(a, { quiet = false } = {}) {
    const name = a.backend || 'hc';
    if (this.adapters.has(name)) return this.adapters.get(name);
    this.adapters.set(name, a);
    const w = {
      log: (m) => this.emit('log', this.adapters.size > 1 ? `[${name}] ${m}` : m),
      connected: () => { this._up.add(name); if (this._quiet.delete(name)) { this._allUp = [...this.adapters.keys()].every((n) => this._up.has(n)); return; } this._checkUp(); },
      disconnected: () => { const was = this._up.delete(name); if (was) { this._allUp = false; this.emit('disconnected', name); } },
    };
    for (const k of FORWARD) w[k] = (...args) => this.emit(k, ...args);
    for (const [k, fn] of Object.entries(w)) a.on(k, fn);
    this._wires.set(name, w);
    if (a.connected) this._up.add(name);
    if (quiet) {
      if (!a.connected) this._quiet.add(name);
      if (this._getPanes && !a._watching) a.startEvents(() => this._getPanes().filter((p) => paneBackend(p) === name));
    }
    return a;
  }
  // 백엔드를 뗀다(이벤트를 멈춘다. 서버는 끄지 않는다)
  remove(name) {
    const a = this.adapters.get(name);
    if (!a || name === this.primaryName) return false;
    const w = this._wires.get(name);
    for (const [k, fn] of Object.entries(w || {})) a.off(k, fn);
    try { a.stopEvents(); } catch {}
    this.adapters.delete(name); this._wires.delete(name); this._up.delete(name); this._quiet.delete(name);
    this._checkUp();
    return true;
  }
  setPrimary(name) { if (!this.adapters.has(name)) throw new Error(`terminal backend ${name} is not attached`); this.primaryName = name; }
  _checkUp() {
    const all = [...this.adapters.keys()].every((n) => this._up.has(n));
    if (all && !this._allUp) { this._allUp = true; this.emit('connected', this.primary.pong); }
    else if (!all) this._allUp = false;
  }
  _by(paneId) { return this.adapters.get(paneBackend(paneId)) || this.primary; }
  _byWs(ws) { return this.adapters.get(wsBackend(ws)) || this.primary; }
  // 이름이나 주소로 부르는 것: 판이 아는 세션이면 그 패널의 백엔드, 아니면 주부터 차례로(agent_not_found면 다음)
  async _byTarget(target, fn) {
    if (String(target || '').includes(':')) return fn(this._by(target));
    const pane = this.resolveTarget ? this.resolveTarget(target) : null;
    if (pane) return fn(this._by(pane));
    const order = [this.primary, ...[...this.adapters.values()].filter((a) => a !== this.primary)];
    let last;
    for (const a of order) {
      try { return await fn(a); } catch (e) { last = e; if (e.code !== 'agent_not_found' || order.length === 1) throw e; }
    }
    throw last;
  }
  view() { return [...this.adapters.entries()].map(([name, a]) => ({ backend: name, primary: name === this.primaryName, connected: !!a.connected })); }

  // ---------- 주(primary)에 가는 것 ----------
  get connected() { return !!(this.primary && this.primary.connected); }
  get pong() { return this.primary.pong; }
  get pin() { return this.primary.pin || (this.get('hc') && this.get('hc').pin) || null; }
  get backendPick() { return this.primary.backendPick; }
  set backendPick(v) { this.primary.backendPick = v; }
  get exePath() { return this.primary.exePath; }
  get _watching() { return [...this.adapters.values()].some((a) => a._watching); }
  get subscribedPanes() { return [...this.adapters.values()].flatMap((a) => a.subscribedPanes || []); }
  ping() { return this.primary.ping(); }
  probe() { return this.primary.probe(); }
  checkCompat(pong) { return this.primary.checkCompat(pong); }
  cliVersion() { return this.primary.cliVersion(); }
  serverPid() { return this.primary.serverPid(); }
  agentKinds() { return this.primary.agentKinds(); }
  // 주의 서버를 띄운다(판의 ensureTerminal). 다른 백엔드는 판이 뜰 때·옮길 때 따로 본다(ensureOthers)
  startServer() { return this.primary.startServer(); }
  // 사람이 고른 "터미널 모두 끄기": 붙은 백엔드 모두
  async stopServer() {
    const out = {};
    for (const [n, a] of this.adapters) out[n] = await a.stopServer().catch((e) => ({ stopped: false, out: e.message }));
    const p = out[this.primaryName];
    return { ...p, backends: out };
  }
  restartServer(o) { return this.primary.restartServer ? this.primary.restartServer(o) : Promise.reject(Object.assign(new Error('not supported'), { code: 'not_supported' })); }
  upgrade() { const h = this.get('hc'); return h ? h.upgrade() : Promise.resolve({ upgraded: false }); }
  // 판이 뜰 때: 주 밖의 백엔드가 서버 없이 남았으면 뗀다(그 세션은 판이 주에서 되살린다). → 뗀 백엔드 이름들
  async ensureOthers() {
    const gone = [];
    for (const [n, a] of [...this.adapters]) {
      if (n === this.primaryName) continue;
      const p = await a.probe().catch(() => ({ running: false }));
      if (!p.running) { this.remove(n); gone.push(n); }
    }
    return gone;
  }

  // ---------- 모두에 가는 것 ----------
  startEvents(getPanes) { this._getPanes = getPanes || null; for (const [n, a] of this.adapters) a.startEvents(getPanes ? () => getPanes().filter((p) => paneBackend(p) === n) : undefined); }
  stopEvents() { for (const a of this.adapters.values()) a.stopEvents(); }
  async refreshSubscription() { for (const a of this.adapters.values()) await a.refreshSubscription(); }
  async snapshot() {
    const parts = await Promise.all([...this.adapters.values()].map((a) => a.snapshot()));
    return { workspaces: parts.flatMap((p) => p.workspaces || []), panes: parts.flatMap((p) => p.panes || []) };
  }
  async listAgents() { return (await Promise.all([...this.adapters.values()].map((a) => a.listAgents()))).flat(); }

  // ---------- 패널·작업 공간으로 가르는 것 ----------
  // 새 작업 공간은 주에(backend를 주면 그 백엔드에. 옮기기가 쓴다)
  createWorkspace(o = {}) { const { backend, ...rest } = o; return (backend ? this.get(backend) : this.primary).createWorkspace(rest); }
  startAgent(o) { return this._by(o.paneId).startAgent(o); }
  runAgent(o) { return this.primary.runAgent(o); }
  typeAgent(o) { return this._by(o.paneId).typeAgent(o); }
  getPane(paneId) { return this._by(paneId).getPane(paneId); }
  latest(paneId) { const a = this._by(paneId); return a && typeof a.latest === 'function' ? a.latest(paneId) : paneId; } // hc가 바꿔 띄운 자리(판의 같은 패널 확인)
  processInfo(paneId) { return this._by(paneId).processInfo(paneId); }
  readScreen(paneId, o) { return this._by(paneId).readScreen(paneId, o); }
  paneKeys(paneId, keys) { return this._by(paneId).paneKeys(paneId, keys); }
  sendText(paneId, text) { return this._by(paneId).sendText(paneId, text); }
  closePane(paneId) { return this._by(paneId).closePane(paneId); }
  waitShellReady(paneId, ms) { return this._by(paneId).waitShellReady(paneId, ms); }
  paneLayout(paneId) { return this._by(paneId).paneLayout(paneId); }
  openController(paneId, cols, rows) { return this._by(paneId).openController(paneId, cols, rows); }
  // 판이 부른 패널이 그 백엔드 안에서 다른 터미널로 바뀌었으면 새 자리(hc: 에이전트가 끝나 남은 셸). herdr는 그대로
  async follow(paneId) { const a = this._by(paneId); return a.follow ? a.follow(paneId) : paneId; }
  workspacePanes(ws) { return this._byWs(ws).workspacePanes(ws); }
  closeWorkspace(ws) { return this._byWs(ws).closeWorkspace(ws); }
  prompt(target, text) { return this._byTarget(target, (a) => a.prompt(target, text)); }
  sendKeys(target, keys) { return this._byTarget(target, (a) => a.sendKeys(target, keys)); }
  getAgent(target) { return this._byTarget(target, async (a) => { const r = await a.getAgent(target); if (!r && this.adapters.size > 1) throw Object.assign(new Error('no agent'), { code: 'agent_not_found' }); return r; }).catch((e) => { if (e.code === 'unreachable') throw e; return null; }); }
  renameAgent(target, name) { return this._byTarget(target, (a) => a.renameAgent(target, name)); }
}
