// Atrium 창(Electron main). 창 하나에 판을 그린다(ARCH 1절).
// - 프로필은 atrium CLI와 같은 방법으로 고른다: --dev 또는 ATRIUM_PROFILE=dev, ATRIUM_* 환경 변수(옛 이름 MTASK_*도)가 기본값을 덮는다(backend/src/config.mjs).
// - P18: 실제 판 프로필은 처음 뜰 때 옛 창 프로필(multitask-app-real)을 새 프로필(atrium-app-real)로 복사한다(창 크기·사이드바 접힘 등 localStorage).
// - 백엔드가 없으면 띄운다. 백엔드는 터미널 서버(hc)가 없으면 깨끗한 환경으로 띄운다. 창을 닫아도 백엔드와 터미널 서버는 계속 돈다(ARCH 1절 "백엔드 수명", P2에서 정함).
// - 창(renderer)은 백엔드 WebSocket API에 직접 붙는다. main은 주소와 토큰만 넘긴다.
// - P69: 업데이트로 백엔드를 바꿀 때(update.restart) 앱을 끝낸다. 그동안 옛 백엔드를 다시 띄우지 않고, 다시 실행돼도 창을 열지 않는다. 새 창은 바꾸기 프로세스가 띄운다.
import { app, BrowserWindow, ipcMain, shell, Notification, dialog, Menu, clipboard, nativeImage, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { loadConfig, BACKEND_ROOT, APP_NAME, APP_ID, envVar, legacyAppUserData } from '../../../backend/src/config.mjs';
import { startBackend, stopBackend, backendInfo, health } from '../../../backend/src/client.mjs';
import { restartBlockSync } from '../../../backend/src/update-lease.mjs';
import { startTray, whenBoardReady } from './tray.mjs'; // I7(P6b): 트레이 상주
import { translate, DEFAULT_LANGUAGE } from '../renderer/lib/i18n.js'; // P16: 대화상자 글. 언어는 트레이가 받은 판 설정
import { macCliDirectories } from './cli-paths.mjs';
import { migrateAppProfile } from './profile.mjs'; // P18: 옛 창 프로필 옮기기
import { noticeWay } from '../renderer/lib/remote.js'; // P58: 원격 붙음 알림은 창이 숨었을 때만 OS 알림
import { windowTitle } from '../renderer/lib/update-notice.js'; // P71: 창 제목에 버전
import { shouldPurgeOnClose, purgeAndDestroy } from './gpu-purge.mjs';
import { permissionAllowed } from './media-permission.mjs'; // P165: 음성 입력 마이크 권한
import { uriListPaths, splitFolders, isImagePath } from '../renderer/lib/desktop-paste.js'; // P162: 붙여 넣은 파일 목록
import { uploadDirOf, uploadPath, cleanupUploads, UPLOAD_MAX_BYTES } from '../../../backend/src/uploads.mjs'; // P162: 붙여 넣은 그림 자리와 정리(P48 웹 업로드와 같은 곳·규칙) // P113: 창을 닫고 트레이에 남을 때 GPU 프로세스 메모리 돌려주기

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
let quitting = false; // P113: 앱을 끝내는 중(트레이 끝내기 등). 이때 닫는 창은 GPU 메모리를 돌려주지 않고 바로 닫는다
// P113: 창을 닫을 때 보낼 메모리 압박 단계. 기본 critical, 개발용 판의 비교 시험은 ATRIUM_GPU_PURGE=off|moderate
const GPU_PURGE = envVar('GPU_PURGE') || 'critical';

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
    .then((r) => { if (deferUpdateRestart()) return new Promise(() => {}); log('backend', JSON.stringify({ ...r, terminal: r.terminal && r.terminal.compat })); return backendInfo(cfg); })
    .catch((e) => { if (deferUpdateRestart()) return new Promise(() => {}); log('backend start failed', e.message); if (tray) tray.noteError(e.message); throw e; }) // P18: 옛 판을 옮기지 못한 까닭 등을 트레이에 보인다
    .finally(() => { starting = null; });
  return starting;
}

ipcMain.handle('mt:backend', async () => {
  const info = await ensureBackend();
  return {
    platform: process.platform, port: info.port, token: info.token, pid: info.pid, profile: cfg.profile, terminalSession: cfg.terminalSession, herdrSession: cfg.terminalSession,
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
  // macOS 판: 대화상자에 "새 폴더" 단추(createDirectory)를 둔다. 새 세션의 작업 폴더를 그 자리에서 만들 수 있게
  const r = await dialog.showOpenDialog(win, { title: tr('main.pickFolder'), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

// P162: 데스크톱 창의 붙여 넣기. 창은 클립보드에 파일이 있을 때 부른다(lib/desktop-paste.js wantsDesktopPaste).
// - 탐색기·Finder에서 복사한 파일 → { kind: 'files', paths, folders }. 폴더는 넣지 않고 수만 센다
// - 캡처한 그림 → 데이터 폴더 uploads/에 PNG로 두고 { kind: 'image', path, thumb }(thumb: 미리보기용 작은 data URL)
// - 둘 다 아니면 null(macOS에서는 부른 쪽이 클립보드 글을 그대로 넣는다)
const THUMB_MAX = 240;
function thumbOf(img) {
  try {
    if (!img || img.isEmpty()) return null;
    const { width, height } = img.getSize();
    const k = Math.min(1, THUMB_MAX / Math.max(width, height, 1));
    return (k < 1 ? img.resize({ width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }) : img).toDataURL();
  } catch { return null; }
}
// 그림 바이트를 uploads/에 두고 { path, thumb }
function saveUpload(buf, name, type) {
  const dir = uploadDirOf(cfg.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = uploadPath(dir, name, type);
  fs.writeFileSync(file, buf);
  try { cleanupUploads(dir, { keep: file }); } catch {}
  let thumb = null;
  if (/^image\//.test(type || '') || isImagePath(file)) { try { thumb = thumbOf(nativeImage.createFromBuffer(buf)); } catch {} }
  return { path: file, thumb };
}
const run = (cmd, args, timeout = 3000) => new Promise((res) => execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, out) => res(err ? null : String(out))));
// macOS: Finder가 복사한 파일들의 경로. 클립보드 API가 file 주소를 내주지 않거나 첫 파일만 줄 때가 있어 NSPasteboard에서 직접 읽는다(여러 파일)
const FINDER_FILES_JXA = 'ObjC.import("AppKit");const a=$.NSPasteboard.generalPasteboard.readObjectsForClassesOptions($([$.NSURL]),$({"NSPasteboardURLReadingFileURLsOnlyKey":true}));const o=[];if(a&&!a.isNil())for(let i=0;i<a.count;i++)o.push(ObjC.unwrap(a.objectAtIndex(i).path));JSON.stringify(o)';
async function macClipFiles() {
  const out = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FINDER_FILES_JXA]);
  try { const a = JSON.parse(String(out || '[]').trim() || '[]'); return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x).map((x) => x.normalize('NFC')) : []; } catch { return []; }
}
ipcMain.handle('mt:clipPaste', async () => {
  const isDir = (p) => fs.statSync(p).isDirectory();
  if (process.platform === 'darwin') {
    const mac = await macClipFiles();
    if (mac.length) return { kind: 'files', ...splitFolders(mac, isDir) };
  }
  let items;
  try { items = await clipboard.read(); } catch (e) { log('clipPaste read failed', e.message); return null; }
  for (const it of items) {
    if (!it.types.includes('text/uri-list')) continue;
    const all = uriListPaths(await (await it.getType('text/uri-list')).text(), { platform: process.platform });
    if (!all.length) continue;
    return { kind: 'files', ...splitFolders(all, isDir) };
  }
  for (const it of items) {
    if (!it.types.includes('image/png')) continue;
    const buf = Buffer.from(await (await it.getType('image/png')).arrayBuffer());
    if (!buf.length) continue;
    if (buf.length > UPLOAD_MAX_BYTES) return { kind: 'error', code: 'too_big' };
    const r = saveUpload(buf, 'pasted.png', 'image/png');
    log(`clipPaste image ${path.basename(r.path)} ${buf.length}B`);
    return { kind: 'image', ...r };
  }
  return null;
});
// 끌어 놓았는데 경로가 없는 파일(브라우저에서 끈 그림 등): 내용을 uploads/에 둔다 → { path, thumb } 또는 { error }
ipcMain.handle('mt:saveUpload', async (_e, { name, type, data } = {}) => {
  const buf = Buffer.from(data || []);
  if (!buf.length) return { error: 'empty' };
  if (buf.length > UPLOAD_MAX_BYTES) return { error: 'too_big' };
  const r = saveUpload(buf, name || 'dropped', type || '');
  log(`saveUpload ${path.basename(r.path)} ${buf.length}B`);
  return r;
});
// 끌어 놓은 경로들의 칩 정보: [{ path, name, dir, image, thumb }]. 그림은 작은 미리보기(큰 그림은 OS 썸네일)
ipcMain.handle('mt:fileInfo', async (_e, paths = []) => {
  const out = [];
  for (const p of (Array.isArray(paths) ? paths : []).slice(0, 50)) {
    let dir = false;
    try { dir = fs.statSync(p).isDirectory(); } catch {}
    const image = !dir && isImagePath(p);
    let thumb = null;
    if (image) {
      try { thumb = thumbOf(await nativeImage.createThumbnailFromPath(p, { width: THUMB_MAX, height: THUMB_MAX })); } catch {}
      if (!thumb) { try { thumb = thumbOf(nativeImage.createFromPath(p)); } catch {} }
    }
    out.push({ path: p, name: path.basename(p), dir, image, thumb });
  }
  return out;
});
// macOS: 화면 영역을 골라 찍어 uploads/에 둔다(screencapture -i, Esc면 null). 다른 앱 창까지 찍으려면 Atrium에 화면 기록 권한이 있어야 한다
ipcMain.handle('mt:capture', async () => {
  if (process.platform !== 'darwin') return { error: 'unsupported' };
  const dir = uploadDirOf(cfg.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = uploadPath(dir, 'capture.png', 'image/png');
  await run('/usr/sbin/screencapture', ['-i', '-x', file], 10 * 60_000);
  if (!fs.existsSync(file)) return null;
  try { cleanupUploads(dir, { keep: file }); } catch {}
  log(`capture ${path.basename(file)}`);
  return { path: file, thumb: thumbOf(nativeImage.createFromPath(file)) };
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
// macOS 판: `--background`(예: open -g -a Atrium --args --background)로 띄우면 첫 창을 포커스 없이 뒤에 보인다.
// 설치·업데이트 뒤 다시 띄울 때 사용자가 쓰던 앱 앞으로 튀어나오지 않게. 사람이 직접 열 때(인자 없음)는 예전과 같다
let backgroundLaunch = process.argv.includes('--background');
const quietUntil = backgroundLaunch ? Date.now() + 10000 : 0; // activate를 듣지 않는 끝 시각(아래 app.on('activate'))
function createWindow() {
  const quiet = backgroundLaunch; backgroundLaunch = false; // 첫 창만
  const w = win = new BrowserWindow({
    show: !quiet,
    width: 1600, height: 960, minWidth: 900, minHeight: 600, icon: WINDOW_ICON,
    title: windowTitle(APP_NAME, APP_VERSION, cfg.profile), // P71: "Atrium 0.1.2", 개발용 판은 " (dev)"
    backgroundColor: '#070705', // P11·P28: 판 바탕(renderer tokens.css --canvas). 창이 뜰 때 다른 색이 번쩍이지 않게
    webPreferences: { preload: path.join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.setMenuBarVisibility(false);
  if (quiet) w.once('ready-to-show', () => { if (!w.isDestroyed()) w.showInactive(); });
  win.on('page-title-updated', (e) => e.preventDefault()); // P9: HTML <title>이 개발용 표시("(dev)")를 덮어쓰지 않게
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // 판 페이지를 벗어나지 않는다: 창에 파일을 끌어 놓았는데 받는 곳이 없으면 Chromium이 그 파일로 옮겨 가 판이 사라졌다
  win.webContents.on('will-navigate', (e, url) => { e.preventDefault(); log(`navigation blocked ${String(url).slice(0, 120)}`); if (/^https?:/.test(url)) shell.openExternal(url); });
  win.webContents.on('render-process-gone', (_e, d) => log('render-process-gone', JSON.stringify(d)));
  // E5 2.5 조사(P3): 창이 다시 읽히거나 프로세스를 잃었는지 남긴다
  win.webContents.on('did-start-navigation', (d) => { if (d.isMainFrame) log(`navigation start ${d.isSameDocument ? 'same-doc ' : ''}${String(d.url).replace(/^file:.*\/dist\//, 'dist/')}`); });
  win.webContents.on('did-finish-load', () => log('page loaded'));
  win.webContents.on('unresponsive', () => log('renderer unresponsive'));
  win.webContents.on('responsive', () => log('renderer responsive'));
  win.loadFile(path.join(APP_ROOT, 'dist', 'index.html'));
  // P113: 트레이에 남으면 창을 없애기 전에 페이지를 내리고 GPU 프로세스에 메모리 압박을 알린다(gpu-purge.mjs).
  // 그동안 창은 숨어 있고 win은 비워 둔다(트레이에서 다시 열면 새 창을 만든다)
  win.on('close', (e) => {
    if (w.mtPurging || !shouldPurgeOnClose({ keepRunning: tray && tray.keepRunning(), quitting, updating, level: GPU_PURGE })) return;
    e.preventDefault();
    w.mtPurging = true;
    if (win === w) win = null;
    purgeAndDestroy(w, { level: GPU_PURGE }).then((r) => log('window closed, gpu purge', JSON.stringify(r)));
  });
  win.on('closed', () => { if (win === w) win = null; });
}

app.on('before-quit', () => { quitting = true; }); // P113
app.on('second-instance', () => { if (!updating) showNode(null); }); // 트레이에 남아 있을 때 다시 실행하면 창을 다시 연다(I7)
// Windows 알림의 앱 이름. 실제 판과 개발용을 나눈다
if (process.platform === 'win32') app.setAppUserModelId(`${APP_ID}.${cfg.profile}`);
// macOS 판: open -g로 뒤에 띄워도 Electron이 처음 뜰 때 activate를 보낼 때가 있다(2026-11-18 설치 뒤 창이 앞으로 나옴). 뒤에 띄운 직후 10초는 창이 있으면 앞으로 가져오지 않는다
app.on('activate', () => { if (win && !win.isDestroyed() && Date.now() < quietUntil) return; showNode(null); });
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
  // P165: 마이크는 판 창의 첫 쪽이 소리만 청할 때 허락한다(media-permission.mjs). 다른 권한은 기본 그대로
  const boardFile = path.join(APP_ROOT, 'dist', 'index.html');
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const ok = permissionAllowed({ permission, mediaTypes: details && details.mediaTypes, url: (details && (details.requestingUrl || details.securityOrigin)) || (wc && wc.getURL()), boardFile, fromBoard: !!(win && !win.isDestroyed() && wc === win.webContents) });
    if (permission === 'media') log(`media permission ${ok ? 'allowed' : 'denied'} (${(details && details.mediaTypes || []).join(',') || '-'})`);
    cb(ok);
  });
  createWindow();
  tray = startTray({ cfg, log, hasWindow: () => !!win, showNode, quit: () => app.quit(), notifications, closeWindow: () => { if (win) win.close(); }, startBackend: ensureBackend, stopBackend: () => stopBackend(cfg), confirm: trayConfirm, onUpdateRestart, appVersion: APP_VERSION });
  global.__mtTray = tray;
  global.__mtAppMigration = appMigration; // 시험이 읽는다
  if (appMigration && appMigration.failed.length) tray.noteError(tr('tray.profileCopyFailed', { n: appMigration.failed.length }));
});
app.on('child-process-gone', (_e, d) => log('child-process-gone', JSON.stringify(d))); // GPU 프로세스를 잃으면 모든 WebGL 컨텍스트를 잃는다
// 창을 닫으면 앱만 끝난다. 백엔드와 터미널 서버, 그 안의 claude 세션은 계속 돈다(C1). 트레이 상주(기본 켜짐)면 앱은 트레이에 남는다(I7, P14)
app.on('window-all-closed', () => {
  if (tray && tray.keepRunning()) { log('window closed, app stays in tray'); tray.onWindowClosed(); return; }
  log('window closed, app quits (backend keeps running)'); app.quit();
});
