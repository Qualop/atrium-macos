// P62 창 시험: 판 설정 "패스키로 확인"(remotePasskey, 기본 끔)의 끔 흐름과 끔 → 켬 → 끔 바꾸기를 PC 창과 브라우저로 본다.
//   노트북 A: 브라우저 문맥 A → ts-sim A(47887, X-Forwarded-For 100.64.0.2 = laptop-a) → 백엔드(47886)
//   노트북 B: 브라우저 문맥 B → ts-sim B(47888, X-Forwarded-For 100.64.0.3 = laptop-b) → 백엔드
// 판은 가짜 tailscale(p49-fake-tailscale.mjs)을 읽는다. 따로 띄운 개발용 판(atrium-dev-p62, 47886, backend/.dev)만 쓴다.
// 흐름(끔): A가 코드로 짝 맺기 → 패스키 만들기 없이 보드 → B가 허락 요청 → PC 허락 → B도 곧바로 보드 → 기기 목록 "패스키 없음", 스위치 끔
//   → 알약 끊기 뒤 A는 다시 확인 없이 다시 붙음 → 원격 받기 끄기 → 막음 화면 → 켜기 → 다시 확인 없이 다시 붙음 → A의 쿠키를 B 주소로 보내면 거부
// 바꾸기: 스위치 켬 → A·B는 "패스키 등록" 화면, 목록 "패스키 등록 필요" → A가 지금 세션으로 패스키 등록 → 보드, 쿠키 12시간
//   → 스위치 끔 → A의 쿠키가 다시 400일로, B는 다시 열면 곧바로 보드 → 짝 풀기 → 짝 맺기 화면. 연결 기록에 차례대로 남고 비밀이 없다.
// 결과는 experiments/p62/(git 밖). 실행: node app/test/e2e/p62-remote.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p62');
const CONVOS = path.join(OUT, 'convos');
const QUIET_MS = 4000;
const DAY_S = 24 * 3600;
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A, LAPTOP_B, baseOf } = L;
const B0 = L.board({ session: 'atrium-dev-p62', port: 47886, sim: 47887, sim2: 47888 });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p62',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim},${NAME}:${B0.sim2}`,
  ATRIUM_REMOTE_QUIET_MS: String(QUIET_MS),
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { launch, logger, shot, sleep, until, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));

const log = logger('p62-remote');
const BASE_A = baseOf(B0.sim), BASE_B = baseOf(B0.sim2);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: { ...process.env, ...ENV }, timeout: 120000 });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 700)}` : ''}`); };
const wshot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); log(`스크린숏 experiments/p62/${name}.png`); };
const viaSim = (port, p, { method = 'GET', headers = {}, body } = {}) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `${NAME}:${port}`, ...headers } }, (resp) => { const ch = []; resp.on('data', (d) => ch.push(d)); resp.on('end', () => { const t = Buffer.concat(ch).toString(); let j = null; try { j = JSON.parse(t); } catch {} res({ status: resp.statusCode, body: j, text: t }); }); });
  r.on('error', rej); if (body) r.write(body); r.end();
});
const left = (ck) => (ck && ck.cookie.expires > 0 ? Math.round(ck.cookie.expires - Date.now() / 1000) : null); // 쿠키의 남은 초
const devices = () => win.evaluate(() => window.__mt.api.call('device.list'));
const openDevicesTab = async () => {
  if (!(await win.$('[data-role=settings]'))) await win.click('[data-action=settings-open]');
  await win.click('button[data-tab=devices]');
  await win.waitForSelector('[data-role=device-list]');
};
const closeSettings = () => win.click('[data-action=settings-close]').catch(() => {});
const rowOf = (id) => win.evaluate((i) => { const r = document.querySelector(`[data-role=device-list] [data-device="${i}"]`); return r && { kind: (r.querySelector('[data-role=device-kind]') || { dataset: {} }).dataset.kind || null, needsPasskey: !!r.querySelector('[data-role=needs-passkey]'), text: r.textContent }; }, id);
const pkSwitch = async () => win.evaluate(() => { const m = document.querySelector('[data-role=passkey-mode]'); return m && { on: m.dataset.on, hint: (m.querySelector('[data-role=passkey-mode-hint]') || {}).textContent, limitsOff: document.querySelector('[data-role=session-limits]').classList.contains('off') }; });

let app, win, browser, simA, simB;
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
  // 앞선 실행에서 남은 기기는 지우고, 기본(끔)으로 둔다(이 판의 기록만)
  for (const d of (await devices()).devices) await win.evaluate((id) => window.__mt.api.call('device.revoke', { id }), d.id);
  const st0 = (await win.evaluate(() => window.__mt.api.call('settings.get'))).settings;
  if (st0.remotePasskey !== false) await win.evaluate(() => window.__mt.api.call('settings.set', { remotePasskey: false }));
  if (st0.remoteAccess === false) await win.evaluate(() => window.__mt.api.call('settings.set', { remoteAccess: true }));
  const rs2 = await win.evaluate(() => window.__mt.api.call('remote.status', { fresh: true }));
  // 새 데이터 폴더의 처음 값은 끔이다(다른 창 시험 p59-remote.mjs가 켜 두었을 수 있어 first는 기록만 한다)
  check('판 설정 remotePasskey가 있고 끔이면 remote.status·진단 줄에 보인다', typeof st0.remotePasskey === 'boolean' && rs2.passkey === false && rs2.checks.some((c) => c.id === 'passkey_off'), { first: st0.remotePasskey, status: rs2.passkey, url: rs.url });
  const cliStatus = atrium('remote', 'status');
  check('atrium remote status에 패스키로 확인 꺼짐', /패스키로 확인 꺼짐/.test(cliStatus), cliStatus.split('\n').find((l) => /패스키/.test(l)));
  const logStart = Date.now();

  browser = await L.launchBrowser([B0.sim, B0.sim2]);
  const A = await L.laptop(browser, { log, label: 'A' });
  const pA = A.page;

  // ---- 1. 끔: A가 코드로 짝 맺기 → 곧바로 보드 ----
  const code = await L.newCode(win);
  await pA.goto(`${BASE_A}/`);
  await pA.waitForSelector('[data-role=pair]', { timeout: 20000 });
  await wshot(pA, '01-a-pair');
  await pA.fill('[data-field=pair-name]', 'Chrome on laptop A');
  await pA.fill('[data-field=pair-code]', code);
  let sawRegister = false;
  const regWatch = pA.waitForSelector('[data-role=passkey-register]', { timeout: 15000 }).then(() => { sawRegister = true; }, () => {});
  await pA.click('[data-action=pair-submit]');
  await L.boardOpen(pA);
  await Promise.race([regWatch, sleep(300)]);
  const credsA0 = await A.creds();
  const ckA = await L.sessionCookie(A.ctx, BASE_A, B0.port);
  check('끔: 코드로 짝 맺으면 패스키 만들기 없이 곧바로 보드(가상 인증기에 패스키 없음)', !sawRegister && credsA0.length === 0, { sawRegister, creds: credsA0.length });
  check('끔: 세션 쿠키는 HttpOnly·SameSite=Strict, 400일 수명', ckA && ckA.cookie.httpOnly && ckA.cookie.sameSite === 'Strict' && left(ckA) > 399 * DAY_S, { httpOnly: ckA && ckA.cookie.httpOnly, sameSite: ckA && ckA.cookie.sameSite, leftDays: ckA && left(ckA) / DAY_S });
  await wshot(pA, '02-a-board-no-passkey');
  const devA = (await devices()).devices.find((d) => d.name === 'Chrome on laptop A');
  check('기기 기록: Tailscale 기기(laptop-a)에 묶이고 패스키 없음, 세션 1, 등록 필요 아님', devA && devA.tsNode && devA.tsNode.name === 'laptop-a' && devA.passkey === null && devA.sessions === 1 && !devA.needsRepair && !devA.needsPasskey, devA);

  // ---- 2. 끔: B가 허락 요청 → PC 허락 → 곧바로 보드 ----
  const Bl = await L.laptop(browser, { log, label: 'B' });
  const pB = Bl.page;
  await pB.goto(`${BASE_B}/`);
  await pB.waitForSelector('[data-role=pair]', { timeout: 20000 });
  await pB.fill('[data-field=pair-name]', 'Chrome on laptop B');
  await pB.click('[data-action=pair-ask]');
  await pB.waitForSelector('[data-role=pair-wait]', { timeout: 10000 });
  await win.waitForSelector('[data-role=pair-request-banner] [data-action=device-allow]', { timeout: 10000 });
  await win.click('[data-role=pair-request-banner] [data-action=device-allow]');
  await L.boardOpen(pB);
  const devB = (await devices()).devices.find((d) => d.name === 'Chrome on laptop B');
  check('끔: PC 허락으로 짝 맺은 B도 패스키 없이 곧바로 보드(laptop-b에 묶임)', devB && devB.tsNode && devB.tsNode.name === 'laptop-b' && devB.passkey === null && (await Bl.creds()).length === 0, devB && { node: devB.tsNode, passkey: devB.passkey });
  await wshot(pB, '03-b-board-after-approve');

  // ---- 3. PC 창: 스위치(끔)와 기기 목록 ----
  await openDevicesTab();
  await win.waitForSelector('[data-role=passkey-mode]');
  const sw0 = await pkSwitch();
  const rA0 = await rowOf(devA.id);
  check('보안 설정에 "패스키로 확인" 스위치(끔)와 끔 설명, 세션 시간은 흐리게', sw0 && sw0.on === '0' && /바로 열립니다|directly/.test(sw0.hint) && sw0.limitsOff, sw0);
  check('기기 목록: 패스키 없음', rA0 && rA0.kind === 'none' && !rA0.needsPasskey, rA0);
  await win.evaluate(() => document.querySelector('[data-section=security]').scrollIntoView());
  await shot(win, '04-pc-security-off', log);
  await win.evaluate(() => document.querySelector('[data-role=device-list]').scrollIntoView());
  await shot(win, '05-pc-devices-off', log);

  // ---- 4. 끔: 끊기 → 다시 확인 없이 다시 붙음 ----
  const codes = [];
  await pA.exposeFunction('__p62close', (c) => codes.push(c));
  const watchClose = () => pA.evaluate(() => window.__mt.api.ws.addEventListener('close', (e) => window.__p62close(e.code)));
  await watchClose();
  await win.click(`[data-role=device-list] [data-device="${devA.id}"] [data-action=device-disconnect]`);
  const kicked = await until(async () => (codes.length ? codes[0] : null), 5000).catch(() => null);
  await sleep(500);
  const back = await until(async () => (await L.webOpen(pA)) || null, 20000).catch(() => false);
  const sessAfterKick = (await devices()).devices.find((d) => d.id === devA.id).sessions;
  check('끔: 끊기는 연결만 닫고(4402) 세션이 남아 다시 확인 없이 다시 붙는다', kicked === 4402 && back && !(await pA.$('[data-role=reauth]')) && sessAfterKick === 1, { kicked, back, sessAfterKick });

  // ---- 5. 끔: 원격 받기 끄기 → 막음 → 켜기 → 다시 붙음 ----
  await win.click('[data-role=remote-access] [data-field=remoteAccess]');
  await until(async () => (await win.getAttribute('[data-role=remote-access]', 'data-on')) === '0', 5000);
  const blocked = await pA.waitForSelector('[data-role=remote-blocked]', { timeout: 15000 }).then(() => true, () => false);
  const sessBlocked = (await devices()).devices.find((d) => d.id === devA.id).sessions;
  check('끔: 원격 받기를 끄면 막음 화면, 세션은 남는다', blocked && sessBlocked === 1, { blocked, sessBlocked });
  await wshot(pA, '06-a-blocked');
  log(atrium('remote', 'allow').trim());
  const backAllow = await until(async () => (await L.webOpen(pA)) || null, 40000).catch(() => false);
  check('끔: 원격 받기를 켜면 다시 확인 없이 다시 붙는다', backAllow && !(await pA.$('[data-role=reauth]')), { backAllow });

  // ---- 6. 끔: A의 쿠키를 B 주소로 ----
  const meB = await viaSim(B0.sim2, '/web/me', { headers: { cookie: ckA.header } });
  const meA = await viaSim(B0.sim, '/web/me', { headers: { cookie: ckA.header } });
  check('끔: A의 쿠키를 B 주소로 보내면 401 tailscale_node(other_node), A 주소로는 200', meB.status === 401 && meB.body.error.reason === 'other_node' && meA.status === 200 && meA.body.passkey === false, { b: meB.status, a: meA.status });

  // ---- 7. 끔 → 켬: A·B는 패스키 등록 화면, 목록에 패스키 등록 필요 ----
  await openDevicesTab();
  await win.click('[data-role=passkey-mode] [data-field=remotePasskey]');
  await until(async () => (await pkSwitch()).on === '1', 5000);
  const sw1 = await pkSwitch();
  check('스위치 켬: 켬 설명(휴대폰이나 이 기기의 패스키), 세션 시간이 쓰인다', /휴대폰이나 이 기기의 패스키|phone or this device/.test(sw1.hint) && !sw1.limitsOff, sw1);
  const enrollA = await pA.waitForSelector('[data-role=passkey-enroll]', { timeout: 30000 }).then(() => true, () => false);
  const enrollB = await pB.waitForSelector('[data-role=passkey-enroll]', { timeout: 30000 }).then(() => true, () => false);
  check('켬: 패스키 없이 짝 맺은 A와 B는 "패스키 등록" 화면', enrollA && enrollB, { enrollA, enrollB });
  await wshot(pA, '07-a-enroll');
  await sleep(500);
  const rA1 = await rowOf(devA.id), rB1 = await rowOf(devB.id);
  check('켬: 기기 목록에 "패스키 등록 필요"(A, B)', rA1 && rA1.needsPasskey && rB1 && rB1.needsPasskey, { a: rA1 && rA1.needsPasskey, b: rB1 && rB1.needsPasskey });
  await win.evaluate(() => document.querySelector('[data-role=device-list]').scrollIntoView());
  await shot(win, '08-pc-devices-needs-passkey', log);
  const meA1 = await viaSim(B0.sim, '/web/me', { headers: { cookie: ckA.header } });
  check('켬: 패스키 없는 기기의 /web/me는 401 passkey_required', meA1.status === 401 && meA1.body.error.code === 'passkey_required', { status: meA1.status, code: meA1.body && meA1.body.error && meA1.body.error.code });

  // ---- 8. A가 지금 세션으로 패스키 등록 → 보드, 쿠키 12시간 ----
  await pA.click('[data-role=passkey-via] [data-via=device]');
  await pA.click('[data-action=passkey-enroll]');
  await L.boardOpen(pA);
  const credsA1 = await A.creds();
  const ckA1 = await L.sessionCookie(A.ctx, BASE_A, B0.port);
  const devA1 = (await devices()).devices.find((d) => d.id === devA.id);
  check('A: 지금 세션으로 패스키 등록 → 보드(같은 기기, 같은 세션 쿠키), 쿠키는 켬의 12시간', credsA1.length === 1 && credsA1[0].rpId === NAME && devA1.passkey && devA1.passkey.kind === 'device' && !devA1.needsPasskey && ckA1.value === ckA.value && left(ckA1) <= 12 * 3600 && left(ckA1) > 11 * 3600, { creds: credsA1.length, kind: devA1.passkey && devA1.passkey.kind, sameCookie: ckA1.value === ckA.value, leftH: left(ckA1) / 3600 });
  await wshot(pA, '09-a-board-after-enroll');
  await sleep(300);
  const rA2 = await rowOf(devA.id);
  check('기기 목록: A는 기기 내장 패스키, 등록 필요 표시가 사라짐', rA2 && rA2.kind === 'device' && !rA2.needsPasskey, rA2);

  // ---- 9. 켬 → 끔: A의 쿠키가 400일로, B는 다시 열면 곧바로 보드 ----
  await win.click('[data-role=passkey-mode] [data-field=remotePasskey]');
  await until(async () => (await pkSwitch()).on === '0', 5000);
  const ckA2 = await until(async () => { const c = await L.sessionCookie(A.ctx, BASE_A, B0.port); return c && left(c) > 399 * DAY_S ? c : null; }, 10000).catch(() => null);
  check('켬 → 끔: 붙어 있는 A는 쿠키를 다시 받아 400일(세션 수명이 늘어남), 다시 확인 없음', !!ckA2 && (await L.webOpen(pA)), { leftDays: ckA2 && left(ckA2) / DAY_S });
  await pB.reload();
  await L.boardOpen(pB);
  check('켬 → 끔: 패스키를 등록하지 않은 B는 다시 열면 곧바로 보드', await L.webOpen(pB));
  await shot(win, '10-pc-security-off-again', log);

  // ---- 10. 짝 풀기 → 짝 맺기 화면 ----
  await win.click(`[data-role=device-list] [data-device="${devA.id}"] [data-action=device-revoke]`);
  if (await win.waitForSelector('[data-role=unpair-dialog]', { timeout: 2000 }).then(() => true, () => false)) await win.click('[data-action=unpair-confirm]');
  const toPair = await pA.waitForSelector('[data-role=pair]', { timeout: 20000 }).then(() => true, () => false);
  const meGone = await viaSim(B0.sim, '/web/me', { headers: { cookie: ckA.header } });
  check('끔: 짝 풀기는 세션을 끝낸다(A는 짝 맺기 화면, 옛 쿠키 401)', toPair && !(await pA.$('[data-role=reauth]')) && meGone.status === 401, { toPair, me: meGone.status });
  await wshot(pA, '11-a-unpaired');
  const sec = await L.noSecrets(pB, [ckA.value]);
  check('document.cookie·localStorage·sessionStorage에 비밀이 없다(B)', sec.ok, sec);

  // ---- 11. 연결 기록 ----
  await sleep(800);
  const entries = (await win.evaluate(() => window.__mt.api.call('remote.log', { limit: 500 }))).entries.filter((e) => e.at >= logStart).reverse();
  const evs = entries.map((e) => `${e.event}${e.reason ? `:${e.reason}` : ''}${e.passkey === false ? '(no passkey)' : ''}`);
  const order = ['pair.ok(no passkey)', 'connect', 'pair.request', 'pair.ok(no passkey)', 'kick', 'disconnect:pc', 'connect', 'remote.block', 'remote.allow', 'connect', 'deny:tailscale_node:other_node', 'passkey.on', 'disconnect:passkey_required', 'passkey.add', 'connect', 'passkey.off', 'unpair', 'disconnect:revoked'];
  let i = 0; for (const e of evs) if (i < order.length && e === order[i]) i++;
  const text = JSON.stringify(entries);
  check('흐름이 연결 기록에 차례대로 남는다(패스키 없이 짝 맺음, 켬, 패스키 등록, 끔), 비밀 없음', i === order.length && !entries.some((e) => e.event === 'pair.grant') && ![ckA.value, code].some((s) => text.includes(s)), { matched: `${i}/${order.length}`, next: order[i], evs });
  fs.writeFileSync(path.join(OUT, 'remote-log.json'), JSON.stringify(entries, null, 2));
  fs.writeFileSync(path.join(OUT, 'remote-log-cli.txt'), atrium('remote', 'log', '--limit', '60'));
  await openDevicesTab();
  await win.waitForSelector('[data-role=remote-log] .mt-remote-log-row', { timeout: 10000 });
  while (await win.$('[data-action=remote-log-more]')) { await win.click('[data-action=remote-log-more]'); await sleep(100); }
  const rows = await win.evaluate(() => [...document.querySelectorAll('[data-role=remote-log] .mt-remote-log-row')].map((r) => ({ ev: r.dataset.event, text: r.querySelector('.mt-remote-log-ev').textContent })));
  const noKeyRow = rows.find((r) => r.ev === 'pair.ok');
  check('설정 탭 기록: "패스키 없이" 짝 맺음, 패스키로 확인 켬·끔, 패스키 등록 글', noKeyRow && /패스키 없이|without a passkey/.test(noKeyRow.text) && ['passkey.on', 'passkey.off', 'passkey.add'].every((e) => rows.some((r) => r.ev === e && !/remoteLog\./.test(r.text))), rows.filter((r) => /passkey|pair.ok/.test(r.ev)));
  await win.evaluate(() => document.querySelector('[data-role=remote-log]').scrollIntoView());
  await shot(win, '12-pc-remote-log', log);
  await closeSettings();
} catch (e) {
  log(`오류 ${e.stack}`);
  check('시험이 끝까지 돎', false, e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (app) await closeApp(app);
  for (const s of [simA, simB]) if (s) await s.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'p62-remote-results.json'), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
