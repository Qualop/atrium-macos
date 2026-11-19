// P133 단위 시험: 판 밖 Codex 대화(Codex CLI·Codex 앱의 rollout) 읽기(머리·꼬리, 눌린 파일, cwd, 첫 지시·마지막 답), 리포 맞추기, 판이 아는 대화 빼기,
// 묶임 판정(잠금 파일, 명령줄, Codex 앱, 방금 기록됨), 열기 인자(`codex resume <ID>`, Codex 앱 대화는 `codex fork <ID>`), 지우기 거부, 설정.
// codex와 터미널 없이 돈다. 대화 기록은 직접 만든 가짜 Codex 홈이다. 실제 ~/.codex는 읽지 않는다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { Store } from '../src/store.mjs';
import { pathKey, normPath } from '../src/workspaces.mjs';
import { parseClaudeCmdlines, HEAD_BYTES } from '../src/convos.mjs';
import { parseCodexChunks, readCodexSummary, listCodexFiles, readCodexTitles, readCodexLocks, probeLock, parseCodexCmdlines, codexBindingOf, codexEntrypoint } from '../src/codex-convos.mjs';
import { Recall } from '../src/recall.mjs';
import { harnessLaunch, codexSessionOf } from '../src/harness.mjs';
import { trashPlan } from '../src/missed.mjs';
import { loadConfig } from '../src/config.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p133-'));
const CID = (n) => `01a1d2${String(n).padStart(2, '0')}-0000-7000-8000-000000000000`;
const T = (s) => `2026-11-13T01:00:${String(s).padStart(2, '0')}.000Z`;
let ord = 0;
// 가짜 Codex rollout 줄(codex-cli 0.167 모양)
const C = {
  meta: (id, cwd, { source = 'cli', originator = 'codex-tui', at = T(0) } = {}) => JSON.stringify({ timestamp: at, ordinal: ord++, type: 'session_meta', payload: { session_id: id, id, timestamp: at, cwd, originator, cli_version: '0.167.2', source, model_provider: 'p133fake', base_instructions: { text: 'BASE' } } }),
  dev: (text) => JSON.stringify({ timestamp: T(1), ordinal: ord++, type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text }] } }),
  agents: (text) => JSON.stringify({ timestamp: T(1), ordinal: ord++, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }], internal_chat_message_metadata_passthrough: { content_item_kinds: ['agents_md.instructions'] } } }),
  userResp: (text, at = T(2)) => JSON.stringify({ timestamp: at, ordinal: ord++, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }], internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] } } }),
  user: (text, at = T(2)) => JSON.stringify({ timestamp: at, ordinal: ord++, type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', id: 'u', content: [{ type: 'text', text }] } } }),
  answer: (text, at = T(5), phase = 'final_answer') => JSON.stringify({ timestamp: at, ordinal: ord++, type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', id: 'a', content: [{ type: 'Text', text }], phase } } }),
  big: (n) => JSON.stringify({ timestamp: T(3), ordinal: ord++, type: 'event_msg', payload: { type: 'token_count', blob: 'x'.repeat(n) } }),
  // 옛 판(0.1x): user_message, agent_message, ordinal 없음
  oldUser: (text, at = T(2)) => JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'user_message', message: text } }),
  oldAnswer: (text, at = T(5)) => JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'agent_message', message: text } }),
};
function writeRollout(home, id, lines, { day = '2026/11/13', zst = false, child = null, mtime = null } = {}) {
  const dir = path.join(home, 'sessions', ...day.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `rollout-2026-11-13T10-00-00-${id}${child ? `_${child}` : ''}.jsonl${zst ? '.zst' : ''}`);
  const text = lines.join('\n') + '\n';
  fs.writeFileSync(f, zst ? zlib.zstdCompressSync(Buffer.from(text)) : text);
  if (mtime) fs.utimesSync(f, new Date(mtime), new Date(mtime));
  return f;
}

// ---------- 읽기 ----------
test('P133: rollout 머리에서 대화 ID, cwd, 출처, 첫·마지막 지시, 마지막 답을 뽑는다(Codex가 넣은 지시문은 빼고)', () => {
  const id = CID(1);
  const s = parseCodexChunks([C.meta(id, 'C:\\w\\repo'), C.dev('개발자 지시문'), C.agents('# AGENTS.md 지시'), C.userResp('첫 지시'), C.user('첫 지시'), C.answer('중간 말', T(3), 'commentary'), C.answer('첫 답', T(4)), C.userResp('둘째 지시', T(6)), C.user('둘째 지시', T(6)), C.answer('마지막 답', T(9))].join('\n'));
  assert.equal(s.convId, id); assert.equal(s.cwd, 'C:\\w\\repo'); assert.deepEqual(s.entrypoints, ['cli']);
  assert.equal(s.prompts, 2); assert.equal(s.firstPrompt, '첫 지시'); assert.equal(s.lastPrompt, '둘째 지시'); assert.equal(s.lastAnswer, '마지막 답');
  assert.equal(s.title, '첫 지시'); assert.equal(s.startAt, Date.parse(T(0))); assert.equal(s.lastAt, Date.parse(T(9)));
  assert.ok(s.promptKey);
  // 마지막 지시 뒤에 답이 없으면 마지막 답은 비운다
  const s2 = parseCodexChunks([C.meta(id, 'C:/w'), C.user('a'), C.answer('답 a', T(3)), C.user('b', T(6))].join('\n'));
  assert.equal(s2.lastPrompt, 'b'); assert.equal(s2.lastAnswer, null);
  // 옛 판의 줄(user_message·agent_message), item 줄이 없으면 response_item의 user.text
  const s3 = parseCodexChunks([C.meta(id, 'C:/w'), C.oldUser('옛 지시'), C.oldAnswer('옛 답')].join('\n'));
  assert.equal(s3.prompts, 1); assert.equal(s3.firstPrompt, '옛 지시'); assert.equal(s3.lastAnswer, '옛 답');
  const s4 = parseCodexChunks([C.meta(id, 'C:/w'), C.agents('# AGENTS.md'), C.userResp('응답 줄만 있는 지시')].join('\n'));
  assert.equal(s4.prompts, 1); assert.equal(s4.firstPrompt, '응답 줄만 있는 지시');
});

test('P133: 출처 → entrypoints(cli, codex exec는 sdk, Codex 앱, 편집기 확장), 하위 에이전트 대화는 지시 0으로 목록에 올리지 않는다', () => {
  assert.deepEqual(codexEntrypoint({ source: 'cli', originator: 'codex-tui' }).entrypoints, ['cli']);
  assert.deepEqual(codexEntrypoint({ source: 'exec', originator: 'codex_exec' }).entrypoints, ['sdk-codex-exec']);
  assert.deepEqual(codexEntrypoint({ source: 'vscode', originator: 'Codex Desktop' }).entrypoints, ['codex-desktop']);
  assert.deepEqual(codexEntrypoint({ source: 'vscode', originator: 'codex_vscode' }).entrypoints, ['codex-vscode']);
  assert.deepEqual(codexEntrypoint({ source: 'vscode', originator: 'codex-tui' }).entrypoints, ['cli']); // 0.167 터미널 codex는 앱 데몬을 거친다
  const sub = parseCodexChunks([JSON.stringify({ timestamp: T(0), type: 'session_meta', payload: { id: CID(9), cwd: 'C:/w', source: { subagent: { thread_spawn: {} } } } }), C.user('하위 일')].join('\n'));
  assert.equal(sub.subagent, true); assert.equal(sub.prompts, 0);
});

test('P133: 큰 파일은 머리와 꼬리를 읽고(꼬리는 답이 나올 때까지 넓힌다), 눌린 파일(.jsonl.zst)은 머리만 풀어 읽는다(마지막 활동은 파일 시각)', async () => {
  const home = tmp(); const id = CID(2);
  const f = writeRollout(home, id, [C.meta(id, 'C:/w'), C.user('처음'), C.answer('처음 답', T(3)), C.big(HEAD_BYTES + 50000), C.user('끝 지시', T(20)), C.big(200 * 1024), C.answer('끝 답', T(40))]);
  const s = await readCodexSummary(f);
  assert.equal(s.firstPrompt, '처음'); assert.equal(s.lastPrompt, '끝 지시'); assert.equal(s.lastAnswer, '끝 답');
  const mt = Date.parse('2026-11-14T08:00:00.000Z');
  const z = writeRollout(home, CID(3), [C.meta(CID(3), 'C:/w'), C.user('눌린 대화 지시'), C.answer('눌린 답'), C.big(HEAD_BYTES * 2), C.user('안 읽히는 지시', T(50))], { zst: true, mtime: mt });
  const sz = await readCodexSummary(z);
  assert.equal(sz.convId, CID(3)); assert.equal(sz.firstPrompt, '눌린 대화 지시'); assert.equal(sz.compressed, true);
  assert.equal(sz.lastAt, mt); // 머리의 시각보다 파일 시각이 늦다
});

test('P133: 파일 목록은 sessions/연/월/일의 rollout만(하위 에이전트 파일·보관함 빼고), 같은 대화가 눌린 것과 둘이면 안 눌린 것', async () => {
  const home = tmp();
  writeRollout(home, CID(1), [C.meta(CID(1), 'C:/w')]);
  writeRollout(home, CID(1), [C.meta(CID(1), 'C:/w')], { zst: true });
  writeRollout(home, CID(2), [C.meta(CID(2), 'C:/w')], { zst: true, day: '2026/08/31' });
  writeRollout(home, CID(1), [C.meta(CID(4), 'C:/w')], { child: CID(4) });
  fs.mkdirSync(path.join(home, 'archived_sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, 'archived_sessions', `rollout-2026-08-31T10-00-00-${CID(5)}.jsonl`), C.meta(CID(5), 'C:/w'));
  fs.writeFileSync(path.join(home, 'sessions', '2026', '11', '13', 'notes.txt'), 'x');
  const files = await listCodexFiles(home);
  assert.deepEqual(files.map((f) => [f.convId, path.extname(f.path), f.harness]).sort(), [[CID(1), '.jsonl', 'codex'], [CID(2), '.zst', 'codex']]);
  assert.deepEqual(await listCodexFiles(null), []);
  assert.deepEqual(await listCodexFiles(path.join(home, 'none')), []);
});

test('P133: 제목은 session_index.jsonl의 thread_name(대화마다 마지막 줄), 파일이 같으면 다시 읽지 않는다', () => {
  const home = tmp();
  const f = path.join(home, 'session_index.jsonl');
  fs.writeFileSync(f, [JSON.stringify({ id: CID(1), thread_name: '옛 이름' }), 'bad', JSON.stringify({ id: CID(1).toUpperCase(), thread_name: '새 이름' }), JSON.stringify({ id: CID(2), thread_name: '  ' })].join('\n'));
  const cache = {};
  const m = readCodexTitles(home, cache);
  assert.equal(m.get(CID(1)), '새 이름'); assert.equal(m.has(CID(2)), false);
  assert.equal(readCodexTitles(home, cache), m); // 같은 파일이면 같은 지도
  assert.equal(readCodexTitles(null, {}).size, 0);
});

test('P133: 잠금 파일(thread-writer-locks/<ID>.lock)은 잠겨 있을 때만 "도는 중"이다. 잠기지 않은 남은 파일은 아니다', () => {
  const home = tmp();
  const dir = path.join(home, 'thread-writer-locks');
  fs.mkdirSync(dir, { recursive: true });
  for (const n of [`${CID(1)}.lock`, `${CID(2)}.lock`, '.coordination.lock', 'junk.lock']) fs.writeFileSync(path.join(dir, n), '');
  const held = readCodexLocks(home, { probe: (f) => f.includes(CID(1)) });
  assert.deepEqual([...held], [CID(1)]);
  assert.equal(probeLock(path.join(dir, `${CID(2)}.lock`)), false); // 아무도 잡지 않은 파일
  assert.equal(probeLock(path.join(dir, 'none.lock')), false);
  assert.equal(readCodexLocks(null).size, 0);
});

test('P133: 명령줄 — codex의 resume·fork·exec resume 대화 ID만(claude 줄은 claude 쪽이 읽는다)', () => {
  const rows = [
    { pid: 1, name: 'codex.exe', cmd: `C:\\x\\codex.exe resume ${CID(1)} -c check_for_update_on_startup=false` },
    { pid: 2, name: 'codex.exe', cmd: `codex.exe fork ${CID(2)}` },
    { pid: 3, name: 'codex.exe', cmd: `codex.exe exec resume ${CID(3)} "go"` },
    { pid: 4, name: 'codex.exe', cmd: 'codex.exe app-server --analytics-default-enabled' },
    { pid: 5, name: 'claude.exe', cmd: `claude --resume ${CID(5)} resume ${CID(6)}` },
  ];
  assert.deepEqual([...parseCodexCmdlines(rows).keys()].sort(), [CID(1), CID(2), CID(3)]);
  assert.deepEqual([...parseClaudeCmdlines(rows).keys()], [CID(5)]);
});

test('P133: 묶임 판정 — 명령줄, 잠금(Codex 앱이면 앱), Codex 앱 출처, 모르는 출처, 방금 기록됨. 그 밖에만 열 수 있다', () => {
  const id = CID(1); const now = Date.now(); const old = now - 120000;
  const base = { convId: id, entrypoints: ['cli'], mtime: old, now };
  assert.deepEqual(codexBindingOf(base), { bound: false });
  assert.deepEqual(codexBindingOf({ ...base, entrypoints: ['sdk-codex-exec'] }), { bound: false });
  const p = codexBindingOf({ ...base, procs: new Map([[id, { pid: 42 }]]) });
  assert.equal(p.bound, true); assert.equal(p.where, 'terminal'); assert.equal(p.pid, 42); assert.equal(p.open, true); assert.equal(p.harness, 'codex');
  const l = codexBindingOf({ ...base, locks: new Set([id]) });
  assert.equal(l.where, 'codex'); assert.equal(l.open, true); assert.equal(l.sure, true);
  const dl = codexBindingOf({ ...base, entrypoints: ['codex-desktop'], locks: new Set([id]) });
  assert.equal(dl.where, 'desktop'); assert.equal(dl.open, true);
  const d = codexBindingOf({ ...base, entrypoints: ['codex-desktop'] });
  assert.equal(d.where, 'desktop'); assert.equal(d.sure, true); assert.ok(!d.open);
  const v = codexBindingOf({ ...base, entrypoints: ['codex-vscode'] });
  assert.equal(v.bound, true); assert.equal(v.sure, false);
  assert.equal(codexBindingOf({ ...base, entrypoints: [] }).sure, false);
  const r = codexBindingOf({ ...base, mtime: now - 1000 });
  assert.equal(r.bound, true); assert.equal(r.sure, false);
});

// ---------- 판에 붙이기(Recall) ----------
function fakeBackend({ codexHome, workspaces = [] }) {
  const dataDir = tmp();
  const store = new Store(path.join(dataDir, 'board.db'));
  for (const w of workspaces) store.insertWorkspace({ ...w, createdAt: Date.now() });
  const events = [], calls = [];
  let pane = 0;
  const adapter = {
    connected: true,
    createWorkspace: async ({ cwd, label }) => { pane++; calls.push(['createWorkspace', normPath(cwd), label]); return { workspaceId: `w${pane}`, paneId: `w${pane}:p1` }; },
    waitShellReady: async () => true,
    startAgent: async (a) => { calls.push(['startAgent', a]); return { agent: { name: a.name, launchPending: true }, argv: [a.kind, ...a.args] }; },
    refreshSubscription: async () => {},
  };
  const b = {
    cfg: { convoRoots: [path.join(dataDir, 'no-claude')], codexConvoHome: codexHome, claudeSessionsDir: path.join(dataDir, 'cs'), desktopSessionsDir: null, convoScanMs: 60000, claudeProjects: path.join(dataDir, 'no-claude'), sessionsDir: path.join(dataDir, 'sessions'), hookTimeoutSec: 2, claudeJson: path.join(dataDir, 'none.json'), claudeCommand: 'claude', recoverGraceMs: 50, dataDir },
    store, bus: new EventEmitter(), sessions: new Map(), adapter, events, calls, killing: new Set(),
    api: { broadcast: (ev, data) => events.push([ev, data]) },
    plugin: {}, hookUrl: 'http://127.0.0.1:1/hooks/claude',
    log: () => {}, hooked: (s) => s.rt.hooked !== false, requireTerminal: () => {},
    resolveWorkspace: async (r) => store.getWorkspace(r),
    ensureWorkspace: (ws) => { if (!store.getWorkspace(ws.key)) store.insertWorkspace({ ...ws, createdAt: Date.now() }); },
    withNewPane: async (create, register) => { const r = await create(); await register(r); return r; },
    broadcastSession: (s, o) => events.push(['session', s.name, o && o.cause]),
    probeGit: () => {},
    startHarness: async (s, o) => { calls.push(['startHarness', s.name, s.kind, { ...o }, { ...s.harnessPlan }]); return { agent: { name: s.agentName, launchPending: true }, argv: [s.kind], resumed: !!(o.resume && s.harnessPlan.harnessSessionId) }; },
  };
  return b;
}
const folderWs = (dir) => ({ key: pathKey(dir), kind: 'folder', root: normPath(dir) });
const fakeResolve = (map) => async (cwd) => map[pathKey(cwd)] || folderWs(cwd);

test('P133: 열린 워크스페이스의 Codex 대화를 색인하고 목록·캔버스에 종류(codex)와 제목으로 보인다. 판이 아는 Codex 대화는 뺀다', async () => {
  const home = tmp(); const ws = tmp(); const other = tmp();
  const old = Date.now() - 300000;
  writeRollout(home, CID(1), [C.meta(CID(1), ws), C.user('리포 지시', T(2)), C.answer('리포 답')], { mtime: old });
  writeRollout(home, CID(2), [C.meta(CID(2), other), C.user('열지 않은 곳의 비밀')], { mtime: old });
  writeRollout(home, CID(3), [C.meta(CID(3), ws), C.user('판이 띄운 Codex')], { mtime: old });
  writeRollout(home, CID(4), [C.meta(CID(4), ws, { source: 'vscode', originator: 'Codex Desktop' }), C.user('앱 대화')], { mtime: old });
  fs.writeFileSync(path.join(home, 'session_index.jsonl'), JSON.stringify({ id: CID(1), thread_name: 'Codex가 붙인 이름' }) + '\n');
  const W = folderWs(ws);
  const b = fakeBackend({ codexHome: home, workspaces: [W] });
  b.store.insertSession({ sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'cx1', cwd: ws, permissionMode: 'manual', createdAt: 1, runtime: { term: {} }, kind: 'codex', origin: 'board', workspaceKey: W.key, harnessPlan: { harnessSessionId: CID(3) } });
  const r = new Recall(b, { resolveCwd: fakeResolve({}), readProcs: async () => [] });
  const s = await r.scan({ wait: true });
  assert.equal(s.files, 4); assert.equal(s.read, 4);
  const idx = new Map(b.store.convoIndex().map((c) => [c.convId, c]));
  assert.equal(idx.get(CID(1)).harness, 'codex'); assert.equal(idx.get(CID(1)).title, 'Codex가 붙인 이름'); assert.equal(idx.get(CID(1)).titleSource, 'codex');
  assert.equal(idx.get(CID(2)).firstPrompt, null); // 열지 않은 곳의 글은 남기지 않는다
  assert.ok(b.store.boardConversations().has(CID(3)));
  const convos = await r.convoList();
  const by = Object.fromEntries(convos.map((c) => [c.convId, c]));
  assert.deepEqual(Object.keys(by).sort(), [CID(1), CID(4)]);
  assert.equal(by[CID(1)].harness, 'codex'); assert.equal(by[CID(1)].canOpen, true); assert.equal(by[CID(1)].lastAnswer, '리포 답');
  assert.equal(by[CID(4)].canOpen, false); assert.equal(by[CID(4)].binding.where, 'desktop'); assert.equal(by[CID(4)].canFork, true);
  // 캔버스: cli 대화만 노드(앱 대화는 사이드바에만)
  const nodes = (await r.layoutCanvas()).nodes;
  assert.deepEqual(nodes.map((n) => [n.convId, n.harness]), [[CID(1), 'codex']]);
  // 두 번째 훑기는 다시 읽지 않는다
  assert.equal((await r.scan({ wait: true })).read, 0);
});

test('P133: 판으로 열기 — 묶이지 않은 Codex 대화는 새 판 세션이 그 대화 ID로 이어 간다(codex resume). 도는 codex·잠금·Codex 앱은 거부, 앱 대화는 갈라 열기만', async () => {
  const home = tmp(); const ws = tmp(); const W = folderWs(ws);
  const old = Date.now() - 300000;
  for (const [n, src] of [[1, 'cli'], [2, 'cli'], [3, 'cli'], [4, 'vscode']]) writeRollout(home, CID(n), [C.meta(CID(n), ws, src === 'vscode' ? { source: 'vscode', originator: 'Codex Desktop' } : {}), C.user(`지시 ${n}`)], { mtime: old });
  fs.mkdirSync(path.join(home, 'thread-writer-locks'), { recursive: true });
  fs.writeFileSync(path.join(home, 'thread-writer-locks', `${CID(3)}.lock`), '');
  const b = fakeBackend({ codexHome: home, workspaces: [W] });
  const r = new Recall(b, { resolveCwd: fakeResolve({}), readProcs: async () => [{ pid: 77, name: 'codex.exe', cmd: `codex.exe resume ${CID(2)}` }] });
  await r.scan({ wait: true });
  r.refreshBindings = function () { Recall.prototype.refreshBindings.call(this); this.codexLocks = new Set([CID(3)]); }; // 잠금 읽기(EBUSY)는 가짜로
  await assert.rejects(r.openConvo({ convo: CID(2) }), (e) => e.code === 'bound' && e.binding.pid === 77);
  await assert.rejects(r.openConvo({ convo: CID(3) }), (e) => e.code === 'bound' && e.binding.where === 'codex');
  await assert.rejects(r.openConvo({ convo: CID(4) }), (e) => e.code === 'bound' && e.binding.where === 'desktop');
  await assert.rejects(r.openConvo({ convo: CID(1), fork: true }), (e) => e.key === 'codexConvo.forkOnlyDesktop');
  const out = await r.openConvo({ convo: CID(1), model: 'haiku' });
  assert.equal(out.harness, 'codex'); assert.equal(out.kind, 'codex'); assert.notEqual(out.sessionId, CID(1));
  const st = b.calls.find((c) => c[0] === 'startHarness');
  assert.equal(st[2], 'codex'); assert.equal(st[3].resume, true);
  assert.equal(st[4].harnessSessionId, CID(1)); assert.equal(st[4].model, null); // 사용자 Codex 설정 그대로(판의 Claude 모델은 넘기지 않는다)
  const row = b.store.getSession(out.sessionId);
  assert.equal(row.kind, 'codex'); assert.equal(row.harnessPlan.harnessSessionId, CID(1));
  assert.ok(b.store.boardConversations().has(CID(1)));
  assert.ok(!(await r.convoList()).some((c) => c.convId === CID(1))); // 이제 판이 아는 대화
  // 이미 판 세션이면 그 세션으로 간다
  b.sessions.get(out.sessionId).kind = 'codex';
  const again = await r.openConvo({ convo: CID(1) });
  assert.equal(again.existing, true); assert.equal(again.sessionId, out.sessionId);
  // Codex 앱 대화는 갈라 열기(원본 ID는 forkFrom, 이어 갈 ID는 뜬 뒤에 안다)
  const fk = await r.openConvo({ convo: CID(4), fork: true });
  assert.equal(fk.fork, true);
  const st2 = b.calls.filter((c) => c[0] === 'startHarness')[1];
  assert.equal(st2[4].forkFrom, CID(4)); assert.equal(st2[4].harnessSessionId, null);
});

test('P133: 열기 인자 — resume는 `codex resume <ID>`, 갈라 열기는 `codex fork <ID>`(이어 갈 ID가 있으면 resume가 먼저), 판의 지시문·연결 -c는 그대로', () => {
  const base = { kind: 'codex', sessionId: 's1', instructions: { file: 'f', text: 'INSTR' }, boardEnv: { ATRIUM_PORT: '1' } };
  const a = harnessLaunch({ ...base, resume: true, harnessSessionId: CID(1) });
  assert.deepEqual(a.args.slice(0, 2), ['resume', CID(1)]); assert.ok(a.args.includes('developer_instructions=INSTR')); assert.equal(a.resumed, true);
  const f = harnessLaunch({ ...base, resume: true, harnessSessionId: null, forkFrom: CID(4) });
  assert.deepEqual(f.args.slice(0, 2), ['fork', CID(4)]); assert.equal(f.resumed, false); assert.equal(f.harnessSessionId, null);
  const both = harnessLaunch({ ...base, resume: true, harnessSessionId: CID(5), forkFrom: CID(4) });
  assert.deepEqual(both.args.slice(0, 2), ['resume', CID(5)]);
  const fresh = harnessLaunch({ ...base });
  assert.ok(!['resume', 'fork'].includes(fresh.args[0]));
});

test('P133: 갈라 연 세션의 새 ID 찾기(codexSessionOf)는 원본 ID를 뺀다', () => {
  const home = tmp(); const cwd = tmp(); const now = Date.now();
  const day = new Date(now); const d = `${day.getFullYear()}/${String(day.getMonth() + 1).padStart(2, '0')}/${String(day.getDate()).padStart(2, '0')}`;
  writeRollout(home, CID(4), [C.meta(CID(4), cwd)], { day: d });
  assert.equal(codexSessionOf({ cwd, since: now - 1000, home, now }), CID(4));
  assert.equal(codexSessionOf({ cwd, since: now - 1000, home, now, exclude: [CID(4)] }), null);
  writeRollout(home, CID(6), [C.meta(CID(6), cwd)], { day: d });
  assert.equal(codexSessionOf({ cwd, since: now - 1000, home, now, exclude: [CID(4).toUpperCase()] }), CID(6));
  // 갈라 연 rollout(forked_from_id)만, 또는 갈라 연 것이 아닌 것만
  const fk = JSON.parse(C.meta(CID(7), cwd)); fk.payload.forked_from_id = CID(9);
  writeRollout(home, CID(7), [JSON.stringify(fk)], { day: d });
  assert.equal(codexSessionOf({ cwd, since: now - 1000, home, now, forkedFrom: CID(9) }), CID(7));
  assert.equal(codexSessionOf({ cwd, since: now - 1000, home, now, forkedFrom: CID(8) }), null);
  assert.notEqual(codexSessionOf({ cwd, since: now - 1000, home, now, forkedFrom: null }), CID(7));
  // bornOnly: 그 전에 생긴 파일은 그새 기록됐어도 뺀다
  const later = now + 60000;
  assert.equal(codexSessionOf({ cwd, since: later, home, now: later, bornOnly: true }), null);
});

test('P133: 판이 띄운 Codex 세션(새로 띄움·갈라 열기)의 대화 ID를 뜬 뒤 생긴 rollout에서 배워 판 밖 목록에서 뺀다. 갈라 연 대화의 출처는 source(cli)', async () => {
  const home = tmp(); const ws = tmp(); const W = folderWs(ws);
  const now = Date.now();
  const day = new Date(now); const d = `${day.getFullYear()}/${String(day.getMonth() + 1).padStart(2, '0')}/${String(day.getDate()).padStart(2, '0')}`;
  const b = fakeBackend({ codexHome: home, workspaces: [W] });
  const mk = (sid, name, plan) => { const s = { sessionId: sid, name, cwd: ws, kind: 'codex', origin: 'board', workspaceKey: W.key, rt: { term: {} }, harnessPlan: plan, createdAt: now - 2000 }; b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt }); b.sessions.set(sid, s); return s; };
  const fresh = mk('aaaaaaaa-0000-4000-8000-0000000000f1', 'cx', { harnessSessionId: null, launchedAt: now - 2000 });
  const fork = mk('aaaaaaaa-0000-4000-8000-0000000000f2', 'fk', { harnessSessionId: null, forkFrom: CID(4), launchedAt: now - 2000 });
  // 갈라 연 rollout: originator는 원본(Codex 앱)에서 물려받고 source는 cli
  const fm = JSON.parse(C.meta(CID(5), ws, { source: 'cli', originator: 'Codex Desktop' })); fm.payload.forked_from_id = CID(4);
  writeRollout(home, CID(5), [JSON.stringify(fm), C.user('갈라 연 뒤 지시')], { day: d });
  writeRollout(home, CID(6), [C.meta(CID(6), ws), C.user('판에서 새로 띄운 지시')], { day: d });
  const r = new Recall(b, { resolveCwd: fakeResolve({}), readProcs: async () => [] });
  r.refreshBindings();
  assert.equal(fresh.harnessPlan.harnessSessionId, CID(6)); assert.equal(fork.harnessPlan.harnessSessionId, CID(5));
  assert.equal(b.store.getSession(fork.sessionId).harnessPlan.harnessSessionId, CID(5));
  await r.scan({ wait: true });
  assert.equal(b.store.getConvoById(CID(5)).entrypoints[0], 'cli');
  assert.deepEqual((await r.convoList()).map((c) => c.convId), []); // 둘 다 판이 아는 대화
});

test('P133: missed 지우기는 Codex 대화 기록을 지우지 않는다(Codex의 기록, 판은 읽기만)', () => {
  const root = tmp(); const f = path.join(root, 'x', `${CID(1)}.jsonl`);
  const plan = trashPlan([{ convId: CID(1), path: f, cls: 'missed', binding: { bound: false }, harness: 'codex' }], { roots: [root] });
  assert.deepEqual(plan.refused, [{ convId: CID(1), reason: 'codex' }]); assert.equal(plan.ok.length, 0);
  const plan2 = trashPlan([{ convId: CID(1), path: f, cls: 'missed', binding: { bound: false }, harness: 'claude' }], { roots: [root] });
  assert.equal(plan2.ok.length, 1);
});

test('P133: 설정 — ATRIUM_CODEX_HOME(none이면 끔), 없으면 CODEX_HOME·~/.codex. 시험 판(ATRIUM_CLAUDE_PROJECTS)은 따로 주지 않으면 읽지 않는다', () => {
  const env = { ATRIUM_DATA_DIR: tmp() };
  assert.equal(loadConfig({ argv: [], env: { ...env, CODEX_HOME: 'C:/ch' } }).codexConvoHome, path.resolve('C:/ch'));
  assert.equal(loadConfig({ argv: [], env: { ...env, ATRIUM_CODEX_HOME: 'C:/t' } }).codexConvoHome, path.resolve('C:/t'));
  assert.equal(loadConfig({ argv: [], env: { ...env, ATRIUM_CODEX_HOME: 'none' } }).codexConvoHome, null);
  assert.equal(loadConfig({ argv: [], env: { ...env, ATRIUM_CLAUDE_PROJECTS: 'C:/p' } }).codexConvoHome, null);
  assert.equal(loadConfig({ argv: [], env: { ...env, ATRIUM_CLAUDE_PROJECTS: 'C:/p', ATRIUM_CODEX_HOME: 'C:/t' } }).codexConvoHome, path.resolve('C:/t'));
  assert.equal(loadConfig({ argv: [], env: { ...env } }).codexConvoHome, path.join(os.homedir(), '.codex'));
});
