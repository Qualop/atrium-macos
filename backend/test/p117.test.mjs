// P117 단위 시험: hc 모드의 신뢰 대화상자(7501 상태 전), 옛 판 옮기기(터미널 백엔드 둘을 함께 쥐는 라우터, 세션 옮기기), 새 판의 백엔드 정하기, 고정 hc 배포
import test from 'node:test';
import assert from 'node:assert/strict';
import { HcAdapter } from '../src/hc/adapter.mjs';
import { HcModel, TRUST_STATUS, LABEL } from '../src/hc/model.mjs';
import { startFakeHc } from './fake-hc.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(20); } throw new Error('timed out'); };
const TRUST_SCREEN = ' Quick safety check: Is this a project you created or one you trust?\n ❯ 1. Yes, I trust this folder\n   2. No, exit\n Enter to confirm · Esc to cancel';

async function trustRig() {
  const fake = await startFakeHc();
  let hold = true; // 신뢰 질문 중(7501 없음)
  fake.silent = (t) => t.argv[0] === 'claude' && hold;
  fake.screenOf = (t) => (t.argv[0] === 'claude' ? TRUST_SCREEN : null);
  const a = new HcAdapter({ session: 'p117-unit', dataDir: null, pipe: fake.pipe, env: {}, moveWaitMs: 500, trustPollMs: 30 });
  const ev = [];
  a.on('event', (e) => ev.push(e));
  a.startEvents();
  await until(() => a.connected);
  const ws = await a.createWorkspace({ cwd: 'C:/w' });
  const r = await a.startAgent({ name: 'lead', paneId: ws.paneId, kind: 'claude' });
  return { fake, a, ev, ws, r, trust: (v) => { hold = v; } };
}

test('P117 신뢰(hc): 7501 전 화면의 신뢰 질문 → 막힘을 흉내(에이전트 나타남 + blocked), 글은 거부, 목록에도 보이고, 사람이 신뢰하면 7501 idle로 풀린다', async () => {
  const { fake, a, ev, r } = await trustRig();
  try {
    const addr = r.agent.paneId;
    assert.equal(fake.terms.get(addr).labels[LABEL.agent], 'claude');
    const st = await until(() => ev.find((e) => e.type === 'status' && e.paneId === addr));
    assert.equal(st.status, 'blocked');
    assert.equal(st.detail.kind, 'trust');
    assert.ok(ev.find((e) => e.type === 'agent_detected' && e.paneId === addr && e.agent === 'claude'));
    // 판의 checkBlocked가 읽는 화면, 목록(getPane·listAgents·snapshot)
    assert.match(await a.readScreen(addr, { source: 'visible' }), /trust this folder/);
    assert.equal((await a.getPane(addr)).status, 'blocked');
    assert.equal((await a.listAgents()).find((x) => x.paneId === addr).agent, 'claude');
    // 글은 신뢰 질문에 들어가지 않는다(herdr의 agent_blocked와 같다)
    await assert.rejects(a.prompt('lead', 'hello'), (e) => e.code === 'agent_blocked');
    assert.deepEqual(fake.terms.get(addr).sent, []);
    // 사람이 노드에서 신뢰 → claude가 7501을 말한다
    fake.setStatus(addr, { app: 'claude-code', state: 'idle' });
    const idle = await until(() => ev.find((e) => e.type === 'status' && e.paneId === addr && e.status === 'idle'));
    assert.ok(idle);
    assert.equal(ev.some((e) => e.type === 'agent_released'), false);
    await a.prompt('lead', 'hello');
    assert.deepEqual(fake.terms.get(addr).sent, ['hello']);
  } finally { a.stopEvents(); await fake.close(); }
});

test('P117 신뢰(hc): 사람이 거절해 claude가 끝나면 에이전트가 떠나고(판은 trust_declined) 같은 자리에 셸이 남는다. 그 패널을 부르면 새 셸을 따라간다', async () => {
  const { fake, a, ev, r } = await trustRig();
  try {
    const addr = r.agent.paneId;
    await until(() => ev.find((e) => e.type === 'status' && e.paneId === addr && e.status === 'blocked'));
    ev.length = 0;
    fake.finish(addr, 'exited', 0);
    const moved = await until(() => ev.find((e) => e.type === 'pane_moved'));
    assert.equal(ev[0].type, 'agent_released');
    assert.equal(ev[0].paneId, addr);
    assert.equal(moved.previousPaneId, addr);
    assert.deepEqual(fake.terms.get(moved.paneId).argv, ['pwsh.exe']);
    // passGate 흐름: 옛 패널 ID로 셸을 기다리고 에이전트를 띄워도 새 셸 자리로 간다
    assert.equal(await a.waitShellReady(addr, 2000), true);
    const r2 = await a.startAgent({ name: 'lead', paneId: addr, args: ['--worktree', 'x'], kind: 'claude' });
    assert.deepEqual(fake.terms.get(r2.agent.paneId).argv, ['claude', '--worktree', 'x']);
    assert.equal(r2.replacedPane, moved.paneId);
  } finally { a.stopEvents(); await fake.close(); }
});

test('P117 신뢰(hc): 7501 없이 바로 끝난 판의 에이전트도 에이전트가 떠난 것으로 알리고 셸을 남긴다. 판 밖 셸이 끝나면 그대로 패널 끝', () => {
  const m = new HcModel();
  m.load([{ address: 't1', state: 'live', labels: { [LABEL.board]: '1', [LABEL.ws]: 'hw-a', [LABEL.agent]: 'claude' }, status: null }, { address: 't2', state: 'live', labels: { [LABEL.board]: '1', [LABEL.ws]: 'hw-b' }, status: null }]);
  const out = m.apply({ type: 'finished', terminal: 't1', data: { reason: 'exited', exit_code: 1 } });
  assert.deepEqual(out.map((e) => e.type), ['agent_released', 'pane_exited', 'terminal_finished']);
  assert.equal(out[0].agent, 'claude');
  assert.equal(out[1].agent, true);
  const out2 = m.apply({ type: 'finished', terminal: 't2', data: { reason: 'exited', exit_code: 0 } });
  assert.deepEqual(out2.map((e) => e.type), ['pane_exited', 'terminal_finished']);
  assert.equal(out2[0].agent, false);
  // 흉내 낸 신뢰 상태는 다시 붙을 때(diff) 코어에 상태가 없어도 남는다
  const m2 = new HcModel();
  m2.load([{ address: 't3', state: 'live', labels: {}, status: { ...TRUST_STATUS } }]);
  assert.deepEqual(m2.diff([{ address: 't3', state: 'live', labels: {}, status: null }]), []);
  assert.equal(m2.terms.get('t3').status.synthetic, true);
});

test('P117 신뢰(hc): 신뢰 질문 중에 백엔드가 다시 뜨면, 붙기(connected) 전에 화면을 보고 막힘으로 싣는다(판이 끝남으로 두지 않게)', async () => {
  const fake = await startFakeHc();
  fake.silent = (t) => t.argv[0] === 'claude';
  fake.screenOf = (t) => (t.argv[0] === 'claude' ? TRUST_SCREEN : null);
  const t = fake.create({ argv: ['claude'], labels: { [LABEL.board]: '1', [LABEL.ws]: 'hw-x', [LABEL.agent]: 'claude' } }).result;
  const a = new HcAdapter({ session: 'p117-unit', dataDir: null, pipe: fake.pipe, env: {}, trustPollMs: 30 });
  let atConnect = null;
  a.on('connected', () => { atConnect = a.model.terms.get(t.address).status; });
  try {
    a.startEvents();
    await until(() => a.connected);
    assert.equal(atConnect && atConnect.synthetic, true);
    assert.equal((await a.listAgents()).find((x) => x.paneId === t.address).status, 'blocked');
  } finally { a.stopEvents(); await fake.close(); }
});

test('P117 화면 스트림(hc): 크기를 바꾼 뒤 프로그램이 아무것도 쓰지 않아도(쉬는 셸) 새 크기의 첫 화면(full)을 낸다', async () => {
  const fake = await startFakeHc();
  const { HcController } = await import('../src/hc/stream.mjs');
  try {
    const t = fake.create({ argv: ['pwsh'] }).result;
    const c = new HcController({ pipe: fake.pipe, terminal: t.address, cols: 120, rows: 40 });
    const frames = [];
    c.on('frame', (f) => frames.push(f));
    await until(() => frames.length === 1);
    assert.deepEqual([frames[0].width, frames[0].height, frames[0].full], [120, 40, true]);
    c.resize(175, 33); // 판 밖 클라이언트가 떠나 창의 크기로 되돌림
    const f = await until(() => frames.find((x) => x.width === 175 && x.height === 33));
    assert.equal(f.full, true);
    // 바로 출력이 오면 다시 붙지 않는다
    const n = fake.calls.filter((x) => x.method === 'terminal.attach').length;
    c.resize(100, 30); fake.output(t.address, 'PS> ');
    await sleep(300);
    assert.equal(fake.calls.filter((x) => x.method === 'terminal.attach').length, n);
    c.close();
  } finally { await fake.close(); }
});

test('P117 hc 기록 읽기(P116 인계): 화면 아래 빈 줄은 n줄에 세지 않는다(recent_unwrapped)', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p117-unit', dataDir: null, pipe: fake.pipe, env: {} });
  try {
    const t = fake.create({ argv: ['pwsh'] }).result;
    fake.terms.get(t.address).screen = ['line 1', 'line 2', '• answer A', '• answer B', ...Array(30).fill('')].join('\n');
    assert.equal(await a.readScreen(t.address, { source: 'recent_unwrapped', lines: 2 }), '• answer A\n• answer B');
    assert.equal((await a.readScreen(t.address, { source: 'recent', lines: 60 })).split('\n').length, 4);
    assert.ok(fake.calls.filter((c) => c.method === 'terminal.read').every((c) => c.params.lines >= 200)); // 화면 높이만큼 더 읽는다
  } finally { await fake.close(); }
});

// ---------- 고정 hc 배포 ----------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureHc, HC_PIN, hcBinDir, checkHcPin, verifyPinnedHc } from '../src/hc/pin.mjs';

test('P117 배포: 받기 실패(오프라인)는 download_failed. 새 고정 버전을 못 받으면 놓인 옛 hc로 돈다(stale), 놓인 것이 없으면 실패', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p117-pin-'));
  try {
    const offline = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
    await assert.rejects(ensureHc({ dataDir, fetchImpl: offline }), (e) => e.code === 'download_failed' && /ENOTFOUND/.test(e.message));
    // 옛 버전(0.1.19)이 bin에 온전히 있다
    const bin = hcBinDir(dataDir);
    // macOS 판: 단독 실행 파일 herdr-core와 hc 링크(Windows는 exe 둘과 conpty)
    const files = process.platform === 'win32' ? ['herdr-core.exe', 'hc.exe', path.join('conpty', 'conpty.dll'), path.join('conpty', 'x64', 'OpenConsole.exe')] : ['herdr-core', 'hc'];
    for (const f of files) { fs.mkdirSync(path.dirname(path.join(bin, f)), { recursive: true }); fs.writeFileSync(path.join(bin, f), 'x'); }
    fs.writeFileSync(path.join(bin, 'VERSION'), '0.1.19\n');
    const r = await ensureHc({ dataDir, fetchImpl: offline });
    assert.equal(r.source, 'stale'); assert.equal(r.version, '0.1.19'); assert.match(r.error, /download failed/);
    // 코어가 그 파일로 돌 때도 같다(올리기를 다음으로 미룬다)
    assert.equal((await ensureHc({ dataDir, fetchImpl: offline, coreRunning: true })).source, 'stale');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('P117 릴리스 검사: 고정 hc zip의 SHA-256, 버전, 서명 상태, 서명자(CN=herdr)', async () => {
  // macOS 판: 서명자는 Developer ID 팀(TeamIdentifier, codesign). Windows는 Authenticode CN
  const good = { sha256: HC_PIN.sha256, version: HC_PIN.version, signature: { status: 'Valid', subject: process.platform === 'win32' ? 'CN=herdr, O=herdr, L=Wilmington, S=Delaware, C=US' : `${HC_PIN.signer}, Identifier=dev.herdr.core` } };
  assert.deepEqual(checkHcPin(good), []);
  assert.equal(checkHcPin({ ...good, sha256: 'ab' }).length, 1);
  assert.equal(checkHcPin({ ...good, version: '0.1.19' }).length, 1);
  assert.match(checkHcPin({ ...good, signature: { status: 'NotSigned', subject: null } })[0], /서명이 유효하지 않습니다/);
  assert.match(checkHcPin({ ...good, signature: { status: 'Valid', subject: 'CN=herdr-evil, O=x' } })[0], new RegExp(`서명자가 ${HC_PIN.signer}가 아닙니다`));
  assert.match(checkHcPin({ ...good, signature: null })[0], /읽지 못함/);
  // 받은 것이 고정 SHA-256과 다르면 풀지 않고 알린다
  const r = await verifyPinnedHc({ tmpRoot: os.tmpdir(), fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('not the pinned zip').buffer }), signatureOf: async () => { throw new Error('should not run'); } });
  assert.equal(r.problems.length, 3);
  assert.match(r.problems[0], /SHA-256이 다릅니다/);
});
