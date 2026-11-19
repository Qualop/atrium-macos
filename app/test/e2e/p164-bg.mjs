// P164 창 시험: 쉬는 Claude Code 세션에 뒤 일(뒤 셸·뒤 하위 에이전트)이 돌면 세션 맵(PC) 카드에 "백그라운드 n"이 보이고, 끝나면 사라지는지.
// 판: 따로 띄운 개발용 판(atrium-dev-p164, 47933, backend/.dev)만 쓴다. 창 원격 디버깅 포트 9413. 한 번에 한 창·브라우저만(메모리).
//   시험 폴더 C:\Workspace\mtask-p164-a(git 아님)에 haiku Claude Code 세션 p164-a 하나. 폴더의 .claude/settings.local.json이 sleep만 허락한다.
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p164-bg.mjs <setup|ask|pc|wait|stop> [shell|agent] [tag]
//   ask shell|agent: 뒤 셸(sleep) 또는 뒤 하위 에이전트를 시키고, 턴이 끝나 ready이고 요약에 뒤 일이 보일 때까지 기다린다.
//   pc <tag>: 세션 맵을 열어 카드 표시·미리 보기를 재고 그림을 남긴다(tag: during | after). 움직임 줄이기(reduce).
//   wait: 요약의 뒤 일이 사라질 때까지 기다린다.
//   휴대폰 세션 맵은 P166(무한 캔버스로 바뀜)이 맡아 이 시험에 없다.
// 결과는 워크트리의 experiments/p164/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const ARG = process.argv[3] || 'shell';
const TAG = process.argv[4] || ARG;
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p164');
const CONVOS = path.join(REPO, 'experiments', 'p164', 'convos');
const DIR = 'C:\\Workspace\\mtask-p164-a';
const NAME_S = 'p164-a';
const BOARD = 'atrium-dev-p164', PORT = '47933', DEBUG = '9413', SIM = 47998;
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k];
process.env.MT_E2E_OUT = path.relative(path.join(REPO, 'experiments'), OUT);
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A } = L;
const ENV = {
  ATRIUM_TERMINAL_SESSION: BOARD, ATRIUM_HERDR_SESSION: BOARD, ATRIUM_PORT: PORT,
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p164-none-',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: PORT,
  ATRIUM_WEB_HOSTS: `${NAME}:${SIM},localhost:${SIM}`,
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const chromeExe = (() => { const d = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'); try { return fs.readdirSync(d).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse().map((x) => path.join(d, x, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
const log = logger(`p164-${WHAT}-${TAG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [], facts = {};
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const AWAKE = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
const mine = () => call('session.list').find((s) => s.name === NAME_S) || null;
const shot = (pg, name) => pg.screenshot({ path: path.join(OUT, `${name}.png`) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));

async function setupBoard() {
  fs.mkdirSync(path.join(DIR, '.claude'), { recursive: true });
  // 뒤 셸(sleep)과 하위 에이전트의 기다림(ping)만 묻지 않고 돌린다
  fs.writeFileSync(path.join(DIR, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(sleep:*)', 'Bash(sleep *)', 'Bash(ping:*)', 'Bash(ping *)'] } }, null, 2));
  log(atrium('backend', 'start').trim().slice(0, 300));
  call('settings.set', { key: 'sleepAfterMin', value: 0 }); call('settings.set', { key: 'sessionSleepAfterMin', value: 0 }); // 시험 중 잠재우지 않는다
  call('settings.set', { key: 'missionStyle', value: 'territories' });
  if (!mine()) log(atrium('--json', 'spawn', DIR, '--kind', 'claude', '--model', 'haiku', '--name', NAME_S).slice(0, 200));
  for (let i = 0; i < 60; i++) { const s = mine(); if (s && s.state === 'ready') break; if (s && s.state === 'trust_wait') { fs.writeFileSync(path.join(DEV, 'p164-need-trust.txt'), `${DIR} 신뢰 질문(개발용 판 ${BOARD})\n`); check('신뢰 질문이 떠서 기다린다', false, s.state); return; } await sleep(2000); }
  const s = mine();
  check('haiku 세션이 준비됨', s && s.state === 'ready', s && s.state);
}

const PROMPT = {
  shell: 'Use the Bash tool with run_in_background set to true to run exactly: sleep 150 . Do not wait for it or check on it. Right after starting it, reply with the single word started and end your turn.',
  agent: 'Use the Agent tool with run_in_background set to true to start one general-purpose subagent with the task: "Run the Bash command ping -n 120 127.0.0.1 (not in background), then reply done." Do not wait for it. Right after starting it, reply with the single word started and end your turn.',
};
async function ask() {
  atrium('send', `@${NAME_S}`, PROMPT[ARG]);
  const t0 = Date.now();
  let s = null;
  for (let i = 0; i < 90; i++) {
    await sleep(2000); s = mine();
    if (s && s.state === 'ready' && s.background && s.background.n && Date.now() - t0 > 4000) break;
  }
  facts.summary = s && { state: s.state, background: s.background };
  check(`뒤 ${ARG}: 턴이 끝나 ready이고 요약에 뒤 일이 보인다`, s && s.state === 'ready' && s.background && s.background.n >= 1 && s.background.kinds.includes(ARG === 'shell' ? 'shell' : 'agent'), facts.summary);
  const g = call('mission.graph');
  const n = g.nodes.find((x) => x.name === NAME_S);
  facts.graph = n && n.background;
  check('그래프 노드에 같은 필드', n && n.background && n.background.n === s.background.n, facts.graph);
}

async function waitClear() {
  const t0 = Date.now();
  let s = null;
  for (let i = 0; i < 150; i++) { s = mine(); if (s && s.state !== 'working' && !s.background) break; await sleep(2000); }
  facts.summary = s && { state: s.state, background: s.background, waitedS: Math.round((Date.now() - t0) / 1000) };
  check('뒤 일이 끝나면 요약에서 사라진다', s && !s.background, facts.summary);
}

async function closeMission(pg) { for (let i = 0; i < 3 && (await pg.$('[data-role="mission"]')); i++) { await pg.keyboard.press('Escape'); await sleep(400); } }
async function openMission(pg) {
  await closeMission(pg);
  await pg.click('[data-action="mission-rail"]');
  await pg.waitForSelector('[data-role="mission"] .mt-ta-card', { timeout: 20000 });
  await sleep(1500);
}
const DURING = () => TAG.startsWith('during');

async function pc() {
  const { app, page } = await launch({ log, env: { ...ENV }, args: [`--remote-debugging-port=${DEBUG}`, ...AWAKE] });
  try {
    await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x)); const b = w.getBounds(); w.setPosition(left - b.width - 200, 40); }).catch(() => {});
    await page.setViewportSize({ width: 1584, height: 921 }).catch(() => {});
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sleep(2500);
    if (await page.$('[data-role="sidebar"]')) { await page.click('[data-action="sidebar"]'); await sleep(500); }
    await openMission(page);
    await page.evaluate(() => window.__mtTa.flyTo && window.__mtTa.flyTo([...window.__mtTa.lay().cards.keys()][0], 0.9)); await sleep(900);
    const card = await page.evaluate((nm) => {
      const c = document.querySelector(`.mt-ta-card[data-name="${nm}"]`);
      if (!c) return null;
      const b = c.querySelector('[data-role=ta-bg]'), tile = c.querySelector('[data-role=ta-bg-tile]');
      return { tier: c.dataset.tier, state: (c.querySelector('[data-role=ta-state]') || {}).textContent, badge: b ? { text: b.textContent, n: b.dataset.bgN, kinds: b.dataset.bgKinds, title: b.title, anim: getComputedStyle(b).animationName } : null, tile: !!tile, thin: c.closest('.mt-ta-slot').dataset.thin || null, light: !!c.querySelector('[data-role=ta-light]') };
    }, NAME_S);
    facts.pcCard = card;
    await shot(page, `pc-${TAG}`);
    if (DURING()) {
      check(`PC: 쉬는 카드에 "백그라운드 n" 표시(${ARG})`, card && card.tier !== 'work' && card.badge && /Background|백그라운드/.test(card.badge.text) && card.badge.anim === 'none' && !card.light, card);
      const r = await page.evaluate((nm) => { const el = document.querySelector(`.mt-ta-card[data-name="${nm}"]`); const x = el.getBoundingClientRect(); return { x: x.left + x.width / 2, y: x.top + x.height / 2 }; }, NAME_S);
      await page.mouse.move(r.x, r.y); await sleep(1500);
      const pk = await page.evaluate(() => { const p = document.querySelector('[data-role=ln-peek-bg]'); return p ? p.innerText : null; });
      facts.pcPeek = pk;
      await shot(page, `pc-${TAG}-peek`);
      check('PC: 미리 보기에 뒤 일 목록(종류와 한 줄)', !!pk && (ARG === 'shell' ? /sleep 150|Shell|셸/.test(pk) : /Agent|에이전트/.test(pk)), pk);
      // 멀리 보기 타일에도 작은 표시
      await page.evaluate(() => window.__mtTa.set({ ...window.__mtTa.view(), k: 0.3 })); await sleep(800);
      const tile = await page.evaluate((nm) => { const t = document.querySelector(`.mt-ta-card[data-name="${nm}"] [data-role=ta-bg-tile]`); return t ? { text: t.textContent, w: t.getBoundingClientRect().width } : null; }, NAME_S);
      await shot(page, `pc-${TAG}-far`);
      check('PC: 멀리 보기 타일에도 표시', !!tile && tile.w > 0, tile);
    } else {
      check('PC: 뒤 일이 끝나면 표시가 사라진다', card && !card.badge && !card.tile, card);
    }
  } finally { await closeApp(app); }
}

async function stopBoard() {
  for (const s of call('session.list').filter((x) => /^p164-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
  await sleep(2000);
  try { log(atrium('terminal', 'stop', '--yes').slice(0, 200)); } catch (e) { log(`terminal stop ${e.message.slice(0, 120)}`); }
  try { log(atrium('backend', 'stop').slice(0, 200)); } catch (e) { log(`backend stop ${e.message.slice(0, 120)}`); }
}

try {
  if (WHAT === 'setup') await setupBoard();
  else if (WHAT === 'ask') await ask();
  else if (WHAT === 'wait') await waitClear();
  else if (WHAT === 'pc') await pc();
  else if (WHAT === 'stop') await stopBoard();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, `p164-${WHAT}-${TAG}.json`), JSON.stringify({ results, facts }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
