// P59 창 시험 도우미: P56(패스키·HttpOnly 세션)·P57(Tailscale 기기)·P58(기록·끊기·막기)을 합친 판을 브라우저로 본다.
// - 판 값: 시험마다 기본값을 두고, MT_E2E_HERDR_SESSION·MT_E2E_PORT·MT_E2E_SIM_PORT·MT_E2E_SIM2_PORT로 덮는다(다른 작업자의 판에서 돌리지 않게).
// - 흉내 프록시(backend/tools/ts-sim-proxy.mjs, keepOrigin): 노트북마다 하나(X-Forwarded-For = 그 노트북의 tailnet 주소). Host·Origin은 브라우저 그대로라
//   패스키의 clientDataJSON origin과 맞는다. 판은 ATRIUM_WEB_HOSTS로 흉내 주소들을 받는다.
// - 보안 출처: http://pc.example.ts.net:<포트>는 보안 출처가 아니므로 Chromium 플래그 --unsafely-treat-insecure-origin-as-secure(쉼표로 여럿)로 맞춘다.
// - 인증기: CDP 가상 인증기(ctap2, internal, hasUserVerification·isUserVerified). 브라우저 문맥(노트북)마다 하나.
// 이름과 주소는 예시(pc.example.ts.net, 100.64.0.x, me@example.com)만 쓴다.
import { chromium } from 'playwright';

export const NAME = 'pc.example.ts.net';
export const LOGIN = 'me@example.com';
export const LAPTOP_A = '100.64.0.2', LAPTOP_B = '100.64.0.3'; // p49-fake-tailscale.mjs의 whois: laptop-a, laptop-b
export const board = ({ session, port, sim, sim2 }) => ({
  session: process.env.MT_E2E_HERDR_SESSION || session,
  port: Number(process.env.MT_E2E_PORT || port),
  sim: Number(process.env.MT_E2E_SIM_PORT || sim),
  sim2: Number(process.env.MT_E2E_SIM2_PORT || sim2),
});
export const baseOf = (port) => `http://${NAME}:${port}`;

// Chromium: 흉내 이름을 127.0.0.1로, 흉내 주소들을 보안 출처로
export function launchBrowser(ports, { secure = true } = {}) {
  const args = [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`];
  if (secure) args.push(`--unsafely-treat-insecure-origin-as-secure=${ports.map(baseOf).join(',')}`);
  return chromium.launch({ headless: true, channel: 'chromium', args });
}

// 노트북 하나 = 브라우저 문맥 하나 + 가상 인증기 하나
export async function laptop(browser, { log = () => {}, label = 'web' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale: 'ko-KR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`[${label} pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[${label} console.error] ${m.text().slice(0, 200)}`); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const creds = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
  return { ctx, page, cdp, creds };
}

export const boardOpen = (pg, ms = 60000) => pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.getState().conn === 'open' && window.__mt.api.conn.phase === 'open', null, { timeout: ms });
export const webOpen = (pg) => pg.evaluate(() => !!(window.__mt && window.__mt.getState().conn === 'open' && window.__mt.api.conn.phase === 'open')).catch(() => false);

// PC 창에서 코드를 만든다(설정 › 연결된 기기)
export async function newCode(win) {
  if (!(await win.$('[data-role=settings]'))) await win.click('[data-action=settings-open]');
  await win.click('button[data-tab=devices]');
  await win.waitForSelector('[data-action=device-new-code], [data-role=pair-code]');
  if (!(await win.$('[data-role=pair-code]'))) await win.click('[data-action=device-new-code]');
  const code = (await win.textContent('[data-role=pair-code]')).trim();
  await win.click('[data-action=settings-close]').catch(() => {});
  return code;
}
// 브라우저: 코드로 짝 맺기 → 패스키 만들기 → 보드
export async function pairByCode(pg, base, code, name) {
  await pg.goto(`${base}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 20000 });
  await pg.fill('[data-field=pair-name]', name);
  await pg.fill('[data-field=pair-code]', code);
  await pg.click('[data-action=pair-submit]');
  await pg.waitForSelector('[data-role=passkey-register]', { timeout: 15000 });
  await pg.click('[data-action=passkey-create]');
  await boardOpen(pg);
}
// 다시 확인 화면에서 패스키로 확인한다
export async function reauth(pg, ms = 30000) {
  await pg.waitForSelector('[data-role=reauth] [data-action=passkey-verify]', { timeout: ms });
  await pg.click('[data-action=passkey-verify]');
  await boardOpen(pg);
}
// 세션 쿠키 값(HttpOnly라 스크립트는 못 읽는다. 시험만 브라우저 문맥에서 꺼낸다)
export async function sessionCookie(ctx, base, port) {
  const c = (await ctx.cookies(base)).find((x) => x.name === `atrium_${port}` || x.name === `__Host-atrium_${port}`);
  return c ? { header: `${c.name}=${c.value}`, value: c.value, cookie: c } : null;
}
// 스크립트가 볼 수 있는 곳(document.cookie, localStorage, sessionStorage)에 비밀이 없는가
export async function noSecrets(pg, secretValues) {
  const seen = await pg.evaluate(() => ({ cookie: document.cookie, local: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])), session: Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)])) }));
  const all = [seen.cookie, JSON.stringify(seen.local), JSON.stringify(seen.session)].join('\n');
  const leaks = secretValues.filter((s) => s && all.includes(s));
  return { ok: leaks.length === 0 && !/atrium_/.test(seen.cookie) && !('atrium.deviceToken' in seen.local), cookie: seen.cookie, localKeys: Object.keys(seen.local), sessionKeys: Object.keys(seen.session), leaks: leaks.length };
}
