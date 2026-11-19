// P134 단위 시험: 미션 맵의 폴더 상자. 같은 폴더(사이드바의 가상 그룹)의 워크스페이스들은 한 상자 안에 모이고, 폴더 밖 워크스페이스는 상자 없이 놓인다.
// 상자끼리·폴더 밖 판과 겹치지 않음, 팀이 폴더를 넘을 때(다른 폴더의 하위 세션은 부모 팀 안, 그 부모의 상자 안), 상자를 넘는 선 표시, 폴더가 없으면 전과 같은 자리, 접기
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { missionLayout, FOLDER, MISSION } from '../src/renderer/lib/mission-layout.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
let clock = 0;
const node = (id, ws, o = {}) => ({ id: `s:${id}`, kind: 'session', sessionId: id, name: id, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: ws, parentId: null, role: null, order: null, createdAt: ++clock, loops: 0, ...o });
const E = (a, b, kind = 'spawn') => ({ from: a === 'human' ? 'human' : `s:${a}`, to: `s:${b}`, kind, label: null, count: 1 });
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, o) => a.x >= o.x - 0.01 && a.y >= o.y - 0.01 && a.x + a.w <= o.x + o.w + 0.01 && a.y + a.h <= o.y + o.h + 0.01;
const pairsHit = (rs) => { for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (hit(rs[i], rs[j])) return `${rs[i].id}×${rs[j].id}`; return null; };
// 상자·판 사이 틈: 겹치지 않을 뿐 아니라 판 사이 틈(16)만큼 떨어진다(붙어 있으면 한 상자처럼 읽힌다)
const GUT = MISSION.slotGap - 2 * MISSION.plate;
const grow = (a, g) => ({ ...a, x: a.x - g, y: a.y - g, w: a.w + 2 * g, h: a.h + 2 * g });
const unitsHit = (rs) => pairsHit(rs.map((r) => grow(r, GUT / 2 - 0.01)));

// 폴더 둘(alpha: a1 팀·a2 혼자, beta: b1·b2·b3 혼자) + 폴더 밖 o1(팀)·o2(혼자). a1의 리드가 beta의 b1에 하위 세션을 하나 둔다(팀이 폴더를 넘는다)
function board() {
  clock = 0;
  const nodes = [
    { id: 'human', kind: 'human', name: 'you' },
    node('lead', 'a1', { state: 'working', category: 'working' }), node('w1', 'a1', { parentId: 's:lead' }), node('w2', 'a1', { parentId: 's:lead', state: 'working', category: 'working' }),
    node('away', 'b1', { parentId: 's:lead' }), // 다른 폴더(beta)의 하위 세션
    node('solo-a2', 'a2'), node('solo-a2b', 'a2', { state: 'sleeping' }),
    node('b1x', 'b1'), node('b2x', 'b2'), node('b2y', 'b2', { state: 'exited', category: 'exited' }), node('b3x', 'b3'),
    node('olead', 'o1'), node('ow', 'o1', { parentId: 's:olead' }),
    node('o2x', 'o2'), node('o2y', 'o2'),
  ];
  const edges = [E('lead', 'w1'), E('lead', 'w2'), E('lead', 'away'), E('olead', 'ow'), E('human', 'lead', 'bar'), E('b2x', 'ow', 'prompt')];
  return { nodes, edges };
}
const ORDER = ['a1', 'o1', 'b1', 'a2', 'b2', 'o2', 'b3'];
const VG = [{ id: 'fa', name: 'alpha', members: ['a1', 'a2'] }, { id: 'fb', name: 'beta', members: ['b1', 'b2', 'b3'] }];

test('폴더 묶기: 폴더 둘 + 폴더 밖 워크스페이스. 폴더마다 상자 하나, 그 워크스페이스 판과 세션은 상자 안', () => {
  const lay = missionLayout(board(), { order: ORDER, vgroups: VG, width: 1400 });
  assert.deepEqual(lay.folders.map((f) => [f.id, f.name, f.keys]), [['fa', 'alpha', ['a1', 'a2']], ['fb', 'beta', ['b1', 'b2', 'b3']]]);
  const F = Object.fromEntries(lay.folders.map((f) => [f.id, f]));
  for (const g of lay.groups) {
    if (['a1', 'a2'].includes(g.key)) { assert.equal(g.folder, 'fa'); assert.ok(inside(g.plate, F.fa), `${g.key} 판은 alpha 안`); }
    else if (['b1', 'b2', 'b3'].includes(g.key)) { assert.equal(g.folder, 'fb'); assert.ok(inside(g.plate, F.fb), `${g.key} 판은 beta 안`); }
    else { assert.equal(g.folder, null, `${g.key}는 폴더 밖`); for (const f of lay.folders) assert.ok(!hit(g.plate, f), `${g.key} 판은 ${f.id} 상자와 겹치지 않는다`); }
  }
  for (const b of lay.boxes.values()) {
    if (!b.node || b.node.kind !== 'session') continue;
    const f = lay.folders.find((x) => x.keys.includes(b.group));
    if (f) assert.ok(inside(b, f), `${b.node.id}는 ${f.id} 상자 안`);
    else for (const x of lay.folders) assert.ok(!hit(b, x), `${b.node.id}는 폴더 상자 밖`);
  }
  // 머리 글은 상자 위 가장자리에서 head만큼 아래(폴더 이름 줄 자리), 수는 상자 안 세션 수
  assert.equal(F.fa.count, 6, 'alpha: lead, w1, w2, away(부모 팀 안), solo-a2, solo-a2b');
  assert.equal(F.fb.count, 4, 'beta: b1x, b2x, b2y, b3x(away는 부모 팀에 놓여 alpha 쪽)');
  assert.ok(Math.min(...lay.groups.filter((g) => g.folder === 'fa').map((g) => g.plate.y)) - F.fa.y >= FOLDER.head - 0.01);
  // 상자끼리, 폴더 밖 판과 겹치지 않는다
  const rects = [...lay.folders.map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h })), ...lay.groups.filter((g) => !g.folder).map((g) => ({ id: g.key, ...g.plate }))];
  assert.equal(unitsHit(rects), null);
  const ss = [...lay.boxes.values()].filter((b) => !b.proxy).map((b) => ({ id: b.node.id, x: b.x, y: b.y, w: b.w, h: b.h }));
  assert.equal(pairsHit(ss.filter((b) => !String(b.id).startsWith('dots:'))), null, '세션 상자끼리 겹치지 않는다');
  // 지도 크기 안
  for (const f of lay.folders) assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= lay.width && f.y + f.h <= lay.height);
});

test('팀이 폴더를 넘으면: 하위 세션은 부모 팀 안(부모 폴더 상자 안)에 놓이고, 팀 흐름(부모 → 하위 왼쪽 → 오른쪽)은 상자 안에서 지킨다', () => {
  const lay = missionLayout(board(), { order: ORDER, vgroups: VG, width: 1400 });
  const b = (id) => lay.boxes.get(`s:${id}`);
  assert.equal(b('away').group, 'a1', '다른 폴더의 하위 세션은 부모 팀 안');
  for (const w of ['w1', 'w2', 'away']) assert.ok(b(w).x > b('lead').x, `${w}는 리드 오른쪽`);
  const fa = lay.folders.find((f) => f.id === 'fa');
  assert.ok(inside(b('away'), fa));
  // 나무 선은 상자를 넘지 않는다. 폴더 → 폴더 밖 선(b2x → ow, 나무 밖)은 outside
  const tree = lay.edges.find((e) => e.from === 's:lead' && e.to === 's:away');
  assert.ok(tree.cross, '다른 워크스페이스로 간 선'); assert.ok(!tree.outside, '같은 상자 안');
  const link = lay.edges.find((e) => e.from === 's:b2x' && e.to === 's:ow');
  assert.ok(link && link.outside, '폴더 상자를 넘는 선');
  assert.ok(!lay.edges.some((e) => e.from === 'human'), 'P145: 사람 선은 없다');
});

test('열 자리: 위아래로 쌓이면 폴더 안 팀과 폴더 밖 팀의 리드가 같은 x, 폴더가 있으면 상자 여백만큼 민다(P145: 넓으면 팀 단위가 나란히)', () => {
  const lay = missionLayout(board(), { order: ORDER, vgroups: VG, width: 700 });
  const b = (id) => lay.boxes.get(`s:${id}`);
  assert.equal(b('lead').x, b('olead').x);
  assert.equal(b('w1').x, b('ow').x);
  // P145: 넓은 지도에서는 폴더 밖 팀(o1)이 폴더 상자 오른쪽에 같은 위 끝으로 선다. 팀 안 흐름(리드 → 하위)은 그대로
  const wide = missionLayout(board(), { order: ORDER, vgroups: VG, width: 1520 }); // P149: 카드 폭 216 → 232라 1400 → 1520
  const o1 = wide.groups.find((g) => g.key === 'o1'), fa = wide.folders.find((f) => f.id === 'fa');
  assert.equal(o1.plate.y, fa.y); assert.ok(o1.plate.x > fa.x + fa.w);
  assert.equal(wide.boxes.get('s:ow').x - wide.boxes.get('s:olead').x, MISSION.boxW + MISSION.colGap);
  const plain = missionLayout(board(), { order: ORDER, vgroups: [], width: 700 });
  assert.equal(b('lead').x - plain.boxes.get('s:lead').x, FOLDER.m);
  assert.equal(plain.folders.length, 0);
});

test('폴더가 없으면: 상자 없음, outside 없음, 판끼리 틈(16)만큼 떨어져 빈 곳에 채운다(P145: 팀 판도 나란히)', () => {
  const lay = missionLayout(board(), { order: ORDER, width: 1400 });
  assert.deepEqual(lay.folders, []);
  assert.ok(lay.edges.every((e) => !e.outside));
  assert.equal(unitsHit(lay.groups.map((x) => ({ id: x.key, ...x.plate }))), null);
  const g = Object.fromEntries(lay.groups.map((x) => [x.key, x]));
  assert.equal(g.o1.plate.y, g.a1.plate.y, '두 팀이 나란히');
  assert.equal(g.o1.plate.x - (g.a1.plate.x + g.a1.plate.w), MISSION.slotGap - 2 * MISSION.plate);
  assert.ok(lay.height < missionLayout(board(), { order: ORDER, width: 700 }).height, `높이 ${lay.height}: 쌓은 좁은 지도보다 낮다`);
});

test('좁은 지도: 오른쪽에 자리가 없으면 팀이 없는 단위(폴더 포함)는 아래로, 그래도 겹치지 않는다. 폴더 상자는 너무 넓지 않다', () => {
  const lay = missionLayout(board(), { order: ORDER, vgroups: VG, width: 640 });
  const rects = [...lay.folders.map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h })), ...lay.groups.filter((g) => !g.folder).map((g) => ({ id: g.key, ...g.plate }))];
  assert.equal(unitsHit(rects), null);
  for (const f of lay.folders) assert.ok(f.w <= 3 * (MISSION.boxW + MISSION.slotGap) + 2 * FOLDER.m, `${f.id} 상자는 세 기둥까지`);
  const fb = lay.folders.find((f) => f.id === 'fb');
  const fa = lay.folders.find((f) => f.id === 'fa');
  assert.ok(fb.y >= fa.y + fa.h, '팀이 없는 폴더는 팀 흐름 아래');
});

test('접기: 폴더 안 워크스페이스를 접어도 상자는 남고 수는 그대로, 접은 머리 글은 상자 안', () => {
  const lay = missionLayout(board(), { order: ORDER, vgroups: VG, width: 1400, collapsed: ['b2', 'a1'] });
  const fb = lay.folders.find((f) => f.id === 'fb'), fa = lay.folders.find((f) => f.id === 'fa');
  assert.equal(fb.count, 4); assert.equal(fa.count, 6);
  assert.ok(inside(lay.boxes.get('g:b2'), fb)); assert.ok(inside(lay.boxes.get('g:a1'), fa));
});

test('팀이 없는 판(혼자인 세션뿐): 폴더 상자는 나란히 놓여도 서로 틈만큼 떨어진다(붙지 않는다), 폴더 밖 판도', () => {
  clock = 0;
  const ks = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const g = { nodes: ks.map((k) => node(`p-${k}`, k)), edges: [] };
  for (const width of [1300, 1600, 2000]) {
    const lay = missionLayout(g, { order: ks, vgroups: [{ id: 'fa', name: 'alpha', members: ['a', 'b', 'c'] }, { id: 'fb', name: 'beta', members: ['d', 'e'] }], width });
    const rects = [...lay.folders.map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h })), ...lay.groups.filter((x) => !x.folder).map((x) => ({ id: x.key, ...x.plate }))];
    assert.equal(unitsHit(rects), null, `폭 ${width}`);
    assert.ok(rects.every((r) => r.x + r.w <= lay.width), `폭 ${width}: 지도 안`);
  }
});

test('세션이 많은 판(20개 넘게)도 상자끼리 겹치지 않는다', () => {
  clock = 0;
  const nodes = [{ id: 'human', kind: 'human', name: 'you' }], edges = [];
  const vg = [{ id: 'f1', name: 'one', members: [] }, { id: 'f2', name: 'two', members: [] }, { id: 'f3', name: 'three', members: [] }];
  const order = [];
  for (let w = 0; w < 9; w++) {
    const k = `w${w}`; order.push(k); vg[w % 3].members.push(k);
    nodes.push(node(`${k}-a`, k));
    if (w % 2 === 0) { for (let i = 0; i < 4; i++) { nodes.push(node(`${k}-k${i}`, k, { parentId: `s:${k}-a`, state: i % 2 ? 'sleeping' : 'working' })); edges.push(E(`${k}-a`, `${k}-k${i}`)); } }
    nodes.push(node(`${k}-b`, k));
  }
  for (let i = 0; i < 4; i++) { order.push(`x${i}`); nodes.push(node(`x${i}-a`, `x${i}`)); }
  assert.ok(nodes.length > 40);
  for (const width of [1800, 1200, 700]) {
    const lay = missionLayout({ nodes, edges }, { order, vgroups: vg, width });
    assert.equal(lay.folders.length, 3);
    const rects = [...lay.folders.map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h })), ...lay.groups.filter((g) => !g.folder).map((g) => ({ id: g.key, ...g.plate }))];
    assert.equal(unitsHit(rects), null, `폭 ${width}`);
    for (const g of lay.groups) if (g.folder) assert.ok(inside(g.plate, lay.folders.find((f) => f.id === g.folder)), `${g.key} 판은 제 상자 안(폭 ${width})`);
  }
});

test('그리기: 폴더 상자는 판보다 먼저(뒤에) 그리고, 폴더 안 워크스페이스 머리 글에는 폴더 이름을 다시 쓰지 않는다. CSS·사전은 끝에 더했다', () => {
  const jsx = read('Mission.jsx');
  assert.ok(jsx.indexOf('data-role="mm-folder"') > 0 && jsx.indexOf('data-role="mm-folder"') < jsx.indexOf('data-role="mm-plate"'));
  assert.match(jsx, /g\.vg && !g\.folder/);
  const css = read('styles.css');
  const at = css.indexOf('P134');
  assert.ok(at > 0 && css.indexOf('.mt-mm-folder', at) > at, 'P134 덩어리는 styles.css 끝');
  assert.ok(!/\.mt-mm-folder[^}]*(filter|will-change|box-shadow)/.test(css), '폴더 상자는 가볍다');
  for (const f of ['locales/en.js', 'locales/ko.js']) assert.match(read(f), /folderTitle/);
});
