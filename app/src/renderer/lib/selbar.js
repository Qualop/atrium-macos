// 고른 노드 막대(P26, P73, ARCH 4절 H6·H7)의 순수 함수(단위 시험 app/test/p26-lib.test.mjs, p73-lib.test.mjs). 부르는 곳은 Search.jsx SelectionBar.
// - P73: 크기는 방향(가로 | 세로) × 종횡비(16:9 | 4:3) × 단계(크게·보통·작게)다(canvas.mjs SIZE_TABLE, resolveSize).
//   세로에서 비율 단추의 글은 돌린 비율(9:16, 3:4)이다. P80: 덩어리는 틀 비율을 지키고, 바깥을 같은 규칙의 단독 세션 하나로 본다(dock-tree.mjs dockVirtual·dockFit).
//   비율 불은 판 기록에 남긴 비율(노드 aspect, 덩어리 aspect)이 있고 사각형이 그 비율에 맞을 때만, 단계 불은 비율에 불이 있고 넓이가 그 단계일 때만.
//   고른 것이 여럿이면 모두 같을 때만 불이 들어온다.
// - P73: 세션 하나만 골라도 막대가 뜬다(크기와 비율만). 배치 틀은 덩어리에 든 세션이나 세션 둘 이상을 골랐을 때(틀에 들어갈 세션이 둘 이상).
// - 자리: 위 왼쪽·오른쪽 알약 묶음과 같은 줄(맨 위)의 가운데. 창 가운데에 두되 두 묶음 사이에 들어가게 민다.
//   두 묶음 사이가 좁으면 단계별로 줄이고(COMPACT_LEVELS), 가장 줄인 막대도 들어가지 않으면 그 아래 줄로 접는다.
import { SIZE_DIRS, SIZE_LEVELS, ASPECT_KEYS, dirOf, aspectOf, levelOf, stepSize, nearestAspect, bbox } from '../../../../backend/src/canvas.mjs';
import { dockVirtual, dockFit } from '../../../../backend/src/dock-tree.mjs';

export { SIZE_DIRS, SIZE_LEVELS, ASPECT_KEYS };

// 비율 단추의 글: 세로면 돌린 비율(16:9 → 9:16)
export const aspectLabel = (aspect, dir) => { if (dir !== 'tall') return aspect; const [a, b] = aspect.split(':'); return `${b}:${a}`; };

// 사각형(혼자인 노드는 그 노드, 덩어리는 바깥)과 기록한 비율 → { dir, aspect(불), level(불) }
export function blockState(rect, stored = null) {
  if (!rect) return null;
  const aspect = aspectOf(rect, stored);
  return { dir: dirOf(rect), aspect, level: aspect ? levelOf(rect, aspect) : null };
}

// P80: 덩어리의 상태. 바깥을 같은 규칙의 단독 세션 하나(single)로 보고 단독 세션처럼 불을 켠다(백엔드 canvas-ops dockState와 같다)
// tree: 덩어리 나무, memberRects: 구성 노드 사각형 → { dir, aspect, level, single } | null
export function dockState(tree, memberRects, stored = null) {
  const v = dockVirtual(tree, bbox(memberRects || []));
  return v ? { ...blockState(v, stored), single: v } : null;
}
// P80: 덩어리 단계 단추의 풀이 크기(그 단계의 덩어리 바깥). single은 dockState의 single(불이 없을 때 가까운 비율을 고른다)
export function dockLevelSize(level, { dir, aspect, tree, single = null }) {
  return dockFit(tree, levelSize(level, { dir, aspect, rect: single }));
}

// 고른 것들의 상태 → 막대의 불. 방향은 첫 것, 비율·단계는 모두 같을 때만
export function litOf(states) {
  const ss = (states || []).filter(Boolean);
  if (!ss.length) return { dir: 'wide', aspect: null, level: null };
  const same = (k) => (ss.every((x) => x[k] === ss[0][k]) ? ss[0][k] : null);
  return { dir: ss[0].dir, aspect: same('aspect'), level: same('level') };
}

// 단계 단추의 풀이 글에 쓸 크기(지금 방향과 불이 든 비율, 없으면 모양이 가까운 비율)
export function levelSize(level, { dir, aspect, rect = null }) {
  return stepSize(dir, aspect || (rect ? nearestAspect(rect) : '16:9'), level);
}

// 막대를 보일까: 세션을 하나라도 골랐으면. 배치 틀은 틀에 들어갈 세션이 둘 이상일 때
export const showBar = (selected) => (selected || []).length >= 1;
export const showLayouts = (selected, docks) => layoutCount(selected, docks) >= 2;

// 배치 틀 단추를 그림 대신 글자로(H: 모두 가로 한 줄, V: 모두 세로 한 줄). 칸이 다섯 넘게 많으면 그림이 읽히지 않는다
export const LINE_GLYPH_FROM = 5;
export function presetGlyph(id, n) {
  if (n < LINE_GLYPH_FROM) return null;
  return id === 'row' ? 'H' : id === 'col' ? 'V' : null;
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

// 막대를 줄이는 단계(styles.css .mt-selbar[data-compact]): 0 다 펴짐, 1 이름 목록 숨김, 2 고른 수·고름 풀기를 짧게(수, ×), 3 배치 틀을 단추 하나로 접음(누르면 아래로 펼침),
// 4(P73) 방향·단계 단추의 글을 짧게(가로·세로는 모양 그림, 크게·보통·작게는 한 글자). 비율 단추(16:9, 4:3)는 이미 짧아 그대로
export const COMPACT_LEVELS = 5;

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

// P141(#16): 선택 막대(bar)가 고른 노드 머리줄(heads, 화면 사각형)을 덮으면 판을 아래로 옮길 픽셀(머리줄 위가 막대 아래 gap까지). 안 덮으면 0
export function headClearance(bar, heads, gap = 8) {
  if (!bar) return 0;
  let dy = 0;
  for (const h of heads || []) {
    const ox = Math.min(bar.right, h.right) - Math.max(bar.left, h.left), oy = Math.min(bar.bottom, h.bottom) - Math.max(bar.top, h.top);
    if (ox > 4 && oy > 0) dy = Math.max(dy, bar.bottom + gap - h.top);
  }
  return Math.round(dy);
}
