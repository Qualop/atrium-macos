// P97 창 시험(휴대폰): 새 세션 시트의 세션 이름 칸이 레일 이름 칸과 같은 규칙인지 본다(빈칸은 판이 짓고, 겹침·글자를 알리고 막는다).
// 흉내 원격(p59-lib.mjs, ts-sim-proxy.mjs): iPhone 흉내 Chromium(393×852, 손가락) → ts-sim(47986) → 백엔드(47896). PC 창은 띄우지 않는다.
// 개발용 판 atrium-dev-p97(47896, backend/.dev)만 쓴다. 셸 런처로만 띄운다(에이전트 없음). 결과는 experiments/p97/(git 밖).
// 실행(워크트리에서): bash backend/.dev/clean-env.sh node app/test/e2e/p97-phone.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p97');
const WS = 'C:\\Workspace\\mtask-p97-ws\\demo';
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A } = L;
const PORT = 47896, SIM = 47986;
const proj = (d) => path.join(process.env.USERPROFILE || '', '.claude', 'projects', d.replace(/[^A-Za-z0-9]/g, '-'));
export const ENV = {
  ATRIUM_HERDR_SESSION: 'atrium-dev-p97', ATRIUM_PORT: String(PORT),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: proj(WS), ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p97', ATRIUM_TEST_PREFIX: 'mtask-p97-x',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(PORT),
  ATRIUM_WEB_HOSTS: `${NAME}:${SIM},localhost:${SIM}`,
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k];
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true });
const { logger, sleep, until } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
const { chromium } = await import('playwright');
const log = logger('p97-phone');
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}` : ''}`); };
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PHONE = { viewport: { width: 393, height: 852 }, screen: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: SAFARI };
const shot = (pg, name) => pg.screenshot({ path: path.join(OUT, `p97-phone-${name}.png`) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
const names = () => call('session.list').map((s) => s.name);

let sim, browser;
try {
  // 백엔드를 흉내 tailscale env로 다시 띄운다(판 값은 같다)
  try { log(atrium('backend', 'stop').trim().slice(0, 120)); } catch {}
  log(atrium('backend', 'start').trim().slice(0, 200));
  for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
  call('settings.set', { remotePasskey: false }); call('settings.set', { remoteAccess: true });
  call('settings.set', { key: 'language', value: 'ko' });
  try { atrium('ws', 'open', WS); } catch {}
  for (const n of names()) if (/^(p97-|sh\d)/.test(n)) { try { atrium('kill', n, '--yes'); } catch {} }
  atrium('spawn', WS, '--kind', 'shell', '--name', 'p97-taken');
  // P122: 새 판에는 셸 런처가 없다. 사람이 "+"로 만들듯 하나 만든다
  const SH = (call('launcher.list').launchers.find((x) => x.harness === 'shell') || call('launcher.create', { launcher: { name: 'Shell', harness: 'shell' }, favorite: true }).launcher).id;
  sim = startTsSim({ listen: SIM, target: PORT, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const chromeExe = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  browser = await chromium.launch({ headless: true, ...(chromeExe ? { executablePath: chromeExe } : {}) });
  const ctx = await browser.newContext(PHONE);
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await pg.goto(`http://localhost:${SIM}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await pg.fill('[data-field=pair-code]', call('device.code').code);
  await pg.click('[data-action=pair-submit]');
  await pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: 60000 });
  await pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  await pg.tap('[data-action=phone-new]');
  await pg.waitForSelector('[data-role=phone-spawn]');
  await pg.tap(`[data-role=phone-launchers] [data-launcher="${SH}"]`);
  await sleep(300);
  const hasName = await pg.$('[data-field=phone-spawn-name]');
  check('휴대폰 새 세션 시트에 세션 이름 칸이 있다(비우면 판이 짓는다)', !!hasName && /비우면/.test(await pg.textContent('[data-role=phone-spawn-note]')));
  await shot(pg, '1-sheet');
  await pg.fill('[data-field=phone-spawn-name]', 'P97-TAKEN');
  await sleep(200);
  const taken = { note: await pg.textContent('[data-role=phone-spawn-note]'), disabled: await pg.$eval('[data-action=phone-spawn-go]', (b) => b.disabled) };
  check('겹치는 이름을 알리고 시작을 막는다', /이미/.test(taken.note) && taken.disabled, taken);
  await shot(pg, '2-taken');
  await pg.fill('[data-field=phone-spawn-name]', '휴대폰');
  await sleep(200);
  const bad = { note: await pg.textContent('[data-role=phone-spawn-note]'), disabled: await pg.$eval('[data-action=phone-spawn-go]', (b) => b.disabled) };
  check('허용하지 않는 글자를 알린다', /영문/.test(bad.note) && bad.disabled, bad);
  await pg.fill('[data-field=phone-spawn-name]', 'p97-ph');
  await pg.tap('[data-action=phone-spawn-go]');
  await until(() => names().includes('p97-ph'), 20000, 500).catch(() => null);
  check('이름을 쓰고 시작 → 그 이름으로 만든다', names().includes('p97-ph'), names());
  await sleep(1500);
  await shot(pg, '3-started');
  // 빈칸이면 판이 짓는다
  const before = names().length;
  if (await pg.$('[data-action=phone-back]')) { await pg.tap('[data-action=phone-back]'); await sleep(800); } // 시작하면 그 세션으로 들어간다. 목록으로
  await pg.tap('[data-action=phone-new]');
  await pg.waitForSelector('[data-role=phone-spawn]');
  await pg.tap(`[data-role=phone-launchers] [data-launcher="${SH}"]`);
  await pg.tap('[data-action=phone-spawn-go]');
  await until(() => names().length > before, 20000, 500).catch(() => null);
  check('빈칸이면 판이 이름을 짓는다', names().some((n) => /^sh\d+$/.test(n)), names());
} catch (e) {
  check('예외', false, e.stack || e.message);
} finally {
  for (const n of names()) if (/^(p97-|sh\d)/.test(n)) { try { atrium('kill', n, '--yes'); } catch {} }
  try { call('settings.set', { key: 'language', value: 'en' }); } catch {}
  if (browser) await browser.close().catch(() => {});
  if (sim) await sim.close().catch(() => {});
  const bad = results.filter((r) => !r.ok);
  log(`결과: ${results.length - bad.length}/${results.length} 통과`);
  fs.writeFileSync(path.join(OUT, 'p97-phone-results.json'), JSON.stringify(results, null, 1));
  process.exit(bad.length ? 1 : 0);
}
