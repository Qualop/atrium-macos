// 노드로 들어갈 때의 화면(P10, P26, ARCH 4절 H4·H5). 순수 함수만 둔다(단위 시험 app/test/p10-lib.test.mjs, p26-lib.test.mjs). 부르는 곳은 Canvas.jsx의 navigateTo.
// - P26: 혼자인 노드는 노드가 화면을 적당히(높이나 너비의 FILL = 85%) 채우게 확대한다. 배율 상한은 ZOOM_MAX(1).
//   터미널(xterm)은 노드 크기로 그린 그림을 화면 배율로 늘리므로, 1보다 크게 하면 글이 흐려진다.
// - 덩어리(붙여 묶기) 안의 노드: 덩어리 전체가 화면을 같은 몫으로 채운다(상한 같음).
//   그렇게 맞춘 배율에서 누른 노드가 가까이 얼굴(360px)이 못 되면, 누른 노드를 가까이 얼굴로 두고(터미널에 바로 칠 수 있게)
//   그 배율에서 덩어리가 최대한 많이 보이도록 가운데를 덩어리 쪽으로 옮긴다. 좁거나 긴 노드는 전체가 보이는 범위와 배율 상한을 먼저 지킨다.
// - P26: 이미 그 노드(덩어리)를 보고 있으면 화면을 옮기지 않는다(isViewing). 터미널을 누를 때마다 화면이 흔들리지 않게.
import { FACE_CLOSE_PX } from './faces.js';

export const NAV_CLOSE_PX = 380; // 들어갈 때 노드가 차지할 가장 작은 화면 너비(가까이 얼굴 경계 360 + 여유)
export const FILL = 0.85; // 노드(덩어리)가 화면에서 차지할 몫
export const ZOOM_MAX = 1; // 들어갈 때 배율 상한(터미널 글이 흐려지지 않게)
const MARGIN = 24; // 누른 노드와 화면 가장자리 사이(화면 px)

const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const fit = (t, W, H) => Math.min((W * FILL) / t.w, (H * FILL) / t.h, ZOOM_MAX);

// node: { x, y, w, h }(판 좌표), dock: 덩어리 전체 사각형이나 null, screen: { width, height }
// → { cx, cy, zoom, mode: 'node' | 'dock' | 'node-close' }(cx, cy는 화면 가운데에 둘 판 좌표)
export function enterView({ node: r, dock = null, screen }) {
  const W = screen.width, H = screen.height;
  const zNode = fit(r, W, H);
  if (!dock) return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, zoom: zNode, mode: 'node' };
  const zFit = fit(dock, W, H);
  if (r.w * zFit >= FACE_CLOSE_PX) return { cx: dock.x + dock.w / 2, cy: dock.y + dock.h / 2, zoom: zFit, mode: 'dock' };
  // 좁고 긴 칸은 가까이 얼굴을 강제하면 화면 밖으로 잘린다. 전체 노드와 배율 상한을 먼저 지킨다.
  const zoom = Math.min(ZOOM_MAX, (W - 2 * MARGIN) / r.w, (H - 2 * MARGIN) / r.h, Math.max(zFit, NAV_CLOSE_PX / r.w));
  const vw = W / zoom, vh = H / zoom, m = MARGIN / zoom;
  // 누른 노드가 화면 안에 들어오는 가운데 범위 안에서 덩어리 가운데에 가장 가까운 곳
  const cx = clamp(dock.x + dock.w / 2, r.x + r.w - vw / 2 + m, r.x + vw / 2 - m);
  const cy = clamp(dock.y + dock.h / 2, r.y + r.h - vh / 2 + m, r.y + vh / 2 - m);
  return { cx, cy, zoom, mode: 'node-close' };
}

// 판 사각형 r이 화면(viewport: React Flow { x, y, zoom }, screen) 안에 다 보이는가(tol 화면 px까지 넘쳐도 본다)
export function fullyVisible(r, viewport, screen, tol = 2) {
  const z = viewport.zoom;
  const left = r.x * z + viewport.x, top = r.y * z + viewport.y;
  return left >= -tol && top >= -tol && left + r.w * z <= screen.width + tol && top + r.h * z <= screen.height + tol;
}

// 이미 그 노드를 보고 있는가. view: enterView의 결과.
// - 맞출 사각형(덩어리 모드면 덩어리, 아니면 노드)이 화면에 다 보이고 배율이 맞출 배율의 SEEN 이상이면 본다.
//   단 누른 노드가 가까이 얼굴(터미널)이어야 한다(멀리서 덩어리 전체가 보이는 것은 보는 것이 아니다).
// - 노드가 화면에 다 보이고 맞출 배율보다 더 가까이 보고 있으면(덩어리 안 노드를 크게 보는 중) 본다.
export const SEEN = 0.75;
export function isViewing({ node, dock = null, view, viewport, screen }) {
  const target = view.mode === 'dock' && dock ? dock : node;
  if (fullyVisible(target, viewport, screen) && viewport.zoom >= view.zoom * SEEN && node.w * viewport.zoom >= FACE_CLOSE_PX) return true;
  return fullyVisible(node, viewport, screen) && viewport.zoom >= view.zoom;
}

// 덩어리 구성 노드의 자리들 → 덩어리 전체 사각형
export function dockRect(rects) {
  const rs = rects.filter(Boolean);
  if (rs.length < 2) return null;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
