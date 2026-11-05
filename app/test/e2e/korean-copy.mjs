import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertPickerFixture, assertPickerFits, favoriteFor, favoriteButton, pickerScreenshot } from './model-picker.mjs';

export async function checkKoreanCopy({ page, app, client, dir }) {
  await assertPickerFixture({ app, client, dir });
  const originalLanguage = (await client.call('settings.get')).settings.language;
  const originalSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  const originalPin = await page.evaluate(() => window.__mt.getState().bottomPin);
  const claude = await favoriteFor(client, 'claude');
  const settings = page.locator('[data-role="settings"]');
  const form = page.locator('[data-role="spawn"]');
  const fixtureName = '한국어 권한 검증';
  let fixtureId;
  try {
    await client.call('settings.set', { language: 'ko' });
    await page.evaluate(() => window.__mt.pinBottom(true));
    await page.waitForFunction(() => document.querySelector('[data-role="review"]')?.textContent.includes('확인할 결과'));
    assert.match(await page.locator('[data-role="inbox"]').innerText(), /응답 필요/);
    await page.locator('[data-action="chip-mission"]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-action="chip-mission"]').innerText(), /작업 관계도/);
    assert.match(await page.locator('[data-role="command"]').getAttribute('placeholder'), /⌘K/);
    await pickerScreenshot(page, path.join(dir, 'ko-board.png'));
    await page.locator('[data-action="settings-open"]').click();
    await settings.waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));
    const tabs = ['general', 'launchers', 'sleep', 'branch', 'recall', 'devices'];
    assert.deepEqual(await settings.locator('[role="tab"]').evaluateAll((els) => els.map((el) => el.dataset.tab)), tabs);
    for (const tab of tabs) {
      await settings.locator(`[role="tab"][data-tab="${tab}"]`).click();
      await assertPickerFits(settings);
      assert.doesNotMatch(await settings.innerText(), /덩어리|가지 펼치기|잠재우기|거르기|내 차례/);
      if (tab === 'branch') for (const key of ['branchMaxChildren', 'branchMaxDepth', 'branchMaxTotal']) assert.ok(await settings.locator(`[data-field="setting-${key}"]`).isVisible());
      if (['launchers', 'sleep', 'branch'].includes(tab)) await pickerScreenshot(page, path.join(dir, `ko-settings-${tab}.png`));
    }

    // Permissions now belong to presets. Save and edit only a new, non-favorite
    // preset in the isolated board; never mutate the default Claude launcher.
    await settings.locator('[role="tab"][data-tab="launchers"]').click();
    await settings.locator('[data-action="launcher-new"]').click();
    const editor = settings.locator('[data-role="launcher-form"]');
    const mode = editor.locator('[data-field="launcher-permissionMode"]');
    assert.match(await mode.innerText(), /승인 요청 표시/);
    await editor.locator('[data-field="launcher-name"]').fill(fixtureName);
    await editor.locator('[data-field="launcher-favorite"]').uncheck();
    await mode.selectOption('plan');
    await pickerScreenshot(page, path.join(dir, 'ko-settings-permission.png'));
    await editor.locator('[data-action="launcher-save"]').click();
    await page.waitForFunction((name) => window.__mt.getState().launchers.launchers.some((l) => l.name === name), fixtureName);
    let data = await client.call('launcher.list');
    let created = data.launchers.find((l) => l.name === fixtureName);
    fixtureId = created.id;
    assert.equal(created.permissionMode, 'plan');
    assert.ok(!data.favorites.includes(fixtureId));
    await settings.locator(`[data-role="launcher-row"][data-launcher=${JSON.stringify(fixtureId)}] [data-action="launcher-edit"]`).click();
    assert.equal(await mode.inputValue(), 'plan');
    await mode.selectOption('manual');
    await editor.locator('[data-action="launcher-save"]').click();
    await page.waitForFunction((id) => window.__mt.getState().launchers.launchers.find((l) => l.id === id)?.permissionMode === 'manual', fixtureId);
    created = (await client.call('launcher.list')).launchers.find((l) => l.id === fixtureId);
    assert.equal(created.permissionMode, 'manual');
    await settings.locator('[data-action="settings-close"]').click();

    await favoriteButton(page, claude.id).click({ modifiers: ['Shift'] });
    await form.getByLabel('세션 이름', { exact: true }).waitFor();
    assert.equal(await form.locator('[data-field="launcher"]').inputValue(), claude.id);
    assert.match(await form.locator('[data-role="launcher-permission"]').innerText(), /승인 요청 표시/);
    assert.equal(await form.locator('[data-field="permission-mode"]').count(), 0);
    await form.locator('[data-field="launcher"]').selectOption('');
    const permission = form.locator('[data-field="permission-mode"]');
    assert.equal(await permission.inputValue(), 'manual');
    assert.match(await permission.innerText(), /승인 요청 표시/);
    await assertPickerFits(form);
    assert.match(await form.locator('[data-field="name"]').getAttribute('placeholder'), /reviewer/);
    await pickerScreenshot(page, path.join(dir, 'ko-spawn.png'));
    await form.getByRole('button', { name: '취소', exact: true }).click();
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), originalSize);
    await page.locator('[data-action="thread-toggle"]').click();
    await page.locator('[data-role="thread"]').getByText('요청 기록', { exact: true }).waitFor();
    await page.locator('[data-action="thread-close"]').click();
    await client.call('settings.set', { language: 'en' });
    await page.waitForFunction(() => document.querySelector('[data-role="review"]')?.textContent.includes('Review'));
    await client.call('settings.set', { language: 'ko' });
    await page.waitForFunction(() => document.querySelector('[data-role="review"]')?.textContent.includes('확인할 결과'));
    fs.writeFileSync(path.join(dir, 'korean-copy.json'), JSON.stringify({ tabs, size: [900, 600], permissionModesSaved: ['plan', 'manual'], defaultLauncherUnchanged: true, manualSpawn: true, thread: true, languageSwitch: ['ko', 'en', 'ko'] }, null, 2));
    console.log('PASS Korean copy: six preset-era settings tabs at 900x600, worker limits, saved preset permissions, preset/manual spawn, autohide-aware request history, language switch');
  } finally {
    if (await form.isVisible()) await form.getByRole('button', { name: '취소', exact: true }).click();
    if (await settings.isVisible()) await settings.locator('[data-action="settings-close"]').click();
    // If a UI assertion failed immediately after saving, still remove our fixture.
    const data = await client.call('launcher.list');
    fixtureId ||= data.launchers.find((l) => l.name === fixtureName)?.id;
    if (fixtureId) await client.call('launcher.delete', { id: fixtureId });
    assert.deepEqual((await client.call('launcher.list')).launchers.find((l) => l.id === claude.id), claude);
    await client.call('settings.set', { language: originalLanguage });
    await page.evaluate((pin) => window.__mt.pinBottom(pin), originalPin);
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), originalSize);
  }
}
