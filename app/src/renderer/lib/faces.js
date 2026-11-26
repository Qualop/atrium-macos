// 세션 노드의 세 얼굴(ARCH 7.2)과 화면 스트림을 붙일 노드 고르기(7.4, BRIEF 위험 2). 순수 함수만 둔다(단위 시험 있음).
//
// 얼굴은 노드가 화면에서 차지하는 너비로 정한다(P2에서 정한 기준):
//   가까이(close)  화면 너비 360px 이상: 실제 터미널(xterm.js). 기본 노드 720px이면 배율 0.5 이상
//   중간(middle)   200px 이상: 대화 보기(대화 기록)
//   멀리(far)      그보다 작으면: 요약. OpenCove의 개요 모드(배율 0.4 미만)와 같은 생각
// 제어기(터미널 제어기 프로세스, 약 17MB)는 가까이 얼굴이면서 화면에 보이는 노드에만, 화면 가운데에 가까운 순서로 상한까지 붙인다.

export const FACE_CLOSE_PX = 360;
export const FACE_MIDDLE_PX = 200;
export const DEFAULT_MAX_CONTROLLERS = 8;
export const DEFAULT_WEBGL_BUDGET = 8; // OpenCove DEFAULT_WEBGL_RENDERER_BUDGET과 같은 값. 넘으면 DOM으로 그린다

// P3: 경계에서 얼굴이 흔들리지 않게 이력(hysteresis)을 둔다. 이미 가까이 얼굴인 노드는 360 - 16px까지 가까이로 남는다.
// 기본 노드 720px을 배율 0.5에 맞추면 정확히 경계(360px)라, 배율이 0.4999로만 흔들려도 모든 터미널이 한꺼번에 놓인다(E5 2.5 후보 원인, docs/log/p3-v02.md 보고 3.3).
export const FACE_HYSTERESIS_PX = 16;

// P10: 아이콘(icon) 화면 너비 140px 아래: 글을 넣지 않고 에이전트 종류 아이콘과 상태 색만(lib/kinds.js). 140px이면 12px 글자가 한 줄에 열 자 남짓이라,
// 그보다 좁으면 이름과 상태 필만으로도 줄이 깨진다. 경계 이력은 다른 얼굴과 같다
export const FACE_ICON_PX = 140;

export function faceFor(nodeWidth, zoom, prev = null) {
  const px = nodeWidth * zoom;
  if (px >= FACE_CLOSE_PX || (prev === 'close' && px >= FACE_CLOSE_PX - FACE_HYSTERESIS_PX)) return 'close';
  if (px >= FACE_MIDDLE_PX || ((prev === 'close' || prev === 'middle') && px >= FACE_MIDDLE_PX - FACE_HYSTERESIS_PX)) return 'middle';
  if (px >= FACE_ICON_PX || (prev && prev !== 'icon' && px >= FACE_ICON_PX - FACE_HYSTERESIS_PX)) return 'far';
  return 'icon';
}

// P124: 세션 노드의 거리 단계(노드가 화면에서 차지하는 너비 px로 정한다). 세 단계 사이는 뚜렷이 다르게 그린다.
//   터미널(term)  240px 이상: 터미널을 가질 수 있는 노드(termAllowed)는 터미널, 아닌 노드는 요약. 기본 노드(1440px)면 배율 0.167 이상(예전 0.25보다 먼 곳부터)
//   요약(brief)   120px 이상: 이름, 상태, 기다리는 질문, 마지막 요청과 답(멀리 얼굴). 대화 보기(중간 얼굴)는 판 노드에 쓰지 않는다
//   틀(frame)     그보다 작으면: 글 없이 노드 외곽, 상태 색 바탕, 상태 표지(응답 필요·작업 중·작업 완료·오류)만. 이름도 그리지 않는다(마우스를 올리면 제목으로 보인다)
// 경계 여유: 한 단계 위에 있던 노드는 경계의 88%까지 그 단계에 남는다(240 → 211px, 120 → 106px). 휠 한 칸(약 5%)으로는 넘나들지 않는다
export const TIER_TERM_PX = 240;
export const TIER_BRIEF_PX = 120;
export const TIER_KEEP = 0.88;
export function tierFor(px, prev = null) {
  if (!(px >= 0)) px = 0;
  if (px >= TIER_TERM_PX || (prev === 'term' && px >= TIER_TERM_PX * TIER_KEEP)) return 'term';
  if (px >= TIER_BRIEF_PX || ((prev === 'term' || prev === 'brief') && px >= TIER_BRIEF_PX * TIER_KEEP)) return 'brief';
  return 'frame';
}
// 단계와 터미널 허용으로 얼굴(styles.css face-*): term이면 close(터미널) 또는 far(요약), brief면 far, frame이면 icon(틀)
export const faceOfTier = (tier, allowed) => (tier === 'term' ? (allowed ? 'close' : 'far') : tier === 'brief' ? 'far' : 'icon');

// P121: 터미널은 고른 워크스페이스의 세션만 갖는다. 다른 워크스페이스의 세션은 가까이 크기여도 요약 얼굴(far)을 보이고,
// 그 노드를 누르거나(초점) 고르거나, 노드가 화면을 아주 가깝게 채울 만큼 확대하면 터미널을 갖는다.
// "아주 가까이": 노드가 화면에 보이는 넓이가 캔버스 넓이의 35% 이상(16:9 노드가 16:9 캔버스 너비의 60%쯤을 채울 때). 노드를 누르면 85%를 채우게 옮기므로(H4)
// 그보다 작은 값이다. 노드 크기가 아니라 화면 안에 든 넓이로 보므로, 누른 노드 곁에 조금 걸친 이웃 노드는 아니다.
// 이미 아주 가까이였던 노드는 30%까지 남는다(경계에서 터미널이 붙었다 떨어졌다 하지 않게)
export const VERY_CLOSE_FRAC = 0.35;
export const VERY_CLOSE_KEEP = 0.3;
// rect: 노드 { x, y, w, h }(판 좌표), viewport: { x, y, zoom }, screen: { width, height }
export function veryClose(rect, viewport, screen, prev = false) {
  if (!rect || !viewport || !screen || !(screen.width > 0) || !(screen.height > 0)) return false;
  const { x: vx, y: vy, zoom } = viewport;
  const l = Math.max(0, rect.x * zoom + vx), t = Math.max(0, rect.y * zoom + vy);
  const r = Math.min(screen.width, (rect.x + rect.w) * zoom + vx), b = Math.min(screen.height, (rect.y + rect.h) * zoom + vy);
  if (r <= l || b <= t) return false;
  return (r - l) * (b - t) >= screen.width * screen.height * (prev ? VERY_CLOSE_KEEP : VERY_CLOSE_FRAC);
}
// P124: 초점·고른 노드의 짝. 같은 덩어리(dock)의 노드와 부모·자식 세션은 초점·고른 노드처럼 터미널을 가질 수 있다(사용자 보고: 부모 곁에 붙은 작은
//   하위 세션을 가운데 두고 보면 화면에 걸친 부모 터미널이 요약으로 바뀌었다). 화면에 보이는지와 터미널 단계는 예전대로 pickAttached가 본다.
// P167: 판에 선으로 바로 이어진 세션도 짝이다(다른 워크스페이스여도). 판이 그리는 연결 선(띄움·시킴·역할. 동료·하위처럼 정한 관계도
//   백엔드가 연결을 열어 선으로 보인다)이 seed에 닿고 두 끝이 판에 있으면 넣는다. 지운 연결(removedAt)은 빼고, 한 단계만 본다.
// seeds: 초점·고른 노드 id들, docks: [{ members }], parentOf(id): 부모 세션 id 또는 null, ids: 판의 세션 id들(자식 찾기)
// links: [{ from, to, removedAt? }](열린 연결), onBoard(id): 그 세션이 판에 노드로 있나(선이 보이는 쌍만)
export function matesOf({ seeds, docks = [], parentOf = () => null, ids = [], links = [], onBoard = () => true }) {
  const set = new Set([...(seeds || [])].filter((x) => x != null));
  const out = new Set();
  if (!set.size) return out;
  for (const d of docks) if (d && d.members && d.members.some((m) => set.has(m))) for (const m of d.members) out.add(m);
  for (const id of set) { const p = parentOf(id); if (p) out.add(p); }
  for (const id of ids) { const p = parentOf(id); if (p && set.has(p)) out.add(id); }
  for (const l of links) {
    if (!l || l.removedAt || !l.from || !l.to || l.from === l.to) continue;
    const other = set.has(l.from) ? l.to : set.has(l.to) ? l.from : null;
    if (other && onBoard(l.from) && onBoard(l.to)) out.add(other);
  }
  for (const id of set) out.delete(id);
  return out;
}
// 이 세션 노드가 터미널을 가질 수 있나. viewWs: 고른 워크스페이스 키(null이면 고른 것 없음: 초점·고른 노드·아주 가까운 노드만).
// ws: 노드의 워크스페이스 키, focus: 초점 노드 id, selected: 고른 노드 id 모음(Set), near: 아주 가까이(veryClose)
export function termAllowed({ id, ws, viewWs, focus = null, selected = null, near = false, mates = null }) {
  if (near) return true;
  if (mates && mates.has(id)) return true; // P124: 초점·고른 노드와 같은 덩어리, 부모·자식. P167: 선으로 바로 이어진 세션
  if (id != null && id === focus) return true;
  if (selected && selected.has(id)) return true;
  return viewWs != null && (ws || null) === viewWs;
}
// 다른 워크스페이스 노드(요약 얼굴)의 글자 크기는 배율을 계단으로 따른다. 배율 1.1배마다 한 계단(가장 가까운 계단으로 반올림, 차이 ±5% 안).
// 판을 확대·축소하는 동안 이 노드들은 계단이 바뀔 때만 다시 그린다(P112의 매 프레임 글자 크기 맞추기를 하지 않는다)
export const ZOOM_STEP = 1.1;
export const zoomStep = (z) => { const v = Math.max(Number.isFinite(z) ? z : 1, 0.02); return ZOOM_STEP ** Math.round(Math.log(v) / Math.log(ZOOM_STEP)); };

// nodes: [{ id, x, y, w, h, ws? }] (판 좌표), viewport: { x, y, zoom } (React Flow), screen: { width, height } (화면 px)
// 돌려줌: 제어기를 붙일 노드 id 목록(가까운 순). margin만큼 화면 밖도 보이는 것으로 친다(끌 때 깜빡이지 않게).
// prev: 지금 붙어 있는 노드 id 모음. 그 노드에는 얼굴 이력을 적용한다(SessionNode와 같은 기준).
// focus(초점 노드 id), selected(고른 노드 id 모음): 보이고 가까이 얼굴이면 거리와 상관없이 상한 안에 먼저 넣는다(이슈 #1-16). 초점이 먼저다
// P121 wsLimit: { key } 를 주면 termAllowed를 따른다(key가 고른 워크스페이스, null이면 고른 것 없음). 주지 않으면 워크스페이스로 거르지 않는다
export function pickAttached(nodes, viewport, screen, { max = DEFAULT_MAX_CONTROLLERS, margin = 80, prev = null, focusId = null, focus = focusId, selected = null, wsLimit = null, mates = null } = {}) {
  const { x: vx, y: vy, zoom } = viewport;
  const cx = screen.width / 2, cy = screen.height / 2;
  const seen = [];
  for (const n of nodes) {
    if (tierFor(n.w * zoom, prev && prev.has(n.id) ? 'term' : null) !== 'term') continue; // P124: 터미널 단계(예전 가까이 얼굴 360px)
    if (wsLimit && !termAllowed({ id: n.id, ws: n.ws, viewWs: wsLimit.key ?? null, focus, selected, mates, near: veryClose(n, viewport, screen, !!(prev && prev.has(n.id))) })) continue;
    const left = n.x * zoom + vx, top = n.y * zoom + vy, right = left + n.w * zoom, bottom = top + n.h * zoom;
    if (right < -margin || bottom < -margin || left > screen.width + margin || top > screen.height + margin) continue;
    const dx = clampDist(cx, left, right), dy = clampDist(cy, top, bottom);
    seen.push({ id: n.id, d: dx * dx + dy * dy, rank: n.id === focus ? 0 : selected && selected.has(n.id) ? 1 : mates && mates.has(n.id) ? 2 : 3 }); // P124: 짝은 상한 안에서 초점·고른 노드 다음
  }
  seen.sort((a, b) => a.rank - b.rank || a.d - b.d);
  return seen.slice(0, max).map((s) => s.id);
}
const clampDist = (c, lo, hi) => (c < lo ? lo - c : c > hi ? c - hi : 0);

// WebGL 렌더러 예산(BRIEF 위험 2). Chromium은 살아 있는 WebGL 컨텍스트 수가 적고 넘으면 오래된 것부터 잃는다.
// 예산 안이면 WebGL, 넘으면 DOM. 컨텍스트를 잃으면 그 터미널은 DOM으로 돌아가고 자리를 돌려준다.
export class RendererBudget {
  constructor(budget = DEFAULT_WEBGL_BUDGET) { this.budget = budget; this.holders = new Set(); this.lost = 0; }
  acquire(id) {
    if (this.holders.has(id)) return 'webgl';
    if (this.holders.size >= this.budget) return 'dom';
    this.holders.add(id);
    return 'webgl';
  }
  release(id, { contextLost = false } = {}) { if (this.holders.delete(id) && contextLost) this.lost++; }
  get used() { return this.holders.size; }
}

// N 이동 순서: 내 차례(waiting, trust_wait)를 오래 기다린 순서로, 그다음 오류(ARCH 4절 A1, 참고 제품의 needs you는 오류도 포함)
export function inboxOf(sessions) {
  const askSince = (s) => s.waitingSince || (s.ask && s.ask.since) || s.createdAt;
  const needsYou = sessions.filter((s) => s.state === 'waiting' || s.state === 'trust_wait').sort((a, b) => askSince(a) - askSince(b));
  const review = sessions.filter((s) => s.unseen && s.state !== 'waiting' && s.state !== 'trust_wait').sort((a, b) => ((a.turn && a.turn.endedAt) || 0) - ((b.turn && b.turn.endedAt) || 0));
  const problems = sessions.filter((s) => s.state === 'error' || (s.state === 'exited' && s.exit && s.exit.kind !== 'normal' && s.exit.kind !== 'user')); // P125: 사람이 닫은 것은 문제가 아니다
  return { needsYou, review, problems };
}

export function nextTarget(order, currentId) {
  if (!order.length) return null;
  const i = order.indexOf(currentId);
  return order[(i + 1) % order.length];
}
