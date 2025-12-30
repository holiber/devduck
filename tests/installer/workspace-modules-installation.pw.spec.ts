import { test } from '@playwright/test';
import assert from 'node:assert';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';

import {
  createTempWorkspace,
  cleanupTempWorkspace,
  runInstallerInProcess,
  checkInstallerResult
} from './helpers.js';

test.describe('Workspace Installer - Workspace-local extensions/', () => {
  test('Installs extension from workspace/extensions when listed in config', async () => {
    const tempWorkspace = await createTempWorkspace();
    const configPath = path.join(tempWorkspace, 'test-config.yml');

    try {
      // Create a workspace-local extension with a post-install hook.
      const moduleName = 'localmod';
      const moduleDir = path.join(tempWorkspace, 'extensions', moduleName);
      await fs.mkdir(moduleDir, { recursive: true });

      await fs.writeFile(
        path.join(moduleDir, 'MODULE.md'),
        [
          '---',
          `name: ${moduleName}`,
          'version: 0.1.0',
          'description: Workspace-local extension',
          'dependencies: [core]',
          '---',
          '',
          'Workspace-local extension used for tests.',
          ''
        ].join('\n'),
        'utf8'
      );

      await fs.writeFile(
        path.join(moduleDir, 'hooks.js'),
        [
          "const fs = require('fs');",
          "const path = require('path');",
          '',
          'module.exports = {',
          "  'post-install': async (ctx) => {",
          "    const outPath = path.join(ctx.cacheDir, 'localmod-installed.txt');",
          "    fs.mkdirSync(path.dirname(outPath), { recursive: true });",
          "    fs.writeFileSync(outPath, 'ok\\n', 'utf8');",
          "    return { success: true, createdFiles: [path.relative(ctx.workspaceRoot, outPath)] };",
          '  }',
          '};',
          ''
        ].join('\n'),
        'utf8'
      );

      // Run installer with a config that includes the workspace-local extension.
      const config = {
        aiAgent: 'cursor',
        repoType: 'none',
        extensions: ['core', 'cursor', moduleName],
        skipRepoInit: true
      };
      await fs.writeFile(configPath, YAML.stringify(config), 'utf8');

      const result = await runInstallerInProcess(tempWorkspace, {
        unattended: true,
        config: configPath
      });

      checkInstallerResult(result);

      // Verify the workspace-local extension hook ran.
      const markerPath = path.join(tempWorkspace, '.cache', 'barducks', 'localmod-installed.txt');
      const marker = await fs.readFile(markerPath, 'utf8');
      assert.strictEqual(marker, 'ok\n', 'Workspace-local extension post-install hook should create marker file');
    } finally {
      await cleanupTempWorkspace(tempWorkspace);
    }
  });
});

