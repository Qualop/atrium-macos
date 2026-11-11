// P84: 웹 화면이 죽기 전 기록과 다음 부팅의 판단(lib/crumbs.js). iPhone Safari가 판을 열자마자 페이지(WebContent)를 잃는 문제를 기기에서 잡는다.
// - 웹 화면만 한다(PC 창은 그대로). 부팅 판단은 처음 부를 때 한 번(bootState). 모듈을 읽는 순서와 상관없이 TerminalView·Canvas가 그 값을 쓴다
// - 살아 있는 동안 ALIVE_EVERY_MS마다, 가려질 때(visibilitychange)와 떠날 때(pagehide) localStorage에 적는다
// - 직전 페이지가 죽었으면 연결이 열릴 때 web.boot로 직전 상태를 보낸다(연결 기록의 boot 줄). 내용(글, 화면)은 보내지 않는다
// - 가벼운 화면: "보드로 다시 열기"(reopenBoard)는 기록을 바꾸고 페이지를 다시 읽는다
import { api } from './api.js';
import { CRUMB_KEY, ALIVE_EVERY_MS, parseCrumbs, bootDecide, crumbAlive, crumbLeave, crumbBack, chooseBoard, termBudget, crumbStep, levelHeavier, levelReset, levelPlan, crumbSent } from './lib/crumbs.js';
// P86: 보드를 여는 단계마다 그 자리에서 적는 단계 기록(step), 다시 열 때마다 한 단계씩 가벼워지는 보드(boardLevel), 살아남은 단계를 연결 기록에(web.level)

const webPage = () => typeof window !== 'undefined' && !!(window.mt ? window.mt.web : true); // web.js가 window.mt.web을 둔다. Electron은 preload가 먼저 둔다
const store = () => { try { return window.localStorage; } catch { return null; } };
const read = () => { try { return parseCrumbs(store().getItem(CRUMB_KEY)); } catch { return parseCrumbs(null); } };
const write = (s) => { try { store().setItem(CRUMB_KEY, JSON.stringify(s)); } catch {} };

let decided = null;
let leaving = false;
export function bootState() {
  if (decided) return decided;
  if (!webPage()) return (decided = { web: false, crashed: false, hidden: false, light: false, report: null, level: 0, ok: false, stepped: false });
  const d = bootDecide(read());
  write(d.state);
  // 정상 떠남은 짝 맺기·본인 확인 화면에서도 적는다(그 화면을 다시 읽는 것을 죽음으로 보지 않게)
  // 떠날 때는 pagehide 뒤에 visibilitychange(hidden)가 온다. 떠나는 동안은 살아 있다는 기록으로 정상 떠남을 덮지 않는다
  window.addEventListener('pagehide', () => { leaving = true; const s = read(), n = crumbLeave(s); write(n); if (n.ok && !s.ok) noteLevel(n.level, 'leave'); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { leaving = false; write(crumbBack(read())); } });
  return (decided = { web: true, ...d });
}
export const lightMode = () => bootState().light;
// P86: 이 부팅의 보드 단계(0 전부 켬 … 4)와 단계마다 끄는 것(lib/crumbs.js levelPlan). PC 창은 늘 0
export const boardLevel = () => bootState().level || 0;
export const boardPlan = () => levelPlan(boardLevel());
// P86: 단계 기록. 그 자리에서(동기로) localStorage에 적는다. 이름마다 한 부팅에 적는 수를 줄여 기록이 넘치지 않게 한다
const STEP_LIMIT = { msg: 8, term: 6, fw0: 6, fw1: 6, hist: 6, att: 6, fit: 4, vp: 4, board: 3 };
const stepCount = new Map();
export function step(name, vals) {
  const b = bootState();
  if (!b.web || leaving) return;
  const n = (stepCount.get(name) || 0) + 1;
  stepCount.set(name, n);
  if (n > (STEP_LIMIT[name] || 2)) return;
  try { write(crumbStep(read(), name, vals)); } catch {}
}
// 살아남은 단계를 연결 기록에 한 번 남긴다(level 줄). 떠나는 중에는 소켓이 닫혀 보내지 못할 수 있다(다음 부팅의 boot 줄에 level이 보인다)
let levelSent = false;
function noteLevel(level, why) {
  if (levelSent) return;
  levelSent = true;
  api.call('web.level', { level, why }).catch(() => { levelSent = false; });
}
const coarse = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } };
// 이 화면의 터미널 예산(lib/crumbs.js termBudget): { max, webgl }
export const termBudgetNow = (maxControllers, webglBudget) => termBudget({ web: bootState().web, coarse: coarse(), light: lightMode(), maxControllers, webglBudget });

let sampler = () => ({});
// 살아 있는 상태를 재는 함수(main.jsx가 준다): { view, terms, px, atlas, gl }
export function setCrumbSampler(fn) { sampler = fn; }
function sample() {
  let s = {};
  try { s = sampler() || {}; } catch {}
  return { ...s, dpr: window.devicePixelRatio || 1, inB: api.inB || 0, hidden: document.visibilityState === 'hidden' };
}

let started = false;
export function startCrashWatch() {
  const b = bootState();
  if (!b.web || started) return;
  started = true;
  api.onStep = step; // P86: 소켓 열림, 큰 메시지
  step('boot', { lv: b.level, ok: b.ok ? 1 : 0, dpr: window.devicePixelRatio || 1, w: window.innerWidth, h: window.innerHeight });
  const alive = () => { if (leaving) return; const s = read(), n = crumbAlive(s, sample()); write(n); if (n.ok && !s.ok) noteLevel(n.level, 'alive'); };
  alive();
  setInterval(alive, ALIVE_EVERY_MS);
  document.addEventListener('visibilitychange', alive);
  if (b.crashed) {
    // P87: 한 번 알린 죽음은 다시 알리지 않는다. 답을 받기 전에 소켓이 끊기면(P82) 다시 붙을 때 또 보내므로 id(죽은 페이지의 부팅 시각)를 붙여
    // 백엔드가 같은 것을 한 번만 남기고, 답을 받으면 기기에 적어(crumbSent) 다음 연결과 다음 부팅이 다시 보내지 않는다
    let sent = false, busy = false;
    const id = b.reportId;
    const send = () => {
      if (sent || busy) return;
      if (id != null && read().sent === id) { sent = true; return; }
      busy = true;
      api.call('web.boot', { crashed: true, id, light: b.light, crash: b.report, level: b.level }).then(() => { sent = true; write(crumbSent(read(), id)); }, () => {}).finally(() => { busy = false; });
    };
    api.on('$open', send);
    if (api.conn && api.conn.phase === 'open') send();
  }
}
// 가벼운 화면의 "보드로 다시 열기"(P86: 보드는 지금 단계로 열린다. 죽을 때마다 한 단계씩 가벼워진다)
export function reopenBoard() {
  write(chooseBoard(read()));
  location.reload();
}
// P86: 단계 띠의 "한 단계 무겁게", "처음으로"
export function boardHeavier() { write(levelHeavier(read())); location.reload(); }
export function boardReset() { write(levelReset(read())); location.reload(); }
