// P52 창 시험: 크롬 이슈 #4(사이드바 머리줄의 세는 값), #5(대화상자 Esc·초점, 전체 보기와 떠 있는 크롬, 고른 탭의 세션 수 색).
// 판: herdr 세션 atrium-dev-p52, 포트 47871, 이 워크트리의 backend/.dev(experiments/p52/tools/env.cjs). 시험 폴더는 C:\Workspace\mtask-p52-*만.
// 사용: node experiments/p52/tools/e2e.cjs p52-chrome.mjs [--tag 이름] [--only 사례,...] [--no-claude]
// 결과: experiments/p52/<tag>.json, 스크린숏 <tag>-*.png
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p52') throw new Error('MT_E2E_OUT=p52를 명령줄에서 준다(experiments/p52/tools/e2e.cjs)');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p52', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P52_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p52' || ENV.ATRIUM_PORT !== '47871') throw new Error('p52 판(atrium-dev-p52, 47871)만');
for (const d of [T.DIR, T.DIR2]) if (!/^C:\\Workspace\\mtask-p52-/.test(d)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p52-*만: ${d}`);

const argv = process.argv.slice(2);
const TAG = argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : 'p52-chrome';
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const NO_CLAUDE = argv.includes('--no-claude');
const want = (n) => !ONLY || ONLY.includes(n);
const log = logger(TAG);
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: ok === null ? null : !!ok, detail }); log(`${ok === null ? '관찰' : ok ? '통과' : '실패'} ${name}`, detail ?? ''); };

const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = () => ({ ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION });
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: env(), timeout: 180000 });
const lastLine = (s) => String(s).trim().split(/\r?\n/).slice(-1)[0];
for (const d of [T.PROJECTS, T.SESSIONS, T.DIR, T.DIR2]) fs.mkdirSync(d, { recursive: true });

let app = null, page = null;
const errors = [];
const spawned = [];
const shot = async (n) => { const f = path.join(OUT, `${TAG}-${n}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const sessionOf = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? { id: s.sessionId, state: s.state, unseen: s.unseen, workspaceKey: s.workspaceKey } : null; }, name);
const waitState = (name, states, ms = 90000) => until(() => sessionOf(name).then((s) => (s && states.includes(s.state) ? s.state : null)), ms, 300);
async function spawn(dir, name, ...extra) {
  log(lastLine(atrium('spawn', dir, '--name', name, ...extra)));
  spawned.push(name);
  return until(() => page.evaluate((n) => { const st = window.__mt.getState(); const s = [...st.sessions.values()].find((x) => x.name === n); return s && st.nodes.has(s.sessionId) ? s.sessionId : null; }, name), 40000);
}
const active = () => page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return 'BODY'; if (a.closest && a.closest('.xterm')) return 'terminal'; const box = a.closest && a.closest('.mt-modal, [data-role="return-summary"], [data-role="loop-list"]'); return `${a.tagName}${a.dataset.action ? '[' + a.dataset.action + ']' : ''}${a.dataset.field ? '{' + a.dataset.field + '}' : ''}${box ? ' inside' : ''}`; });
// 사이드바의 워크스페이스 줄: 세는 값(data-count)
const sidebarWs = (name) => page.evaluate((n) => { const r = document.querySelector(`.mt-sb2-row.ws[data-name="${n}"]`); if (!r) return null; const c = {}; for (const e of r.querySelectorAll('[data-count]')) c[e.dataset.count] = Number(e.textContent); return c; }, name);
const cliWs = (name) => atrium('ws').split('\n').filter((l) => l.includes(name)).join(' ').trim();

const cases = {
  // #4: 사이드바 머리줄의 세는 값이 세션 상태를 따라가는가(창의 계산 값과 판의 atrium ws를 함께 남긴다)
  async sidebarCounts() {
    const ws = path.basename(T.DIR2);
    await page.keyboard.press('Control+Shift+E'); await sleep(800);
    const out = {};
    // 셸: 명령을 돌리는 동안(shell_running)과 끝난 뒤
    await spawn(T.DIR2, 'sc-sh', '--kind', 'shell');
    await waitState('sc-sh', ['shell_idle'], 30000);
    out.shellIdle = await sidebarWs(ws);
    atrium('input', 'sc-sh', 'Start-Sleep -Seconds 8\r');
    out.shellState = await waitState('sc-sh', ['shell_running'], 15000).catch(() => null);
    await sleep(600);
    out.shellRunning = await sidebarWs(ws);
    out.shellRunningCli = cliWs(ws);
    await shot('counts-1-shell-running');
    await waitState('sc-sh', ['shell_idle'], 30000);
    await sleep(600);
    out.shellDone = await sidebarWs(ws);
    let ok = out.shellRunning && out.shellRunning.working === 1 && out.shellDone && !out.shellDone.working;
    if (!NO_CLAUDE) {
      await spawn(T.DIR2, 'sc-cl', '--model', 'haiku');
      await waitState('sc-cl', ['ready'], 90000);
      atrium('send', '@sc-cl', 'Reply with exactly: ok');
      out.claudeState = await waitState('sc-cl', ['working'], 30000).catch(() => null);
      out.claudeWorking = await sidebarWs(ws);
      out.claudeWorkingCli = cliWs(ws);
      await shot('counts-2-claude-working');
      await waitState('sc-cl', ['ready'], 90000);
      await sleep(1500);
      out.claudeDone = await sidebarWs(ws);
      out.claudeDoneCli = cliWs(ws);
      await shot('counts-3-claude-done');
      ok = ok && (!out.claudeState || (out.claudeWorking && out.claudeWorking.working >= 1)) && out.claudeDone && !out.claudeDone.working;
    }
    out.storeSnapshot = await page.evaluate((n) => { const w = (window.__mt.getState().workspaces || []).find((x) => x.name === n); return w ? w.counts || null : null; }, ws);
    await page.keyboard.press('Control+Shift+E'); await sleep(300);
    step('sidebarCounts: 사이드바 워크스페이스 줄의 세는 값이 세션 상태를 바로 따라간다(#4)', ok, out);
  },
  // #5-1: 대화상자·떠 있는 창이 Esc로 닫히고, 열 때 초점이 안으로 들어가며, 닫으면 초점이 돌아오는가
  async escDialogs() {
    const res = {};
    const tryEsc = async (name, open, sel, { tab = false } = {}) => {
      await page.mouse.click(4, 600); await sleep(200);
      await open(); await sleep(700);
      const before = await active();
      let tabStays = null;
      if (tab) { for (let k = 0; k < 25; k++) await page.keyboard.press('Tab'); await sleep(100); tabStays = /inside$/.test(await active()); }
      await page.keyboard.press('Escape'); await sleep(450);
      const still = await page.evaluate((s) => !!document.querySelector(s), sel);
      res[name] = { focusOnOpen: before, closedByEsc: !still, tabStaysInside: tabStays, focusAfterClose: await active() };
      if (still) { await shot(`esc-${name.replace(/[^a-z]/gi, '')}-after-esc`); await page.mouse.click(4, 600); await sleep(300); await page.click('[data-action="return-close"]', { timeout: 1500 }).catch(() => {}); await page.click('[data-action="import-close"]', { timeout: 1500 }).catch(() => {}); await page.keyboard.press('Escape'); await sleep(300); }
    };
    await tryEsc('newSession', async () => { const b = (await page.$$('[data-role="rail-favorites"] [data-action="launch"]'))[0]; await page.keyboard.down('Shift'); await b.click(); await page.keyboard.up('Shift'); }, '.mt-modal', { tab: true });
    await tryEsc('openProject', () => page.click('[data-action="ws-open"]'), '.mt-modal', { tab: true });
    await tryEsc('changes', () => page.click('[data-action="changes"]'), '[data-role="return-summary"]');
    await tryEsc('settings', () => page.click('[data-action="settings-open"]'), '[data-role="settings"]', { tab: true });
    await tryEsc('loops', () => page.click('[data-action="loops-open"]'), '[data-role="loop-list"]');
    await tryEsc('desktopImport', async () => { await page.click('[data-action="ws-open"]'); await sleep(400); await page.click('[data-action="desktop-import-open"]'); }, '[data-role="desktop-import"]');
    // 터미널에서 친 Esc는 터미널 몫이다(에이전트 끊기). 떠 있는 변경 내역은 그대로 남아야 한다
    if (!(await sessionOf('fa'))) await spawn(T.DIR, 'fa', '--kind', 'shell');
    const fid = (await sessionOf('fa')).id;
    await page.evaluate((i) => window.__mt.getState().navigateTo(i, { focusTerminal: true }), fid); await sleep(1800);
    const scr = await page.$(`.mt-term[data-session="${fid}"] .xterm-screen`); const sb = await scr.boundingBox();
    await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2); await sleep(300);
    await page.evaluate(() => window.__mt.getState().showChanges(60)); await sleep(800);
    const inTerm = await active();
    await page.keyboard.press('Escape'); await sleep(400);
    res.terminalEsc = { focus: inTerm, panelOpen: await page.evaluate(() => !!document.querySelector('[data-role="return-summary"]')), closedByEsc: true };
    await page.click('[data-action="return-close"]').catch(() => {});
    const termOk = res.terminalEsc.focus === 'terminal' ? res.terminalEsc.panelOpen : null;
    if (termOk === false) res.terminalEsc.closedByEsc = false;
    const notClosed = Object.entries(res).filter(([, v]) => !v.closedByEsc).map(([k]) => k);
    const modal = ['newSession', 'openProject', 'settings', 'desktopImport'];
    const noFocus = modal.filter((k) => res[k] && !/inside$/.test(res[k].focusOnOpen));
    const leaks = Object.entries(res).filter(([, v]) => v.tabStaysInside === false).map(([k]) => k);
    step('escDialogs: Esc로 닫히고, 열면 초점이 안으로, Tab은 안에서 돈다(#5)', !notClosed.length && !noFocus.length && !leaks.length, { notClosed, focusNotInside: noFocus, tabLeaks: leaks, detail: res });
  },
  // #5-2: 전체 보기와 판 전체 정리 뒤 영역 이름표·노드 머리줄이 떠 있는 크롬 밑에 깔리지 않는가
  async fitUnderChrome() {
    if (!(await sessionOf('fa'))) { await spawn(T.DIR, 'fa', '--kind', 'shell'); await spawn(T.DIR, 'fb', '--kind', 'shell'); await spawn(T.DIR2, 'fc', '--kind', 'shell'); }
    await sleep(1200);
    const measure = () => page.evaluate(() => {
      const rect = (e) => e.getBoundingClientRect();
      const chrome = ['[data-role="top-left"]', '[data-role="top-right"]', '[data-role="rail-left"]', '[data-role="rail-right"]', '[data-role="chips"]', '[data-role="command-bar"]'].map((s) => [s, document.querySelector(s)]).filter(([, e]) => e && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).opacity !== '0').map(([s, e]) => [s, rect(e)]);
      const items = [...document.querySelectorAll('.react-flow__node-region .mt-rdrag, .react-flow__node-session .mt-node-head, .react-flow__node-memo, .react-flow__node-kanban')];
      const hits = [];
      for (const it of items) { const b = rect(it); for (const [s, c] of chrome) { const ox = Math.min(b.right, c.right) - Math.max(b.left, c.left), oy = Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top); if (ox > 4 && oy > 4) hits.push({ item: (it.innerText || '').split('\n')[0].slice(0, 30) || String(it.className).slice(0, 30), under: s, ox: Math.round(ox), oy: Math.round(oy) }); } }
      return { hits, zoom: +window.__mt.getState().viewport?.zoom?.toFixed?.(3) || null };
    });
    const out = {};
    for (const [w, h] of [[1584, 921], [1366, 768]]) {
      await app.evaluate(({ BrowserWindow }, [ww, hh]) => BrowserWindow.getAllWindows()[0].setContentSize(ww, hh), [w, h]); await sleep(700);
      await page.evaluate(() => window.__mt.getState().fitAll(0));
      await sleep(1200);
      out[`fit ${w}x${h}`] = await measure();
      await shot(`fit-${w}x${h}`);
    }
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1000);
    await page.evaluate(() => window.__mt.pinBottom(true)); await sleep(400);
    await page.click('[data-action="chip-arrange"]'); await sleep(300);
    await page.evaluate(() => window.__mt.pinBottom(false)); await sleep(1800);
    out.arrange = await measure();
    await shot('fit-after-arrange');
    await page.evaluate(() => window.__mt.pinBottom(true)); await sleep(400);
    await page.click('[data-action="chip-arrange-undo"]').catch(() => {}); await sleep(800);
    await page.evaluate(() => window.__mt.pinBottom(false)); await sleep(400);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921)); await sleep(500);
    const bad = Object.values(out).flatMap((m) => m.hits);
    step('fitUnderChrome: 전체 보기·판 정리 뒤 이름표와 머리줄이 떠 있는 크롬 밑에 깔리지 않는다(#5)', bad.length === 0, out);
  },
  // #5-3: 고른 워크스페이스 탭의 세션 수가 경고색(빨강)이 아닌가
  async tabBadge() {
    const r = await page.evaluate(() => {
      const el = document.querySelector('.mt-wsbtn.on .mt-ws-n');
      if (!el) return null;
      const cs = getComputedStyle(el);
      const probe = document.createElement('span'); probe.style.background = 'var(--badge-bg)'; probe.style.color = 'var(--badge-text)'; document.body.appendChild(probe);
      const p = getComputedStyle(probe); const red = { bg: p.backgroundColor, color: p.color }; probe.remove();
      return { bg: cs.backgroundColor, color: cs.color, red, text: el.textContent };
    });
    const el = await page.$('.mt-wsbtn.on'); if (el) await el.screenshot({ path: path.join(OUT, `${TAG}-tab-on.png`) });
    step('tabBadge: 고른 탭의 세션 수는 경고색을 쓰지 않는다(#5)', r && r.bg !== r.red.bg && r.color !== r.red.color, r);
  },
};

try {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env: env(), timeout: 60000 });
  page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text().slice(0, 300)); log(`[console.error] ${m.text().slice(0, 300)}`); } });
  page.on('pageerror', (e) => { errors.push(e.message.slice(0, 300)); log(`[pageerror] ${e.message}`); });
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(500);
  await call('settings.set', { key: 'language', value: 'ko' });
  await call('workspace.open', { path: T.DIR });
  await call('workspace.open', { path: T.DIR2 });
  await sleep(1000);
  for (const [name, fn] of Object.entries(cases)) {
    if (!want(name)) continue;
    log('--- 사례', name);
    try { await fn(); } catch (e) { step(`${name}: 예외`, false, String(e && (e.stack || e.message)).slice(0, 600)); await shot(`${name}-error`).catch(() => {}); }
  }
  step('창 콘솔 오류', errors.length === 0, errors.slice(0, 10));
} catch (e) {
  step('예외', false, String(e && (e.stack || e.message)).slice(0, 800));
} finally {
  for (const n of spawned) { try { log(lastLine(atrium('kill', n, '--yes'))); } catch (e) { log('kill', n, e.message.slice(0, 160)); } }
  if (app) await closeApp(app);
  fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  log('결과', results.map((r) => `${r.ok === null ? '·' : r.ok ? '✓' : '✗'} ${r.name}`).join('\n'));
  process.exit(results.some((r) => r.ok === false) ? 1 : 0);
}
