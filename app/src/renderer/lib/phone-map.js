// P166: 휴대폰 세션 맵(PhoneMap.jsx) = PC 세션 맵과 같은 무한 캔버스. 손가락 판정과 시점 셈·기억만 둔다(순수 함수, 단위 시험 test/p166-lib.test.mjs).
// 배치는 PC와 같은 lib/mission-lineage.js lineageLayout(phone: true, 세로 화면 배치)을 쓴다.
import { zoomAt, panBy, fitView, centerOn, clampK } from './mission-terr.js';

// LONG_MS 동안 SLOP 안에 머물면 길게 누르기(미리 보기). 그 전에 SLOP을 넘으면 끌기(시점 이동), 그 전에 떼면 누르기(세션 열기)
// DOCK = 맞춤에서 아래 줌 단추 자리로 비우는 높이
export const PM = { LONG_MS: 480, SLOP: 10, PAD: 12, DOCK: 58, FIT_MAX: 1, GO_K: 1.1, SAVE_MS: 250 };
export const VIEW_KEY = 'atrium.phoneMap.view';

// 손가락 판정. n = 닿아 있는 손가락 수(이번 손짓에서 가장 많았던 수), dx·dy = 처음 자리에서 움직인 거리, dt = 누른 뒤 지난 시간, lifted = 뗐는가
// → 'pinch'(두 손가락 확대·축소) | 'pan'(끌기) | 'long'(길게 누르기) | 'tap'(누르기) | 'wait'(아직 모름)
export function touchIntent({ n = 1, dx = 0, dy = 0, dt = 0, lifted = false, moved = false } = {}) {
  if (n >= 2) return 'pinch';
  if (moved || Math.hypot(dx, dy) > PM.SLOP) return 'pan';
  if (dt >= PM.LONG_MS) return 'long';
  return lifted ? 'tap' : 'wait';
}

// 두 손가락: 처음 보기 v0, 처음 가운데 m0·거리 d0 → 지금 가운데 m·거리 d. 처음 가운데 아래 세계 점이 손가락 가운데를 따라간다
export function pinchView(v0, m0, d0, m, d) {
  const z = zoomAt(v0, m0.x, m0.y, v0.k * (Math.max(1, d) / Math.max(1, d0)));
  return panBy(z, m.x - m0.x, m.y - m0.y);
}

// 맞춤: 세계 전체를 보이는 칸(vw × vh, 아래 줌 단추 자리 빼고)에. 가까이 단계 위로는 키우지 않는다
export const phoneFit = (bounds, vw, vh) => fitView(bounds, vw, vh, { pad: PM.PAD, bottom: PM.DOCK, max: PM.FIT_MAX });
// 카드로 가기(위 알약): 카드 폭이 화면 폭에 거의 차게(지금 배율이 더 크면 그대로)
export function goView(b, v, vw, vh) {
  const k = Math.max(v ? v.k : 0, Math.min(PM.GO_K, (vw - 32) / Math.max(1, b.w)));
  return centerOn(b.x + b.w / 2, b.y + b.h / 2, k, vw, vh);
}

// 시점 기억: 기기(브라우저 저장소)에 화면 크기마다 하나. 세로·가로 돌리면 따로. 저장소가 없거나 깨져도 맞춤으로 연다
export const sizeKey = (s) => (s ? `${Math.round(s.w / 20) * 20}x${Math.round(s.h / 20) * 20}` : '');
const ok = (v) => !!v && [v.k, v.x, v.y].every((x) => typeof x === 'number' && Number.isFinite(x)) && v.k > 0;
export function loadView(store, size) {
  try {
    const all = JSON.parse((store && store.getItem(VIEW_KEY)) || '{}');
    const v = all && all[sizeKey(size)];
    return ok(v) ? { k: clampK(v.k), x: v.x, y: v.y } : null;
  } catch { return null; }
}
export function saveView(store, size, v) {
  if (!store || !ok(v) || !size) return false;
  try {
    let all = {};
    try { all = JSON.parse(store.getItem(VIEW_KEY) || '{}') || {}; } catch { all = {}; }
    const keys = Object.keys(all).filter((k) => k !== sizeKey(size)).slice(-5); // 화면 크기는 몇 개만 기억
    const next = Object.fromEntries(keys.map((k) => [k, all[k]]));
    next[sizeKey(size)] = { k: Math.round(v.k * 1e4) / 1e4, x: Math.round(v.x), y: Math.round(v.y) };
    store.setItem(VIEW_KEY, JSON.stringify(next));
    return true;
  } catch { return false; }
}
export const clearView = (store, size) => { try { const all = JSON.parse(store.getItem(VIEW_KEY) || '{}') || {}; delete all[sizeKey(size)]; store.setItem(VIEW_KEY, JSON.stringify(all)); } catch { /* 지우지 못해도 된다 */ } };
// 처음 보기: 이 화면 크기에서 기억한 보기, 없으면 맞춤
export const openView = (store, size, bounds) => loadView(store, size) || phoneFit(bounds, size.w, size.h);
