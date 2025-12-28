import { test, expect } from '@playwright/test';
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

        const installed = await waitForInstallation(tempWorkspace, 30_000);
        expect(installed, 'Installation should complete').toBeTruthy();

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists, 'workspace.config.json should exist').toBeTruthy();
        expect(structure.cursorDirExists, '.cursor directory should exist').toBeTruthy();
        expect(structure.mcpJsonExists, '.cursor/mcp.json should exist').toBeTruthy();

        // Verify installed module paths were recorded in install-state.json and include cursor (+ always-included git).
        const statePath = path.join(tempWorkspace, '.cache', 'install-state.json');
        const stateRaw = await fs.readFile(statePath, 'utf8');
        const state = JSON.parse(stateRaw) as { installedModules?: Record<string, string> };
        expect(state.installedModules, 'install-state.json should include installedModules').toBeTruthy();
        expect(state.installedModules?.cursor, 'cursor should be installed').toBeTruthy();
        expect(state.installedModules?.git, 'git should be installed (always included)').toBeTruthy();

        expect(result.exitCode, 'Installer should exit with code 0').toBe(0);
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

        const installed = await waitForInstallation(tempWorkspace, 30_000);
        expect(installed, 'Installation should complete').toBeTruthy();

        const hasPrompts = result.stdout.includes('?') || result.stderr.includes('?');
        expect(hasPrompts, 'Unattended mode should not show prompts').toBeFalsy();

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists, 'workspace.config.json should exist').toBeTruthy();
        // Fresh/core-only install should not require Cursor integration artifacts.

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core']
        });
        expect(configVerification.valid, 'Config should be valid').toBeTruthy();

        expect(result.exitCode, 'Installer should exit with code 0').toBe(0);
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

        const installed = await waitForInstallation(tempWorkspace, 30_000);
        expect(installed, 'Installation should complete').toBeTruthy();

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'vcs']
        });
        expect(configVerification.valid, 'Config should be valid').toBeTruthy();
        expect(configVerification.config.modules.includes('vcs'), 'vcs module should be installed').toBeTruthy();

        expect(result.exitCode, 'Installer should exit with code 0').toBe(0);
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

        const installed = await waitForInstallation(tempWorkspace, 30_000);
        expect(installed, 'Installation should complete').toBeTruthy();

        // Ensure project check ran and succeeded.
        const output = result.stdout + result.stderr;
        expect(output.includes('Checking NodeJS'), 'Installer output should include NodeJS check').toBeTruthy();
        expect(
          output.includes('NodeJS (Node.js should be installed) - v') || output.includes('NodeJS - v'),
          'Installer output should include NodeJS version output'
        ).toBeTruthy();

        // Ensure hello.js check ran, got installed, and succeeded
        expect(output.includes('Checking HelloJS'), 'Installer output should include HelloJS check').toBeTruthy();
        expect(output.includes('Re-checking HelloJS'), 'Installer output should show HelloJS was installed and re-checked').toBeTruthy();
        expect(
          output.includes('HelloJS (hello.js should exist and contain hello world) - hello world (installed)') ||
            output.includes('HelloJS - hello world'),
          'Installer output should include HelloJS output after installation'
        ).toBeTruthy();

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists, 'workspace.config.json should exist').toBeTruthy();

        // Verify symlink was created in projects/
        const symlinkPath = path.join(tempWorkspace, 'projects', 'my-local-project');
        const st = await fs.lstat(symlinkPath);
        expect(st.isSymbolicLink(), 'projects/my-local-project should be a symlink').toBeTruthy();
        const linkTarget = await fs.readlink(symlinkPath);
        const resolvedTarget = path.resolve(path.dirname(symlinkPath), linkTarget);
        expect(resolvedTarget, 'symlink should point to the local project folder').toBe(path.resolve(localProjectPath));
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

        const installed = await waitForInstallation(destWorkspace, 30_000);
        expect(installed, 'Installation should complete').toBeTruthy();

        // Verify seed file copied
        const seedContent = await fs.readFile(path.join(destWorkspace, 'seed.txt'), 'utf8');
        expect(seedContent, 'seed.txt should be copied into workspace root').toBe('seed file\n');

        // Verify seed directory copied recursively
        const nestedContent = await fs.readFile(path.join(destWorkspace, 'seed-dir', 'nested.txt'), 'utf8');
        expect(nestedContent, 'seed-dir should be copied into workspace root').toBe('nested\n');
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

        const installed = await waitForInstallation(tempWorkspace, 30_000);
        expect(installed, 'Installation should complete').toBeTruthy();

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists, 'workspace.config.json should exist').toBeTruthy();
        expect(structure.cursorDirExists, '.cursor directory should exist').toBeTruthy();
        expect(structure.commandsDirExists, '.cursor/commands directory should exist').toBeTruthy();
        expect(structure.rulesDirExists, '.cursor/rules directory should exist').toBeTruthy();
        expect(structure.mcpJsonExists, '.cursor/mcp.json should exist').toBeTruthy();
        expect(structure.cacheDirExists, '.cache/devduck directory should exist').toBeTruthy();
        expect(structure.cursorignoreExists, '.cursorignore should exist').toBeTruthy();

        if (structure.errors.length > 0) {
          throw new Error(`Structure verification failed: ${structure.errors.join(', ')}`);
        }

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'cursor', 'plan', 'vcs']
        });
        expect(configVerification.valid, 'workspace.config.json should be valid').toBeTruthy();
        expect(configVerification.config, 'Config should be loaded').toBeTruthy();

        const moduleVerification = await verifyModuleInstallation(tempWorkspace, ['core', 'cursor']);
        expect(moduleVerification.commandsFound, 'Commands should be installed').toBeGreaterThan(0);
        expect(moduleVerification.rulesFound, 'Rules file should exist').toBeTruthy();

        expect(result.exitCode, 'Installer should exit with code 0').toBe(0);
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

        await waitForInstallation(tempWorkspace, 30_000);

        const initialConfig = await verifyWorkspaceConfig(tempWorkspace);
        expect(initialConfig.valid, 'Initial config should be valid').toBeTruthy();

        const reinstallResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'vcs'],
          skipRepoInit: true
        });

        checkInstallerResult(reinstallResult);

        await waitForInstallation(tempWorkspace, 30_000);

        const afterReinstall = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'cursor', 'vcs']
        });
        expect(afterReinstall.valid, 'Config after reinstall should be valid').toBeTruthy();
        expect(afterReinstall.config.modules.includes('vcs'), 'vcs module should be added').toBeTruthy();

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists, 'workspace.config.json should still exist').toBeTruthy();
        expect(structure.cursorDirExists, '.cursor directory should still exist').toBeTruthy();

        const moduleVerification = await verifyModuleInstallation(tempWorkspace, ['core', 'cursor', 'vcs']);
        expect(moduleVerification.commandsFound, 'Commands should be present').toBeGreaterThan(0);

        expect(reinstallResult.exitCode, 'Reinstall should exit with code 0').toBe(0);
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

        await waitForInstallation(tempWorkspace, 30_000);

        const initialConfig = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'cursor']
        });
        expect(initialConfig.valid, 'Initial config should be valid').toBeTruthy();

        const addResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'dashboard'],
          skipRepoInit: true
        });

        checkInstallerResult(addResult);

        await waitForInstallation(tempWorkspace, 30_000);

        const afterAdd = await verifyWorkspaceConfig(tempWorkspace);
        expect(afterAdd.config.modules.includes('dashboard'), 'dashboard module should be added').toBeTruthy();
        expect(afterAdd.config.modules.includes('core'), 'core module should still be present').toBeTruthy();
        expect(afterAdd.config.modules.includes('cursor'), 'cursor module should still be present').toBeTruthy();

        const moduleVerification = await verifyModuleInstallation(tempWorkspace);
        expect(moduleVerification.commandsFound, 'Commands should include dashboard commands').toBeGreaterThan(0);
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

        await waitForInstallation(tempWorkspace, 30_000);

        const initialConfig = await verifyWorkspaceConfig(tempWorkspace);
        expect(initialConfig.config.modules.includes('dashboard'), 'dashboard should be initially installed').toBeTruthy();

        const removeResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'vcs'],
          skipRepoInit: true
        });

        checkInstallerResult(removeResult);

        await waitForInstallation(tempWorkspace, 30_000);

        const afterRemove = await verifyWorkspaceConfig(tempWorkspace);
        expect(afterRemove.config.modules.includes('dashboard'), 'dashboard module should be removed').toBeFalsy();
        expect(afterRemove.config.modules.includes('core'), 'core module should still be present').toBeTruthy();
        expect(afterRemove.config.modules.includes('cursor'), 'cursor module should still be present').toBeTruthy();
        expect(afterRemove.config.modules.includes('vcs'), 'vcs module should still be present').toBeTruthy();
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

        await waitForInstallation(tempWorkspace, 30_000);

        const configPath = path.join(tempWorkspace, 'workspace.config.json');
        const initialConfigContent = await fs.readFile(configPath, 'utf8');
        const initialConfig = JSON.parse(initialConfigContent) as any;

        initialConfig.moduleSettings = { core: { testSetting: 'testValue' } };
        await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2), 'utf8');

        const reinstallResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'plan'],
          skipRepoInit: true
        });

        checkInstallerResult(reinstallResult);

        await waitForInstallation(tempWorkspace, 30_000);

        const afterReinstall = await verifyWorkspaceConfig(tempWorkspace);
        expect(afterReinstall.config.moduleSettings, 'moduleSettings should be preserved').toBeTruthy();
        expect(afterReinstall.config.moduleSettings.core, 'core module settings should be preserved').toBeTruthy();
        expect(afterReinstall.config.moduleSettings.core.testSetting, 'Custom setting should be preserved').toBe('testValue');
        expect(afterReinstall.config.modules.includes('core'), 'core should still be installed').toBeTruthy();
        expect(afterReinstall.config.modules.includes('cursor'), 'cursor should still be installed').toBeTruthy();
        expect(afterReinstall.config.modules.includes('plan'), 'plan should still be installed').toBeTruthy();
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

        await waitForInstallation(tempWorkspace, 30_000);

        const cursorignorePath = path.join(tempWorkspace, '.cursorignore');
        let initialCursorignore = '';
        try {
          initialCursorignore = await fs.readFile(cursorignorePath, 'utf8');
        } catch {
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

        await waitForInstallation(tempWorkspace, 30_000);

        const afterReinstall = await fs.readFile(cursorignorePath, 'utf8');
        expect(afterReinstall).not.toBe('# Modified content');
        expect(afterReinstall.includes('.env'), '.cursorignore should contain default content').toBeTruthy();
        expect(initialCursorignore.length >= 0).toBeTruthy();
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

        const installed = await waitForInstallation(tempWorkspace, 30_000);
        expect(installed, 'Installation should complete').toBeTruthy();

        const configVerification = await verifyWorkspaceConfig(tempWorkspace);
        expect(configVerification.valid, 'Config should be valid').toBeTruthy();
        expect(configVerification.config.repos, 'Config should have repos field').toBeTruthy();
        expect(
          configVerification.config.repos.includes('github.com/holiber/devduck-test-repo'),
          'Config should include devduck-test-repo in repos'
        ).toBeTruthy();

        // Repos from workspace.config.json should be cloned under <workspace>/devduck/
        const expectedGitUrl = 'https://github.com/holiber/devduck-test-repo.git';
        const expectedRepoName = expectedGitUrl.replace(/\.git$/, '').replace(/[:\/]/g, '_');
        const repoRoot = path.join(tempWorkspace, 'devduck', expectedRepoName);

        await fs.access(path.join(repoRoot, '.git'));
        await fs.access(path.join(repoRoot, 'modules'));
        await fs.access(path.join(repoRoot, 'modules', 'smogcheck', 'MODULE.md'));

        const statePath = path.join(tempWorkspace, '.cache', 'install-state.json');
        const stateRaw = await fs.readFile(statePath, 'utf8');
        const state = JSON.parse(stateRaw) as { installedModules?: Record<string, string> };
        expect(state.installedModules, 'install-state.json should include installedModules').toBeTruthy();
        expect(
          typeof state.installedModules?.smogcheck === 'string' &&
            state.installedModules.smogcheck.endsWith(path.join('modules', 'smogcheck')),
          'install-state.json should include smogcheck module path'
        ).toBeTruthy();

        const smogcheckedPath = path.join(tempWorkspace, 'smogchecked.txt');
        try {
          await fs.access(smogcheckedPath);
          const smogcheckedContent = await fs.readFile(smogcheckedPath, 'utf8');
          expect(smogcheckedContent.includes('smogcheck'), 'smogchecked.txt should contain smogcheck').toBeTruthy();
        } catch {
          throw new Error('smogchecked.txt file should exist in workspace root');
        }

        const commandsDir = path.join(tempWorkspace, '.cursor', 'commands');
        const commandsFiles = await fs.readdir(commandsDir);
        expect(commandsFiles.includes('smogcheck.md'), 'smogcheck.md command should be copied to .cursor/commands/').toBeTruthy();

        const rulesPath = path.join(tempWorkspace, '.cursor', 'rules', 'devduck-rules.md');
        try {
          const rulesContent = await fs.readFile(rulesPath, 'utf8');
          expect(rulesContent.includes('smogcheck'), 'devduck-rules.md should contain smogcheck rules').toBeTruthy();
        } catch {
          throw new Error('devduck-rules.md should exist and contain smogcheck rules');
        }

        expect(result.exitCode, 'Installer should exit with code 0').toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });
  });
});

