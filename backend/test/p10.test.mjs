// P10 단위 시험: 보관(손으로, 저절로, 꺼내기, 오래된 것), 보관된 대화를 다시 읽지 않는 색인, 리포 스스로 찾기(cli 출처만, 닫은 것 기억, 작은 빈 영역),
// 대화 기록 폴더 하나를 바로 가리키기, 설정 값. herdr와 claude 없이 돈다. 대화 기록은 직접 만든 가짜 자료이고 실제 ~/.claude는 읽지 않는다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { pathKey, normPath } from '../src/workspaces.mjs';
import { listTranscriptFiles } from '../src/convos.mjs';
import { Recall, skipDiscoverDir } from '../src/recall.mjs';
import { archiveState, isOld, discoverable, DAY_MS } from '../src/archive.mjs';
import { normalizePatch, DEFAULTS } from '../src/settings.mjs';
import { regionRect, EMPTY_REGION, AUTO_EMPTY_REGION } from '../src/canvas.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p10-'));
const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-00000000a010`;
const ago = (days) => new Date(Date.now() - days * DAY_MS).toISOString();
const user = (text, { cwd, at = ago(0.5), entrypoint = 'cli' } = {}) => JSON.stringify({ type: 'user', uuid: Math.random().toString(36).slice(2), cwd, entrypoint, timestamp: at, message: { role: 'user', content: text } });
const answer = (text, { cwd, at = ago(0.5), entrypoint = 'cli' } = {}) => JSON.stringify({ type: 'assistant', uuid: Math.random().toString(36).slice(2), cwd, entrypoint, timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text }] } });
function writeConvo(root, cwd, id, lines, { mtimeDaysAgo = null } = {}) {
  const dir = path.join(root, path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  if (mtimeDaysAgo != null) { const t = new Date(Date.now() - mtimeDaysAgo * DAY_MS); fs.utimesSync(f, t, t); }
  return f;
}
const convo = (root, cwd, id, { days = 0.5, entrypoint = 'cli', text = '지시' } = {}) => writeConvo(root, cwd, id, [user(text, { cwd, at: ago(days), entrypoint }), answer('답', { cwd, at: ago(days), entrypoint })], { mtimeDaysAgo: days });

const folderWs = (dir) => ({ key: pathKey(dir), kind: 'folder', root: normPath(dir) });
const fakeResolve = (map = {}) => async (cwd) => map[pathKey(cwd)] || folderWs(cwd);
function fakeBackend({ convoRoots, workspaces = [] } = {}) {
  const dataDir = tmp();
  const store = new Store(path.join(dataDir, 'board.db'));
  for (const w of workspaces) store.insertWorkspace({ ...w, createdAt: Date.now() });
  const events = [];
  const b = {
    cfg: { convoRoots, claudeSessionsDir: tmp(), desktopSessionsDir: null, convoScanMs: 60000, claudeProjects: convoRoots[0], sessionsDir: path.join(dataDir, 'sessions'), dataDir, hookTimeoutSec: 2, claudeJson: path.join(dataDir, 'none.json'), claudeCommand: 'claude' },
    store, bus: new EventEmitter(), sessions: new Map(), events, killing: new Set(),
    api: { broadcast: (ev, data) => events.push([ev, data]) },
    log: () => {}, hooked: () => true,
    resolveWorkspace: async (r) => store.getWorkspace(r) || store.workspaces().find((w) => w.root === normPath(r)),
    ensureWorkspace: (ws) => { if (store.getWorkspace(ws.key)) return false; store.insertWorkspace({ ...ws, createdAt: Date.now() }); return true; },
    broadcastWorkspaces: () => events.push(['workspace.updated']),
  };
  return b;
}
function addClosed(b, { id, name, cwd, ws, closedDaysAgo = 0.5, kind = 'claude' }) {
  const rt = newRuntime({ kind, hooked: kind === 'claude' });
  rt.lastActivityAt = Date.now() - closedDaysAgo * DAY_MS;
  b.store.insertSession({ sessionId: id, name, cwd, permissionMode: 'manual', createdAt: 1, runtime: rt, kind, origin: 'board', workspaceKey: ws.key });
  b.store.updateSession(id, { closedAt: Date.now() - closedDaysAgo * DAY_MS, closeReason: 'killed' });
}
const settingsOf = (o) => () => ({ ...DEFAULTS, ...o });
const names = (list) => list.map((x) => x.name || x.convId).sort();

// ---------- 순수 함수 ----------
test('보관 판정: 손 보관, 기간(0이면 끔), 꺼낸 시각부터 다시 셈, 시각을 모르면 보이는 쪽', () => {
  const now = Date.now();
  assert.deepEqual(archiveState({ lastAt: now - 20 * DAY_MS, days: 14, now }).why, 'auto');
  assert.equal(archiveState({ lastAt: now - 13 * DAY_MS, days: 14, now }).archived, false);
  assert.equal(archiveState({ lastAt: now - 20 * DAY_MS, days: 0, now }).archived, false);
  assert.equal(archiveState({ lastAt: now, mark: { archivedAt: now }, days: 0, now }).why, 'manual');
  assert.equal(archiveState({ lastAt: now - 20 * DAY_MS, mark: { restoredAt: now - DAY_MS }, days: 14, now }).archived, false); // 꺼낸 뒤 하루
  assert.equal(archiveState({ lastAt: now - 40 * DAY_MS, mark: { restoredAt: now - 15 * DAY_MS }, days: 14, now }).archived, true); // 꺼낸 뒤 15일
  assert.equal(archiveState({ lastAt: 0, days: 14, now }).archived, false);
  assert.equal(isOld({ lastAt: now - 2 * DAY_MS, now }), true);
  assert.equal(isOld({ lastAt: now - 0.5 * DAY_MS, now }), false);
  assert.equal(isOld({ lastAt: now - 2 * DAY_MS, mark: { archivedAt: now }, now }), false);
  // 리포 스스로 찾기: cli 출처, 지시 있음, 기간 안, 손 보관 아님
  assert.equal(discoverable({ entrypoints: ['cli'], prompts: 1, lastAt: now - DAY_MS, now }), true);
  assert.equal(discoverable({ entrypoints: ['claude-desktop'], prompts: 1, lastAt: now - DAY_MS, now }), false);
  assert.equal(discoverable({ entrypoints: ['cli', 'claude-desktop'], prompts: 1, lastAt: now - DAY_MS, now }), true);
  assert.equal(discoverable({ entrypoints: ['sdk-cli'], prompts: 1, lastAt: now - DAY_MS, now }), false);
  assert.equal(discoverable({ entrypoints: ['cli'], prompts: 0, lastAt: now - DAY_MS, now }), false);
  assert.equal(discoverable({ entrypoints: ['cli'], prompts: 1, lastAt: now - 20 * DAY_MS, now }), false);
  assert.equal(discoverable({ entrypoints: ['cli'], prompts: 1, lastAt: now - DAY_MS, mark: { archivedAt: now }, now }), false);
});

test('설정: archiveDays(0~365, 0이면 끔, 기본 14), autoOpenRepos(기본 켬)', () => {
  assert.equal(DEFAULTS.archiveDays, 14); assert.equal(DEFAULTS.autoOpenRepos, true);
  assert.deepEqual(normalizePatch({ archiveDays: '0' }), { archiveDays: 0 });
  assert.deepEqual(normalizePatch({ autoOpenRepos: 'off' }), { autoOpenRepos: false });
  assert.throws(() => normalizePatch({ archiveDays: 400 }), /0~365/);
});

test('빈 영역: 저절로 연 워크스페이스는 작게, 안에 노드가 생기면 노드를 감싼다', () => {
  assert.deepEqual(regionRect([], { x: 0, y: 0 }), { x: 0, y: 0, ...EMPTY_REGION });
  assert.deepEqual(regionRect([], { x: 0, y: 0, auto: true }), { x: 0, y: 0, ...AUTO_EMPTY_REGION });
  assert.ok(AUTO_EMPTY_REGION.w * AUTO_EMPTY_REGION.h < EMPTY_REGION.w * EMPTY_REGION.h / 2);
  assert.equal(regionRect([{ x: 100, y: 100, w: 720, h: 460 }], { x: 0, y: 0, auto: true }).w, 800);
});

test('대화 기록 폴더 하나(<폴더 이름>)를 바로 가리켜도 그 폴더의 대화만 읽는다', async () => {
  const root = tmp(); const cwd = tmp();
  convo(root, cwd, ID(1)); convo(root, tmp(), ID(2));
  const one = path.join(root, path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(path.join(one, ID(1), 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(one, ID(1), 'subagents', `${ID(9)}.jsonl`), '{}');
  assert.deepEqual((await listTranscriptFiles([one])).map((f) => f.convId), [ID(1)]);
  assert.deepEqual((await listTranscriptFiles([root])).map((f) => f.convId).sort(), [ID(1), ID(2)]);
});

// ---------- 보관 ----------
test('보관: 판 밖 대화와 닫힌 세션을 손으로 보관하면 기본 목록에서 빠지고 보관함에 보인다. 꺼내면 돌아온다. 파일과 판 기록은 그대로', async () => {
  const root = tmp(); const ws = tmp(); const W = folderWs(ws);
  const f1 = convo(root, ws, ID(1), { text: '보관할 대화' }); convo(root, ws, ID(2), { text: '남길 대화' });
  const b = fakeBackend({ convoRoots: [root], workspaces: [W] });
  addClosed(b, { id: ID(11), name: 's1', cwd: ws, ws: W });
  addClosed(b, { id: ID(12), name: 's2', cwd: ws, ws: W });
  const r = new Recall(b, { resolveCwd: fakeResolve(), readProcs: async () => [], settings: settingsOf({ autoOpenRepos: false }) });
  await r.scan({ wait: true });
  let l = (await r.list()).workspaces[0];
  assert.deepEqual(names(l.convos), [ID(1), ID(2)]); assert.deepEqual(names(l.closed), ['s1', 's2']);
  r.archiveAdd({ convo: ID(1) }); r.archiveAdd({ session: 's1' });
  await r.changed();
  l = (await r.list()).workspaces[0];
  assert.deepEqual(names(l.convos), [ID(2)]); assert.deepEqual(names(l.closed), ['s2']); assert.equal(l.archived, 2);
  const a = (await r.archiveList()).workspaces[0];
  assert.deepEqual(names(a.convos), [ID(1)]); assert.deepEqual(names(a.closed), ['s1']);
  assert.equal(a.convos[0].archive.why, 'manual'); assert.equal(a.convos[0].title, '보관할 대화');
  assert.ok(fs.existsSync(f1)); assert.ok(b.store.getSession(ID(11))); // 지우지 않는다
  r.archiveRestore({ convo: ID(1) }); r.archiveRestore({ session: ID(11) });
  await r.changed();
  l = (await r.list()).workspaces[0];
  assert.deepEqual(names(l.convos), [ID(1), ID(2)]); assert.deepEqual(names(l.closed), ['s1', 's2']); assert.equal(l.archived, 0);
  // P7의 빼기는 보관이다. 예전 board.db의 dismissed_at도 보관으로 읽는다
  r.dismiss({ session: 's2' }); await r.changed();
  assert.deepEqual(names((await r.list()).workspaces[0].closed), ['s1']);
  addClosed(b, { id: ID(13), name: 's3', cwd: ws, ws: W });
  b.store.updateSession(ID(13), { dismissedAt: Date.now() }); await r.changed(); // P7에서 뺀 세션(보관 표에 줄이 없음)
  assert.deepEqual(names((await r.list()).workspaces[0].closed), ['s1']);
  assert.deepEqual(names((await r.archiveList()).workspaces[0].closed), ['s2', 's3']);
  r.archiveRestore({ session: 's3' }); await r.changed();
  assert.deepEqual(names((await r.list()).workspaces[0].closed), ['s1', 's3']);
  assert.equal(b.store.closedSession(ID(13)).dismissedAt, null);
});

test('보관: 판에 열려 있는 세션은 보관하지 않는다(먼저 끈다). 모르는 대화는 not_found', async () => {
  const root = tmp(); const ws = tmp(); const W = folderWs(ws);
  const b = fakeBackend({ convoRoots: [root], workspaces: [W] });
  b.store.insertSession({ sessionId: ID(21), name: 'live', cwd: ws, permissionMode: 'manual', createdAt: 1, runtime: newRuntime({}), kind: 'claude', origin: 'board', workspaceKey: W.key });
  b.sessions.set(ID(21), { sessionId: ID(21), name: 'live' });
  const r = new Recall(b, { resolveCwd: fakeResolve(), readProcs: async () => [], settings: settingsOf({ autoOpenRepos: false }) });
  assert.throws(() => r.archiveAdd({ session: 'live' }), (e) => e.code === 'open_session');
  assert.throws(() => r.archiveAdd({ convo: ID(21) }), (e) => e.code === 'open_session');
  assert.throws(() => r.archiveAdd({ convo: ID(99) }), (e) => e.code === 'not_found');
});

test('저절로 보관: 기간보다 오래된 판 밖 대화와 닫힌 세션은 기본 목록에서 빠진다. 꺼내면 그 뒤로 다시 센다. 기간 0이면 끈다', async () => {
  const root = tmp(); const ws = tmp(); const W = folderWs(ws);
  convo(root, ws, ID(1), { days: 30 }); convo(root, ws, ID(2), { days: 1 });
  const b = fakeBackend({ convoRoots: [root], workspaces: [W] });
  addClosed(b, { id: ID(11), name: 'old', cwd: ws, ws: W, closedDaysAgo: 20 });
  addClosed(b, { id: ID(12), name: 'new', cwd: ws, ws: W, closedDaysAgo: 2 });
  let days = 14;
  const r = new Recall(b, { resolveCwd: fakeResolve(), readProcs: async () => [], settings: () => ({ ...DEFAULTS, archiveDays: days, autoOpenRepos: false }) });
  await r.scan({ wait: true });
  let l = (await r.list()).workspaces[0];
  assert.deepEqual(names(l.convos), [ID(2)]); assert.deepEqual(names(l.closed), ['new']); assert.equal(l.archived, 2);
  const a = (await r.archiveList()).workspaces[0];
  assert.equal(a.convos[0].archive.why, 'auto'); assert.equal(a.closed[0].name, 'old');
  r.archiveRestore({ convo: ID(1) }); r.archiveRestore({ session: 'old' }); await r.changed();
  l = (await r.list()).workspaces[0];
  assert.deepEqual(names(l.convos), [ID(1), ID(2)]); assert.deepEqual(names(l.closed), ['new', 'old']); // 꺼낸 시각부터 다시 센다
  days = 0; r.archiveAdd({ convo: ID(2) }); await r.changed();
  l = (await r.list()).workspaces[0];
  assert.deepEqual(names(l.convos), [ID(1)]); // 기간을 꺼도 손 보관은 그대로
});

test('오래된 것 보관: 그 리포의 기본 목록에서 하루보다 오래된 것만. confirm 없이는 수만', async () => {
  const root = tmp(); const ws = tmp(); const W = folderWs(ws);
  convo(root, ws, ID(1), { days: 3 }); convo(root, ws, ID(2), { days: 0.2 });
  const b = fakeBackend({ convoRoots: [root], workspaces: [W] });
  addClosed(b, { id: ID(11), name: 'old', cwd: ws, ws: W, closedDaysAgo: 5 });
  addClosed(b, { id: ID(12), name: 'new', cwd: ws, ws: W, closedDaysAgo: 0.1 });
  const r = new Recall(b, { resolveCwd: fakeResolve(), readProcs: async () => [], settings: settingsOf({ autoOpenRepos: false }) });
  await r.scan({ wait: true });
  const ask = await r.archiveOld({ workspace: W.key });
  assert.equal(ask.needsConfirm, true); assert.equal(ask.count, 2);
  assert.equal((await r.list()).workspaces[0].archived, 0);
  const done = await r.archiveOld({ workspace: W.key, confirm: true });
  assert.equal(done.archived, 2);
  await r.changed();
  const l = (await r.list()).workspaces[0];
  assert.deepEqual(names(l.convos), [ID(2)]); assert.deepEqual(names(l.closed), ['new']);
});

test('색인: 손으로 보관한 대화는 파일이 바뀌어도 다시 읽지 않는다. 보관된 대화의 글은 새 워크스페이스를 열어도 채우지 않고 보관함을 열 때 그 리포 것만 채운다', async () => {
  const root = tmp(); const ws = tmp(); const other = tmp(); const W = folderWs(ws);
  const f1 = convo(root, ws, ID(1));
  convo(root, other, ID(2), { days: 30, text: '오래된 다른 곳 대화' }); convo(root, other, ID(3), { days: 1, text: '최근 다른 곳 대화' });
  const b = fakeBackend({ convoRoots: [root], workspaces: [W] });
  const r = new Recall(b, { resolveCwd: fakeResolve(), readProcs: async () => [], settings: settingsOf({ autoOpenRepos: false }) });
  await r.scan({ wait: true });
  r.archiveAdd({ convo: ID(1) });
  fs.appendFileSync(f1, user('보관한 뒤의 지시', { cwd: ws, at: new Date().toISOString() }) + '\n');
  const s = await r.scan({ wait: true });
  assert.equal(s.read, 0); assert.equal(s.skipped, 2); // 손 보관한 ID(1)(바뀜)과 저절로 보관인 ID(2)(글 없음)
  const row = b.store.getConvoById(ID(1));
  assert.equal(row.size, fs.statSync(f1).size); assert.equal(row.lastPrompt, '지시'); // 크기만 고치고 글은 그대로
  // 다른 곳을 열면 기간 안의 대화만 글을 채운다
  b.store.insertWorkspace({ ...folderWs(other), createdAt: Date.now() });
  const s2 = await r.scan({ wait: true });
  assert.equal(s2.read, 1);
  assert.equal(b.store.getConvoById(ID(2)).firstPrompt, null); assert.equal(b.store.getConvoById(ID(3)).firstPrompt, '최근 다른 곳 대화');
  const a = (await r.archiveList({ workspace: pathKey(other) })).workspaces[0];
  assert.deepEqual(names(a.convos), [ID(2)]); assert.equal(a.convos[0].title, '오래된 다른 곳 대화');
  assert.equal(b.store.getConvoById(ID(2)).hasText, true);
});

// ---------- 리포 스스로 찾기 ----------
test('리포 스스로 찾기: 기간 안의 cli 대화가 있는 폴더만 작은 빈 워크스페이스로 연다. 데스크톱만, 오래된 것, 없어진 폴더는 열지 않는다. 닫으면 기억하고, 사람이 다시 열면 잊는다', async () => {
  const root = tmp();
  const cli = tmp(), desk = tmp(), old = tmp(), gone = path.join(tmp(), 'gone');
  convo(root, cli, ID(1)); convo(root, desk, ID(2), { entrypoint: 'claude-desktop' }); convo(root, old, ID(3), { days: 40 }); convo(root, gone, ID(4));
  const b = fakeBackend({ convoRoots: [root] });
  let on = true;
  const r = new Recall(b, { resolveCwd: fakeResolve(), readProcs: async () => [], settings: () => ({ ...DEFAULTS, autoOpenRepos: on }), skipDir: () => false });
  const s = await r.scan({ wait: true });
  assert.deepEqual(s.opened, [pathKey(cli)]);
  const w = b.store.getWorkspace(pathKey(cli));
  assert.equal(w.auto, true);
  assert.ok(b.events.some(([e]) => e === 'workspace.updated'));
  assert.deepEqual(b.store.workspaces().map((x) => x.key), [pathKey(cli)]);
  // 그 리포의 대화가 판 밖 대화로 보인다(글은 다음 훑기에서 채운다)
  await r.scan({ wait: true });
  const l = (await r.list()).workspaces[0];
  assert.equal(l.convos[0].convId, ID(1)); assert.equal(l.convos[0].title, '지시');
  // 사람이 닫으면 다시 열지 않는다
  b.store.deleteWorkspace(pathKey(cli)); b.bus.emit('workspace_closed', pathKey(cli));
  assert.deepEqual((await r.discover()).length, 0);
  assert.equal(b.store.getWorkspace(pathKey(cli)), null);
  b.bus.emit('workspace_opened', pathKey(cli)); // "+ 리포 열기"로 사람이 열면 닫은 기억을 지운다
  assert.deepEqual((await r.discover()).map((x) => x.key), [pathKey(cli)]);
  // 끄면 열지 않는다
  b.store.deleteWorkspace(pathKey(cli)); on = false;
  assert.deepEqual(await r.discover(), []);
});

test('리포 스스로 찾기: 워크트리의 대화는 본 저장소 하나로, 폴더 워크스페이스 아래 폴더는 따로 열지 않는다. 홈·드라이브 루트·임시 폴더는 열지 않는다', async () => {
  const root = tmp();
  const base = tmp();
  try {
    const repo = path.join(base, 'repo'), wt = path.join(base, 'repo-wt'), parent = path.join(base, 'plain'), child = path.join(parent, 'sub');
    for (const d of [repo, wt, child]) fs.mkdirSync(d, { recursive: true });
    const repoWs = { key: pathKey(repo) + '/.git', kind: 'repo', root: normPath(repo) };
    convo(root, wt, ID(1)); convo(root, repo, ID(2)); convo(root, child, ID(3)); convo(root, parent, ID(4));
    const b = fakeBackend({ convoRoots: [root] });
    const r = new Recall(b, { resolveCwd: fakeResolve({ [pathKey(repo)]: repoWs, [pathKey(wt)]: { ...repoWs } }), readProcs: async () => [], settings: settingsOf({}), skipDir: (dir) => skipDiscoverDir(dir, { home: path.join(base, 'synthetic-home'), tmp: path.join(base, 'synthetic-tmp') }) });
    const s = await r.scan({ wait: true });
    assert.deepEqual(s.opened.sort(), [repoWs.key, pathKey(parent)].sort());
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
  assert.equal(skipDiscoverDir(os.homedir()), true);
  assert.equal(skipDiscoverDir('C:\\'), true);
  assert.equal(skipDiscoverDir(path.join(os.tmpdir(), 'x')), true);
  assert.equal(skipDiscoverDir('D:/work/repo', { tmp: 'C:/tmp' }), false);
});

// ---------- 덩어리 첫 노드 끄기(P10 창 시험에서 찾은 오류) ----------
test('H5: 덩어리의 첫 노드인 세션을 끄면 덩어리에서 빠지고 남은 노드는 그 자리부터 틈 없이 붙는다(끄기가 실패하지 않는다)', async () => {
  const { Backend } = await import('../src/backend.mjs');
  const ops = await import('../src/canvas-ops.mjs');
  const b = new Backend({ quietMs: 600000, port: 0, logDir: tmp() });
  b.store = new Store(path.join(tmp(), 'board.db'));
  b.sessions = new Map(); b.api = { broadcast: () => {} }; b.log = () => {};
  b.store.insertWorkspace({ key: 'ws-a', kind: 'folder', root: 'C:/a', createdAt: 1 });
  for (const [i, n] of ['a', 'b', 'c'].entries()) {
    const s = { sessionId: `id-${n}`, name: n, kind: 'shell', workspaceKey: 'ws-a', cwd: 'C:/a', rt: newRuntime({ kind: 'shell', hooked: false }), origin: 'board', createdAt: 1 };
    b.sessions.set(s.sessionId, s); b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    b.store.setNode({ session_id: s.sessionId, x: i * 720, y: 0, w: 720, h: 460, z: 0 });
  }
  ops.dockCreate(b, { members: ['id-a', 'id-b', 'id-c'], dir: 'row' });
  b.sessions.delete('id-a');
  b.store.updateSession('id-a', { closedAt: Date.now() }); // closeSession처럼 닫은 뒤에 덩어리를 고친다
  ops.onSessionClosed(b, { sessionId: 'id-a' });
  assert.deepEqual(ops.dockOf(b, 'id-b').members, ['id-b', 'id-c']);
  const at = (id) => b.store.nodes().find((n) => n.session_id === id);
  assert.deepEqual([at('id-b').x, at('id-c').x], [0, 720]);
  b.store.close();
});
