// P143 시험: atrium prompt --now. 받는 쪽이 판이 띄운 Claude Code(hook 있음)이고 일하는 중이면 기다리지 않고 Claude Code 대기 메시지로 바로 넣는다(P90 typeNow 길).
// 쉬는 중·다른 종류·응답 필요·잠듦은 B1 그대로, --now --wait는 거절, 결과 글(how). 입력 칸에 쓰다 만 글이 있으면 비키고 넣는다(P128·P139, --now만). 안내 글(결과는 한 길로).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { newRuntime, applyHook, applyTermStatus, deriveState } from '../src/state.mjs';
import { workspaceOf } from '../src/git.mjs';
import { DeliveryQueue } from '../src/delivery.mjs';
import { Branch, boardSkill } from '../src/branch.mjs';
import { VERBS, shortHelp } from '../src/cli-contract.mjs';
import { BOARD_SYSTEM_PROMPT } from '../src/launch.mjs';
import { HARNESS_PROMPT } from '../src/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p143-'));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('until: 시간 초과'); await tick(10); } }

// ---------- 전달 대기열만: --now(typeNow + aside)와 휴대폰(typeNow)의 차이 ----------
const qcfg = { submitConfirmMs: 30000, deliveryMaxWaitMs: 900000, inputQuietMs: 3000, submitRetryMs: 6000, submitRetries: 2 };
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const fakeStore = () => ({ rows: new Map(), activeDeliveries: () => [], insertDelivery(d) { this.rows.set(d.deliveryId, { ...d }); }, updateDelivery(id, p) { Object.assign(this.rows.get(id) || {}, p); }, getDelivery(id) { return this.rows.get(id) || null; } });
const WORKING = { state: 'working', agentPresent: true, termConnected: true, closed: false, lastUserInputAt: 0, kind: 'claude', hooked: true };
function rig(t, { timers = true, box = () => 'other', aside = () => ({ state: 'moved', held: { kind: 'claude', how: 'stash', text: '쓰다 만 글', rows: 1 } }) } = {}) {
  if (timers) t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const log = { sent: [], order: [], back: 0, draft: [] };
  const q = new DeliveryQueue({
    store: fakeStore(), cfg: qcfg, view: () => WORKING,
    send: async (sid, text) => { log.sent.push(text); log.order.push('send'); },
    inspect: async () => ({ box: box(), seen: false }),
    drafts: {
      aside: async () => { log.order.push('aside'); return aside(); },
      back: async () => { log.back++; log.order.push('back'); return { result: 'restored', by: 'harness' }; },
    },
  });
  q.on('draft', (e) => log.draft.push(e.phase));
  return { q, log };
}

test('P143 대기열: --now(typeNow + aside)는 입력 칸에 쓰다 만 글이 있으면 비키고(치워 두기) 바로 넣고, 확인되면 되돌린다', async (t) => {
  const { q, log } = rig(t);
  const d = q.enqueue('s', '보고: 끝났다', { typeNow: true, aside: true });
  await flush();
  assert.deepEqual(log.order, ['aside', 'send'], '비킨 뒤 넣는다');
  assert.equal(d.status, 'sent'); assert.equal(d.reason, 'typed'); assert.equal(d.typed, true);
  q.onUserPromptSubmit('s', '보고: 끝났다');
  await flush();
  assert.equal(d.status, 'confirmed');
  assert.equal(log.back, 1, '지시가 끝나면 비켜 둔 글을 되돌린다');
  assert.equal(d.reason, 'draft_restored');
  assert.deepEqual(log.draft, ['aside', 'back']);
});

test('P143 대기열: 휴대폰 입력 줄(typeNow만, P90)은 그대로 쓰다 만 글이 있으면 비키지 않고 기다린다', async (t) => {
  const { q, log } = rig(t);
  const d = q.enqueue('s', '휴대폰 글', { typeNow: true });
  await flush();
  assert.deepEqual(log.order, []);
  assert.equal(d.status, 'queued'); assert.equal(d.reason, 'draft');
});

test('P143 대기열: --now인데 입력 칸을 비우지 못하면(keep) 넣지 않고 draft로 기다린다. 빈 칸이면 비키기 없이 바로 넣는다', async (t) => {
  const { q, log } = rig(t, { aside: () => ({ state: 'keep', why: 'clear_failed', text: 'x' }) });
  const d = q.enqueue('s', '보고', { typeNow: true, aside: true });
  await flush();
  assert.deepEqual(log.order, ['aside']);
  assert.equal(d.status, 'queued'); assert.equal(d.reason, 'draft');
  const r2 = rig(t, { timers: false, box: () => 'empty' });
  const d2 = r2.q.enqueue('s', '보고 2', { typeNow: true, aside: true });
  await flush();
  assert.deepEqual(r2.log.order, ['send'], '빈 칸이면 비키기를 부르지 않는다');
  assert.equal(d2.reason, 'typed');
});

// ---------- 가짜 판(P116과 같은 꼴): 진짜 저장소·대기열·Branch, 입력 칸 읽기(inspect) 있음 ----------
async function board() {
  const dir = tmp();
  const store = new Store(path.join(dir, 'board.db'));
  const ws = await workspaceOf(dir);
  store.insertWorkspace({ ...ws, createdAt: 1 });
  const cfg = { profile: 'dev', terminalSession: 'atrium-dev-p143test', port: 0, dataDir: dir, sessionsDir: path.join(dir, 'sessions'), inputQuietMs: 3000, submitConfirmMs: 3000, deliveryMaxWaitMs: 60000, submitRetries: 0, typeCheckMs: 50 };
  const b = {
    cfg, apiToken: 'board-api-token', store, sessions: new Map(), bus: new EventEmitter(), killing: new Set(),
    sent: [], woke: [], boxes: new Map(),
    api: { broadcast: () => {} }, log: () => {}, requireTerminal: () => {},
    adapter: { backend: 'hc', connected: true, readScreen: async () => '' },
    hooked: (s) => s.rt.hooked !== false,
    summary: (s) => { const d = deriveState(s.rt); return { state: d.state, ask: d.ask || null, error: d.error || s.rt.lastError || null }; },
    ensureLink(from, to, patch = {}) {
      let l = store.linkByPair(from, to);
      if (!l) { l = { linkId: 'l' + crypto.randomBytes(4).toString('hex'), from, to, role: patch.role ?? null, spawned: !!patch.spawned, observed: !!patch.observed, createdAt: Date.now() }; store.insertLink(l); }
      return store.getLink(l.linkId);
    },
    linkEvent(l, kind, text = null, data = null) { return store.addLinkEvent(l.linkId, kind, text, data); },
    sleeper: { isAsleep: (s) => !!s.rt.sleep, wakeFor: async (s, why) => { b.woke.push([s.name, why]); await tick(40); s.rt.sleep = null; idle(s); return { awake: true }; } },
  };
  b.queue = new DeliveryQueue({
    store, cfg,
    view: (sid) => { const s = b.sessions.get(sid); if (!s) return { closed: true }; return { state: deriveState(s.rt).state, agentPresent: s.rt.term.present, termConnected: true, lastUserInputAt: 0, closed: false, kind: s.kind, hooked: b.hooked(s) }; },
    send: async (sid, text) => { b.sent.push({ sid, text }); const s = b.sessions.get(sid); if (s && s.agent) setTimeout(() => s.agent(text), 5); },
    inspect: async (sid) => ({ box: b.boxes.get(sid) || 'empty', seen: false }),
  });
  b.queue.start();
  b.branch = new Branch(b, { readyWaitMs: 30, submitWaitMs: 10, verbs: { pollMs: 15, settleMs: 1500, turnGraceMs: 300, answerGraceMs: 300 } });
  b.queue.on('delivery', (d) => { if (['confirmed', 'unconfirmed', 'failed', 'cancelled'].includes(d.status)) b.branch.onDeliveryEnd(d); });
  const add = (name, { kind = 'claude', hooked = kind === 'claude', workMs = 60 } = {}) => {
    const s = { sessionId: crypto.randomUUID(), name, cwd: dir, paneId: `${name}:p1`, agentName: name, permissionMode: 'manual', kind, origin: 'board', parentSessionId: null, workspaceKey: ws.key, rt: newRuntime({ kind, hooked }), createdAt: Date.now() };
    idle(s);
    store.insertSession({ ...s, settingsPath: '', hookToken: '', runtime: s.rt });
    b.sessions.set(s.sessionId, s);
    // 가짜 에이전트: 쉬다가 글을 받으면 일하고 답한다. 일하는 중에 받은 글(대기 메시지)은 제출 확인(hook)만 오고 턴은 그대로다
    s.agent = (text) => {
      const busy = deriveState(s.rt).state === 'working';
      if (hooked) { applyHook(s.rt, { hook_event_name: 'UserPromptSubmit', prompt: text }); b.queue.onUserPromptSubmit(s.sessionId, text); applyTermStatus(s.rt, 'working'); }
      else { applyTermStatus(s.rt, 'working'); b.queue.onAgentWorking(s.sessionId); }
      if (busy) return;
      setTimeout(() => { if (hooked) applyHook(s.rt, { hook_event_name: 'Stop', last_assistant_message: `답: ${text}` }); applyTermStatus(s.rt, 'idle'); }, workMs);
    };
    return s;
  };
  return { b, add, stop: () => { b.queue.stop(); b.branch.notices.stop(); store.close(); } };
}
function idle(s) { s.rt.term.present = true; s.rt.phase = 'running'; applyTermStatus(s.rt, 'idle'); }
const working = (s) => { applyHook(s.rt, { hook_event_name: 'UserPromptSubmit', prompt: '긴 일' }); applyTermStatus(s.rt, 'working'); };
function serve(b) {
  const srv = http.createServer((req, res) => { if (!b.branch.handleHttp(req, res)) { res.writeHead(404); res.end(); } });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => { b.cfg.port = srv.address().port; r(srv); }));
}
function runCli(args, env) {
  return new Promise((resolve) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(MTASK_|ATRIUM_|HERDR_)/.test(k)));
    execFile(process.execPath, [path.join(HERE, '..', 'bin', 'atrium-child.mjs'), ...args], { env: { ...clean, ...env }, timeout: 30000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}
const events = (b, kind) => b.store.db.prepare('SELECT * FROM link_events WHERE kind = ? ORDER BY id').all(kind);

test('P143 prompt --now: 일하는 중인 Claude Code에는 기다리지 않고 바로 넣는다(대기 메시지, how typed). 연결과 지시 기록이 남는다', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead'); const w1 = add('w1');
    working(lead); // 지휘 세션이 긴 턴을 도는 중
    const r = await b.branch.verbs.prompt(w1, { name: 'lead', text: '보고: 끝났다', now: true });
    assert.equal(r.delivery.status, 'confirmed'); assert.equal(r.delivery.reason, 'typed'); assert.equal(r.delivery.how, 'typed');
    assert.deepEqual(b.sent.map((x) => x.text), ['보고: 끝났다']);
    assert.equal(deriveState(lead.rt).state, 'working', '턴은 그대로 돈다');
    const ev = events(b, 'prompt');
    assert.equal(ev.length, 1); assert.equal(JSON.parse(ev[0].data).now, true);
    assert.equal(events(b, 'target_submitted').length, 1, '들어가면 받는 쪽의 지금 지시로 둔다(F1)');
  } finally { stop(); }
});

test('P143 prompt --now: 쉬는 중이면 지금처럼 바로, 다른 종류·응답 필요·잠듦이면 지금 B1 대기열(how queue)', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead'); const w1 = add('w1'); const cx = add('cx', { kind: 'codex' }); const asker = add('asker'); const sleepy = add('sleepy');
    const r1 = await b.branch.verbs.prompt(lead, { name: 'w1', text: '쉬는 중', now: true });
    assert.equal(r1.delivery.status, 'confirmed'); assert.equal(r1.delivery.how, 'queue'); assert.notEqual(r1.delivery.reason, 'typed');
    applyTermStatus(cx.rt, 'working');
    const r2 = await b.branch.verbs.prompt(lead, { name: 'cx', text: '다른 종류', now: true });
    assert.equal(r2.delivery.status, 'queued'); assert.equal(r2.delivery.reason, 'working'); assert.equal(r2.delivery.how, 'queue');
    applyHook(asker.rt, { hook_event_name: 'UserPromptSubmit', prompt: 'x' }); applyHook(asker.rt, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'mkdir q' } }); applyTermStatus(asker.rt, 'blocked');
    assert.equal(deriveState(asker.rt).state, 'waiting');
    const r3 = await b.branch.verbs.prompt(lead, { name: 'asker', text: '응답 필요', now: true });
    assert.equal(r3.delivery.status, 'queued'); assert.equal(r3.delivery.reason, 'waiting');
    sleepy.rt.sleep = { at: Date.now() };
    const r4 = await b.branch.verbs.prompt(lead, { name: 'sleepy', text: '잠듦', now: true });
    assert.equal(r4.woke, true); assert.equal(b.woke.length, 1, '잠든 세션은 깨운 뒤 넣는다(그대로)');
    assert.ok(!b.sent.some((x) => ['다른 종류', '응답 필요'].includes(x.text)));
    // 휴대폰·명령 바처럼 --now 없이 보내면 일하는 중에는 그대로 기다린다
    working(w1);
    const r5 = await b.branch.verbs.prompt(lead, { name: 'w1', text: '--now 없음' });
    assert.equal(r5.delivery.status, 'queued'); assert.equal(r5.delivery.reason, 'working'); assert.ok(!('how' in r5.delivery));
  } finally { stop(); }
});

test('P143 prompt --now: 입력 칸에 사람이 쓰던 글이 있으면 비키는 길(drafts)이 없을 때 draft로 기다린다', async () => {
  const { b, add, stop } = await board();
  try {
    const lead = add('lead'); const w1 = add('w1');
    working(lead); b.boxes.set(lead.sessionId, 'other');
    const r = await b.branch.verbs.prompt(w1, { name: 'lead', text: '보고', now: true });
    assert.equal(r.delivery.status, 'queued'); assert.equal(r.delivery.reason, 'draft'); assert.equal(r.delivery.how, 'queue');
    b.boxes.set(lead.sessionId, 'empty');
    await until(() => (b.store.getDelivery(r.deliveryId) || {}).status === 'confirmed');
    await tick(150); // 가짜 에이전트의 턴이 끝날 때까지
  } finally { stop(); }
});

test('P143 prompt --now --wait: 함께 쓸 수 없다(판과 CLI 둘 다). CLI 글과 --json의 how', async () => {
  const { b, add, stop } = await board();
  const srv = await serve(b);
  try {
    const lead = add('lead'); const w1 = add('w1');
    await assert.rejects(b.branch.verbs.prompt(w1, { name: 'lead', text: 'x', now: true, wait: true }), (e) => e.code === 'bad_request' && /--now와 --wait/.test(e.message));
    assert.equal(b.sent.length, 0);
    const env = b.branch.envFor(w1.sessionId);
    const both = await runCli(['prompt', 'lead', 'x', '--now', '--wait'], env);
    assert.equal(both.code, 2); assert.match(both.stderr, /--now와 --wait는 함께 쓸 수 없다/);
    working(lead);
    const pt = await runCli(['prompt', 'lead', '보고:', '끝', '--now'], env);
    assert.equal(pt.code, 0, pt.stderr);
    assert.match(pt.stdout, /@lead는 일하는 중이라 Claude Code의 대기 메시지로 바로 넣었다\(지금 턴 안에서 읽는다, 들어감/);
    assert.match(pt.stdout, /--now로 보냈으니 기다리지 않는다/); assert.doesNotMatch(pt.stdout, /끝나기 기다리기/, '밀어 넣기 뒤에 기다리라고 하지 않는다(한 길로)');
    const pj = JSON.parse((await runCli(['prompt', 'lead', '두 번째', '--now', '--json'], env)).stdout);
    assert.equal(pj.delivery.how, 'typed'); assert.equal(pj.delivery.status, 'confirmed');
    assert.deepEqual(b.sent.map((x) => x.text), ['보고: 끝', '두 번째']);
  } finally { srv.close(); stop(); }
});

// P181: 주된 가르침은 "맡기고 턴을 끝낸다(판이 done 보고를 가져다준다)"로 바뀌었다. --wait·--now는 그대로 쓸 수 있고 CLI 사용법이 말한다(p181.test.mjs)
test('P143 안내 글: --now는 계약과 CLI 사용법에 그대로, 안내 글은 맡기고 턴을 끝내라고 한다(P181). 판 시스템 글은 크게 늘지 않는다', () => {
  for (const [k, t] of Object.entries({ board: BOARD_SYSTEM_PROMPT, harness: HARNESS_PROMPT, skill: boardSkill(), delegate: boardSkill('delegate') })) {
    assert.match(t, /턴을 끝낸다/, k); assert.match(t, /--wait/, k);
  }
  assert.match(shortHelp(), /--now/);
  assert.ok(VERBS.find((v) => v.name === 'prompt').args.includes('[--wait | --now]'));
  const long = fs.readFileSync(path.join(HERE, '..', 'bin', 'atrium-child.mjs'), 'utf8').match(/const HELP = `([\s\S]*?)`;/)[1];
  assert.match(long, /--now는 받는 쪽이 일하는 중인 Claude Code면/);
  assert.ok(BOARD_SYSTEM_PROMPT.length < 2100, `판 시스템 글 ${BOARD_SYSTEM_PROMPT.length}자`); // macOS 판: Claude 세션에 빠져 있던 웹·약관, 진행 메모·조사 두 줄(+약 400자)
  assert.ok(!/[\r\n"]/.test(HARNESS_PROMPT), '하네스 안내문은 한 줄, 큰따옴표 없이');
});
