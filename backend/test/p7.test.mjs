// P7 단위 시험: 대화 기록 읽기와 색인(머리·꼬리, 캐시), 리포 맞추기(워크트리, 폴더 아래), 묶여 있는지 판정, 닫힌 세션 다시 열기, 판 밖 대화 열기, 되살리기, board.db 옮기기.
// herdr와 claude 없이 돈다. 대화 기록은 직접 만든 가짜 자료(MTASK_CLAUDE_PROJECTS로 가리키는 것과 같은 모양)다. 실제 ~/.claude는 읽지 않는다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { pathKey, normPath } from '../src/workspaces.mjs';
import { parseTranscriptChunks, readTranscriptSummary, listTranscriptFiles, readLiveSessions, readDesktopSessions, parseClaudeCmdlines, bindingOf, inWorkspace, HEAD_BYTES, RECENT_WRITE_MS } from '../src/convos.mjs';
import { Recall, convOf, CLOSE_REASON } from '../src/recall.mjs';
import { loadConfig } from '../src/config.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p7-'));
const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const apiError = (code, message) => Object.assign(new Error(message), { code });

test('audit: simultaneous reopen of an archived session creates only one pane', async () => {
  const cwd = tmp(), W = folderWs(cwd), b = fakeBackend({ convoRoots: [tmp()], workspaces: [W] });
  addClosed(b, { id: ID(40), name: 'same', cwd, kind: 'shell', ws: W });
  b.store.setArchive('session', ID(40), { archivedAt: Date.now() });
  const r = new Recall(b, { readProcs: async () => [] }); r.changed = async () => {};
  const results = await Promise.allSettled([r.reopen({ session: ID(40) }), r.reopen({ session: ID(40) })]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(b.calls.filter(([op]) => op === 'createWorkspace').length, 1);
  assert.equal(b.store.getSession(ID(40)).closedAt, null);
  assert.equal(b.store.archiveMarks().get(`session:${ID(40)}`).archivedAt, null);
});

test('audit: simultaneous reopen reserves distinct names across different closed sessions', async () => {
  const cwd = tmp(), W = folderWs(cwd), b = fakeBackend({ convoRoots: [tmp()], workspaces: [W] });
  for (const n of [41, 42]) addClosed(b, { id: ID(n), name: 'worker', cwd, kind: 'shell', ws: W });
  const r = new Recall(b, { readProcs: async () => [] }); r.changed = async () => {};
  const out = await Promise.all([41, 42].map((n) => r.reopen({ session: ID(n) })));
  assert.equal(new Set(out.map((x) => x.name)).size, 2);
});

test('audit: failed reopen launch returns an archived session to a retryable closed record', async () => {
  const cwd = tmp(), W = folderWs(cwd), b = fakeBackend({ convoRoots: [tmp()], workspaces: [W] });
  addClosed(b, { id: ID(47), name: 'retry-open', cwd, kind: 'codex', ws: W });
  b.store.setArchive('session', ID(47), { archivedAt: 123 });
  const r = new Recall(b, { readProcs: async () => [] }); r.changed = async () => {};
  const start = b.adapter.startAgent;
  b.adapter.startAgent = async () => { throw apiError('launch_failed', 'fixture launch failure'); };
  await assert.rejects(r.reopen({ session: ID(47) }), { code: 'launch_failed' });
  assert.equal(b.sessions.has(ID(47)), false);
  assert.ok(b.store.closedSession(ID(47)));
  assert.equal(b.store.archiveMarks().get(`session:${ID(47)}`).archivedAt, 123);
  assert.deepEqual(b.calls.filter(([op]) => op === 'closePane'), [['closePane', 'w1:p1']]);
  b.adapter.startAgent = start;
  assert.equal((await r.reopen({ session: ID(47) })).name, 'retry-open');
});

test('audit: failed reopen cleanup retains the tracked pane when its close is not confirmed', async () => {
  const cwd = tmp(), W = folderWs(cwd), b = fakeBackend({ convoRoots: [tmp()], workspaces: [W] });
  addClosed(b, { id: ID(48), name: 'tracked', cwd, kind: 'codex', ws: W });
  const r = new Recall(b, { readProcs: async () => [] }); r.changed = async () => {};
  b.adapter.startAgent = async () => { throw apiError('launch_failed', 'fixture launch failure'); };
  b.adapter.closePane = async () => { throw apiError('unreachable', 'fixture cleanup failure'); };
  await assert.rejects(r.reopen({ session: ID(48) }), { code: 'launch_failed' });
  const s = b.sessions.get(ID(48));
  assert.ok(s?.paneId);
  assert.equal(s.rt.exit?.kind, 'launch_failed');
  assert.equal(b.store.getSession(ID(48)).closedAt, null);
  assert.ok(b.store.events({ sessionId: ID(48) }).some((e) => e.kind === 'reopen_failed' && e.data.cleanup));
});

test('audit: Codex reopen honors the requested model and persists it for another reopen', async () => {
  const cwd = tmp(), W = folderWs(cwd), b = fakeBackend({ convoRoots: [tmp()], workspaces: [W] });
  addClosed(b, { id: ID(43), name: 'codex', cwd, kind: 'codex', ws: W });
  b.store.addEvent(ID(43), 'spawn', { args: ['--model=old-model', '--sandbox', 'workspace-write'] });
  const r = new Recall(b, { readProcs: async () => [] }); r.changed = async () => {};
  await r.reopen({ session: ID(43), model: 'new-model' });
  assert.deepEqual(b.calls.filter(([op]) => op === 'startAgent').at(-1)[1].args, ['--sandbox', 'workspace-write', '--model', 'new-model']);
  assert.equal(b.sessions.get(ID(43)).model, 'new-model');
  b.closeSession(b.sessions.get(ID(43)), 'killed');
  await r.reopen({ session: ID(43) });
  assert.ok(b.calls.filter(([op]) => op === 'startAgent').at(-1)[1].args.includes('new-model'));
});

test('audit: Claude reopen after /clear resumes the latest conversation without replacing the board identity', async () => {
  const root = tmp(), cwd = tmp(), W = folderWs(cwd), b = fakeBackend({ convoRoots: [root], workspaces: [W] });
  writeConvo(root, cwd, ID(45), [L.user('new context', { cwd })]);
  const rt = newRuntime(); rt.claudeSessionId = ID(45); rt.lastAnswer = 'retained answer';
  addClosed(b, { id: ID(44), name: 'cleared', cwd, rt, ws: W });
  const r = new Recall(b, { readProcs: async () => [] }); r.changed = async () => {};
  const out = await r.reopen({ session: ID(44) });
  assert.equal(out.sessionId, ID(44));
  assert.deepEqual(b.calls.find(([op]) => op === 'startAgent')[1].args.slice(0, 2), ['--resume', ID(45)]);
  assert.equal(b.sessions.get(ID(44)).rt.claudeSessionId, ID(45));
  assert.equal(b.sessions.get(ID(44)).rt.lastAnswer, 'retained answer');
});

for (const closeFails of [false, true]) {
  test(`audit: recovery closes only its target without enumeration and retains it when close fails=${closeFails}`, async () => {
    const cwd = tmp(), W = folderWs(cwd), b = fakeBackend({ convoRoots: [tmp()], workspaces: [W] });
    addClosed(b, { id: ID(46), name: 'stopped', cwd, kind: 'codex', ws: W });
    const row = b.store.getSession(ID(46)), s = { ...row, rt: row.runtime, paneId: 'shared:p1', herdrWorkspaceId: 'shared' };
    b.store.reopenRow(s.sessionId, {}); b.sessions.set(s.sessionId, s);
    b.adapter.workspacePanes = async () => { throw apiError('unreachable', 'fixture enumeration unavailable'); };
    b.adapter.closePane = async (pane) => {
      b.calls.push(['closePane', pane]);
      if (closeFails) throw apiError('unreachable', 'fixture close unavailable');
    };
    const r = new Recall(b, { readProcs: async () => [] }); r.changed = async () => {};
    if (closeFails) await assert.rejects(r.closeUnresumed(s), { code: 'unreachable' });
    else await r.closeUnresumed(s);
    assert.deepEqual(b.calls.filter(([op]) => op === 'closePane'), [['closePane', 'shared:p1']]);
    assert.equal(b.sessions.has(s.sessionId), closeFails);
    assert.equal(b.store.getSession(s.sessionId).closedAt === null, closeFails);
  });
}

// 가짜 대화 기록 한 줄씩
const L = {
  meta: (o) => JSON.stringify(o),
  user: (text, { cwd, at = '2026-10-31T01:00:00.000Z', entrypoint = 'cli', branch = 'main', uuid, meta = false, side = false } = {}) => JSON.stringify({ type: 'user', uuid: uuid || Math.random().toString(36).slice(2), cwd, gitBranch: branch, entrypoint, timestamp: at, isMeta: meta || undefined, isSidechain: side || undefined, message: { role: 'user', content: text } }),
  tool: (cwd) => JSON.stringify({ type: 'user', uuid: Math.random().toString(36).slice(2), cwd, entrypoint: 'cli', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } }),
  answer: (text, { at = '2026-10-31T01:00:05.000Z', cwd, entrypoint = 'cli' } = {}) => JSON.stringify({ type: 'assistant', uuid: Math.random().toString(36).slice(2), cwd, entrypoint, timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text }] } }),
  big: (n) => JSON.stringify({ type: 'attachment', attachment: { type: 'prompt_snapshot', blob: 'x'.repeat(n) } }),
};
function writeConvo(root, cwd, id, lines) {
  const dir = path.join(root, path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

// ---------- 대화 기록 읽기 ----------
test('J3: 대화 기록 머리와 꼬리에서 제목, 첫·마지막 지시, 마지막 답, cwd, 출처를 뽑는다(사람이 쓴 지시만)', () => {
  const cwd = 'C:/w/repo';
  const head = [
    L.meta({ type: 'last-prompt', lastPrompt: '마지막 지시(메타)' }),
    L.user('<command-name>/clear</command-name>', { cwd }),
    L.user('메타 줄', { cwd, meta: true }),
    L.user('보조 에이전트', { cwd, side: true }),
    L.user('첫 지시입니다', { cwd, at: '2026-10-31T01:00:00.000Z' }),
    L.tool(cwd),
    L.answer('첫 답', { cwd }),
    L.meta({ type: 'ai-title', aiTitle: 'AI가 지은 제목' }),
  ].join('\n');
  const s = parseTranscriptChunks(head, '');
  assert.equal(s.cwd, cwd);
  assert.equal(s.firstPrompt, '첫 지시입니다');
  assert.equal(s.lastPrompt, '첫 지시입니다');
  assert.equal(s.lastAnswer, '첫 답');
  assert.equal(s.prompts, 1);
  assert.deepEqual(s.entrypoints, ['cli']);
  assert.equal(s.title, 'AI가 지은 제목');
  // 사용자가 붙인 이름이 AI 제목보다 먼저
  const s2 = parseTranscriptChunks(head + '\n' + L.meta({ type: 'custom-title', customTitle: '내 이름' }), '');
  assert.equal(s2.title, '내 이름'); assert.equal(s2.titleSource, 'custom');
  // 제목이 없으면 첫 지시
  const s3 = parseTranscriptChunks(L.user('제목 없는 대화의 첫 지시', { cwd }), '');
  assert.equal(s3.title, '제목 없는 대화의 첫 지시'); assert.equal(s3.titleSource, 'prompt');
});

test('J3: 턴 끝의 큰 첨부 줄 뒤에 있는 마지막 답도 꼬리를 넓혀 찾는다. 머리와 꼬리가 겹친 줄은 한 번만 센다', async () => {
  const root = tmp(); const cwd = 'C:/w/big';
  const f = writeConvo(root, cwd, ID(1), [
    L.user('첫 지시', { cwd }), L.big(HEAD_BYTES), L.answer('중간 답', { cwd }),
    L.user('둘째 지시', { cwd, at: '2026-10-31T02:00:00.000Z' }), L.answer('마지막 답', { cwd, at: '2026-10-31T02:00:05.000Z' }),
    L.big(300 * 1024), L.meta({ type: 'last-prompt', lastPrompt: '둘째 지시' }),
  ]);
  const s = await readTranscriptSummary(f);
  assert.equal(s.firstPrompt, '첫 지시');
  assert.equal(s.lastPrompt, '둘째 지시');
  assert.equal(s.lastAnswer, '마지막 답');
  assert.equal(s.lastAt, Date.parse('2026-10-31T02:00:05.000Z'));
  // 작은 파일은 머리만
  const g = writeConvo(root, cwd, ID(2), [L.user('하나', { cwd }), L.answer('둘', { cwd })]);
  const t = await readTranscriptSummary(g);
  assert.equal(t.prompts, 1); assert.equal(t.answers, 1);
});

test('J3: 대화 기록 폴더의 맨 위 .jsonl만 대화다(보조 에이전트 하위 폴더와 UUID가 아닌 이름은 뺀다). 폴더는 여럿일 수 있다', async () => {
  const a = tmp(), b = tmp();
  writeConvo(a, 'C:/w/a', ID(1), [L.user('x', { cwd: 'C:/w/a' })]);
  const sub = path.join(a, 'C--w-a', ID(1), 'subagents'); fs.mkdirSync(sub, { recursive: true }); fs.writeFileSync(path.join(sub, `${ID(9)}.jsonl`), '{}');
  fs.writeFileSync(path.join(a, 'C--w-a', 'notes.jsonl'), '{}');
  writeConvo(b, 'C:/w/b', ID(2), [L.user('y', { cwd: 'C:/w/b' })]);
  const files = await listTranscriptFiles([a, b, path.join(a, 'none')]);
  assert.deepEqual(files.map((f) => f.convId).sort(), [ID(1), ID(2)]);
});

test('환경 변수: MTASK_CLAUDE_PROJECTS(;로 여럿), MTASK_CLAUDE_SESSIONS, MTASK_CLAUDE_DESKTOP(none이면 보지 않음). 판 세션의 대화 기록 폴더는 그대로', () => {
  const cfg = loadConfig({ argv: ['--dev'], env: { MTASK_CLAUDE_PROJECTS: 'C:/a;C:/b', MTASK_CLAUDE_SESSIONS: 'C:/s', MTASK_CLAUDE_DESKTOP: 'none' } });
  assert.deepEqual(cfg.convoRoots, [path.resolve('C:/a'), path.resolve('C:/b')]);
  assert.equal(cfg.claudeSessionsDir, path.resolve('C:/s'));
  assert.equal(cfg.desktopSessionsDir, null);
  assert.equal(cfg.claudeProjects, path.join(os.homedir(), '.claude', 'projects'));
});

// ---------- 묶여 있는지 ----------
test('J4: 세션 파일은 살아 있는 pid의 것만, 데스크톱 앱 목록은 cliSessionId와 priorCliSessionIds·보관, 다시 읽을 때는 바뀐 파일만', () => {
  const sdir = tmp();
  fs.writeFileSync(path.join(sdir, '111.json'), JSON.stringify({ pid: 111, sessionId: ID(1).toUpperCase(), entrypoint: 'cli', kind: 'interactive' }));
  fs.writeFileSync(path.join(sdir, '222.json'), JSON.stringify({ pid: 222, sessionId: ID(2), entrypoint: 'claude-desktop' }));
  fs.writeFileSync(path.join(sdir, '333.json'), JSON.stringify({ pid: 333, sessionId: ID(3) }));
  fs.writeFileSync(path.join(sdir, 'junk.txt'), 'x');
  const live = readLiveSessions(sdir, { alive: (p) => p !== 333 });
  assert.deepEqual([...live.keys()].sort(), [ID(1), ID(2)]);
  assert.equal(live.get(ID(1)).pid, 111);

  const base = tmp();
  const dir = path.join(base, 'Claude-3p', 'claude-code-sessions', 'org', 'acct'); fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(base, 'Claude-3p', 'Cache', 'deep', 'deeper'), { recursive: true });
  fs.writeFileSync(path.join(base, 'Claude-3p', 'Cache', 'deep', 'local_zz.json'), JSON.stringify({ cliSessionId: ID(8) })); // 세션 목록 밖은 보지 않는다
  fs.writeFileSync(path.join(dir, 'local_a.json'), JSON.stringify({ cliSessionId: ID(4), priorCliSessionIds: [ID(5)], isArchived: false }));
  fs.writeFileSync(path.join(dir, 'local_b.json'), JSON.stringify({ cliSessionId: ID(6), isArchived: true }));
  const cache = new Map();
  const d = readDesktopSessions(base, cache);
  assert.deepEqual([...d.keys()].sort(), [ID(4), ID(5), ID(6)]);
  assert.equal(d.get(ID(6)).archived, true);
  fs.rmSync(path.join(dir, 'local_b.json'));
  assert.deepEqual([...readDesktopSessions(base, cache).keys()].sort(), [ID(4), ID(5)]);
  assert.equal(cache.size, 1);
  assert.equal(readDesktopSessions(null).size, 0);
});

test('J4: claude 명령줄의 --resume·--session-id·-r에서 대화 ID를 읽는다', () => {
  const m = parseClaudeCmdlines([
    { pid: 10, cmd: `"C:\\x\\claude.exe" --resume ${ID(1)} --settings a.json` },
    { pid: 11, cmd: `claude --session-id=${ID(2)}` },
    { pid: 12, cmd: `claude -r "${ID(3)}"` },
    { pid: 13, cmd: 'claude --model haiku' }, { pid: 14, cmd: null },
  ]);
  assert.deepEqual([...m.entries()].map(([k, v]) => [k, v.pid]).sort(), [[ID(1), 10], [ID(2), 11], [ID(3), 12]]);
});

test('J4: 묶임 판정 순서 — 세션 파일, 명령줄, 데스크톱 목록, 대화 기록의 출처, 출처 모름·sdk, 방금 기록됨. 확실하지 않으면 묶인 것으로 본다', () => {
  const now = 10_000_000;
  const base = { convId: ID(1), entrypoints: ['cli'], mtime: now - RECENT_WRITE_MS - 1, now };
  assert.deepEqual(bindingOf(base), { bound: false });
  const t = bindingOf({ ...base, live: new Map([[ID(1), { pid: 42, entrypoint: 'cli' }]]) });
  assert.equal(t.where, 'terminal'); assert.equal(t.label, '터미널 · pid 42'); assert.equal(t.sure, true);
  assert.equal(bindingOf({ ...base, live: new Map([[ID(1), { pid: 43, entrypoint: 'claude-desktop' }]]) }).where, 'desktop');
  assert.equal(bindingOf({ ...base, procs: new Map([[ID(1), { pid: 44 }]]) }).label, '터미널 · pid 44');
  assert.equal(bindingOf({ ...base, desktop: new Map([[ID(1), { archived: true }]]) }).label, '데스크톱 앱 · 보관됨');
  // 데스크톱 앱 대화는 앱 목록에서 지워졌어도(출처 표시만 남음) 묶인 것으로 본다. 터미널에서 이어 쓴 적이 있어도 같다
  assert.equal(bindingOf({ ...base, entrypoints: ['claude-desktop', 'cli'] }).where, 'desktop');
  const u = bindingOf({ ...base, entrypoints: [] });
  assert.equal(u.bound, true); assert.equal(u.sure, false);
  assert.match(bindingOf({ ...base, entrypoints: ['sdk-cli'] }).label, /sdk-cli/);
  assert.match(bindingOf({ ...base, mtime: now - 1000 }).label, /최근 활동 감지/);
  // 세션 파일이 데스크톱 목록보다 먼저(지금 열려 있는 곳)
  assert.equal(bindingOf({ ...base, live: new Map([[ID(1), { pid: 1 }]]), desktop: new Map([[ID(1), {}]]) }).where, 'terminal');
});

test('J3: 대화가 리포에 드는가 — 워크스페이스 키(워크트리는 본 저장소 키), 폴더 워크스페이스는 그 아래 폴더(다른 저장소가 아닌 것)', () => {
  const repo = { key: 'c:/w/repo/.git', kind: 'repo', root: 'C:/w/repo' };
  assert.equal(inWorkspace(repo, 'C:/w/repo-wt', { key: 'c:/w/repo/.git', kind: 'repo', root: 'C:/w/repo' }), true);
  assert.equal(inWorkspace(repo, 'C:/w/other', { key: 'c:/w/other/.git', kind: 'repo' }), false);
  const folder = { key: 'c:/w/plain', kind: 'folder', root: 'C:/w/plain' };
  assert.equal(inWorkspace(folder, 'C:/w/plain', { key: 'c:/w/plain', kind: 'folder' }), true);
  assert.equal(inWorkspace(folder, 'C:/w/plain/sub', { key: 'c:/w/plain/sub', kind: 'folder' }), true);
  assert.equal(inWorkspace(folder, 'C:/w/plain/inner-repo', { key: 'c:/w/plain/inner-repo/.git', kind: 'repo' }), false);
  assert.equal(inWorkspace(folder, 'C:/w/plainx', { key: 'c:/w/plainx', kind: 'folder' }), false);
});

// ---------- 가짜 백엔드 ----------
function fakeBackend({ convoRoots, sessionsDir = tmp(), desktop = null, workspaces = [], herdr = {} } = {}) {
  const dataDir = tmp();
  const store = new Store(path.join(dataDir, 'board.db'));
  for (const w of workspaces) store.insertWorkspace({ ...w, createdAt: Date.now() });
  const events = [];
  const calls = [];
  let pane = 0;
  const adapter = {
    connected: true,
    createWorkspace: async ({ cwd, label }) => { pane++; calls.push(['createWorkspace', normPath(cwd), label]); return { workspaceId: `w${pane}`, paneId: `w${pane}:p1` }; },
    waitShellReady: async () => true,
    startAgent: async (a) => { calls.push(['startAgent', a]); return { agent: { name: a.name, launchPending: true }, argv: [a.kind, ...a.args] }; },
    refreshSubscription: async () => {},
    workspacePanes: async () => assert.fail('single-pane recovery must not depend on a workspace snapshot'),
    closePane: async (p) => calls.push(['closePane', p]),
    closeWorkspace: async () => assert.fail('single-pane recovery must preserve sibling panes'),
    ...herdr,
  };
  const b = {
    cfg: { convoRoots, claudeSessionsDir: sessionsDir, desktopSessionsDir: desktop, convoScanMs: 60000, claudeProjects: convoRoots[0], sessionsDir: path.join(dataDir, 'sessions'), hookTimeoutSec: 2, claudeJson: path.join(dataDir, 'none.json'), claudeCommand: 'claude', recoverGraceMs: 50 },
    store, bus: new EventEmitter(), sessions: new Map(), adapter, events, calls, killing: new Set(),
    api: { broadcast: (ev, data) => events.push([ev, data]) },
    plugin: { pluginDir: 'P', systemPromptFile: 'S' }, hookUrl: 'http://127.0.0.1:1/hooks/claude',
    log: () => {}, hooked: (s) => s.rt.hooked !== false, requireHerdr: () => {},
    resolveWorkspace: async (r) => store.getWorkspace(r),
    ensureWorkspace: (ws) => { if (!store.getWorkspace(ws.key)) store.insertWorkspace({ ...ws, createdAt: Date.now() }); },
    withNewPane: async (create, register) => { const r = await create(); await register(r); return r; },
    broadcastSession: (s, o) => events.push(['session', s.name, o && o.cause]),
    probeGit: () => {}, registerResume: (s) => calls.push(['registerResume', s.sessionId]),
    setPane: async (s, paneId, wid) => { s.paneId = paneId; s.herdrWorkspaceId = wid; store.updateSession(s.sessionId, { paneId, herdrWorkspaceId: wid }); },
    demoteToShell: (s) => { s.kind = 'shell'; calls.push(['demote', s.name]); },
    closeSession: (s, reason) => { store.updateSession(s.sessionId, { closedAt: Date.now(), runtime: s.rt, closeReason: reason }); b.sessions.delete(s.sessionId); calls.push(['close', s.name, reason]); },
  };
  return b;
}
const folderWs = (dir) => ({ key: pathKey(dir), kind: 'folder', root: normPath(dir) });
const fakeResolve = (map) => async (cwd) => map[pathKey(cwd)] || folderWs(cwd);

test('J3: 색인은 바뀐 파일만 다시 읽고, 글(제목·지시·답)은 열린 워크스페이스의 대화만 저장한다. 판이 아는 대화는 판 밖 목록에서 뺀다', async () => {
  const root = tmp();
  const ws = tmp(), other = tmp(), wt = tmp(); // 열린 폴더 워크스페이스, 열지 않은 폴더, "워크트리"(가짜로 같은 키)
  writeConvo(root, ws, ID(1), [L.user('열린 곳의 지시', { cwd: ws }), L.answer('답', { cwd: ws })]);
  writeConvo(root, other, ID(2), [L.user('비밀 지시', { cwd: other })]);
  writeConvo(root, wt, ID(3), [L.user('워크트리 지시', { cwd: wt, branch: 'feat' })]);
  writeConvo(root, ws, ID(4), [L.meta({ type: 'mode', mode: 'x' })]); // 지시가 없는 대화는 보이지 않는다
  writeConvo(root, ws, ID(5), [L.user('판 세션의 대화', { cwd: ws })]);
  const repoWs = { key: 'c:/r/.git', kind: 'repo', root: normPath(ws) };
  const b = fakeBackend({ convoRoots: [root], workspaces: [repoWs] });
  b.store.insertSession({ sessionId: ID(5), name: 's1', cwd: ws, permissionMode: 'manual', createdAt: 1, runtime: newRuntime(), kind: 'claude', origin: 'board', workspaceKey: repoWs.key });
  const r = new Recall(b, { resolveCwd: fakeResolve({ [pathKey(ws)]: repoWs, [pathKey(wt)]: { ...repoWs } }), readProcs: async () => [] });
  const s1 = await r.scan({ wait: true });
  assert.equal(s1.files, 5); assert.equal(s1.read, 5);
  const idx = new Map(b.store.convoIndex().map((c) => [c.convId, c]));
  assert.equal(idx.get(ID(1)).title, '열린 곳의 지시');
  assert.equal(idx.get(ID(2)).title, null); // 열지 않은 곳의 글은 남기지 않는다
  assert.equal(idx.get(ID(2)).firstPrompt, null);
  assert.equal(idx.get(ID(2)).cwd, other);
  const list = await r.list();
  const convos = list.workspaces[0].convos;
  assert.deepEqual(convos.map((c) => c.convId).sort(), [ID(1), ID(3)]);
  const w3 = convos.find((c) => c.convId === ID(3));
  assert.equal(w3.worktree, true); assert.equal(w3.branch, 'feat'); assert.equal(w3.canOpen, false); // 방금 쓴 파일
  // 두 번째는 다시 읽지 않는다
  const s2 = await r.scan({ wait: true });
  assert.equal(s2.read, 0);
  // 열지 않던 곳을 열면 그 대화의 글을 채운다
  b.store.insertWorkspace({ ...folderWs(other), createdAt: Date.now() });
  const s3 = await r.scan({ wait: true });
  assert.equal(s3.read, 1);
  assert.equal(b.store.getConvoById(ID(2)).firstPrompt, '비밀 지시');
  // 지운 파일은 색인에서 빠진다
  fs.rmSync(path.join(root, path.resolve(other).replace(/[^A-Za-z0-9]/g, '-'), `${ID(2)}.jsonl`));
  const s4 = await r.scan({ wait: true });
  assert.equal(s4.dropped, 1);
  assert.equal(b.events.some(([e]) => e === 'recall.updated'), true);
});

test('J3: 대화가 많아도(2,000개, 큰 파일 섞임) 처음 훑기는 몇 초 안, 두 번째는 다시 읽지 않는다', async () => {
  const root = tmp(); const ws = tmp();
  for (let i = 0; i < 2000; i++) writeConvo(root, ws, ID(i), i % 100 === 0 ? [L.user(`지시 ${i}`, { cwd: ws }), L.big(400 * 1024), L.answer('답', { cwd: ws })] : [L.user(`지시 ${i}`, { cwd: ws }), L.answer('답', { cwd: ws })]);
  const b = fakeBackend({ convoRoots: [root], workspaces: [folderWs(ws)] });
  const r = new Recall(b, { resolveCwd: fakeResolve({}), readProcs: async () => [] });
  const t0 = Date.now();
  const s1 = await r.scan({ wait: true });
  const first = Date.now() - t0;
  assert.equal(s1.files, 2000);
  assert.ok(first < 20000, `first scan ${first}ms`);
  const t1 = Date.now();
  const s2 = await r.scan({ wait: true });
  assert.equal(s2.read, 0);
  assert.ok(Date.now() - t1 < first, 'cached scan is faster');
  const list = await r.list();
  assert.equal(list.workspaces[0].convos.length, 300); // 워크스페이스 하나에 마지막 활동 순 300개까지
});

// ---------- 닫힌 세션(J2) ----------
function addClosed(b, { id, name, cwd, kind = 'claude', origin = 'board', reason = 'killed', rt = newRuntime({ kind, hooked: kind === 'claude' && origin === 'board' }), ws }) {
  b.store.insertSession({ sessionId: id, name, cwd, permissionMode: 'manual', createdAt: 1, runtime: rt, kind, origin, workspaceKey: ws.key });
  b.store.setNode({ session_id: id, x: 100, y: 200, w: 720, h: 460 });
  b.store.updateSession(id, { closedAt: Date.now(), closeReason: reason });
}

test('board auto approval on Claude reopen keeps the native ID, launcher and display label', async (t) => {
  const root = tmp(), cwd = tmp(), ws = folderWs(cwd), b = fakeBackend({ convoRoots: [root], workspaces: [ws] });
  const boardId = ID(70), nativeId = ID(71), rt = newRuntime(); rt.claudeSessionId = nativeId;
  rt.extraArgs = ['--permission-mode', 'manual', '--max-turns', '4'];
  addClosed(b, { id: boardId, name: 'stable-agent', cwd, ws, rt });
  b.store.updateSession(boardId, { startCommand: 'ocx claude', label: '검토자' });
  b.store.setMeta('settings', { agentAutoApprove: true });
  writeConvo(root, cwd, nativeId, [L.user('synthetic prompt', { cwd }), L.answer('synthetic answer', { cwd })]);
  const recall = new Recall(b, { readProcs: async () => [] }); recall.changed = async () => {};
  t.after(() => { recall.stop(); b.store.close(); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(cwd, { recursive: true, force: true }); });
  await recall.reopen({ session: boardId });
  const launch = b.calls.find(([op]) => op === 'startAgent')[1], row = b.store.getSession(boardId);
  assert.deepEqual(launch.command, ['ocx', 'claude']);
  assert.deepEqual(launch.args.slice(0, 2), ['--resume', nativeId]);
  assert.equal(launch.args.filter((arg) => arg === '--permission-mode').length, 1);
  assert.ok(launch.args.includes('bypassPermissions') && launch.args.includes('--max-turns') && !launch.args.includes('manual'));
  assert.deepEqual(row.resumeArgv.slice(0, 4), ['ocx', 'claude', '--resume', nativeId]);
  assert.equal(row.label, '검토자'); assert.equal(row.name, 'stable-agent');
  assert.equal(row.runtime.startCommand, 'ocx claude');
});

test('board auto approval on hookless Claude recovery uses the known native ID and launcher', async (t) => {
  const cwd = tmp(), ws = folderWs(cwd), b = fakeBackend({ convoRoots: [tmp()], workspaces: [ws] });
  const rt = newRuntime({ kind: 'claude', hooked: false }); rt.herdr.agentSessionId = ID(81);
  const s = { sessionId: ID(80), name: 'stable-agent', agentName: 'stable-agent', cwd, paneId: 'owned-pane', kind: 'claude', origin: 'adopted', permissionMode: 'manual', startCommand: 'ocx claude', createdAt: 1, rt };
  b.sessions.set(s.sessionId, s); b.store.insertSession({ ...s, runtime: rt }); b.store.setMeta('settings', { agentAutoApprove: true });
  const recall = new Recall(b, { readProcs: async () => [] });
  t.after(() => { recall.stop(); b.store.close(); fs.rmSync(cwd, { recursive: true, force: true }); });
  await recall.resumeHookless(s, 'synthetic-recovery');
  const launch = b.calls.find(([op]) => op === 'startAgent')[1];
  assert.deepEqual(launch.args, ['--resume', ID(81), '--permission-mode', 'bypassPermissions']);
  assert.deepEqual(launch.command, ['ocx', 'claude']);
  assert.equal(b.store.getSession(s.sessionId).permissionMode, 'bypassPermissions');
});

test('J2: 닫힌 세션은 그 워크스페이스 아래 "닫힘"으로 보이고, 목록에서 빼면 사라진다(판 기록은 남음)', async () => {
  const root = tmp(); const ws = tmp(); const W = folderWs(ws);
  const b = fakeBackend({ convoRoots: [root], workspaces: [W] });
  addClosed(b, { id: ID(1), name: 'sh1', cwd: ws, kind: 'shell', ws: W, reason: 'pane gone' });
  addClosed(b, { id: ID(2), name: 's1', cwd: ws, ws: W });
  const r = new Recall(b, { resolveCwd: fakeResolve({}), readProcs: async () => [] });
  let closed = await r.closedList();
  assert.deepEqual(closed.map((c) => c.name).sort(), ['s1', 'sh1']);
  const sh = closed.find((c) => c.name === 'sh1');
  assert.equal(sh.reasonLabel, CLOSE_REASON['pane gone']); assert.equal(sh.canReopen, true);
  r.dismiss({ session: ID(1) });
  await r.changed();
  closed = await r.closedList();
  assert.deepEqual(closed.map((c) => c.name), ['s1']);
  assert.ok(b.store.getSession(ID(1)));
});

test('J2: 닫힌 claude를 다시 열면 같은 세션 ID로 이어 간다(--resume, 새 설정 파일과 hook 토큰, 판의 실행 인자). 마지막 자리가 비면 그 자리', async () => {
  const root = tmp(); const ws = tmp(); const W = folderWs(ws);
  writeConvo(root, ws, ID(2), [L.user('지시', { cwd: ws }), L.answer('답', { cwd: ws })]);
  const b = fakeBackend({ convoRoots: [root], workspaces: [W] });
  addClosed(b, { id: ID(2), name: 's1', cwd: ws, ws: W });
  b.store.updateSession(ID(2), { model: 'haiku' });
  const r = new Recall(b, { resolveCwd: fakeResolve({}), readProcs: async () => [] });
  await r.scan({ wait: true });
  const out = await r.reopen({ session: 's1' });
  assert.equal(out.sessionId, ID(2)); assert.equal(out.resume, true); assert.equal(out.place, 'last');
  const st = b.calls.find((c) => c[0] === 'startAgent')[1];
  assert.deepEqual(st.args.slice(0, 2), ['--resume', ID(2)]);
  assert.ok(st.args.includes('--settings') && st.args.includes('--plugin-dir') && st.args.includes('haiku'));
  assert.ok(!st.args.includes('--fork-session'));
  const row = b.store.getSession(ID(2));
  assert.equal(row.closedAt, null); assert.ok(row.hookToken.length > 20);
  assert.ok(fs.readFileSync(row.settingsPath, 'utf8').includes(row.hookToken));
  assert.deepEqual(b.store.nodeOf(ID(2)), { session_id: ID(2), x: 100, y: 200, w: 1440, h: 810, z: 0, size: 'wide-normal', aspect: '16:9', area: '' }); // P27: area(본 저장소 영역)
  assert.ok(b.calls.some((c) => c[0] === 'registerResume'));
  await assert.rejects(r.reopen({ session: ID(2) }), (e) => e.code === 'not_found');
});

test('J2: 대화 기록이 없는 claude는 같은 --session-id로 새로, 셸은 같은 폴더에 새 셸, 다른 종류는 띄울 때의 인자로. 이름이 쓰이고 있으면 바꾸고 자리가 차면 빈자리', async () => {
  const root = tmp(); const ws = tmp(); const W = folderWs(ws);
  const b = fakeBackend({ convoRoots: [root], workspaces: [W] });
  addClosed(b, { id: ID(3), name: 's2', cwd: ws, ws: W });
  addClosed(b, { id: ID(4), name: 'sh1', cwd: ws, kind: 'shell', ws: W });
  addClosed(b, { id: ID(5), name: 'cx', cwd: ws, kind: 'codex', ws: W });
  b.store.addEvent(ID(5), 'spawn', { name: 'cx', kind: 'codex', args: ['-m', 'o4'] });
  b.sessions.set('other', { sessionId: 'other', name: 'sh1', rt: newRuntime() }); // 같은 이름의 열린 세션
  const r = new Recall(b, { resolveCwd: fakeResolve({}), readProcs: async () => [] });
  const a = await r.reopen({ session: ID(3) });
  assert.equal(a.resume, false);
  assert.deepEqual(b.calls.filter((c) => c[0] === 'startAgent').pop()[1].args.slice(0, 2), ['--session-id', ID(3)]);
  const sh = await r.reopen({ session: ID(4) });
  assert.equal(sh.name, 'sh1-2'); assert.equal(sh.place, 'slot'); // s2가 그 자리에 다시 떴다
  assert.equal(b.sessions.get(ID(4)).agentName, sh.paneId);
  const cx = await r.reopen({ session: ID(5) });
  assert.deepEqual(b.calls.filter((c) => c[0] === 'startAgent').pop()[1], { name: 'cx', paneId: cx.paneId, args: ['-m', 'o4'], kind: 'codex' });
});

test('J2·J4: 판에 올린 claude는 그 대화 ID의 판 세션으로 다시 연다(옛 행은 옮겨 갔다고 남김). 묶여 있으면 열지 않는다', async () => {
  const root = tmp(); const ws = tmp(); const W = folderWs(ws); const sdir = tmp();
  writeConvo(root, ws, ID(7), [L.user('지시', { cwd: ws })]);
  const b = fakeBackend({ convoRoots: [root], workspaces: [W], sessionsDir: sdir });
  const rt = newRuntime({ kind: 'claude', hooked: false }); rt.herdr.agentSessionId = ID(7);
  addClosed(b, { id: ID(6), name: 'helper', cwd: ws, origin: 'adopted', rt, ws: W, reason: 'pane gone' });
  assert.equal(convOf(b.store.getSession(ID(6))), ID(7));
  const r = new Recall(b, { resolveCwd: fakeResolve({}), readProcs: async () => [{ pid: 77, cmd: `claude --resume ${ID(7)}` }] });
  await r.scan({ wait: true });
  await assert.rejects(r.reopen({ session: ID(6) }), (e) => e.code === 'bound' && /pid 77/.test(e.message));
  r.readProcs = async () => [];
  const out = await r.reopen({ session: ID(6) });
  assert.equal(out.sessionId, ID(7)); assert.equal(out.name, 'helper'); assert.equal(out.place, 'last');
  assert.equal(b.store.getSession(ID(7)).origin, 'board');
  assert.equal(b.store.closedSession(ID(6)).reopenedAs, ID(7));
  assert.equal((await r.closedList()).length, 0);
});

test('J4: 판 밖 대화 열기 — 묶여 있지 않으면 같은 대화 ID로 이어 가는 판 세션, 이미 판 세션이면 그 노드로, 데스크톱·터미널·모름은 거부', async () => {
  const root = tmp(); const ws = tmp(); const W = folderWs(ws); const sdir = tmp(); const desk = tmp();
  const old = Date.now() - 120000;
  for (const n of [1, 2, 3, 4]) { const f = writeConvo(root, ws, ID(n), [L.user(`지시 ${n}`, { cwd: ws, entrypoint: n === 3 ? 'claude-desktop' : n === 4 ? 'sdk-cli' : 'cli' })]); fs.utimesSync(f, new Date(old), new Date(old)); }
  fs.writeFileSync(path.join(sdir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: ID(2), entrypoint: 'cli' }));
  const b = fakeBackend({ convoRoots: [root], workspaces: [W], sessionsDir: sdir, desktop: desk });
  const r = new Recall(b, { resolveCwd: fakeResolve({}), readProcs: async () => [] });
  await r.scan({ wait: true });
  const convos = await r.convoList();
  assert.deepEqual(Object.fromEntries(convos.map((c) => [c.convId.slice(0, 8), c.canOpen])), { '00000001': true, '00000002': false, '00000003': false, '00000004': false });
  await assert.rejects(r.openConvo({ convo: ID(2) }), (e) => e.code === 'bound' && e.binding.where === 'terminal');
  await assert.rejects(r.openConvo({ convo: ID(3) }), (e) => e.code === 'bound' && e.binding.where === 'desktop');
  await assert.rejects(r.openConvo({ convo: ID(4) }), (e) => e.code === 'bound' && e.binding.sure === false);
  const out = await r.openConvo({ convo: ID(1), model: 'haiku' });
  assert.equal(out.sessionId, ID(1)); assert.equal(out.resume, true);
  const st = b.calls.filter((c) => c[0] === 'startAgent').pop()[1];
  assert.deepEqual(st.args.slice(0, 2), ['--resume', ID(1)]);
  assert.ok(!st.args.includes('--fork-session') && !st.args.includes('--session-id'));
  // 이제 판 세션이다: 다시 열면 그 노드로 갈 뿐
  b.store.getSession(ID(1));
  const again = await r.openConvo({ convo: ID(1) });
  assert.deepEqual(again, { existing: true, sessionId: ID(1), name: out.name });
  assert.equal((await r.convoList()).some((c) => c.convId === ID(1)), false);
});

// ---------- 되살리기(J1) ----------
test('J1: herdr가 패널을 잃은 셸은 같은 폴더의 새 셸로, 판에 올린 claude는 그 대화 ID로 같은 노드에 되살린다. 대화 ID가 없거나 다른 종류는 되살리지 않는다', async () => {
  const root = tmp(); const ws = tmp(); const W = folderWs(ws);
  writeConvo(root, ws, ID(9), [L.user('지시', { cwd: ws })]);
  const b = fakeBackend({ convoRoots: [root], workspaces: [W] });
  const r = new Recall(b, { resolveCwd: fakeResolve({}), readProcs: async () => [] });
  await r.scan({ wait: true });
  const mk = (id, name, kind, origin, rt) => { const s = { sessionId: id, name, cwd: ws, kind, origin, paneId: 'old:p1', herdrWorkspaceId: 'old', agentName: name, rt, workspaceKey: W.key }; b.store.insertSession({ ...s, permissionMode: 'manual', createdAt: 1, runtime: rt }); b.sessions.set(id, s); return s; };
  const shRt = newRuntime({ kind: 'shell', hooked: false }); shRt.interruptedTurn = { state: 'shell_running', prompt: 'ping' };
  const sh = mk(ID(1), 'sh1', 'shell', 'board', shRt);
  const hRt = newRuntime({ kind: 'claude', hooked: false }); hRt.herdr.agentSessionId = ID(9); hRt.exit = { kind: 'herdr_stopped' };
  const helper = mk(ID(2), 'helper', 'claude', 'adopted', hRt);
  const nRt = newRuntime({ kind: 'claude', hooked: false });
  const noConv = mk(ID(3), 'h2', 'claude', 'adopted', nRt);
  const cx = mk(ID(4), 'cx', 'codex', 'board', newRuntime({ kind: 'codex', hooked: false }));
  assert.equal(r.restorable(sh), true); assert.equal(r.restorable(helper), true);
  assert.equal(r.restorable(noConv), false); assert.equal(r.restorable(cx), false);
  await r.restoreGone([sh, helper]);
  assert.equal(sh.paneId, 'w1:p1'); assert.equal(sh.rt.kind, 'shell'); assert.deepEqual(sh.rt.interruptedTurn, { state: 'shell_running', prompt: 'ping' });
  assert.equal(helper.paneId, 'w2:p1');
  const st = b.calls.filter((c) => c[0] === 'startAgent').pop()[1];
  assert.deepEqual(st, { name: 'helper', paneId: 'w2:p1', args: ['--resume', ID(9)], kind: 'claude' });
  assert.equal(helper.rt.exit, null);
});

test('J1: herdr를 다시 띄운 뒤 패널은 남았는데 돌아오지 않은 hook 없는 에이전트 — 판에 올린 claude는 같은 패널에서 이어 가고, 판이 띄운 다른 종류는 닫힘(남은 패널도 닫음), 그 사이 herdr가 이어 가면 손대지 않는다', async () => {
  const root = tmp(); const ws = tmp(); const W = folderWs(ws);
  writeConvo(root, ws, ID(9), [L.user('지시', { cwd: ws })]);
  const b = fakeBackend({ convoRoots: [root], workspaces: [W] });
  const r = new Recall(b, { resolveCwd: fakeResolve({}), readProcs: async () => [] });
  await r.scan({ wait: true });
  const down = (kind, agentSessionId = null) => { const rt = newRuntime({ kind, hooked: false }); rt.exit = { kind: 'herdr_stopped' }; rt.herdr.agentSessionId = agentSessionId; return rt; };
  const mk = (id, name, kind, origin, rt) => { const s = { sessionId: id, name, cwd: ws, kind, origin, paneId: `${name}:p1`, herdrWorkspaceId: name, agentName: name, rt, workspaceKey: W.key }; b.store.insertSession({ ...s, permissionMode: 'manual', createdAt: 1, runtime: rt }); b.sessions.set(id, s); return s; };
  const helper = mk(ID(1), 'helper', 'claude', 'adopted', down('claude', ID(9)));
  const cx = mk(ID(2), 'cx', 'codex', 'board', down('codex'));
  const back = mk(ID(3), 'back', 'claude', 'adopted', down('claude', ID(9)));
  const ag = mk(ID(4), 'ag', 'aider', 'adopted', down('aider'));
  setTimeout(() => { back.rt.exit = null; }, 10); // herdr가 스스로 이어 갔다
  await r.recoverHookless([helper, cx, back, ag]);
  const starts = b.calls.filter((c) => c[0] === 'startAgent').map((c) => c[1]);
  assert.deepEqual(starts, [{ name: 'helper', paneId: 'helper:p1', args: ['--resume', ID(9)], kind: 'claude' }]);
  assert.deepEqual(b.calls.filter((c) => c[0] === 'closePane'), [['closePane', 'cx:p1']]);
  assert.ok(b.calls.some((c) => c[0] === 'close' && c[1] === 'cx' && c[2] === 'not resumed after herdr restart'));
  assert.ok(b.calls.some((c) => c[0] === 'demote' && c[1] === 'ag'));
});

// ---------- 옮기기 ----------
test('저장소: P6까지의 board.db를 열면 convo_index와 sessions의 새 열이 생기고, 그 전에 닫힌 세션의 닫힌 까닭은 판 이벤트에서 읽는다', () => {
  const dir = tmp(); const file = path.join(dir, 'board.db');
  // P6 모양을 흉내 낸다: 지금 스키마로 만든 뒤 P7의 표와 열을 뺀다
  const s0 = new Store(file);
  s0.db.exec('DROP TABLE convo_index');
  for (const c of ['close_reason', 'dismissed_at', 'reopened_as']) s0.db.exec(`ALTER TABLE sessions DROP COLUMN ${c}`);
  s0.db.prepare("INSERT INTO sessions (session_id, name, cwd, permission_mode, settings_path, hook_token, created_at, closed_at, kind, origin, workspace_key) VALUES ('a', 'old', 'C:/x', 'manual', '', '', 1, 5, 'shell', 'board', 'c:/x')").run();
  s0.addEvent('a', 'closed', { reason: 'pane gone' });
  s0.close();
  const st = new Store(file);
  const cols = new Set(st.db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name));
  for (const c of ['close_reason', 'dismissed_at', 'reopened_as']) assert.ok(cols.has(c), c);
  assert.deepEqual(st.convoIndex(), []);
  const closed = st.closedSessions();
  assert.equal(closed.length, 1); assert.equal(closed[0].reason, 'pane gone'); assert.equal(closed[0].name, 'old');
  st.close();
});
