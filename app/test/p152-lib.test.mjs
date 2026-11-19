// P152 단위 시험: 미션 맵 A "Territories". 영토·섬·무리 배치(겹침 없음, 큰 판, 폴더 밖, 워크스페이스를 넘는 팀), 확대 단계,
// 끌기·확대 셈(마우스 중심), 빈 곳 누르기로 닫히지 않음, 미니맵 틀, 휴대폰 타일 지도, 숨은 설정(missionStyle), 사전 두 벌.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { territoryLayout, TERR, ZOOM, levelOf, zoomAt, wheelK, panBy, fitView, centerOn, viewRect, miniMap, miniToWorld, pressIntent, viewKey, stepCard, shelf, chipCounts, phoneTerr, PTERR, tileTap, missionStyleOf } from '../src/renderer/lib/mission-terr.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');

// 세션 노드와 띄움 선으로 그래프를 만든다. s: [이름, 워크스페이스, 부모 이름|null, 상태]
function graphOf(list, extra = []) {
  const nodes = list.map(([name, ws, parent, state], i) => ({ id: `s:${name}`, kind: 'session', sessionId: name, name, workspaceKey: ws, state: state || 'ready', parentId: parent ? `s:${parent}` : null, createdAt: i + 1, order: i + 1 }));
  const edges = list.filter((x) => x[2]).map(([name, , parent]) => ({ id: `spawn:s:${parent}>s:${name}`, kind: 'spawn', from: `s:${parent}`, to: `s:${name}`, count: 0 }));
  return { nodes, edges: [...edges, ...extra] };
}
const overlap = (a, b, g = 0) => a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g;
const inside = (a, b) => a.x >= b.x - 0.01 && a.y >= b.y - 0.01 && a.x + a.w <= b.x + b.w + 0.01 && a.y + a.h <= b.y + b.h + 0.01;
function noOverlap(list, what) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!overlap(list[i], list[j]), `${what} ${i}·${j} 겹침`);
}

// 실제 판 모양 흉내: 세션 28, 워크스페이스 10, 폴더 3(+폴더 밖 둘), 팀 셋(하나는 워크스페이스를 넘는다), 하위 많은 팀 하나
const WS = ['app', 'docs', 'lab', 'notes', 'pipe', 'dots', 'blog', 'web', 'sand', 'misc'];
const VG = [{ id: 'g1', name: 'Product', members: ['app', 'docs', 'web'] }, { id: 'g2', name: 'Research', members: ['lab', 'notes', 'pipe'] }, { id: 'g3', name: 'Personal', members: ['dots', 'blog'] }];
const BIG = [
  ['lead', 'app', null, 'working'], ['w1', 'app', 'lead', 'working'], ['w2', 'app', 'lead', 'waiting'], ['w3', 'app', 'lead', 'ready'], ['w4', 'app', 'lead', 'ready'], ['w5', 'app', 'lead', 'exited'],
  ['w6', 'app', 'lead', 'sleeping'], ['sub', 'app', 'lead', 'working'], ['s1', 'app', 'sub', 'ready'], ['s2', 'app', 'sub', 'error'], ['away', 'docs', 'lead', 'working'],
  ['hot', 'app', null, 'ready'], ['old', 'app', null, 'exited'], ['copy', 'docs', null, 'sleeping'],
  ['ana', 'lab', null, 'waiting'], ['scr', 'lab', 'ana', 'error'], ['chart', 'lab', 'ana', 'working'], ['sum', 'lab', 'ana', 'ready'],
  ['read', 'notes', null, 'ready'], ['cite', 'notes', null, 'sleeping'], ['pl', 'pipe', null, 'ready'], ['bf', 'pipe', 'pl', 'ready'], ['etl', 'pipe', 'pl', 'working'],
  ['nvim', 'dots', null, 'sleeping'], ['draft', 'blog', null, 'ready'], ['site', 'web', null, 'working'], ['scratch', 'sand', null, 'ready'], ['loose', 'misc', null, 'exited'],
];

test('P152: 실제 판 규모에서 영토·섬·무리·카드가 겹치지 않고 서로 안에 든다', () => {
  const lay = territoryLayout(graphOf(BIG), { order: WS, vgroups: VG });
  assert.equal(lay.cards.size, 28);
  assert.equal(lay.isles.length, 10);
  assert.equal(lay.terrs.length, 3);
  noOverlap(lay.terrs, '영토');
  noOverlap([...lay.terrs, ...lay.isles.filter((i) => i.loose)], '세계의 영토·폴더 밖 섬');
  noOverlap(lay.isles, '섬');
  noOverlap([...lay.cards.values()], '카드');
  noOverlap(lay.rings, '무리');
  for (const i of lay.isles) {
    if (i.folder) assert.ok(inside(i, lay.terrs.find((t) => t.id === i.folder)), `섬 ${i.key}가 영토 안`);
    for (const [id, c] of lay.cards) if (c.ws === i.key) assert.ok(inside(c, i), `카드 ${id}가 섬 ${i.key} 안`);
  }
  for (const r of lay.rings) {
    assert.ok(inside(r, lay.isles.find((i) => i.key === r.ws)), `무리 ${r.lead}가 섬 안`);
    // 무리 밖 카드는 무리와 겹치지 않는다(혼자인 기둥)
    for (const [, c] of lay.cards) if (c.ws === r.ws && !inside(c, r)) assert.ok(!overlap(c, r), '혼자인 세션이 무리와 겹침');
  }
  // 폴더 밖 워크스페이스는 영토 없는 섬
  for (const k of ['sand', 'misc']) { const i = lay.isles.find((x) => x.key === k); assert.ok(i.loose && !i.folder); }
  // 둘레는 모든 것을 감싼다
  for (const r of [...lay.terrs, ...lay.isles]) assert.ok(inside(r, lay.bounds));
  // 키보드 차례에 모든 카드
  assert.equal(new Set(lay.order).size, 28);
});

test('P152: 팀은 위 → 아래 나무, 리드가 하위들 가운데 위, 잎이 많으면 네 개씩 접힌다', () => {
  const lay = territoryLayout(graphOf(BIG), { order: WS, vgroups: VG });
  const c = (n) => lay.cards.get(`s:${n}`);
  const ring = lay.rings.find((r) => r.lead === 's:lead');
  // 팀: lead + w1~w6 + sub + s1 + s2 (away는 다른 워크스페이스)
  assert.equal(ring.n, 10);
  assert.equal(ring.away, 1);
  for (const w of ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'sub']) assert.ok(c(w).y > c('lead').y + TERR.CH, `${w}는 리드 아래`);
  // 가지(sub)는 첫 줄, 잎 여섯은 네 개 + 두 개
  const leafY = [...new Set(['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((w) => c(w).y))].sort((a, b) => a - b);
  assert.equal(leafY.length, 2);
  assert.equal(c('sub').y, leafY[0]);
  assert.ok(c('s1').y > c('sub').y);
  // 혼자인 세션 hot·old는 무리 오른쪽 기둥
  assert.ok(c('hot').x >= ring.x + ring.w && c('old').x >= ring.x + ring.w);
  // 워크스페이스를 넘는 하위는 자기 섬에 놓이고 선은 cross
  assert.equal(c('away').ws, 'docs');
  const e = lay.edges.find((x) => x.to === 's:away');
  assert.ok(e && e.cross && e.label);
  // 같은 섬 나무 선은 꺾인 선(M … L …), 둘째 줄 잎은 줄기를 탄다(여섯 점)
  const w5 = lay.edges.find((x) => x.to === 's:w5');
  assert.equal(w5.d.split('L').length, 6);
  const w1 = lay.edges.find((x) => x.to === 's:w1');
  assert.equal(w1.d.split('L').length, 4);
});

test('P152: 아주 큰 판(세션 120, 워크스페이스 30, 폴더 6)도 겹치지 않고 한쪽으로만 늘어나지 않는다', () => {
  const list = [];
  const ws = Array.from({ length: 30 }, (_, i) => `ws${i}`);
  ws.forEach((w, i) => {
    const n = 2 + (i % 5);
    if (i % 3 === 0) { list.push([`L${i}`, w, null, 'working']); for (let j = 0; j < n; j++) list.push([`k${i}-${j}`, w, `L${i}`, j % 2 ? 'ready' : 'working']); }
    else for (let j = 0; j < n; j++) list.push([`x${i}-${j}`, w, null, 'ready']);
  });
  const vg = Array.from({ length: 6 }, (_, g) => ({ id: `g${g}`, name: `Folder ${g}`, members: ws.filter((_, i) => i % 7 === g) }));
  const lay = territoryLayout(graphOf(list), { order: ws, vgroups: vg });
  assert.equal(lay.cards.size, list.length);
  noOverlap([...lay.cards.values()], '카드');
  noOverlap(lay.isles, '섬');
  noOverlap(lay.terrs, '영토');
  const ar = lay.bounds.w / lay.bounds.h;
  assert.ok(ar > 0.6 && ar < 4.5, `가로세로 비 ${ar.toFixed(2)}`);
});

test('P152: 폴더가 없는 판, 워크스페이스 없는 세션, 빈 판', () => {
  const lay = territoryLayout(graphOf([['a', 'x', null], ['b', '', null], ['c', 'x', 'a']]), { order: ['x'] });
  assert.equal(lay.terrs.length, 0);
  assert.deepEqual(lay.isles.map((i) => i.key), ['x', '']);
  assert.ok(lay.isles.every((i) => i.loose));
  const empty = territoryLayout({ nodes: [], edges: [] });
  assert.equal(empty.cards.size, 0);
  assert.ok(empty.bounds.w > 0 && empty.bounds.h > 0);
  // 사람 노드와 사람 선은 무시한다
  const g = graphOf([['a', 'x', null]]); g.nodes.push({ id: 'human', kind: 'human', name: 'me' }); g.edges.push({ kind: 'bar', from: 'human', to: 's:a', count: 1 });
  assert.equal(territoryLayout(g).cards.size, 1);
});

test('P152: 역할 연결·지시 선은 종류와 이름표, 나무 밖 연결은 그리지 않는다(P153)', () => {
  const g = graphOf([['a', 'x', null], ['b', 'x', null], ['c', 'x', null]]);
  g.edges.push({ kind: 'role', from: 's:a', to: 's:b', label: 'reviewer' }, { kind: 'prompt', from: 's:b', to: 's:c', label: 'do it', count: 2 }, { kind: 'prompt', from: 's:c', to: 's:a', label: 'back', count: 1 });
  const lay = territoryLayout(g, { order: ['x'] });
  const ab = lay.edges.find((e) => e.from === 's:a' && e.to === 's:b');
  assert.equal(ab.rel, 'role'); assert.equal(ab.role, 'reviewer'); assert.ok(ab.label);
  const bc = lay.edges.find((e) => e.from === 's:b' && e.to === 's:c');
  assert.equal(bc.rel, 'prompt');
  const ca = lay.edges.find((e) => e.from === 's:c' && e.to === 's:a');
  assert.equal(ca, undefined);
});

test('P152: 상태 칩은 정한 차례로 0을 빼고', () => {
  assert.deepEqual(chipCounts(['rest', 'work', 'turn', 'work', 'done']), [{ tier: 'turn', n: 1 }, { tier: 'work', n: 2 }, { tier: 'rest', n: 1 }, { tier: 'done', n: 1 }]);
  assert.deepEqual(chipCounts([]), []);
});

test('P152: 선반 쌓기는 겹치지 않고 목표 폭에서 접힌다', () => {
  const items = [{ w: 100, h: 50 }, { w: 100, h: 80 }, { w: 100, h: 20 }];
  const s = shelf(items, 220, 10);
  assert.deepEqual(s.pos, [{ x: 0, y: 0 }, { x: 110, y: 0 }, { x: 0, y: 90 }]);
  assert.equal(s.w, 210); assert.equal(s.h, 110);
  // 목표보다 넓은 하나도 한 줄에 들어간다
  assert.deepEqual(shelf([{ w: 500, h: 5 }], 100, 10).pos, [{ x: 0, y: 0 }]);
});

test('P152: 확대 단계(멀리 < 60% ≤ 보통 ≤ 120% < 가까이)', () => {
  assert.equal(levelOf(0.3), 'far'); assert.equal(levelOf(0.59), 'far');
  assert.equal(levelOf(0.6), 'mid'); assert.equal(levelOf(1), 'mid'); assert.equal(levelOf(1.2), 'mid');
  assert.equal(levelOf(1.21), 'near'); assert.equal(levelOf(2.4), 'near');
});

test('P152: 끌기·확대 셈 — 마우스 아래 세계 점이 그대로, 범위 안', () => {
  const v = { k: 0.5, x: 100, y: -40 };
  const world = (vv, mx, my) => [(mx - vv.x) / vv.k, (my - vv.y) / vv.k];
  for (const [mx, my, k2] of [[300, 200, 1], [0, 0, 0.2], [1200, 700, 2]]) {
    const w0 = world(v, mx, my), v2 = zoomAt(v, mx, my, k2), w1 = world(v2, mx, my);
    assert.ok(Math.abs(w0[0] - w1[0]) < 1e-9 && Math.abs(w0[1] - w1[1]) < 1e-9);
  }
  assert.equal(zoomAt(v, 0, 0, 99).k, ZOOM.max);
  assert.equal(zoomAt(v, 0, 0, 0.0001).k, ZOOM.min);
  // 휠: 아래로 굴리면 작게, 위로 굴리면 크게, 줄 단위도
  assert.ok(wheelK(1, 100) < 1 && wheelK(1, -100) > 1);
  assert.ok(Math.abs(wheelK(1, 3, 1) - wheelK(1, 48, 0)) < 1e-12);
  assert.deepEqual(panBy(v, 10, -5), { k: 0.5, x: 110, y: -45 });
});

test('P152: 맞춤과 가운데로, 보이는 틀과 미니맵', () => {
  const b = { x: -100, y: 0, w: 4000, h: 2000 };
  const f = fitView(b, 1600, 900, { top: 80, pad: 40 });
  // 둘레가 위 줄 아래 칸 안에 들어가고 가운데
  const left = b.x * f.k + f.x, right = (b.x + b.w) * f.k + f.x, top = b.y * f.k + f.y, bot = (b.y + b.h) * f.k + f.y;
  assert.ok(left >= 39.9 && right <= 1560.1 && top >= 80 + 39.9 && bot <= 900 - 39.9);
  assert.ok(Math.abs((left + right) / 2 - 800) < 0.01);
  // 작은 둘레는 100% 위로 키우지 않는다
  assert.equal(fitView({ x: 0, y: 0, w: 100, h: 100 }, 1600, 900).k, 1);
  const c = centerOn(500, 300, 1, 1600, 900, { top: 80 });
  assert.equal(500 * c.k + c.x, 800); assert.equal(300 * c.k + c.y, 80 + 410);
  const r = viewRect({ k: 0.5, x: -100, y: -50 }, 1000, 600);
  assert.deepEqual(r, { x: 200, y: 100, w: 2000, h: 1200 });
  const m = miniMap(b, f, 1600, 900, 234, 150);
  // 맞춘 보기의 틀은 미니맵 안의 둘레를 감싼다
  const bb = m.map(b);
  assert.ok(m.frame.x <= bb.x + 0.01 && m.frame.y <= bb.y + 0.01 && m.frame.x + m.frame.w >= bb.x + bb.w - 0.01);
  // 미니맵 점 ↔ 세계 점
  const p = miniToWorld(b, 234, 150, bb.x + bb.w / 2, bb.y + bb.h / 2);
  assert.ok(Math.abs(p.x - 1900) < 0.01 && Math.abs(p.y - 1000) < 0.01);
});

test('P152: 빈 곳을 눌러도 닫히지 않는다(누르기 뜻과 덮개 코드)', () => {
  assert.equal(pressIntent({ dx: 0, dy: 0, onCard: false }), 'clear');
  assert.equal(pressIntent({ dx: 1, dy: 2, onCard: true }), 'pick');
  assert.equal(pressIntent({ dx: 4, dy: 3, onCard: true }), 'drag');
  for (const x of [false, true]) assert.notEqual(pressIntent({ onCard: x }), 'close');
  // 옛 "빈 곳 누르면 닫힘"(P32 onBackdrop)은 지웠다
  assert.ok(!/onBackdrop/.test(read('Mission.jsx')));
  assert.ok(!/onBackdrop/.test(read('MissionLineage.jsx')));
  // 덮개를 닫는 길은 닫기 단추·Esc·M(main.jsx)만
  const terr = read('MissionLineage.jsx');
  const closes = terr.match(/setMissionOpen\(false\)/g) || [];
  assert.ok(closes.length >= 1);
  assert.ok(/'Escape'/.test(terr));
});

test('P152: 키(+ − 0, 화살표)와 카드 차례', () => {
  assert.deepEqual(viewKey('+'), { zoom: ZOOM.step });
  assert.deepEqual(viewKey('-'), { zoom: 1 / ZOOM.step });
  assert.deepEqual(viewKey('0'), { fit: true });
  assert.deepEqual(viewKey('ArrowLeft'), { pan: [120, 0] });
  assert.deepEqual(viewKey('ArrowDown', { shift: true }), { pan: [0, -360] });
  assert.equal(viewKey('x'), null);
  assert.equal(stepCard(['a', 'b', 'c'], 'c', 1), 'a');
  assert.equal(stepCard(['a', 'b', 'c'], 'a', -1), 'c');
  assert.equal(stepCard(['a', 'b'], null, 1), 'a');
  assert.equal(stepCard([], 'a', 1), null);
});

test('P152: 휴대폰 타일 지도는 겹치지 않고, 타일 누르기는 크기와 상관없이 연다(P153)', () => {
  const lay = territoryLayout(graphOf(BIG), { order: WS, vgroups: VG });
  const pt = phoneTerr(lay);
  assert.equal(pt.tiles.length, 28);
  noOverlap(pt.isles, '휴대폰 섬');
  noOverlap(pt.terrs, '휴대폰 영토');
  noOverlap(pt.tiles.map((t) => ({ x: t.x, y: t.y, w: t.s, h: t.s })), '타일');
  for (const t of pt.tiles) assert.ok(inside({ x: t.x, y: t.y, w: t.s, h: t.s }, pt.isles.find((i) => i.key === t.ws)));
  // 390px 휴대폰에서 맞춘 배율이 너무 작지 않게(세로로 긴 지도)
  assert.ok(pt.bounds.w < pt.bounds.h * 2.5);
  assert.equal(tileTap(0.8), 'open');
  assert.equal(tileTap(PTERR.TAP_MIN / PTERR.TILE), 'open');
});

test('P152: 숨은 설정 missionStyle(기본 territories, classic이면 옛 열 지도)', async () => {
  assert.equal(missionStyleOf(null), 'territories');
  assert.equal(missionStyleOf({}), 'territories');
  assert.equal(missionStyleOf({ missionStyle: 'classic' }), 'classic');
  assert.equal(missionStyleOf({ missionStyle: 'weird' }), 'territories');
  const { SETTINGS, normalizePatch } = await import('../../backend/src/settings.mjs');
  assert.equal(SETTINGS.missionStyle.default, 'territories');
  assert.deepEqual(normalizePatch({ missionStyle: 'classic' }), { missionStyle: 'classic' });
  // 설정 화면에 줄이 없다(숨은 설정)
  assert.ok(!/missionStyle/.test(read('Settings.jsx')));
});

test('P152: 사전 두 벌에 같은 키', () => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !('one' in v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  const a = keys(en.mmTerr), b = keys(ko.mmTerr);
  assert.ok(a.length > 20);
  assert.deepEqual(a.sort(), b.sort());
});
