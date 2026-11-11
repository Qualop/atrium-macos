// P108: 칸 수·방향·덩어리 밖 연결과 상관없이 세션 안쪽에는 선 장식을 놓지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getBezierPath, Position } from '@xyflow/react';
import { facingSides } from '../../backend/src/links.mjs';
import { layout } from '../../backend/src/dock-tree.mjs';
import { edgeGap, innerEnds, pointInSessions, linkLabelHidden, decorateEdges, shifted } from '../src/renderer/lib/link-labels.js';

const at = (r, s) => ({ x: r.x + (s === 'l' ? 0 : s === 'r' ? r.w : r.w / 2), y: r.y + (s === 't' ? 0 : s === 'b' ? r.h : r.h / 2) });
const pos = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom };
const branch = (dir, kids) => ({ dir, kids, ratios: kids.map(() => 1 / kids.length) });

for (const n of [2, 3, 4, 5]) for (const leadInside of [false, true]) for (const both of [false, true]) for (const extra of [false, true]) {
  test(`P108 장식: ${n}칸 / 리드 ${leadInside ? '안' : '밖'} / ${both ? '양방향' : '한쪽'} / 밖 선 ${extra}`, () => {
    const ids = Array.from({ length: n }, (_, i) => `c${i}`);
    const tree = n === 2 ? branch('row', ids) : branch('row', [ids[0], branch('col', ids.slice(1))]);
    const outer = { x: 600, y: 0, w: 1200, h: 900 };
    const rects = layout(tree, outer).rects;
    rects.set('lead', { x: 0, y: 200, w: 500, h: 450 });
    rects.set('remote', { x: 2000, y: 100, w: 500, h: 450 });
    const all = [...rects.values()], links = new Map(), edges = [];
    const add = (from, to) => {
      const id = `${from}-${to}`, a = rects.get(from), b = rects.get(to), sides = facingSides(a, b);
      links.set(id, { linkId: id, from, to, prompts: 3, lastText: 'test', lastAt: 1 });
      edges.push({ id, type: 'link', source: from, target: to, ...sides, data: { ...edgeGap(a, b, sides, all), ...innerEnds(a, b, sides, ids.includes(from) ? outer : null, ids.includes(to) ? outer : null, all), labelRects: all } });
    };
    const lead = leadInside ? ids[0] : 'lead';
    for (const id of ids.filter(id => id !== lead)) { add(lead, id); if (both) add(id, lead); }
    if (extra) for (const id of ids) { add(id, 'remote'); if (both) add('remote', id); }
    decorateEdges(edges, { rectOf: id => rects.get(id), links, sessions: new Map() });
    for (const e of edges) {
      const p = at(rects.get(e.source), e.sourceHandle), q = at(rects.get(e.target), e.targetHandle);
      const [, x0, y0] = getBezierPath({ sourceX: p.x, sourceY: p.y, targetX: q.x, targetY: q.y, sourcePosition: pos[e.sourceHandle], targetPosition: pos[e.targetHandle] });
      const [x, y] = shifted(x0, y0, e.data);
      if (e.data.label && pointInSessions(x, y, all)) assert.equal(linkLabelHidden(e.data, { x, y }), true, e.id);
      if (pointInSessions(p.x, p.y, all)) assert.equal(e.data.hideSource, true, e.id);
      if (pointInSessions(q.x, q.y, all)) assert.equal(e.data.hideTarget, true, e.id);
      assert.equal(linkLabelHidden(e.data, { x, y, hot: true }), false, '고른 선·대화상자 예외');
    }
  });
}

test('P108: 이름표가 비켜 놓인 뒤 덩어리 칸에 들어가면 실제 그릴 자리에서 숨긴다', () => {
  const a = { x: 0, y: 400, w: 500, h: 400 }, b = { x: 1600, y: 400, w: 500, h: 400 };
  const cell = { x: 1100, y: 500, w: 420, h: 300 };
  const rects = new Map([['a', a], ['b', b], ['c', b], ['cell', cell]]), all = [...rects.values()];
  const links = new Map(['b', 'c'].map(to => [`a-${to}`, { linkId: `a-${to}`, from: 'a', to, lastText: 'test', prompts: 3 }]));
  const edges = [...links.values()].map(l => ({ id: l.linkId, type: 'link', source: l.from, target: l.to, sourceHandle: 'r', targetHandle: 'l', data: { ...edgeGap(a, b, { sourceHandle: 'r', targetHandle: 'l' }, all), labelRects: all } }));
  decorateEdges(edges, { rectOf: id => rects.get(id), links, sessions: new Map() });
  const moved = edges.find(e => e.data.shift);
  assert.ok(moved, '겹친 두 이름표 중 하나가 움직여야 한다');
  const [x, y] = shifted(1050, 600, moved.data);
  assert.equal(moved.data.blocked, undefined, '이동 전에는 빈자리');
  assert.equal(pointInSessions(x, y, [cell]), true, '이동 후에는 칸 안');
  assert.equal(linkLabelHidden(moved.data, { x, y }), true);
  assert.equal(linkLabelHidden(moved.data, { x, y, hot: true }), false);
});

test('P108: 자기 끝 위의 이름표와 가운데 끝 원, 다른 칸 안의 끝 원도 숨긴다', () => {
  const a = { x: 0, y: 0, w: 600, h: 400 }, b = { x: 300, y: 0, w: 600, h: 400 };
  const sides = { sourceHandle: 'c', targetHandle: 'c' };
  assert.equal(edgeGap(a, b, sides).blocked, true);
  assert.deepEqual(innerEnds(a, b, sides), { hideSource: true, hideTarget: true });
  assert.deepEqual(innerEnds(a, b, { sourceHandle: 'r', targetHandle: 'l' }), { hideSource: true, hideTarget: true });
  assert.equal(pointInSessions(0, 200, [a]), false, '경계는 안쪽이 아니다');
  assert.equal(linkLabelHidden({ labelRects: [a] }, { x: 0, y: 200 }), false);
});
