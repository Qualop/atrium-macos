// P64 README 장면: readme-shots.mjs shoot이 부른다. 판은 readme-shots.mjs seed로 꾸민 개발용 판이다.
// 장면: board(판 전체), your-turn(내 차례 카드와 목록), agents(미션 맵), dock(붙여 묶기와 배치 틀),
//       remote(흉내 노트북 브라우저의 웹 화면), devices(PC 창의 연결된 기기 탭), sidebar(사이드바와 찾기)
// 원격은 가짜 tailscale와 흉내 프록시(예시 이름 pc.example.ts.net, 예시 주소 100.64.0.2)만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { sleep, until } from './harness.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export async function shoot(ctx) {
  const { log, OUT, W, H, SIM, PC, PORT } = ctx;
  const only = (process.argv[3] || '').split(',').filter(Boolean);
  const want = (name) => !only.length || only.includes(name);
  const page = await ctx.launchWindow();
  const st = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name, pg = page) => { const f = path.join(OUT, `${name}.png`); await pg.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f), `${(fs.statSync(f).size / 1024).toFixed(0)} KiB`); return f; };
  const dpr = await st(() => window.devicePixelRatio);
  log('창', W, H, 'devicePixelRatio', dpr);
  // 아래 바는 평소처럼 숨기고, 마우스는 캔버스 가운데 위쪽에 둔다. 개발용 판 표시(dev)는 실제 판에 없으므로 그림에서 가린다
  await st(() => window.__mt.pinBottom && window.__mt.pinBottom(false));
  await page.addStyleTag({ content: '[data-role="dev-badge"]{display:none!important}' });
  const rest = async () => { await page.mouse.move(W / 2, 140); await sleep(900); };
  const clear = async () => { await page.keyboard.press('Escape').catch(() => {}); await st(() => { const s = window.__mt.getState(); s.clearSelection && s.clearSelection(); }); await sleep(300); };
  const fitAll = async () => { await st(() => window.__mt.getState().fitAll(0)); await sleep(1500); };
  const rectOf = (names) => st((ns) => {
    const s = window.__mt.getState();
    const ids = [...s.sessions.values()].filter((x) => ns.includes(x.name)).map((x) => x.sessionId);
    const rs = ids.map((id) => s.nodes.get(id)).filter(Boolean);
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
    return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
  }, names);
  const goRect = async (r, pad = 40) => { await st((rr) => window.__mt.getState().navigateToRect(rr, 0), { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }); await sleep(1800); };
  const states = await st(() => [...window.__mt.getState().sessions.values()].map((s) => `${s.name}:${s.state}`));
  log('세션', states.join(' '));

  // 1. 판 전체
  if (want('board')) {
    await clear(); await fitAll(); await rest();
    await shot('board');
  }
  // 2. 내 차례: 리뷰어의 질문 카드와 위 오른쪽 내 차례 목록
  if (want('your-turn')) {
    await clear();
    const r = await rectOf(['review', 'lead']);
    if (r) await goRect(r, 30);
    await rest();
    await page.click('[data-role="inbox"]').catch(() => {});
    await sleep(700);
    await shot('your-turn');
    await page.click('[data-role="inbox"]').catch(() => {});
    await sleep(300);
  }
  // 3. 에이전트끼리: 미션 맵
  if (want('agents')) {
    await clear(); await fitAll(); await rest();
    await page.keyboard.press('m');
    await sleep(1500);
    // 미션 맵은 위쪽에 모이므로 내용이 있는 높이까지만 자른다
    const bottom = await st(() => { const els = [...document.querySelectorAll('[class*="mission"] *')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0 && r.height < 600); return Math.max(...els.map((r) => r.bottom)); });
    const ch = Math.min(H, Math.max(560, Math.ceil((bottom + 48) / 8) * 8));
    const f = path.join(OUT, 'agents.png');
    await page.screenshot({ path: f, clip: { x: 0, y: 0, width: W, height: ch } });
    log('스크린숏', path.relative(REPO, f), `${W}x${ch}`, `${(fs.statSync(f).size / 1024).toFixed(0)} KiB`);
    await page.keyboard.press('Escape');
    await sleep(500);
  }
  // 4. 붙여 묶기와 배치 틀: 덩어리 안 노드 하나를 고르면 위쪽 막대에 세션 수에 맞는 틀이 뜬다
  if (want('dock')) {
    await clear();
    const r = await rectOf(['lead', 'ui', 'tests']);
    if (r) await goRect(r, 60);
    const head = await st(() => { const s = window.__mt.getState(); const id = [...s.sessions.values()].find((x) => x.name === 'lead').sessionId; const e = document.querySelector(`.react-flow__node[data-id="${id}"] .mt-node-head, .react-flow__node[data-id="${id}"] header`); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width * 0.55, y: b.top + b.height / 2 }; });
    if (head) await page.mouse.click(head.x, head.y);
    await sleep(900);
    // 막대가 좁아 배치 틀을 접었으면 펼친다
    if (await page.$('[data-action="layout-more"]')) { const b = await page.$('[data-action="layout-more"]'); if (await b.isVisible()) await b.click(); }
    await sleep(500);
    await page.mouse.move(W / 2, 400); await sleep(900);
    await shot('dock');
    await clear();
  }
  // 5. 사이드바와 찾기
  if (want('sidebar')) {
    await clear(); await fitAll();
    await page.click('[data-action="sidebar"]').catch(() => page.keyboard.press('Control+Shift+E'));
    await sleep(1200);
    await page.click('[data-action="search"]');
    await sleep(400);
    await page.fill('[data-field="search"]', 'theme');
    await until(() => page.evaluate(() => document.querySelectorAll('.mt-search-item:not(.empty)').length >= 2), 10000, 200).catch(() => log('찾기 결과가 둘 넘게 오지 않았다'));
    await sleep(600);
    await shot('sidebar');
    await page.keyboard.press('Escape'); await sleep(300);
    await page.click('[data-action="sidebar"]').catch(() => page.keyboard.press('Control+Shift+E'));
    await sleep(600);
  }
  // 6. 원격: 흉내 노트북 브라우저로 짝 맺고 웹 화면을 찍은 뒤 브라우저 틀에 넣는다. PC 창의 연결된 기기 탭도 찍는다
  if (want('remote') || want('devices')) {
    const toUrl = (p) => pathToFileURL(p).href;
    const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
    const sim = startTsSim({ listen: SIM, target: PORT, name: PC, login: 'me@example.com', keepOrigin: true });
    sim.cfg.ip = '100.64.0.2'; // p49-fake-tailscale.mjs의 whois: laptop-a
    await sim.ready;
    const base = `http://${PC}:${SIM}`;
    const browser = await chromium.launch({ headless: true, channel: 'chromium', args: [`--host-resolver-rules=MAP ${PC} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${base}`] });
    try {
      // 판 설정: 패스키로 확인 끔(기본), 원격 받기 켬. 앞선 실행의 기기는 지운다(이 판의 기록만)
      const devs = (await ctx.call('device.list')).devices || [];
      for (const d of devs) await ctx.call('device.revoke', { id: d.id });
      await ctx.call('settings.set', { key: 'remotePasskey', value: false });
      await ctx.call('settings.set', { key: 'remoteAccess', value: true });
      await page.evaluate(() => localStorage.setItem('mt.clientName', 'PC window'));
      // 코드 만들기
      await page.click('[data-action=settings-open]');
      await page.click('button[data-tab=devices]');
      await page.waitForSelector('[data-action=device-new-code], [data-role=pair-code]');
      if (!(await page.$('[data-role=pair-code]'))) await page.click('[data-action=device-new-code]');
      const code = (await page.textContent('[data-role=pair-code]')).trim();
      await page.click('[data-action=settings-close]').catch(() => {});
      // 노트북 브라우저
      const bctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1, locale: 'en-US' });
      const web = await bctx.newPage();
      web.on('pageerror', (e) => log(`[web pageerror] ${e.message}`));
      await web.goto(`${base}/`);
      await web.waitForSelector('[data-role=pair]', { timeout: 20000 });
      await web.fill('[data-field=pair-name]', 'Chrome on laptop');
      await web.fill('[data-field=pair-code]', code);
      await web.click('[data-action=pair-submit]');
      await web.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.getState().conn === 'open', null, { timeout: 60000 });
      await web.addStyleTag({ content: '[data-role="dev-badge"]{display:none!important}' });
      await sleep(1500);
      await web.evaluate(() => { const s = window.__mt.getState(); s.fitAll && s.fitAll(0); });
      await sleep(2500);
      await web.mouse.move(720, 120); await sleep(800);
      const inner = path.join(OUT, 'remote-inner.png');
      await web.screenshot({ path: inner });
      if (want('remote')) await frame(browser, inner, `https://${PC}/`, path.join(OUT, 'remote.png'), { W, H, log });
      // PC 창: 위 알약(다른 기기 n)과 연결된 기기 탭
      if (want('devices')) {
        await sleep(1000);
        await page.click('[data-action=settings-open]');
        await page.click('button[data-tab=devices]');
        await page.waitForSelector('[data-role=device-list]');
        await sleep(900);
        await shot('devices');
        await page.click('[data-action=settings-close]').catch(() => {});
      }
      await bctx.close();
    } finally {
      await browser.close().catch(() => {});
      sim.close && sim.close();
    }
  }
}

// 웹 화면 그림을 노트북 브라우저 틀(주소 줄, 탭) 안에 넣어 W×H 그림으로 만든다
async function frame(browser, innerPng, url, out, { W, H, log }) {
  const b64 = fs.readFileSync(innerPng).toString('base64');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0b0d0c;font-family:"Segoe UI",system-ui,sans-serif}
  .stage{height:100%;display:flex;align-items:center;justify-content:center}
  .win{width:1460px;border-radius:12px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 1px #2a2f2c;background:#1d201f}
  .bar{height:46px;display:flex;align-items:center;gap:14px;padding:0 16px;background:#1d201f;border-bottom:1px solid #2a2f2c}
  .dots{display:flex;gap:8px}.dots i{width:12px;height:12px;border-radius:50%;background:#3a3f3c;display:block}
  .nav{color:#7d847f;font-size:16px;letter-spacing:6px}
  .url{flex:1;height:30px;border-radius:15px;background:#121413;color:#c9d1cc;display:flex;align-items:center;padding:0 14px;font-size:14px;gap:8px}
  .url b{color:#7fd6a4;font-weight:500}
  .lock{width:12px;height:12px;border:2px solid #7fd6a4;border-radius:3px;box-sizing:border-box}
  img{display:block;width:1460px}
  </style></head><body><div class="stage"><div class="win"><div class="bar"><div class="dots"><i></i><i></i><i></i></div><div class="nav">‹ › ⟳</div>
  <div class="url"><span class="lock"></span><span><b>https://</b>${url.replace(/^https:\/\//, '')}</span></div></div>
  <img src="data:image/png;base64,${b64}"></div></div></body></html>`;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  await pg.setContent(html);
  await pg.waitForFunction(() => document.images[0] && document.images[0].complete);
  await pg.screenshot({ path: out });
  await ctx.close();
  log('스크린숏', path.relative(REPO, out), `${(fs.statSync(out).size / 1024).toFixed(0)} KiB`);
}
