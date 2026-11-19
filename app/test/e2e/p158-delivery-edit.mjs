// P158 창 시험: 명령줄 위 전달 칩. (1) 대기 중 칩의 수정(붙잡는 동안 세션이 한가해져도 보내지 않고, 저장하면 고친 글이 들어간다)
// (2) 세션 맵을 연 채 칩 줄이 명령줄 바로 위에 붙는다(1584·2576 폭, 사이드바 열고 닫고, 명령줄 여러 줄).
// 판: 따로 띄운 개발용 판(atrium-dev-p158, 47927, backend/.dev)만 쓴다. 창의 원격 디버깅 포트 9407. 한 번에 한 창만(메모리).
//   시험 폴더 C:\Workspace\mtask-p158-a(그 폴더의 .claude/settings.local.json이 ping만 허용해 오래 도는 턴을 만든다)에 haiku 세션 p158-w를 띄운다.
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p158-delivery-edit.mjs <setup|edit|map|stop>
// 결과는 워크트리의 experiments/p158/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p158');
const CONVOS = path.join(REPO, 'experiments', 'p158', 'convos');
const DIR = 'C:\\Workspace\\mtask-p158-a';
const NAME = 'p158-w';
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k];
process.env.MT_E2E_OUT = path.relative(path.join(REPO, 'experiments'), OUT);
const ENV = {
  ATRIUM_TERMINAL_SESSION: 'atrium-dev-p158', ATRIUM_HERDR_SESSION: 'atrium-dev-p158', ATRIUM_PORT: '47927',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p158-none-',
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const log = logger(`p158-${WHAT}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const AWAKE = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
const shotTo = (pg, name, clip) => pg.screenshot({ path: path.join(OUT, `${name}.png`), ...(clip ? { clip } : {}) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
async function awayWin(app) { return app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; if (!w) return null; const ds = screen.getAllDisplays(); const left = Math.min(...ds.map((d) => d.bounds.x)); const b = w.getBounds(); w.setPosition(left - b.width - 200, 40); return w.getBounds(); }).catch((e) => ({ err: e.message })); }
async function winSize(app, page, width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(w, h); }, [width, height]).catch(() => {});
  await page.setViewportSize({ width, height }).catch(() => {});
  await sleep(700);
}
const sess = () => call('session.list').find((s) => s.name === NAME);
const stateOf = () => { const s = sess(); return s ? s.state : null; };
const active = () => call('delivery.list', { active: true }).filter((d) => d.name === NAME);
async function until(fn, ms, step = 1000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step); } }
const PING = 'Run the Bash command `ping -n 45 127.0.0.1` in the foreground (not in the background) and then reply with the single word pinged.';

async function setupBoard() {
  fs.mkdirSync(path.join(DIR, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(DIR, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ping:*)'] } }, null, 2));
  log(atrium('backend', 'start').trim().slice(0, 300));
  if (!sess()) log(atrium('--json', 'spawn', DIR, '--name', NAME, '--model', 'haiku').slice(0, 200));
  const st = await until(() => { const s = stateOf(); return s === 'ready' || s === 'trust_wait' ? s : null; }, 90000, 1500);
  log(`세션 상태 ${st}`);
  if (st === 'trust_wait') fs.writeFileSync(path.join(DEV, 'p158-need-trust.txt'), `${NAME} (${DIR}) 신뢰 질문이 떴다. 개발용 판(47927)에서 사람이 한 번 답해야 한다\n`);
  check('준비: haiku 세션이 ready', st === 'ready', st);
}

// 명령줄에 글을 쳐서 보낸다
async function sendLine(pg, line) {
  await pg.click('[data-role="command"]');
  await pg.keyboard.press('Control+A'); await pg.keyboard.press('Delete');
  await pg.keyboard.insertText(line);
  await sleep(150);
  await pg.keyboard.press('Enter');
  await sleep(800);
}
async function startWork(pg) {
  await sendLine(pg, `@${NAME} ${PING}`);
  const w = await until(() => stateOf() === 'working', 60000);
  check('세션이 일하는 중(ping)', !!w, stateOf());
}
// 일하는 중에 보낸 두 번째 글은 대기 중 칩이 된다
async function queuedChip(pg, text) {
  await sendLine(pg, `@${NAME} ${text}`);
  const d = await until(() => active().find((x) => x.status === 'queued'), 10000, 500);
  const sel = d && `[data-delivery="${d.deliveryId}"]`;
  if (sel) await pg.waitForSelector(sel, { timeout: 10000 }).catch(() => {});
  return d;
}

async function edit() {
  const { app, page } = await launch({ log, env: { ...ENV }, args: ['--remote-debugging-port=9407', ...AWAKE] });
  try {
    await awayWin(app);
    await winSize(app, page, 1584, 921);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sleep(2500);
    await startWork(page);
    const d = await queuedChip(page, 'Reply with exactly: ORIGINAL-158');
    check('일하는 중에 보낸 글이 대기 중 칩이 된다', d && d.reason === 'working', d);
    const sel = `[data-delivery="${d.deliveryId}"]`;
    const btns = await page.$$eval(`${sel} button`, (bs) => bs.map((b) => b.textContent));
    check('대기 중 칩에 수정·취소 단추', btns.length === 2, btns);
    await shotTo(page, 'edit-1-queued');
    await page.click(`${sel} [data-action="delivery-edit"]`);
    await page.waitForSelector('[data-role="delivery-edit-input"]', { timeout: 5000 });
    const v0 = await page.$eval('[data-role="delivery-edit-input"]', (el) => el.value);
    const held = active().find((x) => x.deliveryId === d.deliveryId);
    check('수정을 누르면 전체 글이 글 칸에 들어오고 백엔드가 붙잡는다(editing)', v0 === 'Reply with exactly: ORIGINAL-158' && held && held.reason === 'editing', { v0, held });
    await page.$eval('[data-role="delivery-edit-input"]', (el) => { el.focus(); el.setSelectionRange(0, el.value.length); });
    await page.keyboard.insertText('Reply with exactly: EDITED-158');
    await shotTo(page, 'edit-2-editing');
    // 고치는 동안 세션이 한가해져도 보내지 않는다
    const idle = await until(() => stateOf() === 'ready', 120000, 2000);
    await sleep(6000);
    const still = active().find((x) => x.deliveryId === d.deliveryId);
    check('수정 중 세션이 한가해져도(ready) 보내지 않는다', !!idle && still && still.status === 'queued' && still.reason === 'editing', { idle, still });
    await shotTo(page, 'edit-3-idle-held');
    await page.focus('[data-role="delivery-edit-input"]');
    await page.keyboard.press('Enter');
    const fin = await until(() => { const r = call('delivery.list', { limit: 10 }).find((x) => x.deliveryId === d.deliveryId); return r && ['confirmed', 'unconfirmed', 'failed'].includes(r.status) ? r : null; }, 60000, 1000);
    check('저장하면 고친 글이 들어간다(제출 확인)', fin && fin.status === 'confirmed' && fin.text === 'Reply with exactly: EDITED-158', fin);
    await sleep(1000);
    await shotTo(page, 'edit-4-saved');
    const screen = await until(() => { try { const t = atrium('screen', NAME, '--text'); return /EDITED-158/.test(t) ? t : null; } catch { return null; } }, 60000, 3000);
    check('세션 화면에 고친 글(EDITED-158)이 보이고 원래 글은 없다', !!screen && !/ORIGINAL-158/.test(screen), screen ? screen.split('\n').filter((l) => /158/.test(l)).slice(-4) : null);
    // Esc는 되돌린다(놓고 원래 글 그대로 간다)
    await until(() => stateOf() === 'ready', 60000);
    await startWork(page);
    const e = await queuedChip(page, 'Reply with exactly: KEEP-158');
    await page.click(`[data-delivery="${e.deliveryId}"] [data-action="delivery-edit"]`);
    await page.waitForSelector('[data-role="delivery-edit-input"]', { timeout: 5000 });
    await page.keyboard.insertText(' changed');
    await page.keyboard.press('Escape');
    await sleep(800);
    const e1 = active().find((x) => x.deliveryId === e.deliveryId);
    const gone = !(await page.$('[data-role="delivery-edit-input"]'));
    check('Esc: 글 칸이 닫히고 붙잡기를 놓는다(원래 글, 까닭 working)', gone && e1 && e1.reason === 'working', { gone, e1 });
    // 이미 보낸 뒤 수정 시도: 백엔드가 already_sent로 거절한다(창은 그 문구를 알린다)
    const e2 = await until(() => { const r = call('delivery.list', { limit: 10 }).find((x) => x.deliveryId === e.deliveryId); return r && r.status === 'confirmed' ? r : null; }, 120000, 2000);
    let code = null;
    try { call('delivery.hold', { deliveryId: e.deliveryId }); } catch (x) { code = String(x.stderr || x.message); }
    check('보낸 뒤 수정은 already_sent로 거절', !!e2 && e2.text === 'Reply with exactly: KEEP-158' && /already/.test(code || ''), { status: e2 && e2.status, code: code && code.slice(0, 200) });
  } finally { await closeApp(app); }
}

async function openMission(pg) {
  if (await pg.$('[data-role="mission"]')) return;
  await pg.click('[data-action="mission-rail"]');
  await pg.waitForSelector('[data-role="mission"]', { timeout: 20000 });
  await sleep(1200);
}
async function closeMission(pg) { for (let i = 0; i < 3 && (await pg.$('[data-role="mission"]')); i++) { await pg.keyboard.press('Escape'); await sleep(400); } }
// 칩 줄과 명령줄 사이 간격, 가장자리
const geo = (pg) => pg.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) }; };
  const chips = r('.mt-deliveries'), bar = r('.mt-bottom .mt-cmd'), stage = r('.mt-stage');
  return { chips, bar, stage, gap: chips && bar ? bar.t - chips.b : null, inside: chips && bar ? chips.l >= bar.l - 1 && chips.r <= bar.r + 1 : null, center: chips && bar ? Math.abs((chips.l + chips.r) / 2 - (bar.l + bar.r) / 2) : null };
});
const sidebarOpen = (pg) => pg.evaluate(() => !!document.querySelector('[data-role=sidebar] .mt-sb2-row'));
async function setSidebar(pg, on) {
  if ((await sidebarOpen(pg)) === on) return;
  await pg.evaluate(() => document.activeElement && document.activeElement.blur());
  await pg.keyboard.press('Control+Shift+E'); await sleep(900);
}

async function map() {
  const { app, page } = await launch({ log, env: { ...ENV }, args: ['--remote-debugging-port=9407', ...AWAKE] });
  try {
    await awayWin(app);
    await winSize(app, page, 1584, 921);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sleep(2500);
    await until(() => stateOf() === 'ready', 120000);
    await startWork(page);
    const d = await queuedChip(page, 'Reply with exactly: MAP-158');
    check('대기 중 칩이 있다', !!d, d);
    const board = await geo(page);
    log(`판: ${JSON.stringify(board)}`);
    await shotTo(page, 'map-0-board');
    for (const [w, h] of [[1584, 921], [2576, 1380]]) {
      await winSize(app, page, w, h);
      for (const sb of [false, true]) {
        await closeMission(page);
        await setSidebar(page, sb);
        await openMission(page);
        await page.click('[data-role="command"]');
        await sleep(400);
        const g = await geo(page);
        check(`[맵 ${w} 사이드바 ${sb ? '열림' : '닫힘'}] 칩 줄이 명령줄 바로 위(간격 8px), 바 가장자리 안, 가운데`, g.gap != null && Math.abs(g.gap - 8) <= 1 && g.inside && g.center <= 2, { gap: g.gap, inside: g.inside, center: g.center, chips: g.chips, bar: g.bar, sidebar: await sidebarOpen(page) });
        await shotTo(page, `map-${w}-sb${sb ? 1 : 0}`);
      }
    }
    // 명령줄이 여러 줄로 커져도 따라간다
    await page.click('[data-role="command"]');
    await page.keyboard.insertText(`@${NAME} line one`);
    for (let i = 2; i <= 5; i++) { await page.keyboard.press('Shift+Enter'); await page.keyboard.insertText(`line ${i}`); }
    await sleep(400);
    const g5 = await geo(page);
    check('[맵] 명령줄이 다섯 줄로 커져도 칩 줄이 그 위에 붙는다', g5.gap != null && Math.abs(g5.gap - 8) <= 1 && g5.bar.b - g5.bar.t > 100, { gap: g5.gap, bar: g5.bar });
    await shotTo(page, 'map-multiline');
    await page.keyboard.press('Control+A'); await page.keyboard.press('Delete');
    // 맵 안에서 수정 칩
    await page.click(`[data-delivery="${d.deliveryId}"] [data-action="delivery-edit"]`).catch(() => {});
    await page.waitForSelector('[data-role="delivery-edit-input"]', { timeout: 5000 }).catch(() => {});
    await sleep(300);
    const ge = await geo(page);
    check('[맵] 수정 칩도 명령줄 위에 붙는다', ge.gap != null && Math.abs(ge.gap - 8) <= 1, { gap: ge.gap, chips: ge.chips });
    await shotTo(page, 'map-editing');
    await page.keyboard.press('Escape'); await sleep(500);
    // 판으로 돌아오면 판 모양 그대로
    await closeMission(page);
    await setSidebar(page, false);
    await winSize(app, page, 1584, 921);
    const back = await geo(page);
    check('판의 칩 줄 자리는 그대로(바 위 54px)', board.gap != null && back.gap === board.gap, { before: board.gap, after: back.gap });
    // 정리: 남은 대기 중 전달은 보내게 둔다
    await until(() => !active().length, 120000, 2000);
  } finally { await closeApp(app); }
}

async function stopBoard() {
  for (const s of call('session.list').filter((x) => /^p158-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
  await sleep(2000);
  try { log(atrium('terminal', 'stop', '--yes').slice(0, 200)); } catch (e) { log(`terminal stop ${e.message.slice(0, 120)}`); }
  try { log(atrium('backend', 'stop').slice(0, 200)); } catch (e) { log(`backend stop ${e.message.slice(0, 120)}`); }
}

try {
  if (WHAT === 'setup') await setupBoard();
  else if (WHAT === 'edit') await edit();
  else if (WHAT === 'map') await map();
  else if (WHAT === 'stop') await stopBoard();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, `p158-${WHAT}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
