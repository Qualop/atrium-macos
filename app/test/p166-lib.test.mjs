// P166 단위 시험: 휴대폰 세션 맵 = PC와 같은 무한 캔버스(PhoneMap.jsx). 배치는 lineageLayout(phone: true, 세로 화면 배치)로 PC와 같은 판정을 쓰는지,
// PC 결과는 그대로인지, 손가락 판정(누르기·길게 누르기·끌기·핀치), 핀치 셈, 시점 기억·맞춤, 화면 연결, 사전.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineageLayout, PHONE, LINE } from '../src/renderer/lib/mission-lineage.js';
import { PM, VIEW_KEY, touchIntent, pinchView, phoneFit, goView, loadView, saveView, clearView, openView, sizeKey } from '../src/renderer/lib/phone-map.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const A = 'd:/work/app/.git', B = 'd:/work/docs/.git', C = 'd:/work/lab/.git', D = 'd:/work/loose/.git';
let seq = 0;
const node = (n, ws, parent = null, o = {}) => ({ id: `s:${n}`, kind: 'session', sessionId: `x-${n}`, name: n, workspaceKey: ws, state: 'ready', parentId: parent ? `s:${parent}` : null, createdAt: 100 + seq++, ...o });
const spawn = (nodes) => nodes.filter((n) => n.parentId).map((n) => ({ from: n.parentId, to: n.id, kind: 'spawn', count: 1 }));
const VG = [{ id: 'g1', name: 'Product', members: [A, B] }, { id: 'g2', name: 'Research', members: [C] }];
// 폴더 둘 + 폴더 밖, 하위 7개(절전 섞임), 동료, 다른 워크스페이스 하위, 솔로
function board() {
  seq = 0;
  const nodes = [
    node('lead', A), ...['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'].map((n, i) => node(n, A, 'lead', i % 2 ? { state: 'sleeping' } : {})),
    node('p1', A, null, { peers: ['s:p2'] }), node('p2', A, null, { peers: ['s:p1'] }),
    node('docs', B, 'lead'), node('solo-a', A), node('solo-b', A), node('lab', C), node('lab-k', C, 'lab'), node('lone', D),
  ];
  const edges = [...spawn(nodes), { from: 's:p1', to: 's:p2', kind: 'relation', relation: 'peer', relationSource: 'user', count: 0 }];
  return { nodes, edges };
}
const opt = { order: [A, B, C, D], vgroups: VG, noFolder: 'No folder' };
const strip = (l) => ({ cards: [...l.cards].map(([id, c]) => [id, c.x, c.y, c.w, c.h, c.depth, !!c.thin]), bands: l.bands.map((b) => [b.name, b.y, b.h]), rows: l.rows.map((r) => [r.key, r.x, r.y, r.w, r.h]), edges: l.edges.map((e) => e.d), bounds: l.bounds, cols: l.cols });

test('PC 결과는 phone 선택지를 넣어도 바뀌지 않는다(phone: false는 옛 배치 그대로)', () => {
  const g = board();
  const a = lineageLayout(g, opt), b = lineageLayout(g, { ...opt, phone: false, view: { w: 390, h: 700 } });
  assert.deepEqual(strip(a), strip(b));
  assert.equal(a.phone, undefined); assert.equal(a.pages, undefined);
  assert.ok(a.spine >= LINE.SPINE && a.cols[0].key === 'ws' && a.cols.at(-1).key === 'solo');
});

test('휴대폰도 같은 판정: 같은 카드, 같은 깊이, 같은 얇은 줄, 같은 선(나무·동료·다른 워크스페이스)', () => {
  const g = board();
  const pc = lineageLayout(g, opt), ph = lineageLayout(g, { ...opt, phone: true });
  assert.deepEqual([...ph.cards.keys()].sort(), [...pc.cards.keys()].sort());
  for (const [id, c] of pc.cards) { const d = ph.cards.get(id); assert.equal(d.depth, c.depth, id); assert.equal(!!d.thin, !!c.thin, id); assert.equal(d.ws, c.ws, id); }
  const kinds = (l) => l.edges.map((e) => `${e.from}>${e.to}:${e.peer ? 'peer' : e.cross ? 'cross' : e.lineage ? 'lin' : e.rel}`).sort();
  assert.deepEqual(kinds(ph), kinds(pc));
  assert.ok(ph.cards.get('s:w2').thin, '하위 7개 중 절전은 얇은 줄');
  assert.deepEqual(ph.bands.map((b) => b.name), ['Product', 'Research', 'No folder']);
});

test('세로 배치: 폴더·워크스페이스 머리는 위, 나무는 왼쪽 끝에서, 솔로는 나무 아래 격자, 좁은 카드·간격', () => {
  const g = board();
  const ph = lineageLayout(g, { ...opt, phone: true });
  assert.equal(ph.phone, true); assert.equal(ph.spine, 0);
  assert.ok(ph.cw >= PHONE.CW_MIN && ph.cw <= PHONE.CW_MAX && ph.cw < lineageLayout(g, opt).cw);
  assert.ok(ph.cols.every((c) => c.key === 'lv'), '워크스페이스·솔로 칸이 없다');
  assert.equal(ph.cols[0].x, PHONE.PADX);
  assert.equal(ph.cols[1].x - ph.cols[0].x, ph.cw + PHONE.GX);
  // 띠 머리 다음에 첫 줄, 줄 머리 다음에 카드
  const rA = ph.rows.find((r) => r.key === A), bP = ph.bands.find((b) => b.name === 'Product');
  assert.equal(rA.y, bP.y + PHONE.FH);
  const inA = [...ph.cards.values()].filter((c) => c.ws === A);
  assert.ok(inA.every((c) => c.y >= rA.y + PHONE.WH && c.y + c.h <= rA.y + rA.h), '카드는 줄 머리 아래, 줄 안');
  assert.equal(ph.cards.get('s:lead').x, PHONE.PADX);
  // 솔로: 나무 맨 아래보다 아래, 왼쪽부터 격자, 가로 가름 점선
  const tree = inA.filter((c) => c.depth >= 0), solo = inA.filter((c) => c.depth < 0);
  assert.equal(solo.length, 2);
  const treeBottom = Math.max(...tree.map((c) => c.y + c.h));
  assert.ok(solo.every((c) => c.y > treeBottom));
  assert.deepEqual(solo.map((c) => c.x).sort((a, b) => a - b), [PHONE.PADX, PHONE.PADX + ph.cw + PHONE.GX]);
  const div = ph.divs.find((d) => d.row === A);
  assert.ok(div && div.horiz && div.y > treeBottom && div.y < Math.min(...solo.map((c) => c.y)));
  // 폭은 나무 칸 수만큼(적어도 두 칸): 세계가 세로로 길다
  assert.ok(ph.bounds.h > ph.bounds.w, '세로로 긴 세계');
  assert.ok(ph.bounds.w < lineageLayout(g, opt).bounds.w / 1.5);
});

test('맞춤 보기: 같은 휴대폰 칸(390×700)에서 PC 배치보다 크게 들어간다', () => {
  const g = board();
  const k = (l) => phoneFit(l.bounds, 390, 700).k;
  assert.ok(k(lineageLayout(g, { ...opt, phone: true, view: { w: 390, h: 700 } })) > k(lineageLayout(g, opt)) * 1.4);
});

test('단 나누기: 보이는 칸이 가로로 넓으면 단을 나누고(폴더 머리를 다시 단다), 세로로 길면 한 단', () => {
  const g = board();
  const tall = lineageLayout(g, { ...opt, phone: true, view: { w: 390, h: 700 } });
  assert.equal(tall.pages, 1);
  const wide = lineageLayout(g, { ...opt, phone: true, view: { w: 850, h: 330 } });
  assert.ok(wide.pages >= 2, `가로 화면 단 ${wide.pages}`);
  assert.ok(phoneFit(wide.bounds, 850, 330).k > phoneFit(lineageLayout(g, { ...opt, phone: true }).bounds, 850, 330).k * PHONE.GAIN);
  // 단마다 x가 다르고, 줄과 그 카드는 함께 옮겨졌다, 이어지는 폴더 머리는 cont
  const xs = new Set(wide.rows.map((r) => r.x));
  assert.equal(xs.size, wide.pages);
  for (const r of wide.rows) for (const c of wide.cards.values()) if (c.ws === r.key) assert.ok(c.x >= r.x && c.x + c.w <= r.x + r.w && c.y >= r.y && c.y + c.h <= r.y + r.h, `${r.key} 카드는 줄 안`);
  for (const r of wide.rows) { const b = wide.bands.find((x) => x.x === r.x && r.y >= x.y && r.y < x.y + x.h); assert.ok(b && b.name === (VG.find((v) => v.members.includes(r.key)) || { name: 'No folder' }).name, `${r.key}의 폴더 머리`); }
  assert.ok(wide.bands.filter((b) => b.cont).every((b) => wide.bands.some((x) => x.gi === b.gi && !x.cont)));
  // 정한 단 수(그림 비교)
  assert.equal(lineageLayout(g, { ...opt, phone: true, pages: 2 }).pages, 2);
});

test('손가락 판정: 누르기·길게 누르기·끌기·핀치', () => {
  assert.equal(touchIntent({ n: 1, dx: 2, dy: 3, dt: 120, lifted: true }), 'tap');
  assert.equal(touchIntent({ n: 1, dx: 2, dy: 3, dt: 120 }), 'wait');
  assert.equal(touchIntent({ n: 1, dx: 3, dy: 2, dt: PM.LONG_MS + 10 }), 'long');
  assert.equal(touchIntent({ n: 1, dx: PM.SLOP + 1, dy: 0, dt: 50 }), 'pan');
  assert.equal(touchIntent({ n: 1, dx: 0, dy: 0, dt: 900, moved: true }), 'pan', '한 번 끌기가 되면 끝까지 끌기');
  assert.equal(touchIntent({ n: 2, dx: 0, dy: 0 }), 'pinch');
  assert.equal(touchIntent({ n: 1, dx: PM.SLOP + 1, dt: 900 }), 'pan', '멀리 움직였으면 오래 눌러도 길게 누르기가 아니다');
});

test('핀치: 두 손가락 가운데 아래 세계 점이 손가락을 따라가고 배율은 거리 비율, 범위 안', () => {
  const v0 = { k: 0.2, x: 10, y: 20 };
  const m0 = { x: 200, y: 300 };
  const w = { x: (m0.x - v0.x) / v0.k, y: (m0.y - v0.y) / v0.k }; // 가운데 아래 세계 점
  const v = pinchView(v0, m0, 100, { x: 220, y: 280 }, 250);
  assert.ok(Math.abs(v.k - 0.5) < 1e-9);
  assert.ok(Math.abs(w.x * v.k + v.x - 220) < 1e-6 && Math.abs(w.y * v.k + v.y - 280) < 1e-6);
  assert.ok(pinchView(v0, m0, 10, m0, 100000).k <= 2.4, '최대 배율');
  assert.ok(pinchView(v0, m0, 1000, m0, 1).k >= 0.08, '최소 배율');
});

test('맞춤과 카드로 가기', () => {
  const f = phoneFit({ x: 0, y: 0, w: 1000, h: 4000 }, 390, 700);
  assert.ok(Math.abs(f.k - (700 - PM.DOCK - PM.PAD * 2) / 4000) < 1e-9, '세로로 긴 세계는 높이(아래 줌 단추 자리 빼고)에 맞춘다');
  assert.ok(f.y + 4000 * f.k <= 700 - PM.DOCK + 1e-6, '줌 단추에 가리지 않는다');
  assert.ok(phoneFit({ x: 0, y: 0, w: 100, h: 100 }, 390, 700).k <= PM.FIT_MAX, '작은 세계는 키우지 않는다');
  const b = { x: 500, y: 900, w: 280, h: 140 };
  const v = goView(b, { k: 0.2, x: 0, y: 0 }, 390, 700);
  assert.ok(v.k > 0.2 && v.k <= PM.GO_K + 1e-9);
  assert.ok(Math.abs((b.x + b.w / 2) * v.k + v.x - 195) < 1e-6 && Math.abs((b.y + b.h / 2) * v.k + v.y - 350) < 1e-6, '카드가 가운데');
  assert.equal(goView(b, { k: 2, x: 0, y: 0 }, 390, 700).k, 2, '더 가까이 보고 있으면 배율 그대로');
});

test('시점 기억: 화면 크기마다 저장소에, 다시 열면 그대로, 없거나 깨지면 맞춤', () => {
  const mem = new Map();
  const st = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const size = { w: 390, h: 700 }, bounds = { x: 0, y: 0, w: 1000, h: 4000 };
  assert.deepEqual(openView(st, size, bounds), phoneFit(bounds, 390, 700), '처음은 맞춤');
  assert.ok(saveView(st, size, { k: 0.75, x: -120.4, y: -900.6 }));
  assert.deepEqual(loadView(st, size), { k: 0.75, x: -120, y: -901 });
  assert.deepEqual(openView(st, { w: 392, h: 703 }, bounds), { k: 0.75, x: -120, y: -901 }, '20px 안의 크기 차이는 같은 화면');
  assert.deepEqual(openView(st, { w: 700, h: 390 }, bounds), phoneFit(bounds, 700, 390), '가로로 돌리면 따로');
  assert.notEqual(sizeKey({ w: 390, h: 700 }), sizeKey({ w: 700, h: 390 }));
  clearView(st, size); assert.equal(loadView(st, size), null);
  mem.set(VIEW_KEY, '{broken'); assert.equal(loadView(st, size), null, '깨진 값은 맞춤으로');
  assert.ok(saveView(st, size, { k: 1, x: 0, y: 0 }), '깨진 값 위에도 다시 쓴다');
  assert.equal(saveView(st, size, { k: NaN, x: 0, y: 0 }), false);
  assert.equal(loadView(null, size), null);
  const boom = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(loadView(boom, size), null); assert.equal(saveView(boom, size, { k: 1, x: 0, y: 0 }), false);
  for (let i = 0; i < 10; i++) saveView(st, { w: 300 + i * 40, h: 600 }, { k: 1, x: i, y: 0 });
  assert.ok(Object.keys(JSON.parse(mem.get(VIEW_KEY))).length <= 6, '화면 크기는 몇 개만');
});

test('화면 연결: 기본은 PhoneMap(classic은 숨은 설정), PC 카드·미리 보기를 그대로, 터치 조작, Alt 끌기·명령줄 없음, 옛 목록은 지웠다', () => {
  const pm = read('PhoneMission.jsx'), map = read('PhoneMap.jsx'), ml = read('MissionLineage.jsx');
  assert.match(pm, /style === 'classic' \? <ClassicPhoneMission \{\.\.\.props\} \/> : <PhoneMap \{\.\.\.props\} \/>/);
  for (const f of ['PhoneLineage.jsx', 'lib/phone-lineage.js', 'PhoneTerr.jsx']) assert.ok(!fs.existsSync(path.join(R, f)), `${f}는 지웠다`);
  assert.match(ml, /export const Card = memo\(function Card\(/); assert.match(ml, /export function Peek\(/);
  assert.match(map, /phone: true, view: vsize/);
  assert.match(map, /<Peek pv=/);
  assert.match(map, /touchIntent\(/); assert.match(map, /pinchView\(/);
  assert.match(map, /onOpen\(b\.node\.sessionId\)/, '카드 누르기 = 세션 화면');
  assert.match(map, /saveView\(store\(\)/); assert.match(map, /openView\(store\(\)/);
  assert.ok(!/relationDrop|group\.move|CommandBar|commandDraft|altKey/.test(map), 'Alt 끌기·명령줄 없음');
  const css = read('phone.css'), blk = css.slice(css.indexOf('/* ---------- P160 → P166'));
  assert.match(blk, /\.mt-pmap \.mt-ta-vp \{[^}]*touch-action: none/);
  assert.match(blk, /\.mt-pmap-dock \.zb \{ width: 44px; height: 44px;/, '줌 단추는 손가락 크기');
  assert.match(blk, /\.mt-pmap \.mt-mm-lspin::before \{ animation-timing-function: steps\(36, end\); \}/, '휴대폰 빛은 steps(36)');
  assert.ok(!/will-change|backdrop-filter|filter:/.test(blk), '가볍게(P89)');
  assert.ok(!/mt-pl-card|mt-pl-scroll|mt-pl-rail/.test(css), '옛 목록 CSS는 지웠다');
});

test('사전: 휴대폰 세션 맵 글이 두 벌 다 있다', () => {
  for (const d of [en, ko]) for (const k of ['cont', 'none', 'open']) assert.ok(d.phoneMap && typeof d.phoneMap[k] === 'string' && d.phoneMap[k].length, k);
  for (const d of [en, ko]) for (const k of ['zoomIn', 'zoomOut', 'fit', 'fitTitle']) assert.ok(d.mmTerr[k], k);
  assert.ok(!('from' in ko.phoneMap) && !('away' in en.phoneMap), '쓰지 않는 글은 지웠다');
});
