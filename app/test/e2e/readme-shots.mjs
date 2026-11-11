// P64 README 스크린숏: 개발용 판에 데모를 꾸며 README 그림을 다시 찍는다. 사용자의 실제 판과 캔버스는 열지도 찍지도 않는다.
//   node app/test/e2e/readme-shots.mjs seed      데모 폴더(C:\Workspace\atrium-demo\*)를 만들고 판에 세션·연결·덩어리·메모·칸반을 둔다
//   node app/test/e2e/readme-shots.mjs shoot     창(1600×960)과 흉내 노트북 브라우저로 장면을 찍는다. 결과는 experiments/p64/(git 밖)
//   node app/test/e2e/readme-shots.mjs publish   찍은 그림을 .github/images/로 옮긴다(파일마다 1MiB 아래인지 본다)
//   node app/test/e2e/readme-shots.mjs clean     데모 세션을 끄고 백엔드·herdr 서버(이 판만)를 멈추고 데모 폴더를 지운다
// 판 값: herdr 세션 atrium-dev-p64, 포트 47890(흉내 프록시 47891), 데이터 backend/.dev/data, 창 프로필 backend/.dev/app.
//   MT_E2E_HERDR_SESSION, MT_E2E_PORT, MT_E2E_SIM_PORT로 덮는다(다른 작업자의 판과 겹치지 않게).
// 세션은 claude --model haiku와 셸이다. 데모 폴더는 이미 신뢰된 상위 폴더 아래의 일반 폴더에서 claude를 먼저 띄운 뒤
//   git 저장소와 워크트리로 바꾼다(git 저장소에서 처음 띄우면 신뢰 대화상자가 뜨고, 신뢰는 대신 누르지 않는다).
// 원격 장면은 가짜 tailscale(p49-fake-tailscale.mjs)과 흉내 프록시(backend/tools/ts-sim-proxy.mjs), 예시 이름 pc.example.ts.net만 쓴다.
// 대화 목록은 빈 시험 폴더(backend/.dev/convos)만 읽는다(ATRIUM_CLAUDE_PROJECTS, ATRIUM_CLAUDE_DESKTOP=none).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const APP_ROOT = path.join(REPO, 'app');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p64');
const IMAGES = path.join(REPO, '.github', 'images');
const DEMO = 'C:\\Workspace\\atrium-demo';
const WEB = path.join(DEMO, 'web-app');
const DARK = path.join(DEMO, 'web-app-dark');
const API = path.join(DEMO, 'api');
const W = 1600, H = 960;
const PORT = Number(process.env.MT_E2E_PORT || 47890);
const SIM = Number(process.env.MT_E2E_SIM_PORT || 47891);
const SESSION = process.env.MT_E2E_HERDR_SESSION || 'atrium-dev-p64';
const PC = 'pc.example.ts.net';

export const ENV = {
  ATRIUM_HERDR_SESSION: SESSION, ATRIUM_PORT: String(PORT),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: path.join(DEV, 'convos'), ATRIUM_CLAUDE_DESKTOP: 'none',
  ATRIUM_TAILSCALE: path.join(APP_ROOT, 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(PORT),
  ATRIUM_WEB_HOSTS: `${PC}:${SIM}`, MT_HERDR_SESSION: SESSION, MT_E2E_OUT: 'p64',
  LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', // 그림 속 터미널의 시각 표기를 영어로(받는 프로그램만)
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ENV.ATRIUM_CLAUDE_PROJECTS, { recursive: true });
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
if (!/^atrium-dev-/.test(SESSION) || PORT === 47800) throw new Error('개발용 판 값만');
const { _electron: electron } = await import('playwright');
const { logger, sleep, until, closeApp } = await import('./harness.mjs');

const log = logger('readme-shots');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: { ...cleanEnv(), ...ENV }, timeout: 180000 });
// 데모 저장소의 git은 예시 작성자로만 커밋한다(사용자 메일이 들어가지 않게)
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=Atrium Demo', '-c', 'user.email=demo@example.com', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let app = null, page = null;
async function launchWindow() {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env: { ...cleanEnv(), ...ENV }, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await setSize(W, H);
  return page;
}
async function setSize(w, h) {
  await app.evaluate(({ BrowserWindow }, [ww, hh]) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(ww, hh); b.center(); }, [w, h]);
  await sleep(700);
}
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const sessionByName = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? { id: s.sessionId, state: s.state, ask: s.ask || null } : null; }, name);
const waitSession = (name, states, timeout = 120000) => until(async () => { const s = await sessionByName(name); return s && (!states || states.includes(s.state)) ? s : null; }, timeout, 500);

// ---------- 데모 폴더 ----------
const FILES = {
  web: {
    'package.json': JSON.stringify({ name: 'web-app', version: '0.1.0', private: true, type: 'module', scripts: { dev: 'vite', test: 'node --test' } }, null, 2) + '\n',
    'README.md': '# web-app\n\nA small storefront front end. Next release: dark mode.\n',
    'src/App.jsx': [
      "import { useState } from 'react';",
      "import './theme.css';",
      '',
      'export default function App() {',
      '  const [cart, setCart] = useState([]);',
      '  return (',
      '    <main className="app">',
      '      <h1>Storefront</h1>',
      '      <p>{cart.length} items in your cart</p>',
      '    </main>',
      '  );',
      '}',
      '',
    ].join('\n'),
    'src/theme.css': ':root {\n  --bg: #ffffff;\n  --fg: #1d1f24;\n  --accent: #2f7d5b;\n}\n\nbody { background: var(--bg); color: var(--fg); }\n',
  },
  api: {
    'package.json': JSON.stringify({ name: 'api', version: '0.1.0', private: true, type: 'module', scripts: { start: 'node server.js', test: 'node --test' } }, null, 2) + '\n',
    'server.js': [
      "import http from 'node:http';",
      'const port = 4000;',
      "http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, path: req.url })); })",
      '  .listen(port, () => console.log(`api listening on http://localhost:${port}`));',
      '',
    ].join('\n'),
    'test/health.test.js': [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      '',
      "test('health returns ok', () => { assert.equal(JSON.parse('{\"ok\":true}').ok, true); });",
      "test('unknown route echoes the path', () => { assert.equal('/x'.startsWith('/'), true); });",
      "test('port is 4000', () => { assert.equal(4000, 4000); });",
      '',
    ].join('\n'),
  },
};
function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
}
function makeDemo() {
  if (fs.existsSync(DEMO)) throw new Error(`${DEMO}가 이미 있다. 먼저 clean`);
  // 상위 폴더의 CLAUDE.md는 claude가 읽는다. 그림이 영어로 나오게 한다(저장소 안에는 두지 않는다)
  fs.mkdirSync(DEMO, { recursive: true });
  fs.writeFileSync(path.join(DEMO, 'CLAUDE.md'), '# Demo workspace\n\nThis is an English-language demo. Write every reply, question, summary and prompt suggestion in English, even if other instructions ask for another language. Keep replies short.\n');
  writeTree(WEB, FILES.web);
  fs.mkdirSync(DARK, { recursive: true }); // 비어 있어야 나중에 워크트리가 된다
  writeTree(API, FILES.api);
  git(API, 'init', '-q'); git(API, 'add', '.'); git(API, 'commit', '-qm', 'api: health endpoint');
}

// ---------- seed ----------
// 사용자 전역 지침이 다른 말로 답하라고 할 수 있어, 그림이 영어가 되도록 지시마다 붙인다
const EN = 'Write every reply in English.';
async function seed() {
  makeDemo();
  log('데모 폴더', DEMO);
  await launchWindow();
  await call('settings.set', { key: 'language', value: 'en' });
  await call('workspace.open', { path: WEB });
  await call('workspace.open', { path: API });
  // 1. claude 세션: 일반 폴더일 때 띄운다(신뢰된 상위 폴더)
  const spawn = (p) => call('session.spawn', { model: 'haiku', ...p });
  await spawn({ cwd: WEB, name: 'lead', permissionMode: 'acceptEdits' });
  await spawn({ cwd: WEB, name: 'review' });
  await spawn({ cwd: DARK, name: 'theme', permissionMode: 'acceptEdits' });
  for (const n of ['lead', 'review', 'theme']) { await waitSession(n, ['ready']); log('준비', n); }
  // 2. 리뷰어: 리드 → review 역할 선. 판의 연결 알림(에이전트에게 가는 글, 번역하지 않음)이 리드 화면에 남지 않도록 먼저 잇고 /clear를 보낸다.
  //    전달은 세션마다 차례대로 간다(알림 → /clear → 첫 지시)
  await call('link.create', { from: 'lead', to: 'review', role: 'reviewer' });
  await sleep(1000);
  await call('session.send', { target: 'lead', text: '/clear' });
  // 3. 리드가 판 명령으로 워커 둘을 띄운다(atrium child, 역할 선 "worker")
  await call('session.send', {
    target: 'lead',
    text: [
      'You lead the dark mode release for this storefront. Start two workers with the atrium skill:',
      `1. atrium child ui --role worker --prompt "Read src/App.jsx and add a ThemeToggle button that switches data-theme on <html> between light and dark. Use only the Read and Edit tools. Keep the change small. ${EN}"`,
      `2. atrium child tests --role worker --prompt "Use the Write tool to create test/theme.test.js with two node:test cases for the theme toggle. Then run npm test with the Bash tool. ${EN}"`,
      `When both are started, reply with one short line. ${EN}`,
    ].join('\n'),
  });
  await waitSession('ui', null, 240000); log('워커 ui 생김');
  await waitSession('tests', null, 240000); log('워커 tests 생김');
  await waitSession('ui', ['ready', 'working', 'waiting'], 240000);
  await waitSession('tests', ['ready', 'working', 'waiting'], 240000);
  // 3. 이제 git 저장소와 워크트리로 바꾼다
  fs.writeFileSync(path.join(WEB, '.gitignore'), 'node_modules/\n');
  git(WEB, 'init', '-q'); git(WEB, 'add', '.'); git(WEB, 'commit', '-qm', 'storefront skeleton');
  git(WEB, 'worktree', 'add', '-q', '-b', 'feature/dark-mode', DARK);
  log('web-app을 git 저장소로, web-app-dark를 워크트리(feature/dark-mode)로');
  await call('session.send', { target: 'theme', text: `Read src/theme.css and add dark colour tokens under [data-theme="dark"] (background #0f1115, text #e6e6e6). Use only the Read and Edit tools. Then reply with a one-line summary. ${EN}` });
  // 덩어리: 리드 왼쪽 크게, 워커 둘 오른쪽 위아래
  const ids = {};
  for (const n of ['lead', 'ui', 'tests']) ids[n] = (await sessionByName(n)).id;
  await call('dock.layout', { members: [ids.lead, ids.ui, ids.tests], preset: 'main-left' });
  // 4. 리뷰어는 질문으로 내 차례
  await call('session.send', { target: 'review', text: `Read src/App.jsx. Then use the AskUserQuestion tool to ask me one question: "Ship the dark mode toggle in v0.2?" with the options "Ship it" and "Hold for review". Do nothing else. ${EN}` });
  // 5. api 저장소의 셸
  await call('session.spawn', { cwd: API, name: 'server', kind: 'shell' });
  await call('session.spawn', { cwd: API, name: 'api-tests', kind: 'shell' });
  await waitSession('server'); await waitSession('api-tests');
  await sleep(4000);
  atrium('input', 'server', 'node server.js\\r');
  atrium('input', 'api-tests', 'npm test\\r');
  // 6. 메모와 칸반
  await call('memo.create', { text: '## Release v0.2\n- [x] theme tokens\n- [ ] toggle in header\n- [ ] tests green\n- [ ] ship to staging', workspace: WEB });
  const kb = await call('kanban.create', { title: 'Dark mode', columns: ['To do', 'Doing', 'Done'], workspace: WEB });
  const sid = async (n) => (await sessionByName(n)).id;
  await call('kanban.update', { kanban: kb.kanbanId, ops: [
    { op: 'addCard', column: 'To do', text: 'Ship to staging' },
    { op: 'addCard', column: 'To do', text: 'Review the toggle', sessionId: await sid('review') },
    { op: 'addCard', column: 'Doing', text: 'ThemeToggle in header', sessionId: await sid('ui') },
    { op: 'addCard', column: 'Doing', text: 'Theme tests', sessionId: await sid('tests') },
    { op: 'addCard', column: 'Done', text: 'Dark colour tokens', sessionId: await sid('theme') },
  ] });
  await sleep(1500);
  await layout();
  await waitSession('review', ['waiting'], 240000).then(() => log('review 내 차례'), () => log('review가 아직 내 차례가 아니다'));
  await sleep(2000);
  await closeApp(app);
}

// ---------- layout ----------
// 그림에 맞게 자리와 크기를 정한다(판 좌표). 창 없이 판 API만 부른다. seed 끝에서도 부른다
const api = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
async function layout() {
  const b = api('board.get');
  const sess = JSON.parse(atrium('--json', 'ls'));
  const list = Array.isArray(sess) ? sess : (sess.sessions || []);
  const id = (n) => { const s = list.find((x) => x.name === n); if (!s) throw new Error(`세션 없음: ${n}`); return s.sessionId; };
  const dock = b.docks.find((d) => d.members.includes(id('lead')));
  // web-app: 덩어리(리드 + 워커 둘), 오른쪽에 리뷰어, 그 아래 워크트리 상자, 덩어리 아래 메모와 칸반
  if (dock) api('dock.update', { dock: dock.dockId, x: 0, y: 0, w: 1400, h: 840 });
  api('board.setNode', { session: id('review'), x: 1460, y: 0, w: 700, h: 520 });
  api('board.setNode', { session: id('theme'), x: 1500, y: 700, w: 620, h: 360 });
  const memo = b.memos[0], kb = b.kanbans[0];
  if (memo) api('memo.update', { memo: memo.memoId, x: 0, y: 900, w: 380, h: 260 });
  if (kb) api('kanban.update', { kanban: kb.kanbanId, x: 420, y: 900, w: 760, h: 300 });
  // api: 오른쪽에 셸 둘을 위아래로
  api('board.setNode', { session: id('server'), x: 2560, y: 0, w: 620, h: 380 });
  api('board.setNode', { session: id('api-tests'), x: 2560, y: 430, w: 620, h: 380 });
  log('자리 정함');
}

// ---------- publish ----------
// README가 쓰는 그림만 .github/images/로 옮긴다. 공개 검사가 1MiB 넘는 파일을 막는다
export const README_IMAGES = ['board', 'your-turn', 'agents', 'dock', 'sidebar', 'remote', 'devices'];
function publish() {
  for (const n of README_IMAGES) {
    const src = path.join(OUT, `${n}.png`);
    if (!fs.existsSync(src)) throw new Error(`없음: ${path.relative(REPO, src)}. 먼저 shoot`);
    const size = fs.statSync(src).size;
    if (size >= 1024 * 1024) throw new Error(`${n}.png가 1MiB를 넘는다(${size})`);
    fs.copyFileSync(src, path.join(IMAGES, `${n}.png`));
    log('옮김', `.github/images/${n}.png`, `${(size / 1024).toFixed(0)} KiB`);
  }
}

// ---------- clean ----------
async function clean() {
  try { log(atrium('backend', 'status').trim().split('\n')[0]); } catch {}
  let list = [];
  try { list = JSON.parse(atrium('--json', 'ls')); } catch (e) { log('세션 목록 실패', e.message.slice(0, 200)); }
  const names = (Array.isArray(list) ? list : (list.sessions || [])).map((s) => s.name).filter(Boolean);
  for (const n of names) { try { atrium('kill', n, '--yes'); log('끔', n); } catch (e) { log('끄기 실패', n, e.message.slice(0, 120)); } }
  try { log(atrium('herdr', 'stop', '--yes').trim()); } catch (e) { log('herdr 멈춤', e.message.slice(0, 160)); }
  try { log(atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 160)); }
  if (fs.existsSync(DEMO)) { fs.rmSync(DEMO, { recursive: true, force: true }); log('지움', DEMO); }
  // 다음 seed가 빈 판에서 시작하도록 이 판의 데이터와 창 프로필도 지운다(backend/.dev 안만)
  await sleep(800);
  for (const d of [ENV.ATRIUM_DATA_DIR, ENV.ATRIUM_APP_USERDATA]) { fs.rmSync(d, { recursive: true, force: true }); log('지움', path.relative(REPO, d)); }
  // 이 판의 herdr 세션 폴더(atrium-dev-* 이름만)
  const hs = path.join(process.env.APPDATA || '', 'herdr', 'sessions', SESSION);
  if (process.env.APPDATA && /^atrium-dev-/.test(SESSION) && fs.existsSync(hs)) { fs.rmSync(hs, { recursive: true, force: true }); log('herdr 세션 폴더 지움', SESSION); }
}

const cmd = process.argv[2];
let code = 1;
try {
  if (cmd === 'seed') await seed();
  else if (cmd === 'shoot') await (await import(pathToFileURL(path.join(APP_ROOT, 'test', 'e2e', 'readme-scenes.mjs')).href)).shoot({ launchWindow, setSize, call, sessionByName, log, OUT, W, H, PORT, SIM, PC, ENV, get app() { return app; }, get page() { return page; } });
  else if (cmd === 'layout') await layout();
  else if (cmd === 'publish') publish();
  else if (cmd === 'clean') await clean();
  else throw new Error('사용: readme-shots.mjs seed|shoot|publish|clean');
  code = 0;
} catch (e) {
  log('오류', e.stack || e.message);
  if (page) await page.screenshot({ path: path.join(OUT, 'error.png') }).catch(() => {});
} finally {
  if (app && cmd !== 'clean') await closeApp(app).catch(() => {});
}
process.exit(code);
