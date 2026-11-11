// P91 시험: 폴더 위계 묶음(ws-nest.mjs, ws-groups.mjs 저절로 만든 묶음), 묶음 테두리와 겹침 풀기(canvas.mjs),
// 화면 비율 판 전체 정리(region-layout.mjs), 영역 안 하위 세션 열 나누기(canvas.mjs arrangeTree), 판에 붙인 흐름(동기화, 이름표, 묶음째 옮기기, 정리)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NODE, overlaps, bbox, arrangeTree, groupFrames, separateGrouped, groupSlot, GROUP_PAD, REGION_GAP, SIZE_STEPS } from '../src/canvas.mjs';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { Backend } from '../src/backend.mjs';
import * as ops from '../src/canvas-ops.mjs';
import { layoutRegions, shelfBest } from '../src/region-layout.mjs';
import { nestClusters, syncAutoGroups, relLabel, groupLabel, commonDir, rootable, isInside } from '../src/ws-nest.mjs';
import { normalizeGroups, createGroup, renameGroup, removeGroup, moveWorkspace, dropWorkspaces, syncWsGroups, wsLabels, GROUPS_META } from '../src/ws-groups.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p91u-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });
const W = (root) => ({ key: root.toLowerCase(), root });
const projects = (...dirs) => (k) => dirs.map((d) => d.toLowerCase()).includes(k);
const HOME = 'E:/home/tester';

// ---------- 뿌리 찾기 ----------
test('P91 묶음: 안팎 폴더는 한 묶음, 뿌리는 바깥 폴더, 이름표는 바깥 폴더 위에서부터', () => {
  const ws = [W('D:/work/ms/browser'), W('D:/work/ms/browser/collector'), W('D:/work/ms/rea'), W('D:/work/other')];
  const cl = nestClusters(ws, { home: HOME });
  assert.equal(cl.length, 1, JSON.stringify(cl));
  assert.equal(cl[0].root, 'd:/work/ms/browser');
  assert.equal(cl[0].name, 'browser');
  assert.deepEqual(cl[0].members, ['d:/work/ms/browser', 'd:/work/ms/browser/collector']);
  const g = { root: cl[0].root };
  assert.equal(groupLabel(g, 'D:/work/ms/browser', ['D:/work/ms/browser/collector']), 'browser');
  assert.equal(groupLabel(g, 'D:/work/ms/browser/collector', ['D:/work/ms/browser']), 'browser/collector');
});

test('P91 묶음: 형제는 공통 조상이 프로젝트 폴더일 때만(표시가 있는 뿌리면 셋이 한 묶음, 상대 경로 이름표)', () => {
  const ws = [W('D:/work/ms/browser'), W('D:/work/ms/browser/collector'), W('D:/work/ms/rea'), W('D:/work/other')];
  const cl = nestClusters(ws, { home: HOME, isProject: projects('D:/work/ms') });
  assert.equal(cl.length, 1);
  assert.equal(cl[0].root, 'd:/work/ms');
  assert.equal(cl[0].name, 'ms');
  assert.deepEqual(cl[0].members, ['d:/work/ms/browser', 'd:/work/ms/browser/collector', 'd:/work/ms/rea']);
  const g = { root: cl[0].root };
  assert.deepEqual(ws.slice(0, 3).map((w) => groupLabel(g, w.root)), ['browser', 'browser/collector', 'rea']);
  assert.equal(relLabel('d:/work/ms', 'D:/Work/MS/Browser/Collector'), 'Browser/Collector', '이름표는 원래 글자');
});

test('P91 묶음: 표시 없는 모음 폴더, 드라이브 뿌리, 사용자 홈은 묶지 않는다', () => {
  assert.deepEqual(nestClusters([W('D:/workspace/a'), W('D:/workspace/b')], { home: HOME }), [], '모음 폴더(표시 없음)');
  assert.deepEqual(nestClusters([W('D:/a'), W('D:/b')], { home: HOME, isProject: () => true }), [], '드라이브 뿌리는 표시가 있어도 뿌리가 아니다');
  assert.deepEqual(nestClusters([W(`${HOME}/a`), W(`${HOME}/b`)], { home: HOME, isProject: () => true }), [], '홈은 뿌리가 아니다');
  assert.deepEqual(nestClusters([W(HOME), W(`${HOME}/proj`)], { home: HOME }), [], '홈 워크스페이스는 안의 것을 품지 않는다');
  assert.deepEqual(nestClusters([W('D:/'), W('D:/proj')], { home: HOME }), [], '드라이브 뿌리 워크스페이스도');
  assert.deepEqual(nestClusters([W('C:/x/a'), W('D:/x/a')], { home: HOME, isProject: () => true }), [], '드라이브가 다르면');
  assert.equal(commonDir(['c:/a/b', 'c:/a/c']), 'c:/a');
  assert.equal(commonDir(['c:/a', 'c:/b']), 'c:/');
  assert.equal(rootable('c:/', HOME), false);
  assert.equal(rootable('e:/home', HOME), false);
  assert.equal(isInside('c:/ab', 'c:/a'), false, '이름 앞부분만 같은 형제는 안이 아니다');
  // 저장소 워크스페이스(키는 .git)도 root로 본다
  const repo = { key: 'd:/w/app/.git', root: 'D:/w/app' };
  assert.equal(nestClusters([repo, W('D:/w/app/tools/sub')], { home: HOME })[0].members.length, 2);
});

// ---------- 저절로 만든 묶음 맞추기 ----------
const CL = [{ root: 'd:/w/ms', rootPath: 'D:/w/ms', name: 'ms', members: ['b', 'c', 'r'] }];
test('P91 맞추기: 새로 만들고, 다시 맞춰도 같다. 사람이 만든 그룹의 워크스페이스는 옮기지 않는다', () => {
  let s = syncAutoGroups(normalizeGroups(null), CL);
  assert.equal(s.groups.length, 1);
  assert.deepEqual({ ...s.groups[0] }, { id: 'g1', name: 'ms', members: ['b', 'c', 'r'], auto: true, root: 'd:/w/ms' });
  assert.deepEqual(syncAutoGroups(normalizeGroups(s), CL), normalizeGroups(s), '두 번 맞춰도 같다');
  // 사람이 만든 그룹에 r이 있으면 그대로 두고 b, c만
  let h = createGroup(normalizeGroups(null), 'Mine'); h = moveWorkspace(h, 'r', h.created);
  const t = syncAutoGroups(normalizeGroups(h), CL);
  assert.deepEqual(t.groups.find((g) => g.name === 'Mine').members, ['r']);
  assert.deepEqual(t.groups.find((g) => g.auto).members, ['b', 'c']);
  // 사람이 만든 그룹에 둘이 들면 남는 것이 하나라 묶음을 만들지 않는다
  let h2 = createGroup(normalizeGroups(null), 'Mine'); h2 = moveWorkspace(moveWorkspace(h2, 'r', h2.created), 'b', h2.created);
  assert.equal(syncAutoGroups(normalizeGroups(h2), CL).groups.filter((g) => g.auto).length, 0);
});

test('P91 맞추기: 사람이 뺀 것은 다시 넣지 않고, 지운 묶음은 다시 만들지 않고, 바꾼 이름은 덮지 않는다', () => {
  let s = normalizeGroups(syncAutoGroups(normalizeGroups(null), CL));
  const id = s.groups[0].id;
  // 빼기
  s = moveWorkspace(s, 'r', null);
  assert.deepEqual(s.excluded, [{ root: 'd:/w/ms', ws: 'r' }]);
  s = normalizeGroups(syncAutoGroups(normalizeGroups(s), CL));
  assert.deepEqual(s.groups[0].members, ['b', 'c'], '뺀 r은 다시 들지 않는다');
  // 다시 사람이 넣으면 기억을 지운다
  s = moveWorkspace(s, 'r', id);
  assert.equal(s.excluded, undefined);
  assert.deepEqual(normalizeGroups(syncAutoGroups(s, CL)).groups[0].members, ['b', 'c', 'r']);
  // 다른 사람 그룹으로 옮겨도 뺀 것이다
  // 이름 바꾸기
  s = renameGroup(s, id, 'Renamed');
  assert.equal(s.groups[0].named, true);
  s = normalizeGroups(syncAutoGroups(normalizeGroups(s), [{ ...CL[0], name: 'ms' }]));
  assert.equal(s.groups[0].name, 'Renamed', '바꾼 이름 그대로');
  // 지우기
  s = removeGroup(s, id);
  assert.deepEqual(s.dismissed, ['d:/w/ms']);
  s = normalizeGroups(syncAutoGroups(normalizeGroups(s), CL));
  assert.equal(s.groups.length, 0, '지운 묶음은 다시 만들지 않는다');
  // 기억은 저장·읽기를 거쳐도 남는다(판에 없는 워크스페이스 키도)
  const back = normalizeGroups(JSON.parse(JSON.stringify(s)), ['b']);
  assert.deepEqual(back.dismissed, ['d:/w/ms']);
});

test('P91 맞추기: 뿌리가 넓어지면 같은 묶음이 넓어지고, 구성이 하나가 되면 지운다(사람이 지운 것이 아니라 다시 만들 수 있다)', () => {
  let s = normalizeGroups(syncAutoGroups(normalizeGroups(null), [{ root: 'd:/w/ms/b', name: 'b', members: ['b', 'c'] }]));
  assert.equal(s.groups[0].name, 'b');
  s = normalizeGroups(syncAutoGroups(s, CL));
  assert.equal(s.groups.length, 1);
  assert.deepEqual(s.groups[0], { id: 'g1', name: 'ms', members: ['b', 'c', 'r'], auto: true, root: 'd:/w/ms' });
  s = normalizeGroups(dropWorkspaces(s, ['c', 'r']));
  s = normalizeGroups(syncAutoGroups(s, []));
  assert.equal(s.groups.length, 0);
  assert.equal(s.dismissed, undefined);
  assert.equal(normalizeGroups(syncAutoGroups(s, CL)).groups.length, 1, '다시 열면 다시 만든다');
  // 이름이 겹치면 꼬리를 단다
  const t = createGroup(normalizeGroups(null), 'MS');
  assert.equal(normalizeGroups(syncAutoGroups(normalizeGroups(t), CL)).groups.find((g) => g.auto).name, 'ms 2');
});

// ---------- 테두리와 겹침 풀기 ----------
test('P91 테두리: 구성 영역을 감싸고, 구성 아닌 영역과 겹치면 그리지 않는다. 겹침 풀기는 묶음째 민다', () => {
  const regs = new Map([['a', R(0, 0, 1000, 600)], ['b', R(1240, 0, 1000, 600)], ['x', R(0, 900, 1000, 600)]]);
  const f = groupFrames([{ id: 'g1', name: 'G', members: ['a', 'b'] }], regs);
  assert.equal(f.length, 1);
  assert.ok(f[0].ok);
  for (const k of ['a', 'b']) { const r = regs.get(k); assert.ok(r.x >= f[0].rect.x + GROUP_PAD && r.x + r.w <= f[0].rect.x + f[0].rect.w - GROUP_PAD); }
  assert.ok(!overlaps(f[0].rect, regs.get('x'), -1));
  // 사이에 다른 영역이 끼면 그리지 않는다
  const mid = new Map([...regs, ['m', R(1100, 100, 100, 100)]]);
  assert.equal(groupFrames([{ id: 'g1', name: 'G', members: ['a', 'b'] }], mid)[0].ok, false);
  // 하나뿐인 묶음은 그리지 않는다
  assert.equal(groupFrames([{ id: 'g1', name: 'G', members: ['a'] }], regs).length, 0);
  // 겹침 풀기: x가 묶음 테두리 띠에 걸치면 묶음이 통째로 움직이고, 구성 영역끼리의 상대 자리는 그대로
  const crowd = new Map([['x', R(0, 0, 1000, 600)], ['a', R(200, 640, 1000, 600)], ['b', R(1440, 640, 1000, 600)]]);
  assert.equal(groupFrames([{ id: 'g1', name: 'G', members: ['a', 'b'] }], crowd)[0].ok, false, '띠에 걸치면 아직 그리지 않는다');
  const sh = separateGrouped(crowd, [{ id: 'g1', name: 'G', members: ['a', 'b'] }]);
  const moved = new Map([...crowd].map(([k, r]) => { const s = sh.get(k) || { dx: 0, dy: 0 }; return [k, { ...r, x: r.x + s.dx, y: r.y + s.dy }]; }));
  const fr = groupFrames([{ id: 'g1', name: 'G', members: ['a', 'b'] }], moved)[0];
  assert.ok(fr.ok, JSON.stringify([...moved]));
  assert.ok(!overlaps(fr.rect, moved.get('x'), REGION_GAP / 2 - 1), '테두리와 다른 영역 사이도 띄운다');
  assert.equal(moved.get('b').x - moved.get('a').x, 1240, '구성 영역끼리의 상대 자리 그대로');
  // 새 구성 영역 자리: 묶음 곁, 테두리가 다른 영역과 붙지 않게
  const at = groupSlot([regs.get('a'), regs.get('b')], [regs.get('x')], { w: 800, h: 320 });
  const nr = { ...at, w: 800, h: 320 };
  assert.ok(![regs.get('a'), regs.get('b')].some((r) => overlaps(nr, r, REGION_GAP - 1)));
  assert.ok(!overlaps(groupFrames([{ id: 'g', members: ['a', 'b', 'n'] }], new Map([...regs, ['n', nr]]))[0].rect, regs.get('x'), REGION_GAP / 2 - 1));
});

// ---------- 화면 비율 정리 ----------
// 크기 섞인 영역 n개(결정적인 의사 난수)
function mixed(n, seed = 7) {
  let r = seed;
  const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
  const sizes = [[1520, 962], [3240, 5392], [1520, 1852], [4400, 2000], [800, 320], [2600, 1300], [1100, 2600]];
  return Array.from({ length: n }, (_, i) => { const [w, h] = sizes[Math.floor(rnd() * sizes.length)]; return { key: `k${i}`, ws: `k${i}`, rect: { x: Math.round(rnd() * 20000), y: Math.round(rnd() * 20000), w, h } }; });
}
const allOf = (rects) => bbox([...rects.values()]);
test('P91 정리: 영역 1~12개(크기 섞임)의 결과 비율이 화면 비율 근처, 겹침 없음, 읽는 순서, 두 번 눌러도 같음', () => {
  for (const aspect of [16 / 9, 4 / 3, 0.6]) {
    const errs = [];
    for (let n = 1; n <= 12; n++) {
      const es = mixed(n, n * 13 + 1);
      const lay = layoutRegions(es, { aspect });
      const all = allOf(lay.rects);
      const ratio = all.w / all.h;
      const ks = [...lay.rects.keys()];
      for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) assert.ok(!overlaps(lay.rects.get(ks[i]), lay.rects.get(ks[j]), REGION_GAP - 1), `n=${n} ${ks[i]}|${ks[j]}`);
      // 읽는 순서: 원래 순서(위 → 아래, 왼쪽 → 오른쪽)대로 놓인 차례(줄 → 줄 안 왼쪽부터)
      const before = [...es].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x).map((e) => e.key);
      const after = lay.groups.map((g) => g.keys[0]);
      assert.deepEqual(after, before, `n=${n} 읽는 순서`);
      const again = layoutRegions(es.map((e) => ({ ...e, rect: lay.rects.get(e.key) })), { aspect });
      assert.equal(again.shifts.size, 0, `n=${n} 두 번째 정리는 옮기지 않는다`);
      if (n >= 3) errs.push(Math.abs(Math.log(ratio / aspect)));
    }
    const mean = errs.reduce((a, x) => a + x, 0) / errs.length;
    assert.ok(mean < Math.log(1.35), `aspect ${aspect.toFixed(2)}: 평균 비율 차이 ${Math.exp(mean).toFixed(2)}배`);
    assert.ok(Math.max(...errs) < Math.log(2.2), `aspect ${aspect.toFixed(2)}: 가장 먼 것 ${Math.exp(Math.max(...errs)).toFixed(2)}배`);
  }
});

test('P91 정리: 넓은 영역 몇 개(사용자 그림)는 세로로 쌓지 않고 화면 비율로, 고치기 전(줄 너비 하나)보다 화면 비율에 가깝다', () => {
  // 고치기 전 창 시험의 판: 영역 다섯(1520×962 셋, 1520×1852, 3240×5392)
  const es = [['browser', 0, 0, 1520, 962], ['rea', 2000, 0, 1520, 962], ['alpha', 4000, 0, 3240, 5392], ['beta', 0, 6000, 1520, 1852], ['collector', 2000, 6000, 1520, 962]].map(([k, x, y, w, h]) => ({ key: k, ws: k, rect: { x, y, w, h } }));
  const lay = layoutRegions(es, { aspect: 16 / 9 });
  const all = allOf(lay.rects);
  assert.ok(Math.abs(Math.log(all.w / all.h / (16 / 9))) < Math.log(1.3), `비율 ${(all.w / all.h).toFixed(2)}`);
  // 같은 판을 세로 화면(9:16)에 맞추면 세로로 길다
  const tall = allOf(layoutRegions(es, { aspect: 9 / 16 }).rects);
  assert.ok(tall.w / tall.h < 1, `세로 화면 ${(tall.w / tall.h).toFixed(2)}`);
  // 같은 크기 셋: 한 줄(가로로 너무 김)도 한 열도 아니다
  const three = shelfBest([{ w: 1600, h: 900 }, { w: 1600, h: 900 }, { w: 1600, h: 900 }], { gap: 240, aspect: 16 / 9 });
  assert.ok(three.w / three.h > 1 && three.w / three.h < 3, JSON.stringify(three));
});

test('P91 정리: 가상 그룹 덩어리는 테두리 자리를 두고 놓고, 테두리가 다른 영역과 겹치지 않는다', () => {
  const es = [...mixed(6, 3).map((e, i) => ({ ...e, ...(i < 3 ? { group: 'g1', order: i } : {}) }))];
  const lay = layoutRegions(es, { aspect: 16 / 9 });
  const regs = new Map([...lay.rects]);
  const f = groupFrames([{ id: 'g1', members: ['k0', 'k1', 'k2'] }], regs)[0];
  assert.ok(f.ok, '테두리가 구성 아닌 영역과 겹치지 않는다');
  const c = lay.clusters[0];
  assert.ok(f.rect.x >= c.rect.x - 1 && f.rect.y >= c.rect.y - 1 && f.rect.x + f.rect.w <= c.rect.x + c.rect.w + 1 && f.rect.y + f.rect.h <= c.rect.y + c.rect.h + 1, '테두리는 덩어리 자리 안');
  for (const k of ['k3', 'k4', 'k5']) assert.ok(!overlaps(regs.get(k), f.rect, REGION_GAP - 1), k);
});

// ---------- 영역 안 열 나누기 ----------
test('P91 영역 안: 하위 세션이 다섯부터 다음 열을 오른쪽에 연다(띄운 순서 위 → 아래, 다음 열). 넷까지는 한 열', () => {
  const run = (n) => {
    const blocks = [{ id: 'L', x: 0, y: 0, w: 1440, h: 810, members: ['L'], resizable: true }, ...Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}`, x: 3000, y: i * 900, w: 1440, h: 810, members: [`w${i + 1}`], resizable: true }))];
    const edges = blocks.slice(1).map((x) => ['L', x.id]);
    const rank = new Map(blocks.map((x, i) => [x.id, i]));
    return arrangeTree(blocks, edges, { rank });
  };
  for (const n of [1, 2, 3, 4]) { const out = run(n); assert.equal(new Set([...out].filter(([k]) => k !== 'L').map(([, r]) => r.x)).size, 1, `${n}개는 한 열`); }
  for (const n of [5, 8, 12]) {
    const out = run(n);
    const ws = Array.from({ length: n }, (_, i) => out.get(`w${i + 1}`));
    const cols = [...new Set(ws.map((r) => r.x))];
    assert.ok(cols.length >= 2, `${n}개는 두 열 이상 ${cols}`);
    for (let i = 1; i < n; i++) { const a = ws[i - 1], b = ws[i]; assert.ok((b.x === a.x && b.y > a.y + a.h) || b.x > a.x + a.w, `${n}개 띄운 순서 w${i + 1}`); }
    const L = out.get('L');
    assert.ok(ws.every((r) => r.x >= L.x + L.w + 200), '열은 부모 오른쪽');
    const all = bbox([...out.values()]);
    assert.ok(all.w / all.h > 1.2, `${n}개 영역 비율 ${(all.w / all.h).toFixed(2)}`);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(!overlaps(ws[i], ws[j], -1));
  }
  // 정리의 크기 단계(부모 크게, 하위 작게)에서 몇 개부터 여는지
  const sized = (n) => { const out = arrangeTree([{ id: 'L', x: 0, y: 0, w: 1440, h: 810, members: ['L'], resizable: true }, ...Array.from({ length: n }, (_, i) => ({ id: `w${i}`, x: 0, y: 0, w: 1440, h: 810, members: [`w${i}`], resizable: true }))], Array.from({ length: n }, (_, i) => ['L', `w${i}`])); return new Set([...out].filter(([k]) => k !== 'L').map(([, r]) => r.x)).size; };
  assert.deepEqual([3, 4, 5, 8].map(sized), [1, 1, 2, 2], `크게 ${SIZE_STEPS.large.w} · 작게 ${SIZE_STEPS.small.w}`);
});

// ---------- 판에 붙인 흐름 ----------
function board() {
  const b = new Backend({ quietMs: 600000, port: 0, logDir: tmp() });
  b.store = new Store(path.join(tmp(), 'board.db'));
  b.sessions = new Map();
  const sent = [];
  b.api = { broadcast: (ev, d) => sent.push([ev, d]) };
  b.log = () => {}; b.touch = () => {};
  const mk = (root, x, y) => { const key = root.toLowerCase(); b.store.insertWorkspace({ key, kind: 'folder', root, createdAt: 1 }); b.store.setWorkspaceAnchor(key, x, y); return key; };
  const add = (name, wsKey, rect, kind = 'shell') => {
    const s = { sessionId: 'id-' + name, name, kind, workspaceKey: wsKey, cwd: wsKey, rt: newRuntime({ kind, hooked: false }), origin: 'board', createdAt: Date.now() };
    b.sessions.set(s.sessionId, s);
    b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    b.store.setNode({ session_id: s.sessionId, ...rect, z: 0 });
    return s;
  };
  return { b, mk, add, sent };
}

test('P91 판: 동기화가 묶음을 만들고 이름표를 붙인다, 사람 API가 이긴다, 묶음째 옮기기, 정리는 비율과 테두리를 지킨다', async () => {
  const { b, mk, add } = board();
  const kB = mk('D:/w/ms/browser', 0, 0), kC = mk('D:/w/ms/browser/collector', 0, 4000), kR = mk('D:/w/ms/rea', 6000, 0), kO = mk('D:/w/other', 0, 8000);
  add('s2', kB, R(40, 112)); add('scraper', kC, R(40, 4112)); add('head', kR, R(6040, 112)); add('o1', kO, R(40, 8112));
  const noMark = { isProject: () => false, home: HOME };
  assert.equal(syncWsGroups(b, 't', noMark), true);
  assert.equal(syncWsGroups(b, 't', noMark), false, '두 번째는 바뀐 것 없음');
  let gs = b.handlers()['group.list']();
  assert.deepEqual(gs.groups.map((g) => [g.name, g.members, g.auto]), [['browser', [kB, kC], true]]);
  const labels = Object.fromEntries(b.workspaceList().map((w) => [w.key, w.label || null]));
  assert.deepEqual(labels, { [kB]: 'browser', [kC]: 'browser/collector', [kR]: null, [kO]: null });
  // 뿌리 표시가 생기면 rea도 든다
  const mark = { isProject: (k) => k === 'd:/w/ms', home: HOME };
  syncWsGroups(b, 't', mark);
  gs = b.handlers()['group.list']();
  assert.deepEqual(gs.groups.map((g) => [g.name, g.members]), [['ms', [kB, kC, kR]]]);
  assert.deepEqual(Object.fromEntries(b.workspaceList().map((w) => [w.key, w.label || null]))[kR], 'rea');
  // 판 전체 정리: 결과 비율, 테두리, 두 번 같음, 되돌리기
  const place = () => JSON.stringify(b.store.nodes().map((n) => [n.session_id, n.x, n.y, n.w, n.h]));
  const before = place();
  const r1 = ops.arrange(b, { all: true, apply: true, aspect: 16 / 9 });
  assert.equal(r1.aspect, 16 / 9);
  const top = new Map([...ops.regions(b)]);
  const f = groupFrames(gs.groups, top)[0];
  assert.ok(f && f.ok, '정리 뒤 묶음 테두리가 그려진다');
  const p1 = place();
  ops.arrange(b, { all: true, undo: true });
  assert.equal(place(), before, '한 번 되돌리기');
  ops.arrange(b, { all: true, apply: true, aspect: 16 / 9 });
  assert.equal(place(), p1);
  ops.arrange(b, { all: true, apply: true, aspect: 16 / 9 });
  assert.equal(place(), p1, '두 번 눌러도 같다');
  assert.equal(ops.arrangeAspect('x'), 16 / 9);
  assert.equal(ops.arrangeAspect(100), 16 / 9);
  // 묶음째 옮기기
  const nodes0 = new Map(b.store.nodes().map((n) => [n.session_id, n]));
  const out = ops.groupShift(b, { group: gs.groups[0].id, dx: -300, dy: -4000 });
  assert.equal(out.workspaces, 3);
  for (const n of b.store.nodes()) {
    const o = nodes0.get(n.session_id);
    if (n.session_id === 'id-o1') assert.deepEqual([n.x, n.y], [o.x, o.y]);
    else assert.deepEqual([n.x - o.x, n.y - o.y], [-300, -4000]);
  }
  // 다른 영역 위로 끌면 거부
  const o1 = ops.regions(b).get(kO), fb = ops.regions(b).get(kB);
  assert.throws(() => ops.groupShift(b, { group: gs.groups[0].id, dx: o1.x - fb.x, dy: o1.y - fb.y }), (e) => e.code === 'overlap');
  // 사람 API: 빼기 → 다시 맞춰도 빠진 채
  const h = b.handlers();
  await h['group.move']({ workspace: kR, group: null });
  syncWsGroups(b, 't', mark);
  assert.deepEqual(h['group.list']().groups[0].members, [kB, kC]);
  // 겹침 풀기는 묶음을 한 덩어리로: o1 영역을 묶음 테두리 안으로 넣으면 묶음 아닌 것이 밀리거나 묶음째 밀린다
  const fr = groupFrames(h['group.list']().groups, ops.regions(b))[0];
  const on = b.store.nodes().find((n) => n.session_id === 'id-o1');
  b.store.setNode({ ...on, x: fr.rect.x + fr.rect.w - 200, y: fr.rect.y + 400 });
  ops.settleRegions(b, 't');
  const regs = ops.regions(b);
  const fr2 = groupFrames(h['group.list']().groups, regs)[0];
  assert.ok(fr2.ok && !overlaps(fr2.rect, regs.get(kO), -1), '겹침 풀기 뒤 테두리와 다른 영역이 겹치지 않는다');
  // 지우기 → 다시 만들지 않는다
  await h['group.remove']({ group: gs.groups[0].id });
  syncWsGroups(b, 't', mark);
  assert.equal(h['group.list']().groups.length, 0);
  assert.deepEqual(normalizeGroups(b.store.getMeta(GROUPS_META)).dismissed, ['d:/w/ms']);
  assert.deepEqual(wsLabels({ groups: [] }, []), new Map());
});

test('P91 판: 묶음에 새로 든 빈 워크스페이스는 묶음 곁에 놓인다', () => {
  const { b, mk, add } = board();
  const kB = mk('D:/w/ms/browser', 0, 0), kO = mk('D:/w/other', 3000, 0);
  add('s2', kB, R(40, 112)); add('o1', kO, R(3040, 112));
  // 새 워크스페이스(collector, browser 안): 묶음을 맞춘 뒤 자리를 정한다(ensureWorkspace와 같은 순서)
  const key = 'd:/w/ms/browser/collector';
  b.store.insertWorkspace({ key, kind: 'folder', root: 'D:/w/ms/browser/collector', createdAt: 2 });
  syncWsGroups(b, 'created', { isProject: () => false, home: HOME });
  ops.anchorWorkspace(b, key);
  const regs = ops.regions(b);
  const f = groupFrames(b.handlers()['group.list']().groups, regs)[0];
  assert.ok(f && f.ok, JSON.stringify([...regs]));
  assert.ok(!overlaps(f.rect, regs.get(kO), -1));
});
