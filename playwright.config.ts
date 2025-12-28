import { defineConfig } from '@playwright/test';

/**
 * Playwright Test configuration for DevDuck *installer* tests.
 *
 * We keep installer tests separate from the legacy node:test runner:
 * - node:test continues to run `*.test.ts`
 * - Playwright runs `*.pw.spec.ts`
 */
export default defineConfig({
  testDir: './tests',
  testMatch: ['**/installer/**/*.pw.spec.ts'],

  // Installer tests touch filesystem/processes; keep them deterministic.
  fullyParallel: false,
  workers: 1,

  // These tests can be slow (spawning installers, creating temp workspaces).
  timeout: 2 * 60 * 1000,
  expect: {
    timeout: 30 * 1000
  },

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  projects: [
    {
      name: 'installer'
    }
  ]
});

