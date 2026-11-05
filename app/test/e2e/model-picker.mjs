import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// These helpers may mutate only the mac-smoke fixture's board and Electron profile.
export async function assertPickerFixture({ app, client, dir }) {
  assert.match(dir, /^\/(?:private\/)?tmp\/atrium-mac-/);
  const status = await client.call('backend.status');
  assert.equal(status.profile, 'dev');
  const runtime = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), source: app.getAppPath() }));
  const fixtureRoot = fs.realpathSync(dir);
  for (const target of [status.dataDir, runtime.userData]) {
    const relative = path.relative(fixtureRoot, fs.realpathSync(target));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Test data must stay inside the mac-smoke fixture');
  }
  const expectedApp = process.env.ATRIUM_TEST_APP
    ? path.join(process.env.ATRIUM_TEST_APP, 'Contents/Resources/app')
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  assert.equal(fs.realpathSync(runtime.source), fs.realpathSync(expectedApp), 'Use only the explicitly selected test app');
}

export async function favoriteFor(client, harness) {
  const data = await client.call('launcher.list');
  const matches = data.launchers.filter((l) => l.harness === harness && data.favorites.includes(l.id));
  assert.equal(matches.length, 1, `Expected one ${harness} favorite on the fresh board`);
  return matches[0];
}
export const favoriteButton = (page, id) => page.locator(`[data-role="rail-favorites"] [data-action="launch"][data-launcher=${JSON.stringify(id)}]`);
export async function assertPickerFits(form) {
  const b = await form.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight, overflow: el.scrollWidth > el.clientWidth + 2 }; });
  assert.ok(b.x >= 0 && b.y >= 0 && b.right <= b.w + 1 && b.bottom <= b.h + 1 && !b.overflow, JSON.stringify(b));
}
export async function pickerScreenshot(page, filename) {
  // Blocked fixture launches intentionally show errors. Let those expire so
  // screenshots document the UI rather than test-generated toast overlays.
  await page.waitForFunction(() => !document.querySelector('.mt-toast'));
  await page.screenshot({ path: filename });
}

export async function checkModelPicker({ page, app, client, project, dir }) {
  await assertPickerFixture({ app, client, dir });
  const originalSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  const originalLanguage = (await client.call('settings.get')).settings.language;
  await client.call('workspace.open', { path: project });
  const launcher = await favoriteFor(client, 'codex');
  // Success-state models come from the actual Codex app-server model/list API.
  const catalog = await client.call('agent.models', { kind: 'codex' });
  assert.equal(catalog.source, 'codex');
  assert.ok(catalog.models.length > 0, 'Installed Codex CLI must return real model IDs');
  const model = catalog.models.find((m) => m.id !== launcher.model) || catalog.models[0];
  const expectedIds = catalog.models.map((m) => m.id).sort();
  const form = page.locator('[data-role="spawn"]');
  const settings = page.locator('[data-role="settings"]');
  const waitStatus = (status) => form.locator(`[data-role="model-status"][data-status="${status}"]`).waitFor();
  await page.evaluate(() => {
    const api = window.__mt.api;
    const fixture = window.__codexPicker = { original: api.call, mode: 'real', submitted: [], queries: [] };
    api.call = function(method, params) {
      if (method === 'session.spawn') { fixture.submitted.push(params); return Promise.reject(new Error('fixture: launch captured')); }
      if (method === 'agent.models' && params.kind === 'codex') {
        fixture.queries.push(params);
        if (fixture.mode === 'error') return Promise.reject(new Error('fixture: offline'));
        if (fixture.mode === 'empty') return Promise.resolve({ models: [], source: 'fixture-empty' });
      }
      return fixture.original.call(this, method, params);
    };
  });
  try {
    await client.call('settings.set', { language: 'ko' });
    await favoriteButton(page, launcher.id).click({ modifiers: ['Shift'] });
    await form.getByLabel('세션 이름', { exact: true }).waitFor();
    assert.equal(await form.locator('[data-field="launcher"]').inputValue(), launcher.id);
    assert.equal(await form.locator('[data-field="kind"]').count(), 0, 'Preset mode owns the harness');
    await waitStatus('ready');
    assert.equal(await form.locator('[data-role="model-status"]').getAttribute('data-source'), catalog.source);
    const values = await form.locator('[data-field="model-select"] option').evaluateAll((els) => els.map((e) => e.value).filter((v) => v && v !== '__custom__').sort());
    assert.deepEqual(values, expectedIds);
    await form.locator('[data-field="model-select"]').selectOption(model.id);
    await form.locator('[data-field="name"]').fill('reviewer');
    await pickerScreenshot(page, path.join(dir, 'model-picker.png'));
    await form.locator('[data-action="spawn-submit"]').click();
    await page.waitForFunction(() => window.__codexPicker.submitted.length === 1);
    const preset = await page.evaluate(() => window.__codexPicker.submitted[0]);
    assert.equal(preset.launcher, launcher.id); assert.equal(preset.name, 'reviewer');
    assert.equal(preset.model, model.id === launcher.model ? undefined : model.id);
    assert.ok(!('kind' in preset) && !('permissionMode' in preset));

    // Direct selection still supports CLI arguments; presets keep those in their editor.
    await form.locator('[data-field="launcher"]').selectOption('');
    await form.locator('[data-field="kind"]').selectOption('codex');
    await waitStatus('ready');
    await form.locator('[data-field="model-select"]').selectOption(model.id);
    await form.locator('[data-role="advanced-args"] summary').click();
    const args = '-m old-model -c model_reasoning_effort=high';
    await form.locator('[data-field="args"]').fill(args);
    await form.locator('[data-action="spawn-submit"]').click();
    await page.waitForFunction(() => window.__codexPicker.submitted.length === 2);
    const direct = await page.evaluate(() => window.__codexPicker.submitted[1]);
    assert.equal(direct.kind, 'codex'); assert.equal(direct.model, model.id); assert.equal(direct.args, args);
    assert.ok(!('launcher' in direct) && !('permissionMode' in direct));
    const preview = await client.call('launcher.preview', { launcher: { name: 'Codex smoke preview', harness: 'codex', model: model.id, args } });
    assert.ok(preview.preview.line.includes(model.id)); assert.ok(!preview.preview.line.includes('old-model'));

    await page.evaluate(() => { window.__codexPicker.mode = 'error'; });
    await form.locator('[data-action="models-refresh"]').click(); await waitStatus('error');
    await form.locator('[data-field="model-select"]').selectOption('__custom__');
    await form.locator('[data-field="model"]').fill('custom-model');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));
    await assertPickerFits(form);
    await page.evaluate(() => { window.__codexPicker.mode = 'empty'; });
    await form.locator('[data-action="models-refresh"]').click(); await waitStatus('empty');
    assert.equal(await form.locator('[data-field="model"]').inputValue(), 'custom-model');
    await pickerScreenshot(page, path.join(dir, 'model-picker-empty.png'));
    await form.locator('[data-field="kind"]').selectOption('shell');
    assert.equal(await form.locator('[data-field="model-select"]').count(), 0);
    await form.getByRole('button', { name: '취소', exact: true }).click();

    await page.evaluate(() => { window.__codexPicker.mode = 'real'; });
    await page.locator('[data-action="settings-open"]').click();
    await settings.locator('[role="tab"][data-tab="launchers"]').click();
    await settings.locator(`[data-role="launcher-row"][data-launcher=${JSON.stringify(launcher.id)}] [data-action="launcher-edit"]`).click();
    const editor = settings.locator('[data-role="launcher-form"]');
    await editor.locator('[data-role="launcher-model-status"][data-status="ready"]').waitFor();
    assert.deepEqual(await editor.locator('#ln-models-codex option').evaluateAll((els) => els.map((e) => e.value).sort()), expectedIds);
    await editor.locator('[data-field="launcher-model"]').fill('manual-preset-model');
    assert.equal(await editor.locator('[data-field="launcher-model"]').inputValue(), 'manual-preset-model');
    await editor.locator('[data-role="launcher-form-preview"]').filter({ hasText: 'manual-preset-model' }).waitFor();
    await assertPickerFits(settings);
    await pickerScreenshot(page, path.join(dir, 'model-preset-editor.png'));
    const evidence = { catalog, preset, direct, preview: preview.preview.line, editor: 'actual Codex catalog and manual ID' };
    fs.writeFileSync(path.join(dir, 'model-picker.json'), JSON.stringify(evidence, null, 2));
    console.log(`PASS Codex picker: ${catalog.models.length} real models (${catalog.source}), favorite preset, direct model/args payload, preview override, manual fallback, refresh, preset editor, 900x600`);
  } finally {
    await page.evaluate(() => { if (window.__codexPicker) window.__mt.api.call = window.__codexPicker.original; delete window.__codexPicker; });
    if (await form.isVisible()) await form.getByRole('button', { name: '취소', exact: true }).click();
    if (await settings.isVisible()) await settings.locator('[data-action="settings-close"]').click();
    await client.call('settings.set', { language: originalLanguage });
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), originalSize);
  }
}
