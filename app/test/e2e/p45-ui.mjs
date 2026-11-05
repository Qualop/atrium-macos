// P45 창 시험: 요청 기록 스레드(여러 세션에 보낸 요청 12개), 브리핑 없음(30분 넘게 손대지 않은 세션을 눌러도 바로 터미널), 터미널 글자 배율·화면 배율.
// 판: herdr 세션 atrium-dev-p45, 포트 47863, 이 워크트리의 backend/.dev(experiments/p45/tools/env.cjs). claude는 --model haiku, 셸 노드 하나.
// 사용: node experiments/p45/tools/e2e.cjs p45-ui.mjs [--fresh] [--part thread,brief,scale] [--tag 이름] [--keep]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p45') throw new Error('MT_E2E_OUT=p45를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p45', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P45_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p45' || ENV.ATRIUM_PORT !== '47863') throw new Error('P45 판(atrium-dev-p45, 47863)만');
if (!/^C:\\Workspace\\mtask-p45-/.test(T.DIR)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p45-*만: ${T.DIR}`);
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const TAG = arg('--tag', 'p45-ui');
const PARTS = new Set(arg('--part', 'thread,brief,scale').split(','));
const log = logger(TAG);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const lastLine = (s) => s.trim().split(/\r?\n/).slice(-1)[0];
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
let page = null, app = null;
// 창 그대로 찍는다(Electron capturePage). Playwright 스크린숏은 창 배율을 바꾸면 옛 크기로 잘린다
const shot = async (name) => {
  const f = path.join(OUT, `${TAG}-${name}.png`);
  const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  log('스크린숏', path.relative(REPO, f));
};
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);

if (argv.includes('--fresh')) {
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
  await sleep(800);
  for (const d of [path.join(T.DEV, 'data'), path.join(T.DEV, 'app'), T.PROJECTS, T.SESSIONS, T.DIR]) fs.rmSync(d, { recursive: true, force: true });
}
for (const d of [T.PROJECTS, T.SESSIONS, T.DIR]) fs.mkdirSync(d, { recursive: true });

const ids = {};
const sessionId = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }, name);
async function spawn(name, ...extra) {
  const have = await sessionId(name);
  if (have) { ids[name] = have; log(`이미 있음 ${name}`); return; }
  log(lastLine(atrium('spawn', T.DIR, '--name', name, ...extra)));
  ids[name] = await until(() => sessionId(name), 30000);
}
const stateOf = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? s.state : null; }, name);
const reload = async () => { await page.reload(); await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 }); await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true)); };
async function openApp() {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[console.error] ${m.text().slice(0, 300)}`); });
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1584, 921); });
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true));
  await sleep(600);
}
const term = (id) => page.evaluate((i) => {
  const t = window.__mt.terms.get(i);
  const el = document.querySelector(`.mt-term[data-session="${i}"] .xterm-screen`);
  if (!t || !el) return null;
  const r = el.getBoundingClientRect();
  const b = t.buffer.active;
  const lines = [];
  for (let k = 0; k < t.rows; k++) { const l = b.getLine(b.viewportY + k); lines.push(l ? l.translateToString(true) : ''); }
  return { cols: t.cols, rows: t.rows, fontSize: t.options.fontSize, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, lines };
}, id);
const openThread = async () => { if (!(await page.evaluate(() => !!document.querySelector('[data-role="thread"]')))) await page.click('[data-action="thread-toggle"]'); await sleep(500); };

await openApp();
log('창 열림');

// ---------- 1. 스레드 ----------
if (PARTS.has('thread')) {
  for (const n of ['alpha', 'beta', 'gamma']) await spawn(n, '--model', 'haiku');
  for (const n of ['alpha', 'beta', 'gamma']) await until(async () => ['ready', 'waiting', 'trust_wait'].includes(await stateOf(n)), 120000);
  for (const n of ['alpha', 'beta', 'gamma']) step(`1a ${n} 준비`, (await stateOf(n)) === 'ready', await stateOf(n));
  const have = await page.evaluate(() => window.__mt.getState().thread.size);
  if (have < 10) {
    const msgs = [
      '@alpha Reply with exactly one word: one',
      '@beta Reply with exactly one word: two',
      '@gamma Reply with exactly one word: three',
      '@alpha @beta Reply with exactly: four',
      '@all Reply with exactly: five',
      '@gamma Write two short lines.\nLine one should say "first".\nLine two should say "second".\nReply with nothing else.',
      '@beta Reply with exactly: seven',
      '@alpha List the numbers 1 to 30 separated by commas and nothing else.',
      '@gamma Reply with exactly: nine',
      '@beta Reply with exactly: ten',
      '@alpha Reply with exactly: eleven',
      '@all Reply with exactly: twelve',
    ];
    for (const m of msgs) { const r = await call('session.send', { text: m }); log('보냄', m.split('\n')[0].slice(0, 50), r.deliveries.length); await sleep(400); }
  }
  const settled = await until(() => page.evaluate(() => { const it = [...window.__mt.getState().thread.values()]; return it.length >= 10 && it.every((x) => x.phase !== 'active'); }), 300000).catch(() => false);
  step('1b 요청 12개가 모두 끝남', settled, await page.evaluate(() => [...window.__mt.getState().thread.values()].map((x) => x.phase).join(',')));
  await openThread();
  await sleep(800);
  await shot('thread-open');
  const info = await page.evaluate(() => {
    const el = document.querySelector('[data-role="thread"]');
    const r = el && el.getBoundingClientRect();
    return { items: document.querySelectorAll('[data-role="thread-item"]').length, rect: r && { w: Math.round(r.width), h: Math.round(r.height) } };
  });
  log('스레드', info);
  // 새 동작(P45): 묶기, 접기·펼치기, 다시 보내기·고쳐 보내기·복사·그 세션으로
  const hasNew = await page.evaluate(() => !!document.querySelector('[data-role="thread-filter"]'));
  if (hasNew) {
    // 세션으로 묶어 보기
    await page.click('[data-role="thread-filter"] [data-name="beta"]');
    await sleep(400);
    const only = await page.evaluate(() => [...document.querySelectorAll('[data-role="thread-item"]')].map((e) => e.dataset.targets));
    step('1c beta로 묶으면 beta가 받은 줄만', only.length > 0 && only.every((x) => x.split(' ').includes('beta')), only);
    await shot('thread-beta');
    await page.click('[data-role="thread-filter"] [data-name=""]');
    await sleep(300);
    // 긴 글 펼치기
    const longSel = '[data-role="thread-item"][data-long="1"]';
    const before = await page.evaluate((s) => { const e = document.querySelector(`${s} [data-role="thread-text"]`); return e && e.getBoundingClientRect().height; }, longSel);
    await page.click(`${longSel} [data-action="thread-text-toggle"]`);
    await sleep(300);
    const after = await page.evaluate((s) => { const e = document.querySelector(`${s} [data-role="thread-text"]`); return e && e.getBoundingClientRect().height; }, longSel);
    step('1d 긴 글을 펼치면 높아진다', after > before, { before, after });
    // 보고 펼치기
    await page.click('[data-role="thread-item"] [data-role="thread-report"]');
    await sleep(300);
    step('1e 보고를 펼친다', await page.evaluate(() => !!document.querySelector('[data-role="thread-report-full"]')));
    await shot('thread-expanded');
    // 고쳐 보내기: 명령 바에 @대상 글이 들어간다
    const lastItem = '[data-role="thread-item"]:last-of-type';
    await page.hover(lastItem);
    await page.click(`${lastItem} [data-action="thread-edit"]`);
    await sleep(300);
    const cmd = await page.inputValue('[data-role="command"]');
    step('1f 고쳐 보내기는 명령 바에 대상과 글을 넣는다', /^@\S+ .*twelve/.test(cmd), cmd);
    await page.fill('[data-role="command"]', '');
    // 다시 보내기
    const n0 = await page.evaluate(() => window.__mt.getState().thread.size);
    await page.hover(lastItem);
    await page.click(`${lastItem} [data-action="thread-resend"]`);
    const n1 = await until(() => page.evaluate((n) => { const m = window.__mt.getState().thread.size; return m > n ? m : null; }, n0), 10000).catch(() => n0);
    step('1g 다시 보내기는 새 줄을 만든다', n1 > n0, { n0, n1 });
    // 복사
    await page.hover(lastItem);
    await page.click(`${lastItem} [data-action="thread-copy"]`);
    await sleep(300);
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    step('1h 복사는 보낸 글을 클립보드에', /twelve/.test(clip), clip);
    // 그 세션으로
    await page.click(`${lastItem} [data-role="thread-result"][data-name="gamma"] [data-action="thread-go"]`);
    await sleep(1200);
    const focus = await page.evaluate(() => window.__mt.getState().focusId || null);
    log('세션으로 감', focus);
    await until(() => page.evaluate(() => [...window.__mt.getState().thread.values()].every((x) => x.phase !== 'active')), 120000).catch(() => {});
    await openThread();
    await sleep(500);
    await shot('thread-after');
    await page.click('[data-action="thread-close"]');
    await sleep(400);
  }
}

// ---------- 2. 브리핑 없음 ----------
if (PARTS.has('brief')) {
  await spawn('sh1', '--kind', 'shell');
  await until(async () => (await stateOf('sh1')) && (await stateOf('sh1')) !== 'starting', 30000);
  // 30분 넘게 손대지 않은 것처럼: 손댄 시각을 40분 앞으로 돌린다(백엔드 상태와 창 상태 모두)
  await page.evaluate((id) => { const st = window.__mt.getState(); const s = st.sessions.get(id); s.touchedAt = Date.now() - 40 * 60000; s.createdAt = Date.now() - 60 * 60000; }, ids.sh1);
  const nodeBox = await page.evaluate((id) => { const e = document.querySelector(`.mt-node[data-session="${id}"] .mt-term-wrap`) || document.querySelector(`.mt-node[data-session="${id}"]`); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, ids.sh1);
  await page.mouse.click(nodeBox.x, nodeBox.y);
  await sleep(1500);
  const brief = await page.evaluate(() => !!document.querySelector('[data-role="briefing"]'));
  step('2a 오래 손대지 않은 세션을 눌러도 브리핑이 없다', !brief);
  const act = await page.evaluate(() => { const a = document.activeElement; return { xterm: !!(a && a.closest && a.closest('.xterm')) }; });
  step('2b 누르면 바로 터미널에 초점', act.xterm, act);
  await page.keyboard.type('echo p45-direct');
  await page.keyboard.press('Enter');
  const typed = await until(async () => { const t = await term(ids.sh1); return t && t.lines.some((l) => /^p45-direct/.test(l.trim())) ? true : null; }, 10000).catch(() => false);
  step('2c 친 글이 바로 셸에 간다', typed);
  step('2d 머리줄에 브리핑 단추가 없다', !(await page.evaluate(() => !!document.querySelector('[data-action="brief"]'))));
  await shot('no-briefing');
}

// ---------- 3. 배율 ----------
if (PARTS.has('scale')) {
  if (!ids.sh1) await spawn('sh1', '--kind', 'shell');
  const id = ids.sh1;
  const setScale = async (k, v) => {
    await page.evaluate(() => document.querySelector('[data-action="settings-open"]').click());
    await page.waitForSelector('[data-role="settings"]');
    await page.fill(`[data-field="setting-${k}"]`, String(v));
    await page.press(`[data-field="setting-${k}"]`, 'Enter');
    await sleep(300);
    await page.click('[data-action="settings-close"]');
    await sleep(1200);
  };
  const ui = () => page.evaluate(() => ({ zoom: window.mt.zoomFactor ? window.mt.zoomFactor() : null, inner: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio }));
  // 드래그 고르기가 마우스를 따라가는지: 셸에 줄을 찍고 줄 하나를 끌어 고른다
  const dragCheck = async (label) => {
    await page.evaluate((i) => window.__mt.terms.get(i).focus(), id);
    await page.keyboard.type('cls'); // 시험 줄이 화면 위쪽에 오게(아래 명령 바에 가리지 않게)
    await page.keyboard.press('Enter');
    await sleep(700);
    await page.keyboard.type(`echo DRAGTEST-${label}-ABCDEFGHIJ`);
    await page.keyboard.press('Enter');
    await sleep(800);
    const t = await term(id);
    const row = t.lines.findIndex((l) => l.startsWith(`DRAGTEST-${label}`));
    if (row < 0) { step(`3 ${label} 시험 줄을 찾음`, false, t.lines.slice(-6)); return; }
    const cw = t.rect.w / t.cols, ch = t.rect.h / t.rows;
    const y = t.rect.y + (row + 0.5) * ch;
    await page.mouse.move(t.rect.x + 0.3 * cw, y);
    await page.mouse.down();
    await page.mouse.move(t.rect.x + 6.5 * cw, y, { steps: 6 });
    await page.mouse.move(t.rect.x + 12.2 * cw, y, { steps: 6 });
    await page.mouse.up();
    await sleep(200);
    const sel = await page.evaluate((i) => window.__mt.terms.get(i).getSelection(), id);
    step(`3 ${label} 끌어 고르기가 마우스 밑 글자를 따라간다`, sel === `DRAGTEST-${label}-ABCDEFGHIJ`.slice(0, 12), { sel, cols: t.cols, rows: t.rows, font: t.fontSize });
    await page.keyboard.press('Escape');
  };
  const base = await term(id);
  log('100% 터미널', { cols: base.cols, rows: base.rows, font: base.fontSize, ui: await ui() });
  await dragCheck('base');
  for (const v of [80, 120]) {
    await setScale('termScale', v);
    const t = await term(id);
    step(`3a 터미널 글자 ${v}%: 글자 크기·칸 수가 바뀐다`, Math.abs(t.fontSize - base.fontSize * v / 100) < 0.6 && (v < 100 ? t.cols > base.cols : t.cols < base.cols), { font: t.fontSize, cols: t.cols, rows: t.rows });
    await dragCheck(`t${v}`);
    await shot(`term-${v}`);
  }
  for (const v of [90, 110]) {
    await setScale('uiScale', v);
    const u = await ui();
    step(`3b 화면 ${v}%: 창 배율이 바뀐다`, u.zoom && Math.abs(u.zoom - v / 100) < 0.001, u);
    await dragCheck(`u${v}`);
    await shot(`ui-${v}`);
  }
  // 다시 켜도 남는다
  await closeApp(app);
  await sleep(1500);
  await openApp();
  const after = await term(id) || await until(() => term(id), 20000);
  const u2 = await ui();
  const saved = await page.evaluate(() => { const st = window.__mt.getState(); return { term: st.termScale, ui: st.uiScale }; });
  step('3c 다시 켜도 배율이 남는다', saved.term === 1.2 && saved.ui === 1.1 && Math.abs(u2.zoom - 1.1) < 0.001 && Math.abs(after.fontSize - base.fontSize * 1.2) < 0.6, { saved, u2, font: after.fontSize });
  await dragCheck('restart');
  await shot('restart');
  await page.click('[data-action="settings-open"]');
  await page.waitForSelector('[data-role="settings"]');
  await sleep(300);
  step('3d 설정 일반 탭에 두 배율이 보인다', await page.evaluate(() => ['uiScale', 'termScale'].map((k) => document.querySelector(`[data-field="setting-${k}"]`).value).join(',')) === '110,120');
  await page.click('[data-action="termScale-down"]');
  await sleep(300);
  step('3e − 단추는 5% 줄인다', await page.evaluate(() => window.__mt.getState().termScale) === 1.15);
  await shot('settings');
  await page.click('[data-action="settings-close"]');
  await sleep(300);
  // 되돌린다
  await setScale('termScale', 100);
  await setScale('uiScale', 100);
}

log('결과', { pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length });
fs.writeFileSync(path.join(OUT, `${TAG}-results.json`), JSON.stringify(results, null, 2));
if (!argv.includes('--keep')) await closeApp(app);
process.exit(results.every((r) => r.ok) ? 0 : 1);
