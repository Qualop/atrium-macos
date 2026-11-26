// macOS 판 창 시험: Finder에서 끌어 놓기와 붙여넣기 대신 쓰는 길(lib/desktop-drop.js, main.mjs mt:saveUpload·mt:fileInfo).
// (1) 셸 터미널에 경로 있는 파일 둘(빈칸·한글 이름)을 놓으면 따옴표 붙은 경로가 입력줄에 들어간다
// (2) 경로 없는 그림(브라우저에서 끈 것)을 놓으면 판 데이터 폴더 uploads/에 사본이 생기고 그 경로가 들어간다
// (3) 명령 바에 놓으면 [Image n]·[File n] 칩이 생기고, 보낼 글에서는 경로로 바뀐다
// (4) 터미널이 없는 노드(머리줄)에 놓으면 맡겨 두었다가 터미널이 붙을 때 넣는다
// (5) 빈 판에 놓으면 명령 바 칩으로 가고, 창이 다른 페이지로 넘어가지 않는다
// 새 /tmp 폴더·포트·hc 세션만 쓰고 끝나면 정리한다. 실제 판과 사용자 세션은 건드리지 않는다.
// 실행: node app/test/e2e/mac-drop.mjs
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { ApiClient } from '../../../backend/src/client.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.platform !== 'darwin') throw new Error('macOS only');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = fs.mkdtempSync('/tmp/atrium-drop-');
const session = `atrium-dev-drop-${process.pid}`;
const server = net.createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise((r) => server.close(r));
for (const name of ['projects', 'sessions', 'xdg']) fs.mkdirSync(path.join(dir, name));
const project = path.join(dir, 'project');
fs.mkdirSync(path.join(project, 'sub dir'), { recursive: true });
const FILE_A = path.join(project, 'a b.txt');
const FILE_K = path.join(project, '스크린샷 1.png');
fs.writeFileSync(FILE_A, 'drop\n');
// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync(FILE_K, PNG);
fs.writeFileSync(path.join(dir, 'claude.json'), '{}');
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ATRIUM_|MTASK_|HERDR_|HC_|CLAUDECODE|CLAUDE_CODE_|ELECTRON_RUN_AS_NODE)/.test(k))),
  ATRIUM_TERMINAL_SESSION: session, ATRIUM_HERDR_SESSION: session, ATRIUM_PORT: String(port), ATRIUM_PROFILE: 'dev',
  ATRIUM_DATA_DIR: path.join(dir, 'data'), ATRIUM_APP_USERDATA: path.join(dir, 'app'),
  ATRIUM_CLAUDE_PROJECTS: path.join(dir, 'projects'), ATRIUM_CLAUDE_SESSIONS: path.join(dir, 'sessions'),
  ATRIUM_CLAUDE_JSON: path.join(dir, 'claude.json'), ATRIUM_CLAUDE_DESKTOP: 'none',
  XDG_CONFIG_HOME: path.join(dir, 'xdg'),
};
assertTestBoard(env, { root: dir });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(150); }
  throw new Error(`Timed out: ${label}`);
}
const pass = (m) => console.log(`PASS ${m}`);
let app, client;
const errors = [];
console.log(JSON.stringify({ dir, session, port }));

// 창 안에서 끌어 놓기를 흉내 낸다. 경로 있는 파일은 <input type=file>에 진짜 파일을 넣어 얻는다(webUtils.getPathForFile이 경로를 안다)
async function drop(page, selector, { paths = [], blobs = [] } = {}) {
  if (paths.length) {
    await page.evaluate(() => { let i = document.getElementById('__dropInput'); if (!i) { i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.id = '__dropInput'; i.style.display = 'none'; document.body.appendChild(i); } });
    await page.setInputFiles('#__dropInput', paths);
  }
  return page.evaluate(({ selector, blobs, withPaths }) => {
    const el = typeof selector === 'string' ? document.querySelector(selector) : null;
    const target = el || document.elementFromPoint(selector.x, selector.y);
    if (!target) return 'no target';
    const dt = new DataTransfer();
    if (withPaths) for (const f of document.getElementById('__dropInput').files) dt.items.add(f);
    for (const b of blobs) dt.items.add(new File([Uint8Array.from(atob(b.b64), (c) => c.charCodeAt(0))], b.name, { type: b.type }));
    const r = target.getBoundingClientRect();
    const at = { clientX: r.left + Math.min(40, r.width / 2), clientY: r.top + Math.min(20, r.height / 2) };
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at });
    target.dispatchEvent(over);
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at });
    target.dispatchEvent(ev);
    return { overPrevented: over.defaultPrevented, dropPrevented: ev.defaultPrevented, tag: target.className && String(target.className).slice(0, 60) };
  }, { selector, blobs, withPaths: paths.length > 0 });
}
const PNG_B64 = PNG.toString('base64');

try {
  app = await electron.launch({ args: [path.join(root, 'app'), '--dev'], env });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => window.__mt?.getState().boardLoaded, null, { timeout: 60000 });
  await page.locator('.mt-splash').waitFor({ state: 'hidden', timeout: 20000 });
  const info = JSON.parse(fs.readFileSync(path.join(dir, 'data/backend.json'), 'utf8'));
  client = new ApiClient(info); await client.open();
  const engineUp = async () => { const s = await client.call('backend.status'); return (s.terminal || s.herdr || {}).connected; };
  await until(engineUp, 'terminal engine connection', 60000);
  await client.call('workspace.open', { path: project });
  const shell = await client.call('session.spawn', { kind: 'shell', name: 'drop-sh', cwd: project });
  await until(() => page.evaluate((sid) => window.__mt.getState().sessions.has(sid), shell.sessionId), 'shell in canvas');
  await page.evaluate((sid) => window.__mt.getState().navigateTo(sid), shell.sessionId);
  await until(() => page.evaluate((sid) => window.__mt.terms.has(sid) && !window.__mt.terms.get(sid).options.disableStdin, shell.sessionId), 'terminal attached');
  await until(async () => { try { return (await client.call('backend.status')).relay.some((r) => r.sessionId === shell.sessionId && r.frames > 0); } catch { return false; } }, 'terminal frames');
  const screen = async () => String((await client.call('session.get', { session: shell.sessionId, lines: 60 })).screenTail || '');
  const termSel = `.mt-term[data-session="${shell.sessionId}"]`;
  await page.locator(`${termSel} .xterm-helper-textarea`).focus();

  // (1) 경로 있는 파일 둘 → 터미널 입력줄
  await page.keyboard.type('printf "%s|" ');
  const r1 = await drop(page, `${termSel} .xterm-screen`, { paths: [FILE_A, FILE_K] });
  assert.equal(r1.dropPrevented, true, JSON.stringify(r1));
  await until(async () => (await screen()).includes('스크린샷\\ 1.png'), 'dropped paths (backslash-escaped like Terminal.app) in the shell line', 15000);
  await page.keyboard.press('Enter');
  await until(async () => (await screen()).includes(`${FILE_A}|${FILE_K}|`), 'shell received both quoted paths', 15000);
  pass('Finder files dropped on a terminal arrive as escaped POSIX paths the shell reads back exactly');

  // (2) 경로 없는 그림 → uploads/ 사본 경로
  await page.keyboard.type('ls -1 ');
  await drop(page, `${termSel} .xterm-screen`, { blobs: [{ name: 'web image.png', type: 'image/png', b64: PNG_B64 }] });
  const up = path.join(dir, 'data', 'uploads');
  await until(() => fs.existsSync(up) && fs.readdirSync(up).some((f) => f.endsWith('web image.png')), 'upload copy written', 15000);
  await until(async () => (await screen()).includes('web\\ image.png'), 'upload path in the shell line', 15000);
  await page.keyboard.press('Enter');
  await until(async () => /uploads\/\d{8}-\d{6}-[0-9a-f]{6}-web image\.png/.test(await screen()), 'ls found the upload copy', 15000);
  pass('a pathless dropped image is saved under uploads/ and its path inserted');

  // (3) 명령 바 → 칩, 보낼 글은 경로
  const bar = '[data-role="command"]';
  // macOS 키: Ctrl+K는 터미널 프로그램(zsh의 줄 끝 지우기)에 가고, 판의 명령 바는 Cmd+K
  await page.locator(`${termSel} .xterm-helper-textarea`).focus();
  await page.keyboard.type('echo KEEP_ME_GONE');
  for (let i = 0; i < 'KEEP_ME_GONE'.length; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Enter');
  await until(async () => /\n\s*\n|^\s*$/m.test((await screen()).split('echo ').pop() || '') || !(await screen()).includes('\nKEEP_ME_GONE'), 'Ctrl+K reached zsh', 15000);
  assert.equal(await page.locator(bar).evaluate((el) => el === document.activeElement), false, 'Ctrl+K did not take focus to the command bar');
  assert.ok(!(await screen()).split('\n').some((l) => l.trim() === 'KEEP_ME_GONE'), 'zsh killed the rest of the line');
  pass('Ctrl+K goes to the terminal program on macOS');
  await page.keyboard.press('Meta+k');
  await until(() => page.locator(bar).evaluate((el) => el === document.activeElement), 'command bar focus');
  await page.locator(bar).fill('@drop-sh 봐 ');
  await drop(page, bar, { paths: [FILE_K, FILE_A] });
  await until(async () => (await page.locator(bar).inputValue()).includes('[File 2]'), 'chips in the command bar', 15000);
  assert.equal(await page.locator(bar).inputValue(), '@drop-sh 봐 [Image 1] [File 2] ');
  assert.equal(await page.locator('.mt-cmd-mirror [data-img]').count(), 2);
  pass('drop on the command bar makes [Image n]/[File n] chips');
  await page.locator(bar).fill('');

  // (4) 터미널 없는 노드 머리줄 → 맡겼다가 터미널이 붙을 때
  const shell2 = await client.call('session.spawn', { kind: 'shell', name: 'drop-sh2', cwd: project });
  await until(() => page.evaluate((sid) => window.__mt.getState().sessions.has(sid), shell2.sessionId), 'second shell in canvas');
  await page.evaluate((sid) => window.__mt.getState().navigateTo(sid), shell.sessionId);
  await sleep(800);
  const head2 = `.mt-node[data-session="${shell2.sessionId}"]`;
  await until(() => page.locator(head2).count(), 'second node rendered');
  // 멀리 축소해 터미널을 모두 뗀 뒤(먼 얼굴) 노드에 놓는다: 맡겨 두고 그 노드로 들어가 붙을 때 넣어야 한다
  await page.evaluate(() => window.__mt.getState().setViewport({ x: 40, y: 80, zoom: 0.05 }));
  await until(async () => (await client.call('backend.status')).relay.length === 0, 'zoom out releases terminals', 20000);
  const attachedBefore = await page.evaluate((sid) => window.__mt.terms.has(sid), shell2.sessionId);
  await drop(page, head2, { paths: [FILE_A] });
  await until(async () => String((await client.call('session.get', { session: shell2.sessionId, lines: 40 })).screenTail || '').includes('a\\ b.txt'), 'path reached the second shell', 20000);
  pass(`drop on a node header reaches that session (${attachedBefore ? 'terminal was attached' : 'queued until attach'})`);

  // (5) 빈 판 → 명령 바 칩, 창은 그대로
  const urlBefore = page.url();
  const empty = await page.evaluate(() => { const r = document.querySelector('.react-flow__pane').getBoundingClientRect(); return { x: r.left + 8, y: r.bottom - 120 }; });
  await drop(page, empty, { paths: [FILE_K] });
  await until(async () => (await page.locator(bar).inputValue()).includes('[Image 1]'), 'empty-canvas drop lands in the command bar', 15000);
  assert.equal(page.url(), urlBefore);
  pass('drop on empty canvas goes to the command bar; the window does not navigate');

  await page.screenshot({ path: path.join(dir, 'drop.png') });
  assert.deepEqual(errors, []);
  for (const s of [shell, shell2]) await client.call('session.kill', { session: s.sessionId, confirm: true });
  pass('no renderer errors');
} finally {
  try { if (client) await client.call('backend.shutdown').catch(() => {}); } catch {}
  try { if (client) client.close(); } catch {}
  try { if (app) await app.close(); } catch {}
  try {
    const { execFileSync } = await import('node:child_process');
    // 이 시험이 띄운 hc 서버만(이 시험의 세션 이름) 끈다
    const out = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
    for (const line of out.split('\n')) if (line.includes(session) || line.includes(dir)) { const pid = Number(line.trim().split(/\s+/)[0]); if (pid && pid !== process.pid) try { process.kill(pid); } catch {} }
  } catch {}
}
