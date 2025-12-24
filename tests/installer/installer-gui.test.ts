#!/usr/bin/env node

/**
 * Tests for workspace installer in GUI/interactive mode
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { promises as fs } from 'fs';
import {
  createTempWorkspace,
  cleanupTempWorkspace,
  runInstaller,
  verifyWorkspaceStructure,
  verifyWorkspaceConfig,
  verifyModuleInstallation,
  waitForInstallation,
  createMockWorkspace
} from './helpers.js';

describe('Workspace Installer - GUI/Interactive Mode', () => {
  describe('Fresh Workspace Installation', () => {
    test('GUI Installation - Fresh Workspace', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        const result = await runInstaller(tempWorkspace, {
          unattended: false,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'plan', 'vcs'],
          skipRepoInit: true
        });

        const installed = await waitForInstallation(tempWorkspace, 30000);
        assert.ok(installed, 'Installation should complete');

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        assert.ok(structure.workspaceConfigExists, 'workspace.config.json should exist');
        assert.ok(structure.cursorDirExists, '.cursor directory should exist');
        assert.ok(structure.commandsDirExists, '.cursor/commands directory should exist');
        assert.ok(structure.rulesDirExists, '.cursor/rules directory should exist');
        assert.ok(structure.mcpJsonExists, '.cursor/mcp.json should exist');
        assert.ok(structure.cacheDirExists, '.cache/devduck directory should exist');
        assert.ok(structure.cursorignoreExists, '.cursorignore should exist');

        if (structure.errors.length > 0) {
          throw new Error(`Structure verification failed: ${structure.errors.join(', ')}`);
        }

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'cursor', 'plan', 'vcs']
        });
        assert.ok(configVerification.valid, 'workspace.config.json should be valid');
        assert.ok(configVerification.config, 'Config should be loaded');

        const moduleVerification = await verifyModuleInstallation(tempWorkspace, ['core', 'cursor']);
        assert.ok(moduleVerification.commandsFound > 0, 'Commands should be installed');
        assert.ok(moduleVerification.rulesFound, 'Rules file should exist');

        assert.strictEqual(result.exitCode, 0, 'Installer should exit with code 0');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });
  });

  describe('Existing Workspace Operations', () => {
    let tempWorkspace;

    before(async () => {
      tempWorkspace = await createTempWorkspace();
      await createMockWorkspace(tempWorkspace, {
        modules: ['core', 'cursor']
      });
    });

    after(async () => {
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
      assert.ok(configExists, 'Existing workspace should be detected');
    });
  });
});

