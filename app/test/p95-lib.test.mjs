// P95 단위 시험: 다시 그린 미션 맵. 공용 모델의 새 함수(nodeTier·filterMatch·modelText·ageText·missionSummary),
// PC 배치(팀은 왼쪽 흐름, 혼자인 워크스페이스는 오른쪽 기둥 = 세로 한 줄이 아님, 좁으면 아래, 팀 먼저, 먼 나무 밖 선은 가리킬 때만, 나의 선은 팀 맨 위로만, 놓은 차례),
// 휴대폰(실제 판 모양이 세로 한 줄이 아님), 두 사전
import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeTier, filterMatch, modelText, ageText, missionSummary, restTier } from '../src/renderer/lib/mission-model.js';
import { missionLayout, mapOrder, MISSION } from '../src/renderer/lib/mission-layout.js';
import { phoneMission } from '../src/renderer/lib/phone-mission.js';
import { phoneGraph, VIEW } from '../src/renderer/lib/phone-graph.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const T = (d) => (k, p = {}) => { const v = k.split('.').reduce((o, x) => o && o[x], d); return String(v).replace(/\{(\w+)\}/g, (_, n) => p[n]); };
let clock = 0;
const node = (id, ws, o = {}) => ({ id: `s:${id}`, kind: 'session', sessionId: id, name: id, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: ws, parentId: null, role: null, order: null, createdAt: ++clock, loops: 0, ...o });
const kid = (id, ws, parent, o = {}) => node(id, ws, { parentId: `s:${parent}`, order: ++clock, ...o });
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const overlap = (bs) => { for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (hit(bs[i], bs[j])) return `${bs[i].node ? bs[i].node.id : bs[i].id}×${bs[j].node ? bs[j].node.id : bs[j].id}`; return null; };

// 실제 판 모양: 리드 하나(하위 셋)와 혼자인 워크스페이스 열 개
function realBoard() {
  clock = 0;
  const nodes = [{ id: 'human', kind: 'human' }, node('conductor', 'm', { state: 'working' }), kid('p95', 'm', 'conductor', { state: 'working', role: 'mission map' }), kid('p94', 'm', 'conductor', { state: 'exited' }), kid('rev', 'm', 'conductor', { role: 'reviewer' })];
  for (let i = 1; i <= 10; i++) { nodes.push(node(`s${i}`, `w${i}`, { state: i === 3 ? 'waiting' : i === 5 ? 'working' : 'ready' })); if (i % 4 === 0) nodes.push(node(`t${i}`, `w${i}`)); }
  return { nodes, edges: [{ from: 'human', to: 's:conductor', kind: 'bar', count: 2 }] };
}

test('공용 모델: 상태 없는 노드는 분류로 등급, 쉬는 등급, 거르기, 모델 글, 지난 시간 글', () => {
  assert.equal(nodeTier({ category: 'working' }), 'work'); assert.equal(nodeTier({ category: 'needs_you' }), 'turn');
  assert.equal(nodeTier({ category: 'done' }), 'review'); assert.equal(nodeTier({ category: 'exited' }), 'done'); assert.equal(nodeTier({}), 'rest');
  assert.equal(nodeTier({ state: 'error' }), 'alert'); assert.equal(nodeTier({ state: 'sleeping' }), 'sleep');
  assert.ok(restTier('rest') && restTier('sleep') && restTier('done') && !restTier('review') && !restTier('work'));
  assert.ok(filterMatch('alert', 'needs_you') && !filterMatch('work', 'needs_you') && filterMatch('sleep', 'exited') && filterMatch('review', 'done') && filterMatch('x', 'all'));
  assert.equal(modelText('claude-opus-5-5', 'high'), 'opus 5.5·high');
  assert.equal(modelText('claude-haiku-4-5', null), 'haiku 4.5');
  assert.equal(modelText('haiku', 'xhigh'), 'haiku·xhigh');
  assert.equal(modelText('claude-sonnet-5-5[1m]'), 'sonnet 5.5');
  assert.equal(modelText(null, null), null);
  const t = T(ko);
  assert.equal(ageText(20e3, t), '방금'); assert.equal(ageText(4 * 60e3, t), '4분'); assert.equal(ageText(2 * 3600e3, t), '2시간'); assert.equal(ageText(3 * 86400e3, t), '3일');
  assert.equal(ageText(NaN, t), null); assert.equal(ageText(-5, t), null);
  assert.equal(ageText(2 * 3600e3, T(en)), '2h');
});

test('요약 열: 응답 필요(오류 포함)·작업 중·결과·쉼으로 나누고, 차례는 지도 차례, 거르기 칸의 수', () => {
  const tiers = { a: 'work', b: 'turn', c: 'alert', d: 'review', e: 'rest', f: 'sleep', g: 'done' };
  const s = missionSummary(['b', 'a', 'c', 'd', 'e', 'f', 'g'], (id) => tiers[id]);
  assert.deepEqual([s.turn, s.work, s.review, s.rest], [['b', 'c'], ['a'], ['d'], ['e', 'f', 'g']]);
  assert.deepEqual(s.counts, { all: 7, turn: 2, work: 1, review: 1, rest: 3, idle: 1, gone: 2 });
});

test('PC: 실제 판 모양은 세로 한 줄이 아니다 — 혼자인 워크스페이스는 팀 오른쪽 여러 기둥, 한 화면 높이 안', () => {
  const lay = missionLayout(realBoard(), { width: 1300 });
  const bs = [...lay.boxes.values()];
  assert.equal(overlap(bs), null);
  const packed = lay.groups.filter((g) => g.packed);
  assert.equal(packed.length, 10);
  const cols = new Set(packed.map((g) => g.x));
  assert.ok(cols.size >= 2, `기둥 ${cols.size}`);
  const flowRight = Math.max(...bs.filter((b) => !b.loose).map((b) => b.x + b.w));
  assert.ok(packed.every((g) => g.x > flowRight), '팀 흐름 오른쪽');
  assert.ok(lay.height < 860, `높이 ${lay.height}`);
  for (const g of lay.groups) for (const b of bs) assert.ok(!hit({ x: g.x, y: g.y, w: g.w, h: MISSION.wsHead - 4 }, b), `머리 글 ${g.key} × ${b.node.id}`);
  // 좁은 칸(700px): 오른쪽에 자리가 없으면 팀 아래에 기둥으로
  const narrow = missionLayout(realBoard(), { width: 700 });
  assert.equal(overlap([...narrow.boxes.values()]), null);
  const top = Math.max(...[...narrow.boxes.values()].filter((b) => !b.loose && b.node.kind === 'session').map((b) => b.y + b.h));
  assert.ok(narrow.groups.filter((g) => g.packed).every((g) => g.y >= top), '팀 아래');
  assert.ok(narrow.width <= 700 + MISSION.pad);
});

test('PC: 팀 먼저(같은 워크스페이스의 연결 없는 세션은 아래), 나의 선은 팀 맨 위로만, 먼 나무 밖 선은 가리킬 때만, 놓은 차례는 부모 먼저', () => {
  clock = 0;
  const g = { nodes: [{ id: 'human', kind: 'human' }, node('loose', 'w'), node('lead', 'w', { state: 'working' }), kid('a', 'w', 'lead'), kid('b', 'w', 'lead'), node('lead2', 'w'), ...Array.from({ length: 8 }, (_, i) => kid(`c${i}`, 'w', 'lead2', { state: 'working' }))],
    edges: [{ from: 'human', to: 's:lead', kind: 'bar' }, { from: 'human', to: 's:a', kind: 'bar' }, { from: 's:a', to: 's:c7', kind: 'prompt' }, { from: 's:lead', to: 's:b', kind: 'role', label: 'x' }] };
  const lay = missionLayout(g);
  const b = (id) => lay.boxes.get(`s:${id}`);
  assert.ok(b('loose').y > b('c7').y, '연결 없는 세션은 팀들 아래');
  assert.equal(lay.edges.find((e) => e.from === 'human' && e.to === 's:lead').quiet, false);
  assert.equal(lay.edges.find((e) => e.from === 'human' && e.to === 's:a').quiet, true, '리드가 아닌 세션으로 가는 나의 선');
  const far = lay.edges.find((e) => e.from === 's:a' && e.to === 's:c7');
  assert.ok(!far.tree && far.quiet, '멀리 가는 나무 밖 선');
  assert.deepEqual(mapOrder(lay).slice(0, 4), ['s:lead', 's:a', 's:b', 's:lead2']);
  assert.equal(mapOrder(lay).at(-1), 's:loose');
  assert.deepEqual([...lay.teamNo.values()], [1, 2]);
});

test('휴대폰: 실제 판 모양은 두 기둥(세로 한 줄이 아님), 팀은 화면 폭, 배율 1로 읽힌다', () => {
  const vp = { w: 393, h: 712 };
  const pm = phoneMission(realBoard(), { order: ['m', ...Array.from({ length: 10 }, (_, i) => `w${i + 1}`)] });
  const pg = phoneGraph(pm, { width: vp.w - 2 * VIEW.PAD });
  assert.equal(overlap(pg.nodes), null);
  assert.equal(pg.nodes.length, 16);
  const xs = new Map(); for (const n of pg.nodes) xs.set(n.x, (xs.get(n.x) || 0) + 1);
  assert.ok(Math.max(...xs.values()) <= 10, `가장 긴 기둥 ${Math.max(...xs.values())}`);
  assert.ok(pg.height <= vp.h, `높이 ${pg.height}`);
  assert.equal(pg.groups[0].wide, true); assert.ok(pg.groups.slice(1).every((g) => !g.wide));
  assert.equal(new Set(pg.groups.slice(1).map((g) => g.x)).size, 2);
});

test('사전: mmMap 열쇠가 두 언어에 모두 있다', () => {
  assert.deepEqual(Object.keys(ko.mmMap).sort(), Object.keys(en.mmMap).sort());
  for (const k of ['ageNow', 'ageM', 'ageH', 'ageD', 'warnTurn', 'warnAlert', 'warnReview', 'warnClimb', 'dotsRest', 'you', 'sumTurn', 'sumWork', 'sumReview', 'sumRest', 'sumNow', 'sumFoot', 'hint', 'crossWs']) assert.ok(en.mmMap[k] && ko.mmMap[k], k);
});
