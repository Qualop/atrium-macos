// P48(원격 R2) 창 시험: 백엔드가 내주는 웹 화면을 Playwright Chromium으로 연다. 따로 띄운 개발용 판(herdr 세션 atrium-dev-p48, 포트 47866,
// backend/.dev/data·app)으로만 띄운다. 결과는 experiments/p48/(git 밖).
//   1. 짝 맺기 전: 짝 맺기 화면만 보이고 /web/me, WebSocket이 거부된다
//   2. PC 창(Electron)의 설정 › 연결된 기기에서 코드를 만들고 브라우저에 넣으면 보드가 열린다
//   3. 브라우저에서: 새 세션 창의 폴더 고르기(PC 폴더 탐색기)로 시험 폴더를 골라 셸 세션을 띄우고, 터미널에 치고(글이 보임), 노드를 옮긴다
//   4. 에이전트(claude haiku) 세션에 명령 바로 보낸다(hook이 그대로 오는지도 본다)
//   5. 그림을 터미널과 명령 바에 붙여 넣으면 PC 경로가 들어간다. 웹 알림이 뜨고 누르면 그 세션으로 간다
//   6. 허락으로 짝 맺기(두 번째 브라우저): PC 창 위의 카드에서 허락
//   7. PC 창에서 끊으면 그 브라우저가 곧바로 짝 맺기 화면으로 돌아간다. Electron 창은 그대로 쓴다
// 실행: node app/test/e2e/p48-web.mjs (판 값은 이 파일이 넣는다). 끝나면 세션을 끄고 창을 닫는다. 백엔드·herdr 정리는 따로(보고 참고)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p48');
const TEST = 'C:\\Workspace\\mtask-p48-web';
const CONVOS = path.join(OUT, 'convos'); // 판 밖 대화 목록은 빈 폴더만 본다
export const ENV = {
  ATRIUM_HERDR_SESSION: 'atrium-dev-p48', ATRIUM_PORT: '47866',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p48',
};
Object.assign(process.env, ENV); // harness를 부르기 전에(결과 폴더)
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true }); fs.mkdirSync(TEST, { recursive: true });
const { launch, logger, shot, sleep, until, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs').catch(() => ({}));
if (assertTestBoard) try { assertTestBoard(process.env); } catch (e) { console.error(e.message); process.exit(2); }

const log = logger('p48-web');
const BASE = `http://127.0.0.1:${ENV.ATRIUM_PORT}`;
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: { ...process.env, ...ENV } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };
const wshot = async (page, name) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f }); log(`스크린숏 experiments/p48/${name}.png`); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let app, win, browser, killed = [];
try {
  ({ app, page: win } = await launch({ log, env: ENV }));
  await win.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
  const st0 = JSON.parse(atrium('--json', 'status'));
  check('atrium status에 화면 주소', st0.web && st0.web.url === `${BASE}/` && st0.web.built, st0.web);
  log(atrium('status').split('\n').find((l) => l.includes('화면 주소')) || '');

  browser = await chromium.launch({ headless: true, channel: 'chromium' }); // 새 headless(전체 Chromium): 알림을 쓴다
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 880 }, locale: 'ko-KR' });
  await ctx.grantPermissions(['notifications', 'clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') log(`[web console.error] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => log(`[web pageerror] ${e.message}`));

  // 1. 짝 맺기 전
  const t0 = Date.now();
  await page.goto(`${BASE}/`);
  await page.waitForSelector('[data-role=pair]', { timeout: 20000 });
  log(`첫 화면 ${Date.now() - t0}ms`);
  const before = await page.evaluate(async () => {
    const me = (await fetch('/web/me')).status;
    const ws = await new Promise((r) => { const w = new WebSocket(`ws://${location.host}/api?device=bogus`); w.onopen = () => r('open'); w.onerror = () => r('refused'); });
    return { me, ws, board: !!document.querySelector('.mt-canvas'), loaded: !!(window.__mt && window.__mt.getState().boardLoaded) };
  });
  check('짝 맺기 전: 보드 안 보임, API 거부', before.me === 401 && before.ws === 'refused' && !before.board && !before.loaded, before);
  const cache = await page.evaluate(async () => { const r = await fetch('/renderer.js', { method: 'HEAD' }); return { cc: r.headers.get('cache-control'), etag: !!r.headers.get('etag') }; });
  check('화면 파일 캐시 머리글(ETag, no-cache)', cache.cc === 'no-cache' && cache.etag, cache);
  await wshot(page, '01-pair-screen');

  // 2. PC 창에서 코드 만들기 → 브라우저에 넣기
  await win.click('[data-action=settings-open]');
  await win.click('[data-tab=devices]');
  await win.click('[data-action=device-new-code]');
  const code = (await win.textContent('[data-role=pair-code]')).trim();
  await shot(win, '02-pc-code', log);
  check('PC 창에 6자리 코드', /^\d{6}$/.test(code));
  await page.fill('[data-field=pair-name]', 'p48 시험 브라우저');
  // 틀린 코드 먼저
  await page.fill('[data-field=pair-code]', code === '111111' ? '222222' : '111111');
  await page.click('[data-action=pair-submit]');
  await page.waitForSelector('[data-role=pair-error]');
  check('틀린 코드는 거부', true, await page.textContent('[data-role=pair-error]'));
  await page.fill('[data-field=pair-code]', code);
  await page.click('[data-action=pair-submit]');
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 60000 });
  await page.evaluate(() => window.__mt.pinBottom(true));
  check('코드로 짝 맺으면 보드가 열림', true);
  const listed = await win.evaluate(() => [...document.querySelectorAll('[data-device]')].map((e) => e.textContent));
  check('PC 창 연결된 기기에 보임', listed.some((x) => x.includes('p48 시험 브라우저')), listed);
  await shot(win, '03-pc-devices', log);
  await win.click('[data-action=settings-close]');
  await sleep(2500);
  await wshot(page, '04-web-board');

  // 3. 폴더 탐색기로 시험 폴더를 골라 셸 세션
  await page.click('[data-action=chip-spawn]');
  await page.waitForSelector('[data-role=spawn]');
  await page.click('[data-action=spawn-browse]');
  await page.waitForSelector('[data-role=folder-picker]');
  await page.waitForSelector('.mt-fpick-place');
  await page.fill('[data-field=fpick-path]', 'C:\\Workspace');
  await page.click('[data-action=fpick-go]');
  await page.waitForSelector('.mt-fpick-dir[data-name="mtask-p48-web"]');
  await wshot(page, '05-folder-picker');
  await page.click('.mt-fpick-dir[data-name="mtask-p48-web"]');
  await page.waitForFunction((p) => document.querySelector('[data-field=fpick-path]').value === p, TEST);
  await page.click('[data-action=fpick-choose]');
  await page.waitForSelector('[data-role=folder-picker]', { state: 'detached' });
  const cwd = await page.inputValue('[data-field=cwd]');
  check('폴더 탐색기로 고른 폴더가 들어감', cwd === TEST, cwd);
  if (await page.$('[data-field=launcher]')) await page.selectOption('[data-field=launcher]', '');
  await page.selectOption('[data-field=kind]', 'shell');
  await page.fill('[data-field=name]', 'p48sh');
  await page.click('[data-action=spawn-submit]');
  await page.waitForSelector('[data-role=spawn]', { state: 'detached', timeout: 30000 });
  const sh = await until(() => page.evaluate(() => [...window.__mt.getState().sessions.values()].find((s) => s.name === 'p48sh') || null), 30000);
  killed.push('p48sh');
  await until(() => page.evaluate((id) => !!window.__mt.terms.get(id), sh.sessionId), 30000).catch(() => null);
  if (!(await page.evaluate((id) => !!window.__mt.terms.get(id), sh.sessionId))) { await page.evaluate((id) => window.__mt.getState().navigateTo(id), sh.sessionId); await sleep(1500); await page.click(`.react-flow__node[data-id="${sh.sessionId}"]`).catch(() => {}); }
  await until(() => page.evaluate((id) => !!window.__mt.terms.get(id), sh.sessionId), 30000);
  await sleep(2500);
  // PC 창도 같은 노드를 보고 있으면 한 패널에 제어기는 하나라 나중에 붙은 쪽이 가져간다(takeover, P47 범위). 브라우저가 다시 붙는다
  const reattach = async () => { const b = await page.$(`.react-flow__node[data-id="${sh.sessionId}"] [data-action=term-reattach]`); if (b) { log('브라우저가 터미널에 다시 붙음(takeover)'); await b.evaluate((el) => el.click()); await sleep(2000); } };
  await reattach();
  await page.click(`.mt-term[data-session="${sh.sessionId}"]`);
  await page.keyboard.type('echo web-p48-$((6*7))'.replace('$((6*7))', 'hello'));
  await page.keyboard.press('Enter');
  const echoed = await until(async () => { const t = await page.evaluate((id) => { const tm = window.__mt.terms.get(id); const b = tm.buffer.active; let s = ''; for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) s += l.translateToString(true) + '\n'; } return s; }, sh.sessionId); return (t.match(/web-p48-hello/g) || []).length >= 2 ? t : null; }, 20000).catch(() => null);
  check('웹 터미널에 친 글과 출력이 보임', !!echoed);
  await wshot(page, '06-web-terminal');
  // 노드 옮기기(머리줄을 끈다)
  const pos0 = await win.evaluate(async (id) => (await window.__mt.api.call('board.get')).nodes.find((n) => n.session_id === id), sh.sessionId);
  const head = await page.$(`.react-flow__node[data-id="${sh.sessionId}"] .mt-con-head, .react-flow__node[data-id="${sh.sessionId}"] .mt-node-head`);
  const hb = head ? await head.boundingBox() : (await (await page.$(`.react-flow__node[data-id="${sh.sessionId}"]`)).boundingBox());
  await page.mouse.move(hb.x + 40, hb.y + 8); await page.mouse.down(); await page.mouse.move(hb.x + 140, hb.y + 68, { steps: 8 }); await page.mouse.up();
  await sleep(1500);
  const pos1 = await win.evaluate(async (id) => (await window.__mt.api.call('board.get')).nodes.find((n) => n.session_id === id), sh.sessionId);
  check('웹에서 노드를 옮기면 판(PC 창)에도 반영', pos0 && pos1 && (pos0.x !== pos1.x || pos0.y !== pos1.y), { from: pos0 && [pos0.x, pos0.y], to: pos1 && [pos1.x, pos1.y] });

  // 5. 그림 붙여넣기: 터미널
  await reattach();
  const pasteFile = (sel) => page.evaluate(([sel, b64]) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bin], 'p48 shot.png', { type: 'image/png' }));
    const el = document.querySelector(sel);
    const target = el.querySelector('textarea') || el;
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  }, [sel, PNG.toString('base64')]);
  await pasteFile(`.mt-term[data-session="${sh.sessionId}"]`);
  const pasted = await until(async () => { const t = await page.evaluate((id) => { const tm = window.__mt.terms.get(id); const b = tm.buffer.active; let s = ''; for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) s += l.translateToString(true); } return s; }, sh.sessionId); return /uploads[\\/]+\d{8}-\d{6}-[0-9a-f]{6}-p48 shot\.png/.test(t) ? t : null; }, 15000).catch(() => null);
  const upDir = path.join(ENV.ATRIUM_DATA_DIR, 'uploads');
  const ups = fs.existsSync(upDir) ? fs.readdirSync(upDir) : [];
  check('터미널에 그림을 붙이면 PC 경로가 들어감', !!pasted && ups.some((f) => f.endsWith('p48 shot.png')), ups);
  await page.click(`.mt-term[data-session="${sh.sessionId}"]`).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {}); // 붙여 넣은 경로가 든 줄을 지운다(PowerShell)
  await wshot(page, '07-paste-terminal');
  // 명령 바
  await page.click('[data-role=command]');
  await page.fill('[data-role=command]', '@p48c look at ');
  await pasteFile('[data-role=bottom] .mt-cmd');
  const cmdVal = await until(async () => { const v = await page.inputValue('[data-role=command]'); return /uploads/.test(v) ? v : null; }, 15000).catch(() => null);
  check('명령 바에 그림을 붙이면 PC 경로가 들어감', !!cmdVal && cmdVal.startsWith('@p48c look at "'), cmdVal);
  await page.fill('[data-role=command]', '');

  // 4. 에이전트 세션과 명령 바
  const r = await win.evaluate((cwd) => window.__mt.api.call('session.spawn', { cwd, name: 'p48c', kind: 'claude', model: 'haiku' }), TEST);
  killed.push('p48c');
  log(`claude 세션 ${JSON.stringify({ trust: r.trust })}`);
  const ready = await until(() => page.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p48c'); return s && ['idle', 'waiting', 'ready'].includes(s.state) ? s.state : (s && s.state === 'trust_wait' ? 'trust' : null); }), 120000).catch(() => null);
  log(`claude 상태 ${ready}`);
  if (ready && ready !== 'trust') {
    await page.fill('[data-role=command]', '@p48c Reply with exactly one word: pong');
    await page.keyboard.press('Enter');
    const conf = await until(() => page.evaluate(() => [...window.__mt.getState().deliveries.values()].find((d) => d.name === 'p48c' && ['confirmed', 'unconfirmed', 'failed'].includes(d.status)) || null), 90000).catch(() => null);
    check('웹 명령 바로 보낸 글이 전달됨', conf && conf.status === 'confirmed', conf && conf.status);
    const hookOk = await until(async () => { const g = await win.evaluate(() => window.__mt.api.call('session.get', { session: 'p48c', screen: false })); return g.hooked && g.lastAnswer ? g : null; }, 90000).catch(() => null);
    check('hook이 그대로 들어옴(답을 hook으로 받음)', !!hookOk, hookOk && String(hookOk.lastAnswer).slice(0, 60));
  } else check('claude 세션 준비', false, ready === 'trust' ? '신뢰 대화상자(대신 누르지 않음)' : 'timeout');

  // 웹 알림: 권한을 준 시험 브라우저에서 띄우고, 누르면 그 세션으로 간다
  const note = await page.evaluate(async (id) => {
    const r = await window.mt.notify({ sessionId: id, key: 'p48-test', title: '@p48sh test', body: 'web notification' });
    const n = window.__mtWeb.notes.at(-1);
    let went = null;
    const st = window.__mt.getState(); const orig = st.navigateTo;
    if (n) { const p = new Promise((res) => { st.navigateTo = (x) => { went = x; st.navigateTo = orig; orig(x); res(); }; }); n.note.onclick(); await Promise.race([p, new Promise((r2) => setTimeout(r2, 2000))]); }
    return { r, permission: Notification.permission, went };
  }, sh.sessionId);
  check('웹 알림이 뜨고 누르면 그 세션으로 감', note.r.shown && note.went === sh.sessionId, note);

  // 6. 허락으로 짝 맺기(두 번째 브라우저)
  const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/`);
  await p2.waitForSelector('[data-action=pair-ask]');
  await p2.click('[data-action=pair-ask]');
  const check2 = (await p2.textContent('[data-role=pair-check]')).trim();
  await win.waitForSelector('[data-role=pair-request-banner]', { timeout: 10000 });
  const bannerCheck = (await win.textContent('[data-role=pair-request-banner] [data-role=request-check]')).trim();
  await shot(win, '08-pc-approve-card', log);
  check('PC 창에 허락 카드와 같은 확인 번호', bannerCheck === check2, { web: check2, pc: bannerCheck });
  await win.click('[data-role=pair-request-banner] [data-action=device-allow]');
  await p2.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 60000 });
  check('허락하면 두 번째 브라우저도 보드가 열림', true);
  await ctx2.close();

  // 7. 끊기
  await win.click('[data-action=settings-open]');
  await win.click('[data-tab=devices]');
  await win.waitForSelector('[data-device]');
  const mine = await page.evaluate(async () => (await window.__mt.api.call('device.list')).me); // 이 브라우저(앞선 시험의 같은 이름 기기와 헷갈리지 않게)
  const tr = Date.now();
  await win.click(`[data-device="${mine.id}"] [data-action=device-revoke]`);
  await shot(win, '09-pc-revoke', log);
  await page.waitForSelector('[data-role=pair]', { timeout: 15000 });
  const after = await page.evaluate(async () => ({ me: (await fetch('/web/me', { headers: { authorization: `Bearer ${localStorage.getItem('atrium.deviceToken') || 'x'}` } })).status, board: !!document.querySelector('.mt-canvas') }));
  check('끊으면 그 브라우저가 곧바로 막힘', after.me === 401 && !after.board, { ...after, ms: Date.now() - tr });
  await wshot(page, '09-revoked');
  await win.click('[data-action=settings-close]');

  // Electron 창은 그대로: 같은 셸 터미널에 친다
  await win.evaluate((id) => window.__mt.getState().navigateTo(id), sh.sessionId);
  await sleep(1500);
  await win.click(`.react-flow__node[data-id="${sh.sessionId}"]`).catch(() => {});
  await until(() => win.evaluate((id) => !!window.__mt.terms.get(id), sh.sessionId), 30000).catch(() => null);
  await sleep(1500);
  const wb = await win.$(`.react-flow__node[data-id="${sh.sessionId}"] [data-action=term-reattach]`);
  if (wb) { log('PC 창이 터미널에 다시 붙음(브라우저가 가져갔던 것, takeover)'); await wb.evaluate((el) => el.click()); await sleep(2000); }
  await win.click(`.mt-term[data-session="${sh.sessionId}"]`).catch(() => {});
  await win.keyboard.type('echo pc-p48-ok');
  await win.keyboard.press('Enter');
  const pcOk = await until(async () => { const t = await win.evaluate((id) => { const tm = window.__mt.terms.get(id); if (!tm) return ''; const b = tm.buffer.active; let s = ''; for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) s += l.translateToString(true) + '\n'; } return s; }, sh.sessionId); return (t.match(/pc-p48-ok/g) || []).length >= 2; }, 20000).catch(() => false);
  check('Electron 창은 지금처럼(터미널 입력과 출력)', pcOk);
  await shot(win, '10-pc-after', log);
} catch (e) {
  log(`오류 ${e.stack}`);
  check('시험이 끝까지 돎', false, e.message);
} finally {
  for (const n of killed) { try { atrium('kill', n, '--yes'); log(`세션 끔 ${n}`); } catch (e) { log(`kill ${n} 실패 ${e.message.split('\n')[0]}`); } }
  if (browser) await browser.close().catch(() => {});
  if (app) await closeApp(app);
  fs.writeFileSync(path.join(OUT, 'p48-web-results.json'), JSON.stringify(results, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
