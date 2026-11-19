// P114 단위 시험: herdr-core(hc) 어댑터. 순수 함수(상태 대응, 이벤트 바꾸기, env, 키, 프레임), 고정 버전, 판의 어댑터 만들기,
// 가짜 hc 코어(test/fake-hc.mjs)로 돌린 어댑터(이벤트, 보내기, 키, 화면 스트림, 짧은 끊김, 에이전트로 바꿔 띄우기)와 중계의 판 밖 크기 주인
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { statusWord, statusDetail, kindOfApp, workspaceOf, HcModel, terminalEnv, keysToBytes, hcName, agentInfoOf, findTerminal, LABEL } from '../src/hc/model.mjs';
import { FrameDecoder, encodeFrame, FRAME, FramedConn, hcPipe, rpcError } from '../src/hc/rpc.mjs';
import { hcCompat, coreEnv, boardConfigText, writeBoardConfig, hcConfigFile } from '../src/hc/core.mjs';
import { ensureHc, HC_PIN, hcBinDir, parseHcVersion, HC_FILES } from '../src/hc/pin.mjs';
const WIN = process.platform === 'win32';
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pathStarts = (...dirs) => new RegExp('^' + dirs.map(reEsc).join(reEsc(path.delimiter)) + reEsc(path.delimiter)); // macOS 판: PATH는 ':'로 잇는다
import { HcAdapter, holderIdentity } from '../src/hc/adapter.mjs';
import { createTerminalAdapter } from '../src/terminal-backend.mjs';
import { Settings, normalizePatch } from '../src/settings.mjs';
import { TerminalRelay } from '../src/relay.mjs';
import { shareEmpty, shareJoin, shareLeave, shareExternal, shareOwnerView, EXTERNAL_OWNER } from '../src/multiclient.mjs';
import { startFakeHc, FIRST_PAINT } from './fake-hc.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(20); } throw new Error('timed out'); };

test('P114 상태: 7501 → herdr 낱말(error는 done, 없음은 unknown), 앱 이름 → 종류', () => {
  assert.equal(statusWord({ app: 'claude-code', state: 'idle' }), 'idle');
  assert.equal(statusWord({ state: 'working' }), 'working');
  assert.equal(statusWord({ state: 'blocked', kind: 'permission' }), 'blocked');
  assert.equal(statusWord({ state: 'done' }), 'done');
  assert.equal(statusWord({ state: 'error' }), 'done');
  assert.equal(statusWord({ state: 'thinking' }), 'unknown');
  assert.equal(statusWord(null), 'unknown');
  assert.deepEqual(statusDetail({ app: 'claude-code', state: 'blocked', kind: 'permission', msg: 'approve Bash: ping' }), { state: 'blocked', app: 'claude-code', kind: 'permission', msg: 'approve Bash: ping' });
  assert.equal(kindOfApp('claude-code'), 'claude');
  assert.equal(kindOfApp('codex'), 'codex');
  assert.equal(kindOfApp(null), null);
  assert.equal(hcName('l4-cl'), 'l4-cl');
  assert.equal(hcName('My Session'), null);
  assert.equal(hcName('x'.repeat(33)), null);
});

test('P114 작업 공간: 라벨, 부모의 작업 공간, 없으면 터미널마다', () => {
  const a = { address: 't1', labels: { [LABEL.ws]: 'hw-a' } };
  const b = { address: 't2', parent: 't1', labels: {} };
  const c = { address: 't3', labels: {} };
  const by = new Map([a, b, c].map((t) => [t.address, t]));
  assert.equal(workspaceOf(a, by), 'hw-a');
  assert.equal(workspaceOf(b, by), 'hw-a');
  assert.equal(workspaceOf(c, by), 'hw-t3');
  const t = { address: 't9', name: 'w1', state: 'live', labels: { [LABEL.name]: 'worker', [LABEL.session]: 'sid-1' }, status: { app: 'claude-code', state: 'blocked', msg: 'q' }, cwd: 'C:/p' };
  const info = agentInfoOf(t, new Map());
  assert.equal(info.name, 'worker'); assert.equal(info.agent, 'claude'); assert.equal(info.status, 'blocked'); assert.equal(info.agentSessionId, 'sid-1'); assert.equal(info.detail.msg, 'q');
  assert.equal(agentInfoOf({ ...t, status: null }, new Map()), null);
  assert.equal(findTerminal([t], 'worker').address, 't9');
  assert.equal(findTerminal([t], 'w1').address, 't9');
  assert.equal(findTerminal([{ ...t, state: 'finished' }], 't9'), null);
});

test('P114 이벤트 바꾸기: 셸 생김·끝, 에이전트 나타남·상태·놓임, 지움, 놓친 이벤트', () => {
  const m = new HcModel();
  m.load([]);
  const types = (evs) => evs.map((e) => e.type);
  const shell = { address: 't1', state: 'live', labels: {}, status: null, cwd: 'C:/a', pid: 11 };
  assert.deepEqual(types(m.apply({ type: 'created', terminal: 't1', data: shell })), ['pane_created']);
  assert.deepEqual(types(m.apply({ type: 'finished', terminal: 't1', data: { reason: 'exited', exit_code: 0 } })), ['pane_exited', 'terminal_finished']);
  const ag = { address: 't2', state: 'live', labels: { [LABEL.ws]: 'hw-x' }, status: null, cwd: 'C:/b', pid: 12 };
  m.apply({ type: 'created', terminal: 't2', data: ag });
  const d = m.apply({ type: 'status', terminal: 't2', data: { status: { app: 'claude-code', state: 'idle' }, reported: true } });
  assert.deepEqual(types(d), ['agent_detected', 'status']);
  assert.equal(d[0].agent, 'claude'); assert.equal(d[0].workspaceId, 'hw-x'); assert.equal(d[1].status, 'idle');
  const b = m.apply({ type: 'status', terminal: 't2', data: { status: { app: 'claude-code', state: 'blocked', kind: 'permission', msg: 'approve Bash: x' }, reported: true } });
  assert.deepEqual(types(b), ['status']); assert.equal(b[0].status, 'blocked'); assert.equal(b[0].detail.kind, 'permission');
  // 에이전트가 끝나 상태를 지우고 터미널이 끝남: 놓임 한 번, 그다음 패널 끝(agent: true)
  assert.deepEqual(types(m.apply({ type: 'status', terminal: 't2', data: { status: null, reported: true } })), ['agent_released']);
  const fin = m.apply({ type: 'finished', terminal: 't2', data: { reason: 'exited', exit_code: 0 } });
  assert.deepEqual(types(fin), ['pane_exited', 'terminal_finished']);
  assert.equal(fin[0].agent, true);
  assert.deepEqual(types(m.apply({ type: 'removed', terminal: 't2', data: {} })), []); // 이미 끝난 터미널을 지움
  // 코어가 꺼져 끝난 셸(server_stop): 패널 끝을 내지 않는다(판은 끊김으로 다루고 다시 붙으면 되살린다)
  m.apply({ type: 'created', terminal: 't3', data: { address: 't3', state: 'live', labels: {}, status: null, pid: 13 } });
  assert.deepEqual(types(m.apply({ type: 'finished', terminal: 't3', data: { reason: 'server_stop', exit_code: null } })), ['terminal_finished']);
  // 놓친 이벤트: 스냅숏과 견주기
  const m2 = new HcModel();
  m2.load([{ address: 't5', state: 'live', labels: {}, status: { app: 'codex', state: 'working' }, pid: 5 }, { address: 't6', state: 'live', labels: {}, status: null, pid: 6 }]);
  const diff = m2.diff([{ address: 't5', state: 'live', labels: {}, status: { app: 'codex', state: 'idle' }, pid: 5 }, { address: 't7', state: 'live', labels: {}, status: null, pid: 7 }]);
  assert.deepEqual(types(diff), ['status', 'pane_closed', 'pane_created']);
  assert.equal(diff[0].status, 'idle');
});

test('P114 터미널 env: PATH 앞에 판의 hc 폴더, XDG_CONFIG_HOME은 빈 값', () => {
  const e = terminalEnv({ exeDir: 'C:\\b\\hc\\bin', basePath: 'C:\\Windows;C:\\b\\hc\\bin\\;C:\\x', platform: 'win32' }); // macOS 판: Windows 규칙은 platform으로 고정해 본다
  assert.equal(e.PATH, 'C:\\b\\hc\\bin;C:\\Windows;C:\\x');
  assert.equal(e.XDG_CONFIG_HOME, '');
  // 2b: 판의 env(extra)의 PATH는 기본 PATH가 되고, pathFirst(판 bin/)가 맨 앞, 그다음 판의 hc 폴더. XDG_CONFIG_HOME은 extra에 있어도 빈 값
  const h = terminalEnv({ exeDir: 'C:\\h', basePath: 'C:\\w', extra: { Path: 'C:\\only', FOO: 1, ATRIUM_SESSION_ID: 's1', XDG_CONFIG_HOME: 'C:\\leak' }, pathFirst: ['C:\\data\\bin'], platform: 'win32' });
  assert.equal(h.PATH, 'C:\\data\\bin;C:\\h;C:\\only');
  assert.equal(h.FOO, '1'); assert.equal(h.ATRIUM_SESSION_ID, 's1'); assert.equal(h.XDG_CONFIG_HOME, '');
  assert.equal(terminalEnv({ extra: { FOO: 1 } }).FOO, '1');
  // macOS 판: ':'로 잇고 끝 / 차이는 같은 폴더로 본다. 사용자가 정한 XDG_CONFIG_HOME이 있으면 되돌리고, 없으면 빈 값(판의 hc 설정 폴더가 새지 않게)
  assert.equal(terminalEnv({ exeDir: '/b/hc/bin', basePath: '/usr/bin:/b/hc/bin/:/x', platform: 'darwin', userXdgConfig: '' }).PATH, '/b/hc/bin:/usr/bin:/x');
  const m = terminalEnv({ exeDir: '/h', basePath: '/w', extra: { PATH: '/only', XDG_CONFIG_HOME: '/leak' }, pathFirst: ['/data/bin'], platform: 'darwin', userXdgConfig: '' });
  assert.equal(m.PATH, '/data/bin:/h:/only'); assert.equal(m.XDG_CONFIG_HOME, '');
  assert.equal(terminalEnv({ exeDir: '/h', platform: 'darwin', userXdgConfig: '/Users/u/.config' }).XDG_CONFIG_HOME, '/Users/u/.config');
});

test('P114 키: 이름 → 바이트, 모르는 키가 있으면 null', () => {
  assert.deepEqual(keysToBytes(['up', 'down', 'enter', 'esc', 'tab', 'space', '1']), ['\x1b[A', '\x1b[B', '\r', '\x1b', '\t', ' ', '1']);
  assert.deepEqual(keysToBytes(['shift+tab', 'ctrl+c']), ['\x1b[Z', '\x03']);
  assert.equal(keysToBytes(['f5']), null);
});

test('P114 프레임: 조각나도 모으고, 한 덩어리의 여러 프레임을 나눈다', () => {
  const a = encodeFrame(3, FRAME.DATA, Buffer.from('hello'));
  const b = encodeFrame(0, FRAME.DATA, Buffer.from('{"id":1}'));
  const d = new FrameDecoder();
  assert.deepEqual(d.push(a.subarray(0, 4)), []);
  const got = d.push(Buffer.concat([a.subarray(4), b]));
  assert.deepEqual(got.map((f) => [f.ch, f.kind, f.payload.toString()]), [[3, 0, 'hello'], [0, 0, '{"id":1}']]);
  if (process.platform === 'win32') assert.match(hcPipe('atrium-dev-p114', { USERNAME: 'user_01 x' }), /^\\\\\.\\pipe\\herdr-core-user01x-atrium-dev-p114\.sock$/);
  else { assert.equal(hcPipe('atrium-dev-p114', {}, { root: '/d/hc' }), '/d/hc/run/atrium-dev-p114.sock'); assert.equal(hcPipe('atrium-dev-p114', { HC_SOCKET: '/x.sock' }), '/x.sock'); } // macOS 판
  const e = rpcError('terminal.send', { message: 't9 is blocked', data: { kind: 'blocked', hint: 'h' } });
  assert.equal(e.code, 'agent_blocked'); assert.equal(e.kind, 'blocked');
  assert.equal(rpcError('x', { message: 'm', data: { kind: 'not_found' } }).code, 'agent_not_found');
});

test('P114 버전 정책·코어 env·판 설정(notes = false)', () => {
  const pong = (v, g = 1, f = ['framed', 'attach', 'events', 'status']) => ({ type: 'pong', version: v, protocol: g, capabilities: { features: f } });
  const ok = hcCompat(pong('0.1.20'), { generations: [1], tested: ['0.1.20'] });
  assert.equal(ok.ok, true); assert.equal(ok.level, 'ok'); assert.equal(ok.hcVersion, '0.1.20');
  assert.equal(ok.version, null); // 판의 herdr 업데이트 알림이 hc 버전과 견주지 않게
  assert.equal(hcCompat(pong('0.1.21'), { generations: [1], tested: ['0.1.20'] }).level, 'untested');
  assert.equal(hcCompat(pong('0.2.0', 2), { generations: [1], tested: [] }).level, 'incompatible');
  assert.equal(hcCompat(pong('0.1.20', 1, ['framed']), { generations: [1], tested: [] }).ok, false);
  // macOS 판: 코어 env에 판이 정한 Unix 소켓(HC_SOCKET, 사용자 값이 아니라 판 데이터 폴더 안)을 넣고 그 폴더를 만든다. 그래서 시험은 임시 폴더를 준다
  const cfgDir = process.platform === 'win32' ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'p114-core-'));
  const configHome = cfgDir ? path.join(cfgDir, 'hc', 'config') : 'C:\\d\\hc\\config';
  const env = coreEnv({ PATH: 'C:\\w', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', HERDR_ENV: '1', ATRIUM_PORT: '1', HC_SESSION: 'user', HC_SOCKET: 's', XDG_CONFIG_HOME: 'u', USERPROFILE: 'C:\\U' }, { session: 'atrium-dev-x', configHome });
  assert.deepEqual(Object.keys(env).sort(), ['HC_SESSION', ...(cfgDir ? ['HC_SOCKET'] : []), 'PATH', 'USERPROFILE', 'XDG_CONFIG_HOME']);
  assert.equal(env.HC_SESSION, 'atrium-dev-x'); assert.equal(env.XDG_CONFIG_HOME, configHome);
  if (cfgDir) { assert.equal(env.HC_SOCKET, path.join(cfgDir, 'hc', 'run', 'atrium-dev-x.sock')); fs.rmSync(cfgDir, { recursive: true, force: true }); }
  assert.match(boardConfigText(), /^notes = false$/m);
  assert.match(boardConfigText(), /^draft_wait = 0$/m); // 2b: 판의 전달 규칙(3초)과 같게
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p114-cfg-'));
  try { const f = writeBoardConfig(dir); assert.equal(f, hcConfigFile(dir)); assert.match(fs.readFileSync(f, 'utf8'), /notes = false/); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('P114 고정 버전: 받은 것이 SHA-256과 다르면 버리고, 이미 놓인 고정 버전은 받지 않는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p114-pin-'));
  try {
    let fetched = 0;
    const fetchImpl = async () => { fetched++; return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('not the release') }; };
    await assert.rejects(ensureHc({ dataDir: dir, fetchImpl }), (e) => e.code === 'checksum_mismatch');
    assert.equal(fetched, 1);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'hc')), []); // staging을 지웠다
    // 놓인 고정 버전(VERSION과 세 파일)이 있으면 받지 않는다
    const bin = hcBinDir(dir);
    for (const f of HC_FILES) { fs.mkdirSync(path.dirname(path.join(bin, f)), { recursive: true }); fs.writeFileSync(path.join(bin, f), 'x'); } // Windows 세 파일, macOS 단독 실행 파일 하나
    fs.writeFileSync(path.join(bin, 'VERSION'), HC_PIN.version + '\n');
    const r = await ensureHc({ dataDir: dir, fetchImpl });
    assert.equal(r.source, 'installed'); assert.equal(r.version, HC_PIN.version); assert.equal(fetched, 1);
    assert.ok(fs.existsSync(path.join(bin, WIN ? 'hc.exe' : 'hc')) || fs.lstatSync(path.join(bin, 'hc')).isSymbolicLink());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(parseHcVersion('hc 0.1.20\n'), '0.1.20');
  assert.match(HC_PIN.sha256, /^[0-9a-f]{64}$/);
});

test('P114·P129 판의 어댑터: 터미널 백엔드는 hc 하나. 숨은 설정 terminalBackend는 없다', () => {
  const cfg = { terminalSession: 'atrium-dev-x', dataDir: 'C:\\d', logDir: 'C:\\d\\logs' };
  const hc = createTerminalAdapter(cfg, { env: { USERNAME: 'u' } });
  assert.ok(hc instanceof HcAdapter);
  assert.equal(hc.backend, 'hc');
  // macOS 판: 판 데이터 폴더의 Unix 소켓과 단독 실행 파일 herdr-core
  assert.equal(hc.pipe, WIN ? '\\\\.\\pipe\\herdr-core-u-atrium-dev-x.sock' : path.join('C:\\d', 'hc', 'run', 'atrium-dev-x.sock'));
  assert.equal(hc.exePath, path.join('C:\\d', 'hc', 'bin', WIN ? 'herdr-core.exe' : 'herdr-core'));
  assert.equal(createTerminalAdapter(cfg, { env: { USERNAME: 'u', ATRIUM_HC: 'D:\\x\\hc.exe' } }).exePath, 'D:\\x\\hc.exe'); // ATRIUM_HC로 바꾼다
  // P117: 숨은 설정 terminalBackend는 없앴다(판 기록 meta terminalBackend와 옮기기가 정한다)
  assert.throws(() => normalizePatch({ terminalBackend: 'hc' }));
  const store = { meta: {}, getMeta(k) { return this.meta[k]; }, setMeta(k, v) { this.meta[k] = v; } };
  const s = new Settings({ store, broadcast: () => {} });
  assert.equal('terminalBackend' in s.get(), false);
  assert.equal('terminalBackend' in s.describe(), false);
});

test('P114 어댑터(가짜 hc): 붙기, 셸 작업 공간, 상태 이벤트, 보내기와 막힘, 키, 이름, 스냅숏', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p114-unit', dataDir: null, pipe: fake.pipe, env: { PATH: 'C:\\Windows' } });
  a.exeDir = 'C:\\board\\hc\\bin';
  const events = [];
  a.on('event', (e) => events.push(e));
  try {
    const p = await a.probe();
    assert.equal(p.running, true); assert.equal(a.serverPid(), 4343); // 2b: 코어가 아니라 holder(프로그램이 산 동안 같다)
    assert.equal(a.checkCompat(p.pong).ok, true);
    a.startEvents();
    await until(() => a.connected);
    const ws = await a.createWorkspace({ cwd: 'C:/w', label: 'demo' });
    assert.match(ws.workspaceId, /^hw-/);
    const t = fake.terms.get(ws.paneId);
    assert.equal(t.labels[LABEL.ws], ws.workspaceId);
    assert.equal(t.env.XDG_CONFIG_HOME, '');
    assert.match(t.env.PATH, pathStarts('C:\\board\\hc\\bin'));
    await until(() => events.find((e) => e.type === 'pane_created' && e.paneId === ws.paneId));
    // 판 밖에서 띄운 에이전트(예: 에이전트가 hc run으로): 나타남과 상태
    const r = fake.create({ argv: ['claude', '--model', 'haiku'], name: 'w1', cwd: 'C:/w' }).result;
    await until(() => events.find((e) => e.type === 'agent_detected' && e.paneId === r.address));
    assert.equal(events.find((e) => e.type === 'agent_detected' && e.paneId === r.address).agent, 'claude');
    const snap = await a.snapshot();
    assert.deepEqual(snap.panes.map((x) => [x.paneId, x.agent, x.status]).sort(), [[ws.paneId, null, 'unknown'], [r.address, 'claude', 'idle']].sort());
    assert.equal((await a.listAgents()).length, 1);
    // 보내기: 막혔으면 agent_blocked(전달 대기열은 waiting으로 물러난다)
    await a.prompt('w1', 'hello\r\nsecond');
    assert.deepEqual(fake.terms.get(r.address).sent, ['hello\nsecond']);
    fake.setStatus(r.address, { app: 'claude-code', state: 'blocked', kind: 'permission', msg: 'approve Bash: ping' });
    await until(() => events.find((e) => e.type === 'status' && e.status === 'blocked'));
    await assert.rejects(a.prompt('w1', 'x'), (e) => e.code === 'agent_blocked');
    await assert.rejects(a.prompt(ws.paneId, 'x'), (e) => e.code === 'agent_not_found'); // 셸에는 보내지 않는다
    await assert.rejects(a.prompt('nobody', 'x'), (e) => e.code === 'agent_not_found');
    // 키 패드: 붙은 스트림이 없으면 잠깐 붙어 attach DATA로 바로
    const k = await a.paneKeys(r.address, ['up', 'enter']);
    assert.equal(k.via, 'attach');
    await until(() => fake.terms.get(r.address).inputs.join('') === '\x1b[A\r');
    assert.deepEqual(fake.terms.get(r.address).keys, []);
    await a.paneKeys(r.address, ['f5']); // 모르는 키는 hc terminal.keys
    assert.deepEqual(fake.terms.get(r.address).keys, ['f5']);
    // 이름 붙이기는 라벨로
    const named = await a.renameAgent(r.address, 'Worker One');
    assert.equal(named.name, 'Worker One');
    assert.equal((await a.getAgent('Worker One')).paneId, r.address);
    const info = await a.processInfo(r.address);
    assert.equal(info.shell_pid, fake.terms.get(r.address).pid);
    assert.match(await a.readScreen(ws.paneId, { source: 'visible' }), /PS /);
    assert.equal(await a.waitShellReady(ws.paneId, 1000), true);
    // 패널 닫기 = kill + rm
    await a.closePane(ws.paneId);
    assert.equal(fake.terms.has(ws.paneId), false);
    assert.equal(a.readClients().available, false);
  } finally { a.stopEvents(); await fake.close(); }
});

test('P114 화면 스트림(가짜 hc): 첫 화면을 full로(응답과 한 덩어리여도), CREDIT, 입력, 같은 크기 resize는 새 첫 화면, 끝나면 exit', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p114-unit', dataDir: null, pipe: fake.pipe, env: {}, moveWaitMs: 100 });
  try {
    const t = fake.create({ argv: ['pwsh'] }).result;
    const c = a.openController(t.address, 100, 30);
    const frames = [];
    c.on('frame', (f) => frames.push(f));
    await until(() => frames.length >= 1);
    assert.equal(frames[0].full, true);
    assert.equal(Buffer.from(frames[0].bytes, 'base64').toString(), FIRST_PAINT);
    assert.deepEqual([frames[0].width, frames[0].height], [100, 30]);
    assert.match(String(c.pid), /^hc:/);
    fake.output(t.address, 'more');
    await until(() => frames.length >= 2);
    assert.equal(frames[1].full, false);
    await until(() => fake.streamsOf(t.address)[0] && fake.streamsOf(t.address)[0].credit === FIRST_PAINT.length + 4);
    c.input('ls\r');
    await until(() => fake.terms.get(t.address).inputs.join('') === 'ls\r');
    // 키 패드는 붙은 스트림으로
    assert.equal((await a.paneKeys(t.address, ['esc'])).via, 'stream');
    c.resize(120, 40);
    await until(() => fake.terms.get(t.address).cols === 120);
    c.resize(120, 40); // 같은 크기: 다시 붙어 새 첫 화면
    await until(() => frames.filter((f) => f.full).length === 2);
    assert.equal(c.stats.attaches, 2);
    const exit = new Promise((r) => c.once('exit', r));
    const recs = [];
    c.on('record', (m) => recs.push(m));
    fake.finish(t.address, 'exited', 0);
    assert.equal(await exit, 'exited');
    assert.equal(recs[0].reason, 'exited');
  } finally { await fake.close(); }
});

test('P114 화면 스트림 묶기: 잇달아 온 작은 DATA는 한 프레임(순서 그대로), 쉬다 온 첫 덩어리는 바로', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p114-unit', dataDir: null, pipe: fake.pipe, env: {}, moveWaitMs: 100 });
  try {
    const t = fake.create({ argv: ['pwsh'] }).result;
    const c = a.openController(t.address, 80, 24);
    const frames = [];
    c.on('frame', (f) => frames.push(Buffer.from(f.bytes, 'base64').toString()));
    await until(() => frames.length === 1);
    await sleep(30);
    for (const ch of 'echo hi') fake.output(t.address, ch); // 타자 메아리처럼 글자 하나씩
    await until(() => frames.join('').endsWith('echo hi'));
    assert.ok(frames.length - 1 <= 2, `coalesced into ${frames.length - 1} frames`);
    assert.equal(frames.slice(1).join(''), 'echo hi');
    c.close();
  } finally { await fake.close(); }
});

test('P114 짧은 끊김(코어 재시작): disconnected 없이 다시 구독하고, 그새 바뀐 것을 이벤트로, 스트림은 다시 붙는다', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p114-unit', dataDir: null, pipe: fake.pipe, env: {}, graceMs: 3000 });
  const seen = [];
  a.on('event', (e) => seen.push(e.type));
  a.on('disconnected', () => seen.push('DISCONNECTED'));
  try {
    const t = fake.create({ argv: ['claude'], name: 'cl' }).result;
    await sleep(60);
    a.startEvents();
    await until(() => a.connected);
    const c = a.openController(t.address, 80, 24);
    const frames = [];
    c.on('frame', (f) => frames.push(f));
    await until(() => frames.length === 1);
    fake.dropAll(); // 코어가 다시 뜬다(연결이 모두 끊긴다, 프로그램은 산다)
    fake.terms.get(t.address).status = { app: 'claude-code', state: 'working' }; // 끊긴 사이에 바뀜
    await until(() => frames.filter((f) => f.full).length === 2, 5000);
    await until(() => seen.includes('status'), 5000);
    assert.equal(seen.includes('DISCONNECTED'), false);
    assert.equal(a.connected, true);
    c.close();
  } finally { a.stopEvents(); await fake.close(); }
});

test('P114 서버 끔(server.stop): 패널 끝 없이 곧바로 disconnected, 다시 뜨면 connected(판이 되살린다)', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p114-unit', dataDir: null, pipe: fake.pipe, env: {}, graceMs: 5000 });
  const seen = [];
  a.on('event', (e) => seen.push(e.type));
  a.on('disconnected', () => seen.push('DISCONNECTED'));
  a.on('connected', () => seen.push('CONNECTED'));
  try {
    fake.create({ argv: ['pwsh'] });
    a.startEvents();
    await until(() => a.connected);
    fake.create({ argv: ['claude'], labels: { 'atrium-board': '1' } }); // 2b: 코어가 끄면 상태를 먼저 지운다. 그 놓임은 내지 않는다(끊김으로)
    await until(() => seen.includes('agent_detected'));
    const t0 = Date.now();
    await a.call('server.stop', {}); // 가짜 코어는 끈 뒤 곧바로 다시 받는다(stopServer는 꺼질 때까지 기다리므로 직접 부른다)
    await until(() => seen.includes('DISCONNECTED'), 3000);
    assert.ok(Date.now() - t0 < 3000, 'no grace wait for a core that ended its terminals');
    assert.equal(seen.includes('pane_exited'), false);
    await sleep(400);
    assert.equal(seen.includes('agent_released'), false);
    await until(() => seen.filter((x) => x === 'CONNECTED').length === 2, 5000); // 가짜는 끊긴 뒤 곧 다시 받는다(코어가 다시 뜬 것)
  } finally { a.stopEvents(); await fake.close(); }
});

test('P114 에이전트로 바꿔 띄우기: pane_moved가 먼저, 옛 셸 자리의 끝은 내지 않고, 새 터미널은 판에 올리지 않는다', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p114-unit', dataDir: null, pipe: fake.pipe, env: {}, moveWaitMs: 100 });
  const ev = [];
  a.on('event', (e) => ev.push(e));
  try {
    a.startEvents();
    await until(() => a.connected);
    const ws = await a.createWorkspace({ cwd: 'C:/w' });
    await until(() => ev.find((e) => e.type === 'pane_created'));
    ev.length = 0;
    const r = await a.startAgent({ name: 'lead', paneId: ws.paneId, args: ['--model', 'haiku'], kind: 'claude' });
    assert.equal(r.replacedPane, ws.paneId);
    assert.deepEqual(r.argv, ['claude', '--model', 'haiku']);
    const nt = fake.terms.get(r.agent.paneId);
    assert.equal(nt.name, 'lead'); assert.equal(nt.labels[LABEL.ws], ws.workspaceId); assert.equal(nt.labels[LABEL.name], 'lead');
    await until(() => ev.find((e) => e.type === 'agent_detected'));
    const order = ev.map((e) => `${e.type}:${e.paneId}`);
    assert.equal(order[0], `pane_moved:${r.agent.paneId}`);
    assert.equal(ev[0].previousPaneId, ws.paneId);
    assert.equal(order.some((x) => x.startsWith('pane_created')), false);
    assert.equal(order.some((x) => x.endsWith(`:${ws.paneId}`)), false); // 옛 자리의 끝 이벤트 없음
    assert.equal(fake.terms.has(ws.paneId), false);
  } finally { a.stopEvents(); await fake.close(); }
});

test('P114 중계: 판 밖 보는 이가 크기를 가지면 모두 주인이 아니고, 들어오고 나가도 그대로, 돌아오면 풀린다', () => {
  let st = shareJoin(shareEmpty(), { key: 'a', clientId: 'A', cols: 100, rows: 30, now: 1 });
  st = shareExternal(st, { cols: 200, rows: 50 });
  assert.equal(shareOwnerView(st).clientId, EXTERNAL_OWNER);
  st = shareJoin(st, { key: 'b', clientId: 'B', cols: 90, rows: 20, now: 2 });
  st = shareLeave(st, 'b');
  assert.deepEqual(st.external, { cols: 200, rows: 50 });
  assert.equal(shareExternal(st, null).external, null);
  const e0 = shareEmpty();
  assert.equal(shareExternal(e0, null), e0); // herdr 경로: 바뀌지 않는다
  // 중계: 제어기의 size(external) → terminal.owner(ownerIsMe 거짓, 함께 보는 수 +1)
  const ctl = Object.assign(new EventEmitter(), { pid: 'hc:1', exited: null, resize() {}, input() {}, close() {}, focus(on) { this.focused = on; } });
  const relay = new TerminalRelay({ adapter: { openController: () => ctl }, onInput: () => {} });
  const sent = [];
  const client = { clientId: 'A', sendEvent: (n, d) => sent.push([n, d]) };
  relay.attach({ sessionId: 's1', paneId: 't1' }, 100, 30, client);
  ctl.emit('size', { cols: 200, rows: 50, external: true });
  const own = sent.filter(([n]) => n === 'terminal.owner').pop()[1];
  assert.equal(own.ownerIsMe, false); assert.equal(own.owner, EXTERNAL_OWNER); assert.equal(own.shared, 2); assert.deepEqual([own.cols, own.rows], [200, 50]);
  relay.focus('s1', client);
  assert.equal(ctl.focused, true);
  ctl.emit('size', { cols: 100, rows: 30, external: false });
  const back = sent.filter(([n]) => n === 'terminal.owner').pop()[1];
  assert.equal(back.ownerIsMe, true); assert.equal(back.shared, 1);
});

// ---------- P114 2b ----------
test('P114 2b 세션 시작: 셸 자리 → 첫 argv 에이전트(판의 env, pathFirst, XDG 빈 값), 끝나면 같은 자리에 셸(pane_moved), 화면 스트림은 옮겨 붙음', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p114-unit', dataDir: null, pipe: fake.pipe, env: { PATH: 'C:\\Windows' }, moveWaitMs: 2000 });
  a.exeDir = 'C:\\board\\hc\\bin';
  const ev = [];
  a.on('event', (e) => ev.push(e));
  try {
    a.startEvents();
    await until(() => a.connected);
    const ws = await a.createWorkspace({ cwd: 'C:/w', label: 'demo' });
    assert.equal(fake.terms.get(ws.paneId).labels['atrium-board'], '1');
    const r = await a.startAgent({ name: 'cx', paneId: ws.paneId, args: ['resume', 'x'], kind: 'codex', command: ['codex'], env: { ATRIUM_SESSION_ID: 'sid-1', OPENCODE_CONFIG_CONTENT: '{}' }, pathFirst: ['C:\\data\\bin'] });
    const nt = fake.terms.get(r.agent.paneId);
    assert.deepEqual(nt.argv, ['codex', 'resume', 'x']);
    assert.equal(nt.env.ATRIUM_SESSION_ID, 'sid-1'); assert.equal(nt.env.XDG_CONFIG_HOME, '');
    assert.match(nt.env.PATH, pathStarts('C:\\data\\bin', 'C:\\board\\hc\\bin'));
    assert.equal(nt.labels['atrium-board'], '1'); assert.equal(nt.labels['atrium-ws'], ws.workspaceId);
    await until(() => ev.find((e) => e.type === 'agent_detected' && e.paneId === r.agent.paneId));
    // 되살리기가 판의 줄인지 볼 argv
    const info = await a.processInfo(r.agent.paneId);
    assert.ok(info.foreground_processes.flatMap((p) => p.argv).includes('resume'));
    // 화면을 붙여 둔 채 에이전트가 스스로 끝난다 → 놓임, 같은 자리에 셸, 스트림은 새 셸로
    const c = a.openController(r.agent.paneId, 80, 24);
    const frames = [];
    c.on('frame', (f) => frames.push(f));
    await until(() => frames.length === 1);
    ev.length = 0;
    fake.finish(r.agent.paneId, 'exited', 0);
    const moved = await until(() => ev.find((e) => e.type === 'pane_moved'));
    assert.equal(ev[0].type, 'agent_released');
    assert.equal(moved.previousPaneId, r.agent.paneId);
    assert.equal(ev.some((e) => e.type === 'pane_exited'), false);
    const sh = fake.terms.get(moved.paneId);
    assert.deepEqual(sh.argv, ['pwsh.exe']); assert.equal(sh.labels['atrium-ws'], ws.workspaceId); assert.equal(sh.env.ATRIUM_SESSION_ID, 'sid-1');
    await until(() => frames.filter((f) => f.full).length === 2); // 새 셸의 첫 화면
    assert.equal(c.exited, null);
    await until(() => !fake.terms.has(r.agent.paneId)); // 끝난 에이전트 기록은 지운다(같은 이름 기록이 쌓이지 않게)
    // 그 자리에서 다시 띄우기(이어 가기): 같은 이름이 다시 쓰인다
    const r2 = await a.startAgent({ name: 'cx', paneId: moved.paneId, args: ['resume', 'x'], kind: 'codex', command: ['codex'], env: { ATRIUM_SESSION_ID: 'sid-1' } });
    assert.equal(fake.terms.get(r2.agent.paneId).name, 'cx');
    await until(() => frames.filter((f) => f.full).length === 3);
    c.close();
  } finally { a.stopEvents(); await fake.close(); }
});

test('P114 2b 닫기: 셸을 다시 띄우는 중에 작업 공간을 닫으면 그 셸도 닫고, 판 밖에서 kill된 에이전트는 셸 없이 패널 끝', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p114-unit', dataDir: null, pipe: fake.pipe, env: {}, moveWaitMs: 100 });
  const ev = [];
  a.on('event', (e) => ev.push(e));
  try {
    a.startEvents();
    await until(() => a.connected);
    const ws = await a.createWorkspace({ cwd: 'C:/w' });
    const r = await a.startAgent({ name: 'lead', paneId: ws.paneId, kind: 'claude' });
    await until(() => ev.find((e) => e.type === 'agent_detected'));
    fake.finish(r.agent.paneId, 'exited', 0); // /exit와 판의 closeWorkspace가 겹친다
    await sleep(5);
    await a.closeWorkspace(ws.workspaceId);
    await sleep(300);
    assert.deepEqual([...fake.terms.values()].filter((t) => t.state === 'live').map((t) => t.address), []);
    const ws2 = await a.createWorkspace({ cwd: 'C:/w' });
    const r2 = await a.startAgent({ name: 'lead2', paneId: ws2.paneId, kind: 'claude' });
    await until(() => ev.find((e) => e.type === 'agent_detected' && e.paneId === r2.agent.paneId));
    fake.finish(r2.agent.paneId, 'killed', 1);
    await until(() => ev.find((e) => e.type === 'pane_exited' && e.paneId === r2.agent.paneId));
  } finally { a.stopEvents(); await fake.close(); }
});

test('P114 2b 끝난 기록 정리: 붙을 때 판이 만든 끝난 터미널을 지우고(판 밖 것은 둔다), 같은 이름으로 띄우기 전에 그 이름의 끝난 기록을 지운다', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p114-unit', dataDir: null, pipe: fake.pipe, env: {} });
  try {
    const b = fake.create({ argv: ['claude'], name: 'old', labels: { 'atrium-board': '1' } }).result;
    const o = fake.create({ argv: ['pwsh'], name: 'outside' }).result;
    fake.finish(b.address, 'server_stop', null); fake.finish(o.address, 'exited', 0);
    a.startEvents();
    await until(() => a.connected);
    await until(() => !fake.terms.has(b.address));
    assert.equal(fake.terms.has(o.address), true);
    const c = fake.create({ argv: ['claude'], name: 'lead', labels: { 'atrium-board': '1' } }).result;
    fake.finish(c.address, 'exited', 0);
    await sleep(50);
    await a.runAgent({ name: 'lead', argv: ['claude'], cwd: 'C:/w' });
    assert.equal(fake.terms.has(c.address), false);
  } finally { a.stopEvents(); await fake.close(); }
});

test('P114 2b holder 기준 서버 PID, ANSI 화면(첫 화면)', async () => {
  assert.equal(holderIdentity({ holders: [{ pid: 30, terminals: 0, current: true }, { pid: 20, terminals: 2 }, { pid: 25, terminals: 1 }] }), 20);
  assert.equal(holderIdentity({ holders: [{ pid: 30, terminals: 0, current: true }] }), 30);
  assert.equal(holderIdentity({ holders: [] }), null);
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p114-unit', dataDir: null, pipe: fake.pipe, env: {} });
  try {
    await a.probe();
    assert.equal(a.serverPid(), 4343); // 가짜의 holder
    const t = fake.create({ argv: ['pwsh'] }).result;
    assert.equal(await a.readScreen(t.address, { source: 'visible', format: 'ansi' }), FIRST_PAINT.replace(/^\x18/, ''));
    assert.match(await a.readScreen(t.address, { source: 'recent', format: 'ansi', lines: 100 }), /PS /);
  } finally { await fake.close(); }
});
