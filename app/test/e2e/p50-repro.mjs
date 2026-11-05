// P50 창 시험: 캔버스 이슈 #2(배치 틀이 다른 노드를 덮는다)와 #6(메모 키, 먼 얼굴 편집, 빈 판 안내)을 빈 판에서 재현하고, 고친 뒤 통과하는지 본다.
// 사례는 ux1 재현 각본(ux1-repro.mjs)의 presetOverlap·memoKeys를 그대로 옮기고, 먼 얼굴 편집과 빈 판 안내를 더했다.
// 판: herdr 세션 atrium-dev-p50, 포트 47869, 이 워크트리의 backend/.dev(experiments/p50/tools/env.cjs). 세션은 셸만.
// 사용: node experiments/p50/tools/e2e.cjs p50-repro.mjs [--fresh] [--tag 이름]
//   --fresh: 백엔드를 멈추고 판 데이터와 창 프로필을 지운 뒤 시작한다(시험 폴더 C:\Workspace\mtask-p50-*의 세션만 있는 판이어야 한다)
// 결과: experiments/p50/<tag>.json, 스크린숏 <tag>-*.png
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p50') throw new Error('MT_E2E_OUT=p50을 명령줄에서 준다(experiments/p50/tools/e2e.cjs)');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p50', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P50_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p50' || ENV.ATRIUM_PORT !== '47869') throw new Error('p50 판(atrium-dev-p50, 47869)만');
if (!/^C:\\Workspace\\mtask-p50-/.test(T.DIR)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p50-*만: ${T.DIR}`);

const argv = process.argv.slice(2);
const TAG = argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : 'p50-repro';
const log = logger(TAG);
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = () => ({ ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION });
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: env(), timeout: 180000 });
const lastLine = (s) => String(s).trim().split(/\r?\n/).slice(-1)[0];

if (argv.includes('--fresh')) {
  try { log('백엔드 멈춤', lastLine(atrium('backend', 'stop'))); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
  await sleep(800);
  for (const d of [ENV.ATRIUM_DATA_DIR, ENV.ATRIUM_APP_USERDATA]) fs.rmSync(d, { recursive: true, force: true });
}
for (const d of [T.PROJECTS, T.SESSIONS, T.DIR]) fs.mkdirSync(d, { recursive: true });

let app = null, page = null;
const spawned = [];
const errors = [];
const shot = async (n) => { const f = path.join(OUT, `${TAG}-${n}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const sessionId = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? s.sessionId : null; }, name);
const spawn = async (name) => {
  log(lastLine(atrium('spawn', T.DIR, '--name', name, '--kind', 'shell')));
  spawned.push(name);
  return until(() => page.evaluate((n) => { const st = window.__mt.getState(); const s = [...st.sessions.values()].find((x) => x.name === n); return s && st.nodes.has(s.sessionId) ? s.sessionId : null; }, name), 40000);
};
const blank = () => page.evaluate(() => { const c = document.querySelector('.mt-canvas').getBoundingClientRect(); for (let y = c.y + 120; y < c.bottom - 160; y += 30) for (let x = c.x + 110; x < c.right - 110; x += 40) { const e = document.elementFromPoint(x, y); if (e && e.classList.contains('react-flow__pane')) return { x, y }; } return null; });
const clickBlank = async () => { const p = await blank(); await page.mouse.click(p.x, p.y); await sleep(250); };
const head = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); const h = document.querySelector(`.react-flow__node[data-id="${s.sessionId}"] .mt-node-head`).getBoundingClientRect(); return { x: h.x + 60, y: h.y + h.height / 2 }; }, name);
const active = () => page.evaluate(() => { const a = document.activeElement; if (!a) return null; return `${a.tagName}${a.dataset.action ? '[' + a.dataset.action + ']' : ''}${a.dataset.field ? '{' + a.dataset.field + '}' : ''}`; });
const nodeRects = () => page.evaluate(() => [...window.__mt.getState().nodes.entries()].map(([id, r]) => ({ id, x: r.x, y: r.y, w: r.w, h: r.h })));
const memoCount = () => page.evaluate(() => document.querySelectorAll('.react-flow__node-memo').length);
const domOverlaps = () => page.evaluate(() => {
  const els = [...document.querySelectorAll('.react-flow__node-session, .react-flow__node-memo, .react-flow__node-kanban, .react-flow__node-convo')];
  const rs = els.map((e) => ({ id: e.dataset.id, r: e.getBoundingClientRect() }));
  const out = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i].r, b = rs[j].r;
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 1 && oy > 1) out.push({ a: rs[i].id, b: rs[j].id, ox: Math.round(ox), oy: Math.round(oy) });
  }
  return out;
});
// 메모가 먼 얼굴(화면 220px 아래)이 되게 배율 0.25로 줄인다(화면 가운데는 그대로). 판이 작으면 전체 보기 배율이 커서 메모가 먼 얼굴이 아니다
const farView = () => page.evaluate(() => { const st = window.__mt.getState(); const c = st.viewCenter(); const el = document.querySelector('.mt-canvas'); const z = 0.25; st.setViewport({ x: el.clientWidth / 2 - c.x * z, y: el.clientHeight / 2 - c.y * z, zoom: z }); });
const deleteMemos = async () => { for (const id of await page.evaluate(() => [...window.__mt.getState().memos.keys()])) await call('memo.delete', { memo: id, confirm: true }).catch(() => {}); await sleep(400); };

const cases = {
  // #6: 빈 판은 첫 걸음(프로젝트 열기, 세션 띄우기)을 보인다. 워크스페이스를 열면 사라진다
  async emptyBoard() {
    const ws = await page.evaluate(() => window.__mt.getState().workspaces.length);
    const hint = await page.evaluate(() => { const e = document.querySelector('[data-role="empty-hint"]'); return e ? e.innerText.replace(/\n/g, ' | ') : null; });
    await shot('empty-1-board');
    step('emptyBoard: 빈 판에 첫 걸음 안내가 있다', ws === 0 && !!hint, { workspaces: ws, hint });
    if (hint) {
      await page.click('[data-action="empty-ws-open"]'); await sleep(500);
      const dlg = await page.evaluate(() => !!document.querySelector('.mt-modal'));
      await shot('empty-2-open-dialog');
      await page.keyboard.press('Escape'); await sleep(300);
      if (await page.evaluate(() => !!document.querySelector('.mt-modal'))) await page.evaluate(() => { window.__mt.getState().dialog = null; });
      step('emptyBoard: 안내의 프로젝트 열기 단추가 프로젝트 열기 대화상자를 연다', dlg, { dialog: dlg });
    }
    await call('workspace.open', { path: T.DIR }); await sleep(1200);
    const gone = await page.evaluate(() => !document.querySelector('[data-role="empty-hint"]'));
    step('emptyBoard: 워크스페이스를 열면 안내가 사라진다', gone, { gone });
  },
  // #2·U1: 노드 둘을 골라 "가로 2개" 배치 틀을 쓰면, 그룹이 옆의 세 번째 노드 자리로 커져 그 노드를 덮는다
  async presetOverlap() {
    for (const n of ['pa', 'pb', 'pc']) await spawn(n);
    await sleep(1500);
    const ids = {}; for (const n of ['pa', 'pb', 'pc']) ids[n] = await sessionId(n);
    const nm = (id) => Object.keys(ids).find((k) => ids[k] === id) || id.slice(0, 6);
    const r0 = await nodeRects();
    log('처음 자리', r0.map((r) => `${nm(r.id)}:${r.x},${r.y},${r.w}x${r.h}`).join(' '));
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1200);
    await clickBlank();
    let p = await head('pa'); await page.keyboard.down('Control'); await page.mouse.click(p.x, p.y);
    p = await head('pc'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Control'); await sleep(500);
    const sel = (await page.evaluate(() => window.__mt.getState().selected)).length;
    if (await page.isVisible('[data-action="layout-more"]')) { await page.click('[data-action="layout-more"]'); await sleep(300); } // 넓은 창에서는 틀이 막대에 바로 보인다
    await shot('preset-1-before');
    const btn = (await page.$$('[data-role="presets"] button'))[0];
    const title = await btn.getAttribute('title');
    await btn.click(); await sleep(1500);
    await page.evaluate(() => window.__mt.getState().clearSelection());
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1200);
    const overlaps = await domOverlaps();
    const hidden = await page.evaluate((i) => { const el = document.querySelector(`.react-flow__node[data-id="${i}"]`); const b = el.getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !(e && el.contains(e)); }, ids.pb);
    await shot('preset-2-after');
    const r1 = await nodeRects();
    const docked = await page.evaluate(([a, c]) => [...window.__mt.getState().docks.values()].some((d) => d.members.includes(a) && d.members.includes(c)), [ids.pa, ids.pc]);
    step('presetOverlap: 배치 틀 뒤 다른 노드와 겹치지 않는다(U1)', overlaps.length === 0 && !hidden && docked, { selected: sel, preset: title && title.split(':')[0], docked, overlaps, pbHiddenAtCenter: hidden, before: r0.map((r) => `${nm(r.id)}:${r.x},${r.y}`), after: r1.map((r) => `${nm(r.id)}:${r.x},${r.y},${r.w}x${r.h}`) });
  },
  // #6·H3: 레일의 메모 단추를 누른 뒤 Space·Enter를 치면 메모가 또 생긴다(새 메모는 편집 상태가 아니고 초점이 단추에 남는다)
  async memoKeys() {
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(800);
    await farView(); await sleep(800);
    const n0 = await memoCount();
    await page.click('[data-action="memo-new"]'); await sleep(1200);
    const a = await active(); const n1 = await memoCount();
    await page.keyboard.press('Space'); await sleep(600);
    await page.keyboard.press('Enter'); await sleep(600);
    await page.keyboard.type('p50 memo'); await sleep(300);
    const n2 = await memoCount();
    const editing = await page.evaluate(() => { const e = document.querySelector('.mt-memo-edit'); return e ? { focused: document.activeElement === e, value: e.value } : null; });
    await shot('memo-1-after-space-enter');
    step('memoKeys: 새 메모는 바로 편집 상태이고, 이어 친 키가 메모를 더 만들지 않고 메모에 들어간다', n1 === n0 + 1 && n2 === n1 && !!editing && editing.focused && /p50 memo/.test(editing.value), { before: n0, afterClick: n1, afterSpaceEnter: n2, focusAfterClick: a, editing });
    await page.keyboard.press('Control+Enter'); await sleep(500);
    await deleteMemos();
  },
  // #6·H1: 전체 보기 배율에서 먼 얼굴로 보이는 메모를 두 번 누르면 편집할 수 있다
  async memoFarEdit() {
    const anchor = await page.evaluate(() => { const st = window.__mt.getState(); const r = st.regionOf && st.regionOf(st.workspaces[0].key); return r; });
    await call('memo.create', { text: 'far memo', x: Math.round(anchor.x + anchor.w + 400), y: Math.round(anchor.y), w: 360, h: 240 }); await sleep(800);
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1200);
    await farView(); await sleep(1000);
    const far = await page.evaluate(() => { const e = document.querySelector('.mt-memo-far'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, zoom: window.__mt.getState().vpNow && window.__mt.getState().vpNow.zoom }; });
    await shot('memofar-1-fit');
    if (!far) { step('memoFarEdit: 전체 보기에서 메모가 먼 얼굴이다(시험 전제)', false, { far }); return; }
    await page.mouse.dblclick(far.x, far.y); await sleep(1200);
    const ed = await page.evaluate(() => { const e = document.querySelector('.mt-memo-edit'); return e ? { focused: document.activeElement === e, value: e.value, zoom: window.__mt.getState().vpNow && +window.__mt.getState().vpNow.zoom.toFixed(3) } : null; });
    await shot('memofar-2-after-dblclick');
    step('memoFarEdit: 먼 얼굴 메모를 두 번 누르면 화면이 다가가 편집이 열린다', !!ed && ed.focused && ed.value === 'far memo', { farZoom: far.zoom, after: ed });
    await page.keyboard.press('Escape'); await sleep(300);
    await deleteMemos();
  },
};

try {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env: env(), timeout: 60000 });
  page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text().slice(0, 300)); log(`[console.error] ${m.text().slice(0, 300)}`); } });
  page.on('pageerror', (e) => { errors.push(e.message); log(`[pageerror] ${e.message}`); });
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(500);
  await call('settings.set', { key: 'language', value: 'ko' });
  await sleep(500);
  for (const [name, fn] of Object.entries(cases)) {
    log('--- 사례', name);
    try { await fn(); } catch (e) { step(`${name}: 예외`, false, String(e && (e.stack || e.message)).slice(0, 600)); await shot(`${name}-error`).catch(() => {}); }
    await page.keyboard.press('Escape').catch(() => {});
  }
  step('창 콘솔 오류', errors.length === 0, errors.slice(0, 10));
} catch (e) {
  step('예외', false, String(e && (e.stack || e.message)).slice(0, 800));
} finally {
  for (const n of spawned) { try { log(lastLine(atrium('kill', n, '--yes'))); } catch (e) { log('kill', n, e.message.slice(0, 160)); } }
  if (app) await closeApp(app);
  fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  log(`결과 ${results.filter((r) => r.ok).length}/${results.length}`);
  process.exit(0);
}
