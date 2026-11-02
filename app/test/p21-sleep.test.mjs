// P21 창 단위 시험: 잠든 세션(ARCH 5절 잠재우기, 기능 번호 D4 제안)은 내 차례·문제 목록에 나오지 않고, 상태 글과 색이 있으며, 터미널을 붙일 노드로 고르지 않는다
import test from 'node:test';
import assert from 'node:assert/strict';
import { inboxOf } from '../src/renderer/lib/faces.js';
import { STATE_LABEL, WAIT_REASON_LABEL } from '../src/renderer/lib/labels.js';
import { stateColor } from '../src/renderer/lib/kinds.js';
import { setLanguage, t, errText } from '../src/renderer/lib/i18n.js';
import { repoSleep, memByRepo } from '../src/renderer/lib/repo-sleep.js';

test('D4: 잠든 세션은 내 차례·문제 목록에 없고, 안 본 답이면 검토 목록에 남는다', () => {
  const list = [
    { sessionId: 'a', state: 'sleeping', unseen: true, createdAt: 1, turn: { endedAt: 2 } },
    { sessionId: 'b', state: 'waiting', createdAt: 1, ask: { since: 1 } },
    { sessionId: 'c', state: 'sleeping', unseen: false, createdAt: 1, sleep: { at: 3, error: { code: 'resume_failed' } } },
  ];
  const r = inboxOf(list);
  assert.deepEqual(r.needsYou.map((s) => s.sessionId), ['b']);
  assert.deepEqual(r.review.map((s) => s.sessionId), ['a']);
  assert.deepEqual(r.problems, []);
});

test('D4: 잠듦 상태 글(영어·한국어), 전달 기다림 이유, 상태 색, 잠재우지 않는 까닭', () => {
  setLanguage('en');
  assert.equal(STATE_LABEL.sleeping, 'Asleep');
  assert.equal(WAIT_REASON_LABEL.sleeping, 'asleep, waking it');
  assert.equal(stateColor('sleeping'), 'var(--st-sleeping)');
  assert.equal(errText({ key: 'sleepRefused', vars: { name: 'a1', reason: { key: 'sleepWhy_working' } } }), '@a1 is not put to sleep now: working');
  setLanguage('ko');
  assert.equal(STATE_LABEL.sleeping, '절전 중');
  assert.equal(t('sleep.memAsleep', { n: 2, mb: '900MB' }), '세션 2개 절전 중 · 메모리 900MB 절약');
  assert.equal(errText({ key: 'sleepRefused', vars: { name: 'a1', reason: { key: 'sleepWhy_needs_you' } } }), '@a1 세션을 지금 절전 모드로 전환할 수 없습니다: 사용자의 응답이 필요합니다.');
  setLanguage('en');
});

// P24: 리포 단위 잠재우기(영역 이름표, 메모리 알약 목록의 리포별 묶음, 리포 잠재우기 거부 글)
test('P24: 영역 이름표의 잠듦과 메모리 목록의 리포별 묶음', () => {
  const sums = [
    { sessionId: 'a1', name: 'a1', workspaceKey: 'ka', state: 'sleeping', sleep: { memMB: 500 } },
    { sessionId: 'a2', name: 'a2', workspaceKey: 'ka', state: 'sleeping', sleep: { memMB: 450 }, waking: { at: 1 } },
    { sessionId: 'sh', name: 'sh', workspaceKey: 'ka', state: 'shell_idle', sleepable: false },
    { sessionId: 'b1', name: 'b1', workspaceKey: 'kb', state: 'ready', sleepable: true },
    { sessionId: 'b2', name: 'b2', workspaceKey: 'kb', state: 'sleeping', sleep: { memMB: 400 } },
  ];
  assert.deepEqual(repoSleep(sums, 'ka'), { asleep: 2, waking: 1, awake: 0, mb: 950, all: true });
  assert.deepEqual(repoSleep(sums, 'kb'), { asleep: 1, waking: 0, awake: 1, mb: 400, all: false });
  assert.deepEqual(repoSleep(sums, 'kc'), { asleep: 0, waking: 0, awake: 0, mb: 0, all: false });
  const rows = [{ sessionId: 'sh', name: 'sh', memMB: 90 }, { sessionId: 'b1', name: 'b1', memMB: 480 }, { sessionId: 'b2', name: 'b2', memMB: 470 }];
  const g = memByRepo(rows, new Map(sums.map((s) => [s.sessionId, s])), [{ key: 'ka', name: 'repo-a' }, { key: 'kb', name: 'repo-b' }]);
  assert.deepEqual(g.map((x) => [x.name, x.memMB, x.rows.map((r) => r.name), x.asleep.map((s) => s.name), x.savedMB]), [
    ['repo-b', 480, ['b1'], ['b2'], 400], // 잰 뒤 잠든 b2는 잠든 줄로만
    ['repo-a', 90, ['sh'], ['a1', 'a2'], 950],
  ]);
  setLanguage('ko');
  assert.equal(errText({ key: 'repoSleepRefused', vars: { repo: 'repo-b', name: '@b2', reason: { key: 'sleepWhy_working' } } }), 'repo-b 프로젝트를 지금 절전 모드로 전환할 수 없습니다: @b2 작업을 진행하고 있습니다.');
  assert.equal(t('sleep.trayItem'), '대기 중인 프로젝트 모두 절전 모드로');
  setLanguage('en');
  assert.equal(errText({ key: 'repoSleepRefused', vars: { repo: 'repo-b', name: '@b2', reason: { key: 'sleepWhy_working' } } }), 'repo-b is not put to sleep now: @b2 working');
  assert.equal(t('sleep.sleepIdleDone', { repos: 2, n: 3, mb: '1.4GB' }), 'Put 2 repo(s) to sleep: 3 sessions (1.4GB saved)');
});
