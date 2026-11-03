// P8 단위 시험: 가지 펼치기(ARCH 4절 K). 깊이·자손 계산, 상한, 이름, 나무 자리, 승인 규칙과 env, 세션 토큰, 물려받기, 자손만 끄기,
// board.db 옮기기(P7 모양), 플러그인(스킬, atrium 명령과 별칭 mtask), 하위 세션 명령(bin/atrium-child.mjs, 별칭 bin/mtask-child.mjs)이 env의 판으로만 가는지. herdr와 claude 없이 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { writeSessionSettings, writeBoardPlugin, buildStartArgs, buildResumeArgv, BOARD_SYSTEM_PROMPT, HERDR_ALLOW } from '../src/launch.mjs';
import { normalizePatch, Settings } from '../src/settings.mjs';
import { Branch, BRANCH_ALLOW, depthOf, isDescendant, descendantsOf, checkLimits, childName, childSlot, childNotice, delegateSkill, childShims, CHILD_NAME_RE } from '../src/branch.mjs';
import { SIZE_STEPS, overlaps, GAP } from '../src/canvas.mjs';
import { workspaceOf } from '../src/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p8-'));
const LIMITS = { branchMaxChildren: 4, branchMaxDepth: 3, branchMaxTotal: 16 };

test('audit: concurrent children reserve automatic names before workspace lookup', async () => {
  const { b, lead } = await fakeBoard();
  const results = await Promise.all([b.branch.spawnChild(lead, { wait: false }), b.branch.spawnChild(lead, { wait: false })]);
  assert.equal(new Set(results.map((r) => r.name)).size, 2);
});

for (const [setting, code] of [['branchMaxChildren', 'too_many_children'], ['branchMaxTotal', 'board_full']]) {
  test(`audit: concurrent children cannot exceed ${setting}`, async () => {
    const { b, lead } = await fakeBoard({ limits: { [setting]: 1 } });
    const results = await Promise.allSettled(['one', 'two'].map((name) => b.branch.spawnChild(lead, { name, wait: false })));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, code);
    assert.equal(b.branch.pending.length, 0);
    assert.equal(b.branch.pendingNames.size, 0);
  });
}

test('audit: descendants remain discoverable and removable through a closed intermediate session', async () => {
  const { b, lead } = await fakeBoard({ limits: { branchMaxDepth: 5 } });
  const top = await b.branch.spawnChild(lead, { name: 'top', wait: false });
  const mid = await b.branch.spawnChild(b.sessions.get(top.sessionId), { name: 'mid', wait: false });
  await b.branch.spawnChild(b.sessions.get(mid.sessionId), { name: 'leaf', wait: false });
  await b.branch.killChild(lead, { name: 'mid', only: true });
  assert.deepEqual(b.branch.listChildren(lead, { all: true }).children.map((s) => s.name), ['top', 'leaf']);
  const result = await b.branch.killChild(lead, { name: 'top' });
  assert.deepEqual(result.killed.map((s) => s.name), ['leaf', 'top']);
});

test('audit: DeepSeek children retain the provider flavor and other providers do not inherit its model', async () => {
  const { b, lead } = await fakeBoard();
  lead.flavor = 'deepseek'; lead.model = 'ocx-claude-deepseek--deepseek-flash[1m]';
  await b.branch.spawnChild(lead, { name: 'deepseek-child', wait: false });
  assert.equal(b.spawned[0].flavor, 'deepseek');
  assert.equal(b.spawned[0].model, lead.model);
  await b.branch.spawnChild(lead, { name: 'codex-child', kind: 'codex', wait: false });
  assert.equal(b.spawned[1].model, null);
  assert.ok(!b.spawned[1].flavor);
});

test('audit: a registered child still finishing startup consumes only one limit slot', async () => {
  const { b, lead } = await fakeBoard({ limits: { branchMaxChildren: 2, branchMaxTotal: 2 } });
  let release, entered;
  const gate = new Promise((r) => { release = r; }), registered = new Promise((r) => { entered = r; });
  const spawn = b.spawn.bind(b);
  b.spawn = async (p) => { const out = await spawn(p); if (p.name === 'first') { entered(); await gate; } return out; };
  const first = b.branch.spawnChild(lead, { name: 'first', wait: false });
  try {
    await registered;
    const second = await b.branch.spawnChild(lead, { name: 'second', wait: false });
    assert.equal(second.name, 'second');
  } finally { release(); await first; }
});

test('audit: failed child startup releases its name and capacity for retry', async () => {
  const { b, lead } = await fakeBoard({ limits: { branchMaxChildren: 1 } });
  const spawn = b.spawn.bind(b);
  b.spawn = async () => { throw new Error('fixture startup failure'); };
  await assert.rejects(b.branch.spawnChild(lead, { name: 'retry', wait: false }), /fixture/);
  b.spawn = spawn;
  assert.equal((await b.branch.spawnChild(lead, { name: 'retry', wait: false })).name, 'retry');
});

test('audit: provider-qualified Codex model IDs survive child inheritance', async () => {
  const { b, lead } = await fakeBoard();
  lead.kind = 'codex'; lead.model = 'provider/model-v1';
  await b.branch.spawnChild(lead, { name: 'codex-worker', wait: false });
  assert.equal(b.spawned[0].model, lead.model);
});

test('audit: a lost child response during startup still sends the parent its delegation details', async () => {
  const { b, lead } = await fakeBoard();
  const res = new EventEmitter(); res.writableFinished = false; res.destroyed = false;
  const spawn = b.spawn.bind(b);
  b.spawn = async (p) => { res.destroyed = true; res.emit('close'); return spawn(p); };
  await b.branch.spawnChild(lead, { name: 'lost-response', wait: false }, res);
  assert.equal(b.queued.length, 1);
  assert.equal(b.queued[0].sid, lead.sessionId);
  assert.match(b.queued[0].text, /lost-response/);
});

// ---------- 나무 계산 ----------
test('K3: 깊이는 사람이 띄운 세션이 1단계, 닫힌 중간 세션도 따라가고 고리는 끊는다. 자손과 끄는 순서(깊은 것부터)', () => {
  const rows = new Map([['a', { parentSessionId: null }], ['b', { parentSessionId: 'a' }], ['c', { parentSessionId: 'b' }], ['d', { parentSessionId: 'c' }], ['x', { parentSessionId: 'y' }], ['y', { parentSessionId: 'x' }]]);
  const rowOf = (id) => rows.get(id) || null;
  assert.equal(depthOf('a', rowOf), 1);
  assert.equal(depthOf('c', rowOf), 3);
  assert.equal(depthOf('d', rowOf), 4);
  assert.ok(depthOf('x', rowOf) <= 3); // 고리에서 멈춘다
  assert.equal(depthOf('nope', rowOf), 1);
  assert.equal(isDescendant('c', 'a', rowOf), true);
  assert.equal(isDescendant('a', 'c', rowOf), false);
  assert.equal(isDescendant('a', 'a', rowOf), false);
  assert.equal(isDescendant('x', 'q', rowOf), false);
  const list = [...rows].map(([sessionId, r]) => ({ sessionId, ...r }));
  assert.deepEqual(descendantsOf('a', list).map((x) => x.sessionId), ['d', 'c', 'b']);
  assert.deepEqual(descendantsOf('c', list).map((x) => x.sessionId), ['d']);
});

test('K3: 상한 — 다섯 번째 하위 세션, 4단계, 판 전체 상한을 까닭과 함께 거부한다', () => {
  assert.equal(checkLimits({ parentDepth: 1, children: 3, total: 3, limits: LIMITS }), null);
  const five = checkLimits({ parentDepth: 1, children: 4, total: 4, limits: LIMITS });
  assert.equal(five.code, 'too_many_children'); assert.equal(five.limit, 4); assert.match(five.message, /4개/);
  const deep = checkLimits({ parentDepth: 3, children: 0, total: 3, limits: LIMITS });
  assert.equal(deep.code, 'too_deep'); assert.match(deep.message, /3단계/);
  const full = checkLimits({ parentDepth: 2, children: 1, total: 16, limits: LIMITS });
  assert.equal(full.code, 'board_full'); assert.equal(full.now, 16);
  assert.equal(checkLimits({ parentDepth: 2, children: 3, total: 15, limits: LIMITS }), null);
});

test('K1: 하위 세션 이름 — 주면 herdr 이름 규칙대로, 없으면 <부모>-w<n>', () => {
  assert.equal(childName({ want: 'w1', parentName: 'lead', taken: new Set() }), 'w1');
  assert.throws(() => childName({ want: 'W1', parentName: 'lead', taken: new Set() }), /소문자/);
  assert.throws(() => childName({ want: '1w', parentName: 'lead', taken: new Set() }), /소문자/);
  assert.throws(() => childName({ want: 'w1', parentName: 'lead', taken: new Set(['w1']) }), (e) => e.code === 'name_taken');
  assert.equal(childName({ parentName: 'lead', taken: new Set(['lead-w1']) }), 'lead-w2');
  assert.equal(childName({ parentName: 'S1', taken: new Set() }), 's1-w1');
  assert.equal(childName({ parentName: '9x', taken: new Set() }), 'w1');
  const long = childName({ parentName: 'a'.repeat(32), taken: new Set() });
  assert.ok(CHILD_NAME_RE.test(long) && long.length <= 32);
});

test('K4: 나무 자리 — 부모 오른쪽 열, 형제는 위아래로 쌓이고, 막히면 한 열 더 오른쪽', () => {
  const size = SIZE_STEPS.small;
  const parent = { x: 0, y: 0, w: 720, h: 460 };
  const items = [parent];
  const fits = (c) => !items.some((i) => overlaps(c, i, GAP - 1));
  const a = childSlot({ parent, siblings: [], size, fits });
  assert.equal(a.x, 720 + 200); assert.equal(a.y, 0);
  items.push(a);
  const b = childSlot({ parent, siblings: [a], size, fits });
  assert.equal(b.x, a.x); assert.equal(b.y, a.y + a.h + GAP);
  items.push(b);
  // 사람이 형제 하나를 멀리 옮겼으면 그 열의 남은 형제 아래
  const moved = { ...b, x: 5000, y: 5000 };
  const c = childSlot({ parent, siblings: [a, moved], size, fits: (r) => !items.filter((i) => i !== b).concat([moved]).some((i) => overlaps(r, i, GAP - 1)) });
  assert.equal(c.x, a.x); assert.equal(c.y, a.y + a.h + GAP);
  // 열이 다른 노드로 막혀 있으면 다음 열
  const wall = { x: 840, y: -10000, w: 480, h: 30000 };
  const d = childSlot({ parent, siblings: [], size, fits: (r) => !overlaps(r, wall, GAP - 1) && !overlaps(r, parent, GAP - 1) });
  assert.ok(d.x > wall.x + wall.w);
  assert.equal(childSlot({ parent: null, size, fits }), null);
});

// ---------- 승인 규칙과 env ----------
// Claude Code 규칙의 대략적인 맞춤(시험용): Tool(prefix:*)는 prefix로 시작, Tool(a b *)는 a b 뒤 아무것, Tool(x)는 같음
function allowed(rules, tool, cmd) {
  return rules.some((r) => {
    const m = /^(\w+)\((.*)\)$/.exec(r); if (!m || m[1] !== tool) return false;
    const p = m[2];
    if (p.endsWith(':*')) return cmd === p.slice(0, -2) || cmd.startsWith(p.slice(0, -2) + ' ') || cmd.startsWith(p.slice(0, -2));
    if (p.endsWith(' *')) return cmd.startsWith(p.slice(0, -1));
    if (p.endsWith('*')) return cmd.startsWith(p.slice(0, -1));
    return cmd === p;
  });
}
test('K2: 승인 규칙 — 하위 세션 명령과 herdr 일 시키기·기다리기·답 읽기만. 다른 atrium·herdr 명령과 다른 판 호출은 묻는다', () => {
  for (const c of ['atrium child w1', 'atrium child w1 --prompt "x"', 'atrium children', 'atrium children --all', 'atrium child-kill w1', 'mtask child w1', 'mtask child w1 --prompt "x"', 'mtask children', 'mtask children --all', 'mtask child-kill w1', 'herdr agent prompt w1 "do it" --wait --timeout 600000', 'herdr agent wait w1 --timeout 600000', 'herdr agent read w1 --source recent-unwrapped --lines 80']) {
    assert.ok(allowed(BRANCH_ALLOW, 'Bash', c), `허용해야 한다: ${c}`);
  }
  for (const c of ['atrium kill w1', 'atrium settings set tray on', 'mtask kill w1', 'mtask settings set tray on', 'mtask call session.kill', 'node mtask.mjs kill w1', 'herdr pane split --current', 'herdr agent start x', 'herdr agent send-keys w1 enter', 'herdr --session other agent prompt w1 "x"', 'herdr server stop', 'mtaskchild']) {
    assert.ok(!allowed(BRANCH_ALLOW, 'Bash', c), `묻어야 한다: ${c}`);
  }
  assert.ok(allowed(BRANCH_ALLOW, 'PowerShell', 'mtask child w1'));
  assert.ok(allowed(BRANCH_ALLOW, 'PowerShell', 'atrium child w1'));
  assert.ok(!BRANCH_ALLOW.some((r) => /herdr:\*|herdr \*\)/.test(r)), 'herdr 전체 허용(P4 allowHerdr)은 넣지 않는다');
});

test('K1·K2: 세션 설정 파일에 env(판, 세션 ID, 세션 토큰)와 규칙이 들어가고 hook·allowHerdr는 그대로', () => {
  const d = tmp();
  const f = path.join(d, 's.json');
  writeSessionSettings({ file: f, hookUrl: 'http://127.0.0.1:47820/hooks/claude', token: 'h', sessionId: 'sid', env: { ATRIUM_PORT: '47820', ATRIUM_SESSION_ID: 'sid', ATRIUM_SESSION_TOKEN: 't' }, allow: BRANCH_ALLOW });
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(j.env.ATRIUM_PORT, '47820'); assert.equal(j.env.ATRIUM_SESSION_ID, 'sid');
  assert.deepEqual(j.permissions.allow, BRANCH_ALLOW);
  assert.ok(j.hooks.Stop);
  assert.ok(!Object.keys(j.env).some((k) => /ANTHROPIC|CLAUDE/.test(k)));
  const g = path.join(d, 'g.json');
  writeSessionSettings({ file: g, hookUrl: 'x', token: 'h', sessionId: 'sid', allowHerdr: true, allow: BRANCH_ALLOW });
  const k = JSON.parse(fs.readFileSync(g, 'utf8')).permissions.allow;
  assert.deepEqual(k.slice(0, HERDR_ALLOW.length), HERDR_ALLOW);
  assert.equal(new Set(k).size, k.length);
});

test('K1: 워크트리는 처음 띄울 때만 claude -w로 넘기고 이어 가기 명령에는 넣지 않는다. 하위 세션은 새 세션 ID로(갈라 열기 없음)', () => {
  const a = buildStartArgs({ sessionId: 'id1', settingsPath: 's.json', permissionMode: 'manual', model: 'haiku', worktree: 'feat-a' });
  assert.deepEqual(a.slice(0, 4), ['--session-id', 'id1', '--worktree', 'feat-a']);
  const r = buildResumeArgv({ sessionId: 'id1', settingsPath: 's.json', permissionMode: 'manual', worktree: 'feat-a' });
  assert.ok(!r.includes('--worktree') && !r.includes('--fork-session'));
  assert.ok(!buildStartArgs({ sessionId: 'id2', settingsPath: 's', permissionMode: 'manual' }).includes('--worktree'));
});

test('K2: 플러그인에 일 맡기기 스킬과 atrium 명령(sh, cmd, 별칭 mtask)이 생기고 짧은 안내에 한 줄', () => {
  const d = tmp();
  const pl = writeBoardPlugin({ dir: d, skillText: '---\nname: herdr\n---\n', skills: { delegate: delegateSkill(LIMITS) }, bin: childShims({ node: 'C:\\node\\node.exe', script: 'C:\\m\\bin\\atrium-child.mjs' }) });
  const root = path.join(d, 'atrium-herdr');
  const skill = fs.readFileSync(path.join(root, 'skills', 'delegate', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: delegate\n/);
  assert.ok(!skill.includes('mtask') && !skill.includes('multitask'));
  for (const w of ['atrium child', 'herdr agent prompt', 'herdr agent read', 'atrium child-kill', '하위 세션 4개', '깊이 3단계', '판 전체 16개', '--session']) assert.ok(skill.includes(w), w);
  for (const c of ['atrium', 'mtask']) { // 옛 이름 mtask는 P18 전에 띄운 세션의 스킬 글이 말한다
    const sh = fs.readFileSync(path.join(root, 'bin', c), 'utf8');
    assert.match(sh, /^#!\/bin\/sh\n/); assert.match(sh, /exec "C:\/node\/node.exe" "C:\/m\/bin\/atrium-child.mjs" "\$@"/);
    assert.match(fs.readFileSync(path.join(root, 'bin', `${c}.cmd`), 'utf8'), /"C:\\node\\node.exe" "C:\\m\\bin\\atrium-child.mjs" %\*/);
  }
  assert.match(BOARD_SYSTEM_PROMPT, /delegate/);
  assert.equal(BOARD_SYSTEM_PROMPT.split('\n').length, 6); // P21: 잠든 세션 깨우기 한 줄
  assert.ok(pl.pluginDir.endsWith('atrium-herdr'));
  assert.match(childNotice({ role: '워커', agentName: 'w1', paneId: 'w2:p1', depth: 2 }), /herdr agent prompt w1/);
});

test('K3: 상한은 설정에 있다(정수, 범위 밖은 거부)', () => {
  assert.deepEqual(normalizePatch({ branchMaxChildren: '2' }), { branchMaxChildren: 2 });
  assert.throws(() => normalizePatch({ branchMaxChildren: 0 }), /1~16/);
  assert.throws(() => normalizePatch({ branchMaxDepth: 2.5 }), /정수/);
  const d = tmp(); const store = new Store(path.join(d, 'b.db'));
  const st = new Settings({ store, broadcast: () => {} });
  assert.equal(st.get().branchMaxTotal, 16);
  st.set({ key: 'branchMaxTotal', value: 3 });
  assert.equal(st.get().branchMaxTotal, 3);
  store.close();
});

// ---------- 저장소 옮기기 ----------
test('K4: P7까지의 board.db에 branch 열이 더해지고, 부모·하위 세션 기록이 다시 열어도 남는다', () => {
  const d = tmp(); const file = path.join(d, 'board.db');
  // P7 모양: sessions에 branch 열이 없다
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE sessions (session_id TEXT PRIMARY KEY, name TEXT NOT NULL, cwd TEXT NOT NULL, group_id TEXT, pane_id TEXT, workspace_id TEXT, agent_name TEXT, model TEXT, effort TEXT, permission_mode TEXT NOT NULL, settings_path TEXT NOT NULL, hook_token TEXT NOT NULL, resume_argv TEXT, resume_verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, closed_at INTEGER, seen_at INTEGER, runtime TEXT, touched_at INTEGER, kind TEXT, origin TEXT, parent_session_id TEXT, workspace_key TEXT, close_reason TEXT, dismissed_at INTEGER, reopened_as TEXT) STRICT;`);
  db.prepare("INSERT INTO sessions (session_id, name, cwd, permission_mode, settings_path, hook_token, created_at, kind, origin, parent_session_id) VALUES ('p', 'lead', 'C:/w', 'manual', '', '', 1, 'claude', 'board', NULL), ('q', 'helper', 'C:/w', 'manual', '', '', 2, 'claude', 'adopted', 'p')").run();
  db.close();
  let store = new Store(file);
  const cols = store.db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  assert.ok(cols.includes('branch'));
  let rows = store.branchRows();
  assert.equal(rows.find((r) => r.sessionId === 'q').parentSessionId, 'p');
  assert.equal(rows.find((r) => r.sessionId === 'q').branch, null); // 판에 올린 에이전트는 하위 세션 기록이 없다
  store.setBranch('q', { role: '워커', depth: 2, by: 'p' });
  store.close();
  store = new Store(file);
  rows = store.branchRows();
  assert.deepEqual(rows.find((r) => r.sessionId === 'q').branch, { role: '워커', depth: 2, by: 'p' });
  store.close();
});

// ---------- Branch(가짜 판) ----------
async function fakeBoard({ limits } = {}) {
  const dir = tmp();
  const store = new Store(path.join(dir, 'board.db'));
  if (limits) store.setMeta('settings', limits);
  const ws = await workspaceOf(dir);
  store.insertWorkspace({ ...ws, createdAt: 1 });
  const b = {
    cfg: { profile: 'dev', herdrSession: 'atrium-dev-p8test', port: 0, dataDir: dir }, apiToken: 'board-api-token', store, sessions: new Map(), bus: new EventEmitter(),
    broadcasts: [], spawned: [], killed: [], links: [], queued: [],
    api: { broadcast: (e, d) => b.broadcasts.push([e, d]) }, log: () => {}, requireHerdr: () => {},
    hooked: (s) => s.kind === 'claude' && s.origin === 'board',
    summary: (s) => ({ state: 'ready', ask: null }),
    ensureLink: (from, to, patch) => { const l = { linkId: 'l' + b.links.length, from, to, ...patch }; b.links.push(l); return l; },
    linkEvent: () => ({}),
    queue: { enqueue: (sid, text) => { b.queued.push({ sid, text }); return { deliveryId: 'd' + b.queued.length, status: 'queued' }; } },
    async spawn(p) {
      const id = crypto.randomUUID();
      const s = { sessionId: id, name: p.name, cwd: p.cwd, paneId: `w${b.spawned.length + 2}:p1`, agentName: p.name, model: p.model, effort: p.effort, permissionMode: p.permissionMode, kind: p.kind, origin: 'board', parentSessionId: p.parentSessionId || null, workspaceKey: (await workspaceOf(p.cwd)).key, rt: newRuntime({ kind: p.kind }), createdAt: Date.now() };
      store.insertSession({ ...s, settingsPath: '', hookToken: '', runtime: s.rt });
      b.sessions.set(id, s);
      if (p.branch) b.branch.noteChild(id, p.branch);
      const place = p.branch ? b.branch.placeChild(p.parentSessionId, s.workspaceKey) : null;
      store.setNode({ session_id: id, x: place ? place.x : 0, y: place ? place.y : 5000 + b.spawned.length * 600, w: place ? place.w : 720, h: place ? place.h : 460, size: place ? place.size : null });
      b.spawned.push({ ...p, place });
      return { sessionId: id, trust: { needsTrust: false } };
    },
    async kill({ session }) { const s = b.sessions.get(session); b.sessions.delete(session); store.updateSession(session, { closedAt: Date.now() }); b.bus.emit('closed', s); b.killed.push(s.name); return { closed: true }; },
  };
  b.branch = new Branch(b, { readyWaitMs: 30, submitWaitMs: 10 });
  const lead = { sessionId: crypto.randomUUID(), name: 'lead', cwd: dir, paneId: 'w1:p1', agentName: 'lead', model: 'haiku', effort: 'low', permissionMode: 'acceptEdits', kind: 'claude', origin: 'board', parentSessionId: null, workspaceKey: ws.key, rt: newRuntime({ kind: 'claude' }), createdAt: 1 };
  store.insertSession({ ...lead, settingsPath: '', hookToken: '', runtime: lead.rt });
  store.setNode({ session_id: lead.sessionId, x: 0, y: 0, w: 720, h: 460 });
  b.sessions.set(lead.sessionId, lead);
  return { b, dir, lead, ws };
}

test('K1: 하위 세션은 부모의 폴더·모델·노력 수준·권한 모드를 물려받고(P22: 그룹 없음), 역할 선(워커)과 판 이벤트가 남는다. 지시에 다른 값이 있으면 그것', async () => {
  const { b, dir, lead } = await fakeBoard();
  const r = await b.branch.spawnChild(lead, { name: 'w1', wait: false });
  const p = b.spawned[0];
  assert.equal(p.cwd, dir); assert.equal(p.model, 'haiku'); assert.equal(p.effort, 'low'); assert.equal(p.permissionMode, 'acceptEdits'); assert.equal(p.group, undefined); assert.equal(p.parentSessionId, lead.sessionId);
  assert.equal(r.role, '워커'); assert.equal(r.depth, 2); assert.equal(r.agentName, 'w1'); assert.match(r.notice, /herdr agent prompt w1/);
  assert.deepEqual(b.links[0], { linkId: 'l0', from: lead.sessionId, to: r.sessionId, role: '워커', spawned: true });
  assert.ok(b.store.events({ sessionId: lead.sessionId }).some((e) => e.kind === 'branch_child' && e.data.child === 'w1'));
  // 다른 모델·역할·첫 지시
  const r2 = await b.branch.spawnChild(lead, { name: 'w2', model: 'sonnet', role: '리뷰어', prompt: 'Reply with exactly: ok', wait: false });
  assert.equal(b.spawned[1].model, 'sonnet'); assert.equal(r2.role, '리뷰어');
  assert.deepEqual(b.queued[0], { sid: r2.sessionId, text: 'Reply with exactly: ok' });
  // 요약: 깊이와 부모 이름
  const sum = b.branch.summaryExtra(b.sessions.get(r.sessionId)).branch;
  assert.equal(sum.depth, 2); assert.equal(sum.parentName, 'lead'); assert.equal(sum.role, '워커'); assert.equal(sum.child, true);
  assert.equal(b.branch.summaryExtra(lead).branch.children, 2);
  // 워크트리는 git 저장소에서만
  await assert.rejects(b.branch.spawnChild(lead, { name: 'w3', worktree: 'feat', wait: false }), /git 저장소/);
  await assert.rejects(b.branch.spawnChild(lead, { name: 'w3', kind: 'shell', wait: false }), /에이전트만/);
  // 신뢰를 받지 않은 저장소에서는 claude -w가 바로 끝나므로 띄우기 전에 거부한다(신뢰는 대신 누르지 않는다)
  const repo = tmp();
  execFileSync('git', ['init', '-q', repo]);
  b.cfg.claudeJson = path.join(repo, 'no-claude.json');
  fs.writeFileSync(b.cfg.claudeJson, JSON.stringify({ projects: {} }));
  await assert.rejects(b.branch.spawnChild(lead, { name: 'w3', cwd: repo, worktree: 'feat', wait: false }), (e) => e.code === 'needs_trust');
  fs.writeFileSync(b.cfg.claudeJson, JSON.stringify({ projects: { [repo.split(path.sep).join('/')]: { hasTrustDialogAccepted: true } } }));
  const wt = await b.branch.spawnChild(lead, { name: 'w3', cwd: repo, worktree: 'feat', wait: false });
  assert.equal(b.spawned.at(-1).worktree, 'feat'); assert.equal(wt.worktree, 'feat');
});

test('K1: 다른 폴더면 그 워크스페이스에 띄운다', async () => {
  const { b, lead } = await fakeBoard();
  const other = tmp();
  const r = await b.branch.spawnChild(lead, { name: 'far', cwd: other, wait: false });
  assert.equal(b.spawned[0].cwd, path.resolve(other));
  assert.notEqual(r.workspaceKey, lead.workspaceKey);
  assert.equal(b.spawned[0].place, null); // 다른 워크스페이스는 그 영역의 빈자리 규칙
});

test('K4: 하위 세션 노드는 부모 오른쪽에 작게, 형제는 위아래로 쌓인다', async () => {
  const { b, lead } = await fakeBoard();
  await b.branch.spawnChild(lead, { name: 'w1', wait: false });
  await b.branch.spawnChild(lead, { name: 'w2', wait: false });
  const [a, c] = b.spawned.map((x) => x.place);
  assert.equal(a.size, 'small'); assert.equal(a.w, SIZE_STEPS.small.w);
  assert.ok(a.x >= 720); assert.equal(a.y, 0);
  assert.equal(c.x, a.x); assert.equal(c.y, a.y + a.h + GAP);
});

test('K2·K3: 하위 세션이 다시 펼쳐 3단계 나무가 되고, 다섯 번째·4단계·판 전체 상한은 거부되며 판 이벤트에 까닭이 남는다', async () => {
  const { b, lead } = await fakeBoard();
  const w1 = await b.branch.spawnChild(lead, { name: 'w1', wait: false });
  const mid = b.sessions.get(w1.sessionId);
  const g1 = await b.branch.spawnChild(mid, { name: 'g1x', wait: false });
  assert.equal(g1.depth, 3);
  const leaf = b.sessions.get(g1.sessionId);
  await assert.rejects(b.branch.spawnChild(leaf, { name: 'too-deep', wait: false }), (e) => e.code === 'too_deep' && /3단계/.test(e.message));
  for (const n of ['w2', 'w3', 'w4']) await b.branch.spawnChild(lead, { name: n, wait: false });
  await assert.rejects(b.branch.spawnChild(lead, { name: 'w5', wait: false }), (e) => e.code === 'too_many_children' && e.limit === 4);
  const ev = b.store.events({}).filter((e) => e.kind === 'branch_refused').map((e) => e.data.code);
  assert.deepEqual(ev, ['too_deep', 'too_many_children']);
  assert.ok(b.broadcasts.some(([e, d]) => e === 'branch.refused' && d.code === 'too_many_children'));
  // 판 전체 상한(설정을 줄여 본다)
  b.store.setMeta('settings', { branchMaxTotal: 6 });
  await b.branch.spawnChild(mid, { name: 'g2x', wait: false }); // 6개째
  await assert.rejects(b.branch.spawnChild(mid, { name: 'g3x', wait: false }), (e) => e.code === 'board_full');
});

test('K3: 자기 자손이 아니면 끄기를 not_parent로 거부하고, 자손을 끄면 그 아래도 깊은 것부터 끈다', async () => {
  const { b, lead } = await fakeBoard();
  const w1 = await b.branch.spawnChild(lead, { name: 'w1', wait: false });
  const w2 = await b.branch.spawnChild(lead, { name: 'w2', wait: false });
  const mid = b.sessions.get(w1.sessionId);
  await b.branch.spawnChild(mid, { name: 'deep', wait: false });
  const sib = b.sessions.get(w2.sessionId);
  await assert.rejects(b.branch.killChild(sib, { name: 'w1' }), (e) => e.code === 'not_parent');
  await assert.rejects(b.branch.killChild(mid, { name: 'lead' }), (e) => e.code === 'not_parent');
  await assert.rejects(b.branch.killChild(lead, { name: 'lead' }), (e) => e.code === 'not_parent');
  assert.ok(b.store.events({}).some((e) => e.kind === 'branch_refused' && e.data.code === 'not_parent'));
  const r = await b.branch.killChild(lead, { name: 'w1' });
  assert.deepEqual(r.killed.map((k) => k.name), ['deep', 'w1']);
  assert.deepEqual(b.killed, ['deep', 'w1']);
  // 닫힌 자식 아래가 남은 경우도(only로 가운데만 끈 뒤) 할아버지가 끌 수 있다
  const w3 = await b.branch.spawnChild(lead, { name: 'w3', wait: false });
  await b.branch.spawnChild(b.sessions.get(w3.sessionId), { name: 'orphan', wait: false });
  await b.branch.killChild(lead, { name: 'w3', only: true });
  assert.ok([...b.sessions.values()].some((s) => s.name === 'orphan'));
  await b.branch.killChild(lead, { name: 'orphan' });
  assert.ok(![...b.sessions.values()].some((s) => s.name === 'orphan'));
  // 목록
  const ls = b.branch.listChildren(lead, {});
  assert.deepEqual(ls.children.map((c) => c.name), ['w2']);
});

// ---------- HTTP와 명령 ----------
function serve(b) {
  const srv = http.createServer((req, res) => { if (!b.branch.handleHttp(req, res)) { res.writeHead(404); res.end(); } });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => { b.cfg.port = srv.address().port; r(srv); }));
}
function runChild(args, env, script = 'atrium-child.mjs') {
  return new Promise((resolve) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('MTASK_') && !k.startsWith('ATRIUM_')));
    execFile(process.execPath, [path.join(HERE, '..', 'bin', script), ...args], { env: { ...clean, ...env }, timeout: 20000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

test('K1: 하위 세션 명령은 env의 판으로 세션 토큰을 들고 간다. 토큰이 틀리거나 판에 없는 세션이면 거부, 다른 판이 답하면 멈춘다', async () => {
  const { b, lead } = await fakeBoard();
  const srv = await serve(b);
  try {
    const env = b.branch.envFor(lead.sessionId);
    assert.equal(env.ATRIUM_HERDR_SESSION, 'atrium-dev-p8test'); assert.equal(env.ATRIUM_SESSION_ID, lead.sessionId);
    assert.ok(env.ATRIUM_SESSION_TOKEN !== b.apiToken && env.ATRIUM_SESSION_TOKEN.length === 64); // 판 API 토큰이 아니다
    const ok = await runChild(['child', 'w1', '--no-wait'], env);
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /하위 세션을 만들었다: @w1 \(herdr 이름 w1/);
    assert.match(ok.stdout, /일 시키기: herdr agent prompt w1/);
    const ls = await runChild(['children'], env);
    assert.match(ls.stdout, /@lead\(1단계\)의 하위 세션 1개/);
    // P18 전에 띄운 세션: 옛 플러그인 shim이 부르는 mtask-child.mjs와 옛 env(MTASK_*)도 된다
    const old = Object.fromEntries(Object.entries(env).map(([k, v]) => [k.replace(/^ATRIUM_/, 'MTASK_'), v]));
    const ls2 = await runChild(['children'], old, 'mtask-child.mjs');
    assert.equal(ls2.code, 0, ls2.stderr); assert.match(ls2.stdout, /@lead\(1단계\)의 하위 세션 1개/);
    const bad = await runChild(['children'], { ...env, ATRIUM_SESSION_TOKEN: 'x'.repeat(64) });
    assert.notEqual(bad.code, 0); assert.match(bad.stderr, /bad_token/);
    assert.ok(b.store.events({}).some((e) => e.kind === 'branch_rejected'));
    const nobody = await runChild(['children'], { ...env, ATRIUM_SESSION_ID: 'nope' });
    assert.match(nobody.stderr, /not_on_board/);
    const other = await runChild(['children'], { ...env, ATRIUM_HERDR_SESSION: 'atrium' });
    assert.match(other.stderr, /다른 판이 답했다/);
    const noenv = await runChild(['child'], {});
    assert.match(noenv.stderr, /판이 띄운 세션이 아니다/);
    const nope = await runChild(['kill', 'w1'], env);
    assert.equal(nope.code, 2); assert.match(nope.stderr, /child, children, child-kill, wake만/);
    const five = await runChild(['child-kill', 'lead'], env);
    assert.match(five.stderr, /not_parent/);
  } finally { srv.close(); }
});

test('K1: 판이 띄운 세션의 설정 파일을 다시 쓸 때(P8 전 세션) env와 규칙만 더하고 hook과 다른 규칙은 그대로', async () => {
  const { b, dir, lead } = await fakeBoard();
  const f = path.join(dir, 'old.json');
  writeSessionSettings({ file: f, hookUrl: 'http://127.0.0.1:1/hooks/claude', token: 'h', sessionId: lead.sessionId, allowHerdr: true });
  lead.settingsPath = f;
  assert.equal(b.branch.refreshSettings(), 1);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(j.env.ATRIUM_SESSION_ID, lead.sessionId);
  for (const r of [...HERDR_ALLOW, ...BRANCH_ALLOW]) assert.ok(j.permissions.allow.includes(r), r);
  assert.ok(j.hooks.UserPromptSubmit);
  assert.equal(b.branch.refreshSettings(), 0); // 이미 있으면 다시 쓰지 않는다
});

test('Gemini children inherit their provider/model; cross-provider children keep explicit models only', async () => {
  const { b, dir, lead } = await fakeBoard();
  try {
    lead.kind = 'gemini'; lead.model = 'gemini-fixture'; lead.effort = null;
    await b.branch.spawnChild(lead, { name: 'gemini-reviewer', role: 'reviewer', wait: false });
    assert.equal(b.spawned[0].kind, 'gemini'); assert.equal(b.spawned[0].model, 'gemini-fixture');
    await b.branch.spawnChild(lead, { name: 'claude-reviewer', kind: 'claude', wait: false });
    assert.equal(b.spawned[1].model, null); assert.equal(b.spawned[1].effort, null);
    await b.branch.spawnChild(lead, { name: 'codex-reviewer', kind: 'codex', model: 'custom-codex', wait: false });
    assert.equal(b.spawned[2].model, 'custom-codex');
    assert.deepEqual(b.links.map((l) => l.from), Array(3).fill(lead.sessionId));
  } finally { b.store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
