import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const isCI = !!process.env.CI;

export default defineConfig({
  testDir,
  timeout: 30_000,
  retries: isCI ? 1 : 0,

  // Reporter configuration
  reporter: isCI
    ? [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['json', { outputFile: 'test-results/smoke-results.json' }],
      ]
    : 'list',

  // Output directory for test artifacts
  outputDir: 'test-results',

  use: {
    baseURL: process.env.BASE_URL,
    headless: true,

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

