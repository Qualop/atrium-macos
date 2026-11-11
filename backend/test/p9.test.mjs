// P9 시험: 영역 겹침(H1) — 재현, 원인(겹친 판에서 한 줄로 아래로 쌓임), 대체 경로, 겹침 풀기, 다시 열기의 마지막 자리, 하위 세션 열
// 그리고 실제 판 실행 도구(app/scripts/real.mjs)의 시험 판 막기
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { NODE, GAP, REGION_GAP, SIZE_STEPS, overlaps, bbox, regionsOf, slotInRegion, separateRegions } from '../src/canvas.mjs';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { Backend } from '../src/backend.mjs';
import * as ops from '../src/canvas-ops.mjs';
import { Recall } from '../src/recall.mjs';
import { LINE_GAP_Y } from '../src/tree-line.mjs';
import { childSlot, Branch } from '../src/branch.mjs';
import { pathKey, normPath } from '../src/workspaces.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p9-'));
const R = (x, y, w = NODE.w, h = NODE.h) => ({ x, y, w, h });
const pairs = (regs) => { const l = [...regs]; const out = []; for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (overlaps(l[i][1], l[j][1], -1)) out.push(`${l[i][0]}|${l[j][0]}`); return out; };

// 순수 함수로 판 하나를 굴린다: wsKey에 노드 n개를 놓고, 놓을 때마다 겹침 풀기를 적용한다(settle = true면 백엔드와 같다)
function place(items, ws, wsKey, n, { settle = false } = {}) {
  for (let i = 0; i < n; i++) {
    const at = slotInRegion({ wsKey, items, regions: regionsOf(ws, items) });
    const c = { ws: wsKey, id: `${wsKey}-n${i}`, ...R(at.x, at.y) };
    assert.ok(!items.some((x) => overlaps(c, x, GAP - 1)), `노드끼리 겹치지 않는다 ${JSON.stringify(at)}`);
    items.push(c);
    if (settle) for (const [k, d] of separateRegions(regionsOf(ws, items))) for (const it of items) if (it.ws === k) { it.x += d.dx; it.y += d.dy; }
  }
  return items;
}

test('P9 영역 겹침 재현: 이미 겹친 판에서 새 노드가 같은 x로 아래로 쌓이지 않는다(원인: 겹친 영역이 모든 후보를 거부)', () => {
  const ws = [{ key: 'a' }, { key: 'b' }];
  // a의 노드 하나가 b 영역 안에 있다(닫힌 동안 b가 그 자리로 온 뒤 다시 열린 노드)
  const items = place([{ ws: 'a', id: 'a1', ...R(0, 0) }, { ws: 'b', id: 'b1', ...R(1200, 0) }, { ws: 'a', id: 'a2', ...R(1200, 600) }], ws, 'a', 6);
  const added = items.filter((x) => x.id.startsWith('a-n'));
  assert.ok(new Set(added.map((x) => x.x)).size > 1, `한 열에 쌓지 않는다 ${JSON.stringify(added.map((x) => [x.x, x.y]))}`);
  const own = bbox(items.filter((x) => x.ws === 'a'));
  assert.ok(own.h <= 4 * (NODE.h + GAP), `영역이 아래로 길어지지 않는다 h=${own.h}`);
  // 겹침은 separateRegions가 푼다
  const shifts = separateRegions(regionsOf(ws, items));
  for (const [k, d] of shifts) for (const it of items) if (it.ws === k) { it.x += d.dx; it.y += d.dy; }
  assert.deepEqual(pairs(regionsOf(ws, items)), []);
});

test('P9: 여러 워크스페이스에 노드를 번갈아 많이 놓아도 영역이 겹치지 않고 좁고 긴 줄이 되지 않는다', () => {
  const ws = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  // 사람이 영역을 서로 바로 옆에 둔 판(a 오른쪽에 b, a 아래에 c, 틈 0)
  const items = [{ ws: 'a', id: 'a0', ...R(0, 0) }, { ws: 'b', id: 'b0', ...R(NODE.w + 80, 0) }, { ws: 'c', id: 'c0', ...R(0, NODE.h + 80 + 72) }];
  for (let round = 0; round < 6; round++) for (const k of ['a', 'b', 'c']) place(items, ws, k, 1, { settle: true });
  assert.deepEqual(pairs(regionsOf(ws, items)), []);
  for (const k of ['a', 'b', 'c']) {
    const own = bbox(items.filter((x) => x.ws === k));
    assert.ok(own.h / own.w < 3 && own.w / own.h < 4, `${k}: 좁고 긴 줄이 아니다 ${own.w}×${own.h}`);
  }
});

test('P9: 고리 안에 자리가 없으면 자기 영역 오른쪽 열(영역 높이 안에서 위부터)로 자란다', () => {
  // a(노드 둘, 세로로)를 사방에서 바짝 둘러싼 판: 어느 후보도 영역 겹침 없이 놓을 수 없다
  const a = [{ ws: 'a', id: 'a1', ...R(0, 0) }, { ws: 'a', id: 'a2', ...R(0, NODE.h + GAP) }];
  const reg = regionsOf([{ key: 'a' }], a).get('a');
  // 다른 영역은 사방에 맞닿아 있다(영역만 준다. 안의 노드는 멀리 있어 자리를 막지 않는다)
  const walls = [['L', R(reg.x - 20000, reg.y - 20000, 20000, 60000)], ['Rt', R(reg.x + reg.w, reg.y - 20000, 20000, 60000)], ['T', R(reg.x, reg.y - 20000, reg.w, 20000)], ['B', R(reg.x, reg.y + reg.h, reg.w, 20000)]];
  const items = [...a];
  const regions = () => new Map([...regionsOf([{ key: 'a' }], items), ...walls]);
  const at = slotInRegion({ wsKey: 'a', items, regions: regions() });
  assert.deepEqual(at, { x: NODE.w + GAP, y: 0 }, '오른쪽 열의 맨 위');
  items.push({ ws: 'a', id: 'a3', ...R(at.x, at.y) });
  const at2 = slotInRegion({ wsKey: 'a', items, regions: regions() });
  assert.deepEqual(at2, { x: NODE.w + GAP, y: NODE.h + GAP }, '그 열의 다음 칸(영역 높이 안)');
  items.push({ ws: 'a', id: 'a4', ...R(at2.x, at2.y) });
  const at3 = slotInRegion({ wsKey: 'a', items, regions: regions() });
  assert.deepEqual(at3, { x: 2 * (NODE.w + GAP), y: 0 }, '열이 차면 한 열 더 오른쪽(아래로 늘이지 않는다)');
});

test('P9: 겹침 풀기 — 오른쪽·아래에 있는 영역을 덜 옮기는 쪽으로 밀고, 맞닿음은 그대로, 상대 자리를 지킨다', () => {
  const gap = REGION_GAP / 2;
  assert.equal(separateRegions(new Map([['a', R(0, 0, 800, 600)], ['b', R(800, 0, 800, 600)]])).size, 0, '맞닿음은 겹침이 아니다');
  // b가 a 오른쪽을 100 덮었다 → 오른쪽으로 100 + gap
  let s = separateRegions(new Map([['a', R(0, 0, 800, 600)], ['b', R(700, 50, 800, 600)]]));
  assert.deepEqual([...s], [['b', { dx: 100 + gap, dy: 0 }]]);
  // c가 a 아래를 50 덮었다(오른쪽으로 밀면 800) → 아래로 50 + gap
  s = separateRegions(new Map([['a', R(0, 0, 800, 600)], ['c', R(100, 550, 800, 600)]]));
  assert.deepEqual([...s], [['c', { dx: 0, dy: 50 + gap }]]);
  // 사슬: b를 밀면 b 오른쪽에 맞닿아 있던 d도 밀린다. 좌우 순서는 그대로
  const regs = new Map([['a', R(0, 0, 800, 600)], ['b', R(700, 0, 800, 600)], ['d', R(1500, 0, 800, 600)]]);
  s = separateRegions(regs);
  const after = new Map([...regs].map(([k, r]) => [k, { ...r, x: r.x + ((s.get(k) || {}).dx || 0), y: r.y + ((s.get(k) || {}).dy || 0) }]));
  assert.deepEqual(pairs(after), []);
  assert.ok(after.get('a').x < after.get('b').x && after.get('b').x < after.get('d').x);
  assert.equal(s.has('a'), false, '맨 왼쪽 위 영역은 그대로');
  // 무작위 판: 늘 겹침이 풀리고, 오른쪽·아래로만 민다
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let t = 0; t < 200; t++) {
    const m = new Map();
    const n = 2 + Math.floor(rnd() * 7);
    for (let i = 0; i < n; i++) m.set(`w${i}`, R(Math.round(rnd() * 3000), Math.round(rnd() * 2000), 400 + Math.round(rnd() * 1600), 300 + Math.round(rnd() * 1500)));
    const sh = separateRegions(m);
    for (const d of sh.values()) assert.ok(d.dx >= 0 && d.dy >= 0);
    const moved = new Map([...m].map(([k, r]) => { const d = sh.get(k) || { dx: 0, dy: 0 }; return [k, { ...r, x: r.x + d.dx, y: r.y + d.dy }]; }));
    assert.deepEqual(pairs(moved), [], `판 ${t}`);
  }
});

// ---------- 백엔드: 겹침 풀기 적용(뜰 때, 놓은 뒤) ----------
function fakeBackend() {
  const b = new Backend({ quietMs: 600000, port: 0, logDir: tmp() });
  b.store = new Store(path.join(tmp(), 'board.db'));
  b.sessions = new Map();
  const events = [];
  b.api = { broadcast: (event, data) => events.push({ event, data }) };
  b.log = () => {}; b.touch = () => {};
  b.events = events;
  const add = (name, ws, rect) => {
    const s = { sessionId: 'id-' + name, name, kind: 'claude', workspaceKey: ws, cwd: `C:/${ws}`, rt: newRuntime({ kind: 'claude', hooked: true }), origin: 'board', createdAt: Date.now() };
    b.sessions.set(s.sessionId, s);
    b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    if (rect) b.store.setNode({ session_id: s.sessionId, ...rect, z: 0 });
    return s;
  };
  for (const [i, key] of ['ws-a', 'ws-b', 'ws-c'].entries()) b.store.insertWorkspace({ key, kind: 'folder', root: `C:/${key}`, createdAt: i + 1 });
  return { b, add };
}
const rectOf = (b, name) => { const n = b.store.nodes().find((x) => x.session_id === 'id-' + name); return n && { x: n.x, y: n.y }; };

test('P9: 이미 겹친 판은 settleRegions로 편다 — 영역째(노드, 메모) 옮기고 안의 상대 자리는 그대로, 두 번째는 아무것도 하지 않는다', () => {
  const { b, add } = fakeBackend();
  // P7 스크린숏의 모양: a는 위에서 아래로 긴 한 줄, b는 a 오른쪽 위를 덮고, c는 a 아래쪽을 덮는다
  for (let i = 0; i < 5; i++) add(`a${i}`, 'ws-a', R(0, i * 500));
  add('b0', 'ws-b', R(400, -200)); add('b1', 'ws-b', R(1160, -200));
  add('c0', 'ws-c', R(300, 1800));
  b.store.insertMemo({ memoId: 'mb', workspaceKey: 'ws-b', x: 400, y: 300, w: 360, h: 240, text: 'm', createdAt: 1 });
  b.store.setWorkspaceAnchor('ws-b', 0, 0);
  assert.ok(pairs(ops.regions(b)).length >= 2, '처음에는 겹친다');
  const before = Object.fromEntries(['a0', 'a4', 'b0', 'b1', 'c0'].map((n) => [n, rectOf(b, n)]));
  const moved = ops.settleRegions(b, 'start');
  assert.deepEqual(pairs(ops.regions(b)), [], '편 뒤에는 겹치지 않는다');
  assert.ok(!moved.some((m) => m.key === 'ws-a'), '맨 왼쪽 위 영역(a)은 그대로');
  const d = (n) => ({ dx: rectOf(b, n).x - before[n].x, dy: rectOf(b, n).y - before[n].y });
  assert.deepEqual(d('a0'), { dx: 0, dy: 0 });
  assert.deepEqual(d('b0'), d('b1'), 'b 안의 상대 자리는 그대로');
  const mb = moved.find((m) => m.key === 'ws-b');
  assert.equal(b.store.getMemo('mb').x, 400 + mb.dx, '메모도 함께');
  assert.equal(b.store.getWorkspace('ws-b').x, mb.dx, '영역 자리도 함께');
  assert.ok(rectOf(b, 'b0').x > before.b0.x || rectOf(b, 'b0').y > before.b0.y);
  assert.ok(b.store.events({}).some((e) => e.kind === 'regions_settled' && e.data.cause === 'start'));
  assert.ok(b.events.some((e) => e.event === 'board.changed'));
  assert.deepEqual(ops.settleRegions(b, 'again'), [], '두 번 돌려도 같다');
});

test('P9: 새 세션 자리(slotFor)와 크기 키우기 — 놓은 뒤 겹치면 옆 영역을 밀고, 노드는 한 줄로 쌓이지 않는다', () => {
  const { b, add } = fakeBackend();
  add('a0', 'ws-a', R(0, 0));
  add('b0', 'ws-b', R(NODE.w + 80, 0)); // a 바로 오른쪽(틈 0)
  add('c0', 'ws-c', R(0, NODE.h + 80 + 72)); // a 바로 아래(틈 0)
  for (let i = 1; i <= 8; i++) {
    const at = ops.slotFor(b, { wsKey: 'ws-a' });
    add(`a${i}`, 'ws-a', { ...at, w: NODE.w, h: NODE.h });
    ops.settleRegions(b, 'spawn');
    assert.deepEqual(pairs(ops.regions(b)), [], `노드 ${i}`);
  }
  const own = bbox(b.store.nodes().filter((n) => n.session_id.startsWith('id-a')));
  assert.ok(own.h / own.w < 3 && own.w / own.h < 4, `a 영역이 좁고 길지 않다 ${own.w}×${own.h}`);
  // 크기 단계로 키워 옆 영역에 닿아도 편다
  ops.setSize(b, { session: 'b0', size: 'large' });
  assert.deepEqual(pairs(ops.regions(b)), []);
});

// ---------- 다시 열기(J2): 마지막 자리가 다른 영역과 겹치게 하면 쓰지 않는다 ----------
function recallBackend(workspaces) {
  const dataDir = tmp();
  const store = new Store(path.join(dataDir, 'board.db'));
  for (const w of workspaces) store.insertWorkspace({ ...w, createdAt: Date.now() });
  let pane = 0;
  const events = [];
  const adapter = {
    connected: true,
    createWorkspace: async () => { pane++; return { workspaceId: `w${pane}`, paneId: `w${pane}:p1` }; },
    waitShellReady: async () => true, startAgent: async (a) => ({ agent: { name: a.name, launchPending: true }, argv: [a.kind, ...a.args] }), refreshSubscription: async () => {},
  };
  const b = {
    cfg: { convoRoots: [tmp()], claudeSessionsDir: tmp(), desktopSessionsDir: null, convoScanMs: 60000, claudeProjects: tmp(), sessionsDir: path.join(dataDir, 'sessions'), hookTimeoutSec: 2, claudeJson: path.join(dataDir, 'none.json'), claudeCommand: 'claude', recoverGraceMs: 50 },
    store, bus: new EventEmitter(), sessions: new Map(), adapter, events, killing: new Set(),
    api: { broadcast: (ev, data) => events.push([ev, data]) },
    plugin: { pluginDir: 'P', systemPromptFile: 'S' }, hookUrl: 'http://127.0.0.1:1/hooks/claude',
    log: () => {}, hooked: (s) => s.rt.hooked !== false, requireHerdr: () => {},
    resolveWorkspace: async (r) => store.getWorkspace(r),
    ensureWorkspace: (ws) => { if (!store.getWorkspace(ws.key)) store.insertWorkspace({ ...ws, createdAt: Date.now() }); },
    withNewPane: async (create, register) => { const r = await create(); await register(r); return r; },
    broadcastSession: () => {}, probeGit: () => {}, registerResume: () => {},
  };
  return b;
}

test('P9 J2: 닫힌 동안 다른 영역이 그 자리로 왔으면 마지막 자리 대신 자기 영역의 빈자리에 다시 연다', async () => {
  const dirA = tmp(), dirB = tmp();
  const A = { key: pathKey(dirA), kind: 'folder', root: normPath(dirA) }, B = { key: pathKey(dirB), kind: 'folder', root: normPath(dirB) };
  const b = recallBackend([A, B]);
  // A에 열린 셸 하나(왼쪽), 닫힌 셸 하나(마지막 자리 1000,0)
  const open = (id, name, ws, cwd, rect) => {
    const s = { sessionId: id, name, cwd, kind: 'shell', origin: 'board', workspaceKey: ws.key, rt: newRuntime({ kind: 'shell', hooked: false }), createdAt: 1 };
    b.store.insertSession({ ...s, permissionMode: 'manual', runtime: s.rt });
    b.sessions.set(id, s);
    b.store.setNode({ session_id: id, ...rect, z: 0 });
  };
  open('a-open', 'sha', A, dirA, R(0, 0));
  b.store.insertSession({ sessionId: 'a-closed', name: 'shc', cwd: dirA, permissionMode: 'manual', createdAt: 1, runtime: newRuntime({ kind: 'shell', hooked: false }), kind: 'shell', origin: 'board', workspaceKey: A.key });
  b.store.setNode({ session_id: 'a-closed', ...R(NODE.w + GAP, 0) });
  b.store.updateSession('a-closed', { closedAt: Date.now(), closeReason: 'killed' });
  // B 영역이 닫힌 노드 자리 바로 오른쪽으로 왔다(노드끼리는 겹치지 않지만, 그 자리에 다시 열면 A 영역이 B와 겹친다)
  open('b-open', 'shb', B, dirB, R(2 * NODE.w + GAP + 60, 0));
  const r = new Recall(b, { resolveCwd: async (cwd) => (pathKey(cwd) === A.key ? A : B), readProcs: async () => [] });
  const out = await r.reopen({ session: 'a-closed' });
  assert.equal(out.place, 'slot');
  const regs = regionsOf(b.store.workspaces(), ops.canvasItems(b));
  assert.deepEqual(pairs(regs), [], '영역이 겹치지 않는다');
});

// ---------- 하위 세션(K4): 열 하나가 좁고 길게 늘어나지 않는다 ----------
test('P9 K4: 하위 세션이 여러 개면 부모 높이의 약 두 배까지 한 열, 그다음은 오른쪽 열', () => {
  const parent = R(0, 0);
  const size = SIZE_STEPS.small;
  const items = [parent];
  const fits = (c) => !items.some((i) => overlaps(c, i, GAP - 1));
  const kids = [];
  for (let i = 0; i < 8; i++) { const c = childSlot({ parent, siblings: kids, size, fits, rows: 2 }); assert.ok(c, `자식 ${i}`); kids.push(c); items.push(c); }
  const cols = new Set(kids.map((k) => k.x));
  assert.ok(cols.size >= 3, `열 ${cols.size}개`);
  const all = bbox(kids);
  assert.ok(all.h <= 2 * parent.h + size.h + GAP, `열 높이 ${all.h}`);
  assert.equal(kids[0].x, parent.w + 200); assert.equal(kids[0].y, 0); assert.equal(kids[1].y, size.h + GAP);
});

test('P9 K4: 옆 영역에 막혀 나무 자리가 없으면 노드만 피해 부모 옆에 두고, 옆 영역을 밀어 겹침을 푼다(먼 빈자리로 보내지 않는다)', () => {
  const { b, add } = fakeBackend();
  b.bus ??= new EventEmitter();
  const br = new Branch(b);
  const lead = add('lead', 'ws-a', R(0, 0));
  const small = SIZE_STEPS.small;
  // a 영역 바로 아래에 c 영역(맞닿음), 첫 자식 열 바로 오른쪽에 b의 노드
  add('c0', 'ws-c', R(0, NODE.h + 40 + 40 + 72));
  add('b0', 'ws-b', R(NODE.w + 200 + small.w + 80, 0));
  const kid = (name) => { const at = br.placeChild(lead.sessionId, 'ws-a'); const s = add(name, 'ws-a', { x: at.x, y: at.y, w: at.w, h: at.h }); s.parentSessionId = lead.sessionId; br.info.set(s.sessionId, { child: true }); ops.settleRegions(b, 'spawn'); return at; };
  const w1 = kid('w1');
  assert.equal(w1.x, NODE.w + 200);
  assert.ok(w1.y >= 0);
  assert.equal(w1.size, 'wide-normal');
  const w2 = kid('w2');
  assert.equal(w2.x, w1.x);
  assert.ok(w2.y >= w1.y + w1.h + LINE_GAP_Y, '첫 자식 아래(부모 옆 열)');
  assert.deepEqual(pairs(ops.regions(b)), [], 'c를 아래로 밀어 겹치지 않는다');
  assert.ok(rectOf(b, 'c0').y > NODE.h + 40 + 40 + 72);
});
