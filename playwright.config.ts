import { defineConfig } from '@playwright/test';

/**
 * Installer-only Playwright Test configuration.
 *
 * We intentionally scope Playwright to the installer folder (matching `*.pw.spec.ts`) so the
 * existing Node.js test runner continues to own all non-installer tests.
 */
export default defineConfig({
  testDir: 'tests/installer',
  testMatch: '**/*.pw.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list']] : [['list']],
  use: {
    // These installer tests are mostly "node-style" (fs/spawn) and typically do not use the browser.
    // Keep defaults minimal and deterministic.
  }
});

