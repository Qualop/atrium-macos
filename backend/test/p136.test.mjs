// P136 단위 시험: 에이전트 터미널은 기록 읽기로 굴리지 않는다(hc stitched 읽기가 전체 화면 앱에 휠 보고를 몰아 넣어 입력 칸에 `[<65;101;61M`이 남았다),
// 화면 답 고르기가 지금 화면만으로도 답을 고르고, 진단 기록(입력·초점·크기·모드·기록 읽기 값)과 입력 칸 찌꺼기 알림이 맞는가
import test from 'node:test';
import assert from 'node:assert/strict';
import { HcAdapter } from '../src/hc/adapter.mjs';
import { HcController } from '../src/hc/stream.mjs';
import { FRAME } from '../src/hc/rpc.mjs';
import { InputTrace, inputSummary, modeChanges, inputBoxJunk } from '../src/input-trace.mjs';
import { screenAnswerText } from '../src/links.mjs';
import { startFakeHc } from './fake-hc.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(20); } throw new Error('timed out'); };
const W = (b, x, y) => `\x1b[<${b};${x};${y}M`;

test('P136 기록 읽기: 에이전트가 도는 터미널은 지금 화면만 읽고(lines 0), 셸은 기록을 읽고, scroll: true면 에이전트도 기록을 읽는다', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p136-unit', dataDir: null, pipe: fake.pipe, env: {} });
  a.startEvents();
  try {
    await until(() => a.connected);
    const cx = fake.create({ argv: ['codex'] }).result;
    const sh = fake.create({ argv: ['pwsh'] }).result;
    fake.terms.get(cx.address).screen = ['• answer A', '• answer B', '', '› Ask Codex to do anything', ...Array(5).fill('')].join('\n');
    fake.setStatus(cx.address, { app: 'codex', state: 'idle' });
    await until(() => a.runsAgent(cx.address));
    assert.equal(a.runsAgent(sh.address), false);
    const linesOf = () => fake.calls.filter((c) => c.method === 'terminal.read').map((c) => c.params.lines);
    // 판의 화면 답 고르기(recent_unwrapped 200), atrium read, 권한 선택지(detection) 모두 에이전트면 지금 화면
    assert.equal(await a.readScreen(cx.address, { source: 'recent_unwrapped', lines: 3 }), '• answer B\n\n› Ask Codex to do anything'); // 끝의 빈 줄을 떼고 n줄
    await a.readScreen(cx.address, { source: 'detection' });
    await a.readScreen(cx.address, { source: 'recent', lines: 500 });
    assert.deepEqual(linesOf(), [0, 0, 0]);
    // 셸은 예전처럼 기록(화면 높이만큼 더)
    await a.readScreen(sh.address, { source: 'recent', lines: 10 });
    assert.equal(linesOf().at(-1), 210);
    // 일부러 굴려 읽기
    await a.readScreen(cx.address, { source: 'recent', lines: 10, scroll: true });
    assert.equal(linesOf().at(-1), 210);
    // 기록 읽기는 진단 기록에 남는다(줄 수)
    assert.ok(a.trace.recent(sh.address).some((e) => e.kind === 'read' && e.lines === 210));
  } finally { a.stopEvents?.(); await fake.close(); }
});

test('P136 화면 답: 긴 답이라 그 턴의 프롬프트 줄이 화면 위로 지나갔으면(지금 화면만 읽음) 입력 칸 위를 답으로 고른다(상태 줄이 아니라)', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `  - long answer line ${i + 1}`);
  const codex = [...lines, '', '› Ask Codex to do anything', '', '  model xhigh · C:\\w · never', '  ← for agents · ? for shortcuts'].join('\n');
  const got = screenAnswerText(codex, 20).split('\n');
  assert.equal(got.length, 20);
  assert.equal(got[0].trim(), '- long answer line 11');
  assert.equal(got.at(-1).trim(), '- long answer line 30');
  // 프롬프트 줄이 보이면 예전과 같다(그 턴만)
  const both = ['› old prompt', '• old answer', '› new prompt', '• new answer', '', '› Ask Codex to do anything', '  status'].join('\n');
  assert.equal(screenAnswerText(both, 20), 'new answer');
});

test('P136 진단 값: 입력 요약은 값만(글 없음), 프레임의 모드 바뀜, 입력 칸의 마우스 보고 꼴 글', () => {
  assert.deepEqual(inputSummary(W(65, 101, 61) + W(64, 101, 61)), { bytes: 26, reports: 2, wheel: 2, last: '64;101;61M' });
  assert.deepEqual(inputSummary('\x1b[I'), { bytes: 3, focus: 'I' });
  assert.deepEqual(inputSummary('secret text'), { bytes: 11, other: 11 }); // 글은 길이만
  assert.deepEqual(inputSummary('\x1b[<0;5;5M'), { bytes: 9, reports: 1, wheel: 0, last: '0;5;5M' });
  assert.deepEqual(modeChanges('\x1b[?2026h\x1b[?1049h\x1b[?1003;1006h\x1b[?25l'), ['1049h', '1003h', '1006h']);
  assert.equal(modeChanges('plain'), null);
  // 입력 칸(마지막 프롬프트 줄)만 본다. 지난 턴의 프롬프트 줄에 남은 찌꺼기는 세지 않는다
  assert.deepEqual(inputBoxJunk('› [<65;101;61Mold prompt\n• answer\n\n› [<65;101;61M\n  status'), ['[<65;101;61M']);
  assert.equal(inputBoxJunk('› [<65;101;61Mold prompt\n• answer\n\n› Ask Codex to do anything\n  status'), null);
  assert.deepEqual(inputBoxJunk('───\n❯ [<64;3;4M[<65;3;4Mhello\n───'), ['[<64;3;4M', '[<65;3;4M']);
  assert.equal(inputBoxJunk('no prompt [<65;1;1M'), null);
});

test('P136 진단 기록: 입력 칸에 찌꺼기가 보이면 그 패널의 최근 기록을 한 번 로그에 남기고, 사라지면 다시 남길 수 있다', () => {
  let now = 1000;
  const logs = [];
  const tr = new InputTrace({ log: (m) => logs.push(m), now: () => now, keep: 5 });
  tr.note('t1', 'size', { cols: 200, rows: 120 });
  now += 100; tr.note('t1', 'read', { lines: 400, how: 'stitched', complete: true, ms: 2500 });
  now += 10; tr.note('t2', 'input', inputSummary(W(65, 1, 1)));
  for (let i = 0; i < 6; i++) tr.note('t3', 'input', { bytes: i });
  assert.equal(tr.recent('t3').length, 5); // keep
  const screen = '• a\n› [<65;101;61M\n  status';
  const r = tr.checkScreen('t1', screen, 'visible');
  assert.deepEqual(r.junk, ['[<65;101;61M']);
  assert.equal(r.trace.length, 2);
  assert.match(r.trace[1], /^-10ms read .*"how":"stitched"/);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /input junk in t1 \(visible\): 1x \[<65;101;61M/);
  assert.equal(tr.checkScreen('t1', screen), null); // 같은 찌꺼기는 한 번만
  assert.equal(tr.checkScreen('t1', '› Ask'), null); // 사라짐
  assert.ok(tr.checkScreen('t1', screen)); // 다시 생기면 다시
  assert.equal(logs.length, 2);
  // 오래된 기록은 버린다
  now += 10 * 60 * 1000;
  assert.equal(tr.recent('t1').length, 0);
});

test('P136 화면 스트림: 프레임의 마우스·대체 화면 모드가 바뀌면 끝 상태만 modes로 알리고, 판 스트림의 입력·초점·크기는 진단 기록에 값만 남는다', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p136-unit', dataDir: null, pipe: fake.pipe, env: {} });
  try {
    const t = fake.create({ argv: ['codex'] }).result;
    const c = a.openController(t.address, 120, 40);
    const seen = [];
    c.on('modes', (m) => seen.push(m.join(' ')));
    await new Promise((r) => c.once('attached', r));
    // 첫 화면처럼 모두 끈 뒤 켠다 → 켜진 것만. 같은 모드를 다시 적으면 알리지 않는다. 끄면 알린다
    c._frame(c.conn, { kind: FRAME.DATA, payload: Buffer.from('\x1b[?1000l\x1b[?1003l\x1b[?1049l\x1b[?1049h\x1b[?1003h\x1b[?1006h') });
    c._frame(c.conn, { kind: FRAME.DATA, payload: Buffer.from('\x1b[?2026h\x1b[?1003h\x1b[?2026l') });
    c._frame(c.conn, { kind: FRAME.DATA, payload: Buffer.from('\x1b[?1003l') });
    assert.deepEqual(seen, ['1003h 1006h 1049h', '1003l']);
    c.input(W(65, 61, 21)); c.focus(true); c.resize(100, 30); c.inputAuto('\x13');
    const kinds = a.trace.recent(t.address).map((e) => e.kind);
    assert.deepEqual(kinds.filter((k) => k !== 'size'), ['attach', 'modes', 'modes', 'input', 'focus', 'resize', 'auto']);
    const inp = a.trace.recent(t.address).find((e) => e.kind === 'input');
    assert.equal(inp.last, '65;61;21M');
    assert.equal(JSON.stringify(a.trace.recent(t.address)).includes('\x13'), false); // 친 글은 남기지 않는다
    c.close();
    await until(() => a.trace.recent(t.address).some((e) => e.kind === 'detach'));
    await sleep(150);
  } finally { await fake.close(); }
});
