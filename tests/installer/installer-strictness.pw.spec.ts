import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';

import { createTempWorkspace, cleanupTempWorkspace, runInstaller } from './helpers.js';

function toRelPath(fromDir: string, toDir: string): string {
  let rel = path.relative(fromDir, toDir);
  if (!rel || rel === '.') rel = '.';
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

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
      ["import 'this-module-does-not-exist';", '', 'export default {', "  'pre-install': async () => ({ success: true })", '};', ''].join(
        '\n'
      ),
      'utf8'
    );

    const result = await runInstaller(tempWorkspace, {
      unattended: true,
      modules: ['core', moduleName],
      skipRepoInit: true
    });

    assert.notEqual(result.exitCode, 0, 'installer should fail when hooks.ts cannot be loaded');
    assert.match(result.stdout + result.stderr, /Failed to load hooks from .*hooks\.ts/i);
  } finally {
    await cleanupTempWorkspace(tempWorkspace);
  }
});

test('installer: .env values are available to shell checks (fill-missing)', async () => {
  const tempWorkspace = await createTempWorkspace('devduck-dotenv-prop-');
  try {
    await fs.writeFile(path.join(tempWorkspace, '.env'), 'ARCADIA_ROOT=from_env_file\n', 'utf8');

    const devduckPath = toRelPath(tempWorkspace, process.cwd());
    await fs.writeFile(
      path.join(tempWorkspace, 'workspace.config.yml'),
      YAML.stringify(
        {
            version: '0.1.0',
            devduck_path: devduckPath,
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
        }
      ),
      'utf8'
    );

    const result = await runInstaller(tempWorkspace, {
      unattended: true,
      modules: ['core'],
      skipRepoInit: true
    });

    assert.equal(result.exitCode, 0, `installer should succeed. stderr:\n${result.stderr}`);
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

    assert.equal(result.exitCode, 0, `installer should succeed. stderr:\n${result.stderr}`);
    assert.doesNotMatch(result.stdout + result.stderr, /Checking undefined/i);
    assert.match(result.stdout + result.stderr, /Checking SOME_TOKEN/i);
  } finally {
    await cleanupTempWorkspace(tempWorkspace);
  }
});

test('installer summary: prints INSTALLATION FINISHED WITH ERRORS on failures', async () => {
  const tempWorkspace = await createTempWorkspace('devduck-summary-fail-');
  try {
    const devduckPath = toRelPath(tempWorkspace, process.cwd());
    await fs.writeFile(
      path.join(tempWorkspace, 'workspace.config.yml'),
      YAML.stringify(
        {
            version: '0.1.0',
            devduck_path: devduckPath,
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
        }
      ),
      'utf8'
    );

    const result = await runInstaller(tempWorkspace, {
      unattended: true,
      modules: ['core'],
      skipRepoInit: true
    });

    // Taskfile-based installer intentionally does not fail the overall install on verification failures.
    assert.equal(result.exitCode, 0);

    const output = result.stdout + result.stderr;
    assert.match(output, /Verification completed/i);
    assert.match(output, /failed/i);
    assert.match(output, /See log:\s+.*\.cache\/install\.log/i);

    const stateRaw = await fs.readFile(path.join(tempWorkspace, '.cache', 'install-state.json'), 'utf8');
    const state = JSON.parse(stateRaw) as {
      steps?: Record<string, { completed?: boolean; result?: Array<{ name?: string; passed?: boolean | null }> }>;
    };
    assert.ok(state.steps?.['verify-installation']?.completed, 'verify-installation step should be completed');

    const verifications = state.steps?.['verify-installation']?.result ?? [];
    const alwaysFail = verifications.find((v) => v.name === 'always-fail');
    assert.ok(alwaysFail, 'Expected always-fail check to be present in verification results');
    assert.equal(alwaysFail?.passed, false, 'always-fail should be recorded as failed');
  } finally {
    await cleanupTempWorkspace(tempWorkspace);
  }
});

