// P9 실제 판 실행 창 시험(시험 판 값으로 덮어서):
// 1) 바로가기가 부르는 real.cmd → 실제 판 프로필 창(dev 표시 없음), 2) 같은 프로필로 한 번 더 → 한 창만 남음,
// 3) 개발용 프로필 창(dev 표시, 창 제목 "(dev)")이 함께 뜸, 4) npm run real도 실제 판 프로필, 5) 바로가기 스크립트로 시험 폴더에 만든 바로가기의 대상·인자·작업 폴더
// 사용(app 폴더에서): MT_E2E_OUT=p9 node test/e2e/p9-real.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { ENV, DEV, DIRS, APP_ROOT, launchProfile, runRealCmd, attachCdp, alive, windowTitle, closeApp, shot, logger, sleep, until, writeJson, OUT } from './p9-lib.mjs';

const log = logger('p9-real');
const result = {};
const appLog = (dir) => { try { return fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'logs', 'app-main.log'), 'utf8'); } catch { return ''; } };
const badge = (page) => page.evaluate(() => { const e = document.querySelector('[data-role="dev-badge"]'); return e ? e.textContent : null; });
const opened = [];
try {
  // 1) real.cmd(바로가기 대상). 원격 디버깅 포트로 붙어 화면을 본다
  const r1 = runRealCmd(['--remote-debugging-port=9391']);
  log('real.cmd', r1.out);
  result.realCmd = { out: r1.out, pid: r1.pid };
  opened.push(r1.pid);
  const { browser, page } = await attachCdp(9391, log);
  await sleep(1500);
  result.realCmd.badge = await badge(page);
  result.realCmd.docTitle = await page.title();
  result.realCmd.windowTitle = windowTitle(r1.pid);
  result.realCmd.backend = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'backend.json'), 'utf8'));
  delete result.realCmd.backend.token;
  result.realCmd.appLog = appLog().split('\n').filter((l) => l.includes(`pid=${r1.pid}`));
  result.realCmd.info = await page.evaluate(() => ({ profile: window.__mt.api.info.profile, terminalSession: window.__mt.api.info.terminalSession, port: window.__mt.api.info.port }));
  log('real.cmd 창', JSON.stringify(result.realCmd));
  await shot(page, 'real-1-real-profile-no-dev-badge', log);

  // 2) 같은 프로필로 한 번 더 → 둘째 창은 바로 끝나고 첫 창이 남는다
  const r2 = runRealCmd([]);
  await until(async () => !alive(r2.pid), 20000, 300).catch(() => {});
  result.singleInstance = { secondPid: r2.pid, secondAlive: alive(r2.pid), firstAlive: alive(r1.pid) };
  log('단일 인스턴스', JSON.stringify(result.singleInstance));

  // 3) 개발용 프로필 창(창 프로필은 따로)이 함께 뜬다
  const dev = await launchProfile({ profile: 'dev', env: { ATRIUM_APP_USERDATA: path.join(DEV, 'app-dev') }, log });
  await sleep(1500);
  result.dev = { badge: await badge(dev.page), title: await dev.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), docTitle: await dev.page.title(), realStillAlive: alive(r1.pid) };
  log('개발용 창', JSON.stringify(result.dev));
  await shot(dev.page, 'real-2-dev-profile-badge', log);
  await closeApp(dev.app);

  // real.cmd 창 닫기(창 화면에서 닫으면 앱이 끝난다. 백엔드와 herdr는 남는다)
  await page.evaluate(() => window.close()).catch(() => {});
  await until(async () => !alive(r1.pid), 20000, 300).catch(() => {});
  result.realCmd.closed = !alive(r1.pid);
  await browser.close().catch(() => {});

  // 4) npm run real(빌드 뒤 electron .). 창 프로필은 따로 둔다
  const npm = spawn('cmd.exe', ['/d', '/c', 'npm', 'run', 'real', '--', '--remote-debugging-port=9392'], { cwd: APP_ROOT, env: { ...process.env, ...ENV, ATRIUM_APP_USERDATA: path.join(DEV, 'app-npm') }, stdio: 'ignore', windowsHide: true });
  const n = await attachCdp(9392, log);
  await sleep(1000);
  result.npmReal = { badge: await badge(n.page), info: await n.page.evaluate(() => ({ profile: window.__mt.api.info.profile, terminalSession: window.__mt.api.info.terminalSession, port: window.__mt.api.info.port })) };
  log('npm run real 창', JSON.stringify(result.npmReal));
  await shot(n.page, 'real-3-npm-run-real', log);
  await n.page.evaluate(() => window.close()).catch(() => {});
  await until(async () => npm.exitCode != null, 20000, 300).catch(() => {});
  result.npmReal.exited = npm.exitCode;
  await n.browser.close().catch(() => {});

  // 5) 바로가기 스크립트: 시험 폴더에만 만든다(사용자 바탕화면은 쓰지 않는다)
  fs.mkdirSync(DIRS.shortcut, { recursive: true });
  const lnk = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(APP_ROOT, 'scripts', 'make-shortcut.ps1'), '-Dest', DIRS.shortcut], { encoding: 'utf8' }).trim();
  const read = execFileSync('powershell.exe', ['-NoProfile', '-Command', `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk}'); [pscustomobject]@{Target=$s.TargetPath;Arguments=$s.Arguments;WorkDir=$s.WorkingDirectory;WindowStyle=$s.WindowStyle;Icon=$s.IconLocation;Description=$s.Description} | ConvertTo-Json`], { encoding: 'utf8' });
  result.shortcut = { file: lnk, ...JSON.parse(read) };
  result.shortcut.ok = path.resolve(result.shortcut.Target) === path.join(APP_ROOT, 'scripts', 'real.cmd') && path.resolve(result.shortcut.WorkDir) === APP_ROOT && result.shortcut.Arguments === '' && result.shortcut.WindowStyle === 7;
  log('바로가기', JSON.stringify(result.shortcut));

  result.pass = {
    realProfileNoBadge: result.realCmd.info.profile === 'real' && result.realCmd.badge === null && result.realCmd.windowTitle === 'Atrium' && result.realCmd.backend.profile === 'real',
    singleInstance: !result.singleInstance.secondAlive && result.singleInstance.firstAlive,
    devBadge: result.dev.badge === 'dev' && result.dev.title === 'Atrium (dev)' && result.dev.realStillAlive,
    npmReal: result.npmReal.info.profile === 'real' && result.npmReal.badge === null,
    shortcut: result.shortcut.ok,
  };
  log('판정', JSON.stringify(result.pass));
  if (Object.values(result.pass).some((v) => !v)) process.exitCode = 1;
} catch (e) { log('FAIL', e.stack); process.exitCode = 1; }
writeJson('p9-real.json', result);
for (const pid of opened) if (alive(pid)) { log(`남은 창 끄기 pid=${pid}`); try { process.kill(pid); } catch {} }
setTimeout(() => process.exit(process.exitCode || 0), 500);
