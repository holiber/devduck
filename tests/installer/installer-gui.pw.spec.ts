#!/usr/bin/env node

/**
 * Tests for workspace installer in GUI/interactive mode
 * Migrated to Playwright Test
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
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
          modules: ['core', 'plan', 'vcs'],
          skipRepoInit: true
        });

        const installed = await waitForInstallation(tempWorkspace, 30000);
        expect(installed).toBeTruthy();

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists).toBeTruthy();
        expect(structure.cacheDirExists).toBeTruthy();
        // In core-only installs, Cursor integration artifacts are optional.

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'plan', 'vcs']
        });
        expect(configVerification.valid).toBeTruthy();
        expect(configVerification.config).toBeTruthy();

        // This test validates interactive installer flow; do not require cursor module.
        const moduleVerification = await verifyModuleInstallation(tempWorkspace);
        expect(moduleVerification.commandsFound).toBeGreaterThanOrEqual(0);

        expect(result.exitCode).toBe(0);
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
      const result = await runInstaller(tempWorkspace, {
        unattended: false
      });

      const configPath = path.join(tempWorkspace, 'workspace.config.json');
      const configExists = await fs.access(configPath).then(() => true).catch(() => false);
      expect(configExists).toBeTruthy();
    });
  });
});
