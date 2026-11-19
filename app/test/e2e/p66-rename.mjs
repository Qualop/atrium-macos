// P66 창 시험: 세션 이름 바꾸기. P66 판(atrium-dev-p66, 47893, 이 워크트리의 backend/.dev, experiments/p66/tools/env.cjs)에서만 띄운다.
// 노드에서 두 번 눌러 바꾸기, 겹치는 이름의 이유, 사이드바 메뉴, F2, CLI(atrium rename, --clear), 다른 화면(atrium watch)이 곧바로 받음,
// @새 이름·옛 주소로 보내기, 백엔드를 다시 켠 뒤에도 남음, atrium child로 띄운 하위 세션의 이름을 바꿔도 부모가 옛 주소(herdr 이름)로 일을 시킴.
// 실행: MT_E2E_OUT=p66 node app/test/e2e/p66-rename.mjs   결과는 experiments/p66/(git 밖)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';
import { hcStateDir } from '../../../backend/src/hc/core.mjs'; // P129: 이 판의 hc 상태 폴더

if (process.env.MT_E2E_OUT !== 'p66') throw new Error('MT_E2E_OUT=p66를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p66', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P66_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p66' || ENV.ATRIUM_PORT !== '47893') throw new Error('P66 판(atrium-dev-p66, 47893)만');
if (!/^C:\\Workspace\\mtask-p66-/.test(T.DIR)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p66-*만: ${T.DIR}`);

const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...T.P66_ENV };
const ATRIUM = path.join(REPO, 'backend', 'bin', 'atrium.mjs');
const atrium = (...a) => execFileSync(process.execPath, [ATRIUM, '--dev', ...a], { encoding: 'utf8', env, timeout: 180000 });
const SKIP_CHILD = process.argv.includes('--no-child');

const log = logger('p66-rename');
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
let app, page;
const shot = async (name) => { const f = path.join(OUT, `p66-${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
// 창의 세션(보이는 이름이나 주소로)
const sess = (ref) => page.evaluate((r) => [...window.__mt.getState().sessions.values()].map((s) => ({ id: s.sessionId, name: s.name, address: s.address, label: s.label, state: s.state, lastAnswer: s.lastAnswer, parent: s.parentSessionId })).find((s) => s.name === r || s.address === r) || null, ref);
const nodeSel = (id) => `.mt-node[data-session="${id}"]`;

async function launch() {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(800);
}
async function goNode(id) {
  await page.evaluate((i) => window.__mt.getState().navigateTo(i, { viewOnly: true }), id);
  await sleep(1300);
}
async function typeInto(sel, text) {
  const el = page.locator(sel);
  await el.waitFor({ timeout: 5000 });
  await el.fill(text);
}
// 다른 화면: atrium watch --json을 띄워 이름이 바뀐 세션 요약을 받는지 본다
function watcher(seconds) {
  const p = spawn(process.execPath, [ATRIUM, '--dev', '--json', 'watch', '--seconds', String(seconds)], { env });
  const lines = [];
  let buf = '';
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { lines.push(JSON.parse(l)); } catch { /* 구독 머리 글 */ } } });
  return { lines, pid: p.pid, done: new Promise((r) => p.on('exit', r)), kill: () => { try { p.kill(); } catch {} } };
}
async function answerIfWaiting(name) {
  const s = await sess(name);
  if (s && s.state === 'waiting') { log(`${name} 승인 대기 → 1번`); try { log(atrium('answer', s.address || s.name, '1').trim().slice(0, 200)); } catch (e) { log('답하기 실패', e.message.slice(0, 200)); } }
}

try {
  // ---------- 준비: 새 판, 시험 폴더, 셸 s1과 Claude Code(haiku) s2 ----------
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
  await sleep(800);
  // 터미널 서버는 멈춘 세션의 패널을 다음에 되살릴 수 있다. 이 판의 세션(atrium-dev-p66) 상태 폴더만 지운다
  try { const d = hcStateDir(ENV.ATRIUM_HERDR_SESSION); fs.rmSync(d, { recursive: true, force: true }); log('hc 상태 지움', d); } catch (e) { log('hc 상태 지움', String(e.message).slice(0, 160)); }
  for (const d of [path.join(T.DEV, 'data'), path.join(T.DEV, 'app'), T.PROJECTS, T.SESSIONS]) fs.rmSync(d, { recursive: true, force: true });
  for (const d of [T.PROJECTS, T.SESSIONS, T.DIR]) fs.mkdirSync(d, { recursive: true });
  await launch();
  await call('settings.set', { language: 'ko' });
  await call('workspace.open', { path: T.DIR });
  log(atrium('spawn', T.DIR, '--name', 's1', '--kind', 'shell').trim().split(/\r?\n/).slice(-1)[0]);
  log(atrium('spawn', T.DIR, '--name', 's2', '--model', 'haiku').trim().split(/\r?\n/).slice(-1)[0]);
  const s1 = await until(() => sess('s1'), 30000);
  const s2 = await until(() => sess('s2'), 30000);
  await until(async () => { const s = await sess('s2'); return s && ['ready', 'idle'].includes(s.state); }, 120000);
  step('준비: 셸 s1, haiku s2', !!(s1 && s2));

  // ---------- 1. 노드 이름을 두 번 눌러 바꾸기 ----------
  await goNode(s2.id);
  await page.locator(`${nodeSel(s2.id)} [data-role="node-name"]`).dblclick();
  await typeInto(`${nodeSel(s2.id)} [data-role="rename-input"]`, 'reviewer');
  await shot('1-node-typing');
  await page.keyboard.press('Enter');
  await until(async () => { const s = await sess('s2'); return s && s.name === 'reviewer'; }, 8000).catch(() => null);
  let a = await sess('s2');
  const addrText = await page.locator(`${nodeSel(s2.id)} [data-role="node-address"]`).textContent().catch(() => null);
  step('1 노드 두 번 누르기: 보이는 이름 reviewer, 주소 s2, 머리에 주소', a && a.name === 'reviewer' && a.address === 's2' && a.label === 'reviewer' && addrText === 's2', { a, addrText });
  await shot('1-node-renamed');

  // 겹치는 이름: s1을 reviewer로 → 이유를 보이고 칸을 닫지 않는다
  await goNode(s1.id);
  await page.locator(`${nodeSel(s1.id)} [data-role="node-name"]`).dblclick();
  await typeInto(`${nodeSel(s1.id)} [data-role="rename-input"]`, 'REVIEWER');
  await page.keyboard.press('Enter');
  const err = await page.locator(`${nodeSel(s1.id)} [data-role="rename-error"]`).textContent({ timeout: 5000 }).catch(() => null);
  await shot('1b-taken');
  step('1b 겹치는 이름은 이유를 보인다(대소문자 무시)', !!err && err.includes('reviewer'), { err });
  await typeInto(`${nodeSel(s1.id)} [data-role="rename-input"]`, '셸');
  await page.keyboard.press('Enter');
  const err2 = await page.locator(`${nodeSel(s1.id)} [data-role="rename-error"]`).textContent({ timeout: 5000 }).catch(() => null);
  step('1c @로 부를 수 없는 글자는 이유를 보인다', !!err2 && /영문/.test(err2), { err2 });
  await page.keyboard.press('Escape');
  await sleep(400);
  step('1d Esc로 그만두면 그대로', (await sess('s1')).name === 's1' && !(await page.locator(`${nodeSel(s1.id)} [data-role="rename-input"]`).count()));

  // ---------- 2. 사이드바 줄 메뉴 ----------
  if (!(await page.locator('[data-sb="session"]').count())) { await page.locator('button[data-action="sidebar"]').first().click(); await sleep(800); } // 사이드바는 처음에 닫혀 있다
  const row = page.locator(`[data-sb="session"][data-session="${s1.id}"]`);
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.hover();
  await row.locator('[data-action="session-menu"]').click();
  await shot('2-sidebar-menu');
  await page.locator('[data-action="menu-rename-session"]').click();
  await typeInto(`[data-sb="session"][data-session="${s1.id}"] [data-role="rename-input"]`, 'shell-a');
  await page.keyboard.press('Enter');
  await until(async () => (await sess('s1')).name === 'shell-a', 8000).catch(() => null);
  a = await sess('s1');
  const rowName = await page.locator(`[data-sb="session"][data-session="${s1.id}"] .mt-sb2-name`).textContent().catch(() => null);
  step('2 사이드바 메뉴로 바꾸기: shell-a, 사이드바 줄도 새 이름', a.name === 'shell-a' && a.address === 's1' && rowName === 'shell-a', { a, rowName });
  await shot('2-sidebar-renamed');

  // ---------- 3. F2(고른 노드) + 다른 화면이 곧바로 받음 ----------
  const w = watcher(25);
  await sleep(1500);
  await goNode(s1.id);
  await page.locator(`${nodeSel(s1.id)} .mt-node-head`).click({ position: { x: 300, y: 10 } });
  await sleep(500);
  const selected = await page.evaluate(() => window.__mt.getState().selected);
  await page.keyboard.press('F2');
  await typeInto(`${nodeSel(s1.id)} [data-role="rename-input"]`, 'shellb');
  await shot('3-f2-typing');
  await page.keyboard.press('Enter');
  const t0 = Date.now();
  await until(async () => (await sess('s1')).name === 'shellb', 8000).catch(() => null);
  const seen = await until(() => w.lines.find((l) => l.ev === 'session.updated' && l.d.sessionId === s1.id && l.d.name === 'shellb'), 8000).catch(() => null);
  step('3 F2로 고른 노드 바꾸기', (await sess('s1')).name === 'shellb', { selected });
  step('3b 다른 화면(atrium watch)이 곧바로 받음', !!seen, seen ? { ms: seen.t - t0, address: seen.d.address } : null);

  // ---------- 4. CLI: 옛 주소로 바꾸고, 새 이름으로 되돌리기(--clear) ----------
  const r4 = atrium('rename', 's2', 'critic').trim();
  await until(async () => (await sess('s2')).name === 'critic', 8000).catch(() => null);
  const seen4 = w.lines.find((l) => l.ev === 'session.updated' && l.d.sessionId === s2.id && l.d.name === 'critic');
  step('4 CLI atrium rename s2 critic: 창이 곧바로 받음', (await sess('s2')).name === 'critic' && !!seen4, r4);
  let bad = '';
  try { atrium('rename', 'critic', 'shellb'); } catch (e) { bad = String(e.stderr || e.message); }
  step('4b CLI 겹침은 이유와 함께 실패', /사용 중/.test(bad), bad.trim().slice(0, 160));
  const r4c = atrium('rename', 'shellb', '--clear').trim();
  await until(async () => (await sess('s1')).name === 's1', 8000).catch(() => null);
  step('4c CLI --clear: 원래 이름 s1', (await sess('s1')).name === 's1' && (await sess('s1')).label === null, r4c);
  atrium('rename', 's1', 'shellb');
  const ls = atrium('ls');
  fs.writeFileSync(path.join(OUT, 'p66-ls.txt'), ls);
  step('4d atrium ls: 새 이름과 주소', /critic \(주소 s2\)/.test(ls) && /shellb \(주소 s1\)/.test(ls), ls.split(/\r?\n/).filter((l) => /critic|shellb/.test(l)).join(' | '));
  const ev = JSON.parse(atrium('--json', 'events', 's2', '--limit', '40')).filter((e) => e.kind === 'renamed').map((e) => e.data);
  step('4e 판 이벤트 renamed(누가: human, cli)', ev.some((d) => d.by === 'human' && d.to === 'reviewer') && ev.some((d) => d.by === 'cli' && d.to === 'critic'), ev);
  w.kill();

  // ---------- 5. @새 이름과 옛 주소로 보내기 ----------
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true));
  const ta = page.locator('textarea.mt-cmd-input').first();
  await ta.click();
  await ta.fill('@crit');
  await sleep(400);
  const menu = await page.locator('.mt-mention-item').allTextContents();
  await ta.fill('@critic Reply with only the word PONG');
  await shot('5-command-bar');
  await page.keyboard.press('Enter');
  const pong = await until(async () => { const s = await sess('critic'); return s && /PONG/.test(s.lastAnswer || '') ? s : null; }, 120000).catch(() => null);
  step('5 명령 바 @critic으로 보내기', !!pong, { menu, answer: pong && pong.lastAnswer });
  const old = atrium('send', '@s2', 'Reply with only the word OLDADDR', '--wait', '--timeout', '120');
  const oldOk = await until(async () => { const s = await sess('critic'); return s && /OLDADDR/.test(s.lastAnswer || '') ? s : null; }, 120000).catch(() => null);
  step('5b CLI atrium send @s2(옛 주소)', !!oldOk, old.trim().split(/\r?\n/).slice(0, 2).join(' | '));
  const dl = JSON.parse(atrium('--json', 'deliveries', 'critic'));
  step('5c 요청 기록에는 보이는 이름', dl.length >= 2 && dl.every((d) => d.name === 'critic'), dl.map((d) => d.name));
  await shot('5-sent');

  // ---------- 6. 백엔드를 다시 켠 뒤에도 남는다 ----------
  log('백엔드 멈춤', atrium('backend', 'stop').trim());
  await sleep(3000);
  await page.waitForFunction(() => { const st = window.__mt.getState(); return st.conn === 'open' || st.conn === 'connected'; }, null, { timeout: 60000 }).catch(() => null);
  const back = await until(async () => { const x = await sess('critic'); const y = await sess('shellb'); return x && y ? { x, y } : null; }, 60000).catch(() => null);
  step('6 백엔드를 다시 켠 뒤: critic, shellb 그대로', !!back && back.x.address === 's2' && back.y.address === 's1', back);
  await goNode(s2.id);
  await shot('6-after-restart');
  const rp = atrium('send', '@critic', 'Reply with only the word AFTER', '--wait', '--timeout', '120');
  const after = await until(async () => { const s = await sess('critic'); return s && /AFTER/.test(s.lastAnswer || '') ? s : null; }, 120000).catch(() => null);
  step('6b 다시 켠 뒤 @critic으로 보내기', !!after, rp.trim().split(/\r?\n/)[0]);

  // ---------- 7. atrium child로 띄운 하위 세션: 이름을 바꿔도 부모가 옛 주소로 시킨다 ----------
  if (!SKIP_CHILD) {
    log(atrium('spawn', T.DIR, '--name', 'lead', '--model', 'haiku', '--allow-herdr').trim().split(/\r?\n/).slice(-1)[0]);
    const lead = await until(() => sess('lead'), 30000);
    await until(async () => { const s = await sess('lead'); return s && ['ready', 'idle'].includes(s.state); }, 120000);
    atrium('send', '@lead', 'Run exactly this one shell command and nothing else: atrium child kid --role helper --prompt "Reply with only the word READY"   When it has finished, reply with only the word SPAWNED.');
    const kid = await until(async () => { await answerIfWaiting('lead'); const s = await sess('kid'); return s && s.parent === lead.id ? s : null; }, 240000).catch(() => null);
    step('7 lead가 atrium child로 kid를 띄움', !!kid, kid);
    if (kid) {
      await until(async () => { const s = await sess('kid'); return s && /READY/.test(s.lastAnswer || '') ? s : null; }, 180000).catch(() => null);
      await until(async () => { await answerIfWaiting('lead'); const s = await sess('lead'); return s && /SPAWNED/.test(s.lastAnswer || '') ? s : null; }, 180000).catch(() => null);
      atrium('rename', 'kid', 'helper');
      await until(async () => (await sess('kid')).name === 'helper', 8000).catch(() => null);
      step('7b 하위 세션 이름 바꾸기 kid → helper', (await sess('kid')).name === 'helper');
      atrium('send', '@lead', 'Run exactly this one shell command and nothing else: herdr agent prompt kid "Reply with only the word BANANA"   Then reply with only the word SENT.');
      const banana = await until(async () => { await answerIfWaiting('lead'); const s = await sess('kid'); return s && /BANANA/.test(s.lastAnswer || '') ? s : null; }, 240000).catch(() => null);
      step('7c 부모가 옛 주소(herdr agent prompt kid)로 일을 시킴', !!banana, banana && { name: banana.name, address: banana.address, answer: banana.lastAnswer });
      const links = JSON.parse(atrium('--json', 'links'));
      const l = links.find((x) => x.from === lead.id && x.to === kid.id);
      step('7d 연결 기록: lead → helper(보이는 이름)', !!l && l.toName === 'helper', l && { toName: l.toName, toAgentName: l.toAgentName, lastText: l.lastText });
      await goNode(kid.id);
      await shot('7-child-renamed');
      const tree = atrium('tree');
      fs.writeFileSync(path.join(OUT, 'p66-tree.txt'), tree);
    }
  }
} catch (e) {
  log('오류', e.stack || e.message);
  step('시험 중 오류 없음', false, e.message);
  try { await shot('error'); } catch {}
} finally {
  fs.writeFileSync(path.join(OUT, 'p66-results.json'), JSON.stringify(results, null, 2));
  const badN = results.filter((r) => !r.ok);
  log(`결과 ${results.length - badN.length}/${results.length}`);
  if (badN.length) log('실패', badN.map((r) => r.name));
  if (!process.argv.includes('--keep')) { if (app) await closeApp(app); }
  process.exit(badN.length ? 1 : 0);
}
