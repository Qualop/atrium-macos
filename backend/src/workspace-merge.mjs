// 폴더 워크스페이스가 저장소가 되면 합치기(P37, ARCH 4절 G). 순수 함수만 둔다(node 모듈을 부르지 않는다).
//
// 워크스페이스 키는 폴더면 폴더 경로, 저장소면 `.git` 공통 폴더 경로다(workspaces.mjs). 세션의 키는 시작할 때 한 번 정한다.
// 그래서 판이 연 폴더가 나중에 git 저장소가 되면(`git init`, 또는 그 폴더가 다른 저장소 안이 됨) 앞의 세션은 폴더 키에,
// 뒤의 세션(같은 폴더, 형제 폴더 워크트리)은 저장소 키에 놓여 한 폴더가 영역 둘로 갈라졌다.
// - 판단: 폴더 워크스페이스의 폴더를 다시 보아(git 조사) 저장소면 그 저장소 워크스페이스로 옮긴다.
//   반대로 저장소 워크스페이스의 폴더에 `.git`이 없어졌으면(폴더는 남음) 그 폴더 워크스페이스로 옮긴다(갈라지지 않게만).
// - 옮기기: 워크스페이스 키를 쥔 것 전부(세션 행, 덩어리, 메모, 칸반, 대화 노드, 워크트리 상자, 영역 자리, meta)를 새 키로. 노드 자리는 그대로다.
//   새 키의 워크스페이스가 이미 있으면 하나로 합치고, 없으면 옛 줄의 자리·순서·뷰포트를 그대로 가진 새 줄이 된다(store-merge.mjs).
import { pathKey, normPath } from './workspaces.mjs';
import { GROUPS_META, rekeyGroups } from './ws-groups.mjs';

// 새로 만들려는 워크스페이스(ws: { key, kind, root })와 같은 폴더를 가리키는 다른 키의 워크스페이스. 띄울 때(ensureWorkspace) git을 다시 부르지 않고 고른다.
// - 저장소 ws: 그 본 저장소 폴더 자체가 폴더 워크스페이스로 열려 있으면 그 줄(폴더가 저장소가 됨)
// - 폴더 ws: 그 폴더를 본 저장소로 둔 저장소 워크스페이스가 있고 `.git`이 없어졌으면 그 줄(저장소가 폴더가 됨). `.git`이 있으면(git 조사가 잠깐 실패) 고르지 않는다
// gitExists(root) → bool
export function twinWorkspace(rows, ws, { gitExists = () => true } = {}) {
  if (!ws || !ws.key) return null;
  if (ws.kind === 'repo') return (rows || []).find((w) => w.kind === 'folder' && w.key !== ws.key && w.key === pathKey(ws.root)) || null;
  return (rows || []).find((w) => w.kind === 'repo' && w.key !== ws.key && pathKey(w.root) === ws.key && !gitExists(w.root)) || null;
}

// 열린 워크스페이스마다 다시 본 결과로 옮길 것을 고른다.
// probes: Map 워크스페이스 키 → { ws: 그 폴더의 workspaceOf 결과(없으면 못 봄), rootExists, gitExists }
// → [{ from, to: { key, kind, root }, why }] (차례대로 하나씩 옮긴다). 옮길 것이 없으면 []
// - 폴더 → 저장소: 폴더 워크스페이스의 폴더가 git 저장소(또는 저장소 안 폴더)다. why 'repo'
// - 저장소 → 폴더: 본 저장소 폴더가 남았고 `.git`이 없으며 git도 저장소가 아니라고 한다. why 'folder'
// - 이미 갈라짐(못 본 폴더 워크스페이스): 폴더 키가 저장소 워크스페이스의 본 저장소 폴더와 같으면 그 저장소로. why 'split'
// 한 키는 한 번만 옮기고, 옮겨 간 키를 다시 옮기지 않는다(고리 없음). 결과에 다시 돌리면 []
export function planWorkspaceMerges(rows, probes = new Map()) {
  const list = rows || [];
  const out = [];
  const gone = new Set(), into = new Set();
  const add = (from, to, why) => { if (gone.has(from) || into.has(from) || from === to.key) return; out.push({ from, to: { key: to.key, kind: to.kind, root: normPath(to.root) }, why }); gone.add(from); into.add(to.key); };
  for (const w of list) {
    const p = probes.get(w.key);
    if (w.kind === 'folder') {
      if (p && p.ws && p.ws.kind === 'repo' && p.ws.key !== w.key) { add(w.key, p.ws, 'repo'); continue; }
      if (!p || !p.ws) { const r = list.find((x) => x.kind === 'repo' && pathKey(x.root) === w.key); if (r) add(w.key, r, 'split'); }
      continue;
    }
    if (w.kind === 'repo' && p && p.ws && p.rootExists && !p.gitExists && p.ws.kind === 'folder' && p.ws.key === pathKey(w.root)) add(w.key, p.ws, 'folder');
  }
  return out; // 같은 대상으로 가는 것끼리는 순서가 상관없다. 엇갈린 것(A → B, B → A)은 add가 뒤의 것을 버린다
}

// 합친 워크스페이스 줄. from: 옮겨 오는 줄, to: 이미 있는 대상 줄(없으면 null), ws: 대상 { key, kind, root }
// 자리(x, y)·뷰포트는 대상 것이 있으면 대상, 없으면 옮겨 오는 줄. 순서(createdAt)는 먼저 생긴 쪽. 저절로 연 표시(auto)는 둘 다 저절로 열었을 때만
export function mergedWorkspaceRow(from, to, ws) {
  const has = (r) => r && r.x != null && r.y != null;
  const at = has(to) ? to : has(from) ? from : null;
  const created = [from && from.createdAt, to && to.createdAt].filter((t) => Number.isFinite(t));
  return {
    key: ws.key, kind: ws.kind, root: normPath(ws.root),
    x: at ? at.x : null, y: at ? at.y : null,
    viewport: (to && to.viewport) || (from && from.viewport) || null,
    createdAt: created.length ? Math.min(...created) : Date.now(),
    auto: to ? !!(to.auto && (!from || from.auto)) : !!(from && from.auto),
  };
}

// 키 하나 바꾸기와 키 목록 바꾸기(meta currentWorkspace, autoOpenDeclined). 목록은 겹치지 않게
export const rekeyKey = (k, from, to) => (k === from ? to : k);
export function rekeyList(list, from, to) {
  const out = [];
  for (const k of list || []) { const n = rekeyKey(k, from, to); if (!out.includes(n)) out.push(n); }
  return out;
}

// 판 상태 하나(시험과 설명용 모형): { workspaces, sessions, memos, kanbans, docks, convoNodes, worktreeAreas, meta } → 키를 옮긴 새 상태.
// 저장소의 옮기기(store-merge.mjs rekeyWorkspace)가 표마다 하는 일과 같다. 자리(x, y, w, h)는 건드리지 않는다
export function rekeyBoard(st, from, ws) {
  if (from === ws.key) return st;
  const fromRow = st.workspaces.find((w) => w.key === from) || null;
  const toRow = st.workspaces.find((w) => w.key === ws.key) || null;
  if (!fromRow) return st;
  const row = mergedWorkspaceRow(fromRow, toRow, ws);
  const re = (x) => (x.workspaceKey === from ? { ...x, workspaceKey: ws.key } : x);
  const keepAreas = ws.kind === 'repo';
  const areas = [];
  for (const a of st.worktreeAreas || []) {
    if (a.wsKey !== from) { areas.push(a); continue; }
    if (!keepAreas) continue; // 폴더에는 워크트리 상자가 없다
    if (!(st.worktreeAreas || []).some((b) => b.wsKey === ws.key && b.wt === a.wt)) areas.push({ ...a, wsKey: ws.key });
  }
  const meta = { ...(st.meta || {}), currentWorkspace: rekeyKey((st.meta || {}).currentWorkspace ?? null, from, ws.key), autoOpenDeclined: rekeyList((st.meta || {}).autoOpenDeclined, from, ws.key).filter((k) => k !== ws.key) };
  if (meta[GROUPS_META] != null) meta[GROUPS_META] = rekeyGroups(meta[GROUPS_META], from, ws.key);
  for (const k of [from, ws.key, '*']) if (meta[`arrangeUndo:${k}`]) meta[`arrangeUndo:${k}`] = null;
  return {
    ...st,
    workspaces: [...st.workspaces.filter((w) => w.key !== from && w.key !== ws.key), row].sort((a, b) => a.createdAt - b.createdAt || String(a.key).localeCompare(String(b.key))),
    sessions: (st.sessions || []).map(re), memos: (st.memos || []).map(re), kanbans: (st.kanbans || []).map(re), docks: (st.docks || []).map(re), convoNodes: (st.convoNodes || []).map(re),
    worktreeAreas: areas,
    meta,
  };
}
