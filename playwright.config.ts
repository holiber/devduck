import { defineConfig } from '@playwright/test';

/**
 * Playwright Test configuration for Barducks *installer* tests.
 *
 * We keep installer tests separate from the legacy node:test runner:
 * - node:test continues to run `*.test.ts`
 * - Playwright runs `*.pw.spec.ts`
 */
export default defineConfig({
  testDir: './tests',

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
      name: 'installer',
      testMatch: ['installer/**/*.pw.spec.ts']
    },
    {
      // Non-installer suites (ported from node:test).
      name: 'unit',
      testMatch: ['**/*.pw.spec.ts'],
      testIgnore: ['installer/**']
    }
  ]
});

