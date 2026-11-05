// P34 창 시험: 데스크톱 앱에서 가져오기. 판: herdr 세션 atrium-dev-p34, 포트 47852, 이 워크트리의 backend/.dev(experiments/p34/tools/env.cjs).
// 자료: experiments/p34/tools/fixtures.cjs make가 만든 원본 대화 다섯(haiku)과 가짜 앱 목록(같은 폴더, 워크트리 있음, 워크트리 지워짐, 보관됨, 앱에서 도는 중).
// 실제 데스크톱 앱 폴더와 실제 대화는 쓰지 않는다. 시험 claude는 haiku.
// 사용: node experiments/p34/tools/e2e.cjs p34-import.mjs
// 차례: 1 목록(보관됨 없음, 상태, 기본 고름) → 2 가져오기(진행·결과) → 3 리포 영역의 잠든 노드와 제목 → 4 하나 깨워 원본 기억 묻기(다른 것은 잠든 채)
//       → 5 지워진 워크트리 세션이 저장소 폴더에서 이어짐 → 6 원본을 한 턴 더 이어 가면 "더 씀", 다시 가져오면 2세대
//       → 7 최소 창 영어·한국어(창 틀은 넘치지 않고 목록만 스크롤) → 8 데이터 폴더 밖 앱 폴더로 켠 개발용 판은 거부
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p34') throw new Error('MT_E2E_OUT=p34를 명령줄에서 준다');
const req = createRequire(import.meta.url);
const T = req(path.join(REPO, 'experiments', 'p34', 'tools', 'env.cjs'));
const FX = req(path.join(REPO, 'experiments', 'p34', 'tools', 'fixtures.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P34_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p34' || ENV.ATRIUM_PORT !== '47852') throw new Error('P34 판(atrium-dev-p34, 47852)만');
if (!path.resolve(ENV.ATRIUM_CLAUDE_DESKTOP).startsWith(path.resolve(T.DEV))) throw new Error('가짜 앱 목록은 backend/.dev 안');
fs.mkdirSync(OUT, { recursive: true });
const fx = JSON.parse(fs.readFileSync(T.FIXTURES, 'utf8'));

const log = logger('p34-import');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE|ATRIUM_|MTASK_)/.test(k)));
const envWith = (over = {}) => ({ ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION, ...over });
const atrium = (env, ...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const call = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const callErr = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp).then(() => null, (e) => ({ code: e.code, key: e.key, vars: e.vars, message: e.message })), [m, p]);
const sessions = (page) => page.evaluate(() => [...window.__mt.getState().sessions.values()].map((s) => ({ id: s.sessionId, name: s.name, state: s.state, cwd: s.cwd, model: s.model, imported: s.imported || null, lastAnswer: s.lastAnswer, lastAnswerAt: s.lastAnswerAt || 0 })));
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const shot = async (page, name, clip) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f, ...(clip ? { clip } : {}) }); log('스크린숏', path.relative(REPO, f)); };
const size = async (app, w, h) => { await app.evaluate(({ BrowserWindow }, [ww, hh]) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(ww, hh); }, [w, h]); await sleep(700); };
const rows = (page) => page.$$eval('[data-role="import-list"] [data-app]', (els) => els.map((e) => ({ app: e.dataset.app, status: e.dataset.status, running: e.dataset.running === '1', checked: e.querySelector('input').checked, disabled: e.querySelector('input').disabled, text: e.textContent })));
async function openImport(page) {
  if (!(await page.$('[data-role="desktop-import"]'))) {
    await page.click('[data-action="ws-open"]');
    await page.waitForSelector('[data-action="desktop-import-open"]', { timeout: 5000 });
    await page.click('[data-action="desktop-import-open"]');
  }
  await page.waitForSelector('[data-role="desktop-import"]', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('[data-role="import-list"], [data-role="import-error"]'), null, { timeout: 30000 });
  await sleep(300);
}
const closeImport = async (page) => { await page.click('[data-action="import-close"]').catch(() => {}); await sleep(200); };
const modalClip = (page) => page.$eval('[data-role="desktop-import"]', (e) => { const b = e.getBoundingClientRect(); return { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), width: Math.min(b.width + 8, innerWidth), height: Math.min(b.height + 8, innerHeight) }; });
// P28 검사: 창(모달)은 화면 안이고 틀(모달과 목록 밖의 칸)에는 스크롤이 없다. 목록 칸만 스크롤된다. 글이 잘려 넘친 단추가 없다
const frameCheck = (page) => page.evaluate(() => {
  const m = document.querySelector('[data-role="desktop-import"]');
  const list = m.querySelector('[data-role="import-list"]');
  const over = [m, ...m.querySelectorAll('*')].filter((e) => e !== list && !(list && list.contains(e))).filter((e) => { const cs = getComputedStyle(e); return (e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(cs.overflowY)) || (e.scrollWidth > e.clientWidth + 1 && /(auto|scroll)/.test(cs.overflowX)); }).map((e) => `${e.className || e.tagName}`);
  const r = m.getBoundingClientRect();
  const btns = [...m.querySelectorAll('button')].filter((b) => { const q = b.getBoundingClientRect(); return q.right > r.right + 1 || q.bottom > r.bottom + 1; }).map((b) => b.dataset.action);
  return { over, btns, out: r.bottom > innerHeight || r.right > innerWidth || r.top < 0 || r.left < 0, w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight };
});
async function launchApp(env) {
  const app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  return { app, page };
}
// 보낸 뒤(since)의 새 답만 본다. 가져온 노드는 원본의 마지막 답("OK ALPHA")을 이미 보이므로 그것과 섞지 않는다
async function waitAnswer(page, name, word, since, ms = 180000) {
  return until(async () => { const s = (await sessions(page)).find((x) => x.name === name); return s && s.state === 'ready' && s.lastAnswerAt > since && s.lastAnswer && s.lastAnswer.toUpperCase().includes(word) ? s : null; }, ms, 1000).catch(() => null);
}
async function ask(page, name, word) {
  const since = Date.now();
  await call(page, 'session.send', { target: name, text: ASK });
  return waitAnswer(page, name, word, since);
}
const ASK = 'What secret code words have you been asked to remember so far in this conversation? Reply with only the words, space separated.';

async function main() {
  const env = envWith();
  const DATA = ENV.ATRIUM_DATA_DIR;
  try { log('backend stop', atrium(env, 'backend', 'stop').trim()); } catch (e) { log('backend stop', e.message.split('\n')[0]); }
  if (!path.resolve(DATA).startsWith(path.resolve(T.DEV))) throw new Error('데이터 폴더가 backend/.dev 밖');
  fs.rmSync(DATA, { recursive: true, force: true });
  // 앱에서 도는 세션: 가짜 세션 파일. pid는 살아 있는 이 시험 프로세스다
  fs.mkdirSync(T.SESS, { recursive: true });
  fs.writeFileSync(path.join(T.SESS, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: fx.run.convId, cwd: fx.run.cwd, entrypoint: 'claude-desktop', kind: 'interactive' }));
  let { app, page } = await launchApp(env);
  const made = () => sessions(page).then((l) => l.filter((s) => s.imported));
  try {
    await size(app, 1584, 921);
    await call(page, 'settings.set', { language: 'en' });
    await sleep(300);

    // 1. 목록
    await openImport(page);
    const r1 = await rows(page);
    const by = Object.fromEntries(r1.map((r) => [r.app, r]));
    step('1 목록: 보관됨은 보이지 않고 넷이 보인다', r1.length === 4 && !by[fx.arch.appId], r1.map((r) => `${r.app}:${r.status}${r.checked ? '*' : ''}${r.running ? ' run' : ''}`));
    step('1 상태: 모두 새것, 지워진 워크트리는 저장소 폴더 표시', ['same', 'wt', 'gone', 'run'].every((k) => by[fx[k].appId] && by[fx[k].appId].status === 'new') && /repo folder/.test(by[fx.gone.appId].text), by[fx.gone.appId] && by[fx.gone.appId].text);
    step('1 기본 고름: 새것은 고르고 앱에서 도는 것은 빼고 "running" 표시', by[fx.same.appId].checked && by[fx.wt.appId].checked && by[fx.gone.appId].checked && !by[fx.run.appId].checked && by[fx.run.appId].running);
    await shot(page, 'p34-1-list-en', await modalClip(page));
    // 도는 것을 고르면 알린다, 다시 푼다
    await page.click(`[data-app="${fx.run.appId}"] input`);
    const warn = await page.$eval('[data-role="import-running-warn"]', (e) => e.textContent).catch(() => null);
    step('1 도는 것을 고르면 "진행 중인 턴은 빠질 수 있다" 알림', !!warn && /in progress/.test(warn), warn);
    await page.click(`[data-app="${fx.run.appId}"] input`);
    // 모두 고르기·풀기
    await page.click('[data-action="import-none"]');
    const none = (await rows(page)).filter((r) => r.checked).length;
    await page.click('[data-action="import-all"]');
    const all = (await rows(page)).filter((r) => r.checked).length;
    step('1 모두 풀기·모두 고르기', none === 0 && all === 4, { none, all });
    await page.click(`[data-app="${fx.run.appId}"] input`); // 도는 것은 다시 뺀다

    // 2. 가져오기
    await page.click('[data-action="import-run"]');
    await page.waitForSelector('[data-role="import-result"]', { timeout: 60000 });
    const resText = await page.$eval('[data-role="import-result"]', (e) => e.textContent);
    step('2 가져오기 결과 요약', /Imported 3, skipped 0/.test(resText), resText);
    await shot(page, 'p34-2-result-en', await modalClip(page));
    const r2 = Object.fromEntries((await rows(page)).map((r) => [r.app, r]));
    step('2 가져온 뒤 목록: 이미 옮김', ['same', 'wt', 'gone'].every((k) => r2[fx[k].appId].status === 'imported') && r2[fx.run.appId].status === 'new', Object.values(r2).map((r) => `${r.app}:${r.status}`));
    await closeImport(page);

    // 3. 잠든 노드와 제목
    const imp = await until(async () => { const l = await made(); return l.length === 3 ? l : null; }, 10000).catch(() => []);
    const byTitle = Object.fromEntries(imp.map((s) => [s.imported.title, s]));
    step('3 잠든 판 세션 셋(모델 haiku, 앱 제목)', imp.length === 3 && imp.every((s) => s.state === 'sleeping' && s.model === 'haiku'), imp.map((s) => `${s.name}:${s.state}:${s.model}:${s.imported.title}:${s.cwd}`));
    const sSame = byTitle['Same folder session'], sWt = byTitle['Worktree session'], sGone = byTitle['Deleted worktree session'];
    step('3 이름: 워크트리 이름, 아니면 <리포>-<번호>', sWt && sWt.name === 'wt-alive' && sGone && sGone.name === 'wt-gone' && sSame && /^mtask-p34-repo-\d+$/.test(sSame.name), imp.map((s) => s.name));
    step('3 지워진 워크트리 세션의 폴더는 저장소 폴더', sGone && path.resolve(sGone.cwd).toLowerCase() === path.resolve(T.REPO).toLowerCase(), sGone && sGone.cwd);
    const ws = await page.evaluate(() => window.__mt.getState().workspaces.map((w) => ({ key: w.key, name: w.name })));
    step('3 세 세션이 한 리포 영역(시험 폴더)', ws.length === 1 && ws[0].name === 'mtask-p34-repo', ws);
    await page.evaluate((k) => window.__mt.selectWorkspace && window.__mt.selectWorkspace(k), ws[0] && ws[0].key).catch(() => {});
    await page.click(`.mt-wsbtn[data-name="mtask-p34-repo"]`).catch(() => {});
    await sleep(1500);
    const titles = await page.$$eval('[data-role="import-title"]', (els) => els.map((e) => e.textContent));
    step('3 캔버스: 잠든 노드에 앱 제목이 보인다', titles.length === 3, titles);
    await shot(page, 'p34-3-canvas');

    // 4. 하나 깨워 묻기. 같은 리포의 다른 가져온 세션은 잠든 채
    const w1 = await call(page, 'session.wake', { session: sSame.name });
    log('wake', w1);
    const after = Object.fromEntries((await made()).map((s) => [s.name, s.state]));
    step('4 누른 세션만 깬다(가져온 다른 세션은 잠든 채)', after[sSame.name] !== 'sleeping' && after['wt-alive'] === 'sleeping' && after['wt-gone'] === 'sleeping', after);
    const a1 = await ask(page, sSame.name, 'ALPHA');
    step('4 깨운 세션이 원본 대화를 기억한다(ALPHA)', !!a1, a1 && a1.lastAnswer);
    await shot(page, 'p34-4-woken');

    // 5. 지워진 워크트리 세션
    await call(page, 'session.wake', { session: 'wt-gone' });
    const a2 = await ask(page, 'wt-gone', 'CHARLIE');
    step('5 지워진 워크트리 세션이 저장소 폴더에서 이어진다(CHARLIE)', !!a2, a2 && { answer: a2.lastAnswer, cwd: a2.cwd });

    // 6. 원본을 한 턴 더 → 더 씀 → 2세대
    log('원본 이어 가기', FX.claudeP(fx.same.cwd, ['--resume', fx.same.convId, 'Also remember the code word GOLF. Reply with exactly: OK GOLF']));
    await openImport(page);
    const r6 = Object.fromEntries((await rows(page)).map((r) => [r.app, r]));
    const moreRow = r6[fx.same.appId];
    step('6 원본을 더 쓰면 "더 씀"이고 기본으로 고른다', moreRow && moreRow.status === 'more' && moreRow.checked && /\+1 prompts, 1 answers/.test(moreRow.text), moreRow && moreRow.text);
    await shot(page, 'p34-5-more-en', await modalClip(page));
    await page.click('[data-action="import-none"]');
    await page.click(`[data-app="${fx.same.appId}"] input`);
    await page.click('[data-action="import-run"]');
    await page.waitForSelector('[data-role="import-result"]', { timeout: 60000 });
    await closeImport(page);
    const gen2 = (await made()).find((s) => s.imported.gen === 2);
    step('6 다시 가져오면 2세대가 생기고 옛 갈래는 그대로', !!gen2 && gen2.state === 'sleeping' && (await made()).some((s) => s.id === sSame.id), gen2 && { name: gen2.name, gen: gen2.imported.gen });
    const led = await call(page, 'desktop.list');
    const sameNow = led.repos.flatMap((g) => g.items).find((c) => c.appSessionId === fx.same.appId);
    step('6 장부: 2세대 뒤 상태는 이미 옮김', sameNow && sameNow.status === 'imported' && sameNow.imported.gen === 2, sameNow && sameNow.imported);
    if (gen2) {
      await call(page, 'session.wake', { session: gen2.name });
      const a3 = await ask(page, gen2.name, 'GOLF');
      step('6 2세대는 앱에서 더 쓴 턴까지 안다(ALPHA GOLF)', !!a3 && /ALPHA/i.test(a3.lastAnswer), a3 && a3.lastAnswer);
    }
    await shot(page, 'p34-6-canvas-gen2');

    // 7. 최소 창(900×600), 영어·한국어
    await size(app, 900, 600);
    for (const lang of ['en', 'ko']) {
      await call(page, 'settings.set', { language: lang });
      await sleep(400);
      await openImport(page);
      const fc = await frameCheck(page);
      step(`7 최소 창 ${lang}: 창 틀은 넘치지 않고 목록만 스크롤`, !fc.out && !fc.over.length && !fc.btns.length, fc);
      await shot(page, `p34-7-min-${lang}`);
      await closeImport(page);
    }
    await call(page, 'settings.set', { language: 'en' });
  } finally {
    // 시험 세션 끄기(잠든 것은 패널이 없다)
    for (const s of await sessions(page).catch(() => [])) {
      const r = await call(page, 'session.kill', { session: s.id, confirm: true }).catch((e) => ({ error: e.message }));
      log('kill', s.name, JSON.stringify(r).slice(0, 160));
    }
    await closeApp(app);
  }

  // 8. 막기: 데이터 폴더 밖의 가짜 앱 폴더로 켠 개발용 판
  try { log('backend stop', atrium(env, 'backend', 'stop').trim()); } catch (e) { log('backend stop', e.message.split('\n')[0]); }
  fs.mkdirSync(T.OUTSIDE_DESK, { recursive: true });
  ({ app, page } = await launchApp(envWith({ ATRIUM_CLAUDE_DESKTOP: T.OUTSIDE_DESK })));
  try {
    await size(app, 1584, 921);
    const e1 = await callErr(page, 'desktop.list');
    const e2 = await callErr(page, 'desktop.import', { all: true });
    step('8 데이터 폴더 밖 앱 폴더: 목록·가져오기 거부', e1 && e1.code === 'import_blocked' && e1.vars.reason === 'dev_outside_data' && e2 && e2.code === 'import_blocked', { e1, e2: e2 && e2.code });
    await openImport(page);
    const msg = await page.$eval('[data-role="import-error"]', (e) => e.textContent).catch(() => null);
    step('8 창에 거부 까닭이 보인다', !!msg && /Import is off/.test(msg), msg);
    await shot(page, 'p34-8-blocked', await modalClip(page));
    await closeImport(page);
  } finally { await closeApp(app); }
  try { log('backend stop', atrium(env, 'backend', 'stop').trim()); } catch (e) { log('backend stop', e.message.split('\n')[0]); }

  fs.rmSync(path.join(T.SESS, `${process.pid}.json`), { force: true });
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과`);
  fs.writeFileSync(path.join(OUT, 'p34-import.json'), JSON.stringify(results, null, 2));
  if (bad.length) process.exitCode = 1;
}
main().catch((e) => { log('오류', e.stack); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 500)); // 창을 닫은 뒤 남은 핸들로 끝나지 않는 일이 있었다
