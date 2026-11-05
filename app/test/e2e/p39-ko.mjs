// P39 창 시험: 한국어 화면(Qualop 번역을 가져온 ko.js)에서 글이 넘치거나 잘리는 곳을 찾는다.
// 판: herdr 세션 atrium-dev-p39, 포트 47857, 이 워크트리의 backend/.dev(experiments/p39/tools/env.cjs). 셸 노드만 쓴다.
// 찍는 화면: 판 전체(영역 이름표, 워크트리 상자), 아래 칩, 응답 필요·확인할 결과 목록, 설정 탭 전부, 런처 편집, 새 세션 창,
//   덩어리 배치 틀, 미션 맵, 데스크톱 앱 가져오기, 사이드바, 노드 머리줄, 먼 배율 얼굴. 도구 레일 설명(title)은 글로 남긴다.
// 화면마다 글이 든 요소의 넘침(가로 넘침·말줄임, 숨긴 세로 넘침, 창 밖)을 재서 p39-ko.json에 남긴다.
// 사용: node experiments/p39/tools/e2e.cjs p39-ko.mjs [--fresh] [--keep]   (--keep: 끝에 세션을 끄지 않는다)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p39') throw new Error('MT_E2E_OUT=p39를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p39', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P39_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p39' || ENV.ATRIUM_PORT !== '47857') throw new Error('P39 판(atrium-dev-p39, 47857)만');
for (const d of [T.REPO, T.WT_A, T.DIR]) if (!/^C:\\Workspace\\mtask-p39-/.test(d)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p39-*만: ${d}`);
if (!path.resolve(T.DESK).startsWith(path.resolve(T.DEV))) throw new Error('가짜 앱 목록은 backend/.dev 안');
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const log = logger('p39-ko');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', windowsHide: true });
const keyOf = (p) => p.replace(/\\/g, '/').toLowerCase();
const result = { screens: {}, tips: {} };
let page = null, app = null;
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);

// ---------- 준비 ----------
if (argv.includes('--fresh')) {
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
  await sleep(800);
  for (const d of [path.join(T.DEV, 'data'), path.join(T.DEV, 'app'), T.PROJECTS, T.SESSIONS, T.DESK]) fs.rmSync(d, { recursive: true, force: true });
  if (fs.existsSync(T.WT_A)) { try { git(T.REPO, 'worktree', 'remove', '--force', T.WT_A); } catch {} }
  for (const d of [T.REPO, T.DIR]) fs.rmSync(d, { recursive: true, force: true });
}
for (const d of [T.PROJECTS, T.SESSIONS, T.DIR, T.DESK_LIST]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(path.join(T.REPO, '.git'))) {
  fs.mkdirSync(T.REPO, { recursive: true });
  git(T.REPO, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(T.REPO, 'README.md'), 'p39 test repo\n');
  fs.writeFileSync(path.join(T.REPO, '.gitignore'), '.claude/\n');
  git(T.REPO, 'add', '.');
  git(T.REPO, '-c', 'user.email=p39@test', '-c', 'user.name=p39', 'commit', '-q', '-m', 'init');
}
// 가짜 데스크톱 앱 목록(대화 기록은 없다: 목록과 상태 글만 본다)
const deskRecs = [
  { key: 'a', title: 'Refactor the settings dialog layout', cwd: T.REPO },
  { key: 'b', title: 'Worktree session for a long feature branch name', cwd: T.WT_A, worktreePath: T.WT_A, worktreeName: 'feat-a', branch: 'feat-a' },
  { key: 'c', title: 'Folder session', cwd: T.DIR },
];
let t0 = Date.now() - 3 * 60000;
for (const r of deskRecs) {
  const appId = `local_p39-${r.key}`;
  const rec = { sessionId: appId, cliSessionId: `00000000-0000-4000-8000-00000000003${r.key === 'a' ? 1 : r.key === 'b' ? 2 : 3}`, priorCliSessionIds: [], model: 'haiku', effort: 'low', permissionMode: 'default', isArchived: false, isStarred: false, lastActivityAt: (t0 += 60000), adoptedFromOtherSurface: false, originCwd: T.REPO, title: r.title, cwd: r.cwd, ...(r.worktreePath ? { worktreePath: r.worktreePath, worktreeName: r.worktreeName, branch: r.branch } : {}) };
  fs.writeFileSync(path.join(T.DESK_LIST, `${appId}.json`), JSON.stringify(rec, null, 2));
}

async function open() {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true)); // P43: 아래 바를 늘 보이게(이 시험은 바를 바로 누른다)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(500);
}
const ids = {};
const spawned = [];
async function spawnShell(cwd, name) {
  log(atrium('spawn', cwd, '--kind', 'shell', '--name', name).trim().split('\n').slice(-1)[0]);
  spawned.push(name);
  ids[name] = await until(() => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }, name), 30000);
}
async function view(cx, cy, zoom) {
  await page.evaluate(([x, y, z]) => { const st = window.__mt.getState(); const el = document.querySelector('.mt-canvas'); st.setViewport({ x: el.clientWidth / 2 - x * z, y: el.clientHeight / 2 - y * z, zoom: z }); }, [cx, cy, zoom]);
  await sleep(900);
}
const fitAll = async () => { await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(900); };
const esc = async () => { await page.keyboard.press('Escape'); await sleep(300); };

// 글이 든 요소의 넘침: 가로 넘침(말줄임 포함, overflow-x가 visible이 아님), 숨긴 세로 넘침, 창 밖으로 나감
async function overflow(sel) {
  return page.evaluate((s) => {
    const root = s ? document.querySelector(s) : document.body;
    if (!root) return { missing: s };
    const W = window.innerWidth, H = window.innerHeight;
    const bad = [];
    for (const el of root.querySelectorAll('*')) {
      if (el.closest('.xterm, svg, canvas, .react-flow__minimap, textarea, input, select')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.display === 'inline') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim();
      if (!own) continue;
      const why = [];
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') why.push(cs.textOverflow === 'ellipsis' ? 'ellipsis' : `clipX(${cs.overflowX})`);
      if (el.scrollHeight > el.clientHeight + 1 && (cs.overflowY === 'hidden' || cs.overflowY === 'clip')) why.push('clipY');
      if (!el.closest('.react-flow__node') && (r.right > W + 1 || r.bottom > H + 1 || r.left < -1)) why.push('offscreen');
      if (why.length) bad.push({ why: why.join(','), text: own.slice(0, 90), cls: String(el.className).slice(0, 50), w: Math.round(el.clientWidth), sw: el.scrollWidth });
    }
    return bad;
  }, sel);
}
async function screen(name, sel, opts = {}) {
  await sleep(opts.wait ?? 400);
  const f = path.join(OUT, `p39-ko-${name}.png`);
  if (sel && opts.crop) { const h = await page.$(sel); if (h) await h.screenshot({ path: f }); else await page.screenshot({ path: f }); } else await page.screenshot({ path: f });
  const of = await overflow(opts.measure ?? sel);
  result.screens[name] = of;
  log(`찍음 ${name}: 넘침 ${Array.isArray(of) ? of.length : JSON.stringify(of)}`, Array.isArray(of) ? JSON.stringify(of.slice(0, 6)) : '');
}

try {
  await open();
  await call('settings.set', { key: 'language', value: 'ko' });
  await call('workspace.open', { path: T.REPO });
  await call('workspace.open', { path: T.DIR });
  await page.waitForSelector('.react-flow__node-region');
  if (!fs.existsSync(T.WT_A)) { fs.mkdirSync(path.dirname(T.WT_A), { recursive: true }); git(T.REPO, 'worktree', 'add', '-q', '-b', 'feat-a', T.WT_A); }
  for (const [cwd, n] of [[T.REPO, 'lead'], [T.REPO, 'reviewer'], [T.REPO, 'worker'], [T.WT_A, 'wt1'], [T.DIR, 'd1']]) if (!spawned.includes(n)) await spawnShell(cwd, n);
  await sleep(1500);

  // 판 전체, 영역 이름표, 워크트리 상자
  await fitAll();
  await screen('board');
  const repoKey = keyOf(path.join(T.REPO, '.git'));
  const reg = await page.evaluate((k) => window.__mt.getState().regionOf(k), repoKey);
  await page.evaluate((k) => window.__mt.getState().fitWorkspace(k), repoKey); await sleep(900);
  const label = await page.$(`.react-flow__node[data-id="ws:${repoKey}"] .mt-rdrag`);
  if (label) { try { await label.hover({ timeout: 5000 }); await sleep(500); } catch (e) { log('이름표 hover', e.message.split('\n')[0]); } }
  await screen('region-label', `.react-flow__node[data-id="ws:${repoKey}"]`);
  await screen('worktree-box', '.react-flow__node-wtarea');

  // 아래 칩
  await screen('chips', '[data-role="chips"]', { crop: true, measure: 'body' });

  // 응답 필요·확인할 결과 목록
  for (const role of ['inbox', 'review', 'issues']) {
    if (!(await page.$(`[data-role="${role}"]`))) { log('없음', role); continue; }
    await page.click(`[data-role="${role}"]`);
    await screen(role, null, { measure: 'body' });
    await page.click(`[data-role="${role}"]`); await sleep(300);
  }

  // 설정 탭 전부
  await page.click('[data-action="settings-open"]');
  await page.waitForSelector('[data-role="settings"] [data-role="settings-tabs"]');
  const tabs = await page.$$eval('[data-role="settings-tabs"] [data-tab]', (els) => els.map((e) => e.dataset.tab));
  for (const tab of tabs) {
    await page.click(`[data-role="settings-tabs"] [data-tab="${tab}"]`);
    await screen(`settings-${tab}`, '[data-role="settings"]');
    if (tab === 'launchers') {
      if (await page.$('[data-action="launcher-new"]')) { await page.click('[data-action="launcher-new"]'); await page.waitForSelector('[data-role="launcher-form"]'); await screen('settings-launcher-form', '[data-role="settings"]'); await page.click('[data-action="launcher-cancel"]').catch(() => {}); }
      if (await page.$('[data-action="launcher-new-command"]')) { await page.click('[data-action="launcher-new-command"]'); await page.waitForSelector('[data-role="launcher-form"]'); await screen('settings-launcher-command', '[data-role="settings"]'); await page.click('[data-action="launcher-cancel"]').catch(() => {}); }
    }
  }
  await page.click('[data-role="settings"] [data-action="settings-close"]').catch(esc);
  await sleep(300);

  // 새 세션 창
  await page.click('[data-action="chip-spawn"]');
  await page.waitForSelector('[data-role="spawn"]');
  await screen('spawn', '[data-role="spawn"]');
  const kinds = await page.$$eval('[data-role="spawn"] select option', (os) => os.map((o) => ({ v: o.value, t: o.textContent, sel: o.parentElement.dataset.field || o.parentElement.name || '' })));
  result.spawnOptions = kinds;
  await page.click('[data-role="spawn"] button.ghost').catch(esc);
  await page.waitForSelector('[data-role="spawn"]', { state: 'detached', timeout: 5000 }).catch(() => log('새 세션 창이 닫히지 않았다'));

  // 도구 레일 설명(title)
  result.tips = await page.$$eval('[data-role="rail-left"] [title], [data-role="rail-right"] [title], [data-role="chips"] [title]', (els) => els.map((e) => e.getAttribute('title')));

  // 덩어리 배치 틀
  await page.evaluate((k) => window.__mt.getState().fitWorkspace(k), repoKey); await sleep(900);
  for (const n of ['lead', 'reviewer', 'worker']) { await page.click(`.mt-node[data-name="${n}"] .mt-node-head`, { modifiers: ['Control'], timeout: 5000 }).catch((e) => log('고르기', e.message.split('\n')[0])); await sleep(250); }
  if (await page.$('[data-role=selection]')) {
    await screen('selection', '[data-role=selection]');
    if (await page.isVisible('[data-role=selection] [data-action=layout-more]')) { await page.click('[data-role=selection] [data-action=layout-more]'); await sleep(400); await screen('selection-presets', '[data-role=selection]'); }
  } else log('배치 틀이 보이지 않는다');
  await esc();
  const blank = await page.evaluate(() => { const r = document.querySelector('.mt-canvas').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height - 30 }; });
  await page.mouse.click(blank.x, blank.y); await sleep(300);

  // 미션 맵
  await page.click('[data-action="mission-rail"]');
  await page.waitForSelector('[data-role="mission"]');
  await screen('mission', '[data-role="mission"]', { wait: 1200 });
  await page.click('[data-action="mission-close"]').catch(esc);
  await sleep(300);

  // 데스크톱 앱 가져오기
  await page.click('[data-action="ws-open"]');
  await page.waitForSelector('[data-action="desktop-import-open"]', { timeout: 5000 });
  await screen('ws-menu', null, { measure: 'body' });
  await page.click('[data-action="desktop-import-open"]');
  await page.waitForSelector('[data-role="desktop-import"]');
  await sleep(1500);
  await screen('desktop-import', '[data-role="desktop-import"]');
  await page.click('[data-action="import-close"]').catch(esc);
  await sleep(300);

  // 사이드바
  await page.click('[data-action="sidebar"]');
  await page.waitForSelector('[data-role="sidebar"]');
  await screen('sidebar', '[data-role="sidebar"]', { wait: 800 });
  await page.click('[data-action="sidebar"]').catch(esc);
  await sleep(300);

  // 노드 머리줄(배율 1)과 먼 배율 얼굴
  const r = await page.evaluate((i) => { const x = window.__mt.getState().nodes.get(i); return x && { x: x.x, y: x.y, w: x.w, h: x.h }; }, ids.lead);
  await view(r.x + r.w / 2, r.y + r.h / 2, 1);
  await screen('node-head', `.mt-node[data-name="lead"]`);
  await fitAll();
  await view(reg.x + reg.w / 2, reg.y + reg.h / 2, 0.2);
  await screen('far', null, { measure: '.mt-canvas', wait: 1200 });
  await view(reg.x + reg.w / 2, reg.y + reg.h / 2, 0.4);
  await screen('mid', null, { measure: '.mt-canvas', wait: 1200 });
} catch (e) {
  log('오류', e.stack);
  result.error = e.message;
  if (page) await page.screenshot({ path: path.join(OUT, 'p39-ko-fail.png') }).catch(() => {});
} finally {
  if (!argv.includes('--keep')) for (const n of spawned) { try { log(atrium('kill', n, '--yes').trim().split('\n').slice(-1)[0]); } catch (e) { log('kill', n, e.message.slice(0, 200)); } }
  if (app) await closeApp(app);
  fs.writeFileSync(path.join(OUT, 'p39-ko.json'), JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2));
  process.exit(result.error ? 1 : 0);
}
