import { expect, test } from '@playwright/test';

test('switching tabs updates content and captures screenshots', async ({ page }, testInfo) => {
  await page.goto('/');

  const content = page.getByTestId('tab-content');

  await expect(content).toHaveText('Hello from tab1 - default');
  await page.screenshot({ path: testInfo.outputPath('tab1.png'), fullPage: true });

  await page.getByTestId('tab-2').click();
  await expect(content).toHaveText('Hello from tab2');
  await page.screenshot({ path: testInfo.outputPath('tab2.png'), fullPage: true });

  await page.getByTestId('tab-3').click();
  await expect(content).toHaveText('loading...');
  await expect(content).toHaveText('Hello from tab3 - lazy', { timeout: 3_000 });
  await page.screenshot({ path: testInfo.outputPath('tab3.png'), fullPage: true });
});

