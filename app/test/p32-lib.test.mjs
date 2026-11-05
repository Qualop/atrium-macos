// P32 미션 맵 배치(lib/mission-layout.js) 시험: 나무(왼쪽 → 오른쪽), 한 쌍의 선 모으기, 겹치지 않음(세션이 많아도), 거르기와 조상, 고리, 연결 없음 칸
import test from 'node:test';
import assert from 'node:assert/strict';
import { missionLayout, mergeEdges, edgeLabel, MISSION } from '../src/renderer/lib/mission-layout.js';

const H = { id: 'human', kind: 'human' };
const S = (id, o = {}) => ({ id: `s:${id}`, kind: 'session', name: id, category: 'idle', ...o });
const E = (from, to, kind, o = {}) => ({ id: `${kind}:${from}>${to}`, from: from === 'human' ? 'human' : `s:${from}`, to: `s:${to}`, kind, ...o });
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const noOverlap = (lay) => { const bs = [...lay.boxes.values()]; for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (hit(bs[i], bs[j])) return `${bs[i].node.id} × ${bs[j].node.id}`; return null; };
// 이름표 사각형(오른쪽 끝이 lx, 가운데 높이 ly, 너비 최대 labelW, 높이 18)
const labelRects = (lay) => lay.edges.filter((e) => e.label).map((e) => ({ id: e.id, x: e.lx - MISSION.labelW, y: e.ly - 9, w: MISSION.labelW, h: 18 }));

// 미션 맵 시험 판과 같은 모양: 사람 → lead → w1, w2(워커), rev(리뷰어), helper(하위 세션, 역할 + 띄움), solo(연결 없음)
const base = () => ({
  nodes: [H, S('lead', { category: 'done' }), S('w1', { category: 'working' }), S('w2'), S('rev'), S('helper', { category: 'needs_you', parentId: 's:lead', depth: 2, role: 'helper' }), S('solo')],
  edges: [E('human', 'lead', 'bar', { count: 2, label: 'go' }), E('lead', 'w1', 'role', { label: 'worker' }), E('lead', 'w2', 'role', { label: 'worker' }), E('lead', 'rev', 'role', { label: 'reviewer' }), E('lead', 'helper', 'role', { label: 'helper', active: true }), E('lead', 'helper', 'spawn', { label: '띄움' })],
});

test('P32: 나무 — 사람 0열, 지시하는 세션 1열, 받는 세션 2열. 부모는 자식들 가운데, 사람은 선이 가는 세션 높이', () => {
  const lay = missionLayout(base());
  const b = (id) => lay.boxes.get(id);
  assert.equal(b('human').depth, 0);
  assert.equal(b('s:lead').depth, 1);
  for (const k of ['w1', 'w2', 'rev', 'helper']) assert.equal(b(`s:${k}`).depth, 2, k);
  assert.ok(b('s:lead').x > b('human').x + b('human').w && b('s:w1').x > b('s:lead').x + b('s:lead').w, '왼쪽 → 오른쪽');
  const kids = ['helper', 'rev', 'w1', 'w2'].map((k) => b(`s:${k}`).y);
  assert.deepEqual(kids, [...kids].sort((x, y) => x - y), '형제는 이름 순으로 위에서 아래');
  assert.equal(b('s:lead').y, (Math.min(...kids) + Math.max(...kids)) / 2, '부모는 자식들 가운데');
  assert.equal(b('human').y, b('s:lead').y, '사람은 명령 바가 가는 lead 높이');
  assert.equal(lay.columns, 3);
  assert.deepEqual(lay.loose, ['s:solo']);
  const sec = lay.groups[0].looseAt; // P46: 연결 없음 칸은 무리 안 나무 아래
  assert.ok(sec && b('s:solo').y > sec.y && sec.y > b('s:w2').y + MISSION.boxH, '연결 없음 칸은 나무 아래');
  assert.equal(noOverlap(lay), null);
});

test('P32: 한 쌍의 선은 하나 — 역할 + 띄움은 역할 모양, 이름표는 역할 이름, 화살표는 받는 상자 왼쪽 끝', () => {
  const lay = missionLayout(base());
  const lh = lay.edges.filter((e) => e.to === 's:helper');
  assert.equal(lh.length, 1);
  assert.deepEqual(lh[0].kinds, ['role', 'spawn']);
  assert.equal(lh[0].primary, 'role');
  assert.equal(lh[0].active, true);
  const t = (k) => ({ 'mission.edge.bar': 'Command bar', 'mission.edge.prompt': 'Prompt' }[k] || k);
  assert.equal(edgeLabel(lh[0], t), 'helper');
  const bar = lay.edges.find((e) => e.primary === 'bar');
  assert.equal(edgeLabel(bar, t), 'Command bar ×2');
  const to = lay.boxes.get('s:helper');
  assert.match(lh[0].d, new RegExp(` ${to.x},${to.y + MISSION.boxH / 2}$`));
  assert.ok(lay.edges.every((e) => e.label && !e.back && e.tree));
  // 이름표는 두 상자 사이 틈 안
  for (const e of lay.edges) { const a = lay.boxes.get(e.from), b = lay.boxes.get(e.to); assert.ok(e.lx - MISSION.labelW >= a.x + a.w && e.lx <= b.x, e.id); }
});

test('P32: mergeEdges — 없는 노드와 자기 자신 선은 뺀다, 횟수는 띄움을 빼고 더한다', () => {
  const ps = mergeEdges([{ from: 'a', to: 'b', kind: 'spawn', count: 9 }, { from: 'a', to: 'b', kind: 'prompt', count: 2, label: 'x', lastAt: 5 }, { from: 'a', to: 'a', kind: 'role' }, { from: 'a', to: 'z', kind: 'role' }], (id) => id !== 'z');
  assert.equal(ps.length, 1);
  assert.deepEqual(ps[0].kinds, ['prompt', 'spawn']);
  assert.equal(ps[0].count, 2);
  assert.equal(ps[0].text, 'x');
});

test('P32: 많은 세션(40개, 지시자 여럿, 두 번째 지시자, 고리)에서도 상자·이름표가 겹치지 않는다', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const nodes = [H]; const edges = [];
  for (let i = 0; i < 40; i++) nodes.push(S(`n${String(i).padStart(2, '0')}`, { category: ['idle', 'working', 'needs_you', 'done', 'exited'][i % 5] }));
  for (let i = 1; i < 40; i++) {
    if (rnd() < 0.25) continue; // 연결 없음
    const p = Math.floor(rnd() * i);
    edges.push(E(`n${String(p).padStart(2, '0')}`, `n${String(i).padStart(2, '0')}`, ['role', 'prompt', 'spawn'][i % 3], { label: 'r' + (i % 4) }));
    if (rnd() < 0.3) edges.push(E(`n${String(Math.floor(rnd() * 40)).padStart(2, '0')}`, `n${String(i).padStart(2, '0')}`, 'prompt'));
  }
  edges.push(E('human', 'n00', 'bar'), E('human', 'n05', 'loop'), E('n05', 'n00', 'prompt')); // 고리 하나
  const lay = missionLayout({ nodes, edges });
  assert.equal(lay.boxes.size, 41, '모든 세션과 사람');
  assert.equal(noOverlap(lay), null);
  const ls = labelRects(lay);
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) assert.ok(!hit(ls[i], ls[j]), `${ls[i].id} × ${ls[j].id}`);
  for (const l of ls) for (const b of lay.boxes.values()) assert.ok(!hit(l, b), `${l.id} × ${b.node.id}`);
  // 받는 상자마다 이름표는 maxPorts개까지
  const per = new Map(); for (const e of lay.edges.filter((x) => x.label)) per.set(e.to, (per.get(e.to) || 0) + 1);
  assert.ok([...per.values()].every((n) => n <= MISSION.maxPorts));
  assert.ok(lay.width > 0 && lay.height > Math.max(...[...lay.boxes.values()].map((b) => b.y + b.h)));
});

test('P32: 고리(A ↔ B)도 둘 다 놓이고 하나는 나무 밖 선(이름표 없음)', () => {
  const lay = missionLayout({ nodes: [H, S('a'), S('b')], edges: [E('a', 'b', 'prompt'), E('b', 'a', 'prompt')] });
  assert.equal(lay.boxes.size, 3);
  assert.equal(lay.edges.length, 2);
  assert.equal(lay.edges.filter((e) => e.tree).length, 1);
  const back = lay.edges.find((e) => !e.tree);
  assert.equal(back.label, false);
  assert.equal(back.back, true);
});

test('P32: 거르기 — 맞는 세션과 그 조상(흐리게)만, 사람은 나무가 있을 때만, 선은 보이는 상자 사이만', () => {
  const lay = missionLayout(base(), { filter: 'needs_you' });
  assert.deepEqual([...lay.boxes.keys()].sort(), ['human', 's:helper', 's:lead']);
  assert.equal(lay.boxes.get('s:lead').ghost, true);
  assert.equal(lay.boxes.get('s:helper').ghost, false);
  assert.deepEqual(lay.edges.map((e) => e.to).sort(), ['s:helper', 's:lead']);
  const idle = missionLayout(base(), { filter: 'idle' });
  assert.ok(idle.loose.includes('s:solo') && idle.boxes.get('s:lead').ghost);
  const none = missionLayout({ nodes: [H, S('x')], edges: [] }, { filter: 'all' });
  assert.deepEqual([...none.boxes.keys()], ['s:x'], '선이 없으면 사람 상자 없이 연결 없음 칸만');
  assert.equal(none.groups.length, 1, '연결 없는 세션도 무리 안에(P46)'); assert.equal(none.boxes.get('s:x').y, MISSION.pad + MISSION.groupHead + MISSION.groupPad);
  assert.equal(missionLayout({ nodes: [H, S('x')], edges: [] }, { filter: 'working' }).boxes.size, 0);
});

test('P32: 하위 세션은 띄움 선이 없어도 부모 오른쪽에(옛 판)', () => {
  const lay = missionLayout({ nodes: [H, S('p'), S('c', { parentId: 's:p', depth: 2 })], edges: [] });
  assert.equal(lay.boxes.get('s:c').depth, lay.boxes.get('s:p').depth + 1);
  assert.equal(lay.edges.length, 1);
  assert.equal(lay.edges[0].primary, 'spawn');
});
