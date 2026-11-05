// P44 창 시험: 세션 200개 이상을 위한 사이드바, 워크스페이스 가상 그룹과 판 전체 정리, 사이드바 폭, 워크스페이스 여럿 지우기(모두 보관·모두 삭제).
// 판: herdr 세션 atrium-dev-p44, 포트 47862, 이 워크트리의 backend/.dev(experiments/p44/tools/env.cjs). 시험 폴더 C:\Workspace\mtask-p44-a ~ f, 셸 세션 42개.
// 셸은 "응답 필요"가 되지 않으므로 몇 개는 창 안에서만 응답 필요·오류처럼 보이게 한다(session.updated를 창에 흘린다. 백엔드는 그대로).
// 사용: node experiments/p44/tools/e2e.cjs p44-sidebar.mjs [--fresh] [--tag 이름] [--keep]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p44') throw new Error('MT_E2E_OUT=p44를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p44', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P44_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p44' || ENV.ATRIUM_PORT !== '47862') throw new Error('P44 판(atrium-dev-p44, 47862)만');
for (const d of T.DIRS) if (!/^C:\\Workspace\\mtask-p44-[a-f]$/.test(d)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p44-*만: ${d}`);
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const TAG = argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : 'p44-sidebar';
const log = logger(TAG);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
let page = null;
let app = null;
const shot = async (name) => { const f = path.join(OUT, `${TAG}-${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const reload = async () => { await page.reload(); await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 }); await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true)); };

if (argv.includes('--fresh')) {
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
  await sleep(800);
  for (const d of [path.join(T.DEV, 'data'), path.join(T.DEV, 'app'), T.PROJECTS, T.SESSIONS, ...T.DIRS]) fs.rmSync(d, { recursive: true, force: true });
}
for (const d of [T.PROJECTS, T.SESSIONS, ...T.DIRS]) fs.mkdirSync(d, { recursive: true });

const PER = 7; // 워크스페이스마다 셸 7개 → 42개
const names = [];
const wsKey = {}; // 'a' → 워크스페이스 키
const letter = (d) => d.slice(-1);
// 창 안에서만 응답 필요·오류처럼 보이게(다시 읽으면 풀린다)
const FAKE = { 'a-3': ['waiting', { kind: 'permission', tool: 'Bash', summary: 'npm run deploy -- --prod' }], 'b-2': ['waiting', { kind: 'question', questions: [{ question: '어느 브랜치에 합칠까요?' }] }], 'c-5': ['waiting', { kind: 'plan' }], 'e-1': ['trust_wait', null], 'f-4': ['waiting', { kind: 'permission', tool: 'Edit', summary: 'src/app.ts' }], 'd-6': ['error', null] };
async function fake() {
  await page.evaluate((F) => {
    const st = window.__mt.getState();
    for (const s of st.sessions.values()) {
      const f = F[s.name.replace(/^p44-/, '')];
      if (!f) continue;
      window.__mt.api.emit('session.updated', { ...s, state: f[0], ask: f[1] ? { ...f[1], since: Date.now() - 90000 } : null, error: f[0] === 'error' ? { message: 'exit 1: build failed' } : null, lastActivityAt: Date.now() - 60000 });
    }
  }, FAKE);
  await sleep(300);
}
const sb = () => page.evaluate(() => {
  const el = document.querySelector('[data-role="sidebar"]');
  if (!el) return null;
  const v = document.querySelector('[data-role="sidebar-rows"]');
  const rows = [...document.querySelectorAll('[data-role="sidebar-rows"] [data-row]')];
  return { width: Math.round(el.getBoundingClientRect().width), total: v ? +v.dataset.rows : 0, shown: v ? +v.dataset.shown : 0, rows: rows.map((r) => ({ id: r.dataset.row, sb: r.dataset.sb, name: r.dataset.name || null, state: r.dataset.state || null, pinned: r.dataset.pinned === '1', h: Math.round(r.getBoundingClientRect().height) })) };
});
// 가상 스크롤이라 화면 밖 줄은 DOM에 없다. 목록을 내려 가며 찾고 가운데로 데려온다
async function reveal(sel) {
  if (!/data-sb=/.test(sel)) return;
  for (let i = 0; i < 80; i++) {
    const found = await page.evaluate(([s, k]) => {
      const e = document.querySelector(s);
      const l = document.querySelector('[data-role="sidebar-list"]');
      if (e) { const r = e.getBoundingClientRect(), lr = l.getBoundingClientRect(); if (r.top >= lr.top && r.bottom <= lr.bottom) return true; l.scrollTop += r.top - lr.top - lr.height / 3; return false; }
      if (k === 0) l.scrollTop = 0; else l.scrollTop += 240;
      return false;
    }, [sel, i]);
    if (found) return;
    await sleep(80);
  }
}
// 목록 전체 줄(가상 스크롤을 위에서 아래로 내리며 모은다)
async function allRows() {
  const seen = new Map();
  await page.evaluate(() => { document.querySelector('[data-role="sidebar-list"]').scrollTop = 0; });
  for (let i = 0; i < 100; i++) {
    await sleep(80);
    const r = await sb();
    for (const x of r.rows) seen.set(x.id, x);
    const end = await page.evaluate(() => { const l = document.querySelector('[data-role="sidebar-list"]'); const at = l.scrollTop; l.scrollTop += l.clientHeight * 0.8; return l.scrollTop === at; });
    if (end) break;
  }
  await page.evaluate(() => { document.querySelector('[data-role="sidebar-list"]').scrollTop = 0; });
  await sleep(100);
  return [...seen.values()];
}
const click = async (sel) => { await reveal(sel); const el = await page.waitForSelector(sel, { timeout: 10000 }); await el.click(); await sleep(250); };
const hoverClick = async (rowSel, btnSel) => { await reveal(rowSel); const row = await page.waitForSelector(rowSel, { timeout: 10000 }); await row.hover(); await sleep(150); const b = await row.$(btnSel); await b.click(); await sleep(250); };
const regionRects = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.mt-region[data-ws]:not(.mt-wtarea)')].map((r) => { const b = r.querySelector('.mt-region-box').getBoundingClientRect(); return [r.dataset.ws, { x: b.x, y: b.y, w: b.width, h: b.height }]; })));
const gapOf = (a, b) => Math.hypot(Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)));

try {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[console.error] ${m.text().slice(0, 300)}`); });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1600, 960); w.center(); });
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true));

  // ---------- 0. 워크스페이스 6개, 셸 42개 ----------
  for (const d of T.DIRS) { const r = await call('workspace.open', { path: d, select: false }); wsKey[letter(d)] = r.workspace.key; }
  const have = new Set(await page.evaluate(() => [...window.__mt.getState().sessions.values()].map((s) => s.name)));
  for (const d of T.DIRS) for (let i = 1; i <= PER; i++) {
    const name = `p44-${letter(d)}-${i}`;
    names.push(name);
    if (!have.has(name)) await call('session.spawn', { cwd: d, kind: 'shell', name });
  }
  await until(() => page.evaluate((n) => [...window.__mt.getState().sessions.values()].filter((s) => s.name.startsWith('p44-')).length >= n, names.length), 120000, 500);
  step('셸 42개가 워크스페이스 6개에 떴다', true, { sessions: names.length, ws: Object.keys(wsKey).length });
  await call('board.arrange', { all: true, apply: true }); // 판을 한 번 가지런히(시작점)
  await sleep(1500);
  await fake();

  // ---------- 1. 새 사이드바: 줄 정보, 접힌 묶음의 응답 필요, 가상 스크롤 ----------
  await page.keyboard.press('Control+Shift+E');
  await page.waitForSelector('[data-role="sidebar"]');
  await sleep(600);
  const s1 = await sb();
  const attnRows = s1.rows.filter((r) => r.sb === 'session' && ['waiting', 'trust_wait', 'error'].includes(r.state));
  step('사이드바: 판 세션 42개의 줄을 펴되 화면에 보이는 줄만 그린다(가상 스크롤)', s1.total >= 48 && s1.shown < s1.total, { total: s1.total, shown: s1.shown });
  step('사이드바: 보통 줄은 한 줄(28px), 응답 필요·오류 줄은 질문 한 줄을 더(44px)', s1.rows.filter((r) => r.sb === 'session' && !['waiting', 'trust_wait', 'error'].includes(r.state)).every((r) => r.h === 28) && attnRows.length > 0 && attnRows.every((r) => r.h === 44), { attn: attnRows.map((r) => [r.name, r.h]) });
  await shot('01-sidebar-42');
  // 워크스페이스 b, c를 접어도 응답 필요 세션은 남는다
  for (const k of ['b', 'c']) await click(`[data-sb="ws"][data-ws="${wsKey[k]}"]`);
  const s1b = await sb();
  const pinned = s1b.rows.filter((r) => r.pinned).map((r) => r.name);
  step('사이드바: 접힌 워크스페이스 아래에도 응답 필요 세션이 줄로 남는다', pinned.includes('p44-b-2') && pinned.includes('p44-c-5') && !s1b.rows.some((r) => r.name === 'p44-b-1'), { pinned });
  await shot('02-folded-attn');
  // 상태 칩
  await click('[data-action="state-chip"][data-bucket="need"]');
  const needNames = (await allRows()).filter((r) => r.sb === 'session').map((r) => r.name).sort();
  step('거르기: "응답 필요" 칩은 응답 필요 세션만(접힘은 무시)', JSON.stringify(needNames) === JSON.stringify(['p44-a-3', 'p44-b-2', 'p44-c-5', 'p44-e-1', 'p44-f-4']), { needNames });
  await shot('03-filter-need');
  await click('[data-action="clear-filters"]');
  // 글 거르기 + 키보드
  await page.fill('[data-role="sidebar-filter"]', 'p44-d-');
  await sleep(300);
  const s1d = await sb();
  step('거르기: 글로 이름을 찾는다', s1d.rows.filter((r) => r.sb === 'session').length === PER && s1d.rows.filter((r) => r.sb === 'session').every((r) => r.name.startsWith('p44-d-')), { n: s1d.rows.filter((r) => r.sb === 'session').length });
  await page.focus('[data-role="sidebar-filter"]');
  await page.keyboard.press('ArrowDown'); await sleep(150);
  await page.keyboard.press('ArrowDown'); await sleep(150);
  await page.keyboard.press('ArrowDown'); await sleep(150);
  const cur = await page.evaluate(() => { const c = document.querySelector('[data-role="sidebar-rows"] .cur'); return c ? { row: c.dataset.row, name: c.dataset.name, session: c.dataset.session } : null; });
  await page.keyboard.press('Enter'); await sleep(1500);
  const act = await page.evaluate(() => { const a = document.activeElement; const t = a && a.closest && a.closest('.mt-term'); return { xterm: !!(a && a.closest && a.closest('.xterm')), session: t ? t.dataset.session : null }; });
  step('키보드: 찾기 칸에서 ↓로 목록에 들어가 ↑↓로 옮기고 Enter로 그 세션 터미널에 들어간다', cur && cur.session && act.xterm && act.session === cur.session, { cur, act });
  await page.fill('[data-role="sidebar-filter"]', '');
  for (const k of ['b', 'c']) await click(`[data-sb="ws"][data-ws="${wsKey[k]}"]`);

  // ---------- 2. 가상 그룹: 만들기, 이름, 넣기(메뉴·끌어 놓기), 판 전체 정리 ----------
  await click('[data-action="group-new"]');
  await page.waitForSelector('[data-role="group-rename"]');
  await page.fill('[data-role="group-rename"]', 'Frontend');
  await page.keyboard.press('Enter'); await sleep(400);
  await click('[data-action="group-new"]');
  await page.waitForSelector('[data-role="group-rename"]');
  await page.fill('[data-role="group-rename"]', '백엔드');
  await page.keyboard.press('Enter'); await sleep(400);
  let groups = await page.evaluate(() => window.__mt.getState().groups);
  const gF = groups.find((g) => g.name === 'Frontend'), gB = groups.find((g) => g.name === '백엔드');
  step('그룹: 사이드바에서 둘을 만들고 이름을 붙인다', gF && gB, groups);
  await click('[data-action="fold-all"]'); // 워크스페이스를 모두 접는다(줄이 한 화면에 든다)
  // 메뉴로 a, e → Frontend, b → 백엔드
  for (const [k, g] of [['a', gF], ['e', gF], ['b', gB]]) {
    await hoverClick(`[data-sb="ws"][data-ws="${wsKey[k]}"]`, '[data-action="ws-menu"]');
    await click(`[data-role="sidebar-menu"] [data-action="menu-move-group"][data-group="${g.id}"]`);
  }
  // 끌어 놓기로 c → Frontend 머리줄, d → b 줄 앞(백엔드 안 첫 자리)
  const drag = async (fromSel, toSel, after = false) => {
    await page.evaluate(([f, t, a]) => {
      const src = document.querySelector(f), dst = document.querySelector(t);
      const dt = new DataTransfer();
      const r = dst.getBoundingClientRect();
      const y = a ? r.bottom - 3 : r.top + 3;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: y }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: y }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    }, [fromSel, toSel, after]);
    await sleep(500);
  };
  await drag(`[data-sb="ws"][data-ws="${wsKey.c}"]`, `[data-sb="group"][data-group="${gF.id}"]`);
  await drag(`[data-sb="ws"][data-ws="${wsKey.d}"]`, `[data-sb="ws"][data-ws="${wsKey.b}"]`);
  groups = await page.evaluate(() => window.__mt.getState().groups);
  const F = groups.find((g) => g.id === gF.id).members, B = groups.find((g) => g.id === gB.id).members;
  step('그룹: 메뉴와 끌어 놓기로 넣는다(그룹 끝, 워크스페이스 앞), 순서는 사람이 정한 대로', JSON.stringify(F) === JSON.stringify([wsKey.a, wsKey.e, wsKey.c]) && JSON.stringify(B) === JSON.stringify([wsKey.d, wsKey.b]), { F, B });
  await fake();
  await shot('04-groups-sidebar');
  // 판 전체 정리(아래 칩)
  await click('[data-action="chip-arrange"]');
  await sleep(2500);
  await fake();
  const rr = await regionRects();
  const A = [wsKey.a, wsKey.e, wsKey.c], Bk = [wsKey.d, wsKey.b];
  const near = [], bad = [];
  for (const [g, other] of [[A, [...Bk, wsKey.f]], [Bk, [...A, wsKey.f]]]) for (const x of g) {
    const n = Math.min(...g.filter((y) => y !== x).map((y) => gapOf(rr[x], rr[y])));
    const f = Math.min(...other.map((y) => gapOf(rr[x], rr[y])));
    near.push([letter(T.DIRS.find((d) => wsKey[letter(d)] === x)), Math.round(n), Math.round(f)]);
    if (!(n < f)) bad.push(x);
  }
  step('정리: 판 전체 정리 뒤 같은 그룹 영역끼리 다른 영역보다 가깝다(캔버스에 그룹은 그리지 않는다)', Object.keys(rr).length === 6 && !bad.length && !(await page.$('[data-group-box]')), { near });
  await shot('05-arranged-groups');
  await click('[data-action="chip-arrange-undo"]');
  await sleep(1500);
  await reload();
  groups = await page.evaluate(() => window.__mt.getState().groups);
  step('그룹: 창을 다시 읽어도 남는다(판 데이터)', groups.length === 2 && JSON.stringify(groups.find((g) => g.id === gF.id).members) === JSON.stringify(F), groups.map((g) => [g.name, g.members.length]));
  // 이름 바꾸기(두 번 누르기)
  await page.waitForSelector('[data-role="sidebar"]');
  await page.dblclick(`[data-sb="group"][data-group="${gB.id}"] .mt-sb2-gname`);
  await page.fill('[data-role="group-rename"]', 'Backend');
  await page.keyboard.press('Enter'); await sleep(400);
  groups = await page.evaluate(() => window.__mt.getState().groups);
  step('그룹: 머리줄을 두 번 눌러 이름을 바꾼다', groups.some((g) => g.name === 'Backend'), groups.map((g) => g.name));

  // ---------- 3. 사이드바 폭 ----------
  const h = await page.$('[data-role="sidebar-resize"]');
  const hb = await h.boundingBox();
  const w0 = (await sb()).width;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 300);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(hb.x + hb.width / 2 + i * 25, hb.y + 300); await sleep(30); }
  await page.mouse.up();
  await sleep(300);
  const w1 = (await sb()).width;
  await shot('06-wide');
  await reload();
  await page.waitForSelector('[data-role="sidebar"]');
  const w2 = (await sb()).width;
  step('폭: 오른쪽 가장자리를 끌어 넓히고, 창을 다시 읽어도 남는다', w1 >= w0 + 140 && w2 === w1, { w0, w1, w2 });
  await page.mouse.move(0, 0);
  // 최대 폭 막기와 두 번 누르기
  const hb2 = await (await page.$('[data-role="sidebar-resize"]')).boundingBox();
  await page.mouse.move(hb2.x + 2, hb2.y + 200); await page.mouse.down(); await page.mouse.move(hb2.x + 900, hb2.y + 200, { steps: 5 }); await page.mouse.up(); await sleep(200);
  const wMax = (await sb()).width;
  await page.dblclick('[data-role="sidebar-resize"]'); await sleep(300);
  const wDef = (await sb()).width;
  step('폭: 최대 640px에서 멈추고, 두 번 누르면 기본 340px', wMax === 640 && wDef === 340, { wMax, wDef });

  // ---------- 4. 워크스페이스 둘 지우기: 모두 보관 ----------
  await fake();
  // 셸 둘에서 오래 도는 명령(돌고 있는 CLI): 그 노드로 들어가 터미널에 친다
  for (const n of ['p44-f-1', 'p44-d-1']) {
    const id = await page.evaluate((nn) => [...window.__mt.getState().sessions.values()].find((s) => s.name === nn).sessionId, n);
    await page.evaluate((i) => window.__mt.getState().navigateTo(i, { focusTerminal: true }), id);
    await until(() => page.evaluate((i) => { const a = document.activeElement; const t = a && a.closest && a.closest('.mt-term'); return !!(t && t.dataset.session === i && a.closest('.xterm')); }, id), 15000, 200);
    await sleep(500);
    await page.keyboard.type('ping -n 300 127.0.0.1'); await page.keyboard.press('Enter');
    await sleep(300);
  }
  await until(() => page.evaluate(() => ['p44-f-1', 'p44-d-1'].every((n) => [...window.__mt.getState().sessions.values()].find((s) => s.name === n).state === 'shell_running')), 20000, 400);
  await fake();
  await click('[data-action="select-mode"]');
  for (const k of ['d', 'e']) await click(`[data-sb="ws"][data-ws="${wsKey[k]}"]`);
  await click('[data-action="remove-selected"]');
  await page.waitForSelector('[data-role="ws-close"][data-need="1"]', { timeout: 10000 });
  await sleep(400);
  const dlg = await page.evaluate(() => ({ text: document.querySelector('[data-role="ws-close"]').innerText, running: (document.querySelector('[data-role="ws-close"] [data-count="running"]') || {}).innerText || null, disabled: document.querySelector('[data-action="ws-close-confirm"]').disabled, items: document.querySelectorAll('[data-role="ws-close-list"] li').length }));
  step('지우기: 세션이 있으면 한 번 더 묻고, 돌고 있는 CLI 수를 보이며, 고르기 전에는 누를 수 없다', dlg.disabled && dlg.items === 2 && /1/.test(dlg.running || ''), dlg);
  await click('[data-action="after-archive"]');
  await shot('07-remove-ask');
  await click('[data-action="ws-close-confirm"]');
  await until(() => page.evaluate((ks) => !window.__mt.getState().workspaces.some((w) => ks.includes(w.key)), [wsKey.d, wsKey.e]), 60000, 500);
  const left1 = await page.evaluate(() => [...window.__mt.getState().sessions.values()].filter((s) => /^p44-[de]-/.test(s.name)).length);
  groups = await page.evaluate(() => window.__mt.getState().groups);
  step('지우기(모두 보관): 워크스페이스 둘과 그 세션 14개가 판에서 빠지고 그룹에서도 빠진다', left1 === 0 && !groups.some((g) => g.members.includes(wsKey.d) || g.members.includes(wsKey.e)), { left1, groups: groups.map((g) => g.members.length) });
  await shot('08-after-archive');
  // 다시 열면 보관함에 있다(자동으로는 다시 열리지 않는다)
  await sleep(2000);
  const reopened = await page.evaluate((ks) => window.__mt.getState().workspaces.some((w) => ks.includes(w.key)), [wsKey.d, wsKey.e]);
  await call('workspace.open', { path: T.DIRS[3], select: false });
  const arch = await call('archive.list', { workspace: wsKey.d });
  const archN = ((arch.workspaces.find((w) => w.key === wsKey.d) || {}).closed || []).filter((c) => /^p44-d-/.test(c.name)).length;
  step('지우기(모두 보관): 저절로 다시 열리지 않고, 사람이 다시 열면 보관함에 7개가 있다', !reopened && archN === PER, { reopened, archN });
  await call('workspace.close', { workspace: wsKey.d, confirm: true }); // 빈 것이라 바로 지운다

  // ---------- 5. 워크스페이스 둘 지우기: 모두 삭제 ----------
  await click('[data-action="select-mode"]').catch(() => {});
  if (!(await page.$('[data-role="sidebar-selbar"]'))) await click('[data-action="select-mode"]');
  for (const k of ['c', 'f']) await click(`[data-sb="ws"][data-ws="${wsKey[k]}"]`);
  await click('[data-action="remove-selected"]');
  await page.waitForSelector('[data-role="ws-close"][data-need="1"]', { timeout: 10000 });
  await click('[data-action="after-delete"]');
  await click('[data-action="ws-close-confirm"]');
  await until(() => page.evaluate((ks) => !window.__mt.getState().workspaces.some((w) => ks.includes(w.key)), [wsKey.c, wsKey.f]), 60000, 500);
  await call('workspace.open', { path: T.DIRS[5], select: false });
  await sleep(1000);
  const rl = await call('recall.list');
  const fClosed = ((rl.workspaces.find((w) => w.key === wsKey.f) || {}).closed || []).length;
  const fArch = await call('archive.list', { workspace: wsKey.f });
  const fArchN = ((fArch.workspaces.find((w) => w.key === wsKey.f) || {}).closed || []).length;
  step('지우기(모두 삭제): 세션은 판에서 지워져 닫힌 목록에도 보관함에도 없다', fClosed === 0 && fArchN === 0, { fClosed, fArchN });
  await call('workspace.close', { workspace: wsKey.f, confirm: true });
  const disk = T.DIRS.map((d) => [letter(d), fs.existsSync(d)]);
  step('지우기: 디스크의 폴더는 그대로다', disk.every(([, e]) => e), disk);
  await fake();
  await shot('09-after-delete');
  const left = await page.evaluate(() => window.__mt.getState().workspaces.map((w) => w.name));
  log('남은 워크스페이스', left);
} catch (e) {
  step('예외', false, String(e && (e.stack || e.message)).slice(0, 800));
  if (page) await shot('error').catch(() => {});
} finally {
  if (!argv.includes('--keep')) {
    for (const n of names) { try { atrium('kill', n, '--yes'); } catch {} }
    try { for (const w of await call('workspace.list').then((r) => r.workspaces)) await call('workspace.close', { workspace: w.key, confirm: true }).catch(() => {}); } catch {}
  }
  if (app) await closeApp(app);
  const pass = results.filter((r) => r.ok).length;
  log(`결과 ${pass}/${results.length}`);
  fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  process.exit(pass === results.length ? 0 : 1);
}
