#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// packages/cli/bin lives at <repoRoot>/packages/cli/bin
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const cliScript = path.join(repoRoot, 'scripts', 'barducks-cli.ts');

// When invoked via npm/npx, INIT_CWD points to the directory where the user ran the command.
const userCwd = process.env.INIT_CWD || process.cwd();

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsx', cliScript, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    cwd: userCwd,
    env: process.env
  }
);

process.exit(result.status ?? 1);

