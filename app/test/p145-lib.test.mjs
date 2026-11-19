// P145 단위 시험: 미션 맵에서 "나"(사람 동그라미)와 사람 선을 걷고 배치를 촘촘히 했다.
// - 나 상자·사람 선이 없고, 팀의 맨 위는 지도 왼쪽 끝 열(폴더가 있으면 상자 여백만큼만 민다). 사람의 지시는 받는 세션 표시(lay.human)로 남는다.
// - 팀이 있는 워크스페이스의 혼자인 세션은 팀 아래 1열 한 줄이 아니라 팀이 차지한 열들에 나눠 놓는다(열 자리 그대로).
// - 혼자인 세션이 많은 워크스페이스는 판 안에서 기둥 여럿(세 개까지)으로 나눈다.
// - 폴더 둘·폴더 밖 워크스페이스, 팀·혼자·쉬는 세션을 섞은 판(세션 30개)에서 겹침 없음, 판·폴더 상자 사이 틈, 앞으로 가는 선의 틈에 상자 없음.
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
const work = { state: 'working', category: 'working' };
const E = (a, b, kind = 'spawn', o = {}) => ({ from: a === 'human' ? 'human' : `s:${a}`, to: `s:${b}`, kind, label: null, count: 1, ...o });
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const overlap = (lay) => { const bs = [...lay.boxes.values()].filter((b) => b.kind !== 'dots'); for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (hit(bs[i], bs[j])) return `${bs[i].node.id} × ${bs[j].node.id}`; return null; };
const GUT = MISSION.slotGap - 2 * MISSION.plate;
const grow = (a, g) => ({ ...a, x: a.x - g, y: a.y - g, w: a.w + 2 * g, h: a.h + 2 * g });

// 섞은 판(세션 30개): 폴더 work(app 팀 + 혼자 셋, api 팀 + 혼자 하나, docs 혼자 둘), 폴더 side(notes 혼자 일곱, misc 혼자 둘), 폴더 밖 tools(팀), scratch(혼자 둘)
function mixed() {
  clock = 0;
  const nodes = [{ id: 'human', kind: 'human', name: 'you' },
    node('lead', 'app', work), node('ui', 'app', { parentId: 's:lead', ...work }), node('tests', 'app', { parentId: 's:lead' }), node('build', 'app', { parentId: 's:lead', state: 'waiting', category: 'needs_you' }),
    node('ui-a', 'app', { parentId: 's:ui' }), node('ui-b', 'app', { parentId: 's:ui', ...work }),
    node('app-notes', 'app'), node('app-try', 'app', work), node('app-old', 'app', { state: 'sleeping' }),
    node('lead2', 'api', work), node('schema', 'api', { parentId: 's:lead2' }), node('perf', 'api', { parentId: 's:lead2', ...work }), node('port', 'api', { parentId: 's:lead2' }), node('api-x', 'api'),
    node('docs-a', 'docs'), node('docs-b', 'docs', work),
    ...Array.from({ length: 7 }, (_, i) => node(`note${i}`, 'notes', i === 2 ? work : {})),
    node('misc-a', 'misc'), node('misc-b', 'misc', { state: 'exited', category: 'exited' }),
    node('lead3', 'tools'), node('t1', 'tools', { parentId: 's:lead3' }), node('t2', 'tools', { parentId: 's:lead3' }),
    node('sc-a', 'scratch'), node('sc-b', 'scratch')];
  const edges = [E('lead', 'ui'), E('lead', 'tests'), E('lead', 'build'), E('ui', 'ui-a'), E('ui', 'ui-b'), E('lead2', 'schema'), E('lead2', 'perf'), E('lead2', 'port'), E('lead3', 't1'), E('lead3', 't2'),
    E('human', 'lead', 'bar', { count: 3, label: 'ship it' }), E('human', 'lead2', 'bar'), E('human', 'app-try', 'loop'), E('tests', 'perf', 'prompt')];
  return { nodes, edges };
}
const ORDER = ['app', 'api', 'docs', 'notes', 'misc', 'tools', 'scratch'];
const VG = [{ id: 'work', name: 'work', members: ['app', 'api', 'docs'] }, { id: 'side', name: 'side', members: ['notes', 'misc'] }];

test('P145: 나 상자와 사람 선이 없다, 사람의 지시는 받는 세션 표시로 남는다', () => {
  const lay = missionLayout(mixed(), { order: ORDER, vgroups: VG, width: 1600 });
  assert.ok(!lay.boxes.has('human'));
  assert.ok(![...lay.boxes.values()].some((b) => b.kind === 'you'));
  assert.ok(!lay.edges.some((e) => e.from === 'human' || e.rel === 'human'));
  assert.deepEqual([...lay.human.keys()].sort(), ['s:app-try', 's:lead', 's:lead2']);
  assert.deepEqual({ ...lay.human.get('s:lead'), kinds: undefined }, { count: 3, lastAt: 0, text: 'ship it', kinds: undefined });
  assert.equal(MISSION.you, undefined); assert.equal(MISSION.youGap, undefined);
});

test('P145: 팀의 맨 위는 지도 왼쪽 끝 열 — 폴더가 없으면 pad, 있으면 상자 여백만큼', () => {
  const noFolder = missionLayout(mixed(), { order: ORDER, width: 1600 });
  assert.equal(noFolder.boxes.get('s:lead').x, MISSION.pad);
  assert.equal(noFolder.groups[0].x, MISSION.pad);
  const lay = missionLayout(mixed(), { order: ORDER, vgroups: VG, width: 1600 });
  assert.equal(lay.boxes.get('s:lead').x, MISSION.pad + FOLDER.m);
  // 위아래로 쌓이는 좁은 지도에서는 열이 지도 전체에서 같다(폴더 밖 팀도)
  const narrow = missionLayout(mixed(), { order: ORDER, vgroups: VG, width: 1000 });
  assert.equal(narrow.boxes.get('s:lead3').x, narrow.boxes.get('s:lead').x, '열은 지도 전체에서 같다');
  // 폴더 상자 왼쪽 테두리도 지도 안(판 여백 바깥)
  const f = lay.folders.find((x) => x.id === 'work');
  assert.ok(f.x >= MISSION.pad - MISSION.plate - 0.01 && f.x < MISSION.pad);
  // 사람 선을 받는 세션도, 받지 않는 세션도 같은 자리(사람 선이 배치를 밀지 않는다)
  const g = mixed(); g.edges = g.edges.filter((e) => e.from !== 'human');
  const bare = missionLayout(g, { order: ORDER, vgroups: VG, width: 1600 });
  assert.deepEqual([...bare.boxes.entries()].map(([k, v]) => [k, v.x, v.y]), [...lay.boxes.entries()].map(([k, v]) => [k, v.x, v.y]));
});

test('P145: 팀 워크스페이스의 혼자인 세션은 팀 아래, 팀이 차지한 열들에 나눠 놓는다(열 자리 그대로)', () => {
  const lay = missionLayout(mixed(), { order: ORDER, width: 1600 });
  const b = (id) => lay.boxes.get(`s:${id}`);
  const solo = ['app-notes', 'app-try', 'app-old'].map(b);
  const teamBottom = Math.max(...['lead', 'ui', 'tests', 'build', 'ui-a', 'ui-b'].map((k) => b(k).y + b(k).h));
  for (const s of solo) assert.ok(s.y >= teamBottom + MISSION.cardGap + MISSION.looseGap, '팀 아래, 팀원으로 읽히지 않게 더 띄운다');
  assert.deepEqual(solo.map((s) => s.x), [b('lead').x, b('ui').x, b('ui-a').x], '세 열(리드·하위·그 아래 열)에 하나씩');
  assert.equal(new Set(solo.map((s) => s.y)).size, 1, '한 줄');
  for (const s of solo) assert.ok(s.loose);
  // api: 팀이 두 열이고 혼자는 하나 → 리드 열
  assert.equal(b('api-x').x, b('lead2').x);
  assert.equal(overlap(lay), null);
});

test('P145: 혼자인 세션이 많은 워크스페이스는 판 안에서 기둥 여럿(packCap마다 하나까지, 세 개까지) 중 아래 끝이 가장 높은 것', () => {
  const step = MISSION.boxW + MISSION.slotGap;
  for (const width of [1000, 1300, 1600]) {
    const lay = missionLayout(mixed(), { order: ORDER, width });
    const notes = [...lay.boxes.values()].filter((x) => x.group === 'notes');
    assert.equal(notes.length, 7);
    const xs = [...new Set(notes.map((x) => x.x))].sort((a, b) => a - b);
    assert.ok(xs.length <= Math.ceil(7 / MISSION.packCap));
    xs.forEach((x, i) => assert.equal(x - xs[0], i * step));
  }
  // 혼자뿐인 판 하나(세션 18개): 좁은 빈 곳이 없으면 세 기둥으로 납작하게
  clock = 0;
  const big = { nodes: Array.from({ length: 18 }, (_, i) => node(`z${i}`, 'z')), edges: [] };
  const lb = missionLayout(big, { width: 1600 });
  assert.equal(new Set([...lb.boxes.values()].map((x) => x.x)).size, 3);
  // 좁은 지도에서는 남은 폭만큼만
  const narrow = missionLayout(big, { width: 480 });
  assert.equal(new Set([...narrow.boxes.values()].map((x) => x.x)).size, 1);
});

test('P145: 섞은 판(폴더 둘·폴더 밖, 세션 30개) — 겹침 없음, 판·상자 사이 틈, 앞으로 가는 선의 틈에 상자 없음, 폭 안', () => {
  for (const width of [1000, 1300, 1600, 2000]) {
    const lay = missionLayout(mixed(), { order: ORDER, vgroups: VG, width });
    assert.equal([...lay.boxes.values()].filter((x) => x.node.kind === 'session').length, 30);
    assert.equal(overlap(lay), null, `${width}`);
    // 폴더 상자와 폴더 밖 판(바깥 단위)은 서로 틈만큼 떨어진다
    const outer = [...lay.folders.map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h })), ...lay.groups.filter((g) => !g.folder).map((g) => ({ id: g.key, ...g.plate }))];
    for (let i = 0; i < outer.length; i++) for (let j = i + 1; j < outer.length; j++) assert.ok(!hit(grow(outer[i], GUT / 2 - 0.01), grow(outer[j], GUT / 2 - 0.01)), `${width}: ${outer[i].id} × ${outer[j].id}`);
    // 같은 폴더 안 판끼리도 겹치지 않는다
    for (const f of lay.folders) { const ps = lay.groups.filter((g) => g.folder === f.id).map((g) => g.plate); for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.ok(!hit(ps[i], ps[j]), `${width}: ${f.id} 판`); }
    for (const e of lay.edges.filter((x) => x.tree && !x.back)) {
      const a = lay.boxes.get(e.from), b = lay.boxes.get(e.to);
      for (const o of lay.boxes.values()) assert.ok(!(o.x < b.x && o.x + o.w > a.x + a.w && o.y < Math.max(a.y + a.h, b.y + b.h) && o.y + o.h > Math.min(a.y, b.y)), `${width}: ${e.id}의 틈에 ${o.node.id}`);
    }
    assert.ok(lay.edges.every((e) => !/NaN|undefined/.test(e.d)));
    if (width >= 1300) assert.ok(lay.width <= width + 1, `${width}: 지도 폭 ${lay.width}`);
  }
});

test('P145: 촘촘함 — 같은 판에서 지도 높이가 예전 배치(나 자리, 열 사이 72, 혼자인 세션 1열, 팀은 한 기둥으로 쌓기)보다 15% 넘게 낮다', () => {
  // 예전 배치의 높이는 git 밖 experiments/p145/measure.mjs로 잰 값(폭 1000: 1416, 1300: 1250, 1600: 860). 새 배치는 1310·1050·674
  // P149: 카드(216×64 → 232×84)와 알약(28 → 44)이 커졌으므로 이 견줌은 P145 때 크기로 돌린다(배치 방법의 촘촘함을 본다)
  const keep = { ...MISSION };
  Object.assign(MISSION, { boxW: 216, boxH: 64, rowH: 28 });
  try {
    for (const [width, old] of [[1300, 1250], [1600, 860]]) {
      const lay = missionLayout(mixed(), { order: ORDER, vgroups: VG, width });
      assert.ok(lay.height < old * 0.85, `${width}: ${lay.width} × ${lay.height}`);
      assert.ok(lay.width <= width + 1);
    }
    assert.ok(missionLayout(mixed(), { order: ORDER, vgroups: VG, width: 1000 }).height < 1416);
  } finally { Object.assign(MISSION, keep); }
});

test('P145: 창 — 나 동그라미와 그 사전 말이 없다, 사람의 지시는 카드 풍선 도움말 한 줄', () => {
  const src = read('Mission.jsx');
  assert.ok(!/mt-mm-you|mmMap\.you|kind === 'you'/.test(src));
  assert.match(src, /human=\{lay\.human\.get\(b\.node\.id\)\}/);
  assert.match(src, /fromYou/);
  assert.ok(!/\.mt-mm-you|rel-human/.test(read('styles.css')));
  for (const f of ['locales/en.js', 'locales/ko.js']) assert.ok(!/youTitle|colHuman/.test(read(f)), f);
});
