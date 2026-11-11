// P59 창 시험: P56(패스키·HttpOnly 세션)·P57(Tailscale 기기 묶기)·P58(기록·끊기·막기)을 합친 판을 한 흐름으로 본다.
//   노트북 A: 브라우저 문맥 A → ts-sim A(47880, X-Forwarded-For 100.64.0.2 = laptop-a) → 백엔드(47879)
//   노트북 B: 브라우저 문맥 B → ts-sim B(47881, X-Forwarded-For 100.64.0.3 = laptop-b) → 백엔드
// 판은 가짜 tailscale(p49-fake-tailscale.mjs: status, serve, whois)을 읽는다. 따로 띄운 개발용 판(atrium-dev-p59, 47879, backend/.dev)만 쓴다.
// 흐름: A가 코드로 짝 맺기 → 패스키 등록 → 허락 카드(B의 허락 요청)·목록에 Tailscale 기기 이름 → 셸에 치기 → PC 창에 붙음 알림
//   → A의 쿠키를 B 주소로 보내면 거부 → 알약에서 끊기 → A는 다시 확인 화면 → 다시 확인 → 원격 받기 끄기 → 막음 화면, 세션 끝
//   → 켜기 → 다시 확인 → 짝 풀기 → 짝 맺기 화면. 그 과정이 연결 기록에 차례대로 남고, document.cookie와 localStorage에 비밀이 없다.
// 결과는 experiments/p59/(git 밖). 실행: node app/test/e2e/p59-remote.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p59');
const CONVOS = path.join(OUT, 'convos');
const TEST = 'C:\\Workspace\\mtask-p59-remote';
const QUIET_MS = 4000;
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A, LAPTOP_B, baseOf } = L;
const B0 = L.board({ session: 'atrium-dev-p59', port: 47879, sim: 47880, sim2: 47881 });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p59',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim},${NAME}:${B0.sim2}`,
  ATRIUM_REMOTE_QUIET_MS: String(QUIET_MS),
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true }); fs.mkdirSync(TEST, { recursive: true });
const { launch, logger, shot, sleep, until, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));

const log = logger('p59-remote');
const BASE_A = baseOf(B0.sim), BASE_B = baseOf(B0.sim2);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: { ...process.env, ...ENV }, timeout: 120000 });
const lastLine = (s) => s.trim().split(/\r?\n/).slice(-1)[0];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`); };
const wshot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); log(`스크린숏 experiments/p59/${name}.png`); };
// 흉내 프록시를 거친 요청(브라우저 밖에서). port = 그 노트북의 프록시
const viaSim = (port, p, { method = 'GET', headers = {}, body } = {}) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `${NAME}:${port}`, ...headers } }, (resp) => { const ch = []; resp.on('data', (d) => ch.push(d)); resp.on('end', () => { const t = Buffer.concat(ch).toString(); let j = null; try { j = JSON.parse(t); } catch {} res({ status: resp.statusCode, body: j, text: t }); }); });
  r.on('error', rej); if (body) r.write(body); r.end();
});
const textOf = (pg, id) => pg.evaluate((i) => { const tm = window.__mt.terms.get(i); if (!tm) return ''; const b = tm.buffer.active; let s = ''; for (let r = 0; r < b.length; r++) { const l = b.getLine(r); if (l) s += l.translateToString(true) + '\n'; } return s; }, id);

let app, win, browser, simA, simB; const killed = [];
try {
  simA = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); simA.cfg.ip = LAPTOP_A;
  simB = startTsSim({ listen: B0.sim2, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); simB.cfg.ip = LAPTOP_B;
  await Promise.all([simA.ready, simB.ready]);
  ({ app, page: win } = await launch({ log, env: ENV }));
  await win.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
  await win.evaluate(() => localStorage.setItem('mt.clientName', 'PC window'));
  await win.reload(); await win.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await win.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true));
  const rs = await until(async () => { const d = await win.evaluate(() => window.__mt.api.call('remote.status', { fresh: true })); return d && d.url ? d : null; }, 20000);
  check('판이 가짜 Tailscale 이름을 읽고 원격 받기가 켜져 있다', rs.url === `https://${NAME}/` && rs.accepting === true, { url: rs.url, accepting: rs.accepting });
  // P62: 이 시험은 "패스키로 확인" 켬의 흐름이다(판의 기본은 끔). 옛 백엔드는 이 설정이 없다
  await win.evaluate(() => window.__mt.api.call('settings.set', { remotePasskey: true })).catch(() => {});
  // 앞선 실행에서 남은 기기는 지운다(이 판의 기록만)
  for (const d of (await win.evaluate(() => window.__mt.api.call('device.list'))).devices) await win.evaluate((id) => window.__mt.api.call('device.revoke', { id }), d.id);
  const logStart = Date.now();
  const notices = () => win.evaluate(() => window.__mt.remoteNotices.map((n) => ({ kind: n.kind, text: n.text, os: n.os })));

  browser = await L.launchBrowser([B0.sim, B0.sim2]);
  const A = await L.laptop(browser, { log, label: 'A' });
  const pageA = A.page;

  // ---- 1. A가 코드로 짝 맺기 → 패스키 등록 ----
  const code = await L.newCode(win);
  await pageA.goto(`${BASE_A}/`);
  await pageA.waitForSelector('[data-role=pair]', { timeout: 20000 });
  await wshot(pageA, '01-a-pair');
  await pageA.fill('[data-field=pair-name]', 'Chrome on laptop A');
  await pageA.fill('[data-field=pair-code]', code);
  await pageA.click('[data-action=pair-submit]');
  await pageA.waitForSelector('[data-role=passkey-register]', { timeout: 15000 });
  await wshot(pageA, '02-a-passkey-register');
  await pageA.click('[data-action=passkey-create]');
  await L.boardOpen(pageA);
  const credsA = await A.creds();
  check('A: 코드 → 패스키 등록 → 보드(가상 인증기에 패스키 하나, RP ID는 Tailscale 이름)', credsA.length === 1 && credsA[0].rpId === NAME, credsA.map((c) => ({ rpId: c.rpId, signCount: c.signCount })));
  await wshot(pageA, '03-a-board');
  const devA = (await win.evaluate(() => window.__mt.api.call('device.list'))).devices.find((d) => d.name === 'Chrome on laptop A');
  check('기기 기록에 Tailscale 기기(laptop-a)와 패스키, 세션 1', devA && devA.origin === 'tailscale' && devA.tsNode && devA.tsNode.name === 'laptop-a' && devA.passkey && devA.sessions === 1 && !devA.needsRepair, devA);
  const ckA = await L.sessionCookie(A.ctx, BASE_A, B0.port);
  const sec = await L.noSecrets(pageA, [ckA && ckA.value]);
  check('세션 쿠키는 HttpOnly·SameSite=Strict, document.cookie·localStorage·sessionStorage에 비밀이 없다', ckA && ckA.cookie.httpOnly && ckA.cookie.sameSite === 'Strict' && sec.ok, { cookie: ckA && { httpOnly: ckA.cookie.httpOnly, sameSite: ckA.cookie.sameSite }, ...sec });

  // ---- 2. 허락 카드(B의 허락 요청)와 목록에 Tailscale 기기 이름 ----
  const Bl = await L.laptop(browser, { log, label: 'B' });
  const pageB = Bl.page;
  await pageB.goto(`${BASE_B}/`);
  await pageB.waitForSelector('[data-role=pair]', { timeout: 20000 });
  await pageB.fill('[data-field=pair-name]', 'Chrome on laptop B');
  await pageB.click('[data-action=pair-ask]');
  await pageB.waitForSelector('[data-role=pair-wait]', { timeout: 10000 });
  await win.waitForSelector('[data-role=pair-request-banner] [data-role=request-node]', { timeout: 10000 });
  const card = await win.evaluate(() => ({ node: document.querySelector('[data-role=pair-request-banner] [data-role=request-node]').textContent, alias: document.querySelector('[data-role=pair-request-banner] [data-role=request-alias]').textContent }));
  check('허락 카드에 Tailscale이 확인한 기기 이름(laptop-b) 크게, 브라우저 이름 작게', /laptop-b/.test(card.node) && /Chrome on laptop B/.test(card.alias), card);
  await shot(win, '04-pc-request-card', log);
  await win.click('[data-role=pair-request-banner] [data-action=device-deny]');
  await pageB.waitForSelector('[data-role=pair-error]', { timeout: 10000 }).catch(() => {});
  await win.click('[data-action=settings-open]');
  await win.click('button[data-tab=devices]');
  await win.waitForSelector('[data-role=device-list] [data-role=device-node]');
  await sleep(500);
  const row = await win.evaluate((id) => { const r = document.querySelector(`[data-role=device-list] [data-device="${id}"]`); return r && { node: r.querySelector('[data-role=device-node]').textContent, bind: (r.querySelector('[data-role=device-bind]') || {}).textContent, kind: (r.querySelector('[data-role=device-bind]') || { dataset: {} }).dataset.bind }; }, devA.id);
  check('연결된 기기 목록: Tailscale 기기 이름(laptop-a) 크게, 브라우저 별칭 작게', row && /laptop-a/.test(row.node) && /Chrome on laptop A/.test(row.bind) && row.kind === 'tailscale', row);
  await win.evaluate(() => document.querySelector('[data-role=device-list]').scrollIntoView());
  await shot(win, '05-pc-device-list', log);
  await win.click('[data-action=settings-close]').catch(() => {});

  // ---- 3. 셸에 치기 ----
  log(lastLine(atrium('spawn', TEST, '--name', 'p59sh', '--kind', 'shell'))); killed.push('p59sh');
  const SH = await until(() => win.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p59sh'); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }), 30000);
  await pageA.evaluate((i) => window.__mt.getState().navigateTo(i), SH); await sleep(1500);
  await until(() => pageA.evaluate((i) => !!window.__mt.terms.get(i), SH), 30000); await sleep(1200);
  await pageA.click(`.mt-term[data-session="${SH}"]`, { position: { x: 60, y: 30 } }); await sleep(150);
  await pageA.keyboard.type('echo from-laptop-a-$((50+9))'); await pageA.keyboard.press('Enter');
  const typed = await until(async () => (await textOf(pageA, SH)).includes('from-laptop-a-59') || null, 20000).catch(() => null);
  check('A: 패스키 세션으로 셸 터미널에 치고 결과를 본다', !!typed);
  await wshot(pageA, '06-a-terminal');

  // ---- 4. PC 창에 붙음 알림 ----
  const n1 = await notices();
  check('짝 맺기(패스키 등록)를 PC 창에 알린다', n1.some((n) => n.kind === 'paired'), n1);
  // 페이지를 떠났다 돌아온다(가상 인증기는 그 페이지에 붙어 있어 닫지 않는다)
  await pageA.goto('about:blank');
  await sleep(QUIET_MS + 1500);
  const pA = pageA;
  await pA.goto(`${BASE_A}/`);
  await L.boardOpen(pA);
  const n2 = await until(async () => { const n = await notices(); return n.some((x) => x.kind === 'connected') ? n : null; }, 10000).catch(() => notices());
  const conNote = n2.find((x) => x.kind === 'connected');
  check('조용한 시간 뒤 A가 다시 붙으면 PC 창에 "원격으로 붙었습니다"', conNote && /원격으로 붙었습니다|connected remotely/.test(conNote.text), n2);
  await shot(win, '07-pc-attach-notice', log);

  // ---- 5. A의 쿠키를 B 주소로 ----
  const ckA2 = await L.sessionCookie(A.ctx, BASE_A, B0.port);
  const meB = await viaSim(B0.sim2, '/web/me', { headers: { cookie: ckA2.header } });
  const meA = await viaSim(B0.sim, '/web/me', { headers: { cookie: ckA2.header } });
  check('A의 세션 쿠키를 B 주소로 보내면 401 tailscale_node(other_node), A 주소로는 200', meB.status === 401 && meB.body.error.code === 'tailscale_node' && meB.body.error.reason === 'other_node' && meA.status === 200, { b: meB.status, reason: meB.body && meB.body.error && meB.body.error.reason, a: meA.status });
  const Bc = await L.laptop(browser, { log, label: 'B-stolen' });
  await Bc.ctx.addCookies([{ ...ckA2.cookie }]);
  await Bc.page.goto(`${BASE_B}/`);
  const bNote = await Bc.page.waitForSelector('[data-role=pair-note] [data-reason]', { timeout: 20000 }).then((e) => e.getAttribute('data-reason'), () => null);
  check('A의 쿠키를 가진 B의 브라우저는 다시 확인이 아니라 짝 맺기 화면(까닭: 다른 Tailscale 기기)', bNote === 'other_node' && !(await Bc.page.$('[data-role=reauth]')), { bNote });
  await wshot(Bc.page, '08-b-stolen-cookie');
  const wsB = await Bc.page.evaluate(() => new Promise((res) => { const ws = new WebSocket(`ws://${location.host}/api`); ws.onopen = () => { ws.close(); res('open'); }; ws.onerror = () => res('refused'); setTimeout(() => res('timeout'), 8000); }));
  check('B 주소의 WebSocket도 거부', wsB === 'refused', { wsB });
  await Bc.ctx.close();

  // ---- 6. 알약에서 끊기 → A는 다시 확인 화면 ----
  const codes = [];
  await pA.exposeFunction('__p59close', (c) => codes.push(c));
  await pA.evaluate(() => window.__mt.api.ws.addEventListener('close', (e) => window.__p59close(e.code)));
  await win.waitForSelector('[data-role=peers]', { timeout: 15000 });
  await win.click('[data-role=peers]');
  await win.waitForSelector('[data-role=peers-list] [data-action=peer-kick]', { timeout: 5000 });
  await shot(win, '09-pc-peers', log);
  await win.click('[data-role=peers-list] [data-action=peer-kick]');
  const kicked = await until(async () => (codes.length ? codes[0] : null), 5000).catch(() => null);
  const toReauth = await pA.waitForSelector('[data-role=reauth]', { timeout: 30000 }).then(() => true, () => false);
  const sessAfterKick = (await win.evaluate((id) => window.__mt.api.call('device.list'), devA.id)).devices.find((d) => d.id === devA.id).sessions;
  const oldKick = await viaSim(B0.sim, '/web/me', { headers: { cookie: ckA2.header } });
  check('알약 "끊기": 연결이 4402로 닫히고 세션이 끝나 A는 다시 확인 화면', kicked === 4402 && toReauth && sessAfterKick === 0 && oldKick.status === 401, { kicked, toReauth, sessAfterKick, old: oldKick.status });
  await wshot(pA, '10-a-reauth-after-kick');

  // ---- 7. 다시 확인 ----
  const sc0 = (await A.creds())[0].signCount;
  await L.reauth(pA);
  check('A: 패스키로 다시 확인하면 보드가 다시 열린다', (await A.creds())[0].signCount > sc0);

  // ---- 8. 원격 받기 끄기 → 막음 화면, 세션 끝 ----
  const ckA3 = await L.sessionCookie(A.ctx, BASE_A, B0.port);
  await win.click('[data-action=settings-open]').catch(() => {});
  await win.click('button[data-tab=devices]');
  await win.waitForSelector('[data-role=remote-access] [data-field=remoteAccess]');
  await win.click('[data-role=remote-access] [data-field=remoteAccess]');
  await until(async () => (await win.getAttribute('[data-role=remote-access]', 'data-on')) === '0', 5000);
  const blocked = await pA.waitForSelector('[data-role=remote-blocked]', { timeout: 15000 }).then(() => true, () => false);
  const sessBlocked = (await win.evaluate(() => window.__mt.api.call('device.list'))).devices.find((d) => d.id === devA.id).sessions;
  const meBlocked = await viaSim(B0.sim, '/web/me', { headers: { cookie: ckA3.header } });
  check('원격 받기 끄기: A는 막음 화면, 바깥 요청 403 remote_blocked, 세션이 끝남', blocked && meBlocked.status === 403 && meBlocked.body.error.code === 'remote_blocked' && sessBlocked === 0, { blocked, me: meBlocked.status, sessBlocked });
  await wshot(pA, '11-a-blocked');
  await shot(win, '11-pc-remote-off', log);
  await win.click('[data-action=settings-close]').catch(() => {});

  // ---- 9. 켜기 → 다시 확인 ----
  log(atrium('remote', 'allow').trim());
  const reauthAfterAllow = await pA.waitForSelector('[data-role=reauth]', { timeout: 40000 }).then(() => true, () => false);
  const oldAfterAllow = await viaSim(B0.sim, '/web/me', { headers: { cookie: ckA3.header } });
  check('켜기(atrium remote allow): A는 막음 화면에서 다시 확인 화면으로(끈 동안 세션이 끝남), 옛 쿠키 401', reauthAfterAllow && oldAfterAllow.status === 401, { reauthAfterAllow, old: oldAfterAllow.status });
  await wshot(pA, '12-a-reauth-after-allow');
  await L.reauth(pA);
  check('켠 뒤 다시 확인하면 보드가 열린다', await L.webOpen(pA));

  // ---- 10. 짝 풀기 → 짝 맺기 화면 ----
  if (!(await win.$('[data-role=peers-list]'))) await win.click('[data-role=peers]');
  await win.waitForSelector('[data-role=peers-list] [data-action=peer-unpair]', { timeout: 10000 });
  await win.click('[data-role=peers-list] [data-action=peer-unpair]');
  await win.waitForSelector('[data-role=unpair-dialog]');
  await win.click('[data-action=unpair-confirm]');
  const toPair = await pA.waitForSelector('[data-role=pair-note]', { timeout: 20000 }).then(() => true, () => false);
  check('짝 풀기: A는 짝 맺기 화면(까닭과 함께), 다시 확인 화면이 아님', toPair && !(await pA.$('[data-role=reauth]')) && !!(await pA.$('[data-role=pair]')), { note: toPair ? await pA.textContent('[data-role=pair-note]') : null });
  await wshot(pA, '13-a-unpaired');
  const sec2 = await L.noSecrets(pA, [ckA.value, ckA2.value, ckA3.value]);
  check('끝까지 document.cookie·localStorage·sessionStorage에 비밀이 없다', sec2.ok, sec2);

  // ---- 11. 연결 기록 ----
  await sleep(800);
  const entries = (await win.evaluate(() => window.__mt.api.call('remote.log', { limit: 500 }))).entries.filter((e) => e.at >= logStart).reverse();
  const evs = entries.map((e) => `${e.event}${e.reason ? `:${e.reason}` : ''}`);
  const order = ['pair.grant', 'pair.ok', 'connect', 'pair.request', 'pair.fail:denied', 'disconnect:closed', 'connect', 'deny:tailscale_node:other_node', 'kick', 'disconnect:pc', 'login', 'connect', 'remote.block', 'disconnect:blocked', 'deny:remote_blocked', 'remote.allow', 'login', 'connect', 'unpair', 'disconnect:revoked'];
  let i = 0; for (const e of evs) if (i < order.length && e === order[i]) i++;
  const conn = entries.find((e) => e.event === 'connect');
  const text = JSON.stringify(entries);
  check('흐름이 연결 기록에 차례대로 남는다(connect 줄에 Tailscale 기기 이름), 비밀 없음', i === order.length && conn && conn.node === 'laptop-a' && conn.login === LOGIN && conn.addr === LAPTOP_A && ![ckA.value, ckA2.value, ckA3.value, code].some((s) => text.includes(s)), { matched: `${i}/${order.length}`, next: order[i], evs, conn });
  fs.writeFileSync(path.join(OUT, 'remote-log.json'), JSON.stringify(entries, null, 2));
  fs.writeFileSync(path.join(OUT, 'remote-log-cli.txt'), atrium('remote', 'log', '--limit', '60'));
  await win.click('[data-action=settings-open]').catch(() => {});
  await win.click('button[data-tab=devices]').catch(() => {});
  await win.waitForSelector('[data-role=remote-log] .mt-remote-log-row', { timeout: 10000 });
  await win.evaluate(() => document.querySelector('[data-role=remote-log]').scrollIntoView());
  while (await win.$('[data-action=remote-log-more]')) { await win.click('[data-action=remote-log-more]'); await sleep(100); } // P60: 기록은 기본으로 최근 몇 줄
  const denyRow = await win.evaluate(() => { const r = document.querySelector('[data-role=remote-log] .mt-remote-log-row[data-reason="tailscale_node:other_node"]'); return r ? r.textContent : null; });
  check('설정 탭 기록에 거부 까닭이 사람이 읽는 글로', !!denyRow && /Tailscale/.test(denyRow), denyRow);
  await shot(win, '14-pc-remote-log', log);
} catch (e) {
  log(`오류 ${e.stack}`);
  check('시험이 끝까지 돎', false, e.message);
} finally {
  for (const n of killed) { try { atrium('kill', n, '--yes'); log(`세션 끔 ${n}`); } catch (e) { log(`kill ${n} 실패 ${String(e.message).split('\n')[0]}`); } }
  if (browser) await browser.close().catch(() => {});
  if (app) await closeApp(app);
  for (const s of [simA, simB]) if (s) await s.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'p59-remote-results.json'), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
