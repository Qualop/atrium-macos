// P98 창 시험: 위 바의 묶음 칩(고치기 전·뒤)과, Codex를 띄운 뒤 세션 가운데에 보인 초록 점 찾기.
// 판: herdr 세션 atrium-dev-p98, 포트 47897, 이 워크트리의 backend/.dev(data, app). 창의 원격 디버깅 포트 9377.
// P98_STAGE
//   bar-before | bar-after: backend/.dev/dist-before|dist-after(고치기 전·뒤 빌드)를 app/dist로 바꿔 끼우고 위 바를 찍는다.
//     장면: C:\Workspace\mtask-p98\ 아래 새 폴더 열한 개를 빈 프로젝트로 연다(사용자 그림 모양). 묶음 둘: 사람이 만든 그룹 lab(lab-x, lab-y),
//     저절로 만든 폴더 묶음 proj(proj\web, proj\web\collector, proj\api, 뿌리에 README.md). 세션 수와 응답 필요는 메모리 때문에 창 안에서 흉내 낸다(session.updated).
//   dot: C:\Workspace\mtask-p98-dot에 haiku 리드 lead, lead가 atrium child --kind codex로 띄운 Codex 워커 cx-child, 레일(호출자)로 띄운 Codex cx-rail.
//     얼굴(close, middle, far, icon) × 덩어리 안·밖 × 잇기 모드 안·밖 × (그대로, 고름, 가리킴)마다 창을 찍고, 세션 노드 안의 초록(#75ec9c 언저리) 요소와 픽셀을 센다.
//     P98_DOT_TAG(before|after)로 결과 이름을 나눈다(고치기 전 빌드는 dist-before를 끼운다: P98_DIST=before).
//   clean: 세션 끄기, 판 멈추기, 시험 폴더 지우기.
// 결과는 experiments/p98/(git 밖). 신뢰 질문이 뜨면 대신 답하지 않는다(Claude Code면 backend/.dev/p98-need-trust.txt에 적고 멈춘다. Codex 신뢰 질문은 그대로 두고 띄우기까지만 본다).
// 실행(워크트리 루트): sh backend/.dev/clean-env.sh env P98_STAGE=bar-before node app/test/e2e/p98-topbar.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const STAGE = process.env.P98_STAGE || 'bar-after';
if (!['bar-before', 'bar-after', 'dot', 'workers', 'clean'].includes(STAGE)) throw new Error('P98_STAGE=bar-before|bar-after|dot|workers|clean');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p98');
const CONVOS = path.join(OUT, 'convos');
const ROOT = 'C:\\Workspace\\mtask-p98';
const DOT = 'C:\\Workspace\\mtask-p98-dot';
const BOARD = { session: 'atrium-dev-p98', port: 47897, cdp: 9377 };
const ENV = {
  ATRIUM_HERDR_SESSION: BOARD.session, ATRIUM_PORT: String(BOARD.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p98',
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)) delete process.env[k];
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, until, APP_ROOT, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p98' || ENV.ATRIUM_PORT !== '47897') throw new Error('P98 판(atrium-dev-p98, 47897)만');
const { pathKey } = await import(pathToFileURL(path.join(REPO, 'backend', 'src', 'workspaces.mjs')).href);

const TAG = STAGE === 'dot' || STAGE === 'workers' ? `${STAGE}-${process.env.P98_DOT_TAG || 'after'}` : STAGE;
const log = logger(`p98-${TAG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 180000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { log(`지우기 실패 ${p}: ${e.message.slice(0, 120)}`); } };
const killAll = () => { for (const s of sessions()) { try { atrium('kill', s.sessionId, '--yes', '--delete'); log('끔', s.name); } catch (e) { log('끄기 실패', s.name, e.message.slice(0, 160)); } } };

// ---------- 정리 ----------
if (STAGE === 'clean') {
  try { killAll(); } catch (e) { log('목록 실패', e.message.slice(0, 160)); }
  try { log('herdr 멈춤', atrium('herdr', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { log('herdr 멈춤 실패', e.message.slice(0, 200)); }
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log('백엔드 멈춤 실패', e.message.slice(0, 200)); }
  for (const p of [ROOT, DOT]) rmrf(p);
  process.exit(0);
}

// ---------- 창 ----------
let app = null, page = null;
const shot = async (name, clip = null) => { const f = path.join(OUT, `${TAG}-${name}.png`); await page.screenshot({ path: f, ...(clip ? { clip } : {}) }); log(`스크린숏 experiments/p98/${TAG}-${name}.png`); return f; };
async function openWindow() {
  const { _electron: electron } = await import('playwright');
  app = await electron.launch({ args: ['.', '--dev', `--remote-debugging-port=${BOARD.cdp}`], cwd: APP_ROOT, env: process.env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[console.error] ${m.text().slice(0, 300)}`); });
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 891)); // 창 안쪽 16:9쯤
  await page.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
  await sleep(2000);
}
function useDist(which) {
  const src = path.join(DEV, `dist-${which}`), dst = path.join(APP_ROOT, 'dist');
  if (!fs.existsSync(src)) throw new Error(`빌드 없음: ${src}`);
  rmrf(dst); fs.cpSync(src, dst, { recursive: true });
  log(`app/dist ← backend/.dev/dist-${which}`);
}

// ================= 위 바 =================
const F = {
  alpha: path.join(ROOT, 'alpha'), beta: path.join(ROOT, 'beta'), gamma: path.join(ROOT, 'gamma'), 'lab-x': path.join(ROOT, 'lab-x'),
  web: path.join(ROOT, 'proj', 'web'), 'lab-y': path.join(ROOT, 'lab-y'), empty: path.join(ROOT, 'empty'), core: path.join(ROOT, 'core'),
  collector: path.join(ROOT, 'proj', 'web', 'collector'), api: path.join(ROOT, 'proj', 'api'), notes: path.join(ROOT, 'notes'),
};
const ORDER = ['alpha', 'beta', 'gamma', 'lab-x', 'web', 'lab-y', 'empty', 'core', 'collector', 'api', 'notes']; // 사용자 그림처럼 열린 순서
const COUNTS = { alpha: 1, beta: 1, gamma: 1, 'lab-x': 1, web: 1, 'lab-y': 2, empty: 0, core: 3, collector: 1, api: 0, notes: 2 };
const NEED = { collector: 1 };
const key = (n) => pathKey(F[n]);

async function setupBar() {
  for (const f of Object.values(F)) fs.mkdirSync(f, { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'proj', 'README.md'), '# p98 test project root\n');
  killAll();
  for (const n of ORDER) { atrium('ws', 'open', F[n]); await sleep(150); }
  if (!(call('group.list').groups || []).some((x) => x.name === 'lab')) { const g = call('group.create', { name: 'lab', workspaces: [key('lab-x'), key('lab-y')] }); log('그룹 lab', g.created); }
  const auto = await until(() => { const r = call('workspace.list'); return (r.groups || []).find((x) => x.auto && /mtask-p98\/proj$/.test(x.root)); }, 60000, 1500).catch(() => null);
  log('저절로 만든 묶음', auto && { name: auto.name, members: auto.members });
  atrium('ws', 'select', key('core'));
}
const fakeSessions = () => {
  const out = [];
  let i = 0;
  for (const n of ORDER) for (let j = 0; j < COUNTS[n]; j++) {
    const need = j < (NEED[n] || 0);
    out.push({ sessionId: `fake-${++i}`, name: `${n}-${j + 1}`, workspaceKey: key(n), kind: 'shell', state: need ? 'waiting' : 'shell_idle', ask: need ? { kind: 'permission', tool: 'Bash', since: Date.now() } : null, createdAt: Date.now() - 60000, lastActivityAt: Date.now() });
  }
  return out;
};
const barClip = async (extraH = 0) => { const r = await page.evaluate(() => { const b = document.querySelector('[data-role="top-left"]').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }); return { x: 0, y: 0, width: Math.min(1584, Math.ceil(r.x + r.width + 16)), height: Math.ceil(r.y + r.height + 12 + extraH) }; };
const barInfo = () => page.evaluate(() => {
  const seg = document.querySelector('[data-role="workspaces"]');
  const chips = [...seg.querySelectorAll('.mt-wsbtn')].map((c) => ({ ws: c.dataset.ws || null, group: c.dataset.group || null, name: c.dataset.name, on: c.classList.contains('on'), text: c.textContent.trim(), sessions: +((c.querySelector('[data-count="sessions"]') || {}).textContent || NaN), need: +((c.querySelector('[data-count="needsYou"]') || {}).textContent || 0), x: !!c.querySelector('[data-action="ws-close"]'), sub: (c.querySelector('[data-role="ws-group-current"]') || {}).textContent || null }));
  return { chips, width: seg.scrollWidth, shown: seg.clientWidth, current: window.__mt.getState().currentWs };
});
const viewRect = () => page.evaluate(() => { const vp = window.__mt.getState().vpNow, s = window.__mt.getState().canvasSize; return vp && s ? { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: s.width / vp.zoom, h: s.height / vp.zoom, zoom: vp.zoom } : null; });
const regionRect = (k) => page.evaluate((key) => window.__mt.getState().regionOf(key), k);
const contains = (v, r) => v && r && r.x >= v.x - 2 && r.y >= v.y - 2 && r.x + r.w <= v.x + v.w + 2 && r.y + r.h <= v.y + v.h + 2;

async function barStage(which) {
  useDist(which);
  log(atrium('backend', 'start').trim().slice(0, 300));
  try { atrium('settings', 'set', 'tray', 'off'); } catch (e) { log('트레이 끄기 실패', e.message.slice(0, 120)); }
  try { atrium('settings', 'set', 'language', 'ko'); } catch {}
  await setupBar();
  await openWindow();
  await page.evaluate((fakes) => { for (const s of fakes) window.__mt.api.emit('session.updated', s); }, fakeSessions());
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  await sleep(1500);
  const report = { stage: STAGE };

  // 1. 지금 core(묶음 밖)
  report.core = await barInfo();
  log('바(core)', report.core.chips.map((c) => `${c.on ? '*' : ''}${c.group ? `[${c.name}]` : c.name}${c.sub ? `›${c.sub}` : ''} ${c.need ? `!${c.need} ` : ''}${c.sessions}${c.x ? ' ×' : ''}`).join(' | '), `폭 ${report.core.width}`);
  await shot('1-bar-core', await barClip());
  await shot('1-window-core');
  // 2. 지금 collector(묶음 안)
  await page.evaluate((k) => { const el = document.querySelector(`.mt-wsbtn[data-ws="${CSS.escape(k)}"]`); if (el) el.click(); else window.__mt.api.call('workspace.select', { workspace: k }); }, key('collector'));
  await sleep(300);
  // 묶음 안 순서는 그룹 구성 순서(저절로 만든 묶음은 구성이 들어온 순서)
  const groupKeys = await page.evaluate(() => Object.fromEntries((window.__mt.getState().groups || []).map((g) => [g.name, g.members])));
  const LABEL = { [key('web')]: 'web', [key('collector')]: 'web/collector', [key('api')]: 'api', [key('lab-x')]: 'lab-x', [key('lab-y')]: 'lab-y' };
  report.groupKeys = groupKeys;
  log('묶음 구성 순서', Object.fromEntries(Object.entries(groupKeys).map(([g, ks]) => [g, ks.map((k) => LABEL[k] || k)])));
  if (which === 'after') { // 고친 뒤에는 collector 칩이 없다(묶음 안). 펼침 목록으로 고른다
    await page.locator('.mt-wsgrp[data-name="proj"] [data-action="ws-group-open"]').click();
    await sleep(300);
    await shot('2a-menu-open', await barClip(170));
    report.menu = await page.evaluate(() => [...document.querySelectorAll('[data-role="ws-group-menu"] [role="menuitem"]')].map((m) => ({ ws: m.dataset.ws, text: m.textContent.trim(), on: m.classList.contains('on'), x: !!m.querySelector('[data-action="ws-close"]') })));
    log('펼침 목록', report.menu);
    const row = (n) => report.menu.find((m) => m.ws === key(n)) || {};
    check('펼침 목록: 구성 셋(그룹 순서, 이름은 뿌리에서의 상대 경로), 빈 api에 ×, web/collector에 응답 필요 1', report.menu.map((m) => m.ws).join() === groupKeys.proj.join() && report.menu.map((m) => m.text.replace(/\d+$/, '').replace(/^\d/, '')).join() === groupKeys.proj.map((k) => LABEL[k]).join() && row('api').x && !row('web').x && /^1/.test(row('collector').text), report.menu);
    await page.locator('[data-role="ws-group-menu"] [role="menuitem"]', { hasText: 'web/collector' }).click();
    await sleep(1200);
    check('목록에서 고르면 닫히고 그 워크스페이스가 지금', !(await page.locator('[data-role="ws-group-menu"]').count()) && (await barInfo()).current === key('collector'));
  }
  report.collector = await barInfo();
  log('바(collector)', report.collector.chips.map((c) => `${c.on ? '*' : ''}${c.group ? `[${c.name}]` : c.name}${c.sub ? `›${c.sub}` : ''} ${c.need ? `!${c.need} ` : ''}${c.sessions}${c.x ? ' ×' : ''}`).join(' | '));
  await shot('2-bar-collector', await barClip());

  if (which === 'before') {
    check('[전] 칩 수 = 워크스페이스 수', report.core.chips.length === ORDER.length, { chips: report.core.chips.length, width: report.core.width });
  } else {
    const c = report.core.chips;
    const names = c.map((x) => (x.group ? `[${x.name}]` : x.name));
    check('칩 여덟 개(묶음 둘은 대표 칩 하나씩, 첫 구성의 자리)', names.join(',') === 'alpha,beta,gamma,[lab],[proj],empty,core,notes', names);
    const lab = c.find((x) => x.name === 'lab'), proj = c.find((x) => x.name === 'proj');
    check('수 합: lab 3, proj 2, proj 응답 필요 1', lab && lab.sessions === 3 && proj && proj.sessions === 2 && proj.need === 1 && !lab.need, { lab, proj });
    check('묶음 칩에는 ×가 없고 빈 empty 칩에는 있다', !lab.x && !proj.x && c.find((x) => x.name === 'empty').x);
    const pc = report.collector.chips.find((x) => x.name === 'proj');
    check('지금이 묶음 안이면 대표 칩이 켜지고 안의 이름을 작게', pc && pc.on && pc.sub === 'web/collector' && pc.ws === key('collector'), pc);
    log('바 폭', report.core.width, '(고치기 전 값은 p98-bar-before.json)');
    // 3. ←·→: 칩 순서, 묶음 칩 자리에서는 그룹 순서로 편 것
    const flat = ['alpha', 'beta', 'gamma'].map(key).concat(groupKeys.lab, groupKeys.proj, ['empty', 'core', 'notes'].map(key));
    const step = (k, d) => flat[(flat.indexOf(k) + d + flat.length) % flat.length];
    const want = [step(key('collector'), 1)]; want.push(step(want[0], -1)); want.push(step(step(want[1], -1), -1)); want.push(step(want[2], -1));
    await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
    await page.keyboard.press('ArrowRight'); await sleep(500);
    const r1 = (await barInfo()).current;
    await page.keyboard.press('ArrowLeft'); await sleep(500);
    const r2 = (await barInfo()).current;
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await sleep(500);
    const r3 = (await barInfo()).current; // collector → web → api
    await page.keyboard.press('ArrowLeft'); await sleep(500);
    const r4 = (await barInfo()).current; // api → lab-y
    check('←·→: 묶음 칩 자리에서 구성을 그룹 순서로 지난다(→, ←, ←←, ←)', [r1, r2, r3, r4].join() === want.join(), { got: [r1, r2, r3, r4].map((k) => LABEL[k] || k), want: want.map((k) => LABEL[k] || k), flat: flat.map((k) => LABEL[k] || k.split('/').pop()) });
    const lastProj = [key('collector'), r1, r2, step(r2, -1), r3, r4].filter((k) => groupKeys.proj.includes(k)).pop(); // ←← 사이에 지난 것도 센다
    await shot('3-bar-after-arrows', await barClip());
    // 4. 묶음 칩 누르기: 지금 core에서 proj를 누르면 마지막으로 고른 구성(api, ←로 지난 것)을 고르고 묶음 전체로 화면을 맞춘다
    await page.locator('.mt-wsbtn[data-ws="' + key('core') + '"]').click(); await sleep(1200);
    await page.locator('.mt-wsgrp[data-name="proj"] .mt-ws-name').click(); await sleep(1500);
    const v = await viewRect();
    const rs = await Promise.all(['web', 'collector', 'api'].map((n) => regionRect(key(n))));
    const cur = (await barInfo()).current;
    check('묶음 칩을 누르면 구성 영역 셋이 모두 화면 안', rs.every((r) => contains(v, r)), { v, rs });
    check('묶음 칩을 누르면 그 묶음에서 마지막으로 고른 구성이 지금', cur === lastProj, { cur: LABEL[cur] || cur, lastProj: LABEL[lastProj] });
    await shot('4-window-group-fit');
    // 5. 묶음 칩 키보드: Tab으로 칩, Enter로 묶음 고르기, ▾는 Enter·↓로 펼치고 Esc로 닫는다
    await page.locator('.mt-wsgrp[data-name="lab"] [data-action="ws-group-open"]').focus();
    await page.keyboard.press('Enter'); await sleep(300);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('role'));
    await page.keyboard.press('ArrowDown'); await sleep(100);
    const second = await page.evaluate(() => document.activeElement && document.activeElement.dataset.name);
    await page.keyboard.press('Escape'); await sleep(200);
    const closed = !(await page.locator('[data-role="ws-group-menu"]').count());
    check('▾ 키보드: Enter로 펼치면 첫 줄에 초점, ↓로 다음, Esc로 닫음', focused === 'menuitem' && second === LABEL[groupKeys.lab[1]] && closed, { focused, second, closed });
  }
  report.results = results;
  fs.writeFileSync(path.join(OUT, `p98-${TAG}.json`), JSON.stringify(report, null, 2));
}

// ================= 초록 점 =================
const CHILD_ENV = (name) => {
  const s = byName(name);
  const settings = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'sessions', `${s.sessionId}.json`), 'utf8'));
  const e = { ...process.env, ...Object.fromEntries(Object.entries(settings.env || {}).filter(([k]) => k.startsWith('ATRIUM_'))) };
  if (e.ATRIUM_SESSION_ID !== s.sessionId || !e.ATRIUM_SESSION_TOKEN) throw new Error(`${name} 설정 파일에 세션 env가 없다`);
  return e;
};
async function readyOf(name, ms = 150000, states = ['ready', 'trust_wait', 'working', 'waiting']) {
  const s = await until(() => { const x = byName(name); return x && states.includes(x.state) ? x : null; }, ms, 1500).catch(() => null);
  return s;
}
// 창 안: 세션 노드 안(가장자리 20px 포함)의 초록 요소(계산된 색이 초록 언저리이고 보이는 것)
const greenDom = () => page.evaluate(() => {
  const isGreen = (c) => { const m = String(c || '').match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/); if (!m) return false; const [r, g, b, a = 1] = m.slice(1).map(Number); if (a < 0.25) return false; return g > 150 && g > r + 50 && g > b + 25; };
  const nodes = [...document.querySelectorAll('.react-flow__node-session')].map((n) => ({ id: n.dataset.id, name: (n.querySelector('.mt-node') || {}).dataset?.name, r: n.getBoundingClientRect() }));
  const effOpacity = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return o; };
  const out = [];
  for (const el of document.querySelectorAll('.react-flow__renderer *')) {
    const cs = getComputedStyle(el);
    const hit = ['backgroundColor', 'fill', 'stroke', 'borderTopColor', 'color'].filter((p) => isGreen(cs[p]) && (p !== 'borderTopColor' || parseFloat(cs.borderTopWidth) > 0) && (p !== 'color' || (el.childNodes.length && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()))) && (p !== 'fill' || el instanceof SVGElement) && (p !== 'stroke' || (el instanceof SVGElement && cs.stroke !== 'none')));
    if (!hit.length) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    const o = effOpacity(el);
    if (o < 0.15) continue;
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const n = nodes.find((x) => cx >= x.r.left - 20 && cx <= x.r.right + 20 && cy >= x.r.top - 20 && cy <= x.r.bottom + 20);
    if (!n) continue;
    out.push({ cls: (el.getAttribute('class') || el.tagName).slice(0, 80), tag: el.tagName, props: hit, color: cs[hit[0]], opacity: +o.toFixed(2), node: n.name, w: Math.round(r.width), h: Math.round(r.height), rel: [+((cx - n.r.left) / n.r.width).toFixed(2), +((cy - n.r.top) / n.r.height).toFixed(2)] });
  }
  return out;
});
// 창 스크린숏의 픽셀에서 #75ec9c 언저리(차이 40 안)를 4px 칸으로 모은다(터미널 캔버스에 그린 것도 잡는다). 세션 노드 안만
async function greenPixels() {
  const buf = await page.screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const dpr = img.width / innerWidth;
    const nodes = [...document.querySelectorAll('.react-flow__node-session')].map((n) => ({ name: (n.querySelector('.mt-node') || {}).dataset?.name, r: n.getBoundingClientRect() }));
    const cells = new Map();
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4, dr = d[i] - 117, dg = d[i + 1] - 236, db = d[i + 2] - 156;
      if (dr * dr + dg * dg + db * db > 1600) continue;
      const k = `${Math.floor(x / dpr / 4)},${Math.floor(y / dpr / 4)}`; cells.set(k, (cells.get(k) || 0) + 1);
    }
    // 이웃 칸끼리 덩어리
    const seen = new Set(), blobs = [];
    for (const k of cells.keys()) {
      if (seen.has(k)) continue;
      const st = [k]; seen.add(k); let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      while (st.length) { const q = st.pop(); const [cx, cy] = q.split(',').map(Number); n += cells.get(q); x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy); for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nk = `${cx + ax},${cy + ay}`; if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); st.push(nk); } } }
      const bx = x0 * 4, by = y0 * 4, bw = (x1 - x0 + 1) * 4, bh = (y1 - y0 + 1) * 4, mx = bx + bw / 2, my = by + bh / 2;
      const nd = nodes.find((o) => mx >= o.r.left - 20 && mx <= o.r.right + 20 && my >= o.r.top - 20 && my <= o.r.bottom + 20);
      if (!nd || n < 6) continue;
      blobs.push({ node: nd.name, px: n, box: [Math.round(bx), Math.round(by), bw, bh], rel: [+((mx - nd.r.left) / nd.r.width).toFixed(2), +((my - nd.r.top) / nd.r.height).toFixed(2)] });
    }
    return blobs.sort((a, b) => b.px - a.px).slice(0, 12);
  }, buf.toString('base64'));
}
const nodeRect = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? window.__mt.getState().nodes.get(s.sessionId) : null; }, name);
async function face(name, f) {
  const r = await nodeRect(name);
  if (!r) return false;
  const k = { close: 1.15, middle: 2.6, far: 5.5, icon: 14 }[f];
  const box = { x: r.x + r.w / 2 - (r.w * k) / 2, y: r.y + r.h / 2 - (r.h * k) / 2, w: r.w * k, h: r.h * k };
  await page.evaluate((b) => window.__mt.getState().navigateToRect(b, 0), box);
  await sleep(900);
  return true;
}
async function dotStage() {
  if (process.env.P98_DIST) useDist(process.env.P98_DIST);
  log(atrium('backend', 'start').trim().slice(0, 300));
  try { atrium('settings', 'set', 'tray', 'off'); } catch {}
  try { atrium('settings', 'set', 'language', 'ko'); } catch {}
  const report = { stage: STAGE, tag: TAG, scenes: [] };
  const have = sessions().map((s) => s.name);
  if (!['lead', 'cx-child', 'cx-rail'].every((n) => have.includes(n))) {
    fs.mkdirSync(DOT, { recursive: true });
    killAll();
    atrium('--json', 'spawn', DOT, '--name', 'lead', '--model', 'haiku');
    const lead = await readyOf('lead');
    log('lead', lead && lead.state);
    if (lead && lead.state === 'trust_wait') { fs.writeFileSync(path.join(DEV, 'p98-need-trust.txt'), `Dev board atrium-dev-p98 (47897): lead in ${DOT} asks the folder trust question\n`); throw new Error('trust question: lead'); }
    const out = execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), 'child', 'cx-child', '--kind', 'codex', '--no-wait', '--json'], { encoding: 'utf8', env: CHILD_ENV('lead'), timeout: 120000 });
    log('atrium child cx-child --kind codex', out.trim().slice(0, 400));
  }
  await openWindow();
  // 레일로 Codex 띄우기(호출자 단추). 없으면 CLI로
  if (!byName('cx-rail')) {
    const btn = page.locator('[data-action="launch"]').filter({ has: page.locator('[data-kind="codex"]') }).first();
    let how = 'rail';
    if (await btn.count()) {
      const before = new Set(sessions().map((s) => s.sessionId));
      await page.evaluate(() => { const st = window.__mt.getState(); return st.currentWs; });
      await btn.click();
      const s = await until(() => sessions().find((x) => !before.has(x.sessionId) && x.kind === 'codex'), 60000, 1500).catch(() => null);
      if (s) atrium('rename', s.sessionId, 'cx-rail');
      else how = 'rail(없음)';
    } else { how = 'cli'; atrium('--json', 'spawn', DOT, '--name', 'cx-rail', '--kind', 'codex'); }
    log('cx-rail 띄움', how);
  }
  for (const n of ['cx-child', 'cx-rail']) { const s = await readyOf(n, 90000, ['ready', 'trust_wait', 'working', 'waiting', 'error', 'exited']); log(`${n}: ${s ? `${s.state} kind=${s.kind}` : '없음'}`); }
  await sleep(3000);
  report.sessions = sessions().map((s) => ({ name: s.name, kind: s.kind, state: s.state }));
  log('세션', report.sessions);

  const linking = async (on) => { const now = await page.evaluate(() => document.querySelector('.mt-app').classList.contains('linking')); if (now !== on) { await page.locator('[data-action="link-mode"]').click(); await sleep(300); } };
  async function sample(label, target) {
    const dom = await greenDom();
    const px = await greenPixels();
    const mid = (a) => a.rel[0] > 0.15 && a.rel[0] < 0.85 && a.rel[1] > 0.15 && a.rel[1] < 0.85; // 노드 가운데 쪽(가장자리 손잡이 자리 밖)
    const scene = { label, target, dom, px, midDom: dom.filter(mid), midPx: px.filter(mid) };
    report.scenes.push(scene);
    const flag = scene.midDom.length || scene.midPx.length;
    log(`${flag ? '◆ 가운데 초록' : '·'} ${label}: dom ${dom.length}(가운데 ${scene.midDom.length}) px ${px.length}(가운데 ${scene.midPx.length})`, flag ? { midDom: scene.midDom.slice(0, 6), midPx: scene.midPx.slice(0, 6) } : '');
    if (flag || /^(close|icon)-(out|in)-plain-off/.test(label)) await shot(`dot-${label}`);
    return scene;
  }
  const dockIn = () => { try { log('dock', atrium('dock', 'cx-child', 'lead', '--side', 'right').trim().slice(0, 160)); } catch (e) { log('dock 실패', e.message.slice(0, 200)); } };
  const dockOut = () => { try { atrium('dock', 'rm', 'cx-child'); } catch (e) { log('dock rm 실패', e.message.slice(0, 160)); } };
  for (const dock of ['out', 'in']) {
    if (dock === 'in') { dockIn(); await sleep(2500); }
    for (const target of ['cx-child', 'cx-rail', 'lead']) {
      for (const f of ['close', 'middle', 'far', 'icon']) {
        if (!(await face(target, f))) continue;
        for (const link of ['off', 'on']) {
          await linking(link === 'on');
          await page.mouse.move(5, 880); await sleep(200);
          await sample(`${f}-${dock}-plain-${link}-${target}`, target);
          // 가리킴: 노드 가운데에 마우스
          const c = await page.evaluate((n) => { const el = document.querySelector(`.mt-node[data-name="${n}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, target);
          if (c) { await page.mouse.move(c.x, c.y); await sleep(350); await sample(`${f}-${dock}-hover-${link}-${target}`, target); }
          // 고름: 머리줄을 누른다(가까운 얼굴이 아니면 노드를 누른다)
          await page.evaluate((n) => { const el = document.querySelector(`.mt-node[data-name="${n}"] .mt-node-head`) || document.querySelector(`.mt-node[data-name="${n}"]`); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, target);
          await sleep(350);
          await sample(`${f}-${dock}-selected-${link}-${target}`, target);
          await page.evaluate(() => window.__mt.getState().clearSelection && window.__mt.getState().clearSelection());
        }
      }
    }
    if (dock === 'in') dockOut();
  }
  await linking(false);
  const flagged = report.scenes.filter((s) => s.midDom.length || s.midPx.length);
  report.flagged = flagged.map((s) => ({ label: s.label, midDom: s.midDom, midPx: s.midPx }));
  log(`가운데 초록이 보인 장면 ${flagged.length}/${report.scenes.length}`);
  const byCls = {};
  for (const s of flagged) for (const d of s.midDom) byCls[d.cls] = (byCls[d.cls] || 0) + 1;
  log('가운데 초록 요소(클래스별 장면 수)', byCls);
  report.byCls = byCls;
  fs.writeFileSync(path.join(OUT, `p98-${TAG}.json`), JSON.stringify(report, null, 2));
}

// ================= 워커 덩어리(사용자 단서: 워크트리 워커 4~5개를 묶은 덩어리에서 재현) =================
// lead(haiku)의 Codex 하위 세션 넷(cx-child, cx2~cx4)을 atrium dock workers로 묶고(2×2), 리드는 덩어리 밖. 잇기 모드는 끈 채 세는다
async function workersStage() {
  if (process.env.P98_DIST) useDist(process.env.P98_DIST);
  log(atrium('backend', 'start').trim().slice(0, 300));
  if (!byName('lead')) throw new Error('먼저 P98_STAGE=dot으로 lead와 cx-child를 띄운다');
  const kids = ['cx-child', 'cx2', 'cx3', 'cx4'];
  for (const n of kids) if (!byName(n)) { const out = execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), 'child', n, '--kind', 'codex', '--no-wait', '--json'], { encoding: 'utf8', env: CHILD_ENV('lead'), timeout: 120000 }); log(`atrium child ${n} --kind codex`, out.trim().slice(0, 120)); }
  for (const n of kids) { const s = await readyOf(n, 90000, ['ready', 'trust_wait', 'working', 'waiting', 'error', 'exited']); log(`${n}: ${s ? `${s.state} kind=${s.kind}` : '없음'}`); }
  const docked = call('dock.list').some((d) => kids.every((n) => d.members.includes(byName(n).sessionId)));
  if (!docked) { for (const n of kids) { try { atrium('dock', 'rm', n); } catch {} } log('dock workers', atrium('dock', 'workers', 'lead').trim().slice(0, 200)); }
  await openWindow();
  const report = { stage: STAGE, tag: TAG, scenes: [] };
  const lead = await nodeRect('lead');
  const dockRect = await page.evaluate((names) => { const st = window.__mt.getState(); const rs = names.map((n) => { const s = [...st.sessions.values()].find((x) => x.name === n); return s && st.nodes.get(s.sessionId); }).filter(Boolean); const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }, kids);
  log('리드', lead, '덩어리', dockRect);
  const both = { x: Math.min(lead.x, dockRect.x), y: Math.min(lead.y, dockRect.y) }; both.w = Math.max(lead.x + lead.w, dockRect.x + dockRect.w) - both.x; both.h = Math.max(lead.y + lead.h, dockRect.y + dockRect.h) - both.y;
  for (const [label, k] of [['fit', 1.1], ['close', 0.55], ['far', 2.4]]) {
    const r = label === 'close' ? dockRect : both;
    await page.evaluate((b) => window.__mt.getState().navigateToRect(b, 0), { x: r.x + r.w / 2 - (r.w * k) / 2, y: r.y + r.h / 2 - (r.h * k) / 2, w: r.w * k, h: r.h * k });
    await page.mouse.move(5, 880); await sleep(1200);
    const dom = await greenDom();
    const px = await greenPixels();
    // 덩어리 안쪽(바깥 변에서 칸 너비의 15% 넘게 들어간 곳)에 찍힌 초록
    const inDock = await page.evaluate(({ d, dom, px }) => {
      const vp = window.__mt.getState().vpNow; const toW = (x, y) => ({ x: (x - vp.x) / vp.zoom, y: (y - vp.y) / vp.zoom });
      const deep = (p) => p.x > d.x + d.w * 0.08 && p.x < d.x + d.w * 0.92 && p.y > d.y + d.h * 0.08 && p.y < d.y + d.h * 0.92;
      const el = [...document.querySelectorAll('.mt-edge-end')].map((c) => { const r = c.getBoundingClientRect(); const fill = getComputedStyle(c).fill; return { fill, w: toW(r.x + r.width / 2, r.y + r.height / 2) }; }).filter((e) => deep(e.w));
      return { ends: el, pxDeep: px.filter((b) => deep(toW(b.box[0] + b.box[2] / 2, b.box[1] + b.box[3] / 2))) };
    }, { d: dockRect, dom, px });
    const scene = { label, dom, px, inDock };
    report.scenes.push(scene);
    log(`${inDock.ends.length || inDock.pxDeep.length ? '◆ 덩어리 안쪽 초록' : '·'} ${label}: 선 끝 점 ${inDock.ends.length}개(${[...new Set(inDock.ends.map((e) => e.fill))].join(', ')}), 픽셀 덩어리 ${inDock.pxDeep.length}개`, inDock.pxDeep.slice(0, 6));
    await shot(`workers-${label}`);
  }
  report.edges = await page.evaluate(() => [...document.querySelectorAll('.react-flow__edge')].map((e) => ({ id: e.dataset.id || e.getAttribute('data-testid'), cls: e.getAttribute('class') })));
  fs.writeFileSync(path.join(OUT, `p98-${TAG}.json`), JSON.stringify(report, null, 2));
  report.results = results;
  const deepAll = report.scenes.reduce((a, s) => a + s.inDock.ends.length + s.inDock.pxDeep.length, 0);
  if (process.env.P98_DOT_TAG === 'after') check('덩어리 밖 리드 → 덩어리 안 워커 선의 끝 점이 덩어리 안쪽에 없다(잇기 모드 끔, 세 배율)', deepAll === 0, report.scenes.map((s) => ({ label: s.label, ends: s.inDock.ends.length, px: s.inDock.pxDeep.length })));
  else log(`[전] 덩어리 안쪽 초록 ${deepAll}`);
}

try {
  if (STAGE === 'workers') await workersStage();
  else if (STAGE === 'bar-before') await barStage('before');
  else if (STAGE === 'bar-after') await barStage('after');
  else await dotStage();
} catch (e) {
  log('오류', e.stack || e.message);
  results.push({ name: 'error', ok: false, detail: e.message });
} finally {
  if (app) await closeApp(app);
  const fail = results.filter((r) => !r.ok);
  log(`결과 ${results.length - fail.length}/${results.length}`);
  process.exit(fail.length ? 1 : 0);
}
