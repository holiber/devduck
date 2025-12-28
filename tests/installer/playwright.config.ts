import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.pw\.spec\.ts$/,
  timeout: 60_000, // 60 seconds for installer tests
  retries: 0,
  workers: 1, // Run tests serially to avoid conflicts with shared workspaces
  use: {
    headless: true,
  },
  // Output directory for test results
  outputDir: path.join(__dirname, '../../.cache/playwright-results'),
});
