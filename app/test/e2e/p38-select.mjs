// P38 창 시험: 터미널 노드에서 끌어 고르기(배율 0.5, 0.75, 1, 1.5)와 복사·붙여넣기·입력·휠 뒤의 선택.
// 판: herdr 세션 atrium-dev-p38, 포트 47856, 이 워크트리의 backend/.dev(experiments/p38/tools/env.cjs).
// 셸 노드로 고르기·지우기를 보고(덩어리 밖과 안), claude 노드(--model haiku)로 휠 스크롤 뒤의 선택을 본다.
// 시스템 클립보드를 쓰므로 시험 앞의 글을 끝에서 되돌린다.
// P42: 선택은 글에 붙어 휠·프레임에 함께 움직이고 풀리지 않는다(셸은 판 안 기록을 스크롤한다). 휠·셸 글 바뀜 단계를 새 동작에 맞췄다.
//   P42 판(atrium-dev-p42, 47860)에서도 돌린다: node experiments/p42/tools/e2e.cjs p38-select.mjs
// 사용: node experiments/p38/tools/e2e.cjs p38-select.mjs [--fresh] [--no-claude] [--tag 이름]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

const BOARDS = { p38: ['atrium-dev-p38', '47856', 'P38_ENV'], p42: ['atrium-dev-p42', '47860', 'P42_ENV'] };
const B = BOARDS[process.env.MT_E2E_OUT];
if (!B) throw new Error('MT_E2E_OUT=p38(또는 p42)를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', process.env.MT_E2E_OUT, 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T[B[2]]).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== B[0] || ENV.ATRIUM_PORT !== B[1]) throw new Error(`${process.env.MT_E2E_OUT} 판(${B[0]}, ${B[1]})만`);
if (!new RegExp(`^C:\\\\Workspace\\\\mtask-${process.env.MT_E2E_OUT}-`).test(T.DIR)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-${process.env.MT_E2E_OUT}-*만: ${T.DIR}`);
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const TAG = argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : 'p38-select';
const log = logger(TAG);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const lastLine = (s) => s.trim().split(/\r?\n/).slice(-1)[0];
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const shot = async (name) => { const f = path.join(OUT, `${TAG}-${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);

if (argv.includes('--fresh')) {
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
  await sleep(800);
  for (const d of [path.join(T.DEV, 'data'), path.join(T.DEV, 'app'), T.PROJECTS, T.SESSIONS, T.DIR]) fs.rmSync(d, { recursive: true, force: true });
}
for (const d of [T.PROJECTS, T.SESSIONS, T.DIR]) fs.mkdirSync(d, { recursive: true });

let app = null, page = null, clipBefore = null;
const ids = {};
const spawned = [];
async function open() {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(500);
}
const clipRead = () => app.evaluate(({ clipboard }) => clipboard.readText());
const clipWrite = (s) => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), s);
const reload = async () => { await page.reload(); await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 }); };

async function spawn(name, ...extra) {
  log(lastLine(atrium('spawn', T.DIR, '--name', name, ...extra)));
  spawned.push(name);
  ids[name] = await until(() => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }, name), 30000);
}
const nodeRect = (id) => page.evaluate((i) => { const r = window.__mt.getState().nodes.get(i); return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null; }, id);
async function setSize(id, w, h, x, y) {
  const r = await nodeRect(id);
  await call('board.setNode', { session: id, x: x ?? Math.round(r.x), y: y ?? Math.round(r.y), w, h, z: 0, cause: 'p38-test' });
  await reload(); // board.setNode는 board.changed를 내지 않는다. 판을 다시 읽는다
  await until(async () => { const q = await nodeRect(id); return q && q.w === w && q.h === h; }, 10000);
}
const vpNow = () => page.evaluate(() => { const m = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform); return { x: +m.e.toFixed(2), y: +m.f.toFixed(2), zoom: +m.a.toFixed(4) }; });
async function view(id, zoom) {
  await page.evaluate(([i, z]) => { const st = window.__mt.getState(); const r = st.nodes.get(i); const el = document.querySelector('.mt-canvas'); st.setViewport({ x: el.clientWidth / 2 - (r.x + r.w / 2) * z, y: el.clientHeight / 2 - (r.y + r.h / 2) * z, zoom: z }); }, [id, zoom]);
  await sleep(900);
}
// 터미널 상태: 칸 수, 화면 위 .xterm-screen 사각형, 보이는 줄, 선택
const term = (id) => page.evaluate((i) => {
  const t = window.__mt.terms.get(i);
  const el = document.querySelector(`.mt-term[data-session="${i}"] .xterm-screen`);
  if (!t || !el) return null;
  const r = el.getBoundingClientRect();
  const b = t.buffer.active;
  const lines = [];
  for (let k = 0; k < t.rows; k++) { const l = b.getLine(b.viewportY + k); lines.push(l ? l.translateToString(true) : ''); }
  return { cols: t.cols, rows: t.rows, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, lines, sel: t.getSelection(), has: t.hasSelection(), pos: t.getSelectionPosition() || null };
}, id);
// 칸(c, r: 0부터)의 화면 점. fx는 칸 안 가로 비율
const pt = (ti, c, r, fx = 0.3) => ({ x: ti.rect.x + (c + fx) * (ti.rect.w / ti.cols), y: ti.rect.y + (r + 0.5) * (ti.rect.h / ti.rows) });
const cursorAt = (x, y) => page.evaluate(([xx, yy]) => { const e = document.elementFromPoint(xx, yy); return e ? getComputedStyle(e).cursor : null; }, [x, y]);
// 끌기. 중간에 끄는 점의 포인터 모양을 잰다
async function drag(a, b, steps = 12) {
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  let midCursor = null;
  for (let i = 1; i <= steps; i++) { await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps); await sleep(12); if (i === Math.floor(steps / 2)) midCursor = await cursorAt(a.x + (b.x - a.x) / 2, a.y + (b.y - a.y) / 2); }
  await page.mouse.up();
  return midCursor;
}
// 여러 줄 선택: herdr가 다시 그린 줄은 끝까지 빈칸이라 줄 끝 빈칸을 빼고 견준다(복사도 같은 규칙, copyText)
const norm = (x) => String(x).replace(/[ \t]+(?=\r?\n|$)/g, '').replace(/\r\n/g, '\n');
const findRow = (ti, re) => ti.lines.findIndex((l) => re.test(l));
const blank = async () => { // 판의 빈 곳을 눌러 노드 고르기를 푼다
  const c = await page.evaluate(() => { const r = document.querySelector('.mt-canvas').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height - 30 }; });
  await page.mouse.click(c.x, c.y); await sleep(300);
};
const clearSel = (id) => page.evaluate((i) => window.__mt.terms.get(i).clearSelection(), id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const LINES = ['ROW1 alpha bravo charlie delta', 'ROW2 echo foxtrot golf hotel', 'ROW3 india juliet kilo lima', 'ROW4 mike november oscar papa', 'ROW5 quebec romeo sierra tango'];
async function printKnown(id) {
  const ps = `cls; ${LINES.map((l) => `'${l}'`).join(',')} | % { $_ }\r`;
  await call('terminal.input', { session: id, data: ps });
  await until(async () => { const ti = await term(id); return ti && findRow(ti, /^ROW5 quebec/) >= 0 && findRow(ti, /^ROW1 alpha/) >= 0; }, 15000, 300);
}

try {
  await open();
  clipBefore = await clipRead();
  log('클립보드 앞 글 길이', String(clipBefore.length));
  await call('settings.set', { language: 'ko' });
  await call('workspace.open', { path: T.DIR });
  await page.waitForSelector('.react-flow__node-region');
  await spawn('s1', '--kind', 'shell');
  const S = ids.s1;
  await setSize(S, 1000, 560);
  await view(S, 1);
  await until(async () => !!(await term(S)), 20000, 300);
  await until(() => page.evaluate((i) => !document.querySelector(`.react-flow__node[data-id="${i}"] .mt-term-note`), S), 20000, 300);
  await sleep(1500);
  await printKnown(S);
  await sleep(500);

  // ---------- 1. 배율마다 끌어 고르기(노드를 고르지 않은 때와 고른 때) ----------
  for (const z of [0.5, 0.75, 1, 1.5]) {
    for (const picked of [false, true]) {
      const tag = `배율 ${z}${picked ? ' 노드 고름' : ''}`;
      await view(S, z);
      if (picked) { await page.click(`.react-flow__node[data-id="${S}"] .mt-node-head`, { position: { x: 200, y: 8 } }); await sleep(500); }
      else await blank();
      await clearSel(S);
      await view(S, z);
      const ti = await term(S);
      const r1 = findRow(ti, /^ROW1 alpha/), r2 = findRow(ti, /^ROW2 echo/);
      // 같은 줄: ROW1의 5칸(alpha)부터 22칸 앞까지('alpha bravo charl')
      const n0 = await nodeRect(S), v0 = await vpNow();
      const mid = await drag(pt(ti, 5, r1), pt(ti, 22, r1));
      await sleep(900);
      const a = await term(S);
      const n1 = await nodeRect(S), v1 = await vpNow();
      const want1 = LINES[0].slice(5, 22);
      step(`${tag}: 한 줄 끌어 고르기가 마우스 밑 글자와 같다`, a.sel === want1, { got: a.sel, want: want1 });
      step(`${tag}: 고르는 동안·뒤에 노드와 판이 그대로`, same(n0, n1) && same(v0, v1), { n0, n1, v0, v1 });
      step(`${tag}: 고르는 동안 포인터는 글 고르기 모양`, mid === 'text', { mid });
      // 두 줄: ROW1의 11칸(bravo)부터 ROW2의 13칸 앞까지
      await clearSel(S);
      const ti2 = await term(S);
      await drag(pt(ti2, 11, r1), pt(ti2, 13, r2));
      await sleep(900);
      const b = await term(S);
      const want2 = `${LINES[0].slice(11)}\n${LINES[1].slice(0, 13)}`;
      step(`${tag}: 두 줄 끌어 고르기`, norm(b.sel) === want2, { got: b.sel, want: want2 });
      if (!picked) await shot(`drag-z${z}`);
      await clearSel(S);
    }
    // 두 번 눌러 낱말, 세 번 눌러 줄
    await view(S, z);
    await blank(); await view(S, z);
    const ti = await term(S);
    const r3 = findRow(ti, /^ROW3 india/), r4 = findRow(ti, /^ROW4 mike/);
    const w = LINES[2].indexOf('juliet');
    const p = pt(ti, w + 2, r3, 0.5);
    const v0 = await vpNow();
    await page.mouse.dblclick(p.x, p.y);
    await sleep(900);
    const d = await term(S);
    step(`배율 ${z}: 두 번 눌러 낱말 고르기`, d.sel === 'juliet', { got: d.sel });
    const p4 = pt(ti, 8, r4, 0.5);
    await page.mouse.click(p4.x, p4.y, { clickCount: 3 });
    await sleep(900);
    const e = await term(S);
    const v1 = await vpNow();
    step(`배율 ${z}: 세 번 눌러 줄 고르기`, e.sel.replace(/\s+$/, '') === LINES[3], { got: e.sel });
    step(`배율 ${z}: 두세 번 누르는 동안 판이 그대로`, same(v0, v1), { v0, v1 });
    await clearSel(S);
  }
  // 노드 밖으로 끌어 나가도 포인터는 글 고르기 모양(놓을 때까지)
  {
    await view(S, 0.75); await blank(); await view(S, 0.75);
    const ti = await term(S);
    const r1 = findRow(ti, /^ROW1 alpha/);
    const a = pt(ti, 5, r1);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(a.x, a.y - i * 15); await sleep(15); }
    const out = await page.evaluate(() => getComputedStyle(document.body).cursor);
    await page.mouse.up(); await sleep(300);
    const after = await page.evaluate(() => document.body.classList.contains('mt-term-selecting'));
    step('노드 밖으로 끌어 나가도 포인터는 글 고르기 모양, 놓으면 돌아온다', out === 'text' && !after, { out, after });
    await clearSel(S);
  }

  // ---------- 1b. 덩어리 안 노드 ----------
  {
    await spawn('s2', '--kind', 'shell');
    log(lastLine(atrium('dock', 's2', 's1', '--side', 'right', '--at', 'dock')));
    await reload();
    await until(async () => !!(await term(S)), 20000, 300);
    await sleep(1500);
    for (const z of [0.5, 1]) {
      await view(S, z); await blank(); await view(S, z);
      await clearSel(S);
      const ti = await term(S);
      const r1 = findRow(ti, /^ROW1 alpha/), r2 = findRow(ti, /^ROW2 echo/);
      if (r1 < 0) { step(`덩어리 안 배율 ${z}: 알려진 글이 보인다`, false, ti.lines.slice(0, 8)); continue; }
      const n0 = await nodeRect(S), v0 = await vpNow();
      await drag(pt(ti, 11, r1), pt(ti, 13, r2));
      await sleep(900);
      const b = await term(S);
      const n1 = await nodeRect(S), v1 = await vpNow();
      step(`덩어리 안 배율 ${z}: 두 줄 끌어 고르기`, norm(b.sel) === `${LINES[0].slice(11)}\n${LINES[1].slice(0, 13)}`, { got: b.sel });
      step(`덩어리 안 배율 ${z}: 노드와 판이 그대로`, same(n0, n1) && same(v0, v1), { n0, n1, v0, v1 });
      await shot(`dock-z${z}`);
      await clearSel(S);
    }
  }

  // ---------- 2. 복사·붙여넣기·입력·휠 뒤의 선택 ----------
  await view(S, 0.75);
  await blank(); await view(S, 0.75);
  const pick = async () => { await clearSel(S); const ti = await term(S); const r = findRow(ti, /^ROW5 quebec/); await drag(pt(ti, 5, r), pt(ti, 17, r)); await sleep(600); return term(S); };
  const SENT = 'p38-sentinel';
  await clipWrite(SENT);
  // 선택이 없을 때 Ctrl+C는 ^C(복사하지 않는다)
  await clearSel(S);
  await page.locator(`.mt-term[data-session="${S}"] textarea`).focus();
  await page.keyboard.press('Control+c');
  await sleep(400);
  step('선택이 없을 때 Ctrl+C는 복사하지 않는다(^C)', (await clipRead()) === SENT, { clip: await clipRead() });
  await printKnown(S);
  for (const combo of ['Control+c', 'Control+Shift+c']) {
    const a = await pick();
    await page.keyboard.press(combo);
    await sleep(500);
    const b = await term(S);
    const clip = await clipRead();
    step(`${combo}: 고른 글을 복사하고 선택을 지운다`, a.has && a.sel === LINES[4].slice(5, 17) && clip === a.sel && !b.has, { sel: a.sel, clip, after: b.has });
    await clipWrite(SENT);
  }
  // 여러 줄 복사는 줄 끝 빈칸을 뺀다
  {
    await clearSel(S);
    const ti = await term(S);
    const r1 = findRow(ti, /^ROW1 alpha/), r2 = findRow(ti, /^ROW2 echo/);
    await drag(pt(ti, 11, r1), pt(ti, 13, r2)); await sleep(600);
    await page.keyboard.press('Control+c'); await sleep(500);
    const clip = await clipRead();
    step('여러 줄 복사는 줄 끝 빈칸을 뺀다', clip.replace(/\r\n/g, '\n') === `${LINES[0].slice(11)}\n${LINES[1].slice(0, 13)}`, { clip });
    await clipWrite(SENT);
  }
  await shot('after-copy');
  for (const combo of ['Control+v', 'Shift+Insert']) {
    await clipWrite('p38paste');
    const a = await pick();
    await page.keyboard.press(combo);
    await sleep(800);
    const b = await term(S);
    const pasted = b.lines.some((l) => l.includes('p38paste'));
    step(`${combo}: 붙여넣으면 선택을 지운다(붙여넣기는 그대로 된다)`, a.has && !b.has && pasted, { before: a.has, after: b.has, pasted });
    await call('terminal.input', { session: S, data: '\x1b' }); // 입력 줄 비우기
    await sleep(400);
  }
  await shot('after-paste');
  {
    const a = await pick();
    await page.keyboard.type('z');
    await sleep(500);
    const b = await term(S);
    step('글을 치면 선택을 지운다', a.has && !b.has, { before: a.has, after: b.has });
    await call('terminal.input', { session: S, data: '\x1b' });
    await sleep(300);
  }
  {
    const a = await pick();
    const box = a.rect;
    await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
    await page.mouse.wheel(0, -300);
    await sleep(800);
    const b = await term(S);
    // P42: 셸은 판 안 기록을 스크롤하고, 선택은 같은 글(버퍼 줄)에 붙어 남는다
    const stay = b.has && b.sel === a.sel && same(b.pos, a.pos);
    step('셸: 휠 뒤 선택은 풀리지 않고 같은 글 위에 남는다(P42)', a.has && stay, { before: a.sel, after: b.has ? b.sel : null });
    await page.evaluate((i) => window.__mt.terms.get(i).scrollToBottom(), S);
    await shot('after-wheel-shell');
    await call('terminal.input', { session: S, data: '\x1b' });
  }
  // 선택한 채로 셸 출력이 그 자리 글을 바꾸면(cls 후 다른 글) 선택이 다른 글 위에 남지 않는다
  {
    const a = await pick();
    await call('terminal.input', { session: S, data: "cls; 'zzzz zzzz zzzz zzzz zzzz zzzz zzzz'\r" });
    await sleep(1500);
    const b = await term(S);
    // P42: 프레임으로는 선택을 지우지 않는다(일하는 중에도 복사되게). 셸의 cls처럼 제자리에서 글이 바뀌면 선택은 그 자리에 남고, 복사는 지금 글이다
    step('셸: 고른 자리의 글이 바뀌어도 선택이 풀리지 않는다(P42)', a.has && b.has, { before: a.sel, after: b.has ? b.sel : null });
    await clearSel(S);
    await printKnown(S);
  }
  // 한 번 누르기(끌지 않음)는 지금처럼 그 노드로 화면을 옮긴다(늦춰서)
  {
    await view(S, 0.5); await blank(); await view(S, 0.5);
    const v0 = await vpNow();
    const ti = await term(S);
    const p = pt(ti, 3, 2, 0.5);
    await page.mouse.click(p.x, p.y);
    await sleep(1200);
    const v1 = await vpNow();
    step('터미널을 한 번 누르면(끌지 않음) 지금처럼 그 노드로 화면을 옮긴다', !same(v0, v1), { v0, v1 });
  }

  // ---------- 3. claude 노드: 휠 스크롤 뒤 선택 ----------
  if (!argv.includes('--no-claude')) {
    log('신뢰 예상', atrium('trust', T.DIR).trim());
    await spawn('c1', '--model', 'haiku', '--prompt', 'Output the integers from 1 to 120, each on its own line, as plain text with no code block and nothing else.');
    const C = ids.c1;
    const r0 = await nodeRect(S);
    await setSize(C, 1000, 560, Math.round(r0.x), Math.round(r0.y + r0.h + 160));
    await view(C, 1);
    const got = await until(async () => { const ti = await term(C); if (!ti) return null; const txt = ti.lines.join('\n'); if (/trust this folder|Do you trust/i.test(txt)) return 'trust'; return ti.lines.filter((l) => /^\s*\d{2,3}\s*$/.test(l)).length >= 8 && /\b120\b/.test(txt) ? 'ok' : null; }, 150000, 1000).catch(() => null);
    log('claude 화면', got);
    if (got === 'trust') step('claude 노드: 신뢰 대화상자가 떠서 대신 누르지 않음(사용자 점검으로)', false, 'trust');
    else if (got !== 'ok') step('claude 노드: 숫자 출력을 받았다', false, (await term(C))?.lines.slice(-10));
    else {
      await sleep(4000);
      for (const z of [1, 0.75]) {
        await view(C, z);
        await blank(); await view(C, z);
        const ti = await term(C);
        const rows = ti.lines.map((l, i) => [l, i]).filter(([l]) => /^\s*\d{2,3}\s*$/.test(l));
        const [line, r] = rows[Math.floor(rows.length / 2)];
        const c0 = line.search(/\d/);
        await drag(pt(ti, c0, r), pt(ti, c0 + line.trim().length, r + 1, 0.1));
        await sleep(600);
        const a = await term(C);
        log('claude 고름', JSON.stringify({ sel: a.sel, pos: a.pos }));
        await page.mouse.move(ti.rect.x + ti.rect.w / 2, ti.rect.y + ti.rect.h / 2);
        await page.mouse.wheel(0, -300);
        await sleep(1500);
        const b = await term(C);
        const moved = b.lines.join('\n') !== a.lines.join('\n');
        // P42: 선택은 풀리지 않고 고를 때의 글 그대로다(글과 함께 움직인다)
        step(`claude 배율 ${z}: 휠 스크롤 뒤 선택이 풀리지 않고 고른 글 그대로다(P42)`, a.has && b.has && b.sel === a.sel, { before: a.sel, after: b.has ? b.sel : null, screenMoved: moved });
        await shot(`claude-wheel-z${z}`);
        await page.mouse.wheel(0, 300); await sleep(800);
        await clearSel(C);
      }
    }
  }
} catch (e) {
  log('오류', e.stack);
  step('시험이 끝까지 돌았다', false, e.message);
  if (page) await shot('fail').catch(() => {});
} finally {
  if (app && clipBefore !== null) { try { await clipWrite(clipBefore); log('클립보드 되돌림', String((await clipRead()) === clipBefore)); } catch (e) { log('클립보드 되돌리기 실패', e.message); } }
  for (const n of spawned) { try { log(lastLine(atrium('kill', n, '--yes'))); } catch (e) { log('kill', n, e.message.slice(0, 200)); } }
  if (app) await closeApp(app);
  const pass = results.filter((r) => r.ok).length;
  log(`결과 ${pass}/${results.length}`);
  fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  process.exit(pass === results.length ? 0 : 1);
}
