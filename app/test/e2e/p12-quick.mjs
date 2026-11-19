// P12 창 시험: 왼쪽 레일의 Claude, 셸을 누르면 대화상자 없이 지금 워크스페이스에 설정의 새 세션 기본값으로 뜨고 그 터미널로 들어간다.
// Shift+누르기는 대화상자를 기본값으로 연다. 설정 화면에 새 세션 기본값 절이 있다.
// 판: herdr 세션 atrium-dev-p12, 포트 47826, backend/.dev/p12. 다른 판과 그 세션은 건드리지 않는다. 시험 폴더는 새로 만든 C:\Workspace\mtask-p12-ws\demo 하나다.
// 대화 목록은 그 폴더의 대화만 읽는다(실제 ~/.claude/projects 전체를 읽지 않는다). 사용: MT_E2E_OUT=p12 node test/e2e/p12-quick.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, shot, logger, closeApp, e2eBoard } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

const B = e2eBoard({ session: 'atrium-dev-p12', port: '47826', dev: path.join(REPO, 'backend', '.dev', 'p12'), dir: 'C:\\Workspace\\mtask-p12-ws\\demo' }); // P18: 다른 판에서 다시 돌릴 수 있게
if (!['p12', 'p18', 'p21', 'p25'].includes(process.env.MT_E2E_OUT)) throw new Error('MT_E2E_OUT=p12를 명령줄에서 준다');
const DEV = B.dev;
const DIR = B.dir;
const PROJECT = path.join(os.homedir(), '.claude', 'projects', DIR.replace(/[^A-Za-z0-9]/g, '-'));
const ENV = {
  ATRIUM_HERDR_SESSION: B.session, ATRIUM_PORT: B.port,
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: PROJECT, ATRIUM_CLAUDE_DESKTOP: 'none',
};
assertTestBoard(ENV, { root: DEV });
fs.mkdirSync(DEV, { recursive: true });
fs.mkdirSync(DIR, { recursive: true });

const log = logger('p12-quick');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: { ...cleanEnv(), ...ENV } });
const call = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
// P122: 새 판에는 셸 런처가 없다. 셸 단추를 누르는 시험은 사람이 "+"로 만들듯 하나 만들어 레일에 둔다
const shellLauncher = async (page) => { const d = await call(page, 'launcher.list'); const l = d.launchers.find((x) => x.harness === 'shell'); return l ? l.id : (await call(page, 'launcher.create', { launcher: { name: 'Shell', harness: 'shell' }, favorite: true })).launcher.id; };
const sessions = (page) => page.evaluate(() => [...window.__mt.getState().sessions.values()].map((s) => ({ id: s.sessionId, name: s.name, kind: s.kind, state: s.state, ws: s.workspaceKey, model: s.model, permissionMode: s.permissionMode })));
// 초점이 그 세션 노드의 터미널 입력칸에 있는지
const focusIn = (page, id) => page.evaluate((sid) => { const a = document.activeElement; const node = a && a.closest('.react-flow__node'); return { focusId: window.__mt.getState().focusId, inNode: !!(node && node.getAttribute('data-id') === sid), xterm: !!(a && a.classList.contains('xterm-helper-textarea')) }; }, id);
const spawnArgs = async (page, id) => { const ev = await call(page, 'session.events', { session: id }); const e = ev.find((x) => x.kind === 'spawn'); return e ? e.data.args : null; };

const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };

const app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env: { ...cleanEnv(), ...ENV }, timeout: 60000 });
const page = await app.firstWindow();
page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
try {
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await call(page, 'workspace.open', { path: DIR });
  await page.waitForSelector('.mt-wsbtn[data-name="demo"]');
  await page.click('.mt-wsbtn[data-name="demo"]');
  await until(() => page.evaluate(() => { const s = window.__mt.getState(); const w = s.workspaces.find((x) => x.key === s.currentWs); return w && w.name === 'demo'; }), 10000);
  await call(page, 'settings.set', { claudeEffort: 'low', claudePermissionMode: 'acceptEdits', claudeModel: '' });

  // 1. Claude 단추: 대화상자 없이 뜨고 터미널로 들어간다
  const before = new Set((await sessions(page)).map((s) => s.id));
  await page.click('[data-role="rail-left"] [data-action="spawn"]');
  await sleep(300);
  step('Claude 단추는 대화상자를 열지 않는다', !(await page.$('[data-role="spawn"]')));
  const c = await until(async () => (await sessions(page)).find((s) => !before.has(s.id) && s.kind === 'claude'), 30000);
  const cf = await until(async () => { const f = await focusIn(page, c.id); return f.focusId === c.id && f.inNode && f.xterm ? f : null; }, 20000).catch(() => null);
  step('새 Claude 세션 노드의 터미널로 들어간다', cf, cf || (await focusIn(page, c.id)));
  const cargs = await spawnArgs(page, c.id);
  step('설정의 기본값으로 띄운다(acceptEdits, effort low, 개발용 판은 haiku)', c.ws && c.permissionMode === 'acceptEdits' && cargs.includes('--effort') && cargs[cargs.indexOf('--effort') + 1] === 'low' && cargs[cargs.indexOf('--model') + 1] === 'haiku', { ws: c.ws, permissionMode: c.permissionMode, args: cargs.filter((a) => !a.includes('\\') && !a.includes('/')) });
  await until(async () => ['ready', 'trust_wait', 'waiting'].includes((await sessions(page)).find((s) => s.id === c.id).state), 60000).catch(() => {});
  await sleep(1500);
  await shot(page, 'p12-quick-claude', log);

  // 2. 셸 단추
  const before2 = new Set((await sessions(page)).map((s) => s.id));
  const shId = await shellLauncher(page);
  await page.waitForSelector(`[data-role="rail-left"] [data-launcher="${shId}"]`);
  await page.click(`[data-role="rail-left"] [data-launcher="${shId}"]`);
  const sh = await until(async () => (await sessions(page)).find((s) => !before2.has(s.id) && s.kind === 'shell'), 30000);
  const sf = await until(async () => { const f = await focusIn(page, sh.id); return f.focusId === sh.id && f.inNode && f.xterm ? f : null; }, 20000).catch(() => null);
  step('셸 단추도 바로 뜨고 그 터미널로 들어간다', sf, sf || (await focusIn(page, sh.id)));
  await sleep(1000);
  await shot(page, 'p12-quick-shell', log);

  // 3. Shift+누르기: 대화상자를 설정의 기본값으로 연다
  await page.click('[data-role="rail-left"] [data-action="spawn"]', { modifiers: ['Shift'] });
  await page.waitForSelector('[data-role="spawn"]', { timeout: 5000 });
  const dlg = await page.evaluate(() => { const f = document.querySelector('[data-role="spawn"]'); return { kind: f.querySelector('[data-field=kind]').value, model: f.querySelector('[data-field=model]').value, mode: [...f.querySelectorAll('select')].map((x) => x.value).find((v) => v === 'acceptEdits') || null, cwd: f.querySelector('[data-field=cwd]').value }; });
  step('Shift+누르기는 대화상자를 기본값으로 연다', dlg.kind === 'claude' && dlg.mode === 'acceptEdits' && dlg.model === 'haiku' && /demo$/.test(dlg.cwd), dlg);
  await shot(page, 'p12-quick-dialog', log);
  await page.keyboard.press('Escape');
  await page.click('[data-role="spawn"] button[type=button]').catch(() => {});

  // 4. 설정 화면의 새 세션 기본값 절
  await page.click('[data-role="top-right"] [data-action="settings-open"]');
  await page.waitForSelector('[data-role="spawn-settings"]', { timeout: 5000 });
  const sv = await page.evaluate(() => { const r = document.querySelector('[data-role="spawn-settings"]'); return { effort: r.querySelector('[data-field=setting-claudeEffort]').value, mode: r.querySelector('[data-field=setting-claudePermissionMode]').value, model: r.querySelector('[data-field=setting-claudeModel]').value }; });
  step('설정 화면에 지금 기본값이 보인다', sv.effort === 'low' && sv.mode === 'acceptEdits' && sv.model === '', sv);
  await page.fill('[data-field=setting-codexArgs]', '-m gpt-5');
  await page.press('[data-field=setting-codexArgs]', 'Enter');
  await until(async () => (await call(page, 'settings.get')).settings.codexArgs === '-m gpt-5', 5000).then(() => step('Codex 실행 인자를 설정 화면에서 바꾼다', true), () => step('Codex 실행 인자를 설정 화면에서 바꾼다', false));
  await page.evaluate(() => document.querySelector('[data-role="spawn-settings"]').scrollIntoView());
  await shot(page, 'p12-quick-settings', log);
} catch (e) {
  step('시험 중 오류', false, e.message);
  await shot(page, 'p12-quick-error', log).catch(() => {});
} finally {
  // 정리: 이 시험이 띄운 세션을 끄고 기본값을 처음으로 돌린다(판의 herdr 서버와 세션은 tools에서 지운다)
  try {
    for (const s of await sessions(page)) atrium('kill', s.name, '--yes');
    await call(page, 'settings.set', { claudeEffort: '', claudePermissionMode: 'manual', codexArgs: '' });
  } catch (e) { log('정리 오류', e.message); }
  await closeApp(app);
}
fs.writeFileSync(path.join(OUT, 'p12-quick.json'), JSON.stringify(results, null, 2));
log(`결과 ${results.filter((r) => r.ok).length}/${results.length}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
