// 워크트리 영역(P27, BRIEF "워크스페이스"). 순수 함수만 둔다. 창(renderer)도 이 파일을 그대로 묶어 쓴다(node 모듈을 부르지 않는다).
// - 같은 리포의 살아 있는 워크트리(폴더가 있는 것)마다 본 저장소 영역 옆에 작은 영역을 따로 둔다. 워크스페이스(키, 탭, 사이드바, 내 차례, 잠재우기)는 그대로 하나다.
// - 영역 키(area key): 본 저장소 영역은 워크스페이스 키 그대로, 워크트리 영역은 `<워크스페이스 키>#wt=<워크트리 경로 키>`.
//   영역 계산(canvas.mjs regionsOf, slotInRegion, separateRegions)은 이 키를 워크스페이스 키처럼 다룬다.
// - 노드가 어느 영역에 있는지는 놓을 때 정해 저장한다(nodes.area, convo_nodes.area: 워크트리 경로 키, 본 저장소는 '').
//   지금 폴더가 든 살아 있는 워크트리(가장 긴 경로)가 저장한 영역과 다르면 그 영역의 빈자리로 옮긴다(worktrees.mjs).
// - P35: 워크트리 영역은 리포 영역 **안**의 노란 상자다(화살표 없음). 상자 사각형은 그 상자의 안의 것(또는 빈 자리)이고,
//   리포 영역(본 저장소 영역)은 본 저장소 쪽 것과 상자들을 함께 감싼다(withBoxes: 상자를 리포 영역의 안의 것 'wtbox'로 더한다).
//   상자는 본 저장소 쪽 것, 같은 리포의 다른 상자와 겹치지 않는다(settleBoxes가 오른쪽·아래로 민다). 영역끼리의 겹침 풀기는 맨 위 영역(리포, 폴더)끼리만이다.
import { pathKey, normPath } from './workspaces.mjs';
import { overlaps, bbox, regionRect, regionsOf, REGION_PAD, REGION_HEAD } from './canvas.mjs';

export const WT_SEP = '#wt=';
export const WT_EMPTY = { w: 480, h: 200 }; // 안이 빈 워크트리 상자
export const BOX_GAP = 60; // P35: 상자와 본 저장소 쪽 것 사이, 상자끼리 사이

export const areaKey = (wsKey, wt) => (wt ? `${wsKey}${WT_SEP}${wt}` : wsKey);
// 영역 키 → { ws, wt }(본 저장소 영역이면 wt '')
export function parseArea(k) {
  const s = String(k || '');
  const i = s.indexOf(WT_SEP);
  return i < 0 ? { ws: s || null, wt: '' } : { ws: s.slice(0, i), wt: s.slice(i + WT_SEP.length) };
}
export const wsOfArea = (k) => parseArea(k).ws;
export const isBoxKey = (k) => String(k || '').includes(WT_SEP); // P35: 워크트리 상자(리포 영역 안)의 영역 키인가

// 창이 쓰는 영역 자리 목록. workspaces: [{ key, x, y, auto, worktrees: [{ wt, area, x, y, branch, path }] }](backend workspaceList)
// → 워크스페이스(그대로)와 워크트리 영역 { key: 영역 키, x, y, empty: WT_EMPTY, wsKey, wt, branch, path }
export function areaAnchorList(workspaces) {
  const out = [];
  for (const w of workspaces || []) {
    out.push(w);
    for (const a of w.worktrees || []) out.push({ key: areaKey(w.key, a.wt), x: a.x, y: a.y, empty: WT_EMPTY, wsKey: w.key, wt: a.wt, branch: a.branch || null, path: a.path || null });
  }
  return out;
}
// (워크스페이스 키, 저장한 area) → 영역 키. 그 워크트리 영역이 없으면(지워진 워크트리) 본 저장소 영역
export function areaResolverOf(workspaces) {
  const live = new Set();
  for (const w of workspaces || []) for (const a of w.worktrees || []) live.add(areaKey(w.key, a.wt));
  return (ws, wt) => { if (!ws || !wt) return ws || null; const k = areaKey(ws, wt); return live.has(k) ? k : ws; };
}

// `git worktree list --porcelain` 출력 → [{ path, key, head, branch, bare, detached, prunable, main }]. 첫 항목이 본 저장소다
export function parseWorktreeList(out) {
  const list = [];
  let cur = null;
  for (const raw of String(out || '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) { if (cur) list.push(cur); cur = null; continue; }
    const sp = line.indexOf(' ');
    const k = sp < 0 ? line : line.slice(0, sp), v = sp < 0 ? '' : line.slice(sp + 1);
    if (k === 'worktree') { if (cur) list.push(cur); cur = { path: normPath(v), key: pathKey(v), head: null, branch: null, bare: false, detached: false, prunable: false, locked: false }; continue; }
    if (!cur) continue;
    if (k === 'HEAD') cur.head = v;
    else if (k === 'branch') cur.branch = v.replace(/^refs\/heads\//, '');
    else if (k === 'bare') cur.bare = true;
    else if (k === 'detached') cur.detached = true;
    else if (k === 'prunable') cur.prunable = true;
    else if (k === 'locked') cur.locked = true;
  }
  if (cur) list.push(cur);
  return list.map((w, i) => ({ ...w, main: i === 0 }));
}

// 영역을 따로 둘 워크트리: 본 저장소가 아니고, 맨 저장소(bare)가 아니고, 폴더가 있는 것(exists(path) → bool)
export function liveWorktrees(list, exists = () => true) {
  return list.filter((w) => !w.main && !w.bare && !w.prunable && exists(w.path));
}

// 폴더가 든 워크트리의 키(가장 긴 경로가 이긴다. 본 저장소 안의 .claude/worktrees/<이름>도 워크트리 쪽). 워크트리 밖이면 ''
// wts: [{ key }](살아 있는 워크트리), mainKey: 본 저장소 폴더 키(있으면 그 경로가 워크트리보다 길 때 본 저장소로)
export function worktreeOfPath(cwd, wts, mainKey = null) {
  if (!cwd || !wts || !wts.length) return '';
  const c = pathKey(cwd);
  const inside = (root) => c === root || c.startsWith(root.endsWith('/') ? root : root + '/');
  let best = '', len = -1;
  for (const w of wts) if (inside(w.key) && w.key.length > len) { best = w.key; len = w.key.length; }
  if (best && mainKey && inside(mainKey) && mainKey.length > len) return '';
  return best;
}

// 이름표 글: ⎇ 브랜치(브랜치가 없으면 폴더 이름). 폴더 이름이 브랜치와 다르면 함께 보인다
export function worktreeLabel(w) {
  const folder = normPath(w.path || '').split('/').filter(Boolean).pop() || '';
  const branch = w.branch || (w.detached ? (w.head ? w.head.slice(0, 7) : 'detached') : '') || folder;
  return { branch, folder: folder && folder !== branch && !branch.endsWith('/' + folder) && !branch.endsWith('-' + folder) ? folder : '' };
}

// ---------- P35: 리포 영역 안의 워크트리 상자 ----------
// 상자 사각형. anchors: areaAnchorList(창)·areaAnchors(백엔드) 결과(상자는 wt가 있다), items: [{ ws: 영역 키, x, y, w, h }] → Map 상자 키 → 사각형
export function boxRects(anchors, items) {
  const by = new Map();
  for (const it of items || []) { if (!it || it.kind === 'wtbox' || !isBoxKey(it.ws)) continue; if (!by.has(it.ws)) by.set(it.ws, []); by.get(it.ws).push(it); }
  const out = new Map();
  for (const a of anchors || []) { if (!a || !a.wt) continue; const r = regionRect(by.get(a.key) || [], a); if (r) out.set(a.key, r); }
  return out;
}
// 상자를 리포 영역의 안의 것(kind 'wtbox', ws: 리포 키, box: 상자 키)으로 더한 목록. 이 목록으로 regionsOf를 부르면 리포 영역이 상자를 감싼다.
// 본 저장소 쪽에 놓는 빈자리 계산(slotInRegion, 대화 노드 격자, 하위 세션 자리)도 상자를 피할 것으로 본다. 이미 든 'wtbox'는 새로 만든다
export function withBoxes(anchors, items) {
  const base = (items || []).filter((i) => i && i.kind !== 'wtbox');
  const boxes = [...boxRects(anchors, base)].map(([key, r]) => ({ id: `wtbox:${key}`, kind: 'wtbox', ws: wsOfArea(key), wsKey: wsOfArea(key), box: key, x: r.x, y: r.y, w: r.w, h: r.h }));
  return [...base, ...boxes];
}
// 영역들(리포 영역은 상자를 감싼다). Map 영역 키 → 사각형(상자 키도 든다)
export const nestedRegions = (anchors, items) => regionsOf(anchors, withBoxes(anchors, items));

// 겹침 쌍(놓은 뒤 새로 생기면 되돌린다): 맨 위 영역(리포, 폴더)끼리, 같은 리포의 상자끼리, 상자와 그 리포의 본 저장소 쪽 것(id).
// 리포 영역과 그 안의 상자는 겹침이 아니다. regs: nestedRegions 결과, items: [{ id, ws, ... }](상자 'wtbox'는 무시) → Set 'a|b'
export function regionConflicts(regs, items = []) {
  const out = new Set();
  const list = [...regs].filter(([, r]) => r);
  const top = list.filter(([k]) => !isBoxKey(k)), boxes = list.filter(([k]) => isBoxKey(k));
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) if (overlaps(top[i][1], top[j][1], -1)) out.add(`${top[i][0]}|${top[j][0]}`);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (wsOfArea(boxes[i][0]) === wsOfArea(boxes[j][0]) && overlaps(boxes[i][1], boxes[j][1], -1)) out.add(`${boxes[i][0]}|${boxes[j][0]}`);
  for (const [k, r] of boxes) { const ws = wsOfArea(k); for (const it of items) if (it && it.kind !== 'wtbox' && it.ws === ws && overlaps(r, it, -1)) out.add(`${k}|${it.id}`); }
  return out;
}

// 상자 겹침 풀기. boxes: [{ key, rect }](한 리포의 상자), fixed: [사각형](그 리포의 본 저장소 쪽 것: 노드, 메모·칸반, 대화 노드) → Map key → { dx, dy }(옮길 것만).
// 본 저장소 쪽 것은 옮기지 않고 상자만 아래로 gap만큼 띄운다. 상자끼리는 뒤(아래, 그다음 오른쪽)에 있는 쪽을 민다.
// P75: 아래로만 민다(전에는 덜 옮기는 쪽인 오른쪽이나 아래). 하위 세션 줄(tree-line.mjs)의 상자들이 한 열에서 순서를 지키고 옆으로 흩어지지 않는다.
// 상자는 통째로 옮기므로 안의 상대 자리가 그대로다. 겹침이 없으면 빈 Map
export function settleBoxes(boxes, fixed = [], { gap = BOX_GAP, maxRounds = 400 } = {}) {
  const list = (boxes || []).filter((b) => b && b.rect).map((b, i) => ({ key: b.key, i, r: { ...b.rect }, dx: 0, dy: 0 }));
  const fx = (fixed || []).filter(Boolean);
  const push = (p, q) => { const ny = q.y + q.h + gap - p.r.y; if (ny > 0) { p.r.y += ny; p.dy += ny; } }; // p를 q 아래로
  for (let round = 0; round < maxRounds; round++) {
    let moved = false;
    for (const p of list) for (const q of fx) if (overlaps(p.r, q, -1)) { push(p, q); moved = true; }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!overlaps(a.r, b.r, -1)) continue;
      const later = b.r.y - a.r.y || b.r.x - a.r.x || b.i - a.i;
      if (later > 0) push(b, a.r); else push(a, b.r);
      moved = true;
    }
    if (!moved) break;
  }
  return new Map(list.filter((x) => x.dx || x.dy).map((x) => [x.key, { dx: Math.round(x.dx), dy: Math.round(x.dy) }]));
}

// 새 상자의 자리(상자 사각형의 왼쪽 위). content: 그 리포의 본 저장소 쪽 것(사각형), boxes: 이미 있는 상자 사각형, main: 리포 영역(안이 비었을 때 쓴다).
// 본 저장소 쪽 것의 오른쪽이나 아래, 이미 있는 상자의 아래나 오른쪽 가운데 어느 것과도 gap 넘게 떨어지고 리포 영역이 덜 길쭉해지는(화면 비율) 곳.
// 리포 영역이 비었으면 그 영역 안쪽 왼쪽 위(리포 영역 자리가 그대로다)
export function boxSlot({ main = null, content = [], boxes = [], size = WT_EMPTY, gap = BOX_GAP, aspect = 1.6 } = {}) {
  const taken = [...content, ...boxes].filter(Boolean);
  if (!taken.length) return main ? { x: Math.round(main.x + REGION_PAD), y: Math.round(main.y + REGION_HEAD + REGION_PAD) } : { x: 0, y: 0 };
  const free = (c) => !taken.some((r) => overlaps({ ...c, w: size.w, h: size.h }, r, gap - 1));
  const base = bbox(content.filter(Boolean)) || bbox(boxes);
  const cands = [{ x: base.x + base.w + gap, y: base.y }, { x: base.x, y: base.y + base.h + gap }];
  for (const b of boxes) cands.push({ x: b.x, y: b.y + b.h + gap }, { x: b.x + b.w + gap, y: b.y });
  const score = (c) => { const u = bbox([...taken, { ...c, w: size.w, h: size.h }]); return Math.round(Math.max(u.w, u.h * aspect)); };
  cands.sort((a, b) => score(a) - score(b) || a.y - b.y || a.x - b.x);
  for (const c of cands) if (free(c)) return { x: Math.round(c.x), y: Math.round(c.y) };
  const all = bbox(taken);
  return { x: Math.round(all.x), y: Math.round(all.y + all.h + gap) };
}

// 옛 판(P27~P34: 리포 영역 바깥의 위성 영역)의 상자를 리포 영역 안으로 다시 놓는 옮김 값. 한 리포마다 부른다.
// content: 본 저장소 쪽 것(사각형), boxes: [{ key, rect }](지금 상자 사각형), main: 리포 영역(안이 비었을 때) → Map key → { dx, dy }(옮길 것만).
// 상자를 지금 위아래·왼쪽 오른쪽 순서로 하나씩 boxSlot 자리에 놓는다. 결과에 다시 돌리면 옮길 것이 없다(같은 자리)
export function migrateBoxes({ main = null, content = [], boxes = [], gap = BOX_GAP } = {}) {
  const order = [...(boxes || [])].filter((b) => b && b.rect).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || String(a.key).localeCompare(String(b.key)));
  const placed = [];
  const out = new Map();
  for (const b of order) {
    const at = boxSlot({ main, content, boxes: placed, size: { w: b.rect.w, h: b.rect.h }, gap });
    placed.push({ x: at.x, y: at.y, w: b.rect.w, h: b.rect.h });
    const dx = Math.round(at.x - b.rect.x), dy = Math.round(at.y - b.rect.y);
    if (dx || dy) out.set(b.key, { dx, dy });
  }
  return out;
}

// ---------- P68: 같은 리포의 워크트리끼리 붙인 덩어리 ----------
// 같은 리포의 서로 다른 영역(본 저장소 영역, 워크트리 상자) 세션이 섞인 덩어리는 리포 영역(본 저장소 쪽)에 놓는다.
// 세션의 워크트리 정보(nodes.area)는 바꾸지 않는다. 한 상자 안의 세션끼리만 붙인 덩어리는 지금처럼 그 상자 안이다.
// docks: [{ members }], areaOf(sid) → 저장한 area로 본 영역 키(판에 없는 노드는 null)
// → { area: Map sid → 리포 키(섞인 덩어리의 구성 노드만), pulled: Set 구성 노드가 덩어리로 빠져나간 상자 키 }
export function dockedAreas(docks, areaOf) {
  const area = new Map(), pulled = new Set();
  for (const d of docks || []) {
    const ks = (d.members || []).map((m) => [m, areaOf(m)]).filter(([, k]) => k);
    if (new Set(ks.map(([, k]) => k)).size < 2) continue;
    for (const [m, k] of ks) { const top = wsOfArea(k); if (k !== top) pulled.add(k); area.set(m, top); }
  }
  return { area, pulled };
}
// 숨길 상자를 뺀 영역 자리: 구성 노드가 덩어리로 빠져나가 안이 빈 상자(워크트리 자체와 저장한 자리는 그대로).
// anchors: areaAnchorList·areaAnchors 결과, items: [{ ws: 영역 키 }](덩어리 자리를 반영한 것), pulled: dockedAreas(...).pulled
export function visibleAnchors(anchors, items, pulled) {
  if (!pulled || !pulled.size) return anchors;
  const used = new Set((items || []).map((i) => i && i.ws));
  return (anchors || []).filter((a) => !(a && a.wt && pulled.has(a.key) && !used.has(a.key)));
}
// 워커를 한 번에 붙일 배치 틀(세션 수에 맞는 고른 틀). 둘 가로, 셋 가로 셋, 넷 2 × 2, 다섯 위 셋 아래 둘, 여섯 3 × 2, 그 위로는 고른 줄
export function workersPreset(n) {
  return n <= 2 ? 'row' : n === 3 ? 'row3' : n === 4 ? 'grid' : n === 5 ? 'top3-bottom2' : n === 6 ? 'grid-3x2' : 'even-rows';
}
