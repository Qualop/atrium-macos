// P93 창 시험: 상태 색(일하는 에이전트 주황, 일하는 셸 초록, 응답 필요 새 색)을 한 판에서 찍고 계산된 색을 잰다.
// 판: herdr 세션 atrium-dev-p93, 포트 47893, 이 워크트리의 backend/.dev(data, app). 창의 원격 디버깅 포트 9373. 휴대폰 흉내 프록시 47903.
// 장면(새 폴더 C:\Workspace\mtask-p93-board, git 아님): w-haiku(claude --model haiku, Bash ping 도는 중 = working), sh-run(셸, ping 도는 중),
//   q-ask(Bash 권한 질문 = waiting), e-err(창 안에서 오류로 흉내), r-review(ready, 안 봄), z-nap(새 폴더 C:\Workspace\mtask-p93-nap, 잠듦).
//   신뢰 질문이 뜨면 backend/.dev/p93-need-trust.txt에 한 줄을 두고 멈춘다.
// P93_STAGE=before | after | cand | clean. cand는 응답 필요 후보 색을 :root에 덮어 같은 판을 찍고 나란히 붙인 그림을 만든다.
// 결과는 experiments/p93/(git 밖).
// 실행(워크트리 루트): sh backend/.dev/clean-env.sh env P93_STAGE=before node app/test/e2e/p93-colors.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const STAGE = process.env.P93_STAGE || 'after';
if (!['before', 'after', 'cand', 'clean'].includes(STAGE)) throw new Error('P93_STAGE=before|after|cand|clean');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p93');
const CONVOS = path.join(OUT, 'convos');
const BOARDDIR = 'C:\\Workspace\\mtask-p93-board';
const NAP = 'C:\\Workspace\\mtask-p93-nap';
const BOARD = { session: 'atrium-dev-p93', port: 47893, sim: 47903, cdp: 9373 };
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A, baseOf } = L;
export const ENV = {
  ATRIUM_HERDR_SESSION: BOARD.session, ATRIUM_PORT: String(BOARD.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p93',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(BOARD.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${BOARD.sim},localhost:${BOARD.sim}`,
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)) delete process.env[k];
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, until, APP_ROOT } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');

const log = logger(`p93-colors-${STAGE}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 180000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const judge = (name, ok, detail) => (STAGE === 'after' ? check(name, ok, detail) : check(`[${STAGE}] ${name}`, true, detail));
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { log(`지우기 실패 ${p}: ${e.message.slice(0, 120)}`); } };

// ---------- 정리 ----------
if (STAGE === 'clean') {
  try { for (const s of sessions()) { try { log('끄기', atrium('kill', s.sessionId, '--yes', '--delete').trim().split('\n').slice(-1)[0]); } catch (e) { log('끄기 실패', s.name, e.message.slice(0, 160)); } } } catch (e) { log('목록 실패', e.message.slice(0, 160)); }
  try { log('herdr 멈춤', atrium('herdr', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { log('herdr 멈춤 실패', e.message.slice(0, 200)); }
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log('백엔드 멈춤 실패', e.message.slice(0, 200)); }
  for (const p of [NAP, BOARDDIR]) rmrf(p);
  process.exit(0);
}

// ---------- 장면 ----------
const LONG = (n) => `Use the Bash tool to run this command in the foreground, not in the background, with timeout 600000: ping -n ${n} 127.0.0.1 . Wait for it to finish. Then reply with the single word done.`;
function spawn(folder, name, extra = []) { const r = JSON.parse(atrium('--json', 'spawn', folder, '--name', name, ...extra)); log(`띄움 ${name} ${r.sessionId}`); return r; }
const trustStop = (name, folder) => { fs.writeFileSync(path.join(DEV, 'p93-need-trust.txt'), `${name} in ${folder} asks the folder trust question\n`); throw new Error(`trust question (backend/.dev/p93-need-trust.txt): ${name}`); };
async function readyOf(name, ms = 150000) {
  const s = await until(() => { const x = byName(name); return x && ['ready', 'trust_wait', 'working', 'waiting'].includes(x.state) ? x : null; }, ms, 1500).catch(() => null);
  if (s && s.state === 'trust_wait') trustStop(name, s.cwd);
  return s;
}
async function setupScene() {
  fs.mkdirSync(path.join(BOARDDIR, '.claude'), { recursive: true });
  // 시험 폴더의 프로젝트 설정(local): ping만 묻지 않고 돈다
  fs.writeFileSync(path.join(BOARDDIR, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ping:*)', 'Bash(ping *)'] } }, null, 1));
  fs.mkdirSync(NAP, { recursive: true });
  for (const f of [BOARDDIR, NAP]) log(`신뢰 예상 ${f}: ${atrium('trust', f).trim().replace(/\s+/g, ' ').slice(0, 200)}`);
  for (const s of sessions()) { try { atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log('옛 세션 끄기 실패', s.name, e.message.slice(0, 120)); } }
  await sleep(1500);
  spawn(BOARDDIR, 'w-haiku', ['--model', 'haiku']);
  spawn(BOARDDIR, 'q-ask', ['--model', 'haiku']);
  spawn(BOARDDIR, 'e-err', ['--model', 'haiku']);
  spawn(BOARDDIR, 'r-review', ['--model', 'haiku']);
  spawn(NAP, 'z-nap', ['--model', 'haiku']);
  spawn(BOARDDIR, 'sh-run', ['--kind', 'shell']);
  for (const n of ['w-haiku', 'q-ask', 'e-err', 'r-review', 'z-nap']) { const s = await readyOf(n); log(`준비 ${n}: ${s ? s.state : '없음'}`); }
  atrium('send', '@z-nap', 'Reply with the single word ok.', '--wait');
  await until(() => byName('z-nap').state === 'ready', 90000, 1500).catch(() => {});
  for (let i = 0; i < 8; i++) { try { log('잠재우기', atrium('sleep', NAP).trim().slice(0, 300)); break; } catch (e) { log('잠재우기 실패(다시)', e.message.slice(-160)); await sleep(5000); } }
  atrium('send', '@r-review', '@e-err', 'Reply with the single word ok.');
  await until(() => ['r-review', 'e-err'].every((n) => { const s = byName(n); return s && s.state === 'ready' && s.lastAnswer; }), 120000, 1500).catch(() => {});
  atrium('seen', 'e-err');
}
async function drive() {
  const w = byName('w-haiku'); if (w.state !== 'working') atrium('send', '@w-haiku', LONG(600));
  const sh = byName('sh-run'); if (sh.state !== 'shell_running') atrium('input', 'sh-run', 'ping -n 1200 127.0.0.1\\r');
  const q = byName('q-ask'); if (q.state !== 'waiting') atrium('send', '@q-ask', 'Use the Bash tool to run exactly: mkdir p93-ask-dir . Then reply with the single word done.');
  await until(() => byName('w-haiku').state === 'working' && byName('q-ask').state === 'waiting' && byName('sh-run').state === 'shell_running', 120000, 1500).catch(() => {});
  const st = Object.fromEntries(sessions().map((s) => [s.name, `${s.state}${s.unseen ? '+unseen' : ''}`]));
  log(`상태 ${JSON.stringify(st)}`);
  return st;
}
// e-err는 창 안에서 오류로 흉내 낸다(백엔드는 모른다). 찍기 직전마다 다시 넣는다
const FAKE_ERR = () => { const st = window.__mt.getState(); const s = [...st.sessions.values()].find((x) => x.name === 'e-err'); if (s) window.__mt.api.emit('session.updated', { ...s, state: 'error', error: { message: 'exit 1: build failed' }, lastActivityAt: Date.now() - 60000 }); return !!s; };

// ---------- 화면 ----------
const ZOOMS = [['close', 0.3], ['middle', 0.18], ['far', 0.12], ['farthest', 0.07]];
const centerAt = (pg, z) => pg.evaluate((zz) => {
  const st = window.__mt.getState();
  const rs = [...st.nodes].filter(([id]) => st.sessions.has(id)).map(([, r]) => r);
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  const c = document.querySelector('.react-flow').getBoundingClientRect();
  st.setViewport({ x: c.width / 2 - ((x0 + x1) / 2) * zz, y: c.height / 2 - ((y0 + y1) / 2) * zz, zoom: zz });
}, z);
const shot = async (pg, file) => { await pg.screenshot({ path: path.join(OUT, `${file}.png`) }); log(`스크린숏 experiments/p93/${file}.png`); };
// 세션 노드들을 감싼 상자만 찍는다(비교 그림용)
const shotCrop = async (pg, file) => {
  const clip = await pg.evaluate(() => {
    const rs = [...document.querySelectorAll('.mt-node[data-name]')].map((e) => e.getBoundingClientRect()).filter((r) => r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight);
    const x0 = Math.max(0, Math.min(...rs.map((r) => r.left)) - 24), y0 = Math.max(0, Math.min(...rs.map((r) => r.top)) - 40);
    const x1 = Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + 24), y1 = Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + 24);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  });
  await pg.screenshot({ path: path.join(OUT, `${file}.png`), clip }); log(`스크린숏 experiments/p93/${file}.png`);
};
// 계산된 색: 노드 테두리·바깥 고리, 머리줄 알약, 사이드바 점, 워크스페이스 탭 수
const LOOK = () => {
  const cs = (e, k) => (e ? getComputedStyle(e)[k] : null);
  const nodes = Object.fromEntries([...document.querySelectorAll('.mt-node[data-name]')].map((e) => {
    const pill = e.querySelector('.mt-pill');
    return [e.dataset.name, { state: [...e.classList].find((c) => c.startsWith('st-')), face: e.dataset.face, border: cs(e, 'borderTopColor'), outline: cs(e, 'outlineColor'), outlineStyle: cs(e, 'outlineStyle'), run: getComputedStyle(e).getPropertyValue('--run').trim(),
      pill: pill ? { color: cs(pill, 'color'), bg: cs(pill, 'backgroundColor'), line: cs(pill, 'borderTopColor') } : null }];
  }));
  const sb = Object.fromEntries([...document.querySelectorAll('.mt-sb2-row.sess[data-name]')].map((e) => { const d = e.querySelector('.mt-sb2-dot'); const tag = e.querySelector('.mt-sb2-tag'); return [e.dataset.name, { dot: cs(d, 'backgroundColor'), bg: cs(e, 'backgroundColor'), tag: tag ? cs(tag, 'backgroundColor') : null }]; }));
  const tabs = [...document.querySelectorAll('.mt-ws-c')].map((e) => ({ cls: e.className, color: cs(e, 'color'), bg: cs(e, 'backgroundColor') }));
  const tok = Object.fromEntries(['--st-working', '--st-shell_running', '--attn', '--st-waiting', '--st-error', '--st-review', '--accent'].map((k) => [k, getComputedStyle(document.documentElement).getPropertyValue(k).trim()]));
  return { nodes, sb, tabs, tok };
};
const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim()); if (!m) return null; const n = parseInt(m[1], 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };

// 응답 필요 후보: :root의 주의 토큰을 덮는다(cand 단계)
const CANDS = {
  orange: { attn: '#ff6b3d', ink: '#ffffff', rgb: '255, 107, 61', bg: '#2a1810', bg2: '#1e1610', text: '#ffd9c7' }, // 지금 값(일함 주황 옆에서 겹치는지 보려고)
  yellow: { attn: '#ffe03d', ink: '#1a1400', rgb: '255, 224, 61', bg: '#2a2510', bg2: '#1f1c0f', text: '#fff3b8' },
  pink: { attn: '#ff4fb8', ink: '#ffffff', rgb: '255, 79, 184', bg: '#2a1022', bg2: '#1f0f1a', text: '#ffd1ec' },
  cyan: { attn: '#38e8ff', ink: '#03161c', rgb: '56, 232, 255', bg: '#0e2229', bg2: '#0c1a1f', text: '#c7f6ff' },
  lime: { attn: '#c6f432', ink: '#141a00', rgb: '198, 244, 50', bg: '#202a0e', bg2: '#191f0c', text: '#effcc4' },
};
const candCss = (c) => `:root{--attn:${c.attn};--attn-ink:${c.ink};--attn-line:rgba(${c.rgb},.7);--attn-bg:${c.bg};--attn-bg-2:${c.bg2};--attn-text:${c.text};--answer-line:rgba(${c.rgb},.35);--st-waiting:${c.attn};--st-trust_wait:${c.attn};--con-glow:0 0 0 4px rgba(${c.rgb},.16),0 0 30px rgba(${c.rgb},.2);}`;

// ---------- 휴대폰 목록 ----------
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PHONE = { viewport: { width: 393, height: 852 }, screen: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: SAFARI };
async function phone(report, cands = null) {
  const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
  const { chromium } = await import('playwright');
  const st0 = call('settings.get').settings;
  for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  const sim = startTsSim({ listen: BOARD.sim, target: BOARD.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const BASE = baseOf(BOARD.sim);
  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const found = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  const browser = await chromium.launch({ headless: true, ...(found ? { executablePath: found } : { channel: 'chromium' }), args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  try {
    const ctx = await browser.newContext(PHONE);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[phone pageerror] ${e.message}`));
    await pg.goto(`${BASE}/`);
    await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
    await pg.fill('[data-field=pair-code]', call('device.code').code);
    await pg.tap('[data-action=pair-submit]');
    await pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: 60000 });
    await pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
    await sleep(1500);
    await pg.evaluate(FAKE_ERR); await sleep(500);
    const dots = () => pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('.mt-ph-row[data-session]')].map((e) => { const d = e.querySelector('.mt-ph-dot'); return [(e.querySelector('.mt-ph-name') || e).textContent.trim(),{ tone: e.dataset.tone, dot: getComputedStyle(d).backgroundColor, row: getComputedStyle(e).borderTopColor }]; })));
    if (cands) {
      for (const [k, c] of Object.entries(cands)) {
        const h = await pg.addStyleTag({ content: candCss(c) }); await sleep(300);
        await shot(pg, `cand-${k}-phone-list`);
        await h.evaluate((e) => e.remove());
      }
    } else {
      await shot(pg, `${STAGE}-phone-list`);
      report.phone = await dots();
      log(`휴대폰 점 ${JSON.stringify(report.phone)}`);
    }
  } finally { await browser.close().catch(() => {}); try { sim.close && sim.close(); } catch {} }
}

// 나란히 붙인 그림(후보 비교): 같은 장면의 그림 여럿을 한 장에
async function composite(file, rows, cols = 2) {
  const { chromium } = await import('playwright');
  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const found = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  const browser = await chromium.launch({ headless: true, ...(found ? { executablePath: found } : { channel: 'chromium' }) });
  try {
    const pg = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const img = (f) => `data:image/png;base64,${fs.readFileSync(path.join(OUT, `${f}.png`)).toString('base64')}`;
    const html = `<body style="margin:0;background:#222;font:600 18px sans-serif;color:#eee"><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;padding:8px">${rows.map(([label, f]) => `<figure style="margin:0"><figcaption style="padding:4px 0">${label}</figcaption><img src="${img(f)}" style="width:100%;display:block"></figure>`).join('')}</div></body>`;
    await pg.setContent(html); await sleep(500);
    await pg.screenshot({ path: path.join(OUT, `${file}.png`), fullPage: true });
    log(`비교 그림 experiments/p93/${file}.png`);
  } finally { await browser.close().catch(() => {}); }
}

// ---------- 본 시험 ----------
let app = null, page = null;
const report = { stage: STAGE };
try {
  log(atrium('backend', 'start').trim().slice(0, 300));
  try { atrium('settings', 'set', 'tray', 'off'); } catch (e) { log('트레이 끄기 실패', e.message.slice(0, 120)); }
  try { atrium('settings', 'set', 'language', 'ko'); } catch {}
  const have = sessions().map((s) => s.name);
  if (process.env.P93_FRESH === '1' || !['w-haiku', 'q-ask', 'sh-run', 'z-nap', 'e-err', 'r-review'].every((n) => have.includes(n))) await setupScene();
  report.states = await drive();

  const { _electron: electron } = await import('playwright');
  app = await electron.launch({ args: ['.', '--dev', `--remote-debugging-port=${BOARD.cdp}`], cwd: APP_ROOT, env: process.env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await page.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  const sidebar = async (open) => { const on = await page.evaluate(() => !!document.querySelector('.mt-sb2')); if (on !== open) { await page.click('[data-action=sidebar]'); await sleep(800); } };
  await sidebar(false);
  await page.evaluate(FAKE_ERR);

  if (STAGE === 'cand') {
    const rows = [];
    for (const [k, c] of Object.entries(CANDS)) {
      const h = await page.addStyleTag({ content: candCss(c) }); await sleep(400);
      for (const [label, z] of [['close', 0.3], ['far', 0.12], ['farthest', 0.07]]) { await page.evaluate(FAKE_ERR); await centerAt(page, z); await sleep(1500); await shot(page, `cand-${k}-pc-${label}`); await shotCrop(page, `cand-${k}-pc-${label}-crop`); }
      await sidebar(true); await centerAt(page, 0.12); await sleep(1000); await shot(page, `cand-${k}-pc-sidebar`); await sidebar(false);
      await h.evaluate((e) => e.remove());
      rows.push(k);
    }
    for (const v of ['close-crop', 'far-crop', 'farthest-crop', 'sidebar']) await composite(`cand-compare-${v}`, rows.map((k) => [`${k} ${CANDS[k].attn}`, `cand-${k}-pc-${v}`]));
    await phone(report, CANDS);
    await composite('cand-compare-phone', rows.map((k) => [`${k} ${CANDS[k].attn}`, `cand-${k}-phone-list`]), 5);
  } else {
    report.pc = {};
    for (const [label, z] of ZOOMS) {
      await page.evaluate(FAKE_ERR); await centerAt(page, z); await sleep(2000);
      await shot(page, `${STAGE}-pc-${label}`);
      report.pc[label] = await page.evaluate(LOOK);
    }
    await sidebar(true); await page.evaluate(FAKE_ERR); await centerAt(page, 0.12); await sleep(1200);
    await shot(page, `${STAGE}-pc-sidebar`);
    report.pc.sidebar = await page.evaluate(LOOK);
    await sidebar(false);
    log(`모습 ${JSON.stringify({ close: report.pc.close, sidebar: report.pc.sidebar.sb })}`);

    const c = report.pc.close, far = report.pc.far, sb = report.pc.sidebar;
    const W = hexRgb(c.tok['--st-working']), SH = hexRgb(c.tok['--st-shell_running']), A = hexRgb(c.tok['--attn']), ACC = hexRgb(c.tok['--accent']);
    const N = (z, n) => z.nodes[n] || {};
    judge('토큰: 일함은 주황, 셸 실행은 브랜드 초록, 응답 필요는 셋 다와 다름', W && SH === ACC && A && A !== W && A !== hexRgb(c.tok['--st-error']) && A !== hexRgb(c.tok['--st-review']), c.tok);
    judge('가까이: 일하는 haiku 알약은 일함 색, 셸 알약은 초록', N(c, 'w-haiku').pill?.color === W && N(c, 'sh-run').pill?.color === SH, { w: N(c, 'w-haiku'), sh: N(c, 'sh-run') });
    judge('가까이: 응답 필요 알약 바탕·테두리는 응답 필요 색, 알약 글은 어두운 글색', N(c, 'q-ask').pill?.bg === A && N(c, 'q-ask').border === A && N(c, 'q-ask').pill?.color !== 'rgb(255, 255, 255)', N(c, 'q-ask'));
    judge('멀리: 응답 필요 노드는 응답 필요 색의 바깥 고리(깜빡임)', /solid/.test(N(far, 'q-ask').outlineStyle) && /255, 224, 61/.test(N(far, 'q-ask').outline + ' ' + N(far, 'q-ask').border), N(far, 'q-ask'));
    judge('가까이: 일하는 haiku 테두리는 주황 계열, 셸 테두리는 초록 계열(다름)', N(c, 'w-haiku').border !== N(c, 'sh-run').border, { w: N(c, 'w-haiku').border, sh: N(c, 'sh-run').border });
    judge('멀리: 둘레 색 --run이 일함/셸 각각', far.nodes['w-haiku']?.run && far.nodes['sh-run']?.run && far.nodes['w-haiku'].run !== far.nodes['sh-run'].run, { w: far.nodes['w-haiku'], sh: far.nodes['sh-run'] });
    judge('가장 멀리(아이콘): 일하는 haiku 테두리는 일함 색, 셸은 초록', report.pc.farthest.nodes['w-haiku']?.border === W && report.pc.farthest.nodes['sh-run']?.border === SH, { w: report.pc.farthest.nodes['w-haiku'], sh: report.pc.farthest.nodes['sh-run'] });
    judge('사이드바: 점이 일함 주황·셸 초록·응답 필요 색', sb.sb['w-haiku']?.dot === W && sb.sb['sh-run']?.dot === SH && sb.sb['q-ask']?.dot === A, sb.sb);
    const work = sb.tabs.find((x) => /working/.test(x.cls));
    judge('워크스페이스 이름표의 일함 수는 일함 색', !work || work.color === W, sb.tabs);
    await phone(report);
    const P = report.phone || {};
    judge('휴대폰 목록: 일하는 haiku 점은 주황, 셸 점은 초록, 응답 필요 점은 새 색', P['w-haiku']?.dot === W && P['sh-run']?.dot === SH && P['q-ask']?.dot === A, P);
  }
} catch (e) {
  log(`오류 ${e.stack || e.message}`);
  check('시험이 끝까지 돌았다', false, e.message);
} finally {
  if (app) { try { await app.close(); } catch {} }
  fs.writeFileSync(path.join(OUT, `p93-${STAGE}.json`), JSON.stringify({ report, results }, null, 1));
  const fail = results.filter((r) => !r.ok).length;
  log(`끝: ${results.length}개 중 실패 ${fail}`);
  process.exitCode = fail ? 1 : 0;
}
