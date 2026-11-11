// P95 시험: 미션 맵 카드의 메타 줄 자료(mission.graph 노드의 모델·노력 수준·턴 시작·마지막 활동·워크트리 브랜치)
import test from 'node:test';
import assert from 'node:assert/strict';
import { missionGraph } from '../src/mission.mjs';

const S = (id, o = {}) => ({ sessionId: id, name: id, state: 'ready', kind: 'claude', workspaceKey: 'w', createdAt: 1, ...o });

test('mission.graph 노드: 모델·노력 수준, 일하는 동안만 턴 시작, 마지막 활동, 워크트리일 때만 브랜치', () => {
  const sessions = [
    S('a', { model: 'claude-opus-5-5', effort: 'high', state: 'working', turn: { startedAt: 1000, endedAt: null }, lastActivityAt: 2000, git: { isWorktree: true, branch: 'worktree-a' } }),
    S('b', { model: 'haiku', state: 'ready', turn: { startedAt: 500, endedAt: 900 }, lastActivityAt: 900, git: { isWorktree: false, branch: 'main' } }),
    S('c', { kind: 'shell' }),
  ];
  const m = missionGraph({ sessions });
  const n = (id) => m.nodes.find((x) => x.id === `s:${id}`);
  assert.deepEqual([n('a').model, n('a').effort, n('a').turnAt, n('a').activeAt, n('a').gitBranch], ['claude-opus-5-5', 'high', 1000, 2000, 'worktree-a']);
  assert.deepEqual([n('b').model, n('b').effort, n('b').turnAt, n('b').activeAt, n('b').gitBranch], ['haiku', null, null, 900, null], '쉬는 세션은 턴 시작이 없고, 워크트리가 아니면 브랜치가 없다');
  assert.deepEqual([n('c').model, n('c').effort, n('c').turnAt, n('c').activeAt, n('c').gitBranch], [null, null, null, null, null]);
  // 지난 필드는 그대로
  assert.equal(n('a').category, 'working'); assert.equal(n('a').workspaceKey, 'w');
});
