
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.pw.spec.ts',
  timeout: 30000,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    headless: true,
    trace: 'on-first-retry',
  },
  reporter: 'list',
});
