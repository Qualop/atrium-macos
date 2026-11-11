// P99 시험: 판 전체 정리가 다른 영역끼리의 연결을 보고 이어진 영역을 가까이 놓는다(region-layout.mjs linkWeights, linkedOrder, layoutRegions links)
// 연결 무게 세기, 이어진 쌍이 이웃, 연결 없는 판은 P91 결과 그대로, 묶음 테두리, 결정성, 40개 판 계산 시간, 판에 붙인 흐름(board.arrange { all })
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NODE, overlaps, bbox, groupFrames, REGION_GAP, GROUP_PAD, GROUP_HEAD } from '../src/canvas.mjs';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { Backend } from '../src/backend.mjs';
import * as ops from '../src/canvas-ops.mjs';
import { layoutRegions, linkWeights, linkedOrder, STALE_MS, ASPECT_SLACK } from '../src/region-layout.mjs';
import { normalizeGroups, groupIndex, moveWorkspace } from '../src/ws-groups.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p99u-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });
// 가장자리 사이 거리(맞닿으면 0)
const edge = (a, b) => Math.hypot(Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)));
const aspectErr = (r, aspect = 16 / 9) => Math.abs(Math.log(r.w / r.h / aspect));
// 크기 섞인 영역 n개(결정적인 의사 난수), 지금 자리는 5열 격자
function grid(n, seed = 7) {
  let r = seed;
  const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
  return Array.from({ length: n }, (_, i) => ({ key: `k${i}`, ws: `k${i}`, rect: { x: (i % 5) * 2600, y: Math.floor(i / 5) * 1800, w: 600 + Math.floor(rnd() * 1400), h: 400 + Math.floor(rnd() * 900) } }));
}

// ---------- P91 계산(고치기 전 그대로, 비교용) ----------
function oldShelf(items, { gap, rowW }) {
  let x = 0, y = 0, rowH = 0;
  return items.map((g) => { if (x > 0 && x + g.w > rowW + 1) { x = 0; y += rowH + gap; rowH = 0; } const at = { x, y }; x += g.w + gap; rowH = Math.max(rowH, g.h); return at; });
}
function oldBest(items, { gap, aspect }) {
  const maxW = Math.max(...items.map((g) => g.w));
  const cands = new Set([maxW]);
  const starts = items.length > 60 ? 1 : items.length;
  for (let i = 0; i < starts; i++) { let run = 0; for (let j = i; j < items.length; j++) { run += items[j].w + (j > i ? gap : 0); if (run >= maxW) cands.add(run); } }
  const area = items.reduce((s, g) => s + g.w * g.h, 0);
  let best = null;
  for (const rowW of [...cands].sort((a, b) => a - b)) {
    const at = oldShelf(items, { gap, rowW });
    const w = Math.max(...items.map((g, i) => at[i].x + g.w)), h = Math.max(...items.map((g, i) => at[i].y + g.h));
    const score = Math.abs(Math.log(w / h / aspect)) + 0.6 * (1 - area / (w * h));
    if (!best || score < best.score - 1e-9) best = { at, w, h, score };
  }
  return best;
}
function oldLayout(entries, aspect = 16 / 9, gap = REGION_GAP) {
  const units = [], byGroup = new Map();
  for (const e of entries) {
    if (e.ws && e.group != null) { if (!byGroup.has(e.group)) byGroup.set(e.group, []); byGroup.get(e.group).push(e); continue; }
    units.push({ members: [{ e, dx: 0, dy: 0 }], free: !e.ws, w: e.rect.w, h: e.rect.h, now: e.rect, empty: !!e.ws && !!e.empty, key: String(e.key) });
  }
  for (const [id, es] of byGroup) {
    es.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.rect.y - b.rect.y || a.rect.x - b.rect.x || String(a.key).localeCompare(String(b.key)));
    const { at } = oldBest(es.map((e) => ({ w: e.rect.w, h: e.rect.h })), { gap, aspect });
    const box = bbox(es.map((e, i) => ({ x: at[i].x, y: at[i].y, w: e.rect.w, h: e.rect.h })));
    const now = bbox(es.map((e) => e.rect));
    const pt = GROUP_PAD + GROUP_HEAD;
    units.push({ members: es.map((e, i) => ({ e, dx: at[i].x + GROUP_PAD, dy: at[i].y + pt })), free: false, w: box.w + 2 * GROUP_PAD, h: box.h + pt + GROUP_PAD, now: { x: now.x - GROUP_PAD, y: now.y - pt, w: now.w + 2 * GROUP_PAD, h: now.h + pt + GROUP_PAD }, empty: es.every((e) => e.empty), key: `group:${id}` });
  }
  const rank = (g) => (g.free ? 2 : g.empty ? 1 : 0);
  units.sort((a, b) => rank(a) - rank(b) || a.now.y - b.now.y || a.now.x - b.now.x || a.key.localeCompare(b.key));
  const o = bbox(units.map((g) => g.now));
  const best = oldBest(units, { gap, aspect });
  const rects = new Map();
  units.forEach((g, i) => { for (const { e, dx, dy } of g.members) rects.set(e.key, { x: Math.round(best.at[i].x + o.x + dx), y: Math.round(best.at[i].y + o.y + dy), w: e.rect.w, h: e.rect.h }); });
  return rects;
}

// ---------- 연결 무게 ----------
test('P99 무게: 세션 쌍마다 가장 강한 관계 하나(띄움·역할·부모 2, 일 시키기 1, 오래된 일 시키기 0.5), 같은 영역·모르는 세션·지운 연결은 뺀다', () => {
  const now = 10 * STALE_MS;
  const area = { a1: 'A', a2: 'A', b1: 'B', b2: 'B', c1: 'C', d1: 'D', e1: 'E' };
  const links = [
    { from: 'a1', to: 'b1', role: 'reviewer' }, // 2
    { from: 'b1', to: 'a1', observed: true, lastAt: now }, // 같은 쌍 반대 방향: 더하지 않고 큰 것(2)
    { from: 'a2', to: 'b2', observed: true, lastAt: now - 1000 }, // 1 → A·B 합 3
    { from: 'a1', to: 'c1', observed: true, lastAt: now - STALE_MS - 1 }, // 오래됨 0.5
    { from: 'a1', to: 'a2', role: 'x' }, // 같은 영역
    { from: 'a1', to: 'zz', spawned: true }, // 판에 없는 세션(닫힘)
    { from: 'a1', to: 'd1', role: 'r', removedAt: 5 }, // 지운 연결
    { from: 'c1', to: 'e1' }, // 아무 표시 없는 줄
  ];
  const w = linkWeights({ links, parents: [['d1', 'c1'], ['b1', 'b2']], areaOf: (s) => area[s] || null, now });
  assert.deepEqual(w, [{ a: 'A', b: 'B', w: 3 }, { a: 'A', b: 'C', w: 0.5 }, { a: 'C', b: 'D', w: 2 }]);
  assert.deepEqual(linkWeights({ links: [], areaOf: () => 'A' }), []);
});

// ---------- 연결 없는 판은 P91 결과 그대로 ----------
test('P99 회귀: 연결이 없거나 같은 묶음 안 연결뿐이면 P91 계산과 같은 자리', () => {
  for (let n = 1; n <= 14; n++) {
    for (const aspect of [16 / 9, 4 / 3, 0.6]) {
      const es = grid(n, n * 31 + 3).map((e, i) => ({ ...e, ...(n >= 6 && i < 3 ? { group: 'g', order: 2 - i } : {}), ...(i === n - 1 && n > 4 ? { empty: true } : {}) }));
      if (n >= 5) es.push({ key: 'memo:1', ws: null, rect: { x: 50, y: 50, w: 300, h: 200 } });
      const want = oldLayout(es, aspect);
      for (const links of [undefined, [], [{ a: 'k0', b: 'k1', w: 2 }].filter(() => n >= 6), [{ a: 'k0', b: 'nope', w: 1 }]]) {
        const got = layoutRegions(es, { aspect, links }).rects;
        assert.deepEqual([...got].sort(), [...want].sort(), `n=${n} aspect=${aspect.toFixed(2)} links=${JSON.stringify(links)}`);
      }
    }
  }
});

// ---------- 이어진 쌍은 이웃 ----------
test('P99 배치: 판 반대편의 이어진 쌍이 이웃(가장자리 거리 = 틈)이 되고, 비율은 연결 없는 결과 + 한도 안, 겹침 없음', () => {
  for (const [n, seed] of [[8, 1], [10, 2], [12, 3], [16, 4], [24, 5]]) {
    const es = grid(n, seed);
    const links = [{ a: 'k0', b: `k${n - 1}`, w: 2 }, { a: 'k1', b: `k${n - 2}`, w: 1 }, { a: 'k2', b: `k${Math.floor(n / 2)}`, w: 2 }];
    const plain = layoutRegions(es);
    const lay = layoutRegions(es, { links });
    for (const l of links) assert.ok(edge(lay.rects.get(l.a), lay.rects.get(l.b)) <= REGION_GAP + 1, `n=${n} ${l.a}|${l.b} 거리 ${edge(lay.rects.get(l.a), lay.rects.get(l.b))}`);
    assert.ok(edge(plain.rects.get('k0'), plain.rects.get(`k${n - 1}`)) > REGION_GAP, `n=${n} 고치기 전에는 멀었다`);
    assert.ok(lay.link.now < lay.link.plain, `n=${n} 연결 항 ${lay.link.plain} → ${lay.link.now}`);
    assert.equal(lay.link.pairs, 3);
    assert.ok(aspectErr(lay.rect) <= aspectErr(plain.rect) + ASPECT_SLACK + 1e-9, `n=${n} 비율 ${(lay.rect.w / lay.rect.h).toFixed(2)} (전 ${(plain.rect.w / plain.rect.h).toFixed(2)})`);
    const ks = [...lay.rects.keys()];
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) assert.ok(!overlaps(lay.rects.get(ks[i]), lay.rects.get(ks[j]), REGION_GAP - 1), `n=${n} ${ks[i]}|${ks[j]}`);
    // 연결과 상관없는 영역의 읽는 순서는 지킨다(연결된 것만 자리를 옮긴다)
    const moved = new Set(links.flatMap((l) => [l.a, l.b]));
    const before = es.filter((e) => !moved.has(e.key)).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x).map((e) => e.key);
    const after = lay.groups.map((g) => g.keys[0]).filter((k) => !moved.has(k));
    assert.deepEqual(after, before, `n=${n} 연결 없는 영역의 읽는 순서`);
  }
});

test('P99 배치: 빈 영역과 소속 없는 메모는 연결과 상관없이 맨 뒤', () => {
  const es = [...grid(8, 9), { key: 'e1', ws: 'e1', empty: true, rect: { x: 0, y: -3000, w: 800, h: 320 } }, { key: 'memo:m', ws: null, rect: { x: 0, y: -4000, w: 300, h: 200 } }];
  const lay = layoutRegions(es, { links: [{ a: 'k0', b: 'k7', w: 2 }] });
  assert.deepEqual(lay.groups.slice(-2).map((g) => g.keys[0]), ['e1', 'memo:m']);
});

// ---------- 묶음 테두리 ----------
test('P99 묶음: 덩어리째 옮기고 테두리는 다른 영역과 겹치지 않는다. 사람이 정한 순서는 그대로, 저절로 만든 묶음(loose)은 안 연결로 순서를 고른다', () => {
  const base = grid(9, 11);
  // k0, k1, k2가 묶음 g(사람이 정한 순서 2, 0, 1). 묶음 안 k1 ↔ 묶음 밖 k8, 묶음 안 k0 ↔ k2
  const mk = (loose) => base.map((e, i) => (i < 3 ? { ...e, group: 'g', order: [1, 2, 0][i], ...(loose ? { loose: true } : {}) } : e));
  const links = [{ a: 'k1', b: 'k8', w: 2 }, { a: 'k0', b: 'k2', w: 2 }];
  for (const loose of [false, true]) {
    const es = mk(loose);
    const lay = layoutRegions(es, { links });
    const regs = new Map([...lay.rects]);
    const f = groupFrames([{ id: 'g', members: ['k0', 'k1', 'k2'] }], regs)[0];
    assert.ok(f.ok, `loose=${loose} 테두리가 구성 아닌 영역과 겹치지 않는다`);
    for (const k of ['k3', 'k4', 'k5', 'k6', 'k7', 'k8']) assert.ok(!overlaps(regs.get(k), f.rect, REGION_GAP - 1), `loose=${loose} ${k}`);
    // 묶음 덩어리와 k8은 이웃
    const c = lay.clusters[0];
    assert.ok(edge(c.rect, regs.get('k8')) <= REGION_GAP + 1, `loose=${loose} 묶음 ↔ k8 ${edge(c.rect, regs.get('k8'))}`);
    if (!loose) assert.deepEqual(c.keys, ['k2', 'k0', 'k1'], '사람이 정한 순서');
    else assert.ok(edge(regs.get('k0'), regs.get('k2')) <= REGION_GAP + 1, `묶음 안 k0 ↔ k2 이웃 ${c.keys}`);
  }
  // 묶음 안 연결이 없으면 loose여도 사람이 정한(맞춰 둔) 순서 그대로
  assert.deepEqual(layoutRegions(mk(true), { links: [links[0]] }).clusters[0].keys, ['k2', 'k0', 'k1']);
});

test('P99 묶음: 사람이 저절로 만든 묶음 안에서 자리를 옮기면 ordered가 되어 loose가 아니다', () => {
  let s = normalizeGroups({ groups: [{ id: 'g1', name: 'ms', members: ['a', 'b', 'c'], auto: true, root: 'd:/w/ms' }, { id: 'g2', name: 'Mine', members: ['x'] }] });
  assert.deepEqual(groupIndex(s).get('a'), { id: 'g1', index: 0, loose: true });
  assert.deepEqual(groupIndex(s).get('x'), { id: 'g2', index: 0 }, '사람이 만든 그룹은 loose가 없다');
  s = moveWorkspace(s, 'c', 'g1', 0);
  assert.equal(s.groups[0].ordered, true);
  assert.deepEqual(normalizeGroups(s).groups[0].ordered, true, '저장해도 남는다');
  assert.deepEqual(groupIndex(s).get('c'), { id: 'g1', index: 0 });
  // 자리 없이 빼고 넣기(동기화)는 순서를 정한 것이 아니다
  let t = normalizeGroups({ groups: [{ id: 'g1', name: 'ms', members: ['a', 'b'], auto: true, root: 'd:/w/ms' }] });
  t = moveWorkspace(t, 'z', 'g1');
  assert.equal(t.groups[0].ordered, undefined);
});

// ---------- 결정성, 계산 시간 ----------
test('P99 결정성: 같은 입력이면 같은 결과(입력 차례를 섞어도), 정리한 판을 다시 정리해도 이웃을 지킨다', () => {
  const es = grid(14, 21);
  const links = [{ a: 'k0', b: 'k13', w: 2 }, { a: 'k3', b: 'k9', w: 1 }, { a: 'k5', b: 'k12', w: 0.5 }, { a: 'k1', b: 'k13', w: 1 }];
  const a = layoutRegions(es, { links });
  const b = layoutRegions([...es].reverse(), { links: [...links].reverse() });
  assert.deepEqual([...a.rects].sort(), [...b.rects].sort());
  const again = layoutRegions(es.map((e) => ({ ...e, rect: a.rects.get(e.key) })), { links });
  assert.ok(again.link.now <= a.link.now + 1e-9, `두 번째 연결 항 ${again.link.now} ≤ ${a.link.now}`);
  for (const l of links.slice(0, 2)) assert.ok(edge(again.rects.get(l.a), again.rects.get(l.b)) <= REGION_GAP + 1);
});

test('P99 성능: 워크스페이스 40개 판(연결 6쌍, 20쌍)의 CPU 계산 시간이 50ms 안', () => {
  const es = grid(40, 5);
  for (const np of [6, 20]) {
    const links = Array.from({ length: np }, (_, i) => ({ a: `k${i}`, b: `k${39 - i}`, w: 1 + (i % 3) }));
    layoutRegions(es, { links }); // 처음 한 번은 JIT 준비
    const ts = [], cpuTimes = [];
    let lay;
    // Other test processes and Electron may share the CPU. Measure this
    // calculation's CPU cost; retain wall time in diagnostics for comparison.
    for (let r = 0; r < 3; r++) {
      const cpu = process.cpuUsage(), t = performance.now();
      lay = layoutRegions(es, { links });
      const used = process.cpuUsage(cpu);
      cpuTimes.push((used.user + used.system) / 1000); ts.push(performance.now() - t);
    }
    assert.ok(Math.min(...cpuTimes) < 50, `${np}쌍 CPU: ${cpuTimes.map((t) => t.toFixed(1)).join(', ')}ms; wall: ${ts.map((t) => t.toFixed(1)).join(', ')}ms`);
    assert.ok(lay.link.now < lay.link.plain / 3, `${np}쌍 연결 항 ${lay.link.plain.toFixed(3)} → ${lay.link.now.toFixed(3)}`);
  }
});

test('P99 linkedOrder: 연결이 없으면 지금 순서, 사슬은 무게 큰 쌍부터', () => {
  const items = [{ w: 100, h: 100 }, { w: 100, h: 100 }, { w: 100, h: 100 }, { w: 100, h: 100 }];
  assert.deepEqual(linkedOrder(items, [], { gap: 10 }).order, [0, 1, 2, 3]);
  const r = linkedOrder(items, [{ i: 0, j: 3, w: 2 }], { gap: 10, aspect: 10 }); // 화면이 아주 넓으면 한 줄: 0과 3이 이웃이어야 한다
  const pos = r.order.indexOf(0), pos3 = r.order.indexOf(3);
  assert.equal(Math.abs(pos - pos3), 1, String(r.order));
});

// ---------- 판에 붙인 흐름 ----------
function board() {
  const b = new Backend({ quietMs: 600000, port: 0, logDir: tmp() });
  b.store = new Store(path.join(tmp(), 'board.db'));
  b.sessions = new Map();
  b.api = { broadcast: () => {} };
  b.log = () => {}; b.touch = () => {};
  const mk = (root, x, y) => { const key = root.toLowerCase(); b.store.insertWorkspace({ key, kind: 'folder', root, createdAt: 1 }); b.store.setWorkspaceAnchor(key, x, y); return key; };
  const add = (name, wsKey, rect, extra = {}) => {
    const s = { sessionId: 'id-' + name, name, kind: 'shell', workspaceKey: wsKey, cwd: wsKey, rt: newRuntime({ kind: 'shell', hooked: false }), origin: 'board', createdAt: Date.now(), ...extra };
    b.sessions.set(s.sessionId, s);
    b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    b.store.setNode({ session_id: s.sessionId, ...rect, z: 0 });
    return s;
  };
  return { b, mk, add };
}
test('P99 판: 다른 워크스페이스로 띄운 하위 세션·역할 선이 있으면 정리 뒤 그 영역들이 이웃, 되돌리기, 연결 없는 판은 고치기 전과 같다', () => {
  const { b, mk, add } = board();
  const ks = [];
  for (let i = 0; i < 9; i++) { const k = mk(`D:/t/ws${i}`, (i % 3) * 3000, Math.floor(i / 3) * 2000); ks.push(k); add(`s${i}`, k, R((i % 3) * 3000 + 40, Math.floor(i / 3) * 2000 + 112)); }
  const regionsNow = () => new Map([...ops.regions(b)]);
  const plainPreview = ops.arrange(b, { all: true, aspect: 16 / 9 });
  assert.equal(plainPreview.link.pairs, 0);
  // 연결 없는 판: 미리 보기가 P91 계산과 같다
  const want = oldLayout(plainPreview.regions.map((r) => ({ key: r.key, ws: r.key, rect: r.from })), 16 / 9);
  for (const r of plainPreview.regions) assert.deepEqual(r.to, want.get(r.key), r.key);
  // ws0의 s0이 ws8에 하위 세션을 띄웠고(부모), ws2 ↔ ws6은 사람이 이은 역할 선
  b.sessions.get('id-s8').parentSessionId = 'id-s0';
  b.store.insertLink({ linkId: 'l1', from: 'id-s2', to: 'id-s6', role: 'reviewer', createdAt: 1 });
  const r = ops.arrange(b, { all: true, apply: true, aspect: 16 / 9 });
  assert.equal(r.link.pairs, 2);
  const regs = regionsNow();
  assert.ok(edge(regs.get(ks[0]), regs.get(ks[8])) <= REGION_GAP + 1, `ws0 ↔ ws8 ${edge(regs.get(ks[0]), regs.get(ks[8]))}`);
  assert.ok(edge(regs.get(ks[2]), regs.get(ks[6])) <= REGION_GAP + 1, `ws2 ↔ ws6 ${edge(regs.get(ks[2]), regs.get(ks[6]))}`);
  // 두 번 눌러도 같다
  const p1 = JSON.stringify(b.store.nodes().map((n) => [n.session_id, n.x, n.y]));
  ops.arrange(b, { all: true, apply: true, aspect: 16 / 9 });
  assert.equal(JSON.stringify(b.store.nodes().map((n) => [n.session_id, n.x, n.y])), p1, '두 번 눌러도 같다');
  ops.arrange(b, { all: true, apply: true, aspect: 16 / 9 });
  ops.arrange(b, { all: true, undo: true });
  assert.equal(JSON.stringify(b.store.nodes().map((n) => [n.session_id, n.x, n.y])), p1, '되돌리기는 바로 앞 정리 전으로');
  // 닫힌 세션의 연결은 세지 않는다
  b.sessions.delete('id-s6');
  assert.deepEqual(ops.boardLinkWeights(b, ops.canvasItems(b), new Set(ks)).map((l) => l.w), [2], '부모 관계만 남는다');
});
