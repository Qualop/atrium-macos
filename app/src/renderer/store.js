// 창의 상태: 세션 요약, 판 배치, 전달, 연결, 리포지토리 워크스페이스(P5), 붙여 묶기 덩어리(P6a). 백엔드 이벤트로 갱신하고 React는 useStore로 읽는다.
// P6a: 캔버스는 하나다. 모든 워크스페이스의 노드와 그룹을 한 캔버스에 그리고, 워크스페이스는 그 뒤에 깔린 영역이다(ARCH 4절 H1).
// currentWs는 "판을 바꾸는" 값이 아니라 마지막에 고른(가 본) 워크스페이스다. 새 세션 대화상자와 그룹의 기본 폴더에 쓴다.
// P6c: 메모·칸반 노드(I3·I4), Thread(I2), 루프(I5), 설정(I7), 출력 보기(I1)와 미션 맵(I6) 창을 연 상태.
import { useSyncExternalStore } from 'react';
import { api } from './api.js';
import { step } from './crash-watch.js'; // P86: 단계 기록
import { setLanguage, t, errText } from './lib/i18n.js';
import { readScale, saveScale, SCALE_KEYS } from './lib/scale.js'; // P45
import { loadSpot, saveSpot, applySpot } from './lib/overview.js'; // P85
import { applyWorkLight, applyMissionOpen } from './lib/work-light.js'; // P107: 작업 중 테두리 빛 설정과 미션 맵 덮개를 문서 뿌리에

const state = {
  conn: 'connecting',
  connDetail: null,
  herdr: { connected: null },
  sessions: new Map(), // sessionId → summary(backend summary)
  nodes: new Map(), // sessionId → { x, y, w, h, z, size }
  boardLoaded: false,
  viewport: null, // 저장한 캔버스 뷰포트(없으면 처음 열 때 모두 보이게 맞춘다)
  deliveries: new Map(), // deliveryId → delivery(+name, text)
  focusId: null, // N과 칩으로 마지막에 간 세션
  focusTick: 0, // 바뀌면 그 세션의 터미널에 초점을 준다
  attached: [], // 제어기를 붙인 세션(가까이 얼굴이면서 보이는 노드, 상한까지)
  closeIds: [], // P24: 화면에 가까이 얼굴로 보이는 노드 모두(잠든 노드와 상한 밖 포함). 백엔드가 그 리포를 "보는 중"으로 본다
  navigateTo: null, // Canvas가 넣는다: (id, { focusTerminal }) → 화면을 그 노드로
  toasts: [],
  // P3
  boardSeenAt: null, // A3: 판을 마지막으로 본 시각(백엔드 기록)
  resources: null, // D1
  clients: null, // D3: 판 전용 herdr 세션에 붙은 다른 화면
  peers: null, // P47: 이 백엔드에 붙은 창·웹 클라이언트 { clients, notify(알림 받을 클라이언트 ID), me }
  links: new Map(), // P4: linkId → 연결(누가 누구에게 시켰는지, 역할, 띄움)
  dialog: null, // { kind: 'spawn' | 'role' | 'link' | 'wsopen' | 'wsclose' | 'close', from?, to?, linkId?, cwd?, ids? }
  killAsk: null, // P22: { id, at } Delete 키로 그 노드의 닫기 확인(X와 같음)을 연다
  renaming: null, // P66: { id, where: 'node' | 'sidebar' } 이름을 바꾸는 세션과 입력칸 자리
  // P5: 리포지토리 워크스페이스
  workspaces: [], // [{ key, name, kind, root, createdAt, counts, x, y }] 처음 생긴 순서
  groups: [], // P44: 가상 그룹 [{ id, name, members: [워크스페이스 키] }](판 데이터 meta wsGroups)
  currentWs: null, // 마지막에 고른(가 본) 워크스페이스의 키
  vpNow: null, // 지금 캔버스의 뷰포트
  canvasSize: null,
  // P6a
  docks: new Map(), // dockId → { dockId, workspaceKey, dir: row | col, members: [sessionId] }
  selected: [], // 캔버스에서 고른 세션 노드(Ctrl+누르기, Shift+끌기 상자)
  pendingInput: null, // H4: { id, buf, at } 노드를 눌러 들어간 뒤 터미널이 붙기 전에 친 글
  arranged: new Set(), // H7: 이 창에서 정리한 워크스페이스(되돌리기 단추)
  searchOpen: false, // H2: Ctrl+F
  bottomShown: false, // P43: 아래 바가 보인다(평소에는 숨는다)
  bottomPin: (() => { try { return typeof sessionStorage !== 'undefined' && sessionStorage.getItem('mt.bottomPin') === '1'; } catch { return false; } })(), // P43: 창 시험이 아래 바를 늘 보이게 고정한다
  // P6c
  memos: new Map(), // memoId → { memoId, workspaceKey, x, y, w, h, text, color }
  kanbans: new Map(), // kanbanId → { kanbanId, workspaceKey, title, x, y, w, h, columns }
  thread: new Map(), // itemId → Thread 줄(시간순으로 넣는다)
  threadMore: false, // 더 앞의 줄이 있다
  threadBefore: null, // 다음 쪽을 읽을 seq
  threadOpen: false,
  loops: new Map(), // loopId → 루프
  settings: null, // { tray, language, … }. language를 받으면 화면 언어를 바꾼다(P16)
  launchers: null, // P33 호출자: { launchers: [{ id, name, harness, …, favorite, preview }], favorites: [id], harnesses }
  outputView: null, // { sessionId, turn } 출력 보기 창
  missionOpen: false, // 미션 맵 덮개
  itemSelected: null, // 캔버스에서 고른 메모·칸반 노드 id(memo:…, kanban:…)
  memoEdit: null, // P50(#6): 편집을 열 메모 id(메모 노드가 받아 편집을 열고 지운다)
  // P13: 판 밖 대화 노드(읽기 전용 카드)와 대화끼리의 띄움 선. 백엔드 recall.layoutCanvas가 만든다
  convoNodes: new Map(), // convId → { convId, workspaceKey, x, y, w, h, block, title, lastPrompt, lastAnswer, lastAt, binding, subagents, spawnedBy, … }
  convoEdges: [], // [{ id, from, to, via, name }] from·to는 세션 ID나 convo:<대화 ID>
  version: 0,
};
const subs = new Set();
// P16: 설정의 language를 화면 언어로. 언어가 바뀌면 사전을 쓰는 화면이 다시 그린다(lib/i18n.js)
// P107: workLight(작업 중 테두리 빛: 판 노드 둘레와 미션 맵 카드)를 문서 뿌리 data-work-light로(PC 창·웹·휴대폰 같은 판 설정)
function putSettings(s) { state.settings = s; if (s && s.language) setLanguage(s.language); applyWorkLight(s); changed(); }
function changed() { state.version++; for (const fn of [...subs]) fn(); }

export function useStore(select) {
  return useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => select(state));
}
export const getState = () => state;
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

export function toast(text, kind = 'info') {
  const t = { id: Math.random().toString(36).slice(2), text, kind };
  state.toasts = [...state.toasts, t].slice(-4);
  changed();
  setTimeout(() => { state.toasts = state.toasts.filter((x) => x !== t); changed(); }, kind === 'error' ? 8000 : 4000);
}

function putSession(sum) {
  state.sessions = new Map(state.sessions);
  state.sessions.set(sum.sessionId, sum);
  changed();
}

// 요청 중에 받은 이벤트·사용자 이동은 이전 스냅샷보다 새롭다. 삭제도 보존한다.
function mergeSnapshot(before, current, incoming) {
  for (const [id, value] of current) if (before.get(id) !== value || !before.has(id)) incoming.set(id, value);
  for (const id of before.keys()) if (!current.has(id)) incoming.delete(id);
  return incoming;
}
const layoutEdits = new Set();
export function beginLayoutEdit(nodes, dock) {
  const edit = { nodes, dock }; layoutEdits.add(edit);
  return () => layoutEdits.delete(edit);
}
let boardRequest = 0;
export async function loadBoard() {
  const request = ++boardRequest, generation = api.generation;
  const before = { ...state };
  const editing = [...layoutEdits];
  const b = await api.call('board.get');
  // P6c: 메모·칸반. board.get에 없으면(P6b 전 백엔드) 따로 읽는다
  const memos = b.memos || await api.call('memo.list').catch(() => []);
  const kanbans = b.kanbans || await api.call('kanban.list').catch(() => []);
  if (request !== boardRequest || generation !== api.generation) return;
  const put = (key, entries) => {
    const current = state[key], next = mergeSnapshot(before[key], current, new Map(entries));
    // 분할선을 잡은 동안은 요청 전에 바꾼 자리도 아직 저장 전이다.
    for (const edit of [...editing, ...layoutEdits]) {
      const ids = key === 'nodes' ? edit.nodes : key === 'docks' ? [edit.dock] : [];
      for (const id of ids) { if (current.has(id)) next.set(id, current.get(id)); else next.delete(id); }
    }
    state[key] = next;
  };
  put('nodes', b.nodes.map((n) => [n.session_id, { x: n.x, y: n.y, w: n.w, h: n.h, z: n.z, size: n.size || null, area: n.area || '', aspect: n.aspect || null }])); // P27
  put('links', (b.links || []).map((l) => [l.linkId, l]));
  put('docks', (b.docks || []).map((d) => [d.dockId, d]));
  put('memos', memos.map((m) => [m.memoId, m]));
  put('kanbans', kanbans.map((k) => [k.kanbanId, k]));
  if (b.workspaces && state.workspaces === before.workspaces) state.workspaces = b.workspaces;
  if (b.groups && state.groups === before.groups) state.groups = b.groups;
  if (b.convoNodes) {
    put('convoNodes', b.convoNodes.map((c) => [c.convId, c]));
    if (state.convoEdges === before.convoEdges) state.convoEdges = b.convoEdges || [];
  }
  if (!state.boardLoaded || !state.workspaces.some((w) => w.key === state.currentWs)) state.currentWs = b.current || (state.workspaces[0] || {}).key || null;
  if (!state.boardLoaded) { state.viewport = b.viewport || null; state.boardSeenAt = b.seenAt || null; }
  // P86: 판 상태 적용(종류별 수, 그리기 전). 웹 화면만 적는다
  step('board', { n: state.nodes.size, ss: state.sessions.size, cv: state.convoNodes.size, ce: state.convoEdges.length, m: state.memos.size, kb: state.kanbans.size, l: state.links.size, ws: state.workspaces.length });
  state.boardLoaded = true;
  changed();
}

export function openDialog(d) { state.dialog = d; changed(); }

// 워크스페이스로 가기(H2): 그 영역이 화면에 들어오게 맞춘다. 캔버스는 하나라 판을 바꾸지 않는다
export function selectWorkspace(key) {
  if (!key) return;
  const moved = key !== state.currentWs;
  state.currentWs = key;
  changed();
  if (moved) api.call('workspace.select', { workspace: key }).catch(() => {});
  if (state.fitWorkspace) state.fitWorkspace(key);
}
// P98: 위 바의 묶음 칩. pick을 지금 워크스페이스로 고르고(새 세션 폴더 등), 화면은 묶음 구성 영역 모두에 맞춘다
export function selectGroup(keys, pick) {
  if (!pick) return;
  const moved = pick !== state.currentWs;
  state.currentWs = pick;
  changed();
  if (moved) api.call('workspace.select', { workspace: pick }).catch(() => {});
  if (state.fitWorkspaces) state.fitWorkspaces(keys && keys.length ? keys : [pick]);
  else if (state.fitWorkspace) state.fitWorkspace(pick);
}
// 노드로 갔을 때 그 워크스페이스를 기본으로(새 세션 대화상자의 폴더)
export function noteWorkspace(key) {
  if (!key || key === state.currentWs) return;
  state.currentWs = key; changed();
  api.call('workspace.select', { workspace: key }).catch(() => {});
}
export const wsOf = (id) => { const s = state.sessions.get(id); return s ? s.workspaceKey || null : null; };
export const wsName = (key) => { const w = state.workspaces.find((x) => x.key === key); return w ? w.name : key ? String(key).split('/').filter(Boolean).slice(-2, -1)[0] || key : '?'; };
export function setViewNow(vp, size) {
  const a = state.vpNow;
  if (a && vp && a.x === vp.x && a.y === vp.y && a.zoom === vp.zoom && size && state.canvasSize && state.canvasSize.width === size.width && state.canvasSize.height === size.height) return;
  state.vpNow = vp; if (size) state.canvasSize = size; changed();
}
export function setKillAsk(id) { state.killAsk = id ? { id, at: Date.now() } : null; changed(); }
export function setRenaming(id, where = 'node') { state.renaming = id ? { id, where } : null; changed(); } // P66
// 시험용(P3, 노드 오류 경계): 이 세션 노드가 그릴 때 일부러 오류를 낸다. 창 안의 window.__mt.setDebugThrow로만 켠다
export function setDebugThrow(id) { state.debugThrow = id; changed(); }

// P27: 영역을 끈 뒤 워크트리 영역 자리를 창에서 먼저 옮긴다(백엔드가 board.changed로 다시 준다). wt가 없으면 그 리포의 워크트리 영역 모두
export function shiftAreasLocal(wsKey, wt, dx, dy) {
  state.workspaces = state.workspaces.map((w) => (w.key !== wsKey || !w.worktrees ? w : { ...w, worktrees: w.worktrees.map((a) => (!wt || a.wt === wt ? { ...a, x: a.x + dx, y: a.y + dy } : a)) }));
  changed();
}
export function setNodeLocal(id, rect) {
  const prev = state.nodes.get(id) || {};
  state.nodes = new Map(state.nodes);
  state.nodes.set(id, { ...prev, ...rect });
  changed();
}
// 여러 노드를 한 번에(분할선, 덩어리 옮기기)
export function setNodesLocal(entries) {
  state.nodes = new Map(state.nodes);
  for (const [id, rect] of entries) state.nodes.set(id, { ...(state.nodes.get(id) || {}), ...rect });
  changed();
}

// cause: 왜 옮겼는지. 백엔드가 자리가 바뀐 기록(node_moved)에 함께 남긴다(P5 5절 2번: 설명하지 못한 노드 이동)
export function saveNode(id, cause = 'unknown') {
  const n = state.nodes.get(id);
  if (!n) return;
  api.call('board.setNode', { session: id, x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.w), h: Math.round(n.h), z: n.z || 0, cause }).catch((e) => toast(t('store.saveNodeFailed', { error: errText(e) }), 'error'));
}

// 새로 띄우거나 판으로 연 세션이 판에 올라오면 그 노드로 들어간다(터미널에 초점)
export function goWhenOpen(sessionId) {
  const t0 = Date.now();
  const tick = () => {
    if (state.sessions.has(sessionId) && state.nodes.has(sessionId) && state.navigateTo) return state.navigateTo(sessionId, { focusTerminal: true });
    if (Date.now() - t0 < 15000) setTimeout(tick, 200);
  };
  tick();
}
export function setFocus(id, { terminal = false } = {}) { state.focusId = id; if (terminal) state.focusTick++; changed(); }
export function setCloseIds(list) {
  if (list.length === state.closeIds.length && list.every((x, i) => x === state.closeIds[i])) return;
  state.closeIds = list; changed();
}
export function setAttached(list) {
  if (list.length === state.attached.length && list.every((x, i) => x === state.attached[i])) return;
  state.attached = list; changed();
}
// 기다리는 요청 하나를 가리키는 열쇠(toolUseId, 없으면 시작 시각). P104: 휴대폰 키 패드가 요청마다 펼침을 새로 정한다
export const askKey = (ask) => (ask ? ask.toolUseId || String(ask.since || '') : '');

export function markSeen(id) {
  const s = state.sessions.get(id);
  if (s && s.unseen) api.call('session.markSeen', { session: id }).catch(() => {});
}

// P6a
export const dockOf = (id) => { for (const d of state.docks.values()) if (d.members.includes(id)) return d; return null; };
// P17: 고른 순서를 지킨다(배치 틀이 그 순서로 칸을 채운다). 한 번에 새로 고른 것(상자 고르기)은 화면 왼쪽 위부터
export function setSelected(ids) {
  const keep = state.selected.filter((x) => ids.includes(x));
  const rect = (id) => state.nodes.get(id) || { x: 0, y: 0, h: 0 };
  const added = ids.filter((x) => !keep.includes(x)).sort((a, b) => { const ra = rect(a), rb = rect(b); return Math.abs(ra.y - rb.y) > Math.min(ra.h, rb.h) / 2 ? ra.y - rb.y : ra.x - rb.x; });
  const next = [...keep, ...added];
  if (next.length === state.selected.length && next.every((x, i) => x === state.selected[i])) return;
  state.selected = next; changed();
}
// P17: 분할선을 끄는 동안 덩어리 나무(비율)를 창에서만 바꾼다. 놓으면 dock.update로 저장하고 board.changed로 다시 읽는다
export function setDockLocal(id, f) { const d = state.docks.get(id); if (!d) return; state.docks = new Map(state.docks); state.docks.set(id, { ...d, ...f }); changed(); }
export function setSearchOpen(v) { state.searchOpen = v; changed(); }
// P43: 아래 바(명령 바·칩)가 보이는가(CommandBar가 정한다, 칩 줄이 따른다). bottomPin은 창 시험이 늘 보이게 고정하는 값
export function setBottomShown(v) { if (state.bottomShown === !!v) return; state.bottomShown = !!v; changed(); }
// 고정은 창을 다시 읽어도(시험의 page.reload) 남게 sessionStorage에 둔다. 창을 닫으면 사라진다
export function setBottomPin(v) { state.bottomPin = !!v; try { if (v) sessionStorage.setItem('mt.bottomPin', '1'); else sessionStorage.removeItem('mt.bottomPin'); } catch { /* 저장소를 못 쓰면 이 창에서만 */ } changed(); }
export function markArranged(key, on) { state.arranged = new Set(state.arranged); if (on) state.arranged.add(key); else state.arranged.delete(key); changed(); }
// H4: 노드를 눌러 들어갔다. 터미널이 붙기 전에 친 글은 모았다가 붙으면 넣는다(8초까지)
export const PENDING_INPUT_MS = 8000;
export function setPendingInput(id) { state.pendingInput = { id, buf: '', at: Date.now() }; }
export function pendingFor(id) { const p = state.pendingInput; return p && p.id === id && Date.now() - p.at < PENDING_INPUT_MS ? p : null; }
export function takePendingInput(id) {
  const p = pendingFor(id);
  if (!p) return null;
  state.pendingInput = null;
  return p.buf;
}

// ---------- P6c ----------
// P50(#6): 메모 편집을 연다. 먼 얼굴이면 화면을 그 메모로 옮긴다(Canvas.jsx showMemoForEdit). rect를 주지 않으면 창이 가진 메모 자리
export function editMemo(id, rect = null) {
  const r = rect || state.memos.get(id);
  if (r && state.showMemoForEdit) state.showMemoForEdit(r);
  state.memoEdit = id; changed();
}
export function takeMemoEdit(id) { if (state.memoEdit === id) { state.memoEdit = null; changed(); } }
export function setMemoLocal(id, f) { const m = state.memos.get(id); if (!m) return; state.memos = new Map(state.memos); state.memos.set(id, { ...m, ...f }); changed(); }
export function setConvoLocal(id, f) { const c = state.convoNodes.get(id); if (!c) return; state.convoNodes = new Map(state.convoNodes); state.convoNodes.set(id, { ...c, ...f }); changed(); } // P13
export function setKanbanLocal(id, f) { const k = state.kanbans.get(id); if (!k) return; state.kanbans = new Map(state.kanbans); state.kanbans.set(id, { ...k, ...f }); changed(); }
export function setThreadOpen(v) { state.threadOpen = v; changed(); }
export function setOutputView(v) { state.outputView = v; changed(); }
// P107: 덮개를 연 동안 문서 뿌리 data-mm-open(뒤의 판 노드 둘레를 멈춘다)
export function setMissionOpen(v) { state.missionOpen = v; applyMissionOpen(v); changed(); }
// 검색으로 간 칸반 카드를 2초 동안 빛낸다
export function setFlashCard(id) { state.flashCard = id; changed(); setTimeout(() => { if (state.flashCard === id) { state.flashCard = null; changed(); } }, 2000); }
function putThread(items, { front = false } = {}) {
  const next = new Map(front ? [] : state.thread);
  for (const it of items) next.set(it.itemId, it);
  if (front) for (const [k, v] of state.thread) if (!next.has(k)) next.set(k, v);
  // 시간순(seq). 창에는 최근 300줄까지만 둔다
  state.thread = new Map([...next.values()].sort((a, b) => a.seq - b.seq).slice(-300).map((x) => [x.itemId, x]));
  changed();
}
export async function loadThread({ older = false } = {}) {
  const r = await api.call('thread.list', older && state.threadBefore ? { before: state.threadBefore, limit: 50 } : { limit: 50 });
  state.threadMore = r.more; state.threadBefore = r.before;
  putThread(r.items, { front: older });
}
export async function loadLoops() { const ls = await api.call('loop.list'); state.loops = new Map(ls.map((l) => [l.loopId, l])); changed(); }

api.on('$status', ({ status, detail }) => { state.conn = status; state.connDetail = detail || null; changed(); });
api.on('$open', async (r) => {
  const generation = api.generation;
  const before = { ...state };
  state.sessions = new Map(r.sessions.map((s) => [s.sessionId, s]));
  if (r.clients) state.peers = { ...r.clients, me: r.clients.me || api.clientId }; // P47
  changed();
  const read = async (method, apply, params) => {
    const value = await api.call(method, params);
    if (generation !== api.generation) return;
    apply(value); changed();
  };
  // 한 부가 기능(자원 측정 등)이 실패해도 설정과 나머지 맥락은 읽는다.
  const results = await Promise.allSettled([
    loadBoard(),
    (async () => {
      const [recent, active] = await Promise.all([api.call('delivery.list', { limit: 10 }), api.call('delivery.list', { active: true }).catch(() => [])]);
      if (generation !== api.generation) return;
      state.deliveries = mergeSnapshot(before.deliveries, state.deliveries, new Map([...recent.slice().reverse(), ...active].filter((d) => state.sessions.has(d.sessionId)).map((d) => [d.deliveryId, d])));
      changed();
    })(),
    read('herdr.status', (st) => { if (state.herdr === before.herdr) state.herdr = herdrStateOf(st); }),
    read('resources.get', (v) => { if (state.resources === before.resources) state.resources = v; }),
    read('herdr.clients', (v) => { if (state.clients === before.clients) state.clients = v; }),
    loadThread().catch(() => {}), loadLoops().catch(() => {}), loadLaunchers(),
    read('settings.get', (v) => { if (state.settings === before.settings) putSettings(v.settings); }).catch(() => {}),
  ]);
  const failed = results.find((v) => v.status === 'rejected');
  if (failed && generation === api.generation) toast(t('store.loadFailed', { error: errText(failed.reason) }), 'error');
});
api.on('session.updated', (sum) => putSession(sum));
api.on('session.created', () => { loadBoard().catch(() => {}); });
api.on('session.removed', (d) => {
  state.sessions = new Map(state.sessions); state.sessions.delete(d.sessionId);
  state.nodes = new Map(state.nodes); state.nodes.delete(d.sessionId);
  state.selected = state.selected.filter((id) => id !== d.sessionId);
  state.attached = state.attached.filter((id) => id !== d.sessionId);
  state.closeIds = state.closeIds.filter((id) => id !== d.sessionId);
  if (state.focusId === d.sessionId) state.focusId = null;
  if (state.pendingInput?.id === d.sessionId) state.pendingInput = null;
  changed();
});
api.on('delivery', (d) => {
  const prev = state.deliveries.get(d.deliveryId) || {};
  state.deliveries = new Map(state.deliveries);
  state.deliveries.set(d.deliveryId, { ...prev, ...d, _at: Date.now() }); // _at: 창이 마지막으로 바뀜을 받은 시각(명령 바 아래 칩을 잠깐만 보이는 데 쓴다)
  // 최근 12개만 둔다
  if (state.deliveries.size > 12) state.deliveries.delete(state.deliveries.keys().next().value);
  changed();
});
// P13: 판 밖 대화 노드가 바뀌었다(새 대화, 자리, 보관, 판 세션이 됨, 묶임 표시)
export function setConvoNodes(nodes, edges) { state.convoNodes = new Map((nodes || []).map((c) => [c.convId, c])); state.convoEdges = edges || []; changed(); }
api.on('convo.nodes', (d) => setConvoNodes(d.nodes, d.edges));
api.on('herdr', (d) => { state.herdr = { ...state.herdr, ...herdrEventOf(d) }; changed(); });
// P40: herdr 상태(herdr.status 결과, herdr 이벤트) → 창이 쓰는 값. 띠(못 찾음, 다른 프로토콜, 검증하지 않은 버전, 새 버전)와 알약이 읽는다
export function herdrStateOf(st) {
  return { connected: st.connected, running: st.running, session: st.session, version: (st.compat && st.compat.version) || null, ...herdrEventOf(st) };
}
export function herdrEventOf(d) {
  const out = { connected: d.connected };
  for (const k of ['missing', 'level', 'warning', 'problems', 'protocols', 'tested', 'update', 'path', 'find']) if (k in d) out[k] = d[k];
  if (d.version) out.version = d.version;
  if (d.protocol != null) out.protocol = d.protocol;
  return out;
}
api.on('board.changed', () => { loadBoard().catch(() => {}); });
api.on('link.updated', (l) => { state.links = new Map(state.links); if (l.removedAt) state.links.delete(l.linkId); else state.links.set(l.linkId, l); changed(); });
api.on('link.removed', (d) => { state.links = new Map(state.links); state.links.delete(d.linkId); changed(); });
api.on('resources', (v) => { state.resources = v; changed(); });
api.on('workspace.updated', (d) => {
  state.workspaces = d.workspaces || [];
  if (d.groups) state.groups = d.groups; // P44
  if (!state.workspaces.some((w) => w.key === state.currentWs)) state.currentWs = d.current || (state.workspaces[0] || {}).key || null;
  changed();
});
api.on('herdr.clients', (v) => { state.clients = v; changed(); });
api.on('clients.updated', (v) => { state.peers = { ...v, me: api.clientId }; changed(); }); // P47
// P47: 다른 창이 노드를 옮기거나 크기를 바꿨다(board.setNode). 이 창이 보낸 것은 이미 그렸다
api.on('board.node', (d) => { if (!d || (d.by && d.by === api.clientId) || !state.nodes.has(d.sessionId)) return; setNodeLocal(d.sessionId, { x: d.x, y: d.y, w: d.w, h: d.h, ...(d.z != null ? { z: d.z } : {}) }); });
// P47: 사람이 이 창에서 무엇을 하면(키, 마우스) 백엔드에 알린다. 알림은 최근에 쓴 클라이언트에서만 뜬다(백엔드 pickNotifyClient)
const ACTIVE_PING_MS = 20000;
let lastPing = 0;
export function noteActive(now = Date.now()) {
  if (now - lastPing < ACTIVE_PING_MS || api.status !== 'open') return;
  lastPing = now;
  api.call('client.active').catch(() => { lastPing = 0; });
}
if (typeof window !== 'undefined' && window.addEventListener) for (const ev of ['keydown', 'pointerdown', 'wheel']) window.addEventListener(ev, () => noteActive(), { capture: true, passive: true });
// P6c 이벤트
api.on('memo.updated', (m) => { state.memos = new Map(state.memos); state.memos.set(m.memoId, m); changed(); });
api.on('memo.removed', (d) => { state.memos = new Map(state.memos); state.memos.delete(d.memoId); changed(); });
api.on('kanban.updated', (k) => { state.kanbans = new Map(state.kanbans); state.kanbans.set(k.kanbanId, k); changed(); });
api.on('kanban.removed', (d) => { state.kanbans = new Map(state.kanbans); state.kanbans.delete(d.kanbanId); changed(); });
api.on('thread.item', (it) => putThread([it]));
api.on('loop.updated', (l) => { state.loops = new Map(state.loops); state.loops.set(l.loopId, l); changed(); });
api.on('loop.removed', (d) => { state.loops = new Map(state.loops); state.loops.delete(d.loopId); changed(); });
// P62: 웹 화면은 패스키로 확인이 바뀌면 세션 쿠키를 새 수명으로 다시 받는다(web.js passkeyMode)
api.on('settings.updated', (v) => { const s = v.settings || v; try { if (s && window.mt && typeof window.mt.passkeyMode === 'function') window.mt.passkeyMode(s.remotePasskey); } catch {} putSettings(s); });
// P33 호출자(왼쪽 레일 즐겨찾기, 설정의 호출자 탭, 새 세션 창). 옛 백엔드면 없다
export function putLaunchers(v) { state.launchers = v && Array.isArray(v.launchers) ? v : null; changed(); }
let launchersRequest = 0;
export async function loadLaunchers() {
  const request = ++launchersRequest, generation = api.generation, before = state.launchers;
  try {
    const value = await api.call('launcher.list');
    if (request === launchersRequest && generation === api.generation && state.launchers === before) putLaunchers(value);
  } catch { /* Older backends may not expose launchers. */ }
}
api.on('launchers.updated', (v) => putLaunchers(v));

// P45: 터미널 글자 배율과 화면 배율(lib/scale.js). 이 창(프로필)의 localStorage에 두어 다시 켜도 남는다.
// 화면 배율은 preload가 창을 그리기 전에 먼저 맞추고(preload.cjs), 바꾸면 여기서 다시 맞춘다
const scaleStore = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };
function applyUiScale(f) { try { if (typeof window !== 'undefined' && window.mt && window.mt.setZoom) window.mt.setZoom(f); } catch { /* 웹 화면 등 창 배율이 없는 곳 */ } }
state.termScale = readScale(scaleStore(), SCALE_KEYS.term);
state.uiScale = readScale(scaleStore(), SCALE_KEYS.ui);
export function setTermScale(f) { state.termScale = saveScale(scaleStore(), SCALE_KEYS.term, f); changed(); }
export function setUiScale(f) { state.uiScale = saveScale(scaleStore(), SCALE_KEYS.ui, f); applyUiScale(state.uiScale); changed(); }
// P85: "작업 중만 또렷하게"(lib/overview.js). 이 창(프로필)의 localStorage에 두고 문서 뿌리의 mt-spot 클래스로 그린다
state.spotlight = loadSpot(scaleStore());
applySpot(state.spotlight);
export function setSpotlight(on) { state.spotlight = saveSpot(scaleStore(), on); applySpot(state.spotlight); changed(); }
