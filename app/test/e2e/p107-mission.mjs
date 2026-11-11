// P107 창 시험: 작업 중 테두리 빛. 미션 맵의 일하는 카드 테두리를 따라 도는 빛(P102 번쩍임을 갈음)과 판 노드 둘레(.mt-node-run)가 판 설정 workLight를 따르는지. PC 창 1920·2560, PC 웹, 휴대폰 WebKit·Chromium. 한 번에 한 화면만 돌린다(메모리).
// 사용자의 PC는 Windows "애니메이션 효과"가 꺼져 있어 창이 prefers-reduced-motion: reduce다. PC 창·웹 시험은 reduce와 no-preference 둘 다로 돈다(넷째 인자).
// 판: 따로 띄운 개발용 판(atrium-dev-p107, 47896, backend/.dev)만 쓴다. 흉내 원격(p59-lib.mjs, ts-sim-proxy.mjs) 47986·47985.
//   판 A(실제 세션): 워크스페이스 10개(mtask-p107-a…j). 리드 p107-lead(a, haiku, 권한 질문 = 응답 필요), 하위 p107-rev(haiku, reviewer, ping = 일함),
//     역할 선 p107-tests(ping 도는 셸 = 일함)·p107-build(셸, 창 안에서 오류로 흉내), 잠든 p107-old(d, haiku), 셸 p107-docs(c)·p107-e…j(혼자)
//   판 B(실제 판 모양): 페이지 안에서 mission.graph 답을 워크스페이스 12개, 일하는 세션 다섯(셸 하나)과 응답 필요·오류·결과·쉼·잠듦·끝남이 섞인 흉내 판으로 바꾼다.
//   큰 판: mission.graph 답에 흉내 세션 25개를 더한다. 많은 판(값 재기): 일하는 카드 40개.
// 목업(mockpc·mockphone): 고치기 전 빌드의 번쩍임 층(.mt-mm-flash·.mt-pm-flash) 안에 네 방법(S SVG dashoffset, O offset-path, C @property conic, T transform 키프레임)을 덧입혀
//   같은 장면의 프레임·멀리서 본 값과 값(주 스레드, 프레임 시간, 창 렌더러·GPU 프로세스 CPU, WebKit CPU)을 잰다.
// 판 둘레 값(ringcost): 판에 일하는 노드 40개(창 안 흉내)와 미션 맵 덮개(일하는 카드 40개)에서 덮개 뒤 둘레를 멈출 때·돌 때, 판 둘레 부드럽게·steps의 GPU를 잰다.
// 실행(실제 판의 변수를 지운 셸로): sh backend/.dev/clean-env.sh node app/test/e2e/p107-mission.mjs <setup|stir|restart|mockpc|mockphone|tunepc|phonetune|pc|pc2560|web|webkit|chromium|ringcost|memwebkit|compose|stop> [before|after] [reduce|no-preference]
// 결과는 주 체크아웃의 experiments/p107/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const TAG = process.argv[3] || 'after';
const MOTION = process.argv[4] === 'reduce' ? 'reduce' : 'no-preference';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const MAIN = /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) ? path.resolve(REPO, '..', '..', '..') : REPO; // 워크트리면 주 체크아웃
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(MAIN, 'experiments', 'p107');
const P102 = path.join(MAIN, 'experiments', 'p102');
const CONVOS = path.join(OUT, 'convos');
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const DIRS = LETTERS.map((k) => `C:\\Workspace\\mtask-p107-${k}`);
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
process.env.MT_E2E_OUT = path.relative(path.join(REPO, 'experiments'), OUT);
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A } = L;
const B0 = L.board({ session: 'atrium-dev-p107', port: 47896, sim: 47986, sim2: 47985 });
const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p107-none-',
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

// 시험 창이 다른 창에 가려지거나 화면이 꺼져도 그리기를 늦추지 않는다(가려지면 rAF가 초당 1번이 되어 값과 박자가 틀렸다)
const AWAKE = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
const MT = MOTION === 'reduce' ? 'rm' : 'np';
// 시험 창(Electron)을 모든 화면 밖에 둔다: 사용자가 PC를 쓰는 동안 앞에 뜬 시험 창을 최소화해 그리기가 멈췄다(P107). 가려져도 그리게 하는 스위치(AWAKE)와 함께 쓴다.
// 최소화되면 화면 밖에서 되살린다(읽기 전에 부른다)
let APP = null;
async function awayWin(app) {
  APP = app;
  return app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; if (!w) return null; const ds = screen.getAllDisplays(); const left = Math.min(...ds.map((d) => d.bounds.x)); const b = w.getBounds(); w.setPosition(left - b.width - 200, 40); return w.getBounds(); }).catch((e) => ({ err: e.message }));
}
async function ensureShown() {
  if (!APP) return null;
  return APP.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (!w) return null; const was = w.isMinimized(); if (was) { w.restore(); w.showInactive(); } return { was, min: w.isMinimized() }; }).catch(() => null);
} // 그림·값 이름의 움직임 표시
const log = logger(`p107-${WHAT}-${TAG}${['pc', 'pc2560', 'web', 'webkit', 'chromium', 'ringcost'].includes(WHAT) ? `-${MT}` : ''}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const shot = (pg, name, opt = {}) => pg.screenshot({ path: path.join(OUT, `${name}.png`), ...opt }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
const AFTER = TAG === 'after';
const P = (k) => `p107-${k}`;
const save64 = (name, b64) => fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(b64, 'base64'));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// ---- 판 A ----
const LONG = (n) => `Use the Bash tool to run this command in the foreground, not in the background, with timeout 600000: ping -n ${n} 127.0.0.1 . Wait for it to finish. Then reply with the single word done.`;
const ASK = 'Use the Bash tool to run exactly: mkdir p107-ask-dir . Then reply with the single word done.';
const envOf = (name) => {
  const s = byName(name);
  const settings = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'sessions', `${s.sessionId || s.id}.json`), 'utf8'));
  const e = { ...process.env, ...Object.fromEntries(Object.entries(settings.env || {}).filter(([k]) => k.startsWith('ATRIUM_'))) };
  if (!e.ATRIUM_SESSION_ID || !e.ATRIUM_SESSION_TOKEN) throw new Error(`${name}: 설정 파일에 세션 env가 없다`);
  return e;
};
const child = (pe, args, ms = 150000) => new Promise((resolve) => execFile(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), ...args], { encoding: 'utf8', env: pe, timeout: ms }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout || ''}${stderr || ''}`.trim() })));
const trustStop = () => {
  const tr = sessions().find((s) => /^p107-/.test(s.name) && s.state === 'trust_wait');
  if (tr) { fs.writeFileSync(path.join(DEV, 'p107-need-trust.txt'), `${tr.name} asks the folder trust question in a test folder\n`); throw new Error('trust question (backend/.dev/p107-need-trust.txt)'); }
};
const readyOf = (n, ms = 150000) => until(() => { const s = byName(n); return s && ['ready', 'working', 'waiting', 'trust_wait'].includes(s.state) ? s : null; }, ms, 1500).catch(() => null);
const LINKS = [['lead', 'tests', 'test runner'], ['lead', 'build', 'build worker'], ['rev', 'lead', 'report'], ['rev', 'old', 'archive']];

async function setupBoard() {
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  fs.mkdirSync(path.join(DIRS[0], '.claude'), { recursive: true });
  fs.writeFileSync(path.join(DIRS[0], '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ping:*)', 'Bash(ping *)'] } }, null, 1)); // ping만 묻지 않는다(P85)
  const spawnIn = (dir, ...a) => JSON.parse(atrium('--json', 'spawn', dir, ...a));
  if (!byName(P('lead'))) spawnIn(DIRS[0], '--model', 'haiku', '--name', P('lead'));
  if (!byName(P('old'))) spawnIn(DIRS[3], '--model', 'haiku', '--name', P('old')); // 셸은 잠들지 않으므로 haiku(P94)
  for (const [n, wi] of [['tests', 0], ['build', 0], ['docs', 2], ['e', 4], ['f', 5], ['g', 6], ['h', 7], ['i', 8], ['j', 9], ['b', 1]]) if (!byName(P(n))) spawnIn(DIRS[wi], '--kind', 'shell', '--name', P(n));
  await readyOf(P('lead')); await readyOf(P('old')); trustStop();
  if (!byName(P('rev'))) log('child rev', (await child(envOf(P('lead')), ['child', P('rev'), '--role', 'reviewer', '--model', 'haiku', '--no-wait'])).out.slice(0, 300));
  await readyOf(P('rev')); trustStop();
  const linked = (a, b) => call('link.list').some((l) => l.from === byName(a).sessionId && l.to === byName(b).sessionId && l.role);
  for (const [a, b, role] of LINKS) {
    try { if (!linked(P(a), P(b))) atrium('link', P(a), P(b), '--role', role); } catch (e) { log(`연결 ${a} → ${b} ${e.message.slice(0, 120)}`); }
  }
  await sleep(2000);
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
  if (byName(P('rev')).state !== 'working') atrium('send', `@${P('rev')}`, LONG(590));
  if (byName(P('lead')).state !== 'waiting') atrium('send', `@${P('lead')}`, ASK);
  await until(() => byName(P('rev')).state === 'working' && byName(P('lead')).state === 'waiting' && (byName(P('tests')).shell || {}).atPrompt === false, 150000, 1500).catch(() => {});
  log(`세션 ${sessions().filter((s) => /^p107-/.test(s.name)).map((s) => `${s.name}:${s.state}${s.shell ? `/${s.shell.atPrompt === false ? 'run' : 'idle'}` : ''}`).join(' ')}`);
}
// 창 안에서 build를 오류로 흉내 낸다(P93)
const FAKE_ERR = () => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p107-build'); if (s) window.__mt.api.emit('session.updated', { ...s, state: 'error', error: { message: 'exit 1: build failed' }, lastActivityAt: Date.now() - 60000 }); return !!s; };

// ---- 흉내 판(페이지 안에서 mission.graph 답을 바꾼다) ----
const HOOK = ([mode, n]) => {
  const api = window.__mt.api;
  if (!api.__p107orig) api.__p107orig = api.call.bind(api);
  const now = Date.now();
  const ws = ['multitask', 'blog', 'artex-ko', 'notes', 'scraper', 'infra', 'dotfiles', 'research', 'api', 'site', 'landing', 'paper'].map((x) => `C:/Workspace/fake-${x}/.git`);
  const S = (i, name, w, o = {}) => ({ id: `s:fk${i}`, kind: 'session', sessionId: `fk${i}`, name, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: ws[w], parentId: null, role: null, order: null, createdAt: 1e12 + i, loops: 0, model: 'claude-opus-5-5', effort: 'high', activeAt: now - (i + 1) * 7e5, turnAt: null, gitBranch: null, ...o });
  const W = (o) => ({ state: 'working', category: 'working', turnAt: now - 9e5, ...o });
  const real = () => {
    const nodes = [{ id: 'human', kind: 'human', name: 'you' },
      S(0, 'conductor', 0, W({ model: 'claude-fable-5-1', turnAt: now - 72e5, lastPrompt: 'Merge P107 when the worker reports' })),
      S(1, 'p107', 0, W({ parentId: 's:fk0', role: 'border light', gitBranch: 'worktree-p107', lastPrompt: 'Make working sessions glow along the border' })),
      S(2, 'p103', 0, { parentId: 's:fk0', role: 'sidebar tree' }),
      S(3, 'p101', 0, { parentId: 's:fk0', role: 'mission tidy', state: 'exited', category: 'exited' }),
      S(4, 'reviewer', 0, { parentId: 's:fk0', role: 'reviewer', category: 'done' }),
      S(5, 'blog', 1, { model: 'claude-sonnet-5-5', effort: null }),
      S(6, 'artex', 2, W({ lastPrompt: 'Translate chapter 4' })), S(7, 'artex-copy', 2),
      S(8, 'notes', 3, { state: 'waiting', category: 'needs_you', ask: 'Delete this file?' }),
      S(9, 'scraper', 4, { state: 'error', category: 'needs_you', model: 'claude-haiku-4-5' }),
      S(10, 'infra', 5, W({ agentKind: 'shell', state: 'shell_running', model: null })),
      S(11, 'dotfiles', 6, { state: 'sleeping' }), S(12, 'research', 7, { state: 'sleeping' }),
      S(13, 'api', 8, W({ lastPrompt: 'npm test' })), S(14, 'site', 9, { agentKind: 'shell', state: 'shell_idle', model: null }),
      S(15, 'landing', 10, { state: 'exited', category: 'exited' }), S(16, 'paper', 11), S(17, 'paper-codex', 11, { agentKind: 'codex', model: 'gpt-6', state: 'sleeping' })];
    const edges = [{ from: 's:fk0', to: 's:fk1', kind: 'spawn' }, { from: 's:fk0', to: 's:fk2', kind: 'spawn' }, { from: 's:fk0', to: 's:fk3', kind: 'spawn' }, { from: 's:fk0', to: 's:fk4', kind: 'role', label: 'reviewer' }, { from: 'human', to: 's:fk0', kind: 'bar', count: 4 },
      { from: 's:fk1', to: 's:fk0', kind: 'prompt', label: 'p107 done', count: 1, lastAt: now - 6e5 }, { from: 's:fk4', to: 's:fk1', kind: 'role', label: 'review' },
      { from: 's:fk6', to: 's:fk7', kind: 'role', label: 'copy' }, { from: 's:fk7', to: 's:fk6', kind: 'prompt', label: 'copy done', count: 1, lastAt: now - 3e6 }];
    return { nodes, edges, counts: { all: nodes.length - 1 }, at: now };
  };
  // 많은 판: 일하는 카드 n개(값 재기). 워크스페이스 열둘에 고르게, 여섯에 하나는 셸
  const many = (k) => {
    const nodes = [{ id: 'human', kind: 'human', name: 'you' }];
    for (let i = 0; i < k; i++) nodes.push(S(100 + i, `run-${String(i).padStart(2, '0')}`, i % 12, W(i % 6 === 5 ? { agentKind: 'shell', state: 'shell_running', model: null } : { lastPrompt: `task ${i}` })));
    return { nodes, edges: [], counts: { all: k }, at: now };
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
      const wk = i <= 9 ? keys[0] : i <= 18 ? keys[1 % keys.length] : keys[i % keys.length];
      const state = lead ? 'ready' : st[i % st.length];
      nodes.push({ id: `s:big${i}`, kind: 'session', sessionId: `big${i}`, name: `big-${String(i).padStart(2, '0')}`, agentKind: i % 4 === 3 ? 'shell' : i % 5 === 1 ? 'codex' : 'claude', state, category: cat(state), workspaceKey: wk, parentId: parent, role: parent ? roles[i % roles.length] : null, order: i, createdAt: 1e12 + i, loops: 0, model: i % 4 === 3 ? null : 'claude-haiku-4-5', activeAt: now - i * 6e5, turnAt: state === 'working' ? now - i * 6e4 : null });
      if (parent) edges.push({ from: parent, to: `s:big${i}`, kind: 'spawn', label: null, active: false });
    }
    edges.push({ from: 's:big1', to: 's:big0', kind: 'prompt', label: 'report', count: 2, active: false });
    return { ...g, nodes, edges };
  };
  api.call = (m, p) => (m === 'mission.graph' ? (mode === 'real' ? Promise.resolve(real()) : mode === 'many' ? Promise.resolve(many(n)) : api.__p107orig(m, p).then(big)) : api.__p107orig(m, p));
};
const UNHOOK = () => { const api = window.__mt.api; if (api.__p107orig) api.call = api.__p107orig; };

// ---- 움직임 읽기: 카드마다 도는 움직임과 키프레임의 속성 ----
const ANIM_OF = `((root) => (root.getAnimations ? root.getAnimations({ subtree: true }) : []).map((a) => {
  const ef = a.effect, tm = ef && ef.getTiming ? ef.getTiming() : {}, ks = ef && ef.getKeyframes ? ef.getKeyframes() : [];
  const props = [...new Set(ks.flatMap((k) => Object.keys(k).filter((x) => !['offset', 'computedOffset', 'easing', 'composite'].includes(x))))];
  const dur = typeof tm.duration === 'number' ? tm.duration : parseFloat(tm.duration) || 0;
  const phase = dur && a.currentTime !== null ? Math.round((((a.currentTime - (tm.delay || 0)) % dur) + dur) % dur) : null;
  return { name: a.animationName || null, pseudo: ef && ef.pseudoElement || null, props, dur, delay: tm.delay || 0, easing: tm.easing || null, state: a.playState, phase, ct: a.currentTime === null ? null : Math.round(a.currentTime) };
}))`;

// ---- 멀리서 본 그림: 스크린숏을 줄여(1/4) 카드마다 평균 색과 가장 밝은 점을 잰다(페이지 안 캔버스) ----
const FAR = async ([b64, boxes, scale, vw]) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const dpr = img.width / vw, W = Math.max(1, Math.round(img.width * scale / dpr)), H = Math.max(1, Math.round(img.height * scale / dpr));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const pad = 3; // 카드 둘레 빛(바깥으로 번진 것)까지 1/4 그림에서 3px
  const stat = (b) => { const x0 = Math.max(0, Math.round(b.x * scale) - pad), y0 = Math.max(0, Math.round(b.y * scale) - pad), x1 = Math.min(W, Math.round((b.x + b.w) * scale) + pad), y1 = Math.min(H, Math.round((b.y + b.h) * scale) + pad); let r = 0, g = 0, bl = 0, n = 0, mx = 0, sat = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * W + xx) * 4; r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; const Lx = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]); if (Lx > mx) mx = Lx; const s = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); if (s > sat) sat = s; }
    if (!n) return null; r /= n; g /= n; bl /= n; return { rgb: [Math.round(r), Math.round(g), Math.round(bl)], L: Math.round((0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl)) * 10000) / 10000, peakL: Math.round(mx * 10000) / 10000, peakSat: sat }; };
  return { thumb: c.toDataURL('image/png').split(',')[1], w: W, h: H, cards: boxes.map((b) => ({ name: b.name, tier: b.tier, ...stat(b) })) };
};
// 여러 그림을 이름표와 함께 한 장에(페이지 안 캔버스)
const COMPOSE = async ([items, cols, pad]) => {
  const imgs = await Promise.all(items.map(async (it) => { const im = new Image(); im.src = 'data:image/png;base64,' + it.b64; await im.decode(); return { im, label: it.label }; }));
  const cw = Math.max(...imgs.map((x) => x.im.width)), ch = Math.max(...imgs.map((x) => x.im.height)) + 26;
  const rows = Math.ceil(imgs.length / cols);
  const c = document.createElement('canvas'); c.width = cols * (cw + pad) + pad; c.height = rows * (ch + pad) + pad;
  const x = c.getContext('2d'); x.fillStyle = '#222'; x.fillRect(0, 0, c.width, c.height);
  imgs.forEach((it, i) => { const cx = pad + (i % cols) * (cw + pad), cy = pad + Math.floor(i / cols) * (ch + pad); x.fillStyle = '#fff'; x.font = '600 15px sans-serif'; x.fillText(it.label, cx, cy + 17); x.drawImage(it.im, cx, cy + 26); });
  return c.toDataURL('image/png').split(',')[1];
};
const cr = (a, b) => { const [h, l] = a > b ? [a, b] : [b, a]; return Math.round(((h + 0.05) / (l + 0.05)) * 100) / 100; };
// 멀리서 본 값 요약: 평균 밝기 대비(면), 가장 밝은 점 대비(빛), 응답 필요·오류와의 색 거리
function farSummary(f) {
  const by = (t) => f.cards.filter((c) => c && c.L !== undefined && (Array.isArray(t) ? t.includes(c.tier) : c.tier === t));
  const avg = (xs, k) => (xs.length ? xs.reduce((a, c) => a + c[k], 0) / xs.length : 0);
  const rgbAvg = (xs) => [0, 1, 2].map((i) => (xs.length ? Math.round(xs.reduce((a, c) => a + c.rgb[i], 0) / xs.length) : 0));
  const work = by('work'), other = by(['rest', 'sleep', 'done', 'review']), turn = by('turn'), alert = by('alert');
  const dist = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  const wRgb = rgbAvg(work);
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  return { workL: r4(avg(work, 'L')), otherL: r4(avg(other, 'L')), contrast: cr(avg(work, 'L'), avg(other, 'L')), workPeakL: r4(avg(work, 'peakL')), otherPeakL: r4(avg(other, 'peakL')), turnPeakL: r4(avg(turn, 'peakL')), alertPeakL: r4(avg(alert, 'peakL')), peakContrast: cr(avg(work, 'peakL'), avg(other, 'peakL')), workRgb: wRgb, turnRgb: rgbAvg(turn), alertRgb: rgbAvg(alert), dTurn: turn.length ? dist(wRgb, rgbAvg(turn)) : null, dAlert: alert.length ? dist(wRgb, rgbAvg(alert)) : null };
}

async function openMission(pg) {
  if (await pg.$('[data-action="return-close"]')) { await pg.click('[data-action="return-close"]').catch(() => {}); await sleep(300); }
  if (await pg.$('[data-role="mission"]')) { await pg.keyboard.press('Escape'); await sleep(400); }
  await pg.click('[data-action="mission-rail"]');
  await pg.waitForSelector('[data-role="mission"] [data-role="mm-node"], [data-role="mission"] [data-role="mm-group"]', { timeout: 20000 });
  await sleep(1800);
}
const nodeBy = (p, name) => p.nodes.find((x) => x.name === name) || {};

// ---- 지도 읽기(PC). 빛 층은 P107 .mt-mm-light(data-role mm-light), 고치기 전 빌드는 P102 .mt-mm-flash ----
const PC_PROBE = `(() => {
  const m = document.querySelector('[data-role=mission]');
  if (!m) return null;
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const animOf = ${ANIM_OF};
  const nodes = [...m.querySelectorAll('[data-role=mm-node][data-kind=session]')].map((e) => { const s = getComputedStyle(e); const li = e.querySelector('[data-role=mm-light]'); const fl = e.querySelector('[data-role=mm-flash]'); const ls = li ? getComputedStyle(li) : null;
    const parts = li ? [...li.children].filter((x) => getComputedStyle(x).display !== 'none').length : 0;
    return { name: e.dataset.name, tier: e.dataset.tier || null, shape: e.dataset.shape || null, shell: e.classList.contains('shell'), recede: e.classList.contains('recede'), fdim: e.classList.contains('fdim'),
      border: { w: parseFloat(s.borderTopWidth) || 0, c: s.borderTopColor, style: s.borderTopStyle }, light: !!li, flash: !!fl, parts,
      lightStyle: ls ? { opacity: ls.opacity, borderW: parseFloat(ls.borderTopWidth) || 0, borderC: ls.borderTopColor, bg: ls.backgroundColor } : null,
      anims: animOf(e), ...R(e) }; });
  const sum = m.querySelector('[data-role=mm-summary]');
  const sec = (k) => (sum && sum.querySelector('[data-role=mm-sum-' + k + ']')) ? [...sum.querySelectorAll('[data-role=mm-sum-' + k + '] [data-role=mm-sum-item]')].map((e) => e.dataset.name) : [];
  const body = m.querySelector('.mt-mission-body');
  return { nodes, summary: sum ? { turn: sec('turn'), work: sec('work') } : null, body: body ? { w: body.clientWidth, h: body.clientHeight, sh: body.scrollHeight, sw: body.scrollWidth } : null, mode: document.documentElement.dataset.workLight || null, lite: document.documentElement.classList.contains('mt-lite'), reduce: matchMedia('(prefers-reduced-motion: reduce)').matches };
})()`;
// 휴대폰 지도 읽기
const PH_PROBE = `(() => {
  const st = document.querySelector('[data-role=pm-stage]');
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const animOf = ${ANIM_OF};
  const nodes = [...document.querySelectorAll('[data-role=pm-node]')].map((e) => { const s = getComputedStyle(e); const li = e.querySelector('[data-role=pm-light]'); const fl = e.querySelector('[data-role=pm-flash]'); const ls = li ? getComputedStyle(li) : null;
    const parts = li ? [...li.children].filter((x) => getComputedStyle(x).display !== 'none').length : 0;
    return { name: e.dataset.name, tier: e.dataset.tier, shape: e.dataset.shape || null, dim: e.classList.contains('dim'), border: { w: parseFloat(s.borderTopWidth) || 0, c: s.borderTopColor }, light: !!li, flash: !!fl, parts,
      lightStyle: ls ? { opacity: ls.opacity, borderW: parseFloat(ls.borderTopWidth) || 0, borderC: ls.borderTopColor, bg: ls.backgroundColor } : null,
      anims: animOf(e), ...R(e) }; });
  const world = document.querySelector('[data-role=pm-world]');
  return { nodes, stage: st ? R(st) : null, world: world ? R(world) : null, view: window.__mtPm ? window.__mtPm.view() : null, page: { sw: document.documentElement.scrollWidth, iw: innerWidth }, docAnims: document.getAnimations().length, mode: document.documentElement.dataset.workLight || null, reduce: matchMedia('(prefers-reduced-motion: reduce)').matches };
})()`;
const boxesOf = (p) => p.nodes.filter((n) => n.w > 0).map((n) => ({ name: n.name, tier: n.tier, x: n.x, y: n.y, w: n.w, h: n.h }));

// ---- 한 순간에 멈추기: 이름이 맞는 움직임을 멈추고 주기에 대한 비율(frac)의 자리로. 지연이 있으면 active time = currentTime - delay ----
const LIGHT_RE = '^(p107m|mt-mm-lturn|mt-mm-flash|mt-pm-flash)';
const FREEZE = ([frac, re]) => { const rx = new RegExp(re); for (const a of document.getAnimations()) { if (!rx.test(a.animationName || '')) continue; const tm = a.effect.getTiming(); const d = typeof tm.duration === 'number' ? tm.duration : 2400; a.pause(); a.currentTime = d * frac + (tm.delay || 0) + d * 10; } };
const THAW = ([re]) => { const rx = new RegExp(re); for (const a of document.getAnimations()) if (rx.test(a.animationName || '')) a.play(); };

// 같은 장면을 몇 순간으로 찍고 멀리서 본 값을 잰다
async function frames(pg, E, label, p, { fracs = [0.2, 0.45], vw }) {
  await ensureShown();
  const out = [];
  for (const frac of fracs) {
    await pg.evaluate(FREEZE, [frac, LIGHT_RE]); await sleep(250);
    const buf = await pg.screenshot();
    const k = `${E}-${label}-f${String(Math.round(frac * 100)).padStart(2, '0')}`;
    fs.writeFileSync(path.join(OUT, `${k}.png`), buf);
    const f = await pg.evaluate(FAR, [buf.toString('base64'), boxesOf(p), 0.25, vw]);
    save64(`${k}-far`, f.thumb);
    out.push({ frac, ...farSummary(f), thumb: f.thumb });
  }
  await pg.evaluate(THAW, [LIGHT_RE]);
  return out;
}

// ---- 목업: 고치기 전 빌드의 번쩍임 층(H) 안에 네 방법을 덧입힌다. 모두 같은 생김새(2px 고리 위 꼬리 있는 빛, 머리를 따라가는 부드러운 빛 무리, 한 바퀴 2.4초) ----
// 길 사각형(214×62, 반지름 7)을 고른 속도로 도는 transform 키프레임(translate는 % + px, rotate는 진행 방향)
const TK = '0% { transform: translate(7px, 0px) rotate(0deg); } 37.038% { transform: translate(calc(100% - 7px), 0px) rotate(0deg); } 38.056% { transform: translate(calc(100% - 2.05px), 2.05px) rotate(45deg); } 39.075% { transform: translate(100%, 7px) rotate(90deg); } 47.964% { transform: translate(100%, calc(100% - 7px)) rotate(90deg); } 48.982% { transform: translate(calc(100% - 2.05px), calc(100% - 2.05px)) rotate(135deg); } 50% { transform: translate(calc(100% - 7px), 100%) rotate(180deg); } 87.038% { transform: translate(7px, 100%) rotate(180deg); } 88.056% { transform: translate(2.05px, calc(100% - 2.05px)) rotate(225deg); } 89.075% { transform: translate(0px, calc(100% - 7px)) rotate(270deg); } 97.964% { transform: translate(0px, 7px) rotate(270deg); } 98.982% { transform: translate(2.05px, 2.05px) rotate(315deg); } 100% { transform: translate(7px, 0px) rotate(360deg); }';
const MOCK_CSS = (H) => {
  const ring = 'position:absolute; inset:0; box-sizing:border-box; border:2px solid transparent; border-radius:inherit; mask: linear-gradient(#000 0 0) padding-box exclude, linear-gradient(#000 0 0) border-box;';
  const blob = 'width:30px; height:30px; border-radius:50%; background: radial-gradient(closest-side, color-mix(in srgb, var(--mm-run) 55%, transparent), color-mix(in srgb, var(--mm-run) 22%, transparent) 55%, transparent);';
  const base = `${H} { animation: none !important; border: 0 !important; border-radius: 8px !important; inset: -1px !important; opacity: 1 !important; background-color: color-mix(in srgb, var(--mm-run) 4%, transparent) !important; --hd: color-mix(in srgb, var(--mm-run) 50%, #fff); --tail: linear-gradient(to right, transparent, color-mix(in srgb, var(--mm-run) 30%, transparent) 35%, color-mix(in srgb, var(--mm-run) 80%, transparent) 75%, var(--mm-run) 92%, var(--hd)); }
${H} > i, ${H} i { font-style: normal; }
${H} .p7r { ${ring} }`;
  return {
    S: `${base}
${H} .p7s { position:absolute; left:0; top:0; width:100%; height:100%; overflow:visible; }
${H} .p7s rect { x:1px; y:1px; width:calc(100% - 2px); height:calc(100% - 2px); rx:7px; fill:none; stroke: var(--mm-run); stroke-width:2; stroke-dasharray: calc(var(--L) * 1px) calc(100px - var(--L) * 1px); animation: p107mS 2.4s linear infinite; }
${H} .p7s rect.g { stroke-width:9; stroke-linecap:round; opacity:.22; --L: 2; }
${H} .p7s rect.t4 { --L: 22; opacity:.18; } ${H} .p7s rect.t3 { --L: 15; opacity:.35; } ${H} .p7s rect.t2 { --L: 9; opacity:.6; } ${H} .p7s rect.t1 { --L: 4.5; opacity:.95; }
${H} .p7s rect.h { --L: 1.6; stroke: var(--hd); stroke-width:2.5; stroke-linecap:round; }
@keyframes p107mS { from { stroke-dashoffset: calc(var(--L) * 1px); } to { stroke-dashoffset: calc(var(--L) * 1px - 100px); } }`,
    O: `${base}
${H} .p7ob, ${H} .p7og { position:absolute; left:0; top:0; offset-path: inset(1px round 7px) border-box; offset-rotate: auto; animation: p107mO 2.4s linear infinite; }
${H} .p7ob { width:110px; height:4px; offset-anchor: 100% 50%; background: var(--tail); border-radius: 0 2px 2px 0; }
${H} .p7og { offset-anchor: 50% 50%; ${blob} }
@keyframes p107mO { from { offset-distance: 0%; } to { offset-distance: 100%; } }`,
    C: `${base}
@property --p107a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
${H} .p7r.c { background: conic-gradient(from var(--p107a), transparent 0 70%, color-mix(in srgb, var(--mm-run) 30%, transparent) 80%, color-mix(in srgb, var(--mm-run) 80%, transparent) 93%, var(--mm-run) 98%, var(--hd) 99.7%, transparent 100%) border-box; animation: p107mC 2.4s linear infinite; }
@keyframes p107mC { to { --p107a: 360deg; } }`,
    T: `${base}
${H} .p7tb, ${H} .p7tg { position:absolute; left:-1px; top:-1px; width:calc(100% + 2px); height:calc(100% + 2px); transform-origin: 0 0; animation: p107mT 2.4s linear infinite; }
${H} .p7tg { left:1px; top:1px; width:calc(100% - 2px); height:calc(100% - 2px); }
${H} .p7tb::before { content:""; position:absolute; right:100%; top:-2px; margin-right:-1px; width:30px; height:4px; border-radius: 0 2px 2px 0; }
${H} .p7tb.s0::before { background: linear-gradient(to right, color-mix(in srgb, var(--mm-run) 85%, transparent), var(--mm-run) 60%, var(--hd)); }
${H} .p7tb.s1 { animation-delay: -2276ms; } ${H} .p7tb.s1::before { background: linear-gradient(to right, color-mix(in srgb, var(--mm-run) 55%, transparent), color-mix(in srgb, var(--mm-run) 85%, transparent)); }
${H} .p7tb.s2 { animation-delay: -2152ms; } ${H} .p7tb.s2::before { background: linear-gradient(to right, color-mix(in srgb, var(--mm-run) 25%, transparent), color-mix(in srgb, var(--mm-run) 55%, transparent)); }
${H} .p7tb.s3 { animation-delay: -2028ms; } ${H} .p7tb.s3::before { background: linear-gradient(to right, transparent, color-mix(in srgb, var(--mm-run) 25%, transparent)); }
${H} .p7tg::before { content:""; position:absolute; left:-15px; top:-15px; ${blob} }
@keyframes p107mT { ${TK} }`,
    // R: 판 노드 고리(.mt-node-run)와 같은 방법. 고리 가리개 안에서 큰 정사각형 원뿔 그라데이션을 transform으로 돌린다(각도가 고르므로 긴 카드에서는 속도가 고르지 않다)
    R: `${base}
${H} .p7rr { position:absolute; left:50%; top:50%; width:240px; height:240px; margin:-120px 0 0 -120px; background: conic-gradient(transparent 0turn .62turn, color-mix(in srgb, var(--mm-run) 30%, transparent) .8turn, var(--mm-run) .95turn, var(--hd) .99turn, transparent 1turn); animation: p107mR 2.4s linear infinite; }
@keyframes p107mR { to { transform: rotate(1turn); } }`,
    // K: R을 가로로 √(214/62)≈1.86배 늘린 공간에서 돌린다(둘레 속도 차이 11배 → 4배). 감싸개의 scaleX는 멈춰 있고 안의 정사각형만 돈다
    K: `${base}
${H} .p7kw { position:absolute; inset:0; transform: scaleX(1.86); }
${H} .p7kk { position:absolute; left:50%; top:50%; width:140px; height:140px; margin:-70px 0 0 -70px; background: conic-gradient(transparent 0turn .62turn, color-mix(in srgb, var(--mm-run) 30%, transparent) .8turn, var(--mm-run) .95turn, var(--hd) .99turn, transparent 1turn); animation: p107mK 2.4s linear infinite; }
@keyframes p107mK { to { transform: rotate(1turn); } }`,
    // P: T와 같지만 translate를 px만으로(PC 카드 크기 고정 214×62). % + px 섞인 translate가 합성되지 않는지 본다
    P: `${base}
${H} .p7tb, ${H} .p7tg { position:absolute; left:-1px; top:-1px; width:2px; height:2px; transform-origin: 0 0; animation: p107mP 2.4s linear infinite; }
${H} .p7tg { left:1px; top:1px; }
${H} .p7tb::before { content:""; position:absolute; right:100%; top:-2px; margin-right:-1px; width:30px; height:4px; border-radius: 0 2px 2px 0; }
${H} .p7tb.s0::before { background: linear-gradient(to right, color-mix(in srgb, var(--mm-run) 85%, transparent), var(--mm-run) 60%, var(--hd)); }
${H} .p7tb.s1 { animation-delay: -2276ms; } ${H} .p7tb.s1::before { background: linear-gradient(to right, color-mix(in srgb, var(--mm-run) 55%, transparent), color-mix(in srgb, var(--mm-run) 85%, transparent)); }
${H} .p7tb.s2 { animation-delay: -2152ms; } ${H} .p7tb.s2::before { background: linear-gradient(to right, color-mix(in srgb, var(--mm-run) 25%, transparent), color-mix(in srgb, var(--mm-run) 55%, transparent)); }
${H} .p7tb.s3 { animation-delay: -2028ms; } ${H} .p7tb.s3::before { background: linear-gradient(to right, transparent, color-mix(in srgb, var(--mm-run) 25%, transparent)); }
${H} .p7tg::before { content:""; position:absolute; left:-15px; top:-15px; ${blob} }
@keyframes p107mP { 0% { transform: translate(7px, 0px) rotate(0deg); } 37.038% { transform: translate(207px, 0px) rotate(0deg); } 38.056% { transform: translate(211.95px, 2.05px) rotate(45deg); } 39.075% { transform: translate(214px, 7px) rotate(90deg); } 47.964% { transform: translate(214px, 55px) rotate(90deg); } 48.982% { transform: translate(211.95px, 59.95px) rotate(135deg); } 50% { transform: translate(207px, 62px) rotate(180deg); } 87.038% { transform: translate(7px, 62px) rotate(180deg); } 88.056% { transform: translate(2.05px, 59.95px) rotate(225deg); } 89.075% { transform: translate(0px, 55px) rotate(270deg); } 97.964% { transform: translate(0px, 7px) rotate(270deg); } 98.982% { transform: translate(2.05px, 2.05px) rotate(315deg); } 100% { transform: translate(7px, 0px) rotate(360deg); } }`,
  };
};
const MOCK_DOM = {
  S: '<svg class="p7s"><rect class="g" pathLength="100"/><rect class="t4" pathLength="100"/><rect class="t3" pathLength="100"/><rect class="t2" pathLength="100"/><rect class="t1" pathLength="100"/><rect class="h" pathLength="100"/></svg>',
  O: '<i class="p7r"><i class="p7ob"></i></i><i class="p7og"></i>',
  C: '<i class="p7r c"></i>',
  T: '<i class="p7r"><i class="p7tb s3"></i><i class="p7tb s2"></i><i class="p7tb s1"></i><i class="p7tb s0"></i></i><i class="p7tg"></i>',
  R: '<i class="p7r"><i class="p7rr"></i></i>',
  K: '<i class="p7r"><i class="p7kw"><i class="p7kk"></i></i></i>',
  P: '<i class="p7r"><i class="p7tb s3"></i><i class="p7tb s2"></i><i class="p7tb s1"></i><i class="p7tb s0"></i></i><i class="p7tg"></i>',
};
const TECH = { S: 'S SVG dashoffset', O: 'O offset-path', C: 'C @property conic', T: 'T transform keyframes (% + px)', R: 'R rotating conic (transform)', K: 'K rotating conic, stretched x1.86', P: 'P transform keyframes (px only)' };
const KS = process.argv[5] ? process.argv[5].split(',') : ['none', 'flash', 'S', 'O', 'C', 'T', 'R', 'K', 'P'];
const SUB = process.argv[5] ? `-${KS.join('')}` : '';
// 페이지 안: 덧입힐 방법을 고른다(k가 null이면 걷는다). 새로 생긴 층에도 넣고 모든 빛의 시작을 문서 시간 0에 맞춘다
const MOCK_SET = ([k, H, css, dom]) => {
  if (window.__p107mo) { window.__p107mo.disconnect(); window.__p107mo = null; }
  const old = document.getElementById('p107-mock'); if (old) old.remove();
  for (const el of document.querySelectorAll(H)) el.innerHTML = '';
  if (!k) return 0;
  const st = document.createElement('style'); st.id = 'p107-mock'; st.textContent = css; document.head.appendChild(st);
  const fill = () => { for (const el of document.querySelectorAll(H)) if (!el.firstChild) el.innerHTML = dom; for (const a of document.getAnimations()) if (/^p107m/.test(a.animationName || '') && a.startTime !== 0) { try { a.startTime = 0; } catch {} } };
  fill();
  window.__p107mo = new MutationObserver(() => fill()); window.__p107mo.observe(document.body, { childList: true, subtree: true });
  return document.querySelectorAll(H).length;
};

// ---- 값 재기: CDP 주 스레드 값, 프레임 시간(rAF), 창 프로세스 CPU ----
function procTree(rootPid) {
  const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime,CommandLine | ConvertTo-Json -Compress';
  const all = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 }));
  const kids = new Map();
  for (const p of all) { if (!kids.has(p.ParentProcessId)) kids.set(p.ParentProcessId, []); kids.get(p.ParentProcessId).push(p); }
  const out = [];
  const walk = (pid) => { for (const c of kids.get(pid) || []) { const cl = String(c.CommandLine || ''); const type = (cl.match(/--type=([a-z-]+)/) || [])[1] || 'main'; out.push({ pid: c.ProcessId, name: c.Name, type, ws: Number(c.WorkingSetSize) || 0, cpu: (Number(c.KernelModeTime) || 0) + (Number(c.UserModeTime) || 0) }); walk(c.ProcessId); } };
  walk(rootPid);
  return out;
}
const cpuByType = (rootPid, re) => { const t = {}; for (const p of procTree(rootPid)) if (!re || re.test(p.name)) t[p.type] = (t[p.type] || 0) + p.cpu; return t; };
const METRICS = ['RecalcStyleCount', 'RecalcStyleDuration', 'LayoutCount', 'LayoutDuration', 'TaskDuration', 'ScriptDuration'];
async function costSpan(pg, cdp, { ms = 5000, pid = null } = {}) {
  const take = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter((m) => METRICS.includes(m.name)).map((m) => [m.name, m.value]));
  const c0 = pid ? cpuByType(pid, /electron|atrium/i) : null;
  const a = await take(); await sleep(ms); const b = await take();
  const c1 = pid ? cpuByType(pid, /electron|atrium/i) : null;
  const m = Object.fromEntries(METRICS.map((k) => [k, Math.round((b[k] - a[k]) * 1000) / 1000]));
  const cpu = c0 ? Object.fromEntries(Object.keys(c1).map((k) => [k, Math.round(((c1[k] || 0) - (c0[k] || 0)) / 1e4)])) : null; // 100ns → ms
  // 프레임 시간(3초, rAF 사이 간격)
  const fr = await pg.evaluate(async (dur) => { const t = []; let last = performance.now(); const end = last + dur; await new Promise((res) => { const f = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); t.shift(); t.sort((x, y) => x - y); const q = (p) => Math.round(t[Math.min(t.length - 1, Math.floor(t.length * p))] * 10) / 10; return { n: t.length, mean: Math.round((t.reduce((s, v) => s + v, 0) / t.length) * 100) / 100, p50: q(0.5), p95: q(0.95), max: Math.round(t[t.length - 1] * 10) / 10, over20: t.filter((v) => v > 20).length }; }, 3000);
  return { per5s: m, cpuMs: cpu, frames: fr };
}

// ---- 목업 비교(PC 창 1920): 실제 판 모양에서 네 방법의 프레임, 멀리서 본 값, 값(일하는 카드 5개·40개) ----
async function mockpc() {
  const { app, page: pg, mainPid } = await launch({ log, env: { ...ENV }, args: AWAKE });
  try {
    await pg.setViewportSize({ width: 1920, height: 1080 }).catch(() => {});
    await pg.emulateMedia({ reducedMotion: 'no-preference' });
    await sleep(2500);
    const cdp = await pg.context().newCDPSession(pg);
    await cdp.send('Performance.enable');
    const H = '.mt-mm-flash';
    const css = MOCK_CSS(H);
    const res = { tech: TECH, real: {}, many: {} };
    // 실제 판 모양(일하는 다섯)
    await pg.evaluate(HOOK, ['real', 0]);
    await openMission(pg);
    await pg.mouse.move(5, 500); await sleep(300);
    const p = await pg.evaluate(PC_PROBE);
    log(`[mockpc] 실제 판 모양 ${JSON.stringify(p.nodes.map((n) => `${n.name}:${n.tier}/${n.shape}`))}`);
    const strips = [], fars = [];
    for (const k of KS) {
      const n = await pg.evaluate(MOCK_SET, k === 'none' || k === 'flash' ? [null, H, '', ''] : [k, H, css[k], MOCK_DOM[k]]);
      const off = k === 'none' ? await pg.addStyleTag({ content: `${H} { display: none !important; }` }) : null;
      await sleep(700);
      // 프레임(카드 p107 확대, 한 바퀴 여덟 장)과 멀리서 본 그림(두 순간)
      const w0 = nodeBy(p, 'p107');
      const tiles = [];
      if (w0.w && k !== 'none') for (let i = 0; i < 8; i++) { await pg.evaluate(FREEZE, [i / 8, LIGHT_RE]); await sleep(90); const b = await pg.screenshot({ clip: { x: w0.x - 16, y: w0.y - 16, width: w0.w + 32, height: w0.h + 32 } }); tiles.push({ label: `${k} ${Math.round(i * 300)}ms`, b64: b.toString('base64') }); }
      if (tiles.length) save64(`mock-pc-${k}-frames`, await pg.evaluate(COMPOSE, [tiles, 4, 8]));
      const fr = await frames(pg, 'pc', `mock-${k}`, p, { fracs: [0.2, 0.45], vw: 1920 });
      fars.push({ label: `${k} t=0.2`, b64: fr[0].thumb });
      const cost = await costSpan(pg, cdp, { pid: mainPid });
      res.real[k] = { hosts: n, far: fr.map((x) => ({ ...x, thumb: undefined })), cost };
      log(`[mockpc] ${k} 실제 판 모양 ${JSON.stringify(res.real[k])}`);
      if (off) await off.evaluate((el) => el.remove());
    }
    save64(`mock-pc-compare-far${SUB}`, await pg.evaluate(COMPOSE, [fars, 2, 12]));
    // 많은 판(일하는 카드 40개)
    await pg.evaluate(MOCK_SET, [null, H, '', '']);
    await pg.evaluate(UNHOOK);
    await pg.evaluate(HOOK, ['many', 40]);
    await openMission(pg);
    await pg.mouse.move(5, 500); await sleep(300);
    const q = await pg.evaluate(PC_PROBE);
    const vis = q.nodes.filter((x) => x.tier === 'work' && x.y + x.h > 0 && x.y < 1080).length;
    log(`[mockpc] 많은 판 카드 ${q.nodes.length}, 일함 ${q.nodes.filter((x) => x.tier === 'work').length}, 화면 안 ${vis}`);
    res.many.visible = vis;
    for (const k of KS) {
      const n = await pg.evaluate(MOCK_SET, k === 'none' || k === 'flash' ? [null, H, '', ''] : [k, H, css[k], MOCK_DOM[k]]);
      const off = k === 'none' ? await pg.addStyleTag({ content: `${H} { display: none !important; }` }) : null;
      await sleep(800);
      await shot(pg, `mock-pc-many-${k}`);
      res.many[k] = { hosts: n, cost: await costSpan(pg, cdp, { pid: mainPid }) };
      log(`[mockpc] ${k} 많은 판 ${JSON.stringify(res.many[k])}`);
      if (off) await off.evaluate((el) => el.remove());
    }
    // 두 번째 회차(흔들림): 많은 판만 다시
    res.many2 = {};
    for (const k of KS.filter((x) => x !== 'flash')) {
      await pg.evaluate(MOCK_SET, k === 'none' ? [null, H, '', ''] : [k, H, css[k], MOCK_DOM[k]]);
      const off = k === 'none' ? await pg.addStyleTag({ content: `${H} { display: none !important; }` }) : null;
      await sleep(800);
      res.many2[k] = await costSpan(pg, cdp, { pid: mainPid });
      log(`[mockpc] ${k} 많은 판 2회 ${JSON.stringify(res.many2[k])}`);
      if (off) await off.evaluate((el) => el.remove());
    }
    await pg.evaluate(MOCK_SET, [null, H, '', '']);
    await pg.evaluate(UNHOOK);
    fs.writeFileSync(path.join(OUT, `p107-mock-pc${SUB}.json`), JSON.stringify(res, null, 1));
  } finally { await closeApp(app); }
}

// ---- 맡은 화면 밖과 맡은 화면 안 바뀌면 안 되는 것(계산된 CSS) ----
// PC 판(캔버스) 노드 틀
const NODE_PRINT = `(() => [...document.querySelectorAll('.mt-node')].map((e) => { const s = getComputedStyle(e); return [e.dataset.name, ...['borderTopWidth', 'borderTopStyle', 'borderRadius', 'fontFamily', 'fontSize', 'paddingTop'].map((k) => s[k])].join('|'); }).sort())()`;
// 미션 맵의 일하지 않는 카드·알약
const REST_PRINT = `(() => [...document.querySelectorAll('[data-role=mission] [data-role=mm-node][data-kind=session]')].filter((e) => e.dataset.tier !== 'work').map((e) => { const s = getComputedStyle(e); return [e.dataset.name, e.dataset.tier, ...['borderTopWidth', 'borderTopStyle', 'borderTopColor', 'backgroundColor', 'borderRadius', 'opacity', 'boxShadow'].map((k) => s[k]), e.getAnimations({ subtree: true }).length].join('|'); }).sort())()`;
// 휴대폰 세션 목록·새 세션 시트
const STYLE_PRINT = `((sel) => {
  const root = document.querySelector(sel);
  if (!root) return null;
  const keys = ['display', 'position', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'color', 'backgroundColor', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRadius', 'paddingTop', 'paddingLeft', 'height', 'boxShadow', 'animationName'];
  return [...root.querySelectorAll('*')].map((e) => { const s = getComputedStyle(e); return [e.tagName, String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className), ...keys.map((k) => s[k])].join('|'); });
})`;
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diffOf = (was, now) => (Array.isArray(was) && Array.isArray(now) ? { before: was.length, after: now.length, diff: now.filter((x, i) => was[i] !== x).slice(0, 4) } : 'no before');
// P102 시험의 고치기 전 값(같은 판 모양, 세션 이름만 p102-)
const p102Map = (arr) => (Array.isArray(arr) ? arr.map((x) => x.replace(/\bp102-/g, 'p107-')).sort() : null);

// ---- 빛이 실제로 도는지: 돌아가는 원뿔(::before)의 transform을 시간을 두고 두 번 읽는다(멈추지 않은 실제 시간) ----
const SPIN_NOW = `(() => [...document.querySelectorAll('[data-role=mm-light], [data-role=pm-light]')].map((li) => { const sp = li.querySelector('.mt-mm-lring .mt-mm-lspin'); const card = li.closest('[data-name]'); return { name: card ? card.dataset.name : null, shown: sp ? getComputedStyle(sp.parentElement).display !== 'none' : false, tf: sp ? getComputedStyle(sp, '::before').transform : null }; }))()`;
async function spinning(pg) {
  const sh = await ensureShown(); if (sh && sh.was) { log(`창이 최소화되어 있어 되살림 ${JSON.stringify(sh)}`); await sleep(800); }
  const a = await pg.evaluate(SPIN_NOW); await sleep(350); const b = await pg.evaluate(SPIN_NOW);
  return a.map((x, i) => ({ name: x.name, shown: x.shown, moved: !!(x.tf && b[i] && b[i].tf && x.tf !== 'none' && x.tf !== b[i].tf), tf0: x.tf, tf1: b[i] && b[i].tf }));
}
// 실제 시간 프레임: 카드 하나를 n장 찍고 서로 다른지(빛이 돌면 픽셀이 바뀐다)
async function liveFrames(pg, box, name, n = 4, gap = 200, pad = 16) {
  await ensureShown();
  const bufs = [];
  for (let i = 0; i < n; i++) { const b = await pg.screenshot({ clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.w + pad * 2, height: box.h + pad * 2 } }); bufs.push(b); fs.writeFileSync(path.join(OUT, `${name}-${i}.png`), b); await sleep(gap); }
  let distinct = 0; for (let i = 1; i < bufs.length; i++) if (!bufs[i].equals(bufs[i - 1])) distinct++;
  return { n, distinct, b64: bufs.map((b) => b.toString('base64')) };
}
// 멀리서 본 움직임: 두 순간의 1/4 그림에서 카드마다 평균 픽셀 차이(0~255)
const FAR_DIFF = async ([a64, b64, boxes, scale, vw]) => {
  const load = async (s) => { const im = new Image(); im.src = 'data:image/png;base64,' + s; await im.decode(); return im; };
  const [ia, ib] = [await load(a64), await load(b64)];
  const dpr = ia.width / vw, W = Math.round(ia.width * scale / dpr), H = Math.round(ia.height * scale / dpr);
  const px = (im) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
  const da = px(ia), db = px(ib), pad = 1; // 빛 무리가 카드 밖 4px(1/4에서 1px)까지. 이웃 카드는 8px(2px) 떨어져 있다
  return boxes.map((b) => { const x0 = Math.max(0, Math.round(b.x * scale) - pad), y0 = Math.max(0, Math.round(b.y * scale) - pad), x1 = Math.min(W, Math.round((b.x + b.w) * scale) + pad), y1 = Math.min(H, Math.round((b.y + b.h) * scale) + pad); let s = 0, n = 0, mx = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3; s += d; n++; if (d > mx) mx = d; }
    return { name: b.name, tier: b.tier, mean: n ? Math.round((s / n) * 100) / 100 : 0, max: Math.round(mx) }; });
};
function farMotion(rows) {
  const work = rows.filter((r) => r.tier === 'work'), other = rows.filter((r) => r.tier !== 'work');
  const avg = (xs, k) => (xs.length ? Math.round((xs.reduce((a, r) => a + r[k], 0) / xs.length) * 100) / 100 : 0);
  return { workMean: avg(work, 'mean'), workMax: avg(work, 'max'), otherMean: avg(other, 'mean'), otherMaxOf: Math.max(0, ...other.map((r) => r.max)), workMinMax: Math.min(...work.map((r) => r.max)), moved: other.filter((r) => r.max >= 8).map((r) => `${r.name}:${r.tier}:${r.max}`) };
}
const setLight = async (pg, mode) => {
  call('settings.set', { workLight: mode });
  await pg.waitForFunction((m) => document.documentElement.dataset.workLight === m, mode, { timeout: 8000 }).catch(() => {});
  await sleep(700);
};
const workCards = (p) => p.nodes.filter((x) => x.tier === 'work');
const phaseSpread = (cards) => { const ph = cards.map((x) => { const a = x.anims.find((y) => /lturn/.test(y.name || '')); return a ? { phase: a.phase, dur: a.dur } : null; }); if (ph.some((v) => !v || v.phase === null)) return null; const d = ph[0].dur || 2400; return Math.max(0, ...ph.flatMap((a) => ph.map((b) => { const x = Math.abs(a.phase - b.phase) % d; return Math.min(x, d - x); }))); };

// 빛의 모드 하나를 지금 움직임 설정(MOTION)에서 본다: 돌아야 하면 일하는 카드마다 원뿔 둘(고리·빛 무리)이 transform만 움직이고 실제로 돈다, 아니면 멈춘 굵은 테두리
function lightChecks(E, label, p, spin, want, { perCard = 1 } = {}) {
  const work = workCards(p), not = p.nodes.filter((x) => x.tier !== 'work');
  const turnAlert = p.nodes.filter((x) => x.tier === 'turn' || x.tier === 'alert');
  if (want) {
    const all = work.flatMap((x) => x.anims);
    check(`[${E}] ${label}: 일하는 카드마다 빛 층과 도는 원뿔 ${perCard}개(가리개 하나), 다른 카드는 층·움직임 없음`, work.length >= 2 && work.every((x) => x.light && x.anims.length === perCard) && not.every((x) => !x.light && x.anims.length === 0), { work: work.map((x) => `${x.name}:${x.anims.length}`), not: not.filter((x) => x.light || x.anims.length).map((x) => x.name) });
    check(`[${E}] ${label}: 움직이는 속성은 transform만(합성), 한 바퀴 2~3초`, all.length > 0 && all.every((a) => a.props.length === 1 && a.props[0] === 'transform' && a.dur >= 2000 && a.dur <= 3000), all.slice(0, 4).map((a) => `${a.name}:${a.props.join(',')}@${a.dur}`));
    check(`[${E}] ${label}: 빛이 실제 시간으로 돈다(0.35초 사이 원뿔 회전이 바뀜)`, spin.filter((s) => work.some((w) => w.name === s.name)).length >= 2 && spin.every((s) => s.shown && s.moved), spin.map((s) => `${s.name}:${s.shown}/${s.moved}`));
  } else {
    // 일하는 haiku 세션(rev)은 가끔 턴을 일찍 마친다. 멈춤 검사는 일하는 카드가 하나 이상이면 본다(셸 tests는 50분 ping)
    check(`[${E}] ${label}: 움직임 없음, 일하는 카드에 멈춘 굵은 상태 색 테두리(2px, 다 보임)`, work.length >= 1 && p.nodes.every((x) => x.anims.length === 0) && work.every((x) => x.light && x.parts === 0 && x.lightStyle && x.lightStyle.borderW >= 2 && parseFloat(x.lightStyle.opacity) >= 0.99 && !/rgba\(0, 0, 0, 0\)|transparent/.test(x.lightStyle.borderC)), work.map((x) => `${x.name}:${x.parts}/${JSON.stringify(x.lightStyle)}`));
  }
  check(`[${E}] ${label}: 응답 필요·오류는 움직이지 않는다`, turnAlert.length >= 1 && turnAlert.every((x) => !x.anims.length && !x.light), turnAlert.map((x) => `${x.name}:${x.tier}:${x.anims.length}`));
}

// ---- 판(캔버스) 노드 둘레(.mt-node-run, P85): 회전판 i의 움직임과 transform을 시간을 두고 두 번 읽는다. 화면 밖(data-off=1)은 P85가 멈추므로 뺀다 ----
const RING_NOW = `(() => [...document.querySelectorAll('[data-role=run-ring]')].map((r) => { const i = r.firstElementChild; const node = r.closest('.mt-node'); const cs = i ? getComputedStyle(i) : null; const an = i && i.getAnimations ? i.getAnimations() : [];
  return { name: node ? (node.dataset.name || null) : null, shown: getComputedStyle(r).display !== 'none', anim: cs ? cs.animationName : null, play: an.map((a) => a.playState).join(','), n: an.length, tf: cs ? cs.transform : null, bg: cs ? cs.backgroundColor : null, off: r.dataset.off || '' }; }))()`;
async function rings(pg) {
  const sh = await ensureShown(); if (sh && sh.was) { log(`창이 최소화되어 있어 되살림 ${JSON.stringify(sh)}`); await sleep(800); }
  const a = await pg.evaluate(RING_NOW); await sleep(350); const b = await pg.evaluate(RING_NOW);
  return a.map((x, i) => ({ ...x, moved: !!(x.tf && b[i] && b[i].tf && x.tf !== b[i].tf) })).filter((x) => x.off !== '1');
}
const ringText = (rs) => rs.map((r) => `${r.name}:${r.shown ? '' : 'hidden/'}${r.anim}/${r.play || '-'}/${r.moved ? 'moving' : 'still'}`);
function ringCheck(E, label, rs, want) {
  if (want === 'spin') check(`[${E}] 판 노드 둘레 ${label}: 돈다`, rs.length >= 1 && rs.every((r) => r.shown && r.anim === 'mt-run' && r.play === 'running' && r.moved), ringText(rs));
  else if (want === 'still') check(`[${E}] 판 노드 둘레 ${label}: 멈춘 고리(움직임 없음, 상태 색 판)`, rs.length >= 1 && rs.every((r) => r.shown && r.anim === 'none' && r.n === 0 && !r.moved && !/rgba\(0, 0, 0, 0\)/.test(r.bg)), ringText(rs));
  else if (want === 'paused') check(`[${E}] 판 노드 둘레 ${label}: 멈춰 있다(paused)`, rs.length >= 1 && rs.every((r) => r.play === 'paused' && !r.moved), ringText(rs));
  else if (want === 'hidden') check(`[${E}] 판 노드 둘레 ${label}: 숨김`, rs.length >= 1 && rs.every((r) => !r.shown && !r.moved), ringText(rs));
}
// 판 둘레가 설정을 따른다(켬은 움직임 줄이기에서도 돎, Windows 설정 따름은 움직임 줄이기에서 멈춤, 끔은 늘 멈춤, 가벼운 판은 숨김), 미션 맵을 연 동안 멈추고 닫으면 다시 돈다
async function boardRing(pg, E, vw) {
  const K = `${E}-${TAG}-${MT}`;
  if (await pg.$('[data-role="mission"]')) { await pg.keyboard.press('Escape'); await sleep(400); }
  let rs = await rings(pg);
  if (!rs.length) { await pg.evaluate(() => window.__mt.getState().fitAll && window.__mt.getState().fitAll(0)); await sleep(1200); rs = await rings(pg); }
  log(`[${E}] 판 둘레 ${JSON.stringify(ringText(rs))}`);
  ringCheck(E, `켬(기본, ${MOTION})`, rs, 'spin');
  const box = await pg.evaluate(() => { const r = document.querySelector('[data-role=run-ring]'); const n = r && r.closest('.mt-node'); if (!n) return null; const b = n.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; });
  if (box && box.w > 4) { const lf = await liveFrames(pg, box, `${K}-30-ring-live`, 4, 200, 12); check(`[${E}] 판 노드 둘레 켬(${MOTION}): 실제 시간 프레임이 바뀐다`, lf.distinct >= 2, lf.distinct); }
  await shot(pg, `${K}-31-board-on`);
  await setLight(pg, 'system');
  ringCheck(E, `Windows 설정 따름(${MOTION})`, await rings(pg), MOTION === 'reduce' ? 'still' : 'spin');
  await shot(pg, `${K}-32-board-system`);
  await setLight(pg, 'off');
  ringCheck(E, `끔(${MOTION})`, await rings(pg), 'still');
  await shot(pg, `${K}-33-board-off`);
  await setLight(pg, 'on');
  await pg.evaluate(() => document.documentElement.classList.add('mt-lite')); await sleep(400);
  const lite = await pg.evaluate(RING_NOW);
  check(`[${E}] 판 노드 둘레 가벼운 판(켬): 그대로 숨김`, lite.length >= 1 && lite.every((r) => !r.shown), lite.map((r) => `${r.name}:${r.shown}`));
  await pg.evaluate(() => document.documentElement.classList.remove('mt-lite')); await sleep(500);
  // 미션 맵을 연 동안 뒤의 둘레는 멈추고, 닫으면 다시 돈다
  await pg.click('[data-action="mission-rail"]');
  await pg.waitForSelector('[data-role="mission"]', { timeout: 20000 }); await sleep(800);
  check(`[${E}] 미션 맵을 열면 문서 뿌리 data-mm-open`, (await pg.evaluate(() => document.documentElement.dataset.mmOpen)) === '1');
  ringCheck(E, `미션 맵 덮개 뒤(${MOTION})`, await rings(pg), 'paused');
  await pg.keyboard.press('Escape'); await sleep(700);
  check(`[${E}] 미션 맵을 닫으면 data-mm-open을 지운다`, (await pg.evaluate(() => document.documentElement.dataset.mmOpen)) === undefined);
  ringCheck(E, `미션 맵을 닫은 뒤(${MOTION})`, await rings(pg), 'spin');
}

// ---- PC 창과 PC 웹이 같이 쓰는 지도 시험 ----
async function desk(pg, E, vw) {
  const K = `${E}-${TAG}-${MT}`;
  if (await pg.$('[data-action="return-close"]')) { await pg.click('[data-action="return-close"]').catch(() => {}); await sleep(300); }
  await pg.evaluate(FAKE_ERR); await sleep(400);
  log(`[${E}] 움직임 줄이기 ${await pg.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)} (요청 ${MOTION})`);
  check(`[${E}] 창의 움직임 설정이 ${MOTION}다`, await pg.evaluate((m) => matchMedia(`(prefers-reduced-motion: ${m})`).matches, MOTION));
  await ensureShown(); await sleep(300);
  const fps = await pg.evaluate(async () => { let n = 0; const t0 = performance.now(); await new Promise((r) => { const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); return { n, vis: document.visibilityState }; });
  log(`[${E}] 창 그리기 ${JSON.stringify(fps)}`);
  check(`[${E}] 시험 창이 그린다(가려지지 않음, rAF 초당 30번 넘음)`, fps.n > 30 && fps.vis === 'visible', fps);
  call('settings.set', { workLight: 'on' }); await sleep(600);
  await shot(pg, `${K}-00-board`);
  const nodePrint = await pg.evaluate(NODE_PRINT);
  fs.writeFileSync(path.join(OUT, `p107-board-${E}-${TAG}-${MT}.json`), JSON.stringify(nodePrint, null, 1));
  if (AFTER) {
    const was = readJson(path.join(OUT, `p107-board-${E}-before-${MT}.json`)) || readJson(path.join(OUT, `p107-board-${E}-before-np.json`));
    check(`[${E}] PC 판(캔버스) 노드 틀 모양이 고치기 전과 같다(계산된 CSS)`, was && sameJson(was, nodePrint) && nodePrint.length >= 12, diffOf(was, nodePrint));
    const p102 = p102Map(readJson(path.join(P102, `p102-board-${E}-before.json`)));
    check(`[${E}] PC 판 노드 틀 모양이 P102 시험의 고치기 전 값과도 같다(세션 이름만 바꿈)`, p102 && sameJson(p102, nodePrint), diffOf(p102, nodePrint));
    await boardRing(pg, E, vw);
  }
  // 판 A(실제 세션)
  await openMission(pg);
  await pg.evaluate(FAKE_ERR); await sleep(600);
  await pg.mouse.move(vw - 120, 82); await sleep(300);
  let p = await pg.evaluate(PC_PROBE);
  log(`[${E}] 지도 ${JSON.stringify(p.nodes.map((n) => `${n.name}:${n.tier}/${n.shape}${n.light ? '/light' : ''}${n.flash ? '/flash' : ''}:${n.anims.map((a) => `${a.name}@${a.dur}`).join('+')}`))} mode=${p.mode} reduce=${p.reduce}`);
  await shot(pg, `${K}-01-map`);
  const restPrint = await pg.evaluate(REST_PRINT);
  fs.writeFileSync(path.join(OUT, `p107-rest-${E}-${TAG}-${MT}.json`), JSON.stringify(restPrint, null, 1));
  const rev = nodeBy(p, P('rev'));
  // 실제 시간 프레임(멈추지 않음): 고치기 전은 움직임 줄이기에서 아무것도 바뀌지 않는다
  if (rev.w) { const lf = await liveFrames(pg, rev, `${K}-11-live`); log(`[${E}] 실제 시간 프레임 ${lf.n}장 중 바뀐 것 ${lf.distinct}`); if (AFTER) check(`[${E}] 설정 켬(${MOTION})에서 실제 시간 프레임 넷이 모두 다르다(빛이 돈다)`, lf.distinct >= 3, lf.distinct); }
  if (AFTER) {
    lightChecks(E, `켬(기본, ${MOTION})`, p, await spinning(pg), true);
    const was = readJson(path.join(OUT, `p107-rest-${E}-before-${MT}.json`)) || readJson(path.join(OUT, `p107-rest-${E}-before-np.json`));
    check(`[${E}] 미션 맵의 일하지 않는 카드·알약 모양은 고치기 전과 같다(계산된 CSS)`, was && sameJson(was, restPrint), diffOf(was, restPrint));
    // 한 바퀴 여덟 장(멈춰서)
    if (rev.w) { const tiles = []; for (let i = 0; i < 8; i++) { await pg.evaluate(FREEZE, [i / 8, LIGHT_RE]); await sleep(110); const b = await pg.screenshot({ clip: { x: rev.x - 16, y: rev.y - 16, width: rev.w + 32, height: rev.h + 32 } }); tiles.push({ label: `t=${i * 300}ms`, b64: b.toString('base64') }); } await pg.evaluate(THAW, [LIGHT_RE]); save64(`${K}-12-lap`, await pg.evaluate(COMPOSE, [tiles, 4, 8])); }
    // Windows 설정 따름
    await setLight(pg, 'system');
    p = await pg.evaluate(PC_PROBE);
    lightChecks(E, `Windows 설정 따름(${MOTION})`, p, await spinning(pg), MOTION === 'no-preference');
    await shot(pg, `${K}-13-system`);
    // 끔
    await setLight(pg, 'off');
    p = await pg.evaluate(PC_PROBE);
    lightChecks(E, `끔(${MOTION})`, p, await spinning(pg), false);
    await shot(pg, `${K}-14-off`);
    // 가벼운 판(P86 단계 3 이상, html.mt-lite): 설정이 켬이어도 멈춤
    await setLight(pg, 'on');
    await pg.evaluate(() => document.documentElement.classList.add('mt-lite')); await sleep(500);
    p = await pg.evaluate(PC_PROBE);
    lightChecks(E, `가벼운 판(켬, ${MOTION})`, p, await spinning(pg), false);
    await shot(pg, `${K}-15-lite`);
    await pg.evaluate(() => document.documentElement.classList.remove('mt-lite')); await sleep(600);
    p = await pg.evaluate(PC_PROBE);
    check(`[${E}] 가벼운 판을 풀고 다시 켬이면 다시 돈다`, workCards(p).every((x) => x.anims.length === 1), workCards(p).map((x) => x.anims.length));
    // 나중에 일하게 된 카드도 같은 박자
    await pg.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p107-e'); window.__p107e = s; window.__mt.api.emit('session.updated', { ...s, state: 'shell_running', shell: { ...(s.shell || {}), atPrompt: false, command: 'ping -n 50 127.0.0.1' } }); });
    await pg.waitForFunction(() => { const e = document.querySelector('[data-role=mission] [data-name="p107-e"]'); return e && e.dataset.tier === 'work' && e.querySelector('[data-role=mm-light]'); }, null, { timeout: 10000 }).catch(() => {});
    await sleep(700);
    await ensureShown();
    p = await pg.evaluate(PC_PROBE);
    const sp = phaseSpread(workCards(p));
    check(`[${E}] 나중에 일하게 된 카드(e)도 같은 박자(한 바퀴 안 자리 차이 60ms 안)`, workCards(p).length >= 3 && workCards(p).some((x) => x.name === P('e')) && sp !== null && sp <= 60, { spread: sp, work: workCards(p).map((x) => x.name) });
    await pg.evaluate(() => { if (window.__p107e) window.__mt.api.emit('session.updated', window.__p107e); });
    await pg.waitForFunction(() => { const e = document.querySelector('[data-role=mission] [data-name="p107-e"]'); return e && e.dataset.tier !== 'work'; }, null, { timeout: 10000 }).catch(() => {});
    await sleep(1200);
    // 거르기와 요약 열(바뀌지 않았는지)
    await pg.mouse.move(5, 500); await sleep(300);
    p = await pg.evaluate(PC_PROBE);
    const before = Object.fromEntries(p.nodes.map((x) => [x.name, [x.x, x.y]]));
    await pg.click('[data-filter=working]'); await sleep(500);
    p = await pg.evaluate(PC_PROBE);
    check(`[${E}] 거르기(작업 중)는 흐리게만, 자리 그대로`, p.nodes.every((x) => before[x.name] && before[x.name][0] === x.x && before[x.name][1] === x.y) && p.nodes.filter((x) => !x.fdim).every((x) => x.tier === 'work'), p.nodes.map((x) => `${x.name}:${x.fdim ? 'd' : '-'}`));
    await pg.click('[data-filter=all]'); await sleep(300);
    const s = p.summary || {};
    check(`[${E}] 요약 열: 응답 필요 lead, 작업 중 rev·tests`, s.turn && s.turn.includes(P('lead')) && [P('rev'), P('tests')].every((x) => s.work.includes(x)), s);
  }
  // 판 B: 실제 판 모양(맞추기 = 한 화면). 여러 순간과 멀리서 본 그림, 멀리서 본 움직임
  await pg.evaluate(HOOK, ['real', 0]);
  await openMission(pg);
  await pg.mouse.move(vw - 120, 82); await sleep(300);
  p = await pg.evaluate(PC_PROBE);
  await shot(pg, `${K}-05-real`);
  const fr = await frames(pg, E, `${TAG}-${MT}-05-real`, p, { fracs: [0.1, 0.35, 0.6, 0.85], vw });
  const diff = farMotion(await pg.evaluate(FAR_DIFF, [fr[0].thumb ? fs.readFileSync(path.join(OUT, `${E}-${TAG}-${MT}-05-real-f10.png`)).toString('base64') : '', fs.readFileSync(path.join(OUT, `${E}-${TAG}-${MT}-05-real-f60.png`)).toString('base64'), boxesOf(p), 0.25, vw]));
  const far = { frames: fr.map((x) => ({ ...x, thumb: undefined })), motion: diff };
  fs.writeFileSync(path.join(OUT, `p107-far-${E}-${TAG}-${MT}.json`), JSON.stringify(far, null, 1));
  log(`[${E}] 실제 판 모양 멀리서 본 값 ${JSON.stringify(far)}`);
  save64(`${K}-05-real-far4`, await pg.evaluate(COMPOSE, [fr.map((x) => ({ label: `t=${Math.round(x.frac * 2400)}ms, 1/4`, b64: x.thumb })), 4, 8]));
  if (AFTER) {
    const work = workCards(p);
    check(`[${E}] 실제 판 모양(18개, 워크스페이스 12개): 한 화면, 일하는 다섯 카드만 돈다`, p.nodes.length === 18 && p.body.sh <= p.body.h + 2 && work.length === 5 && work.every((x) => x.anims.length === 1) && p.nodes.filter((x) => x.tier !== 'work').every((x) => !x.anims.length), { n: p.nodes.length, body: p.body, work: work.map((x) => x.name) });
    check(`[${E}] 멀리서(1/4) 일하는 카드만 움직인다(두 순간 사이 카드 안 가장 큰 픽셀 차이 40 이상, 다른 카드는 8 아래)`, diff.workMinMax >= 40 && diff.otherMaxOf < 8, diff);
  }
  // 큰 판
  await pg.evaluate(UNHOOK);
  await pg.evaluate(HOOK, ['big', 25]);
  await openMission(pg);
  await pg.mouse.move(vw - 120, 82); await sleep(300);
  p = await pg.evaluate(PC_PROBE);
  await shot(pg, `${K}-06-big`);
  if (AFTER) {
    const work = workCards(p), sp = phaseSpread(work);
    check(`[${E}] 큰 판: 일하는 카드만 돈다(모두 같은 박자, 자리 차이 60ms 안)`, work.length >= 5 && work.every((x) => x.anims.length === 1) && p.nodes.filter((x) => x.tier !== 'work').every((x) => !x.anims.length) && sp !== null && sp <= 60, { work: work.length, n: p.nodes.length, spread: sp });
  }
  await pg.evaluate(UNHOOK);
  await pg.keyboard.press('Escape');
}

// 설정 창: 일반 탭에 세 단추, 누르면 곧바로 문서 뿌리와 판 설정이 바뀐다(PC 창)
async function settingsUi(pg, E) {
  const b = (await pg.$('[data-action=settings-open]')) || (await pg.$('[data-action=settings-rail]'));
  if (b) await b.click();
  await pg.waitForSelector('[data-role=work-light-setting]', { timeout: 10000 }).catch(() => {});
  const row = await pg.$('[data-role=work-light-setting]');
  if (!row) { check(`[${E}] 설정 › 일반에 미션 맵 테두리 빛 칸`, false, 'no row'); return; }
  const buttons = await pg.$$eval('[data-role=work-light-setting] button[data-light]', (bs) => bs.map((b) => ({ m: b.dataset.light, on: b.getAttribute('aria-checked'), text: b.textContent })));
  check(`[${E}] 설정 › 일반에 미션 맵 테두리 빛 칸: 켬·Windows 설정 따름·끔, 켬이 골라져 있다`, buttons.length === 3 && buttons.map((b) => b.m).join() === 'on,system,off' && buttons[0].on === 'true', buttons);
  await row.screenshot({ path: path.join(OUT, `${E}-${TAG}-${MT}-20-setting.png`) }).catch(() => {});
  await shot(pg, `${E}-${TAG}-${MT}-21-settings`);
  await pg.click('[data-role=work-light-setting] button[data-light=off]');
  await pg.waitForFunction(() => document.documentElement.dataset.workLight === 'off', null, { timeout: 5000 }).catch(() => {});
  await sleep(800);
  const st = call('settings.get').settings;
  check(`[${E}] 끔을 누르면 문서 뿌리와 판 설정이 끔`, (await pg.evaluate(() => document.documentElement.dataset.workLight)) === 'off' && st.workLight === 'off', st.workLight);
  await pg.click('[data-role=work-light-setting] button[data-light=on]');
  await sleep(800);
  check(`[${E}] 켬으로 되돌린다`, call('settings.get').settings.workLight === 'on' && (await pg.evaluate(() => document.documentElement.dataset.workLight)) === 'on');
  await pg.keyboard.press('Escape'); await sleep(400);
}

// ---- PC 창(Electron) ----
async function pc(w = 1920, h = 1080, E = 'pc') {
  const { app, page, mainPid } = await launch({ log, env: { ...ENV }, args: AWAKE });
  try {
    await page.setViewportSize({ width: w, height: h }).catch(() => {});
    log(`[${E}] 창 자리(화면 밖) ${JSON.stringify(await awayWin(app))}`);
    await page.emulateMedia({ reducedMotion: MOTION });
    await sleep(3000);
    await desk(page, E, w);
    if (AFTER && E === 'pc') { await settingsUi(page, E); await pcCost(page, mainPid, app); }
  } finally { await closeApp(app); }
}
// 값: 실제 판 모양(일하는 다섯)과 많은 판(일하는 40)에서 켬 / 끔(멈춘 테두리)의 주 스레드·프레임·창 프로세스 CPU
async function pcCost(pg, mainPid, app) {
  // 창 상태(가려짐·최소화면 rAF가 초당 1번이 되어 값이 틀린다): 기록하고 앞으로 가져온다
  const win = async () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return w ? { min: w.isMinimized(), vis: w.isVisible(), focus: w.isFocused(), bounds: w.getBounds() } : null; }).catch((e) => ({ err: e.message }));
  log(`[pc] 값 재기 전 창 ${JSON.stringify(await win())} 문서 ${await pg.evaluate(() => document.visibilityState)}`);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } }).catch(() => {});
  await sleep(500);
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Performance.enable');
  const res = {};
  for (const [mode, n] of [['real', 0], ['many', 40]]) {
    await pg.evaluate(UNHOOK); await pg.evaluate(HOOK, [mode, n]);
    await openMission(pg); await pg.mouse.move(5, 500); await sleep(500);
    res[mode] = {};
    for (const lm of ['on', 'off', 'on', 'off']) {
      await setLight(pg, lm);
      let c = null;
      for (let t = 0; t < 3; t++) { // 바깥에서 창을 최소화하면(사람이 PC를 쓰는 중) 되살리고 다시 잰다
        const w0 = await win();
        if (w0 && w0.min) { await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) w.restore(); }).catch(() => {}); await sleep(800); }
        c = await costSpan(pg, cdp, { pid: mainPid });
        const w1 = await win();
        if (c.frames.mean < 20 && !(w1 && w1.min)) break;
        log(`[pc] 값 ${mode} ${lm} 다시 잼(창 ${JSON.stringify(w1)}, 프레임 ${c.frames.mean}ms)`);
      }
      (res[mode][lm] = res[mode][lm] || []).push(c); log(`[pc] 값 ${mode} ${lm} ${JSON.stringify(c)}`);
    }
  }
  await pg.evaluate(UNHOOK);
  call('settings.set', { workLight: 'on' });
  fs.writeFileSync(path.join(OUT, `p107-cost-pc-${MT}.json`), JSON.stringify(res, null, 1));
  const avg = (xs, f) => xs.reduce((a, x) => a + f(x), 0) / xs.length;
  const on = res.many.on, off = res.many.off;
  const d = { recalcMs: Math.round((avg(on, (x) => x.per5s.RecalcStyleDuration) - avg(off, (x) => x.per5s.RecalcStyleDuration)) * 1000), layout: avg(on, (x) => x.per5s.LayoutCount) - avg(off, (x) => x.per5s.LayoutCount), fpsOn: avg(on, (x) => x.frames.mean), over20: avg(on, (x) => x.frames.over20) };
  check('[pc] 많은 판(일하는 40): 빛이 배치를 늘리지 않고, 프레임이 떨어지지 않는다(평균 프레임 간격 끔의 1.1배 안, 20ms 넘는 프레임 평균 2개 아래)', d.layout < 3 && d.fpsOn <= avg(off, (x) => x.frames.mean) * 1.1 && d.over20 < 2, d);
  await pg.keyboard.press('Escape');
}

// PC 값 다듬기(고친 빌드 위 CSS 덧입힘): 지은 그대로(고리·빛 무리 가리개 둘), 하나로 합친 가리개, 합친 것 + 낮은 박자, 고리만. 많은 판(40)과 실제 판 모양(5)
const ONE = (steps) => `.mt-mm-lring { display: none !important; }
.mt-mm-lhalo { opacity: 1 !important; inset: -6px !important; border: 4px solid transparent; padding: 2px;
  -webkit-mask: linear-gradient(to bottom, transparent 0, rgb(0 0 0 / 0.55) 4px, transparent 11px, transparent calc(100% - 11px), rgb(0 0 0 / 0.55) calc(100% - 4px), transparent 100%), linear-gradient(to right, transparent 0, rgb(0 0 0 / 0.55) 4px, transparent 11px, transparent calc(100% - 11px), rgb(0 0 0 / 0.55) calc(100% - 4px), transparent 100%), linear-gradient(black 0 0) content-box, linear-gradient(black 0 0) padding-box !important;
  -webkit-mask-composite: source-over, source-over, xor, source-over !important; mask-composite: add, add, exclude, add !important; }
${steps ? `.mt-mm-lspin::before { animation-timing-function: steps(${steps}, end) !important; }` : ''}`;
const PC_TUNE = { built: '', one: ONE(0), one72: ONE(72), one48: ONE(48), ring: '.mt-mm-lhalo { display: none !important; }', built72: '.mt-mm-lspin::before { animation-timing-function: steps(72, end) !important; }' };
async function tunepc() {
  const { app, page: pg, mainPid } = await launch({ log, env: { ...ENV }, args: AWAKE });
  try {
    await pg.setViewportSize({ width: 1920, height: 1080 }).catch(() => {});
    await pg.emulateMedia({ reducedMotion: 'reduce' }); // 판 노드 고리(RunRing)가 멈춰 빛만 잰다(사용자 PC와 같다)
    await sleep(2500);
    call('settings.set', { workLight: 'on' });
    const cdp = await pg.context().newCDPSession(pg);
    await cdp.send('Performance.enable');
    const keys = (process.argv[5] || Object.keys(PC_TUNE).join(',')).split(',');
    const res = {};
    for (const [mode, n] of [['real', 0], ['many', 40]]) {
      await pg.evaluate(UNHOOK); await pg.evaluate(HOOK, [mode, n]);
      await openMission(pg); await pg.mouse.move(5, 500); await sleep(500);
      const p = await pg.evaluate(PC_PROBE);
      res[mode] = {};
      for (let r = 0; r < 2; r++) for (const k of ['off', ...keys]) {
        await setLight(pg, k === 'off' ? 'off' : 'on');
        const tag = PC_TUNE[k] ? await pg.addStyleTag({ content: PC_TUNE[k] }) : null;
        await sleep(700);
        if (r === 0 && mode === 'real' && k !== 'off') {
          const w0 = nodeBy(p, 'p107');
          const tiles = [];
          if (w0.w) for (let i = 0; i < 8; i++) { await pg.evaluate(FREEZE, [i / 8 + 0.01, LIGHT_RE]); await sleep(90); const b = await pg.screenshot({ clip: { x: w0.x - 16, y: w0.y - 16, width: w0.w + 32, height: w0.h + 32 } }); tiles.push({ label: `${k} ${Math.round(i * 300)}ms`, b64: b.toString('base64') }); }
          await pg.evaluate(THAW, [LIGHT_RE]);
          if (tiles.length) save64(`tunepc-${k}-lap`, await pg.evaluate(COMPOSE, [tiles, 4, 8]));
          await sleep(300);
        }
        const c = await costSpan(pg, cdp, { pid: mainPid });
        (res[mode][k] = res[mode][k] || []).push(c);
        log(`[tunepc] ${mode} ${k} ${r + 1} ${JSON.stringify(c)}`);
        if (tag) await tag.evaluate((el) => el.remove());
      }
    }
    await pg.evaluate(UNHOOK);
    fs.writeFileSync(path.join(OUT, `p107-tunepc${process.argv[5] ? `-${process.argv[5].replace(/,/g, '')}` : ''}.json`), JSON.stringify(res, null, 1));
  } finally { await closeApp(app); }
}

// ---- 판 둘레 값(PC 창 1920): 판에 일하는 노드 40개를 창 안에서 흉내 내고(p107-e를 본으로, 판 기록에는 쓰지 않는다) 맞추기 배율로 본다 ----
const FAKE_BOARD = ([n]) => {
  const st = window.__mt.getState();
  const real = [...st.sessions.values()].find((x) => x.name === 'p107-e');
  const base = real && st.nodes.get(real.sessionId);
  if (!base) return 0;
  st.nodes = new Map(st.nodes);
  for (let i = 0; i < n; i++) st.nodes.set(`fkb${i}`, { x: base.x + (i % 8) * (base.w + 60), y: base.y + base.h + 120 + Math.floor(i / 8) * (base.h + 60), w: base.w, h: base.h, z: 1, area: base.area || '' });
  for (let i = 0; i < n; i++) window.__mt.api.emit('session.updated', { ...real, sessionId: `fkb${i}`, name: `fkb-${String(i).padStart(2, '0')}`, state: 'shell_running', shell: { ...(real.shell || {}), atPrompt: false, command: 'ping -n 50 127.0.0.1' } });
  return n;
};
async function ringcost() {
  const { app, page: pg, mainPid } = await launch({ log, env: { ...ENV }, args: AWAKE });
  const res = { motion: MOTION };
  try {
    await pg.setViewportSize({ width: 1920, height: 1080 }).catch(() => {});
    log(`[ringcost] 창 자리(화면 밖) ${JSON.stringify(await awayWin(app))}`);
    await pg.emulateMedia({ reducedMotion: MOTION });
    await sleep(2500);
    if (await pg.$('[data-action="return-close"]')) { await pg.click('[data-action="return-close"]').catch(() => {}); await sleep(300); }
    call('settings.set', { workLight: 'on' });
    const cdp = await pg.context().newCDPSession(pg);
    await cdp.send('Performance.enable');
    const win = async () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return w ? { min: w.isMinimized(), vis: w.isVisible() } : null; }).catch(() => null);
    const span = async () => { let c = null; for (let t = 0; t < 3; t++) { const w0 = await win(); if (w0 && w0.min) { await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) w.restore(); }).catch(() => {}); await sleep(800); } c = await costSpan(pg, cdp, { pid: mainPid }); const w1 = await win(); if (c.frames.mean < 20 && !(w1 && w1.min)) break; log(`[ringcost] 다시 잼(창 ${JSON.stringify(w1)}, 프레임 ${c.frames.mean}ms)`); } return c; };
    log(`[ringcost] 흉내 노드 ${await pg.evaluate(FAKE_BOARD, [40])}`);
    await sleep(1500);
    await pg.evaluate(() => window.__mt.getState().fitAll && window.__mt.getState().fitAll(0)); await sleep(2000);
    await pg.mouse.move(5, 600);
    const rs = await rings(pg);
    res.rings = { visible: rs.length, moving: rs.filter((r) => r.moved).length };
    log(`[ringcost] 화면 안 둘레 ${rs.length}, 도는 것 ${res.rings.moving}`);
    await shot(pg, `ringcost-${MT}-board`);
    // 판만(미션 맵 닫힘): 둘레 부드럽게(지금) / steps(78)(초당 30번) / 끔(멈춘 고리)
    const STEPS = '.mt-node-run > i { animation-timing-function: steps(78, end) !important; }';
    res.board = {};
    for (let r = 0; r < 2; r++) for (const k of ['smooth', 'steps78', 'steps156', 'off']) {
      await setLight(pg, k === 'off' ? 'off' : 'on');
      const tag = k === 'steps78' ? await pg.addStyleTag({ content: STEPS }) : k === 'steps156' ? await pg.addStyleTag({ content: STEPS.replace('78', '156') }) : null;
      await sleep(700);
      const c = await span(); (res.board[k] = res.board[k] || []).push(c); log(`[ringcost] 판 ${k} ${r + 1} ${JSON.stringify(c)}`);
      if (tag) await tag.evaluate((el) => el.remove());
    }
    await setLight(pg, 'on');
    // 미션 맵 덮개(일하는 카드 40) 뒤: 둘레를 멈춤(지금) / 돎(고치기 전과 같게 덮어씀) / 미션 맵만(판 둘레 끔)
    await pg.evaluate(HOOK, ['many', 40]);
    await openMission(pg); await pg.mouse.move(5, 600); await sleep(500);
    // running = 고치기 전(덮개 뒤 판 움직임이 그대로 돈다), ringOnly = 둘레만 멈춤(첫 안), paused = 지금(판 움직임을 모두 멈춤)
    const ALLRUN = 'html[data-mm-open="1"] .react-flow *, html[data-mm-open="1"] .react-flow *::before, html[data-mm-open="1"] .react-flow *::after { animation-play-state: running !important; }';
    const RUN = `${ALLRUN} html[data-mm-open="1"] .react-flow .mt-node-run > i { animation-play-state: running !important; }`;
    const RINGONLY = `${ALLRUN} html[data-mm-open="1"] .react-flow .mt-node-run > i { animation-play-state: paused !important; }`;
    res.mission = {};
    for (let r = 0; r < 2; r++) for (const k of ['paused', 'ringOnly', 'running']) {
      const tag = k === 'running' ? await pg.addStyleTag({ content: RUN }) : k === 'ringOnly' ? await pg.addStyleTag({ content: RINGONLY }) : null;
      await sleep(700);
      if (r === 0) { const q = await rings(pg); const other = await pg.evaluate(() => [...document.querySelectorAll('.react-flow *')].flatMap((e) => e.getAnimations()).filter((a) => !/^mt-run$/.test(a.animationName || '')).map((a) => `${a.animationName}:${a.playState}`)); log(`[ringcost] 덮개 뒤 ${k}: ${JSON.stringify({ n: q.length, play: [...new Set(q.map((x) => x.play))], moving: q.filter((x) => x.moved).length, other: [...new Set(other)] })}`); }
      const c = await span(); (res.mission[k] = res.mission[k] || []).push(c); log(`[ringcost] 덮개 ${k} ${r + 1} ${JSON.stringify(c)}`);
      if (tag) await tag.evaluate((el) => el.remove());
    }
    await pg.evaluate(UNHOOK);
    fs.writeFileSync(path.join(OUT, `p107-ringcost-${MT}.json`), JSON.stringify(res, null, 1));
    const avg = (xs, f) => xs.reduce((a, x) => a + f(x), 0) / xs.length;
    const g = (k) => Math.round(avg(res.mission[k], (x) => x.cpuMs['gpu-process']));
    const t = (k) => Math.round(avg(res.mission[k], (x) => x.per5s.TaskDuration) * 1000);
    log(`[ringcost] 덮개 뒤 GPU(5초 ms): 판 움직임 모두 멈춤 ${g('paused')} / 둘레만 멈춤 ${g('ringOnly')} / 고치기 전(돎) ${g('running')}; 주 스레드 ${t('paused')} / ${t('ringOnly')} / ${t('running')}`);
    check(`[ringcost] 미션 맵을 연 동안 덮개 뒤 둘레를 멈추면 프레임이 그대로다(${MOTION})`, avg(res.mission.paused, (x) => x.frames.mean) < 8, res.mission.paused.map((x) => x.frames));
  } finally { await closeApp(app); }
}

// ---- PC 웹(Chromium, 흉내 원격) ----
async function web() {
  const sim = await startSim();
  const browser = await launchChromium();
  try {
    for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'ko-KR', reducedMotion: MOTION, ...(AFTER ? { recordVideo: { dir: path.join(OUT, `video-web-${MT}`), size: { width: 960, height: 540 } } } : {}) });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[web pageerror] ${e.message}`));
    await pair(pg, `http://localhost:${B0.sim}`);
    await sleep(2500);
    await desk(pg, 'web', 1920);
    if (AFTER) await webCost(pg);
    await ctx.close();
  } finally { await browser.close().catch(() => {}); await sim.close().catch(() => {}); }
}
async function webCost(pg) {
  await pg.evaluate(HOOK, ['real', 0]);
  await openMission(pg);
  await pg.mouse.move(5, 500);
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Performance.enable');
  await setLight(pg, 'on'); const on = await costSpan(pg, cdp);
  await setLight(pg, 'off'); const off = await costSpan(pg, cdp);
  await setLight(pg, 'on');
  log(`[web] 5초 동안 주 스레드 일: 켬 ${JSON.stringify(on)} / 끔 ${JSON.stringify(off)}`);
  fs.writeFileSync(path.join(OUT, `p107-cost-web-${MT}.json`), JSON.stringify({ on, off }, null, 1));
  // 합성 움직임이라도 Chromium은 도는 CSS 움직임이 있으면 프레임마다 스타일을 가볍게 다시 센다(판의 다른 움직임이 멈춘 reduce에서 끔 0번 / 켬 720번). 그래서 횟수가 아니라 걸린 시간과 배치를 본다
  check('[web] 빛(일하는 다섯)이 배치를 늘리지 않고 주 스레드 일이 5초에 0.25초(5%) 넘게 늘지 않는다, 프레임 그대로', on.per5s.LayoutCount - off.per5s.LayoutCount < 3 && on.per5s.TaskDuration - off.per5s.TaskDuration < 0.25 && on.frames.over20 <= off.frames.over20 + 1, { on: on.per5s, off: off.per5s, frames: [on.frames.mean, off.frames.mean] });
  await pg.evaluate(UNHOOK);
  await pg.keyboard.press('Escape');
}

// ---- 휴대폰(WebKit, Chromium) 공용 ----
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const W = 393, HH = 852;
const PHONE = { viewport: { width: W, height: HH }, screen: { width: W, height: HH }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: SAFARI };
const webkitProcs = () => procTree(process.pid).filter((p) => /WebKitWebProcess/i.test(p.name));
const webkitMB = () => Math.round(webkitProcs().reduce((a, p) => a + p.ws, 0) / 1048576);
const webkitCpuMs = () => Math.round(webkitProcs().reduce((a, p) => a + p.cpu, 0) / 1e4);
const cpuSpan = async (ms = 10000) => { const a = webkitCpuMs(); await sleep(ms); return webkitCpuMs() - a; };
const loadedOpen = (pg, ms = 60000) => pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: ms });
const splashGone = (pg) => pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
async function pair(pg, base) {
  await pg.goto(`${base}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await pg.fill('[data-field=pair-code]', call('device.code').code);
  await pg.click('[data-action=pair-submit]');
  await loadedOpen(pg); await splashGone(pg);
}
async function openPhoneMission(pg, hook) {
  if (hook) await pg.evaluate(HOOK, hook);
  if (await pg.$('[data-role=phone-mission]')) { await pg.tap('[data-action=phone-mission-back]'); await sleep(600); }
  await pg.evaluate(() => window.__mtPhone.mission());
  await pg.waitForFunction(() => document.querySelectorAll('[data-role=pm-node]').length >= 10, null, { timeout: 20000 }).catch(() => {});
  await sleep(1800);
}
async function startSim() {
  const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
  const sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  return sim;
}

// 휴대폰 목업: WebKit에서 네 방법의 프레임과 10초 CPU(두 번씩), 메모리
async function mockphone() {
  const sim = await startSim();
  const browser = await webkit.launch({ headless: true });
  try {
    for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
    const ctx = await browser.newContext(PHONE);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[mockphone pageerror] ${e.message}`));
    await pair(pg, `http://localhost:${B0.sim}`);
    await sleep(2500);
    await pg.emulateMedia({ reducedMotion: 'no-preference' });
    await openPhoneMission(pg, ['real', 0]);
    await pg.evaluate(() => window.__mtPm && window.__mtPm.fit()); await sleep(800);
    const p = await pg.evaluate(PH_PROBE);
    log(`[mockphone] 실제 판 모양 ${JSON.stringify(p.nodes.map((n) => `${n.name}:${n.tier}/${n.shape}/${n.w}x${n.h}`))}`);
    const H = '.mt-pm-flash';
    const css = MOCK_CSS(H);
    const res = { tech: TECH, cpu: {}, mem: {}, far: {} };
    const ks = KS;
    for (const k of ks) { res.cpu[k] = []; }
    for (let r = 0; r < 2; r++) {
      for (const k of ks) {
        await pg.evaluate(MOCK_SET, k === 'none' || k === 'flash' ? [null, H, '', ''] : [k, H, css[k], MOCK_DOM[k]]);
        const off = k === 'none' ? await pg.addStyleTag({ content: `${H} { display: none !important; }` }) : null;
        await sleep(900);
        if (r === 0) {
          const w0 = nodeBy(p, 'p107');
          const tiles = [];
          if (w0.w && k !== 'none') for (let i = 0; i < 4; i++) { await pg.evaluate(FREEZE, [i / 4, LIGHT_RE]); await sleep(120); const b = await pg.screenshot({ clip: { x: Math.max(0, w0.x - 8), y: Math.max(0, w0.y - 8), width: Math.min(W - Math.max(0, w0.x - 8), w0.w + 16), height: w0.h + 16 } }); tiles.push({ label: `${k} ${i * 600}ms`, b64: b.toString('base64') }); }
          if (tiles.length) save64(`mock-phone-${k}-frames`, await pg.evaluate(COMPOSE, [tiles, 4, 8]));
          const fr = await frames(pg, 'phone', `mock-${k}`, p, { fracs: [0.2], vw: W });
          res.far[k] = fr.map((x) => ({ ...x, thumb: undefined }));
          await pg.evaluate(THAW, [LIGHT_RE]);
          await sleep(500);
        }
        res.cpu[k].push(await cpuSpan());
        res.mem[k] = webkitMB();
        log(`[mockphone] ${k} 회차 ${r + 1} CPU ${res.cpu[k].join('·')}ms / 10초, 메모리 ${res.mem[k]}MB`);
        if (off) await off.evaluate((el) => el.remove());
      }
    }
    await pg.evaluate(MOCK_SET, [null, H, '', '']);
    await pg.evaluate(UNHOOK);
    fs.writeFileSync(path.join(OUT, `p107-mock-phone${SUB}.json`), JSON.stringify(res, null, 1));
    await ctx.close();
  } finally { await browser.close().catch(() => {}); await sim.close().catch(() => {}); }
}

// ---- 휴대폰: 목록·시트 그대로, 관계도의 빛, 설정(켬·Windows 설정 따름·끔), 메모리(목록 → 관계도 → 큰 판), WebKit CPU ----
const WS_HOOK = () => {
  const Orig = window.WebSocket;
  window.__p107 = { sent: [] };
  class Hooked extends Orig { constructor(...a) { super(...a); const send = this.send.bind(this); this.send = (d) => { try { window.__p107.sent.push({ m: JSON.parse(d).method, t: Math.round(performance.now()) }); } catch {} return send(d); }; } }
  window.WebSocket = Hooked;
};
const PER_CARD_PHONE = Number(process.env.P107_PHONE_PARTS || 1); // 휴대폰 카드마다 도는 원뿔 수(phone.css에 따라)
async function phone(E) {
  const sim = await startSim();
  const browser = E === 'webkit' ? await webkit.launch({ headless: true }) : await launchChromium();
  const mem = {};
  const K = `${E}-${TAG}-${MT}`;
  try {
    for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
    call('settings.set', { workLight: 'on' });
    const ctx = await browser.newContext({ ...PHONE, reducedMotion: MOTION });
    await ctx.addInitScript(WS_HOOK);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[${E} pageerror] ${e.message}`));
    const cdp = E === 'chromium' ? await ctx.newCDPSession(pg) : null;
    if (cdp) await cdp.send('Performance.enable').catch(() => {});
    const readMem = async (label) => { await sleep(1500); if (E === 'webkit') mem[label] = { webkitMB: webkitMB() }; else { const m = await cdp.send('Performance.getMetrics').catch(() => null); const v = m && m.metrics.find((x) => x.name === 'JSHeapUsedSize'); mem[label] = { heapMB: v ? Math.round(v.value / 1048576) : null }; } log(`[${E}] 메모리 ${label} ${JSON.stringify(mem[label])}`); };
    await pair(pg, `http://localhost:${B0.sim}`);
    await sleep(2500);
    check(`[${E}] 페이지의 움직임 설정이 ${MOTION}다`, await pg.evaluate((m) => matchMedia(`(prefers-reduced-motion: ${m})`).matches, MOTION));
    await pg.evaluate(FAKE_ERR); await sleep(400);
    // 세션 목록과 새 세션 시트(맡은 화면 밖)
    await pg.evaluate(() => { const s = document.querySelector('[data-role=phone-scroll]'); if (s) s.scrollTop = 0; });
    await shot(pg, `${K}-00-list`);
    const listPrint = await pg.evaluate(`${STYLE_PRINT}('[data-role=phone-list]')`);
    await pg.tap('[data-action=phone-new]'); await sleep(900);
    await shot(pg, `${K}-00-sheet`);
    const sheetPrint = await pg.evaluate(`${STYLE_PRINT}('[data-role=phone-spawn]')`);
    fs.writeFileSync(path.join(OUT, `p107-style-${E}-${TAG}-${MT}.json`), JSON.stringify({ list: listPrint, sheet: sheetPrint }, null, 1));
    await pg.tap('[data-action=phone-spawn-close]'); await sleep(600);
    if (AFTER) {
      const was = readJson(path.join(OUT, `p107-style-${E}-before-${MT}.json`)) || readJson(path.join(OUT, `p107-style-${E}-before-np.json`));
      check(`[${E}] 휴대폰 세션 목록의 모양이 고치기 전과 같다(계산된 CSS)`, was && sameJson(was.list, listPrint), diffOf(was && was.list, listPrint));
      check(`[${E}] 새 세션 시트의 모양이 고치기 전과 같다(계산된 CSS)`, was && sameJson(was.sheet, sheetPrint), diffOf(was && was.sheet, sheetPrint));
      const p102 = readJson(path.join(P102, `p102-style-${E}-before.json`));
      log(`[${E}] P102 시험의 고치기 전 값과 견줌: 목록 ${p102 && sameJson(p102.list, listPrint) ? '같음' : JSON.stringify(diffOf(p102 && p102.list, listPrint)).slice(0, 600)}, 시트 ${p102 && sameJson(p102.sheet, sheetPrint) ? '같음' : JSON.stringify(diffOf(p102 && p102.sheet, sheetPrint)).slice(0, 600)}`);
    }
    await readMem('list');
    const t0 = await pg.evaluate(() => Math.round(performance.now()));
    await pg.tap('[data-action=phone-mission]');
    await pg.waitForFunction(() => document.querySelectorAll('[data-role=pm-node]').length >= 10, null, { timeout: 20000 }).catch(() => {});
    await sleep(2500);
    let p = await pg.evaluate(PH_PROBE);
    log(`[${E}] 관계도 ${JSON.stringify(p.nodes.map((x) => `${x.name}:${x.tier}/${x.shape}${x.light ? '/light' : ''}${x.flash ? '/flash' : ''}:${x.anims.map((a) => `${a.name}@${a.dur}`).join('+')}`))} mode=${p.mode} reduce=${p.reduce}`);
    await shot(pg, `${K}-01-portrait`);
    const rev = nodeBy(p, P('rev'));
    if (rev.w) { const lf = await liveFrames(pg, { x: Math.max(10, rev.x), y: rev.y, w: Math.min(W - 20, rev.w), h: rev.h }, `${K}-11-live`, 4, 250, 8); log(`[${E}] 실제 시간 프레임 ${lf.n}장 중 바뀐 것 ${lf.distinct}`); if (AFTER) check(`[${E}] 설정 켬(${MOTION})에서 실제 시간 프레임이 바뀐다(빛이 돈다)`, lf.distinct >= 2, lf.distinct); }
    if (AFTER) {
      lightChecks(E, `켬(기본, ${MOTION})`, p, await spinning(pg), true, { perCard: PER_CARD_PHONE });
      const sent = await pg.evaluate((a) => (window.__p107 ? window.__p107.sent : []).filter((x) => x.t >= a).map((x) => x.m), t0);
      check(`[${E}] 관계도 동안 session.messages·terminal.* 요청이 없다`, !sent.some((x) => /^session\.messages$|^terminal\./.test(x)), [...new Set(sent)]);
      // 나중에 일하게 된 카드도 같은 박자
      await pg.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p107-e'); window.__p107e = s; window.__mt.api.emit('session.updated', { ...s, state: 'shell_running', shell: { ...(s.shell || {}), atPrompt: false, command: 'ping -n 50 127.0.0.1' } }); });
      await pg.waitForFunction(() => { const e = document.querySelector('[data-role=pm-node][data-name="p107-e"]'); return e && e.dataset.tier === 'work' && e.querySelector('[data-role=pm-light]'); }, null, { timeout: 10000 }).catch(() => {});
      await sleep(700);
      const q0 = await pg.evaluate(PH_PROBE);
      const sp = phaseSpread(workCards(q0));
      check(`[${E}] 나중에 일하게 된 카드(e)도 같은 박자(자리 차이 60ms 안)`, workCards(q0).some((x) => x.name === P('e')) && sp !== null && sp <= 60, { spread: sp });
      await pg.evaluate(() => { if (window.__p107e) window.__mt.api.emit('session.updated', window.__p107e); });
      await sleep(1000);
      p = await pg.evaluate(PH_PROBE);
      if (rev.w) { const tiles = []; for (let i = 0; i < 4; i++) { await pg.evaluate(FREEZE, [i / 4, LIGHT_RE]); await sleep(150); const b = await pg.screenshot({ clip: { x: Math.max(0, rev.x - 8), y: Math.max(0, rev.y - 8), width: Math.min(W - Math.max(0, rev.x - 8), rev.w + 16), height: rev.h + 16 } }); tiles.push({ label: `t=${i * 600}ms`, b64: b.toString('base64') }); } await pg.evaluate(THAW, [LIGHT_RE]); save64(`${K}-12-lap`, await pg.evaluate(COMPOSE, [tiles, 4, 8])); }
      await setLight(pg, 'system');
      p = await pg.evaluate(PH_PROBE);
      lightChecks(E, `Windows 설정 따름(${MOTION})`, p, await spinning(pg), MOTION === 'no-preference', { perCard: PER_CARD_PHONE });
      await shot(pg, `${K}-13-system`);
      await setLight(pg, 'off');
      p = await pg.evaluate(PH_PROBE);
      lightChecks(E, `끔(${MOTION})`, p, await spinning(pg), false);
      await shot(pg, `${K}-14-off`);
      await setLight(pg, 'on');
    }
    await readMem('mission');
    // 실제 판 모양: 맞추기 배율 그림, 멀리서 본 값, WebKit CPU(켬 / 끔, 10초씩 두 번)
    await openPhoneMission(pg, ['real', 0]);
    await pg.evaluate(() => window.__mtPm && window.__mtPm.fit()); await sleep(600);
    p = await pg.evaluate(PH_PROBE);
    await shot(pg, `${K}-03-real`);
    const fr = await frames(pg, E, `${TAG}-${MT}-03-real`, p, { fracs: [0.1, 0.6], vw: W });
    const diff = farMotion(await pg.evaluate(FAR_DIFF, [fs.readFileSync(path.join(OUT, `${E}-${TAG}-${MT}-03-real-f10.png`)).toString('base64'), fs.readFileSync(path.join(OUT, `${E}-${TAG}-${MT}-03-real-f60.png`)).toString('base64'), boxesOf(p), 0.25, W]));
    const far = { frames: fr.map((x) => ({ ...x, thumb: undefined })), motion: diff };
    fs.writeFileSync(path.join(OUT, `p107-far-${E}-${TAG}-${MT}.json`), JSON.stringify(far, null, 1));
    log(`[${E}] 실제 판 모양 멀리서 본 값 ${JSON.stringify(far)}`);
    if (AFTER) {
      const work = workCards(p);
      check(`[${E}] 실제 판 모양: 일하는 다섯 카드만 돈다, 가로 스크롤 없음`, work.length === 5 && work.every((x) => x.anims.length === PER_CARD_PHONE) && p.nodes.filter((x) => x.tier !== 'work').every((x) => !x.anims.length) && p.page.sw <= p.page.iw, { work: work.map((x) => x.name), page: p.page });
      check(`[${E}] 멀리서(1/4) 일하는 카드만 움직인다(카드 안 가장 큰 픽셀 차이: 일함 25 이상, 다른 카드 8 아래)`, diff.workMinMax >= 25 && diff.otherMaxOf < 8, diff);
    }
    if (E === 'webkit') {
      const cpu = { on: [], off: [] };
      for (let r = 0; r < 2; r++) {
        await setLight(pg, 'on'); cpu.on.push(await cpuSpan());
        await setLight(pg, 'off'); cpu.off.push(await cpuSpan());
      }
      await setLight(pg, 'on');
      mem.cpu = { ...cpu, anims: await pg.evaluate(() => document.getAnimations().length) };
      log(`[${E}] 10초 CPU(ms) ${JSON.stringify(mem.cpu)}`);
    }
    await pg.setViewportSize({ width: HH, height: W }); await sleep(1500);
    await shot(pg, `${K}-02-landscape`);
    if (AFTER) { const q = await pg.evaluate(PH_PROBE); const s2 = await spinning(pg); check(`[${E}] 가로 화면(넓은 카드)에서도 빛이 돌고 카드 밖으로 원뿔 모서리가 보이지 않는다`, workCards(q).length >= 2 && s2.every((s) => s.shown && s.moved), s2.map((s) => `${s.name}:${s.moved}`)); }
    await pg.setViewportSize({ width: W, height: HH }); await sleep(1200);
    // 큰 판
    await pg.evaluate(UNHOOK);
    await openPhoneMission(pg, ['big', 25]);
    await pg.waitForFunction(() => document.querySelectorAll('[data-role=pm-node]').length >= 30, null, { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    p = await pg.evaluate(PH_PROBE);
    await shot(pg, `${K}-04-big`);
    if (AFTER) check(`[${E}] 큰 판(38개): 일하는 카드만 돈다`, p.nodes.length === 38 && workCards(p).every((x) => x.anims.length === PER_CARD_PHONE) && p.nodes.filter((x) => x.tier !== 'work').every((x) => !x.anims.length), { n: p.nodes.length, work: workCards(p).length });
    const sx = p.stage.x + p.stage.w / 2, sy = p.stage.y + p.stage.h / 2;
    if (cdp) {
      for (let i = 0; i < 20; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy + 100, id: 1 }] });
        for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy + 100 - k * (i % 2 ? -20 : 20), id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
    }
    await readMem('big');
    if (E === 'webkit' && AFTER) {
      check(`[${E}] WebKit 웹 프로세스 메모리(목록 → 관계도 → 큰 판)가 P89 수준(늘어남 100MB 안)`, mem.big.webkitMB - mem.list.webkitMB < 100, mem);
      const was = readJson(path.join(OUT, `p107-mem-${E}-before-${MT}.json`));
      const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const base = was && was.cpu ? avg(was.cpu.on) : avg(mem.cpu.off);
      check(`[${E}] WebKit CPU가 크게 늘지 않는다(빛 켬 10초가 고치기 전 번쩍임 켬의 1.5배 + 300ms 안)`, avg(mem.cpu.on) <= base * 1.5 + 300, { before: was && was.cpu, after: mem.cpu });
    }
    fs.writeFileSync(path.join(OUT, `p107-mem-${E}-${TAG}-${MT}.json`), JSON.stringify(mem, null, 1));
    await pg.evaluate(UNHOOK);
    await ctx.close();
  } finally { await browser.close().catch(() => {}); await sim.close().catch(() => {}); }
}

// 휴대폰 가볍게 고르기: 지은 빛(고리 + 빛 무리, 부드럽게)과 가벼운 안들을 WebKit 실제 판 모양에서 10초 CPU(두 번씩)로 견준다. 끔(멈춘 테두리)이 기준
// 첫 회차(가리개 둘: 고리 + 빛 무리)는 built·ring·steps24·ringSteps24·ringSteps12, 가리개를 하나로 합친 뒤는 built(steps 24)·s36·s48·smooth를 견줬다(작업 기록)
const PHONE_TUNE = {
  off: null,
  built: '',
  s36: '.mt-pm-node .mt-mm-lspin::before { animation-timing-function: steps(36, end) !important; }',
  s48: '.mt-pm-node .mt-mm-lspin::before { animation-timing-function: steps(48, end) !important; }',
  smooth: '.mt-pm-node .mt-mm-lspin::before { animation-timing-function: linear !important; }',
}
async function phonetune() {
  const sim = await startSim();
  const browser = await webkit.launch({ headless: true });
  try {
    for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
    call('settings.set', { workLight: 'on' });
    const ctx = await browser.newContext({ ...PHONE, reducedMotion: 'no-preference' });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[phonetune pageerror] ${e.message}`));
    await pair(pg, `http://localhost:${B0.sim}`);
    await sleep(2500);
    await openPhoneMission(pg, ['real', 0]);
    await pg.evaluate(() => window.__mtPm && window.__mtPm.fit()); await sleep(800);
    const p = await pg.evaluate(PH_PROBE);
    log(`[phonetune] 카드 ${JSON.stringify(workCards(p).map((x) => `${x.name}:${x.w}x${x.h}:${x.anims.length}`))}`);
    const res = { cpu: {}, mem: {} };
    const keys = (process.argv[5] || Object.keys(PHONE_TUNE).join(',')).split(',');
    for (let r = 0; r < 2; r++) for (const k of keys) {
      if (k === 'off') await setLight(pg, 'off'); else await setLight(pg, 'on');
      const tag = PHONE_TUNE[k] ? await pg.addStyleTag({ content: PHONE_TUNE[k] }) : null;
      await sleep(900);
      if (r === 0 && k !== 'off') {
        const rev = nodeBy(p, 'p107');
        const tiles = [];
        if (rev.w) for (let i = 0; i < 4; i++) { await pg.evaluate(FREEZE, [i / 4 + 0.02, LIGHT_RE]); await sleep(150); const b = await pg.screenshot({ clip: { x: Math.max(0, rev.x - 8), y: Math.max(0, rev.y - 8), width: Math.min(W - Math.max(0, rev.x - 8), rev.w + 16), height: rev.h + 16 } }); tiles.push({ label: `${k} t=${i * 600}ms`, b64: b.toString('base64') }); }
        await pg.evaluate(THAW, [LIGHT_RE]);
        if (tiles.length) save64(`phonetune-${k}-lap`, await pg.evaluate(COMPOSE, [tiles, 4, 8]));
        await sleep(500);
      }
      (res.cpu[k] = res.cpu[k] || []).push(await cpuSpan());
      res.mem[k] = webkitMB();
      log(`[phonetune] ${k} 회차 ${r + 1} CPU ${res.cpu[k].join('·')}ms / 10초, 메모리 ${res.mem[k]}MB, 움직임 ${await pg.evaluate(() => document.getAnimations().length)}`);
      if (tag) await tag.evaluate((el) => el.remove());
    }
    await setLight(pg, 'on');
    await pg.evaluate(UNHOOK);
    fs.writeFileSync(path.join(OUT, `p107-phonetune${process.argv[5] ? `-${process.argv[5].replace(/,/g, '')}` : ''}.json`), JSON.stringify(res, null, 1));
    await ctx.close();
  } finally { await browser.close().catch(() => {}); await sim.close().catch(() => {}); }
}

// 메모리·CPU만 같은 순서로 잰다(고치기 전·뒤 빌드를 app/dist에 바꿔 끼우고 번갈아 돌린다). TAG는 끼운 빌드, 넷째 인자는 회차
async function memwebkit() {
  const RUN = process.argv[4] || '1';
  const sim = await startSim();
  const browser = await webkit.launch({ headless: true });
  const mem = {};
  try {
    for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
    call('settings.set', { workLight: 'on' });
    const ctx = await browser.newContext({ ...PHONE, reducedMotion: 'no-preference' });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[memwebkit pageerror] ${e.message}`));
    await pair(pg, `http://localhost:${B0.sim}`);
    await sleep(2500);
    const build = await pg.evaluate(() => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => /mt-mm-lring/.test(r.cssText)); } catch { return false; } }) ? 'after' : 'before');
    const readMem = async (label) => { await sleep(2000); mem[label] = webkitMB(); };
    await readMem('list');
    await pg.tap('[data-action=phone-mission]');
    await pg.waitForFunction(() => document.querySelectorAll('[data-role=pm-node]').length >= 10, null, { timeout: 20000 }).catch(() => {});
    await sleep(2500);
    await readMem('mission');
    await openPhoneMission(pg, ['real', 0]);
    await pg.evaluate(() => window.__mtPm && window.__mtPm.fit()); await sleep(800);
    const anims = await pg.evaluate(() => document.getAnimations().length);
    const cpu = [await cpuSpan(), await cpuSpan()];
    await pg.evaluate(UNHOOK);
    await openPhoneMission(pg, ['big', 25]);
    await sleep(2500);
    await readMem('big');
    const out = { tag: TAG, build, run: RUN, mem, grow: mem.big - mem.list, cpu, anims };
    log(`[memwebkit] ${JSON.stringify(out)}`);
    fs.writeFileSync(path.join(OUT, `p107-memseq-${TAG}-${RUN}.json`), JSON.stringify(out, null, 1));
    check(`[memwebkit] 끼운 빌드가 ${TAG}다`, build === TAG, build);
    await pg.evaluate(UNHOOK);
    await ctx.close();
  } finally { await browser.close().catch(() => {}); await sim.close().catch(() => {}); }
}

// 고치기 전·뒤 비교 그림을 묶는다(빈 Chromium 페이지의 캔버스)
async function compose() {
  const browser = await launchChromium();
  try {
    const pg = await (await browser.newContext()).newPage();
    const b64 = (f) => (fs.existsSync(path.join(OUT, `${f}.png`)) ? fs.readFileSync(path.join(OUT, `${f}.png`)).toString('base64') : null);
    const sets = {
      'compare-pc-rm': [['pc-before-rm-05-real', '1920 before, reduce (P102: still)'], ['pc-after-rm-05-real-f10', '1920 after, reduce, setting on'], ['pc-after-rm-05-real-f60', 'same, 1.4s later']],
      'compare-pc-np': [['pc-before-np-05-real-f10', '1920 before, no-preference (P102 flash)'], ['pc-after-np-05-real-f10', '1920 after, no-preference'], ['pc-after-np-05-real-f60', 'same, 1.4s later']],
      'compare-pc2560': [['pc2560-before-np-05-real', '2560 before'], ['pc2560-after-rm-05-real-f10', '2560 after, reduce'], ['pc2560-after-np-05-real-f60', '2560 after, no-preference']],
      'compare-web': [['web-before-np-05-real', 'web before'], ['web-after-rm-05-real-f10', 'web after, reduce'], ['web-after-np-05-real-f60', 'web after, no-preference']],
      'compare-modes-pc-rm': [['pc-after-rm-01-map', 'on (reduce)'], ['pc-after-rm-13-system', 'follow Windows (reduce): still'], ['pc-after-rm-14-off', 'off: still'], ['pc-after-rm-15-lite', 'lite board: still']],
      'compare-modes-pc-np': [['pc-after-np-01-map', 'on'], ['pc-after-np-13-system', 'follow Windows (no-preference): runs'], ['pc-after-np-14-off', 'off: still'], ['pc-after-np-15-lite', 'lite board: still']],
      'compare-phone': [['webkit-before-np-03-real', 'WebKit before'], ['webkit-after-np-03-real-f10', 'WebKit after'], ['webkit-after-rm-03-real-f60', 'WebKit after, reduce'], ['chromium-after-np-03-real-f10', 'Chromium after']],
      'compare-phone-list-sheet': [['webkit-before-np-00-list', 'list before'], ['webkit-after-np-00-list', 'list after'], ['webkit-before-np-00-sheet', 'sheet before'], ['webkit-after-np-00-sheet', 'sheet after']],
      'compare-live-pc-rm': [0, 1, 2, 3].map((i) => [`pc-after-rm-11-live-${i}`, `PC reduce, live ${i * 200}ms`]),
      'compare-live-webkit': [0, 1, 2, 3].map((i) => [`webkit-after-rm-11-live-${i}`, `WebKit reduce, live ${i * 250}ms`]),
      'compare-board-ring-rm': [['pc-after-rm-31-board-on', 'board, reduce, on: ring spins'], ['pc-after-rm-32-board-system', 'follow Windows (reduce): still'], ['pc-after-rm-33-board-off', 'off: still']],
      'compare-board-ring-live-rm': [0, 1, 2, 3].map((i) => [`pc-after-rm-30-ring-live-${i}`, `board ring, reduce, live ${i * 200}ms`]),
    };
    for (const [name, list] of Object.entries(sets)) {
      const items = list.map(([f, label]) => ({ b64: b64(f), label })).filter((x) => x.b64);
      if (!items.length) { log(`묶기 건너뜀 ${name}`); continue; }
      save64(name, await pg.evaluate(COMPOSE, [items, name.includes('live') ? 4 : list.length > 3 ? 4 : 3, 12]));
      log(`묶음 ${name} (${items.length})`);
    }
  } finally { await browser.close().catch(() => {}); }
}

async function stopBoard() {
  for (const s of sessions().filter((x) => /^p107-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
  await sleep(2000);
  try { log(atrium('backend', 'stop').slice(0, 200)); } catch (e) { log(`backend stop ${e.message.slice(0, 120)}`); }
}

try {
  if (WHAT === 'setup') { await setupBoard(); await stir(); }
  else if (WHAT === 'stir') await stir();
  else if (WHAT === 'mockpc') { await stir(); await mockpc(); }
  else if (WHAT === 'mockphone') { await stir(); await mockphone(); }
  else if (WHAT === 'pc') { await stir(); await pc(); }
  else if (WHAT === 'pc2560') { await stir(); await pc(2560, 1440, 'pc2560'); }
  else if (WHAT === 'web') { await stir(); await web(); }
  else if (WHAT === 'webkit' || WHAT === 'chromium') { await stir(); await phone(WHAT); }
  else if (WHAT === 'phonetune') { await stir(); await phonetune(); }
  else if (WHAT === 'tunepc') { await stir(); await tunepc(); }
  else if (WHAT === 'ringcost') { await stir(); await ringcost(); }
  else if (WHAT === 'memwebkit') { await stir(); await memwebkit(); }
  else if (WHAT === 'compose') await compose();
  else if (WHAT === 'restart') { try { log(atrium('backend', 'stop').slice(0, 200)); } catch (e) { log(`backend stop ${e.message.slice(0, 120)}`); } await sleep(2000); log(atrium('backend', 'start').trim().slice(0, 300)); await sleep(3000); log(`설정 ${JSON.stringify(call('settings.get').settings.workLight)}`); }
  else if (WHAT === 'stop') await stopBoard();
  else throw new Error(`모르는 단계 ${WHAT}`);
} catch (e) { log(`오류 ${e.stack || e.message}`); results.push({ name: 'run', ok: false, detail: e.message }); }
const fails = results.filter((r) => !r.ok);
log(`결과 ${results.length - fails.length}/${results.length}`);
fs.writeFileSync(path.join(OUT, `p107-${WHAT}-${TAG}${['pc', 'pc2560', 'web', 'webkit', 'chromium', 'ringcost'].includes(WHAT) ? `-${MT}` : ''}.json`), JSON.stringify(results, null, 1));
process.exit(fails.length ? 1 : 0);
