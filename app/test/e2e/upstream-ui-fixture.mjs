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
    window.__logs = []; window.__notices = []; window.__navigate = null;
    window.mt = { platform: 'darwin', log: (m) => window.__logs.push(m), notify: async (n) => { window.__notices.push(n); return { shown: true }; }, onNavigate(fn) { window.__navigate = fn; }, onFocus() {}, isFocused: async () => true, setZoom() {}, pickFolder: async () => '/fixture/project' };
    window.WebSocket = class { constructor() { throw new Error('Network socket forbidden in fixture'); } };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('[data-role="splash"]').waitFor({ state: 'hidden' });
  await page.locator('[data-role="empty-hint"]').waitFor();
  assert.equal(await page.locator('[data-role="rail-favorites"] [data-action="launch"]').count(), 4);
  assert.equal(await page.locator('[data-role="rail-favorites"] [data-kind="agy"]').count(), 1);
  checks.push('empty board and Claude/Codex/agy/Shell favorite rail');

  await page.locator('[data-action="settings-open"]').click();
  await page.locator('[data-tab="branch"]').click();
  for (const key of ['branchMaxChildren', 'branchMaxDepth', 'branchMaxTotal']) assert.ok(await page.locator(`[data-field="setting-${key}"]`).isVisible());
  await page.locator('[data-tab="general"]').click();
  await page.locator('[data-field="setting-agentAutoApprove"]').check();
  assert.equal(await page.evaluate(() => window.__fixture.settings.agentAutoApprove), true);
  await page.setViewportSize({ width: 900, height: 600 });
  await page.screenshot({ path: path.join(out, 'auto-approval-on-900.png') });
  await page.locator('[data-field="setting-agentAutoApprove"]').uncheck();
  assert.equal(await page.evaluate(() => window.__fixture.settings.agentAutoApprove), false);
  await page.screenshot({ path: path.join(out, 'auto-approval-off-900.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  checks.push('Auto approval toggle saves the exact board key and reports both states');
  await page.locator('[data-action="termScale-up"]').click();
  assert.equal(await page.evaluate(() => window.__mt.getState().termScale), 1.05);
  checks.push('worker limits visible and independent terminal scaling');

  await page.locator('[data-tab="launchers"]').click();
  await page.locator('[data-action="launcher-new"]').click();
  await page.evaluate(() => window.__mt.api.call('settings.set', { key: 'agentAutoApprove', value: true }));
  assert.ok(await page.locator('[data-field="launcher-permissionMode"]').isDisabled());
  assert.equal(await page.locator('[data-field="launcher-permissionMode"]').inputValue(), 'manual');
  await page.locator('[data-role="launcher-effective-approval"]').waitFor();
  await page.setViewportSize({ width: 900, height: 600 });
  await page.screenshot({ path: path.join(out, 'launcher-auto-override-900.png') });
  for (const selector of ['[data-role="settings"]', '[data-role="settings"] h3', '[data-action="launcher-save"]', '[data-action="settings-close"]']) {
    const r = await page.locator(selector).boundingBox(); assert.ok(r.y >= 0 && r.y + r.height <= 600.5, `${selector} remains visible in the minimum window`);
  }
  await page.evaluate(() => window.__mt.api.call('settings.set', { key: 'agentAutoApprove', value: false }));
  assert.ok(await page.locator('[data-field="launcher-permissionMode"]').isEnabled());
  assert.equal(await page.locator('[data-field="launcher-permissionMode"]').inputValue(), 'manual');
  await page.setViewportSize({ width: 1280, height: 900 });
  checks.push('launcher preview shows effective automatic mode and preserves its stored manual selection');

  for (const kind of ['codex', 'gemini', 'agy']) {
    await page.locator('[data-field="launcher-harness"]').selectOption(kind);
    await page.locator('[data-role="launcher-model-status"][data-status="ready"]').waitFor();
    await page.locator('[data-field="launcher-model"]').click();
    assert.deepEqual(await page.locator('[data-role="launcher-models"] [data-model]').evaluateAll((els) => els.map((e) => e.dataset.model)), [`${kind}-actual-model`]);
    await page.locator('[data-field="launcher-model"]').press('ArrowDown');
    await page.locator('[data-field="launcher-model"]').press('Enter');
    assert.equal(await page.locator('[data-field="launcher-model"]').inputValue(), `${kind}-actual-model`);
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
  await page.evaluate(() => { window.__fixture.hold = ['launcher.parse']; });
  await page.locator('[data-field="launcher-paste"]').fill('codex --model earlier');
  await page.locator('[data-action="launcher-parse"]').click();
  await page.waitForFunction(() => window.__fixture.pending.length === 1);
  await page.locator('[data-field="launcher-name"]').fill('Latest manual edit');
  await page.evaluate(() => { const f = window.__fixture; f.pending[0].resolve({ launcher: { harness: 'codex', model: 'stale-parsed-model', name: 'Old parse', env: {} }, recognized: { as: 'agent', harness: 'codex' } }); f.pending = []; f.hold = []; });
  await page.waitForFunction(() => !document.querySelector('[data-action="launcher-parse"]').disabled);
  assert.equal(await page.locator('[data-field="launcher-name"]').inputValue(), 'Latest manual edit');
  assert.equal(await page.locator('[data-field="launcher-model"]').inputValue(), 'custom-model-id');
  checks.push('stale pasted-command parsing cannot overwrite newer manual edits; model options work by keyboard');
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
  await page.evaluate(() => window.__mt.api.call('settings.set', { key: 'agentAutoApprove', value: true }));
  await page.locator('[data-role="spawn-effective-approval"]').waitFor();
  assert.match(await page.locator('[data-role="launcher-permission"]').textContent(), /Auto approval/);
  await page.locator('[data-field="launcher"]').selectOption('');
  assert.ok(await page.locator('[data-field="permission-mode"]').isDisabled());
  assert.equal(await page.locator('[data-field="permission-mode"]').inputValue(), 'manual');
  await page.screenshot({ path: path.join(out, 'spawn-auto-override-900.png') });
  const spawnSubmit = await page.locator('[data-action="spawn-submit"]').boundingBox();
  const spawnBox = await page.locator('[data-role="spawn"]').boundingBox();
  assert.ok(spawnSubmit.y + spawnSubmit.height <= spawnBox.y + spawnBox.height, 'spawn action remains fully visible');
  await page.evaluate(() => window.__mt.api.call('settings.set', { key: 'agentAutoApprove', value: false }));
  assert.ok(await page.locator('[data-field="permission-mode"]').isEnabled());
  await page.locator('[data-field="permission-mode"]').selectOption('acceptEdits');
  await page.evaluate(() => window.__mt.api.call('settings.set', { key: 'agentAutoApprove', value: true }));
  assert.ok(await page.locator('[data-field="permission-mode"]').isDisabled());
  assert.equal(await page.locator('[data-field="permission-mode"]').inputValue(), 'acceptEdits');
  await page.evaluate(() => window.__mt.api.call('settings.set', { key: 'agentAutoApprove', value: false }));
  assert.equal(await page.locator('[data-field="permission-mode"]').inputValue(), 'acceptEdits');
  checks.push('spawn shows board permission override; disabling it restores the unchanged user selection');

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
  await page.locator('[data-role="mm-group"]').first().click();
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
  // Synthetic native prompts, with a fresh fixture controller and no real backend.
  await page.locator('[data-role="command"]').fill('');
  await page.evaluate(() => {
    const st = window.__mt.getState();
    const session = { ...st.sessions.get('session-0'), state: 'waiting', paneId: 'fixture-pane', ask: { kind: 'question', toolUseId: 'fixture-question', questions: [{ question: 'Which branch should I use?' }] } };
    window.__mt.api.emit('session.updated', session);
    st.navigateTo('session-0', { viewOnly: true });
  });
  const notice = page.locator('[data-session="session-0"] [data-role="response-needed"]');
  await notice.locator('[data-action="response-terminal"]').waitFor();
  assert.match(await notice.textContent(), /Which branch should I use/);
  await notice.locator('button').click();
  await page.waitForFunction(() => document.activeElement?.closest('.xterm') && window.__mt.getState().focusId === 'session-0');
  assert.ok(await page.locator('[data-session="session-0"] .xterm').isVisible());
  await page.setViewportSize({ width: 900, height: 600 });
  await page.evaluate(() => window.__mt.getState().navigateTo('session-0', { viewOnly: true }));
  await page.screenshot({ path: path.join(out, 'response-question-900.png') });
  const nr = await notice.boundingBox();
  assert.ok(nr.x >= 0 && nr.y >= 0 && nr.x + nr.width <= 900.5 && nr.y + nr.height <= 600.5);
  const contrast = await notice.locator('strong').evaluate((el) => {
    const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    const lum = (s) => rgb(s).reduce((n, c, i) => n + c * [.2126, .7152, .0722][i], 0);
    const a = lum(getComputedStyle(el).color), b = lum(getComputedStyle(el.closest('.mt-response')).backgroundColor);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  assert.ok(contrast >= 4.5, `notice contrast ${contrast}`);
  for (const [kind, update, text] of [
    ['trust', { state: 'trust_wait', ask: null }, 'Folder trust required'],
    ['login', { state: 'waiting', ask: { kind: 'screen', tail: 'Please sign in with Google', since: 321 } }, 'Please sign in with Google'],
    ['error', { state: 'error', ask: null, error: { message: 'Synthetic model unavailable', at: 456 } }, 'Synthetic model unavailable'],
  ]) {
    await page.evaluate((update) => { const st = window.__mt.getState(); window.__mt.api.emit('session.updated', { ...st.sessions.get('session-0'), ...update }); }, update);
    await notice.filter({ hasText: text }).waitFor(); assert.equal(await notice.getAttribute('data-kind'), kind);
    await page.screenshot({ path: path.join(out, `response-${kind}-900.png`) });
  }
  await page.evaluate(() => { const st = window.__mt.getState(); window.__mt.api.emit('session.updated', { ...st.sessions.get('session-0'), state: 'ready', ask: null, error: null }); });
  await notice.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.__fixture.calls.filter((c) => c.method === 'session.answer').length), 0);
  checks.push('questions, trust, login, error and resolved transitions; terminal focus; 900×600 notice fit and 4.5:1 contrast');
  await page.evaluate(() => document.activeElement?.blur());
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
