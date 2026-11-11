// P87 창 시험: 휴대폰은 늘 세션 목록(보드로 가는 길 없음), 목록에서 여는 미션 맵(mission.graph만, 대화·터미널 요청 없음),
//   노드를 탭해 세션 화면을 열고 돌아오면 자리가 그대로, 죽음 기록(boot 줄)은 한 번만. 데스크톱 웹 보드의 대화 보기(session.messages) 양도 잰다(고치지 않음).
// 흉내 원격(p59-lib.mjs, ts-sim-proxy.mjs): 브라우저 문맥(iPhone 393×852, 화면 배율 3, 손가락) → ts-sim(47893) → 백엔드(47897). Playwright WebKit과 Chromium.
// 따로 띄운 개발용 판(atrium-dev-p87, 47897, backend/.dev)만 쓴다. PC 창은 띄우지 않고 짝 맺기 코드와 설정은 이 판의 CLI로 한다.
// 판: 워크스페이스 3개(mtask-p87-a·b·c), p87-lead(haiku, 권한 질문 = 내 차례) → p87-rev(reviewer, ping 도는 중 = 일함) → p87-help(helper),
//   p87-lead → p87-port(porter, 다른 워크스페이스), p87-rev → p87-sh-b(셸, notes 역할 선), p87-run(셸, ping 도는 중), p87-sh-c(셸)
// P87_ENGINES=webkit,chromium(기본 둘 다). 결과는 experiments/p87/(git 밖).
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p87-phone.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';

const ENGINES = (process.env.P87_ENGINES || 'webkit,chromium').split(',').filter(Boolean);
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p87');
const CONVOS = path.join(OUT, 'convos');
const DIRS = ['a', 'b', 'c'].map((k) => `C:\\Workspace\\mtask-p87-${k}`);
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A } = L;
const B0 = L.board({ session: 'atrium-dev-p87', port: 47897, sim: 47893, sim2: 47894 });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p87',
  ATRIUM_TEST_PREFIX: 'p87-none-',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim},localhost:${B0.sim}`,
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
for (const d of DIRS) fs.mkdirSync(d, { recursive: true });
const { logger, sleep, until } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
const { chromium, webkit } = await import('playwright');

const log = logger('p87-phone');
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const W = 393, H = 852;
const PHONE = { viewport: { width: W, height: H }, screen: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: SAFARI };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ko-KR' };
const loadedOpen = (pg, ms = 60000) => pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: ms });
const splashGone = (pg) => pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
const metrics = { engines: {}, desktop: null };

// 보낸 요청과 받은 메시지(이름과 바이트만, 내용 없음). session.messages 답은 받은 수·바이트와 보이는 14개의 바이트를 따로 센다
const WS_HOOK = () => {
  const Orig = window.WebSocket;
  window.__p87 = { sent: [], recv: [] };
  class Hooked extends Orig {
    constructor(...a) {
      super(...a);
      const sent = new Map();
      const send = this.send.bind(this);
      this.send = (d) => { try { const j = JSON.parse(d); sent.set(j.id, j.method); window.__p87.sent.push({ m: j.method, t: Math.round(performance.now()) }); } catch {} return send(d); };
      this.addEventListener('message', (ev) => {
        const s = typeof ev.data === 'string' ? ev.data : '';
        let k = '?', extra = null;
        try {
          const j = JSON.parse(s); k = j.event || `r:${sent.get(j.id)}`;
          if (k === 'r:session.messages' && j.result && Array.isArray(j.result.messages)) {
            const all = j.result.messages, shown = all.filter((m) => m.role !== 'tool_result').slice(-14);
            extra = { n: all.length, shownB: JSON.stringify(shown).length, toolB: JSON.stringify(all.filter((m) => m.role === 'tool_result')).length };
          }
        } catch {}
        window.__p87.recv.push({ k, b: s.length, t: Math.round(performance.now()), ...(extra || {}) });
      });
    }
  }
  window.WebSocket = Hooked;
};
const sentSince = (pg, t) => pg.evaluate((t0) => window.__p87.sent.filter((x) => x.t >= t0).map((x) => x.m), t);
const nowIn = (pg) => pg.evaluate(() => Math.round(performance.now()));
const view = (pg) => pg.evaluate(() => { const p = document.querySelector('[data-role=phone]'); return p ? p.dataset.view : document.querySelector('.react-flow') ? 'board' : 'none'; });
const PROBE_LIST = `(() => ({
  view: (document.querySelector('[data-role=phone]') || {}).dataset ? document.querySelector('[data-role=phone]').dataset.view : null,
  flow: !!document.querySelector('.react-flow'), canvas: !!document.querySelector('.mt-canvas'),
  toBoard: document.querySelectorAll('[data-action=phone-board], [data-action=phone-list-open], [data-action=light-board], [data-action=board-level], [data-role=phone-full]').length,
  light: !!document.querySelector('[data-role=light-banner]'), missionBtn: !!document.querySelector('[data-action=phone-mission]'),
  terms: window.__mt.terms.size, crash: window.__mt.crash(), lite: document.documentElement.classList.contains('mt-lite'), level: document.documentElement.dataset.level || null,
}))()`;
const PROBE_MAP = `(() => {
  const rows = [...document.querySelectorAll('[data-role=pm-row]')].map((e) => { const r = e.getBoundingClientRect(); const role = e.querySelector('[data-role=pm-role]'), from = e.querySelector('[data-role=pm-from]'); return { name: e.dataset.name, tier: e.dataset.tier, depth: +e.dataset.depth, role: role ? role.textContent : null, from: from ? from.textContent : null, links: [...e.querySelectorAll('[data-role=pm-link]')].map((x) => x.textContent), top: Math.round(r.top), left: Math.round(e.querySelector('.mt-pm-card').getBoundingClientRect().left), ws: e.closest('[data-role=pm-group]').dataset.ws }; });
  const groups = [...document.querySelectorAll('[data-role=pm-group]')].map((g) => ({ ws: g.dataset.ws, name: g.querySelector('.mt-ph-group-name').textContent, n: g.querySelectorAll('[data-role=pm-row]').length }));
  const sc = document.querySelector('[data-role=pm-scroll]');
  const sum = document.querySelector('[data-role=pm-sum]');
  return { rows, groups, scroll: sc ? Math.round(sc.scrollTop) : null, scrollMax: sc ? sc.scrollHeight - sc.clientHeight : null, sum: sum ? sum.textContent : null,
    page: { sw: document.documentElement.scrollWidth, iw: innerWidth, bodyPos: getComputedStyle(document.body).position } };
})()`;
const tapSel = async (pg, sel) => { await pg.waitForSelector(sel, { timeout: 15000 }); await pg.tap(sel); };
const shot = (pg, name) => pg.screenshot({ path: path.join(OUT, `${name}.png`) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
const newCode = () => call('device.code').code;
async function pair(pg, base) {
  await pg.goto(`${base}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await pg.fill('[data-field=pair-code]', newCode());
  await pg.click('[data-action=pair-submit]');
  await loadedOpen(pg); await splashGone(pg);
}
const bootLog = () => call('remote.log', { limit: 120 }).entries;

// 이 시험이 띄운 브라우저의 WebKit 웹 프로세스(PID로만 끈다)
function childTree(rootPid) {
  const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress';
  const all = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 60000 }));
  const kids = new Map();
  for (const p of all) { if (!kids.has(p.ParentProcessId)) kids.set(p.ParentProcessId, []); kids.get(p.ParentProcessId).push(p); }
  const out = [];
  const walk = (pid) => { for (const c of kids.get(pid) || []) { out.push({ pid: c.ProcessId, name: c.Name }); walk(c.ProcessId); } };
  walk(rootPid);
  return out;
}
const webkitPids = () => childTree(process.pid).filter((p) => /WebKitWebProcess/i.test(p.name)).map((p) => p.pid);

// ---- 판 ----
const LONG = (n) => `Use the Bash tool to run this command in the foreground, not in the background, with timeout 600000: ping -n ${n} 127.0.0.1 . Wait for it to finish. Then reply with the single word done.`;
const ASK = 'Use the Bash tool to run exactly: mkdir p87-ask-dir . Then reply with the single word done.';
const envOf = (name) => {
  const s = byName(name);
  const settings = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'sessions', `${s.sessionId || s.id}.json`), 'utf8'));
  const e = { ...process.env, ...Object.fromEntries(Object.entries(settings.env || {}).filter(([k]) => k.startsWith('ATRIUM_'))) };
  if (!e.ATRIUM_SESSION_ID || !e.ATRIUM_SESSION_TOKEN) throw new Error(`${name}: 설정 파일에 세션 env가 없다`);
  return e;
};
const child = (pe, args, ms = 150000) => new Promise((resolve) => execFile(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), ...args], { encoding: 'utf8', env: pe, timeout: ms }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout || ''}${stderr || ''}`.trim() })));
const trustStop = () => {
  const tr = sessions().find((s) => /^p87-/.test(s.name) && s.state === 'trust_wait');
  if (tr) { fs.writeFileSync(path.join(DEV, 'p87-need-trust.txt'), `${tr.name} asks the folder trust question in ${tr.cwd || '?'}\n`); throw new Error('trust question (backend/.dev/p87-need-trust.txt)'); }
};
const readyOf = (n, ms = 150000) => until(() => { const s = byName(n); return s && ['ready', 'working', 'waiting', 'trust_wait'].includes(s.state) ? s : null; }, ms, 1500).catch(() => null);

async function setupBoard() {
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  fs.mkdirSync(path.join(DIRS[0], '.claude'), { recursive: true });
  fs.writeFileSync(path.join(DIRS[0], '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ping:*)', 'Bash(ping *)'] } }, null, 1)); // ping만 묻지 않는다(P85)
  const spawnIn = (dir, ...a) => JSON.parse(atrium('--json', 'spawn', dir, ...a));
  if (!byName('p87-lead')) spawnIn(DIRS[0], '--model', 'haiku', '--name', 'p87-lead');
  for (const [n, wi] of [['p87-run', 0], ['p87-sh-b', 1], ['p87-sh-c', 2]]) if (!byName(n)) spawnIn(DIRS[wi], '--kind', 'shell', '--name', n);
  await readyOf('p87-lead'); trustStop();
  const leadEnv = envOf('p87-lead');
  if (!byName('p87-rev')) log('child rev', (await child(leadEnv, ['child', 'p87-rev', '--role', 'reviewer', '--model', 'haiku', '--no-wait'])).out.slice(0, 300));
  if (!byName('p87-port')) log('child port', (await child(leadEnv, ['child', 'p87-port', '--role', 'porter', '--cwd', DIRS[2].replace(/\\/g, '/'), '--model', 'haiku', '--no-wait'])).out.slice(0, 300));
  await readyOf('p87-rev'); await readyOf('p87-port'); trustStop();
  if (!byName('p87-help')) log('child help', (await child(envOf('p87-rev'), ['child', 'p87-help', '--role', 'helper', '--model', 'haiku', '--no-wait'])).out.slice(0, 300));
  await readyOf('p87-help'); trustStop();
  try { if (!call('link.list').some((l) => l.from === byName('p87-rev').sessionId && l.to === byName('p87-sh-b').sessionId)) atrium('link', 'p87-rev', 'p87-sh-b', '--role', 'notes'); } catch (e) { log(`연결 ${e.message.slice(0, 120)}`); }
  await sleep(3000);
}
// 찍기 전에 일하는 것과 묻는 것을 돌린다
async function stir() {
  const run = byName('p87-run');
  if (!(run.shell && run.shell.atPrompt === false)) atrium('input', 'p87-run', 'ping -n 1500 127.0.0.1\\r');
  if (byName('p87-rev').state !== 'working') atrium('send', '@p87-rev', LONG(900));
  if (byName('p87-lead').state !== 'waiting') atrium('send', '@p87-lead', ASK);
  await until(() => byName('p87-rev').state === 'working' && byName('p87-lead').state === 'waiting' && (byName('p87-run').shell || {}).atPrompt === false, 150000, 1500).catch(() => {});
  log(`세션 ${sessions().filter((s) => /^p87-/.test(s.name)).map((s) => `${s.name}:${s.state}${s.shell ? `/${s.shell.atPrompt === false ? 'run' : 'idle'}` : ''}${s.branch && s.branch.role ? `(${s.branch.role})` : ''}`).join(' ')}`);
}

// ---- 휴대폰 한 엔진 ----
async function phone(engine, browser, base) {
  const E = engine;
  const m = metrics.engines[E] = {};
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(WS_HOOK);
  const open = async (label) => {
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[${E} ${label} pageerror] ${e.message}`));
    pg.on('console', (x) => { if (x.type() === 'error') log(`[${E} ${label} console.error] ${x.text().slice(0, 200)}`); });
    const cdp = E === 'chromium' ? await ctx.newCDPSession(pg) : null;
    return { pg, cdp };
  };
  let { pg, cdp } = await open('phone');
  await pair(pg, base);
  await pg.evaluate(() => { try { localStorage.setItem('mt.phoneLayout', 'board'); } catch {} }); // P76 때 보드를 골랐던 기기도
  await pg.goto(`${base}/`); await loadedOpen(pg); await splashGone(pg); await sleep(2500);
  // 1. 목록으로 열림, 보드로 가는 길 없음
  let p = await pg.evaluate(PROBE_LIST);
  check(`[${E}] 휴대폰은 목록으로 열린다(보드·캔버스 없음, 보드 단추·전체 보기·보드로 다시 열기 없음, 미션 맵 단추 있음)`, p.view === 'list' && !p.flow && !p.canvas && p.toBoard === 0 && p.missionBtn && p.terms === 0, p);
  await shot(pg, `${E}-01-list`);
  await pg.setViewportSize({ width: H, height: W }); await sleep(1200);
  const pl = await pg.evaluate(PROBE_LIST);
  check(`[${E}] 가로로 돌려도 목록(보드 없음)`, pl.view === 'list' && !pl.flow, { view: pl.view, flow: pl.flow });
  await pg.setViewportSize({ width: W, height: H }); await sleep(1200);
  // 2. 미션 맵: mission.graph만, 대화·터미널 요청 없음
  const t0 = await nowIn(pg);
  await tapSel(pg, '[data-action=phone-mission]');
  await pg.waitForFunction(() => document.querySelectorAll('[data-role=pm-row]').length >= 7, null, { timeout: 20000 }).catch(() => {});
  await sleep(3500);
  let mp = await pg.evaluate(PROBE_MAP);
  const sent = await sentSince(pg, t0);
  m.missionSent = sent;
  const bad = sent.filter((x) => /^session\.messages$|^terminal\./.test(x));
  check(`[${E}] 미션 맵을 여는 동안 session.messages·terminal.* 요청이 없고 mission.graph를 받는다`, bad.length === 0 && sent.includes('mission.graph'), { sent: [...new Set(sent)], bad });
  await shot(pg, `${E}-02-mission`);
  const row = (n) => mp.rows.find((r) => r.name === n) || {};
  log(`[${E}] 미션 맵 ${JSON.stringify(mp)}`);
  check(`[${E}] 무리 3개(판 순서), 각 무리의 세션`, mp.groups.length === 3 && mp.groups[0].n === 4 && mp.groups[1].n === 1 && mp.groups[2].n >= 1 && /mtask-p87-a/.test(mp.groups[0].name) && /mtask-p87-c/.test(mp.groups[2].name), mp.groups);
  check(`[${E}] 나무와 들여쓰기: lead → rev(reviewer) → help(helper), 하위는 오른쪽으로`, row('p87-lead').depth === 0 && row('p87-rev').depth === 1 && row('p87-help').depth === 2 && row('p87-rev').role === 'reviewer' && row('p87-help').role === 'helper' && row('p87-rev').left > row('p87-lead').left && row('p87-help').left > row('p87-rev').left && row('p87-rev').top > row('p87-lead').top && row('p87-help').top > row('p87-rev').top, ['p87-lead', 'p87-rev', 'p87-help'].map(row));
  check(`[${E}] 다른 워크스페이스의 하위·역할 선은 그 무리의 뿌리에 부모 표시(port ← lead, sh-b ← rev · notes)`, row('p87-port').depth === 0 && /p87-lead/.test(row('p87-port').from || '') && row('p87-port').role === 'porter' && /p87-rev/.test(row('p87-sh-b').from || '') && row('p87-sh-b').role === 'notes', [row('p87-port'), row('p87-sh-b')]);
  check(`[${E}] 강조 등급: rev·run 일함, lead 내 차례, 나머지는 쉼`, row('p87-rev').tier === 'work' && row('p87-run').tier === 'work' && row('p87-lead').tier === 'turn' && ['rest', 'review'].includes(row('p87-help').tier), mp.rows.map((r) => `${r.name}:${r.tier}`));
  check(`[${E}] 페이지가 옆으로 늘어나지 않는다(가로 스크롤 없음, 몸통 고정)`, mp.page.sw <= mp.page.iw && mp.page.bodyPos === 'fixed', mp.page);
  // 3. 노드를 탭해 세션 화면 → 돌아오면 자리 그대로
  if (mp.scrollMax > 0) { await pg.evaluate(() => { const s = document.querySelector('[data-role=pm-scroll]'); s.scrollTop = Math.min(80, s.scrollHeight - s.clientHeight); s.dispatchEvent(new Event('scroll')); }); await sleep(400); mp = await pg.evaluate(PROBE_MAP); }
  const before = { scroll: mp.scroll, top: row('p87-help').top };
  await tapSel(pg, '[data-role=pm-row][data-name="p87-help"]');
  await pg.waitForFunction(() => document.querySelector('[data-role=phone]').dataset.view === 'session', null, { timeout: 10000 }).catch(() => {});
  await sleep(2500);
  const sv = await view(pg);
  const nameNow = await pg.evaluate(() => (document.querySelector('.mt-ph-shead') || {}).textContent || '');
  check(`[${E}] 미션 맵에서 노드를 탭하면 그 세션 화면`, sv === 'session' && /p87-help/.test(nameNow), { view: sv, head: nameNow.slice(0, 60) });
  await shot(pg, `${E}-03-session`);
  await tapSel(pg, '[data-action=phone-back]');
  await pg.waitForFunction(() => document.querySelector('[data-role=phone]').dataset.view === 'mission', null, { timeout: 10000 }).catch(() => {});
  await sleep(800);
  mp = await pg.evaluate(PROBE_MAP);
  check(`[${E}] 뒤로 단추 → 미션 맵, 자리 그대로(스크롤, 줄 위치)`, (await view(pg)) === 'mission' && mp.scroll === before.scroll && row('p87-help').top === before.top, { before, after: { scroll: mp.scroll, top: row('p87-help').top } });
  await shot(pg, `${E}-04-back`);
  await tapSel(pg, '[data-role=pm-row][data-name="p87-rev"]');
  await pg.waitForFunction(() => document.querySelector('[data-role=phone]').dataset.view === 'session', null, { timeout: 10000 }).catch(() => {});
  await sleep(1500);
  await pg.goBack().catch(() => {}); await sleep(1000);
  check(`[${E}] 브라우저 뒤로 가기도 미션 맵으로`, (await view(pg)) === 'mission', await view(pg));
  await tapSel(pg, '[data-action=phone-mission-back]'); await sleep(800);
  check(`[${E}] 미션 맵의 뒤로 → 목록`, (await view(pg)) === 'list', await view(pg));
  await pg.evaluate(() => window.__mtPhone.mission()); await sleep(1500);
  await shot(pg, `${E}-05-mission-again`);
  await pg.evaluate(() => window.__mtPhone.list && history.back()); await sleep(800);

  // 4. 죽음 기록은 한 번만
  const t1 = Date.now();
  const crash = async (label) => {
    if (E === 'chromium') cdp.send('Page.crash').catch(() => {});
    else for (const pid of webkitPids()) try { process.kill(pid); } catch {}
    await new Promise((r) => { pg.once('crash', r); setTimeout(r, 6000); });
    await pg.close().catch(() => {});
    ({ pg, cdp } = await open(label));
    await pg.goto(`${base}/`); await loadedOpen(pg); await splashGone(pg); await sleep(3500);
    return pg.evaluate(PROBE_LIST);
  };
  await sleep(2500); // 살아 있다는 기록이 한 번 적히게
  p = await crash('crash-1');
  let boots = bootLog().filter((e) => e.at >= t1 - 1000 && e.event === 'boot');
  check(`[${E}] 죽은 뒤 다시 열면 목록, boot 줄 하나(bootId 있음)`, p.view === 'list' && !p.light && boots.length === 1 && Number.isFinite(boots[0].bootId), { view: p.view, boots: boots.map((b) => ({ bootId: b.bootId, light: b.light, view: b.crash && b.crash.view })) });
  const crumbs = await pg.evaluate(() => JSON.parse(localStorage.getItem('mt.crumbs') || '{}'));
  check(`[${E}] 알린 기록을 기기에 적는다(sent = 죽은 페이지의 부팅 시각)`, crumbs.sent === boots[0].bootId, { sent: crumbs.sent, bootId: boots[0].bootId });
  // 답을 받기 전에 끊겼다 다시 붙은 것처럼: 새 연결에서 같은 id로 다시 보낸다 → 한 줄 그대로
  await pg.evaluate(() => window.__mt.api.ws.close()); await loadedOpen(pg); await sleep(1500);
  const dup = await pg.evaluate((id) => window.__mt.api.call('web.boot', { crashed: true, id, light: false, crash: { view: 'list' } }), boots[0].bootId).catch((e) => ({ err: e.message }));
  await pg.reload(); await loadedOpen(pg); await splashGone(pg); await sleep(2500); // 정상 다시 읽기는 죽음이 아니다
  boots = bootLog().filter((e) => e.at >= t1 - 1000 && e.event === 'boot');
  check(`[${E}] 다시 붙은 연결이 같은 기록을 보내도, 정상으로 다시 읽어도 boot 줄은 하나`, boots.length === 1 && dup && dup.dup === true, { dup, n: boots.length });
  // 1분 안에 두 번 죽음: 가벼운 화면이 되어도 휴대폰은 목록 그대로, 안내·보드로 다시 열기 없음
  await sleep(2500);
  p = await crash('crash-2');
  boots = bootLog().filter((e) => e.at >= t1 - 1000 && e.event === 'boot');
  check(`[${E}] 두 번째 죽음: boot 줄 둘(서로 다른 bootId), 휴대폰은 목록·안내 없음·보드 단계 없음`, boots.length === 2 && boots[0].bootId !== boots[1].bootId && p.view === 'list' && !p.light && p.toBoard === 0 && !p.lite, { n: boots.length, ids: boots.map((b) => b.bootId), light: p.crash.light, view: p.view, toBoard: p.toBoard });
  await shot(pg, `${E}-06-after-crash`);
  m.boots = boots.map((b) => ({ bootId: b.bootId, light: !!b.light, crash: b.crash }));
  await ctx.close();
}

// ---- 데스크톱 웹 보드의 대화 보기(session.messages) 양(재기만) ----
async function desktop(browser, base) {
  const ctx = await browser.newContext(DESK);
  await ctx.addInitScript(WS_HOOK);
  const pg = await ctx.newPage();
  await pair(pg, base);
  await pg.goto(`${base}/`); await loadedOpen(pg); await splashGone(pg);
  const out = { scenes: {} };
  const take = async (name, setup) => {
    const t0 = await nowIn(pg);
    if (setup) await pg.evaluate(setup);
    await sleep(8000);
    const r = await pg.evaluate((t) => window.__p87.recv.filter((x) => x.t >= t), t0);
    const sm = r.filter((x) => x.k === 'r:session.messages');
    const faces = await pg.evaluate(() => [...document.querySelectorAll('.mt-node[data-face]')].map((e) => `${e.dataset.name}:${e.dataset.face}`).join(' '));
    out.scenes[name] = { calls: sm.length, bytes: sm.reduce((a, x) => a + x.b, 0), max: Math.max(0, ...sm.map((x) => x.b)), msgs: sm.map((x) => x.n), shownB: sm.reduce((a, x) => a + (x.shownB || 0), 0), toolB: sm.reduce((a, x) => a + (x.toolB || 0), 0), all: r.reduce((a, x) => a + x.b, 0), faces };
    log(`[desktop ${name}] ${JSON.stringify(out.scenes[name])}`);
  };
  await sleep(8000);
  { // 페이지를 연 때부터(첫 그리기의 대화 보기 포함)
    const r = await pg.evaluate(() => window.__p87.recv);
    const sm = r.filter((x) => x.k === 'r:session.messages');
    const sentM = await pg.evaluate(() => window.__p87.sent.filter((x) => x.m === 'session.messages').length);
    const faces = await pg.evaluate(() => [...document.querySelectorAll('.mt-node[data-face]')].map((e) => `${e.dataset.name}:${e.dataset.face}`).join(' '));
    out.scenes.load = { sent: sentM, calls: sm.length, bytes: sm.reduce((a, x) => a + x.b, 0), sizes: sm.map((x) => x.b), msgs: sm.map((x) => x.n), shownB: sm.reduce((a, x) => a + (x.shownB || 0), 0), toolB: sm.reduce((a, x) => a + (x.toolB || 0), 0), all: r.reduce((a, x) => a + x.b, 0), faces, chat: await pg.evaluate(() => document.querySelectorAll('.mt-chat').length) };
    log(`[desktop load] ${JSON.stringify(out.scenes.load)}`);
  }
  await take('open', null);
  await take('fit-all', () => window.__mt.getState().fitAll());
  const node = await pg.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p87-rev'); return s ? window.__mt.getState().nodes.get(s.sessionId) : null; });
  for (const z of [0.35, 0.6]) await take(`zoom-${z}`, `(() => { const r = ${JSON.stringify(node)}; window.__mt.getState().setViewport({ x: 200 - r.x * ${z}, y: 200 - r.y * ${z}, zoom: ${z} }); })()`);
  // 일하는 노드의 상태가 바뀔 때마다 다시 받는지: 20초 동안
  const t0 = await nowIn(pg);
  await sleep(20000);
  const again = await pg.evaluate((t) => window.__p87.recv.filter((x) => x.t >= t && x.k === 'r:session.messages').length, t0);
  out.idle20s = again;
  log(`[desktop] 가만히 20초 동안 session.messages ${again}번`);
  await pg.screenshot({ path: path.join(OUT, 'desktop-board.png') });
  metrics.desktop = out;
  await ctx.close();
}

let sim;
const browsers = [];
try {
  await setupBoard();
  sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  try { atrium('input', 'p87-sh-c', 'exit\\r'); } catch {} // 끝난 세션(물러남)
  await stir();
  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const chromeExe = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  const BASE = `http://localhost:${B0.sim}`;
  if (process.env.P87_ONLY_DESKTOP === '1') { const b = await chromium.launch({ headless: true, ...(chromeExe ? { executablePath: chromeExe } : { channel: 'chromium' }) }); browsers.push(b); await desktop(b, BASE); ENGINES.length = 0; }
  for (const engine of ENGINES) {
    const browser = engine === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ headless: true, ...(chromeExe ? { executablePath: chromeExe } : { channel: 'chromium' }) });
    browsers.push(browser);
    try { await phone(engine, browser, BASE); } catch (e) { check(`[${engine}] 휴대폰 시험이 끝까지 돌았다`, false, e.stack || e.message); }
    if (engine === 'chromium' && process.env.P87_DESKTOP !== '0') try { await desktop(browser, BASE); } catch (e) { check('데스크톱 보드 재기가 끝까지 돌았다', false, e.stack || e.message); }
    await browser.close().catch(() => {});
    browsers.pop();
  }
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  if (sim) await sim.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, `p87-phone-${ENGINES.join('+')}.json`), JSON.stringify({ results, metrics }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
