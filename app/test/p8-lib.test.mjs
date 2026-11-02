// P8(K4) 창 쪽 순수 규칙 시험: 하위 세션 머리줄 글, 사이드바·미션 맵의 나무 순서와 들여 쓰기
import test from 'node:test';
import assert from 'node:assert/strict';
import { branchLabel, treeOrder } from '../src/renderer/lib/branch.js';
import { missionLayout, MISSION } from '../src/renderer/lib/items.js';
import { setLanguage } from '../src/renderer/lib/i18n.js';

test('K4: 머리줄 — atrium child로 만든 하위 세션만 "@부모의 역할 · n단계"', () => {
  setLanguage('ko'); // P16: 한국어 글을 본다(기본은 영어)
  try {
    assert.equal(branchLabel({ branch: { child: true, parentName: 'lead', role: '워커', depth: 2, parentOpen: true } }).text, '@lead의 워커 · 2단계');
    assert.match(branchLabel({ branch: { child: true, parentName: null, role: '리뷰어', depth: 3, parentOpen: false } }).text, /리뷰어 \(상위 세션 닫힘\) · 3단계/);
  } finally { setLanguage('en'); }
  assert.equal(branchLabel({ branch: { child: false, depth: 2, parentName: 'lead' } }), null); // 판에 올린 에이전트는 지금 표시 그대로
  assert.equal(branchLabel({}), null);
});

test('K4: 나무 순서 — 부모 바로 아래에 자식(형제는 주어진 순서), 부모가 목록에 없으면 뿌리, 고리도 빠지지 않는다', () => {
  const S = (id, p, t) => ({ sessionId: id, parentSessionId: p, t });
  const list = [S('w2', 'lead', 3), S('lead', null, 1), S('g1', 'w1', 4), S('other', null, 2), S('w1', 'lead', 5), S('lost', 'gone', 6), S('x', 'y', 7), S('y', 'x', 8)];
  const out = treeOrder(list, { cmp: (a, b) => a.t - b.t });
  assert.deepEqual(out.map((o) => `${o.item.sessionId}:${o.indent}`), ['lead:0', 'w2:1', 'w1:1', 'g1:2', 'other:0', 'lost:0', 'x:0', 'y:1']);
});

test('K4: 미션 맵 — 하위 세션은 부모 순서대로 모이고 깊이만큼 들여 쓴다', () => {
  const sess = (id, name, column, depth, parentId, category = 'idle') => ({ id, kind: 'session', name, column, depth, parentId, category });
  const graph = { nodes: [{ id: 'human', kind: 'human', column: 0 }, sess('s:b', 'b-lead', 0, 1, null), sess('s:a', 'a-lead', 0, 1, null), sess('s:bw', 'zz', 2, 2, 's:b'), sess('s:aw', 'yy', 2, 2, 's:a'), sess('s:solo', 'aaa', 2, 1, null, 'working')], edges: [] };
  const lay = missionLayout(graph);
  const y = (id) => lay.boxes.get(id).y;
  assert.ok(y('s:a') < y('s:b')); // 이름 순
  assert.ok(y('s:solo') < y('s:aw') && y('s:aw') < y('s:bw')); // 오른쪽 열: 뿌리(작업 중) 먼저, 그다음 부모 순서대로
  assert.equal(lay.boxes.get('s:aw').x - lay.boxes.get('s:solo').x, MISSION.indent);
  assert.equal(lay.boxes.get('s:aw').w, MISSION.colW - MISSION.indent);
});
