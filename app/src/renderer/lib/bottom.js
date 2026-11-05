// P43: 아래 바(명령 바와 빠른 동작 칩)의 자동 숨김 판단. 순수 함수만 둔다(단위 시험 test/p43-lib.test.mjs).
// 평소에는 숨고, 마우스가 창 아래 가장자리 띠(명령 바 가로 폭 언저리)에 오면 나타난다. 벗어나면 잠시 뒤 숨는다.
// 붙잡는 까닭(명령 바 초점, 쓰다 만 글, 위 펼침, 칩 쓰는 중, 시험 고정)이 하나라도 있으면 숨지 않는다.

export const BAND_PX = 28; // 띠 높이: 판 아래 끝에서 위로
export const BAND_SIDE_PX = 48; // 띠 가로: 명령 바 양옆으로 더 넓힌 폭
export const SHOW_DELAY_MS = 90; // 띠에 이만큼 머물면 나타난다(지나가는 마우스는 띄우지 않는다)
export const HIDE_DELAY_MS = 650; // 띠와 바를 벗어나 이만큼 지나면 숨는다

// p: 마우스 점(창 좌표), bar: 명령 바 가로 범위 { left, right }, bottom: 판 아래 끝(창 좌표) → 띠 안인가
export function inBand(p, { left, right, bottom }, band = BAND_PX, side = BAND_SIDE_PX) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  return p.y >= bottom - band && p.y <= bottom && p.x >= left - side && p.x <= right + side;
}

// 숨지 않게 붙잡는 까닭 하나(없으면 null). 마우스 자리는 보지 않는다
// focused: 명령 바 안에 초점, draft: 입력칸에 쓰다 만 글, popup: 위 펼침(대상 후보, Thread), menu: 칩 줄 안에 초점, pinned: 시험 고정
export function holdReason({ focused, draft, popup, menu, pinned } = {}) {
  if (pinned) return 'pinned';
  if (focused) return 'focus';
  if (draft) return 'draft';
  if (popup) return 'popup';
  if (menu) return 'menu';
  return null;
}

// 지금 보여야 하는가. zone: 마우스가 'band'(아래 띠) | 'bar'(보이는 바·칩 위) | 'out'
export function bottomWanted(s = {}) {
  return !!holdReason(s) || s.zone === 'band' || s.zone === 'bar';
}

// 다음 상태와 그때까지 기다릴 시간. 같은 상태면 delay 0(기다리던 바꿈은 버린다).
// 붙잡는 까닭으로 나타날 때는 바로(키보드로 들어온 것), 띠로 나타날 때는 SHOW_DELAY_MS 뒤, 숨을 때는 HIDE_DELAY_MS 뒤
export function bottomNext(s = {}) {
  const want = bottomWanted(s);
  if (want === !!s.shown) return { shown: want, delay: 0 };
  if (want) return { shown: true, delay: holdReason(s) || s.zone === 'bar' ? 0 : SHOW_DELAY_MS };
  return { shown: false, delay: HIDE_DELAY_MS };
}
