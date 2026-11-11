// P65 창 시험: 웹 화면(원격, P48)에서도 터미널이 화면 장치 픽셀에 맞춰 그려지고, 끌어 고르기·복사가 마우스 밑 글자를 따라가는지 본다.
// - PC 창(Electron, P65 판)에서 짝 맺기 코드를 만들어 Playwright Chromium에 넣는다.
// - 판 배율 0.75와 1, 웹 화면 배율(CSS zoom, P49) 100%와 125%에서: 글자 가장자리 폭(p65-edge.mjs, 0.9px 이하),
//   첫 줄의 앞 20글자를 끌어 고르면 그 글이 골라지는지. 헤드리스 Chromium은 DPR 플래그를 무시해 DPR 1로 돈다.
// 판: herdr 세션 atrium-dev-p65, 포트 47892(experiments/p65/tools/env.cjs). 세션은 p65-sharp가 만든 셸(sharp1)을 쓰고 없으면 만든다.
// 사용: node experiments/p65/tools/e2e.cjs p65-web.mjs [--tag 이름] [--before]   결과: experiments/p65/<tag>-web.json, 스크린숏
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { launch, closeApp, sleep, until, logger, REPO, OUT } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';
import { decodePng, edgeWidth } from './p65-edge.mjs';

if (process.env.MT_E2E_OUT !== 'p65') throw new Error('MT_E2E_OUT=p65를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p65', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P65_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p65' || ENV.ATRIUM_PORT !== '47892') throw new Error('P65 판(atrium-dev-p65, 47892)만');
if (!/^C:\\Workspace\\mtask-p65-/.test(T.DIR)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p65-*만: ${T.DIR}`);
const argv = process.argv.slice(2);
const TAG = argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : 'p65';
const SHARP = !argv.includes('--before'); // --before: 고치기 전 빌드를 잴 때(가장자리 폭은 적기만 한다)
const edges = [];
for (const d of [T.PROJECTS, T.SESSIONS, T.DIR]) fs.mkdirSync(d, { recursive: true });
const log = logger(`${TAG}-web`);
const BASE = `http://127.0.0.1:${ENV.ATRIUM_PORT}`;
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION }, timeout: 120000 });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)); };

const { app, page: win } = await launch({ log, env: { ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION } });
let browser = null;
try {
  const sid = (p, n) => p.evaluate((nn) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === nn); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }, n);
  if (!await sid(win, 'sharp1')) atrium('spawn', T.DIR, '--name', 'sharp1', '--kind', 'shell');
  const id = await until(() => sid(win, 'sharp1'), 40000);
  // Playwright의 deviceScaleFactor 흉내는 device-pixel-content-box가 CSS 크기로 와서(캔버스가 늘 CSS 크기) 쓰지 않는다
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const ctx = await browser.newContext({ viewport: null, locale: 'ko-KR' });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1200, height: 800 }).catch(() => {});
  page.on('pageerror', (e) => log(`[web pageerror] ${e.message}`));
  await page.goto(`${BASE}/`);
  await page.waitForSelector('[data-role=pair]', { timeout: 20000 });
  await win.click('[data-action=settings-open]');
  await win.click('[data-tab=devices]');
  await win.click('[data-action=device-new-code]');
  const code = (await win.textContent('[data-role=pair-code]')).trim();
  await page.fill('[data-field=pair-name]', 'p65 test browser');
  await page.fill('[data-field=pair-code]', code);
  await page.click('[data-action=pair-submit]');
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 60000 });
  await win.click('[data-action=settings-close]');
  // PC 창은 이 세션을 안 보게 멀리 둔다(패널 크기는 웹이 정한다)
  await win.evaluate(() => window.__mt.getState().setViewport({ x: 0, y: 0, zoom: 0.2 }));
  await sleep(1500);
  const view = (z) => page.evaluate(([i, zz]) => { const st = window.__mt.getState(); const r = st.nodes.get(i); const el = document.querySelector('.mt-canvas'); st.setViewport({ x: el.clientWidth / 2 - (r.x + r.w / 2) * zz, y: el.clientHeight / 2 - (r.y + r.h / 2) * zz, zoom: zz }); }, [id, z]);
  await view(1); await sleep(2500);
  await until(() => page.$(`.mt-term[data-session="${id}"] .xterm-screen`), 40000);
  const scr = await page.$(`.mt-term[data-session="${id}"] .xterm-screen`); const bb = await scr.boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(400);
  await page.keyboard.type('cls; 1..13 | % { ("{0,2}" -f $_) + " The quick brown fox jumps over the lazy dog 0123456789" }'); await page.keyboard.press('Enter');
  await sleep(2500);
  for (const wz of [1, 1.25]) {
    await page.evaluate((z) => window.mt.setZoom(z), wz); await sleep(800);
    for (const z of [0.75, 1]) {
      await view(z); await sleep(1500);
      const m = await page.evaluate((i) => {
        const h = document.querySelector(`.mt-term[data-session="${i}"]`), s = h.querySelector('.xterm-screen'), cv = s.querySelector('canvas:not(.xterm-link-layer)');
        const t = window.__mt.terms.get(i), d = window.devicePixelRatio, q = cv.getBoundingClientRect(), fr = (v) => +(((v * d) % 1 + 1) % 1).toFixed(3);
        const r = s.getBoundingClientRect();
        return { sharp: h.dataset.sharp || null, dpr: d, zoomCss: document.documentElement.style.zoom || '', canvas: [cv.width, cv.height], sx: +(q.width * d / cv.width).toFixed(4), sy: +(q.height * d / cv.height).toFixed(4), phaseX: fr(q.x), phaseY: fr(q.y), rect: { x: r.x, y: r.y, w: r.width, h: r.height }, cols: t.cols, rows: t.rows };
      }, id);
      // 글이 있는 위 10줄을 찍어 가장자리 폭을 잰다(헤드리스 Chromium은 DPR 1). getBoundingClientRect 자리의 소수는 Blink 반올림 전 값이라 기준으로 쓰지 않는다
      const png = await page.screenshot({ clip: { x: m.rect.x, y: m.rect.y, width: m.rect.w, height: (10 * m.rect.h) / m.rows }, path: path.join(OUT, `${TAG}-web-ui${wz}-z${z}.png`) });
      const e = edgeWidth(decodePng(png));
      edges.push({ wz, z, ...e, sharp: m.sharp });
      check(`웹 화면 배율 ${wz}, 판 배율 ${z}: 글자 가장자리 폭 ${e.edge}px (${m.sharp || '배율 1 그대로'})`, e.edge !== null && (!SHARP || e.edge <= 0.9), { ...e, ...m });
      // 첫 번호 줄의 앞 20글자를 끌어 고른다
      const row = await page.evaluate((i) => { const t = window.__mt.terms.get(i), b = t.buffer.active; for (let k = 0; k < t.rows; k++) { const l = b.getLine(b.viewportY + k); const s = l ? l.translateToString(true) : ''; if (/^ 1 The quick/.test(s)) return { r: k, text: s.slice(0, 20) }; } return null; }, id);
      if (!row) { check(`웹 화면 배율 ${wz}, 판 배율 ${z}: 첫 줄이 보인다`, false); continue; }
      const cw = m.rect.w / m.cols, ch = m.rect.h / m.rows;
      // 마우스 좌표와 getBoundingClientRect는 같은 화면 좌표다(P42 고르기도 이 둘을 견준다)
      const y = (m.rect.y + (row.r + 0.5) * ch), x0 = m.rect.x + 0.15 * cw, x1 = m.rect.x + 19.6 * cw;
      await page.mouse.move(x0, y); await page.mouse.down();
      for (let k = 1; k <= 8; k++) { await page.mouse.move(x0 + ((x1 - x0) * k) / 8, y); await sleep(15); }
      await page.mouse.up(); await sleep(300);
      const sel = await page.evaluate((i) => window.__mt.terms.get(i).getSelection(), id);
      check(`웹 화면 배율 ${wz}, 판 배율 ${z}: 끌어 고르면 마우스 밑 20글자가 골라진다`, sel === row.text, { sel, want: row.text });
      await page.keyboard.press('Escape'); await page.mouse.click(5, 400); await sleep(300);
    }
  }
  await page.evaluate(() => window.mt.setZoom(1));
  // 짝 맺은 시험 브라우저를 PC 창에서 끊는다
  const mine = await page.evaluate(async () => (await window.__mt.api.call('device.list')).me);
  await win.click('[data-action=settings-open]'); await win.click('[data-tab=devices]');
  await win.waitForSelector(`[data-device="${mine.id}"]`);
  await win.click(`[data-device="${mine.id}"] [data-action=device-revoke]`);
  await page.waitForSelector('[data-role=pair]', { timeout: 15000 });
  check('시험 브라우저 끊음', true);
  await win.click('[data-action=settings-close]').catch(() => {});
} catch (e) {
  check('시험 오류', false, { error: e.stack || e.message });
} finally {
  fs.writeFileSync(path.join(OUT, `${TAG}-web.json`), JSON.stringify({ results, edges }, null, 2));
  if (browser) await browser.close().catch(() => {});
  await closeApp(app);
}
const fail = results.filter((r) => !r.ok).length;
log(`끝: ${results.length - fail}/${results.length} 통과`);
process.exit(fail ? 1 : 0);
