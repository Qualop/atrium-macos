// 실제 PhoneApp·xterm, 메모리 API. HTTP 서버·herdr·제공자 CLI·사용자 데이터 없음.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = await fs.mkdtemp(path.join(os.tmpdir(), 'atrium-v04-phone-browser-'));
let browser;
try {
  await build({ absWorkingDir: app, stdin: { resolveDir: app, loader: 'jsx', contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {ReactFlowProvider} from '@xyflow/react';
import {api} from './test/fixtures/remote-phone-api.js'; import {PhoneApp,phoneScreen} from './src/renderer/Phone.jsx';
import {getState} from './src/renderer/store.js'; import {terms} from './src/renderer/TerminalView.jsx';
import '@xterm/xterm/css/xterm.css'; import './src/renderer/tokens.css'; import './src/renderer/styles.css';
window.phoneTest={api,getState,terms,phoneScreen};
api.connect(); createRoot(document.getElementById('root')).render(<ReactFlowProvider><div className="mt-app phone"><PhoneApp/></div></ReactFlowProvider>);
` }, outfile: path.join(out, 'phone.js'), bundle: true, platform: 'browser', jsx: 'automatic', loader: { '.js': 'jsx', '.woff2': 'file', '.woff': 'file' }, plugins: [{ name: 'phone-memory-api', setup(b) {
    b.onResolve({ filter: /(^|\/)api\.js$/ }, (args) => args.importer.includes('/renderer/') ? { path: path.join(app, 'test/fixtures/remote-phone-api.js') } : undefined);
  } }] });
  await fs.cp(path.join(app, 'src/renderer/assets'), path.join(out, 'assets'), { recursive: true });
  await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="phone.css"><div id="root"></div><script src="phone.js"></script>');
  const engine = process.env.ATRIUM_PHONE_BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch({ headless: true, ...(engine === chromium ? { channel: process.env.ATRIUM_TEST_BROWSER || 'chrome' } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => {
    window.mt = { platform: 'darwin', web: true, log() {}, notify: async () => ({}), onNavigate() {}, setZoom() {} };
    window.WebSocket = class { constructor() { throw new Error('network forbidden'); } };
  });
  await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
  await page.waitForFunction(() => window.phoneTest?.getState().boardLoaded);
  assert.equal(await page.locator('.mt-ph-row').count(), 5);
  assert.equal(await page.evaluate(() => phoneTest.phoneScreen()), true);
  for (const [id, kind] of [['session-1', 'codex'], ['session-2', 'agy'], ['session-4', 'gemini']]) {
    await page.locator(`.mt-ph-row[data-session="${id}"]`).click();
    await page.waitForFunction((sid) => !!phoneTest.terms.get(sid)?._mtInputTarget?.(), id);
    await page.locator('[data-field=phone-text]').fill(`한글 ${kind}\nsecond line`);
    const count = await page.evaluate(() => __fixture.calls.filter((c) => c.method === 'session.send').length);
    await page.locator('[data-field=phone-text]').evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, isComposing: true, bubbles: true })));
    assert.equal(await page.evaluate(() => __fixture.calls.filter((c) => c.method === 'session.send').length), count, 'IME confirmation does not submit');
    await page.locator('[data-action=phone-send]').click();
    const send = await page.evaluate(() => __fixture.calls.filter((c) => c.method === 'session.send').at(-1).params);
    assert.deepEqual(send, { target: [id], text: `한글 ${kind}\nsecond line` });
    await page.evaluate((sid) => { const s = { ...phoneTest.getState().sessions.get(sid), state: 'waiting', ask: { kind: 'screen', since: 123, tail: 'Choose in terminal' } }; phoneTest.api.emit('session.updated', s); }, id);
    await page.locator('[data-role=phone-pad]').waitFor();
    await page.locator('[data-pad-key=down]').click();
    await page.waitForFunction(() => __fixture.calls.some((c) => c.method === 'session.keys'));
    const keys = await page.evaluate(() => __fixture.calls.filter((c) => c.method === 'session.keys').at(-1).params);
    assert.equal(keys.session, id); assert.equal(keys.controllerPid, 7); assert.ok(keys.attachmentId); assert.deepEqual(keys.keys, ['down']);
    await page.locator('[data-action=phone-back]').click();
    await page.locator('[data-role=phone-list]').waitFor();
  }
  await page.setViewportSize({ width: 844, height: 390 });
  assert.equal(await page.evaluate(() => phoneTest.phoneScreen()), true, 'landscape phone remains in list mode');
  await page.locator('[data-action=phone-mission]').click();
  await page.locator('[data-role=pm-node]').first().waitFor();
  assert.equal(await page.locator('[data-role=pm-node]').count(), 4);
  assert.deepEqual(errors, []);
  console.log('PASS: phone list, Codex/agy/Gemini multiline send, IME confirmation guard, attachment-bound generic key pad, landscape list, mission graph.');
} finally { await browser?.close(); await fs.rm(out, { recursive: true, force: true }); }
