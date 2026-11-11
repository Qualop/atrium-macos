// P65: 판 배율·화면 배율(DPR) 아래에서 터미널 글자를 선명하게 그리는 계산. 순수 함수만 둔다(단위 시험 test/p65-lib.test.mjs).
//
// 흐림의 원인(experiments/p65, docs/log/p65-terminal-sharpness.md 작업 기록):
//   1. xterm WebGL 캔버스는 실제 DPR만큼의 해상도로 그려지고, 판 배율(React Flow의 CSS scale)이 그 그림을 늘이거나 줄인다.
//   2. 분수 DPR(1.5 등)이나 창 배율에서는 캔버스가 장치 픽셀 경계 사이에 놓여, 판 배율 100%에서도 반 픽셀씩 번진다.
//   3. 아주 작은 늘이기(0.94~1.02배)도 글자 가장자리를 두 픽셀로 번지게 한다. 그래서 "노드를 꼭 채우기"보다 "캔버스 픽셀 = 화면 픽셀"을 먼저 한다.
// 고치는 법: 배율이 멈추면 터미널마다 xterm이 보는 DPR(E)을 바꿔, 칸 하나가 화면에서 정수 장치 픽셀(Tw×Th)이 되게 그린다.
//   - Tw·Th는 배율 1 칸 × 배율에 가장 가까운 정수다. 그래서 터미널이 노드 안에서 차지하는 크기가 배율 1보다 칸마다 0.5 장치 픽셀까지 다를 수 있다
//     (남는 곳은 터미널 바탕색). 노드 안 터미널 칸에 안 들어가면 내림하고, 내림으로 8%보다 더 작아지면 그 축은 노드를 채운다(조금 늘여 보인다).
//   - 캔버스가 너무 커지면(SHARP_MAX_PX, SHARP_MAX_SIDE) 그만큼만 키우고 나머지는 늘여 보인다.
//   - 터미널 요소에 scale을 걸어 캔버스 한 픽셀이 화면 장치 픽셀 하나가 되게 하고, translate로 장치 픽셀 경계에 맞춘다(phaseShift).
//   - 패널 줄·칸 수는 배율 1 칸으로 잰다(fitDims). 배율을 바꿔도 패널 크기는 그대로다.

// xterm WebGL 렌더러가 칸을 재는 식(addon-webgl 0.19 _updateDimensions): 칸 너비 = floor(글자 너비 × DPR), 높이 = floor(ceil(글자 높이 × DPR) × 줄 높이)
export function webglCell({ cw, ch, dpr, lineHeight }) {
  const charW = Math.floor(cw * dpr), charH = Math.ceil(ch * dpr);
  return { w: charW, h: Math.floor(charH * lineHeight), charH };
}

// 배율 1(E = 실제 DPR)일 때의 장치 칸과 CSS 칸. 패널 줄·칸 수는 이 CSS 칸으로 잰다
export function baseCells({ cw, ch, dpr, lineHeight }) {
  const c = webglCell({ cw, ch, dpr, lineHeight });
  const w = Math.max(1, c.w), h = Math.max(1, c.h);
  return { w, h, cssW: w / dpr, cssH: h / dpr };
}

export const SHARP_MAX_PX = 12e6; // 캔버스 한 장의 장치 픽셀 상한(4K 화면 1.5장쯤). 넘으면 E를 줄이고 나머지는 늘여 보인다
export const SHARP_MAX_SIDE = 8192; // 캔버스 한 변의 상한(WebGL 텍스처 크기)
export const SHARP_SHRINK_MAX = 0.08; // 1:1을 지키려고 터미널을 줄여도 되는 비율(넘으면 그 축은 노드를 채운다). 칸이 7.5 장치 픽셀일 때 내림이 6.7%

// k: 배율 1 CSS px 하나가 화면에서 차지하는 CSS px(판 배율 × 웹 화면 배율 × P47 비율). dpr: 실제 devicePixelRatio
// fitW·fitH: 터미널이 들어갈 수 있는 크기(배율 1 CSS px). 1:1로 그린 터미널이 이보다 크면 칸을 내림한다.
//   내림하면 터미널이 SHARP_SHRINK_MAX보다 더 작아질 때는 그 축만 1:1을 버리고 노드를 채운다(fillX·fillY, 조금 늘여 보인다)
// 돌려줌: null(잴 수 없음) 또는 { E, lineHeight, Tw, Th, k, capped, fillX, fillY, base }. 배율 1이면 E = dpr, 줄 높이 그대로(xterm을 다시 그리지 않는다)
export function sharpPlan({ cw, ch, dpr, lineHeight, k, cols, rows, fitW = Infinity, fitH = Infinity, maxPx = SHARP_MAX_PX, maxSide = SHARP_MAX_SIDE, shrinkMax = SHARP_SHRINK_MAX }) {
  if (!(cw > 0 && ch > 0 && dpr > 0 && k > 0 && cols > 0 && rows > 0)) return null;
  const b = baseCells({ cw, ch, dpr, lineHeight });
  let kk = k;
  const area = cols * b.w * rows * b.h * kk * kk;
  if (area > maxPx) kk *= Math.sqrt(maxPx / area);
  kk = Math.min(kk, maxSide / (cols * b.w), maxSide / (rows * b.h));
  const capped = kk < k - 1e-9;
  // 돌려줌: [장치 칸, 노드 채우기]. 채울 때는 늘이기가 가장 작은 반올림 칸
  const pick = (base, n, fit) => {
    const x = base * kk, T = Math.max(1, Math.round(x));
    if (capped) return [T, true];
    if ((n * T) / (dpr * k) <= fit + 1e-6) return [T, false];
    const F = Math.max(1, Math.floor(x));
    return F / x >= 1 - shrinkMax ? [F, false] : [T, true];
  };
  const [Tw, fillX] = pick(b.w, cols, fitW), [Th, fillY] = pick(b.h, rows, fitH);
  if (Tw === b.w && Th === b.h) return { E: dpr, lineHeight, Tw, Th, k: kk, capped, fillX, fillY, base: b };
  // floor(cw × E) = Tw가 되는 E 가운데, 글자가 칸에 배율 1과 같은 비율로 그려지는 값. 구간 [Tw/cw, (Tw+1)/cw) 안에 둔다
  let E = Math.min((dpr * Tw) / b.w, (Tw + 0.9) / cw);
  E = Math.max(E, (Tw + 1e-6) / cw);
  // 줄 높이: floor(ceil(ch × E) × lh) = Th. xterm은 1보다 작은 줄 높이를 받지 않는다
  const charH = Math.ceil(ch * E);
  const lh = Math.max(1, (Th + 0.5) / charH);
  const c = webglCell({ cw, ch, dpr: E, lineHeight: lh });
  return { E, lineHeight: lh, Tw: c.w, Th: c.h, k: kk, capped, fillX, fillY, base: b };
}

// xterm이 캔버스에 주는 CSS 크기(Math.round(줄 수 × 장치 칸 / DPR))
export const cssCanvas = (n, dev, dpr) => Math.round((n * dev) / dpr);

// 터미널 요소에 걸 scale. kAnc: 조상(판 배율, 웹 화면 배율)이 건 배율, s47: P47 비율,
// zc: 웹 화면 배율(뿌리의 CSS zoom, P49). zoom은 변환이 아니라 레이아웃 배율이라 반올림은 CSS px × DPR × zc 단위로 한다
// 1:1: 캔버스 한 픽셀 = 화면 장치 픽셀 하나(배율 1에서도 xterm의 CSS 크기 반올림을 지운다).
// 채우는 축(fillX·fillY, 상한에 걸렸을 때는 둘 다)은 배율 1 때의 CSS 크기로 늘인다. plan이 없으면 P47 비율 그대로
export function compensate(plan, { cols, rows, dpr, kAnc, s47 = 1, zc = 1 }) {
  if (!plan || !(kAnc > 0)) return { sx: s47, sy: s47 };
  const cw = cssCanvas(cols, plan.Tw, plan.E), ch = cssCanvas(rows, plan.Th, plan.E);
  if (!(cw > 0 && ch > 0)) return { sx: s47, sy: s47 };
  const fill = (n, base, cur) => (s47 * cssCanvas(n, base, dpr)) / cur;
  // Blink는 캔버스 상자 크기(CSS × DPR)도 정수 장치 픽셀로 반올림해 그린다. 그 크기에서 1:1이 되게 한다
  const one = (n, T, cur) => (n * T * zc) / (Math.max(1, Math.round(cur * dpr * zc)) * kAnc);
  return {
    sx: plan.capped || plan.fillX ? fill(cols, plan.base.w, cw) : one(cols, plan.Tw, cw),
    sy: plan.capped || plan.fillY ? fill(rows, plan.base.h, ch) : one(rows, plan.Th, ch),
  };
}

// Blink가 그리는 자리: 변환이 걸린 조상(origin, 화면 CSS px) 안의 레이아웃 자리를 레이아웃 장치 픽셀(CSS px × DPR × zc)로 반올림한 곳.
// getBoundingClientRect(pos)는 반올림 전 자리다
export const paintedAt = (pos, origin, { kAnc, dpr, zc = 1 }) => origin + (kAnc * Math.round(((pos - origin) / kAnc) * dpr * zc)) / (dpr * zc);

// 화면 자리(CSS px) × DPR의 소수 부분을 없애는 이동(화면 CSS px). 가까운 쪽 정수로 옮긴다
export function phaseShift(pos, dpr) {
  const d = pos * dpr;
  return (Math.round(d) - d) / dpr;
}

// FitAddon.proposeDimensions와 같은 식(남는 CSS px ÷ 칸, 최소 2칸×1줄). 칸은 배율 1 칸(baseCells)을 준다
export function fitDims({ freeW, freeH, cellW, cellH }) {
  if (!(cellW > 0 && cellH > 0) || !Number.isFinite(freeW) || !Number.isFinite(freeH)) return undefined;
  return { cols: Math.max(2, Math.floor(freeW / cellW)), rows: Math.max(1, Math.floor(freeH / cellH)) };
}

// 같은 계획인지(xterm을 다시 그리지 않아도 되는지)
export const samePlan = (a, b) => !!a && !!b && Math.abs(a.E - b.E) < 1e-9 && Math.abs(a.lineHeight - b.lineHeight) < 1e-9;
