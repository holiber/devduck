import { test, expect } from './test';

test('basic smoke + browser console capture', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => console.log('DEV_DUCK_SMOKE_OK'));
  await page.evaluate(() => console.error('DEV_DUCK_SMOKE_ERR'));
  await expect(page.locator('h1')).toHaveText('ok');
});

