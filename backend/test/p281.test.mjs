// P281 단위 시험: 받는 쪽이 할 일이 없는 멈춤 알림 빼기(unit-stops.mjs).
// (a) 부모에게 묻고 쉼 → 알림 없음, (b) 묻고 다른 판 명령을 더 내고 쉼 → 알림, (c) 지난 턴에 묻고 이번 턴은 그냥 쉼 → 알림,
// (d) 같은 시도 두 번째 멈춤: 사람이 깨움 → 없음, 부모가 글을 보냄 → 알림, (e) 다른 까닭(turn_error)은 그대로.
// p181 시험의 가짜 판(진짜 저장소·전달 대기열·Branch, 가짜 에이전트)을 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { newRuntime, applyHook, applyTermStatus, deriveState } from '../src/state.mjs';
import { workspaceOf } from '../src/git.mjs';
import { DeliveryQueue } from '../src/delivery.mjs';
import { Branch } from '../src/branch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p281-'));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('until: 시간 초과'); await tick(10); } }

// ---------- 가짜 판: 진짜 저장소·전달 대기열·Branch, 가짜 에이전트 ----------
async function board({ dir = tmp(), batchMs = 40 } = {}) {
  const store = new Store(path.join(dir, 'board.db'));
  const ws = await workspaceOf(dir);
  if (!store.getWorkspace || !store.getWorkspace(ws.key)) try { store.insertWorkspace({ ...ws, createdAt: 1 }); } catch {}
  const cfg = { profile: 'dev', terminalSession: 'atrium-dev-p281test', port: 0, dataDir: dir, sessionsDir: path.join(dir, 'sessions'), inputQuietMs: 3000, submitConfirmMs: 3000, deliveryMaxWaitMs: 60000, submitRetries: 0 };
  const b = {
    cfg, apiToken: 'board-api-token', store, sessions: new Map(), bus: new EventEmitter(), killing: new Set(), sent: [], spawned: [],
    api: { broadcast: () => {} }, log: () => {}, requireTerminal: () => {},
    adapter: { backend: 'hc', connected: true, readScreen: async () => '' },
    hooked: (s) => s.rt.hooked !== false,
    summary: (s) => { const d = deriveState(s.rt); return { state: d.state, ask: d.ask || null, error: d.error || null }; },
    ensureLink(from, to, patch = {}) {
      let l = store.linkByPair(from, to);
      if (!l) { l = { linkId: 'l' + crypto.randomBytes(4).toString('hex'), from, to, role: patch.role ?? null, spawned: !!patch.spawned, observed: !!patch.observed, createdAt: Date.now() }; store.insertLink(l); }
      return store.getLink(l.linkId);
    },
    linkEvent(l, kind, text = null, data = null) { return store.addLinkEvent(l.linkId, kind, text, data); },
    // 상태가 바뀌면 판처럼 bus로 알린다(Branch.onSession → WorkUnits.onSession)
    broadcastSession(s) { if (b.sessions.has(s.sessionId)) b.bus.emit('session', s, b.summary(s)); },
    async spawn(p) {
      const s = add(p.name, { parentSessionId: p.parentSessionId || null });
      if (p.branch) b.branch.noteChild(s.sessionId, p.branch);
      b.spawned.push(p);
      return { sessionId: s.sessionId, trust: { needsTrust: false } };
    },
    // backend.pushTree와 같은 꼴(P92·P159): 나무의 부모는 일 부모
    pushTree() { const idx = b.branch.relIndex(); return [...b.sessions.values()].map((s) => ({ sessionId: s.sessionId, parentSessionId: idx.workParentOf(s.sessionId), kind: s.kind || 'claude', state: deriveState(s.rt).state, delivering: b.queue.pending(s.sessionId), loops: 0, bg: null })); },
    closeSession(s, reason) { b.sessions.delete(s.sessionId); store.updateSession(s.sessionId, { closedAt: Date.now() }); b.bus.emit('closed', s, reason); },
  };
  b.queue = new DeliveryQueue({
    store, cfg,
    view: (sid) => { const s = b.sessions.get(sid); if (!s) return { closed: true }; return { state: deriveState(s.rt).state, agentPresent: s.rt.term.present, termConnected: true, lastUserInputAt: 0, closed: false, kind: s.kind, hooked: b.hooked(s) }; },
    send: async (sid, text) => { if (b.stopped) return; b.sent.push({ sid, text }); const s = b.sessions.get(sid); if (s && s.agent) setTimeout(() => s.agent(text), 5); },
  });
  b.queue.start();
  b.branch = new Branch(b, { readyWaitMs: 30, submitWaitMs: 10, noticeBatchMs: batchMs, verbs: { pollMs: 15, settleMs: 800, turnGraceMs: 300, answerGraceMs: 200 } });
  b.queue.on('delivery', (d) => { if (['confirmed', 'unconfirmed', 'failed', 'cancelled'].includes(d.status)) b.branch.onDeliveryEnd(d); });
  // 가짜 에이전트: 글을 받으면 일하고(workMs) 쉰다. onText(text, s)는 일하는 중에 부른다(done을 치는 워커 등)
  const add = (name, { kind = 'claude', hooked = kind === 'claude', workMs = 80, onText = null, ...extra } = {}) => {
    const s = { sessionId: crypto.randomUUID(), name, cwd: dir, paneId: `${name}:p1`, agentName: name, permissionMode: 'manual', kind, origin: 'board', parentSessionId: null, workspaceKey: ws.key, rt: newRuntime({ kind, hooked }), createdAt: Date.now(), ...extra };
    idle(s);
    store.insertSession({ ...s, settingsPath: '', hookToken: '', runtime: s.rt });
    b.sessions.set(s.sessionId, s);
    s.texts = [];
    s.agent = (text) => {
      s.texts.push(text);
      if (hooked) { applyHook(s.rt, { hook_event_name: 'UserPromptSubmit', prompt: text }); b.queue.onUserPromptSubmit(s.sessionId, text); applyTermStatus(s.rt, 'working'); }
      else { applyTermStatus(s.rt, 'working'); b.queue.onAgentWorking(s.sessionId); }
      b.broadcastSession(s);
      const h = s.onText || onText;
      setTimeout(async () => {
        if (b.stopped) return;
        if (h) try { await h(text, s); } catch (e) { s.err = e; }
        if (b.stopped) return;
        if (hooked) applyHook(s.rt, { hook_event_name: 'Stop', last_assistant_message: `답: ${text.slice(-20)}` });
        applyTermStatus(s.rt, 'idle');
        b.broadcastSession(s);
      }, workMs);
    };
    b.broadcastSession(s);
    return s;
  };
  const busy = (s) => { applyHook(s.rt, { hook_event_name: 'UserPromptSubmit', prompt: '사람의 일' }); applyTermStatus(s.rt, 'working'); b.broadcastSession(s); };
  const rest = (s) => { applyHook(s.rt, { hook_event_name: 'Stop', last_assistant_message: '끝' }); applyTermStatus(s.rt, 'idle'); b.broadcastSession(s); };
  return { b, dir, ws, add, busy, rest, stop: async () => { b.stopped = true; b.queue.stop(); b.branch.notices.stop(); b.branch.units.stops.stop(); await tick(400); store.close(); } };
}
function idle(s) { s.rt.term.present = true; s.rt.phase = 'running'; applyTermStatus(s.rt, 'idle'); }
const U = (b) => b.branch.units;
const units = (b) => b.store.db.prepare('SELECT * FROM work_units').all();
const tries = (b) => b.store.db.prepare('SELECT * FROM unit_tries').all();
const toParent = (b, p) => b.store.db.prepare('SELECT * FROM deliveries WHERE session_id = ? ORDER BY created_at').all(p.sessionId);
const stopNotices = (b, p) => toParent(b, p).filter((d) => d.text.startsWith('[Atrium 보드] 맡긴 일이 멈췄다'));
const doneNotices = (b, p) => toParent(b, p).filter((d) => /^\[Atrium 보드\] @\S+가 일 u/.test(d.text));
const working = (s) => deriveState(s.rt).state === 'working';
const ready = (s) => deriveState(s.rt).state === 'ready';
const STOP_TEXT = '[Atrium 보드] 맡긴 일이 멈췄다';
const quietEvents = (b, s) => b.store.db.prepare("SELECT data FROM events WHERE session_id = ? AND kind = 'unit_stop_quiet' ORDER BY id").all(s.sessionId).map((r) => JSON.parse(r.data));
// 하위가 쉰 뒤 묶음 시간이 지나도록 기다린다
async function settled(b, s) { await until(() => ready(s) && !b.queue.pending(s.sessionId)); await tick(200); }

test('P281 (a) 부모에게 prompt를 보내고 쉼: 멈춤 알림 없음, 기록(unit_stop_quiet asked_parent)과 stop_reason은 남는다', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead');
    const w = add('w1', { parentSessionId: lead.sessionId, workMs: 40 });
    w.onText = async (text, s) => { if (text.includes('일을 해라')) await b.branch.dispatch('prompt', s, { name: 'lead', text: 'p281 질문: 어느 쪽?', steer: true }); };
    const r = await b.branch.verbs.prompt(lead, { name: 'w1', text: '일을 해라' });
    assert.equal(r.unit.kind, 'new');
    await until(() => quietEvents(b, w).length === 1);
    await settled(b, w);
    assert.equal(stopNotices(b, lead).length, 0, '부모는 이미 질문을 받았다');
    assert.ok(toParent(b, lead).some((d) => d.text.includes('p281 질문')), '질문은 부모에게 갔다');
    assert.deepEqual(quietEvents(b, w).map((e) => [e.why, e.because]), [['idle_no_done', 'asked_parent']]);
    assert.equal(tries(b)[0].stop_reason, 'idle_no_done', '시도의 기록은 그대로');
    // 부모가 답한다 → 하위가 done 없이 또 쉰다 → 알림(부모는 done을 기다린다)
    w.onText = null;
    await b.branch.verbs.prompt(lead, { name: 'w1', text: '왼쪽' });
    await until(() => stopNotices(b, lead).length === 1);
  } finally { await stop(); }
});

test('P281 (b) 부모에게 보낸 뒤 다른 판 명령을 더 내고 쉼: 알림', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead');
    const w = add('w1', { parentSessionId: lead.sessionId, workMs: 40 });
    w.onText = async (text, s) => {
      if (!text.includes('일을 해라')) return;
      await b.branch.dispatch('prompt', s, { name: 'lead', text: 'p281 중간 소식' });
      await b.branch.dispatch('me', s, {});
    };
    await b.branch.verbs.prompt(lead, { name: 'w1', text: '일을 해라' });
    await until(() => stopNotices(b, lead).length === 1);
    assert.equal(quietEvents(b, w).length, 0);
  } finally { await stop(); }
});

test('P281 (b2) 다른 세션에게 보내고 쉼: 알림(부모가 받은 글이 아니다). 상태 줄의 usage-report는 판 명령으로 치지 않는다', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead');
    add('other');
    const w = add('w1', { parentSessionId: lead.sessionId, workMs: 40 });
    w.onText = async (text, s) => { if (text.includes('일을 해라')) await b.branch.dispatch('prompt', s, { name: 'other', text: 'p281 옆 세션에게' }); };
    await b.branch.verbs.prompt(lead, { name: 'w1', text: '일을 해라' });
    await until(() => stopNotices(b, lead).length === 1);
    const w2 = add('w2', { parentSessionId: lead.sessionId, workMs: 40 });
    w2.onText = async (text, s) => {
      if (!text.includes('둘째 일')) return;
      await b.branch.dispatch('prompt', s, { name: 'lead', text: 'p281 w2 질문' });
      await b.branch.dispatch('usage-report', s, { kind: 'claude', input: {} });
    };
    await b.branch.verbs.prompt(lead, { name: 'w2', text: '둘째 일' });
    await until(() => quietEvents(b, w2).length === 1);
    await settled(b, w2);
    assert.equal(stopNotices(b, lead).length, 1, 'w2는 알리지 않는다');
  } finally { await stop(); }
});

test('P281 (c) 지난 턴에 부모에게 보내고 이번 턴은 그냥 쉼: 알림', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead');
    const w = add('w1', { parentSessionId: lead.sessionId, workMs: 40 });
    w.onText = async (text, s) => { if (text.includes('일을 해라')) await b.branch.dispatch('prompt', s, { name: 'lead', text: 'p281 질문' }); };
    await b.branch.verbs.prompt(lead, { name: 'w1', text: '일을 해라' });
    await until(() => quietEvents(b, w).length === 1);
    await settled(b, w);
    // 사람이 깨운다(판 명령 줄·창) → 그냥 쉼
    b.queue.enqueue(w.sessionId, '사람이 묻는다', { origin: { kind: 'human' } });
    await until(() => stopNotices(b, lead).length === 1);
  } finally { await stop(); }
});

test('P281 (d) 같은 시도 두 번째 멈춤: 사람·다른 세션이 깨우면 알리지 않고(repeat), 부모가 글을 보내면 알린다', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead');
    const other = add('other');
    const w = add('w1', { parentSessionId: lead.sessionId, workMs: 40 });
    await b.branch.verbs.prompt(lead, { name: 'w1', text: '일을 해라' });
    await until(() => stopNotices(b, lead).length === 1);
    await settled(b, w);
    b.queue.enqueue(w.sessionId, '사람이 묻는다', { origin: { kind: 'human' } });
    await until(() => quietEvents(b, w).length === 1);
    await settled(b, w);
    await b.branch.verbs.prompt(other, { name: 'w1', text: '옆 세션이 묻는다' });
    await until(() => quietEvents(b, w).length === 2);
    await settled(b, w);
    assert.equal(stopNotices(b, lead).length, 1, '되풀이는 알리지 않는다');
    assert.deepEqual(quietEvents(b, w).map((e) => e.because), ['repeat', 'repeat']);
    await b.branch.verbs.prompt(lead, { name: 'w1', text: '계속해라' });
    await until(() => stopNotices(b, lead).length === 2);
    // 그 뒤 사람이 다시 깨우면 다시 조용하다
    await settled(b, w);
    b.queue.enqueue(w.sessionId, '사람이 또 묻는다', { origin: { kind: 'human' } });
    await until(() => quietEvents(b, w).length === 3);
    await settled(b, w);
    assert.equal(stopNotices(b, lead).length, 2);
  } finally { await stop(); }
});

test('P281 (e) 다른 까닭(turn_error)은 부모에게 묻고 멈춰도·되풀이여도 그대로 알린다', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead');
    const w = add('w1', { parentSessionId: lead.sessionId, workMs: 40 });
    let n = 0;
    // 일하다 부모에게 묻고 오류로 끝나는 턴(Stop 대신 StopFailure)
    w.agent = (text) => {
      w.texts.push(text); n++;
      applyHook(w.rt, { hook_event_name: 'UserPromptSubmit', prompt: text }); b.queue.onUserPromptSubmit(w.sessionId, text); applyTermStatus(w.rt, 'working'); b.broadcastSession(w);
      setTimeout(async () => {
        if (b.stopped) return;
        await b.branch.dispatch('prompt', w, { name: 'lead', text: `p281 질문 ${n}` });
        applyHook(w.rt, { hook_event_name: 'StopFailure', error: 'rate_limit' }); applyTermStatus(w.rt, 'idle'); b.broadcastSession(w);
      }, 40);
    };
    await b.branch.verbs.prompt(lead, { name: 'w1', text: '일을 해라' });
    await until(() => stopNotices(b, lead).length === 1);
    assert.match(stopNotices(b, lead)[0].text, /오류로 턴이 끝났다/);
    assert.equal(tries(b)[0].stop_reason, 'turn_error');
    assert.equal(quietEvents(b, w).length, 0);
  } finally { await stop(); }
});
