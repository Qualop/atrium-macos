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
