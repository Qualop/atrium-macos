// P283 창 시험: 터미널 링크(OSC 8 하이퍼링크·글 속 주소)와 마크다운(메모) 링크를 누르면 연다.
// - PC 창: 마우스를 올리면 밑줄·알림 글, 그냥 누르기는 열지 않음, Ctrl+누르기는 main의 shell.openExternal(시험에서는 가로채 기록만), file: 링크는 알림만,
//   Ctrl+누르기가 판의 노드 고르기로 새지 않음. 메모의 마크다운 링크는 그냥 누르기로 연다.
// - 원격 웹(휴대폰 흉내, Chromium·WebKit): 링크를 손가락으로 탭하면 새 탭. WebKit은 iOS 홈 화면 앱(navigator.standalone) 흉내도.
// 판: 따로 띄운 개발용 판(atrium-dev-p283, 48033, backend/.dev)만. 창의 원격 디버깅 포트 9514, 휴대폰 흉내 프록시 48034. 한 번에 창·브라우저 하나.
//   claude 단계: 진짜 Claude Code(haiku) 세션 cl에 마크다운 링크를 답하게 해, 이름만 보이는 링크(OSC 8)와 글 속 주소를 Ctrl+누르기로 연다.
// 실행: node app/test/e2e/p283-links.mjs <setup|pc|web|claude|stop> [round]   결과는 워크트리의 experiments/p283/<round>/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const TAG = process.argv[3] || 'round-1';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p283', TAG);
const CONVOS = 'C:\\Workspace\\mtask-p283-projects';
const F = 'C:\\Workspace\\mtask-p283-a';
const BOARD = 'atrium-dev-p283', PORT = '48033', DEBUG = '9514', SIM = 48034;
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_|MT_HERDR)/.test(k)) delete process.env[k];
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)) delete process.env[k];
process.env.MT_E2E_OUT = path.relative(path.join(REPO, 'experiments'), OUT);
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A } = L;
const ENV = {
  ATRIUM_TERMINAL_SESSION: BOARD, ATRIUM_HERDR_SESSION: BOARD, ATRIUM_PORT: PORT,
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p283-none-',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: PORT,
  ATRIUM_WEB_HOSTS: `${NAME}:${SIM},localhost:${SIM}`,
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, until, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const log = logger(`p283-${WHAT}-${TAG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const shot = (pg, name, clip) => pg.screenshot({ path: path.join(OUT, name + '.png'), ...(clip ? { clip } : {}) }).then(() => log('그림 ' + name + '.png')).catch((e) => log('스크린숏 실패 ' + name + ' ' + e.message.slice(0, 80)));
const LIVE = 'links';
const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
const chromeExe = (() => { try { return fs.readdirSync(pwDir).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse().map((x) => path.join(pwDir, x, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
const ESC = '\x1b';
const osc8 = (url, text) => ESC + ']8;;' + url + ESC + '\\' + text + ESC + ']8;;' + ESC + '\\';
const URLS = { osc: 'https://example.com/osc8-target', plain: 'https://example.com/plain/path?q=1', ko: 'https://example.com/ko-path', file: 'file:///C:/p283-not-opened.txt', memo: 'https://example.com/memo-link' };
const PRINT = [
  'OSC8 ' + osc8(URLS.osc, 'open-docs-here') + ' end',
  'TEXT see ' + URLS.plain + '. end',
  'KO ' + URLS.ko + '에서 보기',
  'FILE ' + osc8(URLS.file, 'local-file-link') + ' end',
].join('\n') + '\n';

async function setupBoard() {
  log(atrium('backend', 'start').trim().slice(0, 300));
  await sleep(1500);
  for (const s of call('session.list')) { try { atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log('옛 세션 끄기 실패', e.message.slice(0, 120)); } }
  fs.mkdirSync(F, { recursive: true }); fs.writeFileSync(path.join(F, 'README.md'), '# mtask-p283-a\n');
  fs.writeFileSync(path.join(F, 'links.js'), 'process.stdout.write(' + JSON.stringify(PRINT) + ');\n');
  call('workspace.open', { path: F, select: true });
  const r = call('session.spawn', { cwd: F, kind: 'shell', name: LIVE }); log('띄움', r.sessionId);
  await until(() => call('session.list').some((x) => x.name === LIVE && /shell_/.test(x.state)), 60000, 1500).catch(() => log('셸 준비 기다림 넘김'));
  await sleep(2500);
  try { call('session.send', { target: LIVE, text: 'cls; node links.js' }); } catch (e) { log('보내기 실패(창에서 다시 친다) ' + e.message.slice(0, 160)); }
  await sleep(2500);
  const m = call('memo.create', { workspace: F, text: '# Links\n\nRead [the memo link](' + URLS.memo + ') here.\n' });
  log('메모', m.memoId);
  check('장면: 셸 하나와 메모', call('session.list').length === 1 && !!m.memoId);
}

// 터미널 버퍼에서 글을 찾아 그 칸의 화면 자리(가운데)를 돌려준다
const FIND = ([sid, needle, nth]) => {
  const tm = window.__mt.terms.get(sid); if (!tm) return { err: 'no term' };
  const b = tm.buffer.active, screen = tm.element.querySelector('.xterm-screen').getBoundingClientRect();
  const cw = screen.width / tm.cols, ch = screen.height / tm.rows;
  for (let r = 0; r < tm.rows; r++) {
    const s = b.getLine(b.viewportY + r)?.translateToString(true) || '';
    const i = s.indexOf(needle);
    if (i >= 0) { const c = i + (nth || 2); return { x: screen.left + (c + 0.5) * cw, y: screen.top + (r + 0.5) * ch, row: r, col: c, line: s, rect: { x: Math.max(0, screen.left - 8), y: Math.max(0, screen.top + (r - 3) * ch), width: Math.min(screen.width + 16, 1200), height: ch * 8 } }; }
  }
  return { err: 'not found', lines: Array.from({ length: tm.rows }, (_, r) => b.getLine(b.viewportY + r)?.translateToString(true)).filter(Boolean).slice(-12) };
};

async function pc() {
  const sid = call('session.list').find((x) => x.name === LIVE).sessionId;
  for (const lang of ['ko', 'en']) {
    call('settings.set', { key: 'language', value: lang });
    const { app, page } = await launch({ log, env: { ...ENV }, args: ['--remote-debugging-port=' + DEBUG] });
    try {
      // 바깥 브라우저를 띄우지 않게 main의 shell.openExternal을 가로챈다
      const hooked = await app.evaluate(({ shell }) => { globalThis.__p283 = []; const f = async (u) => { globalThis.__p283.push(String(u)); }; try { shell.openExternal = f; } catch {} if (shell.openExternal !== f) Object.defineProperty(shell, 'openExternal', { configurable: true, writable: true, value: f }); return shell.openExternal === f; });
      check('[' + lang + '] openExternal 가로챔', hooked);
      const opened = () => app.evaluate(() => globalThis.__p283.slice());
      await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
      await page.waitForFunction((id) => window.__mt.terms.get(id), sid, { timeout: 30000 });
      await page.evaluate((id) => window.__mt.getState().navigateTo(id, { focusTerminal: true }), sid);
      await sleep(2500);
      let p = await page.evaluate(FIND, [sid, 'https://example.com/plain', 12]);
      if (p.err) { await page.evaluate((id) => window.__mt.api.call('terminal.input', { session: id, data: 'cls; node links.js\r' }), sid); await sleep(3000); p = await page.evaluate(FIND, [sid, 'https://example.com/plain', 12]); }
      check('[' + lang + '] 셸 화면에 링크 글', !p.err, p.err ? p : p.line);
      if (p.err) { await shot(page, 'pc-noterm-' + lang); continue; }
      // PowerShell 셸에서 node가 쓴 OSC 8은 판까지 오지 않는다(셀의 urlId 0, 기록 참고. Claude Code의 OSC 8은 온다: claude 단계).
      // 그래서 PC 단계의 OSC 8 처리기는 xterm에 직접 써 넣은 줄로 본다(셸이 쉬는 동안이라 덮이지 않는다)
      const osc = await page.evaluate(FIND, [sid, 'open-docs-here', 3]);
      const oscCarried = await page.evaluate(([id, row]) => { const tm = window.__mt.terms.get(id); const line = tm._core.buffer.lines.get(tm.buffer.active.viewportY + row); const cd = line.loadCell(5, new (tm._core.buffer.getNullCell().constructor)()); return !!(cd.extended && cd.extended.urlId); }, [sid, osc.row]);
      log('[' + lang + '] hc 프레임이 OSC 8을 실었나: ' + oscCarried);
      await page.evaluate(([id, a, b]) => { const tm = window.__mt.terms.get(id); tm.write('\x1b7\x1b[' + (tm.rows - 3) + ';1H\x1b[2K' + a + '\x1b[' + (tm.rows - 2) + ';1H\x1b[2K' + b + '\x1b8'); }, [sid, 'INJ ' + osc8(URLS.osc, 'open-docs-here') + ' end', 'INJ ' + osc8(URLS.file, 'local-file-link') + ' end']);
      await sleep(400);
      p = await page.evaluate(FIND, [sid, 'INJ open-docs-here', 7]);
      check('[' + lang + '] 써 넣은 OSC 8 링크 글', !p.err, p.err ? p : p.line);
      // OSC 8: 올리기 → 밑줄·알림 글
      await page.mouse.move(p.x - 30, p.y + 40); await sleep(200);
      await page.mouse.move(p.x, p.y); await sleep(600);
      let hint = await page.evaluate(() => { const h = document.querySelector('[data-role=link-hint]'); return h ? { text: h.textContent, title: h.title } : null; });
      check('[' + lang + '] OSC 8 링크에 올리면 알림 글', hint && /Ctrl/.test(hint.text) && hint.title === 'https://example.com/osc8-target', hint);
      await shot(page, 'pc-hover-osc8-' + lang, p.rect);
      // 그냥 누르기: 열지 않는다
      await page.mouse.click(p.x, p.y); await sleep(700);
      check('[' + lang + '] OSC 8 그냥 누르기는 열지 않음', (await opened()).length === 0, await opened());
      // Ctrl+누르기: 연다, 노드 고르기로 새지 않음
      const selBefore = await page.evaluate(() => document.querySelectorAll('.react-flow__node.selected').length);
      await page.mouse.move(p.x, p.y); await sleep(300);
      await page.keyboard.down('Control'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Control'); await sleep(800);
      const selAfter = await page.evaluate(() => document.querySelectorAll('.react-flow__node.selected').length);
      check('[' + lang + '] OSC 8 Ctrl+누르기 → openExternal(주소 그대로)', JSON.stringify(await opened()) === JSON.stringify([URLS.osc]), await opened());
      check('[' + lang + '] Ctrl+누르기가 판의 노드 고르기로 새지 않음', selAfter === selBefore, { selBefore, selAfter });
      // 글 속 주소
      const q = await page.evaluate(FIND, [sid, 'https://example.com/plain', 12]);
      await page.mouse.move(q.x, q.y + 30); await sleep(150); await page.mouse.move(q.x, q.y); await sleep(600);
      hint = await page.evaluate(() => { const h = document.querySelector('[data-role=link-hint]'); return h ? { text: h.textContent, title: h.title } : null; });
      check('[' + lang + '] 글 속 주소에 올리면 알림 글(끝 마침표 뺀 주소)', hint && hint.title === URLS.plain, hint);
      await shot(page, 'pc-hover-text-' + lang, q.rect);
      await page.keyboard.down('Control'); await page.mouse.click(q.x, q.y); await page.keyboard.up('Control'); await sleep(800);
      check('[' + lang + '] 글 속 주소 Ctrl+누르기 → openExternal', (await opened())[1] === URLS.plain, await opened());
      const k = await page.evaluate(FIND, [sid, 'https://example.com/ko', 10]);
      await page.mouse.move(k.x, k.y + 30); await sleep(150); await page.mouse.move(k.x, k.y); await sleep(500);
      await page.keyboard.down('Control'); await page.mouse.click(k.x, k.y); await page.keyboard.up('Control'); await sleep(800);
      check('[' + lang + '] 한글 붙은 주소는 한글 앞까지', (await opened())[2] === URLS.ko, await opened());
      // file: 링크는 열지 않고 알림
      const f = await page.evaluate(FIND, [sid, 'INJ local-file-link', 7]);
      await page.mouse.move(f.x, f.y + 30); await sleep(150); await page.mouse.move(f.x, f.y); await sleep(500);
      await page.keyboard.down('Control'); await page.mouse.click(f.x, f.y); await page.keyboard.up('Control'); await sleep(700);
      const toasts = await page.evaluate(() => window.__mt.getState().toasts.map((t) => t.text));
      check('[' + lang + '] file: 링크는 열지 않고 알림', (await opened()).length === 3 && toasts.some((t) => t.includes('file:')), { opened: await opened(), toasts });
      await shot(page, 'pc-file-toast-' + lang);
      check('[' + lang + '] 확인 창(confirm) 없이 끝남', true);
      // 메모(마크다운) 링크: 그냥 누르기로 연다
      await page.mouse.move(5, 5);
      const a = await page.$('.mt-md a[data-link]');
      if (!a) check('[' + lang + '] 메모 링크가 보인다', false);
      else {
        await page.evaluate(() => { const e = document.querySelector('.mt-md a[data-link]'); e.scrollIntoView({ block: 'center' }); });
        const rf = await page.evaluate(() => { const n = document.querySelector('.mt-md a[data-link]').closest('.react-flow__node'); return n && n.getAttribute('data-id'); });
        await page.evaluate((id) => { const st = window.__mt.getState(); if (st.navigateTo) st.navigateTo(id, { viewOnly: true }); }, rf).catch(() => {});
        await sleep(1200);
        const title = await a.getAttribute('title');
        await a.hover(); await sleep(300);
        const box = await a.boundingBox();
        if (box) await shot(page, 'pc-memo-link-' + lang, { x: Math.max(0, box.x - 120), y: Math.max(0, box.y - 80), width: 480, height: 200 });
        await a.click(); await sleep(800);
        check('[' + lang + '] 메모 링크 누르기 → openExternal, 제목 글 = 여는 안내', (await opened()).includes(URLS.memo) && /open|엽니다/.test(title), { opened: await opened(), title });
      }
      const nav = await page.evaluate(() => location.href);
      check('[' + lang + '] 판 창은 그 자리(다른 곳으로 가지 않음)', /dist\/index\.html|^file:/.test(nav), nav);
    } finally { await closeApp(app); }
  }
}

async function pair(pg) {
  await pg.goto('http://localhost:' + SIM + '/');
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await pg.fill('[data-field=pair-code]', call('device.code').code);
  await pg.click('[data-action=pair-submit]');
  await pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: 60000 });
  await sleep(1200);
}

async function web() {
  const pw = await import('playwright');
  const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
  const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
  const sim = startTsSim({ listen: SIM, target: Number(PORT), name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const sid = call('session.list').find((x) => x.name === LIVE).sessionId;
  call('settings.set', { key: 'language', value: 'ko' });
  const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  try {
    for (const [engine, standalone] of [['chromium', false], ['webkit', false], ['webkit', true]]) {
      const tag = engine + (standalone ? '-standalone' : '');
      const browser = await pw[engine].launch({ headless: true, ...(engine === 'chromium' && chromeExe ? { executablePath: chromeExe } : {}) });
      try {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: engine === 'chromium', hasTouch: true, userAgent: SAFARI, locale: 'ko-KR', reducedMotion: 'reduce' });
        if (standalone) await ctx.addInitScript(() => { try { Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true }); } catch {} });
        const pg = await ctx.newPage();
        const errs = [];
        pg.on('pageerror', (e) => { errs.push(e.message); log('[' + tag + ' pageerror] ' + e.message); });
        await pair(pg);
        await pg.evaluate((id) => window.__mtPhone.open(id), sid);
        await pg.waitForFunction((id) => window.__mt.terms.get(id), sid, { timeout: 30000 });
        await sleep(2500);
        let p = await pg.evaluate(FIND, [sid, 'https://example.com/ko', 10]);
        if (p.err) { await pg.evaluate((id) => window.__mt.api.call('terminal.input', { session: id, data: 'cls; node links.js\r' }), sid); await sleep(3000); p = await pg.evaluate(FIND, [sid, 'https://example.com/ko', 10]); }
        check('[' + tag + '] 휴대폰 세션 화면에 링크 글', !p.err, p.err ? p : p.line);
        await shot(pg, 'web-' + tag);
        if (!p.err) {
          const popup = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
          await pg.touchscreen.tap(p.x, p.y);
          const np = await popup;
          let url = null; if (np) { await np.waitForLoadState('commit').catch(() => {}); url = np.url(); await np.close().catch(() => {}); }
          const stay = pg.url();
          check('[' + tag + '] 글 속 주소(한글 붙음) 탭 → 새 탭, 판 탭은 그대로', url === URLS.ko && /localhost:48034/.test(stay), { url, stay });
          const q = await pg.evaluate(FIND, [sid, 'https://example.com/plain', 12]);
          const popup2 = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
          await pg.touchscreen.tap(q.x, q.y);
          const np2 = await popup2;
          let url2 = null; if (np2) { await np2.waitForLoadState('commit').catch(() => {}); url2 = np2.url(); await np2.close().catch(() => {}); }
          check('[' + tag + '] 글 속 주소 탭 → 새 탭', url2 === URLS.plain, url2);
        }
        check('[' + tag + '] 페이지 오류 없음', errs.length === 0, errs);
        await ctx.close();
      } finally { await browser.close(); }
    }
  } finally { sim.close && sim.close(); }
}

async function claude() {
  let cl = call('session.list').find((x) => x.name === 'cl');
  if (!cl) {
    call('session.spawn', { cwd: F, kind: 'claude', name: 'cl', model: 'haiku' });
    await until(() => call('session.list').some((x) => x.name === 'cl' && x.state === 'ready'), 90000, 2000).catch(() => log('cl 준비 기다림 넘김'));
    cl = call('session.list').find((x) => x.name === 'cl');
  }
  atrium('send', '@cl', 'Reply with exactly this markdown and nothing else (no tools): See [Example docs](https://example.com/docs) and https://example.com/raw/page for details.');
  await until(() => { const s = call('session.list').find((x) => x.name === 'cl'); return s && s.state !== 'working' && /example\.com/.test(s.lastAnswer || ''); }, 120000, 2000).catch(() => log('cl 답 기다림 넘김'));
  const sid = cl.sessionId;
  const { app, page } = await launch({ log, env: { ...ENV }, args: ['--remote-debugging-port=' + DEBUG] });
  try {
    await app.evaluate(({ shell }) => { globalThis.__p283 = []; Object.defineProperty(shell, 'openExternal', { configurable: true, writable: true, value: async (u) => { globalThis.__p283.push(String(u)); } }); });
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForFunction((id) => window.__mt.terms.get(id), sid, { timeout: 30000 });
    await page.evaluate((id) => window.__mt.getState().navigateTo(id, { focusTerminal: true }), sid);
    await sleep(3000);
    for (const [needle, nth, want] of [['See Example docs', 6, 'https://example.com/docs'], ['https://example.com/raw', 6, 'https://example.com/raw/page']]) {
      const p = await page.evaluate(FIND, [sid, needle, nth]);
      if (p.err) { check('[claude] 화면에 ' + needle, false, p); continue; }
      await page.mouse.move(p.x, p.y + 30); await sleep(150); await page.mouse.move(p.x, p.y); await sleep(600);
      const hint = await page.evaluate(() => { const h = document.querySelector('[data-role=link-hint]'); return h ? h.title : null; });
      await shot(page, 'claude-hover-' + needle.replace(/\W+/g, '_'), p.rect);
      await page.keyboard.down('Control'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Control'); await sleep(800);
      const opened = await app.evaluate(() => globalThis.__p283.slice());
      check('[claude] ' + needle + ': 올리면 주소 알림, Ctrl+누르기 → openExternal', hint === want && opened[opened.length - 1] === want, { hint, opened });
    }
  } finally { await closeApp(app); }
}

async function stopBoard() {
  try { for (const m of call('memo.list')) call('memo.delete', { memo: m.memoId }); } catch (e) { log('memo ' + e.message.slice(0, 120)); }
  try { for (const s of call('session.list')) atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log('kill ' + e.message.slice(0, 120)); }
  try { log(atrium('terminal', 'stop', '--yes').slice(0, 200)); } catch (e) { log('terminal stop ' + e.message.slice(0, 120)); }
  try { log(atrium('backend', 'stop').slice(0, 200)); } catch (e) { log('backend stop ' + e.message.slice(0, 120)); }
}

try {
  if (WHAT === 'setup') await setupBoard();
  else if (WHAT === 'pc') await pc();
  else if (WHAT === 'web') await web();
  else if (WHAT === 'claude') await claude();
  else if (WHAT === 'stop') await stopBoard();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, 'p283-' + WHAT + '.json'), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log('결과 ' + (results.length - bad.length) + '/' + results.length + ' 통과' + (bad.length ? ' 실패: ' + bad.map((b) => b.name).join(', ') : ''));
  process.exit(bad.length ? 1 : 0);
}
