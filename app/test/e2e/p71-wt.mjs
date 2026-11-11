// P71 창 시험: `claude -w`(haiku) 워크트리 세션의 나가기 질문, 판에서 닫을 때의 남기기·지우기, 사이드바 메뉴 단추, 창 제목, 업데이트 묶음.
// 판: herdr 세션 atrium-dev-p71, 포트 47891, 이 워크트리의 backend/.dev(experiments/p71/tools/env.cjs). 설치 폴더도 시험 폴더(ATRIUM_INSTALL_DIR)다.
// 시험 저장소는 새로 만든 git 저장소라 신뢰를 받지 않았다. 워커 w1은 신뢰 관문(P36)에서 멈추고, 사람이 판의 @w1 노드에서 신뢰 질문에 답하면 claude -w로 다시 뜬다.
// 신뢰는 시험이 대신 답하지 않는다(CLAUDE.md). 리드는 git이 아닌 시험 폴더에서 띄운다(신뢰 질문 없음).
// MT_P71_STAGE=before: 고치기 전 코드로 띄운 판. 워커 셋(w1~w3)을 워크트리에 띄워 커밋 하나씩 만들게 하고, 전 스크린숏을 찍고, w1에 /exit를 보내 질문을 띄운 채 둔다.
// MT_P71_STAGE=after: 고친 코드로 다시 띄운 판. w1의 승인 줄(워크트리를 남길까요?)에서 지우기, w2를 X로 닫아 남기기, w3를 X로 닫으며 지우기, 후 스크린숏.
// 사용: node experiments/p71/tools/e2e.cjs p71-wt.mjs (before|after)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p71') throw new Error('MT_E2E_OUT=p71를 명령줄에서 준다');
const STAGE = process.env.MT_P71_STAGE;
if (!['before', 'after'].includes(STAGE)) throw new Error('MT_P71_STAGE=before|after');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p71', 'tools', 'env.cjs'));
const ENV = T.P71_ENV;
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p71' || ENV.ATRIUM_PORT !== '47891') throw new Error('P71 판(atrium-dev-p71, 47891)만');
for (const d of [T.REPO, T.LEAD]) if (!/^C:\\Workspace\\mtask-p71-/.test(d)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p71-*만: ${d}`);
fs.mkdirSync(OUT, { recursive: true });

const log = logger(`p71-wt-${STAGE}`);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE|ATRIUM_|MTASK_|HERDR_)/.test(k)));
const env = { ...cleanEnv(), ...ENV };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const GIT_ID = ['-c', 'user.name=p71', '-c', 'user.email=p71@example.invalid'];
const git = (...a) => execFileSync('git', ['-C', T.REPO, ...a], { encoding: 'utf8', timeout: 30000 }).trim();
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const WORKERS = ['w1', 'w2', 'w3'];
const wtDir = (n) => path.join(T.REPO, '.claude', 'worktrees', n);
const branchExists = (n) => { try { git('rev-parse', '--verify', '--quiet', `refs/heads/worktree-${n}`); return true; } catch { return false; } };
const commitsOn = (n) => { try { return Number(git('rev-list', '--count', `main..worktree-${n}`)); } catch { return -1; } };
async function until(fn, ms, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(every); } }

let app = null, page = null;
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const sess = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? { id: s.sessionId, state: s.state, ask: s.ask, cwd: s.cwd, gate: s.branch && s.branch.gate, worktree: s.branch && s.branch.worktree } : null; }, name);
const shot = async (name, el = null) => { const f = path.join(OUT, `${name}.png`); if (el) await el.screenshot({ path: f }); else await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };

async function open() {
  app = await electron.launch({ args: ['.', '--dev', ...(process.env.MT_P71_CDP === '0' ? [] : ['--remote-debugging-port=9371'])], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(1000);
}

// 창 제목 줄(운영체제 테두리)만 찍는다. 창을 잠깐 맨 위에 두고 그 칸만 복사한다
async function titleShot(name) {
  const b = await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; w.setAlwaysOnTop(true); w.show(); w.focus(); const r = w.getBounds(); return { ...r, title: w.getTitle(), scale: screen.getDisplayMatching(r).scaleFactor }; });
  await sleep(700);
  const f = path.join(OUT, `${name}.png`);
  const s = b.scale || 1;
  const ps = `Add-Type -AssemblyName System.Drawing; Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class D { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'; [D]::SetProcessDPIAware() | Out-Null; $bm = New-Object System.Drawing.Bitmap ${Math.round(Math.min(b.width, 900) * s)}, ${Math.round(40 * s)}; $g = [System.Drawing.Graphics]::FromImage($bm); $g.CopyFromScreen(${Math.round(b.x * s)}, ${Math.round(b.y * s)}, 0, 0, $bm.Size); $bm.Save('${f.replace(/'/g, "''")}');`;
  try { execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 30000 }); log('스크린숏', path.relative(REPO, f)); } catch (e) { log('제목 줄 찍기 실패', e.message.slice(0, 200)); }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setAlwaysOnTop(false));
  return b.title;
}
async function sidebarShot(name) {
  const row = page.locator('.mt-sb2-row:has([data-action=ws-menu])').first();
  if (!(await row.count())) { log('사이드바 프로젝트 줄이 없다'); return null; }
  await row.hover(); await sleep(400);
  const btn = row.locator('[data-action=ws-menu]');
  const box = await row.boundingBox();
  const f = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: f, clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 30), width: box.width + 16, height: box.height + 60 } });
  log('스크린숏', path.relative(REPO, f));
  return btn.evaluate((e) => { const svg = e.querySelector('svg'); const r = svg ? svg.getBoundingClientRect() : null; return { svg: !!svg, w: r ? r.width : 0, path: svg ? svg.querySelector('path').getAttribute('d') : null }; });
}
async function updateShot(name) {
  await page.click('[data-action=settings-open]');
  const box = page.locator('[data-role=settings]');
  await box.waitFor({ timeout: 10000 });
  const ver = page.locator('[data-role=update-version]');
  await ver.waitFor({ timeout: 15000 });
  await ver.scrollIntoViewIfNeeded(); await sleep(600);
  await shot(name, box);
  const info = await page.evaluate(() => ({ rollback: !!document.querySelector('[data-action=update-rollback]'), hint: [...document.querySelectorAll('[data-role=update-actions] .mt-set-hint')].map((e) => e.textContent).join(' ') }));
  await page.keyboard.press('Escape'); await sleep(400);
  return info;
}
async function frame(name) {
  const s = await sess(name);
  await page.evaluate((id) => window.__mt.getState().navigateTo(id), s.id);
  await sleep(1200);
  return page.locator(`.mt-node[data-name="${name}"]`);
}
// 권한 질문은 1번(이번만 허용)으로 답한다(신뢰 질문은 답하지 않는다)
async function answerPermissions(names) {
  for (const n of names) {
    const s = await sess(n);
    if (s && s.state === 'waiting' && s.ask && s.ask.kind === 'permission') {
      const r = await call('session.answer', { session: s.id, toolUseId: s.ask.toolUseId, since: s.ask.since, choice: 1 }).catch((e) => ({ error: e.message }));
      log(`권한 답 ${n}`, s.ask.summary || s.ask.tool, r);
    }
  }
}

// ---------- 준비 ----------
async function setup() {
  fs.mkdirSync(T.LEAD, { recursive: true });
  if (!fs.existsSync(path.join(T.REPO, '.git'))) {
    fs.mkdirSync(T.REPO, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', T.REPO]);
    fs.writeFileSync(path.join(T.REPO, 'README.md'), '# p71 test repo\n');
    git('add', 'README.md'); git(...GIT_ID, 'commit', '-q', '-m', 'init');
  }
  if (!(await sess('lead'))) log(atrium('spawn', T.LEAD, '--name', 'lead', '--model', 'haiku').trim().split('\n').slice(-2).join(' | '));
  await until(async () => (await sess('lead'))?.state === 'ready', 90000);
  const lead = await sess('lead');
  const settings = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'sessions', `${lead.id}.json`), 'utf8'));
  const leadEnv = { ...env, ...Object.fromEntries(Object.entries(settings.env || {}).filter(([k]) => k.startsWith('ATRIUM_'))) };
  if (leadEnv.ATRIUM_SESSION_ID !== lead.id || !leadEnv.ATRIUM_SESSION_TOKEN) throw new Error('리드 설정 파일에 세션 env가 없다');
  const child = (n) => { if (fs.existsSync(wtDir(n))) return; const out = execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), 'child', n, '--cwd', T.REPO.replace(/\\/g, '/'), '--worktree', n, '--model', 'haiku', '--no-wait', '--json'], { encoding: 'utf8', env: leadEnv, timeout: 120000 }); log(`atrium child ${n}`, out.trim().slice(0, 400)); };
  if (!(await sess('w1'))) child('w1');
  // 신뢰 관문: 사람이 @w1 노드에서 답할 때까지 기다린다
  const gated = await until(async () => { const s = await sess('w1'); return s && (s.state === 'trust_wait' || fs.existsSync(wtDir('w1'))); }, 90000);
  const w1 = await sess('w1');
  if (w1 && w1.state === 'trust_wait') {
    await frame('w1'); await shot('p71-0-trust-gate');
    log('사람 차례: 판의 @w1 노드에서 신뢰 질문에 답해 주세요(시험은 대신 답하지 않는다)');
    fs.writeFileSync(path.join(OUT, 'WAITING_TRUST'), String(Date.now()));
  }
  const passed = await until(async () => fs.existsSync(wtDir('w1')) && (await sess('w1'))?.state === 'ready', 30 * 60000, 2000);
  try { fs.rmSync(path.join(OUT, 'WAITING_TRUST'), { force: true }); } catch {}
  step('준비: w1이 claude -w로 워크트리에 떴다', !!passed && gated, await sess('w1'));
  if (!passed) throw new Error('신뢰를 받지 못해 w1이 워크트리에 뜨지 않았다');
  for (const n of ['w2', 'w3']) if (!(await sess(n))) child(n);
  await until(async () => (await Promise.all(['w2', 'w3'].map(async (n) => fs.existsSync(wtDir(n)) && (await sess(n))?.state === 'ready'))).every(Boolean), 120000, 1000);
  // 커밋 하나씩: 워커가 직접 만든다
  const PROMPT = 'Run exactly these shell commands in the current folder and nothing else: `echo p71 > p71.txt`, `git add p71.txt`, `git -c user.name=p71 -c user.email=p71@example.invalid commit -m "p71 test commit"`. Then reply with the single word done.';
  for (const n of WORKERS) if (commitsOn(n) < 1) { const r = await call('session.send', { target: n, text: PROMPT }); log(`지시 ${n}`, r.deliveries?.map((d) => d.status)); }
  const made = await until(async () => { await answerPermissions(WORKERS); return WORKERS.every((n) => commitsOn(n) >= 1); }, 6 * 60000, 1500);
  step('준비: 워커 셋이 각자 브랜치에 커밋 하나', !!made, Object.fromEntries(WORKERS.map((n) => [n, commitsOn(n)])));
  await until(async () => (await Promise.all(WORKERS.map(async (n) => (await sess(n))?.state === 'ready'))).every(Boolean), 120000, 1000);
}

async function before() {
  await setup();
  const title = await titleShot('p71-before-title');
  step('전: 창 제목', true, title);
  const sb = await sidebarShot('p71-before-sidebar');
  step('전: 사이드바 프로젝트 줄 메뉴 단추', true, sb);
  const up = await updateShot('p71-before-update');
  step('전: 업데이트 묶음에 되돌리기 단추가 있다', up.rollback, up);
  // w1에 /exit: 워크트리 나가기 질문이 뜬다(고치기 전 판은 "유형을 알 수 없는 확인 창")
  const w1 = await sess('w1');
  await call('terminal.input', { session: w1.id, data: '/exit' }); await sleep(300);
  await call('terminal.input', { session: w1.id, data: '\r' });
  const waiting = await until(async () => (await sess('w1'))?.state === 'waiting', 30000);
  const el = await frame('w1'); await sleep(1500);
  await shot('p71-before-card', el);
  step('전: /exit 뒤 w1이 응답 필요(알 수 없는 확인 창)', !!waiting && (await sess('w1')).ask?.kind === 'unknown_dialog', (await sess('w1')).ask);
}

async function after() {
  // 고친 판: 떠 있던 질문을 다시 읽어 워크트리 질문으로 보인다
  const w1ok = await until(async () => (await sess('w1'))?.ask?.kind === 'worktree_exit', 60000, 1000);
  const w1 = await sess('w1');
  step('후: w1 승인 줄이 워크트리 질문(커밋 수 읽음)', !!w1ok && w1.ask.commits === commitsOn('w1') && w1.ask.keep && w1.ask.remove, w1.ask);
  let el = await frame('w1'); await sleep(1200);
  await shot('p71-after-card', el);
  // P104: 판의 승인 줄은 없다(사람은 터미널에서 고른다). 지우기는 CLI와 같은 session.answer(confirm: true)로 한다
  step('P104: 노드에 승인 줄이 없다', (await el.locator('[data-role=approval]').count()) === 0);
  const noConfirm = await call('session.answer', { session: w1.id, since: w1.ask.since, choice: 'remove' }).catch((e) => ({ error: e.message }));
  step('후: 지우기는 한 번 더 확인해야 한다(confirm 없으면 거부)', !!noConfirm.error && fs.existsSync(wtDir('w1')), noConfirm);
  await call('session.answer', { session: w1.id, since: w1.ask.since, choice: 'remove', confirm: true });
  const gone1 = await until(async () => !fs.existsSync(wtDir('w1')) && !branchExists('w1') && ['exited', undefined].includes((await sess('w1'))?.state), 60000, 1000);
  step('후: 승인 줄에서 지우기 → 워크트리와 브랜치가 지워지고 세션이 끝남', !!gone1, { dir: fs.existsSync(wtDir('w1')), branch: branchExists('w1'), state: (await sess('w1'))?.state });

  // w2: X로 닫으며 남기기(기본)
  el = await frame('w2');
  await el.locator('[data-action=kill]').click();
  const kc = el.locator('[data-role=kill-confirm]');
  await kc.locator('[data-role=close-worktree]').waitFor({ timeout: 15000 });
  await sleep(400);
  await shot('p71-after-close-keep', el);
  step('후: 닫기 확인에 워크트리 선택(기본 남기기)', (await kc.locator('[data-role=close-worktree]').getAttribute('data-value')) === 'keep', await kc.innerText());
  await kc.locator('[data-action=close-archive]').click();
  const kept = await until(async () => !(await sess('w2')), 60000, 1000);
  step('후: 남기기로 닫음 → 세션은 닫히고 워크트리·브랜치·커밋은 남는다', !!kept && fs.existsSync(wtDir('w2')) && branchExists('w2') && commitsOn('w2') >= 1, { dir: fs.existsSync(wtDir('w2')), branch: branchExists('w2'), commits: commitsOn('w2') });

  // w3: X로 닫으며 워크트리와 브랜치 지우기
  el = await frame('w3');
  await el.locator('[data-action=kill]').click();
  const kc3 = el.locator('[data-role=kill-confirm]');
  await kc3.locator('[data-role=close-worktree]').waitFor({ timeout: 15000 });
  await kc3.locator('input[data-choice=remove]').check(); await sleep(400);
  await shot('p71-after-close-remove', el);
  await kc3.locator('[data-action=close-archive]').click();
  const gone3 = await until(async () => !(await sess('w3')) && !fs.existsSync(wtDir('w3')) && !branchExists('w3'), 60000, 1000);
  step('후: 지우기로 닫음 → 세션이 닫히고 워크트리와 브랜치가 지워진다', !!gone3, { dir: fs.existsSync(wtDir('w3')), branch: branchExists('w3') });

  const title = await titleShot('p71-after-title');
  step('후: 창 제목에 버전과 (dev)', /^Atrium \d+\.\d+\.\d+(-dev\.\d+)? \(dev\)$/.test(title), title);
  const sb = await sidebarShot('p71-after-sidebar');
  step('후: 사이드바 메뉴 단추에 점 셋', sb && sb.svg && sb.w > 0 && !/h\.01/.test(sb.path || ''), sb);
  const up = await updateShot('p71-after-update');
  step('후: 업데이트 묶음에 되돌리기 단추와 풀이가 없다', !up.rollback && !/되돌|복원|Roll back/i.test(up.hint), up);
}

await open();
try {
  if (STAGE === 'before') await before(); else await after();
} catch (e) {
  log('오류', e.stack || e.message);
  results.push({ name: '오류', ok: false, detail: e.message });
  try { await shot(`p71-${STAGE}-error`); } catch {}
} finally {
  const fail = results.filter((r) => !r.ok);
  log(`결과 ${results.length - fail.length}/${results.length}`, fail.map((r) => r.name));
  fs.writeFileSync(path.join(OUT, `p71-wt-${STAGE}.json`), JSON.stringify(results, null, 2));
  await closeApp(app);
  process.exit(fail.length ? 1 : 0); // 창을 닫은 뒤에도 Playwright 연결이 남아 끝나지 않는 일이 있었다
}
