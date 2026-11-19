// P107: 작업 중 테두리 빛. 판(캔버스)의 일하는 노드 둘레(.mt-node-run, P85)와 미션 맵의 일하는 카드 테두리 빛(PC Mission.jsx, 휴대폰 PhoneMission.jsx,
// styles.css·phone.css P107 덩어리). P102 번쩍임(lib/mission-flash.js)을 갈음한다.
// - 판 설정 workLight(on: 늘 돈다, 기본 / system: 운영체제의 움직임 줄이기를 따른다 / off: 멈춘 상태 색 테두리)를 문서 뿌리 data-work-light로 옮긴다.
//   도는지는 CSS가 정한다(값이 없을 때도 켬으로 본다, system은 @media prefers-reduced-motion, 가벼운 판 html.mt-lite는 늘 멈춤 또는 숨김).
//   사용자의 PC는 Windows "애니메이션 효과"가 꺼져 있어 창이 늘 prefers-reduced-motion: reduce다. 운영체제 설정만 따르면 그 PC에서는 영원히 보이지 않아 기본을 켬으로 했다.
// - 미션 맵 덮개를 연 동안은 문서 뿌리 data-mm-open="1": 덮개(불투명) 뒤 판 노드 둘레를 멈춘다(보이지 않는데 합성이 매 프레임 돌았다, 작업 기록).
// - 박자: 카드가 언제 생겼든 모든 빛이 같은 자리에서 돌도록, 빛 층 안의 움직임(가상 요소 포함)이 시작되면(animationstart) 시작 시각을 문서 시간 0에 맞춘다.
//   한 번만 바꾸므로 매 프레임 일은 없다. 설정을 바꿔 움직임이 다시 생기면 animationstart가 다시 와서 맞춘다.
export const LIGHT_MODES = ['on', 'system', 'off'];
export const workLightOf = (settings) => (settings && LIGHT_MODES.includes(settings.workLight) ? settings.workLight : 'on');

const rootOf = (doc) => { const root = doc && doc.documentElement; return root && root.dataset ? root : null; };
const defDoc = () => (typeof document !== 'undefined' ? document : null);

// 설정 값을 문서 뿌리에 적는다(PC 창·웹·휴대폰이 같은 판 설정을 따른다). 문서가 없어도 던지지 않는다
export function applyWorkLight(settings, doc = defDoc()) {
  const root = rootOf(doc);
  if (!root) return null;
  const mode = workLightOf(settings);
  if (root.dataset.workLight !== mode) root.dataset.workLight = mode;
  return mode;
}

// 미션 맵 덮개가 열렸는지를 문서 뿌리에(뒤의 판 노드 둘레를 멈춘다). 닫으면 지운다
export function applyMissionOpen(open, doc = defDoc()) {
  const root = rootOf(doc);
  if (!root) return null;
  if (open) root.dataset.mmOpen = '1'; else delete root.dataset.mmOpen;
  return !!open;
}

// 빛 층(과 그 아래 가상 요소)의 움직임을 문서 시간 0에서 시작한 것으로 맞춘다
export function alignLight(el) {
  if (!el || typeof el.getAnimations !== 'function') return;
  let list = [];
  try { list = el.getAnimations({ subtree: true }); } catch { try { list = el.getAnimations(); } catch { list = []; } }
  for (const a of list) if (a.startTime !== 0) { try { a.startTime = 0; } catch { /* 옛 브라우저: 박자만 어긋난다 */ } }
}
export const onLightStart = (e) => alignLight(e.currentTarget);

// P127: 판을 움직이는 동안(휠 확대·축소, 끌기, 코드·손가락 이동) 판 노드의 작업 중 둘레(.mt-node-run)를 멈춘다.
//   P124 측정에서 일하는 노드 여섯의 도는 둘레가 끌기 바쁨의 약 18%(스타일·프리페인트·layerize)였다. 움직이는 동안에는 둘레가 돌아도 눈에 잘 들지 않는다.
//   문서 뿌리 data-board-moving="1"을 달면 CSS가 회전판을 animation-play-state: paused로 둔다(회전판의 모양·색은 그대로라 작업 중 테두리는 보인다).
//   마지막 움직임 뒤 MOTION_REST_MS가 지나면 떼어 멈춘 자리에서 이어서 돌린다(판 둘레는 박자를 맞추지 않는다. 화면 밖 둘레도 따로 멈춘다, SessionNode RunRing).
//   workLight 끔·Windows 설정 따름(움직임 줄이기)·가벼운 판은 원래 돌지 않으므로 바뀌는 것이 없다. 미션 맵 카드의 빛(.mt-mm-light)은 건드리지 않는다
// 다시 돌기까지 기다림. 휠은 칸 사이가 50~150ms라 그 사이에 돌았다 멈췄다 하지 않게 넉넉히 둔다
export const MOTION_REST_MS = 400;
export function motionPauser({ doc = defDoc(), rest = MOTION_REST_MS, now = () => performance.now(), setT = setTimeout, clearT = clearTimeout } = {}) {
  const root = rootOf(doc);
  let moving = false;
  let last = 0; // 마지막 움직임 시각
  let timer = 0;
  const resume = () => {
    if (timer) { clearT(timer); timer = 0; }
    if (!moving) return;
    moving = false;
    if (root) delete root.dataset.boardMoving;
  };
  const tick = () => {
    timer = 0;
    const wait = last + rest - now();
    if (wait > 1) { timer = setT(tick, wait); return; }
    resume();
  };
  return {
    // 판 화면 변환이 바뀔 때마다 부른다(매 프레임일 수 있어 타이머는 하나만 두고 시각만 적는다)
    moved() {
      if (!root) return;
      last = now();
      if (!moving) { moving = true; root.dataset.boardMoving = '1'; }
      if (!timer) timer = setT(tick, rest);
    },
    get moving() { return moving; },
    dispose: resume,
  };
}
