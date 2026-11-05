// 워크트리 영역(P27, BRIEF "워크스페이스"). backend.mjs의 Backend(b)를 받아 리포 워크스페이스마다 살아 있는 워크트리를 읽고 영역을 맞춘다.
// - 목록: 리포 워크스페이스마다 `git -C <본 저장소> worktree list --porcelain`. 폴더가 있는 것만 산다(worktree-areas.mjs liveWorktrees).
//   뜰 때, 주기적으로(기본 10초), 세션의 git이 바뀌었을 때(kick) 읽는다. 판은 워크트리를 만들거나 지우지 않고 읽기만 한다(BRIEF 2절).
// - 영역: 새 워크트리는 표 worktree_areas에 자리를 정해 넣고(P35: 리포 영역 안 빈자리, boxSlot), 없어진 워크트리(목록 읽기가 성공했을 때만)는 행을 지운다.
// - 노드: 세션의 지금 폴더(hook cwd, 없으면 시작 폴더)가 든 워크트리가 저장한 영역(nodes.area)과 다르면 그 영역의 빈자리로 옮긴다.
//   덩어리 안 노드는 옮기지 않는다. 대화 노드는 recall.layoutCanvas가 같은 규칙(areaOf)으로 놓는다.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { parseWorktreeList, liveWorktrees, worktreeOfPath, areaKey, wsOfArea, boxSlot } from './worktree-areas.mjs';
import { canvasItems, regions, settleRegions, dockOf, slotRegions, slotItems, anchorWorkspace } from './canvas-ops.mjs';
import { slotInRegion } from './canvas.mjs';
import { pathKey } from './workspaces.mjs';

const TICK_MS = 10000;

function gitWorktrees(root) {
  return new Promise((res) => execFile('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }, (err, out) => res(err ? null : String(out))));
}

export function attachWorktrees(b, { tickMs = TICK_MS, list = gitWorktrees, exists = (p) => fs.existsSync(p) } = {}) {
  const listOf = new Map(); // 워크스페이스 키 → 살아 있는 워크트리 [{ key, path, branch, ... }]
  const log = (m) => (b.log ? b.log(m) : null);
  let stopped = false;

  // 폴더가 든 워크트리의 키(본 저장소면 ''). 그 리포의 목록을 아직 못 읽었으면 저장한 영역 행으로 본다
  function areaOf(wsKey, cwd) {
    if (!wsKey || !cwd) return '';
    const w = b.store.getWorkspace(wsKey);
    if (!w || w.kind !== 'repo') return '';
    const wts = listOf.get(wsKey) || b.store.worktreeAreas().filter((a) => a.wsKey === wsKey).map((a) => ({ key: a.wt }));
    return worktreeOfPath(cwd, wts, pathKey(w.root));
  }
  const cwdOf = (s) => (s.rt && s.rt.cwd) || s.cwd;

  // 영역 행 맞추기. 바뀐 것이 있으면 true
  async function syncAreas() {
    let changed = false;
    const wss = b.store.workspaces();
    const keys = new Set(wss.map((w) => w.key));
    for (const key of listOf.keys()) if (!keys.has(key)) listOf.delete(key);
    for (const a of b.store.worktreeAreas()) if (!keys.has(a.wsKey)) { b.store.deleteWorktreeArea(a.wsKey, a.wt); changed = true; } // 닫힌 워크스페이스
    for (const w of wss) {
      if (w.kind !== 'repo') { if (listOf.delete(w.key)) changed = true; continue; }
      const out = await list(w.root);
      if (stopped) return false;
      const current = b.store.getWorkspace(w.key);
      if (!current || current.root !== w.root || current.kind !== 'repo' || current.createdAt !== w.createdAt) { listOf.delete(w.key); continue; }
      if (out == null) continue; // 읽지 못했으면 그대로 둔다(잠깐의 실패로 영역을 지우지 않는다)
      const live = liveWorktrees(parseWorktreeList(out), exists);
      listOf.set(w.key, live);
      const have = b.store.worktreeAreas().filter((a) => a.wsKey === w.key);
      for (const a of have) {
        if (live.some((x) => x.key === a.wt)) continue;
        b.store.deleteWorktreeArea(w.key, a.wt);
        b.store.addEvent(null, 'worktree_area_removed', { key: w.key, worktree: a.path, branch: a.branch });
        changed = true;
      }
      for (const x of live) {
        const a = have.find((r) => r.wt === x.key);
        if (a) { if (a.branch !== (x.branch || null) || a.path !== x.path) { b.store.putWorktreeArea({ ...a, branch: x.branch || null, path: x.path }); changed = true; } continue; }
        // P35: 리포 영역 안 빈자리(본 저장소 쪽 것의 오른쪽이나 아래, 다른 상자와 겹치지 않게). 리포 영역이 커져 다른 영역과 겹치면 settleRegions가 그 영역을 민다
        anchorWorkspace(b, w.key);
        const items = canvasItems(b);
        const regs = regions(b, items);
        const content = items.filter((i) => i.ws === w.key && i.kind !== 'wtbox');
        const boxes = [...regs].filter(([k]) => k !== w.key && wsOfArea(k) === w.key).map(([, r]) => r);
        const at = boxSlot({ main: regs.get(w.key) || null, content, boxes });
        b.store.putWorktreeArea({ wsKey: w.key, wt: x.key, path: x.path, branch: x.branch || null, x: at.x, y: at.y });
        b.store.addEvent(null, 'worktree_area_created', { key: w.key, worktree: x.path, branch: x.branch || null, at });
        changed = true;
      }
    }
    return changed;
  }

  // 세션 노드를 지금 폴더의 영역으로. 옮긴 수
  function relocateNodes() {
    let moved = 0;
    for (const n of b.store.nodes()) {
      const s = b.sessions.get(n.session_id);
      if (!s || !n.workspace_key) continue;
      const w = b.store.getWorkspace(n.workspace_key);
      if (!w || w.kind !== 'repo' || !listOf.has(w.key)) continue;
      const want = areaOf(w.key, cwdOf(s));
      if (want === (n.area || '')) continue;
      if (dockOf(b, s.sessionId)) continue; // 덩어리는 그대로(한 노드만 빼 옮기면 덩어리가 깨진다)
      const items = canvasItems(b).filter((i) => i.id !== s.sessionId);
      const regs = regions(b, items);
      const k = want && regs.has(areaKey(w.key, want)) ? areaKey(w.key, want) : w.key;
      const at = slotInRegion({ wsKey: k, size: { w: n.w, h: n.h }, items: slotItems(items, k), regions: slotRegions(regs, k) });
      b.store.setNode({ ...n, x: at.x, y: at.y, area: want });
      b.store.addEvent(s.sessionId, 'node_moved', { from: { x: n.x, y: n.y, w: n.w, h: n.h }, to: { x: at.x, y: at.y, w: n.w, h: n.h }, cause: want ? 'worktree area' : 'main area', area: want || null });
      moved++;
      settleRegions(b, 'worktree node'); // 커진 워크트리 영역이 형제 영역과 겹치면 바로 민다(다음 노드 자리가 맞게)
    }
    return moved;
  }

  // 한 번에 하나만 돈다(도는 중에 또 부르면 그 뒤에 한 번 더)
  let chain = Promise.resolve();
  function sync(cause = 'tick') {
    chain = chain.catch(() => {}).then(async () => {
      if (stopped) return { changed: false, moved: 0 };
      // Reconcile before listing worktrees, but never write after stop().
      const merged = b.reconcileWorkspaces ? await b.reconcileWorkspaces(cause, { cancelled: () => stopped }).catch((e) => { log(`workspace merge error ${e.stack}`); return []; }) : [];
      if (stopped) return { changed: false, moved: 0 };
      const changed = (await syncAreas()) || merged.length > 0;
      if (stopped) return { changed: false, moved: 0 };
      const moved = relocateNodes();
      if (!changed && !moved) return { changed: false, moved: 0 };
      settleRegions(b, `worktrees ${cause}`);
      if (b.broadcastWorkspaces) b.broadcastWorkspaces();
      if (b.api) b.api.broadcast('board.changed', { why: 'worktrees' });
      // 새 워크트리 폴더의 대화가 "폴더 없음"으로 기억돼 있으면 잊고, 목록(사이드바)과 대화 노드를 다시 만든다
      if (b.recall) { b.recall.layoutCanvas().catch(() => {}); if (changed && b.recall.onWorktreesChanged) b.recall.onWorktreesChanged(); }
      log(`worktree areas synced (${cause}) changed=${changed} moved=${moved}`);
      return { changed, moved };
    });
    return chain;
  }
  let kickTimer = null;
  const kick = (cause = 'kick') => { if (stopped) return; clearTimeout(kickTimer); kickTimer = setTimeout(() => sync(cause).catch((e) => log(`worktree sync error ${e.stack}`)), 300); };
  const timer = tickMs ? setInterval(() => sync('tick').catch((e) => log(`worktree sync error ${e.stack}`)), tickMs) : null;

  // 창에 주는 워크스페이스의 워크트리 영역들
  const view = (wsKey) => b.store.worktreeAreas().filter((a) => a.wsKey === wsKey).map((a) => ({ wt: a.wt, area: areaKey(a.wsKey, a.wt), path: a.path, branch: a.branch, x: a.x, y: a.y, movedAt: a.movedAt }));

  return {
    areaOf, sync, kick, view,
    live: (wsKey) => listOf.get(wsKey) || null,
    stop() { stopped = true; if (timer) clearInterval(timer); clearTimeout(kickTimer); },
    handlers: {
      'worktree.list': (p) => (p && p.workspace ? view(p.workspace) : b.store.workspaces().map((w) => ({ workspace: w.key, areas: view(w.key) }))),
      'worktree.sync': async () => sync('api'),
    },
  };
}
