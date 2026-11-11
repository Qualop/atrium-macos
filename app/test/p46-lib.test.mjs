// P46 시험: 덩어리 안 연결 글의 배율별 모양(lib/dock-links.js), 작업 관계도의 워크스페이스 무리 배치(lib/mission-layout.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { dockLabelLevel, fitDockLabel, labelSpot, dockLabelParts, dockRoutes, DOCK_LABEL_ZOOM, DOCK_LABEL_MIN, DOCK_LABEL_MAX } from '../src/renderer/lib/dock-links.js';
import { missionLayout, MISSION } from '../src/renderer/lib/mission-layout.js';

// ---------- 연결 글 ----------
test('P46: 배율별 모양 — 0.4 아래는 화살표 블록, 0.4부터 역할, 0.8부터 방향·역할·상태', () => {
  assert.equal(dockLabelLevel(0.1), 'mini');
  assert.equal(dockLabelLevel(0.3), 'mini');
  assert.equal(dockLabelLevel(DOCK_LABEL_ZOOM.short - 0.001), 'mini');
  assert.equal(dockLabelLevel(DOCK_LABEL_ZOOM.short), 'short');
  assert.equal(dockLabelLevel(0.6), 'short');
  assert.equal(dockLabelLevel(DOCK_LABEL_ZOOM.full), 'full');
  assert.equal(dockLabelLevel(1), 'full');
  assert.equal(dockLabelLevel(2.5), 'full');
});

test('P46: 자리에 맞추기 — 모자라면 한 단계씩 내리고, 글 길이는 자리의 70%와 상한 안', () => {
  // 1600 × 900 덩어리의 가로 반반: 경계 900px
  assert.deepEqual(fitDockLabel(0.3, 900).level, 'mini');
  assert.equal(fitDockLabel(0.6, 900).level, 'short');
  const f = fitDockLabel(1, 900);
  assert.equal(f.level, 'full');
  assert.ok(f.max * 1 <= DOCK_LABEL_MAX + 1e-9 && f.max <= 900 * 0.7, '상한');
  // 짧은 경계: 배율 1이라도 full 자리가 없으면 short, 그것도 없으면 mini
  const roomFor = (px) => px / 0.7; // 화면 px만큼의 글 자리가 나는 경계 길이(배율 1)
  assert.equal(fitDockLabel(1, roomFor(DOCK_LABEL_MIN.full - 1)).level, 'short');
  assert.equal(fitDockLabel(1, roomFor(DOCK_LABEL_MIN.short - 1)).level, 'mini');
  assert.equal(fitDockLabel(1, roomFor(DOCK_LABEL_MIN.full)).level, 'full');
  // 판 px로 돌려준다: 배율 0.5면 화면 상한 340px은 판 680px
  const h = fitDockLabel(0.9, 4000);
  assert.ok(Math.abs(h.max * 0.9 - DOCK_LABEL_MAX) < 1e-6);
  // 배율을 올려도 모양은 내려가지 않는다(같은 경계)
  const lv = ['mini', 'short', 'full'];
  let prev = 0;
  for (let z = 0.1; z <= 2; z += 0.05) { const i = lv.indexOf(fitDockLabel(z, 600).level); assert.ok(i >= prev, `배율 ${z.toFixed(2)}`); prev = i; }
});

test('P46: 다리는 경계 길이(같은 쌍 여럿이면 나눈 몫)를 span으로, 바깥 길 글 자리는 가장 긴 바깥 선분', () => {
  const rects = { a: { x: 0, y: 0, w: 800, h: 900 }, b: { x: 800, y: 0, w: 800, h: 900 } };
  const one = dockRoutes(rects, [{ linkId: 'l1', from: 'a', to: 'b' }]);
  assert.equal(one.bridges[0].span, 900);
  assert.equal(one.bridges[0].axis, 'v');
  const two = dockRoutes(rects, [{ linkId: 'l1', from: 'a', to: 'b' }, { linkId: 'l2', from: 'b', to: 'a' }]);
  assert.deepEqual(two.bridges.map((b) => b.span), [450, 450]);
  // 2 × 2 대각선: 둘레 길
  const q = { tl: { x: 0, y: 0, w: 800, h: 450 }, tr: { x: 800, y: 0, w: 800, h: 450 }, bl: { x: 0, y: 450, w: 800, h: 450 }, br: { x: 800, y: 450, w: 800, h: 450 } };
  const r = dockRoutes(q, [{ linkId: 'd', from: 'tl', to: 'br' }]).routes[0];
  const s = labelSpot(r.points);
  assert.ok(s.len > 0);
  const segs = r.points.slice(1, -1).map((p, i, a) => (i ? Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) : 0));
  assert.equal(s.len, Math.max(...segs));
  assert.equal(labelSpot([{ x: 0, y: 0 }, { x: 0, y: -10 }, { x: 0, y: 300 }, { x: 0, y: 290 }]).vertical, true);
  assert.equal(labelSpot([{ x: 0, y: 0 }, { x: 0, y: -10 }, { x: 300, y: -10 }, { x: 300, y: 0 }]).vertical, false);
});

test('P46: 글의 낱말 — 사용자가 붙인 역할 그대로, 없으면 띄움·작업 요청, 방향은 @시킨 쪽 → @받는 쪽', () => {
  const names = { a: 'lead', b: 'api-tests' };
  const w = { spawned: '세션 생성', directed: '작업 요청' };
  assert.deepEqual(dockLabelParts({ from: 'a', to: 'b', role: 'P31 worker' }, names, w), { role: 'P31 worker', dir: '@lead → @api-tests', spawnTag: false });
  assert.equal(dockLabelParts({ from: 'a', to: 'b', role: 'reviewer', spawned: true }, names, w).spawnTag, true);
  assert.equal(dockLabelParts({ from: 'a', to: 'b', spawned: true }, names, w).role, '세션 생성');
  assert.equal(dockLabelParts({ from: 'a', to: 'b', observed: true }, names, w).role, '작업 요청');
  assert.equal(dockLabelParts({ from: 'b', to: 'x' }, names, w).dir, '@api-tests → @?');
});

// ---------- 작업 관계도 무리 ----------
const H = { id: 'human', kind: 'human' };
const S = (id, ws, o = {}) => ({ id: `s:${id}`, kind: 'session', name: id, category: 'idle', workspaceKey: ws, ...o });
const E = (from, to, kind, o = {}) => ({ id: `${kind}:${from}>${to}`, from: from === 'human' ? 'human' : `s:${from}`, to: `s:${to}`, kind, ...o });
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (b, g) => b.x >= g.x && b.y >= g.y && b.x + b.w <= g.x + g.w && b.y + b.h <= g.y + g.h;

// 워크스페이스 셋(app, api, docs)에 걸친 세션 12개. lead(app)가 api·docs의 워커에게도 시킨다
const three = () => ({
  nodes: [H,
    S('lead', 'C:/w/app/', { category: 'working' }), S('ui', 'C:/w/app/', { parentId: 's:lead' }), S('ui-tests', 'C:/w/app/', { category: 'needs_you', parentId: 's:ui' }), S('app-notes', 'C:/w/app/'),
    S('api-lead', 'C:/w/api/'), S('api-tests', 'C:/w/api/', { category: 'needs_you', parentId: 's:lead' }), S('schema', 'C:/w/api/', { parentId: 's:api-lead' }), S('perf', 'C:/w/api/', { category: 'working' }),
    S('ko-copy', 'C:/w/docs/', { parentId: 's:lead' }), S('reviewer', 'C:/w/docs/', { parentId: 's:ko-copy' }), S('en-copy', 'C:/w/docs/'), S('glossary', 'C:/w/docs/', { category: 'needs_you' })],
  edges: [E('human', 'lead', 'bar', { count: 3 }), E('human', 'api-lead', 'bar'), E('lead', 'ui', 'role', { label: 'P31 worker' }), E('ui', 'ui-tests', 'role', { label: 'test worker' }),
    E('lead', 'api-tests', 'role', { label: 'api tests' }), E('api-lead', 'schema', 'spawn'), E('lead', 'ko-copy', 'role', { label: 'ko copy' }), E('ko-copy', 'reviewer', 'role', { label: 'reviewer' }),
    E('api-lead', 'en-copy', 'prompt', { label: 'translate' })],
});
const ORDER = ['C:/w/app/', 'C:/w/api/', 'C:/w/docs/'];

test('P46 adapted: team plates keep cross-workspace workers beside their lead without overlap', () => {
  const lay = missionLayout(three(), { order: ORDER });
  assert.deepEqual(lay.groups.map((g) => g.key), ORDER);
  assert.deepEqual(lay.groups.map((g) => [g.count, g.needs]), [[7, 2], [4, 0], [1, 1]]);
  assert.equal(lay.groups.reduce((n, g) => n + g.count, 0), 12);
  for (const b of lay.boxes.values()) {
    if (b.node.kind === 'human') continue;
    const g = lay.groups.find((g) => g.key === b.group);
    assert.ok(inside(b, g.plate), `${b.node.name} stays inside its displayed team plate`);
  }
  const boxes = [...lay.boxes.values()];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!hit(boxes[i], boxes[j]), `${boxes[i].node.id} × ${boxes[j].node.id}`);
  for (let i = 0; i < lay.groups.length; i++) for (let j = i + 1; j < lay.groups.length; j++) assert.ok(!hit(lay.groups[i].plate, lay.groups[j].plate));
  for (const id of ['ui', 'api-tests', 'ko-copy']) {
    const b = lay.boxes.get(`s:${id}`); assert.equal(b.depth, 2); assert.equal(b.group, 'C:/w/app/');
  }
  assert.equal(lay.boxes.get('s:reviewer').depth, 3);
  assert.deepEqual(lay.loose.sort(), ['s:app-notes', 's:glossary', 's:perf']);
  assert.ok(lay.groups.find((g) => g.key === 'C:/w/docs/').packed, 'a standalone project fills free space to the right');
  assert.ok(lay.boxes.get('human').x + lay.boxes.get('human').w < lay.groups[0].plate.x);
});

test('P46 adapted: cross-workspace relationships retain role context while routing within the team', () => {
  const lay = missionLayout(three(), { order: ORDER });
  assert.deepEqual(lay.edges.filter((e) => e.cross).map((e) => `${e.from}>${e.to}`).sort(), ['s:api-lead>s:en-copy', 's:lead>s:api-tests', 's:lead>s:ko-copy']);
  const ko = lay.edges.find((e) => e.to === 's:ko-copy');
  assert.equal(ko.role, 'ko copy'); assert.ok(ko.tree);
  assert.equal(lay.boxes.get(ko.to).group, lay.boxes.get(ko.from).group);
  assert.notEqual(lay.boxes.get(ko.to).node.workspaceKey, lay.boxes.get(ko.from).node.workspaceKey);
  for (const edge of lay.edges) {
    assert.ok(lay.boxes.has(edge.from) && lay.boxes.has(edge.to));
    assert.ok(edge.d && !/NaN|Infinity/.test(edge.d));
    assert.ok(!edge.label, 'the final map keeps text in card details and hover context');
  }
});

test('P46 adapted: collapse hides the displayed team and preserves cross-project workers in their parent team', () => {
  const open = missionLayout(three(), { order: ORDER });
  const docs = missionLayout(three(), { order: ORDER, collapsed: ['C:/w/docs/'] });
  assert.equal(docs.groups.find((g) => g.key === 'C:/w/docs/').count, 1);
  assert.ok(!docs.boxes.has('s:glossary')); assert.ok(docs.boxes.get('g:C:/w/docs/').proxy);
  for (const id of ['ko-copy', 'reviewer', 'en-copy']) assert.ok(docs.boxes.has(`s:${id}`), 'workers stay with their lead');
  assert.equal(docs.boxes.get('s:ui').y, open.boxes.get('s:ui').y);
  const folded = missionLayout(three(), { order: ORDER, collapsed: ['C:/w/app/'] });
  assert.equal(folded.groups.find((g) => g.key === 'C:/w/app/').count, 7);
  for (const id of ['lead', 'ui', 'ui-tests', 'api-tests', 'ko-copy', 'reviewer', 'app-notes']) assert.ok(!folded.boxes.has(`s:${id}`));
  assert.ok(folded.boxes.get('g:C:/w/app/').proxy);
  assert.ok(folded.edges.some((e) => e.from === 'human' && e.to === 'g:C:/w/app/'));
  assert.ok(folded.edges.every((e) => e.from !== e.to && folded.boxes.has(e.from) && folded.boxes.has(e.to)));
  assert.ok(folded.height < open.height);
});

test('P46 adapted: filtering preserves plate positions and identifies matches through the shared tier model', async () => {
  const { nodeTier, filterMatch } = await import('../src/renderer/lib/mission-model.js');
  const graph = three(), all = missionLayout(graph, { order: ORDER });
  const filtered = missionLayout(graph, { order: ORDER, filter: 'needs_you' });
  assert.deepEqual([...filtered.boxes], [...all.boxes]); assert.deepEqual(filtered.groups, all.groups);
  assert.deepEqual(graph.nodes.filter((n) => n.kind === 'session' && filterMatch(nodeTier(n), 'needs_you')).map((n) => n.name).sort(), ['api-tests', 'glossary', 'ui-tests']);
  const unassigned = missionLayout({ nodes: [H, S('a', 'C:/w/app/'), S('b', null)], edges: [] }, { order: ORDER });
  assert.deepEqual(unassigned.groups.map((g) => g.key), ['C:/w/app/', '']);
});
