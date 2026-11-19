// P163 단위 시험: 세션 맵(PC lib/mission-lineage.js, 휴대폰은 P166부터 같은 함수의 phone 배치)에서 하위가 셋 이상인 세션 아래 절전 하위를 얇은 줄로 줄이는지.
// 하위 2개는 모두 카드, 3개 이상이면 절전만 얇음, 작업 중·응답 필요·오류·완료 미확인은 카드, 자기 하위가 있거나 접기 칩이 붙는 절전 세션은 카드,
// 얇은 줄은 깨어 있는 카드 아래로 모이고(그 안은 만든 차례), 높이·간격, 동료 붙이기가 먼저, 휴대폰도 같은 판정, 창 연결.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineageLayout, applyRelationStub, relationDrop, LINE } from '../src/renderer/lib/mission-lineage.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const A = 'd:/work/app/.git';
let seq = 0;
const node = (n, parent = null, o = {}) => ({ id: `s:${n}`, kind: 'session', sessionId: `x-${n}`, name: n, workspaceKey: A, state: 'ready', parentId: parent ? `s:${parent}` : null, createdAt: 100 + seq++, ...o });
const spawn = (nodes) => nodes.filter((n) => n.parentId).map((n) => ({ from: n.parentId, to: n.id, kind: 'spawn', count: 1 }));
const sleep = { state: 'sleeping' };
const lay = (nodes, edges = null) => lineageLayout({ nodes, edges: edges || spawn(nodes) }, { order: [A] });
const thinIds = (l) => [...l.cards].filter(([, c]) => c.thin).map(([id]) => id);
const kidsY = (l, ids) => ids.map((id) => l.cards.get(id).y);

test('하위 2개면 절전이어도 모두 카드', () => {
  seq = 0;
  const nodes = [node('lead'), node('w1', 'lead', sleep), node('w2', 'lead', sleep)];
  const l = lay(nodes);
  assert.deepEqual(thinIds(l), []);
  for (const id of ['s:w1', 's:w2']) assert.ok(l.cards.get(id).h >= 100, '카드 높이');
});

test('하위 3개 이상이면 절전 하위만 얇은 줄(높이 THIN), 깨어 있는 카드는 그대로', () => {
  seq = 0;
  const nodes = [node('lead'), node('w1', 'lead', sleep), node('w2', 'lead'), node('w3', 'lead', sleep)];
  const l = lay(nodes);
  assert.deepEqual(thinIds(l).sort(), ['s:w1', 's:w3']);
  assert.equal(l.cards.get('s:w1').h, LINE.THIN);
  assert.equal(LINE.THIN, 30);
  assert.ok(l.cards.get('s:w2').h > LINE.THIN * 2);
  assert.ok(!l.cards.get('s:lead').thin, '리드(뿌리)는 줄이지 않는다');
});

test('작업 중·응답 필요·오류·완료 미확인은 하위가 많아도 카드', () => {
  seq = 0;
  const nodes = [node('lead'), node('wk', 'lead', { state: 'working' }), node('ask', 'lead', { state: 'needs_input' }), node('err', 'lead', { state: 'error' }), node('fin', 'lead', { state: 'idle', category: 'done' }), node('zz', 'lead', sleep)];
  const tiers = new Map([['s:lead', 'rest'], ['s:wk', 'work'], ['s:ask', 'turn'], ['s:err', 'alert'], ['s:fin', 'review'], ['s:zz', 'sleep']]);
  const l = lineageLayout({ nodes, edges: spawn(nodes) }, { order: [A], tiers });
  assert.deepEqual(thinIds(l), ['s:zz']);
});

test('자기 아래 보이는 하위가 있는 절전 세션과 깊이 접기 칩이 붙는 절전 세션은 카드', () => {
  seq = 0;
  const nodes = [node('lead'), node('a', 'lead', sleep), node('b', 'lead', sleep), node('c', 'lead', sleep), node('a1', 'a', sleep)];
  const l = lay(nodes);
  assert.ok(!l.cards.get('s:a').thin, '하위가 보이는 절전 세션은 카드');
  assert.deepEqual(thinIds(l).sort(), ['s:b', 's:c']);
  // 접기: FOLD 단계에 있는 절전 세션(아래가 접힘)
  seq = 0;
  const chain = ['c0', 'c1', 'c2', 'c3'];
  const ns = chain.map((n, i) => node(n, i ? chain[i - 1] : null));
  ns.push(node('f', 'c3', sleep), node('g', 'c3', sleep), node('h', 'c3', sleep), node('f1', 'f'));
  const l2 = lay(ns);
  assert.equal(l2.cards.get('s:f').depth, LINE.FOLD);
  assert.ok(l2.cards.get('s:f').fold > 0 && !l2.cards.get('s:f').thin, '접기 칩이 붙는 세션은 카드');
  assert.ok(l2.cards.get('s:g').thin && l2.cards.get('s:h').thin);
});

test('얇은 줄은 깨어 있는 카드 아래로 모이고(그 안은 만든 차례), 얇은 줄끼리 간격은 TGY, 카드와는 GY', () => {
  seq = 0;
  const nodes = [node('lead'), node('w1', 'lead', sleep), node('w2', 'lead'), node('w3', 'lead', sleep), node('w4', 'lead'), node('w5', 'lead', sleep)];
  const l = lay(nodes);
  assert.deepEqual(l.vkids.get('s:lead'), ['s:w2', 's:w4', 's:w1', 's:w3', 's:w5']);
  const ys = kidsY(l, l.vkids.get('s:lead'));
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1], '위 → 아래 차례');
  const c = (id) => l.cards.get(id);
  assert.equal(c('s:w1').y - (c('s:w4').y + c('s:w4').h), LINE.GY, '마지막 카드와 첫 얇은 줄 사이 = GY');
  assert.equal(c('s:w3').y - (c('s:w1').y + LINE.THIN), LINE.TGY, '얇은 줄끼리 = TGY');
  assert.ok(LINE.TGY < LINE.GY);
  // 선은 얇은 줄의 세로 가운데로
  const e = l.edges.find((x) => x.to === 's:w3');
  assert.equal(e.pts[e.pts.length - 1][1], c('s:w3').y + LINE.THIN / 2);
});

test('리드 + 하위 7개(절전 5개)는 바꾸기 전보다 낮다', () => {
  seq = 0;
  const nodes = [node('lead'), ...[1, 2, 3, 4, 5, 6, 7].map((i) => node(`w${i}`, 'lead', i <= 2 ? {} : sleep))];
  const l = lay(nodes);
  assert.equal(thinIds(l).length, 5);
  const span = (x) => { const ks = x.vkids.get('s:lead').map((id) => x.cards.get(id)); return Math.max(...ks.map((k) => k.y + k.h)) - Math.min(...ks.map((k) => k.y)); };
  const awake = lay(nodes.map((n) => ({ ...n, state: 'ready' })));
  assert.ok(span(l) < span(awake) / 2, `${span(l)} < ${span(awake)} / 2`);
});

test('동료 붙이기가 먼저: 형제 중 동료가 있는 절전 하위는 제자리 카드', () => {
  seq = 0;
  const nodes = [node('lead'), node('w1', 'lead', sleep), node('w2', 'lead'), node('w3', 'lead', sleep), node('w4', 'lead', sleep)];
  const g = applyRelationStub({ nodes, edges: spawn(nodes) }, [{ a: 'x-w1', b: 'x-w2', relation: 'peer' }]);
  const l = lineageLayout(g, { order: [A] });
  assert.ok(!l.cards.get('s:w1').thin, '동료 짝이 형제면 카드');
  assert.deepEqual(thinIds(l).sort(), ['s:w3', 's:w4']);
  const ks = l.vkids.get('s:lead');
  assert.equal(ks.indexOf('s:w2') - ks.indexOf('s:w1'), 1, '동료는 여전히 곁에');
});

test('휴대폰: 같은 판정(얇은 줄 표시, 깨어 있는 카드 아래로 모음)', () => {
  seq = 0;
  const nodes = [node('lead'), node('w1', 'lead', sleep), node('w2', 'lead'), node('w3', 'lead', sleep), node('w4', 'lead'), node('a', 'lead', sleep), node('a1', 'a')];
  const ph = (ns) => lineageLayout({ nodes: ns, edges: spawn(ns) }, { order: [A], phone: true });
  const l = ph(nodes), pc = lay(nodes);
  assert.deepEqual(thinIds(l), thinIds(pc), 'P166: 휴대폰 배치도 같은 얇은 줄');
  assert.deepEqual(l.vkids.get('s:lead'), ['s:w2', 's:w4', 's:a', 's:w1', 's:w3'], '깨어 있는 카드 아래로 모음');
  assert.ok(thinIds(l).every((id) => l.cards.get(id).h === LINE.THIN));
  seq = 0;
  assert.equal(thinIds(ph([node('lead'), node('w1', 'lead', sleep), node('w2', 'lead', sleep)])).length, 0, '하위 2개면 휴대폰도 모두 카드');
});

test('창 연결: PC 카드가 얇은 줄을 그리고 휴대폰은 같은 카드(Card)를 쓴다, CSS가 있다', () => {
  const pc = read('MissionLineage.jsx'), ph = read('PhoneMap.jsx');
  assert.match(pc, /b\.thin \? <span className="mt-sm-thin" data-role="ta-thin">/);
  assert.match(pc, /onDoubleClick=\{\(\) => onOpen\(id, true\)\}/, '얇은 줄도 같은 카드 판(누르기·더블클릭·미리보기)');
  assert.match(ph, /import \{ Card, Peek, cardFacts \} from '\.\/MissionLineage\.jsx'/);
  assert.match(read('styles.css'), /\.mt-sm \.mt-ta-slot\.thin \.mt-ta-card/);
});

test('Alt+끌기: 얇은 줄끼리 사이 틈은 동료 자리가 아니고(부모의 하위), 묶음 위·아래 끝은 동료 자리', () => {
  seq = 0;
  const nodes = [node('lead'), node('w1', 'lead'), node('z1', 'lead', sleep), node('z2', 'lead', sleep), node('z3', 'lead', sleep), node('other', null, { closedKids: 1 })];
  const l = lay(nodes);
  const z1 = l.cards.get('s:z1'), z2 = l.cards.get('s:z2'), z3 = l.cards.get('s:z3');
  const gap = relationDrop(l, 's:other', z1.x + 20, (z1.y + z1.h + z2.y) / 2);
  assert.ok(!gap || gap.kind !== 'peer', '틈은 동료가 아니다');
  const below = relationDrop(l, 's:other', z3.x + 20, z3.y + z3.h + 12);
  assert.equal(below && below.kind, 'peer'); assert.equal(below.target, 's:z3');
});
