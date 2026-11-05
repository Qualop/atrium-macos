// P31: 판 전체 정리(board.arrange { all })에서 영역들을 다시 놓는 계산. 순수 함수만 둔다(단위 시험 있음).
// - 묶음(group): 맨 위 영역 하나(리포 영역은 P35부터 안의 워크트리 상자를 감싸므로 상자째, 또는 폴더 영역). 소속 없는 메모·칸반은 혼자 한 묶음이다.
//   P31의 "워크트리 위성은 리포 오른쪽 열" 규칙은 P35에서 뺐다(상자는 리포 영역 안에서 그 영역과 함께 움직인다).
// - 묶음끼리: 지금 읽는 순서(위에서 아래, 왼쪽에서 오른쪽)를 지켜 줄 단위로 왼쪽부터 채운다(선반 채우기). 줄 너비는 전체가 화면 비율(1.6)에 가깝게.
//   안이 빈 영역은 안이 있는 영역 뒤에, 소속 없는 메모·칸반은 맨 뒤에 둔다. 줄 안에서는 위를 맞추고, 묶음 사이와 줄 사이는 REGION_GAP이다.
// - 시작점은 지금 모든 묶음의 왼쪽 위다(판이 멀리 튀지 않게).
// - P44: 가상 그룹(ws-groups.mjs)에 든 영역은 먼저 그룹마다 사람이 정한 순서로 한 덩어리(cluster)로 채우고, 그 덩어리를 영역 하나처럼 놓는다.
//   덩어리 안은 REGION_GAP, 덩어리와 다른 것 사이는 그 두 배라 같은 그룹 영역끼리 모여 보인다. 캔버스에 그룹을 그리지는 않는다.
import { bbox, REGION_GAP } from './canvas.mjs';

// 선반 채우기: items([{ w, h }])를 줄 너비 rowW 안에서 왼쪽 위부터 놓는다 → [{ x, y }](x0, y0 기준)
function shelf(items, { gap, rowW, x0 = 0, y0 = 0 }) {
  let x = x0, y = y0, rowH = 0;
  return items.map((g) => {
    if (x > x0 && x - x0 + g.w > rowW + 1) { x = x0; y += rowH + gap; rowH = 0; }
    const at = { x, y };
    x += g.w + gap; rowH = Math.max(rowH, g.h);
    return at;
  });
}
const rowWidth = (items, gap, aspect) => Math.max(...items.map((g) => g.w), Math.sqrt(items.reduce((s, g) => s + (g.w + gap) * (g.h + gap), 0) * aspect));

// entries: [{ key, ws, rect: { x, y, w, h }, empty?, group?, order? }]
//   ws: 워크스페이스 키(소속 없는 것은 null), rect: 지금 영역(또는 메모·칸반) 사각형, empty: 안이 빈 영역
//   group: 가상 그룹 ID(없으면 그룹 없음), order: 그룹 안 순서(사람이 정함)
// → { shifts: Map key → { dx, dy }(옮길 것만), rects: Map key → 새 사각형, groups: [{ ws, keys, rect }], clusters: [{ group, keys, rect }] }
export function layoutRegions(entries, { gap = REGION_GAP, aspect = 1.6, origin = null, groupGap = null } = {}) {
  const list = (entries || []).filter((e) => e && e.rect && Number.isFinite(e.rect.x) && Number.isFinite(e.rect.y));
  if (!list.length) return { shifts: new Map(), rects: new Map(), groups: [], clusters: [] };
  // 1. 단위: 그룹 없는 영역(또는 메모·칸반) 하나, 또는 가상 그룹 하나(안의 영역을 미리 채운 덩어리)
  const units = [];
  const byGroup = new Map();
  for (const e of list) {
    if (e.ws && e.group != null && e.group !== '') { if (!byGroup.has(e.group)) byGroup.set(e.group, []); byGroup.get(e.group).push(e); continue; }
    units.push({ ws: e.ws || null, members: [{ e, dx: 0, dy: 0 }], free: !e.ws, w: e.rect.w, h: e.rect.h, now: e.rect, empty: !!e.ws && !!e.empty, key: String(e.key) });
  }
  for (const [id, es] of byGroup) {
    es.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.rect.y - b.rect.y || a.rect.x - b.rect.x || String(a.key).localeCompare(String(b.key)));
    const items = es.map((e) => ({ w: e.rect.w, h: e.rect.h }));
    const at = shelf(items, { gap, rowW: rowWidth(items, gap, aspect) });
    const box = bbox(es.map((e, i) => ({ x: at[i].x, y: at[i].y, w: e.rect.w, h: e.rect.h })));
    units.push({ ws: es[0].ws, group: id, members: es.map((e, i) => ({ e, dx: at[i].x, dy: at[i].y })), free: false, w: box.w, h: box.h, now: bbox(es.map((e) => e.rect)), empty: es.every((e) => e.empty), key: `group:${id}` });
  }
  // 2. 순서: 안이 있는 단위(지금 읽는 순서) → 빈 단위 → 소속 없는 메모·칸반
  const rank = (g) => (g.free ? 2 : g.empty ? 1 : 0);
  units.sort((a, b) => rank(a) - rank(b) || a.now.y - b.now.y || a.now.x - b.now.x || a.key.localeCompare(b.key));
  // 3. 줄 단위로 채운다. 줄 너비는 넓이 합으로 정한 목표(화면 비율)와 가장 넓은 단위 중 큰 쪽. 그룹이 있으면 단위 사이를 더 띄운다
  const outer = byGroup.size ? (groupGap ?? gap * 2) : gap;
  const o = origin || bbox(units.map((g) => g.now));
  const at = shelf(units, { gap: outer, rowW: rowWidth(units, outer, aspect), x0: o.x, y0: o.y });
  const rects = new Map();
  const shifts = new Map();
  const out = [];
  const clusters = [];
  units.forEach((g, i) => {
    for (const { e, dx, dy } of g.members) {
      const nr = { x: Math.round(at[i].x + dx), y: Math.round(at[i].y + dy), w: e.rect.w, h: e.rect.h };
      rects.set(e.key, nr);
      const sx = nr.x - e.rect.x, sy = nr.y - e.rect.y;
      if (sx || sy) shifts.set(e.key, { dx: Math.round(sx), dy: Math.round(sy) });
      out.push({ ws: e.ws || null, keys: [e.key], rect: { ...nr } });
    }
    if (g.group != null) clusters.push({ group: g.group, keys: g.members.map((m) => m.e.key), rect: { x: Math.round(at[i].x), y: Math.round(at[i].y), w: g.w, h: g.h } });
  });
  return { shifts, rects, groups: out, clusters };
}
