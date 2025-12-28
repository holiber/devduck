import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const testDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir,
  timeout: 30_000,
  retries: 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['json', { outputFile: '.cache/metrics/pw-smoke-report.json' }]
      ]
    : 'list',
  use: {
    baseURL: process.env.BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
    // Always keep artifacts (screenshots/videos) so new/updated tests
    // reliably provide debugging context, even when they pass.
    screenshot: 'on',
    video: 'on'
  }
});

