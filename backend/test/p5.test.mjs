// P5 단위 시험: 리포지토리 워크스페이스(키 정하기, 경로 대소문자, 워크트리, git이 아닌 폴더, 이름), 이전 판 옮기기(P4 스키마 고정 자료),
// 일반 셸(프롬프트 읽기, 상태, @로 보내면 거부), @all 범위, herdr 패널 이벤트. herdr와 claude 없이 돈다(git은 쓴다)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { workspaceFromProbe, workspaceNames, workspaceCounts, elsewhereOf, normPath, pathKey, boundsOf, fitViewport, offscreen } from '../src/workspaces.mjs';
import { workspaceOf, gitProbe, parseRevParse } from '../src/git.mjs';
import { migrateWorkspaces } from '../src/migrate.mjs';
import { shellPromptState } from '../src/screen.mjs';
import { newRuntime, deriveState, flags, applyHerdrStatus } from '../src/state.mjs';
import { normalizeEvent } from '../src/herdr/adapter.mjs';
import { Store } from '../src/store.mjs';
import { Backend } from '../src/backend.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p5-')));
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
function makeRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

test('G1: 워크스페이스 키 — 저장소, 하위 폴더, 워크트리는 같은 키. git이 아닌 폴더는 그 폴더. 경로 대소문자와 슬래시는 상관없다', async () => {
  const root = tmp();
  const repo = makeRepo(path.join(root, 'Repo1'));
  fs.mkdirSync(path.join(repo, 'sub', 'deep'), { recursive: true });
  const wt = path.join(root, 'repo1-wt');
  git(repo, 'worktree', 'add', '-q', '-b', 'mtask-test/wt', wt);
  const plain = path.join(root, 'plain');
  fs.mkdirSync(path.join(plain, 'inner'), { recursive: true });

  const a = await workspaceOf(repo);
  assert.equal(a.kind, 'repo');
  assert.equal(a.key, pathKey(path.join(repo, '.git')));
  assert.equal(a.root, normPath(repo));
  assert.equal((await workspaceOf(path.join(repo, 'sub', 'deep'))).key, a.key, '하위 폴더');
  const w = await workspaceOf(wt);
  assert.equal(w.key, a.key, '워크트리는 본 저장소와 같은 워크스페이스');
  assert.equal(w.root, normPath(repo), '워크트리의 워크스페이스 폴더는 본 저장소');
  // 경로 대소문자, 역슬래시, 끝 슬래시
  if (process.platform === 'win32') assert.equal((await workspaceOf(repo.toUpperCase())).key, a.key);
  assert.equal((await workspaceOf(repo.split(path.sep).join('/') + '/')).key, a.key);
  // git이 아닌 폴더: 그 폴더가 워크스페이스. 그 아래 폴더는 다른 워크스페이스다(시작한 폴더 자체)
  const p = await workspaceOf(plain);
  assert.deepEqual({ kind: p.kind, key: p.key }, { kind: 'folder', key: pathKey(plain) });
  if (process.platform === 'win32') assert.equal((await workspaceOf(plain.toUpperCase() + '\\')).key, p.key);
  assert.notEqual((await workspaceOf(path.join(plain, 'inner'))).key, p.key);
  // 저장소 안에 따로 git init한 폴더는 그 저장소의 워크스페이스
  const nested = makeRepo(path.join(repo, 'nested'));
  assert.equal((await workspaceOf(nested)).key, pathKey(path.join(nested, '.git')));
  // 없는 폴더도 폴더 워크스페이스(오류를 내지 않는다)
  assert.equal((await workspaceOf(path.join(root, 'gone'))).kind, 'folder');
  // 순수 함수: rev-parse 출력
  assert.deepEqual(workspaceFromProbe(parseRevParse('C:/r/wt\nC:/r/main/.git/worktrees/wt\nC:/r/main/.git\n'), 'C:/r/wt'), { key: 'c:/r/main/.git', kind: 'repo', root: 'C:/r/main' });
  assert.deepEqual(workspaceFromProbe(null, 'c:\\Work\\Plain\\'), { key: 'c:/work/plain', kind: 'folder', root: 'C:/Work/Plain' });
  git(repo, 'worktree', 'remove', '--force', wt);
});

test('G1: 워크스페이스 이름 — 폴더 이름, 겹치면 부모를 붙이고, 그래도 겹치면 전체 경로', () => {
  const n = workspaceNames([
    { key: '1', root: 'C:/a/proj' }, { key: '2', root: 'C:/b/proj' }, { key: '3', root: 'C:/x/multitask' },
    { key: '4', root: 'C:/m/q/app' }, { key: '5', root: 'D:/m/q/app' },
  ]);
  assert.equal(n.get('1'), 'a/proj');
  assert.equal(n.get('2'), 'b/proj');
  assert.equal(n.get('3'), 'multitask');
  assert.equal(n.get('4'), 'C:/m/q/app');
  assert.equal(n.get('5'), 'D:/m/q/app');
});

test('G1: 세는 값과 "다른 저장소에서 일하는 중" — cd해도 워크스페이스는 그대로, 표시만', () => {
  const ws = { key: 'c:/r/a/.git', kind: 'repo', root: 'C:/r/a' };
  const sums = [
    { workspaceKey: ws.key, state: 'working' }, { workspaceKey: ws.key, state: 'waiting' }, { workspaceKey: ws.key, state: 'ready', unseen: true },
    { workspaceKey: ws.key, state: 'shell_running', kind: 'shell' }, { workspaceKey: 'other', state: 'working' },
  ];
  assert.deepEqual(workspaceCounts(sums, ws.key), { sessions: 4, working: 1, needsYou: 1, review: 1, shells: 1 });
  // 같은 저장소(워크트리 포함)는 밖이 아니다
  assert.equal(elsewhereOf(ws, { isRepo: true, cwd: 'C:/r/a-wt', commonDir: 'C:/R/A/.git', root: 'C:/r/a-wt', mainRoot: 'C:/r/a' }), null);
  assert.deepEqual(elsewhereOf(ws, { isRepo: true, cwd: 'C:/r/b/x', commonDir: 'C:/r/b/.git', root: 'C:/r/b', mainRoot: 'C:/r/b' }), { root: 'C:/r/b', repo: true, name: 'b' });
  assert.deepEqual(elsewhereOf(ws, { isRepo: false, cwd: 'C:/tmp' }), { root: 'C:/tmp', repo: false, name: 'tmp' });
  const folder = { key: 'c:/work/plain', kind: 'folder', root: 'C:/Work/Plain' };
  assert.equal(elsewhereOf(folder, { isRepo: false, cwd: 'C:/work/plain/sub' }), null);
  assert.equal(elsewhereOf(folder, { isRepo: false, cwd: 'C:/work/plain2' }).root, 'C:/work/plain2');
  assert.equal(elsewhereOf(folder, null), null, 'git을 아직 안 봤으면 표시하지 않는다');
});

test('옮기기: P4 board.db(고정 자료) → 워크스페이스. 세션은 시작 폴더로, 그룹은 지우고(P22), 노드 자리·연결·뷰포트는 그대로', async () => {
  const file = path.join(tmp(), 'board.db');
  // P4 코드가 만든 것과 같은 스키마(커밋 d2be610)
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec(fs.readFileSync(path.join(HERE, 'fixtures', 'p4-schema.sql'), 'utf8'));
  const sess = (id, name, cwd, group, t, closed = null) => db.prepare("INSERT INTO sessions (session_id, name, cwd, group_id, pane_id, workspace_id, agent_name, permission_mode, settings_path, hook_token, created_at, closed_at, kind, origin) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', '', '', ?, ?, 'claude', 'board')").run(id, name, cwd, group, `w${t}:p1`, `w${t}`, name, t, closed);
  sess('s-a', 'a', 'C:/Work/multitask/backend/.dev/p5/proj', 'g1', 1);
  sess('s-b', 'b', 'C:/Work/multitask/backend/.dev/p5/proj', 'g1', 2);
  sess('s-c', 'c', 'C:/Work/mtask-p5-plain', 'g1', 3);
  sess('s-old', 'old', 'C:/Work/old', null, 4, 99); // 닫힌 세션은 옮기지 않는다
  const grp = (id, name, cwd, t) => db.prepare('INSERT INTO groups (group_id, name, cwd, x, y, w, h, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 1560, 1040, ?, ?)').run(id, name, cwd, t, t);
  grp('g1', 'grp', 'C:/Work/multitask/backend/.dev/p5/proj', 1);
  grp('g2', 'empty', 'C:/Work/other-repo', 2); // 소속 없음: 그룹 폴더의 워크스페이스
  grp('g3', 'nocwd', null, 3); // 소속도 폴더도 없음: 첫 워크스페이스
  for (const [sid, x, y] of [['s-a', 123, -345], ['s-b', 20, 64], ['s-c', 2280, 500]]) db.prepare('INSERT INTO nodes (session_id, x, y, w, h, z) VALUES (?, ?, ?, 720, 460, 0)').run(sid, x, y);
  db.prepare("INSERT INTO links (link_id, from_session, to_session, role, created_at, updated_at) VALUES ('l1', 's-a', 's-c', '도우미', 1, 1)").run();
  db.prepare("INSERT INTO meta (key, value) VALUES ('viewport', ?)").run(JSON.stringify({ x: 40, y: 80, zoom: 0.5 }));
  db.close();

  const resolve = async (cwd) => {
    const c = normPath(cwd);
    if (/multitask/i.test(c)) return { key: 'c:/work/multitask/.git', kind: 'repo', root: 'C:/Work/multitask' };
    if (/other-repo/i.test(c)) return { key: 'c:/work/other-repo/.git', kind: 'repo', root: 'C:/Work/other-repo' };
    return { key: pathKey(c), kind: 'folder', root: c };
  };
  const store = new Store(file); // 새 코드: 열과 표를 더한다
  // P22: 백엔드는 워크스페이스로 옮기기 전에 그룹을 지운다(backend.mjs start)
  const dropped = store.dropGroups();
  assert.deepEqual(dropped.groups.map((g) => g.name), ['grp', 'empty', 'nocwd']);
  assert.deepEqual(dropped.members.map((x) => x.name).sort(), ['a', 'b', 'c']);
  const r = await migrateWorkspaces(store, { resolve });
  assert.equal(r.sessions, 3);
  const key = (sid) => store.getSession(sid).workspaceKey;
  assert.equal(key('s-a'), 'c:/work/multitask/.git');
  assert.equal(key('s-b'), 'c:/work/multitask/.git');
  assert.equal(key('s-c'), 'c:/work/mtask-p5-plain');
  assert.equal(key('s-old'), null);
  // 워크스페이스 줄: 처음 생긴 순서(가장 오래된 세션 시각). 그룹 폴더(other-repo)로는 워크스페이스를 만들지 않는다
  assert.deepEqual(store.workspaces().map((w) => w.key), ['c:/work/multitask/.git', 'c:/work/mtask-p5-plain']);
  // 노드 자리와 연결은 그대로, 노드에 워크스페이스가 붙는다
  const a = store.nodes().find((n) => n.session_id === 's-a');
  assert.deepEqual([a.x, a.y, a.w, a.h, a.workspace_key], [123, -345, 720, 460, 'c:/work/multitask/.git']);
  assert.deepEqual(store.links().map((l) => [l.from, l.to, l.role]), [['s-a', 's-c', '도우미']]);
  // 마지막에 본 워크스페이스: 세션이 가장 많은 곳. 옛 판의 뷰포트는 거기로
  assert.equal(store.getMeta('currentWorkspace'), 'c:/work/multitask/.git');
  assert.deepEqual(store.getWorkspace('c:/work/multitask/.git').viewport, { x: 40, y: 80, zoom: 0.5 });
  // 세션 행: herdr 작업 공간 ID는 herdrWorkspaceId로 읽는다(판의 워크스페이스와 헷갈리지 않게)
  assert.equal(store.getSession('s-a').herdrWorkspaceId, 'w1');
  // 다시 돌려도 바뀌는 것이 없다
  const again = await migrateWorkspaces(store, { resolve });
  assert.equal(again.sessions, 0);
  assert.equal(store.dropGroups(), null, '그룹 표가 없으면 옮길 것이 없다');
  store.close();
});

test('G2: 셸 화면 — 프롬프트에서 쉬는가, 돌리는 명령', () => {
  assert.deepEqual(shellPromptState('Windows PowerShell\nPS C:\\a> '), { atPrompt: true, command: null });
  assert.deepEqual(shellPromptState('PS C:\\a> ping -n 6 127.0.0.1\n\nPing 127.0.0.1 32바이트 데이터 사용:\n응답\n'), { atPrompt: false, command: 'ping -n 6 127.0.0.1' });
  assert.deepEqual(shellPromptState('PS C:\\a> ping -n 1 x\n응답\nPS C:\\a>'), { atPrompt: true, command: 'ping -n 1 x' }, '끝났으면 마지막 명령은 남는다');
  assert.deepEqual(shellPromptState('C:\\a>dir\n파일\nC:\\a>'), { atPrompt: true, command: 'dir' });
  assert.deepEqual(shellPromptState(''), { atPrompt: false, command: null });
});

test('G2: 셸 상태 — shell_idle·shell_running. 검토 대기·조용함은 없다', () => {
  const rt = newRuntime({ kind: 'shell', hooked: false });
  assert.equal(deriveState(rt).state, 'shell_idle');
  rt.shell = { atPrompt: false, command: 'npm run dev' };
  assert.equal(deriveState(rt).state, 'shell_running');
  applyHerdrStatus(rt, 'unknown');
  assert.equal(deriveState(rt).state, 'shell_running', 'herdr 상태(unknown)는 셸에 쓰지 않는다');
  rt.lastActivityAt = 0;
  assert.deepEqual(flags(rt, { quietMs: 1000 }), { unseen: false, quiet: false, delivering: 0 });
});

test('G2: herdr pane_created는 패널 정보(pane)로 온다', () => {
  const e = normalizeEvent({ event: 'pane_created', data: { type: 'pane_created', pane: { pane_id: 'w2:p2', workspace_id: 'w2', cwd: 'C:\\x\\' } } });
  assert.deepEqual([e.type, e.paneId, e.workspaceId, e.cwd], ['pane_created', 'w2:p2', 'w2', 'C:\\x\\']);
  const x = normalizeEvent({ event: 'pane_exited', data: { pane_id: 'w2:p2', workspace_id: 'w2' } });
  assert.deepEqual([x.type, x.paneId], ['pane_exited', 'w2:p2']);
});

// send()만 시험하는 백엔드(herdr 없이): 세션과 저장소만 채운다
function fakeBackend() {
  const b = new Backend({ quietMs: 600000, port: 0, logDir: tmp() });
  b.store = new Store(path.join(tmp(), 'board.db'));
  b.sessions = new Map();
  const sent = [];
  b.queue = { enqueue: (sid, text) => { sent.push({ sid, text }); return { deliveryId: 'd' + sent.length, status: 'queued' }; }, pending: () => 0 };
  b.touch = () => {};
  b.sent = sent;
  const add = (name, kind, ws, extra = {}) => { const s = { sessionId: 'id-' + name, name, kind, workspaceKey: ws, rt: newRuntime({ kind, hooked: kind === 'claude' }), origin: 'board', createdAt: Date.now(), ...extra }; b.sessions.set(s.sessionId, s); return s; };
  b.store.insertWorkspace({ key: 'ws-a', kind: 'repo', root: 'C:/r/a', createdAt: 1 });
  b.store.insertWorkspace({ key: 'ws-b', kind: 'folder', root: 'C:/b', createdAt: 2 });
  return { b, add };
}

test('G2·G4·H8: 셸에 @로 보내면 not_agent. @all은 캔버스 전체의 에이전트 세션(셸 빼고, P6a), workspace를 주면 그 워크스페이스만. 판에 없는 이름은 not_found(P22: @그룹은 없다)', async () => {
  const { b, add } = fakeBackend();
  add('a1', 'claude', 'ws-a'); add('a2', 'codex', 'ws-a'); add('sh1', 'shell', 'ws-a'); add('b1', 'claude', 'ws-b');
  await assert.rejects(() => b.send({ text: '@sh1 hi' }), (e) => e.code === 'not_agent');
  await assert.rejects(() => b.send({ text: '@a1 @sh1 hi' }), (e) => e.code === 'not_agent', '여럿 중 하나라도 셸이면 보내지 않는다');
  assert.equal(b.sent.length, 0);
  // @all: P6a부터 캔버스 전체(지금 워크스페이스와 상관없다)
  b.store.setMeta('currentWorkspace', 'ws-a');
  let r = await b.send({ text: '@all hi' });
  assert.deepEqual(r.deliveries.map((d) => d.name).sort(), ['a1', 'a2', 'b1']);
  r = await b.send({ text: '@all hi', workspace: 'ws-b' });
  assert.deepEqual(r.deliveries.map((d) => d.name), ['b1']);
  // 이름으로도 워크스페이스를 준다(폴더 이름)
  r = await b.send({ text: '@all hi', workspace: 'b' });
  assert.deepEqual(r.deliveries.map((d) => d.name), ['b1']);
  // @이름은 워크스페이스와 상관없이 이름으로 찾는다
  r = await b.send({ text: '@b1 hi' });
  assert.deepEqual(r.deliveries.map((d) => d.name), ['b1']);
  // P22: 그룹이 없으니 세션 이름이 아니면 판에 없는 대상이다
  await assert.rejects(() => b.send({ text: '@grp hi' }), (e) => e.code === 'not_found' && e.key === 'targetNotFound');
  // 에이전트가 없는 워크스페이스에 @all
  b.store.insertWorkspace({ key: 'ws-c', kind: 'folder', root: 'C:/c', createdAt: 3 });
  add('sh2', 'shell', 'ws-c');
  await assert.rejects(() => b.send({ text: '@all hi', workspace: 'ws-c' }), (e) => e.code === 'not_found');
  b.store.close();
});

test('G3: 모든 세션이 화면에 들어오게 맞추기, 화면 밖 표시', () => {
  const b = boundsOf([{ x: 0, y: 0, w: 720, h: 460 }, { x: 2280, y: 500, w: 720, h: 460 }], 0);
  assert.deepEqual(b, { x: 0, y: 0, w: 3000, h: 960 });
  const vp = fitViewport(b, { width: 1500, height: 800 }, { maxZoom: 1 });
  assert.equal(vp.zoom, 0.5);
  assert.equal(offscreen({ x: 0, y: 0, w: 720, h: 460 }, vp, { width: 1500, height: 800 }), false);
  assert.equal(offscreen({ x: 5000, y: 0, w: 720, h: 460 }, vp, { width: 1500, height: 800 }), true);
  assert.equal(fitViewport(boundsOf([{ x: 0, y: 0, w: 100, h: 100 }], 0), { width: 1000, height: 1000 }, { maxZoom: 1 }).zoom, 1, '노드 하나는 배율 1까지만');
  assert.equal(boundsOf([]), null);
});
