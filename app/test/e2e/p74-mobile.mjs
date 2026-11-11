// P74 창 시험: 휴대폰 세로 화면과 홈 화면 웹 앱(PWA)을 Playwright 휴대폰 흉내(iPhone 크기 390×844, 터치, 세로·가로)로 본다.
//   휴대폰: 브라우저 문맥(isMobile, hasTouch) → ts-sim(47895, X-Forwarded-For 100.64.0.2 = laptop-a 자리) → 백엔드(47894)
// 판은 가짜 tailscale(p49-fake-tailscale.mjs)을 읽는다. 따로 띄운 개발용 판(atrium-dev-p74, 47894, backend/.dev)만 쓴다. PC 창은 띄우지 않고
// 짝 맺기 코드와 설정은 이 판의 CLI(판 API 토큰, 이 PC의 프로세스)로 한다.
// 흐름: 짝 맺기(패스키 끔) → 목록(응답 필요 → 작업 중 → 프로젝트별) → 셸 열기·글 보내기·키 줄(↑ ⏎) → 에이전트에게 보내기 → 승인 카드 "허용"
//   → 손가락 스크롤 → 새 세션(런처·프로젝트) → 연결 끊김과 다시 붙기(PC 끊기, 오프라인) → 가로로 돌리면 보드 화면
//   → 서비스 워커·매니페스트(설치 조건, 캐시하지 않는 주소, 오프라인 껍데기) → 홈 화면 앱 흉내(쿠키를 나누지 않는 새 문맥): 패스키 끔은 새 코드, 패스키 켬은 Safari의 패스키로
// 결과는 experiments/p74/(git 밖). 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p74-mobile.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p74');
const CONVOS = path.join(OUT, 'convos');
const PROJ = process.env.P74_PROJ || 'C:\\Workspace\\mtask-p74-proj';
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A, baseOf } = L;
const B0 = L.board({ session: 'atrium-dev-p74', port: 47894, sim: 47895, sim2: 47896 });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p74',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim}`,
  ATRIUM_REMOTE_QUIET_MS: '4000',
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true }); fs.mkdirSync(PROJ, { recursive: true });
const { logger, sleep, until } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
const { chromium } = await import('playwright');

const log = logger('p74-mobile');
const BASE = baseOf(B0.sim);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`); };
const wshot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); log(`스크린숏 experiments/p74/${name}.png`); };
const viaSim = (p, { method = 'GET', headers = {} } = {}) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port: B0.sim, path: p, method, headers: { host: `${NAME}:${B0.sim}`, ...headers } }, (resp) => { const ch = []; resp.on('data', (d) => ch.push(d)); resp.on('end', () => res({ status: resp.statusCode, headers: resp.headers, text: Buffer.concat(ch).toString() })); });
  r.on('error', rej); r.end();
});
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const screenText = (n) => atrium('screen', n, '--text');
const PHONE = { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };

async function phone(browser, label, { standalone = false } = {}) {
  const ctx = await browser.newContext(PHONE);
  if (standalone) await ctx.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); }); // iOS 홈 화면 앱 흉내
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`[${label} pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[${label} console.error] ${m.text().slice(0, 200)}`); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return { ctx, page, cdp, authenticatorId };
}
// P76: 휴대폰의 기본 화면은 보드 화면이다. 목록 화면은 보드 화면의 목록 단추로 간다(고른 것은 이 브라우저에 남는다)
const phoneOpen = async (pg, ms = 60000) => {
  await pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open' && !!document.querySelector('[data-role=phone-list], [data-role=phone-session], [data-action=phone-list-open]'), null, { timeout: ms });
  if (!(await pg.$('[data-role=phone-list], [data-role=phone-session]'))) { await pg.tap('[data-action=phone-list-open]'); await pg.waitForSelector('[data-role=phone-list]', { timeout: 10000 }); }
};
const splashGone = (pg) => pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
const newCode = () => call('device.code').code;

let browser, sim, proc = [];
try {
  // ---- 0. 판: 백엔드(이 판의 herdr 서버도 띄운다)와 시험 세션 ----
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  for (const s of sessions()) if (/^p74-/.test(s.name)) atrium('kill', s.sessionId, '--yes', '--delete');
  sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const spawn = (...a) => JSON.parse(atrium('--json', 'spawn', PROJ, ...a));
  const shellR = spawn('--kind', 'shell', '--name', 'p74-shell');
  const idleR = spawn('--model', 'haiku', '--name', 'p74-idle');
  const askR = spawn('--model', 'haiku', '--name', 'p74-ask', '--prompt', 'Use the Bash tool to run exactly this one command and nothing else: echo p74-approved > p74-approved.txt');
  check('시험 세션을 띄움(셸, 대기 에이전트, 승인 받을 에이전트), 신뢰 대화상자 없음', shellR.sessionId && idleR.sessionId && askR.sessionId && !(idleR.trust && idleR.trust.needsTrust), { trust: idleR.trust });
  await until(() => { const s = byName('p74-ask'); return s && s.state === 'waiting' && s.ask && s.ask.kind === 'permission'; }, 150000, 1000);
  await until(() => { const s = byName('p74-idle'); return s && s.state === 'ready'; }, 120000, 1000);
  check('승인 받을 에이전트가 Bash 승인을 기다린다', byName('p74-ask').ask.tool === 'Bash', byName('p74-ask').ask.summary);

  // 전체 Chromium(새 headless: 서비스 워커·설치 가능성 검사). 받아 둔 것이 Playwright가 기대하는 판과 다르면 P74_CHROME 또는 받아 둔 chromium-*을 쓴다(새로 내려받지 않는다)
  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const found = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  const exe = process.env.P74_CHROME || found || undefined;
  log(`chromium ${exe ? path.basename(path.dirname(path.dirname(exe))) : '(playwright default)'}`);
  browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : { channel: 'chromium' }), args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const A = await phone(browser, 'phone');
  const pA = A.page;
  const responses = [];
  pA.on('response', (r) => { try { const u = new URL(r.url()); responses.push({ path: u.pathname, sw: r.fromServiceWorker(), status: r.status() }); } catch {} });

  // ---- 1. 짝 맺기(패스키 끔) ----
  await pA.goto(`${BASE}/`);
  await pA.waitForSelector('[data-role=pair]', { timeout: 20000 });
  const pairBox = await pA.evaluate(() => { const c = document.querySelector('.mt-pair-card').getBoundingClientRect(); const i = document.querySelector('[data-field=pair-code]').getBoundingClientRect(); return { cardW: c.width, docW: document.documentElement.scrollWidth, inputH: i.height, font: getComputedStyle(document.querySelector('[data-field=pair-code]')).fontSize, standalone: !!document.querySelector('[data-role=pair-standalone]') }; });
  check('짝 맺기 화면이 휴대폰 폭에 맞는다(가로 넘침 없음, 입력칸 44px·16px 이상, Safari에서는 홈 화면 안내 없음)', pairBox.docW <= 390 && pairBox.cardW <= 390 && pairBox.inputH >= 44 && parseFloat(pairBox.font) >= 16 && !pairBox.standalone, pairBox);
  await wshot(pA, '01-pair');
  await pA.fill('[data-field=pair-code]', newCode());
  await pA.tap('[data-action=pair-submit]');
  await phoneOpen(pA); await splashGone(pA);
  const devA = call('device.list').devices.find((d) => d.tsNode && d.tsNode.name === 'laptop-a');
  check('기기 이름을 휴대폰에서 iOS로 짐작한다(iPhone UA의 "like Mac OS X"에 속지 않는다)', devA && /iOS/.test(devA.name), devA && devA.name);
  check('코드로 짝 맺으면 휴대폰 화면 목록(Tailscale 기기에 묶임)', devA && devA.tsNode && devA.tsNode.name === 'laptop-a' && !!(await pA.$('[data-role=phone-list]')), devA && { name: devA.name, node: devA.tsNode });

  // ---- 2. 목록 ----
  await pA.waitForSelector('[data-section=needs] [data-session]', { timeout: 20000 });
  const order = await pA.evaluate(() => [...document.querySelectorAll('[data-role=phone-scroll] section')].map((s) => ({ sec: s.dataset.section, rows: [...s.querySelectorAll('[data-session]')].map((r) => r.querySelector('.mt-ph-name').textContent) })));
  const flat = order.flatMap((s) => s.rows);
  check('목록: 응답 필요(p74-ask)가 맨 위, 그다음 프로젝트 묶음에 셸과 대기 에이전트', order[0].sec === 'needs' && order[0].rows[0] === 'p74-ask' && flat.includes('p74-shell') && flat.includes('p74-idle'), order);
  const rowA = await pA.evaluate(() => { const r = document.querySelector('[data-section=needs] [data-session]'); const b = r.getBoundingClientRect(); return { h: b.height, line: r.querySelector('.mt-ph-line').textContent, tone: r.dataset.tone }; });
  check('응답 필요 줄: 상태 점(waiting), 묻는 것 한 줄, 누를 높이 44px 이상', rowA.tone === 'waiting' && /Bash/.test(rowA.line) && rowA.h >= 44, rowA);
  const foot = await pA.evaluate(() => { const b = document.querySelector('[data-action=phone-next]').getBoundingClientRect(); return { top: b.top, h: b.height, vh: innerHeight }; });
  check('"다음 응답 필요"가 엄지가 닿는 아래쪽에 있다', foot.top > foot.vh * 0.8 && foot.h >= 44, foot);
  await wshot(pA, '02-list');
  // 프로젝트 접기·펴기
  await pA.tap('[data-section=repo] [data-action=phone-fold]');
  const folded = await pA.evaluate(() => document.querySelector('[data-section=repo]').classList.contains('folded') && !document.querySelector('[data-section=repo] [data-session]'));
  await pA.tap('[data-section=repo] [data-action=phone-fold]');
  check('프로젝트 묶음을 접고 편다', folded && !!(await pA.$('[data-section=repo] [data-session]')));

  // ---- 3. 셸 열기 → 글 보내기 → 키 줄 ----
  await pA.tap('[data-session="' + shellR.sessionId + '"]');
  await pA.waitForSelector('[data-role=phone-session] .xterm-screen', { timeout: 20000 });
  await sleep(1200);
  const sv = await pA.evaluate(() => { const t = document.querySelector('[data-role=phone-term]').getBoundingClientRect(); const k = document.querySelector('[data-role=phone-keys]').getBoundingClientRect(); const i = document.querySelector('[data-role=phone-input]').getBoundingClientRect(); const ta = document.querySelector('.xterm-helper-textarea'); return { termH: t.height, keysTop: k.top, inputBottom: i.bottom, vh: innerHeight, inputmode: ta && ta.getAttribute('inputmode'), keys: [...document.querySelectorAll('[data-role=phone-keys] [data-key]')].map((b) => b.dataset.key) }; });
  check('세션 화면: 터미널이 화면 대부분, 아래에 키 줄과 입력 줄, 터미널을 눌러도 화면 키보드 없음', sv.termH > sv.vh * 0.5 && sv.inputBottom <= sv.vh + 1 && sv.inputmode === 'none' && sv.keys.join(',') === 'enter,esc,ctrlc,up,down,tab,shifttab,slash', sv);
  const owner = await until(() => { const r = call('backend.status').relay; return Array.isArray(r) && r.length ? r : null; }, 10000).catch(() => null);
  log(`relay ${JSON.stringify(owner).slice(0, 300)}`);
  await pA.fill('[data-field=phone-text]', 'echo p74-phone-hello');
  await pA.tap('[data-action=phone-send]');
  await until(() => /p74-phone-hello\s*\r?\n.*p74-phone-hello|^p74-phone-hello$/m.test(screenText('p74-shell')), 15000, 500).catch(() => null);
  const sc1 = screenText('p74-shell');
  check('입력 줄로 셸에 명령을 보낸다(실행되어 출력이 보인다)', (sc1.match(/p74-phone-hello/g) || []).length >= 2, sc1.split('\n').filter((l) => /p74/.test(l)).slice(-3));
  await pA.tap('[data-key=up]'); await sleep(300);
  await pA.tap('[data-key=enter]');
  await until(() => (screenText('p74-shell').match(/p74-phone-hello/g) || []).length >= 4, 15000, 500).catch(() => null);
  const sc2 = screenText('p74-shell');
  await sleep(800);
  const termDiag = await pA.evaluate((id) => {
    const t = window.__mt.terms.get(id); const host = document.querySelector('[data-role=phone-term] .mt-term'); const el = host && host.querySelector('.xterm');
    const lines = []; if (t) { const b = t.buffer.active; for (let i = 0; i < t.rows; i++) { const l = b.getLine(b.viewportY + i); if (l) lines.push(l.translateToString(true)); } }
    const cv = [...(host ? host.querySelectorAll('canvas') : [])].map((c) => [c.width, c.height, c.style.width, c.style.height]);
    const rows = host && host.querySelector('.xterm-rows');
    return { cols: t && t.cols, rows: t && t.rows, tf: el && el.style.transform, scale: host && host.dataset.scale, hostWH: host && [host.clientWidth, host.clientHeight], canvases: cv, domRows: rows ? rows.textContent.slice(0, 120) : null, text: lines.filter((x) => x.trim()).slice(-4) };
  }, shellR.sessionId);
  log(`터미널 진단 ${JSON.stringify(termDiag)}`);
  check('휴대폰 터미널에 화면 글이 들어 있다(xterm 버퍼)', termDiag.text.some((l) => /p74-phone-hello/.test(l)), termDiag);
  check('키 줄 ↑ 다음 ⏎로 지난 명령을 다시 실행한다', (sc2.match(/p74-phone-hello/g) || []).length >= 4, (sc2.match(/p74-phone-hello/g) || []).length);
  // 여러 줄 입력 칸이 커진다
  await pA.fill('[data-field=phone-text]', 'a\nb\nc');
  const taH = await pA.evaluate(() => { const el = document.querySelector('[data-field=phone-text]'); el.dispatchEvent(new Event('input', { bubbles: true })); return el.getBoundingClientRect().height; });
  await pA.fill('[data-field=phone-text]', '');
  check('입력 줄은 여러 줄을 받는다(textarea)', await pA.evaluate(() => document.querySelector('[data-field=phone-text]').tagName === 'TEXTAREA'), { taH });
  await wshot(pA, '03-shell');

  // ---- 4. 목록으로 → 에이전트에게 보내기 ----
  await pA.tap('[data-action=phone-back]');
  await pA.waitForSelector('[data-role=phone-list]');
  await pA.tap('[data-session="' + idleR.sessionId + '"]');
  await pA.waitForSelector('[data-role=phone-session] .xterm-screen', { timeout: 20000 });
  await pA.fill('[data-field=phone-text]', 'Reply with exactly the single word PONGP74 and nothing else.');
  await pA.tap('[data-action=phone-send]');
  await pA.waitForSelector('[data-role=phone-note]', { timeout: 10000 }).catch(() => {});
  const noteT = await pA.textContent('[data-role=phone-note]').catch(() => '');
  await until(() => { const s = byName('p74-idle'); return s && /PONGP74/.test(s.lastAnswer || ''); }, 120000, 1000).catch(() => null);
  check('입력 줄로 에이전트에게 보낸다(전달 대기열, 답이 온다)', /PONGP74/.test(byName('p74-idle').lastAnswer || ''), { note: noteT, answer: (byName('p74-idle').lastAnswer || '').slice(0, 80) });
  await sleep(1500);
  await wshot(pA, '04-agent');
  // 손가락 스크롤: 터미널을 끌면 휠(SGR)로 보낸다
  await pA.evaluate(() => { window.__p74in = []; const c = window.__mt.api.call.bind(window.__mt.api); window.__mt.api.call = (m, p) => { if (m === 'terminal.input') window.__p74in.push(p.data); return c(m, p); }; });
  const box = await pA.evaluate(() => { const r = document.querySelector('[data-role=phone-term]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await A.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
  for (let i = 1; i <= 8; i++) { await A.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x, y: box.y + i * 20 }] }); await sleep(20); }
  await A.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  const wheels = await pA.evaluate(() => window.__p74in.filter((d) => /\x1b\[<64;/.test(d)).length);
  check('터미널을 손가락으로 아래로 끌면 위로 스크롤(SGR 휠 위)을 보낸다', wheels > 0, { wheels });

  // ---- 5. 응답 필요에 답하기. P104: 카드 대신 키 패드(Enter = 1. Yes, 터미널을 보고 고른다) ----
  await pA.tap('[data-action=phone-next-need]');
  await pA.waitForSelector(`[data-role=phone-session][data-session="${askR.sessionId}"] [data-role=phone-pad]`, { timeout: 15000 });
  await sleep(1200);
  const card = await pA.evaluate(() => { const y = document.querySelector('[data-role=phone-pad] [data-pad-key=enter]').getBoundingClientRect(); const n = document.querySelector('[data-role=phone-pad] [data-pad-key=esc]').getBoundingClientRect(); return { enterH: y.height, enterW: y.width, escH: n.height, card: !!document.querySelector('[data-role=phone-answer]') }; });
  check('"다음" 단추로 응답 필요 세션에 가고, 카드 없이 키 패드가 펼쳐진다(Enter·Esc 44px 이상)', card.enterH >= 44 && card.escH >= 44 && !card.card, card);
  await wshot(pA, '05-approval');
  await pA.tap('[data-role=phone-pad] [data-pad-key=enter]');
  await until(() => fs.existsSync(path.join(PROJ, 'p74-approved.txt')), 60000, 500).catch(() => null);
  check('Enter를 누르면 에이전트가 이어서 명령을 실행한다(파일이 생김)', fs.existsSync(path.join(PROJ, 'p74-approved.txt')));
  await pA.waitForFunction(() => !document.querySelector('[data-role=phone-pad]'), null, { timeout: 30000 }).catch(() => {});
  await sleep(1000);
  await wshot(pA, '06-after-approve');

  // ---- 6. 새 세션 ----
  await pA.tap('[data-action=phone-back]');
  await pA.waitForSelector('[data-role=phone-list]');
  await pA.tap('[data-action=phone-new]');
  await pA.waitForSelector('[data-role=phone-spawn]');
  const sheet = await pA.evaluate(() => ({ launchers: [...document.querySelectorAll('[data-role=phone-launchers] [data-launcher]')].map((b) => b.textContent), repos: [...document.querySelectorAll('[data-role=phone-repos] [data-ws]')].map((b) => b.querySelector('.mt-ph-choice-name').textContent), onL: !!document.querySelector('[data-role=phone-launchers] .on'), onR: !!document.querySelector('[data-role=phone-repos] .on') }));
  check('새 세션 시트: 레일의 런처와 프로젝트를 고른 채로 보인다', sheet.launchers.length > 0 && sheet.repos.length > 0 && sheet.onL && sheet.onR, sheet);
  await wshot(pA, '07-new-session');
  const before = new Set(sessions().map((s) => s.sessionId));
  // 첫 런처가 Claude Code가 아니면 Claude Code를 고른다(개발용 판은 haiku로 띄운다)
  await pA.evaluate(() => { const b = [...document.querySelectorAll('[data-role=phone-launchers] [data-launcher]')].find((x) => /claude/i.test(x.textContent)); if (b) b.click(); });
  await pA.tap('[data-action=phone-spawn-go]');
  await pA.waitForFunction((ids) => { const el = document.querySelector('[data-role=phone-session]'); return el && !ids.includes(el.dataset.session); }, [...before], { timeout: 30000 });
  const newId = await pA.evaluate(() => document.querySelector('[data-role=phone-session]').dataset.session);
  const newS = sessions().find((s) => s.sessionId === newId);
  check('띄우면 새 세션 화면으로 들어간다(고른 프로젝트 폴더)', newS && !before.has(newId) && path.resolve(newS.cwd).toLowerCase() === path.resolve(PROJ).toLowerCase(), newS && { name: newS.name, model: newS.model });
  await sleep(4000);
  await wshot(pA, '08-new-session-open');

  // ---- 7. 연결 끊김과 다시 붙기 ----
  const codes = [];
  await pA.exposeFunction('__p74close', (c) => codes.push(c));
  await pA.evaluate(() => window.__mt.api.ws.addEventListener('close', (e) => window.__p74close(e.code)));
  call('device.disconnect', { id: devA.id });
  await pA.waitForSelector('[data-role=phone-conn][data-phase=reconnecting]', { timeout: 10000 }).catch(() => {});
  const sawRe = await pA.$('[data-role=phone-conn][data-phase=reconnecting]');
  await wshot(pA, '09-reconnecting');
  await pA.waitForSelector('[data-role=phone-conn][data-phase=open]', { timeout: 30000 }).catch(() => {});
  check('PC에서 끊으면(4402) 연결 표시가 "다시 연결 중"이 되고 저절로 다시 붙는다', codes.includes(4402) && !!sawRe && !!(await pA.$('[data-role=phone-conn][data-phase=open]')), { codes });
  await sleep(2500);
  const sc = await pA.evaluate(() => { const h = document.querySelector('[data-role=phone-term] .mt-term'); return h ? h.dataset.scale || '1' : null; });
  await wshot(pA, '09b-reconnected');
  check('다시 붙은 뒤 휴대폰이 패널 크기를 다시 가져간다(비율 1로 그림)', sc === '1', { scale: sc });
  await A.ctx.setOffline(true);
  await pA.evaluate(() => window.__mt.api.ws.close());
  await pA.waitForSelector('[data-role=phone-conn][data-phase=reconnecting]', { timeout: 10000 }).catch(() => {});
  const offRe = !!(await pA.$('[data-role=phone-conn][data-phase=reconnecting]'));
  await A.ctx.setOffline(false);
  await pA.tap('[data-role=phone-conn]').catch(() => {}); // 누르면 지금 다시
  await pA.waitForSelector('[data-role=phone-conn][data-phase=open]', { timeout: 30000 }).catch(() => {});
  check('오프라인이 되면 다시 연결 중, 돌아오면(연결 표시를 누름) 다시 붙는다', offRe && !!(await pA.$('[data-role=phone-conn][data-phase=open]')));

  // ---- 8. 서비스 워커와 매니페스트(설치 조건) ----
  const swInfo = await pA.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, active: !!r.active, script: r.active && r.active.scriptURL, controlled: !!navigator.serviceWorker.controller, pwa: window.__mtWeb.pwa.registered }; });
  check('서비스 워커가 / 범위로 등록되어 켜졌다', swInfo.active && new URL(swInfo.scope).pathname === '/' && /\/sw\.js$/.test(swInfo.script) && swInfo.pwa, swInfo);
  const man = await A.cdp.send('Page.getAppManifest');
  // 설치 가능성은 시크릿이 아닌 프로필(시험 폴더 안)에서 본다. 짝 맺기 전에도 껍데기와 서비스 워커는 같다
  const profDir = path.join(OUT, 'chrome-profile');
  fs.rmSync(profDir, { recursive: true, force: true });
  const pctx = await chromium.launchPersistentContext(profDir, { headless: true, ...(exe ? { executablePath: exe } : { channel: 'chromium' }), args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`], ...PHONE });
  const pp = pctx.pages()[0] || await pctx.newPage();
  await pp.goto(`${BASE}/`);
  await pp.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await pp.reload(); await pp.waitForSelector('[data-role=pair]', { timeout: 20000 });
  const pcdp = await pctx.newCDPSession(pp);
  const inst = await until(async () => { const r = await pcdp.send('Page.getInstallabilityErrors'); return r.installabilityErrors.length === 0 ? r : null; }, 15000, 1000).catch(async () => pcdp.send('Page.getInstallabilityErrors'));
  await pctx.close();
  fs.rmSync(profDir, { recursive: true, force: true });
  check('매니페스트를 읽고 설치 조건에 걸리는 것이 없다(Chromium 설치 가능성 검사, 시크릿 아닌 프로필)', man.url.endsWith('/assets/pwa/manifest.webmanifest') && !(man.errors || []).length && inst.installabilityErrors.length === 0, { manifestErrors: man.errors, installability: inst.installabilityErrors });
  responses.length = 0;
  await pA.reload(); await phoneOpen(pA); await splashGone(pA);
  await sleep(1500);
  const shellFromSw = responses.filter((r) => ['/', '/renderer.js', '/renderer.css'].includes(r.path));
  const notSw = responses.filter((r) => /^\/(web|api)/.test(r.path));
  check('다시 열면 껍데기는 서비스 워커를 거치고, /web/·/api는 거치지 않는다', shellFromSw.length >= 2 && shellFromSw.every((r) => r.sw) && notSw.length > 0 && notSw.every((r) => !r.sw), { shell: shellFromSw, web: notSw.slice(0, 5) });
  const cached = await pA.evaluate(async () => { const out = []; for (const k of await caches.keys()) { const c = await caches.open(k); for (const r of await c.keys()) out.push(new URL(r.url).pathname); } return out; });
  check('캐시에는 껍데기만 있다(/web/, /api, sw.js 없음)', cached.includes('/') && cached.includes('/renderer.js') && !cached.some((p) => /^\/(web|api|hooks|branch|health|sw\.js)/.test(p)), { n: cached.length, sample: cached.slice(0, 6) });
  // 오프라인으로 다시 열면 캐시의 껍데기가 뜬다(판에는 못 붙는다)
  await A.ctx.setOffline(true);
  await pA.reload().catch(() => {});
  await sleep(2500);
  const offline = await pA.evaluate(() => ({ root: !!document.querySelector('#root'), splash: !!document.querySelector('[data-role=splash], [data-role=pair]'), title: document.title })).catch((e) => ({ error: e.message }));
  await wshot(pA, '10-offline-shell');
  await A.ctx.setOffline(false);
  check('오프라인으로 다시 열어도 앱 껍데기가 뜬다(브라우저 오류 쪽이 아님)', offline.root && offline.title === 'Atrium', offline);
  await pA.goto(`${BASE}/`); await phoneOpen(pA); await splashGone(pA);
  // 서비스 워커 받는 길도 백엔드 규칙을 따른다
  const swOther = await viaSim('/renderer.js', { headers: { 'service-worker': 'script' } });
  const swOk = await viaSim('/sw.js', { headers: { 'service-worker': 'script' } });
  const meNo = await viaSim('/web/me');
  call('settings.set', { remoteAccess: false });
  const swBlocked = await viaSim('/sw.js', { headers: { 'service-worker': 'script' } });
  const manBlocked = await viaSim('/assets/pwa/manifest.webmanifest');
  call('settings.set', { remoteAccess: true });
  check('보안: sw.js 말고는 서비스 워커로 받지 못하고, 원격 막음이면 sw.js·매니페스트도 막히며, 쿠키 없이 /web/me는 401', swOther.status === 404 && swOk.status === 200 && swBlocked.status === 503 && manBlocked.status === 503 && meNo.status === 401, { swOther: swOther.status, swOk: swOk.status, swBlocked: swBlocked.status, manBlocked: manBlocked.status, meNo: meNo.status });
  await pA.waitForSelector('[data-role=phone-conn][data-phase=open]', { timeout: 30000 }).catch(() => {});

  // ---- 9. 가로로 돌리면 보드 화면, 다시 세로면 휴대폰 화면 ----
  await pA.setViewportSize({ width: 844, height: 390 });
  await pA.waitForFunction(() => !document.querySelector('[data-role=phone]') && !!document.querySelector('.react-flow'), null, { timeout: 15000 }).catch(() => {});
  const land = await pA.evaluate(() => ({ phone: !!document.querySelector('[data-role=phone]'), board: !!document.querySelector('.react-flow') }));
  await sleep(1500);
  await wshot(pA, '11-landscape-board');
  await pA.setViewportSize({ width: 390, height: 844 });
  await pA.waitForSelector('[data-role=phone]', { timeout: 15000 }).catch(() => {});
  check('가로로 돌리면 보드 화면(캔버스), 세로로 돌아오면 휴대폰 화면', !land.phone && land.board && !!(await pA.$('[data-role=phone]')), land);
  // 휴대폰에서 보드 화면 고르기 → 돌아오기
  if (await pA.$('[data-role=phone-session]')) await pA.tap('[data-action=phone-back]');
  await pA.waitForSelector('[data-role=phone-list]', { timeout: 10000 });
  await pA.tap('[data-action=phone-board]');
  await pA.waitForSelector('[data-action=phone-list-open]', { timeout: 10000 });
  await sleep(800);
  await wshot(pA, '12-portrait-board-choice');
  await pA.tap('[data-action=phone-list-open]');
  check('휴대폰에서 "보드 화면"을 고르고 "휴대폰 화면"으로 돌아온다', !!(await pA.waitForSelector('[data-role=phone-list]', { timeout: 10000 }).catch(() => null)));
  await wshot(pA, '13-list-end');

  // ---- 10. 홈 화면 앱 흉내: 쿠키를 나누지 않는 새 문맥(standalone) ----
  const H = await phone(browser, 'home-off', { standalone: true });
  await H.page.goto(`${BASE}/`);
  await H.page.waitForSelector('[data-role=pair]', { timeout: 20000 });
  const hintOff = await H.page.textContent('[data-role=pair-standalone]').catch(() => null);
  const hname = await H.page.inputValue('[data-field=pair-name]');
  await wshot(H.page, '14-home-app-pair-off');
  await H.page.fill('[data-field=pair-code]', newCode());
  await H.page.tap('[data-action=pair-submit]');
  await phoneOpen(H.page); await splashGone(H.page);
  check('홈 화면 앱(패스키 끔): 짝 맺기 화면에 안내가 있고, 새 코드로 그 안에서 짝 맺어 목록이 열린다', !!hintOff && /App/.test(hname) && !!(await H.page.$('[data-role=phone-list]')), { hint: hintOff && hintOff.slice(0, 60), name: hname });
  await H.ctx.close();
  // 패스키 켬: Safari 문맥에서 짝 맺고 패스키를 만든 뒤, 홈 화면 앱 문맥은 같은 패스키(iCloud 키체인 흉내: 자격 증명을 옮긴다)로 들어간다
  call('settings.set', { remotePasskey: true });
  const S2 = await phone(browser, 'safari-on');
  await S2.page.goto(`${BASE}/`);
  await S2.page.waitForSelector('[data-role=pair]', { timeout: 20000 });
  await S2.page.fill('[data-field=pair-name]', 'Safari on phone (passkey)');
  await S2.page.fill('[data-field=pair-code]', newCode());
  await S2.page.tap('[data-action=pair-submit]');
  await S2.page.waitForSelector('[data-role=passkey-register]', { timeout: 15000 });
  await S2.page.tap('[data-action=passkey-create]');
  await phoneOpen(S2.page);
  const creds = (await S2.cdp.send('WebAuthn.getCredentials', { authenticatorId: S2.authenticatorId })).credentials;
  const H2 = await phone(browser, 'home-on', { standalone: true });
  for (const c of creds) await H2.cdp.send('WebAuthn.addCredential', { authenticatorId: H2.authenticatorId, credential: c });
  await H2.page.goto(`${BASE}/`);
  await H2.page.waitForSelector('[data-role=pair]', { timeout: 20000 });
  const hintOn = await H2.page.textContent('[data-role=pair-standalone]').catch(() => null);
  await wshot(H2.page, '15-home-app-pair-on');
  const devCount = call('device.list').devices.length;
  await H2.page.tap('[data-action=passkey-have]');
  await H2.page.waitForSelector('[data-action=passkey-verify]', { timeout: 10000 });
  await H2.page.tap('[data-action=passkey-verify]');
  await phoneOpen(H2.page); await splashGone(H2.page);
  check('홈 화면 앱(패스키 켬): 안내가 패스키 길을 알리고, Safari에서 만든 패스키로 새 짝 맺기 없이 들어간다', !!hintOn && /패스키/.test(hintOn) && !!(await H2.page.$('[data-role=phone-list]')) && call('device.list').devices.length === devCount, { hint: hintOn && hintOn.slice(0, 60), devices: devCount });
  await wshot(H2.page, '16-home-app-list-on');
  await H2.ctx.close(); await S2.ctx.close();
  call('settings.set', { remotePasskey: false });
  const rl = call('remote.log', { limit: 80 }).entries;
  check('원격 기록에 짝 맺기·로그인·끊기가 남는다', rl.some((e) => e.event === 'pair.ok') && rl.some((e) => e.event === 'login') && rl.some((e) => e.event === 'kick'), [...new Set(rl.map((e) => e.event))]);
} catch (e) {
  log(`오류 ${e.stack}`);
  check('시험이 끝까지 돎', false, e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (sim) await sim.close().catch(() => {});
  try { for (const s of sessions()) if (/^p74-/.test(s.name) || path.resolve(s.cwd || '').toLowerCase() === path.resolve(PROJ).toLowerCase()) atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log(`정리 오류 ${e.message}`); }
  fs.writeFileSync(path.join(OUT, 'p74-mobile-results.json'), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
