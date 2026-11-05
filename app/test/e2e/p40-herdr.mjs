// P40 창 시험: herdr 찾기, herdr 없음, 경로 지정, 패널 PATH, 시험하지 않은 버전, 다른 프로토콜.
// 판: herdr 세션 atrium-dev-p40, 포트 47858, 이 워크트리의 backend/.dev. 셸 노드만 쓴다. 사용자가 설치한 herdr는 읽기만 한다.
// "없음"은 시험용 env(없는 ATRIUM_HERDR, herdr 폴더를 뺀 PATH, 가짜 USERPROFILE·LOCALAPPDATA)로 흉내 낸다.
// "다른 버전"과 "다른 프로토콜"은 ATRIUM_HERDR_TESTED·ATRIUM_HERDR_PROTOCOLS로 흉내 낸다.
// 사용: MT_E2E_OUT=p40 node test/e2e/p40-herdr.mjs   (app 폴더에서). 끝에 시험 세션, 백엔드, herdr 서버(atrium-dev-p40만), 시험 폴더를 지운다
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp, shot } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p40') throw new Error('MT_E2E_OUT=p40을 명령줄에서 준다');
const DEV = path.join(REPO, 'backend', '.dev');
const PROJ = 'C:\\Workspace\\mtask-p40-proj';
const FAKE = path.join(DEV, 'p40-fake'); // 가린 홈과 LOCALAPPDATA
const ENV = {
  ATRIUM_HERDR_SESSION: 'atrium-dev-p40', ATRIUM_PORT: '47858',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: path.join(DEV, 'p40-projects'), ATRIUM_CLAUDE_SESSIONS: path.join(DEV, 'p40-sessions'), ATRIUM_CLAUDE_DESKTOP: 'none',
};
assertTestBoard(ENV, { root: DEV });
const log = logger('p40-herdr');
const result = { steps: {} };
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE|ATRIUM_|MTASK_)/.test(k)));
const baseEnv = { ...cleanEnv(), ...ENV };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: baseEnv, timeout: 120000 });
const fail = (m) => { throw new Error(m); };
const short = (p) => String(p || '').replace(process.env.USERPROFILE || '\u0000', '%USERPROFILE%'); // 기록에 사용자 경로를 남기지 않는다

// 사용자가 설치한 herdr(읽기만): 설치기 current 링크, 없으면 PATH 첫 줄
const home = process.env.USERPROFILE;
let REAL = path.join(home, '.herdr', 'packages', 'standalone', 'current', 'herdr.exe');
if (!fs.existsSync(REAL)) REAL = execFileSync('where.exe', ['herdr'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
log('real herdr', short(REAL));

// herdr 폴더를 뺀 PATH
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH');
const maskedPath = process.env[pathKey].split(';').filter((d) => d && !fs.existsSync(path.join(d, 'herdr.exe'))).join(';');
const maskedEnv = { ...baseEnv, [pathKey]: maskedPath, USERPROFILE: path.join(FAKE, 'home'), LOCALAPPDATA: path.join(FAKE, 'local'), ATRIUM_HERDR: path.join(FAKE, 'nope', 'herdr.exe') };

let backendPid = null;
function startBackend(env, label) {
  const out = fs.openSync(path.join(OUT, `backend-${label}.out`), 'a');
  const p = spawn(process.execPath, [path.join(REPO, 'backend', 'src', 'main.mjs'), '--dev'], { env, detached: true, stdio: ['ignore', out, out], windowsHide: true });
  p.unref(); fs.closeSync(out);
  backendPid = p.pid;
  return p;
}
async function waitBackend(t0) {
  return until(async () => {
    try { const b = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'backend.json'), 'utf8')); if (b.pid !== backendPid) return null; const r = await fetch(`http://127.0.0.1:${ENV.ATRIUM_PORT}/health`).catch(() => null); return r && r.ok ? Date.now() - t0 : null; } catch { return null; }
  }, 60000, 100);
}
function stopBackend() { try { log('backend stop', atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log('backend stop error', e.message.slice(0, 200)); } }

let app = null, page = null;
const call = (m, p = {}) => page.evaluate(async ([mm, pp]) => { try { return { ok: true, r: await window.__mt.api.call(mm, pp) }; } catch (e) { return { ok: false, code: e.code, key: e.key, message: e.message }; } }, [m, p]);
async function openWindow() {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env: baseEnv, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.setViewportSize({ width: 1500, height: 900 }).catch(() => {});
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true)); // P43: 아래 바를 늘 보이게(이 시험은 바를 바로 누른다)
  await sleep(2600); // 처음 화면이 사라질 때까지
}
async function closeWindow() { if (app) await closeApp(app); app = null; page = null; await sleep(800); }
const herdrState = () => page.evaluate(() => window.__mt.getState().herdr);

try {
  // ---------- 준비 ----------
  fs.mkdirSync(OUT, { recursive: true });
  for (const d of [path.join(FAKE, 'home'), path.join(FAKE, 'local'), ENV.ATRIUM_CLAUDE_PROJECTS, ENV.ATRIUM_CLAUDE_SESSIONS, PROJ]) fs.mkdirSync(d, { recursive: true });
  if (fs.existsSync(path.join(ENV.ATRIUM_DATA_DIR, 'backend.json'))) stopBackend();

  // ---------- 1. 없는 경로 ----------
  let t0 = Date.now();
  startBackend(maskedEnv, 'missing');
  const upMs = await waitBackend(t0);
  log('backend up (missing herdr) ms', upMs);
  result.steps.missing = { backendUpMs: upMs };
  const st1 = JSON.parse(atrium('--json', 'herdr', 'status'));
  log('herdr status (missing)', { running: st1.running, connected: st1.connected, level: st1.level, missing: st1.missing, tried: st1.find && st1.find.tried.map((t) => `${t.source}:${t.error || t.version}`) });
  if (st1.level !== 'missing' || !st1.missing) fail('missing 상태가 아니다');
  if (upMs > 10000) fail(`백엔드가 늦게 떴다 ${upMs}ms`);
  result.steps.missing.tried = st1.find.tried.length;
  await openWindow();
  await call('settings.set', { key: 'language', value: 'ko' });
  await sleep(500);
  await page.waitForSelector('[data-role="herdr-missing"]', { timeout: 15000 });
  await page.click('[data-role="herdr-tried"] summary');
  await sleep(300);
  await shot(page, 'p40-1-missing-band', log);
  const sp = await call('session.spawn', { cwd: PROJ, kind: 'shell' });
  log('spawn while missing', sp);
  if (sp.ok || sp.code !== 'herdr_missing') fail('herdr 없음에서 세션이 막히지 않았다');
  result.steps.missing.spawn = { code: sp.code, key: sp.key };
  // 새 세션 창으로도 막힘을 본다(herdr가 없으니 어떤 호출자로도 뜨지 않는다)
  await page.click('[data-action="chip-spawn"]').catch(() => log('chip-spawn 단추 없음'));
  await sleep(500);
  const cwdField = await page.$('[data-field="cwd"]');
  if (cwdField) await cwdField.fill(PROJ);
  await page.click('[data-action="spawn-submit"]').catch((e) => log('spawn-submit', e.message.slice(0, 100)));
  await sleep(800);
  await shot(page, 'p40-1-missing-spawn-blocked', log);
  await page.click('[data-role="spawn"] button.mt-btn.ghost').catch(() => {}); // 취소
  await sleep(300);

  // ---------- 2. 경로 지정 ----------
  await page.click('[data-action="herdr-settings"]');
  await page.waitForSelector('[data-field="setting-herdrPath"]', { timeout: 10000 });
  await page.fill('[data-field="setting-herdrPath"]', REAL);
  await shot(page, 'p40-2-settings-path', log);
  t0 = Date.now();
  await page.click('[data-action="herdr-path-save"]');
  await until(async () => (await herdrState()).connected === true, 30000, 200);
  const attachMs = Date.now() - t0;
  log('attached after setting path ms', attachMs);
  await sleep(600);
  await shot(page, 'p40-2-settings-connected', log);
  await page.keyboard.press('Escape');
  const st2 = JSON.parse(atrium('--json', 'herdr', 'status'));
  log('herdr status (path set)', { connected: st2.connected, level: st2.level, path: short(st2.path), chosen: st2.find && st2.find.chosen && st2.find.chosen.source });
  if (!st2.connected || st2.level !== 'ok') fail('경로 지정 뒤 붙지 않았다');
  if (st2.find.chosen.source !== 'setting') fail(`고른 까닭이 setting이 아니다: ${st2.find.chosen.source}`);
  const b2 = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'backend.json'), 'utf8'));
  if (b2.pid !== backendPid) fail('백엔드가 다시 켜졌다');
  const sp2 = await call('session.spawn', { cwd: PROJ, kind: 'shell', name: 'p40sh1' });
  log('spawn after path set', sp2.ok ? { name: sp2.r.name, paneId: sp2.r.paneId } : sp2);
  if (!sp2.ok) fail('경로 지정 뒤 세션을 띄우지 못했다');
  result.steps.setPath = { attachMs, backendSame: true, spawn: true };

  // ---------- 3. 패널 PATH ----------
  await sleep(4000);
  atrium('input', 'p40sh1', 'where.exe herdr\\r');
  await sleep(2500);
  const scr = atrium('screen', 'p40sh1', '--text');
  const lines = scr.split(/\r?\n/);
  const i = lines.findIndex((l) => /where\.exe herdr/.test(l));
  const first = i >= 0 ? (lines.slice(i + 1).find((l) => l.trim()) || '').trim() : '';
  log('where herdr first line', short(first), 'server exe', short(st2.path));
  // 같은 글자로 견준다(current는 버전 폴더를 가리키는 정션이라, 실제 경로로 견주면 사용자 PATH 순서 덕에 우연히 맞을 수 있다)
  const okPath = first.toLowerCase() === String(st2.path).toLowerCase();
  atrium('input', 'p40sh1', '$env:Path.Split(\';\')[0..2]\\r');
  await sleep(2000);
  const scr2 = atrium('screen', 'p40sh1', '--text').split(/\r?\n/);
  const j = scr2.findIndex((l) => /Split/.test(l));
  const firstDirs = j >= 0 ? scr2.slice(j + 1, j + 4).map((l) => short(l.trim())) : [];
  log('panel PATH first entries', firstDirs);
  const firstDirOk = (firstDirs[0] || '').toLowerCase() === short(path.dirname(st2.path)).toLowerCase();
  result.steps.panelPath = { firstLine: short(first), serverExe: short(st2.path), firstLineIsServerExe: okPath, firstPathDirIsServerDir: firstDirOk, firstDirs };
  if (!firstDirOk) fail('패널 PATH의 첫 폴더가 서버 herdr 폴더가 아니다');
  await page.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p40sh1'); if (s) window.__mt.setFocus && window.__mt.setFocus(s.sessionId); });
  await sleep(1200);
  await shot(page, 'p40-3-panel-where', log);
  if (!okPath) fail('패널의 where herdr 첫 줄이 서버 실행 파일이 아니다');

  // ---------- 4. 시험하지 않은 버전 ----------
  await closeWindow();
  stopBackend();
  await sleep(1000);
  t0 = Date.now();
  startBackend({ ...baseEnv, ATRIUM_HERDR_TESTED: '0.0.1' }, 'untested');
  log('backend up (untested) ms', await waitBackend(t0));
  await openWindow();
  await page.waitForSelector('[data-role="herdr-untested"]', { timeout: 20000 });
  const h4 = await herdrState();
  log('herdr state (untested)', { level: h4.level, warning: h4.warning, version: h4.version, connected: h4.connected });
  const sp4 = await call('session.spawn', { cwd: PROJ, kind: 'shell', name: 'p40sh2' });
  log('spawn with untested version', sp4.ok ? { name: sp4.r.name } : sp4);
  if (!sp4.ok) fail('검증하지 않은 버전에서 세션을 띄우지 못했다');
  await sleep(1500);
  await shot(page, 'p40-4-untested-band', log);
  const st4 = JSON.parse(atrium('--json', 'herdr', 'status'));
  log('herdr status (untested)', { level: st4.level, warning: st4.warning, chosen: st4.find && st4.find.chosen && st4.find.chosen.source, serverExe: short(st4.find && st4.find.serverExe) });
  result.steps.untested = { level: h4.level, spawn: true, chosen: st4.find.chosen.source };

  // ---------- 5. 다른 프로토콜 ----------
  await closeWindow();
  stopBackend();
  await sleep(1000);
  t0 = Date.now();
  startBackend({ ...baseEnv, ATRIUM_HERDR_PROTOCOLS: '99' }, 'protocol');
  log('backend up (protocol 99) ms', await waitBackend(t0));
  await openWindow();
  await page.waitForSelector('[data-role="herdr-incompatible"]', { timeout: 20000 });
  const sp5 = await call('session.spawn', { cwd: PROJ, kind: 'shell', name: 'p40sh3' });
  log('spawn with other protocol', sp5);
  if (sp5.ok || sp5.code !== 'herdr_incompatible') fail('다른 프로토콜에서 세션이 막히지 않았다');
  const nodes = await page.evaluate(() => window.__mt.getState().sessions.size);
  log('board sessions visible', nodes);
  await shot(page, 'p40-5-protocol-band', log);
  result.steps.protocol = { spawn: sp5.code, boardSessions: nodes };
  result.ok = true;
} catch (e) {
  log('FAIL', e.stack);
  result.ok = false; result.error = e.message;
  if (page) await shot(page, 'p40-fail', log).catch(() => {});
} finally {
  // ---------- 정리: 창, 백엔드, herdr 서버와 세션(atrium-dev-p40만), 시험 폴더 ----------
  await closeWindow().catch(() => {});
  stopBackend();
  await sleep(1000);
  const herdrArgs = (...a) => { try { return execFileSync(REAL, a, { encoding: 'utf8', timeout: 30000, env: cleanEnv() }).trim(); } catch (e) { return `error ${e.message.slice(0, 120)}`; } };
  if (!process.argv.includes('--keep')) {
    log('herdr server stop', herdrArgs('--session', 'atrium-dev-p40', 'server', 'stop'));
    await sleep(1500);
    log('herdr session delete', herdrArgs('session', 'delete', 'atrium-dev-p40'));
    for (const d of [PROJ, FAKE, ENV.ATRIUM_CLAUDE_PROJECTS, ENV.ATRIUM_CLAUDE_SESSIONS, ENV.ATRIUM_DATA_DIR, ENV.ATRIUM_APP_USERDATA]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { log('rm', short(d), e.message); } }
  }
  fs.writeFileSync(path.join(OUT, 'p40-herdr.json'), JSON.stringify(result, null, 2));
  log('result', result);
  process.exit(result.ok ? 0 : 1);
}
