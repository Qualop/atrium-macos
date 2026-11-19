// P80 창 시험: 덩어리 크기 막대가 틀 비율을 지키고 바깥만 정하는가(칸은 고른 모양에 가장 가깝게, 넓이 = 단독 세션 × √n).
// H 넷·2 × 2·1 + 3을 가로형 16:9 크게, 세로형 4:3 보통, 작게(세로형 4:3 그대로)로. 1 + 3은 틀을 고른 뒤 크기 누르기와 크기를 누른 뒤 틀 고르기(2 × 2에서) 둘 다.
// 떼기·붙이기, 바깥 테두리 끌기 뒤 불 꺼짐, 혼자인 세션 그대로.
// 판: herdr 세션 atrium-dev-p80, 포트 47897, 이 워크트리의 backend/.dev(data, app). 시험 폴더는 새로 만든 C:\Workspace\mtask-p80-ws 하나. 셸 넷(s1~s4).
// 고치기 전 코드로도 같은 단계를 돌려 비교한다(MT_E2E_TAG=before: 값을 재어 남기고, 기대와 다르면 실패로 적는다). 결과는 experiments/p80/(git 밖).
// 사용(app 폴더에서, 판 값이 없는 셸로): MT_E2E_OUT=p80 MT_E2E_TAG=after node test/e2e/p80-dock-size.mjs [--clean]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, closeApp, shot, logger, sleep, REPO, OUT } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';
import { loadConfig } from '../../../backend/src/config.mjs';
import { hcStateDir } from '../../../backend/src/hc/core.mjs'; // P129: 이 판의 hc 상태 폴더(세션을 지우는 자리)

if (process.env.MT_E2E_OUT !== 'p80') throw new Error('MT_E2E_OUT=p80을 명령줄에서 준다');
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) throw new Error(`판 값이 든 셸에서 돌리지 않는다(${k}). backend/.dev/clean-env.sh로 부른다`);
const TAG = process.env.MT_E2E_TAG || 'after';
const DEV = path.join(REPO, 'backend', '.dev');
const WS = 'C:\\Workspace\\mtask-p80-ws';
const FIX = path.join(DEV, 'fixture-projects-p80');
const ENV = {
  ATRIUM_HERDR_SESSION: 'atrium-dev-p80', ATRIUM_PORT: '47897',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: FIX, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_CLAUDE_SESSIONS: path.join(DEV, 'fixture-sessions-p80'), ATRIUM_TEST_PREFIX: 'mtask-p80-x',
};
assertTestBoard(ENV, { root: DEV });
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const atrium = (...args) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...args], { encoding: 'utf8', env: { ...cleanEnv(), ...ENV } });

// ---------- 정리(--clean): 시험 세션, herdr 서버와 백엔드, herdr 세션 atrium-dev-p80, 데이터와 시험 폴더 ----------
if (process.argv.includes('--clean')) {
  const say = (...a) => console.log(...a);
  const cfg = loadConfig({ argv: ['--dev'], env: { ...process.env, ...ENV } });
  if (cfg.terminalSession !== 'atrium-dev-p80' || String(cfg.port) !== '47897') throw new Error('P80 판만');
  let up = true;
  try { atrium('status'); } catch { up = false; }
  if (up) {
    const list = JSON.parse(atrium('--json', 'ls'));
    for (const s of Array.isArray(list) ? list : list.sessions || []) { try { say('kill', s.name, atrium('kill', s.name, '--yes').trim().slice(0, 120)); } catch (e) { say('kill 실패', s.name, String(e.message).slice(0, 200)); } }
    await sleep(3000);
    try { say('herdr stop', atrium('herdr', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { say('herdr stop 실패', String(e.message).slice(0, 200)); }
    try { say('backend stop', atrium('backend', 'stop').trim()); } catch (e) { say('backend stop 실패', String(e.message).slice(0, 200)); }
  }
  { const d = hcStateDir(cfg.terminalSession); fs.rmSync(d, { recursive: true, force: true }); say('hc 상태 지움', d); }
  for (const d of [ENV.ATRIUM_DATA_DIR, ENV.ATRIUM_APP_USERDATA, path.join(DEV, 'app-dev'), FIX, ENV.ATRIUM_CLAUDE_SESSIONS, WS]) { fs.rmSync(d, { recursive: true, force: true }); say('지움', d); }
  process.exit(0);
}

const log = logger(`p80-${TAG}`);
const result = { tag: TAG, steps: [], table: [] };
const step = (name, ok, data = {}) => { result.steps.push({ name, ok: !!ok, ...data }); log(`${ok ? '통과' : '실패'}: ${name}`, data); };
const save = () => fs.writeFileSync(path.join(OUT, `p80-${TAG}.json`), JSON.stringify(result, null, 2));
for (const d of [WS, FIX, ENV.ATRIUM_CLAUDE_SESSIONS, OUT]) fs.mkdirSync(d, { recursive: true });

const call = (page, method, params = {}) => page.evaluate(([m, p]) => window.__mt.api.call(m, p), [method, params]);
const dockInfo = (page) => page.evaluate(() => { const s = window.__mt.getState(); return [...s.docks.values()].map((d) => { const rs = d.members.map((m) => s.nodes.get(m)); const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)); return { dockId: d.dockId, aspect: d.aspect || null, ratios: d.tree && d.tree.ratios, outer: { x: Math.round(x0), y: Math.round(y0), w: Math.round(Math.max(...rs.map((r) => r.x + r.w)) - x0), h: Math.round(Math.max(...rs.map((r) => r.y + r.h)) - y0) }, cells: Object.fromEntries(d.members.map((m) => { const r = s.nodes.get(m); return [s.sessions.get(m).name, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }]; })) }; }); });
const bar = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-role=selection]');
  if (!el) return null;
  const on = (sel) => [...el.querySelectorAll(sel)].filter((b) => b.classList.contains('on')).map((b) => b.dataset.dir || b.dataset.level || b.dataset.aspect);
  const unit = el.querySelector('[data-role=size-unit]');
  const large = el.querySelector('[data-level=large]');
  return { dir: on('[data-role=size-dir] [data-dir]')[0] || null, level: on('[data-level]')[0] || null, aspect: on('[data-aspect]')[0] || null, unit: unit ? unit.textContent : null, dirTitle: el.querySelector('[data-role=size-dir]').title, largeTitle: large ? large.title : null };
});
async function frame(page, rect, margin = 200) { await page.evaluate(([r, m]) => window.__mt.getState().navigateToRect({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }, 0), [rect, margin]); await sleep(700); }
const clearSel = async (page) => { await page.evaluate(() => { const s = window.__mt.getState(); if (s.clearSelection) s.clearSelection(); }); await sleep(250); };
async function select(page, name) {
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
const focus = async (page) => { const d = (await dockInfo(page))[0]; await frame(page, d.outer); await select(page, 's1'); return d; };
// 막대로 방향·비율·단계를 고른다(불이 든 것은 누르지 않는다. 단계는 늘 누른다)
async function pick(page, { dir, aspect, level }) {
  await focus(page);
  if ((await bar(page)).dir !== dir) await press(page, `[data-role=size-dir] [data-dir=${dir}]`);
  if ((await bar(page)).aspect !== aspect) await press(page, `[data-aspect="${aspect}"]`);
  await press(page, `[data-level=${level}]`);
  const d = await focus(page);
  return { d, b: await bar(page) };
}
const preset = async (page, name) => { await focus(page); await press(page, `[data-preset=${name}]`); const d = await focus(page); return { d, b: await bar(page) }; };

// 기대: 단독 세션 크기와 넓이 √4, 칸이 고른 모양(고른 틀은 모두, 1 + 3은 큰 칸이 작은 칸보다 멀지 않게), 틀 비율
const TABLE = { '16:9': { large: [1920, 1080], normal: [1440, 810], small: [1040, 585] }, '4:3': { large: [1600, 1200], normal: [1200, 900], small: [880, 660] } };
const want = (dir, aspect) => { const [p, q] = aspect.split(':').map(Number); return dir === 'tall' ? q / p : p / q; };
const off = (c, r) => Math.abs(Math.log(c.w / c.h / r));
const sizes = (cells) => Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, `${c.w}x${c.h}`]));
const RATIOS = { row: [0.25, 0.25, 0.25, 0.25], grid: [0.5, 0.5], 'main-left-3': [0.5, 0.5] };
function judge(layout, size, d, b) {
  const [sw, sh] = TABLE[size.aspect][size.level];
  const r = want(size.dir, size.aspect);
  const cs = Object.values(d.cells);
  const areaOk = Math.abs((d.outer.w * d.outer.h) / (sw * sh * 2) - 1) < 0.01;
  const ratiosOk = JSON.stringify(d.ratios) === JSON.stringify(RATIOS[layout]);
  const shapeOk = layout === 'main-left-3' ? off(d.cells.s1, r) <= Math.min(...cs.slice(1).map((c) => off(c, r))) + 0.01 : cs.every((c) => off(c, r) < 0.01);
  const barOk = b && b.dir === size.dir && b.aspect === size.aspect && b.level === size.level && !b.unit;
  return { ok: areaOk && ratiosOk && shapeOk && barOk, checks: { areaOk, ratiosOk, shapeOk, barOk } };
}
const SIZES = [{ dir: 'wide', aspect: '16:9', level: 'large' }, { dir: 'tall', aspect: '4:3', level: 'normal' }, { dir: 'tall', aspect: '4:3', level: 'small' }];
const sizeName = (s) => `${s.dir === 'wide' ? '가로형' : '세로형'} ${s.aspect} ${{ large: '크게', normal: '보통', small: '작게' }[s.level]}`;
const fileName = (s) => `${s.dir}-${s.aspect.replace(':', 'x')}-${s.level}`;

const { app, page } = await launch({ log, env: ENV });
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(false));
  await sleep(800);
  if ((await page.evaluate(() => window.__mt.getState().sessions.size)) > 0) throw new Error('판이 비어 있지 않다. 먼저 --clean');
  for (const n of ['s1', 's2', 's3', 's4']) await call(page, 'session.spawn', { cwd: WS, kind: 'shell', name: n });
  await sleep(4000);
  await call(page, 'dock.layout', { members: ['s1', 's2', 's3', 's4'], preset: 'row' });
  await sleep(1200);

  // ---------- 1. 틀을 고른 뒤 크기: H 넷, 2 × 2, 1 + 3 ----------
  let k = 0;
  for (const layout of ['row', 'grid', 'main-left-3']) {
    await preset(page, layout);
    for (const size of SIZES) {
      const { d, b } = await pick(page, size);
      const j = judge(layout, size, d, b);
      result.table.push({ order: 'layout-then-size', layout, size: sizeName(size), outer: `${d.outer.w}x${d.outer.h}`, cells: sizes(d.cells), ratios: d.ratios, bar: [b.dir, b.aspect, b.level] });
      step(`${layout} → ${sizeName(size)}: 틀 비율 그대로, 넓이 √4, 칸 모양, 막대 불`, j.ok, { outer: d.outer, cells: sizes(d.cells), ratios: d.ratios, bar: b, ...j.checks });
      await shot(page, `${TAG}-${String(++k).padStart(2, '0')}-${layout}-${fileName(size)}`, log);
    }
  }

  // ---------- 2. 크기를 누른 뒤 1 + 3(2 × 2에서) ----------
  const first = result.table.filter((x) => x.layout === 'main-left-3');
  for (const [i, size] of SIZES.entries()) {
    await preset(page, 'grid');
    await pick(page, size);
    const { d, b } = await preset(page, 'main-left-3');
    const j = judge('main-left-3', size, d, b);
    const same = JSON.stringify(sizes(d.cells)) === JSON.stringify(first[i].cells);
    result.table.push({ order: 'size-then-layout', layout: 'main-left-3', size: sizeName(size), outer: `${d.outer.w}x${d.outer.h}`, cells: sizes(d.cells), ratios: d.ratios, bar: [b.dir, b.aspect, b.level] });
    step(`2 × 2 ${sizeName(size)} → 1 + 3: 틀을 먼저 고른 것과 같은 크기`, j.ok && same, { outer: d.outer, cells: sizes(d.cells), ratios: d.ratios, bar: b, same, ...j.checks });
    await shot(page, `${TAG}-${String(++k).padStart(2, '0')}-size-then-main-left-3-${fileName(size)}`, log);
  }

  // ---------- 3. 막대 글: "칸마다" 없음, 덩어리 단계 풀이는 덩어리 바깥 ----------
  await preset(page, 'grid');
  let { d, b } = await pick(page, SIZES[0]);
  step('막대 글: "칸마다"가 없고 크게 단추 풀이는 덩어리 바깥 크기', !b.unit && b.largeTitle && b.largeTitle.includes(`${d.outer.w} × ${d.outer.h}`), { unit: b.unit, dirTitle: b.dirTitle, largeTitle: b.largeTitle, outer: d.outer });

  // ---------- 4. 떼기·붙이기: 불이 든 동안 같은 단독 세션 크기로 바깥을 다시 낸다(넓이 × √n) ----------
  ({ d } = await preset(page, 'row'));
  const h4 = d;
  await call(page, 'dock.remove', { session: 's4' });
  await sleep(1000);
  d = (await dockInfo(page))[0];
  const a3 = d.outer.w * d.outer.h, a4 = h4.outer.w * h4.outer.h;
  step('H 넷에서 하나 떼기: 넓이가 √3/√4로 준다, 왼쪽 위 그대로, 칸 16:9', Math.abs(a3 / a4 - Math.sqrt(3 / 4)) < 0.01 && d.outer.x === h4.outer.x && d.outer.y === h4.outer.y && Object.values(d.cells).every((c) => off(c, 16 / 9) < 0.01), { before: h4.outer, outer: d.outer, cells: sizes(d.cells) });
  await call(page, 'dock.attach', { session: 's4', to: 's3', side: 'right', at: 'dock' });
  await sleep(1000);
  d = (await dockInfo(page))[0];
  step('다시 붙이기: H 넷 크기로 돌아온다', d.outer.w === h4.outer.w && d.outer.h === h4.outer.h, { outer: d.outer, cells: sizes(d.cells) });
  await focus(page);
  await shot(page, `${TAG}-${String(++k).padStart(2, '0')}-detach-attach`, log);

  // ---------- 5. 바깥 테두리 끌기: 칸이 함께 커지고 불이 꺼진다, 틀 비율 그대로 ----------
  ({ d } = await preset(page, 'main-left-3'));
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
  step('바깥 테두리를 끌면 칸이 함께 커지고 비율·단계 불이 꺼진다(틀 비율 그대로)', d2.outer.h > d.outer.h && b.aspect === null && b.level === null && JSON.stringify(d2.ratios) === JSON.stringify(d.ratios), { before: d.outer, outer: d2.outer, cells: sizes(d2.cells), bar: b });
  await shot(page, `${TAG}-${String(++k).padStart(2, '0')}-edge-dragged`, log);

  // ---------- 6. 혼자인 세션의 막대는 그대로 ----------
  await call(page, 'dock.remove', { dock: d2.dockId });
  await sleep(800);
  await call(page, 'board.setSize', { session: 's1', size: 'wide-large' });
  await sleep(800);
  const r1 = await page.evaluate(() => { const s = window.__mt.getState(); const x = [...s.sessions.values()].find((y) => y.name === 's1'); const r = s.nodes.get(x.sessionId); return { x: r.x, y: r.y, w: r.w, h: r.h }; });
  await frame(page, r1); await select(page, 's1');
  b = await bar(page);
  step('혼자인 세션: 가로형 16:9 크게 1920×1080', r1.w === 1920 && r1.h === 1080 && b.level === 'large' && !b.unit, { rect: r1, bar: b });
  await shot(page, `${TAG}-${String(++k).padStart(2, '0')}-single`, log);
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
