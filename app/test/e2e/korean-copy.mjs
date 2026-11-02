import assert from 'node:assert/strict';
import path from 'node:path';

export async function checkKoreanCopy({ page, app, client, dir }) {
  await client.call('settings.set', { language: 'ko' });
  await page.waitForFunction(() => document.querySelector('[data-role="review"]')?.textContent.includes('확인할 결과'));
  assert.match(await page.locator('[data-role="inbox"]').innerText(), /응답 필요/);
  assert.match(await page.locator('[data-action="chip-mission"]').innerText(), /작업 관계도/);
  assert.match(await page.locator('[data-role="command"]').getAttribute('placeholder'), /⌘K/);
  await page.screenshot({ path: path.join(dir, 'ko-board.png') });
  await page.locator('[data-action="settings-open"]').click();
  const settings = page.locator('[data-role="settings"]');
  await settings.waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));
  for (const tab of ['general', 'spawn', 'agents', 'sleep', 'branch', 'recall']) {
    await settings.locator(`[role="tab"][data-tab="${tab}"]`).click();
    const bounds = await settings.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight, overflow: el.scrollWidth > el.clientWidth + 2 }; });
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= bounds.w + 1 && bounds.bottom <= bounds.h + 1 && !bounds.overflow, tab);
    assert.doesNotMatch(await settings.innerText(), /덩어리|가지 펼치기|잠재우기|거르기|내 차례/);
    if (tab === 'spawn') {
      const mode = settings.locator('[data-field="setting-claudePermissionMode"]');
      assert.match(await mode.innerText(), /승인 요청 표시/);
      await mode.selectOption('plan');
      await page.waitForFunction(() => window.__mt.getState().settings.claudePermissionMode === 'plan');
      assert.equal((await client.call('settings.get')).settings.claudePermissionMode, 'plan');
      await mode.selectOption('manual');
    }
    if (['spawn', 'sleep', 'branch'].includes(tab)) await page.screenshot({ path: path.join(dir, `ko-settings-${tab}.png`) });
  }
  await settings.locator('[data-action="settings-close"]').click();
  await page.locator('[data-action="spawn"]').click({ modifiers: ['Shift'] });
  const form = page.locator('[data-role="spawn"]');
  await form.getByLabel('세션 이름', { exact: true }).waitFor();
  const permission = form.locator('[data-field="permission-mode"]');
  assert.equal(await permission.inputValue(), 'manual');
  assert.match(await permission.innerText(), /승인 요청 표시/);
  assert.ok(await form.evaluate((el) => el.scrollWidth <= el.clientWidth + 2));
  assert.match(await form.locator('[data-field="name"]').getAttribute('placeholder'), /reviewer/);
  await page.screenshot({ path: path.join(dir, 'ko-spawn.png') });
  await form.getByRole('button', { name: '취소', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 960));
  await page.locator('[data-action="thread-toggle"]').click();
  await page.getByText('요청 기록', { exact: true }).waitFor();
  await page.locator('[data-action="thread-close"]').click();
  await client.call('settings.set', { language: 'en' });
  await page.waitForFunction(() => document.querySelector('[data-role="review"]')?.textContent.includes('Review'));
  await client.call('settings.set', { language: 'ko' });
  console.log('PASS Korean copy: navigation, six settings tabs at 900x600, permission values, session dialog, request history, language switch');
}
