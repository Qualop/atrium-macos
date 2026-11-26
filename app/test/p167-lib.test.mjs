// P167: 판에 선으로 바로 이어진 세션은 다른 워크스페이스여도 고른 세션의 짝이 되어 터미널을 가질 수 있다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matesOf, termAllowed, pickAttached } from '../src/renderer/lib/faces.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, '..', 'src', 'renderer', f), 'utf8');

// ws1: A. ws2: B(A의 동료 — 정한 관계는 백엔드가 연결을 연다), C(A가 역할 선으로 이음), E(A에게 시킴만 오감), F(A가 띄움), D(이어지지 않음),
// G(C와만 이어짐 — 두 단계), H(A와의 연결을 지움)
const links = [
  { linkId: 'l1', from: 'A', to: 'B', role: '동료' },
  { linkId: 'l2', from: 'A', to: 'C', role: 'how we work' },
  { linkId: 'l3', from: 'E', to: 'A', observed: true },
  { linkId: 'l4', from: 'A', to: 'F', spawned: true },
  { linkId: 'l5', from: 'C', to: 'G', role: '워커' },
  { linkId: 'l6', from: 'A', to: 'H', role: '워커', removedAt: 1 },
];
const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

test('짝: 동료·역할 선·시킴 선·띄움으로 이어진 세션은 짝, 선이 없거나 두 단계 떨어졌거나 지운 연결은 아니다', () => {
  const m = matesOf({ seeds: ['A'], ids, links });
  assert.deepEqual([...m].sort(), ['B', 'C', 'E', 'F']);
  assert.ok(!m.has('D'));
  assert.ok(!m.has('G'));
  assert.ok(!m.has('H'));
});

test('짝: 선의 방향과 상관없이 한 단계, 판에 없는 끝은 넣지 않는다, 고른 것이 없으면 비었다', () => {
  assert.deepEqual([...matesOf({ seeds: ['C'], ids, links })].sort(), ['A', 'G']);
  assert.deepEqual([...matesOf({ seeds: ['A'], ids, links, onBoard: (id) => id !== 'B' })].sort(), ['C', 'E', 'F']);
  assert.equal(matesOf({ seeds: [], ids, links }).size, 0);
  // 연결 목록은 Map.values() 같은 이터러블이어도 된다(store.js가 그대로 넘긴다)
  assert.deepEqual([...matesOf({ seeds: ['A'], ids, links: new Map(links.map((l) => [l.linkId, l])).values() })].sort(), ['B', 'C', 'E', 'F']);
});

test('터미널 허용: 다른 워크스페이스의 이어진 세션은 터미널, 이어지지 않은 세션은 요약', () => {
  const mates = matesOf({ seeds: ['A'], ids, links });
  const sel = new Set(['A']);
  assert.equal(termAllowed({ id: 'B', ws: 'ws2', viewWs: 'ws1', selected: sel, mates }), true);
  assert.equal(termAllowed({ id: 'C', ws: 'ws2', viewWs: 'ws1', selected: sel, mates }), true);
  assert.equal(termAllowed({ id: 'D', ws: 'ws2', viewWs: 'ws1', selected: sel, mates }), false);
  // pickAttached: 네 노드 모두 터미널 단계로 보일 때 A, B, C만 붙는다(상한과 순서는 그대로)
  const nodes = [['A', 0, 'ws1'], ['B', 1500, 'ws2'], ['C', 0, 'ws2'], ['D', 1500, 'ws2']].map(([id, x, ws], i) => ({ id, x, y: i >= 2 ? 1000 : 0, w: 1440, h: 900, ws }));
  const vp = { x: 0, y: 0, zoom: 0.3 }, screen = { width: 1600, height: 1000 };
  const got = pickAttached(nodes, vp, screen, { selected: sel, wsLimit: { key: 'ws1' }, mates });
  assert.deepEqual([...got].sort(), ['A', 'B', 'C']);
  assert.equal(got[0], 'A'); // 고른 노드 먼저
  // 고르기를 풀면 예전대로: 고른 워크스페이스(ws1)의 A만
  assert.deepEqual(pickAttached(nodes, vp, screen, { wsLimit: { key: 'ws1' }, mates: matesOf({ seeds: [], ids, links }) }), ['A']);
});

test('store: 짝 기억 열쇠에 연결을 넣고 노드 자리(st.nodes)는 넣지 않는다(판을 움직이는 프레임에 다시 세지 않게)', () => {
  const src = read('store.js');
  const fn = src.slice(src.indexOf('export function matesNow'), src.indexOf('export const dockOf'));
  assert.match(fn, /matesIn\[4\] === st\.links/);
  assert.match(fn, /links: st\.links\.values\(\)/);
  assert.doesNotMatch(fn.match(/matesIn = \[[^\]]*\]/)[0], /st\.nodes/);
  assert.match(read('Canvas.jsx'), /docksNow, links, schedule\]/);
});
