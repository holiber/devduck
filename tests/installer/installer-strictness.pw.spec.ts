/**
 * Tests for installer strictness and error handling
 * Migrated to Playwright Test
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

import { createTempWorkspace, cleanupTempWorkspace, runInstaller } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('installer: hook load failure is fatal', async () => {
  const tempWorkspace = await createTempWorkspace('devduck-hook-fail-');
  try {
    const moduleName = 'badmod';
    const moduleDir = path.join(tempWorkspace, 'modules', moduleName);
    await fs.mkdir(moduleDir, { recursive: true });

    await fs.writeFile(
      path.join(moduleDir, 'MODULE.md'),
      [
        '---',
        `name: ${moduleName}`,
        'version: 0.1.0',
        'description: Workspace-local module with broken hooks',
        'dependencies: [core]',
        '---',
        '',
        'Broken hooks module used in tests.',
        ''
      ].join('\n'),
      'utf8'
    );

    await fs.writeFile(
      path.join(moduleDir, 'hooks.ts'),
      [
        "import 'this-module-does-not-exist';",
        '',
        'export default {',
        "  'pre-install': async () => ({ success: true })",
        '};',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = await runInstaller(tempWorkspace, {
      unattended: true,
      modules: ['core', moduleName],
      skipRepoInit: true
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Failed to load hooks from .*hooks\.ts/i);
  } finally {
    await cleanupTempWorkspace(tempWorkspace);
  }
});

test('installer: .env values are available to shell checks (fill-missing)', async () => {
  const tempWorkspace = await createTempWorkspace('devduck-dotenv-prop-');
  try {
    await fs.writeFile(path.join(tempWorkspace, '.env'), 'ARCADIA_ROOT=from_env_file\n', 'utf8');

    await fs.writeFile(
      path.join(tempWorkspace, 'workspace.config.json'),
      JSON.stringify(
        {
          workspaceVersion: '0.1.0',
          devduckPath: './projects/devduck',
          modules: ['core'],
          repos: [],
          projects: [],
          checks: [
            {
              type: 'test',
              name: 'dotenv-propagation',
              description: 'Ensures shell checks can read vars from .env when not in process.env',
              test: "sh -c 'test \"$ARCADIA_ROOT\" = \"from_env_file\"'"
            }
          ],
          env: []
        },
        null,
        2
      ),
      'utf8'
    );

    const result = await runInstaller(tempWorkspace, {
      unattended: true,
      modules: ['core'],
      skipRepoInit: true
    });

    expect(result.exitCode).toBe(0);
  } finally {
    await cleanupTempWorkspace(tempWorkspace);
  }
});

test('installer: checks without name do not print "Checking undefined"', async () => {
  const tempWorkspace = await createTempWorkspace('devduck-check-name-');
  try {
    await fs.writeFile(path.join(tempWorkspace, '.env'), 'SOME_TOKEN=ok\n', 'utf8');

    const moduleName = 'nonamecheck';
    const moduleDir = path.join(tempWorkspace, 'modules', moduleName);
    await fs.mkdir(moduleDir, { recursive: true });

    await fs.writeFile(
      path.join(moduleDir, 'MODULE.md'),
      [
        '---',
        `name: ${moduleName}`,
        'version: 0.1.0',
        'description: Module with a check missing name',
        'dependencies: [core]',
        'checks:',
        '  - type: "auth"',
        '    var: "SOME_TOKEN"',
        '    description: "Auth check without name"',
        "    test: 'sh -c \"test -n \\\"$SOME_TOKEN\\\"\"'",
        '---',
        '',
        'Module used in tests.',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = await runInstaller(tempWorkspace, {
      unattended: true,
      modules: ['core', moduleName],
      skipRepoInit: true
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).not.toMatch(/Checking undefined/i);
    expect(result.stdout + result.stderr).toMatch(/Checking SOME_TOKEN/i);
  } finally {
    await cleanupTempWorkspace(tempWorkspace);
  }
});

test('installer summary: prints INSTALLATION FINISHED WITH ERRORS on failures', async () => {
  const tempWorkspace = await createTempWorkspace('devduck-summary-fail-');
  try {
    await fs.writeFile(
      path.join(tempWorkspace, 'workspace.config.json'),
      JSON.stringify(
        {
          workspaceVersion: '0.1.0',
          devduckPath: './projects/devduck',
          modules: ['core'],
          repos: [],
          projects: [],
          checks: [
            {
              type: 'test',
              name: 'always-fail',
              test: "sh -c 'exit 1'"
            }
          ],
          env: []
        },
        null,
        2
      ),
      'utf8'
    );

    const result = await runInstaller(tempWorkspace, {
      unattended: true,
      modules: ['core'],
      skipRepoInit: true
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/INSTALLATION FINISHED WITH ERRORS/);
    expect(result.stdout + result.stderr).toMatch(/Checks:\s+\d+\/\d+\s+passed/);
    expect(result.stdout + result.stderr).toMatch(/See log:\s+\.cache\/install\.log/);
  } finally {
    await cleanupTempWorkspace(tempWorkspace);
  }
});
