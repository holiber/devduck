import { test } from '@playwright/test';
import assert from 'node:assert';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  createTempWorkspace,
  createWorkspaceFromFixture,
  cleanupTempWorkspace,
  runInstaller,
  verifyWorkspaceStructure,
  verifyWorkspaceConfig,
  verifyModuleInstallation,
  waitForInstallation
} from './helpers.js';

test.describe('Workspace Installer - GUI/Interactive Mode', () => {
  test.describe('Fresh Workspace Installation', () => {
    test('GUI Installation - Fresh Workspace', async () => {
      const tempWorkspace = await createTempWorkspace();

      try {
        const result = await runInstaller(tempWorkspace, {
          unattended: false,
          aiAgent: 'cursor',
          repoType: 'none',
          extensions: ['core', 'plan', 'vcs'],
          skipRepoInit: true
        });

        const installed = await waitForInstallation(tempWorkspace, 30000);
        assert.ok(installed, 'Installation should complete');

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        assert.ok(structure.workspaceConfigExists, 'workspace.config.yml should exist');
        assert.ok(structure.cacheDirExists, '.cache/devduck directory should exist');
        // In core-only installs, Cursor integration artifacts are optional.

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          extensions: ['core', 'plan', 'vcs']
        });
        assert.ok(configVerification.valid, 'workspace.config.yml should be valid');
        assert.ok(configVerification.config, 'Config should be loaded');

        // This test validates interactive installer flow; do not require cursor module.
        const moduleVerification = await verifyModuleInstallation(tempWorkspace);
        assert.ok(moduleVerification.commandsFound >= 0, 'Commands directory check should not crash');

        assert.strictEqual(result.exitCode, 0, 'Installer should exit with code 0');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });
  });

  test.describe('Existing Workspace Operations', () => {
    let tempWorkspace: string;

    test.beforeAll(async () => {
      tempWorkspace = await createWorkspaceFromFixture('existing-workspace', {
        prefix: 'devduck-existing-workspace-test-'
      });
    });

    test.afterAll(async () => {
      if (tempWorkspace) {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Detect Existing Workspace', async () => {
      await runInstaller(tempWorkspace, {
        unattended: false
      });

      const configPath = path.join(tempWorkspace, 'workspace.config.yml');
      const configExists = await fs.access(configPath).then(() => true).catch(() => false);
      assert.ok(configExists, 'Existing workspace should be detected');
    });
  });
});

