// P129 단위 시험: 옛 판 옮기기 모듈(herdr → herdr-core). 옛 판 알아보기, 판이 뜰 때의 어댑터, 두 백엔드를 함께 쥐는 라우터,
// 저절로 옮기기(메모리 안의 가짜 백엔드 둘과 가짜 판), 옛 runtime 읽기, 터미널 세션 env 이름
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { legacyOf, isOldBoard, openTerminal, startMigration, migrationView, HERDR_PROTOCOLS } from '../src/herdr-migrate/index.mjs';
import { TerminalRouter, paneBackend, wsBackend } from '../src/herdr-migrate/router.mjs';
import { movePlan, Migrator } from '../src/herdr-migrate/move.mjs';
import { newRuntime, applyAgentDetected, applyTermStatus, applyAgentReleased, deriveState, upgradeRuntime } from '../src/state.mjs';
import { terminalSessionVar, terminalSessionEnv, loadConfig } from '../src/config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(20); } throw new Error('timed out'); };

test('P129 옛 판 알아보기: herdr 패널이 남은 판, 판 기록이 herdr인 판, 기록 없는 P117 전 판은 옛 판. 새 판과 hc로 옮긴 판은 아니다', () => {
  assert.deepEqual(legacyOf({ openRows: [{ paneId: 'w1:p1' }] }), { legacy: true, why: 'herdr panes' });
  assert.deepEqual(legacyOf({ meta: { backend: 'hc', by: 'move' }, openRows: [{ paneId: 'w1:p1' }, { paneId: 't3' }] }).why, 'herdr panes'); // 옮기다 남은 판(P117)
  assert.deepEqual(legacyOf({ meta: { backend: 'herdr', by: 'old-board' }, openRows: [] }), { legacy: true, why: 'board record' });
  assert.deepEqual(legacyOf({ meta: null, oldBoard: true }), { legacy: true, why: 'old board' });
  assert.equal(legacyOf({ meta: { backend: 'hc' }, openRows: [{ paneId: 't1' }], oldBoard: true }).legacy, false);
  assert.equal(legacyOf({ meta: null, oldBoard: false }).legacy, false);
  const store = (rows, meta = {}) => ({ anySessionRow: () => rows, getMeta: (k) => meta[k] });
  assert.equal(isOldBoard({ store: store(true), session: 'x', exists: () => false }), true);
  assert.equal(isOldBoard({ store: store(false, { herdrServerPid: 12 }), session: 'x', exists: () => false }), true);
  assert.equal(isOldBoard({ store: store(false), session: 'x', exists: (p) => /herdr[\\/]sessions[\\/]x$/.test(p) }), true);
  assert.equal(isOldBoard({ store: store(false), session: 'x', exists: () => false }), false);
  // 옛 업데이터가 herdr 판에서 이 버전으로 올라오게 옛 프로토콜을 낸다(update-verify)
  assert.deepEqual(HERDR_PROTOCOLS, [22]);
});

// 메모리 안의 가짜 터미널 백엔드(herdr 패널 w1:p1 꼴, hc 주소 t1 꼴). 에이전트를 띄우면 곧 나타나 idle, /exit + Enter면 떠난다
class FakeTerm extends EventEmitter {
  constructor(backend, { fail = {} } = {}) {
    super(); this.backend = backend; this.connected = false; this.running = true; this.n = 0; this.panes = new Map(); this.calls = []; this.fail = fail; this.pong = { version: backend === 'hc' ? '0.1.20' : '0.9.5' };
  }
  id() { this.n++; return this.backend === 'hc' ? { ws: `hw-${this.n}`, pane: `t${this.n}` } : { ws: `w${this.n}`, pane: `w${this.n}:p1` }; }
  rec(m, a) { this.calls.push([m, a]); }
  async probe() { return this.running ? { running: true, pong: this.pong } : { running: false }; }
  async startServer() { this.running = true; return { started: true }; }
  async stopServer() { this.rec('stopServer'); this.running = false; return { stopped: true }; }
  async deleteSession() { this.rec('deleteSession'); this.deleted = true; return { deleted: true }; }
  checkCompat() { return { ok: true, level: 'ok' }; }
  serverPid() { return this.backend === 'hc' ? 4343 : 777; }
  startEvents() { this._watching = true; setTimeout(() => { this.connected = true; this.emit('connected', this.pong); }, 5); }
  stopEvents() { this._watching = false; }
  async refreshSubscription() {}
  async snapshot() { return { workspaces: [], panes: [...this.panes.values()].map((p) => ({ paneId: p.id, workspaceId: p.ws, agent: p.agent })) }; }
  async listAgents() { return [...this.panes.values()].filter((p) => p.agent).map((p) => ({ name: p.name, paneId: p.id, agent: p.agent, status: 'idle' })); }
  async createWorkspace({ cwd, label }) { const { ws, pane } = this.id(); this.panes.set(pane, { id: pane, ws, cwd, agent: null }); this.rec('createWorkspace', { cwd, label }); return { workspaceId: ws, paneId: pane }; }
  async waitShellReady() { return true; }
  async startAgent({ name, paneId, args, kind = 'claude' }) {
    this.rec('startAgent', { paneId, args, kind });
    if (this.fail.agent) { setTimeout(() => this.emit('event', { type: 'agent_released', paneId }), 5); return { agent: { paneId } }; }
    const p = this.panes.get(paneId); p.agent = kind; p.name = name;
    setTimeout(() => { this.emit('event', { type: 'agent_detected', paneId, agent: kind }); this.emit('event', { type: 'status', paneId, status: 'idle' }); }, 5);
    return { agent: { paneId, name } };
  }
  async sendText(paneId, t) { this.rec('sendText', { paneId, t }); this._typed = t; }
  async paneKeys(paneId, keys) { this.rec('paneKeys', { paneId, keys }); const p = this.panes.get(paneId); if (keys[0] === 'enter' && this._typed === '/exit' && p && p.agent) { p.agent = null; setTimeout(() => this.emit('event', { type: 'agent_released', paneId }), 5); } }
  async readScreen() { return ''; }
  async workspacePanes(ws) { return [...this.panes.values()].filter((p) => p.ws === ws).map((p) => ({ paneId: p.id })); }
  async closePane(paneId) { this.rec('closePane', paneId); this.panes.delete(paneId); }
  async closeWorkspace(ws) { this.rec('closeWorkspace', ws); for (const [k, p] of this.panes) if (p.ws === ws) this.panes.delete(k); }
  async getPane(paneId) { const p = this.panes.get(paneId); return p ? { paneId, agent: p.agent } : null; }
  async processInfo() { return { foreground_processes: [] }; }
  async getAgent() { return null; }
  async prompt(target) { this.rec('prompt', target); return { ok: true }; }
}

test('P129 라우터: 주는 hc, 패널 모양으로 가르고, 이름은 판이 아는 패널로, 새 작업 공간은 hc로. 백엔드마다 끊김을 알리고, 서버 없는 herdr는 뜰 때 뗀다', async () => {
  assert.equal(paneBackend('wCY:p1'), 'herdr'); assert.equal(paneBackend('t1b'), 'hc'); assert.equal(wsBackend('hw-ab'), 'hc'); assert.equal(wsBackend('wCY'), 'herdr');
  const c = new FakeTerm('hc'), h = new FakeTerm('herdr');
  const r = new TerminalRouter({ primary: c, others: [h] });
  const ev = [];
  for (const k of ['connected', 'disconnected']) r.on(k, (x) => ev.push([k, x]));
  r.startEvents(() => ['w1:p1', 't1']);
  await until(() => ev.find((e) => e[0] === 'connected'));
  assert.equal(r.backend, 'hc'); assert.equal(r.mixed(), true); assert.equal(r.serverPid(), 4343);
  const a = await r.createWorkspace({ cwd: 'C:/x' });
  assert.match(a.paneId, /^t/);
  h.panes.set('w9:p1', { id: 'w9:p1', ws: 'w9', agent: 'claude', name: 'old' });
  r.resolveTarget = (t) => (t === 'old' ? 'w9:p1' : null);
  await r.prompt('old', 'hi');
  assert.deepEqual(h.calls.filter((x) => x[0] === 'prompt').map((x) => x[1]), ['old']);
  assert.equal(c.calls.filter((x) => x[0] === 'prompt').length, 0);
  ev.length = 0;
  h.connected = false; h.emit('disconnected');
  assert.deepEqual(ev, [['disconnected', 'herdr']]);
  assert.equal(r.connected, true); // 주(hc)는 붙어 있다
  assert.equal(r.remove('herdr'), true); assert.equal(r.mixed(), false);
  r.stopEvents();
  const r2 = new TerminalRouter({ primary: new FakeTerm('hc'), others: [Object.assign(new FakeTerm('herdr'), { running: false })] });
  assert.deepEqual(await r2.ensureOthers(), ['herdr']);
  assert.equal(r2.mixed(), false);
});

test('P129 옮기기 계획: 잠든 세션은 잠든 채, 바쁘면 기다림, 이어 가기를 모르는 에이전트도 끝나 셸이 될 때까지 기다린다(건너뛰지 않는다)', () => {
  assert.deepEqual(movePlan({ sleeping: true }), { plan: 'asleep' });
  assert.deepEqual(movePlan({ paneId: 'w1:p1', busy: 'working', kind: 'claude', hooked: true }), { wait: 'working' });
  assert.deepEqual(movePlan({ paneId: 'w1:p1', kind: 'shell' }), { plan: 'shell' });
  assert.deepEqual(movePlan({ paneId: 'w1:p1', kind: 'claude', hooked: true, state: 'exited' }), { plan: 'pane' });
  assert.deepEqual(movePlan({ paneId: 'w1:p1', kind: 'claude', hooked: true, state: 'ready' }), { plan: 'claude' });
  assert.deepEqual(movePlan({ paneId: 'w1:p1', kind: 'codex', hooked: false, harness: true, state: 'ready' }), { plan: 'harness' });
  assert.deepEqual(movePlan({ paneId: 'w1:p1', kind: 'claude', hooked: false, origin: 'adopted', adoptedConv: true, state: 'ready' }), { plan: 'adopted_claude' });
  assert.deepEqual(movePlan({ paneId: 'w1:p1', kind: 'codex', hooked: false, origin: 'adopted', state: 'ready' }), { wait: 'adopted' });
  assert.deepEqual(movePlan({ paneId: 'w1:p1', kind: 'aider', hooked: false, origin: 'board', state: 'ready' }), { wait: 'not_resumable' });
});

// 옮기기에 필요한 만큼의 가짜 판. 어댑터 이벤트를 세션 상태에 반영한다(backend.mjs onTermEvent의 줄인 꼴)
function fakeBoard(router) {
  const sessions = new Map(), meta = {}, events = [], sent = [];
  const b = {
    cfg: { killWaitMs: 2000, claudeProjects: 'C:/nowhere', terminalSession: 'x', logDir: os.tmpdir() }, sessions, killing: new Set(), adapter: router, relay: { detach() {} }, log() {},
    store: { getMeta: (k) => meta[k], setMeta: (k, v) => { meta[k] = v; }, addEvent: (sid, kind, data) => events.push({ sid, kind, data }), saveRuntime() {}, updateSession() {} },
    api: { broadcast: (ev, d) => sent.push([ev, d]) }, meta, events, sent,
    hooked: (s) => s.rt.hooked !== false, broadcastSession() {},
    launchOf: (s) => ({ sessionId: s.sessionId, settingsPath: 'C:/s.json', permissionMode: 'manual', extraArgs: [] }),
    async withNewPane(create, register) { const r = await create(); await register(r); return r; },
    async setPane(s, paneId, ws) { s.paneId = paneId; s.termWorkspaceId = ws; },
    sleeper: { going: new Map(), wakes: new Map(), info: (s) => ({ kind: s.kind, state: deriveState(s.rt).state, draft: false, delivering: 0, loops: 0, bg: false }), async restoreAfterExit() {} },
    recall: { transcriptExists: () => false },
  };
  router.on('event', (e) => {
    const s = [...sessions.values()].find((x) => x.paneId === e.paneId);
    if (!s) return;
    if (e.type === 'agent_detected') applyAgentDetected(s.rt);
    if (e.type === 'status') applyTermStatus(s.rt, e.status);
    if (e.type === 'agent_released') applyAgentReleased(s.rt);
  });
  return b;
}
function addSession(b, { sessionId, name, kind = 'claude', paneId, ws, ready = true, asleep = false }) {
  const rt = newRuntime({ kind, hooked: kind === 'claude' });
  if (kind === 'shell') rt.phase = 'running';
  else if (ready) { applyAgentDetected(rt); applyTermStatus(rt, 'idle'); }
  if (asleep) rt.sleep = { at: 1, by: 'auto', scope: 'session' };
  const s = { sessionId, name, kind, cwd: 'C:/w', paneId: asleep ? null : paneId, termWorkspaceId: asleep ? null : ws, agentName: name, rt, origin: 'board' };
  b.sessions.set(sessionId, s);
  return s;
}
async function legacyRouter() {
  const c = new FakeTerm('hc'), h = new FakeTerm('herdr');
  Object.assign(h, { herdrPath: 'C:/fake/herdr.exe', sessionDir: path.join(os.tmpdir(), `p129-none-${process.pid}`) });
  const r = new TerminalRouter({ primary: c, others: [h] });
  r.startEvents(() => []);
  await until(() => r.connected);
  return { c, h, r };
}

test('P129 저절로 옮기기(herdr → hc): 판의 claude는 옛 패널에서 /exit 뒤 hc에 같은 세션 ID로, 셸은 새 셸, 잠든 세션은 잠든 채. 다 옮기면 herdr를 떼고 끄고 판 전용 세션을 지운다', async () => {
  const { c, h, r } = await legacyRouter();
  const b = fakeBoard(r);
  for (const [id, ws] of [['w1:p1', 'w1'], ['w2:p1', 'w2']]) h.panes.set(id, { id, ws, agent: id === 'w1:p1' ? 'claude' : null });
  const lead = addSession(b, { sessionId: 'sid-lead', name: 'lead', paneId: 'w1:p1', ws: 'w1' });
  const sh = addSession(b, { sessionId: 'sid-sh', name: 'sh1', kind: 'shell', paneId: 'w2:p1', ws: 'w2' });
  const z = addSession(b, { sessionId: 'sid-z', name: 'zz', asleep: true });
  const m = new Migrator(b, r, { herdr: h, pollMs: 20, startPanes: ['sid-lead', 'sid-sh'] });
  await m.start();
  const v = m.view();
  assert.equal(v.state, 'done', JSON.stringify(v.error));
  assert.deepEqual(v.rows.map((x) => [x.name, x.result]), [['lead', 'moved'], ['sh1', 'moved']]); // 잠든 세션은 패널이 없어 옮길 줄에 없다(깨면 hc에서 뜬다)
  assert.equal(v.moved, 2); assert.equal(v.total, 2);
  assert.match(lead.paneId, /^t/); assert.match(sh.paneId, /^t/); assert.equal(z.paneId, null);
  assert.ok(h.calls.find((x) => x[0] === 'sendText' && x[1].t === '/exit'));
  const st = c.calls.find((x) => x[0] === 'startAgent' && x[1].paneId === lead.paneId);
  assert.ok(st, 'claude started on hc');
  assert.ok(st[1].args.includes('--session-id')); // 대화 기록이 없으면 같은 세션 ID로 새로
  assert.deepEqual(h.calls.filter((x) => x[0] === 'closeWorkspace').map((x) => x[1]), ['w1', 'w2']);
  assert.equal(deriveState(lead.rt).state, 'ready'); assert.equal(deriveState(sh.rt).state, 'shell_idle');
  // 판의 세션이 남지 않고 패널도 없다 → 떼고 끄고 지운다. 판 기록은 hc(옮김)
  assert.equal(r.mixed(), false);
  assert.ok(h.calls.find((x) => x[0] === 'stopServer')); assert.ok(h.calls.find((x) => x[0] === 'deleteSession'));
  assert.equal(b.meta.terminalBackend.backend, 'hc'); assert.equal(b.meta.terminalBackend.by, 'migrated');
  assert.equal(b.meta.herdrMigration.state, 'done');
  assert.ok(b.sent.some(([ev, d]) => ev === 'terminal.migrate' && d && d.state === 'moving'));
  assert.ok(b.events.some((e) => e.kind === 'terminal_migrated' && e.data.state === 'done'));
  r.stopEvents();
});

test('P129 저절로 옮기기: 일하는 세션은 쉴 때까지 기다리고(띠에 까닭), 쉬면 옮긴다. herdr 밖 패널이 남은 서버는 끄지도 지우지도 않는다', async () => {
  const { c, h, r } = await legacyRouter();
  const b = fakeBoard(r);
  h.panes.set('w1:p1', { id: 'w1:p1', ws: 'w1', agent: 'claude' });
  h.panes.set('w7:p1', { id: 'w7:p1', ws: 'w7', agent: null }); // 판 밖 패널
  const lead = addSession(b, { sessionId: 'sid-lead', name: 'lead', paneId: 'w1:p1', ws: 'w1' });
  applyTermStatus(lead.rt, 'working');
  const m = new Migrator(b, r, { herdr: h, pollMs: 20 });
  const done = m.start();
  const w = await until(() => { const v = m.view(); return v.rows[0].result === 'waiting' && v; });
  assert.equal(w.rows[0].reason, 'working'); assert.equal(w.waiting, 1); assert.equal(w.state, 'moving');
  assert.ok(!h.calls.find((x) => x[0] === 'sendText')); // 일하는 동안 손대지 않는다
  applyTermStatus(lead.rt, 'idle');
  await done;
  assert.equal(m.view().state, 'done'); assert.match(lead.paneId, /^t/);
  assert.equal(m.view().stoppedOld.stopped, false); assert.equal(m.view().deleted, false);
  assert.ok(!h.calls.find((x) => x[0] === 'stopServer')); assert.ok(!h.calls.find((x) => x[0] === 'deleteSession'));
  r.stopEvents();
});

test('P129 저절로 옮기기: herdr 서버가 없으면(재부팅, herdr 없음) 판이 hc에서 되살린 세션을 recreated로 세고, herdr 세션 폴더를 지운다', async () => {
  const c = new FakeTerm('hc');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p129-hsess-'));
  const h = Object.assign(new FakeTerm('herdr'), { running: false, herdrPath: null, sessionDir: dir });
  const r = new TerminalRouter({ primary: c, others: [h] });
  assert.deepEqual(await r.ensureOthers(), ['herdr']); // 판이 뜰 때 떼고, 그 세션은 꺼진 서버로 둔다(backend.mjs)
  r.startEvents(() => []);
  await until(() => r.connected);
  const b = fakeBoard(r);
  const lead = addSession(b, { sessionId: 'sid-lead', name: 'lead', paneId: 'w1:p1', ws: 'w1' });
  // 판의 J1 되살리기가 hc에 다시 띄운다(가짜: 조금 뒤 패널을 hc로)
  b.recoveryDone = (async () => { await sleep(30); lead.paneId = 't9'; lead.termWorkspaceId = 'hw-9'; })();
  const m = new Migrator(b, r, { herdr: h, pollMs: 20, startPanes: ['sid-lead'] });
  await m.start();
  const v = m.view();
  assert.equal(v.state, 'done', JSON.stringify(v.error));
  assert.deepEqual(v.rows.map((x) => [x.name, x.result]), [['lead', 'recreated']]);
  assert.equal(v.recreated, 1); assert.equal(v.deleted, true); assert.equal(fs.existsSync(dir), false);
  r.stopEvents();
});

test('P129 저절로 옮기기: 실패하면 옛 패널에서 다시 잇고 잠시 뒤 다시 해 본다. 세 번 실패하면 failed로 남기고 herdr를 떼지 않는다(다음에 뜰 때 다시)', async () => {
  const c = new FakeTerm('hc', { fail: { agent: true } }), h = new FakeTerm('herdr');
  const r = new TerminalRouter({ primary: c, others: [h] });
  r.startEvents(() => []);
  await until(() => r.connected);
  const b = fakeBoard(r);
  h.panes.set('w1:p1', { id: 'w1:p1', ws: 'w1', agent: 'claude' });
  const lead = addSession(b, { sessionId: 'sid-lead', name: 'lead', paneId: 'w1:p1', ws: 'w1' });
  const m = new Migrator(b, r, { herdr: h, pollMs: 10, retryMs: 10, readyMs: 300 });
  await m.start();
  const v = m.view();
  assert.equal(v.state, 'failed'); assert.equal(v.rows[0].result, 'failed'); assert.equal(v.rows[0].tries, 3);
  assert.equal(v.error.code, 'sessions_left');
  assert.match(lead.paneId, /:/); // 옛 패널에 남는다
  assert.equal(r.mixed(), true); assert.ok(!h.calls.find((x) => x[0] === 'stopServer'));
  assert.equal(c.calls.filter((x) => x[0] === 'startAgent').length, 3);
  assert.equal(b.meta.herdrMigration.state, 'failed');
  r.stopEvents();
});

test('P129 판이 뜰 때: 새 판은 hc 어댑터 그대로(판 기록 hc). 옛 판은 hc를 주로 herdr를 함께 쥐는 라우터를 주고 판 기록을 hc로, 첫 resync 뒤 옮기기를 한 번 시작한다', async () => {
  const mkStore = (rows, meta = {}) => ({ meta, openSessions: () => rows, anySessionRow: () => rows.length > 0, getMeta: (k) => meta[k], setMeta: (k, v) => { meta[k] = v; }, addEvent() {}, saveRuntime() {} });
  const hc = new FakeTerm('hc');
  const b1 = { store: mkStore([]), cfg: { terminalSession: `p129-none-${process.pid}`, logDir: os.tmpdir() }, log() {} };
  assert.equal(await openTerminal(b1, hc), hc);
  assert.equal(b1.store.meta.terminalBackend.backend, 'hc'); assert.equal(b1.store.meta.terminalBackend.by, 'new-board');
  assert.equal(migrationView(b1), null);
  // 이미 hc였던 판(P117로 옮김): 옛 이름의 hc 서버 PID를 새 이름으로 옮긴다. herdr 판의 옛 값(herdr 서버 PID)은 옮기지 않는다
  const b3 = { store: mkStore([{ sessionId: 's', paneId: 't1' }], { terminalBackend: { backend: 'hc', by: 'move' }, herdrServerPid: 4343 }), cfg: { terminalSession: 'x', logDir: os.tmpdir() }, log() {} };
  assert.equal(await openTerminal(b3, hc), hc);
  assert.equal(b3.store.meta.terminalServerPid, 4343);
  const h = new FakeTerm('herdr');
  const b2 = { store: mkStore([{ sessionId: 's1', paneId: 'w1:p1' }], { terminalBackend: { backend: 'herdr', by: 'old-board' } }), cfg: { terminalSession: 'x', logDir: os.tmpdir() }, log() {}, sessions: new Map(), killing: new Set(), api: { broadcast() {} } };
  const r = await openTerminal(b2, hc, { makeHerdr: () => h });
  assert.ok(r instanceof TerminalRouter); assert.equal(r.backend, 'hc'); assert.deepEqual(r.backends(), ['hc', 'herdr']);
  assert.equal(b2.store.meta.terminalBackend.backend, 'hc'); assert.equal(b2.store.meta.terminalBackend.by, 'migrate');
  assert.equal(b2.store.meta.terminalServerPid, undefined);
  assert.equal(migrationView(b2).state, 'preparing');
  b2.adapter = r;
  const m = startMigration(b2, { pollMs: 10 });
  assert.ok(m); assert.equal(startMigration(b2), null); // 한 번만
  await m.job.done;
  assert.equal(migrationView(b2).state, 'done'); // 판에 세션이 없다(가짜 판): 옮길 것 없이 끝
});

test('P129 옛 이름 받기: 업데이트 전 runtime(herdr 칸, herdr_stopped)을 지금 이름으로 읽고, 터미널 세션 env는 새 이름·옛 이름 둘 다 받되 다르면 뜨지 않는다', () => {
  const old = { phase: 'running', herdr: { status: 'idle', present: true, launchPending: false, agentSessionId: null, at: 1 }, exit: { kind: 'herdr_stopped', at: 2 } };
  const rt = upgradeRuntime(old);
  assert.equal(rt.term.status, 'idle'); assert.equal('herdr' in rt, false); assert.equal(rt.exit.kind, 'terminal_stopped');
  assert.equal(upgradeRuntime({ term: { status: 'working' } }).term.status, 'working');
  assert.equal(terminalSessionVar({ ATRIUM_TERMINAL_SESSION: 'a' }), 'a');
  assert.equal(terminalSessionVar({ ATRIUM_HERDR_SESSION: 'b' }), 'b');
  assert.equal(terminalSessionVar({ ATRIUM_TERMINAL_SESSION: 'c', ATRIUM_HERDR_SESSION: 'c' }), 'c');
  assert.throws(() => terminalSessionVar({ ATRIUM_TERMINAL_SESSION: 'atrium', ATRIUM_HERDR_SESSION: 'atrium-dev-x' }), /다릅니다/);
  assert.deepEqual(terminalSessionEnv('s'), { ATRIUM_TERMINAL_SESSION: 's', ATRIUM_HERDR_SESSION: 's' });
  assert.equal(loadConfig({ argv: ['--dev'], env: { ATRIUM_HERDR_SESSION: 'atrium-dev-p129t' } }).terminalSession, 'atrium-dev-p129t');
});
