// ux1 사용성 검증의 공용 도구: 시험 판 막기, 창 띄우기, 세션 띄우기, 넘침·겹침 재기, 화면 반영 시간과 프레임 간격 재기.
// 판: herdr 세션 atrium-dev-ux1, 포트 47867, 이 워크트리의 backend/.dev(experiments/ux1/tools/env.cjs). 시험 폴더는 C:\Workspace\mtask-ux1-*만.
// 각본(ux1-s*.mjs)과 탐색 드라이버(ux1-drive.mjs)가 같이 쓴다. 결과는 experiments/ux1/(git 밖)에 둔다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

export { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp };
if (process.env.MT_E2E_OUT !== 'ux1') throw new Error('MT_E2E_OUT=ux1을 명령줄에서 준다(experiments/ux1/tools/e2e.cjs)');
export const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'ux1', 'tools', 'env.cjs'));
export const ENV = Object.fromEntries(Object.entries(T.UX1_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-ux1' || ENV.ATRIUM_PORT !== '47867') throw new Error('ux1 판(atrium-dev-ux1, 47867)만');
for (const d of [T.DIR, T.DIR2, T.REPO]) if (!/^C:\\Workspace\\mtask-ux1-/.test(d)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-ux1-*만: ${d}`);
for (const d of [T.PROJECTS, T.SESSIONS, T.DESK]) if (!path.resolve(d).startsWith(path.resolve(T.DEV))) throw new Error(`고정 자료는 backend/.dev 안: ${d}`);
fs.mkdirSync(OUT, { recursive: true });

const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
export const env = (extra = {}) => ({ ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION, ...extra });
export const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: env(), timeout: 180000 });
export const lastLine = (s) => String(s).trim().split(/\r?\n/).slice(-1)[0];
export const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', windowsHide: true });

// 고정 자료 폴더와 시험 폴더를 만든다. REPO는 커밋 하나 있는 git 저장소(신뢰 질문이 뜬다. 신뢰는 대신 누르지 않는다)
export function prepare() {
  for (const d of [T.PROJECTS, T.SESSIONS, T.DESK, T.DIR, T.DIR2]) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(path.join(T.REPO, '.git'))) {
    fs.mkdirSync(T.REPO, { recursive: true });
    git(T.REPO, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(T.REPO, 'README.md'), 'ux1 test repo\n');
    git(T.REPO, 'add', '.');
    git(T.REPO, '-c', 'user.email=ux1@test', '-c', 'user.name=ux1', 'commit', '-q', '-m', 'init');
  }
}

// 창 띄우기: 창 안쪽 크기, 언어, 콘솔 오류 모으기. bottomPin은 옛 시험처럼 아래 바를 늘 보이게 할지
export async function open({ log = console.log, w = 1584, h = 921, lang = 'ko', bottomPin = false, extraEnv = {} } = {}) {
  const app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env: env(extraEnv), timeout: 60000 });
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
