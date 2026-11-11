// P81 단위 시험: 세션이 자기 연결을 판에서 읽기(atrium me), 부모에서 떼기(session.detach, 선 끊기의 부모에서도 떼기),
// 처음부터 헤드로 띄우기(atrium child --head), 연결이 바뀔 때 짧은 알림(묶기, child-kill이면 안 보냄, 잠든 세션), 안내와 스킬 글. herdr와 claude 없이 돈다.
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
import { newRuntime } from '../src/state.mjs';
import { BOARD_SYSTEM_PROMPT } from '../src/launch.mjs';
import { Branch, BRANCH_ALLOW, boardSkill } from '../src/branch.mjs';
import { NoticeBatcher, noticeText, closeWhy, ME_LINE, ACK_LINE } from '../src/link-notice.mjs';
import { workspaceOf } from '../src/git.mjs';
import { Sleeper } from '../src/sleep.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p81-'));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ---------- 가짜 판(p8 시험의 틀에 연결 기록·닫힘 까닭·잠듦을 더했다) ----------
async function fakeBoard({ batchMs = 30 } = {}) {
  const dir = tmp();
  const store = new Store(path.join(dir, 'board.db'));
  const ws = await workspaceOf(dir);
  store.insertWorkspace({ ...ws, createdAt: 1 });
  const b = {
    cfg: { profile: 'dev', herdrSession: 'atrium-dev-p81test', port: 0, dataDir: dir }, apiToken: 'board-api-token', store, sessions: new Map(), bus: new EventEmitter(),
    broadcasts: [], spawned: [], killed: [], queued: [], killing: new Set(),
    api: { broadcast: (e, d) => b.broadcasts.push([e, d]) }, log: () => {}, requireHerdr: () => {},
    hooked: (s) => s.kind === 'claude' && s.origin === 'board',
    summary: (s) => ({ state: s.rt.sleep ? 'sleeping' : s.rt.fakeState || 'ready', ask: null }),
    broadcastSession: (s) => b.broadcasts.push(['session', s.sessionId]),
    // 연결은 진짜 저장소에(backend.ensureLink·linkEvent와 같은 뜻)
    ensureLink(from, to, patch = {}) {
      let l = store.linkByPair(from, to);
      if (!l) { l = { linkId: 'l' + crypto.randomBytes(4).toString('hex'), from, to, role: patch.role ?? null, spawned: !!patch.spawned, observed: !!patch.observed, createdAt: Date.now() }; store.insertLink(l); }
      else { const f = {}; if (l.removedAt) f.removedAt = null; if (patch.role !== undefined && patch.role !== l.role) f.role = patch.role; if (Object.keys(f).length) store.updateLink(l.linkId, f); }
      return store.getLink(l.linkId);
    },
    linkEvent(l, kind, text = null, data = null, { quiet = false } = {}) {
      const e = store.addLinkEvent(l.linkId, kind, text, data);
      const f = { lastKind: kind, lastAt: e.t, count: (l.count || 0) + 1 };
      if (kind === 'prompt') f.lastText = String(text || '').slice(0, 300);
      if (!quiet || kind === 'prompt') store.updateLink(l.linkId, f);
      return e;
    },
    queue: { enqueue: (sid, text) => { b.queued.push({ sid, text }); const d = { deliveryId: 'd' + b.queued.length, sessionId: sid, text, status: 'queued' }; b.deliveries.set(d.deliveryId, d); return { ...d }; } },
    deliveries: new Map(),
    async spawn(p) {
      const id = crypto.randomUUID();
      const s = { sessionId: id, name: p.name, cwd: p.cwd, paneId: `w${b.spawned.length + 2}:p1`, agentName: p.name, model: p.model, effort: p.effort, permissionMode: p.permissionMode, kind: p.kind || 'claude', origin: 'board', parentSessionId: p.parentSessionId || null, workspaceKey: (await workspaceOf(p.cwd)).key, rt: newRuntime({ kind: p.kind || 'claude' }), createdAt: Date.now() + b.spawned.length };
      if (p.branch && p.branch.head) s.rt.fakeState = 'starting'; // 막 띄운 헤드는 아직 준비 전(진짜 판처럼)
      store.insertSession({ ...s, settingsPath: '', hookToken: '', runtime: s.rt });
      b.sessions.set(id, s);
      if (p.branch) b.branch.noteChild(id, p.branch);
      const place = p.branch && !p.branch.head ? b.branch.placeChild(p.parentSessionId, s.workspaceKey) : null;
      store.setNode({ session_id: id, x: place ? place.x : 0, y: place ? place.y : 5000 + b.spawned.length * 600, w: 720, h: 460 });
      b.spawned.push({ ...p, place });
      return { sessionId: id, trust: { needsTrust: false } };
    },
    closeSession(s, reason) { b.sessions.delete(s.sessionId); store.updateSession(s.sessionId, { closedAt: Date.now() }); b.bus.emit('closed', s, reason); },
    async kill({ session }) { const s = b.sessions.get(session); b.closeSession(s, 'killed'); b.killed.push(s.name); return { closed: true }; },
  };
  b.store.getDelivery = (id) => b.deliveries.get(id) || null;
  b.branch = new Branch(b, { readyWaitMs: 30, submitWaitMs: 10, noticeBatchMs: batchMs });
  const lead = mk(b, { name: 'lead', cwd: dir, workspaceKey: ws.key });
  store.setNode({ session_id: lead.sessionId, x: 0, y: 0, w: 720, h: 460 });
  return { b, dir, lead, ws };
}
function mk(b, o) {
  const s = { sessionId: crypto.randomUUID(), paneId: 'w1:p1', agentName: o.name, model: 'haiku', effort: 'low', permissionMode: 'acceptEdits', kind: 'claude', origin: 'board', parentSessionId: null, rt: newRuntime({ kind: 'claude' }), createdAt: 1, ...o };
  b.store.insertSession({ ...s, settingsPath: '', hookToken: '', runtime: s.rt });
  b.sessions.set(s.sessionId, s);
  return s;
}
const notices = (b, s) => b.queued.filter((q) => q.sid === s.sessionId && /^\[Atrium 보드\]/.test(q.text) && q.text.includes(ME_LINE));

// ---------- 알림 묶기(순수) ----------
test('P81 알림 글: 한 줄이면 그대로, 여럿이면 목록. 끝에 atrium me와 "알겠다"', () => {
  const one = noticeText(['@w1가 닫혔다(사람이 닫음).']);
  assert.equal(one.split('\n')[0], '[Atrium 보드] @w1가 닫혔다(사람이 닫음).');
  assert.ok(one.endsWith(`${ME_LINE}\n${ACK_LINE}`));
  const two = noticeText(['a', 'b']).split('\n');
  assert.deepEqual(two.slice(0, 3), ['[Atrium 보드] 연결이 바뀌었다.', '- a', '- b']);
  assert.equal(closeWhy('killed'), '사람이 닫음');
  assert.equal(closeWhy('pane exited'), '스스로 끝남');
  assert.equal(closeWhy('pane closed outside board'), '패널 사라짐');
  assert.equal(closeWhy('pane gone'), '패널 사라짐');
});

test('P81 알림 묶기: 같은 세션의 짧은 사이 알림은 한 번에, 보낼 수 없으면 버린다', async () => {
  const sent = [], dropped = [];
  let open = true;
  const nb = new NoticeBatcher({ batchMs: 20, canSend: () => open, send: (sid, text, lines) => sent.push({ sid, lines }), onDrop: (sid, lines) => dropped.push(lines) });
  nb.add('p', 'x'); nb.add('p', 'y'); nb.add('p', 'x'); nb.add('q', 'z');
  assert.equal(sent.length, 0);
  await tick(50);
  assert.deepEqual(sent, [{ sid: 'p', lines: ['x', 'y'] }, { sid: 'q', lines: ['z'] }]);
  nb.add('p', 'w'); open = false;
  await tick(50);
  assert.equal(sent.length, 2, '보낼 때 닫혔으면 보내지 않는다');
  assert.deepEqual(dropped, [['w']]);
  assert.equal(nb.add('p', 'v'), false, '넣을 때 보낼 수 없으면 바로 버린다');
});

// ---------- atrium me ----------
test('P81 atrium me: 부모 없음·있음·닫힘, 하위 세션(순서), 역할 연결 양쪽, 마지막 지시, 끊긴 연결·닫힌 하위 세션은 뺌', async () => {
  const { b, lead } = await fakeBoard();
  const r0 = b.branch.me(lead);
  assert.equal(r0.parent, null); assert.deepEqual(r0.children, []); assert.deepEqual(r0.roles, []);
  assert.equal(r0.me.name, 'lead'); assert.equal(r0.me.agentName, 'lead');
  const w1 = await b.branch.spawnChild(lead, { name: 'w1', prompt: 'build the parser\nsecond line', wait: false });
  const w2 = await b.branch.spawnChild(lead, { name: 'w2', role: '리뷰어', wait: false });
  const W1 = b.sessions.get(w1.sessionId);
  // 역할 연결 양쪽: lead → rev(리뷰어, 하위 세션 아님), boss → lead(감독)
  const rev = mk(b, { name: 'rev', cwd: lead.cwd, workspaceKey: lead.workspaceKey });
  const boss = mk(b, { name: 'boss', cwd: lead.cwd, workspaceKey: lead.workspaceKey });
  b.ensureLink(lead.sessionId, rev.sessionId, { role: '리뷰어' });
  const lb = b.ensureLink(boss.sessionId, lead.sessionId, { role: '감독' });
  b.linkEvent(lb, 'prompt', 'check the plan');
  const r1 = b.branch.me(lead);
  assert.deepEqual(r1.children.map((c) => [c.name, c.role, c.order]), [['w1', '워커', 1], ['w2', '리뷰어', 2]]);
  assert.equal(r1.children[0].last.text, 'build the parser', '지시 앞부분 한 줄');
  assert.ok(r1.children[0].last.at > 0);
  assert.equal(r1.children[1].last, null, '오간 지시가 없으면 없음');
  assert.deepEqual(r1.roles.map((x) => [x.dir, x.role, x.name]).sort(), [['in', '감독', 'boss'], ['out', '리뷰어', 'rev']]);
  assert.equal(r1.roles.find((x) => x.dir === 'in').last.text, 'check the plan');
  // 하위 세션 쪽: 부모와 역할, 순서
  const r2 = b.branch.me(W1);
  assert.equal(r2.parent.name, 'lead'); assert.equal(r2.parent.role, '워커'); assert.equal(r2.parent.order, 1); assert.equal(r2.parent.closed, false);
  assert.equal(r2.parent.last.text, 'build the parser');
  assert.deepEqual(r2.roles, [], '부모 → 나 선은 부모 줄에만');
  // 끊긴 연결과 닫힌 하위 세션은 빠진다
  b.store.updateLink(b.store.linkByPair(lead.sessionId, rev.sessionId).linkId, { removedAt: Date.now() });
  await b.branch.killChild(lead, { name: 'w2' });
  const r3 = b.branch.me(lead);
  assert.deepEqual(r3.children.map((c) => c.name), ['w1']);
  assert.deepEqual(r3.roles.map((x) => x.name), ['boss']);
  assert.ok(w2);
  // 부모가 닫힘
  b.closeSession(lead, 'killed');
  const r4 = b.branch.me(W1);
  assert.equal(r4.parent.name, 'lead'); assert.equal(r4.parent.closed, true); assert.equal(r4.parent.state, 'closed');
  b.branch.notices.stop();
});

// ---------- HTTP와 명령(atrium me, --json, --head) ----------
function serve(b) {
  const srv = http.createServer((req, res) => { if (!b.branch.handleHttp(req, res)) { res.writeHead(404); res.end(); } });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => { b.cfg.port = srv.address().port; r(srv); }));
}
function runChild(args, env) {
  return new Promise((resolve) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('MTASK_') && !k.startsWith('ATRIUM_')));
    execFile(process.execPath, [path.join(HERE, '..', 'bin', 'atrium-child.mjs'), ...args], { env: { ...clean, ...env }, timeout: 20000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}
test('P81 명령: atrium me 글(20줄 안, 부모 없음·부모와 역할), --json은 같은 내용, --head 응답 글', async () => {
  const { b, lead } = await fakeBoard();
  const srv = await serve(b);
  try {
    const env = b.branch.envFor(lead.sessionId);
    const ok = await runChild(['child', 'w1', '--no-wait', '--prompt', 'do the thing'], env);
    assert.equal(ok.code, 0, ok.stderr);
    const me = await runChild(['me'], env);
    assert.equal(me.code, 0, me.stderr);
    const lines = me.stdout.trim().split('\n');
    assert.ok(lines.length <= 20, me.stdout);
    assert.match(lines[0], /^나: @lead \(herdr lead/);
    assert.match(me.stdout, /부모: 부모 없음/);
    assert.match(me.stdout, /하위 세션 1개:\n {2}@w1 \(herdr w1\) 워커 1 · ready · 마지막 지시 \d+초 전 "do the thing"/);
    assert.match(me.stdout, /일 시키기: herdr agent prompt <이름>/);
    const w1 = [...b.sessions.values()].find((x) => x.name === 'w1');
    const meW = await runChild(['me'], b.branch.envFor(w1.sessionId));
    assert.match(meW.stdout, /부모: @lead \(herdr lead, ready\) — 너는 @lead의 워커 1/);
    const js = await runChild(['me', '--json'], env);
    const j = JSON.parse(js.stdout);
    assert.equal(j.children[0].name, 'w1'); assert.equal(j.parent, null); assert.equal(j.me.name, 'lead');
    // --head: 응답 글
    const h = await runChild(['child', 'h1', '--head', '--prompt', 'lead the other repo'], env);
    assert.equal(h.code, 0, h.stderr);
    assert.match(h.stdout, /헤드로 띄웠다: @h1 .*너의 워커가 아니다\. 첫 요청 뒤 보드가 부모 관계를 (뗀다|뗐다)/);
    assert.ok(!/너의 하위 세션 \d+개/.test(h.stdout));
    const bad = await runChild(['child', 'h2', '--head', '--worktree', 'x'], env);
    assert.notEqual(bad.code, 0); assert.match(bad.stderr, /--head와 --worktree는 함께 쓰지 않는다/);
    const nope = await runChild(['kill', 'w1'], env);
    assert.match(nope.stderr, /me, child, children/);
  } finally { srv.close(); b.branch.notices.stop(); }
});

// ---------- 떼기 ----------
for (const by of ['head', 'user']) test(`P81 quota: ${by} detach preserves creation provenance and the global cap across SQLite reload`, async (t) => {
  const { b, dir, lead } = await fakeBoard();
  t.after(() => { b.branch.notices.stop(); b.store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  b.store.setMeta('settings', { branchMaxTotal: 2 });
  const ids = [];
  for (const name of ['quota-one', 'quota-two']) {
    const out = await b.branch.spawnChild(lead, { name, head: by === 'head', wait: false });
    const s = b.sessions.get(out.sessionId);
    ids.push(s.sessionId);
    const creation = { ...s.rt.branchOrigin };
    const visible = b.branch.info.get(s.sessionId);
    b.branch.noteChild(s.sessionId, { ...visible, by: 'later-parent', at: creation.at + 1, creation: { by: 'replacement', at: 0 } });
    assert.deepEqual(s.rt.branchOrigin, creation, 'later branch updates cannot replace the creation record');
    b.branch.noteChild(s.sessionId, visible);
    if (by === 'head') {
      s.rt.fakeState = 'ready';
      assert.equal(b.branch.maybeHead(s, 'ready'), true);
    } else b.branch.detach(s, { by, notify: false });
    assert.equal(s.parentSessionId, null);
    assert.equal(b.branch.depth(s.sessionId), 1);
    assert.equal(b.branch.info.has(s.sessionId), false);
    assert.equal(b.branch.openTotal(), ids.length, 'detached sessions still consume the global agent-created quota');
    assert.equal(s.rt.branchOrigin.by, lead.sessionId);
    assert.equal(s.rt.branchOrigin.via, 'atrium child');
    assert.deepEqual(b.store.getSession(s.sessionId).runtime.branchOrigin, s.rt.branchOrigin);
  }
  assert.equal(b.branch.openChildren(lead.sessionId).length, 0);
  for (const name of ['quota-three', 'quota-four']) await assert.rejects(
    b.branch.spawnChild(lead, { name, head: true, wait: false }),
    (e) => e.code === 'board_full' && e.limit === 2 && e.now === 2,
  );
  const expected = new Map(ids.map((id) => [id, { ...b.sessions.get(id).rt.branchOrigin }]));
  // A runtime rebuild can lose unknown fields. The immutable row provenance
  // must still enforce the quota and restore its runtime mirror on reload.
  for (const id of ids) {
    const { branchOrigin, ...rebuiltRuntime } = b.sessions.get(id).rt;
    b.store.saveRuntime(id, rebuiltRuntime);
  }
  b.branch.notices.stop(); b.store.close();
  b.store = new Store(path.join(dir, 'board.db'));
  // No shared runtime or Branch state survives this reload.
  b.sessions = new Map(b.store.openSessions().map(({ runtime, ...row }) => [row.sessionId, { ...row, rt: runtime }]));
  b.bus = new EventEmitter();
  b.branch = new Branch(b);
  assert.equal(b.branch.openTotal(), 2);
  const reloadedLead = b.sessions.get(lead.sessionId);
  for (const id of ids) {
    assert.equal(b.branch.depth(id), 1);
    assert.equal(b.branch.info.has(id), false);
    assert.deepEqual(b.sessions.get(id).rt.branchOrigin, expected.get(id));
  }
  await assert.rejects(b.branch.spawnChild(reloadedLead, { name: 'quota-reloaded', head: true, wait: false }), (e) => e.code === 'board_full');
  b.sessions.delete(ids[0]);
  assert.equal(b.branch.openTotal(), 1, 'quota releases only when a created session leaves the live board');
});

test('P81 떼기: 부모 기록·하위 세션 기록·역할 선을 지우고(오간 기록은 남김), children·child-kill 범위·잠재우기 묶음에서 빠지고, 아래는 그대로(단계만 다시), 다시 켜도 그대로', async () => {
  const { b, lead } = await fakeBoard();
  const r = await b.branch.spawnChild(lead, { name: 'b1', prompt: 'go', wait: false });
  const B = b.sessions.get(r.sessionId);
  const g = await b.branch.spawnChild(B, { name: 'g1', wait: false });
  const G = b.sessions.get(g.sessionId);
  assert.equal(b.branch.depth(G.sessionId), 3);
  // 잠재우기 묶음(sleep.mjs info): 떼기 전에는 B가 바쁘면 lead가 child_busy
  const busy = new Set([B.sessionId]);
  b.queue.pending = (sid) => (busy.has(sid) ? 1 : 0);
  b.relay = { stats: () => [] }; b.cfg.claudeProjects = path.join(b.cfg.dataDir, 'projects');
  const sl = new Sleeper(b, { timers: false });
  assert.equal(sl.info(lead).childBusy, true);
  const l = b.store.linkByPair(lead.sessionId, B.sessionId);
  assert.equal(l.role, '워커');
  const out = b.branch.detach(B, { by: 'user' });
  assert.deepEqual(out, { detached: true, name: 'b1', from: 'lead', by: 'user' });
  assert.equal(B.parentSessionId, null);
  assert.equal(b.store.getSession(B.sessionId).parentSessionId, null);
  assert.equal(b.branch.info.has(B.sessionId), false);
  assert.deepEqual(b.store.branchRows().find((x) => x.sessionId === B.sessionId).branch, { detached: true, creation: B.rt.branchOrigin });
  const l2 = b.store.getLink(l.linkId);
  assert.ok(l2.removedAt); assert.equal(l2.role, null);
  assert.ok(b.store.linkEvents(l.linkId).some((e) => e.kind === 'prompt'), '오간 기록은 남는다');
  assert.ok(b.store.linkEvents(l.linkId).some((e) => e.kind === 'unlink' && e.data.why === 'detach'));
  assert.deepEqual(b.branch.listChildren(lead, {}).children, []);
  const sx = b.branch.summaryExtra(B).branch;
  assert.equal(sx.parentSessionId, null); assert.equal(sx.role, null); assert.equal(sx.child, false); assert.equal(sx.depth, 1);
  assert.equal(b.branch.summaryExtra(lead).branch.children, 0);
  await assert.rejects(b.branch.killChild(lead, { name: 'b1' }), (e) => e.code === 'not_parent');
  await assert.rejects(b.branch.killChild(lead, { name: 'g1' }), (e) => e.code === 'not_parent', '손자도 범위 밖');
  await assert.rejects(b.branch.waitChild(lead, { name: 'b1' }), (e) => e.code === 'not_parent');
  assert.equal(sl.info(lead).childBusy, false, '잠재우기 묶음이 풀린다');
  busy.clear(); busy.add(lead.sessionId);
  assert.equal(sl.info(B).parentBusy, false);
  // B 아래는 그대로, 단계만 다시
  assert.equal(G.parentSessionId, B.sessionId);
  assert.equal(b.branch.depth(G.sessionId), 2);
  assert.equal(b.branch.info.get(G.sessionId).depth, 2);
  assert.deepEqual(b.branch.listChildren(B, {}).children.map((c) => c.name), ['g1']);
  // 다시 하면 no_parent, 다시 켜도 그대로
  assert.throws(() => b.branch.detach(B), (e) => e.code === 'no_parent');
  const again = new Branch(b, { readyWaitMs: 30 });
  assert.equal(again.info.has(B.sessionId), false);
  assert.equal(b.store.getSession(B.sessionId).parentSessionId, null);
  assert.equal(again.depth(G.sessionId), 2);
  b.branch.notices.stop(); again.notices.stop();
});

test('P81 떼기: 신뢰 관문을 지나는 중이면 거부한다', async () => {
  const { b, lead } = await fakeBoard();
  const r = await b.branch.spawnChild(lead, { name: 'b1', wait: false });
  b.branch.noteChild(r.sessionId, { ...b.branch.info.get(r.sessionId), gate: 'trust' });
  assert.throws(() => b.branch.detach(b.sessions.get(r.sessionId)), (e) => e.code === 'gated');
});

// ---------- 알림 ----------
test('P81 알림: 사람이 떼면 옛 부모와 뗀 세션에게, 하위 세션이 닫히면 부모에게(까닭), 짧은 사이는 하나로, child-kill이면 안 보냄, 잠든 세션에는 안 보냄', async () => {
  const { b, lead } = await fakeBoard({ batchMs: 40 });
  b.store.setMeta('settings', { branchMaxChildren: 5 });
  const kids = [];
  for (const n of ['k1', 'k2', 'k3', 'k4', 'k5']) kids.push(b.sessions.get((await b.branch.spawnChild(lead, { name: n, wait: false })).sessionId));
  const base = b.queued.length;
  b.branch.detach(kids[0], { by: 'user' });
  // 사람이 닫음, 스스로 끝남, 패널 사라짐. 모두 부모의 한 턴으로
  b.closeSession(kids[1], 'killed'); b.closeSession(kids[2], 'pane exited'); b.closeSession(kids[3], 'pane closed outside board');
  assert.equal(b.queued.length, base, '묶는 동안은 보내지 않는다');
  await tick(90);
  const toLead = notices(b, lead);
  assert.equal(toLead.length, 1, '부모의 턴은 하나');
  const t = toLead[0].text;
  assert.match(t, /^\[Atrium 보드\] 연결이 바뀌었다\./);
  assert.match(t, /- @k1는 이제 너의 하위 세션이 아니다\. 일을 시키지 마라\./);
  assert.match(t, /- @k2가 닫혔다\(사람이 닫음\)\./);
  assert.match(t, /- @k3가 닫혔다\(스스로 끝남\)\./);
  assert.match(t, /- @k4가 닫혔다\(패널 사라짐\)\./);
  assert.ok(t.endsWith('지금 연결은 `atrium me`.\n이 알림에는 "알겠다"고만 답해라.'));
  const toK1 = notices(b, kids[0]);
  assert.equal(toK1.length, 1);
  assert.equal(toK1[0].text.split('\n')[0], '[Atrium 보드] 너는 이제 부모 없는 세션이다(@lead에서 뗌).');
  assert.ok(b.store.events({}).some((e) => e.kind === 'link_notice'));
  // child-kill이면 보내지 않는다
  const before = b.queued.length;
  await b.branch.killChild(lead, { name: 'k5' });
  await tick(90);
  assert.equal(b.queued.length, before);
  // 잠든 부모에는 보내지 않는다(깨우지 않는다)
  const k6 = b.sessions.get((await b.branch.spawnChild(lead, { name: 'k6', wait: false })).sessionId);
  lead.rt.sleep = { at: Date.now() };
  const n0 = b.queued.length;
  b.closeSession(k6, 'killed');
  await tick(90);
  assert.equal(b.queued.length, n0);
  assert.ok(b.store.events({}).some((e) => e.kind === 'link_notice_dropped'));
  // 묶는 사이에 잠들어도 보내지 않는다
  lead.rt.sleep = null;
  const k7 = b.sessions.get((await b.branch.spawnChild(lead, { name: 'k7', wait: false })).sessionId);
  const n1 = b.queued.length;
  b.closeSession(k7, 'killed');
  lead.rt.sleep = { at: Date.now() };
  await tick(90);
  assert.equal(b.queued.length, n1);
  // 부모가 함께 닫히면 버린다
  lead.rt.sleep = null;
  const k8 = b.sessions.get((await b.branch.spawnChild(lead, { name: 'k8', wait: false })).sessionId);
  const n2 = b.queued.length;
  b.closeSession(k8, 'killed'); b.closeSession(lead, 'killed');
  await tick(90);
  assert.equal(b.queued.length, n2);
});

// ---------- --head ----------
test('P81 --head: 자리는 하위 세션 줄이 아니고, 신뢰 질문 동안은 부모를 두고, 첫 요청이 끝나면(들어감·못 들어감) 판이 알림 없이 뗀다. 첫 요청이 없으면 준비되면', async () => {
  const { b, lead } = await fakeBoard();
  const other = tmp();
  const r = await b.branch.spawnChild(lead, { name: 'h1', head: true, cwd: other, prompt: 'lead the other repo', wait: false });
  const H = b.sessions.get(r.sessionId);
  assert.equal(r.role, '헤드'); assert.deepEqual(r.head, { detached: false });
  assert.match(r.notice, /헤드로 띄웠다\. 너의 워커가 아니다/);
  assert.equal(b.spawned.at(-1).place, null, '하위 세션 줄 자리가 아니다');
  assert.equal(b.spawned.at(-1).branch.head, true);
  assert.equal(H.parentSessionId, lead.sessionId);
  const did = r.firstPrompt.deliveryId;
  b.deliveries.set(did, { deliveryId: did, status: 'queued' });
  b.bus.emit('session', H, { state: 'trust_wait' });
  b.bus.emit('session', H, { state: 'ready' });
  assert.equal(H.parentSessionId, lead.sessionId, '첫 요청이 아직 안 들어갔다(신뢰 질문 동안 부모 유지)');
  const n0 = b.queued.length;
  b.deliveries.set(did, { deliveryId: did, status: 'confirmed' });
  b.branch.onDeliveryEnd({ deliveryId: did, status: 'confirmed' });
  assert.equal(H.parentSessionId, null, '들어가면 뗀다');
  assert.equal(b.branch.info.has(H.sessionId), false);
  assert.ok(b.store.linkByPair(lead.sessionId, H.sessionId).removedAt);
  await tick(60);
  assert.equal(b.queued.length, n0, '헤드 떼기는 알리지 않는다');
  assert.ok(b.store.events({}).some((e) => e.kind === 'detached' && e.data.by === 'head'));
  // 못 들어감(P79 알림 뒤)도 뗀다
  const r2 = await b.branch.spawnChild(lead, { name: 'h2', head: true, cwd: other, prompt: 'x', wait: false });
  const H2 = b.sessions.get(r2.sessionId);
  b.branch.onDeliveryEnd({ deliveryId: r2.firstPrompt.deliveryId, status: 'unconfirmed', reason: 'no hook' });
  assert.ok(b.queued.some((q) => q.sid === lead.sessionId && /첫 요청이 들어가지 않았다/.test(q.text)), 'P79 알림이 먼저');
  assert.equal(H2.parentSessionId, null);
  // 첫 요청 없음: 준비되면 뗀다. 신뢰 질문 동안은 둔다
  const r3 = await b.branch.spawnChild(lead, { name: 'h3', head: true, cwd: other, wait: false });
  const H3 = b.sessions.get(r3.sessionId);
  b.bus.emit('session', H3, { state: 'trust_wait' });
  assert.equal(H3.parentSessionId, lead.sessionId);
  b.bus.emit('session', H3, { state: 'ready' });
  assert.equal(H3.parentSessionId, null);
  // 보통 하위 세션은 준비돼도 떼지 않는다
  const w = await b.branch.spawnChild(lead, { name: 'w1', wait: false });
  b.bus.emit('session', b.sessions.get(w.sessionId), { state: 'ready' });
  assert.equal(b.sessions.get(w.sessionId).parentSessionId, lead.sessionId);
  await assert.rejects(b.branch.spawnChild(lead, { name: 'h4', head: true, worktree: 'x', wait: false }), (e) => e.code === 'bad_request');
  b.branch.notices.stop();
});

test('P81 --head: 판이 다시 켜져도(기록의 headPrompt) 첫 요청이 끝났으면 뗀다', async () => {
  const { b, lead } = await fakeBoard();
  const r = await b.branch.spawnChild(lead, { name: 'h1', head: true, cwd: tmp(), prompt: 'go', wait: false });
  const H = b.sessions.get(r.sessionId);
  b.deliveries.set(r.firstPrompt.deliveryId, { deliveryId: r.firstPrompt.deliveryId, status: 'confirmed' });
  b.branch.notices.stop();
  b.bus.removeAllListeners();
  b.branch = new Branch(b, { readyWaitMs: 30 }); // 다시 켬: firstOf는 비었다
  assert.equal(b.branch.info.get(H.sessionId).headPrompt, r.firstPrompt.deliveryId);
  b.bus.emit('session', H, { state: 'ready' });
  assert.equal(H.parentSessionId, null);
});

// ---------- 판 API(session.detach, link.delete의 부모에서도 떼기) ----------
test('P81 API: session.detach와 link.delete(부모 선이면 고르기, detach면 떼기), 닫힘 까닭, 헤드 자리', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'backend.mjs'), 'utf8');
  assert.match(src, /'session\.detach': \(p\) => this\.detachSession\(p\)/);
  assert.match(src, /parentLink: \{ parent: a\.name, child: b\.name \}/);
  assert.match(src, /if \(p\.detach\) \{[\s\S]{0,200}this\.branch\.detach\(b, \{ by: 'user' \}\)/);
  assert.match(src, /m\('detach', \{ name: s\.name, parent: pname \}\)/);
  assert.match(src, /this\.bus\.emit\('closed', s, reason\)/);
  assert.match(src, /p\.branch && !p\.branch\.head \? this\.branch\.placeChild/);
});

// ---------- 안내와 스킬 ----------
test('P81 안내와 스킬: 짧은 안내에 atrium me 한 줄, 스킬에 atrium me와 --head, 승인 규칙에 atrium me', () => {
  const line = BOARD_SYSTEM_PROMPT.split('\n').find((l) => l.includes('atrium me'));
  assert.ok(line && /지금 기록/.test(line) && /예전 알림과 다르면 이것을 믿는다/.test(line) && /매 턴 치지는 않는다/.test(line), line);
  const skill = boardSkill('atrium');
  for (const w of ['atrium me', '--head', '첫 요청 뒤 보드가 떼므로', '시키거나 기다리지 않는다']) assert.ok(skill.includes(w), w);
  assert.equal(boardSkill('delegate').split('\n---\n')[1], skill.split('\n---\n')[1]);
  for (const r of ['Bash(atrium me)', 'Bash(atrium me *)', 'PowerShell(atrium me)', 'Bash(mtask me)']) assert.ok(BRANCH_ALLOW.includes(r), r);
});
