// P84: 웹 화면이 죽기 전 기록(빵 부스러기)과 다음 부팅의 판단. 순수 함수만 둔다(단위 시험 test/p84-lib.test.mjs). 적고 읽는 것은 crash-watch.js다.
// - 화면이 ALIVE_EVERY_MS마다 자기 상태(화면, 붙은 터미널 수, 캔버스·아틀라스 장치 픽셀, WebGL 수, DPR, 받은 바이트)와 살아 있던 시각을 localStorage(CRUMB_KEY)에 적는다.
//   정상으로 떠나면(pagehide) clean을 적는다. bfcache에서 돌아오면(pageshow persisted) 다시 지운다.
// - 다음 부팅이 clean 없이 시작되면 직전 페이지가 죽은 것이다(iOS Safari의 WebContent가 메모리로 죽으면 pagehide가 오지 않는다).
//   가려진(백그라운드) 채 죽었으면(iOS가 뒤의 탭을 정리) 기록은 남기되 가벼운 화면 판단에는 세지 않는다.
// - CRASH_WINDOW_MS 안에 두 번 죽으면 다음 부팅은 가벼운 화면(휴대폰은 목록 화면, 터미널은 고른 하나, WebGL 없음)으로 연다.
//   가벼운 화면은 사람이 "보드로 다시 열기"를 누를 때까지 이어진다. 다시 연 보드가 정상으로 떠나기 전에 또 죽으면 한 번으로도 다시 가벼운 화면이다.
export const CRUMB_KEY = 'mt.crumbs';
export const ALIVE_EVERY_MS = 2000;
export const CRASH_WINDOW_MS = 60_000; // 이 사이에 두 번 죽으면 가벼운 화면
export const CRASH_KEEP_MS = 15 * 60_000; // 이보다 오래된 죽음은 세지 않는다

const num = (v) => (Number.isFinite(v) ? v : null);
// P86: 보드 단계(0 = 전부 켬 … LEVEL_MAX). level: 다음 보드 부팅이 쓸 단계, ok: 그 단계에서 살아남은 적이 있다(기기에 기억)
export const LEVEL_MAX = 4;
const levelOf = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, LEVEL_MAX) : 0);
// 적어 둔 글 → 상태. 모양이 다르면 처음 상태
export function parseCrumbs(text) {
  let j = null;
  try { j = JSON.parse(text || 'null'); } catch {}
  if (!j || typeof j !== 'object' || j.v !== 1) return { v: 1, cur: null, crashes: [], light: false, retry: null, level: 0, ok: false, sent: null };
  return {
    v: 1,
    cur: j.cur && typeof j.cur === 'object' && Number.isFinite(j.cur.boot) ? j.cur : null,
    crashes: Array.isArray(j.crashes) ? j.crashes.filter(Number.isFinite).slice(-10) : [],
    light: j.light === true,
    retry: num(j.retry),
    level: levelOf(j.level),
    ok: j.ok === true,
    sent: num(j.sent), // P87: 백엔드가 받았다고 답한 마지막 죽음(죽은 페이지의 부팅 시각)
  };
}

// 다음 부팅의 판단. 돌려줌: { crashed, hidden, light, report(백엔드에 보낼 직전 상태, 죽지 않았으면 null), state(새로 적을 상태) }
export function bootDecide(stored, now = Date.now()) {
  const s = stored || parseCrumbs(null);
  const prev = s.cur;
  // P87: 이미 알리고 센 죽음(sent)은 다시 죽음으로 보지 않는다. 같은 기록을 두 번 세면 1분 안에 두 번 죽은 것이 되어 가벼운 화면으로 열린다
  const crashed = !!prev && !prev.clean && !(s.sent != null && prev.boot === s.sent);
  const hidden = crashed && prev.hidden === true;
  const at = crashed ? num(prev.alive) ?? prev.boot : null;
  const crashes = s.crashes.filter((t) => now - t < CRASH_KEEP_MS);
  if (crashed && !hidden && !crashes.includes(at)) crashes.push(at);
  let light = s.light;
  if (!light && crashed && !hidden) {
    if (prev.retryBoot === true) light = true; // "보드로 다시 열기"로 연 보드가 또 죽었다
    else if (crashes.length >= 2 && crashes[crashes.length - 1] - crashes[crashes.length - 2] <= CRASH_WINDOW_MS) light = true;
  }
  const report = crashed ? reportOf(prev, now, { boots: crashes.length }) : null;
  const retry = light ? null : s.retry;
  // P86: 보드로 연 페이지가 죽으면(가려진 채 죽음, 목록에서 죽음은 빼고) 다음 보드는 한 단계 가볍게. 살아남은 단계는 ok로 기억한다
  let level = levelOf(s.level), ok = s.ok === true, stepped = false;
  if (crashed && !hidden && prev.mode !== 'light' && prev.view !== 'list' && prev.view !== 'session') {
    const at = levelOf(prev.level);
    if (at >= level) { level = Math.min(at + 1, LEVEL_MAX); ok = false; stepped = level !== at; }
  }
  const state = { v: 1, cur: { boot: now, alive: now, clean: false, light, retryBoot: retry != null, mode: light ? 'light' : 'board', level }, crashes: light ? [] : crashes.slice(-10), light, retry, level, ok, sent: num(s.sent) };
  // P87: reportId는 죽은 페이지의 부팅 시각. 백엔드는 같은 id를 한 번만 남기고(web.boot), 받았다는 답이 오면 sent에 적는다(crumbSent)
  return { crashed, hidden, light, report, reportId: crashed ? prev.boot : null, state, level, ok, stepped };
}

// P86: 단계 기록. 보드를 여는 단계마다(소켓 열림, 큰 메시지, 판 적용, 첫 그리기, 화면 맞춤, 터미널 붙기, 첫 프레임 쓰기) 그 자리에서 적는다(2초 주기와 별도).
// 한 단계 = { s: 이름, t: 부팅부터 ms, 값 몇 개 }. 값은 숫자와 k(종류 이름, 짧은 코드)만 받는다. 글·화면 내용이 들어갈 자리가 없다
export const STEP_KEEP = 20; // 기기에 남기는 단계 수
export const STEP_REPORT = 14; // boot 줄로 보내는 단계 수
// 줄일 때도 남기는 이정표(이름마다 처음 것): 부팅, 소켓 열림, 판 적용, 첫 그리기, 화면 맞춤. 나머지는 마지막 것부터 채운다(죽기 직전이 중요하다)
export const STEP_MILESTONES = ['boot', 'open', 'board', 'paint', 'fit'];
export function keepSteps(list, n) {
  const a = Array.isArray(list) ? list.filter((x) => x && typeof x === 'object') : [];
  if (a.length <= n) return a;
  const seen = new Set(), keep = new Set();
  a.forEach((x, i) => { if (STEP_MILESTONES.includes(x.s) && !seen.has(x.s)) { seen.add(x.s); keep.add(i); } });
  for (let i = a.length - 1; i >= 0 && keep.size < n; i--) keep.add(i);
  return a.filter((_, i) => keep.has(i));
}
const STEP_NAME = /^[a-z][a-z0-9]{0,11}$/, STEP_KEY = /^[a-z][a-z0-9]{0,5}$/, STEP_CODE = /^[A-Za-z0-9._:-]{1,32}$/;
export function stepOf(name, vals = {}, t = 0) {
  if (!STEP_NAME.test(String(name))) return null;
  const o = { s: String(name), t: Number.isFinite(t) ? Math.max(0, Math.round(t)) : 0 };
  let n = 0;
  for (const [k, v] of Object.entries(vals && typeof vals === 'object' ? vals : {})) {
    if (n >= 8 || k === 's' || k === 't' || !STEP_KEY.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) { o[k] = Math.round(v * 1000) / 1000; n++; }
    else if (k === 'k' && typeof v === 'string' && STEP_CODE.test(v)) { o.k = v; n++; }
  }
  return o;
}
// 단계 하나를 더한 상태. 'paint'(보드 첫 그리기)면 보드가 선 때를 적는다(살아남은 단계 판단)
export function crumbStep(s, name, vals, now = Date.now()) {
  if (!s || !s.cur) return s;
  const st = stepOf(name, vals, now - s.cur.boot);
  if (!st) return s;
  const steps = keepSteps([...(Array.isArray(s.cur.steps) ? s.cur.steps : []), st], STEP_KEEP);
  return { ...s, cur: { ...s.cur, steps, ...(st.s === 'paint' && !s.cur.boardAt ? { boardAt: now } : {}) } };
}
// 보드가 이 단계에서 살아남았나(LEVEL_OK_MS 넘게 살았거나 정상으로 떠남). 이미 ok면 그대로
export const LEVEL_OK_MS = 60_000;
const survived = (s, now, leaving) => !!s.cur && s.cur.mode === 'board' && Number.isFinite(s.cur.boardAt) && levelOf(s.cur.level) === s.level && (leaving || now - s.cur.boardAt >= LEVEL_OK_MS);
// 한 단계 무겁게 다시 시도(곧 다시 읽는다), 처음(단계 0)으로 되돌리기
export const levelHeavier = (s, now = Date.now()) => ({ ...s, level: Math.max(0, levelOf(s.level) - 1), ok: false, light: false, crashes: [], cur: s.cur ? { ...s.cur, alive: now, clean: true } : null });
export const levelReset = (s, now = Date.now()) => ({ ...s, level: 0, ok: false, light: false, crashes: [], cur: s.cur ? { ...s.cur, alive: now, clean: true } : null });

// P87: 백엔드가 죽음 기록을 받았다(web.boot의 답). 다음 부팅과 다시 붙은 연결이 같은 것을 다시 알리지 않는다
export const crumbSent = (s, id) => (Number.isFinite(id) ? { ...s, sent: id } : s);

// 백엔드(web.boot, backend/src/web-crash.mjs crashInfo)에 보낼 직전 상태. 숫자와 짧은 코드만
export function reportOf(prev, now, { boots = 0 } = {}) {
  if (!prev) return null;
  const alive = num(prev.alive) ?? prev.boot;
  const r = { ago: Math.max(0, now - alive), up: Math.max(0, alive - prev.boot), boots };
  for (const k of ['terms', 'px', 'atlas', 'gl', 'dpr', 'inB']) if (Number.isFinite(prev[k])) r[k] = prev[k];
  if (prev.view) r.view = prev.view;
  if (prev.hidden === true) r.hidden = true;
  if (prev.light === true) r.light = true;
  if (prev.retryBoot === true) r.retry = true;
  if (levelOf(prev.level) > 0) r.level = levelOf(prev.level); // P86: 그 페이지의 보드 단계
  const steps = keepSteps((Array.isArray(prev.steps) ? prev.steps : []).map((x) => x && stepOf(x.s, x, x.t)).filter(Boolean), STEP_REPORT);
  if (steps.length) r.steps = steps; // P86: 죽기 직전의 마지막 단계들
  return r;
}

export const RETRY_OK_MS = 3 * 60_000; // 다시 연 보드가 이만큼 살아 있으면 다시 열기를 마친 것으로 본다
// 살아 있다는 기록. sample: { view, terms, px, atlas, gl, dpr, inB, hidden }
export function crumbAlive(s, sample, now = Date.now()) {
  if (!s.cur) return s;
  const done = s.cur.retryBoot && now - s.cur.boot >= RETRY_OK_MS;
  const ok = !s.ok && survived(s, now, false); // P86: 이 단계의 보드가 1분 넘게 살았다
  return { ...s, cur: { ...s.cur, ...sample, alive: now, clean: false, ...(done ? { retryBoot: false } : {}) }, ...(done ? { retry: null } : {}), ...(ok ? { ok: true } : {}) };
}
// 정상으로 떠남(pagehide). 다시 연 보드가 정상으로 떠났으면 다시 열기를 마친 것으로 본다. P86: 보드를 그린 뒤 정상으로 떠났으면 그 단계는 살아남았다
export function crumbLeave(s, now = Date.now()) {
  if (!s.cur) return s;
  const ok = !s.ok && survived(s, now, true);
  return { ...s, cur: { ...s.cur, alive: now, clean: true }, ...(s.cur.retryBoot ? { retry: null } : {}), ...(ok ? { ok: true } : {}) };
}
// bfcache에서 돌아옴(pageshow persisted): 다시 살아 있는 페이지
export const crumbBack = (s, now = Date.now()) => (s.cur ? { ...s, cur: { ...s.cur, alive: now, clean: false } } : s);
// 가벼운 화면에서 "보드로 다시 열기"(곧 다시 읽는다)
export const chooseBoard = (s, now = Date.now()) => ({ ...s, light: false, crashes: [], retry: now, cur: s.cur ? { ...s.cur, alive: now, clean: true } : null });

// 휴대폰 웹의 터미널 예산(P84). 손가락 포인터의 웹 화면(휴대폰, 태블릿)은 WebGL을 쓰지 않고(DOM으로 그린다) 동시에 붙는 터미널을 줄인다.
// PC 창(Electron)과 마우스 브라우저는 그대로다. 가벼운 화면은 터미널 하나
// 마우스 웹 화면(노트북 브라우저)은 WebGL을 쓰되 터미널 캔버스 한 장의 장치 픽셀 상한(maxPx)을 낮춘다(넘으면 늘여 보인다, lib/term-sharp.js).
// 휴대폰 보드 화면(화면 배율 3, PC 크기 175칸 패널)은 배율 1에서 캔버스 한 장이 9.4M px, 배율 2에서 상한 12M px까지 갔다(docs/log/p84-phone-crash.md)
export const PHONE_MAX_TERMS = 3;
export const WEB_SHARP_MAX_PX = 4e6;
export function termBudget({ web, coarse, light = false, maxControllers, webglBudget }) {
  if (light) return { max: Math.min(maxControllers, 1), webgl: 0, maxPx: WEB_SHARP_MAX_PX };
  if (web && coarse) return { max: Math.min(maxControllers, PHONE_MAX_TERMS), webgl: 0, maxPx: WEB_SHARP_MAX_PX };
  if (web) return { max: maxControllers, webgl: webglBudget, maxPx: WEB_SHARP_MAX_PX };
  return { max: maxControllers, webgl: webglBudget, maxPx: null };
}

// P86: 보드 단계마다 끄는 것. 0은 전부 켬. 1 보드에 터미널을 붙이지 않음(얼굴만, 전체 보기는 그대로), 2 대화 노드·메모·칸반을 빼고 선을 단순하게,
// 3 효과(그림자, 빛, 움직임, 필터, will-change, 웹 화면 배율 CSS zoom)를 끔, 4 지금 워크스페이스의 세션만
export function levelPlan(level) {
  const l = levelOf(level);
  return { level: l, terms: l < 1, items: l < 2, fancyEdges: l < 2, effects: l < 3, allWs: l < 4 };
}

// P86: 웹 화면 터미널의 칸·줄 상한. 글자 폭을 잘못 재면(0에 가까운 값) 칸·줄이 수천이 되어 DOM 셀과 패널 크기가 커진다. PC 창은 그대로(web=false)
export const WEB_MAX_COLS = 400, WEB_MAX_ROWS = 150;
export function capDims({ cols, rows }, web = true) {
  const c = Number.isFinite(cols) ? cols : 100, r = Number.isFinite(rows) ? rows : 30;
  if (!web) return { cols: c, rows: r };
  return { cols: Math.min(c, WEB_MAX_COLS), rows: Math.min(r, WEB_MAX_ROWS) };
}
