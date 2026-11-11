// 단일 캔버스와 관계 표현의 판 API(ARCH 4절 H, P6a). backend.mjs의 Backend(b)를 받아 판 기록을 바꾼다. herdr는 어댑터로만 부른다.
// - 영역과 빈자리(H1), 영역 옮기기, 검색(H2), 붙여 묶기(H5), 크기 단계와 정리(H7). 골라 묶기(그룹, H6)는 P22에서 뺐다
// - 계산은 canvas.mjs·search.mjs의 순수 함수(창도 같이 씀). 바꾼 뒤에는 board.changed를 보내 창이 판을 다시 읽게 한다.
import crypto from 'node:crypto';
import { NODE, SIZE_STEPS, SIZE_DIRS, SIZE_LEVELS, ASPECTS, parseStep, resolveSize, fitsAspect, matchAspect, stepSize, DEFAULT_ASPECT, dirOf, aspectOf, DOCK_CELL, GAP, EMPTY_REGION, AUTO_EMPTY_REGION, regionsOf, regionRect, slotInRegion, newRegionSlot, freeSlot, separateRegions, splitSide, arrangeTree, overlaps, bbox, REGION_GAP, dockSpot, levelOf, NEW_NODE, groupFrames, separateGrouped, groupSlot } from './canvas.mjs';
import { layout as layoutTree, normalize, leaves, isLeaf, fromLine, minSize, remove as removeLeaf, removeWithOuter, insertWithOuter, rootSizes, presetTree, presetSize, PRESETS, sideDir, dockVirtual, dockFit } from './dock-tree.mjs'; // P17: 분할 나무
import { searchBoard, searchItems } from './search.mjs';
import { clip } from './text.mjs';
import { areaKey, parseArea, wsOfArea, isBoxKey, WT_EMPTY, withBoxes, nestedRegions, regionConflicts, settleBoxes, migrateBoxes, dockedAreas, visibleAnchors, workersPreset } from './worktree-areas.mjs'; // P27: 워크트리 영역. P35: 리포 영역 안의 상자. P68: 워크트리끼리 붙인 덩어리
import { layoutRegions, linkWeights } from './region-layout.mjs'; // P31: 판 전체 정리의 영역 배치. P99: 다른 영역끼리의 연결 무게
import { readGroups, groupIndex } from './ws-groups.mjs'; // P44: 가상 그룹끼리 모으기
import { blockTree, pushLine, bandOf, subtreeIds, lineKids, boxFrame, BOX_PAD } from './tree-line.mjs'; // P75: 하위 세션 줄

function apiError(code, message) { return Object.assign(new Error(message), { code }); }
import { keyed } from './msg.mjs'; // P16: 화면 글 열쇠

// ---------- 영역과 빈자리(H1) ----------
// 캔버스 위에서 자리를 차지한 것: 세션 노드, 메모·칸반 노드(P6c). ws는 워크스페이스 키
// 메모·칸반도 넣어야 새 세션이 그 위에 놓이지 않고, 그 워크스페이스 영역이 감싼다
// P27: ws는 영역 키(본 저장소 영역은 워크스페이스 키, 워크트리 영역은 worktree-areas.mjs areaKey), wsKey는 워크스페이스 키.
// 노드와 대화 노드는 저장한 영역(area)이 살아 있는 워크트리 영역이면 그 영역, 아니면 본 저장소 영역이다. 메모·칸반은 본 저장소 영역이다
// P35: 워크트리 상자는 리포 영역 안에 있다. 목록 끝에 상자마다 리포 영역의 안의 것 { kind: 'wtbox', ws: 리포 키, box: 상자 키 }를 더한다(worktree-areas.mjs withBoxes).
//   그래서 리포 영역이 상자를 감싸고, 본 저장소 쪽 빈자리 계산은 상자를 피한다
const areaRows = (b) => (b.store.worktreeAreas ? b.store.worktreeAreas() : []);
function areaResolver(b) {
  const live = new Set(areaRows(b).map((a) => areaKey(a.wsKey, a.wt)));
  return (ws, wt) => { if (!ws || !wt) return ws || null; const k = areaKey(ws, wt); return live.has(k) ? k : ws; };
}
// P68: 같은 리포의 다른 영역 세션이 섞인 덩어리의 구성 노드는 리포 영역(본 저장소 쪽)에 든다(worktree-areas.mjs dockedAreas). 저장한 area는 그대로다.
//   closed: 막 닫힌 세션 { sessionId, workspaceKey }(그 세션이 아직 덩어리에 든 것으로 본다. onSessionClosed가 닫히기 전 판을 셀 때)
// → { items: 상자를 뺀 안의 것, pulled: 구성 노드가 덩어리로 빠져나간 상자 키 }
function boardItems(b, { closed = null } = {}) {
  const area = areaResolver(b);
  const rows = b.store.nodes().filter((n) => b.sessions.has(n.session_id));
  const byId = new Map(rows.map((n) => [n.session_id, n]));
  const rawArea = (sid) => {
    const n = byId.get(sid);
    if (n) return area(n.workspace_key || null, n.area);
    if (closed && closed.sessionId === sid && b.store.nodeOf) { const r = b.store.nodeOf(sid); return r ? area(closed.workspaceKey || null, r.area) : null; }
    return null;
  };
  const docked = dockedAreas(b.store.docks ? b.store.docks() : [], rawArea);
  const nodes = rows.map((n) => ({ id: n.session_id, kind: 'node', ws: docked.area.get(n.session_id) ?? area(n.workspace_key || null, n.area), wsKey: n.workspace_key || null, x: n.x, y: n.y, w: n.w, h: n.h }));
  const memos = b.store.memos().map((m) => ({ id: m.memoId, kind: 'memo', ws: m.workspaceKey || null, wsKey: m.workspaceKey || null, x: m.x, y: m.y, w: m.w, h: m.h }));
  const kanbans = b.store.kanbans().map((k) => ({ id: k.kanbanId, kind: 'kanban', ws: k.workspaceKey || null, wsKey: k.workspaceKey || null, x: k.x, y: k.y, w: k.w, h: k.h }));
  // P13: 캔버스에 올린 판 밖 대화 노드(읽기 전용 카드). id는 convo:<대화 ID>
  const convos = b.store.shownConvoNodes ? b.store.shownConvoNodes().map((n) => ({ id: `convo:${n.convId}`, kind: 'convo', ws: area(n.workspaceKey || null, n.area), wsKey: n.workspaceKey || null, x: n.x, y: n.y, w: n.w, h: n.h })) : [];
  return { items: [...nodes, ...memos, ...kanbans, ...convos], pulled: docked.pulled };
}
export function canvasItems(b) {
  const s = boardItems(b);
  return withBoxes(anchorsFrom(b, s), s.items);
}
// 영역의 자리(안이 비었을 때): 워크스페이스와, 그 워크스페이스의 워크트리 영역(P27). P68: 덩어리로 빠져나가 빈 상자는 숨긴다
export function areaAnchors(b) { return anchorsFrom(b, boardItems(b)); }
function anchorsFrom(b, { items, pulled }) {
  const ws = b.store.workspaces();
  const keys = new Set(ws.map((w) => w.key));
  return visibleAnchors([...ws, ...areaRows(b).filter((a) => keys.has(a.wsKey)).map((a) => ({ key: areaKey(a.wsKey, a.wt), x: a.x, y: a.y, empty: WT_EMPTY, wsKey: a.wsKey, wt: a.wt }))], items, pulled);
}
export const regions = (b, items = canvasItems(b)) => nestedRegions(areaAnchors(b), items); // P35: 리포 영역은 상자를 감싼다(상자 키도 든다)
// 세션 노드가 든 영역 키(P27)
export const areaOfNode = (b, sid, items = canvasItems(b)) => { const it = items.find((i) => i.kind === 'node' && i.id === sid); return it ? it.ws : (b.sessions.get(sid) || {}).workspaceKey || null; };

// 새 워크스페이스의 영역 자리: 다른 영역과 겹치지 않는 곳
export function anchorWorkspace(b, key) {
  const w = b.store.getWorkspace(key);
  if (!w || (w.x != null && w.y != null)) return;
  const rs = regions(b);
  rs.delete(key);
  const size = w.auto ? AUTO_EMPTY_REGION : EMPTY_REGION;
  // P91: 묶음(가상 그룹)에 든 새 워크스페이스는 그 묶음 곁에, 아니면 그려진 묶음 테두리를 한 덩어리로 피해 놓는다
  const top = new Map([...rs].filter(([k]) => !isBoxKey(k)));
  const groups = readGroups(b).groups;
  const frames = groupFrames(groups.map((g) => ({ ...g, members: g.members.filter((k) => k !== key) })), top).filter((f) => f.ok);
  const g = groups.find((x) => x.members.includes(key));
  let at = null;
  if (g) {
    const mine = g.members.filter((k) => k !== key && top.has(k));
    at = groupSlot(mine.map((k) => top.get(k)), [...top].filter(([k]) => !mine.includes(k)).map(([, r]) => r), size);
  }
  if (!at) at = newRegionSlot([...rs.values(), ...frames.map((f) => f.rect)], size);
  b.store.setWorkspaceAnchor(key, at.x, at.y);
}

// 새 세션 노드의 자리. near(부모 노드)가 있으면 그 옆, 아니면 영역 안이나 바로 옆
// P27: area(워크트리 경로 키)를 주면 그 워크트리 영역 안(영역이 없으면 본 저장소 영역)
export function slotFor(b, { wsKey, size = NODE, near = null, area = '' }) {
  anchorWorkspace(b, wsKey);
  const items = canvasItems(b);
  const regs = regions(b, items);
  const k = area && regs.has(areaKey(wsKey, area)) ? areaKey(wsKey, area) : wsKey;
  return slotInRegion({ wsKey: k, size, items: slotItems(items, k), regions: slotRegions(regs, k), near });
}
// P27: 워크트리 영역에 놓을 때는 같은 리포의 다른 워크트리 영역을 피하지 않는다(빈 영역 바로 아래에 다음 영역이 있다).
// 커진 영역이 형제 영역과 겹치면 부르는 쪽이 settleRegions로 아래·오른쪽으로 민다
// P35: 상자에 놓을 때는 같은 리포의 다른 상자(리포 영역의 안의 것 'wtbox')도 피하지 않는다. 그래야 상자가 제자리에서 커지고, 형제 상자와 겹치면 settleRegions가 뒤의 상자를 민다
export function slotItems(items, k) {
  const { ws, wt } = parseArea(k);
  return wt ? items.filter((i) => !(i.kind === 'wtbox' && wsOfArea(i.box) === ws)) : items;
}
export function slotRegions(regs, k) {
  const { ws, wt } = parseArea(k);
  if (!wt) return regs;
  return new Map([...regs].filter(([key]) => key === k || wsOfArea(key) !== ws || !parseArea(key).wt));
}

// 메모·칸반 노드의 자리(P6c). near는 원하는 왼쪽 위(창은 보던 화면 가운데를 준다).
// 워크스페이스가 있으면 그 영역 안이나 바로 옆 빈자리(near가 비었으면 거기부터), 없으면 어느 노드·영역과도 겹치지 않는 빈자리
export function placeItem(b, { wsKey = null, size, near = null }) {
  if (wsKey) {
    anchorWorkspace(b, wsKey);
    const items = canvasItems(b);
    // slotInRegion은 near의 오른쪽부터 고리로 찾는다. near 자리 자체를 먼저 보도록 한 칸 왼쪽을 기준으로 준다
    const base = near ? { x: Math.round(near.x) - size.w - GAP, y: Math.round(near.y), w: size.w, h: size.h } : null;
    return slotInRegion({ wsKey, size, items, regions: regions(b, items), near: base });
  }
  const items = canvasItems(b);
  return freeSlot({ size, rects: [...items, ...regions(b, items).values()], near });
}

// 영역 이름표를 끌면 안의 것(노드, 메모·칸반)이 모두 함께 움직인다
export function workspaceMove(b, p) {
  const key = p.workspace;
  const w = b.store.getWorkspace(key);
  if (!w) throw keyed(apiError('not_found', `보드에서 프로젝트를 찾을 수 없습니다: ${key}`), 'wsNotFound', { ref: key });
  const dx = Math.round(Number(p.dx) || 0), dy = Math.round(Number(p.dy) || 0);
  if (!dx && !dy) return { moved: 0 };
  const items = canvasItems(b);
  const before = regions(b, items);
  // P27: 리포 영역을 옮기면 워크트리 영역도 함께 옮긴다(P35: 상자는 리포 영역 안이다)
  const own = items.filter((i) => i.wsKey === key && i.kind !== 'wtbox');
  const mine = [...before].filter(([k]) => wsOfArea(k) === key);
  const hit = mine.map(([, r]) => ({ ...r, x: r.x + dx, y: r.y + dy })).map((after) => [...before].find(([k, r]) => wsOfArea(k) !== key && overlaps(after, r, -1))).find(Boolean);
  if (hit && !p.force) throw keyed(apiError('overlap', `다른 프로젝트 영역과 겹칩니다 (${hit[0]})`), 'regionOverlap', { ws: wsOfArea(hit[0]) });
  shiftWorkspace(b, key, dx, dy, items);
  b.store.addEvent(null, 'workspace_moved', { key, dx, dy, items: own.length, areas: mine.length - (before.has(key) ? 1 : 0) });
  b.api.broadcast('board.changed', { why: 'workspace.move' });
  return { moved: own.length, dx, dy };
}

// P27: 워크트리 영역 하나만 옮긴다(이름표를 끌었다). 그 자리를 저장한다.
// P35: 상자는 리포 영역 안이다. 옮긴 상자가 같은 리포의 다른 상자나 본 저장소 쪽 것과 겹치거나, 그만큼 커진 리포 영역이 다른 영역과 겹치면 거부(overlap).
//   리포 영역 밖으로 끌면 리포 영역이 그 상자를 감싸도록 커진다
export function worktreeMove(b, p) {
  const w = b.store.getWorkspace(p.workspace);
  if (!w) throw keyed(apiError('not_found', `보드에서 프로젝트를 찾을 수 없습니다: ${p.workspace}`), 'wsNotFound', { ref: p.workspace });
  const row = areaRows(b).find((a) => a.wsKey === w.key && (a.wt === p.worktree || a.path === p.worktree || a.branch === p.worktree));
  if (!row) throw apiError('not_found', `보드에서 워크트리 영역을 찾을 수 없습니다: ${p.worktree}`);
  const dx = Math.round(Number(p.dx) || 0), dy = Math.round(Number(p.dy) || 0);
  if (!dx && !dy) return { moved: 0 };
  const key = areaKey(w.key, row.wt);
  const items = canvasItems(b);
  const hit = boxMoveHit(areaAnchors(b), items, key, dx, dy);
  if (hit && !p.force) throw keyed(apiError('overlap', `다른 영역과 겹칩니다 (${hit})`), 'regionOverlap', { ws: w.key });
  const n = shiftWorkspace(b, key, dx, dy, items);
  b.store.putWorktreeArea({ ...b.store.worktreeAreas().find((a) => a.wsKey === w.key && a.wt === row.wt), movedAt: Date.now() });
  b.store.addEvent(null, 'worktree_area_moved', { key: w.key, worktree: row.path, dx, dy, items: n });
  b.api.broadcast('board.changed', { why: 'worktree.move' });
  return { moved: n, dx, dy };
}
// P35: 상자(key)를 dx, dy 옮겼을 때 새로 생기는 겹침 쌍(없으면 null). 창의 놓기 확인과 같은 규칙(worktree-areas.mjs regionConflicts)
export function boxMoveHit(anchors, items, key, dx, dy) {
  const base = items.filter((i) => i.kind !== 'wtbox');
  const before = regionConflicts(nestedRegions(anchors, base), base);
  const moved = base.map((i) => (i.ws === key ? { ...i, x: i.x + dx, y: i.y + dy } : i));
  const anc = anchors.map((a) => (a.key === key ? { ...a, x: a.x + dx, y: a.y + dy } : a));
  const after = regionConflicts(nestedRegions(anc, moved), moved);
  return [...after].find((x) => !before.has(x)) || null;
}

// 영역 하나의 안의 것(노드, 메모·칸반, 대화 노드)과 영역 자리를 통째로 옮긴다. 키는 영역 키(P27).
// P35: 리포 영역(본 저장소 영역)을 옮기면 그 안의 워크트리 상자(안의 것과 자리)도 늘 함께 옮긴다. 상자 키면 그 상자만
function shiftWorkspace(b, key, dx, dy, items = canvasItems(b), { notify = true } = {}) {
  const { ws: wsKey, wt } = parseArea(key);
  const satellites = !wt;
  const inArea = (i) => (satellites ? i.wsKey === wsKey : i.ws === key);
  const own = items.filter((i) => i.kind !== 'wtbox' && inArea(i));
  const ids = new Set(own.filter((i) => i.kind === 'node').map((i) => i.id));
  for (const n of b.store.nodes()) if (ids.has(n.session_id)) b.store.setNode({ ...n, x: n.x + dx, y: n.y + dy });
  // 메모·칸반도 함께 옮긴다(P6c). 창이 이벤트로 바꿔 끼운다
  for (const m of own.filter((i) => i.kind === 'memo')) { b.store.updateMemo(m.id, { x: m.x + dx, y: m.y + dy }); if (notify && b.features) b.api.broadcast('memo.updated', b.store.getMemo(m.id)); }
  for (const k of own.filter((i) => i.kind === 'kanban')) { b.store.updateKanban(k.id, { x: k.x + dx, y: k.y + dy }); if (notify && b.features) b.features.kanbans.emit(b.store.getKanban(k.id)); }
  // P13: 대화 노드도 함께(숨긴 것도 같이 옮겨 다시 보일 때 영역 안에 있게). 창은 convo.nodes로 바꿔 끼운다
  // P27: 숨긴 대화 노드는 저장한 영역으로 가린다(살아 있지 않은 워크트리 영역이면 본 저장소 영역)
  if (b.store.convoNodes) {
    const live = new Set(areaRows(b).filter((a) => a.wsKey === wsKey).map((a) => a.wt));
    const cs = b.store.convoNodes().filter((n) => n.workspaceKey === wsKey && (satellites || (live.has(n.area) ? n.area : '') === wt));
    for (const n of cs) b.store.putConvoNode({ ...n, x: n.x + dx, y: n.y + dy });
    if (notify && cs.length && b.recall) b.recall.layoutCanvas().catch(() => {});
  }
  if (!wt) { const w = b.store.getWorkspace(wsKey); if (w && w.x != null) b.store.setWorkspaceAnchor(wsKey, w.x + dx, w.y + dy); }
  for (const a of areaRows(b)) if (a.wsKey === wsKey && (satellites || a.wt === wt)) b.store.putWorktreeArea({ ...a, x: a.x + dx, y: a.y + dy });
  return own.length;
}

// 영역끼리 겹치면 통째로 밀어 편다(P9, H1). 백엔드가 뜰 때(이미 겹친 판)와 새 노드를 놓거나 크기를 바꾼 뒤에 부른다.
// 영역 안의 상대 자리와 영역끼리의 좌우·위아래 관계는 지킨다(canvas.mjs separateRegions). 옮긴 것이 없으면 아무것도 하지 않는다
// P35: 먼저 리포마다 안의 워크트리 상자가 본 저장소 쪽 것이나 다른 상자와 겹치면 상자를 민다(settleBoxes, 리포 영역이 그만큼 커진다).
//   그다음 맨 위 영역(리포, 폴더)끼리 편다. 리포 영역을 밀면 안의 상자도 함께 간다
export function settleRegions(b, cause = 'unknown') {
  const moved = [];
  let items = canvasItems(b);
  const boxesOf = new Map();
  for (const [k, r] of regions(b, items)) if (isBoxKey(k)) { const ws = wsOfArea(k); if (!boxesOf.has(ws)) boxesOf.set(ws, []); boxesOf.get(ws).push({ key: k, rect: r }); }
  for (const [ws, boxes] of boxesOf) {
    const fixed = items.filter((i) => i.ws === ws && i.kind !== 'wtbox');
    for (const [key, { dx, dy }] of settleBoxes(boxes, fixed)) moved.push({ key, dx, dy, items: shiftWorkspace(b, key, dx, dy, items) });
  }
  if (moved.length) items = canvasItems(b);
  const top = new Map([...regions(b, items)].filter(([k]) => !isBoxKey(k)));
  // P91: 그려진 묶음(가상 그룹 테두리)은 한 덩어리로 민다
  for (const [key, { dx, dy }] of separateGrouped(top, readGroups(b).groups)) moved.push({ key, dx, dy, items: shiftWorkspace(b, key, dx, dy, items) });
  if (!moved.length) return [];
  b.store.addEvent(null, 'regions_settled', { cause, moved });
  if (b.log) b.log(`regions settled (${cause}) ${JSON.stringify(moved)}`);
  if (b.api) b.api.broadcast('board.changed', { why: 'regions settled' });
  return moved;
}

// P35: 옛 판(P27~P34)의 워크트리 영역은 리포 영역 바깥 옆(위성)에 있다. 처음 켤 때 한 번 리포 영역 안(본 저장소 쪽 것의 오른쪽이나 아래)으로 다시 놓는다.
// meta 'boxesInside'로 한 번만 한다(다시 불러도 아무것도 하지 않는다). 영역 겹침 풀기(settleRegions 'start')보다 먼저 부른다
export const BOXES_INSIDE = 'boxesInside';
export function migrateBoxesInside(b) {
  if (!b.store.worktreeAreas || b.store.getMeta(BOXES_INSIDE)) return [];
  const moved = [];
  const items = canvasItems(b);
  const anchors = areaAnchors(b);
  const rects = regions(b, items);
  b.store.tx(() => {
    for (const w of b.store.workspaces()) moved.push(...reslotBoxes(b, w, { items, anchors, rects, notify: false }));
    b.store.setMeta(BOXES_INSIDE, { at: Date.now(), moved: moved.length });
    if (moved.length) b.store.addEvent(null, 'worktree_boxes_migrated', { moved });
  });
  if (moved.length && b.log) b.log(`worktree boxes moved inside ${JSON.stringify(moved)}`);
  return moved;
}

// 리포 하나의 워크트리 상자를 본 저장소 쪽 것의 오른쪽이나 아래로 다시 놓는다(상자째 옮겨 안의 상대 자리는 그대로, migrateBoxes).
// P35 옛 위성 옮기기와 P37 합치기(본 저장소 쪽이 비어 있던 저장소 영역에 폴더 영역의 것이 들어왔을 때)가 쓴다. 옮긴 것 [{ key, dx, dy, items }]
export function reslotBoxes(b, w, { items = canvasItems(b), anchors = areaAnchors(b), rects = regions(b, items), notify = true } = {}) {
  const moved = [];
  const boxes = anchors.filter((a) => a.wt && a.wsKey === w.key).map((a) => ({ key: a.key, rect: rects.get(a.key) })).filter((x) => x.rect);
  if (!boxes.length) return moved;
  const content = items.filter((i) => i.ws === w.key && i.kind !== 'wtbox');
  const main = regionRect(content, w);
  for (const [key, { dx, dy }] of migrateBoxes({ main, content, boxes })) moved.push({ key, dx, dy, items: shiftWorkspace(b, key, dx, dy, items, { notify }) });
  return moved;
}

// ---------- 붙여 묶기(H5, P17 분할 나무) ----------
// 덩어리 = 분할 나무(dock-tree.mjs). 표 docks에 나무(비율)를 두고, 구성 노드의 자리와 크기는 nodes 표에 나무를 늘어놓은 값으로 쓴다.
// 바깥 직사각형은 따로 두지 않고 구성 노드 사각형의 bbox로 본다(늘어놓으면 틈 없이 채우므로).
export const dockOf = (b, sid) => b.store.docks().find((d) => d.members.includes(sid)) || null;
const nodeRect = (b, sid) => b.store.nodes().find((n) => n.session_id === sid) || null;
// 막 닫힌 세션은 nodes()에 없다. 닫힌 행의 자리(nodeOf)를 쓴다(P10에서 찾은 오류: 덩어리 첫 노드를 끄면 끄기가 실패했다)
const anyRect = (b, sid) => nodeRect(b, sid) || (b.store.nodeOf ? b.store.nodeOf(sid) : null);
export function dockOuter(b, d) { return bbox(d.members.map((sid) => anyRect(b, sid))); }

// 나무를 바깥 안에 늘어놓아 구성 노드 자리를 쓴다(크기 단계 표시는 그대로)
function applyLayout(b, tree, outer) {
  if (!tree || !outer) return null;
  const lay = layoutTree(tree, outer);
  for (const [sid, r] of lay.rects) { const n = nodeRect(b, sid); if (n) b.store.setNode({ ...n, x: r.x, y: r.y, w: r.w, h: r.h }); }
  return lay.outer;
}
// P80: 덩어리의 크기 상태. 바깥을 같은 규칙의 단독 세션 하나(dock-tree.mjs dockVirtual)로 보고 단독 세션처럼 불을 켠다(비율 불은 기록한 비율에 맞을 때만)
export function dockState(b, d) {
  const v = d ? dockVirtual(d.tree, dockOuter(b, d)) : null;
  if (!v) return null;
  const aspect = aspectOf(v, d.aspect);
  return { single: v, dir: dirOf(v), aspect, level: aspect ? levelOf(v, aspect) : null };
}
// P80: 비율에 불이 든 덩어리의 단독 세션 크기(붙이기·떼기·틀 바꾸기에서 지킨다. 단계 불이 있으면 표의 크기, 없으면 지금 넓이). 꺼져 있으면 null
function litSingle(b, d) { const st = dockState(b, d); return st && st.aspect ? resolveSize(st.single, st.aspect, {}) : null; }
// P80: 나무(비율 그대로)를 단독 세션 크기(single) 규칙의 바깥에 둘 사각형. anchor의 왼쪽 위(side가 left·top이면 오른쪽·아래 변)를 지킨다
function fitOuter(tree, single, anchor, side = null) {
  const f = dockFit(tree, single), need = minSize(tree);
  const outer = { x: anchor.x, y: anchor.y, w: Math.max(need.w, f.w), h: Math.max(need.h, f.h) };
  if (side === 'left') outer.x = anchor.x + anchor.w - outer.w;
  if (side === 'top') outer.y = anchor.y + anchor.h - outer.h;
  return outer;
}
// P68: 덩어리를 바꾸는 일(fn) 앞뒤로 워크트리 상자를 맞춘다. 같은 리포의 다른 영역 세션이 섞인 덩어리는 리포 영역에 놓인다(boardItems).
// 1) 구성 노드가 덩어리로 빠져나가 새로 숨는 상자: 숨기 전 사각형의 왼쪽 위를 그 상자 자리로 저장한다(떼면 그 자리로 돌아온다).
// 2) 섞인 덩어리에서 나와 다시 자기 상자에 드는 노드(남은 덩어리가 한 상자 것뿐이면 덩어리째): 그 상자의 빈자리로 옮긴다.
// closed: 막 닫힌 세션(onSessionClosed). 그 세션이 든 덩어리를 닫히기 전 모양으로 센다
function keepBoxes(b, fn, { closed = null } = {}) {
  const before = boardItems(b, { closed });
  const beforeRects = nestedRegions(anchorsFrom(b, before), before.items);
  const was = new Map(before.items.filter((i) => i.kind === 'node').map((i) => [i.id, i.ws]));
  const out = fn();
  const after = boardItems(b);
  for (const k of after.pulled) {
    const r = beforeRects.get(k);
    if (before.pulled.has(k) || !r || after.items.some((i) => i.ws === k)) continue;
    const { ws, wt } = parseArea(k);
    const row = areaRows(b).find((a) => a.wsKey === ws && a.wt === wt);
    if (row) { b.store.putWorktreeArea({ ...row, x: r.x, y: r.y }); b.store.addEvent(null, 'worktree_box_hidden', { key: ws, worktree: row.path, at: { x: r.x, y: r.y } }); }
  }
  const done = new Set();
  for (const it of after.items) {
    if (it.kind !== 'node' || done.has(it.id) || !isBoxKey(it.ws) || !was.has(it.id) || isBoxKey(was.get(it.id))) continue;
    const d = dockOf(b, it.id);
    const group = d ? d.members.filter((m) => b.sessions.has(m)) : [it.id];
    group.forEach((m) => done.add(m));
    const rects = group.map((m) => nodeRect(b, m)).filter(Boolean);
    const box = bbox(rects);
    if (!box) continue;
    const items = withBoxes(areaAnchors(b), canvasItems(b).filter((i) => i.kind !== 'wtbox' && !group.includes(i.id)));
    const regs = regions(b, items);
    if (!regs.has(it.ws)) continue;
    const at = slotInRegion({ wsKey: it.ws, size: { w: box.w, h: box.h }, items: slotItems(items, it.ws), regions: slotRegions(regs, it.ws) });
    const dx = Math.round(at.x - box.x), dy = Math.round(at.y - box.y);
    if (!dx && !dy) continue;
    for (const r of rects) b.store.setNode({ ...r, x: r.x + dx, y: r.y + dy });
    b.store.addEvent(it.id, 'node_moved', { from: { x: box.x, y: box.y, w: box.w, h: box.h }, to: { x: at.x, y: at.y, w: box.w, h: box.h }, cause: 'worktree box return', members: group.length });
  }
  return out;
}

// 나무를 저장한다. 잎이 둘보다 적으면 덩어리를 지운다
function saveDock(b, dock, why) {
  const tree = normalize(dock.tree);
  const members = leaves(tree);
  if (members.length < 2) {
    if (dock.dockId && b.store.getDock(dock.dockId)) { b.store.deleteDock(dock.dockId); b.store.addEvent(null, 'dock_removed', { dockId: dock.dockId, why }); }
    return null;
  }
  const row = { dockId: dock.dockId, workspaceKey: dock.workspaceKey ?? null, tree, origin: dock.origin ?? null };
  if (dock.dockId && b.store.getDock(dock.dockId)) b.store.updateDock(dock.dockId, row);
  else { row.dockId ||= 'd' + crypto.randomBytes(5).toString('hex'); row.createdAt = Date.now(); b.store.insertDock(row); }
  b.store.addEvent(null, 'dock_saved', { dockId: row.dockId, tree: renameTree(b, tree), why });
  return b.store.getDock(row.dockId);
}
// 이벤트에 남길 나무(세션 ID 대신 이름)
const renameTree = (b, t) => (isLeaf(t) ? b.nameOf(t) : { dir: t.dir, kids: t.kids.map((k) => renameTree(b, k)), ratios: t.ratios });
const sameWs = (b, ids) => { const ws = new Set(ids.map((id) => b.sessions.get(id).workspaceKey || null)); return ws.size === 1 ? [...ws][0] : undefined; };
const SIDES = ['left', 'right', 'top', 'bottom'];

// 노드 하나를 다른 노드(덩어리) 가장자리에 붙인다.
// at = 'leaf': 대상 노드를 side 쪽으로 반씩 나눠 그 반을 차지한다. at = 'dock': 덩어리 전체(혼자인 노드면 그 노드) 옆에 새 칸으로 붙는다(붙는 노드 크기만큼 덩어리가 커진다).
// at을 주지 않으면 대상이 덩어리 안이면 'leaf', 혼자이면 'dock'(옛 한 줄 붙이기와 같다: 붙는 노드는 제 너비·높이를 지키고 다른 쪽은 대상을 따른다)
export function dockAttach(b, p, why = 'user') {
  const r = keepBoxes(b, () => attachInner(b, p, why)); // P68
  settleRegions(b, 'dock attach');
  return r;
}
function attachInner(b, p, why) {
  const s = b.resolve(p.session), t = b.resolve(p.to);
  if (s === t) throw apiError('bad_request', "카드를 자기 자신과 묶을 수 없습니다.");
  const side = String(p.side || 'right');
  if (!SIDES.includes(side)) throw apiError('bad_request', `side: ${side}`);
  if (p.at != null && !['leaf', 'dock'].includes(p.at)) throw apiError('bad_request', `at에는 leaf 또는 dock을 지정하세요: ${p.at}`);
  const ws = sameWs(b, [s.sessionId, t.sessionId]);
  if (ws === undefined) throw apiError('bad_request', "창 그룹은 하나의 프로젝트 안에서만 만들 수 있습니다. 서로 다른 프로젝트의 카드는 묶을 수 없습니다.");
  const sRect = nodeRect(b, s.sessionId);
  // 붙는 노드가 다른 덩어리에 있었으면 먼저 뗀다. 같은 덩어리 안에서 옮기면 바깥은 그대로 두고 나무 안에서만 옮긴다
  const old = dockOf(b, s.sessionId), td0 = dockOf(b, t.sessionId);
  if (old && (!td0 || old.dockId !== td0.dockId)) detach(b, old, s.sessionId, 'reattach');
  const td = dockOf(b, t.sessionId);
  const at = p.at || (td ? 'leaf' : 'dock');
  let tree, outer;
  // P80: 비율에 불이 든 덩어리(혼자인 대상은 그 노드의 비율 불)는 같은 단독 세션 크기를 지키고 세션 수에 맞게 바깥을 다시 낸다(넓이 × √n).
  // 덩어리 옆 새 칸은 그 줄의 칸 하나만큼 몫을 받는다(붙는 노드의 크기는 쓰지 않는다)
  const tNode = td ? null : nodeRect(b, t.sessionId);
  const single = td ? litSingle(b, td) : tNode && aspectOf(tNode, tNode.aspect) ? resolveSize(tNode, tNode.aspect, {}) : null;
  const aspect = td ? td.aspect : single ? tNode.aspect : null;
  const anchor = td ? dockOuter(b, td) : tNode;
  let size = sRect;
  if (single) { const base = td ? td.tree : t.sessionId, k = sideDir(side) === 'row' ? 'w' : 'h'; size = { [k]: anchor[k] / (!isLeaf(base) && base.dir === sideDir(side) ? base.kids.length : 1) }; }
  if (td) {
    const base = td.members.includes(s.sessionId) ? removeLeaf(td.tree, s.sessionId) : td.tree;
    ({ tree, outer } = insertWithOuter(base, anchor, { target: t.sessionId, side, id: s.sessionId, at, size }));
  } else {
    ({ tree, outer } = insertWithOuter(t.sessionId, tNode, { target: t.sessionId, side, id: s.sessionId, at, size }));
  }
  if (single) outer = fitOuter(tree, single, anchor, at === 'dock' ? side : null);
  const saved = saveDock(b, { dockId: td ? td.dockId : null, workspaceKey: ws, tree, origin: (td && td.origin) || p.origin || why }, why);
  applyLayout(b, saved.tree, outer);
  if (single && !td) b.store.setDockAspect(saved.dockId, aspect);
  if (single) reflowLines(b, t.sessionId, 'dock attach'); // P75: 커진 덩어리가 줄의 뒤 형제를 아래로
  settleRegions(b, 'dock attach');
  b.api.broadcast('board.changed', { why: 'dock' });
  return { dock: b.store.getDock(saved.dockId), at };
}

// 고른 노드들로 한 줄 덩어리를 만든다(atrium CLI, 시험). 순서는 주어진 대로, 자리는 첫 노드에서 시작하고 노드 크기를 줄 방향으로 지킨다
export function dockCreate(b, p) {
  const r = keepBoxes(b, () => createInner(b, p)); // P68
  settleRegions(b, 'dock create');
  return r;
}
function createInner(b, p) {
  const ids = (p.members || []).map((x) => b.resolve(x).sessionId);
  if (ids.length < 2 || new Set(ids).size !== ids.length) throw apiError('bad_request', "창 그룹에는 서로 다른 카드가 2개 이상 있어야 합니다.");
  const ws = sameWs(b, ids);
  if (ws === undefined) throw apiError('bad_request', "창 그룹은 하나의 프로젝트 안에서만 만들 수 있습니다.");
  const dir = p.dir === 'col' ? 'col' : 'row';
  for (const id of ids) { const d = dockOf(b, id); if (d) detach(b, d, id, 'recreate'); }
  const rects = ids.map((id) => nodeRect(b, id));
  const sizes = rects.map((r) => (dir === 'row' ? r.w : r.h));
  const outer = { x: rects[0].x, y: rects[0].y, w: dir === 'row' ? sizes.reduce((a, x) => a + x, 0) : rects[0].w, h: dir === 'row' ? rects[0].h : sizes.reduce((a, x) => a + x, 0) };
  const saved = saveDock(b, { dockId: null, workspaceKey: ws, tree: fromLine(dir, ids, sizes), origin: p.origin || 'user' }, 'create');
  applyLayout(b, saved.tree, outer);
  b.api.broadcast('board.changed', { why: 'dock' });
  return { dock: saved };
}

// 배치 틀(P17): 고른 노드를 틀(dock-tree.mjs PRESETS)로 한 번에 덩어리로 짠다. 고른 노드가 든 덩어리는 통째로 들어온다(그 자리에 잎 차례대로).
// 고른 것이 덩어리 하나와 꼭 같으면 그 덩어리 자리에서, 아니면 첫 노드 자리에서 시작한다. P80: 크기는 단독 세션 규칙(아래)
export function dockLayout(b, p) {
  const r = keepBoxes(b, () => layoutInner(b, p)); // P68
  settleRegions(b, 'dock preset');
  return r;
}
function layoutInner(b, p) {
  const preset = String(p.preset || '');
  if (!PRESETS[preset]) throw apiError('bad_request', `분할 레이아웃: ${Object.keys(PRESETS).join(', ')}`);
  const picked = [];
  const docks = [];
  for (const x of p.members || []) {
    const sid = b.resolve(x).sessionId;
    if (picked.includes(sid)) continue;
    const d = dockOf(b, sid);
    if (d) { if (!docks.some((y) => y.dockId === d.dockId)) docks.push(d); for (const m of d.members) if (!picked.includes(m) && b.sessions.has(m)) picked.push(m); }
    else picked.push(sid);
  }
  if (picked.length < 2) throw apiError('bad_request', "분할 레이아웃에는 카드가 2개 이상 있어야 합니다.");
  const ws = sameWs(b, picked);
  if (ws === undefined) throw apiError('bad_request', "창 그룹은 하나의 프로젝트 안에서만 만들 수 있습니다. 서로 다른 프로젝트의 카드는 함께 배치할 수 없습니다.");
  const one = docks.length === 1 && docks[0].members.length === picked.length ? docks[0] : null;
  const head = dockOf(b, picked[0]);
  const start = head ? dockOuter(b, head) : nodeRect(b, picked[0]);
  // P80: 틀 비율은 틀 그대로다. 크기는 단독 세션 하나(single)의 규칙으로 바깥만 정한다(넓이 × √n, 모양은 칸이 고른 모양에 가장 가깝게).
  // single: 들어오는 덩어리 하나에 비율 불이 있으면 그 크기, 첫 노드가 혼자이고 비율 불이 있으면 그 노드, 아니면 새 세션 크기(16:9 가로형 보통).
  // 비율이 꺼진 같은 덩어리(테두리로 바꾼 뒤)는 바깥을 지키고(P73), 시험의 cellW·cellH는 틀의 격자(P73)
  const before = one ? dockOuter(b, one) : null;
  const tree = presetTree(preset, picked);
  const hNode = head ? null : nodeRect(b, picked[0]);
  const given = p.cellW != null || p.cellH != null ? { w: Math.round(Number(p.cellW) || DOCK_CELL.w), h: Math.round(Number(p.cellH) || DOCK_CELL.h) } : null;
  const fromDock = docks.length === 1 ? litSingle(b, docks[0]) : null;
  const single = given || (one && !fromDock) ? null : fromDock || (hNode && aspectOf(hNode, hNode.aspect) ? resolveSize(hNode, hNode.aspect, {}) : { ...NEW_NODE, aspect: DEFAULT_ASPECT });
  const aspect = single ? single.aspect : null;
  let outer = single ? fitOuter(tree, single, start) : one ? before : { x: start.x, y: start.y, ...presetSize(preset, picked.length, given || DOCK_CELL) };
  // P50(#2): 새 크기의 덩어리가 다른 노드·메모·칸반을 덮지 않게, 첫 노드 자리에서 가장 가까운 빈자리로 둔다(U1)
  if (!one) outer = { ...outer, ...presetSpot(b, picked, outer) };
  for (const d of docks.slice(1)) { b.store.deleteDock(d.dockId); b.store.addEvent(null, 'dock_removed', { dockId: d.dockId, why: `preset ${preset}` }); }
  const saved = saveDock(b, { dockId: docks[0] ? docks[0].dockId : null, workspaceKey: ws, tree, origin: p.origin || 'user' }, `preset ${preset}`);
  const got = applyLayout(b, saved.tree, outer);
  // P73: 바깥 크기를 지킨 덩어리(비율 꺼짐)는 기록도 그대로 둔다. 시험의 cellW·cellH는 바깥 비율. P80: 단독 세션 규칙으로 짠 덩어리는 그 비율
  b.store.setDockAspect(saved.dockId, aspect || (one ? one.aspect : given ? matchAspect(got) : null));
  if (one && aspect && got && (got.w > before.w || got.h > before.h)) reflowLines(b, picked[0], 'dock preset'); // P75: 커진 덩어리가 줄의 뒤 형제를 아래로
  settleRegions(b, 'dock preset');
  b.api.broadcast('board.changed', { why: 'dock' });
  return { dock: b.store.getDock(saved.dockId), preset };
}

// P68: 워커 붙여 묶기. 리드(lead)의 하위 세션 가운데 리드와 같은 리포(워크스페이스)에 노드가 있는 것을 띄운 차례대로 세션 수에 맞는 배치 틀로 묶는다.
// 워크트리가 달라도 같은 리포면 한 덩어리가 되어 리포 영역에 놓인다. preset을 주면 그 틀
export function dockWorkers(b, p) {
  const lead = b.resolve(p.lead || p.session);
  const nodes = new Set(b.store.nodes().map((n) => n.session_id));
  const kids = [...b.sessions.values()]
    .filter((s) => s.parentSessionId === lead.sessionId && nodes.has(s.sessionId) && (s.workspaceKey || null) === (lead.workspaceKey || null))
    .sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0) || String(x.name).localeCompare(String(y.name)));
  if (kids.length < 2) throw keyed(apiError('bad_request', `같은 프로젝트에서 붙여 묶을 워커가 2개 이상 있어야 합니다 (@${lead.name}: ${kids.length}개)`), 'dockWorkersFew', { name: lead.name, n: kids.length });
  const preset = p.preset ? String(p.preset) : workersPreset(kids.length);
  const r = dockLayout(b, { members: kids.map((s) => s.sessionId), preset, origin: 'workers' });
  b.store.addEvent(lead.sessionId, 'workers_docked', { workers: kids.map((s) => s.name), preset, dockId: r.dock && r.dock.dockId });
  return { ...r, lead: lead.name, workers: kids.map((s) => s.name) };
}

// P50(#2): 배치 틀 바깥(outer)을 둘 자리. 고른 노드(picked)는 옮겨 가므로 피하지 않고, 그 노드가 든 영역(상자면 그 상자)도 피하지 않는다
// P68: 고른 노드가 같은 리포의 여러 영역(본 저장소 영역, 워크트리 상자)에 걸치면 덩어리는 리포 영역에 놓인다. 그때 고른 노드가 빠져 비는 상자(숨는다)도 피하지 않는다
function presetSpot(b, picked, outer) {
  const all = canvasItems(b);
  const areas = new Set(picked.map((sid) => areaOfNode(b, sid, all)));
  const area = areas.size > 1 ? wsOfArea(areaOfNode(b, picked[0], all)) : areaOfNode(b, picked[0], all);
  const mine = new Set(picked);
  const emptied = new Set([...areas].filter((k) => isBoxKey(k) && !all.some((i) => i.ws === k && i.kind !== 'wtbox' && !(i.kind === 'node' && mine.has(i.id)))));
  const items = all.filter((i) => !(i.kind === 'node' && mine.has(i.id)) && !(i.kind === 'wtbox' && (i.box === area || (areas.size > 1 && emptied.has(i.box)))));
  const own = items.filter((i) => i.ws === area);
  const regs = regions(b, all);
  const ownReg = regionRect(own) || regs.get(area) || null;
  const others = [...regs].filter(([k]) => k !== area && k !== wsOfArea(area) && !(areas.size > 1 && emptied.has(k))).map(([, r]) => r).filter((r) => !ownReg || !overlaps(ownReg, r, -1));
  return dockSpot({ rect: outer, items, own, others, prefer: picked.map((sid) => nodeRect(b, sid)) });
}

// 덩어리 바꾸기. tree: 나무 통째로(분할선을 끈 비율, 같은 구성 노드만), sizes: 옛 한 줄 덩어리처럼 뿌리 마디 자식마다 길이(가로줄은 너비, 세로줄은 높이),
// x·y: 덩어리째 옮기기(바깥 왼쪽 위), w·h: 바깥 크기(비율대로 다시 나누고 잎마다 최소 크기를 지킨다)
export function dockUpdate(b, p) {
  const d = b.store.getDock(p.dock);
  if (!d) throw apiError('not_found', `창 그룹을 찾을 수 없습니다: ${p.dock}`);
  let tree = d.tree, outer = dockOuter(b, d);
  if (p.tree != null) {
    const t = normalize(p.tree);
    const ls = leaves(t);
    if (ls.length !== d.members.length || ls.some((x) => !d.members.includes(x))) throw apiError('bad_request', 'tree: 이 창 그룹의 구성 카드를 모두 한 번씩(붙이기·떼기는 dock.attach, dock.remove)');
    tree = t;
  }
  if (Array.isArray(p.sizes)) {
    if (isLeaf(tree) || p.sizes.length !== tree.kids.length || p.sizes.some((x) => !(Number(x) >= 120))) throw apiError('bad_request', 'sizes: 뿌리 마디의 자식마다 120 이상');
    ({ tree, outer } = rootSizes(tree, outer, p.sizes));
  }
  if (p.x != null && p.y != null) outer = { ...outer, x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) };
  if (p.w != null || p.h != null) {
    const need = minSize(tree);
    outer = { ...outer, w: Math.max(need.w, Math.round(Number(p.w ?? outer.w))), h: Math.max(need.h, Math.round(Number(p.h ?? outer.h))) };
  }
  if (p.tree != null || Array.isArray(p.sizes)) b.store.updateDock(d.dockId, { ...d, tree });
  const out = applyLayout(b, tree, outer);
  // P73: 바깥 크기를 손으로 바꾸면(테두리·모서리 끌기) 고른 비율을 끈다(자유 비율). 그 뒤 비율 단추를 누르면 다시 그 비율로 맞춘다
  if ((p.w != null || p.h != null || Array.isArray(p.sizes)) && d.aspect) b.store.setDockAspect(d.dockId, null);
  b.store.addEvent(null, 'dock_saved', { dockId: d.dockId, tree: p.tree != null || p.sizes ? renameTree(b, tree) : undefined, outer: out, why: 'update' });
  if (p.w != null || p.h != null) { if (d.members[0]) reflowLines(b, d.members[0], 'dock resize'); settleRegions(b, 'dock resize'); } // P75: 줄의 뒤 형제를 아래로
  b.api.broadcast('board.changed', { why: 'dock' });
  return { dock: b.store.getDock(d.dockId), outer: out };
}

// 떼기: 덩어리에서 노드 하나를 뺀다(나무 정리). 뿌리 마디 바로 아래 칸이면 덩어리가 그만큼 줄고(왼쪽 위 자리는 그대로),
// 안쪽 칸이면 같은 마디의 이웃이 그 자리를 채운다. 하나만 남으면 덩어리가 풀린다
function detach(b, d, sid, why) {
  const outer = dockOuter(b, d);
  const single = litSingle(b, d); // P80: 비율에 불이 든 덩어리는 같은 단독 세션 크기로 바깥을 다시 낸다(넓이 × √n, 왼쪽 위 그대로)
  const r = removeWithOuter(d.tree, outer, sid);
  if (single && r.tree && !isLeaf(r.tree)) r.outer = fitOuter(r.tree, single, outer);
  const saved = saveDock(b, { ...d, tree: r.tree }, why);
  if (saved) applyLayout(b, saved.tree, r.outer);
  return saved;
}
export function dockRemove(b, p) {
  const r = keepBoxes(b, () => removeInner(b, p)); // P68: 섞인 덩어리에서 뗀 워크트리 세션은 자기 상자로 돌아간다
  settleRegions(b, 'dock remove');
  return r;
}
function removeInner(b, p) {
  if (p.dock) {
    const d = b.store.getDock(p.dock);
    if (!d) throw apiError('not_found', `창 그룹을 찾을 수 없습니다: ${p.dock}`);
    b.store.deleteDock(d.dockId);
    b.store.addEvent(null, 'dock_removed', { dockId: d.dockId, why: 'user' });
    b.api.broadcast('board.changed', { why: 'dock' });
    return { removed: true };
  }
  const s = b.resolve(p.session);
  const d = dockOf(b, s.sessionId);
  if (!d) return { removed: false };
  const r = nodeRect(b, s.sessionId);
  detach(b, d, s.sessionId, 'user');
  // 뗀 노드는 덩어리 옆 빈자리로(창이 끌어낸 자리를 주면 그 자리)
  if (p.x != null && p.y != null) b.store.setNode({ ...r, x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) });
  else {
    const items = canvasItems(b).filter((i) => i.id !== s.sessionId);
    const rest = d.members.filter((x) => x !== s.sessionId).map((x) => nodeRect(b, x));
    const at = slotInRegion({ wsKey: areaOfNode(b, s.sessionId), size: { w: r.w, h: r.h }, items, regions: regions(b, items), near: bbox(rest) }); // P27: 그 노드가 든 영역
    b.store.setNode({ ...r, x: at.x, y: at.y });
  }
  settleRegions(b, 'dock remove');
  b.api.broadcast('board.changed', { why: 'dock' });
  return { removed: true };
}

// 세션이 닫히면(끄기, 보관, 삭제) 덩어리에서 빠진다
export function onSessionClosed(b, s) {
  const d = dockOf(b, s.sessionId);
  if (!d) return;
  keepBoxes(b, () => detach(b, d, s.sessionId, 'session closed'), { closed: s }); // P68: 남은 워크트리 세션은 자기 상자로
  settleRegions(b, 'session closed');
  b.api.broadcast('board.changed', { why: 'dock' });
}

// ---------- P75: 하위 세션 줄(K4, tree-line.mjs) ----------
// 한 워크스페이스(리포)의 줄 블록: 워크트리 상자(안의 노드째), 덩어리, 노드 하나. 상자 안의 노드는 상자 블록에 든다(상자 안의 덩어리도)
export function lineBlocks(b, wsKey, items = canvasItems(b)) {
  const regs = regions(b, items);
  const docks = b.store.docks();
  const out = new Map();
  for (const n of items) {
    if (n.kind !== 'node' || (n.wsKey || null) !== (wsKey || null)) continue;
    const d = isBoxKey(n.ws) ? null : docks.find((x) => x.members.includes(n.id));
    const id = isBoxKey(n.ws) ? `w:${n.ws}` : d ? `d:${d.dockId}` : n.id;
    // 아직 상자가 없는 --worktree 워커는 상자가 들어설 테두리까지(자리를 비워 둔 만큼) 차지한다
    const info = !isBoxKey(n.ws) && !d && b.branch && b.branch.info ? b.branch.info.get(n.id) : null;
    const rect = isBoxKey(n.ws) ? regs.get(n.ws) : d ? dockOuter(b, d) : info && info.worktree ? boxFrame(n) : n;
    if (!rect) continue;
    if (!out.has(id)) out.set(id, { id, kind: isBoxKey(n.ws) ? 'wtbox' : d ? 'dock' : 'node', box: isBoxKey(n.ws) ? n.ws : null, x: rect.x, y: rect.y, w: rect.w, h: rect.h, members: [] });
    out.get(id).members.push(n.id);
  }
  return [...out.values()];
}
const sessionRow = (b) => (sid) => { const s = b.sessions.get(sid); return s ? { parentSessionId: s.parentSessionId || null, createdAt: s.createdAt || 0 } : null; };
export const lineTree = (b, wsKey, items = canvasItems(b)) => blockTree(lineBlocks(b, wsKey, items), sessionRow(b));
// 블록 하나를 아래로 옮긴다(상자는 상자째)
function lowerBlock(b, x, dy) {
  if (x.kind === 'wtbox') { shiftWorkspace(b, x.box, 0, dy); return; }
  for (const m of x.members) { const n = nodeRect(b, m); if (n) b.store.setNode({ ...n, y: n.y + dy }); }
}
// 줄 밀기: sid가 든 블록에서 위로 부모마다, 그 줄의 형제 띠가 겹치면 뒤의 형제를 그 나무째 아래로 민다(당기지 않는다).
// 새 하위 세션을 놓은 뒤(부모 나무가 길어졌다)와 노드·덩어리가 커진 뒤에 부른다. 옮긴 것이 있으면 [{ block, dy }]
export function reflowLines(b, sid, cause = 'unknown') {
  const s = b.sessions.get(sid);
  if (!s) return [];
  const ws = s.workspaceKey || null;
  let tree = lineTree(b, ws);
  let cur = tree.blockOf.get(sid);
  const moved = [];
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const p = tree.parent.get(cur);
    if (!p) break;
    const shifts = pushLine(lineKids(tree, p).map((k) => ({ id: k, rect: bandOf(tree, k) })));
    if (shifts.size) {
      const done = new Set();
      for (const [k, dy] of shifts) for (const x of subtreeIds(tree, k)) { if (done.has(x)) continue; done.add(x); lowerBlock(b, tree.byId.get(x), dy); moved.push({ block: x.startsWith('w:') || x.startsWith('d:') || !b.nameOf ? x : b.nameOf(x), dy }); }
      tree = lineTree(b, ws);
    }
    cur = p;
  }
  if (moved.length) { b.store.addEvent(sid, 'line_pushed', { cause, moved }); if (b.log) b.log(`line pushed (${cause}) ${JSON.stringify(moved)}`); }
  return moved;
}

// P17: 옛 한 줄 덩어리 행(tree 없음)을 뜰 때 한 마디짜리 나무로 바꾼다. 비율은 지금 노드 크기(가로줄은 너비, 세로줄은 높이)라서 모양이 그대로다
export function migrateDocks(b) {
  const out = [];
  for (const d of b.store.docks()) {
    if (!d.legacy) continue;
    const rects = d.members.map((sid) => anyRect(b, sid));
    const sizes = rects.every(Boolean) ? rects.map((r) => (d.dir === 'col' ? r.h : r.w)) : null;
    const tree = fromLine(d.dir, d.members, sizes);
    b.store.updateDock(d.dockId, { ...d, tree });
    out.push({ dockId: d.dockId, dir: d.dir, members: d.members.length, sizes });
  }
  if (out.length) { b.store.addEvent(null, 'docks_migrated', { docks: out }); if (b.log) b.log(`docks migrated to trees ${JSON.stringify(out)}`); }
  return out;
}

// herdr에서 같은 탭에 나뉜 패널(에이전트가 pane split으로 나눈 패널)은 처음부터 나눈 방향대로 붙인다(H5). herdr 레이아웃은 바꾸지 않는다
export async function autoDockSplit(b, s, parent) {
  if (!parent || parent === s || !s.paneId || !parent.paneId || (parent.workspaceKey || null) !== (s.workspaceKey || null)) return null;
  if (parent.herdrWorkspaceId !== s.herdrWorkspaceId) return null;
  let layout = null;
  try { layout = await b.adapter.paneLayout(s.paneId); } catch (e) { b.log(`pane.layout failed ${s.paneId}: ${e.code || e.message}`); return null; }
  const rect = (id) => { const p = layout && (layout.panes || []).find((x) => x.pane_id === id); return p ? p.rect : null; };
  const side = splitSide(rect(parent.paneId), rect(s.paneId));
  if (!side) return null; // 같은 탭이 아니다
  try {
    const r = dockAttach(b, { session: s.sessionId, to: parent.sessionId, side, origin: 'herdr' }, 'herdr split');
    b.store.addEvent(s.sessionId, 'auto_docked', { parent: parent.name, side, tabId: layout.tab_id });
    return r.dock;
  } catch (e) { b.store.addEvent(s.sessionId, 'auto_dock_skipped', { parent: parent.name, side, why: e.message }); return null; }
}

// ---------- 크기 단계와 정리(H7) ----------
// P73: 크기 = 방향(dir: wide·tall) × 종횡비(aspect: 16:9·4:3, null이면 자유 비율) × 단계(level: large·normal·small)(canvas.mjs resolveSize).
// size(크기 열쇠, 예: wide43-normal)를 주면 셋을 한 번에, 옛 열쇠 large·normal·small은 단계만. dir·aspect·level을 따로 주면 그것만 바꾸고 나머지는 지금 것을 지킨다.
// 덩어리 안 노드는 덩어리에 쓴다(scope dock이든 아니든). P80: 틀 비율은 그대로, 바깥만 단독 세션 규칙으로(넓이 × √n, 칸 모양이 고른 모양에 가깝게).
// 비율은 덩어리 기록(aspect)에, 혼자인 노드는 노드 기록에 남긴다. 왼쪽 위는 그대로
export function sizeRequest(p) {
  const req = {};
  if (p.size != null) {
    const st = parseStep(p.size);
    if (!st) throw apiError('bad_request', `크기: ${Object.keys(SIZE_STEPS).join(', ')}`);
    Object.assign(req, st);
  }
  if (p.dir != null) { if (!SIZE_DIRS.includes(p.dir)) throw apiError('bad_request', `dir: ${SIZE_DIRS.join(', ')}`); req.dir = p.dir; }
  if (p.aspect !== undefined) {
    const a = p.aspect === 'free' || p.aspect === null ? null : String(p.aspect);
    if (a && !ASPECTS[a]) throw apiError('bad_request', `aspect: ${Object.keys(ASPECTS).join(', ')}, free`);
    req.aspect = a;
  }
  if (p.level != null) { if (!SIZE_LEVELS.includes(p.level)) throw apiError('bad_request', `level: ${SIZE_LEVELS.join(', ')}`); req.level = p.level; }
  if (!Object.keys(req).length) throw apiError('bad_request', 'size, dir, aspect, level 가운데 하나');
  return req;
}
export function setSize(b, p) {
  const s = b.resolve(p.session);
  const req = sizeRequest(p);
  const r = nodeRect(b, s.sessionId);
  const d = dockOf(b, s.sessionId);
  let out;
  if (d) {
    // P80: 틀 비율은 그대로 두고 바깥만 바꾼다. 덩어리를 단독 세션 하나(dockVirtual)로 보아 단독 세션처럼 크기를 정하고(out) 바깥으로 되돌린다(dockFit, 왼쪽 위 그대로)
    const outer = dockOuter(b, d);
    out = resolveSize(dockVirtual(d.tree, outer), d.aspect, req);
    const got = applyLayout(b, d.tree, fitOuter(d.tree, out, outer));
    b.store.setDockAspect(d.dockId, out.aspect && aspectOf(dockVirtual(d.tree, got), out.aspect) ? out.aspect : null);
    b.store.addEvent(null, 'dock_saved', { dockId: d.dockId, outer: got, single: { w: out.w, h: out.h }, aspect: out.aspect, why: 'size' });
  } else {
    out = resolveSize(r, r.aspect, req);
    b.store.setNode({ ...r, w: out.w, h: out.h });
    b.store.setNodeAspect(s.sessionId, out.aspect, out.key);
  }
  b.store.addEvent(s.sessionId, 'node_size', { size: out.key || p.size || null, dir: out.dir, aspect: out.aspect, level: out.level, dock: d ? d.dockId : undefined });
  reflowLines(b, s.sessionId, 'size'); // P75: 커졌으면 줄의 뒤 형제를 아래로
  settleRegions(b, 'size');
  b.api.broadcast('board.changed', { why: 'size' });
  return { session: s.name, size: out.key, dir: out.dir, aspect: out.aspect, level: out.level, w: out.w, h: out.h, dock: d ? d.dockId : null, ...(d ? { outer: { w: dockOuter(b, d).w, h: dockOuter(b, d).h } } : {}) }; // P80: 덩어리는 w·h가 같은 규칙의 단독 세션, outer가 바깥
}

// 정리할 블록: 덩어리, 나머지 노드 하나씩, 그 워크스페이스의 메모·칸반(P6c: 크기 그대로, 연결 없는 줄에 둔다. 빼면 정리한 노드가 그 위에 놓인다)
// P35: 리포 영역 안의 워크트리 상자도 한 블록이다(크기 그대로, 연결 없는 줄). 상자 안의 노드는 상자째 옮긴다(상자 안은 정리하지 않는다)
function blocksOf(b, wsKey) {
  // P27: 정리는 본 저장소 영역 안의 것만(워크트리 영역의 노드는 그 영역에 둔다)
  const all = canvasItems(b);
  const main = new Set(all.filter((i) => i.kind === 'node' && i.ws === wsKey).map((i) => i.id));
  const nodes = b.store.nodes().filter((n) => b.sessions.has(n.session_id) && (n.workspace_key || null) === wsKey && main.has(n.session_id));
  const byId = new Map(nodes.map((n) => [n.session_id, n]));
  const used = new Set();
  const out = [];
  for (const d of b.store.docks().filter((d) => (d.workspaceKey || null) === wsKey)) {
    const ms = d.members.filter((id) => byId.has(id) && !used.has(id));
    if (ms.length !== d.members.length) continue;
    ms.forEach((id) => used.add(id));
    const bb = bbox(ms.map((id) => byId.get(id)));
    out.push({ id: `d:${d.dockId}`, kind: 'dock', dockId: d.dockId, ...bb, members: ms, resizable: false });
  }
  // P78: 아직 상자가 없는 --worktree 워커는 상자 틀만큼 비워 둔다(나중에 상자가 생겨도 줄의 뒤 형제가 밀리지 않게)
  const wantsBox = (sid) => { const i = b.branch && b.branch.info ? b.branch.info.get(sid) : null; return !!(i && i.worktree); };
  for (const n of nodes) if (!used.has(n.session_id)) out.push({ id: n.session_id, kind: 'node', x: n.x, y: n.y, w: n.w, h: n.h, aspect: n.aspect || null, members: [n.session_id], resizable: true, ...(wantsBox(n.session_id) ? { pad: BOX_PAD } : {}) });
  for (const m of b.store.memos().filter((m) => (m.workspaceKey || null) === wsKey)) out.push({ id: `m:${m.memoId}`, kind: 'memo', memoId: m.memoId, x: m.x, y: m.y, w: m.w, h: m.h, members: [], resizable: false });
  for (const k of b.store.kanbans().filter((k) => (k.workspaceKey || null) === wsKey)) out.push({ id: `k:${k.kanbanId}`, kind: 'kanban', kanbanId: k.kanbanId, x: k.x, y: k.y, w: k.w, h: k.h, members: [], resizable: false });
  // P75: 상자 블록의 구성은 상자 안의 세션이다. 그래야 부모 → 워커 연결이 상자에 닿아 상자가 부모 오른쪽 줄에 선다(전에는 연결 없는 줄로 갔다)
  for (const x of all.filter((i) => i.kind === 'wtbox' && i.ws === wsKey).sort((p, q) => p.y - q.y || p.x - q.x)) out.push({ id: `w:${x.box}`, kind: 'wtbox', box: x.box, x: x.x, y: x.y, w: x.w, h: x.h, members: all.filter((i) => i.kind === 'node' && i.ws === x.box && b.sessions.has(i.id)).map((i) => i.id), resizable: false });
  return out;
}
// 메모·칸반 자리를 바꾸고 창에 알린다(정리, 되돌리기)
function moveItem(b, kind, id, x, y) {
  if (kind === 'memo') { if (!b.store.getMemo(id)) return; b.store.updateMemo(id, { x: Math.round(x), y: Math.round(y) }); b.api.broadcast('memo.updated', b.store.getMemo(id)); return; }
  if (!b.store.getKanban(id)) return;
  b.store.updateKanban(id, { x: Math.round(x), y: Math.round(y) });
  if (b.features) b.features.kanbans.emit(b.store.getKanban(id));
}

// 한 워크스페이스(본 저장소 영역) 안의 정리 계획. avoid: 정리한 영역이 다른 영역과 겹치면 영역째 빈자리로 옮긴다(워크스페이스 하나 정리)
function planWorkspace(b, key, { avoid = true } = {}) {
  const blocks = blocksOf(b, key);
  if (!blocks.length) return { blocks, out: [], edges: [], moved: null };
  const ids = new Set(blocks.flatMap((x) => x.members));
  const edges = b.store.links().filter((l) => ids.has(l.from) && ids.has(l.to) && (l.role || l.observed || l.spawned)).map((l) => [l.from, l.to]);
  // P75: 하위 세션의 부모(띄운 쪽)도 연결로 본다(역할 선을 끊어도 줄은 부모 오른쪽). 부모 연결을 앞에 두어 나무 부모가 된다
  const born = (m) => (b.sessions.get(m) || {}).createdAt || 0;
  const parents = [...ids].map((m) => [(b.sessions.get(m) || {}).parentSessionId, m]).filter(([p]) => p && ids.has(p)).sort((x, y) => born(x[1]) - born(y[1]));
  edges.unshift(...parents.filter(([p, m]) => !edges.some(([f, t]) => f === p && t === m)));
  const start = bbox(blocks);
  // P73: 정리의 크게·보통·작게는 노드의 방향과 고른 비율을 지킨다(비율이 없으면 16:9)
  const stepOf = (x, level) => { const r = resolveSize(x, x.aspect, { level, aspect: aspectOf(x, x.aspect) || DEFAULT_ASPECT }); return { w: r.w, h: r.h, step: r.key }; };
  // P75: 형제는 띄운 순서(블록 안에서 가장 먼저 띄운 세션의 때)로 위에서 아래로
  const rank = new Map(blocks.map((x) => [x.id, x.members.length ? Math.min(...x.members.map(born)) : Infinity]));
  const plan = arrangeTree(blocks, edges, { origin: { x: start.x, y: start.y }, stepOf, rank });
  let sx = 0, sy = 0;
  if (avoid) {
    // 정리한 영역이 다른 영역과 겹치면(맞닿는 것은 괜찮다) 영역째로 빈자리로 옮긴다
    const others = new Map([...regions(b)].filter(([k]) => wsOfArea(k) !== key)); // P35: 자기 리포 영역과 그 안의 상자는 빼고
    const newRegion = regionRect(blocks.map((x) => plan.get(x.id)));
    if (newRegion && [...others.values()].some((r) => overlaps(newRegion, r, -1))) {
      const at = newRegionSlot(others, newRegion);
      sx = at.x - newRegion.x; sy = at.y - newRegion.y;
    }
  }
  const out = blocks.map((x) => { const q = plan.get(x.id); return { id: x.id, kind: x.kind, names: x.members.map((m) => b.nameOf(m)), from: { x: x.x, y: x.y, w: x.w, h: x.h }, to: { ...q, x: q.x + sx, y: q.y + sy } }; });
  return { blocks, out, edges, moved: sx || sy ? { dx: sx, dy: sy } : null };
}
// 계획을 판에 쓴다(노드, 덩어리, 메모·칸반)
function applyWorkspacePlan(b, { blocks, out }) {
  const ids = new Set(blocks.flatMap((x) => x.members));
  const byId = new Map(b.store.nodes().filter((n) => ids.has(n.session_id)).map((n) => [n.session_id, n]));
  for (const x of blocks) {
    const q = out.find((o) => o.id === x.id).to;
    const dx = q.x - x.x, dy = q.y - x.y;
    if (x.kind === 'memo' || x.kind === 'kanban') { moveItem(b, x.kind, x.memoId || x.kanbanId, q.x, q.y); continue; }
    if (x.kind === 'wtbox') { if (dx || dy) shiftWorkspace(b, x.box, Math.round(dx), Math.round(dy)); continue; } // P35: 상자째(안의 노드, 대화 노드, 자리)
    if (x.kind === 'node') { const n = byId.get(x.id); b.store.setNode({ ...n, x: Math.round(q.x), y: Math.round(q.y), w: q.w, h: q.h, size: q.size || n.size || null }); if (q.size) b.store.setNodeAspect(x.id, parseStep(q.size).aspect, q.size); continue; }
    for (const m of x.members) { const n = byId.get(m); b.store.setNode({ ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) }); }
  }
}

// 정리(H7). workspace: 그 워크스페이스 영역 안만. all: 판 전체(P31: 모든 워크스페이스 안을 정리한 뒤 영역 묶음도 다시 놓는다, arrangeBoard)
export function arrange(b, p) {
  if (p.all) return arrangeBoard(b, p);
  const w = b.store.getWorkspace(p.workspace) || null;
  if (!w) throw keyed(apiError('not_found', `보드에서 프로젝트를 찾을 수 없습니다: ${p.workspace}`), 'wsNotFound', { ref: p.workspace });
  const key = w.key;
  const undoKey = `arrangeUndo:${key}`;
  if (p.undo) {
    const u = b.store.getMeta(undoKey);
    if (!u) throw keyed(apiError('not_found', "되돌릴 자동 정렬 내역이 없습니다."), 'noArrangeUndo');
    for (const n of u.nodes) if (b.sessions.has(n.session_id)) { b.store.setNode({ ...n, size: n.size ?? '' }); b.store.setNodeAspect(n.session_id, n.aspect ?? null); } // 크기 단계도 정리 전 값으로(없었으면 지운다). P73: 고른 비율도
    for (const it of u.items || []) moveItem(b, it.kind, it.id, it.x, it.y);
    // P35: 상자는 정리 전 자리로 상자째 되돌린다(그 사이 안의 노드가 바뀌어도 상대 자리는 지킨다)
    if (u.boxes && u.boxes.length) {
      const now = new Map(canvasItems(b).filter((i) => i.kind === 'wtbox').map((i) => [i.box, i]));
      for (const x of u.boxes) { const c = now.get(x.box); if (c && (c.x !== x.x || c.y !== x.y)) shiftWorkspace(b, x.box, Math.round(x.x - c.x), Math.round(x.y - c.y)); }
    }
    b.store.setMeta(undoKey, null);
    b.store.addEvent(null, 'arrange_undone', { workspace: key });
    b.api.broadcast('board.changed', { why: 'arrange undo' });
    return { undone: true };
  }
  const pl = planWorkspace(b, key);
  if (!pl.blocks.length) return { plan: [], applied: false };
  if (!p.apply) return { plan: pl.out, applied: false, edges: pl.edges.length };
  const ids = new Set(pl.blocks.filter((x) => x.kind !== 'wtbox').flatMap((x) => x.members)); // P75: 상자 안 노드는 상자째 되돌린다(아래 boxes)
  const nodes = b.store.nodes().filter((n) => ids.has(n.session_id));
  const itemsBefore = pl.blocks.filter((x) => x.kind === 'memo' || x.kind === 'kanban').map((x) => ({ kind: x.kind, id: x.memoId || x.kanbanId, x: x.x, y: x.y }));
  const boxesBefore = pl.blocks.filter((x) => x.kind === 'wtbox').map((x) => ({ box: x.box, x: x.x, y: x.y }));
  b.store.setMeta(undoKey, { at: Date.now(), nodes, items: itemsBefore, boxes: boxesBefore });
  b.store.setMeta(BOARD_UNDO, null); // 판 전체 정리의 되돌리기는 이 정리 뒤로는 맞지 않는다
  applyWorkspacePlan(b, pl);
  b.store.addEvent(null, 'arranged', { workspace: key, blocks: pl.blocks.length, edges: pl.edges.length, moved: pl.moved });
  b.api.broadcast('board.changed', { why: 'arrange' });
  return { plan: pl.out, applied: true, edges: pl.edges.length, undo: true };
}

// P31: 판 전체 정리. 1) 워크스페이스마다 안을 정리하고(영역 피하기 없이, P35: 워크트리 상자는 리포 영역 안의 한 블록) 2) 그 결과의 영역들(리포 영역은 상자째)을
// 겹치지 않게 줄 맞춰 다시 놓는다(region-layout.mjs layoutRegions). 소속 없는 메모·칸반도 맨 뒤에 놓는다.
// 되돌리기는 판 전체(노드, 메모·칸반, 대화 노드, 영역 자리, 워크트리 영역 자리)를 정리 전으로. 영역을 옮기는 것은 사람이 이것을 누를 때뿐이다(BRIEF 4절)
const BOARD_UNDO = 'arrangeUndo:*';
function arrangeBoard(b, p) {
  if (p.undo) {
    const u = b.store.getMeta(BOARD_UNDO);
    if (!u) throw keyed(apiError('not_found', "되돌릴 자동 정렬 내역이 없습니다."), 'noArrangeUndo');
    for (const n of u.nodes) if (b.sessions.has(n.session_id)) { b.store.setNode({ ...n, size: n.size ?? '' }); b.store.setNodeAspect(n.session_id, n.aspect ?? null); }
    for (const it of u.items || []) moveItem(b, it.kind, it.id, it.x, it.y);
    const ws = new Set(b.store.workspaces().map((w) => w.key));
    for (const a of u.anchors || []) if (ws.has(a.key)) b.store.setWorkspaceAnchor(a.key, a.x, a.y);
    const rows = new Map(areaRows(b).map((a) => [`${a.wsKey}|${a.wt}`, a]));
    for (const a of u.areas || []) { const now = rows.get(`${a.wsKey}|${a.wt}`); if (now) b.store.putWorktreeArea({ ...now, x: a.x, y: a.y }); }
    if (b.store.convoNodes && u.convos && u.convos.length) {
      const cs = new Map(b.store.convoNodes().map((n) => [n.convId, n]));
      for (const c of u.convos) { const now = cs.get(c.convId); if (now) b.store.putConvoNode({ ...now, x: c.x, y: c.y }); }
      if (b.recall) b.recall.layoutCanvas().catch(() => {});
    }
    b.store.setMeta(BOARD_UNDO, null);
    b.store.addEvent(null, 'arrange_undone', { workspace: '*' });
    b.api.broadcast('board.changed', { why: 'arrange undo' });
    return { undone: true, all: true };
  }
  const wss = b.store.workspaces();
  const plans = wss.map((w) => ({ key: w.key, ...planWorkspace(b, w.key, { avoid: false }) })).filter((x) => x.blocks.length);
  // 정리한 뒤의 판을 흉내 내어 영역을 계산한다(미리 보기도 같은 값). P35: 상자 블록은 안의 것과 자리를 함께 옮겨 본다
  const items = canvasItems(b).filter((i) => i.kind !== 'wtbox').map((i) => ({ ...i }));
  const anchors = areaAnchors(b).map((a) => ({ ...a }));
  const find = (kind, id) => items.find((i) => i.kind === kind && i.id === id);
  for (const pl of plans) for (const x of pl.blocks) {
    const q = pl.out.find((o) => o.id === x.id).to;
    if (x.kind === 'node') Object.assign(find('node', x.id) || {}, { x: q.x, y: q.y, w: q.w, h: q.h });
    else if (x.kind === 'memo' || x.kind === 'kanban') Object.assign(find(x.kind, x.memoId || x.kanbanId) || {}, { x: q.x, y: q.y });
    else if (x.kind === 'wtbox') {
      const dx = q.x - x.x, dy = q.y - x.y;
      for (const it of items) if (it.ws === x.box) { it.x += dx; it.y += dy; }
      for (const a of anchors) if (a.key === x.box) { a.x += dx; a.y += dy; }
    } else for (const m of x.members) { const it = find('node', m); if (it) { it.x += q.x - x.x; it.y += q.y - x.y; } }
  }
  const regs = nestedRegions(anchors, items);
  // 맨 위 영역(리포 영역은 상자를 감싼다, 폴더)과 소속 없는 메모·칸반만 다시 놓는다. 상자는 리포 영역과 함께 간다
  const gidx = groupIndex(readGroups(b)); // P44: 같은 가상 그룹의 영역은 한 덩어리로 모아 놓는다(그룹 안 순서는 사람이 정한 것)
  const entries = [...regs].filter(([k]) => !isBoxKey(k)).map(([k, r]) => ({ key: k, ws: k, wt: '', rect: r, empty: !items.some((i) => i.wsKey === k), ...(gidx.has(k) ? { group: gidx.get(k).id, order: gidx.get(k).index, loose: !!gidx.get(k).loose } : {}) }));
  for (const i of items) if (!i.ws && (i.kind === 'memo' || i.kind === 'kanban')) entries.push({ key: `${i.kind}:${i.id}`, ws: null, wt: '', rect: { x: i.x, y: i.y, w: i.w, h: i.h }, item: i });
  const links = boardLinkWeights(b, items, new Set(entries.map((e) => e.key))); // P99: 다른 영역끼리의 연결은 가까이 놓는다
  const lay = layoutRegions(entries, { aspect: arrangeAspect(p.aspect), links }); // P91: 결과 전체를 창이 보낸 캔버스 비율(기본 16:9)에 맞춘다
  const regionPlan = entries.map((e) => ({ key: e.key, from: e.rect, to: lay.rects.get(e.key) }));
  const edges = plans.reduce((s, pl) => s + pl.edges.length, 0);
  if (!p.apply) return { all: true, plan: plans.flatMap((pl) => pl.out), regions: regionPlan, clusters: lay.clusters, aspect: lay.aspect, link: lay.link, applied: false, edges };
  // 되돌리기 자료: 판 전체
  b.store.setMeta(BOARD_UNDO, {
    at: Date.now(),
    nodes: b.store.nodes().filter((n) => b.sessions.has(n.session_id)),
    items: [...b.store.memos().map((m) => ({ kind: 'memo', id: m.memoId, x: m.x, y: m.y })), ...b.store.kanbans().map((k) => ({ kind: 'kanban', id: k.kanbanId, x: k.x, y: k.y }))],
    anchors: wss.map((w) => ({ key: w.key, x: w.x ?? null, y: w.y ?? null })),
    areas: areaRows(b).map((a) => ({ wsKey: a.wsKey, wt: a.wt, x: a.x, y: a.y })),
    convos: b.store.convoNodes ? b.store.convoNodes().map((n) => ({ convId: n.convId, x: n.x, y: n.y })) : [],
  });
  for (const w of wss) b.store.setMeta(`arrangeUndo:${w.key}`, null); // 워크스페이스 하나의 되돌리기는 이 정리 뒤로는 맞지 않는다
  for (const pl of plans) applyWorkspacePlan(b, pl);
  const fresh = canvasItems(b);
  const moved = [];
  for (const e of entries) {
    const s = lay.shifts.get(e.key);
    if (!s) continue;
    if (e.item) { moveItem(b, e.item.kind, e.item.id, e.item.x + s.dx, e.item.y + s.dy); moved.push({ key: e.key, ...s }); continue; }
    moved.push({ key: e.key, ...s, items: shiftWorkspace(b, e.key, s.dx, s.dy, fresh) });
  }
  settleRegions(b, 'arrange'); // 안전망: 계산이 맞으면 옮길 것이 없다
  b.store.addEvent(null, 'arranged', { workspace: '*', workspaces: plans.length, regions: entries.length, edges, link: lay.link, moved });
  b.api.broadcast('board.changed', { why: 'arrange' });
  return { all: true, plan: plans.flatMap((pl) => pl.out), regions: regionPlan, clusters: lay.clusters, aspect: lay.aspect, link: lay.link, applied: true, edges, undo: true };
}
// P99: 판의 연결(역할 선, 띄움 선, 일 시키기)과 부모 → 하위 세션 관계를 맨 위 영역 쌍의 무게로(region-layout.mjs linkWeights).
// items: 정리한 뒤를 흉내 낸 판의 것(노드의 ws는 영역 키, 상자 안 노드는 그 리포 영역으로 센다), tops: 다시 놓을 맨 위 영역 키
export function boardLinkWeights(b, items, tops) {
  const area = new Map();
  for (const i of items) if (i.kind === 'node' && i.ws && b.sessions.has(i.id)) { const k = isBoxKey(i.ws) ? wsOfArea(i.ws) : i.ws; if (tops.has(k)) area.set(i.id, k); }
  const parents = [...b.sessions.values()].filter((s) => s.parentSessionId).map((s) => [s.parentSessionId, s.sessionId]);
  return linkWeights({ links: b.store.links(), parents, areaOf: (sid) => area.get(sid) || null, now: Date.now() });
}
// P91: 판 전체 정리가 맞출 화면 비율(너비 / 높이). 창·휴대폰은 캔버스 크기로 보낸다. 없거나 터무니없으면 16:9
export function arrangeAspect(v) {
  const a = Number(v);
  return Number.isFinite(a) && a >= 0.3 && a <= 6 ? a : 16 / 9;
}

// P91: 묶음(가상 그룹) 이름표를 끌면 구성 영역(안의 노드, 메모·칸반, 대화 노드, 워크트리 상자, 영역 자리)이 함께 움직인다.
// 옮긴 구성 영역이 구성 아닌 영역과 겹치면 거부(overlap, force면 옮긴다)
export function groupShift(b, p) {
  const g = readGroups(b).groups.find((x) => x.id === String(p.group || ''));
  if (!g) throw keyed(apiError('not_found', `그룹을 찾을 수 없습니다: ${p.group}`), 'groupNotFound', { ref: p.group });
  const dx = Math.round(Number(p.dx) || 0), dy = Math.round(Number(p.dy) || 0);
  if (!dx && !dy) return { moved: 0 };
  const items = canvasItems(b);
  const before = new Map([...regions(b, items)].filter(([k]) => !isBoxKey(k)));
  const keys = g.members.filter((k) => before.has(k));
  const mine = new Set(keys);
  const hit = keys.map((k) => { const r = before.get(k); return { ...r, x: r.x + dx, y: r.y + dy }; }).map((after) => [...before].find(([k, r]) => !mine.has(k) && overlaps(after, r, -1))).find(Boolean);
  if (hit && !p.force) throw keyed(apiError('overlap', `다른 프로젝트 영역과 겹칩니다 (${hit[0]})`), 'regionOverlap', { ws: hit[0] });
  let n = 0;
  for (const k of keys) n += shiftWorkspace(b, k, dx, dy, items);
  b.store.addEvent(null, 'group_moved', { group: g.id, dx, dy, workspaces: keys.length, items: n });
  b.api.broadcast('board.changed', { why: 'group.shift' });
  return { moved: n, workspaces: keys.length, dx, dy };
}

// ---------- 검색(H2) ----------
export function searchQuery(b, p) {
  const q = String(p.q || '').trim();
  if (!q) return { q, results: [] };
  const sums = [...b.sessions.values()].map((s) => b.summary(s));
  const workspaces = b.workspaceList();
  const texts = [];
  const fieldOfHook = (d) => (d && d.ev === 'UserPromptSubmit' ? ['history', d.prompt] : d && d.ev === 'Stop' ? ['reply', d.lastAnswer] : [null, null]);
  for (const r of b.store.searchText(q, 200)) {
    if (!r.session_id || !b.sessions.has(r.session_id)) continue;
    if (r.src === 'delivery') texts.push({ sessionId: r.session_id, field: 'history', text: r.text, t: r.t });
    else if (r.src === 'link') texts.push({ sessionId: r.session_id, field: 'linked', text: r.text, t: r.t });
    else if (r.src === 'hook') { let d = null; try { d = JSON.parse(r.text); } catch {} const [f, t] = fieldOfHook(d); if (f && t) texts.push({ sessionId: r.session_id, field: f, text: t, t: r.t }); }
  }
  // 출력(P6c): hook이 없는 세션의 턴 끝 화면 답(answer_screen). hook이 있는 세션의 답은 위의 "지난 답"(Stop)이다
  for (const r of b.store.searchOutputs(q, 100)) {
    if (!r.session_id || !b.sessions.has(r.session_id)) continue;
    let d = null; try { d = JSON.parse(r.text); } catch {}
    if (d && d.text) texts.push({ sessionId: r.session_id, field: 'output', text: d.text, t: r.t });
  }
  const limit = Math.min(50, Number(p.limit) || 20);
  const sessionHits = searchBoard({ q, sessions: sums, workspaces, texts, limit });
  // 메모 노드와 칸반 카드(P6c, ARCH 4절 H2 "메모"). 고르면 그 메모·칸반 노드로 간다
  const itemHits = searchItems({ q, memos: b.store.memos(), kanbans: b.store.kanbans(), limit });
  const results = [...sessionHits, ...itemHits].sort((x, y) => y.score - x.score || String(x.name).localeCompare(String(y.name))).slice(0, limit);
  return { q, results };
}

// 판 위치 바꾸기 기록(P5 5절 2번: 설명하지 못한 노드 이동). 창이 보낸 까닭과 함께 남긴다
export function noteNodeMove(b, s, before, after, cause) {
  if (!before) return;
  const moved = Math.abs(before.x - after.x) > 0.5 || Math.abs(before.y - after.y) > 0.5;
  const resized = Math.abs(before.w - after.w) > 0.5 || Math.abs(before.h - after.h) > 0.5;
  if (moved || resized) b.store.addEvent(s.sessionId, 'node_moved', { from: { x: before.x, y: before.y, w: before.w, h: before.h }, to: { x: after.x, y: after.y, w: after.w, h: after.h }, cause: clip(cause || 'unknown', 60) });
}

export function canvasHandlers(b) {
  return {
    'search.query': (p) => searchQuery(b, p),
    'dock.create': (p) => dockCreate(b, p),
    'dock.attach': (p) => dockAttach(b, p),
    'dock.update': (p) => dockUpdate(b, p),
    'dock.layout': (p) => dockLayout(b, p),
    'dock.workers': (p) => dockWorkers(b, p), // P68
    'dock.remove': (p) => dockRemove(b, p),
    'dock.list': () => b.store.docks(),
    'board.arrange': (p) => arrange(b, p),
    'board.setSize': (p) => setSize(b, p),
    'workspace.move': (p) => workspaceMove(b, p),
    'group.shift': (p) => groupShift(b, p), // P91: 묶음째 옮기기
    'worktree.move': (p) => worktreeMove(b, p), // P27
  };
}

