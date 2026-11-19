// P114 실시험: 고정한 진짜 herdr-core(hc)로 어댑터를 돌린다. `npm test`에 들지 않는다(받기와 코어 띄우기가 있다).
//   node --test test/p114-hc.live.mjs
// - 세션: HC_SESSION = atrium-dev-p114(P114 개발용, ATRIUM_P114_LIVE_SESSION으로 바꾼다). 실제 판(atrium)과 사용자의 기본 hc 세션은 쓰지 않는다
// - 데이터 폴더: backend/.dev/p114-live(git 밖). 고정 버전을 여기에 받는다
// - 모델은 부르지 않는다: 가짜 에이전트(test/fixtures/p114-fake-agent.cjs)가 OSC 7501로 상태를 알린다
// - 끝에 server.stop(명시적 끄기)과 상태 폴더 지우기로 정리한다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HcAdapter } from '../src/hc/adapter.mjs';
import { FramedConn, FRAME } from '../src/hc/rpc.mjs';
import { hcConfigFile } from '../src/hc/core.mjs';
import { HC_PIN } from '../src/hc/pin.mjs';
// 2b: 버전 올리기 시험용 옛 고정(0.1.19, releases.herdr.dev manifest의 SHA-256)
const OLD_PIN = Object.freeze({ ...HC_PIN, version: '0.1.19', url: 'https://releases.herdr.dev/core/0.1.19/herdr-core-windows-x86_64.zip', sha256: '1cf7de14c862abc49b8eaeed32dc6a60d8146740edb2c244570d1a9f07cb813a' });

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 개발용 판의 hc 세션(atrium-dev-p114)과 겹치지 않게 -live를 붙인다(이 시험은 끝에 코어를 끄고 상태를 지운다. 2b에서 개발용 판 세션을 지운 실수)
const SESSION = process.env.ATRIUM_P114_LIVE_SESSION || 'atrium-dev-p114-live';
if (/^(atrium|multitask|default)$/.test(SESSION)) throw new Error('live test must not use the real board session');
const DATA = path.resolve(HERE, '..', '.dev', 'p114-live');
const FAKE = path.join(HERE, 'fixtures', 'p114-fake-agent.cjs');
const CWD = path.resolve(HERE, '..', '.dev', 'p114-live', 'work');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000, what = 'condition') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(50); } throw new Error(`timed out: ${what}`); };

test('P114 실시험: 고정 hc 받기, 코어, 이벤트, 셸 env, 가짜 에이전트 상태·보내기·막힘, 화면 스트림, 판 밖 크기 주인, 재시작, 바꿔 띄우기', { timeout: 240000 }, async (t) => {
  fs.mkdirSync(CWD, { recursive: true });
  const a = new HcAdapter({ session: SESSION, dataDir: DATA, logDir: DATA });
  const ev = [], logs = [];
  a.on('event', (e) => ev.push(e));
  a.on('log', (m) => logs.push(m));
  let disconnected = 0;
  a.on('disconnected', () => disconnected++);
  try {
    await t.test('고정 버전 받기(SHA-256)와 두 번째는 받지 않음', async () => {
      const r1 = await a.ensureBinary();
      assert.equal(r1.version, HC_PIN.version);
      assert.ok(['fetched', 'installed'].includes(r1.source));
      for (const f of ['herdr-core.exe', 'hc.exe', 'conpty/conpty.dll', 'conpty/x64/OpenConsole.exe', 'VERSION']) assert.ok(fs.existsSync(path.join(DATA, 'hc', 'bin', f)), f);
      const r2 = await a.ensureBinary();
      assert.equal(r2.source, 'installed');
    });
    await t.test('코어 띄우기(hc server start), 판 설정 notes = false, 버전 정책', async () => {
      const p0 = await a.probe();
      assert.equal(p0.running, false, `session ${SESSION} already has a core; stop it first`);
      const s = await a.startServer();
      assert.equal(s.started, true);
      assert.ok(a.serverPid());
      assert.match(fs.readFileSync(hcConfigFile(a.configHome), 'utf8'), /^notes = false$/m);
      const c = a.checkCompat((await a.probe()).pong);
      assert.equal(c.ok, true); assert.equal(c.level, 'ok'); assert.equal(c.hcVersion, HC_PIN.version);
      assert.match(await a.cliVersion(), /^hc 0\.1\.20/);
      a.startEvents();
      await until(() => a.connected, 10000, 'connected');
    });
    let shell;
    await t.test('셸 작업 공간: PATH 앞은 판의 hc 폴더, XDG_CONFIG_HOME은 빈 값, 키는 attach DATA', async () => {
      shell = await a.createWorkspace({ cwd: CWD, label: 'p114 live' });
      assert.equal(await a.waitShellReady(shell.paneId, 20000), true);
      await until(() => ev.find((e) => e.type === 'pane_created' && e.paneId === shell.paneId), 5000, 'pane_created');
      // pwsh는 뜰 때 자기 폴더를 PATH 맨 앞에 넣는다. 그래서 앞 두 칸을 본다
      await a.sendText(shell.paneId, '"P0=" + ($env:PATH.Split(";")[0..1] -join "|") + " XDG=[" + $env:XDG_CONFIG_HOME + "] HCS=" + $env:HC_SESSION');
      const k = await a.paneKeys(shell.paneId, ['enter']);
      assert.equal(k.via, 'attach');
      const scr = await until(async () => { const s = await a.readScreen(shell.paneId, { source: 'visible' }); return /P0=.*XDG=\[\] HCS=/.test(s) && s; }, 10000, 'env line');
      const line = scr.split('\n').find((l) => /^P0=/.test(l.trim()));
      assert.ok(line.includes(path.join(DATA, 'hc', 'bin')), line);
      assert.ok(line.includes(`HCS=${SESSION}`), line);
    });
    let fake;
    await t.test('가짜 에이전트(첫 argv): 나타남, idle, 보내기 → working → done, 막힘 → 거부 → 키로 풀기', async () => {
      fake = await a.runAgent({ name: 'p114-fake', argv: ['node', FAKE], cwd: CWD, labels: { 'atrium-session': 'live-sid' } });
      await until(() => ev.find((e) => e.type === 'agent_detected' && e.paneId === fake.address), 15000, 'agent_detected');
      assert.equal(ev.find((e) => e.type === 'agent_detected' && e.paneId === fake.address).agent, 'p114-fake');
      const info = await a.getAgent('p114-fake');
      assert.equal(info.status, 'idle'); assert.equal(info.agentSessionId, 'live-sid');
      const sent = await a.prompt('p114-fake', 'hello');
      assert.equal(sent.started, true);
      await until(() => ev.find((e) => e.type === 'status' && e.paneId === fake.address && e.status === 'done'), 10000, 'done');
      assert.ok(ev.some((e) => e.type === 'status' && e.paneId === fake.address && e.status === 'working'));
      assert.match(await a.readScreen(fake.address, { source: 'visible' }), /got hello/);
      await a.prompt('p114-fake', 'block');
      const b = await until(() => ev.find((e) => e.type === 'status' && e.paneId === fake.address && e.status === 'blocked'), 10000, 'blocked');
      assert.equal(b.detail.kind, 'permission'); assert.equal(b.detail.msg, 'approve fake: rm nothing');
      await assert.rejects(a.prompt('p114-fake', 'x'), (e) => e.code === 'agent_blocked');
      const t0 = Date.now();
      await a.paneKeys(fake.address, ['1', 'enter']);
      await until(() => ev.filter((e) => e.type === 'status' && e.paneId === fake.address && e.status === 'done').length >= 2, 10000, 'unblocked');
      assert.ok(Date.now() - t0 < 2500, 'key pad must not wait for the 3 s quiet');
    });
    let ctl;
    await t.test('화면 스트림: 첫 화면 full, 입력 반영, 판 밖 활성 보는 이가 크기를 가져가고 돌려줌', async () => {
      ctl = a.openController(shell.paneId, 100, 30);
      const frames = [], sizes = [];
      ctl.on('frame', (f) => frames.push(f));
      ctl.on('size', (z) => sizes.push(z));
      await until(() => frames.length, 10000, 'first frame');
      assert.equal(frames[0].full, true);
      assert.ok(Buffer.from(frames[0].bytes, 'base64').toString('utf8').includes('PS '));
      ctl.input('echo p114-stream\r');
      await until(() => frames.some((f) => Buffer.from(f.bytes, 'base64').toString('utf8').includes('p114-stream')), 10000, 'echo');
      assert.equal((await a.paneKeys(shell.paneId, ['space'])).via, 'stream');
      const ext = new FramedConn(a.pipe);
      await ext.open();
      const r = await ext.call('terminal.attach', { terminal: shell.paneId, cols: 90, rows: 20 });
      ext.claim(r.channel, (f) => { if (f.kind === FRAME.DATA) { const n = Buffer.alloc(4); n.writeUInt32LE(f.payload.length, 0); ext.write(r.channel, FRAME.CREDIT, n); } });
      await until(() => sizes.find((z) => z.external && z.cols === 90), 10000, 'external size');
      ext.write(r.channel, FRAME.CLOSE); ext.close();
      await until(() => sizes.some((z) => !z.external && z.cols === 100), 10000, 'size back');
    });
    await t.test('코어 재시작(server.restart): disconnected 없음, 프로그램 PID 그대로, 스트림은 다시 붙음', async () => {
      const pidBefore = (await a.call('terminal.get', { terminal: shell.paneId })).pid;
      const corePid = a._corePid, holder = a.serverPid(); // 2b: 판의 "서버 PID"는 holder(프로그램이 산 동안 같다)
      const attaches = ctl.stats.attaches;
      const r = await a.restartServer();
      assert.equal(r.restarted, true);
      assert.notEqual(a._corePid, corePid);
      assert.equal(a.serverPid(), holder);
      await until(() => ctl.stats.attaches > attaches, 15000, 'reattach');
      assert.equal((await a.call('terminal.get', { terminal: shell.paneId })).pid, pidBefore);
      await sleep(1500);
      assert.equal(disconnected, 0);
      assert.equal(a.connected, true);
      ctl.close();
    });
    await t.test('에이전트로 바꿔 띄우기: 셸 자리 → 가짜 에이전트, pane_moved', async () => {
      const ws = await a.createWorkspace({ cwd: CWD });
      await a.waitShellReady(ws.paneId, 20000);
      ev.length = 0;
      const r = await a.startAgent({ name: 'p114-lead', paneId: ws.paneId, args: [FAKE], command: ['node'], kind: 'p114-fake' });
      assert.equal(ev[0].type, 'pane_moved'); assert.equal(ev[0].previousPaneId, ws.paneId);
      await until(() => ev.find((e) => e.type === 'agent_detected' && e.paneId === r.agent.paneId), 15000, 'agent in new terminal');
      assert.equal(ev.some((e) => e.paneId === ws.paneId && e.type !== 'pane_moved'), false);
      const p = await a.getPane(r.agent.paneId);
      assert.equal(p.workspaceId, ws.workspaceId);
    });
  } finally {
    a.stopEvents();
    const s = await a.stopServer().catch((e) => ({ error: e.message }));
    const d = await a.deleteSession().catch((e) => ({ error: e.message }));
    fs.writeFileSync(path.join(DATA, 'live-log.json'), JSON.stringify({ stop: s, delete: d, logs: logs.slice(-50), events: ev.slice(-30).map((e) => ({ type: e.type, paneId: e.paneId, status: e.status })) }, null, 1));
  }
});

// 2b 3번: 판이 붙을 때 떠 있는 코어가 고정 버전과 다르면 올린다(hc update --from staging). 터미널은 산다
test('P114 2b 실시험: 옛 고정(0.1.19)으로 띄운 코어를 새 고정(0.1.20) 어댑터가 붙으며 올린다', { timeout: 240000 }, async () => {
  const S = `${SESSION}-up`;
  const DATA_UP = path.join(DATA, 'upgrade');
  fs.mkdirSync(CWD, { recursive: true });
  const old = new HcAdapter({ session: S, dataDir: DATA_UP, logDir: DATA_UP, pin: OLD_PIN, tested: ['0.1.19'] });
  const neu = new HcAdapter({ session: S, dataDir: DATA_UP, logDir: DATA_UP });
  const logs = [];
  neu.on('log', (m) => logs.push(m));
  try {
    assert.equal((await old.probe()).running, false, `session ${S} already has a core`);
    await old.startServer();
    assert.equal((await old.probe()).pong.version, '0.1.19');
    const sh = await old.createWorkspace({ cwd: CWD });
    const pid = (await old.call('terminal.get', { terminal: sh.paneId })).pid;
    const upgraded = new Promise((r) => neu.once('upgraded', r));
    neu.startEvents();
    const u = await upgraded;
    assert.equal(u.upgraded, true); assert.equal(u.to, '0.1.20');
    await until(async () => { const p = await neu.probe(); return p.running && p.pong.version === '0.1.20'; }, 30000, 'core 0.1.20');
    const t = await neu.call('terminal.get', { terminal: sh.paneId });
    assert.equal(t.state, 'live'); assert.equal(t.pid, pid); // 터미널은 그대로
    assert.equal(fs.readFileSync(path.join(DATA_UP, 'hc', 'bin', 'VERSION'), 'utf8').trim(), '0.1.20');
  } finally {
    neu.stopEvents();
    await neu.stopServer().catch(() => {});
    await neu.deleteSession().catch(() => {});
    fs.writeFileSync(path.join(DATA_UP, 'upgrade-log.json'), JSON.stringify({ logs }, null, 1));
  }
});
