// P115: 판 ↔ 세션 소통을 하네스 공통으로(하네스 어댑터 표, atrium help 계약, 세션 토큰 파일, 다른 종류 세션의 /branch, 이어 가기)
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
import { workspaceOf } from '../src/git.mjs';
import { Branch, ATRIUM_ALLOW } from '../src/branch.mjs';
import { Recall } from '../src/recall.mjs';
import { ADAPTERS, adapterOf, harnessLaunch, reservedArg, codexSessionOf, harnessResumable, HARNESS_PROMPT } from '../src/harness.mjs';
import { psEnvPrefix, psPathPrefix, psLine, writeHarnessFiles, writeTokenFile, tokenFileOf } from '../src/launch.mjs';
import { CONTRACT_VERSION, VERBS, VERB_NAMES, contractJson, shortHelp } from '../src/cli-contract.mjs';
import { normalizeLauncher, previewLauncher } from '../src/launchers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p115-'));
const SID = '3f6c2a10-5b7e-4d21-9c8a-1e2f3a4b5c6d';
const INSTR = { file: 'C:/d/plugin/harness-system-prompt.md', text: HARNESS_PROMPT };

test('P115 어댑터: codex는 업데이트 확인 끄기·모델·지시문(-c developer_instructions)·추가 인자, 이어 가기는 resume <id>(모를 때는 새로)', () => {
  const a = ADAPTERS.codex.build({ sessionId: SID, model: 'gpt-6-astra', launcherArgs: ['--search'], instructions: INSTR });
  assert.deepEqual(a.args, ['-c', 'check_for_update_on_startup=false', '-m', 'gpt-6-astra', '-c', `developer_instructions=${HARNESS_PROMPT}`, '--search']);
  assert.equal(a.harnessSessionId, null); assert.equal(a.resumed, false);
  const r = ADAPTERS.codex.build({ sessionId: SID, resume: true, harnessSessionId: 'cx-1', instructions: INSTR });
  assert.deepEqual(r.args.slice(0, 2), ['resume', 'cx-1']); assert.equal(r.resumed, true);
  assert.equal(ADAPTERS.codex.build({ sessionId: SID, resume: true, harnessSessionId: null }).resumed, false, '세션 ID를 모르면 새로');
  assert.equal(ADAPTERS.codex.isBoardLine(['node', 'codex.js', 'resume', 'x']), false, 'herdr가 스스로 띄운 이어 가기');
  assert.equal(ADAPTERS.codex.isBoardLine(['node', 'codex.js', '-c', 'developer_instructions=hi']), true);
});

test('P115 어댑터: opencode는 늘 --standalone, 판이 정한 세션 ID(-s ses_<hex>), 지시문 파일·모델은 OPENCODE_CONFIG_CONTENT. pi는 --session-id·--model·--append-system-prompt', () => {
  const o = ADAPTERS.opencode.build({ sessionId: SID, model: 'p/m', instructions: INSTR, launcherArgs: ['--auto'] });
  assert.deepEqual(o.args, ['--standalone', '-s', `ses_${SID.replace(/-/g, '')}`, '--auto']);
  assert.deepEqual(JSON.parse(o.env.OPENCODE_CONFIG_CONTENT), { instructions: [INSTR.file], model: 'p/m' });
  assert.equal(o.harnessSessionId, `ses_${SID.replace(/-/g, '')}`);
  const p = ADAPTERS.pi.build({ sessionId: SID, model: 'prov/m', instructions: INSTR });
  assert.deepEqual(p.args, ['--session-id', SID, '--model', 'prov/m', '--append-system-prompt', INSTR.file]);
  assert.equal(p.harnessSessionId, SID);
  assert.deepEqual(ADAPTERS.pi.build({ sessionId: SID, resume: true, instructions: INSTR }).args.slice(0, 2), ['--session-id', SID], '같은 인자로 이어 간다(있으면 이어 가고 없으면 만든다)');
});

test('P115 어댑터: 표에 없는 종류는 env·PATH만(모델 -m), claude·셸은 어댑터가 없다. 실행 명령이 있으면 그 낱말로 시작한다', () => {
  assert.equal(adapterOf('claude'), null); assert.equal(adapterOf('shell'), null);
  const g = harnessLaunch({ kind: 'grok', sessionId: SID, model: 'g1', launcherArgs: ['--x'], instructions: INSTR, boardEnv: { ATRIUM_PORT: '1' }, binDir: 'C:/d/bin' });
  assert.deepEqual(g.command, ['grok']); assert.deepEqual(g.args, ['-m', 'g1', '--x']); assert.deepEqual(g.env, { ATRIUM_PORT: '1' }); assert.deepEqual(g.pathFirst, ['C:/d/bin']);
  const c = harnessLaunch({ kind: 'codex', startWords: ['wrap', 'codex'], sessionId: SID, boardEnv: { ATRIUM_SESSION_ID: SID } });
  assert.deepEqual(c.command, ['wrap', 'codex']);
  const o = harnessLaunch({ kind: 'opencode', sessionId: SID, boardEnv: { ATRIUM_PORT: '1' }, instructions: INSTR });
  assert.equal(o.env.ATRIUM_PORT, '1'); assert.ok(o.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(harnessResumable({ kind: 'codex', origin: 'board', harnessPlan: {} }), true);
  assert.equal(harnessResumable({ kind: 'codex', origin: 'board' }), false, 'P115 전 세션(다시 띄울 값 없음)');
  assert.equal(harnessResumable({ kind: 'grok', origin: 'board', harnessPlan: {} }), false);
  assert.equal(harnessResumable({ kind: 'pi', origin: 'adopted', harnessPlan: {} }), false);
});

test('P115 친 줄: env는 $env:로, PATH는 앞에 더한다(작은따옴표는 두 번). 안내문에는 줄바꿈과 큰따옴표가 없다', () => {
  assert.equal(psEnvPrefix({ A: "it's", B: '1' }), "$env:A='it''s'; $env:B='1'; ");
  assert.equal(psPathPrefix(["C:\\a'b\\bin"]), "$env:PATH='C:\\a''b\\bin;' + $env:PATH; ");
  assert.equal(psPathPrefix([]), '');
  assert.ok(!/[\r\n"]/.test(HARNESS_PROMPT));
  assert.equal(psLine(['codex', '-c', `developer_instructions=${HARNESS_PROMPT}`]).split('\n').length, 1);
});

test('P115 판이 정하는 인자: 하네스마다(codex resume·-c developer_instructions, opencode -s·--standalone, pi --session-id). 런처 추가 인자와 실행 명령에서 막는다', () => {
  assert.equal(reservedArg('codex', ['resume', 'x']), 'resume');
  assert.equal(reservedArg('codex', ['-c', 'developer_instructions=hi']), '-c developer_instructions=hi');
  assert.equal(reservedArg('codex', ['-cdeveloper_instructions=hi']), '-cdeveloper_instructions=hi');
  assert.equal(reservedArg('codex', ['-c', 'model_reasoning_effort=low']), null);
  assert.equal(reservedArg('opencode', ['--standalone']), '--standalone');
  assert.equal(reservedArg('pi', ['--session-id=1']), '--session-id=1');
  assert.equal(reservedArg('grok', ['--anything']), null);
  assert.throws(() => normalizeLauncher({ name: 'o', harness: 'opencode', args: '-s ses_x' }), (e) => e.key === 'launchers.err.argsReserved');
  assert.throws(() => normalizeLauncher({ name: 'p', harness: 'pi', startCommand: 'wrap pi --session x' }), (e) => e.key === 'launcherStart.reserved');
  assert.equal(normalizeLauncher({ name: 'p', harness: 'pi', startCommand: 'wrap pi' }).startCommand, 'wrap pi');
  assert.equal(previewLauncher(normalizeLauncher({ name: 'p', harness: 'pi', model: 'a/b', args: '--thinking low' })).line, 'pi --model a/b --thinking low');
  assert.equal(previewLauncher(normalizeLauncher({ name: 'o', harness: 'opencode', model: 'a/b' })).line, 'opencode', 'opencode 모델은 설정으로 간다');
});

test('P115 계약: atrium help --json은 계약 버전·동사(+help)·인자·출력·종료 코드. 짧은 사용법은 동사마다 한 줄(P116: 계약 2, prompt·wait·read, 종료 코드 3)', () => {
  const j = contractJson();
  assert.equal(j.contract, CONTRACT_VERSION); assert.equal(CONTRACT_VERSION, 3); // P156: 일 관계로 3
  assert.deepEqual(VERB_NAMES, ['prompt', 'wait', 'read', 'me', 'child', 'relate', 'children', 'child-kill', 'child-wait', 'wake', 'models', 'done', 'item', 'items']); // P180: done·item·items(더하기만)
  assert.ok(VERBS.every((v) => Array.isArray(v.args) && v.does && Array.isArray(v.out)));
  assert.deepEqual(j.exit, { ok: 0, refused: 1, usage: 2, timeout: 3 });
  for (const r of ['Bash(atrium help)', 'Bash(atrium help *)', 'PowerShell(atrium help)', 'Bash(mtask help)']) assert.ok(ATRIUM_ALLOW.includes(r), r); // Claude Code가 묻지 않고 사용법을 읽는다
  const h = shortHelp();
  for (const v of VERBS) assert.ok(h.includes(`atrium ${v.name}`), v.name);
});

test('P115 하네스 파일: 데이터 폴더 bin/에 atrium·mtask, 안내문 파일. 세션 토큰 파일', () => {
  const d = tmp();
  const r = writeHarnessFiles({ dir: path.join(d, 'plugin'), binDir: path.join(d, 'bin'), bin: { atrium: '#!/bin/sh\n', 'atrium.cmd': '@echo off\r\n' }, prompt: HARNESS_PROMPT });
  assert.ok(fs.existsSync(path.join(d, 'bin', 'atrium'))); assert.ok(fs.existsSync(path.join(d, 'bin', 'atrium.cmd')));
  assert.equal(fs.readFileSync(r.promptFile, 'utf8').trim(), HARNESS_PROMPT);
  const f = writeTokenFile(path.join(d, 'sessions'), SID, 'tok');
  assert.equal(f, tokenFileOf(path.join(d, 'sessions'), SID)); assert.equal(fs.readFileSync(f, 'utf8'), 'tok');
});

// ---------- /branch와 atrium 명령: 다른 종류 세션 ----------
async function board() {
  const dir = tmp();
  const store = new Store(path.join(dir, 'board.db'));
  const ws = await workspaceOf(dir);
  store.insertWorkspace({ ...ws, createdAt: 1 });
  const b = {
    cfg: { profile: 'dev', terminalSession: 'atrium-dev-p115test', port: 0, dataDir: dir, sessionsDir: path.join(dir, 'sessions') }, apiToken: 'board-api-token', store, sessions: new Map(), bus: new EventEmitter(),
    spawned: [], links: [], queued: [],
    api: { broadcast: () => {} }, log: () => {}, requireTerminal: () => {},
    hooked: (s) => s.kind === 'claude' && s.origin === 'board',
    summary: () => ({ state: 'ready', ask: null }),
    ensureLink: (from, to, patch) => { const l = { linkId: 'l' + b.links.length, from, to, ...patch }; b.links.push(l); return l; },
    linkEvent: () => ({}),
    queue: { enqueue: (sid, text) => { b.queued.push({ sid, text }); return { deliveryId: 'd' + b.queued.length, status: 'queued' }; } },
    async spawn(p) {
      const id = crypto.randomUUID();
      const s = { sessionId: id, name: p.name, cwd: p.cwd, paneId: `w${b.spawned.length + 2}:p1`, agentName: p.name, model: p.model, kind: p.kind || (p.launcherDef ? p.launcherDef.harness : 'claude'), origin: 'board', parentSessionId: p.parentSessionId || null, workspaceKey: ws.key, rt: newRuntime({ kind: p.kind }), createdAt: Date.now() };
      store.insertSession({ ...s, permissionMode: 'manual', settingsPath: '', hookToken: '', runtime: s.rt });
      b.sessions.set(id, s);
      if (p.branch) b.branch.noteChild(id, p.branch);
      store.setNode({ session_id: id, x: 0, y: 5000 + b.spawned.length * 600, w: 720, h: 460 });
      b.spawned.push(p);
      return { sessionId: id, trust: { needsTrust: false } };
    },
  };
  b.branch = new Branch(b, { readyWaitMs: 30, submitWaitMs: 10 });
  const add = (name, kind, extra = {}) => {
    const s = { sessionId: crypto.randomUUID(), name, cwd: dir, paneId: `${name}:p1`, agentName: name, permissionMode: 'manual', kind, origin: 'board', parentSessionId: null, workspaceKey: ws.key, rt: newRuntime({ kind, hooked: kind === 'claude' }), createdAt: 1, ...extra };
    store.insertSession({ ...s, settingsPath: '', hookToken: '', runtime: s.rt });
    store.setNode({ session_id: s.sessionId, x: 0, y: 0, w: 720, h: 460 });
    b.sessions.set(s.sessionId, s);
    return s;
  };
  return { b, dir, add };
}
function serve(b) {
  const srv = http.createServer((req, res) => { if (!b.branch.handleHttp(req, res)) { res.writeHead(404); res.end(); } });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => { b.cfg.port = srv.address().port; r(srv); }));
}
function runCli(args, env) {
  return new Promise((resolve) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(MTASK_|ATRIUM_)/.test(k)));
    execFile(process.execPath, [path.join(HERE, '..', 'bin', 'atrium-child.mjs'), ...args], { env: { ...clean, ...env }, timeout: 20000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

test('P115 /branch: 다른 종류(codex) 세션도 세션 토큰이면 받는다. 토큰은 env가 아니라 데이터 폴더의 세션 토큰 파일에서 읽는다. 셸은 거부', async () => {
  const { b, add } = await board();
  const cx = add('cx', 'codex', { harnessPlan: { model: 'gpt-6-astra', args: ['--search'], launcher: null, launcherId: null } });
  const srv = await serve(b);
  try {
    const env = b.branch.envFor(cx.sessionId, { token: false });
    assert.equal(env.ATRIUM_SESSION_TOKEN, undefined, '친 줄에는 토큰을 싣지 않는다');
    const none = await runCli(['me'], env);
    assert.equal(none.code, 1); assert.match(none.stderr, /세션 토큰 파일 없음/);
    writeTokenFile(b.cfg.sessionsDir, cx.sessionId, b.branch.token(cx.sessionId));
    const me = await runCli(['me', '--json'], env);
    assert.equal(me.code, 0, me.stderr); assert.equal(JSON.parse(me.stdout).me.name, 'cx');
    // 종류를 주지 않은 하위 세션: 같은 하네스와 부모의 값(모델·추가 인자)을 물려받는다(권한 모드를 옮기지 않는다)
    const ch = await runCli(['child', 'cx-w', '--no-wait', '--json'], env);
    assert.equal(ch.code, 0, ch.stderr);
    const sp = b.spawned.pop();
    assert.equal(sp.launcherDef.harness, 'codex'); assert.equal(sp.launcherDef.model, 'gpt-6-astra'); assert.equal(sp.launcherDef.args, '--search');
    assert.equal(sp.branch.harness.base, 'parent'); assert.deepEqual(sp.branch.harness.approvalArgs, []);
    const help = await runCli(['help', '--json'], {});
    assert.equal(JSON.parse(help.stdout).contract, CONTRACT_VERSION);
    // 셸 세션은 에이전트가 아니다
    const sh = add('sh1', 'shell');
    writeTokenFile(b.cfg.sessionsDir, sh.sessionId, b.branch.token(sh.sessionId));
    const r = await runCli(['me'], b.branch.envFor(sh.sessionId, { token: false }));
    assert.equal(r.code, 1); assert.match(r.stderr, /not_board_session/);
  } finally { srv.close(); b.store.close(); }
});

test('P115 Codex 세션 ID: 그 폴더에서 띄운 뒤 생긴 rollout(첫 줄 session_meta의 id·cwd). 다른 폴더·오래된 것은 아니다', () => {
  const home = tmp(); const now = new Date(2026, 10, 11, 18, 0, 0).getTime();
  const d = new Date(now);
  const dir = path.join(home, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  const write = (id, cwd) => fs.writeFileSync(path.join(dir, `rollout-x-${id}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { session_id: id, id, cwd, base_instructions: { text: 'long' } } }) + '\n');
  // macOS 판: rollout의 cwd는 그 플랫폼의 경로다(POSIX에서 역슬래시는 구분자가 아니다)
  const W = process.platform === 'win32' ? { cx: 'C:\\Workspace\\cx', other: 'C:\\Workspace\\other', ask: 'C:/Workspace/cx/', none: 'C:/Workspace/none' } : { cx: '/Workspace/cx', other: '/Workspace/other', ask: '/Workspace/cx/', none: '/Workspace/none' };
  write('01a1c9f8-920d-7760-9ed1-be1c033841ed', W.cx);
  write('01a1c9f8-0000-7760-9ed1-be1c033841ee', W.other);
  assert.equal(codexSessionOf({ cwd: W.ask, since: Date.now() - 60000, home, now }), '01a1c9f8-920d-7760-9ed1-be1c033841ed');
  assert.equal(codexSessionOf({ cwd: W.none, since: 0, home, now }), null);
});

test('P115 되살리기: herdr 재시작 뒤 판이 띄운 하네스 세션 — 빈 셸이면 판의 줄로 이어 가고, herdr가 스스로 띄운 이어 가기(판의 줄이 아님)는 끄고 판의 줄로', async () => {
  const calls = []; const panes = new Map();
  const store = new Store(path.join(tmp(), 'board.db'));
  const b = {
    cfg: { recoverGraceMs: 50, killWaitMs: 200 }, store, sessions: new Map(), log: () => {}, bus: new EventEmitter(),
    adapter: { connected: true, getPane: async (id) => ({ paneId: id, agent: panes.get(id) || null }), processInfo: async (id) => ({ foreground_processes: [{ argv: panes.get(`${id}#argv`) || [] }] }) },
    ensureAgentName: async (s) => calls.push(['name', s.name]),
    stopHarnessAgent: async (s, steps) => { panes.delete(s.paneId); steps.push('ctrl+c'); calls.push(['stop', s.name]); return true; },
    startHarness: async (s, o) => { calls.push(['start', s.name, o.resume, o.why]); return { agent: null, resumed: true }; },
    broadcastSession: () => {},
  };
  const mk = (name, kind, extra = {}) => { const s = { sessionId: crypto.randomUUID(), name, kind, origin: 'board', paneId: `${name}:p1`, agentName: name, harnessPlan: {}, rt: newRuntime({ kind, hooked: false }), ...extra }; store.insertSession({ ...s, cwd: 'C:/x', permissionMode: 'manual', createdAt: 1, runtime: s.rt }); b.sessions.set(s.sessionId, s); return s; };
  const pi = mk('pi1', 'pi');
  const cx = mk('cx1', 'codex'); cx.rt.term.agentSessionId = 'cx-sid';
  panes.set(cx.paneId, 'codex'); panes.set(`${cx.paneId}#argv`, ['node', 'codex.js', 'resume', 'cx-sid']);
  const ok = mk('cx2', 'codex'); panes.set(ok.paneId, 'codex'); panes.set(`${ok.paneId}#argv`, ['node', 'codex.js', '-c', 'developer_instructions=x']);
  const r = new Recall(b, { timers: false, resolveCwd: async () => null, readProcs: async () => [] });
  await r.recoverHarness([pi, cx, ok]);
  assert.deepEqual(calls.filter((c) => c[1] === 'pi1'), [['start', 'pi1', true, 'start_resume']]);
  assert.deepEqual(calls.filter((c) => c[1] === 'cx1'), [['stop', 'cx1'], ['start', 'cx1', true, 'restart_with_board_line']]);
  assert.equal(cx.harnessPlan.harnessSessionId, 'cx-sid', 'herdr가 안 세션 ID를 남긴다');
  assert.deepEqual(calls.filter((c) => c[1] === 'cx2'), [['name', 'cx2']]);
  store.close();
});
