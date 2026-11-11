// P97 창 시험: 런처 만들기 흐름과 레일 빠른 생성의 이름 칸.
// 단계(첫 인자): before(고치기 전 흐름을 따라가 찍는다) | after(새 흐름: 붙여 넣기, 실행 명령, 레일 고정, 이름 칸) | live(ocx claude 런처로 띄운 판 세션, 하위 세션, 판 다시 켜기) | stop(정리)
// 판: herdr 세션 atrium-dev-p97, 포트 47896, 창 원격 디버깅 9376, 이 워크트리의 backend/.dev. 시험 폴더는 새로 만든 C:\Workspace\mtask-p97-ws만 쓴다.
// 사용(워크트리 app 폴더에서): sh ../backend/.dev/clean-env.sh env MT_E2E_OUT=p97 node test/e2e/p97-launchers.mjs <단계>
// 그림은 창 안만 찍는다(page.screenshot). 화면 전체·화면 영역을 찍지 않는다.
// live 단계는 opencodex(ocx)가 깔려 있고 프록시가 돌 때만 돈다. 시험 세션은 haiku로 짧은 한 줄 일만 시킨다. opencodex 설정과 프록시는 바꾸지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO, OUT, sleep, until, launch, closeApp, logger } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p97') throw new Error('MT_E2E_OUT=p97를 명령줄에서 준다');
const PHASE = process.argv[2] || 'after';
const DEV = path.join(REPO, 'backend', '.dev');
const WS_ROOT = 'C:\\Workspace\\mtask-p97-ws';
const WS = path.join(WS_ROOT, 'demo');
const proj = (d) => path.join(os.homedir(), '.claude', 'projects', d.replace(/[^A-Za-z0-9]/g, '-'));
const ENV = {
  ATRIUM_HERDR_SESSION: 'atrium-dev-p97', ATRIUM_PORT: '47896',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: proj(WS), ATRIUM_CLAUDE_DESKTOP: 'none',
  ATRIUM_CLAUDE_SESSIONS: path.join(DEV, 'fixture-sessions-p97'), ATRIUM_TEST_PREFIX: 'mtask-p97-x',
};
assertTestBoard(ENV, { root: DEV });
const log = logger(`p97-${PHASE}`);
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ATRIUM_|MTASK_|HERDR_|CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 180000 });
const call = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const shot = async (page, name) => { const f = path.join(OUT, `p97-${PHASE}-${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.basename(f)); return f; };
const settings = async (page) => {
  await page.click('[data-action="settings-open"]');
  await page.click('[data-tab="launchers"]');
  await page.waitForSelector('[data-role="launchers-list"]');
  await sleep(300);
};
const closeSettings = (page) => page.keyboard.press('Escape');
const sessionsByName = (page) => page.evaluate(() => [...window.__mt.getState().sessions.values()].map((s) => ({ name: s.name, kind: s.kind, state: s.state, id: s.sessionId })));

if (PHASE === 'stop') {
  try { log(atrium('backend', 'stop')); } catch (e) { log('backend stop', String(e.message).slice(0, 200)); }
  process.exit(0);
}

fs.mkdirSync(WS, { recursive: true });
fs.mkdirSync(ENV.ATRIUM_CLAUDE_SESSIONS, { recursive: true });

let app, page;
try {
  // restart: 판 끄기. 백엔드를 멈추고 herdr 서버도 멈춘다(herdr가 다시 뜨면 등록된 이어 가기 명령으로 패널을 되살린다)
  if (PHASE === 'restart') {
    try { log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 120)); } catch (e) { log('backend stop', e.message.slice(0, 120)); }
    const hs = spawnSync('herdr', ['--session', ENV.ATRIUM_HERDR_SESSION, 'server', 'stop'], { encoding: 'utf8', env: cleanEnv(), timeout: 30000 });
    log('herdr 서버 멈춤', hs.status, (hs.stdout + hs.stderr).trim().slice(0, 120));
    await sleep(2000);
  }
  // 백엔드를 CLI로 먼저 띄운다(창이 띄우면 창의 원격 디버깅 포트를 물려받는다, P81). 출력 파이프는 물려주지 않는다
  log('백엔드 켜기', spawnSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', 'backend', 'start'], { stdio: 'ignore', env, timeout: 90000 }).status);
  ({ app, page } = await launch({ log, env: ENV, args: ['--remote-debugging-port=9376'] }));
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await until(async () => { const d = await call(page, 'launcher.list'); return d && d.launchers ? d : null; }, 30000);
  log(atrium('ws', 'open', WS).trim().split('\n').slice(-1)[0]);
  await sleep(1500);

  if (PHASE === 'before') {
    // 1. 레일: 기본 런처 셋
    await shot(page, '1-rail');
    // 2. 설정 › 런처 탭
    await settings(page);
    await shot(page, '2-launchers-tab');
    // 3. 새 런처: 하네스 드롭다운(고를 수 있는 것)
    await page.click('[data-action="launcher-new"]');
    await page.waitForSelector('[data-role="launcher-form"]');
    await sleep(500);
    const opts = await page.evaluate(() => [...document.querySelectorAll('[data-field="launcher-harness"] option')].map((o) => `${o.value}:${o.textContent}`));
    step('하네스 드롭다운에 실행 명령(ocx claude)을 고를 칸이 없다', !opts.some((o) => /ocx/.test(o)), opts);
    const fields = await page.evaluate(() => [...document.querySelectorAll('[data-role="launcher-form"] [data-field]')].map((e) => e.dataset.field));
    step('Claude Code 틀의 칸', true, fields);
    await page.fill('[data-field="launcher-name"]', 'ocx');
    await sleep(500);
    await shot(page, '3-new-claude-form');
    // 4. 원하는 것이 없어 "명령"으로 바꾸고 명령을 손으로 친다(판 세션이 아니다: 입력할 명령)
    await page.selectOption('[data-field="launcher-harness"]', 'command');
    await sleep(300);
    await page.fill('[data-field="launcher-command"]', 'ocx claude --model haiku --permission-mode manual');
    await sleep(700);
    const pv = await page.textContent('[data-role="launcher-form-preview"]');
    step('명령 런처는 "입력할 명령"(판 hook 없음)', /입력할 명령|Typed|Command to type/i.test(pv), pv);
    await shot(page, '4-command-form');
    // 5. 레일에 넣기(체크)와 만들기
    const fav = await page.isChecked('[data-field="launcher-favorite"]').catch(() => null);
    step('레일에 넣기 칸이 틀 아래쪽에 있다(기본 켜짐)', fav === true, fav);
    await page.click('[data-action="launcher-save"]');
    await page.waitForSelector('[data-role="launchers-list"]');
    await sleep(500);
    await shot(page, '5-list-after-create');
    await closeSettings(page);
    await sleep(500);
    await shot(page, '6-rail-after');
    // 6. 레일의 셸 런처를 누르면 이름을 묻지 않고 바로 생긴다
    const before = (await sessionsByName(page)).length;
    await page.click('[data-role="rail-favorites"] [data-launcher="shell"]');
    await until(async () => (await sessionsByName(page)).length > before, 20000);
    await sleep(1500);
    const ss = await sessionsByName(page);
    step('레일 단추는 누르자마자 세션을 만든다(이름은 판이 짓는다)', ss.length === before + 1, ss.map((s) => s.name));
    await shot(page, '7-rail-spawned');
    for (const s of ss) { try { atrium('kill', s.name, '--yes'); } catch {} }
    // 만든 명령 런처는 지운다(다음 단계는 같은 판에서 새로)
    const d = await call(page, 'launcher.list');
    for (const l of d.launchers) if (!['claude', 'codex', 'shell'].includes(l.id)) await call(page, 'launcher.delete', { id: l.id });
  }

  if (PHASE === 'after') await import('./p97-after.mjs').then((m) => m.run({ page, call, atrium, step, shot, log, settings, closeSettings, sessionsByName, sleep, until }));
  if (PHASE === 'live') await import('./p97-live.mjs').then((m) => m.run({ page, app, call, atrium, step, shot, log, settings, closeSettings, sessionsByName, sleep, until, ENV, WS, launch }));
  if (PHASE === 'restart') await import('./p97-live.mjs').then((m) => m.restart({ page, call, atrium, step, shot, log, sleep, until }));
} catch (e) {
  step('예외', false, e.stack || e.message);
  try { if (page) await shot(page, 'error'); } catch {}
} finally {
  if (app) await closeApp(app);
  const bad = results.filter((r) => !r.ok);
  log(`결과: ${results.length - bad.length}/${results.length} 통과`);
  fs.writeFileSync(path.join(OUT, `p97-${PHASE}-results.json`), JSON.stringify(results, null, 1));
  process.exit(bad.length ? 1 : 0);
}
