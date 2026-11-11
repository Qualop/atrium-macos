// P3 단위 시험: herdr와 claude 없이 돌릴 수 있는 규칙들(C3 대책, 그룹·묶음, 복귀 요약, 자원, D3). E1·E3 시험은 P4에서 기능과 함께 뺐다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recoveryPlan, argvHasSettings, buildResumeArgs, buildResumeArgv } from '../src/launch.mjs';
import { summarizeChanges } from '../src/changes.mjs';
import { parseClientLogLine } from '../src/herdr/adapter.mjs';
import { tuiClientsFor, descendants, argvOf } from '../src/resources.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p3-'));
const SETTINGS = 'C:/x/.dev/data/sessions/s1.json';

test('C3 대책: herdr가 다시 뜬 뒤 무엇을 할지', () => {
  // 작업 공간을 저장하기 전에 죽었다(P3 시험): 패널이 없다
  assert.equal(recoveryPlan({ paneExists: false, transcriptExists: true, settingsPath: SETTINGS }), 'recreate_resume');
  assert.equal(recoveryPlan({ paneExists: false, transcriptExists: false, settingsPath: SETTINGS }), 'recreate_fresh');
  // 판의 인자로 이어 갔다
  const ours = ['claude.exe', '--resume', 's1', '--no-chrome', '--settings', SETTINGS];
  assert.equal(recoveryPlan({ paneExists: true, agentPresent: true, argv: ours, settingsPath: SETTINGS }), 'ok');
  // herdr 기본 이어 가기(`claude --resume <ID>`)로 떴다: hook이 없다
  assert.equal(recoveryPlan({ paneExists: true, agentPresent: true, argv: ['claude.exe', '--resume', 's1'], settingsPath: SETTINGS }), 'restart_with_settings');
  assert.equal(recoveryPlan({ paneExists: true, agentPresent: true, argv: null, settingsPath: SETTINGS }), 'wait');
  // herdr가 이어 가기를 시도하지 않았다
  assert.equal(recoveryPlan({ paneExists: true, agentPresent: false, transcriptExists: true, waitedMs: 3000, settingsPath: SETTINGS }), 'wait');
  assert.equal(recoveryPlan({ paneExists: true, agentPresent: false, transcriptExists: true, waitedMs: 16000, settingsPath: SETTINGS }), 'start_resume');
  assert.equal(recoveryPlan({ paneExists: true, agentPresent: false, transcriptExists: false, waitedMs: 16000, settingsPath: SETTINGS }), 'start_fresh');
  // 시도했다가 끝났다: P1 규칙(relaunchIfEmpty)에 맡긴다
  assert.equal(recoveryPlan({ paneExists: true, agentPresent: false, transcriptExists: true, waitedMs: 16000, releasedSinceRestart: true, settingsPath: SETTINGS }), 'leave');
  // 경로는 슬래시·역슬래시, 대소문자와 상관없이 같은 파일
  assert.ok(argvHasSettings(['claude', '--settings', 'c:\\x\\.dev\\data\\sessions\\s1.json'], SETTINGS));
  const launch = { sessionId: 's1', settingsPath: SETTINGS, permissionMode: 'manual', model: 'haiku' };
  assert.deepEqual(buildResumeArgs(launch), buildResumeArgv(launch).slice(1));
});

test('A3: 복귀 요약은 바뀐 것만 한 줄씩, 같은 세션의 같은 종류는 모은다', () => {
  const ev = (t, sessionId, kind, data) => ({ t, sessionId, kind, data });
  const events = [
    ev(1, 'a', 'state', { from: 'ready', to: 'working' }),
    ev(2, 'a', 'hook', { ev: 'Stop', lastAnswer: 'first answer' }),
    ev(3, 'a', 'hook', { ev: 'Stop', lastAnswer: 'second   answer\nline' }),
    ev(4, 'b', 'state', { from: 'working', to: 'waiting', ask: { kind: 'permission', summary: 'Write: x.txt' } }),
    ev(5, 'c', 'state', { from: 'working', to: 'error', error: { type: 'rate_limit' } }),
    ev(6, 'd', 'state', { from: 'ready', to: 'exited', exit: { kind: 'normal' } }),
    ev(6, 'd', 'closed', { reason: 'killed' }), // 같은 끄기: 한 번으로 센다
    ev(7, 'e', 'state', { from: 'working', to: 'exited', exit: { kind: 'herdr_stopped' } }),
    ev(8, 'e', 'turn_interrupted', { state: 'working', prompt: 'long job' }),
    ev(9, null, 'herdr_disconnected', { expected: false }),
    ev(10, null, 'herdr_connected', {}),
  ];
  const names = { a: 'a', b: 'b', c: 'c', d: 'd', e: 'e' };
  const lines = summarizeChanges(events, { nameOf: (s) => names[s], current: new Map([['a', { state: 'ready' }], ['b', { state: 'ready' }], ['c', { state: 'error' }], ['e', { state: 'ready' }]]) });
  assert.deepEqual(lines.map((l) => `${l.kind}:${l.name || ''}`), ['needs_you:b', 'error:c', 'interrupted:e', 'exited:d', 'turn_done:a', 'herdr:']);
  const done = lines.find((l) => l.kind === 'turn_done');
  assert.equal(done.count, 2); assert.equal(done.text, 'second answer line');
  assert.equal(lines.find((l) => l.kind === 'needs_you').stillOpen, false); // 지금은 풀림
  assert.ok(lines.find((l) => l.kind === 'exited').closed); // d는 판에서 빠짐
  assert.equal(lines.find((l) => l.kind === 'exited').count, 1);
  assert.equal(lines.find((l) => l.kind === 'exited').text, '보드에서 종료');
  assert.equal(summarizeChanges([]).length, 0);
});

test('E2: 브리핑의 마지막 지시는 사람이 쓴 지시다(거부·중단 표시는 건너뛴다)', async () => {
  const { lastExchange, isSyntheticUserText } = await import('../src/transcript.mjs');
  const f = path.join(tmp(), 't.jsonl');
  const L = (o) => JSON.stringify(o);
  fs.writeFileSync(f, [
    L({ type: 'user', message: { content: 'Reply with exactly: ok' }, timestamp: '2026-10-29T10:00:00Z' }),
    L({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] }, timestamp: '2026-10-29T10:00:02Z' }),
    L({ type: 'user', message: { content: 'Use the Write tool to create x.txt' }, timestamp: '2026-10-29T10:01:00Z' }),
    L({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', id: 't1', input: {} }] }, timestamp: '2026-10-29T10:01:01Z' }),
    L({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'rejected' }] }, timestamp: '2026-10-29T10:01:05Z' }),
    L({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] }, timestamp: '2026-10-29T10:01:05Z' }),
  ].join('\n') + '\n');
  const x = lastExchange(f);
  assert.equal(x.lastPrompt, 'Use the Write tool to create x.txt');
  assert.equal(x.lastAnswer, null); // 그 지시 뒤에는 답이 없다
  assert.ok(isSyntheticUserText('<local-command-stdout>x</local-command-stdout>'));
  assert.ok(!isSyntheticUserText('일반 지시'));
});

test('D3: herdr 서버 로그에서 붙은 화면(TUI)만 센다. 판의 제어기는 빼고, 서버가 다시 뜨면 비운다', () => {
  const lines = [
    '2026-10-29T13:42:12.520970Z  INFO herdr::server::headless::bootstrap: herdr server started api_socket=x client_socket=y',
    '2026-10-29T13:42:45.323737Z  INFO herdr::server::headless: client connected client_id=2 cols=93 rows=39 cell_width_px=8 cell_height_px=16 surface_active=true render_encoding=SemanticFrame',
    '2026-10-29T13:43:10.995917Z  INFO herdr::server::headless: direct terminal client connected client_id=3 cols=80 rows=24 cell_width_px=0 cell_height_px=0',
    '2026-10-29T13:43:10.995954Z  INFO herdr::server::headless: terminal attach client connected client_id=3 cols=80 rows=24 terminal_id=term_65',
  ];
  const c = new Map();
  for (const l of lines) parseClientLogLine(l, c);
  assert.deepEqual([...c.keys()], ['2']);
  assert.equal(c.get('2').at, Date.parse('2026-10-29T13:42:45.323737Z'));
  parseClientLogLine('2026-10-29T13:43:13.590710Z  INFO herdr::server::headless: client detached client_id=3', c);
  assert.deepEqual([...c.keys()], ['2']);
  parseClientLogLine('2026-10-29T13:43:26.312243Z  INFO herdr::server::headless: client disconnected client_id=2', c);
  assert.equal(c.size, 0);
  parseClientLogLine(lines[1], c);
  parseClientLogLine(lines[0], c);
  assert.equal(c.size, 0);
});

test('D3·D1: herdr 프로세스 명령줄에서 화면(TUI)을 고르고, 셸 아래 프로세스 메모리를 더한다', () => {
  const exe = '"C:\\Users\\u\\.herdr\\packages\\standalone\\releases\\0.9.5\\herdr.exe"';
  const procs = [
    { pid: 1, cmd: `${exe} --session multitask-dev server` },
    { pid: 2, cmd: `${exe} --session multitask-dev terminal session control w2:p1 --takeover --cols 80 --rows 24` },
    { pid: 3, cmd: `${exe} --session multitask-dev` },
    { pid: 4, cmd: `${exe} session attach multitask-dev` },
    { pid: 5, cmd: `${exe} --session multitask-dev-other` },
    { pid: 6, cmd: `${exe}` },
  ];
  assert.deepEqual(tuiClientsFor(procs, 'multitask-dev').map((x) => x.pid), [3, 4]);
  assert.deepEqual(argvOf('"a b.exe" --x "c d"'), ['a b.exe', '--x', 'c d']);
  const table = new Map([[10, { pid: 10, ppid: 1, ws: 100 }], [11, { pid: 11, ppid: 10, ws: 200 }], [12, { pid: 12, ppid: 11, ws: 50 }], [13, { pid: 13, ppid: 99, ws: 999 }]]);
  assert.deepEqual(descendants(table, 10).map((p) => p.pid).sort(), [10, 11, 12]);
});
