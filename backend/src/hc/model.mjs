// P114: herdr-core 터미널을 판의 세션 모델(herdr 어댑터와 같은 모양)로 옮기는 순수 함수들(단위 시험 p114.test.mjs).
// - 패널 = hc 터미널(주소 t7). 작업 공간 = 라벨 `atrium-ws`, 없으면 부모 터미널의 작업 공간, 없으면 터미널마다 하나(`hw-<주소>`)
// - 판 세션 ID는 라벨 `atrium-session`, 판이 붙인 이름은 `atrium-name`(hc는 이름을 바꿀 수 없다)
// - 상태: 프로그램이 OSC 7501로 알린 것만 있다. 판의 상태 낱말로 옮긴다(아래 STATUS_WORD). 앱 이름(`claude-code`)이 에이전트 종류다
// - 이벤트: hc 이벤트(created, status, finished, removed, lost, restarted …)를 판이 아는 이벤트 모양으로 바꾼다
export const LABEL = { session: 'atrium-session', ws: 'atrium-ws', name: 'atrium-name', wsLabel: 'atrium-ws-label', board: 'atrium-board', launch: 'atrium-launch', agent: 'atrium-agent' };
// P114 2b: 판이 만든 터미널(createWorkspace의 셸과 그 자리에 띄운 에이전트)인가. 판 밖에서 `hc run`으로 생긴 터미널은 아니다
export const isBoardTerm = (t) => !!(t && t.labels && t.labels[LABEL.board]);
// P117: 판이 첫 argv로 띄운 에이전트 터미널의 종류(라벨 atrium-agent). 7501을 말하기 전(신뢰 대화상자)에도 에이전트 자리다
export const boardAgentKind = (t) => (t && t.labels && t.labels[LABEL.agent]) || null;
// P117: 신뢰 대화상자. claude는 신뢰를 받기 전에는 7501 상태를 내지 않는다(P114 2b 남은 것). 어댑터가 화면에서 대화상자를 보면
// "막힘"을 흉내 낸 상태를 둔다(synthetic). 판은 blocked + 묻는 hook 없음 + 화면 → trust_wait로 본다(state.mjs)
export const TRUST_STATUS = Object.freeze({ app: 'claude-code', state: 'blocked', kind: 'trust', msg: 'Quick safety check: trust this folder', synthetic: true });
export const isSynthetic = (st) => !!(st && st.synthetic);

// 7501 상태 → 판의 상태 낱말(idle, working, blocked, done, unknown). error는 턴이 끝난 것(done)으로 두고 자세한 것은 detail로 넘긴다. 상태가 없으면 unknown
export const STATUS_WORD = { idle: 'idle', working: 'working', blocked: 'blocked', done: 'done', error: 'done' };
export function statusWord(st) { return (st && STATUS_WORD[st.state]) || 'unknown'; }
// 판이 더 쓸 수 있는 것: 무엇을 묻는지(kind, msg), error인지
export function statusDetail(st) {
  if (!st || !st.state) return null;
  const d = { state: st.state, app: st.app || null };
  if (st.kind) d.kind = st.kind;
  if (st.msg) d.msg = String(st.msg).slice(0, 500);
  return d;
}
// 7501 앱 이름 → 판의 에이전트 종류
export const APP_KIND = { 'claude-code': 'claude' };
export const kindOfApp = (app) => (app ? APP_KIND[app] || String(app) : null);
// 판의 종류 → 첫 argv(실행 명령이 없을 때)
export const KIND_COMMAND = { claude: 'claude', codex: 'codex', opencode: 'opencode', pi: 'pi', gemini: 'gemini', agy: 'agy' }; // gemini·agy: macOS 판의 native 통합(판의 hook)

// hc 이름 규칙: 1~32자 a-z 0-9 - _ . (살아 있는 터미널 사이에서 겹치지 않음). 맞지 않으면 이름 없이 띄우고 라벨로 둔다
export const HC_NAME_RE = /^[a-z0-9._-]{1,32}$/;
export const hcName = (name) => (name && HC_NAME_RE.test(String(name)) ? String(name) : null);

export const isLive = (t) => !!t && t.state === 'live';
// 프로그램이 아니라 코어 쪽 까닭으로 끝남(hc schema README: finished reason)
export const CORE_DOWN = new Set(['server_stop', 'host_shutdown', 'holder_lost', 'stopped_by_restart']);
const fg = (t) => (t && t.foreground) || null;

// 작업 공간: 라벨 → 부모 사슬의 라벨 → 맨 위 터미널의 주소
export function workspaceOf(t, byAddress = new Map()) {
  let cur = t, root = t;
  for (let i = 0; cur && i < 32; i++) {
    if (cur.labels && cur.labels[LABEL.ws]) return cur.labels[LABEL.ws];
    root = cur;
    cur = cur.parent ? byAddress.get(cur.parent) : null;
  }
  return `hw-${root.address}`;
}

// macOS 판: 판이 에이전트를 첫 argv로 띄운 터미널(라벨 atrium-agent)이 살아 있으면 7501 상태를 말하기 전에도 에이전트다.
// 백엔드가 다시 뜬 뒤 다시 맞출 때 claude가 신뢰 질문 밖의 첫 화면(권한 모드 확인, 로그인 등)에 있으면 "에이전트 없음"으로 보고 끝남으로 두던 것을 막는다
const agentKindOf = (t) => kindOfApp(t && t.status && t.status.app) || (isLive(t) ? boardAgentKind(t) : null);
// 판이 읽는 getPane 모양
export function paneOf(t, byAddress) {
  const f = fg(t);
  return { paneId: t.address, workspaceId: workspaceOf(t, byAddress), tabId: null, cwd: (f && f.cwd) || t.cwd || null, agent: agentKindOf(t), status: statusWord(t.status) };
}
// 판이 읽는 agentInfo 모양. 상태를 알린 적 없는(에이전트가 아닌) 터미널은 null
export function agentInfoOf(t, byAddress) {
  const kind = agentKindOf(t);
  if (!kind) return null;
  const labels = t.labels || {};
  return {
    name: labels[LABEL.name] || t.name || t.address, paneId: t.address, workspaceId: workspaceOf(t, byAddress), agent: kind, status: statusWord(t.status),
    launchPending: false, agentSessionId: labels[LABEL.session] || null, title: t.title || '', cwd: (fg(t) && fg(t).cwd) || t.cwd || null, tabId: null,
    detail: statusDetail(t.status), turn: t.turn ?? null,
  };
}
// 대상(주소, hc 이름, 판이 붙인 이름) → 살아 있는 터미널
export function findTerminal(list, target) {
  const live = list.filter(isLive);
  return live.find((t) => t.address === target) || live.find((t) => t.name === target) || live.find((t) => t.labels && t.labels[LABEL.name] === target) || null;
}

// hc 이벤트를 판의 이벤트로. 터미널 기록을 들고 있다가(스냅숏 + 이벤트 적용) 바뀐 것만 낸다
export class HcModel {
  constructor() { this.terms = new Map(); this.everAgent = new Set(); }
  get byAddress() { return this.terms; }
  list() { return [...this.terms.values()]; }
  live() { return this.list().filter(isLive); }
  // 처음 구독: 조용히 싣는다(판은 connected 뒤 스냅숏을 따로 읽는다)
  load(terminals) {
    this.terms = new Map((terminals || []).map((t) => [t.address, t]));
    for (const t of this.terms.values()) if (t.status && t.status.app) this.everAgent.add(t.address);
  }
  _base(t, extra = {}) { return { paneId: t.address, workspaceId: workspaceOf(t, this.terms), ...extra }; }
  // 알림(params: { seq, type, terminal, data }) 하나 → 판 이벤트들
  apply(p) {
    const out = [];
    const id = p.terminal;
    const prev = id ? this.terms.get(id) : null;
    const raw = p;
    switch (p.type) {
      case 'created': {
        const t = p.data;
        this.terms.set(t.address, t);
        out.push({ type: 'pane_created', ...this._base(t), cwd: t.cwd || null, raw });
        if (t.status && t.status.app) out.push(...this._agentAppeared(t, raw));
        break;
      }
      case 'restarted': {
        const t = p.data;
        const hadAgent = prev && prev.status && prev.status.app;
        this.terms.set(t.address, t);
        if (hadAgent) out.push({ type: 'agent_released', ...this._base(t), agent: kindOfApp(prev.status.app), finalStatus: statusWord(prev.status), raw });
        out.push({ type: 'pane_restarted', ...this._base(t), raw });
        break;
      }
      case 'status': {
        if (!prev) break;
        const was = prev.status && prev.status.app;
        const st = p.data ? p.data.status : null;
        const t = { ...prev, status: st, reported: p.data ? !!p.data.reported : prev.reported };
        this.terms.set(id, t);
        const now = st && st.app;
        if (was && (!now || now !== was)) out.push({ type: 'agent_released', ...this._base(t), agent: kindOfApp(was), finalStatus: statusWord(prev.status), raw });
        if (now && now !== was) out.push(...this._agentAppeared(t, raw));
        else if (now) out.push({ type: 'status', ...this._base(t), status: statusWord(st), detail: statusDetail(st), raw });
        break;
      }
      case 'lost': {
        if (!prev) break;
        const t = { ...prev, ...p.data, pid: null, foreground: null };
        this.terms.set(id, t);
        out.push({ type: 'pane_lost', ...this._base(t), reason: p.data && p.data.reason, raw });
        break;
      }
      case 'finished': {
        if (!prev) break;
        const was = prev.status && prev.status.app;
        const t = { ...prev, ...p.data, state: 'finished', foreground: null, status: null };
        this.terms.set(id, t);
        if (was) out.push({ type: 'agent_released', ...this._base(t), agent: kindOfApp(was), finalStatus: statusWord(prev.status), exitCode: t.exit_code ?? null, raw }); // P125: 종료 코드(사람이 끝냄·오류 가르기)
        // P117: 판이 띄운 에이전트가 7501을 한 번도 말하지 않고 끝났다(띄우자마자 끝남). 에이전트가 떠난 것으로 알리고 같은 자리에 셸을 남긴다
        else if (boardAgentKind(prev) && !this.everAgent.has(id) && !CORE_DOWN.has(t.reason)) { this.everAgent.add(id); out.push({ type: 'agent_released', ...this._base(t), agent: boardAgentKind(prev), finalStatus: 'unknown', exitCode: t.exit_code ?? null, raw }); }
        // 터미널이 끝나면 패널도 없다. 판에 올린 에이전트는 셸로 내린 뒤 닫힌다.
        // 판이 띄운 세션(2b)은 이 이벤트를 받아 exited로 둘지 정한다. agent: 에이전트가 돈 터미널이었나
        // 코어가 꺼져서 끝난 것(서버 끔, 재부팅, holder 잃음)은 서버가 꺼진 것과 같다: 패널 끝을 내지 않는다.
        // 판은 곧 오는 끊김(disconnected)으로 끊긴 턴을 표시하고, 다시 붙으면 되살리기(J1)를 한다
        // board: 판이 만든 터미널. 판이 띄운 에이전트가 스스로 끝났으면(exited) 어댑터가 그 자리에 셸을 띄워 pane_moved로 알린다(패널 셸이 남음, 2b)
        if (!CORE_DOWN.has(t.reason)) out.push({ type: 'pane_exited', ...this._base(t), reason: t.reason, exitCode: t.exit_code ?? null, agent: this.everAgent.has(id), board: isBoardTerm(t), raw });
        out.push({ type: 'terminal_finished', ...this._base(t), reason: t.reason, exitCode: t.exit_code ?? null, raw });
        break;
      }
      case 'removed': {
        if (!prev) break;
        this.terms.delete(id);
        this.everAgent.delete(id);
        if (isLive(prev)) out.push({ type: 'pane_closed', ...this._base(prev), raw });
        break;
      }
      case 'labels': {
        if (p.data && p.data.record) this.terms.set(id, p.data.record);
        else if (prev) this.terms.set(id, { ...prev, labels: (p.data && p.data.labels) || {} });
        break;
      }
      case 'size': { if (prev) { this.terms.set(id, { ...prev, cols: p.data.cols, rows: p.data.rows }); out.push({ type: 'size', ...this._base(prev), cols: p.data.cols, rows: p.data.rows, raw }); } break; }
      case 'foreground': { if (prev) this.terms.set(id, { ...prev, foreground: p.data || null }); break; }
      case 'title': { if (prev) this.terms.set(id, { ...prev, title: (p.data && p.data.title) || '' }); break; }
      case 'turn': { if (prev) { this.terms.set(id, { ...prev, turn: p.data.turn }); out.push({ type: 'turn', ...this._base(prev), turn: p.data.turn, state: p.data.state, raw }); } break; }
      case 'keep': { if (prev) this.terms.set(id, { ...prev, keep: !!(p.data && p.data.keep) }); break; }
      default: out.push({ type: 'other', name: `hc.${p.type}`, paneId: id || null, raw });
    }
    return out;
  }
  _agentAppeared(t, raw) {
    this.everAgent.add(t.address);
    return [
      { type: 'agent_detected', ...this._base(t), agent: kindOfApp(t.status.app), raw },
      { type: 'status', ...this._base(t), status: statusWord(t.status), detail: statusDetail(t.status), raw },
    ];
  }
  // missed나 다시 붙음: 새 스냅숏과 견주어 바뀐 것을 이벤트로 낸다
  diff(terminals) {
    const out = [];
    const next = new Map((terminals || []).map((t) => [t.address, t]));
    for (const [id, prev] of [...this.terms]) {
      const t = next.get(id);
      if (!t) { out.push(...this.apply({ type: 'removed', terminal: id, data: {} })); continue; }
      if (isLive(prev) && !isLive(t)) { if (JSON.stringify(prev.status) !== JSON.stringify(t.status) && !isSynthetic(prev.status)) out.push(...this.apply({ type: 'status', terminal: id, data: { status: null, reported: t.reported } })); out.push(...this.apply({ type: 'finished', terminal: id, data: { reason: t.reason, exit_code: t.exit_code, signal: t.signal, finished_ms: t.finished_ms } })); this.terms.set(id, t); continue; }
      if (prev.pid && t.pid && prev.pid !== t.pid) { out.push(...this.apply({ type: 'restarted', terminal: id, data: t })); continue; }
      // P117: 흉내 낸 신뢰 상태는 코어에 없다. 코어가 아직 상태를 모르면(신뢰 대화상자 그대로) 들고 있는다
      if (isSynthetic(prev.status) && !t.status) { this.terms.set(id, { ...t, status: prev.status }); continue; }
      if (JSON.stringify(prev.status) !== JSON.stringify(t.status)) out.push(...this.apply({ type: 'status', terminal: id, data: { status: t.status, reported: t.reported } }));
      this.terms.set(id, { ...t, status: this.terms.get(id).status });
    }
    for (const [id, t] of next) if (!this.terms.has(id)) { if (isLive(t)) out.push(...this.apply({ type: 'created', terminal: id, data: t })); else this.terms.set(id, t); }
    return out;
  }
}

// ---------- env ----------
const isPathKey = (k) => k.toUpperCase() === 'PATH';
// 판이 띄우는 터미널의 env(관리자 결정, P114 2a): PATH는 터미널 env로 넘기고(hc는 프로그램 env의 PATH를 레지스트리로 다시 만든다),
// 코어에 준 XDG_CONFIG_HOME(판 전용 hc 설정)은 프로그램에 새지 않게 빈 값으로 덮는다(빈 값은 XDG 규약상 기본 폴더)
// P114 2b: extra는 판의 env(하네스 env 포함), pathFirst는 PATH 맨 앞에 둘 폴더들(판 데이터 폴더의 bin/ 등, harnessLaunch). PATH = pathFirst + 판의 hc 폴더 + 기본 PATH
// (extra에 PATH가 있으면 그것이 기본 PATH). 같은 폴더는 한 번만. XDG_CONFIG_HOME은 extra에 있어도 빈 값으로 둔다(판 hc 설정이 새지 않게)
export function terminalEnv({ exeDir, basePath = '', extra = {}, pathFirst = [], platform = process.platform, userXdgConfig = USER_XDG_CONFIG } = {}) {
  const win = platform === 'win32';
  const sep = win ? ';' : ':';
  const norm = (p) => { const s = String(p).replace(/[\\/]+$/, ''); return win ? s.toLowerCase() : s; };
  const out = {};
  let base = basePath;
  for (const [k, v] of Object.entries(extra || {})) { if (v == null) continue; if (isPathKey(k)) base = String(v); else out[k] = String(v); }
  const seen = new Set(), parts = [];
  for (const p of [...(pathFirst || []), ...(exeDir ? [exeDir] : []), ...String(base || '').split(sep)]) { if (!p) continue; const k = norm(p); if (seen.has(k)) continue; seen.add(k); parts.push(p); }
  if (parts.length) out.PATH = parts.join(sep);
  // 코어의 XDG_CONFIG_HOME(판 전용 hc 설정 폴더)이 프로그램에 새지 않게 덮는다. macOS: 사용자가 원래 정한 값이 있으면 그것으로 되돌린다
  out.XDG_CONFIG_HOME = !win && userXdgConfig ? userXdgConfig : '';
  return out;
}
// 백엔드가 뜰 때의 사용자 XDG_CONFIG_HOME(코어 env는 이것을 판 폴더로 바꾼다)
const USER_XDG_CONFIG = process.env.XDG_CONFIG_HOME || '';

// ---------- 키 ----------
// 판의 키 이름 → 터미널에 보낼 바이트(attach로 바로 넣는다. terminal.keys는 사람 입력 뒤 약 3초 조용해질 때까지 기다린다, P114 1단계 7번.
// P130: 판 입력이라 AUTOMATIC_INPUT(kind 6)으로 보내 hc가 사람 입력으로 세지 않는다. adapter.mjs _typeRaw)
// ConPTY는 win32-input-mode를 요청하지만 VT 키 바이트도 받는다(1단계에서 확인). 모르는 이름이 있으면 null(terminal.keys로 보낸다)
export const KEY_BYTES = {
  enter: '\r', esc: '\x1b', escape: '\x1b', tab: '\t', 'shift+tab': '\x1b[Z', space: ' ', backspace: '\x7f',
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', home: '\x1b[H', end: '\x1b[F',
  'ctrl+c': '\x03', 'ctrl+d': '\x04', 'ctrl+u': '\x15', 'ctrl+g': '\x07',
};
export function keyBytes(name) {
  const k = String(name);
  if (/^[0-9]$/.test(k) || /^[a-z]$/.test(k)) return k;
  return KEY_BYTES[k.toLowerCase()] ?? null;
}
export function keysToBytes(keys) {
  const out = [];
  for (const k of keys || []) { const b = keyBytes(k); if (b == null) return null; out.push(b); }
  return out;
}
