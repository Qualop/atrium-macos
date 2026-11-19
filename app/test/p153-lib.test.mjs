// P153 단위 시험: 세션 맵 다듬기. 무리 묶기(역할·주고받은 연결, 닫힌 부모, 다른 워크스페이스의 부모, 큰 무리), 폴더 소속이 사이드바와 같음(키 정규화),
// 직각 선이 카드를 지나지 않음, 화면 비율에 맞춘 세계, 누르기 = 명령줄 태그(살펴보기 띠 없음), 더블클릭 = 판으로, 휴대폰 한 번 누르기, 이름(세션 맵).
// 모양은 실제 판과 같은 짜임의 지어낸 이름(폴더 3, 워크스페이스 11, 세션 32).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { territoryLayout, TERR, normKey, keyName, bestShelf, shelf, routeOrtho, longestMid, phoneTerr, tileTap, skyline, bestPack } from '../src/renderer/lib/mission-terr.js';
import { groupLayout } from '../src/renderer/lib/sidebar-tree.js';
import { leadTags, toggleTag } from '../src/renderer/lib/cmd-input.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');

// ---- 실제 판과 같은 짜임(지어낸 이름) ----
const FOLDERS = [
  { id: 'g1', name: 'Market', members: ['d:/work/market/web', 'd:/work/market/quant/.git'] },
  { id: 'g2', name: 'Hub', members: ['d:/hub/core/.git'] },
  { id: 'g3', name: 'Campus', members: ['c:/work/library/.git', 'd:/work/campus', 'c:/work/lab/robot/.git', 'd:/work/campus/pbl/.git'] },
];
const WS = ['c:/work/atrium/.git', 'd:/work/campus', 'd:/work/market/web', 'd:/hub/core/.git', 'd:/work/garden/.git', 'c:/work/library/.git', 'c:/work/notes/.git', 'c:/work/lab/robot/.git', 'd:/work/campus/pbl/.git', 'd:/work/campus/exam/.git', 'd:/work/market/quant/.git'];
// [이름, 워크스페이스, 부모(판에 있는 것만), 상태]
const S = [
  ['conductor', 0, null, 'working'], ['c1', 1], ['m1', 2], ['hub-head', 3], ['g1', 4], ['lib-1', 5], ['notes-2', 6], ['atrium-old', 0], ['robot-1', 7], ['robot-codex', 7], ['scribe', 5], ['exam-init', 9, null, 'error'], ['reviewer', 6],
  ['deck-lead', 8], ['deck-writer', 8], ['deck-reader', 8, null, 'waiting'], ['deck-reader-2', 8], ['exam-lead', 9],
  ...['ex-notes', 'ex-set-03', 'ex-set-04', 'ex-set-05', 'ex-qa-a', 'ex-qa-b', 'ex-qa-c'].map((n) => [n, 9, 'exam-lead']),
  ['media', 4, 'g1'], ['trial', 4, 'g1'], ['researcher', 10, 'm1'], ...['coin-feed', 'level-sets', 'signal-scan', 'band-model'].map((n) => [n, 10, 'researcher', 'working']),
];
const L = (src, dst, o = {}) => ({ src, dst, role: null, spawned: false, observed: true, ...o });
const LINKS = [
  L('robot-1', 'robot-codex', { role: 'worker-1-codex' }), L('robot-codex', 'robot-1'), L('lib-1', 'scribe', { role: 'writer' }),
  L('deck-writer', 'deck-reader', { role: 'reader1' }), L('deck-writer', 'deck-reader-2', { role: 'reader' }), L('deck-lead', 'deck-writer', { role: 'writer' }), L('deck-lead', 'deck-reader'), L('deck-lead', 'deck-reader-2'),
  ...['ex-notes', 'ex-set-03', 'ex-set-04', 'ex-set-05', 'ex-qa-a', 'ex-qa-b', 'ex-qa-c'].flatMap((n) => [L('exam-lead', n, { role: 'worker', spawned: true }), L(n, 'exam-lead')]),
  L('g1', 'media', { role: 'worker', spawned: true }), L('g1', 'trial', { role: 'worker', spawned: true, observed: false }), L('trial', 'g1'), L('media', 'g1'),
  L('m1', 'researcher', { role: 'researcher', spawned: true }), L('researcher', 'm1'),
  ...['coin-feed', 'level-sets', 'signal-scan', 'band-model'].flatMap((n) => [L('researcher', n, { role: 'worker', spawned: true }), L(n, 'researcher')]),
];
function graph() {
  const nodes = S.map(([name, w, parent, state], i) => ({ id: `s:${name}`, kind: 'session', sessionId: `x-${name}`, name, workspaceKey: WS[w], state: state || 'sleeping', parentId: parent ? `s:${parent}` : null, createdAt: i + 1 }));
  const edges = [];
  for (const l of LINKS) {
    const b = { from: `s:${l.src}`, to: `s:${l.dst}`, count: 3 };
    if (l.role) edges.push({ ...b, kind: 'role', label: l.role });
    if (l.observed) edges.push({ ...b, kind: 'prompt', label: 'report' });
    if (l.spawned) edges.push({ ...b, kind: 'spawn' });
  }
  return { nodes, edges };
}
const lay0 = (o = {}) => territoryLayout(graph(), { order: WS, vgroups: FOLDERS, ...o });
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, b) => a.x >= b.x - 0.01 && a.y >= b.y - 0.01 && a.x + a.w <= b.x + b.w + 0.01 && a.y + a.h <= b.y + b.h + 0.01;
const ringOf = (lay, id) => lay.rings.find((r) => r.lead === lay.tree.byId.get(id) && false) || lay.rings.find((r) => { const c = lay.cards.get(id); return c && inside(c, r); });

test('P153: 역할 연결·주고받은 연결로만 이어진 세션도 한 무리(나무)로 붙는다', () => {
  const lay = lay0();
  // deck-lead → deck-writer → deck-reader·deck-reader-2(띄움 없이 역할·시킴만)
  const ring = lay.rings.find((r) => r.lead === 's:deck-lead');
  assert.ok(ring, '무리 deck-lead');
  assert.equal(ring.n, 4);
  for (const n of ['deck-writer', 'deck-reader', 'deck-reader-2']) assert.ok(inside(lay.cards.get(`s:${n}`), ring), `${n}가 무리 안`);
  assert.equal(lay.tree.parent.get('s:deck-reader'), 's:deck-writer', '리더는 작성자 아래(역할 연결이 시킴보다 먼저)');
  assert.ok(lay.cards.get('s:deck-writer').y > lay.cards.get('s:deck-lead').y + TERR.CH, '하위는 리드 아래');
  // 주고받은 짝(역할 + 거꾸로 보고)도 한 무리
  for (const [lead, kid] of [['robot-1', 'robot-codex'], ['lib-1', 'scribe']]) {
    const r = lay.rings.find((x) => x.lead === `s:${lead}`);
    assert.ok(r && r.n === 2 && inside(lay.cards.get(`s:${kid}`), r), `${lead} 무리`);
  }
  // 띄움·역할 선은 모양(종류)으로 갈린다
  assert.equal(lay.edges.find((e) => e.to === 's:deck-writer').rel, 'role');
  assert.equal(lay.edges.find((e) => e.to === 's:media').rel, 'spawn');
});

test('P153: 부모가 닫힌 세션은 뿌리, 부모가 다른 워크스페이스면 자기 섬에서 리드 + 다른 워크스페이스 선', () => {
  const lay = lay0();
  // hub-head: 부모가 판에 없다 → 혼자(무리 없음), 자기 섬 안
  assert.ok(!lay.rings.some((r) => inside(lay.cards.get('s:hub-head'), r)));
  assert.equal(lay.cards.get('s:hub-head').ws, WS[3]);
  // researcher: 부모 m1은 다른 워크스페이스. 자기 섬(quant)에서 워커 넷의 리드
  const r = lay.rings.find((x) => x.lead === 's:researcher');
  assert.ok(r && r.n === 5 && r.ws === WS[10]);
  const e = lay.edges.find((x) => x.from === 's:m1' && x.to === 's:researcher');
  assert.ok(e && e.cross && e.label, '다른 워크스페이스 선과 이름표');
});

test('P153: 큰 무리(리드 + 워커 7)는 네 개씩 접고 겹치지 않는다', () => {
  const lay = lay0();
  const ring = lay.rings.find((x) => x.lead === 's:exam-lead');
  assert.equal(ring.n, 8);
  const kids = ['ex-notes', 'ex-set-03', 'ex-set-04', 'ex-set-05', 'ex-qa-a', 'ex-qa-b', 'ex-qa-c'].map((n) => lay.cards.get(`s:${n}`));
  assert.equal(new Set(kids.map((c) => c.y)).size, 2, '두 줄');
  assert.ok(ring.w < lay.cw * 4 + TERR.GH * 3 + TERR.RP * 2 + 1, '한 줄 넷까지');
  const cards = [...lay.cards.values()];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) assert.ok(!overlap(cards[i], cards[j]), `카드 ${cards[i].node.name}×${cards[j].node.name}`);
  for (const r of lay.rings) assert.ok(inside(r, lay.isles.find((i) => i.key === r.ws)), `무리 ${r.lead}가 섬 안`);
});

test('P153: 폴더 소속과 차례가 사이드바와 같다(키 정규화, 폴더 목록에 없는 하위 경로는 폴더 밖)', () => {
  const lay = lay0();
  const side = groupLayout(WS.map((key) => ({ key })), FOLDERS);
  for (const g of side.groups) {
    const want = g.workspaces.map((w) => w.key);
    const got = lay.isles.filter((i) => i.folder === g.id).map((i) => i.key);
    assert.deepEqual(got, want, `폴더 ${g.name}`);
    for (const k of got) assert.ok(inside(lay.isles.find((i) => i.key === k), lay.terrs.find((t) => t.id === g.id)), `${k}가 영토 안`);
  }
  assert.deepEqual(lay.isles.filter((i) => i.loose).map((i) => i.key), side.ungrouped.map((w) => w.key), '폴더 밖은 사이드바의 그룹 없음과 같은 차례');
  assert.ok(lay.isles.find((i) => i.key === 'd:/work/campus/exam/.git').loose, '경로가 폴더 안이어도 목록에 없으면 폴더 밖');
  assert.deepEqual(lay.terrs.map((t) => t.name), ['Market', 'Hub', 'Campus'], '영토 차례 = 사이드바 폴더 차례');
  // 폴더 목록의 키를 다른 꼴(대문자·역슬래시·끝 슬래시)로 써도 같은 워크스페이스
  const odd = FOLDERS.map((g) => ({ ...g, members: g.members.map((k) => k.toUpperCase().replace(/\//g, '\\') + '\\') }));
  const lay2 = territoryLayout(graph(), { order: WS, vgroups: odd });
  assert.deepEqual(lay2.isles.map((i) => [i.key, i.folder]), lay.isles.map((i) => [i.key, i.folder]));
  assert.equal(normKey('C:\\Work\\A\\.git\\'), 'c:/work/a/.git');
  assert.equal(keyName('d:/work/campus/pbl/.git'), 'pbl');
  assert.equal(keyName('d:/work/campus'), 'campus', '폴더 워크스페이스(.git 없음)도 마지막 폴더 이름');
});

// 축에 나란한 토막이 상자 안을 지나는가(가장자리에 닿는 것은 괜찮다)
const segHits = (a, b, r) => {
  const x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]), y1 = Math.min(a[1], b[1]), y2 = Math.max(a[1], b[1]);
  return x1 < r.x + r.w - 1 && x2 > r.x + 1 && y1 < r.y + r.h - 1 && y2 > r.y + 1;
};
test('P153: 선은 모두 직각이고 카드를 지나지 않는다', () => {
  for (const aspect of [1.4, 1.8, 2.6]) {
    const lay = lay0({ aspect });
    assert.equal(lay.edges.length, 19); // 나무 선 18 + 다른 워크스페이스 선 1(나무 밖 연결은 그리지 않는다)
    for (const e of lay.edges) {
      for (let i = 1; i < e.pts.length; i++) {
        const [a, b] = [e.pts[i - 1], e.pts[i]];
        assert.ok(a[0] === b[0] || a[1] === b[1], `${e.id} 토막 ${i}가 직각이 아니다`);
        for (const c of lay.cards.values()) assert.ok(!segHits(a, b, c), `${e.id}가 카드 ${c.node.name}를 지난다`);
      }
      // 끝점은 카드 네 변 중 하나의 가운데(나무 선은 위·아래 가운데, 다른 워크스페이스 선은 옆 가운데도)
      const mids = (c) => [[c.x + c.w / 2, c.y], [c.x + c.w / 2, c.y + c.h], [c.x, c.y + c.h / 2], [c.x + c.w, c.y + c.h / 2]];
      const onMid = (pt, c) => mids(c).some(([x, y]) => Math.abs(pt[0] - x) < 0.01 && Math.abs(pt[1] - y) < 0.01);
      assert.ok(onMid(e.pts[0], lay.cards.get(e.from)), '부모 카드 한 변의 가운데에서 나간다');
      assert.ok(onMid(e.pts[e.pts.length - 1], lay.cards.get(e.to)), '하위 카드 한 변의 가운데로 들어간다');
    }
  }
});

test('P153: 길 찾기는 막힌 상자를 돌아가고 먼저 그은 선 옆으로 비켜 간다', () => {
  const a = { x: 0, y: 300, w: 100, h: 60 }, b = { x: 600, y: 300, w: 100, h: 60 }, wall = { x: 200, y: 0, w: 200, h: 700 };
  const [p] = routeOrtho([{ a, b }], [a, b, wall], [], { G: 16 });
  assert.ok(p && p.length >= 4);
  for (let i = 1; i < p.length; i++) { assert.ok(p[i - 1][0] === p[i][0] || p[i - 1][1] === p[i][1]); assert.ok(!segHits(p[i - 1], p[i], wall)); }
  // 같은 두 카드 사이를 두 번: 두 번째는 첫째와 다른 칸으로(겹치지 않게 나란히)
  const two = routeOrtho([{ a, b }, { a, b }], [a, b, wall], [], { G: 16 });
  const ys = (q) => q.filter((pt, i) => i && q[i - 1][1] === pt[1]).map((pt) => pt[1]);
  assert.notDeepEqual(ys(two[0]), ys(two[1]));
  assert.deepEqual(longestMid([[0, 0], [0, 50], [300, 50], [300, 80]]), { x: 150, y: 50 });
});

test('P153: 세계는 보기 칸 비율에 맞춰 짠다(가장 크게 보이는 선반)', () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ w: 400 + (i % 3) * 100, h: 300 }));
  for (const aspect of [1, 2, 3]) {
    const best = bestShelf(items, 40, aspect);
    const score = (s) => Math.max(s.w / aspect, s.h);
    for (const t of [500, 1200, 2000, 5000]) assert.ok(score(best) <= score(shelf(items, t, 40)) + 0.5, `비율 ${aspect} 목표 ${t}`);
  }
  const wide = lay0({ aspect: 2.4 }).bounds, tall = lay0({ aspect: 1.2 }).bounds;
  assert.ok(wide.w / wide.h > tall.w / tall.h);
});

test('P153: 카드 누르기 = 명령줄 태그 넣기·빼기(여럿), 앞머리 태그만 받는 세션', () => {
  assert.equal(toggleTag('', 'a'), '@a ');
  assert.equal(toggleTag('@a ', 'b'), '@a @b ');
  assert.equal(toggleTag('@a @b hello', 'a'), '@b hello');
  assert.equal(toggleTag('@a hello', 'A'), 'hello', '대소문자 상관없이 같은 이름은 뺀다');
  assert.equal(toggleTag('hello @x', 'a'), '@a hello @x', '글 중간 태그는 앞머리가 아니다');
  assert.deepEqual(leadTags('@a @b hi @c'), ['a', 'b']);
  assert.deepEqual(leadTags('hi'), []);
});

test('P153: 세션 맵은 살펴보기 띠·단계·미니맵·범례가 없고, 누르기 = 태그, 더블클릭·Enter = 판으로, 섬 머리 끌기 = group.move', () => {
  const src = read('MissionLineage.jsx');
  for (const gone of ['ta-inspect', 'ta-minimap', 'ta-legend', 'ta-level-', 'ta-open', 'ta-message']) assert.ok(!src.includes(gone), `${gone}가 남았다`);
  assert.match(src, /onClick=\{\(e\) => onTag\(id, e\)\}/);
  assert.match(src, /onDoubleClick=\{\(\) => onOpen\(id, true\)\}/);
  assert.match(src, /'group\.move'/);
  assert.match(src, /mt-mm-donetag/, '작업 완료 표식(옛 지도와 같은 것)');
  assert.match(read('CommandBar.jsx'), /addEventListener\('tag'/);
});

test('P153: 휴대폰 타일은 크기와 상관없이 한 번 누르면 연다', () => {
  for (const z of [0.2, 0.6, 1, 3]) assert.equal(tileTap(z), 'open');
  const pt = phoneTerr(territoryLayout(graph(), { order: WS, vgroups: FOLDERS, routing: false }));
  assert.equal(pt.tiles.length, S.length);
});

test('P153: 이름은 세션 맵(Session map), 사전 두 벌의 새 글', () => {
  assert.equal(en.mission.title, 'Session map');
  assert.equal(ko.mission.title, '세션 맵');
  const strings = (o) => Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? strings(v) : []));
  assert.ok(!strings(ko).some((s) => s.includes('관계도')), '한국어에 관계도가 남았다');
  assert.ok(!strings(en).some((s) => /mission map/i.test(s)), '영어에 mission map이 남았다');
  for (const k of ['cardTip', 'cardTipShell', 'isleTip', 'movedTo', 'movedOut', 'moveFail', 'solo', 'barHint']) { assert.ok(en.mmTerr[k], `en ${k}`); assert.ok(ko.mmTerr[k], `ko ${k}`); }
});

// ---- 라운드 2 ----
test('P153 r2: 하늘선 쌓기는 겹치지 않고 키 작은 것 아래 빈 곳을 채운다, 선반보다 나쁘지 않다', () => {
  const items = [{ w: 300, h: 100 }, { w: 600, h: 400 }, { w: 300, h: 100 }, { w: 300, h: 100 }, { w: 900, h: 200 }];
  const s = skyline(items, 900, 20);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) assert.ok(!overlap({ ...s.pos[i], ...items[i] }, { ...s.pos[j], ...items[j] }), `${i}·${j}`);
  assert.ok(s.pos[2].y > 0 && s.pos[2].x === 0, '셋째는 첫째 아래 빈 곳으로');
  for (const aspect of [1, 1.8, 3]) {
    const score = (r) => Math.max(r.w / aspect, r.h);
    assert.ok(score(bestPack(items, 20, aspect)) <= score(bestShelf(items, 20, aspect)) + 0.5, `비율 ${aspect}`);
  }
});
test('P153 r2: 실제 판 짜임은 보기 칸 비율에서 처음 화면이 읽힌다(1584×921: 맞춤 배율 ≥ 0.3)', () => {
  const vw = 1584 - 64, vh = 921 - 60 - 96 - 112 - 64; // 지도 칸: 위 막대·위 줄·명령줄·여백을 뺀다
  const lay = lay0({ aspect: vw / vh });
  const k = Math.min(vw / lay.bounds.w, vh / lay.bounds.h);
  assert.ok(k >= 0.3, `맞춤 ${k.toFixed(3)}`);
});
test('P153 r2: 휴대폰 지도는 폭(maxW) 안에 들고 타일에 이름이 들어갈 폭이 있다', () => {
  const lay = territoryLayout(graph(), { order: WS, vgroups: FOLDERS, routing: false });
  const pt = phoneTerr(lay, { maxW: (393 - 16) / 0.88 });
  assert.ok(pt.bounds.w <= (393 - 16) / 0.88 + 0.5, `폭 ${pt.bounds.w}`);
  assert.ok(pt.tiles.every((t) => t.w >= 100 && t.h >= 26));
  const box = (t) => ({ x: t.x, y: t.y, w: t.w, h: t.h });
  for (let i = 0; i < pt.tiles.length; i++) for (let j = i + 1; j < pt.tiles.length; j++) assert.ok(!overlap(box(pt.tiles[i]), box(pt.tiles[j])));
});
test('P153 r2: 카드 맨 아래 줄은 다른 워크스페이스에서 온 것만, 작업 완료는 한 번, 위 줄 도움말은 명령줄 안내로', () => {
  const src = read('MissionLineage.jsx');
  assert.match(src, /const more = \[cross && parentWs \? relText : null, \.\.\.extra\]/);
  assert.match(src, /done \? \(f\.age \?/, '보통 단계 상태 칸은 작업 완료면 시간만');
  assert.ok(!src.includes("t('mmTerr.hint')"), '위 줄 도움말 없음');
  assert.match(read('CommandBar.jsx'), /missionOpen \? t\('mmTerr\.barHint'\)/);
});
test('P153 r5: 다른 워크스페이스 선은 섬 머리 띠와 무리 이름표를 지나지 않는다', () => {
  for (const aspect of [1.4, 2, 2.4, 2.6]) {
    const lay = lay0({ aspect });
    const bands = [...lay.isles.map((i) => ({ what: `섬 ${i.key} 머리`, x: i.x + 6, y: i.y + 4, w: i.w - 12, h: TERR.HEAD - 10 })),
      ...lay.rings.map((r) => ({ what: `무리 ${r.lead} 이름표`, x: r.x + 10, y: r.y + 2, w: Math.min(r.w - 20, 420), h: TERR.RH - 6 }))];
    for (const e of lay.edges.filter((x) => x.cross)) for (let k = 1; k < e.pts.length; k++) for (const b of bands) assert.ok(!segHits(e.pts[k - 1], e.pts[k], b), `비율 ${aspect}: ${e.id}가 ${b.what}를 지난다`);
  }
});

// ---- 라운드 3 ----
// 두 토막이 같은 줄 위에서 겹치는가(같은 세로줄 또는 가로줄에서 길이가 겹침)
const share = (a, b, c, d) => {
  if (a[0] === b[0] && c[0] === d[0] && Math.abs(a[0] - c[0]) < 1) return Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) > 2;
  if (a[1] === b[1] && c[1] === d[1] && Math.abs(a[1] - c[1]) < 1) return Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) > 2;
  return false;
};
test('P153 r3: 다른 워크스페이스 선은 받는 카드 위 가장자리로 들어가고 나무 선과 토막을 나누지 않는다', () => {
  for (const aspect of [1.4, 2, 2.6]) {
    const lay = lay0({ aspect });
    for (const e of lay.edges.filter((x) => x.cross)) {
      const to = lay.cards.get(e.to), n = e.pts.length;
      const [p, q] = [e.pts[n - 2], e.pts[n - 1]];
      const top = p[0] === q[0] && q[1] === to.y && p[1] < q[1], left = p[1] === q[1] && q[0] === to.x && p[0] < q[0], right = p[1] === q[1] && q[0] === to.x + to.w && p[0] > q[0];
      assert.ok(top || left || right, '끝 토막은 받는 카드의 위·왼쪽·오른쪽 가장자리로 곧게 들어간다(아래로는 들어가지 않는다)');
      for (const t of lay.edges.filter((x) => !x.cross)) for (let i = 1; i < e.pts.length; i++) for (let j = 1; j < t.pts.length; j++) assert.ok(!share(e.pts[i - 1], e.pts[i], t.pts[j - 1], t.pts[j]), `${e.id}가 나무 선 ${t.id}와 겹친다`);
    }
  }
});
test('P153 r3: 카드 높이는 내용을 따르고, 무리 안 같은 줄은 같은 높이', () => {
  const lay = lay0();
  const hs = [...lay.cards.values()].map((c) => c.h);
  assert.ok(Math.min(...hs) >= 118, `높이 ${[...new Set(hs)]}`);
  for (const r of lay.rings) {
    const rows = new Map();
    for (const c of lay.cards.values()) if (inside(c, r)) { if (!rows.has(c.y)) rows.set(c.y, new Set()); rows.get(c.y).add(c.h); }
    for (const [y, set] of rows) assert.equal(set.size, 1, `무리 ${r.lead} 줄 ${y}`);
  }
  const g = graph();
  g.nodes[0].lastPrompt = 'short'; Object.assign(g.nodes[1], { lastPrompt: 'a much longer task text that will wrap onto two lines', gitBranch: 'wt/long' });
  const l2 = territoryLayout(g, { order: WS, vgroups: FOLDERS });
  assert.ok(l2.cards.get('s:conductor').h < l2.cards.get('s:c1').h, '긴 일 글과 브랜치 줄이 있으면 카드가 높다');
});
test('P153 r3: 읽는 차례 — 폴더 영토 묶음이 먼저, 폴더 밖 섬은 그 뒤(섞이지 않는다)', () => {
  for (const aspect of [1.2, 1.8, 2.6, 3.4]) {
    const lay = lay0({ aspect });
    const right = Math.max(...lay.terrs.map((t) => t.x + t.w)), bottom = Math.max(...lay.terrs.map((t) => t.y + t.h));
    for (const i of lay.isles.filter((x) => x.loose)) assert.ok(i.x >= right || i.y >= bottom, `비율 ${aspect}: ${i.key}가 영토 묶음 안에 끼었다`);
  }
});

// ---- 라운드 7: PC = 시안 B Lineage(lib/mission-lineage.js), 태그 규칙(라운드 6 E) ----
import { lineageLayout, LINE } from '../src/renderer/lib/mission-lineage.js';
import { switchText } from '../src/renderer/lib/cmd-input.js';
const lin = () => lineageLayout(graph(), { order: WS, vgroups: FOLDERS });
test('P153 r7: 폴더 띠와 줄의 차례·소속은 사이드바와 같고 폴더 없음 띠가 마지막', () => {
  const lay = lin();
  const side = groupLayout(WS.map((key) => ({ key })), FOLDERS);
  assert.deepEqual(lay.bands.map((b) => b.id), [...side.groups.map((g) => g.id), null]);
  for (const g of side.groups) assert.deepEqual(lay.rows.filter((r) => r.band === g.id).map((r) => r.key), g.workspaces.map((w) => w.key));
  assert.deepEqual(lay.rows.filter((r) => r.band == null).map((r) => r.key), side.ungrouped.map((w) => w.key));
  for (const r of lay.rows) { const b = lay.bands.find((x) => x.id === r.band); assert.ok(r.y >= b.y && r.y + r.h <= b.y + b.h + 0.01, `${r.key}가 띠 안`); }
  for (let i = 1; i < lay.rows.length; i++) assert.ok(lay.rows[i].y >= lay.rows[i - 1].y + lay.rows[i - 1].h - 0.01, '줄은 위 → 아래로 겹치지 않는다');
});
test('P153 r7: 칸 — 리드는 리드 칸, 하위는 깊이만큼 오른쪽, 다른 워크스페이스 부모는 워커 칸, 혼자는 혼자 칸, 하위가 다른 곳에만 있는 세션도 리드 칸', () => {
  const lay = lin();
  const col = (k) => (k === 'lead' ? lay.cols.find((c) => c.key === 'lv' && c.level === 0) : k === 'workers' ? lay.cols.find((c) => c.key === 'lv' && c.level === 1) : k === 'next' ? lay.cols.find((c) => c.key === 'lv' && c.level === 2) : lay.cols.find((c) => c.key === k)).x; // r11: 칸은 숫자 단계(시작 = 0)
  const x = (n) => lay.cards.get(`s:${n}`).x;
  assert.equal(x('exam-lead'), col('lead'));
  for (const n of ['ex-notes', 'ex-qa-c']) assert.equal(x(n), col('workers'));
  assert.equal(x('deck-lead'), col('lead')); assert.equal(x('deck-writer'), col('workers')); assert.equal(x('deck-reader'), col('next'), '역할 연결 나무도 칸을 따른다');
  assert.equal(x('researcher'), col('workers'), '부모(m1)가 다른 워크스페이스');
  assert.equal(x('coin-feed'), col('next'));
  assert.equal(x('m1'), col('lead'), '하위가 다른 워크스페이스에만 있어도 리드 칸');
  for (const n of ['c1', 'hub-head', 'notes-2', 'reviewer']) assert.ok(x(n) >= col('solo'), `${n}는 혼자 칸`);
  const cards = [...lay.cards.values()];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) assert.ok(!overlap(cards[i], cards[j]), `${cards[i].node.name}×${cards[j].node.name}`);
  for (const c of cards) { const r = lay.rows.find((x2) => x2.key === c.ws); assert.ok(c.y >= r.y && c.y + c.h <= r.y + r.h + 0.01, `${c.node.name}가 자기 줄 안`); }
  assert.deepEqual(lay.cols.map((c) => c.key === 'lv' ? c.level : c.key), ['ws', 0, 1, 2, 'solo'], '칸: 워크스페이스·시작·1단계·2단계·혼자(보이는 가장 깊은 단계까지)');
});
test('P153 r7: 선은 직각, 나무 선은 부모 오른쪽 → 하위 왼쪽, 다른 워크스페이스 선은 카드·줄 머리를 지나지 않고 받는 카드 왼쪽·위로', () => {
  const lay = lin();
  for (const e of lay.edges) {
    for (let i = 1; i < e.pts.length; i++) {
      assert.ok(e.pts[i - 1][0] === e.pts[i][0] || e.pts[i - 1][1] === e.pts[i][1], `${e.id} 직각`);
      for (const c of lay.cards.values()) assert.ok(!segHits(e.pts[i - 1], e.pts[i], c), `${e.id}가 ${c.node.name}를 지난다`);
    }
    assert.equal(e.label, null, '선 이름표는 없다(r8)');
    const to = lay.cards.get(e.to), q = e.pts[e.pts.length - 1];
    // r8: 선 끝은 카드 강조 고리 바깥(틈 EDGEGAP, 작업 중이면 RING)
    const near = (v, edge) => v - edge >= LINE.EDGEGAP - 0.01 && v - edge <= LINE.RING + 0.01;
    if (!e.cross) { const a = lay.cards.get(e.from); assert.ok(near(e.pts[0][0], a.x + a.w), '부모 오른쪽 바깥에서'); assert.ok(near(to.x, q[0]), '하위 왼쪽 바깥으로'); }
    else assert.ok(near(to.x, q[0]) || near(to.y, q[1]), '받는 카드 왼쪽 또는 위 바깥으로');
  }
  assert.ok(lay.edges.some((e) => e.cross), '다른 워크스페이스 선이 있다');
});
test('P153 r6·r7: 판 ↔ 세션 맵 전환 때 명령줄 — 태그만이면 지움, 태그와 글은 유지, 글만은 유지; 더블클릭은 첫 클릭 태그를 되돌린다', () => {
  assert.equal(switchText('@a '), '');
  assert.equal(switchText('@a @b  '), '');
  assert.equal(switchText('@a hello'), '@a hello');
  assert.equal(switchText('hello'), 'hello');
  assert.equal(switchText(''), '');
  // 더블클릭: 첫 클릭이 태그를 넣으면(toggleTag) 더블클릭이 같은 이름으로 한 번 더 바꿔 되돌린다(MissionLineage.jsx go)
  assert.equal(toggleTag(toggleTag('hello', 'x'), 'x'), 'hello');
  assert.equal(toggleTag(toggleTag('@x hi', 'x'), 'x'), '@x hi');
  const src = read('MissionLineage.jsx');
  assert.match(src, /if \(e && e\.detail > 1\) return;/, '둘째 클릭은 태그를 바꾸지 않는다');
  assert.match(src, /if \(dbl && b && lt && lt\.id === id && Date\.now\(\) - lt\.at < 800\) commandDraft\.dispatchEvent\(new CustomEvent\('tag'/, '더블클릭은 첫 클릭 태그를 되돌린다');
  assert.match(read('CommandBar.jsx'), /setText\(\(cur\) => switchText\(cur\)\)/, '열고 닫을 때 switchText');
});

// ---- 라운드 8 ----
test('P153 r8: 폴더 띠 사이는 띄우고, 선 이름표는 없고, 선 끝은 카드 고리 바깥', () => {
  const lay = lin();
  for (let i = 1; i < lay.bands.length; i++) assert.ok(lay.bands[i].y - (lay.bands[i - 1].y + lay.bands[i - 1].h) >= LINE.BANDGAP - 0.01, '띠 사이 빈 칸');
  assert.ok(lay.edges.every((e) => e.label == null));
  const working = lay.edges.filter((e) => lay.cards.get(e.to).node.state === 'working');
  for (const e of working) { const to = lay.cards.get(e.to), q = e.pts[e.pts.length - 1]; assert.ok(to.x - q[0] >= LINE.RING - 0.01, '작업 중 카드는 빛 고리 바깥에서 멈춘다'); }
  assert.ok(working.length > 0);
});
test('P153 r8: 미리 보기·작업 완료·배경 점(소스)', () => {
  const src = read('MissionLineage.jsx'), css = read('styles.css');
  assert.match(src, /const HOVER_MS = 500/);
  assert.match(src, /awake \? api\.call\('terminal\.snapshot', \{ session: sid, format: 'text' \}\)/, '터미널은 깨어 있을 때만, 지금 화면만(terminal.snapshot = visible)');
  assert.match(src, /if \(pvRef\.current\) \{ pvRef\.current = null; setPv\(null\); \}/, '끌거나 확대하면 비킨다');
  assert.match(src, /onFocus=\{\(e\) => onHover\(id, e\.currentTarget\)\}/, '키보드 초점도');
  assert.match(css, /\.mt-sm-peek \{ position: absolute; z-index: 8; pointer-events: none;/, '마우스를 받지 않는다');
  assert.match(css, /\.mt-sm \.mt-ta-world\.lv-far \.mt-mm-donetag \{ display: inline-flex;/, '멀리서도 작업 완료 꼬리표');
  assert.match(css, /\.mt-sm \.mt-ta-slot\.st-done \.mt-ta-card \{[^}]*linear-gradient/, '작업 완료 그라데이션');
  assert.match(src, /while \(gs < DOT_MIN_GAP\) gs \*= 2;/, '멀리서 점을 솎는다');
  for (const k of ['asks', 'answer', 'events', 'asleep', 'noScreen']) { assert.ok(en.mmPeek[k], `en ${k}`); assert.ok(ko.mmPeek[k], `ko ${k}`); }
});

// ---- 라운드 9: 앱 사이드바를 같이 쓴다 ----
test('P153 r9: 세션 맵 목차 레일 없음, 사이드바 줄 누르기는 세션 맵(열렸을 때) 또는 판으로, 접기는 화살표로만, 반짝임은 판 설정을 따른다', () => {
  const sb = read('Sidebar.jsx'), mm = read('MissionLineage.jsx'), css = read('styles.css');
  assert.ok(!/ln-rail|mt-sm-rail/.test(mm) && !/mt-sm-rail/.test(css), '목차 레일 없음');
  assert.match(mm, /const RAIL = 0;/);
  assert.match(mm, /st\.mapFocus = \{\s*\n\s*session: /, '세션 맵이 사이드바 길을 연다');
  assert.match(mm, /centerOn\(b\.x \+ b\.w \/ 2, b\.y \+ b\.h \/ 2, v\.k,/, '세션: 지금 배율 그대로 가운데');
  assert.match(sb, /function focusSession\(sid\) \{ const st = getState\(\); if \(st\.missionOpen && st\.mapFocus && st\.mapFocus\.session\(sid\)\) return; if \(st\.navigateTo\) st\.navigateTo\(sid, \{ focusTerminal: true \}\); \}/);
  assert.match(sb, /function focusWs\(key\) \{[^}]*mapFocus\.ws\(key\)[^}]*selectWorkspace\(key\); \}/);
  assert.match(sb, /selectGroup\(keys,/, '판: 폴더 = 구성 영역 모두에 맞춤');
  assert.match(sb, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); onToggle\(\); \}\}/, '화살표만 접기(줄 누르기로 번지지 않음)');
  assert.match(sb, /onClick=\{\(\) => \{ setCursor\(r\.id\); if \(!renaming\) focusGroup\(r\); \}\}/, '폴더 줄 누르기 = 그 영역');
  assert.ok(!/onClick=\{\(\) => \{ setCursor\(r\.id\); if \(selecting\) toggleSelected\(w\.key\); else toggleFold\(w\.key\); \}\}/.test(sb), '워크스페이스 줄 누르기는 더 이상 접지 않는다');
  assert.match(css, /html\[data-work-light="off"\] \.mt-sm \.blink/, '반짝임: 판 설정 끔이면 멈춘 강조');
  assert.ok(!/@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.mt-sm \.blink/.test(css), '움직임 줄이기(OS)만으로 끄지 않는다');
  assert.ok(en.sbFold.open && ko.sbFold.close);
});

// ---- 라운드 11: 숫자 단계 칸, 깊이 접기, 동료·독립, Alt+카드 끌기로 관계 바꾸기(P156 계약 흉내) ----
import { relationDrop, relationCall, applyRelationStub } from '../src/renderer/lib/mission-lineage.js';
// 깊이 6 사슬(d0 → d1 → … → d6)을 새 워크스페이스에
const DEEP_WS = 'd:/work/deep/.git';
const deepGraph = () => {
  const g = graph();
  const chain = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6'];
  chain.forEach((n, i) => g.nodes.push({ id: `s:${n}`, kind: 'session', sessionId: `x-${n}`, name: n, workspaceKey: DEEP_WS, state: 'sleeping', parentId: i ? `s:${chain[i - 1]}` : null, createdAt: 100 + i }));
  for (let i = 1; i < chain.length; i++) g.edges.push({ from: `s:${chain[i - 1]}`, to: `s:${chain[i]}`, kind: 'spawn', count: 1 });
  return { g, order: [...WS, DEEP_WS] };
};
const deepLay = (expanded, sets = []) => { const { g, order } = deepGraph(); return lineageLayout(applyRelationStub(g, sets), { order, vgroups: FOLDERS, expanded }); };
const colsOf = (lay) => lay.cols.map((c) => (c.key === 'lv' ? c.level : c.key));
const lvX = (lay, n) => lay.cols.find((c) => c.key === 'lv' && c.level === n).x;

test('P153 r11: 칸은 워크스페이스 · 시작 · 1단계 · … · 솔로, 4단계보다 깊은 가지는 접고(+n단계) 편 가지만 끝까지 편다', () => {
  const lay = deepLay(new Set());
  assert.deepEqual(colsOf(lay), ['ws', 0, 1, 2, 3, 4, 'solo'], '보이는 가장 깊은 단계(4)까지');
  assert.equal(lay.cards.get('s:d4').fold, 2, 'd4 카드에 +2단계');
  assert.ok(!lay.cards.has('s:d5') && !lay.cards.has('s:d6'), '접힌 카드는 그리지 않는다');
  const open = deepLay(new Set(['s:d4']));
  assert.deepEqual(colsOf(open), ['ws', 0, 1, 2, 3, 4, 5, 6, 'solo']);
  assert.equal(open.cards.get('s:d4').fold, 0);
  assert.equal(open.cards.get('s:d6').x, lvX(open, 6), '편 가지는 끝(6단계)까지');
  assert.equal(ko.mmLine.colRoot, '시작'); assert.equal(ko.mmLine.colLevel, '{n}단계'); assert.equal(ko.mmLine.colSolo, '솔로'); // P157: 혼자 → 솔로 assert.equal(ko.mmLine.fold, '+{n}단계');
  assert.equal(en.mmLine.colRoot, 'Root'); assert.equal(en.mmLine.colLevel, 'Level {n}'); assert.equal(en.mmLine.colSolo, 'Solo');
  for (const k of ['colLead', 'colWorkers', 'colNext']) assert.ok(!(k in ko.mmLine) && !(k in en.mmLine), `${k}는 없앴다`);
  const src = read('MissionLineage.jsx');
  assert.match(src, /data-action="ln-fold"/); assert.match(src, /localStorage\.setItem\(EXP_KEY/, '편 가지는 기억한다');
});

test('P153 r11: 동료는 같은 칸에 붙어 쌓이고 양끝 점 선(화살촉 없음), 독립은 시작 칸에서 옅은 계보 선만', () => {
  const lp = deepLay(new Set(), [{ a: 'x-d1', b: 'x-d2', relation: 'peer' }]);
  const d1 = lp.cards.get('s:d1'), d2 = lp.cards.get('s:d2');
  assert.equal(d1.x, d2.x, '동료는 같은 칸');
  const [u, d] = d1.y < d2.y ? [d1, d2] : [d2, d1];
  assert.ok(Math.abs(d.y - (u.y + u.h) - LINE.PGY) < 0.01, '동료는 바로 위아래(틈 PGY)');
  const pe = lp.edges.find((e) => e.peer);
  assert.ok(pe && pe.rel === 'peer' && !pe.cross && pe.pts.every((p) => p[0] === pe.pts[0][0]), '동료 선 = 세로 한 줄');
  assert.ok(!lp.edges.some((e) => e.tree && [e.from, e.to].sort().join() === 's:d1,s:d2'), '동료끼리는 나무 선이 없다');
  const ind = deepLay(new Set(), [{ a: 'x-d2', b: 'x-d3', relation: 'none' }]);
  assert.equal(ind.cards.get('s:d3').x, lvX(ind, 0), '독립 = 시작 칸');
  assert.equal(ind.cards.get('s:d4').x, lvX(ind, 1), '하위는 함께 따라간다');
  const le = ind.edges.find((e) => e.lineage);
  assert.ok(le && le.from === 's:d2' && le.to === 's:d3' && le.rel === 'lineage' && !le.cross, '계보는 옅은 선으로만');
  const src = read('MissionLineage.jsx');
  assert.match(src, /mt-sm-end-peer/); assert.match(src, /markerStart=\{e\.peer \? tip/); assert.match(src, /e\.lineage \? undefined/);
});

test('P153 r11: 정한 동료·독립 쌍은 일 나무에서 빠지고, 정한 하위가 이긴다(applyRelationStub = P156 계약)', () => {
  const { g, order } = deepGraph();
  const s = applyRelationStub(g, [{ a: 'x-d0', b: 'x-d3', relation: 'sub' }, { a: 'x-d1', b: 'x-d2', relation: 'peer' }]);
  const n = (id) => s.nodes.find((x) => x.id === id);
  assert.equal(n('s:d3').parentId, 's:d0'); assert.equal(n('s:d3').lineageParent, 's:d2', '계보 부모는 그대로');
  assert.deepEqual(n('s:d1').peers, ['s:d2']); assert.deepEqual(n('s:d2').peers, ['s:d1']); assert.equal(n('s:d2').parentId, null);
  const e = s.edges.find((x) => x.from === 's:d1' && x.to === 's:d2');
  assert.equal(e.relation, 'peer'); assert.equal(e.relationSource, 'user');
  assert.ok(s.edges.some((x) => x.kind === 'relation' && x.from === 's:d0' && x.to === 's:d3' && x.relationUp === 's:d0'), '선 없는 쌍은 relation 선');
  const lay = lineageLayout(s, { order, vgroups: FOLDERS });
  assert.equal(lay.tree.parent.get('s:d3'), 's:d0'); assert.notEqual(lay.tree.parent.get('s:d2'), 's:d1');
  assert.equal(applyRelationStub(g, []), g, '정한 것이 없으면 그대로');
});

test('P153 r11: Alt+카드 끌기 — 오른쪽 = 하위로, 위아래 = 동료로, 빈 시작 칸 = 독립, 제자리·자기 하위 = 없음, relation.set 인자', () => {
  const lay = deepLay(new Set());
  const c = (n) => lay.cards.get(`s:${n}`);
  const el = c('exam-lead');
  const sub = relationDrop(lay, 's:d3', el.x + el.w + LINE.GX + 20, el.y + el.h / 2);
  assert.equal(sub.kind, 'sub'); assert.equal(sub.target, 's:exam-lead');
  assert.deepEqual(relationCall(lay, 's:d3', sub), { a: 'x-exam-lead', b: 'x-d3', relation: 'sub' });
  const xn = c('ex-notes');
  const peer = relationDrop(lay, 's:d3', xn.x + 20, xn.y - 10);
  assert.equal(peer.kind, 'peer'); assert.equal(peer.target, 's:ex-notes');
  assert.deepEqual(relationCall(lay, 's:d3', peer), { a: 'x-ex-notes', b: 'x-d3', relation: 'peer' });
  assert.equal(relationDrop(lay, 's:d3', c('d3').x + 10, c('d3').y + 10), null, '제자리 = 취소');
  const d4 = c('d4'); const own = relationDrop(lay, 's:d3', d4.x + d4.w + LINE.GX + 20, d4.y + d4.h / 2);
  assert.ok(!own || own.target !== 's:d4', '자기 하위 밑으로는 못 간다');
  const d2 = c('d2');
  assert.equal(relationDrop(lay, 's:d3', d2.x + d2.w + LINE.GX + 20, d2.y + d2.h / 2), null, '제자리(부모 오른쪽 자기 자리) = 취소');
  assert.equal(relationCall(lay, 's:d3', { kind: 'sub', target: 's:d2' }), null, '이미 그 하위면 부를 것이 없다');
  // 독립: 다른 줄(exam)의 빈 시작 칸(exam-lead 위아래가 아닌 곳)
  const row = lay.rows.find((r) => r.key === c('exam-lead').ws);
  const col0 = lvX(lay, 0);
  let none = null;
  for (let y = row.y + 10; y < row.y + row.h && !none; y += 10) { const d = relationDrop(lay, 's:d3', col0 + 30, y); if (d && d.kind === 'none') none = d; }
  assert.ok(none, '빈 시작 칸이 있다');
  assert.deepEqual(relationCall(lay, 's:d3', none), { a: 'x-d2', b: 'x-d3', relation: 'none' });
  const src = read('MissionLineage.jsx');
  assert.match(src, /api\.call\('relation\.set', call\)/); assert.match(src, /e.code === 'cycle'/); assert.doesNotMatch(src, /unknown_method|relStub/, 'r12: 흉내 길은 없앴다'); assert.match(src, /mode: 'card'/);
  assert.match(src, /e\.altKey && e\.pointerType === 'mouse'/, 'Alt 없이 끌면 시점 이동');
  assert.match(src, /mt-sm-grab/, '줄을 잡는 자리는 워크스페이스 칸 빈 곳까지');
  for (const k of ['dropSub', 'dropPeer', 'dropNone', 'relFail', 'relCycle']) assert.ok(ko.mmLine[k] && en.mmLine[k], k);
  assert.equal(ko.mmLine.dropNone, '독립'); assert.match(ko.mmLine.dropSub, /하위로/); assert.match(ko.mmLine.dropPeer, /동료로/);
});

test('P153 r12: 하위가 있는 리드와 그 동료(하위 없음)도 바로 위아래에 붙는다, 하위 칸 카드 바로 아래 = 그 카드의 동료(하위로가 아니다)', () => {
  const { g, order } = deepGraph();
  // d0의 동료 dp(부모 없음, 하위 없음). d0은 하위(d1…)가 있어 묶음이 길다
  g.nodes.push({ id: 's:dp', kind: 'session', sessionId: 'x-dp', name: 'dp', workspaceKey: DEEP_WS, state: 'sleeping', parentId: null, createdAt: 200 });
  const s = applyRelationStub(g, [{ a: 'x-d0', b: 'x-dp', relation: 'peer' }]);
  const lay = lineageLayout(s, { order, vgroups: FOLDERS });
  const a = lay.cards.get('s:d0'), p = lay.cards.get('s:dp');
  assert.equal(a.x, p.x);
  assert.ok(Math.abs(p.y - (a.y + a.h) - LINE.PGY) < 0.01 || Math.abs(a.y - (p.y + p.h) - LINE.PGY) < 0.01, '리드와 동료 사이 = PGY');
  const d1 = lay.cards.get('s:d1');
  const below = relationDrop(lay, 's:d3', d1.x + 30, d1.y + d1.h + 20);
  assert.equal(below.kind, 'peer'); assert.equal(below.target, 's:d1');
  const src = read('MissionLineage.jsx');
  assert.match(src, /api\.on\('relation\.updated'/, '다른 곳에서 바뀐 관계도 다시 읽는다');
  assert.doesNotMatch(src, /api\.call\('session\.detach'/, '계보는 사실: 떼지 않는다');
});
