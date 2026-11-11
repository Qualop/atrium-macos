// P91: 폴더가 서로 안팎인 워크스페이스를 한 묶음(저절로 만든 가상 그룹, ws-groups.mjs)으로 모은다. 순수 함수만 둔다(단위 시험 backend/test/p91.test.mjs).
// - 같은 묶음: 한 워크스페이스 폴더가 다른 워크스페이스 폴더 안에 있다(안팎), 또는 두 폴더의 가장 가까운 공통 조상이 프로젝트 폴더다(형제).
//   프로젝트 폴더의 표시는 PROJECT_MARKS(부르는 쪽이 디스크를 보고 isProject로 알려 준다).
// - 뿌리가 되지 않는 폴더: 드라이브 뿌리, UNC 공유 뿌리, 사용자 홈과 그 위. 표시가 없는 모음 폴더(예: D:\workspace)는 형제를 묶지 않는다.
// - 묶음 뿌리는 구성 폴더 모두의 공통 조상이다. 이름은 뿌리 폴더 이름, 영역 이름표는 뿌리에서의 상대 경로(뿌리가 구성 폴더면 그 위에서부터).
// - 깊이대로 그룹 안에 그룹을 겹치지 않는다(한 단계 묶음 하나). 깊이는 이름표의 상대 경로가 말한다.
import { normPath, pathKey } from './workspaces.mjs';

export const PROJECT_MARKS = ['.git', 'CLAUDE.md', 'AGENTS.md', 'README*', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', '.claude'];

// 경로 키('c:/workspace/x')를 마디로. UNC('//server/share/x')는 앞 두 마디(서버, 공유)를 한 뿌리로 본다
function segs(k) {
  const s = String(k || '');
  if (s.startsWith('//')) { const p = s.slice(2).split('/').filter(Boolean); return p.length >= 2 ? [`//${p[0]}/${p[1]}`, ...p.slice(2)] : [`//${p.join('/')}`]; }
  if (s.startsWith('/')) return ['/', ...s.slice(1).split('/').filter(Boolean)];
  return s.split('/').filter(Boolean);
}
const join = (ps) => ps[0] === '/' ? '/' + ps.slice(1).join('/') : (ps.length === 1 && /^[a-z]:$/i.test(ps[0]) ? `${ps[0]}/` : ps.join('/'));
export const isInside = (inner, outer) => { const a = segs(inner), b = segs(outer); return a.length > b.length && b.every((x, i) => x === a[i]); };
// 가장 가까운 공통 조상(경로 키). 드라이브가 다르면 null
export function commonDir(keys) {
  const ss = keys.map(segs);
  if (!ss.length) return null;
  const out = [];
  for (let i = 0; ; i++) { const x = ss[0][i]; if (x == null || ss.some((s) => s[i] !== x)) break; out.push(x); }
  return out.length ? join(out) : null;
}
// 묶음 뿌리가 될 수 있는 폴더인가(드라이브·공유 뿌리, 홈과 그 위는 아니다)
export function rootable(k, home = null) {
  const s = segs(k);
  if (s.length <= 1) return false;
  const h = home ? pathKey(home) : null;
  if (h && (h === k || isInside(h, k))) return false;
  return true;
}
const baseName = (p) => segs(normPath(p)).pop() || normPath(p);

// workspaces: [{ key, root }], isProject(경로 키) → bool, home: 사용자 홈 폴더
// → [{ root: 경로 키, rootPath: 원래 글자 그대로의 뿌리, name, members: [워크스페이스 키](상대 경로 순), base }] (구성 둘 이상만)
export function nestClusters(workspaces, { isProject = () => false, home = null } = {}) {
  const ws = (workspaces || []).filter((w) => w && w.key && w.root).map((w) => ({ key: w.key, root: w.root, rk: pathKey(w.root) }));
  const n = ws.length;
  const up = ws.map((_, i) => i);
  const find = (i) => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
  const union = (a, b) => { const x = find(a), y = find(b); if (x !== y) up[Math.max(x, y)] = Math.min(x, y); };
  const proj = new Map();
  const isProj = (k) => { if (!proj.has(k)) proj.set(k, !!isProject(k)); return proj.get(k); };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = ws[i], b = ws[j];
    if (a.rk === b.rk) { union(i, j); continue; }
    if (isInside(a.rk, b.rk)) { if (rootable(b.rk, home)) union(i, j); continue; }
    if (isInside(b.rk, a.rk)) { if (rootable(a.rk, home)) union(i, j); continue; }
    const c = commonDir([a.rk, b.rk]);
    if (c && rootable(c, home) && isProj(c)) union(i, j);
  }
  const by = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!by.has(r)) by.set(r, []); by.get(r).push(ws[i]); }
  const out = [];
  for (const list of by.values()) {
    if (list.length < 2) continue;
    const root = commonDir(list.map((w) => w.rk));
    if (!root) continue;
    // 원래 글자: 구성 폴더 하나의 앞 마디
    const depth = segs(root).length;
    const rootPath = join(segs(normPath(list[0].root)).slice(0, depth));
    const base = list.some((w) => w.rk === root) ? join(segs(root).slice(0, -1)) : root;
    const members = list.map((w) => ({ key: w.key, rel: relLabel(base, w.root) })).sort((x, y) => x.rel.localeCompare(y.rel) || String(x.key).localeCompare(String(y.key)));
    out.push({ root, rootPath, name: baseName(rootPath), base, members: members.map((m) => m.key) });
  }
  return out.sort((a, b) => a.root.localeCompare(b.root));
}

// 영역 이름표: base(경로 키)에서 root까지의 상대 경로(원래 글자). base 밖이면 폴더 이름
export function relLabel(base, root) {
  const r = segs(normPath(root));
  const b = segs(pathKey(base));
  const rk = segs(pathKey(root));
  if (!b.length || rk.length <= b.length || !b.every((x, i) => x === rk[i])) return r[r.length - 1] || normPath(root);
  return r.slice(b.length).join('/');
}
// 저절로 만든 묶음 g({ root })에서 워크스페이스(root 폴더)의 이름표. 뿌리가 그 워크스페이스 자신이면 폴더 이름
export function groupLabel(g, wsRoot, memberRoots = []) {
  if (!g || !g.root) return null;
  const own = [wsRoot, ...memberRoots].some((r) => pathKey(r) === g.root);
  const base = own ? join(segs(g.root).slice(0, -1)) : g.root;
  return relLabel(base, wsRoot);
}

// ---------- 저절로 만든 묶음 맞추기 ----------
// state: normalizeGroups 결과({ groups, dismissed?, excluded? }), clusters: nestClusters 결과 → 새 상태(받은 것은 바꾸지 않는다)
// - 사람이 만든 그룹(auto 아님)에 든 워크스페이스는 옮기지 않는다
// - 사람이 지운 묶음의 뿌리(dismissed)는 다시 만들지 않는다. 사람이 묶음에서 뺀 워크스페이스(excluded: { root, ws })는 다시 넣지 않는다
// - 사람이 이름을 바꾼 묶음(named)은 이름을 덮지 않고, 구성이 줄어도 지우지 않는다. 사람이 넣은 워크스페이스(pinned)는 묶음 밖 폴더여도 둔다
// - 저절로 만든 묶음이 구성 둘 미만이 되면(사람이 이름을 바꾸지 않았으면) 지운다(사람이 지운 것이 아니므로 다시 만들 수 있다)
export function syncAutoGroups(state, clusters) {
  const s = { ...state, groups: (state.groups || []).map((g) => ({ ...g, members: [...g.members], ...(g.pinned ? { pinned: [...g.pinned] } : {}) })) };
  const dismissed = new Set(s.dismissed || []);
  const excluded = new Set((s.excluded || []).map((e) => `${e.root}|${e.ws}`));
  const human = new Set(s.groups.filter((g) => !g.auto).flatMap((g) => g.members));
  const named = new Set(s.groups.filter((g) => g.auto && g.named).flatMap((g) => g.members));
  const autos = s.groups.filter((g) => g.auto);
  const used = new Set();
  const groupOfKey = (k) => s.groups.find((g) => g.members.includes(k));
  const names = () => new Set(s.groups.map((g) => g.name.toLowerCase()));
  const uniqueName = (base, self) => { const taken = new Set([...names()].filter((x) => !self || x !== self.name.toLowerCase())); let n = String(base).slice(0, 40), i = 2; while (taken.has(n.toLowerCase())) n = `${String(base).slice(0, 36)} ${i++}`; return n; };
  const nextId = () => { const ids = new Set(s.groups.map((g) => g.id)); let i = 1; while (ids.has(`g${i}`)) i++; return `g${i}`; };
  for (const cl of clusters || []) {
    if (dismissed.has(cl.root)) continue;
    const eligible = cl.members.filter((k) => !human.has(k) && !excluded.has(`${cl.root}|${k}`));
    let g = autos.find((x) => !used.has(x.id) && x.root === cl.root) || autos.find((x) => !used.has(x.id) && !x.named && x.members.some((k) => cl.members.includes(k)));
    if (!g) {
      const movable = eligible.filter((k) => { const h = groupOfKey(k); return !named.has(k) && (!h || (h.auto && !h.named && !used.has(h.id))); });
      if (movable.length < 2) continue;
      g = { id: nextId(), name: uniqueName(cl.name), members: [], auto: true, root: cl.root };
      s.groups.push(g); autos.push(g);
    }
    used.add(g.id);
    const keep = new Set([...eligible, ...(g.pinned || [])]);
    g.members = g.members.filter((k) => keep.has(k));
    for (const k of eligible) {
      if (g.members.includes(k)) continue;
      const h = groupOfKey(k);
      if (h && h !== g) { if (!h.auto || h.named) continue; h.members = h.members.filter((x) => x !== k); }
      g.members.push(k);
    }
    if (g.root !== cl.root) g.root = cl.root;
    if (!g.named && g.name !== cl.name) g.name = uniqueName(cl.name, g);
  }
  // 맞는 묶음이 없는 저절로 만든 묶음은 사람이 넣은 것만 남긴다. 구성 둘 미만이면(이름을 바꾸지 않았으면) 지운다
  for (const g of autos) if (!used.has(g.id) && !g.named) g.members = g.members.filter((k) => (g.pinned || []).includes(k));
  s.groups = s.groups.filter((g) => !g.auto || g.named || g.members.length >= 2);
  for (const g of s.groups) if (g.pinned) { g.pinned = g.pinned.filter((k) => g.members.includes(k)); if (!g.pinned.length) delete g.pinned; }
  return s;
}
