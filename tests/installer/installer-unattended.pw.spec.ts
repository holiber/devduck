/**
 * Tests for workspace installer in unattended mode
 */

import { test } from '@playwright/test';
import assert from 'node:assert';
import YAML from 'yaml';
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

const { describe, beforeAll: before, afterAll: after } = test;

describe('Workspace Installer - Unattended Mode', () => {
  describe('Fresh Workspace Installation', () => {
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
        assert.ok(installed, 'Installation should complete');

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        assert.ok(structure.workspaceConfigExists, 'workspace.config.yml should exist');
        assert.ok(structure.cursorDirExists, '.cursor directory should exist');
        assert.ok(structure.mcpJsonExists, '.cursor/mcp.json should exist');

        // Verify installed module paths were recorded in install-state.json and include cursor (+ always-included git).
        const statePath = path.join(tempWorkspace, '.cache', 'install-state.json');
        const stateRaw = await fs.readFile(statePath, 'utf8');
        const state = JSON.parse(stateRaw) as { installedModules?: Record<string, string> };
        assert.ok(state.installedModules, 'install-state.json should include installedModules');
        assert.ok(state.installedModules.cursor, 'cursor should be installed');
        assert.ok(state.installedModules.git, 'git should be installed (always included)');

        assert.strictEqual(result.exitCode, 0, 'Installer should exit with code 0');
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
          extensions: ['core'],
          skipRepoInit: true
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(tempWorkspace, 30000);
        assert.ok(installed, 'Installation should complete');

        const hasPrompts = result.stdout.includes('?') || result.stderr.includes('?');
        assert.ok(!hasPrompts, 'Unattended mode should not show prompts');

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        assert.ok(structure.workspaceConfigExists, 'workspace.config.yml should exist');
        // Fresh/core-only install should not require Cursor integration artifacts.

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          extensions: ['core']
        });
        assert.ok(configVerification.valid, 'Config should be valid');

        assert.strictEqual(result.exitCode, 0, 'Installer should exit with code 0');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Unattended Installation with Config File', async () => {
      const tempWorkspace = await createTempWorkspace();
      const configPath = path.join(tempWorkspace, 'test-config.yml');
      
      try {
        const config = {
          aiAgent: 'cursor',
          repoType: 'none',
          extensions: ['core', 'vcs'],
          skipRepoInit: true
        };
        await fs.writeFile(configPath, YAML.stringify(config), 'utf8');

        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          config: configPath
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(tempWorkspace, 30000);
        assert.ok(installed, 'Installation should complete');

        const configVerification = await verifyWorkspaceConfig(tempWorkspace, {
          extensions: ['core', 'vcs']
        });
        assert.ok(configVerification.valid, 'Config should be valid');
        assert.ok((configVerification.config.extensions as string[]).includes('vcs'), 'vcs extension should be installed');

        assert.strictEqual(result.exitCode, 0, 'Installer should exit with code 0');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Unattended Installation with workspace config template (local folder project src)', async () => {
      const tempWorkspace = await createTempWorkspace();
      const providedWorkspaceConfigPath = path.join(tempWorkspace, 'provided-workspace.config.yml');
      const localProjectsRoot = path.join(tempWorkspace, 'local-projects');
      const localProjectPath = path.join(localProjectsRoot, 'my-local-project');
      
      try {
        await fs.mkdir(localProjectPath, { recursive: true });
        await fs.writeFile(path.join(localProjectPath, 'README.md'), '# local project\n', 'utf8');
        
        const providedWorkspaceConfig = {
          version: '0.1.0',
          devduck_path: './devduck',
          extensions: ['core', 'cursor'],
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
        await fs.writeFile(providedWorkspaceConfigPath, YAML.stringify(providedWorkspaceConfig), 'utf8');

        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          extensions: ['core', 'cursor'],
          skipRepoInit: true,
          workspaceConfig: providedWorkspaceConfigPath
        });
        
        checkInstallerResult(result);
        
        const installed = await waitForInstallation(tempWorkspace, 30000);
        assert.ok(installed, 'Installation should complete');

        // Ensure project check ran and succeeded.
        // Check both stdout and stderr as output may go to either.
        // Note: installer may include project context like "Checking NodeJS [my-local-project]...".
        const output = result.stdout + result.stderr;
        assert.ok(
          output.includes('Checking NodeJS'),
          'Installer output should include NodeJS check'
        );
        assert.ok(
          output.includes('NodeJS (Node.js should be installed) - v') || output.includes('NodeJS - v'),
          'Installer output should include NodeJS version output'
        );

        // Ensure hello.js check ran, got installed, and succeeded
        assert.ok(
          output.includes('Checking HelloJS'),
          'Installer output should include HelloJS check'
        );
        assert.ok(
          output.includes('Re-checking HelloJS'),
          'Installer output should show HelloJS was installed and re-checked'
        );
        assert.ok(
          output.includes('HelloJS (hello.js should exist and contain hello world) - hello world (installed)') || output.includes('HelloJS - hello world'),
          'Installer output should include HelloJS output after installation'
        );

        // Ensure workspace.config.yml exists (created from provided config)
        const structure = await verifyWorkspaceStructure(tempWorkspace);
        assert.ok(structure.workspaceConfigExists, 'workspace.config.yml should exist');

        // Verify symlink was created in projects/
        const symlinkPath = path.join(tempWorkspace, 'projects', 'my-local-project');
        const st = await fs.lstat(symlinkPath);
        assert.ok(st.isSymbolicLink(), 'projects/my-local-project should be a symlink');
        const linkTarget = await fs.readlink(symlinkPath);
        const resolvedTarget = path.resolve(path.dirname(symlinkPath), linkTarget);
        assert.strictEqual(resolvedTarget, path.resolve(localProjectPath), 'symlink should point to the local project folder');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Unattended Installation with workspace config template seedFiles[] copies seed files/folders', async () => {
      const sourceWorkspace = await createWorkspaceFromFixture('seed-source', {
        prefix: 'devduck-seed-source-test-'
      });
      const destWorkspace = await createWorkspaceFromFixture('empty', {
        prefix: 'devduck-seed-dest-test-'
      });
      const providedWorkspaceConfigPath = path.join(sourceWorkspace, 'workspace.config.yml');

      try {
        const result = await runInstaller(destWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          extensions: ['core', 'cursor'],
          skipRepoInit: true,
          workspaceConfig: providedWorkspaceConfigPath
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(destWorkspace, 30000);
        assert.ok(installed, 'Installation should complete');

        // Verify seed file copied
        const seedContent = await fs.readFile(path.join(destWorkspace, 'seed.txt'), 'utf8');
        assert.strictEqual(seedContent, 'seed file\n', 'seed.txt should be copied into workspace root');

        // Verify seed directory copied recursively
        const nestedContent = await fs.readFile(path.join(destWorkspace, 'seed-dir', 'nested.txt'), 'utf8');
        assert.strictEqual(nestedContent, 'nested\n', 'seed-dir should be copied into workspace root');
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
          extensions: ['core', 'cursor', 'plan', 'vcs'],
          skipRepoInit: true
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(tempWorkspace, 30000);
        assert.ok(installed, 'Installation should complete');

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        assert.ok(structure.workspaceConfigExists, 'workspace.config.yml should exist');
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
          extensions: ['core', 'cursor', 'plan', 'vcs']
        });
        assert.ok(configVerification.valid, 'workspace.config.yml should be valid');
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
        const initialResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          extensions: ['core', 'cursor'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);

        await waitForInstallation(tempWorkspace, 30000);

        const initialConfig = await verifyWorkspaceConfig(tempWorkspace);
        assert.ok(initialConfig.valid, 'Initial config should be valid');

        const reinstallResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          extensions: ['core', 'cursor', 'vcs'],
          skipRepoInit: true
        });

        checkInstallerResult(reinstallResult);

        await waitForInstallation(tempWorkspace, 30000);

        const afterReinstall = await verifyWorkspaceConfig(tempWorkspace, {
          extensions: ['core', 'cursor', 'vcs']
        });
        assert.ok(afterReinstall.valid, 'Config after reinstall should be valid');
        assert.ok((afterReinstall.config.extensions as string[]).includes('vcs'), 'vcs extension should be added');

        const structure = await verifyWorkspaceStructure(tempWorkspace);
        assert.ok(structure.workspaceConfigExists, 'workspace.config.yml should still exist');
        assert.ok(structure.cursorDirExists, '.cursor directory should still exist');

        const moduleVerification = await verifyModuleInstallation(tempWorkspace, ['core', 'cursor', 'vcs']);
        assert.ok(moduleVerification.commandsFound > 0, 'Commands should be present');

        assert.strictEqual(reinstallResult.exitCode, 0, 'Reinstall should exit with code 0');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Add Extensions to Existing Workspace', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        const initialResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          extensions: ['core', 'cursor'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);

        await waitForInstallation(tempWorkspace, 30000);

        const initialConfig = await verifyWorkspaceConfig(tempWorkspace, {
          extensions: ['core', 'cursor']
        });
        assert.ok(initialConfig.valid, 'Initial config should be valid');

        const addResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          extensions: ['core', 'cursor', 'dashboard'],
          skipRepoInit: true
        });

        checkInstallerResult(addResult);

        await waitForInstallation(tempWorkspace, 30000);

        const afterAdd = await verifyWorkspaceConfig(tempWorkspace);
        assert.ok((afterAdd.config.extensions as string[]).includes('dashboard'), 'dashboard extension should be added');
        assert.ok((afterAdd.config.extensions as string[]).includes('core'), 'core extension should still be present');
        assert.ok((afterAdd.config.extensions as string[]).includes('cursor'), 'cursor extension should still be present');

        const moduleVerification = await verifyModuleInstallation(tempWorkspace);
        assert.ok(moduleVerification.commandsFound > 0, 'Commands should include dashboard commands');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Remove Extensions from Existing Workspace', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        const initialResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          extensions: ['core', 'cursor', 'dashboard', 'vcs'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);

        await waitForInstallation(tempWorkspace, 30000);

        const initialConfig = await verifyWorkspaceConfig(tempWorkspace);
        assert.ok((initialConfig.config.extensions as string[]).includes('dashboard'), 'dashboard should be initially installed');

        const removeResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          extensions: ['core', 'cursor', 'vcs'],
          skipRepoInit: true
        });

        checkInstallerResult(removeResult);

        await waitForInstallation(tempWorkspace, 30000);

        const afterRemove = await verifyWorkspaceConfig(tempWorkspace);
        assert.ok(!(afterRemove.config.extensions as string[]).includes('dashboard'), 'dashboard extension should be removed');
        assert.ok((afterRemove.config.extensions as string[]).includes('core'), 'core extension should still be present');
        assert.ok((afterRemove.config.extensions as string[]).includes('cursor'), 'cursor extension should still be present');
        assert.ok((afterRemove.config.extensions as string[]).includes('vcs'), 'vcs extension should still be present');
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
          extensions: ['core', 'cursor', 'plan'],
          skipRepoInit: true
        });

        checkInstallerResult(initialResult);

        await waitForInstallation(tempWorkspace, 30000);

        const configPath = path.join(tempWorkspace, 'workspace.config.yml');
        const initialConfigContent = await fs.readFile(configPath, 'utf8');
        const initialConfig = YAML.parse(initialConfigContent);

        initialConfig.extensionSettings = {
          core: {
            testSetting: 'testValue'
          }
        };
        await fs.writeFile(configPath, YAML.stringify(initialConfig), 'utf8');

        const reinstallResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          extensions: ['core', 'cursor', 'plan'],
          skipRepoInit: true
        });

        checkInstallerResult(reinstallResult);

        await waitForInstallation(tempWorkspace, 30000);

        const afterReinstall = await verifyWorkspaceConfig(tempWorkspace);
        assert.ok(afterReinstall.config.extensionSettings, 'extensionSettings should be preserved');
        assert.ok(afterReinstall.config.extensionSettings.core, 'core extension settings should be preserved');
        assert.strictEqual(
          afterReinstall.config.extensionSettings.core.testSetting,
          'testValue',
          'Custom setting should be preserved'
        );

        assert.ok((afterReinstall.config.extensions as string[]).includes('core'), 'core should still be installed');
        assert.ok((afterReinstall.config.extensions as string[]).includes('cursor'), 'cursor should still be installed');
        assert.ok((afterReinstall.config.extensions as string[]).includes('plan'), 'plan should still be installed');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });

    test('Reinstallation - Extension Hooks Re-executed', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        const initialResult = await runInstaller(tempWorkspace, {
          unattended: true,
          aiAgent: 'cursor',
          repoType: 'none',
          extensions: ['core', 'cursor'],
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
          extensions: ['core', 'cursor'],
          skipRepoInit: true
        });

        checkInstallerResult(reinstallResult);

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

  describe('External Repository Installation', () => {
    test('Installation with External Repository', async () => {
      const tempWorkspace = await createTempWorkspace();
      
      try {
        // Create a local git repo that provides an external extension repository.
        // This avoids depending on GitHub/network and matches the "extensions/" layout (no legacy modules/).
        const repoSourceRoot = path.join(tempWorkspace, 'external-repo-src');
        const smogcheckExtDir = path.join(repoSourceRoot, 'extensions', 'smogcheck');
        await fs.mkdir(path.join(smogcheckExtDir, 'commands'), { recursive: true });
        await fs.mkdir(path.join(smogcheckExtDir, 'rules'), { recursive: true });

        await fs.writeFile(
          path.join(repoSourceRoot, 'manifest.json'),
          JSON.stringify({ devduckVersion: '0.1.0' }, null, 2) + '\n',
          'utf8'
        );

        await fs.writeFile(
          path.join(smogcheckExtDir, 'MODULE.md'),
          [
            '---',
            'name: smogcheck',
            'version: 0.1.0',
            'description: Test external extension repository (smogcheck)',
            'dependencies: [core]',
            '---',
            '',
            'Test extension used by installer tests.',
            ''
          ].join('\n'),
          'utf8'
        );

        // Post-install hook writes a marker to the workspace root.
        await fs.writeFile(
          path.join(smogcheckExtDir, 'hooks.js'),
          [
            "const fs = require('fs');",
            "const path = require('path');",
            '',
            'module.exports = {',
            "  'post-install': async (ctx) => {",
            "    const outPath = path.join(ctx.workspaceRoot, 'smogchecked.txt');",
            "    fs.writeFileSync(outPath, 'smogcheck\\n', 'utf8');",
            "    return { success: true, createdFiles: ['smogchecked.txt'] };",
            '  }',
            '};',
            ''
          ].join('\n'),
          'utf8'
        );

        await fs.writeFile(
          path.join(smogcheckExtDir, 'commands', 'smogcheck.md'),
          '# smogcheck\n',
          'utf8'
        );

        await fs.writeFile(
          path.join(smogcheckExtDir, 'rules', 'smogcheck.md'),
          '# smogcheck rules\n',
          'utf8'
        );

        // Initialize a local git repo so the installer can `git clone` it.
        await fs.writeFile(path.join(repoSourceRoot, 'README.md'), '# external repo\n', 'utf8');
        const { spawnSync } = await import('node:child_process');
        const init = spawnSync('git', ['init'], { cwd: repoSourceRoot, encoding: 'utf8' });
        assert.strictEqual(init.status, 0, `git init should succeed. stderr:\n${init.stderr || ''}`);
        const add = spawnSync('git', ['add', '.'], { cwd: repoSourceRoot, encoding: 'utf8' });
        assert.strictEqual(add.status, 0, `git add should succeed. stderr:\n${add.stderr || ''}`);
        const commit = spawnSync(
          'git',
          ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
          { cwd: repoSourceRoot, encoding: 'utf8' }
        );
        assert.strictEqual(commit.status, 0, `git commit should succeed. stderr:\n${commit.stderr || ''}`);

        // Create config with external repository
        const configPath = path.join(tempWorkspace, 'test-config.yml');
        const config = {
          aiAgent: 'cursor',
          repoType: 'none',
          extensions: ['core', 'cursor', 'smogcheck'],
          repos: [repoSourceRoot],
          skipRepoInit: true
        };
        await fs.writeFile(configPath, YAML.stringify(config), 'utf8');

        const result = await runInstaller(tempWorkspace, {
          unattended: true,
          config: configPath
        });

        checkInstallerResult(result);

        const installed = await waitForInstallation(tempWorkspace, 30000);
        assert.ok(installed, 'Installation should complete');

        // Verify workspace config includes the repo
        const configVerification = await verifyWorkspaceConfig(tempWorkspace);
        assert.ok(configVerification.valid, 'Config should be valid');
        assert.ok(configVerification.config.repos, 'Config should have repos field');
        assert.ok(
          configVerification.config.repos.includes(repoSourceRoot),
          'Config should include the local external repo path in repos'
        );

        // Repos from workspace config should be cloned under <workspace>/devduck/
        // (not hidden under .cache/), so users can inspect/edit them easily.
        const expectedRepoName = repoSourceRoot.replace(/\.git$/, '').replace(/[:\/]/g, '_');
        const repoRoot = path.join(tempWorkspace, 'devduck', expectedRepoName);

        // Ensure the repo clone exists and contains the expected extension.
        await fs.access(path.join(repoRoot, '.git'));
        await fs.access(path.join(repoRoot, 'extensions'));
        await fs.access(path.join(repoRoot, 'extensions', 'smogcheck', 'MODULE.md'));

        // Verify installer recorded installed module paths in .cache/install-state.json
        const statePath = path.join(tempWorkspace, '.cache', 'install-state.json');
        const stateRaw = await fs.readFile(statePath, 'utf8');
        const state = JSON.parse(stateRaw) as { installedModules?: Record<string, string> };
        assert.ok(state.installedModules, 'install-state.json should include installedModules');
        assert.ok(
          typeof state.installedModules.smogcheck === 'string' &&
            state.installedModules.smogcheck.endsWith(path.join('extensions', 'smogcheck')),
          'install-state.json should include smogcheck extension path'
        );

        // Verify smogchecked.txt file exists (created by smogcheck module hook)
        const smogcheckedPath = path.join(tempWorkspace, 'smogchecked.txt');
        try {
          await fs.access(smogcheckedPath);
          const smogcheckedContent = await fs.readFile(smogcheckedPath, 'utf8');
          assert.ok(smogcheckedContent.includes('smogcheck'), 'smogchecked.txt should contain smogcheck');
        } catch (e) {
          throw new Error('smogchecked.txt file should exist in workspace root');
        }

        // Verify smogcheck command is copied to .cursor/commands/
        const commandsDir = path.join(tempWorkspace, '.cursor', 'commands');
        const commandsFiles = await fs.readdir(commandsDir);
        assert.ok(
          commandsFiles.includes('smogcheck.md'),
          'smogcheck.md command should be copied to .cursor/commands/'
        );

        // Verify smogcheck rules are merged into .cursor/rules/
        const rulesPath = path.join(tempWorkspace, '.cursor', 'rules', 'devduck-rules.md');
        try {
          const rulesContent = await fs.readFile(rulesPath, 'utf8');
          assert.ok(
            rulesContent.includes('smogcheck'),
            'devduck-rules.md should contain smogcheck rules'
          );
        } catch (e) {
          throw new Error('devduck-rules.md should exist and contain smogcheck rules');
        }

        assert.strictEqual(result.exitCode, 0, 'Installer should exit with code 0');
      } finally {
        await cleanupTempWorkspace(tempWorkspace);
      }
    });
  });
});

