// ux2 사용성 점검의 공용 도구: 시험 판 막기, 창 띄우기, 세션 띄우기, 넘침·겹침 재기, 화면 반영 시간과 프레임 간격 재기.
// ux1-lib.mjs를 ux2 판 값으로 옮겼다. 판: 터미널 세션 atrium-dev-ux2(hc), 포트 47908, 창 원격 디버깅 9388, 이 워크트리의 backend/.dev(experiments/ux2/tools/env.cjs).
// 시험 폴더는 C:\Workspace\mtask-ux2-*만. 각본(ux2-*.mjs)과 탐색 드라이버(ux2-drive.mjs)가 같이 쓴다. 결과는 experiments/ux2/(git 밖)에 둔다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

export { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp };
// P140: 다른 워커가 자기 판에서 재현 사례를 다시 돌릴 수 있게, 판 값(터미널 세션, 포트, 창 원격 디버깅, 시험 폴더 접두어)은 env.cjs의 BOARD에서 읽는다.
// BOARD가 없으면 ux2 판 값이다. 결과 폴더(MT_E2E_OUT)와 env.cjs 자리는 같은 이름(ux2, p140 …)을 쓴다
const OUTNAME = process.env.MT_E2E_OUT || '';
if (!/^(ux2|p\d+)$/.test(OUTNAME)) throw new Error('MT_E2E_OUT=ux2(또는 pNNN)를 명령줄에서 준다(experiments/<이름>/tools/e2e.cjs)');
export const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', OUTNAME, 'tools', 'env.cjs'));
export const ENV = T.ENV;
const BOARD = T.BOARD || { session: 'atrium-dev-ux2', port: '47908', cdp: 9388, prefix: 'mtask-ux2-' };
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_TERMINAL_SESSION !== BOARD.session || ENV.ATRIUM_PORT !== BOARD.port || !/^atrium-dev-/.test(BOARD.session) || BOARD.port === '47800') throw new Error(`시험 판(${BOARD.session}, ${BOARD.port})만`);
if (!/^mtask-[a-z0-9]+-$/.test(BOARD.prefix)) throw new Error(`시험 폴더 접두어: ${BOARD.prefix}`);
for (const d of [T.DIR, T.DIR2, T.DIR3, T.REPO, T.CODEX_HOME]) if (!d.startsWith(`C:\\Workspace\\${BOARD.prefix}`)) throw new Error(`시험 폴더는 C:\\Workspace\\${BOARD.prefix}*만: ${d}`);
export const WS_DIR2 = path.basename(T.DIR2); // P141: 각본이 이름으로 부르는 시험 폴더(워크스페이스) 이름(판마다 다르다)
fs.mkdirSync(OUT, { recursive: true });

export const env = (extra = {}) => T.cleanEnv(extra);
export const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: env(), timeout: 180000 });
export const lastLine = (s) => String(s).trim().split(/\r?\n/).slice(-1)[0];
export const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', windowsHide: true });

// 시험 폴더를 만든다. DIR·DIR2·DIR3은 git이 아닌 폴더(신뢰된 C:\Workspace 아래), REPO는 커밋 하나 있는 git 저장소(신뢰 질문이 뜬다. 신뢰는 대신 누르지 않는다)
export function prepare() {
  for (const d of [T.DIR, T.DIR2, T.DIR3]) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(path.join(T.REPO, '.git'))) {
    fs.mkdirSync(T.REPO, { recursive: true });
    git(T.REPO, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(T.REPO, 'README.md'), 'ux2 test repo\n');
    git(T.REPO, 'add', '.');
    git(T.REPO, '-c', 'user.email=ux2@test', '-c', 'user.name=ux2', 'commit', '-q', '-m', 'init');
  }
}

// 창 띄우기: 창 안쪽 크기, 언어, 콘솔 오류 모으기. 창 원격 디버깅 포트는 9388(다른 판과 겹치지 않게)
export async function open({ log = console.log, w = 1584, h = 921, lang = 'ko', bottomPin = false, extraEnv = {}, args = [] } = {}) {
  const app = await electron.launch({ args: ['.', '--dev', `--remote-debugging-port=${BOARD.cdp}`, ...args], cwd: APP_ROOT, env: env(extraEnv), timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { errors.push({ t: Date.now(), type: m.type(), text: m.text().slice(0, 400) }); log(`[console.${m.type()}] ${m.text().slice(0, 300)}`); } });
  page.on('pageerror', (e) => { errors.push({ t: Date.now(), type: 'pageerror', text: e.message.slice(0, 400) }); log(`[pageerror] ${e.message}`); });
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await page.evaluate((p) => window.__mt.pinBottom && window.__mt.pinBottom(p), bottomPin);
  await app.evaluate(({ BrowserWindow }, [ww, hh]) => BrowserWindow.getAllWindows()[0].setContentSize(ww, hh), [w, h]);
  await sleep(500);
  if (lang) await page.evaluate((l) => window.__mt.api.call('settings.set', { key: 'language', value: l }), lang);
  const mainPid = await app.evaluate(() => process.pid);
  return { app, page, errors, mainPid };
}

export const call = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
export const sessionId = (page, name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? s.sessionId : null; }, name);
export const sessionOf = (page, name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? { id: s.sessionId, state: s.state, kind: s.kind, ask: s.ask, workspaceKey: s.workspaceKey, parent: s.parentSessionId || s.parent, lastAnswer: s.lastAnswer } : null; }, name);
export async function waitNode(page, name, ms = 40000) {
  return until(() => page.evaluate((n) => { const st = window.__mt.getState(); const s = [...st.sessions.values()].find((x) => x.name === n); return s && st.nodes.has(s.sessionId) ? s.sessionId : null; }, name), ms);
}
export async function waitStateOf(page, name, states, ms = 120000) {
  const want = [].concat(states);
  return until(() => page.evaluate(([n, w]) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s && w.includes(s.state) ? s.state : null; }, [name, want]), ms, 400);
}
export const nodeRects = (page) => page.evaluate(() => [...window.__mt.getState().nodes.entries()].map(([id, r]) => ({ id, x: r.x, y: r.y, w: r.w, h: r.h })));

// 화면의 노드 사각형끼리 겹침(같은 덩어리 안은 틈 없이 붙으므로 1px 넘게 겹칠 때만)
export const domOverlaps = (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll('.react-flow__node-session, .react-flow__node-memo, .react-flow__node-kanban, .react-flow__node-convo')];
  const rs = els.map((e) => ({ id: e.dataset.id, r: e.getBoundingClientRect() }));
  const out = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i].r, b = rs[j].r;
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 1 && oy > 1) out.push({ a: rs[i].id, b: rs[j].id, ox: Math.round(ox), oy: Math.round(oy) });
  }
  return out;
});

// 글이 든 요소의 넘침(P39 방법): 가로 넘침·말줄임, 숨긴 세로 넘침, 창 밖으로 나감
export const overflow = (page, sel = null) => page.evaluate((s) => {
  const root = s ? document.querySelector(s) : document.body;
  if (!root) return { missing: s };
  const W = window.innerWidth, H = window.innerHeight;
  const bad = [];
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('.xterm, svg, canvas, .react-flow__minimap, textarea, input, select')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.display === 'inline') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim();
    if (!own) continue;
    const why = [];
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') why.push(cs.textOverflow === 'ellipsis' ? 'ellipsis' : `clipX(${cs.overflowX})`);
    if (el.scrollHeight > el.clientHeight + 1 && (cs.overflowY === 'hidden' || cs.overflowY === 'clip')) why.push('clipY');
    if (!el.closest('.react-flow__node') && (r.right > W + 1 || r.bottom > H + 1 || r.left < -1)) why.push('offscreen');
    if (why.length) bad.push({ why: why.join(','), text: own.slice(0, 90), cls: String(el.className).slice(0, 50), w: Math.round(el.clientWidth), sw: el.scrollWidth });
  }
  return bad;
}, sel);

// 화면 프레임 간격: ms 동안 requestAnimationFrame 간격을 모아 p50·p95·최대
export const frameGaps = (page, ms = 3000) => page.evaluate((d) => new Promise((res) => {
  const gaps = []; let last = performance.now(); const end = last + d;
  const tick = (t) => { gaps.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else { gaps.sort((a, b) => a - b); const q = (p) => Math.round(gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] * 10) / 10; res({ n: gaps.length, p50: q(0.5), p95: q(0.95), max: Math.round(gaps[gaps.length - 1]) }); } };
  requestAnimationFrame(tick);
}), ms);

// 동작에서 화면 반영까지: act() 뒤 조건 함수(창 안)가 참이 될 때까지 ms
export async function latency(page, act, cond, arg, ms = 15000) {
  const t0 = Date.now();
  await act();
  await page.waitForFunction(cond, arg, { timeout: ms, polling: 'raf' });
  return Date.now() - t0;
}

// 스크린숏: Atrium 창(페이지)만 찍는다. 300KB를 넘으면 증거용 축소는 따로 한다
export async function shot(page, name, log = console.log) {
  const f = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: f });
  log('스크린숏', path.relative(REPO, f));
  return f;
}

// 시험 세션 띄우기(CLI). 이름을 기록해 두었다가 kill로 끈다
export function spawner(page, log = console.log) {
  const spawned = [];
  const spawn = async (dir, name, ...extra) => {
    log(lastLine(atrium('spawn', dir, '--name', name, ...extra)));
    spawned.push(name);
    return waitNode(page, name);
  };
  const killAll = () => { for (const n of spawned.splice(0)) { try { log(lastLine(atrium('kill', n, '--yes'))); } catch (e) { log('kill', n, e.message.slice(0, 160)); } } };
  return { spawn, killAll, spawned };
}

// 결과 모으기
export function recorder(tag, log) {
  const results = [];
  const step = (name, ok, detail) => { results.push({ name, ok: ok === null ? null : !!ok, detail }); log(`${ok === null ? '관찰' : ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
  const save = (extra = {}) => { fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify({ at: new Date().toISOString(), results, ...extra }, null, 2)); return results; };
  return { results, step, save };
}

// 노드 터미널에 지금 보이는 줄(xterm 버퍼의 화면 부분). 붙지 않았으면 null
export const termView = (page, id) => page.evaluate((i) => {
  const t = window.__mt.terms && window.__mt.terms.get(i); if (!t) return null;
  const b = t.buffer.active; const out = [];
  for (let r = 0; r < t.rows; r++) { const l = b.getLine(b.viewportY + r); out.push(l ? l.translateToString(true) : ''); }
  return out;
}, id);

// 판 전체를 맞춘 뒤 그 노드로 들어가 터미널에 초점을 준다 → { id, box(터미널 사각형) }
export async function focusTerm(page, name) {
  await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(900);
  const id = await sessionId(page, name);
  const el = page.locator(`.react-flow__node[data-id="${id}"]`);
  const b0 = await el.boundingBox();
  await page.mouse.click(b0.x + b0.width / 2, b0.y + b0.height / 2); await sleep(1200);
  const box = await el.locator('.xterm').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.5); await sleep(800);
  return { id, box };
}

// 판 위의 빈 곳(react-flow 바탕) 한 점
export const blank = (page) => page.evaluate(() => { const c = document.querySelector('.mt-canvas').getBoundingClientRect(); for (let y = c.y + 120; y < c.bottom - 160; y += 30) for (let x = c.x + 110; x < c.right - 110; x += 40) { const e = document.elementFromPoint(x, y); if (e && e.classList.contains('react-flow__pane')) return { x, y }; } return null; });
