// P127 단위 시험: 판 움직임 비용 줄이기.
// 1) 판을 움직이는 동안 작업 중 둘레 멈춤(lib/work-light.js motionPauser, zoom-var.js useBoardMotion, styles.css P127 덩어리)
// 2) 터미널 노드 머리줄(노드 뿌리 --inv)과 영역·워크트리 상자·그룹 틀 이름표 글자도 배율 계단(lib/faces.js zoomStep)
// 3) 셸 기록 나눠 쓰기(lib/term-fill.js): 최근 화면 먼저, 기록은 뒤 프레임마다 한 조각, 끝 결과는 예전 한 번 쓰기와 같다(실제 xterm 버퍼로 견줌)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { motionPauser, MOTION_REST_MS } from '../src/renderer/lib/work-light.js';
import { zoomStep, ZOOM_STEP } from '../src/renderer/lib/faces.js';
import { fillPlan, fillChunks, runFill, fillSlot, ALT_ON, ALT_OFF, FILL_LINES } from '../src/renderer/lib/term-fill.js';
import { historyPrefill, serializeScreen } from '../src/renderer/lib/term-select.js';
import xterm from '@xterm/xterm';
const { Terminal } = xterm;

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const noComments = (s) => s.replace(/\/\*[^]*?\*\//g, '');

// 가짜 시계와 타이머
function clock() {
  let t = 0, id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setT: (fn, ms) => { id++; timers.set(id, { fn, at: t + ms }); return id; },
    clearT: (h) => { timers.delete(h); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [h, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [h, x];
        if (!next) break;
        timers.delete(next[0]); t = next[1].at; next[1].fn();
      }
      t = end;
    },
    get pending() { return timers.size; },
  };
}

test('움직임 멈춤: 움직이면 data-board-moving을 달고, 마지막 움직임 뒤 MOTION_REST_MS가 지나면 뗀다', () => {
  const doc = { documentElement: { dataset: {} } };
  const c = clock();
  const p = motionPauser({ doc, now: c.now, setT: c.setT, clearT: c.clearT });
  const ds = doc.documentElement.dataset;
  assert.ok(MOTION_REST_MS >= 200 && MOTION_REST_MS <= 1000, '휠 칸 사이(50~150ms)보다 넉넉하고 1초 안');
  assert.equal(p.moving, false); assert.ok(!('boardMoving' in ds));
  p.moved();
  assert.equal(ds.boardMoving, '1'); assert.equal(p.moving, true);
  // 매 프레임(7ms) 움직임이 1초 이어져도 타이머는 하나뿐이고 계속 멈춘 채
  for (let i = 0; i < 140; i++) { c.advance(7); p.moved(); assert.ok(c.pending <= 1, '타이머 하나'); }
  assert.equal(ds.boardMoving, '1');
  // 휠 칸 사이(150ms) 쉬어도 멈춘 채
  c.advance(150); p.moved(); assert.equal(ds.boardMoving, '1');
  // 멈춘 뒤 MOTION_REST_MS 직전까지는 멈춘 채, 지나면 다시 돈다
  c.advance(MOTION_REST_MS - 10); assert.equal(ds.boardMoving, '1');
  c.advance(20); assert.ok(!('boardMoving' in ds), '다시 돈다'); assert.equal(p.moving, false); assert.equal(c.pending, 0);
  // 다시 움직이면 다시 멈춘다
  p.moved(); assert.equal(ds.boardMoving, '1');
  p.dispose(); assert.ok(!('boardMoving' in ds), '정리하면 뗀다'); assert.equal(c.pending, 0);
  // 문서가 없어도 던지지 않는다
  const q = motionPauser({ doc: null, now: c.now, setT: c.setT, clearT: c.clearT });
  q.moved(); q.dispose(); assert.equal(q.moving, false);
});

test('움직임 멈춤 CSS: 회전판만 paused(모양·색 그대로), 미션 맵 카드 빛은 건드리지 않음, 판이 변환을 구독해 부른다', () => {
  const css = noComments(read('styles.css'));
  const i = css.indexOf('html[data-board-moving="1"]');
  assert.ok(i >= 0, '규칙이 있다');
  const rules = css.slice(i).split('}').filter((r) => r.includes('data-board-moving') && r.includes('mt-node-run')); // P146: 대화 노드 그림자 규칙(.mt-cv)은 따로 본다(p146-lib)
  // P128a: 움직이는 동안 회전판을 숨기는 규칙이 더해졌다(사용자 결정). 멈춤 규칙과 숨김 규칙 둘
  assert.equal(rules.length, 2);
  assert.match(rules[0], /\.mt-node-run > i \{ animation-play-state: paused; $/);
  assert.match(rules[1], /\.mt-node-run \{ visibility: hidden; $/);
  assert.ok(!/data-board-moving[^{]*mt-mm-light/.test(css), '미션 맵 카드 빛은 그대로');
  // workLight 끔·움직임 줄이기 따름은 animation: none이라 paused와 겹쳐도 그대로 멈춘 고리
  assert.match(css, /html\[data-work-light="off"\] \.mt-node-run > i \{ animation: none;/);
  const zv = read('zoom-var.js');
  assert.match(zv, /export function useBoardMotion\(\)/);
  assert.match(zv, /motionPauser\(\)/);
  assert.match(read('Canvas.jsx'), /useBoardMotion\(\);/);
});

test('글자 계단: 계단 위 배율에서는 지금과 같고(멈춘 화면), 그 사이에서는 ±5% 안, 계단은 1.1배마다', () => {
  assert.equal(ZOOM_STEP, 1.1);
  // 멈춘 화면(계단 위): 머리줄 글자 13px/배율이 그대로
  for (let k = -30; k <= 5; k++) {
    const z = ZOOM_STEP ** k;
    assert.ok(Math.abs(zoomStep(z) - z) < 1e-9 * Math.max(1, z), `계단 위 ${z}`);
    assert.ok(Math.abs(13 / zoomStep(z) - 13 / z) < 1e-6, '같은 글자 크기');
  }
  // 그 사이: 차이 ±5% 안, 배율 쪽으로 단조(계단만 바뀜)
  let prev = 0, changes = 0;
  for (let z = 0.05; z <= 1.6; z *= 1.004) {
    const s = zoomStep(z);
    assert.ok(Math.abs(s / z - 1) <= 0.0489, `±5% 안 ${z}`);
    assert.ok(s >= prev); if (s !== prev) changes++; prev = s;
  }
  assert.ok(changes <= Math.ceil(Math.log(1.6 / 0.05) / Math.log(1.1)) + 1, '계단이 바뀌는 수는 1.1배마다 한 번');
});

test('글자 계단: 터미널 노드 뿌리 --inv, 영역·워크트리 상자·그룹 틀 이름표가 계단 값으로 쓰인다(터미널 안 글자는 --inv를 쓰지 않는다)', () => {
  const zv = read('zoom-var.js');
  assert.match(zv, /export function useZoomStyle\(styleOf, stepped = false\)/);
  assert.match(zv, /const z = stepped \? zoomStep\(st\.transform\[2\]\) : st\.transform\[2\];/);
  assert.match(zv, /\}, \[flow, stepped\]\);/);
  const rg = read('Regions.jsx');
  for (const f of ['regionHead', 'wtHead', 'groupHead']) assert.match(rg, new RegExp(`useZoomStyle\\(${f}, true\\)`), f);
  assert.ok(!/useZoomStyle\((regionHead|wtHead|groupHead)\)/.test(rg), '부드러운 것이 남지 않았다');
  const sn = read('SessionNode.jsx');
  assert.match(sn, /const invRef = useInvRef\(0\.02, id, true\);/, '모든 얼굴(터미널 포함) 노드 뿌리 --inv는 계단');
  assert.ok(!/face !== 'close';/.test(sn));
  // 터미널 칸 안은 --inv를 고정해 둔다(P112): 배율 계단이 터미널 글자에 닿지 않는다
  assert.match(noComments(read('styles.css')), /\.mt-term-wrap[^{]*\{[^}]*--inv: 1/);
});

// 기록(색 섞인 줄)과 지금 화면
const histOf = (n) => Array.from({ length: n }, (_, i) => (i % 7 === 0 ? `\x1b[32mline ${i}\x1b[0m ok` : `line ${i} ${'x'.repeat(i % 50)}`));
const mk = (rows = 6, cols = 40) => new Terminal({ cols, rows, scrollback: 6000, allowProposedApi: true });
const w = (t, d) => new Promise((r) => t.write(d, r));
const dump = (t) => { const b = t.buffer.active, o = []; for (let i = 0; i < b.length; i++) o.push(b.getLine(i).translateToString(true)); return { type: b.type, lines: o, x: b.cursorX, y: b.cursorY, base: b.baseY, vy: b.viewportY }; };
const viewRows = (t) => { const b = t.buffer.active, o = []; for (let r = 0; r < t.rows; r++) o.push(b.getLine(b.viewportY + r).translateToString(true).trimEnd()); return o; }; // 다시 그린 화면은 빈칸도 쓴다
async function screenOf(rows, cols) {
  const sh = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
  await w(sh, '\x1b[1;1H$ ls\r\n\x1b[1ma.txt\x1b[0m b.txt\r\n$ echo hi\r\nhi\r\n$ ');
  const sb = sh.buffer.active;
  const s = serializeScreen(sb, { base: sb.baseY, rows, cols, cursorX: sb.cursorX, cursorY: sb.cursorY, cell: sb.getNullCell() });
  return { s, rows: viewRows(sh) };
}

test('기록 조각: 줄 수·글자 수 상한, 순서 그대로, 빠짐없이', () => {
  const h = histOf(5000);
  const parts = fillChunks(h);
  assert.equal(parts.length, Math.ceil(5000 / FILL_LINES));
  assert.deepEqual(parts.flat(), h, '순서와 줄이 그대로');
  assert.ok(parts.every((p) => p.length <= FILL_LINES && p.length >= 1));
  const long = Array.from({ length: 30 }, () => 'y'.repeat(5000));
  const lp = fillChunks(long, { maxChars: 12000 });
  assert.ok(lp.every((p) => p.reduce((a, l) => a + l.length, 0) <= 12000 || p.length === 1));
  assert.deepEqual(lp.flat(), long);
  assert.deepEqual(fillChunks([]), []);
});

test('나눠 쓰기 계획: 첫 쓰기는 대체 화면에 지금 화면만, 그다음 조각마다 보통 화면에 기록을 쓰고 대체 화면으로 돌아오며, 마지막은 보통 화면에 남는다', () => {
  const h = histOf(1000), scr = '<SCREEN>';
  const plan = fillPlan(h, 24, scr);
  assert.equal(plan.length, 1 + Math.ceil(1000 / FILL_LINES));
  assert.equal(plan[0], ALT_ON + scr, '최근 화면이 먼저');
  for (let i = 1; i < plan.length - 1; i++) { assert.ok(plan[i].startsWith(ALT_OFF)); assert.ok(plan[i].endsWith(ALT_ON + scr), '조각 사이에 그려지는 프레임은 지금 화면'); }
  const last = plan[plan.length - 1];
  assert.ok(last.startsWith(ALT_OFF) && last.endsWith('\r\n'.repeat(24) + scr) && !last.includes(ALT_ON), '끝은 보통 화면');
  // 대체 화면 부분을 걷어 내면 예전 한 번 쓰기와 같은 글
  const normal = plan.join('').split(ALT_ON + scr).join('').split(ALT_OFF).join('');
  assert.equal(normal, historyPrefill(h, 24) + scr);
  // 작은 기록은 예전처럼 한 번에(대체 화면 없이)
  assert.deepEqual(fillPlan(['a', 'b'], 5, 'S'), [historyPrefill(['a', 'b'], 5) + 'S']);
  assert.deepEqual(fillPlan([], 5, 'S'), ['S']);
  assert.deepEqual(fillPlan([], 5), []);
});

test('실제 xterm: 나눠 쓴 끝 버퍼(기록·화면·커서·맨 아래)가 한 번 쓰기와 같고, 채우는 동안 보이는 화면은 늘 지금 화면이다', async () => {
  const rows = 6, cols = 40;
  const { s: scr, rows: shown } = await screenOf(rows, cols);
  for (const n of [3, 900, 5000]) {
    const h = histOf(n);
    const one = mk(rows, cols); await w(one, historyPrefill(h, rows) + scr);
    const two = mk(rows, cols);
    const plan = fillPlan(h, rows, scr);
    const seen = [];
    await runFill(plan, { write: async (d) => { await w(two, d); seen.push({ type: two.buffer.active.type, view: viewRows(two) }); }, slot: async () => {} });
    assert.deepEqual(dump(two), dump(one), `기록 ${n}줄: 끝 버퍼가 같다`);
    assert.equal(dump(two).type, 'normal');
    assert.ok(dump(two).base === dump(two).vy, '맨 아래(지금 화면)를 보고 있다');
    if (plan.length > 1) {
      for (const x of seen.slice(0, -1)) { assert.equal(x.type, 'alternate', '채우는 동안은 대체 화면'); assert.deepEqual(x.view, shown, '보이는 것은 지금 화면'); }
    }
    assert.deepEqual(seen[seen.length - 1].view, shown, '끝나도 같은 화면');
    one.dispose(); two.dispose();
  }
});

test('차례로 쓰기: 첫 글은 바로, 그다음은 조각마다 다음 프레임 자리를 기다리고, 터미널을 닫으면 멈춘다', async () => {
  const log = [];
  let open = true;
  const n = await runFill(['a', 'b', 'c'], { write: async (d) => { log.push(`w:${d}`); }, slot: async () => { log.push('slot'); } });
  assert.equal(n, 3);
  assert.deepEqual(log, ['w:a', 'slot', 'w:b', 'slot', 'w:c']);
  log.length = 0;
  const m = await runFill(['a', 'b', 'c'], { write: async (d) => { log.push(`w:${d}`); if (d === 'b') open = false; }, alive: () => open, slot: async () => { log.push('slot'); } });
  assert.equal(m, 2, '닫힌 뒤에는 쓰지 않는다'); assert.deepEqual(log, ['w:a', 'slot', 'w:b', 'slot']);
  // 여러 터미널: 모든 조각이 한 줄로 서서 프레임마다 하나
  const frames = [];
  const frame = (fn) => { frames.push(fn); };
  const order = [];
  const a = runFill(['a1', 'a2', 'a3'], { write: async (d) => { order.push(d); }, slot: () => fillSlot(frame) });
  const b = runFill(['b1', 'b2', 'b3'], { write: async (d) => { order.push(d); }, slot: () => fillSlot(frame) });
  const tick = async () => { await new Promise((r) => setImmediate(r)); const f = frames.shift(); if (f) f(); await new Promise((r) => setImmediate(r)); };
  await tick();
  assert.deepEqual(order, ['a1', 'b1', 'a2'].slice(0, order.length));
  let guard = 0;
  while (order.length < 6 && guard++ < 50) { const before = order.length; await tick(); assert.ok(order.length - before <= 1, '한 프레임에 한 조각'); }
  await Promise.all([a, b]);
  assert.equal(order.length, 6);
});

test('터미널 보기: 처음 붙일 때와 다시 맞출 때 모두 나눠 쓴다(한 번에 쓰는 기록 쓰기가 남지 않았다)', () => {
  const tv = read('TerminalView.jsx');
  assert.match(tv, /await fillHistory\(h\.ansi, shadowScreen\(\), 'first'\)/);
  assert.match(tv, /await fillHistory\(h\.ansi, screen, 'resync'\)/);
  assert.ok(!/historyPrefill\(/.test(tv));
});
