// P52(#5): 대화상자와 떠 있는 창의 공용 판단(단위 시험 app/test/p52-lib.test.mjs). DOM을 쓰는 쪽은 renderer/dialog.js.
// - 쌓기: 열린 것들을 연 차례로 쌓고, Esc는 맨 위 하나만 닫는다.
// - 대화상자(modal): 열면 초점이 안으로 들어가고, Tab은 안에서 돌고, 닫으면 연 단추로 초점이 돌아간다. Esc는 어디서 눌러도 닫는다.
// - 떠 있는 창(panel: 변경 내역, 루프 목록): 판을 막지 않으므로 초점을 가져가지 않는다(복귀 요약은 저절로 뜨므로 치던 글을 뺏지 않는다).
//   Esc는 그 창 안이거나, 터미널·입력 칸 밖(판, 단추)에 초점이 있을 때만 닫는다. 터미널의 Esc는 에이전트의 끊기다.

// 맨 위(마지막에 연) 것
export const topOf = (stack) => (stack && stack.length ? stack[stack.length - 1] : null);

// ev: { key, isComposing, defaultPrevented, inside(맨 위 안인가), inTerminal, inField(입력 칸·편집 중인가) }
// → 닫을 맨 위 항목의 id 또는 null
export function escTarget(stack, ev) {
  const top = topOf(stack);
  if (!top || !ev || ev.key !== 'Escape' || ev.isComposing || ev.defaultPrevented) return null;
  if (top.modal) return top.id;
  if (ev.inside) return top.id;
  if (ev.inTerminal || ev.inField) return null;
  return top.id;
}

// Tab 가두기: 초점 갈 수 있는 것 n개, 지금 자리 i(-1이면 밖), shift → 갈 자리. n이 0이면 -1
export function trapIndex(n, i, shift) {
  if (n <= 0) return -1;
  if (i < 0) return shift ? n - 1 : 0;
  if (shift) return i === 0 ? n - 1 : i - 1;
  return i === n - 1 ? 0 : i + 1;
}

// 열 때 초점을 줄 것: 첫 입력 칸(입력, 고르기, 글 상자). 없으면 null(그때는 상자 자체에 초점을 준다).
// 확인 대화상자의 첫 단추(닫기, 지우기)에 초점을 주면 Enter 한 번에 되돌릴 수 없는 일이 생기므로 단추는 고르지 않는다
// items: [{ tag, type, disabled, hidden, autofocus }]
export function firstFieldIndex(items) {
  const ok = (x) => x && !x.disabled && !x.hidden;
  const a = (items || []).findIndex((x) => ok(x) && x.autofocus);
  if (a >= 0) return a;
  return (items || []).findIndex((x) => ok(x) && (x.tag === 'TEXTAREA' || x.tag === 'SELECT' || (x.tag === 'INPUT' && !['hidden', 'checkbox', 'radio', 'button', 'submit'].includes(x.type))));
}

export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
