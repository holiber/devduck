import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const isCI = !!process.env.CI;

export default defineConfig({
  testDir,
  testMatch: '**/*.pw.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  timeout: 60_000,

  // Reporter configuration
  reporter: isCI
    ? [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['json', { outputFile: 'test-results/results.json' }],
      ]
    : 'list',

  // Output directory for test artifacts
  outputDir: 'test-results',

  use: {
    // Capture screenshot on failure
    screenshot: 'only-on-failure',

    // Record video on failure (for debugging)
    video: isCI ? 'retain-on-failure' : 'off',

    // Capture trace on failure (for debugging)
    trace: isCI ? 'retain-on-failure' : 'off',

    // Viewport for consistent screenshots
    viewport: { width: 1280, height: 720 },
  },

  // Configure projects if needed
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

