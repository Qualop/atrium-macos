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
const inside = (b, g) => b.x >= g.x && b.y >= g.y + MISSION.groupHead && b.x + b.w <= g.x + g.w && b.y + b.h <= g.y + g.h;

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

test('P46: 무리 — 워크스페이스마다 하나, 판의 영역 차례, 이름표 수(세션·응답 필요), 상자는 자기 무리 안, 겹치지 않음', () => {
  const lay = missionLayout(three(), { order: ORDER });
  assert.deepEqual(lay.groups.map((g) => g.key), ORDER);
  assert.deepEqual(lay.groups.map((g) => [g.count, g.needs]), [[4, 1], [4, 1], [4, 1]]);
  for (const b of lay.boxes.values()) {
    if (b.node.kind === 'human') continue;
    const g = lay.groups.find((x) => x.key === b.node.workspaceKey);
    assert.ok(inside(b, g), `${b.node.name}는 ${g.key} 무리 안`);
  }
  const bs = [...lay.boxes.values()];
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) assert.ok(!hit(bs[i], bs[j]), `${bs[i].node.id} × ${bs[j].node.id}`);
  for (let i = 0; i < lay.groups.length; i++) for (let j = i + 1; j < lay.groups.length; j++) assert.ok(!hit(lay.groups[i], lay.groups[j]), '무리끼리 겹치지 않는다');
  assert.ok(lay.groups[0].y + lay.groups[0].h < lay.groups[1].y && lay.groups[1].y + lay.groups[1].h < lay.groups[2].y, '위에서 아래로');
  // 사람은 무리 밖 0열
  const h = lay.boxes.get('human');
  assert.ok(lay.groups.every((g) => h.x + h.w < g.x));
  // 열은 판 전체에서 같다: lead(1열)의 다른 무리 워커도 2열
  assert.equal(lay.boxes.get('s:lead').depth, 1);
  for (const k of ['ui', 'api-tests', 'ko-copy']) assert.equal(lay.boxes.get(`s:${k}`).depth, 2, k);
  assert.equal(lay.boxes.get('s:reviewer').depth, 3);
  assert.equal(lay.boxes.get('s:api-tests').x, lay.boxes.get('s:ui').x);
  // 무리 안 연결 없는 세션은 그 무리 격자(나무 아래)
  assert.deepEqual(lay.loose.sort(), ['s:app-notes', 's:glossary', 's:perf']);
  const app = lay.groups[0];
  assert.ok(app.looseAt && lay.boxes.get('s:app-notes').y > lay.boxes.get('s:ui-tests').y);
  // 순서를 모르면 키 이름 순
  assert.deepEqual(missionLayout(three()).groups.map((g) => g.key), ['C:/w/api/', 'C:/w/app/', 'C:/w/docs/']);
});

test('P46: 무리를 건너는 지시 — cross로 표시, 이름표 있음, 선은 열 사이 틈으로만 지나고 무리 안 선은 cross가 아니다', () => {
  const lay = missionLayout(three(), { order: ORDER });
  const cross = lay.edges.filter((e) => e.cross).map((e) => `${e.from}>${e.to}`).sort();
  assert.deepEqual(cross, ['s:api-lead>s:en-copy', 's:lead>s:api-tests', 's:lead>s:ko-copy']);
  const ko = lay.edges.find((e) => e.to === 's:ko-copy');
  assert.equal(ko.fromGroup, 'C:/w/app/'); assert.equal(ko.toGroup, 'C:/w/docs/');
  assert.ok(ko.label && ko.tree, '나무 선이고 이름표가 있다');
  assert.ok(!lay.edges.find((e) => e.to === 's:ui').cross);
  assert.ok(!lay.edges.find((e) => e.from === 'human' && e.to === 's:lead').cross, '사람에게서 오는 선은 무리를 건너지 않는다');
  // 앞으로 가는 선(왼쪽 → 오른쪽)은 시킨 상자의 오른쪽 끝에서 받는 상자의 왼쪽 끝까지 — 그 사이에 다른 상자가 없다
  for (const e of lay.edges.filter((x) => !x.back)) {
    const a = lay.boxes.get(e.from), b = lay.boxes.get(e.to);
    for (const o of lay.boxes.values()) assert.ok(!(o.x < b.x && o.x + o.w > a.x + a.w), `${e.id}의 틈에 ${o.node.id}`);
  }
  // 이름표는 상자를 덮지 않는다
  for (const e of lay.edges.filter((x) => x.label)) {
    const r = { x: e.lx - MISSION.labelW, y: e.ly - 9, w: MISSION.labelW, h: 18 };
    for (const b of lay.boxes.values()) assert.ok(!hit(r, b), `${e.id} 이름표 × ${b.node.id}`);
  }
});

test('P46: 접은 무리 — 머리줄만, 그 세션들로 가는 선은 머리줄 대리 상자로 모인다, 다른 무리는 그대로', () => {
  const open = missionLayout(three(), { order: ORDER });
  const lay = missionLayout(three(), { order: ORDER, collapsed: ['C:/w/docs/'] });
  const docs = lay.groups.find((g) => g.key === 'C:/w/docs/');
  assert.equal(docs.collapsed, true);
  assert.equal(docs.h, MISSION.groupHead);
  assert.equal(docs.count, 4, '접어도 수는 그대로');
  for (const k of ['ko-copy', 'reviewer', 'en-copy', 'glossary']) assert.ok(!lay.boxes.has(`s:${k}`), k);
  const px = lay.boxes.get('g:C:/w/docs/');
  assert.ok(px && px.proxy && px.y === docs.y);
  // lead → ko-copy, api-lead → en-copy 가 대리 상자로. ko-copy → reviewer(안쪽)는 사라진다
  const into = lay.edges.filter((e) => e.to === 'g:C:/w/docs/').map((e) => e.from).sort();
  assert.deepEqual(into, ['s:api-lead', 's:lead']);
  assert.ok(lay.edges.every((e) => e.from !== e.to));
  assert.ok(lay.edges.find((e) => e.to === 'g:C:/w/docs/' && e.from === 's:lead').cross);
  // 위 무리는 자리가 그대로, 판 높이는 줄어든다
  assert.equal(lay.boxes.get('s:ui').y, open.boxes.get('s:ui').y);
  assert.ok(lay.height < open.height);
  // 접은 무리 쪽 세션이 시킨 선도 대리 상자에서 나온다
  const back = missionLayout(three(), { order: ORDER, collapsed: ['C:/w/app/'] });
  assert.deepEqual(back.edges.filter((e) => e.from === 'g:C:/w/app/').map((e) => e.to).sort(), ['s:api-tests', 's:ko-copy']);
  assert.ok(back.edges.some((e) => e.from === 'human' && e.to === 'g:C:/w/app/'), '사람 → 접은 무리');
});

test('P46: 거르기와 무리 — 맞는 세션이 없는 무리는 빠지고, 조상은 자기 무리에 흐리게', () => {
  const lay = missionLayout(three(), { order: ORDER, filter: 'needs_you' });
  assert.deepEqual(lay.groups.map((g) => [g.key, g.shown]), [['C:/w/app/', 3], ['C:/w/api/', 1], ['C:/w/docs/', 1]]);
  assert.equal(lay.boxes.get('s:lead').ghost, true);
  assert.equal(lay.boxes.get('s:api-tests').ghost, false);
  const work = missionLayout(three(), { order: ORDER, filter: 'working' });
  assert.deepEqual(work.groups.map((g) => g.key), ['C:/w/app/', 'C:/w/api/']);
  // 워크스페이스가 없는 세션은 맨 아래 '' 무리
  const g = missionLayout({ nodes: [H, S('a', 'C:/w/app/'), S('b', null)], edges: [] }, { order: ORDER });
  assert.deepEqual(g.groups.map((x) => x.key), ['C:/w/app/', '']);
});
