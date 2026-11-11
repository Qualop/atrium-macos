// P68: 덩어리 안 칸의 브랜치 표시(단위 시험 app/test/p68-lib.test.mjs). 부르는 곳은 SessionNode.jsx Header.
// 같은 리포의 서로 다른 영역(본 저장소 영역, 워크트리 상자) 세션이 섞인 덩어리(워크트리끼리 붙인 덩어리)에서만,
// 칸마다 그 세션의 브랜치(없으면 워크트리 상자의 브랜치·폴더 이름)를 머리에 작게 보여 칸끼리 브랜치가 다른 것이 한눈에 보이게 한다.
import { areaResolverOf, isBoxKey, parseArea, worktreeLabel } from '../../../../backend/src/worktree-areas.mjs';

let cache = { ws: null, fn: null };
const resolverOf = (workspaces) => { if (cache.ws !== workspaces) cache = { ws: workspaces, fn: areaResolverOf(workspaces) }; return cache.fn; };

// st: { docks: Map, sessions: Map, nodes: Map, workspaces: [] }, id: 세션 ID → '' | '<wt|main>\t<브랜치>'(useStore 선택자가 그대로 비교할 수 있게 글 하나)
export function dockBranchOf(st, id) {
  let dock = null;
  for (const d of st.docks.values()) if (d.members.includes(id)) { dock = d; break; }
  if (!dock) return '';
  const resolve = resolverOf(st.workspaces);
  const raw = (m) => { const s = st.sessions.get(m), n = st.nodes.get(m); return s && n ? resolve(s.workspaceKey || null, n.area) : null; };
  const areas = new Set(dock.members.map(raw).filter(Boolean));
  if (areas.size < 2) return '';
  const k = raw(id);
  if (!k) return '';
  const s = st.sessions.get(id);
  const wt = isBoxKey(k);
  let branch = s.git && s.git.isRepo && s.git.branch ? s.git.branch : '';
  if (!branch && wt) {
    const { ws, wt: wtKey } = parseArea(k);
    const w = (st.workspaces || []).find((x) => x.key === ws);
    const row = w && (w.worktrees || []).find((a) => a.wt === wtKey);
    if (row) branch = worktreeLabel(row).branch;
  }
  return `${wt ? 'wt' : 'main'}\t${branch || '?'}`;
}
