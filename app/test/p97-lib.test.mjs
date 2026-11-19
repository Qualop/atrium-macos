// P97 창 단위 시험: 붙여 넣은 명령줄을 무엇으로 알아봤는지(칩), 틀 채우기, 레일 이름 칸의 자리와 이름 규칙, 새 글이 두 사전에 있는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizedChips, fillFromParse, popoverAt, blankLauncher } from '../src/renderer/lib/launchers.js';
import { checkLabel } from '../src/renderer/lib/session-name.js';
import { translate } from '../src/renderer/lib/i18n.js';

test('P97 알아본 결과 칩: 판 세션, 실행 명령, 칸으로 간 인자, 환경 변수, 뺀 것', () => {
  const rec = { as: 'claude', harness: 'claude', board: true, startCommand: 'ocx claude', mapped: [{ arg: '--model', field: 'model' }, { arg: '--foo', field: 'args' }], dropped: ['--session-id x'], env: ['A'], skipped: [] };
  const c = recognizedChips(rec);
  assert.deepEqual(c.map((x) => [x.tone, x.key]), [
    ['ok', 'launcherPaste.board'], ['dim', 'launcherPaste.start'], ['dim', 'launcherPaste.mapped'], ['dim', 'launcherPaste.mapped'], ['dim', 'launcherPaste.env'], ['warn', 'launcherPaste.dropped'],
  ]);
  assert.deepEqual(c[1].vars, { cmd: 'ocx claude' });
  // 명령 한 줄(판 연동 없음)은 까닭과 함께 경고 색
  assert.deepEqual(recognizedChips({ as: 'command', harness: 'command', why: 'wrapperNotClaude', mapped: [], dropped: [], env: [], skipped: [] })[0], { tone: 'warn', key: 'launcherPaste.command_wrapperNotClaude', vars: {} });
  assert.deepEqual(recognizedChips({ as: 'codex', harness: 'codex', board: false, mapped: [], dropped: [], env: [], skipped: [] })[0], { tone: 'ok', key: 'launcherPaste.agent', vars: { harness: 'codex' } });
  assert.deepEqual(recognizedChips({ as: 'empty' }), []);
  assert.deepEqual(recognizedChips(null), []);
});

test('P97 틀 채우기: 해석 값을 덮되 사람이 쓴 이름과 고르던 아이콘, 고치는 호출자의 ID는 지킨다', () => {
  const parsed = { name: 'ocx claude haiku', harness: 'claude', startCommand: 'ocx claude', model: 'haiku', permissionMode: 'auto', args: '--foo', env: { A: '1' }, icon: '', effort: '', command: '', checkUrl: '' };
  const a = fillFromParse({ ...blankLauncher('claude') }, parsed);
  assert.deepEqual([a.name, a.startCommand, a.model, a.permissionMode, a.args, a.env.A, a.id], ['ocx claude haiku', 'ocx claude', 'haiku', 'auto', '--foo', '1', null]);
  const b = fillFromParse({ ...blankLauncher('claude'), id: 'l1', name: 'Mine', icon: 'deepseek' }, parsed);
  assert.deepEqual([b.id, b.name, b.icon], ['l1', 'Mine', 'deepseek']);
  assert.equal(blankLauncher().startCommand, '');
});

test('P97 레일 이름 칸: 단추 오른쪽 10px, 단추 가운데 높이, 창 밖으로 나가지 않는다', () => {
  const p = popoverAt({ top: 300, right: 60, height: 36 }, { vw: 1280, vh: 800 });
  assert.deepEqual([p.left, p.top], [70, 292]);
  assert.ok(p.arrow >= 10 && p.arrow <= 80);
  const low = popoverAt({ top: 780, right: 60, height: 36 }, { vw: 1280, vh: 800 });
  assert.equal(low.top, 800 - 96 - 8, '아래로 넘치면 위로 올린다');
  assert.ok(low.arrow > p.arrow, '화살표는 단추를 따라 내려간다');
  const narrow = popoverAt({ top: 100, right: 1270, height: 36 }, { vw: 1280, vh: 800 });
  assert.equal(narrow.left, 1280 - 300 - 8);
});

test('P97 레일 이름 칸의 이름 규칙: 빈칸은 판이 짓고, 겹침·글자·all을 알린다(세션 이름 규칙과 같다)', () => {
  const sessions = [{ sessionId: 'a', name: 's1', address: 's1' }, { sessionId: 'b', name: 'Review', address: 'w2', label: 'Review' }];
  assert.deepEqual(checkLabel('', sessions, null), { ok: true, label: null });
  assert.deepEqual(checkLabel('  api-1 ', sessions, null), { ok: true, label: 'api-1' });
  assert.equal(checkLabel('S1', sessions, null).key, 'labelTaken');
  assert.equal(checkLabel('review', sessions, null).key, 'labelTaken');
  assert.equal(checkLabel('리뷰', sessions, null).key, 'labelBad');
  assert.equal(checkLabel('all', sessions, null).key, 'labelAll');
  assert.equal(checkLabel('x'.repeat(33), sessions, null).key, 'labelTooLong');
});

test('P97 새 글은 두 사전에 있다', () => {
  const keys = ['launcherStart.label', 'launcherStart.ph', 'launcherStart.title', 'launcherStart.bad', 'launcherStart.reserved', 'launcherStart.notFound', 'launcherStart.failed',
    'launcherPaste.label', 'launcherPaste.ph', 'launcherPaste.fill', 'launcherPaste.hint', 'launcherPaste.failed', 'launcherPaste.board', 'launcherPaste.agent',
    'launcherPaste.command_unknown', 'launcherPaste.command_wrapperNotClaude', 'launcherPaste.command_quoted', 'launcherPaste.command_envNotClaude',
    'launcherPaste.start', 'launcherPaste.mapped', 'launcherPaste.env', 'launcherPaste.path', 'launcherPaste.dropped', 'launcherPaste.skipped',
    'launcherPaste.field.model', 'launcherPaste.field.effort', 'launcherPaste.field.permissionMode', 'launcherPaste.field.args',
    'launcherPin.label', 'launcherPin.created', 'quickName.where', 'quickName.label', 'quickName.ph', 'quickName.go', 'quickName.starting', 'quickName.hint', 'quickName.hintPhone', 'quickName.addLauncher'];
  for (const lang of ['en', 'ko']) for (const k of keys) assert.notEqual(translate(lang, k, { cmd: 'ocx', max: 120, arg: '--model', name: 'x', harness: 'Codex', ws: 'demo', field: 'model', names: 'A', path: 'p', args: 'a', lines: 'l' }), k, `${lang} ${k}`);
  assert.match(translate('ko', 'launcherStart.notFound', { cmd: 'ocx' }), /ocx/);
  assert.match(translate('en', 'launcherPaste.mapped', { arg: '--model', field: 'model' }), /--model → model/);
});
