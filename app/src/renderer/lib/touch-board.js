// P76: 터치로 쓰는 보드 화면(무한 캔버스)의 규칙. 순수 함수만 둔다(단위 시험 app/test/p76-lib.test.mjs). 부르는 곳은 Canvas.jsx(손가락 가르기)와 PhoneFull.jsx(전체 보기).
// - 한 손가락: 누른 자리에서 TOUCH_SLOP_PX 넘게 움직이면 판 옮기기(노드·터미널 위에서 시작해도). LONG_PRESS_MS 동안 움직이지 않으면 길게 누름(노드 옮기기).
//   그 전에 떼면 탭. 마우스 보드는 이 규칙을 쓰지 않는다(터치 이벤트만 이 길로 온다).
// - 두 손가락: 두 손가락 가운데를 축으로 확대·축소하고 가운데가 움직인 만큼 판을 옮긴다.
// - 탭: 휴대폰 세로(좁은 화면)면 그 세션의 전체 보기, 그 밖(가로, 태블릿)이면 그 노드로 확대(터미널 초점 없음).
// - 전체 보기: 아래 입력 줄과 키 줄. 키보드가 올라오면 화면을 올려 세션 아래 줄과 키 줄이 키보드 위에 남는다(패널 크기는 그대로).

export const LONG_PRESS_MS = 500; // 길게 누름(실수로 옮기지 않게 0.5초)
export const TOUCH_SLOP_PX = 8; // 이만큼 안에서 떼면 탭, 넘으면 끌기
export const TAP_MAX_MS = LONG_PRESS_MS; // 이보다 오래 누르고 떼면 탭이 아니다(길게 누름)
export const PINCH_EXIT_RATIO = 0.7; // 전체 보기에서 두 손가락 거리가 이만큼 아래로 줄면(오므리기) 나온다
export const KB_OPEN_PX = 120; // 보이는 높이가 창 높이보다 이만큼 작으면 키보드가 올라온 것(P74와 같다)

// 한 손가락 끌기 판단. dist: 누른 자리에서 움직인 거리(px), dt: 누른 뒤 지난 시간(ms), lifted: 이미 길게 누름이 잡혔나
// → 'pending'(아직 모름) | 'pan' | 'hold'(길게 누름, 노드 옮기기)
export function oneFinger({ dist, dt, lifted = false, onNode = true }) {
  if (lifted) return 'hold';
  if (dist > TOUCH_SLOP_PX) return 'pan';
  if (onNode && dt >= LONG_PRESS_MS) return 'hold';
  return 'pending';
}
// 손가락을 뗄 때: 아직 판단하지 못한 채 짧게 눌렀다 뗐으면 탭
export function releaseKind({ mode, dist, dt }) {
  if (mode === 'pending' && dist <= TOUCH_SLOP_PX && dt < TAP_MAX_MS) return 'tap';
  if (mode === 'pending') return 'none'; // 빈 판을 오래 눌렀다 뗌
  return mode; // 'pan' | 'hold' | 'pinch'
}

// 두 손가락: 처음 뷰포트 v0, 처음 가운데 m0와 거리 d0, 지금 가운데 m와 거리 d → 새 뷰포트(m0 아래의 판 점이 m 아래로 온다)
export function pinchViewport(v0, m0, d0, m, d, { minZoom = 0.05, maxZoom = 2 } = {}) {
  const zoom = Math.min(maxZoom, Math.max(minZoom, v0.zoom * (d0 > 0 ? d / d0 : 1)));
  const px = (m0.x - v0.x) / v0.zoom, py = (m0.y - v0.y) / v0.zoom;
  return { x: m.x - px * zoom, y: m.y - py * zoom, zoom };
}
export const panViewport = (v0, dx, dy) => ({ x: v0.x + dx, y: v0.y + dy, zoom: v0.zoom });
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// 길게 누른 노드를 끈 화면 거리(px) → 판 거리
export const dragDelta = (dx, dy, zoom) => ({ dx: dx / zoom, dy: dy / zoom });

// 탭한 자리가 어떤 것인가. 노드 안의 단추·입력칸은 그대로 누른 것으로 돌린다(누르기 또는 초점). 잇기 손잡이는 노드로 본다
export const TAP_CONTROL = 'button, a[href], input, textarea, select, label, summary, [role="button"], [contenteditable="true"]';
// el.closest가 있는 요소 → { kind: 'control' | 'session' | 'item' | 'region' | 'pane', id? }
export function tapTarget(el) {
  if (!el || !el.closest) return { kind: 'pane' };
  const node = el.closest('.react-flow__node');
  const ctl = el.closest(TAP_CONTROL);
  if (ctl && !(ctl.classList && ctl.classList.contains('react-flow__handle'))) return { kind: 'control', id: node ? node.getAttribute('data-id') : null };
  if (!node) return { kind: 'pane' };
  const id = node.getAttribute('data-id');
  if (node.classList.contains('react-flow__node-session')) return { kind: 'session', id };
  if (/^(memo|kanban|convo):/.test(id || '')) return { kind: 'item', id };
  return { kind: 'region', id };
}
// 길게 눌러 옮길 수 있는 노드(세션, 메모, 칸반, 대화). 영역 이름표는 지금처럼 마우스로만
export const movableId = (t) => (t && (t.kind === 'session' || t.kind === 'item') ? t.id : null);

// 탭한 세션을 어떻게 여나: 휴대폰 세로(좁은 터치 화면)면 전체 보기, 아니면 그 노드로 확대
export const PHONE_MAX_WIDTH = 430;
export function tapAction({ width, height, coarse }) {
  return coarse && width > 0 && width <= PHONE_MAX_WIDTH && height > width ? 'full' : 'zoom';
}

// 전체 보기의 칸 나누기. vvHeight: 보이는 높이(키보드를 뺀), innerHeight: 창 높이, top·line·keys: 위 띠·입력 줄·키 줄 높이,
// closedTerm: 키보드가 닫혀 있을 때 잰 터미널 높이(없으면 지금 높이)
// → { open, room(터미널 칸이 보이는 높이), term(터미널 높이: 키보드가 열려도 그대로라 위쪽이 가려진다) }
export function fullLayout({ vvHeight, innerHeight, top, line, keys, closedTerm = null }) {
  const h = Math.max(0, Math.round(vvHeight || innerHeight || 0));
  const open = h < (innerHeight || h) - KB_OPEN_PX;
  const room = Math.max(60, h - top - line - keys);
  const term = open && closedTerm ? Math.max(room, closedTerm) : room;
  return { open, room, term };
}

// 전체 보기 입력 줄을 보낼 때: 글을 터미널에 치고(여러 줄이면 괄호 붙여넣기) 잠깐 뒤 Enter. 빈 줄이면 Enter만.
// → [{ data, delay }] (delay: 앞의 것을 보낸 뒤 기다릴 ms). 백엔드도 글과 Enter 사이를 150ms 띄운다
export const ENTER_DELAY_MS = 150;
export function linePlan(text) {
  const body = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!body.length) return [{ data: '\r', delay: 0 }];
  const multi = body.includes('\n');
  const data = multi ? `\x1b[200~${body}\x1b[201~` : body;
  return [{ data, delay: 0 }, { data: '\r', delay: ENTER_DELAY_MS }];
}
// 입력 줄의 Enter가 보내기인가(조합 중인 Enter, Shift+Enter는 아니다)
export const lineEnterSends = (e) => e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229;

// 전체 보기의 키 줄(왼쪽부터)
export const FULL_KEYS = ['esc', 'ctrlc', 'tab', 'shifttab', 'up', 'down', 'left', 'right', 'slash', 'enter'];

// P76: 휴대폰의 기본 원격 화면은 보드 화면(캔버스)이다. P74 세션 목록은 사용자가 목록 단추로 골랐을 때(pref 'list')만, 휴대폰 세로 화면에서 보인다.
// 옛 값 'board'(P74에서 보드 화면을 고른 것)는 이제 기본과 같다
export const LIST_PREF = 'list';
export const showPhoneList = ({ phone, pref }) => !!phone && pref === LIST_PREF;

// 키보드가 올라와 터미널(높이 term)의 room만 보일 때 위로 올릴 양(px). contentBottom: 글이 있는 마지막 줄(커서 줄 포함)의 아래 끝(px).
// 글이 아래까지 있으면(Claude Code의 입력 상자와 아래 줄) 아래 줄이 입력 줄 바로 위에 오게, 글이 위쪽에만 있으면(새 셸) 위쪽을 그대로 보인다
export function kbShift({ term, room, contentBottom }) {
  if (!(term > room)) return 0;
  const want = Math.ceil((contentBottom ?? term) - room);
  return Math.max(0, Math.min(term - room, want));
}
// 화면 줄 글(lines)에서 글이 있는 마지막 줄(0부터). 커서 줄(cursorY)보다 위면 커서 줄
export function lastContentRow(lines, cursorY = 0) {
  let last = -1;
  for (let i = (lines || []).length - 1; i >= 0; i--) if (String(lines[i] || '').trim()) { last = i; break; }
  return Math.max(last, cursorY || 0);
}

// P83: 손가락 화면의 명령 바(CommandBar.jsx). 입력칸에 초점이 있고 키보드가 올라오면(보이는 높이가 창 높이보다 KB_OPEN_PX 넘게 작다)
// 판 아래 끝(stageBottom, 창 좌표)에서 보이는 아래 끝(vvTop + vvHeight)까지 올린다(px). 키보드가 없으면 0
export function kbLift({ stageBottom, vvTop = 0, vvHeight, innerHeight }) {
  if (!(vvHeight > 0) || !(innerHeight > 0) || !(vvHeight < innerHeight - KB_OPEN_PX)) return 0;
  return Math.max(0, Math.round((stageBottom || 0) - ((vvTop || 0) + vvHeight)));
}
