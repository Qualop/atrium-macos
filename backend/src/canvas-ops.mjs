// 단일 캔버스와 관계 표현의 판 API(ARCH 4절 H, P6a). backend.mjs의 Backend(b)를 받아 판 기록을 바꾼다. herdr는 어댑터로만 부른다.
// - 영역과 빈자리(H1), 영역 옮기기, 검색(H2), 붙여 묶기(H5), 크기 단계와 정리(H7). 골라 묶기(그룹, H6)는 P22에서 뺐다
// - 계산은 canvas.mjs·search.mjs의 순수 함수(창도 같이 씀). 바꾼 뒤에는 board.changed를 보내 창이 판을 다시 읽게 한다.
import crypto from 'node:crypto';
import { NODE, SIZE_STEPS, GAP, EMPTY_REGION, AUTO_EMPTY_REGION, regionsOf, regionRect, slotInRegion, newRegionSlot, freeSlot, separateRegions, splitSide, arrangeTree, overlaps, bbox, REGION_GAP, dockSpot } from './canvas.mjs';
import { layout as layoutTree, normalize, leaves, isLeaf, fromLine, minSize, remove as removeLeaf, removeWithOuter, insertWithOuter, rootSizes, presetTree, presetSize, PRESETS } from './dock-tree.mjs'; // P17: 분할 나무
import { searchBoard, searchItems } from './search.mjs';
import { clip } from './text.mjs';
import { areaKey, parseArea, wsOfArea, isBoxKey, WT_EMPTY, withBoxes, nestedRegions, regionConflicts, settleBoxes, migrateBoxes } from './worktree-areas.mjs'; // P27: 워크트리 영역. P35: 리포 영역 안의 상자
import { layoutRegions } from './region-layout.mjs'; // P31: 판 전체 정리의 영역 배치
import { readGroups, groupIndex } from './ws-groups.mjs'; // P44: 가상 그룹끼리 모으기

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
export function canvasItems(b) {
  const area = areaResolver(b);
  const nodes = b.store.nodes().filter((n) => b.sessions.has(n.session_id)).map((n) => ({ id: n.session_id, kind: 'node', ws: area(n.workspace_key || null, n.area), wsKey: n.workspace_key || null, x: n.x, y: n.y, w: n.w, h: n.h }));
  const memos = b.store.memos().map((m) => ({ id: m.memoId, kind: 'memo', ws: m.workspaceKey || null, wsKey: m.workspaceKey || null, x: m.x, y: m.y, w: m.w, h: m.h }));
  const kanbans = b.store.kanbans().map((k) => ({ id: k.kanbanId, kind: 'kanban', ws: k.workspaceKey || null, wsKey: k.workspaceKey || null, x: k.x, y: k.y, w: k.w, h: k.h }));
  // P13: 캔버스에 올린 판 밖 대화 노드(읽기 전용 카드). id는 convo:<대화 ID>
  const convos = b.store.shownConvoNodes ? b.store.shownConvoNodes().map((n) => ({ id: `convo:${n.convId}`, kind: 'convo', ws: area(n.workspaceKey || null, n.area), wsKey: n.workspaceKey || null, x: n.x, y: n.y, w: n.w, h: n.h })) : [];
  return withBoxes(areaAnchors(b), [...nodes, ...memos, ...kanbans, ...convos]);
}
// 영역의 자리(안이 비었을 때): 워크스페이스와, 그 워크스페이스의 워크트리 영역(P27)
export function areaAnchors(b) {
  const ws = b.store.workspaces();
  const keys = new Set(ws.map((w) => w.key));
  return [...ws, ...areaRows(b).filter((a) => keys.has(a.wsKey)).map((a) => ({ key: areaKey(a.wsKey, a.wt), x: a.x, y: a.y, empty: WT_EMPTY, wsKey: a.wsKey, wt: a.wt }))];
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
  const at = newRegionSlot(rs, w.auto ? AUTO_EMPTY_REGION : EMPTY_REGION);
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
  if (!w) throw keyed(apiError('not_found', `판에 없는 워크스페이스: ${key}`), 'wsNotFound', { ref: key });
  const dx = Math.round(Number(p.dx) || 0), dy = Math.round(Number(p.dy) || 0);
  if (!dx && !dy) return { moved: 0 };
  const items = canvasItems(b);
  const before = regions(b, items);
  // P27: 리포 영역을 옮기면 워크트리 영역도 함께 옮긴다(P35: 상자는 리포 영역 안이다)
  const own = items.filter((i) => i.wsKey === key && i.kind !== 'wtbox');
  const mine = [...before].filter(([k]) => wsOfArea(k) === key);
  const hit = mine.map(([, r]) => ({ ...r, x: r.x + dx, y: r.y + dy })).map((after) => [...before].find(([k, r]) => wsOfArea(k) !== key && overlaps(after, r, -1))).find(Boolean);
  if (hit && !p.force) throw keyed(apiError('overlap', `다른 워크스페이스 영역과 겹친다(${hit[0]})`), 'regionOverlap', { ws: wsOfArea(hit[0]) });
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
  if (!w) throw keyed(apiError('not_found', `판에 없는 워크스페이스: ${p.workspace}`), 'wsNotFound', { ref: p.workspace });
  const row = areaRows(b).find((a) => a.wsKey === w.key && (a.wt === p.worktree || a.path === p.worktree || a.branch === p.worktree));
  if (!row) throw apiError('not_found', `판에 없는 워크트리 영역: ${p.worktree}`);
  const dx = Math.round(Number(p.dx) || 0), dy = Math.round(Number(p.dy) || 0);
  if (!dx && !dy) return { moved: 0 };
  const key = areaKey(w.key, row.wt);
  const items = canvasItems(b);
  const hit = boxMoveHit(areaAnchors(b), items, key, dx, dy);
  if (hit && !p.force) throw keyed(apiError('overlap', `다른 영역과 겹친다(${hit})`), 'regionOverlap', { ws: w.key });
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
  for (const [key, { dx, dy }] of separateRegions(top)) moved.push({ key, dx, dy, items: shiftWorkspace(b, key, dx, dy, items) });
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
  const s = b.resolve(p.session), t = b.resolve(p.to);
  if (s === t) throw apiError('bad_request', '같은 노드끼리는 붙이지 않는다');
  const side = String(p.side || 'right');
  if (!SIDES.includes(side)) throw apiError('bad_request', `side: ${side}`);
  if (p.at != null && !['leaf', 'dock'].includes(p.at)) throw apiError('bad_request', `at은 leaf 또는 dock: ${p.at}`);
  const ws = sameWs(b, [s.sessionId, t.sessionId]);
  if (ws === undefined) throw apiError('bad_request', '덩어리는 한 워크스페이스 안에 있다. 다른 워크스페이스의 노드끼리는 붙이지 않는다');
  const sRect = nodeRect(b, s.sessionId);
  // 붙는 노드가 다른 덩어리에 있었으면 먼저 뗀다. 같은 덩어리 안에서 옮기면 바깥은 그대로 두고 나무 안에서만 옮긴다
  const old = dockOf(b, s.sessionId), td0 = dockOf(b, t.sessionId);
  if (old && (!td0 || old.dockId !== td0.dockId)) detach(b, old, s.sessionId, 'reattach');
  const td = dockOf(b, t.sessionId);
  const at = p.at || (td ? 'leaf' : 'dock');
  let tree, outer;
  if (td) {
    outer = dockOuter(b, td);
    const base = td.members.includes(s.sessionId) ? removeLeaf(td.tree, s.sessionId) : td.tree;
    ({ tree, outer } = insertWithOuter(base, outer, { target: t.sessionId, side, id: s.sessionId, at, size: sRect }));
  } else {
    ({ tree, outer } = insertWithOuter(t.sessionId, nodeRect(b, t.sessionId), { target: t.sessionId, side, id: s.sessionId, at, size: sRect }));
  }
  const saved = saveDock(b, { dockId: td ? td.dockId : null, workspaceKey: ws, tree, origin: (td && td.origin) || p.origin || why }, why);
  applyLayout(b, saved.tree, outer);
  settleRegions(b, 'dock attach');
  b.api.broadcast('board.changed', { why: 'dock' });
  return { dock: b.store.getDock(saved.dockId), at };
}

// 고른 노드들로 한 줄 덩어리를 만든다(atrium CLI, 시험). 순서는 주어진 대로, 자리는 첫 노드에서 시작하고 노드 크기를 줄 방향으로 지킨다
export function dockCreate(b, p) {
  const ids = (p.members || []).map((x) => b.resolve(x).sessionId);
  if (ids.length < 2 || new Set(ids).size !== ids.length) throw apiError('bad_request', '덩어리에는 서로 다른 노드가 둘 이상 있어야 한다');
  const ws = sameWs(b, ids);
  if (ws === undefined) throw apiError('bad_request', '덩어리는 한 워크스페이스 안에 있다');
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
// 고른 것이 덩어리 하나와 꼭 같으면 그 덩어리의 바깥 크기를 지키고, 아니면 칸마다 보통 노드 크기(cell)로 첫 노드 자리에서 시작한다
export function dockLayout(b, p) {
  const preset = String(p.preset || '');
  if (!PRESETS[preset]) throw apiError('bad_request', `배치 틀: ${Object.keys(PRESETS).join(', ')}`);
  const picked = [];
  const docks = [];
  for (const x of p.members || []) {
    const sid = b.resolve(x).sessionId;
    if (picked.includes(sid)) continue;
    const d = dockOf(b, sid);
    if (d) { if (!docks.some((y) => y.dockId === d.dockId)) docks.push(d); for (const m of d.members) if (!picked.includes(m) && b.sessions.has(m)) picked.push(m); }
    else picked.push(sid);
  }
  if (picked.length < 2) throw apiError('bad_request', '배치 틀에는 노드가 둘 이상 있어야 한다');
  const ws = sameWs(b, picked);
  if (ws === undefined) throw apiError('bad_request', '덩어리는 한 워크스페이스 안에 있다. 다른 워크스페이스의 노드는 섞어 짜지 않는다');
  const one = docks.length === 1 && docks[0].members.length === picked.length ? docks[0] : null;
  const head = dockOf(b, picked[0]);
  const start = head ? dockOuter(b, head) : nodeRect(b, picked[0]);
  const cell = { w: Math.round(Number(p.cellW) || NODE.w), h: Math.round(Number(p.cellH) || NODE.h) };
  let outer = one ? dockOuter(b, one) : { x: start.x, y: start.y, ...presetSize(preset, picked.length, cell) };
  // P50(#2): 새 크기의 덩어리가 다른 노드·메모·칸반을 덮지 않게, 첫 노드 자리에서 가장 가까운 빈자리로 둔다(U1)
  if (!one) outer = { ...outer, ...presetSpot(b, picked, outer) };
  for (const d of docks.slice(1)) { b.store.deleteDock(d.dockId); b.store.addEvent(null, 'dock_removed', { dockId: d.dockId, why: `preset ${preset}` }); }
  const saved = saveDock(b, { dockId: docks[0] ? docks[0].dockId : null, workspaceKey: ws, tree: presetTree(preset, picked), origin: p.origin || 'user' }, `preset ${preset}`);
  applyLayout(b, saved.tree, outer);
  settleRegions(b, 'dock preset');
  b.api.broadcast('board.changed', { why: 'dock' });
  return { dock: b.store.getDock(saved.dockId), preset };
}

// P50(#2): 배치 틀 바깥(outer)을 둘 자리. 고른 노드(picked)는 옮겨 가므로 피하지 않고, 그 노드가 든 영역(상자면 그 상자)도 피하지 않는다
function presetSpot(b, picked, outer) {
  const all = canvasItems(b);
  const area = areaOfNode(b, picked[0], all);
  const mine = new Set(picked);
  const items = all.filter((i) => !(i.kind === 'node' && mine.has(i.id)) && !(i.kind === 'wtbox' && i.box === area));
  const own = items.filter((i) => i.ws === area);
  const regs = regions(b, all);
  const ownReg = regionRect(own) || regs.get(area) || null;
  const others = [...regs].filter(([k]) => k !== area && k !== wsOfArea(area)).map(([, r]) => r).filter((r) => !ownReg || !overlaps(ownReg, r, -1));
  return dockSpot({ rect: outer, items, own, others, prefer: picked.map((sid) => nodeRect(b, sid)) });
}

// 덩어리 바꾸기. tree: 나무 통째로(분할선을 끈 비율, 같은 구성 노드만), sizes: 옛 한 줄 덩어리처럼 뿌리 마디 자식마다 길이(가로줄은 너비, 세로줄은 높이),
// x·y: 덩어리째 옮기기(바깥 왼쪽 위), w·h: 바깥 크기(비율대로 다시 나누고 잎마다 최소 크기를 지킨다)
export function dockUpdate(b, p) {
  const d = b.store.getDock(p.dock);
  if (!d) throw apiError('not_found', `없는 덩어리: ${p.dock}`);
  let tree = d.tree, outer = dockOuter(b, d);
  if (p.tree != null) {
    const t = normalize(p.tree);
    const ls = leaves(t);
    if (ls.length !== d.members.length || ls.some((x) => !d.members.includes(x))) throw apiError('bad_request', 'tree: 이 덩어리의 구성 노드를 모두 한 번씩(붙이기·떼기는 dock.attach, dock.remove)');
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
  b.store.addEvent(null, 'dock_saved', { dockId: d.dockId, tree: p.tree != null || p.sizes ? renameTree(b, tree) : undefined, outer: out, why: 'update' });
  if (p.w != null || p.h != null) settleRegions(b, 'dock resize');
  b.api.broadcast('board.changed', { why: 'dock' });
  return { dock: b.store.getDock(d.dockId), outer: out };
}

// 떼기: 덩어리에서 노드 하나를 뺀다(나무 정리). 뿌리 마디 바로 아래 칸이면 덩어리가 그만큼 줄고(왼쪽 위 자리는 그대로),
// 안쪽 칸이면 같은 마디의 이웃이 그 자리를 채운다. 하나만 남으면 덩어리가 풀린다
function detach(b, d, sid, why) {
  const outer = dockOuter(b, d);
  const r = removeWithOuter(d.tree, outer, sid);
  const saved = saveDock(b, { ...d, tree: r.tree }, why);
  if (saved) applyLayout(b, saved.tree, r.outer);
  return saved;
}
export function dockRemove(b, p) {
  if (p.dock) {
    const d = b.store.getDock(p.dock);
    if (!d) throw apiError('not_found', `없는 덩어리: ${p.dock}`);
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
  if (d) { detach(b, d, s.sessionId, 'session closed'); b.api.broadcast('board.changed', { why: 'dock' }); }
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
export function setSize(b, p) {
  const s = b.resolve(p.session);
  const step = SIZE_STEPS[p.size];
  if (!step) throw apiError('bad_request', `크기: ${Object.keys(SIZE_STEPS).join(', ')}`);
  const r = nodeRect(b, s.sessionId);
  const d = dockOf(b, s.sessionId);
  if (d && p.scope === 'dock') {
    // P23 고른 노드 막대: 덩어리 안 노드면 덩어리 전체 바깥이 그 크기가 된다(비율대로 나누고, 잎마다 최소 크기는 지킨다. 왼쪽 위는 그대로)
    const outer = dockOuter(b, d);
    const need = minSize(d.tree);
    applyLayout(b, d.tree, { ...outer, w: Math.max(need.w, step.w), h: Math.max(need.h, step.h) });
    b.store.addEvent(null, 'dock_saved', { dockId: d.dockId, outer: dockOuter(b, d), why: 'size' });
  } else if (d) {
    // 덩어리 안(P17): 그 노드가 단계 크기가 되도록 덩어리 바깥을 같은 배율로 늘이거나 줄인다. 비율은 그대로라 이웃도 함께 바뀐다(잎마다 최소 크기)
    const outer = dockOuter(b, d);
    b.store.setNode({ ...r, size: p.size });
    applyLayout(b, d.tree, { ...outer, w: Math.round((outer.w * step.w) / r.w), h: Math.round((outer.h * step.h) / r.h) });
  } else b.store.setNode({ ...r, w: step.w, h: step.h, size: p.size });
  b.store.addEvent(s.sessionId, 'node_size', { size: p.size });
  settleRegions(b, 'size');
  b.api.broadcast('board.changed', { why: 'size' });
  return { session: s.name, size: p.size, ...step };
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
  for (const n of nodes) if (!used.has(n.session_id)) out.push({ id: n.session_id, kind: 'node', x: n.x, y: n.y, w: n.w, h: n.h, members: [n.session_id], resizable: true });
  for (const m of b.store.memos().filter((m) => (m.workspaceKey || null) === wsKey)) out.push({ id: `m:${m.memoId}`, kind: 'memo', memoId: m.memoId, x: m.x, y: m.y, w: m.w, h: m.h, members: [], resizable: false });
  for (const k of b.store.kanbans().filter((k) => (k.workspaceKey || null) === wsKey)) out.push({ id: `k:${k.kanbanId}`, kind: 'kanban', kanbanId: k.kanbanId, x: k.x, y: k.y, w: k.w, h: k.h, members: [], resizable: false });
  for (const x of all.filter((i) => i.kind === 'wtbox' && i.ws === wsKey).sort((p, q) => p.y - q.y || p.x - q.x)) out.push({ id: `w:${x.box}`, kind: 'wtbox', box: x.box, x: x.x, y: x.y, w: x.w, h: x.h, members: [], resizable: false });
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
  const start = bbox(blocks);
  const plan = arrangeTree(blocks, edges, { origin: { x: start.x, y: start.y } });
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
    if (x.kind === 'node') { const n = byId.get(x.id); b.store.setNode({ ...n, x: Math.round(q.x), y: Math.round(q.y), w: q.w, h: q.h, size: q.size || n.size || null }); continue; }
    for (const m of x.members) { const n = byId.get(m); b.store.setNode({ ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) }); }
  }
}

// 정리(H7). workspace: 그 워크스페이스 영역 안만. all: 판 전체(P31: 모든 워크스페이스 안을 정리한 뒤 영역 묶음도 다시 놓는다, arrangeBoard)
export function arrange(b, p) {
  if (p.all) return arrangeBoard(b, p);
  const w = b.store.getWorkspace(p.workspace) || null;
  if (!w) throw keyed(apiError('not_found', `판에 없는 워크스페이스: ${p.workspace}`), 'wsNotFound', { ref: p.workspace });
  const key = w.key;
  const undoKey = `arrangeUndo:${key}`;
  if (p.undo) {
    const u = b.store.getMeta(undoKey);
    if (!u) throw keyed(apiError('not_found', '되돌릴 정리가 없다'), 'noArrangeUndo');
    for (const n of u.nodes) if (b.sessions.has(n.session_id)) b.store.setNode({ ...n, size: n.size ?? '' }); // 크기 단계도 정리 전 값으로(없었으면 지운다)
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
  const ids = new Set(pl.blocks.flatMap((x) => x.members));
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
    if (!u) throw keyed(apiError('not_found', '되돌릴 정리가 없다'), 'noArrangeUndo');
    for (const n of u.nodes) if (b.sessions.has(n.session_id)) b.store.setNode({ ...n, size: n.size ?? '' });
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
  const entries = [...regs].filter(([k]) => !isBoxKey(k)).map(([k, r]) => ({ key: k, ws: k, wt: '', rect: r, empty: !items.some((i) => i.wsKey === k), ...(gidx.has(k) ? { group: gidx.get(k).id, order: gidx.get(k).index } : {}) }));
  for (const i of items) if (!i.ws && (i.kind === 'memo' || i.kind === 'kanban')) entries.push({ key: `${i.kind}:${i.id}`, ws: null, wt: '', rect: { x: i.x, y: i.y, w: i.w, h: i.h }, item: i });
  const lay = layoutRegions(entries);
  const regionPlan = entries.map((e) => ({ key: e.key, from: e.rect, to: lay.rects.get(e.key) }));
  const edges = plans.reduce((s, pl) => s + pl.edges.length, 0);
  if (!p.apply) return { all: true, plan: plans.flatMap((pl) => pl.out), regions: regionPlan, clusters: lay.clusters, applied: false, edges };
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
  b.store.addEvent(null, 'arranged', { workspace: '*', workspaces: plans.length, regions: entries.length, edges, moved });
  b.api.broadcast('board.changed', { why: 'arrange' });
  return { all: true, plan: plans.flatMap((pl) => pl.out), regions: regionPlan, clusters: lay.clusters, applied: true, edges, undo: true };
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
    'dock.remove': (p) => dockRemove(b, p),
    'dock.list': () => b.store.docks(),
    'board.arrange': (p) => arrange(b, p),
    'board.setSize': (p) => setSize(b, p),
    'workspace.move': (p) => workspaceMove(b, p),
    'worktree.move': (p) => worktreeMove(b, p), // P27
  };
}

