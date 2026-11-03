// 새 프로필·소켓·빈 대화 폴더에서만 실행. 실제 사용자 세션에는 연결하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { ApiClient } from '../../../backend/src/client.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.platform !== 'darwin') throw new Error('macOS smoke test');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packagedApp = process.env.ATRIUM_TEST_APP;
const installed = path.join(packagedApp ? path.join(packagedApp, 'Contents/Resources') : root, '.tools', 'herdr', `0.9.5-${process.arch}`, 'herdr');
const herdr = process.env.ATRIUM_HERDR || (fs.existsSync(installed) ? installed : path.join(root, 'backend/.dev/tools/herdr'));
if (!fs.existsSync(herdr)) throw new Error('Set ATRIUM_HERDR to herdr 0.9.5');
const dir = fs.mkdtempSync('/tmp/atrium-mac-');
const session = `atrium-dev-mac-${process.pid}`;
const stress = process.env.ATRIUM_STRESS === '1';
const server = net.createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise((r) => server.close(r));
for (const name of ['project', 'projects', 'sessions', 'xdg']) fs.mkdirSync(path.join(dir, name));
const project = path.join(dir, stress ? "프로젝트 space ' $ [test]" : 'project');
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(path.join(dir, 'claude.json'), '{}');
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ATRIUM_|MTASK_|HERDR_|CLAUDECODE|CLAUDE_CODE_|ELECTRON_RUN_AS_NODE)/.test(k))),
  ATRIUM_HERDR: herdr, ATRIUM_HERDR_SESSION: session, ATRIUM_PORT: String(port), ATRIUM_PROFILE: 'dev',
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
let app, client;
const errors = [];
const launch = async () => {
  app = await electron.launch({ ...(packagedApp ? { executablePath: path.join(packagedApp, 'Contents/MacOS/Electron') } : {}), args: packagedApp ? ['--dev'] : [path.join(root, 'app'), '--dev'], env: packagedApp ? { ...env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } : env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => window.__mt?.getState().boardLoaded, null, { timeout: 45000 });
  await page.locator('.mt-splash').waitFor({ state: 'hidden', timeout: 15000 });
  return page;
};
console.log(JSON.stringify({ dir, session, port }));
try {
  let page = await launch();
  const info = JSON.parse(fs.readFileSync(path.join(dir, 'data/backend.json'), 'utf8'));
  client = new ApiClient(info); await client.open();
  await until(async () => (await client.call('backend.status')).herdr.connected, 'herdr connection');
  console.log('PASS backend and herdr connected');
  if (process.env.ATRIUM_TEST_MODELS === '1') {
    const { checkModelPicker } = await import('./model-picker.mjs');
    await checkModelPicker({ page, app, client, project, dir });
  }
  if (process.env.ATRIUM_TEST_GEMINI === '1') {
    const { checkGeminiPicker } = await import('./gemini-picker.mjs');
    await checkGeminiPicker({ page, app, client, project, dir });
  }
  if (process.env.ATRIUM_TEST_AGY_LIVE === '1') {
    const { checkAgyCollaboration } = await import('./agy-collaboration.mjs');
    await checkAgyCollaboration({ page, client, dir });
  }
  if (process.env.ATRIUM_TEST_AUDIT === '1') {
    const { checkWorkspaceAudit } = await import('./audit-workspace.mjs');
    await checkWorkspaceAudit({ client, page, dir, session });
  }
  await client.call('workspace.open', { path: project });
  const shell = await client.call('session.spawn', { kind: 'shell', name: 'mac-smoke', cwd: project });
  await until(() => page.evaluate((sid) => window.__mt.getState().sessions.has(sid), shell.sessionId), 'shell in canvas');
  await page.evaluate((sid) => window.__mt.getState().navigateTo(sid), shell.sessionId);
  await until(() => page.locator('.xterm').count(), 'terminal mounted');
  // 창이 연결한 제어기로 입력: 실제 renderer → WebSocket → herdr → PTY → frame 경로.
  await until(async () => {
    try { return (await client.call('backend.status')).relay.some((r) => r.sessionId === shell.sessionId && r.frames > 0); } catch { return false; }
  }, 'terminal frames');
  const terminal = page.locator('.xterm-helper-textarea').first();
  await terminal.focus();
  await page.keyboard.type('printf "ATRIUM_MAC_%s\\n" OK'); await page.keyboard.press('Enter');
  await until(async () => (await client.call('session.get', { session: shell.sessionId })).screenTail?.includes('ATRIUM_MAC_OK'), 'PTY output');
  await until(() => page.evaluate((sid) => {
    const term = window.__mt.terms.get(sid);
    if (!term) return false;
    return Array.from({ length: term.buffer.active.length }, (_, i) => term.buffer.active.getLine(i)?.translateToString()).join('\n').includes('ATRIUM_MAC_OK');
  }, shell.sessionId), 'xterm rendered output');
  console.log('PASS shell input and terminal output');
  if (process.env.ATRIUM_TEST_COPY === '1') {
    const { checkKoreanCopy } = await import('./korean-copy.mjs');
    await checkKoreanCopy({ page, app, client, dir });
    await terminal.focus();
  }
  await page.keyboard.type('herdr --version'); await page.keyboard.press('Enter');
  await until(async () => (await client.call('session.get', { session: shell.sessionId })).screenTail?.includes('herdr 0.9.5'), 'herdr on pane PATH');
  let persisted = null;
  if (stress) {
    const duplicate = await Promise.allSettled([1, 2].map(() => client.call('session.spawn', { kind: 'shell', name: 'duplicate', cwd: project })));
    assert.equal(duplicate.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(duplicate.find((r) => r.status === 'rejected').reason.code, 'name_taken');
    const auto = await Promise.all(Array.from({ length: 7 }, () => client.call('session.spawn', { kind: 'shell', cwd: project })));
    assert.equal(new Set(auto.map((s) => s.name)).size, 7);
    const sessions = await client.call('session.list');
    assert.equal(sessions.length, 9);
    console.log('PASS concurrent spawn: duplicate rejected, automatic names unique');
    for (const [i, s] of sessions.entries()) await client.call('board.setNode', { session: s.sessionId, x: (i % 3) * 440, y: Math.floor(i / 3) * 240, w: 420, h: 220, z: i });
    await client.call('board.setViewport', { x: 30, y: 90, zoom: 1 });
    await page.reload(); await page.locator('.mt-splash').waitFor({ state: 'hidden' });
    await until(async () => (await client.call('backend.status')).relay.length === 8, 'eight visible terminal controllers');
    assert.ok(await page.evaluate(() => window.__mt.budget.used <= 8));
    await page.evaluate(() => window.__mt.getState().setViewport({ x: 40, y: 80, zoom: 0.15 }));
    await until(async () => (await client.call('backend.status')).relay.length === 0, 'zoom out releases all controllers');
    await page.evaluate(() => window.__mt.getState().setViewport({ x: 30, y: 90, zoom: 1 }));
    await until(async () => (await client.call('backend.status')).relay.length === 8, 'zoom in restores controller budget');
    console.log('PASS nine sessions, eight-controller budget and zoom release/reattach');
    await page.evaluate((sid) => window.__mt.getState().navigateTo(sid), shell.sessionId);
    const input = page.locator(`.mt-term[data-session="${shell.sessionId}"] .xterm-helper-textarea`);
    await input.focus();
    await page.evaluate((sid) => {
      const data = new DataTransfer(); data.setData('text/plain', "printf 'ATRIUM_한글_%s\\n' OK\nprintf 'ATRIUM_SECOND_%s\\n' OK");
      document.querySelector(`.mt-term[data-session="${sid}"] textarea`).dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, shell.sessionId);
    assert.ok(!(await client.call('session.get', { session: shell.sessionId })).screenTail.includes('ATRIUM_SECOND_OK'));
    await page.keyboard.press('Enter');
    await until(async () => (await client.call('session.get', { session: shell.sessionId })).screenTail?.includes('ATRIUM_SECOND_OK'), 'multiline paste submitted once');
    assert.ok((await client.call('session.get', { session: shell.sessionId })).screenTail.includes('ATRIUM_한글_OK'));
    await page.keyboard.press('Meta+f'); await page.locator('[data-field="search"]').waitFor({ state: 'visible' });
    await until(() => page.locator('[data-field="search"]').evaluate((el) => el === document.activeElement), 'search focus');
    await page.keyboard.press('Escape');
    await page.locator('[data-field="search"]').waitFor({ state: 'hidden' });
    await input.focus();
    await page.keyboard.press('Meta+k');
    await until(() => page.locator('[data-role="command"]').evaluate((el) => el === document.activeElement), 'Command-K focus');
    console.log('PASS Unicode multiline paste, Command-F and Command-K');
    const cdp = await page.context().newCDPSession(page);
    await input.focus();
    await page.evaluate((sid) => {
      window.__imeSent = []; window.__imeOriginal = window.__mt.api.call;
      window.__mt.api.call = function(method, params) { if (method === 'terminal.input' && params.session === sid) window.__imeSent.push(params.data); return window.__imeOriginal.call(this, method, params); };
    }, shell.sessionId);
    const compose = (text) => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await compose('ㅎ'); await compose('하'); await compose('한');
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.deepEqual(await page.evaluate(() => window.__imeSent), []);
    await cdp.send('Input.insertText', { text: '한' });
    await compose('글'); await cdp.send('Input.insertText', { text: '글' });
    await until(() => page.evaluate(() => window.__imeSent.join('') === '한글'), 'IME commits exactly once');
    await page.evaluate(() => { window.__mt.api.call = window.__imeOriginal; delete window.__imeOriginal; });
    await page.keyboard.press('Control+u');
    await page.locator('[data-role="command"]').fill('');
    await compose('한'); await cdp.send('Input.insertText', { text: '한' });
    await compose('글'); await cdp.send('Input.insertText', { text: '글' });
    assert.equal(await page.locator('[data-role="command"]').inputValue(), '한글');
    await page.locator('[data-role="command"]').fill(''); await cdp.detach();
    console.log('PASS synthetic Korean IME: no partial sends, exactly-once commit, command bar');
    const memo = await client.call('memo.create', { text: '# 한글 memo\nPersistence fixture', x: 1800, y: 0 });
    const kanban = await client.call('kanban.create', { title: '동시성', columns: ['Todo', 'Done'], x: 2200, y: 0 });
    await Promise.all(Array.from({ length: 12 }, (_, i) => client.call('kanban.update', { kanban: kanban.kanbanId, op: { op: 'addCard', text: `card-${i}` } })));
    const boards = await client.call('kanban.list', {});
    assert.equal(boards.find((k) => k.kanbanId === kanban.kanbanId).columns[0].cards.length, 12);
    persisted = { memoId: memo.memoId, kanbanId: kanban.kanbanId };
    await client.call('settings.set', { language: 'ko' });
    console.log('PASS concurrent kanban updates, memo and settings');
    await page.evaluate((sid) => window.__mt.getState().navigateTo(sid), shell.sessionId);
    const lost = await page.evaluate(() => {
      for (const canvas of document.querySelectorAll('.xterm canvas')) {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        const ext = gl?.getExtension('WEBGL_lose_context');
        if (ext) { ext.loseContext(); return true; }
      }
      return false;
    });
    if (lost) { await until(() => page.evaluate(() => window.__mt.budget.lost > 0), 'WebGL fallback'); console.log('PASS WebGL context loss fallback'); }
    else console.log('SKIP WebGL loss: no active WebGL context');
  }
  await page.screenshot({ path: path.join(dir, 'canvas.png') });
  await app.close(); app = null;
  assert.ok((await client.call('session.list')).some((s) => s.sessionId === shell.sessionId));
  page = await launch();
  await until(() => page.evaluate((sid) => window.__mt.getState().sessions.has(sid), shell.sessionId), 'restored canvas');
  console.log('PASS close/reopen preserves shell and canvas');
  if (stress) process.kill(info.pid, 'SIGKILL');
  else await client.call('backend.shutdown');
  client.close(); client = null;
  const nextInfo = await until(() => {
    try { const value = JSON.parse(fs.readFileSync(path.join(dir, 'data/backend.json'), 'utf8')); return value.pid !== info.pid ? value : null; } catch { return null; }
  }, 'backend restarted by app');
  client = new ApiClient(nextInfo); await client.open();
  await until(async () => (await client.call('backend.status')).herdr.connected, 'herdr reattached');
  const restored = await until(async () => (await client.call('session.list')).find((s) => s.sessionId === shell.sessionId), 'restored backend session');
  assert.equal(restored.paneId, shell.paneId);
  console.log('PASS backend restart reattaches to the same live pane');
  if (stress) {
    assert.equal((await client.call('session.list')).length, 9);
    const resources = await client.call('resources.get', { fresh: true });
    assert.ok(resources.sessionsMB > 0);
    assert.ok(resources.herdrServer?.memMB > 0);
    assert.ok((await client.call('memo.list')).some((m) => m.memoId === persisted.memoId && m.text.includes('한글')));
    assert.equal((await client.call('kanban.list')).find((k) => k.kanbanId === persisted.kanbanId).columns[0].cards.length, 12);
    console.log('PASS nine sessions, memo and all twelve cards survive backend restart');
    await page.evaluate((sid) => window.__mt.getState().navigateTo(sid), shell.sessionId);
    await until(() => page.evaluate((sid) => window.__mt.api.status === 'open' && window.__mt.terms.has(sid) && !window.__mt.terms.get(sid).options.disableStdin, shell.sessionId), 'terminal ready after restart');
    await page.locator(`.mt-term[data-session="${shell.sessionId}"] textarea`).focus();
    await page.keyboard.type('printf "AFTER_RESTART_%s\\n" OK'); await page.keyboard.press('Enter');
    await until(async () => (await client.call('session.get', { session: shell.sessionId })).screenTail?.includes('AFTER_RESTART_OK'), 'input after restart');
    console.log('PASS terminal input after backend restart');
  }
  assert.deepEqual(errors, []);
  await client.call('session.kill', { session: shell.sessionId, confirm: true });
  console.log('PASS session cleanup, no renderer errors');
  if (stress) {
    await client.call('herdr.stop', { confirm: true });
    await until(async () => !(await client.call('backend.status')).herdr.connected, 'herdr stopped');
    await assert.rejects(() => client.call('session.spawn', { kind: 'shell', cwd: project }), /herdr/);
    await client.call('herdr.start', {});
    await until(async () => (await client.call('backend.status')).herdr.connected, 'herdr started');
    const fresh = await client.call('session.spawn', { kind: 'shell', name: 'after-herdr-restart', cwd: project });
    assert.ok(fresh.paneId);
    await client.call('session.kill', { session: fresh.sessionId, confirm: true });
    console.log('PASS herdr stop/start and new terminal after engine restart');
    assert.deepEqual(errors, []);
  }
  if (process.env.ATRIUM_SMOKE_AGENT === '1') {
    const agent = await client.call('session.spawn', { kind: 'claude', name: 'mac-claude-smoke', cwd: path.join(dir, 'project') });
    const state = await until(async () => {
      const s = await client.call('session.get', { session: agent.sessionId });
      return /Claude|trust|Welcome|permission/i.test(s.screenTail || '') ? s : null;
    }, 'fresh Claude CLI launch');
    console.log(`PASS fresh Claude CLI visible (${state.state}); trust was not accepted`);
    // 시험용 패널만 닫는다. 신뢰 화면에 /exit나 Enter를 입력하지 않는다.
  }
} catch (error) {
  if (app) {
    const page = await app.firstWindow().catch(() => null);
    if (page) {
      await page.screenshot({ path: path.join(dir, 'failure.png') }).catch(() => {});
      const debug = await page.evaluate(() => ({ focus: window.__mt?.getState().focusId, events: window.__mt?.perf.events, active: document.activeElement?.outerHTML })).catch(() => null);
      fs.writeFileSync(path.join(dir, 'failure.json'), JSON.stringify({ error: error.stack, errors, debug }, null, 2));
    }
  }
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  if (!client) {
    try { client = new ApiClient(JSON.parse(fs.readFileSync(path.join(dir, 'data/backend.json'), 'utf8'))); await client.open(); } catch { client = null; }
  }
  if (client) { await client.call('backend.shutdown').catch(() => {}); client.close(); }
  execFileSync(herdr, ['--session', session, 'server', 'stop'], { env, stdio: 'ignore', timeout: 15000 });
  console.log(`Artifacts: ${dir}`);
}
