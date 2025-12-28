import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir,
  testMatch: '**/*.pw.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI
    ? [
        ['list'],
        ['json', { outputFile: '.cache/metrics/pw-installer-report.json' }]
      ]
    : 'list',
  use: {
    // Always keep artifacts (screenshots/videos) so new/updated tests
    // reliably provide debugging context, even when they pass.
    // CI uploads `.cache/playwright/` (copied from `test-results/`).
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'on'
  }
});

