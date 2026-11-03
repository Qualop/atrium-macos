// node --test test/e2e/functional-audit.mjs
// 격리된 headless 프로필과 가짜 API만 사용한다. 실제 Electron 앱·백엔드는 띄우지 않는다.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
let browser, page, tmp;
let errors = [];
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-functional-'));
  await build({ entryPoints: [path.join(here, 'functional-fixture.jsx')], bundle: true, outfile: path.join(tmp, 'fixture.js'), jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>');
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.ATRIUM_TEST_BROWSER || (fs.existsSync(chromium.executablePath()) ? undefined : process.platform === 'darwin' && fs.existsSync(chrome) ? chrome : undefined);
  browser = await chromium.launch({ headless: true, executablePath });
  page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', (error) => errors.push(error.message));
});
after(async () => { await browser?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(async () => { errors = []; await page.goto(pathToFileURL(path.join(tmp, 'index.html')).href + '?webglBudget=0'); await page.waitForFunction(() => !!window.audit); });
afterEach(() => assert.deepEqual(errors, [], 'renderer runtime errors'));
const count = (method) => page.evaluate((m) => audit.calls.filter((c) => c.method === m).length, method);
const waitCall = (method, n = 1) => page.waitForFunction(({ method, n }) => audit.calls.filter((c) => c.method === method).length >= n, { method, n });

test('spawn ignores trust predictions for a previous folder', async () => {
  await page.evaluate(() => { audit.held.add('trust.predict'); audit.render('spawn'); });
  await waitCall('trust.predict');
  await page.locator('[data-field=cwd]').fill('/tmp/new-folder');
  await waitCall('trust.predict', 2);
  await page.evaluate(() => audit.resolve('trust.predict', { needsTrust: true }, 1));
  await page.evaluate(() => audit.resolve('trust.predict', { needsTrust: false, trustedBy: 'old-folder' }, 0));
  assert.equal(await page.locator('.mt-ok').count(), 0);
});

test('spawn handles repeated submit events only once', async () => {
  await page.evaluate(() => {
    audit.held.add('session.spawn'); audit.render('spawn');
    const form = document.querySelector('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(await count('session.spawn'), 1);
});

test('changing a search query cannot navigate to the previous result', async () => {
  await page.evaluate(() => { audit.held.add('search.query'); audit.store.setSearchOpen(true); audit.render('search'); audit.store.getState().navigateTo = (id) => { window.went = id; }; });
  const input = page.locator('[data-field=search]');
  await input.fill('alpha'); await waitCall('search.query');
  await page.evaluate(() => audit.resolve('search.query', { results: [{ kind: 'session', sessionId: 'a', name: 'alpha' }] }));
  await page.locator('.mt-search-item[data-name=alpha]').waitFor();
  await input.fill('beta'); await input.press('Enter');
  assert.equal(await page.evaluate(() => window.went), undefined);
});

test('saving a setting does not discard text typed during the request', async () => {
  await page.evaluate(() => { audit.held.add('settings.set'); audit.render('settings'); });
  await page.locator('button[data-tab=spawn]').click();
  const input = page.locator('[data-field=setting-claudeModel]');
  await input.fill('first'); await input.press('Enter'); await waitCall('settings.set');
  await input.fill('second');
  await page.evaluate(() => audit.resolve('settings.set', {}));
  assert.equal(await input.inputValue(), 'second');
});

test('language selection matches the visible language and rolls back on save failure', async () => {
  await page.evaluate(() => { audit.held.add('settings.set'); audit.render('settings'); });
  await page.locator('button[data-lang=ko]').click();
  assert.equal(await page.locator('button[data-lang=ko]').getAttribute('aria-checked'), 'true');
  await page.evaluate(() => audit.reject('settings.set'));
  assert.equal(await page.locator('button[data-lang=en]').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('[data-role=settings] h3').textContent(), 'Settings');
});

test('late terminal attach after disconnect cannot enable input', async () => {
  await page.evaluate(() => { audit.held.add('terminal.attach'); audit.render('terminal'); });
  await waitCall('terminal.attach');
  await page.evaluate(() => { audit.api.status = 'closed'; audit.api.emit('$close'); audit.resolve('terminal.attach', { controllerPid: 21 }); });
  assert.equal(await page.evaluate(() => audit.terms.get('a').options.disableStdin), true);
});

test('an old controller detach cannot cover a terminal that is still attaching', async () => {
  await page.evaluate(() => { audit.held.add('terminal.attach'); audit.render('terminal'); audit.api.emit('terminal.detached', { sessionId: 'a', controllerPid: 9, reason: 'takeover' }); });
  assert.equal(await page.locator('.mt-term-cover').count(), 0);
});

test('paste is bracketed once and old controller frames are ignored', async () => {
  await page.evaluate(() => audit.render('terminal')); await waitCall('terminal.attach');
  await page.evaluate(() => {
    const data = new DataTransfer(); data.setData('text/plain', 'one\ntwo');
    document.querySelector('.xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
    audit.api.emit('terminal.frame', { sessionId: 'a', controllerPid: 9, bytes: btoa('STALE'), width: 80, height: 24 });
  });
  const inputs = await page.evaluate(() => audit.calls.filter((c) => c.method === 'terminal.input').map((c) => c.params.data));
  assert.deepEqual(inputs, ['\x1b[200~one\rtwo\x1b[201~']);
  assert.equal(await page.evaluate(() => audit.terms.get('a').buffer.active.getLine(0).translateToString(true)), '');
});

test('dock drag stops on pointer cancellation and ignores other pointers', async () => {
  await page.evaluate(() => {
    const st = audit.store.getState();
    st.docks.set('dock', { dockId: 'dock', members: ['a', 'b'], tree: { dir: 'row', kids: ['a', 'b'], ratios: [0.5, 0.5] } });
    audit.render('divider');
    document.querySelector('.mt-divider').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 500, clientY: 0, button: 0 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 550, clientY: 0 }));
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
    window.afterCancel = JSON.stringify([...st.nodes]);
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 700, clientY: 0 }));
  });
  assert.equal(await page.evaluate(() => JSON.stringify([...audit.store.getState().nodes]) === window.afterCancel), true);
});

test('a background board snapshot cannot undo an active dock divider drag', async () => {
  await page.evaluate(async () => {
    const st = audit.store.getState();
    const dock = { dockId: 'dock', members: ['a', 'b'], tree: { dir: 'row', kids: ['a', 'b'], ratios: [0.5, 0.5] } };
    st.docks.set('dock', dock);
    const snapshot = { nodes: [...st.nodes].map(([session_id, r]) => ({ session_id, ...r })), docks: [dock], memos: [], kanbans: [] };
    audit.render('divider');
    document.querySelector('.mt-divider').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 500, clientY: 0, button: 0 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 550, clientY: 0 }));
    window.dragged = JSON.stringify([...st.nodes]);
    audit.held.add('board.get'); const loading = audit.store.loadBoard();
    audit.resolve('board.get', snapshot); await loading;
  });
  assert.equal(await page.evaluate(() => JSON.stringify([...audit.store.getState().nodes]) === window.dragged), true);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 })));
});

test('later canvas navigation wins over a delayed terminal focus callback', async () => {
  await page.evaluate(() => audit.render('canvas'));
  await page.waitForFunction(() => !!audit.store.getState().navigateTo);
  await page.evaluate(() => { const st = audit.store.getState(); st.navigateTo('a', { focusTerminal: true }); st.navigateTo('b', { viewOnly: true }); });
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => audit.store.getState().focusId), 'b');
});

test('Gemini has one agy launcher and legacy Gemini remains in the dialog', async () => {
  await page.evaluate(() => audit.render('chrome'));
  assert.equal(await page.locator('[data-action=spawn-agy]').count(), 1);
  assert.equal(await page.locator('[data-action=spawn-gemini]').count(), 0);
  await page.evaluate(() => audit.render('spawn', { agentKind: 'agy' }));
  await waitCall('agent.kinds');
  assert.equal(await page.locator('[data-field=kind] option[value=gemini]').count(), 1);
});

test('quick spawn deduplicates in-flight clicks, keeps its original workspace and recovers from failure', async () => {
  await page.evaluate(() => {
    audit.held.add('session.spawn');
    audit.quickSpawn('agy');
    audit.store.getState().currentWs = 'other';
    audit.store.getState().workspaces.push({ key: 'other', root: '/tmp/other' });
    audit.quickSpawn('agy');
  });
  assert.equal(await count('session.spawn'), 1);
  assert.equal(await page.evaluate(() => audit.calls.find((c) => c.method === 'session.spawn').params.cwd), '/tmp/atrium-fixture');
  await page.evaluate(() => audit.reject('session.spawn'));
  await page.evaluate(() => { audit.quickSpawn('agy'); });
  assert.equal(await count('session.spawn'), 2);
});

test('inbox orders requests across workspaces and updates without moving nodes', async () => {
  await page.evaluate(() => {
    audit.api.emit('session.updated', { sessionId: 'a', name: 'a', workspaceKey: 'fixture', state: 'waiting', ask: { since: 20, summary: 'later' } });
    audit.api.emit('session.updated', { sessionId: 'b', name: 'b', workspaceKey: 'other', state: 'trust_wait', ask: { since: 10, summary: 'earlier' } });
    window.positions = JSON.stringify([...audit.store.getState().nodes]);
    audit.render('chrome');
  });
  await page.locator('[data-role=inbox]').click();
  assert.deepEqual(await page.locator('[data-role=inbox-list] [data-session]').evaluateAll((els) => els.map((e) => e.dataset.session)), ['b', 'a']);
  await page.evaluate(() => audit.api.emit('session.updated', { sessionId: 'b', name: 'b', state: 'working' }));
  assert.equal(await page.locator('[data-role=inbox]').getAttribute('data-count'), '1');
  assert.equal(await page.evaluate(() => JSON.stringify([...audit.store.getState().nodes]) === window.positions), true);
});

test('terminal reconnect restores focus but does not detach the new connection', async () => {
  await page.evaluate(() => audit.render('terminal')); await waitCall('terminal.attach');
  await page.evaluate(() => {
    audit.terms.get('a').focus(); audit.api.generation++;
    audit.api.status = 'closed'; audit.api.emit('$close');
    audit.held.add('terminal.attach'); audit.api.status = 'open';
    // Only the terminal listener: store bootstrap is separately covered by its lifecycle tests.
    const listeners = [...audit.api.listeners.get('$open')]; listeners.at(-1)();
  });
  await waitCall('terminal.attach', 2);
  assert.equal(await count('terminal.detach'), 0);
  await page.evaluate(() => audit.resolve('terminal.attach', { controllerPid: 22 }, 1));
  assert.equal(await page.evaluate(() => document.activeElement === audit.terms.get('a').textarea), true);
});

test('pending terminal attach does not steal focus from search', async () => {
  await page.evaluate(() => {
    audit.held.add('terminal.attach'); audit.store.setPendingInput('a'); audit.render('terminal');
    const input = document.createElement('input'); input.id = 'other-input'; document.body.append(input); input.focus();
    audit.store.setSearchOpen(true); audit.resolve('terminal.attach', { controllerPid: 22 });
  });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'other-input');
});

test('settings tabs remain inside the minimum supported window', async () => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.evaluate(() => audit.render('settings'));
  for (const tab of ['general', 'spawn', 'agents', 'sleep', 'recall']) {
    await page.locator(`button[data-tab=${tab}]`).click();
    const bounds = await page.locator('[data-role=settings]').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 900 && bounds.y + bounds.height <= 600, tab);
  }
  if (process.env.ATRIUM_AUDIT_OUT) await page.screenshot({ path: path.join(process.env.ATRIUM_AUDIT_OUT, 'settings.png') });
  await page.setViewportSize({ width: 1100, height: 800 });
});

test('role collaboration history cannot be replaced by an older response', async () => {
  await page.evaluate(() => {
    audit.store.getState().links.set('role', { linkId: 'role', from: 'a', to: 'b', role: 'reviewer', count: 1 });
    audit.held.add('link.log'); audit.render('link');
    audit.api.emit('link.event', { linkId: 'role' });
    audit.resolve('link.log', { events: [{ id: 2, kind: 'reply', t: 2, text: 'latest reply' }] }, 1);
  });
  await page.locator('.mt-linkev-text').waitFor();
  await page.evaluate(() => audit.resolve('link.log', { events: [{ id: 1, kind: 'prompt', t: 1, text: 'old prompt' }] }, 0));
  assert.equal(await page.locator('.mt-linkev-text').textContent(), 'latest reply');
});

test('100 concurrent session updates keep layout and selection stable, with at most eight terminals', async () => {
  await page.setViewportSize({ width: 2400, height: 1800 });
  await page.evaluate(() => {
    const st = audit.store.getState(); st.sessions = new Map(); st.nodes = new Map(); st.viewport = { x: 50, y: 80, zoom: 0.8 };
    for (let i = 0; i < 100; i++) {
      const id = `s${i}`;
      st.sessions.set(id, { sessionId: id, name: id, kind: 'shell', state: 'idle', workspaceKey: 'fixture', createdAt: 1 });
      st.nodes.set(id, { x: (i % 10) * 760, y: Math.floor(i / 10) * 500, w: 720, h: 460 });
    }
    window.positions = JSON.stringify([...st.nodes]); audit.render('canvas');
  });
  await page.locator('.react-flow__node-session[data-id=s0]').waitFor();
  await page.locator('[data-id=s0] .mt-node-head').click();
  await page.locator('[data-id=s1] .mt-node-head').click({ modifiers: ['Control'] });
  const selected = await page.evaluate(() => [...audit.store.getState().selected]);
  assert.ok(selected.includes('s0') && selected.includes('s1'), `selected: ${JSON.stringify(selected)}`);
  await page.evaluate(() => {
    for (const s of audit.store.getState().sessions.values()) audit.api.emit('session.updated', { ...s, state: 'working' });
  });
  await waitCall('terminal.attach');
  assert.deepEqual(await page.evaluate(() => audit.store.getState().selected), selected);
  assert.equal(await page.evaluate(() => JSON.stringify([...audit.store.getState().nodes]) === window.positions), true);
  assert.ok(await page.evaluate(() => audit.store.getState().attached.length <= 8 && audit.terms.size <= 8));
  if (process.env.ATRIUM_AUDIT_OUT) await page.screenshot({ path: path.join(process.env.ATRIUM_AUDIT_OUT, 'canvas.png') });
  await page.setViewportSize({ width: 1100, height: 800 });
});
