// P146: 성능 기록(진단 스위치)의 창 쪽 수집기. 판 설정 perfTrace가 켜져 있는 동안만 돈다(데스크톱 창·웹 모두).
// 모으는 것: rAF 프레임 간격, 휠 입력 지연(사건 시각 → 다음 rAF), 긴 작업(longtask), 긴 애니메이션 프레임(long-animation-frame: 스타일·배치, 스크립트 몫),
//   세션 노드·대화 노드 렌더 수, 판의 노드 다시 만들기(Canvas) 수와 바뀐 노드 수, 보고 때의 노드·보이는 노드·터미널·WebGL 수, 배율.
// 층 나누기(layerize)는 페이지 안에서 잴 수 없어 긴 애니메이션 프레임의 렌더 몫으로 대신 본다.
// 30초마다(REPORT_MS) 요약을 perf.report로 보내고(백엔드가 로그에 남긴다), 끌 때 남은 것을 보낸다. 꺼져 있으면 rAF·관찰자·사건 처리기가 하나도 없다.
import { api } from './api.js';
import { getState, subscribe } from './store.js';
import { summarize, zoomOfTransform, visibleCount } from './lib/perf-summary.js';

export const REPORT_MS = 30000;
// 렌더 세기는 노드 컴포넌트가 부른다. 꺼져 있으면 불 값 하나만 본다
export const traceFlag = { on: false };
let c = null; // 모으는 중인 값

export function countRender(kind) { if (traceFlag.on && c) c.renders[kind] = (c.renders[kind] || 0) + 1; }
// Canvas가 노드 배열을 다시 만들 때(세션·배치 갱신). same: 바뀐 노드가 없어 옛 배열을 그대로 썼다
export function noteRebuild(prev, next, same) {
  if (!traceFlag.on || !c) return;
  c.rebuild.n++;
  if (same) { c.rebuild.same++; return; }
  const old = new Set(prev);
  let ch = 0;
  for (const n of next) if (!old.has(n)) ch++;
  c.rebuild.changed += ch;
}

function fresh() { return { t0: performance.now(), gaps: [], wheel: [], longTasks: [], loafs: [], renders: {}, rebuild: { n: 0, same: 0, changed: 0 }, hiddenMs: 0 }; }

function nodesNow() {
  const canvas = document.querySelector('.mt-canvas');
  const els = [...document.querySelectorAll('.react-flow__node')];
  const box = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  const vis = visibleCount(els.map((e) => e.getBoundingClientRect()), box);
  const st = getState();
  let terms = 0;
  try { terms = document.querySelectorAll('.mt-term .xterm').length; } catch {}
  return {
    total: els.length, visible: vis,
    sessions: document.querySelectorAll('.react-flow__node-session').length,
    convos: document.querySelectorAll('.react-flow__node-convo').length,
    terms, attached: (st.attached || []).length,
    webgl: document.querySelectorAll('.mt-term canvas').length,
    dom: document.getElementsByTagName('*').length,
  };
}

let raf = 0, lastT = 0, timer = 0, obs = [], pendingWheel = [];
const onWheel = (e) => { if (c) pendingWheel.push(e.timeStamp); };
function frame(t) {
  if (!c) return;
  if (lastT) c.gaps.push(t - lastT);
  lastT = t;
  if (pendingWheel.length) { for (const ts of pendingWheel) c.wheel.push(t - ts); pendingWheel = []; }
  raf = requestAnimationFrame(frame);
}

function send(reason) {
  if (!c) return;
  const now = performance.now();
  const vp = document.querySelector('.react-flow__viewport');
  const canvas = document.querySelector('.mt-canvas');
  const sum = summarize({
    sec: (now - c.t0) / 1000, gaps: c.gaps, wheel: c.wheel, longTasks: c.longTasks, loafs: c.loafs, renders: c.renders, rebuild: c.rebuild, reason,
    nodes: nodesNow(),
    view: { zoom: vp ? zoomOfTransform(vp.style.transform) : null, w: canvas ? canvas.clientWidth : innerWidth, h: canvas ? canvas.clientHeight : innerHeight, dpr: devicePixelRatio, hiddenMs: c.hiddenMs },
    phone: document.documentElement.classList.contains('mt-phone-on'),
  });
  c = fresh();
  lastT = 0;
  api.call('perf.report', sum).catch(() => {});
  return sum;
}

let hiddenAt = 0;
const onVis = () => {
  if (!c) return;
  if (document.hidden) { hiddenAt = performance.now(); lastT = 0; } // 숨은 동안의 간격은 프레임이 아니다
  else if (hiddenAt) { c.hiddenMs += performance.now() - hiddenAt; hiddenAt = 0; }
};

export function startTrace() {
  if (traceFlag.on) return;
  traceFlag.on = true;
  c = fresh(); lastT = 0; pendingWheel = [];
  window.addEventListener('wheel', onWheel, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onVis);
  raf = requestAnimationFrame(frame);
  for (const [type, key] of [['longtask', 'longTasks'], ['long-animation-frame', 'loafs']]) {
    try {
      if (!(PerformanceObserver.supportedEntryTypes || []).includes(type)) continue;
      const o = new PerformanceObserver((list) => { if (c) for (const e of list.getEntries()) c[key].push({ duration: e.duration, blockingDuration: e.blockingDuration, styleAndLayoutStart: e.styleAndLayoutStart, startTime: e.startTime, scripts: (e.scripts || []).map((s) => ({ duration: s.duration })) }); });
      o.observe({ type, buffered: false });
      obs.push(o);
    } catch { /* 이 브라우저가 모르는 종류 */ }
  }
  timer = setInterval(() => send('tick'), REPORT_MS);
}

export function stopTrace() {
  if (!traceFlag.on) return;
  send('stop');
  traceFlag.on = false;
  c = null;
  cancelAnimationFrame(raf); raf = 0;
  clearInterval(timer); timer = 0;
  for (const o of obs) try { o.disconnect(); } catch {}
  obs = [];
  window.removeEventListener('wheel', onWheel, { capture: true });
  document.removeEventListener('visibilitychange', onVis);
}

// 판 설정을 따라 켜고 끈다(main.jsx가 한 번 부른다)
export function watchPerfTrace() {
  const sync = () => { const s = getState().settings; if (s && s.perfTrace) startTrace(); else stopTrace(); };
  sync();
  return subscribe(sync);
}

if (typeof window !== 'undefined') window.__perfTrace = { send, start: startTrace, stop: stopTrace, flag: traceFlag }; // 시험이 읽는다
