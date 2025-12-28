import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.pw.spec.ts',
  timeout: 60_000,
  retries: 0,
  workers: 1, // Run serially for installer tests
  use: {
    headless: true,
  },
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  outputDir: 'test-results/artifacts',
});
