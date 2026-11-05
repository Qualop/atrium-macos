// P34 단위 시험: 데스크톱 앱 세션 가져오기(파일 갈래, 후보 상태, 이름, 앱 설정 값, 장부, 개발용 프로필 막기). herdr·claude·실제 앱 자료 없이 돈다.
// 앱 목록은 임시 폴더의 가짜 local_*.json, 대화 기록은 임시 폴더의 가짜 jsonl이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { forkText, countSince, candidateStatus, defaultPick, importName, safeRepoName, launchValues, knownModel, importAllowed, folderPlan, DesktopImport } from '../src/desktop-import.mjs';
import { listDesktopSessions, desktopInfoOf } from '../src/convos.mjs';
import { transcriptPathFor } from '../src/launch.mjs';
import { workspaceFromProbe } from '../src/workspaces.mjs';
import { deriveState } from '../src/state.mjs';
import { Store } from '../src/store.mjs';
import { loadConfig, BACKEND_ROOT } from '../src/config.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p34-'));
const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-00000000a034`;
const line = (o) => JSON.stringify(o);
const user = (uuid, text, sid, extra = {}) => line({ type: 'user', uuid, sessionId: sid, cwd: 'C:/x', timestamp: '2026-11-02T01:00:00.000Z', message: { role: 'user', content: text }, ...extra });
const answer = (uuid, text, sid, at = '2026-11-02T01:00:05.000Z') => line({ type: 'assistant', uuid, sessionId: sid, timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text }] } });
const transcript = (sid, turns) => turns.flatMap(([q, a], i) => [user(`u${i}`, q, sid), answer(`a${i}`, a, sid)]).join('\n') + '\n';

test('파일 갈래: 줄마다 sessionId만 바꾸고, 쓰는 중인 마지막 조각은 넣지 않으며, 마지막 답 uuid를 시점으로 남긴다', () => {
  const A = ID(1), B = ID(2);
  const src = transcript(A, [['hi', 'ONE'], ['again', 'TWO']]) + line({ type: 'summary', summary: 'x' }) + '\n' + '{"type":"user","sessionId":"' + A + '","mess';
  const f = forkText(src, B);
  const out = f.text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(out.length, 5, '쓰는 중인 조각은 빠진다');
  assert.equal(f.lines, 5);
  assert.ok(f.dropped > 0);
  for (const o of out.filter((x) => 'sessionId' in x)) assert.equal(o.sessionId, B);
  assert.equal(out.find((o) => o.type === 'summary').sessionId, undefined, 'sessionId가 없던 줄에는 더하지 않는다');
  assert.deepEqual(out.map((o) => o.uuid).filter(Boolean), ['u0', 'a0', 'u1', 'a1'], 'uuid는 그대로');
  assert.equal(out[0].message.content, 'hi');
  assert.equal(f.pointUuid, 'a1');
  assert.equal(f.pointAt, Date.parse('2026-11-02T01:00:05.000Z'));
  assert.ok(f.text.endsWith('\n'));
  assert.equal(forkText('{"a":1}', B).lines, 0, '줄바꿈이 하나도 없으면 넣을 줄이 없다');
  assert.equal(forkText('not json\n', B).text, 'not json\n', '읽지 못하는 줄은 그대로');
});

test('시점 뒤로 센다: 같은 대화는 시점과 넣은 줄 수 뒤, 바뀐 대화는 시점 uuid 뒤(없으면 처음부터)', () => {
  const A = ID(1);
  const base = transcript(A, [['hi', 'ONE']]);
  const f = forkText(base, ID(2));
  assert.deepEqual(countSince(base, { pointUuid: f.pointUuid, lines: f.lines }), { found: true, prompts: 0, answers: 0 });
  const more = base + user('u9', 'more?', A) + '\n' + answer('a9', 'THREE', A) + '\n' + line({ type: 'last-prompt', lastPrompt: 'more?' }) + '\n';
  assert.deepEqual(countSince(more, { pointUuid: f.pointUuid, lines: f.lines }), { found: true, prompts: 1, answers: 1 });
  // 도구 결과·합성 줄·하위 에이전트 줄은 세지 않는다
  const tool = base + line({ type: 'user', uuid: 't', message: { content: [{ type: 'tool_result', content: 'x' }] } }) + '\n' + user('s', '<system-reminder>x</system-reminder>', A) + '\n' + user('sc', 'side', A, { isSidechain: true }) + '\n';
  assert.deepEqual(countSince(tool, { pointUuid: f.pointUuid, lines: f.lines }), { found: true, prompts: 0, answers: 0 });
  // 원본 대화 ID가 바뀌었다(priorCliSessionIds): 새 기록에 시점이 없으면 모두 센다
  const C = ID(3);
  assert.deepEqual(countSince(user('c0', 'x', C) + '\n' + answer('c1', 'y', C) + '\n', { pointUuid: f.pointUuid, lines: f.lines, sameConv: false }), { found: false, prompts: 1, answers: 1 });
  assert.deepEqual(countSince(more, { pointUuid: f.pointUuid, lines: 99, sameConv: false }), { found: true, prompts: 1, answers: 1 }, '새 기록에 시점이 있으면 그 뒤만');
});

test('후보 상태: 새것, 옮김, 더 씀, 판 세션, 기록 없음, 폴더 없음, 보관 제외. 기본 고름은 없고 명시적으로 고른다', () => {
  const led = { gen: 1 };
  assert.equal(candidateStatus({}), 'new');
  assert.equal(candidateStatus({ ledger: led }), 'imported');
  assert.equal(candidateStatus({ ledger: led, more: 2 }), 'more');
  assert.equal(candidateStatus({ onBoard: true }), 'onBoard');
  assert.equal(candidateStatus({ transcript: false }), 'noTranscript');
  assert.equal(candidateStatus({ folder: false }), 'noFolder');
  assert.equal(candidateStatus({ folder: false, ledger: led }), 'imported', '옮긴 뒤 폴더가 없어져도 옮김');
  assert.equal(candidateStatus({ archived: true }), null);
  assert.equal(defaultPick({ status: 'new' }), false);
  assert.equal(defaultPick({ status: 'more' }), false);
  assert.equal(defaultPick({ status: 'new', running: true }), false);
  for (const s of ['imported', 'onBoard', 'noTranscript', 'noFolder']) assert.equal(defaultPick({ status: s }), false, s);
});

test('이름: 워크트리 이름·브랜치가 판 이름 글자면 그것(겹치면 번호), 아니면 <리포>-<번호>', () => {
  assert.equal(importName({ worktreeName: 'fix-login', repoName: 'web' }), 'fix-login');
  assert.equal(importName({ worktreeName: 'fix-login', repoName: 'web', taken: new Set(['fix-login']) }), 'fix-login-2');
  assert.equal(importName({ worktreeName: '한글', branch: 'feat_x', repoName: 'web' }), 'feat_x');
  assert.equal(importName({ branch: 'claude/feat', repoName: 'web' }), 'web-1', '/가 든 브랜치는 쓰지 않는다');
  assert.equal(importName({ repoName: 'web', taken: new Set(['web-1', 'web-2']) }), 'web-3');
  assert.equal(importName({ repoName: '내 프로젝트' }), 'repo-1');
  assert.equal(safeRepoName('my.app (old)'), 'my-app-old');
  assert.equal(importName({ worktreeName: 'all', repoName: 'web' }), 'web-1', 'all은 판이 쓰는 이름');
});

test('앱 설정 값: 기록된 모델·노력·권한 모드를 쓰고, 판이 모르는 값만 첫 즐겨찾기 호출자 값으로 바꾼다', () => {
  const fb = { model: 'claude-opus-5-5', effort: 'high', permissionMode: 'acceptEdits' };
  assert.deepEqual(launchValues({ model: 'claude-sonnet-5-5', effort: 'low', permissionMode: 'plan' }, fb), { model: 'claude-sonnet-5-5', effort: 'low', permissionMode: 'plan', replaced: [] });
  assert.deepEqual(launchValues({ model: 'gpt-9 turbo', effort: 'ultra', permissionMode: 'yolo' }, fb), { model: 'claude-opus-5-5', effort: 'high', permissionMode: 'acceptEdits', replaced: ['model', 'effort', 'permissionMode'] });
  assert.deepEqual(launchValues({}, fb), { model: 'claude-opus-5-5', effort: 'high', permissionMode: 'acceptEdits', replaced: [] }, '없으면 호출자 값');
  assert.equal(launchValues({ permissionMode: 'default' }, {}).permissionMode, 'manual');
  assert.equal(launchValues({ model: 'opus[1m]' }, fb).model, 'opus[1m]');
  assert.equal(knownModel('claude-opus-5-5[1m]'), true);
  assert.equal(knownModel('$(rm)'), false);
});

test('개발용 프로필 막기: 앱 목록 폴더를 따로 주지 않았거나 데이터 폴더 밖이면 거부한다', () => {
  const dev = path.join(BACKEND_ROOT, '.dev');
  const env = (o) => ({ ATRIUM_PROFILE: 'dev', ATRIUM_HERDR_SESSION: 'atrium-dev-p34t', ATRIUM_PORT: '47999', ATRIUM_DATA_DIR: path.join(dev, 'data-t'), ...o });
  assert.deepEqual(importAllowed(loadConfig({ argv: [], env: env({}) })), { ok: false, reason: 'dev_default_dir' }, '기본값은 실제 앱 폴더라 막는다');
  assert.equal(importAllowed(loadConfig({ argv: [], env: env({ ATRIUM_CLAUDE_DESKTOP: path.join(os.homedir(), 'AppData', 'Local', 'Claude-Data') }) })).reason, 'dev_outside_data');
  assert.equal(importAllowed(loadConfig({ argv: [], env: env({ ATRIUM_CLAUDE_DESKTOP: path.join(dev, 'desktop') }) })).ok, true);
  assert.equal(importAllowed(loadConfig({ argv: [], env: env({ ATRIUM_CLAUDE_DESKTOP: path.join(dev, 'data-t', 'desk') }) })).ok, true);
  assert.equal(importAllowed(loadConfig({ argv: [], env: env({ ATRIUM_CLAUDE_DESKTOP: 'none' }) })).reason, 'no_desktop_dir');
  assert.equal(importAllowed({ profile: 'real', desktopSessionsDir: 'C:/x', desktopExplicit: false }).ok, true, '실제 판은 기본 앱 폴더를 쓴다');
});

// ---------- 판에 붙여 보는 시험(가짜 백엔드, 진짜 저장소) ----------
function fixture() {
  const root = tmp();
  const projects = path.join(root, 'projects');
  const desk = path.join(root, 'desk', 'p1', 'claude-code-sessions', 'org', 'acct');
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo, { recursive: true });
  const wt = path.join(repo, '.claude', 'worktrees', 'wt-alive'); fs.mkdirSync(wt, { recursive: true });
  const gone = path.join(repo, '.claude', 'worktrees', 'wt-gone'); // 폴더가 없다
  fs.mkdirSync(desk, { recursive: true });
  const live = new Map();
  const store = new Store(path.join(root, 'board.db'));
  const events = [];
  const cfg = { profile: 'real', desktopSessionsDir: path.join(root, 'desk'), claudeSessionsDir: path.join(root, 'sessions'), claudeProjects: projects, sessionsDir: path.join(root, 'data', 'sessions'), dataDir: path.join(root, 'data'), hookTimeoutSec: 2, claudeCommand: 'claude' };
  const b = {
    cfg, store, sessions: new Map(), hookUrl: 'http://127.0.0.1:1/hooks/claude', plugin: {},
    ensureWorkspace(ws) { if (store.getWorkspace(ws.key)) return false; store.insertWorkspace({ ...ws, createdAt: Date.now() }); return true; },
    broadcastSession() {}, api: { broadcast: (e, d) => events.push([e, d]) }, log() {},
    features: { launchers: { data: () => ({ items: [{ id: 'c1', harness: 'claude', name: 'Claude', model: 'claude-opus-5-5', effort: 'high', permissionMode: 'manual' }], favorites: ['c1'] }) } },
  };
  const ids = [];
  let n = 100;
  const imp = new DesktopImport(b, { codex: null, live: () => live, resolveWs: async (cwd) => workspaceFromProbe(null, path.resolve(repo)), newId: () => { const id = ID(++n); ids.push(id); return id; } });
  const app = (name, o) => fs.writeFileSync(path.join(desk, `local_${name}.json`), JSON.stringify({ sessionId: `local_${name}`, lastActivityAt: Date.now(), model: 'claude-sonnet-5-5', effort: 'medium', permissionMode: 'acceptEdits', ...o }));
  const convo = (cwd, sid, turns) => { const p = transcriptPathFor(projects, cwd, sid); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, transcript(sid, turns)); return p; };
  return { root, projects, desk, repo, wt, gone, live, store, b, imp, app, convo, ids, events };
}
const byId = (r) => Object.fromEntries(r.repos.flatMap((g) => g.items).map((c) => [c.appSessionId, c]));

test('후보 목록: 같은 폴더, 워크트리, 지워진 워크트리(저장소 폴더 쪽), 보관됨(안 보임), 기록 없음, 지금 도는 것, 판 세션인 대화', async () => {
  const f = fixture();
  f.app('same', { cliSessionId: ID(1), cwd: f.repo, title: 'Same folder' });
  f.convo(f.repo, ID(1), [['a', 'b']]);
  f.app('wt', { cliSessionId: ID(2), cwd: f.wt, worktreePath: f.wt, worktreeName: 'wt-alive', originCwd: f.repo, title: 'Worktree' });
  f.convo(f.wt, ID(2), [['a', 'b']]);
  f.app('gone', { cliSessionId: ID(3), cwd: f.gone, worktreePath: f.gone, worktreeName: 'wt-gone', title: 'Gone worktree' }); // originCwd 없이도 경로로 저장소를 찾는다
  f.convo(f.gone, ID(3), [['a', 'b']]);
  f.app('arch', { cliSessionId: ID(4), cwd: f.repo, isArchived: true, title: 'Archived' });
  f.convo(f.repo, ID(4), [['a', 'b']]);
  f.app('nofile', { cliSessionId: ID(5), cwd: f.repo, title: 'No transcript' });
  f.app('run', { cliSessionId: ID(6), cwd: f.repo, title: 'Running' });
  f.convo(f.repo, ID(6), [['a', 'b']]);
  f.live.set(ID(6), { pid: 1, entrypoint: 'claude-desktop' });
  f.app('nofolder', { cliSessionId: ID(7), cwd: path.join(f.root, 'nowhere', 'x'), title: 'No folder' });
  f.convo(path.join(f.root, 'nowhere', 'x'), ID(7), [['a', 'b']]);
  const r = await f.imp.list();
  const c = byId(r);
  assert.equal(c.local_arch, undefined, '보관된 것은 목록에 없다');
  assert.equal(r.total, 6);
  assert.equal(c.local_same.status, 'new'); assert.equal(c.local_same.folder, 'same'); assert.equal(c.local_same.pick, false);
  assert.equal(c.local_wt.status, 'new'); assert.equal(c.local_wt.folder, 'same');
  assert.equal(c.local_gone.status, 'new'); assert.equal(c.local_gone.folder, 'repo'); assert.equal(c.local_gone.target.toLowerCase(), f.repo.split(path.sep).join('/').toLowerCase());
  assert.equal(c.local_nofile.status, 'noTranscript'); assert.equal(c.local_nofile.pick, false);
  assert.equal(c.local_run.status, 'new'); assert.equal(c.local_run.running, true); assert.equal(c.local_run.runningWhere, 'desktop'); assert.equal(c.local_run.pick, false, '도는 것은 기본으로 고르지 않는다');
  assert.equal(c.local_nofolder.status, 'noFolder');
  assert.equal(r.picked, 0);
});

test('가져오기: 잠든 판 세션과 갈래 파일, 앱 설정 값, 이름, 장부. 옮김은 다시 옮기지 않고, 더 쓴 것은 2세대로 갈라 열며 옛 갈래는 남는다', async () => {
  const f = fixture();
  f.app('same', { cliSessionId: ID(1), cwd: f.repo, title: 'Same folder' });
  const srcPath = f.convo(f.repo, ID(1), [['hi', 'ONE']]);
  f.app('gone', { cliSessionId: ID(3), cwd: f.gone, worktreePath: f.gone, worktreeName: 'wt-gone', originCwd: f.repo, title: 'Gone worktree', model: 'mystery-model' });
  f.convo(f.gone, ID(3), [['a', 'b']]);
  const srcBefore = fs.readFileSync(srcPath, 'utf8');
  const r = await f.imp.importMany({ ids: ['local_same', 'local_gone'] });
  assert.equal(r.imported.length, 2, JSON.stringify(r));
  const same = r.imported.find((x) => x.appSessionId === 'local_same');
  const gone = r.imported.find((x) => x.appSessionId === 'local_gone');
  // 판 세션: 잠듦, 패널 없음, 세션 ID = 새 대화 ID, 앱 설정 값
  const s = f.b.sessions.get(same.sessionId);
  assert.equal(same.sessionId, same.convId);
  assert.equal(deriveState(s.rt).state, 'sleeping');
  assert.equal(s.paneId, null);
  assert.equal(s.rt.sleep.by, 'import');
  assert.equal(s.model, 'claude-sonnet-5-5'); assert.equal(s.effort, 'medium'); assert.equal(s.permissionMode, 'acceptEdits');
  assert.equal(s.rt.lastAnswer, 'ONE', '노드에 마지막 답이 보인다');
  assert.ok(f.store.nodes().some((n) => n.session_id === s.sessionId), '노드 자리');
  assert.match(same.name, /^repo-\d+$/);
  assert.deepEqual(f.imp.summaryExtra(s).imported.title, 'Same folder');
  // 지워진 워크트리: 저장소 폴더 쪽에 갈래, 이름은 워크트리 이름, 모르는 모델은 호출자 값
  const g = f.b.sessions.get(gone.sessionId);
  assert.equal(gone.folder, 'repo'); assert.equal(g.cwd, path.resolve(f.repo)); assert.equal(gone.name, 'wt-gone');
  assert.equal(g.model, 'claude-opus-5-5'); assert.deepEqual(gone.replaced, ['model']);
  assert.ok(fs.existsSync(transcriptPathFor(f.projects, f.repo, gone.convId)));
  // 갈래 파일: 새 ID, 원본은 그대로
  const forkPath = transcriptPathFor(f.projects, f.repo, same.convId);
  assert.ok(fs.readFileSync(forkPath, 'utf8').split('\n').filter(Boolean).every((l) => JSON.parse(l).sessionId === same.convId));
  assert.equal(fs.readFileSync(srcPath, 'utf8'), srcBefore, '원본은 고치지 않는다');
  // 장부
  const led = f.store.desktopImports();
  assert.equal(led.length, 2);
  assert.deepEqual({ ...led.find((x) => x.appSessionId === 'local_same'), createdAt: 0 }, { provider: 'claude', appSessionId: 'local_same', gen: 1, sourceConv: ID(1), newConv: same.convId, sessionId: same.sessionId, pointUuid: 'a0', pointAt: Date.parse('2026-11-02T01:00:05.000Z'), pointLines: 2, title: 'Same folder', createdAt: 0 });
  // 이미 옮김: 목록은 imported, 다시 고르면 건너뛴다(중복 막기)
  assert.equal(byId(await f.imp.list()).local_same.status, 'imported');
  const again = await f.imp.importMany({ ids: ['local_same'] });
  assert.deepEqual(again.skipped.map((x) => x.reason), ['already']);
  assert.equal(f.store.desktopImports().length, 2);
  // 앱에서 더 씀 → more, 다시 가져오면 2세대, 옛 갈래는 그대로
  fs.appendFileSync(srcPath, user('u9', 'more', ID(1)) + '\n' + answer('a9', 'TWO', ID(1)) + '\n');
  const c2 = byId(await f.imp.list()).local_same;
  assert.equal(c2.status, 'more'); assert.deepEqual(c2.more, { prompts: 1, answers: 1 }); assert.equal(c2.pick, false);
  const r2 = await f.imp.importMany({ ids: ['local_same'] });
  assert.equal(r2.imported.length, 1);
  assert.equal(r2.imported[0].gen, 2);
  assert.notEqual(r2.imported[0].sessionId, same.sessionId);
  assert.ok(fs.existsSync(forkPath), '옛 갈래는 그대로');
  assert.ok(f.b.sessions.has(same.sessionId), '옛 판 세션도 그대로');
  assert.notEqual(r2.imported[0].name, same.name, '이름이 겹치지 않는다');
  assert.equal(byId(await f.imp.list()).local_same.status, 'imported');
  // 원본 대화 ID가 바뀌었다(앱이 새 대화로 이어 감): 새 기록에서 센다
  f.app('same', { cliSessionId: ID(9), priorCliSessionIds: [ID(1)], cwd: f.repo, title: 'Same folder' });
  f.convo(f.repo, ID(9), [['new convo', 'NEW']]);
  assert.equal(byId(await f.imp.list()).local_same.status, 'more');
  assert.ok(f.events.some(([e]) => e === 'desktop.import.progress'));
});

test('가져오기: 갈래 파일은 덮지 않는다(wx). 같은 ID 파일이 있으면 건너뛰고 그 파일은 그대로다', async () => {
  const f = fixture();
  f.app('same', { cliSessionId: ID(1), cwd: f.repo, title: 'Same' });
  f.convo(f.repo, ID(1), [['hi', 'ONE']]);
  const clash = transcriptPathFor(f.projects, f.repo, ID(101)); // 다음에 쓸 ID
  fs.writeFileSync(clash, 'KEEP\n');
  const r = await f.imp.importMany({ ids: ['local_same'] });
  assert.equal(r.imported.length, 0);
  assert.equal(r.skipped[0].reason, 'EEXIST');
  assert.equal(fs.readFileSync(clash, 'utf8'), 'KEEP\n');
  assert.equal(f.store.desktopImports().length, 0);
});

test('판 세션인 대화(CLI에서 시작해 앱이 가져간 대화)는 건너뛴다', async () => {
  const f = fixture();
  f.app('adopted', { cliSessionId: ID(1), cwd: f.repo, adoptedFromOtherSurface: true, title: 'Adopted' });
  f.convo(f.repo, ID(1), [['a', 'b']]);
  f.store.insertSession({ sessionId: ID(1), name: 'cli1', cwd: f.repo, paneId: null, herdrWorkspaceId: null, agentName: 'cli1', model: null, effort: null, permissionMode: 'manual', settingsPath: 'x', hookToken: 'x', resumeArgv: null, createdAt: 1, touchedAt: 1, runtime: {}, kind: 'claude', origin: 'board', parentSessionId: null, workspaceKey: null, flavor: null, extraArgs: [] });
  const c = byId(await f.imp.list()).local_adopted;
  assert.equal(c.status, 'onBoard'); assert.equal(c.adopted, true); assert.equal(c.pick, false);
  const r = await f.imp.importMany({ ids: ['local_adopted', 'local_none'] });
  assert.deepEqual(r.skipped.map((x) => x.reason), ['on_board', 'not_found']);
});

test('막힌 판은 목록과 가져오기 모두 거부한다', async () => {
  const f = fixture();
  f.b.cfg.profile = 'dev'; f.b.cfg.desktopExplicit = false;
  const list = await f.imp.list();
  assert.equal(list.allowed, false);
  assert.equal(list.sources[0].reason, 'dev_default_dir');
  const result = await f.imp.importMany({ ids: ['local_same'] });
  assert.equal(result.skipped[0].reason, 'dev_default_dir');
  await assert.rejects(f.imp.importMany({ all: true }), (e) => e.code === 'selection_required');
});

test('앱 목록 읽기: 필드를 고르고 없으면 null, 보관 포함 전부', () => {
  const root = tmp();
  const d = path.join(root, 'prof', 'claude-code-sessions', 'o', 'a');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'local_a.json'), JSON.stringify({ sessionId: 'local_a', cliSessionId: ID(1).toUpperCase(), priorCliSessionIds: [ID(2)], title: 'T', isArchived: true, lastActivityAt: '2026-11-02T00:00:00Z', extra: 1 }));
  fs.writeFileSync(path.join(d, 'local_b.json'), '{broken');
  const list = listDesktopSessions(root);
  assert.equal(list.length, 1);
  assert.equal(list[0].cliSessionId, ID(1));
  assert.deepEqual(list[0].priorCliSessionIds, [ID(2)]);
  assert.equal(list[0].isArchived, true);
  assert.equal(list[0].lastActivityAt, Date.parse('2026-11-02T00:00:00Z'));
  assert.equal(list[0].worktreePath, null);
  assert.equal(desktopInfoOf(null), null);
});

test('폴더 찾기: 폴더가 있으면 그대로, 지워진 워크트리는 originCwd → 경로 → git, 모두 없으면 missing', async () => {
  const f = fixture();
  assert.equal((await folderPlan({ cwd: f.repo }, { claudeProjects: f.projects })).folder, 'same');
  assert.equal((await folderPlan({ worktreePath: f.gone, originCwd: f.repo }, { claudeProjects: f.projects })).folder, 'repo');
  const outside = path.join(f.root, 'elsewhere-wt');
  const viaGit = await folderPlan({ worktreePath: outside }, { claudeProjects: f.projects, gitRoot: async () => f.repo });
  assert.equal(viaGit.folder, 'repo'); assert.equal(viaGit.cwd, path.resolve(f.repo));
  assert.equal((await folderPlan({ worktreePath: outside }, { claudeProjects: f.projects, gitRoot: async () => null })).folder, 'missing');
});
