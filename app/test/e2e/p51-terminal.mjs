// P51 창 시험: 셸 노드 여러 줄 붙여넣기(#3)와 셸 노드 휠(#7). ux1 재현 각본(ux1-repro.mjs)의 shellPaste·shellWheel 사례를 P51 판에서 돌린다.
// 판: herdr 세션 atrium-dev-p51, 포트 47870, 이 워크트리의 backend/.dev(experiments/p51/tools/env.cjs). 세션은 셸만.
// 사용: MT_E2E_OUT=p51 node test/e2e/p51-terminal.mjs (app 폴더에서). 결과: experiments/p51/p51-terminal.json, 스크린숏
// 시스템 클립보드를 쓰고, 끝나면 앞의 글로 되돌린다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { launch, closeApp, shot as shotOf, sleep, until, logger, REPO, OUT } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p51') throw new Error('MT_E2E_OUT=p51을 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p51', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P51_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p51' || ENV.ATRIUM_PORT !== '47870') throw new Error('P51 판(atrium-dev-p51, 47870)만');
if (!/^C:\\Workspace\\mtask-p51-/.test(T.DIR)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p51-*만: ${T.DIR}`);
fs.mkdirSync(T.DIR, { recursive: true });

const log = logger('p51-terminal');
const results = [];
const step = (name, ok, data) => { results.push({ name, ok, data }); log(`${ok ? 'PASS' : 'FAIL'} ${name}`, data); };
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION }, timeout: 120000 });

const { app, page } = await launch({ log, env: { ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION } });
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
const shot = (n) => shotOf(page, `p51-${n}`, log);
const sessionId = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? s.sessionId : null; }, name);
const screenText = () => atrium('screen', 'sp1', '--text').split('\n').map((l) => l.trimEnd()).filter(Boolean);
const clipBefore = await app.evaluate(({ clipboard }) => clipboard.readText());
try {
  if (!await sessionId('sp1')) atrium('spawn', T.DIR, '--name', 'sp1', '--kind', 'shell');
  const id = await until(() => sessionId('sp1'), 40000);
  await page.evaluate((i) => window.__mt.getState().navigateTo(i), id); await sleep(2500);
  const el = await page.$(`.mt-term[data-session="${id}"] .xterm-screen`); const b = await el.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(500);
  await page.keyboard.type('cls'); await page.keyboard.press('Enter'); await sleep(1200);

  // #3: 세 줄을 붙여 넣으면 아무 줄도 Enter 전에 돌지 않고, 세 줄 모두 입력줄에 쌓인다. Enter 한 번에 세 줄이 돈다
  await app.evaluate(({ clipboard }) => clipboard.writeText('echo p51-line-1\r\necho p51-line-2\r\necho p51-line-3'));
  await page.keyboard.press('Control+v'); await sleep(2000);
  const before = screenText();
  const ranBefore = before.filter((l) => /^p51-line-\d$/.test(l));
  const queued = before.filter((l) => /echo p51-line-\d$/.test(l));
  await shot('paste-1-after-ctrl-v');
  step('#3 여러 줄 붙여넣기는 Enter 전에는 실행되지 않고 입력줄에 쌓인다(U8)', ranBefore.length === 0 && queued.length === 3, { ranWithoutEnter: ranBefore, tail: before.slice(-5) });
  await page.keyboard.press('Enter'); await sleep(2000);
  const after = screenText();
  const ranAfter = after.filter((l) => /^p51-line-\d$/.test(l));
  await shot('paste-2-after-enter');
  step('#3 사람이 Enter를 치면 세 줄이 차례로 돈다', ranAfter.join(',') === 'p51-line-1,p51-line-2,p51-line-3', { ran: ranAfter, tail: after.slice(-6) });

  // #7: 휠 한 칸(100px)에 3줄, deltaY 10 열 번은 한 칸과 같은 3줄
  await page.keyboard.type('cls; 1..120 | % { "wheel row $_" }'); await page.keyboard.press('Enter');
  await until(() => page.evaluate((i) => { const t = window.__mt.terms.get(i); if (!t) return false; const bf = t.buffer.active; for (let k = 0; k < t.rows; k++) { const l = bf.getLine(bf.viewportY + k); if (l && /wheel row 120/.test(l.translateToString(true))) return true; } return false; }, id), 15000, 200);
  await sleep(800);
  const vy = () => page.evaluate((i) => window.__mt.terms.get(i).buffer.active.viewportY, id);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const y0 = await vy();
  await page.mouse.wheel(0, -100); await sleep(500);
  const one = y0 - await vy();
  const y1 = await vy();
  for (let k = 0; k < 10; k++) { await page.mouse.wheel(0, -10); await sleep(30); }
  await sleep(500);
  const small = y1 - await vy();
  const y2 = await vy();
  for (let k = 0; k < 5; k++) { await page.mouse.wheel(0, -100); await sleep(80); }
  await sleep(500);
  const five = y2 - await vy();
  const rows = await page.evaluate((i) => window.__mt.terms.get(i).rows, id);
  await shot('wheel-1-after');
  step('#7 셸 휠 한 칸에 3줄, 작은 휠 10번(합 100px)도 3줄, 다섯 칸에 15줄(H7)', one === 3 && small === 3 && five === 15, { linesPerNotch100: one, linesFor10x10: small, linesFor5Notches: five, rows });
  // 아래로 굴려 지금 화면으로 돌아온다
  for (let k = 0; k < 20; k++) await page.mouse.wheel(0, 100);
  await sleep(400);
  const back = await page.evaluate((i) => { const bf = window.__mt.terms.get(i).buffer.active; return bf.viewportY === bf.baseY; }, id);
  step('#7 아래로 굴리면 지금 화면(맨 아래)으로 돌아온다', back, {});
} catch (e) {
  step('시험 오류', false, { error: e.stack || e.message });
} finally {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), clipBefore).catch(() => {});
  fs.writeFileSync(path.join(OUT, 'p51-terminal.json'), JSON.stringify(results, null, 2));
  await closeApp(app);
}
const fail = results.filter((r) => !r.ok).length;
log(`끝: ${results.length - fail}/${results.length} 통과`);
process.exit(fail ? 1 : 0);
