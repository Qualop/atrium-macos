// P101 단위 시험: 미션 맵 다듬기. 서로 이은 두 세션은 마주 보는 가장자리 사이 짧은 두 줄(화살촉), 오른쪽으로 크게 도는 선 없음,
// 나무 선 흐름(부모 오른쪽 → 하위 왼쪽), 하위 세션의 보고 선이 있어도 나무가 뒤집히지 않음, 겹침 없음, 워크스페이스 판, 이은 이웃 형제 사이 벌림,
// 휴대폰도 같은 길, P101 덩어리는 가볍다(테두리 빛줄기는 P102 번쩍임을 거쳐 P107 테두리 빛으로 바뀜, p107-lib.test.mjs), 새 토큰(지금 값은 그대로)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wire, facing, pairOff, blocked, portY, WIRE } from '../src/renderer/lib/mission-wire.js';
import { missionLayout, MISSION } from '../src/renderer/lib/mission-layout.js';
import { missionTree, roleModel } from '../src/renderer/lib/mission-model.js';
import { phoneMission } from '../src/renderer/lib/phone-mission.js';
import { phoneGraph, VIEW } from '../src/renderer/lib/phone-graph.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
let clock = 0;
const node = (id, ws, o = {}) => ({ id: `s:${id}`, kind: 'session', sessionId: id, name: id, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: ws, parentId: null, role: null, order: null, createdAt: ++clock, loops: 0, ...o });
const E = (a, b, kind = 'role', label = null) => ({ from: a === 'human' ? 'human' : `s:${a}`, to: `s:${b}`, kind, label, count: 1 });
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const overlap = (bs) => { for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (hit(bs[i], bs[j])) return `${bs[i].id || bs[i].node.id}×${bs[j].id || bs[j].node.id}`; return null; };

// 경로(M L C Q H V, 쉼표·빈칸 모두)를 잘게 나눈 점들
function points(d) {
  const tok = d.match(/[MLCQHV]|-?\d+(?:\.\d+)?/g);
  const out = [];
  let i = 0, cmd = null, x = 0, y = 0;
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/[A-Z]/.test(tok[i])) cmd = tok[i++];
    if (cmd === 'M' || cmd === 'L') { x = num(); y = num(); out.push([x, y]); }
    else if (cmd === 'H') { const x2 = num(); for (let t = 1; t <= 8; t++) out.push([x + ((x2 - x) * t) / 8, y]); x = x2; }
    else if (cmd === 'V') { const y2 = num(); for (let t = 1; t <= 8; t++) out.push([x, y + ((y2 - y) * t) / 8]); y = y2; }
    else if (cmd === 'C') { const c = [num(), num(), num(), num(), num(), num()]; for (let s = 1; s <= 16; s++) { const t = s / 16, u = 1 - t; out.push([u * u * u * x + 3 * u * u * t * c[0] + 3 * u * t * t * c[2] + t * t * t * c[4], u * u * u * y + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5]]); } x = c[4]; y = c[5]; }
    else if (cmd === 'Q') { const c = [num(), num(), num(), num()]; for (let s = 1; s <= 8; s++) { const t = s / 8, u = 1 - t; out.push([u * u * x + 2 * u * t * c[0] + t * t * c[2], u * u * y + 2 * u * t * c[1] + t * t * c[3]]); } x = c[2]; y = c[3]; }
    else i++;
  }
  return out;
}
// 선(과 화살촉)의 모든 점이 두 상자가 마주 보는 가장자리 사이에 드는가
function insideGap(e, A, B) {
  const left = A.x <= B.x ? A : B, right = left === A ? B : A, top = A.y <= B.y ? A : B, bot = top === A ? B : A;
  const horiz = right.x >= left.x + left.w;
  const ps = [...points(e.d), ...(e.tip ? points(e.tip) : [])];
  return horiz ? ps.every(([x]) => x >= left.x + left.w - 0.5 && x <= right.x + 0.5) : ps.every(([, y]) => y >= top.y + top.h - 0.5 && y <= bot.y + 0.5);
}

// 실제 판 모양의 작은 판: 리드 lead(a) → 하위 rev(부모 lead, 보고 rev → lead), 역할 선 ui·tests·build·copy, tests ↔ build(서로), copy → rev(사이에 카드), rev → ui(이웃),
// 리드 lead2(b) → port(c, 하위, 보고 port → lead2), 혼자인 워크스페이스 e·f
function board() {
  clock = 0;
  const nodes = [{ id: 'human', kind: 'human' },
    node('lead', 'a', { state: 'waiting' }), node('lead2', 'b'), node('ui', 'a', { agentKind: 'shell' }), node('tests', 'a', { agentKind: 'shell', state: 'working' }), node('build', 'a', { agentKind: 'shell' }), node('copy', 'a', { agentKind: 'shell' }),
    node('e', 'e'), node('f', 'f', { state: 'sleeping' }),
    node('rev', 'a', { parentId: 's:lead', order: 1, state: 'working', role: 'reviewer' }), node('port', 'c', { parentId: 's:lead2', order: 1, state: 'working', role: 'porter' })];
  const edges = [E('lead', 'rev', 'spawn'), E('lead', 'rev', 'role', 'reviewer'), E('lead2', 'port', 'spawn'), E('lead', 'ui'), E('lead', 'tests'), E('lead', 'build'), E('lead', 'copy'),
    E('rev', 'lead', 'role', 'report'), E('port', 'lead2', 'prompt', 'done'), E('tests', 'build', 'role', 'verify'), E('build', 'tests', 'role', 'rerun'), E('copy', 'rev', 'role', 'proofread'), E('rev', 'ui', 'role', 'review'), E('human', 'lead', 'bar')];
  return { nodes, edges };
}

test('선 길: 마주 보는 가장자리(오른쪽·왼쪽·아래·위), 화살촉, 두 줄의 비킴, 막힘, 나가는 높이', () => {
  const a = { x: 0, y: 0, w: 100, h: 60 }, b = { x: 160, y: 100, w: 100, h: 60 }, c = { x: 0, y: 100, w: 100, h: 30 };
  assert.equal(facing(a, b), 'r'); assert.equal(facing(b, a), 'l'); assert.equal(facing(a, c), 'd'); assert.equal(facing(c, a), 'u'); assert.equal(facing(a, a), null);
  const f = wire(a, b, { off: pairOff(a, b, 'r'), tip: true }), g = wire(b, a, { off: pairOff(b, a, 'l'), tip: true });
  assert.ok(f.d.startsWith('M100,') && g.d.startsWith('M160,'), '오른쪽 가장자리 → 왼쪽 가장자리, 되돌아오는 줄은 왼쪽 가장자리에서');
  assert.equal(f.y1 - g.y2, -2 * WIRE.off, '앞으로 가는 줄이 위, 되돌아오는 줄이 아래(사이 2 × off)');
  assert.ok(insideGap(f, a, b) && insideGap(g, a, b), '두 줄 모두 두 상자 사이');
  assert.ok(f.tip && g.tip);
  const v = wire(a, c, { tip: true });
  assert.equal(v.route, 'd'); assert.ok(insideGap(v, a, c) && /^M50,60 L50,/.test(v.d), '아래 가장자리 가운데 → 위 가장자리');
  const mid = { x: 0, y: 70, w: 100, h: 20 };
  assert.equal(blocked(a, c, [a, c, mid]), true); assert.equal(blocked(a, c, [a, c]), false);
  const s = wire(a, c, { route: 'side', tip: true });
  assert.ok(Math.max(...points(s.d).map(([x]) => x)) <= 100 + WIRE.bulge * 2, '같은 열 괄호는 짧게');
  assert.ok(portY(a, b) > 30 && portY(a, b) <= 60 - 12, '아래에 있는 하위 쪽으로 살짝, 카드 안');
});

test('모델: 하위 세션이 부모에게 보고하는 선(B → A)이 있어도 나무가 뒤집히지 않는다(부모는 parentId)', () => {
  const t = missionTree(board());
  assert.equal(t.parent.get('s:rev'), 's:lead'); assert.equal(t.parent.get('s:port'), 's:lead2');
  assert.ok(!t.parent.has('s:lead') && !t.parent.has('s:lead2'), '리드는 뿌리');
  const m = roleModel(board(), { tree: t });
  assert.equal(m.get('s:lead').rank, 'lead'); assert.equal(m.get('s:rev').rank, 'worker'); assert.equal(m.get('s:rev').family, 'review');
  assert.equal(t.parent.get('s:build'), 's:lead'); assert.equal(t.parent.get('s:tests'), 's:lead', '형제끼리 서로 이어도 부모는 리드');
});

test('PC: 서로 이은 두 세션은 마주 보는 가장자리 사이 짧은 두 줄(화살촉), 오른쪽으로 크게 도는 선이 없다, 나무 선 흐름', () => {
  const lay = missionLayout(board(), { width: 1600, order: ['a', 'b', 'c', 'e', 'f'] });
  const b = (id) => lay.boxes.get(`s:${id}`);
  const ed = (x, y) => lay.edges.find((e) => e.from === `s:${x}` && e.to === `s:${y}`);
  for (const [x, y] of [['lead', 'rev'], ['lead2', 'port'], ['tests', 'build']]) {
    const f = ed(x, y), g = ed(y, x);
    assert.ok(f && g, `${x} ↔ ${y} 두 줄`);
    assert.ok(f.pair && g.pair && f.route === 'pair' && g.route === 'pair' && f.tip && g.tip && !f.quiet && !g.quiet, `${x} ↔ ${y} 짧은 두 줄과 화살촉`);
    assert.ok(insideGap(f, b(x), b(y)) && insideGap(g, b(x), b(y)), `${x} ↔ ${y} 두 카드 사이 거리 안`);
  }
  const ru = ed('rev', 'ui');
  assert.equal(ru.route, 'near'); assert.ok(ru.tip && insideGap(ru, b('rev'), b('ui')), '같은 열 이웃(한 방향): 아래·위 가장자리 사이 한 줄');
  const cr = ed('copy', 'rev');
  assert.equal(cr.route, 'side'); assert.ok(cr.tip, '사이에 카드가 있는 같은 열: 오른쪽 괄호');
  for (const e of lay.edges.filter((x) => !x.quiet && x.rel !== 'human')) {
    const A = lay.boxes.get(e.from), B = lay.boxes.get(e.to);
    assert.ok(Math.max(...points(e.d).map(([x]) => x)) <= Math.max(A.x + A.w, B.x + B.w) + 2 * WIRE.bulge + 1, `${e.id}: 오른쪽으로 크게 돌지 않는다`);
  }
  for (const e of lay.edges.filter((x) => x.tree && x.rel !== 'human')) {
    const A = lay.boxes.get(e.from), B = lay.boxes.get(e.to), ps = points(e.d);
    assert.ok(Math.abs(ps[0][0] - (A.x + A.w)) < 0.6 && ps.every(([x]) => x >= A.x + A.w - 0.5 && x <= B.x + 0.5), `${e.id}: 부모 오른쪽 → 하위 왼쪽`);
  }
});

test('PC: 겹침 없음, 워크스페이스 판(상자는 제 판 안, 판끼리 겹치지 않고 사이가 같다), 이은 이웃 형제는 linkGap만큼 벌어진다', () => {
  const lay = missionLayout(board(), { width: 1600, order: ['a', 'b', 'c', 'e', 'f'] });
  const bs = [...lay.boxes.values()];
  assert.equal(overlap(bs), null);
  const plates = lay.groups.map((g) => ({ id: g.key, ...g.plate }));
  assert.equal(overlap(plates), null, '판끼리 겹치지 않는다');
  for (const bx of bs.filter((x) => x.group)) { const p = lay.groups.find((g) => g.key === bx.group).plate; assert.ok(bx.x >= p.x && bx.y >= p.y && bx.x + bx.w <= p.x + p.w && bx.y + bx.h <= p.y + p.h, `${bx.node.id}는 판 ${bx.group} 안`); }
  const gaps = [];
  for (let i = 0; i < plates.length; i++) for (let j = 0; j < plates.length; j++) { const p = plates[i], q = plates[j]; if (i !== j && q.x >= p.x + p.w && q.y < p.y + p.h && p.y < q.y + q.h) gaps.push(Math.round(q.x - p.x - p.w)); if (i !== j && q.y >= p.y + p.h && q.x < p.x + p.w && p.x < q.x + q.w) gaps.push(Math.round(q.y - p.y - p.h)); }
  assert.ok(gaps.length && gaps.every((x) => x >= 16), `판 사이 ${gaps}`);
  assert.ok(gaps.includes(16), '가장 가까운 판 사이는 16');
  const t = lay.boxes.get('s:tests'), bl = lay.boxes.get('s:build');
  assert.ok(bl.y - (t.y + t.h) >= MISSION.linkGap, '서로 이은 이웃 형제 tests·build 사이');
  const ui = lay.boxes.get('s:ui'), rev = lay.boxes.get('s:rev');
  assert.ok(ui.y - (rev.y + rev.h) >= MISSION.linkGap, 'rev → ui 이웃 사이');
  assert.equal(lay.boxes.get('s:f').kind, 'row', '잠든 세션은 알약');
});

test('휴대폰: 같은 길 — 서로 이은 두 세션은 짧은 두 줄, 겹침 없음, 판, 화면 밖으로 도는 선 없음', () => {
  const vp = { w: 393, h: 712 };
  const pm = phoneMission(board(), { order: ['a', 'b', 'c', 'e', 'f'] });
  const pg = phoneGraph(pm, { width: vp.w - 2 * VIEW.PAD });
  const n = (id) => pg.nodes.find((x) => x.id === `s:${id}`);
  assert.equal(overlap(pg.nodes), null);
  for (const [x, y] of [['lead', 'rev'], ['lead2', 'port'], ['tests', 'build']]) {
    const es = pg.edges.filter((e) => (e.from === `s:${x}` && e.to === `s:${y}`) || (e.from === `s:${y}` && e.to === `s:${x}`));
    assert.equal(es.length, 2, `${x} ↔ ${y} 두 줄`);
    assert.ok(es.every((e) => e.pair && e.tip && insideGap(e, n(x), n(y))), `${x} ↔ ${y} 짧은 두 줄(두 카드 사이)`);
  }
  for (const e of pg.edges) assert.ok(Math.max(...points(e.d).map(([x]) => x)) <= pg.width + VIEW.PAD, `${e.id} 화면 안`);
  assert.equal(overlap(pg.groups.map((g) => ({ id: g.key, ...g.plate }))), null, '판끼리 겹치지 않는다');
  for (const nd of pg.nodes) { const p = pg.groups.find((g) => g.key === nd.group).plate; assert.ok(nd.x >= p.x && nd.x + nd.w <= p.x + p.w && nd.y >= p.y && nd.y + nd.h <= p.y + p.h, `${nd.id} 판 안`); }
  // 같은 칸 손자와 서로 이으면 겹친 두 꺾임(교차 없음)
  clock = 0;
  const g2 = { nodes: [node('l', 'a'), node('k', 'a', { parentId: 's:l', order: 1 }), node('gk', 'a', { parentId: 's:k', order: 2 })], edges: [E('l', 'k', 'spawn'), E('k', 'gk', 'spawn'), E('gk', 'k', 'prompt', 'done')] };
  const p2 = phoneGraph(phoneMission(g2), { width: 373 });
  const two = p2.edges.filter((e) => [e.from, e.to].sort().join() === 's:gk,s:k');
  assert.equal(two.length, 2); assert.ok(two.every((e) => e.pair && e.tip));
});

// P102: 일하는 카드의 테두리 빛줄기는 P102 번쩍임을 거쳐 P107 테두리 빛(P107 덩어리)으로 바꿨다. 여기서는 P101 덩어리만 본다(다음 덩어리 머리 앞까지)
const block = (css, tag) => { const a = css.indexOf(`/* ---------- ${tag}:`); const b = css.indexOf('/* ---------- P', a + 10); return css.slice(a, b < 0 ? undefined : b); };
test('CSS: P101 덩어리는 가볍다(filter·will-change·그림자 없음), 빛줄기는 P107 테두리 빛으로 바뀌었다', () => {
  const p101 = block(read('styles.css'), 'P101');
  assert.ok(!/animation\s*:|@keyframes|mt-mm-glint/.test(p101.replace(/\/\*[^]*?\*\//g, '')), 'P101 덩어리에 남은 움직임·빛줄기 없음(P107 테두리 빛으로 바뀜)');
  assert.ok(!/filter|backdrop-filter|will-change|box-shadow/.test(p101.replace(/\/\*[^]*?\*\//g, '')), 'P101 덩어리에 filter·will-change·그림자 없음');
  const pp = block(read('phone.css'), 'P101').replace(/\/\*[^]*?\*\//g, '');
  assert.ok(!/animation|@keyframes|filter|will-change|box-shadow/.test(pp), '휴대폰 P101 덩어리: 끝없는 움직임·filter·will-change·그림자 없음(P89)');
  assert.ok(!/mt-mm-glint/.test(read('Mission.jsx')), 'PC는 빛줄기를 그리지 않는다(번쩍임 층으로 바뀜)');
});

test('토큰: P101 토큰은 tokens.css 끝에 더했고 지금 값(P95)은 그대로', () => {
  const tk = read('tokens.css');
  for (const k of ['--mm-plate', '--mm-plate-line', '--mm-card-2', '--mm-card-lead-2', '--mm-edge', '--mm-edge-rest', '--mm-edge-sleep', '--mm-edge-hot', '--mm-wire-2']) assert.match(tk, new RegExp(`${k}:`), k);
  assert.ok(tk.indexOf('--mm-plate:') > tk.indexOf('--mm-card-rest:'), '끝에 더했다');
  assert.match(tk, /--mm-wire: rgba\(233, 230, 220, 0\.2\);/); assert.match(tk, /--mm-card: #141310;/); assert.match(tk, /--mm-bg: #0f0f0b;/);
  for (const f of ['styles.css', 'phone.css']) { const blk = block(read(f), 'P101'); assert.ok(!/#[0-9a-f]{3,8}\b/i.test(blk.replace(/\/\*[^]*?\*\//g, '')), `${f} P101 덩어리에 글자로 박은 색 없음`); }
});
