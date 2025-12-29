import { test } from '@playwright/test';
import assert from 'node:assert';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { createTempWorkspace, cleanupTempWorkspace } from './helpers.js';
import YAML from 'yaml';

async function readYaml(p: string): Promise<any> {
  const raw = await fs.readFile(p, 'utf8');
  return YAML.parse(raw);
}

test.describe('barducks new (npx-friendly bootstrap)', () => {
  test('clones Barducks into barducks/src when not listed in projects', async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const result = spawnSync(
        'node',
        [path.join(process.cwd(), 'bin', 'barducks.js'), 'new', workspaceRoot, '--devduck-source', process.cwd()],
        {
          cwd: process.cwd(),
          env: { ...process.env, NODE_ENV: 'test' },
          encoding: 'utf8'
        }
      );

      assert.strictEqual(result.status, 0, `command should succeed. stderr: ${result.stderr || ''}`);

      const cfgPath = path.join(workspaceRoot, 'workspace.config.yml');
      const cfg = await readYaml(cfgPath);
      assert.strictEqual(cfg.devduck_path, './barducks/src', 'devduck_path should point to local barducks/src');

      const clonedPackageJson = path.join(workspaceRoot, 'barducks', 'src', 'package.json');
      const stat = await fs.stat(clonedPackageJson);
      assert.ok(stat.isFile(), 'barducks/src/package.json should exist');
    } finally {
      await cleanupTempWorkspace(workspaceRoot);
    }
  });

  test('resolves relative workspace path from INIT_CWD (npx cache cwd simulation)', async () => {
    const initCwd = await createTempWorkspace();
    const fakePkgCwd = await createTempWorkspace();

    const workspaceName = 'crm-workspace';
    const workspaceRoot = path.join(initCwd, workspaceName);

    try {
      const result = spawnSync(
        'node',
        [path.join(process.cwd(), 'bin', 'barducks.js'), 'new', workspaceName, '--devduck-source', process.cwd()],
        {
          // Simulate npx running inside a temporary package directory
          cwd: fakePkgCwd,
          env: { ...process.env, NODE_ENV: 'test', INIT_CWD: initCwd },
          encoding: 'utf8'
        }
      );

      assert.strictEqual(result.status, 0, `command should succeed. stderr: ${result.stderr || ''}`);

      const cfgPath = path.join(workspaceRoot, 'workspace.config.yml');
      const cfg = await readYaml(cfgPath);
      assert.strictEqual(cfg.devduck_path, './barducks/src', 'devduck_path should point to local barducks/src');

      const clonedPackageJson = path.join(workspaceRoot, 'barducks', 'src', 'package.json');
      const stat = await fs.stat(clonedPackageJson);
      assert.ok(stat.isFile(), 'barducks/src/package.json should exist');
    } finally {
      await cleanupTempWorkspace(initCwd);
      await cleanupTempWorkspace(fakePkgCwd);
    }
  });
});

