// P32 미션 맵 배치(lib/mission-layout.js) 시험: 나무(왼쪽 → 오른쪽), 한 쌍의 선 모으기, 겹치지 않음(세션이 많아도), 고리, 연결 없는 세션.
// P95: 선 이름표와 "연결 없음" 칸은 없어졌다. 거르기는 배치를 바꾸지 않고 흐리게만 한다(filterMatch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { missionLayout, mergeEdges, edgeLabel, MISSION } from '../src/renderer/lib/mission-layout.js';
import { filterMatch, nodeTier } from '../src/renderer/lib/mission-model.js';

const H = { id: 'human', kind: 'human' };
const S = (id, o = {}) => ({ id: `s:${id}`, kind: 'session', name: id, category: 'idle', ...o });
const E = (from, to, kind, o = {}) => ({ id: `${kind}:${from}>${to}`, from: from === 'human' ? 'human' : `s:${from}`, to: `s:${to}`, kind, ...o });
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const noOverlap = (lay) => { const bs = [...lay.boxes.values()].filter((b) => b.kind !== 'dots'); for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (hit(bs[i], bs[j])) return `${bs[i].node.id} × ${bs[j].node.id}`; return null; };
const cy = (b) => b.y + b.h / 2;

// 미션 맵 시험 판과 같은 모양: 사람 → lead → w1, w2(워커), rev(리뷰어), helper(하위 세션, 역할 + 띄움), solo(연결 없음)
const base = () => ({
  nodes: [H, S('lead', { category: 'done' }), S('w1', { category: 'working' }), S('w2'), S('rev'), S('helper', { category: 'needs_you', parentId: 's:lead', depth: 2, role: 'helper' }), S('solo')],
  edges: [E('human', 'lead', 'bar', { count: 2, label: 'go' }), E('lead', 'w1', 'role', { label: 'worker' }), E('lead', 'w2', 'role', { label: 'worker' }), E('lead', 'rev', 'role', { label: 'reviewer' }), E('lead', 'helper', 'role', { label: 'helper', active: true }), E('lead', 'helper', 'spawn', { label: '띄움' })],
});

test('P32 → P145: 나무 — 지시하는 세션 1열(지도 왼쪽 끝), 받는 세션 2열. 부모는 하위들의 세로 가운데, 나는 없다', () => {
  const lay = missionLayout(base());
  const b = (id) => lay.boxes.get(id);
  assert.equal(b('human'), undefined); assert.equal(b('s:lead').x, MISSION.pad);
  assert.equal(b('s:lead').depth, 1);
  for (const k of ['w1', 'w2', 'rev', 'helper']) assert.equal(b(`s:${k}`).depth, 2, k);
  assert.ok(b('s:w1').x > b('s:lead').x + b('s:lead').w, '왼쪽 → 오른쪽');
  const kids = ['helper', 'rev', 'w1', 'w2'].map((k) => b(`s:${k}`));
  assert.deepEqual(kids.map((k) => k.y), kids.map((k) => k.y).sort((x, y) => x - y), '형제는 이름 순으로 위에서 아래');
  assert.equal(cy(b('s:lead')), (kids[0].y + kids[3].y + kids[3].h) / 2, '부모는 하위들의 세로 가운데');
  assert.deepEqual([...lay.human.entries()].map(([k, v]) => [k, v.count, v.text]), [['s:lead', 2, 'go']], '사람의 지시는 받는 세션 표시로');
  assert.equal(lay.columns, 3);
  assert.deepEqual(lay.loose, ['s:solo']);
  assert.ok(b('s:solo').x === b('s:lead').x && b('s:solo').y > b('s:w2').y, 'P95: 같은 워크스페이스의 연결 없는 세션은 팀 아래 1열(따로 칸이 없다)');
  assert.equal(noOverlap(lay), null);
});

test('P32: 한 쌍의 선은 하나 — 역할 + 띄움, 풀이 글은 역할 이름, 선은 받는 상자 왼쪽 가운데로 모인다', () => {
  const lay = missionLayout(base());
  const lh = lay.edges.filter((e) => e.to === 's:helper');
  assert.equal(lh.length, 1);
  assert.deepEqual(lh[0].kinds, ['role', 'spawn']);
  assert.equal(lh[0].primary, 'role');
  assert.equal(lh[0].active, true);
  const t = (k) => ({ 'mission.edge.bar': 'Command bar', 'mission.edge.prompt': 'Prompt' }[k] || k);
  assert.equal(edgeLabel(lh[0], t), 'helper');
  assert.equal(edgeLabel({ primary: 'bar', count: 2 }, t), 'Command bar ×2');
  const to = lay.boxes.get('s:helper');
  assert.match(lh[0].d, new RegExp(` ${to.x},${cy(to)}$`));
  // 한 부모의 선은 모두 부모 오른쪽 가장자리에서 나간다(P101: 받는 쪽으로 살짝 펼친 높이, 카드 안쪽)
  const lead = lay.boxes.get('s:lead');
  for (const e of lay.edges.filter((x) => x.from === 's:lead')) { const m = e.d.match(/^M([\d.]+),([\d.]+) /); assert.ok(m && Number(m[1]) === lead.x + lead.w && Number(m[2]) > lead.y + 8 && Number(m[2]) < lead.y + lead.h - 8, e.id); }
  assert.ok(lay.edges.every((e) => !e.back && e.tree));
});

test('P32: mergeEdges — 없는 노드와 자기 자신 선은 뺀다, 횟수는 띄움을 빼고 더한다', () => {
  const ps = mergeEdges([{ from: 'a', to: 'b', kind: 'spawn', count: 9 }, { from: 'a', to: 'b', kind: 'prompt', count: 2, label: 'x', lastAt: 5 }, { from: 'a', to: 'a', kind: 'role' }, { from: 'a', to: 'z', kind: 'role' }], (id) => id !== 'z');
  assert.equal(ps.length, 1);
  assert.deepEqual(ps[0].kinds, ['prompt', 'spawn']);
  assert.equal(ps[0].count, 2);
  assert.equal(ps[0].text, 'x');
});

test('P32: 많은 세션(40개, 지시자 여럿, 두 번째 지시자, 고리)에서도 상자가 겹치지 않는다', () => {
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
  assert.equal([...lay.boxes.values()].filter((b) => b.node.kind === 'session').length, 40, '모든 세션(P145: 나는 없다)');
  assert.equal(noOverlap(lay), null);
  assert.ok(lay.width > 0 && lay.height >= Math.max(...[...lay.boxes.values()].map((b) => b.y + b.h)));
  assert.ok(lay.edges.every((e) => !/NaN|undefined/.test(e.d)));
});

test('P32: 고리(A ↔ B)도 둘 다 놓이고 하나는 나무 밖 선(뒤로 돈다)', () => {
  const lay = missionLayout({ nodes: [H, S('a'), S('b')], edges: [E('a', 'b', 'prompt'), E('b', 'a', 'prompt')] });
  assert.equal([...lay.boxes.keys()].filter((k) => k.startsWith('s:')).length, 2);
  assert.equal(lay.edges.length, 2);
  assert.equal(lay.edges.filter((e) => e.tree).length, 1);
  const back = lay.edges.find((e) => !e.tree);
  assert.equal(back.back, true);
});

test('P32 → P95: 거르기는 배치를 바꾸지 않는다(같은 자리), 맞지 않는 세션은 창이 흐리게 한다', () => {
  const a = missionLayout(base()), b = missionLayout(base(), { filter: 'needs_you' });
  assert.deepEqual([...a.boxes.entries()].map(([k, v]) => [k, v.x, v.y]), [...b.boxes.entries()].map(([k, v]) => [k, v.x, v.y]));
  const tier = (id) => nodeTier(base().nodes.find((n) => n.id === id));
  assert.deepEqual(['s:lead', 's:w1', 's:helper', 's:solo'].filter((id) => filterMatch(tier(id), 'needs_you')), ['s:helper']);
  assert.deepEqual(['s:lead', 's:w1', 's:helper', 's:solo'].filter((id) => filterMatch(tier(id), 'working')), ['s:w1']);
  assert.deepEqual(['s:lead', 's:w1', 's:helper', 's:solo'].filter((id) => filterMatch(tier(id), 'done')), ['s:lead']);
  assert.equal(filterMatch('sleep', 'exited'), true); assert.equal(filterMatch('rest', 'all'), true);
  const none = missionLayout({ nodes: [H, S('x')], edges: [] });
  assert.deepEqual([...none.boxes.keys()], ['s:x'], '선이 없으면 나 없이 세션만');
  assert.equal(none.groups.length, 1); assert.equal(none.boxes.get('s:x').y, MISSION.pad + MISSION.wsHead);
});

test('P32: 하위 세션은 띄움 선이 없어도 부모 오른쪽에(옛 판)', () => {
  const lay = missionLayout({ nodes: [H, S('p'), S('c', { parentId: 's:p', depth: 2 })], edges: [] });
  assert.equal(lay.boxes.get('s:c').depth, lay.boxes.get('s:p').depth + 1);
  assert.equal(lay.edges.length, 1);
  assert.equal(lay.edges[0].primary, 'spawn');
});
