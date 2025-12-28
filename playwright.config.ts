import { defineConfig } from '@playwright/test';

/**
 * Playwright Test configuration for DevDuck.
 *
 * Notes:
 * - Node.js `node:test` suites live in `*.test.ts` and are run via `npm test` (see `scripts/run-tests.ts`)
 * - Playwright suites live in `*.pw.spec.ts`
 *   - `npm test` runs all Playwright projects from this config
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

