
import { test, expect } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import { spawnSync } from 'child_process';
import { createTempWorkspace, cleanupTempWorkspace } from './helpers.js';

async function readJson(p: string): Promise<any> {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

test.describe('devduck new (npx-friendly bootstrap)', () => {
  test('clones DevDuck into devduck/src when not listed in projects', async () => {
    const workspaceRoot = await createTempWorkspace();

    try {
      const result = spawnSync(
        'node',
        [
          path.join(process.cwd(), 'bin', 'devduck.js'),
          'new',
          workspaceRoot,
          '--devduck-source',
          process.cwd()
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, NODE_ENV: 'test' },
          encoding: 'utf8'
        }
      );

      expect(result.status, `command should succeed. stderr: ${result.stderr || ''}`).toBe(0);

      const cfgPath = path.join(workspaceRoot, 'workspace.config.json');
      const cfg = await readJson(cfgPath);
      expect(cfg.devduckPath, 'devduckPath should point to local devduck/src').toBe('./devduck/src');

      const clonedPackageJson = path.join(workspaceRoot, 'devduck', 'src', 'package.json');
      const stat = await fs.stat(clonedPackageJson);
      expect(stat.isFile(), 'devduck/src/package.json should exist').toBeTruthy();
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
        [path.join(process.cwd(), 'bin', 'devduck.js'), 'new', workspaceName, '--devduck-source', process.cwd()],
        {
          // Simulate npx running inside a temporary package directory
          cwd: fakePkgCwd,
          env: { ...process.env, NODE_ENV: 'test', INIT_CWD: initCwd },
          encoding: 'utf8'
        }
      );

      expect(result.status, `command should succeed. stderr: ${result.stderr || ''}`).toBe(0);

      const cfgPath = path.join(workspaceRoot, 'workspace.config.json');
      const cfg = await readJson(cfgPath);
      expect(cfg.devduckPath, 'devduckPath should point to local devduck/src').toBe('./devduck/src');

      const clonedPackageJson = path.join(workspaceRoot, 'devduck', 'src', 'package.json');
      const stat = await fs.stat(clonedPackageJson);
      expect(stat.isFile(), 'devduck/src/package.json should exist').toBeTruthy();
    } finally {
      await cleanupTempWorkspace(initCwd);
      await cleanupTempWorkspace(fakePkgCwd);
    }
  });
});
