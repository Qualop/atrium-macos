// P30 재현 시도 기록: 사용자 순서(레일로 둘 띄우기 → 몇 초 안에 아래로 끌어 붙이기 → 영역 끌기 → 덩어리 끌기 → 머리줄 누르기 → 크기). 결과는 experiments/p30/p30-probe2.txt(재현되지 않음)
import fs from 'node:fs';
import path from 'node:path';
import { launch, closeApp, shot, logger, sleep, until, call, DIRS, DEV } from './p10-lib.mjs';

const log = logger('p30-probe2');
for (const d of [DIRS.ws, path.join(DEV, 'fixture-projects-p30'), path.join(DEV, 'fixture-sessions-p30')]) fs.mkdirSync(d, { recursive: true });
const rects = (page) => page.evaluate(() => { const s = window.__mt.getState(); return Object.fromEntries([...s.sessions.values()].map((x) => [x.name, s.nodes.get(x.sessionId)]).filter(([, r]) => r).map(([n, r]) => [n, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }])); });
const zoomOf = (page) => page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);
const sel = (page) => page.evaluate(() => window.__mt.getState().selected.map((id) => window.__mt.getState().sessions.get(id)?.name));
async function dragBy(page, x, y, dx, dy, steps = 12) { await page.mouse.move(x, y); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps); await sleep(30); } await sleep(150); await page.mouse.up(); }
const spawnNew = async (page) => {
  const before = await page.evaluate(() => [...window.__mt.getState().sessions.keys()]);
  await page.click(process.argv[2] === 'claude' ? '[data-action=spawn]' : '[data-action=spawn-shell]');
  const id = await until(async () => page.evaluate((b) => [...window.__mt.getState().sessions.keys()].find((k) => !b.includes(k)) || null, before), 30000, 200);
  await until(async () => page.evaluate((i) => window.__mt.getState().nodes.has(i), id), 10000, 100);
  return page.evaluate((i) => window.__mt.getState().sessions.get(i).name, id);
};
let { app, page } = await launch({ log });
try {
  if (await page.$('[data-role="sidebar"]')) await page.click('[data-action="sidebar"]');
  for (const d of await call(page, 'dock.list')) await call(page, 'dock.remove', { dock: d.dockId });
  for (const s of await page.evaluate(() => [...window.__mt.getState().sessions.values()].map((x) => x.name))) await call(page, 'session.kill', { session: s, confirm: true }).catch(() => {});
  await sleep(1500);
  if (!(await page.evaluate(() => window.__mt.getState().currentWs))) { await call(page, 'session.spawn', { cwd: DIRS.ws, kind: 'shell', name: 'seed' }); await sleep(2000); await call(page, 'session.kill', { session: 'seed', confirm: true }); await sleep(800); }
  const A = await spawnNew(page);
  await sleep(1500);
  const B = await spawnNew(page);
  await sleep(600);
  log('spawned', A, B, await rects(page), 'sel', await sel(page));
  let R = await rects(page);
  await page.evaluate(([a, b]) => { const x = Math.min(a.x, b.x) - 300, y = Math.min(a.y, b.y) - 300; window.__mt.getState().navigateToRect({ x, y, w: Math.max(a.x + a.w, b.x + b.w) - x + 300, h: Math.max(a.y + a.h, b.y + b.h) - y + 900 }, 0); }, [R[A], R[B]]);
  await sleep(700);
  let z = await zoomOf(page);
  // B를 A 아래로(끌어 붙이기)
  let hb = await page.locator(`.mt-node[data-name="${B}"] .mt-node-head`).boundingBox();
  await dragBy(page, hb.x + 150, hb.y + hb.height / 2, (R[A].x - R[B].x) * z, (R[A].y + R[A].h + 20 - R[B].y) * z);
  await sleep(1200);
  log('after snap', await rects(page), await page.evaluate(() => [...window.__mt.getState().docks.values()].map((d) => d.tree)), 'sel', await sel(page));
  // 영역 끌기
  const rh = await page.locator('.mt-region-head').first().boundingBox();
  if (rh) { await dragBy(page, rh.x + 40, rh.y + rh.height / 2, -60, 0); await sleep(800); await dragBy(page, rh.x - 20, rh.y + rh.height / 2, -80, -20); await sleep(800); }
  log('after region drags', await rects(page), 'sel', await sel(page));
  // 덩어리 끌기(A 머리줄)
  let ha = await page.locator(`.mt-node[data-name="${A}"] .mt-node-head`).boundingBox();
  await dragBy(page, ha.x + 150, ha.y + ha.height / 2, 50, 40);
  await sleep(1000);
  log('after dock drag', await rects(page), 'sel', await sel(page), 'bar', await page.isVisible('[data-role=selection]'));
  // 머리줄 누르기(고르기)
  ha = await page.locator(`.mt-node[data-name="${A}"] .mt-node-head`).boundingBox();
  await page.mouse.click(ha.x + 150, ha.y + ha.height / 2);
  await sleep(800);
  log('after head click', 'sel', await sel(page), 'bar', await page.isVisible('[data-role=selection]'));
  await shot(page, 'p30-probe2-1');
  for (const k of ['wide-large', 'tall-normal', 'wide-small']) {
    if (!(await page.isVisible('[data-role=selection]'))) { log('막대 없음'); break; }
    const dir = k.split('-')[0];
    const cur = await page.evaluate(() => document.querySelector('[data-role=size-buttons]').dataset.dir);
    if (cur !== dir) { await page.click(`[data-role=size-dir] [data-dir=${dir}]`); await sleep(400); log('toggle', dir, await page.evaluate(() => document.querySelector('[data-role=size-buttons]').dataset.dir)); }
    await page.click(`[data-role=selection] [data-size=${k}]`);
    await sleep(1200);
    log(`after ${k}`, await rects(page));
  }
  await shot(page, 'p30-probe2-2');
} catch (e) { log('오류', e.stack); }
finally { await closeApp(app); }
