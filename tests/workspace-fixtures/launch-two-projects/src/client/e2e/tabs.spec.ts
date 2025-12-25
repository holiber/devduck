import { test, expect } from '@playwright/test';

test('switching tabs renders correct content and screenshots', async ({ page }, testInfo) => {
  await page.goto('/');

  await expect(page.getByText('Hello from tab1 - default')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tab1.png'), fullPage: true });

  await page.getByTestId('tab2').click();
  await expect(page.getByText('Hello from tab2')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tab2.png'), fullPage: true });

  await page.getByTestId('tab3').click();
  await expect(page.getByText('loading...')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tab3-loading.png'), fullPage: true });

  await expect(page.getByText('Hello from tab3 - lazy')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tab3.png'), fullPage: true });
});

