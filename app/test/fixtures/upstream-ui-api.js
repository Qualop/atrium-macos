// In-memory API for renderer integration tests. No network, sessions, or disk writes.
const listeners = new Map();
const now = Date.now();
const workspace = { key: 'fixture', name: 'UI fixture', root: '/fixture/project', kind: 'repo', x: 0, y: 0, worktrees: [] };
const launchers = ['claude', 'codex', 'agy', 'shell'].map((harness) => ({ id: `default-${harness}`, name: harness === 'agy' ? 'Gemini (Antigravity)' : harness, harness, model: '', args: '', icon: '', favorite: true, permissionMode: 'manual', preview: { line: harness, env: [] } }));
const fixture = {
  calls: [], pending: [], hold: [], errors: [],
  settings: { language: 'en', tray: false, agentAutoApprove: false, sessionSleepAfterMin: 30, sleepAfterMin: 30, archiveDays: 14, branchMaxChildren: 4, branchMaxDepth: 3, branchMaxTotal: 16, autoOpenRepos: false },
  launchers: { launchers, favorites: launchers.map((l) => l.id), harnesses: [
    { id: 'claude', fields: ['model', 'effort', 'permissionMode', 'allowHerdr', 'args', 'env', 'checkUrl'], models: ['sonnet'] },
    ...['codex', 'gemini', 'agy'].map((id) => ({ id, fields: ['model', 'args'], models: ['static-must-not-appear'] })),
    { id: 'shell', fields: [], models: [] }, { id: 'command', fields: ['command', 'env'], models: [] },
  ] },
  board: { nodes: [], links: [], docks: [], memos: [], kanbans: [], workspaces: [], groups: [], current: null, viewport: { x: 120, y: 140, zoom: .65 } },
  sessions: [],
  seed(n = 4) {
    this.board.workspaces = [workspace]; this.board.current = 'fixture';
    this.sessions = Array.from({ length: n }, (_, i) => ({ sessionId: `session-${i}`, name: `agent-${String(i).padStart(3, '0')}`, kind: ['claude', 'codex', 'agy', 'shell'][i % 4], state: 'sleeping', createdAt: now, workspaceKey: 'fixture', cwd: '/fixture/project', lastPrompt: `Task ${i}`, sleep: { at: now } }));
    this.board.nodes = this.sessions.slice(0, 4).map((s, i) => ({ session_id: s.sessionId, x: (i % 2) * 740, y: Math.floor(i / 2) * 425, w: 720, h: 405 }));
    return this.sessions;
  },
};
function result(method, p) {
  if (method === 'terminal.attach') {
    setTimeout(() => api.emit('terminal.frame', { sessionId: p.session, controllerPid: 101, attachmentId: p.attachmentId, bytes: btoa('Synthetic agent terminal\r\nChoose a response in this terminal.\r\n'), full: true }), 30);
    return { controllerPid: 101, attachmentId: p.attachmentId };
  }
  if (method === 'terminal.history') return { text: '' };
  if (method === 'board.get') return structuredClone(fixture.board);
  if (method === 'settings.get') return { settings: { ...fixture.settings }, schema: Object.fromEntries(['branchMaxChildren', 'branchMaxDepth', 'branchMaxTotal'].map((k) => [k, { min: 1, max: 64, default: fixture.settings[k] }])) };
  if (method === 'settings.set') { fixture.settings[p.key] = p.value; api.emit('settings.updated', { ...fixture.settings }); return { settings: { ...fixture.settings } }; }
  if (method === 'launcher.list') return structuredClone(fixture.launchers);
  if (method === 'launcher.preview') return { preview: { line: `${p.launcher.harness} ${p.launcher.args || ''} ${p.launcher.model || ''}`.trim(), env: [] } };
  if (method === 'launcher.create' || method === 'launcher.update') return {};
  if (method === 'agent.kinds') return ['claude', 'codex', 'gemini', 'agy', 'shell'].map((kind) => ({ kind, installed: true }));
  if (method === 'agent.models') return { models: [{ id: `${p.kind}-actual-model`, name: `${p.kind} actual model` }], source: 'fixture-cli' };
  if (method === 'trust.predict') return { needsTrust: false, trustedBy: 'fixture' };
  if (method === 'recall.list') return { workspaces: [{ ...workspace, closed: [], convos: [], archived: 0 }] };
  if (method === 'thread.list') return { items: [], more: false };
  if (['delivery.list', 'loop.list', 'memo.list', 'kanban.list'].includes(method)) return [];
  if (method === 'herdr.status') return { connected: true, running: true, session: 'fixture', compat: { version: 'fixture', level: 'ok' } };
  if (method === 'resources.get') return null;
  if (method === 'herdr.clients') return { clients: [] };
  if (method === 'session.spawn') return { name: p.name || 'fixture-spawn', kind: p.kind || launchers.find((l) => l.id === p.launcher)?.harness, sessionId: 'session-0' };
  if (method === 'search.query') return { results: [{ kind: 'session', sessionId: 'session-0', name: p.q, snippet: p.q }] };
  if (method === 'changes.since') return { lines: [] };
  if (method === 'web.status') return { enabled: false, built: true, devices: [], requests: [] };
  if (method === 'web.requests' || method === 'web.devices') return [];
  if (method === 'mission.graph') return { nodes: fixture.sessions.slice(0, 4).map((s) => ({ id: s.sessionId, sessionId: s.sessionId, name: s.name, kind: 'session', agentKind: s.kind, workspaceKey: s.workspaceKey, state: s.state, category: 'idle' })), edges: [], counts: { all: Math.min(4, fixture.sessions.length) } };
  if (method === 'memo.create') {
    const memo = { memoId: 'fixture-memo', workspaceKey: 'fixture', x: 1800, y: 100, w: 400, h: 300, text: '', color: 'yellow', ...p };
    fixture.board.memos.push(memo); api.emit('memo.updated', memo); return memo;
  }
  return {};
}
export const api = {
  generation: 1, status: 'open', clientId: 'fixture-client', info: { profile: 'fixture', platform: 'darwin', defaultCwd: '/fixture/project' },
  listeners,
  on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event)?.delete(fn); },
  emit(event, data) { for (const fn of listeners.get(event) || []) fn(data); },
  async call(method, p = {}) {
    fixture.calls.push({ method, params: structuredClone(p) });
    if (fixture.hold.includes(method)) return new Promise((resolve, reject) => fixture.pending.push({ method, params: structuredClone(p), resolve, reject }));
    return result(method, p);
  },
  connect() { this.emit('$status', { status: 'open' }); this.emit('$open', { sessions: fixture.sessions }); },
  disconnect() {}, wake() {}, activity() {}, input() {}, resize() {},
};
window.__fixture = fixture;
