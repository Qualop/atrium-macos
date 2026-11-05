// 고른 노드 막대(P26, ARCH 4절 H6·H7)의 순수 함수(단위 시험 app/test/p26-lib.test.mjs). 부르는 곳은 Search.jsx SelectionBar.
// - 크기: "가로 | 세로" 토글 하나와 크게·보통·작게 단추 셋. 값은 P23의 여섯(canvas.mjs SIZE_STEPS·BAR_SIZES)이다.
//   지금 노드(덩어리면 덩어리 바깥)의 크기가 여섯 중 하나와 맞으면(±1px) 그 단추에 불이 들어온다. 고른 것이 여럿이면 모두 같은 단계일 때만.
// - 자리: 위 왼쪽·오른쪽 알약 묶음과 같은 줄(맨 위)의 가운데. 창 가운데에 두되 두 묶음 사이에 들어가게 민다.
//   두 묶음 사이가 좁으면 단계별로 줄이고(COMPACT_LEVELS), 가장 줄인 막대도 들어가지 않으면 그 아래 줄로 접는다.
import { SIZE_STEPS, BAR_SIZES } from '../../../../backend/src/canvas.mjs';

export const SIZE_DIRS = Object.keys(BAR_SIZES); // ['wide', 'tall']
export const SIZE_LEVELS = ['large', 'normal', 'small'];

// 크기 단계 열쇠 → { dir, i }(없는 열쇠면 null)
export function stepPlace(key) {
  for (const dir of SIZE_DIRS) { const i = BAR_SIZES[dir].indexOf(key); if (i >= 0) return { dir, i }; }
  return null;
}

// 사각형 크기와 맞는 막대 크기 단계(여섯 중). 없으면 null
export function sizeStepOf(r, tol = 1) {
  if (!r) return null;
  for (const dir of SIZE_DIRS) for (const k of BAR_SIZES[dir]) if (Math.abs(SIZE_STEPS[k].w - r.w) <= tol && Math.abs(SIZE_STEPS[k].h - r.h) <= tol) return k;
  return null;
}

// 고른 것들(혼자인 노드는 그 사각형, 덩어리는 바깥)이 모두 같은 단계면 그 열쇠, 아니면 null
export function litStep(rects) {
  const rs = (rects || []).filter(Boolean);
  if (!rs.length) return null;
  const k = sizeStepOf(rs[0]);
  return k && rs.every((r) => sizeStepOf(r) === k) ? k : null;
}

// 토글의 처음 쪽: 불이 들어온 단계의 쪽, 없으면 첫 사각형이 가로로 길면 wide
export function autoDir(rects, lit = litStep(rects)) {
  if (lit) return stepPlace(lit).dir;
  const r = (rects || []).find(Boolean);
  return r && r.h > r.w ? 'tall' : 'wide';
}

// 사각형 크기와 가장 가까운 dir 쪽 단계(넓이 비의 로그 거리가 가장 작은 것: 모양은 쪽이 정하고 크기 수준만 맞춘다)
export function nearestStep(r, dir) {
  if (!r || !(r.w > 0) || !(r.h > 0) || !BAR_SIZES[dir]) return null;
  const far = (k) => Math.abs(Math.log((SIZE_STEPS[k].w * SIZE_STEPS[k].h) / (r.w * r.h)));
  return BAR_SIZES[dir].reduce((best, k) => (far(k) < far(best) ? k : best));
}

// 토글을 누를 때 쓸 크기: 불이 들어온 단계가 있으면 다른 쪽의 같은 단계(보통 → 보통, 같은 쪽이면 null로 그대로).
// P30: 불이 없으면(붙여 막 만든 덩어리처럼 여섯 단계 어디에도 맞지 않으면) 누른 쪽에서 지금 크기(rect)와 가장 가까운 단계.
//      전에는 쪽만 바꿔서 토글이 아무 일도 하지 않는 것처럼 보였다. rect가 없으면 null(쪽만 바꾼다)
export function flipStep(lit, dir, rect = null) {
  const p = lit && stepPlace(lit);
  if (p) return p.dir !== dir ? BAR_SIZES[dir][p.i] : null;
  return nearestStep(rect, dir);
}

// 고른 노드 → 크기를 쓸 대상들(덩어리 안 노드는 그 덩어리 하나로). docks: [{ dockId, members }]
// → [{ id(크기를 보낼 세션), dockId | null, members }]
export function sizeTargets(selected, docks) {
  const out = [];
  const seen = new Set();
  for (const id of selected || []) {
    const d = (docks || []).find((x) => x.members.includes(id));
    if (d) { if (seen.has(d.dockId)) continue; seen.add(d.dockId); out.push({ id, dockId: d.dockId, members: d.members }); }
    else out.push({ id, dockId: null, members: [id] });
  }
  return out;
}

// 배치 틀에 들어갈 세션 수: 고른 노드와 그 노드가 든 덩어리의 구성 노드 모두(백엔드 dock.layout과 같다)
export function layoutCount(selected, docks) {
  const all = new Set();
  for (const t of sizeTargets(selected, docks)) t.members.forEach((m) => all.add(m));
  return all.size;
}

// 막대를 줄이는 단계(styles.css .mt-selbar[data-compact]): 0 다 펴짐, 1 이름 목록 숨김, 2 고른 수·고름 풀기를 짧게(수, ×), 3 배치 틀을 단추 하나로 접음(누르면 아래로 펼침)
export const COMPACT_LEVELS = 4;

// 막대 자리. width: 막대가 놓이는 곳(캔버스)의 너비, tlRight·trLeft: 위 왼쪽 묶음의 오른쪽 끝, 위 오른쪽 묶음의 왼쪽 끝(같은 기준의 px),
// widths: 줄이는 단계마다 막대 너비, gap: 묶음과 막대 사이
// → { row: 'top', level, x, w }(맨 위 줄, 들어가는 가장 낮은 단계, 왼쪽 x와 너비 w) | { row: 'below', level: 0 }(그 아래 줄 가운데, 다 펴서)
export function placeBar({ width, tlRight = 0, trLeft = width, widths, gap = 12 }) {
  const lo = tlRight + gap, hi = trLeft - gap;
  const room = hi - lo;
  const level = (widths || []).findIndex((w) => w <= room);
  if (level < 0) return { row: 'below', level: 0 };
  const w = widths[level];
  const x = Math.min(Math.max((width - w) / 2, lo), hi - w);
  return { row: 'top', level, x: Math.round(x), w: Math.ceil(w) };
}
