// P161 창 시험: 설정 런처·연결 칸, 새 세션 대화상자, 세션 맵(PC)이 CSS 이름 겹침 없이 그려지는가.
// 판: 따로 띄운 개발용 판(atrium-dev-p161, 47930, backend/.dev)만 쓴다. 셸 세션 하나(p161-a, 시험 폴더 C:\Workspace\mtask-p161-a)만 띄운다.
// 실행: node app/test/e2e/p161-settings.mjs <setup|shot|stop> [before|after]
//   shot before: 고치기 전 커밋으로 빌드한 dist를 끼워 찍는다(검사는 기록만). shot after: 지금 빌드로 찍고 검사한다.
// 결과는 워크트리의 experiments/p161/<before|after>/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const TAG = process.argv[3] || 'after';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p161', TAG);
const CONVOS = path.join(REPO, 'experiments', 'p161', 'convos');
const DIR = 'C:\\Workspace\\mtask-p161-a';
const BOARD = 'atrium-dev-p161', PORT = '47930', DEBUG = 9410;
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k];
process.env.MT_E2E_OUT = path.relative(path.join(REPO, 'experiments'), OUT);
const ENV = {
  ATRIUM_TERMINAL_SESSION: BOARD, ATRIUM_HERDR_SESSION: BOARD, ATRIUM_PORT: PORT,
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p161-none-',
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const log = logger(`p161-${WHAT}-${TAG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 1200)}` : ''}`); };
const shotTo = (pg, name, clip) => pg.screenshot({ path: path.join(OUT, `${name}.png`), ...(clip ? { clip } : {}) });
const modalClip = (pg, sel) => pg.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), width: Math.min(innerWidth, b.width + 8), height: Math.min(innerHeight, b.height + 8) }; });

async function openSettings(pg, tab) {
  if (!(await pg.$('[data-role="settings"]'))) await pg.click('[data-role="top-right"] [data-action="settings-open"]');
  await pg.waitForSelector('[data-role="settings-tabs"]', { timeout: 8000 });
  await pg.click(`[data-role="settings-tabs"] [data-tab="${tab}"]`);
  await sleep(500);
}

// 런처 목록 줄: 서로 겹치지 않고(세로로 차례), 줄 안의 이름·명령 글이 줄 상자 안에 있다
const LAUNCHER_PROBE = () => {
  const root = document.querySelector('[data-role="launchers-list"]');
  const rows = [...root.querySelectorAll('[data-role="launcher-row"]')].map((r) => { const b = r.getBoundingClientRect(); const cs = getComputedStyle(r); return { name: r.dataset.name, top: b.top, bottom: b.bottom, h: b.height, pos: cs.position, display: cs.display }; });
  let overlap = 0; for (let i = 1; i < rows.length; i++) if (rows[i].top < rows[i - 1].bottom - 1) overlap++;
  return { rootClass: root.className, rootPos: getComputedStyle(root).position, rows, overlap };
};

async function setup() {
  fs.mkdirSync(DIR, { recursive: true });
  log(atrium('backend', 'start').trim().slice(0, 300));
  const have = new Set(call('session.list').map((s) => s.name));
  if (!have.has('p161-a')) log(atrium('--json', 'spawn', DIR, '--kind', 'shell', '--name', 'p161-a').slice(0, 160));
  await sleep(2000);
}

async function shot() {
  const { app, page } = await launch({ log, env: { ...ENV }, args: [`--remote-debugging-port=${DEBUG}`] });
  try {
    await page.setViewportSize({ width: 1584, height: 921 }).catch(() => {});
    await sleep(2000);
    for (const lang of ['en', 'ko']) {
      call('settings.set', { key: 'language', value: lang }); await sleep(800);
      // 1 설정 런처
      await openSettings(page, 'launchers');
      const lp = await page.evaluate(LAUNCHER_PROBE);
      check(`[${lang}] 런처 목록: 줄 ${lp.rows.length}개가 겹치지 않고 grid로 놓인다`, lp.rows.length >= 2 && lp.overlap === 0 && lp.rows.every((r) => r.pos !== 'absolute' && r.display === 'grid'), lp);
      await shotTo(page, `settings-launchers-${lang}`, await modalClip(page, '[data-role="settings"]'));
      // 2 설정 연결(빈 판)
      await openSettings(page, 'connections');
      const cp = await page.evaluate(() => { const e = document.querySelector('[data-role="connections-empty"]'); return e ? { text: e.innerText, h: e.getBoundingClientRect().height, lines: e.children.length } : null; });
      check(`[${lang}] 연결 칸: 빈 상태 안내(제목·무엇·어떻게)`, cp && cp.lines === 3 && cp.h > 40, cp);
      await shotTo(page, `settings-connections-${lang}`, await modalClip(page, '[data-role="settings"]'));
      // 3 설정의 다른 칸들(한 장씩)
      const tabs = await page.$$eval('[data-role="settings-tabs"] [data-tab]', (els) => els.map((e) => e.dataset.tab));
      for (const t of tabs.filter((x) => !['launchers', 'connections'].includes(x))) { await openSettings(page, t); await shotTo(page, `settings-${t}-${lang}`, await modalClip(page, '[data-role="settings"]')); }
      await page.click('[data-action="settings-close"]').catch(() => {}); await sleep(300);
      // 4 새 세션 대화상자(Shift+런처)
      await page.click('[data-role="rail-left"] [data-launcher="claude"]', { modifiers: ['Shift'] });
      await page.waitForSelector('[data-role="spawn"]', { timeout: 8000 }); await sleep(500);
      const sp = await page.evaluate(() => { const f = document.querySelector('[data-role="spawn"]'); const pv = f.querySelector('[data-role=launcher-preview]'); return { preview: pv ? { pos: getComputedStyle(pv).position, h: pv.getBoundingClientRect().height } : null, w: f.getBoundingClientRect().width }; });
      check(`[${lang}] 새 세션 대화상자: 명령 미리 보기가 제자리`, !sp.preview || (sp.preview.pos !== 'absolute' && sp.preview.h > 10), sp);
      await shotTo(page, `spawn-${lang}`, await modalClip(page, '[data-role="spawn"]'));
      await page.keyboard.press('Escape'); await sleep(400);
      // 5 세션 맵(PC)
      if (!(await page.$('[data-role="mission"]'))) await page.click('[data-action="mission-rail"]');
      await page.waitForSelector('[data-role="mission"] .mt-ta-card', { timeout: 20000 }); await sleep(1200);
      const mp = await page.evaluate(() => { const m = document.querySelector('[data-role="mission"]'); const row = m.querySelector('[data-role="ta-isle"]'); const head = m.querySelector('[data-role="ta-isle-head"]'); return { cls: m.className, rowPos: row && getComputedStyle(row).position, rowCls: row && row.className, headCls: head && head.className, color: getComputedStyle(m).color, cards: m.querySelectorAll('.mt-ta-card').length }; });
      check(`[${lang}] 세션 맵: 줄은 absolute, 카드가 있다`, mp.rowPos === 'absolute' && mp.cards >= 1, mp);
      await shotTo(page, `mission-pc-${lang}`);
      await page.keyboard.press('Escape'); await sleep(300);
      if (await page.$('[data-role="mission"]')) { await page.click('[data-action="mission-rail"]').catch(() => {}); await sleep(400); }
    }
  } finally {
    call('settings.set', { key: 'language', value: 'en' });
    await closeApp(app);
  }
}

async function stop() {
  try { const s = call('session.list').find((x) => x.name === 'p161-a'); if (s) log(atrium('kill', s.sessionId || s.id || 'p161-a', '--yes').trim()); } catch (e) { log('kill', e.message.split('\n')[0]); }
  try { log(atrium('terminal', 'stop', '--yes').trim()); } catch (e) { log('terminal stop', e.message.split('\n')[0]); }
  try { log(atrium('backend', 'stop').trim()); } catch (e) { log('backend stop', e.message.split('\n')[0]); }
}

if (WHAT === 'setup') await setup();
else if (WHAT === 'shot') await shot();
else if (WHAT === 'stop') await stop();
const fail = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, `${WHAT}-results.json`), JSON.stringify(results, null, 2));
log(`끝: ${results.length - fail.length}/${results.length} 통과`);
process.exit(fail.length && TAG === 'after' ? 1 : 0);
