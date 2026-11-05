// P32 창 시험: 미션 맵 다시 그리기. 판: herdr 세션 atrium-dev-p32, 포트 47850, 이 워크트리의 backend/.dev(experiments/p32/tools/env.cjs).
// 판 차리기는 experiments/p32/tools/scene.mjs(base: lead → w1·w2·rev, lead의 하위 세션 helper(내 차례), solo, 사람 → lead; big: 셸 열둘 더).
// 사용: node experiments/p32/tools/e2e.cjs p32-mission.mjs before|base|big
//   before: 바꾸기 전 스크린숏(영어·한국어). 결과 이름 앞에 p32-before-
//   base:   스크린숏(영어·한국어), 겹침, 빈 곳 누르면 닫힘, 상자 누르면 그 노드로, 연결 알약으로 열고 닫기, Esc
//   big:    세션 15개 이상에서 겹침(상자끼리, 이름표끼리, 이름표와 상자)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p32') throw new Error('MT_E2E_OUT=p32를 명령줄에서 준다');
const MODE = process.argv[2] || 'base';
const PRE = MODE === 'before' ? 'p32-before-' : `p32-${MODE}-`;
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p32', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P32_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
fs.mkdirSync(OUT, { recursive: true });

const log = logger(`p32-${MODE}`);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const call = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);

const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const shot = async (page, name) => { const f = path.join(OUT, `${PRE}${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const size = async (app, w, h) => { await app.evaluate(({ BrowserWindow }, [ww, hh]) => BrowserWindow.getAllWindows()[0].setContentSize(ww, hh), [w, h]); await sleep(700); };
const isOpen = (page) => page.evaluate(() => !!document.querySelector('[data-role="mission"]'));

// 미션 맵 안의 상자·이름표 사각형(화면 좌표)과 겹치는 쌍
async function measure(page) {
  return page.evaluate(() => {
    const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const boxes = [...document.querySelectorAll('[data-role="mission"] [data-role="mm-node"]')].map((e) => ({ id: e.dataset.name || e.dataset.kind, ...R(e) }));
    const labels = [...document.querySelectorAll('[data-role="mission"] [data-role="mm-edge"] text, [data-role="mission"] [data-role="mm-label"]')].filter((e) => e.getBoundingClientRect().width > 0).map((e, i) => ({ id: `label${i}:${e.textContent}`, ...R(e) }));
    const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const pairs = (xs, ys, same) => { const out = []; xs.forEach((a, i) => ys.forEach((b, j) => { if ((!same || j > i) && hit(a, b)) out.push(`${a.id} × ${b.id}`); })); return out; };
    return { boxes: boxes.length, labels: labels.length, boxBox: pairs(boxes, boxes, true), labelLabel: pairs(labels, labels, true), labelBox: pairs(labels, boxes, false) };
  });
}

async function openByKey(page) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.keyboard.press('m');
  await sleep(400);
  if (!(await isOpen(page))) await page.click('[data-action="mission-rail"]');
  await page.waitForSelector('[data-role="mission"] [data-role="mm-node"][data-kind="session"]', { timeout: 20000 });
  await sleep(900);
}
async function closeMap(page) { if (await isOpen(page)) { await page.keyboard.press('Escape'); await sleep(400); } }

const app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
const page = await app.firstWindow();
page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') log(`[console.error] ${m.text().slice(0, 300)}`); });
try {
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await until(() => page.evaluate(() => !document.querySelector('[data-role="splash"]')), 20000, 100).catch(() => {});
  await size(app, 1584, 921);
  const names = await page.evaluate(() => [...window.__mt.getState().sessions.values()].map((s) => `${s.name}:${s.state}`));
  log('세션', names.join(' '));

  for (const lang of ['en', 'ko']) {
    await call(page, 'settings.set', { language: lang }); await sleep(800);
    await page.mouse.move(2, 600);
    await openByKey(page);
    await shot(page, `${lang}-map`);
    const m = await measure(page);
    step(`${lang}: 겹침 없음(상자 ${m.boxes}, 이름표 ${m.labels})`, MODE === 'before' || (!m.boxBox.length && !m.labelLabel.length && !m.labelBox.length), m);
    if (MODE === 'big') {
      // 최소 창(900×600): 스크롤로 다 보이고 겹치지 않는다
      await size(app, 900, 600); await sleep(500);
      await shot(page, `${lang}-map-900`);
      const s = await measure(page);
      step(`${lang}: 최소 창에서도 겹침 없음`, !s.boxBox.length && !s.labelLabel.length && !s.labelBox.length, s);
      await size(app, 1584, 921);
    }
    if (lang === 'en' && MODE !== 'before') {
      // 마우스를 올리면 긴 글이 다 보인다(title)
      const tip = await page.evaluate(() => { const e = document.querySelector('[data-role="mm-node"][data-name="helper"]'); return e ? e.getAttribute('title') : null; });
      step('en: 내 차례 상자에 올리면 묻는 내용 전체', !!tip && tip.length > 10, tip);
      const hb = await page.locator('[data-role="mm-node"][data-name="helper"]').boundingBox();
      if (hb) { await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await sleep(700); await shot(page, 'en-hover'); }
    }
    await closeMap(page);
  }
  await call(page, 'settings.set', { language: 'en' }); await sleep(500);

  if (MODE === 'base') {
    // 빈 곳 누르면 닫힘: 맵 몸통의 가장자리(상자, 선, 단추가 없는 곳)
    await openByKey(page);
    const spot = await page.evaluate(() => {
      const body = document.querySelector('[data-role="mission"] .mt-mission-body').getBoundingClientRect();
      for (let y = body.bottom - 12; y > body.top + 10; y -= 23) for (let x = body.right - 14; x > body.left + 10; x -= 31) {
        const e = document.elementFromPoint(x, y);
        if (e && !e.closest('[data-role="mm-node"], [data-role="mm-edge"], button, [data-role="mm-legend"]')) return { x, y, el: e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className };
      }
      return null;
    });
    await page.mouse.click(spot.x, spot.y); await sleep(500);
    step('빈 곳을 누르면 닫힌다', spot && !(await isOpen(page)), spot);
    // 머리줄의 빈 곳도
    await openByKey(page);
    const head = await page.evaluate(() => { const h = document.querySelector('[data-role="mission"] .mt-mission-head').getBoundingClientRect(); for (let x = h.right - 80; x > h.left; x -= 20) { const e = document.elementFromPoint(x, h.top + h.height / 2); if (e && !e.closest('button, [data-role="mm-legend"]')) return { x, y: h.top + h.height / 2 }; } return null; });
    if (head) { await page.mouse.click(head.x, head.y); await sleep(500); }
    step('머리줄의 빈 곳을 눌러도 닫힌다', head && !(await isOpen(page)), head);
    // 거르기 단추는 닫지 않는다
    await openByKey(page);
    await page.click('[data-role="mission"] [data-filter="working"]'); await sleep(500);
    const afterFilter = await page.evaluate(() => [...document.querySelectorAll('[data-role="mm-node"][data-kind="session"]')].map((e) => e.dataset.name));
    step('거르기 단추는 닫지 않는다', (await isOpen(page)) && afterFilter.includes('w1'), afterFilter);
    await shot(page, 'filter-working');
    await page.click('[data-role="mission"] [data-filter="all"]'); await sleep(400);
    // 상자를 누르면 그 노드로 간다
    await page.locator('[data-role="mm-node"][data-name="rev"]').click(); await sleep(1500);
    const went = await page.evaluate(() => { const st = window.__mt.getState(); const s = [...st.sessions.values()].find((x) => x.name === 'rev'); const el = document.querySelector(`.mt-node[data-name="rev"]`); const c = document.querySelector('.mt-canvas').getBoundingClientRect(); if (!el) return { sel: st.selected, inView: false }; const r = el.getBoundingClientRect(); return { sel: st.selected.includes(s.sessionId) || st.focused === s.sessionId, inView: r.left >= c.left - 2 && r.right <= c.right + 2 && r.top >= c.top - 2 && r.bottom <= c.bottom + 2 }; });
    step('상자를 누르면 맵이 닫히고 그 노드로 간다', !(await isOpen(page)) && went.inView, went);
    await shot(page, 'went-to-rev');
    await page.keyboard.press('Escape'); await sleep(300);
    // Esc
    await openByKey(page);
    await page.keyboard.press('Escape'); await sleep(400);
    step('Esc로 닫힌다', !(await isOpen(page)));
    // 연결 알약
    const pill = page.locator('[data-role="conn"]');
    const pillTitle = await pill.getAttribute('title');
    await pill.click(); await sleep(900);
    const o1 = await isOpen(page);
    await shot(page, 'pill-open');
    await pill.click(); await sleep(500);
    const o2 = await isOpen(page);
    step('연결 알약: 누르면 열리고 다시 누르면 닫힌다, 올리면 연결 풀이', o1 && !o2 && /herdr/i.test(pillTitle || ''), { o1, o2, pillTitle });
  }
} catch (e) {
  step('예외', false, e.stack);
} finally {
  fs.writeFileSync(path.join(OUT, `p32-${MODE}.json`), JSON.stringify(results, null, 2));
  const fail = results.filter((r) => !r.ok).length;
  log(`끝: ${results.length - fail}/${results.length} 통과`);
  await closeApp(app);
  process.exit(fail ? 1 : 0);
}
