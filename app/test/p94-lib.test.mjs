// P94 단위 시험: 미션 맵의 공용 역할·관계 모델(lib/mission-model.js)과 PC 배치(lib/mission-layout.js)·휴대폰(lib/phone-mission.js, lib/phone-graph.js)이 같은 분류를 쓰는지.
// 역할 묶음, 나무 부모(같은 등급이면 리드 쪽), 등급(lead·sub·worker·solo), 팀 요약(기다림, 올라온 응답 필요), 관계 종류(spawn·role·prompt·human, cross),
// 강조 대상 고르기, 가상 그룹 차례와 띠, 팀 상자, 배치(겹침 없음, 리드 → 워커 순서)
import test from 'node:test';
import assert from 'node:assert/strict';
import { roleFamily, missionTree, roleModel, relOf, focusOf, groupedOrder, teamText, roleText, mergeEdges } from '../src/renderer/lib/mission-model.js';
import { missionLayout, MISSION, mergeEdges as layoutMerge } from '../src/renderer/lib/mission-layout.js';
import { phoneMission } from '../src/renderer/lib/phone-mission.js';
import { phoneGraph } from '../src/renderer/lib/phone-graph.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

let clock = 0;
const node = (id, ws, o = {}) => ({ id: `s:${id}`, kind: 'session', sessionId: id, name: id, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: ws, parentId: null, role: null, order: null, createdAt: ++clock, loops: 0, ...o });
const kid = (id, ws, parent, o = {}) => node(id, ws, { parentId: `s:${parent}`, role: o.role || null, order: ++clock, ...o });
const T = (k, p = {}) => { const v = k.split('.').reduce((o, x) => o && o[x], en); return String(v).replace(/\{(\w+)\}/g, (_, n) => p[n]); };

// 판: 리드 A(워커 넷과 리뷰어, 리뷰어 아래 보관 워커), 리드 B(다른 워크스페이스의 워커), 역할 연결, 요청, 응답 필요, 잠듦, 연결 없음
function board() {
  clock = 0;
  const nodes = [
    { id: 'human', kind: 'human', name: 'you', column: 0 },
    node('lead', 'wa', { state: 'waiting', category: 'needs_you', ask: 'Bash: mkdir x' }),
    kid('rev', 'wa', 'lead', { role: 'reviewer', state: 'working', category: 'working' }),
    node('ui', 'wa', { agentKind: 'shell' }), node('tests', 'wa', { agentKind: 'shell', state: 'shell_running', category: 'working' }), node('build', 'wa', { agentKind: 'shell' }), node('copy', 'wa', { agentKind: 'shell' }),
    node('lead2', 'wb'), kid('port', 'wc', 'lead2', { role: 'porter', state: 'working', category: 'working' }), node('notes', 'wb', { agentKind: 'shell' }),
    node('docs', 'wc', { agentKind: 'shell' }), node('old', 'wd', { state: 'sleeping' }),
  ];
  const edges = [
    { from: 's:lead', to: 's:rev', kind: 'role', label: 'reviewer' }, { from: 's:lead', to: 's:rev', kind: 'spawn' },
    { from: 's:lead2', to: 's:port', kind: 'role', label: 'porter' }, { from: 's:lead2', to: 's:port', kind: 'spawn' },
    { from: 's:lead', to: 's:ui', kind: 'role', label: 'ui worker' }, { from: 's:lead', to: 's:tests', kind: 'role', label: 'test runner' },
    { from: 's:lead', to: 's:build', kind: 'role', label: 'build worker' }, { from: 's:lead', to: 's:copy', kind: 'role', label: 'copy writer' },
    { from: 's:lead2', to: 's:notes', kind: 'role', label: 'notes' },
    { from: 's:rev', to: 's:ui', kind: 'role', label: 'review' }, // 나무 밖(ui의 부모는 리드)
    { from: 's:rev', to: 's:old', kind: 'role', label: 'archive' }, // 다른 워크스페이스
    { from: 's:lead2', to: 's:docs', kind: 'prompt', label: 'fix the readme', count: 2, active: true },
    { from: 'human', to: 's:lead', kind: 'bar', count: 1 },
  ];
  return { nodes, edges, counts: {} };
}
const live = (g) => new Map(g.nodes.filter((n) => n.kind === 'session').map((n) => [n.sessionId, { state: n.state, kind: n.agentKind, shell: n.state === 'shell_running' ? { atPrompt: false } : n.agentKind === 'shell' ? { atPrompt: true } : null }]));

test('역할 이름 → 묶음: 리뷰·테스트·문서, 그 밖은 워커', () => {
  for (const s of ['reviewer', 'code review', 'auditor', '검토', 'Verify']) assert.equal(roleFamily(s), 'review', s);
  for (const s of ['test runner', 'qa', 'e2e', 'linter', '테스트']) assert.equal(roleFamily(s), 'test', s);
  for (const s of ['copy writer', 'notes', 'docs', 'ko-copy', '문서']) assert.equal(roleFamily(s), 'docs', s);
  for (const s of ['ui worker', 'porter', 'archive', '', null]) assert.equal(roleFamily(s), 'worker', String(s));
});

test('나무 부모: 하위 세션의 부모 > 역할, 같은 등급이면 더 얕은 쪽(리드). 고리는 만들지 않는다', () => {
  const t = missionTree(board());
  assert.equal(t.parent.get('s:rev'), 's:lead');
  assert.equal(t.parent.get('s:ui'), 's:lead', 'lead(깊이 0)와 rev(깊이 1)가 둘 다 역할 연결이면 리드');
  assert.equal(t.parent.get('s:old'), 's:rev');
  assert.equal(t.parent.get('s:docs'), 's:lead2', '요청도 나무 부모가 된다');
  assert.ok(!t.parent.has('s:lead') && !t.parent.has('s:lead2'));
  const loop = missionTree({ nodes: [node('a', 'w'), node('b', 'w')], edges: [{ from: 's:a', to: 's:b', kind: 'role', label: 'x' }, { from: 's:b', to: 's:a', kind: 'role', label: 'y' }] });
  assert.equal(loop.parent.size, 1, '고리면 하나만 부모');
  assert.equal(mergeEdges, layoutMerge, 'PC 배치는 공용 모델의 mergeEdges를 쓴다');
});

test('등급과 팀 요약: 리드·하위 리드·워커·연결 없음, 쉬는 리드는 워커를 기다리고 응답 필요는 리드에 올라온다', () => {
  const g = board();
  const m = roleModel(g, { live: live(g) });
  const r = (id) => m.get(`s:${id}`);
  assert.equal(r('lead').rank, 'lead'); assert.equal(r('lead').family, 'lead');
  assert.equal(r('lead2').rank, 'lead');
  assert.equal(r('rev').rank, 'sub'); assert.equal(r('rev').family, 'review'); assert.equal(r('rev').roleName, 'reviewer');
  assert.equal(r('tests').rank, 'worker'); assert.equal(r('tests').family, 'test');
  assert.equal(r('copy').family, 'docs');
  assert.equal(r('port').roleName, 'porter');
  assert.equal(r('old').rank, 'worker'); assert.equal(r('old').lead, 's:lead', '팀의 맨 위');
  assert.deepEqual(r('lead').team, { size: 6, work: 2, turn: 0, sleep: 1 });
  assert.equal(r('lead').waiting, 2, '응답 필요인 리드도 일하지 않으므로 기다림');
  assert.equal(r('lead2').waiting, 1, '쉬는 리드 B는 port를 기다린다');
  assert.equal(r('rev').waiting, 0, '일하는 rev는 기다리지 않는다');
  // 워커가 응답 필요면 리드에 올라온다
  const g2 = board(); g2.nodes.find((n) => n.id === 's:port').state = 'waiting';
  const m2 = roleModel(g2, { live: live(g2) });
  assert.equal(m2.get('s:lead2').climb, 1); assert.equal(m2.get('s:lead2').waiting, 0);
  assert.equal(teamText(r('lead'), T), 'Team 6 · 2 working');
  assert.equal(teamText(m2.get('s:lead2'), T), 'Team 3 · 1 need you');
  assert.equal(roleText(r('lead'), T), 'Lead');
  assert.equal(roleText(r('rev'), T), 'reviewer · leads');
  assert.equal(roleText(r('rev'), T, { short: true }), 'reviewer');
  assert.equal(roleText({ rank: 'solo' }, T), 'No links');
  // docs는 lead2의 요청을 받으므로 worker. 아무 선도 없는 세션은 solo
  const g3 = { nodes: [node('alone', 'w')], edges: [] };
  assert.equal(roleModel(g3).get('s:alone').rank, 'solo');
});

test('관계 종류: 띄운 하위 세션은 spawn(역할 이름이 있어도), 역할 연결은 role, 요청은 prompt, 사람은 human', () => {
  const g = board(), t = missionTree(g);
  const pair = (a, b) => mergeEdges(g.edges).find((p) => p.from === a && p.to === b);
  assert.equal(relOf(pair('s:lead', 's:rev'), t), 'spawn');
  assert.equal(relOf(pair('s:lead', 's:ui'), t), 'role');
  assert.equal(relOf(pair('s:lead2', 's:docs'), t), 'prompt');
  assert.equal(relOf(pair('human', 's:lead'), t), 'human');
  assert.equal(relOf({ from: 's:lead2', to: 's:port', kinds: ['role'] }, t), 'spawn', 'parentId가 같으면 띄움 선이 없어도 spawn');
});

test('강조 대상: 그 세션, 조상, 팀, 바로 이어진 세션과 그 사이 선만', () => {
  const g = board(), t = missionTree(g);
  const f = focusOf(t, 's:lead2');
  assert.deepEqual([...f.nodes].sort(), ['s:docs', 's:lead2', 's:notes', 's:port']);
  assert.equal(f.lead, 's:lead2');
  assert.ok(f.pairs.has('s:lead2>s:port') && f.pairs.has('s:lead2>s:docs') && !f.pairs.has('s:lead>s:rev'));
  const r = focusOf(t, 's:rev');
  for (const id of ['s:rev', 's:lead', 's:ui', 's:old']) assert.ok(r.nodes.has(id), id);
  assert.ok(!r.nodes.has('s:tests') && !r.nodes.has('s:lead2'), '형제와 다른 팀은 물러난다');
  assert.ok(r.pairs.has('s:lead>s:rev') && r.pairs.has('s:rev>s:ui') && r.pairs.has('s:rev>s:old') && !r.pairs.has('s:lead>s:tests'));
  assert.equal(r.lead, 's:lead');
  const human = { id: 'human>s:lead', from: 'human', to: 's:lead' };
  assert.ok(focusOf(t, 's:lead', [human]).pairs.has('human>s:lead'), '사람 선도 넘겨 주면 강조');
  assert.equal(focusOf(t, 's:nope'), null);
});

test('가상 그룹 차례: 같은 그룹의 워크스페이스는 처음 나온 자리에 붙는다', () => {
  const { order, groupOf } = groupedOrder(['wa', 'wc', 'wb', 'wd'], [{ id: 'g1', name: 'product', members: ['wa', 'wb'] }]);
  assert.deepEqual(order, ['wa', 'wb', 'wc', 'wd']);
  assert.equal(groupOf.get('wb').name, 'product'); assert.ok(!groupOf.has('wc'));
  assert.deepEqual(groupedOrder(['wa'], []).order, ['wa']);
  assert.deepEqual(groupedOrder([], [{ id: 'g', name: 'x', members: ['wz'] }]).order, ['wz'], '목록에 없는 그룹 워크스페이스도 차례에 든다');
});

const boxOverlap = (boxes) => { const bs = [...boxes.values()].filter((b) => !b.proxy); for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i], b = bs[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return `${a.node.id}↔${b.node.id}`; } return null; };

test('PC 배치: 겹침 없음, 리드 → 워커 순서, 선마다 관계 종류, 가상 그룹은 머리 글 앞 이름(P95: 띠·팀 상자 없음)', () => {
  const g = board();
  const lay = missionLayout(g, { order: ['wa', 'wc', 'wb', 'wd'], vgroups: [{ id: 'g1', name: 'product', members: ['wa', 'wb'] }] });
  assert.equal(boxOverlap(lay.boxes), null);
  const b = (id) => lay.boxes.get(`s:${id}`);
  for (const w of ['rev', 'ui', 'tests', 'build', 'copy']) assert.ok(b(w).x > b('lead').x, `${w}는 리드 오른쪽`);
  assert.ok(b('old').x > b('rev').x, '손자는 그 부모 오른쪽');
  assert.ok(b('port').x > b('lead2').x && b('notes').x > b('lead2').x);
  // 형제는 띄운 순서
  assert.ok(b('ui').y < b('tests').y && b('tests').y < b('build').y && b('build').y < b('copy').y);
  assert.equal(MISSION.boxH, 64);
  const rel = (a, z) => (lay.edges.find((e) => e.from === `s:${a}` && e.to === `s:${z}`) || {}).rel;
  assert.equal(rel('lead', 'rev'), 'spawn'); assert.equal(rel('lead', 'ui'), 'role'); assert.equal(rel('lead2', 'docs'), 'prompt');
  assert.equal(lay.edges.find((e) => e.from === 'human').rel, 'human');
  const cross = lay.edges.find((e) => e.from === 's:lead2' && e.to === 's:port');
  assert.ok(cross.cross, '다른 워크스페이스로 간 선은 cross');
  // 머리 글 차례: 팀이 있는 wa, wb(product끼리 붙는다), 다른 워크스페이스 하위만 있는 wc·wd는 머리 글이 없다(부모 팀 안에 놓인다)
  assert.deepEqual(lay.groups.map((x) => x.key), ['wa', 'wb']);
  assert.equal(lay.groups[0].vg.name, 'product'); assert.equal(lay.groups[1].vg.name, 'product');
  assert.equal(b('docs').group, 'wb'); assert.equal(b('old').group, 'wa');
  assert.equal(lay.bands, undefined); assert.equal(lay.teams, undefined);
  assert.deepEqual([...lay.teamNo.entries()], [['s:lead', 1], ['s:lead2', 2]], '팀 번호(요약 열과 카드)');
});

test('휴대폰도 같은 분류: 줄마다 등급·묶음·팀·관계 종류, 무리에 가상 그룹, 그래프 선의 rel, 겹침 없음', () => {
  const g = board();
  const pm = phoneMission(g, { live: live(g), order: ['wa', 'wc', 'wb', 'wd'], vgroups: [{ id: 'g1', name: 'product', members: ['wa', 'wb'] }] });
  const rows = Object.fromEntries(pm.groups.flatMap((x) => x.rows).map((r) => [r.name, r]));
  const m = roleModel(g, { live: live(g) });
  for (const [name, r] of Object.entries(rows)) { const pc = m.get(`s:${name}`); assert.equal(r.rank, pc.rank, name); assert.equal(r.family, pc.family, name); }
  assert.equal(rows.lead2.waiting, 1); assert.deepEqual(rows.lead.team, { size: 6, work: 2, turn: 0, sleep: 1 });
  assert.equal(rows.rev.rel, 'spawn'); assert.equal(rows.ui.rel, 'role'); assert.equal(rows.docs.rel, 'prompt');
  assert.deepEqual(pm.groups.map((x) => x.key), ['wa', 'wb', 'wc', 'wd']);
  assert.equal(pm.groups[1].vg.name, 'product');
  const pg = phoneGraph(pm, { width: 373 });
  assert.equal(pg.groups[0].vg.name, 'product');
  const er = (kind, a, z) => (pg.edges.find((e) => e.kind === kind && e.from === `s:${a}` && e.to === `s:${z}`) || {}).rel;
  assert.equal(er('tree', 'lead', 'rev'), 'spawn'); assert.equal(er('tree', 'lead', 'ui'), 'role');
  assert.equal(er('link', 'rev', 'ui'), 'role', '나무 밖 역할 연결');
  assert.equal(er('tree', 'lead2', 'port'), 'spawn', 'P95: 다른 워크스페이스 하위도 부모 팀 안(나무 선)');
  for (let i = 0; i < pg.nodes.length; i++) for (let j = i + 1; j < pg.nodes.length; j++) { const a = pg.nodes[i], b = pg.nodes[j]; assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${a.id}↔${b.id}`); }
});

test('사전: mmRole 열쇠가 두 언어에 모두 있다', () => {
  assert.deepEqual(Object.keys(ko.mmRole).sort(), Object.keys(en.mmRole).sort());
  for (const k of ['lead', 'team', 'teamWork', 'teamTurn', 'waiting', 'climb', 'relSpawn', 'relRole', 'relPrompt', 'relHuman', 'relCross', 'hint', 'groupTag']) assert.ok(en.mmRole[k] && ko.mmRole[k], k);
});
