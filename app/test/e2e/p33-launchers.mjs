// P33 창 시험: 호출자. 판: herdr 세션 atrium-dev-p33, 포트 47851, 이 워크트리의 backend/.dev(experiments/p33/tools/env.cjs).
// 시험 폴더는 새로 만든 C:\Workspace\mtask-p33-ws\demo 하나. 대화 목록은 그 폴더의 대화만 읽는다. claude는 haiku이고 지시는 보내지 않는다.
// 사용: node experiments/p33/tools/e2e.cjs p33-launchers.mjs   (옮기기만: ... p33-launchers.mjs migrate)
// 차례: 1 새 판 즐겨찾기 → 2 설정 탭에서 claude 호출자(모델 haiku)를 만들어 레일에 → 3 레일에서 누르면 그 모델로 뜬다 → 4 직접 명령 호출자
//       → 5 즐겨찾기 순서 바꾸기·빼기, Shift+누르기 → 6 게이트웨이 닿지 않음(일반, DeepSeek 예시) → 7 codex(깔려 있으면 띄우고, 아니면 인자 풀기만)
//       → 8 영어·한국어 설정 탭 스크롤 없음(최소 창) → 9 옛 설정을 넣은 데이터 폴더로 켜서 옮기기
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p33') throw new Error('MT_E2E_OUT=p33을 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p33', 'tools', 'env.cjs'));
const DIR = T.DIR;
const ENV = Object.fromEntries(Object.entries(T.P33_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p33' || ENV.ATRIUM_PORT !== '47851') throw new Error('P33 판(atrium-dev-p33, 47851)만');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DIR, { recursive: true });
const ONLY_MIGRATE = process.argv[2] === 'migrate';

const log = logger('p33-launchers');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const envFor = (dataDir) => ({ ...cleanEnv(), ...ENV, ATRIUM_DATA_DIR: dataDir, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION });
const atriumIn = (dataDir, ...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: envFor(dataDir), timeout: 120000 });
const call = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const sessions = (page) => page.evaluate(() => [...window.__mt.getState().sessions.values()].map((s) => ({ id: s.sessionId, name: s.name, kind: s.kind, flavor: s.flavor, state: s.state, model: s.model, paneId: s.paneId })));
const spawnEvent = async (page, id) => { const ev = await call(page, 'session.events', { session: id }); const e = ev.find((x) => x.kind === 'spawn'); return e ? e.data : null; };
const railIds = (page) => page.$$eval('[data-role="rail-favorites"] [data-action="launch"]', (els) => els.map((e) => e.getAttribute('data-launcher')));
const toasts = (page) => page.$$eval('.mt-toast', (els) => els.map((e) => e.textContent));
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const shot = async (page, name, clip) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f, ...(clip ? { clip } : {}) }); log('스크린숏', path.relative(REPO, f)); };
const size = async (app, w, h) => { await app.evaluate(({ BrowserWindow }, [ww, hh]) => BrowserWindow.getAllWindows()[0].setSize(ww, hh), [w, h]); await sleep(600); };
const modalShot = async (page, name) => { const r = await page.$eval('[data-role="settings"], [data-role="spawn"]', (e) => { const b = e.getBoundingClientRect(); return { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), width: Math.min(b.width + 8, innerWidth), height: Math.min(b.height + 8, innerHeight) }; }); await shot(page, name, r); };
const closedPort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
// P28과 같은 검사: 설정 창과 그 안 어디에도 스크롤이 없고 본문 밖으로 잘린 것이 없다
const scrolls = (page) => page.evaluate(() => {
  const m = document.querySelector('[data-role="settings"]');
  const over = [m, ...m.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return (e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(cs.overflowY)) || (e.scrollWidth > e.clientWidth + 1 && /(auto|scroll)/.test(cs.overflowX)); }).map((e) => `${e.className || e.tagName} ${e.scrollHeight}/${e.clientHeight}`);
  const body = m.querySelector('.mt-set-body').getBoundingClientRect();
  const clipped = [...m.querySelectorAll('.mt-set-body input, .mt-set-body select, .mt-set-body textarea, .mt-set-body button, .mt-set-name, .mt-set-hint, .mt-set-note, .mt-set-sub, .mt-ln-preview, .mt-ln-secret')].filter((e) => { const q = e.getBoundingClientRect(); return q.width && (q.right > body.right + 1 || q.bottom > body.bottom + 1 || q.left < body.left - 1); }).map((e) => e.dataset.field || e.dataset.action || e.textContent.slice(0, 24));
  const r = m.getBoundingClientRect();
  return { over, clipped, out: r.bottom > innerHeight || r.right > innerWidth || r.top < 0 };
});
const openSettings = async (page, tab = 'launchers') => {
  if (!(await page.$('[data-role="settings"]'))) await page.click('[data-role="top-right"] [data-action="settings-open"]');
  await page.waitForSelector('[data-role="settings-tabs"]', { timeout: 5000 });
  await page.click(`[data-role="settings-tabs"] [data-tab="${tab}"]`);
  await sleep(250);
};
const closeSettings = async (page) => { await page.click('[data-action="settings-close"]').catch(() => {}); await sleep(200); };
const newSession = async (page, before, ms = 30000) => until(async () => (await sessions(page)).find((s) => !before.has(s.id)), ms);
const ids = async (page) => new Set((await sessions(page)).map((s) => s.id));

async function launchApp(dataDir) {
  const app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env: envFor(dataDir), timeout: 60000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.getState().launchers, null, { timeout: 90000 });
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true)); // P43: 아래 바를 늘 보이게(이 시험은 바를 바로 누른다)
  return { app, page };
}

// ---------- 1~8: 새 판 ----------
async function mainRun() {
  const DATA = ENV.ATRIUM_DATA_DIR;
  // 새 판에서 시작한다: 이 판의 백엔드를 끄고 데이터 폴더(이 워크트리의 backend/.dev/data)를 비운다
  try { log('backend stop', atriumIn(DATA, 'backend', 'stop').trim()); } catch (e) { log('backend stop', e.message.split('\n')[0]); }
  if (!path.resolve(DATA).startsWith(path.resolve(T.DEV))) throw new Error(`데이터 폴더가 ${T.DEV} 밖이다`);
  fs.rmSync(DATA, { recursive: true, force: true });
  const { app, page } = await launchApp(DATA);
  const made = [];
  try {
    await size(app, 1584, 921);
    await call(page, 'settings.set', { language: 'en' });
    await call(page, 'workspace.open', { path: DIR });
    await page.waitForSelector('.mt-wsbtn[data-name="demo"]');
    await page.click('.mt-wsbtn[data-name="demo"]');
    await until(() => page.evaluate(() => { const s = window.__mt.getState(); const w = s.workspaces.find((x) => x.key === s.currentWs); return w && w.name === 'demo'; }), 10000);

    // 1. 새 판의 즐겨찾기: Claude Code, Codex, 셸. DeepSeek는 즐겨찾기 밖 예시
    const list0 = await call(page, 'launcher.list');
    step('1 새 판: 레일은 Claude Code, Codex, 셸이고 DeepSeek는 즐겨찾기 밖 예시', JSON.stringify(await railIds(page)) === '["claude","codex","shell"]' && list0.launchers.some((l) => l.id === 'deepseek' && !l.favorite), { rail: await railIds(page), all: list0.launchers.map((l) => `${l.id}${l.favorite ? '*' : ''}`) });
    const railBox = async () => page.$eval('[data-role="rail-left"]', (e) => { const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: r.width + 320, height: r.height + 12 }; });
    await shot(page, 'p33-1-rail-new', await railBox());

    // 2. 설정의 호출자 탭에서 claude 호출자를 만든다(모델 haiku, 레일에 놓기)
    await size(app, 900, 600);
    await openSettings(page);
    const s0 = await scrolls(page);
    step('2a 호출자 탭(최소 창, 영어): 스크롤·잘림 없음', !s0.over.length && !s0.clipped.length && !s0.out, s0);
    await modalShot(page, 'p33-2-tab-en');
    await page.click('[data-action="launcher-new"]');
    await page.waitForSelector('[data-role="launcher-form"]');
    await page.fill('[data-field="launcher-name"]', 'Haiku P33');
    await page.selectOption('[data-field="launcher-harness"]', 'claude');
    await page.fill('[data-field="launcher-model"]', 'haiku');
    await page.selectOption('[data-field="launcher-effort"]', 'low');
    const pv = await until(async () => { const t = await page.$eval('[data-role="launcher-form-preview"]', (e) => e.textContent); return /--model haiku --effort low/.test(t) ? t : null; }, 5000).catch(async () => page.$eval('[data-role="launcher-form-preview"]', (e) => e.textContent));
    step('2b 고르는 대로 명령줄 미리보기가 바뀐다', /claude --permission-mode manual --model haiku --effort low/.test(pv), { pv });
    const datalist = await page.$$eval('[data-role="launcher-form"] datalist option', (els) => els.map((e) => e.value));
    step('2c 모델은 하네스별 알려진 목록 + 직접 입력', datalist.includes('haiku') && datalist.includes('claude-opus-5-5'), { datalist });
    const sf = await scrolls(page);
    step('2d 만들기 틀(최소 창): 스크롤·잘림 없음', !sf.over.length && !sf.clipped.length && !sf.out, sf);
    await modalShot(page, 'p33-3-form-en');
    // 줄바꿈 든 명령·잘못된 모델은 미리보기 칸에 오류
    await page.fill('[data-field="launcher-model"]', 'haiku --x');
    const bad = await until(async () => { const t = await page.$eval('[data-role="launcher-form-preview"]', (e) => (e.classList.contains('bad') ? e.textContent : null)); return t; }, 5000).catch(() => null);
    step('2e 잘못된 모델 글자는 미리보기 칸에 오류', bad && /Model may only use/.test(bad), { bad });
    await page.fill('[data-field="launcher-model"]', 'haiku');
    await page.click('[data-action="launcher-save"]');
    await page.waitForSelector('[data-role="launchers-list"]', { timeout: 5000 });
    const L1 = (await call(page, 'launcher.list')).launchers.find((l) => l.name === 'Haiku P33');
    step('2f 만든 호출자가 목록과 레일 끝에 있다', L1 && L1.model === 'haiku' && L1.favorite && (await railIds(page)).at(-1) === L1.id, { L1: L1 && { id: L1.id, model: L1.model, effort: L1.effort, favorite: L1.favorite }, rail: await railIds(page) });
    await closeSettings(page);
    await size(app, 1584, 921);

    // 3. 레일에서 누르면 그 모델로 뜬다(대화상자 없음). 마우스를 올리면 이름과 명령
    const tip = await page.$eval(`[data-role="rail-favorites"] [data-launcher="${L1.id}"]`, (e) => e.title);
    step('3a 레일 풍선: 이름과 명령 미리보기', /^Haiku P33\nclaude --permission-mode manual --model haiku --effort low/.test(tip), { tip });
    let b0 = await ids(page);
    await page.click(`[data-role="rail-favorites"] [data-launcher="${L1.id}"]`);
    await sleep(300);
    step('3b 대화상자를 열지 않는다', !(await page.$('[data-role="spawn"]')));
    const s1 = await newSession(page, b0);
    made.push(s1.name);
    const ev1 = await spawnEvent(page, s1.id);
    const a1 = (ev1 && ev1.args) || [];
    step('3c 그 호출자의 모델(haiku)과 노력 수준으로 뜬다', s1.kind === 'claude' && a1[a1.indexOf('--model') + 1] === 'haiku' && a1[a1.indexOf('--effort') + 1] === 'low' && ev1.launcher === 'Haiku P33', { name: s1.name, launcher: ev1 && ev1.launcher, args: a1.filter((a) => !a.includes('\\') && !a.includes('/')) });
    const st1 = await until(async () => { const x = (await sessions(page)).find((s) => s.id === s1.id); return ['ready', 'trust_wait', 'waiting'].includes(x.state) ? x : null; }, 90000).catch(() => null);
    step('3d 세션이 준비된다', st1 && st1.state === 'ready', { state: st1 && st1.state });
    await sleep(1500);
    await shot(page, 'p33-4-spawned-haiku');

    // 4. 직접 명령 호출자: 셸 패널에 그 줄을 친다(셸에서 끝나는 짧은 명령). 레일 아이콘은 머리글자
    const MARK = path.join(DIR, 'p33-cmd.txt');
    fs.rmSync(MARK, { force: true });
    await openSettings(page);
    await page.click('[data-action="launcher-new-command"]');
    await page.waitForSelector('[data-role="launcher-form"][data-harness="command"]');
    await page.fill('[data-field="launcher-name"]', 'Echo P33');
    await page.fill('[data-field="launcher-command"]', 'echo P33-CMD > p33-cmd.txt');
    await until(async () => /types: echo P33-CMD/.test(await page.$eval('[data-role="launcher-form-preview"]', (e) => e.textContent)), 5000).catch(() => {});
    await modalShot(page, 'p33-5-form-command');
    await page.click('[data-action="launcher-save"]');
    await page.waitForSelector('[data-role="launchers-list"]');
    await closeSettings(page);
    const L2 = (await call(page, 'launcher.list')).launchers.find((l) => l.name === 'Echo P33');
    const mark = await page.$eval(`[data-role="rail-favorites"] [data-launcher="${L2.id}"]`, (e) => (e.querySelector('[data-role="launcher-mark"]') || {}).textContent || null);
    step('4a 직접 명령 호출자는 레일에 머리글자', mark === 'E', { mark });
    b0 = await ids(page);
    await page.click(`[data-role="rail-favorites"] [data-launcher="${L2.id}"]`);
    const s2 = await newSession(page, b0);
    made.push(s2.name);
    const ev2 = await spawnEvent(page, s2.id);
    await until(() => fs.existsSync(MARK), 20000).catch(() => {});
    const buf = fs.existsSync(MARK) ? fs.readFileSync(MARK) : null; // Windows PowerShell의 >는 UTF-16LE(BOM)
    const text = buf ? (buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8')).replace(/^\uFEFF/, '').trim() : null;
    step('4b 셸 패널에 그 줄을 쳐서 돌았다(셸 세션, 친 명령 기록)', s2.kind === 'shell' && ev2 && ev2.command === 'echo P33-CMD > p33-cmd.txt' && text === 'P33-CMD', { kind: s2.kind, command: ev2 && ev2.command, text });
    fs.rmSync(MARK, { force: true });
    await sleep(800);
    await shot(page, 'p33-6-command-session');

    // 5. 즐겨찾기 순서 바꾸기(↑), 빼기(별), Shift+누르기
    await openSettings(page);
    await page.click(`[data-role="launcher-row"][data-launcher="${L2.id}"] [data-action="launcher-up"]`);
    await until(async () => { const r = await railIds(page); return r.indexOf(L2.id) === r.indexOf(L1.id) - 1; }, 5000).catch(() => {});
    const r5 = await railIds(page);
    step('5a 설정의 ↑로 레일 순서가 바뀐다', r5.indexOf(L2.id) === r5.indexOf(L1.id) - 1, { rail: r5 });
    await page.click('[data-role="launcher-row"][data-launcher="codex"] [data-action="launcher-favorite"]');
    await until(async () => !(await railIds(page)).includes('codex'), 5000).catch(() => {});
    const r5b = await railIds(page);
    step('5b 별을 끄면 레일에서 빠지고 목록에는 남는다', !r5b.includes('codex') && !!(await page.$('[data-role="launcher-row"][data-launcher="codex"]')), { rail: r5b });
    await modalShot(page, 'p33-7-tab-reordered');
    await closeSettings(page);
    await page.click(`[data-role="rail-favorites"] [data-launcher="${L1.id}"]`, { modifiers: ['Shift'] });
    await page.waitForSelector('[data-role="spawn"]', { timeout: 5000 });
    const dlg = await page.evaluate(() => { const f = document.querySelector('[data-role="spawn"]'); const q = (s) => f.querySelector(s); return { launcher: q('[data-field=launcher]').value, model: q('[data-field=model]') && q('[data-field=model]').value, preview: (q('[data-role=launcher-preview]') || {}).textContent, prompt: !!q('[data-field=prompt]'), cwd: q('[data-field=cwd]').value }; });
    step('5c Shift+누르기는 그 호출자를 채운 새 세션 창', dlg.launcher === L1.id && dlg.model === 'haiku' && /--model haiku/.test(dlg.preview || '') && dlg.prompt && /demo$/.test(dlg.cwd), dlg);
    await modalShot(page, 'p33-8-dialog');
    // 새 세션 창에서 호출자를 바꿔 고를 수 있다(직접 명령이면 첫 지시 칸이 없다)
    await page.selectOption('[data-role="spawn"] [data-field=launcher]', L2.id);
    await sleep(200);
    const dlg2 = await page.evaluate(() => { const f = document.querySelector('[data-role="spawn"]'); return { prompt: !!f.querySelector('[data-field=prompt]'), note: !!f.querySelector('[data-role=command-note]') }; });
    step('5d 새 세션 창에서 호출자를 고른다(직접 명령: 첫 지시 칸 없음)', !dlg2.prompt && dlg2.note, dlg2);
    await page.click('[data-role="spawn"] button[type=button]');
    await sleep(200);
    // 칩 "New session…"도 호출자를 고른 채로 연다(첫 즐겨찾기)
    await page.click('[data-action="chip-spawn"]').catch(() => {});
    const chipDlg = await page.$eval('[data-role="spawn"] [data-field=launcher]', (e) => e.value).catch(() => null);
    step('5e 칩 "New session…" 창은 첫 즐겨찾기 호출자를 고른 채로 열린다', chipDlg === (await railIds(page))[0], { chipDlg });
    await page.click('[data-role="spawn"] button[type=button]').catch(() => {});

    // 6. 게이트웨이: ANTHROPIC_BASE_URL이 닿지 않으면 띄우기 전에 알린다. DeepSeek 예시(opencodex health)는 옛 안내
    const port = await closedPort();
    const gw = (await call(page, 'launcher.create', { launcher: { name: 'GW P33', harness: 'claude', model: 'haiku', env: `ANTHROPIC_BASE_URL=http://127.0.0.1:${port}` }, favorite: true })).launcher;
    await call(page, 'launcher.update', { id: 'deepseek', patch: { env: `ANTHROPIC_BASE_URL=http://127.0.0.1:${port}\nCLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`, checkUrl: `http://127.0.0.1:${port}/healthz` } }); // 실제 opencodex에 닿지 않게
    await call(page, 'launcher.favorite', { id: 'deepseek' });
    await sleep(300);
    b0 = await ids(page);
    await page.click(`[data-role="rail-favorites"] [data-launcher="${gw.id}"]`);
    const t6 = await until(async () => (await toasts(page)).find((x) => /not reachable/.test(x)), 8000).catch(() => null);
    step('6a 게이트웨이가 닿지 않으면 알리고 세션을 만들지 않는다', t6 && (await ids(page)).size === b0.size, { toast: t6 });
    await shot(page, 'p33-9-gateway-down');
    await page.click('[data-role="rail-favorites"] [data-launcher="deepseek"]');
    const t6b = await until(async () => (await toasts(page)).find((x) => /opencodex/.test(x)), 8000).catch(() => null);
    const dsImg = await page.$eval('[data-role="rail-favorites"] [data-launcher="deepseek"] img', (e) => e.getAttribute('src')).catch(() => null);
    step('6b DeepSeek 예시: 레일 로고, 게이트웨이가 없으면 opencodex 안내', t6b && /deepseek-badge\.svg$/.test(dsImg || '') && (await ids(page)).size === b0.size, { toast: t6b, dsImg });

    // 7. codex: 인자 풀기(미리보기). 깔려 있으면 띄워 본다
    const cx = await call(page, 'launcher.preview', { launcher: { name: 'cx', harness: 'codex', model: 'gpt-6-astra', args: '--full-auto' } });
    const kinds = await call(page, 'agent.kinds');
    const codexOn = kinds.some((k) => k.kind === 'codex' && k.installed);
    step('7a codex 호출자 인자 풀기: codex -m 모델 + 추가 인자', cx.preview.line === 'codex -m gpt-6-astra --full-auto', { line: cx.preview.line, codexInstalled: codexOn });
    if (codexOn) {
      await call(page, 'launcher.update', { id: 'codex', patch: { model: 'gpt-6-astra' } });
      b0 = await ids(page);
      const r7 = await call(page, 'session.spawn', { cwd: DIR, launcher: 'codex' }).catch((e) => ({ error: e.message }));
      if (r7.name) made.push(r7.name);
      const ev7 = r7.sessionId ? await spawnEvent(page, r7.sessionId) : null;
      step('7b codex가 깔려 있어 띄웠다(-m gpt-6-astra)', ev7 && JSON.stringify(ev7.args) === '["-m","gpt-6-astra"]', { r: r7.error || r7.name, args: ev7 && ev7.args });
    } else log('codex가 깔려 있지 않아 7b(실행)를 건너뛴다');

    // 8. 영어·한국어 설정 탭: 최소 창에서 탭마다 스크롤·잘림 없음
    await size(app, 900, 600);
    // 8a. 즐겨찾기가 많아도 레일이 넘치지 않는다(최소 창): 레일은 창 안, 즐겨찾기 칸만 넘긴다
    for (let i = 0; i < 6; i++) await call(page, 'launcher.create', { launcher: { name: `Many ${i}`, harness: 'shell' }, favorite: true });
    await sleep(500);
    const rail = await page.evaluate(() => { const r = document.querySelector('[data-role="rail-left"]').getBoundingClientRect(); const f = document.querySelector('[data-role="rail-favorites"]'); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, favs: f.children.length, scroll: f.scrollHeight > f.clientHeight, fit: document.querySelector('[data-action="fit-all"]').getBoundingClientRect().bottom <= innerHeight }; });
    step('8a 즐겨찾기가 많아도 레일은 창 안에 있고 즐겨찾기 칸만 넘긴다(최소 창)', rail.top >= 0 && rail.bottom <= rail.vh && rail.fit && rail.scroll && rail.favs >= 12, rail);
    await shot(page, 'p33-15-rail-many-min', { x: 0, y: 0, width: 140, height: rail.vh });
    for (const l of (await call(page, 'launcher.list')).launchers.filter((x) => /^Many /.test(x.name))) await call(page, 'launcher.delete', { id: l.id });
    const all = [];
    for (const lang of ['en', 'ko']) {
      await call(page, 'settings.set', { key: 'language', value: lang });
      await sleep(300);
      await openSettings(page, 'general');
      const tabs = await page.$$eval('[data-role="settings-tabs"] [data-tab]', (els) => els.map((b) => b.dataset.tab));
      for (const tab of tabs) { await openSettings(page, tab); all.push({ lang, tab, ...(await scrolls(page)) }); }
      await openSettings(page, 'launchers');
      await modalShot(page, `p33-10-tab-${lang}`);
      await page.click(`[data-role="launcher-row"][data-launcher="deepseek"] [data-action="launcher-edit"]`);
      await page.waitForSelector('[data-role="launcher-form"]');
      await sleep(400);
      all.push({ lang, tab: 'launchers-form-deepseek', ...(await scrolls(page)) });
      await modalShot(page, `p33-11-form-deepseek-${lang}`);
      await page.click('[data-action="launcher-cancel"]');
      await page.click('[data-action="launcher-new-command"]');
      all.push({ lang, tab: 'launchers-form-command', ...(await scrolls(page)) });
      await page.click('[data-action="launcher-cancel"]');
      await closeSettings(page);
    }
    const badTabs = all.filter((x) => x.over.length || x.clipped.length || x.out);
    step('8 영어·한국어: 탭마다(호출자 목록과 틀 포함) 스크롤·잘림 없음(최소 창)', all.length >= 12 && !badTabs.length, { count: all.length, tabs: [...new Set(all.map((x) => x.tab))], bad: badTabs });
    await call(page, 'settings.set', { key: 'language', value: 'en' });
    await size(app, 1584, 921);
    await shot(page, 'p33-12-rail-final', await railBox());
  } catch (e) {
    step('시험 중 오류', false, e.stack || e.message);
    await shot(page, 'p33-error').catch(() => {});
  } finally {
    for (const n of made) { try { atriumIn(DATA, 'kill', n, '--yes'); } catch (e) { log('kill 오류', n, e.message.split('\n')[0]); } }
    await closeApp(app);
  }
}

// ---------- 9: 옛 설정을 넣은 데이터 폴더로 켜서 옮기기 ----------
async function migrateRun() {
  const DATA2 = path.join(T.DEV, 'data-migrate');
  // 같은 herdr 세션과 포트를 쓰므로 새 판의 백엔드를 먼저 끈다(창을 닫은 뒤)
  try { log('backend stop', atriumIn(ENV.ATRIUM_DATA_DIR, 'backend', 'stop').trim()); } catch (e) { log('backend stop', e.message.split('\n')[0]); }
  fs.rmSync(DATA2, { recursive: true, force: true });
  fs.mkdirSync(DATA2, { recursive: true });
  const { Store } = await import(new URL('file:///' + path.join(REPO, 'backend', 'src', 'store.mjs').replace(/\\/g, '/')));
  const old = { language: 'en', tray: true, claudeModel: 'sonnet', claudeEffort: 'high', claudePermissionMode: 'acceptEdits', claudeAllowHerdr: true, codexArgs: '-m gpt-6-astra', deepseekModel: 'ocx-claude-deepseek--deepseek-pro[1m]', deepseekCommand: '' };
  const st = new Store(path.join(DATA2, 'board.db')); st.setMeta('settings', old); st.close();
  for (const round of [1, 2]) {
    const { app, page } = await launchApp(DATA2);
    try {
      await size(app, 1584, 921);
      const r = await call(page, 'launcher.list');
      const by = Object.fromEntries(r.launchers.map((l) => [l.id, l]));
      const s = (await call(page, 'settings.get')).settings;
      const want = round === 1 ? ['claude', 'codex', 'deepseek', 'shell'] : ['claude', 'codex', 'deepseek']; // 2번째: 1번째에서 셸을 뺐다(사용자가 바꾼 것은 덮지 않는다)
      const ok = JSON.stringify(r.favorites) === JSON.stringify(want) && by.claude.model === 'sonnet' && by.claude.effort === 'high' && by.claude.permissionMode === 'acceptEdits' && by.claude.allowHerdr && by.codex.args === '-m gpt-6-astra' && by.deepseek.model === old.deepseekModel && by.deepseek.harness === 'claude' && !('claudeModel' in s);
      step(`9${round === 1 ? 'a' : 'b'} 옛 설정 → 호출자(레일 Claude, Codex, DeepSeek, 셸)${round === 2 ? ', 다시 켜도 옮기지 않고 바꾼 즐겨찾기가 남는다' : ''}`, ok && JSON.stringify(await railIds(page)) === JSON.stringify(want), { favorites: r.favorites, claude: { model: by.claude.model, effort: by.claude.effort, mode: by.claude.permissionMode, herdr: by.claude.allowHerdr }, codex: by.codex.args, deepseek: by.deepseek.model, settingsHasOld: 'claudeModel' in s });
      if (round === 1) {
        const box = await page.$eval('[data-role="rail-left"]', (e) => { const q = e.getBoundingClientRect(); return { x: Math.max(0, q.x - 6), y: Math.max(0, q.y - 6), width: q.width + 320, height: q.height + 12 }; });
        await shot(page, 'p33-13-migrated-rail', box);
        await openSettings(page);
        await modalShot(page, 'p33-14-migrated-tab');
        await closeSettings(page);
        await call(page, 'launcher.favorite', { id: 'shell', favorite: false }); // 사용자가 바꾼 것은 다시 켜도 남는다
      }
    } catch (e) { step(`9 옮기기 ${round} 오류`, false, e.stack || e.message); }
    finally { await closeApp(app); }
    try { log('backend stop', atriumIn(DATA2, 'backend', 'stop').trim()); } catch (e) { log('backend stop', e.message.split('\n')[0]); }
  }
}

if (!ONLY_MIGRATE) await mainRun();
await migrateRun();
fs.writeFileSync(path.join(OUT, `p33-launchers${ONLY_MIGRATE ? '-migrate' : ''}.json`), JSON.stringify(results, null, 2));
log(`결과 ${results.filter((r) => r.ok).length}/${results.length}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
