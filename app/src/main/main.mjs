// Atrium 창(Electron main). 창 하나에 판을 그린다(ARCH 1절).
// - 프로필은 atrium CLI와 같은 방법으로 고른다: --dev 또는 ATRIUM_PROFILE=dev, ATRIUM_* 환경 변수(옛 이름 MTASK_*도)가 기본값을 덮는다(backend/src/config.mjs).
// - P18: 실제 판 프로필은 처음 뜰 때 옛 창 프로필(multitask-app-real)을 새 프로필(atrium-app-real)로 복사한다(창 크기·사이드바 접힘 등 localStorage).
// - 백엔드가 없으면 띄운다. 백엔드는 herdr 서버가 없으면 깨끗한 환경으로 띄운다. 창을 닫아도 백엔드와 herdr는 계속 돈다(ARCH 1절 "백엔드 수명", P2에서 정함).
// - 창(renderer)은 백엔드 WebSocket API에 직접 붙는다. main은 주소와 토큰만 넘긴다.
import { app, BrowserWindow, ipcMain, shell, Notification, dialog, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, BACKEND_ROOT, APP_NAME, APP_ID, envVar, legacyAppUserData } from '../../../backend/src/config.mjs';
import { startBackend, stopBackend, backendInfo, health } from '../../../backend/src/client.mjs';
import { restartBlockSync } from '../../../backend/src/update-lease.mjs';
import { startTray, whenBoardReady } from './tray.mjs'; // I7(P6b): 트레이 상주
import { translate, DEFAULT_LANGUAGE } from '../renderer/lib/i18n.js'; // P16: 대화상자 글. 언어는 트레이가 받은 판 설정
import { macCliDirectories } from './cli-paths.mjs';
import { migrateAppProfile } from './profile.mjs'; // P18: 옛 창 프로필 옮기기
import { noticeWay } from '../renderer/lib/remote.js'; // P58: 원격 붙음 알림은 창이 숨었을 때만 OS 알림
import { windowTitle } from '../renderer/lib/update-notice.js'; // P71: 창 제목에 버전

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..', '..');
// Finder 실행은 터미널 PATH를 물려받지 않으므로 설치 시 확인한 CLI 위치를 보완한다.
if (fs.existsSync(path.join(process.resourcesPath, 'runtime', 'cli-paths.json'))) {
  try {
    const dirs = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'runtime', 'cli-paths.json'), 'utf8'));
    if (Array.isArray(dirs)) process.env.PATH = [...new Set([...dirs.filter((d) => typeof d === 'string' && path.isAbsolute(d)), ...(process.env.PATH || '').split(path.delimiter)])].join(path.delimiter);
  } catch {}
}
const bundledNode = path.join(process.resourcesPath, 'runtime', 'node');
if (process.platform === 'darwin') process.env.PATH = [...new Set([...(fs.existsSync(bundledNode) ? [path.dirname(bundledNode)] : []), ...(process.env.PATH || '').split(path.delimiter), ...macCliDirectories(app.getPath('home'))])].filter(Boolean).join(path.delimiter);
// Atrium 로고(app/design/brand에서 가져옴): 창·작업 표시줄·Alt+Tab은 ico, 알림은 256px PNG
const WINDOW_ICON = path.join(APP_ROOT, 'assets', process.platform === 'win32' ? 'icon.ico' : 'atrium-icon-256.png');
const NOTIFY_ICON = path.join(APP_ROOT, 'assets', 'atrium-icon-256.png');
const cfg = loadConfig({ argv: process.argv });
const APP_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version; } catch { return null; } })(); // P69
let updating = false; // P69: 업데이트로 끝나는 중

// 프로필마다 Electron 사용자 데이터를 따로 둔다(개발용 창과 실제 판 창이 섞이지 않게)
app.setPath('userData', path.join(app.getPath('appData'), `${APP_ID}-app-${cfg.profile}`));
if (envVar('APP_USERDATA')) app.setPath('userData', path.resolve(envVar('APP_USERDATA')));

const logFile = path.join(cfg.logDir, 'app-main.log');
const early = []; // 창이 뜨기 전 일(옛 창 프로필 복사)의 기록. app start 줄 뒤에 남긴다
function log(...a) {
  const line = `${new Date().toISOString()} ${a.join(' ')}`;
  try { fs.mkdirSync(cfg.logDir, { recursive: true }); fs.appendFileSync(logFile, line + '\n'); } catch {}
}

// P18: 옛 창 프로필을 새 프로필로 복사한다(profile.mjs). 단일 실행 잠금이 새 프로필 폴더를 만들기 전에 한다
const appMigration = (() => { try { return migrateAppProfile(legacyAppUserData(cfg), app.getPath('userData')); } catch (e) { return { failed: [String(e.message)] }; } })();
if (appMigration) early.push(`app profile migrated ${JSON.stringify({ ...appMigration, failed: appMigration.failed.slice(0, 10) })}`);
if (!app.requestSingleInstanceLock()) app.quit();

let starting = null;
function deferUpdateRestart() {
  if (!updating && restartBlockSync(cfg, { allowPermit: false })) onUpdateRestart({ kind: 'update' });
  return updating;
}
async function ensureBackend() {
  if (deferUpdateRestart()) return new Promise(() => {});
  const info = backendInfo(cfg);
  const live = info && await health(info.port);
  if (deferUpdateRestart()) return new Promise(() => {});
  if (live) return info;
  starting ||= startBackend(cfg, { nodePath: envVar('NODE') || (fs.existsSync(bundledNode) ? bundledNode : 'node') })
    .then((r) => { if (deferUpdateRestart()) return new Promise(() => {}); log('backend', JSON.stringify({ ...r, herdr: r.herdr && r.herdr.compat })); return backendInfo(cfg); })
    .catch((e) => { if (deferUpdateRestart()) return new Promise(() => {}); log('backend start failed', e.message); if (tray) tray.noteError(e.message); throw e; })
    .finally(() => { starting = null; });
  return starting;
}

ipcMain.handle('mt:backend', async () => {
  const info = await ensureBackend();
  return {
    platform: process.platform, port: info.port, token: info.token, pid: info.pid, profile: cfg.profile, herdrSession: cfg.herdrSession,
    // 새 세션 대화상자의 기본 폴더. 개발용은 시험 프로젝트(신뢰된 폴더 아래, 따로 git 저장소가 아님, P1 5절 11)
    defaultCwd: cfg.profile === 'dev' ? path.join(BACKEND_ROOT, '.dev', 'proj') : app.getPath('home'),
    defaultModel: cfg.profile === 'dev' ? 'haiku' : '',
    deviceName: os.hostname(), clientKind: 'desktop', // P47: 백엔드에 알리는 기기 이름과 클라이언트 종류
    appVersion: APP_VERSION, // P69: 이 창의 버전(설정 › 업데이트)
  };
});
// E5: Electron 프로세스(main, renderer, GPU 등)의 메모리와 CPU
ipcMain.handle('mt:metrics', () => app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, cpu: m.cpu.percentCPUUsage, memKB: m.memory.workingSetSize, privateKB: m.memory.privateBytes })));
ipcMain.on('mt:log', (_e, line) => log('[renderer]', String(line).slice(0, 2000)));
// P5: "+ 리포 열기"의 폴더 고르기
ipcMain.handle('mt:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: tr('main.pickFolder'), properties: ['openDirectory'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

// A1 OS 알림(P3). 띄울지는 창(renderer)이 정한다(같은 대기에 한 번, 창에 초점이 있고 그 노드가 보이면 띄우지 않음).
// 누르면 창을 앞으로 가져오고 그 노드로 화면을 옮긴다. 알림 객체를 들고 있어야 Windows에서 눌림 이벤트가 온다.
const notifications = [];
global.__mtNotifications = notifications; // 시험(Playwright)이 눌림을 흉내 낸다
ipcMain.handle('mt:notify', (_e, n) => {
  if (!Notification.isSupported()) return { shown: false, reason: 'unsupported' };
  // P58: ifHidden이면 창이 보이고 초점이 있을 때 띄우지 않는다(창의 실제 상태는 main이 안다)
  if (n.ifHidden && win && !win.isDestroyed() && !noticeWay({ visible: win.isVisible() && !win.isMinimized(), focused: win.isFocused() }).os) return { shown: false, reason: 'window-visible' };
  const note = new Notification({ title: String(n.title || APP_NAME).slice(0, 120), body: String(n.body || '').slice(0, 240), icon: NOTIFY_ICON, silent: false });
  const rec = { sessionId: n.sessionId, key: n.key, at: Date.now(), shown: false, clicked: false, note };
  note.on('show', () => { rec.shown = true; log(`notification shown ${n.sessionId} ${n.key}`); });
  note.on('click', () => {
    rec.clicked = true;
    log(`notification clicked ${n.sessionId}`);
    showNode(n.sessionId);
  });
  note.on('close', () => { const i = notifications.indexOf(rec); if (i >= 0 && notifications.length > 20) notifications.splice(i, 1); });
  notifications.push(rec);
  if (notifications.length > 50) notifications.shift();
  note.show();
  return { shown: true };
});

let win = null;
let tray = null;
// I7: 트레이가 창이 없는 동안 띄운 알림의 열쇠. 창이 뜰 때 preload가 창의 "알린 대기" 기록에 합친다
ipcMain.on('mt:trayNotified', (e) => { e.returnValue = tray ? tray.notifiedKeys() : []; });
// 창을 앞으로 가져오고(없으면 다시 만든다) 그 노드로 간다. 새 창이면 판을 다 읽은 뒤에 보낸다(I7)
function showNode(sessionId) {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  const w = win;
  if (sessionId) whenBoardReady(w.webContents).then((ok) => { if (ok && !w.isDestroyed()) w.webContents.send('mt:navigate', sessionId); });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 900, minHeight: 600, icon: WINDOW_ICON,
    title: windowTitle(APP_NAME, APP_VERSION, cfg.profile), // P71: "Atrium 0.1.2", 개발용 판은 " (dev)"
    backgroundColor: '#070705', // P11·P28: 판 바탕(renderer tokens.css --canvas). 창이 뜰 때 다른 색이 번쩍이지 않게
    webPreferences: { preload: path.join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.setMenuBarVisibility(false);
  win.on('page-title-updated', (e) => e.preventDefault()); // P9: HTML <title>이 개발용 표시("(dev)")를 덮어쓰지 않게
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('render-process-gone', (_e, d) => log('render-process-gone', JSON.stringify(d)));
  // E5 2.5 조사(P3): 창이 다시 읽히거나 프로세스를 잃었는지 남긴다
  win.webContents.on('did-start-navigation', (d) => { if (d.isMainFrame) log(`navigation start ${d.isSameDocument ? 'same-doc ' : ''}${String(d.url).replace(/^file:.*\/dist\//, 'dist/')}`); });
  win.webContents.on('did-finish-load', () => log('page loaded'));
  win.webContents.on('unresponsive', () => log('renderer unresponsive'));
  win.webContents.on('responsive', () => log('renderer responsive'));
  win.loadFile(path.join(APP_ROOT, 'dist', 'index.html'));
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => { if (!updating) showNode(null); }); // 트레이에 남아 있을 때 다시 실행하면 창을 다시 연다(I7)
// Windows 알림의 앱 이름. 실제 판과 개발용을 나눈다
if (process.platform === 'win32') app.setAppUserModelId(`${APP_ID}.${cfg.profile}`);
app.on('activate', () => showNode(null));
// P14: 트레이 메뉴의 확인창. 시험은 global.__mtTrayConfirm으로 답을 정한다
const tr = (key, vars) => translate(tray ? tray.lang() : DEFAULT_LANGUAGE, key, vars);
async function trayConfirm({ message, detail, ok }) {
  if (typeof global.__mtTrayConfirm === 'function') return !!global.__mtTrayConfirm({ message, detail });
  const r = await dialog.showMessageBox({ type: 'warning', title: tr('app.name'), message, detail, buttons: [ok || tr('common.ok'), tr('common.cancel')], defaultId: 1, cancelId: 1, noLink: true });
  return r.response === 0;
}
// P69: 업데이트로 백엔드를 바꾼다. 창을 닫고 앱을 끝낸다(트레이 상주여도). 새 버전의 창은 바꾸기 프로세스가 띄운다
function onUpdateRestart(d) {
  updating = true;
  log(`update restart: quitting for ${d && d.to ? d.to.tag : '?'}`);
  if (tray) tray.stop();
  if (win && !win.isDestroyed()) win.destroy();
  app.quit();
}
app.whenReady().then(() => {
  if (deferUpdateRestart()) return;
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    app.dock?.setIcon(NOTIFY_ICON);
  }
  log(`app start profile=${cfg.profile} pid=${process.pid} version=${APP_VERSION} root=${path.basename(path.resolve(APP_ROOT, '..'))}`);
  for (const l of early) log(l);
  createWindow();
  tray = startTray({ cfg, log, hasWindow: () => !!win, showNode, quit: () => app.quit(), notifications, closeWindow: () => { if (win) win.close(); }, startBackend: ensureBackend, stopBackend: () => stopBackend(cfg), confirm: trayConfirm, onUpdateRestart, appVersion: APP_VERSION });
  global.__mtTray = tray;
  global.__mtAppMigration = appMigration; // 시험이 읽는다
  if (appMigration && appMigration.failed.length) tray.noteError(tr('tray.profileCopyFailed', { n: appMigration.failed.length }));
});
app.on('child-process-gone', (_e, d) => log('child-process-gone', JSON.stringify(d))); // GPU 프로세스를 잃으면 모든 WebGL 컨텍스트를 잃는다
// 창을 닫으면 앱만 끝난다. 백엔드와 herdr, 그 안의 claude 세션은 계속 돈다(C1). 트레이 상주(기본 켜짐)면 앱은 트레이에 남는다(I7, P14)
app.on('window-all-closed', () => {
  if (tray && tray.keepRunning()) { log('window closed, app stays in tray'); tray.onWindowClosed(); return; }
  log('window closed, app quits (backend keeps running)'); app.quit();
});
