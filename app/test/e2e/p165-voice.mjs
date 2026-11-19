// P165 창 시험: 음성 입력(마이크 단추 → 판 백엔드 → Soniox 실시간 전사 → 입력칸). 실제 Soniox에 붙는다(키는 백엔드가 환경 변수에서 읽는다).
// 마이크는 Chromium 가짜 장치(--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>)로 흉내 낸다.
// 소리 파일은 git 밖 experiments/p165/ko.wav(48kHz 16비트 한 채널, Windows 한국어 음성 합성으로 만든 한국어 문장). 파일은 되풀이된다.
// 판: 따로 띄운 개발용 판(atrium-dev-p165, 47934, backend/.dev)만 쓴다. 창의 원격 디버깅 포트 9414, 휴대폰 흉내 프록시 47996. 한 번에 한 창만(메모리).
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p165-voice.mjs <setup|pc|phone|stop>
//   pc: 명령줄 녹음(흐린 글 → 확정, 그림), 멈춘 뒤 손으로 @태그를 붙여 haiku 세션에 보냄, 녹음 중 손으로 태그를 넣고 Enter(녹음 끝 → 남은 글 → 보냄)
//   phone: 휴대폰 폭 웹(짝 맺은 기기, 흉내 tailscale serve)의 세션 입력칸 녹음 → 보냄
// 결과는 워크트리의 experiments/p165/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p165');
const CONVOS = path.join(OUT, 'convos');
const WAV = path.join(OUT, 'ko.wav');
const DIR = 'C:\\Workspace\\mtask-p165-a';
const NAME = 'p165-w';
const PORT = '47934', SIM = 47996;
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k];
process.env.MT_E2E_OUT = path.relative(path.join(REPO, 'experiments'), OUT);
const L = await import('./p59-lib.mjs');
const ENV = {
  ATRIUM_TERMINAL_SESSION: 'atrium-dev-p165', ATRIUM_HERDR_SESSION: 'atrium-dev-p165', ATRIUM_PORT: PORT,
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p165-none-',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: PORT,
  ATRIUM_WEB_HOSTS: `${L.NAME}:${SIM},localhost:${SIM}`,
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const log = logger(`p165-${WHAT}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const AWAKE = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
const MIC = ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`];
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
const KEY_RE = /SONIOX_API_KEY\s*=|Bearer\s+\S{8,}/;

async function setupBoard() {
  if (!fs.existsSync(WAV)) throw new Error(`소리 파일이 없다: ${WAV}`);
  fs.mkdirSync(DIR, { recursive: true });
  log(atrium('backend', 'start').trim().slice(0, 300));
  if (!sess()) log(atrium('--json', 'spawn', DIR, '--name', NAME, '--model', 'haiku').slice(0, 200));
  const st = await until(() => { const s = stateOf(); return s === 'ready' || s === 'trust_wait' ? s : null; }, 90000, 1500);
  log(`세션 상태 ${st}`);
  if (st === 'trust_wait') fs.writeFileSync(path.join(DEV, 'p165-need-trust.txt'), `${NAME} (${DIR}) 신뢰 질문이 떴다. 개발용 판(47934)에서 사람이 한 번 답해야 한다\n`);
  check('준비: haiku 세션이 ready', st === 'ready', st);
}

// 창의 명령줄 상태
const barState = (pg) => pg.evaluate(() => {
  const ta = document.querySelector('[data-role="command"]');
  const btn = document.querySelector('.mt-cmd [data-action="voice"]');
  const field = document.querySelector('.mt-cmd-field');
  const live = [...document.querySelectorAll('.mt-cmd-mirror .mt-cmd-live')].map((x) => x.textContent).join('');
  const liveColor = (() => { const x = document.querySelector('.mt-cmd-mirror .mt-cmd-live'); return x ? getComputedStyle(x).color : null; })();
  return { value: ta.value, state: btn && btn.dataset.state, voice: field && field.dataset.voice, live, liveColor, taColor: getComputedStyle(ta).color, dot: !!document.querySelector('.mt-cmd .mt-voice-dot'), caret: [ta.selectionStart, ta.selectionEnd], focused: document.activeElement === ta };
});

async function pc() {
  const { app, page } = await launch({ log, env: { ...ENV }, args: ['--remote-debugging-port=9414', ...AWAKE, ...MIC] });
  try {
    await awayWin(app);
    await winSize(app, page, 1584, 921);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sleep(2500);
    const field = '[data-role="command"]';
    const clear = async () => { await page.click(field); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); };
    const btn = '.mt-cmd [data-action="voice"]';
    const box = await page.$eval('.mt-cmd', (el) => { const r = el.getBoundingClientRect(); return { x: r.left - 20, y: r.top - 60, width: r.width + 40, height: r.height + 80 }; });

    // (1) 녹음: 흐린 글 → 확정
    await clear();
    const b0 = await barState(page);
    check('마이크 단추가 명령줄 왼쪽(마크 다음, 글칸 앞)에 있다', await page.evaluate(() => { const c = document.querySelector('.mt-cmd'); const kids = [...c.children]; const m = kids.findIndex((x) => x.classList.contains('mt-mark')), v = kids.findIndex((x) => x.dataset.action === 'voice'), f = kids.findIndex((x) => x.classList.contains('mt-cmd-field')); return m >= 0 && v === m + 1 && f === v + 1; }), b0);
    await shotTo(page, 'pc-0-idle', box);
    const t0 = Date.now();
    await page.click(btn);
    const lis = await until(async () => { const s = await barState(page); return s.state === 'listening' ? s : null; }, 10000, 100);
    check('누르면 연결 중 → 듣는 중(빨간 점 고정 표시)', lis && lis.dot && lis.voice === '1', { ms: Date.now() - t0, lis });
    const firstText = await until(async () => { const s = await barState(page); return s.value ? { ...s, ms: Date.now() - t0 } : null; }, 15000, 100);
    check('말하는 동안 글이 실시간으로 찍힌다', !!firstText, firstText);
    const liveShot = await until(async () => { const s = await barState(page); return s.live ? s : null; }, 15000, 80);
    if (liveShot) await shotTo(page, 'pc-1-listening-interim', box);
    check('미확정 글은 흐리게(겹이 그리고 textarea 글자는 투명)', liveShot && liveShot.live && /rgba\(0, 0, 0, 0\)|transparent/.test(liveShot.taColor), liveShot);
    const got = await until(async () => { const s = await barState(page); return /답해 주세요/.test(s.value) && !s.live ? s : null; }, 20000, 200);
    check('확정 글: 한국어 문장이 들어간다', got && /날씨/.test(got.value) && /받았다고/.test(got.value), got);
    await shotTo(page, 'pc-2-listening-final', box);
    await page.click(btn);
    const idle = await until(async () => { const s = await barState(page); return s.state === 'idle' ? s : null; }, 5000, 100);
    check('다시 누르면 끝(흐린 글 없음, 글자는 다시 textarea가 그림)', idle && !idle.live && !idle.voice && !idle.dot, idle);
    await shotTo(page, 'pc-3-stopped', box);

    // (2) 멈춘 뒤 손으로 @태그를 붙여 haiku 세션에 보낸다
    const spoken = idle.value.trim();
    await page.focus(field);
    await page.keyboard.press('Control+Home');
    await page.keyboard.insertText(`@${NAME} `);
    await page.keyboard.press('Control+End');
    await sleep(300);
    const tagged = await barState(page);
    check('손으로 붙인 @태그가 받는 세션이 된다', tagged.value === `@${NAME} ${spoken}` && (await page.$(`.mt-cmd-to-chip[data-to="${NAME}"]`)), tagged.value);
    await shotTo(page, 'pc-4-tagged', box);
    await page.keyboard.press('Enter');
    const d = await until(() => call('delivery.list', { limit: 5 }).find((x) => x.name === NAME && /날씨/.test(x.text || '')), 15000, 1000);
    check('haiku 세션에 들은 글이 간다', !!d, d && { status: d.status, text: d.text });
    const ans = await until(() => { try { const t = atrium('screen', NAME, '--text'); return /받았|received/i.test(t.split('답해 주세요').pop() || '') ? t : null; } catch { return null; } }, 120000, 3000);
    check('haiku 세션이 답한다', !!ans, ans ? ans.split('\n').filter((l) => l.trim()).slice(-6) : null);
    await shotTo(page, 'pc-5-answer');
    await until(() => stateOf() === 'ready', 60000, 1500);

    // (3) 녹음 중 손으로 앞에 태그를 넣고 Enter: 녹음을 끝내고 남은 확정 글을 받은 뒤 보낸다
    await clear();
    await page.click(btn);
    await until(async () => { const s = await barState(page); return s.value.length > 4 ? s : null; }, 15000, 100);
    await page.focus(field);
    await page.keyboard.press('Control+Home');
    await page.keyboard.insertText(`@${NAME} `);
    await page.keyboard.press('Control+End');
    await sleep(1500);
    const mid = await barState(page);
    check('녹음 중 손으로 넣은 태그가 깨지지 않고 들은 글은 그 뒤로 이어진다', mid.value.startsWith(`@${NAME} `) && mid.state === 'listening' && mid.value.length > NAME.length + 6, mid.value);
    await shotTo(page, 'pc-6-tag-while-listening', box);
    const tEnter = Date.now();
    await page.keyboard.press('Enter');
    const sent = await until(async () => { const s = await barState(page); return s.value === '' ? { ...s, ms: Date.now() - tEnter } : null; }, 5000, 50);
    check('녹음 중 Enter: 녹음을 끝내고(1초 안쪽) 보내고 입력칸을 비운다', sent && sent.state === 'idle' && sent.ms < 1600, sent);
    const d2 = await until(() => call('delivery.list', { limit: 5 }).find((x) => x.name === NAME && x.deliveryId !== d.deliveryId && /오늘|날씨|메시지|받았/.test(x.text || '')), 15000, 1000);
    check('Enter로 보낸 글이 태그 세션에 간다', !!d2, d2 && { text: d2.text });
    await sleep(1500);
    const after = await barState(page);
    check('보낸 뒤 들은 글이 다시 들어오지 않는다', after.value === '' && after.state === 'idle', after);

    // 키 값이 창·로그에 없다
    const logTxt = (() => { try { return fs.readFileSync(path.join(DEV, 'data', 'logs', 'backend.log'), 'utf8'); } catch { return ''; } })();
    const voiceLines = logTxt.split('\n').filter((l) => /voice v\d+/.test(l));
    check('백엔드 로그: 녹음 시작·끝만 적고 키·전사 글은 없다', voiceLines.length >= 2 && !KEY_RE.test(logTxt) && !voiceLines.some((l) => /날씨|메시지/.test(l)), voiceLines.slice(-4));
    const html = await page.evaluate(() => JSON.stringify(Object.keys(window.__mt.api.info || {})));
    check('창이 받은 백엔드 정보에 Soniox 키가 없다', !/soniox/i.test(html), html);
  } finally { await closeApp(app); }
}

async function phone() {
  const pw = await import('playwright');
  const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
  const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
  const sim = startTsSim({ listen: SIM, target: Number(PORT), name: L.NAME, login: L.LOGIN, keepOrigin: true }); sim.cfg.ip = L.LAPTOP_A;
  await sim.ready;
  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const chromeExe = (() => { try { return fs.readdirSync(pwDir).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse().map((x) => path.join(pwDir, x, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  const browser = await pw.chromium.launch({ headless: true, ...(chromeExe ? { executablePath: chromeExe } : {}), args: [...MIC, '--use-fake-ui-for-media-stream'] });
  try {
    const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, screen: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: SAFARI, locale: 'ko-KR', reducedMotion: 'reduce' });
    await ctx.grantPermissions(['microphone'], { origin: `http://localhost:${SIM}` });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[phone pageerror] ${e.message}`));
    await pg.goto(`http://localhost:${SIM}/`);
    await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
    await pg.fill('[data-field=pair-code]', call('device.code').code);
    await pg.click('[data-action=pair-submit]');
    await pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: 60000 });
    await sleep(1500);
    const id = sess().sessionId;
    await pg.evaluate((x) => window.__mtPhone.open(x), id);
    await pg.waitForSelector('[data-role=phone-input] [data-action=voice]', { timeout: 15000 });
    await sleep(800);
    const ph = () => pg.evaluate(() => { const ta = document.querySelector('[data-field=phone-text]'); const b = document.querySelector('[data-role=phone-input] [data-action=voice]'); const l = document.querySelector('[data-role=voice-live]'); return { value: ta.value, state: b.dataset.state, live: l ? l.textContent : null, liveOpacity: l ? getComputedStyle(l).opacity : null }; });
    await pg.screenshot({ path: path.join(OUT, 'phone-0-idle.png') });
    await pg.tap('[data-role=phone-input] [data-action=voice]');
    const live = await until(async () => { const s = await ph(); return s.state === 'listening' && s.live && !/듣는 중|Listening/.test(s.live) ? s : null; }, 20000, 80);
    if (live) await pg.screenshot({ path: path.join(OUT, 'phone-1-interim.png') });
    check('[휴대폰] 미확정 글은 입력칸 위 한 줄에 흐리게', live && Number(live.liveOpacity) < 1, live);
    const fin = await until(async () => { const s = await ph(); return /답해 주세요/.test(s.value) ? s : null; }, 25000, 200);
    check('[휴대폰] 확정 글이 입력칸에 들어간다', fin && /날씨/.test(fin.value), fin);
    await pg.screenshot({ path: path.join(OUT, 'phone-2-final.png') });
    await pg.tap('[data-role=phone-input] [data-action=voice]');
    const idle = await until(async () => { const s = await ph(); return s.state === 'idle' ? s : null; }, 5000, 100);
    check('[휴대폰] 다시 누르면 끝', !!idle && idle.live === null, idle);
    await pg.screenshot({ path: path.join(OUT, 'phone-3-stopped.png') });
    const before = call('delivery.list', { limit: 5 }).map((x) => x.deliveryId);
    await pg.tap('[data-action=phone-send]');
    const d = await until(() => call('delivery.list', { limit: 5 }).find((x) => x.name === NAME && !before.includes(x.deliveryId) && /날씨/.test(x.text || '')), 15000, 1000);
    check('[휴대폰] 보내기로 haiku 세션에 간다(짝 맺은 기기 연결 그대로)', !!d, d && { text: d.text });
    await sleep(800);
    await pg.screenshot({ path: path.join(OUT, 'phone-4-sent.png') });
    await ctx.close();
  } finally { await browser.close().catch(() => {}); await sim.close?.(); }
}

async function stopBoard() {
  for (const s of call('session.list').filter((x) => /^p165-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
  await sleep(2000);
  try { log(atrium('terminal', 'stop', '--yes').slice(0, 200)); } catch (e) { log(`terminal stop ${e.message.slice(0, 120)}`); }
  try { log(atrium('backend', 'stop').slice(0, 200)); } catch (e) { log(`backend stop ${e.message.slice(0, 120)}`); }
}

try {
  if (WHAT === 'setup') await setupBoard();
  else if (WHAT === 'pc') await pc();
  else if (WHAT === 'phone') await phone();
  else if (WHAT === 'stop') await stopBoard();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, `p165-${WHAT}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
