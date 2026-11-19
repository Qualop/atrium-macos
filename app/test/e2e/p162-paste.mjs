// P162 창 시험: 데스크톱 창의 붙여 넣기.
// (1) 탐색기에서 복사한 파일(PowerShell Set-Clipboard -Path, 시험 폴더의 파일과 폴더)을 명령줄에 붙이면 경로가 들어간다(폴더는 빠진다)
// (2) 그림을 클립보드에 올려 붙이면 [Image 1] 칩이 생기고, 마우스를 올리면 미리보기, Backspace로 통째로 지운다.
//     다시 붙여 haiku 세션에 보내면 칩이 그림 경로로 바뀌어 가고, 세션이 그림을 열어 색을 답한다
// (3) 세션 노드(터미널)에 그림을 붙이면 경로가 들어가 Claude Code가 그림으로 붙인다
// 판: 따로 띄운 개발용 판(atrium-dev-p162, 47931, backend/.dev)만 쓴다. 창의 원격 디버깅 포트 9411. 한 번에 한 창만(메모리).
// 클립보드는 이 PC의 것을 쓴다(시험 폴더의 파일과 시험이 그린 그림만 올린다).
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p162-paste.mjs <setup|paste|stop>
// 결과는 워크트리의 experiments/p162/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p162');
const CONVOS = path.join(REPO, 'experiments', 'p162', 'convos');
const DIR = 'C:\\Workspace\\mtask-p162-a';
const NAME = 'p162-w';
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k];
process.env.MT_E2E_OUT = path.relative(path.join(REPO, 'experiments'), OUT);
const ENV = {
  ATRIUM_TERMINAL_SESSION: 'atrium-dev-p162', ATRIUM_HERDR_SESSION: 'atrium-dev-p162', ATRIUM_PORT: '47931',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p162-none-',
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const log = logger(`p162-${WHAT}`);
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
async function until(fn, ms, step = 1000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step); } }
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-STA', '-Command', cmd], { encoding: 'utf8', timeout: 30000 });
const FILES = [path.join(DIR, 'a.txt'), path.join(DIR, 'b c.txt')];
const FOLDER = path.join(DIR, 'sub dir');
const clipFiles = (list) => ps(`Set-Clipboard -Path ${list.map((p) => `'${p}'`).join(',')}`);
// 주황 바탕의 그림(가운데 파란 네모)을 클립보드에 올린다
const clipImage = () => ps("Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=New-Object System.Drawing.Bitmap 320,200; $g=[System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::Orange); $g.FillRectangle([System.Drawing.Brushes]::Blue,110,60,100,80); [System.Windows.Forms.Clipboard]::SetImage($b)");
const cmdValue = (pg) => pg.$eval('[data-role="command"]', (el) => el.value);

async function setupBoard() {
  fs.mkdirSync(FOLDER, { recursive: true });
  for (const f of FILES) fs.writeFileSync(f, 'p162\n');
  log(atrium('backend', 'start').trim().slice(0, 300));
  if (!sess()) log(atrium('--json', 'spawn', DIR, '--name', NAME, '--model', 'haiku').slice(0, 200));
  const st = await until(() => { const s = stateOf(); return s === 'ready' || s === 'trust_wait' ? s : null; }, 90000, 1500);
  log(`세션 상태 ${st}`);
  if (st === 'trust_wait') fs.writeFileSync(path.join(DEV, 'p162-need-trust.txt'), `${NAME} (${DIR}) 신뢰 질문이 떴다. 개발용 판(47931)에서 사람이 한 번 답해야 한다\n`);
  check('준비: haiku 세션이 ready', st === 'ready', st);
}

async function paste() {
  const { app, page } = await launch({ log, env: { ...ENV }, args: ['--remote-debugging-port=9411', ...AWAKE] });
  try {
    await awayWin(app);
    await winSize(app, page, 1584, 921);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sleep(2500);
    const field = '[data-role="command"]';
    const clear = async () => { await page.click(field); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); };

    // (1) 파일 둘과 폴더 하나
    await clear();
    await page.keyboard.insertText(`@${NAME} 봐`);
    clipFiles([...FILES, FOLDER]);
    await page.keyboard.press('Control+V');
    const v1 = await until(async () => { const v = await cmdValue(page); return /a\.txt/.test(v) ? v : null; }, 5000, 200);
    check('파일 붙여 넣기: 두 파일 경로가 들어가고(빈칸 든 것은 따옴표) 폴더는 빠진다', v1 === `@${NAME} 봐 ${FILES[0]} "${FILES[1]}" `, v1);
    await shotTo(page, 'p162-1-files');
    // 폴더만
    await clear();
    clipFiles([FOLDER]);
    await page.keyboard.press('Control+V');
    await sleep(800);
    check('폴더만 붙이면 아무것도 넣지 않는다', (await cmdValue(page)) === '', await cmdValue(page));
    // 글은 그대로 글
    await clear();
    ps("Set-Clipboard -Value 'plain p162 text'");
    await page.keyboard.press('Control+V');
    await sleep(500);
    check('글은 지금처럼 글로 붙는다', (await cmdValue(page)) === 'plain p162 text', await cmdValue(page));

    // (2) 그림 칩
    await clear();
    await page.keyboard.insertText(`@${NAME} `);
    clipImage();
    await page.keyboard.press('Control+V');
    const v2 = await until(async () => { const v = await cmdValue(page); return /\[Image 1\]/.test(v) ? v : null; }, 5000, 200);
    check('그림 붙여 넣기: [Image 1] 칩이 들어간다', v2 === `@${NAME} [Image 1] `, v2);
    const chip = await page.$eval('.mt-cmd-img[data-img="1"]', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, bg: getComputedStyle(el).backgroundColor }; }).catch(() => null);
    check('겹에 칩 바탕이 그려진다', chip && chip.w > 20, chip);
    const files = fs.readdirSync(path.join(DEV, 'data', 'uploads')).filter((f) => /pasted\.png$/.test(f));
    check('그림이 개발용 판 데이터 폴더 uploads/에 PNG로 있다', files.length >= 1, files);
    if (chip) await page.mouse.move(chip.x, chip.y);
    const pv = await page.waitForSelector('[data-role="img-preview"] img', { timeout: 3000 }).then(() => true, () => false);
    check('칩에 마우스를 올리면 미리보기', pv);
    await shotTo(page, 'p162-2-chip-preview');
    await page.mouse.move(20, 20);
    // Backspace(칩 뒤 빈칸 다음 커서)로 통째로 지우기
    await page.focus(field);
    await page.$eval(field, (el) => el.setSelectionRange(el.value.length, el.value.length));
    await page.keyboard.press('Backspace');
    await sleep(300);
    check('Backspace로 칩을 통째로 지운다', (await cmdValue(page)) === `@${NAME} `, await cmdValue(page));
    // 다시 붙여 보낸다
    clipImage();
    await page.keyboard.press('Control+V');
    await until(async () => /\[Image 1\]/.test(await cmdValue(page)), 5000, 200);
    await page.keyboard.insertText('Open this image file and reply with only its main background color in one English word.');
    await shotTo(page, 'p162-3-before-send');
    await page.keyboard.press('Enter');
    await sleep(1500);
    const d = await until(() => call('delivery.list', { limit: 5 }).find((x) => x.name === NAME && /pasted\.png/.test(x.text || '')), 15000, 1000);
    check('보낼 때 칩이 그림 파일 경로로 바뀐다', d && !/\[Image 1\]/.test(d.text) && d.text.includes(path.join(DEV, 'data', 'uploads')), d && d.text);
    const ans = await until(() => { try { const t = atrium('screen', NAME, '--text'); return /orange/i.test(t.split('background color').pop() || '') ? t : null; } catch { return null; } }, 120000, 3000);
    check('haiku 세션이 그림을 열어 색(orange)을 답한다', !!ans, ans ? ans.split('\n').filter((l) => l.trim()).slice(-8) : null);
    await shotTo(page, 'p162-4-answer');

    // (3) 세션 노드(터미널)에 그림 붙이기
    await until(() => stateOf() === 'ready', 60000, 1500);
    const sid = sess().sessionId;
    const focused = await page.evaluate((id) => { const ta = document.querySelector(`.react-flow__node[data-id="${id}"] .xterm-helper-textarea`); if (!ta) return false; ta.focus(); return document.activeElement === ta; }, sid);
    clipImage();
    if (focused) await page.keyboard.press('Control+V');
    const scr = await until(() => { try { const t = atrium('screen', NAME, '--text'); const tail = t.split('\n').filter((l) => l.trim()).slice(-6).join('\n'); return /\[Image #\d+\]|❯.*pasted\.png/.test(tail) ? t : null; } catch { return null; } }, 15000, 1500);
    check('세션 노드에 그림을 붙이면 경로가 들어가 Claude Code가 그림으로 붙인다', focused && !!scr, { focused, tail: scr ? scr.split('\n').filter((l) => l.trim()).slice(-4) : null });
    await shotTo(page, 'p162-5-terminal');
  } finally { await closeApp(app); }
}

async function stopBoard() {
  for (const s of call('session.list').filter((x) => /^p162-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
  await sleep(2000);
  try { log(atrium('terminal', 'stop', '--yes').slice(0, 200)); } catch (e) { log(`terminal stop ${e.message.slice(0, 120)}`); }
  try { log(atrium('backend', 'stop').slice(0, 200)); } catch (e) { log(`backend stop ${e.message.slice(0, 120)}`); }
}

try {
  if (WHAT === 'setup') await setupBoard();
  else if (WHAT === 'paste') await paste();
  else if (WHAT === 'stop') await stopBoard();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, `p162-${WHAT}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
