// P112: 판 배율을 React 렌더 없이 따라간다. 판을 끌거나 확대·축소하는 동안 노드가 배율을 구독하면 프레임마다 노드 전체(머리줄, 터미널 감싸개 등)가
// 다시 그려져 렌더러 주 스레드가 거의 다 바빴다. 배율에 따라 바뀌는 값 가운데 CSS 변수는 여기서 요소에 바로 쓰고, 얼굴 같은 단계 값만 상태로 구독한다
import { useCallback, useEffect, useRef } from 'react';
import { useStoreApi } from '@xyflow/react';
import { zoomStep } from './lib/faces.js';
import { motionPauser } from './lib/work-light.js';

// 화면 밖 노드는 화면을 옮기는 동안 --inv 쓰기를 미룬다. --inv가 바뀌면 그 노드 하위 전체의 스타일과 머리줄 글자 배치를 다시 세므로,
// 노드가 많으면 보이지 않는 노드가 프레임 일의 대부분이었다. 노드가 화면(둘레 AWAY_PX 여유) 가까이 오는 프레임에 바로 쓰고,
// 화면 변환이 SETTLE_MS 동안 멎으면 미룬 노드에도 모두 쓴다(멈춘 화면과 보이는 노드는 예전과 같다)
const AWAY_PX = 240;
const SETTLE_MS = 150;
const late = new Set(); // 미룬 노드의 쓰기 함수
let settleTimer = 0;
let settleAt = 0;
function settleLater() {
  settleAt = performance.now() + SETTLE_MS;
  if (settleTimer) return;
  const tick = () => {
    const wait = settleAt - performance.now();
    if (wait > 1) { settleTimer = setTimeout(tick, wait); return; }
    settleTimer = 0;
    const fns = [...late];
    late.clear();
    for (const f of fns) f();
  };
  settleTimer = setTimeout(tick, SETTLE_MS);
}
// React Flow 노드(id)가 지금 화면 변환에서 화면 밖(둘레 pad px 여유 밖)인가. 자리나 화면 크기를 모르면 false(바로 쓴다)
export function awayFromView(st, id, pad = AWAY_PX) {
  const nd = id != null && st.nodeLookup ? st.nodeLookup.get(id) : null;
  if (!nd || !nd.internals || !st.width || !st.height) return false;
  const p = nd.internals.positionAbsolute;
  const w = (nd.measured && nd.measured.width) ?? nd.width, h = (nd.measured && nd.measured.height) ?? nd.height;
  if (!p || !(w > 0) || !(h > 0)) return false;
  const [tx, ty, z] = st.transform;
  const l = p.x * z + tx, t = p.y * z + ty;
  return l + w * z < -pad || t + h * z < -pad || l > st.width + pad || t > st.height + pad;
}

// 요소의 --inv(1/배율, 화면 기준 크기로 키우는 글·테두리, styles.css)를 화면 변환이 바뀔 때마다 직접 쓴다.
// 예전처럼 React style로 쓴 것과 값·형식이 같다(style.setProperty에 숫자). 돌려주는 것은 ref 콜백(React 19의 정리 함수를 돌려준다).
// id(React Flow 노드 id)를 주면 그 노드가 화면 밖일 때는 위처럼 미룬다.
// P121 stepped: 배율 대신 계단 값(lib/faces.js zoomStep, 1.1배마다)을 쓴다. 다른 워크스페이스 노드(요약 얼굴)는 계단이 바뀔 때만 스타일·글자 배치를 다시 센다
export function useInvRef(min = 0.02, id = null, stepped = false) {
  const flow = useStoreApi();
  return useCallback((el) => {
    if (!el) return undefined;
    let last = NaN;
    const zOf = stepped ? (st) => zoomStep(st.transform[2]) : (st) => st.transform[2];
    const write = () => {
      const z = zOf(flow.getState());
      if (z === last) return;
      last = z;
      el.style.setProperty('--inv', 1 / Math.max(z, min));
    };
    const put = (st) => {
      if (zOf(st) === last) return;
      if (id != null && awayFromView(st, id)) { late.add(write); settleLater(); return; }
      late.delete(write);
      write();
    };
    write();
    const off = flow.subscribe(put);
    return () => { off(); late.delete(write); };
  }, [flow, min, id, stepped]);
}

// 배율에 따라 바뀌는 인라인 style(화면 기준 크기의 이름표 글자, 손잡이 굵기)을 화면 변환이 바뀔 때마다 직접 쓴다.
// styleOf(배율) → { 속성: 값 }. 숫자는 React처럼 px를 붙이고(`${값}px`), --로 시작하는 이름은 setProperty로 쓴다. 배율이 그대로면 쓰지 않는다
// P127 stepped: 배율 대신 계단 값(lib/faces.js zoomStep, 1.1배마다)으로 센다. 영역·워크트리 상자·그룹 틀 이름표 글자는 계단이 바뀔 때만 글자 배치를 다시 센다
export function useZoomStyle(styleOf, stepped = false) {
  const flow = useStoreApi();
  const fn = useRef(styleOf);
  fn.current = styleOf;
  return useCallback((el) => {
    if (!el) return undefined;
    let last = NaN;
    const put = (st) => {
      const z = stepped ? zoomStep(st.transform[2]) : st.transform[2];
      if (z === last) return;
      last = z;
      const s = fn.current(z);
      for (const k of Object.keys(s)) {
        const v = s[k];
        if (k.startsWith('--')) el.style.setProperty(k, v);
        else el.style[k] = typeof v === 'number' ? `${v}px` : v;
      }
    };
    put(flow.getState());
    return flow.subscribe(put);
  }, [flow, stepped]);
}

// P127: 판 화면 변환(이동·배율)이 바뀌는 동안 문서 뿌리에 data-board-moving을 단다(lib/work-light.js motionPauser, 작업 중 둘레를 멈춤).
//   휠·끌기·코드(setViewport)·손가락 이동 모두 React Flow 변환으로 오므로 변환 하나만 본다. 판(Canvas)에 하나만 둔다
export function useBoardMotion() {
  const flow = useStoreApi();
  useEffect(() => {
    const p = motionPauser();
    let last = flow.getState().transform;
    const off = flow.subscribe((st) => {
      const t = st.transform;
      if (t === last || (t[0] === last[0] && t[1] === last[1] && t[2] === last[2])) return;
      last = t;
      p.moved();
    });
    return () => { off(); p.dispose(); };
  }, [flow]);
}
