// 판(무한 캔버스, ARCH 7절). 노드 자리는 사람이 정하고 판은 그 자리를 지킨다(BRIEF 4절).
// - 끌기와 크기 바꾸기가 끝나면 board.setNode, 화면 이동이 끝나면 board.setViewport로 저장한다(C1).
// - 가까이 얼굴이면서 보이는 노드에만 화면 스트림(제어기)을 붙인다. 상한은 기본 8(BRIEF 위험 2).
// - navigateTo: 노드를 옮기지 않고 화면을 그 노드로 옮긴다(내 차례 칩, N, 알림, 검색). P10: 덩어리 안의 노드면 덩어리 전체가 들어오게(lib/nav.js).
// - P3: 그룹 배경(halo)은 세션 노드 뒤에 그린다. 머리줄을 끌면 안의 세션도 같이 옮긴다. 노드 종류마다 오류 경계를 둔다(E5 2.5).
// - P4: 세션 사이의 연결선과 같은 저장소 선. 노드 가장자리 손잡이에서 다른 노드로 끌면 잇는다(F2).
// - P6a: 캔버스는 하나다(ARCH 4절 H). 모든 워크스페이스의 노드가 한 캔버스에 있고, 워크스페이스마다 영역(배경과 이름표)을 깐다(H1).
//   영역과 그룹 배경은 안의 노드를 감싸도록 그릴 때마다 계산한다(끄는 중에도). 영역 이름표를 끌면 안의 것이 모두 함께 움직인다.
//   붙여 묶기(H5): 덩어리의 노드를 끌면 덩어리째로 움직이고, Alt를 누른 채 끌면 그 노드만 끌어낸다. 혼자인 노드를 다른 노드(덩어리) 바깥 가장자리 가까이
//   끌면 붙을 자리를 보이고 놓으면 붙는다. 분할선(Docks.jsx)으로 이웃한 두 노드의 크기를 함께 바꾼다.
//   P23: 붙은 노드의 바깥 테두리와 엇갈리는 점도 끈다. P30: 덩어리 안 세션끼리의 연결은 일반 선 대신 경계 위 다리·바깥 괄호·둘레 길(Docks.jsx DockLinks)이다.
//   P17: 덩어리는 분할 나무다(dock-tree.mjs). Ctrl을 누른 채 노드를 끌면(ctrlDrag) 그 노드만 움직이고, 다른 노드나 덩어리 위에서 놓일 자리를 보인다:
//   노드의 위·아래·왼쪽·오른쪽 가장자리 쪽이면 그 노드를 반으로 나누고, 덩어리 바깥 가장자리 쪽이면 덩어리 전체 옆 새 칸. 아무 데도 아니면 덩어리에서 뗀다.
//   분할선은 마디마다 하나씩, 덩어리 오른쪽 아래 모서리 손잡이로 바깥 크기를 바꾼다.
//   노드를 누르면 그 노드로 가서 터미널에 초점을 준다(H4). Ctrl+누르기와 Shift+끌기로 여러 노드를 고른다(H6 묶기).
//   끈 거리가 3px 안이면 자리를 바꾸지 않고, 영역끼리 새로 겹치게 놓으면 되돌린다. 저장할 때 까닭(cause)을 함께 보낸다(P5 5절 2번 조사).
// - P6c: 메모·칸반 노드(I3·I4)도 같은 캔버스에 둔다. 영역 계산과 겹침 확인에 들고, 영역 이름표를 끌면 함께 움직인다.
//   메모·칸반을 놓으면 가운데가 든 워크스페이스 영역(없으면 120 안으로 가장 가까운 영역)의 소속이 된다(멀면 소속 없음). 검색으로 그 노드에 간다(navigateToItem).
// - P13: 판 밖 대화 노드(ConvoNode.jsx, id convo:<대화 ID>)도 같은 캔버스에 둔다. 영역 계산과 겹침 확인에 들고 영역 이름표를 끌면 함께 움직인다.
//   메모와 달리 놓아도 워크스페이스 소속은 바뀌지 않는다(대화의 리포). 같은 리포의 워크트리 대화 뒤에 워크트리 배경(wtbox), 대화끼리 띄움 선(spawnc)
// - P27: 영역은 워크스페이스마다 하나가 아니라 "영역(area)"마다 하나다. 리포의 살아 있는 워크트리마다 워크트리 영역(wtarea)을 둔다(worktree-areas.mjs).
//   P35: 워크트리 영역은 리포 영역 안의 노란 상자다(화살표 없음). 리포 영역은 본 저장소 쪽 것과 상자를 함께 감싼다(nestedRegions).
//   노드·대화 노드는 저장한 area로 영역이 정해진다. 리포 영역을 끌면 상자도 함께, 상자 이름표를 끌면 그 상자만(worktree.move) 움직인다.
//   상자가 본 저장소 쪽 것이나 다른 상자와 겹치거나, 커진 리포 영역이 다른 영역과 겹치면 놓을 때 되돌린다(regionConflicts). 메모·칸반은 본 저장소 영역에만 속한다
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, useReactFlow, applyNodeChanges } from '@xyflow/react';
import { shiftAreasLocal } from './store.js'; // P27
import { useStore, getState, setNodeLocal, saveNode, setAttached, setCloseIds, setFocus, markSeen, toast, openDialog, selectWorkspace, noteWorkspace, setViewNow, setSelected, setPendingInput, dockOf, loadBoard, setMemoLocal, setKanbanLocal, setConvoLocal, wsName } from './store.js';
import { ConvoNode, WorktreeBox, SpawnEdge } from './ConvoNode.jsx'; // P13
import { worktreeBoxes, boardSpawnDup } from '../../../backend/src/convo-canvas.mjs';
import { decorateEdges, edgeGap, innerEnds } from './lib/link-labels.js'; // P67. P98: edgeGap, innerEnds
import { api } from './api.js';
import { SessionNode } from './SessionNode.jsx';
import { terms } from './TerminalView.jsx'; // P38
import { termClickNavigates, TERM_CLICK_WAIT } from './lib/term-input.js'; // P38

let termClickTimer = null; // P38: 터미널 안 한 번 누르기의 화면 옮기기. 기다리는 동안 다시 누르면(두 번 누르기, 끌기 시작) 취소한다
if (typeof window !== 'undefined') window.addEventListener('mousedown', () => clearTimeout(termClickTimer), true);
import { RegionNode, WorktreeAreaNode, GroupFrameNode } from './Regions.jsx'; // P91: GroupFrameNode(묶음 테두리) // P27: 워크트리 영역(P35: 리포 영역 안의 상자)
import { MemoNode } from './Memo.jsx';
import { KanbanNode } from './Kanban.jsx';
import { wsAt } from './lib/items.js';
import { JunctionNode, DividerNode, GhostNode, DockGrip, DockEdge, DockLinks } from './Docks.jsx';
import { LinkEdge, RepoEdge } from './Links.jsx';
import { withBoundary } from './ErrorBoundary.jsx';
import { pickAttached, DEFAULT_MAX_CONTROLLERS } from './lib/faces.js';
import { perfLog } from './perf.js';
import { enterView, dockRect, isViewing, NAV_GAP } from './lib/nav.js'; // P10: 덩어리 안의 노드로 들어갈 때 덩어리 전체. P26: 85% 채우기, 이미 보고 있으면 그대로
import { enterSession } from './touch.js';
import { wakeSession } from './sleep.js'; // P21
import { t as tr, errText, useT } from './lib/i18n.js'; // P16: 이 파일은 t를 메모·칸반 종류 이름으로도 쓴다
import { repoEdges, facingSides } from '../../../backend/src/links.mjs';
import { boundsOf } from '../../../backend/src/workspaces.mjs';
import { chromeInset, fitInset } from './lib/chrome-inset.js'; // P52(#5)
import { bbox, REGION_GAP, groupFrames, groupFrameOf } from '../../../backend/src/canvas.mjs'; // P91: groupFrames(묶음 테두리). P98: groupFrameOf
import { layout as layoutTree, junctions, dropZone, edgeSnap } from '../../../backend/src/dock-tree.mjs'; // P17, P23
import { wsOfArea, areaAnchorList, areaResolverOf, isBoxKey, nestedRegions, regionConflicts, dockedAreas, visibleAnchors } from '../../../backend/src/worktree-areas.mjs'; // P27. P35: 상자는 리포 영역 안. P68: 워크트리끼리 붙인 덩어리
import { memoEditView } from './lib/memo-edit.js'; // P50(#6)
import { boardEmpty } from './lib/empty-board.js'; // P50(#6)
import { oneFinger, releaseKind, pinchViewport, panViewport, mid, dist as gap2, tapTarget, movableId, tapAction, TAP_CONTROL, LONG_PRESS_MS } from './lib/touch-board.js'; // P76
import { openFull, fullId, onFull } from './full-view.js'; // P76
import { termBudgetNow, boardPlan, step } from './crash-watch.js'; // P84: 휴대폰 웹은 터미널을 적게. P86: 보드 단계(levelPlan)와 단계 기록
import { tierOf } from './lib/overview.js'; // P85: 워크트리 상자 강조

const nodeTypes = { session: withBoundary(SessionNode, 'session'), region: withBoundary(RegionNode, 'region'), wtarea: withBoundary(WorktreeAreaNode, 'wtarea'), wsgroup: withBoundary(GroupFrameNode, 'wsgroup'),memo: withBoundary(MemoNode, 'memo'), kanban: withBoundary(KanbanNode, 'kanban'), convo: withBoundary(ConvoNode, 'convo'), wtbox: WorktreeBox, divider: DividerNode, junction: JunctionNode, ghost: GhostNode, dockgrip: DockGrip, dockedge: DockEdge, docklinks: DockLinks };
const edgeTypes = { link: LinkEdge, repo: RepoEdge, spawnc: SpawnEdge };
const HOLD_MS = 1500; // 화면 밖으로 나간 노드의 제어기를 놓기 전 기다리는 시간(끌 때 붙였다 뗐다 하지 않게)
const DRAG_MIN_PX = 3; // 이보다 덜 끌었으면 자리를 바꾸지 않는다(누르기)
const SNAP_PX = 48; // 가장자리끼리 화면에서 이만큼 가까우면 붙을 자리를 보인다
const LINE = 2; // P23: 분할선·테두리 노드의 판 두께(잡는 띠는 Docks.jsx가 화면 8px로 그린다)
const EDGE_PX = 36; // P17: Ctrl+끌기에서 덩어리 바깥 가장자리로 보는 거리(화면 px)
const CTRL_MIN_PX = 4; // Ctrl+누르기(고르기)와 Ctrl+끌기를 가르는 거리
const JOIN_PX = REGION_GAP / 2; // P6c: 메모·칸반을 영역 바로 옆(판 좌표 이 거리 안)에 놓아도 그 워크스페이스 소속

function readMax() {
  const q = new URLSearchParams(location.search).get('maxControllers');
  let v = q; try { v ??= localStorage.getItem('mt.maxControllers'); } catch {}
  const n = Number(v);
  return termBudgetNow(Number.isFinite(n) && v ? n : DEFAULT_MAX_CONTROLLERS, 0).max; // P84: 손가락 웹 화면은 3, 가벼운 화면은 1
}
export const MAX_CONTROLLERS = readMax();
const PLAN = boardPlan(); // P86: 이 부팅의 보드 단계(웹 화면이 죽을 때마다 한 단계씩 가벼워진다. PC 창은 늘 전부 켬)
const DOT_GAP = 92; // tokens.css --dot-gap와 같은 값(월드 px)

const rectOf = (n) => ({ x: n.position.x, y: n.position.y, w: n.width, h: n.height });
const wsOfId = (id) => { const s = getState().sessions.get(id); return s ? s.workspaceKey || null : null; };
// P27: 영역 키(본 저장소 영역은 워크스페이스 키, 워크트리 영역은 areaKey). 노드가 저장한 area가 살아 있는 워크트리 영역이 아니면 본 저장소 영역
let resolver = { ws: null, fn: null };
const areaResolve = (st = getState()) => { if (resolver.ws !== st.workspaces) resolver = { ws: st.workspaces, fn: areaResolverOf(st.workspaces) }; return resolver.fn; };
const rawAreaOfId = (id, st = getState()) => { const s = st.sessions.get(id); if (!s) return null; const n = st.nodes.get(id); return areaResolve(st)(s.workspaceKey || null, n && n.area); };
// P68: 같은 리포의 다른 영역 세션이 섞인 덩어리는 리포 영역(본 저장소 쪽)에 든다. 구성 노드가 빠져나가 빈 상자는 숨긴다(백엔드 canvas-ops.mjs boardItems와 같은 규칙)
let docked = {};
function dockedOf(st = getState()) {
  if (docked.docks !== st.docks || docked.nodes !== st.nodes || docked.sessions !== st.sessions || docked.ws !== st.workspaces || docked.cv !== st.convoNodes) {
    const d = dockedAreas([...st.docks.values()], (id) => (st.nodes.has(id) ? rawAreaOfId(id, st) : null));
    const used = [];
    for (const id of st.nodes.keys()) if (st.sessions.has(id)) used.push({ ws: d.area.get(id) ?? rawAreaOfId(id, st) });
    const area = areaResolve(st);
    for (const c of st.convoNodes.values()) used.push({ ws: area(c.workspaceKey || null, c.area) });
    docked = { docks: st.docks, nodes: st.nodes, sessions: st.sessions, ws: st.workspaces, cv: st.convoNodes, area: d.area, anchors: visibleAnchors(areaAnchorList(st.workspaces), used, d.pulled) };
  }
  return docked;
}
const areaOfId = (id, st = getState()) => dockedOf(st).area.get(id) ?? rawAreaOfId(id, st);
const anchorsOf = (st = getState()) => dockedOf(st).anchors;
const mainOnly = (regs) => new Map([...regs].filter(([k]) => wsOfArea(k) === k)); // 메모·칸반이 속할 수 있는 영역(본 저장소 영역)
let areaShift = null; // P27: 영역을 끄는 동안 빈 워크트리 영역도 따라오게 { ws, wt?, dx, dy }
// P35: 끄는 중인 영역만큼 옮긴 영역 자리(빈 상자가 따라온다)
// P91: 묶음을 끌 때(sh.wss: 구성 워크스페이스 키)는 구성 영역의 자리(빈 영역)와 상자 자리를 모두 옮겨 본다
const shiftedAnchors = (anchors, sh) => (!sh ? anchors : sh.wss ? anchors.map((a) => (sh.wss.has(a.wt ? a.wsKey : a.key) ? { ...a, x: a.x + sh.dx, y: a.y + sh.dy } : a)) : anchors.map((a) => (a.wt && a.wsKey === sh.ws && (!sh.wt || sh.wt === a.wt) ? { ...a, x: a.x + sh.dx, y: a.y + sh.dy } : a)));
// P6c: 메모·칸반 노드. React Flow id는 memo:<memoId>, kanban:<kanbanId>
const ITEM_TYPES = new Set(['memo', 'kanban']);
const isContent = (n) => n.type === 'session' || ITEM_TYPES.has(n.type) || n.type === 'convo';
const isItem = (n) => ITEM_TYPES.has(n.type) || n.type === 'convo'; // P13: 영역에 드는 세션 아닌 노드
const itemOf = (fid, st = getState()) => { const [t, id] = String(fid).split(':'); return t === 'memo' ? st.memos.get(id) : t === 'kanban' ? st.kanbans.get(id) : t === 'convo' ? st.convoNodes.get(id) : null; };
const itemWs = (fid) => { const it = itemOf(fid); return it ? it.workspaceKey || null : null; };
const itemArea = (fid, st = getState()) => { const it = itemOf(fid, st); if (!it) return null; return String(fid).startsWith('convo:') ? areaResolve(st)(it.workspaceKey || null, it.area) : it.workspaceKey || null; }; // P27
// 저장소의 메모·칸반 사각형(겹침 확인, 영역). over: fid → { x, y, ws? } 바꿔 볼 자리와 소속
function itemRects(st = getState(), over = new Map()) {
  const out = [];
  // P27: ws는 영역 키, wsKey는 워크스페이스 키
  for (const m of st.memos.values()) { const o = over.get(`memo:${m.memoId}`) || {}; const ws = 'ws' in o ? o.ws : m.workspaceKey || null; out.push({ id: `memo:${m.memoId}`, ws, wsKey: ws, x: o.x ?? m.x, y: o.y ?? m.y, w: m.w, h: m.h }); }
  for (const k of st.kanbans.values()) { const o = over.get(`kanban:${k.kanbanId}`) || {}; const ws = 'ws' in o ? o.ws : k.workspaceKey || null; out.push({ id: `kanban:${k.kanbanId}`, ws, wsKey: ws, x: o.x ?? k.x, y: o.y ?? k.y, w: k.w, h: k.h }); }
  const area = areaResolve(st);
  for (const c of st.convoNodes.values()) { const o = over.get(`convo:${c.convId}`) || {}; out.push({ id: `convo:${c.convId}`, ws: area(c.workspaceKey || null, c.area), wsKey: c.workspaceKey || null, x: o.x ?? c.x, y: o.y ?? c.y, w: c.w, h: c.h, convo: true }); } // P13: 소속은 바뀌지 않는다
  return out;
}
// 지금 캔버스의 모든 영역(노드, 메모·칸반, 빈 워크스페이스). skip: 빼고 계산할 메모·칸반, moved: 옮겨 볼 세션 자리
function allRegions({ skip = null, moved = null } = {}) {
  const st = getState();
  const items = [...[...st.nodes].filter(([id]) => st.sessions.has(id)).map(([id, r]) => ({ id, ws: areaOfId(id, st), ...r, ...((moved && moved.get(id)) || {}) })), ...itemRects(st).filter((r) => r.id !== skip)];
  return nestedRegions(anchorsOf(st), items); // P27: 영역(워크트리 영역 포함)마다. P35: 리포 영역은 상자를 감싼다
}
const setItemLocal = (fid, f) => { const [t, id] = String(fid).split(':'); (t === 'memo' ? setMemoLocal : t === 'convo' ? setConvoLocal : setKanbanLocal)(id, f); };
// 끈 메모·칸반을 저장한다. 소속이 바뀌면 알린다
function saveItem(fid, p) {
  const [t, id] = String(fid).split(':');
  const it = itemOf(fid);
  if (!it) return;
  const before = it.workspaceKey || null;
  setItemLocal(fid, { x: Math.round(p.x), y: Math.round(p.y), workspaceKey: p.ws });
  const params = { x: Math.round(p.x), y: Math.round(p.y), workspace: p.ws || null };
  api.call(t === 'memo' ? 'memo.update' : 'kanban.update', { [t]: id, ...params }).catch((e) => { toast(tr('canvas.itemSaveFail', { item: tr(`canvas.${t}`), error: errText(e) }), 'error'); loadBoard().catch(() => {}); });
  if (before !== (p.ws || null)) toast(p.ws ? tr(`canvas.${t}Joined`, { ws: wsName(p.ws) }) : tr(`canvas.${t}Left`));
}

// 지금 그리는 세션 노드(와 메모·칸반 노드) 자리로 워크스페이스 영역, 워크트리 배경, 분할선, 붙을 자리를 만든다. 겹친 영역은 warn
function backdrops(content, ghost, ctrlId = null) {
  const st = getState();
  const sess = content.filter((n) => n.type === 'session');
  const items = content.filter(isItem);
  const rect = new Map(sess.map((n) => [n.id, rectOf(n)]));
  const regionsOut = [], backOut = [], extra = [];
  // P27: 영역마다(본 저장소 영역과 워크트리 영역). 빈 워크트리 영역은 끄는 동안 areaShift만큼 따라온다
  // P35: 상자는 리포 영역 안이다(리포 영역이 상자를 감싼다). 겹친 영역(맨 위 영역끼리, 상자와 본 저장소 쪽 것, 상자끼리)은 warn
  const sessArea = new Map(sess.map((n) => [n.id, areaOfId(n.id, st)]));
  const itemAreaOf = new Map(items.map((n) => [n.id, itemArea(n.id, st)]));
  const anchors = shiftedAnchors(anchorsOf(st), areaShift);
  const inside = [...sess.map((n) => ({ id: n.id, ws: sessArea.get(n.id), ...rect.get(n.id) })), ...items.map((n) => ({ id: n.id, ws: itemAreaOf.get(n.id), ...rectOf(n) }))];
  const regMap = nestedRegions(anchors, inside);
  const bad = new Set();
  for (const p of regionConflicts(regMap, inside)) { const [a, b] = p.split('|'); bad.add(a); if (regMap.has(b)) bad.add(b); }
  // P91: 묶음(가상 그룹) 테두리. 구성 영역 둘 이상이 모여 있고 다른 영역이 테두리에 걸치지 않을 때만 그린다(groupFrames ok). 이름표를 끌면 구성 영역이 함께 움직인다
  const topRegs = new Map([...regMap].filter(([k]) => !isBoxKey(k)));
  for (const f of groupFrames(st.groups || [], topRegs)) {
    if (!f.ok) continue;
    regionsOut.push({ id: `grp:${f.id}`, type: 'wsgroup', position: { x: f.rect.x, y: f.rect.y }, width: f.rect.w, height: f.rect.h, dragHandle: '.mt-gdrag', data: { groupId: f.id, name: f.name, auto: f.auto, keys: f.keys }, zIndex: -3, selectable: false, style: { pointerEvents: 'none' } });
  }
  for (const a of anchors) {
    const key = a.key, r = regMap.get(key);
    if (!r) continue;
    const warn = bad.has(key);
    if (!a.wt) { regionsOut.push({ id: `ws:${key}`, type: 'region', position: { x: r.x, y: r.y }, width: r.w, height: r.h, dragHandle: '.mt-rdrag', data: { wsKey: key, warn }, zIndex: -2, selectable: false, style: { pointerEvents: 'none' } }); continue; }
    const inSess = sess.filter((n) => sessArea.get(n.id) === key), inItems = items.filter((n) => itemAreaOf.get(n.id) === key);
    const working = inSess.filter((n) => (st.sessions.get(n.id) || {}).state === 'working').length, convos = inItems.filter((n) => n.type === 'convo').length;
    const live = inSess.filter((n) => tierOf(st.sessions.get(n.id)) === 'work').length; // P85: 명령이 도는 셸과 띄우는 중도 일함으로 본다(상자 강조)
    regionsOut.push({ id: `wa:${key}`, type: 'wtarea', position: { x: r.x, y: r.y }, width: r.w, height: r.h, dragHandle: '.mt-wadrag', data: { wsKey: a.wsKey, wt: a.wt, area: key, branch: a.branch, path: a.path, warn, n: inSess.length, working, live, convos }, zIndex: -1, selectable: false, style: { pointerEvents: 'none' } });
  }
  // P17: 덩어리(분할 나무)마다 마디의 분할선과 바깥 크기 손잡이. 지금 그리는 구성 노드 자리의 bbox를 바깥으로 본다(덩어리째 끄는 중에도 따라온다).
  // Ctrl+끌기로 끌어내는 노드(ctrlId)는 저장소 자리로 센다(덩어리 모양은 놓을 때까지 그대로)
  // P23: 붙은 노드의 바깥 테두리(잎마다 덩어리 바깥에 닿은 쪽), 엇갈리는 점, 덩어리 안 연결선(그 덩어리 안에 연결이 있을 때만)
  // P30: 덩어리 안 연결(다리·괄호·둘레 길)은 분할선(3000)보다 위(3003)라 다리를 누를 수 있다. 노드 상자는 1 × 1로 두고 안의 그림이 넘쳐 그려지게 한다
  //   (덩어리만 한 상자를 그 높이에 두면 React Flow가 가운데 점에서 잇기를 시작하지 않는다)
  const fixed = { selectable: false, draggable: false, focusable: false };
  for (const d of st.docks.values()) {
    const rs = d.members.map((m) => (m === ctrlId ? st.nodes.get(m) : rect.get(m)));
    if (rs.some((r) => !r) || !d.tree) continue;
    const outer = bbox(rs);
    const lay = layoutTree(d.tree, outer);
    for (const dv of lay.dividers) {
      const r = dv.dir === 'row' ? { x: dv.x - LINE / 2, y: dv.y, w: LINE, h: dv.h } : { x: dv.x, y: dv.y - LINE / 2, w: dv.w, h: LINE };
      extra.push({ id: `div:${d.dockId}:${dv.path.join('.')}:${dv.index}`, type: 'divider', position: { x: r.x, y: r.y }, width: r.w, height: r.h, data: { dockId: d.dockId, path: dv.path, index: dv.index, dir: dv.dir }, zIndex: 3000, ...fixed });
    }
    // Internal junctions retain the direct divider affordance; outer edges resize the whole dock.
    for (const j of junctions(d.tree, outer)) {
      extra.push({ id: `junction:${d.dockId}:${j.x}:${j.y}`, type: 'junction', position: { x: j.x, y: j.y }, width: 1, height: 1, data: { dockId: d.dockId, j }, zIndex: 3002, ...fixed });
    }
    // P73: 바깥 테두리는 덩어리 전체의 네 변(끌면 덩어리 전체가 비율대로 커지고 작아진다).
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const e = side === 'left' ? { x: outer.x - LINE / 2, y: outer.y, w: LINE, h: outer.h } : side === 'right' ? { x: outer.x + outer.w - LINE / 2, y: outer.y, w: LINE, h: outer.h } : side === 'top' ? { x: outer.x, y: outer.y - LINE / 2, w: outer.w, h: LINE } : { x: outer.x, y: outer.y + outer.h - LINE / 2, w: outer.w, h: LINE };
      extra.push({ id: `edge:${d.dockId}:${side}`, type: 'dockedge', position: { x: e.x, y: e.y }, width: e.w, height: e.h, data: { dockId: d.dockId, side }, zIndex: 3000, ...fixed });
    }
    extra.push({ id: `grip:${d.dockId}`, type: 'dockgrip', position: { x: outer.x + outer.w - LINE / 2, y: outer.y + outer.h - LINE / 2 }, width: LINE, height: LINE, data: { dockId: d.dockId }, zIndex: 3001, ...fixed });
    if ([...st.links.values()].some((l) => d.members.includes(l.from) && d.members.includes(l.to))) {
      const rel = Object.fromEntries(d.members.map((m, i) => [m, { x: rs[i].x - outer.x, y: rs[i].y - outer.y, w: rs[i].w, h: rs[i].h }]));
      extra.push({ id: `dl:${d.dockId}`, type: 'docklinks', position: { x: outer.x, y: outer.y }, width: 1, height: 1, data: { dockId: d.dockId, rects: rel }, zIndex: 3003, ...fixed, style: { pointerEvents: 'none' } });
    }
  }
  // P13: 워크트리 대화 배경(지금 그리는 자리로)
  const cvs = content.filter((n) => n.type === 'convo').map((n) => { const c = st.convoNodes.get(n.data.convId); return c ? { ws: c.workspaceKey, block: c.block, ...rectOf(n) } : null; }).filter(Boolean);
  for (const bx of worktreeBoxes(cvs)) backOut.push({ id: `wt:${bx.ws}:${bx.block}`, type: 'wtbox', position: { x: bx.x, y: bx.y }, width: bx.w, height: bx.h, data: { ws: bx.ws, block: bx.block, n: bx.n }, zIndex: -1, selectable: false, draggable: false, focusable: false, style: { pointerEvents: 'none' } });
  if (ghost) extra.push({ id: 'ghost', type: 'ghost', position: { x: ghost.x, y: ghost.y }, width: ghost.w, height: ghost.h, data: { kind: ghost.kind, side: ghost.side }, zIndex: 2999, selectable: false, draggable: false, focusable: false, style: { pointerEvents: 'none' } });
  return { regionsOut, backOut, extra };
}
// 세션 노드(와 메모·칸반 노드)는 그대로 두고 배경들만 다시 만든다. 끄는 중인 배경 노드(영역)는 React Flow가 쥔 자리를 그대로 둔다
function rederive(ns, ghost, ctrlId = null) {
  const content = ns.filter(isContent);
  const prev = new Map(ns.filter((n) => !isContent(n)).map((n) => [n.id, n]));
  const { regionsOut, backOut, extra } = backdrops(content, ghost, ctrlId);
  const keep = (n) => { const o = prev.get(n.id); if (!o) return n; return o.dragging ? { ...o, data: n.data } : { ...o, ...n }; };
  return [...regionsOut.map(keep), ...backOut.map(keep), ...content, ...extra.map(keep)];
}
// 영역끼리 겹치는 워크스페이스 쌍(놓은 뒤 새로 겹치면 되돌린다). itemOver: 메모·칸반의 바꿔 볼 자리와 소속(P6c)
// P35: 리포 영역과 그 안의 상자는 겹침이 아니다. 상자와 본 저장소 쪽 것, 같은 리포의 상자끼리, 맨 위 영역끼리(regionConflicts). anchors: 바꿔 볼 영역 자리
function overlapPairs(sessRects, st = getState(), itemOver = new Map(), anchors = anchorsOf(st)) {
  const items = [...sessRects.map((r) => ({ ws: areaOfId(r.id, st), ...r })), ...itemRects(st, itemOver)];
  return regionConflicts(nestedRegions(anchors, items), items);
}

// P17: 그냥 끌기의 붙을 대상. 같은 워크스페이스의 혼자인 노드와 덩어리(바깥 사각형). 끄는 노드가 든 덩어리는 뺀다. ns: 지금 그리는 노드
function snapBlocks(ns, leadId) {
  const ws = wsOfId(leadId); // P68: 같은 워크스페이스(리포)면 워크트리가 달라도 붙인다(P27에서는 같은 영역만)
  const rm = new Map(ns.filter((n) => n.type === 'session').map((n) => [n.id, rectOf(n)]));
  const out = [], seen = new Set();
  for (const [id, r] of rm) {
    if (id === leadId || wsOfId(id) !== ws) continue;
    const d = dockOf(id);
    if (!d) { out.push({ id, dockId: null, ...r }); continue; }
    if (seen.has(d.dockId) || d.members.includes(leadId)) continue;
    seen.add(d.dockId);
    const rs = d.members.map((m) => rm.get(m)).filter(Boolean);
    const R = bbox(rs);
    const edgeLeaf = (side) => (d.members.find((m) => { const q = rm.get(m); return q && (side === 'left' ? q.x === R.x : side === 'right' ? q.x + q.w === R.x + R.w : side === 'top' ? q.y === R.y : q.y + q.h === R.y + R.h); }) || d.members[0]);
    out.push({ id: d.members[0], dockId: d.dockId, ...R, edgeLeaf });
  }
  return out;
}
// P17: Ctrl+끌기의 놓일 자리 후보(dock-tree.mjs dropZone). 저장소 자리로 센다. 끄는 노드는 잎에서 뺀다(제 덩어리의 바깥은 그대로)
function ctrlBlocks(leadId) {
  const st = getState();
  const ws = wsOfId(leadId); // P68: 같은 워크스페이스(리포)
  const out = [], seen = new Set();
  for (const [id, r] of st.nodes) {
    if (id === leadId || !st.sessions.has(id) || wsOfId(id) !== ws) continue;
    const d = dockOf(id);
    if (!d) { out.push({ dockId: null, rect: { x: r.x, y: r.y, w: r.w, h: r.h }, leaves: [{ id, x: r.x, y: r.y, w: r.w, h: r.h }] }); continue; }
    if (seen.has(d.dockId)) continue;
    seen.add(d.dockId);
    const rs = d.members.map((m) => st.nodes.get(m)).filter(Boolean);
    out.push({ dockId: d.dockId, rect: bbox(rs), leaves: d.members.filter((m) => m !== leadId && st.nodes.get(m)).map((m) => { const q = st.nodes.get(m); return { id: m, x: q.x, y: q.y, w: q.w, h: q.h }; }) });
  }
  return out;
}

// P50(#6): 빈 판의 첫 걸음 안내. 프로젝트 열기(위 왼쪽 +와 같다)와 세션 띄우기(레일 실행 단추를 Shift로 누른 것과 같은 대화상자)
function EmptyHint() {
  const t = useT();
  const empty = useStore((st) => boardEmpty({ loaded: st.boardLoaded, workspaces: st.workspaces, sessions: st.sessions, memos: st.memos, kanbans: st.kanbans, convoNodes: st.convoNodes }));
  if (!empty) return null;
  return (
    <div className="mt-empty-hint" data-role="empty-hint">
      <div className="mt-empty-title">{t('emptyBoard.title')}</div>
      <div className="mt-empty-body">{t('emptyBoard.body')}</div>
      <div className="mt-empty-actions">
        <button className="mt-btn" data-action="empty-ws-open" onClick={() => openDialog({ kind: 'wsopen' })}>{t('emptyBoard.open')}</button>
        <button className="mt-btn ghost" data-action="empty-spawn" onClick={() => openDialog({ kind: 'spawn' })}>{t('emptyBoard.spawn')}</button>
      </div>
    </div>
  );
}

export function Canvas() {
  const storeNodes = useStore((st) => st.nodes);
  const sessions = useStore((st) => st.sessions);
  const links = useStore((st) => st.links);
  const docks = useStore((st) => st.docks);
  const workspaces = useStore((st) => st.workspaces);
  const wsGroups = useStore((st) => st.groups); // P91
  const memos = useStore((st) => st.memos);
  const kanbans = useStore((st) => st.kanbans);
  const convoNodes = useStore((st) => st.convoNodes); // P13
  const convoEdges = useStore((st) => st.convoEdges);
  const currentWs = useStore((st) => (PLAN.allWs ? null : st.currentWs)); // P86 단계 4: 워크스페이스를 바꾸면 그 세션만 다시 그린다
  const initialViewport = useStore((st) => st.viewport);
  const rf = useReactFlow();
  const wrapRef = useRef(null);
  const [nodes, setNodes] = useState([]);
  const nodesRef = useRef(nodes); // P76: 길게 눌러 옮길 노드를 찾는다
  nodesRef.current = nodes;
  const [rev, setRev] = useState(0); // 바꾸면 저장소 자리로 다시 그린다(되돌리기)
  const [labelTick, setLabelTick] = useState(0); // P67: 선 이름표가 시간이 지나 물러나도록 다시 센다
  useEffect(() => { const i = setInterval(() => setLabelTick((n) => n + 1), 15000); return () => clearInterval(i); }, []);
  const held = useRef(new Map()); // id → 마지막으로 붙일 대상이던 시각
  const drag = useRef(null); // { id, type, mode, start, pointer, followers: [{ id, x, y }], live, snap }
  const ghostRef = useRef(null);
  const ctrlRef = useRef(null); // P17: Ctrl+끌기로 끄는 노드 ID
  const focusTimer = useRef(null);
  useEffect(() => () => clearTimeout(focusTimer.current), []);

  // 저장소의 배치 → React Flow 노드(끄는 중에는 React Flow가 위치를 쥔다. 함께 움직이는 노드는 drag.live 자리)
  useEffect(() => {
    setNodes((prev) => {
      const st = getState();
      const byId = new Map(prev.map((n) => [n.id, n]));
      const live = drag.current && drag.current.live;
      const sess = [];
      for (const [id, r] of st.nodes) {
        if (!st.sessions.has(id)) continue;
        if (!PLAN.allWs && (st.sessions.get(id).workspaceKey || null) !== (st.currentWs || null)) continue; // P86 단계 4: 지금 워크스페이스만
        const old = byId.get(id);
        if (old && old.dragging) { sess.push(old); continue; }
        const d = dockOf(id);
        const p = live && live.get(id);
        sess.push({ ...(old || {}), id, type: 'session', position: p || { x: r.x, y: r.y }, width: r.w, height: r.h, dragHandle: '.mt-drag', data: {}, zIndex: r.z || 0, className: d ? `docked dock-${d.dir}` : '' });
      }
      // P6c: 메모·칸반 노드
      const item = (fid, type, it, handle, data) => {
        const old = byId.get(fid);
        if (old && old.dragging) return old;
        const p = live && live.get(fid);
        return { ...(old || {}), id: fid, type, position: p || { x: it.x, y: it.y }, width: it.w, height: it.h, dragHandle: handle, data, zIndex: 0 };
      };
      if (PLAN.items) { // P86 단계 2부터 메모·칸반·대화 노드를 뺀다
        for (const m of st.memos.values()) sess.push(item(`memo:${m.memoId}`, 'memo', m, '.mt-mdrag', { memoId: m.memoId }));
        for (const k of st.kanbans.values()) sess.push(item(`kanban:${k.kanbanId}`, 'kanban', k, '.mt-kdrag', { kanbanId: k.kanbanId }));
        for (const c of st.convoNodes.values()) sess.push(item(`convo:${c.convId}`, 'convo', c, '.mt-cdrag', { convId: c.convId })); // P13
      }
      return rederive([...prev.filter((n) => !isContent(n)), ...sess], ghostRef.current, ctrlRef.current);
    });
  }, [storeNodes, sessions, docks, links, workspaces, wsGroups, memos, kanbans, convoNodes, rev, currentWs]); // P23: links(덩어리 안 연결선). P91: wsGroups(묶음 테두리)

  // 연결선. 같은 덩어리 안 두 노드 사이의 연결은 노드 위에 겹친 선으로 보인다(H5, P23 DockLinks). 같은 저장소 선은 워크트리 세션이 있을 때만(F4)
  const edges = useMemo(() => {
    const out = [];
    // P13: 대화 노드(convo:<ID>)의 사각형도 찾는다
    const rectId = (id) => { if (storeNodes.has(id)) return storeNodes.get(id); if (String(id).startsWith('convo:')) { const c = convoNodes.get(id.slice(6)); return c ? { x: c.x, y: c.y, w: c.w, h: c.h } : null; } return null; };
    const sides = (a, b) => facingSides(rectId(a), rectId(b));
    const here = (id) => storeNodes.has(id) && sessions.has(id) && (PLAN.allWs || (sessions.get(id).workspaceKey || null) === (getState().currentWs || null)); // P86 단계 4
    // P23: 같은 덩어리 안의 두 세션(그 연결은 Docks.jsx DockLinks가 노드 위에 겹쳐 그린다)
    const dockIdOf = new Map();
    for (const d of docks.values()) for (const m of d.members) dockIdOf.set(m, d.dockId);
    const adjacent = (a, b) => dockIdOf.has(a) && dockIdOf.get(a) === dockIdOf.get(b);
    // 선 위 글이 놓일 틈. 자기 끝을 포함한 세션 위면 blocked, 최종 Bezier·이동 좌표도 렌더러에서 검사한다(P108).
    // P98: 덩어리 바깥 사각형(구성 노드 → 그 덩어리). 칸 사이 경계에 붙은 선 끝 점은 그리지 않는다(innerEnds)
    const outerOf = new Map();
    for (const d of docks.values()) { const r = bbox(d.members.map((m) => storeNodes.get(m))); if (r) for (const m of d.members) outerOf.set(m, r); }
    const labelRects = [...storeNodes].filter(([id]) => sessions.has(id)).map(([, r]) => r);
    const gapOf = (a, b) => {
      const ra = rectId(a), rb = rectId(b), sd = facingSides(ra, rb);
      return { ...edgeGap(ra, rb, sd, labelRects), ...innerEnds(ra, rb, sd, outerOf.get(a), outerOf.get(b), labelRects), labelRects };
    };
    for (const l of links.values()) if (here(l.from) && here(l.to) && !adjacent(l.from, l.to)) out.push({ id: l.linkId, source: l.from, target: l.to, ...sides(l.from, l.to), type: 'link', data: gapOf(l.from, l.to) });
    const linked = (a, b) => [...links.values()].some((l) => l.from === a && l.to === b);
    const inWtArea = (id) => { const k = rawAreaOfId(id); return !!k && isBoxKey(k); }; // P27: 워크트리 영역에 든 세션은 그 상자가 관계를 보인다(P35: 리포 영역 안의 노란 상자). P68: 덩어리로 빠져나간 세션은 칸 머리의 브랜치가 보인다
    for (const e of repoEdges([...sessions.values()].filter((s) => here(s.sessionId)), linked)) if (!adjacent(e.from, e.to) && !inWtArea(e.to) && !inWtArea(e.from)) out.push({ id: e.id, source: e.from, target: e.to, ...sides(e.from, e.to), type: 'repo', data: { ...e, ...gapOf(e.from, e.to) }, selectable: false });
    // P13: 대화끼리의 띄움 선(대화 노드나 판 세션 사이)
    const hereAny = (id) => (String(id).startsWith('convo:') ? PLAN.items && convoNodes.has(id.slice(6)) : here(id)); // P86 단계 2: 대화 노드 없음
    const linkedLive = (a, b) => [...links.values()].some((l) => l.from === a && l.to === b); // P67: 판의 연결이 있는 판 세션끼리의 띄움은 그 연결 하나로
    for (const e of convoEdges) if (hereAny(e.from) && hereAny(e.to) && !boardSpawnDup(e, linkedLive)) out.push({ id: e.id, source: e.from, target: e.to, ...sides(e.from, e.to), type: 'spawnc', data: { ...e, ...gapOf(e.from, e.to) }, selectable: false });
    // P86 단계 2부터: 선은 일 시키기 연결만, 이름표 없는 곧은 선으로
    if (!PLAN.fancyEdges) return out.filter((e) => e.type === 'link').map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, type: 'straight', selectable: false }));
    return decorateEdges(out, { rectOf: rectId, links, sessions, now: Date.now() }); // P67: 한 쌍에 이름표 하나, 물러나기, 비켜 놓기
  }, [links, sessions, storeNodes, docks, convoNodes, convoEdges, workspaces, labelTick, currentWs]);

  // 노드 손잡이를 끌어 이으면 역할을 묻는다(F2). 같은 쌍에 이미 역할이 있으면 고칠 수 있게 같은 대화상자를 연다
  const onConnect = useCallback((c) => { if (c.source && c.target && c.source !== c.target) openDialog({ kind: 'role', from: c.source, to: c.target }); }, []);

  const onNodesChange = useCallback((changes) => setNodes((ns) => {
    let next = applyNodeChanges(changes.filter((c) => c.type !== 'remove'), ns);
    const dr = drag.current;
    if (dr) {
      const lead = next.find((n) => n.id === dr.id);
      if (lead) {
        const dx = lead.position.x - dr.start.x, dy = lead.position.y - dr.start.y;
        if (dr.mode === 'region' || dr.mode === 'wtarea') areaShift = { ws: dr.wsKey, wt: dr.mode === 'wtarea' ? dr.wt : null, dx, dy }; // P27
        if (dr.mode === 'wsgroup') areaShift = { wss: dr.keys, dx, dy }; // P91: 묶음째
        if (dr.followers.length) {
          dr.live = new Map(dr.followers.map((f) => [f.id, { x: f.x + dx, y: f.y + dy }]));
          next = next.map((n) => (dr.live.has(n.id) ? { ...n, position: dr.live.get(n.id) } : n));
        }
        // 혼자 끄는 노드: 같은 워크스페이스 노드(덩어리는 덩어리 전체)의 바깥 가장자리 가까이면 붙을 자리(H5, P17: 덩어리 어느 가장자리에나)
        if (dr.snapOk && lead.type === 'session') {
          const zoom = rf.getViewport().zoom;
          dr.snap = edgeSnap({ id: lead.id, ...rectOf(lead) }, snapBlocks(next, lead.id), SNAP_PX / zoom);
          ghostRef.current = dr.snap ? { ...dr.snap.preview, kind: 'snap', side: dr.snap.side } : null;
        }
      }
    }
    return rederive(next, ghostRef.current);
  }), [rf]);

  const onNodeDragStart = useCallback((e, node, dragging) => {
    const st = getState();
    const dr = { id: node.id, type: node.type, start: { ...node.position }, pointer: { x: e.clientX, y: e.clientY }, followers: [], live: null, snap: null, snapOk: false, mode: node.type };
    const at = (id) => ({ id, ...st.nodes.get(id) });
    if (node.type === 'session') {
      const d = dockOf(node.id);
      const multi = (dragging || []).length > 1;
      if (multi) {
        // 여러 노드를 고른 채 끈다. 고른 노드의 덩어리 짝도 함께 움직인다
        dr.mode = 'multi';
        const picked = new Set(dragging.map((n) => n.id));
        for (const n of dragging) { const dd = dockOf(n.id); if (dd) for (const m of dd.members) if (!picked.has(m)) { picked.add(m); dr.followers.push(at(m)); } }
      } else if (d && !e.altKey) { dr.mode = 'dock'; dr.dockId = d.dockId; dr.followers = d.members.filter((x) => x !== node.id).map(at); }
      else { dr.mode = d ? 'pull' : 'single'; dr.snapOk = true; }
    } else if (node.type === 'region') {
      dr.wsKey = node.data.wsKey;
      dr.followers = [...st.sessions.values()].filter((s) => s.workspaceKey === dr.wsKey && st.nodes.has(s.sessionId)).map((s) => at(s.sessionId));
      // P6c: 그 워크스페이스의 메모·칸반도 함께
      for (const r of itemRects(st)) if (r.wsKey === dr.wsKey) dr.followers.push({ id: r.id, x: r.x, y: r.y, item: true }); // P27: 워크트리 영역의 대화 노드도
    } else if (node.type === 'wtarea') {
      // P27: 워크트리 영역만. 그 영역에 든 세션과 대화 노드가 함께 움직인다
      dr.wsKey = node.data.wsKey; dr.wt = node.data.wt; dr.area = node.data.area;
      dr.followers = [...st.sessions.values()].filter((s) => st.nodes.has(s.sessionId) && areaOfId(s.sessionId, st) === dr.area).map((s) => at(s.sessionId));
      for (const r of itemRects(st)) if (r.ws === dr.area) dr.followers.push({ id: r.id, x: r.x, y: r.y, item: true });
    } else if (node.type === 'wsgroup') {
      // P91: 묶음 이름표. 구성 워크스페이스의 세션, 메모·칸반, 대화 노드가 함께 움직인다(빈 영역과 상자 자리는 areaShift로)
      dr.keys = new Set(node.data.keys || []);
      dr.groupId = node.data.groupId;
      dr.followers = [...st.sessions.values()].filter((s) => dr.keys.has(s.workspaceKey) && st.nodes.has(s.sessionId)).map((s) => at(s.sessionId));
      for (const r of itemRects(st)) if (dr.keys.has(r.wsKey)) dr.followers.push({ id: r.id, x: r.x, y: r.y, item: true });
    } else if (isItem(node)) {
      dr.mode = (dragging || []).length > 1 ? 'multi' : 'item';
    }
    dr.before = overlapPairs([...st.nodes].filter(([id]) => st.sessions.has(id)).map(([id, r]) => ({ id, ...r })));
    drag.current = dr;
    perfLog('drag_start', { id: node.id, type: node.type, mode: dr.mode, followers: dr.followers.length });
  }, []);

  const revert = useCallback((why) => { drag.current = null; ghostRef.current = null; areaShift = null; setRev((x) => x + 1); if (why) toast(why, 'error'); }, []);

  const onNodeDragStop = useCallback((e, node, dragged) => {
    const dr = drag.current;
    const snap = dr && dr.snap;
    const dist = dr ? Math.hypot(e.clientX - dr.pointer.x, e.clientY - dr.pointer.y) : 0;
    ghostRef.current = null;
    areaShift = null;
    if (!dr || dr.id !== node.id || dist < DRAG_MIN_PX) { perfLog('drag_ignored', { id: node.id, dist: +dist.toFixed(1) }); return revert(); }
    const dx = node.position.x - dr.start.x, dy = node.position.y - dr.start.y;
    perfLog('drag_stop', { id: node.id, mode: dr.mode, dist: Math.round(dist), dx: Math.round(dx), dy: Math.round(dy), snap: snap ? `${snap.side}:${snap.targetId}` : null });
    const st = getState();
    const fail = (e2) => { toast(errText(e2), 'error'); loadBoard().catch(() => {}); };
    if (dr.mode === 'region') {
      drag.current = null;
      for (const f of dr.followers) (f.item ? setItemLocal : setNodeLocal)(f.id, { x: f.x + dx, y: f.y + dy });
      shiftAreasLocal(dr.wsKey, null, Math.round(dx), Math.round(dy)); // P27: 워크트리 영역도 함께
      api.call('workspace.move', { workspace: dr.wsKey, dx: Math.round(dx), dy: Math.round(dy) }).catch((err) => { toast(err.code === 'overlap' ? tr('canvas.overlap') : tr('canvas.regionMoveFail', { error: errText(err) }), 'error'); loadBoard().catch(() => {}); });
      return;
    }
    if (dr.mode === 'wsgroup') {
      // P91: 묶음째 옮긴다. 구성 아닌 영역과 새로 겹치면 되돌린다
      const live = new Map(dr.followers.filter((f) => !f.item).map((f) => [f.id, { x: f.x + dx, y: f.y + dy }]));
      const liveItems = new Map(dr.followers.filter((f) => f.item).map((f) => [f.id, { x: f.x + dx, y: f.y + dy }]));
      const sessNow = [...st.nodes].filter(([id]) => st.sessions.has(id)).map(([id, r]) => ({ id, ...r, ...(live.get(id) || {}) }));
      const after = overlapPairs(sessNow, st, liveItems, shiftedAnchors(anchorsOf(st), { wss: dr.keys, dx, dy }));
      if ([...after].some((p) => !dr.before.has(p))) return revert(tr('canvas.overlapDrag'));
      drag.current = null;
      for (const f of dr.followers) (f.item ? setItemLocal : setNodeLocal)(f.id, { x: f.x + dx, y: f.y + dy });
      for (const k of dr.keys) shiftAreasLocal(k, null, Math.round(dx), Math.round(dy));
      api.call('group.shift', { group: dr.groupId, dx: Math.round(dx), dy: Math.round(dy) }).catch((err) => { toast(err.code === 'overlap' ? tr('canvas.overlap') : tr('canvas.regionMoveFail', { error: errText(err) }), 'error'); loadBoard().catch(() => {}); });
      return;
    }
    if (dr.mode === 'wtarea') {
      // P27: 워크트리 영역 하나만 옮기고 그 자리를 저장한다. P35: 상자가 본 저장소 쪽 것·다른 상자와 겹치거나 커진 리포 영역이 다른 영역과 겹치면 되돌린다
      const live = new Map(dr.followers.filter((f) => !f.item).map((f) => [f.id, { x: f.x + dx, y: f.y + dy }]));
      const liveItems = new Map(dr.followers.filter((f) => f.item).map((f) => [f.id, { x: f.x + dx, y: f.y + dy }]));
      const sessNow = (mv) => [...st.nodes].filter(([id]) => st.sessions.has(id)).map(([id, r]) => ({ id, ...r, ...(mv.get(id) || {}) }));
      const after = overlapPairs(sessNow(live), st, liveItems, shiftedAnchors(anchorsOf(st), { ws: dr.wsKey, wt: dr.wt, dx, dy }));
      if ([...after].some((p) => !dr.before.has(p))) return revert(tr('canvas.overlapDrag'));
      drag.current = null;
      for (const f of dr.followers) (f.item ? setItemLocal : setNodeLocal)(f.id, { x: f.x + dx, y: f.y + dy });
      shiftAreasLocal(dr.wsKey, dr.wt, Math.round(dx), Math.round(dy));
      api.call('worktree.move', { workspace: dr.wsKey, worktree: dr.wt, dx: Math.round(dx), dy: Math.round(dy) }).catch((err) => { toast(err.code === 'overlap' ? tr('canvas.overlap') : tr('canvas.regionMoveFail', { error: errText(err) }), 'error'); loadBoard().catch(() => {}); });
      return;
    }
    // 세션 노드: 새로 겹친 영역이 생기면 되돌린다(영역끼리 겹치지 않게, H1)
    const moved = new Map([...(dragged || [node]).filter((n) => n.type === 'session').map((n) => [n.id, { x: n.position.x, y: n.position.y }]), ...dr.followers.map((f) => [f.id, { x: f.x + dx, y: f.y + dy }])]);
    // P6c: 끈 메모·칸반. 놓은 자리의 가운데가 든 영역(그 노드를 빼고 계산)의 소속이 된다
    const movedItems = new Map();
    for (const n of (dragged || [node]).filter((x) => ITEM_TYPES.has(x.type))) {
      const it = itemOf(n.id, st);
      if (!it) continue;
      const r = { x: n.position.x, y: n.position.y, w: it.w, h: it.h };
      movedItems.set(n.id, { x: r.x, y: r.y, ws: wsAt(r, mainOnly(allRegions({ skip: n.id, moved })), JOIN_PX) }); // P27: 메모·칸반은 본 저장소 영역에만
    }
    // P13: 끈 대화 노드. 소속(리포)은 그대로 자리만
    const movedConvos = new Map((dragged || [node]).filter((x) => x.type === 'convo').map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
    for (const [fid, p] of movedConvos) movedItems.set(fid, p);
    if (!snap) {
      const after = overlapPairs([...st.nodes].filter(([id]) => st.sessions.has(id)).map(([id, r]) => ({ id, ...r, ...(moved.get(id) || {}) })), st, movedItems);
      if ([...after].some((p) => !dr.before.has(p))) return revert(tr('canvas.overlapDrag'));
    }
    drag.current = null;
    for (const [fid, p] of movedItems) { if (movedConvos.has(fid)) { setConvoLocal(fid.slice(6), { x: Math.round(p.x), y: Math.round(p.y) }); api.call('convo.move', { convo: fid.slice(6), x: Math.round(p.x), y: Math.round(p.y) }).catch((err) => toast(tr('canvas.convoMoveFail', { error: errText(err) }), 'error')); } else saveItem(fid, p); }
    if (dr.mode === 'item') return;
    for (const [id, p] of moved) setNodeLocal(id, p);
    if (snap) { api.call('dock.attach', { session: node.id, to: snap.targetId, side: snap.side, at: 'dock' }).catch(fail); return; }
    if (dr.mode === 'pull') { const p = moved.get(node.id); api.call('dock.remove', { session: node.id, x: Math.round(p.x), y: Math.round(p.y) }).catch(fail); return; }
    if (dr.mode === 'dock') { const d = st.docks.get(dr.dockId); const first = d && moved.get(d.members[0]); if (first) api.call('dock.update', { dock: dr.dockId, x: Math.round(first.x), y: Math.round(first.y) }).catch(fail); return; }
    for (const id of moved.keys()) saveNode(id, dr.mode === 'multi' ? 'drag-multi' : 'drag');
  }, [revert]);

  // P17: Ctrl+끌기(붙이기·떼기). React Flow의 끌기(고른 노드 모두 함께)를 쓰지 않고 그 노드만 움직인다.
  // 머리줄(.mt-drag)을 Ctrl과 함께 누르면 mousedown을 캔버스에서 먼저 받아 React Flow에 넘기지 않는다. 4px 안에서 놓으면 누르기라
  // React Flow의 Ctrl+누르기(고르기)가 그대로 돈다. 끌었으면 그 뒤의 click은 삼킨다
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    let cd = null, swallow = false;
    const place = (pos, zone) => {
      ghostRef.current = zone ? { ...zone.preview, kind: zone.at, side: zone.side } : null;
      setNodes((ns) => rederive(ns.map((n) => (n.id === cd.id ? { ...n, position: pos, dragging: true, zIndex: 5000, className: `${String(n.className || '').replace(/\s*ctrl-drag/g, '')} ctrl-drag` } : n)), ghostRef.current, cd.id));
    };
    const onMove = (e) => {
      if (!cd) return;
      if (!cd.started) {
        if (Math.hypot(e.clientX - cd.sx, e.clientY - cd.sy) < CTRL_MIN_PX) return;
        cd.started = true; ctrlRef.current = cd.id;
        perfLog('drag_start', { id: cd.id, type: 'session', mode: 'ctrl', docked: !!dockOf(cd.id) });
      }
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      cd.p = p;
      cd.pos = { x: p.x - cd.grab.x, y: p.y - cd.grab.y };
      cd.zone = dropZone(p, ctrlBlocks(cd.id), { band: EDGE_PX / rf.getViewport().zoom, drag: { w: cd.rect0.w, h: cd.rect0.h } });
      place(cd.pos, cd.zone);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true); window.removeEventListener('mouseup', onUp, true);
      const c = cd; cd = null;
      if (!c) return;
      swallow = true; setTimeout(() => { swallow = false; }, 80);
      // mousedown을 위에서 가로챘으므로 React Flow의 선택도 여기서 끝낸다.
      if (!c.started) {
        setNodes((ns) => ns.map((n) => n.id === c.id ? { ...n, selected: !n.selected } : n));
        return;
      }
      ctrlRef.current = null; ghostRef.current = null;
      const st = getState();
      const d = dockOf(c.id);
      const pos = { x: Math.round(c.pos.x), y: Math.round(c.pos.y) };
      const fail = (err) => { toast(err.message, 'error'); loadBoard().catch(() => {}); };
      perfLog('drag_stop', { id: c.id, mode: 'ctrl', zone: c.zone ? `${c.zone.at}:${c.zone.side}:${c.zone.target}` : null, docked: !!d, p: { x: Math.round(c.p.x), y: Math.round(c.p.y) } });
      setNodes((ns) => ns.map((n) => (n.id === c.id ? { ...n, dragging: false } : n)));
      const back = () => setRev((x) => x + 1);
      if (c.zone) { api.call('dock.attach', { session: c.id, to: c.zone.target, side: c.zone.side, at: c.zone.at }).catch(fail).finally(back); return; }
      // 덩어리 안 노드를 제 자리(구멍) 위에 놓으면 그대로 둔다
      if (d && c.p.x >= c.rect0.x && c.p.x <= c.rect0.x + c.rect0.w && c.p.y >= c.rect0.y && c.p.y <= c.rect0.y + c.rect0.h) return back();
      const moved = new Map([[c.id, pos]]);
      const after = overlapPairs([...st.nodes].filter(([id]) => st.sessions.has(id)).map(([id, r]) => ({ id, ...r, ...(moved.get(id) || {}) })), st);
      if ([...after].some((x) => !c.before.has(x))) { back(); toast(tr('canvas.overlapDrag'), 'error'); return; }
      setNodeLocal(c.id, pos);
      if (d) { api.call('dock.remove', { session: c.id, x: pos.x, y: pos.y }).catch(fail).finally(back); return; }
      saveNode(c.id, 'drag-ctrl');
      back();
    };
    const onDown = (e) => {
      if (e.button !== 0 || !e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      const t = e.target;
      if (!t || !t.closest || !t.closest('.mt-drag') || t.closest('button, input, textarea, select, a, .nodrag')) return;
      const nodeEl = t.closest('.react-flow__node-session');
      const id = nodeEl && nodeEl.getAttribute('data-id');
      const st = getState();
      const r = id && st.nodes.get(id);
      if (!r || !st.sessions.has(id)) return;
      e.stopPropagation();
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      cd = { id, sx: e.clientX, sy: e.clientY, rect0: { x: r.x, y: r.y, w: r.w, h: r.h }, grab: { x: p.x - r.x, y: p.y - r.y }, started: false, zone: null, p, pos: { x: r.x, y: r.y },
        before: overlapPairs([...st.nodes].filter(([x]) => st.sessions.has(x)).map(([x, rr]) => ({ id: x, ...rr }))) };
      window.addEventListener('mousemove', onMove, true); window.addEventListener('mouseup', onUp, true);
    };
    const onClick = (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; } };
    el.addEventListener('mousedown', onDown, true);
    el.addEventListener('click', onClick, true);
    return () => { el.removeEventListener('mousedown', onDown, true); el.removeEventListener('click', onClick, true); window.removeEventListener('mousemove', onMove, true); window.removeEventListener('mouseup', onUp, true); };
  }, [rf]);

  const recompute = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const vp = rf.getViewport();
    const st = getState();
    // P21: 잠든 세션은 패널이 없어 터미널을 붙이지 않는다(깨면 starting이 되어 붙는다)
    // P76: 전체 보기가 연 세션은 전체 보기가 터미널을 붙인다(한 창에서 한 패널을 두 번 붙이지 않는다)
    const full = fullId();
    for (const id of held.current.keys()) if (id === full) held.current.delete(id);
    const list = [...st.nodes].filter(([id]) => st.sessions.has(id) && st.sessions.get(id).state !== 'sleeping' && id !== full).map(([id, r]) => ({ id, x: r.x, y: r.y, w: r.w, h: r.h }));
    // 이슈 #1-16: 상한보다 많이 보여도 고른 노드와 초점 노드는 터미널을 먼저 받는다
    const want = pickAttached(list, vp, { width: el.clientWidth, height: el.clientHeight }, { max: MAX_CONTROLLERS, prev: new Set(st.attached), focus: st.focusId, selected: new Set(st.selected) });
    // P24: 가까이 얼굴로 보이는 노드 모두(잠든 노드, 제어기 상한 밖 포함)는 그 리포를 보고 있는 것이다(저절로 잠재우지 않는다)
    const all = [...st.nodes].filter(([id]) => st.sessions.has(id)).map(([id, r]) => ({ id, x: r.x, y: r.y, w: r.w, h: r.h }));
    setCloseIds(pickAttached(all, vp, { width: el.clientWidth, height: el.clientHeight }, { max: Infinity }).sort());
    const now = Date.now();
    for (const id of want) held.current.set(id, now);
    const keep = [...want];
    for (const [id, t] of held.current) {
      if (keep.includes(id)) continue;
      if (now - t < HOLD_MS && keep.length < MAX_CONTROLLERS && list.some((n) => n.id === id)) keep.push(id);
      else held.current.delete(id);
    }
    if (full) keep.length = 0; // P84: 전체 보기가 화면을 덮는 동안 판의 터미널은 붙이지 않는다(가려진 터미널의 메모리)
    if (!PLAN.terms) keep.length = 0; // P86 단계 1부터: 보드에는 터미널을 붙이지 않는다(얼굴만, 전체 보기는 그대로)
    const prev = st.attached;
    if (keep.length !== prev.length || keep.some((x, i) => x !== prev[i])) { perfLog('attach_set', { n: keep.length, prev: prev.length, zoom: +vp.zoom.toFixed(4), w: el.clientWidth, h: el.clientHeight, nodes: list.length }); step('att', { n: keep.length, z: vp.zoom }); }
    setAttached(keep);
  }, [rf]);

  const timer = useRef(null);
  const schedule = useCallback((ms = 200) => { clearTimeout(timer.current); timer.current = setTimeout(recompute, ms); }, [recompute]);
  const focusId = useStore((st) => st.focusId);
  const selectedIds = useStore((st) => st.selected);
  useEffect(() => { schedule(50); }, [storeNodes, sessions, focusId, selectedIds, schedule]);
  useEffect(() => {
    const t = setInterval(() => recompute(), HOLD_MS + 100);
    const resize = () => schedule(); window.addEventListener('resize', resize);
    return () => { clearInterval(t); clearTimeout(timer.current); window.removeEventListener('resize', resize); };
  }, [recompute, schedule]);

  const sizeOf = () => { const el = wrapRef.current; return el ? { width: el.clientWidth, height: el.clientHeight } : null; };
  const saveVp = useRef(null);
  const onMoveEnd = useCallback((e, vp) => {
    // 화면 이동이 사람 손(휠, 끌기)인지 코드인지 남긴다. 사람이 배율을 바꾸면 얼굴과 붙은 터미널이 바뀐다(E5 2.5 조사)
    perfLog('viewport', { by: e ? e.type : 'code', zoom: +vp.zoom.toFixed(4), x: Math.round(vp.x), y: Math.round(vp.y) });
    schedule(100);
    setViewNow(vp, sizeOf());
    clearTimeout(saveVp.current);
    saveVp.current = setTimeout(() => api.call('board.setViewport', { x: Math.round(vp.x), y: Math.round(vp.y), zoom: +vp.zoom.toFixed(3) }).catch(() => {}), 300);
  }, [schedule]);
  const lastLive = useRef(0);
  const onMove = useCallback((_e, vp) => {
    schedule(250);
    const now = Date.now();
    if (now - lastLive.current > 120) { lastLive.current = now; setViewNow(vp, sizeOf()); }
  }, [schedule]);

  // P52(#5): 캔버스 위에 떠 있는 크롬(위 알약, 왼쪽·오른쪽 레일, 보이는 아래 바)이 덮는 가장자리 여백
  // P73: gap은 크롬과 맞출 사각형 사이(눌러서 확대는 NAV_GAP으로 더 좁게). nav면 오른쪽 아래 배율 단추도 아래 크롬으로 본다(꽉 채운 노드의 구석을 덮지 않게)
  const insetNow = useCallback((gap = 12, nav = false) => {
    const el = wrapRef.current;
    if (!el) return {};
    const q = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    return chromeInset(el.getBoundingClientRect(), { top: q('[data-role="top-left"], [data-role="top-right"], [data-role="selection"]'), left: q('[data-role="rail-left"]'), right: q('[data-role="rail-right"]'), bottom: q(`[data-role="bottom"]:not([data-hidden]), [data-role="chips"]:not([data-hidden])${nav ? ', [data-role="zoom"]' : ''}`) }, { gap });
  }, []);
  // 전체가 화면에 들어오게(처음 열 때, "전체" 단추). 소속 없는 메모·칸반도 넣는다. P52: 떠 있는 크롬 밑은 빼고 맞춘다
  const fitAll = useCallback((duration = 0) => {
    const el = wrapRef.current;
    if (!el) return;
    const rects = [...allRegions().values(), ...itemRects().filter((r) => !r.ws)];
    const vp = fitInset(boundsOf(rects, 40), { width: el.clientWidth, height: el.clientHeight }, insetNow(), { minZoom: 0.05, maxZoom: 1 });
    perfLog('fit_all', { regions: rects.length, zoom: vp ? +vp.zoom.toFixed(3) : null });
    rf.setViewport(vp || { x: 40, y: 80, zoom: 0.75 }, { duration });
    setTimeout(() => setViewNow(rf.getViewport(), sizeOf()), duration + 30);
    schedule(duration + 100);
  }, [rf, schedule, insetNow]);
  // 처음 열 때: 저장한 뷰포트가 없으면(처음, P5 판을 옮긴 뒤) 모두 보이게 맞춘다
  useEffect(() => { const t = setTimeout(() => { if (!getState().viewport) fitAll(0); else setViewNow(rf.getViewport(), sizeOf()); const v = rf.getViewport(); step('fit', { z: v.zoom, x: v.x, y: v.y, saved: getState().viewport ? 1 : 0 }); }, 80); return () => clearTimeout(t); }, [fitAll, rf]);
  // P86: 보드 첫 그리기(React가 노드를 붙인 뒤, 다음 화면 그리기 뒤). 그린 노드 수와 DOM 수
  const painted = useRef(false);
  useEffect(() => {
    if (painted.current || !nodes.length) return;
    painted.current = true;
    const count = (t) => nodes.filter((n) => n.type === t).length;
    step('paint', { n: nodes.length, ss: count('session'), cv: count('convo'), e: edges.length, dom: document.getElementsByTagName('*').length, lv: PLAN.level });
    requestAnimationFrame(() => setTimeout(() => step('frame', { dom: document.getElementsByTagName('*').length }), 0));
  }, [nodes, edges]);

  // 화면을 노드로 옮긴다. 노드는 움직이지 않는다. 배율은 터미널이 가까이 얼굴이 되도록(이미 0.9~1.5면 그대로, 화면보다 크면 줄이되 가까이 얼굴까지)
  useEffect(() => {
    const st = getState();
    st.setViewport = (vp) => { rf.setViewport(vp); schedule(100); }; // 시험(E5)에서 쓴다
    st.viewCenter = () => { const el = wrapRef.current; const r = el.getBoundingClientRect(); return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); };
    st.fitAll = fitAll;
    // P11: 줌 알약의 − +. 화면 가운데를 축으로 배율만 바꾼다
    st.zoomBy = (f) => {
      const el = wrapRef.current;
      const vp = rf.getViewport();
      const zoom = Math.min(2, Math.max(0.05, vp.zoom * f));
      const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
      const next = { x: cx - ((cx - vp.x) * zoom) / vp.zoom, y: cy - ((cy - vp.y) * zoom) / vp.zoom, zoom };
      rf.setViewport(next, { duration: 150 });
      setTimeout(() => setViewNow(rf.getViewport(), sizeOf()), 200);
      schedule(250);
    };
    st.navigateToRect = (r, duration = 250) => { const el = wrapRef.current; const vp = fitInset(r, { width: el.clientWidth, height: el.clientHeight }, insetNow(), { minZoom: 0.05, maxZoom: 1, fill: 0.92 }); if (vp) rf.setViewport(vp, { duration }); setTimeout(() => setViewNow(rf.getViewport(), sizeOf()), duration + 50); schedule(duration + 50); };
    // P27: 리포로 가면 워크트리 영역까지 들어오게
    const repoRect = (key) => bbox([...allRegions()].filter(([k]) => wsOfArea(k) === key).map(([, r]) => r));
    st.fitWorkspace = (key) => { const r = repoRect(key); if (r) st.navigateToRect(r); };
    st.fitWorkspaces = (keys) => { const r = bbox(keys.map(repoRect).filter(Boolean)); if (r) st.navigateToRect(keys.length > 1 ? groupFrameOf(r) : r); }; // P98: 위 바의 묶음 칩(구성 영역 모두와 묶음 테두리·이름표)
    st.regionOf = (key) => repoRect(key) || null;
    // P6c: 점(판 좌표)이 든 워크스페이스 영역(새 메모·칸반의 소속), 메모·칸반 노드로 가기(검색). 간 노드는 2초 동안 빛난다
    st.regionAt = (p) => wsAt({ x: p.x, y: p.y, w: 0, h: 0 }, mainOnly(allRegions())); // P27: 메모·칸반은 본 저장소 영역에만
    st.navigateToItem = (fid) => {
      const it = itemOf(fid);
      if (!it) return;
      st.navigateToRect({ x: it.x, y: it.y, w: it.w, h: it.h });
      if (it.workspaceKey) noteWorkspace(it.workspaceKey);
      const mark = (on) => setNodes((ns) => ns.map((n) => (n.id === fid ? { ...n, className: on ? 'flash' : '' } : n)));
      mark(true);
      setTimeout(() => mark(false), 2000);
    };
    // P50(#6): 메모 편집을 열 화면(lib/memo-edit.js). 먼 얼굴이거나 화면 밖이면 그 메모로 옮긴다
    st.showMemoForEdit = (r) => {
      const el = wrapRef.current;
      if (!el) return;
      const v = memoEditView({ memo: r, viewport: rf.getViewport(), screen: { width: el.clientWidth, height: el.clientHeight } });
      if (!v) return;
      rf.setCenter(v.cx, v.cy, { zoom: v.zoom, duration: 250 });
      setTimeout(() => setViewNow(rf.getViewport(), sizeOf()), 300);
      schedule(300);
    };
    st.clearSelection = () => setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    // P26: 노드(덩어리 안이면 덩어리 전체)가 화면의 85%를 채우게(배율 상한 1, lib/nav.js). 이미 그 노드를 보고 있으면 화면은 그대로다.
    // viewOnly: 화면만 옮기고 터미널 초점은 건드리지 않는다(머리줄 누르기, 터미널 안 누르기)
    st.navigateTo = (id, { focusTerminal = false, viewOnly = false } = {}) => {
      clearTimeout(focusTimer.current);
      getState().pendingInput = null;
      const r = getState().nodes.get(id);
      if (!r) return;
      const el = wrapRef.current;
      const s = getState().sessions.get(id);
      if (s) noteWorkspace(s.workspaceKey);
      if (focusTerminal) setPendingInput(id); // H4: 터미널이 붙기 전에 친 글을 모은다
      if (focusTerminal && s && s.state === 'sleeping') wakeSession(id, { why: 'click' }); // P21(D4): 눌러 들어가면 깨운다(깬 뒤 터미널이 붙는다)
      // P10: 덩어리 안의 노드면 덩어리 전체가 들어오게(lib/nav.js). 초점과 터미널 입력은 누른 노드로 간다
      const d = dockOf(id);
      const dock = d ? dockRect(d.members.map((m) => getState().nodes.get(m))) : null;
      const screen = { width: el.clientWidth, height: el.clientHeight };
      const vp = rf.getViewport();
      const inset = insetNow(NAV_GAP, true);
      const v = enterView({ node: r, dock, screen, inset }); // P73: 크롬(과 NAV_GAP 틈)을 뺀 남은 칸을 NAV_FILL까지 채운다
      const seen = isViewing({ node: r, dock, view: v, viewport: vp, screen, inset });
      perfLog('navigate', { id, mode: v.mode, zoom: +v.zoom.toFixed(3), dock: d ? d.members.length : 0, seen, viewOnly });
      if (!seen) {
        rf.setCenter(v.cx, v.cy, { zoom: v.zoom, duration: 250 });
        setTimeout(() => setViewNow(rf.getViewport(), sizeOf()), 300);
        schedule(300);
      }
      enterSession(id);
      setFocus(id, { terminal: focusTerminal && !viewOnly });
      if (seen) schedule(0);
      markSeen(id);
      if (focusTerminal && !viewOnly) focusTimer.current = setTimeout(() => {
        const current = getState();
        if (current.focusId === id && current.sessions.has(id) && !current.dialog && !current.searchOpen && (document.activeElement === document.body || document.activeElement?.closest('.xterm'))) setFocus(id, { terminal: true });
      }, 700); // 다른 세션·입력칸으로 간 뒤에는 초점을 되찾지 않는다
    };
  }, [rf, schedule, fitAll, insetNow]);

  // P76: 터치(손가락)는 판이 캡처 단계에서 모두 받아 React Flow·터미널(xterm)에 넘기지 않고 lib/touch-board.js 규칙대로 가른다. 마우스는 이 길로 오지 않는다.
  //   한 손가락 끌기 = 판 옮기기(노드·터미널 위에서 시작해도), 두 손가락 = 확대·축소, 길게 누른 뒤 끌기 = 노드(덩어리면 덩어리) 옮기기(마우스 끌기와 같은 처리),
  //   탭 = 휴대폰 세로면 전체 보기(PhoneFull.jsx), 그 밖이면 그 노드로 확대(터미널 초점 없음). 노드 안의 단추·입력칸을 탭하면 그것을 누른다.
  //   터치로 쓰는 보드 화면에서는 터미널에 글을 치지 않는다(가상 키보드를 띄우지 않는다. 입력은 전체 보기에서)
  useEffect(() => {
    const st = getState();
    st.touchTap = (id, target) => {
      const s = getState().sessions.get(id);
      if (!s) return;
      if (tapAction({ width: window.innerWidth, height: window.innerHeight, coarse: true }) === 'full') {
        const nodeEl = target && target.closest ? target.closest('.react-flow__node') : null;
        const r = nodeEl ? nodeEl.getBoundingClientRect() : null;
        noteWorkspace(s.workspaceKey); enterSession(id); setFocus(id); markSeen(id);
        perfLog('touch_full', { id });
        openFull(id, r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null);
        return;
      }
      getState().navigateTo(id, { viewOnly: true });
    };
    return () => { delete st.touchTap; };
  }, []);
  useEffect(() => onFull(() => schedule(fullId() ? 0 : 250)), [schedule]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    let g = null;
    const coarse = (() => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } })();
    const pts = (e) => [...e.touches].map((t) => ({ x: t.clientX, y: t.clientY }));
    const commit = () => onMoveEnd(null, rf.getViewport());
    const lift = (on) => { if (g && g.nodeEl) g.nodeEl.classList.toggle('touch-lift', on); };
    const clearTimer = () => { if (g) clearTimeout(g.timer); };
    const startHold = () => {
      if (!g || g.mode !== 'pending' || !g.moveId) return;
      const node = nodesRef.current.find((n) => n.id === g.moveId);
      if (!node) { g.mode = 'dead'; return; }
      g.mode = 'hold'; g.node = node; g.pos0 = { ...node.position }; g.pos = { ...node.position };
      g.nodeEl = el.querySelector(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`);
      lift(true);
      try { if (navigator.vibrate) navigator.vibrate(15); } catch {}
      onNodeDragStart({ clientX: g.start.x, clientY: g.start.y, altKey: false }, node, [node]);
      perfLog('touch_hold', { id: node.id });
    };
    const begin = (p, target) => {
      clearTimer();
      const tt = tapTarget(target);
      g = { mode: 'pending', start: p, last: p, t0: performance.now(), target, tt, moveId: movableId(tt), vp0: rf.getViewport() };
      if (g.moveId) g.timer = setTimeout(startHold, LONG_PRESS_MS);
    };
    const onStart = (e) => {
      e.preventDefault(); e.stopPropagation(); // 끌기·확대(React Flow), 초점·선택(xterm), 페이지 확대·스크롤, 늦게 오는 마우스 흉내 이벤트를 모두 막는다
      const a = document.activeElement;
      if (a && a.closest && a.closest('.xterm')) a.blur(); // 터치 보드에서는 터미널에 치지 않는다(키보드를 내린다)
      const p = pts(e);
      if (p.length === 1) return begin(p[0], e.target); // 손가락 하나만 닿았으면 새 동작
      if (!g) return;
      if (p.length >= 2 && g.mode !== 'hold') {
        clearTimer();
        g = { mode: 'pinch', vp0: rf.getViewport(), m0: mid(p[0], p[1]), d0: Math.max(1, gap2(p[0], p[1])) };
      }
    };
    const onMove = (e) => {
      if (!g) return;
      e.preventDefault(); e.stopPropagation();
      const p = pts(e);
      if (g.mode === 'pinch') {
        if (p.length < 2) return;
        rf.setViewport(pinchViewport(g.vp0, g.m0, g.d0, mid(p[0], p[1]), gap2(p[0], p[1]), { minZoom: 0.05, maxZoom: 2 }));
        return;
      }
      if (!p.length) return;
      const q = p[0];
      g.last = q;
      const dx = q.x - g.start.x, dy = q.y - g.start.y;
      if (g.mode === 'pending') {
        const k = oneFinger({ dist: Math.hypot(dx, dy), dt: performance.now() - g.t0, onNode: !!g.moveId });
        if (k === 'pan') { clearTimer(); g.mode = 'pan'; } // 판은 누른 자리부터 손가락을 그대로 따라간다
        if (k === 'hold') startHold();
      }
      if (g.mode === 'pan') rf.setViewport(panViewport(g.vp0, dx, dy));
      else if (g.mode === 'hold') {
        const z = rf.getViewport().zoom;
        g.pos = { x: g.pos0.x + dx / z, y: g.pos0.y + dy / z };
        onNodesChange([{ id: g.node.id, type: 'position', position: g.pos, dragging: true }]);
      }
    };
    const onEnd = (e) => {
      if (!g) return;
      e.preventDefault(); e.stopPropagation();
      const left = pts(e);
      if (g.mode === 'pinch') {
        if (left.length === 1) { g = { mode: 'pan', start: left[0], last: left[0], vp0: rf.getViewport(), t0: 0 }; return; } // 남은 손가락으로 이어서 옮긴다
        if (!left.length) { commit(); g = null; }
        return;
      }
      if (left.length) return;
      clearTimer();
      const gg = g; g = null;
      const kind = releaseKind({ mode: gg.mode, dist: Math.hypot(gg.last.x - gg.start.x, gg.last.y - gg.start.y), dt: performance.now() - gg.t0 });
      if (kind === 'pan') return commit();
      if (kind === 'hold') {
        if (gg.nodeEl) gg.nodeEl.classList.remove('touch-lift');
        const node = { ...gg.node, position: gg.pos };
        onNodesChange([{ id: node.id, type: 'position', position: gg.pos, dragging: false }]);
        onNodeDragStop({ clientX: gg.last.x, clientY: gg.last.y }, node, [node]);
        return;
      }
      if (kind !== 'tap') return;
      const t = gg.tt;
      perfLog('touch_tap', { kind: t.kind, id: t.id || null });
      if (t.kind === 'control') {
        const c = gg.target.closest(TAP_CONTROL);
        if (c.matches('input, textarea, select, [contenteditable="true"]')) c.focus(); else c.click();
        return;
      }
      if (t.kind === 'session') { getState().touchTap(t.id, gg.target); return; }
      // 메모·칸반·대화 노드, 영역 이름표, 빈 판: 그 자리를 누른 것으로(React Flow의 누르기 처리)
      gg.target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: gg.start.x, clientY: gg.start.y }));
    };
    const onCancel = (e) => { if (!g) return; e.stopPropagation(); clearTimer(); if (g.mode === 'hold') { lift(false); g = null; setRev((x) => x + 1); drag.current = null; ghostRef.current = null; return; } if (g.mode === 'pan' || g.mode === 'pinch') commit(); g = null; };
    const cap = { capture: true, passive: false };
    el.addEventListener('touchstart', onStart, cap);
    el.addEventListener('touchmove', onMove, cap);
    el.addEventListener('touchend', onEnd, cap);
    el.addEventListener('touchcancel', onCancel, cap);
    // 페이지 자체가 확대되지 않게(iOS Safari는 user-scalable을 무시한다): 캔버스 밖 크롬 위의 두 손가락과 iOS 확대 동작
    const noGesture = (e) => e.preventDefault();
    const noPinch = (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); };
    document.addEventListener('gesturestart', noGesture, { passive: false });
    document.addEventListener('touchmove', noPinch, { passive: false });
    // 손가락 기기에서는 판의 터미널이 가상 키보드를 띄우지 않는다
    if (coarse) document.documentElement.classList.add('mt-touch-board'); // phone.css: 페이지 고무줄·확대 끄기
    const quiet = coarse ? setInterval(() => { for (const ta of el.querySelectorAll('.xterm-helper-textarea:not([inputmode="none"])')) ta.setAttribute('inputmode', 'none'); }, 500) : 0;
    return () => {
      clearTimer(); clearInterval(quiet); document.documentElement.classList.remove('mt-touch-board');
      el.removeEventListener('touchstart', onStart, cap); el.removeEventListener('touchmove', onMove, cap); el.removeEventListener('touchend', onEnd, cap); el.removeEventListener('touchcancel', onCancel, cap);
      document.removeEventListener('gesturestart', noGesture); document.removeEventListener('touchmove', noPinch);
    };
  }, [rf, onMoveEnd, onNodeDragStart, onNodeDragStop, onNodesChange]);

  // H4: 노드 본문을 누르면(어느 얼굴이든) 들어간다. 단추, 입력칸, 카드를 누른 것과 여러 개 고르기(Ctrl, Shift)는 빼고.
  // P26: 머리줄, 본문, 터미널 안, 멀리·아이콘 얼굴 어디를 누르든 화면을 그 노드(덩어리 안이면 덩어리 전체)로 옮긴다(이미 보고 있으면 그대로).
  const onNodeClick = useCallback((e, node) => {
    if (e.target.closest && e.target.closest('button, input, textarea, select, a, .mt-card, .mt-kill, .mt-interrupted, .mt-menu')) return;
    if (node.type === 'region' || node.type === 'wtarea') { selectWorkspace(node.data.wsKey); return; } // P27
    if (node.type !== 'session' || e.ctrlKey || e.shiftKey || e.metaKey) return;
    // 터미널 안을 누르면 화면만 옮긴다(초점은 터미널이 스스로 잡는다)
    // P38: 끌어 고른 뒤의 click과 두세 번 누르기에서는 가지 않는다. 한 번 누르기도 잠깐 기다려 두 번째 누르기·선택이 없을 때만 간다
    if (e.target.closest && e.target.closest('.mt-term-wrap')) {
      clearTimeout(termClickTimer);
      const sel = () => { const tm = terms.get(node.id); return !!(tm && tm.hasSelection()); };
      if (!termClickNavigates({ detail: e.detail, hasSelection: sel() })) return;
      termClickTimer = setTimeout(() => { if (termClickNavigates({ hasSelection: sel() })) getState().navigateTo(node.id, { viewOnly: true }); }, TERM_CLICK_WAIT);
      return;
    }
    // 머리줄을 누르면 고르기만 한다(터미널에 초점을 주지 않아 Delete로 닫을 수 있다). 화면은 옮긴다. 본문을 누르면 들어간다
    if (e.target.closest && e.target.closest('.mt-node-head')) { const a = document.activeElement; if (a && a.blur && a !== document.body) a.blur(); getState().navigateTo(node.id, { viewOnly: true }); return; }
    getState().navigateTo(node.id, { focusTerminal: true });
  }, []);
  const onSelectionChange = useCallback(({ nodes: sel }) => setSelected(sel.filter((n) => n.type === 'session').map((n) => n.id)), []);

  const defaultViewport = useMemo(() => initialViewport || { x: 40, y: 80, zoom: 0.75 }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-canvas" ref={wrapRef}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onConnect={onConnect} connectionRadius={40} connectionMode="loose"
        onNodesChange={onNodesChange} onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop} onNodeClick={onNodeClick} onSelectionChange={onSelectionChange}
        onMove={onMove} onMoveEnd={onMoveEnd}
        defaultViewport={defaultViewport} minZoom={0.05} maxZoom={2}
        deleteKeyCode={null} selectionKeyCode="Shift" multiSelectionKeyCode="Control"
        zoomOnDoubleClick={false} nodesConnectable elevateNodesOnSelect edgesFocusable={false} edgesReconnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        {/* P11: 점 격자는 월드 92px 간격, 점은 줌과 함께 커지고 작아진다(목업 --dot-gap). 줌 조절은 오른쪽 아래 줌 알약(Chrome.jsx ZoomPill) */}
        <Background variant={BackgroundVariant.Dots} gap={DOT_GAP} size={3.6} className="mt-dots" />
      </ReactFlow>
      <EmptyHint />
    </div>
  );
}
