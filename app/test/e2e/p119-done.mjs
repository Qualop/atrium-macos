// P119 창 시험: 판이 닫는 워크트리 워커의 헛 응답 필요, 작업 완료는 맨 위 세션만, 미션 맵의 작업 완료 카드.
// 리드(haiku, 시험 저장소)가 atrium child --worktree로 워커 둘(haiku)을 띄운다. 워커는 파일을 하나 써(커밋 안 함) 워크트리 나가기 질문이 뜨게 한다.
// 워커가 끝나도 작업 완료(받은 함, 미션 맵, 노드)는 리드에만 보이는지, 리드가 턴을 끝내면 리드가 작업 완료인지 잰다.
// 리드의 env로 atrium child-kill을 부르는 동안 응답 필요(waiting·trust_wait), OS 알림 기록(notifyLog), 판 이벤트(state → waiting)를 본다.
// 미션 맵 그림: 고친 화면(after)과, 같은 판에 고치기 전 창 화면(origin/dev의 renderer를 따로 묶음)을 띄운 before. 움직임 줄이기(reduce)로 찍는다.
// 판: herdr·hc 세션 atrium-dev-p119, 포트 47898, 창 원격 디버깅 9378, 이 워크트리의 backend/.dev. P119_BACKEND=herdr|hc(ATRIUM_TERMINAL_BACKEND).
// 시험 저장소는 신뢰를 이미 받은 경로(C:\Workspace\mtask-p75-repo)를 새로 만든다. 신뢰 질문이 뜨면 대신 답하지 않고
// backend/.dev/p119-need-trust.txt에 한 줄을 두고 기다린다.
// MT_P119_STAGE=run | clean. 사용: node experiments/p119/e2e.cjs run|clean (herdr|hc)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, logger } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p119') throw new Error('MT_E2E_OUT=p119를 명령줄에서 준다');
const STAGE = process.env.MT_P119_STAGE;
const BACK = process.env.P119_BACKEND;
if (!['run', 'clean'].includes(STAGE)) throw new Error('MT_P119_STAGE=run|clean');
if (!['herdr', 'hc'].includes(BACK)) throw new Error('P119_BACKEND=herdr|hc');
const DEV = path.join(REPO, 'backend', '.dev');
const TREPO = 'C:\\Workspace\\mtask-p75-repo';
const ENV = {
  ATRIUM_PROFILE: 'dev', ATRIUM_HERDR_SESSION: 'atrium-dev-p119', ATRIUM_PORT: '47898',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: path.join(DEV, 'p119-projects'), ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TERMINAL_BACKEND: BACK,
};
assertTestBoard(ENV, { root: DEV });
const log = logger(`p119-${BACK}-${STAGE}`);
const STRIP = /^(ATRIUM_|HERDR_|MTASK_|MT_HERDR|HC_|XDG_|CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/i;
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !STRIP.test(k))), ...ENV };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const git = (...a) => execFileSync('git', ['-C', TREPO, ...a], { encoding: 'utf8', timeout: 30000 }).trim();
const keyOf = (p) => p.replace(/\\/g, '/').toLowerCase();
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
async function until(fn, ms, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(every); } }
const WORKERS = ['w1', 'w2'];
const NEED_TRUST = path.join(DEV, 'p119-need-trust.txt');

if (STAGE === 'clean') {
  let names = [];
  try { names = JSON.parse(atrium('ls', '--json')).map((s) => s.name); } catch (e) { log('목록 실패', e.message.slice(0, 200)); }
  for (const n of names) { try { log('끄기', atrium('kill', n, '--yes').trim().split('\n').slice(-1)[0]); } catch (e) { log('끄기 실패', n, e.message.slice(0, 160)); } }
  try { log('터미널 서버 멈춤', atrium('herdr', 'stop', '--yes').trim().slice(0, 300)); } catch (e) { log('멈춤 실패', e.message.slice(0, 200)); }
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log('백엔드 멈춤 실패', e.message.slice(0, 200)); }
  if (fs.existsSync(path.join(TREPO, '.git'))) {
    for (const line of git('worktree', 'list', '--porcelain').split(/\r?\n/)) {
      const m = /^worktree (.+)$/.exec(line);
      if (m && keyOf(m[1]) !== keyOf(TREPO)) { try { git('worktree', 'remove', '--force', '--force', m[1]); log('워크트리 지움', path.basename(m[1])); } catch (e) { log('워크트리 지우기 실패', e.message.slice(0, 160)); } }
    }
    git('worktree', 'prune');
    for (const b of git('branch', '--format=%(refname:short)').split(/\r?\n/).filter((x) => x && x !== 'main')) { try { git('branch', '-D', b); } catch {} }
  }
  process.exit(0);
}

let app = null, page = null;
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const sess = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? { id: s.sessionId, state: s.state, unseen: !!s.unseen, unseenSub: !!s.unseenSub, estimate: s.estimate, parent: s.parentSessionId, cwd: s.cwd, gate: s.branch && s.branch.gate } : null; }, name);
const shot = async (name, clip = null) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f, ...(clip ? { clip } : {}) }); log('스크린숏', path.relative(REPO, f)); };
async function open() {
  app = await electron.launch({ args: ['.', '--dev', '--remote-debugging-port=9378'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.emulateMedia({ reducedMotion: 'reduce' }); // 사용자 PC(Windows 애니메이션 끔)와 같은 조건
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(1000);
}
const envOf = async (name) => {
  const s = await sess(name);
  const settings = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'sessions', `${s.id}.json`), 'utf8'));
  return { ...env, ...Object.fromEntries(Object.entries(settings.env || {}).filter(([k]) => k.startsWith('ATRIUM_'))) };
};
const childCmd = (pe, args) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), ...args], { encoding: 'utf8', env: pe, timeout: 180000 });
const WORK = (n) => `Use the Write tool to create a file named note-${n}.txt in the current folder containing the single word hi. Do not run git. Then reply with the single word done.`;
const ASK = 'Reply with the single word ok and do nothing else.';
const inbox = () => page.evaluate(() => { const ss = [...window.__mt.getState().sessions.values()]; return { needsYou: ss.filter((s) => s.state === 'waiting' || s.state === 'trust_wait').map((s) => s.name), done: ss.filter((s) => s.unseen && s.state !== 'waiting' && s.state !== 'trust_wait').map((s) => s.name) }; });

// 미션 맵: 덮개를 열고 리드 팀을 찍는다(카드 둘레), 머리(거르기 탭)도
async function missionShots(tag) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.keyboard.press('m'); await sleep(1500);
  if (!(await page.locator('[data-role=mm-node]').count())) { await page.keyboard.press('M'); await sleep(1500); }
  await shot(`p119-${BACK}-${tag}-mission`);
  const lead = page.locator('[data-role=mm-node][data-name=lead]').first();
  const m = await page.evaluate(() => {
    const card = document.querySelector('[data-role=mm-node][data-name=lead]');
    const tag = card && card.querySelector('[data-role=mm-done]');
    const cs = card ? getComputedStyle(card) : null;
    const done = document.querySelector('.mt-mm-filter.c-done');
    return { tier: card && card.dataset.tier, tag: tag ? tag.textContent : null, border: cs && cs.borderColor, shadow: cs && cs.boxShadow, anim: cs && cs.animationName, doneTab: done ? done.textContent : null, workersTier: [...document.querySelectorAll('[data-role=mm-node]')].filter((x) => /^w\d$/.test(x.dataset.name)).map((x) => `${x.dataset.name}:${x.dataset.tier}`), reduce: matchMedia('(prefers-reduced-motion: reduce)').matches };
  });
  log(`미션 맵 ${tag}`, m);
  if (await lead.count()) { const b = await lead.boundingBox(); if (b) await shot(`p119-${BACK}-${tag}-mission-lead`, { x: Math.max(0, b.x - 40), y: Math.max(0, b.y - 30), width: Math.min(560, b.width + 300), height: b.height + 160 }); }
  const head = page.locator('[role=tablist]').first();
  if (await head.count()) { const b = await head.boundingBox(); if (b) await shot(`p119-${BACK}-${tag}-mission-head`, { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.width + 16, height: b.height + 16 }); }
  await page.keyboard.press('Escape'); await sleep(800);
  return m;
}

// 고치기 전 창 화면(origin/dev의 app/src/renderer)을 dist로 묶어 다시 읽는다. 끝나면 지금 코드로 다시 묶는다
function buildRenderer(which) {
  if (which === 'old') execFileSync(process.execPath, [path.join(REPO, 'experiments', 'p119', 'build-old.mjs')], { cwd: APP_ROOT, encoding: 'utf8', timeout: 180000 });
  else execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: APP_ROOT, encoding: 'utf8', timeout: 180000 });
  log(`창 화면 묶음: ${which}`);
}

try {
  // ---------- 준비 ----------
  fs.mkdirSync(ENV.ATRIUM_CLAUDE_PROJECTS, { recursive: true });
  if (!fs.existsSync(path.join(TREPO, '.git'))) {
    fs.mkdirSync(path.join(TREPO, '.claude'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', TREPO]);
    fs.writeFileSync(path.join(TREPO, 'README.md'), '# p119 test repo\n');
    // 워커가 Write만 묻지 않고 쓰게(워크트리에도 들어가게 커밋한다)
    fs.writeFileSync(path.join(TREPO, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Write', 'Edit'] } }, null, 2));
    git('add', '.'); git('-c', 'user.name=p119', '-c', 'user.email=p119@example.invalid', 'commit', '-q', '-m', 'init');
  }
  await open();
  if (!(await sess('lead'))) log(atrium('spawn', TREPO, '--name', 'lead', '--model', 'haiku').trim().split('\n').slice(-3).join(' | '));
  await until(async () => !!(await sess('lead')), 60000);
  const t0 = await until(async () => { const s = await sess('lead'); return s && ['trust_wait', 'ready', 'working'].includes(s.state) ? s.state : null; }, 120000);
  if (t0 === 'trust_wait') { fs.writeFileSync(NEED_TRUST, `Dev board atrium-dev-p119 (port 47898, ${BACK}): on the @lead node, answer the folder trust question for C:\\Workspace\\mtask-p75-repo.\n`); log('신뢰 질문: 사람을 기다린다'); }
  const ready = await until(async () => (await sess('lead'))?.state === 'ready', 60 * 60000, 2000);
  try { fs.rmSync(NEED_TRUST, { force: true }); } catch {}
  step('준비: 리드가 시험 저장소에서 떴다', !!ready, await sess('lead'));
  if (!ready) throw new Error('리드가 ready가 되지 않았다');

  // ---------- 1. 워커 둘: 워크트리에서 파일 하나 쓰기 ----------
  const leadEnv = await envOf('lead');
  for (const n of WORKERS) if (!(await sess(n))) log(`atrium child ${n}`, childCmd(leadEnv, ['child', n, '--worktree', n, '--prompt', WORK(n), '--model', 'haiku', '--no-wait', '--json']).trim().slice(0, 300));
  const trustAsk = await until(async () => { for (const n of WORKERS) { const s = await sess(n); if (s && s.state === 'trust_wait') return n; } return null; }, 20000, 1000);
  if (trustAsk) { fs.writeFileSync(NEED_TRUST, `Dev board atrium-dev-p119 (port 47898, ${BACK}): on the @${trustAsk} node, answer the folder trust question.\n`); log('워커 신뢰 질문: 사람을 기다린다', trustAsk); }
  const wrote = await until(async () => WORKERS.every((n) => fs.existsSync(path.join(TREPO, '.claude', 'worktrees', n, `note-${n}.txt`))), 30 * 60000, 2000);
  try { fs.rmSync(NEED_TRUST, { force: true }); } catch {}
  const settled = await until(async () => { const ss = await Promise.all(WORKERS.map(sess)); return ss.every((s) => s && s.state === 'ready') ? ss : null; }, 180000, 1000);
  step('1. 워커 둘이 워크트리에 파일을 쓰고 턴을 끝냈다', !!(wrote && settled), settled);
  await sleep(1500);
  const ib1 = await inbox();
  const w = await Promise.all(WORKERS.map(sess));
  step('1. 워커의 끝난 턴은 작업 완료에 없다(unseenSub), 노드는 ready', w.every((s) => s && !s.unseen && s.unseenSub && s.state === 'ready') && !ib1.done.some((n) => WORKERS.includes(n)), { ib1, w });

  // ---------- 2. 리드가 턴을 끝내면 리드가 작업 완료 ----------
  await call('session.markSeen', { session: (await sess('lead')).id }).catch(() => {});
  atrium('send', '@lead', ASK);
  const leadDone = await until(async () => { const s = await sess('lead'); return s && s.state === 'ready' && s.unseen ? s : null; }, 180000, 1000);
  const ib2 = await inbox();
  step('2. 리드가 턴을 끝내면 작업 완료는 리드 하나', !!leadDone && ib2.done.includes('lead') && !ib2.done.some((n) => WORKERS.includes(n)), ib2);
  // 받은 함(위 오른쪽 작업 완료 알약)
  const pill = page.locator('[data-role=review]').first();
  if (await pill.count()) { await pill.click().catch(() => {}); await sleep(900); const b = await pill.boundingBox(); await shot(`p119-${BACK}-after-inbox`, b ? { x: Math.max(0, b.x - 360), y: 0, width: 620, height: 360 } : null); await page.keyboard.press('Escape'); await sleep(500); }

  // ---------- 3. 미션 맵 그림(뒤, 앞) ----------
  const mAfter = await missionShots('after');
  step('3. 미션 맵(뒤, reduce): 리드 카드는 작업 완료 꼬리표, 워커는 쉼', mAfter.tier === 'review' && /작업 완료|Done/.test(mAfter.tag || '') && mAfter.reduce && mAfter.workersTier.every((x) => !x.endsWith(':review')), mAfter);
  if (BACK === 'herdr' && process.env.P119_BEFORE !== '0') {
    buildRenderer('old');
    await page.reload(); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 }); await sleep(2000);
    const mBefore = await missionShots('before');
    log('고치기 전 미션 맵', mBefore);
    buildRenderer('new');
    await page.reload(); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 }); await sleep(2000);
  }

  // ---------- 4. 리드의 child-kill: 응답 필요·알림이 없다 ----------
  const sinceT = Date.now();
  const nBefore = await page.evaluate(() => window.__mt.notifyLog.length);
  await page.evaluate(() => {
    window.__p119 = { waits: [], closing: [] };
    window.__p119.iv = setInterval(() => {
      for (const s of window.__mt.getState().sessions.values()) {
        if (!/^w\d$/.test(s.name)) continue;
        if (s.state === 'waiting' || s.state === 'trust_wait') window.__p119.waits.push(`${s.name}:${s.state}:${s.ask && s.ask.kind}`);
        if (s.estimate === 'board closing') window.__p119.closing.push(s.name);
      }
    }, 50);
  });
  const killOut = childCmd(leadEnv, ['child-kill', 'w1', '--json']) + '\n' + childCmd(leadEnv, ['child-kill', 'w2', '--json']);
  log('child-kill', killOut.trim().slice(0, 600));
  await sleep(3000); // 알림은 1.2초 뒤에 정한다
  const probe = await page.evaluate((n0) => { clearInterval(window.__p119.iv); return { waits: [...new Set(window.__p119.waits)], closing: [...new Set(window.__p119.closing)], notify: window.__mt.notifyLog.slice(n0) }; }, nBefore);
  const evs = (await call('session.events', { since: sinceT, limit: 500 })) || [];
  const evList = Array.isArray(evs) ? evs : evs.events || [];
  const toWait = evList.filter((e) => e.kind === 'state' && e.data && (e.data.to === 'waiting' || e.data.to === 'trust_wait'));
  const answered = evList.filter((e) => e.kind === 'worktree_exit_answered').map((e) => e.data && e.data.choice);
  const ib3 = await inbox();
  step('4. child-kill: 판이 나가기 질문에 답했다(남기기 둘)', answered.length === 2 && answered.every((c) => c === 'keep'), { answered, closing: probe.closing });
  step('4. child-kill 동안 응답 필요 상태·이벤트·OS 알림 기록이 없다', probe.waits.length === 0 && toWait.length === 0 && probe.notify.length === 0 && ib3.needsYou.length === 0, { waits: probe.waits, toWait: toWait.map((e) => e.data), notify: probe.notify, ib3 });
  const kept = WORKERS.every((n) => fs.existsSync(path.join(TREPO, '.claude', 'worktrees', n)));
  step('4. 워크트리는 남았다', kept, null);
  await shot(`p119-${BACK}-after-killed`);
} catch (e) {
  step('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, `p119-${BACK}-results.json`), JSON.stringify(results, null, 2));
  const fail = results.filter((r) => !r.ok).length;
  log(`결과: 통과 ${results.length - fail}, 실패 ${fail}`);
  if (app) { try { await app.close(); } catch {} }
  process.exit(fail ? 1 : 0);
}
