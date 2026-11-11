// P102 창 시험: 미션 맵의 일하는 세션이 멀리서도 보이는 움직임(PC 창 1920·2560, PC 웹, 휴대폰 WebKit·Chromium). 한 번에 한 화면만 돌린다(메모리).
// 판: 따로 띄운 개발용 판(atrium-dev-p102, 47896, backend/.dev)만 쓴다. 흉내 원격(p59-lib.mjs, ts-sim-proxy.mjs) 47986·47985.
//   판 A(실제 세션): 워크스페이스 10개(mtask-p102-a…j). 리드 p102-lead(a, haiku, 권한 질문 = 응답 필요), 하위 p102-rev(haiku, reviewer, ping = 일함),
//     역할 선 p102-tests(ping 도는 셸 = 일함)·p102-build(셸, 창 안에서 오류로 흉내), 잠든 p102-old(d, haiku), 셸 p102-docs(c)·p102-e…j(혼자)
//   판 B(실제 판 모양): 페이지 안에서 mission.graph 답을 워크스페이스 12개, 일하는 세션 다섯(셸 하나)과 응답 필요·오류·결과·쉼·잠듦·끝남이 섞인 흉내 판으로 바꾼다.
//   큰 판: mission.graph 답에 흉내 세션 25개를 더한다.
// 목업(mock): 지금 빌드 위에 안 셋(A 테두리 맥박, B 바탕 번쩍임, C 상태 점 고리)을 CSS로 덧입혀 같은 장면의 정점·바닥 프레임과 멀리서 본 축소 그림을 찍는다.
// 실행(실제 판의 변수를 지운 셸로): sh backend/.dev/clean-env.sh node app/test/e2e/p102-mission.mjs <setup|stir|pc|pc2560|web|webkit|chromium|mockpc|mockphone|stop> [before|after]
// 결과는 주 체크아웃의 experiments/p102/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const TAG = process.argv[3] || 'after';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const MAIN = /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) ? path.resolve(REPO, '..', '..', '..') : REPO; // 워크트리면 주 체크아웃
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(MAIN, 'experiments', 'p102');
const CONVOS = path.join(OUT, 'convos');
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const DIRS = LETTERS.map((k) => `C:\\Workspace\\mtask-p102-${k}`);
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
process.env.MT_E2E_OUT = path.relative(path.join(REPO, 'experiments'), OUT);
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A } = L;
const B0 = L.board({ session: 'atrium-dev-p102', port: 47896, sim: 47986, sim2: 47985 });
const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p102-none-',
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

const log = logger(`p102-${WHAT}-${TAG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const shot = (pg, name, opt = {}) => pg.screenshot({ path: path.join(OUT, `${name}.png`), ...opt }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
const AFTER = TAG === 'after';
const P = (k) => `p102-${k}`;

// ---- 판 A ----
const LONG = (n) => `Use the Bash tool to run this command in the foreground, not in the background, with timeout 600000: ping -n ${n} 127.0.0.1 . Wait for it to finish. Then reply with the single word done.`;
const ASK = 'Use the Bash tool to run exactly: mkdir p102-ask-dir . Then reply with the single word done.';
const envOf = (name) => {
  const s = byName(name);
  const settings = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'sessions', `${s.sessionId || s.id}.json`), 'utf8'));
  const e = { ...process.env, ...Object.fromEntries(Object.entries(settings.env || {}).filter(([k]) => k.startsWith('ATRIUM_'))) };
  if (!e.ATRIUM_SESSION_ID || !e.ATRIUM_SESSION_TOKEN) throw new Error(`${name}: 설정 파일에 세션 env가 없다`);
  return e;
};
const child = (pe, args, ms = 150000) => new Promise((resolve) => execFile(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), ...args], { encoding: 'utf8', env: pe, timeout: ms }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout || ''}${stderr || ''}`.trim() })));
const trustStop = () => {
  const tr = sessions().find((s) => /^p102-/.test(s.name) && s.state === 'trust_wait');
  if (tr) { fs.writeFileSync(path.join(DEV, 'p102-need-trust.txt'), `${tr.name} asks the folder trust question in a test folder\n`); throw new Error('trust question (backend/.dev/p102-need-trust.txt)'); }
};
const readyOf = (n, ms = 150000) => until(() => { const s = byName(n); return s && ['ready', 'working', 'waiting', 'trust_wait'].includes(s.state) ? s : null; }, ms, 1500).catch(() => null);
const LINKS = [['lead', 'tests', 'test runner'], ['lead', 'build', 'build worker'], ['rev', 'lead', 'report'], ['rev', 'old', 'archive']];

async function setupBoard() {
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  for (const d of [DIRS[0]]) {
    fs.mkdirSync(path.join(d, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(d, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ping:*)', 'Bash(ping *)'] } }, null, 1)); // ping만 묻지 않는다(P85)
  }
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
  // p102-old에게 한 번 답하게 한 뒤 워크스페이스 d를 잠재운다(claude는 대화가 있어야 잠든다, P94)
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
  if (byName(P('lead')).state !== 'waiting') atrium('send', `@${P('lead')}`, ASK);
  await until(() => byName(P('rev')).state === 'working' && byName(P('lead')).state === 'waiting' && (byName(P('tests')).shell || {}).atPrompt === false, 150000, 1500).catch(() => {});
  log(`세션 ${sessions().filter((s) => /^p102-/.test(s.name)).map((s) => `${s.name}:${s.state}${s.shell ? `/${s.shell.atPrompt === false ? 'run' : 'idle'}` : ''}`).join(' ')}`);
}
// 창 안에서 build를 오류로 흉내 낸다(P93)
const FAKE_ERR = () => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p102-build'); if (s) window.__mt.api.emit('session.updated', { ...s, state: 'error', error: { message: 'exit 1: build failed' }, lastActivityAt: Date.now() - 60000 }); return !!s; };

// ---- 흉내 판(페이지 안에서 mission.graph 답을 바꾼다) ----
const HOOK = ([mode, n]) => {
  const api = window.__mt.api;
  if (!api.__p102orig) api.__p102orig = api.call.bind(api);
  const now = Date.now();
  const real = () => {
    const ws = ['multitask', 'blog', 'artex-ko', 'notes', 'scraper', 'infra', 'dotfiles', 'research', 'api', 'site', 'landing', 'paper'].map((x) => `C:/Workspace/fake-${x}/.git`);
    const S = (i, name, w, o = {}) => ({ id: `s:fk${i}`, kind: 'session', sessionId: `fk${i}`, name, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: ws[w], parentId: null, role: null, order: null, createdAt: 1e12 + i, loops: 0, model: 'claude-opus-5-5', effort: 'high', activeAt: now - (i + 1) * 7e5, turnAt: null, gitBranch: null, ...o });
    const W = (o) => ({ state: 'working', category: 'working', turnAt: now - 9e5, ...o });
    const nodes = [{ id: 'human', kind: 'human', name: 'you' },
      S(0, 'conductor', 0, W({ model: 'claude-fable-5-1', turnAt: now - 72e5, lastPrompt: 'Merge P102 when the worker reports' })),
      S(1, 'p102', 0, W({ parentId: 's:fk0', role: 'mission flash', gitBranch: 'worktree-p102', lastPrompt: 'Make working sessions flash' })),
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
      { from: 's:fk1', to: 's:fk0', kind: 'prompt', label: 'p102 done', count: 1, lastAt: now - 6e5 }, { from: 's:fk4', to: 's:fk1', kind: 'role', label: 'review' },
      { from: 's:fk6', to: 's:fk7', kind: 'role', label: 'copy' }, { from: 's:fk7', to: 's:fk6', kind: 'prompt', label: 'copy done', count: 1, lastAt: now - 3e6 }];
    return { nodes, edges, counts: { all: nodes.length - 1 }, at: now };
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
    edges.push({ from: 's:big1', to: 's:big0', kind: 'prompt', label: 'report', count: 2, active: false });
    return { ...g, nodes, edges };
  };
  api.call = (m, p) => (m === 'mission.graph' ? (mode === 'real' ? Promise.resolve(real()) : api.__p102orig(m, p).then(big)) : api.__p102orig(m, p));
};
const UNHOOK = () => { const api = window.__mt.api; if (api.__p102orig) api.call = api.__p102orig; };

// ---- 움직임 읽기: 카드마다 도는 움직임, 키프레임의 속성, 초당 번쩍임 ----
// 번쩍임 = 한 주기 안에서 투명도(또는 크기)가 높아졌다 낮아지는 정점 수. 초당 번쩍임 = 정점 수 ÷ 주기(초)
const ANIM_OF = `((root) => (root.getAnimations ? root.getAnimations({ subtree: true }) : []).map((a) => {
  const ef = a.effect, tm = ef && ef.getTiming ? ef.getTiming() : {}, ks = ef && ef.getKeyframes ? ef.getKeyframes() : [];
  const props = [...new Set(ks.flatMap((k) => Object.keys(k).filter((x) => !['offset', 'computedOffset', 'easing', 'composite'].includes(x))))];
  const vals = ks.map((k) => (k.opacity !== undefined ? parseFloat(k.opacity) : k.transform ? (parseFloat(String(k.transform).replace(/[^0-9.\\-]+/, ' ').trim()) || 0) : 0));
  let peaks = 0; for (let i = 0; i < vals.length; i++) { const p = vals[(i - 1 + vals.length) % vals.length], c = vals[i], n = vals[(i + 1) % vals.length]; if (c > p && c >= n && !(i === vals.length - 1 && ks[0] && ks[0].computedOffset === 0 && vals[0] === c)) peaks++; }
  const dur = typeof tm.duration === 'number' ? tm.duration : parseFloat(tm.duration) || 0;
  const phase = dur && a.currentTime !== null ? Math.round((((a.currentTime - (tm.delay || 0)) % dur) + dur) % dur) : null; // 한 주기 안의 자리(ms)
  return { name: a.animationName || null, pseudo: ef && ef.pseudoElement || null, props, dur, easing: tm.easing || null, kEasing: ks.map((k) => k.easing).filter((x) => x && x !== 'linear'), peaks, perSec: dur ? Math.round((peaks / (dur / 1000)) * 100) / 100 : null, state: a.playState, phase };
}))`;

// ---- 지도 읽기(PC) ----
const PC_PROBE = `(() => {
  const m = document.querySelector('[data-role=mission]');
  if (!m) return null;
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const animOf = ${ANIM_OF};
  const nodes = [...m.querySelectorAll('[data-role=mm-node][data-kind=session]')].map((e) => { const s = getComputedStyle(e); const fl = e.querySelector('[data-role=mm-flash]'); const fs = fl ? getComputedStyle(fl) : null;
    return { name: e.dataset.name, tier: e.dataset.tier || null, shape: e.dataset.shape || null, shell: e.classList.contains('shell'), recede: e.classList.contains('recede'), fdim: e.classList.contains('fdim'),
      border: { w: parseFloat(s.borderTopWidth) || 0, c: s.borderTopColor, style: s.borderTopStyle }, glint: !!e.querySelector('[data-role=mm-glint]'), flash: !!fl,
      flashStyle: fs ? { opacity: fs.opacity, borderW: parseFloat(fs.borderTopWidth) || 0, borderC: fs.borderTopColor, bg: fs.backgroundColor, anim: fs.animationName, dur: fs.animationDuration, timing: fs.animationTimingFunction } : null,
      anims: animOf(e), ...R(e) }; });
  const sum = m.querySelector('[data-role=mm-summary]');
  const sec = (k) => (sum && sum.querySelector('[data-role=mm-sum-' + k + ']')) ? [...sum.querySelectorAll('[data-role=mm-sum-' + k + '] [data-role=mm-sum-item]')].map((e) => e.dataset.name) : [];
  const body = m.querySelector('.mt-mission-body');
  return { nodes, summary: sum ? { turn: sec('turn'), work: sec('work') } : null, body: body ? { w: body.clientWidth, h: body.clientHeight, sh: body.scrollHeight, sw: body.scrollWidth } : null, bg: getComputedStyle(m).backgroundColor };
})()`;
// 휴대폰 지도 읽기
const PH_PROBE = `(() => {
  const st = document.querySelector('[data-role=pm-stage]');
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const animOf = ${ANIM_OF};
  const nodes = [...document.querySelectorAll('[data-role=pm-node]')].map((e) => { const s = getComputedStyle(e); const fl = e.querySelector('[data-role=pm-flash]'); const fs = fl ? getComputedStyle(fl) : null;
    return { name: e.dataset.name, tier: e.dataset.tier, shape: e.dataset.shape || null, dim: e.classList.contains('dim'), border: { w: parseFloat(s.borderTopWidth) || 0, c: s.borderTopColor }, flash: !!fl,
      flashStyle: fs ? { opacity: fs.opacity, borderW: parseFloat(fs.borderTopWidth) || 0, borderC: fs.borderTopColor, bg: fs.backgroundColor, anim: fs.animationName, dur: fs.animationDuration, timing: fs.animationTimingFunction } : null,
      anims: animOf(e), ...R(e) }; });
  const world = document.querySelector('[data-role=pm-world]');
  return { nodes, stage: st ? R(st) : null, world: world ? R(world) : null, view: window.__mtPm ? window.__mtPm.view() : null, page: { sw: document.documentElement.scrollWidth, iw: innerWidth }, docAnims: document.getAnimations().length };
})()`;

// ---- 목업: 지금 빌드 위에 CSS로 덧입힌다(PC는 .mt-mm-card, 휴대폰은 .mt-pm-node). 모두 opacity·transform만 움직인다 ----
// A 테두리 맥박: 카드 바깥 2px 상태 색 테두리가 옅어졌다 밝아진다(1.6초, 부드럽게)
// B 바탕 번쩍임: 카드 바탕에 옅은 상태 색과 2px 테두리가 빠르게 차올랐다 천천히 빠진다(1.4초, 빠른 오름)
// C 상태 점 고리: 오른쪽 위 종류 동그라미에서 상태 색 고리가 커지며 사라진다(1.4초, transform + opacity), 카드 테두리는 그대로
const MOCK_CSS = (sel, av) => ({
  A: `${sel}.t-work { --p102m: var(--st-working); } ${sel}.t-work.shell { --p102m: var(--st-shell_running); }
${sel}.t-work::after { content: ""; position: absolute; inset: -3px; border-radius: 11px; border: 2px solid var(--p102m); pointer-events: none; opacity: .25; animation: p102mA 1.6s ease-in-out infinite; }
@keyframes p102mA { 50% { opacity: 1; } }`,
  B: `${sel}.t-work { --p102m: var(--st-working); isolation: isolate; } ${sel}.t-work.shell { --p102m: var(--st-shell_running); }
${sel}.t-work::after { content: ""; position: absolute; inset: -1px; border-radius: 9px; border: 2px solid var(--p102m); background: color-mix(in srgb, var(--p102m) 24%, transparent); pointer-events: none; z-index: -1; opacity: .12; animation: p102mB 1.4s cubic-bezier(.3, 0, .2, 1) infinite; }
@keyframes p102mB { 0% { opacity: .12; } 14% { opacity: 1; } 100% { opacity: .12; } }`,
  C: `${sel}.t-work ${av} { --p102m: var(--st-working); } ${sel}.t-work.shell ${av} { --p102m: var(--st-shell_running); }
${sel}.t-work ${av}::after { content: ""; position: absolute; inset: -2px; border-radius: 50%; border: 2px solid var(--p102m); pointer-events: none; opacity: 0; animation: p102mC 1.4s cubic-bezier(.2, .6, .4, 1) infinite; }
@keyframes p102mC { 0% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(3.2); } }`,
});
const GLINT_OFF = '.mt-mm-glint { display: none !important; }';
// 목업 움직임을 한 시점(주기에 대한 비율)에 멈춘다
// 번쩍임 층은 박자를 맞추는 음수 지연이 있어, 지연만큼 당겨 놓는다(active time = currentTime - delay). 열 주기 뒤로 두어 음수가 되지 않게 한다
const FREEZE = (frac) => { for (const a of document.getAnimations()) { if (!/^p102m|^mt-mm-sweep|^mt-mm-flash|^mt-pm-flash/.test(a.animationName || '')) continue; const tm = a.effect.getTiming(); const d = typeof tm.duration === 'number' ? tm.duration : 1400; a.pause(); a.currentTime = d * frac + (tm.delay || 0) + d * 10; } };
const THAW = () => { for (const a of document.getAnimations()) if (/^p102m|^mt-mm-sweep|^mt-mm-flash|^mt-pm-flash/.test(a.animationName || '')) a.play(); };

// ---- 멀리서 본 그림: 스크린숏을 줄여(1/4) 카드마다 평균 색을 잰다(페이지 안 캔버스) ----
// boxes: [{ name, tier, x, y, w, h }](CSS px), scale: 줄임 비율, vw: 창 폭(CSS px)
const FAR = async ([b64, boxes, scale, vw]) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const dpr = img.width / vw, W = Math.max(1, Math.round(img.width * scale / dpr)), H = Math.max(1, Math.round(img.height * scale / dpr));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const stat = (b) => { const x0 = Math.max(0, Math.round(b.x * scale)), y0 = Math.max(0, Math.round(b.y * scale)), x1 = Math.min(W, Math.round((b.x + b.w) * scale)), y1 = Math.min(H, Math.round((b.y + b.h) * scale)); let r = 0, g = 0, bl = 0, n = 0, mx = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * W + xx) * 4; r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; const L = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]); if (L > mx) mx = L; }
    if (!n) return null; r /= n; g /= n; bl /= n; return { rgb: [Math.round(r), Math.round(g), Math.round(bl)], L: Math.round((0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl)) * 10000) / 10000, peakL: Math.round(mx * 10000) / 10000 }; };
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
const save64 = (name, b64) => fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(b64, 'base64'));
// 대비(WCAG 식)
const cr = (a, b) => { const [h, l] = a > b ? [a, b] : [b, a]; return Math.round(((h + 0.05) / (l + 0.05)) * 100) / 100; };
// 멀리서 본 값 요약: 일하는 카드 평균 밝기, 다른 카드 평균 밝기, 그 대비, 응답 필요·오류와의 색 거리
function farSummary(f) {
  const by = (t) => f.cards.filter((c) => c && c.L !== undefined && (Array.isArray(t) ? t.includes(c.tier) : c.tier === t));
  const avg = (xs, k) => (xs.length ? xs.reduce((a, c) => a + c[k], 0) / xs.length : 0);
  const rgbAvg = (xs) => [0, 1, 2].map((i) => (xs.length ? Math.round(xs.reduce((a, c) => a + c.rgb[i], 0) / xs.length) : 0));
  const work = by('work'), other = by(['rest', 'sleep', 'done', 'review']), turn = by('turn'), alert = by('alert');
  const dist = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  const wRgb = rgbAvg(work);
  return { workL: Math.round(avg(work, 'L') * 1e4) / 1e4, workPeakL: Math.round(avg(work, 'peakL') * 1e4) / 1e4, otherL: Math.round(avg(other, 'L') * 1e4) / 1e4, contrast: cr(avg(work, 'L'), avg(other, 'L')), workRgb: wRgb, turnRgb: rgbAvg(turn), alertRgb: rgbAvg(alert), dTurn: turn.length ? dist(wRgb, rgbAvg(turn)) : null, dAlert: alert.length ? dist(wRgb, rgbAvg(alert)) : null };
}

// 멀리서 본 값의 검사(고치기 전: 대비 1.05~1.08, 응답 필요·오류와의 색 거리 1~5)
function farChecks(E, fr, table) {
  check(`[${E}] 멀리서(1/4로 줄여) 일하는 카드의 정점이 다른 카드보다 뚜렷하다(대비 1.4 이상)`, fr.peak.contrast >= 1.4, table);
  check(`[${E}] 멀리서 정점의 일하는 카드는 응답 필요·오류 카드와 색이 갈린다(색 거리 25 이상)`, (fr.peak.dTurn === null || fr.peak.dTurn >= 25) && (fr.peak.dAlert === null || fr.peak.dAlert >= 25), { dTurn: fr.peak.dTurn, dAlert: fr.peak.dAlert });
  check(`[${E}] 정점과 바닥이 멀리서도 다르게 보인다(밝기 1.4배 이상)`, fr.peak.workL >= fr.low.workL * 1.4, { peak: fr.peak.workL, low: fr.low.workL });
}

async function openMission(pg) {
  if (await pg.$('[data-action="return-close"]')) { await pg.click('[data-action="return-close"]').catch(() => {}); await sleep(300); } // 자리 비운 동안 바뀐 것 카드(요약 열을 가린다)
  if (await pg.$('[data-role="mission"]')) { await pg.keyboard.press('Escape'); await sleep(400); }
  await pg.click('[data-action="mission-rail"]');
  await pg.waitForSelector('[data-role="mission"] [data-role="mm-node"], [data-role="mission"] [data-role="mm-group"]', { timeout: 20000 });
  await sleep(1800);
}
const nodeBy = (p, name) => p.nodes.find((x) => x.name === name) || {};
// PC 판(캔버스)의 노드 틀 모양(미션 맵 밖 화면: 고치기 전·뒤가 같아야 한다)
const NODE_PRINT = `(() => [...document.querySelectorAll('.mt-node')].map((e) => { const s = getComputedStyle(e); return [e.dataset.name, ...['borderTopWidth', 'borderTopStyle', 'borderRadius', 'fontFamily', 'fontSize', 'paddingTop'].map((k) => s[k])].join('|'); }).sort())()`;
// 미션 맵의 일하지 않는 카드·알약 모양(맡은 화면 안이지만 바뀌면 안 되는 것)
const REST_PRINT = `(() => [...document.querySelectorAll('[data-role=mission] [data-role=mm-node][data-kind=session]')].filter((e) => e.dataset.tier !== 'work').map((e) => { const s = getComputedStyle(e); return [e.dataset.name, e.dataset.tier, ...['borderTopWidth', 'borderTopStyle', 'borderTopColor', 'backgroundColor', 'borderRadius', 'opacity', 'boxShadow'].map((k) => s[k]), e.getAnimations({ subtree: true }).length].join('|'); }).sort())()`;

// 카드 상자(멀리서 본 그림의 재기 대상)
const boxesOf = (p) => p.nodes.filter((n) => n.w > 0).map((n) => ({ name: n.name, tier: n.tier, x: n.x, y: n.y, w: n.w, h: n.h }));

// 같은 장면을 프레임 몇 장(정점·바닥)으로 찍고 멀리서 본 값을 잰다. label: 안 이름
async function frames(pg, E, label, p, { peak = 0.14, low = 0.62, vw }) {
  const out = {};
  for (const [k, frac] of [['peak', peak], ['low', low]]) {
    await pg.evaluate(FREEZE, frac); await sleep(250);
    const buf = await pg.screenshot();
    fs.writeFileSync(path.join(OUT, `${E}-${label}-${k}.png`), buf);
    const f = await pg.evaluate(FAR, [buf.toString('base64'), boxesOf(p), 0.25, vw]);
    save64(`${E}-${label}-${k}-far`, f.thumb);
    out[k] = { ...farSummary(f), thumb: f.thumb };
  }
  await pg.evaluate(THAW);
  return out;
}

// ---- 목업 비교(PC 창 1920·2560): 실제 판 모양에서 지금(빛줄기)·A·B·C ----
async function mockDesk(pg, E, vw) {
  await pg.evaluate(HOOK, ['real', 0]);
  await openMission(pg);
  await pg.mouse.move(vw - 120, 82); await sleep(300);
  const p = await pg.evaluate(PC_PROBE);
  log(`[${E}] 실제 판 모양 ${JSON.stringify(p.nodes.map((n) => `${n.name}:${n.tier}/${n.shape}`))}`);
  const res = {}, tiles = [], fars = [];
  // 지금(P101 빛줄기): 빛줄기가 위 가장자리 가운데쯤 지날 때와 가장자리 밖일 때
  res.now = await frames(pg, E, 'mock-now', p, { peak: 0.45, low: 0.98, vw });
  const css = MOCK_CSS('.mt-mm-card', '.mt-mm-av');
  for (const k of ['A', 'B', 'C']) {
    const tag = await pg.addStyleTag({ content: `${GLINT_OFF}\n${css[k]}` }); await sleep(600);
    const fr = k === 'A' ? { peak: 0.5, low: 0.0 } : k === 'B' ? { peak: 0.14, low: 0.92 } : { peak: 0.3, low: 0.95 };
    res[k] = await frames(pg, E, `mock-${k}`, p, { ...fr, vw });
    // 카드 하나 확대(프레임 넷)
    const w0 = nodeBy(p, 'p102');
    if (w0.w) for (let i = 0; i < 4; i++) { await pg.evaluate(FREEZE, i / 4); await sleep(120); await shot(pg, `${E}-mock-${k}-card-${i}`, { clip: { x: Math.max(0, w0.x - 16), y: Math.max(0, w0.y - 16), width: w0.w + 48, height: w0.h + 32 } }); }
    await pg.evaluate(THAW);
    await tag.evaluate((el) => el.remove()); await sleep(300);
  }
  for (const k of ['now', 'A', 'B', 'C']) { fars.push({ label: `${k} peak`, b64: res[k].peak.thumb }, { label: `${k} low`, b64: res[k].low.thumb }); }
  save64(`${E}-mock-compare-far`, await pg.evaluate(COMPOSE, [fars, 2, 12]));
  for (const k of ['now', 'A', 'B', 'C']) tiles.push({ label: `${k} peak`, b64: fs.readFileSync(path.join(OUT, `${E}-mock-${k === 'now' ? 'now' : k}-peak.png`)).toString('base64') });
  save64(`${E}-mock-compare-peak`, await pg.evaluate(COMPOSE, [tiles, 2, 12]));
  const table = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { peak: { ...v.peak, thumb: undefined }, low: { ...v.low, thumb: undefined } }]));
  fs.writeFileSync(path.join(OUT, `p102-mock-${E}.json`), JSON.stringify(table, null, 1));
  log(`[${E}] 목업 멀리서 본 값 ${JSON.stringify(table)}`);
  await pg.evaluate(UNHOOK);
  await pg.keyboard.press('Escape');
}

// ---- PC 창과 PC 웹이 같이 쓰는 지도 시험 ----
async function desk(pg, E, vw) {
  if (await pg.$('[data-action="return-close"]')) { await pg.click('[data-action="return-close"]').catch(() => {}); await sleep(300); }
  await pg.evaluate(FAKE_ERR); await sleep(400);
  await shot(pg, `${E}-${TAG}-00-board`);
  const nodePrint = await pg.evaluate(NODE_PRINT);
  fs.writeFileSync(path.join(OUT, `p102-board-${E}-${TAG}.json`), JSON.stringify(nodePrint, null, 1));
  if (AFTER) {
    const was = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, `p102-board-${E}-before.json`), 'utf8')); } catch { return null; } })();
    check(`[${E}] PC 판(캔버스) 노드 틀 모양이 고치기 전과 같다(계산된 CSS)`, was && JSON.stringify(was) === JSON.stringify(nodePrint) && nodePrint.length >= 12, was ? { before: was.length, after: nodePrint.length, diff: nodePrint.filter((x, i) => was[i] !== x).slice(0, 3) } : 'no before');
  }
  // 판 A(실제 세션)
  await openMission(pg);
  await pg.evaluate(FAKE_ERR); await sleep(600);
  await pg.mouse.move(vw - 120, 82); await sleep(300);
  let p = await pg.evaluate(PC_PROBE);
  log(`[${E}] 지도 ${JSON.stringify(p.nodes.map((n) => `${n.name}:${n.tier}/${n.shape}${n.flash ? '/flash' : ''}${n.glint ? '/glint' : ''}:${n.anims.map((a) => `${a.name}@${a.dur}`).join('+')}`))}`);
  await shot(pg, `${E}-${TAG}-01-map`);
  const restPrint = await pg.evaluate(REST_PRINT);
  fs.writeFileSync(path.join(OUT, `p102-rest-${E}-${TAG}.json`), JSON.stringify(restPrint, null, 1));
  if (AFTER) {
    const work = p.nodes.filter((x) => x.tier === 'work'), not = p.nodes.filter((x) => x.tier !== 'work');
    check(`[${E}] 일하는 카드(rev·tests)에만 번쩍임 층과 움직임`, work.length >= 2 && work.every((x) => x.flash && x.anims.length > 0) && not.every((x) => !x.flash && x.anims.length === 0), { work: work.map((x) => `${x.name}:${x.anims.length}`), not: not.filter((x) => x.flash || x.anims.length).map((x) => x.name) });
    const all = work.flatMap((x) => x.anims);
    check(`[${E}] 움직이는 속성은 opacity·transform만(합성)`, all.length > 0 && all.every((a) => a.props.length && a.props.every((k) => k === 'opacity' || k === 'transform')), all.map((a) => `${a.name}:${a.props.join(',')}`));
    check(`[${E}] 번쩍임은 초당 3회 이하`, all.every((a) => a.perSec !== null && a.perSec <= 3), all.map((a) => `${a.name}:${a.peaks}/${a.dur}ms=${a.perSec}/s`));
    check(`[${E}] P101 빛줄기는 걷었다(한 카드에 움직임 하나)`, work.every((x) => !x.glint && x.anims.length === 1), work.map((x) => `${x.name}:${x.glint}/${x.anims.length}`));
    const errN = nodeBy(p, P('build')), turnN = nodeBy(p, P('lead'));
    check(`[${E}] 응답 필요(lead)·오류(build)는 움직이지 않는다`, turnN.tier === 'turn' && errN.tier === 'alert' && !turnN.anims.length && !errN.anims.length, { lead: [turnN.tier, turnN.anims.length], build: [errN.tier, errN.anims.length] });
    const was = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, `p102-rest-${E}-before.json`), 'utf8')); } catch { return null; } })();
    check(`[${E}] 미션 맵의 일하지 않는 카드·알약 모양은 고치기 전과 같다(계산된 CSS)`, was && JSON.stringify(was) === JSON.stringify(restPrint), was ? { before: was.length, after: restPrint.length, diff: restPrint.filter((x, i) => was[i] !== x).slice(0, 3) } : 'no before');
    // 카드 하나 확대 프레임(한 주기 여섯 장)
    const w0 = nodeBy(p, P('rev'));
    if (w0.w) for (let i = 0; i < 6; i++) { await pg.evaluate(FREEZE, i / 6); await sleep(120); await shot(pg, `${E}-${TAG}-11-flash-${i}`, { clip: { x: Math.max(0, w0.x - 16), y: Math.max(0, w0.y - 16), width: w0.w + 48, height: w0.h + 32 } }); }
    await pg.evaluate(THAW);
    // 움직임 줄이기: 멈추고, 움직이지 않는 강한 표시(굵은 상태 색 테두리)
    await pg.emulateMedia({ reducedMotion: 'reduce' }); await sleep(500);
    p = await pg.evaluate(PC_PROBE);
    const still = p.nodes.filter((x) => x.tier === 'work');
    check(`[${E}] 움직임 줄이기에서는 움직임이 없고 일하는 카드에 굵은 상태 색 테두리가 남는다`, still.length >= 2 && p.nodes.every((x) => x.anims.length === 0) && still.every((x) => x.flashStyle && x.flashStyle.borderW >= 2 && parseFloat(x.flashStyle.opacity) >= 0.9), still.map((x) => `${x.name}:${JSON.stringify(x.flashStyle)}`));
    await shot(pg, `${E}-${TAG}-12-reduced`);
    await pg.emulateMedia({ reducedMotion: 'no-preference' }); await sleep(300);
    // 나중에 일하게 된 카드도 같은 박자: 지도를 연 채 셸 p102-e를 일함으로 흉내 내고(창 안), 일하는 카드들의 주기 안 자리를 견준다
    await pg.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p102-e'); window.__p102e = s; window.__mt.api.emit('session.updated', { ...s, state: 'shell_running', shell: { ...(s.shell || {}), atPrompt: false, command: 'ping -n 50 127.0.0.1' } }); });
    await pg.waitForFunction(() => { const e = document.querySelector('[data-role=mission] [data-name="p102-e"]'); return e && e.dataset.tier === 'work' && e.querySelector('[data-role=mm-flash]'); }, null, { timeout: 10000 }).catch(() => {});
    await sleep(700);
    p = await pg.evaluate(PC_PROBE);
    const ph = p.nodes.filter((x) => x.tier === 'work').map((x) => ({ name: x.name, phase: x.anims[0] ? x.anims[0].phase : null, dur: x.anims[0] ? x.anims[0].dur : null }));
    const cdist = (a, b, d) => { const x = Math.abs(a - b) % d; return Math.min(x, d - x); };
    const spread = Math.max(0, ...ph.flatMap((a) => ph.map((b) => cdist(a.phase, b.phase, a.dur || 1400))));
    check(`[${E}] 나중에 일하게 된 카드(e)도 같은 박자(주기 안 자리 차이 60ms 안)`, ph.length >= 3 && ph.some((x) => x.name === P('e')) && ph.every((x) => x.phase !== null) && spread <= 60, { ph, spread });
    await pg.evaluate(() => { if (window.__p102e) window.__mt.api.emit('session.updated', window.__p102e); });
    await pg.waitForFunction(() => { const e = document.querySelector('[data-role=mission] [data-name="p102-e"]'); return e && e.dataset.tier !== 'work'; }, null, { timeout: 10000 }).catch(() => {});
    await sleep(1200);
    // 거르기(작업 중): 흐리게만, 자리 그대로
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
  // 판 B: 실제 판 모양(맞추기 = 한 화면). 정점·바닥 프레임과 멀리서 본 그림
  await pg.evaluate(HOOK, ['real', 0]);
  await openMission(pg);
  await pg.mouse.move(vw - 120, 82); await sleep(300);
  p = await pg.evaluate(PC_PROBE);
  await shot(pg, `${E}-${TAG}-05-real`);
  const fr = await frames(pg, E, `${TAG}-05-real`, p, AFTER ? { peak: 0.14, low: 0.99, vw } : { peak: 0.45, low: 0.98, vw });
  const table = { peak: { ...fr.peak, thumb: undefined }, low: { ...fr.low, thumb: undefined } };
  fs.writeFileSync(path.join(OUT, `p102-far-${E}-${TAG}.json`), JSON.stringify(table, null, 1));
  log(`[${E}] 실제 판 모양 멀리서 본 값 ${JSON.stringify(table)}`);
  if (AFTER) {
    const work = p.nodes.filter((x) => x.tier === 'work');
    check(`[${E}] 실제 판 모양(18개, 워크스페이스 12개): 한 화면, 일하는 다섯 카드만 움직인다`, p.nodes.length === 18 && p.body.sh <= p.body.h + 2 && work.length === 5 && work.every((x) => x.anims.length === 1) && p.nodes.filter((x) => x.tier !== 'work').every((x) => !x.anims.length), { n: p.nodes.length, body: p.body, work: work.map((x) => x.name) });
    farChecks(E, fr, table);
  }
  // 큰 판
  await pg.evaluate(UNHOOK);
  await pg.evaluate(HOOK, ['big', 25]);
  await openMission(pg);
  await pg.mouse.move(vw - 120, 82); await sleep(300);
  p = await pg.evaluate(PC_PROBE);
  await shot(pg, `${E}-${TAG}-06-big`);
  if (AFTER) {
    const work = p.nodes.filter((x) => x.tier === 'work');
    const phs = work.map((x) => (x.anims[0] ? x.anims[0].phase : null));
    const spread = phs.every((v) => v !== null) ? Math.max(0, ...phs.flatMap((a) => phs.map((b) => { const d = Math.abs(a - b) % 1400; return Math.min(d, 1400 - d); }))) : null;
    check(`[${E}] 큰 판: 일하는 카드만 움직인다(모두 같은 박자, 자리 차이 60ms 안)`, work.length >= 5 && work.every((x) => x.anims.length === 1) && p.nodes.filter((x) => x.tier !== 'work').every((x) => !x.anims.length) && spread !== null && spread <= 60, { work: work.length, n: p.nodes.length, spread });
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
    await desk(page, E, w);
  } finally { await closeApp(app); }
}
// 고른 안(B)의 굵기·바탕 다듬기: 지은 그대로(V0), 테두리 3px(V1), 바탕 24%(V2)를 같은 장면에서 견준다
async function tunepc() {
  const { app, page: pg } = await launch({ log, env: { ...ENV } });
  try {
    await pg.setViewportSize({ width: 1920, height: 1080 }).catch(() => {});
    await sleep(2500);
    if (await pg.$('[data-action="return-close"]')) { await pg.click('[data-action="return-close"]').catch(() => {}); await sleep(300); }
    await pg.evaluate(HOOK, ['real', 0]);
    await openMission(pg);
    await pg.mouse.move(1800, 82); await sleep(300);
    const p = await pg.evaluate(PC_PROBE);
    const V = { V0: '', V1: '.mt-mm-flash { inset: -2px; border-width: 3px; border-radius: 10px; }', V2: '@media (prefers-reduced-motion: no-preference) { .mt-mm-flash { background-color: color-mix(in srgb, var(--mm-run) 24%, transparent); } }' };
    const res = {}, tiles = [];
    for (const [k, c] of Object.entries(V)) {
      const tag = c ? await pg.addStyleTag({ content: c }) : null; await sleep(400);
      const fr = await frames(pg, 'pc', `tune-${k}`, p, { peak: 0.14, low: 0.99, vw: 1920 });
      res[k] = { peak: { ...fr.peak, thumb: undefined }, low: { ...fr.low, thumb: undefined } };
      tiles.push({ label: `${k} peak`, b64: fr.peak.thumb }, { label: `${k} low`, b64: fr.low.thumb });
      const w0 = nodeBy(p, 'p102'); await pg.evaluate(FREEZE, 0.14); await sleep(150);
      await shot(pg, `pc-tune-${k}-card`, { clip: { x: w0.x - 16, y: w0.y - 16, width: w0.w + 48, height: w0.h + 32 } });
      await pg.evaluate(THAW);
      if (tag) await tag.evaluate((el) => el.remove());
    }
    save64('pc-tune-compare-far', await pg.evaluate(COMPOSE, [tiles, 2, 12]));
    fs.writeFileSync(path.join(OUT, 'p102-tune-pc.json'), JSON.stringify(res, null, 1));
    log(`[pc] 다듬기 ${JSON.stringify(res)}`);
    await pg.evaluate(UNHOOK);
  } finally { await closeApp(app); }
}
async function mockpc() {
  const { app, page } = await launch({ log, env: { ...ENV } });
  try {
    for (const [w, h, E] of [[1920, 1080, 'pc'], [2560, 1440, 'pc2560']]) {
      await page.setViewportSize({ width: w, height: h }).catch(() => {});
      await sleep(2500);
      if (await page.$('[data-action="return-close"]')) { await page.click('[data-action="return-close"]').catch(() => {}); await sleep(300); }
      await mockDesk(page, E, w);
    }
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
    await desk(pg, 'web', 1920);
    if (AFTER) await cost(pg);
    await ctx.close();
  } finally { await browser.close().catch(() => {}); await sim.close().catch(() => {}); }
}
// 번쩍임의 값: 미션 맵(실제 판 모양, 일하는 다섯)을 연 채 5초 동안 주 스레드의 일. 번쩍임만 켬/끔을 견준다
async function cost(pg) {
  await pg.evaluate(HOOK, ['real', 0]);
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
  log(`[web] 5초 동안 주 스레드 일: 번쩍임 켬 ${JSON.stringify(on)} / 번쩍임만 끔 ${JSON.stringify(off)}`);
  fs.writeFileSync(path.join(OUT, 'p102-cost-web.json'), JSON.stringify({ on, flashOff: off }, null, 1));
  check('[web] 번쩍임이 주 스레드에서 스타일 다시 셈·배치를 늘리지 않는다(합성만)', on.RecalcStyleCount - off.RecalcStyleCount < 10 && on.LayoutCount - off.LayoutCount < 5, { on, off });
  await pg.evaluate(UNHOOK);
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
// 휴대폰 세션 목록·새 세션 시트의 계산된 모양(고치기 전·뒤가 같은지 견준다)
const STYLE_PRINT = `((sel) => {
  const root = document.querySelector(sel);
  if (!root) return null;
  const keys = ['display', 'position', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'color', 'backgroundColor', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRadius', 'paddingTop', 'paddingLeft', 'height', 'boxShadow', 'animationName'];
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
const cpuSpan = async (ms = 10000) => { const a = webkitCpuMs(); await sleep(ms); return webkitCpuMs() - a; };
const WS_HOOK = () => {
  const Orig = window.WebSocket;
  window.__p102 = { sent: [] };
  class Hooked extends Orig { constructor(...a) { super(...a); const send = this.send.bind(this); this.send = (d) => { try { window.__p102.sent.push({ m: JSON.parse(d).method, t: Math.round(performance.now()) }); } catch {} return send(d); }; } }
  window.WebSocket = Hooked;
};
async function openPhoneMission(pg, hook) {
  if (hook) await pg.evaluate(HOOK, hook);
  if (await pg.$('[data-role=phone-mission]')) { await pg.tap('[data-action=phone-mission-back]'); await sleep(600); }
  await pg.evaluate(() => window.__mtPhone.mission());
  await pg.waitForFunction(() => document.querySelectorAll('[data-role=pm-node]').length >= 10, null, { timeout: 20000 }).catch(() => {});
  await sleep(1800);
}
// 휴대폰 목업 CSS(움직임의 가벼운 안 둘: 부드러운 opacity와 steps(2) 깜빡임)
const PHONE_LIGHT = {
  smooth: `.mt-pm-node.t-work { --p102m: var(--st-working); isolation: isolate; } .mt-pm-node.t-work.shell { --p102m: var(--st-shell_running); }
.mt-pm-node.t-work::after { content: ""; position: absolute; inset: -1px; border-radius: 9px; border: 2px solid var(--p102m); background: color-mix(in srgb, var(--p102m) 24%, transparent); pointer-events: none; z-index: -1; opacity: .12; animation: p102mB 1.4s cubic-bezier(.3, 0, .2, 1) infinite; }
@keyframes p102mB { 0% { opacity: .12; } 14% { opacity: 1; } 100% { opacity: .12; } }`,
  steps: `.mt-pm-node.t-work { --p102m: var(--st-working); isolation: isolate; } .mt-pm-node.t-work.shell { --p102m: var(--st-shell_running); }
.mt-pm-node.t-work::after { content: ""; position: absolute; inset: -1px; border-radius: 9px; border: 2px solid var(--p102m); background: color-mix(in srgb, var(--p102m) 24%, transparent); pointer-events: none; z-index: -1; opacity: 1; animation: p102mS 2s steps(1, end) infinite; }
@keyframes p102mS { 0% { opacity: 1; } 50% { opacity: .15; } 100% { opacity: .15; } }`,
};

async function mockphone() {
  const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
  const sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const browser = await webkit.launch({ headless: true });
  try {
    for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
    const ctx = await browser.newContext(PHONE);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[mockphone pageerror] ${e.message}`));
    await pair(pg, `http://localhost:${B0.sim}`);
    await sleep(2500);
    await openPhoneMission(pg, ['real', 0]);
    const p = await pg.evaluate(PH_PROBE);
    log(`[phone] 실제 판 모양 ${JSON.stringify(p.nodes.map((n) => `${n.name}:${n.tier}/${n.shape}`))}`);
    const res = {}, fars = [], tiles = [];
    res.now = await frames(pg, 'phone', 'mock-now', p, { peak: 0.1, low: 0.6, vw: W });
    const css = MOCK_CSS('.mt-pm-node', '.mt-pm-av');
    for (const k of ['A', 'B', 'C']) {
      const tag = await pg.addStyleTag({ content: css[k] }); await sleep(600);
      const fr = k === 'A' ? { peak: 0.5, low: 0.0 } : k === 'B' ? { peak: 0.14, low: 0.92 } : { peak: 0.3, low: 0.95 };
      res[k] = await frames(pg, 'phone', `mock-${k}`, p, { ...fr, vw: W });
      await tag.evaluate((el) => el.remove()); await sleep(300);
    }
    for (const k of ['now', 'A', 'B', 'C']) { fars.push({ label: `${k} peak`, b64: res[k].peak.thumb }, { label: `${k} low`, b64: res[k].low.thumb }); tiles.push({ label: `${k} peak`, b64: fs.readFileSync(path.join(OUT, `phone-mock-${k}-peak.png`)).toString('base64') }); }
    save64('phone-mock-compare-far', await pg.evaluate(COMPOSE, [fars, 4, 12]));
    save64('phone-mock-compare-peak', await pg.evaluate(COMPOSE, [tiles, 4, 12]));
    const table = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { peak: { ...v.peak, thumb: undefined }, low: { ...v.low, thumb: undefined } }]));
    // 가벼운 방법의 WebKit CPU: 움직임 없음(지금) / 부드러운 opacity / steps(2) 깜빡임, 10초씩 두 번
    await pg.evaluate(() => window.__mtPm && window.__mtPm.fit()); await sleep(800);
    const cpu = { none: [], smooth: [], steps: [] };
    for (let r = 0; r < 2; r++) {
      cpu.none.push(await cpuSpan());
      for (const k of ['smooth', 'steps']) { const tag = await pg.addStyleTag({ content: PHONE_LIGHT[k] }); await sleep(800); cpu[k].push(await cpuSpan()); await tag.evaluate((el) => el.remove()); await sleep(500); }
    }
    log(`[phone] 10초 WebKit CPU(ms) ${JSON.stringify(cpu)}`);
    fs.writeFileSync(path.join(OUT, 'p102-mock-phone.json'), JSON.stringify({ table, cpu }, null, 1));
    log(`[phone] 목업 멀리서 본 값 ${JSON.stringify(table)}`);
    await pg.evaluate(UNHOOK);
    await ctx.close();
  } finally { await browser.close().catch(() => {}); await sim.close().catch(() => {}); }
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
    await ctx.addInitScript(WS_HOOK);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[${E} pageerror] ${e.message}`));
    const cdp = E === 'chromium' ? await ctx.newCDPSession(pg) : null;
    if (cdp) await cdp.send('Performance.enable').catch(() => {});
    const readMem = async (label) => { await sleep(1500); if (E === 'webkit') mem[label] = { webkitMB: webkitMB() }; else { const m = await cdp.send('Performance.getMetrics').catch(() => null); const v = m && m.metrics.find((x) => x.name === 'JSHeapUsedSize'); mem[label] = { heapMB: v ? Math.round(v.value / 1048576) : null }; } log(`[${E}] 메모리 ${label} ${JSON.stringify(mem[label])}`); };
    await pair(pg, `http://localhost:${B0.sim}`);
    await sleep(2500);
    await pg.evaluate(FAKE_ERR); await sleep(400);
    // 세션 목록과 새 세션 시트(맡은 화면 밖: 고치기 전·뒤가 같아야 한다)
    await pg.evaluate(() => { const s = document.querySelector('[data-role=phone-scroll]'); if (s) s.scrollTop = 0; });
    await shot(pg, `${E}-${TAG}-00-list`);
    const listPrint = await pg.evaluate(`${STYLE_PRINT}('[data-role=phone-list]')`);
    await pg.tap('[data-action=phone-new]'); await sleep(900);
    await shot(pg, `${E}-${TAG}-00-sheet`);
    const sheetPrint = await pg.evaluate(`${STYLE_PRINT}('[data-role=phone-spawn]')`);
    fs.writeFileSync(path.join(OUT, `p102-style-${E}-${TAG}.json`), JSON.stringify({ list: listPrint, sheet: sheetPrint }, null, 1));
    await pg.tap('[data-action=phone-spawn-close]'); await sleep(600);
    if (AFTER) {
      const was = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, `p102-style-${E}-before.json`), 'utf8')); } catch { return null; } })();
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      check(`[${E}] 휴대폰 세션 목록의 모양이 고치기 전과 같다(계산된 CSS)`, was && same(was.list, listPrint), was ? { before: (was.list || []).length, after: (listPrint || []).length, diff: (listPrint || []).filter((x, i) => !was.list || was.list[i] !== x).slice(0, 4) } : 'no before');
      check(`[${E}] 새 세션 시트의 모양이 고치기 전과 같다(계산된 CSS)`, was && same(was.sheet, sheetPrint), was ? { before: (was.sheet || []).length, after: (sheetPrint || []).length, diff: (sheetPrint || []).filter((x, i) => !was.sheet || was.sheet[i] !== x).slice(0, 4) } : 'no before');
    }
    await readMem('list');
    const t0 = await pg.evaluate(() => Math.round(performance.now()));
    await pg.tap('[data-action=phone-mission]');
    await pg.waitForFunction(() => document.querySelectorAll('[data-role=pm-node]').length >= 10, null, { timeout: 20000 }).catch(() => {});
    await sleep(2500);
    let p = await pg.evaluate(PH_PROBE);
    log(`[${E}] 그래프 ${JSON.stringify(p.nodes.map((x) => `${x.name}:${x.tier}/${x.shape}${x.flash ? '/flash' : ''}:${x.anims.map((a) => `${a.name}@${a.dur}`).join('+')}`))}`);
    await shot(pg, `${E}-${TAG}-01-portrait`);
    if (AFTER) {
      const work = p.nodes.filter((x) => x.tier === 'work'), not = p.nodes.filter((x) => x.tier !== 'work');
      const all = work.flatMap((x) => x.anims);
      check(`[${E}] 일하는 카드(rev·tests)에만 번쩍임 층과 움직임`, work.length >= 2 && work.every((x) => x.flash && x.anims.length === 1) && not.every((x) => !x.flash && !x.anims.length), work.map((x) => `${x.name}:${x.anims.length}`));
      check(`[${E}] 휴대폰 움직임은 opacity 한 겹, steps로 낮은 박자, 초당 번쩍임 3회 이하`, all.length > 0 && all.every((a) => a.props.length === 1 && a.props[0] === 'opacity' && a.perSec !== null && a.perSec <= 3 && /steps/.test(`${a.easing} ${a.kEasing.join(' ')}`)), all);
      const sent = await pg.evaluate((a) => (window.__p102 ? window.__p102.sent : []).filter((x) => x.t >= a).map((x) => x.m), t0);
      check(`[${E}] 관계도 동안 session.messages·terminal.* 요청이 없다`, !sent.some((x) => /^session\.messages$|^terminal\./.test(x)), [...new Set(sent)]);
      // 나중에 일하게 된 카드(e)도 같은 박자
      await pg.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p102-e'); window.__p102e = s; window.__mt.api.emit('session.updated', { ...s, state: 'shell_running', shell: { ...(s.shell || {}), atPrompt: false, command: 'ping -n 50 127.0.0.1' } }); });
      await pg.waitForFunction(() => { const e = document.querySelector('[data-role=pm-node][data-name="p102-e"]'); return e && e.dataset.tier === 'work' && e.querySelector('[data-role=pm-flash]'); }, null, { timeout: 10000 }).catch(() => {});
      await sleep(700);
      const q0 = await pg.evaluate(PH_PROBE);
      const ph = q0.nodes.filter((x) => x.tier === 'work').map((x) => ({ name: x.name, phase: x.anims[0] ? x.anims[0].phase : null, dur: x.anims[0] ? x.anims[0].dur : null }));
      const cdist = (a, b, d) => { const x = Math.abs(a - b) % d; return Math.min(x, d - x); };
      const spread = Math.max(0, ...ph.flatMap((a) => ph.map((b) => cdist(a.phase, b.phase, a.dur || 1600))));
      check(`[${E}] 나중에 일하게 된 카드(e)도 같은 박자(주기 안 자리 차이 60ms 안)`, ph.length >= 3 && ph.some((x) => x.name === P('e')) && ph.every((x) => x.phase !== null) && spread <= 60, { ph, spread });
      await pg.evaluate(() => { if (window.__p102e) window.__mt.api.emit('session.updated', window.__p102e); });
      await pg.waitForFunction(() => { const e = document.querySelector('[data-role=pm-node][data-name="p102-e"]'); return e && e.dataset.tier !== 'work'; }, null, { timeout: 10000 }).catch(() => {});
      await sleep(1000);
      p = await pg.evaluate(PH_PROBE);
      for (let i = 0; i < 4; i++) { await pg.evaluate(FREEZE, i / 4); await sleep(150); const w0 = nodeBy(p, P('rev')); if (w0.w) await shot(pg, `${E}-${TAG}-11-flash-${i}`, { clip: { x: Math.max(0, w0.x - 10), y: Math.max(0, w0.y - 10), width: Math.min(W - Math.max(0, w0.x - 10), w0.w + 20), height: w0.h + 20 } }); }
      await pg.evaluate(THAW);
      await pg.emulateMedia({ reducedMotion: 'reduce' }); await sleep(500);
      const q = await pg.evaluate(PH_PROBE);
      const still = q.nodes.filter((x) => x.tier === 'work');
      check(`[${E}] 움직임 줄이기에서는 멈추고 굵은 상태 색 테두리가 남는다`, still.length >= 2 && q.nodes.every((x) => !x.anims.length) && still.every((x) => x.flashStyle && x.flashStyle.borderW >= 2 && parseFloat(x.flashStyle.opacity) >= 0.9), still.map((x) => `${x.name}:${JSON.stringify(x.flashStyle)}`));
      await shot(pg, `${E}-${TAG}-12-reduced`);
      await pg.emulateMedia({ reducedMotion: 'no-preference' }); await sleep(300);
    }
    await readMem('mission');
    // 실제 판 모양: 맞추기 배율 그림, 멀리서 본 값, WebKit CPU(움직임 켬 / 움직임 줄이기, 10초씩 두 번)
    await openPhoneMission(pg, ['real', 0]);
    await pg.evaluate(() => window.__mtPm && window.__mtPm.fit()); await sleep(600);
    p = await pg.evaluate(PH_PROBE);
    await shot(pg, `${E}-${TAG}-03-real`);
    const fr = await frames(pg, E, `${TAG}-03-real`, p, { peak: 0.1, low: 0.6, vw: W });
    const far = { peak: { ...fr.peak, thumb: undefined }, low: { ...fr.low, thumb: undefined } };
    fs.writeFileSync(path.join(OUT, `p102-far-${E}-${TAG}.json`), JSON.stringify(far, null, 1));
    log(`[${E}] 실제 판 모양 멀리서 본 값 ${JSON.stringify(far)}`);
    if (AFTER) {
      const work = p.nodes.filter((x) => x.tier === 'work');
      check(`[${E}] 실제 판 모양: 일하는 다섯 카드만 움직인다, 겹침·가로 스크롤 없음`, work.length === 5 && work.every((x) => x.anims.length === 1) && p.nodes.filter((x) => x.tier !== 'work').every((x) => !x.anims.length) && p.page.sw <= p.page.iw, { work: work.map((x) => x.name), page: p.page });
      farChecks(E, fr, far);
    }
    if (E === 'webkit') {
      const cpu = { on: [], reduce: [] };
      for (let r = 0; r < 2; r++) {
        await pg.emulateMedia({ reducedMotion: 'no-preference' }); await sleep(600); cpu.on.push(await cpuSpan());
        await pg.emulateMedia({ reducedMotion: 'reduce' }); await sleep(600); cpu.reduce.push(await cpuSpan());
      }
      await pg.emulateMedia({ reducedMotion: 'no-preference' });
      mem.cpu = { ...cpu, anims: await pg.evaluate(() => document.getAnimations().length) };
      log(`[${E}] 10초 CPU(ms) ${JSON.stringify(mem.cpu)}`);
    }
    await pg.setViewportSize({ width: H, height: W }); await sleep(1500);
    await shot(pg, `${E}-${TAG}-02-landscape`);
    await pg.setViewportSize({ width: W, height: H }); await sleep(1200);
    // 큰 판
    await pg.evaluate(UNHOOK);
    await openPhoneMission(pg, ['big', 25]);
    await pg.waitForFunction(() => document.querySelectorAll('[data-role=pm-node]').length >= 30, null, { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    p = await pg.evaluate(PH_PROBE);
    await shot(pg, `${E}-${TAG}-04-big`);
    if (AFTER) check(`[${E}] 큰 판(38개): 일하는 카드만 움직인다`, p.nodes.length === 38 && p.nodes.filter((x) => x.tier === 'work').every((x) => x.anims.length === 1) && p.nodes.filter((x) => x.tier !== 'work').every((x) => !x.anims.length), { n: p.nodes.length, work: p.nodes.filter((x) => x.tier === 'work').length });
    // 큰 판에서 손가락으로 옮기기(P89처럼 20번)
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
      const was = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, `p102-mem-${E}-before.json`), 'utf8')); } catch { return null; } })();
      const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const base = was && was.cpu ? avg(was.cpu.on) : avg(mem.cpu.reduce);
      check(`[${E}] WebKit CPU가 크게 늘지 않는다(움직임 켬 10초가 고치기 전의 1.5배 + 300ms 안)`, avg(mem.cpu.on) <= base * 1.5 + 300, { before: was && was.cpu, after: mem.cpu });
    }
    fs.writeFileSync(path.join(OUT, `p102-mem-${E}-${TAG}.json`), JSON.stringify(mem, null, 1));
    await pg.evaluate(UNHOOK);
    await ctx.close();
  } finally { await browser.close().catch(() => {}); await sim.close().catch(() => {}); }
}

// 메모리·CPU만 같은 순서로 잰다(고치기 전·뒤 빌드를 app/dist에 바꿔 끼우고 번갈아 돌린다). TAG는 끼운 빌드, 셋째 인자는 회차
// 순서: 목록 → 관계도(판 A) → 실제 판 모양(맞추기, 10초 CPU 두 번, 움직임 그대로) → 큰 판(옮기기 20번 흉내 없이 그리기만)
async function memwebkit() {
  const RUN = process.argv[4] || '1';
  const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
  const sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const browser = await webkit.launch({ headless: true });
  const mem = {};
  try {
    for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
    const ctx = await browser.newContext(PHONE);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[memwebkit pageerror] ${e.message}`));
    await pair(pg, `http://localhost:${B0.sim}`);
    await sleep(2500);
    const build = await pg.evaluate(() => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => /mt-pm-flash/.test(r.cssText)); } catch { return false; } }) ? 'after' : 'before');
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
    fs.writeFileSync(path.join(OUT, `p102-memseq-${TAG}-${RUN}.json`), JSON.stringify(out, null, 1));
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
      'compare-pc': [['pc-before-05-real', '1920 before (P101 glint)'], ['pc-after-05-real-peak', '1920 after: peak'], ['pc-after-05-real-low', '1920 after: low']],
      'compare-pc-far': [['pc-before-05-real-peak-far', '1920 before, 1/4'], ['pc-after-05-real-peak-far', 'after peak, 1/4'], ['pc-after-05-real-low-far', 'after low, 1/4']],
      'compare-pc2560': [['pc2560-before-05-real', '2560 before'], ['pc2560-after-05-real-peak', '2560 after: peak'], ['pc2560-after-05-real-low', '2560 after: low']],
      'compare-pc2560-far': [['pc2560-before-05-real-peak-far', '2560 before, 1/4'], ['pc2560-after-05-real-peak-far', 'after peak, 1/4'], ['pc2560-after-05-real-low-far', 'after low, 1/4']],
      'compare-web': [['web-before-05-real', 'web before'], ['web-after-05-real-peak', 'web after: peak'], ['web-after-05-real-low', 'web after: low']],
      'compare-board-a': [['pc-before-01-map', 'board A before'], ['pc-after-01-map', 'board A after'], ['pc-after-12-reduced', 'after, reduced motion']],
      'compare-phone': [['webkit-before-03-real', 'WebKit before'], ['webkit-after-03-real-peak', 'WebKit after: peak'], ['webkit-after-03-real-low', 'WebKit after: low'], ['chromium-after-03-real-peak', 'Chromium after: peak']],
      'compare-phone-far': [['webkit-before-03-real-peak-far', 'WebKit before, 1/4'], ['webkit-after-03-real-peak-far', 'after peak, 1/4'], ['webkit-after-03-real-low-far', 'after low, 1/4']],
      'compare-phone-more': [['webkit-before-01-portrait', 'board A before'], ['webkit-after-01-portrait', 'board A after'], ['webkit-after-12-reduced', 'reduced motion'], ['webkit-after-04-big', 'big board after']],
      'compare-phone-list-sheet': [['webkit-before-00-list', 'list before'], ['webkit-after-00-list', 'list after'], ['webkit-before-00-sheet', 'sheet before'], ['webkit-after-00-sheet', 'sheet after']],
      'compare-flash-frames': [0, 1, 2, 3, 4, 5].map((i) => [`pc-after-11-flash-${i}`, `PC t=${Math.round(i * 1400 / 6)}ms`]),
      'compare-flash-frames-phone': [0, 1, 2, 3].map((i) => [`webkit-after-11-flash-${i}`, `phone t=${i * 400}ms`]),
    };
    for (const [name, list] of Object.entries(sets)) {
      const items = list.map(([f, label]) => ({ b64: b64(f), label })).filter((x) => x.b64);
      if (!items.length) { log(`묶기 건너뜀 ${name}`); continue; }
      save64(name, await pg.evaluate(COMPOSE, [items, name.includes('frames') ? 3 : list.length > 3 ? 4 : 3, 12]));
      log(`묶음 ${name} (${items.length})`);
    }
  } finally { await browser.close().catch(() => {}); }
}

async function stopBoard() {
  for (const s of sessions().filter((x) => /^p102-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
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
  else if (WHAT === 'mockpc') { await stir(); await mockpc(); }
  else if (WHAT === 'mockphone') { await stir(); await mockphone(); }
  else if (WHAT === 'tunepc') await tunepc();
  else if (WHAT === 'memwebkit') { await stir(); await memwebkit(); }
  else if (WHAT === 'compose') await compose();
  else if (WHAT === 'stop') await stopBoard();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, `p102-${WHAT}-${TAG}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
