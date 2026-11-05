// P52(#5): 전체 보기와 영역으로 가기가 떠 있는 크롬(위 알약, 왼쪽·오른쪽 레일, 보이는 아래 바)을 비키게 하는 순수 함수(단위 시험 app/test/p52-lib.test.mjs).
// 크롬은 캔버스 위에 떠 있으므로, 맞출 때 캔버스 가장자리에서 크롬이 덮는 만큼을 빼고 남은 칸 안에 맞춘다.

// view: 캔버스 사각형 { left, top, right, bottom }(화면 좌표), parts: { top, left, right, bottom: [크롬 사각형] }(보이는 것만)
// → { top, left, right, bottom }(px). 한쪽 여백은 그 방향 길이의 max 비율을 넘지 않는다(작은 창에서 맞출 칸이 없어지지 않게)
export function chromeInset(view, parts = {}, { gap = 12, max = 0.3 } = {}) {
  const W = Math.max(0, view.right - view.left), H = Math.max(0, view.bottom - view.top);
  const ok = (r) => r && r.right > r.left && r.bottom > r.top;
  const edge = (list, f) => (list || []).filter(ok).reduce((m, r) => Math.max(m, f(r)), 0);
  const top = edge(parts.top, (r) => r.bottom - view.top);
  const left = edge(parts.left, (r) => r.right - view.left);
  const right = edge(parts.right, (r) => view.right - r.left);
  const bottom = edge(parts.bottom, (r) => view.bottom - r.top);
  const cap = (v, len) => (v > 0 ? Math.round(Math.min(v + gap, len * max)) : 0);
  return { top: cap(top, H), left: cap(left, W), right: cap(right, W), bottom: cap(bottom, H) };
}

// b: 판 좌표 사각형 { x, y, w, h }, screen: { width, height }, inset: chromeInset 결과
// fill: 남은 칸 가운데 채울 비율(1이면 꽉, 0.92면 둘레를 조금 띄운다) → React Flow 뷰포트 { x, y, zoom }
export function fitInset(b, screen, inset = {}, { minZoom = 0.05, maxZoom = 1, fill = 1 } = {}) {
  if (!b || !(b.w > 0) || !(b.h > 0)) return null;
  const l = inset.left || 0, r = inset.right || 0, t = inset.top || 0, bt = inset.bottom || 0;
  const iw = Math.max(1, screen.width - l - r), ih = Math.max(1, screen.height - t - bt);
  const zoom = Math.max(minZoom, Math.min(maxZoom, (iw * fill) / b.w, (ih * fill) / b.h));
  return { x: l + (iw - b.w * zoom) / 2 - b.x * zoom, y: t + (ih - b.h * zoom) / 2 - b.y * zoom, zoom };
}
