// P159 단위 시험: 세션 맵 동료 선은 두 카드의 가로 가운데(옛 선은 카드 왼쪽 + 28에 서서 왼쪽으로 치우쳤다), 창의 떼기 = 독립으로 두기 글.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineageLayout, applyRelationStub, peerPts, LINE } from '../src/renderer/lib/mission-lineage.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';
import { buildRows } from '../src/renderer/lib/sidebar-tree.js';
import { branchLabel } from '../src/renderer/lib/branch.js';
import { setLanguage } from '../src/renderer/lib/i18n.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const WS = 'd:/work/p159/.git';
const node = (n, parent = null, i = 0) => ({ id: `s:${n}`, kind: 'session', sessionId: `x-${n}`, name: n, workspaceKey: WS, state: 'ready', parentId: parent ? `s:${parent}` : null, createdAt: 100 + i });
const cx = (c) => c.x + c.w / 2;

test('P159 동료 선 좌표: 폭이 같으면 가운데 세로 한 줄, 다르면 각 카드 가운데에서 틈 가운데로 꺾는다', () => {
  const u = { x: 100, y: 0, w: 300, h: 80 }, d = { x: 100, y: 110, w: 300, h: 60 };
  assert.deepEqual(peerPts(u, d, 4), [[250, 84], [250, 106]]);
  const n = { x: 100, y: 110, w: 200, h: 60 };
  assert.deepEqual(peerPts(u, n, 4), [[250, 84], [250, 95], [200, 95], [200, 106]]);
});

test('P159 세션 맵: 위아래로 붙은 동료 카드 사이 선은 두 카드의 가로 가운데(리드와 동료, 하위 칸 동료, 깊이 접기·편 가지)', () => {
  // 리드 l → 하위 w1·w2, 리드의 동료 p, 하위끼리 동료(w1·w2), 깊은 사슬(w2 → d1 → … → d5)
  const nodes = [node('l', null, 0), node('w1', 'l', 1), node('w2', 'l', 2), node('p', null, 3)];
  const chain = ['d1', 'd2', 'd3', 'd4', 'd5'];
  chain.forEach((n, i) => nodes.push(node(n, i ? chain[i - 1] : 'w2', 10 + i)));
  const edges = nodes.filter((n) => n.parentId).map((n) => ({ from: n.parentId, to: n.id, kind: 'spawn', count: 1 }));
  const sets = [{ a: 'x-l', b: 'x-p', relation: 'peer' }, { a: 'x-w1', b: 'x-w2', relation: 'peer' }];
  for (const expanded of [new Set(), new Set(['s:d3'])]) {
    const g = applyRelationStub({ nodes: nodes.map((n) => ({ ...n })), edges }, sets);
    const lay = lineageLayout(g, { order: [WS], vgroups: [], expanded });
    const peers = lay.edges.filter((e) => e.peer);
    assert.ok(peers.length >= 2, '동료 선 둘');
    for (const e of peers) {
      const a = lay.cards.get(e.from), b = lay.cards.get(e.to);
      const [u, d] = a.y < b.y ? [a, b] : [b, a];
      assert.equal(e.pts[0][0], cx(u), `${e.id}: 위 카드 가운데에서 나간다`);
      assert.equal(e.pts[e.pts.length - 1][0], cx(d), `${e.id}: 아래 카드 가운데로 들어간다`);
      assert.ok(e.pts[0][1] > u.y + u.h && e.pts[e.pts.length - 1][1] < d.y, '선은 두 카드 사이 틈에만');
      assert.ok(Math.abs(e.pts[0][1] - (u.y + u.h) - LINE.EDGEGAP) < 0.01);
      assert.ok(!e.cross);
    }
  }
});

test('P159 창: 떼기는 "독립으로 두기"(일 부모가 있을 때만 메뉴), 두 사전', () => {
  assert.equal(ko.detach.menu, '독립으로 두기'); assert.equal(ko.detach.confirm, '독립으로 두기'); assert.equal(ko.detach.cutDetach, '독립으로도 두기');
  assert.equal(en.detach.menu, 'Make independent'); assert.equal(en.detach.cutDetach, 'Make independent too');
  assert.match(ko.backend.detach, /독립으로 둡니다/); assert.match(ko.backend.detach, /띄운 기록은 남습니다/); assert.doesNotMatch(ko.backend.detach, /되돌릴 수 없습니다/);
  assert.match(en.backend.detach, /makes it independent/); assert.doesNotMatch(en.backend.detach, /cannot be undone/);
  assert.match(ko.backend.linkCutParent, /독립으로도 두면/); assert.match(en.backend.linkCutParent, /independent too/);
  const src = read('SessionNode.jsx');
  assert.match(src, /s\.branch && s\.branch\.workParentSessionId && \(detachAsk/);
  assert.match(src, /detach\.menuHint', \{ parent: s\.branch\.workParentName/);
});

// P159 3차: 창의 위아래(머리줄·사이드바)는 일 관계. 백엔드 요약이 parentSessionId = 일 부모, lineageParentSessionId = 계보, branch도 일 관계를 준다
const WS2 = (key) => ({ key, name: key, kind: 'folder', root: `C:/${key}` });
const S2 = (name, extra = {}) => ({ sessionId: `id-${name}`, name, kind: 'claude', state: 'ready', workspaceKey: 'a', lastActivityAt: 1000, ...extra });
const team = () => [
  S2('lead', { branch: { depth: 1, child: false, parentSessionId: null, children: 2 } }),
  S2('w1', { parentSessionId: 'id-lead', lineageParentSessionId: 'id-lead', branch: { depth: 2, child: true, parentSessionId: 'id-lead', parentName: 'lead', parentOpen: true, role: '워커', order: 1 } }),
  S2('x', { parentSessionId: 'id-lead', lineageParentSessionId: null, branch: { depth: 2, child: true, parentSessionId: 'id-lead', parentName: 'lead', parentOpen: true, role: null } }),
  S2('p1', { parentSessionId: null, lineageParentSessionId: 'id-lead', branch: { depth: 1, child: false, parentSessionId: null, role: null } }),
  S2('w2', { parentSessionId: null, lineageParentSessionId: 'id-lead', branch: { depth: 1, child: false, parentSessionId: null, role: null } }),
];

test('P159 사이드바: 하위(사람이 정한 것 포함)만 일 부모 아래 들여 쓰고, 동료·독립은 띄운 세션 아래가 아니다', () => {
  const { rows } = buildRows({ workspaces: [WS2('a')], groups: [], sessions: team() });
  const L = Object.fromEntries(rows.map((r) => [r.id, r.lv]));
  assert.equal(L['s:id-lead'], 1);
  assert.equal(L['s:id-w1'], 2); assert.equal(L['s:id-x'], 2);
  assert.equal(L['s:id-p1'], 1, '동료는 맨 위 단계'); assert.equal(L['s:id-w2'], 1, '독립도');
  const order = rows.filter((r) => r.type === 'session').map((r) => r.id);
  const li = order.indexOf('s:id-lead');
  assert.deepEqual(order.slice(li + 1, li + 3).sort(), ['s:id-w1', 's:id-x'], '리드 바로 아래는 일 하위 둘');
});

test('P159 머리줄: 일 역할·일 부모로 쓰고, 동료·독립은 하위 글이 없다("워커"가 남지 않는다), 띄운 세션 표시는 계보', () => {
  setLanguage('ko');
  try {
    const [, w1, x, p1, w2] = team();
    assert.match(branchLabel(w1).text, /^@lead의 워커 1 · 2단계/);
    assert.match(branchLabel(x).text, /^@lead의 하위 세션 · 2단계/, '역할 이름이 없는 하위는 기본 낱말');
    assert.equal(branchLabel(p1), null); assert.equal(branchLabel(w2), null);
  } finally { setLanguage('en'); }
  const src = read('SessionNode.jsx');
  assert.match(src, /const lp = s\.lineageParentSessionId !== undefined \? s\.lineageParentSessionId : s\.parentSessionId;/);
  assert.match(src, /dockWorkers\.hint', \{ n: s\.branch\.children \}/, '하위 수(일 자식)는 백엔드 branch.children');
});
