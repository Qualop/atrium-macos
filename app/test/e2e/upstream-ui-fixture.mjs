// Renderer-only browser validation. All API calls are replaced with an in-memory fixture.
// Run: cd app && node test/e2e/upstream-ui-fixture.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = await fs.mkdtemp(path.join(os.tmpdir(), 'atrium-ui-fixture-'));
await build({ absWorkingDir: app, entryPoints: ['src/renderer/main.jsx'], outdir: out, bundle: true, format: 'esm', platform: 'browser', target: 'chrome140', jsx: 'automatic', loader: { '.js': 'jsx', '.woff2': 'file', '.woff': 'file' }, define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'in-memory-api', setup(b) { b.onResolve({ filter: /(^|\/)api\.js$/ }, (args) => args.importer.includes('/renderer/') ? { path: path.join(app, 'test/fixtures/upstream-ui-api.js') } : undefined); } }] });
await fs.cp(path.join(app, 'src/renderer/assets'), path.join(out, 'assets'), { recursive: true });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="/main.css"></head><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>');
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://fixture').pathname;
  const f = path.join(out, name === '/' ? 'index.html' : name);
  if (!f.startsWith(out + path.sep)) { res.writeHead(403).end(); return; }
  try { const bytes = await fs.readFile(f); res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(f)] || 'application/octet-stream'); res.end(bytes); } catch { res.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser, page;
const checks = [];
try {
  const installedChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.ATRIUM_TEST_BROWSER || (process.platform === 'darwin' && await fs.access(installedChrome).then(() => true, () => false) ? installedChrome : undefined);
  browser = await chromium.launch({ headless: true, executablePath });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__logs = [];
    window.mt = { platform: 'darwin', log: (m) => window.__logs.push(m), notify: async () => ({}), onNavigate() {}, onFocus() {}, isFocused: async () => true, setZoom() {}, pickFolder: async () => '/fixture/project' };
    window.WebSocket = class { constructor() { throw new Error('Network socket forbidden in fixture'); } };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('[data-role="splash"]').waitFor({ state: 'hidden' });
  await page.locator('[data-role="empty-hint"]').waitFor();
  assert.equal(await page.locator('[data-role="rail-favorites"] button').count(), 4);
  assert.equal(await page.locator('[data-role="rail-favorites"] [data-kind="agy"]').count(), 1);
  checks.push('empty board and Claude/Codex/agy/Shell favorite rail');

  await page.locator('[data-action="settings-open"]').click();
  await page.locator('[data-tab="branch"]').click();
  for (const key of ['branchMaxChildren', 'branchMaxDepth', 'branchMaxTotal']) assert.ok(await page.locator(`[data-field="setting-${key}"]`).isVisible());
  await page.locator('[data-tab="general"]').click();
  await page.locator('[data-action="termScale-up"]').click();
  assert.equal(await page.evaluate(() => window.__mt.getState().termScale), 1.05);
  checks.push('worker limits visible and independent terminal scaling');

  await page.locator('[data-tab="launchers"]').click();
  await page.locator('[data-action="launcher-new"]').click();
  for (const kind of ['codex', 'gemini', 'agy']) {
    await page.locator('[data-field="launcher-harness"]').selectOption(kind);
    await page.locator('[data-role="launcher-model-status"][data-status="ready"]').waitFor();
    assert.deepEqual(await page.locator(`datalist#ln-models-${kind} option`).evaluateAll((els) => els.map((e) => e.value)), [`${kind}-actual-model`]);
  }
  await page.locator('[data-field="launcher-model"]').fill('custom-model-id');
  await page.locator('[data-field="launcher-name"]').fill('Model test');
  await page.locator('[data-role="launcher-form-preview"]').filter({ hasText: 'custom-model-id' }).waitFor();
  await page.evaluate(() => { window.__fixture.hold = ['launcher.preview']; });
  await page.locator('[data-field="launcher-args"]').fill('--old');
  await page.waitForFunction(() => window.__fixture.pending.length === 1);
  await page.locator('[data-field="launcher-args"]').fill('--new');
  await page.waitForFunction(() => window.__fixture.pending.length === 2);
  await page.evaluate(() => { const f = window.__fixture; f.pending[1].resolve({ preview: { line: 'latest-preview', env: [] } }); });
  await page.locator('[data-role="launcher-form-preview"]').filter({ hasText: 'latest-preview' }).waitFor();
  await page.evaluate(() => { const f = window.__fixture; f.pending[0].resolve({ preview: { line: 'stale-preview', env: [] } }); f.pending = []; f.hold = ['agent.models']; });
  await page.locator('[data-role="launcher-model-status"] button').click();
  await page.waitForFunction(() => window.__fixture.pending.length === 1);
  await page.evaluate(() => { const f = window.__fixture; f.pending[0].reject(new Error('fixture catalog unavailable')); f.pending = []; f.hold = []; });
  await page.locator('[data-role="launcher-model-status"][data-status="error"]').waitFor();
  assert.match(await page.locator('[data-role="launcher-form-preview"]').textContent(), /latest-preview/);
  assert.equal(await page.locator('[data-field="launcher-model"]').inputValue(), 'custom-model-id');
  await page.locator('[data-role="launcher-model-status"] button').click();
  await page.locator('[data-role="launcher-model-status"][data-status="ready"]').waitFor();
  checks.push('stale launcher previews ignored; catalog failures retain manual IDs');
  await page.setViewportSize({ width: 900, height: 600 });
  await page.screenshot({ path: path.join(out, 'launcher-900.png') });
  const saveRect = await page.locator('[data-action="launcher-save"]').boundingBox();
  assert.ok(saveRect.y + saveRect.height <= 600, 'launcher save stays inside minimum window');
  checks.push('CLI-backed launcher catalog, manual model ID and minimum-window layout');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-role="settings"]').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'settings-open');

  await page.evaluate(() => window.__mt.pinBottom(true));
  await page.locator('[data-action="chip-spawn"]').click();
  await page.locator('[data-field="launcher"]').selectOption('default-codex');
  await page.locator('[data-role="model-status"][data-status="ready"]').waitFor();
  await page.locator('[data-field="model-select"]').selectOption('codex-actual-model');
  await page.locator('[data-field="cwd"]').evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
  assert.ok(await page.locator('[data-role="spawn"]').isVisible());
  await page.locator('[data-action="spawn-submit"]').click();
  await page.locator('[data-role="spawn"]').waitFor({ state: 'hidden' });
  const spawn = await page.evaluate(() => window.__fixture.calls.findLast((c) => c.method === 'session.spawn'));
  assert.equal(spawn.params.launcher, 'default-codex'); assert.equal(spawn.params.model, 'codex-actual-model');
  checks.push('Codex launcher model override, IME-safe dialog and focus restoration');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { const f = window.__fixture; const sessions = f.seed(240); window.__mt.api.emit('$open', { sessions }); });
  await page.locator('[data-action="sidebar"]').click();
  await page.locator('[data-role="sidebar-list"]').waitFor();
  assert.ok(await page.locator('.mt-sb2-row[data-sb="session"]').count() < 60, '240 sessions use a virtual window');
  await page.locator('[data-role="sidebar-filter"]').fill('agent-239');
  await page.locator('.mt-sb2-row[data-sb="session"][data-name="agent-239"]').waitFor();
  await page.locator('[data-role="sidebar-filter"]').evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
  assert.equal(await page.locator('[data-role="sidebar-filter"]').inputValue(), 'agent-239');
  await page.locator('[data-role="sidebar-filter"]').fill('');
  await page.screenshot({ path: path.join(out, 'board-1280.png') });
  checks.push('virtualized 240-session sidebar, filtering and IME preservation');

  await page.locator('[data-action="sidebar-close"]').click();
  await page.evaluate(() => { window.__fixture.hold = ['search.query']; });
  await page.keyboard.press('Meta+f');
  await page.locator('[data-field="search"]').fill('older');
  await page.waitForFunction(() => window.__fixture.pending.length === 1);
  await page.locator('[data-field="search"]').fill('newer');
  await page.waitForFunction(() => window.__fixture.pending.length === 2);
  await page.evaluate(() => { const f = window.__fixture; f.pending[1].resolve({ results: [{ kind: 'session', sessionId: 'session-0', name: 'newer', snippet: 'newer' }] }); });
  await page.locator('.mt-search-item[data-name="newer"]').waitFor();
  await page.evaluate(() => { const f = window.__fixture; f.pending[0].resolve({ results: [{ kind: 'session', sessionId: 'session-0', name: 'older', snippet: 'older' }] }); f.pending = []; f.hold = []; });
  assert.equal(await page.locator('.mt-search-item[data-name="older"]').count(), 0);
  await page.keyboard.press('Escape');
  checks.push('Command-F search ignores out-of-order results');

  await page.locator('[data-session="session-0"] .mt-node-head').click({ modifiers: ['Control'] });
  await page.locator('[data-session="session-1"] .mt-node-head').click({ modifiers: ['Control'] });
  await page.locator('[data-role="selection"]').waitFor();
  const selectedBefore = await page.evaluate(() => [...window.__mt.getState().selected]);
  assert.equal(selectedBefore.length, 2);
  await page.locator('[data-action="layout-more"]').click();
  await page.locator('[data-preset]').first().click();
  assert.deepEqual(await page.evaluate(() => window.__mt.getState().selected), selectedBefore);
  assert.ok(await page.locator('[data-role="selection"]').isVisible());
  checks.push('P30 multi-selection persists after layout preset');

  await page.locator('[data-action="conn-mission"]').click();
  await page.locator('[data-role="mm-group"]').waitFor();
  await page.locator('[data-action="mm-group-toggle"]').first().click();
  assert.equal(await page.locator('[data-role="mm-group"][data-collapsed="1"]').count(), 1);
  await page.screenshot({ path: path.join(out, 'mission-1280.png') });
  await page.keyboard.press('Escape');
  checks.push('mission project grouping and collapse');
  await page.evaluate(() => {
    window.__mt.api.emit('thread.item', { itemId: 'fixture-thread', seq: 1, t: Date.now(), source: 'bar', phase: 'done', text: 'Review this change', targets: ['@agent-000'], results: [{ deliveryId: 'fixture-result', name: 'agent-000', sessionId: 'session-0', phase: 'done', report: { state: 'ready', text: 'Review complete' } }] });
  });
  await page.locator('[data-action="thread-toggle"]').click();
  await page.locator('[data-action="thread-edit"]').click();
  assert.equal(await page.locator('[data-role="command"]').inputValue(), '@agent-000 Review this change');
  await page.locator('[data-action="thread-close"]').click();
  await page.locator('[data-role="command"]').fill('');
  await page.evaluate(() => { window.__mt.pinBottom(false); window.__mt.getState().pendingInput = null; document.activeElement.blur(); });
  await page.mouse.move(5, 5);
  await page.locator('[data-role="bottom"][data-hidden="1"]').waitFor();
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement.dataset.role === 'command');
  checks.push('thread edit returns to composer; bottom autohide and board arrow focus');
  await page.locator('[data-action="memo-new"]').click();
  await page.locator('[data-field="memo-text"]').waitFor();
  checks.push('new memo immediately enters editing');
  const logs = await page.evaluate(() => window.__logs.filter((s) => /react (?:un)?caught|^unhandled|^error /.test(s)));
  assert.deepEqual([...errors, ...logs], []);
  console.log(JSON.stringify({ checks, screenshots: out }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(out, 'failure.png') });
  console.error(JSON.stringify({ checks, artifacts: out, logs: await page?.evaluate(() => window.__logs), text: (await page?.textContent('body'))?.slice(0, 2500) }));
  throw error;
} finally { await browser?.close(); server.close(); }
