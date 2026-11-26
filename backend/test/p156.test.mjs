// P156 단위 시험: 세션 사이 일 관계(하위·동료·독립·자동). 계보(누가 띄웠나)와 일 관계를 나눈다.
// 저장·옮기기, 자동 규칙, 바꾸기와 출처, 세션 맵 그래프 필드, child-kill에서 동료·독립 제외, atrium me·children 출력, relate 동사, help 계약, 안내 글.
// herdr·hc와 claude 없이 돈다(p81 시험의 가짜 판 틀).
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
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { BOARD_SYSTEM_PROMPT } from '../src/launch.mjs';
import { Branch, ATRIUM_ALLOW, boardSkill } from '../src/branch.mjs';
import { relationIndex, workDescendantsOf, lineageKept, promptTag } from '../src/relations.mjs';
import { relationLine, relationHeader } from '../src/branch-relations.mjs';
import { missionGraph } from '../src/mission.mjs';
import { CONTRACT_VERSION, VERBS, VERB_NAMES, contractJson, shortHelp } from '../src/cli-contract.mjs';
import { workspaceOf } from '../src/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p156-'));

// ---------- 가짜 판(p81과 같은 틀 + resolve) ----------
async function fakeBoard() {
  const dir = tmp();
  const store = new Store(path.join(dir, 'board.db'));
  const ws = await workspaceOf(dir);
  store.insertWorkspace({ ...ws, createdAt: 1 });
  const b = {
    cfg: { profile: 'dev', terminalSession: 'atrium-dev-p156test', port: 0, dataDir: dir }, apiToken: 'board-api-token', store, sessions: new Map(), bus: new EventEmitter(),
    broadcasts: [], spawned: [], killed: [], queued: [], killing: new Set(),
    api: { broadcast: (e, d) => b.broadcasts.push([e, d]) }, log: () => {}, requireTerminal: () => {},
    hooked: (s) => s.kind === 'claude' && s.origin === 'board',
    summary: (s) => ({ state: s.rt.sleep ? 'sleeping' : s.rt.fakeState || 'ready', ask: null }),
    broadcastSession: (s) => b.broadcasts.push(['session', s.sessionId]),
    resolve(ref) { const s = [...b.sessions.values()].find((x) => x.sessionId === ref || x.name === ref); if (!s) throw Object.assign(new Error('없음'), { code: 'not_found' }); return s; },
    ensureLink(from, to, patch = {}) {
      let l = store.linkByPair(from, to);
      if (!l) { l = { linkId: 'l' + crypto.randomBytes(4).toString('hex'), from, to, role: patch.role ?? null, spawned: !!patch.spawned, observed: !!patch.observed, createdAt: Date.now() }; store.insertLink(l); }
      else { const f = {}; if (l.removedAt) f.removedAt = null; if (patch.role !== undefined && patch.role !== l.role) f.role = patch.role; if (patch.observed && !l.observed) f.observed = true; if (Object.keys(f).length) store.updateLink(l.linkId, f); }
      return store.getLink(l.linkId);
    },
    linkEvent(l, kind, text = null, data = null) { return store.addLinkEvent(l.linkId, kind, text, data); },
    queue: { enqueue: (sid, text) => { b.queued.push({ sid, text }); const d = { deliveryId: 'd' + b.queued.length, sessionId: sid, text, status: 'queued' }; b.deliveries.set(d.deliveryId, d); return { ...d }; } },
    deliveries: new Map(),
    async spawn(p) {
      const id = crypto.randomUUID();
      const s = { sessionId: id, name: p.name, cwd: p.cwd, paneId: `w${b.spawned.length + 2}:p1`, agentName: p.name, model: p.model, effort: p.effort, permissionMode: p.permissionMode, kind: p.kind || 'claude', origin: 'board', parentSessionId: p.parentSessionId || null, workspaceKey: (await workspaceOf(p.cwd)).key, rt: newRuntime({ kind: p.kind || 'claude' }), createdAt: Date.now() + b.spawned.length };
      store.insertSession({ ...s, settingsPath: '', hookToken: '', runtime: s.rt });
      b.sessions.set(id, s);
      if (p.branch) b.branch.noteChild(id, p.branch);
      store.setNode({ session_id: id, x: 0, y: 5000 + b.spawned.length * 600, w: 720, h: 460 });
      b.spawned.push(p);
      return { sessionId: id, trust: { needsTrust: false } };
    },
    closeSession(s, reason) { b.sessions.delete(s.sessionId); store.updateSession(s.sessionId, { closedAt: Date.now() }); b.bus.emit('closed', s, reason); },
    async kill({ session }) { const s = b.sessions.get(session); b.closeSession(s, 'killed'); b.killed.push(s.name); return { closed: true }; },
  };
  b.store.getDelivery = (id) => b.deliveries.get(id) || null;
  b.branch = new Branch(b, { readyWaitMs: 30, submitWaitMs: 10, noticeBatchMs: 20, verbs: { settleMs: 50 } }); // 가짜 대기열은 제출 확인을 하지 않는다: atrium prompt가 30초씩 기다리지 않게
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
const byName = (b, n) => [...b.sessions.values()].find((x) => x.name === n);
function serve(b) {
  const srv = http.createServer((req, res) => { if (!b.branch.handleHttp(req, res)) { res.writeHead(404); res.end(); } });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => { b.cfg.port = srv.address().port; r(srv); }));
}
function runChild(args, env) {
  return new Promise((resolve) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('MTASK_') && !k.startsWith('ATRIUM_') && !k.startsWith('HC_')));
    execFile(process.execPath, [path.join(HERE, '..', 'bin', 'atrium-child.mjs'), ...args], { env: { ...clean, ...env }, timeout: 20000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

// ---------- 규칙(순수) ----------
test('P156 규칙: 줄이 없으면 자동(띄움·역할 선 = 하위), 명시한 줄이 이긴다, 일 부모·동료·독립, 고리 판정', () => {
  const lineage = { b1: 'a', c1: 'b1', p1: 'a', x: null, y: null };
  const lineageOf = (id) => lineage[id] || null;
  const links = [{ from: 'x', to: 'y', role: '리뷰어' }];
  let idx = relationIndex({ rows: [], lineageOf, links });
  assert.deepEqual(idx.between('a', 'b1'), { relation: 'sub', source: 'auto', up: 'a', a: 'a', b: 'b1', at: null });
  assert.equal(idx.between('b1', 'a').up, 'a', '순서와 상관없이 위는 띄운 쪽');
  assert.equal(idx.between('x', 'y').relation, 'sub', '역할 선 = 하위(자동)');
  assert.equal(idx.between('a', 'x'), null, '이어지지 않은 쌍');
  assert.equal(idx.ofEdge('a', 'x').relation, 'none', '선만 있는(지시) 쌍은 독립(자동)');
  assert.equal(idx.workParentOf('b1'), 'a'); assert.equal(idx.workParentOf('y'), null, '역할 선은 나무 부모가 아니다(옛 판과 같다)');
  // p1을 동료로, c1을 a의 하위로(계보는 b1)
  const rows = [{ a: 'a', b: 'p1', relation: 'peer', source: 'agent', at: 1 }, { a: 'a', b: 'c1', relation: 'sub', source: 'user', at: 2 }];
  idx = relationIndex({ rows, lineageOf, links });
  assert.equal(idx.between('a', 'p1').relation, 'peer'); assert.equal(idx.between('p1', 'a').source, 'agent');
  assert.equal(idx.workParentOf('p1'), null, '동료로 바꾼 계보 부모는 일 부모가 아니다');
  assert.equal(idx.workParentOf('c1'), 'a', '명시한 하위 줄이 계보를 이긴다');
  assert.deepEqual(idx.peersOf('a').map((p) => p.id), ['p1']);
  assert.ok(idx.isWorkDescendant('c1', 'a')); assert.ok(!idx.isWorkDescendant('p1', 'a'));
  // 같은 쌍에 둘이면 늦은 것
  idx = relationIndex({ rows: [{ a: 'a', b: 'p1', relation: 'peer', source: 'agent', at: 1 }, { a: 'p1', b: 'a', relation: 'none', source: 'user', at: 5 }], lineageOf });
  assert.equal(idx.between('a', 'p1').relation, 'none');
  assert.deepEqual(idx.independentOf('a').map((p) => p.id), ['p1']);
  // 끄기 범위: 일 자손만, 계보로만 아래인 것은 남김
  idx = relationIndex({ rows: [{ a: 'b1', b: 'c1', relation: 'peer', source: 'agent', at: 1 }], lineageOf });
  const ids = ['a', 'b1', 'c1', 'p1'];
  assert.deepEqual(workDescendantsOf('a', ids, idx).map((x) => x.sessionId).sort(), ['b1', 'p1']);
  assert.deepEqual(lineageKept('a', ids, lineageOf, new Set(['a', 'b1', 'p1'])), ['c1']);
  // 꼬리표
  assert.equal(promptTag({ relation: 'sub', up: 'a' }, 'a'), 'assign'); assert.equal(promptTag({ relation: 'sub', up: 'a' }, 'b1'), 'report');
  assert.equal(promptTag({ relation: 'peer' }, 'a'), 'share'); assert.equal(promptTag({ relation: 'none' }, 'a'), null); assert.equal(promptTag(null, 'a'), null);
});

test('P156 저장: 옛 board.db에도 relations 표가 생기고 옛 기록은 모두 자동, 쌍마다 한 줄, auto는 줄을 지운다', () => {
  const dir = tmp();
  const f = path.join(dir, 'board.db');
  // 옛 판: relations 표 없이 sessions만
  const old = new DatabaseSync(f);
  old.exec("CREATE TABLE sessions (session_id TEXT PRIMARY KEY, name TEXT NOT NULL, cwd TEXT NOT NULL, pane_id TEXT, workspace_id TEXT, agent_name TEXT, model TEXT, effort TEXT, permission_mode TEXT NOT NULL, settings_path TEXT NOT NULL, hook_token TEXT NOT NULL, resume_argv TEXT, resume_verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, closed_at INTEGER, seen_at INTEGER, runtime TEXT) STRICT");
  old.close();
  const st = new Store(f);
  assert.deepEqual(st.relationRows(), []);
  st.setRelation('a', 'b', 'peer', 'agent', 10);
  st.setRelation('b', 'a', 'sub', 'user', 20);
  assert.deepEqual(st.relationRows(), [{ a: 'b', b: 'a', relation: 'sub', source: 'user', at: 20 }], '쌍마다 한 줄(뒤집어 넣어도)');
  st.setRelation('a', 'b', null, 'user');
  assert.deepEqual(st.relationRows(), []);
  st.close();
});

// ---------- 띄우기(--peer), 바꾸기, 출처 ----------
test('P156 atrium child --peer: 계보는 남고 관계는 동료(출처 agent), 역할 "동료", 첫 요청 앞 관계 줄, 응답의 relation. 기본은 하위', async () => {
  const { b, lead } = await fakeBoard();
  const sub = await b.branch.spawnChild(lead, { name: 'w1', prompt: 'do it', wait: false });
  assert.equal(sub.relation, 'sub'); assert.match(sub.relationText, /^하위 워커/);
  assert.match(b.queued[0].text, /^\[Atrium 보드\] 관계: 너는 @lead의 하위 워커다\. 아래 일은 @lead가 맡긴 일 u[0-9a-f]+이다/); // P180: 하위의 첫 요청은 일 단위 머리
  assert.ok(b.queued[0].text.endsWith('\n\ndo it'));
  const peer = await b.branch.spawnChild(lead, { name: 'p1', peer: true, prompt: 'crawl the site', wait: false });
  assert.equal(peer.relation, 'peer'); assert.equal(peer.role, '동료'); assert.match(peer.relationText, /^동료/);
  assert.match(peer.notice, /\[Atrium 보드\] 동료: `@p1`.*하위 워커가 아니다/);
  const p1 = byName(b, 'p1');
  assert.equal(p1.parentSessionId, lead.sessionId, '계보는 남는다');
  assert.deepEqual(b.store.relationRows().map((r) => [r.a, r.b, r.relation, r.source]), [[lead.sessionId, p1.sessionId, 'peer', 'agent']]);
  const q = b.queued.find((x) => x.sid === p1.sessionId).text;
  assert.match(q, /^\[Atrium 보드\] 관계: 너는 @lead의 동료다\(하위 워커가 아니다\)\. .*atrium prompt lead "<결과>"/);
  assert.ok(q.endsWith('\n\ncrawl the site'));
  // 연결 기록: 지시는 원래 글, 꼬리표
  const l = b.store.linkByPair(lead.sessionId, p1.sessionId);
  const ev = b.store.linkEvents(l.linkId);
  assert.equal(ev.find((e) => e.kind === 'prompt').text, 'crawl the site');
  assert.equal(ev.find((e) => e.kind === 'prompt').data.tag, 'share');
  assert.equal(ev.find((e) => e.kind === 'spawn').data.relation, 'peer');
  // 요약: 일 부모·계보 부모·동료
  const sum = b.branch.summaryExtra(p1).branch;
  assert.equal(sum.workParentSessionId, null); assert.equal(sum.lineageParentSessionId, lead.sessionId);
  assert.deepEqual(sum.parentRelation, { relation: 'peer', source: 'agent' });
  assert.deepEqual(b.branch.summaryExtra(lead).branch.peers, [p1.sessionId]);
  assert.equal(b.branch.summaryExtra(byName(b, 'w1')).branch.workParentSessionId, lead.sessionId);
  // --head와 함께는 안 된다
  await assert.rejects(b.branch.spawnChild(lead, { name: 'h1', head: true, peer: true, wait: false }), /--head와 --peer는 함께 쓰지 않는다/);
  b.branch.notices.stop();
});

test('P156 바꾸기: relation.set(사람, user)은 기록·방송·두 쪽 알림, 고리는 거절, auto는 되돌림. relate(에이전트)는 이어진 세션만, 사람이 정한 것은 못 바꿈', async () => {
  const { b, lead } = await fakeBoard();
  await b.branch.spawnChild(lead, { name: 'w1', wait: false });
  const w1 = byName(b, 'w1');
  const other = mk(b, { name: 'solo', cwd: lead.cwd, workspaceKey: lead.workspaceKey });
  // 사람: w1을 동료로
  const r = b.branch.relationSetUser({ a: lead.sessionId, b: 'w1', relation: 'peer' });
  assert.equal(r.relation, 'peer'); assert.equal(r.source, 'user'); assert.deepEqual(r.before, { relation: 'sub', source: 'auto' });
  assert.ok(b.broadcasts.some(([e, d]) => e === 'relation.updated' && d.relation === 'peer' && d.source === 'user'));
  assert.ok(b.broadcasts.some(([e, d]) => e === 'session' && d === w1.sessionId));
  const l = b.store.linkByPair(lead.sessionId, w1.sessionId);
  const ev = b.store.linkEvents(l.linkId).find((e) => e.kind === 'relation');
  assert.equal(ev.text, 'peer'); assert.equal(ev.data.source, 'user'); assert.equal(ev.data.before.relation, 'sub');
  b.branch.notices.flushAll();
  const nl = b.queued.filter((q) => q.text.includes('사람이 판에서 정함'));
  assert.equal(nl.length, 2, '두 세션 모두에게');
  assert.match(nl.find((q) => q.sid === w1.sessionId).text, /@lead와 너는 이제 동료다/);
  // 고리: lead > w1 > w11이면 w11 아래에 lead를 둘 수 없다(w1을 다시 하위로 돌린 뒤)
  b.branch.relationSetUser({ a: lead.sessionId, b: w1.sessionId, relation: 'sub' });
  await b.branch.spawnChild(w1, { name: 'w11', wait: false });
  assert.throws(() => b.branch.relationSetUser({ a: 'w11', b: lead.sessionId, relation: 'sub' }), (e) => e.code === 'cycle');
  // 같은 쌍을 뒤집는 것은 그 쌍의 줄을 바꾸므로 고리가 아니다(w1이 lead를 하위로). 다시 되돌린다
  assert.equal(b.branch.relationSetUser({ a: w1.sessionId, b: lead.sessionId, relation: 'sub' }).effective.up, 'w1');
  b.branch.relationSetUser({ a: lead.sessionId, b: w1.sessionId, relation: 'sub' });
  // auto로 되돌림
  const back = b.branch.relationSetUser({ a: lead.sessionId, b: w1.sessionId, relation: 'auto' });
  assert.equal(back.source, 'auto'); assert.equal(back.effective.relation, 'sub'); assert.deepEqual(b.store.relationRows(), []);
  assert.throws(() => b.branch.relationSetUser({ a: lead.sessionId, b: w1.sessionId, relation: 'boss' }), /관계는/);
  assert.throws(() => b.branch.relationSetUser({ a: lead.sessionId, b: lead.sessionId, relation: 'peer' }), /자기 자신/);
  // 에이전트: 이어지지 않은 세션은 거절
  assert.throws(() => b.branch.relateVerb(lead, { name: 'solo', relation: 'peer' }), (e) => e.code === 'not_linked');
  // 이어진 세션(w1)은 된다. 상대에게만 알린다
  b.branch.notices.flushAll(); b.queued.length = 0;
  const a = b.branch.relateVerb(lead, { name: 'w1', relation: 'none' });
  assert.equal(a.source, 'agent'); assert.equal(a.effective.relation, 'none');
  b.branch.notices.flushAll();
  assert.deepEqual(b.queued.map((q) => q.sid), [w1.sessionId]);
  assert.match(b.queued[0].text, /@lead와 너는 이제 독립이다\(@lead가 정함\)/);
  // 사람이 정한 관계는 에이전트가 못 바꾼다
  b.branch.relationSetUser({ a: lead.sessionId, b: w1.sessionId, relation: 'peer' });
  assert.throws(() => b.branch.relateVerb(w1, { name: 'lead', relation: 'sub' }), (e) => e.code === 'user_set');
  // 선(역할)으로 이어진 세션은 이어진 것
  b.ensureLink(lead.sessionId, other.sessionId, { role: '리뷰어' });
  assert.equal(b.branch.relateVerb(lead, { name: 'solo', relation: 'peer' }).relation, 'peer');
  assert.deepEqual(b.branch.relationList().relations.map((x) => x.relation).sort(), ['peer', 'peer']);
  b.branch.notices.stop();
});

// ---------- child-kill, children, me ----------
test('P156 child-kill: 하위 관계로만 내려가 끄고 동료·독립은 남긴 이름으로, 동료를 직접 끄면 not_sub', async () => {
  const { b, lead } = await fakeBoard();
  await b.branch.spawnChild(lead, { name: 'w1', wait: false });
  const w1 = byName(b, 'w1');
  await b.branch.spawnChild(w1, { name: 'w2', wait: false });
  await b.branch.spawnChild(w1, { name: 'p2', peer: true, wait: false });
  await b.branch.spawnChild(w1, { name: 'n2', wait: false });
  b.branch.relateVerb(w1, { name: 'n2', relation: 'none' });
  await b.branch.spawnChild(lead, { name: 'p1', peer: true, wait: false });
  await assert.rejects(b.branch.killChild(lead, { name: 'p1' }), (e) => e.code === 'not_sub' && /동료이라 하위 끄기로 끄지 않습니다|동료/.test(e.message));
  assert.ok(byName(b, 'p1'));
  const r = await b.branch.killChild(lead, { name: 'w1' });
  assert.deepEqual(r.killed.map((k) => k.name).sort(), ['w1', 'w2']);
  assert.deepEqual(r.kept.map((k) => `${k.name}:${k.relation}`).sort(), ['n2:none', 'p2:peer']);
  assert.ok(byName(b, 'p2') && byName(b, 'n2') && byName(b, 'p1'));
  assert.ok(b.store.events({ sessionId: lead.sessionId }).some((e) => e.kind === 'branch_kill' && e.data.kept.length === 2));
  b.branch.notices.stop();
});

test('P156 children·me: 하위만 나무로, 동료는 따로. me는 상위·동료·하위·독립(계보 부모가 동료면 lineage). 명시한 하위는 계보가 없어도 하위', async () => {
  const { b, lead } = await fakeBoard();
  await b.branch.spawnChild(lead, { name: 'w1', wait: false });
  await b.branch.spawnChild(lead, { name: 'p1', peer: true, wait: false });
  await b.branch.spawnChild(byName(b, 'w1'), { name: 'w11', wait: false });
  const solo = mk(b, { name: 'solo', cwd: lead.cwd, workspaceKey: lead.workspaceKey });
  b.branch.relationSetUser({ a: lead.sessionId, b: solo.sessionId, relation: 'sub' });
  const c = b.branch.listChildren(lead, { all: true });
  assert.deepEqual(c.children.map((x) => `${x.name}:${x.level}`), ['solo:1', 'w1:1', 'w11:2'], '띄운(만든) 차례, level은 몇 단계 아래');
  assert.deepEqual(c.peers.map((x) => x.name), ['p1']);
  const me = b.branch.me(lead);
  assert.equal(me.parent, null);
  assert.deepEqual(me.children.map((x) => x.name), ['solo', 'w1'], '띄운 순서 번호가 없는(사람이 하위로 둔) 세션이 먼저');
  assert.deepEqual(me.peers.map((x) => [x.name, x.spawned]), [['p1', true]]);
  assert.deepEqual(me.independent, []);
  const mp = b.branch.me(byName(b, 'p1'));
  assert.equal(mp.parent, null, '동료로 띄운 세션의 상위는 없다');
  assert.deepEqual(mp.peers.map((x) => [x.name, x.spawnedBy]), [['lead', true]]);
  assert.deepEqual(mp.lineage, { name: 'lead', relation: 'peer' });
  assert.equal(b.branch.me(solo).parent.name, 'lead'); assert.equal(b.branch.me(solo).parent.source, 'user');
  b.branch.notices.stop();
});

test('P156 명령 글: child --peer 첫 줄이 관계, relate 글, children의 동료 한 줄, child-kill의 남김, me의 상위·동료', async () => {
  const { b, lead } = await fakeBoard();
  const srv = await serve(b);
  try {
    const env = b.branch.envFor(lead.sessionId);
    const s = await runChild(['child', 'w1', '--no-wait', '--prompt', 'x'], env);
    assert.equal(s.code, 0, s.stderr); assert.match(s.stdout.split('\n')[0], /^관계: 하위 워커\. @w1는 너의 워커다/);
    const p = await runChild(['child', 'p1', '--peer', '--no-wait', '--prompt', 'y'], env);
    assert.equal(p.code, 0, p.stderr); assert.match(p.stdout.split('\n')[0], /^관계: 동료\. @p1는 너의 하위 워커가 아니다/);
    assert.match(p.stdout, /동료는 끝나면 결과를 너에게 공유한다/);
    const ch = await runChild(['children'], env);
    assert.match(ch.stdout, /하위 세션 1개/); assert.match(ch.stdout, /동료\(하위가 아니다, 결과를 서로 공유\): @p1 ready/);
    const me = await runChild(['me'], env);
    assert.match(me.stdout, /상위: 없음/); assert.match(me.stdout, /동료 1명\(하위가 아니다.*\n {2}@p1 · ready · 네가 띄움 · 에이전트가 정함/);
    const meP = await runChild(['me'], b.branch.envFor(byName(b, 'p1').sessionId));
    assert.match(meP.stdout, /상위: 없음/); assert.match(meP.stdout, /@lead · ready · 너를 띄운 세션/);
    const rel = await runChild(['relate', 'w1', 'peer'], env);
    assert.equal(rel.code, 0, rel.stderr); assert.match(rel.stdout, /관계를 바꿨다: 하위\(자동\) → 동료\. 지금: @w1와 너는 동료다/);
    const bad = await runChild(['relate', 'w1', 'boss'], env);
    assert.equal(bad.code, 2); assert.match(bad.stderr, /sub\(하위\), peer\(동료\), none\(독립\), auto\(자동\)/);
    const nl = await runChild(['relate', 'nobody', 'peer'], env);
    assert.equal(nl.code, 1); assert.match(nl.stderr, /관계를 바꾸지 않았다/);
    await runChild(['relate', 'w1', 'auto'], env);
    await b.branch.spawnChild(byName(b, 'w1'), { name: 'p2', peer: true, wait: false });
    const k = await runChild(['child-kill', 'w1'], env);
    assert.equal(k.code, 0, k.stderr); assert.match(k.stdout, /껐다: @w1/); assert.match(k.stdout, /남겼다\(하위가 아니라 끄지 않음\): @p2\(동료\)/);
    const kp = await runChild(['child-kill', 'p1'], env);
    assert.equal(kp.code, 1); assert.match(kp.stderr, /not_sub/);
    const js = JSON.parse((await runChild(['children', '--json'], env)).stdout);
    assert.deepEqual(js.peers.map((x) => x.name), ['p1']);
  } finally { srv.close(); srv.closeAllConnections?.(); b.branch.notices.stop(); }
});

// ---------- 세션 맵 그래프 ----------
test('P156 그래프: 선마다 relation·relationSource·relationUp, 세션마다 parentId(일 부모)·lineageParent·peers, 관계만 있는 쌍은 relation 선', () => {
  const S = (id, parent = null) => ({ sessionId: id, name: id, state: 'ready', parentSessionId: parent });
  const sessions = [S('a'), S('w', 'a'), S('p', 'a'), S('x'), S('y')];
  const links = [
    { linkId: 'l1', from: 'a', to: 'w', role: '워커', spawned: true },
    { linkId: 'l2', from: 'a', to: 'p', role: '동료', spawned: true },
    { linkId: 'l3', from: 'x', to: 'a', observed: true, lastText: 'hi' },
  ];
  const relations = [{ a: 'a', b: 'p', relation: 'peer', source: 'agent', at: 1 }, { a: 'x', b: 'y', relation: 'peer', source: 'user', at: 2 }];
  const g = missionGraph({ sessions, links, relations });
  const e = (kind, from, to) => g.edges.find((x) => x.kind === kind && x.from === `s:${from}` && x.to === `s:${to}`);
  assert.deepEqual([e('role', 'a', 'w').relation, e('role', 'a', 'w').relationSource, e('role', 'a', 'w').relationUp], ['sub', 'auto', 's:a']);
  assert.deepEqual([e('spawn', 'a', 'p').relation, e('spawn', 'a', 'p').relationSource, e('spawn', 'a', 'p').relationUp], ['peer', 'agent', null]);
  assert.deepEqual([e('prompt', 'x', 'a').relation, e('prompt', 'x', 'a').relationSource], ['none', 'auto']);
  const rel = e('relation', 'x', 'y');
  assert.ok(rel, '관계만 있는 쌍'); assert.equal(rel.relation, 'peer'); assert.equal(rel.relationSource, 'user');
  assert.ok(!g.edges.some((x) => x.kind === 'relation' && x.from === 's:a'), '이미 선이 있는 쌍은 relation 선을 더하지 않는다');
  const n = (id) => g.nodes.find((x) => x.id === `s:${id}`);
  assert.equal(n('w').parentId, 's:a'); assert.equal(n('w').lineageParent, 's:a');
  assert.equal(n('p').parentId, null, '동료는 나무 아래로 들이지 않는다'); assert.equal(n('p').lineageParent, 's:a');
  assert.deepEqual(n('a').peers, ['s:p']); assert.deepEqual(n('x').peers, ['s:y']);
  // 옛 판(관계 없음): 지금과 같다
  const g0 = missionGraph({ sessions, links });
  assert.equal(g0.nodes.find((x) => x.id === 's:p').parentId, 's:a');
});

// ---------- 계약·안내 ----------
test('P156 계약과 안내: 계약 3, relate 동사·child --peer·me/children/child-kill 출력, 승인 규칙, 짧은 help·--long·스킬·판 안내에 관계 고르기', async () => {
  assert.equal(CONTRACT_VERSION, 3);
  assert.ok(VERB_NAMES.includes('relate'));
  const v = (n) => VERBS.find((x) => x.name === n);
  assert.ok(v('child').args.includes('[--peer]')); assert.ok(v('child').out.includes('relation'));
  assert.deepEqual(v('relate').args.slice(0, 2), ['<이름>', 'sub|peer|none|auto']);
  assert.ok(v('me').out.includes('peers') && v('me').out.includes('independent'));
  assert.ok(v('children').out.includes('peers')); assert.ok(v('child-kill').out.includes('kept'));
  const j = contractJson();
  assert.deepEqual(j.relations, ['sub', 'peer', 'none', 'auto']); assert.match(j.relationHelp, /--peer/);
  for (const r of ['Bash(atrium relate *)', 'Bash(atrium relate:*)', 'PowerShell(atrium relate *)', 'Bash(mtask relate *)']) assert.ok(ATRIUM_ALLOW.includes(r), r);
  const h = shortHelp();
  assert.match(h, /띄울 때 관계를 고른다: 사용자가 협력·동료·같이·파트너/); assert.match(h, /워커·하위·맡겨·나눠/); assert.match(h, /첫 지시와 역할 이름으로 판단한다/);
  const long = await runChild(['help', '--long'], {});
  assert.match(long.stdout, /atrium relate <이름> sub\|peer\|none\|auto/); assert.match(long.stdout, /--peer는 동료다/); assert.match(long.stdout, /띄울 때 관계를 고른다/);
  const sk = boardSkill();
  assert.match(sk, /## 관계 고르기/); assert.match(sk, /동료\(`--peer`\): 협력·동료·같이·파트너/); assert.match(sk, /atrium relate <이름> sub\|peer\|none\|auto/);
  assert.match(sk, /- 연결: `atrium me`가 상위·동료·하위·독립.*\n- 헤드:/, '연결 줄과 헤드 줄이 붙어 있던 것을 떼었다');
  assert.match(BOARD_SYSTEM_PROMPT, /세션을 띄울 때 관계를 고른다: 협력·동료·같이·파트너면 `atrium child <이름> --peer`/);
  assert.match(BOARD_SYSTEM_PROMPT, /"\[Atrium 보드\] 관계:" 줄이 너의 관계와 보고 방식이다/);
  // 알림·관계 줄 글
  assert.match(relationLine('a', 'b', { relation: 'sub', up: 'a' }, 'user'), /^@b는 이제 너의 하위 워커다\(사람이 판에서 정함\)/);
  assert.match(relationLine('a', 'b', { relation: 'sub', up: 'b' }, 'lead'), /^너는 이제 @b의 하위 워커다\(@lead가 정함\)/);
  assert.match(relationLine('a', 'b', null, 'user'), /자동으로 되돌렸다/);
  assert.match(relationHeader({ relation: 'peer', parent: 'lead' }), /atrium prompt lead "<결과>"/); // P181: --now 대신 보드가 차례에 넣는다
});

test('P156 atrium prompt 꼬리표: 위 → 하위 assign, 하위 → 위 report, 동료끼리 share, 독립은 없음(연결 기록 data.tag와 응답 tag)', async () => {
  const { b, lead } = await fakeBoard();
  await b.branch.spawnChild(lead, { name: 'w1', wait: false });
  await b.branch.spawnChild(lead, { name: 'p1', peer: true, wait: false });
  mk(b, { name: 'solo', cwd: lead.cwd, workspaceKey: lead.workspaceKey });
  const tagOf = async (from, to) => {
    const r = await b.branch.verbs.prompt(from, { name: to, text: `hello ${to}` });
    const l = b.store.linkByPair(from.sessionId, byName(b, to).sessionId);
    const e = b.store.linkEvents(l.linkId).filter((x) => x.kind === 'prompt').pop();
    assert.equal(e.data.tag ?? null, r.tag ?? null);
    return r.tag ?? null;
  };
  assert.equal(await tagOf(lead, 'w1'), 'assign');
  assert.equal(await tagOf(byName(b, 'w1'), 'lead'), 'report');
  assert.equal(await tagOf(byName(b, 'p1'), 'lead'), 'share');
  assert.equal(await tagOf(lead, 'solo'), null);
  b.branch.notices.stop();
});
