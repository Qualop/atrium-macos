// P42 창 시험: 터미널 노드의 웹 같은 글 고르기. 배율 1과 0.75에서
//   - 끌어서 노드 아래(셸은 위) 가장자리 밖으로 가져가면 저절로 스크롤되며 화면 밖 줄까지 골라지고, 복사한 글이 기대한 여러 줄과 같다
//   - 고른 뒤 휠을 굴려도 선택이 풀리지 않고 글과 함께 움직이며, 그 뒤 복사가 된다
//   - 끄는 중 휠을 굴리면 선택이 늘어난다
//   - claude 노드가 일하는 중(스피너가 도는 중)에도 고른 글이 지워지지 않고 복사된다
//   - 셸 노드: 지난 출력이 판 안 기록(xterm scrollback)에 들어가(밀려난 줄, 다시 붙을 때 herdr 기록) 같은 시험을 한다
//   - Esc는 선택만 끝낸다
// 판: herdr 세션 atrium-dev-p42, 포트 47860, 이 워크트리의 backend/.dev(experiments/p42/tools/env.cjs). claude는 --model haiku.
// 시스템 클립보드를 쓰므로 시험 앞의 글을 끝에서 되돌린다.
// 사용: node experiments/p42/tools/e2e.cjs p42-select.mjs [--fresh] [--no-claude] [--no-shell] [--no-working] [--tag 이름]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p42') throw new Error('MT_E2E_OUT=p42를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p42', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P42_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p42' || ENV.ATRIUM_PORT !== '47860') throw new Error('P42 판(atrium-dev-p42, 47860)만');
if (!/^C:\\Workspace\\mtask-p42-/.test(T.DIR)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p42-*만: ${T.DIR}`);
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const TAG = argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : 'p42-select';
const log = logger(TAG);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const lastLine = (s) => s.trim().split(/\r?\n/).slice(-1)[0];
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)); };
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
const ready = () => page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
async function open() {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await ready();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(500);
}
const clipRead = () => app.evaluate(({ clipboard }) => clipboard.readText());
const clipWrite = (s) => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), s);
const reload = async () => { await page.reload(); await ready(); };

async function spawn(name, ...extra) {
  log(lastLine(atrium('spawn', T.DIR, '--name', name, ...extra)));
  spawned.push(name);
  ids[name] = await until(() => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }, name), 30000);
}
const nodeRect = (id) => page.evaluate((i) => { const r = window.__mt.getState().nodes.get(i); return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null; }, id);
async function setSize(id, w, h, x, y) {
  const r = await nodeRect(id);
  await call('board.setNode', { session: id, x: x ?? Math.round(r.x), y: y ?? Math.round(r.y), w, h, z: 0, cause: 'p42-test' });
  await reload();
  await until(async () => { const q = await nodeRect(id); return q && q.w === w && q.h === h; }, 10000);
}
async function view(id, zoom) {
  await page.evaluate(([i, z]) => { const st = window.__mt.getState(); const r = st.nodes.get(i); const el = document.querySelector('.mt-canvas'); st.setViewport({ x: el.clientWidth / 2 - (r.x + r.w / 2) * z, y: el.clientHeight / 2 - (r.y + r.h / 2) * z, zoom: z }); }, [id, zoom]);
  await sleep(900);
}
// 터미널 상태: 칸 수, 화면 위 사각형, 보이는 줄, 선택(P42 문서 선택), xterm이 그린 선택 자리, 버퍼 길이와 보는 줄
const term = (id) => page.evaluate((i) => {
  const t = window.__mt.terms.get(i);
  const el = document.querySelector(`.mt-term[data-session="${i}"] .xterm-screen`);
  if (!t || !el) return null;
  const r = el.getBoundingClientRect();
  const b = t.buffer.active;
  const lines = [];
  for (let k = 0; k < t.rows; k++) { const l = b.getLine(b.viewportY + k); lines.push(l ? l.translateToString(true).trimEnd() : ''); }
  return { cols: t.cols, rows: t.rows, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, lines, sel: t.getSelection(), has: t.hasSelection(), pos: t.getSelectionPosition() || null, length: b.length, viewportY: b.viewportY };
}, id);
const bufferHas = (id, re) => page.evaluate(([i, src]) => { const t = window.__mt.terms.get(i); const b = t.buffer.active; const rx = new RegExp(src); for (let y = 0; y < b.length; y++) { const l = b.getLine(y); if (l && rx.test(l.translateToString(true).trimEnd())) return y; } return -1; }, [id, re.source]);
// 칸(c, r: 0부터)의 화면 점. fx는 칸 안 가로 비율(0.1이면 그 칸의 앞 경계)
const pt = (ti, c, r, fx = 0.1) => ({ x: ti.rect.x + (c + fx) * (ti.rect.w / ti.cols), y: ti.rect.y + (r + 0.5) * (ti.rect.h / ti.rows) });
const rowH = (ti) => ti.rect.h / ti.rows;
async function moveTo(from, to, steps = 10) { for (let i = 1; i <= steps; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps); await sleep(15); } }
const blank = async () => { const c = await page.evaluate(() => { const r = document.querySelector('.mt-canvas').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height - 30 }; }); await page.mouse.click(c.x, c.y); await sleep(300); };
const focusTerm = (id) => page.locator(`.mt-term[data-session="${id}"] textarea`).focus();
const esc = async (id) => { await focusTerm(id); await page.keyboard.press('Escape'); await sleep(200); };
const selLines = (s) => String(s).split(/\r?\n/);
// 고른 글의 줄마다 번호(claude: "  N", 셸: "shell line N"). 이어진 번호인지 본다
const numsOf = (s, re) => selLines(s).map((l) => { const m = l.match(re); return m ? +m[1] : null; });
const consecutive = (ns) => ns.length > 0 && ns.every((n, k) => n !== null && (k === 0 || n === ns[k - 1] + 1));
const CL = /^\s*(\d{1,4})\s*$/, SH = /^shell line (\d+)$/;
const numRows = (ti, re) => ti.lines.map((l, r) => { const m = l.match(re); return m ? { n: +m[1], r, c: l.search(/\S/), len: l.trim().length, line: l } : null; }).filter(Boolean);

// 같은 시험을 claude 노드와 셸 노드에 한다. dir: 가장자리 자동 스크롤 방향(claude 아래, 셸 위). want(ns): 기대한 복사 글
async function suite(kind, id, z, { re, dir, wantText, toTop }) {
  const tag = `${kind} 배율 ${z}`;
  await view(id, z); await blank(); await view(id, z);
  await toTop();
  let ti = await term(id);
  let rows = numRows(ti, re);
  if (rows.length < 10) { step(`${tag}: 번호 줄이 보인다`, false, ti.lines.slice(0, 6)); return; }
  // ---- 1. 끌어서 가장자리 밖으로: 저절로 스크롤되며 화면 밖 줄까지 고른다
  {
    const startRow = dir > 0 ? rows[2] : rows[rows.length - 3];
    const visMin = rows[0].n, visMax = rows[rows.length - 1].n;
    const a = dir > 0 ? pt(ti, startRow.c, startRow.r) : pt(ti, startRow.c + startRow.len, startRow.r);
    const out = { x: a.x, y: dir > 0 ? ti.rect.y + ti.rect.h + 1.5 * rowH(ti) : ti.rect.y - 1.5 * rowH(ti) };
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await moveTo(a, out, 12);
    await sleep(1600); // 가장자리 밖에서 기다리는 동안 저절로 스크롤
    const mid = await term(id);
    await shot(`${kind}-edge-drag-z${z}`); // 가장자리 밖에서 끄는 중
    await page.mouse.up(); await sleep(400);
    const b = await term(id);
    const ns = numsOf(b.sel, re);
    const moved = mid.lines.join('\n') !== ti.lines.join('\n');
    const beyond = dir > 0 ? ns[ns.length - 1] > visMax : ns[0] < visMin;
    const trace = await page.evaluate((i) => (window.__mt.terms.get(i)._mtSel.trace || []).slice(-60), id);
    log(`${tag} 자동 스크롤 기록`, JSON.stringify(trace));
    step(`${tag}: 가장자리 밖으로 끌면 저절로 스크롤되고 화면 밖 줄까지 이어서 골라진다`, b.has && moved && consecutive(ns) && beyond && (dir > 0 ? ns[0] === startRow.n : ns[ns.length - 1] === startRow.n),
      { first: ns[0], last: ns[ns.length - 1], count: ns.length, visMin, visMax, moved, bodyCursorClass: mid.has });
    await clipWrite('p42-sentinel');
    await focusTerm(id); await page.keyboard.press('Control+c'); await sleep(500);
    const clip = await clipRead();
    const want = wantText(ns);
    step(`${tag}: 복사한 글이 기대한 여러 줄과 같다(${ns.length}줄)`, clip === want, { clipHead: clip.slice(0, 80), clipTail: clip.slice(-60), wantHead: want.slice(0, 80), wantTail: want.slice(-60) });
    await shot(`${kind}-edge-z${z}`);
  }
  // ---- 2. 고른 뒤 휠: 선택이 풀리지 않고 글과 함께 움직인 뒤 복사된다
  {
    await toTop();
    ti = await term(id); rows = numRows(ti, re);
    const r0 = rows[Math.floor(rows.length / 2)], r1 = rows[Math.floor(rows.length / 2) + 1];
    const a = pt(ti, r0.c, r0.r), bpt = pt(ti, r1.c + r1.len, r1.r);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await moveTo(a, bpt, 6); await page.mouse.up(); await sleep(400);
    const s0 = await term(id);
    await page.mouse.move(ti.rect.x + ti.rect.w / 2, ti.rect.y + ti.rect.h / 2);
    await page.mouse.wheel(0, dir > 0 ? 300 : -300); await sleep(1300);
    const s1 = await term(id);
    const moved = s1.lines.join('\n') !== s0.lines.join('\n');
    // 그려진 선택의 화면 줄(버퍼 줄 - 보는 줄)이 휠만큼 옮겨 가고, 그 줄의 글이 고른 글이다(화면 밖으로 나갔으면 그려지지 않는다)
    const row0 = s0.pos ? s0.pos.start.y - s0.viewportY : null, row1 = s1.pos ? s1.pos.start.y - s1.viewportY : null;
    const follows = s1.pos ? numRows({ lines: [s1.lines[row1] || ''] }, re).some((x) => x.n === r0.n) : true;
    step(`${tag}: 고른 뒤 휠을 굴려도 선택이 풀리지 않고 글과 함께 움직인다`, s0.has && s1.has && s1.sel === s0.sel && moved && follows && row0 !== row1,
      { before: s0.sel, after: s1.sel, row0, row1, moved, follows });
    await shot(`${kind}-wheel-z${z}`); // 휠 뒤, 복사 전(선택이 보인다)
    await clipWrite('p42-sentinel');
    await focusTerm(id); await page.keyboard.press('Control+c'); await sleep(500);
    const clip = await clipRead();
    step(`${tag}: 휠 뒤에도 복사가 된다`, clip === s0.sel && clip === wantText([r0.n, r1.n]), { clip, sel: s0.sel });
  }
  // ---- 3. 끄는 중 휠을 굴리면 선택이 늘어난다
  {
    await toTop();
    ti = await term(id); rows = numRows(ti, re);
    const r0 = dir > 0 ? rows[3] : rows[rows.length - 4];
    const r2 = dir > 0 ? rows[5] : rows[rows.length - 6];
    const a = pt(ti, r0.c, r0.r), bpt = pt(ti, r2.c + 1, r2.r);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await moveTo(a, bpt, 6); await sleep(200);
    const s0 = await term(id);
    await page.mouse.wheel(0, dir > 0 ? 300 : -300); await sleep(1300);
    await page.mouse.move(bpt.x + 1, bpt.y); await sleep(200);
    const s1 = await term(id);
    await page.mouse.up(); await sleep(300);
    const n0 = selLines(s0.sel).length, n1 = selLines(s1.sel).length;
    const ns = numsOf(s1.sel, re).filter((x) => x !== null);
    step(`${tag}: 끄는 중 휠을 굴리면 선택이 스크롤을 따라 늘어난다`, s1.has && n1 > n0 + 1 && (dir > 0 ? ns[0] === r0.n : ns[ns.length - 1] <= r0.n), { before: n0, after: n1, first: ns[0], last: ns[ns.length - 1] });
    // Esc는 선택만 끝낸다
    await esc(id);
    const s2 = await term(id);
    step(`${tag}: Esc로 선택이 끝난다`, !s2.has && !s2.pos, { has: s2.has });
  }
}

try {
  await open();
  clipBefore = await clipRead();
  log('클립보드 앞 글 길이', String(clipBefore.length));
  await call('settings.set', { language: 'ko' });
  await call('workspace.open', { path: T.DIR });
  await page.waitForSelector('.react-flow__node-region');

  // ---------- 셸 ----------
  if (!argv.includes('--no-shell')) {
    await spawn('s1', '--kind', 'shell');
    const S = ids.s1;
    await setSize(S, 1000, 560);
    await view(S, 1);
    await until(async () => !!(await term(S)), 20000, 300);
    await until(() => page.evaluate((i) => !document.querySelector(`.react-flow__node[data-id="${i}"] .mt-term-note`), S), 20000, 300);
    await sleep(1500);
    log('셸 붙음');
    await call('terminal.input', { session: S, data: "cls; 1..150 | % { 'shell line ' + $_ }\r" });
    await until(async () => { const ti = await term(S); return ti && ti.lines.some((l) => /^shell line 150$/.test(l)); }, 20000, 300).catch(async (e) => { log('셸 화면', JSON.stringify(await term(S)).slice(0, 1500)); throw e; });
    const dupOf = () => page.evaluate((i) => { const b = window.__mt.terms.get(i).buffer.active; const seen = new Map(); for (let y = 0; y < b.length; y++) { const s = b.getLine(y).translateToString(true).trimEnd(); if (/^(shell|slow) line \d+$/.test(s)) seen.set(s, (seen.get(s) || 0) + 1); } return [...seen.values()].filter((v) => v > 1).length; }, S);
    await until(async () => (await bufferHas(S, /^shell line 1$/)) >= 0, 5000, 200).catch(() => null);
    const live = await bufferHas(S, /^shell line 1$/);
    const t0 = await term(S);
    step('셸: 빠른 출력이 지나가도(한 프레임에 150줄) 출력이 멈추면 판 안 기록(scrollback)이 herdr 기록과 같아진다', live >= 0 && t0.length > t0.rows && !t0.lines.some((l) => /^shell line 1$/.test(l)) && (await dupOf()) === 0, { line1At: live, length: t0.length, rows: t0.rows });
    // 천천히 나오는 출력: 프레임마다 밀려난 줄을 scrollback으로 보낸다(다시 맞추기 없이도 이어진다)
    await call('terminal.input', { session: S, data: "1..40 | % { 'slow line ' + $_; Start-Sleep -Milliseconds 80 }\r" });
    await until(async () => { const ti = await term(S); return ti && ti.lines.some((l) => /^slow line 40$/.test(l)); }, 20000, 300);
    await sleep(1500);
    const slowAll = await page.evaluate((i) => { const b = window.__mt.terms.get(i).buffer.active; const got = new Set(); for (let y = 0; y < b.length; y++) { const m = b.getLine(y).translateToString(true).trimEnd().match(/^slow line (\d+)$/); if (m) got.add(+m[1]); } return got.size; }, S);
    step('셸: 천천히 나오는 출력도 밀려난 줄까지 판 안 기록에 겹침 없이 남는다', slowAll === 40 && (await dupOf()) === 0, { slowAll, dup: await dupOf() });
    await call('terminal.input', { session: S, data: "cls; 1..150 | % { 'shell line ' + $_ }\r" });
    await until(async () => { const ti = await term(S); return ti && ti.lines.some((l) => /^shell line 150$/.test(l)); }, 20000, 300);
    await sleep(1200);
    await reload();
    await until(async () => { const ti = await term(S); return ti && ti.lines.some((l) => /^shell line 150$/.test(l)); }, 20000, 300);
    await sleep(800);
    const pre = await bufferHas(S, /^shell line 1$/);
    const t1 = await term(S);
    const dup = await page.evaluate((i) => { const b = window.__mt.terms.get(i).buffer.active; const seen = new Map(); for (let y = 0; y < b.length; y++) { const s = b.getLine(y).translateToString(true).trimEnd(); if (/^shell line \d+$/.test(s)) seen.set(s, (seen.get(s) || 0) + 1); } return [...seen.values()].filter((v) => v > 1).length; }, S);
    step('셸: 다시 붙으면 herdr 기록(지난 출력)이 판 안 기록에 들어간다(겹치는 줄 없이)', pre >= 0 && t1.length > t1.rows && dup === 0, { line1At: pre, length: t1.length, dup });
    const shellTop = async () => { // 판 안 기록을 위로 올려 30~70번 줄쯤이 보이게
      await page.evaluate((i) => { const t = window.__mt.terms.get(i); t.scrollToBottom(); }, S);
      const ti = await term(S);
      await page.mouse.move(ti.rect.x + ti.rect.w / 2, ti.rect.y + ti.rect.h / 2);
      for (let k = 0; k < 40; k++) { const q = await term(S); const rs = numRows(q, SH); if (rs.length && rs[0].n <= 75) break; await page.mouse.wheel(0, -200); await sleep(120); }
      await sleep(400);
    };
    for (const z of [1, 0.75]) await suite('셸', S, z, { re: SH, dir: -1, toTop: shellTop, wantText: (ns) => ns.map((n) => `shell line ${n}`).join('\r\n') });
    await page.evaluate((i) => window.__mt.terms.get(i).scrollToBottom(), S);
  }

  // ---------- claude ----------
  if (!argv.includes('--no-claude')) {
    log('신뢰 예상', atrium('trust', T.DIR).trim());
    await spawn('c1', '--model', 'haiku', '--prompt', 'Output the integers from 1 to 150, each on its own line, as plain text with no code block and nothing else.');
    const C = ids.c1;
    const anchor = ids.s1 ? await nodeRect(ids.s1) : { x: 0, y: 0, h: 0 };
    await setSize(C, 1000, 560, Math.round(anchor.x), Math.round(anchor.y + anchor.h + 160));
    await view(C, 1);
    const got = await until(async () => { const ti = await term(C); if (!ti) return null; const txt = ti.lines.join('\n'); if (/trust this folder|Do you trust/i.test(txt)) return 'trust'; return numRows(ti, CL).length >= 8 && /\b150\b/.test(txt) ? 'ok' : null; }, 150000, 1000).catch(() => null);
    log('claude 화면', got);
    if (got === 'trust') step('claude 노드: 신뢰 대화상자가 떠서 대신 누르지 않음(사용자 점검으로)', false, 'trust');
    else if (got !== 'ok') step('claude 노드: 숫자 출력을 받았다', false, (await term(C))?.lines.slice(-10));
    else {
      await sleep(3000);
      const claudeTop = async () => { // Claude Code를 위로 스크롤해 앞쪽 번호(30번 안팎)가 보이게
        const ti = await term(C);
        await page.mouse.move(ti.rect.x + ti.rect.w / 2, ti.rect.y + ti.rect.h / 2);
        for (let k = 0; k < 60; k++) { const q = await term(C); const rs = numRows(q, CL); if (rs.length > 10 && rs[0].n <= 30) break; await page.mouse.wheel(0, -300); await sleep(150); }
        for (let k = 0; k < 6; k++) { const q = await term(C); const rs = numRows(q, CL); if (rs.length > 10 && rs[0].n >= 10) break; await page.mouse.wheel(0, 100); await sleep(250); }
        await sleep(600);
      };
      for (const z of [1, 0.75]) await suite('claude', C, z, { re: CL, dir: 1, toTop: claudeTop, wantText: (ns) => ns.map((n, k) => (k ? `  ${n}` : `${n}`)).join('\r\n') });

      // ---------- claude 일하는 중 ----------
      if (!argv.includes('--no-working')) {
        await view(C, 1); await blank(); await view(C, 1);
        let ti = await term(C);
        await page.mouse.move(ti.rect.x + ti.rect.w / 2, ti.rect.y + ti.rect.h / 2);
        for (let k = 0; k < 12; k++) { await page.mouse.wheel(0, 1500); await sleep(100); } // 맨 아래로
        await call('terminal.input', { session: C, data: 'Write the integers from 1 to 1500, each on its own line, plain text only.' });
        await sleep(700);
        await call('terminal.input', { session: C, data: '\r' });
        const state = () => page.evaluate((i) => (window.__mt.getState().sessions.get(i) || {}).state, C);
        await until(async () => (await state()) === 'working', 30000, 200).catch(() => null);
        // 이 Claude Code(전체 화면)는 답을 다 만든 뒤 한꺼번에 그리고, 일하는 동안에는 스피너 줄("✢ Meandering… (13s · …)")이 바뀐다.
        // 고른 범위에 스피너 줄을 넣으면 고른 자리의 글이 계속 바뀐다(P38에서 선택이 지워지던 때). 번호 줄만 고른 것도 본다
        const SPIN = /…\s*\(\d+s/;
        await until(async () => { const q = await term(C); return q && q.lines.some((l) => SPIN.test(l)); }, 30000, 150).catch(() => null);
        let ok = 0, tries = 0, changed = 0;
        for (let k = 0; k < 4; k++) {
          if ((await state()) !== 'working') break;
          ti = await term(C);
          const rs = numRows(ti, CL);
          const sr = ti.lines.findIndex((l) => SPIN.test(l));
          if (rs.length < 6 || sr < 0) { await sleep(300); continue; }
          tries++;
          const withSpinner = k % 2 === 1;
          const r0 = rs[rs.length - 2], r1 = rs[rs.length - 1];
          await clipWrite('p42-sentinel');
          const a = pt(ti, r0.c, r0.r), bpt = withSpinner ? pt(ti, ti.lines[sr].trimEnd().length, sr) : pt(ti, r1.c + r1.len, r1.r);
          await page.mouse.move(a.x, a.y); await page.mouse.down(); await moveTo(a, bpt, 4); await page.mouse.up();
          const w0 = await term(C);
          await sleep(1200); // 그동안 스피너 프레임이 계속 온다
          const w1 = await term(C);
          await focusTerm(C); await page.keyboard.press('Control+c'); await sleep(400);
          const clip = await clipRead();
          const spinChanged = w1.lines[sr] !== w0.lines[sr];
          if (withSpinner && spinChanged) changed++;
          const pass = withSpinner
            ? w0.has && w1.has && clip.startsWith(`${r0.n}\r\n  ${r1.n}\r\n`) && SPIN.test(selLines(clip).slice(-1)[0]) && clip === w1.sel // 스피너 줄은 지금 글
            : w0.has && w1.has && clip === w0.sel && clip === `${r0.n}\r\n  ${r1.n}`;
          if (pass) ok++;
          log(`일하는 중 복사 ${k}`, JSON.stringify({ withSpinner, sel0: w0.sel, clip, keep: w1.has, spinChanged, state: await state() }));
          if (k === 1) await shot('claude-working');
        }
        step('claude 노드가 일하는 중(스피너가 도는 중)에도 고른 글이 지워지지 않고 복사된다(고른 범위에 스피너 줄이 있어도)', tries >= 2 && ok === tries && changed > 0, { ok, tries, spinnerChangedUnderSelection: changed });
        await until(async () => (await state()) !== 'working', 90000, 1000).catch(() => null);
      }
    }
  }
} catch (e) {
  log('오류', e.stack);
  step('시험이 끝까지 돌았다', false, e.message);
  if (page) await shot('fail').catch(() => {});
} finally {
  if (app && clipBefore !== null) { try { await clipWrite(clipBefore); log('클립보드 되돌림', String((await clipRead()) === clipBefore)); } catch (e) { log('클립보드 되돌리기 실패', e.message); } }
  if (!argv.includes('--keep')) for (const n of spawned) { try { log(lastLine(atrium('kill', n, '--yes'))); } catch (e) { log('kill', n, e.message.slice(0, 200)); } }
  if (app) await closeApp(app);
  const pass = results.filter((r) => r.ok).length;
  log(`결과 ${pass}/${results.length}`);
  fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  process.exit(pass === results.length ? 0 : 1);
}
