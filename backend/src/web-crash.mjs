// P84: 웹 화면(휴대폰 Safari 등)이 정상 떠남(pagehide) 없이 다시 읽혔을 때 창이 알리는 직전 상태. 연결 기록(remote-log.jsonl)의 boot 줄에 남는다.
// 창(app/src/renderer/lib/crumbs.js)이 localStorage에 적어 둔 값을 다음 부팅에 web.boot로 보낸다. 정한 숫자와 짧은 코드만 받는다(글·화면 내용 없음).
// - ago: 마지막으로 살아 있던 때부터 다음 부팅까지 ms, up: 부팅부터 마지막으로 살아 있던 때까지 ms
// - view: 화면(board 보드, list 목록, session 목록의 세션, full 전체 보기), terms: 붙은 터미널 수, px: 터미널 캔버스 장치 픽셀 합, atlas: 글자 아틀라스 장치 픽셀 합,
//   gl: WebGL 터미널 수, dpr: devicePixelRatio, inB: 받은 바이트, boots: 짧은 사이에 이어 죽은 수, hidden: 가려진(백그라운드) 채 죽음,
//   light: 가벼운 화면에서 죽음, retry: 가벼운 화면에서 "보드로 다시 열기"를 누른 뒤 죽음
// P86: level: 그 페이지의 보드 단계(1~4, 0은 적지 않음), steps: 죽기 직전의 마지막 단계들(app/src/renderer/lib/crumbs.js stepOf). 단계마다 이름, 부팅부터 ms, 숫자 값과 종류 이름(k)만
export const CRASH_VIEWS = ['board', 'list', 'session', 'full'];
const int = (v, max) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : null);

export function crashInfo(f) {
  if (!f || typeof f !== 'object') return null;
  const o = {};
  for (const [k, max] of [['ago', 864e5 * 30], ['up', 864e5 * 30], ['terms', 999], ['px', 1e10], ['atlas', 1e10], ['gl', 999], ['inB', 1e13], ['boots', 999]]) { const v = int(f[k], max); if (v != null) o[k] = v; }
  if (CRASH_VIEWS.includes(f.view)) o.view = f.view;
  if (Number.isFinite(f.dpr) && f.dpr > 0 && f.dpr <= 10) o.dpr = Math.round(f.dpr * 100) / 100;
  for (const k of ['hidden', 'light', 'retry']) if (f[k] === true) o[k] = true;
  if (Number.isInteger(f.level) && f.level > 0 && f.level <= LEVEL_MAX) o.level = f.level; // P86
  const steps = stepsInfo(f.steps); if (steps) o.steps = steps; // P86
  return Object.keys(o).length ? o : null;
}

// P86: 보드 단계와 단계 기록
export const LEVEL_MAX = 4;
export const STEP_MAX = 14; // 창의 STEP_REPORT와 같다
const STEP_NAME = /^[a-z][a-z0-9]{0,11}$/, STEP_KEY = /^[a-z][a-z0-9]{0,5}$/, STEP_CODE = /^[A-Za-z0-9._:-]{1,32}$/;
export function stepsInfo(a) {
  if (!Array.isArray(a)) return null;
  const out = [];
  for (const x of a.slice(-STEP_MAX)) {
    if (!x || typeof x !== 'object' || !STEP_NAME.test(String(x.s))) continue;
    const o = { s: String(x.s) };
    if (Number.isFinite(x.t) && x.t >= 0) o.t = Math.min(Math.round(x.t), 864e5);
    let n = 0;
    for (const [k, v] of Object.entries(x)) {
      if (k === 's' || k === 't' || n >= 8 || !STEP_KEY.test(k)) continue;
      if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e10) { o[k] = Math.round(v * 1000) / 1000; n++; }
      else if (k === 'k' && typeof v === 'string' && STEP_CODE.test(v)) { o.k = v; n++; }
    }
    out.push(o);
  }
  return out.length ? out : null;
}
// 단계들의 짧은 글(연결 기록 화면과 CLI). 예: "open 1.2s › msg board.get 26K 1.3s › term 175x33 cw 8.4 1.5s"
const kb = (b) => (b >= 1000 ? `${Math.round(b / 1000)}K` : `${b}B`);
export function stepsLabel(steps) {
  if (!Array.isArray(steps) || !steps.length) return '';
  return steps.map((x) => {
    const p = [x.s];
    if (x.k) p.push(x.k);
    if (x.b != null) p.push(kb(x.b));
    if (x.c != null && x.r != null) p.push(`${x.c}x${x.r}`);
    for (const [k, v] of Object.entries(x)) if (!['s', 't', 'k', 'b', 'c', 'r'].includes(k)) p.push(`${k} ${v}`);
    if (x.t != null) p.push(`${(x.t / 1000).toFixed(1)}s`);
    return p.join(' ');
  }).join(' › ');
}

// 연결 기록 화면과 CLI의 짧은 글(예: "board · 3 term · 2.1M px · gl 3 · dpr 3 · 6.0s")
export function crashLabel(c) {
  if (!c) return '';
  const parts = [];
  if (c.view) parts.push(c.view);
  if (c.terms != null) parts.push(`${c.terms} term`);
  if (c.px != null || c.atlas != null) parts.push(`${(((c.px || 0) + (c.atlas || 0)) / 1e6).toFixed(1)}M px`);
  if (c.gl != null) parts.push(`gl ${c.gl}`);
  if (c.dpr != null) parts.push(`dpr ${c.dpr}`);
  if (c.up != null) parts.push(`${(c.up / 1000).toFixed(c.up < 10000 ? 1 : 0)}s`);
  if (c.hidden) parts.push('hidden');
  if (c.light) parts.push('light');
  if (c.level) parts.push(`L${c.level}`); // P86
  return parts.join(' · ');
}
