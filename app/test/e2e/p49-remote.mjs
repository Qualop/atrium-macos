// P49(원격 R3) 창 시험: PC 창(Electron)과 브라우저(Playwright Chromium)가 한 판을 함께 쓴다. 브라우저는 tailscale serve 흉내 프록시를 거친다.
//   브라우저 → ts-sim(47869: Host를 pc.example.ts.net으로, Tailscale-User-Login·X-Forwarded-*를 넣음) → 지연 프록시(47870) → 백엔드(47868)
// 판은 가짜 tailscale(p49-fake-tailscale.mjs, 예시 이름)을 읽는다. 따로 띄운 개발용 판(atrium-dev-p49, 47868, backend/.dev)만 쓴다. 결과는 experiments/p49/(git 밖).
//   1. 짝 맺기와 사용(같은 사용자), 다른 로그인 사용자 거부, hook·branch 거부, 허용 목록에 없는 Host 거부, PWA 매니페스트
//   2. 함께 쓰기: 같은 셸·claude(haiku) 터미널을 PC 창과 브라우저가 함께 보고 서로 뺏지 않는다. 크기 정하는 기기가 바뀌어도 깨지지 않는다. 알림은 활성 쪽에서만
//   3. 지연: 7·50·200ms(한 방향)에서 입력 → 화면 시간, 프레임 묶기 효과(같은 출력에 PC 창과 브라우저가 받은 프레임 수)
//   4. 끊김: 프록시를 끊었다 살리면, 백엔드를 다시 켜면 브라우저가 다시 붙고 터미널이 돌아온다. 끊긴 동안 "다시 연결 중" 띠
//   5. 웹 화면 배율, 왕복 지연 표시, 기기를 끊으면(4401) 짝 맺기 화면
// 실행: node app/test/e2e/p49-remote.mjs [--no-claude]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p49');
const TEST = 'C:\\Workspace\\mtask-p49-remote';
const CONVOS = path.join(OUT, 'convos');
const NAME = 'pc.example.ts.net';
export const ENV = {
  ATRIUM_HERDR_SESSION: 'atrium-dev-p49', ATRIUM_PORT: '47868',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p49',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: '47868',
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true }); fs.mkdirSync(TEST, { recursive: true });
const { launch, logger, shot, sleep, until, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV);
if (ENV.ATRIUM_PORT !== '47868' || ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p49') throw new Error('P49 판만');
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
const { startDelayProxy } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'delay-proxy.mjs')));

const argv = process.argv.slice(2);
const log = logger('p49-remote');
const BASE = `http://${NAME}:47869`;
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: { ...process.env, ...ENV }, timeout: 120000 });
const lastLine = (s) => s.trim().split(/\r?\n/).slice(-1)[0];
const results = [];
const metrics = {};
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`); };
const wshot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); log(`스크린숏 experiments/p49/${name}.png`); };
const textOf = (pg, id) => pg.evaluate((i) => { const tm = window.__mt.terms.get(i); if (!tm) return ''; const b = tm.buffer.active; let s = ''; for (let r = 0; r < b.length; r++) { const l = b.getLine(r); if (l) s += l.translateToString(true) + '\n'; } return s; }, id);
const termInfo = (pg, id) => pg.evaluate((i) => { const t = window.__mt.terms.get(i); const host = document.querySelector(`.mt-term[data-session="${i}"]`); if (!t || !host) return null; const hr = host.getBoundingClientRect(), sr = (host.querySelector('.xterm-screen') || host).getBoundingClientRect(); const wrap = host.closest('.mt-term-wrap'); return { cols: t.cols, rows: t.rows, scale: Number(host.dataset.scale || 1), fits: sr.right <= hr.right + 2 && sr.bottom <= hr.bottom + 2, cover: !!(wrap && wrap.querySelector('.mt-term-cover')) }; }, id);

let app, win, browser, tsim, delay, killed = [];
try {
  // 프록시: ts-sim → 지연 → 백엔드
  delay = startDelayProxy({ listen: 47870, target: 47868, delay: 0, jitter: 0, seed: 49, log: () => {} });
  tsim = startTsSim({ listen: 47869, target: 47870, name: NAME, login: 'me@example.com' });
  await tsim.ready;

  ({ app, page: win } = await launch({ log, env: ENV }));
  await win.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
  await win.evaluate(() => localStorage.setItem('mt.clientName', 'PC window'));
  await win.reload(); await win.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await win.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true));
  // 판이 가짜 tailscale을 읽을 때까지
  const rs = await until(async () => { const d = await win.evaluate(() => window.__mt.api.call('remote.status', { fresh: true })); return d && d.url ? d : null; }, 20000);
  check('판이 Tailscale 이름을 읽어 진단과 주소를 낸다(가짜 tailscale)', rs.url === `https://${NAME}/` && rs.checks.find((c) => c.id === 'hosts').level === 'ok', { url: rs.url, ready: rs.ready, levels: rs.checks.map((c) => `${c.id}:${c.level}`) });

  browser = await chromium.launch({ headless: true, channel: 'chromium', args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 880 }, locale: 'ko-KR' });
  await ctx.grantPermissions(['notifications', 'clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`[web pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[web console.error] ${m.text().slice(0, 200)}`); });

  // ---- 1. 바깥 요청 규칙 ----
  const t0 = Date.now();
  await page.goto(`${BASE}/`);
  await page.waitForSelector('[data-role=pair]', { timeout: 20000 });
  log(`첫 화면 ${Date.now() - t0}ms`);
  const http1 = await page.evaluate(async () => {
    const hook = (await fetch('/hooks/claude', { method: 'POST', body: '{}' })).status;
    const br = (await fetch('/branch/spawn', { method: 'POST', body: '{}' })).status;
    const mf = await fetch('/assets/pwa/manifest.webmanifest'); const j = await mf.json().catch(() => null);
    return { hook, br, manifest: mf.status, mtype: mf.headers.get('content-type'), mname: j && j.name, icons: j && j.icons.length, link: !!document.querySelector('link[rel=manifest]') };
  });
  check('Tailscale을 거친 hook·branch 요청은 403', http1.hook === 403 && http1.br === 403, http1);
  check('PWA 매니페스트와 아이콘', http1.manifest === 200 && /manifest\+json/.test(http1.mtype) && http1.mname === 'Atrium' && http1.icons === 3 && http1.link, http1);
  // 허용 목록에 없는 Host
  tsim.cfg.host = 'evil.example.ts.net';
  const bad = await page.evaluate(async () => (await fetch('/', { cache: 'no-store' })).status);
  tsim.cfg.host = null;
  check('허용 목록에 없는 Host는 421', bad === 421, { status: bad });
  // 다른 로그인 사용자
  await win.click('[data-action=settings-open]');
  await win.click('[data-tab=devices]');
  await win.waitForSelector('[data-role=remote-status]');
  await sleep(500);
  await shot(win, '01-pc-devices-remote', log);
  await win.click('[data-action=device-new-code]');
  const code = (await win.textContent('[data-role=pair-code]')).trim();
  tsim.cfg.login = 'someone-else@example.com';
  await page.fill('[data-field=pair-name]', 'p49 laptop');
  await page.fill('[data-field=pair-code]', code);
  await page.click('[data-action=pair-submit]');
  await page.waitForSelector('[data-role=pair-error]');
  const otherErr = await page.textContent('[data-role=pair-error]');
  const stillCode = (await win.textContent('[data-role=pair-code]').catch(() => '')).trim();
  check('다른 Tailscale 사용자는 맞는 코드로도 짝 맺지 못한다(코드는 그대로)', stillCode === code, otherErr);
  await wshot(page, '02-other-user-refused');
  tsim.cfg.login = null; // 태그 기기·funnel처럼 머리글 없음
  const noLogin = await page.evaluate(async (c) => (await fetch('/web/pair/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c }) })).status, code);
  check('사용자 머리글 없는 Tailscale 요청도 거부', noLogin === 403, { status: noLogin });
  tsim.cfg.login = 'me@example.com';
  await page.click('[data-action=pair-submit]');
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 60000 });
  // 노트북 화면처럼 글자를 키운다(터미널 글자 배율 120%): 같은 노드 크기에서 바라는 칸 수가 PC 창과 달라진다
  await page.evaluate(() => { localStorage.setItem('mt.clientName', 'Laptop browser'); localStorage.setItem('mt.termScale', '1.2'); });
  await page.reload(); await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.getState().conn === 'open', null, { timeout: 60000 });
  await page.evaluate(() => window.__mt.pinBottom(true));
  check('같은 사용자는 코드로 짝 맺고 보드를 쓴다', true);
  await win.click('[data-action=settings-close]').catch(() => {});
  const peers = await win.evaluate(() => window.__mt.api.call('clients.list'));
  const webC = peers.clients.find((c) => c.kind === 'web');
  check('브라우저가 웹 클라이언트로 목록에 있다(client·name·kind=web)', webC && webC.name === 'Laptop browser' && peers.clients.some((c) => c.kind === 'desktop'), peers.clients.map((c) => [c.name, c.kind]));

  // ---- 2. 함께 쓰기 ----
  log(lastLine(atrium('spawn', TEST, '--name', 'p49sh', '--kind', 'shell'))); killed.push('p49sh');
  const SH = await until(() => win.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p49sh'); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }), 30000);
  const viewNode = async (pg, id) => { await pg.evaluate((i) => window.__mt.getState().navigateTo(i), id); await sleep(1500); await until(() => pg.evaluate((i) => !!window.__mt.terms.get(i), id), 30000); await sleep(1200); };
  await viewNode(win, SH); await viewNode(page, SH);
  const typeIn = async (pg, id, s) => { await pg.click(`.mt-term[data-session="${id}"]`, { position: { x: 60, y: 30 } }); await sleep(150); await pg.keyboard.type(s); await pg.keyboard.press('Enter'); };
  await typeIn(page, SH, 'echo from-web-$((40+2))');
  const both1 = await until(async () => ((await textOf(win, SH)).includes('from-web-42') && (await textOf(page, SH)).includes('from-web-42')) || null, 20000).catch(() => null);
  await typeIn(win, SH, 'echo from-pc-$((40+3))');
  const both2 = await until(async () => ((await textOf(win, SH)).includes('from-pc-43') && (await textOf(page, SH)).includes('from-pc-43')) || null, 20000).catch(() => null);
  const relay1 = (await win.evaluate(() => window.__mt.api.call('backend.status'))).relay.filter((r) => r.sessionId === SH);
  const infoW = await termInfo(win, SH), infoP = await termInfo(page, SH);
  check('셸: 두 쪽에서 친 글이 두 쪽에 보이고, 제어기 하나에 클라이언트 둘(뺏지 않음)', both1 && both2 && relay1.length === 1 && relay1[0].clients === 2 && !infoW.cover && !infoP.cover, { relay: relay1.map((r) => ({ clients: r.clients, owner: r.owner, cols: r.cols, rows: r.rows, batched: r.batched })), infoW, infoP });
  await wshot(page, '03-web-shell'); await shot(win, '03-pc-shell', log);
  // 크기 정하는 기기 바꾸기: 번갈아 친다(입력한 쪽이 패널 크기를 가져간다). 브라우저는 글자가 커서 바라는 칸 수가 다르다
  const ids = { w: await win.evaluate(() => window.__mt.api.clientId), p: await page.evaluate(() => window.__mt.api.clientId) };
  const phase = async (pg, key, word) => {
    await typeIn(pg, SH, `echo ${word}`);
    await sleep(1500);
    const r = (await win.evaluate(() => window.__mt.api.call('backend.status'))).relay.find((x) => x.sessionId === SH);
    const both = (await textOf(win, SH)).includes(word) && (await textOf(page, SH)).includes(word);
    return { owner: r.owner === ids[key] ? key : r.owner, cols: r.cols, rows: r.rows, w: await termInfo(win, SH), p: await termInfo(page, SH), both };
  };
  const ph = [await phase(page, 'p', 'owner-web-1'), await phase(win, 'w', 'owner-pc-1'), await phase(page, 'p', 'owner-web-2')];
  const phOk = ph.every((x) => x.both && x.w.cols === x.cols && x.p.cols === x.cols && x.w.fits && x.p.fits && !x.w.cover && !x.p.cover) && ph[0].owner === 'p' && ph[1].owner === 'w' && ph[2].owner === 'p' && ph[0].cols !== ph[1].cols;
  check('크기 정하는 기기가 번갈아 바뀌어도 두 쪽 칸 수가 같고 화면이 칸 안에 든다(뺏기·덮개 없음)', phOk, ph.map((x) => ({ owner: x.owner, cols: x.cols, rows: x.rows, wScale: x.w.scale, pScale: x.p.scale, fits: [x.w.fits, x.p.fits], both: x.both })));
  await wshot(page, '03b-web-owner'); await shot(win, '03b-pc-not-owner', log);

  if (!argv.includes('--no-claude')) {
    log(lastLine(atrium('spawn', TEST, '--name', 'p49cl', '--model', 'haiku'))); killed.push('p49cl');
    const CL = await until(() => win.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p49cl'); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }), 30000);
    const stateOf = (pg) => pg.evaluate((i) => { const s = window.__mt.getState().sessions.get(i); return s ? { state: s.state, ask: !!s.ask } : null; }, CL);
    await until(async () => { const s = await stateOf(win); return s && !['starting', 'working'].includes(s.state); }, 120000).catch(() => null);
    log(lastLine(atrium('send', '@p49cl', 'Reply with the integers from 1 to 12, one per line, plain text only. Do not use any tools.', '--wait')));
    await viewNode(win, CL); await viewNode(page, CL);
    const clBoth = await until(async () => (/\b12\b/.test(await textOf(win, CL)) && /\b12\b/.test(await textOf(page, CL))) || null, 30000).catch(() => null);
    const rc = (await win.evaluate(() => window.__mt.api.call('backend.status'))).relay.filter((r) => r.sessionId === CL);
    check('claude(haiku): 답이 두 쪽에 보이고 제어기 하나를 나눈다', clBoth && rc.length === 1 && rc[0].clients === 2, rc.map((r) => ({ clients: r.clients, batched: r.batched })));
    await wshot(page, '04-web-claude');
    // 알림: 활성 쪽에서만. 두 쪽 모두 화면 밖으로 옮기고 승인 대기를 만든다
    for (const pg of [win, page]) await pg.evaluate(() => window.__mt.getState().setViewport({ x: 4000, y: 4000, zoom: 0.5 }));
    await sleep(800);
    await page.evaluate(() => window.__mt.api.call('client.active'));
    await sleep(300);
    const nb = { w: await win.evaluate(() => window.__mt.notifyLog.length), p: await page.evaluate(() => window.__mt.notifyLog.length), web: await page.evaluate(() => window.__mtWeb.notes.length) };
    atrium('send', '@p49cl', 'Use the Bash tool to run exactly this command: touch p49-notify.txt');
    const waited = await until(async () => (await stateOf(win)).state === 'waiting', 90000).then(() => true, () => false);
    await sleep(2500);
    const nl = { w: await win.evaluate(([i, f]) => window.__mt.notifyLog.slice(f).filter((x) => x.sessionId === i).map((x) => [x.notify, x.why]), [CL, nb.w]), p: await page.evaluate(([i, f]) => window.__mt.notifyLog.slice(f).filter((x) => x.sessionId === i).map((x) => [x.notify, x.why]), [CL, nb.p]), web: await page.evaluate((f) => window.__mtWeb.notes.length - f, nb.web) };
    const pv = await page.evaluate(() => window.__mt.api.call('clients.list'));
    check('알림은 활성 쪽(브라우저, Web Notifications)에서만 뜬다', waited && pv.notify === pv.me && nl.p.some((x) => x[0]) && nl.web >= 1 && nl.w.length > 0 && nl.w.every((x) => !x[0] && x[1] === 'other-client'), { nl, notify: pv.notify === pv.me });
    await win.evaluate((i) => window.__mt.api.call('session.answer', { session: i, choice: 'reject' }), CL).catch((e) => log(`answer ${e.message}`));
    const closed = await until(async () => { const a = await stateOf(win), b = await stateOf(page); return a.state !== 'waiting' && b.state !== 'waiting' && !a.ask && !b.ask; }, 30000).then(() => true, () => false);
    check('PC 창에서 답하면 브라우저의 대기도 풀린다', closed);
  }

  // ---- 3. 지연과 프레임 묶기 ----
  await viewNode(win, SH); await viewNode(page, SH);
  await page.evaluate(() => { window.__p49 = { frames: 0 }; window.__mt.api.on('terminal.frame', () => { window.__p49.frames++; }); });
  await win.evaluate(() => { window.__p49 = { frames: 0 }; window.__mt.api.on('terminal.frame', () => { window.__p49.frames++; }); });
  metrics.latency = [];
  for (const d of [0, 7, 50, 200]) {
    delay.setDelay(d, 0);
    await sleep(600);
    // 새 연결은 지연 위로(열린 연결도 조각마다 지연이 든다)
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const mark = `lat${d}x${i}`;
      await page.click(`.mt-term[data-session="${SH}"]`, { position: { x: 60, y: 30 } });
      await page.keyboard.type(`echo ${mark}`);
      await until(async () => (await textOf(page, SH)).includes(mark) || null, 15000, 5).catch(() => null);
      await sleep(300);
      // 글자 하나: 누른 때부터 그 글자가 브라우저 터미널에 보일 때까지(메아리)
      let tA = Date.now();
      await page.keyboard.type('Q');
      await until(async () => (await textOf(page, SH)).includes(`${mark}Q`) || null, 15000, 3).catch(() => null);
      const echoMs = Date.now() - tA;
      // Enter: 누른 때부터 명령 출력이 보일 때까지
      tA = Date.now();
      await page.keyboard.press('Enter');
      await until(async () => ((await textOf(page, SH)).split(`${mark}Q`).length - 1 >= 2) || null, 15000, 3).catch(() => null);
      samples.push({ echoMs, outMs: Date.now() - tA });
      await sleep(300);
    }
    const pings = [];
    for (let i = 0; i < 3; i++) pings.push(await page.evaluate(async () => { const t = performance.now(); await window.__mt.api.call('ping', { t }); return Math.round(performance.now() - t); }));
    const rtt = pings.sort((a, b) => a - b)[1];
    const med = (k) => samples.map((s) => s[k]).sort((a, b) => a - b)[2];
    metrics.latency.push({ delayOneWayMs: d, echoMedianMs: med('echoMs'), outputMedianMs: med('outMs'), rtt, samples });
    log(`지연 ${d}ms: 입력→화면 가운데 ${med('echoMs')}ms, 출력까지 ${med('outMs')}ms, 표시 rtt ${rtt}`);
  }
  delay.setDelay(0, 0);
  check('지연 7·50·200ms에서 입력 → 화면 시간을 쟀다', metrics.latency.length === 4, metrics.latency.map((m) => [m.delayOneWayMs, m.echoMedianMs, m.outputMedianMs]));
  // 프레임 묶기: 같은 출력 덩어리에 PC 창(묶지 않음)과 브라우저(원격, 묶음)가 받은 프레임 수
  await sleep(1000);
  const f0 = { w: await win.evaluate(() => window.__p49.frames), p: await page.evaluate(() => window.__p49.frames) };
  const b0 = (await win.evaluate(() => window.__mt.api.call('backend.status'))).relay.find((r) => r.sessionId === SH).batched;
  await typeIn(page, SH, '1..400 | % { "line-$_"; Start-Sleep -Milliseconds 5 }; "burst-" + "done"'); // 셸은 PowerShell
  await until(async () => (await textOf(win, SH)).includes('burst-done') || null, 60000).catch(() => null);
  await sleep(1500);
  const f1 = { w: await win.evaluate(() => window.__p49.frames), p: await page.evaluate(() => window.__p49.frames) };
  const b1 = (await win.evaluate(() => window.__mt.api.call('backend.status'))).relay.find((r) => r.sessionId === SH).batched;
  const burst = { pcFrames: f1.w - f0.w, webFrames: f1.p - f0.p, batchedIn: b1.in - b0.in, batchedOut: b1.out - b0.out };
  metrics.burst = burst;
  const tailOk = (await textOf(page, SH)).includes('line-400');
  check('프레임 묶기: 원격 브라우저는 PC 창보다 적은 프레임으로 같은 화면을 받는다', burst.webFrames < burst.pcFrames && tailOk, burst);
  await wshot(page, '05-web-after-burst');

  // ---- 4. 끊김과 다시 연결 ----
  const reconnected = async (label, maxMs) => {
    const t = Date.now();
    const ok = await until(async () => (await page.evaluate(() => window.__mt.getState().conn === 'open')) || null, maxMs).then(() => true, () => false);
    const term = await until(async () => (await page.evaluate((i) => !!window.__mt.terms.get(i) && !document.querySelector(`.mt-term-wrap .mt-term-cover`), SH)) || null, 20000).then(() => true, () => false);
    log(`${label}: 다시 붙음 ${Date.now() - t}ms`);
    return { ok, term, ms: Date.now() - t };
  };
  await tsim.close();
  const banner = await until(async () => (await page.$('[data-role=reconnect-banner]')) || null, 10000).then(() => true, () => false);
  await wshot(page, '06-reconnecting-banner');
  await sleep(3000);
  tsim = startTsSim({ listen: 47869, target: 47870, name: NAME, login: 'me@example.com' });
  await tsim.ready;
  const r1 = await reconnected('프록시 다시 켬', 30000);
  await typeIn(page, SH, 'echo back-after-proxy');
  const t1 = await until(async () => (await textOf(page, SH)).split('back-after-proxy').length > 2 || null, 15000).then(() => true, () => false);
  check('프록시를 끊으면 "다시 연결 중" 띠, 살리면 다시 붙고 터미널이 돌아온다', banner && r1.ok && r1.term && t1, { banner, ...r1, t1 });
  const bannerGone = !(await page.$('[data-role=reconnect-banner]'));
  check('다시 붙으면 띠가 사라진다', bannerGone);
  // 백엔드 다시 켜기(창이 백엔드를 다시 띄운다)
  log(atrium('backend', 'stop').trim().slice(0, 200));
  const r2 = await reconnected('백엔드 다시 켬', 60000);
  await sleep(2000);
  await viewNode(page, SH).catch(() => {});
  await typeIn(page, SH, 'echo back-after-backend');
  const t2 = await until(async () => (await textOf(page, SH)).split('back-after-backend').length > 2 || null, 20000).then(() => true, () => false);
  check('백엔드를 다시 켜면 브라우저가 다시 붙고 터미널이 돌아온다', r2.ok && t2, { ...r2, t2 });
  // 잠자기 흉내: 소켓은 열린 채 답이 오지 않는다(지연 프록시에 큰 지연) → ping 시간 넘김으로 닫고 다시 붙는다
  delay.setDelay(20000, 0);
  const tDead = Date.now();
  await page.evaluate(() => { window.__mt.api.pingSentAt = null; window.__mt.api.ping(); });
  const dead = await until(async () => (await page.evaluate(() => window.__mt.getState().conn !== 'open')) || null, 15000).then(() => Date.now() - tDead, () => null);
  delay.setDelay(0, 0);
  const r3 = await reconnected('죽은 연결 뒤', 40000);
  check('답이 없는 연결(잠자기·네트워크 바뀜)은 ping으로 알아채고 다시 붙는다', dead != null && r3.ok, { deadAfterMs: dead, ...r3 });

  // ---- 5. 화면 배율, 지연 표시, 끊기(4401) ----
  const fitOf = () => page.evaluate(() => {
    const W = innerWidth, H = innerHeight, r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    return { W, H, zoom: document.documentElement.style.zoom, app: r('.mt-app'), cmd: r('.mt-cmd'), rail: r('.mt-rail-right, .mt-rrail, [data-role=right-rail]'), scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight };
  });
  const z0 = await fitOf();
  await page.evaluate(() => window.__mt.getState().setUiScale ? window.__mt.getState().setUiScale(1.2) : window.mt.setZoom(1.2));
  await page.evaluate(() => window.mt.setZoom(1.2));
  await sleep(800);
  const z1 = await fitOf();
  await wshot(page, '07-web-zoom-120');
  // 글자 하나 고르기(마우스 좌표가 배율 아래에서도 맞는지): 터미널을 눌러 치면 들어간다
  await viewNode(page, SH).catch(() => {});
  await typeIn(page, SH, 'echo zoomed-typing');
  const zt = await until(async () => (await textOf(page, SH)).split('zoomed-typing').length > 2 || null, 15000).then(() => true, () => false);
  await page.evaluate(() => window.mt.setZoom(1));
  const inView = (x, W, H) => !x || (x.r <= W + 1 && x.b <= H + 1 && x.l >= -1 && x.t >= -1);
  check('웹 화면 배율 120%: 판이 창 안에 들고(넘침 없음) 터미널을 누르고 칠 수 있다', z1.zoom === '1.2' && inView(z1.app, z1.W, z1.H) && inView(z1.cmd, z1.W, z1.H) && z1.scrollW <= z1.W + 1 && z1.scrollH <= z1.H + 1 && zt, { z0, z1, zt });
  const rttShown = await until(async () => (await page.$('[data-role=rtt]')) ? await page.textContent('[data-role=rtt]') : null, 20000).catch(() => null);
  check('구석에 왕복 지연(ms)', !!rttShown && /\d+ ms/.test(rttShown), { rttShown });
  const devs = await win.evaluate(() => window.__mt.api.call('device.list'));
  const dev = devs.devices.find((d) => d.name === 'p49 laptop');
  const tRev = Date.now();
  await win.evaluate((id) => window.__mt.api.call('device.revoke', { id }), dev.id);
  const toPair = await page.waitForSelector('[data-role=pair]', { timeout: 20000 }).then(() => Date.now() - tRev, () => null);
  check('PC에서 끊으면(4401) 브라우저가 짝 맺기 화면으로 간다', toPair != null, { ms: toPair });
  await wshot(page, '08-revoked-pair');
} catch (e) {
  log(`오류 ${e.stack}`);
  check('시험이 끝까지 돎', false, e.message);
} finally {
  for (const n of killed) { try { atrium('kill', n, '--yes'); log(`세션 끔 ${n}`); } catch (e) { log(`kill ${n} 실패 ${String(e.message).split('\n')[0]}`); } }
  if (browser) await browser.close().catch(() => {});
  if (app) await closeApp(app);
  if (tsim) await tsim.close().catch(() => {});
  if (delay) await Promise.resolve(delay.close && delay.close()).catch(() => {});
  fs.writeFileSync(path.join(OUT, 'p49-remote-results.json'), JSON.stringify({ results, metrics }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
