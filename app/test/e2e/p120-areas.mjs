// P120 창 시험: 빈 영역 잔여물과 헛 초안.
// 1 이름표: 긴 경로의 좁은 영역에서 지우기에 닿는다(⌄가 잘린 단추를 메뉴로 모은다, 오른쪽 클릭도). 고치기 전 그림은 P120 CSS 규칙을 떼고 찍는다.
// 2 정리: 판 밖 대화 기록(고정 자료)으로 저절로 연 영역의 폴더를 지우면 영역이 사라진다. git 워크트리를 지우면 그 상자가 사라지고,
//   저장소 폴더째 지우면 영역과 남은 상자가 사라진다. 폴더가 있는 빈 영역과 세션이 든 영역은 남는다.
// 3 헛 초안: 잠든 세션(haiku)을 누르기·글 보내기·atrium wake로 깨운 뒤 곧바로 손으로 잠재우면 잠든다. 깨운 뒤 창이 보낸 터미널 입력을 모아
//   고치기 전 판정(옛 draftAfterInput)이면 초안이었는지 견준다. 사람이 친 글(보내지 않음)은 지금처럼 막는다.
// 판: herdr·hc 세션 atrium-dev-p120, 포트 47897, 창 원격 디버깅 9377, 이 워크트리의 backend/.dev. P120_BACKEND=herdr|hc.
// 시험 폴더는 새로 만든 C:\Workspace\mtask-p120-ws(따로 git init하는 것은 claude를 띄우지 않는 저장소뿐). MT_P120_STAGE=run | clean.
// 사용: MT_E2E_OUT=p120 MT_P120_STAGE=run P120_BACKEND=herdr node test/e2e/p120-areas.mjs (app 폴더에서)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, logger } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';
import { draftAfterInput } from '../../../backend/src/sleep.mjs';

if (process.env.MT_E2E_OUT !== 'p120') throw new Error('MT_E2E_OUT=p120를 명령줄에서 준다');
const STAGE = process.env.MT_P120_STAGE;
const BACK = process.env.P120_BACKEND;
if (!['run', 'clean'].includes(STAGE)) throw new Error('MT_P120_STAGE=run|clean');
if (!['herdr', 'hc'].includes(BACK)) throw new Error('P120_BACKEND=herdr|hc');
const DEV = path.join(REPO, 'backend', '.dev');
const BASE = 'C:\\Workspace\\mtask-p120-ws';
const FIX = path.join(DEV, 'p120-projects');
const ENV = {
  ATRIUM_PROFILE: 'dev', ATRIUM_HERDR_SESSION: 'atrium-dev-p120', ATRIUM_PORT: '47897',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: FIX, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TERMINAL_BACKEND: BACK,
  ATRIUM_TEST_PREFIX: '', ATRIUM_CODE_ROOT: path.join(DEV, 'no-code-root'), // 시험 폴더(mtask-)를 리포 스스로 찾기가 열게
  ATRIUM_WS_GONE_GRACE_MS: '4000', ATRIUM_SLEEP_TICK_MS: '3000',
};
assertTestBoard(ENV, { root: DEV });
const log = logger(`p120-${BACK}-${STAGE}`);
const STRIP = /^(ATRIUM_|HERDR_|MTASK_|MT_HERDR|HC_|XDG_|CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/i;
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !STRIP.test(k))), ...ENV };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 180000 });
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', timeout: 30000, env: { ...env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } }).trim();
const keyOf = (p) => p.replace(/\\/g, '/').toLowerCase();
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
async function until(fn, ms, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(every); } }

const D = {
  long: path.join(BASE, 'a-rather-long-project-folder-name-for-labels', 'nested-experiment-folder', 'trial-two'),
  keep: path.join(BASE, 'empty-but-here'),
  convo: path.join(BASE, 'from-outside-convo'),
  repo: path.join(BASE, 'repo'), wt1: path.join(BASE, 'repo-wt1'), wt2: path.join(BASE, 'repo-wt2'),
  sl: path.join(BASE, 'sl'),
};

if (STAGE === 'clean') {
  let names = [];
  try { names = JSON.parse(atrium('ls', '--json')).map((s) => s.name); } catch (e) { log('목록 실패', e.message.slice(0, 200)); }
  for (const n of names) { try { log('끄기', atrium('kill', n, '--yes').trim().split('\n').slice(-1)[0]); } catch (e) { log('끄기 실패', n, e.message.slice(0, 160)); } }
  try { log('터미널 서버 멈춤', atrium('herdr', 'stop', '--yes').trim().slice(0, 300)); } catch (e) { log('멈춤 실패', e.message.slice(0, 200)); }
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log('백엔드 멈춤 실패', e.message.slice(0, 200)); }
  process.exit(0);
}

// 옛 판정(P21~P119): 이스케이프 머리만 지우고 나머지 글자를 셌다. 깨운 뒤 모은 입력이 옛 판정으로는 초안이었는지 보는 데만 쓴다
function oldDraft(prev, data) {
  let draft = !!prev;
  const s = String(data || '').replace(/\x1b\[20[01]~/g, '').replace(/\x1b(\[[0-9;?]*[ -\/]*[@-~]|O.|.)/g, '');
  for (const ch of s) { const c = ch.codePointAt(0); if (ch === '\r' || ch === '\n' || c === 0x03 || c === 0x15) draft = false; else if (c >= 0x20 && c !== 0x7f) draft = true; }
  return draft;
}

// ---------- 준비: 폴더, 고정 대화 기록 ----------
fs.mkdirSync(OUT, { recursive: true });
for (const d of [D.long, D.keep, D.convo, D.sl]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(path.join(D.repo, '.git'))) {
  fs.mkdirSync(D.repo, { recursive: true });
  git(D.repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(D.repo, 'README.md'), 'p120\n');
  git(D.repo, 'add', '.'); git(D.repo, 'commit', '-q', '-m', 'init');
  git(D.repo, 'worktree', 'add', '-q', '-b', 'wt-one', D.wt1);
  git(D.repo, 'worktree', 'add', '-q', '-b', 'wt-two', D.wt2);
}
// 판 밖(터미널) 대화 하나: cwd가 D.convo. 리포 스스로 찾기(P10)가 이 폴더를 빈 영역으로 연다(사용자 판의 잔여물과 같은 길)
{
  const enc = D.convo.replace(/[^A-Za-z0-9]/g, '-');
  const dir = path.join(FIX, enc);
  fs.mkdirSync(dir, { recursive: true });
  const at = new Date(Date.now() - 3600e3).toISOString();
  const id = '7f0c2a52-1200-4c1e-9a20-000000000120';
  const lines = [
    { type: 'user', uuid: 'u1', sessionId: id, cwd: D.convo, entrypoint: 'cli', timestamp: at, message: { role: 'user', content: 'test prompt' } },
    { type: 'assistant', uuid: 'a1', sessionId: id, cwd: D.convo, entrypoint: 'cli', timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  ];
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

let app = null, page = null;
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const shot = async (name, clip = null) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f, ...(clip ? { clip } : {}) }); log('스크린숏', path.relative(REPO, f)); };
const wsList = () => page.evaluate(() => window.__mt.getState().workspaces.map((w) => ({ key: w.key, root: w.root, name: w.name, boxes: (w.worktrees || []).map((a) => a.path) })));
const wsBy = async (dir) => (await wsList()).find((w) => keyOf(w.root) === keyOf(dir)) || null;
const sess = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? { id: s.sessionId, state: s.state, waking: s.waking, sleep: s.sleep, ws: s.workspaceKey } : null; }, name);

async function open() {
  log('백엔드', atrium('backend', 'start').trim().slice(0, 200)); // P81: 창이 띄우면 창의 디버깅 포트를 물려받는다
  app = await electron.launch({ args: ['.', '--dev', '--remote-debugging-port=9377'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.emulateMedia({ reducedMotion: 'reduce' }); // 사용자 PC(Windows 애니메이션 끔)와 같은 조건
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(1000);
  // 창이 보낸 터미널 입력과 알림(토스트)을 모은다
  await page.evaluate(() => {
    const api = window.__mt.api;
    window.__p120 = { inputs: [], toasts: [] };
    const orig = api.call.bind(api);
    api.call = (m, p) => { if (m === 'terminal.input') window.__p120.inputs.push({ at: Date.now(), session: p.session, data: p.data }); return orig(m, p); };
    new MutationObserver(() => { for (const el of document.querySelectorAll('.mt-toast, [data-role=toast]')) { const x = el.textContent; if (x && !window.__p120.toasts.includes(x)) window.__p120.toasts.push(x); } }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
// 영역 하나(이름표)를 화면 왼쪽 위 1/3쯤에 놓는다(zoom). 지금 화면의 이름표 자리와 viewport로 판 좌표를 구한다
async function viewRegion(key, zoom) {
  await page.evaluate(([k, z]) => {
    const st = window.__mt.getState();
    const m = /translate\(([-\d.]+)px, ?([-\d.]+)px\) scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform);
    const vp = { x: +m[1], y: +m[2], zoom: +m[3] };
    const box = document.querySelector('.mt-canvas').getBoundingClientRect();
    const el = document.querySelector(`.mt-region[data-ws="${CSS.escape(k)}"]`).getBoundingClientRect();
    const fx = (el.left - box.left - vp.x) / vp.zoom, fy = (el.top - box.top - vp.y) / vp.zoom;
    st.setViewport({ x: box.width * 0.3 - fx * z, y: box.height * 0.3 - fy * z, zoom: z });
  }, [key, zoom]);
  await sleep(900);
}
async function headInfo(key) {
  return page.evaluate((k) => {
    const head = document.querySelector(`.mt-region[data-ws="${CSS.escape(k)}"] .mt-region-head`);
    if (!head) return null;
    const hb = head.getBoundingClientRect();
    const vis = (sel) => { const b = head.querySelector(sel); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), inside: r.width > 0 && r.left >= hb.left - 1 && r.right <= hb.right + 1 }; };
    const name = head.querySelector('.mt-region-name');
    return { head: { x: Math.round(hb.x), y: Math.round(hb.y), w: Math.round(hb.width), h: Math.round(hb.height) }, nameClipped: name ? name.scrollWidth > name.clientWidth : null, remove: vis('[data-action=region-remove]'), chev: vis('[data-action=region-acts]') };
  }, key);
}
// P120 CSS 규칙을 떼거나 되돌린다(고치기 전 그림)
const toggleP120Css = (off) => page.evaluate((o) => {
  window.__p120css = window.__p120css || [];
  if (o) {
    for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; } for (let i = rules.length - 1; i >= 0; i--) { const t = rules[i].cssText; if (/^\.mt-region-head > |^\.mt-wsgroup-head > /.test(t)) { window.__p120css.push({ sh, t }); sh.deleteRule(i); } } }
  } else { for (const { sh, t } of window.__p120css.splice(0)) sh.insertRule(t, sh.cssRules.length); }
}, off);

try {
  await open();
  const st0 = await call('board.status').catch(() => null);
  log('판', { backend: BACK, status: st0 && (st0.terminalBackend || st0.backend || null) });

  // ---------- 1. 긴 경로의 좁은 영역 ----------
  for (const d of [D.long, D.keep]) await call('workspace.open', { path: d, select: false });
  await call('workspace.open', { path: D.repo, select: false });
  const wLong = await until(() => wsBy(D.long), 15000);
  await sleep(1500);
  await page.mouse.move(5, 5);
  for (const z of [1, 0.45, 0.3]) {
    await viewRegion(wLong.key, z);
    const head = page.locator(`.mt-region[data-ws="${wLong.key}"] .mt-region-head`);
    await toggleP120Css(true);
    await head.hover(); await sleep(400);
    const before = await headInfo(wLong.key);
    const hb = before.head;
    const clip = { x: Math.max(0, hb.x - 60), y: Math.max(0, hb.y - 40), width: Math.min(1584 - Math.max(0, hb.x - 60), hb.w + 260), height: hb.h + 260 };
    await shot(`p120-${BACK}-label-z${z}-before`, clip);
    await toggleP120Css(false);
    await page.mouse.move(5, 5); await sleep(200); await head.hover(); await sleep(400);
    const after = await headInfo(wLong.key);
    await shot(`p120-${BACK}-label-z${z}-after`, clip);
    log(`이름표 z${z}`, { before, after });
    const wide = z === 1; // 넓을 때는 지금처럼 단추가 다 보인다
    if (wide) step('1 이름표 z1(넓음): 단추가 다 보이고 ⌄는 단추 줄을 편다', after.remove.inside && after.chev.inside, { before, after });
    else step(`1 이름표 z${z}(좁음): 고치기 전에는 지우기·⌄가 잘렸고, 고친 뒤 ⌄가 이름표 안에 보인다`, before && (!before.remove.inside || !before.chev.inside) && after.chev.inside, { before, after });
    // ⌄: 단추가 다 들어가면 단추 줄을 접고 펴고, 잘렸으면 메뉴로 모은다 → 지우기
    await page.click(`.mt-region[data-ws="${wLong.key}"] [data-action=region-acts]`);
    const menu = await until(() => page.$('[data-role=region-menu]'), wide ? 1000 : 3000, 200);
    const items = menu ? await page.$$eval('[data-role=region-menu] [data-action]', (bs) => bs.map((b) => b.dataset.action)) : [];
    if (menu) await shot(`p120-${BACK}-label-z${z}-menu`);
    if (wide) { step('1 ⌄ z1(넓음): 메뉴 없이 단추 줄을 편다', !menu && !!(await page.$(`.mt-region[data-ws="${wLong.key}"] .mt-region-head.acts`))); await page.click(`.mt-region[data-ws="${wLong.key}"] [data-action=region-acts]`); }
    else step(`1 메뉴 z${z}: ⌄가 잘린 단추를 메뉴로 열고 지우기가 있다`, items.includes('region-remove') && items.includes('arrange'), items);
    await page.keyboard.press('Escape'); await sleep(300);
  }
  // 오른쪽 클릭 → 지우기 → 확인 창(빈 프로젝트 닫기)
  await viewRegion(wLong.key, 0.45);
  await page.click(`.mt-region[data-ws="${wLong.key}"] .mt-region-name`, { button: 'right' });
  await until(() => page.$('[data-role=region-menu]'), 3000, 200);
  await page.click('[data-role=region-menu] [data-action=region-remove]');
  await sleep(800);
  await shot(`p120-${BACK}-remove-dialog`);
  const dlg = await page.evaluate(() => { const d = document.querySelector('.mt-modal-bg'); return d ? d.textContent.slice(0, 200) : null; });
  step('1 오른쪽 클릭 메뉴의 지우기가 닫기 확인 창을 연다', !!dlg, dlg);
  await page.keyboard.press('Escape'); await sleep(300);

  // ---------- 2. 정리 ----------
  // 판 밖 대화로 연 영역(리포 스스로 찾기)
  const wConvo = await until(() => wsBy(D.convo), 60000, 1000);
  step('2 판 밖 대화 기록의 폴더가 빈 영역으로 저절로 열린다(사용자 판 잔여물의 출처)', !!wConvo, wConvo);
  const wRepo = await until(async () => { const w = await wsBy(D.repo); return w && w.boxes.length === 2 ? w : null; }, 30000, 1000);
  step('2 저장소 영역에 워크트리 상자 둘', !!wRepo, wRepo);
  await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1000);
  await shot(`p120-${BACK}-areas-before`);
  // 워크트리 하나를 git으로 지운다 → 그 상자만 사라진다
  git(D.repo, 'worktree', 'remove', '--force', D.wt1);
  const oneBox = await until(async () => { const w = await wsBy(D.repo); return w && w.boxes.length === 1 ? w : null; }, 30000, 1000);
  step('2 git 워크트리를 지우면 그 빈 상자가 사라진다', !!oneBox && keyOf(oneBox.boxes[0]) === keyOf(D.wt2), oneBox);
  // 폴더째 지운다: 판 밖 대화 폴더, 저장소(남은 워크트리 포함)
  const t2 = Date.now();
  fs.rmSync(D.convo, { recursive: true, force: true });
  fs.rmSync(D.repo, { recursive: true, force: true });
  fs.rmSync(D.wt2, { recursive: true, force: true });
  const gone = await until(async () => { const l = await wsList(); return !l.some((w) => [D.convo, D.repo].some((d) => keyOf(w.root) === keyOf(d))) ? l : null; }, 60000, 1000);
  const toasts = await page.evaluate(() => window.__p120.toasts.filter((x) => /folder|폴더/i.test(x)));
  step('2 폴더가 없어진 빈 영역(판 밖 대화 영역, 저장소 영역과 남은 상자)이 사라지고 한 번 알린다', !!gone && toasts.length >= 1, { ms: Date.now() - t2, toasts });
  const kept = await wsBy(D.keep);
  step('2 폴더가 있는 빈 영역은 남는다', !!kept, kept && kept.root);
  await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1000);
  await shot(`p120-${BACK}-areas-after`);
  // 다시 저절로 열리지 않는다(폴더가 없으므로)
  await sleep(8000);
  step('2 치운 영역이 다시 열리지 않는다', !(await wsBy(D.convo)) && !(await wsBy(D.repo)));

  // ---------- 3. 헛 초안 ----------
  if (!(await sess('sl'))) atrium('spawn', D.sl, '--name', 'sl', '--model', 'haiku');
  let s = await until(async () => { const x = await sess('sl'); return x && x.state === 'ready' ? x : null; }, 120000, 1000);
  if (!s) throw new Error('sl이 준비되지 않았다(신뢰 질문?)');
  await call('session.send', { target: ['sl'], text: 'Reply with the single word ok and do nothing else.' });
  await until(async () => { const x = await sess('sl'); return x && x.state === 'working' ? x : null; }, 30000, 300);
  await until(async () => { const x = await sess('sl'); return x && x.state === 'ready' ? x : null; }, 120000, 500);
  const wsSl = (await sess('sl')).ws;
  const handSleep = async () => { try { const r = await call('workspace.sleep', { workspace: wsSl }); return { ok: true, slept: r.slept, r }; } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 200) }; } };
  const asleep = () => until(async () => { const x = await sess('sl'); return x && x.state === 'sleeping' ? x : null; }, 60000, 500);
  const awake = () => until(async () => { const x = await sess('sl'); return x && x.state === 'ready' && !x.waking ? x : null; }, 120000, 500);
  const viewSl = async () => { await page.evaluate(() => { const st = window.__mt.getState(); const s = [...st.sessions.values()].find((x) => x.name === 'sl'); st.navigateTo(s.sessionId, { viewOnly: true }); }); await sleep(1500); };

  let r0 = await handSleep();
  step('3 처음 손으로 잠재우기', r0.ok && (await asleep()), r0);
  const ways = [
    ['click', async () => { await viewSl(); await page.click('.mt-node[data-name="sl"] [data-role="sleep-face"]'); }],
    ['send', async () => { await call('session.send', { target: ['sl'], text: 'Reply with the single word ok and do nothing else.' }); }],
    ['wake', async () => { atrium('wake', 'sl'); }],
  ];
  for (const [how, fn] of ways) {
    const id = (await sess('sl')).id;
    await page.evaluate(() => { window.__p120.inputs = []; });
    await fn();
    await awake();
    if (how === 'send') { await until(async () => { const x = await sess('sl'); return x && x.state === 'working' ? x : null; }, 20000, 300); await awake(); }
    await viewSl(); // 터미널이 붙고 claude의 물음에 창이 답할 시간
    await sleep(2500);
    // 사람이 깬 노드를 본다: 터미널을 눌러 초점을 주고 휠을 굴린다(글은 치지 않는다). claude가 마우스 보고를 켰으면 창이 ESC[<…M을 보낸다
    const tb = await page.locator('.mt-node[data-name="sl"] .xterm-screen').first().boundingBox().catch(() => null);
    if (tb) { await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 3); await sleep(300); await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 3); await page.mouse.wheel(0, -300); await sleep(300); await page.mouse.wheel(0, 300); await sleep(800); }
    log(`${how} 터미널 상자`, tb);
    const inputs = await page.evaluate((sid) => window.__p120.inputs.filter((x) => x.session === sid).map((x) => x.data), id);
    const oldWas = inputs.reduce((d, x) => oldDraft(d, x), false), newIs = inputs.reduce((d, x) => draftAfterInput(d, x), false);
    const r = await handSleep();
    const slept = r.ok && r.slept > 0 ? await asleep() : null;
    step(`3 ${how}로 깨운 뒤 곧바로 손으로 잠재우면 잠든다`, !!slept, { r, inputs: inputs.map((x) => JSON.stringify(x).slice(0, 120)), oldWas, newIs });
    if (!slept) { await page.evaluate(() => {}); }
  }
  // 사람이 친 글(보내지 않음)은 막는다
  await call('session.wake', { session: 'sl', why: 'hand' }).catch(() => {});
  await awake(); await viewSl();
  await call('terminal.input', { session: (await sess('sl')).id, data: 'half typed' });
  await sleep(800);
  const rd = await handSleep();
  const st1 = await sess('sl');
  step('3 사람이 쓰다 만 글이 있으면 손으로 잠재우기가 막힌다', st1.state !== 'sleeping' && (!rd.ok || !rd.slept), rd);
  await call('terminal.input', { session: st1.id, data: '\x15' }); // 지운다
} catch (e) {
  log('오류', e.stack);
  step('예외 없이 끝남', false, e.message);
} finally {
  if (page) await shot(`p120-${BACK}-end`).catch(() => {});
  if (app) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {});
  await sleep(1500);
  if (app) await app.close().catch(() => {});
  const ok = results.filter((r) => r.ok).length;
  fs.writeFileSync(path.join(OUT, `p120-${BACK}-results.json`), JSON.stringify(results, null, 2));
  log(`결과 ${ok}/${results.length}`);
  process.exit(ok === results.length ? 0 : 1);
}
