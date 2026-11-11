// P101 창 시험: 다듬은 미션 맵(PC 창 1920·2560, PC 웹, 휴대폰 WebKit·Chromium). 한 번에 한 화면만 돌린다(메모리).
// 판: 따로 띄운 개발용 판(atrium-dev-p101, 47895, backend/.dev)만 쓴다. 흉내 원격(p59-lib.mjs, ts-sim-proxy.mjs) 47985.
//   판 A(실제 세션): 워크스페이스 10개(mtask-p101-a…j), 가상 그룹 product(a, b).
//     리드 p101-lead(a, haiku, 권한 질문 = 응답 필요): 하위 p101-rev(haiku, reviewer, ping = 일함), 역할 선 p101-ui·p101-tests(ping 도는 셸)·p101-build·p101-copy(셸)
//     서로 이은 두 세션: rev → lead(report), port → lead2(report), tests ↔ build(같은 열의 이웃 형제), copy → rev(같은 열 이웃, 한 방향), rev → ui(같은 열, 사이에 카드)
//     리드 p101-lead2(b, haiku, 쉼): 하위 p101-port(haiku, porter, 워크스페이스 c, 일함), 역할 선 p101-notes. rev → p101-old(haiku, 워크스페이스 d, 잠듦), p101-docs(c), 셸 p101-e…j(혼자)
//   판 B(실제 판 모양): 페이지 안에서 mission.graph 답을 워크스페이스 열 개 남짓, 세션 한두 개씩인 흉내 판으로 바꾼다(지휘 세션과 워커가 서로 보고).
//   큰 판: mission.graph 답에 흉내 세션 25개를 더한다.
// 실행(실제 판의 변수를 지운 셸로): sh backend/.dev/clean-env.sh node app/test/e2e/p101-mission.mjs <setup|stir|pc|pc2560|web|webkit|chromium|stop> [before|after]
// 결과는 주 체크아웃의 experiments/p101/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const TAG = process.argv[3] || 'after';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const MAIN = /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) ? path.resolve(REPO, '..', '..', '..') : REPO; // 워크트리면 주 체크아웃
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(MAIN, 'experiments', 'p101');
const CONVOS = path.join(OUT, 'convos');
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const DIRS = LETTERS.map((k) => `C:\\Workspace\\mtask-p101-${k}`);
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
process.env.MT_E2E_OUT = path.relative(path.join(REPO, 'experiments'), OUT);
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A } = L;
const B0 = L.board({ session: 'atrium-dev-p101', port: 47895, sim: 47985, sim2: 47984 });
const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p101-none-',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim},localhost:${B0.sim}`,
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
for (const d of DIRS) fs.mkdirSync(d, { recursive: true });
const { logger, sleep, until, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { chromium, webkit } = await import('playwright');
const chromeExe = (() => { const d = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'); try { return fs.readdirSync(d).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse().map((x) => path.join(d, x, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
const launchChromium = () => chromium.launch({ headless: true, ...(chromeExe ? { executablePath: chromeExe } : { channel: 'chromium' }) });

const log = logger(`p101-${WHAT}-${TAG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const shot = (pg, name, opt = {}) => pg.screenshot({ path: path.join(OUT, `${name}.png`), ...opt }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
const overlap = (ns) => { for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) { const a = ns[i], b = ns[j]; if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) return `${a.name}↔${b.name}`; } return null; };
const AFTER = TAG === 'after';
const P = (k) => `p101-${k}`;

// ---- 판 A ----
const LONG = (n) => `Use the Bash tool to run this command in the foreground, not in the background, with timeout 600000: ping -n ${n} 127.0.0.1 . Wait for it to finish. Then reply with the single word done.`;
const ASK = 'Use the Bash tool to run exactly: mkdir p101-ask-dir . Then reply with the single word done.';
const envOf = (name) => {
  const s = byName(name);
  const settings = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'sessions', `${s.sessionId || s.id}.json`), 'utf8'));
  const e = { ...process.env, ...Object.fromEntries(Object.entries(settings.env || {}).filter(([k]) => k.startsWith('ATRIUM_'))) };
  if (!e.ATRIUM_SESSION_ID || !e.ATRIUM_SESSION_TOKEN) throw new Error(`${name}: 설정 파일에 세션 env가 없다`);
  return e;
};
const child = (pe, args, ms = 150000) => new Promise((resolve) => execFile(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), ...args], { encoding: 'utf8', env: pe, timeout: ms }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout || ''}${stderr || ''}`.trim() })));
const trustStop = () => {
  const tr = sessions().find((s) => /^p101-/.test(s.name) && s.state === 'trust_wait');
  if (tr) { fs.writeFileSync(path.join(DEV, 'p101-need-trust.txt'), `${tr.name} asks the folder trust question in a test folder\n`); throw new Error('trust question (backend/.dev/p101-need-trust.txt)'); }
};
const readyOf = (n, ms = 150000) => until(() => { const s = byName(n); return s && ['ready', 'working', 'waiting', 'trust_wait'].includes(s.state) ? s : null; }, ms, 1500).catch(() => null);
// 선: [A, B, 역할]. 서로 이은 두 세션(A → B, B → A)과 같은 열 형제 사이의 역할 선
const LINKS = [
  ['lead', 'ui', 'ui worker'], ['lead', 'tests', 'test runner'], ['lead', 'build', 'build worker'], ['lead', 'copy', 'copy writer'], ['lead2', 'notes', 'notes'],
  ['rev', 'ui', 'review'], ['rev', 'old', 'archive'],
  ['rev', 'lead', 'report'], ['port', 'lead2', 'report'], // 서로: 하위 세션 → 리드 보고
  ['tests', 'build', 'verify'], ['build', 'tests', 'rerun'], // 서로: 같은 열 이웃 형제
  ['copy', 'rev', 'proofread'], // 한 방향: 같은 열 이웃
];

async function setupBoard() {
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  for (const d of [DIRS[0], DIRS[1], DIRS[2]]) {
    fs.mkdirSync(path.join(d, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(d, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ping:*)', 'Bash(ping *)'] } }, null, 1)); // ping만 묻지 않는다(P85)
  }
  const spawnIn = (dir, ...a) => JSON.parse(atrium('--json', 'spawn', dir, ...a));
  if (!byName(P('lead'))) spawnIn(DIRS[0], '--model', 'haiku', '--name', P('lead'));
  if (!byName(P('lead2'))) spawnIn(DIRS[1], '--model', 'haiku', '--name', P('lead2'));
  if (!byName(P('old'))) spawnIn(DIRS[3], '--model', 'haiku', '--name', P('old')); // 셸은 잠들지 않으므로 haiku(P94)
  for (const [n, wi] of [['ui', 0], ['tests', 0], ['build', 0], ['copy', 0], ['notes', 1], ['docs', 2], ['e', 4], ['f', 5], ['g', 6], ['h', 7], ['i', 8], ['j', 9]]) if (!byName(P(n))) spawnIn(DIRS[wi], '--kind', 'shell', '--name', P(n));
  await readyOf(P('lead')); await readyOf(P('lead2')); await readyOf(P('old')); trustStop();
  if (!byName(P('rev'))) log('child rev', (await child(envOf(P('lead')), ['child', P('rev'), '--role', 'reviewer', '--model', 'haiku', '--no-wait'])).out.slice(0, 300));
  if (!byName(P('port'))) log('child port', (await child(envOf(P('lead2')), ['child', P('port'), '--role', 'porter', '--cwd', DIRS[2].replace(/\\/g, '/'), '--model', 'haiku', '--no-wait'])).out.slice(0, 300));
  await readyOf(P('rev')); await readyOf(P('port')); trustStop();
  const linked = (a, b) => call('link.list').some((l) => l.from === byName(a).sessionId && l.to === byName(b).sessionId && l.role);
  for (const [a, b, role] of LINKS) {
    try { if (!linked(P(a), P(b))) atrium('link', P(a), P(b), '--role', role); } catch (e) { log(`연결 ${a} → ${b} ${e.message.slice(0, 120)}`); }
  }
  try {
    const gs = call('group.list');
    const list = gs.groups || gs;
    if (!(Array.isArray(list) && list.some((g) => g.name === 'product'))) call('group.create', { name: 'product', workspaces: [DIRS[0], DIRS[1]] });
  } catch (e) { log(`가상 그룹 ${e.message.slice(0, 160)}`); }
  await sleep(3000);
  // p101-old에게 한 번 답하게 한 뒤 워크스페이스 d를 잠재운다(claude는 대화가 있어야 잠든다, P94)
  try {
    if (byName(P('old')).state !== 'sleeping') {
      atrium('send', `@${P('old')}`, 'Reply with the single word ok.');
      await until(() => { const s = byName(P('old')); return s && s.state === 'ready' && s.lastAnswer ? s : null; }, 120000, 2000).catch(() => {});
      log('sleep d', atrium('sleep', DIRS[3]).slice(0, 200));
    }
  } catch (e) { log(`잠재우기 ${e.message.slice(0, 160)}`); }
  await sleep(2000);
}
// 찍기 전에 일하는 것과 묻는 것을 돌린다
async function stir() {
  const tests = byName(P('tests'));
  if (!(tests.shell && tests.shell.atPrompt === false)) atrium('input', P('tests'), 'ping -n 3000 127.0.0.1\\r');
  if (byName(P('rev')).state !== 'working') atrium('send', `@${P('rev')}`, LONG(400));
  if (byName(P('port')).state !== 'working') atrium('send', `@${P('port')}`, LONG(400));
  if (byName(P('lead')).state !== 'waiting') atrium('send', `@${P('lead')}`, ASK);
  await until(() => byName(P('rev')).state === 'working' && byName(P('port')).state === 'working' && byName(P('lead')).state === 'waiting' && (byName(P('tests')).shell || {}).atPrompt === false, 150000, 1500).catch(() => {});
  log(`세션 ${sessions().filter((s) => /^p101-/.test(s.name)).map((s) => `${s.name}:${s.state}${s.shell ? `/${s.shell.atPrompt === false ? 'run' : 'idle'}` : ''}${s.branch && s.branch.role ? `(${s.branch.role})` : ''}`).join(' ')}`);
}

// ---- 흉내 판(페이지 안에서 mission.graph 답을 바꾼다) ----
// mode 'real': 워크스페이스 열 개 남짓, 세션 한두 개씩(지휘 세션 팀, 다른 팀 하나, 그 밖은 혼자). 워커가 지휘 세션에게 보고(서로 이은 두 세션)
// mode 'big': 실제 판에 흉내 세션 25개를 더한다
const HOOK = ([mode, n]) => {
  const api = window.__mt.api;
  if (!api.__p101orig) api.__p101orig = api.call.bind(api);
  const now = Date.now();
  const real = () => {
    const ws = ['multitask', 'blog', 'artex-ko', 'notes', 'scraper', 'infra', 'dotfiles', 'research', 'api', 'site', 'landing'].map((x) => `C:/Workspace/fake-${x}/.git`);
    const S = (i, name, w, o = {}) => ({ id: `s:fk${i}`, kind: 'session', sessionId: `fk${i}`, name, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: ws[w], parentId: null, role: null, order: null, createdAt: 1e12 + i, loops: 0, model: 'claude-opus-5-5', effort: 'high', activeAt: now - (i + 1) * 7e5, turnAt: null, gitBranch: null, ...o });
    const nodes = [{ id: 'human', kind: 'human', name: 'you' },
      S(0, 'conductor', 0, { state: 'working', category: 'working', model: 'claude-fable-5-1', turnAt: now - 72e5, lastPrompt: 'Merge P101 when the worker reports' }),
      S(1, 'p101', 0, { parentId: 's:fk0', role: 'mission map', state: 'working', category: 'working', effort: 'high', turnAt: now - 29e5, gitBranch: 'worktree-p101', lastPrompt: 'Tidy the mission map' }),
      S(2, 'p100', 0, { parentId: 's:fk0', role: 'rolled back', state: 'exited', category: 'exited' }),
      S(3, 'reviewer', 0, { parentId: 's:fk0', role: 'reviewer' }),
      S(4, 'blog', 1, { model: 'claude-sonnet-5-5', effort: null }), S(5, 'artex', 2), S(6, 'artex-copy', 2, { state: 'ready', category: 'done' }),
      S(7, 'notes', 3, { state: 'waiting', category: 'needs_you', ask: 'Delete this file?' }), S(8, 'scraper', 4, { state: 'working', category: 'working', model: 'claude-haiku-4-5', turnAt: now - 3e5, lastPrompt: 'npm test' }),
      S(9, 'infra', 5, { agentKind: 'shell', model: null }), S(10, 'dotfiles', 6, { state: 'sleeping' }), S(11, 'paper', 7), S(12, 'paper-codex', 7, { agentKind: 'codex', model: 'gpt-6' }),
      S(13, 'api', 8), S(14, 'site', 9, { agentKind: 'shell', model: null }), S(15, 'landing', 10, { state: 'ready', category: 'done' })];
    const edges = [{ from: 's:fk0', to: 's:fk1', kind: 'spawn' }, { from: 's:fk0', to: 's:fk2', kind: 'spawn' }, { from: 's:fk0', to: 's:fk3', kind: 'role', label: 'reviewer' }, { from: 'human', to: 's:fk0', kind: 'bar', count: 4 },
      { from: 's:fk1', to: 's:fk0', kind: 'prompt', label: 'p101 done: worktree-p101', count: 2, lastAt: now - 6e5 }, { from: 's:fk3', to: 's:fk0', kind: 'prompt', label: 'review ok', count: 1, lastAt: now - 9e5 },
      { from: 's:fk3', to: 's:fk1', kind: 'role', label: 'review' },
      { from: 's:fk5', to: 's:fk6', kind: 'role', label: 'copy' }, { from: 's:fk6', to: 's:fk5', kind: 'prompt', label: 'copy done', count: 1, lastAt: now - 3e6 }];
    const counts = { all: nodes.length - 1 };
    return { nodes, edges, counts, at: now };
  };
  const big = (g) => {
    const realN = g.nodes.filter((x) => x.kind === 'session');
    const keys = [...new Set(realN.map((x) => x.workspaceKey))];
    const nodes = [...g.nodes], edges = [...g.edges];
    const st = ['working', 'ready', 'working', 'waiting', 'ready', 'sleeping', 'ready', 'exited'];
    const roles = ['worker', 'reviewer', 'tests', 'docs', 'worker', 'perf probe'];
    const cat = (s) => (s === 'waiting' ? 'needs_you' : s === 'working' ? 'working' : s === 'exited' ? 'exited' : 'idle');
    for (let i = 0; i < n; i++) {
      const lead = i === 0 || i === 10;
      const parent = i >= 1 && i <= 7 ? 's:big0' : i >= 11 && i <= 15 ? 's:big10' : i >= 16 && i <= 18 ? 's:big1' : null;
      const ws = i <= 9 ? keys[0] : i <= 18 ? keys[1 % keys.length] : keys[i % keys.length];
      const state = lead ? 'ready' : st[i % st.length];
      nodes.push({ id: `s:big${i}`, kind: 'session', sessionId: `big${i}`, name: `big-${String(i).padStart(2, '0')}`, agentKind: i % 4 === 3 ? 'shell' : i % 5 === 1 ? 'codex' : 'claude', state, category: cat(state), workspaceKey: ws, parentId: parent, role: parent ? roles[i % roles.length] : null, order: i, createdAt: 1e12 + i, loops: 0, model: i % 4 === 3 ? null : 'claude-haiku-4-5', activeAt: now - i * 6e5, turnAt: state === 'working' ? now - i * 6e4 : null });
      if (parent) edges.push({ from: parent, to: `s:big${i}`, kind: 'spawn', label: null, active: false });
    }
    edges.push({ from: 's:big0', to: 's:big12', kind: 'prompt', label: 'merge the api change first', count: 3, active: true });
    edges.push({ from: 's:big2', to: 's:big3', kind: 'role', label: 'review', active: false });
    edges.push({ from: 's:big3', to: 's:big2', kind: 'prompt', label: 'reviewed', count: 1, active: false });
    edges.push({ from: 's:big1', to: 's:big0', kind: 'prompt', label: 'report', count: 2, active: false });
    edges.push({ from: 's:big10', to: 's:big22', kind: 'role', label: 'docs', active: false });
    return { ...g, nodes, edges };
  };
  api.call = (m, p) => (m === 'mission.graph' ? (mode === 'real' ? Promise.resolve(real()) : api.__p101orig(m, p).then(big)) : api.__p101orig(m, p));
};
const UNHOOK = () => { const api = window.__mt.api; if (api.__p101orig) api.call = api.__p101orig; };

// ---- 지도 읽기(PC) ----
const PC_PROBE = `(() => {
  const m = document.querySelector('[data-role=mission]');
  if (!m) return null;
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cs = (e) => getComputedStyle(e);
  const nodes = [...m.querySelectorAll('[data-role=mm-node][data-kind=session]')].map((e) => { const s = cs(e); return { name: e.dataset.name, rank: e.dataset.rank || null, family: e.dataset.family || null, tier: e.dataset.tier || null, shape: e.dataset.shape || null, roleText: (e.querySelector('[data-role=mm-role]') || {}).textContent || null, team: (e.querySelector('[data-role=mm-team]') || {}).textContent || null, meta: (e.querySelector('[data-role=mm-meta]') || {}).textContent || null, recede: e.classList.contains('recede'), fdim: e.classList.contains('fdim'),
    border: { w: parseFloat(s.borderTopWidth) || 0, c: s.borderTopColor, style: s.borderTopStyle }, bg: s.backgroundColor, font: parseFloat(cs(e.querySelector('.mt-mm-name, .nm') || e).fontSize), glint: !!e.querySelector('[data-role=mm-flash]'), anims: e.getAnimations ? e.getAnimations({ subtree: true }).length : -1, ...R(e) }; });
  const edges = [...m.querySelectorAll('[data-role=mm-edge]')].map((e) => { const l = e.querySelector('path.line'); return { id: e.dataset.id || null, kind: e.dataset.kind, rel: e.dataset.rel || null, from: e.dataset.from, to: e.dataset.to, route: e.dataset.route || null, pair: e.dataset.pair === '1', cross: e.dataset.cross === '1', tree: e.dataset.tree === '1', back: e.classList.contains('back'), recede: e.classList.contains('recede'), hot: e.classList.contains('hot'), tip: !!e.querySelector('.mt-mm-tip'), box: l ? R(l) : null }; });
  const groups = [...m.querySelectorAll('[data-role=mm-group]')].map((g) => ({ key: g.dataset.key, name: (g.querySelector('[data-role=mm-group-name]') || {}).textContent, vg: (g.querySelector('[data-role=mm-vgroup]') || {}).textContent || null, packed: g.dataset.packed === '1', ...R(g) }));
  const plates = [...m.querySelectorAll('[data-role=mm-plate]')].map((g) => ({ key: g.dataset.key, bg: cs(g).backgroundColor, ...R(g) }));
  const sum = m.querySelector('[data-role=mm-summary]');
  const sec = (k) => (sum && sum.querySelector('[data-role=mm-sum-' + k + ']')) ? [...sum.querySelectorAll('[data-role=mm-sum-' + k + '] [data-role=mm-sum-item], [data-role=mm-sum-' + k + '] [data-role=mm-sum-rest-item]')].map((e) => e.dataset.name || e.textContent) : [];
  const body = m.querySelector('.mt-mission-body'), canvas = m.querySelector('.mt-mission-canvas');
  return { nodes, edges, groups, plates, summary: sum ? { turn: sec('turn'), work: sec('work'), review: sec('review'), rest: sec('rest'), foot: (sum.querySelector('[data-role=mm-sum-foot]') || {}).textContent || '' } : null,
    labels: m.querySelectorAll('[data-role=mm-label]').length, legend: !!m.querySelector('[data-role=mm-legend]'), boxes: m.querySelectorAll('[data-role=mm-band], [data-role=mm-team-box]').length,
    body: body ? { w: body.clientWidth, h: body.clientHeight, sh: body.scrollHeight, sw: body.scrollWidth, x: Math.round(body.getBoundingClientRect().left), y: Math.round(body.getBoundingClientRect().top) } : null, canvas: canvas ? R(canvas) : null };
})()`;

// 고치기 전 그림에 어수선한 곳과 길게 도는 선을 빨간 테로 표시한다(창 안에 덧그린 뒤 찍고 지운다)
const MARK = (marks) => {
  const root = document.createElement('div');
  root.id = 'p101-marks';
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
  for (const m of marks) {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${m.x - 4}px;top:${m.y - 4}px;width:${m.w + 8}px;height:${m.h + 8}px;border:2px solid #ff2d55;border-radius:8px;box-sizing:border-box`;
    const t = document.createElement('span');
    t.textContent = m.label;
    t.style.cssText = 'position:absolute;left:0;top:-20px;font:700 12px/16px sans-serif;color:#fff;background:#ff2d55;padding:1px 5px;border-radius:4px;white-space:nowrap';
    d.appendChild(t);
    root.appendChild(d);
  }
  document.body.appendChild(root);
};
const UNMARK = () => { const r = document.getElementById('p101-marks'); if (r) r.remove(); };
// 길게 도는 선(같은 열·뒤로 가는 선의 상자)과 떠 보이는 한 줄
function marksOf(p) {
  const nb = new Map(p.nodes.map((n) => [n.name, n]));
  const nameOf = (id) => { const n = p.nodes.find((x) => `s:${x.sid}` === id); return n ? n.name : id; };
  const out = [];
  for (const e of p.edges) if (e.back && e.box && e.box.w > 0) out.push({ ...e.box, label: `detour ${e.rel || e.kind}` });
  const rows = p.nodes.filter((n) => n.shape === 'row').slice(0, 3);
  for (const r of rows) out.push({ x: r.x, y: r.y, w: r.w, h: r.h, label: 'no border' });
  void nb; void nameOf;
  return out;
}

async function openMission(pg) {
  if (await pg.$('[data-action="return-close"]')) { await pg.click('[data-action="return-close"]').catch(() => {}); await sleep(300); } // 자리 비운 동안 바뀐 것 카드(요약 열을 가린다)
  if (await pg.$('[data-role="mission"]')) { await pg.keyboard.press('Escape'); await sleep(400); }
  await pg.click('[data-action="mission-rail"]');
  await pg.waitForSelector('[data-role="mission"] [data-role="mm-node"], [data-role="mission"] [data-role="mm-group"]', { timeout: 20000 });
  await sleep(1800);
}
const hoverNode = async (pg, n) => { await pg.mouse.move(n.x + Math.min(n.w / 2, 40), n.y + n.h / 2); await sleep(500); };
const nodeBy = (p, name) => p.nodes.find((x) => x.name === name) || {};
const edgeBy = (p, a, b) => p.edges.find((e) => e.fromName === a && e.toName === b);
// 선의 끝 이름을 단다(노드 data-name ↔ 선 data-from의 세션 id)
const NAMES = `(() => Object.fromEntries([...document.querySelectorAll('[data-role=mm-node][data-kind=session]')].map((e) => [e.dataset.id || '', e.dataset.name])))()`;

// 서로 이은 두 세션의 선이 두 카드 사이(마주 보는 가장자리 사이)에 드는가
function pairInside(p, a, b) {
  const A = nodeBy(p, a), B = nodeBy(p, b);
  const es = p.edges.filter((e) => (e.fromName === a && e.toName === b) || (e.fromName === b && e.toName === a));
  if (!A.w || !B.w || es.length !== 2 || es.some((e) => !e.box)) return { ok: false, why: 'missing', n: es.length };
  const left = A.x <= B.x ? A : B, right = left === A ? B : A, top = A.y <= B.y ? A : B, bottom = top === A ? B : A;
  const horiz = right.x >= left.x + left.w - 2;
  const lo = horiz ? left.x + left.w - 3 : top.y + top.h - 3, hi = horiz ? right.x + 3 : bottom.y + 3;
  const ok = es.every((e) => (horiz ? e.box.x >= lo && e.box.x + e.box.w <= hi : e.box.y >= lo && e.box.y + e.box.h <= hi)) && es.every((e) => e.pair && e.tip);
  return { ok, horiz, lo, hi, boxes: es.map((e) => ({ route: e.route, pair: e.pair, tip: e.tip, box: e.box })) };
}

// PC 판(캔버스)의 노드 틀 모양(미션 맵 밖 화면: 고치기 전·뒤가 같아야 한다). 상태·때에 따라 바뀌는 값은 뺀다
const NODE_PRINT = `(() => [...document.querySelectorAll('.mt-node')].map((e) => { const s = getComputedStyle(e); return [e.dataset.name, ...['borderTopWidth', 'borderTopStyle', 'borderRadius', 'fontFamily', 'fontSize', 'paddingTop'].map((k) => s[k])].join('|'); }).sort())()`;

// PC 창과 PC 웹이 같이 쓰는 지도 시험
async function desk(pg, E) {
  if (await pg.$('[data-action="return-close"]')) { await pg.click('[data-action="return-close"]').catch(() => {}); await sleep(300); }
  await shot(pg, `${E}-${TAG}-00-board`);
  const nodePrint = await pg.evaluate(NODE_PRINT);
  fs.writeFileSync(path.join(OUT, `p101-board-${E}-${TAG}.json`), JSON.stringify(nodePrint, null, 1));
  if (AFTER) {
    const was = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, `p101-board-${E}-before.json`), 'utf8')); } catch { return null; } })();
    check(`[${E}] PC 판(캔버스) 노드 틀 모양이 고치기 전과 같다(계산된 CSS)`, was && JSON.stringify(was) === JSON.stringify(nodePrint) && nodePrint.length >= 17, was ? { before: was.length, after: nodePrint.length, diff: nodePrint.filter((x, i) => was[i] !== x).slice(0, 3) } : 'no before');
  }
  await openMission(pg);
  await pg.mouse.move(pg.viewportSize().width - 120, 82); await sleep(300); // 머리줄 빈 곳(처음 그림은 가리키지 않은 모습)
  const probe = async () => { const p = await pg.evaluate(PC_PROBE); const names = await pg.evaluate(NAMES); const ids = Object.fromEntries(await pg.evaluate(() => [...document.querySelectorAll('[data-role=mm-node][data-kind=session]')].map((e) => [e.dataset.name, e.dataset.sid || '']))); void ids; for (const e of p.edges) { e.fromName = names[e.from] || e.from; e.toName = names[e.to] || e.to; } return p; };
  let p = await probe();
  log(`[${E}] 지도 ${JSON.stringify({ nodes: p.nodes.map((n) => `${n.name}:${n.rank}/${n.family}/${n.tier}/${n.shape}`), edges: p.edges.map((e) => `${e.fromName}>${e.toName}:${e.rel || e.kind}${e.route ? `/${e.route}` : ''}${e.back ? '/back' : ''}`), groups: p.groups.map((g) => `${g.name}${g.vg ? `[${g.vg}]` : ''}${g.packed ? '*' : ''}`), plates: p.plates.length, summary: p.summary })}`);
  await shot(pg, `${E}-${TAG}-01-map`);
  if (!AFTER) { await pg.evaluate(MARK, marksOf(p)); await shot(pg, `${E}-${TAG}-01-map-marked`); await pg.evaluate(UNMARK); }
  // 서로 이은 두 곳 확대(rev ↔ lead, tests ↔ build, port ↔ lead2)
  const zoomShot = async (a, b, name) => { const A = nodeBy(p, a), B = nodeBy(p, b); if (!A.w || !B.w) return; const x0 = Math.max(0, Math.min(A.x, B.x) - 70), y0 = Math.max(0, Math.min(A.y, B.y) - 50), x1 = Math.max(A.x + A.w, B.x + B.w) + 170, y1 = Math.max(A.y + A.h, B.y + B.h) + 50; await shot(pg, `${E}-${TAG}-${name}`, { clip: { x: x0, y: y0, width: Math.min(x1 - x0, pg.viewportSize().width - x0), height: Math.min(y1 - y0, pg.viewportSize().height - y0) } }); };
  await zoomShot(P('lead'), P('rev'), '08-pair-lead-rev');
  await zoomShot(P('tests'), P('build'), '09-pair-tests-build');
  await zoomShot(P('lead2'), P('port'), '10-pair-lead2-port');
  if (AFTER) {
    const n = (name) => nodeBy(p, name);
    check(`[${E}] 세션 17개가 모두 보인다(카드·알약)`, p.nodes.length === 17, p.nodes.map((x) => `${x.name}:${x.shape}`));
    check(`[${E}] 선 이름표·범례·팀 상자 없음`, p.labels === 0 && !p.legend && p.boxes === 0, { labels: p.labels, legend: p.legend, boxes: p.boxes });
    check(`[${E}] 역할: 리드 둘은 lead, rev는 sub(review), port는 worker, e는 solo`, n(P('lead')).rank === 'lead' && n(P('lead2')).rank === 'lead' && n(P('rev')).rank === 'sub' && n(P('rev')).family === 'review' && n(P('port')).rank === 'worker' && n(P('e')).rank === 'solo', p.nodes.map((x) => `${x.name}:${x.rank}/${x.family}`));
    check(`[${E}] 카드끼리 겹치지 않는다`, !overlap(p.nodes), overlap(p.nodes));
    check(`[${E}] 리드 → 하위 순서(왼쪽 → 오른쪽), 다른 워크스페이스 하위 port·old도 부모 오른쪽`, n(P('rev')).x > n(P('lead')).x && n(P('ui')).x > n(P('lead')).x && n(P('port')).x > n(P('lead2')).x && n(P('old')).x > n(P('rev')).x, [P('lead'), P('rev'), P('old'), P('lead2'), P('port')].map((x) => [x, n(x).x]));
    // 서로 이은 두 세션 = 짧은 두 줄(마주 보는 가장자리 사이, 화살촉)
    for (const [a, b] of [['lead', 'rev'], ['lead2', 'port'], ['tests', 'build']]) { const r = pairInside(p, P(a), P(b)); check(`[${E}] ${a} ↔ ${b}: 마주 보는 가장자리 사이의 짧은 두 줄(화살촉)`, r.ok, r); }
    const ru = edgeBy(p, P('rev'), P('ui'));
    check(`[${E}] rev → ui(같은 열 이웃, 한 방향): 아래·위 가장자리 사이 짧은 한 줄과 화살촉`, ru && ru.route === 'near' && ru.tip && ru.box && ru.box.y >= n(P('rev')).y + n(P('rev')).h - 2 && ru.box.y + ru.box.h <= n(P('ui')).y + 2, ru);
    const cr = edgeBy(p, P('copy'), P('rev'));
    check(`[${E}] copy → rev(같은 열, 사이에 카드): 오른쪽 짧은 괄호와 화살촉`, cr && cr.route === 'side' && cr.tip && cr.box && cr.box.x + cr.box.w <= n(P('rev')).x + n(P('rev')).w + 64, cr);
    // 오른쪽으로 크게 도는 선이 없다: 세션 사이 선의 상자가 두 카드의 오른쪽 끝을 크게 넘지 않는다
    const detour = p.edges.filter((e) => e.box && e.fromName.startsWith('p101-') && e.toName.startsWith('p101-')).filter((e) => { const A = n(e.fromName), B = n(e.toName); return A.w && B.w && e.box.x + e.box.w > Math.max(A.x + A.w, B.x + B.w) + 64; });
    check(`[${E}] 오른쪽으로 크게 도는 선이 없다`, detour.length === 0, detour.map((e) => `${e.fromName}>${e.toName}:${e.route}`));
    check(`[${E}] 나무 선 흐름: 부모 → 하위 선은 부모 오른쪽에서 하위 왼쪽으로(왼쪽 → 오른쪽)`, p.edges.filter((e) => e.tree && e.box).every((e) => { const A = n(e.fromName), B = n(e.toName); return !A.w || !B.w || (e.box.x >= A.x + A.w - 3 && e.box.x + e.box.w <= B.x + 3); }), p.edges.filter((e) => e.tree).map((e) => `${e.fromName}>${e.toName}`));
    // 잠든·쉬는 세션에도 테두리, 워크스페이스 판, 진행 중 테두리 움직임
    const rows = p.nodes.filter((x) => x.shape === 'row');
    check(`[${E}] 쉬는·잠든 세션(알약)도 테두리가 보인다`, rows.length >= 5 && rows.every((x) => x.border.w >= 1 && !/rgba\(.*, 0\)$/.test(x.border.c)), rows.map((x) => `${x.name}:${x.border.w}/${x.border.c}`));
    check(`[${E}] 워크스페이스마다 옅은 판이 있다(머리 글 수와 같다, 9개: d의 잠든 old는 rev 팀 안)`, p.plates.length === p.groups.length && p.plates.length === 9 && p.plates.every((x) => !/rgba(0, 0, 0, 0)/.test(x.bg)), p.plates.map((x) => `${x.key}:${x.bg}`));
    const work = p.nodes.filter((x) => x.tier === 'work');
    check(`[${E}] 일하는 카드(rev·port·tests)에 번쩍임 층과 움직임(P102)`, work.length >= 3 && work.every((x) => x.glint && x.anims > 0) && p.nodes.filter((x) => x.tier !== 'work').every((x) => !x.glint), work.map((x) => `${x.name}:${x.glint}/${x.anims}`));
    check(`[${E}] 글자: 카드 이름 13px`, p.nodes.filter((x) => x.shape === 'card').every((x) => x.font >= 13), p.nodes.map((x) => `${x.name}:${x.font}`));
    const s = p.summary || {};
    check(`[${E}] 요약 열: 응답 필요 1(lead), 작업 중 3(rev·tests·port), 아래 줄에 세션 17`, s.turn && s.turn.length === 1 && s.turn[0] === P('lead') && s.work.length === 3 && [P('rev'), P('tests'), P('port')].every((x) => s.work.includes(x)) && /17/.test(s.foot), s);
    // 테두리 움직임 몇 장(일하는 카드 하나를 확대)
    const w0 = n(P('rev'));
    if (w0.w) for (let i = 0; i < 4; i++) { await shot(pg, `${E}-${TAG}-11-glint-${i}`, { clip: { x: Math.max(0, w0.x - 12), y: Math.max(0, w0.y - 12), width: w0.w + 40, height: w0.h + 24 } }); await sleep(450); }
    // 움직임 줄이기: 움직임이 멈춘다
    await pg.emulateMedia({ reducedMotion: 'reduce' }); await sleep(400);
    const still = await pg.evaluate(() => [...document.querySelectorAll('[data-role=mm-flash]')].map((e) => e.getAnimations({ subtree: true }).length));
    check(`[${E}] 움직임 줄이기(prefers-reduced-motion)에서는 움직임이 없다`, still.length >= 3 && still.every((x) => x === 0), still);
    await pg.emulateMedia({ reducedMotion: 'no-preference' }); await sleep(300);
    // 가리키면 그 노드의 관계만 또렷, 선의 풀이(title)
    await hoverNode(pg, n(P('lead2')));
    p = await probe();
    const m = (name) => nodeBy(p, name);
    check(`[${E}] lead2를 가리키면 lead2·port·notes는 또렷하고 lead 팀은 물러난다`, !m(P('lead2')).recede && !m(P('port')).recede && !m(P('notes')).recede && m(P('lead')).recede && m(P('rev')).recede && p.edges.some((e) => e.hot) && p.edges.filter((e) => !e.hot).every((e) => e.recede), p.nodes.map((x) => `${x.name}:${x.recede ? 'r' : '-'}`));
    const both = p.edges.filter((e) => (e.fromName === P('lead2') && e.toName === P('port')) || (e.fromName === P('port') && e.toName === P('lead2')));
    check(`[${E}] lead2를 가리키면 port와의 두 줄이 모두 또렷`, both.length === 2 && both.every((e) => e.hot), both);
    await shot(pg, `${E}-${TAG}-02-hover-lead2`);
    const tipText = await pg.evaluate(() => { const g = [...document.querySelectorAll('[data-role=mm-edge][data-pair="1"]')][0]; return g ? (g.querySelector('title') || {}).textContent : null; });
    check(`[${E}] 짧은 두 줄에도 선 풀이(title)가 있다`, !!tipText && tipText.length > 3, tipText);
    await hoverNode(pg, m(P('rev')));
    p = await probe();
    const q = (name) => nodeBy(p, name);
    check(`[${E}] rev를 가리키면 부모 lead, 역할 선의 ui·old·copy는 또렷하고 lead2는 물러난다`, !q(P('rev')).recede && !q(P('lead')).recede && !q(P('ui')).recede && !q(P('old')).recede && !q(P('copy')).recede && q(P('lead2')).recede, p.nodes.map((x) => `${x.name}:${x.recede ? 'r' : '-'}`));
    await shot(pg, `${E}-${TAG}-03-hover-rev`);
    await pg.mouse.move(5, 500); await sleep(400);
    p = await probe();
    check(`[${E}] 빈 곳으로 빼면 모두 또렷`, p.nodes.every((x) => !x.recede), p.nodes.filter((x) => x.recede).map((x) => x.name));
    const before = Object.fromEntries(p.nodes.map((x) => [x.name, [x.x, x.y]]));
    await pg.click('[data-filter=working]'); await sleep(500);
    p = await probe();
    const stay = p.nodes.every((x) => before[x.name] && before[x.name][0] === x.x && before[x.name][1] === x.y);
    check(`[${E}] 거르기(작업 중)는 흐리게만, 자리는 그대로`, stay && p.nodes.filter((x) => !x.fdim).every((x) => x.tier === 'work') && p.nodes.some((x) => x.fdim), p.nodes.map((x) => `${x.name}:${x.fdim ? 'd' : '-'}`));
    await shot(pg, `${E}-${TAG}-04-filter-working`);
    await pg.click('[data-filter=all]'); await sleep(300);
  }
  // 판 B: 실제 판 모양
  await pg.evaluate(HOOK, ['real', 0]);
  await openMission(pg);
  await pg.mouse.move(pg.viewportSize().width - 120, 82); await sleep(300); // 가리키지 않은 모습
  p = await probe();
  await shot(pg, `${E}-${TAG}-05-real`);
  if (!AFTER) { await pg.evaluate(MARK, marksOf(p)); await shot(pg, `${E}-${TAG}-05-real-marked`); await pg.evaluate(UNMARK); }
  if (AFTER) {
    const cols = new Set(p.groups.filter((g) => g.packed).map((g) => g.x));
    check(`[${E}] 실제 판 모양(16개, 워크스페이스 11개): 혼자인 워크스페이스는 오른쪽 여러 기둥, 한 화면에 든다`, p.nodes.length === 16 && cols.size >= 2 && p.body.sh <= p.body.h + 2 && !overlap(p.nodes), { n: p.nodes.length, cols: [...cols], body: p.body });
    for (const [a, b] of [['conductor', 'p101'], ['conductor', 'reviewer'], ['artex', 'artex-copy']]) { const r = pairInside(p, a, b); check(`[${E}] 실제 판 모양 ${a} ↔ ${b}: 짧은 두 줄`, r.ok, r); }
  }
  // 큰 판
  await pg.evaluate(UNHOOK);
  await pg.evaluate(HOOK, ['big', 25]);
  await openMission(pg);
  await pg.mouse.move(pg.viewportSize().width - 120, 82); await sleep(300); // 가리키지 않은 모습
  p = await probe();
  await shot(pg, `${E}-${TAG}-06-big`);
  if (AFTER) {
    check(`[${E}] 큰 판(42개): 겹침 없음, 리드 넷 이상, 쉬는 하위가 많으면 동그라미 줄`, p.nodes.length === 42 && !overlap(p.nodes) && p.nodes.filter((x) => x.rank === 'lead').length >= 4 && p.nodes.some((x) => x.shape === 'dot'), { n: p.nodes.length, leads: p.nodes.filter((x) => x.rank === 'lead').map((x) => x.name), dots: p.nodes.filter((x) => x.shape === 'dot').length, overlap: overlap(p.nodes) });
    const b0 = p.nodes.find((x) => x.name === 'big-00');
    if (b0) { await hoverNode(pg, b0); await shot(pg, `${E}-${TAG}-07-big-hover`); }
  }
  await pg.evaluate(UNHOOK);
  await pg.keyboard.press('Escape');
}

// ---- PC 창(Electron) ----
async function pc(w = 1920, h = 1080, E = 'pc') {
  const { app, page } = await launch({ log, env: { ...ENV } });
  try {
    await page.setViewportSize({ width: w, height: h }).catch(() => {});
    await sleep(3000);
    await desk(page, E);
  } finally { await closeApp(app); }
}

// ---- PC 웹(Chromium, 흉내 원격) ----
async function web() {
  const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
  const sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const browser = await launchChromium();
  try {
    for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'ko-KR', ...(AFTER ? { recordVideo: { dir: path.join(OUT, 'video-web'), size: { width: 960, height: 540 } } } : {}) });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[web pageerror] ${e.message}`));
    await pair(pg, `http://localhost:${B0.sim}`);
    await sleep(2500);
    await desk(pg, 'web');
    if (AFTER) await cost(pg);
    await ctx.close();
  } finally { await browser.close().catch(() => {}); await sim.close().catch(() => {}); }
}
// 테두리 움직임의 값: 미션 맵을 연 채 5초 동안 주 스레드의 일(스타일 다시 셈·배치·일 시간). 테두리 빛만 켬/끔을 견주고(판의 다른 움직임은 그대로),
// 앱 전체 움직임 줄이기 값도 함께 적는다(움직임 줄이기는 판 노드의 고리 등 다른 움직임도 멈춘다)
async function cost(pg) {
  await openMission(pg);
  await pg.mouse.move(5, 500);
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Performance.enable');
  const take = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter((m) => ['RecalcStyleCount', 'LayoutCount', 'TaskDuration', 'ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration'].includes(m.name)).map((m) => [m.name, m.value]));
  const span = async () => { const a = await take(); await sleep(5000); const b = await take(); return Object.fromEntries(Object.keys(a).map((k) => [k, Math.round((b[k] - a[k]) * 1000) / 1000])); };
  const on = await span();
  const tag = await pg.addStyleTag({ content: '.mt-mm-flash { animation: none !important; }' }); await sleep(500);
  const off = await span();
  await tag.evaluate((el) => el.remove()); await sleep(300);
  await pg.emulateMedia({ reducedMotion: 'reduce' }); await sleep(500);
  const reduce = await span();
  await pg.emulateMedia({ reducedMotion: 'no-preference' });
  log(`[web] 5초 동안 주 스레드 일: 테두리 빛 켬 ${JSON.stringify(on)} / 테두리 빛만 끔 ${JSON.stringify(off)} / 앱 전체 움직임 줄이기 ${JSON.stringify(reduce)}`);
  fs.writeFileSync(path.join(OUT, 'p101-cost-web.json'), JSON.stringify({ on, glintOff: off, reduceAll: reduce }, null, 1));
  check('[web] 테두리 빛이 주 스레드에서 스타일 다시 셈·배치를 늘리지 않는다(합성만)', on.RecalcStyleCount - off.RecalcStyleCount < 10 && on.LayoutCount - off.LayoutCount < 5, { on, off, reduce });
  await pg.keyboard.press('Escape');
}
const loadedOpen = (pg, ms = 60000) => pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: ms });
const splashGone = (pg) => pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
async function pair(pg, base) {
  await pg.goto(`${base}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await pg.fill('[data-field=pair-code]', call('device.code').code);
  await pg.click('[data-action=pair-submit]');
  await loadedOpen(pg); await splashGone(pg);
}

// ---- 휴대폰(WebKit, Chromium) ----
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const W = 393, H = 852;
const PHONE = { viewport: { width: W, height: H }, screen: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: SAFARI };
const PH_PROBE = `(() => {
  const st = document.querySelector('[data-role=pm-stage]');
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const nodes = [...document.querySelectorAll('[data-role=pm-node]')].map((e) => { const s = getComputedStyle(e); return { name: e.dataset.name, id: e.dataset.id || null, tier: e.dataset.tier, rank: e.dataset.rank || null, family: e.dataset.family || null, shape: e.dataset.shape || null, role: (e.querySelector('[data-role=pm-role]') || {}).textContent || null, team: (e.querySelector('[data-role=pm-team]') || {}).textContent || null, meta: (e.querySelector('[data-role=pm-meta]') || {}).textContent || null, dim: e.classList.contains('dim'), border: { w: parseFloat(s.borderTopWidth) || 0, c: s.borderTopColor }, anims: e.getAnimations ? e.getAnimations({ subtree: true }).length : -1, ...R(e) }; });
  const edges = [...document.querySelectorAll('[data-role=pm-edge]')].map((e) => ({ kind: e.dataset.kind, rel: e.dataset.rel || null, from: e.dataset.from, to: e.dataset.to, route: e.dataset.route || null, pair: e.dataset.pair === '1', box: R(e) }));
  const tips = document.querySelectorAll('[data-role=pm-tip]').length;
  const groups = [...document.querySelectorAll('[data-role=pm-group]')].map((g) => ({ ws: g.dataset.ws, name: (g.querySelector('.mt-pm-gname') || {}).textContent, vg: (g.querySelector('[data-role=pm-vgroup]') || {}).textContent || null, ...R(g) }));
  const plates = document.querySelectorAll('[data-role=pm-plate]').length;
  const world = document.querySelector('[data-role=pm-world]');
  return { nodes, edges, tips, groups, plates, stage: st ? R(st) : null, world: world ? R(world) : null, legend: !!document.querySelector('[data-role=pm-legend]'), view: window.__mtPm ? window.__mtPm.view() : null, page: { sw: document.documentElement.scrollWidth, iw: innerWidth } };
})()`;
// 휴대폰 세션 목록·새 세션 시트의 계산된 모양(고치기 전·뒤가 같은지 견준다)
const STYLE_PRINT = `((sel) => {
  const root = document.querySelector(sel);
  if (!root) return null;
  const keys = ['display', 'position', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'color', 'backgroundColor', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRadius', 'paddingTop', 'paddingLeft', 'height', 'boxShadow', 'animationName']; // 폭(글 길이: 지연 ms, 지난 시간)과 투명도(연결 점의 깜빡임)는 내용·때에 따라 바뀌어 뺀다
  return [...root.querySelectorAll('*')].map((e) => { const s = getComputedStyle(e); return [e.tagName, String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className), ...keys.map((k) => s[k])].join('|'); });
})`;
function childTree(rootPid) {
  const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Json -Compress';
  const all = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 60000 }));
  const kids = new Map();
  for (const p of all) { if (!kids.has(p.ParentProcessId)) kids.set(p.ParentProcessId, []); kids.get(p.ParentProcessId).push(p); }
  const out = [];
  const walk = (pid) => { for (const c of kids.get(pid) || []) { out.push({ pid: c.ProcessId, name: c.Name, ws: Number(c.WorkingSetSize) || 0, cpu: (Number(c.KernelModeTime) || 0) + (Number(c.UserModeTime) || 0) }); walk(c.ProcessId); } };
  walk(rootPid);
  return out;
}
const webkitProcs = () => childTree(process.pid).filter((p) => /WebKitWebProcess/i.test(p.name));
const webkitMB = () => Math.round(webkitProcs().reduce((a, p) => a + p.ws, 0) / 1048576);
const webkitCpuMs = () => Math.round(webkitProcs().reduce((a, p) => a + p.cpu, 0) / 1e4); // 100ns 단위 → ms
// 손가락(P89와 같다): Chromium은 CDP로 진짜 터치, WebKit은 그래프 칸에 touch 이벤트를 만들어 보낸다. 좌표는 화면 px
const WS_HOOK = () => {
  const Orig = window.WebSocket;
  window.__p101 = { sent: [] };
  class Hooked extends Orig { constructor(...a) { super(...a); const send = this.send.bind(this); this.send = (d) => { try { window.__p101.sent.push({ m: JSON.parse(d).method, t: Math.round(performance.now()) }); } catch {} return send(d); }; } }
  window.WebSocket = Hooked;
};
const TOUCH_HOOK = () => {
  window.__p101touch = (type, pts, remain) => {
    const el = document.querySelector('[data-role=pm-stage]');
    const mk = (p) => ({ identifier: p.id, clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y, screenX: p.x, screenY: p.y, target: el });
    const ev = new Event(type, { bubbles: true, cancelable: true });
    const list = pts.map(mk);
    Object.defineProperty(ev, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? (remain || []).map(mk) : list });
    Object.defineProperty(ev, 'changedTouches', { value: list });
    Object.defineProperty(ev, 'targetTouches', { value: ev.touches });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
};
function fingers(pg, cdp) {
  const send = async (type, pts, remain) => {
    if (cdp) { const map = { touchstart: 'touchStart', touchmove: 'touchMove', touchend: 'touchEnd' }; await cdp.send('Input.dispatchTouchEvent', { type: map[type], touchPoints: (type === 'touchend' ? remain || [] : pts).map((p) => ({ x: p.x, y: p.y, id: p.id })) }); }
    else await pg.evaluate(([t, p, r]) => window.__p101touch(t, p, r), [type, pts, remain || []]);
  };
  const steps = async (from, to, n) => { for (let i = 1; i <= n; i++) await send('touchmove', from.map((f, k) => ({ id: f.id, x: f.x + ((to[k].x - f.x) * i) / n, y: f.y + ((to[k].y - f.y) * i) / n }))); };
  return {
    async pan(x, y, dx, dy, n = 10) { const a = [{ id: 1, x, y }]; await send('touchstart', a); await steps(a, [{ id: 1, x: x + dx, y: y + dy }], n); await send('touchend', [{ id: 1, x: x + dx, y: y + dy }]); },
    async pinch(cx, cy, d0, d1, n = 10) {
      const a = [{ id: 1, x: cx - d0 / 2, y: cy }, { id: 2, x: cx + d0 / 2, y: cy }], b = [{ id: 1, x: cx - d1 / 2, y: cy }, { id: 2, x: cx + d1 / 2, y: cy }];
      if (cdp) await send('touchstart', a); else { await send('touchstart', [a[0]]); await send('touchstart', a); }
      await steps(a, b, n);
      await send('touchend', b, []);
    },
  };
}
const viewOf = (pg) => pg.evaluate(() => { const p = document.querySelector('[data-role=phone]'); return p ? p.dataset.view : 'none'; });
const tapSel = async (pg, sel) => { await pg.waitForSelector(sel, { timeout: 15000 }); await pg.tap(sel); };
const sentSince = (pg, t) => pg.evaluate((t0) => (window.__p101 ? window.__p101.sent : []).filter((x) => x.t >= t0).map((x) => x.m), t);
const nowIn = (pg) => pg.evaluate(() => Math.round(performance.now()));
async function gestures(pg, cdp, E, t0) {
  const F = fingers(pg, cdp);
  let p = await pg.evaluate(PH_PROBE);
  const fit0 = p.view;
  const sx = p.stage.x + p.stage.w / 2, sy = p.stage.y + p.stage.h / 2;
  await F.pan(sx, sy, -40, -140); await sleep(400);
  const panned = (await pg.evaluate(PH_PROBE)).view;
  check(`[${E}] 한 손가락으로 옮긴다(보기가 손가락만큼)`, Math.abs(panned.x - (fit0.x - 40)) <= 2 && Math.abs(panned.y - (fit0.y - 140)) <= 2 && panned.zoom === fit0.zoom, { fit0, panned });
  await F.pinch(sx, sy, 100, 200); await sleep(400);
  p = await pg.evaluate(PH_PROBE);
  const wx = (sx - p.stage.x - panned.x) / panned.zoom;
  check(`[${E}] 두 손가락으로 확대(두 배, 가운데 점이 그 자리에)`, Math.abs(p.view.zoom / panned.zoom - 2) < 0.08 && Math.abs(wx * p.view.zoom + p.view.x - (sx - p.stage.x)) < 4, { panned, zoomed: p.view });
  await tapSel(pg, '[data-action=pm-fit]'); await sleep(400);
  check(`[${E}] 맞추기 단추는 처음 보기로`, JSON.stringify((await pg.evaluate(PH_PROBE)).view) === JSON.stringify(fit0), fit0);
  await tapSel(pg, '[data-action=pm-focus-turn]'); await sleep(500);
  p = await pg.evaluate(PH_PROBE);
  const lead = p.nodes.find((x) => x.name === P('lead')) || {};
  check(`[${E}] 응답 필요 칩: lead만 또렷하고 나머지는 물러나며 화면 안`, !lead.dim && p.nodes.filter((x) => x.name !== P('lead')).every((x) => x.dim) && lead.y > p.stage.y && lead.y + lead.h < p.stage.y + p.stage.h, { lead, view: p.view });
  await shot(pg, `${E}-${TAG}-05-focus-turn`);
  await tapSel(pg, '[data-action=pm-focus-turn]'); await sleep(300);
  check(`[${E}] 칩을 다시 누르면 모두 또렷하게`, (await pg.evaluate(PH_PROBE)).nodes.every((x) => !x.dim));
  await tapSel(pg, '[data-action=pm-fit]'); await sleep(300);
  await F.pan(sx, sy, 0, -60); await sleep(400);
  p = await pg.evaluate(PH_PROBE);
  const before = { view: p.view, ui: p.nodes.find((x) => x.name === P('ui')) };
  const sent = await sentSince(pg, t0);
  check(`[${E}] 관계도를 여는 동안·옮기는 동안 session.messages·terminal.* 요청이 없고 mission.graph를 받는다`, !sent.some((x) => /^session\.messages$|^terminal\./.test(x)) && sent.includes('mission.graph'), [...new Set(sent)]);
  await tapSel(pg, `[data-role=pm-node][data-name="${P('ui')}"]`);
  await pg.waitForFunction(() => document.querySelector('[data-role=phone]').dataset.view === 'session', null, { timeout: 10000 }).catch(() => {});
  await sleep(1500);
  check(`[${E}] 알약(쉬는 세션)을 탭하면 그 세션 화면`, (await viewOf(pg)) === 'session');
  await tapSel(pg, '[data-action=phone-back]');
  await pg.waitForFunction(() => document.querySelector('[data-role=phone]').dataset.view === 'mission', null, { timeout: 10000 }).catch(() => {});
  await sleep(1200);
  p = await pg.evaluate(PH_PROBE);
  const ui = p.nodes.find((x) => x.name === P('ui')) || {};
  check(`[${E}] 돌아오면 같은 자리·배율`, JSON.stringify(p.view) === JSON.stringify(before.view) && Math.abs(ui.x - before.ui.x) <= 1 && Math.abs(ui.y - before.ui.y) <= 1, { before, after: { view: p.view, ui } });
  await F.pan(ui.x + ui.w / 2, ui.y + ui.h / 2, 40, 30); await sleep(700);
  check(`[${E}] 카드 위에서 시작해 옮기면 열리지 않는다`, (await viewOf(pg)) === 'mission', await viewOf(pg));
  await tapSel(pg, '[data-action=pm-fit]'); await sleep(300);
}
const longestColumn = (ns) => { const m = new Map(); for (const x of ns) m.set(Math.round(x.x / 20), (m.get(Math.round(x.x / 20)) || 0) + 1); return Math.max(0, ...m.values()); };
// 서로 이은 두 세션(휴대폰): 두 줄이 두 카드의 마주 보는 가장자리 사이에 든다
function phonePair(p, a, b) {
  const A = p.nodes.find((x) => x.name === a), B = p.nodes.find((x) => x.name === b);
  if (!A || !B) return { ok: false, why: 'missing' };
  const es = p.edges.filter((e) => (e.from === A.id && e.to === B.id) || (e.from === B.id && e.to === A.id));
  if (es.length !== 2) return { ok: false, why: 'lines', n: es.length, ids: [A.id, B.id], edges: p.edges.filter((e) => [A.id, B.id].includes(e.from) || [A.id, B.id].includes(e.to)) };
  const left = A.x <= B.x ? A : B, right = left === A ? B : A, top = A.y <= B.y ? A : B, bottom = top === A ? B : A;
  const horiz = right.x >= left.x + left.w - 2;
  const lo = horiz ? left.x + left.w - 3 : top.y + top.h - 3, hi = horiz ? right.x + 3 : bottom.y + 3;
  const ok = es.every((e) => e.pair && (horiz ? e.box.x >= lo && e.box.x + e.box.w <= hi : e.box.y >= lo && e.box.y + e.box.h <= hi));
  return { ok, horiz, lo, hi, boxes: es.map((e) => ({ route: e.route, pair: e.pair, box: e.box })) };
}
async function phone(E) {
  const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
  const sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const browser = E === 'webkit' ? await webkit.launch({ headless: true }) : await launchChromium();
  const mem = {};
  try {
    for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
    const ctx = await browser.newContext(PHONE);
    await ctx.addInitScript(WS_HOOK); await ctx.addInitScript(TOUCH_HOOK);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[${E} pageerror] ${e.message}`));
    const cdp = E === 'chromium' ? await ctx.newCDPSession(pg) : null;
    if (cdp) await cdp.send('Performance.enable').catch(() => {});
    const readMem = async (label) => { await sleep(1500); if (E === 'webkit') mem[label] = { webkitMB: webkitMB() }; else { const m = await cdp.send('Performance.getMetrics').catch(() => null); const v = m && m.metrics.find((x) => x.name === 'JSHeapUsedSize'); mem[label] = { heapMB: v ? Math.round(v.value / 1048576) : null }; } log(`[${E}] 메모리 ${label} ${JSON.stringify(mem[label])}`); };
    await pair(pg, `http://localhost:${B0.sim}`);
    await sleep(2500);
    // 세션 목록과 새 세션 시트(미션 맵 밖 화면: 고치기 전·뒤가 같아야 한다)
    await pg.evaluate(() => { const s = document.querySelector('[data-role=phone-scroll]'); if (s) s.scrollTop = 0; });
    await shot(pg, `${E}-${TAG}-00-list`);
    const listPrint = await pg.evaluate(`${STYLE_PRINT}('[data-role=phone-list]')`);
    await tapSel(pg, '[data-action=phone-new]'); await sleep(900);
    await shot(pg, `${E}-${TAG}-00-sheet`);
    const sheetPrint = await pg.evaluate(`${STYLE_PRINT}('[data-role=phone-spawn]')`);
    fs.writeFileSync(path.join(OUT, `p101-style-${E}-${TAG}.json`), JSON.stringify({ list: listPrint, sheet: sheetPrint }, null, 1));
    await tapSel(pg, '[data-action=phone-spawn-close]'); await sleep(600);
    if (AFTER) {
      const was = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, `p101-style-${E}-before.json`), 'utf8')); } catch { return null; } })();
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      check(`[${E}] 휴대폰 세션 목록의 모양이 고치기 전과 같다(계산된 CSS)`, was && same(was.list, listPrint), was ? { before: (was.list || []).length, after: (listPrint || []).length, diff: (listPrint || []).filter((x, i) => !was.list || was.list[i] !== x).slice(0, 4) } : 'no before');
      check(`[${E}] 새 세션 시트의 모양이 고치기 전과 같다(계산된 CSS)`, was && same(was.sheet, sheetPrint), was ? { before: (was.sheet || []).length, after: (sheetPrint || []).length, diff: (sheetPrint || []).filter((x, i) => !was.sheet || was.sheet[i] !== x).slice(0, 4) } : 'no before');
    }
    await readMem('list');
    const t0 = await nowIn(pg);
    await pg.tap('[data-action=phone-mission]');
    await pg.waitForFunction(() => document.querySelectorAll('[data-role=pm-node]').length >= 10, null, { timeout: 20000 }).catch(() => {});
    await sleep(2500);
    let p = await pg.evaluate(PH_PROBE);
    log(`[${E}] 그래프 ${JSON.stringify({ nodes: p.nodes.map((x) => `${x.name}:${x.rank}/${x.family}/${x.tier}/${x.shape}`), groups: p.groups.map((g) => `${g.name}${g.vg ? `[${g.vg}]` : ''}`), edges: p.edges.map((e) => `${e.rel || e.kind}${e.route ? `/${e.route}` : ''}`), view: p.view })}`);
    await shot(pg, `${E}-${TAG}-01-portrait`);
    if (!AFTER) { const links = p.edges.filter((e) => e.kind === 'link' && e.box.w > 0).map((e) => ({ ...e.box, label: 'detour' })); const rows = p.nodes.filter((x) => x.shape === 'row').slice(0, 2).map((x) => ({ x: x.x, y: x.y, w: x.w, h: x.h, label: 'no border' })); await pg.evaluate(MARK, [...links, ...rows]); await shot(pg, `${E}-${TAG}-01-portrait-marked`); await pg.evaluate(UNMARK); }
    if (AFTER) {
      const n = (name) => p.nodes.find((x) => x.name === name) || {};
      check(`[${E}] 세션 17개`, p.nodes.length === 17, p.nodes.length);
      check(`[${E}] PC와 같은 역할 분류: 리드 둘, reviewer는 review, e는 solo`, n(P('lead')).rank === 'lead' && n(P('lead2')).rank === 'lead' && n(P('rev')).family === 'review' && n(P('rev')).rank === 'sub' && n(P('e')).rank === 'solo', p.nodes.map((x) => `${x.name}:${x.rank}/${x.family}`));
      check(`[${E}] 리드 → 하위는 왼쪽 → 오른쪽(PC와 같다)`, n(P('rev')).x > n(P('lead')).x && n(P('port')).x > n(P('lead2')).x, [P('lead'), P('rev'), P('lead2'), P('port')].map((x) => [x, n(x).x]));
      check(`[${E}] 가상 그룹 이름(product)이 a·b 머리 글에`, p.groups.filter((g) => /product/.test(g.vg || '')).length === 2, p.groups.map((g) => [g.name, g.vg]));
      check(`[${E}] 범례 없음, 겹침 없음, 페이지 가로 스크롤 없음, 배율 1 근처`, !p.legend && !overlap(p.nodes) && p.page.sw <= p.page.iw && p.view && p.view.zoom >= 0.95, { legend: p.legend, overlap: overlap(p.nodes), page: p.page, view: p.view });
      const rows = p.nodes.filter((x) => x.shape === 'row');
      check(`[${E}] 쉬는·잠든 세션(알약)도 테두리가 보인다`, rows.length >= 5 && rows.every((x) => x.border.w >= 1), rows.map((x) => `${x.name}:${x.border.w}/${x.border.c}`));
      check(`[${E}] 워크스페이스 판이 보인다`, p.plates >= 8, p.plates);
      for (const [a, b] of [['lead', 'rev'], ['lead2', 'port'], ['tests', 'build']]) { const r = phonePair(p, P(a), P(b)); check(`[${E}] ${a} ↔ ${b}: 마주 보는 가장자리 사이 짧은 두 줄`, r.ok, r); }
      const big = p.edges.filter((e) => e.box.x + e.box.w > p.stage.x + p.stage.w - 2);
      check(`[${E}] 화면 오른쪽 밖으로 도는 선이 없다`, big.length === 0, big);
      const work = p.nodes.filter((x) => x.tier === 'work');
      check(`[${E}] 휴대폰 일하는 카드는 번쩍임 하나(P102, steps로 가볍게)`, work.length >= 3 && work.every((x) => x.anims === 1), work.map((x) => `${x.name}:${x.anims}`));
    }
    if (AFTER) await gestures(pg, cdp, E, t0);
    await readMem('mission');
    // 테두리 움직임의 값(휴대폰): 10초 동안 WebKit 웹 프로세스 CPU(움직임 켬 / 움직임 줄이기)
    if (E === 'webkit') {
      await tapSel(pg, '[data-action=pm-fit]'); await sleep(500);
      const anims = await pg.evaluate(() => document.getAnimations().length);
      const c0 = webkitCpuMs(); await sleep(10000); const c1 = webkitCpuMs();
      await pg.emulateMedia({ reducedMotion: 'reduce' }); await sleep(500);
      const c2 = webkitCpuMs(); await sleep(10000); const c3 = webkitCpuMs();
      await pg.emulateMedia({ reducedMotion: 'no-preference' });
      mem.cpu = { anims, onMs: c1 - c0, offMs: c3 - c2 };
      log(`[${E}] 10초 CPU ${JSON.stringify(mem.cpu)}`);
    }
    await pg.setViewportSize({ width: H, height: W }); await sleep(1500);
    p = await pg.evaluate(PH_PROBE);
    await shot(pg, `${E}-${TAG}-02-landscape`);
    if (AFTER) check(`[${E}] 가로 화면: 칸이 넷(카드가 세 기둥 넘게), 겹침 없음`, new Set(p.nodes.filter((x) => x.shape !== 'dot').map((x) => Math.round(x.x / 20))).size >= 3 && !overlap(p.nodes), [...new Set(p.nodes.map((x) => x.x))]);
    await pg.setViewportSize({ width: W, height: H }); await sleep(1200);
    // 판 B: 실제 판 모양
    await pg.evaluate(HOOK, ['real', 0]);
    await pg.tap('[data-action=phone-mission-back]'); await sleep(600); await pg.evaluate(() => window.__mtPhone.mission());
    await pg.waitForFunction(() => document.querySelectorAll('[data-role=pm-node]').length >= 14, null, { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    p = await pg.evaluate(PH_PROBE);
    await shot(pg, `${E}-${TAG}-03-real`);
    if (AFTER) check(`[${E}] 실제 판 모양(16개): 세로 한 줄이 아니다, 한 화면 높이 안팎`, p.nodes.length === 16 && longestColumn(p.nodes) <= Math.ceil(p.nodes.length * 2 / 3) && p.world.h <= p.stage.h * 1.2 && !overlap(p.nodes), { n: p.nodes.length, longest: longestColumn(p.nodes), world: p.world, stage: p.stage });
    // 큰 판
    await pg.evaluate(UNHOOK);
    await pg.evaluate(HOOK, ['big', 25]);
    await pg.tap('[data-action=phone-mission-back]'); await sleep(600); await pg.evaluate(() => window.__mtPhone.mission());
    await pg.waitForFunction(() => document.querySelectorAll('[data-role=pm-node]').length >= 30, null, { timeout: 20000 }).catch(() => {});
    await sleep(2000);
    p = await pg.evaluate(PH_PROBE);
    await shot(pg, `${E}-${TAG}-04-big`);
    if (AFTER) check(`[${E}] 큰 판(42개): 겹침 없음`, p.nodes.length === 42 && !overlap(p.nodes), { n: p.nodes.length, overlap: overlap(p.nodes) });
    if (AFTER) {
      const F = fingers(pg, cdp), t1 = Date.now();
      await F.pan(p.stage.x + p.stage.w / 2, p.stage.y + p.stage.h / 2, 0, -200, 40);
      const per = Math.round(((Date.now() - t1) / 42) * 10) / 10;
      check(`[${E}] 큰 판에서도 손가락 움직임 하나가 빠르다(${per}ms)`, per < 40, { per });
    }
    const sx = p.stage.x + p.stage.w / 2, sy = p.stage.y + p.stage.h / 2;
    if (cdp) {
      for (let i = 0; i < 20; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy + 100, id: 1 }] });
        for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy + 100 - k * (i % 2 ? -20 : 20), id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
    }
    await readMem('big');
    if (E === 'webkit') check(`[${E}] WebKit 웹 프로세스 메모리(목록 → 관계도 → 큰 판)가 P89 수준(늘어남 100MB 안)`, !AFTER || mem.big.webkitMB - mem.list.webkitMB < 100, mem);
    fs.writeFileSync(path.join(OUT, `p101-mem-${E}-${TAG}.json`), JSON.stringify(mem, null, 1));
    await pg.evaluate(UNHOOK);
    await ctx.close();
  } finally { await browser.close().catch(() => {}); await sim.close().catch(() => {}); }
}

async function stopBoard() {
  for (const s of sessions().filter((x) => /^p101-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
  await sleep(2000);
  try { log(atrium('backend', 'stop').slice(0, 200)); } catch (e) { log(`backend stop ${e.message.slice(0, 120)}`); }
}

try {
  if (WHAT === 'setup') { await setupBoard(); await stir(); }
  else if (WHAT === 'stir') await stir();
  else if (WHAT === 'pc') { await stir(); await pc(); }
  else if (WHAT === 'pc2560') { await stir(); await pc(2560, 1440, 'pc2560'); }
  else if (WHAT === 'web') { await stir(); await web(); }
  else if (WHAT === 'webkit' || WHAT === 'chromium') { await stir(); await phone(WHAT); }
  else if (WHAT === 'stop') await stopBoard();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, `p101-${WHAT}-${TAG}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
