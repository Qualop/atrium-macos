// ux2 S10: 같은 판을 PC 브라우저 웹 화면과 휴대폰 크기(Playwright 기기 흉내)로 연다(원격 흉내는 P59·P138 방법).
// - 흉내 프록시 127.0.0.1:47910 → 47908(X-Forwarded-For 100.64.0.2 = 가짜 tailscale의 laptop-a), 흉내 이름 pc.example.ts.net을 127.0.0.1로
// - 백엔드는 experiments/ux2/tools/env.cjs 값(ATRIUM_TAILSCALE 가짜, ATRIUM_WEB_HOSTS)으로 떠 있어야 한다. 기기 코드는 CLI로 받는다
// 사용: node experiments/ux2/tools/e2e.cjs ux2-web.mjs [pc|phone|both]. 결과: experiments/ux2/ux2-web-*.png, ux2-web.json
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { chromium, devices } from 'playwright';
import * as L from './ux2-lib.mjs';

const which = process.argv[2] || 'both';
const log = L.logger('ux2-web');
const { simHeaders } = await import(new URL('file:///' + path.join(L.REPO, 'backend', 'tools', 'ts-sim-proxy.mjs').replace(/\\/g, '/')).href);
const NAME = 'pc.example.ts.net', SIM = 47910, PORT = 47908, BASE = `http://${NAME}:${SIM}`;
const cfg = { name: NAME, login: 'me@example.com', host: null, keepOrigin: true, ip: '100.64.0.2' };
const srv = http.createServer((req, res) => {
  const up = http.request({ host: '127.0.0.1', port: PORT, method: req.method, path: req.url, headers: simHeaders(req.headers, cfg) }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', (e) => { if (!res.headersSent) res.writeHead(502); res.end(String(e.message)); });
  req.pipe(up);
});
srv.on('upgrade', (req, sock, head) => {
  const up = net.connect(PORT, '127.0.0.1', () => {
    const h = simHeaders(req.headers, cfg);
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\r\n')}\r\n\r\n`);
    if (head && head.length) up.write(head);
    sock.pipe(up); up.pipe(sock);
  });
  up.on('close', () => sock.destroy()); sock.on('close', () => up.destroy());
  up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
});
await new Promise((r) => srv.listen(SIM, '127.0.0.1', r));
const out = { at: new Date().toISOString() };
const code = () => /(\d{6})/.exec(L.atrium('devices', 'code'))[1];
// P138처럼 이미 받아 둔 chromium-1234를 쓴다(이 워크트리의 playwright가 바라는 판이 깔려 있지 않을 수 있다)
const exe = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');
const browser = await chromium.launch({ headless: true, ...(fs.existsSync(exe) ? { executablePath: exe } : {}), args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
const shot = (pg, n) => pg.screenshot({ path: path.join(L.OUT, `ux2-web-${n}.png`) });

async function pairOn(pg, label) {
  const errors = [];
  pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  pg.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await pg.goto(`${BASE}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await L.sleep(500);
  await shot(pg, `${label}-01-pair`);
  const pairOverflow = await pg.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: innerWidth }));
  const nameF = await pg.$('[data-field=pair-name]'); if (nameF) await nameF.fill(`ux2 ${label}`);
  await pg.fill('[data-field=pair-code]', code());
  await pg.click('[data-action=pair-submit]');
  const nx = await pg.waitForFunction(() => (window.__mt && window.__mt.getState().boardLoaded && 'board') || (document.querySelector('[data-role=passkey-register]') && 'pk'), null, { timeout: 30000 }).then((h) => h.jsonValue());
  if (nx === 'pk') { await pg.click('[data-action=passkey-create]'); await pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 30000 }); }
  await L.sleep(2500);
  return { errors, pairOverflow };
}

if (which === 'pc' || which === 'both') {
  const ctx = await browser.newContext({ viewport: { width: 1584, height: 921 }, locale: 'ko-KR' });
  const pg = await ctx.newPage();
  const r = await pairOn(pg, 'pc');
  await pg.evaluate(() => window.__mt.getState().fitAll(0)); await L.sleep(1500);
  await shot(pg, 'pc-02-board');
  const t0 = Date.now();
  await pg.mouse.move(800, 500);
  for (let k = 0; k < 10; k++) { await pg.mouse.wheel(0, k < 5 ? -120 : 120); await L.sleep(100); }
  const zoomMs = Date.now() - t0;
  await pg.mouse.down(); for (let k = 0; k < 20; k++) await pg.mouse.move(800 + k * 10, 500 + k * 4); await pg.mouse.up();
  await L.sleep(800); await shot(pg, 'pc-03-panned');
  await pg.keyboard.press('m'); await L.sleep(1500); await shot(pg, 'pc-04-mission');
  const mm = await pg.evaluate(() => !!window.__mt.getState().missionOpen);
  await pg.keyboard.press('Escape'); await L.sleep(500);
  const overflow = await pg.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: innerWidth }));
  out.pc = { ...r, zoomMs, missionOpened: mm, overflow };
  log('pc', out.pc);
  await ctx.close();
}
if (which === 'phone' || which === 'both') {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR' });
  const pg = await ctx.newPage();
  const r = await pairOn(pg, 'phone');
  await shot(pg, 'phone-02-first');
  if (!(await pg.$('[data-role=phone-list]')) && await pg.$('[data-action=phone-list-open]')) { await pg.tap('[data-action=phone-list-open]'); await L.sleep(800); }
  await shot(pg, 'phone-03-list');
  const list = await pg.evaluate(() => ({ rows: [...document.querySelectorAll('[data-role=phone-list] [data-session]')].length, docW: document.documentElement.scrollWidth, vw: innerWidth, sections: [...document.querySelectorAll('[data-role=phone-scroll] section')].map((s) => s.dataset.section) }));
  // 응답 필요 세션(wt1)으로: 키 패드
  const need = await pg.$('[data-action=phone-next-need]');
  if (need) { await need.tap(); await L.sleep(2500); await shot(pg, 'phone-04-need'); }
  const pad = await pg.evaluate(() => { const p = document.querySelector('[data-role=phone-pad]'); return p ? { keys: [...p.querySelectorAll('[data-pad-key]')].map((b) => b.dataset.pad_key || b.dataset.padKey), text: p.innerText.slice(0, 200) } : null; });
  const back = await pg.$('[data-action=phone-back]'); if (back) { await back.tap(); await L.sleep(800); }
  // 미션(작업 관계도)
  const mBtn = await pg.$('[data-action=phone-mission], [data-action=phone-mission-open]');
  if (mBtn) { await mBtn.tap(); await L.sleep(1500); await shot(pg, 'phone-05-mission'); }
  const mission = await pg.evaluate(() => ({ view: document.querySelector('[data-role=phone]') && document.querySelector('[data-role=phone]').dataset.view, docW: document.documentElement.scrollWidth, vw: innerWidth }));
  out.phone = { ...r, list, pad, missionButton: !!mBtn, mission };
  log('phone', out.phone);
  await ctx.close();
}
fs.writeFileSync(path.join(L.OUT, 'ux2-web.json'), JSON.stringify(out, null, 2));
await browser.close();
srv.close();
process.exit(0);
