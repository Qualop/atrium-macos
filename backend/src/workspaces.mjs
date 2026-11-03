// 리포지토리 워크스페이스(ARCH 4절 G, P5). 순수 함수만 둔다. 창(renderer)도 이 파일을 그대로 묶어 쓴다(node 모듈을 부르지 않는다).
//
// 판의 "워크스페이스"는 리포지토리 하나다. herdr의 "작업 공간"(workspace_id, 코드에서는 herdrWorkspaceId)과 다르다.
// 코드에서 워크스페이스는 키(workspaceKey)로 가리킨다.
// - git 저장소 안에서 시작한 세션: 시작 폴더의 git 공통 폴더(`rev-parse --git-common-dir`)를 절대 경로, 슬래시, 소문자로. 워크트리도 본 저장소와 같은 키다.
// - git 저장소가 아닌 폴더: 그 폴더 자체를 같은 방식으로.
// 세션의 워크스페이스는 시작할 때 한 번 정하고, 세션이 다른 저장소로 cd해도 옮기지 않는다(BRIEF 4절 "자리는 사람이 정하고 시스템은 지킨다").

// 경로 맞추기: 역슬래시 → 슬래시, 겹친 슬래시와 끝 슬래시 빼기. 드라이브 문자와 대소문자는 키에서만 소문자로 맞춘다.
export function normPath(p) {
  const input = String(p || '').trim();
  const unc = /^(?:\\\\|\/\/)[^\\/]/.test(input);
  let s = input.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (unc) s = '/' + s;
  if (s.length > 1 && !/^[A-Za-z]:\/$/.test(s)) s = s.replace(/\/+$/, '');
  if (/^[a-z]:/.test(s)) s = s[0].toUpperCase() + s.slice(1);
  return s;
}
export const pathKey = (p) => { const n = normPath(p); return /^[A-Za-z]:\//.test(n) || /^\/\//.test(n) ? n.toLowerCase() : n; };

// rp: git.mjs parseRevParse 결과(저장소가 아니면 null), cwd: 시작 폴더
// → { key, kind: 'repo' | 'folder', root }. root는 본 저장소 폴더(워크트리면 본 저장소 쪽), 폴더면 그 폴더
export function workspaceFromProbe(rp, cwd) {
  if (rp && rp.commonDir) {
    const root = normPath(rp.mainRoot || rp.root);
    return { key: pathKey(rp.commonDir), kind: 'repo', root };
  }
  const root = normPath(cwd);
  return { key: pathKey(root), kind: 'folder', root };
}

const baseName = (p) => normPath(p).split('/').filter(Boolean).pop() || normPath(p);
const parentName = (p) => { const parts = normPath(p).split('/').filter(Boolean); return parts.length > 1 ? parts[parts.length - 2] : ''; };

// 워크스페이스 줄의 이름: 저장소(폴더) 이름. 겹치면 부모 폴더를 덧붙인다(parent/name). 그래도 겹치면 전체 경로
export function workspaceNames(list) {
  const out = new Map();
  const count = (f) => { const m = new Map(); for (const w of list) { const k = f(w).toLowerCase(); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const byBase = count((w) => baseName(w.root));
  const withParent = (w) => (parentName(w.root) ? `${parentName(w.root)}/${baseName(w.root)}` : baseName(w.root));
  const byParent = count(withParent);
  for (const w of list) {
    const b = baseName(w.root);
    if (byBase.get(b.toLowerCase()) === 1) out.set(w.key, b);
    else if (byParent.get(withParent(w).toLowerCase()) === 1) out.set(w.key, withParent(w));
    else out.set(w.key, normPath(w.root));
  }
  return out;
}

// 워크스페이스 줄의 세는 값: 세션, 작업 중, 내 차례, 검토 대기(세션 요약 목록에서)
export function workspaceCounts(sessions, key) {
  const c = { sessions: 0, working: 0, needsYou: 0, review: 0, shells: 0 };
  for (const s of sessions) {
    if (s.workspaceKey !== key) continue;
    c.sessions++;
    if (s.kind === 'shell') c.shells++;
    if (s.state === 'working') c.working++;
    if (s.state === 'waiting' || s.state === 'trust_wait') c.needsYou++;
    if (s.unseen) c.review++;
  }
  return c;
}

// 세션이 지금 자기 워크스페이스 밖(다른 저장소, 저장소 밖 폴더)에서 일하는가. 노드에 표시만 하고 워크스페이스는 옮기지 않는다(G1)
// ws: { key, kind, root }, git: 세션의 지금 폴더로 본 git(gitProbe 결과) → null 또는 { root, repo }
export function elsewhereOf(ws, git) {
  if (!ws || !git || !git.cwd) return null;
  if (git.isRepo) {
    if (ws.kind === 'repo' && pathKey(git.commonDir) === ws.key) return null;
    return { root: normPath(git.mainRoot || git.root), repo: true, name: baseName(git.mainRoot || git.root) };
  }
  if (ws.kind === 'folder') {
    const c = pathKey(git.cwd);
    if (c === ws.key || c.startsWith(ws.key.endsWith('/') ? ws.key : ws.key + '/')) return null;
  }
  return { root: normPath(git.cwd), repo: false, name: baseName(git.cwd) };
}

// 판 영역(노드와 메모·칸반)을 모두 담는 사각형. 워크스페이스에 들어갈 때 모든 세션이 보이도록 맞추는 데 쓴다(G3)
export function boundsOf(rects, pad = 60) {
  const rs = rects.filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.y));
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r.x)) - pad, y0 = Math.min(...rs.map((r) => r.y)) - pad;
  const x1 = Math.max(...rs.map((r) => r.x + (r.w || 0))) + pad, y1 = Math.max(...rs.map((r) => r.y + (r.h || 0))) + pad;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// 화면(뷰포트)에 사각형이 들어오는 배율과 위치. 배율은 [minZoom, maxZoom] 안
export function fitViewport(b, screen, { minZoom = 0.1, maxZoom = 1 } = {}) {
  if (!b) return null;
  const zoom = Math.max(minZoom, Math.min(maxZoom, screen.width / b.w, screen.height / b.h));
  return { x: (screen.width - b.w * zoom) / 2 - b.x * zoom, y: (screen.height - b.h * zoom) / 2 - b.y * zoom, zoom };
}

// 노드가 지금 화면 밖인가(세션 줄의 "화면 밖" 표시). 노드의 절반 이상이 화면 밖이면 밖으로 본다
export function offscreen(r, vp, screen) {
  if (!r || !vp) return false;
  const left = r.x * vp.zoom + vp.x, top = r.y * vp.zoom + vp.y, w = r.w * vp.zoom, h = r.h * vp.zoom;
  const iw = Math.min(left + w, screen.width) - Math.max(left, 0), ih = Math.min(top + h, screen.height) - Math.max(top, 0);
  if (iw <= 0 || ih <= 0) return true;
  return (iw * ih) / Math.max(1, w * h) < 0.5;
}
