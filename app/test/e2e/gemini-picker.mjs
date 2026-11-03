import assert from 'node:assert/strict';
import path from 'node:path';

// 실제 설치된 CLI 목록을 읽되 세션 실행은 가로챈다. 로그인·승인이나 추론을 실행하지 않는다.
export async function checkGeminiPicker({ page, app, client, project, dir }) {
  await client.call('workspace.open', { path: project });
  await client.call('settings.set', { language: 'ko' });
  const catalog = await client.call('agent.models', { kind: 'gemini' });
  assert.ok(Array.isArray(catalog.models) && catalog.models.length > 0, 'Installed Gemini CLI must return a model catalog');
  assert.ok(typeof catalog.source === 'string' && catalog.source, 'Catalog must identify its discovery source');
  for (const model of catalog.models) {
    assert.ok(typeof model.id === 'string' && model.id, 'Model ID must be present');
    assert.ok(typeof model.name === 'string' && model.name, 'Model name must be present');
  }
  const originalSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  await page.evaluate(() => {
    const api = window.__mt.api;
    const fixture = window.__geminiPicker = { original: api.call, mode: 'real', submitted: [], queries: [] };
    api.call = function(method, params) {
      if (method === 'session.spawn') {
        fixture.submitted.push(params);
        return Promise.reject(new Error('fixture: Gemini launch captured'));
      }
      if (method === 'agent.models') {
        fixture.queries.push(params);
        if (params.kind === 'agy') return Promise.resolve({ models: [{ id: 'gemini-agy-fixture', name: 'Gemini fixture' }], source: 'fixture-agy' });
        if (params.kind === 'gemini' && fixture.mode === 'error') return Promise.reject(new Error('fixture: catalog unavailable'));
        if (params.kind === 'gemini' && fixture.mode === 'empty') return Promise.resolve({ models: [], source: 'fixture-empty' });
      }
      return fixture.original.call(this, method, params);
    };
  });
  const form = page.locator('[data-role="spawn"]');
  const status = form.locator('[data-role="model-status"]');
  const select = form.locator('[data-field="model-select"]');
  const waitStatus = (expected) => page.waitForFunction((value) => document.querySelector('[data-role="model-status"]')?.dataset.status === value, expected);
  try {
    assert.equal(await page.locator('[data-action="spawn-gemini"]').count(), 0);
    const launcher = page.locator('[data-action="spawn-agy"]');
    assert.match(await launcher.getAttribute('aria-label'), /Gemini/);
    assert.equal(await launcher.locator('[data-kind="agy"]').getAttribute('alt'), 'Gemini (Antigravity)');
    await launcher.click({ modifiers: ['Shift'] });
    await form.getByLabel('세션 이름', { exact: true }).waitFor();
    await waitStatus('ready');
    assert.equal(await form.locator('[data-field="kind"]').inputValue(), 'agy');
    assert.deepEqual(await page.evaluate(() => window.__geminiPicker.queries[0]), { kind: 'agy' });
    await form.locator('[data-field="kind"]').selectOption('gemini');
    await waitStatus('ready');
    assert.equal(await form.locator('[data-field="kind"]').inputValue(), 'gemini');
    assert.equal(await form.locator('[data-field="kind"] option:checked').innerText(), 'Gemini CLI');
    assert.equal(await status.getAttribute('data-source'), catalog.source);
    assert.match(await status.innerText(), /Gemini CLI/);
    assert.match(await status.innerText(), /접근 권한을 확인한 결과는 아니/);
    assert.match(await form.locator('[data-role="agent-note"]').innerText(), /Google.*Antigravity.*터미널.*검토자 역할/);
    const options = await select.locator('option').evaluateAll((els) => els.map((el) => el.value));
    for (const model of catalog.models) assert.ok(options.includes(model.id), `Missing installed model ${model.id}`);
    assert.deepEqual(await page.evaluate(() => window.__geminiPicker.queries.at(-1)), { kind: 'gemini' });
    const model = catalog.models[0];
    await select.selectOption(model.id);
    await form.locator('[data-field="name"]').fill('gemini-reviewer');
    await form.locator('[data-field="prompt"]').fill('Review the proposed changes.');
    await form.locator('[data-role="advanced-args"] summary').click();
    const args = '--sandbox';
    await form.locator('[data-field="args"]').fill(args);
    await page.screenshot({ path: path.join(dir, 'gemini-picker.png') });
    await form.locator('[data-action="spawn-submit"]').click();
    await page.waitForFunction(() => window.__geminiPicker.submitted.length === 1);
    const submitted = await page.evaluate(() => window.__geminiPicker.submitted[0]);
    assert.equal(submitted.kind, 'gemini');
    assert.equal(submitted.model, model.id);
    assert.equal(submitted.args, args);
    assert.equal(submitted.name, 'gemini-reviewer');
    assert.equal(submitted.prompt, 'Review the proposed changes.');
    assert.ok(!('permissionMode' in submitted) && !('allowHerdr' in submitted), 'Do not send Claude-specific options');

    await select.selectOption('');
    await form.locator('[data-field="args"]').fill('');
    await form.locator('[data-action="spawn-submit"]').click();
    await page.waitForFunction(() => window.__geminiPicker.submitted.length === 2);
    const defaults = await page.evaluate(() => window.__geminiPicker.submitted[1]);
    assert.equal(defaults.model, '');
    assert.equal(defaults.args, '');

    await page.evaluate(() => { window.__geminiPicker.mode = 'error'; });
    await form.locator('[data-action="models-refresh"]').click();
    await waitStatus('error');
    await select.selectOption('__custom__');
    await form.locator('[data-field="model"]').fill('gemini-custom-fixture');
    await page.evaluate(() => { window.__geminiPicker.mode = 'empty'; });
    await form.locator('[data-action="models-refresh"]').click();
    await waitStatus('empty');
    assert.equal(await form.locator('[data-field="model"]').inputValue(), 'gemini-custom-fixture');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));
    const bounds = await form.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight, overflow: el.scrollWidth > el.clientWidth };
    });
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= bounds.w && bounds.bottom <= bounds.h && !bounds.overflow);
    await page.screenshot({ path: path.join(dir, 'gemini-picker-empty.png') });
    await form.locator('[data-field="kind"]').selectOption('shell');
    assert.equal(await form.locator('[data-field="model-select"]').count(), 0);
    await form.locator('[data-field="kind"]').selectOption('agy');
    await waitStatus('ready');
    assert.match(await form.locator('[data-role="agent-note"]').innerText(), /Google.*Antigravity.*검토자/);
    await select.selectOption('gemini-agy-fixture');
    const before = await page.evaluate(() => window.__geminiPicker.submitted.length);
    await form.locator('[data-action="spawn-submit"]').click();
    await page.waitForFunction((n) => window.__geminiPicker.submitted.length > n, before);
    const google = await page.evaluate(() => window.__geminiPicker.submitted.at(-1));
    assert.equal(google.kind, 'agy'); assert.equal(google.model, 'gemini-agy-fixture');
    await page.screenshot({ path: path.join(dir, 'google-picker.png') });
    console.log('PASS Google account / Antigravity picker: provider, model payload, reviewer guidance (fixture catalog)');
    console.log(`PASS Gemini picker: ${catalog.models.length} CLI models (${catalog.source}), exact kind/model/args payload, reviewer help, defaults, manual fallback, refresh, 900x600`);
  } finally {
    await page.evaluate(() => {
      const fixture = window.__geminiPicker;
      if (fixture) window.__mt.api.call = fixture.original;
      delete window.__geminiPicker;
    });
    if (await form.isVisible()) await form.getByRole('button', { name: '취소', exact: true }).click();
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), originalSize);
  }
}
