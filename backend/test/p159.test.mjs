// P159 단위 시험: 계보로만 움직이던 동작을 일 관계(하위·동료·독립, P156)로. 잠재우기 묶음, 작업 완료 세기, 닫힘 알림 받는 이, 떼기 = 독립.
// herdr·hc와 claude 없이 돈다(p156 시험의 가짜 판 틀).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { Branch } from '../src/branch.mjs';
import { Sleeper } from '../src/sleep.mjs';
import { Backend } from '../src/backend.mjs';
import { workspaceOf } from '../src/git.mjs';
import { promptTask, isBoardNotice } from '../src/text.mjs';
import { applyHook } from '../src/state.mjs';
import { treeIndex, cycleCheck } from '../src/push-cycle.mjs';
import { relationHeader } from '../src/branch-relations.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p159-'));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ---------- 가짜 판(p156과 같은 틀) ----------
async function fakeBoard() {
  const dir = tmp();
  const store = new Store(path.join(dir, 'board.db'));
  const ws = await workspaceOf(dir);
  store.insertWorkspace({ ...ws, createdAt: 1 });
  const b = {
    cfg: { profile: 'dev', terminalSession: 'atrium-dev-p159test', port: 0, dataDir: dir, claudeProjects: path.join(dir, 'projects') }, apiToken: 'board-api-token', store, sessions: new Map(), bus: new EventEmitter(),
    broadcasts: [], spawned: [], queued: [], killing: new Set(),
    api: { broadcast: (e, d) => b.broadcasts.push([e, d]) }, log: () => {}, requireTerminal: () => {},
    hooked: (s) => s.kind === 'claude' && s.origin === 'board',
    summary: (s) => ({ state: s.rt.sleep ? 'sleeping' : 'ready', ask: null }),
    broadcastSession: (s) => b.broadcasts.push(['session', s.sessionId]),
    relay: { stats: () => [] },
    ensureLink(from, to, patch = {}) {
      let l = store.linkByPair(from, to);
      if (!l) { l = { linkId: 'l' + crypto.randomBytes(4).toString('hex'), from, to, role: patch.role ?? null, spawned: !!patch.spawned, observed: !!patch.observed, createdAt: Date.now() }; store.insertLink(l); }
      else { const f = {}; if (l.removedAt) f.removedAt = null; if (patch.role !== undefined && patch.role !== l.role) f.role = patch.role; if (Object.keys(f).length) store.updateLink(l.linkId, f); }
      return store.getLink(l.linkId);
    },
    linkEvent(l, kind, text = null, data = null) { return store.addLinkEvent(l.linkId, kind, text, data); },
    queue: { pending: () => 0, enqueue: (sid, text) => { b.queued.push({ sid, text }); return { deliveryId: 'd' + b.queued.length, sessionId: sid, text, status: 'queued' }; } },
    async spawn(p) {
      const id = crypto.randomUUID();
      const s = { sessionId: id, name: p.name, cwd: p.cwd, paneId: `w${b.spawned.length + 2}:p1`, agentName: p.name, model: p.model, effort: p.effort, permissionMode: p.permissionMode, kind: 'claude', origin: 'board', parentSessionId: p.parentSessionId || null, workspaceKey: (await workspaceOf(p.cwd)).key, rt: newRuntime({ kind: 'claude' }), createdAt: Date.now() + b.spawned.length };
      store.insertSession({ ...s, settingsPath: '', hookToken: '', runtime: s.rt });
      b.sessions.set(id, s);
      if (p.branch) b.branch.noteChild(id, p.branch);
      store.setNode({ session_id: id, x: 0, y: 5000 + b.spawned.length * 600, w: 720, h: 460 });
      b.spawned.push(p);
      return { sessionId: id, trust: { needsTrust: false } };
    },
    closeSession(s, reason) { b.sessions.delete(s.sessionId); store.updateSession(s.sessionId, { closedAt: Date.now() }); b.bus.emit('closed', s, reason); },
  };
  b.store.getDelivery = () => null;
  b.branch = new Branch(b, { readyWaitMs: 30, submitWaitMs: 10, noticeBatchMs: 20 });
  const lead = mk(b, { name: 'lead', cwd: dir, workspaceKey: ws.key });
  return { b, dir, lead, ws };
}
function mk(b, o) {
  const s = { sessionId: crypto.randomUUID(), paneId: 'w1:p1', agentName: o.name, model: 'haiku', effort: 'low', permissionMode: 'acceptEdits', kind: 'claude', origin: 'board', parentSessionId: null, rt: newRuntime({ kind: 'claude' }), createdAt: 1, ...o };
  b.store.insertSession({ ...s, settingsPath: '', hookToken: '', runtime: s.rt });
  b.sessions.set(s.sessionId, s);
  return s;
}
const byName = (b, n) => [...b.sessions.values()].find((x) => x.name === n);
const setUser = (b, a, x, rel) => b.branch.setRelation(a, x, rel, { source: 'user', by: 'user', quiet: true });

// 리드 + 하위(w1) + 동료(p1, --peer) + 사람이 하위로 둔 세션(x, 계보 없음) + 독립으로 둔 하위(w2)
async function team() {
  const f = await fakeBoard();
  const { b, lead, dir, ws } = f;
  await b.branch.spawnChild(lead, { name: 'w1', wait: false });
  await b.branch.spawnChild(lead, { name: 'p1', peer: true, wait: false });
  await b.branch.spawnChild(lead, { name: 'w2', wait: false });
  const x = mk(b, { name: 'x', cwd: dir, workspaceKey: ws.key });
  setUser(b, lead, x, 'sub');
  setUser(b, lead, byName(b, 'w2'), 'none');
  return { ...f, w1: byName(b, 'w1'), p1: byName(b, 'p1'), w2: byName(b, 'w2'), x };
}

test('P159 잠재우기 묶음: 하위는 함께(사람이 정한 하위 포함), 동료·독립은 따로', async () => {
  const { b, lead, w1, p1, w2, x } = await team();
  const busy = new Set();
  b.queue.pending = (sid) => (busy.has(sid) ? 1 : 0); // 전달 대기 = 일하는 중(sleep.mjs busy)
  const ready = () => { for (const s of b.sessions.values()) Object.assign(s.rt.term, { status: 'idle', present: true, launchPending: false }); };
  ready();
  const sl = new Sleeper(b, { timers: false });
  const info = (s) => sl.info(s);
  assert.deepEqual([info(lead).childBusy, info(lead).descBusy], [false, false]);
  busy.add(w1.sessionId);
  assert.equal(info(lead).childBusy, true, '하위가 일하면 리드는 깨어 있다');
  busy.clear(); busy.add(x.sessionId);
  assert.equal(info(lead).childBusy, true, '사람이 하위로 둔 세션(계보 없음)도 묶음');
  assert.equal(info(lead).descBusy, true);
  busy.clear(); busy.add(p1.sessionId);
  assert.deepEqual([info(lead).childBusy, info(lead).descBusy], [false, false], '동료는 리드를 깨워 두지 않는다');
  busy.clear(); busy.add(w2.sessionId);
  assert.deepEqual([info(lead).childBusy, info(lead).descBusy], [false, false], '독립도 따로');
  busy.clear(); busy.add(lead.sessionId);
  assert.equal(info(w1).parentBusy, true);
  assert.equal(info(x).parentBusy, true);
  assert.equal(info(p1).parentBusy, false, '일하는 리드가 동료를 깨워 두지 않는다');
  assert.equal(info(w2).parentBusy, false);
  // 동료의 하위는 동료 묶음
  await b.branch.spawnChild(p1, { name: 'p1w', wait: false });
  ready();
  busy.clear(); busy.add(byName(b, 'p1w').sessionId);
  assert.equal(info(p1).childBusy, true);
  assert.equal(info(lead).descBusy, false, '동료 아래 일은 리드의 자손이 아니다');
  sl.stop(); b.branch.notices.stop();
});

test('P159 작업 완료 세기: 일 부모가 열린 하위는 안 셈, 동료·독립은 셈, 일 부모가 닫히면 다시 셈', async () => {
  const { b, lead, w1, p1, w2, x } = await team();
  const me = { sessions: b.sessions, branch: b.branch, workParentOf: Backend.prototype.workParentOf };
  const ds = (s) => Backend.prototype.doneScope.call(me, s, { unseen: true });
  assert.deepEqual(ds(lead), { unseen: true, unseenSub: false });
  assert.deepEqual(ds(w1), { unseen: false, unseenSub: true });
  assert.deepEqual(ds(x), { unseen: false, unseenSub: true }, '사람이 하위로 둔 세션');
  assert.deepEqual(ds(p1), { unseen: true, unseenSub: false }, '동료는 맨 위 세션처럼');
  assert.deepEqual(ds(w2), { unseen: true, unseenSub: false }, '독립도');
  // 동료를 다시 하위로 두면 빠진다
  setUser(b, lead, p1, 'sub');
  assert.deepEqual(ds(p1), { unseen: false, unseenSub: true });
  // 리드가 닫히면 모두 셈
  b.sessions.delete(lead.sessionId);
  for (const s of [w1, x, p1]) assert.deepEqual(ds(s), { unseen: true, unseenSub: false });
  b.branch.notices.stop();
});

test('P159 부모가 닫히면 일 자식(사람이 정한 하위 포함) 요약을 다시 보내고, 동료는 보내지 않는다', async () => {
  const { b, lead, w1, p1, x } = await team();
  const sent = [];
  const fake = {
    sessions: b.sessions, branch: b.branch, workParentOf: Backend.prototype.workParentOf,
    queue: { cancelSession: () => {} }, relay: { detach: () => {} }, cfg: { sessionsDir: 'nowhere' },
    store: { docks: () => [], links: () => [], updateSession: () => {}, addEvent: () => {} },
    api: { broadcast: () => {} }, bus: { emit: (e, s, r) => b.bus.emit(e, s, r) }, adapter: { refreshSubscription: () => {} },
    broadcastSession: (s, o) => sent.push([s.name, o && o.onlyIfFlagsChanged]),
  };
  Backend.prototype.closeSession.call(fake, lead, 'killed');
  assert.deepEqual(sent.map((r) => r[0]).sort(), [w1.name, x.name].sort());
  assert.ok(!sent.some((r) => r[0] === p1.name));
  b.branch.notices.stop();
});

test('P159 닫힘 알림: 일 부모에게(계보 부모와 다르면 일 부모), 동료가 닫히면 띄운 짝에게 그대로, 독립으로 둔 세션도 띄운 쪽에', async () => {
  const { b, lead, w1, p1, w2, x, dir, ws } = await team();
  const other = mk(b, { name: 'other', cwd: dir, workspaceKey: ws.key });
  setUser(b, other, w1, 'sub'); // w1: 계보 부모 lead, 일 부모 other
  b.closeSession(w1, 'killed');
  b.closeSession(x, 'pane exited');
  b.closeSession(p1, 'killed');
  b.closeSession(w2, 'killed');
  await tick(60);
  const to = (s) => b.queued.filter((q) => q.sid === s.sessionId).map((q) => q.text).join('\n');
  assert.match(to(other), /@w1가 닫혔다\(사람이 닫음\)/);
  assert.doesNotMatch(to(lead), /@w1가 닫혔다/, '일 부모가 다르면 계보 부모에게는 보내지 않는다');
  assert.match(to(lead), /@x가 닫혔다\(스스로 끝남\)/, '사람이 하위로 둔 세션(계보 없음)');
  assert.match(to(lead), /@p1가 닫혔다/, '동료가 닫혀도 짝에게');
  assert.match(to(lead), /@w2가 닫혔다/);
  b.branch.notices.stop();
});

test('P159 떼기 = 독립: session.detach는 일 부모(사람이 정한 하위 포함)에서 독립으로 두고 계보는 남는다, 일 부모가 없으면 no_parent', async () => {
  const { b, lead, w1, p1, x } = await team();
  const r = b.branch.detach(x, { by: 'user' });
  assert.deepEqual(r, { detached: true, name: 'x', from: 'lead', by: 'user', relation: 'none' });
  assert.equal(b.branch.relIndex().between(lead.sessionId, x.sessionId).relation, 'none');
  assert.equal(x.parentSessionId, null, '계보가 없던 세션은 그대로 없다');
  b.branch.detach(w1, { by: 'user' });
  assert.equal(w1.parentSessionId, lead.sessionId, '계보는 사실로 남는다');
  assert.deepEqual(b.branch.relIndex().explicitOf(lead.sessionId, w1.sessionId).source, 'user');
  assert.throws(() => b.branch.detach(p1, { by: 'user' }), (e) => e.code === 'no_parent', '동료는 일 부모가 없다');
  await tick(60);
  assert.ok(b.queued.some((q) => q.sid === w1.sessionId && /사람이 독립으로 둠/.test(q.text)));
  assert.ok(b.queued.some((q) => q.sid === lead.sessionId && /@w1는 이제 너의 하위 세션이 아니다\(사람이 독립으로 둠\)/.test(q.text)));
  // 닫힌 일 부모에서도 독립으로 둔다(관계 줄만, 선은 열지 않는다)
  const f = await team();
  f.b.closeSession(f.lead, 'killed');
  const links0 = f.b.store.links().filter((l) => !l.removedAt).length;
  f.b.branch.detach(f.w1, { by: 'user' });
  assert.equal(f.b.branch.relIndex().workParentOf(f.w1.sessionId), null);
  assert.equal(f.b.store.links().filter((l) => !l.removedAt).length, links0);
  b.branch.notices.stop(); f.b.branch.notices.stop();
});

test('P159 API 글: session.detach·link.delete는 일 부모를 보고, 떼기 확인은 독립으로 두기, --head는 계보를 지운다', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'backend.mjs'), 'utf8');
  assert.match(src, /const parentLink = !!\(a && b && this\.workParentOf\(b\.sessionId\) === a\.sessionId\)/);
  assert.match(src, /const pid = this\.workParentOf\(s\.sessionId\);\r?\n\s+if \(!pid\) throw keyed\(apiError\('no_parent'/);
  const br = fs.readFileSync(path.join(HERE, '..', 'src', 'branch.mjs'), 'utf8');
  assert.match(br, /if \(by === 'user'\) return this\.independent\(s, \{ notify \}\);/);
  assert.match(br, /maybeHead[\s\S]*this\.detach\(s, \{ by: 'head'/);
});

// ---------- 2차: 관계 줄 + 지시는 지시, 웹 푸시 사이클은 일 관계 ----------
test('P159 관계 줄 + 지시: 관계 줄만 떼고 나머지가 지시(lastPrompt), 알림뿐이면 걸러진다', () => {
  const sub = `${relationHeader({ relation: 'sub', parent: 'lead' })}\n\nReply with exactly: worker ready`;
  const peer = `${relationHeader({ relation: 'peer', parent: 'lead' })}\n\ncrawl the site\nsecond line`;
  assert.equal(promptTask(sub), 'Reply with exactly: worker ready');
  assert.equal(promptTask(peer), 'crawl the site\nsecond line');
  assert.equal(isBoardNotice(sub), false); assert.equal(isBoardNotice(peer), false);
  // 알림뿐: 관계 줄만, 연결 알림, 관계 줄 뒤가 또 알림, 옛 이름
  for (const n of [relationHeader({ relation: 'peer', parent: 'lead' }), '[Atrium 보드] @w1가 닫혔다(사람이 닫음).\n지금 연결은 `atrium me`.', '[Atrium 보드] 관계: 너는 @x의 동료다.\n\n[Atrium 보드] 연결이 바뀌었다.', '[multitask 판] 옛 알림']) {
    assert.equal(promptTask(n), null, n); assert.equal(isBoardNotice(n), true, n);
  }
  assert.equal(promptTask('보통 지시'), '보통 지시');
  assert.equal(promptTask(`<pasted_content id="ab12">\n${sub}\n</pasted_content id="ab12">`), 'Reply with exactly: worker ready');
  // hook: 관계 줄 + 지시는 마지막 지시가 되고(원문을 두고 보일 때 뗀다), 알림은 앞 지시를 남긴다
  const rt = newRuntime({ kind: 'claude' });
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: sub });
  assert.equal(promptTask(rt.lastPrompt), 'Reply with exactly: worker ready');
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: '[Atrium 보드] @x가 닫혔다(사람이 닫음).' });
  assert.equal(promptTask(rt.lastPrompt), 'Reply with exactly: worker ready');
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'backend.mjs'), 'utf8');
  assert.match(src, /lastPrompt: clip\(promptTask\(rt\.lastPrompt\), 300\)/);
  assert.match(src, /lastPrompt: promptTask\(s\.rt\.lastPrompt\), lastAnswer/);
});

test('P159 웹 푸시 사이클: pushTree의 부모는 일 부모, 동료·독립은 자기 사이클, 사람이 정한 하위는 위 사이클', async () => {
  const { b, lead, w1, p1, w2, x } = await team();
  const me = { sessions: b.sessions, branch: b.branch, workParentOf: Backend.prototype.workParentOf, queue: { pending: () => 0 } };
  const nodes = Backend.prototype.pushTree.call(me);
  const parent = (s) => nodes.find((n) => n.sessionId === s.sessionId).parentSessionId;
  assert.equal(parent(w1), lead.sessionId); assert.equal(parent(x), lead.sessionId);
  assert.equal(parent(p1), null); assert.equal(parent(w2), null);
  const states = (busy) => nodes.map((n) => ({ ...n, state: busy.includes(n.sessionId) ? 'working' : 'ready' }));
  let t = treeIndex(states([p1.sessionId]));
  assert.equal(cycleCheck(lead.sessionId, t).ok, true, '동료가 일해도 리드 사이클은 닫힌다');
  assert.equal(t.isSub(p1.sessionId), false, '동료는 맨 위 세션처럼(하위 알림 설정을 따르지 않는다)');
  t = treeIndex(states([x.sessionId]));
  assert.equal(cycleCheck(lead.sessionId, t).why, 'cycle-open', '사람이 정한 하위가 일하면 열려 있다');
  t = treeIndex(states([w2.sessionId]));
  assert.equal(cycleCheck(lead.sessionId, t).ok, true, '독립도 따로');
  assert.equal(t.isSub(w1.sessionId), true);
  b.branch.notices.stop();
});

// ---------- 3차: 보이는 위아래·하위 수·역할 이름은 일 관계 ----------
test('P159 요약 branch: 부모·단계·역할·하위 수·순서는 일 관계, 계보는 lineageParentSessionId에만', async () => {
  const { b, lead, w1, p1, w2, x } = await team();
  await b.branch.spawnChild(w1, { name: 'g1', wait: false }); // w1의 하위(일 단계 3)
  const g1 = byName(b, 'g1');
  const br = (s) => b.branch.summaryExtra(s).branch;
  assert.deepEqual([br(w1).parentSessionId, br(w1).parentName, br(w1).child, br(w1).role, br(w1).depth], [lead.sessionId, 'lead', true, '워커', 2]);
  assert.ok(br(w1).order >= 1);
  assert.deepEqual([br(x).parentSessionId, br(x).child, br(x).role, br(x).depth, br(x).order], [lead.sessionId, true, null, 2, null], '사람이 정한 하위(계보 없음, 역할 이름 없음 = 창의 "하위")');
  for (const s of [p1, w2]) {
    const v = br(s);
    assert.deepEqual([v.parentSessionId, v.child, v.role, v.depth, v.order], [null, false, null, 1, null], `${s.name}: 동료·독립은 맨 위, "워커"·"동료" 역할 이름 없음`);
    assert.equal(v.lineageParentSessionId, lead.sessionId, '띄운 기록은 사실로');
  }
  assert.equal(br(lead).children, 2, '리드의 하위 수 = w1, x(동료·독립은 세지 않는다)');
  assert.equal(br(g1).depth, 3);
  // 사람이 다른 세션 아래로 옮긴 하위는 그 선의 역할 이름
  b.ensureLink(x.sessionId, w2.sessionId, { role: '검토' });
  setUser(b, x, w2, 'sub');
  assert.deepEqual([br(w2).parentSessionId, br(w2).role, br(w2).depth], [x.sessionId, '검토', 3]);
  assert.equal(br(x).children, 1);
  // 관계가 바뀌면 일 자손(단계가 바뀜)과 옛 일 부모(하위 수)도 다시 보낸다
  b.broadcasts.length = 0;
  setUser(b, lead, w1, 'none');
  const sent = new Set(b.broadcasts.filter((e) => e[0] === 'session').map((e) => e[1]));
  for (const s of [lead, w1, g1]) assert.ok(sent.has(s.sessionId), s.name);
  assert.equal(br(g1).depth, 2);
  b.branch.notices.stop();
});

test('P159 atrium tree·children: 일 관계 나무(동료·독립은 맨 위, 동료 이름), 역할은 일 역할', async () => {
  const { b, lead, w1, p1, w2, x } = await team();
  const tr = b.branch.tree(), rows = tr.rows;
  assert.equal(tr.total, 2, '하위 세션 수 = 일 하위(w1, x). 동료·독립은 세지 않는다');
  const r = (s) => rows.find((y) => y.sessionId === s.sessionId);
  assert.deepEqual([r(w1).parentSessionId, r(w1).role, r(w1).depth], [lead.sessionId, '워커', 2]);
  assert.deepEqual([r(x).parentSessionId, r(x).role, r(x).adopted], [lead.sessionId, null, false]);
  assert.deepEqual([r(p1).parentSessionId, r(p1).role, r(p1).depth, r(p1).lineageParentSessionId], [null, null, 1, lead.sessionId]);
  assert.deepEqual(r(p1).peers, ['lead']); assert.deepEqual(r(lead).peers, ['p1']);
  assert.deepEqual([r(w2).parentSessionId, r(w2).role], [null, null], '독립은 "워커"가 아니다');
  // children 한 줄: 사람이 정한 하위는 역할 없이, 부모·단계는 일 관계
  const kids = b.branch.listChildren(lead, {}).children;
  const k = (n) => kids.find((c) => c.name === n);
  assert.deepEqual([k('w1').role, k('w1').parent, k('w1').depth], ['워커', 'lead', 2]);
  assert.deepEqual([k('x').role, k('x').parent, k('x').depth], [null, 'lead', 2]);
  assert.ok(!k('p1') && !k('w2'));
  const cli = fs.readFileSync(path.join(HERE, '..', 'bin', 'atrium.mjs'), 'utf8');
  assert.match(cli, /x\.adopted \? ' \(보드에 올림\)' : x\.parentSessionId \? ' \(하위\)'/);
  assert.match(cli, /동료: \$\{x\.peers/);
  b.branch.notices.stop();
});

test('P159 세션 요약과 세션 맵: 요약 parentSessionId = 일 부모, lineageParentSessionId = 계보, 세션 맵은 계보를 lineageParentSessionId로 읽는다', async () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'backend.mjs'), 'utf8');
  assert.match(src, /parentSessionId: this\.workParentOf\(s\.sessionId\), lineageParentSessionId: s\.parentSessionId \|\| null/);
  const { missionGraph } = await import('../src/mission.mjs');
  const sums = [
    { sessionId: 'L', name: 'lead', state: 'ready', parentSessionId: null, lineageParentSessionId: null, branch: { depth: 1 } },
    { sessionId: 'P', name: 'p1', state: 'ready', parentSessionId: null, lineageParentSessionId: 'L', branch: { depth: 1, child: false } },
  ];
  const g = missionGraph({ sessions: sums, relations: [{ a: 'L', b: 'P', relation: 'peer', source: 'agent', at: 1 }] });
  const p = g.nodes.find((n) => n.name === 'p1');
  assert.equal(p.parentId, null); assert.equal(p.lineageParent, 's:L');
  assert.deepEqual(p.peers, ['s:L']);
});

test('P159 선의 역할 이름: 동료·독립으로 정한 쌍은 역할 이름(워커)을 보이지 않는다(저장은 그대로), 하위는 그대로', async () => {
  const { missionGraph } = await import('../src/mission.mjs');
  const sums = [{ sessionId: 'L', name: 'lead', state: 'ready', lineageParentSessionId: null }, { sessionId: 'W', name: 'w', state: 'ready', lineageParentSessionId: 'L' }, { sessionId: 'V', name: 'v', state: 'ready', lineageParentSessionId: 'L' }];
  const links = [{ linkId: 'a', from: 'L', to: 'W', role: '워커', spawned: true }, { linkId: 'b', from: 'L', to: 'V', role: '워커', spawned: true }];
  const g = missionGraph({ sessions: sums, links, relations: [{ a: 'L', b: 'V', relation: 'none', source: 'user', at: 1 }] });
  const roleOf = (to) => (g.edges.find((e) => e.kind === 'role' && e.to === `s:${to}`) || {}).label;
  assert.equal(roleOf('W'), '워커'); assert.equal(roleOf('V'), null);
  // linkView: 판의 가지 기능으로
  const { b, lead, w1, w2 } = await team();
  const me = { sessions: b.sessions, branch: b.branch, store: { linkPromptStats: () => ({ n: 0, at: null }) }, linkPromptView: Backend.prototype.linkPromptView };
  const view = (s) => Backend.prototype.linkView.call(me, b.store.linkByPair(lead.sessionId, s.sessionId));
  assert.equal(view(w1).role, '워커');
  assert.equal(view(w2).role, null); assert.equal(view(w2).storedRole, '워커');
  b.branch.notices.stop();
});
