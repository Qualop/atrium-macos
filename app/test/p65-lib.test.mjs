// P65 창 단위 시험: 판 배율·DPR 아래 터미널을 화면 장치 픽셀에 맞춰 그리는 계산(lib/term-sharp.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { webglCell, baseCells, sharpPlan, compensate, cssCanvas, phaseShift, paintedAt, fitDims, samePlan } from '../src/renderer/lib/term-sharp.js';

const LH = 19.3 / 15.2; // lib/tokens.js TERM_LINE_HEIGHT
const font = { cw: 8.0, ch: 17.2, lineHeight: LH }; // 14px JetBrains Mono 쯤(시험 판에서 잰 칸: DPR 1에서 8×22)
const box = { cols: 85, rows: 18 };
const plan = (dpr, k, extra = {}) => sharpPlan({ ...font, ...box, dpr, k, ...extra });
// 화면에서 칸 하나가 차지하는 장치 픽셀(캔버스 CSS 크기 × 보정 scale × 조상 배율 × DPR ÷ 칸 수)
// (Blink는 캔버스 상자를 정수 장치 픽셀로 반올림해 그린다)
const shown = (p, dpr, kAnc) => { const c = compensate(p, { ...box, dpr, kAnc }); return { w: (Math.round(cssCanvas(box.cols, p.Tw, p.E) * dpr) * c.sx * kAnc) / box.cols, h: (Math.round(cssCanvas(box.rows, p.Th, p.E) * dpr) * c.sy * kAnc) / box.rows }; };

test('xterm WebGL과 같은 식으로 칸을 잰다', () => {
  assert.deepEqual(webglCell({ cw: 8, ch: 17.2, dpr: 1, lineHeight: LH }), { w: 8, h: 22, charH: 18 });
  assert.deepEqual(webglCell({ cw: 8, ch: 17.2, dpr: 1.5, lineHeight: LH }), { w: 12, h: 33, charH: 26 });
  const b = baseCells({ ...font, dpr: 1.25 });
  assert.equal(b.w, 10); assert.equal(b.cssW, 8);
});

test('배율 1·DPR 1이면 xterm을 다시 그리지 않고 보정도 없다(지금과 같다)', () => {
  const p = plan(1, 1);
  assert.equal(p.E, 1); assert.equal(p.lineHeight, LH); assert.equal(p.Tw, 8); assert.equal(p.Th, 22);
  assert.deepEqual(compensate(p, { ...box, dpr: 1, kAnc: 1 }), { sx: 1, sy: 1 });
});

test('판 배율과 DPR마다 칸 하나가 화면에서 정수 장치 픽셀이고, 캔버스 한 픽셀이 장치 픽셀 하나다', () => {
  for (const dpr of [1, 1.25, 1.5, 1.875, 2]) {
    for (const z of [0.5, 0.55, 0.6, 0.75, 0.83, 1, 1.1, 1.25, 1.5, 2]) {
      const p = plan(dpr, z);
      const b = baseCells({ ...font, dpr });
      assert.ok(Number.isInteger(p.Tw) && Number.isInteger(p.Th), `${dpr} ${z}`);
      assert.ok(Math.abs(p.Tw - b.w * z) <= 0.5 + 1e-9 || p.Tw === Math.floor(b.w * z), `가로 칸은 배율에 가장 가까운 정수(넘치면 내림) ${dpr} ${z}: ${p.Tw} vs ${b.w * z}`);
      assert.ok(Math.abs(p.Th - b.h * z) <= 0.5 + 1e-9 || p.Th === Math.floor(b.h * z), `세로 ${dpr} ${z}: ${p.Th} vs ${b.h * z}`);
      // xterm이 그 E와 줄 높이로 만들 칸이 바로 Tw×Th
      const c = webglCell({ cw: font.cw, ch: font.ch, dpr: p.E, lineHeight: p.lineHeight });
      assert.equal(c.w, p.Tw); assert.equal(c.h, p.Th);
      assert.ok(p.lineHeight >= 1);
      const s = shown(p, dpr, z);
      assert.ok(!p.fillX && !p.fillY);
      assert.ok(Math.abs(s.w - p.Tw) < 1e-6 && Math.abs(s.h - p.Th) < 1e-6, `1:1 ${dpr} ${z}: ${JSON.stringify(s)} vs ${p.Tw}x${p.Th}`);
    }
  }
});

test('1:1로 그린 터미널이 들어갈 자리보다 크면 칸을 내림하고, 너무 작아지면 그 축은 노드를 채운다', () => {
  // DPR 1.5, 배율 1.4: 12×1.4 = 16.8 → 17(넘침). 85칸 × 17 / 2.1 = 688 > 685 → 16으로 내림(4.8% 작아짐)
  const free = plan(1.5, 1.4);
  assert.equal(free.Tw, 17); assert.ok(!free.fillX);
  const tight = plan(1.5, 1.4, { fitW: 685 });
  assert.equal(tight.Tw, 16); assert.ok(!tight.fillX);
  assert.ok((box.cols * tight.Tw) / 2.1 <= 685);
  // DPR 1, 배율 0.6: 8×0.6 = 4.8 → 5(넘침). 4로 내리면 17% 작아지므로 5로 그리고 노드를 채운다(4.8/5배로 줄여 보인다)
  const small = plan(1, 0.6, { fitW: 690 });
  assert.equal(small.Tw, 5); assert.ok(small.fillX); assert.ok(!small.fillY);
  const c = compensate(small, { ...box, dpr: 1, kAnc: 0.6 });
  assert.ok(Math.abs(cssCanvas(box.cols, small.Tw, small.E) * c.sx - cssCanvas(box.cols, 8, 1)) < 1e-6, '배율 1 CSS 너비');
});

test('캔버스가 너무 크면 E를 줄이고(capped) 배율 1 CSS 크기로 늘여 노드를 채운다', () => {
  const p = sharpPlan({ ...font, cols: 400, rows: 120, dpr: 2, k: 2 });
  assert.ok(p.capped);
  assert.ok(400 * p.Tw * 120 * p.Th <= 12e6 * 1.05);
  const c = compensate(p, { cols: 400, rows: 120, dpr: 2, kAnc: 2 });
  assert.ok(Math.abs(cssCanvas(400, p.Tw, p.E) * c.sx - cssCanvas(400, p.base.w, 2)) < 1e-6);
});

test('P47 비율은 1:1 보정 안에 들어간다', () => {
  const p = sharpPlan({ ...font, ...box, dpr: 1, k: 0.75 * 0.8 });
  const c = compensate(p, { ...box, dpr: 1, kAnc: 0.75, s47: 0.8 });
  assert.ok(Math.abs((Math.round(cssCanvas(box.cols, p.Tw, p.E)) * c.sx * 0.75) / box.cols - p.Tw) < 1e-6);
  assert.deepEqual(compensate(null, { ...box, dpr: 1, kAnc: 0.75, s47: 0.8 }), { sx: 0.8, sy: 0.8 });
});

test('장치 픽셀 경계 맞춤: 가까운 정수 장치 픽셀로 옮긴다', () => {
  assert.equal(phaseShift(10, 1), 0);
  assert.ok(Math.abs(phaseShift(10.2, 1.5) - (15 - 15.3) / 1.5) < 1e-9);
  assert.ok(Math.abs(phaseShift(10.4, 1.5) - (16 - 15.6) / 1.5) < 1e-9);
  for (const [p, d] of [[123.37, 1.5], [7.1, 1.25], [55.55, 1.875], [3, 2]]) {
    const v = (p + phaseShift(p, d)) * d;
    assert.ok(Math.abs(v - Math.round(v)) < 1e-9);
    assert.ok(Math.abs(phaseShift(p, d) * d) <= 0.5 + 1e-9);
  }
});

test('웹 화면 배율(CSS zoom)은 레이아웃 배율로 반올림한다', () => {
  // DPR 1, 웹 화면 125%, 판 배율 1: 화면에서 배율 1 CSS px 하나 = 1.25px
  const p = plan(1, 1.25);
  const c = compensate(p, { ...box, dpr: 1, kAnc: 1.25, zc: 1.25 });
  const cur = cssCanvas(box.cols, p.Tw, p.E);
  assert.ok(Math.abs((Math.round(cur * 1.25) * c.sx * (1.25 / 1.25)) / box.cols - p.Tw) < 1e-6, '레이아웃이 반올림한 캔버스 × scale × 판 배율 = Tw 장치 픽셀');
  // 노드 안 자리 10.3 CSS px(웹 125%, DPR 1): 레이아웃 장치 픽셀 12.875 → 13 → 화면 자리 origin + 13
  assert.ok(Math.abs(paintedAt(100 + 10.3 * 1.25, 100, { kAnc: 1.25, dpr: 1, zc: 1.25 }) - 113) < 1e-9);
  assert.ok(Math.abs(paintedAt(100 + 10.3, 100, { kAnc: 1, dpr: 1.5 }) - (100 + 15 / 1.5)) < 1e-9);
});

test('패널 줄·칸 수는 배율 1 칸으로 잰다(FitAddon과 같은 식)', () => {
  assert.deepEqual(fitDims({ freeW: 690, freeH: 404, cellW: 8, cellH: 22 }), { cols: 86, rows: 18 });
  assert.deepEqual(fitDims({ freeW: 3, freeH: 3, cellW: 8, cellH: 22 }), { cols: 2, rows: 1 });
  assert.equal(fitDims({ freeW: 690, freeH: 404, cellW: 0, cellH: 22 }), undefined);
});

test('같은 계획이면 다시 그리지 않는다', () => {
  assert.ok(samePlan(plan(1.5, 0.75), plan(1.5, 0.75)));
  assert.ok(!samePlan(plan(1.5, 0.75), plan(1.5, 1)));
  assert.ok(!samePlan(null, plan(1, 1)));
  assert.equal(sharpPlan({ ...font, ...box, dpr: 1, k: 0 }), null);
});
