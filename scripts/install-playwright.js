#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

/**
 * Playwright browser install is intentionally opt-in.
 *
 * Why:
 * - It downloads large binaries (slow + expensive for bootstrap).
 * - Many workflows don't need browser automation.
 *
 * How to enable:
 * - Set DEVDUCK_INSTALL_PLAYWRIGHT=1 (recommended for CI).
 * - Or run: npm run playwright:install
 */

const enabled = String(process.env.DEVDUCK_INSTALL_PLAYWRIGHT || '').trim() === '1' || String(process.env.CI || '').trim() === '1';

if (!enabled) {
  process.stdout.write(
    'Playwright browser install skipped (opt-in). ' +
      'Set DEVDUCK_INSTALL_PLAYWRIGHT=1 or run `npm run playwright:install`.\n'
  );
  process.exit(0);
}

const res = spawnSync('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit' });
process.exit(res.status ?? 1);

