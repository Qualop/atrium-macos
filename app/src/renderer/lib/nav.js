// 노드로 들어갈 때의 화면(P10, P26, ARCH 4절 H4·H5). 순수 함수만 둔다(단위 시험 app/test/p10-lib.test.mjs, p26-lib.test.mjs). 부르는 곳은 Canvas.jsx의 navigateTo.
// - P26: 혼자인 노드는 노드가 화면을 적당히(높이나 너비의 FILL = 85%) 채우게 확대한다. 배율 상한은 ZOOM_MAX(1).
//   터미널(xterm)은 노드 크기로 그린 그림을 화면 배율로 늘리므로, 1보다 크게 하면 글이 흐려진다.
// - 덩어리(붙여 묶기) 안의 노드: 덩어리 전체가 화면을 같은 몫으로 채운다(상한 같음).
//   그렇게 맞춘 배율에서 누른 노드가 가까이 얼굴(360px)이 못 되면, 누른 노드를 가까이 얼굴로 두고(터미널에 바로 칠 수 있게)
//   그 배율에서 덩어리가 최대한 많이 보이도록 가운데를 덩어리 쪽으로 옮긴다. 좁거나 긴 노드는 전체가 보이는 범위와 배율 상한을 먼저 지킨다.
// - P26: 이미 그 노드(덩어리)를 보고 있으면 화면을 옮기지 않는다(isViewing). 터미널을 누를 때마다 화면이 흔들리지 않게.
// - P73: 창은 떠 있는 크롬(위 알약 줄, 아래 칩 줄·바, 오른쪽 아래 배율 단추, 레일)이 덮는 가장자리(inset, lib/chrome-inset.js)를 주고, 노드(덩어리)는 그 밖 남은 칸의
//   NAV_FILL(99%)을 채운다(전에는 화면 전체의 85%). 크롬과는 NAV_GAP(6px)만 띄운다. 크롬은 가리지 않고 둘레 여백만 줄인다. 가운데도 남은 칸의 가운데로 맞춘다.
//   inset을 주지 않으면 예전대로 화면 전체의 FILL.
import { FACE_CLOSE_PX } from './faces.js';

export const NAV_CLOSE_PX = 380; // 들어갈 때 노드가 차지할 가장 작은 화면 너비(가까이 얼굴 경계 360 + 여유)
export const FILL = 0.85; // 노드(덩어리)가 화면에서 차지할 몫
export const ZOOM_MAX = 1; // 들어갈 때 배율 상한(터미널 글이 흐려지지 않게)
export const NAV_FILL = 0.99; // P73: 크롬을 뺀 남은 칸에서 노드(덩어리)가 차지할 몫
export const NAV_GAP = 6; // P73: 크롬과 남은 칸 사이 틈(px, 전체 보기·영역으로 가기는 12)
const MARGIN = 24; // 누른 노드와 화면 가장자리 사이(화면 px)

const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
// P73: 크롬이 덮는 가장자리(inset)를 빼고 남은 칸 { w, h, ox, oy }(ox, oy: 남은 칸 가운데가 화면 가운데에서 떨어진 화면 px)
export function navRoom(screen, inset = null) {
  if (!inset) return { w: screen.width, h: screen.height, ox: 0, oy: 0, fill: FILL };
  const l = inset.left || 0, r = inset.right || 0, t = inset.top || 0, b = inset.bottom || 0;
  return { w: Math.max(1, screen.width - l - r), h: Math.max(1, screen.height - t - b), ox: (l - r) / 2, oy: (t - b) / 2, fill: NAV_FILL };
}
const fitIn = (t, room) => Math.min((room.w * room.fill) / t.w, (room.h * room.fill) / t.h, ZOOM_MAX);

// node: { x, y, w, h }(판 좌표), dock: 덩어리 전체 사각형이나 null, screen: { width, height }, inset: 크롬이 덮는 가장자리(px, 없으면 화면 전체)
// → { cx, cy, zoom, mode: 'node' | 'dock' | 'node-close' }(cx, cy는 화면 가운데에 둘 판 좌표)
export function enterView({ node: r, dock = null, screen, inset = null }) {
  const room = navRoom(screen, inset);
  const at = (t, z) => ({ cx: t.x + t.w / 2 - room.ox / z, cy: t.y + t.h / 2 - room.oy / z });
  const zNode = fitIn(r, room);
  if (!dock) return { ...at(r, zNode), zoom: zNode, mode: 'node' };
  const zFit = fitIn(dock, room);
  if (r.w * zFit >= FACE_CLOSE_PX) return { ...at(dock, zFit), zoom: zFit, mode: 'dock' };
  // Fit the entire leaf before attempting a close face, including tall or narrow leaves.
  const margin = inset ? 0 : MARGIN;
  const zoom = Math.min(ZOOM_MAX, Math.max(1, room.w - 2 * margin) / r.w, Math.max(1, room.h - 2 * margin) / r.h, Math.max(zFit, NAV_CLOSE_PX / r.w));
  const vw = room.w / zoom, vh = room.h / zoom, m = margin / zoom;
  // 누른 노드가 화면 안에 들어오는 가운데 범위 안에서 덩어리 가운데에 가장 가까운 곳
  const cx = clamp(dock.x + dock.w / 2, r.x + r.w - vw / 2 + m, r.x + vw / 2 - m);
  const cy = clamp(dock.y + dock.h / 2, r.y + r.h - vh / 2 + m, r.y + vh / 2 - m);
  return { cx: cx - room.ox / zoom, cy: cy - room.oy / zoom, zoom, mode: 'node-close' };
}

// 판 사각형 r이 화면(viewport: React Flow { x, y, zoom }, screen) 안에 다 보이는가(tol 화면 px까지 넘쳐도 본다)
export function fullyVisible(r, viewport, screen, tol = 2, inset = null) {
  const z = viewport.zoom;
  const left = r.x * z + viewport.x, top = r.y * z + viewport.y;
  return left >= (inset?.left || 0) - tol && top >= (inset?.top || 0) - tol && left + r.w * z <= screen.width - (inset?.right || 0) + tol && top + r.h * z <= screen.height - (inset?.bottom || 0) + tol;
}

// 이미 그 노드를 보고 있는가. view: enterView의 결과.
// - 맞출 사각형(덩어리 모드면 덩어리, 아니면 노드)이 화면에 다 보이고 배율이 맞출 배율의 SEEN 이상이면 본다.
//   단 누른 노드가 가까이 얼굴(터미널)이어야 한다(멀리서 덩어리 전체가 보이는 것은 보는 것이 아니다).
// - 노드가 화면에 다 보이고 맞출 배율보다 더 가까이 보고 있으면(덩어리 안 노드를 크게 보는 중) 본다.
export const SEEN = 0.75;
export function isViewing({ node, dock = null, view, viewport, screen, inset = null }) {
  const target = view.mode === 'dock' && dock ? dock : node;
  if (fullyVisible(target, viewport, screen, 2, inset) && viewport.zoom >= view.zoom * SEEN && node.w * viewport.zoom >= FACE_CLOSE_PX) return true;
  return fullyVisible(node, viewport, screen, 2, inset) && viewport.zoom >= view.zoom;
}

// 덩어리 구성 노드의 자리들 → 덩어리 전체 사각형
export function dockRect(rects) {
  const rs = rects.filter(Boolean);
  if (rs.length < 2) return null;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
