// P163 창 시험: 세션 맵(PC·휴대폰)에서 하위가 셋 이상인 리드 아래 절전 하위가 얇은 줄로 줄어드는지. 바꾸기 전·후 그림과 높이를 남긴다.
// 판: 따로 띄운 개발용 판(atrium-dev-p163, 47932, backend/.dev)만 쓴다. 창 원격 디버깅 포트 9412, 휴대폰 흉내 프록시 47997. 한 번에 한 창·브라우저만(메모리).
//   셸 세션 하나(p163-a, 시험 폴더 C:\Workspace\mtask-p163-a)만 실제로 띄운다. 맵은 페이지 안에서 mission.graph 답과 판의 워크스페이스·폴더를 흉내로 바꾼다(P153·P160과 같은 흉내).
//   흉내 모양: 리드 하나에 하위 7개(절전 5, 작업 중 1, 응답 필요 1) + 견줄 리드(하위 2개, 둘 다 절전 = 카드로 남는다). 첫 세션(절전 하위 w-sleep-1)은 실제 셸 id라 더블클릭으로 판에 간다.
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p163-thin.mjs <setup|pc|phone|stop> [before|after]
//   pc: 1584×921, 움직임 줄이기. 리드 아래 하위 묶음 높이(세계·화면)와 그림. after면 얇은 줄의 미리 보기·누르기 태그·Alt+끌기·더블클릭도 본다.
//   phone: iPhone 폭(393), 움직임 줄이기. 리드부터 마지막 하위까지 높이와 그림. after면 얇은 줄 길게 누르기 미리 보기·한 번 누르기 = 세션 화면.
// 결과는 워크트리의 experiments/p163/<before|after>/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const TAG = process.argv[3] || 'after';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p163', TAG);
const CONVOS = path.join(REPO, 'experiments', 'p163', 'convos');
const DIR = process.env.P163_DIR || 'C:\\Workspace\\mtask-p163-a';
// P166: 다른 워커의 판에서 돌릴 때 P163_BOARD(atrium-dev-<이름>)·P163_PORT·P163_DEBUG·P163_SIM·P163_DIR로 덮는다
const BOARD = `atrium-dev-${process.env.P163_BOARD || 'p163'}`, PORT = process.env.P163_PORT || '47932', DEBUG = process.env.P163_DEBUG || '9412', SIM = Number(process.env.P163_SIM || 47997);
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k];
process.env.MT_E2E_OUT = path.relative(path.join(REPO, 'experiments'), OUT);
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A } = L;
const ENV = {
  ATRIUM_TERMINAL_SESSION: BOARD, ATRIUM_HERDR_SESSION: BOARD, ATRIUM_PORT: PORT,
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p163-none-',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: PORT,
  ATRIUM_WEB_HOSTS: `${NAME}:${SIM},localhost:${SIM}`,
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const chromeExe = (() => { const d = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'); try { return fs.readdirSync(d).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse().map((x) => path.join(d, x, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
const log = logger(`p163-${WHAT}-${TAG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [], facts = {};
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const AFTER = TAG === 'after';
const AWAKE = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];

// ---- 흉내 모양(지어낸 이름) ----
const W1 = 'c:/work/thin-lab/.git', W2 = 'c:/work/pair-lab/.git';
const ss = (name, workspace, o = {}) => ({ name, workspace, parent: null, kind: 'claude', model: 'claude-haiku-5-5', effort: null, st: 'ready', ...o });
const SHAPE = {
  folders: [{ id: 'g1', name: 'Lab', members: [W1, W2] }],
  workspaces: [{ key: W1, kind: 'repo', root: 'c:/work/thin-lab' }, { key: W2, kind: 'repo', root: 'c:/work/pair-lab' }],
  sessions: [
    ss('w-sleep-1', W1, { parent: 'lead', st: 'sleeping', task: 'Collect the source tables', ago: 9e6 }), // 0 = 실제 셸 id
    ss('lead', W1, { st: 'ready', model: 'claude-opus-5-5', effort: 'high', task: 'Split the release into worker tasks', ago: 6e5 }),
    ss('w-build', W1, { parent: 'lead', st: 'working', task: 'Build the installer', ago: 2e5 }),
    ss('w-ask', W1, { parent: 'lead', st: 'needs', task: 'Allow npm ci in the worktree?', ago: 3e5 }),
    ss('w-sleep-2', W1, { parent: 'lead', st: 'sleeping', task: 'Draft the slide notes', ago: 8e6 }),
    ss('w-sleep-3', W1, { parent: 'lead', st: 'sleeping', task: 'Review the parser diff', ago: 7e6 }),
    ss('w-sleep-4', W1, { parent: 'lead', st: 'sleeping', task: 'Tidy the glossary', ago: 6e6 }),
    ss('w-sleep-5', W1, { parent: 'lead', st: 'sleeping', task: 'Fix the citation format', ago: 5e6 }),
    ss('pair-lead', W2, { st: 'ready', task: 'Compare two caching options', ago: 4e6 }),
    ss('pair-a', W2, { parent: 'pair-lead', st: 'sleeping', task: 'Measure option A', ago: 9e6 }),
    ss('pair-b', W2, { parent: 'pair-lead', st: 'sleeping', task: 'Measure option B', ago: 9e6 }),
  ],
};
SHAPE.links = SHAPE.sessions.filter((s) => s.parent).map((s) => ({ src: s.parent, dst: s.name, role: 'worker', spawned: true, observed: true, count: 2 }));
const KIDS = SHAPE.sessions.filter((s) => s.parent === 'lead').map((s) => s.name);
const SLEEP = SHAPE.sessions.filter((s) => s.parent === 'lead' && s.st === 'sleeping').map((s) => s.name);

const HOOK = ([shape, real]) => {
  const api = window.__mt.api, st = window.__mt.getState();
  if (!api.__p163orig) { api.__p163orig = api.call.bind(api); window.__p163st = { workspaces: st.workspaces, groups: st.groups }; window.__p163calls = []; }
  const now = Date.now();
  st.workspaces = shape.workspaces.map((w, i) => ({ key: w.key, name: w.root.split('/').pop(), kind: w.kind, root: w.root, createdAt: 1e12 + i, counts: {}, worktrees: [] }));
  st.groups = shape.folders.map((f) => ({ id: f.id, name: f.name, members: [...f.members] }));
  const MAP = { needs: ['waiting', 'needs_you'], error: ['error', 'needs_you'], working: ['working', 'working'], done: ['ready', 'done'], ready: ['ready', 'idle'], sleeping: ['sleeping', 'idle'], exited: ['exited', 'exited'] };
  const nodes = shape.sessions.map((s, i) => {
    const [state, category] = MAP[s.st];
    return { id: `s:${s.name}`, kind: 'session', sessionId: i === 0 && real ? real : `fk-${s.name}`, name: s.name, agentKind: s.kind, state, category, workspaceKey: s.workspace,
      parentId: s.parent ? `s:${s.parent}` : null, lineageParent: s.parent ? `s:${s.parent}` : null, peers: [], role: null, order: null, createdAt: 1e12 + i, loops: 0, model: s.model, effort: s.effort,
      activeAt: now - s.ago, turnAt: state === 'working' ? now - s.ago : null, closedKids: 0, assignAt: null, parentClosed: false, gitBranch: null, ask: s.st === 'needs' ? s.task : null, error: null, lastPrompt: s.task };
  });
  const edges = [];
  for (const l of shape.links) { const b = { from: `s:${l.src}`, to: `s:${l.dst}`, count: l.count, lastAt: now - 6e5 }; edges.push({ ...b, kind: 'role', label: l.role }, { ...b, kind: 'prompt', label: 'report back when done' }, { ...b, kind: 'spawn' }); }
  api.call = async (m, p) => {
    if (m === 'relation.set') { window.__p163calls.push(p); return { ok: true }; }
    if (m !== 'mission.graph') return api.__p163orig(m, p);
    return { nodes: [{ id: 'human', kind: 'human', name: 'you' }, ...nodes], edges, counts: { all: nodes.length }, at: now };
  };
};
const ASLEEP = (real) => { const s = window.__mt.getState().sessions.get(real); if (s) s.state = 'sleeping'; };
const realId = (pg) => pg.evaluate(() => ([...window.__mt.getState().sessions.values()].find((s) => s.name === 'p163-a') || {}).sessionId || null);
const shot = (pg, name, clip) => pg.screenshot({ path: path.join(OUT, `${name}.png`), ...(clip ? { clip } : {}) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));

async function setupBoard() {
  fs.mkdirSync(DIR, { recursive: true });
  log(atrium('backend', 'start').trim().slice(0, 300));
  const have = new Set(call('session.list').map((s) => s.name));
  if (!have.has('p163-a')) log(atrium('--json', 'spawn', DIR, '--kind', 'shell', '--name', 'p163-a').slice(0, 160));
  await sleep(2000);
}

async function closeMission(pg) { for (let i = 0; i < 3 && (await pg.$('[data-role="mission"]')); i++) { await pg.keyboard.press('Escape'); await sleep(400); } }
async function openMission(pg) {
  await closeMission(pg);
  await pg.click('[data-action="mission-rail"]');
  await pg.waitForSelector('[data-role="mission"] .mt-ta-card', { timeout: 20000 });
  await sleep(1200);
}

async function pc() {
  call('settings.set', { key: 'missionStyle', value: 'territories' });
  const { app, page } = await launch({ log, env: { ...ENV }, args: [`--remote-debugging-port=${DEBUG}`, ...AWAKE] });
  try {
    await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x)); const b = w.getBounds(); w.setPosition(left - b.width - 200, 40); }).catch(() => {});
    await page.setViewportSize({ width: 1584, height: 921 }).catch(() => {});
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sleep(2500);
    if (await page.$('[data-role="sidebar"]')) { await page.click('[data-action="sidebar"]'); await sleep(500); }
    const real = await realId(page);
    check('실제 셸 세션(p163-a)이 판에 있다', !!real, { real });
    // 첫 세션(w-sleep-1)은 실제 셸이라 창은 판의 실제 상태를 쓴다. 셸은 절전이 없어 페이지 안 상태만 절전으로 둔다(더블클릭으로 판에 가는 얇은 줄)
    await page.evaluate(ASLEEP, real);
    await page.evaluate(HOOK, [JSON.parse(JSON.stringify(SHAPE)), real]);
    await openMission(page);
    await page.evaluate(() => window.__mtTa.fit()); await sleep(600);
    await shot(page, 'pc-fit');
    // 리드 아래 하위 묶음 높이(세계 단위)와 줄 높이
    const geo = await page.evaluate(([kids]) => {
      const lay = window.__mtTa.lay();
      const ks = kids.map((n) => lay.cards.get(`s:${n}`)).filter(Boolean);
      const top = Math.min(...ks.map((k) => k.y)), bot = Math.max(...ks.map((k) => k.y + k.h));
      const row = lay.rows.find((r) => r.key === ks[0].ws);
      return { span: Math.round(bot - top), row: Math.round(row.h), world: Math.round(lay.bounds.h), order: [...(lay.vkids.get('s:lead') || [])].map((x) => x.slice(2)), thin: [...document.querySelectorAll('.mt-ta-slot.thin')].map((x) => x.dataset.id.slice(2)), heights: Object.fromEntries(ks.map((k) => [k.node.name, Math.round(k.h)])), k: window.__mtTa.view().k };
    }, [KIDS]);
    facts.pc = geo;
    log(`PC 하위 묶음 높이 ${geo.span}, 줄 ${geo.row}, 세계 ${geo.world}, 차례 ${geo.order.join(',')}, 얇은 줄 ${geo.thin.join(',')}`);
    // 하위 묶음에 맞춰 보통 배율(0.85)로 보기
    await page.evaluate(() => { const lay = window.__mtTa.lay(); const r = lay.rows[0]; window.__mtTa.set({ k: 0.85, x: window.__mtTa.rail + 16 - (lay.headx - 20) * 0.85, y: window.__mtTa.top + 8 - r.y * 0.85 }); }); await sleep(700);
    await shot(page, 'pc-team');
    if (!AFTER) { check('바꾸기 전: 얇은 줄 없음', geo.thin.length === 0, geo.thin); return; }
    check('하위 7개 중 절전 5개만 얇은 줄, 견줄 리드(하위 2개)의 절전 하위는 카드', geo.thin.length === 5 && SLEEP.every((n) => geo.thin.includes(n)) && !geo.thin.some((n) => n.startsWith('pair')), geo.thin);
    check('얇은 줄 높이 30, 깨어 있는 카드 아래로 모임', SLEEP.every((n) => geo.heights[n] === 30) && geo.order.slice(0, 2).every((n) => !SLEEP.includes(n)) && geo.order.slice(2).every((n) => SLEEP.includes(n)), geo);
    const sel = (n) => `.mt-ta-slot[data-id="s:${n}"] .mt-ta-card`;
    const center = (n) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; }, sel(n));
    // 미리 보기
    let c = await center('w-sleep-3');
    await page.mouse.move(c.x, c.y); await sleep(1500);
    const pk = await page.evaluate(() => { const p = document.querySelector('[data-role=ln-peek]'); return p ? { text: p.innerText.slice(0, 200), asleep: !!p.querySelector('[data-role=ln-peek-asleep]') } : null; });
    await shot(page, 'pc-thin-peek');
    check('얇은 줄에 마우스를 올리면 미리 보기(저장된 정보)', !!pk && /w-sleep-3/.test(pk.text), pk);
    await page.mouse.move(5, 300); await sleep(300);
    // 누르기 = 명령줄 @태그
    const cmd = () => page.evaluate(() => (document.querySelector('[data-role=command]') || {}).value || '');
    await page.click(sel('w-sleep-3')); await sleep(400);
    const tagged = await page.evaluate(() => [...document.querySelectorAll('.mt-ta-slot.tagged')].map((x) => x.dataset.id));
    const c1 = await cmd();
    await shot(page, 'pc-thin-tagged');
    check('얇은 줄 누르기 → 명령줄 @태그, 태그 표시', /@w-sleep-3/.test(c1) && tagged.includes('s:w-sleep-3'), { c1, tagged });
    await page.click(sel('w-sleep-3')); await sleep(300);
    check('다시 누르면 태그가 빠진다', !/@w-sleep-3/.test(await cmd()));
    // Alt+끌기: 얇은 줄을 잡아 견줄 리드(pair-lead) 오른쪽에 놓으면 relation.set(sub)
    c = await center('w-sleep-4');
    const pl = await page.evaluate(() => { const r = document.querySelector('.mt-ta-slot[data-id="s:pair-lead"] .mt-ta-card').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom + 14 }; });
    const to = { x: pl.x, y: pl.y }; // 견줄 리드 바로 아래 = 그 리드의 동료
    await page.keyboard.down('Alt'); await page.mouse.move(c.x, c.y); await page.mouse.down();
    for (let i = 1; i <= 15; i++) { await page.mouse.move(c.x + (to.x - c.x) * i / 15, c.y + (to.y - c.y) * i / 15); await sleep(16); }
    const moving = await page.evaluate(() => !!document.querySelector('.mt-ta-slot.moving'));
    await shot(page, 'pc-thin-drag');
    await page.mouse.up(); await page.keyboard.up('Alt'); await sleep(500);
    const calls = await page.evaluate(() => window.__p163calls);
    check('얇은 줄 Alt+끌기 → 관계 바꾸기(relation.set, pair-lead 바로 아래 = 동료)', moving && calls.some((x) => x.relation === 'peer' && x.a === 'fk-pair-lead' && x.b === 'fk-w-sleep-4'), { moving, calls });
    // 더블클릭 = 판의 그 세션(실제 셸)
    await page.evaluate(() => { const el = document.querySelector('[data-role=command]'); if (el) { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); } });
    if (!(await page.$('[data-role=mission]'))) await openMission(page);
    await page.evaluate(() => window.__mtTa.flyTo('s:w-sleep-1', 0.9)); await sleep(900);
    await page.dblclick(sel('w-sleep-1')); await sleep(1500);
    const board = await page.evaluate(() => ({ open: !!document.querySelector('[data-role=mission]'), focus: (window.__mt.getState().focusId || window.__mt.getState().selected || null) }));
    await shot(page, 'pc-thin-dblclick');
    check('얇은 줄 더블클릭 → 세션 맵 닫고 판으로', !board.open, board);
  } finally { await closeApp(app); }
}

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
async function phone() {
  const pw = await import('playwright');
  const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
  const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
  const sim = startTsSim({ listen: SIM, target: Number(PORT), name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const browser = await pw.chromium.launch({ headless: true, ...(chromeExe ? { executablePath: chromeExe } : {}) });
  try {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, screen: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: SAFARI, locale: 'en-US', reducedMotion: 'reduce' });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
    await pg.goto(`http://localhost:${SIM}/`);
    await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
    await pg.fill('[data-field=pair-code]', call('device.code').code);
    await pg.click('[data-action=pair-submit]');
    await pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: 60000 });
    await sleep(1200);
    const real = await realId(pg);
    await pg.evaluate(HOOK, [JSON.parse(JSON.stringify(SHAPE)), real]);
    await pg.evaluate(ASLEEP, real);
    await pg.evaluate(() => { try { localStorage.removeItem('atrium.phoneMap.expanded'); localStorage.removeItem('atrium.phoneMap.view'); } catch {} window.__mtPhone.mission(); });
    // P166: 휴대폰 세션 맵은 PC와 같은 무한 캔버스(PhoneMap.jsx). 자리·높이는 세계 단위(배치 lay), 얇은 줄은 DOM에서
    await pg.waitForSelector('.mt-pmap .mt-ta-card', { timeout: 20000 });
    await sleep(1200);
    const geo = await pg.evaluate(([kids]) => {
      const L = window.__mtPm.lay(), box = (n) => L.cards.get(`s:${n}`);
      const lead = box('lead'), ks = kids.map(box);
      const items = [...L.cards.entries()].filter(([, c]) => c.ws === lead.ws).sort((a, b) => a[1].x - b[1].x || a[1].y - b[1].y).map(([id]) => id.slice(2));
      return { span: Math.round(Math.max(...ks.map((r) => r.y + r.h)) - lead.y), list: Math.round(L.bounds.h), order: items, thin: [...document.querySelectorAll('.mt-pmap .mt-ta-slot[data-thin="1"]')].map((x) => x.querySelector('.mt-ta-card').dataset.name), heights: Object.fromEntries(kids.map((n, i) => [n, Math.round(ks[i].h)])) };
    }, [KIDS]);
    facts.phone = geo;
    log(`휴대폰 리드~마지막 하위 ${geo.span}(세계), 맵 높이 ${geo.list}, 차례 ${geo.order.join(',')}, 얇은 줄 ${geo.thin.join(',')}`);
    await shot(pg, 'phone-open');
    await pg.screenshot({ path: path.join(OUT, 'phone-full.png'), fullPage: true }).catch(() => {});
    if (!AFTER) { check('바꾸기 전: 얇은 줄 없음', geo.thin.length === 0, geo.thin); return; }
    check('휴대폰: 절전 5개만 얇은 줄(높이 30), 견줄 리드의 하위는 카드, 깨어 있는 카드 아래로 모임', geo.thin.length === 5 && SLEEP.every((n) => geo.thin.includes(n) && geo.heights[n] === 30) && geo.order.indexOf('w-ask') < geo.order.indexOf('w-sleep-1'), geo);
    // 길게 누르기 = 미리 보기
    const cdp = await ctx.newCDPSession(pg);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    const at = async (n) => { await pg.evaluate((x) => window.__mtPm.goTo(`s:${x}`), n); await sleep(700); return pg.evaluate((x) => { const r = document.querySelector(`.mt-pmap .mt-ta-card[data-name="${x}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, n); };
    let p = await at('w-sleep-3'); await sleep(300);
    await T('touchStart', [[p.x, p.y]]); await sleep(750); await T('touchEnd', []); await sleep(700);
    const pk = await pg.evaluate(() => ({ peek: !!document.querySelector('[data-role=pl-peek] [data-role=ln-peek]'), name: (document.querySelector('[data-role=pl-peek] .pk1 b') || {}).textContent || null }));
    await shot(pg, 'phone-thin-peek');
    check('휴대폰: 얇은 줄 길게 누르기 → 미리 보기', pk.peek && pk.name === 'w-sleep-3', pk);
    if (await pg.$('[data-action=pl-peek-close]')) { await pg.click('[data-action=pl-peek-close]'); await sleep(400); }
    p = await at('w-sleep-1'); await sleep(300);
    await pg.touchscreen.tap(p.x, p.y); await sleep(1500);
    const view = await pg.evaluate(() => document.querySelector('[data-role=phone]').dataset.view);
    await shot(pg, 'phone-thin-tap');
    check('휴대폰: 얇은 줄 한 번 누르기 → 그 세션 화면', view === 'session', { view });
    await ctx.close();
  } finally { await browser.close(); await sim.close?.(); }
}

async function stopBoard() {
  for (const s of call('session.list').filter((x) => /^p163-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
  await sleep(2000);
  try { log(atrium('terminal', 'stop', '--yes').slice(0, 200)); } catch (e) { log(`terminal stop ${e.message.slice(0, 120)}`); }
  try { log(atrium('backend', 'stop').slice(0, 200)); } catch (e) { log(`backend stop ${e.message.slice(0, 120)}`); }
}

try {
  if (WHAT === 'setup') await setupBoard();
  else if (WHAT === 'pc') await pc();
  else if (WHAT === 'phone') await phone();
  else if (WHAT === 'stop') await stopBoard();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, `p163-${WHAT}.json`), JSON.stringify({ results, facts }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
