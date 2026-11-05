// ux1 S8: herdr가 없는 PC를 흉내 낸 판(P40 방법: 없는 ATRIUM_HERDR, herdr 폴더를 뺀 PATH, 가짜 USERPROFILE·LOCALAPPDATA)에서
// 창이 무엇을 보이고, 세션 띄우기가 어떤 오류를 보이는지 본다. 사용자가 설치한 herdr는 건드리지 않는다.
// 판: herdr 세션 atrium-dev-ux1h, 포트 47868, 이 워크트리의 backend/.dev(dataH, appH). 본 ux1 판(47867)과 따로다.
// 사용: node experiments/ux1/tools/e2e.cjs ux1-s8-noherdr.mjs [--lang en]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, logger, closeApp, T, overflow, recorder } from './ux1-lib.mjs';
import { assertTestBoard } from './p9-guard.mjs';

const argv = process.argv.slice(2);
const LANG = argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : 'ko';
const TAG = `ux1-s8-noherdr-${LANG}`;
const log = logger(TAG);
const { step, save } = recorder(TAG, log);
const FAKE = path.join(T.DEV, 'ux1-fake');
const ENV = {
  ATRIUM_HERDR_SESSION: 'atrium-dev-ux1h', ATRIUM_PORT: '47868',
  ATRIUM_DATA_DIR: path.join(T.DEV, 'dataH'), ATRIUM_APP_USERDATA: path.join(T.DEV, 'appH'),
  ATRIUM_CLAUDE_PROJECTS: T.PROJECTS, ATRIUM_CLAUDE_SESSIONS: T.SESSIONS, ATRIUM_CLAUDE_DESKTOP: 'none',
};
assertTestBoard(ENV, { root: T.DEV });
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE|ATRIUM_|MTASK_|MT_HERDR)/.test(k)));
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH');
const maskedPath = process.env[pathKey].split(';').filter((d) => d && !fs.existsSync(path.join(d, 'herdr.exe'))).join(';');
for (const d of [path.join(FAKE, 'home'), path.join(FAKE, 'local')]) fs.mkdirSync(d, { recursive: true });
const env = { ...cleanEnv(), ...ENV, [pathKey]: maskedPath, USERPROFILE: path.join(FAKE, 'home'), LOCALAPPDATA: path.join(FAKE, 'local'), ATRIUM_HERDR: path.join(FAKE, 'nope', 'herdr.exe') };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 60000 });

const winEnv = { ...cleanEnv(), ...ENV }; // 창은 가리지 않은 env로 띄운다(P40과 같다). 백엔드만 가린 env로 먼저 띄운다
let app = null, page = null;
try {
  log('백엔드(가린 env)', atrium('backend', 'start').trim().split('\n').slice(-1)[0]);
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env: winEnv, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await page.evaluate((l) => window.__mt.api.call('settings.set', { key: 'language', value: l }), LANG);
  await sleep(2500);
  const banner = await page.evaluate(() => { const e = document.querySelector('[data-role="herdr-missing"]'); return e ? e.innerText.slice(0, 400) : null; });
  step('herdr 없음 띠가 보인다', !!banner, banner);
  const top = await page.evaluate(() => (document.querySelector('[data-action="conn-mission"]') || {}).innerText);
  step('위 오른쪽 상태 알약이 herdr 없음을 말한다', /herdr/i.test(top || ''), top);
  await page.screenshot({ path: path.join(OUT, `${TAG}-01-banner.png`) });
  // 폴더를 열고 레일의 셸 런처를 누른다 → 무엇이 보이는가
  await page.evaluate((p) => window.__mt.api.call('workspace.open', { path: p }), T.DIR2);
  await sleep(800);
  const btns = await page.$$('[data-role="rail-favorites"] [data-action="launch"]');
  const shell = btns[btns.length >= 3 ? 2 : 0];
  await shell.click();
  await sleep(2500);
  const toasts = await page.evaluate(() => [...document.querySelectorAll('.mt-toast, [class*=toast]')].map((e) => e.innerText.slice(0, 300)));
  const modal = await page.evaluate(() => { const m = document.querySelector('.mt-modal'); return m ? m.innerText.slice(0, 400) : null; });
  step('셸 런처를 누르면 herdr 없음 까닭과 할 일이 보인다', toasts.some((t) => /herdr/i.test(t)) || /herdr/i.test(modal || ''), { toasts, modal });
  await page.screenshot({ path: path.join(OUT, `${TAG}-02-launch.png`) });
  const of = await overflow(page, null);
  step('넘침', null, of.slice(0, 10));
} catch (e) {
  step('예외', false, String(e && (e.stack || e.message)).slice(0, 600));
  if (page) await page.screenshot({ path: path.join(OUT, `${TAG}-error.png`) }).catch(() => {});
} finally {
  if (app) await closeApp(app);
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim().split('\n').slice(-1)[0]); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
  save();
  process.exit(0);
}
