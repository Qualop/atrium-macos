// 폴더 워크스페이스가 저장소가 되면 합치기(P37). backend.mjs의 Backend(b)를 받아 판 위에서 한다. 판단은 workspace-merge.mjs(순수 함수), 표 옮기기는 store-merge.mjs.
// 알아채는 때(사람이 아무것도 하지 않아도 몇 초 안에 영역이 하나로 보이게):
// - 띄울 때(b.ensureWorkspace): 새 저장소 워크스페이스의 본 저장소 폴더가 폴더 워크스페이스로 열려 있으면, 새 줄을 만들지 않고 그 폴더 워크스페이스를 저장소 키로 옮긴다.
//   그래서 새 세션은 처음부터 옛 영역 안 빈자리에 놓인다(형제 폴더 워크트리의 세션은 그 영역 안 노란 상자로).
// - 주기적으로(worktrees.mjs sync: 10초마다, 세션의 git이 바뀌었을 때, 뜰 때): 폴더 워크스페이스마다 그 폴더의 git을 다시 본다.
//   `git init`만 하고 새 세션을 띄우지 않아도 머리글이 "폴더"에서 저장소로 바뀐다. 저장소 안 폴더(부모가 저장소가 됨)도 이때 합친다.
// - 뜰 때 한 번(backend start): 같은 폴더를 가리키는 폴더 키와 저장소 키가 함께 있는 옛 판(P36까지)을 하나로 합친다. 여러 번 돌려도 같다.
// 반대로 저장소의 `.git`을 지우면(폴더는 남음) 그 저장소 워크스페이스를 폴더 키로 옮긴다. 워크트리 상자는 없어지고 상자 안 노드는 본 영역에 남는다.
import fs from 'node:fs';
import path from 'node:path';
import { workspaceOf } from './git.mjs';
import { twinWorkspace, planWorkspaceMerges } from './workspace-merge.mjs';
import { canvasItems, settleRegions, reslotBoxes } from './canvas-ops.mjs';

const hasGitDir = (root) => { try { return fs.existsSync(path.join(root, '.git')); } catch { return false; } };

// from 키의 워크스페이스를 ws로 옮기고 판에 알린다. 옮기지 않았으면 null. quiet: 창에 알리지 않는다(뜰 때, 창이 붙기 전)
export function mergeWorkspace(b, from, ws, why, { quiet = false } = {}) {
  const before = canvasItems(b);
  const targetMainEmpty = !!b.store.getWorkspace(ws.key) && !before.some((i) => i.ws === ws.key && i.kind !== 'wtbox');
  const fromHasContent = before.some((i) => i.wsKey === from && i.kind !== 'wtbox');
  const r = b.store.rekeyWorkspace(from, ws);
  if (!r) return null;
  const moved = [];
  for (const s of b.sessions.values()) if (s.workspaceKey === from) { s.workspaceKey = ws.key; moved.push(s); }
  if (b.sleeper && b.sleeper.busyAt && b.sleeper.busyAt.has(from)) { b.sleeper.busyAt.set(ws.key, Math.max(b.sleeper.busyAt.get(from), b.sleeper.busyAt.get(ws.key) || 0)); b.sleeper.busyAt.delete(from); }
  // 본 저장소 쪽이 비어 있던 저장소 영역(워크트리 상자만 있음)에 폴더 영역의 것이 들어왔다: 상자를 들어온 것의 오른쪽이나 아래로 다시 놓는다
  const boxes = ws.kind === 'repo' && targetMainEmpty && fromHasContent ? reslotBoxes(b, b.store.getWorkspace(ws.key)) : [];
  const settled = settleRegions(b, `workspace merge ${why}`);
  const ev = { ...r, kind: ws.kind, root: ws.root, why, sessions: moved.map((s) => s.name), boxes: boxes.map(({ key, dx, dy }) => ({ key, dx, dy })), settled: settled.length };
  b.store.addEvent(null, 'workspace_merged', ev);
  if (b.log) b.log(`workspace merged ${JSON.stringify(ev)}`);
  if (b.recall) {
    if (b.recall.wsCache) b.recall.wsCache.clear(); // 대화 폴더 → 워크스페이스 풀이(10분 기억)에 옛 폴더 키가 남아 있다
    if (b.recall.views) b.recall.views.delete(from);
    if (!quiet) { b.recall.changed().catch(() => {}); b.recall.layoutCanvas().catch(() => {}); }
  }
  if (!quiet) {
    for (const s of moved) if (b.broadcastSession) b.broadcastSession(s, { cause: 'workspace merged' });
    if (b.broadcastWorkspaces) b.broadcastWorkspaces();
    if (b.api) b.api.broadcast('board.changed', { why: 'workspace merged' });
  }
  if (b.worktrees && ws.kind === 'repo') b.worktrees.kick('workspace merged'); // 새 저장소의 워크트리 목록을 읽어 상자를 만든다
  return ev;
}

// 띄울 때: 새로 만들 워크스페이스 ws와 같은 폴더를 가리키는 줄이 있으면 그 줄을 ws 키로 옮긴다(git을 다시 부르지 않는다). 옮겼으면 true
export function adoptTwin(b, ws, why, { gitExists = hasGitDir } = {}) {
  const twin = twinWorkspace(b.store.workspaces(), ws, { gitExists });
  if (!twin) return false;
  return !!mergeWorkspace(b, twin.key, ws, `spawn:${why}`);
}

// 열린 워크스페이스를 다시 보아 옮길 것을 옮긴다. 옮긴 것 목록
export async function reconcileWorkspaces(b, cause, { resolve = workspaceOf, exists = (p) => fs.existsSync(p), gitExists = hasGitDir, quiet = false, cancelled = () => !!b.stopping } = {}) {
  const probes = new Map();
  const snapshot = b.store.workspaces();
  const unchanged = (w) => {
    const current = b.store.getWorkspace(w.key);
    return current && current.kind === w.kind && current.root === w.root && current.createdAt === w.createdAt;
  };
  for (const w of snapshot) {
    if (cancelled()) return [];
    if (!unchanged(w)) continue;
    const rootExists = !!w.root && exists(w.root);
    if (!rootExists) continue;
    if (w.kind === 'folder' || (w.kind === 'repo' && !gitExists(w.root))) {
      const ws = await Promise.resolve().then(() => resolve(w.root)).catch(() => null);
      if (cancelled()) return [];
      if (unchanged(w)) probes.set(w.key, { ws, rootExists: exists(w.root), gitExists: gitExists(w.root) });
    }
  }
  if (cancelled()) return [];
  const done = [];
  for (const m of planWorkspaceMerges(snapshot.filter(unchanged), probes)) {
    if (!b.store.getWorkspace(m.from)) continue; // 기다리는 동안 띄우기가 먼저 옮겼다
    const r = mergeWorkspace(b, m.from, m.to, `${cause}:${m.why}`, { quiet });
    if (r) done.push(r);
  }
  return done;
}
