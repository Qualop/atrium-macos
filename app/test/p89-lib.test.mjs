// P89 → P95 단위 시험: 휴대폰 미션 맵 배치(lib/phone-graph.js). 화면 폭을 칸으로 나누고(세로 2, 가로 4), 팀은 두 칸(리드 → 하위, 왼쪽 → 오른쪽),
// 혼자인 워크스페이스는 한 칸 기둥으로 채운다. 다른 워크스페이스 하위도 부모 팀 안, 접기, 동그라미 줄, 나무 밖 연결, 50개 판, 강조 등급, 보기(fit·clamp·focus)
import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneMission } from '../src/renderer/lib/phone-mission.js';
import { phoneGraph, PG, VIEW, lanesFor, fitView, clampView, zoomRange, focusView, inFocus, vpKey } from '../src/renderer/lib/phone-graph.js';

const node = (id, ws, o = {}) => ({ id: `s:${id}`, kind: 'session', sessionId: id, name: id, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: ws, parentId: null, role: null, order: null, createdAt: 0, loops: 0, ...o });
let clock = 0;
const kid = (id, ws, parent, o = {}) => node(id, ws, { parentId: `s:${parent}`, role: o.role || `r-${id}`, order: ++clock, createdAt: clock, ...o });
const P = { w: 393, h: 852 - 140 }, L = { w: 852, h: 393 - 110 }; // 세로·가로의 그래프 칸(머리줄·요약을 뺀 대략)
const gw = (vp) => vp.w - 2 * VIEW.PAD; // 그래프 폭(PhoneMission.jsx와 같다)

// 겹침 없음: 카드·한 줄·동그라미 사각형끼리 서로 닿지 않는다
function noOverlap(g) {
  for (let i = 0; i < g.nodes.length; i++) for (let j = i + 1; j < g.nodes.length; j++) {
    const a = g.nodes[i], b = g.nodes[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return `${a.id} ↔ ${b.id}`;
  }
  return null;
}
const at = (g) => Object.fromEntries(g.nodes.map((n) => [n.row.name, n]));
const inWidth = (g) => g.nodes.every((n) => n.x >= 0 && n.x + n.w <= g.width + 0.5);
// 한 기둥(같은 x)에 쌓인 것의 최대 수
const longest = (g) => { const m = new Map(); for (const n of g.nodes) m.set(n.x, (m.get(n.x) || 0) + 1); return Math.max(0, ...m.values()); };

function board() {
  clock = 0;
  const nodes = [
    { id: 'human', kind: 'human', name: 'you', column: 0 },
    node('lead', 'wa', { state: 'working', category: 'working', createdAt: 0 }),
    kid('rev', 'wa', 'lead', { role: 'reviewer', state: 'working' }), kid('test', 'wa', 'lead', { state: 'waiting', category: 'needs_you', ask: 'Bash: npm test' }),
    kid('help', 'wa', 'rev', { role: 'helper' }),
    kid('port', 'wc', 'lead', { role: 'porter' }), // 다른 무리의 하위 세션
    node('solo', 'wb', { state: 'sleeping', createdAt: 50 }), node('old', 'wc', { state: 'exited', category: 'exited', createdAt: 60 }),
  ];
  const edges = [
    { from: 's:lead', to: 's:rev', kind: 'role', label: 'reviewer', active: true },
    { from: 's:test', to: 's:help', kind: 'role', label: 'second opinion' }, // 나무 밖
    { from: 'human', to: 's:lead', kind: 'bar', count: 1 },
  ];
  return { nodes, edges };
}

test('칸: 세로 휴대폰 2, 가로 4, 넓으면 6까지(짝수)', () => {
  assert.equal(lanesFor(gw(P)), 2); assert.equal(lanesFor(gw(L)), 4);
  assert.equal(lanesFor(1004), 4); assert.equal(lanesFor(1400), 6); assert.equal(lanesFor(200), 2);
});

test('팀은 두 칸: 리드는 왼쪽 칸, 하위는 오른쪽 칸(손자는 조금 들여), 리드는 하위들 세로 가운데, 선은 리드 오른쪽에서 나간다', () => {
  const pm = phoneMission(board(), { order: ['wa', 'wb', 'wc'] });
  const g = phoneGraph(pm, { width: gw(P) });
  assert.equal(noOverlap(g), null); assert.ok(inWidth(g));
  const n = at(g);
  for (const k of ['rev', 'test', 'help', 'port']) assert.ok(n[k].x > n.lead.x + n.lead.w, `${k}는 리드 오른쪽`);
  assert.ok(n.help.x > n.rev.x && n.help.y > n.rev.y, '손자는 부모 아래 들여');
  assert.ok(n.rev.y < n.test.y && n.test.y < n.port.y, '띄운 순서로 위 → 아래');
  assert.equal(n.port.group, 'wa', '다른 무리의 하위도 부모 팀 안'); assert.equal(n.port.cross, true);
  const top = n.rev.y, bottom = Math.max(...['rev', 'test', 'help', 'port'].map((k) => n[k].y + n[k].h));
  assert.ok(Math.abs(n.lead.y + n.lead.h / 2 - (top + bottom) / 2) < 1, '리드는 하위들 가운데');
  const tree = g.edges.filter((e) => e.kind === 'tree').map((e) => e.id).sort();
  assert.deepEqual(tree, ['t:s:lead>s:port', 't:s:lead>s:rev', 't:s:lead>s:test', 't:s:rev>s:help']);
  const e = g.edges.find((x) => x.id === 't:s:lead>s:rev');
  { const m = e.d.match(/^M([\d.]+),([\d.]+) C/); assert.ok(m && Number(m[1]) === n.lead.x + n.lead.w && Math.abs(Number(m[2]) - (n.lead.y + n.lead.h / 2)) < n.lead.h / 2 - 8, '리드 오른쪽 가장자리에서 시작하는 곡선(P101: 하위 쪽으로 살짝 펼친 높이)'); }
  assert.ok(e.d.endsWith(`${n.rev.x},${n.rev.y + n.rev.h / 2}`), '하위 왼쪽 가운데에서 끝난다');
  assert.equal(e.active, true); assert.equal(g.edges.find((x) => x.id === 't:s:lead>s:test').tier, 'turn', '선은 받는 쪽 등급');
  assert.ok(g.edges.find((x) => x.id === 't:s:rev>s:help').d.includes('V'), '손자는 같은 칸 안 둥근 꺾임');
  // 혼자인 무리(wb solo, wc old)는 한 칸 기둥. 쉬는·끝난 세션은 한 줄
  assert.equal(n.solo.kind, 'row'); assert.equal(n.old.kind, 'row'); assert.equal(n.lead.kind, 'card'); assert.equal(n.rev.kind, 'card');
  assert.ok(n.solo.w < g.width / 2 && n.old.w < g.width / 2);
  assert.deepEqual(g.groups.map((x) => [x.key, x.wide]), [['wa', true], ['wb', false], ['wc', false]]);
  assert.ok(n.solo.x !== n.old.x || n.solo.y !== n.old.y);
  assert.ok(g.width <= gw(P) + 0.5);
});

test('세로 한 줄로 늘어서지 않는다: 워크스페이스 열 개, 세션 한두 개씩인 판은 두 기둥에 채워 한 화면 높이 안팎', () => {
  clock = 0;
  const nodes = [node('lead', 'w0', { state: 'working' }), kid('a', 'w0', 'lead', { state: 'working' }), kid('b', 'w0', 'lead')];
  for (let i = 1; i <= 10; i++) { nodes.push(node(`s${i}`, `w${i}`, { createdAt: i })); if (i % 3 === 0) nodes.push(node(`t${i}`, `w${i}`, { createdAt: 20 + i, state: 'working' })); }
  const g = phoneGraph(phoneMission({ nodes, edges: [] }, { order: Array.from({ length: 11 }, (_, i) => `w${i}`) }), { width: gw(P) });
  assert.equal(noOverlap(g), null);
  assert.equal(g.nodes.length, nodes.length);
  assert.ok(longest(g) <= Math.ceil(g.nodes.length * 2 / 3), `가장 긴 기둥 ${longest(g)} / ${g.nodes.length}`);
  assert.ok(g.height <= P.h * 1.15, `높이 ${g.height}`);
  assert.equal(new Set(g.groups.filter((x) => !x.wide).map((x) => x.x)).size, 2, '혼자인 무리는 두 기둥');
});

test('접기·동그라미 줄·나무 밖 연결: 접은 무리는 머리 글만, 쉬는 하위가 많으면 동그라미 줄, 나무 밖은 옅은 선', () => {
  const pm = phoneMission(board(), { order: ['wa', 'wb', 'wc'] });
  const g = phoneGraph(pm, { width: gw(P) });
  const link = g.edges.find((e) => e.kind === 'link');
  assert.deepEqual([link.from, link.to, link.rel], ['s:test', 's:help', 'role']);
  // 접기: wa를 접으면 그 팀(다른 무리 하위 port 포함)과 선이 빠진다. 머리 글은 남는다
  const f = phoneGraph(phoneMission(board(), { order: ['wa', 'wb', 'wc'], folded: ['wa'] }), { width: gw(P) });
  assert.equal(f.groups[0].folded, true); assert.equal(f.groups[0].count, 4);
  assert.ok(!f.nodes.some((x) => ['lead', 'rev', 'test', 'help'].includes(x.row.name)));
  assert.ok(!f.edges.some((e) => e.from === 's:lead' || e.to === 's:lead'));
  assert.equal(noOverlap(f), null);
  // 쉬는 하위 9개: 동그라미 줄(줄마다 여러 개), 선은 리드에서 줄로 하나
  clock = 0;
  const many = [node('lead', 'w', { state: 'working' }), kid('busy', 'w', 'lead', { state: 'working' }), ...Array.from({ length: 9 }, (_, i) => kid(`w${i}`, 'w', 'lead'))];
  const d = phoneGraph(phoneMission({ nodes: many, edges: [] }), { width: gw(P) });
  assert.equal(noOverlap(d), null);
  assert.equal(d.nodes.filter((x) => x.kind === 'dot').length, 9);
  assert.equal(d.dots.length, 1); assert.equal(d.dots[0].n, 9);
  assert.ok(d.edges.some((e) => e.to === `dots:s:lead`));
  assert.ok(new Set(d.nodes.filter((x) => x.kind === 'dot').map((x) => x.y)).size < 9, '줄마다 여러 개');
  assert.deepEqual(phoneGraph(phoneMission(null)).nodes, []);
});

// 50개 판: 무리 4개, 리드 셋(하위·손자), 셸 여럿, 역할 선, 고리
function big(n = 50) {
  clock = 0;
  const nodes = [], edges = [];
  const ws = ['w1', 'w2', 'w3', 'w4'];
  for (let Ld = 0; Ld < 3; Ld++) {
    const lead = `lead${Ld}`;
    nodes.push(node(lead, ws[Ld], { createdAt: ++clock, state: Ld === 0 ? 'working' : 'ready' }));
    for (let i = 0; i < 6 + Ld * 2; i++) {
      const w = `${lead}-w${i}`;
      nodes.push(kid(w, i % 4 === 3 ? ws[(Ld + 1) % 4] : ws[Ld], lead, { state: i % 3 === 0 ? 'working' : i % 5 === 1 ? 'waiting' : 'ready' }));
      if (i % 3 === 1) nodes.push(kid(`${w}-h`, ws[Ld], w));
    }
  }
  while (nodes.length < n) nodes.push(node(`sh${nodes.length}`, ws[nodes.length % 4], { agentKind: 'shell', createdAt: ++clock, state: nodes.length % 6 ? 'ready' : 'sleeping' }));
  for (let i = 0; i < 8; i++) edges.push({ from: nodes[i * 5].id, to: nodes[(i * 7 + 3) % nodes.length].id, kind: 'role', label: `peer${i}` });
  edges.push({ from: 's:lead1', to: 's:lead2', kind: 'prompt' }, { from: 's:lead2', to: 's:lead1', kind: 'prompt' });
  return { nodes, edges };
}

test('세션 50개 판 — 모두 한 번씩, 겹침 없음, 폭 안, 세로·가로 모두', () => {
  for (const [vp, label] of [[P, '세로'], [L, '가로']]) {
    const pm = phoneMission(big(), { order: ['w1', 'w2', 'w3', 'w4'] });
    const g = phoneGraph(pm, { width: gw(vp) });
    assert.equal(g.nodes.length, 50, label);
    assert.equal(new Set(g.nodes.map((x) => x.id)).size, 50);
    assert.equal(noOverlap(g), null, label); assert.ok(inWidth(g), label);
    const ids = new Set([...g.nodes.map((x) => x.id), ...g.dots.map((x) => x.id)]);
    assert.ok(g.edges.every((e) => ids.has(e.from) && ids.has(e.to)));
    assert.ok(g.edges.some((e) => e.kind === 'link'));
    assert.ok(g.edges.every((e) => !/NaN|undefined/.test(e.d)));
    const f = fitView(g, vp);
    assert.ok(f.zoom >= 0.99 && g.width * f.zoom <= vp.w + 0.5, `${label}: 배율 1로 폭에 든다(${f.zoom})`);
  }
});

test('강조: 요약 칩 거르기(일함·응답 필요는 오류도), 선은 받는 쪽 등급', () => {
  assert.equal(inFocus(null, 'rest'), true);
  assert.equal(inFocus('work', 'work'), true); assert.equal(inFocus('work', 'turn'), false);
  assert.equal(inFocus('turn', 'turn'), true); assert.equal(inFocus('turn', 'alert'), true); assert.equal(inFocus('turn', 'work'), false);
  const live = new Map([['help', { sessionId: 'help', name: 'help', state: 'working' }]]);
  const g = phoneGraph(phoneMission(board(), { live, order: ['wa', 'wb', 'wc'] }), { width: gw(P) });
  assert.equal(g.edges.find((e) => e.id === 't:s:rev>s:help').tier, 'work', '판의 상태로 덧입힌 등급');
  assert.equal(at(g).solo.row.tier, 'sleep'); assert.equal(at(g).old.row.tier, 'done');
});

test('보기: 맞추기(폭에 맞추고 위에 붙인다), 옮기기·확대 범위, 고른 등급으로 맞추기', () => {
  const g = phoneGraph(phoneMission(board(), { order: ['wa', 'wb', 'wc'] }), { width: gw(P) });
  const f = fitView(g, P);
  assert.equal(f.zoom, 1, '그래프 폭을 화면에 맞춰 놓았으니 배율 1');
  assert.ok(g.width * f.zoom <= P.w - 2 * VIEW.PAD + 0.5 && f.x >= VIEW.PAD - 0.5, '폭 안, 가운데');
  assert.equal(f.y, VIEW.PAD, '위에 붙인다');
  // 아주 긴 그래프: 글을 줄이지 않고(폭 배율) 위에 붙여 아래로 옮겨 본다
  const tall = fitView({ width: gw(P), height: 6000 }, P);
  assert.equal(tall.zoom, 1); assert.equal(tall.y, VIEW.PAD);
  // 아주 넓은 그래프: 폭에 맞춘다(ZMIN 아래라도), 배율 범위가 그만큼 넓어진다
  const wide = fitView({ width: 4000, height: 300 }, P);
  assert.ok(wide.zoom < VIEW.ZMIN && 4000 * wide.zoom <= P.w && zoomRange({ width: 4000, height: 300 }, P).minZoom === wide.zoom);
  // 범위: 배율은 [min(ZMIN, 맞춘 배율), ZMAX], 그래프는 늘 MARGIN px 이상 화면에 남는다
  const r = zoomRange(g, P);
  assert.equal(r.maxZoom, VIEW.ZMAX); assert.ok(r.minZoom <= VIEW.ZMIN);
  assert.equal(clampView({ x: 0, y: 0, zoom: 99 }, g, P).zoom, VIEW.ZMAX);
  assert.equal(clampView({ x: 0, y: 0, zoom: 0.001 }, g, P).zoom, r.minZoom);
  const far = clampView({ x: 99999, y: -99999, zoom: 1 }, g, P);
  assert.equal(far.x, P.w - VIEW.MARGIN); assert.equal(far.y, VIEW.MARGIN - g.height);
  const ok = { x: 20, y: 30, zoom: 1.1 };
  assert.deepEqual(clampView(ok, g, P), ok, '범위 안이면 그대로');
  assert.deepEqual(clampView({ x: NaN, y: undefined, zoom: undefined }, g, P), { x: 0, y: 0, zoom: 1 });
  // 고른 등급으로 맞추기: 그 카드들이 화면 안, 배율은 FOCUS_MAX 이하
  const sel = g.nodes.filter((n) => inFocus('turn', n.row.tier));
  const fv = focusView(sel, P);
  for (const n of sel) { assert.ok(n.x * fv.zoom + fv.x >= 0 && (n.x + n.w) * fv.zoom + fv.x <= P.w); assert.ok(n.y * fv.zoom + fv.y >= 0 && (n.y + n.h) * fv.zoom + fv.y <= P.h); }
  assert.ok(fv.zoom <= VIEW.FOCUS_MAX);
  assert.equal(focusView([], P), null);
  assert.equal(vpKey({ w: 393.4, h: 700.6 }), '393x701');
  assert.ok(PG.CARD_H >= 56 && PG.ROW_H >= 30, '카드와 한 줄은 손가락으로 누를 만한 높이');
});
