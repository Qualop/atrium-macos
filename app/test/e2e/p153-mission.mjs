// P153 창 시험: 세션 맵(영토 지도) 다듬기(라운드마다 그림). P152 창 시험(p152-mission.mjs, 단계 단추·살펴보기 띠·미니맵을 보던 것)을 갈음한다: 아직 유효한 검사(휴대폰 끌기·핀치·탭, 숨은 설정 classic)는 여기로 옮겼다.
// 판: 따로 띄운 개발용 판(atrium-dev-p153, 47922, backend/.dev)만 쓴다. 창의 원격 디버깅 포트 9402, 휴대폰 흉내 프록시 47994. 한 번에 한 창·브라우저만(메모리).
//   셸 세션 하나(p153-a, 시험 폴더 C:\Workspace\mtask-p153-a)만 실제로 띄운다. 지도는 페이지 안에서 mission.graph 답과 판의 워크스페이스·폴더를 흉내로 바꾼다.
//   흉내 모양: 아래 SHAPE(지어낸 이름, 폴더 3·워크스페이스 11·세션 32·연결 36. 역할·주고받은 연결로만 이어진 무리, 닫힌 부모, 다른 워크스페이스의 부모, 큰 무리).
//   P153_SHAPE=<json 경로>를 주면 그 파일의 모양(같은 형식 { folders, workspaces, sessions, links })을 쓴다(git 밖 파일).
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p153-mission.mjs <setup|pc|phone|mock|p157|stop> [round]
// P157: 다른 워커의 판에서 돌릴 때 P153_BOARD=<이름>(atrium-dev-<이름>), P153_PORT, P153_DEBUG(창 원격 디버깅 포트), P153_DIR(시험 폴더), P153_OUT(experiments 아래 결과 폴더 이름)로 덮는다.
//   p157 단계: 솔로 칸·폴더 기둥(너비·두 줄·최소 높이)·미리 보기 하나·Alt 없이 줄 머리 강조 없음·더블클릭으로 판에 갈 때 날아가기 없음
// 결과는 워크트리의 experiments/p153/<round>/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const TAG = process.argv[3] || 'round-1';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const MAIN = /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) ? path.resolve(REPO, '..', '..', '..') : REPO;
const DEV = path.join(REPO, 'backend', '.dev');
const OUTN = process.env.P153_OUT || 'p153';
const OUT = path.join(REPO, 'experiments', OUTN, TAG);
const CONVOS = path.join(REPO, 'experiments', OUTN, 'convos');
const DIR = process.env.P153_DIR || 'C:\\Workspace\\mtask-p153-a';
const BOARD = `atrium-dev-${process.env.P153_BOARD || 'p153'}`, PORT = process.env.P153_PORT || '47922', DEBUG = process.env.P153_DEBUG || '9402';
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k];
process.env.MT_E2E_OUT = path.relative(path.join(REPO, 'experiments'), OUT);
const L = await import('./p59-lib.mjs');
const { NAME } = L;
const SIM = 47994;
const ENV = {
  ATRIUM_TERMINAL_SESSION: BOARD, ATRIUM_HERDR_SESSION: BOARD, ATRIUM_PORT: PORT,
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p153-none-',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: PORT,
  ATRIUM_WEB_HOSTS: `${NAME}:${SIM},localhost:${SIM}`,
};
const SHAPE_FILE = process.env.P153_SHAPE || '';
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const chromeExe = (() => { const d = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'); try { return fs.readdirSync(d).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse().map((x) => path.join(d, x, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
const chromiumOpts = () => ({ headless: true, ...(chromeExe ? { executablePath: chromeExe } : {}) });
const log = logger(`p153-${WHAT}-${TAG.replace(/[\/]/g, "-")}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const AWAKE = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];

// ---- 흉내 모양(지어낸 이름). 실제 판과 같은 짜임: 폴더 3, 워크스페이스 11(폴더 밖 4), 세션 32, 연결 36 ----
const ws = (key, kind = 'repo') => ({ key, kind, root: key.replace(/\/\.git$/, '') });
const ss = (name, workspace, o = {}) => ({ name, workspace, parent: null, parentClosed: false, kind: 'claude', asleep: true, term: null, model: 'claude-opus-5-5', effort: null, ...o });
const ln = (src, dst, o = {}) => ({ src, dst, role: null, spawned: false, observed: true, count: 5, ...o });
const SHAPE_FAKE = {
  folders: [
    { id: 'g1', name: 'Market', members: ['d:/work/market/web', 'd:/work/market/quant/.git'] },
    { id: 'g2', name: 'Hub', members: ['d:/hub/core/.git'] },
    { id: 'g3', name: 'Campus', members: ['c:/work/library/.git', 'd:/work/campus', 'c:/work/lab/robot/.git', 'd:/work/campus/pbl/.git'] },
  ],
  workspaces: [ws('c:/work/atrium/.git'), ws('d:/work/campus', 'folder'), ws('d:/work/market/web', 'folder'), ws('d:/hub/core/.git'), ws('d:/work/garden/.git'), ws('c:/work/library/.git'), ws('c:/work/notes/.git'),
    ws('c:/work/lab/robot/.git'), ws('d:/work/campus/pbl/.git'), ws('d:/work/campus/exam/.git'), ws('d:/work/market/quant/.git')],
  sessions: [
    ss('conductor', 'c:/work/atrium/.git', { asleep: false, term: 'working', effort: 'xhigh' }), ss('c1', 'd:/work/campus'), ss('m1', 'd:/work/market/web'),
    ss('hub-head', 'd:/hub/core/.git', { parentClosed: true, effort: 'xhigh' }), ss('g1', 'd:/work/garden/.git'), ss('lib-1', 'c:/work/library/.git', { effort: 'xhigh' }),
    ss('notes-2', 'c:/work/notes/.git', { model: 'claude-fable-5-1', effort: 'high' }), ss('atrium-old', 'c:/work/atrium/.git'), ss('robot-1', 'c:/work/lab/robot/.git', { effort: 'xhigh' }),
    ss('robot-worker-codex', 'c:/work/lab/robot/.git', { kind: 'codex', asleep: false, term: 'idle', model: 'gpt-6.1-sol' }), ss('scribe', 'c:/work/library/.git', { kind: 'codex', asleep: false, term: 'done', model: 'gpt-6-astra' }),
    ss('exam-init', 'd:/work/campus/exam/.git', { kind: 'codex', asleep: false, term: 'idle', model: 'gpt-6.1-sol' }), ss('reviewer', 'c:/work/notes/.git'),
    ss('deck-lead', 'd:/work/campus/pbl/.git'), ss('deck-writer', 'd:/work/campus/pbl/.git'), ss('deck-reader', 'd:/work/campus/pbl/.git', { kind: 'codex', asleep: false, term: 'idle', model: 'gpt-6-astra' }),
    ss('deck-reader-2', 'd:/work/campus/pbl/.git', { kind: 'codex', asleep: false, term: 'idle', model: 'gpt-6-astra' }), ss('exam-lead', 'd:/work/campus/exam/.git'),
    ...['ex-notes', 'ex-set-03', 'ex-set-04', 'ex-set-05', 'ex-qa-a', 'ex-qa-b', 'ex-qa-c'].map((n) => ss(n, 'd:/work/campus/exam/.git', { parent: 'exam-lead' })),
    ss('media', 'd:/work/garden/.git', { parent: 'g1' }), ss('trial', 'd:/work/garden/.git', { parent: 'g1' }),
    ss('researcher', 'd:/work/market/quant/.git', { parent: 'm1', asleep: false, term: 'done' }),
    ...['coin-feed', 'level-sets', 'signal-scan', 'band-model'].map((n) => ss(n, 'd:/work/market/quant/.git', { parent: 'researcher', asleep: false, term: 'working' })),
  ],
  links: [
    ln('robot-1', 'robot-worker-codex', { role: 'worker-1-codex' }), ln('robot-worker-codex', 'robot-1'), ln('lib-1', 'scribe', { role: 'writer' }),
    ln('deck-writer', 'deck-reader', { role: 'reader1' }), ln('deck-writer', 'deck-reader-2', { role: 'reader' }), ln('deck-lead', 'deck-writer', { role: 'writer' }), ln('deck-lead', 'deck-reader'), ln('deck-lead', 'deck-reader-2'),
    ...['ex-notes', 'ex-set-03', 'ex-set-04', 'ex-set-05'].flatMap((n) => [ln('exam-lead', n, { role: 'worker', spawned: true }), ln(n, 'exam-lead')]),
    ...['a', 'b', 'c'].flatMap((x) => [ln('exam-lead', `ex-qa-${x}`, { role: `Q&A worker ${x.toUpperCase()}`, spawned: true }), ln(`ex-qa-${x}`, 'exam-lead')]),
    ln('g1', 'media', { role: 'worker', spawned: true }), ln('g1', 'trial', { role: 'worker', spawned: true, observed: false }), ln('m1', 'researcher', { role: 'researcher', spawned: true }), ln('researcher', 'm1'),
    ln('trial', 'g1'), ...['coin-feed', 'level-sets', 'signal-scan', 'band-model'].flatMap((n) => [ln('researcher', n, { role: 'worker', spawned: true }), ln(n, 'researcher')]), ln('media', 'g1'),
  ],
};
const SHAPE = SHAPE_FILE ? JSON.parse(fs.readFileSync(SHAPE_FILE, 'utf8')) : SHAPE_FAKE;
// 상태 섞기(차례로): 응답 필요 둘, 오류 하나, 작업 완료 하나 더(차례는 모양의 세션 차례 기준)
const MIX = { waiting: [15, 2], error: [11], done: [9] };

// ---- 페이지 안 흉내: mission.graph 답과 판의 워크스페이스·폴더(store)를 바꾼다. real: 실제 셸 세션 id(첫 세션 카드에 쓴다) ----
const HOOK = ([shape, mix, real, agent]) => {
  const api = window.__mt.api, st = window.__mt.getState();
  if (!api.__p153orig) { api.__p153orig = api.call.bind(api); window.__p153st = { workspaces: st.workspaces, groups: st.groups }; }
  const now = Date.now();
  const nameOf = (root) => root.split('/').filter(Boolean).pop();
  // 판의 실제 워크스페이스(실제 셸·haiku 세션이 든 곳)도 남긴다: 사이드바가 실제 세션 줄을 그린다(지도에는 그래프에 있는 키만 줄이 된다)
  st.workspaces = [...shape.workspaces.map((w, i) => ({ key: w.key, name: nameOf(w.root), kind: w.kind, root: w.root, createdAt: 1e12 + i, counts: {}, worktrees: [] })), ...(window.__p153st.workspaces || [])];
  st.groups = shape.folders.map((f) => ({ id: f.id, name: f.name, members: [...f.members] }));
  const asks = ['Allow npm ci in the worktree?', 'Which section should the summary cover?'];
  const nodes = shape.sessions.map((s, i) => {
    let state = s.asleep ? 'sleeping' : s.term === 'working' ? 'working' : 'ready', category = state === 'working' ? 'working' : 'idle', ask = null, error = null;
    if (!s.asleep && s.term === 'done') category = 'done';
    if (mix.waiting.includes(i)) { state = 'waiting'; category = 'needs_you'; ask = asks[mix.waiting.indexOf(i) % 2]; }
    if (mix.error.includes(i)) { state = 'error'; category = 'needs_you'; error = 'API Error: 529 overloaded. The server is busy, retry later.'; }
    if (mix.done.includes(i)) { state = 'ready'; category = 'done'; }
    if (s.st) { [state, category] = { needs: ['waiting', 'needs_you'], error: ['error', 'needs_you'], working: ['working', 'working'], done: ['ready', 'done'], ready: ['ready', 'idle'], sleeping: ['sleeping', 'idle'], exited: ['exited', 'exited'] }[s.st]; ask = s.st === 'needs' ? s.task : null; error = s.err || null; }
    const nm = i === 1 && agent ? agent.name : s.name;
    if (i === 1 && agent) { for (const l of shape.links) { if (l.src === s.name) l.src = nm; if (l.dst === s.name) l.dst = nm; } for (const x of shape.sessions) if (x.parent === s.name) x.parent = nm; }
    return { id: `s:${nm}`, kind: 'session', sessionId: i === 0 && real ? real : i === 1 && agent ? agent.id : `fk-${s.name}`, name: nm, agentKind: s.kind || 'claude', state, category, workspaceKey: s.workspace,
      // r11(P156 계약): indep = 정한 독립(일 부모 없음, 계보만), peers = 정한 동료
      parentId: s.parent && !s.indep ? `s:${s.parent}` : null, lineageParent: s.parent ? `s:${s.parent}` : null, peers: (shape.peers || []).filter((p) => p.includes(s.name)).map((p) => `s:${p[0] === s.name ? p[1] : p[0]}`), role: null, order: null, createdAt: 1e12 + i, loops: 0, model: s.model, effort: s.effort, activeAt: now - (i + 1) * 9e5, turnAt: state === 'working' ? now - (i + 1) * 2e5 : null,
      closedKids: s.closedKids || 0, assignAt: s.assignAt || null, parentClosed: !!s.parentClosed, // P157: 솔로 판정 기록(mission.graph와 같은 필드)
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
  // 선 없는 정한 동료 쌍은 relation 선(P156)
  for (const p of shape.peers || []) if (!shape.links.some((l) => (l.src === p[0] && l.dst === p[1]) || (l.src === p[1] && l.dst === p[0]))) edges.push({ from: `s:${p[0]}`, to: `s:${p[1]}`, kind: 'relation', relation: 'peer', relationSource: 'user', count: 0 });
  api.call = async (m, p) => {
    if (m !== 'mission.graph') return api.__p153orig(m, p);
    return { nodes: [{ id: 'human', kind: 'human', name: 'you' }, ...nodes], edges, counts: { all: nodes.length }, at: now };
  };
};
const UNHOOK = () => { const api = window.__mt.api; if (api.__p153orig) { api.call = api.__p153orig; const st = window.__mt.getState(); st.workspaces = window.__p153st.workspaces; st.groups = window.__p153st.groups; } };

// ---- 지도 읽기 ----
const PROBE = () => {
  const m = document.querySelector('[data-role=mission]');
  if (!m) return null;
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const vp = m.querySelector('[data-role=ta-viewport]');
  return {
    vp: R(vp), level: m.dataset.level, view: window.__mtTa && window.__mtTa.view(),
    cards: [...m.querySelectorAll('.mt-ta-card')].map((c) => ({ id: c.dataset.id, name: c.dataset.name, tier: c.dataset.tier, ...R(c) })),
    terrs: [...m.querySelectorAll('[data-role=ln-band]')].map((x) => ({ id: x.dataset.id, ...R(x) })), isles: [...m.querySelectorAll('[data-role=ta-isle]')].map((x) => ({ key: x.dataset.key, ...R(x) })),
    rings: [...m.querySelectorAll('[data-role=ta-ring]')].map((x) => ({ lead: x.dataset.lead, text: x.innerText, ...R(x) })),
  };
};
// 명령줄에 초점이 있으면 첫 Esc는 초점만 푼다(명령줄 동작). 닫힐 때까지 몇 번
async function closeMission(pg) { for (let i = 0; i < 3 && (await pg.$('[data-role="mission"]')); i++) { await pg.keyboard.press('Escape'); await sleep(400); } }
async function openMission(pg) {
  if (await pg.$('[data-action="return-close"]')) { await pg.click('[data-action="return-close"]').catch(() => {}); await sleep(300); }
  await closeMission(pg);
  await pg.click('[data-action="mission-rail"]');
  await pg.waitForSelector('[data-role="mission"] .mt-ta-card', { timeout: 20000 });
  await sleep(1200);
}
const shotTo = (pg, name, clip) => pg.screenshot({ path: path.join(OUT, `${name}.png`), ...(clip ? { clip } : {}) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
async function awayWin(app) { return app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; if (!w) return null; const ds = screen.getAllDisplays(); const left = Math.min(...ds.map((d) => d.bounds.x)); const b = w.getBounds(); w.setPosition(left - b.width - 200, 40); return w.getBounds(); }).catch((e) => ({ err: e.message })); }
const realAgentOf = (pg) => pg.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p153-haiku'); return s ? { id: s.sessionId, name: s.name } : null; });
const realId = (pg) => pg.evaluate(() => ([...window.__mt.getState().sessions.values()].find((s) => s.name === 'p153-a') || {}).sessionId || null);

async function setupBoard() {
  fs.mkdirSync(DIR, { recursive: true });
  log(atrium('backend', 'start').trim().slice(0, 300));
  const have = new Set(call('session.list').map((s) => s.name));
  if (!have.has('p153-a')) log(atrium('--json', 'spawn', DIR, '--kind', 'shell', '--name', 'p153-a').slice(0, 160));
  await sleep(2000);
}

async function pc() {
  call('settings.set', { key: 'missionStyle', value: 'territories' }); // 앞 시험이 classic에서 멈췄어도
  const { app, page } = await launch({ log, env: { ...ENV }, args: [`--remote-debugging-port=${DEBUG}`, ...AWAKE] });
  try {
    await awayWin(app);
    await page.setViewportSize({ width: 1584, height: 921 }).catch(() => {});
    await sleep(2500);
    // 사이드바는 닫고 시작한다(앞 시험이 연 상태가 남는다). 사이드바를 연 경우는 r9sidebar가 따로 본다
    if (await page.$('[data-role="sidebar"]')) { await page.click('[data-action="sidebar"]'); await sleep(500); }
    const real = await realId(page), agent = SHAPE_FILE ? null : await realAgentOf(page);
    await page.evaluate(HOOK, [JSON.parse(JSON.stringify(SHAPE)), MIX, real, agent]);
    for (const [w, h] of [[2576, 1408], [1584, 921], [1366, 768]]) {
      await page.setViewportSize({ width: w, height: h }).catch(() => {});
      await sleep(600);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await openMission(page);
      const p = await page.evaluate(PROBE);
      check(`[${w}] 카드 ${SHAPE.sessions.length}, 폴더 띠 ${SHAPE.folders.length}(+폴더 없음), 줄 ${SHAPE.workspaces.length}`, p.cards.length === SHAPE.sessions.length && p.terrs.length === SHAPE.folders.length + (SHAPE.workspaces.some((w) => !SHAPE.folders.some((g) => g.members.includes(w.key))) ? 1 : 0) && p.isles.length === SHAPE.workspaces.length, { cards: p.cards.length, terrs: p.terrs.length, isles: p.isles.length, view: p.view });
      await shotTo(page, `pc-${w}-fit`);
      // 처음 연 화면에서 읽히는가: 화면 위 이름·상태 글 크기, 카드가 위 줄·명령줄에 가리지 않는가
      const rd = await page.evaluate(() => { const v = window.__mtTa.view(); const top = (document.querySelector('[data-role=ln-cols]') || document.querySelector('[data-role=ta-top]')).getBoundingClientRect().bottom, bar = document.querySelector('[data-role=bottom] .mt-cmd').getBoundingClientRect().top; const cs = [...document.querySelectorAll('.mt-ta-card')]; const c = cs[0]; const fs2 = (sel) => parseFloat(getComputedStyle(c.querySelector(sel)).fontSize) * v.k; const vis = cs.map((x) => x.getBoundingClientRect()).filter((r) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth); return { k: v.k, name: fs2('.mt-ta-tile .tn'), status: fs2('.mt-ta-tile .ts'), covered: vis.filter((r) => r.top < top - 1 || r.left < (document.querySelector('[data-role=ln-rail]') || { getBoundingClientRect: () => ({ right: 0 }) }).getBoundingClientRect().right - 1).length, shown: vis.length, all: cs.length }; });
      check(`[${w}] 처음 화면: 이름 ≥ 12px, 상태 ≥ 10px, 위 줄·칸 머리·목차에 가린 카드 없음(아래는 끌어서 본다)`, rd.name >= 11.4 && rd.status >= 9.9 && rd.covered === 0, rd);
      // 처음 화면 타일 이름이 잘렸는가(말줄임), 타일 내용이 카드 밖으로 넘치는가
      const nm = await page.evaluate(() => [...document.querySelectorAll('.mt-ta-slot:not(.thin) > .mt-ta-card')].map((c) => { const tn = c.querySelector('.mt-ta-tile .tn'), tile = c.querySelector('.mt-ta-tile'); return { name: c.dataset.name, cut: tn.scrollWidth > tn.clientWidth + 1 || tn.scrollHeight > tn.clientHeight * 1.25, over: tile.scrollHeight > tile.clientHeight + 2 }; }));
      const cut = nm.filter((x) => x.cut).map((x) => x.name), over = nm.filter((x) => x.over).map((x) => x.name);
      log(`[${w}] 잘린 이름 ${cut.length}: ${cut.join(', ')}`);
      check(`[${w}] 처음 화면: 타일 내용이 카드 안, 잘린 이름은 아주 긴 것만(20자 이상)`, !over.length && cut.every((n) => n.length >= 20), { cut, over });
      // 보통 단계(85%)에서 카드 내용(일 세 줄·오류 두 줄까지)이 잘리지 않는가
      await page.evaluate(() => { const v = window.__mtTa.view(); window.__mtTa.set({ k: 0.85, x: v.x, y: v.y }); }); await sleep(500);
      const clip = await page.evaluate(() => [...document.querySelectorAll('.mt-ta-slot:not(.thin) > .mt-ta-card')].map((c) => { const f = c.querySelector('.mt-ta-full'); const sub = [...f.querySelectorAll('.c3, .cerr')].filter((x) => x.scrollHeight > x.clientHeight + 1).map((x) => x.className); return { name: c.dataset.name, box: f.scrollHeight > f.clientHeight + 1, sub }; }).filter((x) => x.box || x.sub.length));
      check(`[${w}] 보통: 카드 내용(일·오류 글)이 잘리지 않는다`, !clip.length, clip);
      await page.evaluate(() => window.__mtTa.fit()); await sleep(300);
      if (w === 1584) { await page.emulateMedia({ reducedMotion: 'reduce' }); await sleep(400); await shotTo(page, `pc-${w}-fit-reduce`); await page.emulateMedia({ reducedMotion: 'no-preference' }); }
      if (w === 1584) {
        // r8: 작업 완료 카드는 멀리(처음 화면)에서도 꼬리표와 그라데이션
        const dn = await page.evaluate(() => { const c = document.querySelector('.mt-ta-slot.st-done'); if (!c) return null; const r = c.getBoundingClientRect(), tag = c.querySelector('.mt-mm-donetag'); const tr = tag && tag.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, tag: !!tag && getComputedStyle(tag).display !== 'none' && tr.width > 20, bg: getComputedStyle(c.querySelector('.mt-ta-card')).backgroundImage }; });
        if (dn) { await shotTo(page, `pc-${w}-done-far`, { x: Math.max(0, dn.x - 30), y: Math.max(0, dn.y - 30), width: dn.w + 60, height: dn.h + 60 }); }
        check(`[${w}] 처음 화면(멀리): 작업 완료 꼬리표가 보이고 카드에 그라데이션`, !!dn && dn.tag && /gradient/.test(dn.bg), dn);
        // r8: 미리 보기 — 깨어 있는 카드(첫 카드 = 실제 셸)와 잠든 카드에 마우스를 올려 0.5초
        const hoverShot = async (sel, name) => {
          await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollIntoView({ block: 'nearest' }); }, sel);
          const box = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, vis: r.top > 150 && r.bottom < innerHeight - 120 }; }, sel);
          if (!box) return null;
          if (!box.vis) { await page.evaluate((s) => { const el = document.querySelector(s); window.__mtTa.flyTo(el.dataset.id, window.__mtTa.view().k); }, sel); await sleep(700); }
          const b2 = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
          await page.mouse.move(b2.x, b2.y); await sleep(1500);
          const info = await page.evaluate(() => { const p = document.querySelector('[data-role=ln-peek]'); return p ? { text: p.innerText.slice(0, 400), screen: !!p.querySelector('[data-role=ln-peek-screen]'), asleep: !!p.querySelector('[data-role=ln-peek-asleep]'), pe: getComputedStyle(p).pointerEvents } : null; });
          await shotTo(page, name);
          await page.mouse.move(5, 300); await sleep(300);
          return info;
        };
        const awake = await hoverShot(`.mt-ta-card[data-name="${SHAPE.sessions[0].name}"]`, `pc-${w}-peek-awake`);
        const asleep = await hoverShot('.mt-ta-card[data-tier="sleep"]', `pc-${w}-peek-asleep`);
        check('미리 보기: 깨어 있는 카드는 화면 끝줄, 잠든 카드는 저장된 정보만, 마우스를 받지 않는다', awake && awake.screen && awake.pe === 'none' && asleep && asleep.asleep && !asleep.screen, { awake, asleep });
        // 끌면 미리 보기가 비킨다
        await page.evaluate(() => window.__mtTa.fit()); await sleep(500);
      }
      // 보통 단계(85%): 첫 영토의 왼쪽 위부터, 그리고 무리마다 무리 가운데로
      const at = (box, k) => page.evaluate(([b, kk]) => { const vp = document.querySelector('[data-role=ta-viewport]').getBoundingClientRect(); window.__mtTa.set({ k: kk, x: vp.width / 2 - (b.x + b.w / 2) * kk, y: (vp.height + 96 - 110) / 2 - (b.y + b.h / 2) * kk }); }, [box, k]);
      const boxes = await page.evaluate(() => { const L = window.__mtTa.lay(); return { first: { x: 0, y: 0, w: 10, h: 10 }, rings: L.rows.filter((r) => r.count >= 3).map((r) => ({ lead: r.key, x: 0, y: r.y, w: L.W, h: r.h })) }; });
      const vpw = w, vph = h;
      await page.evaluate(() => window.__mtTa.set({ k: 0.85, x: window.__mtTa.rail + 16, y: window.__mtTa.top + 8 })); await sleep(800);
      await shotTo(page, `pc-${w}-mid`);
      for (const [i, r] of boxes.rings.slice(0, 6).entries()) { await page.evaluate(([y]) => window.__mtTa.set({ k: 0.85, x: window.__mtTa.rail + 16, y: window.__mtTa.top + 8 - y * 0.85 }), [r.y]); await sleep(700); await shotTo(page, `pc-${w}-team-${i}`); }
    }
    if (!SHAPE_FILE) await act(page, real, agent);
    await page.evaluate(UNHOOK);
  } finally { await closeApp(app); }
}

// ---- 누르기 = 태그, 친 글자 = 명령줄, 더블클릭 = 판으로, 섬 머리 끌기 = 폴더 옮기기 ----
async function act(page, real, agent) {
  const cmd = () => page.evaluate(() => (document.querySelector('[data-role=command]') || {}).value || '');
  const fly = (n) => page.evaluate((x) => window.__mtTa.flyTo(`s:${x}`, 0.9), n).then(() => sleep(800));
  await openMission(page);
  await page.evaluate(() => { const el = document.querySelector('[data-role=command]'); if (el) { el.value = ''; } });
  check('세션 맵 동안 명령줄이 보인다', await page.evaluate(() => { const b = document.querySelector('[data-role=bottom]'); return !!b && !b.dataset.hidden && b.dataset.mission === '1' && getComputedStyle(b.querySelector('.mt-cmd')).opacity === '1'; }));
  await fly('deck-lead'); await page.click('.mt-ta-card[data-name="deck-lead"]'); await sleep(300);
  await fly('deck-writer'); await page.click('.mt-ta-card[data-name="deck-writer"]'); await sleep(300);
  let c = await cmd();
  check('카드 둘 누르기 → 명령줄에 @태그 둘, 세션 맵은 열린 채', /^@deck-lead @deck-writer\s*$/.test(c) && !!(await page.$('[data-role=mission]')), c);
  const tagged = await page.evaluate(() => [...document.querySelectorAll('.mt-ta-slot.tagged .mt-ta-card')].map((x) => x.dataset.name));
  check('태그된 카드는 표시', tagged.length === 2, tagged);
  await shotTo(page, 'pc-1584-tagged');
  await page.click('.mt-ta-card[data-name="deck-writer"]'); await sleep(300);
  c = await cmd();
  check('다시 누르면 태그가 빠진다', /^@deck-lead\s*$/.test(c), c);
  // 지도 빈 곳을 누르고(초점이 지도에) 글자를 치면 명령줄로
  const vp = await page.evaluate(() => { const r = document.querySelector('[data-role=ta-viewport]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.mouse.click(vp.x + 30, vp.y + vp.h / 2); await sleep(200);
  await page.keyboard.type('hello there'); await sleep(300);
  c = await cmd();
  const focus = await page.evaluate(() => document.activeElement && document.activeElement.dataset.role);
  check('지도에서 친 글자 → 명령줄', /^@deck-lead hello there$/.test(c) && focus === 'command', { c, focus });
  await shotTo(page, 'pc-1584-typed');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Escape'); await sleep(300);
  await page.evaluate(() => { const el = document.querySelector('[data-role=command]'); if (el) { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); } });
  // 더블클릭 → 세션 맵을 닫고 판의 그 세션(실제 셸 = 첫 세션 카드)
  await openMission(page);
  const first = SHAPE.sessions[0].name;
  await fly(first);
  await page.dblclick(`.mt-ta-card[data-name="${first}"]`); await sleep(1200);
  check('더블클릭 → 세션 맵 닫고 판으로', !(await page.$('[data-role=mission]')), { real });
  // 판 ↔ 세션 맵 전환 때 명령줄(r6 E): 태그만 → 지움, 태그 + 글 → 유지, 글만 → 유지(더블클릭이 새 태그를 남기지 않음)
  const setCmd = (v) => page.evaluate((x) => { const el = document.querySelector('[data-role=command]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }, v);
  const second = SHAPE.sessions.find((x, i) => i > 1 && x.kind === 'claude' && !x.parent).name; // 0은 실제 셸, 1은 실제 haiku 세션으로 바뀐다
  await openMission(page); await setCmd(''); await fly(second);
  await page.click(`.mt-ta-card[data-name="${second}"]`); await sleep(300);
  const tagOnly = await cmd();
  await closeMission(page); await sleep(300);
  const afterTagOnly = await cmd();
  await setCmd(`@${second} keep this`); await openMission(page); await closeMission(page); await sleep(300);
  const afterBoth = await cmd();
  await setCmd('just text'); await openMission(page); await fly(second);
  await page.dblclick(`.mt-ta-card[data-name="${second}"]`); await sleep(1200);
  const afterDbl = await cmd();
  check('전환 때 명령줄: 태그만 → 지움, 태그+글 → 유지, 글만 + 더블클릭 → 글만(새 태그 없음)', tagOnly.trim() === `@${second}` && afterTagOnly === '' && afterBoth === `@${second} keep this` && afterDbl === 'just text', { tagOnly, afterTagOnly, afterBoth, afterDbl });
  await setCmd('');
  // 섬 머리 끌기: 첫 워크스페이스(폴더 밖) 섬을 Hub 영토 위에 놓으면 group.move가 불린다(흉내 키라 판은 not_found로 답할 수 있다: 부른 것만 본다)
  await openMission(page);
  await page.evaluate(() => { const api = window.__mt.api; window.__p153moves = []; const orig = api.call; api.call = (m, p) => { if (m === 'group.move') { window.__p153moves.push(p); return Promise.resolve({ groups: [] }); } return orig(m, p); }; window.__p153unmove = () => { api.call = orig; }; });
  await page.evaluate(() => window.__mtTa.fit());
  await sleep(500);
  const geo = await page.evaluate(() => { const L = window.__mtTa.lay(); const i = L.rows.find((x) => !x.band); const hub = L.bands.find((t) => t.name === 'Hub'); const h = document.querySelector(`.mt-sm-head[data-key="${CSS.escape(i.key)}"]`).getBoundingClientRect(); const t = document.querySelector(`.mt-sm-band[data-id="${hub.id}"]`).getBoundingClientRect(); return { key: i.key, hub: hub.id, from: { x: h.left + 30, y: h.top + 10 }, to: { x: Math.max(t.left, 260) + 200, y: t.top + t.height * 0.5 } }; });
  await page.keyboard.down('Alt'); await page.mouse.move(geo.from.x, geo.from.y); await page.mouse.down(); // P155: 줄 머리 옮기기는 Alt+끌기
  for (let i = 1; i <= 15; i++) { await page.mouse.move(geo.from.x + (geo.to.x - geo.from.x) * i / 15, geo.from.y + (geo.to.y - geo.from.y) * i / 15); await sleep(16); }
  const hot = await page.evaluate(() => [...document.querySelectorAll('.mt-sm-band.drop')].map((x) => x.dataset.id));
  await shotTo(page, 'pc-1584-isle-drag');
  await page.mouse.up(); await page.keyboard.up('Alt'); await sleep(400);
  const moves = await page.evaluate(() => window.__p153moves);
  check('섬 머리를 끌어 영토에 놓으면 그 폴더로(group.move), 끄는 동안 영토 강조', hot.includes(geo.hub) && moves.length === 1 && moves[0].workspace === geo.key && moves[0].group === geo.hub, { hot, moves, geo });
  // Esc로 취소
  await page.keyboard.down('Alt'); await page.mouse.move(geo.from.x, geo.from.y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(geo.from.x + 20 * i, geo.from.y + 10 * i); await sleep(16); }
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.keyboard.up('Alt'); await sleep(300);
  check('끄는 중 Esc = 취소(옮기지 않고 세션 맵은 열린 채)', (await page.evaluate(() => window.__p153moves.length)) === 1 && !!(await page.$('[data-role=mission]')));
  await page.evaluate(() => window.__p153unmove());
  await page.keyboard.press('Escape'); await sleep(300);
  // 실제 세션(p153-haiku)으로 끝까지: 태그 → 친 글자 → Enter → 전달, 세션 맵은 열린 채, 받는 세션 칩은 정상
  if (agent) {
    await openMission(page);
    await page.evaluate(() => { const el = document.querySelector('[data-role=command]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); });
    await fly(agent.name); await page.click(`.mt-ta-card[data-name="${agent.name}"]`); await sleep(300);
    const chip = await page.evaluate(() => [...document.querySelectorAll('[data-role=cmd-to] .mt-cmd-to-chip')].map((x) => ({ to: x.dataset.to, state: x.dataset.state })));
    await page.mouse.click(vp.x + 30, vp.y + vp.h / 2); await sleep(200);
    await page.keyboard.type('Reply with the single word ok.'); await sleep(200);
    await shotTo(page, 'pc-1584-real-tagged');
    await page.keyboard.press('Enter'); await sleep(2500);
    const d = await page.evaluate((n) => [...window.__mt.getState().deliveries.values()].filter((x) => x.name === n).map((x) => x.status), agent.name);
    const open = !!(await page.$('[data-role=mission]'));
    const left = await cmd();
    await shotTo(page, 'pc-1584-real-sent');
    check('실제 세션: 태그 칩 정상 → 친 글 → Enter → 전달, 세션 맵은 열린 채, 입력칸 비움', chip.length === 1 && chip[0].state === 'ok' && d.length >= 1 && !d.includes('failed') && open && left === '', { chip, d, open, left });
    await page.keyboard.press('Escape'); await sleep(300);
  }
  // (P152 창 시험에서 옮긴 검사) 숨은 설정 missionStyle=classic → 옛 열 지도(M으로 열고 닫힘, 빈 곳 눌러도 열린 채), 되돌리면 세션 맵
  await closeMission(page);
  call('settings.set', { key: 'missionStyle', value: 'classic' }); await sleep(1200);
  await page.click('[data-action="mission-rail"]'); await sleep(1500);
  const classic = await page.evaluate(() => ({ terr: !!document.querySelector('.mt-ta'), classic: !!document.querySelector('.mt-mission-body') }));
  await page.mouse.click(300, 600); await sleep(300);
  const still = !!(await page.$('[data-role=mission]'));
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('m'); await sleep(400);
  const mClosed = !(await page.$('[data-role=mission]'));
  await closeMission(page);
  call('settings.set', { key: 'missionStyle', value: 'territories' }); await sleep(800);
  await openMission(page);
  const back = await page.evaluate(() => !!document.querySelector('.mt-ta'));
  await page.keyboard.press('Escape'); await sleep(300);
  check('숨은 설정 classic → 옛 지도(빈 곳 눌러도 열린 채, M 닫힘), 되돌리면 세션 맵', !classic.terr && classic.classic && still && mClosed && back, { classic, still, mClosed, back });
  await r9sidebar(page, agent);
}

// ---- 라운드 9: 앱 사이드바를 같이 쓴다(세션 맵 목차 레일 없음). 세션 줄 = 판: 노드로 확대 / 세션 맵: 지금 배율로 가운데 + 반짝임,
//      워크스페이스·폴더 줄 = 판: 영역 맞춤 / 세션 맵: 줄·띠 맞춤 + 반짝임, 접기는 화살표로만 ----
async function r9sidebar(page, agent) {
  const sideOpen = await page.evaluate(() => !!document.querySelector('[data-role="sidebar"]'));
  if (!sideOpen) { await page.click('[data-action="sidebar"]'); await sleep(600); }
  await openMission(page);
  await page.evaluate(() => window.__mt.getState().sessions.size && window.__mtTa.fit()); await sleep(400);
  const lay0 = await page.evaluate(() => { const vp = document.querySelector('[data-role=ta-viewport]').getBoundingClientRect(), sb = document.querySelector('[data-role="sidebar"]'); return { rail: !!document.querySelector('[data-role=ln-rail]'), vpLeft: vp.left, sbRight: sb ? sb.getBoundingClientRect().right : null }; });
  check('세션 맵: 자체 목차 레일 없음, 앱 사이드바가 보이고 세션 맵은 그 오른쪽', !lay0.rail && lay0.sbRight != null && lay0.vpLeft >= lay0.sbRight - 1, lay0);
  // 세션 줄(실제 haiku 세션: 흉내 지도의 둘째 카드) → 지금 배율 그대로 가운데 + 반짝임
  if (agent) {
    const k0 = (await page.evaluate(() => window.__mtTa.view())).k;
    // 사이드바 목록은 가상 스크롤이라 보이는 줄만 그린다: 그 세션의 워크스페이스를 펴고 줄이 그려질 때까지 목록을 내린다
    await page.evaluate((n) => { const st = window.__mt.getState(); const s = [...st.sessions.values()].find((x) => x.name === n); try { const k = 'mt.sidebar'; const v = JSON.parse(localStorage.getItem(k) || '{}'); if (v.collapsed && s) { delete v.collapsed[s.workspaceKey]; localStorage.setItem(k, JSON.stringify(v)); } } catch {} }, agent.name);
    for (let i = 0; i < 40 && !(await page.$(`[data-sb="session"][data-name="${agent.name}"]`)); i++) {
      const folded = await page.$(`[data-sb="ws"].folded[data-ws="c:/workspace/mtask-p153-a"] [data-action="fold"]`);
      if (folded) await folded.click();
      await page.evaluate(() => { const l = document.querySelector('[data-role="sidebar-list"]'); if (l) l.scrollTop += 240; }); await sleep(120);
    }
    await page.evaluate((n) => { const el = document.querySelector(`[data-sb="session"][data-name="${n}"]`); if (el) el.scrollIntoView({ block: 'center' }); }, agent.name); await sleep(200);
    await page.waitForSelector(`[data-sb="session"][data-name="${agent.name}"]`, { timeout: 20000 });
    await page.click(`[data-sb="session"][data-name="${agent.name}"]`); await sleep(700);
    const r = await page.evaluate((n) => { const el = document.querySelector(`.mt-ta-card[data-name="${n}"]`), slot = el.closest('.mt-ta-slot'); const b = el.getBoundingClientRect(), vp = document.querySelector('[data-role=ta-viewport]').getBoundingClientRect(); return { k: window.__mtTa.view().k, dx: Math.round(b.left + b.width / 2 - (vp.left + vp.width / 2)), blink: slot.classList.contains('blink'), anim: getComputedStyle(el).animationName, open: !!document.querySelector('[data-role=mission]') }; }, agent.name);
    await shotTo(page, 'pc-r9-map-session');
    check('사이드바 세션 줄(세션 맵) → 배율 그대로, 카드가 가운데, 반짝임(움직임 줄이기에서도), 세션 맵은 열린 채', Math.abs(r.k - k0) < 1e-6 && Math.abs(r.dx) < 30 && r.blink && r.anim === 'mt-sm-blink' && r.open, { ...r, k0 });
  }
  // 사이드바를 연 채로도: 카드 누르기 = 태그, 지도 빈 곳을 누르고 친 글자 = 명령줄(태그 뒤에)
  {
    const setCmd = (v) => page.evaluate((x) => { const el = document.querySelector('[data-role=command]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }, v);
    await setCmd('');
    const nm = 'deck-lead';
    await page.evaluate((n) => window.__mtTa.flyTo(`s:${n}`, 0.9), nm); await sleep(800);
    await page.click(`.mt-ta-card[data-name="${nm}"]`); await sleep(400);
    const vp = await page.evaluate(() => { const r = document.querySelector('[data-role=ta-viewport]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await page.mouse.click(vp.x + 30, vp.y + vp.h / 2); await sleep(300);
    await page.keyboard.type('side open'); await sleep(300);
    const c = await page.evaluate(() => document.querySelector('[data-role=command]').value);
    check('사이드바를 연 채로: 카드 태그 + 지도에서 친 글자 → 명령줄', c === `@${nm} side open`, c);
    await setCmd('');
  }
  // 워크스페이스 줄·폴더 줄(흉내 지도의 키) → 맞춤 + 반짝임. 접기는 화살표로만
  const wsKey = 'd:/work/campus/pbl/.git';
  const hasWs = await page.$(`[data-sb="ws"][data-ws="${wsKey}"]`);
  if (hasWs) {
    await page.click(`[data-sb="ws"][data-ws="${wsKey}"] .mt-sb2-wname`); await sleep(700);
    const w = await page.evaluate((k) => { const row = document.querySelector(`.mt-sm-row[data-key="${CSS.escape(k)}"]`), r = row.getBoundingClientRect(), vp = document.querySelector('[data-role=ta-viewport]').getBoundingClientRect(); return { blink: row.classList.contains('blink'), inView: r.top >= vp.top + 80 && r.bottom <= vp.bottom - 100, k: window.__mtTa.view().k }; }, wsKey);
    await shotTo(page, 'pc-r9-map-ws');
    check('사이드바 워크스페이스 줄(세션 맵) → 그 줄에 맞춤 + 반짝임', w.blink && w.inView, w);
    const gRow = '[data-sb="group"][data-group="g2"]';
    // 가상 목록이라 폴더 줄이 그려질 때까지 위로 올린다(판의 실제 세션이 늘면 아래로 밀린다)
    for (let i = 0; i < 40 && !(await page.$(gRow)); i++) { await page.evaluate((top) => { const l = document.querySelector('[data-role="sidebar-list"]'); if (l) l.scrollTop = top ? 0 : l.scrollTop + 240; }, i === 0); await sleep(120); }
    const folded0 = await page.evaluate((s) => document.querySelector(s).classList.contains('folded'), gRow);
    await page.click(`${gRow} .mt-sb2-gname`); await sleep(700);
    const g = await page.evaluate((s) => ({ folded: document.querySelector(s).classList.contains('folded'), blink: !!document.querySelector('.mt-sm-band[data-id="g2"].blink') }), gRow);
    await shotTo(page, 'pc-r9-map-group');
    await page.click(`${gRow} .mt-sb2-fold.btn`); await sleep(300);
    const folded1 = await page.evaluate((s) => document.querySelector(s).classList.contains('folded'), gRow);
    await page.click(`${gRow} .mt-sb2-fold.btn`); await sleep(300);
    check('폴더 줄 이름 누르기 = 띠 맞춤 + 반짝임(접지 않음), 화살표 = 접기·펴기', g.blink && g.folded === folded0 && folded1 !== folded0, { folded0, g, folded1 });
  } else log('흉내 워크스페이스 줄이 사이드바에 없다(사이드바가 아직 흉내 목록으로 다시 그리지 않음)');
  await closeMission(page);
  await page.evaluate(UNHOOK); await sleep(1500);
  // 판: 워크스페이스 줄 → 그 영역(고른 워크스페이스), 세션 줄 → 그 노드로
  const realWs = await page.evaluate(() => (window.__mt.getState().workspaces[0] || {}).key);
  const before = await page.evaluate(() => JSON.stringify(window.__mt.getState().viewport || null));
  await page.click(`[data-sb="ws"][data-ws="${realWs}"]`); await sleep(800);
  const bw = await page.evaluate(() => ({ view: window.__mt.getState().viewWs, mission: !!document.querySelector('[data-role=mission]') }));
  if (agent) { await page.click(`[data-sb="session"][data-name="${agent.name}"]`); await sleep(1200); }
  const bs = await page.evaluate(() => ({ focus: window.__mt.getState().focusId }));
  await shotTo(page, 'pc-r9-board-session');
  check('판: 워크스페이스 줄 → 그 영역(고른 워크스페이스), 세션 줄 → 그 노드(초점)', bw.view === realWs && !bw.mission && (!agent || bs.focus === agent.id), { realWs, bw, bs, before: before.slice(0, 60) });
  const real = await realId(page);
  await page.evaluate(HOOK, [JSON.parse(JSON.stringify(SHAPE)), MIX, real, agent]);
  // 사이드바는 처음 상태로 돌려놓는다(창 상태가 다음 시험에 남는다)
  if (!sideOpen && (await page.$('[data-role="sidebar"]'))) { await page.click('[data-action="sidebar"]'); await sleep(400); }
}

// ---- 성능: 끌기·휠 프레임(P152 perf와 같은 재기). 지어낸 모양 32세션과 그 넷 겹(128세션), 작업 중 빛 켬·끔, 멀리(맞춤)·보통 ----
const FRAMES = () => new Promise((res) => { const out = []; let last = performance.now(); const t0 = last; const f = (t) => { out.push(t - last); last = t; if (t - t0 < 2400) requestAnimationFrame(f); else res(out); }; requestAnimationFrame(f); });
const stat = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10; return { n: a.length, p50: q(0.5), p95: q(0.95), max: Math.round(s[s.length - 1] * 10) / 10, over20: a.filter((x) => x > 20).length }; };
const bigShape = (sh, n) => { const out = { folders: [], workspaces: [], sessions: [], links: [] }; for (let i = 0; i < n; i++) { const k = (x) => (x ? `${x}#${i}` : x); out.folders.push(...sh.folders.map((f) => ({ id: `${f.id}-${i}`, name: `${f.name} ${i}`, members: f.members.map(k) }))); out.workspaces.push(...sh.workspaces.map((w) => ({ ...w, key: k(w.key) }))); out.sessions.push(...sh.sessions.map((x) => ({ ...x, name: `${x.name}-${i}`, workspace: k(x.workspace), parent: x.parent ? `${x.parent}-${i}` : null }))); out.links.push(...sh.links.map((l) => ({ ...l, src: `${l.src}-${i}`, dst: `${l.dst}-${i}` }))); } return out; };
async function perf() {
  const { app, page } = await launch({ log, env: { ...ENV }, args: [`--remote-debugging-port=${DEBUG}`, ...AWAKE] });
  const res = {};
  try {
    await awayWin(app);
    await page.setViewportSize({ width: 1584, height: 921 }).catch(() => {});
    await sleep(2500);
    for (const [tag, sh] of [['s32', SHAPE], ['s128', bigShape(SHAPE, 4)]]) {
      await page.evaluate(UNHOOK); await page.evaluate(HOOK, [JSON.parse(JSON.stringify(sh)), MIX, null, null]);
      for (const light of ['on', 'off']) {
        call('settings.set', { key: 'workLight', value: light }); await sleep(800);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openMission(page);
        const vb = await page.evaluate(() => { const r = document.querySelector('[data-role=ta-viewport]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
        for (const lvl of ['fit', 'mid']) {
          if (lvl === 'mid') await page.evaluate(() => { const v = window.__mtTa.view(), vp = document.querySelector('[data-role=ta-viewport]').getBoundingClientRect(), k = 0.85; const cx = (vp.width / 2 - v.x) / v.k, cy = (vp.height / 2 - v.y) / v.k; window.__mtTa.set({ k, x: vp.width / 2 - cx * k, y: vp.height / 2 - cy * k }); });
          await sleep(500);
          const fr = page.evaluate(FRAMES);
          await page.mouse.move(vb.x + 300, vb.y + 300); await page.mouse.down();
          for (let i = 0; i < 140; i++) { await page.mouse.move(vb.x + 300 + Math.sin(i / 10) * 250, vb.y + 300 + Math.cos(i / 12) * 150); await sleep(14); }
          await page.mouse.up();
          const drag = stat(await fr);
          const fw = page.evaluate(FRAMES);
          await page.mouse.move(vb.x + vb.w / 2, vb.y + vb.h / 2);
          for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, i % 20 < 10 ? -40 : 40); await sleep(35); }
          const wheel = stat(await fw);
          const key = `${tag}-${light}-${lvl}`;
          res[key] = { drag, wheel, lights: await page.evaluate(() => document.querySelectorAll('[data-role=ta-light]').length) };
          log(`[perf] ${key} ${JSON.stringify(res[key])}`);
        }
        await page.keyboard.press('Escape'); await sleep(400);
      }
    }
    call('settings.set', { key: 'workLight', value: 'on' });
    for (const [k, v] of Object.entries(res)) if (v && v.drag) check(`[perf] ${k}: 끌기 p95 ≤ 25ms, 휠 p95 ≤ 25ms`, v.drag.p95 <= 25 && v.wheel.p95 <= 25, v);
    await page.evaluate(UNHOOK);
  } finally { await closeApp(app); }
  fs.writeFileSync(path.join(OUT, 'p153-perf.json'), JSON.stringify(res, null, 2));
}

// ---- 휴대폰: P160부터 휴대폰 세션 맵 단계는 따로 옮겼다(P166부터 무한 캔버스 PhoneMap.jsx, app/test/e2e/p166-phone.mjs) ----

// ---- 시안 그림(실험 폴더의 Main.dc.html·A-phone.dc.html을 펴서 찍는다) ----
async function mock(withApp = false) {
  const { chromium } = await import('playwright');
  const dir = path.join(MAIN, 'experiments', 'mm-concepts', 'project');
  const render = (file, W, H, fit = false) => {
    const html = fs.readFileSync(path.join(dir, file), 'utf8');
    const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
    const tpl = html.split('</helmet>')[1].split('</x-dc>')[0];
    const src = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
    const C = new Function(`class DCLogic { constructor(p){ this.props = p || {}; } setState(o){ this.state = Object.assign({}, this.state, o); } }\n${src}\nreturn Component;`)();
    const c = new C({ light: 'on' });
    if (fit) { c.renderVals(); c.fit(); }
    const vals = c.renderVals();
    const get = (scope, k) => k.split('.').reduce((o, x) => (o == null ? o : o[x]), scope);
    const fill = (s, scope) => s.replace(/\{\{\s*([\w$.]+)\s*\}\}/g, (_, k) => { const v = get(scope, k); return typeof v === 'function' || v == null ? '' : String(v); });
    const expand = (s, scope) => {
      let out = '', i = 0;
      const re = /<sc-(for|if)\b([^>]*)>/g;
      for (;;) {
        re.lastIndex = i;
        const m = re.exec(s);
        if (!m) { out += fill(s.slice(i), scope); break; }
        out += fill(s.slice(i, m.index), scope);
        const tag = m[1];
        let depth = 1, j = m.index + m[0].length, end = -1;
        const open = new RegExp(`<sc-${tag}\\b`, 'g'), close = new RegExp(`</sc-${tag}>`, 'g');
        while (depth) { open.lastIndex = j; close.lastIndex = j; const o = open.exec(s), c2 = close.exec(s); if (!c2) break; if (o && o.index < c2.index) { depth++; j = o.index + 4; } else { depth--; j = c2.index + c2[0].length; if (!depth) end = c2.index; } }
        const body = s.slice(m.index + m[0].length, end);
        const attr = m[2];
        if (tag === 'for') { const list = get(scope, (attr.match(/list="\{\{\s*([\w$.]+)\s*\}\}"/) || [])[1]) || []; const as = (attr.match(/as="(\w+)"/) || [])[1]; for (const it of list) out += expand(body, { ...scope, [as]: it }); }
        else { const v = get(scope, (attr.match(/value="\{\{\s*([\w$.]+)\s*\}\}"/) || [])[1]); if (v) out += expand(body, scope); }
        i = j;
      }
      return out;
    };
    const body = expand(tpl, vals).replace(/\son[A-Z]\w*="[^"]*"/g, '');
    return `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body style="margin:0;width:${W}px;height:${H}px">${body}</body></html>`;
  };
  const browser = await chromium.launch(chromiumOpts());
  try {
    const shoot = async (file, W, H, out, fit = false) => { const pg = await browser.newPage({ viewport: { width: W, height: H } }); await pg.setContent(render(file, W, H, fit)); await sleep(800); await pg.screenshot({ path: path.join(OUT, out) }); await pg.close(); };
    await shoot('Main.dc.html', 1584, 921, 'mock-desktop.png');
    await shoot('A-phone.dc.html', 393, 852, 'mock-phone.png');
    for (const [W, H] of [[2576, 1408], [1584, 921], [1600, 1000]]) { await shoot('B.dc.html', W, H, `mockB-${W}-start.png`); await shoot('B.dc.html', W, H, `mockB-${W}-fit.png`, true); }
    await shoot('B-phone.dc.html', 390, 844, 'mockB-phone.png');
    await shoot('A-phone.dc.html', 390, 844, 'mockA-phone.png');
    if (withApp) {
      const side = async (a, b, out, lab, W = 1600, H = 1000) => {
        const pg = await browser.newPage({ viewport: { width: W * 2 + 30, height: H + 40 } });
        const uri = (x) => `data:image/png;base64,${fs.readFileSync(path.join(OUT, x)).toString('base64')}`;
        await pg.setContent(`<body style="margin:0;background:#222;color:#ddd;font:16px sans-serif;display:flex;gap:30px"><div><div>${lab[0]}</div><img src="${uri(a)}" width=${W}></div><div><div>${lab[1]}</div><img src="${uri(b)}" width=${W}></div></body>`);
        await sleep(600); await pg.screenshot({ path: path.join(OUT, out), fullPage: true }); await pg.close();
      };
      // 시안 B(B.dc.html)와 앱: 같은 데이터, 같은 창, 같은 배율(시안 처음 72% 시점)과 맞춤, 앱의 처음 화면
      for (const [W, H] of [[1600, 1000], [1584, 921], [2576, 1408]]) {
        await side(`mockB-${W}-start.png`, `app-${W}-start72.png`, `compareB-${W}-72.png`, [`mockup B (B.dc.html), ${W}x${H}, 72%`, 'app, same data, same window, 72%'], W, H);
        await side(`mockB-${W}-fit.png`, `app-${W}-fit.png`, `compareB-${W}-fit.png`, ['mockup B, Fit', 'app, same data, Fit'], W, H);
        await side(`mockB-${W}-fit.png`, `app-${W}-open.png`, `compareB-${W}-open.png`, ['mockup B, Fit', 'app, same data, on open'], W, H);
      }
      // 휴대폰: 시안 B-phone(디자인) | 시안 A-phone(보여 주는 방식) | 앱(실제 판 모양, 지어낸 모양)
      const ph = ['mockB-phone.png', 'mockA-phone.png', 'real/phone-iphone.png', 'fake/phone-iphone.png'].filter((x) => fs.existsSync(path.join(OUT, x)));
      if (ph.length >= 3) {
        const pg = await browser.newPage({ viewport: { width: ph.length * 420, height: 900 } });
        const uri = (x) => `data:image/png;base64,${fs.readFileSync(path.join(OUT, x)).toString('base64')}`;
        await pg.setContent(`<body style="margin:0;background:#222;color:#ddd;font:14px sans-serif;display:flex;gap:30px">${ph.map((x) => `<div><div>${x}</div><img src="${uri(x)}" width=390></div>`).join('')}</body>`);
        await sleep(600); await pg.screenshot({ path: path.join(OUT, 'comparePhone.png'), fullPage: true }); await pg.close();
      }
    }
  } finally { await browser.close(); }
}

// 시안 데이터(Main.dc.html mmData)를 앱 흉내 모양으로 바꿔 같은 창(지도 칸 1600×1000)·같은 배율로 찍는다
async function compareApp() {
  const dir = path.join(MAIN, 'experiments', 'mm-concepts', 'project');
  const html = fs.readFileSync(path.join(dir, 'Main.dc.html'), 'utf8');
  const src = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  const C = new Function(`class DCLogic { constructor(p){ this.props = p || {}; } setState(o){ this.state = Object.assign({}, this.state, o); } }\n${src}\nreturn Component;`)();
  const D = new C({ light: 'on' }).mmData();
  const key = (id) => `c:/mock/${id}/.git`;
  const H = { cc: 'claude', cx: 'codex', sh: 'shell', pi: 'pi', oc: 'opencode' };
  const MODEL = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', 'gpt-6': 'gpt-6' };
  const ago = (a) => { const m = String(a).match(/(\d+)([mhd])/); return m ? Number(m[1]) * { m: 6e4, h: 36e5, d: 864e5 }[m[2]] : null; };
  const shape = {
    folders: D.FOLDERS.map((n, i) => ({ id: `g${i + 1}`, name: n, members: D.WS.filter((w) => w.folder === n).map((w) => key(w.id)) })),
    workspaces: D.WS.map((w) => ({ key: key(w.id), kind: 'repo', root: `c:/mock/${w.id}` })),
    sessions: D.S.map((x) => { const [m, e] = String(x.model).split(' · '); const mk = Object.keys(MODEL).find((k) => m.startsWith(k)); return { name: x.id, workspace: key(x.ws), parent: x.parent || null, kind: H[x.h], st: x.st, task: x.task, err: x.err || null, ago: ago(x.ago), branch: x.branch || null, model: x.h === 'sh' ? null : mk ? MODEL[mk] : null, effort: e || null }; }),
    links: D.S.filter((x) => x.parent).map((x) => ({ src: x.parent, dst: x.id, role: x.rel === 'spawn' || x.rel === 'cross' ? (x.role === 'worker' ? null : x.role) : x.rel === 'role' ? x.role : null, spawned: x.rel === 'spawn' || x.rel === 'cross', observed: x.rel === 'prompt' })),
  };
  for (const x of shape.sessions) if (shape.links.some((l) => l.dst === x.name && !l.spawned)) x.parent = null; // 역할·시킴 하위는 부모(띄움)가 아니다
  const { app, page } = await launch({ log, env: { ...ENV }, args: [`--remote-debugging-port=${DEBUG}`, ...AWAKE] });
  try {
    await awayWin(app);
    await sleep(2500);
    await page.evaluate(HOOK, [shape, { waiting: [], error: [], done: [] }, null, null]);
    for (const [W, H] of [[1600, 1000], [1584, 921], [2576, 1408]]) {
      await page.setViewportSize({ width: W, height: H + 60 }).catch(() => {});
      await sleep(500);
      await openMission(page);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const clip = { x: 0, y: 60, width: W, height: H };
      await shotTo(page, `app-${W}-open`, clip);
      await page.evaluate(() => window.__mtTa.fit()); await sleep(500);
      await shotTo(page, `app-${W}-fit`, clip);
      // 시안 처음 시점: 배율 0.72, 세계 원점이 (236, 112)(시안 보기 칸 = 페이지 전체, 앱 보기 칸 = 앱 막대 아래라 같은 자리)
      await page.evaluate(() => window.__mtTa.set({ k: 0.72, x: 236, y: 112 })); await sleep(500);
      await shotTo(page, `app-${W}-start72`, clip);
    }
    await page.evaluate(UNHOOK);
  } finally { await closeApp(app); }
}

// ---- 라운드 11: 숫자 단계 칸, 깊이 접기(+n단계), 동료·독립, Alt+카드 끌기(관계 바꾸기), 줄 잡는 자리 ----
// 흉내 모양 + 깊이 6 사슬(plan-0 … plan-6) + 동료(lib-1·scribe 뿌리끼리, plan-2·plan-2b 같은 부모 아래) + 독립(trial, 계보 g1)
const SHAPE_DEEP = (() => {
  const s = JSON.parse(JSON.stringify(SHAPE_FAKE));
  const key = 'd:/work/deep/.git';
  s.workspaces.push(ws(key));
  s.folders.find((f) => f.id === 'g2').members.push(key);
  const chain = ['plan-0', 'plan-1', 'plan-2', 'plan-3', 'plan-4', 'plan-5', 'plan-6'];
  chain.forEach((n, i) => s.sessions.push(ss(n, key, { parent: i ? chain[i - 1] : null, ...(i === 3 ? { asleep: false, term: 'working' } : {}) })));
  s.sessions.push(ss('plan-2b', key, { kind: 'codex', model: 'gpt-6.1-sol' }));
  for (let i = 1; i < chain.length; i++) s.links.push(ln(chain[i - 1], chain[i], { role: 'worker', spawned: true }));
  s.peers = [['lib-1', 'scribe'], ['plan-2', 'plan-2b']];
  s.sessions.find((x) => x.name === 'trial').indep = true;
  return s;
})();

async function r11() {
  call('settings.set', { key: 'missionStyle', value: 'territories' });
  const { app, page } = await launch({ log, env: { ...ENV }, args: [`--remote-debugging-port=${DEBUG}`, ...AWAKE] });
  try {
    await awayWin(app);
    await page.setViewportSize({ width: 1584, height: 921 }).catch(() => {});
    await sleep(2500);
    if (await page.$('[data-role="sidebar"]')) { await page.click('[data-action="sidebar"]'); await sleep(500); }
    await page.evaluate(HOOK, [JSON.parse(JSON.stringify(SHAPE_DEEP)), MIX, null, null]);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // relation.set·group.move 가로채기: 부른 것을 적고, 답은 window.__r11mode(hold = 판이 아직 답하지 않음(놓은 자리가 바로 보임), fail·cycle = 실패, ok)
    await page.evaluate(() => {
      const api = window.__mt.api; const orig = api.call; window.__r11calls = []; window.__r11moves = []; window.__r11mode = 'hold';
      api.call = (m, p) => {
        if (m === 'relation.set') { window.__r11calls.push(p); const md = window.__r11mode; if (md === 'hold') return new Promise(() => {}); return md === 'ok' ? Promise.resolve({ ok: true }) : Promise.reject(Object.assign(new Error(md === 'fail' ? 'board said no' : 'loop'), { code: md === 'fail' ? 'internal' : 'cycle' })); }
        if (m === 'group.move') { window.__r11moves.push(p); return Promise.resolve({ groups: [] }); }
        return orig(m, p);
      };
      window.__r11un = () => { api.call = orig; };
    });
    const cmd = () => page.evaluate(() => (document.querySelector('[data-role=command]') || {}).value || '');
    const setCmd = (v) => page.evaluate((x) => { const el = document.querySelector('[data-role=command]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, x); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }, v);
    await openMission(page);
    await setCmd('');
    // 앞 실행이 편 가지가 남았으면 접는다(편 가지는 창에 기억된다)
    if (await page.$('[data-action="ln-fold"].open[data-id="s:plan-4"]')) { await page.click('[data-action="ln-fold"].open[data-id="s:plan-4"]'); await sleep(600); }
    await shotTo(page, 'r11-deep-open');
    const info = await page.evaluate(() => {
      const L = window.__mtTa.lay(), x = (n) => (L.cards.get(`s:${n}`) || {}).x;
      const col0 = L.cols.find((c) => c.key === 'lv' && c.level === 0).x;
      const peerE = [...document.querySelectorAll('.mt-ta-edge.k-peer')].map((e) => ({ from: e.dataset.from, to: e.dataset.to, ms: e.getAttribute('marker-start'), me: e.getAttribute('marker-end') }));
      const linE = [...document.querySelectorAll('.mt-ta-edge.k-lineage')].map((e) => ({ from: e.dataset.from, to: e.dataset.to, me: e.getAttribute('marker-end') }));
      const fold = document.querySelector('[data-action="ln-fold"][data-id="s:plan-4"]');
      const l1 = L.cards.get('s:lib-1'), sc = L.cards.get('s:scribe'), p2 = L.cards.get('s:plan-2'), p2b = L.cards.get('s:plan-2b');
      return {
        cols: [...document.querySelectorAll('[data-role=ln-cols] .colh')].map((c) => c.dataset.col), heads: [...document.querySelectorAll('[data-role=ln-cols] .colh')].map((c) => c.textContent),
        fold: fold && fold.textContent, has5: L.cards.has('s:plan-5'), peerE, linE,
        libPeer: l1 && sc && l1.x === sc.x && l1.x === col0 && Math.abs(Math.abs(l1.y - sc.y) - (l1.y < sc.y ? l1.h : sc.h)) < 60,
        planPeer: p2 && p2b && p2.x === p2b.x, trialRoot: x('trial') === col0,
      };
    });
    check('r11 칸 머리: 워크스페이스 · 시작 · 1단계 · … · 4단계 · 혼자', info.cols.join() === 'ws,lv0,lv1,lv2,lv3,lv4,solo' && ['시작', 'Root'].includes(info.heads[1]) && /1/.test(info.heads[2]) && ['혼자', 'Solo'].includes(info.heads[6]), info);
    check('r11 깊이 접기: 4단계 카드에 +2단계 칩, 그 아래는 그리지 않는다', /\+2/.test(info.fold || '') && !info.has5, info.fold);
    check('r11 동료: 같은 칸에 붙어 쌓이고 선은 양끝 점(화살촉 없음)', info.libPeer && info.planPeer && info.peerE.length === 2 && info.peerE.every((e) => /end-peer/.test(e.ms || '') && /end-peer/.test(e.me || '')), info.peerE);
    check('r11 독립: 시작 칸, 계보는 화살촉 없는 옅은 선', info.trialRoot && info.linE.some((e) => e.from === 's:g1' && e.to === 's:trial' && !e.me), info.linE);
    // 접기 칩 누르기 = 그 가지만 편다(태그 아님), 다시 열어도 기억, 다시 누르면 접힘
    await page.evaluate(() => window.__mtTa.flyTo('s:plan-4', 0.6)); await sleep(800);
    await page.click('[data-action="ln-fold"][data-id="s:plan-4"]'); await sleep(700);
    const ex = await page.evaluate(() => { const L = window.__mtTa.lay(); return { has6: L.cards.has('s:plan-6'), cols: L.cols.length, chip: (document.querySelector('[data-action="ln-fold"][data-id="s:plan-4"]') || {}).className || '' }; });
    const c1 = await cmd();
    await page.evaluate(() => window.__mtTa.flyTo('s:plan-5', 0.85)); await sleep(800);
    await shotTo(page, 'r11-deep-expanded-85');
    await openMission(page);
    const kept = await page.evaluate(() => window.__mtTa.lay().cards.has('s:plan-6'));
    await page.evaluate(() => window.__mtTa.flyTo('s:plan-4', 0.6)); await sleep(800);
    await page.click('[data-action="ln-fold"][data-id="s:plan-4"]'); await sleep(700);
    const back = await page.evaluate(() => window.__mtTa.lay().cards.has('s:plan-5'));
    check('r11 +n단계 누르기: 그 가지만 끝까지 펴고(태그 아님), 닫았다 열어도 기억, 다시 누르면 접힘', ex.has6 && /open/.test(ex.chip) && !/@plan-4/.test(c1) && kept && !back, { ex, c1, kept, back });

    // ---- Alt+카드 끌기 ----
    await page.evaluate(() => window.__mtTa.fit()); await sleep(600);
    // 세계 좌표 → 화면 좌표
    const scr = (id, fx, fy) => page.evaluate(([i, a, b]) => { const L = window.__mtTa.lay(), v = window.__mtTa.view(), vp = document.querySelector('[data-role=ta-viewport]').getBoundingClientRect(); const c = L.cards.get(i); return { x: vp.left + v.x + (c.x + c.w * a) * v.k, y: vp.top + v.y + (c.y + c.h * b) * v.k }; }, [id, fx, fy]);
    const w2s = (wx, wy) => page.evaluate(([a, b]) => { const v = window.__mtTa.view(), vp = document.querySelector('[data-role=ta-viewport]').getBoundingClientRect(); return { x: vp.left + v.x + a * v.k, y: vp.top + v.y + b * v.k }; }, [wx, wy]);
    const drop = () => page.evaluate(() => { const d = document.querySelector('[data-role=ln-drop]'); return d && !d.hidden ? { kind: d.dataset.kind, text: d.textContent, target: (document.querySelector('.mt-ta-slot.drop-target') || {}).dataset?.id || null } : null; });
    const drag = async (from, to, { alt = true, shot = null, esc = false, back = false } = {}) => {
      if (alt) await page.keyboard.down('Alt');
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      for (let i = 1; i <= 16; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / 16, from.y + (to.y - from.y) * i / 16); await sleep(16); }
      if (back) for (let i = 1; i <= 8; i++) { await page.mouse.move(to.x + (from.x - to.x) * i / 8, to.y + (from.y - to.y) * i / 8); await sleep(16); }
      const d = await drop();
      if (shot) await shotTo(page, shot);
      if (esc) await page.keyboard.press('Escape');
      await page.mouse.up(); if (alt) await page.keyboard.up('Alt'); await sleep(700);
      return d;
    };
    const parentOf = (id) => page.evaluate((i) => window.__mtTa.lay().tree.parent.get(i) || null, id);
    const calls = () => page.evaluate(() => window.__r11calls.slice());
    // 1) 하위로(다른 워크스페이스): media → exam-lead 오른쪽 칸. 판이 모르면(unknown_method) 이 맵에서만 남긴다
    const el = await page.evaluate(() => { const L = window.__mtTa.lay(), c = L.cards.get('s:exam-lead'); return { x: c.x + c.w + 110 + c.w * 0.3, y: c.y + c.h / 2 }; });
    const d1 = await drag(await scr('s:media', 0.5, 0.5), await w2s(el.x, el.y), { shot: 'r11-drag-sub' });
    const k1 = await calls();
    check('r11 Alt+카드 끌기 → 하위로: 미리 보기(하위로 + 대상 강조), relation.set {a: 위, b: 끈 세션, sub}, 답을 기다리는 동안 맵에 바로 보임', d1 && d1.kind === 'sub' && d1.target === 's:exam-lead' && /exam-lead/.test(d1.text) && k1.length === 1 && k1[0].a === 'fk-exam-lead' && k1[0].b === 'fk-media' && k1[0].relation === 'sub' && (await parentOf('s:media')) === 's:exam-lead', { d1, k1 });
    // 2) 동료로 + Esc 취소: conductor → ex-notes 바로 위
    const xn = await page.evaluate(() => { const c = window.__mtTa.lay().cards.get('s:ex-notes'); return { x: c.x + 40, y: c.y - 20 }; });
    const d2 = await drag(await scr('s:conductor', 0.5, 0.5), await w2s(xn.x, xn.y), { shot: 'r11-drag-peer', esc: true });
    const k2 = await calls();
    const after2 = await page.evaluate(() => ({ hidden: document.querySelector('[data-role=ln-drop]').hidden, moving: document.querySelectorAll('.mt-ta-slot.moving').length, tr: document.querySelector('.mt-ta-slot[data-id="s:conductor"]').style.transform, open: !!document.querySelector('[data-role=mission]') }));
    check('r11 위아래 = 동료로 미리 보기, 끄는 중 Esc = 취소(부르지 않음, 카드 제자리, 세션 맵 열린 채)', d2 && d2.kind === 'peer' && d2.target === 's:ex-notes' && k2.length === 1 && after2.hidden && !after2.moving && !after2.tr && after2.open, { d2, after2 });
    // 3) 독립: researcher → 자기 줄의 빈 시작 칸
    const nz = await page.evaluate(() => { const L = window.__mtTa.lay(), c = L.cards.get('s:researcher'), r = L.rows.find((x) => x.key === c.ws), c0 = L.cols.find((x) => x.key === 'lv' && x.level === 0).x; return { x: c0 + 60, y: r.y + r.h / 2 }; });
    const d3 = await drag(await scr('s:researcher', 0.5, 0.5), await w2s(nz.x, nz.y), { shot: 'r11-drag-none' });
    const k3 = await calls();
    const ind = await page.evaluate(() => { const L = window.__mtTa.lay(); return { x: L.cards.get('s:researcher').x, c0: L.cols.find((x) => x.key === 'lv' && x.level === 0).x, lin: !!document.querySelector('.mt-ta-edge.k-lineage[data-from="s:m1"][data-to="s:researcher"]') }; });
    check('r11 빈 시작 칸 = 독립: relation.set {a: 일 부모, b, none}, 시작 칸으로, 계보는 옅은 선', d3 && d3.kind === 'none' && k3.length === 2 && k3[1].a === 'fk-m1' && k3[1].b === 'fk-researcher' && k3[1].relation === 'none' && ind.x === ind.c0 && ind.lin, { d3, k3: k3[1], ind });
    // 4) 제자리로 돌아와 놓기 = 취소
    const d4 = await drag(await scr('s:ex-set-03', 0.5, 0.5), await scr('s:ex-set-03', 0.5, 2.5), { back: true });
    check('r11 제자리에 놓기 = 취소(부르지 않음)', (await calls()).length === 2, { d4 });
    // 5) 실패 → 되돌림 + 알림
    await page.evaluate(() => { window.__r11mode = 'fail'; });
    const dl = await page.evaluate(() => { const c = window.__mtTa.lay().cards.get('s:deck-lead'); return { x: c.x + c.w + 110 + c.w * 0.3, y: c.y + c.h / 2 }; });
    await drag(await scr('s:ex-qa-c', 0.5, 0.5), await w2s(dl.x, dl.y));
    await sleep(500);
    const f5 = await page.evaluate(() => ({ p: window.__mtTa.lay().tree.parent.get('s:ex-qa-c'), err: [...document.querySelectorAll('.mt-toast.error')].map((x) => x.textContent) }));
    check('r11 판이 실패로 답하면 되돌리고 알린다', (await calls()).length === 3 && f5.p === 's:exam-lead' && f5.err.some((x) => /board said no/.test(x)), f5);
    // 5b) 고리(cycle) = 분명한 알림, 되돌림
    await page.evaluate(() => { window.__r11mode = 'cycle'; });
    await drag(await scr('s:ex-qa-a', 0.5, 0.5), await w2s(dl.x, dl.y));
    await sleep(500);
    const f5b = await page.evaluate(() => ({ p: window.__mtTa.lay().tree.parent.get('s:ex-qa-a'), err: [...document.querySelectorAll('.mt-toast.error')].map((x) => x.textContent) }));
    check('r12 판이 cycle로 답하면 되돌리고 고리라고 알린다', (await calls()).length === 4 && f5b.p === 's:exam-lead' && f5b.err.some((x) => /loop|고리/.test(x) && /ex-qa-a/.test(x)), f5b);
    // 6) 판이 받으면(ok) 같은 인자로 부르고, 새 그래프를 다시 읽는다
    await page.evaluate(() => { window.__r11mode = 'ok'; window.__r11graphs = 0; const api = window.__mt.api, o = api.call; api.call = (m, p) => { if (m === 'mission.graph') window.__r11graphs++; return o(m, p); }; });
    const g1 = await page.evaluate(() => { const c = window.__mtTa.lay().cards.get('s:g1'); return { x: c.x + c.w + 110 + c.w * 0.3, y: c.y + c.h / 2 }; });
    await drag(await scr('s:ex-qa-b', 0.5, 0.5), await w2s(g1.x, g1.y));
    await sleep(900);
    const k6 = await calls(), g6 = await page.evaluate(() => window.__r11graphs);
    check('r11 판이 받으면 relation.set 그대로, 그래프를 다시 읽는다', k6.length === 5 && k6[4].a === 'fk-g1' && k6[4].b === 'fk-ex-qa-b' && k6[4].relation === 'sub' && g6 >= 1, { k6: k6[4], g6 });
    // 7) Alt 없이 카드 끌기 = 시점 이동(관계 그대로, 태그 없음)
    await setCmd('');
    const v0 = await page.evaluate(() => window.__mtTa.view());
    const s7 = await scr('s:exam-lead', 0.5, 0.5);
    await drag(s7, { x: s7.x + 140, y: s7.y + 60 }, { alt: false });
    const v1 = await page.evaluate(() => window.__mtTa.view());
    check('r11 Alt 없이 카드 끌기 = 시점 이동(부르지 않고 태그도 없음)', Math.abs(v1.x - v0.x - 140) < 4 && (await calls()).length === 5 && !(await cmd()).trim(), { v0, v1 });
    // 8) 줄 잡는 자리: 줄 머리 이름 아래 빈 곳(워크스페이스 칸)을 Alt+끌기 → 그 폴더로
    await page.evaluate(() => window.__mtTa.fit()); await sleep(600);
    const gb = await page.evaluate(() => {
      const L = window.__mtTa.lay(), r = L.rows.find((x) => !x.band && x.key), hub = L.bands.find((b) => b.name === 'Hub');
      const g = document.querySelector(`.mt-sm-grab[data-key="${CSS.escape(r.key)}"]`).getBoundingClientRect(), h = document.querySelector(`.mt-sm-head[data-key="${CSS.escape(r.key)}"]`).getBoundingClientRect(), t = document.querySelector(`.mt-sm-band[data-id="${hub.id}"]`).getBoundingClientRect();
      return { key: r.key, hub: hub.id, from: { x: h.right + Math.min(40, (g.right - h.right) / 2), y: Math.min(g.bottom - 6, h.bottom + 20) }, to: { x: Math.max(t.left, 260) + 200, y: t.top + t.height * 0.5 }, grabW: g.width, headW: h.width };
    });
    await drag(gb.from, gb.to, { shot: 'r11-row-grab' });
    const mv = await page.evaluate(() => window.__r11moves);
    check('r11 Alt+끌기: 줄 머리 둘레 빈 곳에서도 줄을 잡아 다른 폴더로(group.move)', mv.length === 1 && mv[0].workspace === gb.key && mv[0].group === gb.hub && gb.grabW > gb.headW, { mv, gb });
    // 그림: 맞춤, 85%
    await page.evaluate(() => window.__mtTa.fit()); await sleep(600);
    await shotTo(page, 'r11-deep-fit');
    await page.evaluate(() => window.__mtTa.flyTo('s:plan-2', 0.85)); await sleep(800);
    await shotTo(page, 'r11-deep-85');
    await page.evaluate(() => window.__mtTa.flyTo('s:lib-1', 0.85)); await sleep(800);
    await shotTo(page, 'r11-peers-85');
    await page.evaluate(() => window.__r11un());
    await closeMission(page);
    await page.evaluate(UNHOOK);
  } finally { await closeApp(app); }
}

// ---- 라운드 12: 실제 세션(P156 relation.set)으로. 개발용 판에 p153-haiku(리드) + atrium child로 띄운 p153-sub·p153-sub2(하위)·p153-peer(--peer)가 있어야 한다 ----
// 세션의 atrium me는 판이 그 세션에 준 설정 env(개발용 판 데이터 폴더의 sessions/<id>.json)로 부른다. 토큰은 찍지 않는다
const meOf = (sid) => {
  const j = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'sessions', `${sid}.json`), 'utf8'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ATRIUM|HC|HERDR|MTASK)_/.test(k)));
  return execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), 'me'], { encoding: 'utf8', env: { ...env, ...(j.env || {}) } });
};
async function r12real() {
  call('settings.set', { key: 'missionStyle', value: 'territories' });
  const sess = Object.fromEntries(call('session.list').map((s) => [s.name, s.sessionId]));
  for (const n of ['p153-haiku', 'p153-sub', 'p153-sub2', 'p153-peer']) if (!sess[n]) throw new Error(`${n} 세션이 없다(atrium child로 먼저 띄운다)`);
  // 앞 실행이 사람으로 정한 관계(source user)는 모두 자동으로 되돌리고 시작한다(atrium child --peer의 동료는 에이전트가 정한 것이라 남는다)
  const mine = new Set(Object.values(sess));
  for (const x of call('relation.list').relations || []) if (x.source === 'user' && mine.has(x.a) && mine.has(x.b)) call('relation.set', { a: x.a, b: x.b, relation: 'auto' });
  const { app, page } = await launch({ log, env: { ...ENV }, args: [`--remote-debugging-port=${DEBUG}`, ...AWAKE] });
  try {
    await awayWin(app);
    await page.setViewportSize({ width: 1584, height: 921 }).catch(() => {});
    await sleep(2500);
    if (await page.$('[data-role="sidebar"]')) { await page.click('[data-action="sidebar"]'); await sleep(500); }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openMission(page);
    const idOf = (name) => page.evaluate((n) => { const L = window.__mtTa.lay(); const hit = [...L.cards.entries()].find(([, b]) => b.node.name === n); return hit ? hit[0] : null; }, name);
    const ids = {}; for (const n of ['p153-haiku', 'p153-sub', 'p153-sub2', 'p153-peer', 'p153-a']) ids[n] = await idOf(n);
    const geo = () => page.evaluate((I) => {
      const L = window.__mtTa.lay(), c = (n) => L.cards.get(I[n]) || null, col0 = L.cols.find((x) => x.key === 'lv' && x.level === 0).x;
      const pe = [...document.querySelectorAll('.mt-ta-edge.k-peer')].map((e) => [e.dataset.from, e.dataset.to].sort().join('|'));
      return { col0, cards: Object.fromEntries(Object.entries(I).map(([n, id]) => [n, c(n) && { x: c(n).x, y: c(n).y, h: c(n).h, depth: c(n).depth, parent: L.tree.parent.get(id) || null, peers: (L.tree.byId.get(id).peers || []) }])), peerEdges: pe,
        lin: [...document.querySelectorAll('.mt-ta-edge.k-lineage')].map((e) => `${e.dataset.from}>${e.dataset.to}`) };
    }, ids);
    await page.evaluate((id) => window.__mtTa.flyTo(id, 0.6), ids['p153-haiku']); await sleep(800);
    await shotTo(page, 'r12-real-open');
    const g0 = await geo();
    const H = g0.cards['p153-haiku'], P = g0.cards['p153-peer'];
    check('r12 실제: atrium child --peer로 띄운 동료는 리드 옆(같은 칸, 바로 위아래), 양끝 점 선; 하위 둘은 1단계', H && P && H.x === P.x && H.x === g0.col0 && Math.abs((P.y > H.y ? P.y - (H.y + H.h) : H.y - (P.y + P.h))) <= 60 && g0.peerEdges.includes([ids['p153-haiku'], ids['p153-peer']].sort().join('|')) && g0.cards['p153-sub'].parent === ids['p153-haiku'] && g0.cards['p153-sub2'].depth === 1, g0);
    // 끌기 도우미(세계 좌표 → 화면)
    const w2s = (wx, wy) => page.evaluate(([a, b]) => { const v = window.__mtTa.view(), vp = document.querySelector('[data-role=ta-viewport]').getBoundingClientRect(); return { x: vp.left + v.x + a * v.k, y: vp.top + v.y + b * v.k }; }, [wx, wy]);
    const cen = (id) => page.evaluate((i) => { const L = window.__mtTa.lay(), v = window.__mtTa.view(), vp = document.querySelector('[data-role=ta-viewport]').getBoundingClientRect(), c = L.cards.get(i); return { x: vp.left + v.x + (c.x + c.w / 2) * v.k, y: vp.top + v.y + (c.y + c.h / 2) * v.k }; }, id);
    const drag = async (from, to, shot) => {
      await page.keyboard.down('Alt'); await page.mouse.move(from.x, from.y); await page.mouse.down();
      for (let i = 1; i <= 16; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / 16, from.y + (to.y - from.y) * i / 16); await sleep(16); }
      const d = await page.evaluate(() => { const x = document.querySelector('[data-role=ln-drop]'); return x && !x.hidden ? { kind: x.dataset.kind, text: x.textContent } : null; });
      if (shot) await shotTo(page, shot);
      await page.mouse.up(); await page.keyboard.up('Alt'); await sleep(1500);
      return d;
    };
    const reopen = async () => { await closeMission(page); await openMission(page); await page.evaluate((id) => window.__mtTa.flyTo(id, 0.5), ids['p153-haiku']); await sleep(800); return geo(); };
    const rel = () => call('relation.list').relations || [];
    // 1) 독립: sub2 → 줄의 빈 시작 칸
    const s2 = await page.evaluate(([i, h]) => { const L = window.__mtTa.lay(), c = L.cards.get(i), r = L.rows.find((x) => x.key === c.ws), c0 = L.cols.find((x) => x.key === 'lv' && x.level === 0).x; const busy = [...L.cards.values()].filter((b) => b.ws === c.ws && Math.abs(b.x - c0) < 1).map((b) => [b.y, b.y + b.h]); let y = r.y + r.h - 30; for (let t = r.y + 20; t < r.y + r.h - 20; t += 10) if (!busy.some(([a, b]) => t >= a - 70 && t <= b + 70)) { y = t; break; } return { x: c0 + 60, y }; }, [ids['p153-sub2'], ids['p153-haiku']]);
    const d2 = await drag(await cen(ids['p153-sub2']), await w2s(s2.x, s2.y), 'r12-real-drag-none');
    const g2 = await reopen();
    const me2 = meOf(sess['p153-sub2']);
    check('r12 실제: Alt+끌기 독립 → 다시 열어도 시작 칸, 계보는 옅은 선, atrium me(sub2)에 상위 없음', d2 && d2.kind === 'none' && g2.cards['p153-sub2'].x === g2.col0 && !g2.cards['p153-sub2'].parent && g2.lin.includes(`${ids['p153-haiku']}>${ids['p153-sub2']}`) && /상위: 없음|parent: none/i.test(me2), { d2, c: g2.cards['p153-sub2'], lin: g2.lin, me2: me2.slice(0, 400) });
    // 2) 동료로(독립한 sub2를 sub 옆으로): sub2 → sub 바로 아래
    const s1 = await page.evaluate((i) => { const c = window.__mtTa.lay().cards.get(i); return { x: c.x + 40, y: c.y + c.h + 20 }; }, ids['p153-sub']);
    const d1 = await drag(await cen(ids['p153-sub2']), await w2s(s1.x, s1.y), 'r12-real-drag-peer');
    const g1 = await reopen();
    const me1 = meOf(sess['p153-sub2']);
    check('r12 실제: Alt+끌기 동료로 → relation.set이 판에 남고, 맵을 다시 열어도 sub 옆, atrium me(sub2)에 동료', d1 && d1.kind === 'peer' && g1.cards['p153-sub2'].peers.includes(ids['p153-sub']) && g1.cards['p153-sub2'].x === g1.cards['p153-sub'].x && /p153-sub\b/.test(me1) && /동료|peer/i.test(me1), { d1, rel: rel(), me1: me1.slice(0, 400) });
    // 3) 하위로: peer → sub 오른쪽 칸
    const s3 = await page.evaluate((i) => { const c = window.__mtTa.lay().cards.get(i); return { x: c.x + c.w + 110 + c.w * 0.3, y: c.y + c.h / 2 }; }, ids['p153-sub']);
    const d3 = await drag(await cen(ids['p153-peer']), await w2s(s3.x, s3.y), 'r12-real-drag-sub');
    const g3 = await reopen();
    const me3 = meOf(sess['p153-peer']);
    check('r12 실제: Alt+끌기 하위로 → 다시 열어도 sub의 하위(2단계), atrium me(peer)의 상위 = p153-sub', d3 && d3.kind === 'sub' && g3.cards['p153-peer'].parent === ids['p153-sub'] && g3.cards['p153-peer'].depth === 2 && /상위:[^\n]*p153-sub|parent:[^\n]*p153-sub/i.test(me3), { d3, c: g3.cards['p153-peer'], me3: me3.slice(0, 400) });
    await shotTo(page, 'r12-real-after');
    // 4) 고리: haiku를 peer(haiku > sub > peer)의 하위로 = 판이 cycle로 막는다(맵은 자기 하위 아래로 놓기를 고르지 않는다)
    let cyc = null; try { call('relation.set', { a: sess['p153-peer'], b: sess['p153-haiku'], relation: 'sub' }); } catch (e) { cyc = String(e.message || e); }
    check('r12 실제: 고리는 판이 cycle로 막는다(맵은 자기 하위 아래로 놓기를 고르지 않는다)', !!cyc && /cycle|고리|아래에 있어/.test(cyc), cyc && cyc.slice(-200));
    await closeMission(page);
  } finally { await closeApp(app); }
}

// ---- P157: 솔로 칸·폴더 기둥·미리 보기 하나·Alt 없이 강조 없음·판으로 바로 ----
async function p157() {
  call('settings.set', { key: 'missionStyle', value: 'territories' });
  const shape = JSON.parse(JSON.stringify(SHAPE));
  // 솔로 판정 흉내: 하위도 연결도 없는 세션 둘에 닫힌 하위·지시 기록을 준다(시작 칸에 남아야 한다). 나머지 그런 세션은 솔로
  const hasKid = new Set(shape.sessions.map((x) => x.parent).filter(Boolean));
  const linked = new Set(shape.links.flatMap((l) => [l.src, l.dst]));
  const lone = shape.sessions.filter((x, i) => i > 0 && !x.parent && !hasKid.has(x.name) && !linked.has(x.name) && !x.parentClosed);
  const marked = { closed: lone[0] ? lone[0].name : null, assign: lone[1] ? lone[1].name : null };
  if (lone[0]) lone[0].closedKids = 2;
  if (lone[1]) lone[1].assignAt = Date.now() - 3600e3;
  const { app, page } = await launch({ log, env: { ...ENV }, args: [`--remote-debugging-port=${DEBUG}`, ...AWAKE] });
  try {
    await awayWin(app);
    await page.setViewportSize({ width: 1584, height: 921 }).catch(() => {});
    await sleep(2500);
    if (await page.$('[data-role="sidebar"]')) { await page.click('[data-action="sidebar"]'); await sleep(500); }
    const real = await realId(page);
    await page.evaluate(HOOK, [shape, MIX, real, null]);
    for (const [w, h] of [[1584, 921], [2576, 1408]]) {
      await page.setViewportSize({ width: w, height: h }).catch(() => {});
      await sleep(600);
      await page.emulateMedia({ reducedMotion: 'reduce' }); // 사용자 PC(움직임 줄이기)
      await openMission(page);
      await shotTo(page, `p157-${w}-fit`);
      // 1. 솔로: 기록이 있는 세션은 시작 칸(depth 0), 솔로 칸 머리는 '솔로'
      const solo = await page.evaluate((mk) => { const L = window.__mtTa.lay(); const d = (n) => { const b = n && L.cards.get(`s:${n}`); return b ? b.depth : null; }; return { closed: d(mk.closed), assign: d(mk.assign), soloN: [...L.cards.values()].filter((b) => b.depth === -1).length, head: (document.querySelector('.colh[data-col=solo]') || {}).textContent, role: mk.closed ? (document.querySelector(`.mt-ta-card[data-name="${mk.closed}"] .crole`) || {}).textContent : null }; }, marked);
      check(`[${w}] 솔로: 닫힌 하위·지시 기록이 있는 세션은 시작 칸, 칸 머리 '솔로'`, (!marked.closed || solo.closed === 0) && (!marked.assign || solo.assign === 0) && /솔로|Solo/.test(solo.head || ''), { marked, solo });
      // 2. 폴더 기둥: 이름이 잘리지 않고(…), 수는 두 줄, 기둥 글이 띠 안에
      const sp = await page.evaluate(() => [...document.querySelectorAll('[data-role=ln-band]')].map((b) => { const s = b.querySelector('.mt-sm-spine'), fn = s.querySelector('.fn'), fs2 = s.querySelector('.fs'); const kids = [...fs2.children].map((x) => x.getBoundingClientRect()); const sr = s.getBoundingClientRect(), br = b.getBoundingClientRect(); const last = [...s.children].reduce((m, x) => Math.max(m, x.getBoundingClientRect().bottom), 0); return { name: fn.textContent, cut: fn.scrollWidth > fn.clientWidth + 1 || fn.getBoundingClientRect().right > sr.right + 1, lines: kids.length === 2 && kids[1].top >= kids[0].bottom - 1, text: fs2.innerText, dot: fs2.innerText.includes('·'), fits: last <= br.bottom + 1, spineW: Math.round(sr.width), bandH: Math.round(br.height) }; }));
      check(`[${w}] 폴더 기둥: 이름 말줄임 없음, '워크스페이스 n개'·'세션 n개' 두 줄(가운뎃점 없음), 글이 띠 안`, sp.length && sp.every((x) => !x.cut && x.lines && !x.dot && x.fits), sp);
      // 가장 낮은 띠와 이름이 가장 긴 띠의 기둥 그림
      const bandNames = await page.evaluate(() => { const bs = [...document.querySelectorAll('[data-role=ln-band]')].map((b) => ({ n: b.querySelector('.fn').textContent, h: b.getBoundingClientRect().height })); const few = bs.slice().sort((a, b) => a.h - b.h)[0], long = bs.slice().sort((a, b) => b.n.length - a.n.length)[0]; return [...new Set([few && few.n, long && long.n].filter(Boolean))]; });
      for (const nm of bandNames) {
        const r = await page.evaluate((n) => { const b = [...document.querySelectorAll('[data-role=ln-band]')].find((x) => x.querySelector('.fn').textContent === n); if (!b) return null; const r2 = b.getBoundingClientRect(), sr = b.querySelector('.mt-sm-spine').getBoundingClientRect(); const y = Math.max(0, r2.top); return { x: Math.max(0, r2.left), y, width: Math.min(innerWidth, sr.width + 520), height: Math.min(r2.bottom, innerHeight) - y }; }, nm);
        if (r && r.height > 10) await shotTo(page, `p157-${w}-spine-${nm}`, r);
      }
      if (w !== 1584) continue;
      // 3. 미리 보기 하나: 카드에 마우스를 올려 1.5초 → 미리 보기 하나, 카드와 그 위 요소에 title(브라우저 풍선) 없음
      const sel = `.mt-ta-card[data-name="${shape.sessions[0].name}"]`;
      await page.evaluate((s2) => { const el = document.querySelector(s2); window.__mtTa.flyTo(el.dataset.id, 0.9); }, sel); await sleep(900);
      const c = await page.evaluate((s2) => { const r = document.querySelector(s2).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
      await page.mouse.move(c.x, c.y); await sleep(1500);
      const pk = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); const titles = []; for (let e = el; e; e = e.parentElement) if (e.getAttribute && e.getAttribute('title')) titles.push(String(e.className)); return { peeks: document.querySelectorAll('[data-role=ln-peek]').length, titles }; }, [c.x, c.y]);
      await shotTo(page, `p157-${w}-hover`);
      check(`[${w}] 카드에 마우스: 미리 보기 하나, 브라우저 풍선(title) 없음`, pk.peeks === 1 && !pk.titles.length, pk);
      await page.mouse.move(5, 300); await sleep(300);
      // 4. Alt 없이 워크스페이스 머리를 지나가기: 강조·안내 글·title 없음. Alt를 누르면 안내 글
      await page.evaluate(() => window.__mtTa.fit()); await sleep(500);
      const hp = await page.evaluate(() => { const h = [...document.querySelectorAll('.mt-sm-head[data-key]')].find((x) => { const r = x.getBoundingClientRect(); return r.top > 120 && r.bottom < innerHeight - 140; }); const r = h.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 10 }; });
      await page.mouse.move(hp.x - 60, hp.y + 40); await page.mouse.move(hp.x, hp.y, { steps: 6 }); await sleep(1600);
      const look = () => page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); const row = el && el.closest('.mt-sm-row'), head = row && row.querySelector('.mt-sm-head'), grab = row && row.querySelector('.mt-sm-grab'), hint = row && row.querySelector('[data-role=ln-alt-hint]'); const cs = (e) => (e ? getComputedStyle(e) : null); const titles = []; for (let e = el; e; e = e.parentElement) if (e.getAttribute && e.getAttribute('title')) titles.push(String(e.className)); return { row: !!row, rowBg: cs(row) && cs(row).backgroundColor, headOutline: cs(head) && cs(head).outlineStyle, headBg: cs(head) && cs(head).backgroundColor, grabBg: cs(grab) && cs(grab).backgroundColor, hint: cs(hint) && cs(hint).display, alt: document.querySelector('[data-role=ta-viewport]').dataset.alt || null, titles }; }, [hp.x, hp.y]);
      const clear = (c2) => !c2 || /rgba\(0, 0, 0, 0\)|transparent/.test(c2);
      const noAlt = await look();
      await shotTo(page, `p157-${w}-head-noalt`);
      check(`[${w}] Alt 없이 이름 칸을 지나가면 강조 없음, 오래 두어도 풍선 없음`, noAlt.row && clear(noAlt.rowBg) && noAlt.headOutline === 'none' && clear(noAlt.headBg) && clear(noAlt.grabBg) && noAlt.hint === 'none' && !noAlt.titles.length, noAlt);
      await page.keyboard.down('Alt'); await page.mouse.move(hp.x + 2, hp.y + 1); await sleep(400);
      const withAlt = await look();
      await shotTo(page, `p157-${w}-head-alt`);
      await page.keyboard.up('Alt'); await sleep(200);
      check(`[${w}] Alt를 누른 동안만 안내 글`, withAlt.hint === 'block', withAlt);
      // 5. 더블클릭 → 판의 그 세션 맞춤 보기로 한 번에(중간 화면 없음). 움직임 줄이기를 끄고 본다(날아가기가 있으면 여러 화면이 찍힌다)
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await closeMission(page);
      await page.evaluate(() => window.__mt.getState().setViewport({ x: 30000, y: 30000, zoom: 0.2 })); await sleep(500);
      await openMission(page);
      await page.evaluate((s2) => { const el = document.querySelector(s2); window.__mtTa.flyTo(el.dataset.id, 0.9); }, sel); await sleep(900);
      const c2 = await page.evaluate((s2) => { const r = document.querySelector(s2).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
      await page.evaluate(() => { window.__p157vp = []; const tick = () => { const v = document.querySelector('.react-flow__viewport'); if (v) { const t = v.style.transform; const a = window.__p157vp; if (!a.length || a[a.length - 1] !== t) a.push(t); } if (window.__p157vp.length < 500) window.__p157raf = requestAnimationFrame(tick); }; tick(); });
      await page.mouse.dblclick(c2.x, c2.y); await sleep(1500);
      const nav = await page.evaluate(() => { cancelAnimationFrame(window.__p157raf); return { frames: window.__p157vp, open: !!document.querySelector('[data-role=mission]') }; });
      await shotTo(page, `p157-${w}-after-open`);
      check(`[${w}] 더블클릭: 세션 맵을 닫고 판 화면이 한 번에 바뀐다(중간 화면 없음)`, !nav.open && nav.frames.length === 2, { n: nav.frames.length, frames: nav.frames.slice(0, 6) });
    }
    await page.evaluate(UNHOOK);
  } finally { await closeApp(app); }
}

async function stopBoard() {
  for (const s of call('session.list').filter((x) => /^p153-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
  await sleep(2000);
  try { log(atrium('terminal', 'stop', '--yes').slice(0, 200)); } catch (e) { log(`terminal stop ${e.message.slice(0, 120)}`); }
  try { log(atrium('backend', 'stop').slice(0, 200)); } catch (e) { log(`backend stop ${e.message.slice(0, 120)}`); }
}

try {
  if (WHAT === 'setup') await setupBoard();
  else if (WHAT === 'pc') await pc();
  else if (WHAT === 'phone') log('P166: 휴대폰 단계는 app/test/e2e/p166-phone.mjs로 옮겼다');
  else if (WHAT === 'mock') await mock();
  else if (WHAT === 'perf') await perf();
  else if (WHAT === 'r11') await r11();
  else if (WHAT === 'r12real') await r12real();
  else if (WHAT === 'compare') { await compareApp(); await mock(true); }
  else if (WHAT === 'p157') await p157();
  else if (WHAT === 'stop') await stopBoard();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, `p153-${WHAT}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
