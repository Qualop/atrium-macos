// P181 단위 시험: 보고 없이 멈춘 하위를 상위에게 한 번 알리기(L4, unit-stops.mjs)와 안내문의 한 길(맡기고 턴을 끝낸다, done 보고를 판이 가져다준다).
// 진짜 저장소·전달 대기열(B1)·Branch, 가짜 에이전트(p180 시험의 틀). herdr·hc와 claude 없이 돈다.
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
import { Branch, boardSkill, peerNotice } from '../src/branch.mjs';
import { stopNoticeText, stopLine } from '../src/unit-stops.mjs';
import { isBoardNotice } from '../src/text.mjs';
import { BOARD_SYSTEM_PROMPT } from '../src/launch.mjs';
import { HARNESS_PROMPT } from '../src/harness.mjs';
import { relationHeader, relationLine } from '../src/branch-relations.mjs';
import { VERBS, shortHelp } from '../src/cli-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p181-'));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('until: 시간 초과'); await tick(10); } }

// ---------- 가짜 판: 진짜 저장소·전달 대기열·Branch, 가짜 에이전트 ----------
async function board({ dir = tmp(), batchMs = 40 } = {}) {
  const store = new Store(path.join(dir, 'board.db'));
  const ws = await workspaceOf(dir);
  if (!store.getWorkspace || !store.getWorkspace(ws.key)) try { store.insertWorkspace({ ...ws, createdAt: 1 }); } catch {}
  const cfg = { profile: 'dev', terminalSession: 'atrium-dev-p181test', port: 0, dataDir: dir, sessionsDir: path.join(dir, 'sessions'), inputQuietMs: 3000, submitConfirmMs: 3000, deliveryMaxWaitMs: 60000, submitRetries: 0 };
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
const BOARD_LEN_P180 = 2100 /* macOS 판 판 안내문 상한(작업 규칙 줄이 더 있다) */; const HARNESS_LEN_P180 = 1200 /* macOS 판: 웹·약관 줄 */; // P180 때 길이(P169: 판 안내문은 매 요청에 든다)
const STOP_TEXT = '[Atrium 보드] 맡긴 일이 멈췄다';

// ---------- 알림 글 ----------
test('P181 알림 글: 판 알림 꼴(상위 카드의 마지막 지시가 아님), 하위 이름·일 ID·할 일 앞부분·까닭·할 수 있는 것', () => {
  const l = stopLine({ child: 'w1', unitId: 'u1a2b3c', spec: '로그인 버그를 고쳐라\n둘째 줄', why: 'idle_no_done' });
  assert.match(l, /^@w1의 일 u1a2b3c\("로그인 버그를 고쳐라 둘째 줄"\): 보고\(atrium done\) 없이 턴을 끝내고 쉰다\.$/);
  const one = stopNoticeText([{ line: l }]);
  assert.ok(one.startsWith(`${STOP_TEXT}: @w1의 일 u1a2b3c`));
  assert.match(one, /atrium read <이름>/); assert.match(one, /atrium prompt <이름>/); assert.match(one, /사람에게 알린다/);
  assert.equal(isBoardNotice(one), true);
  const two = stopNoticeText([{ line: l }, { line: stopLine({ child: 'w2', unitId: 'u2', spec: 'x', why: 'closed', detail: '사람이 닫음' }) }]);
  assert.match(two, /^\[Atrium 보드\] 맡긴 일이 멈췄다\.\n- @w1.*\n- @w2의 일 u2\("x"\): 세션이 닫혔다\(사람이 닫음\)\./);
  assert.equal(isBoardNotice(two), true);
  assert.ok(stopLine({ child: 'w', unitId: 'u', spec: 'a'.repeat(300), why: 'turn_error' }).length < 140, '할 일은 앞부분만');
});

// ---------- 까닭 넷 ----------
test('P181 보고 없이 쉼(idle_no_done): 상위에게 한 번, 다시 시켜 또 멈추면 또 한 번(멈출 때마다). 시도는 열린 채', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead');
    add('w1', { parentSessionId: lead.sessionId, workMs: 40 });
    const r = await b.branch.verbs.prompt(lead, { name: 'w1', text: '로그를 정리해라' });
    assert.equal(r.unit.kind, 'new');
    await until(() => stopNotices(b, lead).length === 1);
    const n = stopNotices(b, lead)[0];
    assert.match(n.text, new RegExp(`@w1의 일 ${r.unit.id}\\("로그를 정리해라"\\): 보고\\(atrium done\\) 없이`));
    const t = tries(b)[0];
    assert.equal(t.stop_reason, 'idle_no_done'); assert.equal(t.ended_at, null, '시도는 열린 채'); assert.ok(t.notified_at);
    await tick(150);
    assert.equal(stopNotices(b, lead).length, 1, '한 번만');
    // 이어지는 지시 → 또 쉼 → 또 한 번
    await b.branch.verbs.prompt(lead, { name: 'w1', text: '계속해라' });
    await until(() => stopNotices(b, lead).length === 2);
    await tick(150);
    assert.equal(stopNotices(b, lead).length, 2);
    assert.equal(units(b).length, 1, '이어지는 지시는 새 일이 아니다');
  } finally { await stop(); }
});

test('P181 오류(turn_error)와 사람이 필요함(needs_human): 각각 한 번. 사람이 답해 다시 일하면 보내지 않는다', async () => {
  const { b, add, stop } = await board({ batchMs: 120 });
  try {
    const lead = add('lead');
    // 오류: Claude Code(hook) 하위의 턴이 StopFailure로 끝난다(손으로 몬다)
    const wE = add('we', { parentSessionId: lead.sessionId, workMs: 100000 });
    await b.branch.verbs.prompt(lead, { name: 'we', text: '빌드해라' });
    await until(() => working(wE));
    applyHook(wE.rt, { hook_event_name: 'StopFailure', error: 'rate_limit', message: '한도' }); applyTermStatus(wE.rt, 'idle'); b.broadcastSession(wE);
    assert.equal(deriveState(wE.rt).state, 'error');
    await until(() => stopNotices(b, lead).length === 1);
    assert.match(stopNotices(b, lead)[0].text, /@we의 일 u\w+\("빌드해라"\): 오류로 턴이 끝났다/);
    assert.equal(tries(b).find((t) => t.session_id === wE.sessionId).stop_reason, 'turn_error');
    // 사람이 필요함: hook 없는 종류(Codex 등)의 화면이 막힘(blocked → waiting)
    const wH = add('wh', { kind: 'codex', parentSessionId: lead.sessionId, workMs: 100000 });
    await b.branch.verbs.prompt(lead, { name: 'wh', text: '설치해라' });
    await until(() => working(wH));
    applyTermStatus(wH.rt, 'blocked'); b.broadcastSession(wH);
    assert.equal(deriveState(wH.rt).state, 'waiting');
    await until(() => stopNotices(b, lead).length === 2);
    assert.match(stopNotices(b, lead)[1].text, /@wh의 일 u\w+\("설치해라"\): 사람의 답\(승인·신뢰 질문 등\)을 기다린다/);
    const th = tries(b).find((t) => t.session_id === wH.sessionId);
    assert.equal(th.stop_reason, 'needs_human'); assert.equal(th.ended_at, null, '사람이 필요함은 시도를 끝내지 않는다');
    // 다시 막혔다가, 묶음이 나가기 전에 사람이 답해 다시 일한다 → 보내지 않는다
    applyTermStatus(wH.rt, 'working'); b.broadcastSession(wH);
    applyTermStatus(wH.rt, 'blocked'); b.broadcastSession(wH);
    applyTermStatus(wH.rt, 'working'); b.broadcastSession(wH);
    await tick(300);
    assert.equal(stopNotices(b, lead).length, 2, '다시 일하기 시작했으면 그 멈춤은 알리지 않는다');
  } finally { await stop(); }
});

test('P181 끝남(closed): 사람이 닫으면 상위에게 멈춤 알림 하나(닫힘 알림과 겹치지 않게), 상위의 child-kill이면 없음', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead');
    const w1 = add('w1', { parentSessionId: lead.sessionId, workMs: 100000 });
    await b.branch.verbs.prompt(lead, { name: 'w1', text: '오래 걸리는 일' });
    await until(() => working(w1));
    b.closeSession(w1, 'killed');
    await until(() => toParent(b, lead).length >= 1);
    await tick(150);
    const all = toParent(b, lead);
    assert.equal(all.length, 1, '상위에게 하나');
    assert.match(all[0].text, /^\[Atrium 보드\] 맡긴 일이 멈췄다: @w1의 일 u\w+\("오래 걸리는 일"\): 세션이 닫혔다\(사람이 닫음\)\./);
    assert.equal(tries(b)[0].stop_reason, 'closed'); assert.equal(units(b)[0].status, 'cancelled');
    // 열린 일이 없는 하위가 닫히면 옛 닫힘 알림(P81) 그대로
    const w2 = add('w2', { parentSessionId: lead.sessionId });
    b.closeSession(w2, 'killed');
    await until(() => toParent(b, lead).length === 2);
    assert.match(toParent(b, lead)[1].text, /@w2가 닫혔다\(사람이 닫음\)/);
    // 상위가 child-kill로 끄면 알리지 않는다
    const w3 = add('w3', { parentSessionId: lead.sessionId, workMs: 100000 });
    await b.branch.verbs.prompt(lead, { name: 'w3', text: '셋째' });
    await until(() => working(w3));
    b.kill = async ({ session }) => { b.closeSession(b.sessions.get(session), 'killed'); return { closed: true }; };
    const k = await b.branch.killChild(lead, { name: 'w3', force: true }); // macOS 판: 일하는 하위는 --force 없이 끄지 않는다
    assert.equal(k.killed[0].closed, true);
    await tick(200);
    assert.equal(toParent(b, lead).length, 2, 'child-kill은 알리지 않는다');
    assert.equal(tries(b).find((t) => t.session_id === w3.sessionId).stop_reason, 'closed');
  } finally { await stop(); }
});

// ---------- done이 오면 없음 ----------
test('P181 묶는 사이에 done이 오면 멈춤 알림은 없고 done 보고만 한 번. done을 치고 쉬는 하위도 없음', async () => {
  const { b, add, stop } = await board({ batchMs: 200 });
  try {
    const lead = add('lead');
    const w1 = add('w1', { parentSessionId: lead.sessionId, workMs: 30 });
    await b.branch.verbs.prompt(lead, { name: 'w1', text: '고쳐라' });
    await until(() => tries(b)[0] && tries(b)[0].stop_reason === 'idle_no_done');
    U(b).done(w1, { result: 'ok', text: '고쳤다(조금 늦게)' });
    await tick(400);
    assert.equal(stopNotices(b, lead).length, 0, 'done이 왔으면 멈춤 알림을 보내지 않는다');
    assert.equal(doneNotices(b, lead).length, 1);
    w1.onText = (text, s) => U(b).done(s, { result: 'failed', text: '못 했다' });
    await b.branch.verbs.prompt(lead, { name: 'w1', text: '둘째' });
    await until(() => doneNotices(b, lead).length === 2);
    await until(() => ready(w1));
    await tick(400);
    assert.equal(stopNotices(b, lead).length, 0);
  } finally { await stop(); }
});

// ---------- 중간 워커와 나무 ----------
test('P181 중간 워커: 하위를 기다리며 쉬면 알리지 않고, 나무 전체가 쉬면 맨 위 일의 상위에게 한 번. 움직임이 생기면 다음 쉼에 다시', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead');
    const mid = add('mid', { parentSessionId: lead.sessionId, workMs: 40 });
    const leaf = add('leaf', { parentSessionId: mid.sessionId, workMs: 60 });
    // mid는 일을 받으면 leaf에게 맡기고 턴을 끝낸다(done 없이). 판 알림은 읽고 쉰다
    mid.onText = async (text, s) => { if (!text.startsWith('[Atrium 보드] 맡긴 일이 멈췄다') && text.includes('큰 일')) await b.branch.verbs.prompt(s, { name: 'leaf', text: '작은 조각' }); };
    const r = await b.branch.verbs.prompt(lead, { name: 'mid', text: '큰 일' });
    assert.equal(r.unit.kind, 'new');
    await until(() => units(b).length === 2);
    // leaf가 done 없이 쉰다 → mid에게(leaf의 상위) idle_no_done 한 번
    await until(() => stopNotices(b, mid).length === 1);
    assert.match(stopNotices(b, mid)[0].text, /@leaf의 일/);
    // mid는 그 알림을 읽고 쉰다(아래에 열린 일이 그대로) → 나무 전체가 쉼 → lead에게 tree_quiet 한 번
    await until(() => stopNotices(b, lead).length === 1);
    assert.match(stopNotices(b, lead)[0].text, /@mid의 일 u\w+\("큰 일"\): 아래 하위까지 모두 쉬는데 일이 열려 있다/);
    assert.doesNotMatch(stopNotices(b, lead)[0].text, /@mid의 일 [^\n]*보고\(atrium done\) 없이/, 'mid 자신의 쉼은 알리지 않는다');
    await tick(250);
    assert.equal(stopNotices(b, lead).length, 1, '한 번');
    // 나무에 움직임(leaf에게 이어지는 지시) → 다시 쉼 → 다시 한 번
    await b.branch.verbs.prompt(mid, { name: 'leaf', text: '조금 더' });
    await until(() => stopNotices(b, mid).length === 2);
    await until(() => stopNotices(b, lead).length === 2);
    // leaf가 done → mid에게 done 보고, mid도 done → lead에게 done 보고. 그 뒤로는 멈춤 알림 없음
    U(b).done(leaf, { result: 'ok', text: '조각 끝' });
    await until(() => doneNotices(b, mid).length === 1);
    await until(() => ready(mid) && b.queue.pending(mid.sessionId) === 0 && mid.texts.some((t) => t.includes('조각 끝')));
    U(b).done(mid, { result: 'ok', text: '큰 일 끝' });
    await tick(300);
    assert.equal(stopNotices(b, lead).length, 2);
    assert.equal(doneNotices(b, lead).length, 1);
  } finally { await stop(); }
});

// ---------- 묶기 ----------
test('P181 묶기: 같은 상위로 가는 멈춤 알림은 짧은 사이면 하나로', async () => {
  const { b, add, stop } = await board({ batchMs: 250 });
  try {
    const lead = add('lead');
    add('w1', { parentSessionId: lead.sessionId, workMs: 30 });
    add('w2', { parentSessionId: lead.sessionId, workMs: 50 });
    await b.branch.verbs.prompt(lead, { name: 'w1', text: '첫째' });
    await b.branch.verbs.prompt(lead, { name: 'w2', text: '둘째' });
    await until(() => stopNotices(b, lead).length === 1);
    await tick(350);
    const ns = stopNotices(b, lead);
    assert.equal(ns.length, 1);
    assert.match(ns[0].text, /^\[Atrium 보드\] 맡긴 일이 멈췄다\.\n- @w1의 일 .*\n- @w2의 일 /);
    assert.equal(b.store.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'unit_stop_notice'").get().n, 1);
  } finally { await stop(); }
});

// ---------- 머리 없는 세션 ----------
test('P181 머리 없는 세션(옛 세션·동료·독립·--now·사람이 보낸 글)과 기다리는 상위에게는 알리지 않는다', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead');
    const old = add('old', { parentSessionId: lead.sessionId, workMs: 30 });
    await b.branch.spawnChild(lead, { name: 'p1', peer: true, prompt: '같이 하자', wait: false });
    const x = add('x', { workMs: 30 });
    await b.branch.verbs.prompt(lead, { name: 'old', text: '바로 넣기', now: true });
    await b.branch.verbs.prompt(lead, { name: 'x', text: '독립에게' });
    const hum = add('hum', { parentSessionId: lead.sessionId, workMs: 30 });
    b.queue.enqueue(hum.sessionId, '사람의 지시');
    await until(() => hum.texts.length === 1 && old.texts.length === 1 && x.texts.length === 1 && ready(hum) && ready(old) && ready(x));
    await tick(250);
    assert.equal(stopNotices(b, lead).length, 0);
    assert.equal(tries(b).length, 0);
    // 상위가 --wait로 기다리면 기다림이 멈춤을 돌려주므로 알리지 않는다
    add('w1', { parentSessionId: lead.sessionId, workMs: 30 });
    const r = await b.branch.verbs.prompt(lead, { name: 'w1', text: '기다릴 일', wait: true });
    assert.equal(r.unit.kind, 'new'); assert.ok(r.turn);
    await tick(250);
    assert.equal(stopNotices(b, lead).length, 0, '기다림이 받았다');
    assert.equal(tries(b)[0].stop_reason, 'idle_no_done');
  } finally { await stop(); }
});

// ---------- 안내문: 한 길 ----------
const TEACH = () => ({ board: BOARD_SYSTEM_PROMPT, harness: HARNESS_PROMPT, skill: boardSkill(), delegate: boardSkill('delegate'), peer: peerNotice({ agentName: 'p1' }), relHead: relationHeader({ relation: 'sub', parent: 'lead' }), relPeer: relationHeader({ relation: 'peer', parent: 'lead' }), relSub: relationLine('w1', 'lead', { relation: 'sub', up: 'lead' }, 'user'), relUp: relationLine('lead', 'w1', { relation: 'sub', up: 'lead' }, 'user'), help: shortHelp() });
test('P181 안내문: 옛 "결과는 한 길로·섞으면 두 번" 주된 가르침이 없고, 맡기고 턴을 끝내면 판이 done 보고를 가져다준다', () => {
  for (const [k, t] of Object.entries(TEACH())) {
    assert.doesNotMatch(t, /섞으면 같은/, k); assert.doesNotMatch(t, /두 번 온다|한 번 더 온다/, k); assert.doesNotMatch(t, /결과는 한 길로/, k);
    assert.doesNotMatch(t, /atrium prompt <너[^>]*> --now/, k);
  }
  for (const k of ['board', 'harness', 'skill']) {
    const t = TEACH()[k];
    assert.match(t, /턴을 끝낸다/, k); assert.match(t, /atrium done/, k); assert.match(t, /폴링/, k);
  }
  assert.match(BOARD_SYSTEM_PROMPT, /atrium child <이름> --prompt/);
  assert.match(boardSkill(), /atrium done ok\|failed/);
  assert.match(TEACH().relSub, /atrium done/); assert.match(TEACH().relHead, /atrium done/);
  assert.match(TEACH().relUp, /턴을 끝/);
  // --wait·--now·atrium wait는 그대로 쓸 수 있다(보조 설명)
  assert.match(BOARD_SYSTEM_PROMPT, /--wait/);
  assert.ok(VERBS.find((v) => v.name === 'prompt').args.includes('[--wait | --now]'));
  assert.match(VERBS.find((v) => v.name === 'prompt').does, /턴을 끝/);
  const long = fs.readFileSync(path.join(HERE, '..', 'bin', 'atrium-child.mjs'), 'utf8').match(/const HELP = `([\s\S]*?)`;/)[1];
  assert.match(long, /턴을 끝/);
  assert.ok(!/[\r\n"]/.test(HARNESS_PROMPT), '하네스 안내문은 한 줄, 큰따옴표 없이');
});
test('P181 안내문 길이: 판 안내문과 하네스 안내문은 지금(P180)보다 늘지 않는다', () => {
  assert.ok(BOARD_SYSTEM_PROMPT.length <= BOARD_LEN_P180, `판 안내문 ${BOARD_SYSTEM_PROMPT.length}자(P180 ${BOARD_LEN_P180}자)`);
  assert.ok(HARNESS_PROMPT.length <= HARNESS_LEN_P180, `하네스 안내문 ${HARNESS_PROMPT.length}자(P180 ${HARNESS_LEN_P180}자)`);
});
