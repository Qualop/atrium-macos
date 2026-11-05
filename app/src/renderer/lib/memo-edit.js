// P50(#6): 메모 편집을 시작할 화면. 순수 함수만 둔다(단위 시험 app/test/p50-lib.test.mjs). 부르는 곳은 Canvas.jsx의 showMemoForEdit.
// 메모는 화면 너비 MEMO_FAR_PX 아래에서 먼 얼굴(첫 줄만 크게)이 되어 ✎와 입력칸이 없다. 전체 보기에서 만든 메모나 먼 얼굴을 두 번 누른 메모는
// 화면을 그 메모로 옮겨 편집할 수 있는 크기(MEMO_EDIT_PX 이상, 배율 상한 1)로 보인 뒤 편집을 연다. 이미 편집할 수 있게 다 보이면 화면은 그대로다.
import { fullyVisible } from './nav.js';

export const MEMO_FAR_PX = 220; // 메모 먼 얼굴 경계(화면 px)
export const MEMO_EDIT_PX = 360; // 편집을 열 때 메모가 차지할 가장 작은 화면 너비
const FILL = 0.85;

export const memoFar = (w, zoom) => w * zoom < MEMO_FAR_PX;

// memo: { x, y, w, h }(판 좌표), viewport: React Flow { x, y, zoom }, screen: { width, height } → null(그대로) | { cx, cy, zoom }
export function memoEditView({ memo, viewport, screen }) {
  if (!memoFar(memo.w, viewport.zoom) && fullyVisible(memo, viewport, screen)) return null;
  const zFit = Math.min((screen.width * FILL) / memo.w, (screen.height * FILL) / memo.h, 1);
  const zoom = Math.min(zFit, Math.max(viewport.zoom, MEMO_EDIT_PX / memo.w));
  return { cx: memo.x + memo.w / 2, cy: memo.y + memo.h / 2, zoom };
}
