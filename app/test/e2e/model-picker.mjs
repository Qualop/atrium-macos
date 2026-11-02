import assert from 'node:assert/strict';
import path from 'node:path';

export async function checkModelPicker({ page, app, client, project, dir }) {
  await client.call('workspace.open', { path: project });
  await client.call('settings.set', { language: 'ko' });
  await page.locator('[data-action="spawn-codex"]').click({ modifiers: ['Shift'] });
  const form = page.locator('[data-role="spawn"]');
  await form.getByLabel('세션 이름', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-role="model-status"]')?.dataset.status === 'ready');
  const options = await form.locator('[data-field="model-select"] option').evaluateAll((els) => els.map((e) => ({ value: e.value, text: e.textContent })));
  const model = options.find((o) => o.value && o.value !== '__custom__'); assert.ok(model);
  await form.locator('[data-field="model-select"]').selectOption(model.value);
  await form.locator('[data-field="name"]').fill('reviewer');
  await page.screenshot({ path: path.join(dir, 'model-picker.png') });
  await form.locator('summary').click();
  await form.locator('[data-field="args"]').fill('-m old-model -c model_reasoning_effort=high');
  await page.evaluate(() => {
    window.__pickerOriginal = window.__mt.api.call;
    window.__pickerMode = 'real';
    window.__mt.api.call = function(method, params) {
      if (method === 'session.spawn') { window.__pickerSubmitted = params; return Promise.reject(new Error('fixture: launch captured')); }
      if (method === 'agent.models' && window.__pickerMode === 'error') return Promise.reject(new Error('fixture: offline'));
      if (method === 'agent.models' && window.__pickerMode === 'empty') return Promise.resolve({ models: [] });
      return window.__pickerOriginal.call(this, method, params);
    };
  });
  await form.locator('[data-action="spawn-submit"]').click();
  await page.waitForFunction(() => !!window.__pickerSubmitted);
  const submitted = await page.evaluate(() => window.__pickerSubmitted);
  assert.equal(submitted.model, model.value); assert.equal(submitted.name, 'reviewer');
  await form.getByRole('button', { name: '취소', exact: true }).click();
  await page.evaluate(() => { window.__pickerMode = 'error'; });
  await page.locator('[data-action="spawn-codex"]').click({ modifiers: ['Shift'] });
  await page.waitForFunction(() => document.querySelector('[data-role="model-status"]')?.dataset.status === 'error');
  await form.locator('[data-field="model-select"]').selectOption('__custom__');
  await form.locator('[data-field="model"]').fill('custom-model');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));
  const bounds = await form.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight }; });
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= bounds.w && bounds.bottom <= bounds.h);
  await page.evaluate(() => { window.__pickerMode = 'empty'; });
  await form.locator('[data-action="models-refresh"]').click();
  await page.waitForFunction(() => document.querySelector('[data-role="model-status"]')?.dataset.status === 'empty');
  assert.equal(await form.locator('[data-field="model"]').inputValue(), 'custom-model');
  await form.locator('[data-field="kind"]').selectOption('shell');
  assert.equal(await form.locator('[data-field="model-select"]').count(), 0);
  await form.getByRole('button', { name: '취소', exact: true }).click();
  await page.evaluate(() => { window.__mt.api.call = window.__pickerOriginal; delete window.__pickerOriginal; });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 960));
  console.log(`PASS model picker: ${options.length - 2} detected models, selection payload, manual fallback, refresh, empty state, 900x600`);
}
