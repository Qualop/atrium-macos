// P53 창 시험: 작은 이슈 #8(저장소 밖 대화 카드의 "⎇ HEAD"), #9(영어 "Prompt" 두 뜻), #10(첫 시작을 재시작으로 셈)을 빈 판에서 재현·확인한다.
// 판: herdr 세션 atrium-dev-p53, 포트 47872, 이 워크트리의 backend/.dev. 시험 폴더는 C:\Workspace\mtask-p53-*만. 세션은 셸만.
// 사용(app에서): MT_E2E_OUT=p53 node test/e2e/p53-issues.mjs [--tag 이름]
//   매번 백엔드를 멈추고 판 데이터와 창 프로필을 지운 뒤 시작한다(첫 시작을 보려고).
// 결과: experiments/p53/p53-<tag>.json, 스크린숏 p53-<tag>-*.png
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, closeApp, logger, sleep, until, REPO, OUT } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

const argv = process.argv.slice(2);
const TAG = `p53-${argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : 'run'}`;
const DEV = path.join(REPO, 'backend', '.dev');
const DIR = 'C:\\Workspace\\mtask-p53-plain'; // git 저장소가 아닌 폴더
const ENV = {
  ATRIUM_HERDR_SESSION: 'atrium-dev-p53', ATRIUM_PORT: '47872',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: path.join(DEV, 'projects'), ATRIUM_CLAUDE_SESSIONS: path.join(DEV, 'sessions'), ATRIUM_CLAUDE_DESKTOP: 'none',
  ATRIUM_TEST_PREFIX: 'p53-never-', // 기본(mtask-)이면 시험 폴더의 대화가 missed로 빠져 카드가 뜨지 않는다
};
assertTestBoard(ENV, { root: DEV });
if (!/^C:\\Workspace\\mtask-p53-/.test(DIR)) throw new Error('시험 폴더는 C:\\Workspace\\mtask-p53-*만');

const log = logger(TAG);
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const isGit = (d) => { try { execFileSync('git', ['-C', d, 'rev-parse', '--git-dir'], { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; } };

// 빈 판에서 시작한다
try { log('백엔드 멈춤', atrium('backend', 'stop').trim().split('\n').slice(-1)[0]); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
await sleep(800);
for (const d of [ENV.ATRIUM_DATA_DIR, ENV.ATRIUM_APP_USERDATA, ENV.ATRIUM_CLAUDE_PROJECTS]) fs.rmSync(d, { recursive: true, force: true });
for (const d of [DIR, ENV.ATRIUM_CLAUDE_PROJECTS, ENV.ATRIUM_CLAUDE_SESSIONS]) fs.mkdirSync(d, { recursive: true });

// #8 고정 자료: 저장소 밖 폴더에서 Claude Code가 남기는 모양(gitBranch "HEAD")의 대화 기록 한 개
const convId = '5e53a0de-0000-4000-8000-000000000053';
const now = Date.now();
const rec = (o, dt) => JSON.stringify({ cwd: DIR, sessionId: convId, version: '2.1.318', gitBranch: 'HEAD', entrypoint: 'cli', timestamp: new Date(now - 600000 + dt).toISOString(), ...o });
const projDir = path.join(ENV.ATRIUM_CLAUDE_PROJECTS, 'C--Workspace-mtask-p53-plain');
fs.mkdirSync(projDir, { recursive: true });
fs.writeFileSync(path.join(projDir, `${convId}.jsonl`), [
  rec({ type: 'user', uuid: 'p53-u1', message: { role: 'user', content: 'p53 outside convo: say ok' } }, 0),
  rec({ type: 'assistant', uuid: 'p53-a1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }, 2000),
].join('\n') + '\n');

let app = null, page = null;
const spawned = [];
const shot = async (n) => { const f = path.join(OUT, `${TAG}-${n}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const changesText = async () => {
  await page.evaluate(() => window.__mt.getState().showChanges(600)); await sleep(1200);
  const t = await page.evaluate(() => { const e = document.querySelector('[data-role="return-summary"]'); return e ? [...e.querySelectorAll('.mt-return-line')].map((l) => l.innerText.replace(/\n/g, ' | ')) : []; });
  return t;
};
const closeChanges = () => page.click('[data-action="return-close"]').catch(() => {});

try {
  ({ app, page } = await launch({ log, env }));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await call('settings.set', { key: 'language', value: 'ko' });

  // #10 처음 켠 판: 백엔드 줄이 없어야 한다
  const ev0 = atrium('events', '--limit', '500').split('\n').filter((l) => /backend_started/.test(l)).length;
  let lines = await changesText();
  await shot('restart-1-fresh');
  await closeChanges();
  step('#10 처음 켠 판의 변경 내역에 다시 시작 줄이 없다', !lines.some((l) => /다시 시작|restart/i.test(l)), { backendStartedEvents: ev0, lines });

  // #8 저장소 밖 폴더의 판 밖 대화 카드
  await call('workspace.open', { path: DIR });
  const card = await until(() => page.evaluate(() => { const e = document.querySelector('.react-flow__node-convo'); return e ? { id: e.dataset.id, text: e.innerText.replace(/\n/g, ' | ').slice(0, 200) } : null; }), 40000);
  if (card) { await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1200); const el = await page.$(`.react-flow__node[data-id="${card.id}"]`); if (el) await el.screenshot({ path: path.join(OUT, `${TAG}-convo-1-card.png`) }); }
  const branchShown = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node-convo .mt-cv-br, .react-flow__node-convo .mt-cv-wt')].map((e) => e.textContent));
  step('#8 저장소가 아닌 폴더의 대화 카드에 브랜치 표시가 없다', !isGit(DIR) && !!card && !/⎇ HEAD/.test(card.text) && branchShown.length === 0, { folderIsGit: isGit(DIR), card, branchShown });

  // #9 영어 먼 얼굴: 셸의 명령 대기와 요청 이름표
  log(atrium('spawn', DIR, '--name', 'sp1', '--kind', 'shell').trim().split('\n').slice(-1)[0]); spawned.push('sp1');
  await until(() => page.evaluate(() => [...window.__mt.getState().sessions.values()].some((s) => s.name === 'sp1' && s.state === 'shell_idle')), 40000);
  await call('settings.set', { key: 'language', value: 'en' }); await sleep(800);
  await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(800);
  await page.evaluate(() => { const st = window.__mt.getState(); const v = st.viewport || { x: 0, y: 0 }; st.setViewport({ x: v.x, y: v.y, zoom: 0.22 }); }); await sleep(1500);
  await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(300);
  await page.evaluate(() => { const st = window.__mt.getState(); const c = document.querySelector('.mt-canvas'); const ids = [...st.nodes.keys()]; const n = st.nodes.get(ids[0]); st.setViewport({ x: c.clientWidth / 2 - (n.x + n.w / 2) * 0.22, y: c.clientHeight / 2 - (n.y + n.h / 2) * 0.22, zoom: 0.22 }); }); await sleep(1500);
  const far = await page.evaluate(() => ({
    shell: [...document.querySelectorAll('[data-role="shell-line"]')].map((e) => e.textContent),
    session: [...document.querySelectorAll('.react-flow__node-session')].map((e) => e.innerText.replace(/\n/g, ' | ').slice(0, 100)),
    convoKey: [...document.querySelectorAll('[data-role="convo-prompt"] .mt-far-k')].map((e) => e.textContent),
  }));
  await shot('enprompt-1-far');
  step('#9 영어 셸 먼 얼굴의 대기 표시가 요청 이름표(Prompt)와 다른 낱말이다', far.shell.length > 0 && !far.shell.some((t) => /^Prompt\b/.test(t)) && !far.session.some((t) => /\| Prompt\b/.test(t)), far);
  await call('settings.set', { key: 'language', value: 'ko' }); await sleep(500);

  // #10 백엔드를 한 번 멈춘 뒤: 창이 다시 띄우고, 변경 내역은 1회, 이름표는 앱 연결 서비스
  log('백엔드 멈춤', atrium('backend', 'stop').trim().split('\n').slice(-1)[0]);
  await sleep(2000);
  const back = await until(async () => { try { return /pid/.test(atrium('backend', 'status')); } catch { return false; } }, 60000);
  await until(() => page.evaluate(() => window.__mt.getState().boardLoaded), 30000); await sleep(2500);
  const ev1 = atrium('events', '--limit', '500').split('\n').filter((l) => /backend_started/.test(l)).length;
  lines = await changesText();
  await shot('restart-2-after-one');
  await closeChanges();
  const rl = lines.filter((l) => /다시 시작/.test(l));
  step('#10 한 번 다시 시작한 뒤 1회이고 줄 이름표가 앱 연결 서비스다', !!back && rl.length === 1 && /1회 다시 시작/.test(rl[0]) && /^앱 연결 서비스/.test(rl[0]) && !lines.some((l) => /^herdr/.test(l)), { backendStartedEvents: ev1, lines });
} catch (e) {
  step('예외', false, String(e && (e.stack || e.message)).slice(0, 800));
  if (page) await shot('error').catch(() => {});
} finally {
  for (const n of spawned) { try { log(atrium('kill', n, '--yes').trim().split('\n').slice(-1)[0]); } catch (e) { log('kill', n, e.message.slice(0, 120)); } }
  if (app) await closeApp(app);
  fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  log(`결과 ${results.filter((r) => r.ok).length}/${results.length}`);
  process.exit(0);
}
