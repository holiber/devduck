#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// bin/ lives at <pkgRoot>/bin, scripts/ lives at <pkgRoot>/scripts
const pkgRoot = path.resolve(__dirname, '..');
const cliScript = path.join(pkgRoot, 'scripts', 'devduck-cli.ts');

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsx', cliScript, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    cwd: pkgRoot,
    env: process.env
  }
);

process.exit(result.status ?? 1);

