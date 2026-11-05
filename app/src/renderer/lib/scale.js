// P45 배율: 터미널 글자 배율과 화면(창 전체 UI) 배율. 순수 함수만 둔다(단위 시험 test/p45-lib.test.mjs).
// - 값은 1 = 100%(P44까지의 크기)인 소수로 다루고, 70~150%를 5% 단위로 받는다. 이 창(프로필)의 localStorage에 둔다(환경마다 다르므로 판 설정에 두지 않는다).
// - 터미널 글자 크기 = 기준 크기 × 배율(0.1px 단위). 노드 크기가 같으면 줄·칸 수가 그만큼 바뀐다.
// - 화면 배율은 Electron 창의 확대(webFrame.setZoomFactor)라 CSS px와 마우스 좌표가 함께 바뀐다. 터미널 칸 계산(P38 unscalePoint)은 그대로 맞는다.
export const SCALE_MIN = 0.7;
export const SCALE_MAX = 1.5;
export const SCALE_STEP = 0.05;
export const SCALE_KEYS = { term: 'mt.termScale', ui: 'mt.uiScale' };

// 아무 값 → 70~150% 안의 5% 단위 소수. 숫자가 아니면 1
export function clampScale(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return 1;
  const stepped = Math.round(n / SCALE_STEP) * SCALE_STEP;
  return Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, stepped)) * 100) / 100;
}
export const pctOf = (f) => Math.round(clampScale(f) * 100);
// P49: 웹 화면의 화면 배율(뿌리 요소의 CSS zoom). Electron은 webFrame(preload), 웹은 이 값. 저장된 글이 이상하면 1
export function webZoomOf(v) { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= SCALE_MIN && n <= SCALE_MAX ? n : 1; }
// 입력칸의 백분율 글("120", "120%", " 85 ") → 소수. 못 읽으면 null(입력을 그대로 둔다)
export function parsePct(text) {
  const m = String(text ?? '').trim().replace(/%$/, '').trim();
  if (!/^\d+(\.\d+)?$/.test(m)) return null;
  return clampScale(Number(m) / 100);
}
// −·+ 단추: 한 단계(5%) 옮긴다
export const stepScale = (f, dir) => clampScale(clampScale(f) + (dir < 0 ? -SCALE_STEP : SCALE_STEP));

// 저장소(localStorage 같은 것)에서 읽기와 쓰기. 저장소가 없거나 막혀도 1로 동작한다
export function readScale(storage, key) {
  try { const v = storage && storage.getItem(key); return v == null ? 1 : clampScale(v); } catch { return 1; }
}
export function saveScale(storage, key, f) {
  const v = clampScale(f);
  try { if (storage) { if (v === 1) storage.removeItem(key); else storage.setItem(key, String(v)); } } catch {}
  return v;
}

// 터미널 글자 크기(px). 0.1px 단위
export const termFontSize = (base, f) => Math.round(base * clampScale(f) * 10) / 10;
