#!/usr/bin/env node

/**
 * Tests for workspace installer in unattended mode
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs').promises;
const {
  createTempWorkspace,
  cleanupTempWorkspace,
  runInstaller,
  verifyWorkspaceStructure,
  verifyWorkspaceConfig,
  verifyModuleInstallation,
  waitForInstallation
} = require('./helpers');

describe('Workspace Installer - Unattended Mode', () => {
  describe('Fresh Workspace Installation', () => {
    test('Unattended Installation - Fresh Workspace', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        const installed = await waitForInstallation(tempWorkspace, 30000);
        assert.ok(installed, 'Installation should complete');

        const hasPrompts = result.stdout.includes('?') || result.stderr.includes('?');
        assert.ok(!hasPrompts, 'Unattended mode should not show prompts');

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        assert.ok(structure.workspaceConfigExists, 'workspace.config.json should exist');
        assert.ok(structure.cursorDirExists, '.cursor directory should exist');

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'cursor']
        });
        assert.ok(configVerification.valid, 'Config should be valid');

        assert.strictEqual(result.exitCode, 0, 'Installer should exit with code 0');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Unattended Installation with Config File', async () => {
      const tempWorkspace = await createTempWorkspace();
      const configPath = path.join(tempWorkspace, 'test-config.json');
      
      try {
        const config = {
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'vcs'],
          skipRepoInit: true
        };
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          config: configPath
        });

        const installed = await waitForInstallation(tempWorkspace, 30000);
        assert.ok(installed, 'Installation should complete');

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'cursor', 'vcs']
        });
        assert.ok(configVerification.valid, 'Config should be valid');
        assert.ok(configVerification.config.modules.includes('vcs'), 'vcs module should be installed');

        assert.strictEqual(result.exitCode, 0, 'Installer should exit with code 0');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Unattended Installation - Full Structure Verification', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        const result = await runInstaller(tempWorkspace, {
          unattended: true,
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
    test('Reinstall Existing Workspace - Unattended', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        await waitForInstallation(tempWorkspace, 30000);

        const initialConfig = await verifyWorkspaceConfig(tempWorkspace);
        assert.ok(initialConfig.valid, 'Initial config should be valid');

        const reinstallResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'vcs'],
          skipRepoInit: true
        });

        await waitForInstallation(tempWorkspace, 30000);

        const afterReinstall = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'cursor', 'vcs']
        });
        assert.ok(afterReinstall.valid, 'Config after reinstall should be valid');
        assert.ok(afterReinstall.config.modules.includes('vcs'), 'vcs module should be added');

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        assert.ok(structure.workspaceConfigExists, 'workspace.config.json should still exist');
        assert.ok(structure.cursorDirExists, '.cursor directory should still exist');

        const moduleVerification = await verifyModuleInstallation(tempWorkspace, ['core', 'cursor', 'vcs']);
        assert.ok(moduleVerification.commandsFound > 0, 'Commands should be present');

        assert.strictEqual(reinstallResult.exitCode, 0, 'Reinstall should exit with code 0');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Add Modules to Existing Workspace', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        await waitForInstallation(tempWorkspace, 30000);

        const initialConfig = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'cursor']
        });
        assert.ok(initialConfig.valid, 'Initial config should be valid');

        await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'dashboard'],
          skipRepoInit: true
        });

        await waitForInstallation(tempWorkspace, 30000);

        const afterAdd = await verifyWorkspaceConfig(tempWorkspace);
        assert.ok(afterAdd.config.modules.includes('dashboard'), 'dashboard module should be added');
        assert.ok(afterAdd.config.modules.includes('core'), 'core module should still be present');
        assert.ok(afterAdd.config.modules.includes('cursor'), 'cursor module should still be present');

        const moduleVerification = await verifyModuleInstallation(tempWorkspace);
        assert.ok(moduleVerification.commandsFound > 0, 'Commands should include dashboard commands');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Remove Modules from Existing Workspace', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'dashboard', 'vcs'],
          skipRepoInit: true
        });

        await waitForInstallation(tempWorkspace, 30000);

        const initialConfig = await verifyWorkspaceConfig(tempWorkspace);
        assert.ok(initialConfig.config.modules.includes('dashboard'), 'dashboard should be initially installed');

        await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'vcs'],
          skipRepoInit: true
        });

        await waitForInstallation(tempWorkspace, 30000);

        const afterRemove = await verifyWorkspaceConfig(tempWorkspace);
        assert.ok(!afterRemove.config.modules.includes('dashboard'), 'dashboard module should be removed');
        assert.ok(afterRemove.config.modules.includes('core'), 'core module should still be present');
        assert.ok(afterRemove.config.modules.includes('cursor'), 'cursor module should still be present');
        assert.ok(afterRemove.config.modules.includes('vcs'), 'vcs module should still be present');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Reinstallation Verification - Preserve Configuration', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'plan'],
          skipRepoInit: true
        });

        await waitForInstallation(tempWorkspace, 30000);

        const configPath = path.join(tempWorkspace, 'workspace.config.json');
        const initialConfigContent = await fs.readFile(configPath, 'utf8');
        const initialConfig = JSON.parse(initialConfigContent);

        initialConfig.moduleSettings = {
          core: {
            testSetting: 'testValue'
          }
        };
        await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2), 'utf8');

        await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'plan'],
          skipRepoInit: true
        });

        await waitForInstallation(tempWorkspace, 30000);

        const afterReinstall = await verifyWorkspaceConfig(tempWorkspace);
        assert.ok(afterReinstall.config.moduleSettings, 'moduleSettings should be preserved');
        assert.ok(afterReinstall.config.moduleSettings.core, 'core module settings should be preserved');
        assert.strictEqual(
          afterReinstall.config.moduleSettings.core.testSetting,
          'testValue',
          'Custom setting should be preserved'
        );

        assert.ok(afterReinstall.config.modules.includes('core'), 'core should still be installed');
        assert.ok(afterReinstall.config.modules.includes('cursor'), 'cursor should still be installed');
        assert.ok(afterReinstall.config.modules.includes('plan'), 'plan should still be installed');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Reinstallation - Module Hooks Re-executed', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        await waitForInstallation(tempWorkspace, 30000);

        const cursorignorePath = path.join(tempWorkspace, '.cursorignore');
        let initialCursorignore = '';
        try {
          initialCursorignore = await fs.readFile(cursorignorePath, 'utf8');
        } catch (e) {
          throw new Error('.cursorignore should exist after initial installation');
        }

        await fs.writeFile(cursorignorePath, '# Modified content', 'utf8');

        await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        await waitForInstallation(tempWorkspace, 30000);

        const afterReinstall = await fs.readFile(cursorignorePath, 'utf8');
        assert.notStrictEqual(
          afterReinstall,
          '# Modified content',
          '.cursorignore should be regenerated by hooks'
        );
        assert.ok(afterReinstall.includes('.env'), '.cursorignore should contain default content');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });
  });
});

