#!/usr/bin/env node

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
        expect(installed).toBeTruthy();

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists).toBeTruthy();
        expect(structure.cursorDirExists).toBeTruthy();
        expect(structure.mcpJsonExists).toBeTruthy();

        // Verify installed module paths were recorded in install-state.json and include cursor (+ always-included git).
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
        expect(installed).toBeTruthy();

        const hasPrompts = result.stdout.includes('?') || result.stderr.includes('?');
        expect(hasPrompts).toBeFalsy();

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists).toBeTruthy();
        // Fresh/core-only install should not require Cursor integration artifacts.

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core']
        });
        expect(configVerification.valid).toBeTruthy();

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
        expect(installed).toBeTruthy();

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'vcs']
        });
        expect(configVerification.valid).toBeTruthy();
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
                  test: 'node --version'
                },
                {
                  name: 'HelloJS',
                  description: 'hello.js should exist and contain hello world',
                  test: 'node hello.js',
                  install: "printf \"console.log('hello world')\\n\" > hello.js"
                }
              ]
            }
          ]
        };
        await fs.writeFile(providedWorkspaceConfigPath, JSON.stringify(providedWorkspaceConfig, null, 2), 'utf8');

        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true,
          workspaceConfig: providedWorkspaceConfigPath
        });
        
        checkInstallerResult(result);
        
        const installed = await waitForInstallation(tempWorkspace, 30000);
        expect(installed).toBeTruthy();

        // Ensure project check ran and succeeded.
        // Check both stdout and stderr as output may go to either.
        // Note: installer may include project context like "Checking NodeJS [my-local-project]...".
        const output = result.stdout + result.stderr;
        expect(output).toContain('Checking NodeJS');
        expect(
          output.includes('NodeJS (Node.js should be installed) - v') || output.includes('NodeJS - v')
        ).toBeTruthy();

        // Ensure hello.js check ran, got installed, and succeeded
        expect(output).toContain('Checking HelloJS');
        expect(output).toContain('Re-checking HelloJS');
        expect(
          output.includes('HelloJS (hello.js should exist and contain hello world) - hello world (installed)') || output.includes('HelloJS - hello world')
        ).toBeTruthy();

        // Ensure workspace.config.json exists (created from provided config)
        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists).toBeTruthy();

        // Verify symlink was created in projects/
        const symlinkPath = path.join(tempWorkspace, 'projects', 'my-local-project');
        const st = await fs.lstat(symlinkPath);
        expect(st.isSymbolicLink()).toBeTruthy();
        const linkTarget = await fs.readlink(symlinkPath);
        const resolvedTarget = path.resolve(path.dirname(symlinkPath), linkTarget);
        expect(resolvedTarget).toBe(path.resolve(localProjectPath));
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Unattended Installation with workspace.config.json seedFiles[] copies seed files/folders', async () => {
      const sourceWorkspace = await createWorkspaceFromFixture('seed-source', {
        prefix: 'devduck-seed-source-test-'
      });
      const destWorkspace = await createWorkspaceFromFixture('empty', {
        prefix: 'devduck-seed-dest-test-'
      });
      const providedWorkspaceConfigPath = path.join(sourceWorkspace, 'workspace.config.json');

      try {
        const result = await runInstaller(destWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true,
          workspaceConfig: providedWorkspaceConfigPath
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(destWorkspace, 30000);
        expect(installed).toBeTruthy();

        // Verify seed file copied
        const seedContent = await fs.readFile(path.join(destWorkspace, 'seed.txt'), 'utf8');
        expect(seedContent).toBe('seed file\n');

        // Verify seed directory copied recursively
        const nestedContent = await fs.readFile(path.join(destWorkspace, 'seed-dir', 'nested.txt'), 'utf8');
        expect(nestedContent).toBe('nested\n');
      } finally {
        await cleanupTempWorkspace(sourceWorkspace);
        await cleanupTempWorkspace(destWorkspace);
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

        checkInstallerResult(result);

        const installed = await waitForInstallation(tempWorkspace, 30000);
        expect(installed).toBeTruthy();

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists).toBeTruthy();
        expect(structure.cursorDirExists).toBeTruthy();
        expect(structure.commandsDirExists).toBeTruthy();
        expect(structure.rulesDirExists).toBeTruthy();
        expect(structure.mcpJsonExists).toBeTruthy();
        expect(structure.cacheDirExists).toBeTruthy();
        expect(structure.cursorignoreExists).toBeTruthy();

        if (structure.errors.length > 0) {
          throw new Error(`Structure verification failed: ${structure.errors.join(', ')}`);
        }

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'cursor', 'plan', 'vcs']
        });
        expect(configVerification.valid).toBeTruthy();
        expect(configVerification.config).toBeTruthy();

        const moduleVerification = await verifyModuleInstallation(tempWorkspace, ['core', 'cursor']);
        expect(moduleVerification.commandsFound).toBeGreaterThan(0);
        expect(moduleVerification.rulesFound).toBeTruthy();

        expect(result.exitCode).toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });
  });

  test.describe('Existing Workspace Operations', () => {
    test('Reinstall Existing Workspace - Unattended', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        const initialResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);

        await waitForInstallation(tempWorkspace, 30000);

        const initialConfig = await verifyWorkspaceConfig(tempWorkspace);
        expect(initialConfig.valid).toBeTruthy();

        const reinstallResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'vcs'],
          skipRepoInit: true
        });

        checkInstallerResult(reinstallResult);

        await waitForInstallation(tempWorkspace, 30000);

        const afterReinstall = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'cursor', 'vcs']
        });
        expect(afterReinstall.valid).toBeTruthy();
        expect(afterReinstall.config?.modules).toContain('vcs');

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists).toBeTruthy();
        expect(structure.cursorDirExists).toBeTruthy();

        const moduleVerification = await verifyModuleInstallation(tempWorkspace, ['core', 'cursor', 'vcs']);
        expect(moduleVerification.commandsFound).toBeGreaterThan(0);

        expect(reinstallResult.exitCode).toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Add Modules to Existing Workspace', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        const initialResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);

        await waitForInstallation(tempWorkspace, 30000);

        const initialConfig = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'cursor']
        });
        expect(initialConfig.valid).toBeTruthy();

        const addResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'dashboard'],
          skipRepoInit: true
        });

        checkInstallerResult(addResult);

        await waitForInstallation(tempWorkspace, 30000);

        const afterAdd = await verifyWorkspaceConfig(tempWorkspace);
        expect(afterAdd.config?.modules).toContain('dashboard');
        expect(afterAdd.config?.modules).toContain('core');
        expect(afterAdd.config?.modules).toContain('cursor');

        const moduleVerification = await verifyModuleInstallation(tempWorkspace);
        expect(moduleVerification.commandsFound).toBeGreaterThan(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Remove Modules from Existing Workspace', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        const initialResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'dashboard', 'vcs'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);

        await waitForInstallation(tempWorkspace, 30000);

        const initialConfig = await verifyWorkspaceConfig(tempWorkspace);
        expect(initialConfig.config?.modules).toContain('dashboard');

        const removeResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'vcs'],
          skipRepoInit: true
        });

        checkInstallerResult(removeResult);

        await waitForInstallation(tempWorkspace, 30000);

        const afterRemove = await verifyWorkspaceConfig(tempWorkspace);
        expect(afterRemove.config?.modules).not.toContain('dashboard');
        expect(afterRemove.config?.modules).toContain('core');
        expect(afterRemove.config?.modules).toContain('cursor');
        expect(afterRemove.config?.modules).toContain('vcs');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Reinstallation Verification - Preserve Configuration', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        const initialResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'plan'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);

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

        const reinstallResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'plan'],
          skipRepoInit: true
        });

        checkInstallerResult(reinstallResult);

        await waitForInstallation(tempWorkspace, 30000);

        const afterReinstall = await verifyWorkspaceConfig(tempWorkspace);
        expect(afterReinstall.config?.moduleSettings).toBeTruthy();
        expect(afterReinstall.config?.moduleSettings?.core).toBeTruthy();
        expect(afterReinstall.config?.moduleSettings?.core?.testSetting).toBe('testValue');

        expect(afterReinstall.config?.modules).toContain('core');
        expect(afterReinstall.config?.modules).toContain('cursor');
        expect(afterReinstall.config?.modules).toContain('plan');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Reinstallation - Module Hooks Re-executed', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        const initialResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);

        await waitForInstallation(tempWorkspace, 30000);

        const cursorignorePath = path.join(tempWorkspace, '.cursorignore');
        let initialCursorignore = '';
        try {
          initialCursorignore = await fs.readFile(cursorignorePath, 'utf8');
        } catch (e) {
          throw new Error('.cursorignore should exist after initial installation');
        }

        await fs.writeFile(cursorignorePath, '# Modified content', 'utf8');

        const reinstallResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        checkInstallerResult(reinstallResult);

        await waitForInstallation(tempWorkspace, 30000);

        const afterReinstall = await fs.readFile(cursorignorePath, 'utf8');
        expect(afterReinstall).not.toBe('# Modified content');
        expect(afterReinstall).toContain('.env');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });
  });

  test.describe('External Repository Installation', () => {
    test('Installation with External Repository', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        // Create config with external repository
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
        expect(installed).toBeTruthy();

        // Verify workspace.config.json includes the repo
        const configVerification = await verifyWorkspaceConfig(tempWorkspace);
        expect(configVerification.valid).toBeTruthy();
        expect(configVerification.config?.repos).toBeTruthy();
        expect(configVerification.config?.repos).toContain('github.com/holiber/devduck-test-repo');

        // Repos from workspace.config.json should be cloned under <workspace>/devduck/
        // (not hidden under .cache/), so users can inspect/edit them easily.
        const expectedGitUrl = 'https://github.com/holiber/devduck-test-repo.git';
        const expectedRepoName = expectedGitUrl
          .replace(/\.git$/, '')
          .replace(/[:\/]/g, '_');
        const repoRoot = path.join(tempWorkspace, 'devduck', expectedRepoName);

        // Ensure the repo clone exists and contains the expected module.
        await fs.access(path.join(repoRoot, '.git'));
        await fs.access(path.join(repoRoot, 'modules'));
        await fs.access(path.join(repoRoot, 'modules', 'smogcheck', 'MODULE.md'));

        // Verify installer recorded installed module paths in .cache/install-state.json
        const statePath = path.join(tempWorkspace, '.cache', 'install-state.json');
        const stateRaw = await fs.readFile(statePath, 'utf8');
        const state = JSON.parse(stateRaw) as { installedModules?: Record<string, string> };
        expect(state.installedModules).toBeTruthy();
        expect(
          typeof state.installedModules?.smogcheck === 'string' &&
            state.installedModules.smogcheck.endsWith(path.join('modules', 'smogcheck'))
        ).toBeTruthy();

        // Verify smogchecked.txt file exists (created by smogcheck module hook)
        const smogcheckedPath = path.join(tempWorkspace, 'smogchecked.txt');
        try {
          await fs.access(smogcheckedPath);
          const smogcheckedContent = await fs.readFile(smogcheckedPath, 'utf8');
          expect(smogcheckedContent).toContain('smogcheck');
        } catch (e) {
          throw new Error('smogchecked.txt file should exist in workspace root');
        }

        // Verify smogcheck command is copied to .cursor/commands/
        const commandsDir = path.join(tempWorkspace, '.cursor', 'commands');
        const commandsFiles = await fs.readdir(commandsDir);
        expect(commandsFiles).toContain('smogcheck.md');

        // Verify smogcheck rules are merged into .cursor/rules/
        const rulesPath = path.join(tempWorkspace, '.cursor', 'rules', 'devduck-rules.md');
        try {
          const rulesContent = await fs.readFile(rulesPath, 'utf8');
          expect(rulesContent).toContain('smogcheck');
        } catch (e) {
          throw new Error('devduck-rules.md should exist and contain smogcheck rules');
        }

        expect(result.exitCode).toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });
  });
});
