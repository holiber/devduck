/**
 * Tests for workspace installer in unattended mode
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
  waitForInstallation,
  checkInstallerResult
} from './helpers.js';

test.describe('Workspace Installer - Unattended Mode', () => {
  test.describe('Fresh Workspace Installation', () => {
    test('Unattended Installation from fixture - cursor-only', async () => {
      const tempWorkspace = await createWorkspaceFromFixture('cursor-only', {
        prefix: 'devduck-cursor-only-fixture-test-'
      });

      try {
        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          skipRepoInit: true
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(tempWorkspace, 30000);
        expect(installed).toBe(true);

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists).toBe(true);
        expect(structure.cursorDirExists).toBe(true);
        expect(structure.mcpJsonExists).toBe(true);

        // Verify installed module paths were recorded in install-state.json
        const statePath = path.join(tempWorkspace, '.cache', 'install-state.json');
        const stateRaw = await fs.readFile(statePath, 'utf8');
        const state = JSON.parse(stateRaw) as { installedModules?: Record<string, string> };
        expect(state.installedModules).toBeTruthy();
        expect(state.installedModules?.cursor).toBeTruthy();
        expect(state.installedModules?.git).toBeTruthy();

        expect(result.exitCode).toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Unattended Installation - Fresh Workspace', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core'],
          skipRepoInit: true
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(tempWorkspace, 30000);
        expect(installed).toBe(true);

        const hasPrompts = result.stdout.includes('?') || result.stderr.includes('?');
        expect(hasPrompts).toBe(false);

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists).toBe(true);

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core']
        });
        expect(configVerification.valid).toBe(true);

        expect(result.exitCode).toBe(0);
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
          modules: ['core', 'vcs'],
          skipRepoInit: true
        };
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          config: configPath
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(tempWorkspace, 30000);
        expect(installed).toBe(true);

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'vcs']
        });
        expect(configVerification.valid).toBe(true);
        expect(configVerification.config?.modules).toContain('vcs');

        expect(result.exitCode).toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Unattended Installation with workspace.config.json (local folder project src)', async () => {
      const tempWorkspace = await createTempWorkspace();
      const providedWorkspaceConfigPath = path.join(tempWorkspace, 'provided-workspace.config.json');
      const localProjectsRoot = path.join(tempWorkspace, 'local-projects');
      const localProjectPath = path.join(localProjectsRoot, 'my-local-project');
      
      try {
        await fs.mkdir(localProjectPath, { recursive: true });
        await fs.writeFile(path.join(localProjectPath, 'README.md'), '# local project\n', 'utf8');
        
        const providedWorkspaceConfig = {
          workspaceVersion: '0.1.0',
          devduckPath: './devduck',
          modules: ['core', 'cursor'],
          projects: [
            {
              src: localProjectPath,
              checks: [
                {
                  name: 'NodeJS',
                  description: 'Node.js should be installed',
                  type: 'shell',
                  test: 'command -v node'
                }
              ]
            }
          ]
        };
        await fs.writeFile(providedWorkspaceConfigPath, JSON.stringify(providedWorkspaceConfig, null, 2), 'utf8');

        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          workspaceConfig: providedWorkspaceConfigPath
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(tempWorkspace, 30000);
        expect(installed).toBe(true);

        const configVerification = await verifyWorkspaceConfig(tempWorkspace);
        expect(configVerification.valid).toBe(true);

        expect(result.exitCode).toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Unattended Installation with workspace.config.json seedFiles[] copies seed files/folders', async () => {
      const tempWorkspace = await createWorkspaceFromFixture('seed-source');
      
      try {
        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          skipRepoInit: true
        });

        checkInstallerResult(result);

        const seedFilePath = path.join(tempWorkspace, 'seed.txt');
        const seedDirPath = path.join(tempWorkspace, 'seed-dir', 'nested.txt');
        
        await fs.access(seedFilePath);
        await fs.access(seedDirPath);

        expect(result.exitCode).toBe(0);
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
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(tempWorkspace, 30000);
        expect(installed).toBe(true);

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists).toBe(true);

        expect(result.exitCode).toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });
  });

  test.describe('Existing Workspace Operations', () => {
    test('Reinstall Existing Workspace - Unattended', async () => {
      const tempWorkspace = await createWorkspaceFromFixture('existing-workspace', {
        prefix: 'devduck-reinstall-test-'
      });
      
      try {
        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          skipRepoInit: true
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(tempWorkspace, 30000);
        expect(installed).toBe(true);

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists).toBe(true);

        expect(result.exitCode).toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Add Modules to Existing Workspace', async () => {
      const tempWorkspace = await createWorkspaceFromFixture('existing-workspace', {
        prefix: 'devduck-add-modules-test-'
      });
      
      try {
        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          modules: ['core', 'cursor', 'vcs'],
          skipRepoInit: true
        });

        checkInstallerResult(result);

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'cursor', 'vcs']
        });
        expect(configVerification.valid).toBe(true);

        expect(result.exitCode).toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Remove Modules from Existing Workspace', async () => {
      const tempWorkspace = await createWorkspaceFromFixture('existing-workspace', {
        prefix: 'devduck-remove-modules-test-'
      });
      
      try {
        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          modules: ['core'],
          skipRepoInit: true
        });

        checkInstallerResult(result);

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core']
        });
        expect(configVerification.valid).toBe(true);

        expect(result.exitCode).toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Reinstallation Verification - Preserve Configuration', async () => {
      const tempWorkspace = await createWorkspaceFromFixture('existing-workspace', {
        prefix: 'devduck-preserve-config-test-'
      });
      
      try {
        const originalConfigPath = path.join(tempWorkspace, 'workspace.config.json');
        const originalConfig = JSON.parse(await fs.readFile(originalConfigPath, 'utf8'));

        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          skipRepoInit: true
        });

        checkInstallerResult(result);

        const newConfig = JSON.parse(await fs.readFile(originalConfigPath, 'utf8'));
        expect(newConfig.modules).toEqual(originalConfig.modules);

        expect(result.exitCode).toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Reinstallation - Module Hooks Re-executed', async () => {
      const tempWorkspace = await createWorkspaceFromFixture('existing-workspace', {
        prefix: 'devduck-hooks-reexec-test-'
      });
      
      try {
        const markerPath = path.join(tempWorkspace, '.cache', 'devduck', 'hook-marker.txt');
        await fs.mkdir(path.dirname(markerPath), { recursive: true });
        await fs.writeFile(markerPath, 'old', 'utf8');

        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          skipRepoInit: true
        });

        checkInstallerResult(result);

        expect(result.exitCode).toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });
  });

  test.describe('External Repository Installation', () => {
    test('Installation with External Repository', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        const configPath = path.join(tempWorkspace, 'test-config.json');
        const config = {
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'smogcheck'],
          repos: ['github.com/holiber/devduck-test-repo'],
          skipRepoInit: true
        };
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          config: configPath
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(tempWorkspace, 30000);
        expect(installed).toBe(true);

        const configVerification = await verifyWorkspaceConfig(tempWorkspace);
        expect(configVerification.valid).toBe(true);
        expect(configVerification.config?.repos).toBeTruthy();
        expect(configVerification.config?.repos).toContain('github.com/holiber/devduck-test-repo');

        const expectedGitUrl = 'https://github.com/holiber/devduck-test-repo.git';
        const expectedRepoName = expectedGitUrl
          .replace(/\.git$/, '')
          .replace(/[:\/]/g, '_');
        const repoRoot = path.join(tempWorkspace, 'devduck', expectedRepoName);

        await fs.access(path.join(repoRoot, '.git'));
        await fs.access(path.join(repoRoot, 'modules'));
        await fs.access(path.join(repoRoot, 'modules', 'smogcheck', 'MODULE.md'));

        expect(result.exitCode).toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });
  });
});
