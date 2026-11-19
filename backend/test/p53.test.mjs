// P53 시험: 저장소 밖 대화의 "HEAD" 브랜치(#8), 백엔드 첫 시작을 재시작으로 세는 것(#10)
import test from 'node:test';
import assert from 'node:assert/strict';
import { branchName, parseTranscriptChunks, convoView } from '../src/convos.mjs';
import { summarizeChanges, isRestart } from '../src/changes.mjs';

const line = (o) => JSON.stringify({ cwd: 'C:/t/plain', timestamp: '2026-11-05T00:00:00Z', ...o });

test('P53 #8: HEAD와 빈 값은 브랜치가 아니다', () => {
  assert.equal(branchName('HEAD'), null);
  assert.equal(branchName(' HEAD '), null);
  assert.equal(branchName(''), null);
  assert.equal(branchName(null), null);
  assert.equal(branchName(42), null);
  assert.equal(branchName('main'), 'main');
  assert.equal(branchName('feat/HEAD-fix'), 'feat/HEAD-fix');
});

test('P53 #8: 저장소 밖 대화 기록(gitBranch "HEAD")은 브랜치 없이 읽는다', () => {
  const head = [line({ type: 'user', uuid: 'u1', gitBranch: 'HEAD', message: { content: 'hi' } }), line({ type: 'assistant', uuid: 'a1', gitBranch: 'HEAD', message: { content: [{ type: 'text', text: 'ok' }] } })].join('\n');
  assert.equal(parseTranscriptChunks(head).branch, null);
  // 브랜치가 있다가 분리된 HEAD가 되어도 마지막 진짜 브랜치를 남긴다
  const mixed = [line({ type: 'user', uuid: 'u1', gitBranch: 'main', message: { content: 'hi' } }), line({ type: 'user', uuid: 'u2', gitBranch: 'HEAD', message: { content: 'again' } })].join('\n');
  assert.equal(parseTranscriptChunks(mixed).branch, 'main');
});

test('P53 #8: 색인에 이미 HEAD로 남은 줄도 보여줄 때 버린다', () => {
  const v = convoView({ convId: 'c1', cwd: 'C:/t/plain', branch: 'HEAD' }, { binding: { bound: false } });
  assert.equal(v.branch, null);
  assert.equal(convoView({ convId: 'c2', cwd: 'C:/t/r', branch: 'dev' }, { binding: { bound: false } }).branch, 'dev');
});

test('P53 #10: 첫 시작은 재시작이 아니다', () => {
  assert.equal(isRestart({ pid: 1, previousRun: null }), false);
  assert.equal(isRestart({}), false);
  assert.equal(isRestart(null), false);
  assert.equal(isRestart({ previousRun: { lastHeartbeatAt: 1000, downMs: 500 } }), true);
});

test('P53 #10: 빈 판은 백엔드 줄이 없고, 한 번 재시작하면 1회, 터미널 줄과 나뉜다', () => {
  const first = { sessionId: null, t: 1, kind: 'backend_started', data: { pid: 1, previousRun: null } };
  assert.deepEqual(summarizeChanges([first]), []);
  const again = { sessionId: null, t: 2, kind: 'backend_started', data: { pid: 2, previousRun: { lastHeartbeatAt: 1, downMs: 1400, cleanShutdown: true } } };
  const lines = summarizeChanges([first, again]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'backend');
  assert.equal(lines[0].count, 1);
  assert.deepEqual(lines[0].msg, { key: 'chgBackendRestarts', vars: { n: 1, down: { key: 'chgDownFor', vars: { s: 1 } } } });
  const both = summarizeChanges([first, again, { sessionId: null, t: 3, kind: 'terminal_disconnected', data: {} }, { sessionId: null, t: 4, kind: 'terminal_connected', data: {} }]);
  assert.deepEqual(both.map((l) => [l.kind, l.count]), [['terminal', 1], ['backend', 1]]);
  assert.equal(both[0].msg.key, 'chgTerminalDown');
});
