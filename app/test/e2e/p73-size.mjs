// P73 창 시험: 세션 크기(방향 × 종횡비 × 단계), 새 세션 크기, 혼자인 세션의 고른 노드 막대, 덩어리 바깥 비율(16:9 ↔ 4:3, 테두리 끌기 뒤 꺼짐),
// H·V 배치 틀, 덩어리 안 분할선이 끌리지 않음, 눌러서 확대(크롬을 뺀 남은 칸을 98% 채움).
// 판: herdr 세션 atrium-dev-p73, 포트 47893, 이 워크트리의 backend/.dev(data, app). 시험 폴더는 새로 만든 C:\Workspace\mtask-p73-ws 하나.
// 셸 넷(s1~s4)과 claude --model haiku 하나(h1)를 띄운다. 신뢰 대화상자가 떠도 누르지 않는다. 결과는 experiments/p73/(git 밖).
// 사용(app 폴더에서, 판 값이 없는 셸로): MT_E2E_OUT=p73 node test/e2e/p73-size.mjs [--clean]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, closeApp, shot, logger, sleep, REPO, OUT } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';
import { loadConfig } from '../../../backend/src/config.mjs';
import { hcStateDir } from '../../../backend/src/hc/core.mjs'; // P129: 이 판의 hc 상태 폴더(세션을 지우는 자리)

if (process.env.MT_E2E_OUT !== 'p73') throw new Error('MT_E2E_OUT=p73을 명령줄에서 준다');
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) throw new Error(`판 값이 든 셸에서 돌리지 않는다(${k}). backend/.dev/clean-env.sh로 부른다`);
const DEV = path.join(REPO, 'backend', '.dev');
const WS = 'C:\\Workspace\\mtask-p73-ws';
const FIX = path.join(DEV, 'fixture-projects-p73');
const ENV = {
  ATRIUM_HERDR_SESSION: 'atrium-dev-p73', ATRIUM_PORT: '47893',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: FIX, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_CLAUDE_SESSIONS: path.join(DEV, 'fixture-sessions-p73'), ATRIUM_TEST_PREFIX: 'mtask-p73-x',
};
assertTestBoard(ENV, { root: DEV });
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const atrium = (...args) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...args], { encoding: 'utf8', env: { ...cleanEnv(), ...ENV } });

// ---------- 정리(--clean): 시험 세션, herdr 서버와 백엔드, herdr 세션 atrium-dev-p73, 데이터와 시험 폴더 ----------
if (process.argv.includes('--clean')) {
  const say = (...a) => console.log(...a);
  const cfg = loadConfig({ argv: ['--dev'], env: { ...process.env, ...ENV } });
  if (cfg.terminalSession !== 'atrium-dev-p73' || String(cfg.port) !== '47893') throw new Error('P73 판만');
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

const log = logger('p73-size');
const result = { steps: [], sizes: [] };
const step = (name, ok, data = {}) => { result.steps.push({ name, ok: !!ok, ...data }); log(`${ok ? '통과' : '실패'}: ${name}`, data); };
const save = () => fs.writeFileSync(path.join(OUT, 'p73-size.json'), JSON.stringify(result, null, 2));
for (const d of [WS, FIX, ENV.ATRIUM_CLAUDE_SESSIONS]) fs.mkdirSync(d, { recursive: true });

const call = (page, method, params = {}) => page.evaluate(([m, p]) => window.__mt.api.call(m, p), [method, params]);
const sid = (page, name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? s.sessionId : null; }, name);
const rectOf = (page, name) => page.evaluate((n) => { const s = window.__mt.getState(); const x = [...s.sessions.values()].find((y) => y.name === n); const r = x && s.nodes.get(x.sessionId); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), aspect: r.aspect || null } : null; }, name);
const dockInfo = (page) => page.evaluate(() => { const s = window.__mt.getState(); return [...s.docks.values()].map((d) => { const rs = d.members.map((m) => s.nodes.get(m)); const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)); return { dockId: d.dockId, aspect: d.aspect || null, tree: JSON.stringify(d.tree), outer: { x: Math.round(x0), y: Math.round(y0), w: Math.round(Math.max(...rs.map((r) => r.x + r.w)) - x0), h: Math.round(Math.max(...rs.map((r) => r.y + r.h)) - y0) }, cells: d.members.map((m) => { const r = s.nodes.get(m); return { name: s.sessions.get(m).name, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }; }) }; }); });
const bar = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-role=selection]');
  if (!el) return null;
  const on = (sel) => [...el.querySelectorAll(sel)].filter((b) => b.classList.contains('on')).map((b) => b.dataset.dir || b.dataset.level || b.dataset.aspect);
  return { dir: on('[data-role=size-dir] [data-dir]')[0] || null, level: on('[data-level]')[0] || null, aspect: on('[data-aspect]')[0] || null, aspectText: [...el.querySelectorAll('[data-aspect]')].map((b) => b.textContent), presets: [...el.querySelectorAll('[data-preset]')].map((b) => b.dataset.preset), glyphs: [...el.querySelectorAll('.mt-preset-glyph')].map((b) => b.textContent), compact: +el.dataset.compact, row: el.dataset.row };
});
const vp = (page) => page.evaluate(() => { const el = document.querySelector('.mt-canvas'); const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform); return { x: m.e, y: m.f, zoom: m.a, W: el.clientWidth, H: el.clientHeight }; });
const chrome = (page) => page.evaluate(() => { const el = document.querySelector('.mt-canvas').getBoundingClientRect(); const q = (s) => [...document.querySelectorAll(s)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0); const top = Math.max(0, ...q('[data-role="top-left"], [data-role="top-right"]').map((r) => r.bottom - el.top)); const bottom = Math.max(0, ...q('[data-role="bottom"]:not([data-hidden]), [data-role="chips"]:not([data-hidden]), [data-role="zoom"]').map((r) => el.bottom - r.top)); const left = Math.max(0, ...q('[data-role="rail-left"]').map((r) => r.right - el.left)); const right = Math.max(0, ...q('[data-role="rail-right"]').map((r) => el.right - r.left)); return { top, bottom, left, right }; });
const onScreen = (v, r) => ({ x: r.x * v.zoom + v.x, y: r.y * v.zoom + v.y, w: r.w * v.zoom, h: r.h * v.zoom });
const cols = (page, name) => page.evaluate((n) => { const s = window.__mt.getState(); const x = [...s.sessions.values()].find((y) => y.name === n); const t = x && window.__mt.terms.get(x.sessionId); return t ? { cols: t.cols, rows: t.rows } : null; }, name);
async function frame(page, rect, margin = 160) { await page.evaluate(([r, m]) => window.__mt.getState().navigateToRect({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }, 0), [rect, margin]); await sleep(600); }
const clearSel = async (page) => { await page.evaluate(() => { const s = window.__mt.getState(); if (s.clearSelection) s.clearSelection(); }); await sleep(250); };
async function headClick(page, name, ctrl = false) {
  const head = await page.locator(`.mt-node[data-name="${name}"] .mt-node-head`).boundingBox();
  if (ctrl) await page.keyboard.down('Control');
  await page.mouse.click(head.x + Math.min(120, head.width / 3), head.y + head.height / 2);
  if (ctrl) await page.keyboard.up('Control');
  await sleep(400);
}
const press = async (page, sel) => {
  // 가장 줄인 막대(단계 3·4)는 배치 틀을 단추 하나로 접는다. 틀을 누를 때는 먼저 펼친다
  if (sel.startsWith('[data-preset') && !(await page.isVisible(`[data-role=selection] ${sel}`)) && (await page.isVisible('[data-role=selection] [data-action=layout-more]'))) { await page.click('[data-role=selection] [data-action=layout-more]'); await sleep(300); }
  await page.click(`[data-role=selection] ${sel}`); await sleep(700);
};
// 터미널 칸 수: 그 노드로 들어가(가까이 얼굴, 제어기가 붙는다) 잰다
async function termOf(page, name) {
  const id = await sid(page, name);
  await page.evaluate((i) => window.__mt.getState().navigateTo(i, { viewOnly: true }), id);
  for (let i = 0; i < 20; i++) { await sleep(300); const c = await cols(page, name); if (c && c.cols) return c; }
  return null;
}
const selected = (page) => page.evaluate(() => window.__mt.getState().selected.map((id) => window.__mt.getState().sessions.get(id).name));

const { app, page } = await launch({ log, env: ENV });
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(false)); // 기본 화면처럼 아래 바를 고정하지 않는다
  await sleep(800);
  if ((await page.evaluate(() => window.__mt.getState().sessions.size)) > 0) throw new Error('판이 비어 있지 않다. 먼저 --clean');
  // ---------- 1. 새 세션 크기 ----------
  for (const n of ['s1']) if (!(await sid(page, n))) await call(page, 'session.spawn', { cwd: WS, kind: 'shell', name: n });
  if (!(await sid(page, 'h1'))) await call(page, 'session.spawn', { cwd: WS, kind: 'claude', name: 'h1', model: 'haiku' });
  await sleep(4000);
  const s1 = await rectOf(page, 's1'), h1 = await rectOf(page, 'h1');
  step('새 세션은 16:9 가로 보통(1440×810, 비율 기록 16:9)', s1.w === 1440 && s1.h === 810 && h1.w === 1440 && h1.h === 810 && s1.aspect === '16:9' && h1.aspect === '16:9', { s1, h1 });
  await frame(page, { x: Math.min(s1.x, h1.x), y: Math.min(s1.y, h1.y), w: Math.max(s1.x + s1.w, h1.x + h1.w) - Math.min(s1.x, h1.x), h: Math.max(s1.y + s1.h, h1.y + h1.h) - Math.min(s1.y, h1.y) });
  await sleep(1500);
  await shot(page, '01-new-sessions', log);

  // ---------- 2. 혼자인 세션 막대: 가로·세로 × 16:9·4:3 × 크게·보통·작게 ----------
  await frame(page, await rectOf(page, 's1'), 300);
  await headClick(page, 's1');
  const sel1 = await selected(page);
  let b = await bar(page);
  step('세션 하나를 누르면 막대가 뜨고 배치 틀은 없다', sel1.length === 1 && b && b.presets.length === 0 && b.dir === 'wide' && b.aspect === '16:9' && b.level === 'normal', { sel1, bar: b });
  await shot(page, '02-single-bar', log);
  for (const dir of ['wide', 'tall']) for (const aspect of ['16:9', '4:3']) for (const level of ['large', 'normal', 'small']) {
    if (!(await page.$('[data-role=selection]'))) await headClick(page, 's1');
    const cur = await bar(page);
    if (cur.dir !== dir) await press(page, `[data-role=size-dir] [data-dir=${dir}]`);
    if ((await bar(page)).aspect !== aspect) await press(page, `[data-aspect="${aspect}"]`);
    await press(page, `[data-level=${level}]`);
    const r = await rectOf(page, 's1');
    await frame(page, r, 260);
    if (!(await page.$('[data-role=selection]'))) await headClick(page, 's1');
    b = await bar(page);
    const [p, q] = aspect.split(':').map(Number);
    const ratio = dir === 'tall' ? q / p : p / q;
    const ok = Math.abs(r.w / r.h - ratio) < 0.01 && b.dir === dir && b.aspect === aspect && b.level === level;
    await shot(page, `03-single-${dir}-${aspect.replace(':', 'x')}-${level}`, log);
    const c = await termOf(page, 's1');
    result.sizes.push({ dir, aspect, level, w: r.w, h: r.h, lit: b, term: c });
    step(`막대 ${dir} ${aspect} ${level}: ${r.w}×${r.h}`, ok, { aspectText: b.aspectText, term: c });
  }
  // 작게 세로(9:16, 3:4)도 터미널이 55칸 넘게 읽히는가
  const narrow = result.sizes.filter((x) => x.dir === 'tall' && x.level === 'small');
  step('작게 세로도 터미널 55칸 이상', narrow.every((x) => x.term && x.term.cols >= 55), { narrow: narrow.map((x) => ({ aspect: x.aspect, w: x.w, term: x.term })) });
  // 크기를 16:9 가로 보통으로 되돌린다
  await call(page, 'board.setSize', { session: 's1', size: 'wide-normal' });
  await clearSel(page);

  // ---------- 3. 넷짜리 덩어리: 16:9 ↔ 4:3, 테두리 끌기 뒤 꺼짐, H·V ----------
  for (const n of ['s2', 's3', 's4']) if (!(await sid(page, n))) await call(page, 'session.spawn', { cwd: WS, kind: 'shell', name: n });
  await sleep(3000);
  await call(page, 'dock.layout', { members: ['s1', 's2', 's3', 's4'], preset: 'grid' });
  await sleep(1200);
  let d = (await dockInfo(page))[0];
  await frame(page, d.outer, 260);
  await headClick(page, 's1');
  b = await bar(page);
  step('넷짜리 2 × 2: 바깥 1920×1080, 16:9에 불, 배치 틀 보임', d.outer.w === 1920 && d.outer.h === 1080 && d.aspect === '16:9' && b.aspect === '16:9' && b.level === 'large' && b.presets.includes('row') && b.presets.includes('col'), { outer: d.outer, bar: b });
  await shot(page, '04-dock-16x9', log);
  await press(page, '[data-aspect="4:3"]');
  d = (await dockInfo(page))[0];
  b = await bar(page);
  step('덩어리 4:3: 바깥이 4:3 크게(1600×1200), 칸은 바깥을 틀 비율대로', d.outer.w === 1600 && d.outer.h === 1200 && b.aspect === '4:3' && d.cells.every((c) => c.w === 800 && c.h === 600), { outer: d.outer, cells: d.cells });
  await frame(page, d.outer, 260); await headClick(page, 's1');
  await shot(page, '05-dock-4x3', log);
  await press(page, '[data-aspect="16:9"]');
  d = (await dockInfo(page))[0];
  step('다시 16:9', d.outer.w === 1920 && d.outer.h === 1080 && d.aspect === '16:9', { outer: d.outer });
  // 바깥 오른쪽 테두리 끌기
  await frame(page, d.outer, 260);
  await clearSel(page);
  const edge = await page.locator(`[data-role=dock-edge][data-side=right]`).first().boundingBox();
  const treeBefore = d.tree;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 60, edge.y + edge.height / 2, { steps: 6 });
  await page.mouse.move(edge.x + edge.width / 2 + 120, edge.y + edge.height / 2, { steps: 6 });
  await page.mouse.up();
  await sleep(1200);
  d = (await dockInfo(page))[0];
  await headClick(page, 's1');
  b = await bar(page);
  step('바깥 테두리를 끌면 덩어리 전체가 커지고 칸 비율은 그대로, 비율 단추 둘 다 꺼짐', d.outer.w > 1920 && d.outer.h === 1080 && d.tree === treeBefore && d.aspect === null && b.aspect === null && b.level === null, { outer: d.outer, aspect: d.aspect, bar: b });
  await shot(page, '06-dock-edge-dragged', log);
  await press(page, '[data-aspect="16:9"]');
  d = (await dockInfo(page))[0];
  step('끈 뒤 16:9를 누르면 넓이를 지킨 채 다시 16:9', Math.abs(d.outer.w / d.outer.h - 16 / 9) < 0.01 && d.aspect === '16:9', { outer: d.outer });
  const kept = d.outer;
  await press(page, '[data-preset=row]');
  d = (await dockInfo(page))[0];
  step('H 틀: 바깥과 비율을 지키고 모두 가로 한 줄', d.outer.w === kept.w && d.outer.h === kept.h && d.aspect === '16:9' && new Set(d.cells.map((c) => c.y)).size === 1, { outer: d.outer, cells: d.cells });
  await frame(page, d.outer, 260); await headClick(page, 's1');
  await shot(page, '07-dock-H', log);
  await press(page, '[data-preset=col]');
  d = (await dockInfo(page))[0];
  step('V 틀: 모두 세로 한 줄', new Set(d.cells.map((c) => c.x)).size === 1, { outer: d.outer, cells: d.cells });
  await frame(page, d.outer, 260); await headClick(page, 's1');
  await shot(page, '08-dock-V', log);
  // 다섯이면 H·V가 글자 단추: h1을 함께 골라 본다(틀은 누르지 않는다)
  await clearSel(page);
  // 덩어리를 키우면 옆 노드(h1)와 겹칠 수 있다(크기를 바꿔도 옆 노드를 밀지 않는다). h1을 덩어리 오른쪽으로 옮겨 둔다
  { const r0 = await rectOf(page, 'h1'); await call(page, 'board.setNode', { session: 'h1', x: d.outer.x + d.outer.w + 200, y: d.outer.y, w: r0.w, h: r0.h, z: 0, cause: 'p73 test' }); await page.evaluate(() => window.__mt.api.emit('board.changed', { why: 'p73 test' })); await sleep(900); }
  const h1r = await rectOf(page, 'h1');
  const both = { x: Math.min(d.outer.x, h1r.x), y: Math.min(d.outer.y, h1r.y) };
  await frame(page, { ...both, w: Math.max(d.outer.x + d.outer.w, h1r.x + h1r.w) - both.x, h: Math.max(d.outer.y + d.outer.h, h1r.y + h1r.h) - both.y }, 200);
  await headClick(page, 's1', true); await headClick(page, 'h1', true); // Ctrl+누르기는 화면을 옮기지 않는다
  b = await bar(page);
  step('다섯이면 H·V 글자 단추', b && b.glyphs.join(',') === 'H,V', { bar: b });
  await shot(page, '09-five-HV', log);
  await clearSel(page);

  // ---------- 4. 덩어리 안 분할선이 끌리지 않는다 ----------
  await call(page, 'dock.layout', { members: ['s1'], preset: 'grid' });
  await sleep(1000);
  d = (await dockInfo(page))[0];
  await frame(page, d.outer, 260);
  await clearSel(page);
  const div = await page.locator('.mt-divider').first().boundingBox();
  const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? { cls: e.className && String(e.className).slice(0, 60), divider: !!e.closest('.mt-divider') } : null; }, [div.x + div.width / 2, div.y + div.height / 2]);
  const t0 = d.tree, cells0 = JSON.stringify(d.cells);
  await page.mouse.move(div.x + div.width / 2, div.y + div.height / 2 + 30);
  await page.mouse.down();
  await page.mouse.move(div.x + div.width / 2 + 150, div.y + div.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await sleep(1200);
  d = (await dockInfo(page))[0];
  step('분할선 자리를 눌러 끌어도 칸 비율·크기가 그대로(분할선은 누를 수 없다)', d.tree === t0 && JSON.stringify(d.cells) === cells0 && !hit.divider && (await page.locator('[data-role=dock-junction]').count()) === 0, { hit, cells: d.cells });
  await shot(page, '10-divider-fixed', log);
  await clearSel(page);

  // ---------- 5. 눌러서 확대 ----------
  await call(page, 'dock.remove', { dock: d.dockId });
  await sleep(800);
  const hr = await rectOf(page, 'h1');
  await frame(page, hr, 1600);
  await shot(page, '11-zoom-before', log);
  const v0 = await vp(page);
  const term = await page.locator(`.mt-node[data-name="h1"] .mt-term-wrap`).boundingBox().catch(() => null);
  const bodyBox = term || await page.locator(`.mt-node[data-name="h1"]`).boundingBox();
  await page.mouse.click(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2);
  await sleep(2200);
  const v1 = await vp(page), ch = await chrome(page);
  const sc = onScreen(v1, hr);
  // 크롬과 그 틈(12px)을 뺀 남은 칸(lib/chrome-inset.js)
  const g = (v) => (v ? v + 6 : 0); // 크롬과 틈(NAV_GAP)
  const room = { top: g(ch.top), bottom: v1.H - g(ch.bottom), left: g(ch.left), right: v1.W - g(ch.right) };
  const fillH = sc.h / (room.bottom - room.top), fillW = sc.w / (room.right - room.left);
  const clear = sc.y >= ch.top - 1 && sc.y + sc.h <= v1.H - ch.bottom + 1 && sc.x >= ch.left - 1 && sc.x + sc.w <= v1.W - ch.right + 1;
  step('눌러서 확대: 크롬을 가리지 않고 남은 칸을 꽉(높이나 너비 98% 넘게), 전(화면의 85%)보다 크게', clear && (fillH >= 0.98 || fillW >= 0.98) && v1.zoom > Math.min(v1.W * 0.85 / hr.w, v1.H * 0.85 / hr.h), { zoomBefore: +v0.zoom.toFixed(3), zoomAfter: +v1.zoom.toFixed(3), onScreen: { x: Math.round(sc.x), y: Math.round(sc.y), h: Math.round(sc.h), w: Math.round(sc.w) }, chrome: ch, fillH: +fillH.toFixed(3), fillW: +fillW.toFixed(3), old85: +Math.min(v1.W * 0.85 / hr.w, v1.H * 0.85 / hr.h).toFixed(3) });
  await shot(page, '12-zoom-after', log);
} catch (e) {
  step('시험 오류', false, { error: String(e.stack || e).slice(0, 1200) });
  await shot(page, '99-error', log).catch(() => {});
} finally {
  save();
  await closeApp(app);
  const bad = result.steps.filter((s) => !s.ok);
  log(`끝: 통과 ${result.steps.length - bad.length}, 실패 ${bad.length}`);
}
process.exit(0);
