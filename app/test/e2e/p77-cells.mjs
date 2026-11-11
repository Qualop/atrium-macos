// P77 창 시험: 덩어리의 크기 막대(가로형·세로형, 16:9·4:3, 크게·보통·작게)가 세션 칸 하나에 쓰이는가.
// H 넷 가로형 16:9 크게, V 넷 세로형 4:3 보통, 2 × 2 가로형 16:9 보통, 고르지 않은 틀(1 + 3), 떼기·붙이기, 바깥 테두리 끌기 뒤 불 꺼짐.
// 판: herdr 세션 atrium-dev-p77, 포트 47897, 이 워크트리의 backend/.dev(data, app). 시험 폴더는 새로 만든 C:\Workspace\mtask-p77-ws 하나. 셸 넷(s1~s4).
// 고치기 전 코드로도 같은 단계를 돌려 비교한다(MT_E2E_TAG=before: 값을 재어 남기고, 기대와 다르면 실패로 적는다). 결과는 experiments/p77/(git 밖).
// 사용(app 폴더에서, 판 값이 없는 셸로): MT_E2E_OUT=p77 MT_E2E_TAG=after node test/e2e/p77-cells.mjs [--clean]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, closeApp, shot, logger, sleep, REPO, OUT } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';
import { loadConfig } from '../../../backend/src/config.mjs';

if (process.env.MT_E2E_OUT !== 'p77') throw new Error('MT_E2E_OUT=p77을 명령줄에서 준다');
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) throw new Error(`판 값이 든 셸에서 돌리지 않는다(${k}). backend/.dev/clean-env.sh로 부른다`);
const TAG = process.env.MT_E2E_TAG || 'after';
const DEV = path.join(REPO, 'backend', '.dev');
const WS = 'C:\\Workspace\\mtask-p77-ws';
const FIX = path.join(DEV, 'fixture-projects-p77');
const ENV = {
  ATRIUM_HERDR_SESSION: 'atrium-dev-p77', ATRIUM_PORT: '47897',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: FIX, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_CLAUDE_SESSIONS: path.join(DEV, 'fixture-sessions-p77'), ATRIUM_TEST_PREFIX: 'mtask-p77-x',
};
assertTestBoard(ENV, { root: DEV });
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const atrium = (...args) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...args], { encoding: 'utf8', env: { ...cleanEnv(), ...ENV } });

// ---------- 정리(--clean): 시험 세션, herdr 서버와 백엔드, herdr 세션 atrium-dev-p77, 데이터와 시험 폴더 ----------
if (process.argv.includes('--clean')) {
  const say = (...a) => console.log(...a);
  const cfg = loadConfig({ argv: ['--dev'], env: { ...process.env, ...ENV } });
  if (cfg.herdrSession !== 'atrium-dev-p77' || String(cfg.port) !== '47897') throw new Error('P77 판만');
  let up = true;
  try { atrium('status'); } catch { up = false; }
  if (up) {
    const list = JSON.parse(atrium('--json', 'ls'));
    for (const s of Array.isArray(list) ? list : list.sessions || []) { try { say('kill', s.name, atrium('kill', s.name, '--yes').trim().slice(0, 120)); } catch (e) { say('kill 실패', s.name, String(e.message).slice(0, 200)); } }
    await sleep(3000);
    try { say('herdr stop', atrium('herdr', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { say('herdr stop 실패', String(e.message).slice(0, 200)); }
    try { say('backend stop', atrium('backend', 'stop').trim()); } catch (e) { say('backend stop 실패', String(e.message).slice(0, 200)); }
  }
  const herdr = (...a) => { try { return execFileSync(cfg.herdrPath || 'herdr', a, { encoding: 'utf8', env: cleanEnv() }).trim(); } catch (e) { return `실패: ${String(e.stderr || e.message).trim().slice(0, 200)}`; } };
  say('herdr session stop', herdr('session', 'stop', cfg.herdrSession));
  say('herdr session delete', herdr('session', 'delete', cfg.herdrSession));
  for (const d of [ENV.ATRIUM_DATA_DIR, ENV.ATRIUM_APP_USERDATA, path.join(DEV, 'app-dev'), FIX, ENV.ATRIUM_CLAUDE_SESSIONS, WS]) { fs.rmSync(d, { recursive: true, force: true }); say('지움', d); }
  process.exit(0);
}

const log = logger(`p77-${TAG}`);
const result = { tag: TAG, steps: [] };
const step = (name, ok, data = {}) => { result.steps.push({ name, ok: !!ok, ...data }); log(`${ok ? '통과' : '실패'}: ${name}`, data); };
const save = () => fs.writeFileSync(path.join(OUT, `p77-${TAG}.json`), JSON.stringify(result, null, 2));
for (const d of [WS, FIX, ENV.ATRIUM_CLAUDE_SESSIONS, OUT]) fs.mkdirSync(d, { recursive: true });

const call = (page, method, params = {}) => page.evaluate(([m, p]) => window.__mt.api.call(m, p), [method, params]);
const sid = (page, name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? s.sessionId : null; }, name);
const dockInfo = (page) => page.evaluate(() => { const s = window.__mt.getState(); return [...s.docks.values()].map((d) => { const rs = d.members.map((m) => s.nodes.get(m)); const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)); return { dockId: d.dockId, aspect: d.aspect || null, outer: { x: Math.round(x0), y: Math.round(y0), w: Math.round(Math.max(...rs.map((r) => r.x + r.w)) - x0), h: Math.round(Math.max(...rs.map((r) => r.y + r.h)) - y0) }, cells: Object.fromEntries(d.members.map((m) => { const r = s.nodes.get(m); return [s.sessions.get(m).name, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }]; })) }; }); });
const bar = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-role=selection]');
  if (!el) return null;
  const on = (sel) => [...el.querySelectorAll(sel)].filter((b) => b.classList.contains('on')).map((b) => b.dataset.dir || b.dataset.level || b.dataset.aspect);
  const unit = el.querySelector('[data-role=size-unit]');
  return { dir: on('[data-role=size-dir] [data-dir]')[0] || null, level: on('[data-level]')[0] || null, aspect: on('[data-aspect]')[0] || null, unit: unit ? unit.textContent : null, unitTitle: unit ? unit.title : null, dirTitle: el.querySelector('[data-role=size-dir]').title, compact: +el.dataset.compact };
});
async function frame(page, rect, margin = 200) { await page.evaluate(([r, m]) => window.__mt.getState().navigateToRect({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }, 0), [rect, margin]); await sleep(700); }
const clearSel = async (page) => { await page.evaluate(() => { const s = window.__mt.getState(); if (s.clearSelection) s.clearSelection(); }); await sleep(250); };
async function select(page, name) {
  // 고른 것이 그 덩어리면 그대로 둔다. 아니면 머리줄을 Ctrl+누른다(화면을 옮기지 않는다)
  const cur = await page.evaluate(() => window.__mt.getState().selected.map((id) => window.__mt.getState().sessions.get(id).name));
  if (cur.length === 1 && cur[0] === name && (await page.$('[data-role=selection]'))) return;
  await clearSel(page);
  const head = await page.locator(`.mt-node[data-name="${name}"] .mt-node-head`).boundingBox();
  await page.keyboard.down('Control');
  await page.mouse.click(head.x + Math.min(40, head.width / 3), head.y + head.height / 2);
  await page.keyboard.up('Control');
  await sleep(500);
}
const press = async (page, sel) => {
  if (sel.startsWith('[data-preset') && !(await page.isVisible(`[data-role=selection] ${sel}`)) && (await page.isVisible('[data-role=selection] [data-action=layout-more]'))) { await page.click('[data-role=selection] [data-action=layout-more]'); await sleep(300); }
  await page.click(`[data-role=selection] ${sel}`); await sleep(900);
};
// 막대로 방향·비율·단계를 고른다(불이 든 것은 누르지 않는다)
async function pick(page, { dir, aspect, level }) {
  const d0 = (await dockInfo(page))[0];
  await frame(page, d0.outer); await select(page, 's1');
  if ((await bar(page)).dir !== dir) await press(page, `[data-role=size-dir] [data-dir=${dir}]`);
  if ((await bar(page)).aspect !== aspect) await press(page, `[data-aspect="${aspect}"]`);
  await press(page, `[data-level=${level}]`);
  const d = (await dockInfo(page))[0];
  await frame(page, d.outer); await select(page, 's1');
  return { d, b: await bar(page) };
}
const all = (cells, w, h) => Object.values(cells).every((c) => c.w === w && c.h === h);
const sizes = (cells) => Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, `${c.w}x${c.h}`]));

const { app, page } = await launch({ log, env: ENV });
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(false));
  await sleep(800);
  if ((await page.evaluate(() => window.__mt.getState().sessions.size)) > 0) throw new Error('판이 비어 있지 않다. 먼저 --clean');
  for (const n of ['s1', 's2', 's3', 's4']) await call(page, 'session.spawn', { cwd: WS, kind: 'shell', name: n });
  await sleep(4000);

  // ---------- 1. H 넷 가로형 16:9 크게 ----------
  await call(page, 'dock.layout', { members: ['s1', 's2', 's3', 's4'], preset: 'row' });
  await sleep(1200);
  let { d, b } = await pick(page, { dir: 'wide', aspect: '16:9', level: 'large' });
  step('H 넷 가로형 16:9 크게: 칸마다 1920×1080, 바깥 7680×1080, 막대 불 가로형·16:9·크게, "칸마다" 글', all(d.cells, 1920, 1080) && d.outer.w === 7680 && d.outer.h === 1080 && b.dir === 'wide' && b.aspect === '16:9' && b.level === 'large' && !!b.unit, { outer: d.outer, cells: sizes(d.cells), bar: b });
  await shot(page, `${TAG}-01-H4-wide-16x9-large`, log);

  // ---------- 2. V 넷 세로형 4:3 보통 ----------
  await press(page, '[data-preset=col]');
  ({ d, b } = await pick(page, { dir: 'tall', aspect: '4:3', level: 'normal' }));
  step('V 넷 세로형 4:3 보통: 칸마다 900×1200, 바깥 900×4800', all(d.cells, 900, 1200) && d.outer.w === 900 && d.outer.h === 4800 && b.dir === 'tall' && b.aspect === '4:3' && b.level === 'normal', { outer: d.outer, cells: sizes(d.cells), bar: b });
  await shot(page, `${TAG}-02-V4-tall-4x3-normal`, log);

  // ---------- 3. 2 × 2 가로형 16:9 보통 ----------
  await press(page, '[data-preset=grid]');
  ({ d, b } = await pick(page, { dir: 'wide', aspect: '16:9', level: 'normal' }));
  step('2 × 2 가로형 16:9 보통: 칸마다 1440×810, 바깥 2880×1620', all(d.cells, 1440, 810) && d.outer.w === 2880 && d.outer.h === 1620 && b.level === 'normal', { outer: d.outer, cells: sizes(d.cells), bar: b });
  await shot(page, `${TAG}-03-grid-wide-16x9-normal`, log);

  // ---------- 4. 고르지 않은 틀(1 + 3): 작은 칸은 지금 칸, 큰 칸은 작은 칸 3 × 3 ----------
  await press(page, '[data-preset=main-left-3]');
  d = (await dockInfo(page))[0];
  await frame(page, d.outer); await select(page, 's1');
  b = await bar(page);
  step('1 + 3 틀: 작은 칸 1440×810, 큰 칸 4320×2430, 바깥 5760×2430, 불 그대로', d.cells.s2.w === 1440 && d.cells.s2.h === 810 && d.cells.s1.w === 4320 && d.cells.s1.h === 2430 && d.outer.w === 5760 && d.outer.h === 2430 && b.aspect === '16:9' && b.level === 'normal', { outer: d.outer, cells: sizes(d.cells), bar: b });
  await shot(page, `${TAG}-04-main-left-3`, log);
  // 같은 크기에서 1 + 3을 가로형 16:9 크게로(큰 칸도 함께)
  ({ d, b } = await pick(page, { dir: 'wide', aspect: '16:9', level: 'large' }));
  step('1 + 3 크게: 작은 칸 1920×1080, 큰 칸 5760×3240', d.cells.s2.w === 1920 && d.cells.s2.h === 1080 && d.cells.s1.w === 5760 && d.cells.s1.h === 3240, { outer: d.outer, cells: sizes(d.cells), bar: b });
  await shot(page, `${TAG}-05-main-left-3-large`, log);

  // ---------- 5. 떼기·붙이기: 불이 든 동안 칸 크기를 지킨다 ----------
  await press(page, '[data-preset=row]');
  const h3 = (await dockInfo(page))[0];
  await call(page, 'dock.remove', { session: 's4' });
  await sleep(1000);
  d = (await dockInfo(page))[0];
  step('H 넷에서 하나 떼기: 칸은 그대로, 바깥이 준다', all(d.cells, h3.cells.s1.w, h3.cells.s1.h) && d.outer.w === h3.outer.w - h3.cells.s1.w, { before: h3.outer, outer: d.outer, cells: sizes(d.cells) });
  await call(page, 'dock.attach', { session: 's4', to: 's3', side: 'right', at: 'dock' });
  await sleep(1000);
  d = (await dockInfo(page))[0];
  step('다시 붙이기: 칸은 그대로, 바깥이 는다', all(d.cells, h3.cells.s1.w, h3.cells.s1.h) && d.outer.w === h3.outer.w, { outer: d.outer, cells: sizes(d.cells) });
  await frame(page, d.outer); await select(page, 's1');
  await shot(page, `${TAG}-06-detach-attach`, log);

  // ---------- 6. 바깥 테두리 끌기: 칸이 함께 커지고 불이 꺼진다 ----------
  await press(page, '[data-preset=grid]');
  d = (await dockInfo(page))[0];
  await frame(page, d.outer, 300);
  await clearSel(page);
  const edge = await page.locator('[data-role=dock-edge][data-side=bottom]').first().boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2 + 40, { steps: 6 });
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2 + 80, { steps: 6 });
  await page.mouse.up();
  await sleep(1200);
  const d2 = (await dockInfo(page))[0];
  await select(page, 's1');
  b = await bar(page);
  step('바깥 테두리를 끌면 칸이 함께 커지고 비율·단계 불이 꺼진다', d2.outer.h > d.outer.h && d2.cells.s1.h > d.cells.s1.h && b.aspect === null && b.level === null, { before: d.outer, outer: d2.outer, cells: sizes(d2.cells), bar: b });
  await shot(page, `${TAG}-07-edge-dragged`, log);
  // 넓은 창에서는 막대 앞에 "칸마다" 글이 보인다(좁은 창의 줄인 막대에서는 도움말만)
  await press(page, '[data-aspect="16:9"]');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1880, 960));
  await sleep(1200);
  const d3 = (await dockInfo(page))[0];
  await frame(page, d3.outer); await select(page, 's1');
  b = await bar(page);
  const shown = await page.evaluate(() => { const u = document.querySelector('[data-role=size-unit]'); return !!u && u.offsetWidth > 0; });
  step('넓은 창: "칸마다" 글이 보이고 16:9에 다시 불', TAG === 'before' ? false : shown && b.aspect === '16:9', { compact: b.compact, shown, outer: d3.outer, cells: sizes(d3.cells), bar: b });
  await shot(page, `${TAG}-07b-wide-window-unit`, log);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(800);

  // ---------- 7. 혼자인 세션의 막대는 그대로 ----------
  await call(page, 'dock.remove', { dock: d2.dockId });
  await sleep(800);
  await call(page, 'board.setSize', { session: 's1', size: 'wide-large' });
  await sleep(800);
  const r1 = await page.evaluate(() => { const s = window.__mt.getState(); const x = [...s.sessions.values()].find((y) => y.name === 's1'); const r = s.nodes.get(x.sessionId); return { x: r.x, y: r.y, w: r.w, h: r.h }; });
  await frame(page, r1); await select(page, 's1');
  b = await bar(page);
  step('혼자인 세션: 가로형 16:9 크게 1920×1080, "칸마다" 글 없음', r1.w === 1920 && r1.h === 1080 && b.level === 'large' && !b.unit, { rect: r1, bar: b });
  await shot(page, `${TAG}-08-single`, log);
} catch (e) {
  step('시험 오류', false, { error: String(e.stack || e).slice(0, 1200) });
  await shot(page, `${TAG}-99-error`, log).catch(() => {});
} finally {
  save();
  await closeApp(app);
  const bad = result.steps.filter((s) => !s.ok);
  log(`끝: 통과 ${result.steps.length - bad.length}, 실패 ${bad.length}`);
}
process.exit(0);
