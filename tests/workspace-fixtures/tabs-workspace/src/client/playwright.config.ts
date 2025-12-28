import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4020';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL,
    viewport: { width: 900, height: 600 },
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'on'
  }
});

