// P166 창 시험: 휴대폰 세션 맵 = PC와 같은 무한 캔버스(PhoneMap.jsx, lineageLayout phone 배치). P160 세로 목록 시험(p160-phone.mjs)을 갈음한다.
// 판: 따로 띄운 개발용 판(atrium-dev-p166, 47935, backend/.dev)만 쓴다. 휴대폰 흉내 프록시 47986. 한 번에 한 브라우저만(메모리).
//   셸 세션 하나(p166-a, 시험 폴더 C:\Workspace\mtask-p166-a)만 실제로 띄운다. 맵은 페이지 안에서 mission.graph 답과 판의 워크스페이스·폴더를 흉내로 바꾼다(P153·P160과 같은 흉내).
//   흉내 모양: SHAPE_FAKE(지어낸 이름: 폴더 셋 + 폴더 밖, 하위 7개(절전 섞임)인 리드, 동료, 다른 워크스페이스 하위, 깊은 사슬, 셸). P166_SHAPE=<json>이면 그 모양(git 밖 실제 판 모양 흉내).
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p166-phone.mjs <setup|phone|perf|stop> [폴더 이름]
//   phone: 휴대폰 390×844(터치 흉내)에서 맞춤 보기·핀치·끌기·누르기·길게 누르기·알약·접기·시점 기억, Android·가로·태블릿(PC 맵)·WebKit 한 번.
//   perf: 휴대폰 폭 + CPU 느리게(CDP Emulation.setCPUThrottlingRate 4)에서 끌기·핀치 동안 프레임 간격.
// 결과는 워크트리의 experiments/p166/<폴더>/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const TAG = process.argv[3] || 'fake';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUTN = process.env.P166_OUT || 'p166';
const OUT = path.join(REPO, 'experiments', OUTN, TAG);
const CONVOS = path.join(REPO, 'experiments', OUTN, 'convos');
const DIR = process.env.P166_DIR || 'C:\\Workspace\\mtask-p166-a';
const BOARD = `atrium-dev-${process.env.P166_BOARD || 'p166'}`, PORT = process.env.P166_PORT || '47935', SIM = Number(process.env.P166_SIM || 47986);
const ME = process.env.P166_SESSION || 'p166-a';
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k];
process.env.MT_E2E_OUT = path.relative(path.join(REPO, 'experiments'), OUT);
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A } = L;
const ENV = {
  ATRIUM_TERMINAL_SESSION: BOARD, ATRIUM_HERDR_SESSION: BOARD, ATRIUM_PORT: PORT,
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p166-none-',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: PORT,
  ATRIUM_WEB_HOSTS: `${NAME}:${SIM},localhost:${SIM}`,
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
const chromeExe = (() => { try { return fs.readdirSync(pwDir).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse().map((x) => path.join(pwDir, x, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
const chromiumOpts = () => ({ headless: true, ...(chromeExe ? { executablePath: chromeExe } : {}) });
const log = logger(`p166-${WHAT}-${TAG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };

// ---- 흉내 모양(지어낸 이름): 폴더 셋 + 폴더 밖, 동료·독립·깊은 사슬·다른 워크스페이스·셸, 하위 7개(절전 섞임)인 pipe-lead ----
const ws = (key, kind = 'repo') => ({ key, kind, root: key.replace(/\/\.git$/, '') });
const ss = (name, workspace, o = {}) => ({ name, workspace, parent: null, kind: 'claude', asleep: false, term: 'idle', model: 'claude-opus-5-5', effort: 'high', ...o });
const ln = (src, dst, o = {}) => ({ src, dst, role: null, spawned: true, observed: true, count: 3, ...o });
const APP = 'c:/work/atrium-app/.git', DOCS = 'c:/work/atrium-docs/.git', MKT = 'd:/lab/market-lab/.git', PAPER = 'd:/lab/paper-notes/.git', PIPE = 'd:/lab/data-pipe/.git', DOT = 'c:/home/dotfiles/.git', BLOG = 'c:/home/blog/.git', BOX = 'c:/tmp/sandbox';
const SHAPE_FAKE = {
  folders: [{ id: 'g1', name: 'Product', members: [APP, DOCS] }, { id: 'g2', name: 'Research', members: [MKT, PAPER, PIPE] }, { id: 'g3', name: 'Personal', members: [DOT, BLOG] }],
  workspaces: [ws(APP), ws(DOCS), ws(MKT), ws(PAPER), ws(PIPE), ws(DOT), ws(BLOG), ws(BOX, 'folder')],
  sessions: [
    ss('conductor', APP, { st: 'working', task: 'Merge worker branches and run the release check', ago: 36e5 }),
    ss('parser', APP, { parent: 'conductor', st: 'working', task: 'Port the parser to the new API', branch: 'wt/parser', ago: 13e5 }),
    ss('fixtures', APP, { parent: 'parser', st: 'done', model: 'claude-haiku-5-5', effort: null, task: 'Generate parser fixtures', branch: 'wt/fixtures', ago: 9e5 }),
    ss('tests', APP, { parent: 'conductor', st: 'needs', model: 'claude-sonnet-5-5', task: 'Allow npm install in the worktree?', branch: 'wt/tests', ago: 5e5 }),
    ss('reviewer', APP, { st: 'working', kind: 'codex', model: 'gpt-6', effort: 'medium', task: 'Review the release diff', ago: 4e5 }),
    ss('reviewer-2', APP, { st: 'ready', kind: 'codex', model: 'gpt-6', effort: 'medium', task: 'Second look at the migration notes', ago: 6e5 }),
    ss('spinoff', APP, { parent: 'conductor', indep: true, st: 'ready', task: 'Prototype the export dialog', ago: 7e6 }),
    ss('hotfix', APP, { st: 'ready', task: 'Patch the crash on resume', ago: 72e5 }),
    ss('old-spike', APP, { st: 'exited', model: 'claude-sonnet-5-5', task: 'Try a canvas renderer', ago: 2.6e8 }),
    ss('docs-sync', DOCS, { parent: 'conductor', st: 'working', model: 'claude-sonnet-5-5', task: 'Update the API reference pages', ago: 7e5 }),
    ss('copyedit', DOCS, { st: 'sleeping', model: 'claude-haiku-5-5', effort: null, task: 'Tidy the glossary', ago: 8.6e7 }),
    ss('analyst', MKT, { st: 'needs', task: 'Which quarter should the report cover?', ago: 24e5 }),
    ss('scraper', MKT, { parent: 'analyst', st: 'error', kind: 'codex', model: 'gpt-6', effort: 'medium', task: 'Fetch the pricing pages', err: 'Rate limited (HTTP 429). Retry after 60 seconds.', ago: 11e5 }),
    ss('charts', MKT, { parent: 'analyst', st: 'working', model: 'claude-sonnet-5-5', task: 'Draw the share-of-market charts', ago: 5e5 }),
    ss('summary', MKT, { parent: 'analyst', st: 'done', model: 'claude-sonnet-5-5', task: 'Write the executive summary', ago: 19e5 }),
    ss('d1', MKT, { parent: 'charts', st: 'ready', task: 'Split the chart data by region', ago: 3e6 }),
    ss('d2', MKT, { parent: 'd1', st: 'ready', task: 'Clean the region table', ago: 3e6 }),
    ss('d3', MKT, { parent: 'd2', st: 'sleeping', task: 'Normalize the currency column', ago: 9e6 }),
    ss('d4', MKT, { parent: 'd3', st: 'sleeping', task: 'Check the rounding', ago: 9e6 }),
    ss('d5', MKT, { parent: 'd4', st: 'sleeping', task: 'Write the rounding test', ago: 9e6 }),
    ss('reader', PAPER, { st: 'ready', task: 'Summarize three papers on caching', ago: 1.1e7 }),
    ss('cite', PAPER, { st: 'sleeping', model: 'claude-haiku-5-5', effort: null, task: 'Fix the citation format', ago: 1.7e8 }),
    ss('pipe-lead', PIPE, { st: 'ready', task: 'Split the backfill into batches', ago: 36e5 }),
    ss('backfill', PIPE, { parent: 'pipe-lead', st: 'ready', kind: 'codex', model: 'gpt-6', effort: 'medium', task: 'Write tests for the sync module', branch: 'wt/backfill', ago: 15e5 }),
    ss('etl-shell', PIPE, { parent: 'pipe-lead', st: 'working', kind: 'shell', model: null, effort: null, task: 'npm run backfill -- --day 14', ago: 24e4 }),
    ...['batch-1', 'batch-2', 'batch-3', 'batch-4', 'batch-5'].map((n, i) => ss(n, PIPE, { parent: 'pipe-lead', st: i === 1 ? 'working' : 'sleeping', model: 'claude-haiku-5-5', effort: null, task: `Backfill day ${10 + i}`, ago: 4e6 + i * 1e5 })),
    ss('nvim', DOT, { st: 'sleeping', model: 'claude-sonnet-5-5', task: 'Move plugins to lazy loading', ago: 2.6e8 }),
    ss('draft', BLOG, { st: 'ready', model: 'claude-sonnet-5-5', task: 'Outline the November post', ago: 14e6 }),
    ss('scratch', BOX, { st: 'ready', kind: 'shell', model: null, effort: null, task: 'git log --oneline', ago: 36e5 }),
    ss('try-pi', BOX, { st: 'sleeping', model: 'claude-haiku-5-5', effort: null, task: 'Compare tool call formats', ago: 1.7e8 }),
  ],
  links: [],
  peers: [['reviewer', 'reviewer-2'], ['parser', 'tests']],
};
for (const s of SHAPE_FAKE.sessions) if (s.parent) SHAPE_FAKE.links.push(ln(s.parent, s.name, { role: s.name === 'summary' ? 'writer' : null, spawned: s.name !== 'charts', observed: s.name === 'charts' }));
const SHAPE_FILE = process.env.P166_SHAPE || '';
const SHAPE = SHAPE_FILE ? JSON.parse(fs.readFileSync(SHAPE_FILE, 'utf8')) : SHAPE_FAKE;
const MIX = SHAPE_FILE ? { waiting: [15, 2], error: [11], done: [9] } : { waiting: [], error: [], done: [] };

// ---- 페이지 안 흉내(P153·P160 창 시험과 같다): mission.graph 답과 판의 워크스페이스·폴더(store)를 바꾼다. real: 실제 셸 세션 id(첫 세션 카드에 쓴다) ----
const HOOK = ([shape, mix, real]) => {
  const api = window.__mt.api, st = window.__mt.getState();
  if (!api.__p166orig) api.__p166orig = api.call.bind(api);
  const now = Date.now();
  const nameOf = (root) => root.split('/').filter(Boolean).pop();
  st.workspaces = shape.workspaces.map((w, i) => ({ key: w.key, name: nameOf(w.root), kind: w.kind, root: w.root, createdAt: 1e12 + i, counts: {}, worktrees: [] }));
  st.groups = shape.folders.map((f) => ({ id: f.id, name: f.name, members: [...f.members] }));
  const asks = ['Allow npm ci in the worktree?', 'Which section should the summary cover?'];
  const nodes = shape.sessions.map((s, i) => {
    let state = s.asleep ? 'sleeping' : s.term === 'working' ? 'working' : 'ready', category = state === 'working' ? 'working' : 'idle', ask = null, error = null;
    if (!s.asleep && s.term === 'done') category = 'done';
    if (mix.waiting.includes(i)) { state = 'waiting'; category = 'needs_you'; ask = asks[mix.waiting.indexOf(i) % 2]; }
    if (mix.error.includes(i)) { state = 'error'; category = 'needs_you'; error = 'API Error: 529 overloaded. The server is busy, retry later.'; }
    if (mix.done.includes(i)) { state = 'ready'; category = 'done'; }
    if (s.st) { [state, category] = { needs: ['waiting', 'needs_you'], error: ['error', 'needs_you'], working: ['working', 'working'], done: ['ready', 'done'], ready: ['ready', 'idle'], sleeping: ['sleeping', 'idle'], exited: ['exited', 'exited'] }[s.st]; ask = s.st === 'needs' ? s.task : null; error = s.err || null; }
    return { id: `s:${s.name}`, kind: 'session', sessionId: i === 0 && real ? real : `fk-${s.name}`, name: s.name, agentKind: s.kind || 'claude', state, category, workspaceKey: s.workspace,
      parentId: s.parent && !s.indep ? `s:${s.parent}` : null, lineageParent: s.parent ? `s:${s.parent}` : null, peers: (shape.peers || []).filter((p) => p.includes(s.name)).map((p) => `s:${p[0] === s.name ? p[1] : p[0]}`), role: null, order: null, createdAt: 1e12 + i, loops: 0, model: s.model, effort: s.effort, activeAt: now - (i + 1) * 9e5, turnAt: state === 'working' ? now - (i + 1) * 2e5 : null,
      closedKids: s.closedKids || 0, assignAt: s.assignAt || null, parentClosed: !!s.parentClosed,
      gitBranch: s.branch || null, ask, error, lastPrompt: s.task || ['Merge the workers and run the release check', 'Draft the slide notes', 'Collect the source tables', 'Review the parser diff'][i % 4], ...(s.ago ? { activeAt: now - s.ago, turnAt: state === 'working' ? now - s.ago : null } : {}) };
  });
  const edges = [];
  for (const l of shape.links) {
    const pairOf = (p) => (p[0] === l.src && p[1] === l.dst) || (p[1] === l.src && p[0] === l.dst);
    const isPeer = (shape.peers || []).some(pairOf);
    const isNone = shape.sessions.some((s) => s.indep && s.parent && pairOf([s.parent, s.name]));
    const relation = isPeer ? 'peer' : isNone ? 'none' : undefined;
    const b = { from: `s:${l.src}`, to: `s:${l.dst}`, count: l.count || 0, lastAt: now - 6e5, ...(relation ? { relation, relationSource: 'user' } : {}) };
    if (l.role) edges.push({ ...b, kind: 'role', label: l.role });
    if (l.observed) edges.push({ ...b, kind: 'prompt', label: 'report back when done' });
    if (l.spawned) edges.push({ ...b, kind: 'spawn' });
  }
  for (const p of shape.peers || []) if (!shape.links.some((l) => (l.src === p[0] && l.dst === p[1]) || (l.src === p[1] && l.dst === p[0]))) edges.push({ from: `s:${p[0]}`, to: `s:${p[1]}`, kind: 'relation', relation: 'peer', relationSource: 'user', count: 0 });
  api.call = async (m, p) => {
    if (m !== 'mission.graph') return api.__p166orig(m, p);
    return { nodes: [{ id: 'human', kind: 'human', name: 'you' }, ...nodes], edges, counts: { all: nodes.length }, at: now };
  };
};

// ---- 맵 읽기 ----
const PROBE = () => {
  const root = document.querySelector('[data-role=phone-mission]'), vp = document.querySelector('.mt-pmap-vp');
  if (!root || !vp) return null;
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const V = vp.getBoundingClientRect();
  const cards = [...root.querySelectorAll('.mt-ta-card')];
  const lay = window.__mtPm.lay();
  const dock = [...root.querySelectorAll('.mt-pmap-dock .zb')].map(R);
  return {
    style: root.dataset.style, vp: R(vp), view: window.__mtPm.view(), level: (document.querySelector('.mt-ta-world') || {}).className,
    pages: lay && lay.pages, bounds: lay && lay.bounds, cw: lay && lay.cw,
    cards: cards.map((c) => ({ id: c.dataset.id, name: c.dataset.name, tier: c.dataset.tier, ...R(c) })),
    inside: cards.every((c) => { const r = c.getBoundingClientRect(); return r.left >= V.left - 1 && r.right <= V.right + 1 && r.top >= V.top - 1 && r.bottom <= V.bottom + 1; }),
    bands: [...root.querySelectorAll('[data-role=pm-fhead] .fn')].map((x) => x.textContent), rowsN: root.querySelectorAll('[data-role=pm-whead]').length,
    edges: root.querySelectorAll('[data-role=ta-edge]').length, cross: root.querySelectorAll('[data-role=ta-edge][data-cross="1"]').length, peers: root.querySelectorAll('.mt-ta-edge.k-peer').length,
    lights: root.querySelectorAll('[data-role=ta-light]').length, done: root.querySelectorAll('[data-role=mm-done]').length, thin: root.querySelectorAll('.mt-ta-slot[data-thin="1"]').length,
    folds: root.querySelectorAll('[data-action=ln-fold]').length, solos: root.querySelectorAll('[data-role=pm-solo-div]').length,
    pills: [...root.querySelectorAll('.mt-pl-pill')].map((x) => x.innerText.replace(/\s+/g, ' ')),
    dock, scrollX: document.documentElement.scrollWidth > innerWidth + 1, scale: window.visualViewport ? window.visualViewport.scale : 1,
    cmd: !!root.querySelector('.mt-cmd, [data-role=command-bar]'), sidebar: !!document.querySelector('[data-role=sidebar]'),
  };
};
const shot = (pg, name) => pg.screenshot({ path: path.join(OUT, `${name}.png`) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
const realId = (pg) => pg.evaluate((me) => ([...window.__mt.getState().sessions.values()].find((s) => s.name === me) || {}).sessionId || null, ME);
const viewOf = (pg) => pg.evaluate(() => document.querySelector('[data-role=phone]').dataset.view);
const near = (a, b, e = 1.5) => a && b && Math.abs(a.k - b.k) < 1e-3 && Math.abs(a.x - b.x) <= e && Math.abs(a.y - b.y) <= e;

async function setupBoard() {
  fs.mkdirSync(DIR, { recursive: true });
  log(atrium('backend', 'start').trim().slice(0, 300));
  const have = new Set(call('session.list').map((s) => s.name));
  if (!have.has(ME)) log(atrium('--json', 'spawn', DIR, '--kind', 'shell', '--name', ME).slice(0, 160));
  await sleep(2000);
}

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_A = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: SAFARI },
  android: { viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: CHROME_A },
  landscape: { viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: SAFARI },
  tablet: { viewport: { width: 820, height: 1180 }, screen: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD },
};

async function pair(pg) {
  await pg.goto(`http://localhost:${SIM}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await pg.fill('[data-field=pair-code]', call('device.code').code);
  await pg.click('[data-action=pair-submit]');
  await pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: 60000 });
  await sleep(1200);
}
async function openMap(pg, { clear = true } = {}) {
  await pg.evaluate(HOOK, [JSON.parse(JSON.stringify(SHAPE)), MIX, await realId(pg)]);
  // 다시 연 페이지가 세션 맵을 이미 띄웠으면(흉내 전에 실제 그래프를 받았다) 목록에 갔다가 다시 연다
  if ((await viewOf(pg)) === 'mission') { await pg.click('[data-action=phone-mission-back]'); await pg.waitForFunction(() => document.querySelector('[data-role=phone]').dataset.view === 'list', null, { timeout: 10000 }); }
  await pg.evaluate((c) => { if (c) try { localStorage.removeItem('atrium.phoneMap.expanded'); localStorage.removeItem('atrium.phoneMap.view'); } catch {} window.__mtPhone.mission(); }, clear);
  await pg.waitForSelector('.mt-pmap .mt-ta-card', { timeout: 20000 });
  await pg.waitForFunction((n) => document.querySelectorAll('.mt-pmap .mt-ta-card').length >= n, Math.min(5, SHAPE.sessions.length), { timeout: 20000 }).catch(async (e) => {
    log(`맵 상태 ${JSON.stringify(await pg.evaluate(() => ({ cards: document.querySelectorAll('.mt-pmap .mt-ta-card').length, hooked: !!window.__mt.api.__p166orig, view: document.querySelector('[data-role=phone]').dataset.view, n: (window.__mtPm.lay() || { cards: new Map() }).cards.size })))}`);
    throw e;
  });
  await sleep(1000);
}
async function openPhone(browser, dev, { reduce = false, locale = 'en-US' } = {}) {
  const ctx = await browser.newContext({ ...DEVICES[dev], locale, reducedMotion: reduce ? 'reduce' : 'no-preference' });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => log(`[${dev} pageerror] ${e.message}`));
  await pair(pg);
  await openMap(pg);
  return { ctx, pg };
}
// 진짜 터치(CDP Input.dispatchTouchEvent): 포인터 이벤트로 들어간다
const touch = async (ctx, pg) => {
  const cdp = await ctx.newCDPSession(pg);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  return {
    cdp, T,
    drag: async (x0, y0, x1, y1, n = 10, gap = 16) => { await T('touchStart', [[x0, y0]]); for (let i = 1; i <= n; i++) { await T('touchMove', [[x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]]); await sleep(gap); } await T('touchEnd', []); },
    pinch: async (cx, cy, d0, d1, n = 12, gap = 16) => { const at = (d) => [[cx - d / 2, cy], [cx + d / 2, cy]]; await T('touchStart', at(d0)); for (let i = 1; i <= n; i++) { await T('touchMove', at(d0 + (d1 - d0) * i / n)); await sleep(gap); } await T('touchEnd', []); },
    press: async (x, y, ms) => { await T('touchStart', [[x, y]]); await sleep(ms); await T('touchEnd', []); },
  };
};
const cardAt = (pg, name) => pg.evaluate((n) => { const c = document.querySelector(`.mt-pmap .mt-ta-card[data-name="${n}"]`); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 24), w: r.width, h: r.height, id: c.dataset.id }; }, name);
// 그 카드가 잘 보이게(카드로 가기 셈과 같다)
const focusCard = (pg, name) => pg.evaluate((n) => { const L = window.__mtPm.lay(); const id = [...L.cards.keys()].find((k) => L.cards.get(k).node.name === n); window.__mtPm.goTo(id); }, name);

async function phone() {
  const pw = await import('playwright');
  const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
  const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
  const sim = startTsSim({ listen: SIM, target: Number(PORT), name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const nSess = SHAPE.sessions.length;
  try {
    const browser = await pw.chromium.launch(chromiumOpts());
    try {
      // ---- 휴대폰 390×844: 처음 맞춤 → 핀치 → 끌기 → 누르기·길게 누르기 → 알약 → 접기 → 시점 기억 ----
      {
        const { ctx, pg } = await openPhone(browser, 'phone');
        const tt = await touch(ctx, pg);
        let p = await pg.evaluate(PROBE);
        await shot(pg, 'phone-fit');
        const fitWant = await pg.evaluate(() => window.__mtPm.fitView().k);
        check('[phone] 처음 = 맞춤 보기: 모든 카드가 맵 칸 안, 배율 = 맞춤, 캔버스(data-style=canvas)', p.style === 'canvas' && p.inside && Math.abs(p.view.k - fitWant) < 1e-3, { k: p.view.k, fitWant, inside: p.inside, bounds: p.bounds, pages: p.pages });
        const loose = SHAPE.workspaces.some((w) => !SHAPE.folders.some((g) => g.members.includes(w.key)));
        check(`[phone] PC와 같은 맵: 폴더 머리 ${SHAPE.folders.length}${loose ? '+1' : ''}, 워크스페이스 머리 ${SHAPE.workspaces.length}, 카드(접힌 것 빼고), 선, 빛, 가로 넘침 없음, 명령줄·사이드바 없음`, p.bands.length >= SHAPE.folders.length + (loose ? 1 : 0) && p.rowsN === SHAPE.workspaces.length && p.cards.length <= nSess && p.cards.length >= nSess - 6 && p.edges >= 5 && p.lights >= 1 && !p.scrollX && !p.cmd && !p.sidebar, { bands: p.bands, rows: p.rowsN, cards: p.cards.length, n: nSess, edges: p.edges, lights: p.lights, cmd: p.cmd, sidebar: p.sidebar });
        if (!SHAPE_FILE) check('[phone] 흉내 모양: 동료 선 2, 다른 워크스페이스 선 ≥ 1, 작업 완료 꼬리표 2, 얇은 줄(하위 7개 중 절전) 4, 깊이 접기 칩, 솔로 가름, 알약(응답 필요 둘·오류·작업 중·작업 완료)', p.peers === 2 && p.cross >= 1 && p.done === 2 && p.thin === 4 && p.folds >= 1 && p.solos >= 1 && p.pills.length >= 5, { peers: p.peers, cross: p.cross, done: p.done, thin: p.thin, folds: p.folds, solos: p.solos, pills: p.pills });
        check('[phone] 줌 단추는 손가락 크기(44px 이상)', p.dock.length === 3 && p.dock.every((b) => b.h >= 44 && b.w >= 44), p.dock);
        // 두 손가락 벌리기 = 확대(브라우저 확대는 아니다)
        const k0 = p.view.k;
        await tt.pinch(195, 420, 80, 300); await sleep(500);
        p = await pg.evaluate(PROBE);
        await shot(pg, 'phone-pinch');
        check('[phone] 두 손가락 벌리기 = 맵 확대(배율 3배 안팎), 페이지 확대·가로 넘침 없음, 세션 화면으로 가지 않음', p.view.k > k0 * 2.5 && p.view.k < k0 * 4.5 && p.scale === 1 && !p.scrollX && (await viewOf(pg)) === 'mission', { k0, k: p.view.k, scale: p.scale });
        await tt.pinch(195, 420, 300, 150); await sleep(400);
        const kIn = (await pg.evaluate(PROBE)).view.k;
        check('[phone] 두 손가락 오므리기 = 축소', kIn < p.view.k * 0.6, { from: p.view.k, to: kIn });
        // 한 손가락 끌기 = 시점 이동(카드 위에서 시작해도), 세션은 열리지 않는다
        const c1 = (await pg.evaluate(PROBE)).cards.find((c) => c.x > 20 && c.x + c.w < 370 && c.y > 250 && c.y + c.h < 650) || { x: 150, y: 400, w: 10, h: 10 };
        log(`끌기 시작 카드 ${c1.name || '(빈 곳)'}`);
        const v1 = (await pg.evaluate(PROBE)).view;
        await tt.drag(c1.x + c1.w / 2, c1.y + c1.h / 2, c1.x + c1.w / 2 - 60, c1.y + c1.h / 2 - 140); await sleep(500);
        const v2 = (await pg.evaluate(PROBE)).view;
        check('[phone] 한 손가락 끌기 = 시점 이동(카드 위에서 시작해도), 세션 화면으로 가지 않음', Math.abs(v2.x - v1.x + 60) < 3 && Math.abs(v2.y - v1.y + 140) < 3 && v2.k === v1.k && (await viewOf(pg)) === 'mission', { v1, v2 });
        // 알약 = 그 카드로 가서 반짝인다
        const pill = await pg.$('[data-role=pl-attn]');
        if (pill) {
          const id = await pill.getAttribute('data-id');
          await tt.T('touchStart', [[1, 1]]).catch(() => {}); await tt.T('touchEnd', []).catch(() => {});
          const pb = await pill.boundingBox();
          await pg.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2); await sleep(900);
          const r = await pg.evaluate((cid) => { const el = document.querySelector(`.mt-pmap .mt-ta-slot[data-id="${CSS.escape(cid)}"]`), v = document.querySelector('.mt-pmap-vp').getBoundingClientRect(); const b = el.getBoundingClientRect(); return { blink: el.classList.contains('blink'), inView: b.left >= v.left - 1 && b.right <= v.right + 1 && b.top >= v.top - 1 && b.bottom <= v.bottom + 1, w: Math.round(b.width) }; }, id);
          await shot(pg, 'phone-pill');
          check('[phone] 위 알약을 누르면 그 카드로 가서(화면 안, 읽히는 크기) 반짝인다', r.blink && r.inView && r.w >= 250, { id, ...r });
          const cnt = await pg.$('[data-role=pl-count][data-tier=work]');
          const seen = [];
          for (let i = 0; i < 3 && cnt; i++) { await cnt.scrollIntoViewIfNeeded(); const b = await cnt.boundingBox(); await pg.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await sleep(700); seen.push(await pg.evaluate(() => window.__mtPm.last())); }
          check('[phone] 작업 중 수 알약: 누를 때마다 다음 작업 중 카드', seen.length === 3 && new Set(seen).size === 3, seen);
        }
        // 길게 누르기 = 미리 보기(세션 화면으로 가지 않는다)
        const LP = SHAPE_FILE ? (SHAPE.sessions.find((s) => s.parent) || SHAPE.sessions[0]).name : 'tests'; // 길게 누를 카드
        await focusCard(pg, LP); await sleep(700);
        let at = await cardAt(pg, LP);
        await tt.press(at.x, at.y, 750); await sleep(600);
        const pk = await pg.evaluate(() => ({ peek: !!document.querySelector('[data-role=pl-peek] [data-role=ln-peek]'), name: (document.querySelector('[data-role=pl-peek] .pk1 b') || {}).textContent || null, view: document.querySelector('[data-role=phone]').dataset.view }));
        await shot(pg, 'phone-peek');
        check('[phone] 길게 누르면 미리 보기(PC와 같은 내용), 세션 화면으로 가지 않는다', pk.peek && pk.name === LP && pk.view === 'mission', pk);
        await pg.click('[data-action=pl-peek-close]'); await sleep(400);
        check('[phone] 미리 보기 닫기', !(await pg.$('[data-role=pl-peek]')));
        // 깊이 접기 칩 = 그 가지만 편다(세션 화면으로 가지 않음)
        const foldName = await pg.evaluate(() => { const b = document.querySelector('.mt-pmap [data-action=ln-fold]'); return b ? b.closest('.mt-ta-card').dataset.name : null; });
        if (foldName) {
          await focusCard(pg, foldName); await sleep(700);
          // 칩은 카드 오른쪽 바깥이라 화면 안으로 조금 끈다
          { const r = await (await pg.$('.mt-pmap [data-action=ln-fold]')).boundingBox(); if (r.x + r.width > 380) { await tt.drag(300, 500, 300 - (r.x + r.width - 330), 500); await sleep(500); } }
          const before = (await pg.evaluate(PROBE)).cards.length;
          const fb = await (await pg.$('.mt-pmap [data-action=ln-fold]')).boundingBox();
          await pg.touchscreen.tap(fb.x + fb.width / 2, fb.y + fb.height / 2); await sleep(900);
          const after = (await pg.evaluate(PROBE)).cards.length;
          await shot(pg, 'phone-unfold');
          check('[phone] "+n단계" 칩을 누르면 그 가지가 펴진다(카드 늘어남, 세션 화면으로 가지 않음)', after > before && (await viewOf(pg)) === 'mission', { foldName, before, after });
          const f2 = await pg.$('.mt-pmap [data-action=ln-fold].open'); if (f2) { const b2 = await f2.boundingBox(); await pg.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2); await sleep(600); }
        }
        // 시점 기억: 지금 보기 → 세션 화면 → 뒤로 → 그대로. 페이지를 다시 열어도 그대로
        await tt.pinch(195, 420, 120, 200); await sleep(300);
        await tt.drag(200, 500, 160, 420); await sleep(600);
        const mine = (await pg.evaluate(PROBE)).view;
        await focusCard(pg, SHAPE.sessions[0].name); await sleep(700);
        const mine2 = (await pg.evaluate(PROBE)).view;
        at = await cardAt(pg, SHAPE.sessions[0].name);
        await pg.touchscreen.tap(at.x, at.y); await sleep(1500);
        const opened = await viewOf(pg);
        await shot(pg, 'phone-session');
        check('[phone] 카드를 한 번 누르면 그 세션 화면', opened === 'session', { opened, mine });
        await pg.goBack().catch(() => {}); await sleep(1200);
        if ((await viewOf(pg)) !== 'mission') await pg.evaluate(() => window.__mtPhone.mission());
        await pg.waitForSelector('.mt-pmap .mt-ta-card', { timeout: 20000 }); await sleep(800);
        const back = (await pg.evaluate(PROBE)).view;
        check('[phone] 세션 화면에서 돌아오면 같은 시점', near(back, mine2, 2), { back, mine2 });
        await pg.reload(); await pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: 60000 }); await sleep(1000);
        await openMap(pg, { clear: false });
        const again = (await pg.evaluate(PROBE)).view;
        await shot(pg, 'phone-reopen');
        check('[phone] 페이지를 다시 열어도 이 기기에 기억한 시점 그대로', near(again, mine2, 2), { again, mine2 });
        const fit = await pg.$('[data-action=ta-fit]'); const fbx = await fit.boundingBox();
        await pg.touchscreen.tap(fbx.x + fbx.width / 2, fbx.y + fbx.height / 2); await sleep(700);
        const pf = await pg.evaluate(PROBE);
        check('[phone] 맞춤 단추 = 전체가 한 화면으로 되돌림', pf.inside && Math.abs(pf.view.k - fitWant) < 1e-3, { k: pf.view.k, fitWant });
        const zin = await (await pg.$('[data-action=ta-zoom-in]')).boundingBox();
        await pg.touchscreen.tap(zin.x + zin.width / 2, zin.y + zin.height / 2); await sleep(700);
        check('[phone] + 단추 = 확대', (await pg.evaluate(PROBE)).view.k > pf.view.k * 1.2);
        await ctx.close();
      }
      // ---- Android·가로: 맞춤 그림과 가로 화면 단 나누기 ----
      for (const dev of ['android', 'landscape']) {
        const { ctx, pg } = await openPhone(browser, dev);
        const p = await pg.evaluate(PROBE);
        await shot(pg, `${dev}-fit`);
        check(`[${dev}] 맞춤 보기: 모든 카드가 칸 안, 가로 넘침 없음 (단 ${p.pages})`, p.inside && !p.scrollX && p.cards.length >= nSess - 6, { pages: p.pages, k: p.view.k, bounds: p.bounds });
        if (dev === 'landscape') check('[landscape] 가로 화면은 단을 나눠 더 크게 들어간다', p.pages >= 2, { pages: p.pages });
        await ctx.close();
      }
      // ---- 태블릿(짧은 변 > 430px)은 판 화면이라 세션 맵도 PC 세션 맵(MissionLineage.jsx) ----
      {
        const ctx = await browser.newContext({ ...DEVICES.tablet, locale: 'en-US', reducedMotion: 'no-preference' });
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => log(`[tablet pageerror] ${e.message}`));
        await pair(pg);
        await pg.evaluate(HOOK, [JSON.parse(JSON.stringify(SHAPE)), MIX, await realId(pg)]);
        const view = await pg.evaluate(() => (document.querySelector('[data-role=phone]') ? 'phone' : 'board'));
        const rail = await pg.$('[data-action="mission-rail"]');
        if (rail) { await rail.click().catch(() => {}); await sleep(2000); }
        const map = await pg.evaluate(() => ({ pc: !!document.querySelector('[data-role=mission][data-layout=lineage]'), cards: document.querySelectorAll('.mt-ta-card').length, spine: document.querySelectorAll('.mt-sm-spine').length, scrollX: document.documentElement.scrollWidth > innerWidth + 1 }));
        await shot(pg, 'tablet-map');
        check('[tablet] 판 화면이고 세션 맵은 PC 세션 맵(왼쪽 폴더 기둥, 카드, 가로 넘침 없음)', view === 'board' && map.pc && map.cards > 0 && map.spine > 0 && !map.scrollX, { view, ...map });
        await ctx.close();
      }
      // 움직임 줄이기 한 장과 한국어 한 장
      { const { ctx, pg } = await openPhone(browser, 'phone', { reduce: true }); await shot(pg, 'phone-reduce'); await ctx.close(); }
      { const { ctx, pg } = await openPhone(browser, 'phone', { locale: 'ko-KR' }); await pg.evaluate(() => window.__mt.getState().setLanguage && window.__mt.getState().setLanguage('ko')).catch(() => {}); await sleep(600); await shot(pg, 'phone-ko'); await ctx.close(); }
    } finally { await browser.close(); }
    // ---- WebKit 한 번(iPhone): 맞춤·누르기 ----
    let wk = null;
    try { wk = await pw.webkit.launch({ headless: true }); } catch (e) { check('[webkit] 브라우저를 띄웠다', false, e.message.slice(0, 300)); }
    if (wk) {
      try {
        const { ctx, pg } = await openPhone(wk, 'phone');
        const p = await pg.evaluate(PROBE);
        await shot(pg, 'webkit-fit');
        check('[webkit] 맞춤 보기·카드·선, 가로 넘침 없음', p.inside && p.cards.length >= nSess - 6 && p.edges >= 5 && !p.scrollX, { cards: p.cards.length, edges: p.edges, k: p.view.k });
        await focusCard(pg, SHAPE.sessions[0].name); await sleep(800);
        const at = await cardAt(pg, SHAPE.sessions[0].name);
        await pg.touchscreen.tap(at.x, at.y); await sleep(1500);
        check('[webkit] 카드 한 번 누르면 세션 화면', (await viewOf(pg)) === 'session');
        await ctx.close();
      } finally { await wk.close(); }
    }
  } finally { await sim.close?.(); }
}

// ---- 성능: 휴대폰 폭 + CPU 4배 느리게, 끌기·핀치 동안 프레임 간격(rAF) ----
async function perf() {
  const pw = await import('playwright');
  const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
  const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
  const sim = startTsSim({ listen: SIM, target: Number(PORT), name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const browser = await pw.chromium.launch(chromiumOpts());
  try {
    const { ctx, pg } = await openPhone(browser, 'phone');
    const tt = await touch(ctx, pg);
    await tt.cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const t0 = Date.now();
    await pg.evaluate(() => window.__mtPhone.list && window.__mtPhone.list()).catch(() => {});
    await pg.evaluate(() => window.__mtPhone.mission()); await pg.waitForSelector('.mt-pmap .mt-ta-card', { timeout: 20000 });
    const openMs = Date.now() - t0;
    const frames = async (fn) => {
      await pg.evaluate(() => { window.__p166f = []; let last = performance.now(); const f = (t) => { window.__p166f.push(t - last); last = t; if (window.__p166f.length < 2000 && !window.__p166stop) requestAnimationFrame(f); }; window.__p166stop = false; requestAnimationFrame(f); });
      await fn();
      return pg.evaluate(() => { window.__p166stop = true; const a = window.__p166f.slice(2); const s = a.slice().sort((x, y) => x - y); return { n: a.length, avg: Math.round(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length) * 10) / 10, p95: Math.round(s[Math.floor(s.length * 0.95)] || 0), max: Math.round(s[s.length - 1] || 0), over50: a.filter((x) => x > 50).length }; });
    };
    const res = {};
    res.panFit = await frames(async () => { for (let i = 0; i < 3; i++) await tt.drag(200, 600, 200 - 40, 300, 20, 16); });
    res.pinch = await frames(async () => { await tt.pinch(195, 420, 80, 320, 24, 16); await tt.pinch(195, 420, 320, 120, 24, 16); });
    await tt.pinch(195, 420, 100, 300, 12, 16); await sleep(400);
    res.panMid = await frames(async () => { for (let i = 0; i < 3; i++) await tt.drag(200, 650, 120, 250, 20, 16); });
    const p = await pg.evaluate(PROBE);
    await shot(pg, 'perf-after');
    await tt.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    log(`성능(CPU 4배 느리게) 열기 ${openMs}ms ${JSON.stringify(res)}, 카드 ${p.cards.length}, 선 ${p.edges}`);
    fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify({ shape: SHAPE_FILE ? 'real' : 'fake', openMs, ...res, cards: p.cards.length, edges: p.edges }, null, 2));
    check('[perf] CPU 4배 느리게: 끌기·핀치 동안 프레임 p95 ≤ 50ms(20fps 이상), 맵 열기 3초 안', [res.panFit, res.pinch, res.panMid].every((r) => r.p95 <= 50) && openMs < 3000, { openMs, ...res });
    await ctx.close();
  } finally { await browser.close(); await sim.close?.(); }
}

async function stopBoard() {
  for (const s of call('session.list').filter((x) => x.name === ME)) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
  await sleep(2000);
  try { log(atrium('terminal', 'stop', '--yes').slice(0, 200)); } catch (e) { log(`terminal stop ${e.message.slice(0, 120)}`); }
  try { log(atrium('backend', 'stop').slice(0, 200)); } catch (e) { log(`backend stop ${e.message.slice(0, 120)}`); }
}

try {
  if (WHAT === 'setup') await setupBoard();
  else if (WHAT === 'phone') await phone();
  else if (WHAT === 'perf') await perf();
  else if (WHAT === 'stop') await stopBoard();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, `p166-${WHAT}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
