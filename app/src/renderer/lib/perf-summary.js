// P146: 성능 기록 요약 계산(순수 함수). 창 쪽 수집기(perf-trace.js)가 모은 숫자 배열을 백엔드에 보낼 요약으로 줄인다.
// 백엔드(backend/src/perf-trace.mjs sanitizeReport)가 받는 키와 같다. 값만 담고 글은 담지 않는다.

const r2 = (v) => Math.round(v * 100) / 100;

// 숫자 배열 → { n, p50, p95, max, over33, over50 }. 비었으면 { n: 0 }
export function statOf(arr) {
  const n = arr ? arr.length : 0;
  if (!n) return { n: 0 };
  const s = Float64Array.from(arr).sort();
  const q = (p) => s[Math.min(n - 1, Math.floor(p * n))];
  let over33 = 0, over50 = 0;
  for (let i = 0; i < n; i++) { if (s[i] > 33) over33++; if (s[i] > 50) over50++; }
  return { n, p50: r2(q(0.5)), p95: r2(q(0.95)), max: r2(s[n - 1]), over33, over50 };
}

// 긴 작업·긴 애니메이션 프레임 목록 → { n, ms, blockingMs, styleLayoutMs, scriptMs }
// loaf 항목은 { duration, blockingDuration, styleAndLayoutStart, startTime, scripts: [{ duration }] } 모양(Long Animation Frames API)
export function loafOf(list) {
  const out = { n: 0, ms: 0, blockingMs: 0, styleLayoutMs: 0, scriptMs: 0 };
  for (const e of list || []) {
    out.n++;
    out.ms += e.duration || 0;
    out.blockingMs += e.blockingDuration || 0;
    if (e.styleAndLayoutStart > 0) out.styleLayoutMs += Math.max(0, e.startTime + e.duration - e.styleAndLayoutStart);
    for (const s of e.scripts || []) out.scriptMs += s.duration || 0;
  }
  for (const k of Object.keys(out)) out[k] = r2(out[k]);
  return out;
}
export function longTasksOf(list) {
  let ms = 0;
  for (const e of list || []) ms += e.duration || 0;
  return { n: (list || []).length, ms: r2(ms) };
}

// 판 화면 변환 글(.react-flow__viewport style.transform)에서 배율
export function zoomOfTransform(tf) {
  const m = /scale\(([-\d.e]+)\)/.exec(String(tf || ''));
  return m ? +(+m[1]).toFixed(4) : null;
}

// 사각형 목록 중 화면(view)과 겹치는 수
export function visibleCount(rects, view) {
  let n = 0;
  for (const r of rects) if (r.right > view.left && r.left < view.right && r.bottom > view.top && r.top < view.bottom && r.width > 0 && r.height > 0) n++;
  return n;
}

// 모은 값 → 보낼 요약. c: { sec, gaps, wheel, longTasks, loafs, renders, rebuild, nodes, view }
export function summarize(c) {
  return {
    sec: r2(c.sec || 0),
    frames: statOf(c.gaps),
    wheel: statOf(c.wheel),
    longTasks: longTasksOf(c.longTasks),
    loaf: loafOf(c.loafs),
    renders: { ...(c.renders || {}) },
    rebuild: { ...(c.rebuild || {}) },
    nodes: { ...(c.nodes || {}) },
    view: { ...(c.view || {}) },
    ...(c.reason ? { reason: c.reason } : {}),
    ...(c.phone ? { phone: true } : {}),
  };
}
