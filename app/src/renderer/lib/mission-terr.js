// P152·P153: 미션 맵 A "Territories"(영토 지도) 배치와 무한 캔버스 셈. 순수 함수만 둔다(단위 시험 test/p152-lib.test.mjs, test/p153-lib.test.mjs).
// 그리는 쪽: PC는 P153 r7부터 시안 B(lib/mission-lineage.js, MissionLineage.jsx)라 이 파일의 영토 배치(territoryLayout·phoneTerr)는 P160부터 창에서 쓰지 않는다(휴대폰은 P166부터 PhoneMap.jsx = lineageLayout phone, 단위 시험만 남음). 길 찾기(routeOrtho)·카드 폭·높이·무한 캔버스 셈은 PC도 같이 쓴다.
// - 폴더(사이드바 가상 그룹, P44) = 색 점선 영토, 워크스페이스 = 영토 안의 섬(머리에 이름과 상태 수 칩), 폴더 밖 워크스페이스 = 영토 없는 점선 섬.
//   소속과 차례는 사이드바(lib/sidebar-tree.js groupLayout)와 같다: 폴더가 사이드바 차례로 먼저, 폴더 안은 폴더 목록 차례, 그 뒤에 폴더 밖 워크스페이스(판 차례).
//   키는 맞출 때만 정규화한다(normKey: 역슬래시 → 슬래시, 끝 슬래시 뺌, 소문자). 폴더 목록에 없는 워크스페이스는 경로가 폴더 안이어도 폴더 밖이다(사이드바와 같다).
// - 팀(무리) = 같은 워크스페이스 안에서 나무로 이어진 세션들(lib/mission-model.js missionTree: 부모 > 역할 연결 > 띄움 > 시킨 연결 차례로 부모를 고른다).
//   그래서 역할 연결이나 주고받은 연결로만 이어진 세션도 한 무리로 붙는다. 리드가 위, 하위가 아래로 내려가는 나무(가운데 맞춤).
//   하위가 없는 하위(잎)는 한 줄에 KCOLS개까지 놓고 넘으면 다음 줄로 접는다. 둘째 줄부터는 잎 묶음 왼쪽의 줄기를 타고 내려간다.
//   부모가 닫힌 세션은 부모가 판에 없으니 뿌리(혼자 또는 리드)다. 부모가 다른 워크스페이스에 있으면 자기 섬에 놓고(혼자 또는 리드) 부모와는 다른 워크스페이스 선(cross)으로 잇는다.
// - 혼자인 세션(그 워크스페이스 안에 부모도 하위도 없는 세션) = 무리 오른쪽 한 줄 기둥(무리 높이만큼, 넘치면 옆 기둥). 무리가 없으면 넷까지 한 기둥.
// - 겹침 없음: 무리·기둥은 섬 안에서, 섬은 영토 안에서, 영토와 폴더 밖 섬은 세계에서 선반 쌓기(shelf)로 놓는다.
//   목표 폭은 여러 값을 해 보고 정해진 비율(세계는 화면 비율) 상자에 가장 크게 들어가는 것을 고른다(bestShelf). 그래서 처음 맞춤 배율이 가장 크다.
// - 선은 모두 직각으로 꺾인다. 같은 무리 안의 나무 선은 부모 아래 가운데 → 버스(카드 사이 틈) → 하위 위 가운데.
//   다른 섬으로 가는 선은 격자 길 찾기(routeOrtho)로 카드·섬 머리·무리 머리·영토 이름을 피해 가고, 먼저 그은 선과 겹치면 옆 칸으로 비켜 나란히 간다. 이름표는 가장 긴 가로 토막 가운데.
//   나무 밖 연결(나무 선의 거꾸로 짝, 리드가 손자에게 직접 시킨 것 등)은 그리지 않는다(카드의 관계 줄과 풍선 도움말이 말한다).
// → { cards: Map id → { x, y, w, h, node, ws }, rings, isles, terrs, edges, bounds, order(키보드 차례), tree }
import { missionTree, relOf, bySpawn, nodeTier } from './mission-model.js';

// 카드 320×150(시안과 같다. 보통 단계에서 이름·상태·시간 / 역할·하네스·모델 / 일(오류면 일 한 줄과 오류 한 줄) / 관계 한 줄).
// GH·GV = 카드 사이 가로·세로 틈(세로 틈에 버스 선이 지난다), PAD = 섬 안 여백, HEAD = 섬 머리(이름·칩) 높이, RP·RH = 무리 안 여백·무리 머리 높이,
// RGAP = 무리 사이, SGAP·SVG = 혼자인 기둥의 가로·세로 틈, KCOLS = 잎 한 줄 수, PT·HT = 영토 안 여백·영토 머리, IGAP = 섬 사이, WGAP = 영토 사이,
// ASPECT = 세계 비율(화면 비율을 주지 않을 때), G = 길 찾기 격자 칸
export const TERR = { CW: 320, CH: 150, GH: 26, GV: 60, PAD: 24, HEAD: 72, RP: 20, RH: 42, RGAP: 24, SGAP: 20, SVG: 18, KCOLS: 4, SOLO_ROWS: 3, SOLO_MAX: 4, PT: 32, HT: 100, IGAP: 28, WGAP: 64, ISLE_MIN: 384, ASPECT: 1.8, G: 16 };
// 확대 단계: 멀리 < 0.6 ≤ 보통 ≤ 1.2 < 가까이. 범위 0.08 ~ 2.4
export const ZOOM = { min: 0.08, max: 2.4, far: 0.6, near: 1.2, step: 1.25, wheel: 0.0016 };
export const LEVEL_K = { far: 0.42, mid: 0.85, near: 1.5 };
// 영토 색(폴더 차례대로 돈다). CSS .mt-ta-terr.c0 ~ c5
export const TERR_COLORS = 6;
// 상태 칩 차례(섬 머리): 응답 필요, 오류, 작업 중, 작업 완료, 쉼, 잠듦, 끝남
export const CHIP_ORDER = ['turn', 'alert', 'work', 'review', 'rest', 'sleep', 'done'];

// 선반 쌓기. items: [{ w, h }] → 같은 차례의 [{ x, y }] 와 { w, h }. 한 줄이 target을 넘으면 다음 줄(한 줄에 하나는 늘 들어간다)
export function shelf(items, target, gapX, gapY = gapX) {
  const pos = [];
  let x = 0, y = 0, rowH = 0, W = 0;
  for (const it of items) {
    if (x > 0 && x + it.w > target) { y += rowH + gapY; x = 0; rowH = 0; }
    pos.push({ x, y });
    x += it.w + gapX;
    rowH = Math.max(rowH, it.h);
    W = Math.max(W, x - gapX);
  }
  return { pos, w: W, h: items.length ? y + rowH : 0 };
}
// P153: 하늘선 쌓기(skyline). 폭 width 안에서 차례대로 놓되, 각 상자를 지금 쌓인 높이가 가장 낮은 자리(같으면 왼쪽)에 놓는다.
// 선반과 달리 키 작은 것 아래·옆 빈 곳을 다음 상자가 채운다. → 같은 차례의 [{ x, y }] 와 { w, h }
export function skyline(items, width, gap) {
  let sky = [{ x: 0, w: Math.max(width, 1) + gap, y: 0 }]; // 겹치지 않는 토막들(왼 → 오)
  const pos = [];
  let W = 0, H = 0;
  const topOver = (x, w) => { let y = 0; for (const s of sky) if (s.x < x + w && s.x + s.w > x) y = Math.max(y, s.y); return y; };
  for (const it of items) {
    const need = it.w + gap;
    let best = null;
    for (const s of sky) {
      const x = s.x;
      if (x > 0 && x + it.w > width) continue;
      const y = topOver(x, need);
      if (!best || y < best.y - 0.5 || (Math.abs(y - best.y) <= 0.5 && x < best.x)) best = { x, y };
    }
    if (!best) best = { x: 0, y: topOver(0, need) };
    pos.push(best);
    W = Math.max(W, best.x + it.w); H = Math.max(H, best.y + it.h);
    // 하늘선 고치기: [x, x + need) 구간을 y + h + gap으로
    const a = best.x, b = best.x + need, top = best.y + it.h + gap;
    const next = [];
    for (const s of sky) {
      if (s.x + s.w <= a || s.x >= b) { next.push(s); continue; }
      if (s.x < a) next.push({ x: s.x, w: a - s.x, y: s.y });
      if (s.x + s.w > b) next.push({ x: b, w: s.x + s.w - b, y: s.y });
    }
    next.push({ x: a, w: need, y: top });
    next.sort((p, q) => p.x - q.x);
    sky = next;
  }
  return { pos, w: W, h: items.length ? H : 0 };
}
// 가장 잘 맞는 하늘선 쌓기: 폭 후보(가장 넓은 것, 넓이에서 어림한 폭 여럿, 앞에서부터 이어 붙인 폭들) × 차례 둘(주어진 차례, 키 큰 차례)을 해 보고
// 비율 aspect 상자에 가장 크게 들어가는 것을 고른다. 키 큰 차례는 5% 넘게 나을 때만(사이드바 차례를 되도록 지킨다)
export function bestPack(items, gap, aspect) {
  if (!items.length) return { pos: [], w: 0, h: 0 };
  const maxW = Math.max(...items.map((it) => it.w));
  const area = items.reduce((a, it) => a + (it.w + gap) * (it.h + gap), 0);
  const cands = new Set([maxW]);
  for (const f of [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.7]) cands.add(Math.max(maxW, Math.sqrt(area * aspect) * f));
  let run = 0;
  for (const it of items) { run += (run ? gap : 0) + it.w; cands.add(run); }
  const score = (s) => Math.max(s.w / aspect, s.h);
  const tryOrder = (list) => {
    let best = null;
    for (const t of cands) {
      const s = skyline(list.map((i) => items[i]), t, gap);
      if (!best || score(s) < score(best.s) - 0.5 || (Math.abs(score(s) - score(best.s)) <= 0.5 && s.w * s.h < best.s.w * best.s.h)) best = { s, list };
    }
    return best;
  };
  const idx = items.map((_, i) => i);
  const a = tryOrder(idx);
  const b = tryOrder([...idx].sort((p, q) => items[q].h - items[p].h || items[q].w - items[p].w || p - q));
  const pick = score(b.s) < score(a.s) * 0.95 ? b : a;
  const pos = new Array(items.length);
  pick.list.forEach((i, j) => { pos[i] = pick.s.pos[j]; });
  return { pos, w: pick.s.w, h: pick.s.h };
}
// 선반 목표 폭: 넓이의 제곱근 × 비율, 가장 넓은 것보다 좁지 않게(옛 셈, 휴대폰 지도가 쓴다)
export const shelfTarget = (items, aspect, gap) => {
  if (!items.length) return 0;
  const area = items.reduce((a, it) => a + (it.w + gap) * (it.h + gap), 0);
  return Math.max(Math.max(...items.map((it) => it.w)), Math.sqrt(area * aspect));
};
// 가장 잘 맞는 선반: 목표 폭 후보(가장 넓은 것, 앞에서부터 이어 붙인 폭들)마다 쌓아 보고, 비율 aspect(가로/세로) 상자에 넣었을 때 가장 크게 보이는 것(max(w / aspect, h)가 가장 작은 것)을 고른다
export function bestShelf(items, gap, aspect) {
  if (!items.length) return { pos: [], w: 0, h: 0 };
  const cands = new Set([Math.max(...items.map((it) => it.w))]);
  let run = 0;
  for (const it of items) { run += (run ? gap : 0) + it.w; cands.add(run); }
  let best = null;
  for (const t of cands) {
    const s = shelf(items, t, gap);
    const score = Math.max(s.w / aspect, s.h);
    if (!best || score < best.score - 0.5 || (Math.abs(score - best.score) <= 0.5 && s.w * s.h < best.s.w * best.s.h)) best = { s, score };
  }
  return best.s;
}

// 상태 수 칩: tiers(등급 배열) → [{ tier, n }](0은 뺀다, CHIP_ORDER 차례)
export function chipCounts(tiers) {
  const c = new Map();
  for (const t of tiers) c.set(t, (c.get(t) || 0) + 1);
  return CHIP_ORDER.filter((t) => c.get(t)).map((t) => ({ tier: t, n: c.get(t) }));
}

// 워크스페이스 키 맞추기(사이드바 폴더 목록과 그래프의 키가 쓰는 꼴이 달라도 같은 것으로 본다)
export const normKey = (k) => String(k || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
// 키 → 보일 이름 어림(판의 워크스페이스 이름이 없을 때): 끝의 /.git을 빼고 마지막 폴더 이름
export const keyName = (k) => String(k || '').replace(/\\/g, '/').replace(/\/\.git\/?$/i, '').split('/').filter(Boolean).pop() || String(k || '');
// 글 폭 어림(글자 수 × 글자 크기 × 평균 글자 폭 비율). 머리가 이름보다 좁지 않게
export const textW = (s, px, r = 0.58) => String(s || '').length * px * r;
// 글자 수 × 크기(휴대폰 지도 폭 어림)
const nameW = (s, px) => String(s || '').length * px;
// 섬 머리 폭: 보통 단계(이름 26px + 칩 글)와 멀리 단계(이름 46px, 칩은 넘치면 숨는다) 중 큰 것
const isleHeadW = (name, chips) => Math.max(28 * 2 + 32 + textW(name, 20) + chips.length * 92, 28 * 2 + 50 + textW(name, 48));

// graph: mission.graph, opt: order(워크스페이스 차례), vgroups(가상 그룹), tiers(Map id → 등급), names(Map 워크스페이스 키 → 보일 이름),
// aspect(세계 비율, 보통 보기 칸의 가로/세로), routing(다른 섬 선 길 찾기, 휴대폰은 끈다)
export function territoryLayout(graph, { order: order0 = [], vgroups = [], tiers = null, names = null, aspect = TERR.ASPECT, routing = true } = {}) {
  const tree = missionTree(graph);
  // P153 r6: 카드 폭은 이 판의 가장 긴 이름(NAME_MAX자까지)이 멀리 타일에서 한 줄에 들게 정한다(모든 카드 같은 폭). 더 긴 이름만 말줄임
  const L = { ...TERR, CW: cardWidth(tree.nodes.map((n) => n.name)) };
  const { byId } = tree;
  const tierOf = (id) => (tiers && tiers.has(id) ? tiers.get(id) : nodeTier(byId.get(id)));
  const wsOf = (id) => (byId.get(id) || {}).workspaceKey || '';
  const nameOf = (key) => (names && names.get(key)) || (key ? keyName(key) : '');

  // ---- 소속과 차례(사이드바와 같다) ----
  const folderOf = new Map(); // normKey → { g, gi, mi }
  (vgroups || []).forEach((g, gi) => (g.members || []).forEach((m, mi) => { const k = normKey(m); if (k && !folderOf.has(k)) folderOf.set(k, { g, gi, mi }); }));
  const present = [...new Set(tree.nodes.map((n) => wsOf(n.id)))];
  const ord = new Map((order0 || []).map((k, i) => [normKey(k), i]));
  const wsRank = (k) => (ord.has(normKey(k)) ? ord.get(normKey(k)) : 1e6);
  const byWsOrder = (a, b) => (!a) - (!b) || wsRank(a) - wsRank(b) || String(nameOf(a)).localeCompare(String(nameOf(b))) || String(a).localeCompare(String(b));
  const terrList = [];
  for (const [gi, g] of (vgroups || []).entries()) {
    const keys = present.filter((k) => k && folderOf.has(normKey(k)) && folderOf.get(normKey(k)).gi === gi).sort((a, b) => folderOf.get(normKey(a)).mi - folderOf.get(normKey(b)).mi);
    if (keys.length) terrList.push({ id: g.id, name: g.name, keys, color: terrList.length % TERR_COLORS });
  }
  const looseKeys = present.filter((k) => !k || !folderOf.has(normKey(k))).sort(byWsOrder);
  const keys = [...terrList.flatMap((t) => t.keys), ...looseKeys];

  const parentIn = (id) => { const p = tree.parent.get(id); return p && wsOf(p) === wsOf(id) ? p : null; };
  const kidsIn = (id) => (tree.kids.get(id) || []).filter((c) => wsOf(c.id) === wsOf(id));
  const kidsAway = (id) => (tree.kids.get(id) || []).filter((c) => wsOf(c.id) !== wsOf(id));

  // ---- P153: 카드 높이는 내용을 따른다(cardHeight). 무리 안에서는 같은 깊이(한 줄)의 카드가 같은 높이 ----
  const own = new Map(); // id → 내용 높이
  for (const n of tree.nodes) { const p = tree.parent.get(n.id); own.set(n.id, cardHeight(n, tierOf(n.id), !!p && wsOf(p) !== wsOf(n.id), L.CW)); }
  const rowH = new Map(); // id → 그 줄 높이(무리 안), 혼자는 자기 높이
  const setRows = (root) => {
    const depth = new Map([[root, 0]]), best = new Map();
    const walk = (id, d, guard) => { depth.set(id, d); best.set(d, Math.max(best.get(d) || 0, own.get(id))); if (guard > 50) return; for (const c of kidsIn(id)) walk(c.id, d + 1, guard + 1); };
    walk(root, 0, 0);
    for (const [id, d] of depth) rowH.set(id, best.get(d));
  };
  const H = (id) => rowH.get(id) || own.get(id) || L.CH;

  // ---- 무리 하나(나무)의 크기 재기와 놓기(섬 안 자리) ----
  const size = new Map(); // id → { w, h, kw(하위 묶음 폭) }
  const measure = (id, depth = 0) => {
    const kids = depth > 50 ? [] : kidsIn(id);
    if (!kids.length) { const s = { w: L.CW, h: H(id), kw: 0 }; size.set(id, s); return s; }
    const branch = kids.filter((c) => kidsIn(c.id).length), leaf = kids.filter((c) => !kidsIn(c.id).length);
    let kw = 0, kh = 0;
    for (const c of branch) { const s = measure(c.id, depth + 1); kw += s.w + L.GH; kh = Math.max(kh, s.h); }
    if (leaf.length) {
      for (const c of leaf) measure(c.id, depth + 1);
      const cols = Math.min(L.KCOLS, leaf.length), rows = Math.ceil(leaf.length / cols);
      kw += cols * L.CW + (cols - 1) * L.GH + L.GH;
      kh = Math.max(kh, rows * H(leaf[0].id) + (rows - 1) * L.GV);
    }
    kw -= L.GH;
    const s = { w: Math.max(L.CW, kw), h: H(id) + L.GV + kh, kw };
    size.set(id, s);
    return s;
  };
  const local = new Map(); // id → { x, y } (섬 안 자리)
  const route = new Map(); // 하위 id → { parent, row, trunk(둘째 줄부터 줄기 x, 섬 안), bus0(첫 줄 버스 y, 섬 안) }
  const place = (id, x, y, depth = 0) => {
    const s = size.get(id);
    local.set(id, { x: x + (s.w - L.CW) / 2, y });
    const kids = depth > 50 ? [] : kidsIn(id);
    if (!kids.length) return;
    const branch = kids.filter((c) => kidsIn(c.id).length), leaf = kids.filter((c) => !kidsIn(c.id).length);
    const ky = y + H(id) + L.GV, bus0 = ky - L.GV / 2;
    let cx = x + (s.w - s.kw) / 2;
    for (const c of branch) { place(c.id, cx, ky, depth + 1); route.set(c.id, { parent: id, row: 0, trunk: null, bus0 }); cx += size.get(c.id).w + L.GH; }
    if (leaf.length) {
      const cols = Math.min(L.KCOLS, leaf.length);
      leaf.forEach((c, i) => {
        const row = Math.floor(i / cols);
        place(c.id, cx + (i % cols) * (L.CW + L.GH), ky + row * (H(c.id) + L.GV), depth + 1);
        route.set(c.id, { parent: id, row, trunk: row ? cx - L.GH / 2 : null, bus0 });
      });
    }
  };

  // ---- 섬(워크스페이스) ----
  const isleOf = new Map(); // 키 → { key, w, h, rings: [], ids, chips }
  for (const key of keys) {
    const ids = tree.nodes.filter((n) => wsOf(n.id) === key).map((n) => n.id);
    const nodes = ids.map((id) => byId.get(id)).sort(bySpawn);
    const roots = nodes.filter((n) => !parentIn(n.id) && kidsIn(n.id).length);
    const solos = nodes.filter((n) => !parentIn(n.id) && !kidsIn(n.id).length);
    // 무리 폭은 머리 글("팀 <리드> · 세션 n개", 15px)보다 좁지 않게. 넓히면 나무를 가운데에 둔다
    const rs = roots.map((r) => { setRows(r.id); const s = measure(r.id); const lw = 44 + textW(`Team ${byId.get(r.id).name} · 99 sessions (9 work elsewhere)`, 15, 0.56); return { id: r.id, tw: s.w, w: Math.max(s.w + L.RP * 2, Math.min(lw, 760)), h: s.h + L.RH + L.RP }; });
    const rp = bestShelf(rs, L.RGAP, 2.2);
    const rings = [];
    rs.forEach((r, i) => {
      const x = L.PAD + rp.pos[i].x, y = L.HEAD + rp.pos[i].y;
      place(r.id, x + (r.w - r.tw) / 2, y + L.RH);
      const team = [];
      const walk = (id, d) => { if (d > 50) return; for (const c of kidsIn(id)) { team.push(c.id); walk(c.id, d + 1); } };
      walk(r.id, 0);
      const away = [r.id, ...team].reduce((a, id) => a + kidsAway(id).length, 0);
      rings.push({ id: r.id, x, y, w: r.w, h: r.h, lead: r.id, n: team.length + 1, away });
    });
    // 혼자인 세션 기둥: 무리가 있으면 무리 높이만큼 한 기둥(적어도 SOLO_ROWS), 없으면 SOLO_MAX까지 한 기둥, 많으면 거의 정사각
    const sx0 = rs.length ? L.PAD + rp.w + L.RGAP : L.PAD;
    const sy0 = L.HEAD + (rs.length ? L.RH : 0);
    const n = solos.length;
    const rows = !n ? 0 : rs.length ? Math.max(L.SOLO_ROWS, Math.floor((rp.h - L.RH + L.SVG) / (L.CH + L.SVG))) : n <= L.SOLO_MAX ? n : Math.ceil(n / Math.ceil(Math.sqrt(n / 2)));
    let colBottom = 0;
    { let y = sy0; solos.forEach((s, i) => { if (i % rows === 0) y = sy0; local.set(s.id, { x: sx0 + Math.floor(i / rows) * (L.CW + L.SGAP), y }); y += H(s.id) + L.SVG; colBottom = Math.max(colBottom, y - L.SVG); }); }
    const cols = rows ? Math.ceil(n / rows) : 0;
    const right = cols ? sx0 + cols * (L.CW + L.SGAP) - L.SGAP : L.PAD + rp.w;
    const bottom = Math.max(rs.length ? L.HEAD + rp.h : 0, colBottom, L.HEAD);
    const chips = chipCounts(ids.map(tierOf));
    isleOf.set(key, { key, w: Math.max(L.ISLE_MIN, right + L.PAD, isleHeadW(nameOf(key), chips)), h: bottom + L.PAD, rings, ids, chips });
  }

  // ---- 영토(폴더)와 세계 ----
  // P153: 영토 안 섬 쌓기는 모양 후보 몇 개(가로로 긴 것 ~ 세로로 긴 것)를 만들어 두고, 세계 전체가 보기 칸에 가장 크게 들어가는 조합을 고른다(영토마다 차례로 바꿔 보기 두 번)
  const W0 = aspect > 0.2 ? aspect : L.ASPECT;
  const headW = (t) => L.PT * 2 + textW(t.name, 56, 0.6) + 18 + textW('x'.repeat(26), 26, 0.5); // 머리 글 폭(멀리 단계 이름 72px + 요약 32px 26자 안팎)
  for (const t of terrList) {
    const is = t.keys.map((k) => isleOf.get(k));
    t.sessions = is.reduce((a, i) => a + i.ids.length, 0);
    const seen = new Set();
    t.cands = [];
    for (const a of [1.25, 0.6, 0.9, 2, 3.5, 6]) {
      const p = bestPack(is, L.IGAP, a);
      const key = `${Math.round(p.w)}x${Math.round(p.h)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      t.cands.push({ inner: p, w: Math.max(L.PT * 2 + p.w, headW(t)), h: L.HT + p.h + L.PT });
    }
    t.pick = 0;
  }
  const looseItems = looseKeys.map((key) => ({ kind: 'isle', key, w: isleOf.get(key).w, h: isleOf.get(key).h }));
  const wScore = (s) => Math.max(s.w / W0, s.h);
  // P153: 읽는 차례 = 폴더 영토 묶음이 먼저(왼쪽 위), 폴더 밖 섬 묶음은 그 뒤(아래 또는 오른쪽). 두 묶음은 섞지 않는다(소속이 흐려지지 않게). 묶음 안은 촘촘히
  const packWorld = () => {
    const A = bestPack(terrList.map((t) => ({ w: t.cands[t.pick].w, h: t.cands[t.pick].h })), L.WGAP, W0);
    if (!looseItems.length) return A;
    if (!terrList.length) return bestPack(looseItems, L.WGAP, W0);
    const maxW = Math.max(...looseItems.map((it) => it.w));
    const widths = new Set([maxW, Math.max(maxW, A.w)]);
    let run = 0;
    for (const it of looseItems) { run += (run ? L.WGAP : 0) + it.w; widths.add(run); }
    let best = null;
    for (const t of widths) {
      const b = skyline(looseItems, t, L.WGAP);
      for (const side of ['below', 'right']) {
        const w = side === 'below' ? Math.max(A.w, b.w) : A.w + L.WGAP + b.w, h = side === 'below' ? A.h + L.WGAP + b.h : Math.max(A.h, b.h);
        const sc = wScore({ w, h });
        if (!best || sc < best.sc - 0.5) best = { sc, w, h, side, b };
      }
    }
    const dx = best.side === 'right' ? A.w + L.WGAP : 0, dy = best.side === 'below' ? A.h + L.WGAP : 0;
    return { pos: [...A.pos, ...best.b.pos.map((p) => ({ x: p.x + dx, y: p.y + dy }))], w: best.w, h: best.h };
  };
  let world = packWorld();
  for (let pass = 0; pass < 2; pass++) {
    for (const t of terrList) {
      let bestI = t.pick, bestS = wScore(world);
      for (let i = 0; i < t.cands.length; i++) {
        if (i === t.pick) continue;
        const keep = t.pick; t.pick = i;
        const s = packWorld();
        if (wScore(s) < bestS - 0.5) { bestS = wScore(s); bestI = i; }
        t.pick = keep;
      }
      if (bestI !== t.pick) { t.pick = bestI; world = packWorld(); }
    }
  }
  for (const t of terrList) { const c = t.cands[t.pick]; t.inner = c.inner; t.w = c.w; t.h = c.h; }
  const items = [...terrList.map((t) => ({ kind: 'terr', t, w: t.w, h: t.h })), ...looseItems];
  const cards = new Map(), rings = [], isles = [], terrs = [], off = new Map();
  const putIsle = (key, x, y, folder) => {
    const I = isleOf.get(key);
    off.set(key, { x, y });
    isles.push({ key, x, y, w: I.w, h: I.h, loose: !folder, folder: folder ? folder.id : null, color: folder ? folder.color : null, chips: I.chips, count: I.ids.length, name: nameOf(key) });
    for (const r of I.rings) rings.push({ ...r, x: x + r.x, y: y + r.y, ws: key });
    for (const id of I.ids) { const p = local.get(id); cards.set(id, { x: x + p.x, y: y + p.y, w: L.CW, h: H(id), node: byId.get(id), ws: key }); }
  };
  items.forEach((it, i) => {
    const { x, y } = world.pos[i];
    if (it.kind === 'isle') { putIsle(it.key, x, y, null); return; }
    const t = it.t;
    terrs.push({ id: t.id, name: t.name, x, y, w: t.w, h: t.h, color: t.color, nWs: t.keys.length, sessions: t.sessions });
    t.keys.forEach((k, j) => putIsle(k, x + L.PT + t.inner.pos[j].x, y + L.HT + t.inner.pos[j].y, t));
  });

  // ---- 선 ----
  const edges = [];
  const cx = (b) => b.x + b.w / 2;
  const r1 = (v) => Math.round(v * 10) / 10;
  const poly = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${r1(p[0])} ${r1(p[1])}`).join(' ');
  const cross = [];
  // 같은 섬 안 나무 선. 형제가 같은 이름표(역할·시킴)를 달면 하나만 부모 아래 줄기에 단다
  const sibLabel = new Map(); // 부모 id → Map(글 → 수)
  const labelKey = (rel, via) => (rel === 'role' ? `role:${via.role || ''}` : rel === 'prompt' ? 'prompt' : null);
  for (const [child, via] of tree.via) {
    const parent = tree.parent.get(child);
    if (!cards.get(parent) || !cards.get(child) || wsOf(parent) !== wsOf(child)) continue;
    const k = labelKey(relOf(via, tree), via);
    if (!k) continue;
    if (!sibLabel.has(parent)) sibLabel.set(parent, new Map());
    const m = sibLabel.get(parent); m.set(k, (m.get(k) || 0) + 1);
  }
  const stubDone = new Set();
  for (const [child, via] of tree.via) {
    const parent = tree.parent.get(child);
    const a = cards.get(parent), b = cards.get(child);
    if (!a || !b) continue;
    const rel = relOf(via, tree);
    const base = { id: via.id, from: parent, to: child, rel, role: via.role || null, text: via.text || null, active: !!via.active, tree: true };
    if (wsOf(parent) !== wsOf(child)) { cross.push({ base, a, b }); continue; }
    const o = off.get(wsOf(child));
    const r = route.get(child);
    const pcx = cx(a), ccx = cx(b), top = b.y, busY = top - L.GV / 2;
    const pts = !r || !r.row ? [[pcx, a.y + a.h], [pcx, busY], [ccx, busY], [ccx, top]]
      : [[pcx, a.y + a.h], [pcx, o.y + r.bus0], [o.x + r.trunk, o.y + r.bus0], [o.x + r.trunk, busY], [ccx, busY], [ccx, top]];
    const k = labelKey(rel, via);
    let label = null;
    if (k) {
      const shared = sibLabel.get(parent).get(k) > 1;
      if (!shared) label = { x: ccx, y: top - L.GV / 4 };
      else if (!stubDone.has(`${parent}|${k}`)) { stubDone.add(`${parent}|${k}`); label = { x: pcx, y: a.y + a.h + L.GV / 4, shared: true }; }
    }
    edges.push({ ...base, cross: false, pts, d: poly(pts), label });
  }
  // 다른 섬으로 가는 선: 길 찾기(카드·머리를 피해 직각으로). 끄면(휴대폰) 단순한 직각 선
  if (cross.length) {
    const blocks = [];
    for (const c of cards.values()) blocks.push({ x: c.x, y: c.y, w: c.w, h: c.h });
    // P153 r5: 섬 머리 띠 전체(이름·칩, 멀리 단계 큰 글 높이까지)와 무리 이름표(멀리 단계 34px 글 폭)는 선이 지나지 않는다
    for (const i of isles) blocks.push({ x: i.x + 6, y: i.y + 4, w: i.w - 12, h: L.HEAD - 10 });
    for (const r of rings) { const lab = `Team ${byId.get(r.lead).name} · ${r.n + r.away} sessions${r.away ? ` (${r.away} work elsewhere)` : ''}`; blocks.push({ x: r.x + 10, y: r.y + 2, w: Math.min(r.w - 20, textW(lab, 34, 0.56) + 24), h: L.RH - 6 }); }
    for (const t of terrs) blocks.push({ x: t.x + 30, y: t.y + 16, w: Math.min(t.w - 60, textW(t.name, 44, 0.62) + 340), h: L.HT - 44 });
    const trees = edges.map((e) => e.pts);
    const routes = routing && cross.length <= 60 ? routeOrtho(cross.map((c) => ({ a: c.a, b: c.b })), blocks, trees, { G: L.G }) : null;
    cross.forEach((c, i) => {
      let pts = routes && routes[i];
      if (!pts) { const ay = c.a.y + c.a.h, by = c.b.y, my = Math.min(ay, by) - 30; pts = [[cx(c.a), c.a.y], [cx(c.a), my], [cx(c.b), my], [cx(c.b), by]]; }
      edges.push({ ...c.base, cross: true, pts, d: poly(pts), label: longestMid(pts) });
    });
  }

  // ---- 둘레와 키보드 차례 ----
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of [...terrs, ...isles]) { x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); }
  const bounds = Number.isFinite(x1) ? { x: x1, y: y1 - 60, w: x2 - x1, h: y2 - y1 + 60 } : { x: 0, y: 0, w: 1, h: 1 };
  const isleIdx = new Map(isles.map((i, n) => [i.key, n]));
  const order = [...cards.entries()].sort((a, b) => isleIdx.get(a[1].ws) - isleIdx.get(b[1].ws) || a[1].y - b[1].y || a[1].x - b[1].x).map(([id]) => id);
  return { cards, rings, isles, terrs, edges, bounds, order, tree, cw: L.CW };
}

// P153 r6: 카드 폭. 멀리 타일 이름(세계 NAME_PX px, 처음 화면 배율 0.27 안팎에서 화면 11.5px)이 한 줄에 드는 폭 = 글자 수 × NAME_PX × 0.55 + 여백 28.
// 이름은 NAME_MAX자까지 맞추고(그보다 긴 것만 말줄임) TERR.CW(320)보다 좁지 않게, CW_MAX보다 넓지 않게
export const NAME_PX = 42, NAME_MAX = 24, CW_MAX = 600;
export const cardWidth = (names, px = NAME_PX) => Math.round(Math.min(CW_MAX, Math.max(TERR.CW, Math.min(NAME_MAX, Math.max(0, ...names.map((x) => String(x || '').length))) * px * 0.55 + 28)));
// P153: 카드 높이(보통 단계 내용, 줄 높이는 CSS 글 크기 × 1.38, r6 글 크기): 위아래 여백·테두리 24 + 이름 줄 22 + 메타 줄 18 + 일 줄(19씩, 셋까지) + 오류 줄(18씩, 둘까지) + 관계 줄 17, 줄 사이 4.
// 일 줄 수는 머리말을 더한 글자 수를 한 줄 글자 수(카드 폭에서 어림)로 나눈다(넉넉하게). 오류가 있으면 일은 한 줄. 관계 줄은 다른 워크스페이스에서 왔거나 브랜치·루프가 있을 때만.
// 멀리 타일(이름 한 줄 + 상태)이 드는 CARD_MIN 밑으로는 줄이지 않는다
export const CARD_MIN = 118;
export function cardHeight(n, tier, cross = false, cw = TERR.CW) {
  const t = tier === 'turn' ? (n.ask || n.lastPrompt) : tier === 'alert' ? (n.lastPrompt || n.ask) : n.lastPrompt;
  const err = tier === 'alert' && n.error ? String(n.error) : null;
  const cpl = Math.max(20, Math.floor((cw - 30) / 7.4)); // 일 글 13.5px 한 줄 글자 수
  const lines = err ? 1 : Math.min(3, Math.max(1, Math.ceil((String(t || 'x').length + 7) / cpl)));
  const errLines = err ? Math.min(2, Math.ceil(err.length / (cpl + 2))) : 0;
  const more = cross || n.gitBranch || n.loops;
  const body = 24 + 22 + 4 + 18 + 4 + lines * 19 + (err ? 4 + errLines * 18 : 0) + (more ? 4 + 17 : 0) + 2;
  return Math.max(CARD_MIN, Math.ceil(body));
}

// 꺾인 선의 이름표 자리: 가장 긴 가로 토막 가운데(가로가 없으면 가장 긴 토막)
export function longestMid(pts) {
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const len = Math.abs(bx - ax) + Math.abs(by - ay) + (ay === by ? 1e5 : 0);
    if (!best || len > best.len) best = { len, x: (ax + bx) / 2, y: (ay + by) / 2 };
  }
  return best ? { x: best.x, y: best.y } : null;
}

// ---- 직각 길 찾기 ----
// reqs: [{ a, b }](카드 상자), blocks: 피할 상자들(카드·머리), trees: 이미 그은 선(점 배열들, 겹치면 비용). → 같은 차례의 점 배열(못 찾으면 null)
// 격자 G칸 위에서 A*(상태 = 칸 × 들어온 방향). 비용: 한 칸 1, 꺾기 6, 이미 선이 지나는 칸 30(겹쳐 가지 않고 옆 칸으로 비켜 나란히 간다, 가로지르기는 된다).
// 시작은 카드 위·아래 가운데, 끝은 받는 카드 위 가운데(가장 싼 것). 처음과 끝의 세로 토막은 카드 가운데 x에 맞춘다.
export function routeOrtho(reqs, blocks, trees = [], { G = 16, margin = 10, maxStates = 600000 } = {}) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of blocks) { x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h); }
  if (!Number.isFinite(x1)) return reqs.map(() => null);
  const ox = Math.floor((x1 - 240) / G) * G, oy = Math.floor((y1 - 240) / G) * G;
  const C = Math.ceil((x2 + 240 - ox) / G), R = Math.ceil((y2 + 240 - oy) / G);
  const N = C * R;
  const blocked = new Uint8Array(N), used = new Uint8Array(N);
  const cellX = (x) => Math.floor((x - ox) / G), cellY = (y) => Math.floor((y - oy) / G);
  const mark = (arr, b, m, v = 1) => {
    const ca = Math.max(0, cellX(b.x - m)), cb = Math.min(C - 1, cellX(b.x + b.w + m)), ra = Math.max(0, cellY(b.y - m)), rb = Math.min(R - 1, cellY(b.y + b.h + m));
    for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) arr[r * C + c] = v;
  };
  for (const b of blocks) mark(blocked, b, margin);
  const markLine = (pts) => { for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; mark(used, { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) }, 0); } };
  for (const t of trees) markLine(t);
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  // 이진 힙(f 값)
  const search = (sc, sr, tc, tr, endDir) => {
    const S = N * 4;
    const g = new Float32Array(S).fill(Infinity), prev = new Int32Array(S).fill(-1);
    const heap = [], push = (f, s) => { heap.push([f, s]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const h = (c, r) => Math.abs(c - tc) + Math.abs(r - tr);
    for (let d = 0; d < 4; d++) { const s = (sr * C + sc) * 4 + d; g[s] = 0; push(h(sc, sr), s); }
    let n = 0;
    while (heap.length && n++ < maxStates) {
      const [f, s] = pop();
      const cell = s >> 2, d = s & 3, c = cell % C, r = (cell - c) / C;
      if (f - h(c, r) > g[s] + 1e-6) continue;
      if (c === tc && r === tr && (endDir < 0 || d === endDir)) {
        const cells = [];
        for (let x = s; x >= 0; x = prev[x]) cells.push(x >> 2);
        return cells.reverse();
      }
      for (let nd = 0; nd < 4; nd++) {
        const nc = c + DX[nd], nr = r + DY[nd];
        if (nc < 0 || nr < 0 || nc >= C || nr >= R) continue;
        const ncell = nr * C + nc;
        if (blocked[ncell] && !(nc === tc && nr === tr)) continue;
        const cost = g[s] + 1 + (nd !== d ? 6 : 0) + (used[ncell] ? 30 : 0); // 이미 그은 선(나무 선 포함) 칸은 비싸다: 겹쳐 가지 않고 가로지르기만
        const ns = ncell * 4 + nd;
        if (cost < g[ns]) { g[ns] = cost; prev[ns] = s; push(cost + h(nc, nr), ns); }
      }
    }
    return null;
  };
  const out = [];
  for (const { a, b, open = [], sides = null } of reqs) {
    // 이 선에만 열어 주는 길(섬 머리를 곧게 지나는 좁은 칸)
    const opened = [];
    for (const r of open) { if (!r) continue; const ca = Math.max(0, cellX(r.x)), cb = Math.min(C - 1, cellX(r.x + r.w)), ra = Math.max(0, cellY(r.y)), rb = Math.min(R - 1, cellY(r.y + r.h)); for (let rr = ra; rr <= rb; rr++) for (let cc = ca; cc <= cb; cc++) { const k = rr * C + cc; if (blocked[k]) { opened.push(k); blocked[k] = 0; } } }
    // 시작·끝 자리: 카드 네 변의 가운데(가장자리에서 한 칸 바깥 칸에서 시작한다). arrive = 끝 칸에 닿을 때의 방향(0 +x, 1 -x, 2 +y, 3 -y)
    // P153 r5: 끝은 받는 카드의 위·왼쪽·오른쪽 가장자리(아래로 들어가면 그 카드의 나무 버스와 겹친다). 섬 머리·무리 이름표는 막혀 있어 맨 윗줄 카드에는 보통 옆으로 들어간다
    const d0 = margin + G * 0.6;
    const ports = (box) => {
      const cx0 = box.x + box.w / 2, cy0 = box.y + box.h / 2;
      return [
        { side: 'top', x: cx0, y: box.y, ox: cx0, oy: box.y - d0, axis: 'v', arrive: 2 },
        { side: 'bottom', x: cx0, y: box.y + box.h, ox: cx0, oy: box.y + box.h + d0, axis: 'v', arrive: 3 },
        { side: 'left', x: box.x, y: cy0, ox: box.x - d0, oy: cy0, axis: 'h', arrive: 0 },
        { side: 'right', x: box.x + box.w, y: cy0, ox: box.x + box.w + d0, oy: cy0, axis: 'h', arrive: 1 },
      ];
    };
    let best = null;
    for (const p of ports(a)) for (const q of ports(b).filter((x) => (sides ? sides.includes(x.side) : x.side !== 'bottom'))) { // sides: 받는 쪽 변(세션 맵 B는 왼쪽·위)
      const sc = cellX(p.ox), sr = cellY(p.oy), tc = cellX(q.ox), tr = cellY(q.oy);
      if (sc < 0 || sr < 0 || sc >= C || sr >= R || tc < 0 || tr < 0 || tc >= C || tr >= R) continue;
      const saved = [blocked[sr * C + sc], blocked[tr * C + tc]];
      blocked[sr * C + sc] = 0; blocked[tr * C + tc] = 0;
      const cells = search(sc, sr, tc, tr, q.arrive);
      blocked[sr * C + sc] = saved[0]; blocked[tr * C + tc] = saved[1];
      if (!cells) continue;
      let turns = 0;
      for (let i = 2; i < cells.length; i++) { const d1 = cells[i - 1] - cells[i - 2], d2 = cells[i] - cells[i - 1]; if (d1 !== d2) turns++; }
      const cost = cells.length + turns * 6 + (q.side === 'top' ? 0 : 2); // 같으면 위로 들어가는 것
      if (!best || cost < best.cost) best = { cost, cells, p, q };
    }
    for (const k of opened) blocked[k] = 1;
    if (!best) { out.push(null); continue; }
    // 칸 → 점(칸 가운데), 같은 방향은 하나로. 처음·끝 토막은 카드 변의 가운데(세로 자리는 x, 가로 자리는 y)에 맞춘다
    let pts = best.cells.map((cell) => { const c = cell % C, r = (cell - c) / C; return [ox + c * G + G / 2, oy + r * G + G / 2]; });
    const snap = (list, port) => { const k = port.axis === 'v' ? 0 : 1, v = port.axis === 'v' ? port.x : port.y, v0 = list[0][k]; for (let i = 0; i < list.length && list[i][k] === v0; i++) { const q2 = [...list[i]]; q2[k] = v; list[i] = q2; } };
    snap(pts, best.p);
    pts.reverse(); snap(pts, best.q); pts.reverse();
    pts = [[best.p.x, best.p.y], ...pts, [best.q.x, best.q.y]];
    const simple = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, ay] = simple[simple.length - 1], [bx, by] = pts[i], [cx2, cy2] = pts[i + 1];
      if ((ax === bx && bx === cx2) || (ay === by && by === cy2)) continue;
      simple.push(pts[i]);
    }
    simple.push(pts[pts.length - 1]);
    markLine(simple);
    out.push(simple);
  }
  return out;
}

// ---- 무한 캔버스 셈. 보기 v = { k, x, y }: 세계 점 w는 화면에서 w·k + (x, y) ----
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const clampK = (k) => clamp(k, ZOOM.min, ZOOM.max);
export const levelOf = (k) => (k < ZOOM.far ? 'far' : k <= ZOOM.near ? 'mid' : 'near');
// 화면 점 (mx, my)를 중심으로 배율 k2로: 그 점 아래 세계 점이 그대로 남는다
export function zoomAt(v, mx, my, k2) {
  const k = clampK(k2), r = k / v.k;
  return { k, x: mx - (mx - v.x) * r, y: my - (my - v.y) * r };
}
// 휠 한 칸의 배율(deltaMode 1 = 줄 단위)
export const wheelK = (k, deltaY, deltaMode = 0) => clampK(k * Math.exp(-(deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY) * ZOOM.wheel));
export const panBy = (v, dx, dy) => ({ k: v.k, x: v.x + dx, y: v.y + dy });
// 맞춤: 둘레를 화면(vw × vh, 위 top만큼 뜬 줄을 비우고 pad 여백)에 넣는다. 가까이 단계 위로는 키우지 않는다
export function fitView(b, vw, vh, { top = 0, pad = 60, bottom = 0, max = 1 } = {}) {
  const aw = Math.max(1, vw - pad * 2), ah = Math.max(1, vh - top - bottom - pad * 2);
  const k = clamp(Math.min(aw / Math.max(1, b.w), ah / Math.max(1, b.h)), ZOOM.min, max);
  return { k, x: (vw - b.w * k) / 2 - b.x * k, y: top + (vh - top - bottom - b.h * k) / 2 - b.y * k };
}
// 세계 점 (wx, wy)를 화면 가운데(위 줄 아래 남은 칸의 가운데)로
export const centerOn = (wx, wy, k, vw, vh, { top = 0, bottom = 0 } = {}) => { const kk = clampK(k); return { k: kk, x: vw / 2 - wx * kk, y: top + (vh - top - bottom) / 2 - wy * kk }; };
// 상자 하나를 화면에 맞춘다(섬으로 날아가기)
export const fitBox = (r, vw, vh, opt = {}) => fitView(r, vw, vh, { pad: 40, max: ZOOM.max, ...opt });
// 지금 보이는 세계 사각형
export const viewRect = (v, vw, vh) => ({ x: -v.x / v.k, y: -v.y / v.k, w: vw / v.k, h: vh / v.k });
// 미니맵: 둘레 b를 MW × MH에 넣는 배율과 원점, 사각형 바꾸기(r → 미니맵 좌표), 지금 보이는 틀
export function miniMap(b, v, vw, vh, MW, MH) {
  const s = Math.min(MW / Math.max(1, b.w), MH / Math.max(1, b.h));
  const ox = (MW - b.w * s) / 2, oy = (MH - b.h * s) / 2;
  const map = (r) => ({ x: ox + (r.x - b.x) * s, y: oy + (r.y - b.y) * s, w: r.w * s, h: r.h * s });
  return { s, ox, oy, map, frame: map(viewRect(v, vw, vh)) };
}
// 미니맵의 한 점을 누르면 그 세계 점을 가운데로(배율은 그대로)
export function miniToWorld(b, MW, MH, px, py) {
  const s = Math.min(MW / Math.max(1, b.w), MH / Math.max(1, b.h));
  const ox = (MW - b.w * s) / 2, oy = (MH - b.h * s) / 2;
  return { x: b.x + (px - ox) / s, y: b.y + (py - oy) / s };
}
// 누르고 뗀 것의 뜻: 조금(slop) 넘게 움직였으면 끌기, 카드 위면 고르기, 빈 곳이면 고름 풀기. 빈 곳을 눌러도 닫지 않는다(닫기는 단추·Esc·M만)
export const DRAG_SLOP = 5;
export function pressIntent({ dx = 0, dy = 0, onCard = false } = {}) {
  if (Math.abs(dx) + Math.abs(dy) >= DRAG_SLOP) return 'drag';
  return onCard ? 'pick' : 'clear';
}
// 키: + − 0(맞춤), 화살표(끌기), 그 밖은 null
export const PAN_STEP = 120;
export function viewKey(key, { shift = false } = {}) {
  const s = shift ? PAN_STEP * 3 : PAN_STEP;
  switch (key) {
    case '+': case '=': return { zoom: ZOOM.step };
    case '-': case '_': return { zoom: 1 / ZOOM.step };
    case '0': return { fit: true };
    case 'ArrowLeft': return { pan: [s, 0] };
    case 'ArrowRight': return { pan: [-s, 0] };
    case 'ArrowUp': return { pan: [0, s] };
    case 'ArrowDown': return { pan: [0, -s] };
    default: return null;
  }
}
// 카드 차례로 다음·앞: 지금 id에서 d만큼(끝에서 돈다). 카드에 초점이 있으면 ↑↓가 카드를 다니고(그 카드로 날아간다), 없으면 화살표는 끌기다
export function stepCard(order, id, d) {
  if (!order.length) return null;
  const i = order.indexOf(id);
  if (i < 0) return d > 0 ? order[0] : order[order.length - 1];
  return order[(i + d + order.length) % order.length];
}

// ---- 휴대폰 지도: 섬마다 세션 이름 타일 ----
// P153: 타일은 이름이 든 알약(TW × TH, 상태 점·이름 12px, 작업 중은 빛). 섬 안 줄 수는 세션 수로(넷까지 한 줄, 열까지 두 줄, 더 많으면 세 줄).
// 섬 머리 IHEAD, 섬 안 여백 IPAD, 영토 머리 THEAD·여백 TPAD, 섬 사이 IG, 영토 사이 WG. 세계는 지도 칸 비율(aspect)에 맞춰 하늘선 쌓기로 촘촘히
export const PTERR = { TW: 112, TH: 28, TGAP: 5, IPAD: 7, IHEAD: 20, ISLE_MIN: 126, THEAD: 22, TPAD: 7, IG: 7, WG: 10, ASPECT: 0.9, TILE: 28 };
// lay: territoryLayout 결과 → { tiles: [{ id, x, y, w, h, s, ws }], isles, terrs, bounds }. 타일 차례는 섬 안 카드 차례(위 → 아래, 왼 → 오른)
// maxW: 이 폭(세계 px) 안에 들게 짠다(휴대폰 폭 ÷ 읽히는 배율). 비율을 좁혀 가며 처음 들어가는 것을 고른다
export function phoneTerr(lay, { names = null, aspect = PTERR.ASPECT, maxW = 0 } = {}) {
  if (maxW > 0) {
    let last = null;
    for (const a of [aspect, 0.8, 0.65, 0.5, 0.4, 0.3, 0.22]) { if (a > aspect) continue; last = phoneTerr(lay, { names, aspect: a }); if (last.bounds.w <= maxW) return last; }
    return last;
  }
  const P = PTERR;
  const nameOf = (k) => (names && names.get(k)) || (k ? keyName(k) : '');
  const byIsle = new Map(lay.isles.map((i) => [i.key, []]));
  for (const id of lay.order) { const c = lay.cards.get(id); if (byIsle.has(c.ws)) byIsle.get(c.ws).push(id); }
  const isleSize = (key) => {
    const n = byIsle.get(key).length, cols = n <= 4 ? 1 : n <= 10 ? 2 : 3, rows = Math.ceil(Math.max(1, n) / cols);
    const w = Math.max(P.ISLE_MIN, Math.min(nameW(nameOf(key), 7) + P.IPAD * 2, 240), P.IPAD * 2 + cols * P.TW + (cols - 1) * P.TGAP);
    return { w, h: P.IPAD + P.IHEAD + rows * P.TH + (rows - 1) * P.TGAP + P.IPAD, cols };
  };
  const items = [];
  const seenT = new Set();
  for (const i of lay.isles) {
    if (!i.folder) { items.push({ kind: 'isle', key: i.key }); continue; }
    if (seenT.has(i.folder)) continue;
    seenT.add(i.folder);
    const t = lay.terrs.find((x) => x.id === i.folder);
    items.push({ kind: 'terr', id: t.id, name: t.name, color: t.color, keys: lay.isles.filter((x) => x.folder === t.id).map((x) => x.key) });
  }
  for (const it of items) {
    if (it.kind === 'isle') { Object.assign(it, isleSize(it.key)); continue; }
    const is = it.keys.map(isleSize);
    it.inner = bestPack(is, P.IG, Math.min(1, aspect));
    it.sizes = is;
    it.w = Math.max(P.TPAD * 2 + it.inner.w, nameW(it.name, 8) + P.TPAD * 2);
    it.h = P.THEAD + it.inner.h + P.TPAD;
  }
  const world = bestPack(items, P.WG, aspect > 0.2 ? aspect : P.ASPECT);
  const tiles = [], isles = [], terrs = [];
  const putIsle = (key, x, y, s, color) => {
    isles.push({ key, x, y, w: s.w, h: s.h, loose: color == null, color });
    byIsle.get(key).forEach((id, j) => tiles.push({ id, ws: key, w: P.TW, h: P.TH, s: P.TH, x: x + P.IPAD + (j % s.cols) * (P.TW + P.TGAP), y: y + P.IPAD + P.IHEAD + Math.floor(j / s.cols) * (P.TH + P.TGAP) }));
  };
  items.forEach((it, i) => {
    const { x, y } = world.pos[i];
    if (it.kind === 'isle') { putIsle(it.key, x, y, it, null); return; }
    terrs.push({ id: it.id, name: it.name, color: it.color, x, y, w: it.w, h: it.h });
    it.keys.forEach((k, j) => putIsle(k, x + P.TPAD + it.inner.pos[j].x, y + P.THEAD + it.inner.pos[j].y, it.sizes[j], it.color));
  });
  return { tiles, isles, terrs, bounds: { x: 0, y: 0, w: Math.max(1, world.w), h: Math.max(1, world.h) } };
}
// 휴대폰 타일 누르기: P153부터 크기와 상관없이 한 번 누르면 그 세션을 연다(사용자: 중간 과정 생략). 섬으로 확대하던 단계(P152)는 없앴다
export const tileTap = () => 'open';

// 숨은 설정 missionStyle(판 설정, 설정 화면에 줄 없음): territories(기본, 이 영토 지도) / classic(P149까지의 열 지도, Mission.jsx ClassicMission·옛 PhoneMission).
// 바꾸려면 atrium CLI의 설정 바꾸기로 missionStyle을 classic으로 둔다
export const MISSION_STYLES = ['territories', 'classic'];
export const missionStyleOf = (settings) => (settings && settings.missionStyle === 'classic' ? 'classic' : 'territories');
