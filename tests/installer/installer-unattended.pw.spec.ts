/**
 * Playwright Test port of `installer-unattended.test.ts`
 *
 * NOTE:
 * - node:test continues to run `*.test.ts`
 * - Playwright runs `*.pw.spec.ts`
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
} from './helpers.ts';

test.describe('Workspace Installer - Unattended Mode', () => {
  test.describe.configure({ mode: 'serial' });

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

        const installed = await waitForInstallation(tempWorkspace, 30000);
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

        const installed = await waitForInstallation(tempWorkspace, 30000);
        expect(installed, 'Installation should complete').toBeTruthy();

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'vcs']
        });
        expect(configVerification.valid, 'Config should be valid').toBeTruthy();
        expect(
          (configVerification.config?.modules as string[] | undefined)?.includes('vcs') ?? false,
          'vcs module should be installed'
        ).toBeTruthy();

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
        await fs.writeFile(
          providedWorkspaceConfigPath,
          JSON.stringify(providedWorkspaceConfig, null, 2),
          'utf8'
        );

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
        expect(installed, 'Installation should complete').toBeTruthy();

        const output = result.stdout + result.stderr;
        expect(output.includes('Checking NodeJS'), 'Installer output should include NodeJS check').toBeTruthy();
        expect(
          output.includes('NodeJS (Node.js should be installed) - v') || output.includes('NodeJS - v'),
          'Installer output should include NodeJS version output'
        ).toBeTruthy();

        expect(output.includes('Checking HelloJS'), 'Installer output should include HelloJS check').toBeTruthy();
        expect(output.includes('Re-checking HelloJS'), 'Installer output should show HelloJS was installed and re-checked')
          .toBeTruthy();
        expect(
          output.includes('HelloJS (hello.js should exist and contain hello world) - hello world (installed)') ||
            output.includes('HelloJS - hello world'),
          'Installer output should include HelloJS output after installation'
        ).toBeTruthy();

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists, 'workspace.config.json should exist').toBeTruthy();

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

        const installed = await waitForInstallation(destWorkspace, 30000);
        expect(installed, 'Installation should complete').toBeTruthy();

        const seedContent = await fs.readFile(path.join(destWorkspace, 'seed.txt'), 'utf8');
        expect(seedContent, 'seed.txt should be copied into workspace root').toBe('seed file\n');

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

        const installed = await waitForInstallation(tempWorkspace, 30000);
        expect(installed, 'Installation should complete').toBeTruthy();

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        expect(structure.workspaceConfigExists, 'workspace.config.json should exist').toBeTruthy();
        expect(structure.cursorDirExists, '.cursor directory should exist').toBeTruthy();
        expect(structure.commandsDirExists, '.cursor/commands directory should exist').toBeTruthy();
        expect(structure.rulesDirExists, '.cursor/rules directory should exist').toBeTruthy();
        expect(structure.mcpJsonExists, '.cursor/mcp.json should exist').toBeTruthy();
        expect(structure.cacheDirExists, '.cache/devduck directory should exist').toBeTruthy();
        expect(structure.cursorignoreExists, '.cursorignore should exist').toBeTruthy();
        expect(structure.errors.length, `Structure verification failed: ${structure.errors.join(', ')}`).toBe(0);

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          modules: ['core', 'cursor', 'plan', 'vcs']
        });
        expect(configVerification.valid, 'workspace.config.json should be valid').toBeTruthy();
        expect(configVerification.config, 'Config should be loaded').toBeTruthy();

        const moduleVerification = await verifyModuleInstallation(tempWorkspace, ['core', 'cursor']);
        expect(moduleVerification.commandsFound > 0, 'Commands should be installed').toBeTruthy();
        expect(moduleVerification.rulesFound, 'Rules file should exist').toBeTruthy();

        expect(result.exitCode, 'Installer should exit with code 0').toBe(0);
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });
  });

  test.describe('Existing Workspace Operations', () => {
    let tempWorkspace: string | null = null;

    test.beforeAll(async () => {
      tempWorkspace = await createWorkspaceFromFixture('existing-workspace', {
        prefix: 'devduck-existing-workspace-test-'
      });
    });

    test.afterAll(async () => {
      if (tempWorkspace) await cleanupTempWorkspace(tempWorkspace);
    });

    test('Detect Existing Workspace', async () => {
      expect(tempWorkspace).toBeTruthy();
      const result = await runInstaller(tempWorkspace as string, {
        unattended: true
      });

      checkInstallerResult(result);

      const configPath = path.join(tempWorkspace as string, 'workspace.config.json');
      const configExists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false);
      expect(configExists, 'Existing workspace should be detected').toBeTruthy();
    });

    test('Reinstall Existing Workspace - Unattended', async () => {
      const ws = await createTempWorkspace();

      try {
        const initialResult = await runInstaller(ws, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);
        await waitForInstallation(ws, 30000);

        const initialConfig = await verifyWorkspaceConfig(ws);
        expect(initialConfig.valid, 'Initial config should be valid').toBeTruthy();

        const reinstallResult = await runInstaller(ws, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'vcs'],
          skipRepoInit: true
        });

        checkInstallerResult(reinstallResult);
        await waitForInstallation(ws, 30000);

        const afterReinstall = await verifyWorkspaceConfig(ws, {
          modules: ['core', 'cursor', 'vcs']
        });
        expect(afterReinstall.valid, 'Config after reinstall should be valid').toBeTruthy();
        expect(
          (afterReinstall.config?.modules as string[] | undefined)?.includes('vcs') ?? false,
          'vcs module should be added'
        ).toBeTruthy();

        const structure = await verifyWorkspaceStructure(ws);
        expect(structure.workspaceConfigExists, 'workspace.config.json should still exist').toBeTruthy();
        expect(structure.cursorDirExists, '.cursor directory should still exist').toBeTruthy();

        const moduleVerification = await verifyModuleInstallation(ws, ['core', 'cursor', 'vcs']);
        expect(moduleVerification.commandsFound > 0, 'Commands should be present').toBeTruthy();

        expect(reinstallResult.exitCode, 'Reinstall should exit with code 0').toBe(0);
      } finally {
        await cleanupTempWorkspace(ws);
      }
    });

    test('Add Modules to Existing Workspace', async () => {
      const ws = await createTempWorkspace();

      try {
        const initialResult = await runInstaller(ws, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);
        await waitForInstallation(ws, 30000);

        const initialConfig = await verifyWorkspaceConfig(ws, {
          modules: ['core', 'cursor']
        });
        expect(initialConfig.valid, 'Initial config should be valid').toBeTruthy();

        const addResult = await runInstaller(ws, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'dashboard'],
          skipRepoInit: true
        });

        checkInstallerResult(addResult);
        await waitForInstallation(ws, 30000);

        const afterAdd = await verifyWorkspaceConfig(ws);
        const modules = (afterAdd.config?.modules as string[] | undefined) ?? [];
        expect(modules.includes('dashboard'), 'dashboard module should be added').toBeTruthy();
        expect(modules.includes('core'), 'core module should still be present').toBeTruthy();
        expect(modules.includes('cursor'), 'cursor module should still be present').toBeTruthy();

        const moduleVerification = await verifyModuleInstallation(ws);
        expect(moduleVerification.commandsFound > 0, 'Commands should include dashboard commands').toBeTruthy();
      } finally {
        await cleanupTempWorkspace(ws);
      }
    });

    test('Remove Modules from Existing Workspace', async () => {
      const ws = await createTempWorkspace();

      try {
        const initialResult = await runInstaller(ws, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'dashboard', 'vcs'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);
        await waitForInstallation(ws, 30000);

        const initialConfig = await verifyWorkspaceConfig(ws);
        const initialModules = (initialConfig.config?.modules as string[] | undefined) ?? [];
        expect(initialModules.includes('dashboard'), 'dashboard should be initially installed').toBeTruthy();

        const removeResult = await runInstaller(ws, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'vcs'],
          skipRepoInit: true
        });

        checkInstallerResult(removeResult);
        await waitForInstallation(ws, 30000);

        const afterRemove = await verifyWorkspaceConfig(ws);
        const modules = (afterRemove.config?.modules as string[] | undefined) ?? [];
        expect(modules.includes('dashboard'), 'dashboard module should be removed').toBeFalsy();
        expect(modules.includes('core'), 'core module should still be present').toBeTruthy();
        expect(modules.includes('cursor'), 'cursor module should still be present').toBeTruthy();
        expect(modules.includes('vcs'), 'vcs module should still be present').toBeTruthy();
      } finally {
        await cleanupTempWorkspace(ws);
      }
    });

    test('Reinstallation Verification - Preserve Configuration', async () => {
      const ws = await createTempWorkspace();

      try {
        const initialResult = await runInstaller(ws, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'plan'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);
        await waitForInstallation(ws, 30000);

        const configPath = path.join(ws, 'workspace.config.json');
        const initialConfigContent = await fs.readFile(configPath, 'utf8');
        const initialConfig = JSON.parse(initialConfigContent) as Record<string, unknown>;

        (initialConfig as any).moduleSettings = {
          core: {
            testSetting: 'testValue'
          }
        };
        await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2), 'utf8');

        const reinstallResult = await runInstaller(ws, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'plan'],
          skipRepoInit: true
        });

        checkInstallerResult(reinstallResult);
        await waitForInstallation(ws, 30000);

        const afterReinstall = await verifyWorkspaceConfig(ws);
        const cfg = afterReinstall.config as any;
        expect(cfg?.moduleSettings, 'moduleSettings should be preserved').toBeTruthy();
        expect(cfg?.moduleSettings?.core, 'core module settings should be preserved').toBeTruthy();
        expect(cfg?.moduleSettings?.core?.testSetting, 'Custom setting should be preserved').toBe('testValue');

        const modules = (cfg?.modules as string[] | undefined) ?? [];
        expect(modules.includes('core'), 'core should still be installed').toBeTruthy();
        expect(modules.includes('cursor'), 'cursor should still be installed').toBeTruthy();
        expect(modules.includes('plan'), 'plan should still be installed').toBeTruthy();
      } finally {
        await cleanupTempWorkspace(ws);
      }
    });

    test('Reinstallation - Module Hooks Re-executed', async () => {
      const ws = await createTempWorkspace();

      try {
        const initialResult = await runInstaller(ws, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);
        await waitForInstallation(ws, 30000);

        const cursorignorePath = path.join(ws, '.cursorignore');
        const initialCursorignore = await fs.readFile(cursorignorePath, 'utf8');
        expect(initialCursorignore.length > 0, '.cursorignore should exist after initial installation').toBeTruthy();

        await fs.writeFile(cursorignorePath, '# Modified content', 'utf8');

        const reinstallResult = await runInstaller(ws, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor'],
          skipRepoInit: true
        });

        checkInstallerResult(reinstallResult);
        await waitForInstallation(ws, 30000);

        const afterReinstall = await fs.readFile(cursorignorePath, 'utf8');
        expect(afterReinstall, '.cursorignore should be regenerated by hooks').not.toBe('# Modified content');
        expect(afterReinstall.includes('.env'), '.cursorignore should contain default content').toBeTruthy();
      } finally {
        await cleanupTempWorkspace(ws);
      }
    });
  });

  test.describe('External Repository Installation', () => {
    test('Installation with External Repository', async () => {
      const ws = await createTempWorkspace();

      try {
        const configPath = path.join(ws, 'test-config.json');
        const config = {
          aiAgent: 'cursor',
          repoType: 'none',
          modules: ['core', 'cursor', 'smogcheck'],
          repos: ['github.com/holiber/devduck-test-repo'],
          skipRepoInit: true
        };
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

        const result = await runInstaller(ws, {
          unattended: true,
          config: configPath
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(ws, 30000);
        expect(installed, 'Installation should complete').toBeTruthy();

        const configVerification = await verifyWorkspaceConfig(ws);
        expect(configVerification.valid, 'Config should be valid').toBeTruthy();
        const repos = (configVerification.config as any)?.repos as string[] | undefined;
        expect(Array.isArray(repos), 'Config should have repos field').toBeTruthy();
        expect(
          repos?.includes('github.com/holiber/devduck-test-repo') ?? false,
          'Config should include devduck-test-repo in repos'
        ).toBeTruthy();

        const expectedGitUrl = 'https://github.com/holiber/devduck-test-repo.git';
        const expectedRepoName = expectedGitUrl.replace(/\.git$/, '').replace(/[:\\/]/g, '_');
        const repoRoot = path.join(ws, 'devduck', expectedRepoName);

        await fs.access(path.join(repoRoot, '.git'));
        await fs.access(path.join(repoRoot, 'modules'));
        await fs.access(path.join(repoRoot, 'modules', 'smogcheck', 'MODULE.md'));

        const statePath = path.join(ws, '.cache', 'install-state.json');
        const stateRaw = await fs.readFile(statePath, 'utf8');
        const state = JSON.parse(stateRaw) as { installedModules?: Record<string, string> };
        expect(state.installedModules, 'install-state.json should include installedModules').toBeTruthy();
        expect(
          typeof state.installedModules?.smogcheck === 'string' &&
            state.installedModules.smogcheck.endsWith(path.join('modules', 'smogcheck')),
          'install-state.json should include smogcheck module path'
        ).toBeTruthy();

        const smogcheckedPath = path.join(ws, 'smogchecked.txt');
        await fs.access(smogcheckedPath);
        const smogcheckedContent = await fs.readFile(smogcheckedPath, 'utf8');
        expect(smogcheckedContent.includes('smogcheck'), 'smogchecked.txt should contain smogcheck').toBeTruthy();

        const commandsDir = path.join(ws, '.cursor', 'commands');
        const commandsFiles = await fs.readdir(commandsDir);
        expect(commandsFiles.includes('smogcheck.md'), 'smogcheck.md command should be copied to .cursor/commands/')
          .toBeTruthy();

        const rulesPath = path.join(ws, '.cursor', 'rules', 'devduck-rules.md');
        const rulesContent = await fs.readFile(rulesPath, 'utf8');
        expect(rulesContent.includes('smogcheck'), 'devduck-rules.md should contain smogcheck rules').toBeTruthy();

        expect(result.exitCode, 'Installer should exit with code 0').toBe(0);
      } finally {
        await cleanupTempWorkspace(ws);
      }
    });
  });
});

