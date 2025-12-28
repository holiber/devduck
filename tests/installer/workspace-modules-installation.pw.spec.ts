/**
 * Playwright Test port of `workspace-modules-installation.test.ts`
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  createTempWorkspace,
  cleanupTempWorkspace,
  runInstaller,
  waitForInstallation,
  checkInstallerResult
} from './helpers.ts';

test.describe('Workspace Installer - Workspace-local modules/', () => {
  test.describe.configure({ mode: 'serial' });

  test('Installs module from workspace/modules when listed in config', async () => {
    const tempWorkspace = await createTempWorkspace();
    const configPath = path.join(tempWorkspace, 'test-config.json');

    try {
      const moduleName = 'localmod';
      const moduleDir = path.join(tempWorkspace, 'modules', moduleName);
      await fs.mkdir(moduleDir, { recursive: true });

      await fs.writeFile(
        path.join(moduleDir, 'MODULE.md'),
        [
          '---',
          `name: ${moduleName}`,
          'version: 0.1.0',
          'description: Workspace-local module',
          'dependencies: [core]',
          '---',
          '',
          'Workspace-local module used for tests.',
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
          "    const outPath = path.join(ctx.workspaceRoot, 'localmod-installed.txt');",
          "    fs.writeFileSync(outPath, 'ok\\n', 'utf8');",
          "    return { success: true, createdFiles: ['localmod-installed.txt'] };",
          '  }',
          '};',
          ''
        ].join('\n'),
        'utf8'
      );

      const config = {
        aiAgent: 'cursor',
        repoType: 'none',
        modules: ['core', 'cursor', moduleName],
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

      const markerPath = path.join(tempWorkspace, 'localmod-installed.txt');
      const marker = await fs.readFile(markerPath, 'utf8');
      expect(marker, 'Workspace-local module post-install hook should create marker file').toBe('ok\n');
    } finally {
      await cleanupTempWorkspace(tempWorkspace);
    }
  });
});

