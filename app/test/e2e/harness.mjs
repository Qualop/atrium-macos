// P2 창 시험 도구: Playwright의 Electron 지원으로 실제 창을 띄우고 조작한다. 스크린숏과 로그는 experiments/p2/에 둔다.
// 개발용 프로필(--dev)로만 띄운다. 창이 개발용 백엔드와 herdr(atrium-dev)를 띄운다.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO = path.resolve(APP_ROOT, '..');
export const OUT = path.join(REPO, 'experiments', process.env.MT_E2E_OUT || 'p2'); // P3 시험은 MT_E2E_OUT=p3
export const PROJ = path.join(REPO, 'backend', '.dev', 'proj');
fs.mkdirSync(OUT, { recursive: true });

// P18: 옛 단계의 창 시험을 다른 판에서 다시 돌릴 때 판 값(herdr 세션, 포트, 시험 데이터 폴더, 시험 폴더)과 결과 폴더 이름을 명령줄 환경 변수로 덮는다.
// MT_E2E_HERDR_SESSION, MT_E2E_PORT, MT_E2E_DEV, MT_E2E_DIR. 없으면 그 시험의 값 그대로
export const e2eBoard = ({ session, port, dev, dir }) => ({ session: process.env.MT_E2E_HERDR_SESSION || session, port: process.env.MT_E2E_PORT || port, dev: process.env.MT_E2E_DEV || dev, dir: process.env.MT_E2E_DIR || dir });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 23);

export function logger(name) {
  const file = path.join(OUT, `${name}.txt`);
  const f = (...a) => { const line = `${ts()} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`; console.log(line); fs.appendFileSync(file, line + '\n'); };
  f.file = file;
  return f;
}

// 부모 Claude Code 표시 변수를 뺀 환경(백엔드와 herdr도 각자 한 번 더 뺀다)
function cleanEnv() { return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k))); }

export async function launch({ query = '', log = console.log, env = {} } = {}) {
  const app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env: { ...cleanEnv(), ...env }, timeout: 60000 });
  const page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log(`[console.${m.type()}] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  if (query) await page.evaluate((q) => { location.search = q; }, query);
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  const pid = await app.evaluate(({ app: a }) => process.pid);
  log(`창 열림 main pid=${pid}`);
  return { app, page, mainPid: pid };
}

// 창 닫기. 창이 백엔드를 띄웠으면 백엔드가 Electron의 출력 파이프 핸들을 물려받아 Playwright의 close가 끝나지 않는다(P4에서 봄).
// 창은 닫히므로 잠깐만 기다린다. 시험 스크립트는 끝에서 process.exit로 끝낸다.
export async function closeApp(app, ms = 8000) {
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
}

export async function shot(page, name, log = console.log) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  log(`스크린숏 ${path.relative(REPO, file)}`);
  return file;
}

// 창 안의 상태 읽기
export const sessionsOf = (page) => page.evaluate(() => [...window.__mt.getState().sessions.values()].map((s) => ({ id: s.sessionId, name: s.name, state: s.state, unseen: s.unseen, term: s.termStatus, ask: s.ask, estimate: s.estimate, delivering: s.delivering, lastAnswer: s.lastAnswer })));
export async function waitState(page, name, states, timeout = 90000) {
  const want = [].concat(states);
  await page.waitForFunction(([n, w]) => [...window.__mt.getState().sessions.values()].some((s) => s.name === n && w.includes(s.state)), [name, want], { timeout, polling: 200 });
}
export async function waitFor(page, fn, arg, timeout = 60000) { return page.waitForFunction(fn, arg, { timeout, polling: 200 }); }

// 창 안의 비동기 조회(api.call)를 조건으로 기다린다. waitForFunction은 Promise를 참으로 보고 바로 끝나므로 쓰지 않는다.
export async function until(fn, timeout = 60000, every = 300) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`until: ${timeout}ms 안에 조건이 맞지 않음`);
    await sleep(every);
  }
}
