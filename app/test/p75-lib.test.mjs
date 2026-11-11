// P75 창 쪽 순수 규칙 시험: 역할 칩의 띄운 순서 번호, 사이드바와 미션 맵의 하위 세션은 띄운 순서
import test from 'node:test';
import assert from 'node:assert/strict';
import { branchLabel } from '../src/renderer/lib/branch.js';
import { buildRows } from '../src/renderer/lib/sidebar-tree.js';
import { missionLayout } from '../src/renderer/lib/mission-layout.js';
import { setLanguage } from '../src/renderer/lib/i18n.js';

test('P75 역할 칩: 띄운 순서를 역할 뒤에("@lead의 워커 3 · 2단계"), 번호가 없으면 지금처럼', () => {
  setLanguage('ko');
  try {
    const l = branchLabel({ branch: { child: true, parentName: 's12', role: '워커', order: 3, depth: 2, parentOpen: true } });
    assert.equal(l.text, '@s12의 워커 3 · 2단계');
    assert.match(l.title, /3번째/);
    assert.equal(branchLabel({ branch: { child: true, parentName: null, role: '리뷰어', order: 2, depth: 3, parentOpen: false } }).text, '리뷰어 2 (상위 세션 닫힘) · 3단계');
    assert.equal(branchLabel({ branch: { child: true, parentName: 'lead', role: '워커', depth: 2, parentOpen: true } }).text, '@lead의 워커 · 2단계');
  } finally { setLanguage('en'); }
  assert.equal(branchLabel({ branch: { child: true, parentName: 's12', role: 'worker', order: 3, depth: 2, parentOpen: true } }).text, "@s12's worker 3 · level 2");
});

test('P75 사이드바: 하위 세션은 부모 아래에 띄운 순서(최근 활동이나 응답 필요와 상관없이). 뿌리는 지금 순서', () => {
  const W = { key: 'a', name: 'a', root: 'C:/a' };
  const S = (name, extra = {}) => ({ sessionId: `id-${name}`, name, kind: 'claude', state: 'ready', workspaceKey: 'a', ...extra });
  const kid = (name, order, extra = {}) => S(name, { parentSessionId: 'id-lead', createdAt: 100 + order, lastActivityAt: 1000 - order, branch: { child: true, order }, ...extra });
  const sessions = [S('lead', { createdAt: 1, lastActivityAt: 5 }), kid('w3', 3), kid('w1', 1), kid('w2', 2, { state: 'waiting' }), kid('w4', 4, { lastActivityAt: 99999 })];
  const { rows } = buildRows({ workspaces: [W], groups: [], sessions });
  assert.deepEqual(rows.filter((r) => r.type === 'session').map((r) => r.s.name), ['lead', 'w1', 'w2', 'w3', 'w4']);
});

test('P75 미션 맵: 형제는 띄운 순서로 위에서 아래(이름 순이 아니다), 번호가 없으면 띄운 때', () => {
  const sess = (id, name, parentId, order, createdAt) => ({ id, kind: 'session', name, depth: parentId ? 2 : 1, parentId, order, createdAt, category: 'idle' });
  const graph = { nodes: [{ id: 'human', kind: 'human', column: 0 }, sess('s:l', 'lead', null), sess('s:z', 'zz', 's:l', 1, 10), sess('s:a', 'aa', 's:l', 2, 20), sess('s:m', 'mm', 's:l', 3, 5), sess('s:o', 'old', 's:l', null, 1)],
    edges: ['s:z', 's:a', 's:m', 's:o'].map((to, i) => ({ id: `e${i}`, from: 's:l', to, kind: 'spawn' })) };
  const lay = missionLayout(graph);
  const ys = ['s:z', 's:a', 's:m', 's:o'].map((id) => lay.boxes.get(id).y);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1], `순서 ${i}`);
});
