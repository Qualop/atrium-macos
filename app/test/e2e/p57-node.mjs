// P57(원격 강화 S1) 창 시험: 짝 맺은 기기는 짝 맺은 Tailscale 기기에서만 쓴다. P59부터 P56의 패스키·세션 흐름으로 본다.
//   노트북 A: 브라우저 → ts-sim(47976, keepOrigin, X-Forwarded-For 100.64.0.2) → 백엔드(47876)
//   노트북 B: 브라우저 → ts-sim(47977, keepOrigin, X-Forwarded-For 100.64.0.3) → 백엔드
// 판은 가짜 tailscale(p49-fake-tailscale.mjs: status, serve status, whois)을 읽는다. 따로 띄운 개발용 판(기본 atrium-dev-p57, 47876, backend/.dev)만 쓴다.
// 판 값은 MT_E2E_HERDR_SESSION·MT_E2E_PORT·MT_E2E_SIM_PORT·MT_E2E_SIM2_PORT로 덮는다(p59-lib.mjs). 결과는 experiments/<MT_E2E_OUT, 기본 p57>/(git 밖).
//   1. 노트북 A가 허락을 청하면 PC 창 카드에 Tailscale이 확인한 기기 이름(laptop-a)이 크게, 브라우저 이름이 작게 보인다
//   2. 허락 → A에서 패스키를 만들고 보드를 쓴다
//   3. A의 세션 쿠키를 노트북 B 주소로 보내면 거부(HTTP 401, WebSocket 거부, 브라우저는 다시 확인이 아니라 짝 맺기 화면)
//   4. 연결된 기기 목록에 Tailscale 기기 이름과 별칭, 진단에 "Tailscale 기기에 묶임" 줄, atrium remote status 줄
// 실행: node app/test/e2e/p57-node.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUTNAME = process.env.MT_E2E_OUT || 'p57';
const OUT = path.join(REPO, 'experiments', OUTNAME);
const CONVOS = path.join(OUT, 'convos');
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A, LAPTOP_B, baseOf } = L;
const B0 = L.board({ session: 'atrium-dev-p57', port: 47876, sim: 47976, sim2: 47977 });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: OUTNAME,
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim},${NAME}:${B0.sim2}`,
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { launch, logger, shot, sleep, until, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));

const log = logger('p57-node');
const BASE_A = baseOf(B0.sim), BASE_B = baseOf(B0.sim2);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: { ...process.env, ...ENV }, timeout: 120000 });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`); };
const wshot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); log(`스크린숏 experiments/${OUTNAME}/${name}.png`); };
const viaSim = (port, p, headers = {}) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, headers: { host: `${NAME}:${port}`, ...headers } }, (resp) => { const ch = []; resp.on('data', (d) => ch.push(d)); resp.on('end', () => { const t = Buffer.concat(ch).toString(); let j = null; try { j = JSON.parse(t); } catch {} res({ status: resp.statusCode, body: j }); }); });
  r.on('error', rej); r.end();
});

let app, win, browser, simA, simB;
try {
  simA = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); simA.cfg.ip = LAPTOP_A;
  simB = startTsSim({ listen: B0.sim2, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); simB.cfg.ip = LAPTOP_B;
  await Promise.all([simA.ready, simB.ready]);
  ({ app, page: win } = await launch({ log, env: ENV }));
  await win.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
  await win.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await until(async () => { const d = await win.evaluate(() => window.__mt.api.call('remote.status', { fresh: true })); return d && d.url ? d : null; }, 20000);
  // 앞선 시험에서 남은 기기를 끊는다
  for (const d of (await win.evaluate(() => window.__mt.api.call('device.list'))).devices) await win.evaluate((id) => window.__mt.api.call('device.revoke', { id }), d.id);

  browser = await L.launchBrowser([B0.sim, B0.sim2]);
  const A = await L.laptop(browser, { log, label: 'A' });
  const page = A.page;

  // ---- 1. 노트북 A에서 허락 요청 → PC 카드 ----
  await page.goto(`${BASE_A}/`);
  await page.waitForSelector('[data-role=pair]', { timeout: 20000 });
  await page.fill('[data-field=pair-name]', 'Chrome on laptop');
  await page.click('[data-action=pair-ask]');
  await page.waitForSelector('[data-role=pair-wait]', { timeout: 10000 });
  await win.waitForSelector('[data-role=pair-request-banner] [data-role=request-node]', { timeout: 10000 });
  const card = await win.evaluate(() => ({ node: document.querySelector('[data-role=pair-request-banner] [data-role=request-node]').textContent, alias: document.querySelector('[data-role=pair-request-banner] [data-role=request-alias]').textContent }));
  check('허락 카드에 Tailscale이 확인한 기기 이름(크게)과 브라우저 이름(작게)', /laptop-a/.test(card.node) && /Chrome on laptop/.test(card.alias) && !/Chrome on laptop/.test(card.node), card);
  await shot(win, '01-pc-request-card', log);

  // ---- 2. 허락 → A에서 패스키 등록, 사용 ----
  await win.click('[data-role=pair-request-banner] [data-action=device-allow]');
  await page.waitForSelector('[data-role=passkey-register]', { timeout: 15000 });
  await page.click('[data-action=passkey-create]');
  await L.boardOpen(page);
  const useA = await page.evaluate(async () => { const r = await window.__mt.api.call('device.list'); return { me: r.me, n: r.devices.length, node: r.devices[0] && r.devices[0].tsNode && r.devices[0].tsNode.name }; });
  check('노트북 A는 허락 → 패스키 등록 뒤 보드를 쓴다(기기에게는 자기 기록만)', useA.me && useA.node === 'laptop-a' && useA.n === 1, useA);
  await wshot(page, '02-laptop-a-board');
  const ck = await L.sessionCookie(A.ctx, BASE_A, B0.port);

  // ---- 3. 같은 세션 쿠키를 노트북 B 주소로 ----
  const me = await viaSim(B0.sim2, '/web/me', { cookie: ck.header });
  check('노트북 B 주소로 보낸 A의 세션 쿠키는 HTTP 401(다시 짝 맺기)', me.status === 401 && me.body && me.body.error.code === 'tailscale_node', me);
  const Bl = await L.laptop(browser, { log, label: 'B' });
  await Bl.ctx.addCookies([{ ...ck.cookie }]);
  await Bl.page.goto(`${BASE_B}/`);
  const toPair = await Bl.page.waitForSelector('[data-role=pair]', { timeout: 20000 }).then(() => true, () => false);
  const reason = await Bl.page.$eval('[data-role=pair-note] [data-reason]', (e) => e.getAttribute('data-reason')).catch(() => null);
  check('노트북 B의 브라우저는 다시 확인이 아니라 짝 맺기 화면으로 가고 까닭(다른 Tailscale 기기)을 보인다', toPair && reason === 'other_node' && !(await Bl.page.$('[data-role=reauth]')), { toPair, reason });
  await wshot(Bl.page, '03-laptop-b-refused');
  const wsB = await Bl.page.evaluate(() => new Promise((res) => { const ws = new WebSocket(`ws://${location.host}/api`); ws.onopen = () => { ws.close(); res('open'); }; ws.onerror = () => res('refused'); setTimeout(() => res('timeout'), 8000); }));
  check('노트북 B 주소의 WebSocket 연결도 거부', wsB === 'refused', { wsB });
  // A는 그대로 쓴다(기억한 whois 결과)
  const meA = await viaSim(B0.sim, '/web/me', { cookie: ck.header });
  check('노트북 A는 그대로 쓴다', meA.status === 200, { status: meA.status });

  // ---- 4. PC 창의 기기 목록과 진단, CLI ----
  await win.click('[data-action=settings-open]');
  await win.click('[data-tab=devices]');
  await win.waitForSelector('[data-role=device-list] [data-role=device-node]');
  await sleep(600);
  const row = await win.evaluate(() => { const r = document.querySelector('[data-role=device-list] .mt-wdev-row'); return { node: r.querySelector('[data-role=device-node]').textContent, bind: r.querySelector('[data-role=device-bind]').textContent, kind: r.querySelector('[data-role=device-bind]').dataset.bind }; });
  check('연결된 기기 목록: Tailscale 기기 이름(크게)과 브라우저 별칭(작게)', /laptop-a/.test(row.node) && /Chrome on laptop/.test(row.bind) && row.kind === 'tailscale', row);
  const nodesLine = await win.evaluate(() => { const li = document.querySelector('[data-check=nodes]'); return li ? { text: li.textContent, level: li.dataset.level } : null; });
  check('진단에 "Tailscale 기기에 묶임" 줄', nodesLine && nodesLine.level === 'ok' && /묶|bound to their Tailscale device/.test(nodesLine.text), nodesLine);
  await win.evaluate(() => document.querySelector('[data-role=device-list]').scrollIntoView());
  await shot(win, '04-pc-devices', log);
  const cli = atrium('remote', 'status');
  fs.writeFileSync(path.join(OUT, 'p57-remote-status.txt'), cli);
  check('atrium remote status에 묶임 줄', /Tailscale 기기에 묶임/.test(cli), cli.split(/\r?\n/).find((l) => /묶임/.test(l)) || '');
  await win.click('[data-action=settings-close]').catch(() => {});
  // 기기 끊기(뒷정리)
  const devs = await win.evaluate(() => window.__mt.api.call('device.list'));
  for (const d of devs.devices) await win.evaluate((id) => window.__mt.api.call('device.revoke', { id }), d.id);
} catch (e) {
  log(`오류 ${e.stack}`);
  check('시험이 끝까지 돎', false, e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (app) await closeApp(app);
  for (const s of [simA, simB]) if (s) await s.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'p57-node-results.json'), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
