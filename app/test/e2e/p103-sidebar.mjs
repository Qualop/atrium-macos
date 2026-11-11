// P103 창 시험: 왼쪽 사이드바를 나무 모양(들여쓰기와 옅은 세로 안내선, 작은 펼침 화살표, 조용한 줄)으로 다듬기 전·뒤.
// 판: herdr 세션 atrium-dev-p103, 포트 47897, 이 워크트리의 backend/.dev(data, app). 창의 원격 디버깅 포트 9377.
// 장면(새 폴더 C:\Workspace\mtask-p103-*, git 아님, 셸만 띄운다): 워크스페이스 여덟(저절로 만든 묶음 하나, 사람이 만든 그룹 하나, 그룹 없음 넷),
//   리드와 워커(parentSessionId), 닫힌 세션, 판 밖 대화(고정 자료), 정리 대상 대화(없는 시험 폴더의 고정 자료), 보관한 것 하나.
//   응답 필요·오류·작업 중·잠듦·안 본 결과, 종류(claude, codex), 저장소 종류, 지휘·워커 역할은 창 안에서만 흉내 낸다(session.updated, workspace.updated).
// 단계: setup | shot | func | clean. shot·func 뒤에 before | after(그림·기록 이름). 결과는 experiments/p103/(git 밖).
// 실행(워크트리 루트): node app/test/e2e/p103-sidebar.mjs setup → shot before → (고친 뒤 빌드) shot after → func after → clean
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [STAGE = 'shot', TAG = 'after'] = process.argv.slice(2);
if (!['setup', 'shot', 'func', 'clean'].includes(STAGE)) throw new Error('단계: setup | shot | func | clean');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p103');
const CONVOS = path.join(DEV, 'p103-projects');
const BOARD = { session: 'atrium-dev-p103', port: 47897, cdp: 9377 };
const ENV = {
  ATRIUM_HERDR_SESSION: BOARD.session, ATRIUM_PORT: String(BOARD.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_CLAUDE_SESSIONS: path.join(DEV, 'p103-claude-sessions'),
  ATRIUM_TEST_PREFIX: 'mtask-p103-x', MT_E2E_OUT: 'p103',
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|MT_HERDR)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)) delete process.env[k];
Object.assign(process.env, ENV);
for (const d of [OUT, CONVOS, ENV.ATRIUM_CLAUDE_SESSIONS]) fs.mkdirSync(d, { recursive: true });
const { logger, sleep, until, APP_ROOT, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const log = logger(`p103-${STAGE}-${TAG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 180000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const sessions = () => call('session.list');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };

// ---------- 장면 ----------
const W = 'C:\\Workspace';
const F = {
  hub: `${W}\\mtask-p103-hub`, core: `${W}\\mtask-p103-hub\\core`, web: `${W}\\mtask-p103-web`, docs: `${W}\\mtask-p103-docs`,
  api: `${W}\\mtask-p103-api`, lab: `${W}\\mtask-p103-lab`, tools: `${W}\\mtask-p103-tools`, infra: `${W}\\mtask-p103-infra`,
};
const GONE = `${W}\\mtask-p103-xold`; // 없는 시험 폴더(정리 대상 대화)
for (const d of [...Object.values(F), GONE]) if (!/^C:\\Workspace\\mtask-p103-[a-z]+(\\core)?$/.test(d)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p103-*만: ${d}`);
// 이름, 폴더, 부모(이름)
const LIVE = [
  ['hub-main', 'hub'], ['hub-notes', 'hub'],
  ['core-head', 'core'], ['core-runner', 'core', 'core-head'], ['core-review', 'core', 'core-head'],
  ['web-dev', 'web'], ['web-build', 'web'], ['docs-site', 'docs'],
  ['api-lead', 'api'], ['api-worker', 'api', 'api-lead'],
  ['lab-bench', 'lab'], ['tools-lint', 'tools'], ['tools-release', 'tools'],
];
const CLOSED = [['hub-old1', 'hub'], ['hub-old2', 'hub'], ['core-tmp', 'core'], ['api-old', 'api'], ['web-spike', 'web']];
const REPOS = ['core', 'web', 'api', 'tools']; // 창 안에서 저장소로 흉내
const SCENE = path.join(OUT, 'scene.json');

const DAY = 86400000, MIN = 60000;
let seq = 0;
function convo(cwd, { at, title, prompt }) {
  const cid = `${String(++seq).padStart(8, '0')}-0000-4000-8000-00000000a103`;
  const ts = (s) => new Date(at + s * 1000).toISOString();
  const base = { cwd, entrypoint: 'cli', gitBranch: null, sessionId: cid };
  const lines = [
    JSON.stringify({ type: 'user', uuid: `u${cid}-0`, ...base, timestamp: ts(0), message: { role: 'user', content: prompt } }),
    JSON.stringify({ type: 'assistant', uuid: `a${cid}-1`, ...base, timestamp: ts(20), message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }),
    JSON.stringify({ type: 'ai-title', aiTitle: title, sessionId: cid }),
  ];
  const dir = path.join(CONVOS, cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${cid}.jsonl`), lines.join('\n') + '\n');
}
async function setup() {
  log('백엔드', atrium('backend', 'start').trim().slice(0, 200));
  atrium('settings', 'set', 'language', process.env.P103_LANG || 'ko'); // 사용자 판과 같은 한국어 화면
  for (const s of sessions()) { try { atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log('옛 세션 끄기 실패', s.name, e.message.slice(0, 120)); } }
  for (const d of Object.values(F)) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'README.md'), `# ${path.basename(d)}\n`); }
  fs.rmSync(CONVOS, { recursive: true, force: true }); fs.mkdirSync(CONVOS, { recursive: true });
  const now = Date.now();
  convo(F.web, { at: now - 3 * 60 * MIN, title: 'Landing page layout pass', prompt: 'tidy the landing page' });
  convo(F.web, { at: now - 26 * 60 * MIN, title: 'Fix image loading', prompt: 'images flash on load' });
  convo(F.api, { at: now - 50 * MIN, title: 'Rate limit middleware', prompt: 'add a rate limit' });
  convo(F.api, { at: now - 5 * 60 * MIN, title: 'Schema migration plan', prompt: 'plan the migration' });
  convo(F.api, { at: now - 2 * DAY, title: 'Old auth notes', prompt: 'notes on auth' });
  convo(F.hub, { at: now - 9 * 60 * MIN, title: 'Workspace readme', prompt: 'write the readme' });
  for (let i = 0; i < 4; i++) convo(GONE, { at: now - (3 + i) * DAY, title: `Scratch test ${i + 1}`, prompt: 'scratch' });
  const key = {};
  for (const [k, d] of Object.entries(F)) { const r = call('workspace.open', { path: d, select: false }); key[k] = r.workspace.key; log('워크스페이스', k, r.workspace.key, r.workspace.kind); }
  const id = {};
  for (const [name, ws, parent] of [...LIVE, ...CLOSED]) {
    const r = call('session.spawn', { cwd: F[ws], kind: 'shell', name, ...(parent ? { parentSessionId: id[parent] } : {}) });
    id[name] = r.sessionId; log('띄움', name, r.sessionId);
  }
  await until(() => { const s = sessions(); return [...LIVE, ...CLOSED].every(([n]) => s.some((x) => x.name === n && /shell_/.test(x.state))); }, 120000, 1500).catch(() => log('셸 준비 기다림 넘김'));
  for (const [name] of CLOSED) { try { atrium('kill', id[name], '--yes'); } catch (e) { log('끄기 실패', name, e.message.slice(0, 120)); } }
  await sleep(2000);
  try { call('archive.add', { session: id['web-spike'] }); } catch (e) { log('보관 실패', e.message.slice(0, 160)); }
  // 사람이 만든 그룹: web, docs
  try {
    const g = call('group.create', { name: 'Frontend', workspaces: [key.web] });
    call('group.move', { workspace: key.docs, group: g.created, index: null });
  } catch (e) { log('그룹 실패', e.message.slice(0, 160)); }
  try { call('convo.scan'); } catch {}
  const list = call('workspace.list');
  log('그룹', JSON.stringify(list.groups));
  fs.writeFileSync(SCENE, JSON.stringify({ key, id }, null, 1));
  check('장면: 워크스페이스 여덟, 판 세션 열셋, 닫힌 세션 다섯', list.workspaces.length >= 8 && sessions().length === LIVE.length, { ws: list.workspaces.length, sessions: sessions().length });
}

// ---------- 창 ----------
const FAKE = {
  'core-review': { state: 'waiting', ask: { kind: 'permission', tool: 'Bash', summary: 'npm run deploy -- --prod' } },
  'tools-release': { state: 'waiting', ask: { kind: 'question', questions: [{ question: '어느 브랜치에 합칠까요?' }] } },
  'api-worker': { state: 'error', error: { message: 'exit 1: build failed' } },
  'core-runner': { state: 'working' }, 'web-dev': { state: 'working' }, 'core-head': { state: 'working' },
  'lab-bench': { state: 'sleeping' }, 'web-build': { state: 'ready', unseen: true }, 'hub-main': { state: 'ready' }, 'hub-notes': { state: 'ready' },
  'api-lead': { state: 'ready' }, 'docs-site': { state: 'ready', kind: 'codex' }, 'tools-lint': { state: 'shell_idle', kind: 'shell' },
};
async function fake(page, { big = 0 } = {}) {
  await page.evaluate(([FK, repos, folders, big]) => {
    const st = window.__mt.getState();
    const now = Date.now();
    const keyOf = (dir) => { const w = st.workspaces.find((x) => x.root.replace(/\//g, '\\').toLowerCase() === dir.toLowerCase()); return w && w.key; };
    const repoKeys = new Set(repos.map((k) => keyOf(folders[k])).filter(Boolean));
    if (st.workspaces.some((w) => repoKeys.has(w.key) && w.kind !== 'repo')) window.__mt.api.emit('workspace.updated', { workspaces: st.workspaces.map((w) => (repoKeys.has(w.key) ? { ...w, kind: 'repo' } : w)), groups: st.groups });
    const byName = new Map([...st.sessions.values()].map((s) => [s.name, s]));
    let i = 0;
    for (const [name, f] of Object.entries(FK)) {
      const s = byName.get(name);
      if (!s) continue;
      const parent = s.parentSessionId ? [...st.sessions.values()].find((x) => x.sessionId === s.parentSessionId) : null;
      const branch = parent ? { child: true, role: name === 'api-worker' ? '리뷰어' : '워커', depth: 1, order: name === 'core-review' ? 2 : 1, parentName: parent.name, parentOpen: true }
        : (name === 'core-head' || name === 'api-lead') ? { child: false, role: '지휘', head: true } : null;
      window.__mt.api.emit('session.updated', { ...s, kind: f.kind || 'claude', state: f.state, ask: f.ask ? { ...f.ask, since: now - 90000 } : null, error: f.error || null, unseen: !!f.unseen, branch, lastActivityAt: now - (++i * 47000) });
    }
    // 큰 판: 창 안에만 있는 세션 big개(워크스페이스마다 고르게, 몇은 응답 필요·작업 중)
    if (big) {
      const keys = st.workspaces.map((w) => w.key);
      for (let n = 0; n < big; n++) {
        const state = n % 41 === 7 ? 'waiting' : n % 9 === 3 ? 'working' : n % 23 === 5 ? 'sleeping' : 'ready';
        window.__mt.api.emit('session.updated', { sessionId: `p103-fake-${n}`, name: `job-${String(n + 1).padStart(3, '0')}`, kind: 'claude', state, ask: state === 'waiting' ? { kind: 'permission', tool: 'Edit', summary: `src/mod-${n}.ts`, since: now - 60000 } : null, workspaceKey: keys[n % keys.length], createdAt: now - n * 60000, lastActivityAt: now - n * 61000, unseen: n % 17 === 2 });
      }
    }
  }, [FAKE, REPOS, F, big]);
  await sleep(400);
}
const sideRect = (page) => page.evaluate(() => { const r = document.querySelector('[data-role="sidebar"]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; });
const shotSide = async (page, name) => { const clip = await sideRect(page); const f = path.join(OUT, `${TAG}-${name}.png`); await page.screenshot({ path: f, clip }); log('스크린숏', path.relative(REPO, f)); return f; };
const shotAll = async (page, name) => { const f = path.join(OUT, `${TAG}-${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const rowsOf = (page) => page.evaluate(() => {
  const v = document.querySelector('[data-role="sidebar-rows"]');
  return { total: v ? +v.dataset.rows : 0, shown: v ? +v.dataset.shown : 0, rows: [...document.querySelectorAll('[data-role="sidebar-rows"] [data-row]')].map((r) => ({ id: r.dataset.row, sb: r.dataset.sb || r.dataset.action || null, name: r.dataset.name || null, cls: r.className, h: Math.round(r.getBoundingClientRect().height), text: r.innerText.replace(/\s+/g, ' ').trim().slice(0, 80) })) };
});
async function allRows(page) {
  const seen = new Map();
  await page.evaluate(() => { document.querySelector('[data-role="sidebar-list"]').scrollTop = 0; });
  for (let i = 0; i < 200; i++) {
    await sleep(60);
    for (const x of (await rowsOf(page)).rows) seen.set(x.id, x);
    const end = await page.evaluate(() => { const l = document.querySelector('[data-role="sidebar-list"]'); const at = l.scrollTop; l.scrollTop += l.clientHeight * 0.8; return l.scrollTop === at; });
    if (end) break;
  }
  await page.evaluate(() => { document.querySelector('[data-role="sidebar-list"]').scrollTop = 0; });
  await sleep(100);
  return [...seen.values()];
}
const scene = () => JSON.parse(fs.readFileSync(SCENE, 'utf8'));
const wsSel = (k) => `[data-sb="ws"][data-ws="${scene().key[k]}"]`;
const foldSel = (k) => `${wsSel(k)} [data-action="fold"]`; // 줄 가운데를 누르면 긴 이름(옛 대문자 이름)에서는 이름 단추(영역으로 가기)에 닿는다
const sessSel = (n) => `[data-sb="session"][data-name="${n}"]`;
async function reveal(page, sel) {
  for (let i = 0; i < 120; i++) {
    const found = await page.evaluate(([s, k]) => {
      const e = document.querySelector(s);
      const l = document.querySelector('[data-role="sidebar-list"]');
      if (e) { const r = e.getBoundingClientRect(), lr = l.getBoundingClientRect(); if (r.top >= lr.top && r.bottom <= lr.bottom) return true; l.scrollTop += r.top - lr.top - lr.height / 3; return false; }
      if (k === 0) l.scrollTop = 0; else l.scrollTop += 240;
      return false;
    }, [sel, i]);
    if (found) return true;
    await sleep(60);
  }
  return false;
}
const click = async (page, sel, opts = {}) => { if (/data-sb=|data-action="(fold|go-ws|extra|more|session-menu|ws-menu|group-menu)"/.test(sel)) await reveal(page, sel); const el = await page.waitForSelector(sel, { timeout: 10000 }); await el.click(opts); await sleep(250); };

// 사이드바 밖 화면(판 노드, 위 바, 미션 맵)의 계산된 모양: 고치기 전·뒤가 같아야 한다
const STYLE_PRINT = `((sel) => {
  const roots = [...document.querySelectorAll(sel)];
  if (!roots.length) return null;
  const keys = ['display', 'position', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'color', 'backgroundColor', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRadius', 'paddingTop', 'paddingLeft', 'textTransform', 'letterSpacing'];
  return roots.flatMap((root) => [root, ...root.querySelectorAll('*')]).filter((e) => !e.closest('.xterm')).map((e) => { const s = getComputedStyle(e); return [e.tagName, String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className), ...keys.map((k) => s[k])].join('|'); });
})`;

async function openWindow() {
  const { _electron: electron } = await import('playwright');
  const app = await electron.launch({ args: ['.', '--dev', `--remote-debugging-port=${BOARD.cdp}`], cwd: APP_ROOT, env: process.env, timeout: 60000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[console.error] ${m.text().slice(0, 300)}`); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 960));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await page.evaluate(() => { try { localStorage.removeItem('mt.sidebar'); } catch {} });
  await page.reload();
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await sleep(1500);
  return { app, page };
}
async function openSidebar(page) {
  if (!(await page.$('[data-role="sidebar"]'))) await page.keyboard.press('Control+Shift+E');
  await page.waitForSelector('[data-role="sidebar"]');
  await page.waitForFunction(() => { const v = document.querySelector('[data-role="sidebar-rows"]'); return v && +v.dataset.rows > 0; }, null, { timeout: 20000 });
  await sleep(1200); // recall.list(닫힌 세션, 판 밖 대화)
}

async function shots() {
  call('workspace.select', { workspace: scene().key.api }); // 위 바의 지금 워크스페이스를 고정(전·뒤를 같은 상태로 견준다)
  const { app, page } = await openWindow();
  try {
    await call('board.arrange', { all: true, apply: true });
    await sleep(1200);
    await fake(page);
    // 화면 배율과 초점 세션을 고정한다(노드 얼굴·터미널 붙음이 배율에 따라 바뀐다)
    await page.evaluate(() => { const st = window.__mt.getState(); st.setViewport({ x: 60, y: 120, zoom: 0.22 }); window.__mt.setFocus(null); });
    await sleep(2500);
    // 사이드바 밖 화면의 계산된 모양(사이드바를 열기 전)
    const outside = { nodes: await page.evaluate(`${STYLE_PRINT}('.mt-node')`), top: await page.evaluate(`${STYLE_PRINT}('[data-role="top-left"], [data-role="top-right"], [data-role="rail-right"]')`) };
    await page.click('[data-action="mission-rail"]').catch(() => {});
    await sleep(1500);
    outside.mission = await page.evaluate(`${STYLE_PRINT}('[data-role="mission"]')`);
    await shotAll(page, '00-mission');
    await page.click('[data-action="mission-rail"]').catch(() => {});
    await sleep(800);
    await openSidebar(page);
    await sleep(1500);
    outside.nodesOpen = await page.evaluate(`${STYLE_PRINT}('.mt-node')`); // 사이드바를 연 뒤(캔버스 폭만 줄고 배율은 그대로)
    await fake(page);
    const st = await rowsOf(page);
    log('줄', JSON.stringify(st.rows.map((r) => `${r.sb}:${r.text}`)));
    await shotSide(page, '01-small');
    await shotAll(page, '01-window');
    // 고른 줄(키보드)과 마우스를 올린 워크스페이스 줄, 지금 연 세션
    await page.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'web-dev'); window.__mt.setFocus(s.sessionId); });
    await page.focus('[data-role="sidebar-filter"]');
    for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowDown'); await sleep(120); }
    await page.hover(wsSel('api')); await sleep(250);
    await shotSide(page, '02-cursor-hover');
    // 접힘: core, tools(응답 필요가 남는다)
    await page.mouse.move(900, 500);
    for (const k of ['core', 'tools']) await click(page, foldSel(k));
    await sleep(300);
    await shotSide(page, '03-folded');
    for (const k of ['core', 'tools']) await click(page, foldSel(k));
    // 닫힌 세션·판 밖 대화 펼침
    for (const k of ['api', 'hub']) await click(page, `[data-sb="extra"][data-ws="${scene().key[k]}"]`).catch((e) => log('펼침 실패', k, e.message.slice(0, 100)));
    await sleep(300);
    await page.evaluate(() => { const l = document.querySelector('[data-role="sidebar-list"]'); l.scrollTop = 0; });
    await page.hover(`[data-sb="closed"]`).catch(() => {});
    await sleep(200);
    await shotSide(page, '04-extra');
    // 맨 아래: 보관함과 정리 대상 대화 펼침
    await click(page, '[data-action="archive-box"]');
    await click(page, '[data-action="missed-box"]');
    await sleep(800);
    await page.evaluate(() => { const l = document.querySelector('[data-role="sidebar-list"]'); l.scrollTop = l.scrollHeight; });
    await sleep(300);
    await shotSide(page, '05-bottom');
    await click(page, '[data-action="archive-box"]');
    await click(page, '[data-action="missed-box"]');
    for (const k of ['api', 'hub']) await click(page, `[data-sb="extra"][data-ws="${scene().key[k]}"]`).catch(() => {});
    // 거르기: 응답 필요 칩
    await click(page, '[data-action="state-chip"][data-bucket="need"]');
    await shotSide(page, '06-filter-need');
    await click(page, '[data-action="clear-filters"]');
    // 고르기 모드
    await click(page, '[data-action="select-mode"]');
    for (const k of ['lab', 'infra']) await click(page, wsSel(k));
    await shotSide(page, '07-select');
    await click(page, '[data-action="select-done"]');
    // 큰 판: 창 안에만 있는 세션 210개 더
    await fake(page, { big: 210 });
    await sleep(500);
    const big = await rowsOf(page);
    log('큰 판', { total: big.total, shown: big.shown });
    await shotSide(page, '08-big-top');
    await page.evaluate(() => { const l = document.querySelector('[data-role="sidebar-list"]'); l.scrollTop = Math.round(l.scrollHeight * 0.45); });
    await sleep(400);
    await shotSide(page, '09-big-middle');
    await click(page, '[data-action="fold-all"]');
    await page.evaluate(() => { const l = document.querySelector('[data-role="sidebar-list"]'); l.scrollTop = 0; });
    await sleep(300);
    await shotSide(page, '10-big-folded');
    await click(page, '[data-action="unfold-all"]');
    fs.writeFileSync(path.join(OUT, `style-${TAG}.json`), JSON.stringify(outside, null, 1));
    fs.writeFileSync(path.join(OUT, `rows-${TAG}.json`), JSON.stringify({ small: st, big: { total: big.total, shown: big.shown } }, null, 1));
    check(`[${TAG}] 찍기`, true, { small: st.total, big: big.total });
  } finally { await closeApp(app); }
}

// ---------- 기능: 접기·펼치기, 거르기, 키보드, 여럿 고르기, 끌어 옮기기, 메뉴, 보관함, 정리 대상 대화, 가상 목록 ----------
async function func() {
  const { app, page } = await openWindow();
  const groups = () => page.evaluate(() => window.__mt.getState().groups);
  try {
    await openSidebar(page);
    await fake(page);
    const k = scene().key;
    // 접기·펼치기(줄 누르기, 화살표 키)
    await click(page, foldSel('hub'));
    let r = await rowsOf(page);
    check('접기: 워크스페이스 줄을 누르면 그 세션 줄이 사라진다', !r.rows.some((x) => x.name === 'hub-main'), r.rows.map((x) => x.name).filter(Boolean));
    await click(page, foldSel('hub'));
    r = await rowsOf(page);
    check('펼치기: 다시 누르면 돌아온다', r.rows.some((x) => x.name === 'hub-main'));
    await click(page, foldSel('tools'));
    r = await rowsOf(page);
    const pin = r.rows.find((x) => x.name === 'tools-release');
    check('접힘: 접힌 워크스페이스 아래에도 응답 필요 세션은 남는다', pin && !r.rows.some((x) => x.name === 'tools-lint'), pin);
    await click(page, foldSel('tools'));
    // 키보드: 찾기 칸 ↓ → 목록, ←로 접고 →로 펴고, Enter로 세션에 들어간다
    await page.fill('[data-role="sidebar-filter"]', 'web-');
    await sleep(300);
    r = await rowsOf(page);
    check('거르기(글): 이름으로 찾는다', r.rows.filter((x) => x.sb === 'session').every((x) => x.name.startsWith('web-')) && r.rows.filter((x) => x.sb === 'session').length === 2, r.rows.map((x) => x.name));
    await page.focus('[data-role="sidebar-filter"]');
    await page.keyboard.press('ArrowDown'); await sleep(150);
    await page.keyboard.press('ArrowDown'); await sleep(150);
    await page.keyboard.press('ArrowDown'); await sleep(150);
    const cur = await page.evaluate(() => { const c = document.querySelector('[data-role="sidebar-rows"] .cur'); return c ? { row: c.dataset.row, name: c.dataset.name, session: c.dataset.session } : null; });
    await page.keyboard.press('Enter'); await sleep(1500);
    const act = await page.evaluate(() => { const a = document.activeElement; const t = a && a.closest && a.closest('.mt-term'); return { xterm: !!(a && a.closest && a.closest('.xterm')), session: t ? t.dataset.session : null, focus: window.__mt.getState().focusId }; });
    check('키보드: 찾기 칸에서 ↓로 목록에 들어가 ↑↓로 옮기고 Enter로 그 세션 터미널에 들어간다', cur && cur.session && act.session === cur.session && act.xterm, { cur, act });
    await page.fill('[data-role="sidebar-filter"]', '');
    await sleep(300);
    // 지금 연 세션은 사이드바에서 강조된다
    const curName = cur && cur.name;
    const hi = await page.evaluate((n) => { const e = document.querySelector(`[data-sb="session"][data-name="${n}"]`); return e ? { focused: e.dataset.focused || null, cls: e.className, color: getComputedStyle(e.querySelector('.mt-sb2-name')).color } : null; }, curName);
    check(`[${TAG}] 지금 연 세션 줄`, TAG === 'before' || (hi && hi.focused === '1'), hi);
    // 줄을 눌러 커서를 두고(접힘이 바뀐다) 다시 눌러 되돌린 뒤 ←·→
    await click(page, foldSel('api')); await click(page, foldSel('api'));
    const before = (await rowsOf(page)).rows.some((x) => x.name === 'api-lead');
    await page.focus('[data-role="sidebar-list"]');
    await page.keyboard.press('ArrowLeft'); await sleep(200);
    const folded = !(await rowsOf(page)).rows.some((x) => x.name === 'api-lead');
    await page.keyboard.press('ArrowRight'); await sleep(200);
    const unfolded = (await rowsOf(page)).rows.some((x) => x.name === 'api-lead');
    check('키보드: ←로 접고 →로 편다', before && folded && unfolded, { before, folded, unfolded });
    // 상태 칩과 지우기
    await click(page, '[data-action="state-chip"][data-bucket="need"]');
    const need = (await allRows(page)).filter((x) => x.sb === 'session').map((x) => x.name).sort();
    check('거르기(칩): 응답 필요만', JSON.stringify(need) === JSON.stringify(['core-review', 'tools-release']), need);
    await click(page, '[data-action="clear-filters"]');
    // 오른쪽 클릭 메뉴(세션)와 ⋯ 메뉴(워크스페이스)
    await reveal(page, sessSel('hub-notes'));
    await page.click(sessSel('hub-notes'), { button: 'right' }); await sleep(300);
    const menu1 = await page.evaluate(() => { const m = document.querySelector('[data-role="sidebar-menu"]'); return m ? [...m.querySelectorAll('[data-action]')].map((b) => b.dataset.action) : null; });
    check('메뉴: 세션 줄 오른쪽 클릭 → 이름 바꾸기, 노드로 가기', menu1 && menu1.includes('menu-rename-session') && menu1.includes('menu-go-session'), menu1);
    await page.keyboard.press('Escape'); await sleep(200);
    await reveal(page, wsSel('lab'));
    await page.hover(wsSel('lab')); await sleep(150);
    await page.click(`${wsSel('lab')} [data-action="ws-menu"]`); await sleep(300);
    const menu2 = await page.evaluate(() => { const m = document.querySelector('[data-role="sidebar-menu"]'); return m ? [...m.querySelectorAll('[data-action]')].map((b) => b.dataset.action) : null; });
    check('메뉴: 워크스페이스 ⋯ → 영역으로, 그룹으로 옮기기, 오래된 것 보관, 판에서 지우기', menu2 && ['menu-go-ws', 'menu-move-group', 'archive-old', 'menu-remove-ws'].every((a) => menu2.includes(a)), menu2);
    // 메뉴로 lab → Frontend
    const gF = (await groups()).find((g) => g.name === 'Frontend');
    await page.click(`[data-role="sidebar-menu"] [data-action="menu-move-group"][data-group="${gF.id}"]`); await sleep(700);
    check('메뉴: 그룹으로 옮기기', (await groups()).find((g) => g.id === gF.id).members.includes(k.lab));
    // 끌어 옮기기: infra → Frontend 머리줄, 그 뒤 lab을 "그룹 없음" 머리줄로
    const drag = async (fromSel, toSel, after = false) => {
      await reveal(page, toSel);
      await page.evaluate(([f, t, a]) => {
        const src = document.querySelector(f), dst = document.querySelector(t);
        const dt = new DataTransfer();
        const r = dst.getBoundingClientRect();
        const y = a ? r.bottom - 3 : r.top + 3;
        src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: y }));
        dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: y }));
        src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      }, [fromSel, toSel, after]);
      await sleep(700);
    };
    await reveal(page, wsSel('infra'));
    await page.evaluate(() => { document.querySelector('[data-role="sidebar-list"]').scrollTop = 0; });
    await sleep(200);
    // 끄는 줄과 놓을 줄이 함께 DOM에 있어야 한다(가상 목록): 모두 접고 끈다
    await click(page, '[data-action="fold-all"]');
    await drag(wsSel('infra'), `[data-sb="group"][data-group="${gF.id}"]`);
    let gs = await groups();
    check('끌기: 워크스페이스를 그룹 머리줄에 놓으면 그 그룹 끝에 든다', gs.find((g) => g.id === gF.id).members.slice(-1)[0] === k.infra, gs.map((g) => [g.name, g.members.length]));
    await drag(wsSel('infra'), '[data-sb="group"][data-group=""]');
    await drag(wsSel('lab'), '[data-sb="group"][data-group=""]');
    gs = await groups();
    check('끌기: "그룹 없음"에 놓으면 그룹에서 빠진다', !gs.some((g) => g.members.includes(k.infra) || g.members.includes(k.lab)), gs.map((g) => [g.name, g.members]));
    await click(page, '[data-action="unfold-all"]');
    // 그룹 이름 바꾸기(두 번 누르기)
    await page.evaluate(() => { document.querySelector('[data-role="sidebar-list"]').scrollTop = 0; });
    await reveal(page, `[data-sb="group"][data-group="${gF.id}"]`);
    await page.dblclick(`[data-sb="group"][data-group="${gF.id}"] [data-role="group-name"], [data-sb="group"][data-group="${gF.id}"] .mt-sb2-gname`);
    await page.waitForSelector('[data-role="group-rename"]', { timeout: 5000 });
    await page.fill('[data-role="group-rename"]', 'Front end');
    await page.keyboard.press('Enter'); await sleep(500);
    check('그룹: 머리줄을 두 번 눌러 이름을 바꾼다', (await groups()).some((g) => g.name === 'Front end'));
    await page.dblclick(`[data-sb="group"][data-group="${gF.id}"] [data-role="group-name"], [data-sb="group"][data-group="${gF.id}"] .mt-sb2-gname`);
    await page.fill('[data-role="group-rename"]', 'Frontend'); await page.keyboard.press('Enter'); await sleep(400);
    // 여럿 고르기
    await click(page, '[data-action="select-mode"]');
    for (const x of ['lab', 'infra']) await click(page, wsSel(x));
    const sel = await page.evaluate(() => ({ n: document.querySelectorAll('[data-sb="ws"] [data-action="ws-select"]:checked').length, bar: (document.querySelector('[data-role="sidebar-selbar"]') || {}).innerText || '' }));
    check('여럿 고르기: 워크스페이스 둘을 고르면 아래 막대에 수가 보인다', sel.n === 2 && /2/.test(sel.bar), sel);
    await click(page, '[data-action="select-done"]');
    // 닫힌 세션·판 밖 대화
    await click(page, `[data-sb="extra"][data-ws="${k.api}"]`);
    r = await rowsOf(page);
    check('닫힌 세션·판 밖 대화: 펼치면 줄이 보인다', r.rows.some((x) => x.sb === 'closed') && r.rows.some((x) => x.sb === 'convo'), r.rows.filter((x) => x.sb === 'closed' || x.sb === 'convo').map((x) => x.text));
    await reveal(page, '[data-sb="closed"]');
    await page.hover('[data-sb="closed"]'); await sleep(200);
    const acts = await page.evaluate(() => { const e = document.querySelector('[data-sb="closed"] [data-action="reopen"]'); return e ? getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0 : false; });
    check('닫힌 세션: 마우스를 올리면 "판으로 열기"가 보인다', acts);
    await click(page, `[data-sb="extra"][data-ws="${k.api}"]`);
    // 보관함, 정리 대상 대화
    await click(page, '[data-action="archive-box"]'); await sleep(800);
    const arch = await page.evaluate(() => document.querySelectorAll('[data-role="archive-box"] [data-sb="archived"]').length);
    check('보관함: 펼치면 보관한 것이 보인다', arch >= 1, { arch });
    await click(page, '[data-action="archive-box"]');
    await click(page, '[data-action="missed-box"]'); await sleep(1000);
    const missed = await page.evaluate(() => ({ folders: document.querySelectorAll('[data-role="missed-box"] [data-folder]').length, n: (document.querySelector('[data-role="missed-box"] [data-count="missed"]') || {}).innerText }));
    check('정리 대상 대화: 펼치면 폴더별로 보인다', missed.folders >= 1, missed);
    await click(page, '[data-action="missed-box"]');
    // 가상 목록: 큰 판
    await fake(page, { big: 210 });
    const big = await rowsOf(page);
    check('가상 목록: 세션 220개 넘는 판에서 보이는 줄만 그린다', big.total > 220 && big.shown < 60, { total: big.total, shown: big.shown });
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) { await page.evaluate(() => { const l = document.querySelector('[data-role="sidebar-list"]'); l.scrollTop += 400; }); await sleep(16); }
    check('가상 목록: 내려 가며 그려도 줄이 겹치지 않는다', await page.evaluate(() => { const rs = [...document.querySelectorAll('.mt-sb2-slot')].map((e) => e.getBoundingClientRect()).sort((a, b) => a.top - b.top); return rs.every((r, i) => i === 0 || r.top >= rs[i - 1].bottom - 0.5); }), { ms: Date.now() - t0 });
    await shotSide(page, 'func-end');
  } catch (e) {
    check('예외', false, String(e && (e.stack || e.message)).slice(0, 800));
    await page.screenshot({ path: path.join(OUT, `${TAG}-func-error.png`) }).catch(() => {});
  } finally { await closeApp(app); }
}

async function clean() {
  try { for (const s of sessions()) { try { atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log('끄기 실패', s.name, e.message.slice(0, 160)); } } } catch (e) { log('목록 실패', e.message.slice(0, 160)); }
  try { log('herdr 멈춤', atrium('herdr', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { log('herdr 멈춤 실패', e.message.slice(0, 200)); }
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log('백엔드 멈춤 실패', e.message.slice(0, 200)); }
  for (const d of [F.hub, F.web, F.docs, F.api, F.lab, F.tools, F.infra]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { log('지우기 실패', d, e.message.slice(0, 120)); } }
}

try {
  if (STAGE === 'setup') await setup();
  else if (STAGE === 'shot') await shots();
  else if (STAGE === 'func') await func();
  else await clean();
} catch (e) { check('예외', false, String(e && (e.stack || e.message)).slice(0, 800)); }
const pass = results.filter((r) => r.ok).length;
log(`결과 ${pass}/${results.length}`);
fs.writeFileSync(path.join(OUT, `p103-${STAGE}-${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
process.exit(pass === results.length ? 0 : 1);
