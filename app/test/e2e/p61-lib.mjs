// P61 창 시험 공용: P61 판(atrium-dev-p61, 47883, 이 워크트리의 backend/.dev, experiments/p61/tools/env.cjs)으로 창을 띄우고
// 시험 폴더 하나를 열어 셸 노드 하나와 메모·칸반을 둔다. p61-shots.mjs(전후 스크린숏)와 p61-motion.mjs(동작)가 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p61') throw new Error('MT_E2E_OUT=p61를 명령줄에서 준다');
export const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p61', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P61_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p61' || ENV.ATRIUM_PORT !== '47883') throw new Error('P61 판(atrium-dev-p61, 47883)만');
if (!/^C:\\Workspace\\mtask-p61-/.test(T.DIR)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p61-*만: ${T.DIR}`);
fs.mkdirSync(OUT, { recursive: true });

const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
export const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
export const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const lastLine = (s) => s.trim().split(/\r?\n/).slice(-1)[0];
export { sleep, until, closeApp, OUT, REPO };

export function board(tag) {
  const log = logger(tag);
  const results = [];
  const ctx = { log, results, page: null, app: null, ids: {} };
  ctx.step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
  ctx.shot = async (name) => { const f = path.join(OUT, `${tag}-${name}.png`); await ctx.page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
  ctx.call = (m, p = {}) => ctx.page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
  ctx.size = async (w, h) => { await ctx.app.evaluate(({ BrowserWindow }, [ww, hh]) => BrowserWindow.getAllWindows()[0].setContentSize(ww, hh), [w, h]); await sleep(700); };
  ctx.fresh = async () => {
    try { log('백엔드 멈춤', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
    await sleep(800);
    for (const d of [path.join(T.DEV, 'data'), path.join(T.DEV, 'app'), T.PROJECTS, T.SESSIONS, T.DIR]) fs.rmSync(d, { recursive: true, force: true });
  };
  ctx.launch = async (extraEnv = {}) => {
    for (const d of [T.PROJECTS, T.SESSIONS, T.DIR]) fs.mkdirSync(d, { recursive: true });
    ctx.app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env: { ...env, ...extraEnv }, timeout: 60000 });
    ctx.page = await ctx.app.firstWindow();
    ctx.page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
    await ctx.page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
    await ctx.size(1584, 921);
  };
  // 시험 폴더, 셸 노드 s1, 메모와 칸반(찾기 결과 종류를 고루 보이려고)
  ctx.seed = async () => {
    await ctx.call('settings.set', { language: 'ko' });
    await ctx.call('workspace.open', { path: T.DIR });
    await ctx.page.waitForSelector('.react-flow__node-region');
    const has = await ctx.page.evaluate(() => [...window.__mt.getState().sessions.values()].some((s) => s.name === 's1'));
    if (!has) log(lastLine(atrium('spawn', T.DIR, '--name', 's1', '--kind', 'shell')));
    ctx.ids.s1 = await until(() => ctx.page.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 's1'); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }), 30000);
    const memos = await ctx.call('memo.list', {}).catch(() => null);
    const list = memos && (memos.memos || memos);
    if (!Array.isArray(list) || !list.some((m) => /p61 search/.test(m.text || ''))) {
      await ctx.call('memo.create', { text: 'p61 search notes\nthe search window should slide down gently', workspace: T.DIR });
      await ctx.call('kanban.create', { title: 'p61 search board', columns: ['todo', 'doing', 'done'], workspace: T.DIR });
    }
    await sleep(800);
  };
  ctx.close = async () => { if (ctx.app) await closeApp(ctx.app); };
  ctx.summary = () => { const bad = results.filter((r) => !r.ok); log(`결과 ${results.length - bad.length}/${results.length}`); if (bad.length) log('실패', bad.map((r) => r.name)); return bad.length; };
  return ctx;
}
